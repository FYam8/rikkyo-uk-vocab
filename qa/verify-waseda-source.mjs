import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const lock = JSON.parse(await readFile("common-engine.lock.json", "utf8"));
const upstream = async (path) => {
  const response = await fetch(`https://raw.githubusercontent.com/${lock.sourceRepository}/${lock.sourceCommit}/${path}`);
  if (!response.ok) throw new Error(`Upstream ${response.status}: ${path}`);
  return response.text();
};
const [engine, shell, candidate] = await Promise.all([
  upstream(lock.sourceArtifact), upstream(lock.shellSourceArtifact), upstream(lock.selectionSourceArtifact),
]);
assert.equal(await readFile(lock.vendoredModule, "utf8"), engine + lock.moduleExportSuffix);
assert.equal(await readFile(lock.vendoredShellCss, "utf8"), shell.split("<style>")[1].split("</style>")[0]);
const selection = candidate.slice(candidate.indexOf("function weightedChoice("), candidate.indexOf("function v76Clamp("))
  + candidate.slice(candidate.indexOf("function v75WeightedWithoutReplacement("), candidate.indexOf("function chooseNext("));
assert.equal(await readFile(lock.vendoredSelection, "utf8"), selection + "\nexport { v75WeightedWithoutReplacement };\n");
console.log("Waseda source parity: planner, weighted selection, complete visual stylesheet PASS");
