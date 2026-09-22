/* V76_MEMORY_CURVE_SCHEDULER_START */
/*
 * v7.6 adaptive forgetting-curve scheduler.
 * Backward-compatible with schemaVersion 7 and waseshibu_vocab_state.
 * Existing words are NOT migrated on load. A memoryModel is initialized only
 * when that word receives its next scored answer.
 */
const V76_DATA_VERSION="2019-2026-v7.6-memory-curve-scheduler";
const V76_MEMORY_MODEL_VERSION=1;
const V76_DAY_MS=86400000;
const V76_MINUTE_MS=60000;
META.dataVersion=V76_DATA_VERSION;
state.dataVersion=V76_DATA_VERSION;

function v76StrongRecallType(type){return ["reverse","audio","cloze"].includes(type)}
function v76ExistingScheduledDays(p){
  if(!p||!p.lastStudied||!p.nextReview||p.lastRating==="miss")return null;
  const a=new Date(p.lastStudied).getTime(),b=new Date(p.nextReview).getTime();
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return null;
  const d=(b-a)/V76_DAY_MS;
  return d>=0.5?d:null;
}
function v76InferMemoryModel(p){
  const attempts=attemptCount(p),errors=Number(p.incorrect)||0;
  const scheduled=v76ExistingScheduledDays(p);
  const stability=v76Clamp(scheduled??v76SeedStability(p.mastery),0.25,60);
  const errorRate=attempts?errors/attempts:0;
  const difficulty=v76Clamp(4.5+errorRate*3.2+(p.mastery===0?.5:0)-Math.min(1,Number(p.correct||0)*.04),1,10);
  return {
    version:V76_MEMORY_MODEL_VERSION,
    stabilityDays:stability,
    difficulty,
    lastReviewAt:p.lastStudied||null,
    reviews:attempts,
    lapses:errors,
    lastRetrievability:null,
    lastIntervalDays:scheduled,
    targetRetention:null,
    updatedAt:null
  };
}
function v76EnsureMemoryModel(p){
  if(!p.memoryModel||Number(p.memoryModel.version)!==V76_MEMORY_MODEL_VERSION){
    p.memoryModel=v76InferMemoryModel(p);
  }
  const m=p.memoryModel;
  m.stabilityDays=v76Clamp(m.stabilityDays||v76SeedStability(p.mastery),0.25,180);
  m.difficulty=v76Clamp(m.difficulty||5,1,10);
  m.reviews=Math.max(0,Number(m.reviews)||0);
  m.lapses=Math.max(0,Number(m.lapses)||0);
  return m;
}
function v76ElapsedDays(lastReviewAt,atMs=now()){
  if(!lastReviewAt)return 0;
  const t=new Date(lastReviewAt).getTime();
  if(!Number.isFinite(t))return 0;
  return Math.max(0,(atMs-t)/V76_DAY_MS);
}
function v76Retrievability(model,atMs=now()){
  if(!model||!model.lastReviewAt)return 1;
  const s=Math.max(.05,Number(model.stabilityDays)||.05);
  return v76Clamp(Math.pow(.9,v76ElapsedDays(model.lastReviewAt,atMs)/s),0,1);
}
function v76TargetRetention(v,p){
  return WASEDA_MEMORY_POLICY.targetRetention(v,p);
}
function v76ExamDaysLeft(){
  const raw=state&&state.settings&&state.settings.examDate;
  if(!raw)return null;
  const d=new Date(String(raw)+"T23:59:59");
  const ms=d.getTime();
  if(!Number.isFinite(ms))return null;
  return (ms-now())/V76_DAY_MS;
}
function v76CorrectGrowth(model,retrievability,strong,elapsedDays,sameSession){
  const s=Math.max(.25,Number(model.stabilityDays)||.75);
  if(sameSession){return s*(strong?1.08:1.04)}
  const challenge=v76Clamp(.80+(1-retrievability)*1.7,.80,1.55);
  const strength=strong?1.20:.72;
  const difficultyFactor=v76Clamp(1.25-(model.difficulty-5)*.055,.85,1.5);
  const saturation=1+Math.log2(1+s)*.18;
  const growth=1+(strength*challenge*difficultyFactor)/saturation;
  return s*growth;
}
function v76ReviewIntervalDays(v,p,model){
  return WASEDA_MEMORY_POLICY.reviewIntervalDays(v,p,model);
}
function v76UpdateMemoryAfterOutcome(v,p,pending,ctx){
  const m=ctx.model;
  const ok=pending.outcome==="got";
  const strong=v76StrongRecallType(pending.qType||"choice");
  const sameSession=!!pending.isRetry||ctx.elapsedDays<.5;
  if(ok){
    if(pending.isRetry){
      m.stabilityDays=Math.max(1,Math.min(1.5,m.stabilityDays*1.15));
    }else{
      m.stabilityDays=v76Clamp(v76CorrectGrowth(m,ctx.retrievability,strong,ctx.elapsedDays,sameSession),.5,180);
      if(WASEDA_MEMORY_POLICY.isDiagnosticFirstPass(v,p,ctx.attemptsBefore)){
        m.stabilityDays=Math.max(m.stabilityDays,v76SeedStability(p.mastery));
      }
    }
    m.difficulty=v76Clamp(m.difficulty-(strong?.25:.12)-(ctx.retrievability<.85?.08:0),1,10);
  }else{
    m.stabilityDays=v76Clamp(v76LapseStability(m,ctx.retrievability),.5,180);
    m.difficulty=v76Clamp(m.difficulty+(strong?.8:.65),1,10);
    m.lapses++;
  }
  m.reviews++;
  m.lastRetrievability=ctx.retrievability;
  m.lastReviewAt=ctx.nowIso;
  m.updatedAt=ctx.nowIso;
  m.targetRetention=v76TargetRetention(v,p);
  if(ok){
    const days=pending.isRetry?WASEDA_MEMORY_POLICY.retryCorrectIntervalDays:v76ReviewIntervalDays(v,p,m);
    m.lastIntervalDays=days;
    p.nextReview=new Date(ctx.nowMs+days*V76_DAY_MS).toISOString();
  }else{
    m.lastIntervalDays=WASEDA_MEMORY_POLICY.missIntervalMinutes*V76_MINUTE_MS/V76_DAY_MS;
    p.nextReview=new Date(ctx.nowMs+WASEDA_MEMORY_POLICY.missIntervalMinutes*V76_MINUTE_MS).toISOString();
  }
}
