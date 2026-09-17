import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const enrichment = JSON.parse(readFileSync(new URL("../public/data/enrichment.json", import.meta.url), "utf8"));
const core = Array.from({ length: 13 }, (_, i) => JSON.parse(readFileSync(new URL(`../public/data/core-${String(i).padStart(2, "0")}.json`, import.meta.url), "utf8"))).flat();

describe("FY24-FY26 A/B enrichment contract", () => {
  it("covers every Core item without changing its stable ID", () => {
    expect(enrichment.entityCount).toBe(241);
    expect(Object.keys(enrichment.entities).sort()).toEqual(core.map((row) => row[0]).sort());
  });

  it("records the audited source-match and source-example totals", () => {
    expect(enrichment.sourceMatchedEntityCount).toBe(235);
    expect(Object.values(enrichment.entities).filter((item: any) => item.sourceExample).length).toBe(220);
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
});
