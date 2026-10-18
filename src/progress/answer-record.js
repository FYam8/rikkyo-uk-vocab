(function(root){
 'use strict';
 const text=(v,max)=>{const raw=v==null?'':typeof v==='string'?v:JSON.stringify(v);return raw.length>max?raw.slice(0,max-12)+'…（省略）':raw;};
 function answerRecord(id,at,data){
  if(!id||!data.questionId)return null;
  const payload={answerVersion:1,questionId:text(data.questionId,200),outcome:['correct','wrong','partial','unanswered','ungraded'].includes(data.outcome)?data.outcome:'ungraded'};
  for(const [key,max] of Object.entries({questionLabel:240,questionText:1000,answerText:1400,expectedText:1400,mistakeReason:700,gradingMethod:80,sourceQuestionId:200,mode:80,contentVersion:120}))if(data[key]!==undefined)payload[key]=text(data[key],max);
  if(/^FY(24|25|26)[AB]$/.test(data.examId||''))Object.assign(payload,{progressVersion:2,examId:data.examId,year:'20'+data.examId.slice(2,4),session:data.examId.at(-1)});
  const date=Date.parse(at);if(!Number.isFinite(date)||date<=0)payload.clockUnknown=true;
  return {sourceRecordId:'answer:'+text(id,190),eventType:'answer_record',occurredAt:payload.clockUnknown?'1970-01-01T00:00:00.000Z':new Date(date).toISOString(),payload};
 }
 root.SHARED_ANSWER_RECORD=Object.freeze({answerRecord,text});
})(typeof globalThis!=='undefined'?globalThis:this);
