import { hydrateCard, Rating, newCard, schedule } from "../fsrsAdapter";
import { SCHEDULER_CONFIG } from "../config";
import type { RuntimeBundle, RuntimeEntity } from "../runtime";
import type { DailyPlanRecord, Lane, QuestionRun, SkillKey, SkillState } from "./types";
import { VOCABULARY_SESSION_ENGINE } from "../common-engine/session-orchestration";

const MINUTE = 60_000;
const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];
const RELEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];

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
  if (existing?.learningDayId === day && existing.generationId === generationId) return existing;
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

export interface PlannedItem { entity: RuntimeEntity; skillKey: SkillKey; lane: Lane; state?: SkillState; }
export function buildQueue(bundle: RuntimeBundle, memory: SkillState[], plan: DailyPlanRecord, now = new Date(), limit = 60): PlannedItem[] {
  const byKey = new Map(memory.map((x) => [x.key, x]));
  const nowMs = now.getTime();
  const items: PlannedItem[] = [];
  for (const entity of bundle.core) for (const skillKey of skillsFor(entity)) {
    const state = byKey.get(stateKey(entity.stableId, skillKey));
    if (state?.stage === "learning" && Date.parse(state.dueAt) <= nowMs) items.push({ entity, skillKey, lane: "learning", state });
    else if (state?.stage === "relearning" && Date.parse(state.dueAt) <= nowMs) items.push({ entity, skillKey, lane: "relearning", state });
    else if (state?.stage === "provisional" && Date.parse(state.dueAt) <= nowMs) items.push({ entity, skillKey, lane: "provisional", state });
    else if (state?.stage === "review" && Date.parse(state.dueAt) <= nowMs) items.push({ entity, skillKey, lane: "review", state });
  }
  const laneRank: Record<Lane, number> = { learning: 0, relearning: 1, provisional: 2, review: 3, acquisition: 4 };
  items.sort((a, b) => laneRank[a.lane] - laneRank[b.lane] || Date.parse(a.state?.dueAt ?? "0") - Date.parse(b.state?.dueAt ?? "0") || priority(a.entity) - priority(b.entity) || stableNumber(a.entity.stableId) - stableNumber(b.entity.stableId));

  if (!plan.acquisitionClosed && items.length < limit) {
    const introduced = new Set(plan.introducedStableIds);
    const introducedSkills = new Set(plan.introducedSkillKeys ?? []);
    const activeEntities = new Set(memory.filter((x) => x.stage !== "provisional" && x.stage !== "acquisitionCandidate").map((x) => x.stableId));
    const newEntityCap = plan.newEntityCap ?? 12;
    const storedBudget = plan.acquisitionBudget ?? plan.acquisitionCap;
    const budgetLimit = Math.min(storedBudget, plan.acquisitionCap);
    let remainingBudget = Math.max(0, budgetLimit - (plan.acquisitionUsed ?? 0));
    const candidates = bundle.core
      .filter((e) => e.quizEligible !== false && skillsFor(e).some((s) => {
        const existing = byKey.get(stateKey(e.stableId, s));
        return !existing || existing.stage === "acquisitionCandidate";
      }))
      .sort((a, b) => priority(a) - priority(b) || stableNumber(`${plan.learningDayId}:${a.stableId}`) - stableNumber(`${plan.learningDayId}:${b.stableId}`));

    for (const entity of candidates) {
      if (items.length >= limit || remainingBudget <= 0) break;
      const skillKey = skillsFor(entity).find((s) => {
        const existing = byKey.get(stateKey(entity.stableId, s));
        return !existing || existing.stage === "acquisitionCandidate";
      });
      if (!skillKey) continue;
      const skillToken = stateKey(entity.stableId, skillKey);
      if (introducedSkills.has(skillToken)) continue;
      const isNewEntity = !activeEntities.has(entity.stableId);
      if (isNewEntity && !introduced.has(entity.stableId) && introduced.size >= newEntityCap) continue;
      const state = byKey.get(skillToken);
      items.push({ entity, skillKey, lane: "acquisition", ...(state ? { state } : {}) });
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
  const pool = bundle.core.map((x) => x.senses[0]?.glossJa ?? "").filter((x, i, a) => x && x !== answer && a.indexOf(x) === i).sort((a, b) => stableNumber(`${entity.stableId}:${a}`) - stableNumber(`${entity.stableId}:${b}`));
  return pool.slice(0, 3);
}
export function makeQuestion(bundle: RuntimeBundle, item: PlannedItem): QuestionRun {
  const meaning = item.entity.senses[0]?.glossJa ?? "";
  const id = crypto.randomUUID();
  if (item.skillKey === "formProduction") return { questionInstanceId: id, stableId: item.entity.stableId, skillKey: item.skillKey, lane: item.lane, prompt: meaning, choices: [], answer: item.entity.lemma };
  const choices = [meaning, ...distractors(bundle, item.entity)].sort((a, b) => stableNumber(`${id}:${a}`) - stableNumber(`${id}:${b}`));
  return { questionInstanceId: id, stableId: item.entity.stableId, skillKey: item.skillKey, lane: item.lane, prompt: item.entity.lemma, choices, answer: meaning };
}

export function normalizeAnswer(value: string): string { return value.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " "); }
export function gradeInput(given: string, answer: string): "Good" | "Hard" | "Again" {
  const a = normalizeAnswer(given), b = normalizeAnswer(answer);
  if (a === b) return "Good";
  if (a && (b.startsWith(a) || a.startsWith(b)) && Math.abs(a.length - b.length) <= 2) return "Hard";
  return "Again";
}
