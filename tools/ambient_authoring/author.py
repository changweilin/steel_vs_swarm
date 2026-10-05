"""Blender source for articulated wildlife and reusable weather effect surfaces."""
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.data.scenes.get('Ambient Wildlife and Weather') or bpy.data.scenes.new('Ambient Wildlife and Weather')
for previous in list(scene.objects):
    previous_mesh = previous.data
    bpy.data.objects.remove(previous, do_unlink=True)
    if previous_mesh and previous_mesh.users == 0:
        bpy.data.meshes.remove(previous_mesh)
bpy.context.window.scene = scene
animals, surfaces = {}, {}
current = None


def mesh(name, vertices, faces, color, pivot=(0, 0, 0), **motion):
    data = bpy.data.meshes.new(name)
    data.from_pydata([(x, -z, y) for x, y, z in vertices], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    mat = bpy.data.materials.get('Ambient %06x' % color) or bpy.data.materials.new('Ambient %06x' % color)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = tuple(((color >> shift) & 255) / 255 for shift in (16, 8, 0))
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .78
    mat.diffuse_color = (*rgb, 1)
    data.materials.append(mat)
    obj.location = (pivot[0], -pivot[2], pivot[1])
    obj['species'] = current or 'surface'
    obj['part'] = name.split('/')[-1]
    exported = {'vertices': [round(v, 6) for p in vertices for v in p],
                'faces': [i for poly in data.polygons for i in poly.vertices]}
    if current:
        part = {'key': obj['part'], 'g': ['mesh', exported], 'c': color, 'p': list(pivot), **motion}
        animals[current].append(part)
    else:
        surfaces[name] = exported
    return obj


def oval(key, center, radii, color, pivot=None, **motion):
    # Twelve meridians retain rounded anatomy without a smooth high-poly asset.
    sides, rows = 12, 7
    origin = pivot or (0, 0, 0)
    vertices = [[center[0] - origin[0], center[1] - radii[1] - origin[1], center[2] - origin[2]]]
    faces = []
    for row in range(1, rows - 1):
        latitude = -math.pi / 2 + row / (rows - 1) * math.pi
        for i in range(sides):
            a = i / sides * math.tau
            vertices.append([center[0] + radii[0] * math.cos(latitude) * math.cos(a) - origin[0],
                             center[1] + radii[1] * math.sin(latitude) - origin[1],
                             center[2] + radii[2] * math.cos(latitude) * math.sin(a) - origin[2]])
            if row > 1:
                b = 1 + (row - 2) * sides + i
                c = 1 + (row - 2) * sides + (i + 1) % sides
                faces.append((b, c, c + sides, b + sides))
    top = len(vertices)
    vertices.append([center[0] - origin[0], center[1] + radii[1] - origin[1], center[2] - origin[2]])
    for i in range(sides):
        faces.append((0, 1 + (i + 1) % sides, 1 + i))
        faces.append((top, 1 + (rows - 3) * sides + i, 1 + (rows - 3) * sides + (i + 1) % sides))
    return mesh(current + '/' + key, vertices, faces, color, origin, **motion)


def ribbon(key, path, widths, color, pivot=(0, 0, 0), **motion):
    vertices, faces = [], []
    for row, (point, radius) in enumerate(zip(path, widths)):
        for i in range(8):
            angle = i / 8 * math.tau
            vertices.append([point[0] + math.cos(angle) * radius - pivot[0],
                             point[1] - pivot[1], point[2] + math.sin(angle) * radius - pivot[2]])
            if row:
                a, b = (row - 1) * 8 + i, (row - 1) * 8 + (i + 1) % 8
                faces.append((a, b, b + 8, a + 8))
    faces.extend([tuple(reversed(range(8))), tuple((len(path) - 1) * 8 + i for i in range(8))])
    return mesh(current + '/' + key, vertices, faces, color, pivot, **motion)


def fin(key, outline, color, pivot=(0, 0, 0), thickness=.012, **motion):
    normal = (Vector(outline[1]) - Vector(outline[0])).cross(Vector(outline[2]) - Vector(outline[0])).normalized()
    vertices = [list(Vector(point) - Vector(pivot) + normal * side * thickness / 2)
                for side in (-1, 1) for point in outline]
    n = len(outline)
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return mesh(current + '/' + key, vertices, faces, color, pivot, **motion)


def eyes(x, y, z, radius=.013):
    for sign, side in ((1, 'L'), (-1, 'R')):
        oval('eye' + side, (sign * x, y, z), (radius, radius, radius * .7), 0x17191c)


def begin(species):
    global current
    current = species
    animals[species] = []


def quadruped(species, coat, light, radius, length, head_z, floor):
    begin(species)
    oval('body', (0, .035, 0), (radius, radius, length), coat)
    oval('chest', (0, .03, length * .64), (radius * .9, radius * 1.05, length * .55), light)
    oval('head', (0, radius * .95, head_z), (radius * .8, radius * .82, radius * .82), light)
    eyes(radius * .60, radius * 1.12, head_z + radius * .55)
    for sign, side in ((1, 'L'), (-1, 'R')):
        for front, label in ((1, 'F'), (-1, 'B')):
            hip = (sign * radius * .65, .02, front * length * .67)
            oval('leg' + label + side, (hip[0], (floor + hip[1]) / 2, hip[2]),
                 (radius * .25, (hip[1] - floor) / 2, radius * .3), coat,
                 pivot=hip, leg=sign * front)
    return radius


for species, coat, light, radius, length, head_z, floor in [
    ('cat', 0xc49a70, 0xe5c7a5, .105, .22, .245, -.15),
    ('dog', 0x96734b, 0xc4ab85, .145, .29, .32, -.22),
    ('rabbit', 0xb2a89b, 0xe7e0d4, .12, .17, .18, -.10),
    ('squirrel', 0x985b32, 0xd6b38b, .095, .155, .17, -.09),
]:
    quadruped(species, coat, light, radius, length, head_z, floor)
    if species == 'dog':
        oval('muzzle', (0, .13, .43), (.075, .06, .095), 0x6d5340)
        oval('nose', (0, .145, .515), (.026, .02, .017), 0x29221c)
    for sign, side in ((1, 'L'), (-1, 'R')):
        x = sign * radius * .55
        if species == 'rabbit':
            oval('ear' + side, (x, .29, .18), (.036, .16, .026), coat)
            oval('earInner' + side, (x, .30, .202), (.020, .12, .009), 0xd2a5a0)
        elif species == 'dog':
            oval('ear' + side, (sign * .115, .18, .30), (.042, .08, .055), 0x68472e)
        else:
            ribbon('ear' + side, [(x, radius * 1.3, head_z), (x * 1.1, radius * 2.0, head_z - .01)],
                   [.040, .001], coat)
    if species == 'rabbit':
        oval('tail', (0, .06, -.19), (.058, .052, .055), 0xf0eadd)
    elif species == 'squirrel':
        pivot = (0, .02, -.14)
        ribbon('tail', [pivot, (0, .15, -.27), (0, .36, -.26), (0, .40, -.12)],
               [.025, .08, .095, .01], coat, pivot=pivot, tail=1)
    else:
        pivot = (0, .04, -length * .85)
        ribbon('tail', [pivot, (0, .12, -length - .12), (.025, .25, -length - .14)],
               [.03, .025, .005], coat, pivot=pivot, tail=1)

begin('bird')
oval('body', (0, 0, 0), (.08, .085, .19), 0x5b6168)
oval('head', (0, .07, .16), (.065, .07, .07), 0x717a85)
oval('breast', (0, -.025, .08), (.072, .045, .12), 0xb5b9b9)
fin('beak', [(0, .06, .30), (-.04, .04, .20), (.04, .04, .20)], 0xc69852, thickness=.04)
eyes(.05, .09, .20, .010)
fin('tail', [(-.07, .05, -.15), (.07, .05, -.15), (.09, .09, -.32), (-.09, .09, -.32)], 0x434a53)
animals['bird'][-1]['r'] = [-.2, 0, 0]
for sign, side in ((1, 'L'), (-1, 'R')):
    fin('wing' + side, [(sign * x, y, z) for x, y, z in [(.065, .02, .08), (.22, .035, .09),
        (.43, .015, -.12), (.31, .025, -.12), (.25, .035, -.20), (.10, .02, -.08)]],
        0x414a56, pivot=(sign * .065, .02, 0), wing=sign)

begin('fish')
oval('body', (0, 0, 0), (.075, .12, .255), 0x527c85)
oval('head', (0, 0, .19), (.06, .09, .085), 0x87a8a4)
eyes(.05, .04, .23, .011)
fin('dorsal', [(0, .06, .08), (0, .20, -.06), (0, .08, -.17)], 0x385b6b, thickness=.015)
for sign, side in ((1, 'L'), (-1, 'R')):
    fin('pectoral' + side, [(sign * .04, -.03, .10), (sign * .14, -.06, -.03), (sign * .05, -.04, -.05)], 0x799e9f)
fin('tail', [(0, 0, -.21), (0, .13, -.38), (0, -.13, -.38)], 0x47758b,
    pivot=(0, 0, -.21), thickness=.016, tail=1)

begin('duck')
oval('body', (0, .05, 0), (.14, .115, .24), 0x807562)
oval('neck', (0, .17, .15), (.064, .14, .062), 0xd3c7ae)
oval('head', (0, .29, .19), (.085, .079, .095), 0x3e6d57)
oval('beak', (0, .28, .30), (.061, .022, .075), 0xc7a24e)
eyes(.072, .31, .24)
fin('tail', [(-.09, .07, -.16), (.09, .07, -.16), (0, .13, -.33)], 0x494e4d)
for sign, side in ((1, 'L'), (-1, 'R')):
    oval('wing' + side, (sign * .123, .09, -.04), (.026, .07, .17), 0x9b9280)
    fin('leg' + side, [(sign * .08, -.075, .075), (sign * .14, -.075, .01), (sign * .03, -.075, -.03)],
        0xc18d36, pivot=(sign * .08, -.025, 0), leg=sign)

begin('frog')
oval('body', (0, .035, 0), (.12, .077, .14), 0x657e43)
oval('head', (0, .07, .11), (.125, .075, .09), 0x839953)
for sign, side in ((1, 'L'), (-1, 'R')):
    oval('eyeRidge' + side, (sign * .075, .125, .135), (.045, .047, .036), 0x95ab62)
    oval('eye' + side, (sign * .075, .132, .164), (.026, .026, .011), 0xdec474)
    oval('pupil' + side, (sign * .075, .133, .174), (.016, .021, .005), 0x182719)
    oval('legB' + side, (sign * .13, 0, -.085), (.07, .045, .075), 0x516837,
         pivot=(sign * .09, .03, -.04), leg=sign)
    oval('legF' + side, (sign * .105, -.015, .105), (.04, .018, .085), 0x768749,
         pivot=(sign * .08, .01, .09), leg=-sign)

begin('turtle')
oval('body', (0, .02, 0), (.155, .065, .22), 0x958458)
oval('shell', (0, .09, -.01), (.165, .11, .21), 0x5e684b)
oval('shellCrown', (0, .155, -.01), (.10, .05, .14), 0x78805d)
oval('head', (0, .02, .265), (.063, .054, .095), 0x8c9b68)
eyes(.047, .038, .30, .009)
for sign, side in ((1, 'L'), (-1, 'R')):
    for front, label in ((1, 'F'), (-1, 'B')):
        oval('leg' + label + side, (sign * .135, -.05, front * .125), (.045, .032, .065), 0x879469,
             pivot=(sign * .11, 0, front * .11), leg=sign * front)

begin('butterfly')
oval('body', (0, 0, 0), (.014, .014, .075), 0x343129)
for sign, side in ((1, 'L'), (-1, 'R')):
    outline = [(sign * x, y, z) for x, y, z in [(.01, 0, .04), (.08, .01, .13),
        (.15, .006, .10), (.17, .004, .02), (.10, .008, -.02), (.13, .008, -.10),
        (.07, .006, -.14), (.01, 0, -.05)]]
    fin('wing' + side, outline, 0xdb984c, pivot=(sign * .014, 0, 0), thickness=.004, wing=sign)
    # Dark margins and contrasting spots remain attached to the same wing matrix.
    part = animals[current][-1]
    part['g'][1]['colors'] = [v for p in outline * 2 for v in
        ((.075, .065, .055) if abs(p[0]) > .12 else (.71, .32, .075))]

current = None
for name, outline in [
    ('leaf', [(0, -.5), (.19, -.31), (.43, -.16), (.30, .03), (.40, .19),
              (.17, .24), (0, .5), (-.17, .24), (-.40, .19), (-.30, .03), (-.43, -.16), (-.19, -.31)]),
    ('petal', [(0, -.5), (.27, -.24), (.45, .10), (.34, .36), (.08, .5),
               (0, .41), (-.08, .5), (-.34, .36), (-.45, .10), (-.27, -.24)]),
]:
    vertices = [(0, 0, .04)] + [(x, y, -.025 * abs(x) + .035 * y * y) for x, y in outline]
    faces = [(0, i + 1, (i + 1) % len(outline) + 1) for i in range(len(outline))]
    mesh(name, vertices, faces, 0xb98c4c)

# The asymmetric taper keeps a distinct flame silhouette as its height changes.
vertices, faces = [], []
profile = [(0, .18, 0), (.16, .5, 0), (.4, .37, -.06), (.62, .26, .04),
           (.83, .12, .16), (1, .001, .24)]
for row, (height, radius, bend) in enumerate(profile):
    for i in range(12):
        a = i / 12 * math.tau
        vertices.append((math.cos(a) * radius + bend, height - .5,
                         math.sin(a) * radius * .64 + .035 * math.sin(height * 9)))
        if row:
            p, q = (row - 1) * 12 + i, (row - 1) * 12 + (i + 1) % 12
            faces.append((p, q, q + 12, p + 12))
faces += [tuple(reversed(range(12))), tuple(60 + i for i in range(12))]
mesh('flame', vertices, faces, 0xe97626)

# Keep source geometry in local axes; gallery placement is display-only.
for index, species in enumerate(animals):
    for obj in scene.objects:
        if obj.get('species') == species:
            obj.location += Vector((index % 5 * 1.3, -(index // 5) * 1.5, .35))
for index, name in enumerate(surfaces):
    bpy.data.objects[name].location = (index * 1.3, -3.2, .55)

out = ROOT / 'out/atmosphere_review'
out.mkdir(parents=True, exist_ok=True)
text = '// Generated by tools/ambient_authoring/author.py via Blender MCP. Metres; game axes X/Y/Z.\n'
text += 'export const WILDLIFE_MESHES = Object.freeze(' + json.dumps(animals, separators=(',', ':')) + ');\n'
text += 'export const AMBIENT_SURFACES = Object.freeze(' + json.dumps(surfaces, separators=(',', ':')) + ');\n'
(ROOT / 'public/js/ambientMeshData.js').write_text(text, encoding='utf8')
bpy.data.libraries.write(str(out / 'ambient-wildlife-weather.blend'), {scene})
print(json.dumps({'scene': scene.name, 'species': list(animals), 'surfaces': list(surfaces),
    'objects': len(scene.objects), 'triangles': sum(len(o.data.polygons) for o in scene.objects)}))
