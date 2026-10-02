// Extracted from FYam8/waseshibu-english progress-sync.js at
// d0e3fcdab95ddfe83ddb00409efa879e889df0ca. School projections stay in the adapter.
(function(root){
'use strict';
function createTransport(options){
const APP_ID=options.appId, SYNC_DB=options.dbName, SYNC_DB_VERSION=options.dbVersion;
if(typeof options.schoolId!=='string'||!options.schoolId||!APP_ID||!SYNC_DB||!Number.isInteger(SYNC_DB_VERSION)||SYNC_DB_VERSION<1)throw new Error('invalid sync profile');
const MAX_BATCH=10;
const RECONCILE_INTERVAL_MS=60_000;
const CONTROL_REFRESH_INTERVAL_MS=5*60_000;
const REQUEST_TIMEOUT_MS=15_000;
const timeoutMs=options.timeoutMs||REQUEST_TIMEOUT_MS;
const te=new TextEncoder();
let running=false,lastControlRefreshAt=0,timer=null;
const endpoint=String(typeof options.endpoint==='function'?options.endpoint():options.endpoint||'').replace(/\/+$/,'');
const apiBase=()=>endpoint;
const loadState=options.loadState,buildStateRecords=options.buildStateRecords,buildOccurrenceRecords=options.buildOccurrenceRecords,occurrenceSignature=options.occurrenceSignature;
const canonicalJson=v=>JSON.stringify(canonicalize(v));
// Additional defence at the outgoing boundary; adapters never pass whole learner state.
const EVENT_FIELDS=new Set(['year','mode','kind','type','score','maxScore','correct','total','draftId','questionId','contentVersion','clockUnknown','step','level','category','skill','section','lesson','unit','completed','durationSec','accuracy','attempt','lastLearningAt','progressVersion','examId','session','examStatus','referenceAccuracy','weaknessCount','masteredCount','practiceCount','retentionPending','learningCount','relearningCount','reviewDue','learnedWordCount','foundationMastered','foundationTotal','coreMastered','coreTotal','challengeMastered','challengeTotal']);
const SNAPSHOT_FIELDS=new Set(['baseline','eventCount','scoredEventCount','scoreTotal','eventsByYear','capturedAt','progressLabel','completedCount','totalCount']);
function assertSummary(payload,allowed){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('invalid progress summary');
  for(const [key,value] of Object.entries(payload)){
    if(!allowed.has(key))throw new Error('progress field not allowed');
    if(key==='eventsByYear'){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([year,n])=>!/^\d{4}$/.test(year)||!Number.isSafeInteger(n)||n<0))throw new Error('invalid year summary');
    }else if(value!==null&&typeof value==='object')throw new Error('nested progress payload not allowed');
  }
}
async function ensureScope(){
  if(options.legacyDatabases?.length&&!(await migrateLegacyDatabases()))return false;
  const db=await openDb();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('control','readwrite'),store=tx.objectStore('control');let compatible=false;
    const read=store.get('deploymentScope');read.onsuccess=()=>{
      const scope=read.result?.value;
      if(scope){compatible=scope.endpoint===endpoint&&scope.schoolId===options.schoolId;return;}
      const reg=store.get('registration'),pending=store.get('pendingRegistration');let completed=0;
      const finish=()=>{if(++completed!==2)return;if((reg.result?.value||pending.result?.value)&&endpoint!==options.legacyEndpoint)return;store.put({key:'deploymentScope',value:{endpoint,schoolId:options.schoolId}});compatible=true};
      reg.onsuccess=finish;pending.onsuccess=finish;
    };
    tx.oncomplete=()=>resolve(compatible);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('scope transaction aborted'));
  })}finally{db.close()}
}
async function migrateLegacyDatabases(){
  for(const legacy of options.legacyDatabases||[]){
    if(!legacy.name||legacy.name===SYNC_DB||legacy.schoolId!==options.schoolId)throw new Error('invalid legacy profile');
    const marker=`migration:${legacy.name}`;
    if((await getControl(marker))?.verified===true)continue;
    if(typeof indexedDB.databases!=='function'){await setControl('migrationBlocked',{database:legacy.name,reason:'database_inventory_unavailable'});return false;}
    if(!(await indexedDB.databases()).some(x=>x.name===legacy.name))continue;
    const old=await new Promise((resolve,reject)=>{const r=indexedDB.open(legacy.name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>{r.transaction.abort();reject(new Error('legacy database disappeared'));};});
    const names=['control','outbox','seen_v2','deadletter'].filter(n=>old.objectStoreNames.contains(n));
    let source={};
    try{
      if(names.length){const tx=old.transaction(names,'readonly');const values=await Promise.all(names.map(n=>requestValue(tx.objectStore(n).getAll())));await txDone(tx);source=Object.fromEntries(names.map((n,i)=>[n,values[i]]));}
    }finally{old.close();}
    const controls=new Map((source.control||[]).map(x=>[x.key,x.value]));
    const identity=controls.get('registration')||controls.get('pendingRegistration');
    const scope=controls.get('deploymentScope');
    if(identity?.credential&&(!scope||scope.endpoint!==endpoint||scope.schoolId!==options.schoolId)){
      await setControl('migrationBlocked',{database:legacy.name,reason:scope?'different_deployment':'unverified_legacy_endpoint'});return false;
    }
    const db=await openDb();let conflict=null,expected=[];
    try{
      const tx=db.transaction(['control','outbox','seen_v2','deadletter'],'readwrite');
      const targetRows=await Promise.all(['control','outbox','seen_v2','deadletter'].map(n=>requestValue(tx.objectStore(n).getAll())));
      const targets=Object.fromEntries(['control','outbox','seen_v2','deadletter'].map((n,i)=>[n,new Map(targetRows[i].map(row=>[row[n==='control'?'key':n==='seen_v2'?'sourceKey':'eventId'],row]))]));
      const targetReg=targets.control.get('registration')?.value,targetPending=targets.control.get('pendingRegistration')?.value;
      const destinationScope=targets.control.get('deploymentScope')?.value;
      if(destinationScope&&(destinationScope.endpoint!==endpoint||destinationScope.schoolId!==options.schoolId))conflict='different_destination_deployment';
      for(const oldId of [controls.get('registration'),controls.get('pendingRegistration')].filter(Boolean)){
        for(const current of [targetReg,targetPending].filter(Boolean))if(oldId.registrationId!==current.registrationId||oldId.credential!==current.credential)conflict='registration_conflict';
      }
      for(const name of ['control','outbox','seen_v2','deadletter'])for(const row of source[name]||[]){
        const key=row[name==='control'?'key':name==='seen_v2'?'sourceKey':'eventId'];
        if(name==='control'&&(key==='deploymentScope'||key==='migrationBlocked'||key.startsWith('migration:')))continue;
        if(name!=='control'&&!legacy.appIds.includes(row.appId||row.event?.appId||String(key).split(':')[0])){conflict='foreign_app_records';continue;}
        const current=targets[name].get(key);
        if(current&&canonicalJson(current)!==canonicalJson(row)){
          // Matching credentials are retained with their newer destination metadata.
          if(name==='control'&&key==='registration'&&current.value.registrationId===row.value.registrationId&&current.value.credential===row.value.credential)continue;
          conflict='record_conflict';continue;
        }
        expected.push({name,key,row});
      }
      if(!conflict){
        for(const {name,key,row} of expected)if(!targets[name].has(key))tx.objectStore(name).put(row);
        if(!destinationScope)tx.objectStore('control').put({key:'deploymentScope',value:{endpoint,schoolId:options.schoolId}});
      }
      await txDone(tx);
    }finally{db.close();}
    if(conflict){await setControl('migrationBlocked',{database:legacy.name,reason:conflict});return false;}
    const verify=await openDb();
    try{
      const tx=verify.transaction(['control','outbox','seen_v2','deadletter'],'readonly');
      const actual=await Promise.all(expected.map(x=>requestValue(tx.objectStore(x.name).get(x.key))));await txDone(tx);
      if(actual.some((row,i)=>canonicalJson(row)!==canonicalJson(expected[i].row)))throw new Error('migration verification failed');
    }finally{verify.close();}
    await setControl(marker,{verified:true,database:legacy.name,at:new Date().toISOString(),records:expected.length});
  }
  await setControl('migrationBlocked',null);
  return true;
}

function canonicalize(v){return Array.isArray(v)?v.map(canonicalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonicalize(v[k])])):v}
async function sha256Hex(v){const d=await crypto.subtle.digest('SHA-256',te.encode(String(v)));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function randomToken(bytes=32){const a=new Uint8Array(bytes);crypto.getRandomValues(a);let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}
async function fetchWithTimeout(url,options={}){const c=new AbortController(),id=setTimeout(()=>c.abort(),timeoutMs);try{return await fetch(url,{...options,signal:c.signal})}finally{clearTimeout(id)}}
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(SYNC_DB,SYNC_DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('control'))db.createObjectStore('control',{keyPath:'key'});if(!db.objectStoreNames.contains('outbox'))db.createObjectStore('outbox',{keyPath:'eventId'});if(!db.objectStoreNames.contains('deadletter'))db.createObjectStore('deadletter',{keyPath:'eventId'});if(!db.objectStoreNames.contains('seen_v2'))db.createObjectStore('seen_v2',{keyPath:'sourceKey'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('progress sync database blocked'))})}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('transaction aborted'))})}
function requestValue(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function getControl(key){const db=await openDb();try{const tx=db.transaction('control','readonly'),row=await requestValue(tx.objectStore('control').get(key));await txDone(tx);return row?.value}finally{db.close()}}
async function setControl(key,value){const db=await openDb();try{const tx=db.transaction('control','readwrite'),store=tx.objectStore('control');value==null?store.delete(key):store.put({key,value});await txDone(tx)}finally{db.close()}}
function sourceKey(id){return `${APP_ID}:${id}`}
function deviceMetadata(){const ua=String(navigator.userAgent||'');return{deviceType:/iPad|Tablet/i.test(ua)?'tablet':/Mobi|Android|iPhone/i.test(ua)?'mobile':'desktop',osFamily:/iPhone|iPad|iOS/i.test(ua)?'iOS/iPadOS':/Android/i.test(ua)?'Android':/Windows/i.test(ua)?'Windows':/Mac OS|Macintosh/i.test(ua)?'macOS':/Linux/i.test(ua)?'Linux':'unknown',browserFamily:/Edg\//i.test(ua)?'Edge':/CriOS|Chrome\//i.test(ua)?'Chrome':/FxiOS|Firefox\//i.test(ua)?'Firefox':/Safari\//i.test(ua)?'Safari':'unknown'}}
async function getOrCreateRegistrationSeed(){const db=await openDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('control','readwrite'),store=tx.objectStore('control');let result={};const regReq=store.get('registration');regReq.onsuccess=()=>{const registration=regReq.result?.value;if(registration?.credential){result={registration};return}const pendingReq=store.get('pendingRegistration');pendingReq.onsuccess=()=>{let pending=pendingReq.result?.value;if(!pending?.registrationId||!pending?.credential){pending={registrationId:crypto.randomUUID(),credential:randomToken(),createdAt:new Date().toISOString()};store.put({key:'pendingRegistration',value:pending})}result={pending}};pendingReq.onerror=()=>{try{tx.abort()}catch{}reject(pendingReq.error)}};regReq.onerror=()=>{try{tx.abort()}catch{}reject(regReq.error)};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('registration transaction aborted'))})}finally{db.close()}}
async function ensureRegistration(){if(!apiBase()||await getControl('syncRevoked'))return null;if(!(await ensureScope()))return null;const seed=await getOrCreateRegistrationSeed();if(seed.registration?.credential)return seed.registration;const pending=seed.pending;if(!pending?.registrationId||!pending?.credential)return null;try{const r=await fetchWithTimeout(`${apiBase()}/v1/register-anonymous`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({registrationId:pending.registrationId,credentialHash:await sha256Hex(pending.credential),device:deviceMetadata()})}),d=await r.json().catch(()=>({}));if(!r.ok||d.ok!==true||d.registrationId!==pending.registrationId)return null;const reg={registrationId:pending.registrationId,credential:pending.credential,status:d.status||'unclassified',deviceCode:d.deviceCode||null,enrolledAt:new Date().toISOString()};await setControl('registration',reg);return reg}catch{return null}}
async function refreshControl(reg,force=false){if(!reg?.credential||!(await ensureScope()))return false;const now=Date.now();if(!force&&now-lastControlRefreshAt<CONTROL_REFRESH_INTERVAL_MS)return true;try{const r=await fetchWithTimeout(`${apiBase()}/v1/control`,{headers:{authorization:`Bearer ${reg.credential}`}}),d=await r.json().catch(()=>({}));if(r.status===401){await setControl('syncRevoked',true);lastControlRefreshAt=now;return false}if(!r.ok||d.ok!==true||d.registrationId!==reg.registrationId)return false;const next={...reg,status:d.status||reg.status,deviceCode:d.deviceCode||reg.deviceCode};Object.assign(reg,next);await setControl('collectionDisabled',d.collectionEnabled===false);await setControl('registration',next);lastControlRefreshAt=now;return true}catch{return false}}
async function queueRecord(record){assertSummary(record.payload,EVENT_FIELDS);const fingerprint=record.fingerprint||await sha256Hex(canonicalJson({eventType:record.eventType,payload:record.payload})),sourceHash=await sha256Hex(record.sourceRecordId),db=await openDb();try{const tx=db.transaction(['outbox','seen_v2'],'readwrite'),seen=tx.objectStore('seen_v2'),key=sourceKey(record.sourceRecordId),current=await requestValue(seen.get(key));if(current?.fingerprint===fingerprint){await txDone(tx);return false}const revision=Math.max(0,Number(current?.revision||0))+1,item={eventId:`${APP_ID}:${sourceHash}:r${revision}`,appId:APP_ID,sourceRecordId:record.sourceRecordId,revision,eventType:record.eventType,occurredAt:record.occurredAt,payload:record.payload,queuedAt:new Date().toISOString()};tx.objectStore('outbox').put(item);seen.put({sourceKey:key,appId:APP_ID,sourceRecordId:record.sourceRecordId,state:'queued',revision,fingerprint,at:new Date().toISOString()});await txDone(tx);return true}finally{db.close()}}
async function queueOccurrencesIfChanged(s,reg){if(!s||reg?.status!=='production')return;const signature=await sha256Hex(occurrenceSignature(s)),key=`${APP_ID}:occurrenceSignature:${reg.registrationId}`;if(await getControl(key)===signature)return;for(const record of buildOccurrenceRecords(s))await queueRecord(record);await setControl(key,signature)}
async function readOutbox(){const db=await openDb();try{const tx=db.transaction('outbox','readonly'),rows=await requestValue(tx.objectStore('outbox').getAll());await txDone(tx);return(rows||[]).filter(x=>x?.appId===APP_ID).sort((a,b)=>String(a.queuedAt).localeCompare(String(b.queuedAt))).slice(0,MAX_BATCH)}finally{db.close()}}
async function settleBatch(doneIds,rejected,batch){
  const byId=new Map(batch.map(x=>[String(x.eventId),x]));
  const done=new Set((doneIds||[]).map(String).filter(id=>byId.has(id)));
  const retryCodes=new Set(['event_rate_limited','unclassified_event_budget_limited','rate_limited','retry_later','temporarily_unavailable']);
  const rejectedRows=(rejected||[]).filter(x=>x?.eventId&&byId.has(String(x.eventId))&&!done.has(String(x.eventId))&&x.retryable!==true&&!retryCodes.has(x.code));
  if(!done.size&&!rejectedRows.length)return 0;
  const db=await openDb();try{
    const tx=db.transaction(['outbox','deadletter'],'readwrite'),outbox=tx.objectStore('outbox'),dead=tx.objectStore('deadletter');
    for(const id of done)outbox.delete(id);
    for(const row of rejectedRows){const id=String(row.eventId);dead.put({eventId:id,code:String(row.code||'rejected'),rejectedAt:new Date().toISOString(),event:byId.get(id)});outbox.delete(id)}
    await txDone(tx);return done.size+rejectedRows.length;
  }finally{db.close()}
}
async function flushBatch(reg){if(!(await ensureScope()))return-1;const batch=await readOutbox();if(!batch.length)return 0;try{for(const item of batch)assertSummary(item.payload,EVENT_FIELDS);const r=await fetchWithTimeout(`${apiBase()}/v1/events/batch`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${reg.credential}`},body:JSON.stringify({events:batch.map(({queuedAt,...e})=>e)})}),d=await r.json().catch(()=>({}));if(r.status===401){await setControl('syncRevoked',true);return-1}if(r.status===403&&d?.code==='collection_disabled'){await setControl('collectionDisabled',true);return-1}if(r.status===400&&d.code==='no_valid_events'&&Array.isArray(d.rejected)){await settleBatch([],d.rejected,batch);return batch.length}if(!r.ok||d.ok!==true||!['accepted','duplicate','rejected'].every(k=>d[k]===undefined||Array.isArray(d[k])))return-1;const settled=await settleBatch([...(d.accepted||[]),...(d.duplicate||[])],d.rejected||[],batch);return settled>0?settled:-1}catch{return-1}}
async function flushAvailable(reg,maxBatches=4){for(let i=0;i<maxBatches;i++){const n=await flushBatch(reg);if(n<=0)return n===0}return false}
let syncInFlight=null;
function syncOnce(forceControl=false){if(syncInFlight)return forceControl?syncInFlight.then(()=>syncOnce(true)):syncInFlight;syncInFlight=runSync(forceControl).finally(()=>{syncInFlight=null});return syncInFlight;}
async function runSync(forceControl=false){if(running||!apiBase()||navigator.onLine===false)return;running=true;try{const reg=await ensureRegistration();if(!reg?.credential)return;const controlOk=await refreshControl(reg,forceControl);if(!controlOk)return;if(await getControl('collectionDisabled'))return;const s=await loadState();await uploadBaseline(reg);if(await getControl('syncRevoked')||await getControl('collectionDisabled'))return;for(const record of buildStateRecords(s))await queueRecord(record);await queueOccurrencesIfChanged(s,reg);await flushAvailable(reg)}catch{/* Cloud sync is best-effort; studying remains local-first. */}finally{running=false}}
async function uploadBaseline(reg){const key=`${APP_ID}:baselineSent:${reg.registrationId}`;if(await getControl(key))return true;const s=await loadState();if(!s)return true;const payload=options.buildBaseline(s);assertSummary(payload,SNAPSHOT_FIELDS);try{const r=await fetchWithTimeout(`${apiBase()}/v1/progress/snapshot`,{method:'PUT',headers:{'content-type':'application/json',authorization:`Bearer ${reg.credential}`},body:JSON.stringify({appId:APP_ID,generation:1,payload})}),d=await r.json().catch(()=>({}));if(r.status===401){await setControl('syncRevoked',true);return false}if(r.status===403&&d?.code==='collection_disabled'){await setControl('collectionDisabled',true);return false}if(!r.ok||d.ok!==true)return false;await setControl(key,{at:new Date().toISOString()});return true}catch{return false}}

// Event-history adapters retain their baseline watermark/projection, while the
// shared transport owns all credential-bearing requests and acknowledgements.
async function uploadSnapshot(reg,payload){
  assertSummary(payload,SNAPSHOT_FIELDS);
  if(!reg?.credential||!(await ensureScope()))return false;
  try{
    const r=await fetchWithTimeout(`${apiBase()}/v1/progress/snapshot`,{method:'PUT',headers:{'content-type':'application/json',authorization:`Bearer ${reg.credential}`},body:JSON.stringify({appId:APP_ID,generation:1,payload})});
    const d=await r.json().catch(()=>({}));
    if(r.status===401)await setControl('syncRevoked',true);
    if(r.status===403&&d.code==='collection_disabled')await setControl('collectionDisabled',true);
    return r.ok&&d.ok===true;
  }catch{return false}
}
async function enroll(reg,token){
  if(!reg?.credential||!token||!(await ensureScope()))return {ok:false};
  try{
    const r=await fetchWithTimeout(`${apiBase()}/v1/enroll`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,registrationId:reg.registrationId,credentialHash:await sha256Hex(reg.credential),device:deviceMetadata()})});
    const d=await r.json().catch(()=>({}));
    return {...d,ok:r.ok&&d.ok===true&&d.registrationId===reg.registrationId,httpStatus:r.status};
  }catch{return {ok:false}}
}
function onOnline(){void syncOnce(true)}
function onVisible(){if(document.visibilityState==='visible')void syncOnce(false)}
function onPageHide(){void syncOnce(false)}
function start(){if(timer!==null)return;void syncOnce(true);timer=setInterval(()=>void syncOnce(false),RECONCILE_INTERVAL_MS);window.addEventListener('online',onOnline);document.addEventListener('visibilitychange',onVisible);window.addEventListener('pagehide',onPageHide)}
function stop(){if(timer!==null)clearInterval(timer);timer=null;window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('pagehide',onPageHide)}
return Object.freeze({sync:()=>syncOnce(true),start,stop,appId:APP_ID,dbName:SYNC_DB,status:async()=>({migrationBlocked:await getControl('migrationBlocked')}),history:Object.freeze({openDb,getControl,setControl,ensureScope,getOrCreateRegistrationSeed,ensureRegistration,refreshControl,queueRecord,uploadSnapshot,enroll,flushAvailable})});
}
root.SHARED_PROGRESS_TRANSPORT=Object.freeze({contractVersion:1,createTransport});
})(typeof globalThis!=='undefined'?globalThis:this);
