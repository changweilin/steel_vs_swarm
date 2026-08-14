// ============ m04 逐機零件檔(航空機體;dev-only)============
// m04「無名」鷹式偵獵機(avian / creature:'eagle'):沿臂排開的分片羽刃翼 + 上翹指羽 + 羽毛飛彈 ×4
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m04_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「一對由分片羽刃構成的寬翼,翼端指羽分開上翹;翼下只掛得下
// 寥寥幾枚細長的『羽毛』飛彈,身體小得不成比例。」「每片羽刃都是一片獨立可動的匿蹤面板。」
// gen.note:「掛載 MUST 少得誇張(4 枚上下):那是它換來匿蹤的代價。」
//   ⇒ 掛架恰 **4 枚**(MISSILES 常數);羽刃一律一片一顆零件,MUST NOT 一片薄板了事。
//
// 2026-08-13 使用者回報:「獵鷹:零件對了,但**翅膀沒展開**」。兩個病灶,一起修:
//   ① 扇向寫反 —— 舊版 `inner.g.rotation.z = sx * Math.PI/2`。finF 沿局部 +Y 伸長,繞 Z 轉 θ
//      把 (0,1,0) 送到 (−sinθ, cosθ, 0):θ = +π/2 ⇒ 羽片指向 **−X**。右翼(sx=+1)掛在 +X 側
//      卻讓羽片往 −X 長 ⇒ 兩側的羽片都往身體內側收,畫面上就是「翅膀沒展開」,而且整台機的
//      實際寬度只剩肩寬一小塊(基準照 shots/m04_base_front.png / m04_r0_front.png)。
//      正解 θ = sx·(rise − π/2)(rise = 該片的上翹角;rise = 0 時即 −sx·π/2 ⇒ 指向 +sx·X)。
//   ② 「一把摺扇」不是「一排羽毛」—— 舊版把 7 片羽全部釘在同一個 fanF 原點放射出去。
//      2D 圖上的翼是覆羽 / 次級飛羽 / 初級飛羽**沿著臂骨後緣一排排長出來**的,愈外愈長、
//      後掠與上翹逐片遞增。⇒ 改走 featherRow():逐片各自生根、逐片內插角度與長度。
//      fanF 仍留給**尾羽**(那一處真的是從尾根放射出去的扇子)。
//   翼展:最外一根初級飛羽的梢端落在 x ≈ ±1.95(air.span = 4.0 的關節點標記附近)——
//   幾何真的長到那裡,air.span 一格未動。
//   另外三件只有截圖看得到、離線一條斷言都碰不到的事(逐輪實測,shots/m04_r0~r4_*):
//   ㋐ **翼面前傾**(wg.rotation.x):羽面法線本來朝正上,正面視角只吃得到羽片厚度 ⇒ 一排竹籤;
//      繞翼展軸前傾 22° 才是 2D 圖那種杯翼前抱的寬幅羽面。
//   ㋑ **靜態上反角要留小**:撲翼 amp 與 cast flare(+0.65)都疊在它上面,r1 用 0.20 的下場是
//      flare 把兩翼折成幾乎垂直對合。
//   ㋒ **梢端長度隔片縮短**(featherRow 的 zig):長度單調遞增會把翼緣連成一條平滑弧線,
//      讀起來是一支角;2D 圖的翼緣是鋸齒的,那正是「一片片獨立的羽刃」。
//
// ⚠ 撲翼樞軸紀律(locomotion.js stepAerial 鳥類分支每幀直接覆寫 `w.rotation.z` 與
//   `outer.rotation.z`,cast 的 flare/lunge 再 += 一次)⇒ 靜態展翼姿勢(上反角 / 外翼上翹)
//   MUST 寫在它們**底下的子 Group**(wg / og),MUST NOT 寫在 w / outer 自己身上。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, prismF, latheF, tboxF, finF, fanF, gunPodF,
  GUNMETAL, COAL,
} from '../geo.js';

const MISSILES = 4;           // gen.note 明列:掛載少得誇張,恰 4 枚

/**
 * 一排羽毛(沿臂長逐片生根)—— 本機體與「一把摺扇」的分野。
 * spec 全部是**兩端值 + 索引內插**(§2.3 零亂數):x/y/z 生根點、sw 後掠、ri 上翹、len 長度。
 * 三個座標推導(這一族最容易寫反的地方,原式留在這裡):
 *   ㋐ 指向:finF 沿局部 +Y 伸長,繞 Z 轉 θ ⇒ (0,1,0) → (−sinθ, cosθ, 0)。
 *      要「指向翼展外側 +sx·X 並上翹 ri」⇒ θ = sx·(ri − π/2)。
 *   ㋑ 後掠:繞 Y 轉 φ ⇒ +x → (cosφ, 0, −sinφ)。右翼(外側 = +x)取 φ > 0 得 −z(機尾);
 *      左翼(外側 = −x)代進去要 φ < 0 ⇒ **兩側同取 sx·sw**。
 *   ㋒ 羽面:MUST 再繞**羽軸自身**(finF 的局部 +Y)轉 π/2 —— 否則 finF 的寬度軸(局部 X)
 *      會落在垂直向,一排羽毛讀起來是一排立起來的刀片。轉正後寬度沿前後、厚度沿上下。
 */
function featherRow(parent, sx, n, o, colOf, opts) {
  const L = (a, b, u) => a + (b - a) * u;
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);           // 0 = 內側(近身)→ 1 = 外側(翼端)
    const fr = new THREE.Group();                  // 生根點 + 後掠
    fr.position.set(sx * L(o.x0, o.x1, u), L(o.y0, o.y1, u), L(o.z0, o.z1, u));
    fr.rotation.y = sx * L(o.sw0, o.sw1, u);
    parent.add(fr);
    const fq = new THREE.Group();                  // 指向 + 上翹
    fq.rotation.z = sx * (L(o.ri0, o.ri1, u) - Math.PI / 2);
    fr.add(fq);
    const f = finF(fq, {
      // zig = 隔片縮短(決定性,不是亂數):長度單調遞增的話梢端連成一條平滑弧線,
      // 正面讀起來是一片光滑的角;2D 圖的翼緣是**鋸齒狀**的,那正是「一片片獨立的羽」。
      len: L(o.len0, o.len1, u) - (i % 2 ? (o.zig ?? 0) : 0),
      w0: o.w0, w1: o.w1, t: o.t,
      sweep: o.fs ?? 0, camber: o.cam ?? 0,
    }, 0, 0, 0, colOf(i), opts);
    f.rotation.y = Math.PI / 2;                    // ㋒ 繞羽軸轉正:羽面水平
    out.push(f);
  }
  return out;
}

export default {
  label: '無名(m04 鷹式偵獵機)', kind: 'air', height: 3.2,
  air: { tiltY: 1.35, bob: 0.06, top: 32, span: 4.0 },
  moveSig: { hover: 0.55, hoverF: 1.6, hoverA: 0.60, surge: 0.92, flare: 0.90, bank: 0.85 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['小型軀幹', '極小流線軀幹(lathe)+ 龍骨突 + 肩甲 ×2 + 尾羽扇(fanF ×7)'],
    ['頭部感測莢', '鷹首殼(prism)+ 鉤喙 + 眉稜 + 雙眼 + 頦下雙管(gunPod ×2)'],
    ['分片羽刃翼 ×2', '沿臂生根的羽排:覆羽 6 + 次級飛羽 7 + 初級飛羽 7(每片一顆 finF)'],
    ['翼前緣裝甲', '肱骨/掌骨蓋板(tbox)+ 鉚釘 ×5 + 腕鉸鏈圓軸'],
    ['上翹指羽', '初級飛羽逐片上翹角遞增(−0.06 → 0.44 rad)+ 隔片鋸齒緣,梢端落在 span/2'],
    ['小翼羽 + 腕鉤爪', '腕前緣小翼羽 ×2 + 掌骨末端黑色彎鉤(prism)'],
    [`羽毛飛彈 ×${MISSILES}`, '肩上細長飛彈(lathe)+ 短掛軌 + 尾翼片;恰 4 枚(匿蹤的代價)'],
    ['抓握爪 ×2', '收折於腹下的爪(cyl 三指)'],
  ],

  body(c, t) {
    const { PAL, accent } = c;
    // 小型軀幹(身體小得不成比例)+ 龍骨突
    latheF(t, [[0, -0.56], [0.11, -0.42], [0.19, -0.05], [0.18, 0.24], [0.1, 0.42], [0, 0.48]], 12,
      0, 0, 0.02, PAL.mid, { metalness: 0.62 }).rotation.x = Math.PI / 2;
    // 龍骨突:剖面最深的一端在 +x(y = −0.2 @ x = 0.24)。Ry(θ) 把局部 +x 送到
    // (cosθ, 0, −sinθ) ⇒ θ = +π/2 會把最深處丟到 −z(機尾);鳥的胸骨龍骨突最深處在**前**
    // ⇒ 全檔統一取 **−π/2**(+x → +z = 機首)。
    prismF(t, [[-0.34, 0], [0.32, 0], [0.24, -0.2], [-0.28, -0.15]], 0.05, 0, -0.16, 0.06, PAL.deep, { metalness: 0.7 })
      .rotation.y = -Math.PI / 2;
    // 肩甲(翼根的承力座;2D 圖上兩肩各一塊厚蓋板)
    for (const sx of [-1, 1])
      tboxF(t, { w0: 0.24, d0: 0.3, w1: 0.16, d1: 0.2, h: 0.16, sx: sx * 0.03 },
        sx * 0.17, 0.14, 0.02, PAL.dark, { metalness: 0.75 });
    // 鷹首:頭殼 + 鉤喙 + 眉稜 + 雙眼
    const head = new THREE.Group();
    head.position.set(0, 0.16, 0.52);
    t.add(head);
    // 頭殼:剖面的尖端在 +x(x = 0.26),平切的後腦面在 −x。Ry(+π/2) 送 +x → −z(機尾)
    // ⇒ 尖端落在世界 z = 0.52 − 0.26 = 0.26,而雙眼在 0.65 —— 喙尖在眼睛**後面**、後腦朝前。
    // 取 −π/2(+x → +z)後尖端 = 0.78,在雙眼之前 0.13。
    prismF(head, [[-0.16, -0.1], [0.2, -0.12], [0.26, 0.02], [0.16, 0.14], [-0.14, 0.16]], 0.2,
      0, 0, 0, PAL.mid, { metalness: 0.65 }).rotation.y = -Math.PI / 2;
    // 鉤喙:同一個病灶(尖端 +x = 0.2,掛在 head z = 0.2)—— +π/2 時喙尖落在世界 0.52,
    // 正好縮在雙眼後方 0.13;−π/2 後喙尖 = 0.92,自頭殼前緣(0.78)伸出 0.14。
    const beak = prismF(head, [[0, 0.06], [0.2, 0.02], [0.14, -0.12], [0.02, -0.06]], 0.09,
      0, -0.02, 0.2, 0xd8b24a, { metalness: 0.7 });
    beak.rotation.y = -Math.PI / 2;
    // 眉稜(鷹的兇相):頭殼轉正後,頂緣的斜率跟著反向(舊制往前**升**、現在往前**降**:
    // (z,y) 折線 (−0.14,0.16) → (0.16,0.14) → (0.26,0.02))⇒ 原座標 (y 0.11, z 0.12) 的整條
    // 眉稜完全埋在殼裡(該處殼頂 y ≈ 0.142,眉稜頂只有 0.128)。抬到 y 0.15 / 退到 z 0.10:
    // 底 0.133 仍咬進殼內約 0.01,頂 0.168 高出殼頂約 0.02 ⇒ 真的成為一條橫過額頭的稜。
    bxF(head, 0.2, 0.035, 0.07, 0, 0.15, 0.10, PAL.deep, { metalness: 0.75 });
    for (const sx of [-1, 1]) sphF(head, 0.045, sx * 0.09, 0.04, 0.13, accent, { emissive: accent, emissiveIntensity: 2.1 });
    // 尾羽扇(這一處真的是從尾根放射出去的扇子 ⇒ 留在 fanF;轉成水平尾羽)
    const tail = fanF(t, {
      n: 7, arc: 1.2, len: 0.95, edgeF: 0.66, gap: 0.014,
      fin: { w0: 0.17, w1: 0.07, t: 0.03, sweep: 0.03 },
    }, 0, -0.02, -0.5, PAL.main, { metalness: 0.55 });
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
    const { PAL } = c;
    const wings = [];
    const plume = (i) => (i % 2 ? PAL.mid : PAL.main);      // 逐片交錯色階 = 疊瓦層次(零亂數)
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();                 // ⚠ 撲翼樞軸:rotation.z 每幀被 stepAerial 覆寫
      w.position.set(sx * 0.17, 0.14, 0.04);
      t.add(w);
      const wg = new THREE.Group();                // 靜態展翼姿勢 MUST 掛在 w 底下(w 的 z 每幀被覆寫)
      // 上反角刻意只留 0.12:撲翼 amp 0.24~0.58、cast 的 flare 再 += 0.65 都疊在這個基礎上 ——
      // 基礎角開大(r1 用 0.20)的下場是 flare 把兩翼折成幾乎垂直對合(shots/m04_r1_cast.png)。
      wg.rotation.z = sx * 0.12;
      // 翼面前傾(incidence):羽面法線原本朝正上,正面看只看得到羽片的**厚度** ⇒ 一排竹籤。
      // 繞翼展軸(x)前傾 ≈22° 把羽面轉向鏡頭,才是 2D 圖那種「杯翼前抱」的寬幅羽面。
      // ⚠ 只有 rotation.z 被 locomotion 覆寫,x 是安全的。
      wg.rotation.x = 0.38;
      w.add(wg);

      // ---- 內翼:肩球窩 → 肱骨 → 前緣裝甲蓋板(鉚釘 + 腕鉸鏈)----
      sphF(wg, 0.085, 0, 0, 0, PAL.deep, { metalness: 0.8 });
      cylF(wg, 0.05, 0.07, 0.52, 8, sx * 0.28, 0, 0, PAL.dark, { metalness: 0.8 }).rotation.z = Math.PI / 2;
      tboxF(wg, { w0: 0.5, d0: 0.24, w1: 0.44, d1: 0.17, h: 0.08, sz: -0.02 },
        sx * 0.28, 0.06, 0.03, PAL.dark, { metalness: 0.72 });
      for (let i = 0; i < 3; i++)
        cylF(wg, 0.016, 0.016, 0.03, 6, sx * (0.14 + i * 0.15), 0.11, 0.04, PAL.deep, { metalness: 0.9 });
      cylF(wg, 0.06, 0.06, 0.2, 8, sx * 0.55, 0.0, 0.0, GUNMETAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;

      // ---- 內翼羽排:次級飛羽 ×7(下層、後掠最深)+ 覆羽 ×6(上層、短)----
      // 片數是「翼面填不填得滿」的唯一旋鈕:r2 各 5 片時羽與羽之間看得到縫,
      // 讀起來是幾根獨立的刀片而不是一片翼(shots/m04_r2_heavy.png)。
      featherRow(wg, sx, 7, {
        x0: 0.13, x1: 0.53, y0: -0.03, y1: -0.04, z0: -0.06, z1: -0.09,
        sw0: 1.00, sw1: 0.72, ri0: -0.06, ri1: 0.03,
        len0: 0.60, len1: 0.90, w0: 0.22, w1: 0.09, t: 0.034, cam: 0.03, zig: 0.06,
      }, plume, { metalness: 0.55 });
      featherRow(wg, sx, 6, {
        x0: 0.16, x1: 0.51, y0: 0.07, y1: 0.06, z0: 0.0, z1: -0.03,
        sw0: 0.98, sw1: 0.78, ri0: 0.03, ri1: 0.09,
        len0: 0.30, len1: 0.44, w0: 0.16, w1: 0.06, t: 0.026, cam: 0.02,
      }, (i) => (i % 2 ? PAL.mid : PAL.dark), { metalness: 0.62 });

      // ---- 外翼(腕以外)----
      const outer = new THREE.Group();             // ⚠ 同樣被每幀覆寫
      outer.position.set(sx * 0.55, 0, -0.02);
      wg.add(outer);
      const og = new THREE.Group();                // 靜態:外翼再上翹一點(同樣只留小角度,理由同 wg)
      og.rotation.z = sx * 0.06;
      outer.add(og);
      cylF(og, 0.035, 0.05, 0.56, 8, sx * 0.28, 0, 0, PAL.dark, { metalness: 0.8 }).rotation.z = Math.PI / 2;
      tboxF(og, { w0: 0.5, d0: 0.17, w1: 0.3, d1: 0.1, h: 0.06, sz: -0.02 },
        sx * 0.27, 0.05, 0.01, PAL.dark, { metalness: 0.72 });
      for (let i = 0; i < 2; i++)
        cylF(og, 0.014, 0.014, 0.026, 6, sx * (0.16 + i * 0.18), 0.09, 0.02, PAL.deep, { metalness: 0.9 });

      // 初級飛羽 ×7 —— 翼端指羽:後掠與上翹角逐片遞增(鷹翼的識別點:梢端**分開**呈指狀,
      // 不是一整片;角度跨距開大才分得開),最外一根梢端 ≈ span/2
      featherRow(og, sx, 7, {
        x0: 0.05, x1: 0.56, y0: 0.0, y1: 0.02, z0: -0.05, z1: -0.03,
        sw0: 0.72, sw1: 0.24, ri0: -0.06, ri1: 0.44,
        len0: 0.80, len1: 1.10, w0: 0.20, w1: 0.06, t: 0.032, cam: 0.04, zig: 0.10,
      }, plume, { metalness: 0.55 });
      // 小翼羽(alula):腕前緣那一小撮
      featherRow(og, sx, 2, {
        x0: 0.0, x1: 0.10, y0: 0.06, y1: 0.06, z0: 0.10, z1: 0.08,
        sw0: -0.38, sw1: -0.16, ri0: 0.20, ri1: 0.34,
        len0: 0.26, len1: 0.31, w0: 0.11, w1: 0.05, t: 0.022,
      }, () => PAL.main, { metalness: 0.6 });
      // 腕鉤爪(2D 圖上兩翼**頂端**那枚黑色彎鉤)—— r1 擺在掌骨中段 + 尺寸過大,讀起來是
      // 翼面中間一塊黑斑(shots/m04_r1_front.png)⇒ 移到掌骨末端前緣、縮到 0.26m。
      // 左右以繞 Y 轉 π 鏡射(不用負縮放:那會翻掉繞向,描邊外殼跟著外翻)。
      const hook = prismF(og, [[0, 0], [0.062, 0.011], [0.108, 0.108], [0.134, 0.26],
        [0.09, 0.242], [0.065, 0.123], [0.014, 0.054]], 0.045,
      sx * 0.60, 0.05, 0.09, COAL, { metalness: 0.88 });
      hook.rotation.y = sx > 0 ? 0 : Math.PI;

      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // 羽毛飛彈 ×4(細長;2026-08-13 使用者要的位置 = **肩上**貼身短掛軌,不用粗掛梁 —— 匿蹤)
    const muzzes = [];
    for (let i = 0; i < MISSILES; i++) {
      const sx = i < MISSILES / 2 ? -1 : 1;
      const off = 0.30 + (i % 2) * 0.17;
      const zc = 0.02 - (i % 2) * 0.07;
      bxF(t, 0.045, 0.05, 0.3, sx * off, 0.30, zc - 0.06, PAL.deep, { metalness: 0.8 });   // 短掛軌
      const m = latheF(t, [[0, -0.42], [0.033, -0.34], [0.038, 0.26], [0, 0.4]], 8,
        sx * off, 0.24, zc, PAL.main, { metalness: 0.7 });
      m.rotation.x = Math.PI / 2;
      for (const s2 of [-1, 1])
        finF(t, { len: 0.13, w0: 0.05, w1: 0.02, t: 0.014 }, sx * off, 0.24, zc - 0.3, PAL.deep, { metalness: 0.7 })
          .rotation.z = s2 * 1.4;
      const mz = cylF(t, 0.033, 0.033, 0.02, 8, sx * off, 0.24, zc + 0.4, accent,
        { emissive: accent, emissiveIntensity: 1.3 });
      mz.rotation.x = Math.PI / 2;
      muzzes.push(mz);
    }
    // 頦下雙管(輕武器;2D 圖上鉤喙底下並排兩根長管)
    const pods = [-1, 1].map((sx) =>
      gunPodF(t, { len: 0.62 * K.barrelF, r: 0.062, accent }, sx * 0.075, -0.06, 0.64, dark, { metalness: 0.8 }));
    const lp = pods[1];
    return {
      muzzles: { light: { n: lp.muz, r: 0.04 }, heavy: { n: muzzes[3], r: 0.08 } },
      lightGlowM: pods.map((p) => p.muz), heavyGlowM: muzzes,
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: pods.map((p) => p.g), ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: pods.map((p) => p.g), ref: lp.g, muz: muzzes[3], fwd: 'z' } },
    };
  },
};
