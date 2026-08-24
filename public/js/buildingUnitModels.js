// ============ 戰鬥建築單位模型（防禦塔 / 雙陣營主堡）============
// 本檔只產生純視覺樹；高度、碰撞與命中量體仍由 data.js TARGET_H / TARGET_R 定案。
// 所有建物以同一張規格表驅動，避免塔身、砲塔與主堡各自長出不可稽核的尺寸副本。
import * as THREE from 'three';
import { SIDES } from './data.js';
import { mat, bx, cyl, sph, torus, dim, rbz } from './geo3d.js';
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
        reference: '烏克蘭 36D6 機動雷達塔',
        language: 'ukrainian-lattice-radar',
      }),
      STEEL: Object.freeze({
        facets: 10,
        yaw: Math.PI / 10,
        body: 0x667380,
        mid: 0x7d8995,
        dark: 0x343c45,
        reference: '蘇式裝甲海岸砲台',
        language: 'soviet-armored-battery',
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
    reference: '烏克蘭加固機庫群與無人機管制塔',
    language: 'ukrainian-drone-airbase',
  }),
  'base:STEEL': Object.freeze({
    top: 34,
    facets: 10,
    yaw: Math.PI / 10,
    body: 0x596774,
    mid: 0x74828e,
    dark: 0x303842,
    reference: '蘇式潛艇堡與洲際飛彈井',
    language: 'soviet-silo-citadel',
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

function addStrut(parent, a, b, r, color, opts) {
  const p0 = new THREE.Vector3(...a), p1 = new THREE.Vector3(...b);
  const d = p1.clone().sub(p0);
  const m = cyl(parent, r, r, Math.max(0.001, d.length()), 6,
    (p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5, (p0.z + p1.z) * 0.5, color, opts);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/**
 * 防禦塔固定介面。塔頂座圈嚴格位於全高 92%，供 models.js 掛載 yaw 砲塔；
 * 塔身結構則由國家／型號資料列分流，蜂群走外露桁架、鋼鐵走實心砲廓。
 */
function buildTower(side) {
  const frame = BUILDING_UNIT_MODELS.tower;
  const spec = frame.sides[side] || frame.sides.STEEL;
  const accent = accentOf(side);
  const top = frame.top;
  const seatY = top * frame.turretSeatF;
  const g = new THREE.Group();

  if (spec.language === 'ukrainian-lattice-radar') {
    // 36D6 語彙：低基座、四腳外露桁架、大片負空間與偏置雷達架。
    addFacet(g, spec, 5.7, 6.6, 1.2, 0.6, spec.dark);
    bx(g, 10.2, 0.55, 8.8, 0, 1.45, 0, spec.body);
    const feet = [[-4.0, 0, -3.2], [4.0, 0, -3.2], [-4.0, 0, 3.2], [4.0, 0, 3.2]];
    const heads = [[-1.9, seatY - 1.0, -1.6], [1.9, seatY - 1.0, -1.6],
      [-1.9, seatY - 1.0, 1.6], [1.9, seatY - 1.0, 1.6]];
    for (let i = 0; i < feet.length; i++) {
      const foot = feet[i], head = heads[i];
      addStrut(g, [foot[0], 1.5, foot[2]], head, 0.24, spec.dark, { metalness: 0.66 });
      const mid = [(foot[0] + head[0]) * 0.5, 9.2, (foot[2] + head[2]) * 0.5];
      addStrut(g, [foot[0], 1.5, foot[2]], [-mid[0], mid[1], mid[2]], 0.11, spec.mid);
      addStrut(g, [head[0], head[1], head[2]], [-mid[0], mid[1], mid[2]], 0.11, spec.mid);
    }
    for (const y of [6.1, 10.7, 15.0]) {
      const f = 1 - y / seatY * 0.48;
      bx(g, 7.6 * f, 0.28, 0.35, 0, y, -2.5 * f, spec.mid);
      bx(g, 7.6 * f, 0.28, 0.35, 0, y, 2.5 * f, spec.mid);
      bx(g, 0.35, 0.28, 5.0 * f, -3.8 * f, y, 0, spec.mid);
      bx(g, 0.35, 0.28, 5.0 * f, 3.8 * f, y, 0, spec.mid);
    }
    bx(g, 6.8, 0.65, 6.2, 0, seatY - 0.55, 0, spec.dark, { metalness: 0.62 });
    cyl(g, 0.2, 0.28, 3.1, 8, 0, seatY - 2.15, 0, spec.dark);
    // 偏置相位陣列與通訊環讓正面方向可讀。
    const radar = bx(g, 4.5, 2.2, 0.22, -2.2, 13.7, 0.9, spec.mid);
    radar.rotation.y = -0.24;
    torus(g, 0.78, 0.09, 2.6, 14.2, -0.9, accent,
      { emissive: accent, emissiveIntensity: 0.78 });
    addStrut(g, [2.6, 12.2, -0.9], [2.6, 15.8, -0.9], 0.07, spec.dark);
  } else {
    // 蘇式海岸砲台語彙：實心砲廓、外凸扶壁與厚重裝甲甲板。
    bx(g, 12.6, 2.0, 10.8, 0, 1.0, 0, spec.dark, { metalness: 0.68 });
    bx(g, 10.4, 3.8, 8.5, 0, 3.9, -0.25, spec.body, { metalness: 0.62 });
    for (const x of [-4.9, 4.9]) {
      const buttress = bx(g, 2.1, 8.8, 3.4, x, 7.2, -0.1, spec.dark, { metalness: 0.72 });
      buttress.rotation.z = x < 0 ? -0.1 : 0.1;
      bx(g, 0.18, 5.8, 0.42, x * 1.07, 7.8, 1.62, accent,
        { emissive: accent, emissiveIntensity: 0.5 });
    }
    addFacet(g, spec, 3.8, 5.2, 7.8, 11.5, spec.body, { metalness: 0.66 });
    addFacet(g, spec, 3.25, 3.8, 2.9, 16.85, spec.mid, { metalness: 0.7 });
    addFacet(g, spec, 4.2, 4.2, 0.65, seatY - 0.33, spec.dark, { metalness: 0.76 });
    bx(g, 2.0, 3.8, 1.9, 4.45, 14.5, -1.3, spec.dark, { metalness: 0.72 });
    torus(g, 0.75, 0.1, 4.45, 16.6, -1.3, accent,
      { emissive: accent, emissiveIntensity: 0.78 });
  }

  g.userData.turretSeatF = frame.turretSeatF;
  g.userData.modelLanguage = spec.language;
  g.userData.modelReference = spec.reference;
  return g;
}

function buildBase(spec, side) {
  const g = new THREE.Group();
  const accent = accentOf(side);
  const top = spec.top;

  if (spec.language === 'ukrainian-drone-airbase') {
    // 低矮加固機庫群：六片分散機庫決定水平輪廓，中央管制塔只佔小面積。
    addFacet(g, spec, 17.5, 20.0, 2.0, 1.0, spec.dark);
    addRadial(g, 6, 12.3, ({ i, a, x, z }) => {
      const hangar = new THREE.Group();
      hangar.position.set(x, 3.5, z);
      hangar.rotation.y = a;
      g.add(hangar);
      bx(hangar, 5.2, 3.8, 8.3, 0, 0, 0, i % 2 ? spec.body : dim(spec.body, 0.9));
      const roofL = bx(hangar, 3.2, 0.42, 8.7, -1.35, 2.05, 0, spec.mid);
      const roofR = bx(hangar, 3.2, 0.42, 8.7, 1.35, 2.05, 0, spec.mid);
      roofL.rotation.z = 0.28; roofR.rotation.z = -0.28;
      bx(hangar, 3.9, 2.4, 0.16, 0, -0.35, 4.15, spec.dark);
      bx(hangar, 0.2, 0.65, 0.08, 1.85, -0.25, 4.27, accent,
        { emissive: accent, emissiveIntensity: 0.65 });
    }, Math.PI / 6);
    addFacet(g, spec, 6.2, 9.2, 7.2, 7.4, spec.body);
    addFacet(g, spec, 3.3, 5.8, 8.0, 15.0, spec.mid);
    // 四腳管制塔以桁架承載，與鋼鐵實心飛彈井形成負空間差。
    for (const x of [-3.3, 3.3]) for (const z of [-3.3, 3.3]) {
      addStrut(g, [x, 11.0, z], [x * 0.48, 26.8, z * 0.48], 0.17, spec.dark);
    }
    bx(g, 7.0, 2.0, 7.0, 0, 27.3, 0, spec.body);
    rbz(g, 5.3, 2.7, 5.3, 0, 29.55, 0, spec.mid);
    for (const a of [0, Math.PI / 2]) {
      const panel = bx(g, 5.2, 1.55, 0.16, Math.sin(a) * 3.4, 29.7, Math.cos(a) * 3.4, spec.dark);
      panel.rotation.y = a;
    }
    sph(g, 1.25, 0, top - 1.25, 0, accent, { emissive: accent, emissiveIntensity: 0.95 });
  } else {
    // 蘇式潛艇堡／飛彈井：矩形厚牆、雙井筒與跨橋，幾乎沒有穿透負空間。
    bx(g, 39.0, 3.2, 34.0, 0, 1.6, 0, spec.dark, { metalness: 0.68 });
    bx(g, 31.0, 7.4, 27.0, 0, 6.9, -0.8, spec.body, { metalness: 0.62 });
    for (const x of [-12.5, 12.5]) {
      bx(g, 6.4, 13.0, 24.0, x, 13.6, -1.0, spec.dark, { metalness: 0.7 });
      addFacet(g, spec, 4.2, 5.2, 12.5, 22.2, spec.body, { metalness: 0.72 }).position.x = x;
      addFacet(g, spec, 4.6, 4.6, 1.0, 28.95, spec.mid, { metalness: 0.78 }).position.x = x;
      torus(g, 2.65, 0.24, x, 29.55, 0, spec.dark, { metalness: 0.8 });
    }
    bx(g, 20.0, 2.1, 8.2, 0, 24.0, 0, spec.mid, { metalness: 0.7 });
    bx(g, 6.4, 6.0, 6.4, 0, 27.8, 0, spec.dark, { metalness: 0.76 });
    sph(g, 1.3, 0, top - 1.3, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });
    // 正面三道大型發射井門，從遠距即可讀出水平方向。
    for (const x of [-9, 0, 9]) {
      bx(g, 6.2, 5.2, 0.32, x, 8.0, 12.85, spec.dark);
      bx(g, 0.22, 3.4, 0.12, x, 8.0, 13.06, accent,
        { emissive: accent, emissiveIntensity: 0.5 });
    }
  }

  g.userData.modelLanguage = spec.language;
  g.userData.modelReference = spec.reference;
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
  yaw.userData.modelReference = spec.reference;
  outlinify(yaw, 0.1);
  return yaw;
}
