import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const url=process.env.QA_BASE_URL||'http://127.0.0.1:4173/rikkyo-uk-vocab/';
const browser=await chromium.launch({headless:true});
const width=Number(process.env.QA_WIDTH||390);
async function isolatedContext(options={}){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390,...options});
 // Browser QA uses synthetic learning records, including on the published site.
 await context.route('https://*.workers.dev/**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:false,code:'isolated_ui_test'})}));
 return context;
}
const errors=[];
async function fresh(){
 const context=await isolatedContext({serviceWorkers:'block'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.RikkyoHost&&document.getElementById('audioQuestions'));
 return page;
}
async function start(p,mode='recommended',size='10'){
 await p.selectOption('#modeSelect',mode);await p.selectOption('#sessionSizeSelect',size);await p.click('#startBtn');
 await p.waitForFunction(()=>typeof currentQuestion!=='undefined'&&currentQuestion?.v);
}
async function answer(p,ok=true){
 const q=await p.evaluate(()=>({id:currentQuestion.v.id,type:currentQuestion.type,word:currentQuestion.v.word}));
 if(['choice','reverseChoice','audioChoice'].includes(q.type)){
   const selector=ok?`.answer-btn[data-choice="${q.id}"]`:`.answer-btn:not([data-choice="${q.id}"])`;
   await p.locator(selector).first().click();
 }else{await p.fill('#typedAnswer',ok?q.word:'wrong-answer');await p.click('#submitTyped')}
 await p.waitForFunction(()=>currentQuestion.submitted);return q;
}
try{
 const p=await fresh();
 const tuple=await p.evaluate(async()=> (await fetch('./release-manifest.json')).json());assert.equal(tuple.productVersion,'4.0.0');
 assert.equal(await p.locator('#modeSelect option').count(),10);
 assert.equal(await p.evaluate(()=>VOCAB.length),241);
 assert.equal(await p.evaluate(()=>VOCAB.filter(v=>!EXAM_EXAMPLES[v.id]?.ja).length),0);
 assert.equal(await p.evaluate(()=>VOCAB.filter(v=>/監査エラー|undefined/.test(examExampleHTML(v))).length),0);
 assert.equal(await p.evaluate(()=>VOCAB.filter(v=>EXAM_EXAMPLES[v.id].mode==='generated'&&/過去問例文/.test(examExampleHTML(v))).length),0);
 await p.evaluate(()=>{localStorage.setItem('waseshibu_vocab_state','WASEDA-STATE-SENTINEL');localStorage.setItem('waseshibu_vocab_active_session_v1','WASEDA-SESSION-SENTINEL')});
 await start(p);assert.equal(await p.evaluate(()=>currentQuestion.type),'choice');assert.equal(await p.locator('.answer-btn').count(),4);
 const first=await answer(p,true);
 const before=await p.evaluate(()=>({p:state.words[currentQuestion.v.id],qid:currentQuestion.questionInstanceId,total:state.stats.totalAnswers}));
 assert.equal(before.p.correct,1);assert.ok(before.p.memoryModel.stabilityDays>0);assert.ok(Date.parse(before.p.nextReview)>Date.now());
 const feedback=await p.locator('#feedback').innerText();assert.ok(feedback.includes(await p.evaluate(()=>EXAM_EXAMPLES[currentQuestion.v.id].ja)));
 await p.reload();await p.waitForFunction(()=>window.RikkyoHost&&document.getElementById('audioQuestions'));
 await p.locator('#resumeActiveBtn').waitFor();await p.click('#resumeActiveBtn');
 assert.equal(await p.evaluate(()=>currentQuestion.questionInstanceId),before.qid);
 assert.equal(await p.evaluate(()=>state.stats.totalAnswers),before.total);
 assert.equal(await p.evaluate(()=>currentQuestion.submitted),true);
 await p.click('#nextBtn');const missed=await answer(p,false);
 assert.notEqual(first.id,missed.id);
 const wrong=await p.evaluate(()=>state.words[currentQuestion.v.id]);assert.equal(wrong.incorrect,1);assert.equal(Date.parse(wrong.nextReview)-Date.parse(wrong.lastStudied),await p.evaluate(()=>WASEDA_MEMORY_POLICY.missIntervalMinutes*60000));
 assert.equal(await p.evaluate(()=>localStorage.getItem('waseshibu_vocab_state')),'WASEDA-STATE-SENTINEL');
 assert.equal(await p.evaluate(()=>localStorage.getItem('waseshibu_vocab_active_session_v1')),'WASEDA-SESSION-SENTINEL');
 const seen=new Map();
 for(let n=0;n<18;n++){
   await p.click('#nextBtn');if(!await p.evaluate(()=>session?.active))break;
   const x=await answer(p,true);seen.set(x.id,(seen.get(x.id)||0)+1);
 }
 assert.equal(await p.evaluate(()=>!!session?.active),false);assert.ok([...seen.values()].every(n=>n<=2));
 await p.locator('#sheetContent button').filter({hasText:'閉じる'}).click();
 for(const view of ['list','stats','analysis','settings','learn']){await p.click(`.nav button[data-view="${view}"]`);await p.locator('#view-'+view).waitFor({state:'visible'})}
 if(process.env.QA_SCREENSHOT_DIR){await mkdir(process.env.QA_SCREENSHOT_DIR,{recursive:true});await p.screenshot({path:process.env.QA_SCREENSHOT_DIR+'/coach-home.png',fullPage:true})}
 // Test the actual upstream functions on the same corpus and deterministic clock.
 // A second page loads original upstream modules, excluding only init().
 const reference=await fresh();
 const lock=JSON.parse(await readFile('waseda-app.lock.json','utf8'));
 let raw='';for(const name of lock.runtimeOrder)raw+=await readFile('vendor/waseda/'+name,'utf8')+'\n';
 const data=await p.evaluate(()=>({vocab:VOCAB,cloze:CLOZE,meta:META,top:TOP100,examples:EXAM_EXAMPLES}));
 await reference.goto('about:blank');
 await reference.setContent('<html><body></body></html>');
 // Keep reference localStorage accessible under the same test origin.
 await reference.goto(url);await reference.waitForFunction(()=>window.RikkyoHost);
 await reference.evaluate(({raw,data})=>{
   window.__reference=new Function('window','document','localStorage',`const VOCAB=${JSON.stringify(data.vocab)},CLOZE=${JSON.stringify(data.cloze)},META=${JSON.stringify(data.meta)},TOP100=${JSON.stringify(data.top)},EXAM_EXAMPLES=${JSON.stringify(data.examples)};${raw};return {run: function(){${''}state=defaultState();now=()=>1900000000000;saveState=()=>{};let result=[];const oldRandom=Math.random;Math.random=()=>.51;for(const v of VOCAB.slice(0,8)){for(let i=0;i<8;i++){v75ApplyMainOutcome(v,{outcome:i===2?'miss':'got',qType:i<3?'choice':'reverse',questionInstanceId:v.id+'-'+i});result.push({p:JSON.parse(JSON.stringify(getProgress(v.id))),type:chooseType(v,false),score:schedulerScore(v,'recommended')});}}Math.random=oldRandom;return result;}}`)(window,document,{getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
 },{raw,data});
 await reference.clock.setFixedTime(1900000000000);
 await p.clock.setFixedTime(1900000000000);
 const expected=await reference.evaluate(()=>window.__reference.run());
 const actual=await p.evaluate(()=>{
   const prior=state,priorNow=now,priorSave=saveState,priorRandom=Math.random;state=defaultState();now=()=>1900000000000;saveState=()=>{};Math.random=()=>.51;
   const result=[];for(const v of VOCAB.slice(0,8))for(let i=0;i<8;i++){v75ApplyMainOutcome(v,{outcome:i===2?'miss':'got',qType:i<3?'choice':'reverse',questionInstanceId:v.id+'-'+i});result.push({p:JSON.parse(JSON.stringify(getProgress(v.id))),type:chooseType(v,false),score:schedulerScore(v,'recommended')})}
   state=prior;now=priorNow;saveState=priorSave;Math.random=priorRandom;return result;
 });assert.deepEqual(actual,expected,'Memory, mastery, type progression and scheduler differ from upstream');
 // Export and restore to a separate empty profile, including checksum rejection.
 await p.click('.nav button[data-view="settings"]');const download=p.waitForEvent('download');await p.click('#exportBtn');
 const exported=JSON.parse(await readFile(await(await download).path(),'utf8'));assert.equal(exported.exportFormatVersion,4);
 const restored=await fresh();await restored.evaluate(raw=>window.RikkyoHost.import(raw),exported);
 assert.deepEqual(await restored.evaluate(()=>state.words),exported.state.words);
 assert.equal(await restored.evaluate(async raw=>{raw.state.stats.totalAnswers++;try{await window.RikkyoHost.import(raw);return false}catch{return true}},exported),true);
 await restored.evaluate(()=>window.RikkyoHost.saveBackup());assert.equal(await restored.evaluate(async()=> (await window.RikkyoHost.backups()).length),1);
 // Migrate a real v3 database shape, retaining untouched legacy records and IDs.
 const legacy=await fresh();const fixture=JSON.parse(await readFile('tests/fixtures/v3-golden-export.json','utf8'));
 const seed=await legacy.evaluate(async fixture=>{
   const id=VOCAB[0].id;
   const source=JSON.parse(JSON.stringify(fixture).replaceAll('rik-v-golden',id));
   source.memory.push({...source.memory[0],key:'skill:retired-qa:meaningRecognition',stableId:'retired-qa',correct:5});
   const r=indexedDB.open('rikkyo-uk-vocab-main-v1',3);const db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
   const tx=db.transaction(['meta','memory','events','sessions','plans'],'readwrite');
   tx.objectStore('meta').put(source.generation);tx.objectStore('meta').put(source.preferences);
   for(const row of source.memory)tx.objectStore('memory').put({...row,card:row.card?{...row.card,due:new Date(row.card.due),last_review:new Date(row.card.last_review)}:null});
   for(const row of source.events)tx.objectStore('events').put(row);
   for(const row of source.plans)tx.objectStore('plans').put(row);
   tx.objectStore('sessions').put(source.activeSession);
   await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
   localStorage.removeItem('rikkyo-uk-vocab:coach-v4');return {id,source};
 },fixture);
 await legacy.reload();await legacy.locator('#resumeActiveBtn').waitFor();await legacy.click('#resumeActiveBtn');
 assert.equal(await legacy.evaluate(()=>currentQuestion.questionInstanceId),'q-next');
 assert.equal(await legacy.evaluate(id=>state.words[id].correct,seed.id),2);
 assert.equal(await legacy.evaluate(()=>state.words['retired-qa'].correct),5);
 assert.equal(await legacy.evaluate(id=>state.words[id].nextReview,seed.id),seed.source.memory[0].dueAt);
 const retained=await legacy.evaluate(async()=>{
   const r=indexedDB.open('rikkyo-uk-vocab-main-v1',3);const db=await new Promise(resolve=>{r.onsuccess=()=>resolve(r.result)});
   async function get(store){const q=db.transaction(store).objectStore(store).getAll();return new Promise(resolve=>{q.onsuccess=()=>resolve(q.result)})}
   return JSON.parse(JSON.stringify({memory:await get('memory'),events:await get('events'),sessions:await get('sessions')}));
 });
 assert.deepEqual(retained.memory.sort((a,b)=>a.key.localeCompare(b.key)),seed.source.memory.sort((a,b)=>a.key.localeCompare(b.key)));
 assert.deepEqual(retained.events.sort((a,b)=>a.key.localeCompare(b.key)),seed.source.events.sort((a,b)=>a.key.localeCompare(b.key)));
 assert.deepEqual(retained.sessions,[seed.source.activeSession]);
 await answer(legacy,true);assert.equal(await legacy.evaluate(id=>state.words[id].correct,seed.id),3);
 const legacyDownload=legacy.waitForEvent('download');await legacy.evaluate(()=>exportData());
 const portableLegacy=JSON.parse(await readFile(await(await legacyDownload).path(),'utf8'));
 const legacyRestore=await fresh();await legacyRestore.evaluate(raw=>window.RikkyoHost.import(raw),portableLegacy);
 await legacyRestore.locator('#resumeActiveBtn').waitFor();await legacyRestore.click('#resumeActiveBtn');
 assert.equal(await legacyRestore.evaluate(id=>state.words[id].correct,seed.id),3);
 const importedV3=await fresh();await importedV3.evaluate(f=>window.RikkyoHost.import(f),fixture);
 assert.equal(await importedV3.evaluate(()=>state.words['rik-v-golden'].correct),2);
 const draft=await fresh();await start(draft);
 await draft.evaluate(()=>{currentQuestion.type='reverse';v75RenderCurrentQuestion();persistActiveSession()});
 await draft.fill('#typedAnswer','par');
 const draftId=await draft.evaluate(()=>currentQuestion.questionInstanceId);
 await draft.reload();await draft.locator('#resumeActiveBtn').waitFor();await draft.click('#resumeActiveBtn');
 assert.equal(await draft.inputValue('#typedAnswer'),'par');assert.equal(await draft.evaluate(()=>currentQuestion.questionInstanceId),draftId);
 const activeDownload=draft.waitForEvent('download');await draft.evaluate(()=>exportData());
 const activeBackup=JSON.parse(await readFile(await(await activeDownload).path(),'utf8'));
 const activeRestore=await fresh();await activeRestore.evaluate(raw=>window.RikkyoHost.import(raw),activeBackup);
 await activeRestore.locator('#resumeActiveBtn').waitFor();await activeRestore.click('#resumeActiveBtn');
 assert.equal(await activeRestore.inputValue('#typedAnswer'),'par');assert.equal(await activeRestore.evaluate(()=>currentQuestion.questionInstanceId),draftId);
 await activeRestore.fill('#typedAnswer','');await activeRestore.click('#submitTyped');assert.equal(await activeRestore.evaluate(()=>state.stats.totalAnswers),0);
 await activeRestore.evaluate(()=>{state.settings.audioQuestions='off';currentQuestion.type='audio';v75RenderCurrentQuestion()});
 assert.equal(await activeRestore.evaluate(()=>currentQuestion.type),'reverse');
 // Every retained category uses the upstream pool. Empty weak/review pools are legitimate.
 for(const mode of ['recommended','exam','60','70','75','unlearned','weak','review','frequent','random']){
   const check=await restored.evaluate(mode=>{state.settings.mode=mode;return filterPool(mode).map(v=>v.id)},mode);assert.ok(Array.isArray(check));
 }
 const unlimited=await fresh();await start(unlimited,'random','0');assert.equal(await unlimited.evaluate(()=>session.unlimited),true);
 const recent=[],recentWindow=await unlimited.evaluate(()=>WASEDA_PLANNING_POLICY.unlimitedRecentWindow);
 assert.equal(recentWindow,6,'Pinned upstream unlimited repetition window');
 for(let i=0;i<12;i++){const q=await answer(unlimited);assert.ok(!recent.slice(-recentWindow).includes(q.id));recent.push(q.id);await unlimited.click('#nextBtn')}
 // Production service worker must cache the dynamically loaded full runtime.
 const offlineContext=await isolatedContext();const offline=await offlineContext.newPage();offline.on('pageerror',e=>errors.push(e.message));
 await offline.goto(url);await offline.waitForFunction(()=>window.RikkyoHost&&document.getElementById('audioQuestions'));
 await offline.evaluate(()=>navigator.serviceWorker.ready);await offline.reload();
 await offline.waitForFunction(()=>navigator.serviceWorker.controller&&window.RikkyoHost&&document.getElementById('audioQuestions'));
 await offlineContext.setOffline(true);await offline.reload();await offline.waitForFunction(()=>window.RikkyoHost&&document.getElementById('audioQuestions'));
 await start(offline);await answer(offline,true);assert.equal(await offline.evaluate(()=>state.stats.totalAnswers),1);
 assert.deepEqual(errors,[]);console.log((process.env.QA_PASS||'QA')+': full app, translated examples, resume, retries, 64 upstream memory comparisons, export/import, isolation PASS');
}finally{await browser.close()}
