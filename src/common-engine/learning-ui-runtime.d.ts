export interface ProgressInput {
  mode: "study" | "diagnostic";
  unlimited?: boolean;
  isRetry: boolean;
  basePosition: number;
  baseAnswered: number;
  baseTotal: number;
  retryAnswered: number;
  answeredCurrent: boolean;
}
declare global {
  var VocabularyLearningUI: {
    readonly version: string;
    progress(input: ProgressInput, labels?: { baseLabel: string; retryLabel: string }): { primary: string; secondary: string };
  };
}
