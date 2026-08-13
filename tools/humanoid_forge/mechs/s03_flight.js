// ============ s03@flight 逐機零件檔(航空機體;dev-only)============
// s03「羽陣」始祖式可變機甲 —— **飛行型**(迅猛龍展羽:始祖鳥現形)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s03_flight_static.jpg / s03_ground_static.jpg
//
// 2026-08-13 使用者定案:「迅猛龍+始祖鳥:**重製為迅猛龍為主體**,地面形態前爪與尾巴的羽毛
// 收合,飛行形態時前爪展開變翅膀,尾巴羽毛也水平展開變尾翼,武器在後背朝前。」
//   ⇒ 舊制那台是另畫的一具「相控陣翼板」機身(瘦長軀幹 + 平板翼 + 配平尾桿),龍體一格也沒有;
//     gen.sil 的「前緣帶爪的寬羽翼 + 收翼摺成背脊天線」是 2D 圖的描述,使用者這一輪把
//     **翼板改回羽毛**、主體改回迅猛龍。
//   ⇒ 本檔因此**一顆自己的幾何都沒有**:整台由 `s03.js`(迅猛龍)的建構器組出來,
//     飛行型只把 `c.featherSpread` 從 0 轉到 1(前肢飛羽張開成翼、尾羽攤平成尾翼)。
import * as THREE from 'three';
import s03 from './s03.js';
import { staticLimb } from './_morph.js';

const FR = s03.frame;

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '羽陣・飛行型(s03 始祖式展羽)', hue: s03.hue, kind: 'air', height: s03.height,
  air: { tiltY: 2.4, bob: 0.07, top: 27, span: 5.0 },
  moveSig: { hover: 0.22, hoverF: 0.75, hoverA: 0.65, surge: 0.38, flare: 0.75, bank: 0.52 },
  castSig: { omni: 'roar', dir: 'kick' },
  doc: [
    ['龍體(75%)', '地面型軀幹/龍骨突/電戰艙/龍首(s03.body/neckHead)整組沿用'],
    ['前爪展開成翼 ×2', '同一組前肢 + 同一批飛羽(s03.featherRow,spread 0→1)⇒ rig.wings'],
    ['尾羽水平展開', 'chainF 六節尾 + s03.tailFan 攤平成水平尾翼(進 rig.tailSegs)'],
    ['獵足 ×2(後收)', '同一組後肢與鐮爪(s03.legH)向後收折'],
    ['武裝(後背朝前)', 's03.backGuns 同一組長短莢,槍口恆朝機首'],
  ],

  body(c, t) {
    c.featherSpread = 1;                 // ← 這一個旋鈕就是「羽毛收合 ↔ 展開」的全部
    const spine = new THREE.Group();
    t.add(spine);
    const chest = new THREE.Group();
    chest.position.set(...FR.chest);
    spine.add(chest);
    s03.body(c, spine, chest);
    const neck = new THREE.Group();
    neck.position.set(...FR.neck);
    neck.rotation.x = -0.35;             // 飛行時頸微伸、頭朝航向
    chest.add(neck);
    const head = new THREE.Group();
    head.position.set(...FR.head);
    neck.add(head);
    s03.neckHead(c, neck, head);
    c._spine = spine;

    // ---- 前肢張開成翼(rig.wings 的兩段樞軸:肩 = w、肘 = outer)----
    const wings = [];
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx, front: true };
      const w = new THREE.Group();
      w.position.set(sx * FR.legX, 0.08, FR.fz);
      w.rotation.set(-0.16, 0, sx * (Math.PI / 2 - 0.10));   // 肢體朝 −y ⇒ 繞 z 轉 90° 成翼展
      spine.add(w);
      const segs = s03.legF(cx);
      // 第一節畫在 w、其餘掛進 outer ⇒ 撲翼的內/外兩段(stepAerial 對 outer 加相位延遲)
      segs[0].draw(w);
      const outer = new THREE.Group();
      outer.position.y = -segs[0].len;
      outer.rotation.x = -0.25;
      w.add(outer);
      segs[1].draw(outer);
      const handG = new THREE.Group();
      handG.position.y = -segs[1].len;
      handG.rotation.x = -0.3;
      outer.add(handG);
      segs[2].draw(handG);
      wings.push({ w, outer, sgn: sx });
    }
    c._wings = wings;

    // ---- 後肢向後收折(同一組腿件)----
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx, front: false };
      staticLimb(spine, s03.legH(cx), [0, -1.5, 1.0], [sx * FR.legX, -0.02, FR.hz], [0.75, 0, sx * 0.16]);
    }

    // ---- 尾:六節配平尾 + 水平展開的尾羽扇 ----
    const tail = new THREE.Group();
    tail.position.set(0, FR.tailY, FR.tailZ);
    spine.add(tail);
    c._tail = s03.tail(c, tail);
  },

  lift(c) { return { wings: c._wings }; },
  tail(c) { return c._tail || null; },
  mount(c) { return s03.mount(c, { spine: c._spine }); },
};
