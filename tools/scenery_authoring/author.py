"""Author reusable low-poly surfaces without changing the game's placement envelopes."""
import json
import math
from pathlib import Path
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.data.scenes.new('Scenery and Civilian Surfaces')
bpy.context.window.scene = scene
library = {}


def mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, -z, y) for x, y, z in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj['surface_key'] = name
    scene.collection.objects.link(obj)
    return obj


def rings(name, profile, sides=12, deform=None):
    vertices, faces = [], []
    for row, (y, rx, rz, z) in enumerate(profile):
        for i in range(sides):
            angle = i * math.tau / sides
            p = [math.sin(angle) * rx, y, math.cos(angle) * rz + z]
            vertices.append(deform(p, row, angle) if deform else p)
        if row:
            for i in range(sides):
                a, b = (row-1)*sides+i, (row-1)*sides+(i+1)%sides
                faces.append((a, b, b+sides, a+sides))
    faces.extend([tuple(reversed(range(sides))), tuple((len(profile)-1)*sides+i for i in range(sides))])
    return mesh_object(name, vertices, faces)


def bake(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    vertices = [[v.co.x, v.co.z, -v.co.y] for v in obj.data.vertices]
    low = [min(p[i] for p in vertices) for i in range(3)]
    high = [max(p[i] for p in vertices) for i in range(3)]
    span = [high[i]-low[i] for i in range(3)]
    if any(n <= 0 for n in span):
        raise ValueError('Degenerate mesh: '+obj.name)
    normalized = [[round((p[i]-(low[i]+high[i])/2)/span[i], 6) for i in range(3)] for p in vertices]
    if obj['surface_key'] in ('stone', 'crown', 'mushroomCap'):
        # These shapes live in circular scatter envelopes, not diagonal box envelopes.
        radial = max(math.hypot(p[0], p[2]) for p in normalized)
        for p in normalized:
            p[0], p[2] = round(p[0]/(radial*2), 6), round(p[2]/(radial*2), 6)
    library[obj['surface_key']] = {'vertices': [n for p in normalized for n in p],
                         'faces': [i for p in obj.data.polygons for i in p.vertices]}
    if obj['surface_key'] in ('iceFracture', 'industrialCourse'):
        library[obj['surface_key']]['size'] = span
    # Show the unscaled authoring surfaces in a separate, editable library scene.
    index = len(library)-1
    obj.location = (index % 5 * 1.7, -(index // 5)*1.9, .6)


cube = mesh_object('beveledBox', [(-.5,-.5,-.5),(-.5,-.5,.5),(-.5,.5,-.5),(-.5,.5,.5),
    (.5,-.5,-.5),(.5,-.5,.5),(.5,.5,-.5),(.5,.5,.5)],
    [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)])
modifier_types = [i.identifier for i in bpy.types.Modifier.bl_rna.properties['type'].enum_items]
if 'BEVEL' not in modifier_types:
    raise ValueError('Bevel unavailable')
modifier = cube.modifiers.new('Edge chamfer', 'BEVEL')
modifier.width, modifier.segments = .1, 1
limits = [i.identifier for i in modifier.bl_rna.properties['limit_method'].enum_items]
if 'ANGLE' not in limits:
    raise ValueError('Angle bevel unavailable')
modifier.limit_method = 'ANGLE'
bpy.context.view_layer.objects.active = cube
cube.select_set(True)
bpy.ops.object.modifier_apply(modifier=modifier.name)
cube.select_set(False)
bake(cube)

# The joint ends overlap slightly; silhouettes stay tapered instead of cylindrical.
profiles = {
    'torso': [(-.5,.35,.33,0),(-.28,.39,.38,0),(.05,.46,.46,.015),(.32,.5,.46,0),(.5,.30,.32,0)],
    'pelvis': [(-.5,.43,.35,0),(-.2,.5,.48,0),(.3,.48,.45,0),(.5,.42,.38,0)],
    'upperLeg': [(-.5,.32,.33,.01),(-.3,.39,.42,.025),(.1,.47,.49,0),(.5,.5,.46,0)],
    'lowerLeg': [(-.5,.29,.28,0),(-.28,.35,.34,0),(.12,.5,.49,-.025),(.38,.46,.43,0),(.5,.36,.35,0)],
    'upperArm': [(-.5,.31,.33,0),(-.24,.4,.4,0),(.2,.48,.48,0),(.42,.5,.5,0),(.5,.33,.33,0)],
    'forearm': [(-.5,.28,.26,.02),(-.28,.35,.33,0),(.12,.48,.48,0),(.5,.5,.5,0)],
    'hand': [(-.5,.28,.28,.05),(-.32,.42,.34,.04),(.06,.5,.43,0),(.3,.36,.34,0),(.5,.25,.28,0)],
    'shoe': [(-.5,.43,.45,0),(-.31,.5,.5,0),(-.12,.49,.49,.015),(.15,.44,.40,-.06),(.5,.31,.25,-.20)],
    'boot': [(-.5,.43,.45,0),(-.38,.5,.5,0),(-.12,.48,.46,.015),(.15,.30,.23,-.22),(.5,.30,.23,-.22)],
    'head': [(-.5,.18,.23,.025),(-.37,.32,.32,.075),(-.18,.43,.40,.04),(.04,.5,.46,0),
             (.24,.48,.46,-.025),(.41,.37,.34,-.05),(.5,.12,.12,-.05)],
    'hairCap': [(-.5,.47,.43,-.04),(-.15,.5,.48,-.02),(.18,.47,.48,-.02),(.40,.35,.34,-.03),(.5,.08,.08,-.03)],
    'hairLock': [(-.5,.20,.22,0),(-.27,.38,.35,.02),(0,.47,.44,0),(.3,.5,.5,0),(.5,.43,.39,0)],
    'hairCurl': [(-.5,.12,.12,0),(-.23,.44,.43,0),(.2,.5,.48,0),(.5,.14,.14,0)],
    'nose': [(-.5,.16,.10,0),(-.25,.45,.5,.17),(0,.4,.47,.18),(.5,.16,.10,-.2)],
    'ear': [(-.5,.24,.23,0),(-.25,.42,.35,0),(.12,.5,.47,0),(.38,.39,.5,0),(.5,.18,.28,0)],
    'stone': [(-.5,.32,.30,.01),(-.35,.46,.43,0),(0,.5,.5,0),(.27,.41,.36,.025),(.5,.20,.18,-.035)],
    'crown': [(-.5,.04,.04,0),(-.35,.30,.30,0),(-.15,.45,.45,0),(.10,.5,.5,0),(.30,.39,.39,0),(.5,.04,.04,0)],
    'mushroomCap': [(-.5,.12,.12,0),(-.47,.42,.42,0),(-.35,.5,.5,0),(0,.46,.46,0),(.3,.32,.32,0),(.5,.04,.04,0)],
}
for name, profile in profiles.items():
    def deform(p, row, angle, kind=name):
        if kind == 'crown':
            k = .89 + .08*math.sin(angle*5+row*1.7) + .03*math.cos(angle*3-row)
            p[0] *= k
            p[2] *= k
        elif kind == 'stone':
            k = .88 + .09*math.sin(angle*3+row*1.2) + .03*math.cos(angle*5-row)
            p[0] *= k
            p[2] *= k
        elif kind == 'head' and row in (1,2,3,4) and math.cos(angle) > .5:
            # Broad cheek planes and a flatter face leave room for the nose and eyelids.
            p[2] = profile[row][3] + profile[row][2]*.91
        elif kind == 'hairCap' and row == 0:
            p[1] += .30*max(0, math.cos(angle))
        elif kind == 'hand' and row == 2 and math.sin(angle) > .7:
            p[0] *= 1.20
        elif kind == 'mushroomCap':
            p[1] += .018*math.cos(angle*6)
        return p
    bake(rings(name, profile, 12 if name in ('head','hairCap','crown','mushroomCap') else 8, deform))

# A thin open concrete basin, not a solid cuboid hidden below the soil.
vertices, faces = [], []
for y, r in [(-.5,.40),(.5,.50),(.5,.46),(-.38,.37)]:
    vertices += [(-r,y,-r),(r,y,-r),(r,y,r),(-r,y,r)]
for row in range(3):
    for i in range(4):
        a, b = row*4+i, row*4+(i+1)%4
        faces.append((a,b,b+4,a+4))
faces += [(3,2,1,0),(12,13,14,15)]
bake(mesh_object('planterShell', vertices, faces))

# Root chord, swept tip and a six-vertex airfoil cross-section.
vertices, faces = [], []
for row, (y, chord, sweep, twist) in enumerate([(-.5,.42,0,.10),(-.25,.5,.015,.05),(.18,.34,.055,-.04),(.5,.10,.10,-.08)]):
    for x, z in [(-1,0),(-.45,-.5),(.55,-.23),(1,0),(.40,.26),(-.5,.5)]:
        vertices.append([x*chord+sweep,y,z+twist*x])
    if row:
        for i in range(6):
            a,b=(row-1)*6+i,(row-1)*6+(i+1)%6
            faces.append((a,b,b+6,a+6))
faces += [tuple(reversed(range(6))),tuple(18+i for i in range(6))]
bake(mesh_object('turbineBlade', vertices, faces))

# A triangular fracture patch keeps its perimeter fixed when mapped onto seeded ice.
top = [(0, 0, 0), (1, 0, 0), (0, 0, 1),
       (.18, -.028, .20), (.56, -.012, .18), (.20, -.048, .57)]
vertices = top + [(x, -.12, z) for x, _, z in top[:3]]
faces = [(0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5), (3, 4, 5),
         (6, 8, 7), (0, 6, 7, 1), (1, 7, 8, 2), (2, 8, 6, 0)]
bake(mesh_object('iceFracture', vertices, faces))

# Physical course spacing and recessed seams come from this authored shell strip.
bake(rings('industrialCourse', [(-1.2, .5, .5, 0), (-1.16, .5, .5, 0),
    (-1.12, .493, .493, 0), (1.12, .493, .493, 0),
    (1.16, .5, .5, 0), (1.2, .5, .5, 0)], 16))
library['industrialCourse']['maxCourses'] = 16

# Closed C-section metal: the negative space stays inside the declared rail box.
profile = [(-.5,-.5),(.5,-.5),(.5,-.32),(-.30,-.32),
           (-.30,.32),(.5,.32),(.5,.5),(-.5,.5)]
vertices = [(x, y, z) for y in [-.5, .5] for x, z in profile]
faces = [tuple(reversed(range(8))), tuple(range(8,16))]
faces += [(i, (i+1)%8, (i+1)%8+8, i+8) for i in range(8)]
bake(mesh_object('steelChannel', vertices, faces))

text = '// Generated by tools/scenery_authoring/author.py in Blender. Game axes: X/Y/Z, metre scaling at the visual seam.\n'
text += 'export const SCENERY_MESHES = Object.freeze('+json.dumps(library,separators=(',',':'))+');\n'
scene['scenery_export'] = text
if globals().get('WRITE_OUTPUT', True):
    directory = ROOT/'out/scenery_review'
    directory.mkdir(parents=True, exist_ok=True)
    (ROOT/'public/js/sceneryMeshData.js').write_text(text,encoding='utf8')
    bpy.data.libraries.write(str(directory/'scenery-surfaces.blend'),{scene})
print(json.dumps({'scene':scene.name,'meshes':len(library),'triangles':sum(len(m['faces'])//3 for m in library.values())}))
