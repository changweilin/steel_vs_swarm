"""Reference-specific construction; dimensions and articulation belong to assets.json."""
import math


def ellipsoid(a, name, parent, size, at, material, segments=16, rings=8):
    vertices = []
    for j in range(rings + 1):
        phi = math.pi * j / rings
        for i in range(segments):
            theta = math.tau * i / segments
            vertices.append((size[0] * .5 * math.sin(phi) * math.cos(theta),
                             size[1] * .5 * math.cos(phi), size[2] * .5 * math.sin(phi) * math.sin(theta)))
    faces = []
    for j in range(rings):
        for i in range(segments):
            q = (j * segments + i, j * segments + (i + 1) % segments,
                 (j + 1) * segments + (i + 1) % segments, (j + 1) * segments + i)
            faces.append((q[0], q[2], q[3]) if j == 0 else (q[0], q[1], q[2]) if j == rings - 1 else q)
    return a.mesh(name, parent, vertices, faces, material, at)


def wing(a, name, parent, points, at, material, depth=.08):
    n = len(points)
    vertices = [(x, y, z) for y in [-depth / 2, depth / 2] for x, z in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return a.mesh(name, parent, vertices, faces, material, at, .012 if depth > .06 else 0)


def spike(a, name, parent, start, end, radius, material):
    direction = [end[i] - start[i] for i in range(3)]
    length = math.sqrt(sum(v * v for v in direction))
    obj = a.loft(name, parent, [(0, radius * 2, radius * 2), (length * .7, radius, radius), (length, .012, .012)], material)
    # Local loft Y is Blender Z; rotation is baked into the exported joint batch.
    from mathutils import Vector
    vector = Vector((direction[0], -direction[2], direction[1]))
    obj.rotation_euler = vector.to_track_quat('Z', 'Y').to_euler()
    obj.location = Vector((start[0], -start[2], start[1]))
    return obj


def vents(a, parent, at, width, count=5, material='dark'):
    for i in range(count):
        a.box('Separated cooling louver', parent, (width, .04, .055), (at[0], at[1] + i * .09, at[2]), material, .008)


def limb_segment(a, parent, delta, width, armor='armor', soft=False):
    length = math.sqrt(sum(v * v for v in delta))
    a.strut('Exposed load-bearing piston', parent, (0, 0, 0), delta, width * .4, 'dark' if soft else 'steel')
    for k in [.18, .48, .77]:
        center = tuple(v * k for v in delta)
        if soft:
            ellipsoid(a, 'Overlapping tentacle sleeve', parent, (width, width, width), center, armor, 10, 4)
            a.disk('Ventral sucker ring', parent, width * .22, .05, (center[0], center[1] - width * .36, center[2]), 'brass', 'y', 8)
        else:
            size = (width, length * .2, width * .88)
            obj = a.box('Segmented limb armor', parent, size, center, armor, .04)
            from mathutils import Vector
            obj.rotation_euler = Vector((delta[0], -delta[2], delta[1])).to_track_quat('Z', 'Y').to_euler()
    a.disk('Mechanical joint collar', parent, width * .6, width * .9, (0, 0, 0), 'dark', 'x')
    a.disk('Joint axle cap', parent, width * .3, width * .98, (0, 0, 0), 'brass', 'x')


def ground_legs(a):
    p, r = a.p, a.spec['recipe']
    soft = r == 'octopod'
    for leg in p['legs']:
        owner = leg['root']
        widths = p.get('legWidths', {}).get('fore' if 'F' in owner else 'hind')
        for i, delta in enumerate(leg['deltas']):
            width = p['limb'] * (widths[i] if widths else 1-i*.12)
            if p.get('legAnatomy'):
                animal_limb(a, owner, delta, width, 'fore' if 'F' in leg['root'] else 'hind', i)
            else:
                limb_segment(a, owner, delta, width, soft=soft)
            owner = next(n for n, parent, _ in a.spec['joints'] if parent == owner)
        if soft:
            ellipsoid(a, 'Support tentacle contact pad', owner, (.26, .14, .5), (0, -.02, .15), 'shade')
        elif r == 'centaur':
            a.loft('Split armored hoof', owner, [(-.18, .42, .54), (.08, .3, .35)], 'dark', (0, 0, .08))
            a.box('Hoof split', owner, (.035, .25, .25), (0, -.03, .23), 'steel', .005)
        elif r == 'hound':
            a.box('Canine paw', owner, (.4, .22, .62), (0, -.08, .12), 'shade')
            for x in [-.12, 0, .12]: spike(a, 'Paw claw', owner, (x, -.08, .3), (x, -.14, .5), .035, 'steel')
        elif r == 'stego':
            ellipsoid(a, 'Elephantine foot armor', owner, (.78, .35, .85), (0, -.08, .1), 'armor')
            for x in [-.24, 0, .24]: a.box('Foot nail', owner, (.16, .16, .18), (x, -.12, .43), 'brass')
        else:
            long = 1.3 if r == 'roo' else .95 if r in ['crane', 'trex'] else .65
            a.loft('Articulated armored foot', owner, [(-.16, p['limb'] * 1.1, long), (.1, p['limb'] * .65, long * .65)], 'shade', (0, -.02, long * .32))
            if r in ['crane', 'trex']:
                for x in [-.22, 0, .22]: spike(a, 'Bird digit claw', owner, (x, -.05, long * .6), (x * 1.25, -.16, long * .95), .06, 'brass')
            if r == 'roo':
                for i in range(5): a.tube('Achilles energy spring', owner, .14, .105, .04, (0, .2 + i * .12, -.18), 'brass', 'y', 12)


def animal_limb(a, parent, delta, width, role, segment):
    from mathutils import Vector
    names = ['Humerus', 'Radius ulna', 'Metacarpal'] if role == 'fore' else ['Femur', 'Tibia fibula', 'Metatarsal']
    length = Vector(delta).length
    if segment == 1:
        # Paired forearm rods and the slender fibula remain visible between armor plates.
        for side in [-1, 1]:
            at = side * width * .23
            a.strut(names[segment] + ' paired load rod', parent, (at, 0, 0),
                    (delta[0] + at, delta[1], delta[2]), width * (.17 if role == 'fore' else .12), 'steel')
    else:
        a.strut(names[segment] + ' load rod', parent, (0, 0, 0), delta, width * .30, 'steel')
    # A broad proximal thigh, narrow shin and long exposed hock distinguish the hind limb.
    shape = [(length*.08, width*.72, width*.70), (length*.30, width*1.35, width*1.05),
             (length*.73, width*.82, width*.75), (length*.95, width*.48, width*.45)]
    if segment == 2:
        shape = [(length*.08, width, width*.70), (length*.88, width*.62, width*.50)]
    shell = a.loft(names[segment] + ' anatomical armor', parent, shape, 'armor')
    shell.rotation_euler = Vector((delta[0], -delta[2], delta[1])).to_track_quat('Z', 'Y').to_euler()
    a.disk(names[segment] + ' hinge', parent, width*.42, width*.92, (0, 0, 0), 'dark', 'x', 12)
    if segment == 1:
        at = (0, .04, -width*.54 if role == 'fore' else width*.54)
        ellipsoid(a, 'Olecranon elbow projection' if role == 'fore' else 'Forward stifle cap',
                  parent, (width*.7, width*.65, width*.7), at, 'armor', 10, 4)
    elif segment == 2 and role == 'hind':
        spike(a, 'Raised calcaneal heel', parent, (0, 0, 0), (0, width*.85, -width*.65), width*.26, 'steel')


def tails(a):
    p, r = a.p, a.spec['recipe']
    if r == 'octopod':
        return
    nodes = a.spec['rig'].get('tailSegs', [])
    for i, name in enumerate(nodes):
        delta = p['tail'][i + 1] if i + 1 < len(p['tail']) else (0, -.14, -.6)
        width = (p.get('width', 1) * (.6 if r in ['roo', 'trex'] else .35)) * (1 - i / (len(nodes) + 1))
        a.strut('Tail segmented core', name, (0, 0, 0), delta, max(.09, width * .6), 'shade')
        ellipsoid(a, 'Overlapping tail scale', name, (width, width * .8, abs(delta[2]) * 1.2), tuple(v * .35 for v in delta), 'armor')
        a.tube('Tail articulation ring', name, max(.08, width * .45), max(.04, width * .32), .06, (0, 0, 0), 'brass', segments=12)
    if r == 'stego':
        for side in [-1, 1]:
            for y in [-.12, .15]: spike(a, 'Stegosaur tail spike', nodes[-1], (side * .08, y, -.1), (side * .5, y + .18, -.85), .14, 'brass')
    if r == 'dragon':
        for i, n in enumerate(nodes):
            spike(a, 'Dragon tail crest', n, (0, .15, 0), (0, .6 - i * .06, -.3), .14, 'red')


def arms(a, chest='chest'):
    p, r = a.p, a.spec['recipe']
    if r == 'crane':
        for side, n in [(1, 'l'), (-1, 'r')]:
            root = 'shoulder_' + n
            ellipsoid(a, 'Folded bird scapula', root, (.65, .8, .85), (0, -.25, -.05), 'armor')
            for i in range(7):
                a.plate('Independent folded feather', root, [(-.08, 0), (.09, 0), (.15, -1.3 + i * .09), (-.07, -1.45 + i * .1)], .055,
                        (side * (.1 + i * .045), -.1, -.25 + i * .11), 'armor' if i % 2 else 'shade')
        return
    for side, n in [(-1, 'r'), (1, 'l')]:
        shoulder, elbow, wrist = 'shoulder_' + n, 'elbow_' + n, 'wrist_' + n
        positions = {name: pos for name, _, pos in a.spec['joints']}
        width = p['limb'] * (.6 if r == 'roo' else .38 if r == 'trex' else 1)
        if r == 'bastion': ellipsoid(a, 'Giant white ball shoulder', shoulder, (1.55, 1.65, 1.65), (side * .12, .12, 0), 'armor')
        elif r == 'colossus':
            a.box('Shoulder reactor armor', shoulder, (1.25, 1.3, 1.3), (side * .1, .15, -.05), 'armor', .17)
            vents(a, shoulder, (0, -.23, .67), .9, 6)
        else: ellipsoid(a, 'Articulated shoulder armor', shoulder, (width * 1.8, width * 1.65, width * 1.7), (0, 0, 0), 'shade')
        limb_segment(a, shoulder, positions[elbow], width)
        limb_segment(a, elbow, positions[wrist], width * .9)
        if r == 'trex':
            for x in [-.09, .09]: spike(a, 'Short empty foreclaw', wrist, (x, 0, .04), (x, -.17, .25), .05, 'brass')
        else:
            a.box('Armored palm', wrist, (width * 1.1, width * .7, width * .65), (0, -.1, .06), 'shade')
            for i in range(4):
                a.box('Individual armored finger', wrist, (width * .17, width * .6, width * .22), ((i - 1.5) * width * .24, -width * .48, width * .25), 'armor', .01)
        if r == 'bastion':
            a.box('Russian blue shoulder band', shoulder, (.3, .82, .05), (side * .45, .1, .75), 'blue')
            a.box('Russian red shoulder band', shoulder, (.3, .82, .05), (side * .1, .1, .75), 'red')
        if r == 'seraph':
            for j in range(3): a.strut('Exposed brown muscle cable', shoulder, (side * (.09 + j * .06), -.12, .16), (side * (.06 + j * .04), -.75, .22), .05, 'shade')


def eyes(a, parent, at, width=.42, red=False):
    for side in [-1, 1]:
        a.box('Sensor socket', parent, (width * .5, .15, .08), (side * width * .48, at[1], at[2]), 'dark', .014)
        a.box('Luminous mechanical eye', parent, (width * .35, .065, .028), (side * width * .48, at[1], at[2] + .055), 'red' if red else 'glow', .008)


def animal_head(a):
    r = a.spec['recipe']
    if r == 'crane':
        # The neck is segmented in the chest frame; its head pivot stays at the chain endpoint.
        h = next(pos for name, _, pos in a.spec['joints'] if name == 'head')
        pts = [(0, 0, .4), (0, .6, .55), (0, 1.25, .18), (0, 1.8, -.15), tuple(h)]
        for i in range(len(pts) - 1):
            a.strut('S-curve bird neck piston', 'chest', pts[i], pts[i + 1], .16, 'dark')
            ellipsoid(a, 'Bird neck armor collar', 'chest', (.32, .38, .34), pts[i + 1], 'armor', 12, 6)
        a.loft('Crane wedge skull', 'head', [(-.2, .34, .28), (.15, .3, .28), (.45, .08, .1)], 'armor', axis='z')
        spike(a, 'Sharp bird beak', 'head', (0, -.03, .32), (0, -.05, .9), .12, 'steel')
        a.box('Red crown', 'head', (.2, .08, .25), (0, .19, .03), 'red')
        spike(a, 'Swept head crest', 'head', (0, .16, -.12), (0, .32, -.65), .12, 'dark')
        eyes(a, 'head', (0, .06, .18), .27)
    elif r in ['hound', 'roo', 'trex']:
        size = (.65, .5, .85) if r == 'hound' else (.57, .7, .75) if r == 'roo' else (1.2, .9, 1.5)
        ellipsoid(a, 'Mechanical animal skull', 'head', size, (0, .1, .15), 'armor')
        a.loft('Long armored snout', 'head', [(.25, size[0], size[1] * .6), (.8 if r != 'trex' else 1.15, size[0] * .65, size[1] * .5)], 'shade', axis='z')
        a.box('Jaw separation', 'head', (size[0] * .7, .07, .65), (0, -.17, .6), 'dark')
        eyes(a, 'head', (0, .25, .5), size[0] * .7)
        if r == 'roo':
            for side in [-1, 1]:
                a.plate('Long kangaroo ear', 'head', [(-.13, 0), (-.12, .75), (.02, 1.1), (.12, .68), (.13, 0)], .16, (side * .24, .34, -.12), 'armor')
                a.plate('Dark inner ear', 'head', [(-.065, 0), (0, .72), (.065, 0)], .025, (side * .24, .5, -.01), 'shade')
        else:
            for side in [-1, 1]:
                for j in range(6 if r == 'trex' else 4):
                    z = .32 + j * .14
                    spike(a, 'Interlocking metal tooth', 'head', (side * size[0] * .32, -.04, z), (side * size[0] * .3, -.23, z + .025), .045 if r == 'hound' else .075, 'steel')
            if r == 'hound':
                for x in [-.19, 0, .19]: a.box('Triple red eye band', 'head', (.1, .075, .04), (x, .25, .62), 'glow')
    elif r == 'gorilla':
        ellipsoid(a, 'Rounded ape skull', 'head', (.95, 1.0, .9), (0, .05, .05), 'shade')
        a.box('Ape armored brow', 'head', (.88, .22, .27), (0, .3, .42), 'armor', .07)
        a.box('Broad ape muzzle', 'head', (.67, .38, .28), (0, -.08, .45), 'dark', .07)
        eyes(a, 'head', (0, .12, .5), .6)
    elif r == 'stego':
        a.loft('Low herbivore wedge head', 'head', [(-.2, .72, .65), (.6, .35, .38)], 'armor', axis='z')
        eyes(a, 'head', (0, .16, .25), .52)


def ground(a):
    p, r, kind = a.p, a.spec['recipe'], a.spec['kind']
    carrier = 'spine' if kind == 'quad' else 'hips'
    positions = {name: pos for name, _, pos in a.spec['joints']}
    if kind == 'biped' and r != 'crane':
        start = (0, .3, p['length'] * .3) if r == 'trex' else (0, .65, .05)
        end = positions['head']
        a.strut('Visible cervical actuator', 'chest', start, end, .38 if r == 'trex' else .2, 'dark')
        center = tuple((start[i] + end[i]) / 2 for i in range(3))
        ellipsoid(a, 'Armored neck coupling', 'chest', (.7, .55, .8) if r == 'trex' else (.32, .32, .32), center, 'shade', 12, 6)
    elif r in ['hound', 'stego']:
        end = tuple(positions['neck'][i] + positions['head'][i] for i in range(3))
        a.strut('Quadruped cervical actuator', 'chest', (0, .05, .1), end, .25, 'dark')
        ellipsoid(a, 'Quadruped armored neck coupling', 'chest', (.46, .4, .7), tuple(v * .6 for v in end), 'shade', 12, 6)
    elif r == 'centaur':
        end = tuple(positions['hum_neck'][i] + positions['head'][i] for i in range(3))
        a.strut('Knight cervical actuator', 'hum_chest', (0, .65, 0), end, .2, 'dark')
    if r == 'octopod':
        ellipsoid(a, 'Faceless armored mantle', carrier, (p['width'], 2.9, p['length']), (0, .75, 0), 'armor', 20, 10)
        for i in range(8):
            th = math.tau * i / 8
            a.strut('Gold mantle totem rib', carrier, (.35 * math.cos(th), 1.8, .35 * math.sin(th)), (.73 * math.cos(th), .1, .73 * math.sin(th)), .055, 'brass')
        a.disk('Mantle top sensor disc', 'head', .58, .15, (0, .6, 0), 'shade', 'y', 20)
        a.tube('Sensor disc illuminated annulus', 'head', .48, .43, .04, (0, .7, 0), 'glow', 'y')
        for tent in p['tentacles']:
            owner = tent['root']
            for i, delta in enumerate(tent['deltas']):
                limb_segment(a, owner, delta, p['limb'] * (1 - i * .14), soft=True)
                owner = owner + '_0' if i == 0 else tent['root'] + '_' + str(i)
    elif r in ['hound', 'stego', 'centaur']:
        a.loft('Horizontal armored animal chassis', carrier, [(-p['length'] * .5, p['width'] * .65, .75), (-p['length'] * .25, p['width'], 1.0), (p['length'] * .28, p['width'], 1.1), (p['length'] * .45, p['width'] * .6, .72)], 'armor', axis='z')
        for side in [-1, 1]:
            a.box('Animal flank armor panel', carrier, (.09, .52, p['length'] * .52), (side * p['width'] * .47, -.12, -.1), 'shade', .06)
            vents(a, carrier, (side * p['width'] * .4, -.22, p['length'] * .32), .3, 4)
        if r == 'centaur':
            a.loft('Knight saddle waist', 'neck', [(-.12, .85, .75), (.9, 1.1, .85)], 'shade')
            a.loft('Knight thoracic armor', 'hum_chest', [(-.2, .9, .75), (.5, 1.45, 1.0), (.78, 1.15, .8)], 'armor')
            a.loft('Angular knight helmet', 'head', [(-.2, .58, .52), (.35, .65, .58), (.5, .42, .4)], 'armor')
            a.box('Knight visor slit', 'head', (.47, .065, .05), (0, .16, .3), 'glow')
            for side in [-1, 1]:
                for z in [-.85, .0]: a.box('Saddle ammunition pouch', carrier, (.28, .48, .55), (side * .9, -.1, z), 'shade', .045)
            arms(a, 'hum_chest')
        elif r == 'hound':
            for side in [-1, 1]:
                for i in range(4): a.box('Snow camouflage plate', carrier, (.035, .22, .37), (side * .48, .18 - (i % 2) * .2, -.9 + i * .58), 'shade' if i % 2 else 'steel')
            animal_head(a)
        else: animal_head(a)
    else:
        if r in ['trex', 'gorilla']:
            a.loft('Hunched horizontal thorax', 'chest', [(-p['length'] * .5, p['width'] * .7, 1.0), (0, p['width'] * 1.1, 1.5), (p['length'] * .5, p['width'] * .55, .85)], 'armor', axis='z')
            ellipsoid(a, 'Low pelvic armor', carrier, (p['width'], .95, 1.2), (0, 0, 0), 'shade')
        elif r == 'crane':
            ellipsoid(a, 'Horizontal bird thorax', 'chest', (p['width'], 1.15, p['length']), (0, .05, -.1), 'armor')
            ellipsoid(a, 'Bird hip armor', carrier, (.85, .75, 1), (0, .1, 0), 'shade')
        else:
            a.loft('Pelvic armored saddle', carrier, [(-.25, p['width'] * .72, p['length'] * .65), (.35, p['width'], p['length'] * .7)], 'shade')
            a.loft('Thoracic armor shell', 'chest', [(-.7, p['width'] * .62, p['length'] * .65), (.25, p['width'], p['length']), (.85, p['width'] * .8, p['length'] * .8)], 'armor')
            a.box('Abdominal hydraulic core', carrier, (p['width'] * .55, .65, .62), (0, .65, .02), 'dark', .07)
            for side in [-1, 1]: a.strut('Exposed abdomen tendon', carrier, (side * p['width'] * .35, .25, .24), (side * p['width'] * .25, 1.05, .24), .11 if r != 'seraph' else .07, 'shade')
        arms(a)
        if r in ['roo', 'gorilla', 'crane', 'trex']: animal_head(a)
        else:
            a.loft('Helmet shell', 'head', [(-.27, .56 if r == 'seraph' else .85, .6), (.3, .72 if r == 'seraph' else .95, .72), (.53, .4 if r == 'seraph' else .7, .5)], 'armor')
            eyes(a, 'head', (0, .12, .4), .52)
            if r == 'bastion':
                a.plate('Skull nose plate', 'head', [(-.15, .13), (.15, .13), (.08, -.21), (0, -.3), (-.08, -.21)], .06, (0, 0, .43), 'steel')
                for side in [-1, 1]:
                    points = [(side * .33, .3, 0), (side * .65, .48, 0), (side * .9, .8, .05), (side * .95, 1.05, .12)]
                    for i in range(3): spike(a, 'Curved segmented bull horn', 'head', points[i], points[i + 1], .18 - i * .04, 'steel')
                ellipsoid(a, 'Back egg cockpit', 'chest', (1.6, 2.2, 1.1), (0, .3, -.8), 'shade')
            if r == 'seraph':
                spike(a, 'Forward helmet horn', 'head', (0, .4, .1), (0, .65, .65), .12, 'steel')
                for side in [-1, 1]:
                    spike(a, 'Cheek fin', 'head', (side * .3, 0, .05), (side * .55, .12, -.35), .13, 'shade')
                    for y in [.1, .8]:
                        a.strut('Back thruster blade spar', 'chest', (side * .35, y, -.35), (side * 1.4, y + .6, -1), .17, 'steel')
                        a.plate('Outward blade thruster', 'chest', [(0, 0), (.3 * side, .5), (.45 * side, .9), (.05 * side, .6)], .25, (side * 1.05, y + .2, -.85), 'armor')
                        a.box('Thruster luminous slot', 'chest', (.09, .5, .04), (side * 1.27, y + .65, -.68), 'glow')
        if r == 'gorilla':
            for side in [-1, 1]:
                a.tube('Twin exhaust stack', 'chest', .23, .16, 1.7, (side * .7, 1, -.7), 'dark', 'y')
                vents(a, 'chest', (side * .6, -.2, .8), .5, 5)
            a.plate('Bulldozer forearm shield', 'elbow_l', [(-.52, .2), (.5, .2), (.7, -.95), (-.62, -1.0)], .2, (.15, -.35, .45), 'armor')
            a.box('Shield steel cutting edge', 'elbow_l', (1.3, .16, .2), (.15, -1.3, .5), 'steel')
        if r == 'colossus':
            for i in range(3): a.plate('Layered chest shield plate', 'chest', [(-.95 + i * .1, .2), (.95 - i * .1, .2), (.72 - i * .1, -.23), (-.72 + i * .1, -.23)], .15, (0, .46 - i * .34, p['length'] * .52 + i * .08), 'shade' if i % 2 else 'armor')
            for j in range(3): a.strut('Left shoulder emblem stroke', 'shoulder_l', (-.3 + j * .17, .55, .69), (-.2 + j * .17, .15, .69), .035, 'brass')
        if r == 'roo':
            a.loft('Abdominal armored pouch', carrier, [(.1, .7, .25), (.7, 1, .38), (.9, .86, .32)], 'shade', (0, .15, .6))
    ground_legs(a)
    tails(a)


def rotors(a):
    p, r = a.p, a.spec['recipe']
    for entry in a.spec['rig'].get('spin', []):
        name = entry if isinstance(entry, str) else entry['node']
        pos = next(pos for n, _, pos in a.spec['joints'] if n == name)
        push = not isinstance(entry, str)
        rad = p.get('rotorRadius', .55) if not push else .64 if r == 'zero' else .48
        axis = 'z' if push else 'y'
        if r in ['fpv', 'slab']:
            a.strut('Carbon rotor outrigger', 'tilt', (0, 0, 0), pos, .15 if r == 'fpv' else .24, 'dark')
        if r == 'slab':
            a.tube('Open industrial rotor duct', 'tilt', rad, rad * .82, .38, pos, 'armor', 'y', 24)
            a.tube('Duct steel lip', 'tilt', rad * 1.03, rad * .92, .08, (pos[0], pos[1] + .2, pos[2]), 'steel', 'y', 24)
        a.disk('Propeller motor hub', name, .15 if not push else .11, .18, (0, 0, 0), 'dark', axis)
        for i in range(3 if push else 2):
            th = math.tau * i / (3 if push else 2)
            if push:
                a.plate('Pusher propeller blade', name, [(.1, -.04), (rad * .95, .04), (rad, .18), (.18, .07)], .04, (0, 0, 0), 'dark').rotation_euler[1] = -th
            else:
                points = [(.11, -.07), (rad * .95, -.11), (rad, .12), (.15, .06)]
                obj = wing(a, 'Open rotor blade', name, points, (0, 0, 0), 'dark' if r != 'fpv' else 'armor', .035)
                obj.rotation_euler[2] = th


def flight_feathers(a, parent, side, length, width, material='armor', count=8, membrane=False):
    if membrane:
        wing(a, 'Pterosaur wing membrane', parent, [(0, .4), (side * length, .2), (side * length * .8, -.7), (side * length * .44, -1.15), (0, -.85)], (0, 0, 0), 'shade', .05)
        a.strut('Continuous wing leading edge spar', parent, (0, .05, .3), (side * length, .05, -.15), .09, 'steel')
        for i in range(5):
            end = (side * length * (.3 + i * .16), 0, -.9 + i * .15)
            a.strut('Bone-white membrane finger', parent, (0, .04, .3), end, .045, 'steel')
    else:
        wing(a, 'Continuous overlapping flight feather web', parent,
             [(0,.20),(side*length,.08),(side*length,-.82),(side*length*.70,-1.36),(0,-1.05)],
             (0,0,0), material, .045)
        for i in range(count):
            x = side * length * (.1 + i * .11)
            z = -.15 - i * .05
            points = [(0, .18), (side * width, .1), (side * width * .8, -1.0 - i * .065), (side * width * .25, -1.3 - i * .08), (-side * .04, -.55)]
            wing(a, 'Separate articulated feather blade', parent, points, (x, .03 + i * .008, z), material if i % 3 else 'shade', .055)
            a.strut('Feather blade luminous vein', parent, (x, .075 + i * .008, z), (x + side * width * .3, .075 + i * .008, z - .9), .018, 'brass')
        a.strut('Wing leading edge spar', parent, (0, .08, .16), (side * length, .08, -.25), .12, material)


def flyer_body(a):
    p, r = a.p, a.spec['recipe']
    if r == 'slab':
        for y in [-.23, .23]: a.box('Thick industrial slab', 'tilt', (p['width'], .35, p['length']), (0, y, 0), 'armor', .08)
        for z in [-1.35, -.65, .2, 1.05]: a.box('External cross reinforcement rib', 'tilt', (p['width'] + .2, .12, .18), (0, .46, z), 'dark')
        a.box('Asymmetric repaired panel', 'tilt', (.7, .065, .9), (-.3, .47, -.35), 'shade')
        for side in [-1, 1]: vents(a, 'tilt', (side * .65, -.2, p['length'] * .5 + .04), .2, 5, 'brass')
    elif r == 'fpv':
        # Two open rail decks deliberately leave the center and rotor sweep unarmored.
        for y in [-.16, .16]:
            for side in [-1, 1]: a.strut('Bare fluorescent frame rail', 'tilt', (side * .3, y, -.9), (side * .3, y, .85), .065, 'armor')
            for z in [-.8, .6]: a.strut('Carbon deck cross rail', 'tilt', (-.34, y, z), (.34, y, z), .07, 'dark')
        a.box('Flight control circuit', 'tilt', (.42, .04, .65), (0, 0, -.1), 'shade', .01)
        for side in [-1, 1]:
            for i in range(3): a.disk('Exposed purple capacitor', 'tilt', .11, .32, (side * .27, -.05, -.55 + i * .27), 'glow', 'y')
            for z in [-.65, .3]:
                a.strut('External copper cooling pipe', 'tilt', (side * .3, -.2, z), (side * .7, -.12, z + .4), .045, 'brass')
                a.strut('Purple external wiring', 'tilt', (side * .15, .04, z), (side * 1.2, .12, z + .55), .026, 'glow')
    elif r == 'medical':
        ellipsoid(a, 'Spherical segmented rescue cabin', 'tilt', (2, 1.9, 2), (0, 0, 0), 'armor', 24, 12)
        a.tube('Cabin brass seam ring', 'tilt', 1.01, .975, .045, (0, .05, 0), 'brass', 'y', 32)
        a.tube('Thin red equatorial line', 'tilt', 1.016, .995, .028, (0, -.13, 0), 'red', 'y', 32)
        a.strut('Coax rotor mast', 'tilt', (0, .7, 0), (0, 1.7, 0), .18, 'steel')
        for side in [-1, 1]:
            a.strut('Medical pod attachment', 'tilt', (side * .7, 0, 0), (side * 1.65, 0, 0), .18, 'steel')
            a.disk('Medical side pod', 'tilt', .65, .25, (side * 1.62, -.03, 0), 'armor', 'x', 24)
            for size in [( .045, .55, .16), (.045, .16, .55)]: a.box('Dark green medical cross', 'tilt', size, (side * 1.77, -.03, 0), 'shade', .005)
    elif r in ['dragon', 'pterosaur', 'eagle']:
        ellipsoid(a, 'Narrow armored flight thorax', 'tilt', (p['width'], .9 if r != 'dragon' else .85, 2.2), (0, 0, -.1), 'armor')
        if r == 'dragon':
            pts = [(0, 0, .5), (0, .25, 1.05), (0, .65, 1.5), (0, .9, 1.4), (0, 1.15, 1.15)]
            for i in range(len(pts) - 1):
                a.strut('Curved dragon cervical core', 'tilt', pts[i], pts[i + 1], .27, 'shade')
                ellipsoid(a, 'Dragon segmented neck scale', 'tilt', (.64, .65, .65), pts[i + 1], 'armor')
            ellipsoid(a, 'Horned dragon head', 'sensor', (.85, .7, 1), (0, 1.12, -.5), 'armor')
            a.loft('Dragon sonic muzzle', 'sensor', [(-.2, .65, .45), (.65, .45, .3)], 'shade', (0, 1, -.3), axis='z')
            eyes(a, 'sensor', (0, 1.26, .0), .65)
            for side in [-1, 1]:
                spike(a, 'Eastern dragon horn', 'sensor', (side * .28, 1.35, -.65), (side * .55, 1.95, -1), .13, 'brass')
                a.strut('Long mechanical whisker', 'sensor', (side * .25, .95, .1), (side * .85, .85, .65), .026, 'steel')
                for z in [-.12, .12, .34]: spike(a, 'Dragon visible tooth', 'sensor', (side * .21, 1.0, z), (side * .2, .83, z), .043, 'steel')
            for i in range(5):
                for side in [-1, 1]: a.plate('Sakura petal marking', 'tilt', [(0, 0), (.09, .11), (0, .2), (-.09, .11)], .014, (side * .43, .08, -.75 + i * .28), 'red')
        else:
            ellipsoid(a, 'Raptor sensor head', 'sensor', (.5, .55, .65), (0, .2, 0), 'armor')
            if r == 'eagle':
                a.loft('Hooked black eagle beak', 'sensor', [(.12, .26, .2), (.55, .11, .16), (.65, .025, .27)], 'dark', (0, .1, 0), axis='z')
                for side in [-1, 1]: ellipsoid(a, 'Golden raptor eye', 'sensor', (.12, .12, .1), (side * .21, .3, .24), 'glow', 10, 6)
            else:
                a.loft('Long sniper beak', 'sensor', [(0, .32, .27), (1.1, .11, .09), (1.35, .02, .02)], 'steel', axis='z')
                ellipsoid(a, 'Red monocular sensor', 'sensor', (.16, .14, .08), (-.23, .24, .2), 'glow', 10, 6)
                spike(a, 'Pterosaur swept crest', 'sensor', (0, .3, -.2), (0, .55, -.8), .13, 'armor')
        for side in [-1, 1]:
            for z in ([.25, -.6] if r == 'dragon' else [-.5]):
                start, knee, foot = (side * .33, -.25, z), (side * .55, -.55, z - .15), (side * .48, -.6, z + .3)
                a.strut('Tucked flight thigh', 'tilt', start, knee, .13, 'shade')
                a.strut('Tucked flight shin', 'tilt', knee, foot, .1, 'steel')
                for j in range(3): spike(a, 'Tucked talon', 'tilt', (foot[0] + (j - 1) * .1, foot[1], foot[2]), (foot[0] + (j - 1) * .12, foot[1] - .18, foot[2] + .2), .05, 'brass')
        for side, n in [(-1, 'r'), (1, 'l')]:
            length = p['span'] * .24
            ellipsoid(a, 'Flight wing shoulder hinge', 'wing_' + n, (.4, .32, .4), (0, 0, 0), 'brass', 12, 6)
            flight_feathers(a, 'wing_' + n, side, length, .38, count=7, membrane=r == 'pterosaur')
            flight_feathers(a, 'wing_' + n + '_outer', side, length * .8, .36, count=7, membrane=r == 'pterosaur')
            if r == 'pterosaur':
                pivot = next(pos for name, _, pos in a.spec['joints'] if name == 'wing_' + n + '_outer')
                wing(a, 'Articulated elbow membrane', 'wing_' + n,
                     [(side * length * .55, -.8), (pivot[0], pivot[2] + .2),
                      (pivot[0], pivot[2] - .85), (side * length * .55, -1.05)], (0, 0, 0), 'shade', .05)
                a.strut('Wing elbow linkage', 'wing_' + n, (side * length, .05, -.15), pivot, .09, 'steel')
                ellipsoid(a, 'Wing elbow hinge cap', 'wing_' + n + '_outer', (.25, .2, .25), (0, 0, 0), 'steel', 12, 6)
        tails(a)
    else:
        width = p['width']
        a.loft('Faceted aerodynamic fuselage', 'tilt', [(-p['length'] * .5, width * .2, .25), (-p['length'] * .2, width * .6, .48), (p['length'] * .2, width, .65), (p['length'] * .48, width * .25, .24)], 'armor', axis='z')
        a.loft('Dark nose canopy', 'sensor', [(-.15, width * .55, .26), (.4, width * .3, .16)], 'dark', (0, .25, 0), axis='z')
        if r == 'glider':
            a.strut('Thin glider central rod', 'tilt', (0, 0, -p['length'] * .5), (0, 0, p['length'] * .4), .16, 'steel')
        for side in [-1, 1]:
            span = p['span'] / 2
            if r == 'delta': points = [(0, p['length'] * .38), (side * span, -p['length'] * .42), (side * span * .65, -p['length'] * .52), (0, -p['length'] * .48)]
            elif r == 'canard': points = [(0, .8), (side * span, -1.7), (side * span * .6, -2), (0, -1.7)]
            elif r == 'glider': points = [(0, .35), (side * span, -.05), (side * span, -.45), (0, -.45)]
            elif r == 'twinboom': points = [(0, .5), (side * span, .1), (side * span, -.5), (0, -.65)]
            else: points = [(0, .7), (side * span * .85, .15), (side * span, -.4), (side * span * .9, -.9), (0, -.75)]
            owner = 'wing_' + ('l' if side > 0 else 'r') if r == 'canard' else 'tilt'
            wing(a, 'Reference wing planform', owner, points, (0, 0, 0), 'armor', .13 if r != 'glider' else .055)
            if r == 'zero':
                for y in [-.083, .083]:
                    a.disk('Upper and underside red roundel', 'tilt', .47, .015, (side * span * .63, y, -.16), 'red', 'y', 24)
                    a.tube('Roundel light rim', 'tilt', .5, .47, .015, (side * span * .63, y, -.16), 'steel', 'y', 24)
            if r == 'glider':
                for i in range(12): a.box('Brass wing clock tick', 'tilt', (.025, .016, .16 if i % 3 else .26), (side * (1 + i * .28), .043, -.14), 'brass', .001)
                a.disk('Wing clock center', 'tilt', .16, .016, (side * span * .55, .045, -.12), 'dark', 'y')
            if r in ['delta', 'canard']:
                for i in range(4):
                    x, z = side * (1.15 + i * .48), -.55 - i * .15
                    for dx, dz in [(.22, 0), (0, .2), (-.22, 0), (0, -.2)]: a.strut('Etched geometric wing ornament', owner, (x, .09, z), (x + dx, .09, z + dz), .025, 'brass' if r == 'delta' else 'glow')
            if r == 'canard':
                wing(a, 'Forward canard', 'tilt', [(0, .3), (side * 1.3, 0), (side * 1, -.38), (0, -.2)], (0, .05, 1.45), 'shade')
            if r not in ['delta', 'canard', 'twinboom']:
                tailplane = wing(a, 'Tailplane', 'tilt', [(0, .25), (side * 1.05, -.15), (side * .85, -.65), (0, -.5)], (0, .05 if r != 'glider' else .15, -p['length'] * .45), 'shade')
                if r == 'glider': tailplane.rotation_euler[1] = -side * .6
                if r == 'glider': a.strut('V tail elevated spar', 'tilt', (0, .1, -p['length'] * .4), (side * .8, .7, -p['length'] * .5), .07, 'brass')
        if r == 'zero':
            a.tube('Nose engine cowling', 'tilt', .47, .33, .7, (0, -.02, 1.85), 'dark', segments=24)
            a.plate('Downward triangular shovel ram', 'tilt', [(-.6, .25), (.6, .25), (.32, -.75), (0, -1.1), (-.32, -.75)], .13, (0, -.3, 2.35), 'steel')
            a.plate('Vertical tail fin', 'tilt', [(-.1, 0), (-.2, .8), (.3, .9), (.45, 0)], .09, (0, 0, -2.1), 'shade')
        if r == 'canard':
            a.plate('Diamond blue nose sensor', 'sensor', [(0, .24), (.2, 0), (0, -.24), (-.2, 0)], .045, (0, .03, .55), 'glow')
            a.tube('Rear jet nozzle', 'tilt', .28, .21, .5, (0, 0, -2), 'dark')
        if r == 'delta':
            for side in [-1, 1]: a.plate('Twin rear vertical fin', 'tilt', [(-.4, 0), (.2, 0), (.05, .8), (-.35, .5)], .085, (side * 1.5, .02, -1.55), 'dark')
        if r == 'twinboom':
            for side in [-1, 1]:
                a.loft('Parallel rear tail boom', 'tilt', [(-2.5, .23, .22), (-.2, .29, .25)], 'shade', (side * 1.1, 0, 0), axis='z')
                for i in range(4):
                    at = (side * .6, .25, -.65 + i * .5)
                    a.strut('Dipole antenna mast', 'tilt', at, (at[0], .72, at[2]), .025, 'steel')
                    a.strut('Dipole antenna crossbar', 'tilt', (at[0] - .18, .72, at[2]), (at[0] + .18, .72, at[2]), .025, 'steel')
                a.box('Rescue orange wing band', 'tilt', (.34, .03, .58), (side * 2.8, .095, -.2), 'red')
            a.box('Inverted U tail bridge', 'tilt', (2.4, .1, .55), (0, .2, -2.35), 'armor')
    rotors(a)


def weapons(a):
    p, r = a.p, a.spec['recipe']
    length = p['gunLength']
    a.loft('Light weapon receiver', 'gun_recoil', [(-.27, .34, .3), (.26, .32, .28)], 'brass' if r == 'roo' else 'dark', axis='z')
    count = 4 if r == 'fpv' else 2 if r in ['eagle', 'crane', 'trex', 'zero', 'canard', 'roo', 'stego', 'pterosaur'] else 1
    for i in range(count):
        x = (i - (count - 1) / 2) * (1.5 if r == 'zero' else .12)
        if r == 'zero': a.box('Paired wingroot shotgun pod', 'gun_recoil', (.28, .28, .5), (x, 0, .15), 'shade')
        a.tube('Light weapon open bore', 'gun_recoil', .065 if count > 1 else .09, .035 if count > 1 else .052, length - .2, (x, 0, (length + .2) / 2), 'steel', segments=12)
        for z in [.3, length * .65]: a.tube('Weapon cooling collar', 'gun_recoil', .09 if count > 1 else .12, .065 if count > 1 else .09, .06, (x, 0, z), 'shade', segments=12)
    a.disk('Light muzzle emission', 'light_muzzle', .045, .014, (0, 0, 0), 'glow')
    if r in ['centaur', 'glider', 'medical']:
        for side in [-1, 1]: a.strut('Sniper electromagnetic rail', 'gun_recoil', (side * .14, .11, .25), (side * .14, .11, length), .045, 'brass')
        a.tube('Sniper optical scope', 'gun', .085, .04, .5, (0, .25, .2), 'shade', segments=12)
    if r == 'bastion':
        a.box('Left belt feed ammunition box', 'gun', (.58, .5, .55), (.42, -.12, 0), 'armor')
        for i in range(7): a.box('Machine gun feed belt link', 'gun', (.1, .11, .15), (.13 + i * .05, .17 - math.sin(i * .6) * .12, -.1), 'brass')
    if r == 'gorilla': a.disk('Left drum shotgun magazine', 'gun', .35, .35, (.23, -.15, 0), 'shade', 'x')
    if r == 'bastion':
        a.disk('Right revolver six chamber drum', 'heavy', .54, .6, (0, 0, .2), 'shade')
        for i in range(6):
            th = math.tau * i / 6
            a.tube('Revolver chamber bore', 'heavy', .105, .075, .64, (.35 * math.cos(th), .35 * math.sin(th), .24), 'steel', segments=12)
        a.tube('Revolver axe cannon bore', 'heavy', .24, .16, 1.05, (0, 0, 1), 'steel')
        a.plate('Crescent axe blade', 'heavy', [(.12, .45), (.48, .35), (.92, -.1), (.7, -.75), (.23, -1.1), (.38, -.45), (.12, -.15)], .16, (0, -.1, .9), 'armor')
        for i in range(5): a.box('Cyan axe rune', 'heavy', (.1, .045, .02), (.5, -.05 - i * .15, 1), 'glow', .005)
    elif r in ['colossus', 'trex', 'crane', 'seraph', 'gorilla', 'hound', 'pterosaur', 'dragon', 'canard', 'glider', 'zero']:
        length = 2.4 if r == 'seraph' else 1.45 if r in ['gorilla', 'pterosaur', 'glider'] else .85
        width = .1 if r == 'glider' else .16 if r == 'pterosaur' else .2 if r in ['crane', 'seraph'] else .26
        a.loft('Heavy electromagnetic receiver', 'heavy', [(-.2, width * 2.2, width * 1.9), (.3, width * 2, width * 1.8)], 'shade', axis='z')
        a.tube('Heavy weapon open bore', 'heavy', width * .6, width * .36, length, (0, 0, length * .5), 'steel', segments=16)
        for i in range(5): a.tube('Heavy accelerator ring', 'heavy', width, width * .68, .08, (0, 0, .15 + i * length / 6), 'brass' if r == 'seraph' else 'armor', segments=16)
        if r == 'seraph': spike(a, 'Long superconducting lance tip', 'heavy', (0, 0, 1.9), (0, 0, 3.0), .16, 'glow')
        if r == 'crane': spike(a, 'Photon lance blade', 'heavy', (0, 0, .25), (0, 0, 1.55), .14, 'glow')
    elif r == 'eagle':
        for side in [-1, 1]:
            for j in range(2):
                a.loft('Exactly four feather missiles', 'heavy', [(-.5, .12, .12), (.6, .12, .12), (.8, .012, .012)], 'steel', (side * (.6 + j * .22), .12, 0), axis='z')
                a.box('Feather missile release rail', 'heavy', (.07, .06, 1.1), (side * (.6 + j * .22), .05, -.05), 'shade')
    elif r == 'stego':
        for side in [-1, 1]:
            for i in range(4):
                z = -1.7 + i * .95 + (0 if side < 0 else .25)
                y = .1
                a.plate('Eight pentagonal launch backplates', 'heavy', [(-.29, 0), (-.4, .65), (0, 1.12), (.4, .65), (.29, 0)], .16, (side * .45, y, z), 'armor')
                for x in [-.14, .14]: a.box('Mechanical backplate launch rail', 'heavy', (.07, .72, .045), (side * .45 + x, y + .47, z + .1), 'dark')
                a.box('Backplate hazard stripe', 'heavy', (.45, .09, .045), (side * .45, y + .22, z + .1), 'brass')
    elif r == 'delta':
        a.box('Honeycomb dorsal launch bay', 'heavy', (1.45, .35, 1.2), (0, .03, -.05), 'dark', .07)
        for row in range(3):
            for col in range(4): a.tube('Honeycomb launch cell', 'heavy', .15, .12, .2, ((col - 1.5) * .32 + (row % 2) * .07, .28, (row - 1) * .32), 'brass', 'y', 6)
    elif r == 'fpv':
        for side in [-1, 1]:
            a.box('Ventral microdrone release rail', 'heavy', (.1, .13, 1.1), (side * .32, -.65, -.1), 'steel')
            a.box('Compact expendable drone pack', 'heavy', (.25, .18, .6), (side * .32, -.55, -.1), 'shade')
    elif r == 'octopod':
        a.box('Plasma web projection matrix', 'heavy', (.85, .65, .3), (0, 0, .16), 'shade', .08)
        for x in [-.22, 0, .22]:
            for y in [-.16, .16]: a.disk('Plasma matrix aperture', 'heavy', .075, .035, (x, y, .34), 'glow', segments=12)
    elif r == 'slab':
        a.box('Single side thermal rocket housing', 'heavy', (.6, .7, .85), (0, 0, .1), 'shade')
        a.tube('Single large thermal rocket port', 'heavy', .3, .23, .8, (0, 0, .4), 'steel', segments=16)
    else:
        vertical = r == 'centaur'
        size = (.75, 1.45, .7) if vertical else (.8, .55, .85)
        a.box('Heavy payload armored housing', 'heavy', size, (0, .3 if vertical else 0, 0), 'shade', .055)
        for x in [-.2, .2]:
            a.tube('Payload launcher open cell', 'heavy', .15, .115, .9, (x, .5 if vertical else 0, .3 if not vertical else 0), 'steel', 'y' if vertical else 'z', 12)
        if r == 'twinboom':
            for side in [-1, 1]:
                a.box('Underwing rocket pod', 'heavy', (.45, .45, 1), (side * 1.7, -.6, 0), 'shade')
                for x in [-.1, .1]: a.tube('Underwing rocket bore', 'heavy', .075, .052, .8, (side * 1.7 + x, -.6, .3), 'steel', segments=10)
    a.box('Reversible heavy charge aperture', 'charge_hinge', (.46, .06, .42), (0, 0, .2), 'armor', .015)
    a.box('Charge aperture luminous edge', 'charge_hinge', (.35, .025, .02), (0, .04, .4), 'glow', .003)
    a.disk('Heavy muzzle emission', 'heavy_muzzle', .07, .012, (0, 0, 0), 'glow')


def emitters(a):
    aerial = a.spec['kind'] == 'aerial'
    for side, name in [(1, 'emitter_l'), (-1, 'emitter_r')]:
        a.loft('Retractable armor shield emitter', name, [(0, .23, .24), (.62 if aerial else .8, .2, .2), (.82 if aerial else 1, .12, .15)], 'armor')
        a.box('Shield emitter luminous rail', name, (.06, .65 if aerial else .8, .025), (0, .43, .14), 'glow', .006)
        a.disk('Shield emitter hinge', name, .16, .12, (0, 0, 0), 'brass', 'z')
    a.barrier('barrier', 1.5 if aerial else 1.65, 1.1 if aerial else 1.9)
    a.disk('Articulated cast energy dish', 'cast_dish', .28, .08, (0, 0, 0), 'shade')
    a.tube('Cast dish luminous annulus', 'cast_dish', .25, .2, .03, (0, 0, .06), 'glow')


def construct(asset):
    flyer_body(asset) if asset.spec['kind'] == 'aerial' else ground(asset)
    weapons(asset)
    emitters(asset)
