
function v75ChallengeScore(v){
  const p=getProgress(v.id),t=now();
  return WASEDA_PLANNING_POLICY.challengeScore(v,p,t);
}
function v75FoundationReason(v){
  const p=getProgress(v.id),t=now();
  return WASEDA_PLANNING_POLICY.foundationReason(v,p,t);
}
function buildChallengeSessionPlan(year,requested){
  const y=year==="all"?null:Number(year),t=now();
  const challenge=VOCAB.filter(v=>WASEDA_PLANNING_POLICY.isChallengeEntity(v)&&(!y||v.years.includes(y)));
  if(!challenge.length)return {baseQueueIds:[],actualSessionSize:0,challengeCount:0,baseReasons:{}};
  const desired=requested||challenge.length;
  const required=WASEDA_PLANNING_POLICY.requiredChallengeCount(desired);
  if(challenge.length<required){
    const n=Math.min(desired,challenge.length);
    const picked=v75WeightedWithoutReplacement(challenge,n,v75ChallengeScore);
    return {baseQueueIds:picked.map(v=>v.id),actualSessionSize:picked.length,challengeCount:picked.length,baseReasons:{}};
  }
  const nonChallenge=VOCAB.filter(v=>{
    if(!WASEDA_PLANNING_POLICY.isFoundationLayerEligible(v))return false;
    if(y&&!v.years.includes(y))return false;
    const p=getProgress(v.id);
    return WASEDA_PLANNING_POLICY.isFoundationStateEligible(p,t);
  });
  const exceptionCap=WASEDA_PLANNING_POLICY.foundationExceptionCap(desired);
  const exceptions=v75WeightedWithoutReplacement(nonChallenge,Math.min(exceptionCap,nonChallenge.length),v=>schedulerScore(v,"recommended"));
  const challengeN=Math.min(challenge.length,desired-exceptions.length);
  const challengePicked=v75WeightedWithoutReplacement(challenge,challengeN,v75ChallengeScore);
  const combined=shuffle([...challengePicked,...exceptions]).slice(0,desired);
  const baseReasons={};exceptions.forEach(v=>baseReasons[v.id]=v75FoundationReason(v));
  return {baseQueueIds:combined.map(v=>v.id),actualSessionSize:combined.length,challengeCount:combined.filter(v=>WASEDA_PLANNING_POLICY.isChallengeEntity(v)).length,baseReasons};
}
function buildSessionPlan(mode,year,size){
  const pool=filterPool(mode,year);
  const plan=VOCABULARY_SESSION_ENGINE.buildPlan({
    mode,year,size,pool,unlimitedSize:0,
    getId:v=>v.id,
    isSpecialMode:m=>WASEDA_PLANNING_POLICY.isChallengeMode(m),
    buildSpecialPlan:buildChallengeSessionPlan,
    isRandomMode:m=>WASEDA_PLANNING_POLICY.isRandomMode(m),
    shuffle,
    weightedWithoutReplacement:v75WeightedWithoutReplacement,
    score:(v,m)=>schedulerScore(v,m),
    isSpecialEntity:v=>WASEDA_PLANNING_POLICY.isChallengeEntity(v)
  });
  if(Object.prototype.hasOwnProperty.call(plan,"specialCount")){
    plan.challengeCount=plan.specialCount;
    delete plan.specialCount;
  }
  return plan;
}
function v75DueRetry(){
  return VOCABULARY_SESSION_ENGINE.dueRetry(session.retryQueue,session.totalAnswered,id=>session.blockedIds.has(id));
}
function v75PickUnlimitedBase(){
  return VOCABULARY_SESSION_ENGINE.pickUnlimitedBase({
    candidateIds:session.candidatePoolIds,
    resolve:id=>VOCAB_BY_ID.get(id),
    isBlocked:id=>session.blockedIds.has(id),
    getId:v=>v.id,
    restrictPool:(pool,mode)=>WASEDA_PLANNING_POLICY.isChallengeMode(mode)?pool.filter(v=>WASEDA_PLANNING_POLICY.isChallengeEntity(v)):pool,
    mode:session.mode,
    recentIds:session.recentIds,
    recentWindow:WASEDA_PLANNING_POLICY.unlimitedRecentWindow,
    score:(v,mode)=>WASEDA_PLANNING_POLICY.isChallengeMode(mode)?v75ChallengeScore(v):schedulerScore(v,mode),
    weightedChoice
  });
}
function v75NextSessionItem(){
  return VOCABULARY_SESSION_ENGINE.nextItem({
    state:session,
    dueRetry:v75DueRetry,
    pickUnlimitedBase:v75PickUnlimitedBase,
    resolve:id=>VOCAB_BY_ID.get(id),
    getId:v=>v.id
  });
}
