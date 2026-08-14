// ============ m03 逐機零件檔(航空機體;dev-only)============
// m03「續命」雙尾桁運補機(fixed / wing:'twinboom'):中央短艙 + 平行尾桁 ×2 + 桁間貨艙
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m03_static.png(/ _moving / _heavy)
//
// 【2026-08-13 使用者定案】「放棄新版建模,**採用舊版建模直接補強細節**」——
//   舊版 = 出貨程式碼 public/js/models.js 的 buildFixedWing() `W === 'twinboom'` 那一支
//   (:787–:858,含前面的共用機身區塊)。本檔自此**逐項鏡射那份佈局**再升級成多面體語彙,
//   MUST NOT 回頭自由發揮成「乾淨但空」的剪影 —— 使用者判定那樣比舊版差。
//   ⚠ models.js 是出貨程式碼:本檔是**抄它的設計**,MUST NOT 反過來改它。
//
// 舊版佈局清單(逐項對照,座標為 models.js 原值 → 本檔值;wingY 0.16 = 本檔 WY):
//   高直翼(整片跨兩桁,span 3.6)/ 翼桁接合整流罩(sx*0.62)/ 尾桁 ×2(0.09²×2.1)/
//   尾桁接管節環 / 副翼伺服鼓包 / 桁端垂尾 + 頂燈 / 水平尾(1.24 寬,桁間)/
//   桁間偶極天線陣**兩排**(對數週期:前排長、後排短)/ 尾推螺旋槳(RQ-7 式:槳在艙尾,
//   鼻子留給感測器)+ 馬達尾錐整流罩 / 機腹 canoe 訊號情報整流罩 + 成對腹鰭測向刀天線 /
//   SATCOM 蘑菇頂 / 背脊桁條板 / 引擎冷卻進氣 + 排氣短管 / 機鼻測向刀片天線 ×2 /
//   翼尖航行燈(左紅右綠)/ 下顎感測球 + 透鏡 / 通訊鞭天線 / 背部識別艙蓋。
//
// 2D 定案圖獨有、舊版沒有而本輪補上的識別點(m03_static/_moving/_heavy):
//   ① 中央短艙前段**管狀骨架座艙罩**(縱樑 + 環箍 + 斜撐 + 玻璃)—— 全圖最強的識別點;
//   ② 艙頂**萬向感測球轉塔**(座 + U 型軛 + 球 + 透鏡);③ 艙頂三支不等高天線 + 碟形 SATCOM;
//   ④ **翼上四具旋翼** + 艙尾推進槳(舊版只有尾推一具);⑤ 翼尖上翹小翼;
//   ⑥ 尾桁外側**八木天線**(_heavy 圖上看得到振子由前到後遞減)+ 桁身桁架斜撐。
//
// 設計權威 = mecha.js gen.sil:「中央短艙加兩根平行尾桁,尾桁之間橫著一片尾翼;桁間的空腔
// 塞滿貨箱,底下垂著一具可拋的修理臂。」
// gen.note:「桁間 MUST 塞著東西(血漿箱/備件):空的桁間就只是一架普通的貨運機。」
//   ⇒ 貨箱是**必要零件**不是擺飾:三只不同尺寸的箱體 + 綁帶,MUST NOT 為了乾淨拿掉。
//
// 刻意不做:機身塗裝分割線/警告標語/迷彩(那是 paint.js 的事,做成網格是浪費預算);
//   垂尾**不外傾**(rotation.y = π/2 之後再疊 z 傾轉,尤拉序會把後掠角一起轉走)。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, torusF, tboxF, prismF, latheF, finF, wingF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL, INK,
} from '../geo.js';

const BOOM = 0.62;            // 尾桁半間距(gen.mass:間距約機身寬的三倍;= models.js 的 sx*0.62)
const WY = 0.16;              // 高直翼基準高(= models.js wingY)
const HSPAN = 1.8;            // 半翼展(air.span 3.6 的一半)

// 正 n 邊形剖面(prismF 專用;零亂數 —— 角度只由索引決定)
const poly = (w, h, n = 8) => Array.from({ length: n }, (_, i) => {
  const a = (i + 0.5) * Math.PI * 2 / n;
  return [w * Math.cos(a), h * Math.sin(a)];
});
// 極細件(天線/振子/纜桿):反轉外殼比零件本身還粗 ⇒ 關描邊(SKILL §2b / A16)
const thin = (m) => { m.userData.noOutline = true; return m; };

export default {
  label: '續命(m03 雙尾桁運補機)', kind: 'air', height: 3.5,
  air: { tiltY: 1.3, bob: 0.03, top: 28, level: true, span: 3.6 },
  moveSig: { hover: 0.30, hoverF: 1.0, hoverA: 0.12, surge: 0.35, flare: 0, bank: 0.55 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['中央短艙(舊版機身)', '八角稜柱艙段 ×3(prismF)+ 收分鼻錐/尾段(tboxF)+ 馬達尾錐整流罩(latheF)'],
    ['管狀骨架座艙罩', '玻璃艙罩(透明稜柱)+ 縱樑 ×4 + 環箍 ×3 + 斜撐 ×4 + 艙內座椅/儀表'],
    ['艙頂感測轉塔', '轉塔座(latheF)+ U 型軛 ×2 + 感測球 + 主透鏡 + 側耳 ×2'],
    ['艙頂天線群', '不等高鞭狀天線 ×3 + 碟形 SATCOM + 蘑菇頂罩 + 背脊桁條板'],
    ['機鼻感測組', '八角鼻錐 + 透鏡群 ×3 + 下顎萬向球 + 測向刀片天線 ×2'],
    ['高直翼 ×2(整片跨兩桁)', 'wingF 翼型剖面 + 上翹翼尖小翼(finF)+ 副翼伺服鼓包 ×2 + 航行燈(左紅右綠)'],
    ['翼桁接合整流罩 ×2', '發動機艙(tboxF)+ 進氣百葉 ×3 + 前緣整流(latheF)+ 排氣短管'],
    ['平行尾桁 ×2', '六角稜柱桁身 + 接管節環 ×3 + 桁架斜撐 ×4 + 桁根整流'],
    ['尾羽組', '桁端垂尾(prismF 後掠)+ 頂端識別燈 + 桁間水平尾(wingF)+ 升降舵分隔'],
    ['SIGINT 天線陣', '桁間偶極陣兩排(前長後短)+ 尾桁外側八木天線 ×2(振子遞減)+ 機腹 canoe + 腹鰭測向刀 ×2'],
    ['推進系統', '翼上旋翼 ×4(rotorF + 短艙掛架)+ 艙尾推進槳(RQ-7 式尾推)'],
    ['桁間貨艙', '貨箱 ×3(尺寸各異)+ 綁帶 ×3 + 繫留導軌 ×2'],
    ['可拋修理臂', '腹下三節機械臂(tboxF 收分)+ 液壓缸 + 夾爪 ×2 + 快拋插銷'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;

    // ══ 中央短艙(+z 機首;艙段由前到後:鼻錐 → 座艙 → 中艙 → 引擎段 → 尾錐)══
    // 舊版是一顆 CapsuleGeometry 素膠囊;本輪拆成有稜有面的艙段串接。
    prismF(t, poly(0.185, 0.17), 0.26, 0, -0.01, 1.15, PAL.mid, { metalness: 0.6 });      // 八角鼻錐
    const nt = tboxF(t, { w0: 0.58, d0: 0.52, w1: 0.37, d1: 0.34, h: 0.26 },
      0, 0, 0.89, PAL.main, { metalness: 0.6 });                                          // 鼻段收分
    nt.rotation.x = Math.PI / 2;
    prismF(t, poly(0.30, 0.27), 0.70, 0, 0, -0.09, PAL.main, { metalness: 0.58 });        // 中艙
    for (const sx of [-1, 1]) {                                                           // 中艙側面板(壓暗:整台 main 會讀成灰白)
      bxF(t, 0.035, 0.30, 0.52, sx * 0.28, -0.02, -0.06, PAL.dark, { metalness: 0.6 });
      bxF(t, 0.03, 0.06, 0.36, sx * 0.30, 0.10, -0.08, accent, { emissive: accent, emissiveIntensity: 0.5 });
    }
    const aft = tboxF(t, { w0: 0.44, d0: 0.40, w1: 0.60, d1: 0.54, h: 0.60 },
      0, 0, -0.74, PAL.mid, { metalness: 0.6 });                                          // 引擎段
    aft.rotation.x = Math.PI / 2;
    // 馬達尾錐整流罩(前端沒入機尾、後端銜接槳轂 = 推進槳生根)
    latheF(t, [[0.23, 0], [0.20, 0.10], [0.13, 0.22], [0.09, 0.28]], 10,
      0, 0, -1.04, dark, { metalness: 0.65 }).rotation.x = -Math.PI / 2;
    bxF(t, 0.30, 0.08, 0.16, 0, 0.27, -0.46, accent, { emissive: accent, emissiveIntensity: 0.6 }); // 背部識別艙蓋

    // ══ ① 管狀骨架座艙罩(2D 圖最強識別點:玻璃 + 一整籠管件)══
    // ⚠ 玻璃 MUST 深、骨架 MUST 亮:賽璐璐階梯下「亮色半透明」會整片糊進機身,
    //    2D 圖上讀得到的正是「深色玻璃 + 一籠亮管」的對比(2026-08-13 r2 實測)。
    // 骨架籠 MUST **大於**中艙剖面(2D 圖上的座艙是外掛在短艙前段的一個籠子,
    // 縮進機身輪廓裡就只剩一片深色玻璃)。
    prismF(t, poly(0.315, 0.285), 0.56, 0, 0, 0.55, INK,
      { transparent: true, opacity: 0.55, metalness: 0.3, emissive: accent, emissiveIntensity: 0.22 });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {          // 縱樑 ×4(八角上下稜線)
      const lg = cylF(t, 0.03, 0.03, 0.60, 6, sx * 0.235, sy * 0.215, 0.55, PAL.lite, { metalness: 0.7 });
      lg.rotation.x = Math.PI / 2;
    }
    for (const z of [0.29, 0.55, 0.81]) {                          // 環箍 ×3
      // ⚠ MUST 是 torus(環)不是 cylF —— cylF 是實心圓柱,拿它當箍會變成一片
      // 橫貫艙罩的圓盤把座艙整個封起來(2026-08-13 r1 實測)。
      const hp = torusF(t, 0.325, 0.032, 0, 0, z, PAL.lite, { metalness: 0.7 });
      hp.scale.y = 0.92;
    }
    for (const sx of [-1, 1]) for (const i of [0, 1]) {            // 斜撐 ×4(側窗對角桿)
      const br = bxF(t, 0.032, 0.38, 0.032, sx * 0.30, 0.02, 0.42 + i * 0.27, PAL.lite, { metalness: 0.7 });
      br.rotation.x = (i ? -1 : 1) * 0.62;
    }
    bxF(t, 0.46, 0.14, 0.46, 0, -0.30, 0.58, PAL.mid, { metalness: 0.55 });                 // 座艙地板凸出段
    bxF(t, 0.40, 0.05, 0.10, 0, -0.36, 0.76, PAL.deep, { metalness: 0.6 });                 // 踏板/繫留點
    bxF(t, 0.20, 0.16, 0.03, 0, -0.02, 0.30, COAL, { metalness: 0.5 });                   // 艙內儀表板
    bxF(t, 0.05, 0.09, 0.03, -0.05, 0.04, 0.29, accent, { emissive: accent, emissiveIntensity: 1.0 });
    bxF(t, 0.16, 0.05, 0.20, 0, -0.14, 0.52, PAL.deep, { metalness: 0.4 });                // 座椅座面
    bxF(t, 0.16, 0.20, 0.05, 0, -0.03, 0.42, PAL.deep, { metalness: 0.4 });                // 座椅椅背

    // ══ ② 艙頂萬向感測球轉塔 ══
    latheF(t, [[0.11, 0], [0.10, 0.05], [0.07, 0.07]], 10, 0, 0.27, 0.18, PAL.mid, { metalness: 0.7 });
    for (const sx of [-1, 1]) bxF(t, 0.035, 0.17, 0.13, sx * 0.11, 0.40, 0.18, PAL.deep, { metalness: 0.8 });
    bxF(t, 0.26, 0.04, 0.13, 0, 0.48, 0.18, PAL.mid, { metalness: 0.7 });                  // 軛頂樑
    sphF(t, 0.105, 0, 0.40, 0.18, COAL, { metalness: 0.6 });                               // 感測球
    const eye = cylF(t, 0.055, 0.055, 0.03, 10, 0, 0.40, 0.28, accent,
      { emissive: accent, emissiveIntensity: 1.4 });
    eye.rotation.x = Math.PI / 2;                                                          // 主透鏡(朝機首)
    for (const sx of [-1, 1]) sphF(t, 0.028, sx * 0.08, 0.43, 0.24, PAL.lite, { metalness: 0.7 });

    // ══ ③ 艙頂天線群(三支不等高)+ 碟形 SATCOM + 蘑菇頂罩 + 背脊桁條板 ══
    bxF(t, 0.22, 0.04, 0.16, 0, 0.28, -0.06, PAL.deep, { metalness: 0.7 });                // 天線底板
    [[-0.07, 0.46, -0.10], [0.0, 0.62, -0.04], [0.07, 0.36, -0.02]].forEach(([ax, ah, az]) => {
      thin(cylF(t, 0.014, 0.018, ah, 5, ax, 0.30 + ah / 2, az, PAL.deep, { metalness: 0.8 }));
      thin(sphF(t, 0.022, ax, 0.30 + ah, az, accent, { emissive: accent, emissiveIntensity: 1.1 }));
    });
    const dish = latheF(t, [[0.02, 0.02], [0.16, 0.10], [0.16, 0.125], [0.02, 0.045]], 12,
      0.17, 0.31, -0.30, PAL.lite, { metalness: 0.45 });                                    // 碟形 SATCOM
    dish.rotation.x = -0.5;
    thin(cylF(dish, 0.012, 0.012, 0.13, 5, 0, 0.09, 0, PAL.deep, { metalness: 0.8 }));      // 饋源桿
    sphF(dish, 0.026, 0, 0.15, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });    // 饋源頭
    latheF(t, [[0.10, 0], [0.095, 0.03], [0.06, 0.07], [0, 0.085]], 10,
      -0.17, 0.27, -0.28, PAL.lite, { metalness: 0.4 });                                    // SATCOM 蘑菇頂
    bxF(t, 0.24, 0.05, 0.42, 0, 0.25, -0.74, PAL.lite, { metalness: 0.5 });                 // 背脊桁條板
    bxF(t, 0.15, 0.08, 0.18, 0, 0.25, -0.96, PAL.dark, { metalness: 0.6 });                 // 引擎冷卻進氣
    bxF(t, 0.11, 0.05, 0.03, 0, 0.25, -0.87, COAL);                                         // 進氣格柵
    thin(cylF(t, 0.026, 0.03, 0.22, 6, 0.20, -0.10, -0.86, COAL, { metalness: 0.85 }))
      .rotation.x = Math.PI / 2 - 0.25;                                                     // 排氣短管
    const whip = thin(cylF(t, 0.013, 0.018, 0.52, 5, -0.13, 0.40, -0.84, COAL, { metalness: 0.8 }));
    whip.rotation.x = 0.5;                                                                  // 通訊鞭天線

    // ══ 機鼻感測組(透鏡群 + 下顎萬向球 + 測向刀片天線)══
    latheF(t, [[0.165, 0], [0.175, 0.02], [0.15, 0.05]], 8, 0, -0.01, 1.28, PAL.deep, { metalness: 0.7 })
      .rotation.x = -Math.PI / 2;                                                           // 鼻端座圈
    [[0, 0.03, 0.062], [-0.08, -0.06, 0.045], [0.08, -0.06, 0.045]].forEach(([lx, ly, lr]) => {
      const ln = cylF(t, lr, lr, 0.03, 10, lx, ly, 1.31, accent, { emissive: accent, emissiveIntensity: 1.3 });
      ln.rotation.x = Math.PI / 2;
    });
    for (const sx of [-1, 1]) {                                                             // 下顎萬向球軛
      bxF(t, 0.03, 0.10, 0.10, sx * 0.11, -0.19, 1.02, PAL.deep, { metalness: 0.8 });
      thin(bxF(t, 0.018, 0.15, 0.20, sx * 0.12, 0.28, 0.72, PAL.dark, { metalness: 0.6 }))
        .rotation.x = -0.5;                                                                 // 機鼻測向刀片天線
    }
    sphF(t, 0.115, 0, -0.25, 1.02, 0x1c2126, { metalness: 0.6 });                           // 下顎感測球
    sphF(t, 0.055, 0, -0.29, 1.10, accent, { emissive: accent, emissiveIntensity: 1.5 });   // 透鏡

    // ══ 高直翼 ×2(整片跨兩桁)+ 翼尖小翼 + 航行燈 + 副翼伺服鼓包 ══
    for (const sx of [-1, 1]) {
      const w = wingF(t, { span: HSPAN, c0: 0.62, c1: 0.42, t: 0.11, sweep: 0.06, dihedral: 0.05 },
        0, WY, 0.15, PAL.main, { metalness: 0.55 });
      w.scale.x = sx;
      // 上翹翼尖小翼(2D 圖:翼尖往上折一片,舊版沒有)—— finF 沿 +y 長,
      // rotation.y = π/2 把「片寬(x)」轉成弦長(z)、「片厚(z)」轉成厚度(x)。
      const wl = finF(t, { len: 0.36, w0: 0.40, w1: 0.22, t: 0.055 },
        sx * 1.78, WY + 0.05, 0.09, PAL.main, { metalness: 0.55 });
      wl.rotation.y = Math.PI / 2;
      bxF(t, 0.10, 0.05, 0.20, sx * 0.95, WY - 0.05, 0.02, PAL.deep, { metalness: 0.5 });   // 副翼伺服鼓包
      bxF(t, 0.10, 0.05, 0.20, sx * 1.42, WY - 0.03, -0.02, PAL.deep, { metalness: 0.5 });
      bxF(t, 0.60, 0.035, 0.04, sx * 1.30, WY + 0.06, -0.10, PAL.deep, { metalness: 0.5 }); // 副翼分隔線
      bxF(t, 1.70, 0.05, 0.07, sx * 0.92, WY + 0.02, 0.44, PAL.lite, { metalness: 0.6 });   // 翼前緣條
      bxF(t, 0.30, 0.16, 0.62, sx * 0.20, WY - 0.02, 0.14, PAL.mid, { metalness: 0.55 });   // 翼根整流
    }
    // 翼尖航行燈(左紅右綠:壓坡時姿態一目了然)
    bxF(t, 0.16, 0.05, 0.18, -1.74, WY + 0.10, 0.05, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
    bxF(t, 0.16, 0.05, 0.18, 1.74, WY + 0.10, 0.05, 0x55ff88, { emissive: 0x22ff66, emissiveIntensity: 1.6 });

    // ══ 翼桁接合整流罩 = 發動機艙 ×2(2D _heavy 圖上的百葉進氣就在這裡)══
    for (const sx of [-1, 1]) {
      const na = tboxF(t, { w0: 0.20, d0: 0.19, w1: 0.17, d1: 0.17, h: 0.66 },
        sx * BOOM, WY, 0.32, PAL.mid, { metalness: 0.62 });
      na.rotation.x = Math.PI / 2;
      latheF(t, [[0.085, 0], [0.10, 0.04], [0.09, 0.12]], 10, sx * BOOM, WY, 0.65, PAL.lite, { metalness: 0.7 })
        .rotation.x = -Math.PI / 2;                                                          // 前緣整流
      for (const i of [0, 1, 2]) bxF(t, 0.03, 0.10, 0.045, sx * (BOOM + 0.10), WY + 0.02, 0.42 - i * 0.10,
        COAL, { metalness: 0.7 });                                                           // 進氣百葉 ×3
      thin(cylF(t, 0.028, 0.032, 0.16, 6, sx * (BOOM - 0.09), WY - 0.06, 0.00, COAL, { metalness: 0.85 }))
        .rotation.x = Math.PI / 2;                                                           // 短艙排氣管
    }

    // ══ 平行尾桁 ×2(六角稜柱 + 節環 + 桁架斜撐 + 桁根整流)══
    for (const sx of [-1, 1]) {
      prismF(t, poly(0.078, 0.072, 6), 2.30, sx * BOOM, WY, -0.90, PAL.dark, { metalness: 0.6 });
      latheF(t, [[0, 0], [0.135, 0.08], [0.125, 0.30], [0.09, 0.38]], 10,
        sx * BOOM, WY, 0.24, PAL.deep, { metalness: 0.65 }).rotation.x = -Math.PI / 2;        // 桁根整流(朝後)
      for (const z of [-0.42, -1.02, -1.62]) {                                               // 接管節環 ×3
        const br = cylF(t, 0.095, 0.095, 0.055, 8, sx * BOOM, WY, z, PAL.deep, { metalness: 0.75 });
        br.rotation.x = Math.PI / 2;
      }
      for (const i of [0, 1, 2, 3]) {                                                        // 桁架斜撐 ×4
        const d = thin(bxF(t, 0.028, 0.24, 0.028, sx * (BOOM + 0.075), WY, -0.25 - i * 0.42,
          PAL.deep, { metalness: 0.7 }));
        d.rotation.x = (i % 2 ? -1 : 1) * 0.72;
      }
    }

    // ══ 尾羽組:桁端垂尾 ×2 + 桁間水平尾 ══
    for (const sx of [-1, 1]) {
      const vf = prismF(t, [[-0.25, 0], [0.25, 0], [0.25, 0.58], [0.0, 0.52]], 0.05,
        sx * BOOM, WY, -1.80, PAL.mid, { metalness: 0.6 });
      vf.rotation.y = Math.PI / 2;                                                           // 局部 +x → 世界 −z
      bxF(t, 0.07, 0.09, 0.24, sx * BOOM, WY + 0.60, -1.90, accent,
        { emissive: accent, emissiveIntensity: 0.8 });                                       // 頂端識別燈
      bxF(t, 0.055, 0.44, 0.035, sx * BOOM, WY + 0.24, -1.96, PAL.deep, { metalness: 0.6 }); // 方向舵分隔
    }
    wingF(t, { span: BOOM * 2, c0: 0.42, c1: 0.42, t: 0.07 }, -BOOM, WY + 0.46, -1.88, PAL.mid, { metalness: 0.6 });
    bxF(t, BOOM * 1.9, 0.03, 0.05, 0, WY + 0.46, -2.02, PAL.deep, { metalness: 0.6 });       // 升降舵分隔

    // ══ SIGINT 天線陣 ══
    // 桁間偶極陣兩排(對數週期:前排振子長、後排短 —— 單排不成陣,兩排才是頻譜語彙)
    [[-1.12, 0.30], [-1.56, 0.21]].forEach(([z, len]) => {
      thin(cylF(t, 0.022, 0.022, BOOM * 2, 6, 0, WY, z, PAL.dark, { metalness: 0.6 }))
        .rotation.z = Math.PI / 2;
      for (const xx of [-0.40, -0.14, 0.14, 0.40])
        thin(bxF(t, 0.026, len, 0.05, xx, WY - len / 2 - 0.02, z, accent,
          { emissive: accent, emissiveIntensity: 0.5 }));
    });
    // 尾桁外側八木天線 ×2(_heavy 圖:振子由前到後遞減長度)
    for (const sx of [-1, 1]) {
      thin(cylF(t, 0.018, 0.018, 0.82, 5, sx * (BOOM + 0.12), WY + 0.10, -0.90, PAL.dark, { metalness: 0.7 }))
        .rotation.x = Math.PI / 2;
      for (let i = 0; i < 5; i++)
        thin(bxF(t, 0.022, 0.30 - i * 0.045, 0.022, sx * (BOOM + 0.12), WY + 0.10, -0.56 - i * 0.17,
          PAL.lite, { metalness: 0.7 }));
    }
    // 機腹 canoe 訊號情報整流罩 + 成對腹鰭測向刀天線(canoe 從不孤立,成對測向)
    latheF(t, [[0.02, 0], [0.10, 0.10], [0.10, 0.62], [0.02, 0.75]], 8,
      0, -0.32, -0.20, PAL.dark, { metalness: 0.6 }).rotation.x = -Math.PI / 2;
    thin(bxF(t, 0.02, 0.03, 0.48, 0.10, -0.32, -0.56, accent, { emissive: accent, emissiveIntensity: 0.7 }));
    thin(bxF(t, 0.02, 0.10, 0.15, 0, -0.42, -0.22, PAL.dark, { metalness: 0.6 })).rotation.x = -0.3;
    thin(bxF(t, 0.02, 0.10, 0.15, 0, -0.42, -0.72, PAL.dark, { metalness: 0.6 })).rotation.x = 0.3;

    // ══ 桁間貨箱 ×3(gen.note:空的桁間就只是普通貨運機)+ 綁帶 + 繫留導軌 ══
    const crate = (cx, cy, cz, w, h, d) => {
      tboxF(t, { w0: w, d0: d, w1: w * 0.94, d1: d * 0.94, h }, cx, cy, cz, PAL.deep, { metalness: 0.5 });
      bxF(t, w * 1.02, 0.035, d * 0.24, cx, cy + h * 0.2, cz, accent, { metalness: 0.35 });   // 綁帶
      bxF(t, w * 0.9, 0.03, 0.04, cx, cy + h / 2 + 0.01, cz + d * 0.3, PAL.lite, { metalness: 0.5 }); // 頂緣件
    };
    crate(-0.46, -0.10, -0.68, 0.38, 0.42, 0.50);
    crate(0.46, -0.12, -0.74, 0.34, 0.36, 0.44);
    crate(0.44, -0.14, -1.08, 0.28, 0.30, 0.32);
    for (const sx of [-1, 1]) {                                                              // 繫留導軌 ×2
      const rail = cylF(t, 0.025, 0.025, 0.86, 6, sx * 0.54, WY - 0.06, -0.86, IRON, { metalness: 0.8 });
      rail.rotation.x = Math.PI / 2;
      thin(rail);
    }
  },

  lift(c, t) {
    const { PAL, K, dark } = c;
    const spin = [];
    // 翼上旋翼 ×4(2D 定案圖:翼上四具 + 艙尾一具)—— 內側掛在翼桁接合整流罩前端,
    // 外側掛在翼中段的短艙掛架上。
    for (const sx of [-1, 1]) {
      for (const [px, py, pz, rr] of [[BOOM, WY + 0.10, 0.86, 0.34], [1.24, WY + 0.14, 0.60, 0.30]]) {
        if (px !== BOOM) {                                          // 外側旋翼的短艙掛架(內側掛在翼桁整流罩上)
          const pod = tboxF(t, { w0: 0.15, d0: 0.14, w1: 0.12, d1: 0.12, h: 0.46 },
            sx * px, py, pz - 0.24, PAL.mid, { metalness: 0.6 });
          pod.rotation.x = Math.PI / 2;
          bxF(t, 0.10, 0.17, 0.24, sx * px, py - 0.12, pz - 0.34, PAL.mid, { metalness: 0.6 }); // 掛架立柱
          latheF(t, [[0.07, 0], [0.085, 0.03], [0.07, 0.10]], 10, sx * px, py, pz - 0.03,
            dark, { metalness: 0.7 }).rotation.x = -Math.PI / 2;
        }
        const r = rotorF(t, { r: rr * K.barrelF, blades: 3, pitch: 0.3, thick: 0.03, tilt: [Math.PI / 2, 0] },
          sx * px, py, pz, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
        spin.push(r.prop);
      }
    }
    // 艙尾推進槳(RQ-7 式:槳在艙尾、鼻子留給感測器)
    const tp = rotorF(t, { r: 0.50 * K.barrelF, blades: 2, pitch: 0.3, thick: 0.035, tilt: [Math.PI / 2, 0] },
      0, 0, -1.40, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
    spin.push(tp.prop);
    return { spin };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // ---- 可拋修理臂(輕武器錨):三節機械臂 + 液壓缸 + 夾爪 + 快拋插銷 ----
    const arm = new THREE.Group();
    arm.position.set(0, -0.44, 0.16);
    arm.rotation.x = 0.3;
    t.add(arm);
    latheF(arm, [[0.09, -0.05], [0.10, 0], [0.075, 0.06]], 10, 0, 0, 0, accent, { metalness: 0.8 }); // 快拋插銷
    for (let i = 0; i < 3; i++) {
      tboxF(arm, { w0: 0.11 - i * 0.02, d0: 0.11 - i * 0.02, w1: 0.09 - i * 0.02, d1: 0.09 - i * 0.02, h: 0.3 },
        0, -0.2 - i * 0.3, i * 0.06, PAL.mid, { metalness: 0.7 });
      cylF(arm, 0.055, 0.055, 0.09, 8, 0, -0.35 - i * 0.3, i * 0.06, COAL, { metalness: 0.9 })
        .rotation.z = Math.PI / 2;
      if (i < 2) thin(cylF(arm, 0.022, 0.022, 0.26, 6, 0.07, -0.28 - i * 0.3, i * 0.06 - 0.05,
        IRON, { metalness: 0.85 }));                                                    // 外露液壓桿
    }
    for (const sx of [-1, 1]) {
      const cl = tboxF(arm, { w0: 0.05, d0: 0.06, w1: 0.03, d1: 0.05, h: 0.22 },
        sx * 0.06, -1.06, 0.2, GUNMETAL, { metalness: 0.85 });
      cl.rotation.z = sx * 0.35;
    }
    const lMuz = sphF(arm, 0.05, 0, -1.14, 0.24, accent, { emissive: accent, emissiveIntensity: 1.3 });
    // 重武器:艙腹前射莢 + 彈艙
    const hp = gunPodF(t, { len: 0.92 * K.barrelF, r: 0.14, accent }, 0, -0.40, 0.56, dark, { metalness: 0.75 });
    tboxF(t, { w0: 0.30, d0: 0.20, w1: 0.26, d1: 0.16, h: 0.26 }, 0, -0.34, 0.22, PAL.deep, { metalness: 0.6 });
    return {
      muzzles: { light: { n: lMuz, r: 0.05 }, heavy: { n: hp.muz, r: 0.09 } },
      lightGlowM: [lMuz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [arm], ref: arm, muz: lMuz, fwd: '-y' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
