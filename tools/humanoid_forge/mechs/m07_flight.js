// ============ m07@flight 逐機零件檔(航空機體;dev-only)============
// m07「落閘」區域拒止可變機甲 —— **飛行型**(beetle 犀金龜):鞘翅掀開 + 膜翅高速振動
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m07_flight_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「闔上時是一顆厚實的甲殼,六足向外定樁,頭前一支上挑的犀角;
// 展開時鞘翅向兩側掀起,露出底下高速振動的膜翅。」
// gen.note:「鞘翅是**裝甲**、膜翅才是**動力**:飛行時鞘翅 MUST 掀開不動、膜翅高速振動,
// 兩者一起拍就錯了。」
//   ⇒ **只有膜翅進 rig.wings**(鞘翅是掀起後固定的靜態殼);且 `air.insect = true` ⇒
//     stepAerial 走昆蟲震翅分支(高頻 8 字軌跡 + 每半衝程翼面翻轉),不是鳥類撲翼。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, finF, gunPodF,
  IRON, GUNMETAL, COAL, BRASS,
} from '../geo.js';

export default {
  label: '落閘・飛行型(m07 犀金龜)', hue: 0x5fa353, kind: 'air', height: 3.8,
  air: { tiltY: 1.4, bob: 0.1, top: 18, insect: true, span: 3.4 },
  moveSig: { hover: 0.42, hoverF: 0.7, hoverA: 1.35, surge: 0.15, flare: 0.60, bank: 0.20 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['甲殼軀幹', '厚重甲殼(lathe 大旋成)+ 前胸背板(prism)+ 腹節環 ×4'],
    ['犀角', '上挑主角(finF 厚刃)+ 側叉 ×2 + 角根鎧環'],
    ['盾狀鞘翅 ×2', '掀起後**固定**的裝甲殼(prism 厚片)+ 翅脈稜 ×3 —— 不進 rig.wings'],
    ['膜翅 ×2', '鞘翅下的高速振動翅(內/外兩段樞軸 + 薄膜)—— 唯一的動力面'],
    ['六足(收起)', '飛行時向後收折的六足(cyl 三節 ×6)'],
    ['背部防空砲塔', '甲殼中央砲塔(lathe 座 + 雙管)'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 甲殼軀幹(厚重;全機種最壯的一批)
    latheF(t, [[0, -1.0], [0.4, -0.86], [0.66, -0.3], [0.7, 0.2], [0.56, 0.66], [0.3, 0.92], [0, 1.0]], 14,
      0, 0, 0, PAL.main, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    // 前胸背板(甲蟲的 pronotum)
    prismF(t, [[-0.5, -0.1], [-0.34, 0.2], [0.34, 0.2], [0.5, -0.1], [0.3, -0.26], [-0.3, -0.26]], 0.34,
      0, 0.3, 0.5, PAL.mid, { metalness: 0.68 }).rotation.x = -Math.PI / 2 + 0.25;
    // 腹節環 ×4
    for (let i = 0; i < 4; i++)
      cylF(t, 0.6 - i * 0.09, 0.6 - i * 0.09, 0.05, 14, 0, -0.02, -0.4 - i * 0.16, PAL.deep, { metalness: 0.65 })
        .rotation.x = Math.PI / 2;
    // 犀角(上挑主角 + 側叉 + 角根鎧環)
    const horn = finF(t, { len: 1.0, w0: 0.2, w1: 0.05, t: 0.11, sweep: 0.34, camber: 0.06 },
      0, 0.34, 0.86, BRASS, { metalness: 0.85 });
    horn.rotation.x = -0.62;
    for (const sx of [-1, 1]) {
      const f = finF(t, { len: 0.4, w0: 0.1, w1: 0.03, t: 0.06, sweep: 0.14 }, sx * 0.16, 0.42, 0.92,
        BRASS, { metalness: 0.85 });
      f.rotation.x = -0.7;
      f.rotation.z = -sx * 0.6;
    }
    cylF(t, 0.2, 0.24, 0.1, 12, 0, 0.3, 0.84, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2 - 0.5;
    for (const sx of [-1, 1]) sphF(t, 0.07, sx * 0.28, 0.2, 0.86, accent, { emissive: accent, emissiveIntensity: 1.8 });
    // 六足(飛行時向後收折)
    for (let i = 0; i < 6; i++) {
      const sx = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      const leg = new THREE.Group();
      leg.position.set(sx * 0.5, -0.3, 0.42 - row * 0.44);
      leg.rotation.z = sx * 0.9;
      leg.rotation.x = -0.5;
      t.add(leg);
      cylF(leg, 0.06, 0.07, 0.34, 6, 0, -0.17, 0, PAL.mid, { metalness: 0.7 });
      const knee = new THREE.Group();
      knee.position.set(0, -0.34, 0);
      knee.rotation.x = 1.5;
      leg.add(knee);
      cylF(knee, 0.04, 0.055, 0.36, 6, 0, -0.18, 0, PAL.deep, { metalness: 0.7 });
      cylF(knee, 0.025, 0.035, 0.22, 5, 0, -0.44, 0.06, GUNMETAL, { metalness: 0.85 }).rotation.x = -0.6;
    }
  },

  lift(c, t) {
    const { PAL, accent, dark } = c;
    const wings = [];
    // 鞘翅外廓(局部 XY):長軸 1.86m 在 y、最寬 0.72m 在 x —— 躺平後長軸落到機身前後軸
    const ELY = [[0, -0.9], [0.5, -0.8], [0.72, -0.1], [0.6, 0.7], [0.2, 0.96], [0, 0.9]];
    for (const sx of [-1, 1]) {
      // ---- 盾狀鞘翅:掀起後**固定**的裝甲殼(不進 rig.wings)----
      // prismF 的多邊形在局部 XY、沿局部 z 擠出 ⇒ 板面法線 = 局部 z、長軸 = 局部 y。
      // 甲蟲鞘翅的長軸是**機身前後**、板面朝上 ⇒ 內層網格先 rotation.x = -π/2 躺平
      // (局部 +y → 世界 −z 機尾、局部 +z → 世界 +y),掀起角掛在**外層 Group**:
      // 兩個角寫在同一顆網格上會被尤拉序 'XYZ' 互相轉走。
      // 左右鏡射改用多邊形頂點 x 反號(scale.x 取負會翻繞向,描邊反轉外殼跟著翻)。
      const eg = new THREE.Group();
      eg.position.set(sx * 0.5, 0.44, -0.16);
      eg.rotation.z = sx * 1.15;                   // 繞前後軸滾轉:外緣向兩側掀起
      eg.rotation.y = -sx * 0.3;                   // 尾端外撇
      t.add(eg);
      prismF(eg, ELY.map(([px, py]) => [sx * px, py]), 0.11,
        0, 0, 0, PAL.mid, { metalness: 0.66 }).rotation.x = -Math.PI / 2;
      for (let i = 0; i < 3; i++)                  // 翅脈稜:與殼板同框(長邊沿 eg 的 z = 殼長軸)
        bxF(eg, 0.03, 0.02, 1.3, sx * (0.16 + i * 0.18), 0.062, -0.05, PAL.deep, { metalness: 0.7 });
      // ---- 膜翅:唯一的動力面(內/外兩段樞軸)----
      const w = new THREE.Group();
      w.position.set(sx * 0.24, 0.3, -0.1);
      t.add(w);
      cylF(w, 0.045, 0.055, 0.4, 8, sx * 0.2, 0, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;
      const outer = new THREE.Group();
      outer.position.set(sx * 0.4, 0, 0);
      w.add(outer);
      const mem = prismF(outer, [[0, 0], [1.5, -0.3], [1.42, 0.34], [0.08, 0.24]], 0.01,
        sx * 0.05, 0, 0, PAL.lite, { metalness: 0.15, transparent: true, opacity: 0.5 });
      mem.rotation.x = -Math.PI / 2;
      mem.scale.x = sx;
      for (let i = 0; i < 3; i++)                  // 翅脈(膜翅的骨)
        cylF(outer, 0.012, 0.016, 1.3, 4, sx * 0.72, 0, 0.16 - i * 0.18, PAL.deep, { metalness: 0.7 })
          .rotation.z = Math.PI / 2;
      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // 背部防空砲塔(甲殼中央;雙管)
    const tur = new THREE.Group();
    tur.position.set(0, 0.5, -0.44);
    t.add(tur);
    latheF(tur, [[0.28, 0], [0.3, 0.08], [0.24, 0.24], [0.16, 0.3]], 12, 0, 0, 0, PAL.deep, { metalness: 0.75 });
    const cradle = new THREE.Group();
    cradle.position.set(0, 0.28, 0);
    cradle.rotation.x = -0.45;
    tur.add(cradle);
    const muzzes = [];
    for (const sx of [-1, 1]) {
      cylF(cradle, 0.055, 0.06, 1.0 * K.barrelF, 8, sx * 0.1, 0, 0.5 * K.barrelF, GUNMETAL, { metalness: 0.88 })
        .rotation.x = Math.PI / 2;
      const mz = cylF(cradle, 0.05, 0.05, 0.03, 8, sx * 0.1, 0, 1.02 * K.barrelF, accent,
        { emissive: accent, emissiveIntensity: 1.6 });
      mz.rotation.x = Math.PI / 2;
      muzzes.push(mz);
    }
    // 輕武器:頭下短莢
    const lp = gunPodF(t, { len: 0.66 * K.barrelF, r: 0.1, accent }, 0, -0.16, 0.82, dark, { metalness: 0.8 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: muzzes[1], r: 0.08 } },
      lightGlowM: [lp.muz], heavyGlowM: muzzes,
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.06 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [tur], ref: cradle, muz: muzzes[1], fwd: 'z' } },
    };
  },
};
