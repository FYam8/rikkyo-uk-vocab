export const APP_ID = "rikkyo-uk-vocab" as const;
export const DB_NAME = "rikkyo-uk-vocab-main-v1" as const;
export const BACKUP_DB_NAME = "rikkyo-uk-vocab-backup-v1" as const;
export const LOCAL_STORAGE_PREFIX = "rikkyo-uk-vocab:" as const;
export const BROADCAST_CHANNEL = "rikkyo-uk-vocab:coordination:v1" as const;
export const EXPORT_FORMAT = "rikkyo-uk-vocab-export/v1" as const;
export const CORE_ENTITY_COUNT = 241 as const;
export const REGISTRY_ENTITY_COUNT = 623 as const;

export const SCHEDULER_CONFIG = Object.freeze({
  algorithm: "FSRS-6",
  package: "ts-fsrs",
  packageVersion: "5.4.2",
  desiredRetention: 0.9,
  enableFuzz: false,
  enableShortTerm: false,
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
