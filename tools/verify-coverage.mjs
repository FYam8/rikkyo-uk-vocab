import fs from 'node:fs';
import assert from 'node:assert/strict';
import {originalExcerpts} from './original-excerpts.mjs';
import {evidenceFor,priorityFor} from './coverage-policy.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const manifest=read('public/data/manifest.json'),release=read('public/release-manifest.json');
const enrichment=read('public/data/enrichment.json'),registry=read('public/data/registry.json');
const corpus=read('tools/data/paper-corpus.json'),baseline=read('tools/data/legacy-v4.json');
const rows=manifest.chunks.flatMap(name=>read('public/data/'+name));
assert.equal(rows.length,manifest.coreEntityCount);
assert.equal(registry.length,manifest.registryEntityCount);
assert.equal(new Set(registry).size,registry.length);
assert.equal(new Set(rows.map(r=>r[0])).size,rows.length);
assert.equal(new Set(rows.map(r=>r[1].toLowerCase())).size,rows.length);
assert.equal(enrichment.entityCount,rows.length);
assert.equal(release.datasetVersion,manifest.dataVersion);
assert.equal(release.enrichmentVersion,enrichment.version);
assert.equal(manifest.enrichmentVersion,enrichment.version);
for(const id of baseline.registryIds)assert.ok(registry.includes(id),'Lost historical ID: '+id);
for(const old of baseline.rows){const current=rows.find(r=>r[0]===old[0]);assert.ok(current,'Lost existing word: '+old[1]);assert.deepEqual(current.slice(0,4),old.slice(0,4));}
for(const row of rows){
 const e=enrichment.entities[row[0]];assert.ok(registry.includes(row[0]));
 assert.deepEqual(e.evidence,evidenceFor(e.lemma,row[3],corpus.papers),e.lemma);
 assert.equal(e.observedFrequency,e.evidence.reduce((n,x)=>n+x.count,0),e.lemma);
 assert.equal(e.paperCount,new Set(e.evidence.map(x=>x.year+'-'+x.schedule)).size);
 assert.equal(e.sourceScope,e.observedFrequency||e.questionTargetEvidence.length?'past-paper':'extension');
 if(e.sourceScope==='extension'){assert.equal(e.priority,'C');assert.equal(e.studyLayer,'reference');assert.equal(e.sourceExample,null);}
 assert.equal(e.priority,priorityFor({frequency:e.observedFrequency,paperCount:e.paperCount,yearCount:e.observedYears.length,directTarget:!!e.questionTargetEvidence.length,glossOnly:e.glossedInSource}));
 assert.equal(row[8],e.observedFrequency>0);assert.equal(row[9],e.observedFrequency>0);
 assert.equal(e.studyLayer==='reference',e.observedFrequency===0);
 if(e.observedFrequency>0)assert.ok(e.sourceExample,'Missing original: '+e.lemma);
 if(e.sourceExample){
   const ex=e.sourceExample,original=originalExcerpts.find(x=>x.excerptId===ex.excerptId);
   assert.ok(original,e.lemma);assert.equal(ex.sentence,original.sentence,e.lemma);assert.equal(ex.ja,original.ja,e.lemma);
   assert.equal(ex.pdfSha256,corpus.papers.find(p=>p.key===ex.paperKey).pdfSha256);
   assert.equal(ex.provenance,'past-paper-verbatim');
 }
 assert.ok(e.sourceExample||e.generatedExample);
 assert.ok(e.generatedExample?.ja||e.sourceExample);
}
assert.equal(enrichment.sourceMatchedEntityCount,Object.values(enrichment.entities).filter(e=>e.observedFrequency>0).length);
assert.equal(new Set(corpus.papers.map(p=>p.year+'-'+p.schedule)).size,6);
console.log(`Coverage PASS: ${rows.length} entries, ${enrichment.sourceMatchedEntityCount} printed matches, immutable legacy IDs, exact corpus evidence and priority`);
