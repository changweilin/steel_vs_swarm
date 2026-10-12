import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import * as current from '../../public/js/data.js';
const source=(await readFile('out/weapon_revision/before/public/js/data.js','utf8'))
  .replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,file)=>'from '+q+pathToFileURL(path.resolve('public/js',file)).href+q);
const before=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const strip=value=>{
  if(Array.isArray(value))return value.map(strip);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['name','rw'].includes(k)).map(([k,v])=>[k,strip(v)]));
  return value;
};
assert.deepEqual(strip(current.CHARACTERS),strip(before.CHARACTERS),'Character rules changed');
let weapons=0,abilities=0;
for(const id of Object.keys(current.CHARACTERS))for(const lvl of [1,2,3,4])for(const heroic of [false,true]){
  for(const slot of ['light','heavy']){assert.deepEqual(strip(current.heroWeapon(id,slot,lvl,heroic)),strip(before.heroWeapon(id,slot,lvl,heroic)),id+'/'+slot+'/'+lvl);weapons++;}
  for(const slot of ['def','atk']){assert.deepEqual(current.heroAbility(id,slot,lvl,heroic),before.heroAbility(id,slot,lvl,heroic));abilities++;}
}
await writeFile('out/weapon_revision/rules-validation.json',JSON.stringify({gate:'pass',weapons,abilities,characterRules:'exact except name/rw'},null,2));
console.log(JSON.stringify({weapons,abilities,status:'unchanged'}));
