/*
 * Waseda-only session planning policy adapter.
 * First reviewed group: foundation-reason precedence and exact learner-facing copy.
 * Do not move these strings or Waseda-specific predicates into the common engine.
 */
const WASEDA_PLANNING_POLICY=Object.freeze({
  foundationReason(v,p,t){
    if(isWeakProgress(p))return "挑戦前の基礎確認：最近の正誤履歴で苦手判定となっている重要語です。";
    if(p.recentMistakeUntil&&new Date(p.recentMistakeUntil).getTime()>t)return "挑戦前の基礎確認：最近間違えた重要語のため再確認します。";
    if(p.nextReview&&new Date(p.nextReview).getTime()<=t)return "挑戦前の基礎確認：復習期限を迎えた重要語です。";
    return "挑戦前の基礎確認：75点挑戦を支える基礎語を再確認します。";
  },
  challengeScore(v,p,t){
    let score=(PRIORITY_SCORE[v.priority]||0)+(v.yearCount||0)*8+Math.sqrt(effectiveFrequency(v))*4+[80,110,65,25,4][p.mastery];
    if(p.nextReview&&new Date(p.nextReview).getTime()<=t)score+=115;
    if(p.recentMistakeUntil&&new Date(p.recentMistakeUntil).getTime()>t)score+=80;
    if(isWeakProgress(p))score+=95;
    if(p.mastery===4&&!(p.nextReview&&new Date(p.nextReview).getTime()<=t))score*=.12;
    return score;
  },
  isChallengeEntity(v){return (v.studyLayer||"core")==="challenge"},
  isFoundationLayerEligible(v){
    const layer=v.studyLayer||"core";
    return layer!=="reference"&&layer!=="challenge";
  },
  isFoundationStateEligible(p,t){
    const due=p.nextReview&&new Date(p.nextReview).getTime()<=t;
    const recent=p.recentMistakeUntil&&new Date(p.recentMistakeUntil).getTime()>t;
    return isWeakProgress(p)||due||recent;
  },
  requiredChallengeCount(desired){return Math.ceil(desired*.8)},
  foundationExceptionCap(desired){return Math.floor(desired*.2)},
  isChallengeMode(mode){return mode==="75"},
  isRandomMode(mode){return mode==="random"},
  retryGap(v){return v.priority==="S"||v.level===60?6:8},
  unlimitedRecentWindow:6
});
