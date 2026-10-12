import {spawn} from 'node:child_process';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out='out/weapon_revision',ids=['m01','s03','s10','t06','t11','m05','m07','m08'];
const asset=file=>readFile(file,'utf8').then(text=>JSON.parse(text.split('export default ')[1].trim().replace(/;$/,'')));
const run=async(label,exe,args)=>{
 await writeFile(out+'/stage.json',JSON.stringify({stage:label,status:'running'}));
 const log=createWriteStream(out+'/'+label+'.log');
 const code=await new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd:process.cwd(),env:process.env,windowsHide:true});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('error',reject);child.on('exit',resolve);});
 await new Promise(resolve=>log.end(resolve));if(code)throw Error(label+' failed ('+code+')');console.log('FINISHED '+label);
};
const js=(label,script,args=[])=>run(label,process.execPath,[script,...args]);
const py=(label,script,args=[])=>run(label,process.env.BLENDER_BIN,['--background','--factory-startup','--python-exit-code','1','--python',script,...(args.length?['--',...args]:[])]);
try{
 const reuse={};
 for(const id of ids){
  const before=await asset(out+'/morph-forward-before/'+id+'.js'),after=await asset('public/js/forge/assets/'+id+'.js');
  delete before.source;delete after.source;
  if(id==='s03'){assert.equal(before.rig.wpn.light.aimJoint,'trunk_0');assert.equal(after.rig.wpn.light.aimJoint,'trunk_5');before.rig.wpn.light.aimJoint='trunk_5';}
  assert.deepEqual(after,before,'Unrelated runtime change: '+id);reuse[id]=id==='s03'?'resample distal aim control':'identical geometry, rig and motion';
 }
 await writeFile(out+'/reuse-validation.json',JSON.stringify({gate:'pass',assets:reuse},null,2));
 await copyFile('out/anatomical_motion/after/export-validation.json',out+'/export-before-forward.json');
 const reusedExportHashes={};for(const id of Object.keys(JSON.parse(await readFile(out+'/export-before-forward.json'))))if(!ids.includes(id))reusedExportHashes[id]=createHash('sha256').update(await readFile('public/assets/models/reference/'+id+'.glb')).digest('hex');
 await writeFile(out+'/reused-export-hashes.json',JSON.stringify(reusedExportHashes,null,2));
 await copyFile('out/limb_grip_review/runtime/validation.json',out+'/attachments-before-forward.json');
 await js('sample-forward','tools/mech_authoring/author_motion.mjs',['--asset','s03']);
 await Promise.all(Array.from({length:4},(_,i)=>py('bake-forward-'+i,'tools/mech_authoring/bake_motion.py',['--actions-only',...ids.filter((_,index)=>index%4===i)])));
 await py('verify-forward','tools/mech_authoring/verify_motion.py',ids);
 await py('verify-morph','tools/mech_authoring/verify_morph.py');
 await py('verify-combat','tools/mech_authoring/verify_combat.py');
 await js('export-forward','tools/audit_baked_motion.mjs',['--asset',ids.join(',')]);
 const previousExports=JSON.parse(await readFile(out+'/export-before-forward.json')),exports=JSON.parse(await readFile('out/anatomical_motion/after/export-validation.json'));
 for(const [id,hash]of Object.entries(reusedExportHashes))assert.equal(hash,createHash('sha256').update(await readFile('public/assets/models/reference/'+id+'.glb')).digest('hex'),'Changed reused export: '+id);
 await writeFile('out/anatomical_motion/after/export-validation.json',JSON.stringify({...previousExports,...exports},null,2));
 await js('equipment','tools/audit_mech_equipment.mjs',['--output',out+'/equipment']);
 await js('attachments-forward','tools/audit_limb_grips.mjs',['--asset',ids.join(',')]);
 const oldAttachments=JSON.parse(await readFile(out+'/attachments-before-forward.json')),attachments=JSON.parse(await readFile('out/limb_grip_review/runtime/validation.json'));
 for(const [id,entry]of Object.entries(oldAttachments.assets))if(!ids.includes(id))for(const [file,hash]of Object.entries(entry.hashes))assert.equal(hash,createHash('sha256').update(await readFile(file)).digest('hex'),'Changed reused attachment: '+id);
 attachments.assets={...oldAttachments.assets,...attachments.assets};await writeFile('out/limb_grip_review/runtime/validation.json',JSON.stringify(attachments,null,2));
 await js('weapon-audit','tools/audit_weapon_presentation.mjs');
 await js('reference-morph','tools/audit_reference_morph.mjs');
 await js('anatomical','tools/audit_anatomical_motion.mjs');
 await js('combat','tools/audit_combat_actions.mjs');
 await js('syntax','tools/audit_client_syntax.mjs');
 await writeFile(out+'/stage.json',JSON.stringify({stage:'complete',status:'pass'}));
}catch(error){await writeFile(out+'/stage.json',JSON.stringify({stage:'failed',error:error.message}));console.error(error);process.exitCode=1;}
