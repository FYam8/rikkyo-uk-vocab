import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import contract from "../src/common-engine/learning-ui-contract.json";
import { questionCopy, resolveQuestionKind, sessionProgress } from "../src/common-engine/learning-ui";

describe("Waseda-derived common learning UI contract", () => {
  it("uses the exact Waseda runtime pinned in the lock file", () => {
    const lock = JSON.parse(readFileSync(new URL("../common-engine.lock.json", import.meta.url), "utf8"));
    const source = readFileSync(new URL("../src/common-engine/learning-ui-runtime.js", import.meta.url));
    expect(createHash("sha256").update(source).digest("hex")).toBe(lock.uiRuntimeSha256);
  });

  it("does not double-count a retry after showing feedback", () => {
    expect(sessionProgress({ mode: "study", isRetry: true, basePosition: 20, baseAnswered: 20, baseTotal: 20, retryAnswered: 4, answeredCurrent: true }))
      .toEqual({ primary: "再確認", secondary: "基本 20/20 ・ 再確認 4" });
  });

  it("keeps the selected base count fixed when retries are added", () => {
    expect(contract.sessionProgress.selectedCountMeans).toBe("baseQuestions");
    expect(sessionProgress({ mode: "study", isRetry: false, basePosition: 18, baseAnswered: 17, baseTotal: 20, retryAnswered: 10, answeredCurrent: false }))
      .toEqual({ primary: "問題 18 / 20", secondary: "基本 18/20 ・ 再確認 10" });
    expect(sessionProgress({ mode: "study", isRetry: true, basePosition: 18, baseAnswered: 18, baseTotal: 20, retryAnswered: 10, answeredCurrent: false }))
      .toEqual({ primary: "再確認", secondary: "基本 18/20 ・ 再確認 11" });
  });

  it("recovers the correct copy for legacy diagnostic input questions", () => {
    const kind = resolveQuestionKind(undefined, 0, "formProduction");
    expect(kind).toBe("input");
    expect(questionCopy(kind)).toEqual({ label: "日→英・入力", instruction: "対応する英語を入力してください" });
  });

  it("keeps unseen recognition and production introductions objective", () => {
    expect(contract.introduction.meaningRecognition).toBe("meaningChoice");
    expect(contract.introduction.formProduction).toBe("reverseChoice");
  });
});
