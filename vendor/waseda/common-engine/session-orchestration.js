/*
 * School-neutral vocabulary session orchestration.
 * Eligibility, scoring, mode meaning and retry timing are supplied by adapters.
 */
const VOCABULARY_SESSION_ENGINE=Object.freeze({
  buildPlan(options){
    const pool=options.pool;
    if(options.size===options.unlimitedSize){
      return {unlimited:true,candidatePoolIds:pool.map(options.getId),baseQueueIds:[],actualSessionSize:0};
    }
    if(options.isSpecialMode(options.mode)){
      return Object.assign({unlimited:false,candidatePoolIds:[]},options.buildSpecialPlan(options.year,options.size));
    }
    const n=Math.min(options.size,pool.length);
    const picked=options.isRandomMode(options.mode)
      ?options.shuffle(pool).slice(0,n)
      :options.weightedWithoutReplacement(pool,n,item=>options.score(item,options.mode));
    return {
      unlimited:false,
      candidatePoolIds:[],
      baseQueueIds:picked.map(options.getId),
      actualSessionSize:picked.length,
      specialCount:picked.filter(options.isSpecialEntity).length,
      baseReasons:{}
    };
  },
  dueRetry(retryQueue,totalAnswered,isBlocked){
    return retryQueue
      .filter(item=>item.dueAfterTotal<=totalAnswered&&!isBlocked(item.wordId))
      .sort((a,b)=>a.dueAfterTotal-b.dueAfterTotal)[0]||null;
  },
  pickUnlimitedBase(options){
    let pool=options.candidateIds.map(options.resolve).filter(Boolean).filter(item=>!options.isBlocked(options.getId(item)));
    pool=options.restrictPool(pool,options.mode);
    if(!pool.length)return null;
    const recent=new Set(options.recentIds.slice(-options.recentWindow));
    let candidates=pool.filter(item=>!recent.has(options.getId(item)));
    if(!candidates.length)candidates=pool;
    return options.weightedChoice(candidates,candidates.map(item=>options.score(item,options.mode)));
  },
  nextItem(options){
    const state=options.state;
    const due=options.dueRetry();
    if(due){
      state.retryQueue=state.retryQueue.filter(item=>item!==due);
      state.retryCounts[due.wordId]=(state.retryCounts[due.wordId]||0)+1;
      return {v:options.resolve(due.wordId),isRetry:true};
    }
    if(state.unlimited){
      const item=options.pickUnlimitedBase();
      if(item){state.generatedBaseIds.push(options.getId(item));return {v:item,isRetry:false}}
      return null;
    }
    if(state.baseCursor<state.baseQueueIds.length){
      const id=state.baseQueueIds[state.baseCursor++];
      return {v:options.resolve(id),isRetry:false,reason:state.baseReasons&&state.baseReasons[id]||""};
    }
    return null;
  }
});
