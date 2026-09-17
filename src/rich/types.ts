import type { Card } from "ts-fsrs";
import type { RELEASE_TUPLE, SCHEDULER_CONFIG } from "../config";

export type SkillKey = "meaningRecognition" | "formProduction";
export type Stage = "learning" | "review" | "relearning" | "provisional" | "acquisitionCandidate";
export type Lane = "learning" | "relearning" | "provisional" | "review" | "acquisition";
export type RatingName = "Again" | "Hard" | "Good";

export interface SkillState {
  key: string;
  stableId: string;
  skillKey: SkillKey;
  generationId: string;
  stage: Stage;
  card: Card | null;
  stepIndex: number;
  dueAt: string;
  correct: number;
  wrong: number;
  lapses: number;
  episodeId: string | null;
  provisionalUntil: string | null;
  lastSeenAt: string | null;
  lastAppliedRevision: number;
  schedulerMetadata?: SchedulerMetadata;
  retired?: boolean;
}

export interface SchedulerMetadata {
  algorithm: typeof SCHEDULER_CONFIG.algorithm;
  package: typeof SCHEDULER_CONFIG.package;
  packageVersion: typeof SCHEDULER_CONFIG.packageVersion;
  desiredRetention: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
}

export interface Preferences {
  key: "preferences";
  generationId: string;
  dailyTargetSeconds: number;
  learningTimeZone: string;
  examDate: string | null;
  diagnosticCompleted: boolean;
  lastAppliedRevision: number;
}

export interface DailyPlanRecord {
  key: string;
  generationId: string;
  learningDayId: string;
  createdAt: string;
  targetSeconds: number;
  acquisitionCap: number;
  newEntityCap?: number;
  acquisitionBudget?: number;
  acquisitionUsed?: number;
  introducedStableIds: string[];
  introducedSkillKeys?: string[];
  acquisitionClosed: boolean;
  activeStudySeconds?: number;
  lastAppliedRevision: number;
}

export interface GenerationMeta {
  key: "generation";
  generationId: string;
  revision: number;
  createdAt: string;
  origin: "fresh" | "import" | "restore" | "reset";
  dataVersion: string;
  registryCount: number;
  coreCount: number;
  productVersion: string;
  engineVersion: string;
  persistenceSchemaVersion: number;
  createdByRelease: string;
}

export interface DomainEvent {
  key: string;
  generationId: string;
  revision: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface CanonicalReviewPayload extends Record<string, unknown> {
  eventId: string;
  idempotencyKey: string;
  sessionId: string;
  questionInstanceId: string;
  stableId: string;
  skillKey: SkillKey;
  timestamp: string;
  result: "correct" | "wrong";
  rating: RatingName;
  lane: Lane;
  schedulerMetadata: SchedulerMetadata;
  schedulerCardAfter: Card | null;
}

export interface QuestionRun {
  questionInstanceId: string;
  stableId: string;
  skillKey: SkillKey;
  lane: Lane;
  prompt: string;
  choices: string[];
  answer: string;
}

export interface StoredSessionRecord {
  key: "active-session";
  generationId: string;
  sessionId: string;
  mode: "study" | "diagnostic";
  queue: QuestionRun[];
  resumeIndex: number;
  startedAt: string;
  updatedAt: string;
  lastAppliedRevision: number;
}

export interface ExportEnvelope {
  appId: "rikkyo-uk-vocab";
  exportFormat: "rikkyo-uk-vocab-export/v3";
  productVersion: typeof RELEASE_TUPLE.productVersion;
  engineVersion: typeof RELEASE_TUPLE.engineVersion;
  datasetVersion: string;
  persistenceSchemaVersion: typeof RELEASE_TUPLE.persistenceSchemaVersion;
  exportFormatVersion: typeof RELEASE_TUPLE.exportFormatVersion;
  createdByRelease: string;
  schedulerMetadata: SchedulerMetadata;
  exportedAt: string;
  dataVersion: string;
  generation: GenerationMeta;
  preferences: Preferences;
  memory: SkillState[];
  plans: DailyPlanRecord[];
  events: DomainEvent[];
  activeSession: StoredSessionRecord | null;
  checksum: string;
}

export interface BackupManifest {
  key: string;
  snapshotId: string;
  createdAt: string;
  purpose: string;
  complete: boolean;
  chunkCount: number;
  chunkHashes: string[];
  rootHash: string;
}
