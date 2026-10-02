import { WORD_TIERS } from './tiers.js';
const iso=v=>typeof v==='string'&&Date.parse(v)>0?new Date(v).toISOString():null;
const count=v=>Math.max(0,Math.floor(Number(v)||0));
function words(s){return Object.entries(s?.words||{}).filter(([id])=>Object.hasOwn(WORD_TIERS,id)).map(([id,row])=>({id,...row}));}
const attempts=row=>count(row.correct)+count(row.incorrect);
export function buildStateRecords(s){
 if(!s)return[];const rows=words(s),learned=rows.filter(x=>attempts(x)>0),mastered=learned.filter(x=>Number(x.mastery)===4),relearning=learned.filter(x=>x.lastRating==='miss'),last=learned.map(x=>iso(x.lastStudied)).filter(Boolean).sort().at(-1);
 const payload={progressVersion:2,total:rows.reduce((n,x)=>n+attempts(x),0),completed:false,kind:'vocab-memory',learnedWordCount:learned.length,masteredCount:mastered.length,learningCount:learned.filter(x=>Number(x.mastery)<4&&x.lastRating!=='miss').length,relearningCount:relearning.length,reviewDue:learned.filter(x=>iso(x.nextReview)&&Date.parse(x.nextReview)<=Date.now()).length,...(last?{lastLearningAt:last}:{})};
 for(const tier of ['Foundation','Core','Challenge']){const key=tier.toLowerCase();payload[key+'Total']=Object.values(WORD_TIERS).filter(x=>x===tier).length;payload[key+'Mastered']=mastered.filter(x=>WORD_TIERS[x.id]===tier).length;}
 return [{sourceRecordId:'state:summary',eventType:'progress_state',occurredAt:new Date().toISOString(),payload}];
}
export function buildOccurrenceRecords(s){return words(s).filter(x=>attempts(x)>0).map(x=>({sourceRecordId:'word:'+x.id,eventType:'vocab_word_state',occurredAt:iso(x.lastStudied)||'1970-01-01T00:00:00.000Z',payload:{kind:'mastery-'+Math.max(0,Math.min(4,Number(x.mastery)||0)),completed:Number(x.mastery)===4,...(iso(x.lastStudied)?{lastLearningAt:iso(x.lastStudied)}:{clockUnknown:true})}}));}
export function buildBaseline(s){const rows=words(s);return{baseline:true,eventCount:rows.reduce((n,x)=>n+attempts(x),0),eventsByYear:{},capturedAt:new Date().toISOString(),progressLabel:'英単語の学習記録',completedCount:rows.filter(x=>Number(x.mastery)===4&&attempts(x)>0).length,totalCount:rows.filter(x=>attempts(x)>0).length};}
