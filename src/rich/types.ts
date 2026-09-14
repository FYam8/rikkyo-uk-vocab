import type { Card } from "ts-fsrs";

export type SkillKey = "meaningRecognition" | "formProduction";
export type Stage = "learning" | "review" | "relearning" | "provisional";
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
  introducedStableIds: string[];
  acquisitionClosed: boolean;
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
}

export interface DomainEvent {
  key: string;
  generationId: string;
  revision: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
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

export interface ExportEnvelope {
  appId: "rikkyo-uk-vocab";
  exportFormat: "rikkyo-uk-vocab-export/v1";
  exportedAt: string;
  dataVersion: string;
  generation: GenerationMeta;
  preferences: Preferences;
  memory: SkillState[];
  plans: DailyPlanRecord[];
  events: DomainEvent[];
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
