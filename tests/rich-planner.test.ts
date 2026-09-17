import { describe, expect, it } from "vitest";
import type { RuntimeBundle, RuntimeEntity } from "../src/runtime";
import { buildDiagnostic, provisionalFromDiagnostic } from "../src/rich/diagnostic";
import { applyStudyAnswer, buildQueue, createInitialState, ensurePlan, learningDayId, makeQuestion, stateKey } from "../src/rich/planner";
import type { SkillState } from "../src/rich/types";

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
    release: { appId: "rikkyo-uk-vocab", productVersion: "3.2.0", engineVersion: "common-vocab-engine/1.0.0", datasetVersion: "test", persistenceSchemaVersion: 3, exportFormatVersion: 3, indexedDbVersion: 3, commonEngineCommit: "test", enrichmentVersion: "test" },
    manifest: { appId: "rikkyo-uk-vocab", dataVersion: "test", registryEntityCount: 623, coreEntityCount: 241, generatedFromPhase: 17, enrichmentVersion: "test", sourcePapers: ["1","2","3","4","5","6"] },
    registry: Array.from({ length: 623 }, (_, i) => ({ stableId: i < core.length ? core[i]!.stableId : `registry-${i}` })),
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

  it("supports Waseda-style mode and A/B filtering without changing IDs", () => {
    const b = bundle();
    const plan = ensurePlan("g1", 1200, undefined, "Europe/London", new Date("2026-09-17T12:00:00Z"));
    const q = buildQueue(b, [], plan, new Date("2026-09-17T12:00:00Z"), 20, { mode: "foundation", schedule: "A" });
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((x) => x.entity.targetBand === "Foundation" && x.entity.schedules?.includes("A"))).toBe(true);
  });

  it("creates source-aware question variants", () => {
    const b = bundle();
    const item = { entity: b.core[0]!, skillKey: "meaningRecognition" as const, lane: "review" as const, state: { ...createInitialState("g1", b.core[0]!.stableId, "meaningRecognition"), correct: 2 } };
    const q = makeQuestion(b, item);
    expect(["meaningChoice", "audioChoice", "clozeChoice"]).toContain(q.kind);
  });
});
