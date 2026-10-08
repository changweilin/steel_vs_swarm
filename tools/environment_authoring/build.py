"""Assemble canonical recipes without rewriting shipped meshes or importing a live session."""
import hashlib
import json
import math
import runpy
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
stage, config_path = sys.argv[sys.argv.index('--') + 1:]
config_file = Path(config_path).resolve()
OUT = config_file.parent
config = json.loads(config_file.read_text(encoding='utf8'))
PROJECT = OUT / 'environment-project.blend'


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


for source, expected in config['recipes'].items():
    if digest(ROOT / source) != expected:
        raise ValueError('Recipe changed during reconstruction: ' + source)


def inspect_scene(scene):
    scene.view_layers[0].update()
    meshes = [obj for obj in scene.objects if obj.type == 'MESH']
    if not meshes:
        raise ValueError('Scene has no meshes: ' + scene.name)
    for obj in meshes:
        if not all(math.isfinite(value) for row in obj.matrix_world for value in row):
            raise ValueError('Non-finite transform: ' + obj.name)
        if not all(math.isfinite(value) for vertex in obj.data.vertices for value in vertex.co):
            raise ValueError('Non-finite geometry: ' + obj.name)
    return {'name': scene.name, 'objects': len(scene.objects), 'meshes': len(meshes),
            'vertices': sum(len(obj.data.vertices) for obj in meshes),
            'triangles': sum(sum(len(face.vertices) - 2 for face in obj.data.polygons) for obj in meshes)}


def save_scenes(destination, scenes):
    for image in bpy.data.images:
        if image.filepath and not image.packed_file:
            image.pack()
    bpy.data.libraries.write(str(destination), set(scenes), fake_user=True)


if stage not in ('assemble', 'verify'):
    job = next(job for job in config['jobs'] if job['id'] == stage)
    previous = set(bpy.data.scenes)
    exports = []
    write_text = Path.write_text

    def capture_export(file, content, *args, **kwargs):
        absolute = file.resolve()
        if absolute.is_relative_to(ROOT / 'public/js'):
            shipped = digest(absolute)
            destination = OUT / 'generated' / absolute.relative_to(ROOT)
            destination.parent.mkdir(parents=True, exist_ok=True)
            result = write_text(destination, content, *args, **kwargs)
            exports.append({'path': str(absolute.relative_to(ROOT)), 'shipped_sha256': shipped,
                            'rebuilt_sha256': digest(destination)})
            if digest(absolute) != shipped:
                raise ValueError('Shipped mesh changed during reconstruction')
            return result
        return write_text(file, content, *args, **kwargs)

    # The existing preview recipes render eagerly; evidence rendering happens once after assembly.
    with patch.object(Path, 'write_text', capture_export), patch.object(bpy.ops, 'render', SimpleNamespace(render=lambda **kwargs: None)):
        for entry in job['scripts']:
            source = entry if isinstance(entry, str) else entry['path']
            globals_ = {} if isinstance(entry, str) else entry.get('globals', {})
            runpy.run_path(str(ROOT / source), init_globals=globals_, run_name='__main__')
    scenes = sorted(set(bpy.data.scenes) - previous, key=lambda scene: scene.name)
    for scene in scenes:
        scene['environment_module'] = stage
        scene['authoring_recipes'] = json.dumps(job['scripts'])
    report = {'module': stage, 'scenes': [inspect_scene(scene) for scene in scenes], 'exports': exports}
    if not scenes:
        raise ValueError('Recipe created no scenes: ' + stage)
    save_scenes(OUT / (stage + '.blend'), scenes)
    (OUT / (stage + '.json')).write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps(report))
elif stage == 'assemble':
    initial = list(bpy.data.scenes)
    for job in config['jobs']:
        with bpy.data.libraries.load(str(OUT / (job['id'] + '.blend')), link=False) as (source, target):
            target.scenes = source.scenes
        for scene in target.scenes:
            scene.name = job['id'] + ' / ' + scene.name
    scenes = [scene for scene in bpy.data.scenes if scene not in initial]
    bpy.context.window.scene = next(scene for scene in scenes if scene.name.startswith('roads / Road Review | interchange'))
    for scene in initial:
        bpy.data.scenes.remove(scene)
    for scene in scenes:
        module = bpy.data.collections.new(scene['environment_module'].title())
        scene.collection.children.link(module)
        for obj in list(scene.collection.objects):
            module.objects.link(obj)
            scene.collection.objects.unlink(obj)
    review_scenes = []
    for job in config['jobs']:
        candidates = [scene for scene in scenes if scene['environment_module'] == job['id'] and scene.camera]
        if not candidates:
            scene = next(scene for scene in scenes if scene['environment_module'] == job['id'])
            scene.view_layers[0].update()
            points = [obj.matrix_world @ Vector(corner) for obj in scene.objects
                      if obj.type == 'MESH' for corner in obj.bound_box]
            low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
            high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
            target = (low + high) / 2
            span = max(high - low)
            camera = bpy.data.cameras.new('Environment overview')
            allowed = [item.identifier for item in camera.bl_rna.properties['type'].enum_items]
            if 'ORTHO' not in allowed:
                raise ValueError('Orthographic review camera unavailable')
            camera.type = 'ORTHO'
            camera.ortho_scale = span * 1.5
            camera.clip_end = span * 10
            obj = bpy.data.objects.new(camera.name, camera)
            scene.collection.children[0].objects.link(obj)
            obj.location = target + Vector((.2, -1, .8)) * span * 2
            obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()
            scene.camera = obj
            allowed = [item.identifier for item in bpy.data.lights.bl_rna.functions['new'].parameters['type'].enum_items]
            if 'SUN' not in allowed:
                raise ValueError('Review sunlight unavailable')
            light = bpy.data.lights.new('Environment sunlight', type='SUN')
            light.energy = 2.4
            sun = bpy.data.objects.new(light.name, light)
            scene.collection.children[0].objects.link(sun)
            sun.rotation_euler = (.5, -.4, -.5)
            candidates = [scene]
        if job.get('review'):
            scene = next(scene for scene in candidates if scene.get('review_key') == job['review'])
        else:
            scene = next((scene for scene in candidates if scene == bpy.context.scene), candidates[0])
        review_scenes.append((job['id'], scene))
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip()
    manifest = {'branch': branch, 'commit': commit, 'blender': bpy.app.version_string,
                'builders': {source: digest(ROOT / source) for source in
                             ['tools/environment_authoring/build.mjs', 'tools/environment_authoring/build.py']},
                'build_config_sha256': digest(config_file),
                'recipes': config['recipes'], 'modules': [job['id'] for job in config['jobs']],
                'scenes': [inspect_scene(scene) for scene in sorted(scenes, key=lambda scene: scene.name)]}
    text = bpy.data.texts.new('Environment Project Sources')
    text.write(json.dumps(manifest, indent=2))
    for relative in [*config['recipes'], *manifest['builders']]:
        text = bpy.data.texts.new(relative)
        text.write((ROOT / relative).read_text(encoding='utf8'))
    bpy.context.scene['source_commit'] = commit
    for image in bpy.data.images:
        if image.filepath and not image.packed_file:
            image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(PROJECT), check_existing=False)
    manifest['project_sha256'] = digest(PROJECT)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
    if config['render']:
        renders = OUT / 'renders'
        renders.mkdir(exist_ok=True)
        for module, scene in review_scenes:
            scene.render.resolution_percentage = 50
            scene.render.filepath = str(renders / (module + '.png'))
            bpy.ops.render.render(write_still=True, scene=scene.name)
    print(json.dumps({'project': str(PROJECT), 'scenes': len(scenes)}))
else:
    bpy.ops.wm.open_mainfile(filepath=str(PROJECT))
    manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf8'))
    actual = [inspect_scene(scene) for scene in sorted(bpy.data.scenes, key=lambda scene: scene.name)]
    if actual != manifest['scenes'] or digest(PROJECT) != manifest['project_sha256']:
        raise ValueError('Reopened project differs from its assembly manifest')
    if digest(config_file) != manifest['build_config_sha256']:
        raise ValueError('Build configuration changed after assembly')
    for source, expected in manifest['builders'].items():
        if digest(ROOT / source) != expected:
            raise ValueError('Builder changed after assembly: ' + source)
    missing = [image.name for image in bpy.data.images if image.filepath and not image.packed_file]
    if missing:
        raise ValueError('External images remain: ' + ', '.join(missing))
    for job in config['jobs']:
        report = json.loads((OUT / (job['id'] + '.json')).read_text(encoding='utf8'))
        for export in report['exports']:
            if digest(ROOT / export['path']) != export['shipped_sha256']:
                raise ValueError('Shipped mesh changed: ' + export['path'])
            if export['rebuilt_sha256'] != export['shipped_sha256']:
                raise ValueError('Rebuilt mesh differs from shipped source: ' + export['path'])
    (OUT / 'validation.json').write_text(json.dumps({'reopen': 'pass', 'packed_images': 'pass',
        'shipped_meshes_unchanged': 'pass', 'rebuilt_meshes_match': 'pass',
        'project_sha256': digest(PROJECT), 'scenes': actual}, indent=2), encoding='utf8')
    print('PASS environment project: clean reopen, packed images and unchanged shipped meshes')
