const WASEDA_APP_CONFIG=Object.freeze({
  schemaVersion:7,
  storageKey:"waseshibu_vocab_state",
  activeSessionKey:"waseshibu_vocab_active_session_v1",
  activeSessionFormatVersion:1
});
const SCHEMA_VERSION=WASEDA_APP_CONFIG.schemaVersion;
const STORAGE_KEY=WASEDA_APP_CONFIG.storageKey;
function wasedaStorageGet(key){return localStorage.getItem(key)}
function wasedaStorageSet(key,value){localStorage.setItem(key,value)}
function wasedaStorageRemove(key){localStorage.removeItem(key)}

function wasedaMigrateState(raw){
 let s=raw && typeof raw==="object"?raw:{};
 let v=Number(s.schemaVersion||1);
 if(v===1){
   if(!s.words && s.progress) s.words=s.progress;
   if(!s.stats) s.stats={};
   if(!s.settings) s.settings={};
   s.schemaVersion=2;v=2;
 }
 if(v===2){
   s.stats=s.stats||{};
   if(s.stats.totalAnswers==null && s.stats.total!=null) s.stats.totalAnswers=s.stats.total;
   s.settings=s.settings||{};
   s.schemaVersion=3;v=3;
 }
 if(v===3){
   // v4: 自己申告式を廃止。旧習熟度は開始時の参考値としてのみ引き継ぐ。
   // 「苦手」は今後の客観的な正誤履歴だけで判定する。
   const evidenceByMastery=[0,1,3,5,8,11];
   s.words=s.words&&typeof s.words==="object"?s.words:{};
   for(const id of Object.keys(s.words)){
     const p=s.words[id]||{};
     if(p.evidence==null)p.evidence=evidenceByMastery[Math.max(0,Math.min(5,Number(p.mastery)||0))];
     if(!Array.isArray(p.recentResults))p.recentResults=[];
   }
   s.schemaVersion=4;v=4;
 }
 if(v===4){
   // v5: 「確認中」を削除し、習熟度を5段階へ統合。
   // 旧 0未学習 / 1確認中 / 2学習中 / 3安定 / 4覚えた / 5定着
   // 新 0未学習 / 1学習中 / 2安定 / 3覚えた / 4定着
   const masteryMap=[0,1,1,2,3,4];
   s.words=s.words&&typeof s.words==="object"?s.words:{};
   for(const id of Object.keys(s.words)){
     const p=s.words[id]||{};
     const oldM=Math.max(0,Math.min(5,Number(p.mastery)||0));
     p.mastery=masteryMap[oldM];
   }
   s.schemaVersion=5;v=5;
 }
 if(v===5){
   // v6: 語彙データを4層化。学習履歴はID単位のためそのまま保持する。
   // 新規の基礎診断語・挑戦語は未学習から開始し、既存IDは一切振り直さない。
   s.schemaVersion=6;v=6;
 }
 if(v===6){
   // v7: 証拠属性を分離。既存IDは維持する。
   // sometime は同じIDのまま sometimes に名称修正。
   // 単独 according の履歴は according to の既存IDへ統合する。
   s.words=s.words&&typeof s.words==="object"?s.words:{};
   const oldId="w3186341920",newId="p0431020501";
   if(s.words[oldId]){
     const a=s.words[oldId]||{},b=s.words[newId]||{};
     const at=a.lastStudied?new Date(a.lastStudied).getTime():0;
     const bt=b.lastStudied?new Date(b.lastStudied).getTime():0;
     const newer=at>=bt?a:b;
     s.words[newId]=Object.assign({},a,b,newer,{
       correct:Math.max(Number(a.correct)||0,Number(b.correct)||0),
       incorrect:Math.max(Number(a.incorrect)||0,Number(b.incorrect)||0),
       mastery:Math.max(Number(a.mastery)||0,Number(b.mastery)||0),
       evidence:Math.max(Number(a.evidence)||0,Number(b.evidence)||0)
     });
     delete s.words[oldId];
   }
   s.dataVersion=META.dataVersion;
   s.schemaVersion=7;v=7;
 }
 if(v>SCHEMA_VERSION){console.warn("Newer schema detected:",v)}
 const d=defaultState();
 s.words=s.words&&typeof s.words==="object"?s.words:{};
 s.stats=Object.assign({},d.stats,s.stats||{});
 s.settings=Object.assign({},d.settings,s.settings||{});
 s.schemaVersion=Math.max(v,SCHEMA_VERSION);
 s.dataVersion=s.dataVersion||META.dataVersion;
 for(const id of Object.keys(s.words)){
   const p=s.words[id]||{};
   s.words[id]=Object.assign(defaultProgress(),p);
   s.words[id].mastery=Math.max(0,Math.min(4,Number(s.words[id].mastery)||0));
   s.words[id].evidence=Math.max(-4,Math.min(12,Number(s.words[id].evidence)||0));
   if(!Array.isArray(s.words[id].recentResults))s.words[id].recentResults=[];
   s.words[id].recentResults=s.words[id].recentResults.slice(-8);
 }
 return s;
}
