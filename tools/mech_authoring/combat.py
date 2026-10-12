"""Presentation geometry and sampled action tracks attached to existing rigid driver joints."""
import math
import importlib
import ability
import hashlib
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


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
    lattice = '電漿矩陣' in text
    flechette = '箭彈' in text
    drum = '彈鼓' in text
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
        span = (hi - lo) * .24
        if pressure or staff:
            for j, fraction in enumerate([.28, .56, .86] if pressure else [.62, .82, .98]):
                skew = 0 if pressure else (i / max(1, len(bins) - 1) - .5) * .13
                a, b, c = [point(angle, skew, reach * fraction) for angle in [lo, mid, hi]]
                inner = .93 if pressure else .98
                asset.mesh('Compression front' if pressure else 'Swept staff blade', node,
                           [a, b, c, *[tuple(v * inner for v in p) for p in [a, b, c]]],
                           [(0, 1, 4, 3), (1, 2, 5, 4)], 'fx_color' if j == 1 else 'fx_accent')
            if staff:
                path = [point(mid + span * (-1 if j % 2 else 1), 0, reach * f)
                        for j, f in enumerate([.18, .34, .48, .64])]
                for a, b in zip(path, path[1:]):
                    asset.strut('Cudgel ground fissure', node, a, b, .002, 'fx_core')
        elif lattice:
            for j in range(2):
                near, far = reach * (.28 + j * .3), reach * (.52 + j * .3)
                for side in [-1, 1]:
                    asset.strut('Crossed plasma cell', node,
                                point(mid - span, side * elevation * .48, near),
                                point(mid + span, -side * elevation * .48, far), .002, 'fx_color')
                asset.strut('Plasma transverse rung', node,
                            point(lo, 0, far), point(hi, 0, far), .0025, 'fx_accent')
        elif icy:
            for j in range(3):
                fraction = .42 + j * .19 + (i % 3) * .025
                rise = min(elevation * .65, .08 + j * .035)
                asset.mesh('Radial ice fracture prism', node,
                           [point(mid - span, 0, reach * fraction), point(mid + span, 0, reach * fraction),
                            point(mid, rise, reach * (fraction + .10)), point(mid, -rise * .25, reach * (fraction + .04))],
                           [(0, 1, 2), (0, 3, 1), (0, 2, 3), (1, 3, 2)], 'fx_core' if j == 1 else 'fx_color')
        elif fragments:
            for j in range(4):
                fraction = .38 + j * .15 + (i % 2) * .035
                rise = elevation * (-.65 + j * .42)
                asset.mesh('Separated tungsten denial plate', node,
                           [point(mid - span, rise, reach * fraction), point(mid + span, rise, reach * fraction),
                            point(mid + span, rise + .025, reach * (fraction + .07)),
                            point(mid - span, rise + .025, reach * (fraction + .07))], [(0, 1, 2, 3)],
                           'fx_core' if j % 2 else 'fx_accent')
        else:
            for j in range(2 if flechette else 3 if drum else 4):
                fraction = (.45 if flechette else .2) + j * (.22 if flechette else .16) + (i % 3) * .025
                rise = elevation * ((j % 3 - 1) * .45)
                length = .18 if flechette else .035 if drum else .075
                asset.mesh('Long tungsten flechette' if flechette else 'Separated buckshot streak', node,
                           [point(mid - span * .35, rise, reach * fraction),
                            point(mid + span * .35, rise, reach * fraction),
                            point(mid, rise, reach * (fraction + length))], [(0, 1, 2)],
                           'fx_core' if j % 2 else 'fx_accent')
        for obj in asset.parts[begin:]:
            obj['fan_bin'] = i
    bpy.context.view_layer.update()
    for obj in asset.parts[start:]:
        index = obj['fan_bin']
        lo = -half + index * 2 * half / len(bins)
        hi = -half + (index + 1) * 2 * half / len(bins)
        # Struts carry local rotations; clipping their unbaked vertices would move the wrong angular bin.
        transform = obj.matrix_basis.copy()
        for vertex in obj.data.vertices:
            vertex.co = transform @ vertex.co
        obj.matrix_basis = Matrix.Identity(4)
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
    motion = 'pressure' if pressure else 'sweep' if staff else 'lattice' if lattice else 'freeze' if icy else 'curtain' if fragments else 'pellets'
    radius_keys = ([[0, .08], [.14, .35], [.5, 1], [1, 1]] if motion == 'pellets'
                   else [[0, .15], [.2, .5], [.65, 1], [1, 1]] if motion == 'pressure'
                   else [[0, .65], [.16, 1], [1, 1]] if motion == 'sweep'
                   else [[0, .7], [.35, 1], [1, 1]] if motion == 'freeze'
                   else [[0, 1], [1, 1]])
    opacity_keys = ([[0, .2], [.1, 1], [.35, .4], [.5, .85], [.75, .25], [1, 0]] if motion == 'lattice'
                    else [[0, .1], [.22, 1], [.72, .8], [1, 0]] if motion in ['freeze', 'curtain']
                    else [[0, 1], [.35, .75], [1, 0]])
    return {'count': len(bins), 'vertexBins': vertex_bins, 'motion': motion,
            'radiusKeys': radius_keys, 'opacityKeys': opacity_keys}


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
    anchor=asset.spec['motion']['shield'].get('projectionAnchor')
    if anchor:
        asset.pose('shield_deploy',1)
        bpy.context.view_layer.update()
        at=asset.root.matrix_world.inverted() @ asset.nodes[anchor].matrix_world.translation
        center[0],center[1]=at.x,at.z
        width=max(width,center[0]-low[0]+gap,high[0]-center[0]+gap)
        shield_height=max(shield_height,center[1]-low[2]+gap,high[2]-center[1]+gap)
        if 'forms' in asset.spec: asset._pose_form=previous_form
        asset.reset()
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
        asset.joint(name, parent, at)
        joints.append(asset.spec['joints'][-1])
        return name

    def track(slot, name, channel, axis, keys):
        clips[slot]['tracks'].append({'node': name, 'channel': channel, 'axis': axis, 'keys': keys})

    def pulse(slot, name, delay=0, strength=1, curve=None):
        keys = [[0, .001], [delay, .001]] if delay > 0 else [[0, .001]]
        keys += [[delay + .04, strength], [.72, strength * .55], [1, .001]]
        if curve is not None:
            keys = [[time, max(.001, value * strength)] for time, value in curve]
        for axis in 'xyz':
            track(slot, name, 'scale', axis, keys)

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

    charging=[]
    for slot, weapon in intent['weapons'].items():
        muzzle = asset.spec['rig']['wpn'][slot]['muzzle']
        radius = height * (.045 if slot == 'light' else .075)
        visual=asset.spec['rig']['wpn'][slot].get('visualType')
        type = 'beam' if visual=='emp' else weapon['type']
        payload=next((entry for entry in asset.spec['rig'].get('weaponSequences',{}).get(slot,[]) if entry.get('payload')),None)
        text = weapon['description']
        acoustic = '音波' in text
        microwave = '微波' in text or visual=='emp'
        scan = '掃描' in text or '偵蒐' in text
        phase = '相控' in text
        suppressed = '微聲' in text or '消音' in text
        rotary = '旋轉' in text or '六旋翼' in text or '轉輪' in text or '轉膛' in text
        twin = '雙聯' in text or '雙管' in text
        bow = '磁軌弓' in text
        coil = '高斯' in text or '線圈' in text
        cold = '冷發射' in text
        envelope = ([[0, .08], [.08, 1], [.22, .1], [.34, .85], [.48, .08], [1, 0]] if rotary or twin
                    else [[0, .08], [.09, .35], [.28, 1], [.58, .9], [.8, .2], [1, 0]] if acoustic or microwave
                    else [[0, .05], [.18, .25], [.3, 1], [.42, .1], [.72, .03], [1, 0]] if type == 'rail'
                    else [[0, .1], [.1, 1], [.24, .45], [.52, .08], [1, 0]] if type in ['launcher', 'missile']
                    else [[0, .12], [.06, 1], [.18, .3], [.38, .04], [1, 0]])
        clips[slot]['envelope'] = envelope
        node = joint(slot + '_flash', muzzle)
        if type == 'beam':
            for side in [-1, 1]:
                asset.strut('Optical focus jaw', node, (side * radius, -radius * .6, 0),
                            (side * radius * .35, radius * .6, radius), radius * .10, 'fx_core')
        elif type == 'rail':
            for side in [-1, 1]:
                asset.strut('Released bowstring' if bow else 'Acceleration fork', node,
                            (side * radius * (3 if bow else 1.3), 0, 0),
                            (0, 0, radius * (1.4 if bow else 3)), radius * .09, 'fx_core')
        elif type in ['launcher', 'missile'] or payload:
            asset.loft('Ignition jet', node, [(0, radius * .7, radius * .7), (-radius * 4, radius * 1.8, radius * 1.1)], 'fx_core', axis='z')
        else:
            for i in range(2 if suppressed else 6 if rotary else 4 if weapon['fan'] else 3):
                angle = i * math.tau / (2 if suppressed else 6 if rotary else 4 if weapon['fan'] else 3)
                length = radius * (.65 if suppressed else 2)
                asset.mesh('Muzzle gas petal', node,
                           [(0, 0, 0), (math.cos(angle) * radius * .3, math.sin(angle) * radius * .3, length * .2),
                            (math.cos(angle) * radius, math.sin(angle) * radius, length)], [(0, 1, 2)], 'fx_core')
        pulse(slot, node, curve=envelope)
        if rotary:
            track(slot, node, 'rotation', 'z', [[0, 0], [.4, math.pi], [1, math.tau]])
        wake = joint(slot + '_wake', muzzle)
        if not compact:
            if acoustic:
                for side in [-1, 1]:
                    path = [(side * radius * (1 + i * .2), math.sin(i * .7) * radius, i * radius * .3) for i in range(9)]
                    for a, b in zip(path, path[1:]):
                        asset.strut('Resonator standing wave', wake, a, b, radius * .08, 'fx_accent')
            elif type == 'beam' or type == 'rail':
                for side in [-1, 1]:
                    asset.strut('Collapsing capacitor bracket', wake, (side * radius * 2, -radius, 0),
                                (side * radius * 2, radius, 0), radius * .15, 'fx_accent')
            elif type in ['launcher', 'missile'] or payload:
                asset.loft('Cold ejection vapour' if cold else 'Backblast wedge', wake,
                           [(-radius, radius, radius), (-radius * 5, radius * 3, radius * 2)], 'fx_muted', axis='z')
            else:
                for side in [-1, 1]:
                    asset.strut('Suppressed gas slip' if suppressed else 'Lateral muzzle brake jet', wake,
                                (side * radius * .5, 0, 0), (side * radius * (1 if suppressed else 3), radius * .3, -radius),
                                radius * .12, 'fx_muted' if suppressed else 'fx_accent')
        pulse(slot, wake, curve=envelope)
        if type == 'beam' or type == 'rail':
            track(slot, wake, 'scale', 'x', [[0, .8], [.24, .22], [.34, 1], [.7, .4], [1, .001]])
        else:
            track(slot, wake, 'position', 'z', [[0, 0], [.2, -radius], [1, -height * .16]])
        if visual=='emp':
            induction=joint('heavy_induction','heavy')
            path=[(-.48+i*.12,0 if i in [0,8] else .09*(-1)**i,.06*math.sin(i*math.pi/2)) for i in range(9)]
            for start_point,end_point in zip(path,path[1:]):
                asset.strut('Intertusk alternating induction current',induction,start_point,end_point,.012,'fx_accent')
            for x in [-.48,.48]:
                asset.tube('Tusk induction corona',induction,.09,.074,.02,(x,0,0),'fx_core')
            track(slot,induction,'scale','x',[[0,1],[1,1]])
            for axis in ['y','z']:
                track(slot,induction,'scale',axis,[[0,.001],[.12,1],[.35,.3],[.5,.001],[1,.001]])
            charging.append(induction)
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
            pulse(slot, rocket, curve=envelope)
            track(slot, rocket, 'position', 'z', [[0, 0], [.12, 0], [.7, height * .8], [1, height]])
        elif weapon['fan']:
            ion = joint(slot + '_ion', muzzle)
            fans[slot] = fan_geometry(asset, ion, weapon, intent)
            pulse(slot, ion, curve=envelope)
        elif type == 'beam':
            beam = joint(slot + '_beam', muzzle)
            length = height * .85
            asset.loft('Coherent axial core', beam, [(0, radius * .12, radius * .12), (length, radius * .08, radius * .08)], 'fx_core', axis='z')
            if acoustic:
                for side in [-1, 1]:
                    path = [(math.sin(i * math.pi / 3) * radius, side * radius * .22, i / 24 * length) for i in range(25)]
                    for a, b in zip(path, path[1:]):
                        asset.strut('Acoustoelectric sinusoidal ribbon', beam, a, b, radius * .12, 'fx_color')
                for i in range(5):
                    asset.strut('Wave antinode', beam, (-radius, 0, length * (i + .5) / 5),
                                (radius, 0, length * (i + .5) / 5), radius * .055, 'fx_accent')
            elif microwave or phase:
                for i in range(6):
                    z = length * (i + .5) / 6
                    if microwave:
                        asset.mesh('Rectangular microwave lobe', beam,
                                   [(-radius, -radius * .5, z), (radius, -radius * .5, z),
                                    (radius, radius * .5, z + length * .035), (-radius, radius * .5, z + length * .035)],
                                   [(0, 1, 2, 3)], 'fx_color')
                    else:
                        side = -1 if i % 2 else 1
                        asset.strut('Alternating phased aperture', beam, (-radius, side * radius * .5, z),
                                    (radius, -side * radius * .5, z + length * .07), radius * .08, 'fx_accent')
            elif scan or '脈衝' in text:
                for i in range(8):
                    z = length * i / 8
                    asset.strut('Range-coded optical packet', beam, (-radius * .6, 0, z),
                                (radius * .6, 0, z + length * .025), radius * .12, 'fx_accent')
            elif '星相' in text:
                for side in [-1, 1]:
                    asset.mesh('Star instrument focusing blade', beam,
                               [(side * radius, 0, 0), (side * radius * .2, 0, length * .55), (0, 0, length)], [(0, 1, 2)], 'fx_color')
                    asset.mesh('Orthogonal star focusing blade', beam,
                               [(0, side * radius, 0), (0, side * radius * .2, length * .55), (0, 0, length)], [(0, 1, 2)], 'fx_accent')
            else:
                for side in [-1, 1]:
                    asset.strut('Optical spear edge' if '長矛' in text else 'Precision sight rail', beam,
                                (side * radius * .7, 0, 0), (0, 0, length), radius * .035, 'fx_accent')
            pulse(slot, beam, curve=envelope)
        else:
            bullet = joint(slot + '_bullet', muzzle)
            if payload:
                bpy.context.view_layer.update()
                owner=asset.nodes[payload['payload']]
                inverse=owner.matrix_world.inverted()
                tip=inverse @ asset.nodes[muzzle].matrix_world.translation
                for source in asset.parts[:start]:
                    if source.parent!=owner:
                        continue
                    points=[inverse @ source.matrix_world @ vertex.co-tip for vertex in source.data.vertices]
                    vertices=[(point.x,point.z,-point.y) for point in points]
                    asset.mesh('Ejected authored feather missile',bullet,vertices,
                               [tuple(face.vertices) for face in source.data.polygons],'fx_color')
            else:
                asset.loft('Kinetic penetrator' if type == 'rail' else 'Ballistic tracer body', bullet,
                           [(-radius * 4, .01, .01), (0, radius * .4, radius * .4), (radius * 3, .01, .01)], 'fx_core', axis='z')
            if type == 'rail':
                if bow:
                    for side in [-1, 1]:
                        asset.mesh('Rail arrow fletching', bullet,
                                   [(0, 0, -radius * 4), (side * radius, 0, -radius * 3), (0, 0, -radius)], [(0, 1, 2)], 'fx_accent')
                elif coil:
                    for i in range(5):
                        z = -radius * i
                        asset.strut('Sequential induction tooth', bullet, (-radius, -radius * .4, z),
                                    (radius, radius * .4, z + radius * .3), radius * .12, 'fx_color')
                else:
                    for side in [-1, 1]:
                        asset.mesh('Split rail sabot', bullet,
                                   [(side * radius * .2, 0, radius), (side * radius * 1.6, 0, -radius * 3),
                                    (side * radius * .3, radius * .4, -radius * 2)], [(0, 1, 2)], 'fx_color')
                if '長矛' in text:
                    asset.mesh('Electromagnetic spear blade', bullet, [(-radius, 0, 0), (0, radius, radius * 5),
                               (radius, 0, 0), (0, -radius, radius * 5)], [(0, 1, 2), (0, 2, 3)], 'fx_accent')
            elif '微聲' in text or '消音' in text:
                asset.loft('Suppressed needle wake', bullet, [(-radius * 6, .008, .008), (radius * 2, .008, .008)], 'fx_accent', axis='z')
            pulse(slot, bullet, curve=envelope)
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
    payloads = {slot: True for slot, entries in asset.spec['rig']['weaponSequences'].items()
                if any(entry.get('payload') for entry in entries)}
    asset.combat = {'intent': intent, 'joints': joints, 'clips': clips, 'discharges': discharges, 'fans': fans, 'payloads': payloads,
                    'abilityHash': hashlib.sha256(Path(ability.__file__).read_bytes()).hexdigest(),
                    'transported': transported, 'fields': fields, 'charging': charging,
                    'shield': {'node': guard, 'center': center, 'halfWidth': width, 'halfHeight': shield_height, 'clearance': gap}}
    asset.combat_parts = asset.parts[start:]
    for obj in asset.combat_parts:
        obj['presentation_effect'] = True
        for modifier in list(obj.modifiers):
            if modifier.type == 'BEVEL':
                obj.modifiers.remove(modifier)
    reset(asset)
