import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'out/limb_grip_review');
const run=async(label,executable,args)=>{
  await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:label,status:'running'}));
  const chunks=[];
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:root,env:process.env,windowsHide:true});
    child.stdout.on('data',data=>chunks.push(data));child.stderr.on('data',data=>chunks.push(data));
    child.on('error',reject);child.on('exit',code=>resolve(code));
  });
  await writeFile(path.join(out,label+'.log'),Buffer.concat(chunks));
  if(code!==0)throw Error(label+' failed ('+code+')');
  console.log('FINISHED '+label);
};
const blender=(label,script)=>run(label,process.env.BLENDER_BIN,['--background','--factory-startup','--python-exit-code','1','--python',script]);
try{
  if(!process.argv.includes('--finish-validation')&&!process.argv.includes('--runtime-validation')){
  if(!process.argv.includes('--resume'))await run('combat-base',process.execPath,['tools/mech_authoring/build.mjs','--combat','--no-render']);
  await run('combat-morph',process.execPath,['tools/mech_authoring/build.mjs','--contract','morphers.json','--combat','--no-render']);
  for(const [label,count]of [['base',24],['morph',8]]){
    const log=await readFile(path.join(out,'publish-'+label+'.log'),'utf8');
    if(log.split('\n').filter(line=>line.startsWith('ASSET_RESULT ')).length!==count)throw Error('Body publication incomplete: '+label);
  }
  await run('equipment',process.execPath,['tools/audit_mech_equipment.mjs','--output',path.join(out,'equipment')]);
  await run('biped',process.execPath,['tools/audit_biped_posture.mjs']);
  await run('sample-motion',process.execPath,['tools/mech_authoring/author_motion.mjs']);
  await run('bake-motion',process.env.BLENDER_BIN,['--background','--factory-startup','--python-exit-code','1','--python','tools/mech_authoring/bake_motion.py','--','--actions-only']);
  await blender('verify-motion','tools/mech_authoring/verify_motion.py');
  await blender('verify-base','tools/mech_authoring/verify.py');
  }
  if(!process.argv.includes('--runtime-validation')){
  await blender('verify-morph','tools/mech_authoring/verify_morph.py');
  await blender('verify-combat','tools/mech_authoring/verify_combat.py');
  await run('attachments',process.execPath,['tools/audit_limb_grips.mjs']);
  await run('reference-base',process.execPath,['tools/audit_reference_mechs.mjs','--output',path.join(out,'reference-base')]);
  }
  await run('reference-morph',process.execPath,['tools/audit_reference_morph.mjs']);
  await run('anatomical',process.execPath,['tools/audit_anatomical_motion.mjs']);
  await run('combat',process.execPath,['tools/audit_combat_actions.mjs']);
  await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:'complete',status:'pass'}));
}catch(error){
  await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:'failed',error:error.message}));
  console.error(error);process.exitCode=1;
}
