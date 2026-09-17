import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMON_ENGINE_PIN, ENGINE_VERSION, EXPORT_FORMAT, EXPORT_FORMAT_VERSION, INDEXED_DB_VERSION, PERSISTENCE_SCHEMA_VERSION, PRODUCT_VERSION, RELEASE_TUPLE, SCHEDULER_CONFIG } from "../src/config";
import { hydrateCard } from "../src/fsrsAdapter";
import { stableJson, verifyEnvelope } from "../src/rich/store";
import { VOCABULARY_SESSION_ENGINE } from "../src/common-engine/session-orchestration";

describe("v3 frozen compatibility contract", () => {
  it("keeps product, persistence, export and IndexedDB versions independent", () => {
    expect(PRODUCT_VERSION).toBe("3.0.0");
    expect(ENGINE_VERSION).toBe("common-vocab-engine/1.0.0");
    expect(PERSISTENCE_SCHEMA_VERSION).toBe(3);
    expect(EXPORT_FORMAT_VERSION).toBe(3);
    expect(INDEXED_DB_VERSION).toBe(3);
    expect(EXPORT_FORMAT).toBe("rikkyo-uk-vocab-export/v3");
    expect(RELEASE_TUPLE.datasetVersion).toBe("0.22.1-core");
  });

  it("pins a vendored Common Engine instead of hotlinking Waseda Pages", () => {
    expect(COMMON_ENGINE_PIN.commit).toHaveLength(40);
    expect(COMMON_ENGINE_PIN.repository).toBe("FYam8/english-vocab");
    expect(COMMON_ENGINE_PIN.vendoredModule).toContain("common-engine");
    expect(VOCABULARY_SESSION_ENGINE.take([1, 2, 3], 2)).toEqual([1, 2]);
  });

  it("hydrates JSON FSRS dates before scheduling", () => {
    const card = hydrateCard({ due: "2026-09-20T00:00:00.000Z", last_review: "2026-09-18T00:00:00.000Z" } as never)!;
    expect(card.due).toBeInstanceOf(Date);
    expect(card.last_review).toBeInstanceOf(Date);
  });

  it("loads the permanent v3 golden export with retired history and active session", async () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/v3-golden-export.json", import.meta.url), "utf8"));
    const envelope = await verifyEnvelope(fixture);
    expect(envelope.memory.find((x) => x.stableId === "rik-retired-golden")?.retired).toBe(true);
    expect(envelope.activeSession?.queue[0]?.questionInstanceId).toBe("q-next");
    expect(envelope.events[0]?.payload.idempotencyKey).toBe("q-golden");
    expect(envelope.schedulerMetadata).toEqual(SCHEDULER_CONFIG);
    expect(envelope.memory[0]?.card?.due).toBeInstanceOf(Date);
  });

  it("stable JSON canonicalizes object keys", () => {
    expect(stableJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });
});
