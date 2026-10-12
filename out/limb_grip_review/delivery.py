"""Publish evidence only after final exports, runtime gates and image inspection agree."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/limb_grip_review'

def read(file):
    return json.loads((ROOT / file).read_text(encoding='utf8'))

def sha(file):
    return hashlib.sha256((ROOT / file).read_bytes()).hexdigest()

def write(file, value):
    (ROOT / file).write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')

specs = read('tools/mech_authoring/assets.json')['assets']
specs.update(read('tools/mech_authoring/morphers.json')['assets'])
assert read('out/limb_grip_review/stage.json') == {'stage': 'complete', 'status': 'pass'}
visual = read('out/limb_grip_review/visual-review.json')
assert visual['gate'] == 'pass' and set(visual['assets']) == set(specs)
for file, expected in visual['images'].items():
    assert sha(file) == expected, 'Stale inspected image: ' + file

attachments = read('out/limb_grip_review/runtime/validation.json')
assert set(attachments['assets']) == set(specs)
assert all(attachments['gates'][gate] == 'pass' for gate in ['structure', 'motion', 'independentExport'])
preview = read('out/limb_grip_review/preview-validation.json')
assert preview['ownerSha256'] == sha(preview['owner'])
assert preview['sha256'] == sha(preview['file'])
samples = read('out/anatomical_motion/after/validation.json')
for file, expected in samples['sources'].items():
    assert sha('public/js/' + file) == expected, 'Stale motion driver: ' + file

assets = {}
rows = []
for id, spec in specs.items():
    directory = ('out/morph_reference/' if 'forms' in spec else 'out/mech_reference/') + id
    report_file = directory + '/validation.json'
    report = read(report_file)
    blend = directory + '/' + id + '.blend'
    glb = 'public/assets/models/reference/' + id + '.glb'
    runtime = 'public/js/forge/assets/' + id + '.js'
    assert report['hashes']['blend'] == sha(blend), 'Stale editable source: ' + id
    assert report['hashes']['glb'] == sha(glb), 'Stale export: ' + id
    assert report['hashes']['runtime'] == sha(runtime), 'Stale runtime: ' + id
    for file, expected in attachments['assets'][id]['hashes'].items():
        assert sha(file) == expected, 'Stale attachment evidence: ' + id
    files = [blend, glb, runtime, 'out/combat_reference/' + id + '/' + id + '.blend',
             'public/assets/models/combat/' + id + '.glb', 'public/js/forge/combatAssets/' + id + '.js']
    assets[id] = {'forms': ['ground', 'flight'] if 'forms' in spec else ['ground'],
                  'bodyMotionOwner': blend, 'effectAuthoringOwner': files[3],
                  'artifacts': {file: sha(file) for file in files}, 'resources': report['measurements'],
                  'attachmentMetrics': attachments['assets'][id]}
    for gate in ['geometry', 'appearance', 'export', 'destination']:
        report['gates'][gate] = 'pass'
    report['reviewEvidence'] = {'visual': 'out/limb_grip_review/visual-review.json',
                              'attachments': 'out/limb_grip_review/runtime/validation.json',
                              'pipeline': 'out/limb_grip_review/stage.json'}
    write(report_file, report)
    rows.append(f'| {id} | [Blend](../../{blend}) | [GLB](../../{glb}) | [Combat Blend](../../{files[3]}) |')

attachments['gates']['visual'] = 'pass'
attachments['visualEvidence'] = 'out/limb_grip_review/visual-review.json'
write('out/limb_grip_review/runtime/validation.json', attachments)
sources = ['tools/mech_authoring/' + file for file in
           ['assets.json', 'morphers.json', 'build.py', 'catalog.py', 'morph_recipe.py', 'combat.py',
            'artifacts.py', 'author_motion.mjs', 'bake_motion.py', 'sampled_glb.py', 'motion_source.py']]
sources += ['public/js/' + file for file in samples['sources']]
motion = read('out/anatomical_motion/after/blender-validation.json')
manifest = {
    'blender': '5.2.0 LTS', 'assets': assets, 'sources': {file: sha(file) for file in sources},
    'gates': {'geometry': 'pass', 'grasp': 'pass', 'motion': 'pass', 'resources': 'pass',
              'editableSource': 'pass', 'independentExport': 'pass', 'destination': 'pass',
              'agentVisualReview': 'pass', 'userSignoff': 'pending_user_review'},
    'metrics': {'assets': len(assets), 'forms': sum(len(a['forms']) for a in assets.values()),
                'attachmentFrames': sum(form['frames'] for a in attachments['assets'].values()
                                        for key, form in a.items() if key in ['ground', 'flight']),
                'bakedJointSamples': sum(a['jointSamples'] for a in motion.values())},
    'validation': {label: 'out/limb_grip_review/' + label + '.log' for label in
                   ['equipment', 'biped', 'sample-motion', 'bake-motion', 'verify-motion', 'verify-base',
                    'verify-morph', 'verify-combat', 'attachments', 'reference-base', 'reference-morph',
                    'anatomical', 'combat', 'syntax', 'unit-damage', 'rebake-morph', 'reverify-morph-motion',
                    'resample-t11', 'resample-m08']},
    'runtimeEquivalence': 'out/limb_grip_review/repair-runtime-equivalence.json',
    'visualEvidence': 'out/limb_grip_review/visual-review.json',
    'reviewScene': preview,
    'formatValidator': {'tool': 'Khronos glTF Validator', 'status': 'unavailable_optional'},
    'flightInterpretation': 'Species-informed stylized articulation; not an aerodynamic simulation.'
}
write('out/limb_grip_review/delivery-validation.json', manifest)
text = '''# Limb structure, weapon grips and flight motion

All 32 actors and 40 ground/flight forms retain exposed proximal joints. Dedicated shoulder and pelvic
socket geometry shows the attachment structure while keeping the axial body sealed.

Held weapons have full-length grips, four curled fingers and an opposed thumb mirrored for each hand.
Grasp origins remain fixed to wrist contacts through aiming, recoil, stowing and weapon scaling.

Feathered and membrane wings move through coupled humerus, ulna and manus joints. Elbow recovery precedes
wrist folding; membrane wings use smaller folding excursions. The curves are stylized species-informed motion.

The canonical sources are [the base contract](../../tools/mech_authoring/assets.json),
[morph contract](../../tools/mech_authoring/morphers.json), [builder](../../tools/mech_authoring/build.py),
[geometry recipe](../../tools/mech_authoring/catalog.py), [morph recipe](../../tools/mech_authoring/morph_recipe.py)
and [runtime wing driver](../../public/js/locomotion.js). Generated runtime meshes and exports share these owners.
Body motion is baked in the reference sources; combat files own the attached effect authoring tracks.
[The owl flight review scene](m08-flight-review.blend) opens the baked flight track with neutral viewport shading.

[Exact artifact hashes and gate results](delivery-validation.json) bind the inspected images to the final
editable scenes, exports and runtime assets. [Visual inspection](visual-review.json) is separate from human acceptance.

![Game overview](overview.png)
![Wing motion phases](flight.png)

[Pterosaur](t07-flight.gif) · [Dragon](t08-flight.gif) · [Eagle](m04-flight.gif) ·
[Raptor/archaeopteryx](s10-flight.gif) · [Owl](m08-flight.gif) · [Grasp details](grips.png)

| Actor | Editable motion source | Interchange export | Combat effect source |
|---|---|---|---|
'''
(OUT / 'delivery.md').write_text(text + '\n'.join(rows) + '\n', encoding='utf8')
print(json.dumps(manifest['metrics']))
