import { APP_ID, BROADCAST_CHANNEL, DB_NAME, INDEXED_DB_VERSION, PERSISTENCE_SCHEMA_VERSION, PRODUCT_VERSION } from "./config";

const DB_VERSION = INDEXED_DB_VERSION;
const LEASE_MS = 8_000;

export interface WriterLease {
  key: "writer";
  ownerId: string;
  generation: number;
  expiresAt: number;
}

export interface StudyMemory {
  key: string;
  stableId: string;
  card: unknown;
  correct: number;
  wrong: number;
  lastSeenAt: string;
  dueAt: string;
  lastResult: "correct" | "wrong";
}

export interface StudyEventRecord {
  key: string;
  ownerId: string;
  writerGeneration: number;
  payload: {
    type?: string;
    stableId?: string;
    correct?: boolean;
    answeredAt?: string;
    [key: string]: unknown;
  };
}

export function openStudyDb(dbName: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ["meta", "memory", "events", "sessions", "plans", "coordination"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "key" });
      }
      request.transaction!.objectStore("meta").put({
        key: "identity", appId: APP_ID, persistenceSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
        indexedDbVersion: DB_VERSION, createdByRelease: PRODUCT_VERSION,
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

function get<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

export async function readStudyMemory(db: IDBDatabase): Promise<Map<string, StudyMemory>> {
  const tx = db.transaction("memory", "readonly");
  const rows = await getAll<StudyMemory>(tx.objectStore("memory"));
  await txDone(tx);
  return new Map(rows.map((row) => [row.stableId, row]));
}

export async function readStudyEvents(db: IDBDatabase): Promise<StudyEventRecord[]> {
  const tx = db.transaction("events", "readonly");
  const rows = await getAll<StudyEventRecord>(tx.objectStore("events"));
  await txDone(tx);
  return rows;
}

export class SingleWriter {
  readonly ownerId: string;
  private generation = 0;
  private timer: number | undefined;
  private channel: BroadcastChannel | null = null;

  constructor(private readonly db: IDBDatabase, channelName: string = BROADCAST_CHANNEL, ownerId: string = crypto.randomUUID()) {
    this.ownerId = ownerId;
    if (typeof BroadcastChannel !== "undefined") this.channel = new BroadcastChannel(channelName);
  }

  async acquire(now = Date.now()): Promise<boolean> {
    const tx = this.db.transaction("coordination", "readwrite");
    const store = tx.objectStore("coordination");
    const current = await get<WriterLease>(store, "writer");
    if (current && current.expiresAt > now && current.ownerId !== this.ownerId) {
      tx.abort();
      try { await txDone(tx); } catch { /* expected */ }
      return false;
    }
    this.generation = Math.max(this.generation, current?.generation ?? 0) + 1;
    store.put({ key: "writer", ownerId: this.ownerId, generation: this.generation, expiresAt: now + LEASE_MS } satisfies WriterLease);
    await txDone(tx);
    this.channel?.postMessage({ type: "writer-acquired", ownerId: this.ownerId, generation: this.generation });
    return true;
  }

  async heartbeat(now = Date.now()): Promise<boolean> {
    const tx = this.db.transaction("coordination", "readwrite");
    const store = tx.objectStore("coordination");
    const current = await get<WriterLease>(store, "writer");
    if (!current || current.ownerId !== this.ownerId || current.generation !== this.generation) {
      tx.abort();
      try { await txDone(tx); } catch { /* expected */ }
      this.stopHeartbeat();
      return false;
    }
    current.expiresAt = now + LEASE_MS;
    store.put(current);
    await txDone(tx);
    return true;
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.timer = window.setInterval(() => void this.heartbeat(), LEASE_MS / 2);
  }

  stopHeartbeat(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private async checkedTransaction(storeNames: string[]): Promise<{ tx: IDBTransaction; lease: WriterLease }> {
    const tx = this.db.transaction(["coordination", ...storeNames], "readwrite");
    const lease = await get<WriterLease>(tx.objectStore("coordination"), "writer");
    if (!lease || lease.ownerId !== this.ownerId || lease.generation !== this.generation || lease.expiresAt <= Date.now()) {
      tx.abort();
      throw new Error("STALE_WRITER");
    }
    return { tx, lease };
  }

  async commitEvent(eventId: string, payload: unknown): Promise<void> {
    const { tx, lease } = await this.checkedTransaction(["events"]);
    const events = tx.objectStore("events");
    if (await get(events, eventId)) {
      tx.abort();
      throw new Error("DUPLICATE_EVENT");
    }
    events.put({ key: eventId, ownerId: this.ownerId, writerGeneration: lease.generation, payload });
    await txDone(tx);
  }

  async commitReview(eventId: string, payload: StudyEventRecord["payload"], memory: StudyMemory): Promise<void> {
    const { tx, lease } = await this.checkedTransaction(["events", "memory"]);
    const events = tx.objectStore("events");
    if (await get(events, eventId)) {
      tx.abort();
      throw new Error("DUPLICATE_EVENT");
    }
    events.put({ key: eventId, ownerId: this.ownerId, writerGeneration: lease.generation, payload });
    tx.objectStore("memory").put(memory);
    await txDone(tx);
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    const tx = this.db.transaction("coordination", "readwrite");
    const store = tx.objectStore("coordination");
    const current = await get<WriterLease>(store, "writer");
    if (current?.ownerId === this.ownerId && current.generation === this.generation) store.delete("writer");
    await txDone(tx);
  }

  close(): void {
    this.stopHeartbeat();
    this.channel?.close();
  }
}

export async function runStorageProbe(dbName: string): Promise<Array<{ name: string; ok: boolean; detail: string }>> {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const db = await openStudyDb(dbName);
  results.push({ name: "IndexedDB open", ok: true, detail: db.name });
  const writerA = new SingleWriter(db, `${BROADCAST_CHANNEL}:qa`);
  const writerB = new SingleWriter(db, `${BROADCAST_CHANNEL}:qa`);
  const a = await writerA.acquire();
  const b = await writerB.acquire();
  results.push({ name: "Single Writer", ok: a && !b, detail: `writer A=${a}, writer B=${b}` });
  await writerA.commitEvent(`qa-${crypto.randomUUID()}`, { probe: true });
  results.push({ name: "Atomic event commit", ok: true, detail: "fenced transaction committed" });
  await writerA.release();
  writerA.close();
  writerB.close();
  db.close();
  return results;
}
