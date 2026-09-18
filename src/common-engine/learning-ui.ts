import contract from "./learning-ui-contract.json";

export type CommonQuestionKind = keyof typeof contract.questionKinds;

export function resolveQuestionKind(
  kind: string | undefined,
  choicesLength: number,
  skillKey: "meaningRecognition" | "formProduction",
): CommonQuestionKind {
  if (kind && kind in contract.questionKinds) return kind as CommonQuestionKind;
  if (choicesLength > 0) return skillKey === "formProduction" ? "reverseChoice" : "meaningChoice";
  return skillKey === "formProduction" ? "input" : "meaningChoice";
}

export function questionCopy(kind: CommonQuestionKind): { label: string; instruction: string } {
  return contract.questionKinds[kind];
}

export function sessionProgress(input: {
  mode: "study" | "diagnostic";
  isRetry: boolean;
  basePosition: number;
  baseAnswered: number;
  baseTotal: number;
  retryAnswered: number;
  answeredCurrent: boolean;
}): { primary: string; secondary: string } {
  const currentRetry = input.isRetry && !input.answeredCurrent ? 1 : 0;
  if (input.mode === "diagnostic") {
    return { primary: "診断", secondary: `${input.basePosition}/${input.baseTotal}` };
  }
  if (input.isRetry) {
    return {
      primary: contract.sessionProgress.retryLabel,
      secondary: `${contract.sessionProgress.baseLabel} ${input.baseAnswered}/${input.baseTotal} ・ ${contract.sessionProgress.retryLabel} ${input.retryAnswered + currentRetry}`,
    };
  }
  return {
    primary: `問題 ${input.basePosition} / ${input.baseTotal}`,
    secondary: `${contract.sessionProgress.baseLabel} ${input.basePosition}/${input.baseTotal}${input.retryAnswered ? ` ・ ${contract.sessionProgress.retryLabel} ${input.retryAnswered}` : ""}`,
  };
}

export const LEARNING_UI_CONTRACT_VERSION = contract.version;
