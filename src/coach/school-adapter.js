/* School data labels, device capabilities and the legacy persistence boundary.
   No scoring, mastery, forgetting-curve, distractor or session algorithms here. */
MODE_OPTIONS.splice(0,MODE_OPTIONS.length,
  ['recommended','おすすめ学習'],['exam','実戦トレーニング'],['60','基礎重点'],['70','Core重点'],['75','過去問Challenge重点'],['optional','追加の語彙（任意）'],
  ['unlearned','未学習'],['weak','苦手'],['review','復習期限'],['frequent','頻出語'],['random','ランダム']);
const RIKKYO_MODE_MAP={foundation:'60',core:'70',challenge:'75'};
const RIKKYO_KIND_MAP={meaningChoice:'choice',reverseChoice:'reverseChoice',input:'reverse',audioChoice:'audioChoice',audioInput:'audio',clozeChoice:'cloze',clozeInput:'cloze'};

function rikkyoConvertLegacy(old){
  const next=defaultState(),prefs=old.preferences||{};
  next.settings={...next.settings,mode:RIKKYO_MODE_MAP[prefs.studyMode]||prefs.studyMode||'recommended',
    sessionSize:prefs.sessionSize??20,accent:prefs.accent||'auto',voiceURI:prefs.voiceURI||'',theme:prefs.theme||'auto',
    audioQuestions:prefs.audioQuestions||'auto',examDate:prefs.examDate||''};
  const events=[...(old.events||[])].filter(e=>['AnswerCommitted','DiagnosticAnswer'].includes(e.type)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const seen=new Set();
  for(const event of events){
    const payload=event.payload||{},id=payload.stableId,qid=payload.questionInstanceId||event.key;
    if(!id||seen.has(qid))continue;seen.add(qid);
    const p=next.words[id]||(next.words[id]=defaultProgress());
    const ok=event.type==='DiagnosticAnswer'?payload.correct===true:payload.result==='correct';
    // Diagnostic misses were explicitly not learning mistakes in v3.
    if(event.type==='DiagnosticAnswer'&&!ok)continue;
    if(ok){p.correct++;p.streak++}else{p.incorrect++;p.streak=0}
    const type=payload.skillKey==='formProduction'?'reverse':'choice';
    recordObjectiveResult(p,ok,type);
    const result=p.recentResults.at(-1);result.at=event.at;result.questionInstanceId=qid;
    p.lastStudied=event.at;p.lastRating=ok?'got':'miss';
  }
  const grouped=new Map();
  for(const m of old.memory||[]){if(!grouped.has(m.stableId))grouped.set(m.stableId,[]);grouped.get(m.stableId).push(m)}
  for(const [id,memories] of grouped){
    const p=next.words[id]||(next.words[id]=defaultProgress());
    p.correct=Math.max(p.correct,memories.reduce((n,m)=>n+(Number(m.correct)||0),0));
    p.incorrect=Math.max(p.incorrect,memories.reduce((n,m)=>n+(Number(m.wrong)||0),0));
    const latest=[...memories].sort((a,b)=>Date.parse(b.lastSeenAt||'1970-01-01')-Date.parse(a.lastSeenAt||'1970-01-01'))[0];
    if(latest.lastSeenAt && (!p.lastStudied||Date.parse(latest.lastSeenAt)>Date.parse(p.lastStudied)))p.lastStudied=latest.lastSeenAt;
    p.nextReview=latest.dueAt||null;
    if(!p.recentResults.length){p.evidence=Math.min(4,p.correct);p.mastery=masteryFromEvidence(p)}
    if(p.lastRating==='miss')p.recentMistakeUntil=new Date(Date.parse(p.lastStudied)+3*86400000).toISOString();
    // Leave memoryModel absent: the *upstream* v76InferMemoryModel lazily seeds
    // it from the retained lastStudied/nextReview on the next scored answer.
  }
  next.stats.totalAnswers=Math.max(seen.size,Object.values(next.words).reduce((n,p)=>n+attemptCount(p),0));
  next.stats.todayCount=events.filter(e=>localDayKey(new Date(e.at))===localDayKey()).length;
  next.stats.totalSessions=(old.events||[]).filter(e=>e.type==='SessionClosed'&&e.payload?.reason==='completed').length;
  next.dataVersion=META.dataVersion;
  const saved=old.activeSession;
  if(!saved||!Array.isArray(saved.queue))return {state:next,session:null};
  let index=saved.resumeIndex||0;
  while(index<saved.queue.length&&seen.has(saved.queue[index].questionInstanceId))index++;
  const answered=saved.queue.slice(0,index),remaining=saved.queue.slice(index).filter(q=>VOCAB_BY_ID.has(q.stableId));
  if(!remaining.length)return {state:next,session:null};
  const q=remaining[0],v=VOCAB_BY_ID.get(q.stableId);
  let type=RIKKYO_KIND_MAP[q.kind]||(q.choices?.length?'choice':'reverse');
  if(type==='cloze'&&!CLOZE[v.word])type='reverse';
  const choices=(q.choices||[]).map(label=>VOCAB.find(x=>(type==='choice'||type==='audioChoice'?x.meaning:x.word)===label)?.id).filter(Boolean);
  if(!choices.includes(v.id))choices.unshift(v.id);
  const choiceIds=choices.length===4&&new Set(choices).size===4?choices:[];
  const bases=saved.queue.filter(x=>!x.isRetry&&VOCAB_BY_ID.has(x.stableId));
  const baseQueueIds=[...new Set(bases.map(x=>x.stableId))];
  const baseAnswered=answered.filter(x=>!x.isRetry).length;
  const total=Number(saved.correct||0)+Number(saved.wrong||0);
  const session={sessionFormatVersion:1,dataVersion:META.dataVersion,sessionId:saved.sessionId,createdAt:saved.startedAt,updatedAt:saved.updatedAt,
    mode:next.settings.mode,year:'all',requestedSessionSize:baseQueueIds.length,actualSessionSize:baseQueueIds.length,unlimited:false,
    candidatePoolIds:[],generatedBaseIds:[],baseQueueIds,baseCursor:baseAnswered+(q.isRetry?0:1),baseAnswered,
    retryAnswered:saved.retryAnswered||0,totalAnswered:total,correct:saved.correct||0,wrong:saved.wrong||0,masteryUps:0,
    currentQuestion:{questionInstanceId:q.questionInstanceId,wordId:v.id,type,isRetry:!!q.isRetry,submitted:false,outcomeApplied:false,draft:'',choiceIds,selectedChoiceId:null,userAnswer:'',ok:null,reason:''},
    questionHistory:answered.map(x=>({questionInstanceId:x.questionInstanceId,wordId:x.stableId,isRetry:!!x.isRetry})),
    recentIds:answered.slice(-14).map(x=>x.stableId),retryCounts:Object.fromEntries(answered.filter(x=>x.isRetry).map(x=>[x.stableId,1])),
    retryQueue:remaining.slice(1).filter(x=>x.isRetry).map(x=>({wordId:x.stableId,dueAfterTotal:total+WASEDA_PLANNING_POLICY.retryGap(VOCAB_BY_ID.get(x.stableId))})),
    blockedIds:[],missedIds:saved.missedStableIds||[],weakIds:[],newFixedIds:[],pendingOutcome:null,challengeBaseCount:baseQueueIds.filter(id=>VOCAB_BY_ID.get(id).studyLayer==='challenge').length,baseReasons:{}};
  return {state:next,session};
}
window.RikkyoConvertLegacy=rikkyoConvertLegacy;
if(!window.RikkyoHost.get(STORAGE_KEY)){
  const migrated=window.RikkyoHost.legacy?rikkyoConvertLegacy(window.RikkyoHost.legacy):{state:defaultState(),session:null};
  state=migrated.state;window.RikkyoHost.initialize(state,migrated.session);
}

window.RikkyoMergeBackup=function(incoming,active){
  if(session&&session.active||loadActiveSession())throw new Error('途中セッションを終了してから読み込んでください。');
  if(active&&!validateActiveSession(active)){
    const ids=[...(active.baseQueueIds||[]),...(active.candidatePoolIds||[]),...(active.currentQuestion?[active.currentQuestion.wordId,...(active.currentQuestion.choiceIds||[])]:[])];
    if(ids.some(id=>!VOCAB_BY_ID.has(id)))throw new Error('途中セッションの単語IDを確認できません。');
    active=null;showToast('履歴を読み込み、以前の出題は終了しました。追加語は任意モードで学習できます。');
  }
  mergeImported({app:'立教英国学院 Vocabulary Coach',state:incoming});
  if(active){wasedaStorageSet(V75_ACTIVE_SESSION_KEY,JSON.stringify({...active,dataVersion:META.dataVersion}));location.reload()}
};
exportData=function(){if(session&&session.active)persistActiveSession();window.RikkyoHost.export().catch(e=>showToast(e.message,{kind:'error'}))};
handleImport=function(file){file.text().then(JSON.parse).then(raw=>window.RikkyoHost.import(raw)).catch(e=>showToast(e.message,{kind:'error'}))};

// Source text stays byte-for-byte identical to the reviewed excerpt bank.
const rikkyoExampleRenderer=examExampleHTML;
examExampleHTML=function(v){
 const ex=EXAM_EXAMPLES[v.id];
 if(ex?.mode!=='exact')return rikkyoExampleRenderer(v).replace('過去問例文 · 年度 練習用例文','練習例文').replace(/同年度の検証済み例文レコードが未登録のため、代表例として年度の実例を表示しています。/g,'同年度の原文例文が未登録のため、練習用に作成した例文を表示しています。');
 const labels={reading:'本文',notice:'案内・メッセージ',grammar:'文法問題',question:'設問・選択肢','listening-question':'リスニングの設問・選択肢（紙面）',writing:'英作文の課題',gapped:'空欄を含む原題',reorder:'語句整序の原題','error-correction':'誤り訂正の原題'};
 const notes={'error-correction':'誤りを含む訂正前の原題です。正しい完成文の例ではありません。',reorder:'語順と選択語を原題のまま掲載しています。',gapped:'空欄を補わず、原題のまま掲載しています。'};
 let note=notes[ex.kind]||'';
 if(ex.inferredTarget)note+=' 見出し語の完成形は原題に印刷されていません。';
 const selectedYear=v75SelectedYear();
 if(selectedYear!=='all'&&selectedYear!=null&&Number(selectedYear)!==ex.year)note+=` 表示している原文は${ex.year}年度です。年度指定は出題語の抽出条件です。`;
 if(v.word==='support')note+=' この原文の support は名詞「支援」として使われています。';
 const raw=ex.sentence,form=ex.matchedForm||'',i=form?raw.toLowerCase().indexOf(form.toLowerCase()):-1;
 const sentence=i<0?esc(raw):esc(raw.slice(0,i))+`<b>${esc(raw.slice(i,i+form.length))}</b>`+esc(raw.slice(i+form.length));
 return `<div class="exam-example"><div class="exam-example-head">過去問原文（${esc(labels[ex.kind]||'本文')}） · ${ex.year}年度 英語${esc(ex.schedule)}・PDF p.${ex.page}</div><div class="exam-example-sentence">${sentence}</div><div class="exam-example-ja"><span class="exam-example-ja-label">和訳</span>${esc(ex.ja)}</div>${note?`<div class="exam-example-note">${esc(note)}</div>`:''}</div>`;
};
function rikkyoOptionalLabels(root){
 for(const node of root?.querySelectorAll('.l')||[]){
  if(node.textContent==='参照のみ')node.textContent='追加学習（任意）';
  if(node.textContent==='75点挑戦')node.textContent='過去問Challenge';
 }
}
const rikkyoStatsRenderer=renderStats;
renderStats=function(){rikkyoStatsRenderer();rikkyoOptionalLabels($('statsGrid'))};
const rikkyoAnalysisRenderer=renderAnalysis;
renderAnalysis=function(){
  rikkyoAnalysisRenderer();
  const note=document.getElementById('analysisCandidateNote');if(note)note.textContent=`固定ID台帳は${META.rawCandidateEntries}件、学習対象は${VOCAB.length}項目です。過去問の出題語と発展語を区別して収録しています。`;
  const help=$('evidenceCountHelp');if(help)help.textContent='回数は6冊の本文・設問・選択肢の転記を集計。活用形をまとめ、共通指示・解答例・日本語注釈欄・未入手の音声は除外しています。語句整序の完成形を推定した項目は回数に加えません。';
  rikkyoOptionalLabels($('analysisCounts'));
  const description=$('analysisCounts').querySelector('.small.muted');if(description)description.textContent='通常モードは冊子で出現した309項目、追加学習（任意）は未出現・完成形未掲載の117項目が対象です。出題優先度・再確認・習熟度・忘却曲線は早稲田と同じ処理です。';
};

// Device-only capability fallback. The selected type still comes from the
// original Waseda chooseType; no alternative learning policy is introduced.
const rikkyoChooseType=chooseType;
function rikkyoTextType(type){return type==='audio'?'reverse':type==='audioChoice'?'choice':type}
chooseType=function(v,isRetry=false){
  const type=rikkyoChooseType(v,isRetry);
  return state.settings.audioQuestions==='off'||!('speechSynthesis' in window)?rikkyoTextType(type):type;
};
const rikkyoQuestionRenderer=v75RenderCurrentQuestion;
v75RenderCurrentQuestion=function(){
  if(state.settings.audioQuestions==='off'||!('speechSynthesis' in window))currentQuestion.type=rikkyoTextType(currentQuestion.type);
  rikkyoQuestionRenderer();
  if(['audio','audioChoice'].includes(currentQuestion.type)&&!currentQuestion.submitted){
    const button=document.createElement('button');button.className='secondary full';button.id='audioFallback';button.textContent='音声が使えない場合';
    button.onclick=()=>{currentQuestion.type=rikkyoTextType(currentQuestion.type);persistActiveSession();v75RenderCurrentQuestion()};$('promptArea').append(button);
  }
};
const rikkyoInit=init;
init=function(){
  rikkyoInit();
  const settings=$('view-settings');
  const card=document.createElement('div');card.className='card';
  card.innerHTML='<h2>端末とバックアップ</h2><div class="field"><label for="audioQuestions">音声問題</label><select id="audioQuestions"><option value="auto">自動</option><option value="off">使用しない</option></select></div><button class="secondary full" id="localBackup" style="margin-top:14px">端末内バックアップ</button><div id="savedBackups"></div><p class="tiny muted">立教版 4.2.0 · 早稲田 Vocabulary Coach v7.6</p>';
  settings.append(card);$('audioQuestions').value=state.settings.audioQuestions||'auto';
  $('audioQuestions').onchange=e=>{state.settings.audioQuestions=e.target.value;markSettingsUpdated();saveState()};
  async function showBackups(){
    const rows=await window.RikkyoHost.backups();$('savedBackups').replaceChildren();
    for(const row of rows){
      const b=document.createElement('button');b.className='secondary full';b.textContent=new Date(row.label).toLocaleString('ja-JP')+' を復元';
      b.onclick=()=>window.RikkyoHost.restore(row.id,row.kind).then(()=>showToast('バックアップを統合しました')).catch(e=>showToast(e.message,{kind:'error'}));$('savedBackups').append(b);
    }
  }
  $('localBackup').onclick=()=>window.RikkyoHost.saveBackup().then(showBackups).then(()=>showToast('バックアップしました')).catch(e=>showToast(e.message,{kind:'error'}));
  showBackups().catch(console.error);
};

// School-owned provenance presentation; no change to shared learning policy.
LAYER_LABEL.challenge='過去問Challenge';
LAYER_LABEL.reference='追加学習（任意）';
const rikkyoBadges=badgeHTML;
badgeHTML=function(v){
 const source=v.sourceScope==='extension'?'発展語':v.frequency?'過去問出現語':'文法の出題対象';
 return rikkyoBadges(v)+`<span class="badge">${esc(source)}</span>`;
};
v75CompactEvidence=function(v){
 if(v.sourceScope==='extension')return '発展語<br>冊子内の出現未確認';
 if(!v.frequency)return '文法の出題対象<br>完成形の掲載 0回';
 return `${v.frequency}回 / ${v.paperCount}試験<br>${v.observedYears.length}年度（${v.observedYears.join(', ')}）`;
};
v75EvidenceDetail=function(v){
 const rows=(v.evidence||[]).map(e=>`<li>FY${String(e.year).slice(-2)} ${esc(e.schedule)} · PDF ${e.page}ページ · ${e.count}回（${esc(e.forms.join(' / '))}）</li>`).join('');
 const targets=(v.questionTargetEvidence||[]).map(e=>`<li>FY${String(e.year).slice(-2)} ${esc(e.schedule)} · PDF ${e.page}ページ · 文法の出題対象（完成形の登場回数には含めません）</li>`).join('');
 return `<div class="small">${v75CompactEvidence(v)}${v.glossedInSource?'<p>原本に日本語注釈がある語です。同じ物語内での反復だけでは最優先にしません。</p>':''}${rows||targets?`<ul>${rows}${targets}</ul>`:'<p>関連する発展学習用の語です。今回の6冊の集計対象箇所では出現を確認していません。</p>'}<p>回数は活用形をまとめた冊子内の集計です。共通指示・解答例・日本語注釈欄・未入手の音声は含みません。</p></div>`;
};
const rikkyoCoverageInit=init;
init=function(){
 rikkyoCoverageInit();
 const past=VOCAB.filter(v=>v.ordinaryEligible).length,extension=VOCAB.length-past;
 const intro=document.createElement('p');intro.className='small muted';intro.id='coverageSummary';
 intro.textContent=`通常学習は、冊子で出現を確認した${past}項目が対象です。未出現・完成形未掲載の${extension}項目は「追加の語彙（任意）」を選んだ場合だけ出題します。登録は計${VOCAB.length}項目です。`;
 $('view-learn').prepend(intro);
};

// School-owned curriculum opt-in. Reference entries are excluded by the
// unmodified shared planner AND distractor generator in all ordinary modes.
const rikkyoFilterPool=filterPool;
filterPool=function(mode,year){
 return mode==='optional'?VOCAB.filter(v=>!v.ordinaryEligible):rikkyoFilterPool(mode,year);
};
const rikkyoValidateSession=validateActiveSession;
validateActiveSession=function(saved){
 if(saved?.mode!=='optional'){
   const ids=[...(saved?.baseQueueIds||[]),...(saved?.candidatePoolIds||[]),...(saved?.generatedBaseIds||[]),...(saved?.retryQueue||[]).map(x=>x.wordId),...(saved?.currentQuestion?[saved.currentQuestion.wordId,...(saved.currentQuestion.choiceIds||[])]:[])];
   if(ids.some(id=>!VOCAB_BY_ID.get(id)?.ordinaryEligible))return false;
   return rikkyoValidateSession(saved);
 }
 const ids=[...(saved.baseQueueIds||[]),...(saved.candidatePoolIds||[]),...(saved.generatedBaseIds||[]),...(saved.retryQueue||[]).map(x=>x.wordId),...(saved.currentQuestion?[saved.currentQuestion.wordId]:[])];
 return ids.every(id=>VOCAB_BY_ID.has(id)&&!VOCAB_BY_ID.get(id).ordinaryEligible)&&rikkyoValidateSession({...saved,baseQueueIds:[],candidatePoolIds:[]});
};
const rikkyoOptionalInit=init;
init=function(){
 rikkyoOptionalInit();
 const updateYear=()=>{
   const optional=state.settings.mode==='optional';$('learnYearSelect').disabled=optional;
   const help=$('yearExampleHelp');if(help)help.textContent=optional?'追加の語彙は年度を指定せずに学習します。':'年度指定は、その年度に出現した語の抽出条件です。原文の年度・日程・PDFページは回答後に表示します。';
 };
 const hydrate=hydrateUiFromState;hydrateUiFromState=function(){hydrate();updateYear()};
 $('modeSelect').addEventListener('change',updateYear);updateYear();
};
