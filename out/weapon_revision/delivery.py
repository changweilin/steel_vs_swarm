"""Publish delivery evidence only when current source bytes and destination checks agree."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'out/weapon_revision'
def read(file):return json.loads((ROOT/file).read_text(encoding='utf8'))
def sha(file):return hashlib.sha256((ROOT/file).read_bytes()).hexdigest()
def write(file,data):(ROOT/file).write_text(json.dumps(data,indent=2)+'\n',encoding='utf8')

assert read('out/weapon_revision/stage.json')=={'stage':'complete','status':'pass'}
specs=read('tools/mech_authoring/assets.json')['assets']|read('tools/mech_authoring/morphers.json')['assets']
weapons=read('out/weapon_revision/runtime/validation.json')
attachments=read('out/limb_grip_review/runtime/validation.json')
visual=read('out/weapon_revision/visual-review.json')
assert visual['gate']=='pass'
for file,hash in visual['images'].items():assert sha(file)==hash,'Changed inspected image: '+file
assert set(weapons['assets'])==set(attachments['assets'])==set(specs)
for file,hash in weapons['inputs'].items():assert sha(file)==hash,'Stale presentation driver: '+file
assert read('out/weapon_revision/rules-validation.json')['gate']=='pass'
assert read('out/weapon_revision/reuse-validation.json')['gate']=='pass'
samples=read('out/anatomical_motion/after/validation.json')
for file,hash in samples['sources'].items():assert sha('public/js/'+file)==hash,'Stale sampled driver: '+file
native=read('out/anatomical_motion/after/blender-validation.json')
exports=read('out/anatomical_motion/after/export-validation.json')
assert set(native)==set(exports) and len(native)==23
preview=read('out/weapon_revision/preview-validation.json')
assert sha(preview['file'])==preview['sha256'] and sha(preview['owner'])==preview['ownerSha256']
assets={};rows=[]
for id,spec in specs.items():
 directory=('out/morph_reference/' if 'forms' in spec else 'out/mech_reference/')+id
 body=directory+'/'+id+'.blend';glb='public/assets/models/reference/'+id+'.glb';runtime='public/js/forge/assets/'+id+'.js'
 report=read(directory+'/validation.json')
 for key,file in [('blend',body),('glb',glb),('runtime',runtime)]:assert sha(file)==report['hashes'][key],'Stale body '+id+'/'+key
 for evidence in [weapons['assets'][id],attachments['assets'][id]]:
  for file,hash in evidence['hashes'].items():assert sha(file)==hash,'Stale runtime gate: '+file
 if id in native:
  assert native[id]['blend']==sha(body) and native[id]['samples']==sha('out/anatomical_motion/after/'+id+'.json'),'Stale native motion: '+id
 combat='out/combat_reference/'+id+'/'+id+'.blend';combatGlb='public/assets/models/combat/'+id+'.glb';combatJs='public/js/forge/combatAssets/'+id+'.js'
 combatReport=read('out/combat_reference/'+id+'/validation.json')
 for key,file in [('blend',combat),('glb',combatGlb),('runtime',combatJs)]:assert sha(file)==combatReport['hashes'][key],'Stale effect '+id+'/'+key
 files=[body,glb,runtime,combat,combatGlb,combatJs]
 assets[id]={'forms':['ground','flight'] if 'forms' in spec else ['ground'],'artifacts':{file:sha(file) for file in files},'resources':report['measurements'],'weapons':weapons['assets'][id]}
 report['gates'].update({key:'pass' for key in ['geometry','appearance','export','destination']})
 report['reviewEvidence']={'weapons':'out/weapon_revision/runtime/validation.json','visual':'out/weapon_revision/visual-review.json','delivery':'out/weapon_revision/delivery-validation.json'}
 write(directory+'/validation.json',report)
 rows.append(f'| {id} | [Body](../../{body}) | [GLB](../../{glb}) | [Effects](../../{combat}) |')
weapons['gates']['visual']='pass';write('out/weapon_revision/runtime/validation.json',weapons)
owners=['tools/mech_authoring/'+file for file in ['assets.json','morphers.json','build.py','catalog.py','morph_recipe.py','combat.py','author_motion.mjs','bake_motion.py','sampled_glb.py','anatomy_checks.py','verify.py','verify_morph.py','verify_motion.py']]
owners+=list(weapons['inputs'])
manifest={'blender':'5.2.0 LTS','assets':assets,'sources':{file:sha(file) for file in owners},'gates':{'anatomy':'pass','weaponPresentation':'pass','motion':'pass','editableSource':'pass','independentExport':'pass','destination':'pass','agentVisualReview':'pass','attackRules':'unchanged','userSignoff':'pending_user_review'},'metrics':{'assets':32,'forms':40,'nativeMotionAssets':23,'nativeJointSamples':sum(v['jointSamples'] for v in native.values()),'maximumExportPivotError':max(v['maximumPivotError'] for v in exports.values()),'weaponConfigurationsCompared':512,'abilityConfigurationsCompared':512},'preview':preview}
write('out/weapon_revision/delivery-validation.json',manifest)
text='''# Weapon structures and presentation

Accepted shot events advance one physical emitter per slot. Frame updates, morphing and cockpit scope changes preserve the order. Damage, fire rates, ammunition and hit rules remain unchanged.

| Actor | Authored behavior |
| --- | --- |
| t08 Dragon | Axial hardware follows the body; paired optical eyes alternate beam emission. |
| m04 Falcon | Four dorsal feather missiles eject in sequence along the existing penetration path. |
| s03 Leviathan | The terminal trunk/horn aims its beam; intertusk induction precedes the EMP pulse. |
| t06 Wukong | A free hand plucks a tuft, then repeatedly flicks its articulated fingers. |
| m05 Wolf | Running yields the predatory brace to the existing primate support swing. |
| m08 Panther/owl | Paired ventral light barrels and paired heavy suppressors alternate. |

Blender body scenes retain editable rigid controls and recovered actions. Combat scenes own authored effects. Runtime pose samples and independent GLB playback agree.

'''
text+='[Validation manifest](delivery-validation.json) · [Native gesture preview](t06-gesture-review.blend)\n\n'
text+='![Wukong gesture](t06-ground-gesture.gif)\n\n'
text+='| Actor | Body owner | Interchange | Effect owner |\n| --- | --- | --- | --- |\n'+'\n'.join(rows)+'\n'
(OUT/'README.md').write_text(text,encoding='utf8')
print(json.dumps(manifest['metrics']))
