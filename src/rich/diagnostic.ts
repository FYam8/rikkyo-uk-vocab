import type { RuntimeBundle, RuntimeEntity } from "../runtime";
import { stateKey } from "./planner";
import type { QuestionRun, SkillKey, SkillState } from "./types";

function hash(s: string): number { let h = 0x811c9dc5; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193); return h >>> 0; }
function eligible(bundle: RuntimeBundle, band?: string): RuntimeEntity[] {
  return bundle.core.filter((x) => x.diagnosticEligible !== false && x.quizEligible !== false && (!band || x.targetBand === band));
}
function take(list: RuntimeEntity[], n: number, salt: string): RuntimeEntity[] { return [...list].sort((a, b) => hash(`${salt}:${a.stableId}`) - hash(`${salt}:${b.stableId}`)).slice(0, n); }
function meaningChoices(bundle: RuntimeBundle, entity: RuntimeEntity, salt: string): string[] {
  const answer = entity.senses[0]?.glossJa ?? "";
  const pool = bundle.core.map((x) => x.senses[0]?.glossJa ?? "").filter((x, i, a) => x && x !== answer && a.indexOf(x) === i).sort((a, b) => hash(`${salt}:${a}`) - hash(`${salt}:${b}`));
  return [answer, ...pool.slice(0, 3)].sort((a, b) => hash(`${salt}:order:${a}`) - hash(`${salt}:order:${b}`));
}

export function buildDiagnostic(bundle: RuntimeBundle, seed = new Date().toISOString().slice(0, 10)): QuestionRun[] {
  const foundation = take(eligible(bundle, "Foundation"), 6, `${seed}:foundation`);
  const core = take(eligible(bundle, "Core"), 10, `${seed}:core`);
  const challenge = take(eligible(bundle, "Challenge"), 8, `${seed}:challenge`);
  const challengeIds = new Set(challenge.map((x) => x.stableId));
  const productionPool = [...challenge, ...take(eligible(bundle).filter((x) => !challengeIds.has(x.stableId)), 8 - challenge.length, `${seed}:production-fallback`)];
  const out: QuestionRun[] = [];
  for (const e of [...foundation, ...core]) out.push({ questionInstanceId: crypto.randomUUID(), stableId: e.stableId, skillKey: "meaningRecognition", lane: "acquisition", prompt: e.lemma, choices: meaningChoices(bundle, e, `${seed}:${e.stableId}`), answer: e.senses[0]?.glossJa ?? "" });
  for (const e of productionPool) out.push({ questionInstanceId: crypto.randomUUID(), stableId: e.stableId, skillKey: "formProduction", lane: "acquisition", prompt: e.senses[0]?.glossJa ?? "", choices: [], answer: e.lemma });
  return out.slice(0, 24);
}

export function provisionalFromDiagnostic(generationId: string, stableId: string, skillKey: SkillKey, answeredAt = new Date()): SkillState {
  const confirmAt = new Date(answeredAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { key: stateKey(stableId, skillKey), stableId, skillKey, generationId, stage: "provisional", card: null, stepIndex: 0, dueAt: confirmAt, correct: 1, wrong: 0, lapses: 0, episodeId: null, provisionalUntil: confirmAt, lastSeenAt: answeredAt.toISOString(), lastAppliedRevision: 0 };
}

export interface DiagnosticResult { answered: number; correct: number; provisional: number; }
export function scoreDiagnostic(history: Array<{ correct: boolean }>): DiagnosticResult {
  const correct = history.filter((x) => x.correct).length; return { answered: history.length, correct, provisional: correct };
}
