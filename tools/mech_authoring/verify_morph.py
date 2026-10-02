"""Reopen each editable source; measure animated folded geometry against its authored hull."""
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parent
contract = json.loads((HERE / 'morphers.json').read_text())
output = (HERE / contract['authoring']['outputs']).resolve()
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ids = args or list(contract['assets'])
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
results, failures = {}, []
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
        for track in joint.animation_data.nla_tracks:
            track.mute = True
            if track.name == 'to_flight':
                joint.animation_data.action = track.strips[0].action
                joint.animation_data.action_slot = track.strips[0].action_slot
        joint.update_tag()
    bpy.context.scene.frame_set(1)
    bpy.context.scene.frame_set(31)
    bpy.context.view_layer.update()
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
    result = {'blend': sha(blend), 'bones': len(skeleton.data.bones), 'clips': spec['clips'],
              'foldedLimbBoundsInHullCoordinates': envelopes, 'limbVerticesOutsideHull': len(outside),
              'exposedLimbBoundsInHullCoordinates': exposed,
              'outsideExamples': outside[:4], 'editable_source': 'pass',
              'flight_belly': ('pass' if not outside else 'fail') if cavity else 'exposed_patagium_struts'}
    (directory / 'source-validation.json').write_text(json.dumps(result, indent=2) + '\n')
    report['gates']['editable_source'] = 'pass'
    (directory / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    results[id] = result
    if outside:
        failures.append(id)
    print('MORPH_SOURCE ' + id + ' outside=' + str(len(outside)), flush=True)
(output / 'source-validation.json').write_text(json.dumps(results, indent=2) + '\n')
assert not failures, 'Uncontained folded limbs: ' + ', '.join(failures)
