// ============ t09 逐機零件檔(航空機體;dev-only)============
// t09「悲歌」巡飛彈母機(fixed / wing:'delta'):三角翼 + 機背球形指揮轉塔 + 腹部子機投放艙
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t09_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「一片乾淨的三角翼,翼端小垂尾,機背後段是一具推進器;
// 腹部整段是可開合的子機投放艙。」「翼面幾乎就是全機,機身厚度小。」
// gen.note:「『便宜』是它的設計語言:MUST 保留粗糙的製造痕(流痕、鉚釘、膠帶),
// 做得精緻就違背它存在的理由。」
//
// ---- 2026-08-13 這一輪(使用者原句:「巡飛彈母機:**機翼前後裝反了**」)----
// ① 病灶:三角翼多邊形的尖端在局部 +y,而 `wing.rotation.x = -Math.PI/2` 把 (x,y,z)
//    送到 (x, z, −y) ⇒ 尖端落到世界 z = −1.45(機尾),而同一支 body() 裡的導引艙
//    (z=+1.16)與尋標器(z=+1.42)都在 +z。**翼尖朝後、機首朝前 = 前後裝反**。
//    修法 = `rotation.x = +Math.PI/2`:(x,y,z) → (x, −z, y),尖端回到 z=+1.45;
//    擠出厚度(±0.07)落在 y 上、且對稱 ⇒ 上下沒有被翻掉。
//    座標慣例全檔一致:**+z = 機首**、−z = 機尾、+y = 上。
// ② 翼向一改,所有貼在翼面上的東西的合法區間跟著改 ⇒ 鉚釘列/膠帶/流痕/翼端配重
//    全部重新配置:翼面半寬 hw(z) 是**已知的分段線性函式**(見下方 HW 註),每一件
//    的落點都要驗過在 hw(z) 之內 —— 舊版的翼端配重(x=±1.28, z=−0.7)與鉚釘列 A
//    (x=−0.36, z=+0.5)其實在**兩個翼向下都懸空**,只是背景是黑的看不出來。
// ③ 使用者同輪追加的細節(對照 t09_static.png):
//    - **機背球形感測/指揮轉塔**:全圖最強的識別點,舊版完全沒有 ⇒ 座環(lathe)+
//      黑球(sph)+ 兩道環箍(torus)+ 兩顆大鏡頭(lathe 鏡筒 + 發光球面)。
//    - **翼面是多片折面**:前緣稜線(tbox 長脊,沿前緣方向 Ry 對齊)+ 內側折面稜線 +
//      後緣唇板 —— 「一片平板」是這台機最容易畫錯的地方。
//    - **翼尖外傾小翼**:垂尾包進一個**中介 Group** 傾側(±0.38),下方另掛一片內傾小鰭。
//    - **腹部發光長方形艙口**:投放艙前段改成一具發光矩形艙口(= 輕武器槍口節點),
//      對開艙門縮到後段 ⇒ 前段艙口、後段掛彈,兩件事分得開。
// ④ 迴紋/幾何塗裝是 **paint 層**,刻意不做成幾何(技能 §7)。
//
// HW 註(翼面半寬,世界座標):z∈[0.5, 1.45] → 0.28·(1.45−z)/0.95;
//                            z∈[−1.0, 0.5] → 0.28 + 1.04·(0.5−z)/1.5;
//                            z∈[−1.22, −1.0] → 1.32。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, torusF, prismF, latheF, tboxF, gunPodF, jetF,
  GUNMETAL, COAL,
} from '../geo.js';

// 前緣方向(翼根 (0.28, 0.5) → 翼尖 (1.32, −1.0)):稜線/鉚釘列共用的唯一一份解,
// MUST NOT 在下面手寫角度 —— 多邊形一改,這裡自己跟著走。
const LE_DX = 1.04, LE_DZ = -1.5, LE_L = Math.hypot(LE_DX, LE_DZ);
const LE_UX = LE_DX / LE_L, LE_UZ = LE_DZ / LE_L;   // ≈ (0.5698, −0.8218)
const LE_A = Math.atan2(LE_UX, LE_UZ);              // ≈ 2.5354 rad(Ry 對齊用)
const CH_X = 0.72, CH_Z = -0.22;                    // 前緣稜線的中點(略為內縮)

export default {
  label: '悲歌(t09 巡飛彈母機)', hue: 0xc9a628, kind: 'air', height: 3.4,
  air: { tiltY: 1.3, bob: 0.03, top: 36, level: true, span: 2.9 },
  moveSig: { hover: 0.20, hoverF: 1.1, hoverA: 0.10, surge: 0.90, flare: 0, bank: 0.32 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['三角翼主體(尖端朝機首)', '一片大後掠三角翼(prism 平面輪廓,Rx+π/2 ⇒ 翼尖在 +z)'],
    ['機背球形指揮轉塔', '座環(lathe)+ 黑球(sph)+ 環箍 ×2(torus)+ 大鏡頭 ×2(鏡筒 lathe + 發光球面)'],
    ['多片折面翼', '前緣稜線 ×2 + 前段折面階板 ×2 + 內側折面稜線 ×2 + 外翼階板 ×2(tbox 沿前緣 Ry 對齊)+ 後緣唇板(鋪滿翼展)+ 機首脊'],
    ['翼端外傾小翼 ×2', '垂尾(prism,前後緣同向後掠)裝在傾側中介 Group + 下方內傾小鰭 + 翼尖配重'],
    ['腹部投放艙', '前段發光矩形艙口(= 輕武器槍口)+ 後段對開艙門 ×2(微張)+ 子機掛排 ×4'],
    ['尾置推進器', '機背後段排氣管(lathe,外張噴口伸出後緣)+ 加強環 ×3(torus)+ 發光噴口 + 噴射尾焰(jetF)'],
    ['製造痕', '鉚釘列 ×3(沿前緣稜線,左右間距刻意不同)+ 歪貼膠帶 ×2 + 模具流痕溝 ×3'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // ---- 三角翼主體:一片平面輪廓(前尖後寬),厚度薄 ----
    // ⚠ Rx(+π/2):(x, y, z) → (x, −z, y) ⇒ 多邊形的 +y 尖端落在世界 +z(機首)。
    //   寫成 −π/2 會送到 (x, z, −y) = 尖端朝機尾,而畫面上只表現成「翼端垂尾懸空」。
    const DELTA = [[0, 1.45], [0.28, 0.5], [1.32, -1.0], [1.32, -1.22], [-1.32, -1.22], [-1.32, -1.0], [-0.28, 0.5]];
    const wing = prismF(t, DELTA, 0.14, 0, 0, 0, PAL.mid, { metalness: 0.5 });
    wing.rotation.x = Math.PI / 2;

    // ---- 折面:前緣稜線 + 內側折面稜線 + 外翼階板(沿前緣方向對齊,長軸 = tbox 的 d)----
    // 明暗**分階**是折面讀得出來的本錢:全部掛 PAL.main 會糊成一片(技能 §3 配色)。
    for (const sx of [-1, 1]) {
      const chine = tboxF(t, { w0: 0.17, d0: 1.78, w1: 0.05, d1: 1.70, h: 0.07 },
        sx * CH_X, 0.10, CH_Z, PAL.lite, { metalness: 0.6 });
      chine.rotation.y = sx * LE_A;
      const fold = tboxF(t, { w0: 0.12, d0: 1.00, w1: 0.04, d1: 0.94, h: 0.05 },
        sx * 0.42, 0.09, -0.42, PAL.deep, { metalness: 0.55 });
      fold.rotation.y = sx * LE_A;
      tboxF(t, { w0: 0.92, d0: 0.52, w1: 0.80, d1: 0.34, h: 0.045, sz: 0.06 },
        sx * 0.85, 0.085, -0.92, PAL.main, { metalness: 0.5 });        // 外翼階板
      const fwd = tboxF(t, { w0: 0.30, d0: 0.70, w1: 0.22, d1: 0.56, h: 0.04, sz: 0.03 },
        sx * 0.34, 0.082, 0.12, PAL.dark, { metalness: 0.5 });         // 前段折面階板
      fwd.rotation.y = sx * LE_A;
    }
    // 後緣唇板 MUST 鋪滿翼展(2.64):短一截的話正後方會露出一道台階,讀成「翼尖是另外接上去的」
    tboxF(t, { w0: 2.62, d0: 0.11, w1: 2.62, d1: 0.05, h: 0.05, sz: -0.02 },
      0, 0.085, -1.15, PAL.dark, { metalness: 0.6 });

    // ---- 薄機身脊 + 機首脊 + 前段導引艙 + 尋標器 ----
    prismF(t, [[-0.2, 0], [0.2, 0], [0.14, 0.24], [-0.14, 0.24]], 1.85, 0, 0.06, -0.2,
      PAL.main, { metalness: 0.55 });
    tboxF(t, { w0: 0.20, d0: 0.80, w1: 0.07, d1: 0.46, h: 0.14, sz: 0.10 },
      0, 0.12, 0.68, PAL.lite, { metalness: 0.55 });                   // 機首脊(往鼻端收)
    latheF(t, [[0, -0.28], [0.10, -0.14], [0.12, 0.08], [0.07, 0.24], [0, 0.28]], 10, 0, 0.06, 0.92,
      PAL.deep, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    const seek = sphF(t, 0.08, 0, 0.05, 1.36, accent, { emissive: accent, emissiveIntensity: 1.3 });
    seek.scale.z = 1.5;

    // ---- 機背球形感測/指揮轉塔(2D 圖上最強的識別點)----
    const TZ = 0.34, TY = 0.62;                                        // 轉塔中心(重心略前)
    latheF(t, [[0.30, 0], [0.30, 0.05], [0.27, 0.09], [0.27, 0.19], [0.22, 0.22]], 12,
      0, 0.16, TZ, PAL.dark, { metalness: 0.7 });                      // 座環(barbette)
    for (let i = 0; i < 6; i++)                                        // 座環螺栓
      cylF(t, 0.022, 0.022, 0.03, 6, Math.sin(i * 1.047) * 0.285, 0.20, TZ + Math.cos(i * 1.047) * 0.285,
        COAL, { metalness: 0.9 });
    sphF(t, 0.25, 0, TY, TZ, COAL, { metalness: 0.35, roughness: 0.4 });
    const hoopA = torusF(t, 0.256, 0.022, 0, TY, TZ, PAL.lite, { metalness: 0.75 });
    hoopA.rotation.y = Math.PI / 2;                                    // 前後向箍帶
    const hoopB = torusF(t, 0.256, 0.020, 0, TY + 0.05, TZ, PAL.lite, { metalness: 0.75 });
    hoopB.rotation.x = Math.PI / 2;                                    // 環赤道箍帶
    cylF(t, 0.05, 0.065, 0.08, 8, 0, TY + 0.27, TZ, PAL.mid, { metalness: 0.75 });  // 頂蓋
    for (const sx of [-1, 1]) {                                        // 大鏡頭 ×2(前外側)
      const lg = new THREE.Group();
      lg.position.set(0, TY, TZ);
      lg.rotation.y = sx * 0.56;
      lg.rotation.x = -0.14;
      t.add(lg);
      latheF(lg, [[0.125, 0], [0.145, 0.02], [0.145, 0.055], [0.115, 0.07]], 12, 0, 0, 0.225,
        PAL.dark, { metalness: 0.8 }).rotation.x = Math.PI / 2;
      const eye = sphF(lg, 0.112, 0, 0, 0.265, accent, { emissive: accent, emissiveIntensity: 1.1 });
      eye.scale.z = 0.45;
    }

    // ---- 翼端:外傾小翼 + 下方內傾小鰭 + 翼尖配重 ----
    for (const sx of [-1, 1]) {
      const wg = new THREE.Group();                                    // 傾側中介 Group
      wg.position.set(sx * 1.24, 0.06, -1.02);
      wg.rotation.z = -sx * 0.38;
      t.add(wg);
      const vf = prismF(wg, [[-0.34, 0], [0.18, 0], [0.26, 0.52], [-0.06, 0.54]], 0.045,
        0, 0, 0, PAL.main, { metalness: 0.55 });
      vf.rotation.y = Math.PI / 2;                                     // 前後緣一起往 −z 後掠
      const lf = prismF(wg, [[-0.22, 0], [0.12, 0], [0.16, -0.28], [-0.04, -0.29]], 0.04,
        0, -0.10, 0, PAL.dark, { metalness: 0.55 });
      lf.rotation.y = Math.PI / 2;
      bxF(t, 0.10, 0.10, 0.26, sx * 1.28, -0.01, -1.06, dark, { metalness: 0.7 });
    }

    // ---- 製造痕(便宜的證據;決定性排列但刻意不對稱)----
    // 三列都貼在**前緣稜線**上(舊版的座標在新翼向下會懸空)。
    // ⚠ 鉚釘只准**微微凸出**稜線頂面(稜線頂 y = 0.135):r1 用 0.018 高 0.022 的話,
    //   兩排在側視與正視上會連成一把鋸齒梳子,把折面的讀法整個蓋掉。
    const rivet = (sx, s, r) => cylF(t, r, r, 0.012, 6,
      sx * (CH_X + s * LE_UX), 0.132, CH_Z + s * LE_UZ, COAL, { metalness: 0.9 });
    for (let i = 0; i < 9; i++) rivet(-1, -0.80 + i * 0.20, 0.012);    // 列 A(左,等距)
    for (let i = 0; i < 7; i++) rivet(1, -0.55 + i * 0.19, 0.012);     // 列 B(右,間距不同)
    for (let i = 0; i < 5; i++)                                        // 列 C(右腹面,倒著數)
      cylF(t, 0.012, 0.012, 0.016, 6, 0.46 + i * 0.14, -0.076, -0.86, COAL, { metalness: 0.9 });
    const tp1 = bxF(t, 0.44, 0.012, 0.13, -0.86, 0.079, -1.05, PAL.lite, { metalness: 0.2 });
    tp1.rotation.y = 0.19;                                             // 歪貼(整齊就不是這台機)
    const tp2 = bxF(t, 0.34, 0.012, 0.11, 0.52, 0.079, -0.95, PAL.lite, { metalness: 0.2 });
    tp2.rotation.y = -0.26;
    const FLOW = [-0.70, 0.32, 0.66];
    for (let i = 0; i < 3; i++)                                        // 模具流痕溝
      bxF(t, 0.02, 0.016, 0.80, FLOW[i], 0.074, -0.66, PAL.deep, { metalness: 0.4 })
        .rotation.y = 0.05 * (i - 1);
  },

  lift(c, t) {
    const { accent, PAL } = c;
    // 尾置推進器(機背後段):粗排氣管 + 三道加強環 + 外張噴口 + 尾焰。
    // ⚠ Rx(+π/2) 把 lathe 的 +y 送到 +z ⇒ **profile 的 −y 端才是機尾**:噴口的外張
    //   要寫在 y 最小那幾筆,寫反的話畫面上只是「一片平的發光圓盤貼在翼面上」。
    const can = latheF(t, [[0.26, -0.34], [0.24, -0.30], [0.19, -0.16], [0.21, -0.06], [0.20, 0.10], [0.16, 0.34]],
      12, 0, 0.12, -0.95, COAL, { metalness: 0.85 });
    can.rotation.x = Math.PI / 2;
    for (const rz of [-0.72, -0.92, -1.12])                            // 加強環(便宜的鑄件)
      torusF(t, 0.225, 0.028, 0, 0.12, rz, PAL.dark, { metalness: 0.8 });
    const ring = cylF(t, 0.20, 0.20, 0.04, 12, 0, 0.12, -1.30, accent,
      { emissive: accent, emissiveIntensity: 1.6 });
    ring.rotation.x = Math.PI / 2;
    const fl = jetF(t, 0.17, 1.4, 0, 0.12, -1.36, accent);
    fl.g.rotation.x = Math.PI / 2;
    return { jets: [fl] };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // ---- 腹部投放艙:前段 = 發光矩形艙口、後段 = 對開艙門 + 子機掛排 ----
    const bay = new THREE.Group();
    bay.position.set(0, -0.1, -0.2);
    t.add(bay);
    bxF(bay, 0.76, 0.24, 1.5, 0, -0.14, 0, PAL.deep, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      const door = bxF(bay, 0.36, 0.03, 0.98, sx * 0.24, -0.27, -0.24, PAL.mid, { metalness: 0.6 });
      door.rotation.z = sx * 0.42;                     // 微張(投放艙是最大的形狀變化)
    }
    for (let i = 0; i < 4; i++) {                      // 子機掛排(細長巡飛彈;收在艙門之內)
      const z = -0.10 - i * 0.21;
      const ox = i % 2 ? 0.16 : -0.16;
      const sub = latheF(bay, [[0, -0.2], [0.055, -0.14], [0.06, 0.14], [0, 0.22]], 8,
        ox, -0.2, z, dark, { metalness: 0.7 });
      sub.rotation.x = Math.PI / 2;
      for (const sx2 of [-1, 1])                       // 彈翼(折收)
        bxF(bay, 0.13, 0.012, 0.06, ox + sx2 * 0.08, -0.2, z - 0.1, PAL.lite, { metalness: 0.6 });
    }
    // 發光矩形艙口(= 輕武器槍口節點;2D 圖上機腹前段那一塊亮框)
    const lMuz = bxF(bay, 0.34, 0.035, 0.50, 0, -0.262, 0.42, accent,
      { emissive: accent, emissiveIntensity: 1.5 });
    bxF(bay, 0.44, 0.05, 0.05, 0, -0.258, 0.70, PAL.dark, { metalness: 0.7 });   // 艙口框(前)
    bxF(bay, 0.44, 0.05, 0.05, 0, -0.258, 0.14, PAL.dark, { metalness: 0.7 });   // 艙口框(後)
    for (const sx of [-1, 1])
      bxF(bay, 0.05, 0.05, 0.60, sx * 0.195, -0.258, 0.42, PAL.dark, { metalness: 0.7 });
    // 重武器:機首下方前射莢
    const hp = gunPodF(t, { len: 1.0 * K.barrelF, r: 0.13, accent }, 0, -0.16, 0.86, GUNMETAL, { metalness: 0.75 });
    return {
      muzzles: { light: { n: lMuz, r: 0.06 }, heavy: { n: hp.muz, r: 0.09 } },
      lightGlowM: [lMuz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [bay], ref: bay, muz: lMuz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
