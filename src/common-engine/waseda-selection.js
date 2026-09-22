function weightedChoice(items,weights){
 let total=weights.reduce((a,b)=>a+b,0),r=Math.random()*total;
 for(let i=0;i<items.length;i++){r-=weights[i];if(r<=0)return items[i]}
 return items[items.length-1];
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

export { v75WeightedWithoutReplacement };
