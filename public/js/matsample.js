// ============ 設定頁的「樣品」畫面(art-direction 拉桿的即時預覽)============
// 拉桿如果沒有樣品,玩家得「拉一下 → 關掉選單 → 看戰場 → 再開回來」,而陰影偏色這種
// 色相層級的差異在那個來回之間根本記不住 —— 不給樣品等於不給拉桿。
//
// **樣品 MUST 走真品材質**(`toonMat` / `envMat` / `postfx.Pipeline`),MUST NOT 另寫一份
// 「看起來差不多」的 2D 塗色:那就是同一個場景兩套明暗規則(§2.1 的老病),而且症狀是
// 「樣品調好了、進戰場不是那樣」—— 玩家只會覺得這個設定壞了。
//
// 成本:一顆額外的 WebGL context(240×132),只在設定頁開著時存在,`dispose()` 一律
// 連 renderer 一起收(A25)。低功耗/觸控走 8bit RT,與戰場同一條降級規則。
import * as THREE from 'three';
import { toonMat, envMat, updateCelLight } from './toon.js';
import { Pipeline } from './postfx.js';
import { onVisualChange } from './visualPrefs.js';
import { lowPower, isTouchUI } from './mobile.js';

const W = 260, H = 140;

export class MatSample {
  /** @param mount 要掛 canvas 的容器 */
  constructor(mount) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.canvas.className = 'vset-sample';
    mount.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1622);
    this.camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 60);
    this.camera.position.set(0, 2.1, 9.2);
    this.camera.lookAt(0, 0.6, 0);

    // 打光刻意與戰場同方向(toon.js 的 `_celLightDirView` 初值 = (0.4, 0.8, 0.4)):
    // ramp 的階落在哪一面決定了「暗面是不是真的在畫面上」,方向一改樣品就不具代表性。
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(0.4, 0.8, 0.4).multiplyScalar(20);
    this.scene.add(sun, new THREE.AmbientLight(0x556070, 0.55));

    // 左:機體(toonMat + 硬邊金屬高光)—— 「機體陰影偏色」看的就是這一顆。
    // 右:環境(envMat + 苔蘚 + 水彩暈染)—— 「環境陰影偏色」與「風化密度」看這一塊。
    // 兩者形狀刻意不同:球看得出 ramp 的階、方塊看得出勾線的輪廓與凹凸邊。
    this._mats = [];
    const mechM = toonMat(0x8d97a6, { celMetal: true });
    const envM = envMat(0x6f7a63, { wash: 0.55, cool: 0.5, moss: { amount: 0.85 } });
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
      envMat(0x4b5646, { wash: 0.5, cool: 0.5, rim: 0, bands: 4 }));
    ground.rotation.x = -Math.PI / 2;
    this._mats.push(ground.material);
    this.scene.add(mech, mechArm, rock, ground);
    this._geos = [mech.geometry, mechArm.geometry, rock.geometry, ground.geometry];

    // 勾線/調色走真的後製管線 —— 「勾線強度」那根拉桿否則什麼都看不到。
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, {
      lowPower: lowPower() || isTouchUI(),
    });

    this._draw = () => this.render();
    this._off = onVisualChange(this._draw);
    this.render();
  }

  render() {
    if (!this.renderer) return;
    // 共享的 cel 光向:戰場每幀自己會重設,樣品只在被看的時候借用一下 ——
    // 順序上戰場的 `updateCelLight` 恆在它自己 render 之前,借用不會留下殘影。
    updateCelLight(this.camera);
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
    this.canvas?.remove();
  }
}
