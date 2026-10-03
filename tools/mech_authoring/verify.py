"""Reopen the editable files independently; verify joint provenance and recoverable actions."""
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
contract_file = HERE / 'assets.json'
contract = json.loads(contract_file.read_text(encoding='utf8'))
output = (HERE / contract['authoring']['outputs']).resolve()
results = {}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounds(objects):
    points = [obj.matrix_local @ vertex.co for obj in objects for vertex in obj.data.vertices]
    assert points, 'Missing anatomy geometry'
    return tuple(max(point[i] for point in points) - min(point[i] for point in points) for i in range(3))


for id, spec in contract['assets'].items():
    blend = output / id / (id + '.blend')
    report_file = output / id / 'validation.json'
    report = json.loads(report_file.read_text(encoding='utf8'))
    assert report['hashes']['blend'] == sha(blend), id + ': stale source report'
    assert report['measurements']['source']['contract'] == sha(contract_file), id + ': stale contract'
    assert report['measurements']['source']['builder'] == sha(HERE / 'build.py'), id + ': stale recipe'
    assert report['measurements']['source']['catalog'] == sha(HERE / 'catalog.py'), id + ': stale catalog recipe'
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    skeleton = bpy.data.objects[id + '_skeleton']
    assert len(skeleton.data.bones) == len(spec['joints']), id + ': skeleton lost bones'
    for name, parent, position in spec['joints']:
        joint = bpy.data.objects[name]
        assert joint.parent.name == (parent or id), name + ': joint parent changed'
        expected = (position[0], -position[2], position[1])
        assert max(abs(joint.location[i] - expected[i]) for i in range(3)) < 1e-5, name + ': pivot changed'
        bone = skeleton.pose.bones[name]
        assert bone.constraints[0].target == joint, name + ': skeleton lost its driver'
        assert math.isfinite(bone.length) and bone.length > 0, name + ': invalid bone'
        tracks = {track.name for track in joint.animation_data.nla_tracks}
        assert set(report['clips']).issubset(tracks), name + ': editable actions missing'
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    assert meshes and all(obj.parent and obj.data.materials for obj in meshes), id + ': orphan geometry'
    assert all(math.isfinite(v) for obj in meshes for vertex in obj.data.vertices for v in vertex.co), id + ': nonfinite geometry'
    anatomy = {}
    if id == 'm06':
        plates = [obj for obj in meshes if obj.name.startswith('Eight pentagonal launch backplates')]
        assert len(plates) == 8, 'm06: backplate count changed'
        sizes = [bounds([obj]) for obj in plates]
        assert all(size[0] < size[1] * .4 and size[0] < size[2] * .4 for size in sizes), 'm06: backplates must occupy sagittal planes'
        assert max(size[2] for size in sizes) > min(size[2] for size in sizes) * 1.8, 'm06: backplate heights are uniform'
        anatomy['sagittalBackplates'] = 8
    if id == 's07':
        assert len([obj for obj in meshes if obj.name.startswith('Cephalopod luminous eye')]) == 2, 's07: eyes missing'
        anatomy['flexibleChains'] = [len(spec['rig'][key]) for key in ['chFL', 'chFR', 'chHL', 'chHR']] + [len(chain) for chain in spec['rig']['tents']]
        assert all(count >= 12 for count in anatomy['flexibleChains']), 's07: insufficient tentacle articulation'
        roots = [spec['rig']['leg'+key] for key in ['FL','FR','HL','HR']] + [chain[0]['g'] for chain in spec['rig']['tents']]
        origins = {name: pos for name, _, pos in spec['joints']}
        sectors = {round(math.atan2(origins[name][2],origins[name][0]) / (math.pi/4)) % 8 for name in roots}
        assert len(sectors) == 8, 's07: tentacle origins do not cover eight radial directions'
        anatomy['radialTentacleSectors'] = len(sectors)
    if id == 't12':
        assert bpy.data.objects['forehead_bore'].scale.x < .002, 't12: forehead bore exposed at rest'
        assert bpy.data.objects['heavy_muzzle'].parent.name == 'forehead_bore', 't12: forehead emission bypasses concealment'
        assert any(obj.name.startswith('Closed forehead cannon shutter') for obj in meshes), 't12: forehead shutter missing'
        assert not any(obj.name.startswith('Heavy weapon open bore') for obj in meshes), 't12: external forehead barrel retained'
    if id == 't02':
        assert any(obj.name.startswith('Long rifle open muzzle brake') for obj in meshes), 't02: gun muzzle missing'
        assert not any(obj.name.startswith('Long superconducting lance tip') for obj in meshes), 't02: sword tip retained'
    if id == 'm02':
        skull = bounds([obj for obj in meshes if obj.name.startswith('Massive tyrannosaur upper skull')])
        bore = bounds([obj for obj in meshes if obj.name.startswith('Heavy weapon open bore')])
        assert skull[0] > bore[0] * 3 and skull[1] > bore[1], 'm02: cannon dominates skull'
        assert all(bpy.data.objects['shoulder_' + side].parent.name == 'chest' for side in ['l', 'r']), 'm02: foreclaws detached from thorax'
        anatomy['skullToBoreWidth'] = skull[0] / bore[0]
    for wing in spec['rig'].get('wings', []):
        assert bpy.data.objects[wing['hand']].parent.name == wing['outer'], id + ': wing manus missing'
        assert bpy.data.objects[wing['outer']].parent.name == wing['w'], id + ': wing ulna missing'
        offsets = {name: Vector(pos) for name, _, pos in spec['joints']}
        assert offsets[wing['outer']].normalized().dot(offsets[wing['hand']].normalized()) < .85, id + ': wing elbow is straight'
        anatomy['bentWingElbow'] = True
        for joint in [wing['w'], wing['outer'], wing['hand']]:
            assert any(obj.parent.name == joint and obj.name.startswith('Continuous ') for obj in meshes), id + ': discontinuous wing surface'
        for joint in [wing['outer'], wing['hand']]:
            assert any(obj.parent.name == joint and obj.name.startswith('Overlapping wing hinge gore') for obj in meshes), id + ': wing fold exposes a hinge seam'
        if spec['recipe'] != 'pterosaur':
            feathers = [obj for obj in meshes if obj.parent.name == wing['hand'] and obj.name.startswith('Fanned primary feather')]
            assert len(feathers) >= 8, id + ': missing fanned primary feathers'
        anatomy['articulatedWings'] = 2
    assert bpy.context.scene.camera is not None, id + ': review camera missing'
    joints = [bpy.data.objects[name] for name, _, _ in spec['joints']]
    pose_samples = 0
    for clip in report['clips']:
        for joint in joints:
            for track in joint.animation_data.nla_tracks:
                track.mute = track.name != clip
        for frame in [1, 8, 16, 24, 31]:
            bpy.context.scene.frame_set(frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            evaluated = skeleton.evaluated_get(depsgraph)
            if id == 't05':
                expected = .22 if clip == 'run' else 1.12
                assert abs(bpy.data.objects['shoulder_l'].rotation_euler.z - expected) < 1e-4, 't05: editable clip loses wing posture'
            for joint in joints:
                assert all(math.isfinite(v) for row in joint.matrix_world for v in row), id + ': nonfinite ' + clip
                head = evaluated.matrix_world @ evaluated.pose.bones[joint.name].head
                assert (head - joint.matrix_world.translation).length < 1e-4, id + ': skeleton detached in ' + clip
                # A position track changes one coordinate, never the other two pivot coordinates.
                origin = next(pos for name, _, pos in spec['joints'] if name == joint.name)
                axes = {track['axis'] for group in ['fire', 'charge', 'cast'] for track in spec['motion'][group]
                        if track['node'] == joint.name and track['channel'] == 'position'}
                for axis in axes:
                    for other, index, sign in [('x', 0, 1), ('y', 2, 1), ('z', 1, -1)]:
                        if other != axis:
                            assert abs(joint.location[index] - origin['xyz'.index(other)] * sign) < 1e-5, id + ': displaced pivot'
            pose_samples += 1
    for joint in joints:
        for track in joint.animation_data.nla_tracks:
            track.mute = True
    results[id] = {'blend': sha(blend), 'sourceMeshes': len(meshes), 'bones': len(skeleton.data.bones),
                   'editableClips': report['clips'], 'poseSamples': pose_samples, 'anatomy': anatomy}
    report['gates']['editable_source'] = 'pass'
    pending = report_file.with_suffix('.json.tmp')
    pending.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    pending.replace(report_file)

pending = output / 'source-validation.json.tmp'
pending.write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')
pending.replace(output / 'source-validation.json')
print('SOURCE_VALIDATION ' + json.dumps(results), flush=True)
