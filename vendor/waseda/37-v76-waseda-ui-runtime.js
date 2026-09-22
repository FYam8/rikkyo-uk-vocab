
function v76MemoryDetailHTML(v,p){
  const m=p&&p.memoryModel;
  if(!m||Number(m.version)!==V76_MEMORY_MODEL_VERSION){
    return `<div class="section-title">記憶定着モデル</div><div class="small muted">この語は次回の回答時から、既存履歴を保持したまま忘却曲線ベースの復習間隔へ移行します。</div>`;
  }
  const r=Math.round(v76Retrievability(m)*100),target=Math.round(v76TargetRetention(v,p)*100);
  return `<div class="section-title">記憶定着モデル</div><div class="small">推定想起率 <b>${r}%</b> / 目標 ${target}%<br>記憶安定度 ${Number(m.stabilityDays).toFixed(1)}日<br>難易度 ${Number(m.difficulty).toFixed(1)} / 10<br>次回復習 ${formatDate(p.nextReview)}</div>`;
}
const v75OpenDetailForV76=openDetail;
openDetail=function(id){
  v75OpenDetailForV76(id);
  const v=VOCAB_BY_ID.get(id),p=getProgress(id),box=$("sheetContent");
  if(v&&box)box.insertAdjacentHTML("beforeend",v76MemoryDetailHTML(v,p));
};

function v76HydrateExtraSettings(){
  const input=document.getElementById("examDateInput");
  if(input)input.value=state.settings.examDate||"";
}
function v76EnsureMemorySettings(){
  if(document.getElementById("memoryScheduleSettings"))return;
  const view=$("view-settings");if(!view)return;
  const backup=[...view.querySelectorAll(".card")].find(c=>c.querySelector("#exportBtn"));
  if(!backup)return;
  const card=document.createElement("div");
  card.className="card";card.id="memoryScheduleSettings";
  card.innerHTML=`<h2>記憶定着・復習</h2><p class="small muted">固定日数ではなく、各単語の記憶安定度・難易度・推定想起率から nextReview を決めます。通常は想起率90%、Sランク・苦手語は92〜93%を目安に再出題します。</p><div class="setting-row field"><label>入試日（任意）</label><input type="date" id="examDateInput"><div class="tiny muted" style="margin-top:6px">設定すると直前期の「今日やること」で、想起率の低いSランク・苦手語を優先します。復習日を一律に試験前へ強制移動はしません。</div></div>`;
  backup.parentElement.insertBefore(card,backup);
  const input=$("examDateInput");
  input.value=state.settings.examDate||"";
  input.addEventListener("change",()=>{
    state.settings.examDate=input.value||"";
    markSettingsUpdated();saveState();renderLearnHome();
  });
}
const v75HydrateUiForV76=hydrateUiFromState;
hydrateUiFromState=function(){v75HydrateUiForV76();v76HydrateExtraSettings()};
const v75InitForV76=init;
init=function(){
  v75InitForV76();
  v76EnsureMemorySettings();
  v76HydrateExtraSettings();
};
/* V76_MEMORY_CURVE_SCHEDULER_END */
