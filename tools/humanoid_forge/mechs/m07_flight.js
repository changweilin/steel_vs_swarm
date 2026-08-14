// ============ m07@flight 逐機零件檔(航空機體;dev-only)============
// m07「落閘」區域拒止可變機甲 —— **飛行型**(犀金龜:鞘翅掀開 + 膜翅高速振動)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m07_flight_static.jpg / m07_ground_static.jpg
//
// 2026-08-13 使用者定案:「犀角金龜:頭頂的角大一點,翅膀大一點,**地面模式收起翅膀**」+
// 總則「盡量用相同零件變形切換地面/飛行形態」。
//   ⇒ 兩張 2D 定案圖本來就是**同一具軀體**,差別只有鞘翅開闔 ⇒ 本檔**一顆自己的幾何都沒有**:
//     整台由 `m07.js`(陣地態 = 地面型)的建構器組出來,飛行型只把鞘翅掀起、膜翅展開。
// gen.note:「鞘翅是**裝甲**、膜翅才是**動力**:飛行時鞘翅 MUST 掀開不動、膜翅高速振動」
//   ⇒ **只有膜翅進 rig.wings**;`air.insect = true` ⇒ stepAerial 走昆蟲震翅分支
//     (高頻 8 字軌跡 + 每半衝程翼面翻轉),不是鳥類撲翼。
import * as THREE from 'three';
import m07 from './m07.js';
import { staticLimb } from './_morph.js';

const FR = m07.frame;

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝;舊制 0x5fa353 是綠的,2D 圖是藍的)
  label: '落閘・飛行型(m07 犀金龜)', kind: 'air', height: m07.height,
  air: { tiltY: 2.6, bob: 0.1, top: 18, insect: true, span: 6.0 },
  moveSig: { hover: 0.42, hoverF: 0.7, hoverA: 1.35, surge: 0.15, flare: 0.60, bank: 0.20 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['甲殼軀幹', '陣地態的甲殼腹部 + 前胸背板 + 腹節環(m07.body)整組沿用'],
    ['犀角(加大)', 'm07.horn:上挑主角 finF len 1.6 + 側叉 ×2 + 角根鎧環 + 複眼'],
    ['鞘翅 ×2(掀起)', 'm07.elytron 同一片殼:繞前後軸滾轉掀到體側 —— **不進 rig.wings**'],
    ['膜翅 ×2(展開)', 'm07.memWing 同一對膜:內/外兩段樞軸展平 ⇒ 唯一的動力面'],
    ['六足(收折)', '同一組足件(m07.legF/legH/_leg)向後收折成起落姿'],
    ['背部防空砲塔', 'm07.turret 同一具雙管砲塔 + 頭下短莢'],
  ],

  body(c, t) {
    const { PAL } = c;
    // 甲殼:直接用四足鷹架的兩個掛點(spine / chest)當成機身的前後兩段
    const spine = new THREE.Group();
    t.add(spine);
    const chest = new THREE.Group();
    chest.position.set(...FR.chest);
    spine.add(chest);
    // ⚠ m07.body 會順手建鞘翅/膜翅/中足並把 pivot 記進 c.elytra / c.memWings —— 飛行型只重設
    // 那幾個 pivot 的旋轉,MUST NOT 再建一組(那就是第二對翅膀,而畫面上只表現成「翅膀變厚了」)
    m07.body(c, spine, chest);
    const neck = new THREE.Group();
    neck.position.set(...FR.neck);
    chest.add(neck);
    const head = new THREE.Group();
    head.position.set(...FR.head);
    neck.add(head);
    m07.neckHead(c, neck, head);
    c._spine = spine; c._head = head;

    // ---- 鞘翅掀起(裝甲讓位;掀起後固定不動)----
    c.elytra.forEach((eg, i) => {
      const sx = i === 0 ? -1 : 1;
      eg.rotation.set(-0.10, -sx * 0.28, sx * 1.22);   // 繞前後軸滾轉:外緣向兩側掀起 + 尾端外撇
    });
    // ---- 膜翅展開(唯一動力面;內/外兩段回到展平)----
    for (const mw of c.memWings) {
      mw.w.rotation.set(0, 0, mw.sgn * 0.10);
      mw.outer.rotation.set(0, 0, 0);
    }

    // ---- 六足向後收折(同一組足件;四足鷹架的規格陣列由 staticLimb 靜態組起來)----
    for (const [sx, z, front] of [[-1, FR.fz, true], [1, FR.fz, true], [-1, FR.hz, false], [1, FR.hz, false]]) {
      const cx = { ...c, sx, front };
      staticLimb(spine, front ? m07.legF(cx) : m07.legH(cx),
        [0, front ? 1.15 : -1.25, front ? -0.7 : 0.8],
        [sx * FR.legX, -0.1, z], [0.35, 0, sx * 0.78]);
    }
  },

  lift(c) { return { wings: c.memWings.map(({ w, outer, sgn }) => ({ w, outer, sgn })) }; },

  mount(c) { return m07.mount(c, { spine: c._spine, head: c._head }); },
};
