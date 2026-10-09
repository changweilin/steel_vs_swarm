"""Rebake runtime-sampled joint clips while preserving authored geometry and morph endpoints."""
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sampled_glb import encode_tracks
from motion_source import snapshot_rest, restore_rest

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / 'out/anatomical_motion/after'
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
actions_only = '--actions-only' in args
args = [arg for arg in args if arg != '--actions-only']
ids = args or [p.stem for p in SAMPLES.glob('*.json') if re.fullmatch(r'[stm]\d{2}', p.stem)]
axis = Quaternion((1, 0, 0), 3.141592653589793 / 2)


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


for id in ids:
    source = (ROOT / 'public/js/forge/assets' / (id + '.js')).read_text(encoding='utf8')
    asset = json.loads(source.split('export default ', 1)[1].rsplit(';', 1)[0])
    if asset['rig'].get('cephalopod') or (asset['kind'] == 'aerial' and not any(wing.get('hand') for wing in asset['rig'].get('wings', []))):
        continue
    samples = json.loads((SAMPLES / (id + '.json')).read_text(encoding='utf8'))
    directory = ROOT / 'out/morph_reference' / id
    if not (directory / (id + '.blend')).exists():
        directory = ROOT / 'out/mech_reference' / id
    blend = directory / (id + '.blend')
    report_file = directory / 'validation.json'
    report = json.loads(report_file.read_text(encoding='utf8'))
    checkpoint = report.get('motionSource', {}).get('inputBlend') or report.get('motionInputBlend')
    if checkpoint and (ROOT / checkpoint).exists():
        original = ROOT / checkpoint
    else:
        original = ROOT / 'out/anatomical_motion/before' / (id + '-' + sha(blend)[:12] + '.blend')
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(blend, original)
    bpy.ops.wm.open_mainfile(filepath=str(original))
    original_scene = bpy.context.scene
    source_fps = original_scene.render.fps
    nodes = {name: bpy.data.objects[name] for name, *_ in asset['joints']}
    rest = snapshot_rest(nodes)
    baked_clips = []
    for clip, sampled in samples['clips'].items():
        if clip.startswith('flight_') and asset.get('forms', {}).get('flight', {}).get('rig', {}).get('spin'):
            continue
        if not any(t.name == clip for t in next(iter(nodes.values())).animation_data.nla_tracks):
            continue
        baked_clips.append(clip)
        for obj in nodes.values():
            obj.animation_data.action = None
            for track in list(obj.animation_data.nla_tracks):
                track.mute = True
                if track.name == clip:
                    old = track.strips[0].action
                    obj.animation_data.nla_tracks.remove(track)
                    if old.users == 0:
                        bpy.data.actions.remove(old)
        for frame, transforms in enumerate(sampled['frames'], 1):
            for name, position, rotation, scale in transforms:
                if name.startswith('fx_'):
                    continue
                obj = nodes[name]
                obj.location = (position[0], -position[2], position[1])
                q = Quaternion((rotation[3], rotation[0], rotation[1], rotation[2]))
                q = axis @ q @ axis.inverted()
                # Adjacent keys must stay in one hemisphere for glTF linear interpolation.
                if obj.rotation_mode == 'QUATERNION':
                    if obj.rotation_quaternion.dot(q) < 0:
                        q.negate()
                    obj.rotation_quaternion = q
                else:
                    obj.rotation_euler = q.to_euler(obj.rotation_mode, obj.rotation_euler)
                obj.scale = (scale[0], scale[2], scale[1])
                for channel in ['location', 'rotation_quaternion' if obj.rotation_mode == 'QUATERNION' else 'rotation_euler', 'scale']:
                    obj.keyframe_insert(data_path=channel, frame=frame)
        for name, obj in nodes.items():
            action = obj.animation_data.action
            action.name = id + ':' + clip + ':' + name
            track = obj.animation_data.nla_tracks.new()
            track.name = clip
            track.strips.new(clip, 1, action)
            track.mute = True
            obj.animation_data.action = None
    restore_rest(nodes, rest)
    # Preserve durations of untouched cast/shield/morph tracks authored at 30 fps.
    for obj in nodes.values():
        for track in obj.animation_data.nla_tracks:
            if track.name in baked_clips:
                continue
            strip = track.strips[0]
            strip.scale *= 60 / source_fps
    bpy.context.scene.render.fps = 60
    bpy.context.scene.frame_end = max(len(clip['frames']) for clip in samples['clips'].values())
    temporary_blend = blend.with_suffix('.motion.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(temporary_blend))
    if actions_only:
        temporary_blend.replace(blend)
        glb = ROOT / 'public/assets/models/reference' / (id + '.glb')
        encode_tracks(glb, samples, baked_clips)
        report['hashes']['blend'], report['hashes']['glb'] = sha(blend), sha(glb)
        report['motionSource']['samples'] = sha(SAMPLES / (id + '.json'))
        report['motionSource']['clips'] = baked_clips
        report['motionSource']['drivers'] = json.loads((SAMPLES / 'validation.json').read_text())['sources']
        report['motionSource']['baker'] = sha(Path(__file__))
        report['gates']['editable_source'] = 'pending_independent_load'
        report['gates']['export'] = 'pending_independent_load'
        report_file.write_text(json.dumps(report, indent=2), encoding='utf8')
        print('MOTION_BAKED ' + id, flush=True)
        continue
    # Use the pipeline's existing export batches, not the detailed editor geometry.
    bpy.ops.object.select_all(action='DESELECT')
    meshes = []
    for batch in asset['meshes']:
        data = bpy.data.meshes.new('Motion export batch')
        positions, indices = batch['positions'], batch['indices']
        vertices = [(positions[i], -positions[i+2], positions[i+1]) for i in range(0, len(positions), 3)]
        faces = [indices[i:i+3] for i in range(0, len(indices), 3)]
        data.from_pydata(vertices, [], faces)
        data.update()
        obj = bpy.data.objects.new('Export_' + batch['parent'] + '_' + batch['material'], data)
        obj.parent = nodes[batch['parent']]
        data.materials.append(bpy.data.materials[batch['material']])
        meshes.append(obj)
    # Editor meshes and constraint skeletons must not be evaluated for every export sample.
    export_scene = bpy.data.scenes.new('Motion export')
    export_scene.render.fps = 60
    export_scene.frame_end = bpy.context.scene.frame_end
    for obj in [bpy.data.objects[id], *nodes.values(), *meshes]:
        export_scene.collection.objects.link(obj)
    bpy.context.window.scene = export_scene
    for obj in export_scene.objects:
        obj.select_set(True)
    glb = ROOT / 'public/assets/models/reference' / (id + '.glb')
    temporary = glb.with_suffix('.motion.glb')
    bpy.ops.export_scene.gltf(filepath=str(temporary), export_format='GLB', use_selection=True,
                             export_animations=True, export_animation_mode='NLA_TRACKS',
                             export_optimize_animation_keep_anim_object=True, export_optimize_animation_size=False,
                             export_force_sampling=False)
    encode_tracks(temporary, samples, baked_clips)
    bpy.context.window.scene = original_scene
    bpy.data.scenes.remove(export_scene)
    for obj in meshes:
        bpy.data.objects.remove(obj, do_unlink=True)
    restore_rest(nodes, rest)
    temporary_blend.replace(blend)
    temporary.replace(glb)
    report['hashes']['blend'], report['hashes']['glb'] = sha(blend), sha(glb)
    report['motionSource'] = {'samples': sha(SAMPLES / (id + '.json')),
                              'inputBlend': original.relative_to(ROOT).as_posix(),
                              'clips': baked_clips,
                              'nodes': list(nodes),
                              'drivers': json.loads((SAMPLES / 'validation.json').read_text())['sources'],
                              'baker': sha(Path(__file__)), 'fps': 60}
    report['motionSource']['encoder'] = sha(Path(__file__).with_name('sampled_glb.py'))
    report['motionSource']['restorer'] = sha(Path(__file__).with_name('motion_source.py'))
    report.pop('motionInputBlend', None)
    for gate in ['editable_source', 'export', 'motion']:
        report['gates'][gate] = 'pending_independent_load'
    report_file.write_text(json.dumps(report, indent=2), encoding='utf8')
    print('MOTION_BAKED ' + id, flush=True)
