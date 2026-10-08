"""Assemble and render exact runtime meshes in independent, editable Blender scenes."""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(globals().get('REVIEW_OUT', ROOT / 'out/road_structure_review'))
models = json.loads((OUT / 'review.json').read_text(encoding='utf8'))['models']
if globals().get('REVIEW_KEYS'):
    models = [model for model in models if model['key'] in REVIEW_KEYS]
scenes = {}
materials = {}


def enum_set(obj, prop, value):
    allowed = [item.identifier for item in obj.bl_rna.properties[prop].enum_items]
    if value not in allowed:
        raise ValueError(f'{prop}: {value} unavailable in {allowed}')
    setattr(obj, prop, value)


def socket(sockets, identifier):
    return next(s for s in sockets if s.identifier == identifier)


def material(key, row):
    if key in materials:
        return materials[key]
    mat = bpy.data.materials.new('Road review material')
    mat.use_nodes = True
    mat.use_backface_culling = row.get('side', 2) == 0
    mat.diffuse_color = (*row['color'], 1)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    socket(bsdf.inputs, 'Base Color').default_value = (*row['color'], 1)
    socket(bsdf.inputs, 'Roughness').default_value = .83
    if row.get('emission'):
        socket(bsdf.inputs, 'Emission Color').default_value = (*row['color'], 1)
        socket(bsdf.inputs, 'Emission Strength').default_value = row['emission']
    if row.get('colors'):
        node = nodes.new('ShaderNodeVertexColor')
        node.layer_name = 'RoadColor'
        links.new(socket(node.outputs, 'Color'), socket(bsdf.inputs, 'Base Color'))
    if row.get('texture'):
        texture = nodes.new('ShaderNodeTexImage')
        # Reused review paths must not borrow a previous scene's packed atlas.
        texture.image = bpy.data.images.load(str(OUT / 'textures' / (row['texture'] + '.png')), check_existing=False)
        texture.image.pack()
        mix = nodes.new('ShaderNodeMixRGB')
        enum_set(mix, 'blend_type', 'MULTIPLY')
        socket(mix.inputs, 'Fac').default_value = 1
        socket(mix.inputs, 'Color2').default_value = (*row['color'], 1)
        if row.get('colors'):
            links.new(socket(node.outputs, 'Color'), socket(mix.inputs, 'Color2'))
        links.new(socket(texture.outputs, 'Color'), socket(mix.inputs, 'Color1'))
        links.new(socket(mix.outputs, 'Color'), socket(bsdf.inputs, 'Base Color'))
        links.new(socket(texture.outputs, 'Alpha'), socket(bsdf.inputs, 'Alpha'))
    if row.get('glow'):
        glow = nodes.new('ShaderNodeVertexColor')
        glow.layer_name = 'SignGlow'
        links.new(socket(glow.outputs, 'Color'), socket(bsdf.inputs, 'Emission Strength'))
        links.new(socket(mix.outputs, 'Color'), socket(bsdf.inputs, 'Emission Color'))
    materials[key] = mat
    return mat


def xyz(p):
    return (p[0], -p[2], p[1])


def assemble(scene, rows, label):
    groups = {}
    for row in rows:
        key = (tuple(row['color']), bool(row.get('colors')), row.get('texture'), row.get('side', 2), row.get('emission', 0), bool(row.get('glow')))
        group = groups.setdefault(key, {'vertices': [], 'faces': [], 'colors': [], 'uvs': [], 'glow': [], 'row': row})
        base = len(group['vertices'])
        v, f = row['vertices'], row['faces']
        group['vertices'].extend(xyz(v[i:i + 3]) for i in range(0, len(v), 3))
        group['faces'].extend(tuple(base + index for index in f[i:i + 3]) for i in range(0, len(f), 3))
        if row.get('colors'):
            colors = row['colors']
            group['colors'].extend(tuple(colors[i + k] * row['color'][k] for k in range(3)) + (1,)
                                   for i in range(0, len(colors), 3))
        if row.get('uvs'):
            group['uvs'].extend(tuple(row['uvs'][i:i + 2]) for i in range(0, len(row['uvs']), 2))
        if row.get('glow'):
            group['glow'].extend(row['glow'])
    objects = []
    for index, (key, row) in enumerate(groups.items()):
        data = bpy.data.meshes.new(f'{label} {index}')
        data.from_pydata(row['vertices'], [], row['faces'])
        data.update()
        if row['colors']:
            attr = data.color_attributes.new(name='RoadColor', type='FLOAT_COLOR', domain='POINT')
            attr.data.foreach_set('color', [value for color in row['colors'] for value in color])
        if row['glow']:
            attr = data.color_attributes.new(name='SignGlow', type='FLOAT_COLOR', domain='POINT')
            attr.data.foreach_set('color', [value for glow in row['glow'] for value in (glow, glow, glow, 1)])
        if row['uvs']:
            uv = data.uv_layers.new(name='RoadUV')
            uv.data.foreach_set('uv', [value for loop in data.loops for value in row['uvs'][loop.vertex_index]])
        obj = bpy.data.objects.new(data.name, data)
        scene.collection.objects.link(obj)
        obj.data.materials.append(material(key, row['row']))
        objects.append(obj)
    return objects


def camera(scene, name, target, direction, points, aspect):
    data = bpy.data.cameras.new(name)
    enum_set(data, 'type', 'ORTHO')
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = target + direction.normalized() * 650
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()
    inv = obj.rotation_euler.to_matrix().transposed()
    local = [inv @ (p - target) for p in points]
    width = max(p.x for p in local) - min(p.x for p in local)
    height = max(p.y for p in local) - min(p.y for p in local)
    # Orthographic scale is horizontal; resolution supplies the vertical extent.
    data.ortho_scale = max(width, height * aspect) * 1.15
    data.clip_end = 2000
    scene.camera = obj
    return obj


for model in models:
    scene = bpy.data.scenes.new(globals().get('REVIEW_LABEL', 'Road Review') + ' | ' + model['key'])
    scenes[model['key']] = scene
    scene['review_key'] = model['key']
    scene['production_geometry'] = True
    scene['sectioned_ground'] = model['sectioned']
    scene['lane_guidance'] = bool(model.get('guidance'))
    if model.get('furniture'):
        scene['road_furniture_evidence'] = json.dumps(model['furniture'], separators=(',', ':'))
    objects = assemble(scene, model['parts'], model['key'])
    ground = assemble(scene, [model['ground']], 'Sectioned terrain' if model['sectioned'] else 'Terrain')
    world = bpy.data.worlds.new('Road review daylight')
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    socket(bg.inputs, 'Color').default_value = (.63, .71, .70, 1)
    socket(bg.inputs, 'Strength').default_value = .10 if model.get('night') else .6
    light = bpy.data.lights.new('Road review sun', type='SUN')
    light.energy = .3 if model.get('night') else 2.4
    light.angle = math.radians(14)
    sun = bpy.data.objects.new(light.name, light)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(28), math.radians(-24), math.radians(-28))
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        # The current engine is always valid; keep it if this Blender has a different registry.
        pass
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 880
    scene.render.resolution_percentage = 100
    enum_set(scene.render.image_settings, 'file_format', 'PNG')
    # Keep this Blender's OCIO transform; its dynamic enum is not fully exposed through RNA.
    scene.render.film_transparent = False
    bpy.context.window.scene = scene
    scene.view_layers[0].update()
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    target = (lo + hi) / 2
    scene['focus'] = list(target)
    scene['span'] = max(hi.x - lo.x, hi.y - lo.y, 40)
    camera(scene, 'Road Overview', target, Vector((0, -1, 0)) if model['key'] == 'traffic-sign-library'
           else Vector((-.25, -1.05, .72)), points, 1440 / 880)
    # Keep a reusable close inspection camera for entrances and underside joints.
    detail = bpy.data.cameras.new('Road Detail')
    detail_obj = bpy.data.objects.new(detail.name, detail)
    scene.collection.objects.link(detail_obj)
    detail_obj.location = target + Vector((-40, -45, 24))
    detail_obj.rotation_euler = (target - detail_obj.location).to_track_quat('-Z', 'Y').to_euler()
    detail.lens = 40
    detail.clip_end = 2000
    inspection = model.get('inspection')
    if inspection:
        entrance = Vector(xyz((inspection['x'], inspection['y'], inspection['z'])))
        forward = Vector((inspection['dx'], -inspection['dz'], 0)).normalized()
        detail_obj.location = entrance - forward * 12 + Vector((0, 0, 3.1))
        look = entrance + forward * 32 + Vector((0, 0, 3.1))
        if model['key'] == 'gallery':
            entrance += forward * 64
            side = Vector((forward.y, -forward.x, 0))
            detail_obj.location = entrance + side * 24 + Vector((0, 0, 2.5))
            look = entrance + forward * 18 + Vector((0, 0, 3.1))
        detail_obj.rotation_euler = (look - detail_obj.location).to_track_quat('-Z', 'Y').to_euler()

if globals().get('RENDER_REVIEWS', True):
    for key, scene in scenes.items():
        overview = scene.camera
        scene.render.filepath = str(OUT / (key + '-blender.png'))
        bpy.ops.render.render(write_still=True, scene=scene.name)
        if scene.get('sectioned_ground') or scene.get('lane_guidance'):
            scene.camera = next(obj for obj in scene.objects if obj.type == 'CAMERA' and obj != overview)
            scene.render.filepath = str(OUT / (key + '-detail.png'))
            bpy.ops.render.render(write_still=True, scene=scene.name)
            scene.camera = overview

bpy.context.window.scene = scenes.get('interchange', next(iter(scenes.values())))
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        region = area.spaces.active.region_3d
        enum_set(region, 'view_perspective', 'CAMERA')
blend_path = OUT / globals().get('BLEND_NAME', 'road-structures.blend')
bpy.data.libraries.write(str(blend_path), set(scenes.values()), fake_user=True)
print(json.dumps({'scenes': len(scenes), 'objects': {k: len(s.objects) for k, s in scenes.items()},
                  'output': str(blend_path)}))
