// ============ s10@flight Mech Component (Flight Variant; dev-only) ============
// s10 "Plumage Array" Archaeopteryx-type variable mech -- Flight Variant (velociraptor spreading feathered wings).
// Contains zero local geometry primitives; entirely composed from s10.js generators.
// Flight stance sets c.featherSpread = 1 (foreleg remiges deploy into wings, rectrices flatten into horizontal stabilizer fan).
import * as THREE from 'three';
import s10 from './s10.js';
import { staticLimb } from './_morph.js';

const FR = s10.frame;

export default {
  // Hue MUST match ground variant (same vehicle livery).
  label: '羽陣・飛行型(s10 始祖式展羽)', kind: 'air', height: s10.height,
  air: { tiltY: 2.4, bob: 0.07, top: 27, span: 5.0 },
  moveSig: { hover: 0.22, hoverF: 0.75, hoverA: 0.65, surge: 0.38, flare: 0.75, bank: 0.52 },
  castSig: { omni: 'roar', dir: 'kick' },
  doc: [
    ['龍體(75%)', '地面型軀幹/龍骨突/電戰艙/龍首(s10.body/neckHead)整組沿用'],
    ['前爪展開成翼 ×2', '同一組前肢 + 同一批羽(s10.featherRow,spread 0→1);展翼角掛靜態 Group 上(w.rotation.z 每幀被覆寫)。翼展(揮翼相位最大值)**8.30m**,÷ 全長 8.31 = **1.00**'],
    ['三層羽', '覆羽(肱骨)/ 次級飛羽(前臂)/ 初級飛羽(掌,最長且後掠最深)—— 一片羽 = 一顆 finF,羽面攤平朝上。`len × foldF` 是收合長度、`len` 是展開長度 ⇒ 加翼展**不動**地面型收翼姿態'],
    ['尾羽水平展開', 'chainF **十二節** 4.44m 硬直長骨尾 + s10.tailVane:羽片沿尾**兩側成對**往後拖,攤平成始祖鳥的長菱形尾翼(進 rig.tailSegs);羽寬 0.24 ⇒ 俯視不再露出尾椎的人字紋'],
    ['獵足 ×2(後收)', '同一組四節後肢(股/脛/**蹠**/趾)與鐮爪(s10.legH)向後收折;段長 股 1 : 脛 1.07 : 蹠 0.50 : 趾 0.31'],
    ['武裝(後背朝前)', 's10.backGuns 同一組長短莢,槍口恆朝機首'],
  ],

  body(c, t) {
    c.featherSpread = 1;                 // Morph knob: 0 = folded plumage, 1 = deployed wings/tail fan.
    const spine = new THREE.Group();
    t.add(spine);
    const chest = new THREE.Group();
    chest.position.set(...FR.chest);
    spine.add(chest);
    s10.body(c, spine, chest);
    const neck = new THREE.Group();
    neck.position.set(...FR.neck);
    neck.rotation.x = -0.35;             // Extend neck forward along flight heading.
    chest.add(neck);
    const head = new THREE.Group();
    head.position.set(...FR.head);
    neck.add(head);
    s10.neckHead(c, neck, head);
    c._spine = spine;

    // ---- Forelimbs deploy as wings (rig.wings pivots: shoulder = w, elbow = outer) ----
    // Wing deployment angle MUST attach to an intermediate static Group (wg) under w:
    // stepAerial overwrites w.rotation.z and outer.rotation.z every frame via absolute assignment.
    // Setting deployment angle on w directly gets overwritten to 0 on frame 1.
    // Local limb points along -y; 90 deg rotation converts local x into the world vertical axis,
    // making local rotation.x function as wing sweep rather than pitch.
    const wings = [];
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx, front: true };
      const w = new THREE.Group();
      w.position.set(sx * FR.legX, 0.08, FR.fz);
      w.rotation.x = -0.16;                                  // Angle of attack (rotation.x preserved by stepAerial)
      spine.add(w);
      const wg = new THREE.Group();
      wg.rotation.z = sx * (Math.PI / 2 - 0.13);             // Rotate -y limb 90 deg into horizontal wingspan + 0.13 dihedral
      w.add(wg);
      const segs = s10.legF(cx);
      // Segment 0 rendered into wg, remaining into outer for two-stage wing-flapping phase lag
      segs[0].draw(wg);
      const outer = new THREE.Group();
      const pv = segs[1].piv;
      outer.position.set(pv ? pv[0] : 0, pv ? pv[1] : -segs[0].len, pv ? pv[2] : 0);
      outer.rotation.x = 0.13;                               // Outer wing sweep (local x aligns with vertical axis)
      wg.add(outer);
      segs[1].draw(outer);
      const handG = new THREE.Group();
      const pv2 = segs[2].piv;
      handG.position.set(pv2 ? pv2[0] : 0, pv2 ? pv2[1] : -segs[1].len, pv2 ? pv2[2] : 0);
      handG.rotation.x = 0.17;                               // Wingtip progressive sweep
      outer.add(handG);
      segs[2].draw(handG);
      wings.push({ w, outer, sgn: sx });
    }
    c._wings = wings;

    // ---- Hindlimbs folded aft (shares 4-segment leg assembly with ground variant) ----
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx, front: false };
      staticLimb(spine, s10.legH(cx), [0, 1.15, -0.95, 0.55], [sx * FR.legX, -0.02, FR.hz], [0.62, 0, sx * 0.16]);
    }

    // ---- Tail: 12-segment caudal chain + horizontal rectrice fan (trim lives in s10.tail) ----
    const tail = new THREE.Group();
    tail.position.set(0, FR.tailY, FR.tailZ);
    spine.add(tail);
    c._tail = s10.tail(c, tail);
  },

  lift(c) { return { wings: c._wings }; },
  tail(c) { return c._tail || null; },
  mount(c) { return s10.mount(c, { spine: c._spine }); },
};
