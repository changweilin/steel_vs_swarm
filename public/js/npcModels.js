// ============ 非玩家單位新版建模（純視覺）============
// Sakura：宣告式多面體組裝；Bikini Bottom：一族一生成器＋規格表；
// Abeto：剪影優先、窄色域與小面積發光識別。尺寸仍由 models.js 的
// fitToHeight() 收斂到 TARGET_H，本檔不得改動權威碰撞量體。
import * as THREE from 'three';
import { SIDES, CIVILIANS, isThirdSide } from './data.js';
import { bx, cyl, rbz, sph, cone, torus, dim } from './geo3d.js';

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

const VEHICLE = Object.freeze({
  apc: Object.freeze({ L: 5.8, W: 2.45, wheelR: 0.52, axles: [-1.85, 0, 1.85],
    sill: 0.72, waist: 1.76, roof: 2.42, cab: 1.0, barrel: 1.62 }),
  tank: Object.freeze({ L: 6.7, W: 3.3, wheelR: 0.48, axles: [-2.45, -1.48, -0.5, 0.5, 1.48, 2.45],
    sill: 0.45, waist: 1.75, roof: 2.7, cab: 0.0, barrel: 4.2 }),
});

function factionOf(side) {
  return FACTION[side] || (isThirdSide(side) ? FACTION.GUER : FACTION.STEEL);
}

function accentOf(side, fallback = 0xffb45c) {
  return new THREE.Color(SIDES[side]?.color ?? fallback);
}

function markBatch(node, family, role) {
  node.userData.npcFamily = family;
  node.userData.npcRole = role;
  return node;
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

function vehicleTurret(parent, role, accent, P, barrelLen) {
  const turret = markBatch(new THREE.Group(), 'vehicle_turret', role);
  turret.position.set(0, role === 'tank' ? 2.2 : 1.72, role === 'tank' ? 0.35 : 0.25);
  parent.add(turret);
  frustum(turret, { rt: role === 'tank' ? 0.78 : 0.52,
    rb: role === 'tank' ? 1.02 : 0.68, h: role === 'tank' ? 0.68 : 0.48,
    seg: 8, y: 0.28, sx: 1.15, sz: 0.9, color: P.shell, opts: { metalness: 0.55 } });
  const pitch = new THREE.Group();
  pitch.position.set(0, role === 'tank' ? 0.42 : 0.28, role === 'tank' ? 0.68 : 0.5);
  turret.add(pitch);
  turret.userData.pitch = pitch;
  const barrel = cyl(pitch, role === 'tank' ? 0.13 : 0.075,
    role === 'tank' ? 0.16 : 0.09, barrelLen, 10, 0, 0, barrelLen * 0.48,
    P.deep, { metalness: 0.85 });
  barrel.rotation.x = Math.PI / 2;
  for (const z of [barrelLen * 0.45, barrelLen * 0.7]) {
    torus(pitch, role === 'tank' ? 0.17 : 0.1,
      role === 'tank' ? 0.035 : 0.025, 0, 0, z, P.mid, { metalness: 0.72 });
  }
  const muzzle = torus(pitch, role === 'tank' ? 0.17 : 0.1,
    role === 'tank' ? 0.045 : 0.03, 0, 0, barrelLen + 0.02, accent,
    { emissive: accent, emissiveIntensity: 0.85 });
  glowPlate(turret, 0.2, 0.14, 0.08, 0.34, 0.56, 0.18, P.glass, 0.45);
  return { turret, muzzle };
}

function buildApc(side) {
  const S = VEHICLE.apc, P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'vehicle', 'apc');
  const hull = new THREE.Group();
  g.add(hull);
  bx(hull, S.W, S.waist - S.sill, S.L * 0.82, 0, (S.waist + S.sill) * 0.5, -0.15,
    P.shell, { metalness: 0.45 });
  const nose = frustum(hull, { rt: 0.9, rb: 1.12, h: 1.2, seg: 4,
    y: 1.28, z: S.L * 0.42, sx: 1.08, sz: 0.92, rx: Math.PI / 2,
    color: P.mid, opts: { metalness: 0.5 } });
  nose.rotation.z = Math.PI / 4;
  bx(hull, S.W * 0.84, S.roof - S.waist, S.L * 0.42, 0,
    (S.roof + S.waist) * 0.5, -0.72, P.mid, { metalness: 0.48 });
  for (const sgn of [-1, 1]) {
    glowPlate(hull, 0.22, 0.16, 0.09, sgn * S.W * 0.35, 1.0, S.L * 0.48,
      0xffefbd, 0.65);
    bx(hull, 0.08, 0.32, 1.3, sgn * (S.W * 0.5 + 0.02), 1.2, -0.25, P.trim);
  }
  glowPlate(hull, S.W * 0.6, 0.32, 0.08, 0, 1.96, S.L * 0.05, P.glass, 0.38);
  const wheels = [];
  for (const x of [-1, 1]) for (const z of S.axles) addWheel(hull, wheels, x * S.W * 0.56, z, S.wheelR, 0.42, P);
  const { turret, muzzle } = vehicleTurret(hull, 'apc', accent, P, S.barrel);
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
  const S = VEHICLE.tank, P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'vehicle', 'tank');
  const hull = new THREE.Group();
  g.add(hull);
  bx(hull, S.W * 0.72, 1.15, S.L * 0.86, 0, 1.28, -0.12, P.shell, { metalness: 0.55 });
  const glacis = bx(hull, S.W * 0.7, 0.72, 1.45, 0, 1.38, S.L * 0.43, P.mid, { metalness: 0.58 });
  glacis.rotation.x = 0.42;
  bx(hull, S.W * 0.66, 0.18, 1.8, 0, 1.95, -1.75, dim(P.shell, 0.94));
  const wheels = [];
  for (const sideX of [-1, 1]) {
    const x = sideX * S.W * 0.43;
    bx(hull, 0.62, 0.26, S.L * 0.86, x, 0.24, 0, P.deep);
    bx(hull, 0.62, 0.26, S.L * 0.82, x, 1.12, 0, P.dark);
    bx(hull, 0.56, 0.72, S.L * 0.78, x, 0.68, 0, P.mid);
    for (const z of S.axles) addWheel(hull, wheels, x, z, S.wheelR, 0.68, P);
    bx(hull, 0.07, 0.11, S.L * 0.72, sideX * (S.W * 0.5 + 0.02), 1.24, 0, P.trim);
  }
  for (const sideX of [-1, 1]) {
    glowPlate(hull, 0.22, 0.17, 0.08, sideX * S.W * 0.23, 1.33, S.L * 0.5,
      0xffefbd, 0.65);
  }
  const { turret, muzzle } = vehicleTurret(hull, 'tank', accent, P, S.barrel);
  bx(turret, 1.2, 0.36, 0.62, 0, 0.36, -0.82, P.dark); // 砲塔尾艙
  g.userData.turret = turret;
  g.userData.rig = {
    kind: 'tracked', hull, hullY0: 0, wheels, top: 9,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0 }, kickAmp: { light: 2.2 },
    lightGlow: [{ mesh: muzzle, base: 0.8 }],
    muzzles: { light: { n: muzzle, r: 0.22 }, heavy: null },
  };
  return g;
}

function buildHeli(side) {
  const P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'aircraft', 'heli');
  const tilt = new THREE.Group();
  tilt.position.y = 1.65;
  g.add(tilt);
  rbz(tilt, 1.42, 1.08, 2.65, 0, 0, 0.25, P.shell, { metalness: 0.5 });
  const nose = frustum(tilt, { rt: 0.16, rb: 0.58, h: 1.05, seg: 6,
    y: 0.02, z: 1.72, rx: Math.PI / 2, sx: 1.05, sz: 0.78,
    color: P.glass, opts: { emissive: P.glass, emissiveIntensity: 0.32 } });
  nose.userData.noOutline = false;
  const tailA = [0, 0.18, -0.9], tailB = [0, 0.35, -3.45];
  strut(tilt, tailA, tailB, 0.19, P.dark, { metalness: 0.5 });
  bx(tilt, 0.1, 0.85, 0.72, 0, 0.64, -3.28, P.mid);
  glowPlate(tilt, 0.13, 0.13, 0.07, 0, 0.64, -3.66, accent, 1.0);

  const mast = cyl(tilt, 0.12, 0.15, 0.45, 8, 0, 0.9, -0.1, P.deep, { metalness: 0.7 });
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.15, -0.1);
  tilt.add(rotor);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const blade = bx(rotor, 2.35, 0.045, 0.16, 1.18, 0, 0, 0xaab3ba, {
      transparent: true, opacity: 0.8,
    });
    blade.rotation.y = a;
    blade.position.set(Math.cos(a) * 1.18, 0, -Math.sin(a) * 1.18);
  }
  mast.userData.rotorMast = true;
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.24, 0.35, -3.42);
  tilt.add(tailRotor);
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3;
    const blade = bx(tailRotor, 0.06, 0.82, 0.08, 0, 0.38, 0, 0xaab3ba, {
      transparent: true, opacity: 0.8,
    });
    blade.rotation.z = a;
    blade.position.set(-Math.sin(a) * 0.36, Math.cos(a) * 0.36, 0);
  }

  for (const sideX of [-1, 1]) {
    strut(tilt, [sideX * 0.45, -0.34, 0.72], [sideX * 0.78, -0.78, 0.8],
      0.055, P.deep, { metalness: 0.65 });
    strut(tilt, [sideX * 0.45, -0.34, -0.62], [sideX * 0.78, -0.78, -0.82],
      0.055, P.deep, { metalness: 0.65 });
    bx(tilt, 0.08, 0.08, 2.05, sideX * 0.78, -0.79, -0.02, P.deep);
  }
  const gunTilt = new THREE.Group();
  gunTilt.position.set(0, -0.5, 0.7);
  tilt.add(gunTilt);
  bx(gunTilt, 2.2, 0.11, 0.48, 0, 0, 0, P.dark);
  const muzzles = [];
  for (const sideX of [-1, 1]) {
    const pod = cyl(gunTilt, 0.17, 0.2, 0.92, 8, sideX * 0.92, -0.04, 0.22,
      P.mid, { metalness: 0.62 });
    pod.rotation.x = Math.PI / 2;
    const muzzle = torus(gunTilt, 0.15, 0.035, sideX * 0.92, -0.04, 0.7, accent,
      { emissive: accent, emissiveIntensity: 0.82 });
    muzzles.push(muzzle);
  }
  g.userData.spin = [rotor, tailRotor];
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
  const P = factionOf(side), accent = accentOf(side);
  const g = markBatch(new THREE.Group(), 'structure', 'bunker');
  frustum(g, { rt: 3.35, rb: 3.85, h: 0.72, seg: 8, y: 0.36,
    ry: Math.PI / 8, color: P.dark });
  frustum(g, { rt: 2.55, rb: 3.28, h: 2.15, seg: 8, y: 1.78,
    ry: Math.PI / 8, color: P.shell });
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const slit = bx(g, 1.3, 0.2, 0.26, Math.sin(a) * 2.57, 2.15,
      Math.cos(a) * 2.57, P.deep);
    slit.rotation.y = a;
    glowPlate(g, 0.15, 0.15, 0.08, Math.sin(a + Math.PI / 4) * 2.74, 2.86,
      Math.cos(a + Math.PI / 4) * 2.74, accent, 0.85);
  }
  frustum(g, { rt: 2.78, rb: 2.62, h: 0.48, seg: 8, y: 3.08,
    ry: Math.PI / 8, color: P.dark });
  // 胸牆依八邊形頂點排布，不用散布亂數。
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const bag = rbz(g, 0.72, 0.28, 0.5, Math.sin(a) * 2.2, 3.43,
      Math.cos(a) * 2.2, P.trim);
    bag.rotation.y = a;
  }
  bx(g, 1.02, 1.42, 0.48, 0, 0.86, 2.92, P.deep);
  bx(g, 1.28, 0.22, 0.54, 0, 1.67, 2.92, P.dark);
  const mastTop = [-1.35, 4.72, -0.92];
  strut(g, [-1.35, 3.28, -0.92], mastTop, 0.045, P.deep, { metalness: 0.55 });
  glowPlate(g, 0.04, 0.42, 0.72, -1.35, 4.5, -1.3, accent, 0.7);
  return g;
}

const CIV_COLOURS = Object.freeze([
  0x667487, 0x8a6658, 0x6c7455, 0x836f8d, 0x5d7c79, 0x8b7b55,
]);
const SKIN = Object.freeze([0xf0c8a4, 0xe0ac82, 0xc99063, 0xad754b, 0x8e5d3b]);
const HAIR = Object.freeze([0x191512, 0x2a211b, 0x473326, 0x765337, 0x8c9299]);

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
  // 職業配件僅改剪影，不帶任何戰鬥欄位。
  if (idx % 3 === 0) {
    bx(hips, 0.32, 0.38, 0.14, 0.34, 0.42, -0.2, dim(cloth, 0.52));
    strut(hips, [-0.18, 0.83, 0.02], [0.34, 0.62, -0.12], 0.025, 0x3a3028);
  } else if (idx % 3 === 1) {
    frustum(hips, { rt: 0.2, rb: 0.24, h: 0.1, seg: 8,
      y: 1.39, color: dim(cloth, 0.72) });
  } else {
    bx(hips, 0.36, 0.28, 0.12, -0.31, 0.38, -0.12, dim(cloth, 0.55));
  }
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
