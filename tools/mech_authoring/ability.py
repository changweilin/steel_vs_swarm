"""Ability field geometry and phase tracks; runtime only samples these authored channels."""
import math

import bpy
from mathutils import Vector


def arc(rx, rz, y=.04, cx=0, cz=0, start=0, end=math.tau, steps=18):
    return [(cx + rx * math.cos(a), y, cz + rz * math.sin(a))
            for a in [start + (end - start) * i / steps for i in range(steps + 1)]]


def arch(x, z, width=.12, height=.6):
    return [(x - width, .04, z), (x - width, height * .65, z),
            (x, height, z), (x + width, height * .65, z), (x + width, .04, z)]


def arrow(x, z, length=.5, width=.12, y=.04):
    return [(x, y, z - length), (x, y, z), (x - width, y, z - width),
            (x, y, z), (x + width, y, z - width)]


def box(x, z, width=.15, depth=.15, y=.04):
    return [(x - width, y, z - depth), (x + width, y, z - depth),
            (x + width, y, z + depth), (x - width, y, z + depth), (x - width, y, z - depth)]


def feather(x, z, side=1, y=.15):
    return [(x, y, z), (x + side * .38, y + .12, z - .24),
            (x + side * .28, y, z - .3), (x, y, z)]


def spark(x, z, y=.08, size=.065):
    return [[(x - size, y, z), (x + size, y, z)],
            [(x, y, z - size), (x, y + size, z + size)]]


def spiral(turns=1.5, y=.04, inward=False):
    return [(math.cos(a) * r, y + i * .004, math.sin(a) * r)
            for i in range(33)
            for a, r in [(i / 32 * math.tau * turns, .8 - i / 32 * .7 if inward else .1 + i / 32 * .7)]]


def recipe(profile):
    key = profile.split('.')[-1]
    mode = 'expand'
    if key == 'fugue_concord':
        tell = [spiral()] + [[(-.6, .04, z), (.6, .04, z)] for z in [-.12, 0, .12]]
        release = [arc(.65, .25, .2 + i * .1, start=i * .8, end=i * .8 + 2.8) for i in range(3)]
        contact = [[(.2, .6, 0), (0, .04, .2), (-.2, .04, -.3)]]; mode = 'chase'
    elif key == 'sky_orchestra':
        tell = [[(-.8, .55, z), (.8, .55, z)] for z in [-.3, -.15, 0, .15, .3]]
        release = [arch(x, -.15, .2, .75) for x in [-.5, 0, .5]]
        contact = [feather(x, .35, side) for x in [-.45, 0, .45] for side in [-1, 1]]; mode = 'lift'
    elif key == 'tempered_reforge':
        tell = [[(-.65, .03, .3), (.65, .03, .3), (.25, .03, 0), (.15, .03, -.3), (-.3, .03, -.3), (-.25, .03, 0), (-.65, .03, .3)]]
        release = [[(x, .18, z), (x * .25, .1, z * .25), (0, .04, 0)] for x, z in [(-.6,-.5),(.6,-.5),(-.6,.5),(.6,.5)]]
        contact = [[(-.4,.04,-.1),(-.1,.12,.1),(.1,.04,0),(.4,.1,.15)]]; mode = 'inward'
    elif key == 'world_crucible':
        tell = [arc(.35, .25), [(-.35,.04,0),(-.25,.3,0),(.25,.3,0),(.35,.04,0)]]
        release = [[(0,.06,0),(.3*math.cos(a),.04,.3*math.sin(a)),(.8*math.cos(a),.04,.8*math.sin(a))] for a in [i*math.tau/6 for i in range(6)]]
        contact = [arch(.55*math.cos(a),.55*math.sin(a),.07,.3) for a in [i*math.tau/6 for i in range(6)]]; mode = 'flow'
    elif key == 'silent_lobes':
        tell = [arc(.25,.6,cx=x) for x in [-.3,.3]]
        release = [[(x,.05,-.65),(x,.05,.65)] for x in [-.12,-.04,.04,.12]]
        contact = [[(-.45,.12,0),(.45,.12,0)]]; mode = 'close'
    elif key == 'leviathan_song':
        tell = [[(-math.sin(i/15*math.pi)*.65,.04,-.65+i*.085),(0,.2,-.65+i*.085),(math.sin(i/15*math.pi)*.65,.04,-.65+i*.085)] for i in range(16)]
        release = [arc(.35+i*.15,.18+i*.1,.12) for i in range(4)]
        contact = [[(-.75,.2,0),(-.4,.4,.15),(.35,.35,.15),(.7,.2,0),(.35,.2,-.15),(-.4,.2,-.15),(-.75,.2,0)]]; mode = 'outward'
    elif key == 'breakthrough_thrust':
        tell = [[(0,.03,-.85),(0,.03,.8)]]
        release = [arrow(x,.65,.95,.16) for x in [-.2,.2]]
        contact = [[(-.18,.04,.45),(0,.12,.8),(.18,.04,.45),(0,.04,.55),(-.18,.04,.45)]]; mode = 'forward'
    elif key == 'deadline_shura':
        tell = [[(x,.04,-.7),(x+.14,.5,.7)] for x in [-.6,-.3,.2,.5]]
        release = [[(0,.7,0),(x,.04,z),(0,-.2,0)] for x,z in [(-.65,0),(.65,0),(0,-.65),(0,.65)]]
        contact = [[(x-.2,.12,z-.3),(x+.2,.12,z+.3)] for x,z in [(-.3,-.2),(.3,.2),(-.2,.4),(.2,-.4)]]; mode = 'pulse'
    elif key == 'synapse_overclock':
        tell = [[(x,.1,-.65),(x,.15,-.3),(x+.12,.15,-.3),(x+.12,.2,.15),(x,.2,.15),(x,.3,.6)] for x in [-.4,.3]]
        release = [arrow(x,z,.3,.08,.2) for x,z in [(-.2,.4),(0,.6),(.2,.2)]]
        contact = [box(x,0,.06,.3,.35) for x in [-.3,0,.3]]; mode = 'pulse'
    elif key == 'star_swarm_dive':
        tell = [[(x,.75,z),(x*.45,.35,z*.45),(0,.04,0)] for x,z in [(-.65,-.4),(.65,-.4),(-.4,.65),(.4,.65)]]
        release = [[(math.cos(a)*.65,.75,math.sin(a)*.65),(math.cos(a+.6)*.35,.35,math.sin(a+.6)*.35),(math.cos(a)*.45,.02,math.sin(a)*.45)] for a in [i*math.tau/9 for i in range(9)]]
        contact = [p for x,z in [(-.45,-.2),(.4,.25),(-.2,.45),(.2,-.45)] for p in spark(x,z)]; mode = 'drop'
    elif key == 'elegy_intercept':
        tell = [[(x,.02,-.5),(x,.02,.5)] for x in [-.45,-.15,.15,.45]]
        release = [[(math.cos(a)*math.cos(b)*.75,math.sin(b)*.75,math.sin(a)*math.cos(b)*.75) for b in [i/12*math.pi/2 for i in range(13)]] for a in [i*math.tau/6 for i in range(6)]]
        contact = [[(-.6,.5,-.3),(0,.35,0),(.4,.6,.4)]]; mode = 'stitch'
    elif key == 'undying_phalanx':
        tell = [[(-.1,.1,0),(-.1,.7,0),(.35,.7,0),(.3,.45,0),(-.1,.45,0)]]
        release = [arch(x,z,.12,.65) for x,z in [(-.55,-.35),(0,-.1),(.55,.15),(-.3,.45)]]
        contact = [[(x,.35,z),(x+.25,.4,z+.15),(x+.4,.2,z+.2)] for x,z in [(-.5,-.3),(0,0),(.3,.3)]]; mode = 'lock'
    elif key == 'causal_proof':
        tell = [[(-.7,.05,-.4),(.4,.05,.55)],[(-.5,.05,.6),(.7,.05,-.35)]]
        release = [[(-.55,.05,-.35),(.5,.05,-.2),(.05,.05,.6),(-.55,.05,-.35)]]
        contact = [box(.35,.25,.14,.1)]; mode = 'solve'
    elif key == 'inverse_geometry':
        tell = [[(-.7,.05,-.45),(.3,.05,-.6),(-.15,.05,.2),(-.7,.05,-.45)],[(.3,.05,-.6),(.65,.05,.4),(-.15,.05,.2),(.3,.05,-.6)]]
        release = [[(x,.04,z),(x*.3,.5,z*.3),(-x*.5,.1,-z*.5)] for x,z in [(-.65,-.4),(.65,-.3),(.2,.65)]]
        contact = [[(-.6,.1,-.4),(.6,.1,.4)],[(-.5,.1,.5),(.5,.1,-.5)]]; mode = 'fold'
    elif key == 'angel_dropship':
        tell = [[(0,.04,0),(0,.85,0)]]
        release = [box(x,z,.07,.1,.55) for x,z in [(-.25,0),(.25,0),(0,.25)]]
        contact = [arch(x,z,.06,.35) for x,z in [(-.3,-.3),(.3,-.3),(-.3,.3),(.3,.3)]]; mode = 'drop'
    elif key == 'krakow_bells':
        tell = [[(-.25,.5,-.15),(-.18,.8,-.15),(.18,.8,-.15),(.25,.5,-.15),(-.25,.5,-.15)],[(0,.55,-.15),(.12,.3,-.15)]]
        release = [arc(.65,.65,.2,start=a,end=a+.6,steps=6) + [(0,.2,0)] for a in [i*math.tau/8 for i in range(8)]]
        contact = [arch(x,z,.1,.4) for x,z in [(-.5,0),(0,.5),(.5,0)]]; mode = 'threebeat'
    elif key == 'royal_hunt':
        tell = [[(-.45,.03,z),(-.2,.03,z+.2),(-.1,.03,z),(.1,.03,z+.25)] for z in [-.55,-.1,.35]]
        release = [arrow(x,.7,.95,.1,.08) for x in [-.3,.3]]
        contact = [arc(.22,.12,.08,cz=z,start=0,end=math.pi) for z in [-.4,.1,.6]]; mode = 'advance'
    elif key == 'sky_snare':
        tell = [[(x,.03,z),(x,.65,z)] for x,z in [(-.6,-.5),(.6,-.5),(-.6,.5),(.6,.5)]]
        release = [[(-.6,.65,z),(0,.4,z*.5),(.6,.65,z)] for z in [-.5,-.25,0,.25,.5]] + [[(x,.65,-.5),(x*.5,.4,0),(x,.65,.5)] for x in [-.6,0,.6]]
        contact = [spiral(.75,.3,True)]; mode = 'shrink'
    elif key == 'allseeing_decode':
        tell = [feather(0,-.2,side,.18+i*.03) for side in [-1,1] for i in range(5)]
        release = [box(x,z,.045,.065,.3) for x,z in [(-.55,-.3),(-.3,0),(.2,.3),(.5,-.2)]]
        contact = [[(-.8,.12,.15),(.8,.12,.15)],arc(.15,.08,.3)]; mode = 'inward'
    elif key == 'white_noise_void':
        tell = [[(x,.7,-.45),(x,.15,.45)] for x in [-.7,-.5,-.3,-.1,.1,.3,.5,.7]]
        release = [box(x,z,.05,.035,.35) for x in [-.55,-.25,.05,.35,.65] for z in [-.3,0,.3]]
        contact = [feather(0,0,side,.12) for side in [-1,1]]; mode = 'erase'
    elif key == 'fatal_escapement':
        tell = [[(-.55,.1,.4),(-.15,.1,.1),(0,.1,-.5),(.15,.1,.1),(.55,.1,.4)]]
        release = [arrow(math.cos(a)*.5,math.sin(a)*.5,.08,.06,.1) for a in [i*math.tau/12 for i in range(12)]]
        contact = [[(-.35,.05,-.3),(-.1,.05,-.1),(.1,.05,-.15),(.3,.05,.3)]]; mode = 'step'
    elif key == 'glashutte_retime':
        tell = [box(0,0,.4,.25,.12),box(0,0,.22,.12,.35)]
        release = [arc(.25+i*.15,.25+i*.15,.15+i*.12,start=.2,end=5.8) for i in range(3)]
        contact = [[(0,.15,0),(.5,.15,.3)],arc(.65,.65,.15)]; mode = 'rewind'
    elif key == 'lavender_moonveil':
        tell = [arc(.55,.55,.2,start=.3,end=4.2)]
        release = [[(-.55,.2,-.4),(-.2,.3,.25),(.1,.2,-.1),(.5,.3,.4)]]
        contact = [p for x,z in [(-.5,-.5),(-.2,0),(.3,.5)] for p in spark(x,z,.1,.035)]; mode = 'drift'
    elif key == 'homeward_constellation':
        tell = [[(-.65,.15,-.5),(-.2,.3,.1),(.2,.3,-.4),(.65,.15,.2)]]
        release = [arch(0,.15,.35,.75)] + [[(x,.02,z),(x*.6,.25,z*.6),(0,.5,.15)] for x,z in [(-.6,-.4),(.5,-.4),(0,.6)]]
        contact = [arrow(0,.5,.6,.08,.25)]; mode = 'return'
    elif key == 'steel_advance':
        tell = [[(x,.03,-.5),(x,.55,-.5),(x+.2,.55,-.5),(x+.15,.35,-.5),(x,.35,-.5)] for x in [-.5,0,.5]]
        release = [arrow(x,z,.25,.1) for x,z in [(-.4,0),(0,.25),(.4,.5)]]
        contact = [[(0,.1,-.4),(x,.1,.7)] for x in [-.6,-.3,0,.3,.6]]; mode = 'march'
    elif key == 'ural_avalanche':
        tell = [[(x,.04,-.65),(x,.04,-.5)] for x in [-.6,-.3,0,.3,.6]]
        release = [[(x,.8,z),(x,.04,z),(x+.15,.04,z+.1)] for x,z in [(-.5,-.25),(0,.25),(.5,-.1),(-.2,.55)]]
        contact = [[(-.7,.05,.2),(-.3,.05,.6),(0,.05,.35),(.3,.05,.65),(.7,.05,.25)]]; mode = 'drop'
    elif key == 'neural_seventh_step':
        tell = [box(0,-.65+i*.2,.035,.035,.1) for i in range(7)]
        release = [[(-.08,.02,-.7),(-.08,.5,.7),(.08,.5,.7),(.08,.02,-.7)]]
        contact = [[(x,.08,-.65),(x,.08,.65)] for x in [-.15,0,.15]]; mode = 'blink'
    elif key == 'galatea_fullsync':
        tell = [arch(x,0,.25,.65) for x in [-.2,.2]]
        release = [arc(.18+i*.075,.18+i*.075,.05+i*.055,start=.3,end=5.7) for i in range(7)]
        contact = [arch(0,0,.25,.65),[(-.2,.3,0),(.2,.3,0)]]; mode = 'align'
    elif key == 'cauldron_ram':
        tell = [box(x,0,.22,.45) for x in [-.25,.25]]
        release = [arch(-.3,.4,.15,.55),arch(.3,.4,.15,.55)]
        contact = [[(-.65,.04,.55),(-.65,.45,.55),(.65,.45,.55),(.65,.04,.55)]]; mode = 'close'
    elif key == 'furnace_maelstrom':
        tell = [spiral(1.2)]
        release = [spiral(1.8,.15,True),arc(.22,.22,.45,start=.3,end=5.5)]
        contact = [[(0,.45,0),(-.15,.15,-.2),(.2,.1,.2),(-.1,.04,.1)]]; mode = 'inward'
    elif key == 'grey_goose_cloak':
        tell = [feather(0,z,side,.1) for z in [-.45,-.15,.15,.45] for side in [-1,1]]
        release = [[(-.7,.25,-.4),(.7,.25,.4)]]
        contact = [arc(.3,.12,.03,cz=z,start=.2,end=2.8) for z in [-.45,0,.45]]; mode = 'erase'
    elif key == 'reaper_gaze':
        tell = [[(0,.1,-.6),(-.25,.1,.65),(.25,.1,.65),(0,.1,-.6)]]
        release = [[(side*.45,.15,z),(side*.3,.15,z),(side*.3,.15,z-side*.12)] for side in [-1,1] for z in [-.3,.3]]
        contact = [[(0,.12,-.75),(0,.12,.75)]]; mode = 'lock'
    elif key == 'crane_stress_heal':
        tell = [feather(0,0,side,.3) for side in [-1,1]] + [[(0,.1,-.5),(0,.45,.4)]]
        release = [[(-.5+i*.12,.1,-.3),(-.5+i*.12,.25,0),(-.4+i*.12,.1,.3)] for i in range(9)]
        contact = [[(-.3,.05,-.4),(0,.15,0),(.3,.05,.4)]]; mode = 'stitch'
    elif key == 'industrial_descent':
        tell = [box(0,0,.65,.45,.65),[(0,.65,0),(0,.3,0),(.15,.3,0)]]
        release = [box(x,z,.15,.25,.3) for x,z in [(-.4,-.2),(0,.1),(.4,-.2)]]
        contact = [arch(x,.4,.2,.45) for x in [-.45,.45]]; mode = 'drop'
    elif key == 'cloud_somersault':
        tell = [[(-.65,.05,-.5),(-.3,.05,-.3),(.2,.05,-.4),(.6,.05,-.2)]]
        release = [[(math.sin(i/16*math.tau)*.35,.12,-.75+i/16*1.5) for i in range(17)]]
        contact = [box(x,z,.055,.12) for x,z in [(-.2,-.5),(.2,0),(-.2,.5)]]; mode = 'forward'
    elif key == 'heaven_riot':
        tell = [[(0,.05,0),(0,.85,0)],arc(.18,.18,.6)]
        release = [[(-.65,.3,0),(-.25,.1,0),(0,.04,0),(.25,.1,0),(.65,.3,0)]]
        contact = [[(-.65,.03,-.3),(-.2,.03,.1),(0,.03,-.1),(.25,.03,.3),(.65,.03,.1)]]; mode = 'slam'
    elif key == 'pterosaur_silence':
        tell = [[(-.75,.1,-.2),(0,.25,.5),(.75,.1,-.2),(0,.1,0),(-.75,.1,-.2)]]
        release = [feather(0,-.2,side,.08) for side in [-1,1]]
        contact = [arc(.22,.09,.04,cz=-.4,start=.2,end=3.8)]; mode = 'fold'
    elif key == 'terminal_arrow':
        tell = [[(0,.08,-.8),(0,.08,.75)],[(0,.08,.65),(-.05,.08,.5),(0,.08,.35),(.05,.08,.5),(0,.08,.65)]]
        release = [[(x,.1,-.6),(0,.1,.6)] for x in [-.6,-.3,.3,.6]]
        contact = [[(0,.08,-.75),(0,.08,.75)],[(-.05,.1,.2),(.04,.1,.4),(-.03,.1,.6)]]; mode = 'stab'
    elif key == 'broken_tuning':
        tell = [[(-.7+i*.0875,.1,math.sin(i*.7)*.22) for i in range(17)]]
        release = [[(x,.2,z),(x+.12,.1,z+.15)] for x,z in [(-.6,-.3),(-.3,.2),(0,-.1),(.3,.3),(.6,-.2)]]
        contact = [[(-.45,.05,0),(0,.25,0),(.45,.05,0)]]; mode = 'break'
    elif key == 'dragon_aria':
        tell = [arch(0,-.3,.6,.7),arc(.4,.25,.3,cz=-.3)]
        release = [[(-.7+i*.0875,.25+math.sin(i*.8+z)*.14,z) for i in range(17)] for z in [-.3,0,.3]]
        contact = [box(0,0,.65,.3,.2)]; mode = 'flow'
    elif key == 'martyrs_elegy':
        tell = [[(-.65,.04,z),(-.4,.12,z+.2),(-.1,.08,z-.1),(.3,.12,z+.15),(.65,.04,z)] for z in [-.25,.25]]
        release = [arch(x,.3,.15,.5) for x in [-.4,0,.4]]
        contact = [arrow(x,.65,.55,.045,.1) for x in [-.4,0,.4]]; mode = 'advance'
    elif key == 'missile_black_rain':
        tell = [[(-.75,.7,z),(-.3,.8,z),(.2,.7,z),(.7,.75,z)] for z in [-.3,0,.3]]
        release = [[(x-.3,.8,z-.25),(x,.03,z)] for x,z in [(-.5,-.3),(-.25,.4),(.1,-.2),(.45,.35),(.6,-.3)]]
        contact = [arc(.13,.13,.05,cx=x,cz=z,start=.2,end=5.9,steps=8) for x,z in [(-.5,-.3),(-.25,.4),(.45,.35)]]; mode = 'drop'
    elif key == 'prophetic_intercept':
        tell = [[(-.7+i*.0875,.65*(1-(-1+i/8)**2),z) for i in range(17)] for z in [-.25,.25]]
        release = [[(-.7+i*.0875,.65*(-1+i/8)**2,z) for i in range(17)] for z in [-.25,.25]]
        contact = [[(-.15,.6,0),(.15,.3,0),(-.15,.3,0),(.15,.6,0)]]; mode = 'solve'
    elif key == 'sky_sanctuary':
        tell = [[(.65*math.cos(a),.02,.65*math.sin(a)),(.8*math.cos(a),.02,.8*math.sin(a))] for a in [i*math.tau/8 for i in range(8)]]
        release = [arch(.55*math.cos(a),.55*math.sin(a),.12,.55) for a in [i*math.tau/8 for i in range(8)]]
        contact = [[(x,.55,z),(x*.6,.2,z*.6),(x*.8,.02,z*.8)] for x,z in [(-.5,0),(.5,0),(0,.5)]]; mode = 'stitch'
    elif key == 'trench_doctrine':
        tell = [[(-.7,.03,z),(-.3,.03,z+.1),(.1,.03,z-.05),(.6,.03,z+.15)] for z in [-.4,0,.4]]
        release = [[(-.7,.05,-.1),(-.3,.05,-.1),(-.3,.05,.2),(.1,.05,.2),(.1,.05,0),(.65,.05,0)]]
        contact = [arrow(x,.5,.35,.07) for x in [-.45,.3]]; mode = 'march'
    elif key == 'veteran_muster':
        tell = [[(0,.06,-.55),(x,.06,.45)] for x in [-.25,0,.25]]
        release = [box(x,z,.07,.12) for x in [-.4,0,.4] for z in [-.3,.1,.5]]
        contact = [arch(x,.35,.06,.35) for x in [-.5,-.25,0,.25,.5]]; mode = 'advance'
    elif key == 'firefly_spectrum':
        tell = [p for x,z in [(-.6,-.3),(-.2,.4),(.2,-.3),(.6,.4)] for p in spark(x,z,.2,.035)]
        release = [[(-.6,.2,-.3),(-.2,.3,.4),(.2,.2,-.3),(.6,.3,.4)],[(-.6,.2,-.3),(.6,.3,.4)]]
        contact = [arc(.12,.06,.3,cx=x,cz=z,start=.2,end=2.8) for x,z in [(-.5,0),(0,.5),(.5,-.2)]]; mode = 'scan'
    elif key == 'resonance_lifetide':
        tell = [[(x,.35,-.4),(x,.45,-.2)] for x in [-.3,-.2,-.1,0,.1,.2,.3]]
        release = [arc(.65,.65,.25)] + [[(0,.3,0),(x,.25,z),(x,.45,z)] for x,z in [(-.55,-.2),(.55,-.2),(0,.6)]]
        contact = [arch(x,z,.12,.45) for x,z in [(-.55,-.2),(.55,-.2),(0,.6)]]; mode = 'outward'
    elif key == 'night_bat_escape':
        tell = [[(-.7,.3,-.2),(-.3,.15,0),(0,.4,.3),(.3,.15,0),(.7,.3,-.2)]]
        release = [arrow(x,.65,.85,.12,.12) for x in [-.35,0,.35]]
        contact = [feather(0,.35,side,.2) for side in [-1,1]]; mode = 'forward'
    elif key == 'blood_raven_feast':
        tell = [arc(.6,.6,.25,start=.3,end=5.5)]
        release = [feather(math.cos(a)*.3,math.sin(a)*.3,1,.2) for a in [i*math.tau/5 for i in range(5)]]
        contact = [[(x,.04,z),(x*.5,.2,z*.5),(0,.25,0)] for x,z in [(-.6,-.3),(.6,-.3),(0,.6)]]; mode = 'chase'
    elif key == 'titan_stance':
        tell = [[(x,.6,z),(x,.03,z)] for x,z in [(-.45,-.45),(.45,-.45),(-.45,.45),(.45,.45)]]
        release = [[(-.65,.05,z),(-.3,.2,z),(.2,.12,z),(.65,.25,z)] for z in [-.35,0,.35]]
        contact = [[(-.65,.05,0),(-.3,.2,0),(0,.3,0),(.35,.1,0),(.65,.05,0)]]; mode = 'slam'
    elif key == 'cornerstone_oath':
        tell = [arch(x,z,.1,.55) for x,z in [(-.5,-.5),(.5,-.5),(-.5,.5),(.5,.5)]]
        release = [box(0,0,.5,.5,.1),box(0,0,.4,.4,.2)]
        contact = [[(-.2,.55,0),(0,.3,0),(.2,.55,0),(-.2,.55,0)]]; mode = 'lock'
    elif key == 'alpine_spring':
        tell = [[(-.7,.02,z),(-.3,.05,z+.2),(0,.1,z+.05),(.4,.05,z+.2),(.7,.02,z)] for z in [-.4,0,.4]]
        release = [[(0,.45,-.2),(x,.15,z),(x+.1,.03,z+.15)] for x,z in [(-.55,0),(0,.5),(.55,0)]]
        contact = [[(x-.1,.04,z),(x,.25,z),(x+.1,.04,z)] for x,z in [(-.55,0),(0,.5),(.55,0)]]; mode = 'flow'
    elif key == 'aurora_frostlock':
        tell = [[(-.7+i*.1,.5+math.sin(i*.6)*.15,z) for i in range(15)] for z in [-.4,0,.4]]
        release = [[(x,.03,z),(x-.1,.25,z+.08),(x+.1,.25,z+.08),(x,.03,z)] for x,z in [(-.5,-.25),(0,.4),(.5,-.25)]]
        contact = [box(x,z,.12,.12,.4) for x,z in [(-.5,-.25),(0,.4),(.5,-.25)]]; mode = 'drop'
    elif key == 'steppe_mist':
        tell = [[(-.75,.08,z),(-.2,.12,z+.1),(.3,.08,z-.1),(.75,.1,z)] for z in [-.4,0,.4]]
        release = [feather(0,z,side,.15) for z in [-.2,.2] for side in [-1,1]]
        contact = [[(-.65,.04,-.3),(.1,.05,-.15),(.65,.04,-.25)]]; mode = 'drift'
    elif key == 'eagle_skyeye':
        tell = [arc(.2,.08,.65),[(0,.6,0),(-.5,.04,.5)],[(0,.6,0),(.5,.04,.5)]]
        release = [arrow(math.cos(a)*.45,math.sin(a)*.45,.2,.07,.08) for a in [i*math.tau/8 for i in range(8)]]
        contact = [feather(0,z,1,.15) for z in [-.45,0,.45]]; mode = 'scan'
    elif key == 'blackout_breaker':
        tell = [[(x-.1,.04,z),(x,.35,z),(x+.12,.55,z)] for x,z in [(-.5,-.4),(.5,-.4),(-.5,.4),(.5,.4)]]
        release = [[(x,.04,z),(x+.18,.08,z+.1),(x+.03,.04,z+.2)] for x,z in [(-.5,-.4),(.4,-.3),(-.3,.3),(.3,.4)]]
        contact = [[(-.5,.1,0),(-.15,.1,0)],[(.15,.1,0),(.5,.1,0)]]; mode = 'erase'
    elif key == 'thunder_judgement':
        tell = [box(x,0,.22,.35,.7) for x in [-.45,0,.45]]
        release = [[(x,.8,z),(x-.08,.5,z),(x+.06,.3,z),(x,.03,z)] for x,z in [(-.5,-.3),(0,-.5),(.5,-.3),(-.5,.3),(0,.5),(.5,.3)]]
        contact = [arch(0,0,.3,.5),[(-.3,.3,0),(.3,.3,0)]]; mode = 'slam'
    elif key == 'carnival_vanguard':
        tell = [[(x,.02,z),(0,.5,0)] for x,z in [(-.6,-.3),(.6,-.3),(0,.6)]]
        release = [arc(.35,.35,.5),arch(0,0,.35,.6)]
        contact = [arrow(x,.6,.5,.05,.12) for x in [-.4,0,.4]]; mode = 'drop'
    elif key == 'helicopter_carnival':
        tell = [box(0,0,.65,.45)] + [[(x,.04,-.45),(x,.04,.45)] for x in [-.4,-.2,0,.2,.4]]
        release = [[(x-.15,y,z),(x+.15,y,z),(x,y,z),(x,y,z-.15),(x,y,z+.15)] for x,y,z in [(-.4,.3,-.2),(0,.5,0),(.4,.7,.2)]]
        contact = [feather(x,z,side,.25) for x,z in [(-.4,-.3),(.4,.3)] for side in [-1,1]]; mode = 'lift'
    elif key == 'border_dome':
        tell = [arch(.65*math.cos(a),.65*math.sin(a),.045,.35) for a in [i*math.tau/6 for i in range(6)]]
        release = [[(.7*math.cos(a),.03,.7*math.sin(a)),(.65*math.cos(a),.5,.65*math.sin(a)),(0,.75,0)] for a in [i*math.tau/6 for i in range(6)]]
        contact = [[(.55,.1,0),(.55,.45,0)]]; mode = 'stitch'
    elif key == 'total_exclusion':
        tell = [[(x,.03,-.65),(x,.03,.65)] for x in [-.6,-.3,0,.3,.6]] + [[(-.65,.03,z),(.65,.03,z)] for z in [-.6,-.3,0,.3,.6]]
        release = [[(x,.75,z),(x,.03,z)] for x,z in [(-.3,-.3),(0,0),(.3,.3),(-.3,.3),(.3,-.3)]]
        contact = [arrow(x,z,.16,.07) for x,z in [(-.6,-.4),(.6,-.4),(-.4,.6),(.4,.6)]]; mode = 'drop'
    elif key == 'paid_positioning':
        tell = [[(-.3,.08,0),(-.1,.08,-.2),(.3,.08,.3)]]
        release = [[(0,.05,-.7),(.15,.05,-.2),(-.15,.05,.2),(0,.05,.7)]] + [[(-.07,.05,z),(.07,.05,z)] for z in [-.6,-.3,0,.3,.6]]
        contact = [box(0,.5,.1,.07,.1)]; mode = 'blink'
    elif key == 'formless_finale':
        tell = [arc(.6,.6,.2,start=.15,end=6.1)]
        release = [[(0,.12,-.8),(0,.12,.8)]]
        contact = [[(0,.1,.65),(-.12,.1,.4),(0,.1,.15),(.12,.1,.4),(0,.1,.65)]]; mode = 'stab'
    else:
        raise ValueError('Missing ability construction: ' + profile)
    return [tell, release, contact], mode


BEATS = {
    's01': ((.10,.26,.50),(.18,.38,.66)), 's02': ((.13,.30,.55),(.20,.43,.70)),
    's03': ((.11,.28,.48),(.16,.40,.68)), 's04': ((.07,.20,.39),(.14,.35,.58)),
    's05': ((.06,.22,.42),(.12,.32,.62)), 's06': ((.17,.36,.60),(.22,.45,.72)),
    's07': ((.14,.31,.53),(.19,.39,.64)), 's08': ((.09,.25,.46),(.21,.44,.69)),
    's09': ((.08,.24,.44),(.15,.37,.63)), 's10': ((.12,.29,.52),(.17,.41,.67)),
    's11': ((.16,.34,.57),(.23,.46,.73)), 's12': ((.15,.33,.56),(.24,.47,.74)),
    't01': ((.10,.27,.49),(.19,.42,.65)), 't02': ((.05,.18,.36),(.18,.44,.71)),
    't03': ((.18,.37,.61),(.22,.48,.75)), 't04': ((.11,.30,.51),(.25,.49,.76)),
    't05': ((.14,.32,.54),(.20,.46,.72)), 't06': ((.07,.23,.43),(.13,.34,.59)),
    't07': ((.13,.31,.52),(.26,.50,.77)), 't08': ((.09,.26,.47),(.16,.38,.65)),
    't09': ((.12,.33,.55),(.21,.45,.71)), 't10': ((.16,.35,.59),(.23,.47,.76)),
    't11': ((.17,.38,.62),(.24,.48,.73)), 't12': ((.08,.25,.45),(.15,.40,.69)),
    'm01': ((.06,.21,.40),(.14,.36,.61)), 'm02': ((.19,.39,.64),(.25,.50,.78)),
    'm03': ((.15,.34,.58),(.20,.42,.68)), 'm04': ((.10,.29,.50),(.18,.41,.66)),
    'm05': ((.12,.28,.47),(.17,.39,.63)), 'm06': ((.11,.27,.46),(.19,.43,.67)),
    'm07': ((.18,.36,.63),(.22,.46,.74)), 'm08': ((.05,.19,.37),(.27,.51,.79)),
}


def cast_geometry(asset, intent, joint, track):
    fields = {}
    for slot, ability in intent['abilities'].items():
        profile = ability['direction']['profileId']
        paths, mode = recipe(profile)
        stages = [joint(slot + '_field_' + layer, None) for layer in ['tell','release','contact']]
        nodes = stages[:]
        release_nodes = [stages[1]]
        # The veteran's retained articulation inventory needs one moving muster batch to stay inside the mesh cap.
        if slot == 'atk' and len(paths[1]) >= 3 and profile != 't11.atk.veteran_muster':
            release_nodes += [joint(slot + '_field_release_' + str(i), None) for i in [1,2]]
            nodes += release_nodes[1:]
        for stage, lines in enumerate(paths):
            for i, path in enumerate(lines):
                node = release_nodes[i % len(release_nodes)] if stage == 1 else stages[stage]
                material = ['fx_accent','fx_color','fx_core'][stage]
                if stage == 2 and mode in ['erase','fold','drift']:
                    material = 'fx_muted'
                if stage == 2 and key_for_ink(profile):
                    material = 'fx_ink'
                for a, b in zip(path, path[1:]):
                    direction = Vector(b) - Vector(a)
                    if direction.length < .00001:
                        continue
                    transverse = direction.cross(Vector((0,1,0)))
                    if transverse.length < .00001:
                        transverse = direction.cross(Vector((1,0,0)))
                    transverse = transverse.normalized() * (.009 if stage != 2 else .006)
                    vertical = direction.normalized().cross(transverse)
                    vertices = [tuple(Vector(p) + sign * offset) for offset in [transverse,vertical]
                                for p,sign in [(a,-1),(a,1),(b,1),(b,-1)]]
                    asset.mesh(profile + ':' + str(stage), node, vertices, [(0,1,2,3),(4,5,6,7)], material)
        bpy.context.view_layer.update()
        parts = [obj for obj in asset.parts if obj.parent.name in nodes]
        extent = max((obj.matrix_local @ v.co).length for obj in parts for v in obj.data.vertices)
        # Reserve translation headroom; rotations and axis scales cannot escape this spherical envelope.
        for obj in parts:
            obj.location *= .84 / extent
            for vertex in obj.data.vertices:
                vertex.co *= .84 / extent
        tracks = []
        tell, release, contact = BEATS[profile[:3]][slot == 'atk']

        def add(name, channel, axis, keys):
            tracks.append({'node':name,'channel':channel,'axis':axis,'keys':keys})
            track(slot, name, channel, axis, keys)

        for index, name in enumerate(nodes):
            stage = stages.index(name) if name in stages else 1
            stagger = release_nodes.index(name) * .045 if name in release_nodes else 0
            peak = [tell,release,contact][stage] + stagger
            start = max(0, peak - (.08 if stage != 2 else .035))
            end = min(.98, peak + ([.22,.28,.10][stage]))
            keys = [[0,.001]] + ([[start,.001]] if start else []) + [[peak,1],[end,.001],[1,.001]]
            if stage == 1 and mode in ['pulse','threebeat','step']:
                keys = [[0,.001],[start,.001],[peak,1],[peak+.04,.25],
                        [peak+.08,.85],[peak+.12,.15],[peak+.16,.7],[end,.001],[1,.001]]
            for axis in 'xyz':
                curve = keys
                if stage == 1 and mode in ['inward','shrink','fold','close','erase']:
                    curve = [[time, value * (.95 if time <= peak else .45)] for time,value in keys]
                add(name,'scale',axis,curve)
            if stage == 1:
                if mode in ['chase','rewind','inward']:
                    add(name,'rotation','y',[[0,0],[start,0],[end,-1.4 if mode == 'rewind' else .85],[1,0]])
                elif mode in ['forward','advance','march','stab','return']:
                    add(name,'position','z',[[0,-.10],[start,-.10],[end,.10],[1,0]])
                elif mode in ['drop','slam','lift']:
                    add(name,'position','y',[[0,.10 if mode != 'lift' else -.08],[start,.10 if mode != 'lift' else -.08],[end,0 if mode != 'lift' else .10],[1,0]])
                elif mode in ['drift','scan','flow']:
                    add(name,'position','x',[[0,-.10],[start,-.10],[end,.10],[1,0]])
        fields[slot] = {'profileId':profile,'nodes':nodes,'tracks':tracks,
                        'beats':[tell,release,contact], 'motion':mode,
                        'duration':.95 if slot == 'def' else 1.35,
                        'follows':ability['r'] <= 0 and ability['fx'] not in ['summon','strike'],
                        'description':ability['description'],'radius':ability['r'],'fx':ability['fx']}
    return fields


def key_for_ink(profile):
    return profile.split('.')[-1] in ['white_noise_void','blackout_breaker','formless_finale']
