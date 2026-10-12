import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {combatIntent} from '../../tools/mech_authoring/combat_intent.mjs';
const root=process.cwd(),out=path.join(root,'out/weapon_revision');
await mkdir(out,{recursive:true});
const run=async(label,exe,args)=>{
  const log=createWriteStream(path.join(out,label+'.log'));
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd:root,env:process.env,windowsHide:true});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    child.on('error',reject);child.on('exit',resolve);
  });
  await new Promise(resolve=>log.end(resolve));
  if(code!==0)throw Error(label+' failed ('+code+')');
  console.log('FINISHED '+label);
};
const native=(label,script,extra=[])=>run(label,process.env.BLENDER_BIN,['--background','--factory-startup','--python-exit-code','1','--python',script,...extra]);
try{
  if(!process.argv.includes('--validate')){
    const intent=combatIntent(await readFile('docs/art_gen.md','utf8'),await readFile('docs/ability-vfx-direction.md','utf8'));
    const intentFile=path.join(out,'intent.json');await writeFile(intentFile,JSON.stringify(intent));
    const focus=['t08','m04','s03','t06','m05','m08'];
    const jobs=[];
    for(const contract of ['assets.json','morphers.json']){
      if(process.argv.includes('--morph-only')&&contract!=='morphers.json')continue;
      const specs=JSON.parse(await readFile('tools/mech_authoring/'+contract,'utf8')).assets;
      for(const id of Object.keys(specs))if(!process.argv.includes('--focus')||focus.includes(id))jobs.push({id,contract});
    }
    for(const combat of [false,true]){
      await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:combat?'combat-build':'body-build',status:'running'}));
      let cursor=0;
      await Promise.all(Array.from({length:4},async()=>{
        while(cursor<jobs.length){const {id,contract}=jobs[cursor++];
          await native((combat?'combat-':'body-')+id,'tools/mech_authoring/build.py',['--','--asset',id,'--contract',contract,'--no-render',...(combat?['--combat','--combat-data',intentFile]:[])]);
        }
      }));
    }
  }
  if(process.argv.includes('--validate')){
    const stages=[
      ['equipment','tools/audit_mech_equipment.mjs',['--output',path.join(out,'equipment')]],
      ['biped','tools/audit_biped_posture.mjs'],
      ['sample-motion','tools/mech_authoring/author_motion.mjs'],
      ['bake-motion','tools/mech_authoring/bake_motion.py',['--','--actions-only']],
      ['verify-motion','tools/mech_authoring/verify_motion.py'],
      ['export-motion','tools/audit_baked_motion.mjs'],
      ['verify-base','tools/mech_authoring/verify.py'],
      ['verify-morph','tools/mech_authoring/verify_morph.py'],
      ['verify-combat','tools/mech_authoring/verify_combat.py'],
      ['attachments','tools/audit_limb_grips.mjs'],
      ['reference-base','tools/audit_reference_mechs.mjs',['--output',path.join(out,'reference-base')]],
      ['reference-morph','tools/audit_reference_morph.mjs'],
      ['anatomical','tools/audit_anatomical_motion.mjs'],
      ['combat','tools/audit_combat_actions.mjs'],
      ['syntax','tools/audit_client_syntax.mjs'],
    ];
    const from=process.argv.indexOf('--from');let begin=from<0;
    for(const [label,script,extra=[]] of stages){
      if(label===process.argv[from+1])begin=true;if(!begin)continue;
      await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:label,status:'running'}));
      if(label==='sample-motion'){
        const ids=[];for(const contract of ['assets.json','morphers.json'])ids.push(...Object.keys(JSON.parse(await readFile('tools/mech_authoring/'+contract)).assets));
        const groups=Array.from({length:4},(_,i)=>ids.filter((_,index)=>index%4===i));
        await Promise.all(groups.map((group,i)=>run('sample-'+i,process.execPath,[script,'--asset',group.join(',')])));
        const metrics={};for(const id of ids)metrics[id]=JSON.parse(await readFile('out/anatomical_motion/after/'+id+'.json')).metrics;
        const sources={};for(const file of ['locomotion.js','anatomicalPose.js','forge/referenceAsset.js','forge/forge.js','gaitcurve.js','unitMotion.js','models.js'])sources[file]=createHash('sha256').update(await readFile('public/js/'+file)).digest('hex');
        await writeFile('out/anatomical_motion/after/validation.json',JSON.stringify({sources,metrics},null,2));
      }else if(label==='bake-motion'){
        const ids=[];for(const contract of ['assets.json','morphers.json'])ids.push(...Object.keys(JSON.parse(await readFile('tools/mech_authoring/'+contract)).assets));
        const pending=[];
        for(const id of ids){
          let report;for(const directory of ['mech_reference','morph_reference'])try{report=JSON.parse(await readFile('out/'+directory+'/'+id+'/validation.json'));break;}catch{}
          const hash=createHash('sha256').update(await readFile('out/anatomical_motion/after/'+id+'.json')).digest('hex');
          if(report.motionSource?.samples!==hash)pending.push(id);
        }
        const groups=Array.from({length:4},(_,i)=>pending.filter((_,index)=>index%4===i));
        await Promise.all(groups.filter(group=>group.length).map((group,i)=>native('bake-'+i,script,['--','--actions-only',...group])));
      }else if(script.endsWith('.py'))await native(label,script,extra);else await run(label,process.execPath,[script,...extra]);
    }
  }
  await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:'complete',status:'pass'}));
}catch(error){await writeFile(path.join(out,'stage.json'),JSON.stringify({stage:'failed',error:error.message}));console.error(error);process.exitCode=1;}
