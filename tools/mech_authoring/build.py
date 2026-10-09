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
parser.add_argument('--combat', action='store_true')
parser.add_argument('--combat-data')
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
combat = importlib.reload(importlib.import_module('combat')) if args.combat else None
combat_intent = json.loads(Path(args.combat_data).read_text(encoding='utf8')) if args.combat else None
OUT = (HERE / contract['authoring']['outputs']).resolve()
RUNTIME = (HERE / contract['authoring']['runtime']).resolve()
EXPORT = (HERE / contract['authoring']['export']).resolve()
if args.combat:
    OUT = ROOT / 'out/combat_reference'
    RUNTIME = ROOT / 'public/js/forge/combatAssets'
    EXPORT = ROOT / 'public/assets/models/combat'
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
        for group in ['fire', 'charge', 'cast']:
            for track in spec['motion'][group]:
                if 'amplitudeFrom' in track:
                    owner, field = track['amplitudeFrom'].split('.')
                    track['amplitude'] = rig[owner][field]
        parents = {name: parent for name, parent, _ in spec['joints']}
        positions = {name: at for name, _, at in spec['joints']}
        for held in rig.get('heldWeapons', []):
            tip = positions[held.get('forearmTip', held['hand'])]
            held['pitch'] = math.atan2(-tip[1], tip[2])
            if 'forms' in spec:
                for form in spec['forms'].values():
                    form['transforms'].setdefault(held['node'], {})['rotation'] = [held['pitch'],0,0]
            side = 'l' if held['hand'].endswith('l') else 'r'
            if rig.get('aimPose') and side+'ShoulderX' in rig['aimPose']:
                rig['aimPose'][side+'ElbowX'] = -held['pitch'] - rig['aimPose'][side+'ShoulderX']
        if spec['kind'] == 'biped':
            rig['naturalArms'] = not (rig.get('knuckle') or rig.get('primate') or rig.get('tinyArms') or rig.get('groundWings'))
            rig['aimWhileIdle'] = False
            rig['armSwing'] = .24 if rig.get('tinyArms') else .42 if rig.get('tuckArms') else .75
            aim = rig.setdefault('aimPose', {'rShoulderX': -.55, 'rElbowX': -.92})
            aim.setdefault('lShoulderX', aim['rShoulderX'])
            aim.setdefault('lElbowX', aim['rElbowX'])
            if not rig.get('anatomicalArms'):
                for side in ['L', 'R']:
                    elbow = rig['armChain' + side][0]
                    elbow['base'] = min(elbow['base'], -.18)
                    elbow['k'] = -abs(elbow['k'])
            for weapon in rig['wpn'].values():
                name = weapon['nodes'][0]
                parent = parents[name]
                while parent:
                    for side in ([] if rig.get('groundWings') else ['L', 'R']):
                        if parent == rig['arm' + side]:
                            rig.setdefault('gun' + side, {'g': name, 'rest': 0})
                    parent = parents[parent]
        for side in ['R', 'L']:
            if rig.get('gun' + side) and rig.get('aimPose'):
                aim = rig['aimPose']
                angle = aim[side.lower() + 'ShoulderX'] + aim[side.lower() + 'ElbowX']
                if 'forms' not in spec:
                    # Wing-root weapons inherit the shoulder only; wrist weapons inherit the elbow too.
                    ancestors = set()
                    parent = parents[rig['gun' + side]['g']]
                    while parent:
                        ancestors.add(parent)
                        parent = parents[parent]
                    angle = sum(aim[key] for node, key in
                                [(rig['arm' + side], side.lower() + 'ShoulderX'),
                                 (rig['armChain' + side][0]['g'], side.lower() + 'ElbowX')]
                                if node in ancestors)
                held = next((h for h in rig.get('heldWeapons', []) if h['hand'] == rig['gun'+side]['g']), None)
                rig['gun' + side]['aim'] = -angle - (held['pitch'] if held else 0)
        if rig.get('rider') and rig.get('gunR'):
            base = rig['armBase'][0]
            held = next((h for h in rig.get('heldWeapons', []) if h['hand'] == rig['gunR']['g']), None)
            if held:
                base['elX'] = -held['pitch'] - base['shX']
            rig['gunR']['rest'] = rig['gunR']['aim'] = -(base['shX'] + base['elX']) - (held['pitch'] if held else 0)
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
            self.p['tentacles'] = []
            for chain in rig.get('tents', []):
                names = [j['g'] for j in chain[1:]]
                tip = next((name for name,parent,_ in spec['joints'] if parent == chain[-1]['g']),None)
                if tip:
                    names.append(tip)
                self.p['tentacles'].append({'root':chain[0]['g'],'deltas':[positions[name] for name in names]})
            self.p['tail'] = [positions[name] for name in rig.get('tailSegs', [])]
        if spec['id'] == 's01':
            support = positions['rotor_support_lf']
            self.p.update(rotorX=abs(positions['rotor_lf'][0] + support[0]),
                          rotorZ=abs(positions['rotor_lf'][2] + support[2]))
        elif spec['id'] == 't10':
            self.p.update(thigh=abs(positions['knee_l'][1]), shin=abs(positions['ankle_l'][1]),
                          foreArm=abs(positions['wrist_l'][1]))
        self.nodes = {}
        self.materials = {}
        self.parts = []
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        # A live MCP session must produce the same mesh/material names as a fresh build.
        bpy.data.orphans_purge(do_recursive=True)
        self.root = bpy.data.objects.new(spec['id'], None)
        bpy.context.collection.objects.link(self.root)
        for name, desc in spec['materials'].items():
            material = bpy.data.materials.new(name)
            material.diffuse_color = rgba(desc['color'])[:3] + (desc.get('opacity', 1),)
            material.use_nodes = True
            bsdf = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
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
        from catalog import ellipsoid
        p = self.p
        length, w, h = p['length'], p['width'], p['depth']
        bee = p['bee']
        ellipsoid(self, 'Rounded bee thoracic carapace', 'tilt', bee['thorax'], (0, .08, .15), 'blue', 24, 12)
        ellipsoid(self, 'Separate bee abdominal shell', 'abdomen', bee['abdomen'], (0, 0, 0), 'dark', 24, 12)
        ellipsoid(self, 'Compound-eyed bee head', 'sensor', bee['head'], (0, .02, .12), 'gold', 20, 10)
        for i, z in enumerate([.30, -.25, -.76]):
            width = bee['abdomen'][0] * math.sqrt(1 - (z / (bee['abdomen'][2] * .5)) ** 2)
            depth = bee['abdomen'][1] * width / bee['abdomen'][0]
            self.loft('Golden abdomen band ' + str(i), 'abdomen',
                      [(z - .08, width * 1.025, depth * 1.025), (z + .08, width * 1.025, depth * 1.025)], 'gold', axis='z')
        for side in [-1, 1]:
            self.strut('Articulated bee sensor antenna', 'sensor', (side * .28, .30, .22), (side * .47, .70, .58), .045, 'dark')
            self.disk('Antenna terminal sensor', 'sensor', .075, .10, (side * .47, .70, .58), 'gold', 'y')
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
                support = 'rotor_support_' + prefix
                center = tuple(self.nodes['rotor_' + prefix].location)
                center = (center[0], center[2], -center[1])
                self.strut('Carbon rotor arm ' + prefix, support, (0, 0, 0), center, .17, 'dark')
                self.strut('Arm brace ' + prefix, support, (side * .01, -.12, -z * .18), (center[0], -.07, center[2]), .075, 'steel')
                self.tube('Full blue duct ' + prefix, support, p['rotorRadius'], p['rotorRadius'] - .095, p['ductDepth'], center, 'blue', 'y', 32)
                self.tube('Golden duct rim ' + prefix, support, p['rotorRadius'] + .012, p['rotorRadius'] - .035, .066, (center[0], .17, center[2]), 'gold', 'y', 32)
                self.tube('Golden lower duct belt ' + prefix, support, p['rotorRadius'] + .006, p['rotorRadius'] - .094, .13, (center[0], -.055, center[2]), 'gold', 'y', 32)
                self.tube('Cyan inner airflow ring ' + prefix, support, p['rotorRadius'] - .09, p['rotorRadius'] - .106, .018, (center[0], .105, center[2]), 'glow', 'y', 32)
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
        from catalog import compact_emitters
        compact_emitters(self)
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
        from catalog import waist_shell, weapon_grips
        waist_shell(self)
        self.plate('Central abdominal plate', 'waist', [(-.27, .26), (.27, .26), (.19, 0), (0, -.19), (-.19, 0)], .12, (0, -.06, .30), 'shade')
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
        self.disk('Neck actuator', 'neck', .19, .2, (0, 2.16 - self.nodes['neck'].location.z, 0), 'dark', 'y')
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
        weapon_grips(self)
        self.disk('Rotary gun muzzle glow', 'light_muzzle', .043, .008, (0, 0, 0), 'glow')
        for launcher, lid in [('launcher','launcher_lid'),('launcher_r','launcher_r_lid')]:
            self.loft('Forward shoulder launcher rack',launcher,[(-.48,.73,.79),(.36,.73,.79),(.54,.67,.73)],'shade',axis='z')
            self.box('Launcher dorsal armor',launcher,(.78,.09,.93),(0,.43,0),'armor')
            for x in [-.16,.16]:
                for y in [-.23,0,.23]:
                    self.tube('Forward shoulder launch cell',launcher,.112,.088,.43,(x,y,.43),'dark','z',12)
                    self.disk('Shoulder missile nose',launcher,.07,.035,(x,y,.48),'steel')
            self.box('Hinged launcher lid',lid,(.71,.045,.93),(0,.015,.44),'dark')
        self.disk('Single flush offhand elbow transducer','shield_leaf_l',.17,.065,(0,0,0),'dark','x',16)
        self.tube('Offhand elbow transducer annulus','shield_leaf_l',.15,.115,.072,(0,0,0),'glow','x',16)
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
        if 'forms' not in self.spec:
            rig = self.spec['rig']
            for side in ['L', 'R']:
                if self.spec['kind']=='biped' and not rig.get('groundWings'):
                    self.rotate(self.nodes[rig['leg'+side]],'x',rig.get('legBase',0))
                    self.rotate(self.nodes[rig['arm'+side]],'x',rig.get('armBase',0))
                    self.rotate(self.nodes[rig['arm'+side]],'z',(.10 if side=='L' else -.10))
                for chain in ['legChain', 'armChain']:
                    for joint in rig.get(chain + side, []):
                        self.rotate(self.nodes[joint['g']], joint.get('axis', 'x'), joint['base'])
                if rig.get('gun' + side):
                    gun = rig['gun' + side]
                    self.rotate(self.nodes[gun['g']], 'x', gun['rest'])
            for held in rig.get('heldWeapons', []):
                self.rotate(self.nodes[held['node']], 'x', held['pitch'])
        for h in self.spec['motion']['shield']['hinges']:
            self.rotate(self.nodes[h['node']], h['axis'], h['rest'])
        if 'forms' not in self.spec:
            for group in ['fire','charge','cast']:
                for track in self.spec['motion'][group]:
                    if track['channel'] == 'scale':
                        index = {'x':0,'y':2,'z':1}[track['axis']]
                        self.nodes[track['node']].scale[index] = track['rest']
        self.nodes['barrier'].scale = (.001,) * 3
        self.anatomy_pose('rest', 0)
        if hasattr(self, 'combat'):
            combat.reset(self)

    def anatomy_pose(self, clip, t):
        rig = self.spec['rig']
        for wing in rig.get('rotorWings', []):
            phase = t * math.tau * wing['frequency'] + wing['phase']
            node = self.nodes[wing['node']]
            self.rotate(node, 'z', wing['sign'] * wing['lift'] * math.sin(phase))
            self.rotate(node, 'y', wing['sign'] * wing['sweep'] * math.cos(phase))
            self.rotate(node, 'x', wing['twist'] * math.sin(phase + math.pi / 2))
        for w in rig.get('wings', []):
            if not w.get('hand'):
                continue
            phase = math.sin(t * math.tau) if clip == 'run' else 0
            self.rotate(self.nodes[w['w']], 'z', w['sgn'] * (w.get('dihedral',0) + phase*.3))
            self.rotate(self.nodes[w['outer']], 'y', w['sgn'] * (w.get('elbowSweep',0) + math.sin(t*math.tau-.6)*.16 if clip=='run' else w.get('elbowSweep',0)))
            self.rotate(self.nodes[w['hand']], 'y', w['sgn'] * (w.get('wristSweep',0) + math.sin(t*math.tau-.9)*.12 if clip=='run' else w.get('wristSweep',0)))
        for w in rig.get('groundWings', []):
            angles = w['run'] if clip == 'run' else w['fold']
            for name, angle in zip([w['w'],w['outer'],w['hand']],angles):
                self.nodes[name].rotation_euler = (0,0,0)
                self.rotate(self.nodes[name],'y',w['sgn']*angle)
            self.rotate(self.nodes[w['w']],'z',w['sgn']*(.28 if clip=='run' else -.30))
            if clip=='run':
                self.rotate(self.nodes[w['w']],'x',math.sin(t*math.tau)*.045)
                self.rotate(self.nodes[w['outer']],'x',math.sin(t*math.tau-.6)*.035)
        for wave in rig.get('tentacleWaves', []):
            for i,name in enumerate(wave['chain']):
                amplitude_run = wave.get('travel', [0, 0, 0]) if clip == 'run' else [0, 0, 0]
                for axis, amplitude, offset, travel in zip('xyz',wave['swing'],[0,1.2,2.4],amplitude_run):
                    self.rotate(self.nodes[name],axis,(amplitude+travel)*math.sin(t*math.tau*wave['frequency']+wave['phase']-i*.36+offset))
        wave=rig.get('axialWave')
        if wave:
            for i,name in enumerate(wave['chain']):
                self.rotate(self.nodes[name],'y',wave['amplitude']*math.sin(t*math.tau*wave['frequency']-i*wave['delay']))

    @staticmethod
    def rotate(node, axis, value):
        index, sign = {'x': (0, 1), 'y': (2, 1), 'z': (1, -1)}[axis]
        node.rotation_euler[index] = value * sign

    def aim_hands(self, weight):
        bpy.context.view_layer.update()
        for weapon in self.spec['rig']['wpn'].values():
            hand = weapon.get('aimJoint')
            if not hand and not weapon.get('alwaysForward'):
                continue
            strength = 1 if weapon.get('alwaysForward') else weight
            if strength <= 0:
                continue
            targets = [hand] if hand else weapon['nodes']
            for name in targets:
                node = self.nodes[name]
                ref = self.nodes[weapon['ref']] if hand else node
                forward = ref.matrix_world.to_quaternion() @ Vector((0,-1,0))
                q = forward.rotation_difference(Vector((0,-1,0))) @ node.matrix_world.to_quaternion()
                local = node.parent.matrix_world.to_quaternion().inverted() @ q
                node.rotation_euler = node.rotation_euler.to_quaternion().slerp(local,strength).to_euler()
                bpy.context.view_layer.update()

    def pose(self, clip, t):
        if args.combat:
            clip = {'def': 'skill', 'atk': 'ult'}.get(clip, clip)
        self.reset()
        motion = self.spec['motion']
        u = max(0, min(1, t))
        e = u * u * (3 - 2 * u)
        rig = self.spec['rig']
        if hasattr(self, '_pose_form'):
            rig = rig | self.spec['forms'][self._pose_form]['rig']
        if 'forms' not in self.spec:
            for i, name in enumerate(rig.get('tailSegs', [])):
                self.rotate(self.nodes[name], 'y', math.sin(t * math.tau - i * .45) * (.09 if clip == 'run' else .025))
            for chain in rig.get('tents', []):
                for i, joint in enumerate(chain):
                    self.rotate(self.nodes[joint['g']], joint.get('axis', 'x'),
                                joint['base'] + math.sin(t * math.tau - i * .4) * (.12 if clip == 'run' else .04))
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
            if motion['shield'].get('pose') and getattr(self, '_pose_form', 'ground') == 'ground':
                for track in motion['shield']['pose']:
                    from morph_recipe import rotation
                    self.nodes[track['node']].rotation_euler = rotation(track['rest']).slerp(rotation(track['rotation']), e).to_euler()
            k = max(.001, min(1, (e - .18) / .82))
            self.nodes['barrier'].scale = (k,) * 3
        elif clip == 'run':
            if self.spec['kind'] == 'biped':
                for side, phase in [('l', 0), ('r', 0 if rig.get('hop') else math.pi * (1 - rig.get('bound', 0)) if rig.get('primate') else math.pi)]:
                    angle = math.sin(t * math.tau + phase)
                    self.rotate(self.nodes['hip_' + side], 'x', rig.get('legBase', 0) + angle * .55)
                    self.rotate(self.nodes['knee_' + side], 'x', rig['legChain' + side.upper()][0]['base'] + max(0, -angle) * .7)
                    arm_angle = math.sin(t * math.tau + phase)
                    self.rotate(self.nodes['shoulder_' + side], 'x', rig.get('armBase', 0) - arm_angle * .34 * rig['armSwing'] / .75)
                    elbow = rig['armChain' + side.upper()][0]
                    self.rotate(self.nodes[elbow['g']], elbow.get('axis','x'),
                                elbow['base'] + elbow['k'] * arm_angle * .2 if rig.get('anatomicalArms')
                                else elbow['base'] - .28 - .08 * arm_angle)
                    if 'forms' not in self.spec:
                        for joint in rig['legChain' + side.upper()][1:] + rig['armChain' + side.upper()][1:]:
                            self.rotate(self.nodes[joint['g']], joint.get('axis', 'x'),
                                        joint['base'] + joint['k'] * max(0, -angle) * .35)
                    if self.p.get('legAnatomy'):
                        for joint in rig['legChain' + side.upper()]:
                            self.rotate(self.nodes[joint['g']], joint.get('axis', 'x'),
                                        joint['base'] + joint['k'] * max(0, -angle) * .75)
                if rig.get('hop'):
                    self.nodes['hips'].location.z += max(0, math.sin(t * math.tau)) * .4
                if rig.get('primate'):
                    self.nodes['hips'].location.z -= rig['primate']['crouch']
                    self.rotate(self.nodes['hips'], 'x', rig['primate']['lean'])
                    self.rotate(self.nodes['chest'], 'x', .12 * math.sin(t * math.tau))
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
                    if wing.get('hand'):
                        self.rotate(self.nodes[wing['outer']], 'y', wing['sgn'] * (.14 + math.sin(t * math.tau - .6) * .16))
                        self.rotate(self.nodes[wing['hand']], 'y', wing['sgn'] * (.10 + math.sin(t * math.tau - .9) * .12))
                    else:
                        self.rotate(self.nodes[wing['outer']], 'z', wing['sgn'] * math.sin(t * math.tau - .6) * .4)
        elif clip in ('light', 'heavy', 'skill', 'ult'):
            group = 'fire' if clip == 'light' else 'charge' if clip == 'heavy' else 'cast'
            weight = math.sin(math.pi * u) ** 2
            for track in motion[group]:
                node = self.nodes[track['node']]
                value = track['rest'] + track['amplitude'] * weight
                if track['channel'] == 'rotation':
                    self.rotate(node, track['axis'], value)
                elif track['channel'] == 'scale':
                    index = {'x':0,'y':2,'z':1}[track['axis']]
                    node.scale[index] = value
                else:
                    if 'forms' in self.spec:
                        node.location = xyz([value if axis == track['axis'] else 0 for axis in 'xyz'])
                    else:
                        index, sign = {'x': (0, 1), 'y': (2, 1), 'z': (1, -1)}[track['axis']]
                        node.location[index] = value * sign
            if rig.get('aimPose'):
                aim = rig['aimPose']
                for side in ['R', 'L']:
                    sh, el = side.lower() + 'ShoulderX', side.lower() + 'ElbowX'
                    if sh not in aim:
                        continue
                    base = rig.get('armBase', 0)
                    self.rotate(self.nodes[rig['arm' + side]], 'x', base + (aim[sh] - base) * weight)
                    base = rig['armChain' + side][0]['base']
                    self.rotate(self.nodes[rig['armChain' + side][0]['g']], 'x', base + (aim[el] - base) * weight)
                    gun = rig.get('gun' + side)
                    if gun:
                        self.rotate(self.nodes[gun['g']], 'x', gun['rest'] + (gun['aim'] - gun['rest']) * weight)
                if clip == 'skill' and 'forms' in self.spec:
                    self.rotate(self.nodes['shoulder_l'], 'x', -.6 * weight)
                    self.rotate(self.nodes['elbow_l'], 'x', -.85 * weight)
            elif self.spec['kind'] == 'aerial':
                self.rotate(self.nodes['tilt'], 'x', -.13 * weight)
        self.anatomy_pose(clip, t)
        launcher = rig.get('launcher')
        if launcher and clip == 'heavy':
            extension = self.nodes[launcher['lift']].location.z / launcher['extension']
            aim = max(0, min(1, (extension - launcher['rotateStart']) / (1 - launcher['rotateStart'])))
            self.rotate(self.nodes[launcher['pivot']], 'x', math.pi / 2 * aim)
        self.aim_hands(math.sin(math.pi*u)**2 if clip in ('light','heavy','skill','ult') else 0)
        if hasattr(self, 'combat'):
            combat.pose(self, clip, t)

    def animations(self):
        clips = self.spec.get('clips', ['idle', 'run', 'light', 'heavy', 'skill', 'ult', 'shield_deploy', 'shield_retract'])
        if args.combat:
            clips = [*clips, 'def', 'atk']
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
            assert obj.parent_type == 'OBJECT' and not obj.constraints, 'Unsupported mesh transform owner: ' + obj.name
            # World-matrix cancellation amplifies translation error under near-zero effect scales.
            transform = obj.matrix_parent_inverse @ evaluated.matrix_basis
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
        if args.combat:
            data['combat'] = self.combat
            data['meshes'] = [batch for batch in batches.values() if batch['parent'].startswith('fx_')]
            data['joints'] = [joint for joint in self.spec['joints'] if joint[0].startswith('fx_')]
            data['source']['combat'] = digest(HERE / 'combat.py')
            data['source']['intent'] = digest(Path(args.combat_data))
        if 'inherit' in contract:
            data['source']['sharedContract'] = digest(HERE / contract['inherit'])
            data['source']['sharedCatalog'] = digest(HERE / 'catalog.py')
        triangles = sum(len(b['indices']) // 3 for b in batches.values())
        assert triangles <= contract['limits']['trianglesPerUnit'], triangles
        assert len(batches) <= contract['limits']['meshesPerUnit'], len(batches)
        for batch in batches.values():
            assert all(math.isfinite(v) for v in batch['positions'] + batch['normals'])
        output = RUNTIME / (self.spec['id'] + '.js')
        pending = output.with_suffix('.js.tmp')
        pending.write_text('// Generated by tools/mech_authoring/build.py; edit the owning contract or builder.\nexport default ' + json.dumps(data, separators=(',', ':')) + ';\n', encoding='utf8')
        pending.replace(output)
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
            self.render_still(directory, name)
            evidence.append(name + '.png')
        for clip in ['idle', 'shield_deploy', 'shield_retract', 'light', 'heavy', 'skill', 'ult', 'run']:
            self.pose(clip, 1 if clip.startswith('shield_') else .5 if clip != 'run' else .17)
            camera.location = xyz(contract['review']['views']['reference'])
            camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
            self.render_still(directory, clip)
            evidence.append(clip + '.png')
        self.reset()
        return evidence

    @staticmethod
    def render_still(directory, name):
        # Keep a failed renderer write from truncating the last review image.
        target = directory / (name + '.png')
        temporary = directory / (name + '.render.png')
        bpy.context.scene.render.filepath = str(temporary)
        bpy.ops.render.render(write_still=True)
        temporary.replace(target)


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
    if args.combat:
        combat.construct(asset, combat_intent[spec['id']], xyz)
    output, measured = asset.runtime()
    clips = asset.animations()
    blend = directory / (spec['id'] + '.blend')
    bpy.context.scene.render.fps = 30
    bpy.context.scene.frame_end = 31
    if args.no_render:
        asset.setup_render()
    views = [] if args.no_render else asset.render(directory)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    asset.export_selection()
    glb = EXPORT / (spec['id'] + '.glb')
    temporary_glb = glb.with_suffix('.export.glb')
    # A constant running wing pose still differs from the folded default pose.
    # glTF's object-track optimization otherwise drops that entire clip channel.
    bpy.ops.export_scene.gltf(filepath=str(temporary_glb), export_format='GLB', use_selection=True,
                             export_animations=True, export_animation_mode='NLA_TRACKS',
                             export_optimize_animation_keep_anim_object=bool(spec['rig'].get('groundWings')),
                             export_nla_strips_merged_animation_name='Animation', export_force_sampling=True)
    temporary_glb.replace(glb)
    report = {'asset': spec['id'], 'blender': bpy.app.version_string, 'measurements': measured,
              'clips': clips, 'renders': views, 'hashes': {'runtime': digest(output), 'blend': digest(blend), 'glb': digest(glb)},
              'gates': {'structure': 'pass', 'resources': 'pass', 'geometry': 'pending_visual_review',
                        'appearance': 'pending_visual_review', 'export': 'pending_independent_load',
                        'destination': 'pending_browser_review', 'user_signoff': contract['review']['signoff']}}
    pending_report = directory / 'validation.json.tmp'
    pending_report.write_text(json.dumps(report, indent=2), encoding='utf8')
    pending_report.replace(directory / 'validation.json')
    print('ASSET_RESULT ' + json.dumps({'id': spec['id'], **measured, 'glb': str(glb)}), flush=True)
