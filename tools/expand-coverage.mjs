import {readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {evidenceFor,priorityFor,matcher} from './coverage-policy.mjs';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const write=async(p,x)=>writeFile(p,JSON.stringify(x,null,2)+'\n');
const baseline=await read('tools/data/legacy-v4.json');
const history=await read('tools/data/historical-ids.json');
const corpus=await read('tools/data/paper-corpus.json');
const additions=(await readFile('tools/data/paper-additions.tsv','utf8')).trim().split('\n').map(line=>line.split('\t'));
if(additions.some(row=>row.length!==6))throw new Error('Each curated entry needs a lemma, meaning, POS, band and bilingual example');
// These targets are implied by the printed grammar task, not actually printed as
// complete expressions. They are included but never inflate observedFrequency.
const targets={
 'take care of':[{year:2024,schedule:'A',page:3,question:'1.2'}],
 'as soon as possible':[{year:2024,schedule:'B',page:3,question:'2.3'}],
 'look forward to':[{year:2026,schedule:'B',page:4,question:'3.3'}],
 'interesting':[{year:2026,schedule:'B',page:5,question:'4.1'}],
 'look for':[{year:2026,schedule:'A',page:4,question:'3.4'}],
 'be interested in':[{year:2026,schedule:'A',page:4,question:'3.5'}],
};
// Japanese-glossed items remain useful but one story's repetition must not
// promote specialised theme words above recurring transferable vocabulary.
const glossOnly=new Set(['leather','merchant','console','flutter','sew','awake','leak','collar','stroke','pharmacy','earn','sow','ceiling','drip','builder','veterinarian','cough','bury','sprain','ankle','replacement','bored','closet','discard','stem','spot','bush','shade','recognise','get rid of','get stuck','earn a living']);
const entries=new Map(baseline.rows.map(row=>[row[1].toLowerCase(),{row:[...row],...baseline.entities[row[0]]}]));
const excluded=[];
for(const [lemma,meaning,pos,band,sentence,ja] of additions){
 const key=lemma.toLowerCase();
 if(entries.has(key))throw new Error('Duplicate curated lemma: '+lemma);
 const evidence=evidenceFor(lemma,pos,corpus.papers);
 if(!evidence.length&&!targets[key]){excluded.push({lemma,reason:'No printed occurrence or separately reviewed grammar target in this corpus'});continue;}
 const id=history[key]?.id||`rik-${pos==='phrase'?'p':'v'}-${createHash('sha256').update(`rikkyo-uk-vocab/v0.23.0/${key}/${pos}`).digest('hex').slice(0,10)}`;
 entries.set(key,{row:[id,lemma,meaning,pos,'B','core',band,['A','B'],true,true],sourceExample:null,generatedExample:{sentence,ja,provenance:'generated-from-rikkyo-patterns'},cloze:null,selectionOrigin:'paper-coverage-review'});
}
const entities={},rows=[];
for(const [key,item] of entries){
 const row=item.row;
 const evidence=evidenceFor(row[1],row[3],corpus.papers);
 const frequency=evidence.reduce((sum,e)=>sum+e.count,0);
 const observedYears=[...new Set(evidence.map(e=>e.year))].sort();
 const years=[...new Set([...observedYears,...(targets[key]||[]).map(e=>e.year)])].sort();
 const papers=[...new Set(evidence.map(e=>`${e.year}-${e.schedule}`))].sort();
 const directTarget=targets[key]||[];
 const sourceScope=frequency||directTarget.length?'past-paper':'extension';
 row[4]=priorityFor({frequency,paperCount:papers.length,yearCount:observedYears.length,directTarget:!!directTarget.length,glossOnly:glossOnly.has(key)});
 // Keep lexical difficulty separate from occurrence provenance. Extension
 // vocabulary is explicitly studied via the upstream Challenge mode.
 row[5]=sourceScope==='extension'||row[6]==='Challenge'?'challenge':'core';
 const sourceExample=evidence.length?item.sourceExample:null;
 const generatedExample=item.generatedExample;
 if(!sourceExample&&!generatedExample)throw new Error('Missing example: '+key);
 let cloze=item.cloze;
 if(!sourceExample||cloze?.provenance!=='past-paper-derived'){
   const m=generatedExample?.sentence.match(matcher(row[1],row[3]));
   cloze=m&&m[0].toLowerCase()===key?{sentence:generatedExample.sentence.replace(m[0],'_____'),answer:row[1],provenance:'generated-from-rikkyo-patterns'}:null;
 }
 entities[row[0]]={stableId:row[0],lemma:row[1],meaningJa:row[2],priority:row[4],studyLayer:row[5],targetBand:row[6],schedules:['A','B'],sourceScope,observedFrequency:frequency,paperCount:papers.length,observedYears,years,sourceSchedules:[...new Set(evidence.map(e=>e.schedule))].sort(),categories:[...new Set(evidence.map(e=>e.category))],evidence,questionTargetEvidence:directTarget,glossedInSource:glossOnly.has(key),sourceExample,generatedExample,cloze,selectionOrigin:item.selectionOrigin};
 rows.push(row);
}
rows.sort((a,b)=>a[0].localeCompare(b[0]));
if(new Set(rows.map(r=>r[0])).size!==rows.length)throw new Error('Stable ID collision');
const registry=[...new Set([...(await read('public/data/registry.json')),...rows.map(r=>r[0])])].sort();
const chunks=[];
for(let i=0;i<rows.length;i+=20){const name=`core-${String(i/20).padStart(2,'0')}.json`;chunks.push(name);await writeFile('public/data/'+name,JSON.stringify(rows.slice(i,i+20))+'\n');}
for(const file of await readdir('public/data'))if(/^core-\d+\.json$/.test(file)&&!chunks.includes(file))await rm('public/data/'+file);
const version='2026-10-17-paper-coverage-v5';
await write('public/data/registry.json',registry);
await write('public/data/enrichment.json',{format:'rikkyo-vocab-enrichment/v1',version,sourceScope:'FY24-FY26 printed English A/B; counted corpus and exclusions in tools/data/paper-corpus.json',generationMethod:'Uncapped reviewed paper vocabulary; POS-aware forms; separate inferred grammar targets; priority from paper/year recurrence and printed occurrences',entityCount:rows.length,sourceMatchedEntityCount:Object.values(entities).filter(e=>e.observedFrequency>0).length,generatedFallbackCount:Object.values(entities).filter(e=>!e.sourceExample).length,entities});
const manifest=await read('public/data/manifest.json');
Object.assign(manifest,{dataVersion:'0.25.0-coverage',registryVersion:'0.25.0',generatedFromPhase:25,registryEntityCount:registry.length,coreEntityCount:rows.length,enrichmentVersion:version,selectionMethod:'uncapped-reviewed-paper-coverage-and-frequency',chunks});
await write('public/data/manifest.json',manifest);
const release=await read('public/release-manifest.json');Object.assign(release,{datasetVersion:manifest.dataVersion,enrichmentVersion:version});await write('public/release-manifest.json',release);
await writeFile('src/progress/tiers.js','// School-owned projection metadata; generated from the current curriculum.\nexport const WORD_TIERS=Object.freeze('+JSON.stringify(Object.fromEntries(rows.map(r=>[r[0],r[6]])))+');\n');
const summary={total:rows.length,added:rows.length-baseline.rows.length,registryCount:registry.length,printedMatches:Object.values(entities).filter(e=>e.observedFrequency>0).length,grammarTargetsOnly:Object.values(entities).filter(e=>!e.observedFrequency&&e.questionTargetEvidence.length).length,extension:Object.values(entities).filter(e=>e.sourceScope==='extension').length,phrases:rows.filter(r=>r[3]==='phrase'||r[1].includes(' ')).length,bands:Object.fromEntries(['Foundation','Core','Challenge'].map(b=>[b,rows.filter(r=>r[6]===b).length])),excludedCandidates:excluded,frequencyPolicy:corpus.scope};
await write('docs/coverage-audit.json',summary);
console.log(summary);
