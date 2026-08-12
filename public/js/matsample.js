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
// 機甲球 19% 進暗階,同一次量測的峰值差從 100% 拉桿的 4/255 → 8/255、300% 的 11 → 21,
// 全畫面「看得出來在動」的像素比從 6% → 23%。
//
// 側光同時是材質預覽的通則(一顆球要同時看得到受光面、明暗交界與暗面);而戰場的相機
// 本來就繞著太陽轉一整圈 ⇒「相對相機的光向」在對局裡涵蓋全部角度,樣品挑會出現暗面的
// 那一個角度才是有代表性的,不是挑會把暗面藏起來的那一個。
// y 分量 MUST 低於 0.5:再高的話地面法線(0,1,0)會跳進四階 ramp 的**頂階**,而頂階的
// 偏色權重恆為 0 ⇒ 畫面裡最大的那一片(地面佔 47%)當場退出這根拉桿的作用範圍。
const SUN_DIR = new THREE.Vector3(0.9, 0.42, -0.35).normalize();

// 樣品自己的景深帶(公尺)。戰場那一組是 `data.js dofNearM/dofFarM` 由狙擊模式可視範圍推導的
// **576~864m**,而樣品整個場景只有 24m 深 ⇒ 直接沿用的話樣品每一個像素都落在焦內帶,
// 「景深模糊」這根拉桿拉到底都不會有任何變化。這是陰影偏色(過肩光 ⇒ 暗面不在畫面上)與
// 風化密度(大廳沒有世界的場 ⇒ 乘數恆 1)各踩過一次的同一個坑,第三次不必再踩:
// **規則同一份(postfx 的 CoC 曲線),尺度兩軌**(同 `toon.js _rampTint` 的 mech/env)。
// 帶的兩端刻意夾住場景 —— 前景三件(離相機 8.0~10.5m)全部落在 NEAR 之內恆為全清晰,
// 背景那排(≈14.8~15.5m)與地面遠端(21m)落在 FAR 之外吃滿模糊,一眼看得出差別。
const DOF_NEAR = 11.0, DOF_FAR = 15.5;
const BG_Z = -5.5;   // 背景排的 z(與 DOF_FAR 一起挑的:那一排 MUST 落在全糊帶裡)

// 樣品自己的霧帶與兩個霧色(「空氣透視」那根拉桿的示範對象)——**尺度兩軌、規則一份**,
// 同上一段那個第三次不必再踩的坑。
// FOG_FAR 刻意**大於**場景最遠處(21m 的地面遠端):遠端 f 只到 ≈0.72 ⇒ 畫面上沒有任何
// 一個像素落在「補正歸零」的那一端,整條近→遠的色相過渡才全段可見。
// 顏色:遠端 = 背景色本身(戰場那邊是地平線色,同一條「遠景融進背景」的恆等式);
// 近端 = 樣品鍵光的暖色(戰場那邊由 `environment.js nearFogColor` 從當天的太陽推導)。
const FOG_NEAR = 6.0, FOG_FAR = 27.0;
const FOG_FAR_C = new THREE.Color(0x0f1622);    // MUST === scene.background
const FOG_NEAR_C = new THREE.Color(0x4a3a2a);

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
    this.scene.background = FOG_FAR_C.clone();
    // 樣品也要有霧 —— 後製那一段補的是「近端色與遠端色的**差額**」,底下沒有霧的話補上去
    // 的差額會浮在沒被霧化的幾何上(拉桿一動整個畫面染色,而戰場不是那樣)。
    // 霧色 MUST === 遠端色:這樣拉桿在 0% 時樣品就是單色霧 = 戰場 0% 的同一件事。
    this.scene.fog = new THREE.Fog(FOG_FAR_C.clone(), FOG_NEAR, FOG_FAR);
    this.camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 60);
    this.camera.position.set(0, 2.1, 9.2);
    this.camera.lookAt(0, 0.6, 0);

    // 打光走 `SUN_DIR`(理由見檔頭那一段):ramp 的階落在哪一面,決定了「暗面是不是真的
    // 在畫面上」—— 而陰影偏色只作用在暗階上,暗面不在畫面上這根拉桿就等於沒有。
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.copy(SUN_DIR).multiplyScalar(20);
    this.scene.add(sun, new THREE.AmbientLight(0x556070, 0.55));

    // 左:機體(toonMat + 硬邊金屬高光)—— 「機體陰影偏色」看的就是這一顆。
    // 右:環境(envMat + 苔蘚 + 水彩暈染)—— 「環境陰影偏色」與「風化密度」看這一塊。
    // 兩者形狀刻意不同:球看得出 ramp 的階、方塊看得出勾線的輪廓與凹凸邊。
    // `preview: true` = 改吃樣品自己那張風化場(toon.js ensurePreviewField):世界那一張在
    // 大廳根本還沒有(1×1 中性 ⇒ 拉桿逐位元無作用),在戰鬥中又是整張圖的尺度 ⇒ 樣品那 24m
    // 只取到單一個值。兩者都不報錯,症狀都是「風化密度拉了看不出差異」。
    this._mats = [];
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
    // 地面 MUST 帶 moss:它是畫面裡唯一一片**正朝上**又佔滿下半幅的面(苔蘚是世界 Y 軸
    // 投影 ⇒ 只有朝上的面吃得到),而岩塊的頂面在這個機位上幾乎看不到 —— 沒有它,
    // 「風化密度」就只剩 wash 那 ±7% 的暈染在動,等同看不出差異。
    // 邊長 MUST 與 `PREVIEW_SPAN` 一致:場的取樣框就是這一片地,起伏才鋪滿樣品畫面。
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24),
      envMat(0x4b5646, { wash: 0.5, cool: 0.5, rim: 0, bands: 4, moss: { amount: 0.8 }, preview: true }));
    ground.rotation.x = -Math.PI / 2;
    this._mats.push(ground.material);
    this.scene.add(mech, mechArm, rock, ground);
    // 背景排:**「景深模糊」那根拉桿的示範對象**。沒有它,焦外帶裡就只剩一片平坦的地面 ——
    // 而平面在勾線 pass 的二階差分恆為 0(檔頭)⇒ 那裡一條線都沒有,糊與不糊只差在苔蘚
    // 的低頻起伏,等同看不出差異。有輪廓線的方塊糊起來才是一眼就認得出來的那種糊。
    // 共用 `envM` 與同一份幾何(逐件各配一份 = 白白多幾個要 dispose 的東西,A25)。
    const bgGeo = new THREE.BoxGeometry(1, 1, 1);
    const bg = [[-4.6, 1.9, 1.5], [-0.2, 2.6, 1.8], [4.3, 1.6, 1.3]].map(([x, h, w]) => {
      const m = new THREE.Mesh(bgGeo, envM);
      m.position.set(x, h / 2, BG_Z);
      m.scale.set(w, h, w);
      m.rotation.y = x * 0.11;
      return m;
    });
    this.scene.add(...bg);
    this._geos = [mech.geometry, mechArm.geometry, rock.geometry, ground.geometry, bgGeo];

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

  render() {
    if (!this.renderer) return;
    // 共享的 cel 光向:戰場每幀自己會重設,樣品只在被看的時候借用一下 ——
    // 順序上戰場的 `updateCelLight` 恆在它自己 render 之前,借用不會留下殘影。
    // **MUST 餵樣品自己那盞燈的方向**:硬邊高光 / CEL_COOL 吃這個 uniform,而 ramp 吃的是
    // 場景裡真的那盞 DirectionalLight ⇒ 不覆寫就會變成「高光打在這邊、明暗界在那邊」。
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
    this.canvas?.remove();
  }
}
