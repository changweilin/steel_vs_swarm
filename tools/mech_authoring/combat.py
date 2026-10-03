"""Presentation geometry and sampled action tracks attached to existing rigid driver joints."""
import math

import bpy
from mathutils import Vector


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
                                            ('fx_membrane', intent['color'], .12, .8)]:
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

    def ring(name, radius, material, segments=24, at=(0, 0, 0)):
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
        ring(wake, radius * 2, 'fx_accent')
        pulse(slot, wake, .025, 1.4)
        track(slot, wake, 'position', 'z', [[0, 0], [.2, radius], [1, height * .45]])
        type = weapon['type']
        if type in ['launcher', 'missile']:
            rocket = joint(slot + '_rocket', muzzle)
            asset.loft('Armored finned missile', rocket, [(-radius * 3, radius, radius), (radius * 2, radius, radius), (radius * 4, .01, .01)], 'fx_color', axis='z')
            for fin in range(4):
                angle = fin * math.pi / 2
                x, y = math.cos(angle) * radius * 2, math.sin(angle) * radius * 2
                asset.mesh('Missile stabilizer', rocket, [(0, 0, -radius * 3), (x, y, -radius * 4),
                           (x, y, -radius), (0, 0, -radius)], [(0, 1, 2, 3)], 'fx_accent')
            asset.loft('Layered rocket exhaust', rocket, [(-radius * 8, .01, .01), (-radius * 3, radius * 1.5, radius * 1.5)], 'fx_accent', axis='z')
            pulse(slot, rocket, .04)
            track(slot, rocket, 'position', 'z', [[0, 0], [.12, 0], [.7, height * .8], [1, height]])
        elif type == 'plasma':
            ion = joint(slot + '_ion', muzzle)
            asset.loft('Ion pressure cone', ion, [(0, .025, .025), (height * .72, radius * 5, radius * 5)], 'fx_membrane', axis='z')
            for strand in range(3):
                for i in range(16):
                    angle = i * .8 + strand * math.tau / 3
                    next_angle = angle + .8
                    r = radius * (1 + i * .18)
                    asset.strut('Braided ion discharge', ion,
                                (math.cos(angle) * r, math.sin(angle) * r, i * height * .045),
                                (math.cos(next_angle) * r, math.sin(next_angle) * r, (i + 1) * height * .045), radius * .12,
                                'fx_accent' if strand else 'fx_core')
            pulse(slot, ion, .02)
            track(slot, ion, 'rotation', 'z', [[0, 0], [1, math.tau]])
        elif type == 'beam':
            beam = joint(slot + '_beam', muzzle)
            asset.loft('Focused beam core', beam, [(0, radius * .4, radius * .4), (height * .85, radius * .20, radius * .20)], 'fx_core', axis='z')
            asset.loft('Beam corona', beam, [(0, radius, radius), (height * .85, radius * .55, radius * .55)], 'fx_color', axis='z')
            for i in range(4):
                ring(beam, radius * (1.6 - i * .15), 'fx_accent', at=(0, 0, i * height * .19))
            pulse(slot, beam, .03)
        else:
            bullet = joint(slot + '_bullet', muzzle)
            asset.loft('Kinetic penetrator' if type == 'rail' else 'Ballistic tracer body', bullet,
                       [(-radius * 4, .01, .01), (0, radius * .4, radius * .4), (radius * 3, .01, .01)], 'fx_core', axis='z')
            if type == 'rail':
                for i in range(3):
                    ring(bullet, radius * (1 + i * .3), 'fx_color', 12, (0, 0, -radius * i * 1.5))
            pulse(slot, bullet, .01)
            track(slot, bullet, 'position', 'z', [[0, 0], [.07, radius * 3], [.4, height * .9], [1, height * 1.3]])

    dish = asset.spec['motion']['cast'][0]['node']
    for slot in ['def', 'atk']:
        tell = joint(slot + '_tell', dish)
        ring(tell, height * .11, 'fx_color', 12 + variant % 5 * 2)
        ring(tell, height * .15, 'fx_accent', 16 + variant % 4 * 2)
        pulse(slot, tell, strength=1.3)
        track(slot, tell, 'rotation', 'z', [[0, 0], [1, math.pi * (1 if slot == 'def' else -1)]])
    contact = joint('atk_contact', None, (center[0], center[1], center[2] + height * .25))
    ring(contact, height * .18, 'fx_accent', 20)
    for i in range(8 + variant % 4):
        angle = i * math.tau / (8 + variant % 4)
        a = (math.cos(angle) * height * .08, math.sin(angle) * height * .08, 0)
        b = (math.cos(angle) * height * .3, math.sin(angle) * height * .3, height * .08)
        asset.strut('Elemental contact ray', contact, a, b, height * .013, 'fx_color')
    pulse('atk', contact, .29, 2.2)
    for slot, motion in [('light', 'fire'), ('heavy', 'charge'), ('def', 'cast'), ('atk', 'cast')]:
        for source in asset.spec['motion'][motion]:
            if source.get('trigger') == 'heavy':
                continue
            keys = [[time, source['rest'] + source['amplitude'] * weight]
                    for time, weight in clips[slot]['envelope']]
            track(slot, source['node'], source['channel'], source['axis'], keys)
    transported = [name for name, _, _ in joints if name.endswith(('_bullet', '_rocket', '_beam', '_ion'))]
    asset.combat = {'intent': intent, 'joints': joints, 'clips': clips,
                    'transported': transported,
                    'shield': {'node': guard, 'center': center, 'halfWidth': width, 'halfHeight': shield_height, 'clearance': gap}}
    asset.combat_parts = asset.parts[start:]
    for obj in asset.combat_parts:
        obj['presentation_effect'] = True
        for modifier in list(obj.modifiers):
            if modifier.type == 'BEVEL':
                obj.modifiers.remove(modifier)
    reset(asset)
