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
import {
  buildShowcasePatch, findShowcaseSite, showcaseAnchorSite,
  LONDON_SHOWCASE_UNITS, LONDON_SHOWCASE_SITES,
} from './showcase.js';

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
const DOF_NEAR = 11.0, DOF_FAR = 15.5;
const BG_Z = -5.5;   // 背景排的 z(與 DOF_FAR 一起挑的:那一排 MUST 落在全糊帶裡)

// 樣品自己的霧帶與兩個霧色(「空氣透視」那根拉桿的示範對象)—— 尺度兩軌、規則一份。
const FOG_NEAR = 5.0, FOG_FAR = 44.0;
const FOG_FAR_C = new THREE.Color(0x0f1622);    // MUST === scene.background
const FOG_NEAR_C = new THREE.Color(0x4a3a2a);

const DEMO_SCENES = [
  { id: 'mech', name: '🤖 機體' },
  { id: 'shore', name: '🏖️ 海灘遺跡' },
  { id: 'swamp', name: '🌿 沼澤遺跡' },
  { id: 'tree', name: '🌲 樹木鳥群' },
  { id: 'biome', name: '🏞️ 地貌遺跡' },
];

export class MatSample {
  /** @param mount 要掛 canvas 的容器 */
  constructor(mount, { terrain = null, terrains = null } = {}) {
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
    this.scene.background = FOG_FAR_C.clone();
    this.scene.fog = new THREE.Fog(FOG_FAR_C.clone(), FOG_NEAR, FOG_FAR);

    // 寬視角高機位：足夠大的視野與高度，讓樹木樹冠、遺跡建築等物件全貌盡收眼底
    this.camera = new THREE.PerspectiveCamera(48, W / H, 0.5, 80);
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
      const waterM = envMat(0x18485e, { wash: 0.85, cool: 0.7, transparent: true, opacity: 0.82 });
      const relicM = toonMat(0x7e8884, { bands: 'soft' });
      const hullM = toonMat(0x3e5262, { celMetal: true });
      const foamM = toonMat(0xf0f8ff, { bands: 'soft', transparent: true, opacity: 0.95 });
      const reflM = toonMat(0x283e4a, { transparent: true, opacity: 0.45 });
      this._mats.push(sandM, rockM, waterM, relicM, hullM, foamM, reflM);

      // 海灘沙地
      const beach = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 26), sandM);
      beach.position.set(-6.0, 0.7, 0);
      this._flatGrounds.push(beach);

      // 清澈水體
      const water = new THREE.Mesh(new THREE.PlaneGeometry(18, 26), waterM);
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

      // 海岸浪花帶 (隨潮汐伸縮)
      const foamShore = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 24), foamM);
      foamShore.position.set(0.2, 0.52, 0);
      foamShore.rotation.x = -Math.PI / 2;

      // 遺跡石柱周遭同心浪花波紋
      const foamRing1 = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.25, 24), foamM);
      foamRing1.position.set(4.4, 0.52, -1.5);
      foamRing1.rotation.x = -Math.PI / 2;

      const foamRing2 = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.75, 24), foamM);
      foamRing2.position.set(4.4, 0.52, -1.5);
      foamRing2.rotation.x = -Math.PI / 2;

      const refl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4.8), reflM);
      refl.position.set(4.4, 0.51, 0.8);
      refl.rotation.x = -Math.PI / 2;

      this._geos.push(
        beach.geometry, water.geometry, pillar1.geometry, pillar2.geometry,
        subGeo, foamShore.geometry, foamRing1.geometry, foamRing2.geometry, refl.geometry
      );
      this._gShore.add(beach, water, pillar1, pillar2, subHull, foamShore, foamRing1, foamRing2, refl);
      this._foamMeshes = [foamShore, foamRing1, foamRing2];
      this._reflMesh = refl;
      this._shoreAnims = { subHull, foamShore, foamRing1, foamRing2, refl };
    }

    // ── 3. 沼澤與水中遺跡 (泥濘濕地、墨綠水體、青苔古柱、沉沒殘骸與風吹蘆葦) ──
    this._gSwamp = new THREE.Group();
    {
      const mudM = envMat(0x363c2c, { wash: 0.65, moss: { amount: 0.95 } });
      const swampWaterM = envMat(0x193622, { wash: 0.85, cool: 0.6, transparent: true, opacity: 0.86 });
      const swampRelicM = toonMat(0x4c564a, { bands: 'soft' });
      const swampHullM = toonMat(0x28382c, { celMetal: true });
      const swampFoamM = toonMat(0xd0e8d4, { bands: 'soft', transparent: true, opacity: 0.75 });
      const reedM = envMat(0x3e5e2a);
      this._mats.push(mudM, swampWaterM, swampRelicM, swampHullM, swampFoamM, reedM);

      // 泥濘濕地陸塊
      const mudBank = new THREE.Mesh(new THREE.BoxGeometry(11, 1.3, 26), mudM);
      mudBank.position.set(-5.5, 0.65, 0);
      this._flatGrounds.push(mudBank);

      // 沼澤水體
      const swampWater = new THREE.Mesh(new THREE.PlaneGeometry(18, 26), swampWaterM);
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

      // 沼澤呼吸波紋環
      const sFoamRing1 = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.2, 24), swampFoamM);
      sFoamRing1.position.set(4.5, 0.52, -1.2);
      sFoamRing1.rotation.x = -Math.PI / 2;

      const sFoamRing2 = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.7, 24), swampFoamM);
      sFoamRing2.position.set(4.5, 0.52, -1.2);
      sFoamRing2.rotation.x = -Math.PI / 2;

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

      this._geos.push(
        mudBank.geometry, swampWater.geometry, sPillar1.geometry, sPillar2.geometry,
        sHull.geometry, sFoamRing1.geometry, sFoamRing2.geometry
      );
      this._gSwamp.add(mudBank, swampWater, sPillar1, sPillar2, sHull, sFoamRing1, sFoamRing2, ...reeds);
      this._swampAnims = { sHull, sFoamRing1, sFoamRing2, reeds };
    }

    // ── 4. 樹木植被與群鳥翱翔 (高大樹幹、分層立體樹冠、葉片卡與巡航鳥群) ──
    this._gTree = new THREE.Group();
    {
      const groundTM = envMat(0x3d5636, { wash: 0.55, moss: { amount: 0.8 } });
      const woodM = envMat(0x483526);
      const leafM = envMat(0x35662e, { wash: 0.7, cool: 0.45 });
      const cardM = envMat(0x457c38);
      const birdM = toonMat(0x283038);
      this._mats.push(groundTM, woodM, leafM, cardM, birdM);

      const groundT = new THREE.Mesh(new THREE.PlaneGeometry(28, 28), groundTM);
      groundT.rotation.x = -Math.PI / 2;
      this._flatGrounds.push(groundT);

      // 主神木 (高大粗壯，全貌盡覽)
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.2, 5.2, 12), woodM);
      trunk.position.set(-1.4, 2.6, 0);

      const canopy1 = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), leafM);
      canopy1.position.set(-1.4, 4.8, 0);
      canopy1.scale.set(1.35, 0.95, 1.35);

      const canopy2 = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), leafM);
      canopy2.position.set(-0.3, 5.6, 0.4);

      const leafCards = [];
      const cardGeo = new THREE.PlaneGeometry(0.8, 0.8);
      this._geos.push(cardGeo);
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const c = new THREE.Mesh(cardGeo, cardM);
        c.position.set(-1.4 + Math.cos(ang) * 2.3, 4.6 + (i % 3) * 0.5, Math.sin(ang) * 2.3);
        c.rotation.set(0.3, ang, 0.2);
        leafCards.push(c);
      }

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
        bGroup.userData = { wingL, wingR, phase: i * 0.9, radius: 2.2 + (i % 3) * 0.7, height: 4.8 + i * 0.4, speed: 0.9 + i * 0.1 };
        birds.push(bGroup);
      }

      this._geos.push(groundT.geometry, trunk.geometry, canopy1.geometry, canopy2.geometry);
      this._gTree.add(groundT, trunk, canopy1, canopy2, ...leafCards, ...birds);
      this._birdMeshes = birds;
      this._leafCardMeshes = leafCards;
      this._treeAnims = { trunk, canopy1, canopy2, leafCards, birds };
    }

    // ── 5. 地貌分界、巨岩地標與建築遺跡 ──
    this._gBiome = new THREE.Group();
    {
      const grassM = envMat(0x3a5a32, { wash: 0.6, moss: { amount: 0.9 } });
      const desertM = envMat(0x7e684a, { wash: 0.45, cool: 0.35 });
      const seamM = envMat(0x24321c, { wash: 0.2 });
      const monolithM = envMat(0x565c52, { wash: 0.85, cool: 0.6, moss: { amount: 0.95 } });
      const bannerM = toonMat(0x3b82f6);
      this._mats.push(grassM, desertM, seamM, monolithM, bannerM);

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

      // 宏偉巨岩石碑 1
      const m1 = new THREE.Mesh(new THREE.BoxGeometry(2.0, 4.8, 2.0), monolithM);
      m1.position.set(-2.4, 2.4, 0.5);
      m1.rotation.y = 0.3;

      // 宏偉巨岩石碑 2
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 5.8, 2.4), monolithM);
      m2.position.set(2.8, 2.9, -1.2);
      m2.rotation.y = -0.4;

      // 背景遠景巨石群
      const bgMono = new THREE.Mesh(new THREE.BoxGeometry(4.0, 7.5, 4.0), monolithM);
      bgMono.position.set(0, 3.75, BG_Z);

      // 遺跡旗幟 (隨風飄揚)
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 6), monolithM);
      flagPole.position.set(-2.4, 5.0, 0.5);
      const flagBanner = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), bannerM);
      flagBanner.position.set(-1.8, 6.7, 0.5);

      this._geos.push(
        gGrass.geometry, gDesert.geometry, seam.geometry, m1.geometry, m2.geometry,
        bgMono.geometry, flagPole.geometry, flagBanner.geometry
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

    // 勾線/調色走真品後製管線
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, {
      lowPower: lowPower() || isTouchUI(),
    });
    this.pipeline.setDof(DOF_NEAR, DOF_FAR);
    this.pipeline.setAirFog(FOG_NEAR_C, FOG_FAR_C, FOG_NEAR, FOG_FAR);

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

  /** 五個樣品各吃自己的倫敦地形；地形只屬展示，不進戰場碰撞。 */
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

      const spec = LONDON_SHOWCASE_SITES[i] || LONDON_SHOWCASE_SITES[0];
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
      this.scene.add(built.group);
      if (source.group) {
        disposeTree(source.group);
        source.group = null;
      }
      if (i === 0) {
        for (const item of this._showcaseUnits) item.terrainY = built.localYAt(item.x, 0);
      }
      if (i === 1 && built.waterY != null) {
        for (const mesh of this._foamMeshes || []) mesh.position.y = built.waterY + 0.03;
      }
      if (i === 2 && built.waterY != null) {
        for (const mesh of [this._swampAnims?.sFoamRing1, this._swampAnims?.sFoamRing2]) {
          if (mesh) mesh.position.y = built.waterY + 0.03;
        }
      }
    }
    const hasTerrain = this._terrainSources.some(Boolean);
    this._flatGrounds.forEach((ground) => { ground.visible = !hasTerrain; });
    this._waterSurfaces.forEach((water) => { water.visible = !hasTerrain; });
    this.terrainSite = this.terrainSites[this._sceneIdx];
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
    this.onSceneChange?.(idx);
    this.render();
  }

  /** 每幀更新實機動態演出 */
  update(t) {
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

    // 2. 海灘浪花動態 (潮汐伸縮沖岸、石柱波紋環縮放、沉船微晃)
    if (this._shoreAnims && this._gShore.visible) {
      const { subHull, foamShore, foamRing1, foamRing2 } = this._shoreAnims;
      const wave = Math.sin(t * 1.6);
      foamShore.position.x = 0.2 + wave * 0.35;
      foamShore.scale.x = 1.0 + wave * 0.2;

      const rScale1 = 1.0 + Math.sin(t * 2.0) * 0.15;
      const rScale2 = 1.0 + Math.sin(t * 2.0 + 1.2) * 0.15;
      foamRing1.scale.set(rScale1, rScale1, 1);
      foamRing2.scale.set(rScale2, rScale2, 1);

      subHull.rotation.z = 0.08 + Math.sin(t * 1.2) * 0.03;
    }

    // 3. 沼澤濕地動態 (蘆葦迎風搖擺、死水波紋擴散)
    if (this._swampAnims && this._gSwamp.visible) {
      const { sFoamRing1, sFoamRing2, reeds } = this._swampAnims;
      const sWave1 = 1.0 + Math.sin(t * 1.4) * 0.12;
      const sWave2 = 1.0 + Math.sin(t * 1.4 + 1.5) * 0.12;
      sFoamRing1.scale.set(sWave1, sWave1, 1);
      sFoamRing2.scale.set(sWave2, sWave2, 1);

      for (let i = 0; i < reeds.length; i++) {
        reeds[i].rotation.z = 0.1 + Math.sin(t * 2.6 + i * 0.7) * 0.14;
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
