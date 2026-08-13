// ============ s10@flight 逐機零件檔(航空機體;dev-only)============
// s10「靜電」長耳可變訊號機 —— **飛行型**(飛鯨浮空艦)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s10_flight_static.jpg / s10_ground_static.jpg
//
// 2026-08-13 使用者定案:「利維坦+巨像:**保持飛艇形象,加入飛鯨頭部與胸鰭特徵**;
// 地面形態胸鰭充當象耳;飛行形態四肢象腿與象牙內縮,地面形態才展開;
// 飛行形態象鼻變獨角鯨的角連帶武器挺直,地面形態象鼻保持柔軟持武器攻擊。」
//   ⇒ 舊制那台的囊體/吊艙/耳板/鯨尾都是另畫的一份,而地面型(機械巨象)根本沒有建模。
//     兩張 2D 定案圖其實是**同一具氣囊 + 同一顆鯨首**:本檔因此一顆自己的幾何都沒有,
//     整台由 `s10.js` 的建構器組出來,四個旋鈕各轉一次就是另一個型態:
//       earOut 1→0(象耳後掠成胸鰭)/ tuskOut 1→0(象牙內縮)/ trunkDown true→false
//       (象鼻挺成獨角鯨的角,鼻端武器隨之同軸)/ 四肢上收進腹艙。
//   ⇒ 升力來自浮力 ⇒ **沒有旋翼、沒有噴口**;只有兩具低速矢量推進器。
import * as THREE from 'three';
import { cylF, rotorF } from '../geo.js';
import s10 from './s10.js';
import { staticLimb } from './_morph.js';

const FR = s10.frame;

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '靜電・飛行型(s10 飛鯨浮空艦)', hue: s10.hue, kind: 'air', height: s10.height,
  air: { tiltY: 3.0, bob: 0.11, top: 12, span: 3.6 },
  moveSig: { hover: 0.15, hoverF: 0.5, hoverA: 0.25, surge: 0.05, flare: 0.05, bank: 0.05 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['浮空囊體 + 艦橋', 's10.envelope 同一具氣囊(隔艙稜線 ×8 + 繫留帶 ×3 + 桅桿雷達)'],
    ['鯨首', 's10.neckHead 同一顆鈍圓鯨頭(額隆 + 下頷溝槽 + 感測眼)'],
    ['胸鰭 ×2(後掠)', 's10.earFin 同一片板:earOut 0 ⇒ 由象耳後掠成胸鰭(振子格陣仍在)'],
    ['象牙(內縮)', 's10.tusk 同一對:tuskOut 0 ⇒ 縮進頰囊'],
    ['獨角(象鼻挺直)', 's10.trunk 同一條十節軟鼻:trunkDown false ⇒ 挺成獨角鯨的角 + 螺旋稜'],
    ['象腿 ×4(上收)', '同一組柱狀象腿(s10.legF/legH)收進腹艙'],
    ['鯨尾', 's10.tail 同一組水平尾鰭 + 垂直安定鰭'],
    ['矢量推進器 ×2', '涵道低速螺槳(浮力機的唯一動力;無旋翼升力、無噴口)'],
  ],

  body(c, t) {
    // ← 四個旋鈕:一次把地面型的巨象轉成飛行型的鯨(零件一批都沒換)
    c.earOut = 0; c.tuskOut = 0; c.trunkDown = false;

    const spine = new THREE.Group();
    t.add(spine);
    s10.body(c, spine);
    const chest = new THREE.Group();
    chest.position.set(...FR.chest);
    spine.add(chest);
    const neck = new THREE.Group();
    neck.position.set(...FR.neck);
    chest.add(neck);
    const head = new THREE.Group();
    head.position.set(...FR.head);
    neck.add(head);
    s10.neckHead(c, neck, head);
    c._spine = spine;

    // ---- 象腿 ×4 上收進腹艙(同一組腿件;規格陣列由 staticLimb 靜態組起來)----
    for (const [sx, z, front] of [[-1, FR.fz, true], [1, FR.fz, true], [-1, FR.hz, false], [1, FR.hz, false]]) {
      const cx = { ...c, sx, front };
      staticLimb(spine, front ? s10.legF(cx) : s10.legH(cx),
        [0, front ? 2.0 : -2.1, front ? -1.2 : 1.3],
        [sx * FR.legX * 0.72, -0.55, z * 0.8], [front ? 1.35 : -1.35, 0, sx * 0.2]);
    }
    // ---- 鯨尾(與地面型同一組;掛在囊尾)----
    const tail = new THREE.Group();
    tail.position.set(0, FR.tailY, FR.tailZ);
    spine.add(tail);
    const tail2 = new THREE.Group();
    tail2.position.set(0, 0, -FR.tail2Z);
    tail.add(tail2);
    s10.tail(c, tail, tail2);
  },

  lift(c) {
    const { PAL, K } = c;
    const spin = [];
    for (const sx of [-1, 1]) {                      // 矢量推進器 ×2(涵道低速螺槳)
      cylF(c._spine, 0.3, 0.3, 0.34, 12, sx * 1.0, -0.5, -1.5, PAL.deep, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      const r = rotorF(c._spine, { r: 0.26 * K.barrelF, blades: 4, pitch: 0.28, thick: 0.026, tilt: [Math.PI / 2, 0] },
        sx * 1.0, -0.5, -1.5, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c) { return s10.mount(c, { spine: c._spine }); },
};
