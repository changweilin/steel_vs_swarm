// ============ t11@flight 逐機零件檔(航空機體;dev-only)============
// t11「老兵」可變式戰術指導機 —— **飛行型**(tilt 傾轉旋翼母艦)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t11_flight_static.jpg(/ t11_ground_static.jpg)
//
// 2026-08-13 使用者定案:「傾轉旋翼艦:姿態預期差不多,但地面/飛行形態要改為**相同零件組裝**。」
//   ⇒ 本檔**一顆自己的幾何都沒有**:整台機由 `t11.js` 的建構器組出來,飛行型只是換一組擺位。
//     ① 軀幹(含雙側貨運掛架與滿載的帆布/油桶/備胎)整組前傾 PITCH 攤平成機身
//        (2026-08-14 由 ≈74.5° 改為**恰 90°** —— 使用者:「身體與地面平行」);
//     ② 車長指揮塔(t11.head)靠反傾中介 Group 站回垂直 —— 它在 2D 兩張圖上都是同一具塔;
//        2026-08-14 塔身改成**等腰直角三角形**稜柱、外加一頂同角度的**三角型頭盔**
//        (t11.head / t11.helmet),攤平後那個 90° 尖端 = 機鼻,兩腰與雙臂共線;
//     ③ **雙臂後掠 = 主翼**:上臂/前臂本來就各掛一片臂側主翼板(t11.armUp/armFore 的 finF),
//        朝斜後方伸出之後那兩片就是翼面,掛架托盤(1.3m 長托板)就是翼根;
//     ④ **拳側旋翼盤圓盾 = 翼端旋翼**(t11.rotorDisc,唯一縫):地面握在手上當盾、飛行轉成
//        水平槳盤自轉 —— 這正是「傾轉旋翼艙在翼端轉九十度」那句話的零件級解;
//        2026-08-14 盤內那四條徑肋在飛行型**伸出盤外一個前臂長**成大槳葉(c.rotorBlade);
//     ⑤ 雙腿**內縮**成與地面平行、朝斜後方(同一組 thigh/shin/foot)= 平面形的後緣內段。
//   高度因此 MUST 與地面型同值(6.0):兩態是同一台機,零件尺寸差一格就不是同一組零件了。
//
// gen.note:「掛架上 MUST 真的掛滿東西」—— 這一條由「掛架整組沿用地面型」自動成立(構造保證),
// 本檔不再另列一份 CARGO 清單(舊制那份是第二份貨物真相,地面型加一件貨飛行型不會跟著有)。
import * as THREE from 'three';
import { cylF, torusF, COAL } from '../geo.js';
import t11 from './t11.js';
import { bipedDims, groundCtx, upright } from './_morph.js';

// ── 2026-08-14 使用者定案(飛行型改成 **B-2 平面形**)──────────────────────────
//   「飛行形態時**身體與地面平行**,**雙腿內縮平行地面朝斜後方**,**圓盾內部會延伸出前臂長
//     的大旋翼**,**頭部改成等腰直角三角形**,**雙臂朝斜後方**,頭部 + 雙臂 + 內縮的雙腿
//     剛好呈現 B2 轟炸機的姿態。」
//   ⇒ 這一輪改的是**姿態與一個零件的形狀**,「兩態同一組零件」一格未動(頭仍是 t11.head、
//     翼仍是雙臂、翼端旋翼仍是 t11.rotorDisc)。
//   ⇒ 讀法(俯視):三角形頭 = 機鼻的 90° 尖 → 雙臂後掠 = 前緣 → 內縮雙腿 = 後緣內段。
//      三者 MUST **共面**:軀幹恰好攤平(PITCH = π/2)之後,肩(胸腔局部 y)與髖(hull 局部
//      y = 0)都落在同一個世界 y ⇒ 平面形是「畫」出來的,不是靠三組角度湊出來的。
//   ⚠ 前傾角一旦不是 π/2,上面那句就不成立(軀幹斜著 ⇒ 肩比髖高)—— 舊值 1.30(74.5°)
//     正是這樣,俯視讀不出翼面而側視是一台低頭的人形。
const PITCH = Math.PI / 2;    // 軀幹前傾角 = 90°:身體與地面平行(使用者定案)
// 平面形的兩個後掠角(自**橫向**量起;肢體鏈的 Rz 角 = π/2 − 後掠角,見 body 內的推導)
// 2026-08-14 使用者:「戴上三角型頭盔,**飛行時與雙臂角度一致**,讓上視圖輪廓像 B2 轟炸機」
// ⇒ 後掠角 MUST 由頭盔的頂角**推導**:盔是等腰直角三角形(t11.helmet)⇒ 兩腰各與中線夾
//   HELM_APEX/2 = 45° ⇒ 「臂與腰平行」的條件就是臂與中線也夾 45° = 自橫向量起 π/2 − 45°。
//   手寫 0.58(≈33°,真 B-2 的前緣後掠)的話盔的腰與臂差 12° —— 俯視那條前緣會折一下,
//   而正視/側視完全正常。盔尖的**位置**另由 t11.helmet 推導,兩者合起來兩段才共線。
const HELM_APEX = Math.PI / 2;                    // 頭盔頂角(= t11.helmet 的等腰直角)
const ARM_SWEEP = Math.PI / 2 - HELM_APEX / 2;    // = π/4:雙臂 = 前緣,與盔的兩腰平行且共線
const LEG_SWEEP = 1.05;       // 大腿 ≈60°,小腿再折到 ≈86° ⇒ 「內縮、平行地面、朝斜後方」
const SHIN_TUCK = 0.45;       // 膝在**水平面內**再折的量(內縮;MUST 是 z 轉不是 x 轉)
const DISC_R = 0.57;          // 旋翼盤輪緣半徑(= t11.rotorDisc 的 torusF 半徑;槳葉伸出量自此起算)
const HG = 6.0;               // 地面型的取景高 = 兩態共用的骨架尺度基準

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝);舊制的 0x8a95da 是另一台機的顏色
  label: '老兵・飛行型(t11 傾轉旋翼母艦)', hue: t11.hue, kind: 'air', height: HG,
  air: { tiltY: 3.1, bob: 0.04, top: 22, span: 9.0 },   // 翼展含伸出的槳葉(舊 6.5 是側伸 + 收在盾內的年代)
  moveSig: { hover: 0.30, hoverF: 0.7, hoverA: 0.10, surge: 0.55, flare: 0.20, bank: 0.60 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['機身(與地面平行)', '地面型軀幹(t11.chest)整組攤平 90° —— 含腰腹段、背馱貨箱、防滾籠'],
    ['機鼻 = 三角型頭盔', '地面型頭部(t11.head + t11.helmet)+ 反傾中介 Group;等腰直角盔的 90° 尖端朝航向 = B-2 機鼻,兩腰與雙臂共線'],
    ['主翼 ×2(後掠 45° = 盔的兩腰)', '雙臂朝斜後方:上臂/前臂的臂側主翼板(finF)成翼面、圓筒大肩甲成翼根整流罩'],
    ['翼端旋翼 ×2', '拳側旋翼盤圓盾(t11.rotorDisc)轉成水平槳盤;**盤內徑肋伸出盤外一個前臂長**成大槳葉 + 自轉層(userData.spin)'],
    ['翼上掛載', '雙側貨運掛架整組沿用(帆布大圓捆/麻袋/油桶/備胎/蜂群發射巢/吊掛貨櫃)'],
    ['後緣內段 ×2', '同一組大腿/小腿/大平足(t11.thigh/shin/foot)內縮成與地面平行、朝斜後方'],
    ['武裝', '同一具右架雙聯機槍莢 + 左架集束布撒器,改掛在反傾硬點上朝航向'],
  ],

  body(c, t) {
    const dim = bipedDims(t11, HG);
    groundCtx(c, dim);                       // 航空鷹架的 baseCtx 恆給 G:1 ⇒ 補回地面型的 girth
    const hull = new THREE.Group();
    hull.position.set(0, 0.15, -0.5);
    hull.rotation.x = PITCH;
    t.add(hull);

    // ---- 骨盆 → 胸腔(掛架與貨物隨之成為翼根載重)----
    const hips = new THREE.Group();
    hull.add(hips);
    t11.pelvis(c, hips, { shoulderX: dim.shoulderX });
    const chest = new THREE.Group();
    hips.add(chest);
    t11.chest(c, chest, { shoulderX: dim.shoulderX, shoulderY: dim.shoulderYl, waistY: dim.waistYl });

    // ---- 車長指揮塔:反傾站回垂直(2D 兩張圖都是同一具塔)----
    // `noseHelm` = 這一態的**戴法**:三角盔放平朝航向當機鼻(地面型不設 ⇒ 立起來當武士兜,
    // 見 t11.helmet 檔頭)。旗標住 c 而不是另建一頂盔 —— 同 c.rotorBlade 的作法。
    c.noseHelm = true;
    t11.head(c, upright(chest, PITCH, 0, dim.headYl, 0.04));

    // ---- 雙臂後掠 = 主翼前緣;拳端旋翼盤 = 翼端旋翼艙 ----
    // 軀幹攤平之後,胸腔局部 +y = 世界 +z(機首)、局部 +x = 世界 +x ⇒ 肢體鏈(沿局部 −y)
    // 繞 z 轉 φ 得方向 (sin φ, −cos φ, 0) → 世界 (sin φ, 0, −cos φ)。
    // 取 φ = sx·(π/2 − Λ) ⇒ 世界方向 (sx·cos Λ, 0, −sin Λ) = 往外 + **往後** Λ。
    // ⇒ Λ 就是後掠角本身,而 y 分量恆為 0 = 翼面與地面平行(上反角刻意為 0:飛翼)。
    const hands = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const arm = new THREE.Group();
      arm.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      arm.rotation.z = sx * (Math.PI / 2 - ARM_SWEEP);
      chest.add(arm);
      t11.armUp(cx, arm, { len: dim.upperArmL });
      const fore = new THREE.Group();
      fore.position.y = -dim.upperArmL;
      arm.add(fore);
      t11.armFore(cx, fore, { len: dim.foreArmL });
      const hand = new THREE.Group();
      hand.position.y = -dim.foreArmL;
      fore.add(hand);
      // 傾轉軸環 + 艙殼(艙與翼的接點;地面型腕部束環的位置)。
      // 肢體鏈恆沿局部 −y 往外長 ⇒ 艙件一律擺在 −y,MUST NOT 用 ±x(那是翼弦方向)。
      torusF(hand, 0.21, 0.05, 0, -0.06, 0, COAL, { metalness: 0.88 }).rotation.x = Math.PI / 2;
      cylF(hand, 0.19, 0.22, 0.4, 10, 0, -0.3, 0, c.PAL.deep, { metalness: 0.75 });
      hands[sx] = hand;
    }

    // ---- 雙腿內縮 ×2:與地面平行、朝斜後方 = B-2 的後緣內段(使用者定案)----
    // 與雙臂**同一條推導**(hull 攤平之後局部 +y = 世界 +z),差別只有後掠角更大;
    // ⚠ 膝的內縮 MUST 是 **z 轉**:x 轉是在「肢體軸 × 局部 z」那個平面裡折,而局部 z 已被
    //   PITCH 送到世界 −y ⇒ 寫成 x 轉的話小腿是往**地面**折下去(起落架姿態),
    //   而俯視的平面形完全看不出差別。
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const root = new THREE.Group();
      root.position.set(sx * dim.legX, 0, 0);
      root.rotation.z = sx * (Math.PI / 2 - LEG_SWEEP);
      hull.add(root);
      t11.thigh(cx, root, { len: dim.thighL });
      const shin = new THREE.Group();
      shin.position.y = -dim.thighL;
      shin.rotation.z = -sx * SHIN_TUCK;     // 在水平面內再折 ⇒ 小腿幾乎正朝機尾
      root.add(shin);
      t11.shin(cx, shin, { len: dim.shinL });
      const foot = new THREE.Group();
      foot.position.y = -dim.shinL;
      foot.rotation.z = -sx * 0.10;
      shin.add(foot);
      t11.foot(cx, foot, { clear: dim.clear, footL: dim.footL });
    }

    // ---- 武裝硬點:掛架不動,武器改掛在反傾硬點上 ⇒ 槍口朝航向而不是朝天 ----
    for (const k of ['rackL', 'rackR']) if (c[k]) c[k] = upright(c[k], PITCH);
    // 「圓盾內部會延伸出**前臂長**的大旋翼」:槳葉自盤心貫穿(徑肋是整根直徑條)⇒ 全長 =
    // 2 × (盤半徑 + 伸出量),伸出量取**前臂長**。兩個數字都是推導的 —— 盤半徑寫死在
    // rotorDisc 的輪緣環、前臂長吃骨架尺寸,手寫一個全長就是「改骨架比例後槳葉不跟著長」。
    c.rotorBlade = { len: 2 * (DISC_R + dim.foreArmL), w: 0.16 };
    c._W = t11.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });

    // ---- 旋翼盤定向:mount 已經把同一顆盤掛在拳上(地面 = 圓盾)—— 這裡只把它轉成水平槳盤。
    // 角度**由手部的世界旋轉反解**,不手寫一組尤拉角:手臂日後多一個上反角/後掠角,
    // 手寫的那組角會靜默歪掉,而截圖上只表現成「槳盤有點斜」。
    const q = new THREE.Quaternion();
    c._spin = (c.discs || []).map(({ g, spin, hand }) => {
      hand.getWorldQuaternion(q);
      g.quaternion.copy(q).invert();           // 盤面法線(局部 +y)= 世界 +y
      g.position.set(0, -0.62, 0);             // 沿臂軸再往外 = 翼端
      return spin;
    });
  },

  // 旋翼自轉名冊(戰場 game.js spinners / 展示台 viewer 同吃 userData.spin)
  lift(c) { return { spin: c._spin || [] }; },

  mount(c) { return c._W; },
};
