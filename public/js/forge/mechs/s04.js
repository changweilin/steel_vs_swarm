// ============ s04 逐機零件檔(航空機體;dev-only)============
// s04「鐵鍬」零式突擊翼(fixed / wing:'zero'):A6M 零式的低翼單翼 + 星型引擎牽引槳
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s04_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「低翼單翼的細長機身,機首一具短粗的星型引擎與大直徑牽引槳,
// 座艙罩位置換成一顆感測球;翼端上翹得很淺。」
// gen.note:「槳 MUST 畫成真的會轉的動力件(有槳轂與變距機構)—— 它是這台機最後一件武器。」
//   ⇒ 槳轂走 rotorF(自帶槳轂旋成體),另補**變距連桿**;槳進 spin 名冊。
// 定翼機 MUST 帶 air.level = 1(stepAerial:巡航機身水平,不隨前速低頭),moveSig.flare = 0。
// ---- 2026-08-14 這一輪(使用者:「參考舊版設計重新渲染外觀,只改外觀不增減零件」)----
// 舊版 = 退役的 legacy_models.js buildFixedWing() 的 `W === 'zero'` 分支。
// 只動色階與尺寸,零件一件未增減:翼面/尾翼組 → `lite`(舊版翼面比機身亮一階)、
// 翼端識別帶 → accent、整流罩 → PAL.mid、內翼弦 0.78→0.95、上反 0.2→0.12(淺上翹)、
// 扭轉 −0.05→0(舊版翼面無扭轉)。
// 徽記那一半(2026-08-14 使用者:「零式的雙翼上下都要印紅日」)= 主翼掛 `userData.hinomaru`,
// 由 forge.js 收尾轉呼 paint.js `paintUnit` → `paintWingRoundel` 沿 Y 三平面投影 ⇒ 雙翼正反共四枚。
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, wingF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

export default {
  label: '鐵鍬(s04 零式突擊翼)', kind: 'air', height: 3.6,
  air: { tiltY: 1.3, bob: 0.03, top: 34, level: true, span: 3.5 },
  moveSig: { hover: 0.55, hoverF: 1.4, hoverA: 0.12, surge: 0.76, flare: 0, bank: 0.90 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['細長機身', '前粗後收的旋成機身(lathe)+ 機背脊條 + 尾錐'],
    ['星型引擎', '短粗引擎環(lathe)+ 九缸放射汽缸(cyl ×9)+ 排氣短管'],
    ['牽引槳', '三葉大直徑槳(rotorF)+ 槳轂 + 變距連桿 ×3'],
    ['感測球', '原座艙罩位置的球形感測頭 + 環形基座(取代氣泡罩)'],
    ['低翼主翼 ×2', 'wingF 翼型剖面 + 淺上翹翼端(dihedral)+ 翼端識別片'],
    ['尾翼組', '單垂尾(prism)+ 水平尾翼 ×2(wingF 小)'],
    ['翼下機槍莢 ×2', 'gunPodF(左輕右重)+ 翼下掛梁'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 細長機身:旋成體(前粗後收);+z = 機首
    const fus = latheF(t, [[0, -1.5], [0.13, -1.3], [0.2, -0.6], [0.26, 0.2], [0.28, 0.72], [0.24, 1.02], [0, 1.1]],
      12, 0, 0, 0, PAL.main, { metalness: 0.55 });
    fus.rotation.x = Math.PI / 2;
    bxF(t, 0.06, 0.09, 1.7, 0, 0.24, -0.3, PAL.deep, { metalness: 0.6 });          // 機背脊條
    // 星型引擎:引擎環 + 九缸 + 排氣短管
    // 整流罩取 PAL.mid(舊版 `dark = PAL.mid`)—— 取 PAL.deep 會與缸體同深,
    // 「短粗的整流罩」在剪影上就只剩一團黑。
    const ring = latheF(t, [[0.14, 0], [0.34, 0.02], [0.36, 0.16], [0.3, 0.24], [0.14, 0.26]],
      12, 0, 0, 1.12, PAL.mid, { metalness: 0.75 });
    ring.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 9; i++) {
      const th = i / 9 * Math.PI * 2;
      const cy = cylF(t, 0.055, 0.062, 0.2, 6, Math.sin(th) * 0.25, Math.cos(th) * 0.25, 1.16, GUNMETAL, { metalness: 0.8 });
      cy.rotation.x = Math.PI / 2;
      for (let f = 0; f < 3; f++)                                                   // 散熱鰭
        cylF(t, 0.07, 0.07, 0.014, 6, Math.sin(th) * 0.25, Math.cos(th) * 0.25, 1.1 + f * 0.06,
          COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    }
    for (const sx of [-1, 1]) {
      const ex = cylF(t, 0.03, 0.035, 0.3, 6, sx * 0.22, -0.16, 1.0, COAL, { metalness: 0.85 });
      ex.rotation.x = Math.PI / 2 - 0.2;
    }
    // 感測球(原座艙罩位置)+ 環形基座
    cylF(t, 0.2, 0.24, 0.08, 12, 0, 0.24, 0.28, PAL.deep, { metalness: 0.7 });
    const ball = sphF(t, 0.19, 0, 0.36, 0.28, accent, { emissive: accent, emissiveIntensity: 1.1 });
    ball.scale.y = 0.86;
    // 尾翼組:單垂尾 + 水平尾翼 ×2
    // 舊版的尾翼組與主翼同吃 `lite`(models.js:1024/:1029)—— 翼面比機身亮一階是這台機
    // 兩色分明的來源;取 PAL.mid 會與機身糊成同一塊。
    prismF(t, [[-0.42, 0], [0.16, 0], [0.06, 0.62], [-0.3, 0.66]], 0.05, 0, 0.28, -1.16, PAL.lite, { metalness: 0.5 })
      .rotation.y = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const h = wingF(t, { span: 0.75, c0: 0.45, c1: 0.28, t: 0.06, sweep: 0.1, dihedral: 0.02 },
        sx * 0.14, 0.02, -1.16, PAL.lite, { metalness: 0.5 });
      h.scale.x = sx;
    }
  },

  lift(c, t) {
    const { PAL, accent, K } = c;
    // 低翼主翼:翼根接機身下緣,淺上翹(gen.sil:「翼端上翹得很淺」)
    // 舊版對照(models.js:997~1000):翼面 `lite`(比機身亮一階)、內翼厚弦(0.95)、
    // 外翼收分、上反角 0.12rad —— 板上原本翼面與機身同吃 PAL.main 且弦短,
    // 讀起來是「機身上插了兩片薄板」而不是橢圓低單翼。
    for (const sx of [-1, 1]) {
      const w = wingF(t, { span: 1.74, c0: 0.95, c1: 0.46, t: 0.12, sweep: 0.1, dihedral: 0.12, twist: 0 },
        sx * 0.22, -0.17, 0.16, PAL.lite, { metalness: 0.5 });
      w.scale.x = sx;
      // 日之丸:標記給 paint.js `paintWingRoundel` —— 它沿 Y 三平面投影 ⇒ **每片翼的頂面與
      // 底面各一枚**,雙翼共四枚(使用者:「零式的雙翼上下都要印紅日」)。旗標而不是幾何:
      // 貼花的畫法只有 paint.js 一份,這裡自己畫一片紅圓就是第二份實作。
      w.userData.hinomaru = true;
      bxF(t, 0.05, 0.06, 0.34, sx * 1.9, -0.02, 0.14, accent, { metalness: 0.5 });   // 翼端識別帶(舊版 dim(accent))
    }
    // 牽引槳:三葉大直徑 + 槳轂 + 變距連桿
    const r = rotorF(t, { r: 1.05 * K.barrelF, blades: 3, pitch: 0.34, thick: 0.05, tilt: [Math.PI / 2, 0] },
      0, 0, 1.3, PAL.deep, { metalness: 0.6, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 3; i++) {
      const th = i / 3 * Math.PI * 2;
      cylF(r.prop, 0.018, 0.018, 0.16, 5, Math.cos(th) * 0.12, 0.06, Math.sin(th) * 0.12, IRON, { metalness: 0.9 });
    }
    return { spin: [r.prop] };
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    for (const sx of [-1, 1]) bxF(t, 0.09, 0.1, 0.34, sx * 0.92, -0.24, 0.14, dark, { metalness: 0.75 });   // 掛梁
    const lp = gunPodF(t, { len: 0.86 * K.barrelF, r: 0.11, accent }, -0.92, -0.36, 0.3, dark, { metalness: 0.75 });
    const hp = gunPodF(t, { len: 1.06 * K.barrelF, r: 0.15, accent }, 0.92, -0.36, 0.26, dark, { metalness: 0.75 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hp.muz, r: 0.09 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
