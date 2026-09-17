import type { RuntimeBundle, RuntimeEntity } from "../runtime";
import type { BackupManifest, DailyPlanRecord, Preferences, QuestionRun, SkillState } from "./types";

export type Route = "home" | "study" | "diagnostic" | "words" | "stats" | "analysis" | "settings";
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const MODE_OPTIONS = [
  ["recommended", "おすすめ学習"], ["foundation", "基礎重点"], ["core", "Core重点"],
  ["unlearned", "未学習"], ["weak", "苦手"], ["review", "復習期限"],
  ["frequent", "頻出語"], ["random", "ランダム"],
] as const;

export function shell(route: Route, body: string): string {
  const nav = [["home", "今日"], ["words", "単語"], ["stats", "進捗"], ["analysis", "分析"], ["settings", "設定"]] as const;
  return `<header class="masthead"><a class="brand" href="#home"><span class="crest">R</span><span><b>RIKKYO UK</b><small>VOCABULARY STUDIO</small></span></a><span class="preview-pill">CORE 241</span></header><main>${body}</main><nav class="learner-nav">${nav.map(([r, l]) => `<a href="#${r}" class="${route === r ? "active" : ""}">${l}</a>`).join("")}</nav><footer>立教英国学院 入試英語 · Adaptive Vocabulary</footer>`;
}

function stageLabel(s?: SkillState): string {
  if (!s) return "未学習";
  return s.stage === "learning" ? "学習中" : s.stage === "relearning" ? "再学習" : s.stage === "provisional" ? "仮習得" : s.stage === "acquisitionCandidate" ? "導入待ち" : "復習";
}

export function homeView(input: { bundle: RuntimeBundle; plan: DailyPlanRecord; memory: SkillState[]; answeredToday: number; activeSeconds: number; diagnosticCompleted: boolean; preferences: Preferences }): string {
  const now = Date.now();
  const due = input.memory.filter((x) => Date.parse(x.dueAt) <= now).length;
  const weak = new Set(input.memory.filter((x) => x.wrong > x.correct).map((x) => x.stableId)).size;
  const active = new Set(input.memory.map((x) => x.stableId)).size;
  const mastered = new Set(input.memory.filter((x) => x.stage === "review" && x.correct >= 2 && x.correct > x.wrong).map((x) => x.stableId)).size;
  const remainMin = Math.max(0, Math.ceil((input.plan.targetSeconds - input.activeSeconds) / 60));
  const mode = input.preferences.studyMode ?? "recommended", schedule = input.preferences.scheduleFilter ?? "all", size = input.preferences.sessionSize ?? 20;
  return shell("home", `<section class="hero compact-hero"><div class="eyebrow">TODAY</div><h1>今日やること</h1><p class="lead">復習期限・苦手・過去問頻度・新規導入を自動で調整します。</p>
    <div class="learn-controls"><label>学習モード<select id="study-mode">${MODE_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === mode ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>日程<select id="schedule-filter"><option value="all" ${schedule === "all" ? "selected" : ""}>A/B共通</option><option value="A" ${schedule === "A" ? "selected" : ""}>A日程</option><option value="B" ${schedule === "B" ? "selected" : ""}>B日程</option></select></label><label>問題数<select id="session-size"><option value="10" ${size === 10 ? "selected" : ""}>10問</option><option value="20" ${size === 20 ? "selected" : ""}>20問</option><option value="40" ${size === 40 ? "selected" : ""}>40問</option><option value="0" ${size === 0 ? "selected" : ""}>できるだけ</option></select></label></div>
    <div class="today-card"><div><span class="label">TODAY PLAN</span><h2>${due} 復習 · ${weak} 苦手</h2><p>目安あと ${remainMin}分 · Core進捗 ${active}/241</p></div><button class="primary" id="start-study">この設定で始める</button></div>
    <div class="gate-grid stats"><article><span>今日回答</span><strong>${input.answeredToday}</strong><p>回答済み</p></article><article><span>習得</span><strong>${mastered}</strong><p>review安定</p></article><article><span>新規上限</span><strong>${input.plan.introducedStableIds.length}/12</strong><p>1日あたり</p></article></div>
    ${input.diagnosticCompleted ? "" : `<aside class="notice"><b>初回診断</b><p>最大24問で既知語を仮判定し、後日の確認問題で確定します。診断ミスはlapseには数えません。</p><button class="secondary" id="start-diagnostic">診断を始める</button></aside>`}
    <section class="info-strip"><b>Core ${input.bundle.core.length}/241</b><span>FY24-FY26 A/B</span><span>6形式 · FSRS-6</span><span>retention 0.90</span></section></section>`);
}

function exampleBlock(entity: RuntimeEntity): string {
  if (entity.sourceExample) {
    const ex = entity.sourceExample;
    return `<div class="exam-example"><b>過去問での出現 · FY${String(ex.year).slice(-2)} ${esc(ex.schedule)} · PDF p.${ex.page}</b><p>${esc(ex.sentence)}</p><small>中心語義: ${esc(entity.senses[0]?.glossJa ?? "")}</small></div>`;
  }
  if (entity.generatedExample) return `<div class="exam-example generated"><b>立教の出題傾向から生成した例文</b><p>${esc(entity.generatedExample.sentence)}</p><small>${esc(entity.generatedExample.ja)}</small></div>`;
  return "";
}

export function questionView(q: QuestionRun, entity: RuntimeEntity, index: number, total: number, mode: "study" | "diagnostic", feedback?: { rating: string; answer: string; given: string }): string {
  const audio = q.kind === "audioChoice" || q.kind === "audioInput";
  const instruction = q.kind === "reverseChoice" ? "対応する英語を選んでください" : q.kind === "input" ? "対応する英語を入力してください" : q.kind === "audioChoice" ? "音声を聞いて意味を選んでください" : q.kind === "audioInput" ? "音声を聞いて英語を入力してください" : q.kind === "clozeChoice" ? "空所に入る語句を選んでください" : "最も適切な意味を選んでください";
  const choices = q.choices.length ? `<div class="rich-choices">${q.choices.map((c) => { const state = feedback ? c === q.answer ? "correct-choice" : c === feedback.given ? "wrong-choice" : "" : ""; return `<button class="rich-choice ${state}" data-answer="${esc(c)}" ${feedback ? "disabled" : ""}>${esc(c)}</button>`; }).join("")}</div>` : `<form id="input-answer" class="answer-form"><input id="answer-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="英語で入力" ${feedback ? "disabled" : ""}/><button class="primary" ${feedback ? "disabled" : ""}>答える</button></form>`;
  const title = audio ? `<button id="speak-word" class="audio-orb" type="button" aria-label="音声を聞く">🔊</button>` : q.kind === "clozeChoice" ? `<div class="cloze-prompt">${esc(q.context ?? "")}</div>` : `<h2>${esc(q.prompt)}</h2>${q.skillKey === "meaningRecognition" ? `<button id="speak-word" class="speaker" type="button">🔊</button>` : ""}`;
  return shell(mode === "diagnostic" ? "diagnostic" : "study", `<section class="study-screen"><div class="study-meta"><span>${mode === "diagnostic" ? "DIAGNOSTIC" : "TODAY"} · ${index + 1}/${total}</span><button class="text-button" id="stop-session">終了</button></div><article class="study-card"><div class="question-flags"><span>${esc(q.kind ?? "meaningChoice")}</span><span>${esc(q.lane)}</span><span>${esc(entity.priority ?? "")}</span>${q.sourceLabel ? `<span>${esc(q.sourceLabel)}</span>` : ""}</div>${title}<p class="study-instruction">${instruction}</p>${choices}${feedback ? `<div class="feedback ${feedback.rating === "Again" ? "ng" : "ok"}"><b>${feedback.rating === "Again" ? "もう一度" : "正解"}</b><span>正答: ${esc(feedback.answer)}</span></div>${exampleBlock(entity)}<button class="primary" id="next-question">次へ</button>` : ""}</article></section>`);
}

export function wordsView(bundle: RuntimeBundle, memory: SkillState[], query = "", filter = "all"): string {
  const byId = new Map<string, SkillState[]>(); for (const s of memory) byId.set(s.stableId, [...(byId.get(s.stableId) ?? []), s]);
  const q = query.trim().toLowerCase();
  const rows = bundle.core.filter((e) => !q || e.lemma.toLowerCase().includes(q) || (e.senses[0]?.glossJa ?? "").includes(q)).filter((e) => { const states = byId.get(e.stableId) ?? []; if (filter === "weak") return states.some((x) => x.wrong > x.correct); if (filter === "unseen") return states.length === 0; if (filter === "due") return states.some((x) => Date.parse(x.dueAt) <= Date.now()); if (filter === "foundation") return e.targetBand === "Foundation"; if (filter === "frequent") return e.observedFrequency >= 3 || e.priority === "S"; return true; });
  return shell("words", `<section class="page"><div class="eyebrow">CORE 241</div><h1>単語一覧</h1><div class="word-tools"><input id="word-search" value="${esc(query)}" placeholder="英語・日本語で検索"><select id="word-filter"><option value="all" ${filter === "all" ? "selected" : ""}>すべて</option><option value="foundation" ${filter === "foundation" ? "selected" : ""}>基礎</option><option value="frequent" ${filter === "frequent" ? "selected" : ""}>頻出</option><option value="weak" ${filter === "weak" ? "selected" : ""}>苦手</option><option value="due" ${filter === "due" ? "selected" : ""}>復習期限</option><option value="unseen" ${filter === "unseen" ? "selected" : ""}>未学習</option></select></div><div class="word-list">${rows.map((e) => { const ss = byId.get(e.stableId) ?? []; const source = e.years.length ? `FY${e.years.map((y) => String(y).slice(-2)).join("/")} · ${e.observedFrequency}回確認` : "生成補完"; return `<details><summary><div><b>${esc(e.lemma)}</b><span>${esc(e.priority)} · ${esc(e.targetBand)} · ${esc((e.schedules ?? []).join("/"))}</span></div><p>${esc(e.senses[0]?.glossJa ?? "")}</p><small>${ss.length ? ss.map((x) => `${x.skillKey}:${stageLabel(x)}`).join(" / ") : "未学習"}</small></summary><div class="word-detail"><p><b>過去問根拠:</b> ${esc(source)}</p><p><b>カテゴリー:</b> ${esc(e.categories.join(" / ") || "補完データ")}</p>${exampleBlock(e)}</div></details>`; }).join("")}</div></section>`);
}

export function statsView(bundle: RuntimeBundle, memory: SkillState[], events: Array<{ type?: string; at?: string; payload?: Record<string, unknown> }>): string {
  const review = memory.filter((x) => x.stage === "review").length, learning = memory.filter((x) => x.stage === "learning" || x.stage === "relearning").length, provisional = memory.filter((x) => x.stage === "provisional").length;
  const weak = new Set(memory.filter((x) => x.wrong > x.correct).map((x) => x.stableId)).size, entities = new Set(memory.map((x) => x.stableId)).size;
  const attempts = events.filter((x) => x.type === "AnswerCommitted" || x.type === "DiagnosticAnswer").length, foundation = bundle.core.filter((x) => x.targetBand === "Foundation").length;
  return shell("stats", `<section class="page"><div class="eyebrow">PROGRESS</div><h1>学習の進捗</h1><div class="gate-grid stats"><article><span>Core進捗</span><strong>${entities}/241</strong><p>学習開始済み</p></article><article><span>Review skills</span><strong>${review}</strong><p>長期復習へ移行</p></article><article><span>苦手語</span><strong>${weak}</strong><p>誤答優勢</p></article></div><div class="status-card light"><div class="status-icon">✓</div><div><span class="label">MEMORY MODEL</span><h2>学習 ${learning} · 仮習得 ${provisional}</h2><p>総回答 ${attempts}。意味認識と語形産出を別々に管理します。</p></div></div><div class="analysis-mini"><span>Foundation ${foundation}</span><span>Core ${bundle.core.length - foundation}</span><span>FSRS-6 · 90%</span></div><p class="muted-block">対象データ: ${bundle.manifest.dataVersion} / enrichment ${bundle.manifest.enrichmentVersion}</p></section>`);
}

export function analysisView(bundle: RuntimeBundle): string {
  const matched = bundle.core.filter((x) => x.evidence.length).length, examples = bundle.core.filter((x) => x.sourceExample).length;
  const byYear = [2024, 2025, 2026].map((year) => ({ year, count: bundle.core.filter((x) => x.years.includes(year)).length }));
  const bySchedule = ["A", "B"].map((schedule) => ({ schedule, count: bundle.core.filter((x) => x.sourceSchedules.includes(schedule)).length }));
  const top = [...bundle.core].sort((a, b) => b.observedFrequency - a.observedFrequency || a.lemma.localeCompare(b.lemma)).slice(0, 20);
  return shell("analysis", `<section class="page"><div class="eyebrow">PAST PAPER ANALYSIS</div><h1>過去問分析</h1><p class="lead">FY24-FY26の英語A/B計6冊を、同一Core IDに紐づけて分析しています。</p><div class="gate-grid stats"><article><span>分析対象</span><strong>6冊</strong><p>3年度 × A/B</p></article><article><span>出典照合</span><strong>${matched}/241</strong><p>OCR＋語形照合</p></article><article><span>例文回収</span><strong>${examples}</strong><p>出典表示つき</p></article></div><div class="analysis-grid"><section><h2>年度別</h2>${byYear.map((x) => `<div class="bar-row"><span>FY${String(x.year).slice(-2)}</span><progress max="241" value="${x.count}"></progress><b>${x.count}</b></div>`).join("")}</section><section><h2>日程別</h2>${bySchedule.map((x) => `<div class="bar-row"><span>${x.schedule}日程</span><progress max="241" value="${x.count}"></progress><b>${x.count}</b></div>`).join("")}</section></div><section class="top-table"><h2>過去問内の確認回数 上位20語</h2><div class="table-scroll"><table><thead><tr><th>語</th><th>意味</th><th>回数</th><th>年度</th><th>優先度</th></tr></thead><tbody>${top.map((e) => `<tr><td><b>${esc(e.lemma)}</b></td><td>${esc(e.senses[0]?.glossJa ?? "")}</td><td>${e.observedFrequency}</td><td>${esc(e.years.map((y) => `FY${String(y).slice(-2)}`).join("/"))}</td><td>${esc(e.priority)}</td></tr>`).join("")}</tbody></table></div></section><p class="muted-block">生成例文は過去問原文と明確に分離して表示します。Listening音源・公式解答がない箇所は推測で補完しません。</p></section>`);
}

export function settingsView(prefs: Preferences, backups: BackupManifest[]): string {
  const accent = prefs.accent ?? "auto", theme = prefs.theme ?? "auto";
  return shell("settings", `<section class="page"><div class="eyebrow">SETTINGS & RECOVERY</div><h1>設定</h1><form id="settings-form" class="settings-card"><label>1日の目安（分）<input id="daily-target" type="number" min="5" max="120" value="${Math.round(prefs.dailyTargetSeconds / 60)}"></label><label>学習タイムゾーン<input id="time-zone" value="${esc(prefs.learningTimeZone)}"></label><label>試験日<input id="exam-date" type="date" value="${esc(prefs.examDate ?? "")}"></label><label>発音<select id="accent"><option value="auto" ${accent === "auto" ? "selected" : ""}>自動</option><option value="gb" ${accent === "gb" ? "selected" : ""}>イギリス英語</option><option value="us" ${accent === "us" ? "selected" : ""}>アメリカ英語</option></select></label><label>音声<select id="voice"><option value="">端末の標準音声</option></select></label><label>表示テーマ<select id="theme"><option value="auto" ${theme === "auto" ? "selected" : ""}>端末設定</option><option value="light" ${theme === "light" ? "selected" : ""}>ライト</option><option value="dark" ${theme === "dark" ? "selected" : ""}>ダーク</option></select></label><button class="primary">保存</button></form><section class="recovery-card"><h2>バックアップ・復元</h2><p>ブラウザ内Backup DBと外部Exportは別レイヤーです。Import/Restore/Resetは新しいstate generationとして復元します。</p><div class="button-row"><button class="secondary" id="export-data">Export</button><button class="secondary" id="browser-backup">Browser Backup</button><label class="file-button">Import<input id="import-data" type="file" accept="application/json"></label><button class="danger" id="reset-data">学習データをリセット</button></div><div class="backup-list">${backups.length ? backups.map((b) => `<div><span>${new Date(b.createdAt).toLocaleString("ja-JP")} · ${esc(b.purpose)}</span><button class="text-button restore-backup" data-id="${esc(b.snapshotId)}">復元</button></div>`).join("") : "<p>ブラウザバックアップはまだありません。</p>"}</div></section></section>`);
}
