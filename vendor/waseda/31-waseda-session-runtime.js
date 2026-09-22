
function v75SerializeCurrentQuestion(){
  if(!currentQuestion)return null;
  return {
    questionInstanceId:currentQuestion.questionInstanceId,
    wordId:currentQuestion.v&&currentQuestion.v.id,
    type:currentQuestion.type,
    isRetry:!!currentQuestion.isRetry,
    submitted:!!currentQuestion.submitted,
    outcomeApplied:!!currentQuestion.outcomeApplied,
    draft:currentQuestion.draft||"",
    choiceIds:Array.isArray(currentQuestion.choiceIds)?currentQuestion.choiceIds:[],
    selectedChoiceId:currentQuestion.selectedChoiceId||null,
    userAnswer:currentQuestion.userAnswer||"",
    ok:typeof currentQuestion.ok==="boolean"?currentQuestion.ok:null,
    reason:currentQuestion.reason||""
  };
}
function v75SerializableSession(){
  if(!session||!session.active)return null;
  return {
    sessionFormatVersion:V75_SESSION_FORMAT_VERSION,
    dataVersion:META.dataVersion,
    sessionId:session.sessionId,
    createdAt:session.createdAt,
    updatedAt:v75IsoNow(),
    mode:session.mode,
    year:session.year,
    requestedSessionSize:session.requestedSessionSize,
    actualSessionSize:session.actualSessionSize,
    unlimited:!!session.unlimited,
    candidatePoolIds:Array.isArray(session.candidatePoolIds)?session.candidatePoolIds:[],
    generatedBaseIds:Array.isArray(session.generatedBaseIds)?session.generatedBaseIds:[],
    baseQueueIds:Array.isArray(session.baseQueueIds)?session.baseQueueIds:[],
    baseCursor:Number(session.baseCursor)||0,
    baseAnswered:Number(session.baseAnswered)||0,
    retryAnswered:Number(session.retryAnswered)||0,
    totalAnswered:Number(session.totalAnswered)||0,
    correct:Number(session.correct)||0,
    wrong:Number(session.wrong)||0,
    masteryUps:Number(session.masteryUps)||0,
    currentQuestion:v75SerializeCurrentQuestion(),
    questionHistory:Array.isArray(session.questionHistory)?session.questionHistory:[],
    recentIds:Array.isArray(session.recentIds)?session.recentIds:[],
    retryQueue:Array.isArray(session.retryQueue)?session.retryQueue:[],
    retryCounts:session.retryCounts||{},
    blockedIds:v75SetToArray(session.blockedIds),
    missedIds:v75SetToArray(session.missed),
    weakIds:v75SetToArray(session.weak),
    newFixedIds:v75SetToArray(session.newFixed),
    pendingOutcome:session.pendingOutcome||null,
    challengeBaseCount:Number(session.challengeBaseCount)||0,
    baseReasons:session.baseReasons||{}
  };
}
persistActiveSession=function(){
  if(!session||!session.active)return;
  try{wasedaStorageSet(V75_ACTIVE_SESSION_KEY,JSON.stringify(v75SerializableSession()))}
  catch(e){console.warn("Active session save failed",e)}
};
function clearActiveSession(){
  try{wasedaStorageRemove(V75_ACTIVE_SESSION_KEY)}catch(e){console.warn("Active session clear failed",e)}
}
// Hoisted bindings required by the strict-mode single-file app before the v7.5 overrides assign implementations.
var clearToast;
var persistActiveSession;
function loadActiveSession(){
  try{
    const raw=wasedaStorageGet(V75_ACTIVE_SESSION_KEY);
    if(!raw)return null;
    const x=JSON.parse(raw);
    return validateActiveSession(x)?x:null;
  }catch(e){console.warn("Active session load failed",e);return null}
}
function validateActiveSession(x){
  if(!x||typeof x!=="object"||Number(x.sessionFormatVersion)!==V75_SESSION_FORMAT_VERSION)return false;
  if(typeof x.sessionId!=="string"||typeof x.mode!=="string")return false;
  const ids=[...(x.baseQueueIds||[]),...(x.candidatePoolIds||[])];
  if(ids.some(id=>!VOCAB_BY_ID.has(id)||(VOCAB_BY_ID.get(id).studyLayer||"core")==="reference"))return false;
  if(x.currentQuestion&&(!x.currentQuestion.wordId||!VOCAB_BY_ID.has(x.currentQuestion.wordId)))return false;
  return true;
}
function v75RestoreSessionObject(raw){
  session={
    active:true,
    sessionId:raw.sessionId,
    createdAt:raw.createdAt||v75IsoNow(),
    mode:raw.mode,
    year:raw.year||"all",
    requestedSessionSize:Number(raw.requestedSessionSize)||0,
    actualSessionSize:Number(raw.actualSessionSize)||0,
    unlimited:!!raw.unlimited,
    candidatePoolIds:Array.isArray(raw.candidatePoolIds)?raw.candidatePoolIds:[],
    generatedBaseIds:Array.isArray(raw.generatedBaseIds)?raw.generatedBaseIds:[],
    baseQueueIds:Array.isArray(raw.baseQueueIds)?raw.baseQueueIds:[],
    baseCursor:Number(raw.baseCursor)||0,
    baseAnswered:Number(raw.baseAnswered)||0,
    retryAnswered:Number(raw.retryAnswered)||0,
    totalAnswered:Number(raw.totalAnswered)||0,
    correct:Number(raw.correct)||0,
    wrong:Number(raw.wrong)||0,
    masteryUps:Number(raw.masteryUps)||0,
    questionHistory:Array.isArray(raw.questionHistory)?raw.questionHistory:[],
    recentIds:Array.isArray(raw.recentIds)?raw.recentIds:[],
    retryQueue:Array.isArray(raw.retryQueue)?raw.retryQueue:[],
    retryCounts:raw.retryCounts||{},
    blockedIds:v75ToSet(raw.blockedIds),
    missed:v75ToSet(raw.missedIds),
    weak:v75ToSet(raw.weakIds),
    newFixed:v75ToSet(raw.newFixedIds),
    pendingOutcome:raw.pendingOutcome||null,
    challengeBaseCount:Number(raw.challengeBaseCount)||0,
    baseReasons:raw.baseReasons||{}
  };
  const cq=raw.currentQuestion;
  currentQuestion=cq?Object.assign({},cq,{v:VOCAB_BY_ID.get(cq.wordId)}):null;
  questionResolved=!!(currentQuestion&&currentQuestion.submitted);
}
function v75OutcomeAlreadyApplied(wordId,qid){
  const p=getProgress(wordId);
  return (p.recentResults||[]).some(r=>r&&r.questionInstanceId===qid);
}
function v75RemoveRetry(wordId){
  session.retryQueue=session.retryQueue.filter(r=>r.wordId!==wordId);
}
function v75ApplyMainOutcome(v,pending){
  const p=getProgress(v.id),ok=pending.outcome==="got",qType=pending.qType||"choice";
  p.lastStudied=v75IsoNow();
  p.lastRating=ok?"got":"miss";
  if(ok){
    p.correct++;p.streak++;
    recordObjectiveResult(p,true,qType);
    const rr=p.recentResults[p.recentResults.length-1];if(rr)rr.questionInstanceId=pending.questionInstanceId;
    if((v.studyLayer||"core")==="diagnostic"&&p.incorrect===0){
      p.evidence=Math.max(Number(p.evidence)||0,5);
      p.mastery=Math.max(p.mastery,2);
      p.nextReview=reviewISO(60*86400000);
    }else{
      const days=[0,1,4,14,45][p.mastery];
      p.nextReview=reviewISO(days===0?10*60*1000:days*86400000);
    }
    p.recentMistakeUntil=null;
  }else{
    p.incorrect++;p.streak=0;
    recordObjectiveResult(p,false,qType);
    const rr=p.recentResults[p.recentResults.length-1];if(rr)rr.questionInstanceId=pending.questionInstanceId;
    p.nextReview=reviewISO(10*60*1000);
    p.recentMistakeUntil=reviewISO(3*86400000);
  }
  syncToday();
  state.stats.todayCount++;
  state.stats.totalAnswers++;
  saveState();
  return p;
}
function v75ApplySessionOutcome(v,pending,p){
  const ok=pending.outcome==="got";
  if(pending.isRetry)session.retryAnswered++;else session.baseAnswered++;
  session.totalAnswered++;
  if(ok){
    session.correct++;
    v75RemoveRetry(v.id);
    session.blockedIds.delete(v.id);
    if(Number(p.mastery)>Number(pending.oldMastery))session.masteryUps++;
    if(Number(pending.oldMastery)<4&&p.mastery===4)session.newFixed.add(v.id);
  }else{
    session.wrong++;
    session.missed.add(v.id);
    if(isWeakProgress(p))session.weak.add(v.id);
    if(!pending.isRetry&&(session.retryCounts[v.id]||0)===0){
      const gap=WASEDA_PLANNING_POLICY.retryGap(v);
      session.retryQueue.push({wordId:v.id,dueAfterTotal:session.totalAnswered+gap});
    }else if(pending.isRetry){
      v75RemoveRetry(v.id);
      session.blockedIds.add(v.id);
    }
  }
  if(pending.oldWeak&&!isWeakProgress(p))session.weak.delete(v.id);
}
function v75CommitPendingOutcome(pending){
  const v=VOCAB_BY_ID.get(pending.wordId);if(!v)return;
  let p=getProgress(v.id);
  if(!v75OutcomeAlreadyApplied(v.id,pending.questionInstanceId))p=v75ApplyMainOutcome(v,pending);
  v75ApplySessionOutcome(v,pending,p);
  if(currentQuestion&&currentQuestion.questionInstanceId===pending.questionInstanceId){
    currentQuestion.submitted=true;
    currentQuestion.outcomeApplied=true;
    currentQuestion.ok=pending.outcome==="got";
    currentQuestion.userAnswer=pending.userAnswer||currentQuestion.userAnswer||"";
    currentQuestion.selectedChoiceId=pending.selectedChoiceId||currentQuestion.selectedChoiceId||null;
  }
  session.pendingOutcome=null;
  v75UpsertQuestionHistory();
  persistActiveSession();
}
function recoverPendingOutcome(){
  if(!session||!session.pendingOutcome)return;
  v75CommitPendingOutcome(session.pendingOutcome);
}
function v75QuestionSnapshot(){
  const q=v75SerializeCurrentQuestion();
  if(!q)return null;
  return {
    questionInstanceId:q.questionInstanceId,wordId:q.wordId,type:q.type,isRetry:q.isRetry,
    submitted:q.submitted,answer:q.selectedChoiceId||q.userAnswer||"",correct:q.ok,outcomeApplied:q.outcomeApplied
  };
}
function v75UpsertQuestionHistory(){
  if(!session||!currentQuestion)return;
  const snap=v75QuestionSnapshot();if(!snap)return;
  const i=session.questionHistory.findIndex(x=>x.questionInstanceId===snap.questionInstanceId);
  if(i>=0)session.questionHistory[i]=snap;else session.questionHistory.push(snap);
}
