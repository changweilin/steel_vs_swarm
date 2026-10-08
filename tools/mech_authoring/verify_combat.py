"""Reopen every editable combat scene and validate its shared rigid animation drivers."""
import hashlib
import json
import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/combat_reference'
results = {}
for directory in sorted(OUT.iterdir()):
    blend = directory / (directory.name + '.blend')
    if not blend.is_file():
        continue
    id = directory.name
    original = json.loads((ROOT / 'public/js/forge/assets' / (id + '.js')).read_text(encoding='utf8').split('export default ', 1)[1].rsplit(';', 1)[0])
    effects = json.loads((ROOT / 'public/js/forge/combatAssets' / (id + '.js')).read_text(encoding='utf8').split('export default ', 1)[1].rsplit(';', 1)[0])
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    skeleton = bpy.data.objects.get(id + '_skeleton')
    expected = {name for name, _, _ in original['joints']}
    assert skeleton and set(skeleton.data.bones.keys()) == expected, id + ': original skeleton changed'
    nodes = {name: bpy.data.objects[name] for name, _, _ in original['joints'] + effects['joints']}
    for name, parent, _ in effects['joints']:
        assert parent is None or nodes[name].parent == nodes[parent], id + ': detached effect ' + name
    inventory = [obj for obj in bpy.data.objects if obj.type == 'MESH' and obj.get('presentation_effect')]
    assert inventory and all(obj.parent in nodes.values() for obj in inventory), id + ': unowned geometry'
    fan_bounds = {}
    for slot, ownership in effects['combat']['fans'].items():
        half = effects['combat']['intent']['weapons'][slot]['arc']
        span = half * 2 / ownership['count']
        meshes = [obj for obj in inventory if obj.parent.name == 'fx_' + slot + '_ion']
        assert meshes and all('fan_bin' in obj for obj in meshes), id + ': lost source sub-cone ownership'
        for obj in meshes:
            bin = obj['fan_bin']
            assert 0 <= bin < ownership['count'], id + ': invalid source sub-cone'
            lo, hi = -half + bin * span, -half + (bin + 1) * span
            for vertex in obj.data.vertices:
                x, z = vertex.co.x, -vertex.co.y
                assert x * math.cos(lo) - z * math.sin(lo) >= -.000001 and \
                    x * math.cos(hi) - z * math.sin(hi) <= .000001, id + ': overlapping source sub-cones'
        fan_bounds[slot] = {'subCones': ownership['count'], 'parts': len(meshes)}
    field_bounds = {}
    def refresh_frame(frame):
        bpy.context.scene.frame_set(frame)
        # Scripted NLA switches update channel values before cached world matrices.
        for obj in bpy.context.scene.objects:
            obj.update_tag(refresh={'OBJECT'})
        bpy.context.view_layer.update()

    for slot in ['light', 'heavy', 'def', 'atk']:
        for node in nodes.values():
            tracks = node.animation_data.nla_tracks
            assert slot in tracks, id + ': missing source action ' + slot
            for track in tracks:
                track.mute = track.name != slot
        refresh_frame(13)
        assert any(min(nodes[name].scale) > .01 for name, _, _ in effects['joints'] if name != 'fx_guard'), id + ': frozen ' + slot
        if slot == 'def':
            assert min(nodes['fx_guard'].scale) > .01, id + ': missing defense shield'
        field = effects['combat']['fields'].get(slot)
        if field:
            radius = field['radius'] or original['height'] * .6
            meshes = [obj for obj in inventory if obj.parent.name in field['nodes']]
            maximum = 0
            for frame in range(1, 32):
                refresh_frame(frame)
                inverse = bpy.data.objects[id].matrix_world.inverted()
                for obj in meshes:
                    transform = inverse @ obj.matrix_world
                    maximum = max(maximum, max((transform @ vertex.co).length for vertex in obj.data.vertices))
            assert maximum <= radius * 1.0001, id + ': source field escapes settled radius ' + slot
            assert maximum > radius * .1, id + ': source field never deploys ' + slot
            field_bounds[slot] = {'radius': radius, 'maximum': maximum}
    report = json.loads((directory / 'validation.json').read_text(encoding='utf8'))
    fingerprint = hashlib.sha256(blend.read_bytes()).hexdigest()
    assert fingerprint == report['hashes']['blend'], id + ': editable source hash drift'
    results[id] = {'blend': fingerprint, 'bones': len(expected), 'effectParts': len(inventory),
                   'actions': ['light', 'heavy', 'def', 'atk'], 'fieldBounds': field_bounds, 'fanBounds': fan_bounds}
assert len(results) == 32, 'Incomplete editable combat roster'
(OUT / 'source-validation.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')
print('Reopened 32 combat scenes: original skeletons, attached effects and four synchronized actions verified')
