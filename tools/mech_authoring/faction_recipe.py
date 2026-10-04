"""Original faction silhouettes; reuse the shared rigid mesh, armature and export seam."""
import copy
import hashlib
import json
import math
import re
from pathlib import Path

import bpy
from mathutils import Vector
from catalog import ellipsoid, wing, vents

HERE = Path(__file__).resolve().parent


def palette(side):
    source = (HERE / '../../public/js/factionModelStyle.js').resolve().read_text(encoding='utf8')
    block = re.search(rf'{side}: Object.freeze\(\{{(.*?)\}}\)', source, re.S).group(1)
    metal = float(re.search(r'metalness:\s*([\d.]+)', block).group(1))
    colors = {key: '#' + value for key, value in re.findall(r'(\w+):\s*0x([\da-f]+)', block)}
    return {key: {'color': colors[key], 'metal': metal if key in ('shell', 'mid', 'trim') else .15,
                  **({'emission': 1.1} if key == 'glass' else {})} for key in colors}


def specification(source):
    s = copy.deepcopy(source)
    s['inputs'] = {'prompt': '../../docs/faction-authoring.md', 'image': '../../docs/faction-authoring.md',
                   'palette': '../../public/js/factionModelStyle.js', 'rights': '../../LICENSE'}
    s['components'] = [{'id': 'frame', 'route': 'procedural', 'intent': 'Doctrine-specific load-bearing silhouette'},
                       {'id': 'armor', 'route': 'procedural', 'intent': 'Attached panels with open mechanical gaps'},
                       {'id': 'mechanisms', 'route': 'procedural', 'intent': 'Rigid articulated drive and weapon joints'}]
    s['materials'], s['joints'] = palette(s['side']), []
    s['motion'] = {'fire': [], 'charge': [], 'cast': []}
    s['clips'] = ['idle', 'run', 'aim', 'light', 'heavy', 'deploy']
    s['rig'] = {'wpn': {}, 'attacks': [], 'mechanisms': [], 'bindings': {}, 'spin': []}
    J = lambda name: s['id'] + '_' + name
    def joint(name, parent=None, at=(0, 0, 0)):
        s['joints'].append([J(name), J(parent) if parent else None, list(at)])
        return J(name)
    def weapon(parent, at, length, travel, name='gun', slot='light'):
        joint(name, parent, at)
        recoil = joint(name + '_recoil', name)
        muzzle = joint(name + '_muzzle', name + '_recoil', (0, 0, length))
        bolt = joint(name + '_bolt', name + '_recoil', (0, 0, .1))
        s['rig']['attacks'].append({'node': recoil, 'muzzles': [muzzle], 'travel': travel,
                                   'lift': .025 if s['side'] == 'SWARM' else .05,
                                   'cycle': [{'node': bolt, 'axis': 'z', 'amplitude': -.15, 'channel': 'position'}]})
        s['rig']['wpn'][slot] = {'nodes': [J(name)], 'ref': J(name), 'muzzle': muzzle, 'r': .08}
        return muzzle
    swarm = s['side'] == 'SWARM'
    role, rig, p = s['role'], s['rig'], s['parameters']
    joint('root')
    if s['kind'] == 'biped':
        joint('hips', 'root', (0, 1.36, 0))
        joint('head', 'hips', (0, 1.26, .05))
        for suffix, sign in [('l', 1), ('r', -1)]:
            joint('hip_' + suffix, 'hips', (sign * (.24 if swarm else .29), 0, 0))
            joint('knee_' + suffix, 'hip_' + suffix, (0, -.59, .015))
            joint('ankle_' + suffix, 'knee_' + suffix, (0, -.57, -.015))
            joint('shoulder_' + suffix, 'hips', (sign * (.43 if swarm else .56), .92, 0))
            joint('elbow_' + suffix, 'shoulder_' + suffix, (0, -.43, 0))
            joint('wrist_' + suffix, 'elbow_' + suffix, (0, -.42, .02))
        muzzle = weapon('wrist_r', (0, -.08, .13), 1.05 if role == 'soldier' else 1.3,
                        .05 if swarm else .11)
        for key, value in [('hips', 'hips'), ('head', 'head'), ('legL', 'hip_l'), ('legR', 'hip_r'),
                           ('armL', 'shoulder_l'), ('armR', 'shoulder_r')]:
            rig[key] = J(value)
        for side, suffix in [('L', 'l'), ('R', 'r')]:
            rig['legChain' + side] = [{'g': J('knee_' + suffix), 'base': .035, 'k': .8, 'd': .2},
                                      {'g': J('ankle_' + suffix), 'base': -.035, 'k': -.35, 'd': .45}]
            rig['armChain' + side] = [{'g': J('elbow_' + suffix), 'base': -.18, 'k': -.7, 'd': .2},
                                      {'g': J('wrist_' + suffix), 'base': 0, 'k': .12, 'd': .3}]
        rig.update(stride=p['stride'], bob=.055 if swarm else .03, sway=.045 if swarm else .025,
                   top=8, gunArm=True, anatomicalArms=True, naturalArms=False, armSwing=.35,
                   gunR={'g': J('gun'), 'rest': 0}, weap={'light': 'R', 'heavy': 'R'}, hvy={'chest': .04, 'gun': .02},
                   aimPose={'rShoulderX': -.52, 'lShoulderX': -.45, 'rElbowX': -.88, 'lElbowX': -.7},
                   moveSig={'poise': .36 if swarm else .88, 'idleA': .8 if swarm else 1.15,
                            'idleF': 1.25 if swarm else .65, 'launch': .22 if swarm else .02,
                            'spool': .02 if swarm else .22, 'brake': .2 if swarm else .04,
                            'settle': 1.4 if swarm else .72})
        joint('scanner', 'head', (.23, .06, .13))
        rig['mechanisms'].append({'node': J('scanner'), 'axis': 'y', 'amplitude': .38 if swarm else .14, 'frequency': 1.8 if swarm else .65})
    elif s['kind'] in ('wheeled', 'tracked'):
        joint('hull', 'root')
        rig['hull'] = J('hull')
        rig['wheels'] = []
        for sign in [-1, 1]:
            for i, z in enumerate(p['axles']):
                name = f'wheel_{sign}_{i}'
                joint(name, 'hull', (sign * p['width'] / 2, p['wheelRadius'], z))
                rig['wheels'].append({'node': J(name), 'r': p['wheelRadius'], 'width': .48})
        joint('turret', 'hull', (0, 1.9 if swarm else 2.2, -.3))
        joint('pitch', 'turret', (0, .28, .3))
        weapon('pitch', (0, 0, 0), 3.3 if role == 'tank' else 1.5, .19 if swarm else .38)
        rig['bindings'].update(turret=J('turret'), pitch=J('pitch'))
        rig.update(hullY0=0, top=12, bob=.03)
        joint('scanner', 'turret', (0, .48, -.55))
        rig['mechanisms'].append({'node': J('scanner'), 'axis': 'y', 'amplitude': .55, 'frequency': 1 if swarm else .4})
    elif role == 'heli':
        joint('tilt', 'root', (0, 1.8, 0))
        rig.update(tilt=J('tilt'), tiltY0=1.8, bob=.065 if swarm else .035,
                   moveSig={'hover': .7 if swarm else .18, 'hoverF': 1.5 if swarm else .6,
                            'hoverA': 1.4 if swarm else .65, 'bank': 1.3 if swarm else .65, 'surge': .3 if swarm else .08})
        if swarm:
            for x in [-p['rotorX'], p['rotorX']]:
                for z in [-p['rotorZ'], p['rotorZ']]:
                    name = f'rotor_{x}_{z}'
                    joint(name, 'tilt', (x, .3, z))
                    rig['spin'].append({'node': J(name), 'axis': 'y', 'rate': 48 if x * z > 0 else -48})
        else:
            for i, y in enumerate([1.1, 1.55]):
                joint('rotor_' + str(i), 'tilt', (0, y, -.3))
                rig['spin'].append({'node': J('rotor_' + str(i)), 'axis': 'y', 'rate': 28 if i else -28})
        joint('pitch', 'tilt', (0, -.25, .55))
        muzzles = [weapon('pitch', (x, 0, 0), 1.9, .13 if swarm else .24, f'gun{i}', 'light' if i == 0 else 'heavy')
                   for i, x in enumerate([-.65, .65])]
        rig['bindings'].update(gunTilt=J('pitch'), turretMuzzles=muzzles)
    elif role in ('tower', 'turret', 'battery'):
        if role == 'battery':
            pivots, muzzles = [], []
            for i, x in enumerate([10, -10]):
                joint(f'turret{i}', 'root', (x, 0, 6))
                joint(f'pitch{i}', f'turret{i}')
                muzzles.append(weapon(f'pitch{i}', (0, 0, 0), 15.6, 1.35 if swarm else 1.8, f'gun{i}', 'light' if i == 0 else 'heavy'))
                pivots.append(J(f'turret{i}'))
            rig['bindings'].update(pivots=pivots, pitches=[J('pitch0'), J('pitch1')], muzzles=muzzles)
            joint('weapon_sensor', 'turret0', (0, 1.8, -.8))
        else:
            joint('turret', 'root', (0, p.get('seat', 0), 0))
            joint('pitch', 'turret', (0, 1, .35))
            muzzles = []
            count = 6 if swarm else 2
            for i in range(count):
                x = (i // 2 - 1) * .92 if swarm else (-.72 if i == 0 else .72)
                y = (-.38 if i % 2 == 0 else .38) if swarm else 0
                muzzles.append(weapon('pitch', (x, y, 0), 2.35 if swarm else 5.8,
                                      .32 if swarm else .8, f'gun{i}', 'light' if i == 0 else 'heavy'))
            rig['bindings'].update(turret=J('turret'), pitch=J('pitch'), turretMuzzles=muzzles, turretSeatF=.92)
            rig['wpn'] = {'light': rig['wpn']['light']}
            joint('weapon_sensor', 'turret', (0, 1.8, -.65))
        rig['mechanisms'].append({'node': J('weapon_sensor'), 'axis': 'y',
                                  'amplitude': .34 if swarm else .12, 'frequency': .9 if swarm else .35})
    if role in ('base', 'tower', 'bunker'):
        joint('scanner', 'root', (0, s['height'] * .72, 0))
        rig['mechanisms'].append({'node': J('scanner'), 'axis': 'y', 'amplitude': .6 if swarm else .22, 'frequency': .8 if swarm else .3})
        for i, x in enumerate([-1, 1]):
            joint(f'vent{i}', 'root', (x * s['height'] * .16, s['height'] * .4, -s['height'] * .13))
            rig['mechanisms'].append({'node': J(f'vent{i}'), 'axis': 'x', 'amplitude': .16 if swarm else .055, 'frequency': 1.1 if swarm else .45, 'phase': i * math.pi})
    s['reviewFrame'] = {'scale': s['height'] * (8 if role == 'battery' else 3.2 if role == 'turret' else 2.8 if role == 'heli' else 2.5 if role in ('apc', 'tank') else 1.9),
                        'target': [0, .7, 11] if role == 'battery' else [0, 1.1, 2] if role == 'turret' else [0, s['height'] * .45, 0]}
    return s


def create(base, source):
    class FactionAsset(base):
        def __init__(self, spec):
            super().__init__(spec)
            self.review_views = base.render.__globals__['contract']['review']['views']
            if self.spec['kind'] == 'biped':
                self.spec['rig']['naturalArms'] = False

        def reset(self):
            for name, _, at in self.spec['joints']:
                node = self.nodes[name]
                node.location = (at[0], -at[2], at[1])
                node.rotation_euler = (0, 0, 0)
                node.scale = (1, 1, 1)
            if self.spec['kind'] == 'biped':
                for side in ['L', 'R']:
                    for chain in ['legChain', 'armChain']:
                        for track in self.spec['rig'][chain + side]:
                            self.rotate(self.nodes[track['g']], 'x', track['base'])

        def runtime(self):
            output, measured = super().runtime()
            data = json.loads(output.read_text(encoding='utf8').split('export default ', 1)[1].rstrip(';\n'))
            # The shared exporter calls its reference input an image; these original designs use text.
            source = measured['source']
            source['design'] = source.pop('image')
            source['palette'] = hashlib.sha256((HERE / self.spec['inputs']['palette']).resolve().read_bytes()).hexdigest()
            data['source'] = source
            temporary = output.with_suffix('.js.tmp')
            temporary.write_text('// Generated by tools/mech_authoring/build.py and faction_recipe.py.\nexport default '
                                 + json.dumps(data, separators=(',', ':')) + ';\n', encoding='utf8')
            temporary.replace(output)
            return output, measured

        def pose(self, clip, t):
            self.reset()
            r = self.spec['rig']
            ph = t * math.tau
            if self.spec['kind'] == 'biped':
                self.nodes[r['hips']].location.z += abs(math.sin(ph)) * r['bob']
                for suffix, sign in [('L', 1), ('R', -1)]:
                    if clip == 'run':
                        self.rotate(self.nodes[r['leg' + suffix]], 'x', sign * math.sin(ph) * .55)
                        self.rotate(self.nodes[r['arm' + suffix]], 'x', -sign * math.sin(ph) * .25)
                        knee = r['legChain' + suffix][0]
                        self.rotate(self.nodes[knee['g']], 'x', max(0, -sign * math.sin(ph)) * .8)
                    if clip in ('aim', 'light', 'heavy'):
                        self.rotate(self.nodes[r['arm' + suffix]], 'x', r['aimPose'][suffix.lower() + 'ShoulderX'])
                        self.rotate(self.nodes[r['armChain' + suffix][0]['g']], 'x', r['aimPose'][suffix.lower() + 'ElbowX'])
                if clip in ('aim', 'light', 'heavy'):
                    self.rotate(self.nodes[r['gunR']['g']], 'x', r['gunR']['aim'])
            for spinner in r['spin']:
                self.rotate(self.nodes[spinner['node']], spinner['axis'], t * spinner['rate'])
            for wheel in r.get('wheels', []):
                if clip == 'run':
                    self.rotate(self.nodes[wheel['node']], 'x', -ph)
            for m in r['mechanisms']:
                self.rotate(self.nodes[m['node']], m['axis'], math.sin(ph + m.get('phase', 0)) * m['amplitude'])
            if clip in ('light', 'heavy'):
                age = t
                kick = age / .035 if age < .035 else (1 - (age - .035) / .515) ** 3 if age < .55 else 0
                for attack in r['attacks']:
                    node = self.nodes[attack['node']]
                    node.location.y = attack['travel'] * kick
                    self.rotate(node, 'x', -attack['lift'] * kick)
                    for track in attack['cycle']:
                        self.nodes[track['node']].location.y -= track['amplitude'] * math.sin(math.pi * min(1, age / .55)) ** 2
            if clip in ('aim', 'deploy'):
                bindings = r['bindings']
                names = bindings.get('pitches', [bindings.get('pitch')])
                for name in filter(None, names):
                    self.rotate(self.nodes[name], 'x', -.14 * math.sin(math.pi * t / 2))

        def setup_render(self):
            # The shared lighting distances suit infantry; structures need scale-relative lights.
            camera = super().setup_render()
            h = self.spec['height']
            for obj in bpy.context.scene.objects:
                if obj.type == 'LIGHT':
                    obj.location *= h / 6
                    obj.data.energy *= (h / 6) ** 2
                    obj.data.size *= h / 6
            bpy.context.scene.render.resolution_x = 512
            bpy.context.scene.render.resolution_y = 512
            return camera

        def render(self, directory):
            camera = self.setup_render()
            at = self.spec['reviewFrame']['target']
            target = Vector((at[0], -at[2], at[1]))
            scale = self.spec['reviewFrame']['scale']
            views = {name: (v[0], -v[2], v[1]) for name, v in self.review_views.items()}
            evidence = []
            for name, offset in views.items():
                self.reset()
                camera.location = target + Vector(offset) * scale
                camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
                self.render_still(directory, name)
                evidence.append(name + '.png')
            camera.location = target + Vector(views['reference']) * scale
            camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
            for clip, time in [('run', .2), ('aim', 1), ('light', .035), ('deploy', 1)]:
                self.pose(clip, time)
                self.render_still(directory, clip)
                evidence.append(clip + '.png')
            self.reset()
            return evidence
    return FactionAsset(specification(source))


def construct(a):
    s, r, p = a.spec, a.spec['rig'], a.p
    swarm, role = s['side'] == 'SWARM', s['role']
    J = lambda name: s['id'] + '_' + name
    def box(name, parent, size, at, material='shell', bevel=.04):
        return a.box(name, J(parent), size, at, material, bevel)
    def disk(name, parent, radius, depth, at, material='dark', axis='y', segments=12):
        return a.disk(name, J(parent), radius, depth, at, material, axis, segments)
    def tube(name, parent, radius, inner, length, at, material='mid', axis='z', segments=12):
        return a.tube(name, J(parent), radius, inner, length, at, material, axis, segments)
    def plate(name, parent, points, depth, at, material='shell'):
        return a.plate(name, J(parent), points, depth, at, material)
    def strut(name, parent, start, end, width, material='dark'):
        return a.strut(name, J(parent), start, end, width, material)
    def honey(parent, at, radius, depth, material='shell'):
        points = [(math.cos(i * math.tau / 6) * radius, math.sin(i * math.tau / 6) * radius) for i in range(6)]
        return plate('Replaceable hexagonal armor', parent, points, depth, at, material)
    def louver(parent, at, width, count=4):
        vents(a, J(parent), at, width, count, 'deep')
    def limb(parent, length, width):
        strut('Load bearing servo', parent, (0, 0, 0), (0, -length, 0), width * .37, 'mid')
        disk('Joint axle', parent, width * .52, width * 1.3, (0, 0, 0), 'dark', 'x')
        disk('Axle end cap', parent, width * .27, width * 1.4, (0, 0, 0), 'trim', 'x')
        if swarm:
            for y in [-length * .25, -length * .62]:
                honey(parent, (0, y, width * .38), width * .55, width * .3)
        else:
            a.loft('Protected hydraulic armor', J(parent), [(-length * .84, width * .65, width * .75),
                    (-length * .25, width, width), (-length * .1, width * .8, width * .9)], 'shell', (0, 0, 0))
            for x in [-width * .32, width * .32]:
                strut('Paired hydraulic ram', parent, (x, -.08, -width * .4), (x, -length * .86, -width * .4), .04, 'trim')
    def gun(name, size=1, cannon=False):
        parent = name + '_recoil'
        length = next(at[2] for joint, _, at in s['joints'] if joint == J(name + '_muzzle'))
        radius = (.105 if role == 'soldier' else .17) * size
        box('Receiver', parent, (.28 * size, .32 * size, .55 * size), (0, 0, .15 * size), 'dark')
        tube('Open barrel', parent, radius, radius * .57, length - .2, (0, 0, length / 2), 'deep')
        tube('Muzzle brake', parent, radius * 1.35, radius * .6, .2 * size, (0, 0, length - .1), 'trim')
        disk('Muzzle emitter', name + '_muzzle', radius * .73, .025, (0, 0, 0), 'glass', 'z')
        box('Sliding action', name + '_bolt', (.2 * size, .12 * size, .2 * size), (0, .21 * size, 0), 'trim', .01)
        if swarm:
            for z in [length * .25, length * .55, length * .8]:
                tube('Replaceable barrel collar', parent, radius * 1.5, radius * 1.05, .13 * size, (0, 0, z), 'shell', segments=6)
        else:
            for x in [-radius * 1.7, radius * 1.7]:
                box('Armored rail jacket', parent, (.09 * size, .23 * size, length * .7), (x, 0, length * .53), 'mid')
            box('Feed cassette', parent, (.42 * size, .3 * size, .38 * size), (.24 * size, -.17 * size, .15), 'shell')
        if role == 'rocketeer':
            tube('Launcher shield', parent, .24, .19, length * .75, (0, 0, length * .46), 'shell', segments=6 if swarm else 8)
        if role == 'howitzer':
            disk('Rotating grenade cassette', parent, .31, .38, (-.21, -.14, .2), 'mid', 'x', 6)
        if cannon:
            box('Trunnion housing', name, (1.4 * size, .65 * size, 1.3 * size), (0, 0, -.32), 'shell')
    if s['kind'] == 'biped':
        bulk = p['bulk']
        box('Pelvis chassis', 'hips', (.68, .27, .42), (0, -.02, 0), 'dark')
        a.loft('Rib cage chassis', J('hips'), [(.22, .55 * bulk, .4), (.7, .9 * bulk, .55), (1.12, .7 * bulk, .44)], 'dark')
        if swarm:
            for x, y in [(-.22, .65), (.22, .65), (0, .95)]:
                honey('hips', (x, y, .31), .26, .12)
            for x in [-.2, .2]:
                tube('Exposed replaceable power cell', 'hips', .12, .055, .6, (x, .68, -.39), 'trim', 'y', 6)
            strut('Asymmetric field antenna', 'hips', (.31, .8, -.25), (.4, 1.65, -.32), .018, 'trim')
            plate('Visor carapace', 'head', [(-.25, -.12), (.25, -.12), (.2, .2), (0, .32), (-.2, .2)], .36, (0, .07, 0))
            for x in [-.17, .17]:
                disk('Compound sensor', 'head', .105, .06, (x, .04, .23), 'glass', 'z', 6)
        else:
            plate('Welded breastplate', 'hips', [(-.48, .34), (.48, .34), (.55, .95), (.34, 1.14), (-.34, 1.14), (-.55, .95)], .22, (0, 0, .35))
            louver('hips', (0, .45, -.36), .55)
            box('Armored backpack', 'hips', (.78, .83, .28), (0, .66, -.4), 'mid')
            box('Recessed helmet', 'head', (.61, .44, .47), (0, .08, 0))
            box('Armored brow', 'head', (.68, .09, .22), (0, .18, .25), 'mid')
            box('Protected vision slit', 'head', (.42, .048, .025), (0, .075, .246), 'glass', .008)
        for suffix, sign in [('l', 1), ('r', -1)]:
            limb('hip_' + suffix, .59, .26 * bulk)
            limb('knee_' + suffix, .57, .24 * bulk)
            limb('shoulder_' + suffix, .43, .24 * bulk)
            limb('elbow_' + suffix, .42, .21 * bulk)
            box('Grounding foot', 'ankle_' + suffix, (.27 * bulk, .19, .49), (0, -.1, .12), 'dark')
            box('Foot armor', 'ankle_' + suffix, (.27 * bulk, .09, .33), (0, -.025, .2))
            box('Mechanical gripper', 'wrist_' + suffix, (.2, .15, .2), (0, -.06, .05), 'mid')
            if not swarm:
                box('Shoulder blast shield', 'shoulder_' + suffix, (.43, .29, .53), (sign * .06, -.06, 0))
        disk('Scanning optic', 'scanner', .08, .12, (0, 0, 0), 'glass', 'z', 6)
        gun('gun')
        if role != 'soldier':
            for x in [-.24, .24]:
                tube('Backpack ammunition container', 'hips', .14, .07, .76, (x, .62, -.58), 'mid', 'y', 6)
    elif s['kind'] in ('wheeled', 'tracked'):
        w, length, radius = p['width'], p['length'], p['wheelRadius']
        box('Chassis keel', 'hull', (w * .75, .5, length), (0, .85, 0), 'dark')
        a.loft('Split carapace hull' if swarm else 'Welded fortress hull', J('hull'),
               [(-length / 2, w * .7, .9), (-length * .28, w * .94, 1.32),
                (length * .35, w * .86, 1.15), (length / 2, w * .55, .55)], 'shell', (0, 1.3, 0), axis='z')
        for sign in [-1, 1]:
            for i, z in enumerate(p['axles']):
                wheel = f'wheel_{sign}_{i}'
                disk('Drive tire', wheel, radius, .48, (0, 0, 0), 'deep', 'x')
                disk('Hub flange', wheel, radius * .63, .51, (0, 0, 0), 'mid', 'x', 8)
                disk('Axle cap', wheel, radius * .23, .54, (0, 0, 0), 'trim', 'x', 6)
                if swarm:
                    honey('hull', (sign * w * .47, 1.65, z), .62, .2, 'mid')
                else:
                    armor = box('Spaced side armor', 'hull', (.18, .73, length / len(p['axles']) * .88),
                                (sign * w * .51, 1.4, z), 'shell')
                    for y in [1.28, 1.62]:
                        disk('Armor fixing bolt', 'hull', .055, .22, (sign * w * .51, y, z), 'trim', 'x', 6)
            box('Cargo rack' if swarm else 'Armored track skirt', 'hull', (.38, .24, length * .82),
                (sign * w * .47, 2.02 if swarm else 1.78, -.1), 'dark')
        if swarm:
            for z in [-1.4, 0, 1.4]:
                tube('Exposed cartridge rack', 'hull', .24, .12, .66, (.8, 2.05, z), 'trim', 'x', 6)
            for x in [-.9, .9]:
                strut('Radio whip', 'hull', (x, 1.9, -length * .35), (x * 1.15, 2.9, -length * .38), .022, 'trim')
            disk('Hexagonal turret hub', 'turret', .88, .42, (0, 0, 0), 'dark', 'y', 6)
            for x in [-.55, .55]:
                honey('turret', (x, .18, .15), .5, .35)
        else:
            a.loft('Low slab turret', J('turret'), [(-.26, 2.05, 2.1), (.36, 1.5, 1.7)], 'shell')
            box('Counterweight bustle', 'turret', (1.7, .5, 1.05), (0, .14, -1.15), 'mid')
            for x in [-1.1, 1.1]:
                tube('Protected exhaust', 'hull', .15, .09, .8, (x, 1.6, -length * .45), 'deep', 'y')
            box('Dozer glacis', 'hull', (w, .48, .2), (0, .72, length * .52), 'mid')
        gun('gun', 1.65 if role == 'tank' else 1.15, True)
        disk('Target scanner', 'scanner', .17, .12, (0, 0, .08), 'glass', 'z')
        louver('hull', (0, 1.58, -length * .5), w * .4)
    elif role == 'heli':
        if swarm:
            a.loft('Segmented flying abdomen', J('tilt'), [(-2.1, .25, .42), (-1.2, 1.05, .85),
                    (.5, 1.2, .92), (1.55, .75, .62), (2, .3, .42)], 'shell', axis='z')
            for z in [-1.25, -.6, .1]:
                tube('Replaceable abdomen collar', 'tilt', .52, .4, .16, (0, 0, z), 'trim', 'z', 6)
            for x in [-p['rotorX'], p['rotorX']]:
                for z in [-p['rotorZ'], p['rotorZ']]:
                    strut('Carbon rotor spar', 'tilt', (x * .2, 0, z * .6), (x, .3, z), .11)
                    tube('Open armored rotor duct', 'tilt', p['rotorRadius'] + .17, p['rotorRadius'], .42, (x, .3, z), 'mid', 'y', 16)
                    rotor = f'rotor_{x}_{z}'
                    disk('Rotor hub', rotor, .17, .24, (0, 0, 0), 'trim')
                    for i in range(3):
                        blade = wing(a, 'Swept duct fan', J(rotor), [(0, 0), (.18, .2), (.16, 1.02), (-.04, .9)], (0, 0, 0), 'deep', .055)
                        a.rotate(blade, 'y', i * math.tau / 3)
            for x in [-.38, .38]:
                disk('Compound optical head', 'tilt', .22, .13, (x, .05, 1.58), 'glass', 'z', 6)
        else:
            a.loft('Armored tandem fuselage', J('tilt'), [(-2, .6, .7), (-.8, 1.75, 1.35),
                    (.7, 1.4, 1.2), (2.3, .75, .65)], 'shell', axis='z')
            box('Recessed cockpit slit', 'tilt', (.82, .17, .09), (0, .45, 1.7), 'glass')
            for x in [-.62, .62]:
                tube('Turbine exhaust', 'tilt', .32, .22, 1.7, (x, .4, -1.45), 'dark')
                wing(a, 'Armored stub wing', J('tilt'), [(0, -.55), (2.6, -.25), (2.3, .6), (0, .85)], (0, -.25, -.1), 'mid', .17).scale.x = 1 if x > 0 else -1
            strut('Protected tail boom', 'tilt', (0, .1, -1.5), (0, .45, -p['tailLength']), .3, 'dark')
            plate('Tail stabilizer', 'tilt', [(-.25, 0), (.25, 0), (.35, 1.5), (0, 1.85), (-.35, 1.5)], .15, (0, .45, -p['tailLength']), 'mid')
            for i in range(2):
                rotor = 'rotor_' + str(i)
                disk('Coaxial rotor hub', rotor, .25, .3, (0, 0, 0), 'trim')
                for n in range(3):
                    blade = wing(a, 'Heavy counterrotating blade', J(rotor), [(0, 0), (.3, .2), (.25, p['rotorRadius']), (-.16, p['rotorRadius'])], (0, 0, 0), 'deep', .07)
                    a.rotate(blade, 'y', n * math.tau / 3)
        for sign in [-1, 1]:
            strut('Landing strut', 'tilt', (sign * .6, -.25, .5), (sign * 1.1, -1.3, .55), .09, 'mid')
            strut('Landing runner', 'tilt', (sign * 1.1, -1.3, -1.2), (sign * 1.1, -1.3, 1.4), .12, 'deep')
        gun('gun0', 1.2)
        gun('gun1', 1.2)
    elif role in ('tower', 'turret', 'battery'):
        box('Targeting sensor mount', 'weapon_sensor', (.6, .35, .55), (0, 0, 0), 'dark')
        box('Recessed targeting aperture', 'weapon_sensor', (.36, .09, .05), (0, .03, .3), 'glass', .01)
        if role == 'battery':
            for i in range(2):
                parent = f'turret{i}'
                disk('Battery rotating seat', parent, 2.5, .6, (0, 0, 0), 'dark', 'y', 6 if swarm else 12)
                if swarm:
                    for x in [-1.8, 1.8]:
                        honey(parent, (x, .35, -.4), 1.45, .65)
                else:
                    box('Battery blast shield', parent, (5.2, 2.7, 4.5), (0, .7, -.65))
                gun(f'gun{i}', 5, True)
        else:
            disk('Turret rotating seat', 'turret', 2.1, .6, (0, .3, 0), 'dark', 'y', 6 if swarm else 12)
            if swarm:
                honey('pitch', (0, 0, -.32), 1.4, .45, 'mid')
            else:
                box('Armored twin rail turret', 'pitch', (4.1, 1.45, 3.2), (0, 0, .15))
            for i in range(6 if swarm else 2):
                gun(f'gun{i}', 2.4 if swarm else 2.6)
    if role in ('base', 'tower', 'bunker'):
        h = s['height']
        if swarm:
            if role == 'tower':
                disk('Sixfold foundation', 'root', 5.4, 1.1, (0, .55, 0), 'dark', 'y', 6)
                tube('Open relay core', 'root', 1.35, .95, 15.8, (0, 9, 0), 'mid', 'y', 6)
                for i in range(3):
                    angle = i * math.tau / 3
                    x, z = math.cos(angle) * 3.5, math.sin(angle) * 3.5
                    strut('Tripod load truss', 'root', (x, 1, z), (x * .48, 17.3, z * .48), .35, 'dark')
                    rib = plate('Separated petal armor', 'root', [(-.9, 0), (.9, 0), (.5, 10), (0, 14.5), (-.5, 10)], .45, (x, 2, z))
                    a.rotate(rib, 'y', -angle)
                for y in [4, 9, 14, 17.8]:
                    tube('Exposed hexagonal collar', 'root', 3.3, 2.9, .26, (0, y, 0), 'trim', 'y', 6)
            elif role == 'base':
                disk('Distributed nexus foundation', 'root', 13, 2, (0, 1, 0), 'dark', 'y', 6)
                for i in range(6):
                    angle = i * math.tau / 6
                    x, z = math.cos(angle) * 8, math.sin(angle) * 8
                    disk('Replaceable hexagonal habitat', 'root', 4.2, 8, (x, 6, z), 'shell', 'y', 6)
                    tube('Module roof collar', 'root', 4.4, 3.65, .7, (x, 10.4, z), 'trim', 'y', 6)
                    strut('Distributed mast truss', 'root', (x, 10.7, z), (x * .3, 26, z * .3), .34, 'mid')
                    panel = plate('Swept antenna petal', 'root', [(-1.2, 0), (1.2, 0), (1.55, 8), (.5, 15), (-.5, 15), (-1.55, 8)], .38, (x * .48, 15, z * .48))
                    a.rotate(panel, 'y', -angle)
                tube('Nexus central lattice', 'root', 2, 1.3, 26, (0, 18, 0), 'dark', 'y', 6)
                disk('Nexus beacon', 'root', 1.4, 1, (0, 31.5, 0), 'glass', 'y', 6)
            else:
                disk('Relay shelter foundation', 'root', 5.8, .8, (0, .4, 0), 'dark', 'y', 6)
                for i in range(6):
                    angle = i * math.tau / 6
                    x, z = math.cos(angle) * 3.2, math.sin(angle) * 3.2
                    disk('Independent armored cell', 'root', 2.35, 4, (x, 2.8, z), 'shell', 'y', 6)
                    tube('Cell crown', 'root', 2.5, 2.04, .4, (x, 4.9, z), 'trim', 'y', 6)
                tube('Raised relay mast', 'root', .45, .2, 6, (0, 4.8, 0), 'mid', 'y', 6)
        else:
            w = h * (.62 if role == 'tower' else .8 if role == 'base' else 1.5)
            depth = w * .85
            box('Continuous armored foundation', 'root', (w * 1.2, h * .06, depth * 1.2), (0, h * .03, 0), 'dark', .1)
            a.loft('Fortress main block', J('root'), [(h * .06, w, depth), (h * .56, w * .72, depth * .78),
                    (h * .81, w * .6, depth * .68)], 'shell')
            for sign in [-1, 1]:
                a.loft('Armored external buttress', J('root'), [(h * .06, w * .23, depth * .82),
                        (h * .76, w * .12, depth * .62)], 'dark', (sign * w * .46, 0, -.15))
            for y in [.18, .32, .46, .6, .74]:
                box('Horizontal blast belt', 'root', (w * (1 - y * .35), h * .024, depth * .84), (0, h * y, 0), 'mid')
            if role == 'base':
                for x in [-w * .28, w * .28]:
                    tube('Foundry exhaust stack', 'root', 1.3, .83, h * .68, (x, h * .52, -depth * .36), 'dark', 'y')
                    tube('Stack armored crown', 'root', 1.6, .85, 1.4, (x, h * .86, -depth * .36), 'trim', 'y')
                box('Protected command keep', 'root', (w * .36, h * .22, depth * .45), (0, h * .89, 0))
                box('Command vision slit', 'root', (w * .29, .4, .18), (0, h * .94, depth * .23), 'glass')
                box('Armored entry arch', 'root', (w * .22, h * .19, .5), (0, h * .15, depth * .46), 'deep')
            elif role == 'tower':
                box('Protected turret deck', 'root', (6.2, .9, 5.6), (0, p['seat'] - .55, 0), 'mid')
            else:
                box('Overhanging bunker roof', 'root', (w * .92, .8, depth * .95), (0, h * .72, 0), 'mid')
                for x in [-w * .25, 0, w * .25]:
                    box('Protected firing slit', 'root', (1.75, .24, .1), (x, h * .56, depth * .36), 'deep', .015)
                tube('Periscope mast', 'root', .32, .18, 2.1, (0, h * .85, 0), 'mid', 'y')
        scanner = 'scanner'
        if swarm:
            tube('Open relay scanner ring', scanner, h * .09, h * .078, h * .018, (0, 0, 0), 'trim', 'y', 6)
            for sign in [-1, 1]:
                strut('Scanner tie', scanner, (0, 0, 0), (sign * h * .09, 0, 0), .06, 'dark')
                disk('Distributed scanning optic', scanner, h * .017, h * .026, (sign * h * .09, 0, 0), 'glass', 'z', 6)
        else:
            box('Recessed armored sensor', scanner, (h * .14, h * .07, h * .065), (0, 0, 0), 'dark')
            box('Sensor aperture', scanner, (h * .105, h * .014, .06), (0, .005, h * .035), 'glass')
        for i in range(2):
            box('Actuated cooling cover', f'vent{i}', (h * .1, h * .12, h * .025), (0, 0, 0), 'mid')
            louver(f'vent{i}', (0, -h * .04, -h * .017), h * .08, 5)
    a.reset()
