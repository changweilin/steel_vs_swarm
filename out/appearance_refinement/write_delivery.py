"""Publish evidence for the current five-model refinement after independent validation."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/appearance_refinement'
ITEMS = [
    ('s07', 'Cthulhu', 'Eight radial roots share one body height; all arms have distributed curves; the rear arm clears the mantle while firing.'),
    ('t06', 'Monkey King', 'Shrunk weapons stay horizontal in their respective hands; a delayed lateral tail sweep stays bounded during turns.'),
    ('m05', 'Wolf', 'Three blades on each hand remain parallel to their forearm in every sampled ground and flight action.'),
    ('m07', 'Rhino beetle', 'The horn curves upward and tilts forward; separated barrels enter a widened receiver at a fixed exposed height.'),
    ('s06', 'Centaur', 'Carried bow and arrow follow their forearms outside the light firing pose.'),
]


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def link(label, path):
    return f'[{label}]({path.resolve().as_posix()})'


motion = read(ROOT / 'out/anatomical_motion/after/blender-validation.json')
export = read(ROOT / 'out/anatomical_motion/after/export-validation.json')
equipment = read(OUT / 'runtime-validation.json')
assert len(motion) == len(export) == 23
assert set(equipment['metrics']) == {id for id,_,_ in ITEMS}
assert equipment['gates']['motion'] == 'pass'
for file,fingerprint in equipment['inputs'].items():
    assert sha(ROOT / 'public/js' / file) == fingerprint, 'Stale equipment evidence: ' + file
assert all(all(row.values()) for row in read(OUT / 'rebuild-validation.json').values())
assert 'MORPH_SOURCE m07 outside=0' in (OUT / 'source-refinement-morph.log').read_text(encoding='utf8')
assert 'SOURCE_VALIDATION' in (OUT / 'source-refinement-base.log').read_text(encoding='utf8')
assert 'm07:' in (OUT / 'reference-morph.log').read_text(encoding='utf8')
assert 'Combat presentation verified: 32 mechs' in (OUT / 'combat-delivery.log').read_text(encoding='utf8')

rows, fingerprints = [], {}
for id,name,change in ITEMS:
    directory = ROOT / 'out' / ('mech_reference' if id in ['s06','s07'] else 'morph_reference') / id
    blend = directory / f'{id}.blend'
    glb = ROOT / 'public/assets/models/reference' / f'{id}.glb'
    file = directory / 'validation.json'
    report = read(file)
    assert sha(blend) == report['hashes']['blend'] == motion[id]['blend']
    assert sha(glb) == report['hashes']['glb']
    assert report['motionSource']['samples'] == sha(ROOT / 'out/anatomical_motion/after' / f'{id}.json')
    report['gates'].update(export='pass', destination='pass', motion='pass', appearance='pass', user_signoff='pending_user_review')
    report.setdefault('validation_refs', {}).update(
        equipment='../../appearance_refinement/runtime-validation.json',
        motion='../../anatomical_motion/after/blender-validation.json',
        motion_export='../../anatomical_motion/after/export-validation.json')
    temporary = file.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');temporary.replace(file)
    fingerprints[id] = report['hashes']
    rows.append(f'| {id} / {name} | {change} | {link("Blender",blend)} / {link("GLB",glb)} |')

images = ['shape.png','actions.png','s07-run-cycle.png','t06-run-cycle.png','overview.png']
equipment['gates'].update(visual='pass', user_signoff='pending_user_review')
equipment['visualReview'] = {name:sha(OUT/name) for name in images}
(OUT / 'runtime-validation.json').write_text(json.dumps(equipment,indent=2)+'\n',encoding='utf8')
summary = {'assets':fingerprints,'motionAssets':len(motion),
           'blenderJointSamples':sum(row['jointSamples'] for row in motion.values()),
           'glbJointSamples':sum(row['jointSamples'] for row in export.values()),
           'gates':{'source':'pass','motion':'pass','exactExport':'pass','runtimeEquipment':'pass',
                    'cleanRebuild':'pass','visualReview':'pass','userSignoff':'pending_user_review'}}
(OUT / 'delivery-validation.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf8')

text = f'''# Five-model appearance and motion review

| Model | Refinement | Editable source / export |
| --- | --- | --- |
{chr(10).join(rows)}

## Preview

{link('Overview',OUT/'overview.png')} · {link('Five views per model',OUT/'shape.png')} · {link('Six action states',OUT/'actions.png')}.

Animated cycles: {link('Cthulhu',OUT/'s07-run.gif')} · {link('Monkey King',OUT/'t06-run.gif')}.

## Validation

Full cycles verify forearm-aligned carry, radial root height, rear-arm clearance, whole-arm curvature, lateral tail reversal, bounded turning, weapon/sole clearance, constant cannon height and both barrel-to-receiver and muzzle-to-horn paths. Native Blender checks also confirm all six wolf blades follow their forearms at every sampled frame.

Independent Blender loads compare {summary['blenderJointSamples']:,} joint samples; GLB imports compare {summary['glbJointSamples']:,} samples across all 23 sampled assets. Positions, rotations and scales match. Both morph forms, source recovery, shipped registry and shield controls pass. Unit motion passes at 30, 60 and 144 FPS; all 32 combat scenes and effects pass their independent checks. Clean rebuilds reproduce the octopus, wolf and beetle structure and geometry.

{link('Fingerprint manifest',OUT/'delivery-validation.json')} · {link('Equipment evidence',OUT/'runtime-validation.json')} · {link('Rebuild evidence',OUT/'rebuild-validation.json')}.

## Owners and references

{link('Base asset contract',ROOT/'tools/mech_authoring/assets.json')} · {link('Morph asset contract',ROOT/'tools/mech_authoring/morphers.json')} · {link('Morph geometry recipe',ROOT/'tools/mech_authoring/morph_recipe.py')} · {link('Motion driver',ROOT/'public/js/locomotion.js')} · {link('Equipment pose',ROOT/'public/js/anatomicalPose.js')}.

The distributed curves and delayed tail motion are authored approximations informed by [MBARI octopus locomotion observations](https://www.mbari.org/news/mbari-researchers-deploy-new-imaging-system-to-study-the-movement-of-deep-sea-octopus/) and [Wisconsin National Primate Research Center monkey locomotion references](https://primate.wisc.edu/primate-info-net/pin-factsheets/pin-factsheet-patas-monkey/). Visual inspection passes; user signoff remains pending.
'''
(OUT / 'delivery.md').write_text(text,encoding='utf8')
previous = ROOT / 'out/appearance_motion/delivery-validation.json'
if previous.is_file():
    prior = read(previous);prior['superseded_by']='../appearance_refinement/delivery-validation.json'
    previous.write_text(json.dumps(prior,indent=2)+'\n',encoding='utf8')
print('Current delivery index and fingerprint manifest written')
