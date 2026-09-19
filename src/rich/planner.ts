import { hydrateCard, Rating, newCard, schedule } from "../fsrsAdapter";
import { SCHEDULER_CONFIG } from "../config";
import type { RuntimeBundle, RuntimeEntity } from "../runtime";
import type { DailyPlanRecord, Lane, QuestionKind, QuestionRun, ScheduleFilter, SkillKey, SkillState, StudyMode } from "./types";
import { VOCABULARY_SESSION_ENGINE } from "../common-engine/session-orchestration";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// A miss still gets one in-session retry. Outside that session, only missed
// material may return after 10 minutes; a correct answer waits until tomorrow.
const LEARNING_STEPS = [10 * MINUTE, DAY];
const RELEARNING_STEPS = [10 * MINUTE, DAY];

export function stateKey(stableId: string, skillKey: SkillKey): string { return `skill:${stableId}:${skillKey}`; }
export function learningDayId(at = new Date(), timeZone = "Europe/London"): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(at);
}
function priority(entity: RuntimeEntity): number { return entity.priority === "S" ? 0 : entity.priority === "A" ? 1 : entity.priority === "B" ? 2 : 3; }
function stableNumber(text: string): number { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function skillsFor(entity: RuntimeEntity): SkillKey[] { return entity.quizEligible === false ? [] : entity.capabilities.includes("spelling") ? ["meaningRecognition", "formProduction"] : ["meaningRecognition"]; }

export function ensurePlan(generationId: string, targetSeconds: number, existing?: DailyPlanRecord, timeZone = "Europe/London", now = new Date()): DailyPlanRecord {
  const day = learningDayId(now, timeZone);
  if (existing?.learningDayId === day && existing.generationId === generationId) return {
    ...existing,
    targetSeconds: Number.isFinite(existing.targetSeconds) ? existing.targetSeconds : targetSeconds,
    acquisitionCap: Number.isFinite(existing.acquisitionCap) ? existing.acquisitionCap : 12,
    newEntityCap: Number.isFinite(existing.newEntityCap) ? existing.newEntityCap : 12,
    acquisitionBudget: Number.isFinite(existing.acquisitionBudget) ? existing.acquisitionBudget : 12,
    acquisitionUsed: Number.isFinite(existing.acquisitionUsed) ? existing.acquisitionUsed : 0,
    introducedStableIds: Array.isArray(existing.introducedStableIds) ? existing.introducedStableIds : [],
    introducedSkillKeys: Array.isArray(existing.introducedSkillKeys) ? existing.introducedSkillKeys : [],
    acquisitionClosed: existing.acquisitionClosed === true,
    activeStudySeconds: Number.isFinite(existing.activeStudySeconds) ? existing.activeStudySeconds : 0,
  };
  return {
    key: `plan:${generationId}:${day}`,
    generationId,
    learningDayId: day,
    createdAt: now.toISOString(),
    targetSeconds,
    acquisitionCap: 12,
    newEntityCap: 12,
    acquisitionBudget: 12,
    acquisitionUsed: 0,
    introducedStableIds: [],
    introducedSkillKeys: [],
    acquisitionClosed: false,
    activeStudySeconds: 0,
    lastAppliedRevision: 0,
  };
}

export function recordAcquisition(plan: DailyPlanRecord, stableId: string, skillKey: SkillKey): DailyPlanRecord {
  const introduced = new Set(plan.introducedStableIds);
  const introducedSkills = new Set(plan.introducedSkillKeys ?? []);
  const skillToken = stateKey(stableId, skillKey);
  const isNewSkill = !introducedSkills.has(skillToken);
  introduced.add(stableId);
  introducedSkills.add(skillToken);
  return {
    ...plan,
    introducedStableIds: [...introduced],
    introducedSkillKeys: [...introducedSkills],
    acquisitionUsed: (plan.acquisitionUsed ?? 0) + (isNewSkill ? 1 : 0),
  };
}

export interface PlannedItem { entity: RuntimeEntity; skillKey: SkillKey; lane: Lane; state?: SkillState; }
export interface QuestionOptions { allowAudio?: boolean; intensity?: "adaptive" | "exam"; }
export interface StudyOptions { mode?: StudyMode; schedule?: ScheduleFilter; additionalNew?: boolean; }
function skillStrength(item: PlannedItem): number {
  return (item.state?.correct ?? 0) - (item.state?.wrong ?? 0);
}
function uniquePlannedEntities(items: PlannedItem[]): PlannedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.entity.stableId)) return false;
    seen.add(item.entity.stableId);
    return true;
  });
}
function matchesEntity(entity: RuntimeEntity, mode: StudyMode): boolean {
  if (entity.quizEligible === false || entity.studyLayer === "reference") return false;
  if (mode === "foundation") return entity.targetBand === "Foundation";
  if (mode === "core") return entity.targetBand === "Core";
  if (mode === "challenge") return entity.targetBand === "Challenge";
  if (mode === "frequent") return entity.observedFrequency >= 3 || entity.priority === "S";
  return true;
}
export function buildQueue(bundle: RuntimeBundle, memory: SkillState[], plan: DailyPlanRecord, now = new Date(), limit = 60, options: StudyOptions = {}): PlannedItem[] {
  const mode = options.mode ?? "recommended";
  const explicitBandFocus = options.additionalNew === true || mode === "foundation" || mode === "core" || mode === "challenge";
  const byKey = new Map(memory.map((x) => [x.key, x]));
  const nowMs = now.getTime();
  const items: PlannedItem[] = [];
  for (const entity of bundle.core.filter((x) => matchesEntity(x, mode))) for (const skillKey of skillsFor(entity)) {
    if (options.additionalNew) continue;
    const state = byKey.get(stateKey(entity.stableId, skillKey));
    if (mode === "unlearned") continue;
    if (mode === "weak" && !(state && state.wrong > state.correct)) continue;
    if (state?.stage === "learning" && Date.parse(state.dueAt) <= nowMs) items.push({ entity, skillKey, lane: "learning", state });
    else if (state?.stage === "relearning" && Date.parse(state.dueAt) <= nowMs) items.push({ entity, skillKey, lane: "relearning", state });
    else if (state?.stage === "provisional" && Date.parse(state.dueAt) <= nowMs) items.push({ entity, skillKey, lane: "provisional", state });
    else if (state?.stage === "review" && Date.parse(state.dueAt) <= nowMs) items.push({ entity, skillKey, lane: "review", state });
  }
  const laneRank: Record<Lane, number> = { learning: 0, relearning: 1, provisional: 2, review: 3, acquisition: 4 };
  items.sort((a, b) => laneRank[a.lane] - laneRank[b.lane] || Date.parse(a.state?.dueAt ?? "0") - Date.parse(b.state?.dueAt ?? "0") || skillStrength(a) - skillStrength(b) || priority(a.entity) - priority(b.entity) || stableNumber(a.entity.stableId) - stableNumber(b.entity.stableId));
  const uniqueItems = uniquePlannedEntities(items);
  items.length = 0;
  items.push(...uniqueItems);

  // The daily acquisition cap governs automatic study. An explicitly selected
  // band is intentional extra study, so it must not become an empty session
  // merely because today's automatic introduction budget has been consumed.
  if ((!plan.acquisitionClosed || explicitBandFocus) && items.length < limit && mode !== "weak" && mode !== "review") {
    const introduced = new Set(plan.introducedStableIds);
    const introducedSkills = new Set(plan.introducedSkillKeys ?? []);
    const activeEntities = new Set(memory.filter((x) => x.stage !== "provisional" && x.stage !== "acquisitionCandidate").map((x) => x.stableId));
    const newEntityCap = plan.newEntityCap ?? 12;
    const storedBudget = plan.acquisitionBudget ?? plan.acquisitionCap;
    const budgetLimit = Math.min(storedBudget, plan.acquisitionCap);
    let remainingBudget = explicitBandFocus ? limit - items.length : Math.max(0, budgetLimit - (plan.acquisitionUsed ?? 0));
    const queuedIds = new Set(items.map((item) => item.entity.stableId));
    const candidates = bundle.core
      .filter((e) => !options.additionalNew || !memory.some((s) => s.stableId === e.stableId))
      .filter((e) => !queuedIds.has(e.stableId) && !introduced.has(e.stableId) && matchesEntity(e, mode) && skillsFor(e).some((s) => {
        const existing = byKey.get(stateKey(e.stableId, s));
        return !existing || existing.stage === "acquisitionCandidate";
      }))
      .sort((a, b) => mode === "random"
        ? stableNumber(`${plan.learningDayId}:random:${a.stableId}`) - stableNumber(`${plan.learningDayId}:random:${b.stableId}`)
        : priority(a) - priority(b) || b.observedFrequency - a.observedFrequency || stableNumber(`${plan.learningDayId}:${a.stableId}`) - stableNumber(`${plan.learningDayId}:${b.stableId}`));

    for (const entity of candidates) {
      if (items.length >= limit || remainingBudget <= 0) break;
      // Waseda-parity progression: every unseen entity starts with objective
      // English -> Japanese recognition before production is introduced.
      const orderedSkills = skillsFor(entity);
      const skillKey = orderedSkills.find((s) => {
        const existing = byKey.get(stateKey(entity.stableId, s));
        return !existing || existing.stage === "acquisitionCandidate";
      });
      if (!skillKey) continue;
      const skillToken = stateKey(entity.stableId, skillKey);
      if (introducedSkills.has(skillToken)) continue;
      const isNewEntity = !activeEntities.has(entity.stableId);
      if (!explicitBandFocus && isNewEntity && !introduced.has(entity.stableId) && introduced.size >= newEntityCap) continue;
      const state = byKey.get(skillToken);
      items.push({ entity, skillKey, lane: "acquisition", ...(state ? { state } : {}) });
      queuedIds.add(entity.stableId);
      remainingBudget -= 1;
      introducedSkills.add(skillToken);
      if (isNewEntity) introduced.add(entity.stableId);
    }
  }
  return VOCABULARY_SESSION_ENGINE.take(items, limit);
}

export function createInitialState(generationId: string, stableId: string, skillKey: SkillKey, now = new Date()): SkillState {
  return { key: stateKey(stableId, skillKey), stableId, skillKey, generationId, stage: "learning", card: null, stepIndex: 0, dueAt: now.toISOString(), correct: 0, wrong: 0, lapses: 0, episodeId: crypto.randomUUID(), provisionalUntil: null, lastSeenAt: null, lastAppliedRevision: 0, schedulerMetadata: SCHEDULER_CONFIG };
}

export function applyStudyAnswer(previous: SkillState, rating: "Again" | "Hard" | "Good", now = new Date()): SkillState {
  previous = { ...previous, card: hydrateCard(previous.card), schedulerMetadata: previous.schedulerMetadata ?? SCHEDULER_CONFIG };
  const correct = rating !== "Again";
  const next: SkillState = { ...previous, correct: previous.correct + (correct ? 1 : 0), wrong: previous.wrong + (correct ? 0 : 1), lastSeenAt: now.toISOString() };
  if (previous.stage === "provisional") {
    if (!correct) return { ...next, stage: "acquisitionCandidate", stepIndex: 0, card: null, episodeId: null, dueAt: now.toISOString(), provisionalUntil: null };
    const card = schedule(newCard(now), Rating.Good, now);
    return { ...next, stage: "review", card, stepIndex: 0, dueAt: card.due.toISOString(), episodeId: null, provisionalUntil: null };
  }
  if (previous.stage === "acquisitionCandidate") {
    const stage: SkillState = { ...next, stage: "learning", stepIndex: 0, card: null, episodeId: crypto.randomUUID(), provisionalUntil: null, dueAt: now.toISOString() };
    if (!correct) return { ...stage, dueAt: new Date(now.getTime() + LEARNING_STEPS[0]!).toISOString() };
    return { ...stage, stepIndex: 1, dueAt: new Date(now.getTime() + LEARNING_STEPS[1]!).toISOString() };
  }
  if (previous.stage === "review") {
    const card = schedule(previous.card ?? newCard(now), rating === "Again" ? Rating.Again : rating === "Hard" ? Rating.Hard : Rating.Good, now);
    if (rating === "Again") return { ...next, stage: "relearning", card, stepIndex: 0, lapses: previous.lapses + 1, episodeId: crypto.randomUUID(), dueAt: new Date(now.getTime() + RELEARNING_STEPS[0]!).toISOString() };
    return { ...next, card, dueAt: card.due.toISOString() };
  }
  const steps = previous.stage === "relearning" ? RELEARNING_STEPS : LEARNING_STEPS;
  if (!correct) return { ...next, stepIndex: 0, dueAt: new Date(now.getTime() + steps[0]!).toISOString() };
  const stepIndex = previous.stepIndex + 1;
  if (stepIndex < steps.length) return { ...next, stepIndex, dueAt: new Date(now.getTime() + steps[stepIndex]!).toISOString() };
  if (previous.stage === "relearning") {
    const card = previous.card ?? schedule(newCard(now), Rating.Again, now);
    return { ...next, stage: "review", card, stepIndex: 0, dueAt: card.due.toISOString(), episodeId: null };
  }
  const card = schedule(newCard(now), Rating.Good, now);
  return { ...next, stage: "review", card, stepIndex: 0, dueAt: card.due.toISOString(), episodeId: null };
}

function distractors(bundle: RuntimeBundle, entity: RuntimeEntity): string[] {
  const answer = entity.senses[0]?.glossJa ?? "";
  const ranked = bundle.core.filter((x) => x.stableId !== entity.stableId).sort((a, b) => {
    const score = (x: RuntimeEntity) => (x.pos === entity.pos ? 0 : 4) + (x.targetBand === entity.targetBand ? 0 : 2) + Math.min(3, Math.abs((x.senses[0]?.glossJa.length ?? 0) - answer.length) / 4);
    return score(a) - score(b) || stableNumber(`${entity.stableId}:${a.stableId}`) - stableNumber(`${entity.stableId}:${b.stableId}`);
  });
  const pool = ranked.map((x) => x.senses[0]?.glossJa ?? "").filter((x, i, a) => x && x !== answer && a.indexOf(x) === i);
  return pool.slice(0, 3);
}
function lemmaDistractors(bundle: RuntimeBundle, entity: RuntimeEntity): string[] {
  return bundle.core.filter((x) => x.stableId !== entity.stableId)
    .sort((a, b) => (a.pos === entity.pos ? 0 : 1) - (b.pos === entity.pos ? 0 : 1) || (a.targetBand === entity.targetBand ? 0 : 1) - (b.targetBand === entity.targetBand ? 0 : 1) || stableNumber(`${entity.stableId}:lemma:${a.stableId}`) - stableNumber(`${entity.stableId}:lemma:${b.stableId}`))
    .map((x) => x.lemma).filter((x, i, a) => x && a.indexOf(x) === i)
    .slice(0, 3);
}
function sourceLabel(entity: RuntimeEntity): string | undefined {
  return entity.sourceExample
    ? `FY${String(entity.sourceExample.year).slice(-2)} ${entity.sourceExample.schedule} · PDF p.${entity.sourceExample.page}`
    : entity.generatedExample
      ? "立教傾向から生成"
      : undefined;
}
function questionKind(item: PlannedItem, options: QuestionOptions): QuestionKind {
  const allowAudio = options.allowAudio !== false;
  const strength = Math.max(0, (item.state?.correct ?? 0) - (item.state?.wrong ?? 0));
  const roll = stableNumber(`${item.entity.stableId}:${item.skillKey}:${item.state?.correct ?? 0}:${item.state?.wrong ?? 0}`) % 100;
  // New material is always introduced objectively. Recognition comes first in
  // buildQueue; production then starts with Japanese -> English four-choice.
  if (item.lane === "acquisition") return item.skillKey === "meaningRecognition" ? "meaningChoice" : "reverseChoice";
  if (options.intensity === "exam") {
    if (item.skillKey === "formProduction") return item.entity.cloze && roll < 60 ? "clozeInput" : "input";
    return item.entity.cloze && roll < 72 ? "clozeChoice" : "meaningChoice";
  }
  if (item.skillKey === "meaningRecognition") {
    if (item.entity.cloze && roll < (strength >= 2 ? 68 : 45)) return "clozeChoice";
    if (allowAudio && strength >= 2 && roll >= 82) return "audioChoice";
    return "meaningChoice";
  }
  if (item.entity.cloze && strength >= 1 && roll < 45) return "clozeInput";
  if (allowAudio && strength >= 2 && roll >= 85) return "audioInput";
  return strength === 0 && roll < 45 ? "reverseChoice" : "input";
}
export function makeQuestion(bundle: RuntimeBundle, item: PlannedItem, options: QuestionOptions = {}): QuestionRun {
  const meaning = item.entity.senses[0]?.glossJa ?? "";
  const id = crypto.randomUUID();
  const kind = questionKind(item, options);
  const currentSourceLabel = sourceLabel(item.entity);
  if (kind === "input" || kind === "audioInput") return { questionInstanceId: id, stableId: item.entity.stableId, skillKey: item.skillKey, lane: item.lane, kind, prompt: meaning, choices: [], answer: item.entity.lemma, ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}) };
  if (kind === "clozeInput" && item.entity.cloze) return { questionInstanceId: id, stableId: item.entity.stableId, skillKey: item.skillKey, lane: item.lane, kind, prompt: "空所に入る語句を入力してください", context: item.entity.cloze.sentence, choices: [], answer: item.entity.lemma, ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}) };
  if (kind === "reverseChoice") {
    const choices = [item.entity.lemma, ...lemmaDistractors(bundle, item.entity)].sort((a, b) => stableNumber(`${id}:${a}`) - stableNumber(`${id}:${b}`));
    return { questionInstanceId: id, stableId: item.entity.stableId, skillKey: item.skillKey, lane: item.lane, kind, prompt: meaning, choices, answer: item.entity.lemma, ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}) };
  }
  if (kind === "clozeChoice" && item.entity.cloze) {
    const choices = [item.entity.lemma, ...lemmaDistractors(bundle, item.entity)].sort((a, b) => stableNumber(`${id}:${a}`) - stableNumber(`${id}:${b}`));
    return { questionInstanceId: id, stableId: item.entity.stableId, skillKey: item.skillKey, lane: item.lane, kind, prompt: "空所に入る語句を選んでください", context: item.entity.cloze.sentence, choices, answer: item.entity.lemma, ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}) };
  }
  const choices = [meaning, ...distractors(bundle, item.entity)].sort((a, b) => stableNumber(`${id}:${a}`) - stableNumber(`${id}:${b}`));
  return { questionInstanceId: id, stableId: item.entity.stableId, skillKey: item.skillKey, lane: item.lane, kind, prompt: item.entity.lemma, choices, answer: meaning, ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}) };
}

/** Rehydrates a persisted, unanswered question from the current corpus without changing its identity. */
export function refreshStoredQuestion(bundle: RuntimeBundle, question: QuestionRun, mode: "study" | "diagnostic" = "study"): QuestionRun {
  const entity = bundle.core.find((item) => item.stableId === question.stableId);
  if (!entity) return question;
  const { context: _oldContext, sourceLabel: _oldSourceLabel, ...base } = question;
  const currentSourceLabel = sourceLabel(entity);
  const withSource = <T extends QuestionRun>(next: T): T => ({
    ...next,
    ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}),
  });
  const meaning = entity.senses[0]?.glossJa ?? "";
  const lemmaChoices = () => [entity.lemma, ...lemmaDistractors(bundle, entity)]
    .sort((a, b) => stableNumber(`${question.questionInstanceId}:${a}`) - stableNumber(`${question.questionInstanceId}:${b}`));
  const meaningChoices = () => [meaning, ...distractors(bundle, entity)]
    .sort((a, b) => stableNumber(`${question.questionInstanceId}:${a}`) - stableNumber(`${question.questionInstanceId}:${b}`));

  if (question.lane === "acquisition") {
    if (mode === "diagnostic" && question.skillKey === "formProduction") {
      return withSource({ ...base, kind: "input", prompt: meaning, choices: [], answer: entity.lemma });
    }
    return question.skillKey === "meaningRecognition"
      ? withSource({ ...base, kind: "meaningChoice", prompt: entity.lemma, choices: meaningChoices(), answer: meaning })
      : withSource({ ...base, kind: "reverseChoice", prompt: meaning, choices: lemmaChoices(), answer: entity.lemma });
  }

  if ((question.kind === "clozeInput" || question.kind === "clozeChoice") && entity.cloze) {
    return withSource({
      ...base,
      prompt: question.kind === "clozeInput" ? "空所に入る語句を入力してください" : "空所に入る語句を選んでください",
      context: entity.cloze.sentence,
      choices: question.kind === "clozeInput" ? [] : lemmaChoices(),
      answer: entity.lemma,
    });
  }
  if (question.kind === "input" || question.kind === "audioInput" || question.kind === "clozeInput") {
    return withSource({ ...base, kind: question.kind === "clozeInput" ? "input" : question.kind, prompt: meaning, choices: [], answer: entity.lemma });
  }
  if (question.kind === "reverseChoice") {
    return withSource({ ...base, prompt: meaning, choices: lemmaChoices(), answer: entity.lemma });
  }
  return withSource({ ...base, kind: question.kind === "clozeChoice" ? "meaningChoice" : question.kind, prompt: entity.lemma, choices: meaningChoices(), answer: meaning });
}

/** Keeps answered positions stable while limiting remaining base and retry questions to one per word. */
export function dedupeStoredQuestionQueue(queue: QuestionRun[], resumeIndex: number): QuestionRun[] {
  const prefix = queue.slice(0, resumeIndex);
  const seenBase = new Set(prefix.filter((question) => !question.isRetry).map((question) => question.stableId));
  const seenRetry = new Set(prefix.filter((question) => question.isRetry).map((question) => question.stableId));
  const remaining = queue.slice(resumeIndex).filter((question) => {
    const seen = question.isRetry ? seenRetry : seenBase;
    if (seen.has(question.stableId)) return false;
    seen.add(question.stableId);
    return true;
  });
  return [...prefix, ...remaining];
}

export function retryGap(entity: RuntimeEntity): 6 | 8 { return entity.priority === "S" || entity.targetBand === "Foundation" ? 6 : 8; }
export function makeRetryQuestion(bundle: RuntimeBundle, original: QuestionRun, entity: RuntimeEntity): QuestionRun {
  const questionInstanceId = crypto.randomUUID();
  const { context: _context, ...base } = original;
  if (original.skillKey === "formProduction") {
    const choices = [entity.lemma, ...lemmaDistractors(bundle, entity)].sort((a, b) => stableNumber(`${questionInstanceId}:${a}`) - stableNumber(`${questionInstanceId}:${b}`));
    return { ...base, questionInstanceId, kind: "reverseChoice", prompt: entity.senses[0]?.glossJa ?? "", choices, answer: entity.lemma, isRetry: true, retryOf: original.questionInstanceId };
  }
  const answer = entity.senses[0]?.glossJa ?? "";
  const choices = [answer, ...distractors(bundle, entity)].sort((a, b) => stableNumber(`${questionInstanceId}:${a}`) - stableNumber(`${questionInstanceId}:${b}`));
  return { ...base, questionInstanceId, kind: "meaningChoice", prompt: entity.lemma, choices, answer, isRetry: true, retryOf: original.questionInstanceId };
}

export function normalizeAnswer(value: string): string { return value.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " "); }
export function gradeInput(given: string, answer: string): "Good" | "Hard" | "Again" {
  const a = normalizeAnswer(given), b = normalizeAnswer(answer);
  if (a === b) return "Good";
  if (a && (b.startsWith(a) || a.startsWith(b)) && Math.abs(a.length - b.length) <= 2) return "Hard";
  return "Again";
}
