import './shared-progress-transport.js';
import { buildStateRecords, buildOccurrenceRecords, buildBaseline } from './projection.js';
export function init(){
 if(window.__RIKKYO_VOCAB_PROGRESS__||!window.SHARED_PROGRESS_TRANSPORT)return;
 if(location.origin!=='https://fyam8.github.io'&&!Object.hasOwn(window,'__RIKKYO_UK_VOCAB_PROGRESS_API__'))return;
 function loadState(){try{const bundle=JSON.parse(localStorage.getItem('rikkyo-uk-vocab:coach-v4')||'null');return bundle?.format==='rikkyo-uk-vocab-export/v4'?JSON.parse(bundle.records?.['rikkyo-uk-vocab:waseda-state']||'null'):null}catch{return null}}
 const transport=window.SHARED_PROGRESS_TRANSPORT.createTransport({schoolId:'rikkyo-uk',appId:'rikkyo-uk-vocab',dbName:'rikkyo-uk-progress-sync',dbVersion:7,endpoint:()=>window.__RIKKYO_UK_VOCAB_PROGRESS_API__||'https://rikkyo-uk-progress-api.fyam8.workers.dev',legacyDatabases:[{name:'rikkyo-uk-kokugo-progress-sync',schoolId:'rikkyo-uk',appIds:['rikkyo-uk-kokugo']}],loadState,buildStateRecords,buildOccurrenceRecords,buildBaseline,occurrenceSignature:s=>JSON.stringify(buildOccurrenceRecords(s))});
 async function report(){const s=await transport.status();let el=document.getElementById('cloud-migration-notice');if(s.migrationBlocked){if(!el){el=document.createElement('aside');el.id='cloud-migration-notice';el.setAttribute('role','status');el.className='card';document.body.prepend(el);}el.textContent='Cloud同期を保留しています。以前の登録の接続先、または共有先の登録との競合を確認してください。既存の登録と学習履歴は保持しており、学習は続けられます。';}else el?.remove();return s;}
 window.__RIKKYO_VOCAB_PROGRESS__={sync:async()=>{await transport.sync();return report()},status:transport.status};transport.start();setTimeout(()=>void report().catch(()=>{}),2000);window.addEventListener('online',()=>void report().catch(()=>{}));
}
