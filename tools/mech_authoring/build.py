"""Rigid mechanical assets. Blender owns geometry; the runtime receives derived joint meshes."""
import argparse
import copy
import hashlib
import importlib
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--asset', default='all')
parser.add_argument('--contract', default='assets.json')
parser.add_argument('--no-render', action='store_true')
parser.add_argument('--rebuild', action='store_true', help='Write isolated reproducibility evidence without replacing authored sources')
args = parser.parse_args(ARGS)
contract_path = HERE / args.contract
contract = json.loads(contract_path.read_text(encoding='utf8'))
if 'inherit' in contract:
    contract = json.loads((HERE / contract['inherit']).read_text(encoding='utf8')) | contract
assert args.asset == 'all' or args.asset in contract['assets'], 'Unknown asset: ' + args.asset
sys.path.insert(0, str(HERE))
from catalog import construct
adapter = importlib.import_module(contract['authoring']['adapter']) if 'adapter' in contract['authoring'] else None
OUT = (HERE / contract['authoring']['outputs']).resolve()
RUNTIME = (HERE / contract['authoring']['runtime']).resolve()
EXPORT = (HERE / contract['authoring']['export']).resolve()
if args.rebuild:
    OUT = OUT / '_rebuild'
    RUNTIME = OUT / 'runtime'
    EXPORT = OUT / 'exports'
for directory in [OUT, RUNTIME, EXPORT]:
    directory.mkdir(parents=True, exist_ok=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def xyz(v):
    return Vector((v[0], -v[2], v[1]))


def unxyz(v):
    return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]


def rgba(value):
    c = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92 for v in c) + (1,)


class Asset:
    def __init__(self, spec):
        spec = copy.deepcopy(spec)
        self.spec = spec
        rig = spec['rig']
        if rig.get('gunR') and rig.get('aimPose'):
            rig['gunR']['aim'] = -(rig['aimPose']['rShoulderX'] + rig['aimPose']['rElbowX'])
        if rig.get('rider') and rig.get('gunR'):
            base = rig['armBase'][0]
            rig['gunR']['rest'] = rig['gunR']['aim'] = -(base['shX'] + base['elX'])
        self.p = dict(spec['parameters'])
        positions = {name: position for name, _, position in spec['joints']}
        if spec.get('recipe'):
            if spec['kind'] == 'quad':
                pairs = [(rig['leg' + key], rig['ch' + key]) for key in ['FL', 'FR', 'HL', 'HR']]
            elif spec['kind'] == 'biped':
                pairs = [(rig['leg' + key], rig['legChain' + key]) for key in ['L', 'R']]
            else:
                pairs = []
            self.p['legs'] = [{'root': root, 'deltas': [positions[j['g']] for j in chain],
                               'side': 1 if positions[root][0] > 0 else -1} for root, chain in pairs]
            self.p['tentacles'] = [{'root': chain[0]['g'], 'deltas': [positions[j['g']] for j in chain[1:]]}
                                   for chain in rig.get('tents', [])]
            self.p['tail'] = [positions[name] for name in rig.get('tailSegs', [])]
        if spec['id'] == 's01':
            self.p.update(rotorX=abs(positions['rotor_lf'][0]), rotorZ=abs(positions['rotor_lf'][2]))
        elif spec['id'] == 't10':
            self.p.update(thigh=abs(positions['knee_l'][1]), shin=abs(positions['ankle_l'][1]),
                          foreArm=abs(positions['wrist_l'][1]))
        self.nodes = {}
        self.materials = {}
        self.parts = []
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        self.root = bpy.data.objects.new(spec['id'], None)
        bpy.context.collection.objects.link(self.root)
        for name, desc in spec['materials'].items():
            material = bpy.data.materials.new(name)
            material.diffuse_color = rgba(desc['color'])[:3] + (desc.get('opacity', 1),)
            material.use_nodes = True
            bsdf = material.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = rgba(desc['color'])
            bsdf.inputs['Metallic'].default_value = desc.get('metal', 0)
            bsdf.inputs['Roughness'].default_value = .46
            bsdf.inputs['Emission Color'].default_value = rgba(desc['color'])
            bsdf.inputs['Emission Strength'].default_value = desc.get('emission', 0)
            bsdf.inputs['Alpha'].default_value = desc.get('opacity', 1)
            self.materials[name] = material
        for name, parent, position in spec['joints']:
            node = bpy.data.objects.new(name, None)
            node.empty_display_type = 'SPHERE'
            node.empty_display_size = .08
            node.parent = self.nodes[parent] if parent else self.root
            node.location = xyz(position)
            bpy.context.collection.objects.link(node)
            self.nodes[name] = node
        self.root['reference'] = spec['inputs']['image']
        self.root['prompt'] = spec['inputs']['prompt']
        self.root['authoring_contract'] = str(contract_path)

    def mesh(self, name, parent, vertices, faces, material, at=(0, 0, 0), bevel=0):
        data = bpy.data.meshes.new(name)
        data.from_pydata([xyz(v) for v in vertices], [], faces)
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(data)
        bm.free()
        data.update()
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.parent = self.nodes[parent]
        obj.location = xyz(at)
        obj.data.materials.append(self.materials[material])
        obj['region'] = material
        if bevel:
            modifier = obj.modifiers.new('Armor edge chamfer', 'BEVEL')
            modifier.width = bevel
            modifier.segments = 1
        self.parts.append(obj)
        return obj

    def box(self, name, parent, size, at, material, bevel=.025):
        w, h, d = [v / 2 for v in size]
        vertices = [(x * w, y * h, z * d) for x, y, z in
                    [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                     (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
        return self.mesh(name, parent, vertices,
                         [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                          (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)], material, at, bevel)

    def plate(self, name, parent, points, depth, at, material):
        n = len(points)
        vertices = [(x, y, z) for z in (-depth / 2, depth / 2) for x, y in points]
        faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        return self.mesh(name, parent, vertices, faces, material, at, .015 if depth > .06 else 0)

    def tube(self, name, parent, radius, inner, length, at, material, axis='z', segments=16):
        vertices = []
        for z, r in [(-length / 2, radius), (length / 2, radius),
                     (-length / 2, inner), (length / 2, inner)]:
            for i in range(segments):
                th = i * math.tau / segments
                q = (r * math.cos(th), r * math.sin(th), z)
                vertices.append(q if axis == 'z' else (q[0], q[2], q[1]) if axis == 'y' else (q[2], q[0], q[1]))
        faces = []
        for i in range(segments):
            j = (i + 1) % segments
            faces += [(i, j, j + segments, i + segments),
                      (i + 2 * segments, i + 3 * segments, j + 3 * segments, j + 2 * segments),
                      (i, i + 2 * segments, j + 2 * segments, j),
                      (i + segments, j + segments, j + 3 * segments, i + 3 * segments)]
        return self.mesh(name, parent, vertices, faces, material, at)

    def disk(self, name, parent, radius, depth, at, material, axis='z', segments=12):
        vertices = []
        for z in [-depth / 2, depth / 2]:
            for i in range(segments):
                th = i * math.tau / segments
                q = (radius * math.cos(th), radius * math.sin(th), z)
                vertices.append(q if axis == 'z' else (q[0], q[2], q[1]) if axis == 'y' else (q[2], q[0], q[1]))
        faces = [tuple(reversed(range(segments))), tuple(range(segments, 2 * segments))]
        faces += [(i, (i + 1) % segments, (i + 1) % segments + segments, i + segments) for i in range(segments)]
        return self.mesh(name, parent, vertices, faces, material, at)

    def loft(self, name, parent, sections, material, at=(0, 0, 0), axis='y'):
        # The chamfered cross-section preserves long planar armor regions for cel shading.
        ring = [(-.72, -.5), (.72, -.5), (1, -.28), (1, .28),
                (.72, .5), (-.72, .5), (-1, .28), (-1, -.28)]
        vertices = []
        for longitudinal, width, depth in sections:
            for x, z in ring:
                vertices.append((x * width / 2, longitudinal, z * depth) if axis == 'y'
                                else (x * width / 2, z * depth, longitudinal))
        n = len(ring)
        faces = [tuple(reversed(range(n))), tuple(range(len(vertices) - n, len(vertices)))]
        faces += [(s * n + i, s * n + (i + 1) % n,
                   (s + 1) * n + (i + 1) % n, (s + 1) * n + i)
                  for s in range(len(sections) - 1) for i in range(n)]
        # Swapping Y and Z reverses handedness.
        if axis == 'z':
            faces = [tuple(reversed(f)) for f in faces]
        return self.mesh(name, parent, vertices, faces, material, at)

    def strut(self, name, parent, start, end, width, material):
        direction = xyz(end) - xyz(start)
        obj = self.box(name, parent, (width, width, direction.length),
                       tuple((a + b) / 2 for a, b in zip(start, end)), material, .015)
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = Vector((0, -1, 0)).rotation_difference(direction)
        return obj

    def drone(self):
        p = self.p
        length, w, h = p['length'], p['width'], p['depth']
        sections = [(-length * .5, .17, h * .22), (-length * .36, w * .73, h * .85),
                    (-length * .12, w, h), (length * .15, w * .96, h),
                    (length * .33, w * .81, h * .87), (length * .5, w * .18, h * .26)]
        self.loft('Carbon ventral keel', 'tilt', sections, 'dark', (0, -.055, 0), 'z')
        self.loft('Blue dorsal armor', 'tilt', [(z, a * .96, b * .79) for z, a, b in sections], 'blue', (0, .115, 0), 'z')
        for i, z in enumerate([-.82, -1.5]):
            width = w * (.9 if i == 0 else .65)
            self.loft('Golden abdomen band ' + str(i), 'tilt', [(z - .13, width, h * .78), (z + .13, width * 1.08, h * .84)], 'gold', (0, .12, 0), 'z')
        for side in [-1, 1]:
            self.loft('Golden forward chine ' + str(side), 'tilt', [(.26, .25, .45), (1.25, .23, .4), (1.96, .11, .14)], 'gold', (side * .43, .11, 0), 'z')
            for name, radius, depth, z, material in [('Golden sensor cheek', .31, .16, .3, 'gold'),
                                                    ('Compound sensor eye', .27, .18, .35, 'dark'),
                                                    ('Sensor lens', .23, .19, .38, 'glow')]:
                eye = self.disk(name + ' ' + str(side), 'sensor', radius, depth, (side * .34, -.08, z), material, 'z', 24)
                eye.rotation_euler.z = side * .55
            for j in range(3):
                for k in range(4):
                    self.disk('Sensor cell', 'sensor', .025, .008, (side * (.25 + k * .065), -.2 + j * .1, .49), 'blue', 'z', 6)
            for z, suffix in [(p['rotorZ'], 'f'), (-p['rotorZ'], 'r')]:
                prefix = ('l' if side < 0 else 'r') + suffix
                center = (side * p['rotorX'], .03, z)
                self.strut('Carbon rotor arm ' + prefix, 'tilt', (side * .43, 0, z * .73), center, .17, 'dark')
                self.strut('Arm brace ' + prefix, 'tilt', (side * .44, -.12, z * .55), (center[0], -.07, z), .075, 'steel')
                self.tube('Full blue duct ' + prefix, 'tilt', p['rotorRadius'], p['rotorRadius'] - .095, p['ductDepth'], center, 'blue', 'y', 32)
                self.tube('Golden duct rim ' + prefix, 'tilt', p['rotorRadius'] + .012, p['rotorRadius'] - .035, .066, (center[0], .17, z), 'gold', 'y', 32)
                self.tube('Golden lower duct belt ' + prefix, 'tilt', p['rotorRadius'] + .006, p['rotorRadius'] - .094, .13, (center[0], -.055, z), 'gold', 'y', 32)
                self.tube('Cyan inner airflow ring ' + prefix, 'tilt', p['rotorRadius'] - .09, p['rotorRadius'] - .106, .018, (center[0], .105, z), 'glow', 'y', 32)
                node = 'rotor_' + prefix
                self.disk('Motor hub ' + prefix, node, .14, .22, (0, 0, 0), 'steel', 'y')
                for angle in [0, math.tau / 3, 2 * math.tau / 3]:
                    blade = self.box('Rotor blade ' + prefix, node, (.7, .025, .13), (.34 * math.cos(angle), -.015, .34 * math.sin(angle)), 'dark', .007)
                    blade.rotation_euler.z = -angle
                pod = 'pod_l' if side < 0 else 'pod_r'
            self.loft('Rocket pod casing', pod, [(-.52, .51, .5), (.42, .48, .47), (.54, .39, .39)], 'blue', axis='z')
            self.tube('Rocket pod collar', pod, .27, .22, .08, (0, 0, .48), 'gold')
            for j in range(6):
                a = j * math.tau / 6
                self.tube('Rocket cell', pod, .072, .052, .4, (.16 * math.cos(a), .16 * math.sin(a), .44), 'steel', segments=10)
                self.disk('Rocket warhead', pod, .042, .045, (.16 * math.cos(a), .16 * math.sin(a), .46), 'gold', segments=8)
            self.box('Rocket port shutter', 'rocket_gate_l' if side < 0 else 'rocket_gate_r', (.42, .025, .2), (0, 0, .075), 'gold', .008)
            emitter = 'emitter_l' if side < 0 else 'emitter_r'
            self.box('Shield emitter petal', emitter, (.19, .06, .72), (side * .1, .025, 0), 'gold')
            self.box('Shield emitter rail', emitter, (.045, .025, .56), (side * .1, .072, 0), 'glow', .005)
        self.loft('Gun gimbal cradle', 'gun', [(-.16, .26, .29), (.25, .22, .24)], 'steel', axis='z')
        self.tube('Coaxial nose gun', 'gun_recoil', .083, .048, .77, (0, 0, .53), 'steel', segments=12)
        self.tube('Muzzle brake', 'gun_recoil', .12, .049, .11, (0, 0, .93), 'dark')
        self.disk('Gun muzzle glow', 'light_muzzle', .041, .008, (0, 0, 0), 'glow')
        for z in [-.25, .08, .4]:
            for side in [-1, 1]:
                self.box('Ventral intake', 'tilt', (.13, .09, .18), (side * .62, -.18, z), 'black', .008)
        for side in [-1, 1]:
            self.loft('Dorsal recessed side panel', 'tilt', [(-.45, .18, .1), (.5, .22, .11), (.94, .12, .07)], 'dark', (side * .4, .49, 0), 'z')
            self.loft('Golden dorsal seam', 'tilt', [(-.45, .036, .016), (.5, .036, .016), (.94, .025, .016)], 'gold', (side * .32, .5, 0), 'z')
        self.plate('Forehead national badge', 'sensor', [(-.11, 0), (-.07, -.13), (0, -.18), (.07, -.13), (.11, 0), (.035, -.045), (0, .05), (-.035, -.045)], .014, (0, .03, .57), 'gold')
        self.barrier('barrier', 2.05, 1.1)

    def mech(self):
        p = self.p
        self.loft('Pelvic chassis', 'hips', [(-.42, .76, .48), (.2, 1.05, .67), (.45, .66, .5)], 'dark')
        self.plate('Pelvic frontal armor', 'hips', [(-.36, .3), (.36, .3), (.3, -.22), (0, -.39), (-.3, -.22)], .17, (0, -.01, .39), 'armor')
        self.loft('Articulated narrow abdomen', 'chest', [(.3, .72, .54), (.82, .92, .61), (1.03, 1.02, .7)], 'dark')
        self.plate('Central abdominal plate', 'chest', [(-.27, .43), (.27, .43), (.19, 0), (0, -.19), (-.19, 0)], .15, (0, .57, .38), 'shade')
        self.loft('Tapered chest carapace', 'chest', [(.88, 1.0, .69), (1.35, p['chestWidth'], .85), (1.97, 1.67, .75), (2.08, 1.2, .58)], 'shade')
        for side in [-1, 1]:
            pts = [(-.43, .36), (.36, .29), (.4, -.03), (.12, -.42), (-.36, -.3)]
            self.plate('Split pectoral armor', 'chest', [(x * side, y) for x, y in (pts if side > 0 else reversed(pts))], .16, (side * .43, 1.58, .42), 'armor')
            for j in range(4):
                self.box('Chest heat exhaust', 'chest', (.38, .035, .04), (side * .5, 1.18 + j * .065, .522), 'black', .006)
            self.box('Lapis chest inlay', 'chest', (.38, .045, .025), (side * .46, 1.66, .521), 'blue', .004)
            self.box('Back heat sink', 'chest', (.36, .65, .18), (side * .49, 1.42, -.49), 'dark')
            for j in range(4):
                self.box('Back cooling fin', 'chest', (.32, .028, .04), (side * .49, 1.19 + j * .115, -.6), 'steel', .003)
        self.plate('Sternum keystone', 'chest', [(-.2, .37), (.2, .37), (.24, -.23), (0, -.42), (-.24, -.23)], .17, (0, 1.58, .52), 'armor')
        # Four narrow strokes form the right-chest geometric tattoo as actual surfaces.
        for a, b in [((.33, 1.78, .535), (.59, 1.56, .535)), ((.59, 1.56, .535), (.7, 1.82, .535)),
                     ((.7, 1.82, .535), (.42, 1.89, .535)), ((.42, 1.89, .535), (.33, 1.78, .535))]:
            self.strut('Right chest geometric insignia', 'chest', (-a[0], a[1], a[2]), (-b[0], b[1], b[2]), .022, 'shade')
        self.disk('Neck actuator', 'chest', .19, .2, (0, 2.16, 0), 'dark', 'y')
        self.loft('Trapezoid helmet', 'head', [(-.31, .4, .43), (.12, .62, .56), (.34, .4, .38)], 'armor')
        self.plate('Dark face inset', 'head', [(-.26, .15), (.26, .15), (.17, -.29), (0, -.34), (-.17, -.29)], .09, (0, .02, .3), 'dark')
        self.plate('Brow shade', 'head', [(-.34, .2), (.2, .25), (.31, .09), (-.29, .045)], .11, (0, .07, .365), 'dark')
        self.plate('Amber slit visor', 'head', [(-.2, .035), (.2, .035), (.13, -.04), (-.13, -.04)], .012, (0, .016, .421), 'visor')
        self.plate('Angular face mask', 'head', [(-.14, .02), (.14, .02), (.1, -.24), (0, -.3), (-.1, -.24)], .06, (0, -.06, .377), 'shade')
        for side in [-1, 1]:
            self.disk('Circular ear radar', 'head', .24, .12, (side * .38, 0, 0), 'steel', 'x', 24)
            self.tube('Radar silver rim', 'head', .235, .202, .13, (side * .4, 0, 0), 'armor', 'x', 24)
            self.disk('Radar dish', 'head', .18, .015, (side * .473, 0, 0), 'shade', 'x', 20)
            self.disk('Radar receiver', 'head', .045, .038, (side * .491, 0, 0), 'glow', 'x')
            # Facing +Z, anatomical left is +X (the viewer's right in the front camera).
            suffix = 'l' if side > 0 else 'r'
            hip, knee, ankle = ['hip_' + suffix, 'knee_' + suffix, 'ankle_' + suffix]
            sh, elbow, wrist = ['shoulder_' + suffix, 'elbow_' + suffix, 'wrist_' + suffix]
            for node, radius, at in [(hip, .25, (0, -.06, 0)), (knee, .23, (0, 0, 0)), (ankle, .19, (0, 0, 0)), (sh, .26, (0, 0, 0)), (elbow, .18, (0, 0, 0))]:
                self.disk('Joint actuator ' + node, node, radius, .5 if node == hip else .35, at, 'dark', 'x')
                self.disk('Joint hub ' + node, node, radius * .52, .06, (side * .23, at[1], 0), 'steel', 'x')
            self.loft('Thigh hard shell', hip, [(-p['thigh'] + .2, .47, .54), (-.54, .72, .67), (-.17, .59, .56)], 'shade')
            self.plate('Thigh front bevel plate', hip, [(-.28, .42), (.28, .42), (.24, -.24), (0, -.52), (-.22, -.34)], .13, (0, -.66, .34), 'armor')
            self.box('Thigh lapis band', hip, (.48, .055, .02), (0, -.52, .425), 'blue', .004)
            self.plate('Knee guard', knee, [(-.25, .15), (.25, .15), (.28, -.16), (0, -.3), (-.28, -.16)], .19, (0, 0, .29), 'armor')
            self.loft('Tapered shin armor', knee, [(-p['shin'] + .14, .31, .36), (-.72, .52, .57), (-.27, .47, .47)], 'shade')
            self.plate('Shin frontal blade', knee, [(-.22, .4), (.22, .4), (.16, -.45), (.06, -.66), (-.16, -.5)], .11, (0, -.78, .29), 'armor')
            self.plate('Shin lapis identifier', knee, [(-.065, .16), (.065, .16), (.035, -.09)], .015, (0, -.76, .36), 'blue')
            self.loft('Ankle armored boot', ankle, [(-.25, .5, .8), (-.08, .56, .79), (.09, .32, .44)], 'armor', (0, -.015, .17))
            self.box('Foot dark sole', ankle, (.57, .1, .87), (0, -.26, .2), 'dark')
            self.box('Toe layered cap', ankle, (.49, .12, .36), (0, -.15, .45), 'shade')
            self.loft('Shoulder interceptor pauldron', sh, [(-.29, .7, .71), (.1, .77, .67), (.27, .59, .54)], 'armor', (side * .05, -.05, 0))
            self.box('Shoulder blue inlay', sh, (.54, .055, .018), (side * .045, -.02, .37), 'blue', .004)
            self.loft('Upper arm armor', sh, [(-.84, .31, .37), (-.38, .39, .44), (-.22, .42, .43)], 'shade')
            self.loft('Forearm enclosure', elbow, [(-p['foreArm'] + .12, .32, .36), (-.28, .49, .5), (-.08, .39, .38)], 'armor')
            self.box('Forearm steel tendon', elbow, (.1, .51, .11), (side * .17, -.45, -.22), 'steel', .018)
            self.box('Palm', wrist, (.27, .3, .16), (0, -.08, .01), 'shade')
            for j in range(4):
                self.box('Finger lower', wrist, (.046, .16, .075), (-.09 + j * .061, -.27, .042), 'dark', .009)
                self.box('Finger armor', wrist, (.043, .1, .068), (-.09 + j * .061, -.21, .075), 'armor', .009)
            self.box('Thumb', wrist, (.085, .19, .12), (side * .19, -.02, .07), 'armor', .01)
        self.loft('Right forearm gun housing', 'gun', [(-.29, .42, .39), (.22, .5, .49), (.43, .37, .34)], 'dark', axis='z')
        for j in range(6):
            th = math.tau * j / 6
            self.tube('Rotary gun barrel ' + str(j), 'gun_spin', .048, .025, .78, (.12 * math.cos(th), .12 * math.sin(th), .42), 'steel', segments=10)
        for z in [.08, .63, .84]:
            self.tube('Barrel retaining ring', 'gun_spin', .198, .158, .06, (0, 0, z), 'dark')
        self.disk('Rotary gun muzzle glow', 'light_muzzle', .043, .008, (0, 0, 0), 'glow')
        self.loft('Single left shoulder VLS', 'launcher', [(-.37, .71, .67), (.66, .71, .67), (.93, .62, .63)], 'shade')
        self.box('VLS side armor', 'launcher', (.77, .87, .07), (0, .29, .36), 'armor')
        for x in [-.16, .16]:
            for z in [-.21, 0, .21]:
                self.tube('VLS launch cell', 'launcher', .112, .088, .45, (x, .76, z), 'dark', 'y', 12)
                self.disk('VLS missile nose', 'launcher', .07, .06, (x, .79, z), 'steel', 'y')
        self.box('Hinged launcher lid', 'launcher_lid', (.71, .045, .7), (0, .015, .32), 'dark')
        for side, name in [(-1, 'shield_leaf_l'), (1, 'shield_leaf_r')]:
            self.plate('Retractable shield emitter', name, [(-.1, .28), (.1, .24), (.1, -.26), (-.1, -.29)], .065, (side * .09, 0, 0), 'armor')
            self.box('Emitter luminous edge', name, (.035, .43, .018), (side * .1, 0, .05), 'glow', .004)
        self.barrier('barrier', 1.08, 1.33)

    def barrier(self, parent, rx, ry):
        points = [(rx * math.cos(i * math.tau / 64), ry * math.sin(i * math.tau / 64)) for i in range(64)]
        self.plate('Holographic radar membrane', parent, points, .007, (0, 0, 0), 'shield')
        for factor in [1, .73, .42]:
            for i in range(32):
                a, b = i * math.tau / 32, (i + 1) * math.tau / 32
                self.strut('Radar reticle ring', parent, (rx * factor * math.cos(a), ry * factor * math.sin(a), .015),
                           (rx * factor * math.cos(b), ry * factor * math.sin(b), .015), .012 if factor < 1 else .025, 'glow')
        for angle in [0, math.pi / 2, math.pi, 3 * math.pi / 2]:
            self.strut('Radar quadrant tick', parent, (rx * .75 * math.cos(angle), ry * .75 * math.sin(angle), .015),
                       (rx * .92 * math.cos(angle), ry * .92 * math.sin(angle), .015), .02, 'glow')

    def armature(self):
        # Mechanical meshes remain rigid. Bones expose the same driver joints to Blender editors.
        bpy.context.view_layer.update()
        data = bpy.data.armatures.new(self.spec['id'] + '_skeleton')
        obj = bpy.data.objects.new(self.spec['id'] + '_skeleton', data)
        bpy.context.collection.objects.link(obj)
        obj.show_in_front = True
        obj.display_type = 'WIRE'
        obj.hide_render = True
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        children = {}
        for name, parent, _ in self.spec['joints']:
            bone = data.edit_bones.new(name)
            bone.head = self.nodes[name].matrix_world.translation
            child = next((other for other, owner, _ in self.spec['joints'] if owner == name
                          and (self.nodes[other].matrix_world.translation - bone.head).length > .04), None)
            children[name] = child
            bone.tail = self.nodes[child].matrix_world.translation if child else bone.head + Vector((0, 0, .18))
            if parent:
                bone.parent = data.edit_bones[parent]
        bpy.ops.object.mode_set(mode='OBJECT')
        for name in self.nodes:
            constraint = obj.pose.bones[name].constraints.new('COPY_LOCATION')
            constraint.target = self.nodes[name]
            constraint.target_space = 'WORLD'
            constraint.owner_space = 'WORLD'
            if children[name]:
                track = obj.pose.bones[name].constraints.new('DAMPED_TRACK')
                track.target = self.nodes[children[name]]
                track.track_axis = 'TRACK_Y'
        obj.select_set(False)
        return obj

    def reset(self):
        for name, _, at in self.spec['joints']:
            node = self.nodes[name]
            node.location = xyz(at)
            node.rotation_euler = (0, 0, 0)
            node.scale = (1, 1, 1)
        for h in self.spec['motion']['shield']['hinges']:
            self.rotate(self.nodes[h['node']], h['axis'], h['rest'])
        self.nodes['barrier'].scale = (.001,) * 3

    @staticmethod
    def rotate(node, axis, value):
        index, sign = {'x': (0, 1), 'y': (2, 1), 'z': (1, -1)}[axis]
        node.rotation_euler[index] = value * sign

    def pose(self, clip, t):
        self.reset()
        motion = self.spec['motion']
        u = max(0, min(1, t))
        e = u * u * (3 - 2 * u)
        rig = self.spec['rig']
        if rig.get('rider'):
            for shoulder, elbow, base in zip(rig['armSh'], rig['armEl'], rig['armBase']):
                self.rotate(self.nodes[shoulder], 'x', base['shX'])
                self.rotate(self.nodes[elbow], 'x', base['elX'])
            self.rotate(self.nodes[rig['gunR']['g']], 'x', rig['gunR']['rest'])
        if clip == 'idle':
            rig = self.spec['rig']
            carrier = self.nodes[rig.get('tilt') or rig.get('hips') or rig['spine']]
            carrier.location.z += math.sin(t * math.tau) * .025
            self.rotate(self.nodes[rig.get('head', 'sensor')], 'y', math.sin(t * math.tau) * .1)
        elif clip in ('shield_deploy', 'shield_retract'):
            if clip == 'shield_retract':
                e = 1 - e
            for h in motion['shield']['hinges']:
                self.rotate(self.nodes[h['node']], h['axis'], h['rest'] + (h['deploy'] - h['rest']) * e)
            if 'arm' in motion['shield']:
                arm = motion['shield']['arm']
                for key in ['shoulder', 'elbow', 'wrist']:
                    self.rotate(self.nodes[arm[key]], 'x', arm[key + 'X'] * e)
            k = max(.001, min(1, (e - .18) / .82))
            self.nodes['barrier'].scale = (k,) * 3
        elif clip == 'run':
            if self.spec['kind'] == 'biped':
                for side, phase in [('l', 0), ('r', 0 if rig.get('hop') else math.pi)]:
                    angle = math.sin(t * math.tau + phase)
                    self.rotate(self.nodes['hip_' + side], 'x', angle * .55)
                    self.rotate(self.nodes['knee_' + side], 'x', max(0, -angle) * .7)
                    self.rotate(self.nodes['shoulder_' + side], 'x', -angle * .34)
                    self.rotate(self.nodes['elbow_' + side], 'x', -.35)
                    if self.p.get('legAnatomy'):
                        for joint in rig['legChain' + side.upper()]:
                            self.rotate(self.nodes[joint['g']], joint.get('axis', 'x'),
                                        joint['k'] * max(0, -angle) * .75)
                if rig.get('hop'):
                    self.nodes['hips'].location.z += max(0, math.sin(t * math.tau)) * .4
            elif self.spec['kind'] == 'quad':
                if rig.get('insectLegs'):
                    for leg in rig['insectLegs']:
                        phase = (math.pi if leg['key'] in ['FR', 'ML', 'HR'] else 0) + t * math.tau
                        self.rotate(self.nodes[leg['root']], 'y', leg['side'] * math.sin(phase) * .25)
                        self.rotate(self.nodes[leg['lift']], 'z', leg['side'] * max(0, -math.cos(phase)) * .28)
                        for joint in rig[leg['chain']]:
                            self.rotate(self.nodes[joint['g']], joint.get('axis', 'x'),
                                        joint['base'] + joint['k'] * max(0, -math.cos(phase - joint['d'])) * .4)
                else:
                    for i, key in enumerate(['FL', 'FR', 'HL', 'HR']):
                        phase = t * math.tau + [0, math.pi, math.pi, 0][i]
                        grasp = key[0] == 'F' and rig.get('limb', {}).get('foreRole') == 'grasp'
                        self.rotate(self.nodes[rig['leg' + key]], 'x',
                                    rig.get('quadBase', {}).get(key, 0) + math.sin(phase) * (.07 if grasp else .4))
                        for j, joint in enumerate(rig.get('ch' + key, [])):
                            angle = (joint['base'] + joint['k'] * max(0, -math.sin(phase-joint['d'])) * (.10 if grasp else .65)
                                     if self.p.get('legAnatomy') else math.sin(t * math.tau-j*.5)*.18)
                            self.rotate(self.nodes[joint['g']], joint.get('axis', 'x'), angle)
            else:
                self.rotate(self.nodes['tilt'], 'x', 0 if rig.get('level') else .22)
                self.rotate(self.nodes['tilt'], 'z', math.sin(t * math.tau) * .2)
                for entry in self.spec['rig'].get('spin', []):
                    name = entry if isinstance(entry, str) else entry['node']
                    self.rotate(self.nodes[name], 'y' if isinstance(entry, str) else entry['axis'], t * math.tau * 3)
                for wing in self.spec['rig'].get('wings', []):
                    self.rotate(self.nodes[wing['w']], 'z', wing['sgn'] * math.sin(t * math.tau) * .3)
                    self.rotate(self.nodes[wing['outer']], 'z', wing['sgn'] * math.sin(t * math.tau - .6) * .4)
        elif clip in ('light', 'heavy', 'skill', 'ult'):
            group = 'fire' if clip == 'light' else 'charge' if clip == 'heavy' else 'cast'
            weight = math.sin(math.pi * u) ** 2
            for track in motion[group]:
                node = self.nodes[track['node']]
                value = track['rest'] + track['amplitude'] * weight
                if track['channel'] == 'rotation':
                    self.rotate(node, track['axis'], value)
                else:
                    node.location = xyz([value if axis == track['axis'] else 0 for axis in 'xyz'])
            if self.spec['rig'].get('aimPose'):
                rig = self.spec['rig']
                self.rotate(self.nodes[rig['armR']], 'x', rig['aimPose']['rShoulderX'] * weight)
                self.rotate(self.nodes[rig['armChainR'][0]['g']], 'x', rig['aimPose']['rElbowX'] * weight)
                gun = rig['gunR']
                self.rotate(self.nodes[gun['g']], 'x', gun['rest'] + (gun['aim'] - gun['rest']) * weight)
                if clip == 'skill':
                    self.rotate(self.nodes['shoulder_l'], 'x', -.6 * weight)
                    self.rotate(self.nodes['elbow_l'], 'x', -.85 * weight)
            elif self.spec['kind'] == 'aerial':
                self.rotate(self.nodes['tilt'], 'x', -.13 * weight)

    def animations(self):
        clips = self.spec.get('clips', ['idle', 'run', 'light', 'heavy', 'skill', 'ult', 'shield_deploy', 'shield_retract'])
        for clip in clips:
            for node in self.nodes.values():
                node.animation_data_create()
                node.animation_data.action = None
            for frame in range(1, 32, 3):
                self.pose(clip, (frame - 1) / 30)
                for node in self.nodes.values():
                    node.keyframe_insert(data_path='location', frame=frame)
                    node.keyframe_insert(data_path='rotation_euler', frame=frame)
                    node.keyframe_insert(data_path='scale', frame=frame)
            for node in self.nodes.values():
                action = node.animation_data.action
                action.name = self.spec['id'] + ':' + clip + ':' + node.name
                track = node.animation_data.nla_tracks.new()
                track.name = clip
                track.strips.new(clip, 1, action)
                track.mute = True
                node.animation_data.action = None
        self.reset()
        return clips

    def runtime(self):
        self.reset()
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        batches = {}
        for obj in self.parts:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            transform = obj.parent.matrix_world.inverted() @ evaluated.matrix_world
            normal_transform = transform.to_3x3().inverted().transposed()
            key = (obj.parent.name, obj['region'])
            batch = batches.setdefault(key, {'parent': key[0], 'material': key[1], 'positions': [], 'normals': [], 'indices': [], 'parts': []})
            batch['parts'].append(obj.name)
            for tri in mesh.loop_triangles:
                normal = unxyz((normal_transform @ tri.normal).normalized())
                for vertex in tri.vertices:
                    batch['indices'].append(len(batch['positions']) // 3)
                    batch['positions'].extend(unxyz(transform @ mesh.vertices[vertex].co))
                    batch['normals'].extend(normal)
            evaluated.to_mesh_clear()
        data = {'id': self.spec['id'], 'kind': self.spec['kind'], 'height': self.spec['height'],
                'source': {'contract': digest(contract_path), 'builder': digest(Path(__file__)), 'catalog': digest(Path(adapter.__file__) if adapter else HERE / 'catalog.py'),
                           'image': digest((HERE / self.spec['inputs']['image']).resolve())},
                'joints': self.spec['joints'], 'materials': self.spec['materials'], 'components': self.spec['components'],
                'meshes': list(batches.values()), 'rig': self.spec['rig'], 'motion': self.spec['motion']}
        if 'forms' in self.spec:
            data['forms'] = self.spec['forms']
        if 'inherit' in contract:
            data['source']['sharedContract'] = digest(HERE / contract['inherit'])
            data['source']['sharedCatalog'] = digest(HERE / 'catalog.py')
        triangles = sum(len(b['indices']) // 3 for b in batches.values())
        assert triangles <= contract['limits']['trianglesPerUnit'], triangles
        assert len(batches) <= contract['limits']['meshesPerUnit'], len(batches)
        for batch in batches.values():
            assert all(math.isfinite(v) for v in batch['positions'] + batch['normals'])
        output = RUNTIME / (self.spec['id'] + '.js')
        output.write_text('// Generated by tools/mech_authoring/build.py; edit the owning contract or builder.\nexport default ' + json.dumps(data, separators=(',', ':')) + ';\n', encoding='utf8')
        self.batches = list(batches.values())
        return output, {'triangles': triangles, 'meshes': len(batches), 'joints': len(self.nodes), 'source': data['source']}

    def export_selection(self):
        bpy.ops.object.select_all(action='DESELECT')
        self.root.select_set(True)
        for node in self.nodes.values():
            node.select_set(True)
        for batch in self.batches:
            positions = batch['positions']
            vertices = [positions[i:i + 3] for i in range(0, len(positions), 3)]
            faces = [tuple(batch['indices'][i:i + 3]) for i in range(0, len(batch['indices']), 3)]
            obj = self.mesh('Export_' + batch['parent'] + '_' + batch['material'], batch['parent'], vertices, faces, batch['material'])
            obj.select_set(True)

    def setup_render(self):
        scene = bpy.context.scene
        scene.render.engine = 'BLENDER_EEVEE'
        scene.render.resolution_x = 640
        scene.render.resolution_y = 640
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.world.color = (.055, .065, .085)
        scene.view_settings.view_transform = 'Standard'
        for name, position, power, size in [('Key', (5, 9, 7), 1500, 7), ('Fill', (-6, 4, 3), 1050, 7), ('Rim', (3, 6, -7), 1700, 5)]:
            light = bpy.data.lights.new(name, 'AREA')
            light.energy, light.shape, light.size = power, 'DISK', size
            obj = bpy.data.objects.new(name, light)
            bpy.context.collection.objects.link(obj)
            obj.location = xyz(position)
            obj.rotation_euler = (xyz((0, 3, 0)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
        camera = bpy.data.objects.new('Review camera', bpy.data.cameras.new('Review camera'))
        bpy.context.collection.objects.link(camera)
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = self.spec.get('reviewFrame', {}).get('scale', 7.8 if self.spec['kind'] == 'aerial' else 7.1)
        scene.camera = camera
        return camera

    def render(self, directory):
        camera = self.setup_render()
        target = xyz(self.spec.get('reviewFrame', {}).get('target', (0, 1.2 if self.spec['kind'] == 'aerial' else 3, 0)))
        evidence = []
        for name, position in contract['review']['views'].items():
            self.reset()
            camera.location = xyz(position)
            camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
            bpy.context.scene.render.filepath = str(directory / (name + '.png'))
            bpy.ops.render.render(write_still=True)
            evidence.append(name + '.png')
        for clip in ['shield_deploy', 'light', 'heavy', 'run']:
            self.pose(clip, 1 if clip == 'shield_deploy' else .5 if clip != 'run' else .17)
            camera.location = xyz(contract['review']['views']['reference'])
            camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
            bpy.context.scene.render.filepath = str(directory / (clip + '.png'))
            bpy.ops.render.render(write_still=True)
            evidence.append(clip + '.png')
        self.reset()
        return evidence


for spec in contract['assets'].values():
    if args.asset not in ('all', spec['id']):
        continue
    directory = OUT / spec['id']
    directory.mkdir(parents=True, exist_ok=True)
    asset = adapter.create(Asset, spec) if adapter else Asset(spec)
    if adapter:
        adapter.construct(asset)
    elif spec.get('recipe'):
        construct(asset)
    else:
        asset.drone() if spec['kind'] == 'aerial' else asset.mech()
    asset.armature()
    output, measured = asset.runtime()
    clips = asset.animations()
    blend = directory / (spec['id'] + '.blend')
    bpy.context.scene.render.fps = 30
    bpy.context.scene.frame_end = 31
    views = [] if args.no_render else asset.render(directory)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    asset.export_selection()
    glb = EXPORT / (spec['id'] + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
                             export_animations=True, export_animation_mode='NLA_TRACKS',
                             export_nla_strips_merged_animation_name='Animation', export_force_sampling=True)
    report = {'asset': spec['id'], 'blender': bpy.app.version_string, 'measurements': measured,
              'clips': clips, 'renders': views, 'hashes': {'runtime': digest(output), 'blend': digest(blend), 'glb': digest(glb)},
              'gates': {'structure': 'pass', 'resources': 'pass', 'geometry': 'pending_visual_review',
                        'appearance': 'pending_visual_review', 'export': 'pending_independent_load',
                        'destination': 'pending_browser_review', 'user_signoff': contract['review']['signoff']}}
    (directory / 'validation.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    print('ASSET_RESULT ' + json.dumps({'id': spec['id'], **measured, 'glb': str(glb)}), flush=True)
