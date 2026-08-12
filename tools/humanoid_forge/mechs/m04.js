// ============ m04 逐機零件檔(航空機體;dev-only)============
// m04「無名」鷹式偵獵機(avian / creature:'eagle'):分片羽刃翼 + 上翹指羽 + 羽毛飛彈 ×4
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m04_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「一對由分片羽刃構成的寬翼,翼端指羽分開上翹;翼下只掛得下
// 寥寥幾枚細長的『羽毛』飛彈,身體小得不成比例。」「每片羽刃都是一片獨立可動的匿蹤面板。」
// gen.note:「掛載 MUST 少得誇張(4 枚上下):那是它換來匿蹤的代價。」
//   ⇒ 掛架恰 **4 枚**(MISSILES 常數);羽刃一律走 fanF(多零件羽扇),MUST NOT 一片薄板了事。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, prismF, latheF, finF, fanF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const MISSILES = 4;           // gen.note 明列:掛載少得誇張,恰 4 枚

export default {
  label: '無名(m04 鷹式偵獵機)', hue: 0xd23f34, kind: 'air', height: 3.2,
  air: { tiltY: 1.35, bob: 0.06, top: 32, span: 4.0 },
  moveSig: { hover: 0.55, hoverF: 1.6, hoverA: 0.60, surge: 0.92, flare: 0.90, bank: 0.85 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['小型軀幹', '極小流線軀幹(lathe)+ 龍骨突 + 尾羽扇(fanF ×5)'],
    ['頭部感測莢', '鷹首殼(prism)+ 鉤喙 + 眉稜 + 雙眼'],
    ['分片羽刃翼 ×2', '內翼 fanF(7 片主羽)+ 外翼 fanF(5 片)—— 每片獨立面板'],
    ['上翹指羽', '外翼端 5 根指羽(finF,逐根上翹角遞增)'],
    [`羽毛飛彈 ×${MISSILES}`, '翼下細長飛彈(lathe)+ 尾翼片;恰 4 枚(匿蹤的代價)'],
    ['抓握爪 ×2', '收折於腹下的爪(cyl 三指)'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 小型軀幹(身體小得不成比例)+ 龍骨突
    latheF(t, [[0, -0.56], [0.11, -0.42], [0.19, -0.05], [0.18, 0.24], [0.1, 0.42], [0, 0.48]], 12,
      0, 0, 0.02, PAL.main, { metalness: 0.62 }).rotation.x = Math.PI / 2;
    prismF(t, [[-0.34, 0], [0.32, 0], [0.24, -0.2], [-0.28, -0.15]], 0.05, 0, -0.16, 0.06, PAL.deep, { metalness: 0.7 })
      .rotation.y = Math.PI / 2;
    // 鷹首:頭殼 + 鉤喙 + 眉稜 + 雙眼
    const head = new THREE.Group();
    head.position.set(0, 0.16, 0.52);
    t.add(head);
    prismF(head, [[-0.16, -0.1], [0.2, -0.12], [0.26, 0.02], [0.16, 0.14], [-0.14, 0.16]], 0.2,
      0, 0, 0, PAL.mid, { metalness: 0.65 }).rotation.y = Math.PI / 2;
    const beak = prismF(head, [[0, 0.06], [0.2, 0.02], [0.14, -0.12], [0.02, -0.06]], 0.09,
      0, -0.02, 0.2, 0xd8b24a, { metalness: 0.7 });
    beak.rotation.y = Math.PI / 2;
    bxF(head, 0.2, 0.035, 0.07, 0, 0.11, 0.12, PAL.deep, { metalness: 0.75 });          // 眉稜(鷹的兇相)
    for (const sx of [-1, 1]) sphF(head, 0.045, sx * 0.09, 0.04, 0.13, accent, { emissive: accent, emissiveIntensity: 2.1 });
    // 尾羽扇(多零件;fanF 排在 XY 平面 ⇒ 轉成水平尾羽)
    const tail = fanF(t, {
      n: 5, arc: 1.15, len: 0.72, edgeF: 0.68, gap: 0.014,
      fin: { w0: 0.13, w1: 0.06, t: 0.028, sweep: 0.03 },
    }, 0, -0.02, -0.5, PAL.lite, { metalness: 0.55 });
    tail.g.rotation.x = -Math.PI / 2;
    tail.g.rotation.z = 0;
    // 抓握爪 ×2(收折於腹下)
    for (const sx of [-1, 1]) {
      const cl = new THREE.Group();
      cl.position.set(sx * 0.12, -0.24, 0.04);
      cl.rotation.x = 0.8;
      t.add(cl);
      cylF(cl, 0.03, 0.04, 0.2, 6, 0, -0.1, 0, PAL.deep, { metalness: 0.8 });
      for (let i = 0; i < 3; i++) {
        const th = -0.4 + i * 0.4;
        const f = cylF(cl, 0.015, 0.022, 0.16, 5, Math.sin(th) * 0.05, -0.24, Math.cos(th) * 0.05, GUNMETAL, { metalness: 0.85 });
        f.rotation.x = 0.5;
      }
    }
  },

  lift(c, t) {
    const { PAL, accent } = c;
    const wings = [];
    // 分片羽刃翼:內翼(7 片)→ 外翼(5 片)兩段樞軸;每片都是獨立面板
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sx * 0.16, 0.1, 0.06);
      t.add(w);
      cylF(w, 0.045, 0.06, 0.5, 8, sx * 0.25, 0, 0, PAL.mid, { metalness: 0.7 }).rotation.z = Math.PI / 2;
      const inner = fanF(w, {
        n: 7, arc: 0.62, len: 0.9, edgeF: 0.8, gap: 0.02,
        fin: { w0: 0.17, w1: 0.09, t: 0.03, sweep: 0.06, camber: 0.03 },
      }, sx * 0.3, 0, 0, PAL.main, { metalness: 0.55 });
      inner.g.rotation.z = sx * Math.PI / 2;            // 羽片由樞軸往翼展方向排開
      inner.g.rotation.y = sx * 0.1;
      const outer = new THREE.Group();
      outer.position.set(sx * 0.52, 0, -0.02);
      w.add(outer);
      const of = fanF(outer, {
        n: 5, arc: 0.5, len: 1.1, edgeF: 0.7, gap: 0.022,
        fin: { w0: 0.14, w1: 0.06, t: 0.026, sweep: 0.12, camber: 0.04 },
      }, sx * 0.1, 0, 0, PAL.main, { metalness: 0.55 });
      of.g.rotation.z = sx * Math.PI / 2;
      // 上翹指羽 ×5(逐根上翹角遞增 —— 鷹翼端的識別點)
      of.fins.forEach((f, i) => { f.rotation.x = -0.1 - i * 0.12; });
      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // 羽毛飛彈 ×4(細長;翼下貼身掛,不用粗掛梁 —— 匿蹤)
    const muzzes = [];
    for (let i = 0; i < MISSILES; i++) {
      const sx = i < MISSILES / 2 ? -1 : 1;
      const off = (i % 2) * 0.24 + 0.34;
      const m = latheF(t, [[0, -0.42], [0.045, -0.34], [0.05, 0.22], [0, 0.34]], 8,
        sx * off, -0.2, 0.04, PAL.lite, { metalness: 0.7 });
      m.rotation.x = Math.PI / 2;
      for (const s2 of [-1, 1])
        finF(t, { len: 0.14, w0: 0.05, w1: 0.02, t: 0.014 }, sx * off, -0.2, -0.3, PAL.deep, { metalness: 0.7 })
          .rotation.z = s2 * 1.4;
      const mz = cylF(t, 0.035, 0.035, 0.02, 8, sx * off, -0.2, 0.4, accent,
        { emissive: accent, emissiveIntensity: 1.3 });
      mz.rotation.x = Math.PI / 2;
      muzzes.push(mz);
    }
    // 頦下雙管(輕武器)
    const lp = gunPodF(t, { len: 0.62 * K.barrelF, r: 0.08, accent }, 0, -0.1, 0.62, dark, { metalness: 0.8 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.04 }, heavy: { n: muzzes[3], r: 0.08 } },
      lightGlowM: [lp.muz], heavyGlowM: muzzes,
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [lp.g], ref: lp.g, muz: muzzes[3], fwd: 'z' } },
    };
  },
};
