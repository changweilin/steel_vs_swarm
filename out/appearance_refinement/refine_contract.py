"""Author curved centerlines into the existing joint-coordinate owner."""
import json
import math
from bisect import bisect_left
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
assets_file = ROOT / 'tools/mech_authoring/assets.json'
morph_file = ROOT / 'tools/mech_authoring/morphers.json'
assets = json.loads(assets_file.read_text(encoding='utf8'))
morph = json.loads(morph_file.read_text(encoding='utf8'))


def sample_curve(points, count):
    curve = []
    for i in range(241):
        t = i / 240
        weights = [(1-t)**3, 3*t*(1-t)**2, 3*t*t*(1-t), t**3]
        curve.append([sum(w*p[k] for w,p in zip(weights,points)) for k in range(3)])
    arc = [0]
    for a,b in zip(curve,curve[1:]):
        arc.append(arc[-1] + math.dist(a,b))
    sampled = [curve[0]]
    for i in range(1,count):
        target = arc[-1]*i/count
        upper = bisect_left(arc,target)
        fraction = (target-arc[upper-1])/(arc[upper]-arc[upper-1])
        sampled.append([a+(b-a)*fraction for a,b in zip(curve[upper-1],curve[upper])])
    return sampled+[curve[-1]]


octopus = assets['assets']['s07']
joint = {n:at for n,_,at in octopus['joints']}
roots = ['tent_0','leg_FL','tent_1','leg_FR','tent_2','leg_HR','tent_3','leg_HL']
angles = [0,math.pi/4,math.pi/2,3*math.pi/4,math.pi,5*math.pi/4,3*math.pi/2,7*math.pi/4]
for root,angle in zip(roots,angles):
    x,z = math.cos(angle),math.sin(angle)
    joint[root][:] = [round(.8*x,8),-.02,round(.8*z,8)]
    if root.startswith('leg_'):
        points = [[0,0,0],[x*.85,-.85,z*.85],[x*1.8,-2.03,z*1.8],[x*3.1,-2.0,z*3.1]]
    elif root in ['tent_0','tent_2']:
        points = [[0,0,0],[x*.85,.05,.35],[x*2.4,1.9,.65],[x*2.2,1.15,1.55]]
    elif root == 'tent_1':
        points = [[0,0,0],[0,-.15,.6],[.25,-.6,2.8],[0,.55,2.2]]
    else:
        points = [[0,0,0],[0,.15,-.8],[.2,2.6,-1.6],[0,2.9,-.2]]
    curve = sample_curve(points,12)
    for i,(a,b) in enumerate(zip(curve,curve[1:])):
        joint[f'{root}_{i}'][:] = [round(v-u,8) for u,v in zip(a,b)]
for i,wave in enumerate(octopus['rig']['tentacleWaves']):
    wave['swing'] = [.003,.065,.003] if i<4 else [.045,.075,.035]
    wave['travel'] = [0,.03,0] if i<4 else [.012,.025,.012]
    if wave.get('slot'):
        wave['convergeYaw'] = -1.16 if wave['slot']=='light' else 1.16

monkey = morph['assets']['t06']
for item in monkey['rig']['stowedWeapons']:
    item['rotation'] = [0, math.pi/2 if item['slot']=='light' else -math.pi/2, 0]
monkey['rig']['tailSway'] = {'frequency':.55,'idle':.20,'travel':.13,'delay':.42,'pitch':-.16,'pitchWave':.012}

beetle = morph['assets']['m07']
beetle['parameters']['hornPath'] = [[0,.1,.55],[0,.75,.92],[0,1.45,1.04],[0,2.05,.94],[0,2.43,.72]]
beetle['parameters']['hornPitch'] = .32
beetle['rig'].pop('dorsalLift')
beetle['rig'].pop('fireLead',None)
beetle['rig']['dorsalMount'] = {'node':'heavy','height':1.23,'receiverWidth':1.55,'barrelSpacing':1.10}
for n,_,at in beetle['joints']:
    if n=='heavy':at[1]=beetle['rig']['dorsalMount']['height']
    if n=='heavy_muzzle':at[0]=beetle['rig']['dorsalMount']['barrelSpacing']/2

for path,data in [(assets_file,assets),(morph_file,morph)]:
    path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf8')
