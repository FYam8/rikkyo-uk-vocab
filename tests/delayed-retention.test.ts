import {readFileSync} from 'node:fs';
import {describe, it, expect} from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const lock = JSON.parse(read('waseda-app.lock.json'));
const raw = lock.runtimeOrder.map((p: string) => read('vendor/waseda/' + p)).join('\n');
const policy = read('src/common-engine/delayed-retention.js');
const DAY = 86400000, START = Date.parse('2026-10-17T10:00:00Z');
function engine(seed?: any) {
  return new Function('window', 'document', 'localStorage', 'seed', `
    const VOCAB=[{id:'word',word:'research',meaning:'研究',priority:'A',level:70,studyLayer:'core',frequency:8,years:[2024,2025,2026]}],CLOZE={},META={},TOP100=[],EXAM_EXAMPLES={};
    ${raw}\n${policy}
    let clock=${START}, saved=null, serial=0;now=()=>clock;saveState=()=>{saved=JSON.parse(JSON.stringify(state.words.word))};
    state=defaultState();if(seed)state.words.word=JSON.parse(JSON.stringify(seed));
    return {answer(at,ok=true,type='choice',retry=false){clock=at;v75ApplyMainOutcome(VOCAB[0],{outcome:ok?'got':'miss',qType:type,isRetry:retry,questionInstanceId:'q'+serial++});return JSON.parse(JSON.stringify(state.words.word))},saved(){return saved}};
  `)({}, {}, {getItem: () => null, setItem: () => {}}, seed);
}

describe('delayed retention in the actual pinned coach runtime', () => {
  it('keeps first exposure at learning and schedules another check', () => {
    const e=engine(),p=e.answer(START);
    expect(p.mastery).toBe(1);expect(p.evidence).toBe(1);
    expect(p.retentionEvidence.confirmations).toBe(0);
    expect(Date.parse(p.nextReview)).toBeGreaterThan(START);
    expect(e.saved()).toEqual(p);
  });
  it('cannot build mastery, stability or ease through short practice in new sessions', () => {
    const e=engine(),first=e.answer(START);
    let p=first;
    for(let i=1;i<=30;i++)p=e.answer(START+i*60000,true,'reverse');
    expect(p.correct).toBe(31);expect(p.evidence).toBe(first.evidence);expect(p.mastery).toBe(1);
    expect(p.memoryModel.stabilityDays).toBe(first.memoryModel.stabilityDays);
    expect(p.memoryModel.difficulty).toBe(first.memoryModel.difficulty);
    expect(p.nextReview).toBe(first.nextReview);
  });
  it('retains misses and records the retry without rewarding short recall', () => {
    const e=engine(),miss=e.answer(START,false),retry=e.answer(START+600000,true,'choice',true);
    expect(Date.parse(miss.nextReview)-START).toBe(15*60000);
    expect(retry.evidence).toBe(miss.evidence);expect(retry.mastery).toBe(miss.mastery);
    expect(retry.memoryModel.stabilityDays).toBe(miss.memoryModel.stabilityDays);
    expect(retry.memoryModel.difficulty).toBe(miss.memoryModel.difficulty);
    expect(retry.recentMistakeUntil).toBe(miss.recentMistakeUntil);
    expect(Date.parse(retry.nextReview)).toBe(START+600000+DAY);
    expect(retry.correct).toBe(1);expect(retry.incorrect).toBe(1);
  });
  it('does not postpone the next-day check with more short practice', () => {
    const e=engine();e.answer(START,false);
    const retry=e.answer(START+600000,true,'choice',true);
    const again=e.answer(START+1200000,true,'reverse',true);
    expect(again.nextReview).toBe(retry.nextReview);
  });
  it('also schedules a next-day check when recovery happens in another session', () => {
    const e=engine();e.answer(START,false);
    expect(Date.parse(e.answer(START+600000).nextReview)).toBe(START+600000+DAY);
  });
  it('requires 24 elapsed hours, including across midnight', () => {
    const e=engine();e.answer(START);
    expect(e.answer(START+DAY-1).retentionEvidence.confirmations).toBe(0);
    const f=engine();f.answer(START);
    expect(f.answer(START+DAY).retentionEvidence.confirmations).toBe(1);
  });
  it('measures the gap from the latest exposure, not only a previous credited answer', () => {
    const e=engine();e.answer(START);e.answer(START+12*3600000);
    expect(e.answer(START+DAY).retentionEvidence.confirmations).toBe(0);
  });
  it('weights next-day recall twice and advances stages across separated recalls', () => {
    const e=engine();const first=e.answer(START);
    const next=e.answer(START+DAY,true,'reverse');
    expect(next.evidence-first.evidence).toBe(4);expect(next.mastery).toBe(2);
    expect(next.memoryModel.stabilityDays).toBeGreaterThan(first.memoryModel.stabilityDays);
    const third=e.answer(START+2*DAY,true,'reverse');expect(third.mastery).toBe(3);
    const fourth=e.answer(START+3*DAY,true,'reverse');expect(fourth.mastery).toBe(3);
    expect(e.answer(START+4*DAY,true,'reverse').mastery).toBe(4);
  });
  it('credits a retry resumed after a day as delayed recall', () => {
    const e=engine();e.answer(START,false);
    const p=e.answer(START+DAY,true,'reverse',true);
    expect(p.retentionEvidence.confirmations).toBe(1);
    expect(p.recentResults.at(-1).retentionKind).toBe('delayed');
  });
  it('resets delayed confirmation accumulation on a new error', () => {
    const e=engine();e.answer(START);e.answer(START+DAY,true,'reverse');
    expect(e.answer(START+2*DAY,false).retentionEvidence.confirmations).toBe(0);
  });
  it('preserves old mastery and counts without rewriting history on load', () => {
    const seed={mastery:4,evidence:12,correct:20,incorrect:1,streak:8,lastStudied:new Date(START).toISOString(),nextReview:new Date(START+30*DAY).toISOString(),lastRating:'got',recentResults:[]};
    const p=engine(seed).answer(START+60000,true,'reverse');
    expect(p.mastery).toBe(4);expect(p.evidence).toBe(12);expect(p.correct).toBe(21);expect(p.incorrect).toBe(1);expect(p.nextReview).toBe(seed.nextReview);
  });
  it('retains confirmation evidence and cooldown across persisted reloads', () => {
    const e=engine();e.answer(START);const day=e.answer(START+DAY,true,'reverse');
    const reload=engine(e.saved()),practice=reload.answer(START+DAY+60000,true,'reverse');
    expect(practice.retentionEvidence).toEqual(day.retentionEvidence);
    expect(practice.mastery).toBe(day.mastery);expect(practice.evidence).toBe(day.evidence);
    expect(reload.saved()).toEqual(practice);
  });
});
