"""Edit the shipped vehicle parts in an isolated Blender scene and bake local meshes."""
import json
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector, Euler

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'out/transport_review/source.json'
OUT = ROOT / 'public/js/transportMeshData.js'
data = json.loads(SOURCE.read_text(encoding='utf8'))
scene = bpy.data.scenes.new('Transport Low Poly Authoring')
bpy.context.window.scene = scene
library = []
mesh_ids = {}
recipes = {}
attachments = {}


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def unxyz(p):
    return [p[0], p[2], -p[1]]


def mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(p) for p in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def box_mesh(name, p, dimensions, rotation):
    matrix = Euler(rotation, 'XYZ').to_matrix()
    verts = []
    for x, y, z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),
                    (1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]:
        q = matrix @ Vector((x*dimensions[0]/2, y*dimensions[1]/2, z*dimensions[2]/2))
        verts.append([p[i]+q[i] for i in range(3)])
    return mesh_object(name, verts, [(0,1,3,2),(4,6,7,5),(0,4,5,1),
                                     (2,3,7,6),(0,2,6,4),(1,5,7,3)])


def enum_set(owner, prop, value):
    values = [i.identifier for i in owner.bl_rna.properties[prop].enum_items]
    if value not in values:
        raise ValueError(f'{prop}: {value} not in {values}')
    setattr(owner, prop, value)


def apply_modifier(obj, modifier):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def bevel(obj, width):
    valid = [i.identifier for i in bpy.types.Modifier.bl_rna.properties['type'].enum_items]
    if 'BEVEL' not in valid:
        raise ValueError('Bevel modifier unavailable')
    mod = obj.modifiers.new('Body edge chamfer', 'BEVEL')
    mod.width = width
    mod.segments = 1
    enum_set(mod, 'limit_method', 'ANGLE')
    apply_modifier(obj, mod)


def cut_arch(obj, center, radius, width):
    verts = []
    for side in [-1,1]:
        for i in range(16):
            angle = i*math.tau/16
            verts.append([center[0]+radius*math.cos(angle), center[1]+radius*math.sin(angle), side*width])
    faces = [tuple(range(15,-1,-1)), tuple(range(16,32))]
    for i in range(16):
        j = (i+1)%16
        faces.append((i,j,16+j,16+i))
    cutter = mesh_object('Wheel arch cutter', verts, faces)
    mod = obj.modifiers.new('Wheel arch', 'BOOLEAN')
    enum_set(mod, 'operation', 'DIFFERENCE')
    enum_set(mod, 'solver', 'EXACT')
    mod.object = cutter
    apply_modifier(obj, mod)
    bpy.data.objects.remove(cutter, do_unlink=True)


def export_mesh(obj, origin, basis):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    points = [unxyz(v.co) for v in obj.data.vertices]
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    center = [(low[i]+high[i])/2 for i in range(3)]
    mesh = {'vertices': [round((p[i]-center[i])/basis[i],6) for p in points for i in range(3)],
            'faces': [i for p in obj.data.polygons for i in p.vertices]}
    signature = json.dumps(mesh, separators=(',', ':'))
    if signature not in mesh_ids:
        mesh_ids[signature] = len(library)
        library.append(mesh)
    return {'mesh': mesh_ids[signature],
            'offset': [round((center[i]-origin[i])/basis[i],6) for i in range(3)],
            'size': [round((high[i]-low[i])/basis[i],6) for i in range(3)]}


def deform_cabin(obj, front, rear, bottom, top, front_rake, rear_rake, width):
    for vert in obj.data.vertices:
        x,y,z = unxyz(vert.co)
        t = max(0,min(1,(y-bottom)/(top-bottom)))
        u = max(0,min(1,(x-rear)/(front-rear)))
        x += t*(rear_rake*(1-u)-front_rake*u)
        z *= 1-t*width
        vert.co = xyz([x,y,z])


for vehicle_index, record in enumerate(data['vehicles']):
    key, spec, entry = record['key'], record['spec'], record['entry']
    v = entry['generation']
    basis = [v['length'],v['height'],v['width']]
    L,H,W = basis
    parts = entry['parts']
    windshield = next((p for p in parts if p['name']=='front_windshield'),None)
    roof = next((p for p in parts if p['name']==key+'_roof'),None)
    cab = next((p for p in parts if p['name']=='cab'),None)
    if roof and windshield:
        front = windshield['position'][0]-windshield['dimensions'][0]/2
        rear_part = next(p for p in parts if p['name']==key+'_rear_window')
        rear = rear_part['position'][0]+rear_part['dimensions'][0]/2
        bottom = windshield['position'][1]-windshield['dimensions'][1]/2
        top = windshield['position'][1]+windshield['dimensions'][1]/2
        square = spec['style'] in ['offroadSUV','militaryJeep','militaryVan','cargoVan','motorhome','militaryPickup']
        front_rake, rear_rake = L*(.035 if square else .075),L*(.015 if square else .045)
    elif cab:
        x,y,z = cab['position']
        l,h,w = cab['dimensions']
        front,rear,bottom,top = x+l/2,x-l/2,y-h/2,y+h/2
        front_rake,rear_rake = l*.14,l*.035
        badge = next((p for p in parts if p['name']=='brand_badge_base'),None)
        if badge:
            t = max(0,min(1,(badge['position'][1]-bottom)/(top-bottom)))
            attachments[key] = [-round(t*front_rake/L,6),0,0]
    else:
        front = rear = bottom = top = None
    counts = {}
    replacements = []
    collection = bpy.data.collections.new('Vehicle/'+key)
    scene.collection.children.link(collection)
    for part in parts:
        role = part['name']
        slot = counts.get(role,0)
        counts[role] = slot+1
        if part['type']!='box':
            continue
        cabin = bool(roof and (role in ['front_windshield',key+'_roof',key+'_window_band',key+'_pillar',
                     key+'_rear_window',key+'_solid_rear_wall',key+'_cab_side_window',key+'_living_window',
                     key+'_entry_door','passenger_side_glass'])) or bool(cab and role in ['cab','glazing','front_windshield','windshield_divider','pillar','window_pillar'])
        lower = role==key+'_lower_body' or role=='body'
        chamfer = lower or role in ['hood','trunk','counterweight','armored_hull','engine_hood','carriage_body','van_body','overcab_sleeping_pod'] or role.endswith(('_bonnet','_rear_deck','_mirror')) or role=='bumper'
        if not cabin and not chamfer:
            continue
        p,d = part['position'],part['dimensions']
        obj = box_mesh(key+'/'+role+'/'+str(slot), p,d,part['rotation'])
        if cabin:
            if role=='passenger_side_glass':
                for vert in obj.data.vertices:
                    q = unxyz(vert.co)
                    q[2] += math.copysign(1,p[2])*(W*.375-abs(p[2]))
                    vert.co = xyz(q)
            deform_cabin(obj,front,rear,bottom,top,front_rake,rear_rake,.08 if roof else .06)
        if chamfer or role=='cab':
            bevel(obj,min(d)*(.16 if lower else .1))
        if lower:
            tires = [t for t in parts if t['name']=='tire' and t['type']=='cylinder']
            if tires:
                scale = v['wheels']['radiusScale']
                lift = max(t['radii'][0]*(1-1/scale) for t in tires)+v['wheels']['suspensionLift']
                for x in sorted(set(t['position'][0] for t in tires)):
                    t = next(t for t in tires if t['position'][0]==x)
                    radius = t['radii'][0]/scale
                    cut_arch(obj,[x,radius+lift,0],radius*1.12,W)
        replacement = export_mesh(obj,p,basis)
        replacements.append({'role':role,'slot':slot,**replacement})
        obj['vehicle_key'] = key
        obj['part_role'] = role
        scene.collection.objects.unlink(obj)
        collection.objects.link(obj)
        obj.location = (vehicle_index%10*24,-(vehicle_index//10)*12,0)
    if replacements:
        recipes[key] = replacements

# A revolved shoulder/sidewall profile replaces solid rubber cylinders without adding tread meshes.
tire_profile = [[.5,.5],[.5,.8],[.38,.97],[.2,1],[-.2,1],[-.38,.97],[-.5,.8],[-.5,.5]]
tire_vertices = [[radius*math.cos(i*math.tau/16),axle,radius*math.sin(i*math.tau/16)]
                 for i in range(16) for axle,radius in tire_profile]
tire_faces = []
for i in range(16):
    for j in range(8):
        k,n = (j+1)%8,(i+1)%16
        tire_faces.append((i*8+j,i*8+k,n*8+k,n*8+j))
tire = mesh_object('Shouldered radial tire',tire_vertices,tire_faces)
tire_id = export_mesh(tire,[0,0,0],[1,1,1])['mesh']

# Stations retain the catalog's beam/depth envelopes and its open-boat shell contract.
hull_ring = [[-1,1,0],[-.94,0,-.18],[-.78,0,-.65],[0,0,-1],
             [.78,0,-.65],[.94,0,-.18],[1,1,0]]
hulls = {
    'displacement': [[-.5,.34,1,.65],[-.44,.43,1,.84],[-.32,.5,1,1],[-.1,.5,1,1],
                     [.23,.5,1,1],[.35,.39,1.025,.86],[.43,.25,1.08,.7],[.48,.09,1.11,.36],[.5,.015,1.12,.16]],
    'fine': [[-.5,.018,1,.65],[-.44,.22,1,.82],[-.32,.5,1,1],[-.1,.5,1,1],
             [.23,.5,1,1],[.35,.39,1.025,.86],[.43,.25,1.08,.7],[.48,.09,1.11,.36],[.5,.015,1.12,.16]],
    'barge': [[-.5,.34,1,.65],[-.44,.47,1,.9],[-.32,.5,1,1],[.23,.5,1,1],
              [.43,.39,1.08,.7],[.5,.32,1.12,.16]],
}
for name, stations in hulls.items():
    verts = []
    for z,w,f,d in stations:
        for a,b,c in hull_ring:
            x,y = w*a,f*.12*b+d*c
            verts.append([x*3,y*1.2,z*12])
    faces = []
    for s in range(len(stations)-1):
        for j in range(7):
            k = (j+1)%7
            faces.append((s*7+j,s*7+k,(s+1)*7+k,(s+1)*7+j))
    faces += [tuple(range(6,-1,-1)),tuple(range((len(stations)-1)*7,len(stations)*7))]
    mesh_object('Hull stations/'+name,verts,faces)['stations_json'] = json.dumps(stations)

export_text = ('// Blender-baked presentation meshes. Regenerate with tools/transport_authoring/author.py.\n'
               +'export const TRANSPORT_MESHES = '+json.dumps(library,separators=(',',':'))+';\n'
               +'export const VEHICLE_MESH_RECIPES = '+json.dumps(recipes,separators=(',',':'))+';\n'
               +'export const VEHICLE_BADGE_OFFSETS = '+json.dumps(attachments,separators=(',',':'))+';\n'
               +'export const TRANSPORT_TIRE_MESH = TRANSPORT_MESHES['+str(tire_id)+'];\n'
               +'export const VESSEL_HULL_STATIONS = '+json.dumps(hulls,separators=(',',':'))+';\n'
               +'export const VESSEL_HULL_RING = '+json.dumps(hull_ring,separators=(',',':'))+';\n')
scene['transport_export'] = export_text
if globals().get('WRITE_OUTPUT', True):
    OUT.write_text(export_text,encoding='utf8')
    bpy.data.libraries.write(str(ROOT/'out/transport_review/transport-source.blend'),{scene})
print(json.dumps({'vehicles':len(recipes),'meshes':len(library),'parts':sum(map(len,recipes.values())),
                  'runtime_bytes':len(export_text),'scene':scene.name}))
