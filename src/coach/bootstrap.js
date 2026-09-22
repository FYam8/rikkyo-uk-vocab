import { openStudyDb } from '../storage';
import { ensureGeneration, exportEnvelope, verifyEnvelope, stableJson, listBackups, loadBackup } from '../rich/store';

const KEY='rikkyo-uk-vocab:coach-v4';
const STATE='rikkyo-uk-vocab:waseda-state', SESSION='rikkyo-uk-vocab:waseda-session';
const FORMAT='rikkyo-uk-vocab-export/v4';
const parse=s=>s?JSON.parse(s):null;
const clone=x=>JSON.parse(JSON.stringify(x));
const digest=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(x)))),b=>b.toString(16).padStart(2,'0')).join('');
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}

async function boot(){
  const db=await openStudyDb();
  async function getMeta(key){const tx=db.transaction('meta','readonly');return request(tx.objectStore('meta').get(key))}
  async function putMeta(key,value){const tx=db.transaction('meta','readwrite');const end=done(tx);tx.objectStore('meta').put({key,value});await end}
  let bundle=parse(localStorage.getItem(KEY));
  if(bundle && (bundle.format!==FORMAT || !bundle.records))throw new Error('保存データの形式を確認できません。既存のデータは保持しています。');
  if(bundle){
    const saved=parse(bundle.records[STATE]);
    if(!saved||saved.schemaVersion!==7||!saved.words||!saved.settings||!saved.stats)throw new Error('保存された学習履歴を検証できません。データを保持して読み込みを中止しました。');
  }
  let archives=(await getMeta('coach-v4-archives'))?.value??[];
  let legacy=null;
  if(!bundle){
    const generation=await getMeta('generation');
    const oldMemory=await request(db.transaction('memory','readonly').objectStore('memory').count());
    if(generation||oldMemory){
      await ensureGeneration(db,'0.24.0-lexical',912,241);
      const {checksum:oldChecksum,...body}=clone(await exportEnvelope(db,'0.24.0-lexical'));
      // IndexedDB preserves Date objects, JSON exports do not. Archive the
      // portable representation and hash exactly the bytes' logical content.
      legacy={...body,checksum:await digest(body)};
      if(!archives.some(x=>x.checksum===legacy.checksum)){
        archives.push(legacy);await putMeta('coach-v4-archives',archives);
      }
    }
    bundle={format:FORMAT,revision:0,records:{},createdAt:new Date().toISOString()};
  }
  function commit(next){
    const disk=parse(localStorage.getItem(KEY));
    if(disk && disk.revision!==bundle.revision){location.reload();throw new Error('別タブの学習履歴を読み直します。')}
    const updated={...next,revision:bundle.revision+1,updatedAt:new Date().toISOString()};
    localStorage.setItem(KEY,JSON.stringify(updated));bundle=updated;
  }
  async function archive(envelope){
    if(!archives.some(x=>x.checksum===envelope.checksum)){const next=[...archives,envelope];await putMeta('coach-v4-archives',next);archives=next;}
  }
  async function payload(){
    const body={appId:'rikkyo-uk-vocab',exportFormat:FORMAT,exportFormatVersion:4,productVersion:'4.0.0',
      engineVersion:'waseda-vocabulary/7.6',engineCommit:'6f4788386a1935d6e2703c694257c1f327b0f831',datasetVersion:'0.24.0-lexical',
      exportedAt:new Date().toISOString(),state:parse(bundle.records[STATE]),activeSession:parse(bundle.records[SESSION]),legacyArchives:clone(archives)};
    return {...body,checksum:await digest(body)};
  }
  const host={
    legacy,
    get:key=>bundle.records[key]??null,
    set(key,value){if(![STATE,SESSION].includes(key))throw new Error('Unexpected storage namespace');commit({...bundle,records:{...bundle.records,[key]:value}})},
    remove(key){const records={...bundle.records};delete records[key];commit({...bundle,records})},
    initialize(state,session){commit({...bundle,records:{[STATE]:JSON.stringify(state),...(session?{[SESSION]:JSON.stringify(session)}:{})}})},
    async export(){
      const data=await payload(),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='rikkyo-vocabulary-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    },
    async import(raw){
      raw=clone(raw);
      if(!raw||typeof raw!=='object')throw new Error('バックアップ形式を確認できません');
      let incoming,active;
      if(raw.exportFormat==='rikkyo-uk-vocab-export/v3'){
        const old=await verifyEnvelope(raw);await archive(raw);
        ({state:incoming,session:active}=window.RikkyoConvertLegacy(old));
      }else{
        if(raw.appId!=='rikkyo-uk-vocab'||raw.exportFormat!==FORMAT||raw.engineVersion!=='waseda-vocabulary/7.6'||raw.datasetVersion!=='0.24.0-lexical')throw new Error('別アプリまたは未対応のバックアップです');
        const {checksum,...body}=raw;if(await digest(body)!==checksum)throw new Error('バックアップの検証に失敗しました');
        incoming=raw.state;active=raw.activeSession;
        if(!incoming||incoming.schemaVersion!==7||!incoming.words)throw new Error('学習履歴の形式が不正です');
        for(const key of Object.keys(incoming.words))if(['__proto__','constructor','prototype'].includes(key))throw new Error('Invalid word key');
        for(const old of raw.legacyArchives??[]){await verifyEnvelope(old);await archive(old)}
      }
      window.RikkyoMergeBackup(incoming,active);
    },
    async saveBackup(){
      const existing=(await getMeta('coach-v4-backups'))?.value??[];
      const id=crypto.randomUUID();await putMeta('coach-v4-backups',[...existing,{id,payload:await payload()}]);return id;
    },
    async backups(){
      const current=(await getMeta('coach-v4-backups'))?.value??[];
      const old=await listBackups();
      return [...current.map(b=>({id:b.id,label:b.payload.exportedAt,kind:'v4'})),...old.map(b=>({id:b.snapshotId,label:b.createdAt,kind:'v3'}))];
    },
    async restore(id,kind){
      if(kind==='v3')return host.import(await loadBackup(id));
      const list=(await getMeta('coach-v4-backups'))?.value??[];
      const backup=list.find(b=>b.id===id);if(!backup)throw new Error('バックアップが見つかりません');return host.import(backup.payload);
    },
  };
  window.RikkyoHost=host;
  window.addEventListener('storage',event=>{if(event.key===KEY)location.reload()});
  const script=document.createElement('script');script.src=import.meta.env.BASE_URL+'assets/coach-runtime.js';
  await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(new Error('アプリを読み込めませんでした'));document.body.append(script)});
  if('serviceWorker' in navigator && import.meta.env.PROD)navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js').catch(console.error);
}
boot().catch(error=>{
  console.error(error);
  const main=document.querySelector('main');main.replaceChildren();
  const card=document.createElement('section');card.className='card';
  const title=document.createElement('h2');title.textContent='学習データを確認しています';
  const text=document.createElement('p');text.textContent='既存の履歴を保持しています。'+error.message;
  const button=document.createElement('button');button.className='primary';button.textContent='再読み込み';button.onclick=()=>location.reload();card.append(title,text,button);main.append(card);
});
