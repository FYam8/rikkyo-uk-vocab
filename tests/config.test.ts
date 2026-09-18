import { describe, expect, it } from "vitest";
import { APP_ID, BROADCAST_CHANNEL, DB_NAME, EXPORT_FORMAT, INDEXED_DB_VERSION, LOCAL_STORAGE_PREFIX, PERSISTENCE_SCHEMA_VERSION, PRODUCT_VERSION, SCHEDULER_CONFIG, acceptsExportAppId, exportRejectionReason } from "../src/config";

describe("application isolation", () => {
  it("uses the Rikkyo appId", () => expect(APP_ID).toBe("rikkyo-uk-vocab"));
  it("uses a Rikkyo database", () => expect(DB_NAME).toContain(APP_ID));
  it("uses a Rikkyo localStorage prefix", () => expect(LOCAL_STORAGE_PREFIX).toContain(APP_ID));
  it("uses a Rikkyo broadcast channel", () => expect(BROADCAST_CHANNEL).toContain(APP_ID));
  it("uses a Rikkyo export format", () => expect(EXPORT_FORMAT).toContain(APP_ID));
  it("keeps v3 persistence as the compatibility origin across product releases", () => { expect(PRODUCT_VERSION).toBe("3.6.2"); expect(PERSISTENCE_SCHEMA_VERSION).toBe(3); expect(INDEXED_DB_VERSION).toBe(3); });
  it("accepts the Rikkyo appId", () => expect(acceptsExportAppId(APP_ID)).toBe(true));
  it("rejects the Waseda appId", () => expect(acceptsExportAppId("waseda-vocab")).toBe(false));
  it("gives an explicit Waseda rejection", () => expect(exportRejectionReason("waseda-vocab")).toContain("早稲田"));
});

describe("scheduler invariants", () => {
  it("uses FSRS-6", () => expect(SCHEDULER_CONFIG.algorithm).toBe("FSRS-6"));
  it("pins ts-fsrs 5.4.2", () => expect(SCHEDULER_CONFIG.packageVersion).toBe("5.4.2"));
  it("requests 0.90 retention", () => expect(SCHEDULER_CONFIG.desiredRetention).toBe(0.9));
  it("turns fuzz off", () => expect(SCHEDULER_CONFIG.enableFuzz).toBe(false));
  it("turns short-term FSRS off", () => expect(SCHEDULER_CONFIG.enableShortTerm).toBe(false));
});
