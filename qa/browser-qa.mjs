import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL ?? "http://127.0.0.1:4173/rikkyo-uk-vocab/";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  if (!(await page.getByText("教材データを接続待ちです").isVisible())) throw new Error("Data Gate is not visible");
  await page.goto(`${baseURL}?qa=storage`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Probeを実行" }).click();
  await page.getByText("PASS · Single Writer").waitFor();
  console.log("Browser QA PASS: Data Gate, mobile viewport, IndexedDB, Single Writer");
} finally {
  await browser.close();
}
