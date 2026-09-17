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
    expect(enrichment.sourceMatchedEntityCount).toBeGreaterThanOrEqual(125);
    expect(Object.values(enrichment.entities).filter((item: any) => item.sourceExample).length).toBeGreaterThanOrEqual(70);
    expect(Object.values(enrichment.entities).filter((item: any) => item.generatedExample).length).toBeGreaterThanOrEqual(200);
  });

  it("keeps generated examples visibly separate from past-paper evidence", () => {
    for (const item of Object.values(enrichment.entities) as any[]) {
      if (item.generatedExample) expect(item.generatedExample.provenance).toBe("generated-from-rikkyo-patterns");
      if (item.sourceExample) expect(item.evidence.length).toBeGreaterThan(0);
    }
  });

  it("only emits usable cloze prompts", () => {
    for (const item of Object.values(enrichment.entities) as any[]) if (item.cloze) {
      expect(item.cloze.sentence).toContain("_____");
      expect(item.cloze.sentence.match(/_____/g)).toHaveLength(1);
      expect(item.cloze.sentence).not.toContain("The passage uses");
      if (item.cloze.provenance === "past-paper-derived") {
        expect(item.sourceExample).toBeTruthy();
        expect(item.sourceExample.matchedForm.toLowerCase()).toBe(item.lemma.toLowerCase());
      }
    }
  });

  it("never publishes a generic placeholder as an example", () => {
    for (const item of Object.values(enrichment.entities) as any[]) {
      expect(item.generatedExample?.sentence ?? "").not.toContain("The passage uses");
      expect(item.cloze?.sentence ?? "").not.toContain("important context");
    }
  });

  it("rejects OCR boundary and sense-mismatch examples", () => {
    const byLemma = new Map((Object.values(enrichment.entities) as any[]).map((item) => [item.lemma, item]));
    for (const lemma of ["energy", "leave", "order", "support", "up to"]) {
      expect(byLemma.get(lemma)?.sourceExample).toBeNull();
      expect(byLemma.get(lemma)?.cloze?.provenance).toBe("generated-from-rikkyo-patterns");
    }
    for (const item of Object.values(enrichment.entities) as any[]) {
      expect(item.sourceExample?.sentence ?? "").not.toMatch(/Writing Test|\( B-[1-4] \)|Tomorrow Saturday/);
      expect(item.cloze?.sentence ?? "").not.toMatch(/Writing Test|\( B-[1-4] \)|Tomorrow Saturday/);
    }
  });

  it("keeps generated practice sentences grammatical and presentation-ready", () => {
    const byLemma = new Map((Object.values(enrichment.entities) as any[]).map((item) => [item.lemma, item]));
    expect(byLemma.get("condition")?.generatedExample?.sentence).toBe("The machine works well under this condition.");
    expect(byLemma.get("insect")?.generatedExample?.sentence).toBe("The researchers found the substance in an insect.");
    expect(byLemma.get("even though")?.generatedExample?.sentence).toMatch(/^Even though/);
    expect(byLemma.get("make sure")?.generatedExample?.sentence).toMatch(/^Make sure/);
    expect(byLemma.get("instead")?.generatedExample?.sentence).not.toContain(" .");
  });

  it("uses unique lemmas and an entrance-exam difficulty distribution", () => {
    const lemmas = core.map((row) => row[1].toLowerCase());
    expect(new Set(lemmas).size).toBe(241);
    const bands = Object.fromEntries(["Foundation", "Core", "Challenge"].map((band) => [band, core.filter((row) => row[6] === band).length]));
    expect(bands).toEqual({ Foundation: 30, Core: 151, Challenge: 60 });
    for (const required of ["photosynthesis", "retention", "nutrient", "recyclable", "biodiversity", "hypothesis", "investigate", "influence", "urbanisation"]) expect(lemmas).toContain(required.toLowerCase());
    for (const removed of ["cat", "apple", "mother", "father", "school", "morning", "good", "old", "robin", "course", "well", "month", "doctor"]) expect(lemmas).not.toContain(removed);
    for (const demoted of ["data", "dream", "project", "power", "interview", "comfortable", "complete", "difference", "protect", "soil"]) expect(core.find((row) => row[1].toLowerCase() === demoted)?.[6]).toBe("Core");
    expect(Object.values(enrichment.entities).filter((item: any) => item.selectionOrigin === "rikkyo-transfer").length).toBeGreaterThanOrEqual(105);
    expect(core.every((row) => row[7].join(",") === "A,B")).toBe(true);
  });
});
