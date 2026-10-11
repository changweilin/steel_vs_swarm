"""Presentation geometry and sampled action tracks attached to existing rigid driver joints."""
import math
import importlib
import ability
import hashlib
from pathlib import Path

import bpy
from mathutils import Vector


def cultural_trace(asset, node, structure, material, size=1):
    paths = {
        'ukrainian_score': [[(-.7, y, 0), (.7, y, 0)] for y in [-.3, -.15, 0, .15, .3]],
        'forge_anvil': [[(-.7, .3, 0), (.7, .3, 0), (.35, 0, 0), (.2, -.3, 0), (-.3, -.3, 0), (-.4, 0, 0), (-.7, .3, 0)]],
        'leviathan_ribs': [[(-.7 * math.sin(i / 15 * math.pi), -.4 + i / 15 * .8, 0), (0, -.4 + i / 15 * .8, .12), (.7 * math.sin(i / 15 * math.pi), -.4 + i / 15 * .8, 0)] for i in range(16)],
        'shura_deadline': [[(x, -.6, 0), (x + .3, .6, 0)] for x in [-.5, -.2, .1]],
        'neon_synapse': [[(-.6, -.35, 0), (-.3, -.35, 0), (-.3, .1, 0), (0, .1, 0), (0, .4, 0), (.6, .4, 0)]],
        'elegy_tally': [[(x, -.5, 0), (x, .4, 0), (x + .16, .5, 0), (x + .32, .4, 0), (x + .32, -.5, 0)] for x in [-.65, -.15, .35]],
        'proof_chords': [[(-.6, -.4, 0), (.5, -.2, 0), (0, .6, 0), (-.6, -.4, 0), (.6, .45, 0), (.5, -.2, 0)]],
        'krakow_rose': [[(math.cos(a) * .5, math.sin(a) * .5, 0), (0, 0, .18), (math.cos(a + .4) * .7, math.sin(a + .4) * .7, 0)] for a in [i * math.tau / 8 for i in range(8)]],
        'outback_brand': [[(-.6, -.4, 0), (-.25, .5, 0), (.1, -.4, 0), (.45, .5, 0), (.65, -.4, 0)]],
        'spectrum_feather': [[(-.6, y, 0), (0, y + .2, 0), (.6, y, 0)] for y in [-.4, -.2, 0, .2]],
        'watch_escapement': [[(-.6, .4, 0), (-.2, .2, 0), (0, -.5, 0), (.2, .2, 0), (.6, .4, 0)]],
        'crimea_starpath': [[(-.65, -.2, 0), (-.25, .5, 0), (.1, -.4, 0), (.4, .4, 0), (.65, -.1, 0)]],
        'ural_artillery': [[(-.6, -.4, 0), (-.3, .4, 0), (0, -.4, 0), (.3, .4, 0), (.6, -.4, 0)], [(-.6, -.4, 0), (.6, -.4, 0)]],
        'neural_seventh': [[(-.6 + i * .2, math.sin(i * .9) * .3, 0), (-.6 + (i + 1) * .2, math.sin((i + 1) * .9) * .3, 0)] for i in range(6)],
        'xianxia_furnace': [[(-.5, .5, 0), (-.6, -.2, 0), (-.3, -.5, 0), (.3, -.5, 0), (.6, -.2, 0), (.5, .5, 0)], [(-.2, -.2, 0), (0, .4, 0), (.2, -.2, 0)]],
        'gru_feather': [[(-.6, -.4, 0), (0, .5, 0), (.6, -.4, 0)], [(-.4, -.1, 0), (.4, -.1, 0)]],
        'crane_blueprint': [[(-.6, .5, 0), (.6, .5, 0), (.6, .25, 0)], [(0, .5, 0), (0, -.4, 0), (.2, -.4, 0), (.2, -.2, 0)]],
        'qitian_cloudstaff': [[(-.7, 0, 0), (.7, 0, 0)], [(-.5, -.2, 0), (-.3, -.4, 0), (0, -.25, 0), (.3, -.4, 0), (.5, -.2, 0)]],
        'pterosaur_arrow': [[(-.6, -.25, 0), (0, .55, 0), (.6, -.25, 0), (0, -.05, 0), (-.6, -.25, 0)]],
        'dragon_aria': [[(-.65 + i * .13, math.sin(i * 1.2) * .4, 0) for i in range(11)]],
        'persian_calligraphy': [[(-.7, -.3, 0), (-.4, .3, 0), (-.1, .4, 0), (.15, -.2, 0), (.4, -.35, 0), (.7, .2, 0)]],
        'mukarnas_arch': [[(-.6, -.5, 0), (-.6, .1, 0), (-.4, .1, 0), (-.4, .35, 0), (0, .6, 0), (.4, .35, 0), (.4, .1, 0), (.6, .1, 0), (.6, -.5, 0)]],
        'trench_whistle': [[(-.7, -.3, 0), (-.35, -.3, 0), (-.35, .1, 0), (.1, .1, 0), (.1, -.15, 0), (.7, -.15, 0)]],
        'firefly_network': [[(-.6, -.3, 0), (-.2, .4, 0), (.2, -.3, 0), (.6, .4, 0)], [(-.6, .3, 0), (.6, -.3, 0)]],
        'raven_batmoon': [[(-.7, .3, 0), (-.3, .15, 0), (0, -.5, 0), (.3, .15, 0), (.7, .3, 0), (.45, -.2, 0), (0, -.5, 0), (-.45, -.2, 0), (-.7, .3, 0)]],
        'titan_strata': [[(-.65, y, 0), (-.25, y + .15, 0), (.2, y + .05, 0), (.65, y + .2, 0)] for y in [-.4, -.1, .2]],
        'alpine_aurora': [[(-.7, -.3, 0), (-.3, .5, 0), (0, -.1, 0), (.3, .3, 0), (.7, -.3, 0)]],
        'steppe_eagle': [[(-.7, .2, 0), (-.35, -.1, 0), (0, .5, 0), (.35, -.1, 0), (.7, .2, 0)], [(0, .5, 0), (0, -.5, 0)]],
        'blackout_breaker': [[(-.55, .5, 0), (-.1, .5, 0), (-.3, .05, 0), (.25, .05, 0), (-.2, -.5, 0)], [(.4, .5, 0), (.6, .25, 0)]],
        'carnival_rotor': [[(-.7, 0, 0), (.7, 0, 0)], [(0, -.5, 0), (0, .5, 0)], [(-.5, -.35, 0), (.5, .35, 0)]],
        'border_gate': [[(-.6, -.5, 0), (-.6, .5, 0), (-.35, .5, 0), (-.35, -.5, 0)], [(.35, -.5, 0), (.35, .5, 0), (.6, .5, 0), (.6, -.5, 0)]],
        'contract_empty': [[(-.6, .1, 0), (-.15, -.4, 0), (.6, .5, 0)], [(-.6, -.55, 0), (.6, -.55, 0)]],
    }
    if structure not in paths:
        raise ValueError('Missing cultural construction: ' + structure)
    for path in paths[structure]:
        for a, b in zip(path, path[1:]):
            asset.strut(structure, node, (a[0] * size, (.02 + a[2]) * size, a[1] * size),
                        (b[0] * size, (.02 + b[2]) * size, b[1] * size), .014 * size, material)


def fan_geometry(asset, node, weapon, intent):
    start = len(asset.parts)
    text = weapon['description']
    icy = '深冷' in text
    pressure = '氣浪' in text
    staff = '長棍' in text
    fragments = '破片' in text
    half = weapon['arc']
    bins = weapon['bins']
    for i, reach in enumerate(bins):
        begin = len(asset.parts)
        lo = -half + i * 2 * half / len(bins)
        hi = -half + (i + 1) * 2 * half / len(bins)
        mid = (lo + hi) / 2
        def point(angle, elevation, distance=reach):
            return (math.sin(angle) * math.cos(elevation) * distance,
                    math.sin(elevation) * distance, math.cos(angle) * math.cos(elevation) * distance)
        elevation = math.acos(min(1, math.cos(half) / math.cos(mid)))
        edge = [point(lo, 0), point(mid, elevation), point(hi, 0), point(mid, -elevation)]
        asset.mesh('Authority sub-cone', node, [(0, 0, 0), *edge], [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 1)], 'fx_membrane')
        # Thin ribbons terminate on the same spherical per-bin boundary as settlement.
        for fraction in ([.4, .7, 1] if pressure or staff else [.65, 1]):
            a, b, c = [point(angle, 0, reach * fraction) for angle in [lo, mid, hi]]
            width = .004
            asset.mesh('Frost fracture' if icy else 'Cudgel shock crescent' if staff else 'Pressure front' if pressure else 'Denial fragment chord',
                       node, [a, b, c, (c[0], c[1] + width, c[2]), (b[0], b[1] + width, b[2]), (a[0], a[1] + width, a[2])],
                       [(0, 1, 4, 5), (1, 2, 3, 4)], 'fx_accent')
        if icy or fragments:
            p = point(mid, 0, reach * .8)
            asset.mesh('Ice shard' if icy else 'Tungsten fragment', node,
                       [(p[0] - .008, p[1], p[2] - .04), (p[0] + .008, p[1], p[2] - .04), (p[0], p[1] + .03, p[2])], [(0, 1, 2)], 'fx_core')
        else:
            span = (hi - lo) * .18
            asset.mesh('Sub-cone pressure core', node,
                       [point(mid - span, 0, .10), point(mid + span, 0, .10),
                        point(mid + span, 0, .42), point(mid - span, 0, .42)], [(0, 1, 2, 3)], 'fx_core')
        for obj in asset.parts[begin:]:
            obj['fan_bin'] = i
    for obj in asset.parts[start:]:
        index = obj['fan_bin']
        lo = -half + index * 2 * half / len(bins)
        hi = -half + (index + 1) * 2 * half / len(bins)
        for vertex in obj.data.vertices:
            x, y, z = vertex.co.x, vertex.co.z, max(0, -vertex.co.y)
            length = math.sqrt(x * x + y * y + z * z)
            phi = max(lo, min(hi, math.atan2(x, z)))
            maximum = math.acos(min(1, math.cos(half) / math.cos(phi)))
            elevation = max(-maximum, min(maximum, math.atan2(y, math.hypot(x, z))))
            coordinate = phi / (half * 2 / len(bins)) + len(bins) / 2
            reach = bins[index]
            boundary = round(coordinate)
            # Runtime vertices are rounded to five decimals; shared edges take the shorter neighbour.
            if 0 < boundary < len(bins) and abs(coordinate - boundary) < .002:
                reach = min(bins[boundary - 1], bins[boundary])
            length = min(length, reach - .00002)
            vertex.co = (math.sin(phi) * math.cos(elevation) * length,
                         -math.cos(phi) * math.cos(elevation) * length, math.sin(elevation) * length)
    vertex_bins = {}
    for obj in asset.parts[start:]:
        obj.data.calc_loop_triangles()
        vertex_bins.setdefault(obj['region'], []).extend([obj['fan_bin']] * (len(obj.data.loop_triangles) * 3))
    return {'count': len(bins), 'vertexBins': vertex_bins}


def reset(asset):
    for name, _, _ in asset.combat['joints']:
        asset.nodes[name].scale = (.001,) * 3


def sample(keys, time):
    if time <= keys[0][0]:
        return keys[0][1]
    for (start, value), (end, target) in zip(keys, keys[1:]):
        if time <= end:
            return value + (target - value) * (time - start) / (end - start)
    return keys[-1][1]


def pose(asset, clip, time):
    slot = {'skill': 'def', 'ult': 'atk'}.get(clip, clip)
    action = asset.combat['clips'].get(slot)
    if action:
        for track in action['tracks']:
            node = asset.nodes[track['node']]
            value = sample(track['keys'], time)
            if track['channel'] == 'rotation':
                asset.rotate(node, track['axis'], value)
            else:
                index = {'x': 0, 'y': 2, 'z': 1}[track['axis']]
                getattr(node, 'location' if track['channel'] == 'position' else 'scale')[index] = -value if track['channel'] == 'position' and track['axis'] == 'z' else value
        field = asset.combat['fields'].get(slot)
        if field:
            radius = field['radius'] or asset.spec['height'] * .6
            for name in field['nodes']:
                asset.nodes[name].scale *= radius
                asset.nodes[name].location *= radius
        weapons = asset.combat['intent']['weapons']
        if slot in weapons:
            weapon = weapons[slot]
            if weapon['fan']:
                asset.nodes['fx_' + slot + '_ion'].scale *= weapon['range']
            discharge = asset.combat['discharges'].get(slot)
            if discharge:
                node = asset.nodes[discharge['node']]
                node.scale.x *= discharge['radialScale']
                node.scale.z *= discharge['radialScale']
                node.scale.y *= discharge['lengthScale']
                node.location.y = discharge['origin'] * node.scale.y
    guard = asset.nodes['fx_guard']
    if slot == 'def':
        weight = sample(asset.combat['clips']['def']['envelope'], time)
        guard.scale = (max(.001, weight),) * 3
    elif clip.startswith('shield_'):
        weight = time if clip == 'shield_deploy' else 1 - time
        guard.scale = (max(.001, weight),) * 3
    # Keep the retired membrane out of the new combat scenes; its transducer hardware stays.
    asset.nodes['barrier'].scale = (.001,) * 3


def construct(asset, intent, xyz):
    start = len(asset.parts)
    body = [obj for obj in asset.parts if obj.parent.name != 'barrier']
    compact = len({(obj.parent.name, obj['region']) for obj in asset.parts}) >= 120
    bounds = []
    previous_form = getattr(asset, '_pose_form', 'ground')
    for form in asset.spec.get('forms', {'ground': {}}):
        if 'forms' in asset.spec:
            asset._pose_form = form
        for clip in ['idle', 'run', 'light', 'heavy', 'skill', 'ult', 'shield_deploy']:
            for time in [0, .25, .5, .75, 1]:
                asset.pose('flight_' + clip if form == 'flight' else clip, time)
                bpy.context.view_layer.update()
                bounds.extend(obj.matrix_world @ Vector(corner) for obj in body for corner in obj.bound_box)
    if 'forms' in asset.spec:
        asset._pose_form = previous_form
    asset.reset()
    low = [min(point[i] for point in bounds) for i in range(3)]
    high = [max(point[i] for point in bounds) for i in range(3)]
    height = high[2] - low[2]
    gap = height * .12
    center = [(low[0] + high[0]) / 2, (low[2] + high[2]) / 2, -low[1] + gap]
    width = max(height * .55, (high[0] - low[0]) * .48)
    shield_height = height * .62
    for name, color, opacity, emission in [('fx_color', intent['color'], .7, 2),
                                            ('fx_accent', intent['accent'], .8, 3),
                                            ('fx_core', 0xffffff, .9, 4),
                                            ('fx_membrane', intent['color'], .12, .8),
                                            ('fx_muted', intent['color'], .18, .15),
                                            ('fx_ink', 0x090d16, .82, 0)]:
        desc = {'color': '#%06x' % color, 'opacity': opacity, 'emission': emission}
        asset.spec['materials'][name] = desc
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        bsdf = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        rgb = tuple((channel / 255 / 12.92 if channel / 255 <= .04045 else ((channel / 255 + .055) / 1.055) ** 2.4)
                    for channel in [(color >> 16) & 255, (color >> 8) & 255, color & 255]) + (1,)
        bsdf.inputs['Base Color'].default_value = rgb
        bsdf.inputs['Emission Color'].default_value = rgb
        bsdf.inputs['Emission Strength'].default_value = emission
        bsdf.inputs['Alpha'].default_value = opacity
        asset.materials[name] = material

    joints = []
    fans = {}
    clips = {slot: {'duration': duration, 'tracks': [], 'envelope': [[0, 0], [.12, .2], [.24, 1], [.38, .75], [.7, .15], [1, 0]]}
             for slot, duration in [('light', .28), ('heavy', .7), ('def', .95), ('atk', 1.35)]}

    def joint(name, parent, at=(0, 0, 0)):
        name = 'fx_' + name
        node = bpy.data.objects.new(name, None)
        node.parent = asset.nodes[parent] if parent else asset.root
        node.location = xyz(at)
        bpy.context.collection.objects.link(node)
        asset.nodes[name] = node
        entry = [name, parent, list(at)]
        joints.append(entry)
        asset.spec['joints'].append(entry)
        return name

    def track(slot, name, channel, axis, keys):
        clips[slot]['tracks'].append({'node': name, 'channel': channel, 'axis': axis, 'keys': keys})

    def pulse(slot, name, delay=0, strength=1):
        keys = [[0, .001], [delay, .001]] if delay > 0 else [[0, .001]]
        keys += [[delay + .04, strength], [.72, strength * .55], [1, .001]]
        for axis in 'xyz':
            track(slot, name, 'scale', axis, keys)

    def ring(name, radius, material, segments=12, at=(0, 0, 0)):
        asset.tube('Combat compression annulus', name, radius, radius * .90, .025, at, material, segments=segments)

    guard = joint('guard', None, center)
    sectors = 6 + intent['variant'] % 5 * 2
    points = [(width * math.cos(i * math.tau / sectors), shield_height * math.sin(i * math.tau / sectors)) for i in range(sectors)]
    asset.plate('Forward cultural shield membrane', guard, points, .008, (0, 0, 0), 'fx_membrane')
    for i, a in enumerate(points):
        b = points[(i + 1) % sectors]
        asset.strut('Shield rim segment', guard, (*a, .02), (*b, .02), height * .007, 'fx_accent')
    # Stable cultural variants change line structure as well as color, without consuming scene RNG.
    variant = intent['variant']
    for i in range(4 + variant % 7):
        angle = (i + variant * .11) * math.tau / (4 + variant % 7)
        x, y = math.cos(angle), math.sin(angle)
        a = (width * x * .22, shield_height * y * .22, .025)
        b = (width * x * (.50 + .04 * (i % 4)), shield_height * y * (.50 + .04 * (i % 4)), .025)
        asset.strut(intent['shieldForm'] + ' radial glyph', guard, a, b, height * .005, 'fx_accent')
        tangent = (-y * width * .09, x * shield_height * .09, 0)
        asset.strut(intent['frame'] + ' cultural tick', guard,
                    (b[0] - tangent[0], b[1] - tangent[1], .025),
                    (b[0] + tangent[0], b[1] + tangent[1], .025), height * .005, 'fx_accent')

    for slot, weapon in intent['weapons'].items():
        muzzle = asset.spec['rig']['wpn'][slot]['muzzle']
        radius = height * (.045 if slot == 'light' else .075)
        node = joint(slot + '_flash', muzzle)
        asset.loft('White hot muzzle core', node, [(0, radius * 1.1, radius * 1.1), (radius * 2, .01, .01)], 'fx_core', axis='z')
        pulse(slot, node, strength=1)
        wake = joint(slot + '_wake', muzzle)
        if not compact:
            ring(wake, radius * 2, 'fx_accent')
        pulse(slot, wake, .025, 1.4)
        track(slot, wake, 'position', 'z', [[0, 0], [.2, radius], [1, height * .45]])
        type = weapon['type']
        text = weapon['description']
        if type in ['launcher', 'missile']:
            rocket = joint(slot + '_rocket', muzzle)
            cannon = '加農' in text or '無後座力' in text
            delta = '三角翼' in text
            dart = '多彈頭' in text
            asset.loft('Breach shell' if cannon else 'Guided dart' if dart else 'Armored missile', rocket,
                       [(-radius * 3, radius, radius), (radius * 2, radius * (.6 if dart else 1), radius), (radius * 4, .01, .01)], 'fx_color', axis='z')
            for fin in range(2 if delta else 3 if dart else 4):
                angle = fin * math.tau / (2 if delta else 3 if dart else 4)
                x, y = math.cos(angle) * radius * 2, math.sin(angle) * radius * 2
                asset.mesh('Missile stabilizer', rocket, [(0, 0, -radius * 3), (x, y, -radius * 4),
                           (x, y, -radius), (0, 0, -radius)], [(0, 1, 2, 3)], 'fx_accent')
            asset.loft('Layered rocket exhaust', rocket, [(-radius * 8, .01, .01), (-radius * 3, radius * 1.5, radius * 1.5)], 'fx_accent', axis='z')
            pulse(slot, rocket, .04)
            track(slot, rocket, 'position', 'z', [[0, 0], [.12, 0], [.7, height * .8], [1, height]])
        elif weapon['fan']:
            ion = joint(slot + '_ion', muzzle)
            fans[slot] = fan_geometry(asset, ion, weapon, intent)
            pulse(slot, ion, .02)
        elif type == 'beam':
            beam = joint(slot + '_beam', muzzle)
            asset.loft('Focused beam core', beam, [(0, radius * .4, radius * .4), (height * .85, radius * .20, radius * .20)], 'fx_core', axis='z')
            asset.loft('Beam corona', beam, [(0, radius, radius), (height * .85, radius * .55, radius * .55)], 'fx_color', axis='z')
            acoustic = '聲' in text or '諧振' in text
            phase = '相位' in text or '相控' in text or '微波' in text
            for i in range(7 if acoustic else 5 if phase else 3):
                ring(beam, radius * (1.4 if acoustic else 1.1) * (1 - i * .06), 'fx_accent',
                     segments=16 if acoustic else 8 if phase else 24, at=(0, 0, i * height * (.10 if acoustic else .14)))
            pulse(slot, beam, .03)
        else:
            bullet = joint(slot + '_bullet', muzzle)
            asset.loft('Kinetic penetrator' if type == 'rail' else 'Ballistic tracer body', bullet,
                       [(-radius * 4, .01, .01), (0, radius * .4, radius * .4), (radius * 3, .01, .01)], 'fx_core', axis='z')
            if type == 'rail':
                for i in range(3):
                    ring(bullet, radius * (1 + i * .3), 'fx_color', 12, (0, 0, -radius * i * 1.5))
                if '長矛' in text:
                    asset.mesh('Electromagnetic spear blade', bullet, [(-radius, 0, 0), (0, radius, radius * 5),
                               (radius, 0, 0), (0, -radius, radius * 5)], [(0, 1, 2), (0, 2, 3)], 'fx_accent')
            elif '微聲' in text or '消音' in text:
                asset.loft('Suppressed needle wake', bullet, [(-radius * 6, .008, .008), (radius * 2, .008, .008)], 'fx_accent', axis='z')
            pulse(slot, bullet, .01)
            track(slot, bullet, 'position', 'z', [[0, 0], [.07, radius * 3], [.4, height * .9], [1, height * 1.3]])

    dish = asset.spec['motion']['cast'][0]['node']
    for slot in ['def', 'atk']:
        tell = joint(slot + '_tell', dish)
        paths, _ = ability.recipe(intent['abilities'][slot]['direction']['profileId'])
        for a, b in zip(paths[0][0], paths[0][0][1:]):
            asset.strut('Hardpoint ability contour', tell, tuple(v * height * .12 for v in a),
                        tuple(v * height * .12 for v in b), height * .003, 'fx_accent')
        pulse(slot, tell)
    fields = importlib.reload(ability).cast_geometry(asset, intent, joint, track)
    for slot, motion in [('light', 'fire'), ('heavy', 'charge'), ('def', 'cast'), ('atk', 'cast')]:
        for source in asset.spec['motion'][motion]:
            if source.get('trigger') == 'heavy':
                continue
            keys = [[time, source['rest'] + source['amplitude'] * weight]
                    for time, weight in clips[slot]['envelope']]
            track(slot, source['node'], source['channel'], source['axis'], keys)
    transported = [name for name, _, _ in joints if name.endswith(('_bullet', '_rocket', '_beam', '_ion'))]
    discharges = {}
    bpy.context.view_layer.update()
    for slot, weapon in intent['weapons'].items():
        if weapon['fan'] or not (weapon['type'] == 'beam' or weapon['footprint'] == 'line'):
            continue
        name = 'fx_' + slot + ('_beam' if weapon['type'] == 'beam' else '_bullet')
        points = [obj.matrix_local @ vertex.co for obj in asset.parts[start:]
                  if obj.parent.name == name for vertex in obj.data.vertices]
        radial = max(math.hypot(point.x, point.z) for point in points)
        low, high = min(-point.y for point in points), max(-point.y for point in points)
        discharges[slot] = {'node': name, 'radialScale': weapon['lanceRadius'] / radial,
                            'lengthScale': weapon['range'] / (high - low), 'origin': low}
    asset.combat = {'intent': intent, 'joints': joints, 'clips': clips, 'discharges': discharges, 'fans': fans,
                    'abilityHash': hashlib.sha256(Path(ability.__file__).read_bytes()).hexdigest(),
                    'transported': transported, 'fields': fields,
                    'shield': {'node': guard, 'center': center, 'halfWidth': width, 'halfHeight': shield_height, 'clearance': gap}}
    asset.combat_parts = asset.parts[start:]
    for obj in asset.combat_parts:
        obj['presentation_effect'] = True
        for modifier in list(obj.modifiers):
            if modifier.type == 'BEVEL':
                obj.modifiers.remove(modifier)
    reset(asset)
