// NPC shells share the existing articulated rig; models.js alone fits authoritative heights.
import * as THREE from 'three';
import { CIVILIANS, isThirdSide, sideInfo } from './data.js';
import { bx, cyl, rbz, sph, cone, torus, dim, mat } from './geo3d.js';
import { limbChain, recoilMount, mechanism } from './unitRig.js';
import { tboxF, finF } from './forge/geo.js';
import { finishUnitSurfaces } from './unitSurfaces.js';
import { generateCivilian } from './civilianAppearance.js';
import { sceneryGeometry } from './sceneryGeometry.js';
import { FACTION_MODEL_STYLE } from './factionModelStyle.js';
import { buildFactionAsset } from './forge/factionAsset.js';

const TAU = Math.PI * 2;

export const NPC_MODEL_KINDS = Object.freeze([
  'creep:soldier',
  'creep:apc',
  'creep:tank',
  'creep:rocketeer',
  'creep:howitzer',
  'creep:heli',
  'bunker',
  'civ',
]);

// models.js／locomotion.js／game.js 會讀取的欄位；供接線與離線稽核共用。
export const NPC_MODEL_CONTRACTS = Object.freeze({
  trooper: Object.freeze([
    'rig.kind=biped', 'rig.hips', 'rig.legL', 'rig.legR', 'rig.armL', 'rig.armR',
    'rig.hipsY0', 'rig.gunR', 'rig.aimPose', 'rig.weap', 'rig.hvy',
    'rig.lightGlow', 'rig.muzzles.light.n',
    'rig.legChainL', 'rig.legChainR', 'rig.armChainL', 'rig.armChainR', 'rig.attacks',
  ]),
  civilian: Object.freeze([
    'rig.kind=biped', 'rig.hips', 'rig.legL', 'rig.legR', 'rig.armL', 'rig.armR',
    'rig.hipsY0',
    'rig.legChainL', 'rig.legChainR', 'rig.armChainL', 'rig.armChainR',
  ]),
  wheeled: Object.freeze([
    'rig.kind=wheeled', 'rig.hull', 'rig.hullY0', 'rig.wheels',
    'rig.attacks',
    'rig.lightGlow', 'rig.muzzles.light.n', 'userData.turret', 'turret.userData.pitch',
  ]),
  tracked: Object.freeze([
    'rig.kind=tracked', 'rig.hull', 'rig.hullY0', 'rig.wheels',
    'rig.attacks',
    'rig.lightGlow', 'rig.muzzles.light.n', 'userData.turret', 'turret.userData.pitch',
  ]),
  aerial: Object.freeze([
    'rig.kind=aerial', 'rig.tilt', 'rig.tiltY0', 'rig.lightGlow',
    'rig.muzzles.light.n', 'userData.spin', 'userData.gunTilt',
    'userData.turretMuzzles',
    'rig.attacks',
  ]),
  bunker: Object.freeze(['rig.kind=static']),
});

const FACTION = Object.freeze({
  ...FACTION_MODEL_STYLE,
  GUER: Object.freeze({
    shell: 0x756b50, mid: 0x5d5946, dark: 0x403d32, deep: 0x24231f,
    trim: 0xb56f49, glass: 0x8fa79b, form: 'irregular',
  }),
  MILI: Object.freeze({
    shell: 0x6b655c, mid: 0x53515a, dark: 0x383943, deep: 0x202129,
    trim: 0x9d7c62, glass: 0xa1b8c1, form: 'irregular',
  }),
});

const TROOPER = Object.freeze({
  soldier: Object.freeze({ weapon: 'mg', armour: 0.88, pack: 0.82, stride: 0.94 }),
  rocketeer: Object.freeze({ weapon: 'rocket', armour: 1.06, pack: 1.06, stride: 0.88 }),
  howitzer: Object.freeze({ weapon: 'grenade', armour: 0.98, pack: 1.12, stride: 0.84 }),
});

// Vehicle proportions remain visual data; axles and weapon mounts keep their rig contracts.
export const FACTION_MACHINE_MODELS = Object.freeze({
  SWARM: Object.freeze({
    doctrine: 'Distributed hive modules',
    apc: Object.freeze({ reference: 'Hive runner', profile: 'hive', L: 7.65, W: 2.9,
      wheelR: 0.54, axles: [-2.45, -0.82, 0.82, 2.45], sill: 0.62, waist: 1.55,
      roof: 2.42, turretY: 2.16, turretZ: -0.45, turret: 'hive-pod', barrel: 1.75 }),
    tank: Object.freeze({ reference: 'Carapace siege crawler', profile: 'hive', L: 6.55, W: 3.42,
      wheelR: 0.43, axles: [-2.38, -1.43, -0.48, 0.48, 1.43, 2.38],
      hullY: 1.12, turretY: 1.72, turretZ: 0.18, turret: 'hive-pod', barrel: 4.1 }),
    heli: Object.freeze({ reference: 'Hive skimmer', profile: 'hive', bodyW: 1.45,
      bodyH: 1.25, bodyL: 3.15, tailL: 3.7, blades: 5, coaxial: false, tailRotor: true }),
    bunker: Object.freeze({ reference: 'Hive relay shelter', profile: 'hive' }),
  }),
  STEEL: Object.freeze({
    doctrine: 'Armored industrial columns',
    apc: Object.freeze({ reference: 'Bastion transport', profile: 'bastion', L: 8.8, W: 3.18,
      wheelR: 0.61, axles: [-2.8, -0.95, 0.95, 2.8], sill: 0.68, waist: 1.82,
      roof: 2.78, turretY: 2.48, turretZ: 0.2, turret: 'bastion-block', barrel: 2.05 }),
    tank: Object.freeze({ reference: 'Anvil siege engine', profile: 'bastion', L: 8.7, W: 3.5,
      wheelR: 0.46, axles: [-3.0, -2.0, -1.0, 0, 1.0, 2.0, 3.0],
      hullY: 1.24, turretY: 1.92, turretZ: 0.35, turret: 'bastion-block', barrel: 5.2 }),
    heli: Object.freeze({ reference: 'Foundry gunship', profile: 'bastion', bodyW: 1.75,
      bodyH: 1.2, bodyL: 2.7, tailL: 2.7, blades: 3, coaxial: true, tailRotor: false }),
    bunker: Object.freeze({ reference: 'Bastion pillbox', profile: 'bastion' }),
  }),
  GUER: Object.freeze({
    doctrine: '南非防雷車與繳獲蘇式裝備',
    apc: Object.freeze({ reference: 'Casspir Mk II', profile: 'casspir', L: 6.9, W: 2.5,
      wheelR: 0.68, axles: [-2.05, 2.05], sill: 1.05, waist: 2.05,
      roof: 3.0, turretY: 2.72, turretZ: -0.15, turret: 'open-ring', barrel: 1.25 }),
    tank: Object.freeze({ reference: 'T-55AM', profile: 't55', L: 6.2, W: 3.27,
      wheelR: 0.48, axles: [-2.0, -1.0, 0, 1.0, 2.0],
      hullY: 1.08, turretY: 1.58, turretZ: 0.08, turret: 't55-dome', barrel: 3.7 }),
    heli: Object.freeze({ reference: 'UH-1H', profile: 'huey', bodyW: 1.55,
      bodyH: 1.45, bodyL: 2.75, tailL: 3.9, blades: 2, coaxial: false, tailRotor: true }),
    bunker: Object.freeze({ reference: '山地游擊隊石砌 sangar', profile: 'stone-sangar' }),
  }),
  MILI: Object.freeze({
    doctrine: '美式外援模組化部隊',
    apc: Object.freeze({ reference: 'M1126 Stryker', profile: 'stryker', L: 6.95, W: 2.72,
      wheelR: 0.55, axles: [-2.28, -0.76, 0.76, 2.28], sill: 0.58, waist: 1.62,
      roof: 2.3, turretY: 2.05, turretZ: 0.1, turret: 'crows', barrel: 1.45 }),
    tank: Object.freeze({ reference: 'M1A2 Abrams', profile: 'abrams', L: 7.9, W: 3.66,
      wheelR: 0.45, axles: [-2.85, -1.9, -0.95, 0, 0.95, 1.9, 2.85],
      hullY: 1.18, turretY: 1.78, turretZ: -0.05, turret: 'abrams-wedge', barrel: 4.85 }),
    heli: Object.freeze({ reference: 'AH-64D Apache', profile: 'apache', bodyW: 1.35,
      bodyH: 1.28, bodyL: 3.0, tailL: 3.6, blades: 4, coaxial: false, tailRotor: true }),
    bunker: Object.freeze({ reference: 'NATO HESCO 前進作戰堡', profile: 'hesco-fob' }),
  }),
});

function factionOf(side) {
  return FACTION[side] || (isThirdSide(side) ? FACTION.GUER : FACTION.STEEL);
}

function machineModel(side, role) {
  return (FACTION_MACHINE_MODELS[side] || FACTION_MACHINE_MODELS.STEEL)[role];
}

function accentOf(side, fallback = 0xffb45c) {
  return new THREE.Color(sideInfo(side)?.color ?? fallback);
}

function markBatch(node, family, role) {
  node.userData.npcFamily = family;
  node.userData.npcRole = role;
  return node;
}

function addTrooperFactionParts(hips, side, role, P, accent) {
  if (side === 'SWARM') {
    for (const sgn of [-1, 1]) {
      const fin = finF(hips, { len: 0.62, w0: 0.24, w1: 0.06, t: 0.08, sweep: 0.22 },
        sgn * 0.3, 0.68, -0.32, P.trim);
      fin.rotation.z = sgn * 0.42;
    }
    for (const y of [0.38, 0.62, 0.86]) frustum(hips, {
      rt: 0.07, rb: 0.13, h: 0.18, seg: 6, y, z: -0.48, rx: Math.PI / 2, color: P.dark,
    });
  } else if (side === 'STEEL') {
    for (const x of [-0.34, 0.34]) {
      bx(hips, 0.16, 0.62, 0.2, x, 0.62, 0.32, P.mid);
      cyl(hips, 0.09, 0.12, 0.62, 8, x, 0.58, -0.42, P.deep);
    }
    for (const y of [0.42, 0.58, 0.74]) bx(hips, 0.42, 0.035, 0.055, 0, y, -0.5, P.trim);
    glowPlate(hips, 0.12, 0.12, 0.05, 0, 0.98, 0.29, accent, 0.75);
  } else if (side === 'GUER') {
    const salvage = bx(hips, 0.3, 0.44, 0.12, -0.34, 0.66, 0.31, P.trim);
    salvage.rotation.z = 0.16;
    strut(hips, [0.28, 0.36, -0.3], [0.38, 1.18, -0.33], 0.025, P.deep);
  } else if (side === 'MILI') {
    for (const sgn of [-1, 1]) {
      const bar = bx(hips, 0.08, 0.38, 0.055, sgn * 0.13, 0.69, 0.36, P.trim);
      bar.rotation.z = sgn * 0.62;
    }
    strut(hips, [0.32, 0.34, -0.31], [0.32, 1.12, -0.31], 0.022, P.deep);
  }
  if (role === 'rocketeer') {
    for (const x of [-0.3, 0.3]) cyl(hips, 0.08, 0.1, 0.42, 8, x, 0.48, -0.49, P.trim);
  } else if (role === 'howitzer') {
    for (const x of [-0.26, 0.26]) torus(hips, 0.11, 0.025, x, 0.48, -0.48, P.trim);
  } else {
    for (const x of [-0.2, 0, 0.2]) bx(hips, 0.13, 0.18, 0.1, x, 0.28, 0.31, P.dark);
  }
}

// 四／六／八面錐台是本模組的主要裝甲語彙；圓柱僅保留給關節、砲管與輪組。
function frustum(parent, {
  rt, rb, h, seg = 6, x = 0, y = 0, z = 0, sx = 1, sz = 1,
  rx = 0, ry = 0, rz = 0, color, opts,
}) {
  const m = cyl(parent, rt, rb, h, seg, x, y, z, color, opts);
  m.scale.set(sx, 1, sz);
  m.rotation.set(rx, ry, rz);
  return m;
}

function strut(parent, a, b, r, color, opts) {
  const p0 = new THREE.Vector3(...a), p1 = new THREE.Vector3(...b);
  const d = p1.clone().sub(p0);
  const m = cyl(parent, r, r, Math.max(0.001, d.length()), 6,
    (p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5, (p0.z + p1.z) * 0.5, color, opts);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

function glowPlate(parent, w, h, d, x, y, z, color, intensity = 0.8) {
  return bx(parent, w, h, d, x, y, z, color, {
    emissive: color, emissiveIntensity: intensity,
  });
}

function weaponGroup(role, accent, palette) {
  const g = markBatch(new THREE.Group(), 'trooper_weapon', role);
  const metal = palette.deep;
  let muzzle = null;
  if (role === 'rocket') {
    const tube = cyl(g, 0.09, 0.11, 1.7, 8, 0, 0, 0.1, metal, { metalness: 0.75 });
    tube.rotation.x = Math.PI / 2;
    const warhead = cone(g, 0.16, 0.42, 8, 0, 0, 1.15, palette.mid, { metalness: 0.55 });
    warhead.rotation.x = Math.PI / 2;
    const bell = frustum(g, { rt: 0.09, rb: 0.17, h: 0.28, seg: 8,
      z: -0.9, rx: Math.PI / 2, color: palette.dark, opts: { metalness: 0.72 } });
    bell.userData.noOutline = false;
    bx(g, 0.08, 0.2, 0.1, 0, -0.17, 0.15, palette.dark);
    muzzle = torus(g, 0.105, 0.025, 0, 0, 0.94, accent, {
      emissive: accent, emissiveIntensity: 0.85,
    });
  } else if (role === 'grenade') {
    bx(g, 0.22, 0.2, 0.56, 0, 0, -0.06, palette.dark, { metalness: 0.55 });
    const drum = cyl(g, 0.18, 0.18, 0.24, 8, 0, 0, 0.19, palette.mid, { metalness: 0.55 });
    drum.rotation.x = Math.PI / 2;
    const barrel = cyl(g, 0.075, 0.085, 0.52, 8, 0, 0, 0.55, metal, { metalness: 0.8 });
    barrel.rotation.x = Math.PI / 2;
    bx(g, 0.05, 0.2, 0.07, 0, -0.16, 0.26, palette.dark);
    bx(g, 0.05, 0.12, 0.38, 0, 0.02, -0.42, palette.mid);
    muzzle = torus(g, 0.082, 0.026, 0, 0, 0.83, accent, {
      emissive: accent, emissiveIntensity: 0.9,
    });
  } else {
    bx(g, 0.22, 0.22, 0.68, 0, 0, -0.06, palette.dark, { metalness: 0.65 });
    const barrel = cyl(g, 0.045, 0.06, 0.92, 8, 0, 0, 0.7, metal, { metalness: 0.85 });
    barrel.rotation.x = Math.PI / 2;
    for (const z of [0.48, 0.68, 0.88]) {
      const ring = torus(g, 0.066, 0.016, 0, 0, z, palette.mid, { metalness: 0.75 });
      ring.rotation.x = Math.PI / 2;
    }
    bx(g, 0.26, 0.3, 0.28, -0.2, -0.1, -0.02, palette.mid); // 彈盒
    bx(g, 0.06, 0.22, 0.08, 0, -0.18, -0.1, palette.deep);
    muzzle = torus(g, 0.058, 0.02, 0, 0, 1.18, accent, {
      emissive: accent, emissiveIntensity: 0.8,
    });
  }
  const bolt = bx(g, 0.07, 0.07, 0.22, 0.14, 0.07, -0.04, palette.trim, { metalness: 0.8 });
  if (palette.language === 'segmented-hive') {
    for (const z of [0.05, 0.3, 0.55]) frustum(g, { rt: 0.12, rb: 0.15, h: 0.16,
      seg: 6, z, rx: Math.PI / 2, color: palette.shell });
  } else if (palette.language === 'industrial-bastion') {
    bx(g, 0.3, 0.19, 0.56, 0, 0.06, 0.2, palette.shell);
    for (const z of [0.07, 0.24, 0.41]) bx(g, 0.32, 0.045, 0.06, 0, 0.17, z, palette.trim);
  }
  if (role !== 'rocket') {
    tboxF(g, { w0: 0.16, d0: 0.22, w1: 0.21, d1: 0.3, h: 0.18 },
      0, 0.17, -0.2, palette.mid, { metalness: 0.6 });
    bx(g, 0.045, 0.06, 0.35, 0, 0.28, -0.15, palette.deep);
  }
  return { g, muzzle, bolt };
}

function buildTrooper(side, role) {
  const spec = TROOPER[role];
  const P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'trooper', role);
  const machine = P.form === 'machine';
  const swarm = side === 'SWARM';
  const hipY = machine ? 1.42 : 1.34;

  const makeLeg = (sgn) => {
    const leg = new THREE.Group();
    leg.position.set(sgn * (machine ? 0.25 : 0.2), hipY, 0);
    if (machine) tboxF(leg, { w0: 0.3, d0: 0.33, w1: 0.4, d1: 0.4, h: 0.58 },
      0, -0.31, 0, P.shell);
    else frustum(leg, { rt: swarm ? 0.12 : 0.16, rb: 0.21, h: 0.58, seg: 6,
      y: -0.31, sx: 0.92, sz: swarm ? 1 : 0.82, color: P.shell });
    sph(leg, 0.16, 0, -0.61, 0.03, P.dark, { metalness: machine ? 0.65 : 0.1 });
    if (machine) tboxF(leg, { w0: 0.32, d0: 0.38, w1: 0.23, d1: 0.27, h: 0.5 },
      0, -0.91, -0.05, P.mid);
    else frustum(leg, { rt: 0.13, rb: swarm ? 0.1 : 0.17, h: 0.5, seg: 6,
      y: -0.91, sx: 0.88, sz: 0.78, color: P.mid });
    const foot = bx(leg, machine ? 0.4 : swarm ? 0.27 : 0.31, 0.16, machine ? 0.56 : swarm ? 0.43 : 0.49,
      0, -1.2, 0.11, P.deep);
    foot.rotation.x = machine ? -0.08 : 0;
    g.add(leg);
    return leg;
  };
  const legL = makeLeg(-1), legR = makeLeg(1);

  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  frustum(hips, { rt: 0.34, rb: 0.43, h: 0.28, seg: 6, y: 0.12,
    sx: 1.1, sz: 0.72, color: P.dark });
  tboxF(hips, { w0: swarm ? 0.45 : 0.62, d0: 0.38,
    w1: (machine ? 1.02 : 0.84) * spec.armour, d1: machine ? 0.56 : 0.46, h: 0.64 },
    0, 0.58, 0, P.shell, { metalness: machine ? 0.65 : 0.1 });
  if (swarm) {
    for (let i = 0; i < 3; i++) frustum(hips, {
      rt: 0.3 + i * 0.045, rb: 0.24 + i * 0.045, h: 0.17, seg: 6,
      y: 0.39 + i * 0.17, z: 0.16, sx: 1.22, sz: 0.55, color: i === 1 ? P.mid : P.shell,
    });
    for (const x of [-0.18, 0.18]) frustum(hips, { rt: 0.12, rb: 0.15,
      h: 0.58 * spec.pack, seg: 6, x, y: 0.61, z: -0.37, color: P.mid });
  } else if (machine) {
    tboxF(hips, { w0: 0.72, d0: 0.2, w1: 0.94 * spec.armour, d1: 0.24, h: 0.49 },
      0, 0.64, 0.25, P.dark);
    bx(hips, 0.58 * spec.pack, 0.62, 0.32, 0, 0.58, -0.36, P.dark);
  } else {
    const chest = frustum(hips, { rt: 0.39 * spec.armour, rb: 0.32, h: 0.48, seg: 6,
      y: 0.61, z: 0.13, sx: 1.2, sz: 0.58, color: P.mid });
    chest.rotation.y = Math.PI / 6;
    bx(hips, 0.46 * spec.pack, 0.5, 0.26, 0, 0.58, -0.36, P.dark);
  }
  for (const sgn of [-1, 1]) {
    const shoulder = machine
      ? tboxF(hips, { w0: 0.42, d0: 0.48, w1: 0.34, d1: 0.42, h: 0.29 },
        sgn * 0.5, 0.92, 0, P.mid)
      : frustum(hips, { rt: swarm ? 0.1 : 0.2, rb: 0.27 * spec.armour, h: swarm ? 0.36 : 0.24,
      seg: 6, x: sgn * 0.46, y: 0.91, sx: 1.12, sz: 0.72, rz: sgn * -0.12,
      color: P.mid });
    shoulder.userData.armourPanel = true;
  }
  glowPlate(hips, 0.22, 0.08, 0.05, 0, 0.76, 0.35, accent, 0.95);
  addTrooperFactionParts(hips, side, role, P, accent);

  const makeArm = (sgn) => {
    const arm = new THREE.Group();
    arm.position.set(sgn * 0.49, 0.9, 0);
    if (machine) bx(arm, 0.27, 0.43, 0.3, 0, -0.23, 0, P.shell);
    else frustum(arm, { rt: 0.12, rb: 0.16, h: 0.43, seg: 6, y: -0.23,
      sx: 0.92, sz: 0.78, color: P.shell });
    sph(arm, 0.13, 0, -0.47, 0.02, P.deep);
    if (machine) tboxF(arm, { w0: 0.3, d0: 0.32, w1: 0.21, d1: 0.25, h: 0.39 },
      0, -0.68, 0, P.mid);
    else frustum(arm, { rt: 0.1, rb: swarm ? 0.09 : 0.13, h: 0.39, seg: 6, y: -0.68,
      sx: 0.9, sz: 0.78, color: P.mid });
    frustum(arm, { rt: 0.1, rb: 0.13, h: 0.18, seg: 6, y: -0.94,
      sx: 0.85, sz: 0.75, color: machine || swarm ? P.deep : 0x9f7759 });
    hips.add(arm);
    return arm;
  };
  const armL = makeArm(-1), armR = makeArm(1);

  const head = new THREE.Group();
  head.position.set(0, 1.18, 0.01);
  hips.add(head);
  if (swarm) {
    frustum(head, { rt: 0.13, rb: 0.25, h: 0.36, seg: 6, y: 0.04, sz: 1.1, color: P.shell });
    for (const x of [-0.11, 0.11]) {
      const eye = glowPlate(head, 0.13, 0.11, 0.06, x, 0.06, 0.23, P.glass, 0.75);
      eye.rotation.z = x < 0 ? 0.22 : -0.22;
    }
    for (const sgn of [-1, 1]) strut(head, [sgn * 0.14, 0.18, -0.08],
      [sgn * 0.24, 0.42, -0.1], 0.017, P.dark);
  } else if (machine) {
    tboxF(head, { w0: 0.36, d0: 0.38, w1: 0.48, d1: 0.42, h: 0.34 },
      0, 0.03, 0, P.dark);
    bx(head, 0.5, 0.1, 0.46, 0, 0.21, -0.02, P.mid);
    glowPlate(head, 0.1, 0.13, 0.055, 0, 0.05, 0.23, accent, 1.1);
  } else {
    sph(head, 0.22, 0, 0, 0, 0xb88968);
    tboxF(head, { w0: 0.55, d0: 0.48, w1: 0.38, d1: 0.36, h: 0.25 },
      0, 0.13, -0.015, P.mid);
  }
  for (const x of [-0.25, 0.25]) bx(head, 0.07, 0.2, 0.16, x, -0.02, -0.04, P.dark);
  if (!machine && !swarm) {
    const visor = glowPlate(head, 0.38, 0.09, 0.06, 0, 0.04, 0.21, P.glass, 0.38);
    visor.userData.noOutline = true;
  }
  if (role !== 'soldier') {
    bx(hips, 0.12, 0.34, 0.18, -0.28, 0.65, -0.42, P.trim); // 專職彈藥筒
  }

  const weapon = weaponGroup(spec.weapon, accent, P);
  let gunR;
  if (spec.weapon === 'rocket') {
    weapon.g.position.set(0.29, 1.05, 0.02);
    weapon.g.rotation.x = -0.2;
    hips.add(weapon.g);
    gunR = { g: weapon.g, rest: -0.2, aim: -0.04 };
  } else {
    weapon.g.position.set(0.02, -0.8, 0.3);
    armR.add(weapon.g);
    gunR = { g: weapon.g, rest: 0.06, aim: spec.weapon === 'grenade' ? 0.08 : 0.55,
      ...(spec.weapon === 'grenade' ? { comp: 0.55 } : {}) };
  }
  const mounted = spec.weapon === 'rocket';
  const legChainL = limbChain(legL, -0.61, -1.12);
  const legChainR = limbChain(legR, -0.61, -1.12);
  const armChainL = limbChain(armL, -0.47);
  const armChainR = limbChain(armR, -0.47);
  if (!mounted) {
    gunR.aim += 0.65;
    if (gunR.comp != null) gunR.comp += 0.65;
  }
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR, head, headY0: head.position.y,
    legChainL, legChainR, armChainL, armChainR,
    hipsY0: hipY, stride: spec.stride, bob: 0.065, sway: 0.055, top: 8,
    gunArm: true, gunR,
    aimPose: mounted
      ? { rShoulderX: -0.7, lShoulderX: -0.85, lShoulderY: 0.55, rElbowX: -0.65, lElbowX: -0.65 }
      : { rShoulderX: -0.55, lShoulderX: -0.5, lShoulderY: 0.45, rElbowX: -0.65, lElbowX: -0.65 },
    weap: { light: mounted ? 'N' : 'R', heavy: mounted ? 'N' : 'R' },
    hvy: { chest: mounted ? 0.05 : 0.04, gun: mounted ? 0.1 : 0 },
    lightGlow: [{ mesh: weapon.muzzle, base: 0.8 }],
    muzzles: { light: { n: weapon.muzzle, r: role === 'soldier' ? 0.075 : 0.095 }, heavy: null },
    attacks: [recoilMount(weapon.g, [...weapon.g.children], [weapon.muzzle], mounted ? 0.1 : 0.065)],
  };
  g.userData.rig.attacks[0].cycle = [mechanism(weapon.bolt, 'z', -0.16, 0, 0, 'position')];
  for (const chain of [legChainL, legChainR]) {
    const knee = chain[0].g;
    tboxF(knee, { w0: 0.24, d0: 0.08, w1: 0.28, d1: 0.13, h: 0.23 }, 0, 0.04, 0.14, P.trim);
  }
  return g;
}

function addWheel(hull, wheels, x, z, r, width, P) {
  const w = cyl(hull, r, r, width, 10, x, r, z, P.deep, { metalness: 0.55 });
  w.rotation.z = Math.PI / 2;
  const hub = cyl(w, r * 0.46, r * 0.46, width * 1.04, 8, 0, 0, 0, P.mid, { metalness: 0.65 });
  hub.userData.noOutline = false;
  wheels.push({ m: w, r });
}

function vehicleTurret(parent, role, accent, P, S) {
  const turret = markBatch(new THREE.Group(), 'vehicle_turret', `${role}:${S.reference}`);
  turret.position.set(0, S.turretY, S.turretZ);
  parent.add(turret);
  let pitchY = 0.38;
  let pitchZ = role === 'tank' ? 0.82 : 0.52;
  if (S.turret === 'hive-pod') {
    frustum(turret, { rt: role === 'tank' ? 0.72 : 0.4, rb: role === 'tank' ? 1.05 : 0.7,
      h: 0.48, seg: 6, y: 0.24, sz: 1.15, color: P.shell });
    for (const sgn of [-1, 1]) {
      const petal = finF(turret, { len: 0.9, w0: 0.65, w1: 0.25, t: 0.14, sweep: 0.22 },
        sgn * 0.55, 0.42, -0.25, P.mid);
      petal.rotation.z = sgn * -0.45;
    }
    glowPlate(turret, 0.3, 0.09, 0.07, 0, 0.57, 0.35, P.glass, 0.8);
  } else if (S.turret === 't55-dome') {
    const dome = sph(turret, role === 'tank' ? 1.05 : 0.65, 0, 0.22, 0, P.shell,
      { metalness: 0.56 });
    dome.scale.set(1.08, 0.52, 0.92);
    cyl(turret, 0.18, 0.2, 0.32, 8, 0.62, 0.62, -0.2, P.dark);
  } else if (S.turret === 'bastion-block') {
    tboxF(turret, { w0: 2.1, d0: 2.15, w1: 1.65, d1: 1.72, h: 0.78 },
      0, 0.39, 0, P.shell);
    for (const x of [-0.83, 0.83]) {
      const cheek = bx(turret, 0.58, 0.64, 1.55, x, 0.32, 0.18, P.mid);
      cheek.rotation.z = x < 0 ? -0.18 : 0.18;
    }
    bx(turret, 1.25, 0.42, 0.85, 0, 0.58, -1.05, P.dark);
    for (const x of [-0.55, 0.55]) bx(turret, 0.14, 0.1, 1.25, x, 0.82, 0, P.trim);
    glowPlate(turret, 0.22, 0.18, 0.08, 0.62, 0.78, 0.48, accent, 0.7);
    pitchY = 0.48; pitchZ = 0.9;
  } else if (S.turret === 'abrams-wedge') {
    bx(turret, 2.25, 0.68, 2.45, 0, 0.35, -0.05, P.shell, { metalness: 0.62 });
    for (const x of [-0.78, 0.78]) {
      const cheek = bx(turret, 0.85, 0.62, 1.6, x, 0.32, 0.58, P.mid);
      cheek.rotation.y = x < 0 ? -0.22 : 0.22;
    }
    bx(turret, 2.15, 0.52, 1.35, 0, 0.46, -1.55, P.dark);
  } else if (S.turret === 'open-ring') {
    torus(turret, 0.62, 0.12, 0, 0.1, 0, P.dark).rotation.x = Math.PI / 2;
    bx(turret, 0.8, 0.42, 0.72, 0, 0.42, 0.05, P.mid);
    pitchY = 0.44; pitchZ = 0.38;
  } else if (S.turret === 'crows') {
    cyl(turret, 0.34, 0.42, 0.25, 8, 0, 0.13, 0, P.dark);
    bx(turret, 0.72, 0.52, 0.64, 0, 0.48, 0.02, P.shell);
    glowPlate(turret, 0.16, 0.14, 0.06, 0.31, 0.66, 0.24, accent, 0.72);
    pitchY = 0.5; pitchZ = 0.36;
  } else {
    frustum(turret, { rt: 0.48, rb: 0.7, h: 0.46, seg: 8, y: 0.23,
      sx: 1.15, sz: 0.9, color: P.shell, opts: { metalness: 0.55 } });
  }
  const pitch = new THREE.Group();
  pitch.position.set(0, pitchY, pitchZ);
  turret.add(pitch);
  turret.userData.pitch = pitch;
  const bore = role === 'tank' ? 0.14 : 0.08;
  const barrel = cyl(pitch, bore, bore * 1.18, S.barrel, 10, 0, 0, S.barrel * 0.5,
    P.deep, { metalness: 0.85 });
  barrel.rotation.x = Math.PI / 2;
  if (S.turret === 'hive-pod') {
    for (const z of [0.35, 0.8]) frustum(pitch, { rt: bore * 1.8, rb: bore * 2.3,
      h: 0.28, seg: 6, z, rx: Math.PI / 2, color: P.shell });
  } else if (S.turret === 'bastion-block') {
    bx(pitch, bore * 3.4, bore * 2.8, S.barrel * 0.6, 0, 0, S.barrel * 0.32, P.mid);
  }
  for (const z of [S.barrel * 0.45, S.barrel * 0.72]) {
    torus(pitch, bore * 1.25, bore * 0.24, 0, 0, z, P.mid, { metalness: 0.72 });
  }
  const muzzle = torus(pitch, bore * 1.28, bore * 0.3, 0, 0, S.barrel + 0.02, accent,
    { emissive: accent, emissiveIntensity: 0.85 });
  turret.userData.modelReference = S.reference;
  turret.userData.attack = recoilMount(pitch, [...pitch.children], [muzzle], role === 'tank' ? 0.5 : 0.18);
  return { turret, muzzle };
}

function buildApc(side) {
  const S = machineModel(side, 'apc'), P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'vehicle', `apc:${S.reference}`);
  const hull = new THREE.Group();
  g.add(hull);
  for (const x of [-1, 1]) {
    for (let i = 0; i < 3; i++) tboxF(hull,
      { w0: 0.12, d0: S.L * 0.19, w1: 0.09, d1: S.L * 0.17, h: 0.44 },
      x * S.W * 0.46, S.waist - 0.22, (i - 1) * S.L * 0.23, P.dark);
    bx(hull, 0.08, 0.08, S.L * 0.68, x * S.W * 0.43, S.roof - 0.12, -0.2, P.trim);
  }
  bx(hull, S.W * 0.84, 0.34, S.L * 0.92, 0, S.sill, -0.08, P.deep, { metalness: 0.58 });
  if (S.profile === 'hive') {
    for (let i = 0; i < 4; i++) {
      const pod = frustum(hull, { rt: S.W * 0.37, rb: S.W * 0.48, h: S.L * 0.215,
        seg: 6, y: 1.48, z: (i - 1.5) * S.L * 0.21, rx: Math.PI / 2,
        sz: 0.78, color: i % 2 ? P.mid : P.shell });
      pod.name = 'hive-carapace';
    }
    tboxF(hull, { w0: S.W * 0.65, d0: 1.5, w1: S.W * 0.38, d1: 0.85, h: 0.6 },
      0, 1.86, S.L * 0.36, P.shell);
    for (const x of [-0.48, 0.48]) glowPlate(hull, 0.32, 0.11, 0.08, x, 1.96, S.L * 0.45, P.glass, 0.7);
  } else if (S.profile === 'bastion') {
    tboxF(hull, { w0: S.W * 0.94, d0: S.L * 0.88,
      w1: S.W * 0.76, d1: S.L * 0.74, h: 1.35 }, 0, 1.48, -0.1, P.shell);
    bx(hull, S.W * 0.72, 0.58, S.L * 0.55, 0, S.roof - 0.34, -0.8, P.dark);
    for (const x of [-1, 1]) {
      for (let i = 0; i < 4; i++) bx(hull, 0.18, 0.72, 1.28,
        x * S.W * 0.48, 1.6, (i - 1.5) * S.L * 0.205, P.mid);
      bx(hull, 0.16, 0.14, S.L * 0.74, x * S.W * 0.48, 2.06, 0, P.trim);
    }
    glowPlate(hull, S.W * 0.45, 0.1, 0.08, 0, 1.86, S.L * 0.44, accent, 0.7);
  } else if (S.profile === 'casspir') {
    const vHull = bx(hull, S.W * 0.76, 0.7, S.L * 0.7, 0, 1.22, 0, P.dark);
    vHull.rotation.z = Math.PI / 4;
    rbz(hull, S.W * 0.7, S.roof - 1.45, S.L * 0.52, 0, 2.16, -0.2, P.shell);
    for (const x of [-0.5, 0, 0.5]) glowPlate(hull, 0.38, 0.5, 0.055, x, 2.5, 1.65, P.glass, 0.3);
    bx(hull, S.W * 0.78, 0.18, S.L * 0.62, 0, S.roof + 0.08, -0.2, P.trim);
  } else {
    bx(hull, S.W * 0.94, S.waist - S.sill, S.L * 0.8, 0,
      (S.waist + S.sill) * 0.5, -0.22, P.shell, { metalness: 0.48 });
    const front = bx(hull, S.W * 0.9, 0.82, 1.45, 0, 1.32, S.L * 0.38, P.mid);
    front.rotation.x = 0.32;
    bx(hull, S.W * 0.88, S.roof - S.waist, S.L * 0.52, 0,
      (S.roof + S.waist) * 0.5, -0.72, P.mid);
    for (const x of [-0.52, 0.52]) glowPlate(hull, 0.44, 0.3, 0.055, x, 1.92, 1.7, P.glass, 0.28);
  }
  for (const x of [-1, 1]) glowPlate(hull, 0.22, 0.16, 0.08,
    x * S.W * 0.31, 1.0, S.L * 0.48, 0xffefbd, 0.6);
  const wheels = [];
  for (const x of [-1, 1]) for (const z of S.axles) {
    addWheel(hull, wheels, x * S.W * 0.52, z, S.wheelR, S.profile === 'casspir' ? 0.5 : 0.42, P);
  }
  const { turret, muzzle } = vehicleTurret(hull, 'apc', accent, P, S);
  g.userData.modelReference = S.reference;
  g.userData.turret = turret;
  g.userData.rig = {
    kind: 'wheeled', hull, hullY0: 0, wheels, top: 11,
    attacks: [turret.userData.attack],
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0 }, kickAmp: { light: 1.6 },
    lightGlow: [{ mesh: muzzle, base: 0.8 }],
    muzzles: { light: { n: muzzle, r: 0.12 }, heavy: null },
  };
  return g;
}

function buildTank(side) {
  const S = machineModel(side, 'tank'), P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'vehicle', `tank:${S.reference}`);
  const hull = new THREE.Group();
  g.add(hull);
  for (const x of [-1, 1]) for (let i = 0; i < 4; i++) tboxF(hull,
    { w0: 0.13, d0: S.L * 0.16, w1: 0.1, d1: S.L * 0.14, h: 0.42 },
    x * S.W * 0.48, 1.15, (i - 1.5) * S.L * 0.19, P.shell, { metalness: 0.65 });
  if (S.profile === 'hive') {
    bx(hull, S.W * 0.54, 0.7, S.L * 0.78, 0, S.hullY, -0.08, P.dark);
    for (let i = 0; i < 4; i++) frustum(hull, { rt: S.W * 0.3, rb: S.W * 0.43,
      h: S.L * 0.21, seg: 6, y: S.hullY + 0.1, z: (i - 1.5) * S.L * 0.21,
      rx: Math.PI / 2, sz: 0.58, color: i % 2 ? P.mid : P.shell });
  } else if (S.profile === 'bastion') {
    tboxF(hull, { w0: S.W * 0.86, d0: S.L * 0.88, w1: S.W * 0.69,
      d1: S.L * 0.78, h: 1.08 }, 0, S.hullY, -0.08, P.shell);
    for (const x of [-1, 1]) for (let i = 0; i < 4; i++) bx(hull, 0.3, 0.72, S.L * 0.18,
      x * S.W * 0.46, 0.92, (i - 1.5) * S.L * 0.2, P.dark);
  } else bx(hull, S.W * 0.7, 0.9, S.L * 0.8, 0, S.hullY, -0.08, P.shell, { metalness: 0.56 });
  const glacis = bx(hull, S.W * 0.68, S.profile === 'bastion' ? 0.78 : 0.62,
    S.profile === 'abrams' ? 2.15 : 1.55, 0, S.hullY + 0.12, S.L * 0.37, P.mid,
    { metalness: 0.6 });
  glacis.rotation.x = S.profile === 'abrams' ? 0.28 : 0.43;
  const wheels = [];
  for (const sideX of [-1, 1]) {
    const x = sideX * S.W * 0.42;
    bx(hull, 0.64, 0.24, S.L * 0.88, x, 0.2, 0, P.deep);
    bx(hull, 0.62, 0.24, S.L * 0.84, x, 1.08, 0, P.dark);
    for (const z of S.axles) addWheel(hull, wheels, x, z, S.wheelR, 0.68, P);
    bx(hull, 0.58, 0.26, S.L * 0.77, x, 1.16, 0, P.mid);
  }
  if (S.profile === 'hive') {
    for (const x of [-1.05, 1.05]) glowPlate(hull, 0.22, 0.08, 0.1, x, 1.6, 2.45, P.glass, 0.75);
  } else if (S.profile === 'bastion') {
    bx(hull, S.W * 0.58, 0.4, 2.2, 0, 1.8, -2.2, P.dark);
    for (const x of [-1.05, 1.05]) glowPlate(hull, 0.2, 0.16, 0.06, x, 1.5, 3.35, accent, 0.55);
  } else if (S.profile === 't55') {
    for (const x of [-0.65, 0.65]) {
      const drum = cyl(hull, 0.24, 0.24, 1.55, 10, x, 1.62, -2.45, P.dark);
      drum.rotation.x = Math.PI / 2;
    }
  } else {
    bx(hull, S.W * 0.66, 0.25, 2.5, 0, 1.72, -2.35, P.dark);
    for (const x of [-1.05, 1.05]) glowPlate(hull, 0.24, 0.16, 0.06, x, 1.38, 3.25, 0xffefbd, 0.58);
  }
  const { turret, muzzle } = vehicleTurret(hull, 'tank', accent, P, S);
  g.userData.modelReference = S.reference;
  g.userData.turret = turret;
  g.userData.rig = {
    kind: 'tracked', hull, hullY0: 0, wheels, top: 9,
    attacks: [turret.userData.attack],
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0 }, kickAmp: { light: 2.2 },
    lightGlow: [{ mesh: muzzle, base: 0.8 }],
    muzzles: { light: { n: muzzle, r: 0.22 }, heavy: null },
  };
  return g;
}

function addRotor(parent, y, count, radius, phase = 0) {
  const rotor = new THREE.Group();
  rotor.position.set(0, y, -0.08);
  parent.add(rotor);
  for (let k = 0; k < count; k++) {
    const a = phase + k * TAU / count;
    const blade = bx(rotor, radius, 0.045, 0.15, radius * 0.5, 0, 0, 0xaab3ba,
      { transparent: true, opacity: 0.8 });
    blade.rotation.y = a;
    blade.position.set(Math.cos(a) * radius * 0.5, 0, -Math.sin(a) * radius * 0.5);
  }
  return rotor;
}

function buildHeli(side) {
  const S = machineModel(side, 'heli'), P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'aircraft', `heli:${S.reference}`);
  const tilt = new THREE.Group();
  tilt.position.y = 1.65;
  g.add(tilt);
  if (S.profile !== 'hive' && S.profile !== 'bastion') {
    rbz(tilt, S.bodyW, S.bodyH, S.bodyL, 0, 0, 0.28, P.shell, { metalness: 0.5 });
  }
  if (S.profile === 'hive') {
    for (let i = 0; i < 3; i++) frustum(tilt, { rt: 0.5 - i * 0.07, rb: 0.7 - i * 0.06,
      h: 0.9, seg: 6, z: 0.95 - i * 0.85, rx: Math.PI / 2, sz: 0.78,
      color: i % 2 ? P.mid : P.shell });
    frustum(tilt, { rt: 0.17, rb: 0.48, h: 0.75, seg: 6, z: 1.8,
      rx: Math.PI / 2, sz: 0.8, color: P.dark });
    for (const x of [-0.18, 0.18]) glowPlate(tilt, 0.2, 0.14, 0.07, x, 0.02, 2.2, P.glass, 0.8);
    for (const sgn of [-1, 1]) {
      const wing = finF(tilt, { len: 1.65, w0: 0.75, w1: 0.18, t: 0.1, sweep: 0.45 },
        sgn * 0.54, 0.06, 0.1, P.shell);
      wing.rotation.z = sgn * -Math.PI / 2;
    }
  } else if (S.profile === 'bastion') {
    tboxF(tilt, { w0: S.bodyW * 0.8, d0: S.bodyL, w1: S.bodyW,
      d1: S.bodyL * 0.82, h: S.bodyH }, 0, 0, 0.28, P.shell);
    bx(tilt, 1.35, 0.68, 1.0, 0, 0.1, 1.85, P.dark);
    glowPlate(tilt, 0.9, 0.12, 0.07, 0, 0.12, 2.38, accent, 0.85);
    for (const x of [-1, 1]) {
      bx(tilt, 0.3, 0.64, 2.0, x * 0.9, -0.05, 0.6, P.mid);
      tboxF(tilt, { w0: 1.4, d0: 0.9, w1: 1.15, d1: 0.72, h: 0.18 },
        x * 1.05, -0.16, 0.25, P.dark);
    }
  } else if (S.profile === 'huey') {
    bx(tilt, S.bodyW, S.bodyH, 2.35, 0, 0, 0.1, P.shell);
    for (const x of [-1, 1]) glowPlate(tilt, 0.06, 0.75, 1.25,
      x * (S.bodyW * 0.5 + 0.02), 0.1, 0.25, P.glass, 0.25);
    rbz(tilt, 1.25, 0.85, 0.75, 0, -0.02, 1.5, P.glass,
      { emissive: P.glass, emissiveIntensity: 0.28 });
  } else {
    const canopy = frustum(tilt, { rt: 0.12, rb: 0.48, h: 1.45, seg: 6,
      y: 0.03, z: 1.98, rx: Math.PI / 2, sx: 0.9, sz: 0.68, color: P.glass,
      opts: { emissive: P.glass, emissiveIntensity: 0.32 } });
    canopy.userData.noOutline = false;
    for (const x of [-1, 1]) bx(tilt, 1.35, 0.11, 0.42, x * 0.86, -0.08, 0.12, P.mid);
  }
  const tailEnd = -S.tailL;
  strut(tilt, [0, 0.18, -1.0], [0, 0.36, tailEnd], S.profile === 'huey' ? 0.18 : 0.15,
    P.dark, { metalness: 0.52 });
  if (S.profile === 'bastion') {
    for (const x of [-0.34, 0.34]) bx(tilt, 0.08, 0.82, 0.72, x, 0.68, tailEnd + 0.25, P.mid);
  } else {
    bx(tilt, 0.09, 0.78, 0.62, 0, 0.62, tailEnd + 0.18, P.mid);
  }
  glowPlate(tilt, 0.12, 0.12, 0.06, 0, 0.62, tailEnd - 0.18, accent, 0.92);
  cyl(tilt, 0.11, 0.14, S.coaxial ? 0.75 : 0.48, 8, 0, 0.92, -0.08,
    P.deep, { metalness: 0.72 });
  const spin = [];
  spin.push(addRotor(tilt, S.coaxial ? 1.34 : 1.16, S.blades, S.profile === 'huey' ? 4.9 : 4.35));
  if (S.coaxial) {
    const upper = addRotor(tilt, 1.62, S.blades, 4.15, Math.PI / S.blades);
    upper.userData.spinRate = -40;
    spin.push(upper);
  }
  if (S.tailRotor) {
    const tailRotor = new THREE.Group();
    tailRotor.userData.spinAxis = 'z';
    tailRotor.userData.spinRate = 54;
    tailRotor.position.set(0.24, 0.36, tailEnd + 0.05);
    tilt.add(tailRotor);
    const tailBlades = S.profile === 'apache' ? 4 : 3;
    for (let k = 0; k < tailBlades; k++) {
      const a = k * TAU / tailBlades;
      const blade = bx(tailRotor, 0.06, 0.82, 0.08, 0, 0.38, 0, 0xaab3ba,
        { transparent: true, opacity: 0.8 });
      blade.rotation.z = a;
      blade.position.set(-Math.sin(a) * 0.36, Math.cos(a) * 0.36, 0);
    }
    spin.push(tailRotor);
  }
  for (const sideX of [-1, 1]) {
    strut(tilt, [sideX * 0.42, -0.35, 0.65], [sideX * 0.78, -0.78, 0.72],
      0.05, P.deep, { metalness: 0.65 });
    strut(tilt, [sideX * 0.42, -0.35, -0.62], [sideX * 0.78, -0.78, -0.72],
      0.05, P.deep, { metalness: 0.65 });
    bx(tilt, 0.07, 0.07, 1.95, sideX * 0.78, -0.79, 0, P.deep);
  }
  const gunTilt = new THREE.Group();
  gunTilt.position.set(0, -0.52, 0.72);
  tilt.add(gunTilt);
  const podSpan = S.profile === 'huey' ? 1.12 : 0.92;
  bx(gunTilt, podSpan * 2.25, 0.11, 0.44, 0, 0, 0, P.dark);
  const muzzles = [];
  const attacks = [];
  for (const sideX of [-1, 1]) {
    const pod = cyl(gunTilt, 0.17, 0.2, 0.92, 8, sideX * podSpan, -0.04, 0.22,
      P.mid, { metalness: 0.62 });
    pod.rotation.x = Math.PI / 2;
    const muzzle = torus(gunTilt, 0.15, 0.035, sideX * podSpan, -0.04, 0.7, accent,
      { emissive: accent, emissiveIntensity: 0.82 });
    muzzles.push(muzzle);
    attacks.push(recoilMount(gunTilt, [pod, muzzle], [muzzle], 0.14));
  }
  g.userData.modelReference = S.reference;
  for (const x of [-1, 1]) {
    const intakeX = x * S.bodyW * 0.33;
    rbz(tilt, 0.35, 0.35, 1.4, intakeX, 0.65, -0.5, P.dark, { metalness: 0.7 });
    for (let i = 0; i < 3; i++) bx(tilt, 0.28, 0.025, 0.08, intakeX, 0.84, -0.85 + i * 0.2, P.mid);
    const fin = finF(tilt, { len: 0.7, w0: 0.45, w1: 0.24, t: 0.06, sweep: 0.15 },
      x * 0.2, 0.36, tailEnd + 0.2, P.shell);
    fin.rotation.z = x * -Math.PI / 2;
  }
  g.userData.spin = spin;
  g.userData.gunTilt = gunTilt;
  g.userData.turretMuzzles = muzzles;
  g.userData.rig = {
    kind: 'aerial', tilt, tiltY0: 1.65, bob: 0.055, top: 16,
    attacks,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.03 },
    lightGlow: muzzles.map((mesh) => ({ mesh, base: 0.82 })),
    muzzles: { light: { n: muzzles[1], r: 0.15 }, heavy: null },
  };
  return g;
}

function buildBunker(side) {
  const S = machineModel(side, 'bunker'), P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'structure', `bunker:${S.reference}`);
  if (S.profile === 'hive') {
    frustum(g, { rt: 3.6, rb: 4.2, h: 0.7, seg: 6, y: 0.35, ry: Math.PI / 6, color: P.dark });
    for (const x of [-2, 0, 2]) {
      frustum(g, { rt: 1.3, rb: 1.4, h: 3.2, seg: 6, x, y: 1.75,
        rx: Math.PI / 2, sz: 0.95, color: P.shell });
      frustum(g, { rt: 0.96, rb: 0.96, h: 0.08, seg: 6, x, y: 1.75,
        z: 1.64, rx: Math.PI / 2, color: P.deep });
      glowPlate(g, 0.5, 0.08, 0.09, x, 2.47, 1.74, accent, 0.8);
    }
    strut(g, [0, 2.8, -1.05], [0, 4.55, -1.05], 0.07, P.dark);
    frustum(g, { rt: 0.25, rb: 0.7, h: 0.4, seg: 6, y: 4.35, z: -1.05, color: P.mid });
  } else if (S.profile === 'bastion') {
    bx(g, 7.3, 0.8, 6.0, 0, 0.4, 0, P.dark);
    tboxF(g, { w0: 6.4, d0: 5.2, w1: 5.4, d1: 4.3, h: 2.7 }, 0, 2.15, 0, P.shell);
    bx(g, 6.2, 0.6, 5.3, 0, 3.7, 0, P.mid);
    for (const x of [-2.8, 2.8]) {
      bx(g, 0.8, 2.9, 5.7, x, 1.95, 0, P.dark);
      glowPlate(g, 0.1, 1.35, 0.08, x, 2.15, 2.9, accent, 0.7);
    }
    bx(g, 3.4, 0.42, 0.14, 0, 2.8, 2.48, P.deep);
    glowPlate(g, 1.4, 0.08, 0.07, 0, 2.79, 2.58, accent, 0.75);
  } else if (S.profile === 'stone-sangar') {
    for (let k = 0; k < 12; k++) {
      const a = k * TAU / 12;
      const r = k % 2 ? 3.05 : 3.35;
      const stone = rbz(g, 1.15, 0.72 + (k % 3) * 0.12, 1.0,
        Math.sin(a) * r, 0.4, Math.cos(a) * r, k % 2 ? P.mid : P.dark);
      stone.rotation.y = a;
    }
    for (const x of [-2.0, 2.0]) strut(g, [x, 0.65, -1.6], [x, 3.65, -1.6], 0.08, P.deep);
    const roof = bx(g, 5.2, 0.18, 3.8, 0, 3.45, -0.45, P.trim);
    roof.rotation.z = -0.08;
    bx(g, 1.1, 1.45, 0.42, 0, 1.42, 3.0, P.deep);
  } else {
    // HESCO：矩形 U 形牆留下正面真缺口，輪廓與圓形掩體完全不同。
    for (const x of [-3.15, 3.15]) {
      for (const z of [-2.2, -0.7, 0.8]) rbz(g, 1.1, 1.2, 1.35, x, 0.6, z, P.trim);
    }
    for (const x of [-2.1, -0.7, 0.7, 2.1]) rbz(g, 1.25, 1.2, 1.1, x, 0.6, -3.05, P.trim);
    bx(g, 4.1, 0.24, 3.4, 0, 2.55, -1.15, P.dark);
    for (const x of [-1.7, 1.7]) strut(g, [x, 1.15, -2.5], [x, 2.55, -2.5], 0.08, P.deep);
    bx(g, 2.0, 1.55, 1.7, 1.55, 3.45, -1.25, P.shell);
    glowPlate(g, 0.18, 0.48, 0.08, 1.55, 3.6, -0.36, accent, 0.65);
  }
  g.userData.factionLanguage = side;
  const sensor = new THREE.Group();
  sensor.position.set(0, S.profile === 'stone-sangar' ? 3.5 : 2.5, -0.4);
  g.add(sensor);
  cyl(sensor, 0.12, 0.15, 0.42, 8, 0, 0.21, 0, P.deep);
  const head = bx(sensor, 0.45, 0.24, 0.34, 0, 0.48, 0, P.mid);
  glowPlate(head, 0.24, 0.05, 0.05, 0, 0, 0.19, accent, 0.75);
  g.userData.rig = { kind: 'static', attacks: [], mechanisms: [mechanism(sensor, 'y', 0.75, 0.45)] };
  g.userData.modelReference = S.reference;
  return g;
}

// 一個職業一列，只描述剪影語意；同族零件由 addProfessionKit 統一生成。
export const CIVILIAN_PROFESSION_KITS = Object.freeze({
  '醫師': Object.freeze({ head: 'medical', coat: 'lab', prop: 'stetho' }),
  '工程師': Object.freeze({ head: 'hardhat', coat: 'vest', prop: 'toolbox' }),
  '商人': Object.freeze({ head: 'cap', coat: 'suit', prop: 'briefcase' }),
  '廚師': Object.freeze({ head: 'toque', coat: 'apron', prop: 'pan' }),
  '電工': Object.freeze({ head: 'hardhat', coat: 'work', prop: 'coil' }),
  '教師': Object.freeze({ head: 'none', coat: 'cardigan', prop: 'books' }),
  '農夫': Object.freeze({ head: 'straw', coat: 'work', prop: 'hoe' }),
  '記者': Object.freeze({ head: 'cap', coat: 'vest', prop: 'camera' }),
  '郵差': Object.freeze({ head: 'cap', coat: 'work', prop: 'satchel' }),
  '建築工': Object.freeze({ head: 'hardhat', coat: 'vest', prop: 'level' }),
  '護理師': Object.freeze({ head: 'medical', coat: 'lab', prop: 'clipboard' }),
  '藥師': Object.freeze({ head: 'medical', coat: 'lab', prop: 'medicine' }),
  '銀行員': Object.freeze({ head: 'none', coat: 'suit', prop: 'ledger' }),
  '程式設計師': Object.freeze({ head: 'headset', coat: 'casual', prop: 'laptop' }),
  '會計師': Object.freeze({ head: 'none', coat: 'cardigan', prop: 'ledger' }),
  '律師': Object.freeze({ head: 'none', coat: 'suit', prop: 'folder' }),
  '獸醫': Object.freeze({ head: 'medical', coat: 'lab', prop: 'petcase' }),
  '技師': Object.freeze({ head: 'visor', coat: 'work', prop: 'meter' }),
  '攤販': Object.freeze({ head: 'straw', coat: 'apron', prop: 'tray' }),
  '心理師': Object.freeze({ head: 'none', coat: 'cardigan', prop: 'notepad' }),
});

function addProfessionKit(hips, row, cloth, kit = CIVILIAN_PROFESSION_KITS[row.name]) {
  const hat = row.hat ?? dim(cloth, 0.8);
  const bag = row.bag ?? dim(cloth, 0.55);
  if (kit.coat === 'lab') bx(hips, 0.43, 0.58, 0.055, 0, 0.54, 0.25, 0xe3e5e1);
  else if (kit.coat === 'vest') bx(hips, 0.42, 0.42, 0.06, 0, 0.62, 0.25, hat);
  else if (kit.coat === 'suit') {
    for (const sgn of [-1, 1]) {
      const lapel = bx(hips, 0.08, 0.36, 0.055, sgn * 0.09, 0.67, 0.27, hat);
      lapel.rotation.z = sgn * 0.42;
    }
  } else if (kit.coat === 'apron') bx(hips, 0.36, 0.5, 0.055, 0, 0.47, 0.26, bag);
  else if (kit.coat === 'cardigan') {
    bx(hips, 0.05, 0.45, 0.055, 0, 0.58, 0.26, hat);
  } else if (kit.coat === 'work') {
    for (const x of [-0.15, 0.15]) bx(hips, 0.12, 0.16, 0.07, x, 0.46, 0.26, bag);
  }

  if (kit.head === 'medical') {
    frustum(hips, { rt: 0.19, rb: 0.23, h: 0.08, seg: 8, y: 1.38, color: hat });
    glowPlate(hips, 0.08, 0.08, 0.025, 0, 1.39, 0.22, bag, 0.08);
  } else if (kit.head === 'hardhat') {
    frustum(hips, { rt: 0.18, rb: 0.25, h: 0.12, seg: 8, y: 1.4, color: hat });
    bx(hips, 0.5, 0.045, 0.32, 0, 1.35, 0.04, hat);
  } else if (kit.head === 'toque') {
    cyl(hips, 0.19, 0.22, 0.3, 10, 0, 1.49, 0, hat);
  } else if (kit.head === 'straw') {
    cyl(hips, 0.31, 0.31, 0.035, 12, 0, 1.36, 0, hat);
    frustum(hips, { rt: 0.12, rb: 0.21, h: 0.16, seg: 10, y: 1.45, color: hat });
  } else if (kit.head === 'cap') {
    frustum(hips, { rt: 0.17, rb: 0.23, h: 0.1, seg: 8, y: 1.37, color: hat });
    bx(hips, 0.22, 0.035, 0.18, 0, 1.34, 0.17, hat);
  } else if (kit.head === 'headset') {
    const band = torus(hips, 0.23, 0.025, 0, 1.2, 0, hat); band.rotation.x = Math.PI / 2;
    bx(hips, 0.06, 0.18, 0.08, 0.22, 1.18, 0, bag);
  } else if (kit.head === 'visor') {
    glowPlate(hips, 0.34, 0.1, 0.04, 0, 1.18, 0.2, hat, 0.15);
  }

  if (kit.prop === 'stetho') {
    const ring = torus(hips, 0.16, 0.018, 0, 0.72, 0.3, bag); ring.rotation.x = Math.PI / 2;
  } else if (['toolbox', 'briefcase', 'satchel', 'petcase'].includes(kit.prop)) {
    const w = kit.prop === 'petcase' ? 0.46 : 0.36;
    bx(hips, w, 0.3, 0.15, 0.38, 0.34, -0.08, bag);
    const handle = torus(hips, 0.1, 0.018, 0.38, 0.52, -0.08, hat); handle.rotation.x = Math.PI / 2;
  } else if (kit.prop === 'pan') {
    const pan = torus(hips, 0.16, 0.035, 0.38, 0.32, 0.02, bag); pan.rotation.x = Math.PI / 2;
    strut(hips, [0.38, 0.32, 0.02], [0.7, 0.18, 0.04], 0.025, bag);
  } else if (kit.prop === 'coil') {
    const coil = torus(hips, 0.15, 0.035, 0.36, 0.38, -0.04, bag); coil.rotation.y = Math.PI / 2;
  } else if (kit.prop === 'books' || kit.prop === 'ledger' || kit.prop === 'folder'
    || kit.prop === 'clipboard' || kit.prop === 'notepad' || kit.prop === 'laptop') {
    bx(hips, 0.34, 0.25, 0.06, -0.34, 0.4, 0.12, bag);
    if (kit.prop === 'laptop') glowPlate(hips, 0.25, 0.16, 0.02, -0.34, 0.43, 0.16, hat, 0.12);
  } else if (kit.prop === 'hoe') {
    strut(hips, [0.37, 0.82, 0], [0.62, -0.72, 0.08], 0.025, bag);
    bx(hips, 0.32, 0.04, 0.06, 0.62, -0.72, 0.08, hat);
  } else if (kit.prop === 'camera' || kit.prop === 'meter') {
    bx(hips, 0.26, 0.2, 0.15, 0.34, 0.52, 0.04, bag);
    cyl(hips, 0.07, 0.08, 0.08, 8, 0.34, 0.52, 0.14, hat).rotation.x = Math.PI / 2;
  } else if (kit.prop === 'level') {
    bx(hips, 0.52, 0.07, 0.08, 0.32, 0.4, 0.02, bag);
  } else if (kit.prop === 'medicine') {
    for (const x of [0.29, 0.42]) cyl(hips, 0.045, 0.045, 0.2, 8, x, 0.42, 0, bag);
  } else if (kit.prop === 'tray') {
    bx(hips, 0.48, 0.045, 0.32, 0, 0.16, 0.28, bag);
  }
  return kit;
}

function civilianSurface(parent, name, size, position, color) {
  const mesh = new THREE.Mesh(sceneryGeometry(name, size), mat(color));
  mesh.name = 'civilian/' + name;
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function addCivilianHair(head, a) {
  const color = a.hairColor;
  if (a.hairStyle !== 'bald') civilianSurface(head, 'hairCap',
    [.405, a.hairStyle === 'cropped' ? .12 : .18, .39], [0, .15, -.018], color);
  if (['bob', 'long', 'wavy'].includes(a.hairStyle)) {
    const length = a.hairStyle === 'bob' ? 0.25 : 0.48;
    for (const x of [-0.19, 0.19]) {
      const lock = civilianSurface(head, 'hairLock', [.1, length, .23], [x, .05 - length / 2, -.065], color);
      lock.rotation.z = a.hairStyle === 'wavy' ? x * 0.8 : 0;
    }
    civilianSurface(head, 'hairLock', [.32, length, .1], [0, .05 - length / 2, -.19], color);
  } else if (a.hairStyle === 'ponytail') {
    const tail = cyl(head, 0.085, 0.045, 0.38, 7, 0, -0.04, -0.25, color);
    tail.rotation.x = 0.3;
  } else if (a.hairStyle === 'bun') civilianSurface(head, 'hairCurl', [.24, .24, .24], [0, .22, -.18], color);
  else if (a.hairStyle === 'braids') {
    for (const x of [-0.19, 0.19]) for (let i = 0; i < 5; i++)
      civilianSurface(head, 'hairCurl', [.13, .13, .13], [x, .04 - i * .075, -.09], color);
  } else if (a.hairStyle === 'curly' || a.hairStyle === 'afro') {
    const r = a.hairStyle === 'afro' ? 0.12 : 0.075;
    for (let i = 0; i < 8; i++) {
      const t = i * TAU / 8;
      civilianSurface(head, 'hairCurl', [r * 2, r * 2, r * 2],
        [Math.cos(t) * .18, .14, Math.sin(t) * .17 - .035], color);
    }
    civilianSurface(head, 'hairCurl', [r * 2, r * 2, r * 2], [0, .23, -.04], color);
  } else if (a.hairStyle === 'mohawk') bx(head, 0.08, 0.19, 0.33, 0, 0.24, -0.02, color);
  else if (a.hairStyle === 'sidepart') {
    const fringe = bx(head, 0.26, 0.09, 0.1, -0.035, 0.15, 0.15, color);
    fringe.rotation.z = -0.22;
  }
  if (a.facialHair !== 'none') bx(head, a.facialHair === 'moustache' ? 0.13 : 0.25,
    a.facialHair === 'beard' ? 0.16 : 0.04, 0.06, 0, a.facialHair === 'moustache' ? -0.065 : -0.14, 0.17, color);
  if (a.age >= 55) for (const x of [-0.085, 0.085])
    bx(head, 0.07, 0.012, 0.012, x, -0.025, 0.206, dim(a.skinColor, 0.72));
}

function addCivilianClothing(hips, head, a) {
  const trim = a.accentColor, cloth = a.clothColor;
  if (['jacket', 'vest', 'coat'].includes(a.clothing)) {
    for (const x of [-0.14, 0.14]) bx(hips, 0.19, a.clothing === 'coat' ? 0.87 : 0.54,
      0.09, x, a.clothing === 'coat' ? 0.42 : 0.58, 0.18, trim);
  } else if (a.clothing === 'hoodie') {
    sph(hips, 0.25, 0, 0.95, -0.12, cloth);
    bx(hips, 0.25, 0.12, 0.07, 0, 0.35, 0.23, trim);
    for (const x of [-0.07, 0.07]) bx(hips, 0.018, 0.22, 0.025, x, 0.73, 0.25, trim);
  } else if (a.clothing === 'overalls') {
    bx(hips, 0.28, 0.46, 0.075, 0, 0.4, 0.23, a.trouserColor);
    for (const x of [-0.13, 0.13]) bx(hips, 0.055, 0.43, 0.055, x, 0.69, 0.2, a.trouserColor);
  } else if (a.clothing === 'sweater') {
    for (const y of [0.4, 0.58, 0.76]) bx(hips, 0.45, 0.055, 0.05, 0, y, 0.2, trim);
  } else if (a.clothing === 'shirt') {
    for (const y of [0.4, 0.55, 0.7]) civilianSurface(hips, 'hairCurl', [.028, .028, .012], [0, y, .21], trim);
  }
  if (a.bottoms === 'jeans') for (const x of [-0.14, 0.14])
    bx(hips, 0.11, 0.12, 0.035, x, 0.12, -0.18, dim(a.trouserColor, 0.7));
  if (a.clothing !== 'professional') {
    if (a.headwear === 'beanie') sph(head, 0.23, 0, 0.15, -0.025, trim);
    else if (a.headwear === 'cap' || a.headwear === 'brimmed') {
      cyl(head, 0.17, 0.225, 0.12, 10, 0, 0.2, -0.02, trim);
      if (a.headwear === 'brimmed') cyl(head, 0.32, 0.32, 0.03, 12, 0, 0.15, 0, trim);
      else bx(head, 0.26, 0.035, 0.22, 0, 0.15, 0.19, trim);
    }
  }
  if (a.accessory === 'glasses' || a.accessory === 'sunglasses') {
    for (const x of [-0.08, 0.08]) {
      if (a.accessory === 'sunglasses') bx(head, 0.13, 0.08, 0.025, x, 0.02, 0.22, 0x262e36);
      else {
        const lens = torus(head, 0.055, 0.012, x, 0.02, 0.22, trim);
        lens.rotation.x = Math.PI / 2;
      }
    }
    bx(head, 0.07, 0.016, 0.025, 0, 0.025, 0.23, trim);
  } else if (a.accessory === 'scarf') {
    cyl(hips, 0.19, 0.24, 0.11, 8, 0, 0.92, 0, trim);
    bx(hips, 0.13, 0.34, 0.07, 0.12, 0.69, 0.26, trim);
  } else if (a.accessory === 'backpack') {
    bx(hips, 0.38, 0.49, 0.22, 0, 0.56, -0.29, trim);
    for (const x of [-0.2, 0.2]) bx(hips, 0.045, 0.5, 0.04, x, 0.62, 0.2, trim);
  } else if (a.accessory === 'crossbody') {
    strut(hips, [-0.25, 0.87, 0.25], [0.3, 0.17, 0.25], 0.025, trim);
    bx(hips, 0.23, 0.22, 0.12, 0.31, 0.12, 0.18, trim);
  } else if (a.accessory === 'earrings') for (const x of [-0.225, 0.225]) sph(head, 0.035, x, -0.07, 0, trim);
  else if (a.accessory === 'necklace') {
    strut(hips, [-0.12, 0.86, 0.22], [0, 0.65, 0.25], 0.01, trim);
    strut(hips, [0.12, 0.86, 0.22], [0, 0.65, 0.25], 0.01, trim);
  }
}

function buildCivilian(side, profile = 0, seed = 0) {
  const appearance = generateCivilian(seed, profile);
  const row = CIVILIANS[appearance.family];
  const { clothColor: cloth, skinColor: skin } = appearance;
  const g = markBatch(new THREE.Group(), 'civilian', appearance.occupation);
  const body = new THREE.Group();
  body.scale.set(appearance.widthScale, 1, appearance.widthScale);
  g.add(body);
  const hipY = 1.28;
  const makeLeg = (sgn) => {
    const leg = new THREE.Group();
    leg.position.set(sgn * 0.18, hipY, 0);
    civilianSurface(leg, 'upperLeg', [.25, .6, .245], [0, -.30, 0], appearance.trouserColor);
    civilianSurface(leg, 'lowerLeg', [.205, .52, .195], [0, -.85, 0],
      appearance.bottoms === 'shorts' ? skin : dim(appearance.trouserColor, .8));
    const boots = appearance.footwear === 'boots';
    const sandals = appearance.footwear === 'sandals';
    const foot = new THREE.Group();
    leg.add(foot);
    civilianSurface(foot, boots ? 'boot' : 'shoe', [.22, boots ? .28 : .12, .38],
      [0, boots ? -1.08 : -1.16, .06], sandals ? skin
        : appearance.footwear === 'sneakers' ? appearance.accentColor : 0x2a2622);
    if (sandals) for (const z of [-0.02, 0.16]) bx(foot, 0.23, 0.025, 0.05, 0, -1.09, z, appearance.accentColor);
    else if (appearance.footwear === 'sneakers') bx(foot, 0.23, 0.025, 0.39, 0, -1.205, 0.06, 0xd2d1c8);
    body.add(leg);
    return leg;
  };
  const legL = makeLeg(-1), legR = makeLeg(1);
  const hips = new THREE.Group();
  hips.position.y = hipY;
  body.add(hips);
  const shoulder = 0.5 * appearance.shoulderScale;
  civilianSurface(hips, 'torso', [shoulder * 1.12, .62, .34], [0, .55, 0], cloth);
  civilianSurface(hips, 'pelvis', [shoulder * .92, .25, .34], [0, .135, 0], appearance.trouserColor);
  if (appearance.bottoms === 'skirt') frustum(hips, { rt: 0.28, rb: 0.4, h: 0.48, seg: 8,
    y: 0.03, sx: 1.1, sz: 0.75, color: appearance.trouserColor });
  const makeArm = (sgn) => {
    const arm = new THREE.Group();
    arm.position.set(sgn * shoulder * 0.64, 0.84, 0);
    civilianSurface(arm, 'upperArm', [.195, .44, .18], [0, -.22, 0], cloth);
    civilianSurface(arm, 'forearm', [.15, .38, .14], [0, -.59, 0],
      ['jacket', 'hoodie', 'sweater', 'coat'].includes(appearance.clothing) ? cloth : skin);
    const hand = civilianSurface(arm, 'hand', [.11, .17, .08], [0, -.84, .018], skin);
    hand.scale.x = sgn;
    hips.add(arm);
    return arm;
  };
  const armL = makeArm(-1), armR = makeArm(1);
  const head = new THREE.Group();
  head.position.y = 1.13;
  head.scale.setScalar(appearance.headScale);
  hips.add(head);
  cyl(hips, .075, .10, .18, 8, 0, .93, 0, skin);
  civilianSurface(head, 'head', [.39, .43, .38], [0, 0, 0], skin);
  for (const x of [-.072, .072]) {
    civilianSurface(head, 'hairCurl', [.022, .016, .009], [x, .024, .187], 0x302a28);
    bx(head, .06, .013, .014, x, .063, .177, appearance.hairColor);
    civilianSurface(head, 'ear', [.045, .095, .055], [Math.sign(x) * .198, -.025, -.005], skin);
  }
  civilianSurface(head, 'nose', [.047, .085, .085], [0, -.033, .195], skin);
  bx(head, .065, .015, .012, 0, -.115, .173, dim(skin, .66));
  addCivilianHair(head, appearance);
  addCivilianClothing(hips, head, appearance);
  const baseKit = CIVILIAN_PROFESSION_KITS[row.name];
  const kit = appearance.clothing === 'professional' ? baseKit
    : { ...baseKit, coat: 'casual', head: 'none' };
  const professionKit = addProfessionKit(hips, row, cloth, kit);
  g.userData.appearance = appearance;
  g.userData.profession = appearance.occupation;
  g.userData.professionKit = professionKit;
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR, head, headY0: head.position.y,
    legChainL: limbChain(legL, -0.6, -1.1),
    legChainR: limbChain(legR, -0.6, -1.1),
    armChainL: limbChain(armL, -0.42),
    armChainR: limbChain(armR, -0.42),
    hipsY0: hipY, stride: 0.82, bob: 0.06, sway: 0.06, top: 7,
  };
  return g;
}

export function supportsNpcModel(kind) {
  return NPC_MODEL_KINDS.includes(kind);
}

/**
 * 建立非玩家視覺樹；呼叫端仍負責 fitToHeight、outlinify、投影旗標與隊伍環。
 * 玩家 drone／robot／morph 刻意不在名冊中，也沒有任何通用 fallback 會吃到它們。
 */
export function buildNpcModel(kind, side, { profile = 0, appearanceSeed = 0 } = {}) {
  if ((side === 'SWARM' || side === 'STEEL') && kind !== 'civ') {
    const authored = buildFactionAsset(kind.startsWith('creep:') ? kind.slice(6) : kind, side);
    if (authored) return finishUnitSurfaces(authored);
  }
  let model;
  switch (kind) {
    case 'creep:soldier': model = buildTrooper(side, 'soldier'); break;
    case 'creep:apc': model = buildApc(side); break;
    case 'creep:tank': model = buildTank(side); break;
    case 'creep:rocketeer': model = buildTrooper(side, 'rocketeer'); break;
    case 'creep:howitzer': model = buildTrooper(side, 'howitzer'); break;
    case 'creep:heli': model = buildHeli(side); break;
    case 'bunker': model = buildBunker(side); break;
    case 'civ': model = buildCivilian(side, profile, appearanceSeed); break;
    default: return null;
  }
  return finishUnitSurfaces(model, kind === 'civ' ? null : FACTION_MODEL_STYLE[side]);
}
