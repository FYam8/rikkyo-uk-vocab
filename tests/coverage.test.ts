import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
// @ts-expect-error school build policy is an executable ES module
import {evidenceFor,priorityFor,matcher,variants} from '../tools/coverage-policy.mjs';
const read=(p:string)=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const corpus=read('tools/data/paper-corpus.json');
const es=Object.values(read('public/data/enrichment.json').entities) as any[];
const byWord=(word:string)=>es.find(e=>e.lemma===word);
describe('paper coverage and occurrence policy',()=>{
 it('groups reviewed irregular forms, not unrelated derivatives',()=>{
  expect(variants('hide','verb')).toContain('hidden');
  expect(variants('leaf','noun')).toContain('leaves');
  expect(variants('tie','verb')).toContain('tying');
  const papers=[{year:2026,schedule:'A',pages:[{page:5,category:'reading',text:'They gave up. She is looking after birds. Researchers research. Researching helps.'}]}];
  expect(evidenceFor('give up','phrase',papers)[0].count).toBe(1);
  expect(evidenceFor('look after','phrase',papers)[0].count).toBe(1);
  expect(evidenceFor('research','verb/noun',papers)[0].count).toBe(2);
  expect('tie tired tied'.match(matcher('tie','verb'))).toEqual(['tie','tied']);
 });
 it('keeps the audited cross-paper examples and their real counts',()=>{
  for(const [word,count] of [['research',8],['remember',9],['publish',6],['recover',1],['look after',6],['give up',3],['find out',2],['come up with',1]])expect(byWord(String(word)).observedFrequency, String(word)).toBe(count);
  expect(byWord('research').paperCount).toBe(3);
  expect(byWord('research').years).toEqual([2024,2026]);
 });
 it('does not invent occurrences for unprinted grammar solutions',()=>{
  for(const word of ['take care of','as soon as possible','look forward to']){
   const e=byWord(word);expect(e.observedFrequency).toBe(0);expect(e.evidence).toEqual([]);expect(e.questionTargetEvidence.length).toBeGreaterThan(0);expect(e.sourceScope).toBe('past-paper');
  }
 });
 it('does not confuse a fixed expression with another sense',()=>{
  expect(byWord('up to').observedFrequency).toBe(0);
  expect(byWord('order').observedFrequency).toBe(0);
 });
 it('uses recurrence and frequency without a size quota',()=>{
  expect(es.length).toBeGreaterThan(241);
  expect(priorityFor({frequency:2,paperCount:2,yearCount:2})).toBe('S');
  expect(priorityFor({frequency:20,paperCount:1,yearCount:1,glossOnly:true})).toBe('B');
  expect(priorityFor({frequency:3,paperCount:1,yearCount:1})).toBe('A');
  expect(es.filter(e=>e.sourceScope==='extension').every(e=>e.priority==='C'&&e.studyLayer==='reference')).toBe(true);
 });
 it('excludes repeated instructions and the solved farewell example',()=>{
  const text=JSON.stringify(corpus.papers);
  expect(text).not.toMatch(/farewell party|You will hear an interview|Make sure you write your answer/);
  expect(es.filter(e=>e.selectionOrigin==='paper-coverage-review').every(e=>e.observedFrequency>0||e.questionTargetEvidence.length>0)).toBe(true);
 });
});
