import { describe, expect, it } from "vitest";
import type { RuntimeBundle, RuntimeEntity } from "../src/runtime";
import { buildDiagnostic, provisionalFromDiagnostic } from "../src/rich/diagnostic";
import { applyStudyAnswer, buildQueue, createInitialState, dedupeStoredQuestionQueue, ensurePlan, learningDayId, makeQuestion, makeRetryQuestion, refreshStoredQuestion, retryGap, stateKey } from "../src/rich/planner";
import type { QuestionRun, SkillState } from "../src/rich/types";

function entity(i: number, band: "Foundation" | "Core" = i % 2 ? "Foundation" : "Core"): RuntimeEntity {
  return {
    stableId: `rik-test-${String(i).padStart(3, "0")}`,
    lemma: `word${i}`,
    pos: "noun",
    senses: [{ senseId: `sense-${i}`, glossJa: `意味${i}` }],
    capabilities: ["recognition", "spelling"],
    prompts: { recognition: [{}], spelling: [{}] },
    priority: i < 4 ? "S" : i < 12 ? "A" : "B",
    targetBand: band,
    schedules: [i % 2 ? "A" : "B"],
    quizEligible: true,
    diagnosticEligible: true,
    observedFrequency: i % 6,
    years: [2024 + (i % 3)],
    sourceSchedules: [i % 2 ? "A" : "B"],
    categories: ["reading"],
    evidence: [],
    sourceExample: null,
    generatedExample: null,
    cloze: { sentence: `This is _____.`, answer: `word${i}`, provenance: "past-paper-derived" },
  };
}
function bundle(): RuntimeBundle {
  const core = Array.from({ length: 32 }, (_, i) => entity(i));
  return {
    release: { appId: "rikkyo-uk-vocab", productVersion: "3.5.8", engineVersion: "common-vocab-engine/1.0.0", datasetVersion: "test", persistenceSchemaVersion: 3, exportFormatVersion: 3, indexedDbVersion: 3, commonEngineCommit: "test", enrichmentVersion: "test" },
    manifest: { appId: "rikkyo-uk-vocab", dataVersion: "test", registryEntityCount: 912, coreEntityCount: 241, generatedFromPhase: 24, enrichmentVersion: "test", sourcePapers: ["1","2","3","4","5","6"] },
    registry: Array.from({ length: 912 }, (_, i) => ({ stableId: i < core.length ? core[i]!.stableId : `registry-${i}` })),
    core,
  };
}

describe("adaptive Phase 22 planner", () => {
  it("uses the configured learning timezone for the day boundary", () => {
    const at = new Date("2026-01-01T00:30:00Z");
    expect(learningDayId(at, "America/New_York")).toBe("2025-12-31");
    expect(learningDayId(at, "Asia/Tokyo")).toBe("2026-01-01");
  });

  it("creates a persisted daily plan with a 12-new-entity cap", () => {
    const plan = ensurePlan("g1", 1200, undefined, "Europe/London", new Date("2026-09-14T12:00:00Z"));
    expect(plan.acquisitionCap).toBe(12);
    expect(plan.activeStudySeconds).toBe(0);
    expect(plan.acquisitionClosed).toBe(false);
  });

  it("protects due review work ahead of acquisition", () => {
    const b = bundle();
    const due: SkillState = { ...createInitialState("g1", b.core[20]!.stableId, "meaningRecognition", new Date("2026-09-13T00:00:00Z")), stage: "review", dueAt: "2026-09-13T00:00:00.000Z" };
    const plan = ensurePlan("g1", 1200, undefined, "Europe/London", new Date("2026-09-14T12:00:00Z"));
    const queue = buildQueue(b, [due], plan, new Date("2026-09-14T12:00:00Z"), 10);
    expect(queue[0]?.lane).toBe("review");
    expect(queue[0]?.entity.stableId).toBe(due.stableId);
  });

  it("limits due meaning and production skills to one base question per word", () => {
    const b = bundle();
    const e = b.core[20]!;
    const now = new Date("2026-09-14T12:00:00Z");
    const meaning = { ...createInitialState("g1", e.stableId, "meaningRecognition", now), stage: "review" as const, dueAt: "2026-09-13T00:00:00.000Z", correct: 4, wrong: 0 };
    const production = { ...createInitialState("g1", e.stableId, "formProduction", now), stage: "review" as const, dueAt: "2026-09-13T00:00:00.000Z", correct: 1, wrong: 2 };
    const plan = { ...ensurePlan("g1", 1200, undefined, "Europe/London", now), acquisitionClosed: true };
    const queue = buildQueue(b, [meaning, production], plan, now, 10);
    expect(queue.filter((item) => item.entity.stableId === e.stableId)).toHaveLength(1);
    expect(queue[0]?.skillKey).toBe("formProduction");
  });

  it("does not add a missing second skill as acquisition beside a due skill for the same word", () => {
    const b = bundle();
    const e = b.core[20]!;
    const now = new Date("2026-09-14T12:00:00Z");
    const due = { ...createInitialState("g1", e.stableId, "meaningRecognition", now), stage: "learning" as const, dueAt: "2026-09-13T00:00:00.000Z" };
    const queue = buildQueue(b, [due], ensurePlan("g1", 1200, undefined, "Europe/London", now), now, 10);
    expect(queue.filter((item) => item.entity.stableId === e.stableId)).toHaveLength(1);
    expect(new Set(queue.map((item) => item.entity.stableId)).size).toBe(queue.length);
  });

  it("does not add acquisition when the daily acquisition lane is closed", () => {
    const b = bundle();
    const plan = { ...ensurePlan("g1", 1200), acquisitionClosed: true };
    expect(buildQueue(b, [], plan, new Date(), 10)).toHaveLength(0);
  });

  it("keeps same-session learning outside long-term FSRS until graduation", () => {
    const start = new Date("2026-09-14T12:00:00Z");
    const initial = createInitialState("g1", "rik-test", "meaningRecognition", start);
    const again = applyStudyAnswer(initial, "Again", start);
    expect(again.stage).toBe("learning");
    expect(again.card).toBeNull();
    const good1 = applyStudyAnswer(again, "Good", start);
    expect(good1.stage).toBe("learning");
    expect(good1.card).toBeNull();
    const good2 = applyStudyAnswer(good1, "Good", new Date(start.getTime() + 10 * 60_000));
    expect(good2.stage).toBe("review");
    expect(good2.card).not.toBeNull();
  });

  it("returns failed provisional confirmation to acquisition candidate rather than lapse", () => {
    const provisional = provisionalFromDiagnostic("g1", "rik-test", "formProduction", new Date("2026-09-14T12:00:00Z"));
    const failed = applyStudyAnswer(provisional, "Again", new Date("2026-09-15T12:00:00Z"));
    expect(failed.stage).toBe("acquisitionCandidate");
    expect(failed.lapses).toBe(0);
    expect(failed.card).toBeNull();
  });

  it("builds a maximum 24-question diagnostic with both primary skills", () => {
    const q = buildDiagnostic(bundle(), "fixed-seed");
    expect(q).toHaveLength(24);
    expect(q.filter((x) => x.skillKey === "meaningRecognition")).toHaveLength(16);
    expect(q.filter((x) => x.skillKey === "formProduction")).toHaveLength(8);
    expect(new Set(q.map((x) => x.questionInstanceId)).size).toBe(24);
  });

  it("uses stableId × skillKey as separate memory keys", () => {
    expect(stateKey("rik-v-x", "meaningRecognition")).not.toBe(stateKey("rik-v-x", "formProduction"));
  });

  it("keeps A/B provenance but does not split the learning queue by schedule", () => {
    const b = bundle();
    const plan = ensurePlan("g1", 1200, undefined, "Europe/London", new Date("2026-09-17T12:00:00Z"));
    const a = buildQueue(b, [], plan, new Date("2026-09-17T12:00:00Z"), 20, { mode: "recommended", schedule: "A" });
    const scheduleB = buildQueue(b, [], plan, new Date("2026-09-17T12:00:00Z"), 20, { mode: "recommended", schedule: "B" });
    expect(a.map((x) => x.entity.stableId)).toEqual(scheduleB.map((x) => x.entity.stableId));
  });

  it("creates source-aware question variants", () => {
    const b = bundle();
    const item = { entity: b.core[0]!, skillKey: "meaningRecognition" as const, lane: "review" as const, state: { ...createInitialState("g1", b.core[0]!.stableId, "meaningRecognition"), correct: 2 } };
    const q = makeQuestion(b, item);
    expect(["meaningChoice", "audioChoice", "clozeChoice", "clozeInput"]).toContain(q.kind);
  });

  it("starts unseen words with English-to-Japanese four-choice even in exam mode", () => {
    const b = bundle();
    const plan = ensurePlan("g1", 1200, undefined, "Europe/London", new Date("2026-09-17T12:00:00Z"));
    const item = buildQueue(b, [], plan, new Date("2026-09-17T12:00:00Z"), 10, { mode: "exam" })[0]!;
    const q = makeQuestion(b, item, { intensity: "exam", allowAudio: false });
    expect(item.skillKey).toBe("meaningRecognition");
    expect(q.kind).toBe("meaningChoice");
    expect(q.choices).toHaveLength(4);
    expect(q.answer).toBe(item.entity.senses[0]?.glossJa);
  });

  it("introduces production with Japanese-to-English four-choice before input", () => {
    const b = bundle(), e = b.core[0]!;
    const q = makeQuestion(b, { entity: e, skillKey: "formProduction", lane: "acquisition" }, { intensity: "exam", allowAudio: false });
    expect(q.kind).toBe("reverseChoice");
    expect(q.choices).toHaveLength(4);
    expect(q.answer).toBe(e.lemma);
  });

  it("turns a missed input into an objective retry after a Waseda-style gap", () => {
    const b = bundle(), e = b.core[20]!;
    const original = makeQuestion(b, { entity: e, skillKey: "formProduction", lane: "review", state: { ...createInitialState("g1", e.stableId, "formProduction"), correct: 3 } }, { intensity: "exam", allowAudio: false });
    const retry = makeRetryQuestion(b, original, e);
    expect(retry.kind).toBe("reverseChoice");
    expect(retry.isRetry).toBe(true);
    expect(retry.retryOf).toBe(original.questionInstanceId);
    expect(retryGap(e)).toBe(8);
  });

  it("rehydrates an old generic cloze from the current corpus without losing session identity", () => {
    const b = bundle();
    const e = b.core[0]!;
    const old: QuestionRun = {
      questionInstanceId: "persisted-question",
      stableId: e.stableId,
      skillKey: "formProduction",
      lane: "review",
      kind: "clozeChoice",
      prompt: "old prompt",
      context: "The passage uses “_____” in an important context.",
      choices: ["stale", e.lemma],
      answer: "stale",
      sourceLabel: "stale source",
      isRetry: true,
      retryOf: "original-question",
    };
    const refreshed = refreshStoredQuestion(b, old);
    expect(refreshed.questionInstanceId).toBe(old.questionInstanceId);
    expect(refreshed.context).toBe("This is _____.");
    expect(refreshed.prompt).toBe("空所に入る語句を選んでください");
    expect(refreshed.answer).toBe(e.lemma);
    expect(refreshed.choices).toContain(e.lemma);
    expect(refreshed.choices).not.toContain("stale");
    expect(refreshed.isRetry).toBe(true);
    expect(refreshed.retryOf).toBe("original-question");
    expect(refreshed.sourceLabel).toBeUndefined();
  });

  it("converts an unanswered legacy acquisition input into four-choice on resume", () => {
    const b = bundle();
    const e = b.core[0]!;
    const old: QuestionRun = {
      questionInstanceId: "legacy-acquisition-input",
      stableId: e.stableId,
      skillKey: "meaningRecognition",
      lane: "acquisition",
      kind: "clozeInput",
      prompt: "old prompt",
      context: "old context _____",
      choices: [],
      answer: e.lemma,
    };
    const refreshed = refreshStoredQuestion(b, old);
    expect(refreshed.questionInstanceId).toBe(old.questionInstanceId);
    expect(refreshed.kind).toBe("meaningChoice");
    expect(refreshed.prompt).toBe(e.lemma);
    expect(refreshed.choices).toHaveLength(4);
    expect(refreshed.answer).toBe(e.senses[0]?.glossJa);
    expect(refreshed.context).toBeUndefined();
  });

  it("removes duplicate unanswered base and retry questions while preserving the answered prefix", () => {
    const make = (id: string, stableId: string, isRetry = false): QuestionRun => ({
      questionInstanceId: id, stableId, skillKey: "meaningRecognition", lane: "review",
      kind: "meaningChoice", prompt: stableId, choices: ["a", "b", "c", "d"], answer: "a", ...(isRetry ? { isRetry: true } : {}),
    });
    const queue = [make("answered", "word-a"), make("duplicate-base", "word-a"), make("base-b", "word-b"), make("retry-a", "word-a", true), make("duplicate-retry-a", "word-a", true)];
    const deduped = dedupeStoredQuestionQueue(queue, 1);
    expect(deduped.map((question) => question.questionInstanceId)).toEqual(["answered", "base-b", "retry-a"]);
  });
});
