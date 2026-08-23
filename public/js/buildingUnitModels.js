// ============ 戰鬥建築單位模型（防禦塔 / 雙陣營主堡）============
// 本檔只產生純視覺樹；高度、碰撞與命中量體仍由 data.js TARGET_H / TARGET_R 定案。
// 所有建物以同一張規格表驅動，避免塔身、砲塔與主堡各自長出不可稽核的尺寸副本。
import * as THREE from 'three';
import { SIDES } from './data.js';
import { mat, bx, cyl, sph, torus, dim } from './geo3d.js';
import { outlinify } from './toon.js';

const TAU = Math.PI * 2;

export const BUILDING_UNIT_MODELS = Object.freeze({
  tower: Object.freeze({
    top: 20,
    turretSeatF: 0.92,
    sides: Object.freeze({
      SWARM: Object.freeze({
        facets: 6,
        yaw: Math.PI / 6,
        body: 0x514b3d,
        mid: 0x68604b,
        dark: 0x302f2b,
        language: 'hive-relay',
      }),
      STEEL: Object.freeze({
        facets: 8,
        yaw: Math.PI / 8,
        body: 0x667380,
        mid: 0x7d8995,
        dark: 0x343c45,
        language: 'rail-bastion',
      }),
    }),
  }),
  'base:SWARM': Object.freeze({
    top: 32,
    facets: 8,
    yaw: Math.PI / 8,
    body: 0x554c39,
    mid: 0x706449,
    dark: 0x2d2b27,
    language: 'brood-sanctum',
  }),
  'base:STEEL': Object.freeze({
    top: 34,
    facets: 10,
    yaw: Math.PI / 10,
    body: 0x596774,
    mid: 0x74828e,
    dark: 0x303842,
    language: 'split-citadel',
  }),
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

/**
 * 防禦塔固定結構。塔頂座圈上緣嚴格位於全高 92%，供 models.js 掛載 yaw 砲塔。
 * 兩陣營共用同一組收分比例，只由表列 facet / palette / silhouette language 分流。
 */
function buildTower(side) {
  const frame = BUILDING_UNIT_MODELS.tower;
  const spec = frame.sides[side] || frame.sides.STEEL;
  const accent = accentOf(side);
  const top = frame.top;
  const seatY = top * frame.turretSeatF;
  const g = new THREE.Group();

  // 共同結構：地坪 → 三段收分塔身 → 砲塔座圈。最低點恆為 y=0。
  addFacet(g, spec, 5.5, 6.5, 2.0, 1.0, spec.dark);
  addFacet(g, spec, 4.6, 5.5, 1.4, 2.7, dim(spec.body, 0.88));
  const segments = [
    { y0: 3.4, y1: 8.1, rb: 4.2, rt: 3.35, c: spec.body },
    { y0: 8.1, y1: 13.4, rb: 3.35, rt: 2.75, c: spec.mid },
    { y0: 13.4, y1: seatY - 0.8, rb: 2.75, rt: 2.35, c: spec.body },
  ];
  segments.forEach((s, i) => {
    const part = addFacet(g, spec, s.rt, s.rb, s.y1 - s.y0, (s.y0 + s.y1) * 0.5, s.c);
    part.rotation.y += i % 2 ? Math.PI / spec.facets : 0;
  });
  addFacet(g, spec, 3.25, 2.45, 1.6, seatY - 0.8, spec.dark, { metalness: 0.65 });
  addFacet(g, spec, 3.65, 3.65, 0.6, seatY - 0.3, spec.mid, { metalness: 0.65 });

  if (spec.language === 'hive-relay') {
    // 蜂群：外露蜂室與三支訊號角形成不對稱剪影；亮色只留在小面積節點。
    addRadial(g, 6, 3.0, ({ i, a, x, z }) => {
      for (let row = 0; row < 3; row++) {
        const cell = cyl(g, 0.43, 0.43, 0.34, 6, x, 6.2 + row * 3.1, z,
          (i + row) % 3 === 0 ? accent : spec.dark,
          (i + row) % 3 === 0 ? { emissive: accent, emissiveIntensity: 0.85 } : undefined);
        cell.rotation.set(Math.PI / 2, 0, -a);
      }
    }, Math.PI / 6);
    [-1, 0, 1].forEach((k) => {
      cyl(g, 0.07, 0.22, top - seatY, 5, 1.8 + k * 0.65,
        (top + seatY) * 0.5, -1.4 - Math.abs(k) * 0.35, spec.dark);
    });
    for (const s of [-1, 1]) {
      const perch = bx(g, 2.9, 0.24, 0.75, s * 3.15, 13.2 + s * 0.55, -0.45, spec.dark);
      perch.rotation.z = s * 0.11;
      sph(g, 0.25, s * 4.35, 13.45 + s * 0.55, -0.45, accent,
        { emissive: accent, emissiveIntensity: 1.05 });
    }
  } else {
    // 鋼鐵：成對裝甲脊與單側雷達桁架，遠距離仍讀得出正面與陣營。
    for (const s of [-1, 1]) {
      bx(g, 0.55, 8.4, 2.9, s * 2.75, 9.4, -0.15, spec.dark, { metalness: 0.7 });
      bx(g, 0.16, 5.9, 0.36, s * 3.05, 9.6, 0.55, accent,
        { emissive: accent, emissiveIntensity: 0.55 });
    }
    bx(g, 1.1, 3.6, 1.7, 3.25, 13.4, -0.9, spec.dark, { metalness: 0.7 });
    cyl(g, 0.09, 0.18, top - seatY, 6, -2.35, (top + seatY) * 0.5, -1.2, spec.dark);
    torus(g, 0.72, 0.09, -2.35, top - 0.81, -1.2, accent,
      { emissive: accent, emissiveIntensity: 0.85 });
  }

  g.userData.turretSeatF = frame.turretSeatF;
  g.userData.modelLanguage = spec.language;
  return g;
}

function buildBase(spec, side) {
  const g = new THREE.Group();
  const accent = accentOf(side);
  const top = spec.top;

  // 共同主堡家族：寬基壇、可讀的中央核心、周向支撐與極小陣營亮點。
  addFacet(g, spec, 16.5, 19.5, 3.0, 1.5, spec.dark);
  addFacet(g, spec, 14.5, 16.5, 2.2, 4.1, dim(spec.body, 0.86));

  if (spec.language === 'brood-sanctum') {
    addFacet(g, spec, 10.5, 14.0, 8.8, 9.6, spec.body);
    addFacet(g, spec, 7.8, 10.5, 6.2, 17.1, spec.mid);
    addFacet(g, spec, 4.2, 7.8, 5.3, 22.85, spec.body);
    // 六支孵化瓣從基壇向外放射；各瓣的接點與軸向皆由同一半徑推導。
    addRadial(g, 6, 11.8, ({ i, a, x, z }) => {
      const p = new THREE.Group();
      p.position.set(x, 5.5, z);
      p.rotation.y = a;
      g.add(p);
      bx(p, 3.5, 2.4, 7.2, 0, 0, 0, i % 2 ? spec.body : spec.dark);
      addFacet(p, { ...spec, facets: 6, yaw: Math.PI / 6 }, 1.05, 1.45, 4.5, 3.1, spec.mid);
      sph(p, 0.38, 0, 5.6, 0, accent, { emissive: accent, emissiveIntensity: 0.95 });
    }, Math.PI / 6);
    addRadial(g, 8, 7.7, ({ i, x, z }) => {
      const node = cyl(g, 0.52, 0.52, 0.32, 6, x, 17.2 + (i % 2) * 1.5, z,
        i % 3 === 0 ? accent : spec.dark,
        i % 3 === 0 ? { emissive: accent, emissiveIntensity: 0.8 } : undefined);
      node.rotation.x = Math.PI / 2;
    });
    // 信標球頂面 = top，讓 fitToHeight 的尺度只由規格表決定。
    sph(g, 2.25, 0, top - 2.25, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });
  } else {
    addFacet(g, spec, 11.5, 14.0, 10.5, 10.35, spec.body);
    addFacet(g, spec, 8.4, 11.5, 6.0, 18.6, spec.mid);
    // 分裂式雙塔與跨橋是鋼鐵主堡的遠距剪影；中心留出真實負空間。
    for (const s of [-1, 1]) {
      const pylon = new THREE.Group();
      pylon.position.set(s * 6.0, 0, 0);
      g.add(pylon);
      cyl(pylon, 2.25, 3.7, 12.5, 8, 0, 22.1, 0, spec.dark, { metalness: 0.7 }).rotation.y = Math.PI / 8;
      bx(pylon, 4.8, 1.1, 5.2, 0, 27.3, 0, spec.mid, { metalness: 0.65 });
      bx(pylon, 0.18, 5.4, 0.4, s * 2.2, 22.0, 2.45, accent,
        { emissive: accent, emissiveIntensity: 0.52 });
    }
    bx(g, 9.1, 1.2, 3.2, 0, 24.3, 0, spec.mid, { metalness: 0.65 });
    bx(g, 3.6, 3.8, 3.6, 0, 26.7, 0, spec.dark, { metalness: 0.75 });
    sph(g, 1.45, 0, top - 1.45, 0, accent, { emissive: accent, emissiveIntensity: 1.05 });
    // 單側維修塔打破左右完全對稱，提供方向性與尺度錨。
    bx(g, 2.3, 6.3, 3.1, 11.1, 13.8, -4.1, spec.dark, { metalness: 0.7 });
    torus(g, 1.05, 0.12, 11.1, 17.4, -4.1, accent,
      { emissive: accent, emissiveIntensity: 0.75 });
  }

  g.userData.modelLanguage = spec.language;
  return g;
}

/** 建立塔身或主堡；未知鍵回傳 null，讓既有備援鏈決定降級。 */
export function buildBuildingUnit(kind, side) {
  if (kind === 'tower') return buildTower(side);
  const spec = BUILDING_UNIT_MODELS[kind];
  return spec ? buildBase(spec, side) : null;
}

/**
 * 建立防禦塔旋轉頭。回傳 yaw 根節點，並維持現役 API：
 * `yaw.userData.pitch` 是俯仰樞軸、`yaw.userData.muzzles` 是沿局部 +z 的槍口陣列。
 */
export function buildBuildingUnitTurret(side) {
  const swarm = side === 'SWARM';
  const spec = BUILDING_UNIT_MODELS.tower.sides[swarm ? 'SWARM' : 'STEEL'];
  const accent = accentOf(side);
  const yaw = new THREE.Group();
  const pitch = new THREE.Group();
  const muzzles = [];

  addFacet(yaw, spec, swarm ? 1.5 : 1.7, swarm ? 2.1 : 2.3, 0.9, 0.45, spec.dark,
    { metalness: 0.7 });
  pitch.position.set(0, 1.0, 0.35);
  yaw.add(pitch);

  if (swarm) {
    // 一體莢艙避免六支方盒各自產生內輪廓；只讓槍口環切出節奏。
    bx(pitch, 3.4, 1.55, 2.7, 0, 0, 0.55, spec.body, { metalness: 0.65 });
    for (const sx of [-1.0, 0, 1.0]) {
      for (const sy of [-0.38, 0.38]) {
        const barrel = cyl(pitch, 0.25, 0.3, 0.7, 6, sx, sy, 1.8, spec.dark, { metalness: 0.75 });
        barrel.rotation.x = Math.PI / 2;
        const muzzle = cyl(pitch, 0.33, 0.33, 0.10, 6, sx, sy, 2.18, accent,
          { emissive: accent, emissiveIntensity: 0.95 });
        muzzle.rotation.x = Math.PI / 2;
        muzzles.push(muzzle);
      }
    }
    sph(pitch, 0.38, 0, 0.95, 1.15, accent, { emissive: accent, emissiveIntensity: 1.0 });
  } else {
    // 雙軌砲：砲尾、套筒、砲口皆由同一 x 座標派生，接點不靠手猜。
    bx(pitch, 3.8, 1.45, 3.3, 0, 0, 0.55, spec.body, { metalness: 0.7 });
    for (const sx of [-0.62, 0.62]) {
      const sleeve = cyl(pitch, 0.31, 0.37, 2.0, 8, sx, 0, 2.45, spec.mid, { metalness: 0.8 });
      sleeve.rotation.x = Math.PI / 2;
      const barrel = cyl(pitch, 0.20, 0.25, 3.6, 8, sx, 0, 4.55, spec.dark, { metalness: 0.85 });
      barrel.rotation.x = Math.PI / 2;
      const muzzle = cyl(pitch, 0.31, 0.31, 0.35, 8, sx, 0, 6.42, accent,
        { emissive: accent, emissiveIntensity: 0.72 });
      muzzle.rotation.x = Math.PI / 2;
      muzzles.push(muzzle);
    }
    bx(pitch, 0.18, 0.9, 1.4, 0, 1.05, 1.2, accent,
      { emissive: accent, emissiveIntensity: 0.72 });
  }

  yaw.userData.pitch = pitch;
  yaw.userData.muzzles = muzzles;
  yaw.userData.muzzleAxis = '+z';
  outlinify(yaw, 0.1);
  return yaw;
}
