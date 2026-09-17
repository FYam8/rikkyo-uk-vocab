import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const baseURL = process.env.QA_BASE_URL ?? "http://127.0.0.1:4173/rikkyo-uk-vocab/";
const pass = process.env.QA_PASS ?? "QA";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "学習", exact: true }).waitFor();
  const tuple = await page.evaluate(async () => (await fetch("./release-manifest.json", { cache: "no-store" })).json());
  if (tuple.productVersion !== "3.5.4" || tuple.persistenceSchemaVersion !== 3 || tuple.datasetVersion !== "0.24.0-lexical" || tuple.enrichmentVersion !== "2026-09-17-reselected-v3") throw new Error("release tuple mismatch");

  const legacyContext = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const legacyPage = await legacyContext.newPage();
  const legacyUrl = new URL(baseURL);
  legacyUrl.searchParams.set("legacy-shell", "v3.5.0");
  await legacyPage.route(legacyUrl.href, (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html lang="ja"><body><div id="app"></div><script type="module" src="/rikkyo-uk-vocab/assets/index-CwJusQDL.js"></script></body></html>',
  }));
  await legacyPage.goto(legacyUrl.href, { waitUntil: "networkidle" });
  await legacyPage.getByRole("heading", { name: "学習", exact: true }).waitFor();
  await legacyContext.close();

  const repairContext = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const seedPage = await repairContext.newPage();
  await seedPage.goto(baseURL, { waitUntil: "networkidle" });
  await seedPage.getByRole("heading", { name: "学習", exact: true }).waitFor();
  await seedPage.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-main-v1", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["meta", "memory", "sessions", "coordination"], "readwrite");
      const generation = tx.objectStore("meta").get("generation");
      generation.onsuccess = () => {
        const generationId = generation.result.generationId;
        tx.objectStore("meta").delete("preferences");
        tx.objectStore("memory").put({ key: "skill:qa-preserved:meaningRecognition", stableId: "qa-preserved", skillKey: "meaningRecognition", generationId, stage: "learning", card: null, stepIndex: 0, dueAt: new Date().toISOString(), correct: 2, wrong: 1, lapses: 0, episodeId: "qa", provisionalUntil: null, lastSeenAt: null, lastAppliedRevision: 1 });
        tx.objectStore("sessions").put({ key: "active-session", generationId, sessionId: "corrupt-session", mode: "study", queue: [{ questionInstanceId: "corrupt-question", stableId: "retired-stable-id", skillKey: "meaningRecognition" }], resumeIndex: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastAppliedRevision: 1 });
        tx.objectStore("coordination").put({ key: "writer", ownerId: "stale-safari-tab", generation: 999, expiresAt: Date.now() + 60_000 });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }));
  await seedPage.close();
  const repairedPage = await repairContext.newPage();
  await repairedPage.goto(`${baseURL}?qa=corrupt-startup`, { waitUntil: "networkidle" });
  await repairedPage.getByRole("heading", { name: "学習", exact: true }).waitFor();
  const repaired = await repairedPage.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-main-v1", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction(["meta", "memory", "sessions"], "readonly");
      const preferences = tx.objectStore("meta").get("preferences");
      const memory = tx.objectStore("memory").get("skill:qa-preserved:meaningRecognition");
      const active = tx.objectStore("sessions").get("active-session");
      tx.oncomplete = () => resolve({ preferences: preferences.result, memory: memory.result, active: active.result });
      tx.onerror = () => reject(tx.error);
    };
  }));
  if (!repaired.preferences || repaired.memory?.correct !== 2 || repaired.active) throw new Error("Safari startup repair did not preserve learning history or clear invalid transient state");
  await repairContext.close();

  const clozeContext = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const clozeSeed = await clozeContext.newPage();
  await clozeSeed.goto(baseURL, { waitUntil: "networkidle" });
  await clozeSeed.getByRole("heading", { name: "学習", exact: true }).waitFor();
  const method = await clozeSeed.evaluate(async () => {
    const data = await fetch("./data/enrichment.json", { cache: "no-store" }).then((response) => response.json());
    const entities = Object.values(data.entities);
    if (entities.some((item) => item.cloze?.sentence.includes("The passage uses") || item.generatedExample?.sentence.includes("The passage uses"))) throw new Error("generic cloze placeholder remains");
    return entities.find((item) => item.lemma === "method");
  });
  if (method?.cloze?.sentence !== "The electricity experiment will take place next week, so please review your class notes and _____." || method.cloze.provenance !== "past-paper-derived") throw new Error("method source cloze mismatch");
  await clozeSeed.evaluate(async (methodItem) => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-main-v1", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["meta", "sessions"], "readwrite");
      const generation = tx.objectStore("meta").get("generation");
      generation.onsuccess = () => {
        const now = new Date().toISOString();
        tx.objectStore("sessions").put({ key: "active-session", generationId: generation.result.generationId, sessionId: "qa-method-cloze", mode: "study", queue: [{ questionInstanceId: "qa-method-question", stableId: methodItem.stableId, skillKey: "formProduction", lane: "acquisition", kind: "clozeInput", prompt: "方法", context: methodItem.cloze.sentence, choices: [], answer: "method", sourceLabel: "FY26 A · PDF p.8" }], resumeIndex: 0, startedAt: now, updatedAt: now, baseTotal: 1, correct: 0, wrong: 0, retryAnswered: 0, missedStableIds: [], lastAppliedRevision: generation.result.revision });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), method);
  await clozeSeed.close();
  const clozePage = await clozeContext.newPage();
  await clozePage.goto(baseURL, { waitUntil: "networkidle" });
  await clozePage.getByText("The electricity experiment will take place next week, so please review your class notes and _____.", { exact: true }).waitFor();
  await clozePage.getByText("意味：方法", { exact: true }).waitFor();
  await clozePage.locator(".question-flags").getByText("新出", { exact: true }).waitFor();
  if (await clozePage.locator(".question-flags").getByText("acquisition", { exact: true }).count()) throw new Error("internal acquisition label is visible");
  await clozeContext.close();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("mobile horizontal overflow");
  if (await page.locator("#schedule-filter").count()) throw new Error("A/B schedule output filter must not be shown");

  const contender = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const contenderDialogs = [];
  contender.on("dialog", async (dialog) => { contenderDialogs.push(dialog.message()); await dialog.dismiss(); });
  await contender.goto(baseURL, { waitUntil: "networkidle" });
  await contender.getByRole("button", { name: "学習を始める" }).click();
  await contender.locator(".study-card").waitFor();
  await contender.locator("#stop-session").click();
  await contender.close();
  if (contenderDialogs.some((message) => message.includes("別タブ") || message.includes("Writer"))) throw new Error(`writer handoff dialog detected: ${contenderDialogs.join(" / ")}`);

  await page.getByRole("link", { name: /一覧/ }).click();
  if (await page.locator('#word-filter option[value="A"], #word-filter option[value="B"]').count()) throw new Error("A/B word filters must not be shown");
  await page.locator("#word-filter").selectOption("challenge");
  await page.getByText("60語", { exact: true }).waitFor();
  if (Number((await page.locator(".result-count").innerText()).replace(/\D/g, "")) !== 60) throw new Error("Challenge band count mismatch");
  await page.locator("#word-search").fill("photosynthesis");
  await page.getByText("photosynthesis", { exact: true }).waitFor();
  await page.getByRole("link", { name: /学習/ }).click();

  const writerDialogs = [];
  const writerDialogHandler = async (dialog) => { writerDialogs.push(dialog.message()); await dialog.dismiss(); };
  page.on("dialog", writerDialogHandler);
  await page.locator("#session-size").selectOption("10");
  await page.locator("#study-mode").selectOption("exam");
  await page.getByRole("button", { name: "学習を始める" }).click();
  await page.locator("#input-answer").waitFor();
  page.off("dialog", writerDialogHandler);
  if (writerDialogs.some((message) => message.includes("別タブ") || message.includes("Writer"))) throw new Error(`writer handoff dialog detected: ${writerDialogs.join(" / ")}`);
  await page.locator("#stop-session").click();
  await page.getByRole("heading", { name: "学習", exact: true }).waitFor();
  await page.getByRole("link", { name: /設定/ }).click();
  await page.locator("#audio-questions").selectOption("off");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "設定を保存" }).click();
  await page.getByRole("link", { name: /学習/ }).click();

  await page.locator("#session-size").selectOption("10");
  await page.locator("#study-mode").selectOption("random");
  await page.getByRole("button", { name: "学習を始める" }).click();
  await page.locator(".rich-choice").first().waitFor();
  await page.waitForTimeout(300);
  const activeQuestion = await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-main-v1", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const get = request.result.transaction("sessions", "readonly").objectStore("sessions").get("active-session");
      get.onsuccess = () => resolve(get.result?.queue?.[0] ?? null); get.onerror = () => reject(get.error);
    };
  }));
  const wrongChoice = await page.locator(".rich-choice").evaluateAll((buttons, answer) => buttons.find((button) => button.dataset.answer !== answer)?.dataset.answer, activeQuestion.answer);
  if (!wrongChoice) throw new Error("wrong choice fixture missing");
  await page.getByRole("button", { name: wrongChoice, exact: true }).dblclick();
  await page.getByRole("button", { name: "次へ" }).waitFor();
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  const contrast = await page.evaluate(() => {
    const channel = (value) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const rgb = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value) => { const [r, g, b] = rgb(value).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const effectiveBackground = (element) => {
      let current = element;
      while (current) {
        const value = getComputedStyle(current).backgroundColor;
        const parts = value.match(/[\d.]+/g) ?? [];
        if (parts.length === 3 || Number(parts[3]) > 0) return value;
        current = current.parentElement;
      }
      return "rgb(0, 0, 0)";
    };
    const ratio = (element) => { const style = getComputedStyle(element); const a = luminance(style.color), b = luminance(effectiveBackground(element)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const selectors = [".feedback span", ".rich-choice.correct-choice", ".rich-choice.wrong-choice", ".exam-example small"];
    return Object.fromEntries(selectors.map((selector) => { const element = document.querySelector(selector); return [selector, element ? ratio(element) : null]; }));
  });
  for (const [selector, ratio] of Object.entries(contrast)) {
    if (ratio === null) throw new Error(`dark-mode contrast target missing: ${selector}`);
    if (ratio < 4.5) throw new Error(`dark-mode contrast below 4.5 for ${selector}: ${ratio}`);
  }
  const eventCount = await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-main-v1", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("events", "readonly");
      const get = tx.objectStore("events").getAll();
      get.onsuccess = () => resolve(get.result.filter((x) => x.type === "AnswerCommitted").length);
      get.onerror = () => reject(get.error);
    };
  }));
  if (eventCount !== 1) throw new Error(`duplicate grading detected: ${eventCount}`);
  const activeBeforeReload = await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-main-v1", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const get = request.result.transaction("sessions", "readonly").objectStore("sessions").get("active-session");
      get.onsuccess = () => resolve(get.result ?? null); get.onerror = () => reject(get.error);
    };
  }));
  if (!activeBeforeReload || activeBeforeReload.queue.length !== 11 || activeBeforeReload.wrong !== 1 || !activeBeforeReload.queue.some((q) => q.isRetry && q.retryOf === activeQuestion.questionInstanceId) || activeBeforeReload.queue.some((q) => q.kind === "audioChoice" || q.kind === "audioInput")) throw new Error("active session/retry/audio fallback mismatch before reload");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  if (!(await page.locator(".study-card").isVisible())) {
    console.error("resume debug", { url: page.url(), body: (await page.locator("body").innerText()).slice(0, 1200) });
  }
  await page.locator(".study-card").waitFor();
  const afterReload = await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-main-v1", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["events", "sessions"], "readonly");
      const events = tx.objectStore("events").getAll();
      const active = tx.objectStore("sessions").get("active-session");
      tx.oncomplete = () => resolve({ answers: events.result.filter((x) => x.type === "AnswerCommitted").length, resumeIndex: active.result?.resumeIndex });
      tx.onerror = () => reject(tx.error);
    };
  }));
  if (afterReload.answers !== 1 || afterReload.resumeIndex !== 1) throw new Error(`resume mismatch: ${JSON.stringify(afterReload)}`);

  await page.getByRole("link", { name: /分析/ }).click();
  await page.getByRole("heading", { name: "過去問分析" }).waitFor();
  await page.getByText("分析冊数", { exact: true }).waitFor();
  await page.getByText("出典照合語", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "確認回数 TOP 100" }).waitFor();

  await page.getByRole("link", { name: /一覧/ }).click();
  await page.locator("#word-search").fill("photosynthesis");
  await page.getByText("photosynthesis", { exact: true }).click();
  await page.getByText(/過去問での出現|立教の出題傾向から生成した例文/).waitFor();

  await page.getByRole("link", { name: /設定/ }).click();
  await page.getByRole("heading", { name: "設定" }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "書き出す" }).click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  if (!exportPath) throw new Error("export download path missing");
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  if (exported.exportFormat !== "rikkyo-uk-vocab-export/v3" || exported.persistenceSchemaVersion !== 3 || exported.activeSession?.resumeIndex !== 1) throw new Error("v3 export contract mismatch");

  await page.getByRole("button", { name: "端末内バックアップ" }).click();
  await page.getByText("manual").waitFor();
  const backup = await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-backup-v1", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const get = request.result.transaction("manifests", "readonly").objectStore("manifests").getAll();
      get.onsuccess = () => resolve(get.result.filter((item) => item.complete).at(-1)); get.onerror = () => reject(get.error);
    };
  }));
  if (!backup?.complete || backup.rootHash?.length !== 64) throw new Error("browser backup root hash missing");

  let importDialog = "";
  page.once("dialog", async (dialog) => { importDialog = dialog.message(); await dialog.dismiss(); });
  const navigation = page.waitForEvent("load", { timeout: 15000 }).catch(() => null);
  await page.locator("#import-data").setInputFiles(exportPath);
  if (!await navigation) throw new Error(`import did not reload${importDialog ? `: ${importDialog}` : ""}`);
  await page.waitForLoadState("networkidle");
  const imported = await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open("rikkyo-uk-vocab-main-v1", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(["meta", "memory", "events", "sessions"], "readonly");
      const generation = tx.objectStore("meta").get("generation");
      const memory = tx.objectStore("memory").getAll();
      const events = tx.objectStore("events").getAll();
      const active = tx.objectStore("sessions").get("active-session");
      tx.oncomplete = () => resolve({ generation: generation.result, memory: memory.result, events: events.result, active: active.result });
      tx.onerror = () => reject(tx.error);
    };
  }));
  if (imported.generation?.persistenceSchemaVersion !== 3 || imported.memory.length < 1 || imported.events.filter((x) => x.type === "AnswerCommitted").length !== 1 || imported.active?.resumeIndex !== 1) throw new Error("v3 import/history/session preservation mismatch");
  console.log(`${pass}: v3.5.4 valid source cloze, Japanese lane labels, Safari startup repair, stale-shell recovery, writer handoff, lexical difficulty, Challenge 60, unified A/B, dark-mode contrast, audio fallback, Waseda-parity retry, six-paper transfer, mobile, Resume, Export/Import and Backup CLEAN`);
} finally {
  await browser.close();
}
