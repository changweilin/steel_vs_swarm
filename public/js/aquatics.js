// ============ 水下與沼澤生態、動態、遺跡與船艦系統 (aquatics.js) ============
// 參考 winchxyz/bikini-bottom 架構與技術，提供：
//   1. 氣泡與微粒模擬器（清澈水下氣泡、泥沼沼氣泡、海雪微粒、沼泥懸浮物）
//   2. 水生動植物（海帶森林、海草叢、鹿角/海扇/腦紋珊瑚、海葵、紅樹林根、浮萍睡蓮、發光真菌）
//   3. 水生生物動態（群游魚群、脈動水母群、沼澤泥鰍）
//   4. 水下巨型物件與遺跡（潛艦、木造/鋼鐵沈船殘骸、古代神廟柱廊遺跡、浸沒建築與科研水下艙）
//   5. 水面船艦（巡弋巡邏艇/護衛艦/貨輪 + 船頭浪與尾波、岸邊停泊搖晃小艇）
//   6. 沼澤與水域漸進式過渡帶計算
//
// 紀律與規範：
//   - 零 npm 依賴、vanilla ES-module JS + Three.js 0.160
//   - 表現層歸表現層：全部純視覺表現，不影響伺服器權威幾何與平衡判定
//   - 確定性散布：走 mulberry32 與落點雜湊 (aquaticSeed)，零共享 rnd() 消耗
//   - 尺度：SOLDIER_H (1.8m) 真實世界尺度
//   - 材質與描邊：整合 toonMat、toonPlain、envMat、markShared，正確釋放 GPU 資源

import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { WATER } from './data.js';
import {
  toonMat, toonPlain, envMat, markShared,
  SURF_ID
} from './toon.js';
import { terrainEnvCode } from './biomes.js';

/* =========================================================================
 * 0. 常數、調色盤與種子雜湊 (Constants, Palettes & Hashes)
 * ========================================================================= */

export const AQUATIC = {
  // 氣泡系統
  BUBBLE_COUNT_WATER: 160,
  BUBBLE_COUNT_SWAMP: 90,
  BUBBLE_RISE_SPD_WATER: 1.8,
  BUBBLE_RISE_SPD_SWAMP: 0.85,
  BUBBLE_WOBBLE_FREQ_WATER: 3.2,
  BUBBLE_WOBBLE_FREQ_SWAMP: 1.4,

  // 懸浮微粒（海雪 / 沼泥）
  SNOW_COUNT_WATER: 240,
  SNOW_COUNT_SWAMP: 180,

  // 生物動態
  FISH_SCHOOLS_MAX: 6,
  FISH_PER_SCHOOL: 14,
  JELLYFISH_MAX: 24,
  MUDFISH_MAX: 12,

  // 船艦動態
  SHIP_CRUISE_SPD: 7.5,
  BOAT_BOB_FREQ: 0.9,
  BOAT_BOB_AMP: 0.12,

  // 渲染限制
  MAX_UNDERWATER_PROPS: 48,
};

/** 座標雜湊種子（零共享 rnd 消耗） */
export function aquaticSeed(x, z) {
  const h = (Math.imul(Math.round(x * 8) | 0, 0x9E3779B1) ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77)) | 0;
  return Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0;
}

const PALETTE = {
  // 珊瑚與水生植物
  kelpGreen: [0x2f8a4a, 0x3f9a3a, 0x57ad42, 0x6fbf4a],
  kelpAmber: [0x8a9a2f, 0xb5544a, 0xa8446f],
  coralStag: [0xff6b6b, 0xff8a6b, 0xffb84d, 0x6fd8c8, 0xb98ad8, 0xff5f7e],
  coralFan: [0xff758c, 0xfd868c, 0x70c1b3, 0xf3ffbd, 0xa599b5],
  anemone: [0xff4081, 0x00e676, 0x00e5ff, 0xffea00, 0x7c4dff],
  // 沼澤植物
  swampRoot: [0x3d3023, 0x4a3b2c, 0x2b2118],
  lilyPad: [0x2d5a27, 0x386631, 0x1f421a],
  lotusFlower: [0xff80ab, 0xffffff, 0xffd54f],
  swampGlowFungus: [0x69f0ae, 0x64ffda, 0xeeff41, 0xb388ff],
  // 沉船與潛艦
  subHull: [0x263238, 0x37474f, 0x1e272c],
  woodWreck: [0x4e342e, 0x3e2723, 0x5d4037],
  ironWreck: [0x546e7a, 0x455a64, 0x78909c],
  ruinsStone: [0x90a4ae, 0x78909c, 0x607d8b, 0xb0bec5],
  // 船艦
  patrolCamo: [0x37474f, 0x455a64, 0x263238],
  deckWood: [0xa1887f, 0x8d6e63, 0x6d4c41],
  cargoHull: [0xb71c1c, 0x0d47a1, 0xe65100],
};

/* =========================================================================
 * 1. 漸進式水沼過渡帶計算 (Transition Zone Metric)
 * ========================================================================= */

/**
 * 計算 (x, z) 處的水沼混合係數與狀態
 * @param terrain
 * @param x
 * @param z
 * @returns {{ mix: number, isWater: boolean, isSwamp: boolean, depth: number, waterCol: number, veilCol: number[] }}
 *   mix: 0 = 純水域, 1 = 純沼澤, (0, 1) = 過渡帶
 */
export function aquaticTransition(terrain, x, z) {
  const wy = terrain?.waterY;
  if (wy == null) {
    return { mix: 0, isWater: false, isSwamp: false, depth: 0, waterCol: 0x1a4a6a, veilCol: [26, 92, 142] };
  }
  const code = terrainEnvCode(terrain, x, z);
  const h = terrain.heightAt(x, z);
  const swampBand = WATER.SWAMP_BAND;
  const swampY = wy + swampBand;

  // 計算局部水深
  const waterDepth = Math.max(0, wy - h);
  const swampDepth = Math.max(0, swampY - h);

  // 掃描周圍 4 點計算水與沼的鄰域比例，形成平滑混合
  const sampleRadius = 14;
  let waterHits = 0, swampHits = 0, total = 0;
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, 0.7]]) {
    const c = terrainEnvCode(terrain, x + dx * sampleRadius, z + dz * sampleRadius);
    if (c === 1) waterHits++;
    else if (c === 2) swampHits++;
    total++;
  }
  let mix = code === 2 ? 1 : code === 1 ? 0 : 0;
  if (total > 0 && (waterHits > 0 || swampHits > 0)) {
    const swampRatio = swampHits / (waterHits + swampHits || 1);
    mix = (mix + swampRatio) * 0.5;
  }
  mix = Math.max(0, Math.min(1, mix));

  // 水色內插: 湛藍 (0x134b73) -> 碧綠過渡 (0x246855) -> 混濁紫褐 (0x4a3358)
  const r = Math.round(0x13 + (0x4a - 0x13) * mix);
  const g = Math.round(0x4b + (0x33 - 0x4b) * mix);
  const b = Math.round(0x73 + (0x58 - 0x73) * mix);
  const waterCol = (r << 16) | (g << 8) | b;

  // 水下帷幕色相內插: 藍 [26, 92, 142] -> 綠褐 [50, 75, 80] -> 紫褐 [96, 66, 128]
  const veilCol = [
    Math.round(26 + (96 - 26) * mix),
    Math.round(92 + (66 - 92) * mix),
    Math.round(142 + (128 - 142) * mix)
  ];

  return {
    mix,
    isWater: code === 1,
    isSwamp: code === 2,
    depth: code === 2 ? swampDepth : waterDepth,
    waterCol,
    veilCol,
  };
}

/* =========================================================================
 * 2. 氣泡與懸浮微粒模擬器 (Bubbles & Suspended Particles)
 * ========================================================================= */

/**
 * 建立水下氣泡與沼氣泡系統（InstancedMesh 批次）
 */
function createBubbleSystem(terrain, seed) {
  const wy = terrain?.waterY;
  if (wy == null) return null;
  const rnd = mulberry32((seed ^ 0x3B881A) >>> 0);

  const countWater = AQUATIC.BUBBLE_COUNT_WATER;
  const countSwamp = AQUATIC.BUBBLE_COUNT_SWAMP;

  // 氣泡幾何體（低多邊形 8x6 球體）
  const sphereGeo = new THREE.SphereGeometry(1, 8, 6);
  markShared(sphereGeo);

  // 清澈水氣泡材質（半透明亮白帶青）
  const matWater = toonMat(0xd8f4ff, {
    transparent: true, opacity: 0.65, bands: 'soft', rim: 1.5,
  });
  matWater.userData.noOutline = true;

  // 沼澤沼氣泡材質（微綠濁黃）
  const matSwamp = toonMat(0xbedb84, {
    transparent: true, opacity: 0.72, bands: 'soft', rim: 1.2,
  });
  matSwamp.userData.noOutline = true;

  const meshWater = new THREE.InstancedMesh(sphereGeo, matWater, countWater);
  const meshSwamp = new THREE.InstancedMesh(sphereGeo, matSwamp, countSwamp);
  meshWater.frustumCulled = false;
  meshSwamp.frustumCulled = false;

  const { minX, maxX, minZ, maxZ } = terrain;
  const wSpan = maxX - minX, hSpan = maxZ - minZ;

  // 氣泡狀態數據庫
  const particles = [];

  const spawnBubble = (p, isSwamp) => {
    // 隨機在水域或沼澤中尋找有效底床
    for (let attempt = 0; attempt < 25; attempt++) {
      const x = minX + rnd() * wSpan;
      const z = minZ + rnd() * hSpan;
      const code = terrainEnvCode(terrain, x, z);
      if ((isSwamp && code === 2) || (!isSwamp && code === 1)) {
        const floorY = terrain.heightAt(x, z);
        const surfaceY = isSwamp ? wy + WATER.SWAMP_BAND : wy;
        if (surfaceY - floorY > 0.4) {
          p.x = x;
          p.z = z;
          p.floorY = floorY;
          p.surfaceY = surfaceY;
          p.y = floorY + rnd() * (surfaceY - floorY);
          p.baseR = isSwamp ? 0.12 + rnd() * 0.28 : 0.06 + rnd() * 0.18;
          p.wobblePh = rnd() * Math.PI * 2;
          p.wobbleSpd = isSwamp ? 1.4 + rnd() * 0.8 : 3.0 + rnd() * 1.5;
          p.riseSpd = isSwamp ? 0.6 + rnd() * 0.6 : 1.4 + rnd() * 1.2;
          p.isSwamp = isSwamp;
          return;
        }
      }
    }
    // 找不到則在邊緣休眠
    p.x = minX; p.z = minZ; p.y = -100; p.baseR = 0.001; p.surfaceY = -100; p.floorY = -100;
  };

  for (let i = 0; i < countWater; i++) {
    const p = { id: i, isSwamp: false };
    spawnBubble(p, false);
    particles.push(p);
  }
  for (let i = 0; i < countSwamp; i++) {
    const p = { id: i, isSwamp: true };
    spawnBubble(p, true);
    particles.push(p);
  }

  const dummy = new THREE.Object3D();

  return {
    group: new THREE.Group(),
    init() {
      this.group.add(meshWater);
      this.group.add(meshSwamp);
      this.step(0.016, 0);
    },
    step(dt, time) {
      let wIdx = 0, sIdx = 0;
      for (const p of particles) {
        if (p.surfaceY <= p.floorY) continue;
        p.y += p.riseSpd * dt;
        // 到達水面破裂重生
        if (p.y >= p.surfaceY) {
          p.y = p.floorY;
          p.wobblePh = rnd() * Math.PI * 2;
        }
        // 浮力搖曳（雙頻微動）
        const wobX = Math.sin(time * p.wobbleSpd + p.wobblePh) * 0.08;
        const wobZ = Math.cos(time * p.wobbleSpd * 1.4 + p.wobblePh) * 0.06;
        // 隨上升水壓降低而略微膨脹
        const depthFrac = Math.max(0, Math.min(1, (p.surfaceY - p.y) / (p.surfaceY - p.floorY + 1e-4)));
        const curR = p.baseR * (1 + 0.35 * (1 - depthFrac));

        dummy.position.set(p.x + wobX, p.y, p.z + wobZ);
        dummy.scale.set(curR, curR * (1 + 0.15 * Math.sin(time * 5 + p.wobblePh)), curR);
        dummy.updateMatrix();

        if (!p.isSwamp && wIdx < countWater) {
          meshWater.setMatrixAt(wIdx++, dummy.matrix);
        } else if (p.isSwamp && sIdx < countSwamp) {
          meshSwamp.setMatrixAt(sIdx++, dummy.matrix);
        }
      }
      meshWater.instanceMatrix.needsUpdate = true;
      meshSwamp.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      matWater.dispose();
      matSwamp.dispose();
    }
  };
}

/**
 * 建立海雪與沼澤懸浮顆粒系統（Points）
 */
function createSuspendedDetritus(terrain, seed) {
  const wy = terrain?.waterY;
  if (wy == null) return null;
  const rnd = mulberry32((seed ^ 0x7E19D3) >>> 0);

  const N_W = AQUATIC.SNOW_COUNT_WATER;
  const N_S = AQUATIC.SNOW_COUNT_SWAMP;
  const total = N_W + N_S;

  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const seeds = new Float32Array(total);
  const data = [];

  const { minX, maxX, minZ, maxZ } = terrain;
  const wSpan = maxX - minX, hSpan = maxZ - minZ;

  for (let i = 0; i < total; i++) {
    const isSwamp = i >= N_W;
    let found = false;
    let x = 0, z = 0, y = -100, floorY = 0, surfaceY = 0;
    for (let tryN = 0; tryN < 20; tryN++) {
      x = minX + rnd() * wSpan;
      z = minZ + rnd() * hSpan;
      const code = terrainEnvCode(terrain, x, z);
      if ((isSwamp && code === 2) || (!isSwamp && code === 1)) {
        floorY = terrain.heightAt(x, z);
        surfaceY = isSwamp ? wy + WATER.SWAMP_BAND : wy;
        if (surfaceY - floorY > 0.3) {
          y = floorY + rnd() * (surfaceY - floorY);
          found = true;
          break;
        }
      }
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    seeds[i] = rnd() * Math.PI * 2;

    if (!isSwamp) {
      // 海雪：淡白青色
      col[i * 3] = 0.85; col[i * 3 + 1] = 0.95; col[i * 3 + 2] = 1.0;
    } else {
      // 沼泥碎屑：暗土黃/褐綠
      col[i * 3] = 0.55; col[i * 3 + 1] = 0.50; col[i * 3 + 2] = 0.32;
    }

    data.push({ x, z, y, floorY, surfaceY, isSwamp, spd: (isSwamp ? 0.15 : 0.35) + rnd() * 0.2 });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.45, vertexColors: true, transparent: true, opacity: 0.6,
    depthWrite: false, sizeAttenuation: true,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;

  return {
    group: pts,
    step(dt, time) {
      const pArr = geo.attributes.position.array;
      for (let i = 0; i < total; i++) {
        const d = data[i];
        if (d.surfaceY <= d.floorY) continue;
        // 緩慢下沉或沿水流漂移
        d.y -= d.spd * dt * 0.5;
        if (d.y < d.floorY) d.y = d.surfaceY;
        const driftX = Math.sin(time * 0.4 + seeds[i]) * 0.12;
        const driftZ = Math.cos(time * 0.3 + seeds[i]) * 0.12;
        pArr[i * 3] = d.x + driftX;
        pArr[i * 3 + 1] = d.y;
        pArr[i * 3 + 2] = d.z + driftZ;
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    }
  };
}

/* =========================================================================
 * 3. 水生植物與珊瑚礁 (Flora & Coral Reefs)
 * ========================================================================= */

/**
 * 建立海帶森林、珊瑚礁、海草與沼澤水生植被
 */
export function buildAquaticFlora(parentGroup, terrain, seed) {
  const wy = terrain?.waterY;
  if (wy == null) return;
  const rnd = mulberry32((seed ^ 0x51A8C9) >>> 0);

  const { minX, maxX, minZ, maxZ } = terrain;
  const wSpan = maxX - minX, hSpan = maxZ - minZ;

  // 1. 海帶葉片與海草（共用 InstancedMesh）
  const kelpRibbonGeo = new THREE.CylinderGeometry(0.18, 0.05, 3.2, 4, 3);
  kelpRibbonGeo.translate(0, 1.6, 0);
  markShared(kelpRibbonGeo);

  const kelpMat = envMat(0x3f9a3a, {
    bands: 'soft', soft: { k: 'grass', span: 4.5 },
  });
  kelpMat.userData.surfGroup = SURF_ID.VEG;

  const maxKelp = 220;
  const kelpMesh = new THREE.InstancedMesh(kelpRibbonGeo, kelpMat, maxKelp);
  kelpMesh.frustumCulled = false;

  // 2. 珊瑚礁群（鹿角珊瑚 / 海扇 / 腦紋珊瑚）
  const coralBranchGeo = new THREE.CylinderGeometry(0.12, 0.22, 1.8, 5);
  coralBranchGeo.translate(0, 0.9, 0);
  markShared(coralBranchGeo);

  const coralDomeGeo = new THREE.SphereGeometry(1.2, 7, 5);
  coralDomeGeo.scale(1, 0.65, 1);
  markShared(coralDomeGeo);

  const coralMatA = envMat(0xff6b6b, { bands: 'hard' });
  const coralMatB = envMat(0x6fd8c8, { bands: 'hard' });
  const coralMatC = envMat(0xffb84d, { bands: 'soft' });

  const maxCoral = 140;
  const coralMeshA = new THREE.InstancedMesh(coralBranchGeo, coralMatA, maxCoral);
  const coralMeshB = new THREE.InstancedMesh(coralFanGeo(), coralMatB, Math.floor(maxCoral * 0.6));
  const coralMeshC = new THREE.InstancedMesh(coralDomeGeo, coralMatC, Math.floor(maxCoral * 0.5));
  coralMeshA.frustumCulled = false;
  coralMeshB.frustumCulled = false;
  coralMeshC.frustumCulled = false;

  // 3. 沼澤浮萍與睡蓮（Lily Pads & Lotuses）
  const padGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.04, 8);
  markShared(padGeo);
  const padMat = envMat(0x2d5a27, { bands: 'soft' });
  const maxPads = 180;
  const padMesh = new THREE.InstancedMesh(padGeo, padMat, maxPads);
  padMesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  let kCount = 0, cCountA = 0, cCountB = 0, cCountC = 0, pCount = 0;

  for (let i = 0; i < 600; i++) {
    const x = minX + rnd() * wSpan;
    const z = minZ + rnd() * hSpan;
    const code = terrainEnvCode(terrain, x, z);
    const floorY = terrain.heightAt(x, z);

    // 水下植被 (code === 1)
    if (code === 1 && wy - floorY > 1.2) {
      const depth = wy - floorY;
      const s = aquaticSeed(x, z);
      const localRnd = mulberry32(s);

      // 海帶叢
      if (depth >= 2.5 && kCount < maxKelp && localRnd() < 0.65) {
        const stalkH = Math.min(depth * 0.85, 2.0 + localRnd() * 4.5);
        dummy.position.set(x, floorY, z);
        dummy.rotation.set((localRnd() - 0.5) * 0.3, localRnd() * Math.PI * 2, (localRnd() - 0.5) * 0.3);
        dummy.scale.set(0.8 + localRnd() * 0.5, stalkH / 3.2, 0.8 + localRnd() * 0.5);
        dummy.updateMatrix();
        kelpMesh.setMatrixAt(kCount++, dummy.matrix);
      }

      // 珊瑚礁石
      if (localRnd() < 0.45) {
        dummy.position.set(x, floorY, z);
        dummy.rotation.set(0, localRnd() * Math.PI * 2, 0);
        const sc = 0.7 + localRnd() * 0.8;
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();

        const pick = localRnd();
        if (pick < 0.45 && cCountA < maxCoral) {
          coralMeshA.setMatrixAt(cCountA++, dummy.matrix);
        } else if (pick < 0.75 && cCountB < Math.floor(maxCoral * 0.6)) {
          coralMeshB.setMatrixAt(cCountB++, dummy.matrix);
        } else if (cCountC < Math.floor(maxCoral * 0.5)) {
          coralMeshC.setMatrixAt(cCountC++, dummy.matrix);
        }
      }
    }

    // 沼澤浮萍 (code === 2)
    if (code === 2 && pCount < maxPads) {
      const swampY = wy + WATER.SWAMP_BAND;
      dummy.position.set(x, swampY + 0.02, z);
      dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
      const sPad = 0.5 + rnd() * 0.9;
      dummy.scale.set(sPad, 1, sPad);
      dummy.updateMatrix();
      padMesh.setMatrixAt(pCount++, dummy.matrix);
    }
  }

  kelpMesh.count = kCount;
  coralMeshA.count = cCountA;
  coralMeshB.count = cCountB;
  coralMeshC.count = cCountC;
  padMesh.count = pCount;

  kelpMesh.instanceMatrix.needsUpdate = true;
  coralMeshA.instanceMatrix.needsUpdate = true;
  coralMeshB.instanceMatrix.needsUpdate = true;
  coralMeshC.instanceMatrix.needsUpdate = true;
  padMesh.instanceMatrix.needsUpdate = true;

  parentGroup.add(kelpMesh);
  parentGroup.add(coralMeshA);
  parentGroup.add(coralMeshB);
  parentGroup.add(coralMeshC);
  parentGroup.add(padMesh);
}

/** 扇形珊瑚幾何體生成器 */
function coralFanGeo() {
  const g = new THREE.TorusGeometry(1.0, 0.14, 5, 8, Math.PI * 1.1);
  g.scale(1, 1, 0.25);
  markShared(g);
  return g;
}

/* =========================================================================
 * 4. 水生生物動態：魚群、水母、沼澤泥鰍 (Fauna & Creatures)
 * ========================================================================= */

/**
 * 建立魚群系統（流線身形 + 擺尾游弋）
 */
function createFishSchools(terrain, seed) {
  const wy = terrain?.waterY;
  if (wy == null) return null;
  const rnd = mulberry32((seed ^ 0x93C4E1) >>> 0);

  const numSchools = Math.min(AQUATIC.FISH_SCHOOLS_MAX, 5);
  const fishPerSchool = AQUATIC.FISH_PER_SCHOOL;
  const totalFish = numSchools * fishPerSchool;

  // 小魚幾何體（扁平流線型身軀 + 尾鰭）
  const fishGeo = new THREE.ConeGeometry(0.18, 0.85, 4);
  fishGeo.rotateX(Math.PI / 2);
  fishGeo.scale(0.6, 0.9, 1.0);
  markShared(fishGeo);

  const fishMat = toonMat(0x42a5f5, { bands: 'hard', celMetal: true });
  fishMat.userData.noOutline = true;

  const mesh = new THREE.InstancedMesh(fishGeo, fishMat, totalFish);
  mesh.frustumCulled = false;

  const { minX, maxX, minZ, maxZ } = terrain;
  const schools = [];

  for (let s = 0; s < numSchools; s++) {
    // 尋找深水中心點
    let cx = 0, cz = 0, found = false;
    for (let t = 0; t < 30; t++) {
      const rx = minX + rnd() * (maxX - minX);
      const rz = minZ + rnd() * (maxZ - minZ);
      if (terrainEnvCode(terrain, rx, rz) === 1 && wy - terrain.heightAt(rx, rz) > 2.5) {
        cx = rx; cz = rz; found = true; break;
      }
    }
    if (!found) continue;

    const radius = 18 + rnd() * 22;
    const swimDepth = wy - 1.2 - rnd() * 2.0;
    const speed = 1.8 + rnd() * 1.2;
    const rotDir = rnd() > 0.5 ? 1 : -1;
    const phaseOff = rnd() * Math.PI * 2;

    schools.push({ cx, cz, radius, swimDepth, speed, rotDir, phaseOff, id: s });
  }

  const dummy = new THREE.Object3D();

  return {
    group: mesh,
    step(dt, time) {
      let idx = 0;
      for (const sc of schools) {
        const baseAngle = time * (sc.speed / sc.radius) * sc.rotDir + sc.phaseOff;
        for (let f = 0; f < fishPerSchool; f++) {
          const fishAng = baseAngle + (f / fishPerSchool) * Math.PI * 2 * 0.35 + Math.sin(time + f) * 0.15;
          const r = sc.radius + Math.sin(time * 0.8 + f * 1.3) * 3.5;
          const x = sc.cx + Math.cos(fishAng) * r;
          const z = sc.cz + Math.sin(fishAng) * r;
          const y = sc.swimDepth + Math.sin(time * 1.5 + f) * 0.4;

          // 朝向切線方向
          const heading = fishAng + (sc.rotDir > 0 ? Math.PI / 2 : -Math.PI / 2);
          const wag = Math.sin(time * 6.5 + f * 1.8) * 0.22;

          dummy.position.set(x, y, z);
          dummy.rotation.set(0, heading + wag, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();

          if (idx < totalFish) {
            mesh.setMatrixAt(idx++, dummy.matrix);
          }
        }
      }
      mesh.count = idx;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      fishMat.dispose();
    }
  };
}

/**
 * 建立水母群系統（半透明傘狀 + 脈動收縮動態）
 */
function createJellyfishFields(terrain, seed) {
  const wy = terrain?.waterY;
  if (wy == null) return null;
  const rnd = mulberry32((seed ^ 0xA526F3) >>> 0);

  const count = AQUATIC.JELLYFISH_MAX;

  // 水母鐘形體幾何
  const jellyGeo = new THREE.SphereGeometry(1.0, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  markShared(jellyGeo);

  const mat = toonPlain({
    color: 0xff80ab, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
  });
  mat.userData.noOutline = true;

  const mesh = new THREE.InstancedMesh(jellyGeo, mat, count);
  mesh.frustumCulled = false;

  const { minX, maxX, minZ, maxZ } = terrain;
  const jellies = [];

  for (let i = 0; i < count; i++) {
    let x = 0, z = 0, found = false;
    for (let t = 0; t < 25; t++) {
      const rx = minX + rnd() * (maxX - minX);
      const rz = minZ + rnd() * (maxZ - minZ);
      if (terrainEnvCode(terrain, rx, rz) === 1 && wy - terrain.heightAt(rx, rz) > 3.0) {
        x = rx; z = rz; found = true; break;
      }
    }
    if (!found) continue;

    const floorY = terrain.heightAt(x, z);
    jellies.push({
      x, z,
      baseY: floorY + 1.2 + rnd() * (wy - floorY - 2.0),
      scale: 0.8 + rnd() * 0.7,
      pulseSpd: 1.8 + rnd() * 0.8,
      pulsePh: rnd() * Math.PI * 2,
      driftR: 2.0 + rnd() * 4.0,
    });
  }

  const dummy = new THREE.Object3D();

  return {
    group: mesh,
    step(dt, time) {
      let idx = 0;
      for (const j of jellies) {
        // 脈動呼吸（快速收縮推進，慢速舒張回彈）
        const ph = (time * j.pulseSpd + j.pulsePh) % (Math.PI * 2);
        const pulse = Math.sin(ph);
        const radPulse = 1.0 - (pulse > 0 ? pulse * 0.25 : pulse * 0.1);
        const yPulse = 1.0 + (pulse > 0 ? pulse * 0.35 : pulse * 0.1);

        const x = j.x + Math.sin(time * 0.3 + j.pulsePh) * j.driftR;
        const z = j.z + Math.cos(time * 0.25 + j.pulsePh) * j.driftR;
        const y = j.baseY + Math.sin(time * j.pulseSpd * 0.5 + j.pulsePh) * 0.6;

        dummy.position.set(x, y, z);
        dummy.rotation.set(Math.sin(time * 0.5 + j.pulsePh) * 0.1, 0, Math.cos(time * 0.4 + j.pulsePh) * 0.1);
        dummy.scale.set(j.scale * radPulse, j.scale * yPulse, j.scale * radPulse);
        dummy.updateMatrix();

        if (idx < count) {
          mesh.setMatrixAt(idx++, dummy.matrix);
        }
      }
      mesh.count = idx;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      mat.dispose();
    }
  };
}

/* =========================================================================
 * 5. 水下巨型物件、潛艦、沈船、古代遺跡與浸沒建築 (Sunken Features & Ruins)
 * ========================================================================= */

/**
 * 建立水下世界之潛艦、木造/鋼鐵沈船、古代神殿柱廊遺跡與浸沒建築
 */
export function buildSunkenRelics(parentGroup, terrain, seed) {
  const wy = terrain?.waterY;
  if (wy == null) return;
  const rnd = mulberry32((seed ^ 0x62B710) >>> 0);

  const { minX, maxX, minZ, maxZ } = terrain;
  const wSpan = maxX - minX, hSpan = maxZ - minZ;

  let relicCount = 0;
  const maxRelics = AQUATIC.MAX_UNDERWATER_PROPS;

  for (let i = 0; i < 180 && relicCount < maxRelics; i++) {
    const x = minX + rnd() * wSpan;
    const z = minZ + rnd() * hSpan;
    const code = terrainEnvCode(terrain, x, z);
    const floorY = terrain.heightAt(x, z);

    // 水下深水區 (code === 1 && depth >= 3.5m)
    if (code === 1 && wy - floorY >= 3.5) {
      const roll = rnd();

      if (roll < 0.22) {
        // A. 潛水艇 (Submarine / Mini-Sub)
        buildSubmarine(parentGroup, x, floorY + 0.6, z, rnd);
        relicCount++;
      } else if (roll < 0.48) {
        // B. 古代神廟沉沒柱廊遺跡 (Ancient Sunken Colonnade & Temple Ruins)
        buildSunkenRuins(parentGroup, x, floorY, z, rnd);
        relicCount++;
      } else if (roll < 0.75) {
        // C. 沈船殘骸 (Shipwreck - Wooden Galleon or Steel Freighter)
        buildShipwreck(parentGroup, x, floorY, z, rnd);
        relicCount++;
      } else {
        // D. 浸沒科研艙房與水底管線 (Submerged Habitat Pod & Pipelines)
        buildSubmergedHabitat(parentGroup, x, floorY, z, rnd);
        relicCount++;
      }
    }
  }
}

/** 建造水下潛艦 */
function buildSubmarine(group, x, y, z, rnd) {
  const subGroup = new THREE.Group();
  subGroup.position.set(x, y, z);
  subGroup.rotation.y = rnd() * Math.PI * 2;
  subGroup.rotation.z = (rnd() - 0.5) * 0.15; // 輕微擱淺傾斜

  const hullMat = toonMat(PALETTE.subHull[0], { celMetal: true });
  const trimMat = toonMat(0xffb300, { bands: 'soft' });

  // 主雪茄型艦體
  const hullGeo = new THREE.CapsuleGeometry(2.2, 14.0, 6, 12);
  hullGeo.rotateX(Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  subGroup.add(hull);

  // 艦橋 / 帆罩 (Conning Tower)
  const towerGeo = new THREE.BoxGeometry(1.6, 2.4, 4.2);
  towerGeo.translate(0, 2.0, 0.8);
  const tower = new THREE.Mesh(towerGeo, hullMat);
  subGroup.add(tower);

  // 潛望鏡與雷達天線
  const scopeGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 5);
  scopeGeo.translate(0, 3.8, 1.2);
  const scope = new THREE.Mesh(scopeGeo, trimMat);
  subGroup.add(scope);

  // 尾部十字翼與螺旋槳
  const finGeo = new THREE.BoxGeometry(5.2, 0.25, 1.4);
  finGeo.translate(0, 0, -7.2);
  const hFin = new THREE.Mesh(finGeo, hullMat);
  const vFin = new THREE.Mesh(finGeo, hullMat);
  vFin.rotation.z = Math.PI / 2;
  subGroup.add(hFin);
  subGroup.add(vFin);

  group.add(subGroup);
}

/** 建造古代沉沒遺跡（柱廊與方尖碑） */
function buildSunkenRuins(group, x, y, z, rnd) {
  const ruinsGroup = new THREE.Group();
  ruinsGroup.position.set(x, y, z);
  ruinsGroup.rotation.y = rnd() * Math.PI * 2;

  const stoneMat = envMat(PALETTE.ruinsStone[0], { bands: 'hard' });

  // 台基台階
  const baseGeo = new THREE.BoxGeometry(16, 0.8, 12);
  const base = new THREE.Mesh(baseGeo, stoneMat);
  ruinsGroup.add(base);

  // 4~6 根石柱（部分站立、部分倒塌）
  const colGeo = new THREE.CylinderGeometry(0.65, 0.75, 5.5, 7);
  for (let c = 0; c < 6; c++) {
    const cx = (c % 3 - 1) * 5.2;
    const cz = (c < 3 ? -1 : 1) * 3.8;
    const isToppled = (c === 2 || c === 5) && rnd() < 0.6;

    const col = new THREE.Mesh(colGeo, stoneMat);
    if (isToppled) {
      col.position.set(cx + 1.2, 0.8, cz);
      col.rotation.set(Math.PI / 2, (rnd() - 0.5) * 0.4, 0);
    } else {
      col.position.set(cx, 3.15, cz);
    }
    ruinsGroup.add(col);
  }

  group.add(ruinsGroup);
}

/** 建造沈船殘骸 */
function buildShipwreck(group, x, y, z, rnd) {
  const wreckGroup = new THREE.Group();
  wreckGroup.position.set(x, y, z);
  wreckGroup.rotation.y = rnd() * Math.PI * 2;
  wreckGroup.rotation.z = 0.28; // 側翻在海床上

  const woodMat = envMat(PALETTE.woodWreck[0], { bands: 'hard' });

  // 船龍骨與彎曲肋骨排
  const keelGeo = new THREE.BoxGeometry(1.2, 0.8, 18);
  const keel = new THREE.Mesh(keelGeo, woodMat);
  wreckGroup.add(keel);

  // 肋骨排 (Ribs)
  const ribGeo = new THREE.TorusGeometry(3.5, 0.35, 4, 8, Math.PI);
  ribGeo.rotateY(Math.PI / 2);
  for (let r = -6; r <= 6; r += 2) {
    const rib = new THREE.Mesh(ribGeo, woodMat);
    rib.position.set(0, 1.2, r * 1.2);
    wreckGroup.add(rib);
  }

  // 斷裂傾倒的主桅杆
  const mastGeo = new THREE.CylinderGeometry(0.25, 0.4, 8.5, 5);
  mastGeo.rotateX(Math.PI / 3);
  mastGeo.translate(0, 2.5, 1.5);
  const mast = new THREE.Mesh(mastGeo, woodMat);
  wreckGroup.add(mast);

  group.add(wreckGroup);
}

/** 建造浸沒科研水底艙房與管線 */
function buildSubmergedHabitat(group, x, y, z, rnd) {
  const habGroup = new THREE.Group();
  habGroup.position.set(x, y, z);
  habGroup.rotation.y = rnd() * Math.PI * 2;

  const metalMat = toonMat(PALETTE.ironWreck[0], { celMetal: true });
  const glowMat = toonPlain({ color: 0x00e5ff, transparent: true, opacity: 0.85 });

  // 觀察半球穹頂艙 (Observation Dome)
  const domeGeo = new THREE.SphereGeometry(3.6, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const dome = new THREE.Mesh(domeGeo, metalMat);
  dome.position.y = 1.2;
  habGroup.add(dome);

  // 發光舷窗圈 (Glowing Portholes)
  const portGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 6);
  portGeo.rotateX(Math.PI / 2);
  for (let p = 0; p < 5; p++) {
    const ang = (p / 5) * Math.PI * 2;
    const port = new THREE.Mesh(portGeo, glowMat);
    port.position.set(Math.cos(ang) * 3.2, 2.2, Math.sin(ang) * 3.2);
    port.rotation.y = -ang + Math.PI / 2;
    habGroup.add(port);
  }

  // 連接管線廊道 (Pipeline Tunnel)
  const pipeGeo = new THREE.CylinderGeometry(0.9, 0.9, 9.0, 7);
  pipeGeo.rotateZ(Math.PI / 2);
  pipeGeo.translate(4.5, 0.9, 0);
  const pipe = new THREE.Mesh(pipeGeo, metalMat);
  habGroup.add(pipe);

  group.add(habGroup);
}

/* =========================================================================
 * 6. 水面船艦航行與岸邊停泊 (Surface Vessels: Cruising & Moored)
 * ========================================================================= */

/**
 * 建立水面航行船艦與岸邊停泊小艇系統
 */
export function createSurfaceVessels(terrain, seed) {
  const wy = terrain?.waterY;
  if (wy == null) return null;
  const rnd = mulberry32((seed ^ 0x4C81EE) >>> 0);

  const { minX, maxX, minZ, maxZ } = terrain;
  const vesselGroup = new THREE.Group();

  const cruisers = [];
  const mooredBoats = [];

  // A. 巡弋船艦（1~3 艘沿閉合航道巡航）
  const numCruisers = Math.min(3, Math.max(1, Math.floor((maxX - minX) / 400)));
  for (let i = 0; i < numCruisers; i++) {
    // 尋找寬闊開闊水域中心
    let cx = 0, cz = 0, found = false;
    for (let t = 0; t < 35; t++) {
      const rx = minX + rnd() * (maxX - minX);
      const rz = minZ + rnd() * (maxZ - minZ);
      if (terrainEnvCode(terrain, rx, rz) === 1 && wy - terrain.heightAt(rx, rz) > 3.0) {
        cx = rx; cz = rz; found = true; break;
      }
    }
    if (!found) continue;

    const shipMesh = buildPatrolShipMesh();
    vesselGroup.add(shipMesh);

    // 建立破浪浪花網格 (Bow Wake Mesh)
    const wakeGeo = new THREE.PlaneGeometry(3.5, 6.0);
    wakeGeo.rotateX(-Math.PI / 2);
    const wakeMat = toonPlain({ color: 0xffffff, transparent: true, opacity: 0.75 });
    const wakeMesh = new THREE.Mesh(wakeGeo, wakeMat);
    wakeMesh.position.set(0, -0.15, -4.5);
    shipMesh.add(wakeMesh);

    cruisers.push({
      mesh: shipMesh,
      cx, cz,
      radius: 45 + rnd() * 35,
      speed: AQUATIC.SHIP_CRUISE_SPD * (0.85 + rnd() * 0.3),
      angle: rnd() * Math.PI * 2,
      rotDir: rnd() > 0.5 ? 1 : -1,
    });
  }

  // B. 停泊小艇（岸邊繫留搖擺）
  const maxMoored = 8;
  for (let i = 0; i < 60 && mooredBoats.length < maxMoored; i++) {
    const rx = minX + rnd() * (maxX - minX);
    const rz = minZ + rnd() * (maxZ - minZ);
    // 靠近岸邊的淺水區 (depth 0.6m ~ 1.8m)
    if (terrainEnvCode(terrain, rx, rz) === 1) {
      const depth = wy - terrain.heightAt(rx, rz);
      if (depth >= 0.6 && depth <= 2.2) {
        const boatMesh = buildDinghyMesh();
        boatMesh.position.set(rx, wy, rz);
        boatMesh.rotation.y = rnd() * Math.PI * 2;
        vesselGroup.add(boatMesh);

        mooredBoats.push({
          mesh: boatMesh,
          baseY: wy,
          phase: rnd() * Math.PI * 2,
          bobAmp: AQUATIC.BOAT_BOB_AMP * (0.8 + rnd() * 0.4),
        });
      }
    }
  }

  return {
    group: vesselGroup,
    step(dt, time) {
      // 1. 更新巡弋船艦位置、朝向與航跡
      for (const c of cruisers) {
        c.angle += (c.speed / c.radius) * c.rotDir * dt;
        const x = c.cx + Math.cos(c.angle) * c.radius;
        const z = c.cz + Math.sin(c.angle) * c.radius;
        const heading = c.angle + (c.rotDir > 0 ? Math.PI / 2 : -Math.PI / 2);

        c.mesh.position.set(x, wy + 0.1, z);
        c.mesh.rotation.y = heading;
        c.mesh.rotation.z = Math.sin(time * 2.2) * 0.04; // 航行橫搖
        c.mesh.rotation.x = Math.sin(time * 1.7) * 0.03; // 航行縱搖
      }

      // 2. 更新停泊小艇波浪浮動
      for (const b of mooredBoats) {
        const bob = Math.sin(time * AQUATIC.BOAT_BOB_FREQ + b.phase) * b.bobAmp;
        const roll = Math.cos(time * AQUATIC.BOAT_BOB_FREQ * 1.3 + b.phase) * 0.06;
        b.mesh.position.y = b.baseY + bob;
        b.mesh.rotation.z = roll;
      }
    },
    dispose() {
      // 遞迴清理船隻材質
      vesselGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    }
  };
}

/** 建造現代巡邏艇幾何群 */
function buildPatrolShipMesh() {
  const g = new THREE.Group();
  const hullMat = toonMat(PALETTE.patrolCamo[0], { celMetal: true });
  const cabinMat = toonMat(PALETTE.patrolCamo[1], { celMetal: true });
  const trimMat = toonMat(0xff9800, { bands: 'hard' });

  // 船體 (V-Hull)
  const hullGeo = new THREE.BoxGeometry(3.6, 1.8, 12.0);
  hullGeo.translate(0, 0.4, 0);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  g.add(hull);

  // 船艏銳角破浪錐
  const bowGeo = new THREE.ConeGeometry(1.8, 3.8, 4);
  bowGeo.rotateY(Math.PI / 4);
  bowGeo.rotateX(-Math.PI / 2);
  bowGeo.translate(0, 0.4, 6.8);
  const bow = new THREE.Mesh(bowGeo, hullMat);
  g.add(bow);

  // 駕駛艙上層建築
  const cabinGeo = new THREE.BoxGeometry(2.6, 1.6, 4.8);
  cabinGeo.translate(0, 1.8, -0.6);
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  g.add(cabin);

  // 雷達桅杆
  const mastGeo = new THREE.CylinderGeometry(0.1, 0.14, 2.2, 5);
  mastGeo.translate(0, 3.2, 0);
  const mast = new THREE.Mesh(mastGeo, trimMat);
  g.add(mast);

  return g;
}

/** 建造木造停泊小艇幾何群 */
function buildDinghyMesh() {
  const g = new THREE.Group();
  const woodMat = envMat(PALETTE.deckWood[0], { bands: 'soft' });

  const boatGeo = new THREE.BoxGeometry(1.6, 0.7, 3.8);
  boatGeo.translate(0, 0.25, 0);
  const boat = new THREE.Mesh(boatGeo, woodMat);
  g.add(boat);

  return g;
}

/* =========================================================================
 * 7. 水下與生態整合管線入口 (Main Aquatic World Manager)
 * ========================================================================= */

/**
 * 建立整套水下、沼澤、生態、遺跡與船艦系統
 * @param {THREE.Scene|THREE.Group} scene
 * @param {object} terrain
 * @param {object} env
 * @returns {object} { step(dt, time, camera), dispose() }
 */
export function buildAquaticWorld(scene, terrain, env) {
  const wy = terrain?.waterY;
  if (wy == null) {
    return {
      step() {},
      dispose() {}
    };
  }

  const seed = (Math.round((terrain.center?.lat ?? 0) * 1e4) * 31
    + Math.round((terrain.center?.lng ?? 0) * 1e4)) ^ 0x5E8B13;

  const rootGroup = new THREE.Group();
  rootGroup.name = 'aquatics_root';
  scene.add(rootGroup);

  // 1. 靜態地景：水生植物、珊瑚礁、沉船、潛艦、古代神殿遺跡、浸沒建築
  buildAquaticFlora(rootGroup, terrain, seed);
  buildSunkenRelics(rootGroup, terrain, seed);

  // 2. 動態子系統：氣泡、懸浮微粒、魚群、水母群、水面船艦
  const bubbleSys = createBubbleSystem(terrain, seed);
  if (bubbleSys) {
    bubbleSys.init();
    rootGroup.add(bubbleSys.group);
  }

  const detritusSys = createSuspendedDetritus(terrain, seed);
  if (detritusSys) {
    rootGroup.add(detritusSys.group);
  }

  const fishSys = createFishSchools(terrain, seed);
  if (fishSys) {
    rootGroup.add(fishSys.group);
  }

  const jellySys = createJellyfishFields(terrain, seed);
  if (jellySys) {
    rootGroup.add(jellySys.group);
  }

  const vesselSys = createSurfaceVessels(terrain, seed);
  if (vesselSys) {
    rootGroup.add(vesselSys.group);
  }

  return {
    group: rootGroup,
    step(dt, time, camera) {
      if (bubbleSys) bubbleSys.step(dt, time);
      if (detritusSys) detritusSys.step(dt, time);
      if (fishSys) fishSys.step(dt, time);
      if (jellySys) jellySys.step(dt, time);
      if (vesselSys) vesselSys.step(dt, time);
    },
    dispose() {
      if (bubbleSys) bubbleSys.dispose();
      if (detritusSys) detritusSys.dispose();
      if (fishSys) fishSys.dispose();
      if (jellySys) jellySys.dispose();
      if (vesselSys) vesselSys.dispose();
      rootGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      scene.remove(rootGroup);
    }
  };
}
