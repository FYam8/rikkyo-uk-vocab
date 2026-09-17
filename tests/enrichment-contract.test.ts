import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const enrichment = JSON.parse(readFileSync(new URL("../public/data/enrichment.json", import.meta.url), "utf8"));
const core = Array.from({ length: 13 }, (_, i) => JSON.parse(readFileSync(new URL(`../public/data/core-${String(i).padStart(2, "0")}.json`, import.meta.url), "utf8"))).flat();

describe("FY24-FY26 A/B enrichment contract", () => {
  it("covers every Core item without changing its stable ID", () => {
    expect(enrichment.entityCount).toBe(241);
    expect(Object.keys(enrichment.entities).sort()).toEqual(core.map((row) => row[0]).sort());
  });

  it("records six-paper matches and generated examples for the full set", () => {
    expect(enrichment.sourceMatchedEntityCount).toBeGreaterThanOrEqual(190);
    expect(Object.values(enrichment.entities).filter((item: any) => item.sourceExample).length).toBeGreaterThanOrEqual(140);
    expect(Object.values(enrichment.entities).filter((item: any) => item.generatedExample).length).toBe(241);
  });

  it("keeps generated examples visibly separate from past-paper evidence", () => {
    for (const item of Object.values(enrichment.entities) as any[]) {
      if (item.generatedExample) expect(item.generatedExample.provenance).toBe("generated-from-rikkyo-patterns");
      if (item.sourceExample) expect(item.evidence.length).toBeGreaterThan(0);
    }
  });

  it("only emits usable cloze prompts", () => {
    for (const item of Object.values(enrichment.entities) as any[]) if (item.cloze) expect(item.cloze.sentence).toContain("_____");
  });

  it("uses unique lemmas and an entrance-exam difficulty distribution", () => {
    const lemmas = core.map((row) => row[1].toLowerCase());
    expect(new Set(lemmas).size).toBe(241);
    const bands = Object.fromEntries(["Foundation", "Core", "Challenge"].map((band) => [band, core.filter((row) => row[6] === band).length]));
    expect(bands).toEqual({ Foundation: 40, Core: 162, Challenge: 39 });
    for (const required of ["photosynthesis", "retention", "nutrient", "recyclable", "wildlife", "experiment", "investigate", "influence", "project"]) expect(lemmas).toContain(required.toLowerCase());
    for (const removed of ["cat", "apple", "mother", "father", "school", "morning", "good", "old", "robin"]) expect(lemmas).not.toContain(removed);
    expect(core.every((row) => row[7].join(",") === "A,B")).toBe(true);
  });
});
