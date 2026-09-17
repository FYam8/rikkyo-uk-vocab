import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const SOURCES = [
  { key: "01", year: 2024, schedule: "A", path: new URL("../tmp/pdfs/01-ocr.txt", ROOT) },
  { key: "02", year: 2024, schedule: "B", path: new URL("../tmp/pdfs/02-ocr.txt", ROOT) },
  { key: "07", year: 2025, schedule: "A", path: new URL("../tmp/pdfs/07-ocr.txt", ROOT) },
  { key: "08", year: 2025, schedule: "B", path: new URL("../tmp/pdfs/08-ocr.txt", ROOT) },
  { key: "13", year: 2026, schedule: "A", path: new URL("../tmp/pdfs/13-ocr.txt", ROOT) },
  { key: "14", year: 2026, schedule: "B", path: new URL("../tmp/pdfs/14-ocr.txt", ROOT) },
];

const FALLBACKS = {
  "come up with": ["Can you come up with a better idea?", "もっとよい考えを思いつけますか。"],
  "follow instructions": ["Please follow instructions carefully.", "指示に注意深く従ってください。"],
  "get stuck": ["The bird may get stuck in the net.", "その鳥は網に引っかかるかもしれません。"],
  picture: ["She showed me a picture of the garden.", "彼女は庭の写真を私に見せました。"],
  finish: ["Please finish the work before dinner.", "夕食前に作業を終えてください。"],
  animal: ["The students studied a small animal.", "生徒たちは小さな動物を調べました。"],
  branch: ["A robin landed on the branch.", "コマドリが枝に止まりました。"],
  leaf: ["A leaf fell from the tree.", "木から葉が一枚落ちました。"],
  start: ["The lesson will start at nine.", "授業は9時に始まります。"],
  decide: ["They decided to wait for another day.", "彼らはもう一日待つことに決めました。"],
  sleep: ["The cat likes to sleep under the tree.", "その猫は木の下で眠るのが好きです。"],
  open: ["Please open the window.", "窓を開けてください。"],
  laugh: ["The brothers began to laugh together.", "兄弟は一緒に笑い始めました。"],
  thing: ["The most important thing is to keep trying.", "最も大切なことは努力を続けることです。"],
  parent: ["A parent came to watch the match.", "親が試合を見に来ました。"],
  cook: ["She likes to cook dinner for her family.", "彼女は家族のために夕食を作るのが好きです。"],
  borrow: ["May I borrow this book?", "この本を借りてもよいですか。"],
  seed: ["They planted a seed in the garden.", "彼らは庭に種を植えました。"],
  talk: ["I want to talk with my teacher.", "先生と話したいです。"],
  word: ["I do not know the meaning of this word.", "この単語の意味が分かりません。"],
  jump: ["The girl jumped up when she heard the news.", "少女は知らせを聞いて飛び上がりました。"],
};

const IRREGULAR = {
  buy: ["bought"], bring: ["brought"], come: ["came"], do: ["did", "done"],
  eat: ["ate", "eaten"], fall: ["fell", "fallen"], feed: ["fed"], feel: ["felt"],
  find: ["found"], fly: ["flew", "flown"], get: ["got", "gotten"], give: ["gave", "given"],
  go: ["went", "gone"], grow: ["grew", "grown"], hear: ["heard"], keep: ["kept"],
  know: ["knew", "known"], leave: ["left"], make: ["made"], read: ["read"],
  run: ["ran"], say: ["said"], see: ["saw", "seen"], sell: ["sold"],
  sit: ["sat"], speak: ["spoke", "spoken"], take: ["took", "taken"],
  teach: ["taught"], tell: ["told"], think: ["thought"], write: ["wrote", "written"],
};

function variants(lemma) {
  const lower = lemma.toLowerCase();
  if (lower.includes(" ")) return [lower];
  const out = new Set([lower, ...(IRREGULAR[lower] ?? [])]);
  if (lower.endsWith("y") && !/[aeiou]y$/.test(lower)) {
    out.add(`${lower.slice(0, -1)}ies`); out.add(`${lower.slice(0, -1)}ied`);
  } else {
    out.add(`${lower}s`); out.add(`${lower}ed`);
  }
  if (lower.endsWith("e")) out.add(`${lower.slice(0, -1)}ing`);
  else out.add(`${lower}ing`);
  return [...out];
}

function pages(text) {
  const parts = text.split(/===== PAGE\s+0?(\d+) =====/g);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ page: Number(parts[i]), text: parts[i + 1] ?? "" });
  return out;
}

function normalize(text) {
  return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

function sentences(text) {
  return normalize(text)
    .split(/(?<=[.!?])\s+(?=[A-Z"(])/)
    .map((s) => s.replace(/^.*?(?=[A-Z][a-z])/, "").trim())
    .filter((s) => s.length >= 28 && s.length <= 210 && (s.match(/[a-z]/g)?.length ?? 0) >= 18)
    .filter((s) => !/[\[\]_*|/]/.test(s) && !/\(\s*\)/.test(s) && !/\b[A-Z]{4,}\b/.test(s));
}

function regexFor(forms) {
  const body = forms.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
  return new RegExp(`\\b(?:${body})\\b`, "gi");
}

function category(source, page) {
  if (source.year === 2026 && page === 3) return "listening";
  if (source.year === 2026 && page >= 8) return "practical-reading";
  if (page <= 4) return "grammar";
  return "reading";
}

const chunks = (await Promise.all(
  Array.from({ length: 13 }, (_, i) => readFile(new URL(`../public/data/core-${String(i).padStart(2, "0")}.json`, import.meta.url), "utf8")),
)).flatMap((text) => JSON.parse(text));

const docs = [];
for (const source of SOURCES) {
  const text = await readFile(source.path, "utf8");
  docs.push({ ...source, pages: pages(text) });
}

const entities = {};
for (const row of chunks) {
  const [stableId, lemma, meaningJa, , priority, studyLayer, targetBand, schedules] = row;
  const forms = variants(lemma);
  const matcher = regexFor(forms);
  const evidence = [];
  let frequency = 0;
  let best = null;
  for (const doc of docs) for (const page of doc.pages) {
    const flat = normalize(page.text);
    const matches = flat.match(matcher) ?? [];
    if (!matches.length) continue;
    frequency += matches.length;
    evidence.push({ year: doc.year, schedule: doc.schedule, page: page.page, count: matches.length, category: category(doc, page.page) });
    for (const sentence of sentences(page.text)) {
      const match = sentence.match(regexFor(forms));
      if (!match) continue;
      const score = (page.page >= 5 ? 20 : 0) + Math.min(sentence.length, 150) - Math.abs(110 - sentence.length);
      if (!best || score > best.score) best = { score, sentence, matchedForm: match[0], year: doc.year, schedule: doc.schedule, page: page.page };
    }
  }
  const years = [...new Set(evidence.map((x) => x.year))].sort();
  const sourceSchedules = [...new Set(evidence.map((x) => x.schedule))].sort();
  const fallback = FALLBACKS[lemma];
  const exactCloze = best && best.matchedForm.toLowerCase() === lemma.toLowerCase()
    ? best.sentence.replace(regexFor([best.matchedForm]), "_____")
    : null;
  const fallbackCloze = fallback ? fallback[0].replace(regexFor([lemma]), "_____") : null;
  entities[stableId] = {
    stableId, lemma, meaningJa, priority, studyLayer, targetBand, schedules,
    observedFrequency: frequency,
    years,
    sourceSchedules,
    categories: [...new Set(evidence.map((x) => x.category))],
    evidence,
    sourceExample: best ? { sentence: best.sentence, matchedForm: best.matchedForm, year: best.year, schedule: best.schedule, page: best.page } : null,
    generatedExample: fallback ? { sentence: fallback[0], ja: fallback[1], provenance: "generated-from-rikkyo-patterns" } : null,
    cloze: exactCloze ? { sentence: exactCloze, answer: lemma, provenance: "past-paper-derived" } : fallbackCloze?.includes("_____") ? { sentence: fallbackCloze, answer: lemma, provenance: "generated-from-rikkyo-patterns" } : null,
  };
}

const value = {
  format: "rikkyo-vocab-enrichment/v1",
  version: "2026-09-17-fy24-fy26-ab",
  sourceScope: ["FY24-A", "FY24-B", "FY25-A", "FY25-B", "FY26-A", "FY26-B"],
  generationMethod: "OCR-assisted exact/inflection matching with learner-facing generated fallbacks; source examples remain labelled",
  entityCount: Object.keys(entities).length,
  sourceMatchedEntityCount: Object.values(entities).filter((x) => x.evidence.length).length,
  generatedFallbackCount: Object.values(entities).filter((x) => x.generatedExample).length,
  entities,
};

await writeFile(new URL("../public/data/enrichment.json", import.meta.url), `${JSON.stringify(value, null, 2)}\n`);
console.log(JSON.stringify({ entityCount: value.entityCount, sourceMatchedEntityCount: value.sourceMatchedEntityCount, generatedFallbackCount: value.generatedFallbackCount }));
