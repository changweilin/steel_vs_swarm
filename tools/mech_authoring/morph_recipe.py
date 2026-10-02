"""One rigid part inventory; both endpoint poses belong to the morpher contract."""
import math
import json
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector
from catalog import vents, ellipsoid, wing, spike, tails, animal_limb


def apply_form(a, form):
    positions = {name: at for name, _, at in a.spec['joints']}
    names = set().union(*(f['transforms'] for f in a.spec['forms'].values()))
    for name in names:
        pose = a.spec['forms'][form]['transforms'].get(name, {})
        node = a.nodes[name]
        p = pose.get('position', positions[name])
        node.location = (p[0], -p[2], p[1])
        node.rotation_euler = rotation(pose.get('rotation', (0, 0, 0))).to_euler()


def rotation(r):
    return Quaternion((1, 0, 0), r[0]) @ Quaternion((0, 0, 1), r[1]) @ Quaternion((0, -1, 0), r[2])


def create(base, spec):
    class Morpher(base):
        def __init__(self, spec):
            super().__init__(spec)
            if self.spec['kind'] == 'biped':
                # Derive rest endpoints from the gait rig so idle and transformation start in the same stance.
                ground = self.spec['forms']['ground']['transforms']
                rig = self.spec['rig']
                for side in ['L', 'R']:
                    for name, angle in [(rig['leg' + side], rig.get('legBase', 0)),
                                        (rig['arm' + side], rig.get('armBase', 0))]:
                        ground.setdefault(name, {}).setdefault('rotation', [angle, 0, 0])
                    for chain in ['legChain', 'armChain']:
                        for joint in rig[chain + side]:
                            r = [0, 0, 0]
                            r['xyz'.index(joint.get('axis', 'x'))] = joint['base']
                            ground.setdefault(joint['g'], {}).setdefault('rotation', r)
            self.reset()

        def reset(self):
            super().reset()
            form = getattr(self, '_pose_form', 'ground')
            apply_form(self, form)
            for obj in getattr(self, 'exhaust', []):
                obj.hide_render = form != 'flight'

        def pose(self, clip, t):
            if clip in ('to_flight', 'to_ground'):
                u = max(0, min(1, t))
                if clip == 'to_ground':
                    u = 1 - u
                u = u * u * (3 - 2 * u)
                super().reset()
                positions = {name: at for name, _, at in self.spec['joints']}
                for name, node in self.nodes.items():
                    ends = []
                    for form in ['ground', 'flight']:
                        pose = self.spec['forms'][form]['transforms'].get(name, {})
                        p = pose.get('position', positions[name])
                        r = pose.get('rotation', [0, 0, 0])
                        ends.append((Vector((p[0], -p[2], p[1])), rotation(r)))
                    node.location = ends[0][0].lerp(ends[1][0], u)
                    node.rotation_euler = ends[0][1].slerp(ends[1][1], u).to_euler()
                return
            flight = clip.startswith('flight_')
            self._pose_form = 'flight' if flight else 'ground'
            try:
                # Apply the endpoint before secondary motion; an endpoint post-pass would erase animated joints.
                if clip == 'flight_idle':
                    self.reset()
                else:
                    super().pose(clip.removeprefix('flight_'), t)
            finally:
                del self._pose_form
            if flight:
                if clip == 'flight_idle':
                    self.nodes['tilt'].location.z += math.sin(t * math.tau) * self.spec['forms']['flight']['rig']['bob']
                rig=self.spec['forms']['flight']['rig']
                for entry in rig.get('spin', []):
                    self.rotate(self.nodes[entry['node']],entry['axis'],t*entry['rate'])
                for entry in rig.get('wings', []):
                    self.rotate(self.nodes[entry['w']],'z',entry['sgn']*math.sin(t*math.tau*3)*.24)
                    self.rotate(self.nodes[entry['outer']],'z',entry['sgn']*math.sin(t*math.tau*3-.6)*.32)
            if clip in ('light', 'flight_light'):
                spinner = self.spec['motion'].get('fireSpin')
                if spinner:
                    self.rotate(self.nodes[spinner['node']], spinner['axis'], t * spinner['rate'] * math.sin(math.pi * t) ** 2)

        def render(self, directory):
            evidence = super().render(directory)
            camera = bpy.context.scene.camera
            p = self.spec['reviewFrame']['target']
            target = Vector((p[0], -p[2], p[1]))
            review=json.loads((Path(__file__).parent/'assets.json').read_text())['review']
            views={name:(p[0],-p[2],p[1]) for name,p in review['views'].items()}
            poses = [('flight_' + view, 'flight_idle', 0, at) for view, at in views.items()]
            poses += [('transform_' + str(i), 'to_flight', i / 4, views['reference']) for i in range(5)]
            poses += [(clip, clip, 1 if 'shield' in clip else .5, views['reference']) for clip in ['shield_retract', 'flight_shield_deploy',
                      'flight_shield_retract', 'flight_light', 'flight_heavy', 'skill', 'ult', 'flight_skill', 'flight_ult']]
            for name, clip, t, at in poses:
                self.pose(clip, t)
                camera.location = at
                camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
                self.render_still(directory, name)
                evidence.append(name + '.png')
            self.reset()
            return evidence
    return Morpher(spec)


def bands(a, parent, at, width, height=.08):
    for i, material in enumerate(['red', 'white', 'blue']):
        a.box('Serbian tricolor armor band', parent, (width, height, .024),
              (at[0], at[1] - i * height, at[2]), material, .003)


def vampire(a):
    p = a.p
    positions = {name: at for name, _, at in a.spec['joints']}
    cavity=a.spec['cavity']
    a.loft('Continuous armored belly keel', 'chest', cavity['sections'], 'shade', cavity['offset'])
    a.loft('Tapered waist and pelvic shell', 'hips', [(-.28, .52, .42), (.05, .88, .65), (.58, .82, .70)], 'shade')
    for i in range(3):
        a.plate('Overlapping angular abdominal armor', 'hips', [(-.37, .12), (.37, .12), (.27, -.16),
                (0, -.31), (-.27, -.16)], .12, (0, .57 - i * .23, .38), 'armor')
    for side, n in [(1, 'l'), (-1, 'r')]:
        mirror = lambda pts: [(side * x, y) for x, y in pts]
        a.plate('Faceted pectoral breastplate', 'chest', mirror([(0, .05), (.74, .20), (.82, .94),
                (.24, 1.17), (0, .98)]), .12, (0, .35, .37), 'armor')
        for dy, mat in [(0, 'white'), (-.09, 'red')]:
            a.plate('Chest tricolor chevron', 'chest', mirror([(.1, .78), (.60, .43), (.65, .52),
                    (.12, .88)]), .025, (0, .45 + dy, .445), mat)
        a.plate('Tall vampire collar outer', 'chest', mirror([(.25, 1.26), (.57, 1.30), (.67, 2.13),
                (.39, 2.21)]), .18, (0, 0, -.24), 'dark')
        a.plate('Vampire collar red lining', 'chest', mirror([(.31, 1.35), (.5, 1.40), (.57, 2.03),
                (.4, 2.09)]), .022, (0, 0, -.137), 'red')
        vents(a, 'chest', (side * .44, .22, .39), .20, 3)
        a.plate('Closing ventral bay door', 'bay_' + n, mirror([(0, .16), (-.68, .16),
                (-.57, -.72), (-.12, -.96)]), .10, (0, 0, 0), 'armor')
        a.box('Ventral door seam', 'bay_' + n, (.025, .7, .018), (-side * .58, -.22, .07), 'steel', .002)
        for root, child, width in [('hip_' + n, 'knee_' + n, .43), ('knee_' + n, 'ankle_' + n, .35),
                                   ('shoulder_' + n, 'elbow_' + n, .36), ('elbow_' + n, 'wrist_' + n, .32)]:
            length = abs(positions[child][1])
            a.strut('Rigid articulated load bearing link', root, (0, 0, 0), positions[child], width * .35, 'steel')
            a.loft('Segmented tapered navy limb shell', root, [(-length * .9, width * .68, width * .9),
                   (-length * .45, width * 1.15, width * 1.18), (-length * .10, width, width)], 'armor')
            a.disk('Exposed joint hinge collar', root, width * .45, width * 1.08, (0, 0, 0), 'dark', 'x')
            a.plate('Separate angular limb face plate', root, [(-width * .42, -.14), (width * .42, -.14),
                    (width * .35, -length * .68), (0, -length * .87), (-width * .35, -length * .68)],
                    .045, (0, 0, width * .62), 'shade')
            if root.startswith('knee'):
                a.plate('Pointed silver knee inset', root, [(-.13, -.03), (.13, -.03), (.1, -.32),
                        (0, -.44), (-.1, -.32)], .05, (0, -.07, width * .66), 'steel')
                bands(a, root, (0, -.60, width * .64), width * .92, .055)
        a.loft('Layered shoulder pauldron', 'shoulder_' + n, [(-.38, .55, .44), (.04, .70, .50),
               (.25, .50, .38)], 'armor', (side * .06, 0, 0))
        bands(a, 'shoulder_' + n, (side * .06, .12, .275), .58, .06)
        a.box('Rigid armored hand', 'wrist_' + n, (.29, .20, .32), (0, -.05, .06), 'shade', .025)
        a.loft('Pointed grounded armored boot', 'ankle_' + n, [(-.24, .32, .32), (.02, .39, .65),
               (.14, .32, .41)], 'armor', (0, 0, .15))
        a.box('Boot sole', 'ankle_' + n, (.38, .065, .76), (0, -.24, .14), 'dark', .015)
        a.plate('Shared triangular cape wing', 'wing_' + n,
                mirror([(0, p['wingFore']), (p['wingSpan'], p['wingAft']), (0, p['wingAft'])]), .09, (0, 0, 0), 'shade')
        a.plate('Shared navy wing armor surface', 'wing_' + n,
                mirror([(.06, p['wingFore'] - .10), (p['wingSpan'] - .14, p['wingAft'] + .055),
                        (.06, p['wingAft'] + .07)]), .022, (0, 0, -.06), 'armor')
        for i in range(4):
            x = side * p['wingSpan'] * (i + 1) / 5
            y = p['wingFore'] + (p['wingAft'] - p['wingFore']) * (i + 1) / 5
            a.strut('Shared wing structural rib', 'wing_' + n, (x, y, -.09),
                    (x * .8, p['wingAft'] + .08, -.09), .032, 'brass')
        a.strut('Shared wing leading edge spar', 'wing_' + n, (0, p['wingFore'], -.06),
                (side * p['wingSpan'], p['wingAft'], -.06), .055, 'steel')
        bands(a, 'wing_' + n, (side * (p['wingSpan'] - .65), p['wingAft'] + .30, -.075), .34, .055)
        a.disk('Visible wing root hinge', 'wing_' + n, .14, .18, (0, 0, 0), 'steel')
        a.tube('Shared rear propulsion nozzle', 'chest', .19, .14, .50, (side * .37, 0, -.49), 'steel', 'y')
        a.disk('Shared propulsion aperture', 'chest', .12, .01, (side * .37, -.27, -.49), 'cyan', 'y')
    a.loft('Faceted elongated vampire helmet', 'head', [(-.13, .24, .37), (.12, .52, .50),
           (.49, .42, .41), (.61, .15, .20)], 'armor')
    a.plate('Silver widow peak mask', 'head', [(-.25, .40), (-.09, .22), (0, .43), (.09, .22),
            (.25, .40), (.135, -.13), (0, -.28), (-.135, -.13)], .06, (0, .04, .28), 'white')
    a.plate('Red sensor visor slit', 'head', [(-.21, .19), (0, .13), (.21, .19), (.16, .145),
            (0, .08), (-.16, .145)], .016, (0, .04, .33), 'glow')
    a.tube('Single monocular sensor socket', 'head', .067, .047, .024, (.135, .21, .342), 'steel')
    a.disk('Central crimson sensor', 'head', .055, .021, (0, .20, .354), 'glow')
    a.box('Anatomical right rotary gun receiver', 'gun_recoil', (.48, .50, .70), (0, 0, .2), 'shade', .05)
    a.disk('Six barrel rotary hub', 'gun_spin', .25, .20, (0, 0, .62), 'steel')
    for i in range(6):
        angle = i * math.tau / 6
        x, y = .17 * math.cos(angle), .17 * math.sin(angle)
        a.tube('Right gatling open barrel', 'gun_spin', .058, .038, p['gunLength'] - .55,
               (x, y, (p['gunLength'] + .55) / 2), 'steel', segments=10)
    a.tube('Six barrel forward clamp', 'gun_spin', .26, .225, .11, (0, 0, p['gunLength'] - .20), 'shade')
    a.disk('Light muzzle emission', 'light_muzzle', .025, .012, (0, 0, 0), 'glow')
    a.box('Anatomical left twin missile box', 'heavy', (.60, .49, 1.0), (0, 0, .27), 'shade', .04)
    for x in [-.155, .155]:
        a.tube('Left twin missile launch cell', 'heavy', .14, .105, 1.08, (x, 0, .36), 'steel', segments=12)
        a.disk('Missile cell red indicator', 'heavy', .064, .015, (x, 0, -.19), 'red')
    a.box('Missile charge shutter', 'charge_hinge', (.49, .07, .39), (0, 0, 0), 'armor', .02)
    a.disk('Heavy muzzle emission', 'heavy_muzzle', .04, .01, (0, 0, 0), 'glow')
    for name in ['emitter_l', 'emitter_r']:
        a.loft('Independent retractable shield emitter', name, [(0, .14, .16), (.42, .14, .13),
               (.58, .06, .07)], 'shade')
        a.box('Shield emitter luminous rail', name, (.035, .39, .02), (0, .27, .09), 'cyan', .002)
    a.barrier('barrier', 1.55, 1.9)
    a.tube('Articulated cast annulus', 'cast_dish', .23, .17, .065, (0, 0, 0), 'cyan')


def construct(a):
    if a.spec['id'] == 'm01':
        vampire(a)
    else:
        morpher(a)


def armor_cavity(a):
    c = a.spec.get('cavity')
    if not c:
        return
    if c.get('profile') == 'ellipse':
        rounded_hull(a, 'Shared sealed ventral hull', c['owner'], c['sections'], c['offset'], 'shade')
    else:
        a.loft('Shared sealed ventral hull', c['owner'], c['sections'], 'shade', c['offset'], c['axis'])


def morph_limb(a, parent, delta, width):
    length = Vector(delta).length
    a.strut('Exposed articulated load piston', parent, (0,0,0), delta, width*.32, 'steel')
    obj = a.loft('Continuous tapered limb armor', parent, [(length*.12,width*.90,width*.72),
                 (length*.28,width*1.12,width*.96), (length*.76,width*.80,width*.74),
                 (length*.91,width*.56,width*.52)], 'armor')
    obj.rotation_euler = Vector((delta[0],-delta[2],delta[1])).to_track_quat('Z','Y').to_euler()
    a.disk('Exposed limb articulation axle',parent,width*.48,width*.90,(0,0,0),'dark','x')
    a.disk('Limb silver axle cap',parent,width*.24,width*.94,(0,0,0),'brass','x')


def limb_inventory(a):
    positions = {name: v for name, _, v in a.spec['joints']}
    insect, elephant, raptor = [a.spec['id'] == id for id in ['m07', 's03', 's10']]
    legs = a.p['legs']
    if insect:
        insect_legs(a)
        return
    for leg in legs:
        owner = leg['root']
        fore = 'F' in owner
        for i, delta in enumerate(leg['deltas']):
            widths = a.p.get('legWidths', {}).get('fore' if fore else 'mid' if 'M' in owner else 'hind', [1, .84])
            width = a.p['limb'] * widths[i]
            if a.p.get('legAnatomy'):
                animal_limb(a, owner, delta, width, 'fore' if fore else 'hind', i)
            else:
                morph_limb(a, owner, delta, width)
            owner = next(n for n, parent, _ in a.spec['joints'] if parent == owner)
        if elephant:
            ellipsoid(a, 'Pillar foot armor', owner, (.82, .34, .84), (0, -.04, 0), 'armor', 12, 6)
            for x in [-.22, 0, .22]:
                a.box('Elephant foot nail', owner, (.14, .12, .09), (x, -.10, .39), 'white', .02)
        elif raptor:
            fore = 'F' in leg['root']
            a.box('Three digit claw palm' if fore else 'Raptor distal toe pad', owner, (.22, .17 if fore else .14, .24), (0, -.05, .06), 'shade', .025)
            for x in ([-.12, 0, .12] if fore else [0, leg['side']*.14]):
                spike(a, 'Raptor grasping digit' if fore else 'Raptor toe claw', owner, (x, -.12, .14), (x, -.20, .42), .052, 'white')
            if not fore:
                blade = a.plate('Raised second toe sickle blade', owner, [(-.02, .02), (.03, .22), (.18, .34),
                        (.34, .30), (.42, .14), (.35, -.04), (.28, .15), (.15, .19), (.08, .06)],
                        .055, (-leg['side']*.16, .02, .13), 'brass')
                blade.rotation_euler = rotation((0, -math.pi/2, 0)).to_euler()
        elif a.spec['id'] == 'm08':
            ellipsoid(a, 'Matte feline paw', owner, (.38, .22, .49), (0, -.06, .05), 'shade', 12, 6)
            for x in [-.11, 0, .11]:
                a.box('Feline toe pad', owner, (.085, .12, .14), (x, -.08, .25), 'armor', .02)
        else:
            a.loft('Tapered armored boot', owner, [(-.2, .38, .46), (.1, .28, .28)], 'armor', (0, 0, .05))
            if a.spec['id'] == 'm05':
                for x in [-.15, 0, .15]:
                    spike(a, 'Wolf hind claw', owner, (x, -.15, .20), (x, -.22, .40), .05, 'steel')
    if a.spec['kind'] == 'biped':
        for s, n in [(1, 'l'), (-1, 'r')]:
            for root, child, factor in [('shoulder_', 'elbow_', 1), ('elbow_', 'wrist_', .88)]:
                morph_limb(a, root+n, positions[child+n], a.p['limb']*factor)
            a.loft('Independent shoulder cap', 'shoulder_'+n, [(-.22, .57, .50), (.16, .66, .53)], 'armor')
            a.box('Articulated palm', 'wrist_'+n, (.28, .22, .22), (0, -.08, .04), 'shade', .025)
            for x in [-.09, 0, .09]:
                if a.spec['id'] == 'm05':
                    spike(a, 'Wolf fore claw', 'wrist_'+n, (x, -.18, .1), (x, -.38, .28), .042, 'steel')
                else:
                    a.box('Armored finger', 'wrist_'+n, (.06, .18, .08), (x, -.22, .12), 'armor', .009)


def biped_body(a):
    if a.spec['id'] == 'm05':
        a.loft('Narrow wolf abdomen', 'hips', [(-.32, .62, .42), (.2, .96, .54), (.63, .9, .57)], 'shade')
        a.loft('Long canine rib armor', 'chest', [(0, .72, .5), (.85, 1.72, .78), (1.3, 1.68, .7)], 'shade')
    else:
        a.loft('Articulated pelvic shell', 'hips', [(-.3, .62, .48), (.25, .95, .56)], 'shade')
    for s in [-1, 1]:
        a.plate('Split tapered pectoral armor', 'chest', [(s*.06, .38), (s*.67, .30), (s*.81, 1.05),
                (s*.55, 1.34), (s*.08, 1.13)], .10, (0, 0, .56), 'armor')
        a.strut('Chest colored conduit', 'chest', (s*.22, .35, .64), (s*.70, .98, .64), .022, 'cyan')
        vents(a, 'chest', (s*.38, .05, .57), .27, 3, 'brass')
    for i in range(3):
        a.plate('Separate overlapping abdominal armor', 'hips', [(-.38, .11), (.38, .11), (.28, -.13),
                (0, -.26), (-.28, -.13)], .09, (0, .6-i*.19, .33), 'armor')


def feathers(a):
    p = a.p
    owl = a.spec['id'] == 'm08'
    for s, n in [(1, 'l'), (-1, 'r')]:
        wing(a, 'Shared folded scapular wing', 'flap_'+n, [(0,.25), (s*1.82, .50 if owl else .25),
             (s*1.7,-.72), (s*.12,-.82)], (0,0,0), 'armor', .085)
        a.strut('Wing leading spar', 'flap_'+n, (0,.015,.25), (s*1.78,.015,.50 if owl else .25), .038, 'steel')
        wing(a, 'Continuous primary feather root web', 'outer_'+n,
             [(-s*.15,.24),(s*1.28,.24),(s*1.40,-.70),(-s*.15,-.50)],
             (0,0,0), 'shade', .045)
        for i in range(7):
            length=1.28-i*.055
            root=f'feather_{n}_{i}'
            wing(a, 'Independent owl silent feather' if owl else 'Independent raptor blade feather', root,
                 [(-s*.16,.14),(s*.18,.19),(s*(length*.8+.25),-1.45-i*.1),
                  (s*(length*.8-.035),-1.65-i*.1)], (0,.028+i*.003,0), 'armor' if i%2 else 'shade', .038)
            a.strut('Feather shaft inlay', root, (0,.027,0), (s*length*.8,.027,-1.50-i*.1), .009, 'cyan' if owl else 'brass')
        for i in range(8):
            x=s*(.05+i*.22)
            wing(a, 'Overlapping secondary flight feather', 'flap_'+n,
                 [(x-s*.08,-.06),(x+s*.24,.02),(x+s*.37,-1.10),(x+s*.04,-1.19)],
                 (0,.045+i*.002,0), 'armor' if i%2 else 'shade', .035)


def feline_head(a):
    ellipsoid(a, 'Rounded matte panther skull', 'head', (1.10,.78,.98), (0,.10,.25), 'armor')
    ellipsoid(a, 'Paired feline muzzle lobes', 'head', (.67,.34,.38), (0,-.10,.67), 'shade')
    a.plate('Black feline nose', 'head', [(-.15,.04),(.15,.04),(0,-.10)], .035, (0,-.07,.88), 'dark')
    for s in [-1,1]:
        a.plate('Triangular cat ear', 'head', [(s*.26,.36),(s*.49,.83),(s*.56,.33)], .13, (0,0,.02), 'armor')
        a.plate('Low light feline eye', 'head', [(s*.08,.22),(s*.42,.35),(s*.35,.21),(s*.14,.14)], .015, (0,0,.72), 'glow')
        a.strut('Facial matte seam', 'head', (s*.49,.23,.65),(s*.19,-.19,.71),.013,'steel')


def wolf_head(a):
    a.loft('Angular canine skull', 'head', [(-.18,.48,.66),(.20,.73,.77),(.53,.53,.60)], 'armor')
    a.loft('Long wolf muzzle', 'head', [(.23,.55,.35),(.94,.29,.23)], 'shade',(0,.02,0),'z')
    a.loft('Canine lower jaw', 'head', [(.22,.43,.13),(.83,.25,.10)], 'armor',(0,-.21,0),'z')
    a.box('Wolf nose', 'head', (.25,.16,.16), (0,.04,.9), 'dark', .045)
    for s in [-1,1]:
        a.plate('Pointed wolf ear', 'head', [(s*.20,.38),(s*.38,.95),(s*.52,.39)], .16, (0,0,-.08), 'shade')
        a.plate('Slanted canine sensor', 'head', [(s*.10,.19),(s*.34,.32),(s*.29,.15),(s*.12,.10)], .02, (0,.04,.42), 'glow')
        for i in range(5):
            spike(a,'Canine exposed fang','head',(s*(.13+i*.016),-.05,.36+i*.1),(s*(.13+i*.016),-.24,.36+i*.1),.045,'white')
        for i in range(4):
            spike(a,'Angular wolf cheek mane','head',(s*.25,.32-i*.11,-.1),(s*(.61-i*.05),.28-i*.17,-.29),.14,'shade')


def monkey_head(a):
    a.loft('Agile monkey helmet', 'head', [(-.25,.37,.36),(.24,.59,.46),(.49,.37,.37)], 'armor')
    a.plate('Pale opera monkey face', 'head', [(-.25,.28),(0,.18),(.25,.28),(.23,-.04),
            (.11,-.25),(0,-.31),(-.11,-.25),(-.23,-.04)], .075, (0,0,.28), 'white')
    for s in [-1,1]:
        a.plate('Red opera brow paint', 'head', [(s*.04,.16),(s*.22,.26),(s*.18,.08),(s*.08,.035)], .014,(0,0,.328),'red')
        a.strut('Angry monkey sensor','head',(s*.07,.1,.346),(s*.17,.16,.346),.019,'dark')
        a.disk('Monkey ear disc','head',.15,.12,(s*.33,.08,0),'brass','x')
        a.tube('Double spiral circlet','head',.11,.075,.04,(s*.105,.40,.35),'brass',segments=20)
        a.strut('Golden circlet rim','head',(0,.36,.35),(s*.32,.34,.04),.045,'brass')
        path=[(s*.17,.5,0),(s*.31,.95,-.10),(s*.49,1.32,-.38),(s*.6,1.47,-.9),(s*.64,1.33,-1.55)]
        for i,(start,end) in enumerate(zip(path,path[1:])):
            a.strut('Paired long crown sensor antenna','head',start,end,.042-i*.007,'brass')
    a.loft('Crown forehead point','head',[(.4,.25,.20),(.74,.025,.05)],'brass')


def atlas(a):
    helmet = a.spec['parameters']['helmet']
    # Native forward-facing geometry lets the gait stabilize the face and the chest fold the nose.
    a.plate('Right isosceles triangular helmet nose','head',helmet['points'],helmet['depth'],helmet['position'],'armor')
    a.plate('Atlas black observation face','head',[(-.37,.10),(.37,.10),(.25,-.23),(-.25,-.23)],.045,helmet['facePosition'],'dark')
    a.box('Old ivory observation slit','head',(.47,.045,.025),helmet['slitPosition'],'white',.004)
    for s,n in [(1,'l'),(-1,'r')]:
        wing(a,'Shoulder cargo tray B-2 half','wing_'+n,[(0,.75),(s*3.5,-1.32),(s*1.9,-1.08),(s*1.7,-.81),(0,-1.10)],(0,0,0),'armor',.18)
        a.strut('Tray warning rim','wing_'+n,(0,.13,.73),(s*3.45,.13,-1.3),.033,'white')
        a.tube('Shared hand rotor shield rim','rotor_hinge_'+n,1.0,.88,.16,(0,0,0),'armor',segments=32)
        a.tube('Rotor shield black inner lip','rotor_hinge_'+n,.91,.86,.18,(0,0,0),'dark',segments=32)
        a.disk('Rotor shield hub','rotor_'+n,.18,.27,(0,0,0),'steel')
        for i in range(8):
            for j in range(3):
                radius=.90-j*.30
                angles=[-math.pi/8-.015,0,math.pi/8+.015]
                corners=[(radius*math.cos(d)-radius,radius*math.sin(d)) for d in angles]
                corners += [((radius-.30)*math.cos(d)-radius,(radius-.30)*math.sin(d)) for d in reversed(angles)]
                node=f'shield_cover_{n}_{i}'+('' if j==0 else '_'+str(j))
                a.plate('Solid retractable rotor shield petal',node,corners,.04,(0,0,.12),'armor')
        for i in range(3):
            ang=i*math.tau/3
            a.strut('Shared three blade tilt rotor','rotor_'+n,(.12*math.cos(ang),.12*math.sin(ang),0),(.88*math.cos(ang),.88*math.sin(ang),0),.078,'dark')
            a.strut('Rotor blade ivory tip','rotor_'+n,(.75*math.cos(ang),.75*math.sin(ang),.02),(.87*math.cos(ang),.87*math.sin(ang),.02),.042,'white')
        for i in range(10):
            a.disk('Exposed shoulder tray rivet','wing_'+n,.022,.025,(s*(.16+i*.21),.115,.53-i*.12),'steel','y',8)
        for row in range(4):
            for col in range(6):
                x=s*(.24+col*.28);z=.30-row*.28-col*.15
                a.box('Deterministic digital camouflage patch','wing_'+n,(.18,.012,.13),(x,.105,z),'shade' if (row+col)%3 else 'dark',0)
        for i in range(5):
            a.box('Chest worn digital camo','chest',(.17,.12,.018),(s*(.22+i*.12),.52+(i%2)*.26,.624),'shade',.002)
    a.plate('Atlas chest warning chevron','chest',[(-.35,.13),(0,-.08),(.35,.13),(.35,.05),(0,-.17),(-.35,.05)],.015,(0,.96,.63),'white')


def whale(a):
    c=a.spec['cavity']
    rounded_hull(a,'Turquoise whale dorsal armor','spine',[(z,w*1.03,h*1.03) for z,w,h in c['sections']],(0,0,0),'armor')
    rounded_hull(a,'Shared neckless whale elephant head','head',
                 [(-.95,1.80,1.40),(-.48,2.25,1.64),(.25,2.18,1.57),(.88,1.45,1.12),(1.24,.64,.62)],
                 (0,0,0),'armor')
    for s,n in [(1,'l'),(-1,'r')]:
        a.plate('Elephant ear phased radar fin','ear_'+n,[(0,-.42),(s*1.76,-.28),(s*1.50,.64),(s*.38,.74)],.10,(0,0,0),'shade')
        a.plate('Luminous ear radar matrix','ear_'+n,[(s*.24,-.24),(s*1.43,-.13),(s*1.20,.43),(s*.36,.54)],.018,(0,0,.067),'cyan')
        for i in range(7):
            a.strut('Radar array cell row','ear_'+n,(s*.35,-.15+i*.085,.08),(s*1.13,-.06+i*.061,.08),.013,'armor')
        path=[(0,0,0),(s*.2,-.55,.50),(s*.48,-.58,1.1),(s*.70,-.22,1.50),(s*.76,.19,1.59)]
        for i,(start,end) in enumerate(zip(path,path[1:])):
            a.strut('Shared crescent ivory tusk','tusk_'+n,start,end,.17-i*.035,'white')
        a.plate('Whale turquoise sensor eye','head',[(s*.5,.40),(s*.97,.49),(s*.84,.21),(s*.57,.19)],.018,(0,0,1.04),'glow')
        for i in range(7):
            fraction=.12+i*.105
            path=[(s*w*.515*fraction,-h*.515*math.sqrt(1-fraction*fraction),z)
                  for z,w,h in c['sections'][1:-1]]
            for start,end in zip(path,path[1:]):
                a.strut('Whale ventral longitudinal rib','spine',start,end,.022,'dark')
        for i in range(4):
            a.strut('Symmetric feather tattoo stroke','spine',(s*1.65,.12,-.75+i*.18),(s*1.65,.40,-.31+i*.13),.018,'shade')
    for i in range(6):
        r=.40-i*.057
        a.loft('Shared trunk spiral horn segment','trunk_'+str(i),[(0,r,r),(.40,r*.87,r*.87)],'armor',axis='z')
        a.tube('Trunk conducting spiral ring','trunk_'+str(i),r*.51,r*.45,.05,(0,0,.18),'steel',segments=16)
    spike(a,'Shared horn terminal point','trunk_5',(0,0,.35),(0,0,1.15),.055,'cyan')
    a.loft('Dorsal command bridge','spine',[(-.6,.8,.65),(.3,.6,.44),(.70,.45,.25)],'shade',(0,.95,-.85))
    a.box('Bridge panoramic windows','spine',(.62,.14,.24),(0,1.39,-.55),'cyan',.025)
    a.tube('Bridge radar annulus','cast_dish',.34,.23,.06,(0,0,0),'steel')
    for i,name in enumerate(a.spec['rig']['tailSegs']):
        width=.64-i*.105
        rounded_hull(a,'Streamlined whale caudal armor',name,
                     [(-.40,width-.105,(width-.105)*.78),(.025,width,width*.78)],(0,0,0),'armor')
    for s in [-1,1]:
        wing(a,'Whale tail fluke','tail_4',[(0,0),(s*1.15,-.64),(s*.77,-.72),(0,-.32)],(0,0,0),'armor',.07)


def raptor(a):
    rounded_hull(a,'Tapered horizontal raptor rib cage','chest',[(-1.06,.47,.48),(-.68,.90,.83),
                 (-.12,1.02,.96),(.39,.77,.83),(.69,.43,.54)],(0,-.02,-.04),'armor')
    path = [(0,0,0),(0,.31,.18),(0,.48,.40),(0,.42,.66)]
    for i,(start,end) in enumerate(zip(path,path[1:])):
        a.strut('S curved cervical load column','neck',start,end,.11,'steel')
        ellipsoid(a,'Overlapping S neck vertebral armor','neck',(.34-i*.025,.31,.38),
                  tuple((x+y)/2 for x,y in zip(start,end)),'armor',12,6)
    rounded_hull(a,'Long low upturned velociraptor skull','head',
                 [(-.15,.34,.37,.02),(.06,.58,.46,.05),(.35,.50,.39,.02),
                  (.74,.32,.23,-.02),(1.18,.28,.23,.025),(1.38,.23,.20,.065)],(0,0,0),'armor')
    rounded_hull(a,'Slender velociraptor lower jaw','head',
                 [(-.04,.43,.14),(.46,.35,.11),(1.28,.22,.075)],(0,-.25,0),'shade')
    for s in [-1,1]:
        a.disk('Raptor recessed orbit','head',.12,.035,(s*.25,.13,.23),'dark','x')
        a.disk('Raptor red gold eye','head',.070,.04,(s*.267,.13,.23),'glow','x')
        a.disk('Raptor nostril','head',.025,.035,(s*.14,.075,1.16),'dark','x',8)
        for i in range(9):
            x=s*(.22-i*.012)
            spike(a,'Raptor upper tooth','head',(x,-.12,.22+i*.12),(x,-.22,.22+i*.12),.027,'white')
            spike(a,'Raptor lower tooth','head',(x,-.23,.23+i*.12),(x,-.17,.23+i*.12),.021,'white')
    for i,name in enumerate(a.spec['rig']['tailSegs']):
        width=.58-i*.105
        rounded_hull(a,'Continuous tapered raptor counterbalance tail',name,
                     [(-.89,max(.028,width-.105),max(.028,width-.105)*.74),(.02,width,width*.74)],
                     (0,0,0),'armor')
        for s,n in [(1,'l'),(-1,'r')]:
            wing(a,'Paired archaeopteryx tail feather',f'tail_feather_{n}_{i}',
                 [(s*.04,0),(s*.28,-.10),(s*.57,-.68),(s*.16,-.58)],(0,.04,0),'armor',.045)
    feathers(a)


def insect_legs(a):
    positions = {name: at for name, _, at in a.spec['joints']}
    for leg in a.spec['rig']['insectLegs']:
        key, side = leg['key'], leg['side']
        root, trochanter, femur = leg['root'], 'trochanter_'+key, leg['lift']
        a.strut('Thoracic insect coxa',root,(0,0,0),positions[trochanter],.10,'shade')
        a.strut('Short insect trochanter',trochanter,(0,0,0),positions[femur],.065,'steel')
        for owner, end, width, label in [(femur,'knee_'+key,.24 if key[0]=='H' else .19,'Insect femur'),
                                        ('knee_'+key,'ankle_'+key,.31 if key[0]=='F' else .13,'Insect tibia')]:
            delta=positions[end]
            length=Vector(delta).length
            obj=a.loft(label,owner,[(0,width*.55,width*.6),(length*.23,width,width*.75),
                        (length*.90,width*.62,width*.45)],'armor')
            obj.rotation_euler=Vector((delta[0],-delta[2],delta[1])).to_track_quat('Z','Y').to_euler()
            a.disk(label+' hinge',owner,width*.30,width*.6,(0,0,0),'steel','z',10)
            if owner.startswith('knee'):
                for i in range(3 if key[0]=='F' else 4):
                    at=tuple(v*(.28+i*.16) for v in delta)
                    reach=.17 if key[0]=='F' else .055
                    spike(a,'Broad digging tibial tooth' if key[0]=='F' else 'Walking tibial spine',owner,
                          at,(at[0]+side*reach,at[1]-.04,at[2]),.05 if key[0]=='F' else .018,'steel')
        owners=['ankle_'+key]+['tarsal_'+key+'_'+str(i) for i in range(1,5)]
        ends=owners[1:]+['pretarsus_'+key]
        for i,(owner,end) in enumerate(zip(owners,ends)):
            a.strut('Articulated insect tarsomere '+str(i+1),owner,(0,0,0),positions[end],.035-i*.003,'steel')
        for s in [-1,1]:
            spike(a,'Paired pretarsal claw','pretarsus_'+key,(0,0,s*.022),
                  (side*.095,-.055,s*.065),.022,'steel')


def beetle(a):
    ellipsoid(a,'Three segment armored insect abdomen','spine',(2.50,1.43,2.60),(0,.12,-.64),'shade',20,10)
    ellipsoid(a,'Insect pronotum no neck','chest',(2.20,1.25,1.35),(0,.27,.13),'armor',20,10)
    ellipsoid(a,'Insect head directly on thorax','head',(1.16,.81,.83),(0,.05,.25),'armor',16,8)
    path=[(0,.1,.55),(0,.65,.85),(0,1.35,1.12),(0,1.98,1.10),(0,2.28,.94)]
    for i,(start,end) in enumerate(zip(path,path[1:])):
        a.strut('Large curved metallic rhinoceros horn','head',start,end,.19-i*.039,'steel')
    for s,n in [(1,'l'),(-1,'r')]:
        a.disk('Blue compound insect eye','head',.20,.12,(s*.50,.13,.25),'glow','x')
        spike(a,'Insect mouth mandible','head',(s*.27,-.24,.58),(s*.44,-.32,.88),.095,'dark')
        # A thick convex half shell rotates as protective armor, never as a flap driver.
        a.loft('Shared heavy protective elytron','elytra_'+n,[(-1.55,.76,.33),(-1.1,1.25,.58),(.65,1.26,.62),(.94,.64,.40)],'armor',(s*.56,.14,0),'z')
        for i in range(3):
            a.strut('Geometric beetle totem','elytra_'+n,(s*(.25+i*.13),.47,-1.1),(s*(.25+i*.13),.52,.42-i*.12),.014,'cyan')
        for pair in range(2):
            root=f'membrane_{n}_{pair}'
            for part,span,at in [(root+'_flap',1.3,(0,0,0)),(root+'_outer',1.6,(0,0,0))]:
                wing(a,'Transparent insect propulsion membrane',part,[(0,.13),(s*span,.30),(s*(span+.15),-.26),(s*.15,-.51)],at,'membrane',.013)
                for i in range(3):
                    a.strut('Insect membrane vein',part,(0,.01,.04),(s*span,.01,.24-i*.23),.014,'steel')
    for i in range(4):
        a.tube('Insect ventral abdominal segment','spine',.65-i*.05,.60-i*.05,.038,(0,-.5,-.25-i*.37),'steel',segments=20)


def patagium(a):
    outline=a.p['membraneOutline']
    cuts=a.p['membraneCuts']
    fold=a.p['membraneFoldY']
    def clip(poly,axis,bound,above):
        result=[]
        for start,end in zip(poly,poly[1:]+poly[:1]):
            ins=(start[axis]>=bound) if above else (start[axis]<=bound)
            ine=(end[axis]>=bound) if above else (end[axis]<=bound)
            if ins:
                result.append(start)
            if ins!=ine:
                u=(bound-start[axis])/(end[axis]-start[axis])
                result.append([start[i]+(end[i]-start[i])*u for i in range(2)])
        return result
    for s,n in [(1,'l'),(-1,'r')]:
        # Accordion cells preserve the membrane inventory while packing it behind the ground chest.
        for row in ['upper','lower']:
            poly=clip(outline,1,fold,row=='upper')
            for i,(lo,hi) in enumerate(zip(cuts,cuts[1:])):
                points=clip(clip(poly,0,lo,True),0,hi,False)
                node=('wing_'+n if row=='upper' else 'mem_lower_'+n) if i==0 else f'mem_{row}_{n}_{i}'
                offset=0 if row=='upper' else fold
                local=[(s*(x-lo),y-offset) for x,y in points]
                a.plate('Shared flying squirrel patagium cell',node,local,.017,(0,0,0),'membrane')
                for start,end in zip(local,local[1:]+local[:1]):
                    a.strut('Patagium tension edge',node,(*start,.01),(*end,.01),.012,'cyan')
        vents(a,'shoulder_'+n,(0,-.1,.29),.34,3,'brass')


def weapons(a):
    id=a.spec['id']
    light_len=a.nodes['light_muzzle'].location.y*-1
    heavy_len=a.nodes['heavy_muzzle'].location.y*-1
    if id=='s03':
        a.box('Ear radar beam receiver','gun_recoil',(.29,.18,.25),(0,0,.08),'shade',.025)
        a.disk('High frequency beam aperture','gun_recoil',.10,.028,(0,0,light_len),'cyan')
        a.box('Forehead microwave emitter matrix','heavy_recoil',(.42,.22,.23),(0,0,.06),'shade',.03)
        for x in [-.12,0,.12]:
            a.disk('Forehead phased microwave cell','heavy_recoil',.055,.02,(x,0,.19),'glow',segments=8)
    elif id=='t06':
        a.tube('Long handheld golden plasma staff','heavy_recoil',.085,.047,4.4,(0,0,0),'steel',segments=16)
        for z in [-2.08,-1.87,1.84,2.06]:
            a.tube('Plasma staff golden terminal ring','heavy_recoil',.14,.088,.14,(0,0,z),'brass')
        a.tube('Plasma staff open crown muzzle','heavy_recoil',.135,.085,.12,(0,0,2.18),'glow')
        a.box('Micro silent chest gun','gun_recoil',(.19,.22,.34),(0,0,.1),'shade',.02)
        a.tube('Micro silent chest barrel','gun_recoil',.075,.032,.76,(0,0,.55),'dark',segments=10)
    elif id=='m05':
        a.box('Back right folded three barrel receiver','gun_recoil',(.59,.40,.67),(0,0,.13),'shade',.07)
        for i in range(3):
            angle=i*math.tau/3
            a.tube('Right triple electromagnetic barrel','gun_recoil',.095,.062,1.30,(.18*math.cos(angle),.18*math.sin(angle),.85),'steel',segments=12)
        a.box('Back left micro missile pod','heavy_recoil',(.55,.42,.67),(0,0,.1),'armor',.06)
        for x in [-.14,.14]:
            for y in [-.10,.10]:
                a.tube('Micro missile launch cell','heavy_recoil',.086,.062,.60,(x,y,.38),'steel',segments=10)
    elif id=='m08':
        a.box('Ventral suppressed microburst receiver','gun_recoil',(.27,.20,.4),(0,0,.07),'shade',.04)
        a.tube('Microburst gun suppressor','gun_recoil',.10,.040,.62,(0,0,.60),'dark')
        for s in [-1,1]:
            a.box('Symmetric shoulder anti-materiel sniper receiver','heavy_recoil',(.34,.29,.78),(s*.65,0,.13),'shade',.035)
            a.tube('Long matte sniper barrel','heavy_recoil',.055,.030,1.35,(s*.65,0,1.20),'steel')
            a.tube('Heavy sniper suppressor','heavy_recoil',.105,.043,.46,(s*.65,0,2.12),'dark')
            a.tube('Shoulder sniper sight','heavy_recoil',.095,.056,.45,(s*.65,.24,.17),'dark')
            a.disk('Muted blue sniper lens','heavy_recoil',.055,.02,(s*.65,.24,.40),'glow')
    else:
        if id=='m07':
            a.disk('Dorsal central twin AA turret','heavy',.43,.23,(0,-.04,0),'armor','y',20)
            count=2
            for s in [-1,1]:
                a.tube('Mouth defense plasma nozzle','gun_recoil',.13,.09,.36,(s*.38,-.12,.50),'steel')
        else:
            count=2 if id=='t11' else 1
            a.box('Forward dorsal weapon receiver','heavy_recoil',(.42,.36,.65),(0,0,.15),'shade',.04)
            a.box('Short laser or machine gun receiver','gun_recoil',(.38,.32,.53),(0,0,.16),'shade',.03)
            for i in range(2 if id=='t11' else 1):
                a.tube('Twin tray top machine gun barrel' if id=='t11' else 'Short dorsal phase laser barrel','gun_recoil',.071,.040,light_len-.25,((i-.5)*.18 if id=='t11' else 0,0,(light_len+.25)/2),'steel')
        for i in range(count):
            x=(i-.5)*.3 if count==2 else 0
            a.tube('Twin 35mm anti-aircraft open barrel' if id=='m07' else 'Tray top recoilless cannon' if id=='t11' else 'Long dorsal electromagnetic lance tube',
                   'heavy_recoil',.105 if id!='s10' else .09,.06,heavy_len-.28,(x,0,(heavy_len+.28)/2),'steel')
        if id=='s10':
            spike(a,'Electromagnetic dorsal lance tip','heavy_recoil',(0,0,heavy_len-.16),(0,0,heavy_len+.43),.10,'brass')
    a.box('Articulated charge shutter','charge_hinge',(.32,.06,.28),(0,0,0),'armor',.018)
    for name in ['light_muzzle','heavy_muzzle']:
        a.disk('Weapon muzzle energy aperture',name,.025,.01,(0,0,0),'glow')


def morpher(a):
    armor_cavity(a)
    limb_inventory(a)
    if a.spec['rig'].get('tailSegs') and a.spec['id'] not in ['s03','s10']:
        tails(a)
    id=a.spec['id']
    if a.spec['kind']=='biped':
        biped_body(a)
    if id=='s03':
        whale(a)
    elif id=='s10':
        raptor(a)
    elif id=='t06':
        monkey_head(a)
        for s,n in [(1,'l'),(-1,'r')]:
            a.loft('Shared retractable monkey jet pack','wing_'+n,[(-.30,.44,.44),(.61,.48,.48)],'armor')
            a.tube('Shared monkey propulsion nozzle','wing_'+n,.19,.135,.21,(0,-.37,0),'brass','y')
            a.disk('Golden plasma nozzle core','wing_'+n,.13,.023,(0,-.49,0),'glow','y')
            a.plate('Curved cloud wing chine','wing_'+n,[(0,.35),(s*.9,.24),(s*1.3,-.43),(s*.8,-.60),(0,-.45)],.08,(0,0,-.16),'brass')
        exhaust(a)
    elif id=='t11':
        atlas(a)
    elif id=='m05':
        wolf_head(a)
        patagium(a)
    elif id=='m07':
        beetle(a)
    elif id=='m08':
        feline_head(a)
        feathers(a)
        for s in [-1,1]:
            for i in range(6):
                a.box('Faint deterministic night digital camo','chest',(.18,.018,.12),(s*.72,.69,.28-i*.20),'shade',0)
    weapons(a)
    for n in ['l','r']:
        a.loft('Independent retractable shield emitter','emitter_'+n,[(0,.13,.14),(.46,.12,.11),(.57,.04,.04)],'shade')
        a.box('Shield luminous emitter rail','emitter_'+n,(.027,.35,.02),(0,.26,.09),'cyan',.003)
    a.barrier('barrier',1.50 if a.spec['kind']=='biped' else 1.9,1.65 if a.spec['kind']=='biped' else 1.18)
    a.tube('Articulated skill charge annulus','cast_dish',.22,.15,.055,(0,0,0),'cyan')


def rounded_hull(a, name, parent, sections, at, material):
    count=24
    vertices=[(math.cos(i*math.tau/count)*section[1]/2,
               math.sin(i*math.tau/count)*section[2]/2+(section[3] if len(section)>3 else 0),section[0])
              for section in sections for i in range(count)]
    faces=[tuple(reversed(range(count))),tuple(range(len(vertices)-count,len(vertices)))]
    faces += [(k*count+i,k*count+(i+1)%count,(k+1)*count+(i+1)%count,(k+1)*count+i)
              for k in range(len(sections)-1) for i in range(count)]
    return a.mesh(name,parent,vertices,faces,material,at)


def exhaust(a):
    # Diagnostic effects stay outside export batches, just as the destination uses its existing jet driver.
    start=len(a.parts)
    for entry in a.spec['motion']['jets']:
        node=entry['node']
        x,y,z=entry['position']
        length=entry['length']*entry['lenF']['hold']*.35
        a.loft('Diagnostic plasma exhaust',node,[(-length,.012,.012),(0,entry['radius']*2,entry['radius']*2)],'glow',(x,y,z))
        r=entry['cloud']['radius']
        for i in range(entry['cloud']['count']):
            u=i/(entry['cloud']['count']-1);angle=i*2.399
            radius=r*(.55+.75*math.sin(math.pi*(.25+.75*u)))
            ellipsoid(a,'Diagnostic condensation cloud',node,(radius*2.3,radius*1.44,radius*2.3),
                      (x+math.cos(angle)*r*(.35+.9*u),y-length-u*r*3.4,z+math.sin(angle)*r*(.35+.9*u)),'vapor',12,6)
    a.exhaust=a.parts[start:]
    del a.parts[start:]
