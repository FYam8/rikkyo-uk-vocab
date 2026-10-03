import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const read = p => readFile(p, 'utf8');
const lock = JSON.parse(await read('waseda-app.lock.json'));
const enrichment = JSON.parse(await read('public/data/enrichment.json'));
const translations = JSON.parse(await read('src/coach/source-translations.json'));
const rows = Object.values(enrichment.entities);
const manifest=JSON.parse(await read('public/data/manifest.json'));
const packed=(await Promise.all(manifest.chunks.map(name=>read('public/data/'+name).then(JSON.parse)))).flat();
const posById=new Map(packed.map(row=>[row[0],row[3]]));
const vocab = rows.map(e => ({
  id:e.stableId, word:e.lemma, meaning:e.meaningJa, representativeMeaning:e.meaningJa,
  pos:({noun:'n.',verb:'v.',adjective:'adj.',adverb:'adv.'}[posById.get(e.stableId)]||posById.get(e.stableId)||'phrase'), priority:e.priority,
  level:{Foundation:60,Core:70,Challenge:75}[e.targetBand],
  studyLayer:e.targetBand==='Challenge'?'challenge':'core',
  frequency:e.observedFrequency, surfaceFrequency:e.observedFrequency,
  yearCount:e.years.length, years:e.years, surfaceYears:e.years,
  categories:e.categories.map(c=>c==='reading-language'?'reading':c),
  derivatives:[],relatedPhrases:[],directYears:[],directOrderYears:[],directAnswerYears:[],
  derivedForms:[],compoundForms:[],forms:[e.lemma],glossed:false,
  sourceType:e.lemma.includes(' ')?'phrase':'word',auditStatus:'rikkyo-source-reviewed',
  note:e.sourceExample?'':'立教の出題傾向に合わせた練習例文です。',
}));
const examples={}, cloze={};
for(const e of rows){
  const ex=e.sourceExample, gen=e.generatedExample;
  if(ex){
    if(!translations[ex.sentence])throw new Error('Translation missing: '+e.lemma);
    // The legacy excerpt starts halfway through a quotation. Use the following
    // complete sentence when it still contains the target form.
    const prefix='It may grow." ';
    let sentence=ex.sentence, ja=translations[sentence];
    if(sentence.startsWith(prefix)&&sentence.slice(prefix.length).toLowerCase().includes(ex.matchedForm.toLowerCase())){
      sentence=sentence.slice(prefix.length);ja=translations[sentence];
    }
    examples[e.stableId]={...ex,sentence,ja,source:`英語${ex.schedule} 問題冊子`,mode:'exact'};
  }else if(gen){
    examples[e.stableId]={sentence:gen.sentence,ja:gen.ja,year:'',source:'練習用例文',matchedForm:e.lemma,mode:'generated',note:'過去問の引用ではなく、立教の出題傾向から作成した練習文です。'};
  }else throw new Error('Example missing: '+e.lemma);
  const display=examples[e.stableId];
  if(!display.ja||!display.sentence)throw new Error('Incomplete example: '+e.lemma);
  // Waseda asks for the headword. Avoid masking an inflection that would make
  // the accepted headword grammatically incompatible with this sentence.
  if(e.cloze && display.matchedForm.toLowerCase()===e.lemma.toLowerCase())cloze[e.lemma]=e.cloze.sentence;
}
const count=l=>vocab.filter(v=>v.studyLayer===l).length;
const meta={
  dataVersion:'rikkyo-2024-2026-waseda-v7.6',years:[2024,2025,2026],
  method:'FY24–FY26 英語A/Bを統合。立教の教材を早稲田と同じ出題・記憶モデルで学習。',
  auditStatus:'原本照合例文・全文和訳付き',rawCandidateEntries:912,
  registeredWords:vocab.filter(v=>v.sourceType==='word').length,registeredPhrases:vocab.filter(v=>v.sourceType==='phrase').length,
  learnableTotal:vocab.length,registeredTotal:vocab.length,directVocabCount:'未集計',glossedReferenceCount:0,
  verifiedEvidenceEntries:rows.filter(e=>e.evidence.length).length,
  layerCounts:{core:count('core'),diagnostic:0,challenge:count('challenge'),reference:0},
  frequencySourceFiles:[2024,2025,2026].flatMap(y=>['A','B'].map(s=>`FY${String(y).slice(-2)} 英語${s} 問題冊子`)),
  auxiliaryAnswerFiles:[],missing:['公式解答・リスニング音源は本教材に含めていません。'],
};
const top=[...vocab].sort((a,b)=>b.frequency-a.frequency).slice(0,100).map((v,i)=>({...v,rank:i+1,reason:'確認年度と出現回数'}));
const data=`const VOCAB=${JSON.stringify(vocab)};\nconst CLOZE=${JSON.stringify(cloze)};\nconst META=${JSON.stringify(meta)};\nconst TOP100=${JSON.stringify(top)};\nconst EXAM_EXAMPLES=${JSON.stringify(examples)};\n`;

// Only school identity, version identifiers, and storage bindings are patched.
// All question, memory, queue, grading and UI functions are upstream source.
export function adaptSource(source){
  return source.replaceAll('早稲渋','立教英国学院')
    .replaceAll('waseshibu_vocab_state','rikkyo-uk-vocab:waseda-state')
    .replaceAll('waseshibu_vocab_active_session_v1','rikkyo-uk-vocab:waseda-session')
    .replaceAll('2019-2026-v7.5-user-test-remediation',meta.dataVersion)
    .replaceAll('2019-2026-v7.6-memory-curve-scheduler',meta.dataVersion)
    .replace('function wasedaStorageGet(key){return localStorage.getItem(key)}','function wasedaStorageGet(key){return window.RikkyoHost.get(key)}')
    .replace('function wasedaStorageSet(key,value){localStorage.setItem(key,value)}','function wasedaStorageSet(key,value){window.RikkyoHost.set(key,value)}')
    .replace('function wasedaStorageRemove(key){localStorage.removeItem(key)}','function wasedaStorageRemove(key){window.RikkyoHost.remove(key)}');
}
let code=data;
for(const name of lock.runtimeOrder){
  const source=await read(`vendor/waseda/${name}`);
  if(createHash('sha256').update(source).digest('hex')!==lock.files[name])throw new Error('Upstream drift: '+name);
  code+=`\n/* UPSTREAM BEGIN ${name} */\n${adaptSource(source)}\n/* UPSTREAM END ${name} */\n`;
}
code+='\n'+await read('src/coach/school-adapter.js')+'\n'+await read('vendor/waseda/40-runtime-bootstrap-tail.js');
let shell=await read('vendor/waseda/00-shell-prefix.html');
shell=shell.slice(0,shell.lastIndexOf('<script>'));
shell=adaptSource(shell).replaceAll('2019–2026','2024–2026')
  .replace('通常学習・基礎診断・75点挑戦・参照のみの4層。基礎診断語は初回客観テストに正解すれば反復を大幅に減らし、参照語（日本語注釈付き・年度固有テーマ語など）は検索できますが通常クイズには出しません。','立教FY24–FY26の英語A/Bを統合。初めての語は4択から始め、習熟度に応じて入力・文脈・音声問題へ進みます。');
// Keep generated pages out of search without changing the pinned upstream shell.
shell=shell.replace(/<meta\\s+name=["'](?:robots|googlebot)["'][^>]*>\\s*/gi,'');
shell=shell.replace('</head>',"<meta name=\"robots\" content=\"noindex,nofollow,noarchive,nosnippet,noimageindex\">\n<meta name=\"googlebot\" content=\"noindex,nofollow,noarchive,nosnippet,noimageindex\">\n</head>");
shell=shell.replace('</head>','<link rel="manifest" href="/rikkyo-uk-vocab/manifest.webmanifest">\n</head>');
shell=shell.replaceAll('4層適応学習','適応学習').replaceAll('学習4層・重要度','教材区分・重要度')
  .replace('語彙は①通常学習、②基礎診断、③75点挑戦、④参照のみの4層。基礎診断語は初回客観テストに正解すれば反復を大幅に減らし、参照語（日本語注釈付き・年度固有テーマ語など）は検索できますが通常クイズには出しません。','立教のFoundation・Core・Challengeを対象に、初回の4択から習熟度に応じて問題形式と復習間隔が変わります。');
await mkdir('public/assets',{recursive:true});
await writeFile('public/assets/coach-runtime.js',code);
await writeFile('index.html',shell+'<script type="module" src="/src/coach/bootstrap.js"></script>\n</body></html>\n');
await writeFile('public/data/coach.json',JSON.stringify({vocab,examples,cloze,meta}));
console.log(`Waseda complete app assembled: ${vocab.length} words, ${Object.keys(examples).length} translated examples`);
