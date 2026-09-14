import { APP_ID, BACKUP_DB_NAME, EXPORT_FORMAT } from "../config";
import type { SingleWriter } from "../storage";
import type { BackupManifest, DailyPlanRecord, DomainEvent, ExportEnvelope, GenerationMeta, Preferences, SkillState } from "./types";

const DAY_TARGET = 20 * 60;
const CHUNK_SIZE = 60_000;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("transaction aborted")); });
}
async function all<T>(db: IDBDatabase, store: string): Promise<T[]> {
  const tx = db.transaction(store, "readonly"); const rows = await req(tx.objectStore(store).getAll()) as T[]; await done(tx); return rows;
}
async function one<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(store, "readonly"); const row = await req(tx.objectStore(store).get(key)) as T | undefined; await done(tx); return row;
}
function uuid(): string { return crypto.randomUUID(); }
async function sha(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}

export async function ensureGeneration(db: IDBDatabase, dataVersion: string, registryCount: number, coreCount: number): Promise<GenerationMeta> {
  const existing = await one<GenerationMeta>(db, "meta", "generation");
  if (existing) return existing;
  const generation: GenerationMeta = { key: "generation", generationId: uuid(), revision: 1, createdAt: new Date().toISOString(), origin: "fresh", dataVersion, registryCount, coreCount };
  const prefs: Preferences = { key: "preferences", generationId: generation.generationId, dailyTargetSeconds: DAY_TARGET, learningTimeZone: "Europe/London", examDate: null, diagnosticCompleted: false, lastAppliedRevision: 1 };
  const tx = db.transaction(["meta", "events"], "readwrite");
  tx.objectStore("meta").put(generation); tx.objectStore("meta").put(prefs);
  tx.objectStore("events").put({ key: `domain:${generation.generationId}:1`, generationId: generation.generationId, revision: 1, type: "GenerationStarted", at: generation.createdAt, payload: { origin: "fresh", dataVersion } } satisfies DomainEvent);
  await done(tx); return generation;
}

export async function loadRichState(db: IDBDatabase) {
  const generation = await one<GenerationMeta>(db, "meta", "generation");
  const preferences = await one<Preferences>(db, "meta", "preferences");
  const memory = (await all<SkillState>(db, "memory")).filter((x) => x?.key?.startsWith("skill:"));
  const plans = (await all<DailyPlanRecord>(db, "plans")).filter((x) => x?.key?.startsWith("plan:"));
  const events = (await all<DomainEvent>(db, "events")).filter((x) => x?.key?.startsWith("domain:"));
  return { generation, preferences, memory, plans, events };
}

async function liveLease(writer: SingleWriter, tx: IDBTransaction) {
  const lease = await req(tx.objectStore("coordination").get("writer")) as { ownerId?: string; generation?: number; expiresAt?: number } | undefined;
  if (!lease || lease.ownerId !== writer.ownerId || (lease.expiresAt ?? 0) <= Date.now()) throw new Error("STALE_WRITER");
  return lease;
}

export async function commitDomain(
  db: IDBDatabase,
  writer: SingleWriter,
  type: string,
  payload: Record<string, unknown>,
  mutate: (stores: { meta: IDBObjectStore; memory: IDBObjectStore; plans: IDBObjectStore }) => void,
): Promise<number> {
  const tx = db.transaction(["coordination", "meta", "memory", "plans", "events"], "readwrite");
  await liveLease(writer, tx);
  const meta = tx.objectStore("meta");
  const generation = await req(meta.get("generation")) as GenerationMeta | undefined;
  if (!generation) { tx.abort(); throw new Error("NO_GENERATION"); }
  const revision = generation.revision + 1;
  generation.revision = revision; meta.put(generation);
  mutate({ meta, memory: tx.objectStore("memory"), plans: tx.objectStore("plans") });
  tx.objectStore("events").put({ key: `domain:${generation.generationId}:${revision}`, generationId: generation.generationId, revision, type, at: new Date().toISOString(), payload } satisfies DomainEvent);
  await done(tx); return revision;
}

export async function commitEventOnly(db: IDBDatabase, writer: SingleWriter, type: string, payload: Record<string, unknown>): Promise<void> {
  await commitDomain(db, writer, type, payload, () => undefined);
}

export async function savePreferences(db: IDBDatabase, writer: SingleWriter, patch: Partial<Pick<Preferences, "dailyTargetSeconds" | "learningTimeZone" | "examDate" | "diagnosticCompleted">>): Promise<void> {
  const state = await loadRichState(db); if (!state.preferences || !state.generation) throw new Error("NO_GENERATION");
  const next: Preferences = { ...state.preferences, ...patch, lastAppliedRevision: state.generation.revision + 1 };
  await commitDomain(db, writer, "PreferencesUpdated", patch as Record<string, unknown>, ({ meta }) => meta.put(next));
}

export async function saveSkillAndEvent(db: IDBDatabase, writer: SingleWriter, skill: SkillState, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const state = await loadRichState(db); if (!state.generation) throw new Error("NO_GENERATION");
  const next = { ...skill, lastAppliedRevision: state.generation.revision + 1 };
  await commitDomain(db, writer, eventType, payload, ({ memory }) => memory.put(next));
}

export async function savePlan(db: IDBDatabase, writer: SingleWriter, plan: DailyPlanRecord, eventType = "DailyPlanUpdated"): Promise<void> {
  const state = await loadRichState(db); if (!state.generation) throw new Error("NO_GENERATION");
  await commitDomain(db, writer, eventType, { learningDayId: plan.learningDayId }, ({ plans }) => plans.put({ ...plan, lastAppliedRevision: state.generation!.revision + 1 }));
}

async function envelopeWithoutChecksum(db: IDBDatabase, dataVersion: string) {
  const s = await loadRichState(db);
  if (!s.generation || !s.preferences) throw new Error("NO_GENERATION");
  return { appId: APP_ID, exportFormat: EXPORT_FORMAT, exportedAt: new Date().toISOString(), dataVersion, generation: s.generation, preferences: s.preferences, memory: s.memory, plans: s.plans, events: s.events } as const;
}
export async function exportEnvelope(db: IDBDatabase, dataVersion: string): Promise<ExportEnvelope> {
  const body = await envelopeWithoutChecksum(db, dataVersion); return { ...body, checksum: await sha(stableJson(body)) } as ExportEnvelope;
}
export async function verifyEnvelope(value: unknown): Promise<ExportEnvelope> {
  const e = value as ExportEnvelope;
  if (!e || e.appId !== APP_ID || e.exportFormat !== EXPORT_FORMAT) throw new Error("別アプリのexportは読み込めません。");
  const { checksum, ...body } = e; if (await sha(stableJson(body)) !== checksum) throw new Error("Export checksumが一致しません。");
  return e;
}

function openBackupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(BACKUP_DB_NAME, 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains("manifests")) db.createObjectStore("manifests", { keyPath: "key" }); if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: "key" }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}

export async function createBackup(db: IDBDatabase, dataVersion: string, purpose = "manual"): Promise<string> {
  const envelope = await exportEnvelope(db, dataVersion); const text = JSON.stringify(envelope); const snapshotId = uuid();
  const chunks = Array.from({ length: Math.ceil(text.length / CHUNK_SIZE) }, (_, i) => text.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  const hashes = await Promise.all(chunks.map(sha)); const rootHash = await sha(stableJson({ snapshotId, purpose, dataVersion, hashes, checksum: envelope.checksum }));
  const b = await openBackupDb(); const tx = b.transaction(["manifests", "chunks"], "readwrite");
  const manifest: BackupManifest = { key: snapshotId, snapshotId, createdAt: new Date().toISOString(), purpose, complete: false, chunkCount: chunks.length, chunkHashes: hashes, rootHash };
  tx.objectStore("manifests").put(manifest); chunks.forEach((content, i) => tx.objectStore("chunks").put({ key: `${snapshotId}:${i}`, snapshotId, i, hash: hashes[i], content })); manifest.complete = true; tx.objectStore("manifests").put(manifest); await done(tx); b.close(); return snapshotId;
}

export async function listBackups(): Promise<BackupManifest[]> {
  const b = await openBackupDb(); const rows = (await all<BackupManifest>(b, "manifests")).filter((x) => x.complete).sort((a, z) => z.createdAt.localeCompare(a.createdAt)); b.close(); return rows;
}
export async function loadBackup(snapshotId: string): Promise<ExportEnvelope> {
  const b = await openBackupDb(); const m = await one<BackupManifest>(b, "manifests", snapshotId); if (!m?.complete) { b.close(); throw new Error("Backupが不完全です。"); }
  const rows = (await all<{ key: string; snapshotId: string; i: number; hash: string; content: string }>(b, "chunks")).filter((x) => x.snapshotId === snapshotId).sort((a, z) => a.i - z.i); b.close();
  if (rows.length !== m.chunkCount) throw new Error("Backup chunk不足です。"); for (const r of rows) if (await sha(r.content) !== r.hash) throw new Error("Backup chunk checksum不一致です。");
  return verifyEnvelope(JSON.parse(rows.map((x) => x.content).join("")));
}

export async function replaceGeneration(db: IDBDatabase, writer: SingleWriter, source: ExportEnvelope | null, dataVersion: string, origin: "import" | "restore" | "reset"): Promise<void> {
  const now = new Date().toISOString(); const generationId = uuid();
  const generation: GenerationMeta = { key: "generation", generationId, revision: 1, createdAt: now, origin, dataVersion, registryCount: 623, coreCount: 241 };
  const prefs: Preferences = source ? { ...source.preferences, generationId, lastAppliedRevision: 1 } : { key: "preferences", generationId, dailyTargetSeconds: DAY_TARGET, learningTimeZone: "Europe/London", examDate: null, diagnosticCompleted: false, lastAppliedRevision: 1 };
  const tx = db.transaction(["coordination", "meta", "memory", "plans", "events"], "readwrite");
  await liveLease(writer, tx);
  const memory = tx.objectStore("memory"), plans = tx.objectStore("plans"), events = tx.objectStore("events");
  memory.clear(); plans.clear(); events.clear(); tx.objectStore("meta").put(generation); tx.objectStore("meta").put(prefs);
  let revision = 1; events.put({ key: `domain:${generationId}:1`, generationId, revision: 1, type: "GenerationStarted", at: now, payload: { origin } } satisfies DomainEvent);
  if (source) {
    for (const row of source.memory) memory.put({ ...row, generationId, lastAppliedRevision: 1 });
    for (const row of source.plans) plans.put({ ...row, generationId, key: `plan:${generationId}:${row.learningDayId}`, lastAppliedRevision: 1 });
    events.put({ key: `domain:${generationId}:2`, generationId, revision: 2, type: "HistoryRebased", at: now, payload: { sourceGenerationId: source.generation.generationId, sourceEventCount: source.events.length, technicalReconciliation: true } } satisfies DomainEvent); revision = 2;
  }
  generation.revision = revision; tx.objectStore("meta").put(generation); await done(tx);
}
