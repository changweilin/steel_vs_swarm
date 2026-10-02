"""Reopen the editable files independently; verify joint provenance and recoverable actions."""
import hashlib
import json
import math
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
contract_file = HERE / 'assets.json'
contract = json.loads(contract_file.read_text(encoding='utf8'))
output = (HERE / contract['authoring']['outputs']).resolve()
results = {}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    assert bpy.context.scene.camera is not None, id + ': review camera missing'
    results[id] = {'blend': sha(blend), 'sourceMeshes': len(meshes), 'bones': len(skeleton.data.bones), 'editableClips': report['clips']}
    report['gates']['editable_source'] = 'pass'
    report_file.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')

(output / 'source-validation.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')
print('SOURCE_VALIDATION ' + json.dumps(results), flush=True)
