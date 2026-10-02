import fs from 'node:fs';import assert from 'node:assert/strict';import {WORD_TIERS} from '../src/progress/tiers.js';import {buildStateRecords,buildOccurrenceRecords} from '../src/progress/projection.js';
const entities=Object.values(JSON.parse(fs.readFileSync('public/data/enrichment.json')).entities);assert.deepEqual(WORD_TIERS,Object.fromEntries(entities.map(x=>[x.stableId,x.targetBand])));
const ids=['Foundation','Core','Challenge'].map(t=>entities.find(x=>x.targetBand===t).stableId),at='2026-09-30T03:00:00.000Z';
const state={words:Object.fromEntries(ids.map((id,i)=>[id,{correct:i===0?5:1,incorrect:1,mastery:i===0?4:1,lastRating:i===1?'miss':'got',lastStudied:at,nextReview:at,memoryModel:{stabilityDays:7},recentResults:[{answer:'PRIVATE'}]}]))},before=JSON.stringify(state),p=buildStateRecords(state)[0].payload;
for(const [k,v]of Object.entries({learnedWordCount:3,masteredCount:1,learningCount:1,relearningCount:1,reviewDue:3,foundationMastered:1,foundationTotal:30,coreTotal:151,challengeTotal:60}))assert.equal(p[k],v,k);
assert.equal(p.lastLearningAt,at);assert.equal(JSON.stringify(state),before);assert.ok(!JSON.stringify([...buildStateRecords(state),...buildOccurrenceRecords(state)]).includes('PRIVATE'));
for(const word of Object.values(state.words))delete word.lastStudied;assert.equal(buildStateRecords(state)[0].payload.lastLearningAt,undefined);assert.ok(buildOccurrenceRecords(state).every(x=>x.payload.clockUnknown));
console.log('Vocab Cloud projection PASS: source tiers, counts, unknown timestamps, memory unchanged and privacy');
