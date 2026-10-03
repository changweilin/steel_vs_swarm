"""Reopen every editable combat scene and validate its shared rigid animation drivers."""
import hashlib
import json
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
    for slot in ['light', 'heavy', 'def', 'atk']:
        for node in nodes.values():
            tracks = node.animation_data.nla_tracks
            assert slot in tracks, id + ': missing source action ' + slot
            for track in tracks:
                track.mute = track.name != slot
        bpy.context.scene.frame_set(13)
        bpy.context.view_layer.update()
        assert any(min(nodes[name].scale) > .01 for name, _, _ in effects['joints'] if name != 'fx_guard'), id + ': frozen ' + slot
        if slot == 'def':
            assert min(nodes['fx_guard'].scale) > .01, id + ': missing defense shield'
    report = json.loads((directory / 'validation.json').read_text(encoding='utf8'))
    fingerprint = hashlib.sha256(blend.read_bytes()).hexdigest()
    assert fingerprint == report['hashes']['blend'], id + ': editable source hash drift'
    results[id] = {'blend': fingerprint, 'bones': len(expected), 'effectParts': len(inventory), 'actions': ['light', 'heavy', 'def', 'atk']}
assert len(results) == 32, 'Incomplete editable combat roster'
(OUT / 'source-validation.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')
print('Reopened 32 combat scenes: original skeletons, attached effects and four synchronized actions verified')
