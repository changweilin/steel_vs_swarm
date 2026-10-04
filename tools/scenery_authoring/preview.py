"""Use the shared production-mesh studio for the scenery asset library."""
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
environment = globals().get('ENVIRONMENT_REVIEW', False)
geology = globals().get('GEOLOGY_REVIEW', False)
studio = runpy.run_path(str(ROOT/'tools/transport_authoring/preview.py'), init_globals={
    'REVIEW_DIRECTORY': str(ROOT/'out/scenery_review'/('geology-variants' if geology else 'environment' if environment else '')),
    'PREVIEW_PREFIX': 'Geology' if geology else 'Environment' if environment else 'Scenery', 'PREVIEW_COLUMNS': 4,
    'PREVIEW_MARGIN': 20, 'PREVIEW_LIGHT_GAIN': 2,
    'PREVIEW_SAVE_MAIN': not (environment or geology),
    'WRITE_OUTPUT': globals().get('WRITE_OUTPUT', True) and not geology,
}, run_name='__main__')

if geology:
    import json
    import bpy
    from mathutils import Vector
    scene, models, target = studio['scene'], studio['models'], studio['target']
    enum_set = studio['enum_set']
    enum_set(scene.unit_settings, 'system', 'METRIC')
    for index, model in enumerate(models):
        obj = next(o for o in scene.objects if o.type == 'MESH' and
                   (o.name == model['key'] or o.name.startswith(model['key']+'.')))
        points = [(p['vertices'][i], -p['vertices'][i+2], p['vertices'][i+1])
                  for p in model['parts'] for i in range(0, len(p['vertices']), 3)]
        low = [min(p[i] for p in points) for i in range(3)]
        high = [max(p[i] for p in points) for i in range(3)]
        span = max(high[i]-low[i] for i in range(3))
        scale = 5.4/span
        center = [(high[i]+low[i])/2 for i in range(3)]
        origin = [center[0], center[1], low[2]]
        # Mesh data retains production metres; uniform object scale arranges the gallery.
        for vertex in obj.data.vertices:
            vertex.co = tuple(vertex.co[i]/scale+origin[i] for i in range(3))
        obj.scale = (scale,)*3
        label_position = obj.location.copy() + Vector((-2.7, -3, .015))
        obj.location -= Vector(origin)*scale
        obj['seed'], obj['geology_type'], obj['morphology'] = model['seed'], model['type'], model['shape']
        obj['source_key'] = model['key']
        obj['parameters'] = json.dumps(model['morphology'], sort_keys=True)
        obj['display_scale'] = scale
        obj['source_dimensions_m'] = [high[i]-low[i] for i in range(3)]
        for prop, value in [('type', 'FLOAT_COLOR'), ('domain', 'POINT')]:
            values = [i.identifier for i in obj.data.color_attributes.bl_rna.functions['new'].parameters[prop].enum_items]
            if value not in values:
                raise ValueError(f'Color attribute {prop}: {value} not in {values}')
        attribute = obj.data.color_attributes.new(name='ProductionColor', type='FLOAT_COLOR', domain='POINT')
        rgba, start = [], 0
        for part_index, part in enumerate(model['parts']):
            count = len(part['vertices'])//3
            group = obj.vertex_groups.new(name=('Obstacle' if part_index == 0 else 'Buffer') if model.get('boundary') else 'Body')
            group.add(list(range(start, start+count)), 1, 'REPLACE')
            start += count
            for i in range(0, count*3, 3):
                rgba.extend([part['colors'][i+j]*part['color'][j] if part['colors'] else part['color'][j] for j in range(3)]+[1])
        attribute.data.foreach_set('color', rgba)
        if 'FONT' not in [i.identifier for i in bpy.data.curves.bl_rna.functions['new'].parameters['type'].enum_items]:
            raise ValueError('Font curves unavailable')
        text = bpy.data.curves.new(model['key']+'/label', 'FONT')
        text.body = ('range' if model.get('boundary') else model['type'])+' / '+model['shape']+' / '+str(model['seed'])
        text.size = .31
        label = bpy.data.objects.new(text.name, text)
        scene.collection.objects.link(label)
        label.location = label_position
        text.materials.append(studio['material']([.035,.045,.06]))
    for light, offset, energy in [('Key', (-12,-8,30), 19000), ('Fill', (14,8,28), 15000)]:
        obj = next(o for o in scene.objects if o.type == 'LIGHT' and o.name.startswith(light))
        obj.location = target+Vector(offset)
        obj.rotation_euler = (target-obj.location).to_track_quat('-Z','Y').to_euler()
        obj.data.energy, obj.data.size = energy, 30
    scene.world.use_nodes = True
    background = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    background.inputs[0].default_value = (.48,.54,.61,1)
    background.inputs[1].default_value = .45
    scene.camera.location = target+Vector((8,-55,65))
    scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera.data.ortho_scale = 47
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1900
    if globals().get('WRITE_OUTPUT', True):
        bpy.data.libraries.write(str(studio['directory']/'geology-preview.blend'), {scene})
        bpy.ops.render.render(write_still=True)
    print(json.dumps({'scene': scene.name, 'models': len(models), 'objects': len(scene.objects)}))
