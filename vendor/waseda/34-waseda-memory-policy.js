/*
 * Waseda-only memory scheduling policy adapter.
 * These values and predicates are extracted from the reviewed v7.6 runtime
 * without changing learner state, persistence identifiers or scheduler outputs.
 */
const WASEDA_MEMORY_POLICY=Object.freeze({
  targetRetention(v,p){
    const s=v&&v.priority==="S",w=!!(p&&isWeakProgress(p));
    if(s&&w)return .93;
    if(s||w)return .92;
    return .90;
  },
  reviewIntervalDays(v,p,model){
    return v76Clamp(v76IntervalForTarget(model.stabilityDays,WASEDA_MEMORY_POLICY.targetRetention(v,p)),.75,60);
  },
  isDiagnosticFirstPass(v,p,attemptsBefore){
    return (v.studyLayer||"core")==="diagnostic"&&attemptsBefore===0&&p.incorrect===0;
  },
  applyReviewUrgencyExtra(extra,v,p,m){
    if(m&&Number(m.version)===V76_MEMORY_MODEL_VERSION){
      const r=v76Retrievability(m),target=v76TargetRetention(v,p);
      if(r<target)extra+=(target-r)*900+90;
    }
    return extra;
  },
  applyExamUrgencyExtra(extra,v,p,m,days){
    if(days!=null&&days>=0&&days<=30){
      const urgency=(30-days)/30;
      if(v.priority==="S")extra+=80*urgency;
      if(isWeakProgress(p))extra+=100*urgency;
      if(m){
        const r=v76Retrievability(m),target=v76TargetRetention(v,p);
        extra+=Math.max(0,target-r)*300*urgency;
      }
    }
    return extra;
  },
  applyChallengeMemoryScore(score,v,p,m){
    if(m){
      const r=v76Retrievability(m),target=v76TargetRetention(v,p);
      if(r<target)score+=(target-r)*700+70;
    }
    return score;
  },
  retryCorrectIntervalDays:1,
  missIntervalMinutes:15
});
