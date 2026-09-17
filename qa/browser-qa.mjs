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
  if (tuple.productVersion !== "3.3.1" || tuple.persistenceSchemaVersion !== 3 || tuple.datasetVersion !== "0.22.1-core" || tuple.enrichmentVersion !== "2026-09-17-fy24-fy26-ab") throw new Error("release tuple mismatch");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("mobile horizontal overflow");
  if (await page.locator("#schedule-filter").count()) throw new Error("A/B schedule output filter must not be shown");

  await page.locator("#session-size").selectOption("10");
  await page.locator("#study-mode").selectOption("exam");
  await page.getByRole("button", { name: "学習を始める" }).click();
  await page.locator("#input-answer").waitFor();
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
  await page.locator("#word-search").fill("come up with");
  await page.getByText("come up with", { exact: true }).click();
  await page.getByText("立教の出題傾向から生成した例文", { exact: true }).waitFor();

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
  console.log(`${pass}: v3.3.1 dark-mode contrast, unified A/B, exam difficulty, audio fallback, Waseda-parity retry, six-paper evidence, mobile, Resume, Export/Import and Backup CLEAN`);
} finally {
  await browser.close();
}
