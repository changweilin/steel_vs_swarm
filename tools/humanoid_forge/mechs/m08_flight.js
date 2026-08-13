// ============ m08@flight 逐機零件檔(航空機體;dev-only)============
// m08「空號」隱形狙擊可變機甲 —— **飛行型**(owl 夜梟):鋸齒前緣短翼 + 絨質吸音蒙皮
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m08_flight_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「飛行型是一對前緣帶細鋸齒的寬短翼,翼面覆著絨質、輪廓被吃掉。」
// 「翼展短寬(不追求滑翔比,追求安靜)。」
// gen.note:「整台機 MUST 沒有高光與硬邊(絨質吸音層吃掉輪廓):畫出金屬反光就與
// 『沒有人記得看過她起飛』直接矛盾。」
//   ⇒ 全機材質一律 **metalness 0.15 以下**(這是這一台唯一不准調的旋鈕);翼前緣鋸齒
//     逐齒成件(SERR 齒數),翼後緣加流蘇(消音的第二個機構)。
//
// 2026-08-13 翼向修正(本輪唯一改動,其餘零件一格未動):
//   本機的前後基準 —— 軀幹 lathe 繞 x 轉 π/2 後,剖面 y 軸落在世界 z:鼻端 +0.62 / 尾端 −0.66,
//   加上尾羽扇在 z=−0.50、頭部群組在 z=+0.50 ⇒ **+z = 機首**(gunPodF/狙擊莢 fwd:'z' 同源)。
//   ① 鉤喙 rotation.y 由 +π/2 改為 −π/2(見該行的推導註解)。這是**唯一真的裝反**的一件。
//   ② 翼面 wingF 的剖面前緣頂點在局部 +z(geo.js:329 的 cz = +0.5)、前緣鋸齒排在 z≈+0.45、
//      後緣流蘇排在 z≈−0.40 ⇒ 翼的前緣本來就朝機首,**刻意不動**(改它才會真的裝反)。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, finF, fanF, wingF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const SERR = 11;              // 前緣鋸齒數(逐齒成件;貓頭鷹前緣梳的機構)
const SOFT = { metalness: 0.12 };   // 絨質吸音:全機 MUST 走這一組(不准有高光)

export default {
  label: '空號・飛行型(m08 夜梟)', hue: 0x8f86d0, kind: 'air', height: 3.4,
  air: { tiltY: 1.35, bob: 0.06, top: 24, span: 3.4 },
  moveSig: { hover: 0.10, hoverF: 0.5, hoverA: 0.90, surge: 0.25, flare: 0.92, bank: 0.42 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['絨質軀幹', '短寬軀幹(lathe)+ 絨質蒙皮分片 ×5(無硬邊、無高光)'],
    ['夜梟頭', '面盤(lathe 淺碟)+ 鉤喙 + 大眼 ×2 + 頭部消音進氣'],
    [`鋸齒前緣短翼 ×2`, `wingF 寬短翼 + 前緣鋸齒 ×${SERR}(逐齒成件)+ 後緣流蘇 ×9`],
    ['尾羽扇', 'fanF 五片寬尾羽(煞停用;flare 值全機種最高)'],
    ['長狙擊莢(背掛)', '背脊長莢(lathe)+ 消音節管 ×3 + 腳架'],
    ['爪 ×2', '收折的貓頭鷹爪(對趾;兩前兩後)'],
  ],

  body(c, t) {
    const { PAL, accent } = c;
    // 短寬軀幹 + 絨質蒙皮分片(分片壓過稜線 = 輪廓被吃掉)
    latheF(t, [[0, -0.66], [0.24, -0.5], [0.36, -0.05], [0.34, 0.32], [0.2, 0.56], [0, 0.62]], 14,
      0, 0, 0, PAL.main, SOFT).rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const th = i / 5 * Math.PI * 2;
      const p = prismF(t, [[-0.34, 0], [0.34, 0], [0.28, 0.18], [-0.28, 0.16]], 0.04,
        Math.sin(th) * 0.3, Math.cos(th) * 0.3, -0.06, PAL.mid, SOFT);
      p.rotation.y = Math.PI / 2;
      p.rotation.z = th;
    }
    // 夜梟頭:面盤(淺碟)+ 鉤喙 + 大眼 + 消音進氣
    const head = new THREE.Group();
    head.position.set(0, 0.2, 0.5);
    head.rotation.x = -0.12;
    t.add(head);
    latheF(head, [[0, 0], [0.3, 0.02], [0.32, 0.1], [0.26, 0.2]], 14, 0, 0, 0.12, PAL.lite, SOFT)
      .rotation.x = Math.PI / 2;                       // 面盤(貓頭鷹的聲學碟)
    for (const sx of [-1, 1]) {
      const eye = sphF(head, 0.1, sx * 0.13, 0.03, 0.2, accent, { emissive: accent, emissiveIntensity: 1.5 });
      eye.scale.z = 0.62;
    }
    // 鉤喙:多邊形的鉤尖在局部 +x、接面在 x≈0 ⇒ 樞轉 MUST 是 −π/2(+x → 世界 +z = 機首)。
    // 寫 +π/2 的話 +x → −z:鉤尖落在 head z = 0.26 − 0.14 = 0.12,恰好埋回面盤頂點、
    // 而且跑到雙眼(z 0.20)後方 —— 畫面上只表現成「這隻夜梟沒有喙」,不會有任何錯誤訊息。
    prismF(head, [[0, 0.06], [0.14, 0.01], [0.09, -0.1], [0.01, -0.05]], 0.07, 0, -0.03, 0.26,
      PAL.deep, SOFT).rotation.y = -Math.PI / 2;       // 鉤喙(鉤尖 → 機首 z=0.40,越過面盤前緣 0.32)
    for (const sx of [-1, 1])                          // 頭部消音進氣(面盤兩側的格柵)
      for (let i = 0; i < 3; i++)
        bxF(head, 0.02, 0.08, 0.06, sx * 0.28, 0.06 - i * 0.07, 0.1, PAL.deep, SOFT);
    // 爪 ×2(收折;對趾:兩前兩後)
    for (const sx of [-1, 1]) {
      const cl = new THREE.Group();
      cl.position.set(sx * 0.14, -0.3, 0.02);
      cl.rotation.x = 0.95;
      t.add(cl);
      cylF(cl, 0.035, 0.045, 0.22, 6, 0, -0.11, 0, PAL.mid, SOFT);
      for (let i = 0; i < 4; i++) {
        const th = i * Math.PI / 2 + Math.PI / 4;
        const f = cylF(cl, 0.016, 0.024, 0.17, 5, Math.sin(th) * 0.05, -0.26, Math.cos(th) * 0.05,
          PAL.deep, SOFT);
        f.rotation.x = Math.cos(th) * 0.6;
        f.rotation.z = -Math.sin(th) * 0.6;
      }
    }
    // 尾羽扇(寬尾羽 ×5;煞停用)
    const tail = fanF(t, {
      n: 5, arc: 1.0, len: 0.66, edgeF: 0.74, gap: 0.016,
      fin: { w0: 0.17, w1: 0.09, t: 0.03, sweep: 0.02 },
    }, 0, -0.04, -0.5, PAL.lite, SOFT);
    tail.g.rotation.x = -Math.PI / 2;
  },

  lift(c, t) {
    const { PAL } = c;
    const wings = [];
    // 寬短翼(不追滑翔比,追安靜)+ 前緣鋸齒 ×SERR + 後緣流蘇
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sx * 0.2, 0.1, 0.04);
      t.add(w);
      cylF(w, 0.05, 0.06, 0.34, 8, sx * 0.17, 0, 0, PAL.mid, SOFT).rotation.z = Math.PI / 2;
      const outer = new THREE.Group();
      outer.position.set(sx * 0.34, 0, 0);
      w.add(outer);
      const panel = wingF(outer, { span: 1.3, c0: 0.94, c1: 0.68, t: 0.11, sweep: 0.1, dihedral: 0.08 },
        0, 0, 0, PAL.main, SOFT);
      panel.scale.x = sx;
      for (let i = 0; i < SERR; i++) {                 // 前緣鋸齒(逐齒成件)
        const u = 0.1 + (i / (SERR - 1)) * 1.15;
        const s = finF(outer, { len: 0.1, w0: 0.09, w1: 0.02, t: 0.02 },
          sx * u, 0.01, 0.46 - u * 0.06, PAL.lite, SOFT);
        s.rotation.x = Math.PI / 2;
        s.rotation.z = sx * 0.1;
      }
      for (let i = 0; i < 9; i++) {                    // 後緣流蘇(消音的第二個機構)
        const u = 0.14 + (i / 8) * 1.1;
        const f = finF(outer, { len: 0.14, w0: 0.05, w1: 0.015, t: 0.012 },
          sx * u, -0.01, -0.44 + u * 0.08, PAL.lite, SOFT);
        f.rotation.x = -Math.PI / 2 + 0.2;
      }
      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  mount(c, F) {
    const { accent, PAL, K } = c;
    const t = F.tilt;
    // ---- 長狙擊莢(背掛):消音節管 ×3 + 腳架 ----
    const rifle = new THREE.Group();
    rifle.position.set(0, 0.28, -0.1);
    t.add(rifle);
    latheF(rifle, [[0, -0.9], [0.09, -0.8], [0.1, 0.4], [0.07, 0.8], [0, 0.9]], 10, 0, 0, 0, PAL.deep, SOFT)
      .rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++)                        // 消音節管(前段三節)
      cylF(rifle, 0.12 - i * 0.012, 0.12 - i * 0.012, 0.2, 10, 0, 0, 0.5 + i * 0.22, PAL.mid, SOFT)
        .rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) {                        // 腳架(收折)
      const bp = cylF(rifle, 0.016, 0.02, 0.34, 5, sx * 0.06, -0.06, 0.3, PAL.mid, SOFT);
      bp.rotation.x = 1.2;
      bp.rotation.z = -sx * 0.3;
    }
    const hMuz = cylF(rifle, 0.075, 0.075, 0.03, 10, 0, 0, 1.06 * K.barrelF, accent,
      { emissive: accent, emissiveIntensity: 1.2 });
    hMuz.rotation.x = Math.PI / 2;
    // 輕武器:頦下短莢(同樣絨質)
    const lp = gunPodF(t, { len: 0.58 * K.barrelF, r: 0.08, accent }, 0, -0.12, 0.6, PAL.mid, SOFT);
    return {
      muzzles: { light: { n: lp.muz, r: 0.04 }, heavy: { n: hMuz, r: 0.08 } },
      lightGlowM: [lp.muz], heavyGlowM: [hMuz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [rifle], ref: rifle, muz: hMuz, fwd: 'z' } },
    };
  },
};
