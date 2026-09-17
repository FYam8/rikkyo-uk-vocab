import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const BASELINE_COMMIT = "132dfa1721f2032e8acf59ca163664efe60ae9dc";
const OCR_KEYS = ["01", "02", "07", "08", "13", "14"];
const OCR_META = {
  "01": [2024, "A"], "02": [2024, "B"], "07": [2025, "A"],
  "08": [2025, "B"], "13": [2026, "A"], "14": [2026, "B"],
};

// Paper-glossed words, common directions, duplicated boilerplate and elementary
// vocabulary are not allowed to dominate the entrance-exam learning queue.
const EXCLUDE = new Set([
  "afternoon", "animal", "anything", "apple", "ask", "away", "baby", "back", "bad", "bed", "bedroom", "big", "bird", "book", "boy", "brother", "buy", "call", "car", "cat", "chair", "clean", "coffee", "come", "cook", "country", "cry", "cut", "day", "dinner", "door", "eat", "example", "father", "feed", "female", "find", "finish", "flower", "fly", "food", "football", "friend", "full", "game", "garden", "get", "girl", "go", "good", "grandfather", "great", "grow", "gym", "hand", "happy", "hear", "help", "home", "hour", "house", "idea", "jump", "kid", "know", "last", "laugh", "learn", "library", "like", "little", "live", "look", "love", "make", "man", "money", "morning", "mother", "mountain", "move", "mum", "name", "need", "new", "news", "next", "night", "noon", "old", "open", "parent", "party", "path", "people", "phone", "picture", "piece", "plant", "player", "put", "read", "robin", "room", "rose", "run", "sad", "say", "school", "see", "sell", "shop", "sit", "sleep", "small", "someone", "something", "sorry", "speak", "stand", "start", "station", "stop", "story", "student", "summer", "table", "take", "talk", "tall", "tell", "thank", "thanks", "thing", "think", "time", "tomorrow", "town", "tree", "use", "village", "visit", "wait", "walk", "want", "watch", "water", "week", "window", "word", "work", "world", "write", "year", "yesterday", "young",
  "day in and day out", "get rid of", "get stuck", "once upon a time",
]);
const SOURCE_EXAMPLE_EXCLUDE = new Set(["allow", "catch", "choose", "close", "follow", "for example", "in order to", "miss", "sometimes", "source"]);

const MANUAL = [
  ["photosynthesis", "光合成", "noun", "Challenge"],
  ["retention", "保持、維持", "noun", "Challenge"],
  ["nutrient", "栄養素", "noun", "Challenge"],
  ["recyclable", "リサイクル可能な", "adjective", "Challenge"],
  ["wildlife", "野生生物", "noun", "Core"],
  ["mammal", "哺乳類", "noun", "Challenge"],
  ["electricity", "電気", "noun", "Core"],
  ["biology", "生物学", "noun", "Challenge"],
  ["practical", "実用的な、実践的な", "adjective", "Core"],
  ["document", "文書、資料", "noun", "Core"],
  ["source", "情報源、資料", "noun", "Core"],
  ["tourist", "観光客", "noun", "Core"],
  ["recycling", "リサイクル", "noun", "Core"],
  ["photograph", "写真", "noun", "Core"],
  ["challenge", "課題、難題", "noun", "Core"],
  ["rubbish", "ごみ", "noun", "Core"],
  ["sample", "試料、サンプル", "noun", "Challenge"],
  ["industrial", "工業の、産業の", "adjective", "Challenge"],
  ["revolution", "革命", "noun", "Challenge"],
  ["presentation", "発表、プレゼンテーション", "noun", "Core"],
  ["measure", "測定する、測る", "verb", "Core"],
  ["material", "材料、物質", "noun", "Core"],
  ["amount", "量、総量", "noun", "Core"],
  ["absorb", "吸収する", "verb", "Challenge"],
  ["release", "放出する、解放する", "verb", "Challenge"],
  ["process", "過程、処理する", "noun/verb", "Core"],
  ["compare", "比較する", "verb", "Core"],
  ["reduce", "減らす、削減する", "verb", "Core"],
  ["waste", "廃棄物、無駄", "noun", "Core"],
  ["growth", "成長、増加", "noun", "Core"],
  ["organism", "生物、有機体", "noun", "Challenge"],
  ["environmental", "環境の、環境に関する", "adjective", "Challenge"],
  ["collection", "収集、集めたもの", "noun", "Core"],
  ["recording", "記録、録音", "noun", "Core"],
  ["local community", "地域社会", "phrase", "Core"],
  ["climate change", "気候変動", "phrase", "Challenge"],
  ["Industrial Revolution", "産業革命", "proper noun", "Challenge"],
];

const GENERATED = {
  photosynthesis: ["The class investigated how light affects photosynthesis.", "授業では光が光合成にどう影響するかを調べました。"],
  retention: ["The students measured water retention in three kinds of soil.", "生徒たちは3種類の土の保水性を測定しました。"],
  nutrient: ["Healthy soil contains nutrients that plants need.", "健康な土には植物が必要とする栄養素が含まれます。"],
  recyclable: ["The group collected recyclable plastic after the event.", "グループは行事の後、リサイクル可能なプラスチックを集めました。"],
  wildlife: ["The project aims to protect local wildlife.", "その計画は地域の野生生物を守ることを目的としています。"],
  mammal: ["The researchers recorded every mammal they observed.", "研究者たちは観察したすべての哺乳類を記録しました。"],
  electricity: ["The class carried out an electricity experiment safely.", "クラスは電気の実験を安全に行いました。"],
  biology: ["Biology helps us understand living organisms.", "生物学は生物を理解する助けになります。"],
  practical: ["The experiment gave students practical experience.", "その実験は生徒に実践的な経験を与えました。"],
  document: ["Use reliable documents when preparing your presentation.", "発表の準備には信頼できる資料を使いなさい。"],
  source: ["Check whether each source is reliable.", "それぞれの情報源が信頼できるか確認しなさい。"],
  tourist: ["The survey asked tourists about local transport.", "その調査では観光客に地域の交通について尋ねました。"],
  recycling: ["The school started a recycling project.", "学校はリサイクル計画を始めました。"],
  photograph: ["The old photograph was useful evidence.", "その古い写真は有用な証拠でした。"],
  challenge: ["Finding reliable data was the biggest challenge.", "信頼できるデータを見つけることが最大の課題でした。"],
  rubbish: ["Volunteers collected rubbish near the river.", "ボランティアは川の近くでごみを集めました。"],
  sample: ["Each group examined a different soil sample.", "各グループは異なる土壌試料を調べました。"],
  industrial: ["Industrial development changed the town.", "産業の発展が町を変えました。"],
  revolution: ["The invention caused a revolution in transport.", "その発明は交通に革命をもたらしました。"],
  presentation: ["She used three sources in her presentation.", "彼女は発表で3つの資料を使いました。"],
  measure: ["Measure the amount of water carefully.", "水の量を注意深く測りなさい。"],
  material: ["The students compared two different materials.", "生徒たちは2つの異なる材料を比較しました。"],
  amount: ["The amount of water changed after one hour.", "1時間後、水の量が変化しました。"],
  absorb: ["Plant roots absorb water from the soil.", "植物の根は土から水を吸収します。"],
  release: ["Plants release oxygen during photosynthesis.", "植物は光合成の間に酸素を放出します。"],
  process: ["Explain each stage of the process clearly.", "過程の各段階を明確に説明しなさい。"],
  compare: ["Compare the results before writing your conclusion.", "結論を書く前に結果を比較しなさい。"],
  reduce: ["Recycling can reduce the amount of waste.", "リサイクルは廃棄物の量を減らせます。"],
  waste: ["The project studied how the school handles waste.", "その計画では学校が廃棄物をどう扱うか調べました。"],
  growth: ["The class recorded the growth of each plant.", "クラスは各植物の成長を記録しました。"],
  organism: ["A microscope can reveal a tiny organism.", "顕微鏡で小さな生物を観察できます。"],
  environmental: ["Students discussed an environmental problem.", "生徒たちは環境問題について話し合いました。"],
  collection: ["Data collection continued for two weeks.", "データ収集は2週間続きました。"],
  recording: ["Accurate recording makes the results more reliable.", "正確な記録は結果の信頼性を高めます。"],
  "local community": ["The project received support from the local community.", "その計画は地域社会から支援を受けました。"],
  "climate change": ["Climate change affects plants and wildlife.", "気候変動は植物と野生生物に影響します。"],
  "Industrial Revolution": ["The presentation explained the Industrial Revolution.", "その発表は産業革命について説明しました。"],
};

function idFor(lemma, pos) {
  const kind = lemma.includes(" ") ? "p" : "v";
  return `rik-${kind}-${createHash("sha256").update(`rikkyo-uk-vocab/v0.23.0/${lemma.toLowerCase()}/${pos}`).digest("hex").slice(0, 10)}`;
}
function forms(lemma) {
  const x = lemma.toLowerCase();
  if (x.includes(" ")) return [x];
  const out = new Set([x]);
  if (x.endsWith("y") && !/[aeiou]y$/.test(x)) { out.add(`${x.slice(0, -1)}ies`); out.add(`${x.slice(0, -1)}ied`); }
  else { out.add(`${x}s`); out.add(`${x}ed`); }
  out.add(x.endsWith("e") ? `${x.slice(0, -1)}ing` : `${x}ing`);
  return [...out];
}
function matcher(list) { return new RegExp(`\\b(?:${list.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\s+/g, "\\s+")).join("|")})\\b`, "gi"); }
function normalizePos(pos) {
  return pos.replaceAll("adj.", "adjective").replaceAll("adv.", "adverb").replaceAll("conj.", "conjunction").replaceAll("prep.", "preposition").replaceAll("n.", "noun").replaceAll("v.", "verb").replaceAll("/", "/");
}

const fromBaseline = (path) => execFileSync("git", ["show", `${BASELINE_COMMIT}:${path}`], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
const chunks = Array.from({ length: 13 }, (_, i) => JSON.parse(fromBaseline(`public/data/core-${String(i).padStart(2, "0")}.json`))).flat();
const oldByLemma = new Map();
for (const row of chunks) {
  const key = row[1].toLowerCase();
  const previous = oldByLemma.get(key);
  if (!previous || (row[6] === "Core" && previous[6] !== "Core") || row[4] < previous[4]) oldByLemma.set(key, row);
}

function pageParts(text) {
  const parts = text.split(/===== PAGE\s+0?(\d+) =====/g);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ page: Number(parts[i]), text: parts[i + 1] ?? "" });
  return out.length ? out : [{ page: 0, text }];
}
function normalized(text) { return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim(); }
function sentenceParts(text) {
  return normalized(text).split(/(?<=[.!?])\s+(?=[A-Z"(])/)
    .map((x) => x.trim().replace(/\s+\d+(?:[.,])?$/, ""))
    .filter((x) => x.length >= 28 && x.length <= 210 && (x.match(/[a-z]/g)?.length ?? 0) >= 18)
    .filter((x) => !/[\[\]_*|/=\\]/.test(x) && !/\(\s*\)/.test(x) && !/\b[A-Z]{4,}\b/.test(x))
    .filter((x) => ((x.match(/[A-Za-z]/g)?.length ?? 0) / x.length) >= 0.58);
}
const ocr = await Promise.all(OCR_KEYS.map(async (key) => {
  const text = await readFile(new URL(`../../tmp/pdfs/${key}-ocr.txt`, import.meta.url), "utf8");
  return { key, text, pages: pageParts(text) };
}));
const wasedaText = await readFile(new URL("../../english-vocab/src/waseda-bootstrap/10-waseda-data.js", import.meta.url), "utf8");
function parseJsonConst(source, name) {
  const start = source.indexOf(`const ${name}=`) + `const ${name}=`.length;
  const opening = source[start];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === opening) depth += 1;
    else if (char === closing && --depth === 0) return JSON.parse(source.slice(start, i + 1));
  }
  throw new Error(`Unable to parse ${name}`);
}
const waseda = parseJsonConst(wasedaText, "VOCAB");
const wasedaCloze = parseJsonConst(wasedaText, "CLOZE");

function evidenceFor(lemma, suppliedForms = forms(lemma)) {
  const evidence = [];
  for (const doc of ocr) {
    for (const page of doc.pages) {
      const count = page.text.match(matcher(suppliedForms))?.length ?? 0;
      if (!count) continue;
      const [year, schedule] = OCR_META[doc.key];
      evidence.push({ year, schedule, page: page.page, count, category: year === 2026 && page.page >= 8 ? "academic-practical" : "reading-language" });
    }
  }
  return evidence;
}
function sourceExampleFor(lemma, suppliedForms = forms(lemma)) {
  if (SOURCE_EXAMPLE_EXCLUDE.has(lemma.toLowerCase())) return null;
  let best = null;
  for (const doc of ocr) for (const page of doc.pages) {
    if (page.page < 5) continue;
    for (const sentence of sentenceParts(page.text)) {
    const hit = sentence.match(matcher(suppliedForms));
    if (!hit) continue;
    const [year, schedule] = OCR_META[doc.key];
    const score = (page.page >= 5 ? 30 : 0) + (year === 2026 ? 15 : 0) - Math.abs(105 - sentence.length);
    if (!best || score > best.score) best = { score, sentence, matchedForm: hit[0], year, schedule, page: page.page };
    }
  }
  if (!best) return null;
  const { score: _score, ...example } = best;
  return example;
}

const retained = [...oldByLemma.values()].filter((row) => !EXCLUDE.has(row[1].toLowerCase())).map((row) => {
  const evidence = evidenceFor(row[1]);
  const frequency = evidence.reduce((n, x) => n + x.count, 0);
  const score = 150 + (row[6] === "Core" ? 25 : 0) + (row[4] === "S" ? 20 : row[4] === "A" ? 12 : 5) + Math.min(frequency, 15) * 3;
  return { row: [...row.slice(0, 7), ["A", "B"], true, true], evidence, score, origin: "retained" };
});

const additions = waseda.filter((v) => !oldByLemma.has(v.word.toLowerCase()) && !EXCLUDE.has(v.word.toLowerCase())).map((v) => {
  const evidence = evidenceFor(v.word, v.forms ?? forms(v.word));
  const frequency = evidence.reduce((n, x) => n + x.count, 0);
  if (!frequency) return null;
  const papers = new Set(evidence.map((x) => `${x.year}-${x.schedule}`)).size;
  const band = v.level >= 75 ? "Challenge" : v.level >= 70 ? "Core" : (papers >= 2 || frequency >= 3 ? "Core" : "Foundation");
  const priority = papers >= 2 || frequency >= 5 ? "S" : v.level >= 75 ? "A" : v.priority === "S" ? "A" : "B";
  const row = [idFor(v.word, normalizePos(v.pos)), v.word, v.meaning, normalizePos(v.pos), priority, band === "Challenge" ? "challenge" : "core", band, ["A", "B"], true, true];
  const score = 220 + (v.level - 60) * 4 + papers * 24 + Math.min(frequency, 12) * 4 + (v.studyLayer === "challenge" ? 18 : 0);
  return { row, evidence, score, origin: "waseda-crosscheck" };
}).filter(Boolean);

const manual = MANUAL.map(([lemma, meaning, pos, band]) => {
  const evidence = evidenceFor(lemma);
  const frequency = evidence.reduce((n, x) => n + x.count, 0);
  const row = [idFor(lemma, pos), lemma, meaning, pos, frequency >= 2 ? "S" : band === "Challenge" ? "A" : "B", band === "Challenge" ? "challenge" : "core", band, ["A", "B"], true, true];
  return { row, evidence, score: 390 + frequency * 5, origin: "rikkyo-academic" };
});

const unique = new Map();
for (const item of [...retained, ...additions, ...manual].sort((a, b) => b.score - a.score)) {
  const key = item.row[1].toLowerCase();
  if (!unique.has(key)) unique.set(key, item);
}
const selected = [...unique.values()].sort((a, b) => b.score - a.score).slice(0, 241).sort((a, b) => a.row[0].localeCompare(b.row[0]));
if (selected.length !== 241) throw new Error(`selected:${selected.length}`);
if (new Set(selected.map((x) => x.row[0])).size !== 241) throw new Error("duplicate selected stable ID");

const previousRegistry = JSON.parse(fromBaseline("public/data/registry.json"));
const registry = [...new Set([...previousRegistry, ...selected.map((x) => x.row[0])])].sort();

function generatedFor(lemma, meaning) {
  const fixed = GENERATED[lemma];
  if (fixed) return { sentence: fixed[0], ja: fixed[1], provenance: "generated-from-rikkyo-patterns" };
  if (wasedaCloze[lemma]) return {
    sentence: wasedaCloze[lemma].replace("_____", lemma),
    ja: `「${meaning}」の使い方を文脈で確認する例文です。`,
    provenance: "generated-from-rikkyo-patterns",
  };
  const sentence = `The passage uses “${lemma}” in an important context.`;
  return { sentence, ja: `本文では「${meaning}」という重要な文脈で使われます。`, provenance: "generated-from-rikkyo-patterns" };
}
const entities = {};
for (const item of selected) {
  const [stableId, lemma, meaningJa, , priority, studyLayer, targetBand] = item.row;
  const evidence = item.evidence;
  const generatedExample = generatedFor(lemma, meaningJa);
  const clozeSentence = generatedExample.sentence.replace(matcher([lemma]), "_____");
  entities[stableId] = {
    stableId, lemma, meaningJa, priority, studyLayer, targetBand, schedules: ["A", "B"],
    observedFrequency: evidence.reduce((n, x) => n + x.count, 0),
    years: [...new Set(evidence.map((x) => x.year))].sort(),
    sourceSchedules: [...new Set(evidence.map((x) => x.schedule))].sort(),
    categories: [...new Set(evidence.map((x) => x.category))], evidence,
    sourceExample: sourceExampleFor(lemma), generatedExample,
    cloze: clozeSentence.includes("_____") ? { sentence: clozeSentence, answer: lemma, provenance: "generated-from-rikkyo-patterns" } : null,
    selectionOrigin: item.origin,
  };
}

for (let i = 0; i < 13; i += 1) {
  const rows = selected.slice(i * 20, i * 20 + 20).map((x) => x.row);
  await writeFile(new URL(`../public/data/core-${String(i).padStart(2, "0")}.json`, import.meta.url), `${JSON.stringify(rows)}\n`);
}
await writeFile(new URL("../public/data/registry.json", import.meta.url), `${JSON.stringify(registry)}\n`);
await writeFile(new URL("../public/data/enrichment.json", import.meta.url), `${JSON.stringify({
  format: "rikkyo-vocab-enrichment/v1", version: "2026-09-17-reselected-v1",
  sourceScope: ["FY24-A", "FY24-B", "FY25-A", "FY25-B", "FY26-A", "FY26-B"],
  generationMethod: "difficulty-aware selection with paper-gloss, boilerplate and elementary-word exclusions; six-paper OCR evidence; original generated practice sentences",
  entityCount: 241,
  sourceMatchedEntityCount: Object.values(entities).filter((x) => x.evidence.length).length,
  generatedFallbackCount: Object.values(entities).filter((x) => x.generatedExample).length,
  entities,
}, null, 2)}\n`);

const bands = Object.groupBy(selected, (x) => x.row[6]);
const origins = Object.groupBy(selected, (x) => x.origin);
console.log(JSON.stringify({
  active: selected.length, registry: registry.length,
  bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, v.length])),
  origins: Object.fromEntries(Object.entries(origins).map(([k, v]) => [k, v.length])),
  retiredFromPreviousCore: chunks.filter((row) => !selected.some((x) => x.row[0] === row[0])).length,
}, null, 2));
