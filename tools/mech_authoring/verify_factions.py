"""Reopen editable faction outputs without relying on the live authoring session."""
import hashlib
import json
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent.parent
contract = json.loads((ROOT / 'tools/mech_authoring/factions.json').read_text(encoding='utf8'))
assets = []
for asset_id in contract['assets']:
    directory = ROOT / 'out/faction_reference' / asset_id
    file = directory / (asset_id + '.blend')
    report = json.loads((directory / 'validation.json').read_text(encoding='utf8'))
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    assert digest == report['hashes']['blend'], 'Stale editable output: ' + asset_id
    bpy.ops.wm.open_mainfile(filepath=str(file))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    assert len(rigs) == 1, 'Missing armature: ' + asset_id
    assert len(rigs[0].data.bones) == report['measurements']['joints'], 'Joint count drift: ' + asset_id
    assert all(bone.constraints for bone in rigs[0].pose.bones), 'Unbound bone: ' + asset_id
    assert not any(image.filepath and not image.packed_file for image in bpy.data.images if image.source == 'FILE'), 'External image dependency: ' + asset_id
    clips = {track.name for obj in bpy.context.scene.objects if obj.animation_data for track in obj.animation_data.nla_tracks}
    assert set(report['clips']) <= clips, 'Missing actions: ' + asset_id
    assets.append({'asset': asset_id, 'blend': digest, 'bones': len(rigs[0].data.bones), 'clips': sorted(clips)})
output = ROOT / 'out/faction_reference/blender-reopen.json'
output.write_text(json.dumps({'blender': bpy.app.version_string, 'assets': assets, 'gate': 'pass'}, indent=2), encoding='utf8')
print('REOPEN_PASS', len(assets))
