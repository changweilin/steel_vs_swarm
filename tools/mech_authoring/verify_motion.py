"""Independently reopen baked scenes and compare their actual actions with runtime samples."""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / 'out/anatomical_motion/after'
axis = Quaternion((1, 0, 0), math.pi / 2)
selected = set(sys.argv[sys.argv.index('--') + 1:]) if '--' in sys.argv else set()
evidence = SAMPLES / 'blender-validation.json'
results = json.loads(evidence.read_text(encoding='utf8')) if selected and evidence.exists() else {}
for file in sorted(SAMPLES.glob('*.json')):
    if not re.fullmatch(r'[stm]\d{2}', file.stem):
        continue
    if selected and file.stem not in selected:
        continue
    sampled = json.loads(file.read_text(encoding='utf8'))
    id = sampled['id']
    directory = ROOT / 'out/morph_reference' / id
    if not (directory / (id + '.blend')).exists():
        directory = ROOT / 'out/mech_reference' / id
    report = json.loads((directory / 'validation.json').read_text(encoding='utf8'))
    if 'motionSource' not in report:
        continue
    sample_hash = hashlib.sha256(file.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(directory / (id + '.blend')))
    nodes = {name: bpy.data.objects[name] for name in report['motionSource']['nodes']}
    count, error = 0, 0
    verified_clips = []
    for clip, data in sampled['clips'].items():
        if clip not in report['motionSource']['clips']:
            continue
        if not any(track.name == clip for track in next(iter(nodes.values())).animation_data.nla_tracks):
            continue
        verified_clips.append(clip)
        for obj in nodes.values():
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = True
                if track.name == clip:
                    obj.animation_data.action = track.strips[0].action
                    obj.animation_data.action_slot = track.strips[0].action_slot
        for frame in range(1, len(data['frames']) + 1):
            bpy.context.scene.frame_set(frame)
            for name, position, rotation, scale in data['frames'][frame - 1]:
                if name.startswith('fx_'):
                    continue
                obj = nodes[name]
                expected_position = Vector((position[0], -position[2], position[1]))
                expected_q = axis @ Quaternion((rotation[3], rotation[0], rotation[1], rotation[2])) @ axis.inverted()
                actual_q = obj.matrix_basis.to_quaternion()
                angular = 1 - abs(actual_q.dot(expected_q))
                drift = (obj.location - expected_position).length
                assert angular < 2e-6 and drift < 2e-5, f'{id}/{clip}/{frame}/{name}: baked joint differs from runtime'
                assert all(math.isfinite(v) for row in obj.matrix_world for v in row), id + ': invalid world matrix'
                error = max(error, drift)
                count += 1
    report['gates']['editable_source'] = 'pass'
    report['gates']['motion'] = 'pass_structural'
    # Only a complete transform comparison can refresh evidence after equivalent driver changes.
    report['motionSource']['samples'] = sample_hash
    report['motionSource']['clips'] = verified_clips
    report['motionSource']['drivers'] = json.loads((SAMPLES / 'validation.json').read_text(encoding='utf8'))['sources']
    (directory / 'validation.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    results[id] = {'jointSamples': count, 'maximumPivotError': error, 'blend': report['hashes']['blend'],
                   'clips': verified_clips, 'samples': sample_hash}
    print('MOTION_VERIFIED ' + id, flush=True)
evidence.write_text(json.dumps(results, indent=2), encoding='utf8')
