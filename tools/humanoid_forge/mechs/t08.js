// ============ t08 逐機零件檔(航空機體;dev-only)============
// t08「詠嘆調」電戰無人機(avian / creature:'dragon'):分節長身東亞龍 + 膜翼 + 口腔波束艙
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t08_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「長身無足的東亞龍形,一對膜翼從背側展開;頭部占比大,
// 張口時看得見整排飛彈巢與波束口。」「身體分節、可彎;頭長約身長的六分之一。」
// gen.note:「牠不噴火:發射演出 MUST 是聲波/波束(駐波環、空氣扭曲)。」
//   ⇒ 口內是**飛彈巢 + 波束環**,MUST NOT 出現焰口/噴嘴語彙。
// 分節長身走 chainF(多零件),整條掛 rig.tailSegs ⇒ stepAerial 依巡航速度甩尾。
// ⚠ chainF 陷阱(geo.js 檔頭):rot0/rotD 靜姿角會被 whipTail 每幀覆寫 ——
//   龍身的基礎波形因此寫在**節身幾何**(逐節鱗脊高度遞變),不靠靜姿角。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, prismF, latheF, finF, chainF, gunPodF,
  IRON, GUNMETAL, COAL, BRASS,
} from '../geo.js';

export default {
  label: '詠嘆調(t08 電戰無人機)', hue: 0xffb8dd, kind: 'air', height: 4.2,
  air: { tiltY: 1.5, bob: 0.09, top: 24, span: 5.0 },
  moveSig: { hover: 0.35, hoverF: 0.6, hoverA: 1.10, surge: 0.35, flare: 0.70, bank: 0.45 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['龍首', '大占比頭殼(prism)+ 上下顎(可見開口)+ 鬚(cables 語彙以細桿代)+ 雙角'],
    ['口腔波束艙', '口內飛彈巢 ×6(cyl 巢口)+ 駐波環 ×3(torus 感)—— 不是焰口'],
    ['分節長身', 'chainF 九節(逐節鱗脊遞變)+ 節間軸環;整條進 rig.tailSegs'],
    ['膜翼 ×2', '背側展開:內/外兩段樞軸 + 三根翼指 + 翼膜(prism 薄片)'],
    ['背脊天線列', '沿身列的天線鰭 ×5(finF,逐片變短)'],
    ['尾鰭舵', '末節菱形尾鰭 ×2'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 前段軀幹(翼根所在;龍身其餘由 tail 的 chainF 接下去)
    latheF(t, [[0, -0.5], [0.24, -0.36], [0.3, 0], [0.28, 0.32], [0.16, 0.54], [0, 0.6]], 12,
      0, 0, 0.2, PAL.main, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    // ---- 龍首(頭長 ≈ 身長 1/6;占比大)----
    const head = new THREE.Group();
    head.position.set(0, 0.18, 0.86);
    head.rotation.x = -0.16;
    t.add(head);
    prismF(head, [[-0.3, -0.06], [0.42, -0.12], [0.56, 0.02], [0.4, 0.18], [-0.26, 0.24]], 0.36,
      0, 0.04, 0, PAL.mid, { metalness: 0.65 }).rotation.y = Math.PI / 2;       // 上顎頭殼
    const jaw = prismF(head, [[-0.24, 0], [0.36, -0.04], [0.34, -0.16], [-0.22, -0.14]], 0.3,
      0, -0.14, 0, PAL.deep, { metalness: 0.65 });
    jaw.rotation.y = Math.PI / 2;
    jaw.rotation.x = 0.24;                                                       // 張口
    for (const sx of [-1, 1]) {                                                  // 雙角(後掠)
      const horn = finF(head, { len: 0.52, w0: 0.1, w1: 0.03, t: 0.05, sweep: -0.3 },
        sx * 0.12, 0.2, -0.14, BRASS, { metalness: 0.8 });
      horn.rotation.x = 0.7;
      horn.rotation.z = -sx * 0.24;
      const wh = cylF(head, 0.014, 0.02, 0.5, 5, sx * 0.16, -0.02, 0.3, BRASS, { metalness: 0.8 });  // 鬚
      wh.rotation.x = 1.2;
      wh.rotation.z = -sx * 0.4;
      sphF(head, 0.06, sx * 0.15, 0.12, 0.24, accent, { emissive: accent, emissiveIntensity: 2.0 });
    }
    // 口腔波束艙:飛彈巢 ×6 + 駐波環 ×3(全在口內;不是焰口)
    for (let i = 0; i < 6; i++) {
      const u = i % 3 - 1, v = i < 3 ? 0 : 1;
      const nest = cylF(head, 0.045, 0.045, 0.16, 6, u * 0.1, -0.02 - v * 0.09, 0.2, COAL, { metalness: 0.9 });
      nest.rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 3; i++)
      cylF(head, 0.16 - i * 0.03, 0.16 - i * 0.03, 0.02, 12, 0, -0.05, 0.06 + i * 0.1, accent,
        { emissive: accent, emissiveIntensity: 1.4 + i * 0.3, transparent: true, opacity: 0.7 })
        .rotation.x = Math.PI / 2;
    // 背脊天線列(逐片變短)
    for (let i = 0; i < 5; i++)
      finF(t, { len: 0.34 - i * 0.045, w0: 0.1, w1: 0.03, t: 0.03, sweep: -0.1 },
        0, 0.26, 0.5 - i * 0.22, PAL.lite, { metalness: 0.7 }).rotation.x = -0.24;
  },

  lift(c, t) {
    const { PAL, dark } = c;
    const wings = [];
    // 膜翼(背側展開):內/外兩段樞軸 + 三根翼指 + 翼膜
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sx * 0.24, 0.2, 0.16);
      t.add(w);
      cylF(w, 0.07, 0.09, 0.8, 8, sx * 0.4, 0, 0, PAL.mid, { metalness: 0.7 }).rotation.z = Math.PI / 2;
      const outer = new THREE.Group();
      outer.position.set(sx * 0.8, 0, 0);
      w.add(outer);
      cylF(outer, 0.045, 0.065, 0.66, 8, sx * 0.33, 0, -0.02, PAL.mid, { metalness: 0.7 }).rotation.z = Math.PI / 2;
      [1.5, 1.16, 0.8].forEach((len, i) => {
        const ang = -0.28 + i * 0.34;
        const f = cylF(outer, 0.022, 0.04, len, 6, sx * (0.66 + Math.cos(ang) * len / 2), 0, -Math.sin(ang) * len / 2,
          PAL.deep, { metalness: 0.75 });
        f.rotation.z = Math.PI / 2;
        f.rotation.y = sx * ang;
      });
      const mem = prismF(outer, [[0, 0], [2.0, -0.62], [1.9, 0.4], [0.12, 0.26]], 0.014,
        sx * 0.66, 0, 0, PAL.lite, { metalness: 0.2, transparent: true, opacity: 0.68 });
      mem.rotation.x = -Math.PI / 2;
      mem.scale.x = sx;
      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  tail(c, t) {
    const { PAL, accent } = c;
    // 分節長身(九節):基礎波形寫在節身幾何(逐節鱗脊高度遞變),不靠靜姿角
    const ch = chainF(t, {
      n: 9, x: 0, y: 0.02, z: -0.4, len0: 0.3, len1: 0.2, r0: 0.24, r1: 0.07,
      rot0: 0, rotD: 0, seg: 8,
      drawSeg: (gp, i, { r }) => {
        finF(gp, { len: r * 1.5, w0: r * 0.9, w1: r * 0.3, t: 0.025, sweep: 0.05 }, 0, r * 0.6, -0.06,
          PAL.lite, { metalness: 0.65 }).rotation.x = -0.3 + i * 0.05;
        if (i === 8) for (const sx of [-1, 1])                                    // 尾鰭舵
          finF(gp, { len: 0.34, w0: 0.05, w1: 0.24, t: 0.03, sweep: -0.12 }, sx * 0.04, 0, -0.16,
            accent, { metalness: 0.6 }).rotation.z = sx * 1.1;
      },
    }, PAL.main, { metalness: 0.62 });
    return ch.segs;
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    // 電戰機的武裝:頦下波束莢(輕)+ 腹掛長莢(重)
    const lp = gunPodF(t, { len: 0.8 * K.barrelF, r: 0.1, accent }, 0, -0.14, 0.94, dark, { metalness: 0.8 });
    const hp = gunPodF(t, { len: 1.26 * K.barrelF, r: 0.16, accent }, 0, -0.36, 0.34, dark, { metalness: 0.8 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.06 }, heavy: { n: hp.muz, r: 0.11 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
