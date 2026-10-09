"""Reopen the editable files independently; verify joint provenance and recoverable actions."""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from anatomy_checks import verify_feather_planes, verify_articulated_body, verify_weapon_pose, ancestor_chain
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


def collision_tree(objects):
    vertices,faces=[],[]
    for obj in objects:
        offset=len(vertices)
        vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        faces.extend(tuple(offset+i for i in face.vertices) for face in obj.data.polygons)
    assert vertices, 'Missing collision geometry'
    return BVHTree.FromPolygons(vertices,faces)


selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(contract['assets'])
for id in selected:
    spec=contract['assets'][id]
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
    anatomy = {'articulation':verify_articulated_body(spec,meshes)}
    if id == 's01':
        assert all(any(obj.name.startswith(prefix) for obj in meshes) for prefix in
                   ['Rounded bee thoracic carapace','Separate bee abdominal shell','Compound-eyed bee head']), 's01: insect body regions missing'
        for wing in spec['rig']['rotorWings']:
            root = bpy.data.objects[wing['node']]
            assert any(obj.name.startswith('Full blue duct') and obj.parent == root for obj in meshes), 's01: duct does not follow its wing support'
    if id == 's02':
        slab = bounds([obj for obj in meshes if obj.name.startswith('Thick industrial slab')])
        assert slab[2] >= spec['parameters']['bodyDepth'] * .95, 's02: industrial body remains too thin'
    if id == 's06':
        assert bpy.data.objects['launcher_base'].parent.name == 'spine', 's06: launcher is mounted on the rider'
        assert len([obj for obj in meshes if obj.name.startswith('Dorsal rocket launch cell')]) == 6, 's06: multi-rocket rack is incomplete'
        rider = [obj for obj in meshes if any(p.name == 'hum_waist' for p in ancestor_chain(obj))]
        helmet = [obj for obj in meshes if any(p.name == 'head' for p in ancestor_chain(obj))]
        rack = [obj for obj in meshes if bpy.data.objects['heavy'] in ancestor_chain(obj)]
    if id == 'm06':
        plates = [obj for obj in meshes if obj.name.startswith('Eight pentagonal launch backplates')]
        assert len(plates) == 8, 'm06: backplate count changed'
        sizes = [bounds([obj]) for obj in plates]
        assert all(size[0] < size[1] * .4 and size[0] < size[2] * .4 for size in sizes), 'm06: backplates must occupy sagittal planes'
        assert max(size[2] for size in sizes) > min(size[2] for size in sizes) * 1.8, 'm06: backplate heights are uniform'
        anatomy['sagittalBackplates'] = 8
    if id == 's07':
        assert bpy.data.objects['gun'].parent.name == 'tent_0_11', 's07: light weapon is not held by the right upper tentacle'
        assert bpy.data.objects['heavy'].parent.name == 'tent_2_11', 's07: heavy weapon is not held by the left upper tentacle'
        assert len([obj for obj in meshes if obj.name.startswith('Cephalopod luminous eye')]) == 2, 's07: eyes missing'
        anatomy['flexibleChains'] = [len(spec['rig'][key]) for key in ['chFL', 'chFR', 'chHL', 'chHR']] + [len(chain) for chain in spec['rig']['tents']]
        assert all(count >= 12 for count in anatomy['flexibleChains']), 's07: insufficient tentacle articulation'
        roots = [spec['rig']['leg'+key] for key in ['FL','FR','HL','HR']] + [chain[0]['g'] for chain in spec['rig']['tents']]
        origins = {name: pos for name, _, pos in spec['joints']}
        sectors = {round(math.atan2(origins[name][2],origins[name][0]) / (math.pi/4)) % 8 for name in roots}
        assert len(sectors) == 8, 's07: tentacle origins do not cover eight radial directions'
        anatomy['radialTentacleSectors'] = len(sectors)
        tentacle_meshes={root:[] for root in roots}
        for obj in meshes:
            if not obj.name.startswith(('Continuous flexible tentacle sheath','Ventral articulated sucker','Support tentacle contact pad')):
                continue
            owner=obj.parent
            while owner and owner.name not in tentacle_meshes:
                owner=owner.parent
            assert owner, 's07: tentacle surface has no owning chain'
            tentacle_meshes[owner.name].append(obj)
        pads=[obj for obj in meshes if obj.name.startswith('Support tentacle contact pad')]
        assert len(pads)==4, 's07: four support contacts missing'
    if id == 't12':
        assert bpy.data.objects['forehead_bore'].scale.x < .002, 't12: forehead bore exposed at rest'
        assert bpy.data.objects['heavy_muzzle'].parent.name == 'forehead_bore', 't12: forehead emission bypasses concealment'
        assert any(obj.name.startswith('Closed forehead cannon shutter') for obj in meshes), 't12: forehead shutter missing'
        assert not any(obj.name.startswith('Heavy weapon open bore') for obj in meshes), 't12: external forehead barrel retained'
    if id == 't02':
        assert any(obj.name.startswith('Heavy weapon open bore') for obj in meshes), 't02: electromagnetic bore missing'
        assert any(obj.name.startswith('Hybrid lance cutting spearhead') for obj in meshes), 't02: melee spearhead missing'
        assert not any(obj.name.startswith(('Rifle shoulder stock','Rifle pistol grip')) for obj in meshes), 't02: firearm-only grip retained'
        assert bpy.data.objects['emitter_r'].parent.name=='heavy', 't02: shield does not emit from the lance'
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
        if spec['recipe'] == 'pterosaur':
            for joint in [wing['w'], wing['outer'], wing['hand']]:
                assert any(obj.parent.name == joint and obj.name.startswith('Continuous ') for obj in meshes), id + ': discontinuous membrane'
            for joint in [wing['outer'], wing['hand']]:
                assert any(obj.parent.name == joint and obj.name.startswith('Overlapping wing hinge gore') for obj in meshes), id + ': membrane hinge seam'
        else:
            feathers = [obj for obj in meshes if obj.parent.name == wing['hand'] and obj.name.startswith('Fanned primary feather')]
            assert len(feathers) >= 8, id + ': missing fanned primary feathers'
            assert not any(obj.name.startswith(('Continuous humerus wing web','Continuous ulna wing web','Continuous manus wing web','Overlapping wing hinge gore')) for obj in meshes), id + ': obsolete wing boards retained'
            if spec['recipe']=='eagle':
                assert any(obj.name.startswith('Fanned avian rectrix') for obj in meshes), id + ': bird tail feathers missing'
            side=wing['sgn']
            manus=spec['parameters'].get('manusEnd',[spec['parameters']['primaryLength'],0,.08])
            anatomy['feathersBehindBones']=verify_feather_planes(meshes,
                [(wing['w'],offsets[wing['outer']],side),(wing['outer'],offsets[wing['hand']],side),
                 (wing['hand'],(side*manus[0],manus[1],manus[2]),side)])
        anatomy['articulatedWings'] = 2
    assert bpy.context.scene.camera is not None, id + ': review camera missing'
    joints = [bpy.data.objects[name] for name, _, _ in spec['joints']]
    pose_samples = 0
    for clip in report['clips']:
        for joint in joints:
            for track in joint.animation_data.nla_tracks:
                track.mute = True
                if track.name == clip:
                    joint.animation_data.action = track.strips[0].action
                    joint.animation_data.action_slot = track.strips[0].action_slot
        for frame in (range(1, 32) if id in ['s06', 's07'] else [1, 8, 16, 24, 31]):
            bpy.context.scene.frame_set(frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            evaluated = skeleton.evaluated_get(depsgraph)
            if id == 't05':
                expected = .22 if clip == 'run' else 1.12
                assert abs(bpy.data.objects['shoulder_l'].rotation_euler.z - expected) < 1e-4, 't05: editable clip loses wing posture'
            if id=='t10' and clip=='shield_deploy' and frame==31:
                forward=bpy.data.objects['barrier'].matrix_world.to_quaternion() @ Vector((0,-1,0))
                assert forward.y<-.95, 't10: deployed shield does not face forward'
            if id == 's07':
                for weapon, root in [('gun', 'tent_0'), ('heavy', 'tent_2')]:
                    assert bpy.data.objects[weapon].matrix_world.translation.z > bpy.data.objects[root].matrix_world.translation.z + .3, 's07: upper tentacle holds its weapon too low'
                trees=[collision_tree(tentacle_meshes[root]) for root in roots]
                for i,tree in enumerate(trees):
                    assert all(not tree.overlap(other) for other in trees[i+1:]), 's07: tentacle collision in '+clip+' frame '+str(frame)
                contacts=sorted([obj.matrix_world.translation for obj in pads],key=lambda p:math.atan2(p.y,p.x))
                assert max(p.z for p in contacts)-min(p.z for p in contacts)<.14, 's07: unsupported lower tentacle'
                center=bpy.data.objects['spine'].matrix_world.translation
                cross=[(b.x-a.x)*(center.y-a.y)-(b.y-a.y)*(center.x-a.x) for a,b in zip(contacts,contacts[1:]+contacts[:1])]
                assert all(v>0 for v in cross) or all(v<0 for v in cross), 's07: mantle lies outside support polygon'
                for eye in [obj for obj in meshes if obj.name.startswith('Cephalopod luminous eye')]:
                    origin = eye.matrix_world.translation
                    assert all(tree.ray_cast(origin, Vector((0,-1,0)), 12)[0] is None for tree in trees), 's07: front tentacle blocks an eye'
            if id == 's06':
                rack_top = max((obj.matrix_world @ v.co).z for obj in rack for v in obj.data.vertices)
                head_top = max((obj.matrix_world @ v.co).z for obj in helmet for v in obj.data.vertices)
                assert rack_top <= head_top + 1e-5, 's06: launcher exceeds the helmet in '+clip+' frame '+str(frame)
                assert not collision_tree(rack).overlap(collision_tree(rider)), 's06: launcher intersects rider in '+clip
                if clip == 'heavy' and frame == 16:
                    muzzle = bpy.data.objects['heavy_muzzle']
                    direction = muzzle.matrix_world.to_quaternion() @ Vector((0,0,1))
                    assert direction.y < -.99, 's06: raised rack does not face the target'
                    assert collision_tree(rider).ray_cast(muzzle.matrix_world.translation, direction, 12)[0] is None, 's06: launch path strikes rider'
                    for cell in [obj for obj in rack if obj.name.startswith('Dorsal rocket launch cell')]:
                        points = [cell.matrix_world @ v.co for v in cell.data.vertices]
                        front = max(p.dot(direction) for p in points)
                        rim = [p for p in points if p.dot(direction) > front - 1e-5]
                        origin = sum(rim, Vector()) / len(rim)
                        assert collision_tree(rider).ray_cast(origin, direction, 12)[0] is None, 's06: an outboard launch cell strikes rider'
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
            if frame == 16:
                verify_weapon_pose(spec,clip in ['light','heavy'])
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

if '--' in sys.argv:
    prior=output/'source-validation.json'
    results=json.loads(prior.read_text()) | results if prior.exists() else results
pending = output / 'source-validation.json.tmp'
pending.write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')
pending.replace(output / 'source-validation.json')
print('SOURCE_VALIDATION ' + json.dumps(results), flush=True)
