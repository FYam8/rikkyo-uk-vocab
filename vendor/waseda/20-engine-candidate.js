const MASTER_LABEL=["未学習","学習中","安定","覚えた","定着"];
const MODE_OPTIONS=[
 ["recommended","おすすめ"],["60","60点突破"],["70","70点安定"],["diagnostic","基礎診断"],["75","75点挑戦"],
 ["unlearned","未学習"],["weak","苦手"],["review","復習"],["frequent","年度横断・頻出"],["random","ランダム"]
];
const LAYER_LABEL={core:"通常学習",diagnostic:"基礎診断",challenge:"75点挑戦",reference:"参照のみ"};
const LAYER_SCORE={core:70,diagnostic:55,challenge:10,reference:0};
const PRIORITY_SCORE={S:90,A:48,B:24,C:8};
const LEVEL_SCORE={60:50,70:24,75:8};
const CATEGORY_JP={listening:"Listening",language:"語彙・文法",writing:"英作文・要約",reading:"Reading",question:"設問・選択肢"};
const SAFE_CONFUSIONS=[
 ["increase","decrease","reduce","improve"],["remember","forget","realize","notice"],
 ["decide","suggest","allow","prevent"],["receive","offer","carry","return"],
 ["cause","result","reason","purpose"],["likely","possible","impossible","necessary"],
 ["healthy","harmful","serious","active"],["finally","suddenly","eventually","recently"],
 ["accept","avoid","consider","prefer"],["worry","concern","surprise","disappoint"],
 ["communicate","explain","mention","reply"],["environment","climate","atmosphere","condition"],
 ["support","protect","prevent","harm"]
];
const VOCAB_BY_ID=new Map(VOCAB.map(v=>[v.id,v]));
const VOCAB_BY_WORD=new Map(VOCAB.map(v=>[v.word,v]));
function effectiveFrequency(v){return Number.isFinite(Number(v&&v.surfaceFrequency))?Number(v.surfaceFrequency):Number(v&&v.frequency)||0}
function yearsText(xs){return Array.isArray(xs)&&xs.length?xs.join(", "):"—"}
function evidenceBadge(v){return v&&v.auditStatus&&v.auditStatus!=="provisional"?"精査済み":"暫定"}

let state=loadState();
let currentView="learn";
let session=null;
let currentQuestion=null;
let questionResolved=false;
let voices=[];
let toastTimer=null;

function $(id){return document.getElementById(id)}
function now(){return Date.now()}
function localDayKey(d=new Date()){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function defaultProgress(){return {mastery:0,correct:0,incorrect:0,streak:0,lastStudied:null,nextReview:null,recentMistakeUntil:null,lastRating:null,evidence:0,recentResults:[]}}
function defaultState(){return {
 schemaVersion:SCHEMA_VERSION,dataVersion:META.dataVersion,words:{},
 stats:{todayKey:localDayKey(),todayCount:0,totalAnswers:0,totalSessions:0},
 settings:{mode:"recommended",sessionSize:20,year:"all",accent:"auto",voiceURI:"",theme:"auto"}
}}
function migrate(raw){return wasedaMigrateState(raw)}
function loadState(){
 try{
   const raw=wasedaStorageGet(STORAGE_KEY);
   return raw?migrate(JSON.parse(raw)):defaultState();
 }catch(e){
   console.warn("Storage load failed",e);
   return defaultState();
 }
}
function saveState(){
 state.dataVersion=META.dataVersion;
 try{wasedaStorageSet(STORAGE_KEY,JSON.stringify(state))}
 catch(e){showToast("学習履歴を保存できませんでした")}
}
function getProgress(id){
 if(!state.words[id]) state.words[id]=defaultProgress();
 return state.words[id];
}
function attemptCount(p){return (Number(p.correct)||0)+(Number(p.incorrect)||0)}
function resultWeight(type){return ["reverse","audio","cloze"].includes(type)?2:1}
function masteryFromEvidence(p){
 if(attemptCount(p)===0)return 0;
 const e=Number(p.evidence)||0;
 if(e<5)return 1;   // 学習中：正解経験はあるが、まだ再現性を確認中
 if(e<8)return 2;   // 安定：複数形式で正解が積み上がった
 if(e<11)return 3;  // 覚えた：入力・穴埋め等を含めてかなり安定
 const rr=Array.isArray(p.recentResults)?p.recentResults:[];
 const last3=rr.slice(-3);
 // 旧版で定着済みだった語は維持。新規語は直近3回連続正解も確認する。
 return (p.mastery===4||(p.correct>=5&&last3.length===3&&last3.every(r=>r.ok)))?4:3;
}
function isWeakProgress(p){
 const rr=Array.isArray(p.recentResults)?p.recentResults:[];
 if(!rr.length||rr[rr.length-1].ok)return false; // 直近正解なら苦手表示は解除
 if(rr.length>=2&&rr.slice(-2).every(r=>!r.ok))return true;
 if(rr.length>=4&&rr.slice(-4).filter(r=>!r.ok).length>=2)return true;
 return false;
}
function recordObjectiveResult(p,ok,type){
 const w=resultWeight(type);
 p.evidence=Math.max(-4,Math.min(12,(Number(p.evidence)||0)+(ok?w:-w)));
 if(!Array.isArray(p.recentResults))p.recentResults=[];
 p.recentResults.push({ok:!!ok,type:type||"choice",at:new Date().toISOString()});
 p.recentResults=p.recentResults.slice(-8);
 p.mastery=masteryFromEvidence(p);
}
function syncToday(){
 const k=localDayKey();
 if(state.stats.todayKey!==k){state.stats.todayKey=k;state.stats.todayCount=0}
}
function showToast(msg){
 const t=$("toast");t.textContent=msg;t.classList.add("show");
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),1800);
}
function badgeHTML(v){
 const layer=v.studyLayer||"core";
 return `<span class="badge ${v.priority.toLowerCase()}">${v.priority}</span><span class="badge level${v.level}">${v.level}点</span><span class="badge layer-${layer}">${LAYER_LABEL[layer]||layer}</span>`;
}
function masteryDots(m){
 let s='<span class="mastery-dots" aria-label="習熟度 '+m+'">';
 for(let i=1;i<=4;i++)s+=`<i class="${i<=m?'on':''}"></i>`;
 return s+"</span>";
}
function setTheme(t){
 state.settings.theme=t;
 if(t==="auto")document.documentElement.removeAttribute("data-theme");
 else document.documentElement.setAttribute("data-theme",t);
}
function initSelectors(){
 const ms=$("modeSelect");
 MODE_OPTIONS.forEach(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;ms.appendChild(o)});
 ms.value=state.settings.mode||"recommended";
 const yearSelects=[$("learnYearSelect"),$("listYear")];
 yearSelects.forEach(sel=>{
   sel.innerHTML="";
   const a=document.createElement("option");a.value="all";a.textContent=sel.id==="listYear"?"年度：すべて":"すべての年度";sel.appendChild(a);
   META.years.forEach(y=>{const o=document.createElement("option");o.value=String(y);o.textContent=(sel.id==="listYear"?"年度：":"")+y;sel.appendChild(o)});
 });
 $("learnYearSelect").value=state.settings.year||"all";
 $("sessionSizeSelect").value=String(state.settings.sessionSize??20);
 $("themeSelect").value=state.settings.theme||"auto";
 $("accentSelect").value=state.settings.accent||"auto";
}
function modeLabel(v){return (MODE_OPTIONS.find(x=>x[0]===v)||["",v])[1]}
function setView(name){
 currentView=name;
 document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
 document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
 const titles={learn:session&&session.active?"学習中":"おすすめ学習",list:"単語一覧",stats:"学習統計",analysis:"過去問分析",settings:"設定"};
 $("headerTitle").textContent=titles[name]||"早稲渋 Vocabulary Coach";
 if(name==="list")renderList();
 if(name==="stats")renderStats();
 if(name==="analysis")renderAnalysis();
 if(name==="settings")renderSettings();
 if(name==="learn")renderLearnHome();
 window.scrollTo({top:0,behavior:"instant"});
}
function filterPool(mode,year){
 const t=now();
 return VOCAB.filter(v=>{
   const layer=v.studyLayer||"core";
   if(layer==="reference")return false;
   if(year!=="all"&&!v.years.includes(Number(year)))return false;
   const p=getProgress(v.id);
   const diagPassed=layer==="diagnostic"&&((p.correct>=1&&p.incorrect===0&&!isWeakProgress(p))||p.mastery>=3);
   if(mode==="recommended"){
     if(layer==="challenge")return false;
     if(layer==="diagnostic"&&diagPassed)return false;
     return true;
   }
   if(mode==="60")return layer!=="challenge"&&v.level===60&&!(layer==="diagnostic"&&diagPassed);
   if(mode==="70")return layer!=="challenge"&&(v.level===60||v.level===70)&&!(layer==="diagnostic"&&diagPassed);
   if(mode==="diagnostic")return layer==="diagnostic"&&!diagPassed;
   if(mode==="75")return layer==="core"||layer==="diagnostic"||layer==="challenge";
   if(mode==="unlearned")return attemptCount(p)===0;
   if(mode==="weak")return isWeakProgress(p);
   if(mode==="review")return !!p.nextReview&&new Date(p.nextReview).getTime()<=t;
   if(mode==="frequent")return (v.yearCount>=3||effectiveFrequency(v)>=10)&&layer!=="challenge";
   if(mode==="random")return true;
   return layer!=="challenge";
 });
}
function schedulerScore(v,mode){
 const p=getProgress(v.id),t=now(),layer=v.studyLayer||"core";
 if(mode==="random")return 1;
 let score=PRIORITY_SCORE[v.priority]+LEVEL_SCORE[v.level]+LAYER_SCORE[layer]+v.yearCount*8+Math.sqrt(effectiveFrequency(v))*4;
 const masteryWeight=[80,110,65,25,4][p.mastery];
 score+=masteryWeight;
 const due=p.nextReview&&new Date(p.nextReview).getTime()<=t;
 if(due)score+=115;
 if(p.recentMistakeUntil&&new Date(p.recentMistakeUntil).getTime()>t)score+=80;
 if(isWeakProgress(p))score+=95;
 if(v.priority==="S"&&p.mastery<3)score+=70;
 if(v.level===60&&p.mastery<3)score+=55;
 if(v.directVocab&&p.mastery<3)score+=90;
 if(layer==="diagnostic"&&attemptCount(p)===0)score+=75;
 if(layer==="diagnostic"&&p.mastery>=2&&p.correct>=1&&!due)score*=0.08;
 if(mode==="60"&&v.level===60)score+=40;
 if(mode==="70"&&v.level<=70)score+=25;
 if(mode==="diagnostic")score+=80;
 if(mode==="frequent")score+=v.yearCount*10;
 if(p.mastery===4&&!due)score*=0.10;
 return Math.max(.1,score);
}
function weightedChoice(items,weights){
 let total=weights.reduce((a,b)=>a+b,0),r=Math.random()*total;
 for(let i=0;i<items.length;i++){r-=weights[i];if(r<=0)return items[i]}
 return items[items.length-1];
}
function v76Clamp(x,lo,hi){return Math.max(lo,Math.min(hi,Number(x)))}
function v76SeedStability(mastery){const i=Math.max(0,Math.min(4,Math.round(Number(mastery)||0)));return [0.75,1.5,4,14,30][i]}
function v76IntervalForTarget(stabilityDays,targetRetention){
  const s=Math.max(.05,Number(stabilityDays)||.05);
  const t=v76Clamp(targetRetention,.80,.97);
  return s*Math.log(t)/Math.log(.9);
}
function v76LapseStability(model,retrievability){
  const s=Math.max(.25,Number(model.stabilityDays)||.75);
  return Math.max(.5,s*(.35+.15*v76Clamp(retrievability,0,1)));
}
function v75WeightedWithoutReplacement(pool,count,scoreFn){
  const remaining=[...pool],out=[];
  while(remaining.length&&out.length<count){
    const weights=remaining.map(v=>Math.max(.1,scoreFn(v))*(.92+Math.random()*.16));
    const picked=weightedChoice(remaining,weights);
    out.push(picked);
    remaining.splice(remaining.findIndex(v=>v.id===picked.id),1);
  }
  return out;
}
function chooseNext(){
 const mode=session.mode,year=session.year;
 let pool=filterPool(mode,year);
 if(!pool.length)return null;

 // 1セッション内で「間違い→即また同じ語」を繰り返さない。
 // 一度再確認してまだ間違えた語は、そのセッション中は原則休ませる。
 let available=pool.filter(v=>!session.blockedIds.has(v.id));
 if(!available.length)available=pool;

 const recent=new Set(session.recentIds.slice(-6));
 const dueForced=available.filter(v=>session.missDue[v.id]!=null&&session.missDue[v.id]<=session.answered);

 // 再確認待ちの語は、指定した間隔が来るまでは通常抽選から外す。
 let candidates;
 if(dueForced.length){
   candidates=dueForced;
 }else{
   candidates=available.filter(v=>session.missDue[v.id]==null);
   if(!candidates.length)candidates=available;
 }

 let weights=candidates.map(v=>{
   let s=schedulerScore(v,mode);
   if(!dueForced.length&&recent.has(v.id)&&candidates.length>6)s*=0.02;
   if(session.missDue[v.id]!=null&&session.missDue[v.id]<=session.answered)s+=900;
   return s*(.88+Math.random()*.24);
 });
 return weightedChoice(candidates,weights);
}
function chooseType(v,isRetry=false){
 const p=getProgress(v.id),m=p.mastery;
 const hasCloze=!!CLOZE[v.word];

 // 基礎診断は最初の1問だけ客観4択。正解なら通常反復からほぼ卒業。
 if((v.studyLayer||"core")==="diagnostic"&&attemptCount(p)===0)return "choice";
 // 再確認は連続入力を避け、まず客観判定できる4択に戻す。
 if(isRetry)return m<=1?"choice":"reverseChoice";

 const r=Math.random();
 if(m===0)return "choice";
 if(m===1){
   if(r<.45)return "choice";
   if(r<.85)return "reverseChoice";
   return "reverse";
 }
 if(m===2){
   if(r<.20)return "reverseChoice";
   if(r<.58)return "reverse";
   if(r<.78&&hasCloze)return "cloze";
   return "audioChoice";
 }
 if(m===3){
   if(r<.15)return "reverseChoice";
   if(r<.48)return "reverse";
   if(r<.72&&hasCloze)return "cloze";
   if(r<.90)return "audioChoice";
   return "audio";
 }
 if(r<.34)return "reverse";
 if(r<.64&&hasCloze)return "cloze";
 if(r<.84)return "audioChoice";
 return "audio";
}
function primaryPos(pos){
 if(pos.includes("phrase"))return "phrase";
 if(pos.includes("v."))return "v";
 if(pos.includes("n."))return "n";
 if(pos.includes("adj."))return "adj";
 if(pos.includes("adv."))return "adv";
 return pos;
}
function meaningKey(s){return s.toLowerCase().replace(/[\s、，。・／\/；;（）()〜~]/g,"")}
function glossParts(s){
 return String(s||"").toLowerCase()
   .replace(/[（）()]/g,"、")
   .split(/[、，,／\/・；;]/)
   .map(x=>x.replace(/\s+/g,"").replace(/[〜~]/g,"").replace(/(する|した|している|である|こと|もの)$/g,""))
   .filter(x=>x.length>=2);
}
function charBigrams(s){
 const x=String(s||"").replace(/\s+/g,"");
 const out=new Set();
 for(let i=0;i<x.length-1;i++)out.add(x.slice(i,i+2));
 return out;
}
function bigramJaccard(a,b){
 const A=charBigrams(a),B=charBigrams(b);
 if(!A.size||!B.size)return 0;
 let inter=0;for(const x of A)if(B.has(x))inter++;
 return inter/(A.size+B.size-inter);
}
function meaningsTooSimilar(a,b){
 const ak=meaningKey(a),bk=meaningKey(b);
 if(!ak||!bk)return false;
 if(ak===bk)return true;
 const A=glossParts(a),B=glossParts(b);
 for(const x of A)for(const y of B){
   if(x===y)return true;
   if(x.length>=3&&y.length>=3&&(x.includes(y)||y.includes(x)))return true;
 }
 return bigramJaccard(ak,bk)>=0.58;
}
function getDistractors(target){
 const chosen=[],used=new Set([target.id]);
 const add=v=>{
   if(!v||used.has(v.id))return;
   if(meaningsTooSimilar(v.meaning,target.meaning))return;
   if(chosen.some(x=>meaningsTooSimilar(v.meaning,x.meaning)))return;
   used.add(v.id);chosen.push(v);
 };
 // 似た意味の選択肢は、正答との区別が曖昧になるため候補から除外する。
 let pool=VOCAB.filter(v=>v.sourceType===target.sourceType&&(v.studyLayer||"core")!=="reference"&&primaryPos(v.pos)===primaryPos(target.pos)&&v.id!==target.id);
 pool.sort((a,b)=>{
   const da=Math.abs(a.level-target.level)+(a.priority===target.priority?0:1)+(a.yearCount===target.yearCount?0:.3);
   const db=Math.abs(b.level-target.level)+(b.priority===target.priority?0:1)+(b.yearCount===target.yearCount?0:.3);
   return da-db+(Math.random()-.5)*.8;
 });
 for(const v of pool){add(v);if(chosen.length>=3)break}
 if(chosen.length<3){
   const fallback=VOCAB.filter(v=>v.sourceType===target.sourceType&&(v.studyLayer||"core")!=="reference"&&v.id!==target.id).sort(()=>Math.random()-.5);
   for(const v of fallback){add(v);if(chosen.length>=3)break}
 }
 return chosen.slice(0,3);
}
function shuffle(a){
 const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x;
}
function renderQuestion(){
 const v=chooseNext();
 if(!v){showToast("この条件に該当する語がありません");endSession(true);return}

 const isRetry=session.missDue[v.id]!=null&&session.missDue[v.id]<=session.answered;
 if(isRetry){
   session.retryCounts[v.id]=(session.retryCounts[v.id]||0)+1;
   delete session.missDue[v.id];
 }

 currentQuestion={v,type:chooseType(v,isRetry),isRetry};
 questionResolved=false;
 session.asked++;
 session.recentIds.push(v.id);
 if(session.recentIds.length>14)session.recentIds.shift();
 $("sessionCount").textContent=session.target===Infinity?`${session.answered}問回答`:`${Math.min(session.answered+1,session.target)}/${session.target}`;
 $("sessionScore").textContent=`正解 ${session.correct} / 不正解 ${session.wrong}`;
 $("qBadges").innerHTML=badgeHTML(v);
 $("feedback").className="feedback";$("feedback").innerHTML="";
 $("nextArea").innerHTML="";
 const p=getProgress(v.id);
 const type=currentQuestion.type;
 const labels={choice:"選択式・英→日",reverseChoice:"選択式・日→英",reverse:"日→英・入力",audioChoice:"音声→意味選択",audio:"音声→英語",cloze:"穴埋め"};
 $("qTypeLabel").textContent=`${labels[type]}${isRetry?"・再確認":""} ・ ${MASTER_LABEL[p.mastery]}`;
 if(type==="choice")renderChoice(v);
 else if(type==="reverseChoice")renderReverseChoice(v);
 else if(type==="audioChoice")renderAudioChoice(v);
 else if(type==="reverse")renderReverse(v);
 else if(type==="audio")renderAudio(v);
 else renderCloze(v);
}
function renderChoice(v){
 $("promptArea").innerHTML=`<div class="word">${esc(v.word)}</div><button class="icon-btn" style="margin-top:12px" onclick="speakWord('${v.id}')">🔊</button><div class="small muted" style="margin-top:8px">最も適切な意味を選ぶ</div>`;
 const choices=shuffle([v,...getDistractors(v)]);
 $("responseArea").innerHTML='<div class="answer-grid">'+choices.map(x=>`<button class="answer-btn" data-choice="${x.id}">${esc(x.meaning)}</button>`).join("")+"</div>";
 document.querySelectorAll("[data-choice]").forEach(b=>b.addEventListener("click",()=>resolveChoice(b.dataset.choice)));
}
function renderReverseChoice(v){
 $("promptArea").innerHTML=`<div class="meaning-big">${esc(v.meaning)}</div><div class="small muted" style="margin-top:9px">対応する英語を選ぶ</div>`;
 const choices=shuffle([v,...getDistractors(v)]);
 $("responseArea").innerHTML='<div class="answer-grid">'+choices.map(x=>`<button class="answer-btn" data-choice="${x.id}">${esc(x.word)}</button>`).join("")+"</div>";
 document.querySelectorAll("[data-choice]").forEach(b=>b.addEventListener("click",()=>resolveChoice(b.dataset.choice)));
}
function renderAudioChoice(v){
 $("promptArea").innerHTML=`<button class="audio-orb" onclick="speakWord('${v.id}')">🔊</button><div class="small muted">音声を聞いて意味を選ぶ</div>`;
 const choices=shuffle([v,...getDistractors(v)]);
 $("responseArea").innerHTML='<div class="answer-grid">'+choices.map(x=>`<button class="answer-btn" data-choice="${x.id}">${esc(x.meaning)}</button>`).join("")+"</div>";
 document.querySelectorAll("[data-choice]").forEach(b=>b.addEventListener("click",()=>resolveChoice(b.dataset.choice)));
 setTimeout(()=>speakWord(v.id),250);
}
function resolveChoice(id){
 if(questionResolved)return;
 const target=currentQuestion.v,ok=id===target.id;
 document.querySelectorAll("[data-choice]").forEach(b=>{
   b.disabled=true;
   if(b.dataset.choice===target.id)b.classList.add("correct");
   else if(b.dataset.choice===id)b.classList.add("wrong");
 });
 applyOutcome(target,ok?"got":"miss");
 showFeedback(target,ok);
}
function renderReverse(v){
 $("promptArea").innerHTML=`<div class="meaning-big">${esc(v.meaning)}</div><div class="small muted" style="margin-top:10px">見出し語を英語で入力</div>`;
 renderTypeBox(v);
}
function renderAudio(v){
 $("promptArea").innerHTML=`<button class="audio-orb" onclick="speakWord('${v.id}')">🔊</button><div class="small muted">音声を聞いて英語で入力</div>`;
 renderTypeBox(v);
 setTimeout(()=>speakWord(v.id),250);
}
function renderCloze(v){
 $("promptArea").innerHTML=`<div class="cloze">${esc(CLOZE[v.word]||"_____")}</div><div class="small muted" style="margin-top:10px">空所に入る見出し語を入力</div>`;
 renderTypeBox(v);
}
function renderTypeBox(v){
 $("responseArea").innerHTML=`<div class="typebox"><input type="text" id="typedAnswer" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done"><button class="primary" id="submitTyped">判定</button></div>`;
 const inp=$("typedAnswer");inp.focus();
 $("submitTyped").addEventListener("click",()=>resolveTyped(v));
 inp.addEventListener("keydown",e=>{if(e.key==="Enter")resolveTyped(v)});
}
function normalizeAnswer(s){return s.trim().toLowerCase().replace(/[’‘]/g,"'").replace(/[-–—]/g," ").replace(/\s+/g," ").replace(/[.!?]$/,"")}
function resolveTyped(v){
 if(questionResolved)return;
 const inp=$("typedAnswer"),ans=normalizeAnswer(inp.value);
 if(!ans){showToast("答えを入力してください");return}
 const accepted=[normalizeAnswer(v.word)];
 if(v.word==="cannot")accepted.push("can not","can't");
 const ok=accepted.includes(ans);
 inp.disabled=true;$("submitTyped").disabled=true;
 applyOutcome(v,ok?"got":"miss");
 showFeedback(v,ok,ans);
}
function reviewISO(ms){return new Date(now()+ms).toISOString()}
function applyOutcome(v,outcome){
 if(questionResolved)return;
 questionResolved=true;
 const p=getProgress(v.id),old=p.mastery;
 const oldWeak=isWeakProgress(p);
 const qType=currentQuestion?.type||"choice";
 const ok=outcome==="got";
 p.lastStudied=new Date().toISOString();
 p.lastRating=ok?"got":"miss";

 if(ok){
   p.correct++;p.streak++;
   recordObjectiveResult(p,true,qType);
   if((v.studyLayer||"core")==="diagnostic"&&p.incorrect===0){
     // 基礎診断を一発正解した語は「知っている基礎語」として安定へ。
     // 通常おすすめから外し、忘却確認だけ長めの間隔で行う。
     p.evidence=Math.max(Number(p.evidence)||0,5);
     p.mastery=Math.max(p.mastery,2);
     p.nextReview=reviewISO(60*86400000);
   }else{
     const days=[0,1,4,14,45][p.mastery];
     p.nextReview=reviewISO(days===0?10*60*1000:days*86400000);
   }
   p.recentMistakeUntil=null;
   delete session.missDue[v.id];
   session.blockedIds.delete(v.id);

   session.correct++;
   if(p.mastery>old)session.masteryUps++;
   if(old<4&&p.mastery===4)session.newFixed.add(v.word);
 }else{
   p.incorrect++;p.streak=0;
   recordObjectiveResult(p,false,qType);
   p.nextReview=reviewISO(10*60*1000);
   p.recentMistakeUntil=reviewISO(3*86400000);
   session.wrong++;
   session.missed.add(v.word);
   if(isWeakProgress(p))session.weak.add(v.word);

   // 単発ミスは「要再確認」。2回以上の客観ミスで初めて「苦手」になり得る。
   if((session.retryCounts[v.id]||0)===0){
     const gap=(v.priority==="S"||v.level===60)?6:8;
     session.missDue[v.id]=session.answered+gap;
   }else{
     delete session.missDue[v.id];
     session.blockedIds.add(v.id);
   }
 }
 if(oldWeak&&!isWeakProgress(p))session.weak.delete(v.word);

 session.answered++;
 syncToday();state.stats.todayCount++;state.stats.totalAnswers++;
 saveState();
 $("sessionCount").textContent=session.target===Infinity?`${session.answered}問回答`:`${session.answered}/${session.target}`;
 $("sessionScore").textContent=`正解 ${session.correct} / 不正解 ${session.wrong}`;
}
function examExampleHTML(v){
 const ex=EXAM_EXAMPLES[v.id];
 if(!ex){
   return `<div class="exam-example"><div class="exam-example-head">例文監査エラー</div><div class="exam-example-note">この項目の出典表示レコードが未登録です。固定ID: ${esc(v.id)}</div></div>`;
 }
 const src=`${ex.year}年度 ${ex.source}${ex.page?`・PDF p.${ex.page}`:""}`;
 const highlight=(raw,form)=>{
   const s=String(raw||""),f=String(form||"");
   if(!f)return esc(s);
   const i=s.toLowerCase().indexOf(f.toLowerCase());
   return i>=0
     ? esc(s.slice(0,i))+`<b>${esc(s.slice(i,i+f.length))}</b>`+esc(s.slice(i+f.length))
     : esc(s);
 };
 const ja=String(ex.ja||"").trim();
 const jaHTML=ja
   ? `<div class="exam-example-ja"><span class="exam-example-ja-label">和訳</span>${esc(ja)}</div>`
   : `<div class="exam-example-ja"><span class="exam-example-ja-label">和訳監査エラー</span>この項目の和訳が未登録です。固定ID: ${esc(v.id)}</div>`;
 if(!ex.sentence){
   const fragment=String(ex.fragment||ex.matchedForm||v.word);
   const rendered=highlight(fragment,ex.matchedForm||v.word);
   const note=ex.note||"過去問では単独語・選択肢として出現し、この語を含む完成英文は資料内から確認できません。";
   return `<div class="exam-example"><div class="exam-example-head">過去問での出題例 · ${esc(src)}</div><div class="exam-example-sentence">${rendered}</div>${jaHTML}<div class="exam-example-note">${esc(note)}</div></div>`;
 }
 const s=String(ex.sentence),form=String(ex.matchedForm||v.word);
 const rendered=highlight(s,form);
 const modeNote=ex.mode==="completed"
   ? (ex.note||"問題の空所・整序を公式解答で補完した完成文")
   : (ex.note||"");
 return `<div class="exam-example"><div class="exam-example-head">過去問例文 · ${esc(src)}</div><div class="exam-example-sentence">${rendered}</div>${jaHTML}${modeNote?`<div class="exam-example-note">${esc(modeNote)}</div>`:""}</div>`;
}
function showFeedback(v,ok,userAns=""){
 const p=getProgress(v.id);
 const cat=v.categories.map(c=>CATEGORY_JP[c]||c).join("・")||"過去問";
 $("feedback").innerHTML=`<div class="correctline">${ok?"✓ ":""}${esc(v.word)} <button class="icon-btn" style="min-height:38px;min-width:38px;padding:5px" onclick="speakWord('${v.id}')">🔊</button></div>
 <div style="font-size:17px;font-weight:650;margin-top:4px">${esc(v.meaning)}</div>
 ${!ok&&userAns?`<div class="small" style="color:var(--bad);margin-top:6px">入力：${esc(userAns)}</div>`:""}
 ${examExampleHTML(v)}
 <div class="small muted" style="margin-top:8px">${esc(v.note||"")} ${v.note?"· ":""}過去問 ${effectiveFrequency(v)}回 / ${v.yearCount}年度 · ${esc(cat)}</div>
 <div class="row between" style="margin-top:8px"><span class="tiny muted">客観判定 ${p.mastery} ${MASTER_LABEL[p.mastery]}${isWeakProgress(p)?" ・ 苦手判定":""}</span>${masteryDots(p.mastery)}</div>`;
 $("feedback").classList.add("show");
 $("nextArea").innerHTML=`<button class="primary full" id="nextBtn" style="margin-top:14px">${session.target!==Infinity&&session.answered>=session.target?"結果を見る":"次へ"}</button>`;
 $("nextBtn").addEventListener("click",nextQuestion);
}
function nextQuestion(){
 if(!session||!session.active)return;
 if(session.target!==Infinity&&session.answered>=session.target){endSession(false);return}
 renderQuestion();
}
function startSession(){
 const mode=$("modeSelect").value,year=$("learnYearSelect").value,size=Number($("sessionSizeSelect").value);
 const pool=filterPool(mode,year);
 if(!pool.length){showToast("この条件に該当する語がありません");return}
 state.settings.mode=mode;state.settings.year=year;state.settings.sessionSize=size;saveState();
 session={
   active:true,mode,year,target:size===0?Infinity:size,
   asked:0,answered:0,correct:0,wrong:0,masteryUps:0,
   missed:new Set(),weak:new Set(),newFixed:new Set(),recentIds:[],
   missDue:{},retryCounts:{},blockedIds:new Set()
 };
 $("learnSetup").style.display="none";$("quizArea").style.display="block";$("sessionBar").classList.add("show");
 $("headerTitle").textContent=modeLabel(mode);
 renderQuestion();
}
function endSession(silent=false){
 if(!session)return;
 const s=session;session.active=false;state.stats.totalSessions++;saveState();
 $("sessionBar").classList.remove("show");$("quizArea").style.display="none";$("learnSetup").style.display="block";
 if(silent){session=null;renderLearnHome();return}
 const accuracy=s.answered?Math.round(s.correct/s.answered*100):0;
 openSheet(`<h2 style="margin-top:0">セッション結果</h2>
 <div class="grid">
  <div class="stat"><div class="n">${s.answered}</div><div class="l">今回の問題数</div></div>
  <div class="stat"><div class="n">${s.correct}</div><div class="l">正解</div></div>
  <div class="stat"><div class="n">${s.wrong}</div><div class="l">不正解</div></div>
  <div class="stat"><div class="n">${accuracy}%</div><div class="l">正解率</div></div>
  <div class="stat"><div class="n">${s.masteryUps}</div><div class="l">習熟度UP</div></div>
  <div class="stat"><div class="n">${s.newFixed.size}</div><div class="l">新しく定着</div></div>
 </div>
 <div class="section-title">今回ミスした語</div><div class="small">${s.missed.size?[...s.missed].slice(0,18).map(esc).join("・"):"なし"}</div><div class="section-title">苦手判定語（複数回の客観ミス）</div><div class="small">${s.weak.size?[...s.weak].slice(0,18).map(esc).join("・"):"なし"}</div>
 <div class="section-title">新しく定着した語</div><div class="small">${s.newFixed.size?[...s.newFixed].slice(0,18).map(esc).join("・"):"なし"}</div>
 <button class="primary full" style="margin-top:18px" onclick="closeSheet()">閉じる</button>`);
 session=null;renderLearnHome();
}
function renderLearnHome(){
 syncToday();
 if(session&&session.active)return;
 const learnable=VOCAB.filter(v=>(v.studyLayer||"core")!=="reference");
 const ps=learnable.map(v=>getProgress(v.id));
 const due=learnable.filter(v=>{const p=getProgress(v.id);return p.nextReview&&new Date(p.nextReview).getTime()<=now()}).length;
 const weak=ps.filter(p=>isWeakProgress(p)).length;
 const un=ps.filter(p=>attemptCount(p)===0).length;
 const diagLeft=VOCAB.filter(v=>(v.studyLayer||"core")==="diagnostic").filter(v=>{const p=getProgress(v.id);return !((p.correct>=1&&p.incorrect===0&&!isWeakProgress(p))||p.mastery>=3)}).length;
 $("dueMini").textContent=`復習期限 ${due}語 / 診断残り ${diagLeft}語`;
 $("miniStats").innerHTML=[
   [state.stats.todayCount,"今日回答"],[un,"未学習"],[weak,"苦手"],[masteredRate(learnable)+"%","習得率"]
 ].map(([n,l])=>`<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
}
function masteredRate(items){
 if(!items.length)return 0;
 return Math.round(items.filter(v=>getProgress(v.id).mastery>=3).length/items.length*100);
}
function renderList(){
 const q=$("searchInput").value.trim().toLowerCase(),y=$("listYear").value,pri=$("listPriority").value,layer=$("listLayer").value,lev=$("listLevel").value,mas=$("listMastery").value;
 let arr=VOCAB.filter(v=>{
   const p=getProgress(v.id);
   if(q&&!v.word.toLowerCase().includes(q)&&!v.meaning.toLowerCase().includes(q))return false;
   if(y!=="all"&&!v.years.includes(Number(y)))return false;
   if(pri!=="all"&&v.priority!==pri)return false;
   if(layer!=="all"&&(v.studyLayer||"core")!==layer)return false;
   if(lev!=="all"&&String(v.level)!==lev)return false;
   if(mas!=="all"&&String(p.mastery)!==mas)return false;
   return true;
 });
 const po={S:0,A:1,B:2,C:3},lo={core:0,diagnostic:1,challenge:2,reference:3};
 arr.sort((a,b)=>lo[a.studyLayer||"core"]-lo[b.studyLayer||"core"]||po[a.priority]-po[b.priority]||a.level-b.level||b.yearCount-a.yearCount||effectiveFrequency(b)-effectiveFrequency(a)||a.word.localeCompare(b.word));
 $("listCount").textContent=`${arr.length}件`;
 $("wordList").innerHTML=arr.length?arr.map(v=>{
   const p=getProgress(v.id);
   return `<div class="list-row" data-detail="${v.id}">
    <div><div class="list-word">${esc(v.word)}</div><div class="list-meaning">${esc(v.meaning)}</div><div class="badges" style="margin-top:6px">${badgeHTML(v)} ${masteryDots(p.mastery)}</div></div>
    <div class="list-meta">${effectiveFrequency(v)}回 / ${v.yearCount}年度<br>${v.years.join(", ")}<br>習熟度 ${p.mastery} ${MASTER_LABEL[p.mastery]}</div>
   </div>`;
 }).join(""):`<div class="empty">該当する語がありません</div>`;
 document.querySelectorAll("[data-detail]").forEach(el=>el.addEventListener("click",()=>openDetail(el.dataset.detail)));
}
function openDetail(id){
 const v=VOCAB_BY_ID.get(id),p=getProgress(id);if(!v)return;
 const cats=v.categories.map(c=>CATEGORY_JP[c]||c).join("・");
 const direct=v.directYears&&v.directYears.length?yearsText(v.directYears):"—";
 const order=v.directOrderYears&&v.directOrderYears.length?yearsText(v.directOrderYears):"—";
 const proper=v.properNameYears&&v.properNameYears.length?yearsText(v.properNameYears):"—";
 const surfaceYears=yearsText(v.surfaceYears||v.years);
 const derived=(v.derivedForms&&v.derivedForms.length)?v.derivedForms.map(x=>typeof x==="string"?x:(x.form+(x.years&&x.years.length?" ("+x.years.join(", ")+")":""))).map(esc).join("・"):(v.derivatives.length?v.derivatives.map(esc).join("・"):"—");
 const compound=(v.compoundForms&&v.compoundForms.length)?v.compoundForms.map(x=>typeof x==="string"?x:(x.form+(x.years&&x.years.length?" ("+x.years.join(", ")+")":""))).map(esc).join("・"):"—";
 openSheet(`<div class="row between"><div><div class="word" style="font-size:34px;text-align:left">${esc(v.word)}</div><div style="font-size:19px;font-weight:650;margin-top:5px">${esc(v.meaning)}</div></div><button class="icon-btn" onclick="speakWord('${v.id}')">🔊</button></div>
 <div class="badges" style="margin-top:12px">${badgeHTML(v)} <span class="badge">習熟度 ${p.mastery} ${MASTER_LABEL[p.mastery]}</span> <span class="badge">${evidenceBadge(v)}</span></div>
 <hr><div class="small"><b>学習区分</b> ${esc(LAYER_LABEL[v.studyLayer||"core"]||v.studyLayer)}<br><b>品詞</b> ${esc(v.pos)}<br><b>通常出現</b> ${effectiveFrequency(v)}回 / ${surfaceYears}<br><b>試験内の証拠年度</b> ${v.yearCount}年度（${yearsText(v.years)}）<br><b>問題カテゴリー</b> ${esc(cats||"—")}<br><b>直接語彙問題</b> ${direct}<br><b>語句整序で直接出題</b> ${order}<br><b>本文等の直接解答</b> ${yearsText(v.directAnswerYears)}<br><b>固有名詞内だけの出現</b> ${proper}<br><b>日本語注釈</b> ${v.glossed?"あり（通常学習から除外）":"—"}<br><b>補足</b> ${esc(v.note||"—")}</div>
 ${examExampleHTML(v)}
 <div class="section-title">派生語・関連形</div><div class="small">${derived}</div>
 <div class="section-title">複合語内の出現</div><div class="small">${compound}</div>
 <div class="section-title">関連熟語（過去問で確認できたもの）</div><div class="small">${v.relatedPhrases.length?v.relatedPhrases.map(esc).join("・"):"—"}</div>
 <div class="section-title">学習履歴</div><div class="small">正解 ${p.correct} / 不正解 ${p.incorrect} / 連続正解 ${p.streak}<br>客観判定 ${MASTER_LABEL[p.mastery]}${isWeakProgress(p)?" / 苦手判定":""}<br>最終学習 ${formatDate(p.lastStudied)}<br>次回復習 ${formatDate(p.nextReview)}</div>
 <div class="tiny muted" style="margin-top:14px">固定ID: ${esc(v.id)}</div>`);
}
function renderStats(){
 syncToday();
 const learnable=VOCAB.filter(v=>(v.studyLayer||"core")!=="reference");
 const pAll=learnable.map(v=>getProgress(v.id));
 const countLayer=l=>VOCAB.filter(v=>(v.studyLayer||"core")===l).length;
 const fixed=pAll.filter(p=>p.mastery===4).length,weak=pAll.filter(p=>isWeakProgress(p)).length,un=pAll.filter(p=>attemptCount(p)===0).length;
 const stats=[
 [learnable.length,"学習対象"],[countLayer("core"),"通常学習"],[countLayer("diagnostic"),"基礎診断"],[countLayer("challenge"),"75点挑戦"],
 [countLayer("reference"),"参照のみ"],[un,"未学習"],[weak,"苦手"],[fixed,"定着"],
 [state.stats.todayCount,"今日の学習数"],[state.stats.totalAnswers,"累計回答数"],[masteredRate(learnable)+"%","習得率"]
 ];
 $("statsGrid").innerHTML=stats.map(([n,l])=>`<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
 const groups=[
  ["通常学習",VOCAB.filter(v=>(v.studyLayer||"core")==="core")],
  ["60点突破",VOCAB.filter(v=>(v.studyLayer||"core")!=="reference"&&v.level===60)],
  ["70点安定まで",VOCAB.filter(v=>(v.studyLayer||"core")==="core"&&(v.level===60||v.level===70))]
 ];
 $("rateBars").innerHTML=groups.map(([label,items])=>{const r=masteredRate(items);return `<div style="margin:13px 0"><div class="row between small"><b>${label}</b><span>${r}%</span></div><div class="progressbar" style="margin-top:6px"><i style="width:${r}%"></i></div></div>`}).join("");
 const dist=[0,1,2,3,4].map(m=>pAll.filter(p=>p.mastery===m).length);
 $("masteryDistribution").innerHTML=dist.map((n,m)=>`<div class="row between small" style="padding:7px 0"><span>${m} ${MASTER_LABEL[m]}</span><b>${n}</b></div>`).join("");
}
function renderAnalysis(){
 $("analysisMethod").textContent=META.method+" ｜ "+META.auditStatus;
 const cards=[
  [META.years[0]+"–"+META.years[META.years.length-1],"分析年度"],
  [META.rawCandidateEntries,"一次候補エントリ※"],
  [META.registeredWords,"登録単語"],
  [META.registeredPhrases,"熟語・定型表現"],
  [META.learnableTotal,"クイズ対象"],
  [META.registeredTotal,"総データ"],
  [META.directVocabCount,"直接語彙正答"],
  [META.glossedReferenceCount,"注釈付き参照語"],
  [META.verifiedEvidenceEntries,"証拠属性を精査済み"]
 ];
 $("analysisGrid").innerHTML=cards.map(([n,l])=>`<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
 $("analysisGrid").insertAdjacentHTML("afterend",`<p class="tiny muted">※1,831は旧集計との連続性を保つための一次候補エントリ数です。students→student等の表記統合は学習データ作成時に個別に正規化し、この数自体を「完全正規化後のユニーク見出し語数」とは扱いません。</p>`);
 const lc=META.layerCounts;
 $("analysisCounts").innerHTML=`<div class="grid">
  <div class="stat"><div class="n">${lc.core}</div><div class="l">通常学習</div></div>
  <div class="stat"><div class="n">${lc.diagnostic}</div><div class="l">基礎診断</div></div>
  <div class="stat"><div class="n">${lc.challenge}</div><div class="l">75点挑戦</div></div>
  <div class="stat"><div class="n">${lc.reference}</div><div class="l">参照のみ</div></div>
 </div>
 <div class="small muted" style="margin-top:12px">通常学習はおすすめ・60点・70点モードの中心。基礎診断は一発正解で反復を大幅に減らします。75点挑戦は通常おすすめには混ぜず、参照のみはクイズに出しません。v7では語句整序で直接問われた表現を追加し、通常出現・直接出題・注釈・固有名詞・派生形を分離して表示します。</div>`;
 $("sourceFiles").innerHTML=META.frequencySourceFiles.map(x=>`<li>${esc(x)}</li>`).join("");
 $("answerFiles").innerHTML=META.auxiliaryAnswerFiles.map(x=>`<li>${esc(x)}</li>`).join("");
 $("missingFiles").innerHTML=META.missing.map(x=>`<li>${esc(x)}</li>`).join("");
 $("top100Body").innerHTML=TOP100.map(r=>`<tr><td>${r.rank}</td><td><b>${esc(r.word)}</b></td><td>${esc(r.meaning)}</td><td>${r.frequency}</td><td>${r.yearCount}</td><td>${esc(r.reason||"")}</td><td>${r.priority}</td><td>${r.level}</td><td>${esc(LAYER_LABEL[r.studyLayer]||r.studyLayer)}</td></tr>`).join("");
}
function renderSettings(){
 $("themeSelect").value=state.settings.theme||"auto";
 $("accentSelect").value=state.settings.accent||"auto";
 populateVoices();
 const orphan=Object.keys(state.words).filter(id=>!VOCAB_BY_ID.has(id)).length;
 $("dataInfo").innerHTML=`<div class="row between setting-row"><span>単語データ</span><b>${META.dataVersion}</b></div>
 <div class="row between setting-row"><span>schemaVersion</span><b>${state.schemaVersion}</b></div>
 <div class="row between setting-row"><span>固定ID登録数</span><b>${VOCAB.length}</b></div><div class="row between setting-row"><span>クイズ対象</span><b>${META.learnableTotal}</b></div>
 <div class="row between setting-row"><span>現行データ外の保存ID</span><b>${orphan}</b></div>`;
}
function openSheet(html){$("sheetContent").innerHTML=html;$("sheetOverlay").classList.add("show")}
function closeSheet(){$("sheetOverlay").classList.remove("show")}
function formatDate(v){
 if(!v)return "—";
 const d=new Date(v);if(Number.isNaN(d.getTime()))return "—";
 return d.toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function populateVoices(){
 if(!("speechSynthesis" in window))return;
 voices=window.speechSynthesis.getVoices().filter(v=>/^en[-_]/i.test(v.lang));
 const sel=$("voiceSelect"),old=state.settings.voiceURI||"";
 sel.innerHTML='<option value="">自動選択</option>'+voices.map(v=>`<option value="${esc(v.voiceURI)}">${esc(v.name)} — ${esc(v.lang)}</option>`).join("");
 if(voices.some(v=>v.voiceURI===old))sel.value=old;else sel.value="";
}
function selectedVoice(){
 if(!voices.length&&"speechSynthesis" in window)voices=window.speechSynthesis.getVoices().filter(v=>/^en[-_]/i.test(v.lang));
 if(state.settings.voiceURI){
   const exact=voices.find(v=>v.voiceURI===state.settings.voiceURI);if(exact)return exact;
 }
 const acc=state.settings.accent||"auto";
 if(acc==="us"){const v=voices.find(v=>/^en[-_]US/i.test(v.lang));if(v)return v}
 if(acc==="gb"){const v=voices.find(v=>/^en[-_]GB/i.test(v.lang));if(v)return v}
 return voices[0]||null;
}
function speakWord(idOrWord){
 if(!("speechSynthesis" in window)){showToast("この端末では音声合成を利用できません");return}
 const v=VOCAB_BY_ID.get(idOrWord)||VOCAB_BY_WORD.get(idOrWord);
 const text=v?v.word:String(idOrWord||"important");
 const u=new SpeechSynthesisUtterance(text),voice=selectedVoice();
 if(voice){u.voice=voice;u.lang=voice.lang}else u.lang=state.settings.accent==="gb"?"en-GB":"en-US";
 u.rate=.88;window.speechSynthesis.cancel();window.speechSynthesis.speak(u);
}
function exportData(){
 const payload={app:"早稲渋 Vocabulary Coach",exportedAt:new Date().toISOString(),schemaVersion:state.schemaVersion,dataVersion:META.dataVersion,state};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="waseshibu_vocab_backup_"+localDayKey()+".json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 showToast("バックアップを書き出しました");
}
function mergeImported(raw){
 const incoming=migrate(raw.state||raw),current=state;
 for(const [id,ip] of Object.entries(incoming.words||{})){
   const cp=current.words[id];
   if(!cp){current.words[id]=ip;continue}
   const it=ip.lastStudied?new Date(ip.lastStudied).getTime():0,ct=cp.lastStudied?new Date(cp.lastStudied).getTime():0;
   const newer=it>=ct?ip:cp,older=it>=ct?cp:ip;
   current.words[id]=Object.assign(defaultProgress(),newer,{
     correct:Math.max(Number(ip.correct)||0,Number(cp.correct)||0),
     incorrect:Math.max(Number(ip.incorrect)||0,Number(cp.incorrect)||0),
     streak:newer.streak??0
   });
 }
 current.stats.totalAnswers=Math.max(Number(current.stats.totalAnswers)||0,Number(incoming.stats.totalAnswers)||0);
 current.stats.totalSessions=Math.max(Number(current.stats.totalSessions)||0,Number(incoming.stats.totalSessions)||0);
 if(incoming.stats.todayKey===localDayKey())current.stats.todayCount=Math.max(Number(current.stats.todayCount)||0,Number(incoming.stats.todayCount)||0);
 current.settings=Object.assign({},current.settings,incoming.settings||{});
 current.schemaVersion=SCHEMA_VERSION;saveState();setTheme(current.settings.theme||"auto");
 showToast("バックアップを統合しました");renderLearnHome();
}
function handleImport(file){
 const reader=new FileReader();
 reader.onload=()=>{try{mergeImported(JSON.parse(reader.result))}catch(e){showToast("JSONを読み込めませんでした")}};
 reader.readAsText(file);
}
function attachEvents(){
 document.querySelectorAll(".nav button").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
 $("startBtn").addEventListener("click",startSession);
 $("endSessionBtn").addEventListener("click",()=>endSession(false));
 $("quickSpeak").addEventListener("click",()=>speakWord(currentQuestion?currentQuestion.v.id:"important"));
 $("modeSelect").addEventListener("change",e=>{state.settings.mode=e.target.value;saveState()});
 $("learnYearSelect").addEventListener("change",e=>{state.settings.year=e.target.value;saveState()});
 $("sessionSizeSelect").addEventListener("change",e=>{state.settings.sessionSize=Number(e.target.value);saveState()});
 ["searchInput","listYear","listPriority","listLayer","listLevel","listMastery"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",renderList));
 $("sheetOverlay").addEventListener("click",e=>{if(e.target===$("sheetOverlay"))closeSheet()});
 $("accentSelect").addEventListener("change",e=>{state.settings.accent=e.target.value;state.settings.voiceURI="";saveState();populateVoices()});
 $("voiceSelect").addEventListener("change",e=>{state.settings.voiceURI=e.target.value;saveState()});
 $("voiceTestBtn").addEventListener("click",()=>speakWord("important"));
 $("themeSelect").addEventListener("change",e=>{setTheme(e.target.value);saveState()});
 $("exportBtn").addEventListener("click",exportData);
 $("importBtn").addEventListener("click",()=>$("importFile").click());
 $("importFile").addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];if(f)handleImport(f);e.target.value=""});
 if("speechSynthesis" in window){
   populateVoices();window.speechSynthesis.addEventListener("voiceschanged",populateVoices);
 }
}
function init(){
 initSelectors();setTheme(state.settings.theme||"auto");attachEvents();renderLearnHome();renderAnalysis();
}
