"""Import the studio's resolved geometry into Blender; never regenerate geographic placement."""
import json
import math
import base64
import zlib
from pathlib import Path

import bpy
import numpy as np


def import_geographic_scene(filepath):
    source = Path(filepath).resolve()
    if source.stat().st_size > 128 * 1024 * 1024:
        raise ValueError('Geographic snapshot exceeds 128 MiB')
    data = json.loads(source.read_text(encoding='utf-8'))
    if data.get('schema') != 'steel-geographic-scene-v1' or data.get('axis') != 'Y-up' or data.get('encoding') != 'typed-le-deflate-base64':
        raise ValueError('Unsupported geographic snapshot')
    geometries, rows = data['geometries'], data['meshes']
    for geo in geometries:
        for key, kind in [('vertices', '<f4'), ('colors', '<f4'), ('indices', '<u4')]:
            limit = (geo['indexCount'] if key == 'indices' else geo['vertexCount'] * 3) * 4
            if not 0 <= limit <= 192 * 1024 * 1024:
                raise ValueError('Mesh channel exceeds byte budget')
            inflater = zlib.decompressobj()
            raw = inflater.decompress(base64.b64decode(geo[key], validate=True), limit + 1)
            if len(raw) > limit or not inflater.eof or inflater.unconsumed_tail:
                raise ValueError('Invalid compressed mesh channel')
            geo[key] = np.frombuffer(raw, dtype=kind)
        vertices, colors, indices = geo['vertices'], geo['colors'], geo['indices']
        if len(vertices) % 3 or len(indices) % 3 or len(colors) not in (0, len(vertices)):
            raise ValueError('Invalid mesh channels')
        if not np.isfinite(vertices).all() or not np.isfinite(colors).all():
            raise ValueError('Non-finite mesh channels')
        if len(indices) and indices.max() >= len(vertices) // 3:
            raise ValueError('Invalid triangle index')
    vertex_count = 0
    for row in rows:
        if type(row['geometry']) is not int or not 0 <= row['geometry'] < len(geometries) or not row['materials']:
            raise ValueError('Invalid geometry or materials')
        for instance in row['instances']:
            if len(instance['matrix']) != 16 or len(instance['color']) != 3:
                raise ValueError('Invalid instance channels')
            if not all(math.isfinite(v) for v in instance['matrix'] + instance['color']):
                raise ValueError('Non-finite instance channels')
        vertex_count += len(geometries[row['geometry']]['vertices']) // 3 * len(row['instances'])
    if vertex_count > 16_000_000:
        raise ValueError('Expanded scene exceeds vertex budget')

    original_engine = bpy.context.scene.render.engine
    scene = bpy.data.scenes.new('Geographic/' + data['metadata']['venue']['id'])
    scene.render.engine = original_engine
    scene['geographic_metadata'] = json.dumps(data['metadata'], ensure_ascii=False)
    scene['source_snapshot'] = str(source)
    scene['omitted_models'] = json.dumps(data.get('omitted', []))
    collection = bpy.data.collections.new('Resolved geographic models')
    scene.collection.children.link(collection)
    probe = bpy.data.meshes.new('Geographic schema')
    params = probe.color_attributes.bl_rna.functions['new'].parameters
    color_type = next(i.identifier for i in params['type'].enum_items if i.identifier == 'FLOAT_COLOR')
    color_domain = next(i.identifier for i in params['domain'].enum_items if i.identifier == 'CORNER')
    bpy.data.meshes.remove(probe)
    objects = 0
    for row in rows:
        geo = geometries[row['geometry']]
        if not len(geo['indices']) or not row['instances']:
            continue
        src_vertices = geo['vertices'].reshape(-1, 3)
        triangles = geo['indices'].reshape(-1, 3)
        nv, nf, count = len(src_vertices), len(triangles), len(row['instances'])
        vertices = np.empty((count, nv, 3), dtype=np.float32)
        indices = np.empty((count, nf, 3), dtype=np.int32)
        loop_colors = np.ones((count, nf, 3, 4), dtype=np.float32)
        slots = np.zeros(nf, dtype=np.int32)
        for group in geo['groups']:
            slots[group['start'] // 3:(group['start'] + group['count']) // 3] = min(max(0, group['materialIndex']), len(row['materials']) - 1)
        palette = np.array([m['color'] for m in row['materials']], dtype=np.float32)[slots]
        use_colors = np.array([m['vertexColors'] for m in row['materials']])[slots]
        color_source = geo['colors'].reshape(-1, 3) if len(geo['colors']) else None
        for n, instance in enumerate(row['instances']):
            matrix = np.array(instance['matrix'], dtype=np.float32).reshape(4, 4).T
            world = src_vertices @ matrix[:3, :3].T + matrix[:3, 3]
            vertices[n, :, 0] = world[:, 0]
            vertices[n, :, 1] = -world[:, 2]
            vertices[n, :, 2] = world[:, 1]
            ordered = triangles[:, ::-1] if np.linalg.det(matrix[:3, :3]) < 0 else triangles
            indices[n] = ordered + n * nv
            loop_colors[n, :, :, :3] = palette[:, None, :] * np.array(instance['color'], dtype=np.float32)
            if color_source is not None:
                loop_colors[n, use_colors, :, :3] *= color_source[ordered[use_colors]]
        np.clip(loop_colors, 0, 1, out=loop_colors)
        mesh = bpy.data.meshes.new(row['name'])
        mesh.vertices.add(count * nv)
        mesh.vertices.foreach_set('co', vertices.ravel())
        mesh.loops.add(count * nf * 3)
        mesh.loops.foreach_set('vertex_index', indices.ravel())
        mesh.polygons.add(count * nf)
        mesh.polygons.foreach_set('loop_start', np.arange(count * nf, dtype=np.int32) * 3)
        mesh.polygons.foreach_set('loop_total', np.full(count * nf, 3, dtype=np.int32))
        mesh.update()
        colors = mesh.color_attributes.new(name='GeographicColor', type=color_type, domain=color_domain)
        colors.data.foreach_set('color', loop_colors.ravel())
        mesh.polygons.foreach_set('material_index', np.tile(slots, count))
        for spec in row['materials']:
            material = bpy.data.materials.new(row['name'] + '/surface')
            material.use_nodes = True
            shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            shader.inputs['Roughness'].default_value = spec['roughness']
            shader.inputs['Metallic'].default_value = spec['metalness']
            shader.inputs['Alpha'].default_value = spec['opacity']
            color = material.node_tree.nodes.new('ShaderNodeVertexColor')
            color.layer_name = colors.name
            material.node_tree.links.new(color.outputs['Color'], shader.inputs['Base Color'])
            mesh.materials.append(material)
        obj = bpy.data.objects.new(row['name'], mesh)
        collection.objects.link(obj)
        objects += 1
    if not objects:
        raise ValueError('Snapshot contains no renderable meshes')
    if bpy.context.window:
        bpy.context.window.scene = scene
    return scene, collection
