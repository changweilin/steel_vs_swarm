// ============ m08@flight 逐機零件檔(航空機體;dev-only)============
// m08「空號」隱形狙擊可變機甲 —— **飛行型**(夜豹展翼:夜梟現形)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m08_flight_static.jpg / m08_ground_static.jpg
//
// 2026-08-13 使用者定案:「夜豹+夜梟:**重製為夜豹特徵優先**,飛行型態夜梟現形,展開隱藏在
// 後背的翅膀,武器在雙肩朝前。」
//   ⇒ 舊制那台是**另畫的一隻夜梟**(短寬軀幹 + 面盤 + 對趾爪),豹身一格也沒有;
//     兩張 2D 定案圖其實是同一具豹身,差別只有背上那對翅膀摺著還是張開。
//   ⇒ 本檔因此**一顆自己的幾何都沒有**:整台由 `m08.js`(夜豹)的建構器組出來,
//     飛行型只做三件事 —— 翅膀張開、面盤向前合攏(夜梟現形)、武器移到雙肩朝前。
//   ⇒ 零件比例:夜豹 75% / 夜梟 25%(翅膀 + 面盤)。
import * as THREE from 'three';
import m08 from './m08.js';
import { staticLimb } from './_morph.js';

const FR = m08.frame;

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '空號・飛行型(m08 夜豹展翼)', kind: 'air', height: m08.height,
  air: { tiltY: 2.5, bob: 0.06, top: 24, span: 5.4 },
  moveSig: { hover: 0.10, hoverF: 0.5, hoverA: 0.90, surge: 0.25, flare: 0.92, bank: 0.42 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['豹身(75%)', '地面型軀幹/脊椎護套/迷彩背板/絨質分片(m08.body)整組沿用'],
    ['豹首 + 面盤(現形)', 'm08.neckHead 同一顆豹首;m08.faceHalf 兩半向前合攏成夜梟聲學碟'],
    ['翅膀 ×2(張開)', 'm08.wing 同一對:**三段鳥骨 + 逐段實心翼板 ×3**(肱骨 → 橈尺骨 → 腕掌骨,長比 1:1.18:0.77 ← 鴞骨架)+ 初級 ×8 / 次級 ×7 / 三級 ×3 + 覆羽 ×7 + 小翼羽 + 前緣鋸齒 ×11 + 後緣流蘇 ×7;板是翼面主體、羽片自板的後緣排開(翼展÷翼弦 = 3.13 的短寬鴞翼)⇒ 前兩段進 rig.wings 撲翼、第三段靠繼承跟上'],
    ['四腿(收折)', '同一組四節貓科腿件(m08.legF/legH;段長與站姿角照豹骨架反解,含躺平的掌骨/蹠骨)向後收折成著陸姿'],
    ['尾', 'm08.tail 的五節細長尾(進 rig.tailSegs ⇒ 依轉向甩尾)'],
    ['武裝(雙肩朝前)', '同一具長狙擊莢(右肩)+ 短莢(左肩),兩者改朝航向'],
  ],

  body(c, t) {
    const spine = new THREE.Group();
    t.add(spine);
    const chest = new THREE.Group();
    chest.position.set(...FR.chest);
    spine.add(chest);
    // ⚠ m08.body 順手建了翅膀並把 pivot 記進 c.wings —— 飛行型只重設那幾個 pivot 的旋轉,
    // MUST NOT 再建一對(那是第二對翅膀,畫面上只表現成「羽毛變密了」)
    m08.body(c, spine, chest);
    const neck = new THREE.Group();
    neck.position.set(...FR.neck);
    chest.add(neck);
    const head = new THREE.Group();
    head.position.set(...FR.head);
    neck.add(head);
    m08.neckHead(c, neck, head);
    c._spine = spine; c._head = head;

    // ---- 翅膀張開(隱藏在後背的那一對現形)----
    // ⚠ 靜態姿態只准放 **rotation.y / rotation.x** —— locomotion.stepAerial 的鳥類撲翼每幀改寫
    //   `w.rotation.z` 與 `outer.rotation.z`(那兩個是撲翼通道),擺在 z 的上反角一格都留不下來。
    //   三段累積後掠 −0.10 + 0.26 + 0.24 = 0.40 rad ⇒ 每個關節都有可見的折角,正面讀得出三段骨。
    for (const mw of c.wings) {
      mw.w.rotation.set(-0.05, -mw.sgn * 0.10, mw.sgn * 0.16);   // z 只是撲翼的起始值
      mw.outer.rotation.set(0, mw.sgn * 0.26, 0);
      mw.hand.rotation.set(0, mw.sgn * 0.24, -mw.sgn * 0.10);    // 第三段不進契約 ⇒ 翼梢下垂留得住
    }
    // ---- 面盤向前合攏(夜梟現形)----
    for (const { piv, sx } of c.faceHalves || []) {
      piv.rotation.set(0, -sx * 0.26, 0);
      piv.position.set(sx * 0.16, 0.02, 0.26);
    }

    // ---- 四腿向後收折(同一組腿件;規格陣列由 staticLimb 靜態組起來)----
    // ⚠ 2026-08-14 起第一節(肱骨/股骨)的傾角**烤在幾何裡**(m08._leg 的傾斜 Group + 子關節 piv)
    //   ⇒ poses[0] 只轉根節點、轉不掉那個傾角,而肘/膝的樞軸已隨骨頭挪到遠端 ⇒ 收折仍然接得起來。
    //   poses[1] 起是**絕對**角(第一節不進關節鏈,geo.js segLimbF 只對 i>0 建群組)。
    for (const [sx, z, front] of [[-1, FR.fz, true], [1, FR.fz, true], [-1, FR.hz, false], [1, FR.hz, false]]) {
      const cx = { ...c, sx, front };
      // 四節腿 ⇒ 姿態陣列補到四格(第四格 = 掌骨/蹠骨那一節;省略會落回宣告的 base = 站姿)
      staticLimb(spine, front ? m08.legF(cx) : m08.legH(cx),
        [0, front ? 1.5 : -1.6, front ? -0.9 : 1.0, front ? -0.5 : 0.6],
        [sx * FR.legX, -0.06, z], [front ? 0.9 : 0.55, 0, sx * 0.3]);
    }
    // ---- 尾(進 rig.tailSegs;細長尾在飛行時當配平舵)----
    const tail = new THREE.Group();
    tail.position.set(0, FR.tailY, FR.tailZ);
    spine.add(tail);
    c._tail = m08.tail(c, tail, null);
  },

  lift(c) { return { wings: c.wings.map(({ w, outer, sgn }) => ({ w, outer, sgn })) }; },
  tail(c) { return c._tail || null; },

  mount(c) {
    // 使用者定案「武器在雙肩朝前」:同一具長狙擊莢與短莢,改掛在雙肩上、槍口朝航向
    const R = m08.rifle(c, c._spine, 0.46, 0.62, 0.5);
    const P = m08.pod(c, c._spine, -0.46, 0.62, 0.62);
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: P.muz, r: 0.04 }, heavy: { n: R.muz, r: 0.08 } },
      lightGlowM: [P.muz], heavyGlowM: [R.muz], heavyPivot: [],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [P.g], ref: P.g, muz: P.muz, fwd: 'z' },
        heavy: { nodes: [R.g], ref: R.g, muz: R.muz, fwd: 'z' } },
    };
  },
};
