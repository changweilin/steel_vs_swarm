"""Preserve shoreline evidence alongside exact runtime meshes in the shared Blender review studio."""
import json
import runpy
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/shoreline_review'
namespace = runpy.run_path(str(ROOT / 'tools/road_structure_authoring/preview.py'), init_globals={
    'REVIEW_OUT': str(OUT), 'REVIEW_LABEL': 'Shoreline Review',
    'BLEND_NAME': 'shoreline-contexts.blend', 'RENDER_REVIEWS': False,
})
scenes = namespace['scenes']
for model in namespace['models']:
    scenes[model['key']]['shore_evidence'] = json.dumps(model.get('shoreEvidence'), separators=(',', ':'))
for key in globals().get('RENDER_KEYS', ['library-0', 'library-1']):
    scene = scenes[key]
    scene.render.filepath = str(OUT / (key + '-blender.png'))
    bpy.ops.render.render(write_still=True, scene=scene.name)
bpy.context.window.scene = scenes['library-0']
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        region = area.spaces.active.region_3d
        region.view_location = Vector(scenes['library-0']['focus'])
        region.view_distance = scenes['library-0']['span'] * 1.5
        region.view_rotation = scenes['library-0'].camera.rotation_euler.to_quaternion()
        namespace['enum_set'](region, 'view_perspective', 'CAMERA')
bpy.data.libraries.write(str(OUT / 'shoreline-contexts.blend'), set(scenes.values()), fake_user=True)
print(json.dumps({'scenes': len(scenes), 'output': str(OUT / 'shoreline-contexts.blend')}))
