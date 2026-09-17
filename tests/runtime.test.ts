import { describe, expect, it } from "vitest";
import { APP_ID, CORE_ENTITY_COUNT, DATASET_VERSION, ENGINE_VERSION, EXPORT_FORMAT_VERSION, INDEXED_DB_VERSION, PERSISTENCE_SCHEMA_VERSION, PRODUCT_VERSION, REGISTRY_ENTITY_COUNT } from "../src/config";
import { validateRuntimeBundle, type RuntimeBundle } from "../src/runtime";

function validBundle(): RuntimeBundle {
  const registry = Array.from({ length: REGISTRY_ENTITY_COUNT }, (_, i) => ({ stableId: `fixed-${i}` }));
  const core = Array.from({ length: CORE_ENTITY_COUNT }, (_, i) => ({ stableId: `fixed-${i}`, lemma: `lemma-${i}`, pos: "noun", senses: [{ senseId: `sense-${i}`, glossJa: "検証用" }], capabilities: ["recognition" as const], prompts: { recognition: [{ source: "phase17" }] } }));
  return { release: { appId: APP_ID, productVersion: PRODUCT_VERSION, engineVersion: ENGINE_VERSION, datasetVersion: DATASET_VERSION, persistenceSchemaVersion: PERSISTENCE_SCHEMA_VERSION, exportFormatVersion: EXPORT_FORMAT_VERSION, indexedDbVersion: INDEXED_DB_VERSION, commonEngineCommit: "test" }, manifest: { appId: APP_ID, dataVersion: DATASET_VERSION, registryEntityCount: REGISTRY_ENTITY_COUNT, coreEntityCount: CORE_ENTITY_COUNT, generatedFromPhase: 17 }, registry, core };
}

describe("runtime data gate", () => {
  it("rejects a missing bundle", () => expect(validateRuntimeBundle(null).ok).toBe(false));
  it("rejects another appId", () => { const b = validBundle(); b.manifest.appId = "other"; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires dataVersion", () => { const b = validBundle(); b.manifest.dataVersion = ""; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires the Phase 17 marker", () => { const b = validBundle(); (b.manifest as { generatedFromPhase: number }).generatedFromPhase = 16; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires 623 registry metadata", () => { const b = validBundle(); b.manifest.registryEntityCount = 1; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires 241 core metadata", () => { const b = validBundle(); b.manifest.coreEntityCount = 1; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires 623 registry records", () => { const b = validBundle(); b.registry.pop(); expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires 241 core records", () => { const b = validBundle(); b.core.pop(); expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("rejects duplicate registry IDs", () => { const b = validBundle(); b.registry[1]!.stableId = b.registry[0]!.stableId; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("rejects duplicate core IDs", () => { const b = validBundle(); b.core[1]!.stableId = b.core[0]!.stableId; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires core IDs to exist in Registry", () => { const b = validBundle(); b.core[0]!.stableId = "not-registered"; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires lemma", () => { const b = validBundle(); b.core[0]!.lemma = ""; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires POS", () => { const b = validBundle(); b.core[0]!.pos = ""; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires senses", () => { const b = validBundle(); b.core[0]!.senses = []; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires complete sense records", () => { const b = validBundle(); b.core[0]!.senses[0]!.glossJa = ""; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires capabilities", () => { const b = validBundle(); b.core[0]!.capabilities = []; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("rejects unsupported capabilities", () => { const b = validBundle(); (b.core[0] as unknown as { capabilities: string[] }).capabilities = ["unsupported"]; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("requires prompt coverage for scheduled capabilities", () => { const b = validBundle(); b.core[0]!.prompts = {}; expect(validateRuntimeBundle(b).ok).toBe(false); });
  it("reports 241/241 for a complete mapping", () => expect(validateRuntimeBundle(validBundle()).mappedCore).toBe(241));
  it("passes a complete Phase 17 fixture", () => expect(validateRuntimeBundle(validBundle()).ok).toBe(true));
  it("deduplicates repeated reason messages", () => { const b = validBundle(); b.core[0]!.lemma = ""; b.core[1]!.lemma = ""; const r = validateRuntimeBundle(b); expect(new Set(r.reasons).size).toBe(r.reasons.length); });
});
