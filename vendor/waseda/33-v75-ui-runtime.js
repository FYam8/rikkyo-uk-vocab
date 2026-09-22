
const v74ChooseType=chooseType;
chooseType=function(v,isRetry=false){
  if(v&&v.entryType==="listeningQuestionStem")return "choice";
  return v74ChooseType(v,isRetry);
};
function v75DisplayWord(v){return v.displayWord||v.word}
function v75AudioLabel(v,again=false){return `英単語 ${v75DisplayWord(v)} の発音を${again?"もう一度":""}再生`}
function v75UpdateQuickSpeakLabel(){
  const b=$("quickSpeak");if(!b)return;
  if(currentQuestion&&currentQuestion.v){
    if(currentQuestion.v.entryType==="listeningQuestionStem"){b.style.visibility="hidden";b.disabled=true;return}
    b.style.visibility="visible";b.disabled=false;
    b.setAttribute("aria-label",v75AudioLabel(currentQuestion.v,false));
    b.title=`${v75DisplayWord(currentQuestion.v)} の発音を聞く`;
  }else{
    b.style.visibility="visible";b.disabled=false;
    b.setAttribute("aria-label","音声テスト");b.title="音声テスト";
  }
}
function v75ChoiceObjects(v){
  if(Array.isArray(currentQuestion.choiceIds)&&currentQuestion.choiceIds.length){
    return currentQuestion.choiceIds.map(id=>VOCAB_BY_ID.get(id)).filter(Boolean);
  }
  const choices=shuffle([v,...getDistractors(v)]);
  currentQuestion.choiceIds=choices.map(x=>x.id);
  return choices;
}
renderChoice=function(v){
  const audio=v.entryType==="listeningQuestionStem"?"":`<button class="icon-btn" style="margin-top:12px" onclick="speakWord('${v.id}')" aria-label="${esc(v75AudioLabel(v))}" title="${esc(v75DisplayWord(v))} の発音を聞く">🔊</button>`;
  $("promptArea").innerHTML=`<div class="word">${esc(v75DisplayWord(v))}</div>${audio}<div class="small muted" style="margin-top:8px">最も適切な意味を選ぶ</div>`;
  const choices=v75ChoiceObjects(v);
  $("responseArea").innerHTML='<div class="answer-grid">'+choices.map(x=>`<button class="answer-btn" data-choice="${x.id}">${esc(x.meaning)}</button>`).join("")+"</div>";
  document.querySelectorAll("[data-choice]").forEach(b=>b.addEventListener("click",()=>resolveChoice(b.dataset.choice)));
};
renderReverseChoice=function(v){
  $("promptArea").innerHTML=`<div class="meaning-big">${esc(v.meaning)}</div><div class="small muted" style="margin-top:9px">対応する英語を選ぶ</div>`;
  const choices=v75ChoiceObjects(v);
  $("responseArea").innerHTML='<div class="answer-grid">'+choices.map(x=>`<button class="answer-btn" data-choice="${x.id}">${esc(v75DisplayWord(x))}</button>`).join("")+"</div>";
  document.querySelectorAll("[data-choice]").forEach(b=>b.addEventListener("click",()=>resolveChoice(b.dataset.choice)));
};
renderAudioChoice=function(v){
  $("promptArea").innerHTML=`<button class="audio-orb" onclick="speakWord('${v.id}')" aria-label="${esc(v75AudioLabel(v))}" title="${esc(v75DisplayWord(v))} の発音を聞く">🔊</button><div class="small muted">音声を聞いて意味を選ぶ</div>`;
  const choices=v75ChoiceObjects(v);
  $("responseArea").innerHTML='<div class="answer-grid">'+choices.map(x=>`<button class="answer-btn" data-choice="${x.id}">${esc(x.meaning)}</button>`).join("")+"</div>";
  document.querySelectorAll("[data-choice]").forEach(b=>b.addEventListener("click",()=>resolveChoice(b.dataset.choice)));
  if(!v75RestoringQuestion)setTimeout(()=>speakWord(v.id),250);
};
renderReverse=function(v){
  $("promptArea").innerHTML=`<div class="meaning-big">${esc(v.meaning)}</div><div class="small muted" style="margin-top:10px">見出し語を英語で入力</div>`;
  renderTypeBox(v);
};
renderAudio=function(v){
  $("promptArea").innerHTML=`<button class="audio-orb" onclick="speakWord('${v.id}')" aria-label="${esc(v75AudioLabel(v))}" title="${esc(v75DisplayWord(v))} の発音を聞く">🔊</button><div class="small muted">音声を聞いて英語で入力</div>`;
  renderTypeBox(v);
  if(!v75RestoringQuestion)setTimeout(()=>speakWord(v.id),250);
};
renderCloze=function(v){
  $("promptArea").innerHTML=`<div class="cloze">${esc(CLOZE[v.word]||"_____")}</div><div class="small muted" style="margin-top:10px">空所に入る見出し語を入力</div>`;
  renderTypeBox(v);
};
renderTypeBox=function(v){
  $("responseArea").innerHTML=`<div class="typebox"><input type="text" id="typedAnswer" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done"><button class="primary" id="submitTyped">判定</button></div><div id="typedError" class="small" role="alert" style="color:var(--bad);margin-top:7px;min-height:20px"></div>`;
  const inp=$("typedAnswer");inp.value=currentQuestion&&currentQuestion.draft||"";inp.focus();
  $("submitTyped").addEventListener("click",()=>resolveTyped(v));
  inp.addEventListener("keydown",e=>{if(e.key==="Enter")resolveTyped(v)});
  inp.addEventListener("input",()=>{
    if(currentQuestion)currentQuestion.draft=inp.value;
    $("typedError").textContent="";
    clearTimeout(v75DraftTimer);v75DraftTimer=setTimeout(persistActiveSession,350);
  });
};
resolveChoice=function(id){
  if(questionResolved)return;
  const target=currentQuestion.v,ok=id===target.id;
  currentQuestion.selectedChoiceId=id;
  document.querySelectorAll("[data-choice]").forEach(b=>{
    b.disabled=true;
    if(b.dataset.choice===target.id)b.classList.add("correct");
    else if(b.dataset.choice===id)b.classList.add("wrong");
  });
  applyOutcome(target,ok?"got":"miss");
  showFeedback(target,ok);
};
resolveTyped=function(v){
  if(questionResolved)return;
  const inp=$("typedAnswer"),raw=inp.value,ans=normalizeAnswer(raw);
  if(!ans){$("typedError").textContent="答えを入力してください";inp.focus();return}
  const accepted=[normalizeAnswer(v.word)];
  if(v.word==="cannot")accepted.push("can not","can't");
  const ok=accepted.includes(ans);
  currentQuestion.draft=raw;
  currentQuestion.userAnswer=ans;
  inp.disabled=true;$("submitTyped").disabled=true;$("typedError").textContent="";
  applyOutcome(v,ok?"got":"miss");
  showFeedback(v,ok,ans);
};

applyOutcome=function(v,outcome){
  if(questionResolved||!session||!currentQuestion)return;
  questionResolved=true;
  const p=getProgress(v.id);
  const pending={
    questionInstanceId:currentQuestion.questionInstanceId,
    wordId:v.id,
    outcome,
    qType:currentQuestion.type||"choice",
    isRetry:!!currentQuestion.isRetry,
    oldMastery:Number(p.mastery)||0,
    oldWeak:isWeakProgress(p),
    userAnswer:currentQuestion.userAnswer||currentQuestion.draft||"",
    selectedChoiceId:currentQuestion.selectedChoiceId||null
  };
  session.pendingOutcome=pending;
  persistActiveSession();
  v75CommitPendingOutcome(pending);
  v75UpdateSessionBar(false);
};

function v75SelectedYear(){return session&&session.active?session.year:(state.settings.year||"all")}
examExampleHTML=function(v){
  const ex=EXAM_EXAMPLES[v.id];
  if(!ex)return `<div class="exam-example"><div class="exam-example-head">例文監査エラー</div><div class="exam-example-note">この項目の出典表示レコードが未登録です。固定ID: ${esc(v.id)}</div></div>`;
  const selected=v75SelectedYear();
  const src=`${ex.year}年度 ${ex.source}${ex.page?`・PDF p.${ex.page}`:""}`;
  const highlight=(raw,form)=>{
    const s=String(raw||""),f=String(form||"");if(!f)return esc(s);
    const i=s.toLowerCase().indexOf(f.toLowerCase());
    return i>=0?esc(s.slice(0,i))+`<b>${esc(s.slice(i,i+f.length))}</b>`+esc(s.slice(i+f.length)):esc(s);
  };
  const ja=String(ex.ja||"").trim();
  const jaHTML=ja?`<div class="exam-example-ja"><span class="exam-example-ja-label">和訳</span>${esc(ja)}</div>`:`<div class="exam-example-ja"><span class="exam-example-ja-label">和訳監査エラー</span>この項目の和訳が未登録です。固定ID: ${esc(v.id)}</div>`;
  const mismatch=selected!=="all"&&Number(selected)!==Number(ex.year)&&Array.isArray(v.years)&&v.years.includes(Number(selected));
  const yearNote=mismatch?`<div class="exam-example-note">この語は${esc(selected)}年度にも確認されています。表示例文は${ex.year}年度のものです。</div>`:"";
  if(!ex.sentence){
    const fragment=String(ex.fragment||ex.matchedForm||v75DisplayWord(v));
    const note=ex.note||"過去問では単独語・選択肢として出現し、この語を含む完成英文は資料内から確認できません。";
    return `<div class="exam-example"><div class="exam-example-head">過去問での出題例 · ${esc(src)}</div><div class="exam-example-sentence">${highlight(fragment,ex.matchedForm||v.word)}</div>${jaHTML}<div class="exam-example-note">${esc(note)}</div>${yearNote}</div>`;
  }
  const modeNote=ex.mode==="completed"?(ex.note||"問題の空所・整序を公式解答で補完した完成文"):(ex.note||"");
  return `<div class="exam-example"><div class="exam-example-head">過去問例文 · ${esc(src)}</div><div class="exam-example-sentence">${highlight(ex.sentence,ex.matchedForm||v.word)}</div>${jaHTML}${modeNote?`<div class="exam-example-note">${esc(modeNote)}</div>`:""}${yearNote}</div>`;
};
function v75EvidenceFlags(v){
  const directVocab=(v.directVocabYears||v.directYears||[]).length;
  const order=(v.directOrderYears||[]).length;
  const answer=(v.directAnswerYears||[]).length;
  return {directVocab,order,answer,total:directVocab+order+answer};
}
function v75CompactEvidence(v){
  const sf=Number(v.surfaceFrequency)||0,sy=(v.surfaceYears||[]).length,registered=(v.years||[]).length,f=v75EvidenceFlags(v);
  const parts=[`本文・音声：${sf}回${sy?` / ${sy}年度`:""}`,`登録年度：${registered}年度`];
  if(f.total)parts.push(`直接出題：${f.total}年度`);
  if(v.evidenceType==="compoundOnly")parts.push("複合語内で確認");
  return parts.join("<br>");
}
function v75EvidenceDetail(v){
  const f=v75EvidenceFlags(v),rows=[];
  rows.push(`<div class="row between setting-row"><span>本文・音声出現</span><b>${Number(v.surfaceFrequency)||0}回 / ${(v.surfaceYears||[]).length}年度</b></div>`);
  rows.push(`<div class="row between setting-row"><span>登録年度</span><b>${yearsText(v.years||[])}</b></div>`);
  if(f.directVocab)rows.push(`<div class="row between setting-row"><span>直接語彙</span><b>${yearsText(v.directVocabYears||v.directYears)}</b></div>`);
  if(f.order)rows.push(`<div class="row between setting-row"><span>語句整序</span><b>${yearsText(v.directOrderYears)}</b></div>`);
  if(f.answer)rows.push(`<div class="row between setting-row"><span>本文等の一語解答</span><b>${yearsText(v.directAnswerYears)}</b></div>`);
  if((v.compoundForms||[]).length)rows.push(`<div class="row between setting-row"><span>複合形</span><b>${(v.compoundForms||[]).map(x=>esc(typeof x==="string"?x:x.form)).join("・")}</b></div>`);
  return rows.join("");
}
function v75EntryNote(v){
  const notes=[];
  if(v.entryType==="listeningQuestionStem")notes.push("リスニング設問表現：通常の単語・熟語とは別に、設問の読み取り用表現として学習します。");
  if(v.evidenceType==="compoundOnly")notes.push("関連学習語：単独出現は0回です。2026年度では short-term / long-term の一部として確認されています。");
  if(v.challengeReason)notes.push(v.challengeReason);
  return notes.map(x=>`<div class="small muted" style="margin-top:7px">${esc(x)}</div>`).join("");
}
function v75HasNextNow(){
  if(!session)return false;
  if(v75DueRetry())return true;
  if(session.unlimited)return true;
  return session.baseCursor<session.baseQueueIds.length;
}
showFeedback=function(v,ok,userAns=""){
  const p=getProgress(v.id),cat=v.categories.map(c=>CATEGORY_JP[c]||c).join("・")||"過去問";
  const audio=v.entryType==="listeningQuestionStem"?"":`<button class="icon-btn" style="min-height:38px;min-width:38px;padding:5px" onclick="speakWord('${v.id}')" aria-label="${esc(v75AudioLabel(v,true))}" title="${esc(v75DisplayWord(v))} の発音をもう一度聞く">🔊</button>`;
  const reason=currentQuestion&&currentQuestion.reason?`<div class="small" style="margin-top:7px;color:var(--accent2);font-weight:650">${esc(currentQuestion.reason)}</div>`:"";
  $("feedback").innerHTML=`<div class="correctline">${ok?"✓ ":""}${esc(v75DisplayWord(v))} ${audio}</div>
  <div style="font-size:17px;font-weight:650;margin-top:4px">${esc(v.meaning)}</div>
  ${!ok&&userAns?`<div class="small" style="color:var(--bad);margin-top:6px">入力：${esc(userAns)}</div>`:""}
  ${reason}${v75EntryNote(v)}${examExampleHTML(v)}
  <div class="small muted" style="margin-top:8px">${esc(v.note||"")} ${v.note?"· ":""}${v75CompactEvidence(v).replace(/<br>/g," · ")} · ${esc(cat)}</div>
  <div class="row between" style="margin-top:8px"><span class="tiny muted">客観判定 ${p.mastery} ${MASTER_LABEL[p.mastery]}${isWeakProgress(p)?" ・ 苦手判定":""}</span>${masteryDots(p.mastery)}</div>`;
  $("feedback").classList.add("show");
  $("nextArea").innerHTML=`<button class="primary full" id="nextBtn" style="margin-top:14px">${v75HasNextNow()?"次へ":"結果を見る"}</button>`;
  $("nextBtn").addEventListener("click",nextQuestion);
  if(currentQuestion){currentQuestion.submitted=true;currentQuestion.outcomeApplied=true;currentQuestion.ok=!!ok;currentQuestion.userAnswer=userAns||currentQuestion.userAnswer||""}
  v75UpsertQuestionHistory();persistActiveSession();
};

function v75UpdateSessionBar(showCurrent=true){
  if(!session)return;
  const total=session.actualSessionSize||0;
  const isRetry=!!(showCurrent&&currentQuestion&&currentQuestion.isRetry);
  const n=showCurrent&&currentQuestion&&!currentQuestion.isRetry&&!questionResolved?Math.min(session.baseAnswered+1,total):session.baseAnswered;
  $("sessionCount").textContent=globalThis.VocabularyLearningUI.progress({
    mode:"study",unlimited:!!session.unlimited,isRetry,
    basePosition:n,baseAnswered:session.baseAnswered,baseTotal:total,
    retryAnswered:session.retryAnswered,answeredCurrent:!!questionResolved
  }).secondary;
  $("sessionScore").textContent=`正解 ${session.correct} / 不正解 ${session.wrong}`;
}
function v75RenderCurrentQuestion(){
  const v=currentQuestion.v,type=currentQuestion.type;
  $("qBadges").innerHTML=badgeHTML(v);
  $("feedback").className="feedback";$("feedback").innerHTML="";$("nextArea").innerHTML="";
  const p=getProgress(v.id),labels={choice:"選択式・英→日",reverseChoice:"選択式・日→英",reverse:"日→英・入力",audioChoice:"音声→意味選択",audio:"音声→英語",cloze:"穴埋め"};
  $("qTypeLabel").textContent=`${labels[type]}${currentQuestion.isRetry?"・再確認":""} ・ ${MASTER_LABEL[p.mastery]}`;
  v75RestoringQuestion=true;
  if(type==="choice")renderChoice(v);
  else if(type==="reverseChoice")renderReverseChoice(v);
  else if(type==="audioChoice")renderAudioChoice(v);
  else if(type==="reverse")renderReverse(v);
  else if(type==="audio")renderAudio(v);
  else renderCloze(v);
  v75RestoringQuestion=false;
  v75UpdateQuickSpeakLabel();
  if(currentQuestion.submitted){
    questionResolved=true;
    if(["choice","reverseChoice","audioChoice"].includes(type)){
      document.querySelectorAll("[data-choice]").forEach(b=>{
        b.disabled=true;
        if(b.dataset.choice===v.id)b.classList.add("correct");
        else if(b.dataset.choice===currentQuestion.selectedChoiceId)b.classList.add("wrong");
      });
    }else{
      const inp=$("typedAnswer"),btn=$("submitTyped");
      if(inp){inp.value=currentQuestion.draft||currentQuestion.userAnswer||"";inp.disabled=true}
      if(btn)btn.disabled=true;
    }
    showFeedback(v,!!currentQuestion.ok,currentQuestion.userAnswer||"");
  }else questionResolved=false;
  v75UpdateSessionBar(true);
}
renderQuestion=function(){
  clearToast();
  const item=v75NextSessionItem();
  if(!item||!item.v){endSession(false);return}
  currentQuestion={
    v:item.v,type:chooseType(item.v,item.isRetry),isRetry:item.isRetry,
    questionInstanceId:`${session.sessionId}:q-${session.questionHistory.length+1}-${Math.random().toString(36).slice(2,7)}`,
    submitted:false,outcomeApplied:false,draft:"",choiceIds:[],selectedChoiceId:null,userAnswer:"",ok:null,reason:item.reason||""
  };
  questionResolved=false;
  session.recentIds.push(item.v.id);if(session.recentIds.length>14)session.recentIds.shift();
  $("learnSetup").style.display="none";$("quizArea").style.display="block";$("sessionBar").classList.add("show");
  $("headerTitle").textContent=v75SessionLabel();
  v75RenderCurrentQuestion();
  persistActiveSession();
};
nextQuestion=function(){
  if(!session||!session.active)return;
  v75UpsertQuestionHistory();persistActiveSession();
  renderQuestion();
};

const v74CloseSheet=closeSheet;
closeSheet=function(){v74CloseSheet();if(!v75RestorePromptOpen)clearToast()};

function v75NextReviewText(s){
  const ids=[...s.missed];
  const dates=ids.map(id=>getProgress(id).nextReview).filter(Boolean).map(x=>new Date(x)).filter(d=>!Number.isNaN(d.getTime())).sort((a,b)=>a-b);
  return dates.length?formatDate(dates[0].toISOString()):"—";
}
startSession=function(){
  const mode=$("modeSelect").value,year=$("learnYearSelect").value,size=Number($("sessionSizeSelect").value);
  const plan=buildSessionPlan(mode,year,size);
  if(size!==0&&!plan.baseQueueIds.length){
    showToast(mode==="review"?"現在、復習対象の語はありません。":"この条件に該当する語がありません",{kind:"info"});return;
  }
  if(size===0&&!plan.candidatePoolIds.length){showToast("この条件に該当する語がありません",{kind:"info"});return}
  state.settings.mode=mode;state.settings.year=year;state.settings.sessionSize=size;markSettingsUpdated();saveState();
  session={
    active:true,sessionId:v75MakeId("session"),createdAt:v75IsoNow(),mode,year,
    requestedSessionSize:size,actualSessionSize:plan.actualSessionSize||0,unlimited:!!plan.unlimited,
    candidatePoolIds:plan.candidatePoolIds||[],generatedBaseIds:[],baseQueueIds:plan.baseQueueIds||[],baseCursor:0,
    baseAnswered:0,retryAnswered:0,totalAnswered:0,correct:0,wrong:0,masteryUps:0,
    questionHistory:[],recentIds:[],retryQueue:[],retryCounts:{},blockedIds:new Set(),missed:new Set(),weak:new Set(),newFixed:new Set(),pendingOutcome:null,
    challengeBaseCount:Number(plan.challengeCount)||0,baseReasons:plan.baseReasons||{}
  };
  currentQuestion=null;questionResolved=false;
  $("learnSetup").style.display="none";$("quizArea").style.display="block";$("sessionBar").classList.add("show");
  $("headerTitle").textContent=v75SessionLabel();
  persistActiveSession();renderQuestion();
  if(size!==0&&plan.actualSessionSize<size){
    const label=mode==="review"?"復習対象":mode==="75"?"75点挑戦対象":"この条件の対象";
    showToast(`${label}は${plan.actualSessionSize}語です。今回は${plan.actualSessionSize}問で開始します。`,{kind:"info",duration:4500});
  }
};
endSession=function(silent=false,options={}){
  clearToast();
  if(!session)return;
  const s=session;if(!s.active&&options.force!==true)return;
  s.active=false;
  if(options.countSession!==false){state.stats.totalSessions++;saveState()}
  clearActiveSession();
  $("sessionBar").classList.remove("show");$("quizArea").style.display="none";$("learnSetup").style.display="block";
  v75UpdateQuickSpeakLabel();
  if(silent){session=null;currentQuestion=null;renderLearnHome();return}
  const accuracy=s.totalAnswered?Math.round(s.correct/s.totalAnswered*100):0;
  const challengeRatio=s.mode==="75"&&!s.unlimited&&s.actualSessionSize?Math.round(s.challengeBaseCount/s.actualSessionSize*100):null;
  openSheet(`<h2 style="margin-top:0">セッション結果</h2>
  <div class="grid">
   <div class="stat"><div class="n">${s.baseAnswered}</div><div class="l">基本問題</div></div>
   <div class="stat"><div class="n">${s.retryAnswered}</div><div class="l">再確認</div></div>
   <div class="stat"><div class="n">${s.totalAnswered}</div><div class="l">総回答</div></div>
   <div class="stat"><div class="n">${s.correct}</div><div class="l">正解</div></div>
   <div class="stat"><div class="n">${s.wrong}</div><div class="l">不正解</div></div>
   <div class="stat"><div class="n">${accuracy}%</div><div class="l">正解率</div></div>
   <div class="stat"><div class="n">${s.masteryUps}</div><div class="l">習熟度UP</div></div>
   <div class="stat"><div class="n">${s.newFixed.size}</div><div class="l">新しく定着</div></div>
  </div>
  ${challengeRatio!=null?`<div class="section-title">75点挑戦層の基本問題比率</div><div class="small"><b>${s.challengeBaseCount}/${s.actualSessionSize}（${challengeRatio}%）</b></div>`:""}
  <div class="section-title">今回ミスした語</div><div class="small">${s.missed.size?[...s.missed].slice(0,18).map(id=>esc(v75DisplayWord(VOCAB_BY_ID.get(id)||{word:id}))).join("・"):"なし"}</div>
  <div class="section-title">苦手判定語</div><div class="small">${s.weak.size?[...s.weak].slice(0,18).map(id=>esc(v75DisplayWord(VOCAB_BY_ID.get(id)||{word:id}))).join("・"):"なし"}</div>
  <div class="section-title">次の復習予定</div><div class="small">${esc(v75NextReviewText(s))}</div>
  <button class="primary full" style="margin-top:18px" onclick="closeSheet()">閉じる</button>`);
  session=null;currentQuestion=null;questionResolved=false;renderLearnHome();
};

function restoreActiveSession(raw){
  v75RestoreSessionObject(raw);
  recoverPendingOutcome();
  $("learnSetup").style.display="none";$("quizArea").style.display="block";$("sessionBar").classList.add("show");
  currentView="learn";location.hash="#learn";
  if(currentQuestion)v75RenderCurrentQuestion();else renderQuestion();
  persistActiveSession();
}
function v75PromptRestore(raw){
  v75RestorePromptOpen=true;
  const shown=raw.unlimited?`${raw.baseAnswered||0}問回答済み`:`${raw.baseAnswered||0} / ${raw.actualSessionSize||raw.requestedSessionSize||0}問まで進んでいます`;
  openSheet(`<h2 style="margin-top:0">前回の学習が途中です</h2><p class="small">${esc(shown)}。</p><div class="row" style="margin-top:18px"><button class="primary" id="resumeActiveBtn" style="flex:1">続きから再開</button><button class="danger-lite" id="finishActiveBtn" style="flex:1">このセッションを終了</button></div>`);
  $("resumeActiveBtn").addEventListener("click",()=>{v75RestorePromptOpen=false;closeSheet();restoreActiveSession(raw)});
  $("finishActiveBtn").addEventListener("click",()=>{v75RestorePromptOpen=false;v75RestoreSessionObject(raw);recoverPendingOutcome();closeSheet();endSession(false,{countSession:true,force:true})});
}

function validateImportPayload(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;
  if(raw.app&&raw.app!=="早稲渋 Vocabulary Coach")return false;
  const s=raw.state&&typeof raw.state==="object"?raw.state:raw;
  if(!s||typeof s!=="object")return false;
  const hasSchema=Number.isFinite(Number(raw.schemaVersion||s.schemaVersion));
  const hasProgress=(s.words&&typeof s.words==="object"&&!Array.isArray(s.words))||(s.progress&&typeof s.progress==="object"&&!Array.isArray(s.progress));
  if(!hasSchema||!hasProgress)return false;
  if(s.stats!=null&&typeof s.stats!=="object")return false;
  if(s.settings!=null&&typeof s.settings!=="object")return false;
  return true;
}
mergeImported=function(raw){
  if(!validateImportPayload(raw))throw new Error("Invalid vocabulary backup");
  const incoming=migrate(raw.state||raw),current=state;
  const currentWasActive=v75HasMeaningfulActivity(current);
  syncToday();
  for(const [id,ip] of Object.entries(incoming.words||{})){
    const cp=current.words[id];
    if(!cp){current.words[id]=ip;continue}
    const it=ip.lastStudied?new Date(ip.lastStudied).getTime():0,ct=cp.lastStudied?new Date(cp.lastStudied).getTime():0;
    const newer=it>=ct?ip:cp;
    current.words[id]=Object.assign(defaultProgress(),newer,{
      correct:Math.max(Number(ip.correct)||0,Number(cp.correct)||0),
      incorrect:Math.max(Number(ip.incorrect)||0,Number(cp.incorrect)||0),
      streak:newer.streak??0
    });
  }
  current.stats.totalAnswers=Math.max(Number(current.stats.totalAnswers)||0,Number(incoming.stats.totalAnswers)||0);
  current.stats.totalSessions=Math.max(Number(current.stats.totalSessions)||0,Number(incoming.stats.totalSessions)||0);
  if(incoming.stats.todayKey===localDayKey())current.stats.todayCount=Math.max(Number(current.stats.todayCount)||0,Number(incoming.stats.todayCount)||0);
  const ct=current.settingsUpdatedAt?new Date(current.settingsUpdatedAt).getTime():0;
  const it=incoming.settingsUpdatedAt?new Date(incoming.settingsUpdatedAt).getTime():0;
  let useIncoming=false;
  if(ct&&it)useIncoming=it>ct;
  else if(!ct&&it)useIncoming=true;
  else if(!ct&&!it)useIncoming=!currentWasActive;
  if(useIncoming){current.settings=Object.assign({},current.settings,incoming.settings||{});current.settingsUpdatedAt=incoming.settingsUpdatedAt||v75IsoNow()}
  current.schemaVersion=SCHEMA_VERSION;current.dataVersion=META.dataVersion;saveState();
  hydrateUiFromState();
  showToast("バックアップを統合しました",{kind:"success"});
};
handleImport=function(file){
  if(session&&session.active){showToast("学習中のセッションがあります。セッションを終了してからインポートしてください。",{kind:"warning",duration:5000});return}
  if(loadActiveSession()){showToast("途中セッションがあります。続きから再開するか終了してからインポートしてください。",{kind:"warning",duration:5000});return}
  const reader=new FileReader();
  reader.onload=()=>{try{const raw=JSON.parse(reader.result);mergeImported(raw)}catch(e){console.warn("Import rejected",e);showToast("このバックアップJSONは読み込めませんでした",{kind:"error"})}};
  reader.readAsText(file);
};

function hydrateUiFromState(){
  syncToday();
  setTheme(state.settings.theme||"auto");
  if($("modeSelect"))$("modeSelect").value=state.settings.mode||"recommended";
  if($("learnYearSelect"))$("learnYearSelect").value=state.settings.year||"all";
  if($("sessionSizeSelect"))$("sessionSizeSelect").value=String(state.settings.sessionSize??20);
  if($("themeSelect"))$("themeSelect").value=state.settings.theme||"auto";
  if($("accentSelect"))$("accentSelect").value=state.settings.accent||"auto";
  populateVoices();
  applyRoute();
  if(currentView==="stats")renderStats();
  if(currentView==="settings")renderSettings();
  v75UpdateQuickSpeakLabel();
}

renderList=function(){
  const q=$("searchInput").value.trim().toLowerCase(),y=$("listYear").value,pri=$("listPriority").value,layer=$("listLayer").value,lev=$("listLevel").value,mas=$("listMastery").value;
  let arr=VOCAB.filter(v=>{
    const p=getProgress(v.id),display=v75DisplayWord(v).toLowerCase();
    if(q&&!v.word.toLowerCase().includes(q)&&!display.includes(q)&&!v.meaning.toLowerCase().includes(q))return false;
    if(y!=="all"&&!v.years.includes(Number(y)))return false;
    if(pri!=="all"&&v.priority!==pri)return false;
    if(layer!=="all"&&(v.studyLayer||"core")!==layer)return false;
    if(lev!=="all"&&String(v.level)!==lev)return false;
    if(mas!=="all"&&String(p.mastery)!==mas)return false;
    return true;
  });
  const po={S:0,A:1,B:2,C:3},lo={core:0,diagnostic:1,challenge:2,reference:3};
  arr.sort((a,b)=>lo[a.studyLayer||"core"]-lo[b.studyLayer||"core"]||po[a.priority]-po[b.priority]||a.level-b.level||b.yearCount-a.yearCount||effectiveFrequency(b)-effectiveFrequency(a)||a.word.localeCompare(b.word));
  $("listCount").textContent=`${arr.length}件`;
  $("wordList").innerHTML=arr.length?arr.map(v=>{
    const p=getProgress(v.id);
    return `<div class="list-row" data-detail="${v.id}"><div><div class="list-word">${esc(v75DisplayWord(v))}</div><div class="list-meaning">${esc(v.meaning)}</div><div class="badges" style="margin-top:6px">${badgeHTML(v)} ${masteryDots(p.mastery)}</div></div><div class="list-meta">${v75CompactEvidence(v)}<br>習熟度 ${p.mastery} ${MASTER_LABEL[p.mastery]}</div></div>`;
  }).join(""):`<div class="empty">該当する語がありません</div>`;
  document.querySelectorAll("[data-detail]").forEach(el=>el.addEventListener("click",()=>openDetail(el.dataset.detail)));
};
openDetail=function(id){
  const v=VOCAB_BY_ID.get(id),p=getProgress(id);if(!v)return;
  const cats=v.categories.map(c=>CATEGORY_JP[c]||c).join("・");
  const audio=v.entryType==="listeningQuestionStem"?"":`<button class="icon-btn" onclick="speakWord('${v.id}')" aria-label="${esc(v75AudioLabel(v))}" title="${esc(v75DisplayWord(v))} の発音を聞く">🔊</button>`;
  openSheet(`<div class="row between"><div><div class="word" style="font-size:34px;text-align:left">${esc(v75DisplayWord(v))}</div><div style="font-size:19px;font-weight:650;margin-top:5px">${esc(v.meaning)}</div></div>${audio}</div>
  <div class="badges" style="margin-top:12px">${badgeHTML(v)} <span class="badge">習熟度 ${p.mastery} ${MASTER_LABEL[p.mastery]}</span></div>
  ${v75EntryNote(v)}<div class="small" style="margin-top:12px">${esc(v.note||"")}</div><div class="section-title">出題根拠</div>${v75EvidenceDetail(v)}
  <div class="section-title">カテゴリ</div><div class="small">${esc(cats||"—")}</div>${examExampleHTML(v)}
  <button class="secondary full" style="margin-top:18px" onclick="closeSheet()">閉じる</button>`);
};

const v74RenderAnalysis=renderAnalysis;
renderAnalysis=function(){
  v74RenderAnalysis();
  const grid=$("analysisGrid");if(!grid||!grid.parentElement)return;
  const notes=[...grid.parentElement.querySelectorAll("p.tiny.muted")].filter(p=>p.textContent.trim().startsWith("※1,831"));
  notes.forEach((p,i)=>{if(i===0){p.id="analysisCandidateNote"}else p.remove()});
  const table=$("top100Body")&&$("top100Body").closest(".card");
  if(table&&!document.getElementById("evidenceCountHelp")){
    const p=document.createElement("p");p.id="evidenceCountHelp";p.className="tiny muted";p.style.margin="10px 2px 0";
    p.textContent="「通常出現」は本文・音声での表層出現回数、「年度数」は直接出題なども含む登録年度数です。0回／1年度は、語句整序・直接語彙などで出題された場合に生じます。";
    table.appendChild(p);
  }
};

function v75EnsureYearHelp(){
  const sel=$("learnYearSelect");if(!sel||document.getElementById("yearExampleHelp"))return;
  const p=document.createElement("p");p.id="yearExampleHelp";p.className="tiny muted";p.style.margin="6px 3px 0";
  p.textContent="年度指定はその年度に確認された語を絞り込みます。例文は同年度を優先し、代表例が別年度の場合はその旨を表示します。";
  sel.parentElement.appendChild(p);
}

attachEvents=function(){
  document.querySelectorAll(".nav button").forEach(b=>b.addEventListener("click",()=>navigateToView(b.dataset.view)));
  $("startBtn").addEventListener("click",startSession);
  $("endSessionBtn").addEventListener("click",()=>endSession(false));
  $("quickSpeak").addEventListener("click",()=>speakWord(currentQuestion?currentQuestion.v.id:"important"));
  $("modeSelect").addEventListener("change",e=>{state.settings.mode=e.target.value;markSettingsUpdated();saveState();if(currentView==="learn")$("headerTitle").textContent=v75SessionLabel()});
  $("learnYearSelect").addEventListener("change",e=>{state.settings.year=e.target.value;markSettingsUpdated();saveState()});
  $("sessionSizeSelect").addEventListener("change",e=>{state.settings.sessionSize=Number(e.target.value);markSettingsUpdated();saveState()});
  ["searchInput","listYear","listPriority","listLayer","listLevel","listMastery"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",renderList));
  $("sheetOverlay").addEventListener("click",e=>{if(e.target===$("sheetOverlay")&&!v75RestorePromptOpen)closeSheet()});
  $("accentSelect").addEventListener("change",e=>{state.settings.accent=e.target.value;state.settings.voiceURI="";markSettingsUpdated();saveState();populateVoices()});
  $("voiceSelect").addEventListener("change",e=>{state.settings.voiceURI=e.target.value;markSettingsUpdated();saveState()});
  $("voiceTestBtn").addEventListener("click",()=>speakWord("important"));
  $("themeSelect").addEventListener("change",e=>{setTheme(e.target.value);markSettingsUpdated();saveState()});
  $("exportBtn").addEventListener("click",exportData);
  $("importBtn").addEventListener("click",()=>{
    if(session&&session.active||loadActiveSession())showToast("途中セッションがあります。終了してからインポートしてください。",{kind:"warning",duration:5000});
    else $("importFile").click();
  });
  $("importFile").addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];if(f)handleImport(f);e.target.value=""});
  if("speechSynthesis" in window){populateVoices();window.speechSynthesis.addEventListener("voiceschanged",populateVoices)}
  window.addEventListener("hashchange",applyRoute);
  window.addEventListener("pagehide",persistActiveSession);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")persistActiveSession()});
};

init=function(){
  initSelectors();
  if(!location.hash)history.replaceState(null,"",location.pathname+location.search+"#learn");
  setTheme(state.settings.theme||"auto");
  const toast=$("toast");if(toast)toast.setAttribute("aria-live","polite");
  attachEvents();v75EnsureYearHelp();hydrateUiFromState();
  const stored=loadActiveSession();
  if(stored){
    if(stored.dataVersion!==META.dataVersion){
      clearActiveSession();
      setTimeout(()=>showToast("アプリが更新されたため前回の途中セッションを終了しました。回答済みの学習履歴は保存されています。",{kind:"info",duration:6000}),50);
    }else{
      v75RestorableSession=stored;setTimeout(()=>v75PromptRestore(stored),60);
    }
  }
};
// Post-review refinements before the v7.5 implementation clean-pass count starts.
[
  "p9000000008","p9000000005","p9000000012","p9000000004",
  "p9000000006","p9000000015","p9000000014","p9000000016"
].forEach(id=>{
  const v=VOCAB_BY_ID.get(id);
  if(v)v.challengeReason="「60点／70点」は表現自体の基礎重要度、「75点挑戦層」は通常学習へ混ぜるかどうかの優先度を表す別軸です。この表現は出現年度が限定的なため75点挑戦層で扱います。";
});

const v75RenderCurrentQuestionBase=v75RenderCurrentQuestion;
v75RenderCurrentQuestion=function(){
  v75RenderCurrentQuestionBase();
  if(currentQuestion&&currentQuestion.reason&&$("qTypeLabel")){
    $("qTypeLabel").textContent=`挑戦前の基礎確認 ・ ${$("qTypeLabel").textContent}`;
  }
};

v75EnsureYearHelp=function(){
  const sel=$("learnYearSelect");if(!sel||document.getElementById("yearExampleHelp"))return;
  const p=document.createElement("p");p.id="yearExampleHelp";p.className="tiny muted";p.style.margin="6px 3px 0";
  p.textContent="年度指定は、その年度に確認された語の抽出条件です。採点後の代表例文が別年度の場合は、指定年度にも出現していることと表示例文の年度を明記します。";
  sel.parentElement.appendChild(p);
};

v75PickUnlimitedBase=function(){
  let pool=filterPool(session.mode,session.year).filter(v=>!session.blockedIds.has(v.id));
  if(session.mode==="75")pool=pool.filter(v=>(v.studyLayer||"core")==="challenge");
  if(!pool.length)return null;
  const recent=new Set(session.recentIds.slice(-6));
  let candidates=pool.filter(v=>!recent.has(v.id));if(!candidates.length)candidates=pool;
  const weights=candidates.map(v=>session.mode==="75"?v75ChallengeScore(v):schedulerScore(v,session.mode));
  return weightedChoice(candidates,weights);
};
// Existing-user protection refinement: importing a backup must never reduce objective mastery/evidence.
mergeImported=function(raw){
  if(!validateImportPayload(raw))throw new Error("Invalid vocabulary backup");
  const incoming=migrate(raw.state||raw),current=state;
  const currentWasActive=v75HasMeaningfulActivity(current);
  syncToday();
  for(const [id,ip] of Object.entries(incoming.words||{})){
    const cp=current.words[id];
    if(!cp){current.words[id]=ip;continue}
    const it=ip.lastStudied?new Date(ip.lastStudied).getTime():0,ct=cp.lastStudied?new Date(cp.lastStudied).getTime():0;
    const newer=it>=ct?ip:cp;
    current.words[id]=Object.assign(defaultProgress(),newer,{
      correct:Math.max(Number(ip.correct)||0,Number(cp.correct)||0),
      incorrect:Math.max(Number(ip.incorrect)||0,Number(cp.incorrect)||0),
      mastery:Math.max(Number(ip.mastery)||0,Number(cp.mastery)||0),
      evidence:Math.max(Number(ip.evidence)||0,Number(cp.evidence)||0),
      streak:newer.streak??0
    });
  }
  current.stats.totalAnswers=Math.max(Number(current.stats.totalAnswers)||0,Number(incoming.stats.totalAnswers)||0);
  current.stats.totalSessions=Math.max(Number(current.stats.totalSessions)||0,Number(incoming.stats.totalSessions)||0);
  if(incoming.stats.todayKey===localDayKey())current.stats.todayCount=Math.max(Number(current.stats.todayCount)||0,Number(incoming.stats.todayCount)||0);
  const ct=current.settingsUpdatedAt?new Date(current.settingsUpdatedAt).getTime():0;
  const it=incoming.settingsUpdatedAt?new Date(incoming.settingsUpdatedAt).getTime():0;
  let useIncoming=false;
  if(ct&&it)useIncoming=it>ct;
  else if(!ct&&it)useIncoming=true;
  else if(!ct&&!it)useIncoming=!currentWasActive;
  if(useIncoming){
    current.settings=Object.assign({},current.settings,incoming.settings||{});
    current.settingsUpdatedAt=incoming.settingsUpdatedAt||v75IsoNow();
  }
  current.schemaVersion=SCHEMA_VERSION;
  current.dataVersion=META.dataVersion;
  saveState();
  hydrateUiFromState();
  showToast("バックアップを統合しました",{kind:"success"});
};
// Final content remediation found by the exhaustive second review.
// Keep fixed IDs, schemaVersion 7 and all learner progress untouched.

function v75CompleteOfficialExample(id, sentence, ja, note){
  const ex=EXAM_EXAMPLES[id];
  if(!ex)return;
  ex.sentence=sentence;
  ex.ja=ja;
  ex.mode="completed";
  ex.note=note||"問題冊子の空所を公式解答で補完した完成文";
}

// These examples previously filled blanks only in Japanese while being labelled "exact".
// Official answer sheets were rechecked, so make the completion explicit in both languages.
v75CompleteOfficialExample(
  "w2106363633",
  "Before the summer was over, Sheila’s spell over me was gone, but the memory of losing the bass never disappeared.",
  "夏が終わる前にはシーラの私への魅力は消えていましたが、バスを失った記憶は決して消えませんでした。",
  "2020年度・問6の公式解答 bass で空所を補完"
);
v75CompleteOfficialExample(
  "w0288940764",
  "The scientists were worried that magpies might have a hard time living in a warmer environment caused by climate change.",
  "科学者たちは、気候変動によって生じたより暖かい環境の中で、カササギが暮らすのに苦労するかもしれないことを心配していました。",
  "2023年度・問1の公式解答 worried / have / time / warmer で空所を補完"
);
["w1452406406","w3338173923"].forEach(id=>v75CompleteOfficialExample(
  id,
  "An adult female magpie was helping out another magpie in getting free from its harness.",
  "成鳥のメスのカササギが、別のカササギがハーネスから抜け出すのを助けていました。",
  "2023年度の公式解答 helping で空所を補完"
));

// Translation audit corrections: do not add facts/causes that are absent from the English.
if(EXAM_EXAMPLES["p3099442518"]){
  EXAM_EXAMPLES["p3099442518"].ja="私は歴史で一番助けが必要です。";
}
if(EXAM_EXAMPLES["p4217966614"]){
  EXAM_EXAMPLES["p4217966614"].ja="とにかく、キャンプ場に着いたころにはすでに天気が崩れ始めていて、期待していたような雨の降らない天気にはならないと分かりました。";
}
[
  ["w1688387771","「あなたが努力しても何も変わりません。」"],
  ["w2780795386","「あなたが努力しても何も変わりません。」"],
  ["w91071520037954","「参加を妨げるものはすべて取り除くべきです。」"]
].forEach(([id,ja])=>{if(EXAM_EXAMPLES[id])EXAM_EXAMPLES[id].ja=ja});

// Verified same-year examples. Only records checked against the actual past papers are added.
const V75_EXAM_EXAMPLES_BY_YEAR={};
function v75RegisterYearExample(id,ex){
  if(!V75_EXAM_EXAMPLES_BY_YEAR[id])V75_EXAM_EXAMPLES_BY_YEAR[id]={};
  const y=Number(ex.year);
  if(!V75_EXAM_EXAMPLES_BY_YEAR[id][y])V75_EXAM_EXAMPLES_BY_YEAR[id][y]=[];
  V75_EXAM_EXAMPLES_BY_YEAR[id][y].push(Object.assign({},ex));
}
Object.entries(EXAM_EXAMPLES).forEach(([id,ex])=>{
  if(ex&&Number(ex.year))v75RegisterYearExample(id,Object.assign({recordKind:"representative"},ex));
});

v75RegisterYearExample("w3032116916",{
  sentence:"Who would believe such a stupid story?",
  ja:"そんなばかげた話を誰が信じるでしょうか。",
  year:2019,source:"問題冊子",page:6,matchedForm:"believe",mode:"exact",
  note:"2019年度本文で確認した同年度例文",recordKind:"verifiedSameYear"
});
v75RegisterYearExample("w1094248838",{
  sentence:"When a place is (c ), it means there are a lot of people or too many people in it.",
  ja:"ある場所が (c ) なら、そこには多くの人、または多すぎるほどの人がいるという意味です。",
  year:2026,source:"問題冊子",page:6,matchedForm:"lot",mode:"sourceOnly",
  note:"2026年度の直接語彙問題内で a lot of people として確認",recordKind:"verifiedSameYear"
});
v75RegisterYearExample("w1284177306",{
  sentence:"Mrs. Moreno picked it up and looked at it closely but couldn’t see what was wrong.",
  ja:"モレノ夫人はそれを拾い上げ、注意深く見ましたが、何が悪いのか分かりませんでした。",
  year:2024,source:"問題冊子",page:7,matchedForm:"closely",mode:"sourceOnly",
  note:"2024年度は派生形 closely として確認",recordKind:"verifiedSameYear"
});

function selectExamExample(v,selectedYear=v75SelectedYear()){
  const representative=EXAM_EXAMPLES[v.id]||null;
  if(selectedYear==="all"||selectedYear==null)return {example:representative,isFallback:false,selectedYear:null};
  const y=Number(selectedYear);
  const rows=(V75_EXAM_EXAMPLES_BY_YEAR[v.id]&&V75_EXAM_EXAMPLES_BY_YEAR[v.id][y])||[];
  if(rows.length){
    const rank={exact:0,completed:1,direct:2,sourceOnly:3};
    const chosen=[...rows].sort((a,b)=>(rank[a.mode]??9)-(rank[b.mode]??9))[0];
    return {example:chosen,isFallback:false,selectedYear:y};
  }
  return {example:representative,isFallback:true,selectedYear:y};
}

examExampleHTML=function(v){
  const selected=selectExamExample(v,v75SelectedYear());
  const ex=selected.example;
  if(!ex)return `<div class="exam-example"><div class="exam-example-head">例文監査エラー</div><div class="exam-example-note">この項目の出典表示レコードが未登録です。固定ID: ${esc(v.id)}</div></div>`;
  const src=`${ex.year}年度 ${ex.source}${ex.page?`・PDF p.${ex.page}`:""}`;
  const highlight=(raw,form)=>{
    const s=String(raw||""),f=String(form||"");if(!f)return esc(s);
    const i=s.toLowerCase().indexOf(f.toLowerCase());
    return i>=0?esc(s.slice(0,i))+`<b>${esc(s.slice(i,i+f.length))}</b>`+esc(s.slice(i+f.length)):esc(s);
  };
  const ja=String(ex.ja||"").trim();
  const jaHTML=ja?`<div class="exam-example-ja"><span class="exam-example-ja-label">和訳</span>${esc(ja)}</div>`:`<div class="exam-example-ja"><span class="exam-example-ja-label">和訳監査エラー</span>この項目の和訳が未登録です。固定ID: ${esc(v.id)}</div>`;
  const fallbackNote=selected.isFallback&&selected.selectedYear&&Array.isArray(v.years)&&v.years.includes(selected.selectedYear)
    ?`<div class="exam-example-note">この語は${selected.selectedYear}年度にも確認されています。同年度の検証済み例文レコードが未登録のため、代表例として${ex.year}年度の実例を表示しています。</div>`:"";
  const modeNote=ex.note||((ex.mode==="completed")?"問題の空所を公式解答で補完した完成文":"");
  if(!ex.sentence){
    const fragment=String(ex.fragment||ex.matchedForm||v75DisplayWord(v));
    const note=modeNote||"過去問では単独語・選択肢として出現し、この語を含む完成英文は資料内から確認できません。";
    return `<div class="exam-example"><div class="exam-example-head">過去問での出題例 · ${esc(src)}</div><div class="exam-example-sentence">${highlight(fragment,ex.matchedForm||v.word)}</div>${jaHTML}<div class="exam-example-note">${esc(note)}</div>${fallbackNote}</div>`;
  }
  return `<div class="exam-example"><div class="exam-example-head">過去問例文 · ${esc(src)}</div><div class="exam-example-sentence">${highlight(ex.sentence,ex.matchedForm||v.word)}</div>${jaHTML}${modeNote?`<div class="exam-example-note">${esc(modeNote)}</div>`:""}${fallbackNote}</div>`;
};
