export const APP_ID = "rikkyo-uk-vocab" as const;
export const PRODUCT_VERSION = "3.3.0" as const;
export const ENGINE_VERSION = "common-vocab-engine/1.0.0" as const;
export const DATASET_VERSION = "0.22.1-core" as const;
export const PERSISTENCE_SCHEMA_VERSION = 3 as const;
export const EXPORT_FORMAT_VERSION = 3 as const;
export const INDEXED_DB_VERSION = 3 as const;
export const DB_NAME = "rikkyo-uk-vocab-main-v1" as const;
export const BACKUP_DB_NAME = "rikkyo-uk-vocab-backup-v1" as const;
export const LOCAL_STORAGE_PREFIX = "rikkyo-uk-vocab:" as const;
export const BROADCAST_CHANNEL = "rikkyo-uk-vocab:coordination:v1" as const;
export const EXPORT_FORMAT = "rikkyo-uk-vocab-export/v3" as const;
export const CORE_ENTITY_COUNT = 241 as const;
export const REGISTRY_ENTITY_COUNT = 623 as const;
export const ENRICHMENT_VERSION = "2026-09-17-fy24-fy26-ab" as const;

export const SCHEDULER_CONFIG = Object.freeze({
  algorithm: "FSRS-6",
  package: "ts-fsrs",
  packageVersion: "5.4.2",
  desiredRetention: 0.9,
  enableFuzz: false,
  enableShortTerm: false,
});

export const COMMON_ENGINE_PIN = Object.freeze({
  repository: "FYam8/english-vocab",
  commit: "3e6fcb1701e721ccaf070df915446004f7f312ef",
  artifact: "src/common-engine/session-orchestration.js",
  artifactSha256: "e0510dcae081e852f9002bc5d7f8f1af3aa1af2c57e0254030eacb61d62974b6",
  vendoredModule: "src/common-engine/session-orchestration.ts",
});

export const RELEASE_TUPLE = Object.freeze({
  productVersion: PRODUCT_VERSION,
  engineVersion: ENGINE_VERSION,
  datasetVersion: DATASET_VERSION,
  persistenceSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
  exportFormatVersion: EXPORT_FORMAT_VERSION,
  indexedDbVersion: INDEXED_DB_VERSION,
});

export function acceptsExportAppId(appId: unknown): appId is typeof APP_ID {
  return appId === APP_ID;
}

export function exportRejectionReason(appId: unknown): string | null {
  if (acceptsExportAppId(appId)) return null;
  if (typeof appId === "string" && /waseda/i.test(appId)) {
    return "早稲田アプリのexportは立教アプリへimportできません。";
  }
  return "このexportは別アプリの形式です。";
}
