// ============ 非玩家單位新版建模（純視覺）============
// Sakura：宣告式多面體組裝；Bikini Bottom：一族一生成器＋規格表；
// Abeto：剪影優先、窄色域與小面積發光識別。尺寸仍由 models.js 的
// fitToHeight() 收斂到 TARGET_H，本檔不得改動權威碰撞量體。
import * as THREE from 'three';
import { CIVILIANS, isThirdSide, sideInfo } from './data.js';
import { bx, cyl, rbz, sph, cone, torus, dim } from './geo3d.js';

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
  ]),
  civilian: Object.freeze([
    'rig.kind=biped', 'rig.hips', 'rig.legL', 'rig.legR', 'rig.armL', 'rig.armR',
    'rig.hipsY0',
  ]),
  wheeled: Object.freeze([
    'rig.kind=wheeled', 'rig.hull', 'rig.hullY0', 'rig.wheels',
    'rig.lightGlow', 'rig.muzzles.light.n', 'userData.turret', 'turret.userData.pitch',
  ]),
  tracked: Object.freeze([
    'rig.kind=tracked', 'rig.hull', 'rig.hullY0', 'rig.wheels',
    'rig.lightGlow', 'rig.muzzles.light.n', 'userData.turret', 'turret.userData.pitch',
  ]),
  aerial: Object.freeze([
    'rig.kind=aerial', 'rig.tilt', 'rig.tiltY0', 'rig.lightGlow',
    'rig.muzzles.light.n', 'userData.spin', 'userData.gunTilt',
    'userData.turretMuzzles',
  ]),
  bunker: Object.freeze(['static geometry; no rig']),
});

const FACTION = Object.freeze({
  SWARM: Object.freeze({
    shell: 0x59634a, mid: 0x46513c, dark: 0x30382d, deep: 0x1d221e,
    trim: 0xc8b66b, glass: 0x8fc4bd, form: 'field',
  }),
  STEEL: Object.freeze({
    shell: 0x4d555e, mid: 0x39414a, dark: 0x282e35, deep: 0x171b20,
    trim: 0xa7b0ba, glass: 0x86b8d8, form: 'machine',
  }),
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

// 真實型號只作比例與輪廓參考，不複製標誌；每一列都由同族生成器消費。
export const FACTION_MACHINE_MODELS = Object.freeze({
  SWARM: Object.freeze({
    doctrine: '烏克蘭機動防衛',
    apc: Object.freeze({ reference: 'BTR-4E', profile: 'btr4', L: 7.65, W: 2.9,
      wheelR: 0.54, axles: [-2.45, -0.82, 0.82, 2.45], sill: 0.62, waist: 1.55,
      roof: 2.42, turretY: 2.16, turretZ: -0.45, turret: 'btr-low', barrel: 1.75 }),
    tank: Object.freeze({ reference: 'T-64BV', profile: 't64', L: 6.55, W: 3.42,
      wheelR: 0.43, axles: [-2.38, -1.43, -0.48, 0.48, 1.43, 2.38],
      hullY: 1.12, turretY: 1.72, turretZ: 0.18, turret: 't64-dome', barrel: 4.1 }),
    heli: Object.freeze({ reference: 'Mi-24PU2', profile: 'hind', bodyW: 1.45,
      bodyH: 1.25, bodyL: 3.15, tailL: 3.7, blades: 5, coaxial: false, tailRotor: true }),
    bunker: Object.freeze({ reference: '烏克蘭模組化無人機掩體', profile: 'drone-revetment' }),
  }),
  STEEL: Object.freeze({
    doctrine: '俄式重裝突擊',
    apc: Object.freeze({ reference: 'K-17 Bumerang', profile: 'bumerang', L: 8.8, W: 3.18,
      wheelR: 0.61, axles: [-2.8, -0.95, 0.95, 2.8], sill: 0.68, waist: 1.82,
      roof: 2.78, turretY: 2.48, turretZ: 0.2, turret: 'epoch-wedge', barrel: 2.05 }),
    tank: Object.freeze({ reference: 'T-14 Armata', profile: 'armata', L: 8.7, W: 3.5,
      wheelR: 0.46, axles: [-3.0, -2.0, -1.0, 0, 1.0, 2.0, 3.0],
      hullY: 1.24, turretY: 1.92, turretZ: 0.35, turret: 'armata-unmanned', barrel: 5.2 }),
    heli: Object.freeze({ reference: 'Ka-52', profile: 'alligator', bodyW: 1.75,
      bodyH: 1.2, bodyL: 2.7, tailL: 2.7, blades: 3, coaxial: true, tailRotor: false }),
    bunker: Object.freeze({ reference: '蘇式預鑄砲兵觀測堡', profile: 'concrete-drum' }),
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
      const fin = bx(hips, 0.1, 0.46, 0.3, sgn * 0.4, 0.72, -0.34, P.trim);
      fin.rotation.z = sgn * 0.32;
    }
    for (const y of [0.38, 0.62, 0.86]) frustum(hips, {
      rt: 0.07, rb: 0.13, h: 0.18, seg: 6, y, z: -0.48, rx: Math.PI / 2, color: P.dark,
    });
  } else if (side === 'STEEL') {
    for (const x of [-0.22, 0.22]) bx(hips, 0.08, 0.48, 0.07, x, 0.65, 0.35, P.trim);
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
  return { g, muzzle };
}

function buildTrooper(side, role) {
  const spec = TROOPER[role];
  const P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'trooper', role);
  const machine = P.form === 'machine';
  const hipY = machine ? 1.42 : 1.34;

  const makeLeg = (sgn) => {
    const leg = new THREE.Group();
    leg.position.set(sgn * (machine ? 0.25 : 0.2), hipY, 0);
    frustum(leg, { rt: 0.16, rb: 0.21, h: 0.58, seg: machine ? 5 : 6,
      y: -0.31, sx: 0.92, sz: 0.82, color: P.shell });
    sph(leg, 0.16, 0, -0.61, 0.03, P.dark, { metalness: machine ? 0.65 : 0.1 });
    frustum(leg, { rt: 0.13, rb: 0.17, h: 0.5, seg: machine ? 5 : 6,
      y: -0.91, z: machine ? -0.05 : 0, sx: 0.88, sz: 0.78, color: P.mid });
    const foot = bx(leg, 0.31, 0.16, 0.49, 0, -1.2, 0.11, P.deep);
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
  frustum(hips, { rt: 0.43 * spec.armour, rb: 0.34, h: 0.64, seg: machine ? 6 : 8,
    y: 0.58, sx: 1.18, sz: 0.7, color: P.shell });
  // 胸甲只覆前側，讓背包與腰節仍讀得出三層剪影。
  const chest = frustum(hips, { rt: 0.39 * spec.armour, rb: 0.32, h: 0.48, seg: 6,
    y: 0.61, z: 0.13, sx: 1.2, sz: 0.58, color: P.mid, opts: { metalness: machine ? 0.58 : 0.08 } });
  chest.rotation.y = Math.PI / 6;
  bx(hips, 0.46 * spec.pack, 0.5, 0.26, 0, 0.58, -0.36, P.dark);
  for (const sgn of [-1, 1]) {
    const shoulder = frustum(hips, { rt: 0.2, rb: 0.27 * spec.armour, h: 0.24,
      seg: 6, x: sgn * 0.46, y: 0.91, sx: 1.12, sz: 0.72, rz: sgn * -0.12,
      color: P.mid });
    shoulder.userData.armourPanel = true;
  }
  glowPlate(hips, 0.22, 0.08, 0.05, 0, 0.76, 0.35, accent, 0.95);
  addTrooperFactionParts(hips, side, role, P, accent);

  const makeArm = (sgn) => {
    const arm = new THREE.Group();
    arm.position.set(sgn * 0.49, 0.9, 0);
    frustum(arm, { rt: 0.12, rb: 0.16, h: 0.43, seg: 6, y: -0.23,
      sx: 0.92, sz: 0.78, color: P.shell });
    sph(arm, 0.13, 0, -0.47, 0.02, P.deep);
    frustum(arm, { rt: 0.1, rb: 0.13, h: 0.39, seg: 6, y: -0.68,
      sx: 0.9, sz: 0.78, color: P.mid });
    frustum(arm, { rt: 0.1, rb: 0.13, h: 0.18, seg: 6, y: -0.94,
      sx: 0.85, sz: 0.75, color: machine ? P.deep : 0x9f7759 });
    hips.add(arm);
    return arm;
  };
  const armL = makeArm(-1), armR = makeArm(1);

  sph(hips, machine ? 0.23 : 0.22, 0, 1.18, 0.01,
    machine ? P.dark : 0xb88968, { metalness: machine ? 0.45 : 0 });
  frustum(hips, { rt: machine ? 0.22 : 0.24, rb: machine ? 0.28 : 0.3,
    h: 0.22, seg: 8, y: 1.31, color: P.mid });
  const visor = glowPlate(hips, machine ? 0.34 : 0.38, 0.09, 0.06,
    0, 1.22, 0.22, machine ? accent : P.glass, machine ? 1.2 : 0.38);
  visor.userData.noOutline = true;
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
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: spec.stride, bob: 0.065, sway: 0.055, top: 8,
    gunArm: true, gunR,
    aimPose: mounted
      ? { rShoulderX: -0.7, lShoulderX: -0.85, lShoulderY: 0.55 }
      : { rShoulderX: -0.55, lShoulderX: -0.5, lShoulderY: 0.45 },
    weap: { light: mounted ? 'N' : 'R', heavy: mounted ? 'N' : 'R' },
    hvy: { chest: mounted ? 0.05 : 0.04, gun: mounted ? 0.1 : 0 },
    lightGlow: [{ mesh: weapon.muzzle, base: 0.8 }],
    muzzles: { light: { n: weapon.muzzle, r: role === 'soldier' ? 0.075 : 0.095 }, heavy: null },
  };
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
  if (S.turret === 't64-dome' || S.turret === 't55-dome') {
    const dome = sph(turret, role === 'tank' ? 1.05 : 0.65, 0, 0.22, 0, P.shell,
      { metalness: 0.56 });
    dome.scale.set(1.08, S.turret === 't55-dome' ? 0.52 : 0.44, 0.92);
    if (S.turret === 't64-dome') {
      for (const x of [-0.72, 0, 0.72]) bx(turret, 0.56, 0.18, 0.35, x, 0.5, 0.35, P.mid);
    } else {
      cyl(turret, 0.18, 0.2, 0.32, 8, 0.62, 0.62, -0.2, P.dark);
    }
  } else if (S.turret === 'armata-unmanned') {
    rbz(turret, 1.75, 0.72, 1.9, 0, 0.36, 0.05, P.shell, { metalness: 0.68 });
    for (const x of [-0.83, 0.83]) {
      const cheek = bx(turret, 0.5, 0.58, 1.35, x, 0.28, 0.18, P.mid);
      cheek.rotation.z = x < 0 ? -0.18 : 0.18;
    }
    bx(turret, 1.25, 0.42, 0.85, 0, 0.58, -1.05, P.dark);
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
  } else if (S.turret === 'epoch-wedge') {
    rbz(turret, 1.35, 0.65, 1.45, 0, 0.34, 0, P.shell, { metalness: 0.64 });
    for (const x of [-0.56, 0.56]) bx(turret, 0.28, 0.35, 0.75, x, 0.33, 0.32, P.mid);
    glowPlate(turret, 0.2, 0.12, 0.06, 0, 0.7, 0.38, accent, 0.7);
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
  for (const z of [S.barrel * 0.45, S.barrel * 0.72]) {
    torus(pitch, bore * 1.25, bore * 0.24, 0, 0, z, P.mid, { metalness: 0.72 });
  }
  const muzzle = torus(pitch, bore * 1.28, bore * 0.3, 0, 0, S.barrel + 0.02, accent,
    { emissive: accent, emissiveIntensity: 0.85 });
  turret.userData.modelReference = S.reference;
  return { turret, muzzle };
}

function buildApc(side) {
  const S = machineModel(side, 'apc'), P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'vehicle', `apc:${S.reference}`);
  const hull = new THREE.Group();
  g.add(hull);
  bx(hull, S.W * 0.84, 0.34, S.L * 0.92, 0, S.sill, -0.08, P.deep, { metalness: 0.58 });
  if (S.profile === 'btr4') {
    bx(hull, S.W * 0.92, S.waist - S.sill, S.L * 0.78, 0,
      (S.waist + S.sill) * 0.5, -0.35, P.shell, { metalness: 0.45 });
    const glacis = bx(hull, S.W * 0.86, 0.72, 1.8, 0, 1.45, S.L * 0.38, P.mid);
    glacis.rotation.x = 0.36;
    bx(hull, S.W * 0.72, S.roof - S.waist, S.L * 0.34, 0,
      (S.roof + S.waist) * 0.5, -1.1, P.mid);
    for (const x of [-0.48, 0.48]) glowPlate(hull, 0.46, 0.36, 0.06, x, 1.86, 2.05, P.glass, 0.3);
  } else if (S.profile === 'bumerang') {
    frustum(hull, { rt: S.W * 0.45, rb: S.W * 0.55, h: S.L * 0.72, seg: 6,
      y: 1.2, z: -0.15, rx: Math.PI / 2, sx: 1, sz: 0.72, color: P.shell });
    rbz(hull, S.W * 0.82, S.roof - 1.2, S.L * 0.48, 0, 1.88, -0.85, P.mid);
    const prow = bx(hull, S.W * 0.78, 0.95, 1.55, 0, 1.35, S.L * 0.38, P.shell);
    prow.rotation.x = 0.48;
    glowPlate(hull, S.W * 0.5, 0.28, 0.06, 0, 2.12, 1.8, P.glass, 0.35);
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
  bx(hull, S.W * 0.7, 0.9, S.L * 0.8, 0, S.hullY, -0.08, P.shell, { metalness: 0.56 });
  const glacis = bx(hull, S.W * 0.68, S.profile === 'armata' ? 0.78 : 0.62,
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
  if (S.profile === 't64') {
    for (const x of [-1.1, -0.37, 0.37, 1.1]) bx(hull, 0.62, 0.2, 0.44, x, 1.68, 2.1, P.trim);
  } else if (S.profile === 'armata') {
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
  rbz(tilt, S.bodyW, S.bodyH, S.bodyL, 0, 0, 0.28, P.shell, { metalness: 0.5 });
  if (S.profile === 'hind') {
    const canopy = frustum(tilt, { rt: 0.16, rb: 0.55, h: 1.35, seg: 6,
      y: 0.02, z: 2.0, rx: Math.PI / 2, sx: 1.0, sz: 0.72, color: P.glass,
      opts: { emissive: P.glass, emissiveIntensity: 0.3 } });
    canopy.userData.noOutline = false;
    for (const x of [-1, 1]) bx(tilt, 1.65, 0.12, 0.55, x * 1.0, -0.02, 0.1, P.mid).rotation.z = x * -0.12;
  } else if (S.profile === 'alligator') {
    rbz(tilt, 1.55, 0.72, 1.15, 0, 0.08, 1.65, P.glass,
      { emissive: P.glass, emissiveIntensity: 0.3 });
    for (const x of [-0.86, 0.86]) bx(tilt, 0.16, 0.82, 1.25, x, 0.08, 0.72, P.dark);
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
  if (S.profile === 'alligator') {
    for (const x of [-0.34, 0.34]) bx(tilt, 0.08, 0.82, 0.72, x, 0.68, tailEnd + 0.25, P.mid);
  } else {
    bx(tilt, 0.09, 0.78, 0.62, 0, 0.62, tailEnd + 0.18, P.mid);
  }
  glowPlate(tilt, 0.12, 0.12, 0.06, 0, 0.62, tailEnd - 0.18, accent, 0.92);
  cyl(tilt, 0.11, 0.14, S.coaxial ? 0.75 : 0.48, 8, 0, 0.92, -0.08,
    P.deep, { metalness: 0.72 });
  const spin = [];
  spin.push(addRotor(tilt, S.coaxial ? 1.34 : 1.16, S.blades, S.profile === 'huey' ? 4.9 : 4.35));
  if (S.coaxial) spin.push(addRotor(tilt, 1.62, S.blades, 4.15, Math.PI / S.blades));
  if (S.tailRotor) {
    const tailRotor = new THREE.Group();
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
  for (const sideX of [-1, 1]) {
    const pod = cyl(gunTilt, 0.17, 0.2, 0.92, 8, sideX * podSpan, -0.04, 0.22,
      P.mid, { metalness: 0.62 });
    pod.rotation.x = Math.PI / 2;
    const muzzle = torus(gunTilt, 0.15, 0.035, sideX * podSpan, -0.04, 0.7, accent,
      { emissive: accent, emissiveIntensity: 0.82 });
    muzzles.push(muzzle);
  }
  g.userData.modelReference = S.reference;
  g.userData.spin = spin;
  g.userData.gunTilt = gunTilt;
  g.userData.turretMuzzles = muzzles;
  g.userData.rig = {
    kind: 'aerial', tilt, tiltY0: 1.65, bob: 0.055, top: 16,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.03 },
    lightGlow: muzzles.map((mesh) => ({ mesh, base: 0.82 })),
    muzzles: { light: { n: muzzles[1], r: 0.15 }, heavy: null },
  };
  return g;
}

function buildBunker(side) {
  const S = machineModel(side, 'bunker'), P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'structure', `bunker:${S.reference}`);
  if (S.profile === 'drone-revetment') {
    frustum(g, { rt: 3.5, rb: 4.2, h: 0.8, seg: 6, y: 0.4, ry: Math.PI / 6, color: P.dark });
    for (const x of [-2.05, 0, 2.05]) {
      bx(g, 1.7, 1.65, 3.2, x, 1.35, -0.2, P.shell);
      bx(g, 1.3, 1.15, 0.08, x, 1.25, 1.43, P.deep);
      const roof = bx(g, 1.95, 0.22, 3.55, x, 2.28, -0.2, P.trim);
      roof.rotation.z = x * 0.035;
    }
    strut(g, [2.9, 0.8, -1.7], [2.9, 4.75, -1.7], 0.055, P.deep);
    torus(g, 0.48, 0.07, 2.9, 4.35, -1.7, accent,
      { emissive: accent, emissiveIntensity: 0.75 });
  } else if (S.profile === 'concrete-drum') {
    frustum(g, { rt: 3.2, rb: 4.0, h: 1.0, seg: 10, y: 0.5, color: P.dark });
    frustum(g, { rt: 2.65, rb: 3.25, h: 2.7, seg: 10, y: 2.35, color: P.shell });
    for (let k = 0; k < 5; k++) {
      const a = k * TAU / 5;
      const buttress = bx(g, 0.72, 2.1, 1.2, Math.sin(a) * 3.05, 1.55, Math.cos(a) * 3.05, P.dark);
      buttress.rotation.y = a;
    }
    frustum(g, { rt: 2.9, rb: 2.7, h: 0.6, seg: 10, y: 4.0, color: P.mid });
    glowPlate(g, 1.4, 0.18, 0.08, 0, 2.55, 2.68, accent, 0.65);
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
  g.userData.modelReference = S.reference;
  return g;
}

const CIV_COLOURS = Object.freeze([
  0x667487, 0x8a6658, 0x6c7455, 0x836f8d, 0x5d7c79, 0x8b7b55,
]);
const SKIN = Object.freeze([0xf0c8a4, 0xe0ac82, 0xc99063, 0xad754b, 0x8e5d3b]);
const HAIR = Object.freeze([0x191512, 0x2a211b, 0x473326, 0x765337, 0x8c9299]);

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

function addProfessionKit(hips, row, cloth) {
  const kit = CIVILIAN_PROFESSION_KITS[row.name] || CIVILIAN_PROFESSION_KITS['教師'];
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

function buildCivilian(side, profile = 0) {
  const idx = ((profile | 0) % Math.max(1, CIVILIANS.length) + Math.max(1, CIVILIANS.length))
    % Math.max(1, CIVILIANS.length);
  const row = CIVILIANS[idx] || {};
  const female = row.g === 'F';
  const cloth = CIV_COLOURS[idx % CIV_COLOURS.length];
  const skin = SKIN[(idx * 3 + 1) % SKIN.length];
  const hair = HAIR[(idx * 5 + 2) % HAIR.length];
  const g = markBatch(new THREE.Group(), 'civilian', String(row.name || idx));
  const hipY = 1.28;
  const makeLeg = (sgn) => {
    const leg = new THREE.Group();
    leg.position.set(sgn * (female ? 0.16 : 0.19), hipY, 0);
    frustum(leg, { rt: 0.12, rb: 0.15, h: 0.58, seg: 6, y: -0.31,
      sx: 0.86, sz: 0.74, color: dim(cloth, 0.62) });
    frustum(leg, { rt: 0.1, rb: 0.13, h: 0.5, seg: 6, y: -0.85,
      sx: 0.86, sz: 0.74, color: dim(cloth, 0.56) });
    bx(leg, 0.22, 0.12, 0.38, 0, -1.16, 0.06, 0x2a2622);
    g.add(leg);
    return leg;
  };
  const legL = makeLeg(-1), legR = makeLeg(1);
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  const shoulder = female ? 0.46 : 0.54;
  frustum(hips, { rt: shoulder * 0.44, rb: shoulder * 0.52, h: 0.62,
    seg: 8, y: 0.55, sx: 1.12, sz: 0.68, color: cloth });
  bx(hips, shoulder * 0.92, 0.22, 0.34, 0, 0.14, 0, dim(cloth, 0.7));
  if (female) frustum(hips, { rt: 0.28, rb: 0.4, h: 0.3, seg: 8,
    y: 0.26, sx: 1.1, sz: 0.75, color: cloth });
  const makeArm = (sgn) => {
    const arm = new THREE.Group();
    arm.position.set(sgn * shoulder * 0.82, 0.84, 0);
    frustum(arm, { rt: 0.09, rb: 0.12, h: 0.42, seg: 6, y: -0.22,
      sx: 0.88, sz: 0.75, color: cloth });
    frustum(arm, { rt: 0.075, rb: 0.095, h: 0.36, seg: 6, y: -0.58,
      sx: 0.88, sz: 0.75, color: skin });
    sph(arm, 0.085, 0, -0.81, 0.02, skin);
    hips.add(arm);
    return arm;
  };
  const armL = makeArm(-1), armR = makeArm(1);
  sph(hips, 0.22, 0, 1.13, 0, skin);
  // 髮型只由職業索引決定；不使用亂數，也不借用陣營識別色。
  if (female && idx % 2 === 0) {
    sph(hips, 0.23, 0, 1.23, -0.06, hair);
    sph(hips, 0.11, 0, 1.34, -0.2, hair);
  } else {
    frustum(hips, { rt: 0.18, rb: 0.23, h: 0.16, seg: 8,
      y: 1.28, z: -0.02, color: hair });
  }
  // 20 種職業逐列指定頭飾、制服與手持件；只改視覺樹，不帶戰鬥欄位。
  const professionKit = addProfessionKit(hips, row, cloth);
  g.userData.profession = row.name;
  g.userData.professionKit = professionKit;
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
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
export function buildNpcModel(kind, side, { profile = 0 } = {}) {
  switch (kind) {
    case 'creep:soldier': return buildTrooper(side, 'soldier');
    case 'creep:apc': return buildApc(side);
    case 'creep:tank': return buildTank(side);
    case 'creep:rocketeer': return buildTrooper(side, 'rocketeer');
    case 'creep:howitzer': return buildTrooper(side, 'howitzer');
    case 'creep:heli': return buildHeli(side);
    case 'bunker': return buildBunker(side);
    case 'civ': return buildCivilian(side, profile);
    default: return null;
  }
}
