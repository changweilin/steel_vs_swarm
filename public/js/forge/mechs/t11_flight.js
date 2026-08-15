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
//     ⑤ 雙腿**內縮**成與地面平行、朝斜後方(同一組 thigh/shin/foot)= 平面形的後緣內段;
//     ⑥ **肩甲(= 雙側那兩片大平板,程式裡的舊名字是「貨運掛架」)自己反解成純偏航**
//        (2026-08-15 使用者附圖:「武器一律掛在肩甲上方,始終轉向前方,變形時肩甲平面保持
//        平行地面,水平旋轉至平行雙臂」)—— 見下方 racks 那一段。
//        ⚠ 肩關節上那顆圓筒鼓**不是**肩甲(同日標色圖裁決:它太小、被這兩片板整個蓋住)。
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
const RACK_GAP = 0.06;        // 肩甲托盤底面與翼面之間的淨空(公尺;後掠之後兩者平行,見下方 lift)
const LEG_SWEEP = 1.05;       // 大腿 ≈60°,小腿再折到 ≈86° ⇒ 「內縮、平行地面、朝斜後方」
const SHIN_TUCK = 0.45;       // 膝在**水平面內**再折的量(內縮;MUST 是 z 轉不是 x 轉)
const DISC_R = 0.57;          // 旋翼盤輪緣半徑(= t11.rotorDisc 的 torusF 半徑;槳葉伸出量自此起算)
const HG = 6.0;               // 地面型的取景高 = 兩態共用的骨架尺度基準

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝);舊制的 0x8a95da 是另一台機的顏色
  label: '老兵・飛行型(t11 傾轉旋翼母艦)', kind: 'air', height: HG,
  air: { tiltY: 3.1, bob: 0.04, top: 22, span: 9.0 },   // 翼展含伸出的槳葉(舊 6.5 是側伸 + 收在盾內的年代)
  moveSig: { hover: 0.30, hoverF: 0.7, hoverA: 0.10, surge: 0.55, flare: 0.20, bank: 0.60 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['機身(與地面平行)', '地面型軀幹(t11.chest)整組攤平 90° —— 含腰腹段、背馱貨箱、防滾籠'],
    ['機鼻 = 三角型頭盔', '地面型頭部(t11.head + t11.helmet)+ 反傾中介 Group;等腰直角盔的 90° 尖端朝航向 = B-2 機鼻,兩腰與雙臂共線'],
    ['主翼 ×2(後掠 45° = 盔的兩腰)', '雙臂朝斜後方 + **肩關節滾轉 90°**:上臂/前臂的臂側主翼板(finF)片面轉成水平成翼面'],
    ['肩甲 ×2(大平板)', '雙側掛架托盤反解成**純偏航** = 後掠角:板面保持**平行地面**、長軸**平行雙臂** ⇒ 與盔的兩腰同角,一同構成 B-2 的三角形;板上照舊掛滿貨'],
    ['翼端旋翼 ×2', '拳側旋翼盤圓盾(t11.rotorDisc)**跟著臂滾成水平槳盤**(盤與臂恆同角,傾轉的是整個短艙);**盤內徑肋伸出盤外一個前臂長**成大槳葉 + 自轉層(userData.spin)'],
    ['翼上掛載', '雙側貨運掛架整組沿用(帆布大圓捆/麻袋/油桶/備胎/蜂群發射巢/吊掛貨櫃)'],
    ['後緣內段 ×2', '同一組大腿/小腿/大平足(t11.thigh/shin/foot)內縮成與地面平行、朝斜後方'],
    ['武裝', '同一具雙聯機槍莢 + 集束布撒器,坐在**肩甲板面上**、由轉向層反解 + 陀螺穩定成**始終朝航向**'],
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
    const hands = {}, arms = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const arm = new THREE.Group();
      arm.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      arm.rotation.z = sx * (Math.PI / 2 - ARM_SWEEP);
      chest.add(arm);
      arms[sx] = arm;
      // ---- 肩關節滾轉(2026-08-15 使用者:「連同雙臂旋轉肩關節」)----
      // 繞**肢體長軸**滾 90°(肢體鏈沿局部 −y ⇒ 繞局部 y 就是滾轉)。整條臂是一個剛體,
      // 滾它就是滾臂上的每一樣東西 —— 這一個角度解掉的是**翼**這一半:
      //   ① 臂側主翼板的片面法線轉成**垂直** ⇒ 翼面水平(舊制實測法線 (0.71,0,0.71) = 水平,
      //      翼其實是**立**著的兩片鰭,而檔頭一直宣稱它是水平翼面);
      //   ② 拳側旋翼盤跟著轉成**水平槳盤** —— 這正是「傾轉旋翼」該有的解法:轉的是整個
      //      短艙(臂),不是把盤自己扭回去(舊制 `g.quaternion.copy(q).invert()`),
      //      使用者「雙臂始終與圓盾保持相同角度」講的就是這件事。
      // ⚠ 肩甲(那兩片大平板)掛在**胸腔**上、不在臂上 ⇒ 這個滾轉碰不到它,它自己反解(下方)。
      const roll = new THREE.Group();
      roll.rotation.y = sx * Math.PI / 2;
      arm.add(roll);
      t11.armUp(cx, roll, { len: dim.upperArmL });
      const fore = new THREE.Group();
      fore.position.y = -dim.upperArmL;
      roll.add(fore);
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

    // ---- 肩甲(兩片大平板):平面保持平行地面 + 水平旋轉至平行雙臂(2026-08-15 使用者附圖)----
    // 目標世界姿態 = **純偏航** Ry(sx·Λ),Λ = 後掠角。一個角度同時解掉那句話的兩半:
    //   ㋐ 純偏航 ⇒ 沒有俯仰也沒有滾轉 ⇒ 托盤的**面法線恆為世界上方** = 板面平行地面
    //      (改制前實測法線 (0, 0.003, 0.998) —— 軀幹攤平 90° 把整片板一起立了起來);
    //   ㋑ 托盤的**長軸**(局部 ±x)⇒ 世界 (cos ψ, 0, −sin ψ);臂的世界方向是
    //      (sx·cos Λ, 0, −sin Λ)(見上方推導)⇒ ψ = sx·Λ 時兩者**平行**(改制前是正橫向,
    //      完全沒有後掠)。Λ 本身由頭盔頂角推導 ⇒ 盔的兩腰 / 雙臂 / 兩片肩甲三者同角
    //      = 一同維持 B-2 的三角形。
    // 反解而不是手寫尤拉角:後掠角 / 軀幹攤平角日後任一改動,這裡自己跟著走。
    // ⚠ MUST 排在 `t11.mount` 之前:武器轉向層掛在板上的硬點之下,它的反解吃的是硬點的**世界**姿態。
    const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), AX_Y = new THREE.Vector3(0, 1, 0);
    const bbA = new THREE.Box3(), bbT = new THREE.Box3(), lv = new THREE.Vector3();
    for (const sx of [-1, 1]) {
      const rk = chest.getObjectByName(sx > 0 ? 'rackR' : 'rackL');
      if (!rk) continue;
      rk.parent.getWorldQuaternion(q);
      qy.setFromAxisAngle(AX_Y, sx * ARM_SWEEP);
      rk.quaternion.copy(q).invert().multiply(qy);
      // ── 後掠之後 MUST 抬到翼面**之上** ──
      // 板轉成與臂平行之後,它與整條臂就是兩條平行線,側向間距只有 0.42m < 翼弦一半
      // ⇒ 不抬的話托盤會**從翼裡穿過去**(實測與上臂殼/前臂殼/翼前緣識別條/肩關節護甲
      // 四件相交),而俯視圖(B-2 那張)剛好完全看不出來。
      // 抬升量**量出來**不手寫:該側整條臂的世界頂面 − 托盤底面 + 淨空。
      const arm = arms[sx];
      if (!arm || !rk.userData.tray) continue;
      chest.updateMatrixWorld(true);
      bbA.setFromObject(arm);
      bbT.setFromObject(rk.userData.tray);
      const lift = Math.max(0, bbA.max.y + RACK_GAP - bbT.min.y);
      // 世界 +y 的位移要轉回**父(胸腔)的局部框**才寫得進 position(胸腔已被攤平 90°)
      rk.parent.getWorldQuaternion(q);
      rk.position.add(lv.set(0, lift, 0).applyQuaternion(q.invert()));
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

    // 「圓盾內部會延伸出**前臂長**的大旋翼」:槳葉自盤心貫穿(徑肋是整根直徑條)⇒ 全長 =
    // 2 × (盤半徑 + 伸出量),伸出量取**前臂長**。兩個數字都是推導的 —— 盤半徑寫死在
    // rotorDisc 的輪緣環、前臂長吃骨架尺寸,手寫一個全長就是「改骨架比例後槳葉不跟著長」。
    c.rotorBlade = { len: 2 * (DISC_R + dim.foreArmL), w: 0.16 };
    c._W = t11.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });

    // ---- 旋翼盤:**角度一格不動**(2026-08-15 使用者「雙臂始終與圓盾保持相同角度」)----
    // 舊制在這裡把盤的世界旋轉反解掉(`g.quaternion.copy(q).invert()`)⇒ 盤與臂的相對角度
    // 兩態不同 = 使用者這一輪要拿掉的東西。盤之所以變成水平槳盤,現在是**肩關節滾了 90°**
    // 的結果(見上方 roll)—— 傾轉旋翼轉的是整個短艙,不是盤自己。
    // 這裡只剩**位置**:沿臂軸再往外挪到翼端(位置不是角度,不違反上面那句)。
    c._spin = (c.discs || []).map(({ g, spin }) => {
      g.position.set(0, -0.62, 0);
      return spin;
    });

    // ---- 肩甲上的武器**始終轉向前方**(2026-08-15 使用者)----
    // 肩甲偏航之後,武器硬點的局部 +z(= 槍口方向,`wpn.fwd:'z'`)偏了 sx·Λ
    // ⇒ 由**掛點的世界旋轉反解**轉向層,讓它的局部軸與世界對齊 ⇒ +z 恰為航向。
    // 這一次反解只保證**出廠那一刻**(它同時是變形運動反推的端點);逐幀那一半由
    // `rig.stab` 的陀螺穩定守著(t11.mount 登記、locomotion.stepStab 推進)——
    // 步態扭腰、飛行壓坡與懸停抖動都會把板帶偏,而畫面上只表現成「槍口有點歪」。
    for (const sw of c.wpnSwivels || []) {
      sw.parent.getWorldQuaternion(q);
      sw.quaternion.copy(q).invert();
    }
  },

  // 旋翼自轉名冊(戰場 game.js spinners / 展示台 viewer 同吃 userData.spin)
  lift(c) { return { spin: c._spin || [] }; },

  mount(c) { return c._W; },
};
