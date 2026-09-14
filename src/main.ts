import "./styles.css";
import { APP_ID, CORE_ENTITY_COUNT, REGISTRY_ENTITY_COUNT, SCHEDULER_CONFIG } from "./config";
import { loadRuntimeBundle, type GateReport, type RuntimeBundle } from "./runtime";
import { openStudyDb, runStorageProbe, SingleWriter } from "./storage";

const root = document.querySelector<HTMLDivElement>("#app")!;

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shell(content: string): string {
  return `<header class="masthead"><a class="brand" href="./" aria-label="Rikkyo UK Vocab home"><span class="crest">R</span><span><b>RIKKYO UK</b><small>VOCABULARY STUDIO</small></span></a><span class="preview-pill">PREVIEW</span></header><main>${content}</main><footer>Phase 22 Preview · ${APP_ID}</footer>`;
}

function gateView(gate: GateReport): string {
  return shell(`
    <section class="hero">
      <div class="eyebrow">立教英国学院 入試英語</div>
      <h1>過去問から、<br><em>本当に必要な語彙</em>へ。</h1>
      <p class="lead">出題根拠と記憶科学をつないだ、Core 241専用の学習環境。</p>
      <div class="status-card" role="status">
        <div class="status-icon" aria-hidden="true">◌</div>
        <div><span class="label">DATA GATE</span><h2>教材データを接続待ちです</h2><p>${gate.reasons[0] ?? "Phase 17 runtime dataを確認できません。"}</p></div>
      </div>
      <div class="gate-grid">
        <article><span>CORE SCOPE</span><strong>${gate.mappedCore} / ${CORE_ENTITY_COUNT}</strong><p>Capability Adapter gate</p></article>
        <article><span>STABLE REGISTRY</span><strong>${REGISTRY_ENTITY_COUNT}</strong><p>IDは固定・再発行しません</p></article>
        <article><span>SCHEDULER</span><strong>${SCHEDULER_CONFIG.algorithm}</strong><p>retention ${SCHEDULER_CONFIG.desiredRetention.toFixed(2)} · fuzz off</p></article>
      </div>
      <aside class="notice"><b>Previewとして安全に停止中</b><p>画面・Storage・配信基盤は確認できます。実際の学習はPhase 17の正式データが241/241で通過するまで開始しません。</p></aside>
      <a class="text-link" href="?qa=storage">Storage QAを開く →</a>
    </section>`);
}

function studyView(): string {
  return shell(`<section class="hero"><div class="eyebrow">TODAY</div><h1>今日の学習</h1><p class="lead">Core 241の教材データを読み込み済みです。</p><button class="primary" id="start-study">学習を始める</button></section>`);
}

function renderStudyHome(bundle: RuntimeBundle): void {
  root.innerHTML = studyView();
  document.querySelector<HTMLButtonElement>("#start-study")?.addEventListener("click", () => {
    renderStudyCard(bundle, 0, false);
  });
}

function renderStudyCard(bundle: RuntimeBundle, index: number, revealed: boolean): void {
  const entity = bundle.core[index];
  if (!entity) {
    root.innerHTML = shell(`<section class="hero"><div class="eyebrow">COMPLETE</div><h1>学習完了</h1><p class="lead">Core 241を最後まで確認しました。</p><button class="primary" id="back-home">今日の学習へ戻る</button></section>`);
    document.querySelector<HTMLButtonElement>("#back-home")?.addEventListener("click", () => renderStudyHome(bundle));
    return;
  }

  const meaning = entity.senses[0]?.glossJa ?? "";
  root.innerHTML = shell(`
    <section class="hero">
      <div class="eyebrow">CORE 241 · ${index + 1} / ${bundle.core.length}</div>
      <h1>${esc(entity.lemma)}</h1>
      <p class="lead">${revealed ? esc(meaning) : "意味を思い出してから答えを確認してください。"}</p>
      <div class="status-card">
        <div class="status-icon" aria-hidden="true">${revealed ? "✓" : "?"}</div>
        <div>
          <span class="label">${revealed ? "ANSWER" : "FLASH CARD"}</span>
          <h2>${revealed ? esc(meaning) : esc(entity.pos)}</h2>
          <p>${revealed ? `stable ID: ${esc(entity.stableId)}` : "答えを見るまで日本語の意味は表示しません。"}</p>
        </div>
      </div>
      <button class="primary" id="study-action">${revealed ? (index + 1 < bundle.core.length ? "次の単語" : "学習を終える") : "意味を見る"}</button>
      <p><a class="text-link" id="study-home" href="#">← 今日の学習へ戻る</a></p>
    </section>`);

  document.querySelector<HTMLButtonElement>("#study-action")?.addEventListener("click", () => {
    if (!revealed) renderStudyCard(bundle, index, true);
    else renderStudyCard(bundle, index + 1, false);
  });
  document.querySelector<HTMLAnchorElement>("#study-home")?.addEventListener("click", (event) => {
    event.preventDefault();
    renderStudyHome(bundle);
  });
}

async function qaView(): Promise<void> {
  root.innerHTML = shell(`<section class="qa"><div class="eyebrow">ISOLATED SANDBOX</div><h1>Browser Storage QA</h1><p>Production DBを使わない専用Databaseで確認します。</p><button class="primary" id="run-probe">Probeを実行</button><div id="qa-results"></div><p><a class="text-link" href="?qa=writer">2タブ競合テスト →</a></p><a class="text-link" href="./">← Previewへ戻る</a></section>`);
  document.querySelector("#run-probe")?.addEventListener("click", async () => {
    const holder = document.querySelector<HTMLDivElement>("#qa-results")!;
    holder.innerHTML = `<p class="running">実行中…</p>`;
    try {
      const results = await runStorageProbe("rikkyo-uk-vocab-qa-sandbox-v1");
      holder.innerHTML = `<ul class="results">${results.map((item) => `<li class="${item.ok ? "pass" : "fail"}"><b>${item.ok ? "PASS" : "FAIL"} · ${item.name}</b><span>${item.detail}</span></li>`).join("")}</ul>`;
    } catch (error) {
      holder.innerHTML = `<p class="fail">FAIL · ${error instanceof Error ? error.message : String(error)}</p>`;
    }
  });
}

async function qaWriterView(): Promise<void> {
  root.innerHTML = shell(`<section class="qa"><div class="eyebrow">TWO-TAB SANDBOX</div><h1>Writer競合テスト</h1><p>同じURLを2タブで開き、片方だけがWriterになることを確認します。</p><div id="writer-result" class="status-card"><div class="status-icon">◌</div><div><span class="label">CHECKING</span><h2>leaseを確認中</h2></div></div></section>`);
  const db = await openStudyDb("rikkyo-uk-vocab-qa-two-tab-v1");
  const writer = new SingleWriter(db, "rikkyo-uk-vocab:coordination:qa-two-tab");
  const acquired = await writer.acquire();
  if (acquired) writer.startHeartbeat();
  const holder = document.querySelector<HTMLDivElement>("#writer-result")!;
  holder.innerHTML = `<div class="status-icon">${acquired ? "W" : "R"}</div><div><span class="label">${acquired ? "WRITER" : "READ-ONLY"}</span><h2>${acquired ? "このタブがWriterです" : "別タブがWriterです"}</h2><p>${acquired ? "heartbeatとfencing generationを保持しています。" : "回答commitは許可されません。"}</p></div>`;
  window.addEventListener("pagehide", () => { writer.close(); db.close(); }, { once: true });
}

async function boot(): Promise<void> {
  const qa = new URLSearchParams(location.search).get("qa");
  if (qa === "storage") return qaView();
  if (qa === "writer") return qaWriterView();
  const { bundle, gate } = await loadRuntimeBundle(import.meta.env.BASE_URL);
  if (gate.ok && bundle) renderStudyHome(bundle);
  else root.innerHTML = gateView(gate);
  try {
    const db = await openStudyDb();
    const writer = new SingleWriter(db);
    if (await writer.acquire()) writer.startHeartbeat();
    window.addEventListener("pagehide", () => { writer.close(); db.close(); }, { once: true });
  } catch (error) {
    console.error("Storage initialization failed", error);
  }
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(console.error);
  }
}

void boot();
