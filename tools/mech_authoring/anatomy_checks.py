"""Measure authored feather surfaces in each load bone's local plane."""
import math
import bpy
from mathutils import Vector


def verify_articulated_body(spec, meshes):
    if spec['kind'] == 'biped':
        head = bpy.data.objects[spec['rig']['head']]
        necks = spec['rig'].get('cervicals') or [spec['rig'].get('neck')]
        assert necks and all(name and name in {p.name for p in ancestor_chain(head)} for name in necks), 'Head bypasses functional cervical joints'
        assert all(spec['rig']['chest'] in {p.name for p in ancestor_chain(bpy.data.objects[spec['rig']['arm'+side]])}
                   for side in ['L','R']), 'Shoulder is detached from thorax'
    waist = spec['rig'].get('waist')
    if waist:
        assert bpy.data.objects[waist].parent.name in ['hips','hunch'], 'Waist lost its pelvic attachment'
        lumbar = [obj for obj in meshes if 'lumbar waist' in obj.name.lower() and obj.parent.name == waist]
        assert lumbar, 'Independent lumbar geometry missing'
        chest = bpy.data.objects[spec['rig']['chest']]
        assert waist in {p.name for p in ancestor_chain(chest)}, 'Chest bypasses the waist'
    cavity = spec.get('cavity') or {}
    cuts = cavity.get('regionCuts', [])
    if len(cuts) == 2:
        sections=cavity['sections']
        widths=[s[1] for s in sections if cuts[0] <= s[0] <= cuts[1]]
        assert widths and min(widths) < max(s[1] for s in sections)*.80, 'Lumbar waist does not taper below the thorax'
        assert all(any(label in obj.name for obj in meshes) for label in ['pelvic croup','lumbar waist','thoracic cage']), 'Fused axial body regions'
    for held in spec['rig'].get('heldWeapons', []):
        assert bpy.data.objects[held['node']].parent.name == held['hand'], 'Weapon is detached from the grasping hand'
        prefix = 'Long axial weapon hand grip' if held.get('staff') else 'Thermal weapon pistol grip'
        assert any(obj.name.startswith(prefix) and obj.parent.name==held['node'] for obj in meshes), 'Held thermal weapon has no grip'
    return {'waist':waist,'heldWeapons':len(spec['rig'].get('heldWeapons', []))}


def ancestor_chain(obj):
    while obj.parent:
        obj=obj.parent
        yield obj


def verify_weapon_pose(spec, shooting, slot=None, hand_pose=True):
    held_by_node={h['node']:h for h in spec['rig'].get('heldWeapons', [])}
    for key, weapon in spec['rig']['wpn'].items():
        ref=bpy.data.objects[weapon['ref']]
        held=next((held_by_node[node.name] for node in [ref,*ancestor_chain(ref)] if node.name in held_by_node),None)
        # The inactive hand may carry its weapon across the oblique firing stance.
        if held and shooting and slot and key != slot and not weapon.get('alwaysForward'):
            continue
        if not weapon.get('alwaysForward') and not (held and shooting):
            continue
        forward=ref.matrix_world.to_quaternion() @ Vector((0,-1,0))
        assert forward.y<-.999, f'{spec["id"]}/{slot}/{key}: firing axis {tuple(forward)}'
        if held and shooting and hand_pose:
            tip=bpy.data.objects[held.get('forearmTip',held['hand'])]
            direction=(tip.matrix_world.translation-tip.parent.matrix_world.translation).normalized()
            assert direction.dot(forward) > .90, f'{spec["id"]}/{slot}/{key}: barrel diverges from the anatomical forearm'


def verify_feather_planes(meshes, segments):
    measured=0
    for parent,end,side in segments:
        x,_,z=end
        length=math.hypot(x,z)
        aft=(side*z/length,-abs(x)/length)
        feathers=[obj for obj in meshes if obj.parent.name==parent and
                  obj.name.startswith(('Fanned primary feather','Overlapping secondary feather','Layered shoulder covert'))]
        assert feathers, parent+': feather row missing'
        for obj in feathers:
            points=[obj.matrix_local @ v.co for v in obj.data.vertices]
            assert all(p.x*aft[0]-p.y*aft[1]>=.024 for p in points), parent+': feather precedes wing bone'
        if feathers[0].name.startswith('Fanned primary feather'):
            vanes=[obj for obj in meshes if obj.parent.name==parent and obj.name.startswith('Remex central vane')]
            directions=[obj.matrix_local.to_3x3() @ obj.data.vertices[4].co-
                        obj.matrix_local.to_3x3() @ obj.data.vertices[0].co for obj in vanes]
            assert len(vanes)==len(feathers), parent+': incomplete feather shafts'
            assert min(a.normalized().dot(b.normalized()) for a in directions for b in directions)<.9, parent+': parallel primary feathers'
        measured+=len(feathers)
    return measured
