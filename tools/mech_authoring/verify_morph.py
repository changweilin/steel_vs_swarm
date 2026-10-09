"""Reopen each editable source; measure animated folded geometry against its authored hull."""
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from anatomy_checks import verify_feather_planes, verify_articulated_body, verify_weapon_pose, ancestor_chain
contract = json.loads((HERE / 'morphers.json').read_text())
output = (HERE / contract['authoring']['outputs']).resolve()
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ids = args or list(contract['assets'])
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
results, failures = {}, []


def write_report(file, data):
    pending = file.with_suffix(file.suffix + '.tmp')
    pending.write_text(json.dumps(data, indent=2) + '\n', encoding='utf8')
    pending.replace(file)


def activate_clip(spec, clip, frame):
    for name, _, _ in spec['joints']:
        joint = bpy.data.objects[name]
        for track in joint.animation_data.nla_tracks:
            track.mute = True
            if track.name == clip:
                joint.animation_data.action = track.strips[0].action
                joint.animation_data.action_slot = track.strips[0].action_slot
        joint.update_tag()
    bpy.context.scene.frame_set(1)
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


for id in ids:
    spec = contract['assets'][id]
    directory = output / id
    blend = directory / (id + '.blend')
    report = json.loads((directory / 'validation.json').read_text())
    assert report['hashes']['blend'] == sha(blend), 'Stale Blender source: ' + id
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    skeleton = bpy.data.objects[id + '_skeleton']
    assert len(skeleton.data.bones) == len(spec['joints'])
    for name, parent, at in spec['joints']:
        joint = bpy.data.objects[name]
        assert joint.parent.name == (parent or id), 'Lost parent: ' + name
        assert skeleton.pose.bones[name].constraints[0].target == joint
        assert set(spec['clips']).issubset({t.name for t in joint.animation_data.nla_tracks})
    meshes=[obj for obj in bpy.data.objects if obj.type=='MESH']
    anatomy={'articulation':verify_articulated_body(spec,meshes)}
    if id == 't06':
        assert len(spec['rig']['tailSegs']) == 8, 't06: monkey tail missing'
        assert any(obj.name.startswith('Tapered anatomical tail vertebra armor') for obj in meshes), 't06: tail has no visible geometry'
        assert all(not any(p.name in spec['rig']['tailSegs'] for p in ancestor_chain(bpy.data.objects[weapon['ref']]))
                   for weapon in spec['rig']['wpn'].values()), 't06: normal monkey tail gained a weapon'
    if id == 's03':
        swim = spec['forms']['flight']['rig']['swim']
        activate_clip(spec, 'flight_idle', 7)
        before = bpy.data.objects[swim['tail'][-1]].rotation_euler.x
        activate_clip(spec, 'flight_idle', 22)
        assert abs(before - bpy.data.objects[swim['tail'][-1]].rotation_euler.x) > .05, 's03: flight tail does not swim dorsoventrally'
    if id in ['s10','m08']:
        positions={name:pos for name,_,pos in spec['joints']}
        segments=[]
        for side,n in [(1,'l'),(-1,'r')]:
            key='FL' if side==1 else 'FR'
            if spec['acceptance'].get('foreclawsCarryWeapons'):
                assert bpy.data.objects['leg_'+key].parent.name=='chest', 'Grasping foreclaw is detached from the chest'
            else:
                assert bpy.data.objects['leg_'+key].parent.parent.name=='flap_'+n, 'Flying forelimb is detached from its wing'
            assert bpy.data.objects['outer_'+n].parent.name=='ulna_'+n
            assert bpy.data.objects['ulna_'+n].parent.name=='flap_'+n
            segments.extend([('flap_'+n,positions['ulna_'+n],side),('ulna_'+n,positions['outer_'+n],side),
                             ('outer_'+n,(side*spec['parameters']['primaryLength'],0,-.38),side)])
        anatomy['feathersBehindBones']=verify_feather_planes(meshes,segments)
        assert not any(obj.name.startswith(('Scapular wing root board','Continuous primary feather root web')) for obj in meshes), 'Old bird wing boards retained'
        assert any('tail' in obj.name and ('feather' in obj.name or 'rectrix' in obj.name) for obj in meshes), 'Bird tail feathers missing'
        assert set(spec['acceptance']['flightExposedRoots'])=={'leg_FL','leg_FR','leg_HL','leg_HR'}, 'Animal limbs are buried in the hull'
    if id=='m05':
        assert all(bpy.data.objects['wing_'+n].parent.name=='elbow_'+n for n in ['l','r']), 'Patagium is not attached to the elbow'
        assert len([obj for obj in meshes if obj.name.startswith('Folded patagium fist blade')])==2, 'Paired fist blades missing'
        assert len(spec['rig']['tailSegs'])==5, 'Wolf tail missing'
    for clip in spec['clips']:
        activate_clip(spec, clip, 16)
        verify_weapon_pose(spec,clip in ['light','heavy','flight_light','flight_heavy'])
        for name, _, _ in spec['joints']:
            joint = bpy.data.objects[name]
            assert all(math.isfinite(v) for row in joint.matrix_world for v in row), clip + ': nonfinite joint'
            if name != 'barrier':
                assert all(abs(v - 1) < 1e-6 for v in joint.scale), clip + ': resized rigid joint'
        if id == 't11':
            head = bpy.data.objects['head'].matrix_world.to_quaternion()
            if clip in ['idle', 'run', 'light', 'heavy', 'skill', 'ult', 'shield_deploy', 'shield_retract']:
                assert (head @ Vector((0, -1, 0))).y < -.97, clip + ': ground face points away from target'
                assert (head @ Vector((0, 0, 1))).z > .97, clip + ': triangular helmet is not upright'
            elif clip.startswith('flight_'):
                assert (head @ Vector((0, 0, 1))).y < -.97, clip + ': triangular nose points away from flight direction'
            for side, sign in [('l', 1), ('r', -1)]:
                wrist, hinge, rotor = [bpy.data.objects[name + '_' + side] for name in ['wrist', 'rotor_hinge', 'rotor']]
                expected = wrist.matrix_world @ Vector((sign * .18, -.04, -.08))
                assert (hinge.matrix_world.translation - expected).length < 1e-5, clip + ': disk left hand back'
                assert (rotor.matrix_world.translation - hinge.matrix_world.translation).length < 1e-5, clip + ': rotor center shifted'
                if clip in ['idle', 'run', 'light', 'heavy']:
                    normal = hinge.matrix_local.to_3x3() @ Vector((0, -1, 0))
                    assert abs(normal.x) > .99999, clip + ': disk is not flat against arm outside'
        if clip.startswith('flight_'):
            rig = spec['forms']['flight']['rig']
            motors = [entry['node'] for entry in rig.get('spin', [])]
            motors += [entry['w'] for entry in rig.get('wings', [])]
            activate_clip(spec, clip, 7)
            before = {name: bpy.data.objects[name].rotation_euler.to_quaternion() for name in motors}
            activate_clip(spec, clip, 13)
            assert all(before[name].rotation_difference(bpy.data.objects[name].rotation_euler.to_quaternion()).angle > .01
                       for name in motors), clip + ': frozen flight propulsion'
    if spec['kind'] == 'biped':
        activate_clip(spec, 'run', 7)
        before = {name: bpy.data.objects[name].rotation_euler.x for name in ['shoulder_l', 'shoulder_r']}
        activate_clip(spec, 'run', 22)
        if spec['rig'].get('predatory'):
            assert all(bpy.data.objects[name].rotation_euler.x < -.5 for name in before), 'Predator loses claw-ready arms'
            assert bpy.data.objects[spec['rig']['predatory']['hunch']].rotation_euler.x > .45, 'Predator loses its forward hunch'
        else:
            assert all(abs(bpy.data.objects[name].rotation_euler.x - angle) > .15 for name, angle in before.items()), 'Frozen biped running arm'
        for clip in ['light', 'heavy']:
            activate_clip(spec, clip, 16)
            for side in ['l', 'r']:
                elbow, wrist = [bpy.data.objects[name + '_' + side].matrix_world.translation for name in ['elbow', 'wrist']]
                assert (wrist - elbow).normalized().y < -.6, clip + ': firing forearm points away from target'
    if id == 't11':
        helmet = bpy.data.objects['Right isosceles triangular helmet nose']
        triangles = [face for face in helmet.data.polygons if len(face.vertices) == 3]
        assert len(helmet.data.vertices) == 6 and len(triangles) == 2, 'Lost triangular helmet topology'
        assert all(abs(face.normal.y) > .99999 for face in triangles), 'Helmet triangle lies outside face plane'
        base = min(vertex.co.z for vertex in helmet.data.vertices) + helmet.location.z
        face = bpy.data.objects['Atlas black observation face']
        assert max(vertex.co.z for vertex in face.data.vertices) + face.location.z < base, 'Observation face is hidden by helmet'
        activate_clip(spec, 'shield_deploy', 31)
        hinge, barrier = [bpy.data.objects[name] for name in ['rotor_hinge_l', 'barrier']]
        center, target = hinge.matrix_world.translation, barrier.matrix_world.translation
        assert abs(center.x - target.x) < 1e-5 and abs(center.z - target.z) < 1e-5, 'Defense shield is off center'
        normal = hinge.matrix_world.to_quaternion() @ Vector((0, -1, 0))
        forward = barrier.matrix_world.to_quaternion() @ Vector((0, -1, 0))
        assert abs(normal.dot(forward)) > .99999, 'Defense shield is not parallel to projection'
    if id == 'm05':
        activate_clip(spec, 'idle', 1)
        stance = {name: bpy.data.objects[name].matrix_local.copy() for name, _, _ in spec['joints']}
        activate_clip(spec, 'to_flight', 1)
        assert max(abs(stance[name][i][j] - bpy.data.objects[name].matrix_local[i][j])
                   for name in stance for i in range(4) for j in range(4)) < 1e-5, 'Wolf snaps at transform start'
        assert abs(bpy.data.objects['knee_l'].rotation_euler.x - spec['rig']['legChainL'][0]['base']) < 1e-5, 'Wolf lost its crouch'
    activate_clip(spec, 'to_flight', 31)
    if id=='m05':
        forward=bpy.data.objects['head'].matrix_world.to_quaternion() @ Vector((0,-1,0))
        assert forward.y < -.99, 'Flying wolf head does not face forward'
        activate_clip(spec,'to_flight',1)
        for side in ['l','r']:
            elbow=bpy.data.objects['elbow_'+side]
            wing=bpy.data.objects['wing_'+side]
            local=elbow.matrix_world.to_quaternion().inverted() @ wing.matrix_world.to_quaternion()
            assert abs((local @ Vector((0,-1,0))).y)>.99, 'Elbow patagium did not turn outward by a quarter turn'
        activate_clip(spec,'to_flight',31)
    if id=='t11':
        for side in ['l','r']:
            hinge=bpy.data.objects['rotor_hinge_'+side]
            inv=hinge.matrix_world.inverted()
            covers=[obj for obj in meshes if obj.name.startswith('Solid retractable rotor shield petal') and hinge in ancestor_chain(obj)]
            heights=[(inv @ obj.matrix_world @ v.co).y for obj in covers for v in obj.data.vertices]
            assert max(heights)-min(heights)<.041, 'Flying rotor shield petals are not coplanar'
    if spec['acceptance'].get('flightTailExposed'):
        tip=bpy.data.objects['spine'].matrix_world.inverted() @ bpy.data.objects[spec['rig']['tailSegs'][-1]].matrix_world.translation
        assert -tip.y < -1.7, 'Flight tail does not extend behind the body'
    if id=='m05':
        start,end=[bpy.data.objects[name].matrix_world.translation for name in ['tail_0','tail_4']]
        assert (end-start).normalized().y>.9, 'Gliding wolf tail does not balance rearward'
    depsgraph = bpy.context.evaluated_depsgraph_get()
    envelopes, exposed, outside = {}, {}, []
    cavity = spec.get('cavity')
    if cavity:
        inv = bpy.data.objects[cavity['owner']].evaluated_get(depsgraph).matrix_world.inverted()
        sections, offset = cavity['sections'], cavity['offset']
        roots=list(cavity['roots'])
        tail=spec['rig'].get('tailSegs', [])
        if tail and spec['acceptance'].get('flightTailStowed', False):
            roots.append(tail[0])
        exposed_roots = spec['acceptance'].get('flightExposedRoots', [])
        limb_roots = {name for name, _, _ in spec['joints'] if name.startswith(('leg_', 'hip_', 'shoulder_'))}
        assert set(cavity['roots'] + exposed_roots) == limb_roots, 'Unmeasured limb inventory: ' + id
        for root in roots + exposed_roots:
            points = []
            for mesh in bpy.data.objects:
                if mesh.type != 'MESH':
                    continue
                owner = mesh.parent
                excluded = False
                while owner and owner.name != root:
                    if owner.name in {'gun', 'heavy', 'cast_dish'}:
                        excluded = True
                        break
                    owner = owner.parent
                if owner is None or excluded:
                    continue
                evaluated = mesh.evaluated_get(depsgraph)
                for vertex in evaluated.data.vertices:
                    v = inv @ evaluated.matrix_world @ vertex.co
                    point = (v.x, v.z, -v.y)
                    points.append(point)
                    assert all(math.isfinite(x) for x in v), 'Nonfinite source geometry'
                    x, y, z = [point[i] - offset[i] for i in range(3)]
                    if root in exposed_roots:
                        continue
                    axial, depth = (y, z) if cavity['axis'] == 'y' else (z, y)
                    pair = next(((lo, hi) for lo, hi in zip(sections, sections[1:]) if lo[0] <= axial <= hi[0]), None)
                    if pair is None:
                        outside.append((root, point))
                        continue
                    lo, hi = pair
                    t = (axial - lo[0]) / (hi[0] - lo[0])
                    width, height = [lo[i] + (hi[i] - lo[i]) * t for i in [1, 2]]
                    nx, nz = abs(x) / (width / 2), abs(depth) / (height / 2)
                    corner = nx*nx+nz*nz if cavity.get('profile') == 'ellipse' else (nx-.72)/.28+(nz-.56)/.44
                    if nx > 1.00001 or nz > 1.00001 or corner > 1.00001:
                        outside.append((root, point))
            assert points, 'Unmeasured limb: ' + root
            bounds = {'min': [min(v[i] for v in points) for i in range(3)],
                      'max': [max(v[i] for v in points) for i in range(3)]}
            (exposed if root in exposed_roots else envelopes)[root] = bounds
    else:
        assert id == 'm05' and not spec['acceptance']['flightBellyClosed'], 'Unspecified closure exception'
        assert len([n for n, _, _ in spec['joints'] if n.startswith(('hip_', 'shoulder_'))]) == 4
    result = {'blend': sha(blend), 'bones': len(skeleton.data.bones), 'clips': spec['clips'], 'validatedClips': len(spec['clips']), 'anatomy': anatomy,
              'foldedLimbBoundsInHullCoordinates': envelopes, 'limbVerticesOutsideHull': len(outside),
              'exposedLimbBoundsInHullCoordinates': exposed,
              'outsideExamples': outside[:4], 'editable_source': 'pass',
              'flight_belly': ('pass' if not outside else 'fail') if cavity else 'exposed_patagium_struts'}
    write_report(directory / 'source-validation.json', result)
    report['gates']['editable_source'] = 'pass'
    write_report(directory / 'validation.json', report)
    results[id] = result
    if outside:
        failures.append(id)
    print('MORPH_SOURCE ' + id + ' outside=' + str(len(outside)), flush=True)
if args:
    prior = output / 'source-validation.json'
    results = (json.loads(prior.read_text()) if prior.exists() else {}) | results
write_report(output / 'source-validation.json', results)
assert not failures, 'Uncontained folded limbs: ' + ', '.join(failures)
