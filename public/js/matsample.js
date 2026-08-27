// ============ 設定頁的「樣品」畫面(art-direction 拉桿的即時預覽)============
// 拉桿如果沒有樣品,玩家得「拉一下 → 關掉選單 → 看戰場 → 再開回來」,而陰影偏色這種
// 色相層級的差異在那個來回之間根本記不住 —— 不給樣品等於不給拉桿。
//
// **樣品 MUST 走真品材質**(`toonMat` / `envMat` / `postfx.Pipeline`),MUST NOT 另寫一份
// 「看起來差不多」的 2D 塗色:那就是同一個場景兩套明暗規則(§2.1 的老病),而且症狀是
// 「樣品調好了、進戰場不是那樣」—— 玩家只會覺得這個設定壞了。
//
// 成本:一顆額外的 WebGL context(260×140),只在設定頁開著時存在,`dispose()` 一律
// 連 renderer 一起收(A25)。低功耗/觸控走 8bit RT,與戰場同一條降級規則。
import * as THREE from 'three';
import { toonMat, envMat, updateCelLight } from './toon.js';
import { Pipeline } from './postfx.js';
import { onVisualChange, visualPref } from './visualPrefs.js';
import { lowPower, isTouchUI } from './mobile.js';

const W = 260, H = 140;

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
const FOG_NEAR = 6.0, FOG_FAR = 27.0;
const FOG_FAR_C = new THREE.Color(0x0f1622);    // MUST === scene.background
const FOG_NEAR_C = new THREE.Color(0x4a3a2a);

const DEMO_SCENES = [
  { id: 'mech', name: '🤖 機體' },
  { id: 'shore', name: '🌊 水岸' },
  { id: 'tree', name: '🌲 樹鳥' },
  { id: 'biome', name: '🏞️ 地貌' },
];

export class MatSample {
  /** @param mount 要掛 canvas 的容器 */
  constructor(mount) {
    this.mount = mount;
    this._sceneIdx = 0;
    this._mats = [];

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

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.scene = new THREE.Scene();
    this.scene.background = FOG_FAR_C.clone();
    this.scene.fog = new THREE.Fog(FOG_FAR_C.clone(), FOG_NEAR, FOG_FAR);
    this.camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 60);
    this.camera.position.set(0, 2.1, 9.2);
    this.camera.lookAt(0, 0.6, 0);

    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.copy(SUN_DIR).multiplyScalar(20);
    this.scene.add(sun, new THREE.AmbientLight(0x556070, 0.55));

    // 左:機體(toonMat + 硬邊金屬高光)—— 「機體陰影偏色」看的就是這一顆。
    // 右:環境(envMat + 苔蘚 + 水彩暈染)—— 「環境陰影偏色」與「風化密度」看這一塊。
    const mechM = toonMat(0x8d97a6, { celMetal: true });
    const envM = envMat(0x6f7a63, { wash: 0.55, cool: 0.5, moss: { amount: 0.85 }, preview: true });
    this._mats.push(mechM, envM);
    const mech = new THREE.Mesh(new THREE.SphereGeometry(1.55, 32, 24), mechM);
    mech.position.set(-2.3, 1.0, 0);
    const mechArm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), mechM);
    mechArm.position.set(-2.3, 1.0, 1.4);
    mechArm.rotation.set(0.3, 0.5, 0.2);
    const rock = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), envM);
    rock.position.set(2.2, 1.1, 0);
    rock.rotation.y = 0.6;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24),
      envMat(0x4b5646, { wash: 0.5, cool: 0.5, rim: 0, bands: 4, moss: { amount: 0.8 }, preview: true }));
    ground.rotation.x = -Math.PI / 2;
    this._mats.push(ground.material);

    const bgGeo = new THREE.BoxGeometry(1, 1, 1);
    const bg = [[-4.6, 1.9, 1.5], [-0.2, 2.6, 1.8], [4.3, 1.6, 1.3]].map(([x, h, w]) => {
      const m = new THREE.Mesh(bgGeo, envM);
      m.position.set(x, h / 2, BG_Z);
      m.scale.set(w, h, w);
      m.rotation.y = x * 0.11;
      return m;
    });

    this._geos = [mech.geometry, mechArm.geometry, rock.geometry, ground.geometry, bgGeo];

    // 建置 4 組 Demo 場景群組
    this._gMech = new THREE.Group();
    this._gMech.add(mech, mechArm, rock, ground, ...bg);

    // 額外建置機體展示台部件
    const pedGeo = new THREE.CylinderGeometry(2.2, 2.4, 0.3, 24);
    const pedMat = envMat(0x28323e, { wash: 0.3, cool: 0.5 });
    const ped = new THREE.Mesh(pedGeo, pedMat);
    ped.position.set(-2.3, 0.15, 0);
    const mechArmorM = toonMat(0x3a6a8c);
    const mechChest = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.1), mechArmorM);
    mechChest.position.set(-2.3, 1.7, 0.2);
    this._mats.push(pedMat, mechArmorM);
    this._geos.push(pedGeo, mechChest.geometry);
    this._gMech.add(ped, mechChest);

    // 2. 水岸與倒影
    this._gShore = new THREE.Group();
    {
      const shoreM = envMat(0x4a6042, { wash: 0.6, cool: 0.5, moss: { amount: 0.85 } });
      const rockM = envMat(0x56524a, { wash: 0.5 });
      const waterM = envMat(0x184458, { wash: 0.85, cool: 0.65 });
      const beaconM = toonMat(0xd46830);
      const foamM = toonMat(0xddf2f8);
      const reflM = toonMat(0x844020);
      this._mats.push(shoreM, rockM, waterM, beaconM, foamM, reflM);

      const shore = new THREE.Mesh(new THREE.BoxGeometry(11, 1.4, 24), shoreM);
      shore.position.set(-5.5, 0.7, 0);

      const water = new THREE.Mesh(new THREE.PlaneGeometry(13, 24), waterM);
      water.position.set(6.5, 0.5, 0);
      water.rotation.x = -Math.PI / 2;

      const rock1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 2.0), rockM);
      rock1.position.set(-0.4, 1.0, 1.2);
      rock1.rotation.set(0.2, 0.7, 0.1);

      const beaconPole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 3.6, 12), beaconM);
      beaconPole.position.set(-1.4, 2.5, -0.4);

      const beaconTop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), beaconM);
      beaconTop.position.set(-1.4, 4.4, -0.4);

      const foam1 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 20), foamM);
      foam1.position.set(0.4, 0.52, 0);
      foam1.rotation.x = -Math.PI / 2;

      const foam2 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 18), foamM);
      foam2.position.set(1.1, 0.52, 0);
      foam2.rotation.x = -Math.PI / 2;

      const refl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 6.0), reflM);
      refl.position.set(0.8, 0.51, 1.5);
      refl.rotation.x = -Math.PI / 2;

      const bgCliff = new THREE.Mesh(new THREE.BoxGeometry(12, 4.0, 2), rockM);
      bgCliff.position.set(-4.0, 2.0, BG_Z);

      this._geos.push(
        shore.geometry, water.geometry, rock1.geometry, beaconPole.geometry,
        beaconTop.geometry, foam1.geometry, foam2.geometry, refl.geometry, bgCliff.geometry
      );
      this._gShore.add(shore, water, rock1, beaconPole, beaconTop, foam1, foam2, refl, bgCliff);
      this._foamMeshes = [foam1, foam2];
      this._reflMesh = refl;
    }

    // 3. 樹冠植被與鳥群
    this._gTree = new THREE.Group();
    {
      const groundTM = envMat(0x3d5636, { wash: 0.55, moss: { amount: 0.8 } });
      const woodM = envMat(0x483526);
      const leafM = envMat(0x35662e, { wash: 0.7, cool: 0.45 });
      const cardM = envMat(0x457c38);
      const birdM = toonMat(0x283038);
      this._mats.push(groundTM, woodM, leafM, cardM, birdM);

      const groundT = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), groundTM);
      groundT.rotation.x = -Math.PI / 2;

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 4.5, 12), woodM);
      trunk.position.set(-1.2, 2.25, 0);

      const canopy1 = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), leafM);
      canopy1.position.set(-1.2, 4.2, 0);
      canopy1.scale.set(1.3, 0.9, 1.3);

      const canopy2 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), leafM);
      canopy2.position.set(-0.2, 4.8, 0.4);

      const leafCards = [];
      const cardGeo = new THREE.PlaneGeometry(0.7, 0.7);
      this._geos.push(cardGeo);
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const c = new THREE.Mesh(cardGeo, cardM);
        c.position.set(-1.2 + Math.cos(ang) * 1.9, 4.0 + (i % 3) * 0.4, Math.sin(ang) * 1.9);
        c.rotation.set(0.3, ang, 0.2);
        leafCards.push(c);
      }

      const birds = [];
      const birdGeo = new THREE.BufferGeometry();
      const pts = new Float32Array([
        0, 0, 0.35,  -0.5, 0.1, -0.25,   0, 0, -0.15,
        0, 0, 0.35,   0, 0, -0.15,    0.5, 0.1, -0.25,
      ]);
      birdGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      birdGeo.computeVertexNormals();
      this._geos.push(birdGeo);

      const bPos = [
        [1.2, 4.8, -1.0, 0.2],
        [2.2, 5.4, -0.4, 0.4],
        [3.0, 4.9, 0.5, 0.1],
        [2.0, 4.2, 1.0, -0.2],
      ];
      for (const [bx, by, bz, ry] of bPos) {
        const bm = new THREE.Mesh(birdGeo, birdM);
        bm.position.set(bx, by, bz);
        bm.rotation.y = ry;
        birds.push(bm);
      }

      this._geos.push(groundT.geometry, trunk.geometry, canopy1.geometry, canopy2.geometry);
      this._gTree.add(groundT, trunk, canopy1, canopy2, ...leafCards, ...birds);
      this._birdMeshes = birds;
      this._leafCardMeshes = leafCards;
    }

    // 4. 地貌分界與大氣透視
    this._gBiome = new THREE.Group();
    {
      const grassM = envMat(0x3a5a32, { wash: 0.6, moss: { amount: 0.9 } });
      const desertM = envMat(0x7e684a, { wash: 0.45, cool: 0.35 });
      const seamM = envMat(0x24321c, { wash: 0.2 });
      const monolithM = envMat(0x565c52, { wash: 0.85, cool: 0.6, moss: { amount: 0.95 } });
      this._mats.push(grassM, desertM, seamM, monolithM);

      const gGrass = new THREE.Mesh(new THREE.PlaneGeometry(12, 24), grassM);
      gGrass.position.set(-6, 0, 0);
      gGrass.rotation.x = -Math.PI / 2;

      const gDesert = new THREE.Mesh(new THREE.PlaneGeometry(12, 24), desertM);
      gDesert.position.set(6, 0, 0);
      gDesert.rotation.x = -Math.PI / 2;

      const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 24), seamM);
      seam.position.set(0, 0.02, 0);
      seam.rotation.x = -Math.PI / 2;

      const m1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.4, 1.6), monolithM);
      m1.position.set(-2.0, 1.7, 0.5);
      m1.rotation.y = 0.3;

      const m2 = new THREE.Mesh(new THREE.BoxGeometry(2.0, 4.0, 2.0), monolithM);
      m2.position.set(2.4, 2.0, -1.0);
      m2.rotation.y = -0.4;

      const bgMono = new THREE.Mesh(new THREE.BoxGeometry(3.0, 6.0, 3.0), monolithM);
      bgMono.position.set(0, 3.0, BG_Z);

      this._geos.push(gGrass.geometry, gDesert.geometry, seam.geometry, m1.geometry, m2.geometry, bgMono.geometry);
      this._gBiome.add(gGrass, gDesert, seam, m1, m2, bgMono);
      this._seamMesh = seam;
    }

    this._sceneGroups = [this._gMech, this._gShore, this._gTree, this._gBiome];
    this.scene.add(...this._sceneGroups);
    this._gShore.visible = false;
    this._gTree.visible = false;
    this._gBiome.visible = false;

    // 勾線/調色走真的後製管線 —— 「勾線強度」那根拉桿否則什麼都看不到。
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, {
      lowPower: lowPower() || isTouchUI(),
    });
    this.pipeline.setDof(DOF_NEAR, DOF_FAR);   // 樣品尺度(見檔頭那一段;戰場走 game._syncDof)
    // 距離 MUST 與上面那個 scene.fog 逐位元相同(postfx AIR 的恆等式前提)
    this.pipeline.setAirFog(FOG_NEAR_C, FOG_FAR_C, FOG_NEAR, FOG_FAR);

    this._draw = () => this.render();
    this._off = onVisualChange(this._draw);
    this.render();
  }

  /** 切換展示場景 */
  setScene(idx) {
    if (idx < 0 || idx >= this._sceneGroups.length) return;
    this._sceneIdx = idx;
    this._sceneBtns.forEach((b, i) => b.classList.toggle('on', i === idx));
    this._sceneGroups.forEach((g, i) => { g.visible = (i === idx); });
    this.render();
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
    this._off?.();
    this._off = null;
    this.pipeline?.dispose();
    for (const m of this._mats) m.dispose();
    for (const g of this._geos) g.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.switcher?.remove();
    this.canvas?.remove();
  }
}
