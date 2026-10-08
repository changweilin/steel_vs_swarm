"""Bake bounded shore members in a separate scene; catalog envelopes remain the placement contract."""
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/shoreline_review'
catalog = json.loads((OUT / 'catalog.json').read_text(encoding='utf8'))
scene = bpy.data.scenes.new('Shoreline Facility Library')
bpy.context.window.scene = scene
scene['appearance_only'] = True
palette = {'steel': 0x53656a, 'wood': 0x977149, 'concrete': 0xaaa998, 'dark': 0x303c41,
           'white': 0xe9dfc9, 'orange': 0xe88b43, 'blue': 0x54849a, 'green': 0x6d8660,
           'stone': 0x8d9087, 'yellow': 0xd9bd57}
materials = {}
for key, hex_color in palette.items():
    mat = bpy.data.materials.new('Shore/' + key)
    mat.use_nodes = True
    rgb = tuple(((hex_color >> shift) & 255) / 255 for shift in (16, 8, 0))
    mat.diffuse_color = (*rgb, 1)
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    next(s for s in shader.inputs if s.identifier == 'Base Color').default_value = tuple(
        v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)
    next(s for s in shader.inputs if s.identifier == 'Roughness').default_value = .78
    materials[key] = mat

parts = []
library = {}
size = (1, 1, 1)


def member(shape, dimensions, at, color, direction=None):
    """pre: normalized dimensions fit the catalog; tube axes are supplied in runtime Y-up coordinates."""
    w, h, d = size
    if shape == 'box':
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.scale = (dimensions[0] * w, dimensions[2] * d, dimensions[1] * h)
    elif shape == 'stone':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.5)
        obj = bpy.context.object
        obj.scale = (dimensions[0] * w, dimensions[2] * d, dimensions[1] * h)
    elif shape == 'ring':
        radius = dimensions[0] * min(w, h, d)
        bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=6,
                                       major_radius=radius * .77, minor_radius=radius * .23)
        obj = bpy.context.object
        obj.rotation_euler.x = math.pi / 2
    else:
        radius = dimensions[0] * min(w, d)
        length = dimensions[1] * h
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=length)
        obj = bpy.context.object
        if direction:
            vector = Vector((direction[0], -direction[2], direction[1]))
            obj.rotation_euler = vector.to_track_quat('Z', 'Y').to_euler()
    obj.location = (at[0] * w, -at[2] * d, at[1] * h)
    obj.data.materials.append(materials[color])
    parts.append((obj, palette[color]))
    return obj


def rail(color, rear=.35):
    for x in [-.43, 0, .43]:
        member('box', (.025, .9, .06), (x, .47, rear), color)
    for y in [.48, .92]:
        member('box', (.92, .045, .06), (0, y, rear), color)


def deck(color):
    for i in range(8):
        member('box', (.92, .055, .102), (0, .4, -.42 + i * .12), color)
    for x in [-.36, .36]:
        for z in [-.35, .35]:
            member('box', (.065, .4, .065), (x, .2, z), 'wood')


def stones(variant, cage=False):
    for i in range(7):
        x = (i % 3 - 1) * .3
        z = (i // 3 - 1) * .29
        member('stone', (.38, .56 + (i + variant) % 3 * .09, .45), (x, .3, z), 'stone')
    if cage:
        for x in [-.48, .48]:
            for y in [.12, .45, .78]:
                member('box', (.015, .016, .92), (x, y, 0), 'steel')
        for x in [-.48, -.24, 0, .24, .48]:
            for z in [-.46, .46]:
                member('box', (.015, .86, .015), (x, .43, z), 'steel')
        for y in [.08, .32, .56, .8]:
            for z in [-.46, .46]:
                member('box', (.96, .016, .015), (0, y, z), 'steel')


for kind, spec in catalog['facilities'].items():
    for variant in range(catalog['variants']):
        size = spec['size']
        timber = 'wood' if variant == 0 else 'steel'
        if kind in ['rock_bank', 'riprap', 'gabion', 'breakwater']:
            stones(variant, kind == 'gabion')
            if kind == 'breakwater':
                member('box', (.75, .19, .8), (0, .17, 0), 'concrete')
                for x in [-.28, .28]:
                    member('box', (.12, .65, .13), (x, .5, 0), 'concrete')
        elif kind == 'reed_bank':
            for i in range(11):
                x, z = (i % 4 - 1.5) * .22, (i // 4 - 1) * .32
                height = .56 + (i + variant) % 4 * .1
                member('box', (.013, height, .016), (x, height / 2, z), 'green')
                member('box', (.03, .15, .025), (x, height - .06, z), 'wood')
                leaf = member('box', (.014, height * .52, .025), (x + .015, height * .45, z), 'green')
                leaf.rotation_euler.y = (-1 if i % 2 else 1) * .3
        elif kind in ['dune_fence', 'timber_rail', 'steel_rail']:
            if kind == 'dune_fence':
                for i in range(15):
                    member('box', (.024, .72 + (i + variant) % 3 * .05, .14), (-.46 + i * .066, .43, 0), 'wood')
                for y in [.3, .65]:
                    member('box', (.96, .025, .16), (0, y, 0), 'steel')
            else:
                rail('wood' if kind == 'timber_rail' else 'steel', 0)
        elif kind == 'quay_edge':
            member('box', (.96, .55, .94), (0, .28, 0), 'concrete')
            for i in range(6):
                member('box', (.12, .08, .8), (-.4 + i * .16, .58, 0), 'white' if (i + variant) % 2 else 'yellow')
        elif kind in ['steps', 'boat_ramp']:
            n = 5 if kind == 'steps' else 10
            for i in range(n):
                height = (i + 1) * .8 / n
                member('box', (.92, height, .94 / n), (0, height / 2, .45 - i * .94 / n), 'concrete')
            if kind == 'steps':
                for x in [-.4, .4]:
                    member('box', (.045, .2, .88), (x, .76, 0), timber)
        elif kind == 'life_ring':
            member('box', (.06, .96, .12), (0, .48, -.3), timber)
            member('box', (.8, .08, .3), (0, .81, -.22), 'white')
            member('ring', (.39, 0, 0), (0, .6, .12), 'orange')
            for x in [-.32, .32]:
                member('box', (.13, .055, .2), (x, .6, .12), 'white')
            member('box', (.5, .045, .3), (0, .35, .05), 'white')
        elif kind in ['mooring_bollard', 'mooring_ring']:
            member('box', (.86, .12, .88), (0, .06, 0), 'concrete')
            if kind == 'mooring_bollard':
                member('tube', (.2, .66, 0), (0, .44, 0), 'steel')
                member('box', (.82, .17, .35), (0, .8, 0), 'dark')
            else:
                member('ring', (.34, 0, 0), (0, .49, .1), 'steel')
        elif kind == 'ladder':
            for x in [-.39, .39]:
                member('box', (.06, .96, .12), (x, .48, 0), 'steel')
            for i in range(7):
                member('box', (.82, .03, .18), (0, .1 + i * .13, 0), 'steel')
            for x in [-.39, .39]:
                member('box', (.08, .06, .75), (x, .91, -.12), 'steel')
        elif kind in ['jetty', 'floating_dock', 'fishing_deck']:
            deck(timber)
            if kind == 'floating_dock':
                for x in [-.32, .32]:
                    member('box', (.25, .28, .88), (x, .15, 0), 'blue')
                for x in [-.4, .4]:
                    member('tube', (.05, .18, 0), (x, .53, .34), 'steel')
            else:
                rail(timber, -.43)
                if kind == 'fishing_deck':
                    for x in [-.38, .38]:
                        member('box', (.05, .35, .05), (x, .57, .34), 'steel')
        elif kind == 'kayak_rack':
            for x in [-.36, .36]:
                member('box', (.045, .96, .065), (x, .48, 0), timber)
                for y in [.32, .72]:
                    member('box', (.07, .06, .86), (x, y, 0), timber)
            for i in range(2):
                boat = member('stone', (.87, .13, .34), (0, .39 + i * .4, -.15 + i * .3), 'orange' if variant else 'blue')
                boat.rotation_euler.z = .04 * (1 if i else -1)
        elif kind in ['sluice', 'trash_screen', 'outfall', 'culvert_head']:
            for x in [-.42, .42]:
                member('box', (.16, .83, .85), (x, .415, 0), 'concrete')
            member('box', (.96, .13, .88), (0, .88, 0), 'concrete')
            if kind == 'sluice':
                member('box', (.64, .64, .12), (0, .36, .06), 'blue' if variant else 'steel')
                member('box', (.025, .6, .05), (0, .66, .1), 'steel')
                member('ring', (.14, 0, 0), (0, .91, .16), 'orange')
                for x in [-.31, .31]:
                    member('box', (.04, .82, .18), (x, .46, .07), 'dark')
            elif kind == 'trash_screen':
                for i in range(11):
                    member('box', (.026, .73, .05), (-.32 + i * .064, .38, .12), 'steel')
                member('box', (.7, .05, .09), (0, .36, .12), 'orange')
            else:
                member('ring', (.35, 0, 0), (0, .36, .18), 'steel' if kind == 'outfall' else 'concrete')
                member('box', (.55, .5, .04), (0, .36, -.2), 'dark')
        elif kind == 'pump':
            member('box', (.9, .13, .88), (0, .065, 0), 'concrete')
            member('tube', (.2, .48, 0), (-.18, .39, 0), 'blue')
            member('box', (.35, .43, .45), (.25, .38, 0), 'steel')
            for x in [-.2, .2]:
                member('tube', (.075, .55, 0), (x, .3, .3), 'steel')
            member('box', (.66, .06, .12), (0, .56, .3), 'steel')
            member('box', (.4, .27, .28), (.25, .8, 0), 'dark')
            for i in range(4):
                member('box', (.3, .02, .04), (.25, .73 + i * .05, .16), 'white')
        elif kind == 'gauge':
            member('box', (.7, .98, .35), (0, .49, 0), 'white')
            for i in range(14):
                member('box', (.38 if i % 3 else .62, .015, .08), (-.07, .06 + i * .065, .25), 'dark')
        elif kind == 'groyne':
            for x in [-.43, -.21, 0, .21, .43]:
                member('box', (.08, .92 - (abs(x) * .3), .19), (x, .46, 0), timber)
            for y in [.28, .48, .68]:
                member('box', (.97, .13, .1), (0, y, .06), timber)
        elif kind == 'beach_shower':
            member('box', (.9, .07, .9), (0, .035, 0), 'concrete')
            member('tube', (.055, .88, 0), (0, .5, -.15), 'steel')
            member('box', (.1, .04, .55), (0, .94, .03), 'steel')
            member('box', (.28, .035, .22), (0, .91, .3), 'dark')
            member('box', (.1, .08, .13), (0, .45, .03), 'blue' if variant else 'orange')
        elif kind == 'rescue_tower':
            for x in [-.37, .37]:
                for z in [-.36, .36]:
                    member('box', (.06, .64, .06), (x, .32, z), timber)
            member('box', (.85, .05, .84), (0, .6, 0), timber)
            member('box', (.85, .26, .7), (0, .74, -.07), 'white')
            member('box', (.96, .04, .94), (0, .96, 0), 'orange' if variant else 'blue')
            for x in [-.37, .37]:
                member('box', (.04, .32, .04), (x, .8, .3), timber)
            for i in range(6):
                member('box', (.24, .025, .08), (0, .1 + i * .08, .4), 'steel')
        else:
            raise ValueError('Missing shore recipe: ' + kind)

        scene.view_layers[0].update()
        vertices, colors = [], []
        key = kind + '/' + str(variant)
        collection = bpy.data.collections.new(key)
        collection['shore_model'] = key
        collection['catalog_size'] = list(size)
        scene.collection.children.link(collection)
        for index, (obj, color) in enumerate(parts):
            obj.name = key + '/' + str(index)
            scene.collection.objects.unlink(obj)
            collection.objects.link(obj)
            matrix = obj.matrix_world.copy()
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bmesh.ops.triangulate(bm, faces=list(bm.faces))
            bm.to_mesh(obj.data)
            bm.free()
            obj['shore_asset'] = key
            for face in obj.data.polygons:
                for index in face.vertices:
                    p = matrix @ obj.data.vertices[index].co
                    vertices.extend([round(p.x, 6), round(p.z, 6), round(-p.y, 6)])
                    colors.append(color)
        # Normalize authored dimensions into the sole catalog envelope before export and library placement.
        lo = [min(vertices[i::3]) for i in range(3)]
        hi = [max(vertices[i::3]) for i in range(3)]
        factor = min(size[i] / (hi[i] - lo[i]) for i in range(3))
        center = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
        vertices = [round((v - center[i % 3]) * factor, 6) for i, v in enumerate(vertices)]
        library[key] = {'vertices': vertices, 'colors': colors}
        offset = len(library) - 1
        for obj, _ in parts:
            obj.matrix_world = Matrix.Translation(((offset % 8 - 3.5) * 5.5, -(offset // 8) * 5.5, 0)) \
                @ Matrix.Scale(factor, 4) @ Matrix.Translation((-center[0], center[2], -center[1])) @ obj.matrix_world
        parts.clear()

target = ROOT / 'public/js/shorelineMeshData.js'
target.write_text('// Generated by tools/shoreline_authoring/author.py. Do not edit.\n'
                  + 'export const SHORE_MESHES = Object.freeze('
                  + json.dumps(library, separators=(',', ':')) + ');\n', encoding='utf8')
scene['model_count'] = len(library)
bpy.data.libraries.write(str(OUT / 'shoreline-members.blend'), {scene}, fake_user=True)
print(json.dumps({'scene': scene.name, 'models': len(library),
                  'triangles': sum(len(row['vertices']) // 9 for row in library.values()), 'output': str(target)}))
