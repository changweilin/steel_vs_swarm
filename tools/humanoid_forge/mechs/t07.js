// ============ t07 逐機零件檔(航空機體;dev-only)============
// t07「屏息」翼龍狙擊機(avian / creature:'ptero'):一根翼指撐開的大片皮膜 + 腕爪 ×3
//   + 尖長喙 + 後掠頭冠 + 雙爪抓槍莢
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t07_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「一對指骨撐開的細長膜翼,頭部是尖長的感測喙;兩隻爪各抓著
// 一具狙擊槍莢,爪一鬆槍就掉。」
// gen.note:「槍莢是**抓著的**不是掛架焊死的:爪與槍身之間 MUST 看得出是可鬆開的握持關係。」
//   ⇒ 槍莢掛在**爪 Group 之下**且爪指真的環抱槍身(四指 + 對握拇指),兩者之間留可見縫隙。
//
// ── 2026-08-13 使用者指正(本輪的設計依據)──────────────────────────────
// 「翼龍:**皮膜要更大片,連接到身體,翼龍指節不該貼著翼膜,而是向外的爪子**」
// 舊版抄的是**蝙蝠/龍的手**(FING = [1.28,1.06,0.78,0.5] 四根指骨扇形排在膜面上),
// 翼龍的解剖完全不是那樣,2D 圖上也畫得很清楚:
//   ① 翼只有**一根**翼指(第四指)撐開前緣 —— 很長、分四節,從腕一路伸到翼尖(FSEG);
//   ② 腕頂另有**三根短的自由指**,朝**外上方**翹起、末端是爪,**完全不落在膜面上**(CLAW);
//   ③ 皮膜(brachiopatagium)是**一大片**:前緣沿翼指全長、後緣兜出深弧扇貝,
//      內側**一路連回軀幹側面與尾根**(MAIN 主膜 + INNER 內膜,兩片合計 ≈ 舊版的 2.7 倍面積)。
// 膜面另補放射狀纖維摺線(vein;極細 ⇒ userData.noOutline,A16)。
//
// ⚠ 撲翼樞軸紀律:`w` / `outer` 兩個 Group 的 rotation 被 locomotion.js stepAerial **每幀覆寫**
//   ⇒ 靜態展翼姿勢(翼指的逐節後掠、腕爪的翹角、膜面的鋪法)一律住它們**底下的子 Group**
//   (`wi` / `oc`),MUST NOT 寫在 w/outer 自己身上。
// ⚠ 兩片膜的接縫落在**外翼樞軸線上**(主膜內緣 oc x=0、內膜外緣 = 肘,同一條線)——
//   撲翼與上反都是繞 z 轉,而繞 z 旋轉恆保留整條 z 軸不動 ⇒ x=0,y=0 的接縫點在任何相位、
//   任何上反角都原地不動,肘部永遠不開縫;內膜再往外伸 0.13 當搭疊舌蓋住後段下垂的錯位。
// ⚠ 「從正面看得到膜」不是靠加大跨距:純水平的膜在水平機位上恆是一條線。本輪的做法是
//   ①骨架上反(DIH_IN/DIH_OUT,住 wd/oc)②膜的後段沿弦向摺線下垂(DROOP_*)——
//   垂下來那一段才有縱向剪影。跨距反而**收短**到 spec 宣告的 air.span(半展實測 2.17m,
//   舊版 3.08m 連取景都裝不下);面積由弦深補回來,這才是「更大片」。
// 實測(playwright 量世界 bbox):網格 114 顆(< 250)、徑向段數 ≤ 12、零 Math.random。
// ⚠ 方位實測(2026-08-13 以 playwright 量世界 bbox):`rotation.y = π/2` 把多邊形 x 送到世界
//   **−z**。舊版的喙因此是**朝後**長的(實測 bbox z 0.30~1.02,寬端在前) —— 本輪改用
//   profP() 統一先取負,呼叫端一律以「+ = 機首方向」書寫。
import * as THREE from 'three';
import {
  cylF, sphF, coneF, prismF, latheF, finF, tboxF, gunPodF,
  IRON, GUNMETAL, COAL, BONE,
} from '../geo.js';

// ── 局部定向包裝(只是 prismF 的兩種擺法,不是第二份幾何實作)──────────────
/** 水平膜片:pts = [[翼展 x, 後掠量 aft], ...];擠出方向轉成厚度(y),多邊形 y → 世界 −z。
 *  x 先乘 sx 做左右鏡射(ExtrudeGeometry 自己會把繞向正規化,不必用負縮放)。 */
function sheet(parent, pts, sx, th, x, y, z, color, opts) {
  const m = prismF(parent, pts.map(([px, pa]) => [sx * px, pa]), th, x, y, z, color, opts);
  m.rotation.x = -Math.PI / 2;
  return m;
}
/** 側輪廓稜柱:pts = [[z(+ = 機首), y], ...],厚度沿 x。喙/龍骨突/下顎共用。 */
function profP(parent, pts, wide, x, y, z, color, opts) {
  const m = prismF(parent, pts.map(([pz, py]) => [-pz, py]), wide, x, y, z, color, opts);
  m.rotation.y = Math.PI / 2;
  return m;
}
/** 膜面放射狀纖維摺線 —— 極細條:描邊外殼比零件本身還厚 ⇒ 一律 noOutline(A16)。 */
function vein(parent, sx, a, b, w, y, color) {
  const m = sheet(parent, [[a[0], a[1] - w], [b[0], b[1] - w * 0.5],
    [b[0], b[1] + w * 0.5], [a[0], a[1] + w]], sx, 0.01, 0, y, 0, color, { metalness: 0.4 });
  m.userData.noOutline = true;
  return m;
}

// 骨段長(肱骨 / 前臂骨)—— 半翼展對齊 spec 宣告的 air.span 4.2(= 半展 2.1;實測 2.17):
// 舊版的膜比骨架還長 ⇒ 半展 3.08,連 shot_mech --distF 0.6 的取景都裝不下,
// 而「看不到的膜」等於沒做。翼展收短、弦深加大 = 使用者要的「更大片」是**面積**不是跨距。
const HUM = 0.50, FORE = 0.38;
// 第四指(**唯一**的翼指)四節長度 —— 它是翼的前緣骨架,不是扇形的其中一根
const FSEG = [0.37, 0.32, 0.26, 0.20];
// 腕部三根自由指(向外上方翹起的爪;逐根遞減)
const CLAW = [0.32, 0.27, 0.22];
// 上反角(內翼 / 外翼)—— 2D 圖上翼骨是往**外上方**舉起的,膜掛在它下面垂下來。
// 繞 z 的靜態上反 MUST 住 wd/oc(w/outer 的 rotation.z 每幀被撲翼覆寫);
// 繞 z 旋轉保留整條 z 軸不動 ⇒ 肘部接縫(x=0,y=0)在任何上反 + 任何拍動相位都不會裂開。
const DIH_IN = 0.40, DIH_OUT = 0.28;
// 膜的弦向摺線(前段平、後段下垂)—— 這是「從正面看得到大片膜」的本錢:
// 純水平的膜在水平機位上恆是一條線,垂下來的後段才有縱向剪影。
const DROOP_Z = -0.34, DROOP_A = -0.62;
// 主膜:前段(oc 局部;前緣逐點貼翼指四節的實際折線、內緣 x=0 = 外翼樞軸線)
const MAIN_F = [
  [0, -0.05], [0.38, -0.06], [0.75, -0.05], [1.07, 0.02], [1.32, 0.09], [1.51, 0.19],
  [1.54, 0.34], [0, 0.34],
];
// 主膜:後段(摺線局部;後緣兜深弧 + 四段扇貝)
const MAIN_R = [
  [0, 0], [1.54, 0], [1.47, 0.34], [1.33, 0.26], [1.12, 0.66], [0.94, 0.56],
  [0.72, 0.88], [0.50, 0.76], [0.26, 0.98], [0.08, 0.82], [0, 0.46],
];
const MAIN_RV = [[1.47, 0.34], [1.12, 0.66], [0.72, 0.88], [0.26, 0.98]];
// 內膜:前段/後段(wd 局部;根部落在軀幹側面與尾根、外緣越過肘 0.14 當搭疊舌 ——
// 拍翅時外膜繞肘轉走,搭疊舌讓肘後那一段永遠有膜,不會開出一個洞)
const INNER_F = [[-0.03, -0.05], [0.63, -0.05], [0.63, 0.34], [-0.04, 0.34]];
const INNER_R = [[-0.04, 0], [0.63, 0], [0.63, 0.46], [0.47, 0.64], [0.24, 0.60], [0.02, 0.32]];
const INNER_RV = [[0.61, 0.44], [0.45, 0.63], [0.22, 0.58]];

export default {
  label: '屏息(t07 翼龍狙擊機)', hue: 0x3faaca, kind: 'air', height: 3.4,
  air: { tiltY: 1.35, bob: 0.05, top: 26, span: 4.2 },
  moveSig: { hover: 0.12, hoverF: 0.7, hoverA: 0.35, surge: 0.40, flare: 0.82, bank: 0.50 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['分片胸甲機械軀幹', '流線軀幹(lathe)+ 上胸甲/腹甲/側甲(tbox)+ 肩罩 ×2 + 龍骨突 + 背脊片 ×4'],
    ['尖長喙感測頭', '上喙 + 下顎(側輪廓 prism,長度 0.66)+ 顱殼(tbox)+ 單眼 ×2 + 頸節 ×2'],
    ['後掠頭冠', '長刃冠(fin,len 0.66 往後掠)+ 副冠片 —— 翼龍的識別點'],
    ['一根翼指 ×2', '第四指四節(cyl 逐節收分 + 節間關節環 + 逐節後掠/微垂),撐開整段前緣;肱骨 + 前臂骨 + 腕塊'],
    ['腕爪 ×3(每翼)', '朝外上方張開的自由指:指節(cyl)+ 關節環 + 尖爪(cone)——**不落在膜面上**'],
    ['大片皮膜 ×2', '主膜(前段沿翼指 + 後段下垂,後緣四段扇貝)+ 內膜(連回軀幹側面與尾根,含搭疊舌)+ 放射纖維摺線 ×7'],
    ['展翼姿態', '內翼/外翼上反(靜態子 Group,不與撲翼樞軸搶 rotation.z)+ 弦向下垂摺線'],
    ['抓握爪 ×2', '爪根 + 四指(cyl)+ 對握拇指 —— 與槍身之間留可見縫隙'],
    ['狙擊槍莢 ×2', 'gunPodF 長莢(掛在爪之下,可拋)'],
    ['箭形尾舵', '細長尾桿 + 垂直尾鰭 + 水平尾翼 ×2'],
  ],

  body(c, t) {
    const { PAL, accent } = c;
    // ---- 瘦長軀幹 + 分片胸甲(2D 圖:軀幹是有胸甲分片的機械體,不是光滑蛋殼)----
    latheF(t, [[0, -0.8], [0.12, -0.6], [0.22, -0.1], [0.24, 0.34], [0.14, 0.62], [0, 0.7]], 12,
      0, 0, 0, PAL.main, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    tboxF(t, { w0: 0.38, d0: 0.50, w1: 0.26, d1: 0.30, h: 0.09, sz: 0.10 },
      0, 0.16, 0.16, PAL.mid, { metalness: 0.7 });                       // 上胸甲
    tboxF(t, { w0: 0.30, d0: 0.44, w1: 0.40, d1: 0.36, h: 0.12, sz: -0.02 },
      0, -0.14, 0.06, PAL.lite, { metalness: 0.65 });                    // 腹甲
    for (const sx of [-1, 1]) {
      tboxF(t, { w0: 0.10, d0: 0.40, w1: 0.06, d1: 0.24, h: 0.22, sx: -sx * 0.03 },
        sx * 0.20, -0.06, 0.02, PAL.deep, { metalness: 0.75 });          // 側甲
      tboxF(t, { w0: 0.17, d0: 0.30, w1: 0.11, d1: 0.18, h: 0.12, sx: sx * 0.02 },
        sx * 0.22, 0.17, 0.06, PAL.mid, { metalness: 0.7 });             // 肩罩(蓋住膜根接點)
      tboxF(t, { w0: 0.14, d0: 0.50, w1: 0.06, d1: 0.26, h: 0.16, sz: -0.10 },
        sx * 0.13, -0.02, -0.50, PAL.deep, { metalness: 0.7 });          // 膜根樑(內膜 → 尾根)
    }
    profP(t, [[0.52, 0.02], [-0.42, 0.0], [-0.34, -0.20], [0.28, -0.32], [0.48, -0.20]], 0.10,
      0, -0.22, 0.06, PAL.deep, { metalness: 0.7 });                     // 龍骨突(撲翼機的胸肌錨)
    for (let i = 0; i < 4; i++)
      finF(t, { len: 0.13, w0: 0.13, w1: 0.04, t: 0.04, sweep: -0.05 },
        0, 0.21, 0.30 - i * 0.26, PAL.mid, { metalness: 0.6 });          // 背脊稜片
    // ---- 頸節 ×2 + 尖長喙頭 ----
    const nk = cylF(t, 0.10, 0.13, 0.20, 8, 0, 0.09, 0.62, PAL.mid, { metalness: 0.65 });
    nk.rotation.x = Math.PI / 2 - 0.34;
    const nk2 = cylF(t, 0.085, 0.10, 0.16, 8, 0, 0.16, 0.76, IRON, { metalness: 0.8 });
    nk2.rotation.x = Math.PI / 2 - 0.5;
    const head = new THREE.Group();
    head.position.set(0, 0.21, 0.84);
    t.add(head);
    tboxF(head, { w0: 0.19, d0: 0.28, w1: 0.13, d1: 0.17, h: 0.19, sz: -0.03 },
      0, 0.02, -0.02, PAL.mid, { metalness: 0.7 });                      // 顱殼
    profP(head, [[-0.15, -0.05], [0.58, -0.005], [0.68, 0.03], [0.50, 0.085], [-0.13, 0.16]], 0.12,
      0, -0.01, 0, BONE, { metalness: 0.4 });                            // 上喙(細長,尖端朝 +z)
    profP(head, [[-0.12, -0.13], [0.50, -0.055], [0.60, -0.03], [-0.11, -0.03]], 0.10,
      0, 0, 0, COAL, { metalness: 0.6 });                                // 下顎
    finF(head, { len: 0.66, w0: 0.24, w1: 0.05, t: 0.05, sweep: -0.20 }, 0, 0.07, -0.05,
      accent, { metalness: 0.5 }).rotation.x = -0.62;                    // 頭冠(往後掠很長)
    finF(head, { len: 0.30, w0: 0.14, w1: 0.04, t: 0.035, sweep: -0.08 }, 0, 0.06, 0.06,
      PAL.lite, { metalness: 0.6 }).rotation.x = -0.34;                  // 副冠片
    for (const sx of [-1, 1])
      sphF(head, 0.055, sx * 0.085, 0.045, 0.10, accent,
        { emissive: accent, emissiveIntensity: 2.0 });
    // ---- 尾桿 + 箭形尾舵(垂直鰭 + 水平尾翼 ×2)----
    // ⚠ finF 的三軸:長 = 局部 +y、寬 w = 局部 x、厚 t = 局部 z ⇒ **片面法線是局部 z**。
    //   不繞自身長軸轉正的話,「垂直尾鰭」的前後向弦長只剩 t(3.5cm),正面卻是一片 w 寬的板
    //   (實測世界 bbox x 0.24 / z 0.20 —— 側視幾乎消失)。轉正只有一招:Ry(π/2) 把片寬
    //   送到世界 z(弦向)、把厚度送到 x,而 Ry **保留 y 軸** ⇒ 片長仍舊垂直。
    // ⚠ sweep 是沿**局部 z**(= 厚度方向)的梢端偏移 ⇒ 轉正之後它變成橫向偏擺(垂直鰭)
    //   或左右反向的上反(水平尾翼,兩側 sx 一正一負)⇒ MUST 歸零,後掠改由樞軸角表達。
    cylF(t, 0.05, 0.07, 0.9, 8, 0, -0.06, -1.1, PAL.mid, { metalness: 0.7 }).rotation.x = Math.PI / 2;
    const vf = finF(t, { len: 0.32, w0: 0.24, w1: 0.10, t: 0.035 }, 0, 0.0, -1.46,
      PAL.mid, { metalness: 0.6 });                                      // 垂直尾鰭
    vf.rotation.y = Math.PI / 2;                                         // 片寬 → 弦向
    vf.rotation.x = -0.34;    // 尤拉序 XYZ ⇒ R = Rx·Ry(Ry 先)⇒ 這兩個角可以同顆:整片往後掠
    for (const sx of [-1, 1]) {
      // 水平尾翼:兩個角 MUST 拆兩層 —— 同一顆上 Rz 會排在 Ry **之前**(R = Ry·Rz),
      // 先把片長轉到 ±x、再被 Ry 轉回前後,兩個角互相轉走。內層只放「片寬 → 弦向」,
      // 外層 Group 才把立著的片放平;Rz(+sx·π/2) 會把 +y 送到 **−sx·x**(兩片交叉)⇒ 取負號。
      const tp = new THREE.Group();
      tp.position.set(0, -0.04, -1.46);
      tp.rotation.z = -sx * Math.PI / 2;                                 // 片長 → +sx·x(放平)
      tp.rotation.y = sx * 0.30;                                         // 放平後才後掠(兩側同朝 −z)
      t.add(tp);
      finF(tp, { len: 0.26, w0: 0.19, w1: 0.08, t: 0.03 }, 0, 0, 0,
        PAL.mid, { metalness: 0.6 }).rotation.y = Math.PI / 2;           // 水平尾翼
    }
  },

  lift(c, t) {
    const { PAL } = c;
    const MEM = { metalness: 0.2, transparent: true, opacity: 0.72 };
    const wings = [];
    for (const sx of [-1, 1]) {
      // 內翼樞軸(locomotion 每幀覆寫 rotation.z)—— 幾何一律掛靜態子 Group wi/wd
      const w = new THREE.Group();
      w.position.set(sx * 0.22, 0.08, 0.04);
      t.add(w);
      const wi = new THREE.Group();
      w.add(wi);
      const wd = new THREE.Group();
      wd.rotation.z = sx * DIH_IN;                                       // 內翼上反
      wi.add(wd);
      const hum = cylF(wd, 0.055, 0.08, HUM, 8, sx * HUM / 2, 0, 0, PAL.mid, { metalness: 0.7 });
      hum.rotation.z = -sx * Math.PI / 2;                                // 肱骨(細端朝外)
      const sr = cylF(wd, 0.095, 0.095, 0.09, 8, sx * 0.05, 0, 0, IRON, { metalness: 0.85 });
      sr.rotation.z = Math.PI / 2;                                       // 肩關節環
      // ㋑ 內膜:肘 → 軀幹側面 → 尾根(「連接到身體」的落點;根緣埋在殼線之內不留縫)
      sheet(wd, INNER_F, sx, 0.022, 0, 0, 0, PAL.dark, MEM);
      const ih = new THREE.Group();
      ih.position.set(0, 0, DROOP_Z);
      ih.rotation.x = DROOP_A;                                           // 內膜後段下垂
      wd.add(ih);
      sheet(ih, INNER_R, sx, 0.022, 0, 0, 0, PAL.dark, MEM);
      for (const p of INNER_RV) vein(ih, sx, [0.22, 0.01], p, 0.016, 0.018, PAL.mid);

      // 外翼樞軸(同樣每幀被覆寫)—— 位置 = 內翼上反後的肘;幾何掛靜態子 Group oc
      const outer = new THREE.Group();
      outer.position.set(sx * HUM * Math.cos(DIH_IN), HUM * Math.sin(DIH_IN), 0);
      w.add(outer);
      const oc = new THREE.Group();
      oc.rotation.z = sx * DIH_OUT;                                      // 外翼再上反
      outer.add(oc);
      const fore = cylF(oc, 0.04, 0.058, FORE, 8, sx * FORE / 2, 0, 0, PAL.mid, { metalness: 0.7 });
      fore.rotation.z = -sx * Math.PI / 2;                               // 前臂骨
      latheF(oc, [[0, -0.09], [0.07, -0.05], [0.086, 0.03], [0.05, 0.09]], 8,
        sx * FORE, 0, 0, PAL.deep, { metalness: 0.8 });                  // 腕塊
      // ① 一根長翼指(第四指):四節逐節收分 + 後掠 + 微垂,撐到翼尖
      let fg = new THREE.Group();
      fg.position.set(sx * FORE, 0.01, 0);
      oc.add(fg);
      FSEG.forEach((len, i) => {
        if (i > 0) {
          const j = new THREE.Group();
          j.position.set(sx * FSEG[i - 1], 0, 0);
          j.rotation.y = sx * 0.13;                                      // 逐節後掠(+x → −z)
          j.rotation.z = -sx * 0.045;                                    // 逐節微垂
          fg.add(j);
          fg = j;
        }
        const rb = 0.048 - i * 0.008, rt = 0.048 - (i + 1) * 0.008;
        const b = cylF(fg, rt, rb, len, 8, sx * len / 2, 0, 0, BONE, { metalness: 0.55 });
        b.rotation.z = -sx * Math.PI / 2;
        const ring = cylF(fg, rb * 1.4, rb * 1.4, rb * 1.1, 8, 0, 0, 0, IRON, { metalness: 0.85 });
        ring.rotation.z = Math.PI / 2;                                   // 節間關節環
      });
      // ② 腕爪 ×3:朝外上方張開的自由指(第一~三指)—— 刻意離開膜面(膜在 y≈0 的水平面)
      CLAW.forEach((len, i) => {
        const cg = new THREE.Group();
        cg.position.set(sx * FORE, 0.06, 0);
        cg.rotation.x = (i - 1) * 0.34;                                  // 前後張開
        cg.rotation.z = -sx * (0.22 + i * 0.32);                         // 外傾(往機外翹)
        oc.add(cg);
        cylF(cg, 0.020, 0.030, len * 0.60, 6, 0, len * 0.30, 0, GUNMETAL, { metalness: 0.85 });
        cylF(cg, 0.034, 0.034, 0.035, 8, 0, len * 0.60, 0, IRON, { metalness: 0.85 });
        coneF(cg, 0.024, len * 0.52, 6, 0, len * 0.86, 0, BONE,
          { metalness: 0.6 }).rotation.x = 0.34;                         // 尖爪(微勾)
      });
      // ③ 主膜:前緣沿翼指全長、後段下垂 + 四段扇貝、內緣落在樞軸線上(拍翅不開縫)
      sheet(oc, MAIN_F, sx, 0.022, 0, 0, 0, PAL.dark, MEM);
      const mh = new THREE.Group();
      mh.position.set(0, 0, DROOP_Z);
      mh.rotation.x = DROOP_A;
      oc.add(mh);
      sheet(mh, MAIN_R, sx, 0.022, 0, 0, 0, PAL.dark, MEM);
      for (const p of MAIN_RV) vein(mh, sx, [0.34, 0.01], p, 0.018, 0.018, PAL.mid);
      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    const pods = [];
    // 抓握爪 ×2:爪根 + 四指 + 對握拇指;槍莢掛在爪之下,兩者之間留縫(可鬆開的握持關係)
    for (const sx of [-1, 1]) {
      const claw = new THREE.Group();
      claw.position.set(sx * 0.3, -0.36, 0.1);
      claw.rotation.z = sx * 0.16;
      t.add(claw);
      latheF(claw, [[0, 0], [0.11, 0.04], [0.1, 0.18], [0.05, 0.24]], 8, 0, 0, 0, PAL.deep, { metalness: 0.75 });
      for (let i = 0; i < 4; i++) {
        const th = -0.5 + i * 0.34;
        const fg = cylF(claw, 0.022, 0.032, 0.26, 6, Math.sin(th) * 0.09, -0.14, Math.cos(th) * 0.09,
          GUNMETAL, { metalness: 0.85 });
        fg.rotation.x = Math.cos(th) * 0.5;
        fg.rotation.z = -Math.sin(th) * 0.5;
      }
      const th2 = cylF(claw, 0.024, 0.034, 0.24, 6, -sx * 0.1, -0.14, -0.05, GUNMETAL, { metalness: 0.85 });
      th2.rotation.z = sx * 0.75;
      // 槍莢:掛在爪下 0.1m(可見縫隙 = 「抓著的」)
      const pod = gunPodF(claw, { len: 1.5 * K.barrelF, r: 0.13, accent }, 0, -0.36, 0.1, dark, { metalness: 0.8 });
      pods.push(pod);
    }
    const [lp, hp] = pods;
    return {
      muzzles: { light: { n: lp.muz, r: 0.06 }, heavy: { n: hp.muz, r: 0.1 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
