import "./styles.css";
import { APP_ID } from "./config";
import { Rating, newCard, schedule, type FsrsCard } from "./fsrsAdapter";
import { loadRuntimeBundle, type RuntimeBundle, type RuntimeEntity } from "./runtime";
import {
  openStudyDb,
  readStudyEvents,
  readStudyMemory,
  runStorageProbe,
  SingleWriter,
  type StudyMemory,
} from "./storage";

const root = document.querySelector<HTMLDivElement>("#app")!;

type StudyMode = "recommend" | "review" | "unseen" | "weak";
type StudyRange = "all" | "Foundation" | "Core";

interface AppContext {
  bundle: RuntimeBundle;
  db: IDBDatabase;
  writer: SingleWriter;
  writable: boolean;
}

interface SessionState {
  mode: StudyMode;
  range: StudyRange;
  queue: RuntimeEntity[];
  index: number;
  correct: number;
  wrong: number;
  memory: Map<string, StudyMemory>;
  locked: boolean;
}

const modeLabels: Record<StudyMode, string> = {
  recommend: "おすすめ",
  review: "復習優先",
  unseen: "未学習",
  weak: "苦手重点",
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function localDayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shell(title: string, subtitle: string, content: string, extra = ""): string {
  return `<div class="app-shell">
    <header class="topbar">
      <div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
      <button class="icon-button" id="speak-global" type="button" aria-label="英語を読み上げる">🔊</button>
    </header>
    ${content}
    ${extra}
    <footer>立教英国 Vocabulary Coach · Core 241 · ${APP_ID}</footer>
  </div>`;
}

function priorityRank(priority?: string): number {
  return priority === "S" ? 0 : priority === "A" ? 1 : priority === "B" ? 2 : 3;
}

function isDue(memory: StudyMemory | undefined, now = Date.now()): boolean {
  return Boolean(memory && new Date(memory.dueAt).getTime() <= now);
}

function isWeak(memory: StudyMemory | undefined): boolean {
  return Boolean(memory && memory.wrong > 0 && memory.wrong >= memory.correct);
}

function isMastered(memory: StudyMemory | undefined): boolean {
  return Boolean(memory && memory.correct >= 2 && memory.correct > memory.wrong && new Date(memory.dueAt).getTime() > Date.now());
}

function eligibleEntities(bundle: RuntimeBundle, range: StudyRange): RuntimeEntity[] {
  return bundle.core.filter((entity) => entity.quizEligible !== false && (range === "all" || entity.targetBand === range));
}

function sortForMode(entities: RuntimeEntity[], memory: Map<string, StudyMemory>, mode: StudyMode): RuntimeEntity[] {
  const now = Date.now();
  const filtered = entities.filter((entity) => {
    const item = memory.get(entity.stableId);
    if (mode === "review") return Boolean(item);
    if (mode === "unseen") return !item;
    if (mode === "weak") return isWeak(item);
    return true;
  });

  return [...filtered].sort((a, b) => {
    const ma = memory.get(a.stableId);
    const mb = memory.get(b.stableId);
    if (mode === "recommend") {
      const lane = (m: StudyMemory | undefined) => isDue(m, now) ? 0 : !m ? 1 : isWeak(m) ? 2 : 3;
      const diff = lane(ma) - lane(mb);
      if (diff !== 0) return diff;
      if (ma && mb && isDue(ma, now) && isDue(mb, now)) {
        const dueDiff = new Date(ma.dueAt).getTime() - new Date(mb.dueAt).getTime();
        if (dueDiff !== 0) return dueDiff;
      }
    }
    const p = priorityRank(a.priority) - priorityRank(b.priority);
    if (p !== 0) return p;
    const wrongDiff = (mb?.wrong ?? 0) - (ma?.wrong ?? 0);
    if (wrongDiff !== 0) return wrongDiff;
    return a.stableId.localeCompare(b.stableId);
  });
}

function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  utterance.rate = 0.88;
  speechSynthesis.speak(utterance);
}

async function homeView(ctx: AppContext): Promise<void> {
  const memory = await readStudyMemory(ctx.db);
  const events = await readStudyEvents(ctx.db);
  const normal = eligibleEntities(ctx.bundle, "all");
  const today = localDayKey();
  const todayAnswered = events.filter((event) => {
    const answeredAt = event.payload.answeredAt;
    return typeof answeredAt === "string" && localDayKey(new Date(answeredAt)) === today;
  }).length;
  const unseen = normal.filter((entity) => !memory.has(entity.stableId)).length;
  const weak = normal.filter((entity) => isWeak(memory.get(entity.stableId))).length;
  const mastered = normal.filter((entity) => isMastered(memory.get(entity.stableId))).length;
  const due = normal.filter((entity) => isDue(memory.get(entity.stableId))).length;
  const mastery = normal.length ? Math.round((mastered / normal.length) * 100) : 0;

  root.innerHTML = shell(
    "おすすめ",
    "立教英国 2024–2026 過去問・Core 241 適応学習",
    `<section class="panel setup-panel">
      <h2>次に覚える語を自動選択</h2>
      <p class="muted">過去問実績 × 入試上の重要度 × 学習履歴 × 復習期限で優先順位を決めます。</p>
      <div class="field full"><label for="mode">学習モード</label><select id="mode">
        <option value="recommend">おすすめ</option><option value="review">復習優先</option><option value="unseen">未学習</option><option value="weak">苦手重点</option>
      </select></div>
      <div class="field-grid">
        <div class="field"><label for="range">範囲</label><select id="range"><option value="all">Core 241 全体</option><option value="Foundation">Foundation</option><option value="Core">Core</option></select></div>
        <div class="field"><label for="count">問題数</label><select id="count"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></div>
      </div>
      <button class="primary" id="start-study" ${ctx.writable ? "" : "disabled"}>${ctx.writable ? "学習を始める" : "別タブで学習中"}</button>
      ${ctx.writable ? "" : '<p class="writer-note">学習履歴を守るため、回答できるタブは1つだけです。別タブを閉じて再読み込みしてください。</p>'}
    </section>
    <section class="panel progress-panel">
      <div class="progress-heading"><h2>今日の進捗</h2><span>復習期限 ${due}語</span></div>
      <div class="stats-grid">
        <article><strong>${todayAnswered}</strong><span>今日回答</span></article>
        <article><strong>${unseen}</strong><span>未学習</span></article>
        <article><strong>${weak}</strong><span>苦手</span></article>
        <article><strong>${mastery}%</strong><span>習得率</span></article>
      </div>
    </section>
    <section class="panel info-panel"><h2>この単語帳の設計</h2><p>立教英国のFY24–FY26英語6冊を統合し、入試水準へ再選定した241語を学習します。正誤は回答結果から記録し、復習時期はFSRS-6で調整します。</p><div class="scope-line"><span>Active ${ctx.bundle.core.length}/241</span><span>Stable IDs ${ctx.bundle.registry.length}/801</span><span>data ${esc(ctx.bundle.manifest.dataVersion)}</span></div></section>`,
  );

  document.querySelector("#speak-global")?.addEventListener("click", () => speak("Rikkyo UK Vocabulary Coach"));
  document.querySelector("#start-study")?.addEventListener("click", async () => {
    const mode = (document.querySelector<HTMLSelectElement>("#mode")?.value ?? "recommend") as StudyMode;
    const range = (document.querySelector<HTMLSelectElement>("#range")?.value ?? "all") as StudyRange;
    const count = Number(document.querySelector<HTMLSelectElement>("#count")?.value ?? 20);
    const latest = await readStudyMemory(ctx.db);
    const queue = sortForMode(eligibleEntities(ctx.bundle, range), latest, mode).slice(0, count);
    if (queue.length === 0) {
      alert(mode === "weak" ? "現在、苦手語はありません。" : "この条件で出題できる語がありません。");
      return;
    }
    const session: SessionState = { mode, range, queue, index: 0, correct: 0, wrong: 0, memory: latest, locked: false };
    studyQuestion(ctx, session);
  });
}

function choiceMeanings(bundle: RuntimeBundle, target: RuntimeEntity): string[] {
  const answer = target.senses[0]!.glossJa;
  const pool = bundle.core
    .filter((entity) => entity.stableId !== target.stableId && entity.quizEligible !== false)
    .map((entity) => entity.senses[0]!.glossJa)
    .filter((value, index, arr) => value !== answer && arr.indexOf(value) === index);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const choices = [answer, ...pool.slice(0, 3)];
  for (let i = choices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }
  return choices;
}

function studyQuestion(ctx: AppContext, session: SessionState): void {
  if (session.index >= session.queue.length) {
    finishView(ctx, session);
    return;
  }
  session.locked = false;
  const entity = session.queue[session.index]!;
  const choices = choiceMeanings(ctx.bundle, entity);
  const scheduleLabel = entity.schedules?.length ? entity.schedules.join("/") : "A/B";
  const currentNumber = session.index + 1;

  root.innerHTML = shell(
    `学習中 | ${modeLabels[session.mode]}`,
    "立教英国 Core 241",
    `<div class="study-meta"><div><b>${currentNumber}/${session.queue.length}</b> 正解 ${session.correct} / 不正解 ${session.wrong}</div><button class="secondary" id="end-study">終了</button></div>
    <section class="question-card">
      <div class="question-top"><span>選択式・英→日</span><div class="badges"><b class="badge priority">${esc(entity.priority ?? "B")}</b><b class="badge band">${esc(entity.targetBand ?? "Core")}</b><b class="badge schedule">${esc(scheduleLabel)}</b></div></div>
      <h2 class="word">${esc(entity.lemma)}</h2>
      <button class="speaker" id="speak-word" type="button" aria-label="${esc(entity.lemma)}を読み上げる">🔊</button>
      <p class="prompt">最も適切な意味を選ぶ</p>
      <div class="choices">${choices.map((choice) => `<button class="choice" data-choice="${esc(choice)}">${esc(choice)}</button>`).join("")}</div>
      <div id="feedback" class="feedback" aria-live="polite"></div>
    </section>`,
  );

  document.querySelector("#speak-global")?.addEventListener("click", () => speak(entity.lemma));
  document.querySelector("#speak-word")?.addEventListener("click", () => speak(entity.lemma));
  document.querySelector("#end-study")?.addEventListener("click", () => finishView(ctx, session));

  document.querySelectorAll<HTMLButtonElement>(".choice").forEach((button) => {
    button.addEventListener("click", async () => {
      if (session.locked) return;
      session.locked = true;
      const selected = button.dataset.choice ?? "";
      const correctMeaning = entity.senses[0]!.glossJa;
      const correct = selected === correctMeaning;
      if (correct) session.correct += 1; else session.wrong += 1;

      document.querySelectorAll<HTMLButtonElement>(".choice").forEach((choiceButton) => {
        choiceButton.disabled = true;
        if (choiceButton.dataset.choice === correctMeaning) choiceButton.classList.add("correct");
        else if (choiceButton === button && !correct) choiceButton.classList.add("incorrect");
      });

      const now = new Date();
      const previous = session.memory.get(entity.stableId);
      const rawCard = previous?.card as FsrsCard | undefined;
      const card = rawCard ?? newCard(now);
      const nextCard = schedule(card, correct ? Rating.Good : Rating.Again, now);
      const memory: StudyMemory = {
        key: `word:${entity.stableId}`,
        stableId: entity.stableId,
        card: nextCard,
        correct: (previous?.correct ?? 0) + (correct ? 1 : 0),
        wrong: (previous?.wrong ?? 0) + (correct ? 0 : 1),
        lastSeenAt: now.toISOString(),
        dueAt: nextCard.due.toISOString(),
        lastResult: correct ? "correct" : "wrong",
      };
      const eventId = crypto.randomUUID();
      try {
        await ctx.writer.commitReview(eventId, {
          type: "review",
          stableId: entity.stableId,
          correct,
          answeredAt: now.toISOString(),
          mode: session.mode,
          rating: correct ? "Good" : "Again",
        }, memory);
        session.memory.set(entity.stableId, memory);
      } catch (error) {
        console.error(error);
      }

      const feedback = document.querySelector<HTMLDivElement>("#feedback")!;
      feedback.innerHTML = `<div class="${correct ? "feedback-ok" : "feedback-ng"}"><b>${correct ? "正解" : "不正解"}</b><span>${esc(entity.lemma)} = ${esc(correctMeaning)}</span></div><button class="primary next-button" id="next-question">${session.index + 1 >= session.queue.length ? "結果を見る" : "次へ"}</button>`;
      document.querySelector("#next-question")?.addEventListener("click", () => {
        session.index += 1;
        studyQuestion(ctx, session);
      });
    });
  });
}

function finishView(ctx: AppContext, session: SessionState): void {
  const total = session.correct + session.wrong;
  const accuracy = total ? Math.round((session.correct / total) * 100) : 0;
  root.innerHTML = shell(
    "学習結果",
    `${modeLabels[session.mode]} セッション`,
    `<section class="panel result-panel"><p class="result-kicker">SESSION COMPLETE</p><h2>${total}問 おつかれさまでした</h2><div class="stats-grid result-stats"><article><strong>${session.correct}</strong><span>正解</span></article><article><strong>${session.wrong}</strong><span>不正解</span></article><article><strong>${accuracy}%</strong><span>正答率</span></article><article><strong>${session.queue.length}</strong><span>出題語</span></article></div><button class="primary" id="back-home">ホームへ戻る</button></section>`,
  );
  document.querySelector("#back-home")?.addEventListener("click", () => void homeView(ctx));
  document.querySelector("#speak-global")?.addEventListener("click", () => speak("Good job"));
}

function gateView(reason: string): void {
  root.innerHTML = shell("教材を確認中", "立教英国 Vocabulary Coach", `<section class="panel gate-panel"><h2>教材データを読み込めませんでした</h2><p>${esc(reason)}</p><p class="muted">ページを再読み込みしても解消しない場合は、公開データの整合性を確認してください。</p></section>`);
}

async function qaView(): Promise<void> {
  root.innerHTML = shell("Storage QA", "立教英国専用 sandbox", `<section class="panel qa"><h2>Browser Storage QA</h2><p>本番学習DBを使わない専用Databaseで確認します。</p><button class="primary" id="run-probe">Probeを実行</button><div id="qa-results"></div><a class="text-link" href="./">← 学習画面へ戻る</a></section>`);
  document.querySelector("#run-probe")?.addEventListener("click", async () => {
    const holder = document.querySelector<HTMLDivElement>("#qa-results")!;
    holder.innerHTML = `<p>実行中…</p>`;
    try {
      const results = await runStorageProbe("rikkyo-uk-vocab-qa-sandbox-v1");
      holder.innerHTML = `<ul class="results">${results.map((item) => `<li class="${item.ok ? "pass" : "fail"}"><b>${item.ok ? "PASS" : "FAIL"} · ${esc(item.name)}</b><span>${esc(item.detail)}</span></li>`).join("")}</ul>`;
    } catch (error) {
      holder.innerHTML = `<p class="fail">FAIL · ${esc(error instanceof Error ? error.message : String(error))}</p>`;
    }
  });
}

async function boot(): Promise<void> {
  const qa = new URLSearchParams(location.search).get("qa");
  if (qa === "storage") return qaView();

  const { bundle, gate } = await loadRuntimeBundle(import.meta.env.BASE_URL);
  if (!bundle || !gate.ok) {
    gateView(gate.reasons[0] ?? "Core 241 runtime gate failed.");
    return;
  }

  try {
    const db = await openStudyDb();
    const writer = new SingleWriter(db);
    const writable = await writer.acquire();
    if (writable) writer.startHeartbeat();
    const ctx: AppContext = { bundle, db, writer, writable };
    await homeView(ctx);
    window.addEventListener("pagehide", () => { writer.close(); db.close(); }, { once: true });
  } catch (error) {
    console.error("Storage initialization failed", error);
    gateView("学習履歴の保存領域を初期化できませんでした。");
  }

  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(console.error);
  }
}

void boot();
