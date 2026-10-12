import json, math, re, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
baseline = json.loads((ROOT/'out/limb_grip_review/baseline.json').read_text())
for source in ['tools/mech_authoring/assets.json','tools/mech_authoring/morphers.json','tools/mech_authoring/catalog.py','tools/mech_authoring/morph_recipe.py','tools/mech_authoring/build.py','public/js/locomotion.js','public/js/anatomicalPose.js']:
    target = ROOT/'out/limb_grip_review/before'/source
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists(): shutil.copy2(ROOT/source,target)
for file in ['assets.json','morphers.json']:
    path = ROOT/'tools/mech_authoring'/file
    contract = json.loads(path.read_text())
    original=json.loads((ROOT/'out/limb_grip_review/before/tools/mech_authoring'/file).read_text())
    if file=='morphers.json':
        contract['requirements']['limbAttachments']='Shoulder, pelvic and coxal roots remain visible outside the sealed core in both forms; the flight belly does not conceal proximal articulation.'
    for id, spec in contract['assets'].items():
        positions = {n: p for n, _, p in spec['joints']}
        if spec.get('recipe') != 'octopod':
            for measurement in baseline[id]['roots']:
                name = measurement['node']
                if not re.fullmatch(r'(shoulder_[lr]|hip_[lr]|leg_[FMH][LR])',name): continue
                margin = max(.075,spec['parameters'].get('limb',.32)*.28)
                if measurement['exposed'] is None or measurement['exposed'] >= margin: continue
                shift = math.ceil((margin-measurement['exposed'])*100)/100
                sign = 1 if positions[name][0] > 0 else -1
                prior={n:p for n,_,p in original['assets'][id]['joints']}
                positions[name][0] = round(prior[name][0]+sign*shift,5)
                for form_name,form in spec.get('forms',{}).items():
                    at = form['transforms'].get(name,{}).get('position')
                    before=original['assets'][id]['forms'][form_name]['transforms'].get(name,{}).get('position')
                    if at and before: at[0] = round(before[0]+sign*shift,5)
        for h in spec['rig'].get('heldWeapons',[]):
            if h.get('grip'): continue
            receiver = next(x for x in baseline[id]['held'] if x['node']==h['node'])
            lift = 0 if h.get('staff') else round(max(.38,-receiver['receiverBottom']+.20),3)
            anchor = [0,-lift,-.10] if lift else [0,0,0]
            h.update(grip='grip_'+h['node'],contact=[0,-.12,.10],gripLength=max(.46,lift+.22))
            tip = positions[h.get('forearmTip',h['hand'])]
            pitch = math.atan2(-tip[1],tip[2])
            rotated = [0,anchor[1]*math.cos(pitch)-anchor[2]*math.sin(pitch),anchor[1]*math.sin(pitch)+anchor[2]*math.cos(pitch)]
            positions[h['node']][:] = [round(h['contact'][i]-rotated[i],5) for i in range(3)]
            for form in spec.get('forms',{}).values():
                form['transforms'].setdefault(h['node'],{})['position'] = positions[h['node']][:]
            index = next(i for i,j in enumerate(spec['joints']) if j[0]==h['node'])
            spec['joints'].insert(index+1,[h['grip'],h['node'],anchor])
        for rig in [spec['rig'],*(f['rig'] for f in spec.get('forms',{}).values())]:
            for w in rig.get('wings',[]):
                if w.get('hand'):
                    w['membrane'] = spec.get('recipe') in ['pterosaur','dragon']
        wing_baseline=json.loads((ROOT/'out/limb_grip_review/wing-baseline.json').read_text()) if (ROOT/'out/limb_grip_review/wing-baseline.json').exists() else {}
        for row in wing_baseline.get(id,[]):
            if row['exposure'] is None or row['exposure'] >= .08: continue
            shift=math.ceil((.08-row['exposure'])*100)/100
            name=row['root']
            prior={n:p for n,_,p in original['assets'][id]['joints']}
            sign=1 if row['x']>0 else -1
            positions[name][0]=round(prior[name][0]+sign*shift,5)
        if file=='morphers.json' and (ROOT/'out/limb_grip_review/flight-baseline.json').exists():
            flight=json.loads((ROOT/'out/limb_grip_review/flight-baseline.json').read_text())[id]
            for row in flight:
                name=row['root']
                prior=original['assets'][id]['forms']['flight']['transforms'].get(name,{}).get('position')
                if row['exposure'] is None or not prior:continue
                margin=max(.075,spec['parameters'].get('limb',.32)*.28)
                shift=max(0,math.ceil((margin-row['exposure'])*100)/100)
                sign=1 if row['x']>0 else -1
                spec['forms']['flight']['transforms'][name]['position'][0]=round(prior[0]+sign*shift,5)
            if spec.get('cavity'):
                spec['acceptance']['flightExposedRoots']=list(dict.fromkeys(spec['cavity']['roots']+spec['acceptance'].get('flightExposedRoots',[])))
                spec['cavity']['roots']=[]
    path.write_text(json.dumps(contract,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
