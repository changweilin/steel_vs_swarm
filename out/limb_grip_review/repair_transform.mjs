import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'out/limb_grip_review');
const contract=JSON.parse(await readFile('tools/mech_authoring/morphers.json','utf8'));
const ids=Object.keys(contract.assets),blender=process.env.BLENDER_BIN;
const slat=process.argv.includes('--slat');
const fold=process.argv.includes('--fold');
const priorEquivalence=JSON.parse(await readFile(path.join(out,'repair-runtime-equivalence.json'),'utf8'));
const previous={};
for(const id of ids){
  const asset=JSON.parse((await readFile(`public/js/forge/assets/${id}.js`,'utf8')).split('export default ')[1].replace(/;\s*$/,''));
  delete asset.source;previous[id]=JSON.stringify(asset);
}
const run=async(label,executable,args)=>{
  const chunks=[];
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:root,env:process.env,windowsHide:true});
    child.stdout.on('data',data=>chunks.push(data));child.stderr.on('data',data=>chunks.push(data));
    child.on('error',reject);child.on('exit',resolve);
  });
  const log=Buffer.concat(chunks);await writeFile(path.join(out,label+'.log'),log);
  if(code!==0)throw Error(label+' failed ('+code+')');
  return log;
};
try{
  await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:'repair-transform-exports',status:'running'}));
  for(const combat of [false,true]){
    let next=0;
    const logs=await Promise.all(Array.from({length:4},async()=>{
      const entries=[];
      while(next<ids.length){
        const id=ids[next++];
        const args=['--background','--factory-startup','--python-expr','import bpy; bpy.context.preferences.filepaths.save_version = 0',
                    '--python-exit-code','1','--python','tools/mech_authoring/build.py','--','--asset',id,'--contract','morphers.json','--no-render'];
        if(combat)args.push('--combat','--combat-data','out/combat_reference/intent.json');
        entries.push(await run('repair-'+(combat?'combat-':'body-')+id,blender,args));
        console.log('REBUILT '+(combat?'combat ':'body ')+id);
      }
      return entries;
    }));
    await writeFile(path.join(out,combat?'combat-morph.log':'publish-morph.log'),Buffer.concat(logs.flat()));
  }
  for(const id of ids){
    const asset=JSON.parse((await readFile(`public/js/forge/assets/${id}.js`,'utf8')).split('export default ')[1].replace(/;\s*$/,''));
    delete asset.source;
    if((slat&&id==='t11')||(fold&&id==='m08'))asset.forms=JSON.parse(previous[id]).forms;
    if(JSON.stringify(asset)!==previous[id])throw Error(id+': unexpected runtime data change; samples require refresh');
  }
  await writeFile(path.join(out,'repair-runtime-equivalence.json'),JSON.stringify({assets:ids,geometryAndRuntimeData:'identical_except_source_fingerprint',
    exceptions:{...priorEquivalence.exceptions,...(slat?{t11:'Flight joint offsets changed; motion samples refreshed'}:{}),
      ...(fold?{m08:'Folded wing articulation changed; exposed forelimb contacts preserved; motion samples refreshed'}:{})}},null,2));
  if(slat)await run('resample-t11',process.execPath,['tools/mech_authoring/author_motion.mjs','--asset','t11']);
  if(fold)await run('resample-m08',process.execPath,['tools/mech_authoring/author_motion.mjs','--asset','m08']);
  await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:'rebake-morph',status:'running'}));
  await run('rebake-morph',blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/mech_authoring/bake_motion.py','--','--actions-only',...ids]);
  await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:'reverify-morph-motion',status:'running'}));
  await run('reverify-morph-motion',blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/mech_authoring/verify_motion.py','--',...ids]);
  await run('remaining-validation',process.execPath,['out/limb_grip_review/finish.mjs','--finish-validation']);
}catch(error){
  await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:'failed',error:error.message}));
  console.error(error);process.exitCode=1;
}
