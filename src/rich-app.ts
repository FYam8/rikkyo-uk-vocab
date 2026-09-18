import "./styles.css";
import "./rich/styles.css";
import { loadRuntimeBundle, type RuntimeBundle, type RuntimeEntity } from "./runtime";
import { openStudyDb, SingleWriter } from "./storage";
import { buildDiagnostic, provisionalFromDiagnostic } from "./rich/diagnostic";
import { applyStudyAnswer, buildQueue, createInitialState, dedupeStoredQuestionQueue, ensurePlan, gradeInput, learningDayId, makeQuestion, makeRetryQuestion, recordAcquisition, refreshStoredQuestion, retryGap, stateKey } from "./rich/planner";
import { clearActiveSession, commitEventOnly, createBackup, discardInvalidActiveSession, ensureGeneration, exportEnvelope, listBackups, loadActiveSession, loadBackup, loadRichState, repairStartupTransientState, replaceGeneration, saveActiveSession, savePlan, savePreferences, saveSkillAndEvent, verifyEnvelope } from "./rich/store";
import type { DailyPlanRecord, DomainEvent, Preferences, QuestionRun, SkillState, StoredSessionRecord, StudyMode } from "./rich/types";
import { analysisView, homeView, questionView, sessionResultView, settingsView, statsView, wordsView, type Route } from "./rich/views";
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
  baseTotal: number;
  correct: number;
  wrong: number;
  retryAnswered: number;
  missedStableIds: Set<string>;
}
let ctx: Ctx | null = null;
let session: Session | null = null;
let wordQuery = "";
let wordFilter = "all";
let activePreferences: Preferences | null = null;
const graded = new Set<string>();
const WRITER_OWNER_KEY = "rikkyo-uk-vocab:writer-owner:v3";

function writerOwnerId(): string {
  try {
    const current = sessionStorage.getItem(WRITER_OWNER_KEY);
    if (current) return current;
    const created = crypto.randomUUID();
    sessionStorage.setItem(WRITER_OWNER_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

async function ensureWritable(): Promise<boolean> {
  if (!ctx) return false;
  try {
    if (ctx.writable && await ctx.writer.heartbeat()) return true;
    ctx.writable = false;
    if (!await ctx.writer.acquire()) await ctx.writer.takeOver();
    ctx.writable = true;
    ctx.writer.startHeartbeat();
    return true;
  } catch (error) {
    console.error("Writer handoff failed", error);
    return false;
  }
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
function audioQuestionsEnabled(preferences: Preferences): boolean {
  if (preferences.audioQuestions === "off") return false;
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
  return true;
}
function removeAudioRequirement(q: QuestionRun): QuestionRun {
  if (q.kind === "audioChoice") return { ...q, kind: "meaningChoice" };
  if (q.kind === "audioInput") return { ...q, kind: "input" };
  return q;
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
    baseTotal: session.baseTotal,
    correct: session.correct,
    wrong: session.wrong,
    retryAnswered: session.retryAnswered,
    missedStableIds: [...session.missedStableIds],
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
  const mode = document.querySelector<HTMLSelectElement>("#study-mode"), size = document.querySelector<HTMLSelectElement>("#session-size");
  mode?.addEventListener("change", () => void (async () => {
    if (await ensureWritable()) await savePreferences(ctx!.db, ctx!.writer, { studyMode: mode.value as StudyMode });
  })());
  size?.addEventListener("change", () => void (async () => {
    if (await ensureWritable()) await savePreferences(ctx!.db, ctx!.writer, { sessionSize: Number(size.value) });
  })());
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
  if (!await ensureWritable() || !ctx) return;
  const s = await state();
  const plan = effectivePlan(s.plan, s.preferences, s.memory);
  const requested = s.preferences.sessionSize ?? 20;
  const studyMode = s.preferences.studyMode ?? "recommended";
  const items = buildQueue(ctx.bundle, s.memory, plan, new Date(), requested === 0 ? 60 : requested, { mode: studyMode });
  if (!items.length) return alert("現在出題できる項目はありません。");
  const now = new Date().toISOString();
  const allowAudio = audioQuestionsEnabled(s.preferences);
  session = { generationId: s.generation.generationId, sessionId: crypto.randomUUID(), startedAt: now, mode: "study", queue: items.map((x) => makeQuestion(ctx!.bundle, x, { allowAudio, intensity: studyMode === "exam" ? "exam" : "adaptive" })), index: 0, shownAt: Date.now(), diagnostics: [], baseTotal: items.length, correct: 0, wrong: 0, retryAnswered: 0, missedStableIds: new Set() };
  await checkpointSession(0, "SessionStarted");
  location.hash = "study";
  await renderQuestion();
}
async function startDiagnostic() {
  if (!await ensureWritable() || !ctx) return;
  const s = await state();
  const questions = buildDiagnostic(ctx.bundle);
  const now = new Date().toISOString();
  session = { generationId: s.generation.generationId, sessionId: crypto.randomUUID(), startedAt: now, mode: "diagnostic", queue: questions, index: 0, shownAt: Date.now(), diagnostics: [], baseTotal: questions.length, correct: 0, wrong: 0, retryAnswered: 0, missedStableIds: new Set() };
  await checkpointSession(0, "SessionStarted");
  location.hash = "diagnostic";
  await renderQuestion();
}
async function renderQuestion() {
  if (!ctx || !session) return;
  if (session.index >= session.queue.length) {
    if (session.mode === "diagnostic") await finishDiagnostic();
    const completed = session;
    await clearActiveSession(ctx.db, ctx.writer, "completed");
    session = null;
    root.innerHTML = sessionResultView({ mode: completed.mode, baseTotal: completed.baseTotal, correct: completed.correct, wrong: completed.wrong, retryAnswered: completed.retryAnswered, missed: [...completed.missedStableIds].map((id) => entity(id)) });
    document.querySelector("#result-home")?.addEventListener("click", () => { location.hash = "home"; });
    document.querySelector("#result-retry")?.addEventListener("click", () => void startStudy());
    return;
  }
  const q = session.queue[session.index]!;
  const e = entity(q.stableId);
  const answeredPrefix = session.queue.slice(0, session.index);
  const baseBefore = answeredPrefix.filter((question) => !question.isRetry).length;
  const baseAnswered = baseBefore + (session.feedback && !q.isRetry ? 1 : 0);
  const basePosition = Math.min(session.baseTotal, baseBefore + (q.isRetry ? 0 : 1));
  root.innerHTML = questionView(q, e, session.mode, { correct: session.correct, wrong: session.wrong, basePosition, baseAnswered, baseTotal: session.baseTotal, retryAnswered: session.retryAnswered }, session.feedback);
  document.querySelector("#speak-word")?.addEventListener("click", () => speak(e.lemma));
  document.querySelector("#audio-fallback")?.addEventListener("click", () => void (async () => {
    if (!session || !await ensureWritable()) return;
    session.queue[session.index] = removeAudioRequirement(q);
    await checkpointSession(session.index, "AudioQuestionSkipped");
    await renderQuestion();
  })());
  document.querySelector("#stop-session")?.addEventListener("click", () => void (async () => {
    if (!ctx || !await ensureWritable()) return;
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
  if (!ctx || !session || !await ensureWritable()) return;
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
    if (q.lane === "acquisition") plan = recordAcquisition(plan, q.stableId, q.skillKey);
    plan = { ...plan, activeStudySeconds: (plan.activeStudySeconds ?? 0) + seconds };
    if ((plan.activeStudySeconds ?? 0) >= plan.targetSeconds) plan.acquisitionClosed = true;
    await savePlan(ctx.db, ctx.writer, plan);
  }
  if (correct) session.correct += 1;
  else {
    session.wrong += 1;
    session.missedStableIds.add(q.stableId);
    if (session.mode === "study" && !q.isRetry && !session.queue.slice(session.index + 1).some((question) => question.isRetry && question.stableId === q.stableId)) {
      const retry = makeRetryQuestion(ctx.bundle, q, entity(q.stableId));
      session.queue.splice(Math.min(session.index + retryGap(entity(q.stableId)) + 1, session.queue.length), 0, retry);
    }
  }
  if (q.isRetry) session.retryAnswered += 1;
  await checkpointSession(session.index + 1);
  session.feedback = { rating, answer: q.answer, given };
  await renderQuestion();
}
async function finishDiagnostic() {
  if (!ctx || !session || !await ensureWritable()) return;
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
  document.querySelector("#voice-test")?.addEventListener("click", () => speak("vocabulary"));
  document.querySelector("#settings-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!await ensureWritable()) return;
    const min = Number(document.querySelector<HTMLInputElement>("#daily-target")?.value ?? 20);
    const tz = document.querySelector<HTMLInputElement>("#time-zone")?.value || "Europe/London";
    const exam = document.querySelector<HTMLInputElement>("#exam-date")?.value || null;
    const accent = (document.querySelector<HTMLSelectElement>("#accent")?.value || "auto") as "auto" | "gb" | "us";
    const voiceURI = document.querySelector<HTMLSelectElement>("#voice")?.value || "";
    const audioQuestions = (document.querySelector<HTMLSelectElement>("#audio-questions")?.value || "auto") as "auto" | "on" | "off";
    const theme = (document.querySelector<HTMLSelectElement>("#theme")?.value || "auto") as "auto" | "light" | "dark";
    if (min < 5 || min > 120) return alert("1日の目安は5〜120分です。");
    try { new Intl.DateTimeFormat("en", { timeZone: tz }).format(new Date()); } catch { return alert("タイムゾーンが不正です。"); }
    await savePreferences(ctx!.db, ctx!.writer, { dailyTargetSeconds: min * 60, learningTimeZone: tz, examDate: exam, accent, voiceURI, theme, audioQuestions });
    applyTheme(theme);
    alert("保存しました。");
    await renderSettings();
  });
  document.querySelector("#export-data")?.addEventListener("click", async () => {
    const e = await exportEnvelope(ctx!.db, ctx!.bundle.manifest.dataVersion);
    download(`rikkyo-vocab-${Date.now()}.json`, JSON.stringify(e, null, 2));
  });
  document.querySelector("#browser-backup")?.addEventListener("click", async () => {
    if (!await ensureWritable()) return;
    await createBackup(ctx!.db, ctx!.bundle.manifest.dataVersion, "manual");
    await renderSettings();
  });
  document.querySelector<HTMLInputElement>("#import-data")?.addEventListener("change", async (ev) => {
    const f = (ev.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      if (!await ensureWritable()) return;
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
      if (!await ensureWritable()) return;
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
      if (!await ensureWritable()) return;
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

async function recoverSession(initialEvents: DomainEvent[], generationId: string, preferences: Preferences) {
  if (!ctx?.writable) return;
  const stored = await loadActiveSession(ctx.db);
  if (!stored) return;
  const validModes = new Set(["study", "diagnostic"]);
  const validSkills = new Set(["meaningRecognition", "formProduction"]);
  const currentIds = new Set(ctx.bundle.core.map((item) => item.stableId));
  const queueIsValid = Array.isArray(stored.queue) && stored.queue.length > 0 && stored.queue.every((question) =>
    question && typeof question.questionInstanceId === "string" && currentIds.has(question.stableId) && validSkills.has(question.skillKey),
  );
  if (!validModes.has(stored.mode) || !queueIsValid || !Number.isInteger(stored.resumeIndex) || stored.resumeIndex < 0) {
    await discardInvalidActiveSession(ctx.db);
    location.hash = "home";
    return;
  }
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
  const refreshedQueue = stored.queue.map((question, index) => index < resumeIndex ? question : refreshStoredQuestion(ctx!.bundle, question, stored.mode));
  const dedupedQueue = dedupeStoredQuestionQueue(refreshedQueue, resumeIndex);
  const diagnosticEvents = initialEvents.filter((e) => e.type === "DiagnosticAnswer" && e.payload.sessionId === stored.sessionId);
  session = {
    generationId: stored.generationId,
    sessionId: stored.sessionId,
    startedAt: stored.startedAt,
    mode: stored.mode,
    queue: audioQuestionsEnabled(preferences) ? dedupedQueue : dedupedQueue.map(removeAudioRequirement),
    index: resumeIndex,
    shownAt: Date.now(),
    diagnostics: diagnosticEvents.map((e) => ({ correct: e.payload.correct === true })),
    baseTotal: dedupedQueue.filter((q) => !q.isRetry).length,
    correct: stored.correct ?? 0,
    wrong: stored.wrong ?? 0,
    retryAnswered: stored.retryAnswered ?? 0,
    missedStableIds: new Set(stored.missedStableIds ?? []),
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
  writer.onSuperseded(() => {
    if (!ctx || ctx.writer !== writer) return;
    ctx.writable = false;
  });
  let writable = await writer.acquire();
  if (!writable && document.visibilityState === "visible") {
    await writer.takeOver();
    writable = true;
  }
  if (writable) writer.startHeartbeat();
  const generation = await ensureGeneration(db, bundle.manifest.dataVersion, bundle.registry.length, bundle.core.length);
  ctx = { bundle, db, writer, writable };
  const s = await loadRichState(db);
  for (const e of s.events) {
    const q = e.payload?.questionInstanceId;
    if (typeof q === "string") graded.add(q);
  }
  activePreferences = s.preferences ?? null;
  if (!s.preferences) throw new Error("PREFERENCES_RECOVERY_FAILED");
  await recoverSession(s.events, generation.generationId, s.preferences);
  window.addEventListener("hashchange", () => void renderRoute());
  window.addEventListener("pagehide", () => { writer.close(); db.close(); }, { once: true });
  if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(console.error);
  await renderRoute();
}
async function repairAndReload() {
  try {
    ctx?.writer.close();
    ctx?.db.close();
    ctx = null;
    const db = await openStudyDb();
    await repairStartupTransientState(db);
    db.close();
    const url = new URL(location.href);
    url.searchParams.set("startupRepair", PRODUCT_VERSION);
    location.replace(url);
  } catch (error) {
    console.error("Startup repair failed", error);
    location.reload();
  }
}

void boot().catch((error) => {
  console.error("Application startup failed", error);
  const alreadyRepaired = new URL(location.href).searchParams.get("startupRepair") === PRODUCT_VERSION;
  if (!alreadyRepaired) {
    root.innerHTML = `<main class="hero"><h1>一時状態を修復しています</h1><p>学習履歴を保持したまま再起動します。</p></main>`;
    void repairAndReload();
    return;
  }
  root.innerHTML = `<main class="hero"><h1>起動できませんでした</h1><p>学習履歴は消去されていません。端末内の一時状態を安全に修復して再起動できます。</p><button class="primary" id="retry-startup">安全に修復して再起動</button></main>`;
  document.querySelector("#retry-startup")?.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.delete("startupRepair");
    history.replaceState(null, "", url);
    void repairAndReload();
  });
});
