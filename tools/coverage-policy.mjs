// School data policy. The pinned Waseda scheduling and memory engine is unchanged.
const irregular = {
  be:['is','am','are','was','were','been','being'], begin:['began','begun','beginning'],
  break:['broke','broken'], catch:['caught'], choose:['chose','chosen'], come:['came'],
  cost:['cost'], feel:['felt'], find:['found'], get:['got','gotten','getting'],
  give:['gave','given'], feed:['fed'], lose:['lost'], win:['won','winning'], grow:['grew','grown'], hang:['hung'], hide:['hid','hidden','hiding'],
  hold:['held'], keep:['kept'], leave:['left'], lie:['lay','lain','lying'], make:['made'],
  read:['read'], run:['ran','running'], say:['said'], see:['saw','seen'], sew:['sewn','sewed'],
  sit:['sat','sitting'], sow:['sown','sowed'], speak:['spoke','spoken'], spend:['spent'],
  take:['took','taken'], teach:['taught'], throw:['threw','thrown'], tie:['tied','tying'],
  write:['wrote','written'],
};
const doubled = new Set(['submit','wrap','slip','drip','stop','plan','admit','prefer','refer','control']);
const plural = {leaf:'leaves',wife:'wives',life:'lives',elf:'elves',child:'children',person:'people'};
const aliases = {neighbour:['neighbor'],theatre:['theater'],organise:['organize'],realise:['realize'],recognise:['recognize'],practice:['practise'],behaviour:['behavior'],urbanisation:['urbanization']};
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function baseForms(word,pos){
  const out=new Set([word]);
  if(/noun|verb/.test(pos)){
    out.add(plural[word] || (/[^aeiou]y$/.test(word)?word.slice(0,-1)+'ies':/(s|x|z|ch|sh)$/.test(word)?word+'es':word+'s'));
  }
  if(/verb/.test(pos)){
    const stem=doubled.has(word)?word+word.at(-1):word;
    if(irregular[word])for(const form of irregular[word])out.add(form);
    else out.add(/[^aeiou]y$/.test(word)?word.slice(0,-1)+'ied':word.endsWith('e')?word+'d':stem+'ed');
    out.add(word.endsWith('ie')?word.slice(0,-2)+'ying':word.endsWith('e')&&!word.endsWith('ee')?word.slice(0,-1)+'ing':stem+'ing');
  }
  return [...out];
}
export function variants(lemma,pos='noun/verb'){
 const lower=lemma.toLowerCase();
 if(lower.includes(' '))return [lower];
 return [...new Set([lower,...(aliases[lower]||[])].flatMap(word=>baseForms(word,pos)))];
}
export function matcher(lemma,pos='noun/verb'){
 const words=lemma.toLowerCase().split(' ');
 let body;
 if(words.length===1)body=variants(lemma,pos).map(escape).join('|');
 else {
   const first=words.shift();
   // Only the first verb inflects; noun compounds and conjunctions stay intact.
   const phraseVerbs=new Set(['be','look','give','find','come','get','pass','wait','earn','cut','play','tidy','take','break','listen','make']);
   const heads=phraseVerbs.has(first)?variants(first,'verb'):[first];
   body='(?:'+heads.map(escape).join('|')+')'+(first==='be'?'\\s+(?:not\\s+)?':'\\s+')+words.map(escape).join('\\s+');
 }
 return new RegExp('\\b(?:'+body+')\\b','gi');
}
export function normalized(text){return text.replace(/[’‘]/g,"'").replace(/\((?:['" ]*[147]|[ア-ン])\s*\)/g,' ').replace(/\s+/g,' ').trim();}
export function evidenceFor(lemma,pos,papers){
 const evidence=[];
 for(const paper of papers)for(const page of paper.pages){
  let text=normalized(page.text);
  // "up to" means a maximum here. Do not count "climb/fly up to".
  if(lemma.toLowerCase()==='up to')text=text.replace(/\b(?:climb|fly|flew|back)\s+up\s+to\b/gi,'');
  // "order" is a noun/verb, distinct from the fixed conjunction "in order to".
  if(lemma.toLowerCase()==='order')text=text.replace(/\bin order to\b/gi,'');
  const matches=[...text.matchAll(matcher(lemma,pos))];
  if(matches.length)evidence.push({year:paper.year,schedule:paper.schedule,page:page.page,count:matches.length,category:page.category,forms:[...new Set(matches.map(x=>x[0].toLowerCase()))]});
 }
 return evidence;
}
export function priorityFor({frequency,paperCount,yearCount,directTarget=false,glossOnly=false}){
 if(!frequency&&!directTarget)return 'C';
 // A repeated word in one story is weaker evidence than recurrence across papers.
 if(!glossOnly&&(yearCount>=2||paperCount>=3))return 'S';
 if(paperCount>=2||directTarget||(!glossOnly&&frequency>=3))return 'A';
 return 'B';
}
