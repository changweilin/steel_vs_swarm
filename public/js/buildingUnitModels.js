// Combat structures are presentation trees; data.js owns height, collision and hit volumes.
import * as THREE from 'three';
import { SIDES } from './data.js';
import { bx, cyl, torus } from './geo3d.js';
import { outlinify, disposeTree } from './toon.js';
import { recoilMount, mechanism } from './unitRig.js';
import { finishUnitSurfaces } from './unitSurfaces.js';
import { tboxF, finF } from './forge/geo.js';
import { FACTION_MODEL_STYLE } from './factionModelStyle.js';
import { buildFactionAsset } from './forge/factionAsset.js';

const TAU = Math.PI * 2;
const HIVE = FACTION_MODEL_STYLE.SWARM, STEEL = FACTION_MODEL_STYLE.STEEL;

export const BUILDING_UNIT_MODELS = Object.freeze({
  tower: Object.freeze({
    top: 20, turretSeatF: 0.92,
    sides: Object.freeze({
      SWARM: Object.freeze({ ...HIVE, facets: 6, yaw: Math.PI / 6,
        body: HIVE.shell, reference: 'Hive defense spire' }),
      STEEL: Object.freeze({ ...STEEL, facets: 4, yaw: Math.PI / 4,
        body: STEEL.shell, reference: 'Bastion rail battery' }),
    }),
  }),
  'base:SWARM': Object.freeze({ ...HIVE, top: 32, facets: 6, yaw: Math.PI / 6,
    body: HIVE.shell, reference: 'Distributed hive nexus' }),
  'base:STEEL': Object.freeze({ ...STEEL, top: 34, facets: 4, yaw: Math.PI / 4,
    body: STEEL.shell, reference: 'Foundry command citadel' }),
});

function accentOf(side) {
  return new THREE.Color(SIDES[side]?.color ?? 0xffffff);
}

function addFacet(parent, spec, rt, rb, h, y, color, opts) {
  const m = cyl(parent, rt, rb, h, spec.facets, 0, y, 0, color, opts);
  m.rotation.y = spec.yaw;
  return m;
}

function addRadial(parent, n, radius, fn, phase = 0) {
  for (let i = 0; i < n; i++) {
    const a = phase + i * TAU / n;
    fn({ i, a, x: Math.sin(a) * radius, z: Math.cos(a) * radius });
  }
}

function addStrut(parent, a, b, r, color) {
  const p0 = new THREE.Vector3(...a), p1 = new THREE.Vector3(...b);
  const d = p1.clone().sub(p0);
  const m = cyl(parent, r, r, Math.max(0.001, d.length()), 6,
    (p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5, (p0.z + p1.z) * 0.5, color);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

function buildTower(side) {
  const frame = BUILDING_UNIT_MODELS.tower;
  const spec = frame.sides[side] || frame.sides.STEEL;
  const accent = accentOf(side), seatY = frame.top * frame.turretSeatF;
  const g = new THREE.Group(), mechanisms = [];

  if (side === 'SWARM') {
    addFacet(g, spec, 5.5, 6.6, 1.2, 0.6, spec.dark);
    addFacet(g, spec, 3.2, 4.5, 3.0, 2.7, spec.body);
    cyl(g, 1.25, 1.5, seatY - 4, 6, 0, (seatY + 4) / 2, 0, spec.deep);
    // Thin petal ribs reveal the core between plates at combat viewing distances.
    addRadial(g, 3, 3.2, ({ a, x, z }) => {
      const petal = new THREE.Group();
      petal.position.set(x, 0, z); petal.rotation.y = a; g.add(petal);
      tboxF(petal, { w0: 2.7, d0: 0.85, w1: 1.3, d1: 0.42, h: 10.4 },
        0, 8.1, 0, spec.body);
      tboxF(petal, { w0: 1.3, d0: 0.42, w1: 2.6, d1: 0.65, h: 4.4 },
        0, 15.4, -0.45, spec.mid);
      bx(petal, 0.12, 7.4, 0.1, 0, 8.0, 0.47, accent,
        { emissive: accent, emissiveIntensity: 0.55 });
    }, Math.PI / 3);
    for (const y of [5.0, 11.5, 17.5]) addFacet(g, spec, 3.7, 4.2, 0.45, y, spec.trim);
    addFacet(g, spec, 3.5, 3.1, 0.8, seatY - 0.4, spec.dark);
    const scanner = new THREE.Group(); scanner.position.y = 13.5; g.add(scanner);
    torus(scanner, 2.15, 0.12, 0, 0, 0, spec.trim).rotation.x = Math.PI / 2;
    for (const x of [-2.15, 2.15]) {
      addStrut(scanner, [0, 0, 0], [x, 0, 0], 0.055, spec.dark);
      cyl(scanner, 0.15, 0.15, 0.24, 6, x, 0, 0, accent,
        { emissive: accent, emissiveIntensity: 0.85 });
    }
    mechanisms.push(mechanism(scanner, 'y', 0.7, 0.4));
  } else {
    bx(g, 12.6, 1.8, 10.8, 0, 0.9, 0, spec.dark);
    tboxF(g, { w0: 10.8, d0: 8.8, w1: 6.4, d1: 5.7, h: 13.0 },
      0, 8.3, 0, spec.body);
    for (const x of [-4.2, 4.2]) {
      tboxF(g, { w0: 2.2, d0: 5.8, w1: 1.2, d1: 3.8, h: 12.8 },
        x, 8.2, -0.35, spec.dark);
      bx(g, 0.15, 8.8, 0.16, x, 8.0, 2.65, accent,
        { emissive: accent, emissiveIntensity: 0.55 });
    }
    for (const y of [4.5, 7.5, 10.5, 13.5]) {
      const w = 10.8 - (y - 1.8) / 13 * 4.4;
      bx(g, w + 0.45, 0.42, 6.9 - (y - 4.5) * 0.11, 0, y, 0, spec.mid);
    }
    bx(g, 5.8, 3.2, 5.2, 0, 16.25, 0, spec.dark);
    bx(g, 6.9, 0.65, 6.2, 0, seatY - 0.325, 0, spec.mid);
    for (const y of [15.4, 15.9, 16.4, 16.9]) bx(g, 3.6, 0.14, 0.18, 0, y, 2.68, spec.trim);
  }

  // Fit body and articulated head together so the muzzle remains above the deck.
  const turret = buildBuildingUnitTurret(side, { outline: false });
  turret.position.y = seatY; g.add(turret);
  g.userData.turretSeatF = frame.turretSeatF;
  g.userData.turret = turret;
  g.userData.turretMuzzles = turret.userData.muzzles;
  g.userData.rig = { kind: 'static', attacks: turret.userData.attacks, mechanisms };
  g.userData.modelReference = spec.reference;
  return g;
}

function buildBase(spec, side) {
  const g = new THREE.Group(), accent = accentOf(side);
  const rig = { kind: 'static', attacks: [], mechanisms: [], blink: [] };
  g.userData.rig = rig;

  if (spec.language === HIVE.language) {
    addFacet(g, spec, 18.0, 20.0, 2.0, 1.0, spec.dark);
    addRadial(g, 6, 12.3, ({ i, a, x, z }) => {
      const cell = new THREE.Group(); cell.position.set(x, 0, z); cell.rotation.y = a; g.add(cell);
      addFacet(cell, spec, 4.0, 4.8, 5.4, 4.7, spec.body);
      addFacet(cell, spec, 3.3, 4.2, 2.0, 8.4, i % 2 ? spec.mid : spec.body);
      const mouth = cyl(cell, 1.55, 1.55, 0.12, 6, 0, 5.0, 4.0, spec.deep);
      mouth.rotation.x = Math.PI / 2;
      const crown = finF(cell, { len: 4.2, w0: 2.5, w1: 0.55, t: 0.25, sweep: 0.6 },
        0, 9.1, -0.4, spec.trim);
      crown.rotation.x = -0.3;
      bx(cell, 1.25, 0.14, 0.14, 0, 6.4, 3.8, accent,
        { emissive: accent, emissiveIntensity: 0.6 });
      addStrut(g, [x * 0.58, 2.0, z * 0.58], [x, 6.8, z], 0.17, spec.mid);
    }, Math.PI / 6);
    addFacet(g, spec, 6.0, 9.0, 10.0, 7.0, spec.body);
    addFacet(g, spec, 3.8, 6.3, 9.0, 16.5, spec.mid);
    cyl(g, 1.65, 2.0, 10.8, 6, 0, 26.0, 0, spec.deep);
    addRadial(g, 3, 3.4, ({ a, x, z }) => {
      const blade = new THREE.Group(); blade.position.set(x, 23.0, z); blade.rotation.y = a; g.add(blade);
      tboxF(blade, { w0: 2.5, d0: 0.8, w1: 0.6, d1: 0.35, h: 15.0 }, 0, 0, 0, spec.body);
      bx(blade, 0.16, 7.5, 0.14, 0, 0, 0.45, accent,
        { emissive: accent, emissiveIntensity: 0.55 });
    });
    const ring = new THREE.Group(); ring.position.y = 25; g.add(ring);
    torus(ring, 5.4, 0.22, 0, 0, 0, spec.trim).rotation.x = Math.PI / 2;
    for (const x of [-5.4, 5.4]) {
      addStrut(ring, [0, 0, 0], [x, 0, 0], 0.12, spec.dark);
      cyl(ring, 0.24, 0.24, 0.32, 6, x, 0, 0, accent,
        { emissive: accent, emissiveIntensity: 0.8 });
    }
    rig.mechanisms.push(mechanism(ring, 'y', 0.7, 0.28));
    const beacon = cyl(g, 0.55, 1.35, 1.2, 6, 0, spec.top - 0.6, 0, accent,
      { emissive: accent, emissiveIntensity: 0.9 });
    rig.blink.push({ mesh: beacon, f: 1.8, lo: 0.65 });
  } else {
    bx(g, 39, 3.2, 34, 0, 1.6, 0, spec.dark);
    tboxF(g, { w0: 34, d0: 29, w1: 27, d1: 23, h: 13.0 }, 0, 9.7, -0.8, spec.body);
    bx(g, 30, 1.2, 26, 0, 16.8, -0.8, spec.mid);
    for (const x of [-12.5, 12.5]) {
      tboxF(g, { w0: 7.4, d0: 12.0, w1: 5.0, d1: 8.0, h: 19.0 },
        x, 16.0, -5.0, spec.dark);
      bx(g, 6.4, 1.1, 9.4, x, 25.5, -5.0, spec.mid);
      for (const y of [12, 16, 20, 24]) bx(g, 6.6, 0.5, 0.5, x, y, -0.15, spec.trim);
      bx(g, 0.28, 12, 0.16, x, 18, 1.0, accent,
        { emissive: accent, emissiveIntensity: 0.55 });
    }
    tboxF(g, { w0: 13, d0: 12, w1: 9, d1: 8, h: 13 }, 0, 24.0, -4.0, spec.body);
    bx(g, 11.0, 1.4, 10.0, 0, 31.2, -4.0, spec.mid);
    for (const x of [-9, 0, 9]) {
      bx(g, 6.2, 5.2, 0.32, x, 8.0, 12.85, spec.deep);
      for (const sx of [-2.65, 2.65]) bx(g, 0.4, 5.4, 0.6, x + sx, 8, 13.05, spec.mid);
      bx(g, 4.5, 0.16, 0.14, x, 9.6, 13.06, accent,
        { emissive: accent, emissiveIntensity: 0.5 });
    }
    const shutters = new THREE.Group(); shutters.position.set(0, 23.0, 0.15); g.add(shutters);
    for (const y of [-2, -1, 0, 1, 2]) bx(shutters, 6.2, 0.35, 0.4, 0, y, 0, spec.dark);
    rig.mechanisms.push(mechanism(shutters, 'x', 0.06, 0.5));
    const beacon = bx(g, 1.6, 2.0, 1.6, 0, spec.top - 1.0, -4, accent,
      { emissive: accent, emissiveIntensity: 0.95 });
    rig.blink.push({ mesh: beacon, f: 1.5, lo: 0.65 });
  }
  g.userData.modelReference = spec.reference;
  return g;
}

export function buildBuildingUnit(kind, side) {
  if (side === 'SWARM' || side === 'STEEL') {
    const role = kind === `base:${side}` ? 'base' : kind;
    const authored = ['base', 'tower'].includes(role) ? buildFactionAsset(role, side) : null;
    if (authored) return finishUnitSurfaces(authored);
  }
  if (kind === 'tower') return finishUnitSurfaces(buildTower(side), FACTION_MODEL_STYLE[side]);
  const spec = BUILDING_UNIT_MODELS[kind];
  return spec ? finishUnitSurfaces(buildBase(spec, side), spec) : null;
}

// The battery retains its separate scene tree for aiming, damage and teardown.
export function buildBaseBattery(side, bodyHeight = 0) {
  if (side === 'SWARM' || side === 'STEEL') {
    const authored = buildFactionAsset('battery', side);
    authored.position.y = bodyHeight * 0.58;
    finishUnitSurfaces(authored); outlinify(authored);
    return authored;
  }
  const g = new THREE.Group(); g.position.y = bodyHeight * 0.58;
  const spec = BUILDING_UNIT_MODELS[`base:${side}`] || BUILDING_UNIT_MODELS['base:STEEL'];
  const swarm = side === 'SWARM', accent = accentOf(side);
  const pivots = [], muzzles = [], attacks = [];
  for (const x of [10, -10]) {
    const yaw = new THREE.Group(); yaw.position.set(x, 0, 6); g.add(yaw);
    if (swarm) {
      addFacet(yaw, spec, 2.0, 3.0, 2.2, 0, spec.body);
      for (const sgn of [-1, 1]) {
        const fin = finF(yaw, { len: 3.6, w0: 2.3, w1: 0.7, t: 0.28, sweep: 0.5 },
          sgn * 1.5, 0.35, -0.5, spec.mid);
        fin.rotation.z = sgn * -0.6;
      }
    } else {
      tboxF(yaw, { w0: 5.4, d0: 5.8, w1: 4.2, d1: 4.6, h: 3.5 }, 0, 0, 0, spec.body);
      for (const x of [-2.2, 2.2]) bx(yaw, 0.55, 2.5, 5.2, x, 0, 0, spec.mid);
    }
    const pitch = new THREE.Group(); pitch.rotation.x = -0.14; yaw.add(pitch);
    const barrel = cyl(pitch, 1.1, 1.4, 16, swarm ? 6 : 8, 0, 0, 8, spec.dark);
    barrel.rotation.x = Math.PI / 2;
    const muzzle = new THREE.Group(); muzzle.position.z = 15.6; pitch.add(muzzle);
    const parts = [barrel, muzzle];
    if (swarm) {
      for (const z of [3.2, 6.4, 9.6]) {
        const collar = cyl(pitch, 1.35, 1.65, 1.5, 6, 0, 0, z, spec.body);
        collar.rotation.x = Math.PI / 2; parts.push(collar);
      }
    } else {
      for (const x of [-1.25, 1.25]) {
        parts.push(bx(pitch, 0.45, 1.8, 12.4, x, 0, 7.4, spec.mid));
        parts.push(bx(pitch, 0.12, 0.14, 10.2, x, 0.93, 7.4, accent,
          { emissive: accent, emissiveIntensity: 0.6 }));
      }
    }
    attacks.push(recoilMount(pitch, parts, [muzzle], 1.8, 0.045));
    yaw.userData.pitch = pitch; pivots.push(yaw); muzzles.push(muzzle);
  }
  g.userData.pivots = pivots; g.userData.muzzles = muzzles; g.userData.attacks = attacks;
  finishUnitSurfaces(g, spec); outlinify(g);
  return g;
}

/** Yaw root, pitch pivot and ordered +z muzzle anchors are the existing weapon API. */
export function buildBuildingUnitTurret(side, { outline = true } = {}) {
  if (side === 'SWARM' || side === 'STEEL') {
    const authored = buildFactionAsset('turret', side), turret = authored.userData.turret;
    turret.removeFromParent();
    disposeTree(authored);
    if (outline) outlinify(turret, 0.1);
    return turret;
  }
  const swarm = side === 'SWARM';
  const spec = BUILDING_UNIT_MODELS.tower.sides[swarm ? 'SWARM' : 'STEEL'];
  const accent = accentOf(side), yaw = new THREE.Group(), pitch = new THREE.Group();
  const muzzles = [], attacks = [];
  addFacet(yaw, spec, swarm ? 1.5 : 1.7, swarm ? 2.1 : 2.3, 0.9, 0.45, spec.dark);
  pitch.position.set(0, 1.0, 0.35); yaw.add(pitch);
  if (swarm) {
    for (const sx of [-1.0, 0, 1.0]) for (const sy of [-0.38, 0.38]) {
      const cell = cyl(pitch, 0.5, 0.56, 2.5, 6, sx, sy, 0.7, spec.body);
      cell.rotation.x = Math.PI / 2;
      const throat = cyl(pitch, 0.29, 0.29, 0.16, 6, sx, sy, 2.02, spec.deep);
      throat.rotation.x = Math.PI / 2;
      const muzzle = torus(pitch, 0.33, 0.045, sx, sy, 2.18, accent,
        { emissive: accent, emissiveIntensity: 0.95 });
      muzzles.push(muzzle);
    }
    bx(pitch, 2.7, 0.35, 1.2, 0, 0, -0.45, spec.dark);
    cyl(pitch, 0.25, 0.36, 0.55, 6, 0, 1.0, 0.5, spec.trim);
    attacks.push(recoilMount(pitch, [...pitch.children], muzzles, 0.4, 0.07));
  } else {
    tboxF(pitch, { w0: 4.2, d0: 3.6, w1: 3.2, d1: 2.9, h: 1.65 }, 0, 0, 0.55, spec.body);
    for (const sx of [-0.62, 0.62]) {
      const parts = [];
      parts.push(bx(pitch, 0.8, 0.75, 4.65, sx, 0, 3.95, spec.dark));
      for (const sgn of [-1, 1]) {
        parts.push(bx(pitch, 0.16, 0.85, 4.3, sx + sgn * 0.33, 0, 3.8, spec.mid));
        parts.push(bx(pitch, 0.08, 0.1, 3.5, sx + sgn * 0.33, 0.48, 3.9, accent,
          { emissive: accent, emissiveIntensity: 0.65 }));
      }
      const muzzle = cyl(pitch, 0.31, 0.31, 0.35, 8, sx, 0, 6.42, accent,
        { emissive: accent, emissiveIntensity: 0.72 });
      muzzle.rotation.x = Math.PI / 2; parts.push(muzzle); muzzles.push(muzzle);
      attacks.push(recoilMount(pitch, parts, [muzzle], 0.85));
    }
    bx(pitch, 1.1, 0.2, 0.1, 0, 1.1, 1.2, accent,
      { emissive: accent, emissiveIntensity: 0.72 });
  }
  yaw.userData.pitch = pitch; yaw.userData.attacks = attacks; yaw.userData.muzzles = muzzles;
  yaw.userData.muzzleAxis = '+z'; yaw.userData.modelReference = spec.reference;
  finishUnitSurfaces(yaw, spec);
  if (outline) outlinify(yaw, 0.1);
  return yaw;
}
