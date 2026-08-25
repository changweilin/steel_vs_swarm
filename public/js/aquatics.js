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
  // 沉船、潛艦、殘骸與遺跡
  subHull: [0x263238, 0x37474f, 0x1e272c],
  woodWreck: [0x4e342e, 0x3e2723, 0x5d4037],
  ironWreck: [0x546e7a, 0x455a64, 0x78909c],
  ruinsStone: [0x90a4ae, 0x78909c, 0x607d8b, 0xb0bec5],
  ancientAltar: [0x5c6b73, 0x47555e, 0x7b8f9a],
  relicRust: [0x8d493a, 0xa0522d, 0x6e3b2b],
  relicSteel: [0x3a4750, 0x4f5d68, 0x2c3539],
  relicLandStone: [0x8d7b68, 0x9e8b77, 0x7a6c5d],
  relicGlowCyan: 0x00e5ff,
  relicGlowAmber: 0xffb74d,
  relicContainer: [0xb71c1c, 0x0d47a1, 0xe65100, 0x2e7d32, 0x455a64, 0xf57f17],
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
 * 5. 水下巨型物件、潛艦、沈船、古代遺跡與現代殘骸型錄 (Sunken Features & Relic Catalog)
 * ========================================================================= */

export const RELIC_KINDS = {
  submarine: { name: '潛艦與深潛探測器', underwater: true, land: false, weight: 1.0, colR: 10 },
  ruins: { name: '古代神殿柱廊遺跡', underwater: true, land: true, weight: 1.2, colR: 11 },
  shipwreck: { name: '沈船殘骸', underwater: true, land: true, weight: 1.1, colR: 12 },
  habitat: { name: '水底科研艙房', underwater: true, land: true, weight: 1.0, colR: 9 },
  obelisk: { name: '古代方尖碑祭壇石環', underwater: true, land: true, weight: 1.1, colR: 11 },
  spire: { name: '廢棄哥德尖塔鐘樓', underwater: true, land: true, weight: 1.0, colR: 8 },
  titan: { name: '巨神雕像與守護石手', underwater: true, land: true, weight: 1.0, colR: 10 },
  battleship: { name: '鋼鐵戰艦船首與雙聯主砲', underwater: true, land: true, weight: 0.9, colR: 14 },
  crashedAirframe: { name: '墜毀重型飛行器殘骸', underwater: true, land: true, weight: 1.0, colR: 12 },
  deepSeaComplex: { name: '多節點科研基地與地熱渦輪', underwater: true, land: true, weight: 0.9, colR: 13 },
  cargoGantry: { name: '沉沒貨櫃群與桁架吊臂殘骸', underwater: true, land: true, weight: 1.0, colR: 10 },
  shrineTorii: { name: '沉沒鳥居水榭遺跡', underwater: true, land: true, weight: 1.0, colR: 9 },
  stupaRuin: { name: '失落古代佛塔舍利殿', underwater: true, land: true, weight: 0.9, colR: 10 },
  pyramidZiggurat: { name: '失落階梯金字塔神殿', underwater: true, land: true, weight: 1.0, colR: 14 },
  sunkenSlateRuin: { name: '台灣原住民石板屋遺址', underwater: true, land: true, weight: 1.0, colR: 9 },
  sunkenEgyptianPylon: { name: '古埃及沉沒塔門與紙莎草柱廳', underwater: true, land: true, weight: 0.9, colR: 13 },
  sunkenTongkonan: { name: '南島語族失落巨舟形屋架', underwater: true, land: true, weight: 1.0, colR: 10 },
  inuksukSite: { name: '極地/荒野守護石偶石陣', underwater: true, land: true, weight: 1.0, colR: 8 },
};

/** 依種類統一代碼建立遺跡/建築物件 */
export function buildRelicObject(kind, group, x, y, z, rnd, opts = {}) {
  switch (kind) {
    case 'submarine': return buildSubmarine(group, x, y, z, rnd, opts);
    case 'ruins': return buildSunkenRuins(group, x, y, z, rnd, opts);
    case 'shipwreck': return buildShipwreck(group, x, y, z, rnd, opts);
    case 'habitat': return buildSubmergedHabitat(group, x, y, z, rnd, opts);
    case 'obelisk': return buildObeliskAltarRing(group, x, y, z, rnd, opts);
    case 'spire': return buildSunkenSpire(group, x, y, z, rnd, opts);
    case 'titan': return buildColossalTitanVisage(group, x, y, z, rnd, opts);
    case 'battleship': return buildBattleshipWreck(group, x, y, z, rnd, opts);
    case 'crashedAirframe': return buildCrashedAirframe(group, x, y, z, rnd, opts);
    case 'deepSeaComplex': return buildDeepSeaComplex(group, x, y, z, rnd, opts);
    case 'cargoGantry': return buildCargoGantryWreck(group, x, y, z, rnd, opts);
    case 'shrineTorii': return buildSunkenShrineTorii(group, x, y, z, rnd, opts);
    case 'stupaRuin': return buildSunkenStupaRuin(group, x, y, z, rnd, opts);
    case 'pyramidZiggurat': return buildSunkenPyramidZiggurat(group, x, y, z, rnd, opts);
    case 'sunkenSlateRuin': return buildSunkenSlateRuin(group, x, y, z, rnd, opts);
    case 'sunkenEgyptianPylon': return buildSunkenEgyptianPylon(group, x, y, z, rnd, opts);
    case 'sunkenTongkonan': return buildSunkenTongkonan(group, x, y, z, rnd, opts);
    case 'inuksukSite': return buildInuksukSite(group, x, y, z, rnd, opts);
    default: return buildSunkenRuins(group, x, y, z, rnd, opts);
  }
}

/**
 * 建立水下世界之多元建築、潛艦、沈船、古代遺跡與現代殘骸
 */
export function buildSunkenRelics(parentGroup, terrain, seed) {
  const wy = terrain?.waterY;
  if (wy == null) return;
  const rnd = mulberry32((seed ^ 0x62B710) >>> 0);

  const { minX, maxX, minZ, maxZ } = terrain;
  const wSpan = maxX - minX, hSpan = maxZ - minZ;

  let relicCount = 0;
  const maxRelics = AQUATIC.MAX_UNDERWATER_PROPS;
  const underwaterKinds = Object.keys(RELIC_KINDS).filter((k) => RELIC_KINDS[k].underwater);

  for (let i = 0; i < 220 && relicCount < maxRelics; i++) {
    const x = minX + rnd() * wSpan;
    const z = minZ + rnd() * hSpan;
    const code = terrainEnvCode(terrain, x, z);
    const floorY = terrain.heightAt(x, z);

    // 水下深水區 (code === 1 && depth >= 3.0m)
    if (code === 1 && wy - floorY >= 3.0) {
      const kind = underwaterKinds[Math.floor(rnd() * underwaterKinds.length)];
      buildRelicObject(kind, parentGroup, x, floorY, z, rnd, { isLand: false });
      relicCount++;
    }
  }
}

/** 1. 建造水下潛艦與深海探測器 */
export function buildSubmarine(group, x, y, z, rnd, opts = {}) {
  const subGroup = new THREE.Group();
  subGroup.position.set(x, y + 0.6, z);
  subGroup.rotation.y = rnd() * Math.PI * 2;
  subGroup.rotation.z = (rnd() - 0.5) * 0.18; // 輕微擱淺傾斜

  const hullMat = toonMat(opts.isLand ? PALETTE.relicRust[0] : PALETTE.subHull[0], { celMetal: true });
  const trimMat = toonMat(0xffb300, { bands: 'soft' });
  const lightMat = toonPlain({ color: opts.isLand ? 0xffb74d : 0x00e5ff, transparent: true, opacity: 0.85 });

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

  // 艦首探照燈
  const lightGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.5, 6);
  lightGeo.rotateX(Math.PI / 2);
  lightGeo.translate(0, 0.4, 8.2);
  const light = new THREE.Mesh(lightGeo, lightMat);
  subGroup.add(light);

  group.add(subGroup);
  return subGroup;
}

/** 2. 建造古代沉沒/荒野神廟柱廊遺跡 */
export function buildSunkenRuins(group, x, y, z, rnd, opts = {}) {
  const ruinsGroup = new THREE.Group();
  ruinsGroup.position.set(x, y, z);
  ruinsGroup.rotation.y = rnd() * Math.PI * 2;

  const stoneCol = opts.isLand ? PALETTE.relicLandStone[0] : PALETTE.ruinsStone[0];
  const stoneMat = envMat(stoneCol, { bands: 'hard' });

  // 雙層石造基座台階
  const base1Geo = new THREE.BoxGeometry(16, 0.8, 12);
  const base1 = new THREE.Mesh(base1Geo, stoneMat);
  ruinsGroup.add(base1);

  const base2Geo = new THREE.BoxGeometry(14, 0.6, 10);
  base2Geo.translate(0, 0.7, 0);
  const base2 = new THREE.Mesh(base2Geo, stoneMat);
  ruinsGroup.add(base2);

  // 4~6 根石柱（部分站立、部分倒塌）
  const colGeo = new THREE.CylinderGeometry(0.65, 0.75, 5.5, 7);
  for (let c = 0; c < 6; c++) {
    const cx = (c % 3 - 1) * 5.0;
    const cz = (c < 3 ? -1 : 1) * 3.6;
    const isToppled = (c === 2 || c === 5) && rnd() < 0.65;

    const col = new THREE.Mesh(colGeo, stoneMat);
    if (isToppled) {
      col.position.set(cx + 1.2, 1.3, cz);
      col.rotation.set(Math.PI / 2, (rnd() - 0.5) * 0.4, 0);
    } else {
      col.position.set(cx, 3.75, cz);
      // 柱頂橫樑 (Architrave)
      if (c % 3 === 0 && rnd() < 0.7) {
        const archGeo = new THREE.BoxGeometry(5.2, 0.6, 1.2);
        archGeo.translate(2.5, 6.75, cz);
        const arch = new THREE.Mesh(archGeo, stoneMat);
        ruinsGroup.add(arch);
      }
    }
    ruinsGroup.add(col);
  }

  group.add(ruinsGroup);
  return ruinsGroup;
}

/** 3. 建造沈船殘骸（木造帆船或鋼鐵骨架） */
export function buildShipwreck(group, x, y, z, rnd, opts = {}) {
  const wreckGroup = new THREE.Group();
  wreckGroup.position.set(x, y, z);
  wreckGroup.rotation.y = rnd() * Math.PI * 2;
  wreckGroup.rotation.z = 0.28; // 側翻在海床或地表上

  const woodCol = opts.isLand ? PALETTE.woodWreck[1] : PALETTE.woodWreck[0];
  const woodMat = envMat(woodCol, { bands: 'hard' });
  const ironMat = toonMat(PALETTE.ironWreck[0], { celMetal: true });

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

  // 巨大生鏽鐵錨 (Heavy Anchor)
  const anchorGeo = new THREE.TorusGeometry(1.4, 0.2, 4, 8, Math.PI);
  anchorGeo.rotateX(Math.PI / 2);
  anchorGeo.translate(2.5, 0.4, 7.5);
  const anchor = new THREE.Mesh(anchorGeo, ironMat);
  wreckGroup.add(anchor);

  group.add(wreckGroup);
  return wreckGroup;
}

/** 4. 建造科研水底/荒野前哨艙房與管線 */
export function buildSubmergedHabitat(group, x, y, z, rnd, opts = {}) {
  const habGroup = new THREE.Group();
  habGroup.position.set(x, y, z);
  habGroup.rotation.y = rnd() * Math.PI * 2;

  const metalMat = toonMat(opts.isLand ? PALETTE.relicSteel[0] : PALETTE.ironWreck[0], { celMetal: true });
  const glowCol = opts.isLand ? PALETTE.relicGlowAmber : PALETTE.relicGlowCyan;
  const glowMat = toonPlain({ color: glowCol, transparent: true, opacity: 0.85 });

  // 觀察半球穹頂艙 (Observation Dome)
  const domeGeo = new THREE.SphereGeometry(3.6, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const dome = new THREE.Mesh(domeGeo, metalMat);
  dome.position.y = 1.2;
  habGroup.add(dome);

  // 4 根加固支撐桁架腳 (Support Legs)
  const legGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5);
  for (let l = 0; l < 4; l++) {
    const la = (l / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(legGeo, metalMat);
    leg.position.set(Math.cos(la) * 3.2, 0.4, Math.sin(la) * 3.2);
    leg.rotation.z = (Math.cos(la) > 0 ? -1 : 1) * 0.2;
    habGroup.add(leg);
  }

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
  return habGroup;
}

/** 5. 建造古代方尖碑與巨石祭壇環 (Sunken Obelisk & Megalithic Stone Ring) */
export function buildObeliskAltarRing(group, x, y, z, rnd, opts = {}) {
  const obGroup = new THREE.Group();
  obGroup.position.set(x, y, z);
  obGroup.rotation.y = rnd() * Math.PI * 2;

  const stoneCol = opts.isLand ? PALETTE.relicLandStone[1] : PALETTE.ancientAltar[0];
  const stoneMat = envMat(stoneCol, { bands: 'hard' });
  const glowCol = opts.isLand ? PALETTE.relicGlowAmber : PALETTE.relicGlowCyan;
  const runeMat = toonPlain({ color: glowCol, transparent: true, opacity: 0.9 });

  // 1. 八角形石造祭壇基座
  const plinthGeo = new THREE.CylinderGeometry(8.5, 9.5, 1.2, 8);
  const plinth = new THREE.Mesh(plinthGeo, stoneMat);
  plinth.position.y = 0.6;
  obGroup.add(plinth);

  // 2. 中央四角刻紋方尖碑 (Tapered Obelisk)
  const obeliskGeo = new THREE.CylinderGeometry(0.9, 1.8, 11.0, 4);
  obeliskGeo.rotateY(Math.PI / 4);
  obeliskGeo.translate(0, 6.2, 0);
  const obelisk = new THREE.Mesh(obeliskGeo, stoneMat);
  obGroup.add(obelisk);

  // 尖頂錐金字塔頂 (Pyramidion Apex)
  const pyrGeo = new THREE.ConeGeometry(1.28, 2.0, 4);
  pyrGeo.rotateY(Math.PI / 4);
  pyrGeo.translate(0, 12.4, 0);
  const pyr = new THREE.Mesh(pyrGeo, stoneMat);
  obGroup.add(pyr);

  // 方尖碑符文發光環
  const runeGeo = new THREE.BoxGeometry(2.3, 0.45, 2.3);
  runeGeo.translate(0, 4.5, 0);
  const runeRing = new THREE.Mesh(runeGeo, runeMat);
  obGroup.add(runeRing);

  // 3. 環形排列的 6 根巨石立柱與門楣 (Trilithons)
  const megalithGeo = new THREE.BoxGeometry(1.4, 4.2, 1.0);
  const lintelGeo = new THREE.BoxGeometry(3.6, 0.9, 1.2);

  for (let m = 0; m < 6; m++) {
    const ang = (m / 6) * Math.PI * 2;
    const mx = Math.cos(ang) * 6.6;
    const mz = Math.sin(ang) * 6.6;

    const standing = new THREE.Mesh(megalithGeo, stoneMat);
    standing.position.set(mx, 2.8, mz);
    standing.rotation.y = -ang + Math.PI / 2 + (rnd() - 0.5) * 0.15;
    if (m === 2 && rnd() < 0.6) {
      // 倒塌的巨石
      standing.position.y = 0.9;
      standing.rotation.set(Math.PI / 2, 0, ang);
    }
    obGroup.add(standing);

    // 每兩柱搭一片橫石板
    if (m % 2 === 0 && m !== 2) {
      const lintel = new THREE.Mesh(lintelGeo, stoneMat);
      lintel.position.set(mx * 0.95, 5.2, mz * 0.95);
      lintel.rotation.y = -ang;
      obGroup.add(lintel);
    }
  }

  group.add(obGroup);
  return obGroup;
}

/** 6. 建造沈沒/廢棄哥德尖塔與鐘樓 (Sunken Spire & Gothic Watchtower) */
export function buildSunkenSpire(group, x, y, z, rnd, opts = {}) {
  const spireGroup = new THREE.Group();
  spireGroup.position.set(x, y, z);
  spireGroup.rotation.y = rnd() * Math.PI * 2;
  spireGroup.rotation.z = (rnd() - 0.5) * 0.22; // 坍塌傾斜

  const stoneCol = opts.isLand ? PALETTE.relicLandStone[2] : PALETTE.ruinsStone[1];
  const stoneMat = envMat(stoneCol, { bands: 'hard' });
  const woodMat = envMat(PALETTE.woodWreck[0], { bands: 'hard' });

  // 1. 八角形厚重堡壘塔身 (Lower Tower Base)
  const baseTowerGeo = new THREE.CylinderGeometry(3.6, 4.4, 7.5, 8);
  baseTowerGeo.translate(0, 3.75, 0);
  const baseTower = new THREE.Mesh(baseTowerGeo, stoneMat);
  spireGroup.add(baseTower);

  // 2. 塔身中段拱形觀測窗與壁龕 (Arched Windows)
  const windowGeo = new THREE.BoxGeometry(0.8, 1.8, 1.2);
  for (let w = 0; w < 4; w++) {
    const wa = (w / 4) * Math.PI * 2;
    const win = new THREE.Mesh(windowGeo, stoneMat);
    win.position.set(Math.cos(wa) * 3.5, 4.8, Math.sin(wa) * 3.5);
    win.rotation.y = -wa + Math.PI / 2;
    spireGroup.add(win);
  }

  // 3. 塔頂外廊與雉堞垛口 (Crenellations)
  const rimGeo = new THREE.CylinderGeometry(4.0, 3.6, 1.2, 8);
  rimGeo.translate(0, 7.8, 0);
  const rim = new THREE.Mesh(rimGeo, stoneMat);
  spireGroup.add(rim);

  // 4. 斷裂傾塌的木石錐型尖頂 (Collapsed Conical Spire)
  const spireRoofGeo = new THREE.ConeGeometry(3.2, 8.0, 8);
  spireRoofGeo.rotateZ(0.35); // 嚴重折斷
  spireRoofGeo.translate(1.4, 11.5, 0);
  const spireRoof = new THREE.Mesh(spireRoofGeo, stoneMat);
  spireGroup.add(spireRoof);

  // 露出的木質樑架 (Exposed Timber Ribs)
  const beamGeo = new THREE.BoxGeometry(0.4, 5.5, 0.4);
  beamGeo.rotateZ(0.5);
  beamGeo.translate(0.5, 9.8, 1.0);
  const beam = new THREE.Mesh(beamGeo, woodMat);
  spireGroup.add(beam);

  group.add(spireGroup);
  return spireGroup;
}

/** 7. 建造巨神雕像與守護者石手 (Colossal Titan Visage & Guardian Relic) */
export function buildColossalTitanVisage(group, x, y, z, rnd, opts = {}) {
  const titanGroup = new THREE.Group();
  titanGroup.position.set(x, y, z);
  titanGroup.rotation.y = rnd() * Math.PI * 2;

  const stoneCol = opts.isLand ? PALETTE.relicLandStone[0] : PALETTE.ruinsStone[2];
  const stoneMat = envMat(stoneCol, { bands: 'hard' });
  const eyeCol = opts.isLand ? PALETTE.relicGlowAmber : PALETTE.relicGlowCyan;
  const eyeMat = toonPlain({ color: eyeCol, transparent: true, opacity: 0.85 });

  // 1. 半埋於地表的巨神面具/石雕頭部 (Giant Head / Mask)
  const headGroup = new THREE.Group();
  headGroup.position.set(-1.8, 1.8, 0);
  headGroup.rotation.set(-0.45, 0.25, -0.35); // 斜插在泥沙中

  const skullGeo = new THREE.BoxGeometry(5.2, 6.8, 4.4);
  const skull = new THREE.Mesh(skullGeo, stoneMat);
  headGroup.add(skull);

  // 眉骨與鼻樑浮雕
  const browGeo = new THREE.BoxGeometry(4.8, 1.2, 1.4);
  browGeo.translate(0, 1.4, 2.2);
  const brow = new THREE.Mesh(browGeo, stoneMat);
  headGroup.add(brow);

  const noseGeo = new THREE.BoxGeometry(1.1, 2.8, 1.5);
  noseGeo.translate(0, -0.2, 2.4);
  const nose = new THREE.Mesh(noseGeo, stoneMat);
  headGroup.add(nose);

  // 發光石雕眼眸 (Glow Eyes)
  const eyeGeo = new THREE.BoxGeometry(1.2, 0.5, 0.6);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-1.4, 1.0, 2.2);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(1.4, 1.0, 2.2);
  headGroup.add(eyeL);
  headGroup.add(eyeR);

  titanGroup.add(headGroup);

  // 2. 伸出地面的古代守護石手與殘劍 (Colossal Stone Hand & Broken Blade)
  const armGroup = new THREE.Group();
  armGroup.position.set(4.5, 0, 1.5);
  armGroup.rotation.set(0.2, 0, -0.3);

  // 手腕巨石
  const wristGeo = new THREE.CylinderGeometry(1.6, 2.0, 4.5, 6);
  wristGeo.translate(0, 2.0, 0);
  const wrist = new THREE.Mesh(wristGeo, stoneMat);
  armGroup.add(wrist);

  // 握拳手指 (Fingers)
  const fingerGeo = new THREE.BoxGeometry(1.8, 1.2, 3.4);
  fingerGeo.translate(0, 4.4, 0.4);
  const fingers = new THREE.Mesh(fingerGeo, stoneMat);
  armGroup.add(fingers);

  // 斜插的斷劍石柱 (Shattered Giant Blade)
  const swordGeo = new THREE.BoxGeometry(0.8, 8.5, 2.2);
  swordGeo.rotateX(0.4);
  swordGeo.translate(0, 4.2, 0);
  const sword = new THREE.Mesh(swordGeo, stoneMat);
  armGroup.add(sword);

  titanGroup.add(armGroup);

  group.add(titanGroup);
  return titanGroup;
}

/** 8. 建造鋼鐵戰艦船首與雙聯主砲塔 (Sunken Battleship Forecastle & Heavy Turret) */
export function buildBattleshipWreck(group, x, y, z, rnd, opts = {}) {
  const shipGroup = new THREE.Group();
  shipGroup.position.set(x, y, z);
  shipGroup.rotation.y = rnd() * Math.PI * 2;
  shipGroup.rotation.z = (rnd() - 0.5) * 0.15;

  const steelCol = opts.isLand ? PALETTE.relicRust[0] : PALETTE.ironWreck[0];
  const steelMat = toonMat(steelCol, { celMetal: true });
  const darkMat = toonMat(PALETTE.subHull[0], { celMetal: true });

  // 1. 楔形厚重裝甲船首 (Armored Prow)
  const prowGeo = new THREE.BoxGeometry(5.8, 4.5, 14.0);
  prowGeo.translate(0, 2.0, 2.0);
  const prow = new THREE.Mesh(prowGeo, steelMat);
  shipGroup.add(prow);

  // 破浪前尖艏
  const stemGeo = new THREE.ConeGeometry(3.0, 6.0, 4);
  stemGeo.rotateX(Math.PI / 2);
  stemGeo.translate(0, 2.0, 10.5);
  const stem = new THREE.Mesh(stemGeo, steelMat);
  shipGroup.add(stem);

  // 2. 雙聯裝重型主砲塔 (Twin-Gun Turret)
  const turretBaseGeo = new THREE.CylinderGeometry(2.6, 2.8, 1.2, 10);
  turretBaseGeo.translate(0, 4.5, 0);
  const turretBase = new THREE.Mesh(turretBaseGeo, darkMat);
  shipGroup.add(turretBase);

  const turretHouseGeo = new THREE.BoxGeometry(4.2, 2.2, 5.0);
  turretHouseGeo.translate(0, 5.8, -0.4);
  const turretHouse = new THREE.Mesh(turretHouseGeo, steelMat);
  shipGroup.add(turretHouse);

  // 雙聯長身管火砲（仰角朝天）
  const barrelGeo = new THREE.CylinderGeometry(0.35, 0.45, 9.5, 8);
  barrelGeo.rotateX(-Math.PI / 5); // 仰角 36 度
  barrelGeo.translate(-1.1, 7.8, 3.8);
  const barrelL = new THREE.Mesh(barrelGeo, darkMat);

  const barrelR = new THREE.Mesh(barrelGeo.clone(), darkMat);
  barrelR.position.x = 2.2;
  shipGroup.add(barrelL);
  shipGroup.add(barrelR);

  // 3. 粗大鐵錨鏈 (Anchor Chain)
  const chainGeo = new THREE.TorusGeometry(0.6, 0.15, 4, 6);
  for (let c = 0; c < 4; c++) {
    const link = new THREE.Mesh(chainGeo, darkMat);
    link.position.set(2.4, 2.8 - c * 0.6, 7.2 + c * 0.5);
    link.rotation.x = c * 0.8;
    shipGroup.add(link);
  }

  group.add(shipGroup);
  return shipGroup;
}

/** 9. 建造墜毀重型飛行器/運輸機殘骸 (Crashed Dropship / Aerial Wreckage) */
export function buildCrashedAirframe(group, x, y, z, rnd, opts = {}) {
  const wreckGroup = new THREE.Group();
  wreckGroup.position.set(x, y, z);
  wreckGroup.rotation.y = rnd() * Math.PI * 2;
  wreckGroup.rotation.x = 0.22; // 墜地俯衝仰角
  wreckGroup.rotation.z = -0.35; // 斷翼側翻

  const armorCol = opts.isLand ? PALETTE.relicRust[1] : PALETTE.subHull[1];
  const armorMat = toonMat(armorCol, { celMetal: true });
  const engineMat = toonMat(PALETTE.relicSteel[0], { celMetal: true });
  const canopyMat = toonPlain({ color: 0x80d8ff, transparent: true, opacity: 0.7 });

  // 1. 三角稜面機身機頭 (Faceted Fuselage)
  const noseGeo = new THREE.ConeGeometry(2.8, 12.0, 5);
  noseGeo.rotateX(-Math.PI / 2);
  noseGeo.translate(0, 1.8, 2.0);
  const nose = new THREE.Mesh(noseGeo, armorMat);
  wreckGroup.add(nose);

  // 駕駛艙天窗 (Canopy Glass)
  const canopyGeo = new THREE.BoxGeometry(1.6, 1.2, 3.6);
  canopyGeo.rotateX(-0.3);
  canopyGeo.translate(0, 3.2, 3.2);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  wreckGroup.add(canopy);

  // 2. 主翼（左翼完整、右翼折斷露出結構）
  const leftWingGeo = new THREE.BoxGeometry(8.5, 0.4, 4.2);
  leftWingGeo.translate(-4.8, 1.8, -1.5);
  const leftWing = new THREE.Mesh(leftWingGeo, armorMat);
  wreckGroup.add(leftWing);

  const brokenWingGeo = new THREE.BoxGeometry(3.5, 0.4, 3.2);
  brokenWingGeo.translate(2.2, 1.4, -1.2);
  const brokenWing = new THREE.Mesh(brokenWingGeo, armorMat);
  wreckGroup.add(brokenWing);

  // 3. 雙渦輪噴射引擎短艙 (Turbine Engine Pods)
  const engineGeo = new THREE.CylinderGeometry(1.1, 1.3, 5.5, 8);
  engineGeo.rotateX(Math.PI / 2);
  engineGeo.translate(-2.4, 2.2, -3.8);
  const engineL = new THREE.Mesh(engineGeo, engineMat);
  wreckGroup.add(engineL);

  const engineR = new THREE.Mesh(engineGeo.clone(), engineMat);
  engineR.position.x = 4.8;
  wreckGroup.add(engineR);

  // 尾部推進噴口
  const nozzleGeo = new THREE.CylinderGeometry(0.8, 1.1, 1.2, 7);
  nozzleGeo.rotateX(Math.PI / 2);
  nozzleGeo.translate(-2.4, 2.2, -6.8);
  const nozzle = new THREE.Mesh(nozzleGeo, engineMat);
  wreckGroup.add(nozzle);

  group.add(wreckGroup);
  return wreckGroup;
}

/** 10. 建造多節點科研基地複合體與地熱渦輪 (Deep Sea Complex & Habitat Node) */
export function buildDeepSeaComplex(group, x, y, z, rnd, opts = {}) {
  const complexGroup = new THREE.Group();
  complexGroup.position.set(x, y, z);
  complexGroup.rotation.y = rnd() * Math.PI * 2;

  const hullCol = opts.isLand ? PALETTE.relicSteel[1] : PALETTE.ironWreck[1];
  const hullMat = toonMat(hullCol, { celMetal: true });
  const glowCol = opts.isLand ? PALETTE.relicGlowAmber : PALETTE.relicGlowCyan;
  const glowMat = toonPlain({ color: glowCol, transparent: true, opacity: 0.85 });

  // 1. 中央六角主控核心模組 (Hex Central Hub)
  const hubGeo = new THREE.CylinderGeometry(3.6, 4.2, 3.8, 6);
  hubGeo.translate(0, 2.2, 0);
  const hub = new THREE.Mesh(hubGeo, hullMat);
  complexGroup.add(hub);

  // 核心發光觀測環 (Observation Belt)
  const ringGeo = new THREE.CylinderGeometry(3.8, 3.8, 0.6, 6);
  ringGeo.translate(0, 2.8, 0);
  const ring = new THREE.Mesh(ringGeo, glowMat);
  complexGroup.add(ring);

  // 2. 兩座外伸球型生活艙 (Flanking Bio-Domes)
  const domeGeo = new THREE.SphereGeometry(2.4, 8, 6);
  const tunnelGeo = new THREE.CylinderGeometry(0.75, 0.75, 5.0, 6);
  tunnelGeo.rotateZ(Math.PI / 2);

  for (const side of [-1, 1]) {
    // 連通管廊
    const tunnel = new THREE.Mesh(tunnelGeo, hullMat);
    tunnel.position.set(side * 4.0, 1.8, 0);
    complexGroup.add(tunnel);

    // 生活球艙
    const dome = new THREE.Mesh(domeGeo, hullMat);
    dome.position.set(side * 6.8, 2.0, 0);
    complexGroup.add(dome);

    // 舷窗光圈
    const domeGlow = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 6), glowMat);
    domeGlow.position.set(side * 6.8, 3.6, 0);
    complexGroup.add(domeGlow);
  }

  // 3. 豎直地熱發電/抽水渦輪塔 (Power Turbine Stack)
  const stackGeo = new THREE.CylinderGeometry(1.2, 1.8, 7.5, 8);
  stackGeo.translate(0, 5.5, -4.5);
  const stack = new THREE.Mesh(stackGeo, hullMat);
  complexGroup.add(stack);

  // 頂部旋翼散熱格柵 (Turbine Blades)
  const bladeGeo = new THREE.BoxGeometry(4.4, 0.25, 1.0);
  bladeGeo.translate(0, 9.4, -4.5);
  const blade = new THREE.Mesh(bladeGeo, hullMat);
  complexGroup.add(blade);

  group.add(complexGroup);
  return complexGroup;
}

/** 11. 建造沉沒貨櫃群與桁架吊臂殘骸 (Cargo Containers & Gantry Crane) */
export function buildCargoGantryWreck(group, x, y, z, rnd, opts = {}) {
  const gantryGroup = new THREE.Group();
  gantryGroup.position.set(x, y, z);
  gantryGroup.rotation.y = rnd() * Math.PI * 2;

  const craneCol = opts.isLand ? PALETTE.relicRust[0] : PALETTE.ironWreck[0];
  const craneMat = toonMat(craneCol, { celMetal: true });
  const containerCols = PALETTE.relicContainer;

  // 1. 錯落堆疊的 3~4 個標準貨櫃箱 (Standard Containers)
  const boxGeo = new THREE.BoxGeometry(3.0, 2.6, 6.5);
  for (let c = 0; c < 3; c++) {
    const cCol = containerCols[(c + Math.floor(rnd() * containerCols.length)) % containerCols.length];
    const cMat = toonMat(cCol, { bands: 'hard' });
    const cont = new THREE.Mesh(boxGeo, cMat);

    if (c === 0) {
      cont.position.set(0, 1.3, 0);
    } else if (c === 1) {
      cont.position.set(2.8, 1.3, 0.8);
      cont.rotation.y = 0.15;
    } else {
      cont.position.set(1.2, 3.8, -0.4);
      cont.rotation.y = -0.22;
      cont.rotation.z = 0.08; // 斜靠在上層
    }
    gantryGroup.add(cont);
  }

  // 2. 倒塌傾覆的重型鋼構桁架吊臂 (Twisted Lattice Gantry Arm)
  const trussGeo = new THREE.BoxGeometry(1.6, 14.0, 1.6);
  trussGeo.rotateZ(Math.PI / 3); // 60 度傾倒
  trussGeo.translate(2.5, 4.0, -3.5);
  const truss = new THREE.Mesh(trussGeo, craneMat);
  gantryGroup.add(truss);

  // 吊臂橫樑與捲揚滑輪組 (Winch Drum)
  const drumGeo = new THREE.CylinderGeometry(0.9, 0.9, 1.8, 8);
  drumGeo.rotateX(Math.PI / 2);
  drumGeo.translate(6.5, 6.8, -3.5);
  const drum = new THREE.Mesh(drumGeo, craneMat);
  gantryGroup.add(drum);

  group.add(gantryGroup);
  return gantryGroup;
}

/** 12. 建造沉沒鳥居水榭遺跡 (Sunken Shinto Torii & Water Shrine Relic) */
export function buildSunkenShrineTorii(group, x, y, z, rnd, opts = {}) {
  const toriiGroup = new THREE.Group();
  toriiGroup.position.set(x, y, z);
  toriiGroup.rotation.y = rnd() * Math.PI * 2;
  toriiGroup.rotation.z = (rnd() - 0.5) * 0.16; // 輕微傾斜

  const woodCol = opts.isLand ? PALETTE.woodWreck[1] : 0xb73a2b; // 沉水朱紅
  const toriiMat = toonMat(woodCol, { bands: 'hard' });
  const stoneCol = opts.isLand ? PALETTE.relicLandStone[0] : PALETTE.ruinsStone[0];
  const stoneMat = envMat(stoneCol, { bands: 'hard' });

  // 1. 水中半埋石基座 (Sunken Stone Plinth)
  const baseGeo = new THREE.BoxGeometry(14.0, 0.8, 12.0);
  const base = new THREE.Mesh(baseGeo, stoneMat);
  toriiGroup.add(base);

  // 2. 雙柱與笠木 (Torii Pillars & Kasagi)
  const pGeo = new THREE.CylinderGeometry(0.4, 0.45, 7.2, 8);
  for (const sx of [-3.4, 3.4]) {
    const pillar = new THREE.Mesh(pGeo, toriiMat);
    pillar.position.set(sx, 3.6, 0);
    toriiGroup.add(pillar);
  }

  // 頂部彎曲笠木與島木
  const kasagiGeo = new THREE.BoxGeometry(9.4, 0.6, 0.8);
  kasagiGeo.translate(0, 7.3, 0);
  const kasagi = new THREE.Mesh(kasagiGeo, toriiMat);
  toriiGroup.add(kasagi);

  const nukiGeo = new THREE.BoxGeometry(8.0, 0.4, 0.4);
  nukiGeo.translate(0, 5.6, 0);
  const nuki = new THREE.Mesh(nukiGeo, toriiMat);
  toriiGroup.add(nuki);

  // 3. 水底風化石燈籠與祭壇 (Sunken Toro Lantern)
  for (const sx of [-4.2, 4.2]) {
    const lanGeo = new THREE.CylinderGeometry(0.35, 0.45, 2.6, 6);
    const lan = new THREE.Mesh(lanGeo, stoneMat);
    lan.position.set(sx, 1.3, -3.2);
    toriiGroup.add(lan);
  }

  group.add(toriiGroup);
  return toriiGroup;
}

/** 13. 建造失落古代佛塔舍利殿 (Sunken Ancient Stupa Sanctuary) */
export function buildSunkenStupaRuin(group, x, y, z, rnd, opts = {}) {
  const stupaGroup = new THREE.Group();
  stupaGroup.position.set(x, y, z);
  stupaGroup.rotation.y = rnd() * Math.PI * 2;
  stupaGroup.rotation.z = (rnd() - 0.5) * 0.18;

  const stoneCol = opts.isLand ? PALETTE.relicLandStone[1] : PALETTE.ruinsStone[1];
  const stoneMat = envMat(stoneCol, { bands: 'hard' });
  const goldMat = toonMat(0xc7a13d, { celMetal: true });
  const glowCol = opts.isLand ? PALETTE.relicGlowAmber : PALETTE.relicGlowCyan;
  const glowMat = toonPlain({ color: glowCol, transparent: true, opacity: 0.85 });

  // 1. 雙層風化多邊形基座
  const plinth1 = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 8.5, 1.2, 8), stoneMat);
  plinth1.position.y = 0.6;
  stupaGroup.add(plinth1);

  const plinth2 = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 6.4, 1.0, 8), stoneMat);
  plinth2.position.y = 1.7;
  stupaGroup.add(plinth2);

  // 2. 圓頂覆缽 (Dome Anda)
  const domeGeo = new THREE.SphereGeometry(4.2, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, stoneMat);
  dome.position.y = 2.2;
  stupaGroup.add(dome);

  // 3. 傾斜的金屬天宮與相輪剎 (Spire)
  const harmika = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 2.2), stoneMat);
  harmika.position.set(0, 6.8, 0);
  harmika.rotation.z = 0.25; // 斷裂傾斜
  stupaGroup.add(harmika);

  const mastGeo = new THREE.CylinderGeometry(0.2, 0.35, 5.2, 7);
  mastGeo.rotateZ(0.25);
  mastGeo.translate(0.6, 9.8, 0);
  const mast = new THREE.Mesh(mastGeo, goldMat);
  stupaGroup.add(mast);

  // 舍利發光核心
  const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 6), glowMat);
  jewel.position.set(0.6, 12.6, 0);
  stupaGroup.add(jewel);

  group.add(stupaGroup);
  return stupaGroup;
}

/** 14. 建造失落階梯金字塔巨石神廟 (Sunken Stepped Ziggurat Pyramid) */
export function buildSunkenPyramidZiggurat(group, x, y, z, rnd, opts = {}) {
  const pyrGroup = new THREE.Group();
  pyrGroup.position.set(x, y, z);
  pyrGroup.rotation.y = rnd() * Math.PI * 2;

  const stoneCol = opts.isLand ? PALETTE.relicLandStone[2] : PALETTE.ancientAltar[0];
  const stoneMat = envMat(stoneCol, { bands: 'hard' });
  const glowCol = opts.isLand ? PALETTE.relicGlowAmber : PALETTE.relicGlowCyan;
  const runeMat = toonPlain({ color: glowCol, transparent: true, opacity: 0.85 });

  // 1. 三層退縮巨石階梯 (Stepped Ziggurat Base)
  const step1 = new THREE.Mesh(new THREE.BoxGeometry(22, 2.6, 22), stoneMat);
  step1.position.y = 1.3;
  pyrGroup.add(step1);

  const step2 = new THREE.Mesh(new THREE.BoxGeometry(16, 2.6, 16), stoneMat);
  step2.position.y = 3.9;
  pyrGroup.add(step2);

  const step3 = new THREE.Mesh(new THREE.BoxGeometry(11, 2.6, 11), stoneMat);
  step3.position.y = 6.5;
  pyrGroup.add(step3);

  // 2. 頂層神殿房間 (Summit Temple)
  const shrine = new THREE.Mesh(new THREE.BoxGeometry(6.8, 3.6, 6.8), stoneMat);
  shrine.position.y = 9.6;
  pyrGroup.add(shrine);

  // 頂部發光符文眼飾 (Rune Portal Motif)
  const rune = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.4), runeMat);
  rune.position.set(0, 10.2, 3.5);
  pyrGroup.add(rune);

  // 3. 正面巨大通天石階 (Front Stone Staircase)
  const stairGeo = new THREE.BoxGeometry(4.2, 10.5, 10.5);
  stairGeo.rotateX(-0.6);
  stairGeo.translate(0, 5.2, 6.2);
  const stair = new THREE.Mesh(stairGeo, stoneMat);
  pyrGroup.add(stair);

  group.add(pyrGroup);
  return pyrGroup;
}

/** 15. 建造台灣原住民石板屋遺址 (Sunken Indigenous Slate House Relic) */
export function buildSunkenSlateRuin(group, x, y, z, rnd, opts = {}) {
  const slateGroup = new THREE.Group();
  slateGroup.position.set(x, y, z);
  slateGroup.rotation.y = rnd() * Math.PI * 2;
  slateGroup.rotation.z = (rnd() - 0.5) * 0.14;

  const stoneCol = opts.isLand ? 0x2e3338 : 0x1f262b; // 黑色板岩
  const slateMat = envMat(stoneCol, { bands: 'hard' });
  const glowCol = opts.isLand ? PALETTE.relicGlowAmber : PALETTE.relicGlowCyan;
  const runeMat = toonPlain({ color: glowCol, transparent: true, opacity: 0.85 });

  // 1. 半埋疊砌板岩基座與崩塌殘牆
  const base = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 12), slateMat);
  slateGroup.add(base);

  const wallL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 8.5), slateMat);
  wallL.position.set(-5.2, 1.1, -1.0);
  slateGroup.add(wallL);

  const wallR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 8.5), slateMat);
  wallR.position.set(5.2, 0.8, -1.0);
  wallR.rotation.z = -0.15; // 傾倒殘牆
  slateGroup.add(wallR);

  // 2. 崩塌斜靠的巨型石板屋頂片 (Collapsed Slate Roof Slab)
  const roofGeo = new THREE.BoxGeometry(12.0, 0.4, 9.0);
  roofGeo.rotateX(0.35);
  roofGeo.rotateZ(0.18);
  roofGeo.translate(-1.0, 2.5, -1.5);
  const roof = new THREE.Mesh(roofGeo, slateMat);
  slateGroup.add(roof);

  // 3. 祖靈圖騰石柱 (Ancestral Totem Pillar)
  const totem = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 4.2, 6), slateMat);
  totem.position.set(3.5, 2.1, 3.8);
  totem.rotation.z = 0.12;
  slateGroup.add(totem);

  const eyeGlow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 0.8), runeMat);
  eyeGlow.position.set(3.5, 3.4, 3.8);
  slateGroup.add(eyeGlow);

  group.add(slateGroup);
  return slateGroup;
}

/** 16. 建造古埃及沉沒塔門與紙莎草柱廳 (Sunken Egyptian Pylon & Hypostyle Hall) */
export function buildSunkenEgyptianPylon(group, x, y, z, rnd, opts = {}) {
  const pylonGroup = new THREE.Group();
  pylonGroup.position.set(x, y, z);
  pylonGroup.rotation.y = rnd() * Math.PI * 2;

  const stoneCol = opts.isLand ? PALETTE.relicLandStone[0] : PALETTE.ancientAltar[0];
  const stoneMat = envMat(stoneCol, { bands: 'hard' });
  const goldMat = toonMat(0xc7a13d, { celMetal: true });

  // 1. 厚重梯形塔門 (單側殘存 + 另一側斷裂)
  const pylonL = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.8, 12.0, 4), stoneMat);
  pylonL.rotation.y = Math.PI / 4;
  pylonL.position.set(-6.5, 6.0, 6.0);
  pylonGroup.add(pylonL);

  const pylonR = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.8, 6.5, 4), stoneMat);
  pylonR.rotation.y = Math.PI / 4;
  pylonR.rotation.z = 0.22; // 折斷傾覆
  pylonR.position.set(6.5, 3.25, 6.0);
  pylonGroup.add(pylonR);

  // 2. 門楣太陽盤金飾殘片 (Winged Sun Disc Fragment)
  const sun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9), goldMat);
  sun.position.set(-2.0, 7.5, 6.2);
  pylonGroup.add(sun);

  // 3. 紙莎草柱廳殘柱 (Papyrus Columns in Hall)
  for (const [sx, sz] of [[-4.5, -3], [4.5, -3], [-4.5, 1], [4.5, 1]]) {
    const colH = 6.0 + (sx < 0 ? 3.5 : 0);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, colH, 8), stoneMat);
    col.position.set(sx, colH / 2, sz);
    pylonGroup.add(col);
    if (sx < 0) { // 完整柱頭
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.6, 1.2, 8), stoneMat);
      cap.position.set(sx, colH + 0.6, sz);
      pylonGroup.add(cap);
    }
  }

  group.add(pylonGroup);
  return pylonGroup;
}

/** 17. 建造南島語族失落巨舟形屋架 (Sunken Austronesian Tongkonan Frame) */
export function buildSunkenTongkonan(group, x, y, z, rnd, opts = {}) {
  const tongGroup = new THREE.Group();
  tongGroup.position.set(x, y, z);
  tongGroup.rotation.y = rnd() * Math.PI * 2;
  tongGroup.rotation.z = (rnd() - 0.5) * 0.16;

  const woodCol = opts.isLand ? PALETTE.woodWreck[0] : PALETTE.woodWreck[1];
  const woodMat = toonMat(woodCol, { bands: 'hard' });

  // 1. 高架木樁排 (Stilt Posts)
  for (const sx of [-2.8, 2.8]) {
    for (const sz of [-4.0, 0, 4.0]) {
      const stilt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 4.2, 6), woodMat);
      stilt.position.set(sx, 2.1, sz);
      tongGroup.add(stilt);
    }
  }

  // 2. 巨大弧形船骨架主樑 (Upswept Boat Keel & Rafters)
  const keelGeo = new THREE.CylinderGeometry(3.6, 3.6, 18.0, 8, 1, false, 0, Math.PI);
  keelGeo.rotateX(Math.PI / 2);
  keelGeo.scale(0.8, 1.4, 0.8);
  keelGeo.translate(0, 6.8, 0);
  const keel = new THREE.Mesh(keelGeo, woodMat);
  tongGroup.add(keel);

  // 3. 上翹的巨形尖舟船首桅骨 (Soaring Boat Prows)
  const prowF = new THREE.Mesh(new THREE.ConeGeometry(1.8, 6.8, 4), woodMat);
  prowF.rotation.x = 0.72;
  prowF.position.set(0, 9.8, 9.2);
  tongGroup.add(prowF);

  const prowB = new THREE.Mesh(new THREE.ConeGeometry(1.8, 4.8, 4), woodMat);
  prowB.rotation.x = -0.65;
  prowB.position.set(0, 8.8, -9.2);
  tongGroup.add(prowB);

  group.add(tongGroup);
  return tongGroup;
}

/** 18. 建造極地/荒野守護石偶石陣 (Inuksuk Sentinel Cairns Site) */
export function buildInuksukSite(group, x, y, z, rnd, opts = {}) {
  const inuksukGroup = new THREE.Group();
  inuksukGroup.position.set(x, y, z);
  inuksukGroup.rotation.y = rnd() * Math.PI * 2;

  const stoneCol = opts.isLand ? PALETTE.relicLandStone[1] : 0x37474f;
  const stoneMat = envMat(stoneCol, { bands: 'hard' });
  const glowCol = opts.isLand ? PALETTE.relicGlowAmber : PALETTE.relicGlowCyan;
  const glowMat = toonPlain({ color: glowCol, transparent: true, opacity: 0.85 });

  // 1. 中央巨型守護石偶 (Main Inuksuk / Inunnguaq)
  const mainCairn = new THREE.Group();
  for (const lx of [-0.6, 0.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.8), stoneMat);
    leg.position.set(lx, 0.9, 0);
    mainCairn.add(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.1), stoneMat);
  torso.position.set(0, 2.5, 0);
  mainCairn.add(torso);

  const arms = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 0.9), stoneMat);
  arms.position.set(0, 3.45, 0);
  mainCairn.add(arms);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), stoneMat);
  head.position.set(0, 4.15, 0);
  mainCairn.add(head);

  // 頂部守護光石
  const crownStone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4), glowMat);
  crownStone.position.set(0, 4.85, 0);
  mainCairn.add(crownStone);

  inuksukGroup.add(mainCairn);

  // 2. 環繞小型導引石堆 (Satellite Votive Cairns)
  for (const [sx, sz] of [[-4.5, -3.2], [4.8, -2.5], [0, 4.2]]) {
    const subCairn = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.1, 2.2, 5), stoneMat);
    subCairn.position.set(sx, 1.1, sz);
    inuksukGroup.add(subCairn);
  }

  group.add(inuksukGroup);
  return inuksukGroup;
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
