"""Bake metre-space pedestrian furniture in an isolated scene; library geometry never defines collision."""
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/walkway_review'
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('Walkway Furniture Library')
bpy.context.window.scene = scene
palette = {'steel': 0x49595b, 'wood': 0x98734e, 'stone': 0xaaa697,
           'light': 0xd5cbb2, 'green': 0x517368, 'dark': 0x303c3c, 'amber': 0xdcb651}
materials = {}
for key, color in palette.items():
    mat = bpy.data.materials.new('Walkway/' + key)
    mat.use_nodes = True
    rgba = tuple(((color >> shift) & 255) / 255 for shift in (16, 8, 0)) + (1,)
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgba[:3]) + (1,)
    shader.inputs['Roughness'].default_value = .75
    mat.diffuse_color = rgba
    materials[key] = mat
library = {}
parts = []


def mesh(vertices, faces, color):
    data = bpy.data.meshes.new('Walkway member')
    data.from_pydata([(x, -z, y) for x, y, z in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new('Walkway member', data)
    data.materials.append(materials[color])
    scene.collection.objects.link(obj)
    parts.append((obj, palette[color]))
    return obj


def box(w, h, d, x, y, z, color='steel'):
    return mesh([(x + a*w/2, y + b*h/2, z + c*d/2) for a, b, c in
                 [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]],
                [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)], color)


def tube(a, b, radius, color='steel', sides=10):
    av, bv = Vector(a), Vector(b)
    direction = (bv - av).normalized()
    reference = Vector((0, 1, 0)) if abs(direction.y) < .9 else Vector((1, 0, 0))
    u = direction.cross(reference).normalized() * radius
    v = direction.cross(u).normalized() * radius
    vertices = [tuple(end + math.cos(i*math.tau/sides)*u + math.sin(i*math.tau/sides)*v)
                for end in (av, bv) for i in range(sides)]
    mesh(vertices, [tuple(range(sides-1,-1,-1)), tuple(range(sides,2*sides))]
         + [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)], color)


def ring(radius, inner, y, height, color='steel', sides=16):
    vertices = [(math.cos(i*math.tau/sides)*r, yy, math.sin(i*math.tau/sides)*r)
                for r, yy in [(radius,y),(radius,y+height),(inner,y+height),(inner,y)] for i in range(sides)]
    faces = []
    for j in range(4):
        for i in range(sides):
            faces.append((j*sides+i,j*sides+(i+1)%sides,((j+1)%4)*sides+(i+1)%sides,((j+1)%4)*sides+i))
    mesh(vertices, faces, color)


def finish(key):
    vertices, colors = [], []
    for obj, color in parts:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        obj.name = key + '/' + str(len(vertices)//9)
        obj['walkway_asset'] = key
        for face in obj.data.polygons:
            for index in face.vertices:
                p = obj.data.vertices[index].co
                vertices.extend([round(p.x,6), round(p.z,6), round(-p.y,6)])
                colors.append(color)
    library[key] = {'vertices': vertices, 'colors': colors}
    offset = len(library) - 1
    for obj, _ in parts:
        obj.location = (offset % 4 * 7, -(offset // 4) * 7, 0)
    parts.clear()


ring(.38,.32,.12,.85,'green')
ring(.43,.30,.97,.09,'steel')
box(.58,.06,.58,0,.1,0,'dark')
for i in range(12):
    angle = i*math.tau/12
    tube((math.cos(angle)*.39,.17,math.sin(angle)*.39), (math.cos(angle)*.39,.92,math.sin(angle)*.39),.025,'wood')
finish('wastebasket')

for x in [-1,0,1]:
    points = [(x,.05,-.35),(x,.85,-.35),(x,1.05,-.2),(x,1.05,.2),(x,.85,.35),(x,.05,.35)]
    for a,b in zip(points,points[1:]):
        tube(a,b,.045)
    for z in [-.35,.35]:
        box(.20,.04,.20,x,.02,z,'stone')
finish('bicycle_rack')

tube((0,0,0),(0,1.12,0),.13)
ring(.145,.13,.88,.14,'amber')
box(.3,.05,.3,0,.025,0,'stone')
finish('bollard')

box(.45,.88,.4,0,.44,0,'stone')
ring(.28,.22,.9,.10,'steel')
tube((-.12,.98,0),(-.12,1.16,0),.035)
tube((-.12,1.16,0),(.04,1.16,0),.035)
box(.30,.025,.30,0,.9,0,'dark')
finish('drinking_fountain')

for x in [-1.15,1.15]:
    for z in [-.65,.65]:
        tube((x,0,z),(x,1.2,-z*.35),.07)
    box(.14,.14,1.9,x,.54,0)
for i in range(5):
    box(3,.08,.17,0,1.18,(i-2)*.19,'wood')
for z in [-.88,.88]:
    for dz in [-.12,.12]:
        box(3,.07,.2,0,.64,z+dz,'wood')
finish('picnic_table')

for x in [-1.65,1.65]:
    for z in [-1.65,1.65]:
        box(.15,2.5,.15,x,1.25,z)
        box(.28,.08,.28,x,.04,z,'stone')
for z in [-1.65,1.65]:
    box(3.5,.18,.14,0,2.4,z)
mesh([(-2.1,2.5,-2.1),(2.1,2.5,-2.1),(2.1,2.5,2.1),(-2.1,2.5,2.1),
      (-2.1,3.0,0),(2.1,3.0,0)],[(0,1,5,4),(4,5,2,3),(0,4,3),(1,2,5)],'green')
for x in [-1.65,1.65]:
    box(.18,.18,3.7,x,2.45,0)
finish('shelter')

for x in [-.9,.9]:
    box(.12,2.1,.12,x,1.05,0,'wood')
box(1.9,1.05,.12,0,1.45,0,'wood')
box(1.72,.9,.035,0,1.45,.085,'light')
for x in [-.55,0,.55]:
    box(.28,.025,.015,x,1.5,.11,'green')
    box(.02,.36,.015,x,1.32,.11,'green')
box(2.1,.10,.45,0,2.07,0,'green')
finish('information_board')

box(.16,1.4,.16,0,.7,0,'wood')
box(.25,.32,.04,0,1.18,.10,'amber')
box(.03,.20,.015,0,1.18,.13,'light')
finish('trail_marker')

for x in [-.45,.45]:
    box(.08,1.1,.08,x,.55,0,'wood')
for y in [.55,1.04]:
    box(1,.09,.08,0,y,0,'wood')
finish('handrail')

# Cross-sections retreat into a low, non-solid presentation envelope.
mesh([(-.5,0,-.5),(.5,0,-.5),(.5,.55,-.5),(.32,1,-.5),(-.5,1,-.5),
      (-.5,0,.5),(.5,0,.5),(.5,.55,.5),(.32,1,.5),(-.5,1,.5)],
     [(0,4,3,2,1),(5,6,7,8,9),(0,1,6,5),(1,2,7,6),(2,3,8,7),(3,4,9,8),(4,0,5,9)],'stone')
finish('kerb')

box(1,.025,.6,0,.0125,0,'dark')
for i in range(8):
    box(.045,.025,.58,-.44+i*.125,.03,0)
for x in [-.49,.49]:
    box(.035,.04,.65,x,.02,0)
finish('drain')

box(1,.018,.5,0,.009,0,'amber')
for i in range(7):
    box(.038,.025,.46,-.42+i*.14,.027,0,'amber')
finish('tactile')

target = ROOT / 'public/js/walkwayMeshData.js'
target.write_text('// Generated by tools/walkway_authoring/author.py. Do not edit.\n'
                  + 'export const WALKWAY_MESHES = Object.freeze('
                  + json.dumps(library,separators=(',',':')) + ');\n',encoding='utf8')
bpy.data.libraries.write(str(OUT/'walkway-members.blend'),{scene})
print(json.dumps({'scene':scene.name,'models':len(library),'triangles':sum(len(v['vertices'])//9 for v in library.values()),'output':str(target)}))
