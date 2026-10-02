"""Display the production meshes in Blender without touching existing scenes."""
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
directory = Path(globals().get('REVIEW_DIRECTORY', ROOT/'out/transport_review'))
prefix = globals().get('PREVIEW_PREFIX', 'Transport')
columns = globals().get('PREVIEW_COLUMNS', 3)
models = json.loads((directory/'review.json').read_text(encoding='utf8'))['models']
scene = bpy.data.scenes.new(prefix+' Game Models')
bpy.context.window.scene = scene


def enum_set(owner, prop, value):
    values = [i.identifier for i in owner.bl_rna.properties[prop].enum_items]
    if value not in values:
        raise ValueError(f'{prop}: {value} not in {values}')
    setattr(owner, prop, value)


materials = {}
def material(rgb):
    key = tuple(round(n,5) for n in rgb)
    if key not in materials:
        mat = bpy.data.materials.new(prefix+'/'+str(key))
        mat.use_nodes = True
        node = next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        node.inputs[0].default_value = (*key,1)
        node.inputs[1].default_value = .12
        node.inputs[2].default_value = .64
        mat.diffuse_color = (*key,1)
        materials[key] = mat
    return materials[key]


for index, model in enumerate(models):
    vertices, faces, colors = [],[],[]
    for part in model['parts']:
        offset = len(vertices)
        p = part['vertices']
        vertices += [(p[i],-p[i+2],p[i+1]) for i in range(0,len(p),3)]
        for i in range(0,len(part['faces']),3):
            triangle = part['faces'][i:i+3]
            faces.append(tuple(offset+j for j in triangle))
            c = part['colors']
            colors.append(c[triangle[0]*3:triangle[0]*3+3] if c else part['color'])
    low = [min(p[i] for p in vertices) for i in range(3)]
    high = [max(p[i] for p in vertices) for i in range(3)]
    span = max(high[i]-low[i] for i in range(3))
    scale = 5.4/span
    center = [(high[i]+low[i])/2 for i in range(3)]
    vertices = [((p[0]-center[0])*scale,(p[1]-center[1])*scale,(p[2]-low[2])*scale) for p in vertices]
    mesh = bpy.data.meshes.new(model['key'])
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    obj = bpy.data.objects.new(model['key'],mesh)
    scene.collection.objects.link(obj)
    obj.location = (index%columns*8,-(index//columns)*6,0)
    local_materials = {}
    for poly, rgb in zip(mesh.polygons,colors):
        mat = material(rgb)
        if mat.name not in local_materials:
            local_materials[mat.name] = len(mesh.materials)
            mesh.materials.append(mat)
        poly.material_index = local_materials[mat.name]

floor_mesh = bpy.data.meshes.new('Review ground')
rows = (len(models)+columns-1)//columns
right, bottom = (columns-1)*8+5, -rows*6
target = Vector(((columns-1)*4,-(rows-1)*3,0))
floor_mesh.from_pydata([(-5,5,-.04),(right,5,-.04),(right,bottom,-.04),(-5,bottom,-.04)],[],[(0,1,2,3)])
floor = bpy.data.objects.new('Review ground',floor_mesh)
scene.collection.objects.link(floor)
floor.data.materials.append(material([.48,.54,.61]))
for name, location, energy, size in [('Key',(4,-4,18),2400,14),('Fill',(16,-14,12),1800,10)]:
    if 'AREA' not in [i.identifier for i in bpy.data.lights.bl_rna.functions['new'].parameters['type'].enum_items]:
        raise ValueError('Area lights unavailable')
    light_data = bpy.data.lights.new(name,'AREA')
    light_data.energy = energy*globals().get('PREVIEW_LIGHT_GAIN', 1)
    light_data.size = size
    light = bpy.data.objects.new(name,light_data)
    scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (target-light.location).to_track_quat('-Z','Y').to_euler()
camera_data = bpy.data.cameras.new(prefix+' overview')
enum_set(camera_data,'type','ORTHO')
camera_data.ortho_scale = max(34, rows*6+globals().get('PREVIEW_MARGIN', 8))
camera = bpy.data.objects.new(prefix+' overview',camera_data)
scene.collection.objects.link(camera)
camera.location = (31,-35,29)
camera.rotation_euler = (target-camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera = camera
scene.world = bpy.data.worlds.new(prefix+' studio')
scene.world.color = (.25,.25,.25)
scene.render.resolution_x, scene.render.resolution_y = 1600,1400
scene.render.resolution_percentage = 100
enum_set(scene.render.image_settings,'file_format','PNG')
scene.render.filepath = str(directory/'blender-models.png')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space = area.spaces.active
            enum_set(space.shading,'color_type','MATERIAL')
            space.region_3d.view_location = target
            space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
            space.region_3d.view_distance = camera_data.ortho_scale+2
if globals().get('WRITE_OUTPUT',True):
    destination = str(directory/(prefix.lower()+'-preview.blend'))
    if globals().get('PREVIEW_SAVE_MAIN', False):
        bpy.ops.wm.save_as_mainfile(filepath=destination, check_existing=False)
    else:
        bpy.data.libraries.write(destination,{scene})
    bpy.ops.render.render(write_still=True)
print(json.dumps({'scene':scene.name,'models':len(models),'objects':len(scene.objects)}))
