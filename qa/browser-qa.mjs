import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const baseURL = process.env.QA_BASE_URL ?? "http://127.0.0.1:4173/rikkyo-uk-vocab/";
const pass = process.env.QA_PASS ?? "QA";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "今日やること" }).waitFor();
  const tuple = await page.evaluate(async () => (await fetch("./release-manifest.json", { cache: "no-store" })).json());
  if (tuple.productVersion !== "3.1.0" || tuple.persistenceSchemaVersion !== 3 || tuple.datasetVersion !== "0.22.1-core" || tuple.enrichmentVersion !== "2026-09-17-fy24-fy26-ab") throw new Error("release tuple mismatch");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("mobile horizontal overflow");

  await page.locator("#session-size").selectOption("10");
  await page.locator("#study-mode").selectOption("random");
  await page.getByRole("button", { name: "この設定で始める" }).click();
  await page.locator(".rich-choice").first().dblclick();
  await page.getByRole("button", { name: "次へ" }).waitFor();
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
  if (!activeBeforeReload) throw new Error("active session missing before reload");

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

  await page.getByRole("link", { name: "分析" }).click();
  await page.getByRole("heading", { name: "過去問分析" }).waitFor();
  await page.getByText("6冊", { exact: true }).waitFor();
  await page.getByText("235/241", { exact: true }).waitFor();

  await page.getByRole("link", { name: "単語" }).click();
  await page.locator("#word-search").fill("come up with");
  await page.getByText("come up with", { exact: true }).click();
  await page.getByText("立教の出題傾向から生成した例文", { exact: true }).waitFor();

  await page.getByRole("link", { name: "設定" }).click();
  await page.getByRole("heading", { name: "設定" }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  if (!exportPath) throw new Error("export download path missing");
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  if (exported.exportFormat !== "rikkyo-uk-vocab-export/v3" || exported.persistenceSchemaVersion !== 3 || exported.activeSession?.resumeIndex !== 1) throw new Error("v3 export contract mismatch");

  await page.getByRole("button", { name: "Browser Backup" }).click();
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

  const navigation = page.waitForEvent("load");
  await page.locator("#import-data").setInputFiles(exportPath);
  await navigation;
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
  console.log(`${pass}: v3.1 parity UI, six-paper evidence, mobile, duplicate-grade, Resume, Export/Import and Backup CLEAN`);
} finally {
  await browser.close();
}
