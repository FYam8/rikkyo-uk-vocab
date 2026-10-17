import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
// @ts-expect-error audited source bank is a build-time ES module
import {originalExcerpts} from '../tools/original-excerpts.mjs';
const entities=Object.values(JSON.parse(readFileSync(new URL('../public/data/enrichment.json',import.meta.url),'utf8')).entities) as any[];
const corpus=JSON.parse(readFileSync(new URL('../tools/data/paper-corpus.json',import.meta.url),'utf8'));
describe('original past-paper feedback',()=>{
 it('covers every printed target with a literal reviewed excerpt and full translation',()=>{
  for(const e of entities.filter(e=>e.observedFrequency>0)){
   const ex=e.sourceExample,bank=originalExcerpts.find((x:any)=>x.excerptId===ex?.excerptId);
   expect(bank,e.lemma).toBeTruthy();expect(ex.sentence,e.lemma).toBe(bank.sentence);expect(ex.ja).toBe(bank.ja);
   expect(ex.pdfSha256).toBe(corpus.papers.find((p:any)=>p.key===ex.paperKey).pdfSha256);
   expect(e.evidence.some((p:any)=>p.year===ex.year&&p.schedule===ex.schedule&&p.page===ex.page)).toBe(true);
  }
 });
 it('preserves original errors and rearrangement without inventing printed answers',()=>{
  const word=(lemma:string)=>entities.find(e=>e.lemma===lemma);
  expect(word('submit').sourceExample.sentence).toBe("We have to submit this homework today, haven't we?");
  expect(word('submit').sourceExample.kind).toBe('error-correction');expect(word('submit').cloze).toBeNull();
  expect(word('look forward to').sourceExample.sentence).toBe('I am ( forward / you / to / looking ) again.');
  expect(word('look forward to').sourceExample.inferredTarget).toBe(true);
  expect(word('look forward to').sourceExample.matchedForm).toBe('');
  expect(word('look forward to').observedFrequency).toBe(0);
  expect(word('recover').sourceExample.sentence).toContain('(     )');expect(word('recover').cloze).toBeNull();
 });
 it('reserves unprinted targets for an explicit opt-in without changing IDs or frequencies',()=>{
  expect(entities.filter(e=>e.studyLayer==='reference')).toHaveLength(117);
  expect(entities.filter(e=>e.studyLayer!=='reference')).toHaveLength(309);
  for(const e of entities)expect(e.studyLayer==='reference').toBe(e.observedFrequency===0);
 });
});
