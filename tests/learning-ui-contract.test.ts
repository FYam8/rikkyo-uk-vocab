import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import contract from "../src/common-engine/learning-ui-contract.json";
import { questionCopy, resolveQuestionKind, sessionProgress } from "../src/common-engine/learning-ui";

describe("Waseda-derived common learning UI contract", () => {
  it("pins the actual Waseda planner, selection functions and visual stylesheet", () => {
    const lock = JSON.parse(readFileSync(new URL("../common-engine.lock.json", import.meta.url), "utf8"));
    const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    const module = read(lock.vendoredModule);
    expect(module.endsWith(lock.moduleExportSuffix)).toBe(true);
    expect(hash(module.slice(0, -lock.moduleExportSuffix.length))).toBe(lock.sourceArtifactSha256);
    expect(hash(read(lock.vendoredShellCss))).toBe(lock.shellCssSha256);
    expect(hash(read(lock.vendoredSelection))).toBe(lock.selectionSha256);
    expect(read("src/rich-app.ts")).toContain('import "./common-engine/waseda-shell.css"');
    expect(read("src/rich/planner.ts")).toContain("VOCABULARY_SESSION_ENGINE.buildPlan");
  });
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
