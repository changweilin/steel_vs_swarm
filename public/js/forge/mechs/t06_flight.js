// ============ t06@flight 逐機零件檔(航空機體;dev-only)============
// t06「輕功」齊天式可變機甲 —— **飛行型**(觔斗雲)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t06_flight_static.jpg / t06_ground_static.jpg
//
// 2026-08-13 使用者定案(四條,**取代 2D 定案圖的壓平姿態**):
//   ①「飛行姿態調整為**直立前傾**」⇒ 舊制那個「身體壓平」的姿態退場(mecha.js gen.sil 的
//      那一句是 2D 圖的描述,使用者這一輪改了姿態;幾何仍是同一台機的同一批零件)。
//   ②「**噴射背包要有動畫**」⇒ 背後噴口接 `jetF`(rig.jets ⇒ locomotion stepAerial 依速度
//      推焰長/亮度/抖焰);舊制那三片「固定不揮動的光翼刃」是純靜態發光片,沒有任何動畫通道。
//   ③「尾焰噴射尾端生成**凝結雲**」⇒ 焰尾接一團半透明球(觔斗雲意象;一顆球一件、零亂數)。
//   ④「尾巴繞到背上、尾端**向前瞄準**」+「金箍棒背在後背朝前」。
// 加上總則「盡量用相同零件變形切換地面/飛行形態」⇒ 本檔**一顆自己的機體幾何都沒有**:
//   頭/胸/骨盆/四肢/如意棒/尾砲全部由 `t06.js` 的建構器組出來,只有噴焰與雲是飛行型專屬。
//
// ⚠ **尾巴刻意不進 `rig.tailSegs`**:locomotion whipTail 每幀覆寫每一節的 rotation.x/y
//   (geo.js chainF 檔頭那條)—— 掛進去的話「繞到背上、尾端向前瞄準」當場被打平成一根直桿
//   (地面型現在就是這樣)。這一型的尾巴是**重武器的瞄準架**,靜止指向才是它的語意。
import * as THREE from 'three';
import { sphF, jetF } from '../geo.js';
import t06 from './t06.js';
import { bipedDims, groundCtx, upright } from './_morph.js';

const PITCH = 0.52;           // 直立前傾角(≈30°;使用者定案的飛行姿態)
const HG = 6.0;               // 地面型的取景高 = 兩態共用的骨架尺度基準

// 2026-08-14 使用者:「噴射背包的**尾焰長一點**,方向朝後下,凝結雲剛好落在腳邊。」
// 2026-08-15 使用者**改制**:「飛行形態靜止時尾焰縮短 1/2,**接近平行身體**,凝結雲減半,
//   凝結雲**一律放在尾焰末端**。」⇒ 後兩句直接取代 2026-08-14 的「朝後下」與「落在腳邊」。
const FLAME_R = 0.18;
const FLAME_L = 1.6;                   // 尾焰長(舊值 3.2 —— 縮短 1/2;巡航仍由 stepAerial ×~1.9)
const FLAME_Y = 0.18;                  // 焰根離噴口的距離(jetF 自 g 的 +y 起算)
// 噴流朝向:jg 的局部 +y = 噴流方向,而 jg 掛在**反傾錨**上 ⇒ 這一組角就是世界角。
// 「接近平行身體」= 噴流沿**機體自己的縱軸**往機尾:軀幹繞 x 傾了 PITCH ⇒ 機尾方向
// = Rx(PITCH)·(0,0,−1) = (0, sin PITCH, −cos PITCH);要 jg 的 +y 落在那裡,
// Rx(a)·(0,1,0) = (0, cos a, sin a) ⇒ a = PITCH − π/2。**推導不手寫** —— 改飛行姿態角
// 的時候噴流自己跟著走(手寫一個度數的話,改完 PITCH 尾焰就斜著插出機背)。
const JET_X = PITCH - Math.PI / 2;     // ⇒ 與機體縱軸平行(舊值 −2.05 = 世界水平下 27.5°)
const JET_Z = -0.30;                   // 外撇(左右各半,逐邊 ×sx;逐位元同舊值)
const CLOUD_R = 0.34;                  // 凝結雲球團基準半徑(團長 ≈ 3.4 × R)
const CLOUD_F = 0.5;                   // 「凝結雲減半」:整團等比縮(球數與黃金角散布不動)

/**
 * 觔斗雲:尾焰末端的凝結雲。**一朵雲 = 一顆球一件**(生物/自然多重元件的同一條紀律),
 * 位置與大小逐顆由索引推導(§2.3 零亂數)。沿 pod 的 +y(= 噴流方向)往後長。
 */
function condCloud(parent, y0, r, n) {
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);                                   // 0 → 1 由焰尾往外
    const th = i * 2.399;                                    // 黃金角:球團不排成一直線
    const rr = r * (0.55 + 0.75 * Math.sin(Math.PI * (0.25 + 0.75 * u)));
    const p = sphF(parent, rr,
      Math.cos(th) * r * (0.35 + 0.9 * u), y0 + u * r * 3.4, Math.sin(th) * r * (0.35 + 0.9 * u),
      0xf2f6ff, { transparent: true, opacity: 0.42, emissive: 0xdCE8ff, emissiveIntensity: 0.55 });
    p.scale.set(1.15, 0.72, 1.15);                           // 壓扁 = 雲團不是泡泡
    p.userData.noOutline = true;                             // 半透明軟件:反轉外殼會糊成黑團(A16)
  }
}

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '輕功・飛行型(t06 觔斗雲)', kind: 'air', height: HG,
  air: { tiltY: 3.3, bob: 0.05, top: 30, span: 2.4 },
  moveSig: { hover: 0.30, hoverF: 0.7, hoverA: 0.15, surge: 0.70, flare: 0.85, bank: 0.62 },
  castSig: { omni: 'dance', dir: 'swing' },
  doc: [
    ['直立前傾軀幹', '地面型胸腔/骨盆(t06.chest/pelvis)整組前傾 30° —— 使用者定案的飛行姿態'],
    ['頭部', '地面型猴首(t06.head:金箍/紫金冠/火眼金睛)+ 反傾中介 Group 平視航向'],
    ['噴射背包 ×2', '地面型噴口與噴焰翎(t06 的 jetPods 錨)+ jetF 動畫尾焰(長 1.6、**與機體縱軸平行**;推力 ∝ 速度,靜止也點著)'],
    ['觔斗雲 ×2', '焰尾凝結雲:半透明球團(一顆一件、黃金角散布、零亂數);掛在**焰的錐尖**上 ⇒ 焰隨推力伸縮時雲一律跟在尾焰末端'],
    ['長臂 ×2', '掌行長臂(t06.armUp/armFore/mount 的掌行前腳)後掠收攏'],
    ['雙腿', '同一組腿件併攏後伸(t06.thigh/shin/foot;足底噴口朝後)'],
    ['多節長尾 + 熔核砲', 'chainF 十節尾(t06.extra 同一條)繞上背、尾端熔核砲朝前瞄準'],
    ['如意金箍棒', '同一根金棒(t06.mount)改背在後背、棒身朝航向'],
  ],

  body(c, t) {
    const dim = bipedDims(t06, HG);
    groundCtx(c, dim);
    const hull = new THREE.Group();
    hull.position.set(0, -0.35, 0);
    hull.rotation.x = PITCH;
    t.add(hull);

    const hips = new THREE.Group();
    hull.add(hips);
    t06.pelvis(c, hips, { shoulderX: dim.shoulderX });
    const chest = new THREE.Group();
    hips.add(chest);
    t06.chest(c, chest, { shoulderX: dim.shoulderX, shoulderY: dim.shoulderYl, waistY: dim.waistYl });
    c._chest = chest;                          // lift() 的噴射包掛回同一個胸腔框
    // 猴首:反傾平視航向(前傾飛行時頭仍看得到前方)
    t06.head(c, upright(chest, PITCH, 0, dim.headYl, 0.04));

    // ---- 長臂 ×2:後掠收攏(掌行機的長臂在飛行時貼身)----
    const hands = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const arm = new THREE.Group();
      arm.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      arm.rotation.set(0.92, 0, sx * 0.42);     // 肩:後掠 + 外張(飛行時長臂貼向身後)
      chest.add(arm);
      t06.armUp(cx, arm, { len: dim.upperArmL });
      const fore = new THREE.Group();
      fore.position.y = -dim.upperArmL;
      fore.rotation.x = -0.95;                  // 肘前折(−x = 末端前移)⇒ 前臂收回身側
      arm.add(fore);
      t06.armFore(cx, fore, { len: dim.foreArmL });
      const hand = new THREE.Group();
      hand.position.y = -dim.foreArmL;
      hand.rotation.x = 0.5;
      fore.add(hand);
      hands[sx] = hand;
    }

    // ---- 雙腿:併攏後伸(足底噴口朝後 = 推進面)----
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const root = new THREE.Group();
      root.position.set(sx * dim.legX * 0.55, 0, 0);
      root.rotation.set(0.34, 0, -sx * 0.06);   // 腿後伸併攏
      hull.add(root);
      t06.thigh(cx, root, { len: dim.thighL });
      const shin = new THREE.Group();
      shin.position.y = -dim.thighL;
      shin.rotation.x = 0.2;
      root.add(shin);
      t06.shin(cx, shin, { len: dim.shinL });
      const foot = new THREE.Group();
      foot.position.y = -dim.shinL;
      foot.rotation.x = -0.5;                   // 腳背繃直(飛行姿態)
      shin.add(foot);
      t06.foot(cx, foot, { clear: dim.clear, footL: dim.footL });
    }

    // ---- 武裝:同一根如意金箍棒,改背在後背、棒身朝航向 ----
    c._W = t06.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });
    const staff = c._W.wpn.light.ref;
    staff.position.set(0.16, dim.shoulderYl * 0.62, -0.46 * dim.G);
    // 棒身沿局部 +y ⇒ Rx(π/2 − PITCH) 把它送到世界 +z(航向):前傾多少就補回多少
    staff.rotation.set(Math.PI / 2 - PITCH, 0, 0.04);

    // ---- 多節長尾:繞上背、尾端熔核砲朝前瞄準(t06.extra 的同一條鏈與同一門砲)----
    // 尾長固定 2.8m,要把梢端轉到朝前就得轉滿 ≈π ⇒ 弧半徑恆 ≈0.9m(比軀幹窄)。
    // 因此**不追求「大圈套過頭頂」**,而是把基座壓低往後、整個弧偏到右後方升起:
    // 砲口落在右肩前方朝航向,弧線在背後看得見(基座擺在背心正中的話整條尾埋進背包)。
    c.tailCurl = { rot0: 0.44, rotD: -0.024 };            // 累積 ≈3.3 rad ⇒ 梢端朝前略下
    const tailBase = new THREE.Group();
    tailBase.position.set(0.40 * dim.G, -0.16, -0.50 * dim.G);
    tailBase.rotation.set(-0.42, 0.22, -0.36);
    chest.add(tailBase);
    const stub = { muzzles: {}, heavy: { glow: [] }, wpn: {} };
    t06.extra(c, { hips: tailBase }, stub);
    c._tail = stub;
  },

  // 升力:背後噴射包(動畫尾焰;推力 ∝ 速度 —— locomotion stepAerial 的 rig.jets 通道)
  lift(c) {
    const { accent } = c;
    const jets = [];
    for (const p of c.jetPods || []) {
      // 錨點吃地面型的噴口座標,但**朝向另算**:噴焰翎是站姿的上揚裝飾,飛行的噴流要朝
      // 世界後下方。反傾 Group 先把座標系轉回世界對齊,朝向才不會跟著軀幹前傾一起被轉走。
      const pod = upright(c._chest, PITCH, p.x, p.y, p.z);
      const jg = new THREE.Group();
      jg.rotation.set(JET_X, 0, JET_Z * p.sx);   // 噴流朝世界後下方(檔頭 JET_X)
      pod.add(jg);
      const fl = jetF(jg, FLAME_R, FLAME_L, 0, FLAME_Y, 0, accent);
      fl.g.rotation.x = Math.PI;                 // jetF 錐尖朝 −y ⇒ 翻正朝 +y = 噴流方向
      fl.idle = true;                            // 靜止也點著(雲掛在焰尾 ⇒ 熄火連雲一起不見)
      jets.push(fl);
      // 觔斗雲:2026-08-15 使用者「**一律放在尾焰末端**」⇒ 掛在焰的**錐尖**上
      //(jetF 的錐體佔 `fl.g` 局部 [−len, 0] ⇒ 尖端就是 −FLAME_L)。
      // ⚠ 這取代 2026-08-14 的「落在腳邊」那一整段推導(把腳的世界座標換算進噴流框)——
      //   兩者是**互斥**的落點,舊註解說「掛在焰尾只會落在軸上離腳最近的那一點」正是
      //   使用者這一輪要的結果:雲跟著焰走,不跟著腳走。
      // ⚠ 掛在 `fl.g` **之下**而不是 `jg`:焰長由 stepAerial 逐幀改 `fl.g.scale.y`
      //   (懸停 ~0.38 → 巡航 ~1.9),掛在焰底下雲才會跟著錐尖往外走 ⇒「一律」是構造保證,
      //   而不是「某一個速度下剛好對上」。代價是雲團跟著同一個 scale.y 縱向被拉伸 ——
      //   那正好讀成「推力越大、尾跡被吹得越長」,刻意留著。
      const cg = new THREE.Group();
      cg.position.y = -FLAME_L;                  // 錐尖
      cg.rotation.x = Math.PI;                   // 讓 condCloud 的 +y 順著噴流繼續往外長
      cg.scale.setScalar(CLOUD_F);               // 「凝結雲減半」(球數與黃金角散布不動)
      fl.g.add(cg);
      condCloud(cg, -CLOUD_R * 1.2, CLOUD_R, 7);
    }
    return { jets };
  },

  // 尾巴**不進 rig.tailSegs**(檔頭 ⚠):它是重武器的瞄準架,whipTail 會把指向打平
  tail() { return null; },

  mount(c) {
    const W = c._W, T = c._tail;
    return {
      ...W,
      gunR: null, gunL: null,                    // 肩扛樞軸只屬於地面型據槍(航空 rig 不驅動)
      muzzles: { light: W.muzzles.light, heavy: T.muzzles.heavy },
      heavyGlowM: T.heavy.glow.map((g) => g.mesh),
      wpn: { light: W.wpn.light, heavy: T.wpn.heavy },
    };
  },
};
