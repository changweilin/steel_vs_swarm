"""Bake boundary surfaces in an isolated Blender scene; metres settle in the host."""
import json
import math
from pathlib import Path
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.data.scenes.new('Boundary Surface Library')
bpy.context.window.scene = scene
meshes = {}


def mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, -z, y) for x, y, z in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj['surface_key'] = name
    scene.collection.objects.link(obj)
    return obj


def bake(obj, shades=None):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    meshes[obj['surface_key']] = {
        'vertices': [round(n, 6) for v in obj.data.vertices for n in (v.co.x, v.co.z, -v.co.y)],
        'faces': [i for p in obj.data.polygons for i in p.vertices],
        'shades': shades or [1] * len(obj.data.vertices),
    }
    obj.location = (len(meshes) * 2.5, 0, .8)


# Recessed mortar surrounds a dressed face. Shared tile edges stay on the host plane.
for name, inset, bevel in [('ashlar', .06, .075), ('concrete', .025, .025)]:
    outer = [(-.5,-.5,0),(.5,-.5,0),(.5,.5,0),(-.5,.5,0)]
    inner = [(-.5+bevel,-.5+bevel,inset),(.5-bevel,-.5+bevel,inset),
             (.5-bevel,.5-bevel,inset),(-.5+bevel,.5-bevel,inset)]
    faces = [(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)] + [(4,5,6,7)]
    bake(mesh_object(name, outer+inner, faces), [.68]*4+[1,.98,.95,1.02])

# Filleted eight-sided legs overlap at a cast junction rather than crossing sharp cylinders.
vertices, faces = [], []
profile = [(-.5,.46),(-.44,.5),(.36,.38),(.46,.36),(.5,.32)]
for row, (y, radius) in enumerate(profile):
    for i in range(8):
        angle = i*math.tau/8
        vertices.append((math.cos(angle)*radius,y,math.sin(angle)*radius))
    if row:
        for i in range(8):
            a,b=(row-1)*8+i,(row-1)*8+(i+1)%8
            faces.append((a,b,b+8,a+8))
faces += [tuple(reversed(range(8))),tuple(32+i for i in range(8))]
bake(mesh_object('tetrapodLeg', vertices, faces))

bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=1, radius=.5)
mesh = bpy.data.meshes.new('tetrapodCore')
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new('tetrapodCore', mesh)
obj['surface_key'] = 'tetrapodCore'
scene.collection.objects.link(obj)
bake(obj)

# A hipped roof can reuse the original gatehouse eave envelope.
bake(mesh_object('hipRoof', [(-.5,-.5,-.5),(.5,-.5,-.5),(.5,-.5,.5),(-.5,-.5,.5),
    (-.32,.5,0),(.32,.5,0)], [(0,1,5,4),(1,2,5),(2,3,4,5),(3,0,4),(3,2,1,0)]))

# Editable, periodic fracture relief: edges of the tile sample the same value.
side = 9
relief = []
vertices, faces = [], []
for row in range(side):
    for col in range(side):
        x,z=col/(side-1),row/(side-1)
        value = .5 + .22*math.cos(x*math.tau)*math.sin(z*math.tau) + .18*math.cos((x+z)*math.tau*2)
        relief.append(round(value,6))
        vertices.append((x-.5,value*.22,z-.5))
        if row and col:
            a=(row-1)*side+col-1
            faces += [(a,a+side,a+1),(a+1,a+side,a+side+1)]
mesh_object('Fracture Relief', vertices, faces).location = (0,-3,0)

sections = {
    'cliff': [[-.5,0],[-.4,.48],[-.32,.8],[-.16,.94],[.04,1],[.20,.94],
              [.24,.77],[.30,.74],[.32,.49],[.39,.46],[.42,.20],[.5,0]],
}
for name, section in sections.items():
    vertices = [(x,y,z) for x in (-.5,.5) for z,y in section]
    n=len(section)
    faces=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    faces += [tuple(reversed(range(n))),tuple(n+i for i in range(n))]
    mesh_object(name+' Section', vertices, faces).location=(3,-3,0)

# Flat tangents at both ends keep neighbouring silhouettes and density ramps quiet.
transition = [round((t := i / 64)**3 * (t * (6*t - 15) + 10), 9) for i in range(65)]
vertices = [(i / 64, value, z) for z in (-.08, .08) for i, value in enumerate(transition)]
faces = [(i, i+1, i+66, i+65) for i in range(64)]
mesh_object('Ecotone Blend Profile', vertices, faces).location = (6,-3,0)

payload = {'meshes':meshes, 'sections':sections,
    'relief':{'side':side,'period':11,'values':relief},
    'transition': transition,
    'strata':[.88,.91,1,.98,.82,.86,.97,1]}
text = '// Generated in Blender by tools/boundary_authoring/author.py. Game axes: X/Y/Z.\n'
text += 'export const BOUNDARY_SURFACES = Object.freeze('+json.dumps(payload,separators=(',',':'))+');\n'
scene['boundary_export'] = text
directory=ROOT/'out/boundary_review'
directory.mkdir(parents=True,exist_ok=True)
if globals().get('WRITE_OUTPUT',True):
    (ROOT/'public/js/boundaryMeshData.js').write_text(text,encoding='utf8')
    bpy.data.libraries.write(str(directory/'boundary-surfaces.blend'),{scene})
print(json.dumps({'scene':scene.name,'meshes':{k:len(v['faces'])//3 for k,v in meshes.items()}}))
