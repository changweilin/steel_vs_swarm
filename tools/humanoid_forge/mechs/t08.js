// ============ t08 逐機零件檔(航空機體;dev-only)============
// t08「詠嘆調」電戰無人機(avian / creature:'dragon'):分節長身東亞龍 + 蝠式指骨膜翼 + 口腔波束艙
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t08_static.jpg(/ _moving / _heavy)
//
// ── 2026-08-13 使用者這一輪的定案(四件事)────────────────────────────────
//   「翅膀的手指應該更長,皮膜要更大片,連接到身體,補上四爪,武器由前爪抓握」
//   ① 指骨加長:2D 圖上的翼是「上臂 → 肘 → 前臂 → 腕散開的長指骨」,指與指之間才是膜。
//      舊版三根光滑棒子(最長 1.5)在剪影上讀不出「指」⇒ 改**四根、分三節 + 節間軸環 +
//      指尖爪**,最長那根 2.86(≈ 整個外翼展),逐根遞減。
//   ② 皮膜逐指一片 + 最內側一片連回身體:舊版是一片掛在外翼上的小三角。改成
//      指間各一片(後緣扇貝形內凹 = 蝠翼的樣子)+ **一片自軀幹側面經肘/腕連到第四指**。
//      那一片掛在**內翼樞軸 w 之下**(隨拍動走);根部埋進軀幹表面,拍動時小幅穿插 ——
//      這是刻意的取捨:「翼膜與身體之間有一道空隙」比穿插難看得多。
//   ③ 補上四爪:gen.sil 寫的是「長身**無足**的東亞龍形」,與使用者這一輪衝突 ——
//      **以使用者為準**,補前爪 ×2(軀幹前段兩側偏下)+ 後爪 ×2(軀幹後段,飛行收腳姿)。
//      這是本檔對 gen.sil 的具名偏離,不是漏看。
//   ④ 武器由前爪抓握:舊版兩具莢浮在腹下。改成兩具各由一隻前爪抓著 ——
//      莢掛在**掌 Group 之下**,四指(三指 + 對握拇指)環抱莢身、指尖與莢面之間留得下縫隙。
// ─────────────────────────────────────────────────────────────────────
//
// 設計權威其餘不動 = mecha.js gen.sil / gen.note:
//   「頭部占比大,張口時看得見整排飛彈巢與波束口」「身體分節、可彎;頭長約身長的六分之一」
//   gen.note:「牠不噴火:發射演出 MUST 是聲波/波束(駐波環、空氣扭曲)。」
//   ⇒ 口內是**飛彈巢 + 波束環**,MUST NOT 出現焰口/噴嘴語彙。
//
// ⚠ 兩個會靜默壞掉的坑(都踩在「每幀被覆寫的樞軸」上):
//   ㋐ 撲翼樞軸:locomotion.js stepAerial 每幀直接寫 rig.wings 的 `w`/`outer` 兩個 Group 的
//      rotation ⇒ 靜態展翼姿勢(上反角)MUST 寫在**它們底下的子 Group**(本檔 `wA`),
//      寫在 w/outer 自己身上等於下一幀就被抹掉。
//   ㋑ chainF 的 rot0/rotD 靜姿角會被 whipTail 每幀覆寫 ⇒ 龍身的基礎波形寫在**節身幾何**
//      (逐節鱗脊高度遞變),不靠靜姿角。
//   ㋒ 負縮放鏡射(scale.x = −1)會翻轉面繞向 ⇒ 半透明皮膜的正面朝內、描邊殼跟著翻。
//      左翼一律走 mirrorPts(x 取負 + 頂點序反轉),繞向保持不變。
import * as THREE from 'three';
import {
  cylF, sphF, coneF, tboxF, prismF, latheF, finF, chainF, gunPodF,
  COAL, BRASS, BONE,
} from '../geo.js';

// ══════════ 本機專屬的組裝慣用語(只用 geo.js 的字母拼字)══════════

/** 關節軸環(旋成體;肢節與肢節之間看得到的那一圈)—— 軸沿本地 +Y */
const jointRing = (p, r, y = 0) => latheF(p,
  [[r * 0.5, -r * 0.62], [r * 0.96, -r * 0.44], [r, 0], [r * 0.96, r * 0.44], [r * 0.5, r * 0.62]],
  8, 0, y, 0, COAL, { metalness: 0.85 });

/** 一根指/趾:兩節收分骨(沿 +Y)+ 節間指節環 + 指尖爪;curl = 逐節累加的內扣角。 */
function digitF(parent, spec, x, y, z, color) {
  const { len, r, curl } = spec;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.z = curl;
  parent.add(g);
  const fr = [0.54, 0.46];
  let cur = g;
  for (let i = 0; i < 2; i++) {
    if (i > 0) {
      const j = new THREE.Group();
      j.position.y = len * fr[0];
      j.rotation.z = curl * 0.95;
      cur.add(j);
      cylF(j, r * 1.38, r * 1.38, r * 1.5, 8, 0, 0, 0, COAL, { metalness: 0.85 });
      cur = j;
    }
    cylF(cur, r * (1 - i * 0.16), r * (0.86 - i * 0.16), len * fr[i], 6,
      0, len * fr[i] / 2, 0, color, { metalness: 0.75 });
  }
  const tip = new THREE.Group();
  tip.position.y = len * fr[1];
  tip.rotation.z = curl * 0.85;
  cur.add(tip);
  coneF(tip, r * 0.92, len * 0.46, 6, 0, len * 0.23, 0, BONE, { metalness: 0.88 });
  return g;
}

/**
 * 帶爪的肢(前爪 ×2 / 後爪 ×2 共用):上臂 → 肘 → 前臂 → 掌 + 三指 + 對握拇指。
 * ⚠ 角度分工是**握持莢能不能對準前方**的關鍵:外張只准寫在 root 的 `rotation.z`、
 *   俯仰只准寫在其下那條連續的 x 旋轉鏈 ⇒ 掌的淨旋轉恆 = Rz(外張)。Rz 不動 z 軸,
 *   所以掌局部的 +z 就是莢的軸向;掌底下掛一個 rotation.z = −外張 的 Group,
 *   gunPodF 的 +z 就對回世界前方(rig.wpn 的 fwd:'z' 契約)。前爪的三個 x 角相加 = 0。
 * 回傳 { root, palm }。
 */
function clawLimb(parent, c, sx, s) {
  const { PAL } = c;
  const root = new THREE.Group();
  root.position.set(sx * s.at[0], s.at[1], s.at[2]);
  root.rotation.z = sx * s.splay;
  parent.add(root);

  const s1 = new THREE.Group();
  s1.rotation.x = s.ang[0];
  root.add(s1);
  jointRing(s1, s.r0 * 1.5);
  cylF(s1, s.r0, s.r0 * 0.84, s.up, 7, 0, -s.up / 2, 0, PAL.mid, { metalness: 0.72 });

  const s2 = new THREE.Group();
  s2.position.y = -s.up;
  s2.rotation.x = s.ang[1];
  s1.add(s2);
  jointRing(s2, s.r0 * 1.24);
  cylF(s2, s.r0 * 0.82, s.r0 * 0.66, s.fore, 7, 0, -s.fore / 2, 0, PAL.main, { metalness: 0.72 });

  const palm = new THREE.Group();
  palm.position.y = -s.fore;
  palm.rotation.x = s.ang[2];
  s2.add(palm);
  const gp = s.grip;
  // 掌墊刻意做小(r1 實測:掌板大過整隻爪 ⇒ 讀成一塊浮在底下的方板);
  // 抓握的說服力全在**指**,所以指反過來加粗加長。
  tboxF(palm, { w0: gp * 1.5, d0: gp * 2.1, w1: gp * 1.1, d1: gp * 1.6, h: gp * 0.62 },
    0, -gp * 1.30, 0.02, PAL.mid, { metalness: 0.78 });
  const dl = gp * 2.1, dr = gp * 0.34;
  for (const dz of [-gp * 1.15, 0.02, gp * 1.15])
    digitF(palm, { len: dl, r: dr, curl: sx * 0.66 }, sx * gp * 0.98, -gp * 0.58, dz, PAL.lite);
  digitF(palm, { len: dl * 0.82, r: dr * 1.08, curl: -sx * 0.86 },
    -sx * gp * 0.92, -gp * 0.70, 0.06, PAL.lite);
  return { root, palm };
}

// ---- 翼平面(皮膜與摺線都畫在這一層)----------------------------------------
// 皮膜先在**右翼的 2D 框** (px, py) 裡定點:掛在 rotation.x = −π/2 的中介 Group 之下,
// 世界 x = px、世界 z = −py(py 往機尾為正),厚度沿世界 y。
const mirrorPts = (pts, sx) => (sx > 0 ? pts : pts.map(([x, y]) => [-x, y]).reverse());
const memPlane = (parent) => {
  const g = new THREE.Group();
  g.rotation.x = -Math.PI / 2;
  parent.add(g);
  return g;
};
// ⚠ 皮膜 MUST 關描邊(A16 / 技能 §2b):outlineWF(4.2) = 0.067 的反轉外殼比 0.03 的膜還厚
// ⇒ 整片膜在畫面上變成一塊**黑色團塊**(r1 實測:正面翼間全黑)。膜的輪廓由指骨與
// 前臂自己的描邊帶出來,足夠讀。
const membrane = (g, pts, sx, color) => {
  const m = prismF(g, mirrorPts(pts, sx), 0.03, 0, 0, 0, color,
    { metalness: 0.18, transparent: true, opacity: 0.88 });
  m.userData.noOutline = true;
  return m;
};
/** 指間膜的放射摺線:極細 ⇒ 描邊殼比零件本身還粗,MUST 關掉描邊(A16)。 */
function foldLine(g, a, b, sx, color) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * 0.020, ny = dx / L * 0.020;
  const m = prismF(g, mirrorPts([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny],
    [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], sx), 0.009, 0, 0, 0.013, color, { metalness: 0.5 });
  m.userData.noOutline = true;
  return m;
}

// 四根翼指:張角(+ = 往機尾掃)與長度(最長那根 ≈ 整個外翼展,逐根遞減)
const FING_A = [-0.54, 0.02, 0.58, 1.12];
const FING_L = [2.62, 2.22, 1.78, 1.26];
const fingTip = (i) => [Math.cos(FING_A[i]) * FING_L[i], Math.sin(FING_A[i]) * FING_L[i]];

/** 一根翼指:三節收分骨 + 兩個節間環 + 指尖爪(沿本地 sx·+X 伸出) */
function wingFinger(parent, sx, len, PAL) {
  // 骨徑刻意偏粗:描邊外殼是**絕對**寬度(outlineWF(4.2) = 0.067),細桿的黑套筒會比桿子
  // 本身還粗 ⇒ 整支翼指在遠景讀成一條黑線(r1 實測)。節間環同理改吃 PAL.deep 而不是 COAL。
  const fr = [0.40, 0.34, 0.26];
  const rr = [0.080, 0.062, 0.045, 0.028];
  let cur = parent;
  for (let i = 0; i < 3; i++) {
    if (i > 0) {
      const j = new THREE.Group();
      j.position.x = sx * len * fr[i - 1];
      j.rotation.y = sx * 0.09;                       // 節間微彎:指梢略往機尾收
      cur.add(j);
      const rg = cylF(j, rr[i] * 1.5, rr[i] * 1.5, rr[i] * 1.8, 8, 0, 0, 0, PAL.deep, { metalness: 0.85 });
      rg.rotation.z = Math.PI / 2;
      cur = j;
    }
    const L = len * fr[i];
    const b = cylF(cur, rr[i], rr[i + 1], L, 6, sx * L / 2, 0, 0, PAL.mid, { metalness: 0.75 });
    b.rotation.z = sx * Math.PI / 2;
  }
  const tip = new THREE.Group();
  tip.position.x = sx * len * fr[2];
  cur.add(tip);
  const cl = coneF(tip, 0.030, 0.17, 6, sx * 0.085, -0.012, 0, BONE, { metalness: 0.88 });
  cl.rotation.z = -sx * Math.PI / 2;
  return tip;
}

export default {
  label: '詠嘆調(t08 電戰無人機)', hue: 0xffb8dd, kind: 'air', height: 4.2,
  air: { tiltY: 1.5, bob: 0.09, top: 24, span: 5.0 },
  moveSig: { hover: 0.35, hoverF: 0.6, hoverA: 1.10, surge: 0.35, flare: 0.70, bank: 0.45 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['龍首', '大占比頭殼(prism)+ 上下顎(可見開口)+ 鬚 + 雙角'],
    ['口腔波束艙', '口內飛彈巢 ×6(cyl 巢口)+ 駐波環 ×3 —— 不是焰口'],
    ['分節長身', 'chainF 九節(逐節鱗脊遞變)+ 節間軸環;整條進 rig.tailSegs'],
    ['蝠式指骨膜翼 ×2', '上臂/前臂 + **四根分三節的長指骨**(節間環 + 指尖爪)+ 腕背翼爪'],
    ['大片翼膜', '指間各一片(後緣扇貝內凹)+ **最內側一片自第四指連回軀幹側面**;膜上放射摺線'],
    ['前爪 ×2(抓握武器)', '上臂/前臂/掌 + 三指 + 對握拇指;波束莢與長莢**各由一爪環抱**'],
    ['後爪 ×2', '同構三節 + 四趾爪,飛行中往後下方收(收腳姿)'],
    ['背脊天線列', '沿身列的天線鰭 ×5(finF,逐片變短)'],
    ['尾鰭舵', '末節菱形尾鰭 ×2'],
  ],

  body(c, t) {
    const { PAL, accent } = c;
    // 前段軀幹(翼根/四肢所在;龍身其餘由 tail 的 chainF 接下去)
    latheF(t, [[0, -0.5], [0.24, -0.36], [0.3, 0], [0.28, 0.32], [0.16, 0.54], [0, 0.6]], 12,
      0, 0, 0.2, PAL.main, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    // ---- 龍首(頭長 ≈ 身長 1/6;占比大)----
    const head = new THREE.Group();
    head.position.set(0, 0.18, 0.86);
    head.rotation.x = -0.16;
    t.add(head);
    // ⚠ 2026-08-13 修:頭殼與下顎原本寫 `rotation.y = +π/2`,那把剖面的 +x(吻端 0.56)送到
    //   head-local **−z** ⇒ 整顆頭朝機尾,接頸的垂直切邊反而成了最前端。
    //   Ry(θ):x' = x·cosθ + z·sinθ、z' = −x·sinθ + z·cosθ ⇒ θ = −π/2 才把局部 +x 送到 +z。
    //   剖面 x 從此 = head-local z:頭殼 z ∈ [−0.30, 0.56]、下顎 z ∈ [−0.24, 0.36],半寬 0.18/0.15。
    prismF(head, [[-0.3, -0.06], [0.42, -0.12], [0.56, 0.02], [0.4, 0.18], [-0.26, 0.24]], 0.36,
      0, 0.04, 0, PAL.mid, { metalness: 0.65 }).rotation.y = -Math.PI / 2;      // 上顎頭殼
    const jaw = prismF(head, [[-0.24, 0], [0.36, -0.04], [0.34, -0.16], [-0.22, -0.14]], 0.3,
      0, -0.14, 0, PAL.deep, { metalness: 0.65 });
    jaw.rotation.y = -Math.PI / 2;
    // 張口:樞軸在顎中段(z=0)⇒ +x 角把顎尖(+z)壓下、顎根(−z)抬起。舊值 0.24 是在
    // **反過來的頭**上量的(那時顎尖在 −z ⇒ 0.24 反而讓吻端往上翻)。轉正後 0.24 只開得出
    // 0.05 的縫;上界由「顎根不得穿過上顎底面」定:0.24·sinθ − 0.14 ≤ −0.026 ⇒ θ ≤ 0.497。
    jaw.rotation.x = 0.48;                                                       // 張口(可見開口)
    for (const sx of [-1, 1]) {                                                  // 雙角(後掠)
      const horn = finF(head, { len: 0.52, w0: 0.1, w1: 0.03, t: 0.05, sweep: -0.3 },
        sx * 0.12, 0.2, -0.14, BRASS, { metalness: 0.8 });
      // Rx(+0.7) 把片長 +y 送到 (0, 0.74, +0.63) = 前掠;頭轉正後「後掠」要的是 −z ⇒ 取負號。
      horn.rotation.x = -0.7;
      horn.rotation.z = -sx * 0.24;
      // 鬚:自吻側射出(root 埋在頭殼內 z=0.185、|x|=0.18 處穿出、梢端 z≈0.61 越過吻端 0.56)
      const wh = cylF(head, 0.014, 0.02, 0.5, 5, sx * 0.16, 0.04, 0.40, BRASS, { metalness: 0.8 });
      wh.rotation.x = 1.2;
      wh.rotation.z = -sx * 0.4;
      wh.userData.noOutline = true;
      sphF(head, 0.06, sx * 0.15, 0.12, 0.32, accent, { emissive: accent, emissiveIntensity: 2.0 });
    }
    // 口腔波束艙:飛彈巢 ×6 + 駐波環 ×3(全在口內;不是焰口)
    // 座標對新的口腔重算:z=0.22 那一刀的腔室 = 上顎 −0.06 ~ 下顎 −0.29 ⇒ 兩排巢口落在 −0.11/−0.20。
    for (let i = 0; i < 6; i++) {
      const u = i % 3 - 1, v = i < 3 ? 0 : 1;
      const nest = cylF(head, 0.045, 0.045, 0.16, 6, u * 0.1, -0.11 - v * 0.09, 0.22, COAL, { metalness: 0.9 });
      nest.rotation.x = Math.PI / 2;
    }
    // 駐波環:半徑往吻端收(0.16 → 0.10)= 收斂喉管;中心下移到腔室中線才看得見
    for (let i = 0; i < 3; i++)
      cylF(head, 0.16 - i * 0.03, 0.16 - i * 0.03, 0.02, 12, 0, -0.15, 0.06 + i * 0.1, accent,
        { emissive: accent, emissiveIntensity: 1.4 + i * 0.3, transparent: true, opacity: 0.7 })
        .rotation.x = Math.PI / 2;
    // 背脊天線列(逐片變短)
    for (let i = 0; i < 5; i++)
      finF(t, { len: 0.34 - i * 0.045, w0: 0.1, w1: 0.03, t: 0.03, sweep: -0.1 },
        0, 0.26, 0.5 - i * 0.22, PAL.lite, { metalness: 0.7 }).rotation.x = -0.24;
    // ---- 後爪 ×2(軀幹後段兩側;飛行中往後下方收)----
    // 掛在**軀幹 tilt** 而不是 chainF 的第一節:掛在節上會被 whipTail 每幀甩動。
    for (const sx of [-1, 1]) clawLimb(t, c, sx, {
      at: [0.25, -0.09, -0.22], splay: 0.52, ang: [0.85, 0.95, 0.15],
      up: 0.40, fore: 0.34, r0: 0.078, grip: 0.135,
    });
  },

  lift(c, t) {
    const { PAL } = c;
    const wings = [];
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();                       // 內翼樞軸(stepAerial 每幀寫 rotation.z)
      w.position.set(sx * 0.24, 0.2, 0.16);
      t.add(w);
      const wA = new THREE.Group();                      // 靜態上反角(㋐:MUST 住 w 的子 Group)
      wA.rotation.z = sx * 0.30;
      w.add(wA);
      // 上臂(肩環 + 收分骨)
      const sh = cylF(wA, 0.1, 0.1, 0.14, 8, sx * 0.05, 0, 0, COAL, { metalness: 0.85 });
      sh.rotation.z = Math.PI / 2;
      const hum = cylF(wA, 0.09, 0.068, 0.8, 8, sx * 0.4, 0, 0, PAL.mid, { metalness: 0.72 });
      hum.rotation.z = sx * Math.PI / 2;

      const outer = new THREE.Group();                   // 肘(stepAerial 每幀寫 rotation.z)
      outer.position.set(sx * 0.8, 0, 0);
      wA.add(outer);
      const el = cylF(outer, 0.078, 0.078, 0.13, 8, 0, 0, 0, COAL, { metalness: 0.85 });
      el.rotation.z = Math.PI / 2;
      const fa = cylF(outer, 0.075, 0.058, 0.66, 8, sx * 0.33, 0, -0.01, PAL.mid, { metalness: 0.72 });
      fa.rotation.z = sx * Math.PI / 2;

      const wrist = new THREE.Group();                   // 腕(靜態;指骨與指間膜都掛這裡)
      wrist.position.set(sx * 0.66, 0, 0);
      // 掌段下折:內翼上反、外掌下垂 = 2D 圖上那道折線;順帶讓翼膜在**水平翼姿**下
      // 不再完全側對鏡頭(r1/r2 的 fire/heavy 兩張整片膜看不見就是這個原因)
      wrist.rotation.z = -sx * 0.18;
      outer.add(wrist);
      const wr = cylF(wrist, 0.06, 0.06, 0.12, 8, 0, 0, 0, COAL, { metalness: 0.85 });
      wr.rotation.z = Math.PI / 2;
      // 腕背翼爪(朝上前方)
      const tc = finF(wrist, { len: 0.42, w0: 0.09, w1: 0.02, t: 0.045, sweep: 0.12 },
        sx * 0.02, 0.04, 0.02, BONE, { metalness: 0.85 });
      tc.rotation.x = 0.45;
      tc.rotation.z = -sx * 0.22;
      // 四根長指骨(逐根遞減;每根三節 + 節間環 + 指尖爪)
      for (let i = 0; i < 4; i++) {
        const fg = new THREE.Group();
        fg.rotation.y = sx * FING_A[i];
        wrist.add(fg);
        wingFinger(fg, sx, FING_L[i], PAL);
      }
      // 指間皮膜 ×3(後緣扇貝內凹)+ 放射摺線
      const mo = memPlane(wrist);
      for (let i = 0; i < 3; i++) {
        const a = fingTip(i), b = fingTip(i + 1);
        // 後緣扇貝:僅微內凹(0.95)—— 使用者要的是「更大片」,凹太深整片就縮成細長三角
        const mid = [(a[0] + b[0]) * 0.5 * 0.95, (a[1] + b[1]) * 0.5 * 0.95];
        membrane(mo, [[0.02, -0.02], a, mid, b], sx, PAL.lite);
        foldLine(mo, [0.05, 0], mid, sx, PAL.main);
      }
      // 最內側那一片:自軀幹側面 → 沿上臂/前臂 → 第四指(掛 wA ⇒ 隨內翼拍動)
      const t3 = fingTip(3);
      const mi = memPlane(wA);
      membrane(mi, [[-0.12, -0.16], [0.80, -0.05], [1.46, 0.02],
        [1.46 + t3[0], t3[1]], [0.60, 1.22], [-0.06, 1.05]], sx, PAL.lite);
      foldLine(mi, [1.46, 0.02], [0.34, 1.10], sx, PAL.main);
      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  tail(c, t) {
    const { PAL, accent } = c;
    // 分節長身(九節):基礎波形寫在節身幾何(逐節鱗脊高度遞變),不靠靜姿角(㋑)
    const ch = chainF(t, {
      n: 9, x: 0, y: 0.02, z: -0.4, len0: 0.3, len1: 0.2, r0: 0.24, r1: 0.07,
      rot0: 0, rotD: 0, seg: 8,
      drawSeg: (gp, i, { r }) => {
        finF(gp, { len: r * 1.5, w0: r * 0.9, w1: r * 0.3, t: 0.025, sweep: 0.05 }, 0, r * 0.6, -0.06,
          PAL.lite, { metalness: 0.65 }).rotation.x = -0.3 + i * 0.05;
        // 尾鰭舵 ×2 —— ⚠ 2026-08-13 修:舊版單寫 `rotation.z = sx*1.1` 有兩個錯。
        //   ㋐ finF 的片面法線是**局部 z**(長 +y / 寬 x / 厚 z),而 Rz 不動 z 軸 ⇒ 那片的
        //      弦只有 t=0.03、寬 0.24 橫在左右 = 一塊正對氣流的擋板,不是舵面。
        //      要把弦轉到前後向 MUST 繞自身長軸補 Ry(π/2)(局部 +x → 世界 −z、+z → +x)。
        //   ㋑ Rz(θ):+y → (−sinθ, cosθ) ⇒ θ = +sx·1.1 讓 sx=+1 那片倒向 **−x**,兩片在末節
        //      交叉。外張要取 **−sx·1.1**。
        //   兩個角 MUST 拆兩層(尤拉序 'XYZ' 會把寫在同一顆網格上的 y/z 互相轉走)。
        if (i === 8) for (const sx of [-1, 1]) {
          const fr = new THREE.Group();
          fr.position.set(sx * 0.04, 0, -0.16);
          fr.rotation.z = -sx * 1.1;                                             // 外張(V 尾)
          gp.add(fr);
          finF(fr, { len: 0.34, w0: 0.05, w1: 0.24, t: 0.03, sweep: -0.12 }, 0, 0, 0,
            accent, { metalness: 0.6 }).rotation.y = Math.PI / 2;                // 弦轉到前後向
        }
      },
    }, PAL.main, { metalness: 0.62 });
    return ch.segs;
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    const SPL = 0.44;                       // 前爪外張角(掌下的 hold 反轉同一個角)
    const pod = {};
    for (const sx of [-1, 1]) {
      const heavy = sx > 0;
      const gp = heavy ? 0.21 : 0.145;
      const { palm } = clawLimb(t, c, sx, {
        at: [0.27, -0.15, 0.44], splay: SPL, ang: [-0.5, 1.0, -0.5],   // 三個 x 角相加 = 0
        up: 0.44, fore: 0.38, r0: 0.085, grip: gp,
      });
      const hold = new THREE.Group();
      hold.rotation.z = -sx * SPL;          // 抵消外張 ⇒ 莢的 +z 對回世界前方(fwd:'z')
      palm.add(hold);
      const len = (heavy ? 1.26 : 0.8) * K.barrelF;
      pod[heavy ? 'hp' : 'lp'] = gunPodF(hold, { len, r: heavy ? 0.16 : 0.1, accent },
        0, 0, len * 0.12, dark, { metalness: 0.8 });
    }
    const { lp, hp } = pod;
    return {
      muzzles: { light: { n: lp.muz, r: 0.06 }, heavy: { n: hp.muz, r: 0.11 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
