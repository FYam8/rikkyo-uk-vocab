import contract from "./learning-ui-contract.json";
import "./learning-ui-runtime.js";
import type { ProgressInput } from "./learning-ui-runtime.js";

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

export function sessionProgress(input: ProgressInput): { primary: string; secondary: string } {
  return globalThis.VocabularyLearningUI.progress(input, contract.sessionProgress);
}

export const LEARNING_UI_CONTRACT_VERSION = contract.version;
