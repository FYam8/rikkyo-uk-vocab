/* School-neutral presentation only: never reads or writes learner storage. */
(function (root) {
  "use strict";
  root.VocabularyLearningUI = Object.freeze({
    version: "1.0.0",
    progress(input, labels = { baseLabel: "基本", retryLabel: "再確認" }) {
      const base = labels.baseLabel, retry = labels.retryLabel;
      if (input.mode === "diagnostic") return { primary: "診断", secondary: `${input.basePosition}/${input.baseTotal}` };
      if (input.unlimited) return { primary: "学習", secondary: `${base} ${input.baseAnswered}問 / ${retry} ${input.retryAnswered}問` };
      if (input.isRetry) return {
        primary: retry,
        secondary: `${base} ${input.baseAnswered}/${input.baseTotal} ・ ${retry} ${input.retryAnswered + (input.answeredCurrent ? 0 : 1)}`,
      };
      return {
        primary: `問題 ${input.basePosition} / ${input.baseTotal}`,
        secondary: `${base} ${input.basePosition}/${input.baseTotal}${input.retryAnswered ? ` ・ ${retry} ${input.retryAnswered}` : ""}`,
      };
    },
  });
})(globalThis);
