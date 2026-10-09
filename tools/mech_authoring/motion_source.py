"""Keep editable rest transforms independent of the exporter's animation evaluation cache."""
import hashlib
import json
import re
from pathlib import Path

import bpy


def snapshot_rest(nodes):
    return {name: (obj.location.copy(), obj.rotation_euler.copy(), obj.rotation_quaternion.copy(), obj.scale.copy(), obj.rotation_mode)
            for name, obj in nodes.items()}


def restore_rest(nodes, rest):
    for obj in nodes.values():
        obj.animation_data.action = None
        for track in obj.animation_data.nla_tracks:
            track.mute = True
    bpy.context.scene.frame_set(1)
    for name, obj in nodes.items():
        at, euler, q, scale, mode = rest[name]
        obj.rotation_mode = mode
        obj.location, obj.rotation_euler, obj.rotation_quaternion, obj.scale = at, euler, q, scale
    bpy.context.view_layer.update()


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    for sample in sorted((root / 'out/anatomical_motion/after').glob('*.json')):
        if not re.fullmatch(r'[stm]\d{2}', sample.stem):
            continue
        directory = root / 'out/morph_reference' / sample.stem
        if not (directory / 'validation.json').exists():
            directory = root / 'out/mech_reference' / sample.stem
        file = directory / 'validation.json'
        report = json.loads(file.read_text(encoding='utf8'))
        source = report.get('motionSource')
        if not source:
            continue
        bpy.ops.wm.open_mainfile(filepath=str(root / source['inputBlend']))
        rest = snapshot_rest({name: bpy.data.objects[name] for name in source['nodes']})
        blend = directory / (sample.stem + '.blend')
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        restore_rest({name: bpy.data.objects[name] for name in source['nodes']}, rest)
        temporary = blend.with_suffix('.rest.blend')
        bpy.ops.wm.save_as_mainfile(filepath=str(temporary))
        temporary.replace(blend)
        report['hashes']['blend'] = hashlib.sha256(blend.read_bytes()).hexdigest()
        report['motionSource']['restorer'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        report['gates']['editable_source'] = 'pending_independent_load'
        file.write_text(json.dumps(report, indent=2), encoding='utf8')
        print('REST_RESTORED ' + sample.stem, flush=True)
