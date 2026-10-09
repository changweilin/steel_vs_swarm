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
    from mathutils import Vector
    length = math.sqrt(sum(v * v for v in delta))
    a.strut('Exposed load-bearing piston', parent, (0, 0, 0), delta, width * .4, 'dark' if soft else 'steel')
    for k in ([.18, .48, .77] if soft else [.48]):
        center = tuple(v * k for v in delta)
        if soft:
            obj = ellipsoid(a, 'Overlapping tentacle sleeve', parent,
                            (width, length * .38, width), center, armor, 10, 4)
            obj.rotation_euler = Vector((delta[0], -delta[2], delta[1])).to_track_quat('Z', 'Y').to_euler()
            a.disk('Ventral sucker ring', parent, width * .22, .05, (center[0], center[1] - width * .36, center[2]), 'brass', 'y', 8)
        else:
            obj = a.loft('Single anatomical limb shell', parent,
                         [(-length * .39, width * .68, width * .68),
                          (-length * .18, width, width * .88),
                          (length * .38, width * .62, width * .64)], armor, center)
            obj.rotation_euler = Vector((delta[0], -delta[2], delta[1])).to_track_quat('Z', 'Y').to_euler()
    a.disk('Mechanical joint collar', parent, width * .6, width * .9, (0, 0, 0), 'dark', 'x')
    a.disk('Joint axle cap', parent, width * .3, width * .98, (0, 0, 0), 'brass', 'x')


def tentacle_segment(a, parent, delta, width):
    from mathutils import Vector
    direction = Vector((delta[0], -delta[2], delta[1]))
    length = direction.length
    obj = a.loft('Continuous flexible tentacle sheath', parent,
                 [(-.025, width, width), (length * .48, width * .96, width * .96),
                  (length + .025, width * .91, width * .91)], 'armor')
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    for u in [.30, .75]:
        at = tuple(v * u for v in delta)
        a.tube('Ventral articulated sucker', parent, width * .24, width * .13, .035,
               (at[0], at[1] - width * .46, at[2]), 'armor', 'y', 6)


def ground_legs(a):
    p, r = a.p, a.spec['recipe']
    soft = r == 'octopod'
    for leg in p['legs']:
        owner = leg['root']
        widths = p.get('legWidths', {}).get('fore' if 'F' in owner else 'hind')
        for i, delta in enumerate(leg['deltas']):
            width = p['limb'] * (widths[i] if widths else 1-i*.12)
            if soft:
                tentacle_segment(a, owner, delta, p['limb'] * (.22 + .78 * (1 - i / len(leg['deltas'])) ** 1.4))
            elif r == 'colossus':
                animal_limb(a,owner,delta,p['limb']*.78,'hind',i)
                a.box('Rounded heavy leg carapace',owner,(.87,max(.7,abs(delta[1])*.67),.88),tuple(v*.48 for v in delta),'armor',.12)
            elif r == 'seraph':
                animal_limb(a, owner, delta, .48 if i == 0 else .31, 'hind', i)
            elif p.get('legAnatomy'):
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
    if r=='crane':
        return
    if r == 'octopod':
        return
    nodes = a.spec['rig'].get('tailSegs', [])
    if r in ['centaur', 'hound', 'wolf_squirrel']:
        from mathutils import Vector
        for i, name in enumerate(nodes):
            delta = p['tail'][i + 1] if i + 1 < len(nodes) else p['tailTip']
            length = Vector(delta).length
            u = i / len(nodes)
            width = p['tailWidth'] * ((.45 + .72 * math.sin(math.pi*u)) if r == 'centaur' else (.8 + .45*math.sin(math.pi*u)))
            end = max(.045, width * (.25 if i == len(nodes)-1 else .88))
            if r == 'centaur':
                if i == 0:
                    a.strut('Short equine tail dock',name,(0,0,0),delta,.17,'shade')
                for strand in range(7):
                    angle = math.tau*strand/7
                    offset = (math.cos(angle)*width*.30,0,math.sin(angle)*width*.30)
                    hair = a.loft('Flowing horse tail hair bundle',name,
                                  [(-.045,width*.28,width*.23),(length*.45,width*.30,width*.24),
                                   (length+.045,end*.26,end*.22)],'dark' if strand%3 else 'shade',offset)
                    hair.rotation_euler=Vector((delta[0],-delta[2],delta[1])).to_track_quat('Z','Y').to_euler()
                continue
            shell = a.loft('Flowing horse tail hair' if r == 'centaur' else 'Canine brush tail armor', name,
                           [(-.035,width*.72,width*.7),(length*.45,width,width*.85),
                            (length+.035,end,end*.8)], 'shade' if r == 'centaur' else 'armor')
            shell.rotation_euler = Vector((delta[0],-delta[2],delta[1])).to_track_quat('Z','Y').to_euler()
            for strand in [-1,0,1]:
                a.strut('Horse tail hair strand' if r == 'centaur' else 'Canine tail overlapping coat seam', name,
                        (strand*width*.22,-width*.30,0),
                        (delta[0]+strand*end*.22,delta[1]-end*.30,delta[2]), .025, 'dark' if r == 'centaur' else 'shade')
        return
    if 'tailWidth' in p:
        from mathutils import Vector
        for i, name in enumerate(nodes):
            delta = p['tail'][i + 1] if i + 1 < len(nodes) else p['tailTip']
            length = Vector(delta).length
            start = p['tailWidth'] * (1 - i / len(nodes)) ** 1.2
            end = max(.04, p['tailWidth'] * (1 - (i + 1) / len(nodes)) ** 1.2)
            obj = a.loft('Tapered anatomical tail vertebra armor', name,
                         [(-.04, start, start * .88), (length * .5, (start + end) * .55, (start + end) * .48),
                          (length + .025, end, end * .88)], 'armor')
            obj.rotation_euler = Vector((delta[0], -delta[2], delta[1])).to_track_quat('Z', 'Y').to_euler()
            a.disk('Tail vertebral hinge', name, start * .23, .06, (0, 0, 0), 'dark', 'x', 10)
        if r == 'stego':
            for side in [-1, 1]:
                for z in [-.04, -.35]:
                    spike(a, 'Stegosaur tail spike', nodes[-1], (side * .07, .02, z),
                          (side * .65, .5, z - .45), .15, 'brass')
        return
    if r == 'eagle':
        for i in range(9):
            angle = (i - 4) * .105
            x, z = math.sin(angle), -math.cos(angle)
            wing(a, 'Fanned avian rectrix', nodes[0],
                 [(-.10, 0), (.10, 0), (x * 1.28 + .13, z * 1.28),
                  (x * 1.42, z * 1.42), (x * 1.28 - .13, z * 1.28)],
                 (0, .025 + i * .005, 0), 'armor', .035)
        return
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
        flight_wings(a, folded=True)
        return
    for side, n in [(-1, 'r'), (1, 'l')]:
        shoulder, elbow, wrist = 'shoulder_' + n, 'elbow_' + n, 'wrist_' + n
        positions = {name: pos for name, _, pos in a.spec['joints']}
        width = p['limb'] * (.6 if r == 'roo' else .38 if r == 'trex' else 1)
        if r == 'bastion': ellipsoid(a, 'Giant white ball shoulder', shoulder, (1.55, 1.65, 1.65), (side * .12, .12, 0), 'armor')
        elif r == 'colossus':
            a.box('Shoulder reactor armor', shoulder, (1.55, 1.55, 1.30), (side * .12, .12, -.06), 'armor', .22)
            a.box('Recessed shoulder radiator', shoulder, (1.03,.77,.09), (0,.05,.63), 'dark', .06)
            vents(a, shoulder, (0, -.23, .69), .90, 7, 'brass')
        else: ellipsoid(a, 'Articulated shoulder armor', shoulder, (width * 1.8, width * 1.65, width * 1.7), (0, 0, 0), 'shade')
        if r in ['seraph','colossus']:
            animal_limb(a, shoulder, positions[elbow], .32, 'fore', 0)
            animal_limb(a, elbow, positions[wrist], .29, 'fore', 1)
            if r == 'colossus':
                for parent,delta,size in [(shoulder,positions[elbow],(.70,.70,.80)),(elbow,positions[wrist],(.90,.69,.87))]:
                    a.box('Rounded heavy arm carapace',parent,size,tuple(v*.52 for v in delta),'armor',.13)
        elif p.get('legAnatomy') and r in ['roo', 'trex']:
            animal_limb(a, shoulder, positions[elbow], width, 'fore', 0)
            animal_limb(a, elbow, positions[wrist], width * .75, 'fore', 1)
        else:
            limb_segment(a, shoulder, positions[elbow], width)
            limb_segment(a, elbow, positions[wrist], width * .9)
        if r == 'seraph':
            for parent, end in [(shoulder, positions[elbow]), (elbow, positions[wrist])]:
                for x in [-.11, 0, .11]:
                    a.strut('Exposed living arm tendon bundle', parent, (x, -.12, -.11),
                            (end[0] + x, end[1] + .12, end[2] - .11), .065, 'shade')
        if r == 'trex':
            for x in [-.09, .09]: spike(a, 'Short empty foreclaw', wrist, (x, 0, .04), (x, -.17, .25), .05, 'brass')
        elif r == 'roo':
            ellipsoid(a,'Kangaroo compact forepaw',wrist,(width*.9,width*.55,width*.65),(0,-.05,.1),'shade',10,5)
            for x in [-.08,0,.08]: spike(a,'Kangaroo forepaw digit',wrist,(x,0,.12),(x,-.13,.27),.027,'steel')
        else:
            a.box('Armored palm', wrist, (width * 1.1, width * .7, width * .65), (0, -.1, .06), 'shade')
            held = any(parent == wrist and name in ['gun', 'heavy'] for name, parent, _ in a.spec['joints'])
            for i in range(4):
                at = ((i - 1.5) * width * .24, -.13 if held else -width * .48, .17 if held else width * .25)
                a.box('Closed weapon grip finger' if held else 'Individual armored finger', wrist,
                      (width * .17, width * (.30 if held else .6), width * (.48 if held else .22)), at, 'armor', .01)
            if held:
                a.box('Opposed weapon grip thumb', wrist, (width * .25, width * .45, width * .32),
                      (side * width * .52, -.06, .11), 'armor', .01)
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
        from mathutils import Vector
        positions = {name: pos for name, _, pos in a.spec['joints']}
        chain = a.spec['rig']['cervicals']
        for i, name in enumerate(chain):
            delta = positions[chain[i + 1]] if i + 1 < len(chain) else positions['head']
            length = Vector(delta).length
            obj = a.loft('Forward curved cervical armor', name,
                         [(-.04, .34, .32), (length * .5, .31, .30), (length + .04, .28, .27)], 'armor')
            obj.rotation_euler = Vector((delta[0], -delta[2], delta[1])).to_track_quat('Z', 'Y').to_euler()
            a.disk('Bird cervical hinge', name, .12, .38, (0, 0, 0), 'dark', 'x')
        a.loft('Crane wedge skull', 'head', [(-.2, .34, .28), (.15, .3, .28), (.45, .08, .1)], 'armor', axis='z')
        spike(a, 'Sharp bird beak', 'head', (0, -.03, .32), (0, -.05, .9), .12, 'steel')
        a.box('Red crown', 'head', (.2, .08, .25), (0, .19, .03), 'red')
        spike(a, 'Swept head crest', 'head', (0, .16, -.12), (0, .32, -.65), .12, 'dark')
        eyes(a, 'head', (0, .06, .18), .27)
    elif r == 'trex':
        width, height, length = a.p['headSize']
        a.loft('Massive tyrannosaur upper skull', 'head',
               [(-.55, width * .48, height * .46), (-.12, width, height * .92),
                (.40, width * .88, height), (.96, width * .74, height * .69),
                (length * .63, width * .58, height * .44)],
               'armor', (0, .20, 0), axis='z')
        a.loft('Articulated tyrannosaur lower jaw', 'jaw',
               [(0, width * .66, .28), (.9, width * .72, .34), (length * .75, width * .62, .26)],
               'armor', (0, -.10, 0), axis='z')
        a.loft('Recessed tyrannosaur upper palate', 'head', [(-.1, width * .53, .09), (1.40, width * .48, .09)],
               'dark', (0, .12, 0), axis='z')
        for side in [-1, 1]:
            ellipsoid(a, 'Tyrannosaur orbital brow', 'head', (.45, .32, .54), (side * width * .41, .53, .25), 'shade', 12, 6)
            a.disk('Fiery lateral dinosaur eye', 'head', .14, .05, (side * width * .51, .5, .26), 'glow', 'x')
            a.disk('Tyrannosaur lateral nostril', 'head', .10, .045, (side * width * .31, .24, 1.32), 'dark', 'x')
            a.plate('Swept tyrannosaur cheek armor', 'head', [(side*.20,.15),(side*.81,.34),(side*.74,-.08),(side*.31,-.22)], .10, (0,.05,.48), 'shade')
            for i in range(9):
                z=.32+i*.145; x=side*(width*.35-z*.07)
                spike(a, 'Upper serrated dinosaur tooth', 'head', (x, -.06, z), (x*.98, -.32, z+.035), .09, 'steel')
                spike(a, 'Lower serrated dinosaur tooth', 'jaw', (x, .02, z), (x*.98, .22, z+.03), .075, 'steel')
            a.tube('Cranial exhaust venturi', 'head', .19, .13, .46, (side * .48, .35, -.48), 'dark', segments=12)
    elif r in ['hound', 'roo']:
        size = (.65, .5, .85) if r == 'hound' else (.57, .7, .75) if r == 'roo' else (1.2, .9, 1.5)
        ellipsoid(a, 'Mechanical animal skull', 'head', size, (0, .1, .15), 'armor')
        a.loft('Long armored snout', 'head', [(.25, size[0], size[1] * .6), (.8 if r != 'trex' else 1.15, size[0] * .65, size[1] * .5)], 'shade', axis='z')
        a.box('Jaw separation', 'head', (size[0] * .7, .07, .65), (0, -.17, .6), 'dark')
        eyes(a, 'head', (0, .25, .5), size[0] * .7)
        if r == 'roo':
            for side in [-1, 1]:
                for name, points, depth, at, material in [
                    ('Splayed tapered kangaroo ear', [(-.13, 0), (-.12, .75), (.02, 1.1), (.12, .68), (.13, 0)], .16, (side*.24,.34,-.12),'armor'),
                    ('Dark inner ear', [(-.065,0),(0,.72),(.065,0)], .025, (side*.24,.46,-.025),'shade')]:
                    obj=a.plate(name,'head',points,depth,at,material)
                    a.rotate(obj,'z',-side*.26)
                    a.rotate(obj,'x',-.20)
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
        a.loft('Long low herbivore skull', 'head', [(-.3,.70,.56),(.25,.72,.62),(.95,.45,.40),(1.12,.34,.32)], 'armor', axis='z')
        a.loft('Herbivore lower mandible', 'head', [(.15,.51,.18),(1.04,.32,.17)], 'shade', (0,-.28,0), axis='z')
        for side in [-1,1]:
            a.disk('Lateral herbivore eye', 'head', .085,.035,(side*.36,.13,.25),'glow','x')


def waist_shell(a, parent='waist', profile=None):
    p = profile or a.p['waist']
    width, depth, height = p['width'], p['depth'], p['height']
    a.loft('Independent flexible lumbar waist', parent,
           [(-height*.55,width*1.10,depth), (0,width*.82,depth*.84),
            (height*.95,width*1.12,depth)], 'dark' if 'dark' in a.materials else 'shade')
    for side in [-1,1]:
        a.strut('Lumbar side load tendon', parent,
                (side*width*.39,-height*.45,depth*.27),
                (side*width*.39,height*.84,depth*.27), .045, 'steel')


def weapon_grips(a):
    for held in a.spec['rig'].get('heldWeapons', []):
        owner = held['node']
        if held.get('staff'):
            a.tube('Long axial weapon hand grip',owner,.12,.08,.42,(0,0,0),'shade')
            for z in [-.23,.23]:
                a.tube('Axial grip retaining flange',owner,.15,.105,.045,(0,0,z),'steel')
        else:
            a.box('Thermal weapon pistol grip',owner,(.14,.32,.18),(0,-.16,-.10),'shade',.025)
            for y in [-.25,-.18,-.11]:
                a.box('Pistol grip friction rib',owner,(.155,.025,.19),(0,y,-.10),'steel',.004)
            for start,end in [((0,-.08,.07),(0,-.27,.07)),((0,-.27,.07),(0,-.27,-.05))]:
                a.strut('Closed weapon trigger guard',owner,start,end,.022,'steel')


def ground(a):
    p, r, kind = a.p, a.spec['recipe'], a.spec['kind']
    carrier = 'spine' if kind == 'quad' else 'hips'
    positions = {name: pos for name, _, pos in a.spec['joints']}
    if kind == 'biped' and r != 'crane':
        start = (0, .3, p['length'] * .3) if r == 'trex' else (0, .65, .05)
        end = tuple(positions['head'][i] + positions.get('neck', (0, 0, 0))[i] for i in range(3))
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
        ellipsoid(a, 'Cephalopod armored mantle', carrier, (p['width'], 2.9, p['length']), (0, .75, 0), 'armor', 20, 10)
        for side in [-1, 1]:
            ellipsoid(a, 'Cephalopod lateral orbital socket', carrier, (.38,.35,.43), (side*.75,.73,.54), 'dark',12,6)
            a.disk('Cephalopod luminous eye', carrier, .20,.035,(side*.77,.73,.77),'glow',segments=16)
            a.disk('Cephalopod eye pupil', carrier,.07,.012,(side*.77,.73,.8),'dark')
        for i in range(8):
            th = math.tau * i / 8
            a.strut('Gold mantle totem rib', carrier, (.35 * math.cos(th), 1.8, .35 * math.sin(th)), (.73 * math.cos(th), .1, .73 * math.sin(th)), .055, 'brass')
        a.disk('Mantle top sensor disc', 'head', .58, .15, (0, .6, 0), 'shade', 'y', 20)
        a.tube('Sensor disc illuminated annulus', 'head', .48, .43, .04, (0, .7, 0), 'glow', 'y')
        for tent in p['tentacles']:
            owner = tent['root']
            for i, delta in enumerate(tent['deltas']):
                tentacle_segment(a, owner, delta, p['limb'] * (.22 + .78 * (1 - i / len(tent['deltas'])) ** 1.4))
                owner = owner + '_0' if i == 0 else tent['root'] + '_' + str(i)
    elif r in ['hound', 'stego', 'centaur']:
        if r == 'stego':
            a.loft('Separate stegosaur pelvic croup','pelvis',[(-.80,1.0,.80),(-.20,1.75,1.50),(.60,1.64,1.48)],'armor',(0,.12,0),axis='z')
            a.loft('Separate stegosaur lumbar waist',carrier,[(-.82,1.65,1.48),(-.35,1.43,1.36),(.22,1.80,1.64)],'shade',(0,.12,0),axis='z')
            a.loft('Domed separate stegosaur thorax','chest',[(-1.36,1.80,1.64),(-.85,2.10,1.85),(-.30,1.95,1.80),(.35,.65,.65)],'armor',(0,.24,0),axis='z')
            ellipsoid(a,'Separate stegosaur ventral thorax','chest',(1.82,1.20,1.85),(0,-.26,-.70),'shade',16,8)
        elif r == 'hound':
            a.loft('Separate canine pelvic croup','pelvis',[(-.40,.45,.44),(.10,.78,.78),(.58,.59,.64)],'armor',(0,.08,0),axis='z')
            a.loft('Narrow canine lumbar waist',carrier,[(-.80,.58,.62),(-.35,.44,.48),(.24,.65,.74)],'shade',(0,.16,0),axis='z')
            a.loft('Deep separate canine thorax','chest',[(-.86,.65,.74),(-.38,1.05,1.30),(.30,1.01,1.25),(.64,.59,.67)],'armor',(0,-.02,0),axis='z')
        else:
            a.loft('Separate rounded equine pelvic croup','pelvis',[(-.60,.76,.77),(-.12,1.48,1.30),(.54,1.08,1.04)],'armor',(0,-.02,0),axis='z')
            a.loft('Independent equine lumbar waist',carrier,[(-.80,1.10,1.04),(-.34,.86,.94),(.20,1.14,1.30)],'shade',(0,.08,0),axis='z')
            a.loft('Separate deep equine thorax','chest',[(-.92,1.14,1.30),(-.60,1.44,1.62),(.05,1.57,1.77),(.55,1.15,1.38)],'armor',(0,-.02,0),axis='z')
        for side in [-1, 1]:
            if r == 'centaur':
                for z,w in [(-1.27,.73),(.68,.77)]:
                    a.box('Separated curved horse flank armor',carrier,(.10,.54,.66),(side*w,-.12,z),'shade',.08)
            else:
                a.box('Animal flank armor panel', carrier, (.09, .52, p['length'] * .52), (side * p['width'] * .47, -.12, -.1), 'shade', .06)
            vents(a, carrier, (side * p['width'] * .4, -.22, p['length'] * .32), .3, 4)
        if r == 'centaur':
            waist_shell(a,'hum_waist',a.p['riderWaist'])
            a.loft('Knight thoracic armor', 'hum_chest', [(0, .9, .75), (.5, 1.45, 1.0), (.78, 1.15, .8)], 'armor')
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
        if r == 'trex':
            a.loft('Tyrannosaur expanding rib cage', 'chest',
                   [(-.03,1.10,1.0),(.30,1.75,1.50),(.55,1.90,1.65),(.85,1.45,1.30),(1.15,.90,.90)], 'armor',axis='z')
            ellipsoid(a,'Powerful separate dinosaur pelvis',carrier,(1.70,1.12,1.20),(0,.02,-.48),'shade',16,8)
            a.loft('Dinosaur cervical transition','chest',[(.75,.95,.95),(1.25,.8,.8),(1.8,.78,.74)],'armor',(0,.4,0),axis='z')
        elif r == 'gorilla':
            a.loft('Hunched horizontal thorax', 'chest', [(-p['length'] * .36, p['width'] * .55, .82), (0, p['width'] * 1.1, 1.5), (p['length'] * .5, p['width'] * .55, .85)], 'armor', axis='z')
            ellipsoid(a, 'Low pelvic armor', carrier, (p['width'], .95, 1.2), (0, 0, 0), 'shade')
        elif r == 'crane':
            ellipsoid(a, 'Deep avian breast', 'chest', (1.35, 1.25, 2.25), (0, -.04, -.24), 'armor')
            a.loft('Horizontal avian synsacrum pelvis',carrier,[(-1.25,.58,.42),(-.70,1.07,.81),(.15,1.12,.88),(.68,.66,.57)],'shade',(0,.32,0),axis='z')
            ellipsoid(a,'Avian sternum keel','chest',(.80,.94,1.45),(0,-.34,.13),'armor',12,6)
            for side in [-1,1]:
                for i in range(4):
                    wing(a,'Short rear avian tail feather','tail_0',[(side*.10,0),(side*(.32+i*.055),-.95),(side*.02,-.82)],(0,i*.025,0),'armor',.04)
        elif r == 'seraph':
            a.loft('Narrow seraph pelvic girdle',carrier,[(-.22,.65,.42),(.10,.98,.58),(.34,.76,.47)],'armor')
            a.loft('Exposed living abdominal waist',carrier,[(.27,.53,.36),(.65,.51,.39),(1.08,.72,.42)],'shade')
            a.loft('Slender articulated thoracic cage','chest',[(-.08,.68,.44),(.30,1.05,.58),(.73,1.22,.68),(1.0,.75,.44)],'shade')
            for side in [-1,1]:
                a.plate('Swept seraph pectoral armor','chest',[(side*.05,.74),(side*.55,.89),(side*.58,.52),(side*.27,.22),(side*.03,.3)],.16,(0,0,.37),'armor')
                a.plate('Waist floating abdominal plate',carrier,[(side*.04,.55),(side*.26,.67),(side*.31,1.05),(side*.04,.93)],.12,(0,0,.30),'armor')
                for i in range(4):
                    x=side*(.18+i*.08)
                    a.strut('Living oblique waist tendon',carrier,(x,.24,.24),(x*.65,1.04,.25),.065,'shade')
        elif r == 'roo':
            ellipsoid(a,'Kangaroo powerful pelvis',carrier,(1.35,1.12,1.52),(0,.08,-.16),'shade')
            a.strut('Leaning marsupial lumbar spine',carrier,(0,.16,0),positions['chest'],.32,'dark')
            ellipsoid(a,'Sloped kangaroo abdominal waist','waist',(.64,.58,.79),(0,.10,.20),'shade',16,8)
            ellipsoid(a,'Kangaroo deep forward chest','chest',(.95,1.11,1.14),(0,.30,.11),'armor',16,8)
        elif r == 'colossus':
            a.loft('Heavy rounded pelvic girdle',carrier,[(-.30,1.37,.85),(.06,1.80,1.11),(.34,1.29,.80)],'shade')
            a.box('Recessed flexible abdominal core',carrier,(1.11,.73,.71),(0,.69,0),'dark',.11)
            for i in range(3): a.box('Overlapping abdominal piston guard',carrier,(1.24,.15,.16),(0,.45+i*.20,.40),'shade',.03)
            a.loft('Broad rounded colossus thorax','chest',[(-.53,1.42,.86),(-.10,2.06,1.38),(.60,2.42,1.50),(.95,1.68,1.05)],'armor')
            for side in [-1,1]:
                a.box('Scapular rear armor','chest',(.77,.90,.27),(side*.63,.35,-.77),'shade',.13)
        else:
            a.loft('Pelvic armored saddle', carrier, [(-.25, p['width'] * .65, p['length'] * .57), (.12, p['width']*.78, p['length']*.64),(.35,p['width']*.54,p['length']*.48)], 'shade')
            a.loft('Thoracic armor shell', 'chest', [(-.08, p['width'] * .62, p['length'] * .65), (.25, p['width'], p['length']), (.85, p['width'] * .8, p['length'] * .8)], 'armor')
            for side in [-1, 1]: a.strut('Exposed abdomen tendon', carrier, (side * p['width'] * .35, .25, .24), (side * p['width'] * .25, 1.05, .24), .11 if r != 'seraph' else .07, 'shade')
        if 'waist' in a.nodes:
            if p.get('horizontalWaist'):
                a.loft('Independent theropod lumbar waist','waist',[(-.35,1.10,.88),(0,.87,.86),(.40,1.20,1.10)],'shade',axis='z')
            else:
                waist_shell(a)
        arms(a)
        if r in ['roo', 'gorilla', 'crane', 'trex']: animal_head(a)
        else:
            if r == 'seraph':
                a.loft('Swept seraph wedge skull','head',[(-.34,.40,.37),(.05,.63,.62),(.33,.38,.40),(.53,.10,.16)],'armor',(0,0,-.12))
                a.plate('Seraph tapered face blade','head',[(-.15,.13),(.15,.13),(.17,-.12),(0,-.35),(-.17,-.12)],.04,(0,-.03,.32),'armor')
                for side in [-1,1]:
                    a.plate('Angled seraph luminous visor','head',[(side*.04,.11),(side*.21,.20),(side*.17,.06),(side*.04,.02)],.018,(0,0,.34),'glow')
            elif r == 'colossus':
                a.box('Broad recessed cannon helmet','head',(1.17,.95,.43),(0,.02,-.20),'armor',.11)
                a.box('Cannon helmet roof','head',(1.12,.17,.43),(0,.45,.20),'armor',.04)
                a.box('Colossus lower face armor','head',(1.04,.26,.35),(0,-.14,.23),'armor',.04)
                a.box('Heavy jaw armor','head',(.84,.29,.42),(0,-.34,.24),'shade',.07)
                for side in [-1,1]:
                    a.box('Forehead aperture cheek rim','head',(.23,.46,.15),(side*.38,.27,.42),'shade',.04)
                    a.box('Recessed colossus visor','head',(.28,.09,.028),(side*.20,-.10,.417),'dark',.01)
                    a.box('White colossus eye','head',(.21,.045,.018),(side*.20,-.10,.44),'steel',.005)
            else:
                a.loft('Helmet shell', 'head', [(-.27,.85,.6),(.3,.95,.72),(.53,.7,.5)], 'armor')
                eyes(a, 'head', (0,.12,.4), .52)
            if r == 'bastion':
                a.plate('Skull nose plate', 'head', [(-.15, .13), (.15, .13), (.08, -.21), (0, -.3), (-.08, -.21)], .06, (0, 0, .43), 'steel')
                for side in [-1, 1]:
                    points = [(side * .33, .3, 0), (side * .65, .48, 0), (side * .9, .8, .05), (side * .95, 1.05, .12)]
                    for i in range(3): spike(a, 'Curved segmented bull horn', 'head', points[i], points[i + 1], .18 - i * .04, 'steel')
                ellipsoid(a, 'Back egg cockpit', 'chest', (1.6, 2.2, 1.1), (0, .3, -.8), 'shade')
            if r == 'seraph':
                spike(a, 'Forward helmet horn', 'head', (0, .4, .1), (0, .47, 1.15), .12, 'steel')
                for side in [-1, 1]:
                    spike(a, 'Cheek fin', 'head', (side * .3, 0, .05), (side * .55, .12, -.35), .13, 'shade')
                    for y, height in [(.08,1.30),(.75,2.30)]:
                        a.strut('Back thruster blade spar', 'chest', (side*.30,y,-.35),(side*.95,y+.3,-.78),.14,'steel')
                        a.plate('Long outward blade thruster','chest',[(0,0),(side*.15,height*.7),(side*.70,height),(side*.57,.38),(side*.21,-.15)],.22,(side*.67,y,-.82),'armor')
                        a.strut('Thruster luminous slot','chest',(side*.84,y+.2,-.68),(side*1.28,y+height*.78,-.68),.05,'glow')
                for side in ['l','r']:
                    for parent,end in [('hip_'+side,positions['knee_'+side]),('knee_'+side,positions['ankle_'+side])]:
                        for x in [-.1,0,.1]:
                            a.strut('Exposed living leg tendon bundle',parent,(x,-.12,-.10),(x,end[1]+.12,end[2]-.10),.06,'shade')
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


def flight_panel(a, parent, side, end, role, membrane=False):
    x, y, z = end
    chord = .66 if role == 'humerus' else .92
    start_chord, end_chord = {'humerus': (1.25, 1.75), 'ulna': (1.75, 1.90), 'manus': (1.90, .12)}[role] if membrane else (chord, chord)
    if membrane:
        wing(a, 'Continuous ' + role + ' wing web', parent,
             [(0,0),(x,z),(x,z-end_chord),(x*.55,z*.55-(start_chord+end_chord)*.48),(0,-start_chord)],
             (0,-.025,0), 'shade', .035)
    if membrane and role != 'humerus':
        # A root gore covers the swept hinge sector when the distal panel folds.
        overlap = .55 if membrane else .32
        wing(a, 'Overlapping wing hinge gore', parent,
             [(-overlap,0),(overlap,0),(overlap,start_chord*-.72),
              (0,-start_chord),(-overlap,start_chord*-.72)],
             (0,.015,0), 'shade' if membrane else 'armor', .035)
    a.strut('Wing ' + role + ' load bone',parent,(0,.06,0),(x,y+.06,z),.105 if role != 'manus' else .075,'steel')
    if role == 'ulna':
        a.strut('Parallel wing radius',parent,(0,.08,-.12),(x,y+.08,z-.12),.055,'steel')
    if membrane:
        for u in [.32,.65]:
            local_chord=start_chord+(end_chord-start_chord)*u
            a.strut('Membrane tension rib',parent,(x*u,.04,z*u),(x*u,.025,z*u-local_chord),.032,'steel')
        return
    count = a.p['featherCount'] if role == 'manus' else 8 if role == 'ulna' else 5
    for i in range(count):
        u=i/(count-1)
        base=(x*(.02+.92*u),z*(.02+.92*u)-.10)
        angle=math.radians(18+58*u) if role=='manus' else math.radians(5+23*u)
        reach=((1.10+.42*math.sin(math.pi*u)) if role=='manus' else .90 if role=='ulna' else .58)*a.p.get('featherScale',1)
        dx,dz=side*math.sin(angle),-math.cos(angle)
        nx,nz=-dz,dx
        width=.23 if role=='manus' else .22
        aft=(side*z/math.hypot(x,z),-abs(x)/math.hypot(x,z))
        def at(t,w):
            px,pz=base[0]+dx*reach*t+nx*width*w,base[1]+dz*reach*t+nz*width*w
            distance=px*aft[0]+pz*aft[1]
            correction=max(0,.025-distance)
            return (px+aft[0]*correction,pz+aft[1]*correction)
        points=[at(-.06,-.4),at(.20,-.55),at(.80,-.32),at(1,0),at(.72,.52),at(.10,.50)]
        label='Fanned primary feather' if role=='manus' else 'Overlapping secondary feather' if role=='ulna' else 'Layered shoulder covert'
        wing(a,label,parent,points,(0,.045+i*.004,0),'armor',.035)
        if role=='manus':
            wing(a,'Primary feather dark tip',parent,[at(.78,-.33),at(1,0),at(.72,.51)],(0,.065+i*.004,0),'shade',.016)
        start,tip=at(0,0),at(.78,0)
        a.strut('Remex central vane',parent,(start[0],.08+i*.004,start[1]),
                (tip[0],.08+i*.004,tip[1]),.012,'brass')


def flight_wings(a, folded=False):
    positions={name:pos for name,_,pos in a.spec['joints']}
    for side,suffix in [(-1,'r'),(1,'l')]:
        root=('shoulder_' if folded else 'wing_')+suffix
        elbow='elbow_'+suffix if folded else root+'_outer'
        wrist='wrist_'+suffix if folded else root+'_wrist'
        membrane=a.p.get('membraneWing',a.spec['recipe']=='pterosaur')
        manus=a.p.get('manusEnd',[a.p['primaryLength'],0,.08])
        for parent,end,role in [(root,positions[elbow],'humerus'),(elbow,positions[wrist],'ulna'),
                                (wrist,(side*manus[0],manus[1],manus[2]),'manus')]:
            flight_panel(a,parent,side,end,role,membrane)
            ellipsoid(a,'Overlapping wing '+role+' hinge cover',parent,(.34,.22,.38),(0,.03,0),'armor',12,6)


def flyer_body(a):
    p, r = a.p, a.spec['recipe']
    if r == 'slab':
        depth = p['bodyDepth']
        for y in [-depth * .24, depth * .24]: a.box('Thick industrial slab', 'tilt', (p['width'], depth * .52, p['length']), (0, y, 0), 'armor', .08)
        for z in [-1.35, -.65, .2, 1.05]: a.box('External cross reinforcement rib', 'tilt', (p['width'] + .2, .12, .18), (0, depth * .5 + .04, z), 'dark')
        a.box('Asymmetric repaired panel', 'tilt', (.7, .065, .9), (-.3, depth * .5 + .05, -.35), 'shade')
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
        if r != 'dragon':
            ellipsoid(a,'Deep flight breast','chest',(p['width']*1.15,.92,1.45),(0,-.04,.06),'armor')
            ellipsoid(a,'Separate avian pelvic croup','pelvis',(p['width']*.76,.61,1.05),(0,.03,-.18),'shade',16,8)
            a.loft('Flexible avian lumbar waist','waist',[(-.36,p['width']*.72,.55),(-.12,p['width']*.64,.49),(.20,p['width']*.83,.66)],'shade',axis='z')
            neck_end = next(pos for name, _, pos in a.spec['joints'] if name == 'sensor')
            a.strut('Avian cervical actuator','neck',(0,0,0),neck_end,.18,'dark')
            ellipsoid(a,'Avian neck collar','neck',(.34,.30,.40),(0,0,neck_end[2]*.45),'shade',12,6)
        if r == 'dragon':
            from mathutils import Vector
            positions={name:pos for name,_,pos in a.spec['joints']}
            for i,name in enumerate(a.spec['rig']['bodySegments']):
                chain=a.spec['rig']['bodySegments']
                end=positions[chain[i+1]] if i+1<len(chain) else positions['tail_0']
                length=Vector(end).length
                width=p['width']*(1.14-i*.085)
                obj=a.loft('Continuous serpentine thoracoabdominal segment',name,
                           [(-.10,width,width*.9),(length*.45,width*.98,width*.88),
                            (length+.10,width*.92,width*.83)],'armor')
                obj.rotation_euler=Vector((end[0],-end[2],end[1])).to_track_quat('Z','Y').to_euler()
                ellipsoid(a,'Overlapping serpentine joint collar',name,(width*.96,width*.86,width*.76),(0,0,0),'shade',12,6)
            chain=a.spec['rig']['cervicals']
            for i,name in enumerate(chain):
                end=positions[chain[i+1]] if i+1<len(chain) else positions['sensor']
                length=Vector(end).length
                width=p['neckWidths'][i]
                next_width=p['neckWidths'][i+1] if i+1<len(chain) else .48
                obj=a.loft('Continuous ophidian cervical sheath',name,[(-.09,width,width*.82),(length*.5,(width+next_width)*.5,(width+next_width)*.40),(length+.09,next_width,next_width*.82)],'armor')
                obj.rotation_euler=Vector((end[0],-end[2],end[1])).to_track_quat('Z','Y').to_euler()
                ellipsoid(a,'Overlapping ophidian cervical joint',name,(width*.98,width*.80,.24),(0,0,0),'shade',12,6)
            ellipsoid(a,'Low ophidian dragon cranial vault','sensor',p['skullSize'],(0,.10,-.03),'armor')
            a.loft('Broad low ophidian upper snout','sensor',[(-.34,.50,.37),(.02,.94,.42),(.61,.78,.31),(1.09,.66,.27),(1.23,.51,.23)],'armor',(0,.12,0),axis='z')
            a.loft('Dragon lower mandible','dragon_jaw',[(.07,.78,.23),(.77,.61,.18),(1.14,.49,.15)],'shade',(0,-.08,0),axis='z')
            eyes(a,'sensor',(0,.28,.51),.90)
            for side in [-1, 1]:
                spike(a,'Eastern dragon horn','sensor',(side*.37,.49,-.22),(side*.61,1.05,-.60),.17,'brass')
                spike(a,'Swept dragon cheek horn','sensor',(side*.44,.03,.03),(side*.81,.23,-.53),.12,'armor')
                a.disk('Dragon nostril','sensor',.068,.018,(side*.28,.35,1.09),'dark','y',10)
                a.strut('Long mechanical whisker','sensor',(side*.31,-.07,.92),(side*1.01,-.20,1.44),.030,'steel')
                for z in [.30,.50,.70,.88]: spike(a,'Dragon visible tooth','sensor',(side*(.35-.10*z),.015,z),(side*(.34-.10*z),-.16,z+.03),.057,'steel')
            for i in range(5):
                for side in [-1, 1]: a.plate('Sakura petal marking', 'tilt', [(0, 0), (.09, .11), (0, .2), (-.09, .11)], .014, (side * .43, .08, -.75 + i * .28), 'red')
        else:
            ellipsoid(a, 'Raptor sensor head', 'sensor', (.5, .55, .65), (0, .2, 0), 'armor')
            if r == 'eagle':
                a.loft('Hooked black eagle beak', 'sensor', [(.12, .26, .2), (.55, .11, .16), (.65, .025, .27)], 'dark', (0, .1, 0), axis='z')
                for side in [-1, 1]: ellipsoid(a, 'Golden raptor eye', 'sensor', (.12, .12, .1), (side * .21, .3, .24), 'glow', 10, 6)
            else:
                a.loft('Pointed pterosaur upper rostrum', 'sensor', [(0, .38, .29), (.75, .23, .18), (1.65, .012, .012)], 'armor', (0,.10,0), axis='z')
                a.loft('Pointed pterosaur lower mandible', 'sensor', [(0,.30,.12),(.70,.20,.08),(1.58,.01,.01)], 'shade', (0,-.10,0), axis='z')
                ellipsoid(a, 'Red monocular sensor', 'sensor', (.16, .14, .08), (-.23, .24, .2), 'glow', 10, 6)
                spike(a, 'Pterosaur swept crest', 'sensor', (0, .3, -.2), (0, .55, -.8), .13, 'armor')
        positions={name:pos for name,_,pos in a.spec['joints']}
        for leg in a.spec['rig']['flightLegs']:
            owner=leg['root']
            for i,name in enumerate(leg['chain']):
                animal_limb(a,owner,positions[name],.20-i*.04,leg['role'],i)
                owner=name
            for j in range(3):
                spike(a,'Trailing pterosaur flight toe' if r=='pterosaur' else 'Articulated tucked flight talon',
                      owner,((j-1)*.08,0,0),((j-1)*.1,-.10,-.24 if r=='pterosaur' else .22),.04,'brass')
        flight_wings(a)
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
            if r == 'canard':
                # Both panels meet at the authored hinge; the outer driver must carry real geometry.
                pivot = next(pos for name, _, pos in a.spec['joints'] if name == owner + '_outer')
                cut = abs(pivot[0])
                front, rear = .8 - 2.5 * cut / span, -1.7 - .3 * cut / (span * .6)
                wing(a, 'Reference wing planform', owner,
                     [(0, .8), (side * cut, front), (side * cut, rear), (0, -1.7)], (0, 0, 0), 'armor', .13)
                outer = [(side * cut, front), (side * span, -1.7), (side * span * .6, -2), (side * cut, rear)]
                wing(a, 'Articulated outer delta panel', owner + '_outer',
                     [(x - pivot[0], z - pivot[2]) for x, z in outer], (0, 0, 0), 'armor', .13)
                a.disk('Main wing fold hinge', owner + '_outer', .16, .28, (0, 0, 0), 'steel', 'z')
            else:
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
                    ornament_owner = owner
                    if r == 'canard' and abs(x) > cut:
                        ornament_owner += '_outer'
                        x, z = x - pivot[0], z - pivot[2]
                    for dx, dz in [(.22, 0), (0, .2), (-.22, 0), (0, -.2)]: a.strut('Etched geometric wing ornament', ornament_owner, (x, .09, z), (x + dx, .09, z + dz), .025, 'brass' if r == 'delta' else 'glow')
            if r == 'canard':
                wing(a, 'Forward canard', 'tilt', [(0, .3), (side * 1.3, 0), (side * 1, -.38), (0, -.2)], (0, .05, 1.45), 'shade')
            if r not in ['delta', 'canard', 'twinboom']:
                tailplane = wing(a, 'Tailplane', 'tilt', [(0, .25), (side * 1.05, -.15), (side * .85, -.65), (0, -.5)], (0, .05 if r != 'glider' else .15, -p['length'] * .45), 'shade')
                if r == 'glider': tailplane.rotation_euler[1] = -side * .6
                if r == 'glider': a.strut('V tail elevated spar', 'tilt', (0, .1, -p['length'] * .4), (side * .8, .7, -p['length'] * .5), .07, 'brass')
        if r == 'zero':
            a.tube('Nose engine cowling', 'tilt', .47, .33, .7, (0, -.02, 1.85), 'dark', segments=24)
            wing(a,'Forward triangular shovel ram','tilt',[(-.58,0),(.58,0),(0,p['ramLength'])],(0,-.10,2.35),'steel',.14)
            fin = a.plate('Vertical tail fin', 'tilt', [(-.1, 0), (-.2, .8), (.3, .9), (.45, 0)], .09, (0, 0, -2.1), 'shade')
            a.rotate(fin, 'y', math.pi / 2)
        if r == 'canard':
            a.plate('Diamond blue nose sensor', 'sensor', [(0, .24), (.2, 0), (0, -.24), (-.2, 0)], .045, (0, .03, .55), 'glow')
            a.tube('Rear jet nozzle', 'tilt', .28, .21, .5, (0, 0, -2), 'dark')
            fin=a.plate('Canard aircraft vertical stabilizer','tilt',
                        [(-.50,0),(.48,0),(.12,1.05),(-.35,.76)],.10,(0,.12,-1.78),'armor')
            a.rotate(fin,'y',math.pi/2)
        if r == 'delta':
            for side in [-1, 1]:
                fin = a.plate('Twin rear vertical fin', 'tilt', [(-.4, 0), (.2, 0), (.05, .8), (-.35, .5)], .085, (side * p['tailFinOffset'], .02, -1.55), 'dark')
                a.rotate(fin, 'y', math.pi / 2)
                a.rotate(fin, 'z', -side*p['tailFinCant'])
        if r == 'twinboom':
            for side in [-1, 1]:
                a.loft('Parallel rear tail boom', 'tilt', [(-2.5, .23, .22), (-.2, .29, .25)], 'shade', (side * 1.1, 0, 0), axis='z')
                for i in range(4):
                    at = (side * .6, .25, -.65 + i * .5)
                    a.strut('Dipole antenna mast', 'tilt', at, (at[0], .72, at[2]), .025, 'steel')
                    a.strut('Dipole antenna crossbar', 'tilt', (at[0] - .18, .72, at[2]), (at[0] + .18, .72, at[2]), .025, 'steel')
                a.box('Rescue orange wing band', 'tilt', (.34, .03, .58), (side * 2.8, .095, -.2), 'red')
                fin = a.plate('Twin boom vertical tail support', 'tilt',
                              [(-.28, .08), (-.22, .85), (.22, .85), (.32, .08)],
                              .10, (side * 1.1, 0, -2.35), 'shade')
                a.rotate(fin, 'y', math.pi / 2)
            a.box('Inverted U tail bridge', 'tilt', (2.4, .1, .55), (0, .85, -2.35), 'armor')
    rotors(a)


def weapons(a):
    p, r = a.p, a.spec['recipe']
    positions = {name: pos for name, _, pos in a.spec['joints']}
    length = positions['light_muzzle'][2]
    a.loft('Light weapon receiver', 'gun_recoil', [(-.27, .34, .3), (.26, .32, .28)], 'brass' if r == 'roo' else 'dark', axis='z')
    count = 4 if r == 'fpv' else 2 if r in ['eagle', 'crane', 'trex', 'zero', 'canard', 'roo', 'stego', 'pterosaur','medical'] else 1
    for i in range(count):
        x = (i - (count - 1) / 2) * (1.8 if r == 'trex' else 1.35 if r == 'stego' else 1.5 if r == 'zero' else p['pairedWeaponSpacing']*2 if r=='medical' else .12)
        if r=='medical':
            a.box('Paired medical sniper receiver','gun_recoil',(.27,.29,.50),(x,0,.15),'shade',.03)
            a.tube('Paired medical sniper scope','gun',.07,.038,.42,(x,.25,.2),'shade',segments=12)
        if r == 'zero': a.box('Paired wingroot shotgun pod', 'gun_recoil', (.28, .28, .5), (x, 0, .15), 'shade')
        a.tube('Light weapon open bore', 'gun_recoil', .065 if count > 1 else .09, .035 if count > 1 else .052, length - .2, (x, 0, (length + .2) / 2), 'steel', segments=12)
        for z in [.3, length * .65]: a.tube('Weapon cooling collar', 'gun_recoil', .09 if count > 1 else .12, .065 if count > 1 else .09, .06, (x, 0, z), 'shade', segments=12)
    a.disk('Light muzzle emission', 'light_muzzle', .045, .014, (0, 0, 0), 'glow')
    if r in ['centaur', 'glider', 'medical']:
        for side in [-1, 1]: a.strut('Sniper electromagnetic rail', 'gun_recoil', (side * .14, .11, .25), (side * .14, .11, length), .045, 'brass')
        if r!='medical':
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
        a.strut('Revolver axe reinforced handle','heavy',(0,-.9,.44),(0,.38,.44),.18,'dark')
        blade = wing(a,'Crescent axe blade','heavy',[(.08,.35),(.30,.34),(.70,.56),(.96,1.0),(.96,1.45),(.69,1.73),(.29,1.55),(.10,1.18)],(0,-.14,0),'armor',.18)
        edge = wing(a,'Axe sharpened curved cutting edge','heavy',[(.70,.56),(.96,1.0),(.96,1.45),(.69,1.73),(.61,1.55),(.82,1.36),(.82,1.02),(.59,.69)],(0,-.14,0),'steel',.20)
        for obj in [blade,edge]: a.rotate(obj,'z',-math.pi/2)
        for i in range(5): a.box('Cyan axe rune','heavy',(.026,.06,.10),(-.11,-.60-i*.065,.79+i*.14),'glow',.005)
    elif r == 'colossus':
        a.tube('Recessed forehead electromagnetic aperture','forehead_bore',.17,.125,.18,(0,0,.05),'dark',segments=16)
        a.tube('Internal forehead coil','forehead_bore',.125,.09,.035,(0,0,.13),'steel',segments=16)
        a.plate('Closed forehead cannon shutter','charge_hinge',[(-.29,0),(.29,0),(.29,-.39),(-.29,-.39)],.09,(0,0,0),'armor')
        a.box('Forehead shutter central seam','charge_hinge',(.026,.34,.012),(0,-.19,.052),'shade',.002)
    elif r == 'dragon':
        a.tube('Recessed dragon oral sonic resonator','heavy',.18,.12,.26,(0,0,.41),'dark',segments=16)
    elif r in ['colossus', 'trex', 'crane', 'seraph', 'gorilla', 'hound', 'pterosaur', 'dragon', 'canard', 'glider', 'zero']:
        length = positions['heavy_muzzle'][2]
        width = .1 if r == 'glider' else .16 if r == 'pterosaur' else .2 if r in ['crane', 'seraph'] else .26
        a.loft('Heavy electromagnetic receiver', 'heavy', [(-.2, width * 2.2, width * 1.9), (.3, width * 2, width * 1.8)], 'shade', axis='z')
        barrel_parent = 'throat_barrel' if r == 'trex' else 'heavy'
        a.tube('Heavy weapon open bore', barrel_parent, width * .6, width * .36, length, (0, 0, length * .5), 'steel', segments=16)
        for i in range(5): a.tube('Heavy accelerator ring', barrel_parent, width, width * .68, .08, (0, 0, .15 + i * length / 6), 'shade' if r == 'seraph' else 'armor', segments=16)
        if r == 'seraph':
            for side in [-1,1]:
                a.box('Long superconducting gun rail','heavy',(.09,.15,length-.85),(side*.19,0,(length-.85)*.5+.50),'shade',.02)
            shaft=p['lanceShaftLength']
            a.tube('Long hybrid lance axial shaft','heavy',.09,.05,shaft,(0,0,0),'steel')
            a.tube('Hybrid lance rear counterweight','heavy',.15,.08,.26,(0,0,-shaft*.5),'shade')
            a.loft('Hybrid lance electromagnetic collar','heavy',[(-.28,.34,.32),(.28,.28,.26)],'armor',(0,0,length-.36),axis='z')
            spike(a,'Hybrid lance cutting spearhead','heavy',(0,0,length-.12),(0,0,length+p['lanceHeadLength']),.22,'steel')
            for side in [-1,1]:
                spike(a,'Hybrid lance blade edge','heavy',(side*.20,0,length+.04),(0,0,length+p['lanceHeadLength']),.055,'glow')
        if r == 'crane': spike(a, 'Photon lance blade', 'heavy', (0, 0, .25), (0, 0, 1.55), .14, 'glow')
    elif r == 'eagle':
        for side in [-1, 1]:
            for j in range(2):
                a.loft('Exactly four feather missiles', 'heavy', [(-.5, .12, .12), (.6, .12, .12), (.8, .012, .012)], 'steel', (side * (.6 + j * .22), .12, 0), axis='z')
                a.box('Feather missile release rail', 'heavy', (.07, .06, 1.1), (side * (.6 + j * .22), .05, -.05), 'shade')
    elif r == 'stego':
        for side in [-1, 1]:
            for i in range(4):
                z = -1.65 + i * .94 + (.20 if side > 0 else 0)
                height = p['plateHeights'][i]
                # Plates lie in the sagittal YZ plane, with their thin axis across the spine.
                plate = a.plate('Eight pentagonal launch backplates','heavy',[(-.28,0),(-.46,height*.60),(0,height),(.43,height*.70),(.3,0)],.14,(side*.40,.04,z),'armor')
                a.rotate(plate,'y',math.pi/2)
                for dz in [-.13,.13]:
                    a.strut('Mechanical backplate launch rail','heavy',(side*.49,.14,z+dz),(side*.49,height*.83,z+dz),.065,'dark')
                a.box('Backplate hazard stripe','heavy',(.03,.07,.40),(side*.49,.22,z),'brass',.005)
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
    elif r == 'centaur':
        a.box('Dorsal launcher mounting saddle','launcher_base',(.84,.17,.74),(0,-.08,0),'dark',.045)
        for side in [-1,1]:
            a.tube('Launcher fixed telescopic guide','launcher_base',.115,.075,.64,(side*.31,.20,0),'shade','y',12)
            a.strut('Launcher extensible piston','launcher_piston',(side*.31,0,0),
                    (side*.31,a.spec['rig']['launcher']['extension'],0),.07,'steel')
            a.strut('Launcher moving support rail','launcher_lift',(side*.31,-.12,0),(side*.31,.32,0),.10,'steel')
        a.disk('Launcher elevation hinge','heavy',.18,.95,(0,0,0),'brass','x',16)
        pod_x = a.nodes['heavy_muzzle'].location.x
        # Outboard launch cells clear the rider without lifting the rack above the helmet.
        a.box('Low dorsal launcher crossbeam','heavy',(2*pod_x,.14,.28),(0,.08,0),'steel',.025)
        for side in [-1,1]:
            x = side * pod_x
            a.box('Dorsal multi-rocket armored rack','heavy',(.42,1.28,.72),(x,.40,0),'shade',.06)
            for z in [-.22,0,.22]:
                a.tube('Dorsal rocket launch cell','heavy',.105,.079,1.40,(x,.48,z),'steel','y',12)
    else:
        vertical = False
        size = (.75, 1.45, .7) if vertical else (.8, .55, .85)
        a.box('Heavy payload armored housing', 'heavy', size, (0, .3 if vertical else 0, 0), 'shade', .055)
        for x in [-.2, .2]:
            a.tube('Payload launcher open cell', 'heavy', .15, .115, .9, (x, .5 if vertical else 0, .3 if not vertical else 0), 'steel', 'y' if vertical else 'z', 12)
        if r == 'twinboom':
            for side in [-1, 1]:
                a.box('Underwing rocket pod', 'heavy', (.45, .45, 1), (side * 1.7, -.6, 0), 'shade')
                for x in [-.1, .1]: a.tube('Underwing rocket bore', 'heavy', .075, .052, .8, (side * 1.7 + x, -.6, .3), 'steel', segments=10)
    if r not in ['colossus','dragon']:
        a.box('Reversible heavy charge aperture', 'charge_hinge', (.46, .06, .42), (0, 0, .2), 'armor', .015)
        a.box('Charge aperture luminous edge', 'charge_hinge', (.35, .025, .02), (0, .04, .4), 'glow', .003)
    a.disk('Heavy muzzle emission', 'heavy_muzzle', .07, .012, (0, 0, 0), 'glow')


def emitters(a):
    aerial = a.spec['kind'] == 'aerial'
    compact_emitters(a)
    a.barrier('barrier', 1.5 if aerial else 1.65, 1.1 if aerial else 1.9)
    a.disk('Articulated cast energy dish', 'cast_dish', .28, .08, (0, 0, 0), 'shade')
    a.tube('Cast dish luminous annulus', 'cast_dish', .25, .2, .03, (0, 0, .06), 'glow')


def compact_emitters(a):
    housing='dark' if a.spec['id']=='s01' else 'shade'
    for mount in a.spec['motion']['shield'].get('mounts', []):
        radius=mount['radius']
        a.disk('Compact flush shield transducer',mount['node'],radius,mount['depth'],(0,0,0),housing,mount['axis'],16)
        a.tube('Shield transducer luminous annulus',mount['node'],radius*.86,radius*.65,mount['depth']*1.12,
               (0,0,0),'glow',mount['axis'],16)


def construct(asset):
    flyer_body(asset) if asset.spec['kind'] == 'aerial' else ground(asset)
    weapons(asset)
    weapon_grips(asset)
    emitters(asset)
