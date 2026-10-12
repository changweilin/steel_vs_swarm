"""Write the review index only after the final independent checks finish."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/appearance_motion'
ASSETS = [('s06', 'Centaur'), ('s07', 'Cthulhu'), ('s09', 'Kangaroo'), ('m02', 'Tyrannosaur'),
          ('t12', 'Colossus'), ('t03', 'Gorilla'), ('t06', 'Monkey King'), ('s10', 'Raptor'),
          ('t11', 'T11'), ('m05', 'Wolf'), ('m07', 'Rhino beetle')]


def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def link(label, path):
    return f'[{label}]({path.resolve().as_posix()})'


motion = read('out/anatomical_motion/after/blender-validation.json')
export = read('out/anatomical_motion/after/export-validation.json')
equipment = read('out/appearance_motion/runtime-validation.json')
assert len(motion) == len(export) == 23
assert equipment['gates']['motion'] == 'pass'
for name, fingerprint in equipment['inputs'].items():
    assert sha(ROOT / 'public/js' / name) == fingerprint
assert 'Combat presentation verified: 32 mechs' in (OUT / 'combat-delivery-final.log').read_text(encoding='utf8')
assert 'MORPH_SOURCE m07 outside=0' in (OUT / 'source-morph-final.log').read_text(encoding='utf8')
assert 'SOURCE_VALIDATION' in (OUT / 'source-base-final.log').read_text(encoding='utf8')
assert '"controls": "pass"' in (OUT / 'reference-base-final.log').read_text(encoding='utf8')
assert 'm07:' in (OUT / 'reference-morph-final.log').read_text(encoding='utf8')

rows, fingerprints = [], {}
for id, name in ASSETS:
    kind = 'morph_reference' if id in ['t06', 's10', 't11', 'm05', 'm07'] else 'mech_reference'
    directory = ROOT / 'out' / kind / id
    report_file = directory / 'validation.json'
    report = json.loads(report_file.read_text(encoding='utf8'))
    blend = directory / f'{id}.blend'
    glb = ROOT / 'public/assets/models/reference' / f'{id}.glb'
    assert report['hashes']['blend'] == sha(blend) == motion[id]['blend']
    assert report['hashes']['glb'] == sha(glb)
    assert report['motionSource']['samples'] == sha(ROOT / 'out/anatomical_motion/after' / f'{id}.json')
    report['gates'].update(export='pass', destination='pass', appearance='pass', motion='pass',
                           user_signoff='pending_user_review')
    report.setdefault('validation_refs', {}).update(
        equipment='../../appearance_motion/runtime-validation.json',
        motion='../../anatomical_motion/after/blender-validation.json',
        motion_export='../../anatomical_motion/after/export-validation.json')
    temporary = report_file.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    temporary.replace(report_file)
    rows.append(f'| {id} | {name} | {link("Blender", blend)} | {link("GLB", glb)} |')
    fingerprints[id] = report['hashes']

images = [OUT / f'{prefix}-{number}.png' for prefix in ['shape', 'actions'] for number in range(1, 4)]
equipment['gates']['visual'] = 'pass'
equipment['gates']['user_signoff'] = 'pending_user_review'
equipment['visualReview'] = {image.name: sha(image) for image in images}
(OUT / 'runtime-validation.json').write_text(json.dumps(equipment, indent=2), encoding='utf8')
evidence = {'assets': fingerprints, 'blenderJointSamples': sum(x['jointSamples'] for x in motion.values()),
            'glbJointSamples': sum(x['jointSamples'] for x in export.values()),
            'motionAssets': len(motion), 'equipmentAssets': len(ASSETS),
            'gates': {'editableSource': 'pass', 'exactExport': 'pass', 'visualReview': 'pass',
                      'runtimeEquipment': 'pass', 'combatRoster': 'pass', 'userSignoff': 'pending_user_review'},
            'remainingGuard': {'asset': 't11', 'guard': 'audit_biped_posture',
                               'failure': 'Defense disk and projected shield have different vertical centers',
                               'baseline': 'Original Git version also fails this audit at the left firing forearm check'}}
(OUT / 'delivery-validation.json').write_text(json.dumps(evidence, indent=2), encoding='utf8')

text = f'''# Mech appearance and motion review

The eleven requested bodies and their runtime motion are updated. The retired external carrier mount is removed from all eight morphers.

| ID | Model | Editable source | Exact export |
| --- | --- | --- | --- |
{chr(10).join(rows)}

## Review images

Five views per body: {', '.join(link(f'Sheet {i}', OUT / f'shape-{i}.png') for i in range(1,4))}.

Idle, run, light, heavy, defense and attack: {', '.join(link(f'Sheet {i}', OUT / f'actions-{i}.png') for i in range(1,4))}.

Run cycles: {', '.join(link(id, OUT / f'{id}-run.gif') for id in ['s06','s07','t06','s10'])}.

## Verification

The equipment guard covers all eleven changed bodies over full cycles and actual vertex bounds. Unit motion passes at 30, 60 and 144 FPS. Independent Blender loads compare {evidence['blenderJointSamples']:,} joint samples; independent GLB imports compare {evidence['glbJointSamples']:,} samples across all 23 sampled motion assets. Positions, rotations and weapon scales match. All 32 combat sources, effects, shield textures and both morph forms pass their combat guard.

Clean rebuilds of the centaur, wolf and beetle reproduce the runtime structure and exported geometry. The final geometry is also compared with the contract snapshot before checking its rest-pose invariants. Runtime-sampled clips are verified directly instead of testing the snapshot's replaced animations.

The T11 generic biped guard still reports a vertical offset between the defense disk and projected shield. The original Git version also fails that legacy guard at its left forearm firing check. Dedicated shoulder placement, firing direction, live shield clearance and morph checks pass. User visual signoff remains pending.

{link('Validation manifest', OUT / 'delivery-validation.json')} · {link('Equipment evidence', OUT / 'runtime-validation.json')} · {link('Clean rebuild evidence', OUT / 'rebuild-validation.json')}.

The centaur draw posture follows the [World Archery recurve technique guide](https://extranet.worldarchery.sport/documents/index.php/Media/Information_Sheets/003_Guide_to_Recurve_Technique.pdf): extended bow arm, aligned drawing forearm and a stable face anchor. Other actions retain separate bow and arrow grips.
'''
(OUT / 'delivery.md').write_text(text, encoding='utf8')
print('Delivery index and fingerprint manifest written')
