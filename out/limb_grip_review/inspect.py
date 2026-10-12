import bpy, json, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
results = {}
body_names = {'hips', 'pelvis', 'spine', 'waist', 'chest', 'hum_chest', 'hum_waist', 'hunch', 'mesothorax', 'metathorax'}
for contract_file in ['assets.json', 'morphers.json']:
    contract = json.loads((ROOT/'tools/mech_authoring'/contract_file).read_text())
    for id, spec in contract['assets'].items():
        directory = 'mech_reference' if contract_file == 'assets.json' else 'morph_reference'
        report = json.loads((ROOT/'out'/directory/id/'validation.json').read_text())
        source = ROOT/report.get('motionSource', {}).get('inputBlend', f'out/{directory}/{id}/{id}.blend')
        bpy.ops.wm.open_mainfile(filepath=str(source))
        bpy.context.view_layer.update()
        roots = [n for n, _, _ in spec['joints'] if n.startswith(('shoulder_', 'hip_', 'leg_')) and bpy.data.objects[n].type == 'EMPTY']
        meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent and o.parent.name in body_names]
        vertices, faces = [], []
        for mesh in meshes:
            offset = len(vertices)
            vertices += [mesh.matrix_world @ v.co for v in mesh.data.vertices]
            faces += [tuple(offset+i for i in p.vertices) for p in mesh.data.polygons]
        tree = BVHTree.FromPolygons(vertices, faces) if vertices else None
        measurements = []
        for name in roots:
            node = bpy.data.objects[name]
            at = node.matrix_world.translation
            sign = 1 if at.x > 0 else -1
            surface = None
            if tree:
                origin = Vector((sign*20, at.y, at.z))
                hit, _, _, _ = tree.ray_cast(origin, Vector((-sign,0,0)),40)
                if hit: surface = sign*hit.x
            measurements.append({'node': name, 'x': sign*at.x, 'surface': surface, 'exposed': None if surface is None else sign*at.x-surface})
        held = []
        for h in spec['rig'].get('heldWeapons', []):
            node = bpy.data.objects[h['node']]
            inv = node.matrix_world.inverted()
            points = []
            for mesh in bpy.data.objects:
                parent = mesh.parent
                while parent and parent != node: parent = parent.parent
                if mesh.type != 'MESH' or parent != node or 'grip' in mesh.name.lower(): continue
                points += [inv @ mesh.matrix_world @ v.co for v in mesh.data.vertices]
            # Receiver section around the grasping wrist; distant barrels/blades are excluded.
            near = [p for p in points if abs(p.x) < .34 and abs(p.y) < .34]
            held.append({'node':h['node'], 'staff':h.get('staff',False), 'receiverBottom': min((p.z for p in near),default=0)})
        results[id] = {'roots':measurements, 'held':held}
(ROOT/'out/limb_grip_review/baseline.json').write_text(json.dumps(results,indent=2))
print('ATTACHMENT_BASELINE '+json.dumps(results))
