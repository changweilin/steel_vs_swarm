"""Render production batches in an editable Blender contact sheet without replacing user scenes."""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/facade_review'
models = json.loads((OUT / 'review.json').read_text(encoding='utf8'))['models']
scene = bpy.data.scenes.new('Facade Runtime Review')
bpy.context.window.scene = scene


def socket(sockets, identifier):
    return next(s for s in sockets if s.identifier == identifier)


mat = bpy.data.materials.new('Facade runtime vertex colors')
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
socket(bsdf.inputs, 'Roughness').default_value = 0.85
color_node = mat.node_tree.nodes.new('ShaderNodeVertexColor')
color_node.layer_name = 'FacadeColor'
mat.node_tree.links.new(socket(color_node.outputs, 'Color'), socket(bsdf.inputs, 'Base Color'))

for i, model in enumerate(models):
    x, y = (i % 4 - 1.5) * 36, (i // 4 - 0.5) * 36
    for j, row in enumerate(model['rows']):
        v, f = row['vertices'], row['faces']
        data = bpy.data.meshes.new(model['kind'] + f'/{j}')
        data.from_pydata([(v[k] + x, -v[k + 2] + y, v[k + 1]) for k in range(0, len(v), 3)], [],
                         [tuple(f[k:k + 3]) for k in range(0, len(f), 3)])
        data.update()
        attr = data.color_attributes.new(name='FacadeColor', type='FLOAT_COLOR', domain='POINT')
        for k, color in enumerate(attr.data):
            color.color = (*row['colors'][k * 3:k * 3 + 3], 1)
        data.materials.append(mat)
        obj = bpy.data.objects.new(model['kind'] + f'/{j}', data)
        scene.collection.objects.link(obj)
    text = bpy.data.curves.new(model['kind'], type='FONT')
    text.body = model['kind'].replace('_', ' ').upper()
    text.size = 1.2
    label = bpy.data.objects.new(model['kind'] + '/label', text)
    scene.collection.objects.link(label)
    label.location = (x - 10, y - 11, 0.1)

light_data = bpy.data.lights.new('Facade review sun', type='SUN')
light_data.energy = 3
sun = bpy.data.objects.new('Facade review sun', light_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(25), math.radians(-20), math.radians(-25))
world = bpy.data.worlds.new('Facade review world')
world.color = (0.32, 0.32, 0.32)
scene.world = world
camera_data = bpy.data.cameras.new('Facade review camera')
camera = bpy.data.objects.new('Facade review camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (45, -140, 130)
camera.rotation_euler = (Vector((0, 0, 4)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
allowed = [item.identifier for item in camera_data.bl_rna.properties['type'].enum_items]
assert 'ORTHO' in allowed
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 175
scene.camera = camera
scene.render.resolution_x = 2000
scene.render.resolution_y = 1150
scene.render.resolution_percentage = 100
formats = [item.identifier for item in scene.render.image_settings.bl_rna.properties['file_format'].enum_items]
assert 'PNG' in formats
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(OUT / 'facades.png')
if bpy.context.screen:
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_location = (0, 0, 4)
            area.spaces.active.region_3d.view_distance = 150
            area.spaces.active.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'facade_review.blend'), copy=True)
bpy.ops.render.render(write_still=True)
print(json.dumps({'scene': scene.name, 'buildings':len(models), 'render':str(OUT / 'facades.png')}))
