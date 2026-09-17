import "./styles.css";
import "./rich/styles.css";
import { loadRuntimeBundle, type RuntimeBundle, type RuntimeEntity } from "./runtime";
import { openStudyDb, SingleWriter } from "./storage";
import { buildDiagnostic, provisionalFromDiagnostic } from "./rich/diagnostic";
import { applyStudyAnswer, buildQueue, createInitialState, ensurePlan, gradeInput, learningDayId, makeQuestion, stateKey } from "./rich/planner";
import { clearActiveSession, commitEventOnly, createBackup, ensureGeneration, exportEnvelope, listBackups, loadActiveSession, loadBackup, loadRichState, replaceGeneration, saveActiveSession, savePlan, savePreferences, saveSkillAndEvent, verifyEnvelope } from "./rich/store";
import type { DailyPlanRecord, DomainEvent, Preferences, QuestionRun, ScheduleFilter, SkillState, StoredSessionRecord, StudyMode } from "./rich/types";
import { analysisView, homeView, questionView, settingsView, statsView, wordsView, type Route } from "./rich/views";
import { PRODUCT_VERSION, SCHEDULER_CONFIG } from "./config";
import type { CanonicalReviewPayload } from "./rich/types";

const root = document.querySelector<HTMLDivElement>("#app")!;
interface Ctx { bundle: RuntimeBundle; db: IDBDatabase; writer: SingleWriter; writable: boolean; }
interface Session {
  generationId: string;
  sessionId: string;
  startedAt: string;
  mode: "study" | "diagnostic";
  queue: QuestionRun[];
  index: number;
  feedback?: { rating: string; answer: string; given: string };
  shownAt: number;
  diagnostics: Array<{ correct: boolean }>;
}
let ctx: Ctx | null = null;
let session: Session | null = null;
let wordQuery = "";
let wordFilter = "all";
let activePreferences: Preferences | null = null;
const graded = new Set<string>();
const WRITER_OWNER_KEY = "rikkyo-uk-vocab:writer-owner:v3";

function writerOwnerId(): string {
  const current = sessionStorage.getItem(WRITER_OWNER_KEY);
  if (current) return current;
  const created = crypto.randomUUID();
  sessionStorage.setItem(WRITER_OWNER_KEY, created);
  return created;
}

function route(): Route {
  const r = location.hash.replace("#", "") as Route;
  return ["home", "study", "diagnostic", "words", "stats", "analysis", "settings"].includes(r) ? r : "home";
}
function entity(id: string): RuntimeEntity {
  const e = ctx?.bundle.core.find((x) => x.stableId === id);
  if (!e) throw new Error(`Unknown entity ${id}`);
  return e;
}
function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const accent = activePreferences?.accent ?? "auto";
  u.lang = accent === "us" ? "en-US" : "en-GB";
  const voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  const selected = voices.find((v) => v.voiceURI === activePreferences?.voiceURI);
  if (selected) u.voice = selected;
  u.rate = 0.88;
  speechSynthesis.speak(u);
}
function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function todayAnswered(events: DomainEvent[], timeZone: string): number {
  const day = learningDayId(new Date(), timeZone);
  return events.filter((e) => ["AnswerCommitted", "DiagnosticAnswer"].includes(e.type) && learningDayId(new Date(e.at), timeZone) === day).length;
}
function effectivePlan(plan: DailyPlanRecord, prefs: Preferences, memory: SkillState[]): DailyPlanRecord {
  const due = memory.filter((x) => Date.parse(x.dueAt) <= Date.now()).length;
  let cap = 12;
  let closed = plan.acquisitionClosed;
  if (due > 100) closed = true;
  else if (due > 40) cap = 4;
  if (prefs.examDate) {
    const days = Math.ceil((Date.parse(`${prefs.examDate}T12:00:00Z`) - Date.now()) / 86400000);
    if (days <= 3) closed = true;
    else if (days <= 7) cap = Math.min(cap, 3);
    else if (days <= 14) cap = Math.min(cap, 6);
  }
  return { ...plan, acquisitionCap: cap, acquisitionClosed: closed || ((plan.activeStudySeconds ?? 0) >= plan.targetSeconds) };
}
async function state() {
  if (!ctx) throw new Error("NO_CONTEXT");
  const s = await loadRichState(ctx.db);
  const generation = s.generation;
  const preferences = s.preferences;
  if (!generation || !preferences) throw new Error("NO_GENERATION");
  activePreferences = preferences;
  applyTheme(preferences.theme ?? "auto");
  const day = learningDayId(new Date(), preferences.learningTimeZone);
  let plan = ensurePlan(
    generation.generationId,
    preferences.dailyTargetSeconds,
    s.plans.find((x) => x.learningDayId === day),
    preferences.learningTimeZone,
  );
  plan = effectivePlan(plan, preferences, s.memory);
  if (!s.plans.some((x) => x.key === plan.key) && ctx.writable) await savePlan(ctx.db, ctx.writer, plan, "DailyPlanCreated");
  return { generation, preferences, memory: s.memory, plans: s.plans, events: s.events, plan };
}
function activeSessionRecord(resumeIndex: number): Omit<StoredSessionRecord, "lastAppliedRevision"> {
  if (!session) throw new Error("NO_SESSION");
  return {
    key: "active-session",
    generationId: session.generationId,
    sessionId: session.sessionId,
    mode: session.mode,
    queue: session.queue,
    resumeIndex,
    startedAt: session.startedAt,
    updatedAt: new Date().toISOString(),
  };
}
async function checkpointSession(resumeIndex: number, eventType = "SessionCheckpointed") {
  if (!ctx || !session || !ctx.writable) return;
  await saveActiveSession(ctx.db, ctx.writer, activeSessionRecord(resumeIndex), eventType);
}

async function renderHome() {
  if (!ctx) return;
  const s = await state();
  root.innerHTML = homeView({ bundle: ctx.bundle, plan: s.plan, memory: s.memory, answeredToday: todayAnswered(s.events, s.preferences.learningTimeZone), activeSeconds: s.plan.activeStudySeconds ?? 0, diagnosticCompleted: s.preferences.diagnosticCompleted, preferences: s.preferences });
  document.querySelector("#start-study")?.addEventListener("click", () => void startStudy());
  document.querySelector("#start-diagnostic")?.addEventListener("click", () => void startDiagnostic());
  const mode = document.querySelector<HTMLSelectElement>("#study-mode"), schedule = document.querySelector<HTMLSelectElement>("#schedule-filter"), size = document.querySelector<HTMLSelectElement>("#session-size");
  mode?.addEventListener("change", () => void savePreferences(ctx!.db, ctx!.writer, { studyMode: mode.value as StudyMode }));
  schedule?.addEventListener("change", () => void savePreferences(ctx!.db, ctx!.writer, { scheduleFilter: schedule.value as ScheduleFilter }));
  size?.addEventListener("change", () => void savePreferences(ctx!.db, ctx!.writer, { sessionSize: Number(size.value) }));
}
async function renderWords() {
  if (!ctx) return;
  const s = await state();
  root.innerHTML = wordsView(ctx.bundle, s.memory, wordQuery, wordFilter);
  const search = document.querySelector<HTMLInputElement>("#word-search");
  const filter = document.querySelector<HTMLSelectElement>("#word-filter");
  search?.addEventListener("input", () => { wordQuery = search.value; void renderWords(); });
  filter?.addEventListener("change", () => { wordFilter = filter.value; void renderWords(); });
}
async function renderStats() {
  if (!ctx) return;
  const s = await state();
  root.innerHTML = statsView(ctx.bundle, s.memory, s.events);
}
async function renderAnalysis() {
  if (!ctx) return;
  root.innerHTML = analysisView(ctx.bundle);
}
async function renderSettings() {
  if (!ctx) return;
  const s = await state();
  const backups = await listBackups();
  root.innerHTML = settingsView(s.preferences, backups);
  bindSettings();
  populateVoices(s.preferences);
}
async function renderRoute() {
  if (session && route() !== "study" && route() !== "diagnostic") session = null;
  const r = route();
  if (r === "words") return renderWords();
  if (r === "stats") return renderStats();
  if (r === "analysis") return renderAnalysis();
  if (r === "settings") return renderSettings();
  if ((r === "study" || r === "diagnostic") && session) return renderQuestion();
  return renderHome();
}

async function startStudy() {
  if (!ctx?.writable) return alert("別タブが学習Writerです。別タブを閉じて再読み込みしてください。");
  const s = await state();
  const plan = effectivePlan(s.plan, s.preferences, s.memory);
  const requested = s.preferences.sessionSize ?? 20;
  const items = buildQueue(ctx.bundle, s.memory, plan, new Date(), requested === 0 ? 60 : requested, { mode: s.preferences.studyMode ?? "recommended", schedule: s.preferences.scheduleFilter ?? "all" });
  if (!items.length) return alert("現在出題できる項目はありません。");
  const now = new Date().toISOString();
  session = { generationId: s.generation.generationId, sessionId: crypto.randomUUID(), startedAt: now, mode: "study", queue: items.map((x) => makeQuestion(ctx!.bundle, x)), index: 0, shownAt: Date.now(), diagnostics: [] };
  await checkpointSession(0, "SessionStarted");
  location.hash = "study";
  await renderQuestion();
}
async function startDiagnostic() {
  if (!ctx?.writable) return alert("別タブが学習Writerです。");
  const s = await state();
  const questions = buildDiagnostic(ctx.bundle);
  const now = new Date().toISOString();
  session = { generationId: s.generation.generationId, sessionId: crypto.randomUUID(), startedAt: now, mode: "diagnostic", queue: questions, index: 0, shownAt: Date.now(), diagnostics: [] };
  await checkpointSession(0, "SessionStarted");
  location.hash = "diagnostic";
  await renderQuestion();
}
async function renderQuestion() {
  if (!ctx || !session) return;
  if (session.index >= session.queue.length) {
    if (session.mode === "diagnostic") await finishDiagnostic();
    await clearActiveSession(ctx.db, ctx.writer, "completed");
    session = null;
    location.hash = "home";
    return renderHome();
  }
  const q = session.queue[session.index]!;
  const e = entity(q.stableId);
  root.innerHTML = questionView(q, e, session.index, session.queue.length, session.mode, session.feedback);
  document.querySelector("#speak-word")?.addEventListener("click", () => speak(e.lemma));
  document.querySelector("#stop-session")?.addEventListener("click", () => void (async () => {
    if (!ctx) return;
    await clearActiveSession(ctx.db, ctx.writer, "user-stop");
    session = null;
    location.hash = "home";
  })());
  document.querySelector("#next-question")?.addEventListener("click", () => {
    if (!session) return;
    session.index += 1;
    session.feedback = undefined;
    session.shownAt = Date.now();
    void renderQuestion();
  });
  document.querySelectorAll<HTMLButtonElement>(".rich-choice").forEach((b) => b.addEventListener("click", () => void answer(b.dataset.answer ?? "")));
  document.querySelector("#input-answer")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void answer(document.querySelector<HTMLInputElement>("#answer-input")?.value ?? "");
  });
}

async function answer(given: string) {
  if (!ctx || !session) return;
  const q = session.queue[session.index]!;
  if (graded.has(q.questionInstanceId)) return;
  graded.add(q.questionInstanceId);
  const now = new Date();
  const rating = q.choices.length ? (given === q.answer ? "Good" : "Again") : gradeInput(given, q.answer);
  const correct = rating !== "Again";
  const s = await state();
  const eventBase = { sessionId: session.sessionId, questionInstanceId: q.questionInstanceId, stableId: q.stableId, skillKey: q.skillKey };

  if (session.mode === "diagnostic") {
    session.diagnostics.push({ correct });
    if (correct) {
      const provisional = provisionalFromDiagnostic(s.generation.generationId, q.stableId, q.skillKey, now);
      await saveSkillAndEvent(ctx.db, ctx.writer, provisional, "DiagnosticAnswer", {
        ...eventBase, eventId: `diagnostic:${session.generationId}:${q.questionInstanceId}`,
        idempotencyKey: q.questionInstanceId, timestamp: now.toISOString(), correct: true,
        diagnostic: true, schedulerMetadata: SCHEDULER_CONFIG, createdByRelease: PRODUCT_VERSION,
      });
    } else {
      await commitEventOnly(ctx.db, ctx.writer, "DiagnosticAnswer", {
        ...eventBase, eventId: `diagnostic:${session.generationId}:${q.questionInstanceId}`,
        idempotencyKey: q.questionInstanceId, timestamp: now.toISOString(), correct: false,
        diagnostic: true, noLapse: true, noMemoryMutation: true, schedulerMetadata: SCHEDULER_CONFIG,
        createdByRelease: PRODUCT_VERSION,
      });
    }
  } else {
    const key = stateKey(q.stableId, q.skillKey);
    let prev = s.memory.find((x) => x.key === key);
    if (!prev) prev = createInitialState(s.generation.generationId, q.stableId, q.skillKey, now);
    const next = applyStudyAnswer(prev, rating, now);
    const reviewPayload: CanonicalReviewPayload = {
      ...eventBase,
      eventId: `review:${session.generationId}:${q.questionInstanceId}`,
      idempotencyKey: q.questionInstanceId,
      timestamp: now.toISOString(),
      result: correct ? "correct" : "wrong",
      rating,
      lane: q.lane,
      schedulerMetadata: SCHEDULER_CONFIG,
      schedulerCardAfter: next.card,
      createdByRelease: PRODUCT_VERSION,
    };
    await saveSkillAndEvent(ctx.db, ctx.writer, next, "AnswerCommitted", reviewPayload);
    let plan = s.plan;
    const seconds = Math.max(1, Math.min(90, Math.round((Date.now() - session.shownAt) / 1000)));
    const introduced = new Set(plan.introducedStableIds);
    if (q.lane === "acquisition") introduced.add(q.stableId);
    plan = { ...plan, introducedStableIds: [...introduced], activeStudySeconds: (plan.activeStudySeconds ?? 0) + seconds };
    if ((plan.activeStudySeconds ?? 0) >= plan.targetSeconds) plan.acquisitionClosed = true;
    await savePlan(ctx.db, ctx.writer, plan);
  }
  await checkpointSession(session.index + 1);
  session.feedback = { rating, answer: q.answer, given };
  await renderQuestion();
}
async function finishDiagnostic() {
  if (!ctx || !session) return;
  await savePreferences(ctx.db, ctx.writer, { diagnosticCompleted: true });
  await commitEventOnly(ctx.db, ctx.writer, "DiagnosticCompleted", { sessionId: session.sessionId, answered: session.diagnostics.length, correct: session.diagnostics.filter((x) => x.correct).length });
}

function assertCurrentDataVersion(dataVersion: string) {
  if (!ctx) throw new Error("NO_CONTEXT");
  if (dataVersion !== ctx.bundle.manifest.dataVersion) throw new Error(`この版では dataVersion ${dataVersion} の自動移行は未対応です。現在版は ${ctx.bundle.manifest.dataVersion} です。`);
}
function datasetIdentity() {
  if (!ctx) throw new Error("NO_CONTEXT");
  return {
    dataVersion: ctx.bundle.manifest.dataVersion,
    registryCount: ctx.bundle.registry.length,
    coreCount: ctx.bundle.core.length,
    currentStableIds: new Set(ctx.bundle.registry.map((x) => x.stableId)),
  };
}
function bindSettings() {
  if (!ctx) return;
  document.querySelector("#settings-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const min = Number(document.querySelector<HTMLInputElement>("#daily-target")?.value ?? 20);
    const tz = document.querySelector<HTMLInputElement>("#time-zone")?.value || "Europe/London";
    const exam = document.querySelector<HTMLInputElement>("#exam-date")?.value || null;
    const accent = (document.querySelector<HTMLSelectElement>("#accent")?.value || "auto") as "auto" | "gb" | "us";
    const voiceURI = document.querySelector<HTMLSelectElement>("#voice")?.value || "";
    const theme = (document.querySelector<HTMLSelectElement>("#theme")?.value || "auto") as "auto" | "light" | "dark";
    if (min < 5 || min > 120) return alert("1日の目安は5〜120分です。");
    try { new Intl.DateTimeFormat("en", { timeZone: tz }).format(new Date()); } catch { return alert("タイムゾーンが不正です。"); }
    await savePreferences(ctx!.db, ctx!.writer, { dailyTargetSeconds: min * 60, learningTimeZone: tz, examDate: exam, accent, voiceURI, theme });
    applyTheme(theme);
    alert("保存しました。");
    await renderSettings();
  });
  document.querySelector("#export-data")?.addEventListener("click", async () => {
    const e = await exportEnvelope(ctx!.db, ctx!.bundle.manifest.dataVersion);
    download(`rikkyo-vocab-${Date.now()}.json`, JSON.stringify(e, null, 2));
  });
  document.querySelector("#browser-backup")?.addEventListener("click", async () => {
    await createBackup(ctx!.db, ctx!.bundle.manifest.dataVersion, "manual");
    await renderSettings();
  });
  document.querySelector<HTMLInputElement>("#import-data")?.addEventListener("change", async (ev) => {
    const f = (ev.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      await createBackup(ctx!.db, ctx!.bundle.manifest.dataVersion, "before-import");
      const e = await verifyEnvelope(JSON.parse(await f.text()));
      assertCurrentDataVersion(e.dataVersion);
      await replaceGeneration(ctx!.db, ctx!.writer, e, datasetIdentity(), "import");
      location.reload();
    } catch (err) { alert(err instanceof Error ? err.message : String(err)); }
  });
  document.querySelectorAll<HTMLButtonElement>(".restore-backup").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("このバックアップへ復元しますか？現在状態は先にバックアップします。")) return;
    try {
      await createBackup(ctx!.db, ctx!.bundle.manifest.dataVersion, "before-restore");
      const e = await loadBackup(b.dataset.id!);
      assertCurrentDataVersion(e.dataVersion);
      await replaceGeneration(ctx!.db, ctx!.writer, e, datasetIdentity(), "restore");
      location.reload();
    } catch (err) { alert(err instanceof Error ? err.message : String(err)); }
  }));
  document.querySelector("#reset-data")?.addEventListener("click", async () => {
    if (!confirm("学習履歴をリセットしますか？安全バックアップを作成してから新しい世代を開始します。")) return;
    try {
      await createBackup(ctx!.db, ctx!.bundle.manifest.dataVersion, "before-reset");
      await replaceGeneration(ctx!.db, ctx!.writer, null, datasetIdentity(), "reset");
      location.reload();
    } catch (err) { alert(err instanceof Error ? err.message : String(err)); }
  });
}

function applyTheme(theme: "auto" | "light" | "dark") {
  document.documentElement.dataset.theme = theme;
}

function populateVoices(prefs: Preferences) {
  const select = document.querySelector<HTMLSelectElement>("#voice");
  if (!select || !("speechSynthesis" in window)) return;
  const render = () => {
    const voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    select.innerHTML = `<option value="">端末の標準音声</option>${voices.map((v) => `<option value="${v.voiceURI.replaceAll('"', '&quot;')}" ${v.voiceURI === prefs.voiceURI ? "selected" : ""}>${v.name} (${v.lang})</option>`).join("")}`;
  };
  render();
  speechSynthesis.addEventListener("voiceschanged", render, { once: true });
}

async function recoverSession(initialEvents: DomainEvent[], generationId: string) {
  if (!ctx?.writable) return;
  const stored = await loadActiveSession(ctx.db);
  if (!stored) return;
  if (stored.generationId !== generationId) {
    await clearActiveSession(ctx.db, ctx.writer, "stale-generation");
    return;
  }
  let resumeIndex = stored.resumeIndex;
  while (resumeIndex < stored.queue.length && graded.has(stored.queue[resumeIndex]!.questionInstanceId)) resumeIndex += 1;
  if (resumeIndex >= stored.queue.length) {
    await clearActiveSession(ctx.db, ctx.writer, "completed-recovered");
    return;
  }
  const diagnosticEvents = initialEvents.filter((e) => e.type === "DiagnosticAnswer" && e.payload.sessionId === stored.sessionId);
  session = {
    generationId: stored.generationId,
    sessionId: stored.sessionId,
    startedAt: stored.startedAt,
    mode: stored.mode,
    queue: stored.queue,
    index: resumeIndex,
    shownAt: Date.now(),
    diagnostics: diagnosticEvents.map((e) => ({ correct: e.payload.correct === true })),
  };
  location.hash = stored.mode;
  await checkpointSession(resumeIndex, "SessionResumed");
}

async function boot() {
  const { bundle, gate } = await loadRuntimeBundle(import.meta.env.BASE_URL);
  if (!bundle || !gate.ok) {
    root.innerHTML = `<main class="hero"><h1>教材データを確認できません</h1><p>${gate.reasons.join(" / ")}</p></main>`;
    return;
  }
  const db = await openStudyDb();
  const writer = new SingleWriter(db, undefined, writerOwnerId());
  const writable = await writer.acquire();
  if (writable) writer.startHeartbeat();
  const generation = await ensureGeneration(db, bundle.manifest.dataVersion, bundle.registry.length, bundle.core.length);
  ctx = { bundle, db, writer, writable };
  const s = await loadRichState(db);
  for (const e of s.events) {
    const q = e.payload?.questionInstanceId;
    if (typeof q === "string") graded.add(q);
  }
  await recoverSession(s.events, generation.generationId);
  window.addEventListener("hashchange", () => void renderRoute());
  window.addEventListener("pagehide", () => { writer.close(); db.close(); }, { once: true });
  if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(console.error);
  await renderRoute();
}
void boot();
