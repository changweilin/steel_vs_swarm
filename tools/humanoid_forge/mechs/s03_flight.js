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
  label: '羽陣・飛行型(s03 始祖式展羽)', kind: 'air', height: s03.height,
  air: { tiltY: 2.4, bob: 0.07, top: 27, span: 5.0 },
  moveSig: { hover: 0.22, hoverF: 0.75, hoverA: 0.65, surge: 0.38, flare: 0.75, bank: 0.52 },
  castSig: { omni: 'roar', dir: 'kick' },
  doc: [
    ['龍體(75%)', '地面型軀幹/龍骨突/電戰艙/龍首(s03.body/neckHead)整組沿用'],
    ['前爪展開成翼 ×2', '同一組前肢 + 同一批羽(s03.featherRow,spread 0→1);展翼角掛靜態 Group 上(w.rotation.z 每幀被覆寫)。翼展(揮翼相位最大值)**8.30m**,÷ 全長 8.31 = **1.00**'],
    ['三層羽', '覆羽(肱骨)/ 次級飛羽(前臂)/ 初級飛羽(掌,最長且後掠最深)—— 一片羽 = 一顆 finF,羽面攤平朝上。`len × foldF` 是收合長度、`len` 是展開長度 ⇒ 加翼展**不動**地面型收翼姿態'],
    ['尾羽水平展開', 'chainF **十二節** 4.44m 硬直長骨尾 + s03.tailVane:羽片沿尾**兩側成對**往後拖,攤平成始祖鳥的長菱形尾翼(進 rig.tailSegs);羽寬 0.24 ⇒ 俯視不再露出尾椎的人字紋'],
    ['獵足 ×2(後收)', '同一組四節後肢(股/脛/**蹠**/趾)與鐮爪(s03.legH)向後收折;段長 股 1 : 脛 1.07 : 蹠 0.50 : 趾 0.31'],
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
    // ⚠ **展翼角 MUST 掛在 w 底下的靜態 Group**:stepAerial 每幀 `w.rotation.z = sgn·sin(…)·amp`
    //   是**絕對指派**(locomotion.js:667)⇒ 寫在 w 上的那個 π/2 開場就被歸零,兩翼於是
    //   垂在體側往後拖(b_s03f_front.png / b_s03f_side45.png 的病灶),而每一條斷言都正常。
    //   `outer.rotation.z` 同樣被覆寫;`rotation.x` 兩者都安全 —— 展開後肢體局部 x 已經被
    //   那 90° 轉成**世界垂直軸** ⇒ x 在翼上讀作「後掠」,正好拿來排初級/次級的翼形。
    const wings = [];
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx, front: true };
      const w = new THREE.Group();
      w.position.set(sx * FR.legX, 0.08, FR.fz);
      w.rotation.x = -0.16;                                  // 迎角(x 不被覆寫)
      spine.add(w);
      const wg = new THREE.Group();
      wg.rotation.z = sx * (Math.PI / 2 - 0.13);             // 肢體朝 −y ⇒ 轉 90° 成水平翼展 + 上反 0.13
      w.add(wg);
      const segs = s03.legF(cx);
      // 第一節畫在 wg、其餘掛進 outer ⇒ 撲翼的內/外兩段(stepAerial 對 outer 加相位延遲)
      segs[0].draw(wg);
      const outer = new THREE.Group();
      const pv = segs[1].piv;
      outer.position.set(pv ? pv[0] : 0, pv ? pv[1] : -segs[0].len, pv ? pv[2] : 0);
      outer.rotation.x = 0.13;                               // 外翼後掠(展開後 x = 垂直軸 ⇒ 這是掠角不是俯仰)
      wg.add(outer);
      segs[1].draw(outer);
      const handG = new THREE.Group();
      const pv2 = segs[2].piv;
      handG.position.set(pv2 ? pv2[0] : 0, pv2 ? pv2[1] : -segs[1].len, pv2 ? pv2[2] : 0);
      handG.rotation.x = 0.17;                               // 翼端(掌)再掠一點
      outer.add(handG);
      segs[2].draw(handG);
      wings.push({ w, outer, sgn: sx });
    }
    c._wings = wings;

    // ---- 後肢向後收折(同一組腿件;四節 ⇒ 姿態表四格)----
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx, front: false };
      staticLimb(spine, s03.legH(cx), [0, 1.15, -0.95, 0.55], [sx * FR.legX, -0.02, FR.hz], [0.62, 0, sx * 0.16]);
    }

    // ---- 尾:十二節長骨尾 + 水平展開的尾羽面(姿態與配平角全住 s03.tail)----
    const tail = new THREE.Group();
    tail.position.set(0, FR.tailY, FR.tailZ);
    spine.add(tail);
    c._tail = s03.tail(c, tail);
  },

  lift(c) { return { wings: c._wings }; },
  tail(c) { return c._tail || null; },
  mount(c) { return s03.mount(c, { spine: c._spine }); },
};
