// ============ 設定頁的「樣品」畫面(art-direction 拉桿的即時預覽)============
// 拉桿如果沒有樣品,玩家得「拉一下 → 關掉選單 → 看戰場 → 再開回來」,而陰影偏色這種
// 色相層級的差異在那個來回之間根本記不住 —— 不給樣品等於不給拉桿。
//
// **樣品 MUST 走真品材質**(`toonMat` / `envMat` / `postfx.Pipeline`),MUST NOT 另寫一份
// 「看起來差不多」的 2D 塗色:那就是同一個場景兩套明暗規則(§2.1 的老病),而且症狀是
// 「樣品調好了、進戰場不是那樣」—— 玩家只會覺得這個設定壞了。
//
// 成本:一顆額外的 WebGL context(480×270),只在設定頁開著時存在,`dispose()` 一律
// 連 renderer 一起收(A25)。低功耗/觸控走 8bit RT,與戰場同一條降級規則。
import * as THREE from 'three';
import { toonMat, envMat, updateCelLight, disposeTree } from './toon.js';
import { Pipeline } from './postfx.js';
import { onVisualChange, visualPref } from './visualPrefs.js';
import { lowPower, isTouchUI } from './mobile.js';
import { makeUnit } from './models.js';
import { charKind } from './data.js';
import { applyEnvironment } from './environment.js';
import {
  buildShowcasePatch, findShowcaseSite, showcaseAnchorSite,
  LONDON_SHOWCASE_UNITS, GAME_SHOWCASE_SITES,
  dressingTree, dressingMound, bakeShowcaseSeaDepth,
} from './showcase.js';
import { seaSoft, swampSoft, stepCelWind, stepSwampRipples } from './toon.js';

const W = 480, H = 270;

// 樣品的鍵光方向(世界空間;**這一盞燈與 `uCelLightDir` 同吃這一個常數**,分家的話
// ramp 的階落在一邊、硬邊高光與 CEL_COOL 的暗面落在另一邊)。
//
// **MUST NOT 是「從相機肩膀上打過去」的光**(2026-08-04 使用者回報「機體陰影、環境陰影
// 調整時,展示樣品看不出差異」的另一半原因):偏色只作用在 ramp 的**暗階**上,而舊制的
// (0.4, 0.8, 0.4) 幾乎與視線同向 ⇒ 逐像素量測(照抄本檔場景離線複刻整條像素鏈:
// ramp → rim/metal/cool → postfx grade → sRGB)得到的暗階佔比是
//   地面 0%(整片壓在**最亮**階 = 偏色的定義值就是 0)、岩塊 0%、機甲臂 0%、機甲球 1%
// —— 也就是說,這根拉桿控制的那一階在畫面上**幾乎不存在**,不管拉到哪裡都一樣。
// 改成側後方鍵光之後:地面 100% 落到中間階(吃得到偏色)、岩塊 80% / 機甲臂 55% /
// 機甲球 19% 進暗階,全畫面「看得出來在動」的像素比從 6% → 23%。
const SUN_DIR = new THREE.Vector3(0.9, 0.42, -0.35).normalize();

// 樣品自己的景深帶(公尺)。
const DOF_NEAR = 16.0, DOF_FAR = 38.0;
const BG_Z = -8.5;   // 背景排的 z

// 開闊大氣透視霧帶與霧色（空氣透視示範對象，配合 240m 實機場地視野，不再鎖在 44m 封閉暗盒）
const FOG_NEAR = 35.0, FOG_FAR = 220.0;
const FOG_FAR_C = new THREE.Color(0x6e8499);    // 遠景大氣透視淡青色
const FOG_NEAR_C = new THREE.Color(0x384a5c);
const PREVIEW_ENV_SPAN = 240.0;                 // 與實機地圖同尺度，讓天頂穹頂與雲層環繞
const DEFAULT_PREVIEW_ENV = Object.freeze({ season: 'summer', time: 'day', weather: 'clear' });

const DEMO_SCENES = [
  { id: 'mech', name: '🤖 機體' },
  { id: 'shore', name: '🏖️ 海灘遺跡' },
  { id: 'swamp', name: '🌿 沼澤遺跡' },
  { id: 'tree', name: '🌲 樹木鳥群' },
  { id: 'biome', name: '🏞️ 地貌遺跡' },
];

export class MatSample {
  /** @param mount 要掛 canvas 的容器 */
  constructor(mount, { terrain = null, terrains = null, env = null } = {}) {
    this.mount = mount;
    this._sceneIdx = 0;
    this._mats = [];
    this._geos = [];
    this._running = true;
    this._time = 0;
    this._lastTime = performance.now();
    this._rafId = null;
    this._terrainSources = new Array(DEMO_SCENES.length).fill(null);
    this.terrainSources = this._terrainSources;
    this.terrainSites = new Array(DEMO_SCENES.length).fill(null);
    this.terrainSite = null;
    this._terrainGroups = new Array(DEMO_SCENES.length).fill(null);
    this._patchData = new Array(DEMO_SCENES.length).fill(null);
    this._envConfig = env || DEFAULT_PREVIEW_ENV;
    this.envFx = null;
    this._flatGrounds = [];
    this._waterSurfaces = [];
    this._showcaseUnits = [];

    // 場景切換列 (固定在預覽上方)
    this.switcher = document.createElement('div');
    this.switcher.className = 'vset-scenes';
    this._sceneBtns = DEMO_SCENES.map((sc, idx) => {
      const b = document.createElement('button');
      b.className = 'vset-scene-btn' + (idx === 0 ? ' on' : '');
      b.type = 'button';
      b.textContent = sc.name;
      b.addEventListener('click', () => this.setScene(idx));
      this.switcher.appendChild(b);
      return b;
    });
    mount.appendChild(this.switcher);

    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.canvas.className = 'vset-sample';
    mount.appendChild(this.canvas);

    this.roster = document.createElement('div');
    this.roster.className = 'vset-roster';
    for (const spec of LONDON_SHOWCASE_UNITS) {
      const item = document.createElement('div');
      item.innerHTML = `<b>${spec.label}</b><span>${spec.note}</span>`;
      this.roster.appendChild(item);
    }
    mount.appendChild(this.roster);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG_FAR_C.clone(), FOG_NEAR, FOG_FAR);

    // 寬視角高機位：遠剪裁面隨 span * 2.2 動態展開，讓天空穹頂、遠景地平線全貌盡收眼底且不被遠面裁切
    this.camera = new THREE.PerspectiveCamera(48, W / H, 0.5, PREVIEW_ENV_SPAN * 2.2);
    this.camera.position.set(0, 4.6, 11.8);
    this.camera.lookAt(0, 1.9, 0);

    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.copy(SUN_DIR).multiplyScalar(20);
    this.scene.add(sun, new THREE.AmbientLight(0x556070, 0.55));

    // ── 1. 機體展示台 (機甲本體、懸浮伴隨機、戰術台座與環境巨岩) ──
    const mechM = toonMat(0x8d97a6, { celMetal: true });
    const mechArmorM = toonMat(0x3a6a8c);
    const mechGlowM = toonMat(0x38bdf8, { celMetal: true });
    const envM = envMat(0x6f7a63, { wash: 0.55, cool: 0.5, moss: { amount: 0.85 }, preview: true });
    const pedMat = envMat(0x28323e, { wash: 0.3, cool: 0.5 });
    const droneMat = toonMat(0xd4dbe4, { celMetal: true });
    this._mats.push(mechM, mechArmorM, mechGlowM, envM, pedMat, droneMat);

    this._gMech = new THREE.Group();

    // 機體主軀幹與關節
    const mech = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 24), mechM);
    mech.position.set(-2.2, 1.4, 0);
    const mechChest = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), mechArmorM);
    mechChest.position.set(-2.2, 2.1, 0.2);
    const mechVisor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.6), mechGlowM);
    mechVisor.position.set(-2.2, 2.3, 0.85);

    const mechArm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.8), mechM);
    mechArm.position.set(-1.0, 1.3, 0.6);
    mechArm.rotation.set(0.3, -0.4, 0.2);

    const mechArmL = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.8), mechM);
    mechArmL.position.set(-3.4, 1.2, 0.4);
    mechArmL.rotation.set(0.2, 0.3, -0.15);

    // 機體展示底座 (同心圓台)
    const pedGeo = new THREE.CylinderGeometry(2.4, 2.6, 0.35, 24);
    const ped = new THREE.Mesh(pedGeo, pedMat);
    ped.position.set(-2.2, 0.18, 0);

    const pedRingGeo = new THREE.RingGeometry(2.1, 2.3, 32);
    const pedRing = new THREE.Mesh(pedRingGeo, mechGlowM);
    pedRing.position.set(-2.2, 0.36, 0);
    pedRing.rotation.x = -Math.PI / 2;

    // 懸浮伴隨機 (伴隨懸浮巡弋)
    const droneGeo = new THREE.ConeGeometry(0.4, 0.8, 4);
    droneGeo.rotateX(Math.PI / 2);
    const drone = new THREE.Mesh(droneGeo, droneMat);
    drone.position.set(-0.4, 3.4, 1.2);

    // 環境岩塊與背景地物
    const rock = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.2, 3.0), envM);
    rock.position.set(2.4, 1.4, 0);
    rock.rotation.y = 0.6;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24),
      envMat(0x4b5646, { wash: 0.5, cool: 0.5, rim: 0, bands: 4, moss: { amount: 0.8 }, preview: true }));
    ground.rotation.x = -Math.PI / 2;
    this._mats.push(ground.material);

    const bgGeo = new THREE.BoxGeometry(1, 1, 1);
    const bg = [[-5.2, 2.4, 1.8], [-0.4, 3.2, 2.0], [4.8, 2.2, 1.6]].map(([x, h, w]) => {
      const m = new THREE.Mesh(bgGeo, envM);
      m.position.set(x, h / 2, BG_Z);
      m.scale.set(w, h, w);
      m.rotation.y = x * 0.11;
      return m;
    });

    this._geos = [mech.geometry, mechArm.geometry, rock.geometry, ground.geometry, bgGeo];
    this._geos.push(
      mechChest.geometry, mechVisor.geometry, mechArmL.geometry,
      pedGeo, pedRingGeo, droneGeo
    );

    const legacyMech = new THREE.Group();
    legacyMech.visible = false;
    legacyMech.add(mech, mechChest, mechVisor, mechArm, mechArmL, ped, pedRing, drone, rock, ground, ...bg);
    this._gMech.add(legacyMech);
    this._mechAnims = { core: mech, chest: mechChest, visor: mechVisor, armL: mechArmL, armR: mechArm, ring: pedRing, drone };

    // 機體樣品直接走正式 makeUnit()；縮小後三台仍保留戰場剪影、掛件與材質。
    const unitScale = 0.64;
    const unitX = [-3.45, 0, 3.45];
    this._showcaseUnits = LONDON_SHOWCASE_UNITS.map((spec, i) => {
      const { group } = makeUnit(`hero:${charKind(spec.id)}`, spec.side,
        { ring: true, ch: spec.id });
      group.scale.setScalar(unitScale);
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group);
      const item = { ...spec, group, phase: i * 1.9, x: unitX[i], baseY: -box.min.y, hover: spec.hover * unitScale };
      group.position.set(item.x, item.baseY + item.hover, 0.2);
      this._gMech.add(group);
      return item;
    });
    this._flatGrounds.push(ground);

    // ── 2. 海灘與水中遺跡 (海灘斜坡、清澈海水、水中石柱遺跡、沉沒艦體與浪花脈動) ──
    this._gShore = new THREE.Group();
    {
      const sandM = envMat(0xdac8a2, { wash: 0.5, cool: 0.35 });
      const rockM = envMat(0x6c726a, { wash: 0.45, moss: { amount: 0.4 } });
      const waterM = envMat(0x18485e, {
        bands: 'soft', rim: 0, transparent: true, opacity: 0.86, side: THREE.DoubleSide,
        soft: seaSoft(),
      });
      const relicM = toonMat(0x7e8884, { bands: 'soft' });
      const hullM = toonMat(0x3e5262, { celMetal: true });
      this._mats.push(sandM, rockM, waterM, relicM, hullM);

      // 海灘沙地
      const beach = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 26), sandM);
      beach.position.set(-6.0, 0.7, 0);
      this._flatGrounds.push(beach);

      // 清澈水體（備援用，具備動態海浪波紋與 seaFade）
      const wCols = 32, wRows = 24;
      const waterGeo = new THREE.PlaneGeometry(18, 26, wCols, wRows);
      const seaFade = new Float32Array((wCols + 1) * (wRows + 1)).fill(1.0);
      waterGeo.setAttribute('seaFade', new THREE.BufferAttribute(seaFade, 1));
      const water = new THREE.Mesh(waterGeo, waterM);
      water.position.set(7.5, 0.5, 0);
      water.rotation.x = -Math.PI / 2;
      this._waterSurfaces.push(water);

      // 水中古石柱遺跡 1 (挺立高古柱)
      const pillar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.75, 4.4, 16), relicM);
      pillar1.position.set(4.4, 2.0, -1.5);

      // 水中古石柱遺跡 2 (傾斜半沉柱)
      const pillar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 3.6, 16), relicM);
      pillar2.position.set(6.4, 1.4, 2.2);
      pillar2.rotation.z = 0.32;

      // 水下沉沒艦體
      const subGeo = new THREE.CapsuleGeometry(1.0, 4.2, 8, 16);
      subGeo.rotateX(Math.PI / 2);
      const subHull = new THREE.Mesh(subGeo, hullM);
      subHull.position.set(8.2, 0.65, -0.2);
      subHull.rotation.set(0.12, -0.4, 0.08);

      this._geos.push(beach.geometry, waterGeo, pillar1.geometry, pillar2.geometry, subGeo);
      this._gShore.add(beach, water, pillar1, pillar2, subHull);
      this._shoreAnims = { subHull };
    }

    // ── 3. 沼澤與水中遺跡 (泥濘濕地、墨綠水體、青苔古柱、沉沒殘骸與風吹蘆葦) ──
    this._gSwamp = new THREE.Group();
    {
      const mudM = envMat(0x363c2c, { wash: 0.65, moss: { amount: 0.95 } });
      const swampWaterM = envMat(0x193622, {
        wash: 0.85, cool: 0.6, bands: 'soft', rim: 0, transparent: true, opacity: 0.86, side: THREE.DoubleSide,
        soft: swampSoft(),
      });
      const swampRelicM = toonMat(0x4c564a, { bands: 'soft' });
      const swampHullM = toonMat(0x28382c, { celMetal: true });
      const reedM = envMat(0x3e5e2a);
      this._mats.push(mudM, swampWaterM, swampRelicM, swampHullM, reedM);

      // 泥濘濕地陸塊
      const mudBank = new THREE.Mesh(new THREE.BoxGeometry(11, 1.3, 26), mudM);
      mudBank.position.set(-5.5, 0.65, 0);
      this._flatGrounds.push(mudBank);

      // 沼澤水體（備援用，具備沼澤漣漪與撕裂波紋）
      const swCols = 32, swRows = 24;
      const sWaterGeo = new THREE.PlaneGeometry(18, 26, swCols, swRows);
      const sSeaFade = new Float32Array((swCols + 1) * (swRows + 1)).fill(1.0);
      sWaterGeo.setAttribute('seaFade', new THREE.BufferAttribute(sSeaFade, 1));
      const swampWater = new THREE.Mesh(sWaterGeo, swampWaterM);
      swampWater.position.set(7.5, 0.5, 0);
      swampWater.rotation.x = -Math.PI / 2;
      this._waterSurfaces.push(swampWater);

      // 沼澤古石柱
      const sPillar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.75, 4.2, 16), swampRelicM);
      sPillar1.position.set(4.5, 1.6, -1.2);

      const sPillar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 3.4, 16), swampRelicM);
      sPillar2.position.set(6.2, 1.2, 1.8);
      sPillar2.rotation.z = 0.32;

      // 沉沒銹蝕艙體
      const sHullGeo = new THREE.CapsuleGeometry(0.95, 4.0, 8, 16);
      sHullGeo.rotateX(Math.PI / 2);
      const sHull = new THREE.Mesh(sHullGeo, swampHullM);
      sHull.position.set(7.8, 0.6, -0.4);
      sHull.rotation.set(0.12, -0.38, 0.08);

      // 蘆葦叢群落
      const reeds = [];
      const reedGeo = new THREE.CylinderGeometry(0.04, 0.07, 2.2, 6);
      this._geos.push(reedGeo);
      const reedPos = [
        [0.6, 1.1, -2.2], [0.9, 1.2, -1.6], [0.5, 1.0, 2.4], [1.0, 1.1, 2.8],
        [3.4, 0.9, -3.2], [6.0, 0.8, -2.8], [-0.2, 1.2, 0.8], [0.3, 1.1, -0.6],
      ];
      for (let i = 0; i < reedPos.length; i++) {
        const [rx, ry, rz] = reedPos[i];
        const rm = new THREE.Mesh(reedGeo, reedM);
        rm.position.set(rx, ry, rz);
        rm.rotation.set(0.1, i * 0.8, 0.1);
        reeds.push(rm);
      }

      this._geos.push(mudBank.geometry, sWaterGeo, sPillar1.geometry, sPillar2.geometry, sHullGeo);
      this._gSwamp.add(mudBank, swampWater, sPillar1, sPillar2, sHull, ...reeds);
      this._swampAnims = { sHull, reeds };
    }

    // ── 4. 樹木植被與群鳥翱翔 (實機巨樹神木、立體葉冠群、葉片卡與巡航鳥群) ──
    this._gTree = new THREE.Group();
    {
      const groundTM = envMat(0x3d5636, { wash: 0.55, moss: { amount: 0.8 } });
      const woodM = envMat(0x563e2a, { wash: 0.25, cool: 0.1 });
      const leafM = envMat(0x32622b, { wash: 0.65, cool: 0.4 });
      const leafM2 = envMat(0x3f7236, { wash: 0.7, cool: 0.35 });
      const cardM = envMat(0x447c38);
      const birdM = toonMat(0x283038);
      this._mats.push(groundTM, woodM, leafM, leafM2, cardM, birdM);

      const groundT = new THREE.Mesh(new THREE.PlaneGeometry(28, 28), groundTM);
      groundT.rotation.x = -Math.PI / 2;
      this._flatGrounds.push(groundT);

      // 主神木樹幹 (實機 GIANT_DEFS 紅杉風格：基部板根、漸縮主幹與向上分枝)
      const trunkGroup = new THREE.Group();
      trunkGroup.position.set(-1.4, 0, 0);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.25, 5.4, 10), woodM);
      trunk.position.y = 2.7;
      trunkGroup.add(trunk);

      for (const [ang, rz] of [[0, 0.25], [2.1, -0.2], [4.2, 0.22]]) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 3), woodM);
        fin.position.set(Math.cos(ang) * 0.95, 1.1, Math.sin(ang) * 0.95);
        fin.rotation.y = ang;
        fin.rotation.z = rz;
        trunkGroup.add(fin);
      }

      const bough1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5), woodM);
      bough1.position.set(0.7, 3.8, 0.2);
      bough1.rotation.z = -0.75;
      trunkGroup.add(bough1);

      const bough2 = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, 1.9, 5), woodM);
      bough2.position.set(-0.65, 4.2, -0.3);
      bough2.rotation.z = 0.7;
      trunkGroup.add(bough2);

      // 多層次受光葉冠群（實機 icosahedron 多面體葉簇，告別圓球）
      const canopyGeo1 = new THREE.IcosahedronGeometry(2.3, 1);
      canopyGeo1.scale(1.4, 0.65, 1.35);
      const canopy1 = new THREE.Mesh(canopyGeo1, leafM);
      canopy1.position.set(-1.4, 4.9, 0);

      const canopyGeo2 = new THREE.IcosahedronGeometry(1.7, 1);
      canopyGeo2.scale(1.2, 0.7, 1.15);
      const canopy2 = new THREE.Mesh(canopyGeo2, leafM2);
      canopy2.position.set(-0.5, 5.8, 0.4);

      const canopyGeo3 = new THREE.IcosahedronGeometry(1.3, 1);
      canopyGeo3.scale(1.1, 0.75, 1.1);
      const canopy3 = new THREE.Mesh(canopyGeo3, leafM);
      canopy3.position.set(-2.2, 5.3, -0.3);

      const canopyTopGeo = new THREE.IcosahedronGeometry(1.0, 1);
      canopyTopGeo.scale(0.9, 0.85, 0.9);
      const canopyTop = new THREE.Mesh(canopyTopGeo, leafM2);
      canopyTop.position.set(-1.3, 6.7, 0.1);

      // 葉片卡 (在主要葉冠邊緣隨風輕顫)
      const leafCards = [];
      const cardGeo = new THREE.PlaneGeometry(0.75, 0.75);
      this._geos.push(cardGeo);
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2;
        const c = new THREE.Mesh(cardGeo, cardM);
        c.position.set(-1.4 + Math.cos(ang) * 2.4, 4.6 + (i % 3) * 0.6, Math.sin(ang) * 2.4);
        c.rotation.set(0.3, ang, 0.2);
        leafCards.push(c);
      }

      // 周圍配景：實機 conifer2 老雲杉群落
      dressingTree(this._gTree, 3.2, -3.8, 1.3, () => 0, woodM, leafM);
      dressingTree(this._gTree, -4.8, -2.6, 1.15, () => 0, woodM, leafM);
      dressingTree(this._gTree, 5.6, 1.0, 0.95, () => 0, woodM, leafM2);
      dressingTree(this._gTree, -3.6, 3.2, 0.85, () => 0, woodM, leafM2);

      // 飛翔鳥群 (具備左右雙翼，可模擬真實拍翼動作)
      const birds = [];
      const birdBodyGeo = new THREE.ConeGeometry(0.12, 0.6, 5);
      birdBodyGeo.rotateX(Math.PI / 2);
      const wingGeo = new THREE.PlaneGeometry(0.45, 0.25);
      wingGeo.translate(0.22, 0, 0);
      this._geos.push(birdBodyGeo, wingGeo);

      for (let i = 0; i < 5; i++) {
        const bGroup = new THREE.Group();
        const body = new THREE.Mesh(birdBodyGeo, birdM);
        const wingL = new THREE.Mesh(wingGeo, birdM);
        wingL.position.set(0, 0.05, 0);
        const wingR = new THREE.Mesh(wingGeo, birdM);
        wingR.position.set(0, 0.05, 0);
        wingR.rotation.y = Math.PI;

        bGroup.add(body, wingL, wingR);
        bGroup.userData = { wingL, wingR, phase: i * 0.9, radius: 2.3 + (i % 3) * 0.7, height: 5.1 + i * 0.4, speed: 0.9 + i * 0.1 };
        birds.push(bGroup);
      }

      this._geos.push(
        groundT.geometry, trunk.geometry, canopyGeo1, canopyGeo2, canopyGeo3, canopyTopGeo
      );
      this._gTree.add(groundT, trunkGroup, canopy1, canopy2, canopy3, canopyTop, ...leafCards, ...birds);
      this._birdMeshes = birds;
      this._leafCardMeshes = leafCards;
      this._treeAnims = { trunk: trunkGroup, canopy1, canopy2, leafCards, birds };
    }

    // ── 5. 地貌分界、太魯閣峽谷峭壁與地標遺跡 ──
    this._gBiome = new THREE.Group();
    {
      const grassM = envMat(0x3a5a32, { wash: 0.6, moss: { amount: 0.9 } });
      const desertM = envMat(0x7e684a, { wash: 0.45, cool: 0.35 });
      const seamM = envMat(0x24321c, { wash: 0.2 });
      const monolithM = envMat(0x626c6d, { wash: 0.35, cool: 0.3, land: true });
      const monolithM2 = envMat(0x75807e, { wash: 0.45, cool: 0.25, land: true });
      const bannerM = toonMat(0x3b82f6);
      this._mats.push(grassM, desertM, seamM, monolithM, monolithM2, bannerM);

      const gGrass = new THREE.Mesh(new THREE.PlaneGeometry(14, 28), grassM);
      gGrass.position.set(-7, 0, 0);
      gGrass.rotation.x = -Math.PI / 2;

      const gDesert = new THREE.Mesh(new THREE.PlaneGeometry(14, 28), desertM);
      gDesert.position.set(7, 0, 0);
      gDesert.rotation.x = -Math.PI / 2;

      const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 28), seamM);
      seam.position.set(0, 0.02, 0);
      seam.rotation.x = -Math.PI / 2;
      this._flatGrounds.push(gGrass, gDesert, seam);

      // 宏偉巨岩石階 1（實機 MEGALITHS 峽谷峭壁階地，多面沉積岩層）
      const m1 = new THREE.Group();
      const m1Base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, 2.2, 8), monolithM);
      m1Base.position.y = 1.1;
      const m1Mid = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.65, 2.4, 7), monolithM2);
      m1Mid.position.set(0.1, 3.2, -0.1);
      m1Mid.rotation.y = 0.4;
      const m1Top = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.25, 1.8, 7), monolithM);
      m1Top.position.set(0.2, 5.1, -0.15);
      m1Top.rotation.y = -0.3;
      m1.add(m1Base, m1Mid, m1Top);
      m1.position.set(-2.4, 0, 0.5);
      m1.rotation.y = 0.3;

      // 宏偉巨岩石碑 2（多面角錐石柱）
      const m2 = new THREE.Group();
      const m2Base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, 2.8, 7), monolithM);
      m2Base.position.y = 1.4;
      const m2Top = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.4, 3.0, 7), monolithM2);
      m2Top.position.set(-0.1, 4.1, 0.1);
      m2Top.rotation.y = 0.5;
      m2.add(m2Base, m2Top);
      m2.position.set(2.8, 0, -1.2);
      m2.rotation.y = -0.4;

      // 背景遠景峭壁
      const bgMono = new THREE.Group();
      const bgRock1 = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.6, 6.8, 8), monolithM);
      bgRock1.position.y = 3.4;
      const bgRock2 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.5, 5.2, 7), monolithM2);
      bgRock2.position.set(2.4, 2.6, 0.8);
      bgMono.add(bgRock1, bgRock2);
      bgMono.position.set(0, 0, BG_Z);

      // 自然散佈風化巨石（DodecahedronGeometry）
      for (const [x, z, r] of [[-0.6, 1.2, 0.75], [1.2, 2.4, 0.9], [4.5, -0.5, 1.1], [-4.2, -1.8, 1.2]]) {
        dressingMound(this._gBiome, x, z, r, r * 0.85, () => 0, monolithM2);
      }

      // 遺跡旗幟 (立於高地石台頂峰，隨風飄揚)
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 6), monolithM);
      flagPole.position.set(-2.2, 5.8, 0.35);
      const flagBanner = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.75), bannerM);
      flagBanner.position.set(-1.55, 7.5, 0.35);

      this._geos.push(
        gGrass.geometry, gDesert.geometry, seam.geometry, m1Base.geometry, m1Mid.geometry, m1Top.geometry,
        m2Base.geometry, m2Top.geometry, bgRock1.geometry, bgRock2.geometry, flagPole.geometry, flagBanner.geometry
      );
      this._gBiome.add(gGrass, gDesert, seam, m1, m2, bgMono, flagPole, flagBanner);
      this._seamMesh = seam;
      this._biomeAnims = { flagBanner, m1, m2 };
    }

    this._sceneGroups = [this._gMech, this._gShore, this._gSwamp, this._gTree, this._gBiome];
    this.scene.add(...this._sceneGroups);
    this._gShore.visible = false;
    this._gSwamp.visible = false;
    this._gTree.visible = false;
    this._gBiome.visible = false;

    const initialTerrains = Array.isArray(terrains)
      ? terrains
      : terrain ? DEMO_SCENES.map(() => terrain) : null;
    this.setTerrains(initialTerrains);

    // 背景直接借用戰場同一套天空/雲/天氣；樣品的地面霧帶仍保留，讓空氣透視旋鈕在小視口裡可見。
    const envSource = this._terrainSources.find(Boolean);
    const envTerrain = {
      worldW: PREVIEW_ENV_SPAN,
      worldH: PREVIEW_ENV_SPAN,
      center: envSource?.center || { lat: 25.0, lng: 0.0 },
      heightAt: (x, z) => this._terrainSources[this._sceneIdx]?.heightAt?.(x, z) ?? 0,
    };
    this.envFx = applyEnvironment(this.scene, envTerrain, this._envConfig, {
      lowPower: lowPower() || isTouchUI(),
      backgroundOnly: true,
    });
    // applyEnvironment 的穹頂與 scene.background 都保留，讓預覽的背景和戰場走同一條天空路徑。
    this.scene.fog = new THREE.Fog(FOG_FAR_C.clone(), FOG_NEAR, FOG_FAR);

    // 勾線/調色走真品後製管線
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, {
      lowPower: lowPower() || isTouchUI(),
    });
    this.pipeline.setDof(DOF_NEAR, DOF_FAR);
    const air = this.envFx?.air;
    if (air) {
      this.pipeline.setAirFog(air.near, air.far, air.fogNear, air.fogFar);
    } else {
      this.pipeline.setAirFog(FOG_NEAR_C, FOG_FAR_C, FOG_NEAR, FOG_FAR);
    }

    this._draw = () => this.render();
    this._off = onVisualChange(this._draw);

    // 啟動實時平滑動畫循環
    this._animate = (timestamp) => {
      if (!this._running) return;
      const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1);
      this._lastTime = timestamp;
      this._time += dt;

      this.update(this._time, dt);
      this.render();

      this._rafId = requestAnimationFrame(this._animate);
    };
    this._rafId = requestAnimationFrame(this._animate);
  }

  /** 五個樣品各吃自己的實機空間地形；地形只屬展示，不進戰場碰撞。 */
  setTerrains(terrains) {
    const next = Array.isArray(terrains) ? terrains : [];
    let changed = false;
    for (let i = 0; i < DEMO_SCENES.length; i++) {
      const source = next[i]?.heightAt ? next[i] : null;
      if (source === this._terrainSources[i]) continue;
      changed = true;
      if (this._terrainGroups[i]) {
        this.scene.remove(this._terrainGroups[i]);
        disposeTree(this._terrainGroups[i]);
        this._terrainGroups[i] = null;
      }
      this._terrainSources[i] = source;
      this.terrainSites[i] = null;
      if (!source) continue;

      const spec = GAME_SHOWCASE_SITES[i] || GAME_SHOWCASE_SITES[0];
      const siteMode = spec.terrain === 'heath' ? 'relief' : spec.water ? 'wet' : spec.terrain === 'forest' ? 'green' : 'flat';
      const built = buildShowcasePatch(source, {
        site: source.showcaseSite || findShowcaseSite(source, siteMode) || showcaseAnchorSite(source),
        style: spec.terrain,
        water: spec.water,
      });
      built.group.renderOrder = -2;
      built.group.visible = i === this._sceneIdx;
      this._terrainGroups[i] = built.group;
      this.terrainSites[i] = built.site;
      this._patchData[i] = built;
      this.scene.add(built.group);
      if (source.group) {
        disposeTree(source.group);
        source.group = null;
      }
      if (i === 0) {
        for (const item of this._showcaseUnits) item.terrainY = built.localYAt(item.x, 0);
      }
    }
    const hasTerrain = this._terrainSources.some(Boolean);
    this._flatGrounds.forEach((ground) => { ground.visible = !hasTerrain; });
    this._waterSurfaces.forEach((water) => { water.visible = !hasTerrain; });
    this.terrainSite = this.terrainSites[this._sceneIdx];
    const curPatch = this._patchData[this._sceneIdx];
    if (curPatch && curPatch.waterY != null) {
      bakeShowcaseSeaDepth(curPatch.localYAt, curPatch.waterY);
    } else if (this._sceneIdx === 1 || this._sceneIdx === 2) {
      bakeShowcaseSeaDepth((x, z) => (x < 0 ? 0.7 : -1.2), 0.5);
    }
    if (changed && this.pipeline) this.render();
  }

  /** 單一地形的相容入口；新流程使用 setTerrains。 */
  setTerrain(terrain, sceneIdx = 0) {
    const terrains = this._terrainSources.slice();
    terrains[sceneIdx] = terrain;
    this.setTerrains(terrains);
  }

  /** 切換展示場景 */
  setScene(idx) {
    if (idx < 0 || idx >= this._sceneGroups.length) return;
    this._sceneIdx = idx;
    this._sceneBtns.forEach((b, i) => b.classList.toggle('on', i === idx));
    this._sceneGroups.forEach((g, i) => { g.visible = (i === idx); });
    this._terrainGroups.forEach((g, i) => { if (g) g.visible = i === idx; });
    this.terrainSite = this.terrainSites[idx] || null;
    if (this.roster) this.roster.hidden = idx !== 0;
    const patch = this._patchData[idx];
    if (patch && patch.waterY != null) {
      bakeShowcaseSeaDepth(patch.localYAt, patch.waterY);
    } else if (idx === 1 || idx === 2) {
      bakeShowcaseSeaDepth((x, z) => (x < 0 ? 0.7 : -1.2), 0.5);
    }
    this.onSceneChange?.(idx);
    this.render();
  }

  /** 每幀更新實機動態演出 */
  update(t, dt = 0) {
    stepCelWind(dt);
    if (this._gSwamp?.visible) {
      stepSwampRipples([{ x: 0, z: 0 }], dt);
    }
    this.envFx?.update(dt, this.camera, t);
    const air = this.envFx?.air;
    if (air && this.pipeline) {
      this.pipeline.setAirFog(air.near, air.far, air.fogNear, air.fogFar);
    }

    // 1. 機體展示台動態 (機甲浮動呼吸、伴隨機巡弋繞行、底座光環旋轉)
    if (this._mechAnims && this._gMech.visible) {
      const { core, chest, visor, armL, armR, ring, drone } = this._mechAnims;
      const bob = Math.sin(t * 2.0) * 0.06;
      core.position.y = 1.4 + bob;
      chest.position.y = 2.1 + bob;
      visor.position.y = 2.3 + bob;
      armL.position.y = 1.2 + bob;
      armR.position.y = 1.3 + bob;
      armL.rotation.x = 0.2 + Math.sin(t * 1.5) * 0.05;
      armR.rotation.x = 0.3 - Math.sin(t * 1.5) * 0.05;

      ring.rotation.z = t * 0.4;
      drone.position.set(-2.2 + Math.cos(t * 1.4) * 2.0, 3.4 + Math.sin(t * 2.2) * 0.2, Math.sin(t * 1.4) * 1.6);
      drone.rotation.y = -t * 1.4;

      for (const item of this._showcaseUnits) {
        item.group.position.y = item.baseY + (item.terrainY || 0) + item.hover + Math.sin(t * 1.45 + item.phase) * 0.025;
        item.group.rotation.y = Math.sin(t * 0.42 + item.phase) * 0.10;
      }
    }

    // 2. 海灘浪花動態 (沉船微晃；海面動態波浪與岸邊泡沫由 toon.js 著色器深度場自動演算)
    if (this._shoreAnims && this._gShore.visible) {
      const { subHull } = this._shoreAnims;
      if (subHull) subHull.rotation.z = 0.08 + Math.sin(t * 1.2) * 0.03;
    }

    // 3. 沼澤濕地動態 (蘆葦迎風搖擺；沼澤波紋與底泥起伏由 toon.js 著色器深度場自動演算)
    if (this._swampAnims && this._gSwamp.visible) {
      const { reeds } = this._swampAnims;
      if (reeds) {
        for (let i = 0; i < reeds.length; i++) {
          reeds[i].rotation.z = 0.1 + Math.sin(t * 2.6 + i * 0.7) * 0.14;
        }
      }
    }

    // 4. 樹林與群鳥動態 (樹木冠層隨風微動、鳥群盤旋翱翔與雙翼拍動)
    if (this._treeAnims && this._gTree.visible) {
      const { trunk, canopy1, canopy2, leafCards, birds } = this._treeAnims;
      const wind = Math.sin(t * 1.8) * 0.035;
      trunk.rotation.z = wind * 0.5;
      canopy1.rotation.z = wind;
      canopy2.rotation.z = wind * 1.2;

      for (let i = 0; i < leafCards.length; i++) {
        leafCards[i].rotation.z = 0.2 + Math.sin(t * 2.2 + i) * 0.06;
      }

      for (const b of birds) {
        const { wingL, wingR, phase, radius, height, speed } = b.userData;
        const ang = t * speed + phase;
        b.position.set(-1.4 + Math.cos(ang) * radius, height + Math.sin(ang * 2) * 0.35, Math.sin(ang) * radius);
        b.rotation.y = -ang + Math.PI / 2;
        b.rotation.z = -0.15; // 轉彎傾角

        const flap = Math.sin(t * 14.0 + phase) * 0.55;
        wingL.rotation.z = flap;
        wingR.rotation.z = -flap;
      }
    }

    // 5. 地貌與遺跡動態 (旗幟迎風舞動)
    if (this._biomeAnims && this._gBiome.visible) {
      const { flagBanner } = this._biomeAnims;
      flagBanner.rotation.y = Math.sin(t * 3.6) * 0.25;
      flagBanner.scale.x = 1.0 + Math.sin(t * 4.2) * 0.1;
    }
  }

  render() {
    if (!this.renderer) return;

    // 依目前視覺偏好微調預覽物件 (鳥群密度/水面泡沫/葉片卡)
    const birdDens = visualPref('birds');
    if (this._birdMeshes) {
      for (const bm of this._birdMeshes) bm.visible = birdDens > 0;
    }
    const foamPref = visualPref('foam');
    if (this._foamMeshes) {
      for (const fm of this._foamMeshes) fm.visible = foamPref > 0;
    }
    const leafPref = visualPref('leafCard');
    if (this._leafCardMeshes) {
      for (const lm of this._leafCardMeshes) lm.visible = leafPref !== 'off';
    }

    updateCelLight(this.camera, SUN_DIR);
    this.pipeline.render();
  }

  /** A25:renderer / RT / 材質 / 幾何一個都不能漏(設定頁一開一關就是一顆 context) */
  dispose() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._off?.();
    this._off = null;
    this.envFx?.dispose();
    this.envFx = null;
    this.pipeline?.dispose();
    for (const m of this._mats) m.dispose();
    for (const g of this._geos) g.dispose();
    for (const item of this._showcaseUnits) disposeTree(item.group);
    for (const group of this._terrainGroups) if (group) disposeTree(group);
    this.renderer?.dispose();
    this.renderer = null;
    this.switcher?.remove();
    this.canvas?.remove();
  }
}
