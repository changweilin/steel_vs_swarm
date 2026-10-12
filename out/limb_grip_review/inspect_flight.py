import bpy,json,re,sys
from pathlib import Path
from types import SimpleNamespace
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/mech_authoring'))
from morph_recipe import apply_form
contract=json.loads((ROOT/'out/limb_grip_review/before/tools/mech_authoring/morphers.json').read_text())
results={}
sources={'m01':'4cd521dd2cf7','s03':'0b41a1444700','s10':'310f97596ba0','t06':'de549d2797dc','t11':'7d295a4e4137','m05':'62d4875398b6','m07':'e038b63b8508','m08':'eca734035ebe'}
for id,spec in contract['assets'].items():
    source=ROOT/'out/anatomical_motion/before'/(id+'-'+sources[id]+'.blend')
    bpy.ops.wm.open_mainfile(filepath=str(source))
    apply_form(SimpleNamespace(spec=spec,nodes={o.name:o for o in bpy.data.objects}),'flight')
    bpy.context.view_layer.update()
    vertices=[];faces=[]
    for mesh in bpy.data.objects:
        if mesh.type!='MESH' or not mesh.parent or mesh.parent.name not in {'chest','hips','pelvis','spine','waist','mesothorax','metathorax'}:continue
        offset=len(vertices);vertices.extend(mesh.matrix_world@v.co for v in mesh.data.vertices);faces.extend(tuple(offset+i for i in p.vertices) for p in mesh.data.polygons)
    tree=BVHTree.FromPolygons(vertices,faces)
    rows=[]
    for name,_,at in spec['joints']:
        if not re.fullmatch(r'(shoulder_[lr]|hip_[lr]|leg_[FMH][LR])',name):continue
        p=bpy.data.objects[name].matrix_world.translation;sgn=1 if p.x>0 else -1
        hit,_,_,_=tree.ray_cast(Vector((20*sgn,p.y,p.z)),Vector((-sgn,0,0)),40)
        rows.append({'root':name,'x':p.x,'exposure':None if hit is None else sgn*(p.x-hit.x)})
    results[id]=rows
(ROOT/'out/limb_grip_review/flight-baseline.json').write_text(json.dumps(results,indent=2))
print('FLIGHT_ROOTS '+json.dumps(results))
