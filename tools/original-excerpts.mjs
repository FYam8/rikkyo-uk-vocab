import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {matcher,normalized} from './coverage-policy.mjs';
const corpus=JSON.parse(await readFile(new URL('./data/paper-corpus.json',import.meta.url),'utf8'));
const paperInfo={'01':[2024,'A'],'02':[2024,'B'],'07':[2025,'A'],'08':[2025,'B'],'13':[2026,'A'],'14':[2026,'B']};
export const originalExcerpts=(await readFile(new URL('./data/original-excerpts.tsv',import.meta.url),'utf8')).trim().split('\n').map((line,index)=>{
 const [key,page,kind,sentence,ja]=line.split('\t');
 if(!paperInfo[key]||!page||!kind||!sentence||!ja)throw new Error('Incomplete original excerpt '+(index+1));
 const [year,schedule]=paperInfo[key];
 return {excerptId:`${key}-${createHash('sha256').update(sentence).digest('hex').slice(0,12)}`,pdfSha256:corpus.papers.find(p=>p.key===key).pdfSha256,paperKey:key,year,schedule,page:Number(page),kind,sentence,ja,provenance:'past-paper-verbatim'};
});
const rank={reading:0,notice:0,grammar:1,writing:2,question:3,'listening-question':3,gapped:4,reorder:5,'error-correction':6};
export function originalFor(lemma,pos,evidence){
 const inferred={'take care of':'This research suggests','as soon as possible':'{ as / much','look forward to':'I am ( forward','look for':'This is the key','interesting':'The movie was very interested.'};
 if(!evidence.length&&inferred[lemma]){
   const ex=originalExcerpts.find(x=>x.sentence.startsWith(inferred[lemma]));
   return {...ex,matchedForm:'',inferredTarget:true};
 }
 const candidates=originalExcerpts.filter(ex=>evidence.some(e=>e.year===ex.year&&e.schedule===ex.schedule&&e.page===ex.page)&&normalized(ex.sentence).match(matcher(lemma,pos)));
 // Match the departure sense, not "left leg" or leaving an object somewhere.
 const sense=candidates.filter(ex=>lemma!=='leave'||/\bleft\b(?! leg| ankle)/i.test(ex.sentence));
 const selected=(sense.length?sense:candidates).sort((a,b)=>(rank[a.kind]??9)-(rank[b.kind]??9)||a.sentence.length-b.sentence.length)[0];
 if(!selected)return null;
 return {...selected,matchedForm:normalized(selected.sentence).match(matcher(lemma,pos))[0]};
}
