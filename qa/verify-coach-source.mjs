import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const lock=JSON.parse(await readFile('waseda-app.lock.json','utf8'));
await Promise.all(Object.entries(lock.files).map(async([name,hash])=>{
  const local=await readFile('vendor/waseda/'+name,'utf8');
  assert.equal(createHash('sha256').update(local).digest('hex'),hash,name);
  const path=name.startsWith('common-engine/')?'src/'+name:'src/waseda-bootstrap/'+name;
  const response=await fetch(`https://raw.githubusercontent.com/${lock.sourceRepository}/${lock.sourceCommit}/${path}`);
  assert.ok(response.ok,`${path}: ${response.status}`);
  assert.equal(local,await response.text(),name+' differs from Waseda');
}));
console.log('Complete Waseda source: all 16 original files match upstream commit '+lock.sourceCommit);
