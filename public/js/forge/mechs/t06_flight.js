// ============ t06@flight 逐機零件檔(航空機體;dev-only)============
// t06「輕功」齊天式可變機甲 —— **飛行型**(觔斗雲)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t06_flight_static.jpg / t06_ground_static.jpg
//
// 2026-08-13 使用者定案(四條,**取代 2D 定案圖的壓平姿態**):
//   ①「飛行姿態調整為**直立前傾**」⇒ 舊制那個「身體壓平」的姿態退場(mecha.js gen.sil 的
//      那一句是 2D 圖的描述,使用者這一輪改了姿態;幾何仍是同一台機的同一批零件)。
//      **2026-08-15 再修**:「直立」與「前傾」拆成速度的兩端(靜止直立 / 移動前傾),
//      見下方 PITCH_TOP —— 機身群組自此沒有任何靜態傾角。
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
import { bipedDims, groundCtx } from './_morph.js';

const HG = 6.0;               // 地面型的取景高 = 兩態共用的骨架尺度基準

// ── 2026-08-15 使用者定案(姿態改為**速度的函數**)────────────────────────────
//   「飛行形態**靜止時身體直立**、**移動時身體保持前傾**。」
//   ⇒ 舊制那個寫死在 `hull.rotation.x` 上的 30° 前傾**退場**:它是靜態的,靜止時也一直
//     低著頭。前傾改由 `air.pitchTop` 交給 `stepAerial`(rig.tilt 的俯仰,速度 0 ⇒ 恆 0
//     = 直立;滿速 ⇒ PITCH_TOP)—— 這一台的機身群組因此**沒有任何靜態傾角**,
//     頭 / 如意棒 / 尾焰的擺位也全部跟著少掉一層反傾補償(它們本來就是身體的一部分)。
const PITCH_TOP = 0.52;       // 滿速前傾角(≈30°;= 舊制那個靜態角,移動到底時的姿態不變)

// 2026-08-14 使用者:「噴射背包的**尾焰長一點**,方向朝後下,凝結雲剛好落在腳邊。」
// 2026-08-15 使用者**改制**(第二輪):「靜止時的尾焰長度 ×3、移動時 ×2,尾焰一律**平行身體**
//   (相對身體向下),凝結雲大小全部 ×2。」⇒ 取代同日第一輪的「縮短 1/2 / 凝結雲減半」。
const FLAME_R = 0.18;
const FLAME_L = 1.6;                   // 尾焰基準長(兩端倍率另走 lenF,見 lift())
const FLAME_Y = 0.18;                  // 焰根離噴口的距離(jetF 自 g 的 +y 起算)
// 噴流朝向:jg 的局部 +y = 噴流方向,而 jg 自 2026-08-15 起直接掛在**胸腔**(= 機體自己的框)
// ⇒ Rx(π) 把 +y 送到機體的 −y = **相對身體向下**,而「一律平行身體」從此是**構造保證**
// 不是一個算出來的角度:身體怎麼傾(現在還是逐幀變的),焰就怎麼跟著傾。
// ⚠ MUST NOT 退回舊制的反傾錨 + `PITCH − π/2`:那組角只在「機身傾角是個常數」的時候成立,
//   而這一輪它已經是速度的函數了(靜止直立、移動前傾)。
const JET_X = Math.PI;
const JET_Z = -0.30;                   // 外撇(左右各半,逐邊 ×sx;逐位元同舊值)
const FLAME_F = { hold: 3, run: 2 };   // 兩端焰長倍率:靜止 ×3 / 移動 ×2(stepAerial 的 j.lenF)
const CLOUD_R = 0.34;                  // 凝結雲球團基準半徑(團長 ≈ 3.4 × R)
const CLOUD_F = 1.0;                   // 「凝結雲大小全部 ×2」:整團等比放大(球數與黃金角散布不動)

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
  air: { tiltY: 3.3, bob: 0.05, top: 30, span: 2.4, pitchTop: PITCH_TOP },
  moveSig: { hover: 0.30, hoverF: 0.7, hoverA: 0.15, surge: 0.70, flare: 0.85, bank: 0.62 },
  castSig: { omni: 'dance', dir: 'swing' },
  doc: [
    ['軀幹(靜止直立 / 移動前傾)', '地面型胸腔/骨盆(t06.chest/pelvis)零靜態傾角;前傾由速度驅動(air.pitchTop 30° @ 滿速)'],
    ['頭部', '地面型猴首(t06.head:金箍/紫金冠/火眼金睛)—— 直接掛在胸腔上隨身體俯仰'],
    ['噴射背包 ×2', '地面型噴口與噴焰翎(t06 的 jetPods 錨)+ jetF 動畫尾焰(**恆平行身體、相對身體向下**;靜止 ×3、移動 ×2,靜止也點著)'],
    ['觔斗雲 ×2', '焰尾凝結雲:半透明球團(一顆一件、黃金角散布、零亂數);掛在**焰的錐尖**上 ⇒ 焰隨推力伸縮時雲一律跟在尾焰末端'],
    ['長臂 ×2', '掌行長臂(t06.armUp/armFore/mount 的掌行前腳)後掠收攏'],
    ['雙腿', '同一組腿件併攏後伸(t06.thigh/shin/foot;足底噴口朝後)'],
    ['多節長尾 + 熔核砲', 'chainF 十節尾(t06.extra 同一條)繞上背、尾端熔核砲朝前瞄準'],
    ['如意金箍棒', '同一根金棒(t06.mount)改背在後背、棒身朝航向'],
  ],

  body(c, t) {
    const dim = bipedDims(t06, HG);
    groundCtx(c, dim);
    // 機身群組**沒有靜態傾角**(2026-08-15 使用者「靜止直立 / 移動前傾」)——
    // 俯仰整份交給 stepAerial 的 rig.tilt(air.pitchTop),這裡只剩位置。
    const hull = new THREE.Group();
    hull.position.set(0, -0.35, 0);
    t.add(hull);

    const hips = new THREE.Group();
    hull.add(hips);
    t06.pelvis(c, hips, { shoulderX: dim.shoulderX });
    const chest = new THREE.Group();
    hips.add(chest);
    t06.chest(c, chest, { shoulderX: dim.shoulderX, shoulderY: dim.shoulderYl, waistY: dim.waistYl });
    c._chest = chest;                          // lift() 的噴射包掛回同一個胸腔框
    // 猴首:直接掛在胸腔上 —— 舊制那顆反傾中介 Group 是為了抵銷**靜態**的 30° 前傾,
    // 而前傾自 2026-08-15 起是速度的函數(靜止時本來就直立)⇒ 抵銷一個常數只會讓
    // 靜止時的頭往後仰 30°。移動時頭與身體一起前傾 = 使用者的「身體保持前傾」。
    const hd = new THREE.Group();
    hd.position.set(0, dim.headYl, 0.04);
    chest.add(hd);
    t06.head(c, hd);

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
    // 棒身沿局部 +y ⇒ Rx(π/2) 把它送到機體的 +z(航向)。機身群組已無靜態傾角 ⇒ 這裡
    // 不再補償前傾:棒跟著身體一起俯仰(它是背在背上的,本來就該跟著走)。
    staff.rotation.set(Math.PI / 2, 0, 0.04);

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
      // 錨點吃地面型的噴口座標,但**朝向另算**:噴焰翎是站姿的上揚裝飾,飛行的噴流要沿
      // 機體自己的縱軸往下。掛在**胸腔**(機體框)之下 ⇒「一律平行身體」是構造保證,
      // 身體俯仰多少焰就跟著多少(舊制的反傾錨是為了朝**世界**方向,那已經不是這一輪的要求)。
      const jg = new THREE.Group();
      jg.position.set(p.x, p.y, p.z);
      jg.rotation.set(JET_X, 0, JET_Z * p.sx);   // 噴流朝機體的 −y = 相對身體向下(檔頭 JET_X)
      c._chest.add(jg);
      const fl = jetF(jg, FLAME_R, FLAME_L, 0, FLAME_Y, 0, accent);
      fl.g.rotation.x = Math.PI;                 // jetF 錐尖朝 −y ⇒ 翻正朝 +y = 噴流方向
      fl.idle = true;                            // 靜止也點著(雲掛在焰尾 ⇒ 熄火連雲一起不見)
      fl.lenF = FLAME_F;                         // 靜止 ×3 / 移動 ×2(stepAerial 兩端倍率)
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
      cg.scale.setScalar(CLOUD_F);               // 「凝結雲大小全部 ×2」(球數與黃金角散布不動)
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
