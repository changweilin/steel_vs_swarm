// ============ t11@flight 逐機零件檔(航空機體;dev-only)============
// t11「老兵」可變式戰術指導機 —— **飛行型**(tilt 傾轉旋翼母艦)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t11_flight_static.jpg(/ t11_ground_static.jpg)
//
// 2026-08-13 使用者定案:「傾轉旋翼艦:姿態預期差不多,但地面/飛行形態要改為**相同零件組裝**。」
//   ⇒ 本檔**一顆自己的幾何都沒有**:整台機由 `t11.js` 的建構器組出來,飛行型只是換一組擺位。
//     ① 軀幹(含雙側貨運掛架與滿載的帆布/油桶/備胎)整組前傾 PITCH ≈ 81° 攤平成機身;
//     ② 車長指揮塔(t11.head)靠反傾中介 Group 站回垂直 —— 它在 2D 兩張圖上都是同一具塔;
//     ③ **雙臂側伸 = 主翼**:上臂/前臂本來就各掛一片臂側主翼板(t11.armUp/armFore 的 finF),
//        側伸之後那兩片就是翼面,掛架托盤(1.3m 長托板)就是翼根;
//     ④ **拳側旋翼盤圓盾 = 翼端旋翼**(t11.rotorDisc,唯一縫):地面握在手上當盾、飛行轉成
//        水平槳盤自轉 —— 這正是「傾轉旋翼艙在翼端轉九十度」那句話的零件級解;
//     ⑤ 雙腿在機腹下摺成起落腿(同一組 thigh/shin/foot)。
//   高度因此 MUST 與地面型同值(6.0):兩態是同一台機,零件尺寸差一格就不是同一組零件了。
//
// gen.note:「掛架上 MUST 真的掛滿東西」—— 這一條由「掛架整組沿用地面型」自動成立(構造保證),
// 本檔不再另列一份 CARGO 清單(舊制那份是第二份貨物真相,地面型加一件貨飛行型不會跟著有)。
import * as THREE from 'three';
import { cylF, torusF, COAL } from '../geo.js';
import t11 from './t11.js';
import { bipedDims, groundCtx, upright } from './_morph.js';

const PITCH = 1.30;           // 軀幹前傾角(≈74.5°;攤平成機身,留一點抬頭讓指揮塔不埋進機背)
const DIHED = 0.09;           // 主翼上反角(雙臂側伸時的翼端上抬)
const HG = 6.0;               // 地面型的取景高 = 兩態共用的骨架尺度基準

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝);舊制的 0x8a95da 是另一台機的顏色
  label: '老兵・飛行型(t11 傾轉旋翼母艦)', hue: t11.hue, kind: 'air', height: HG,
  air: { tiltY: 3.1, bob: 0.04, top: 22, span: 6.5 },
  moveSig: { hover: 0.30, hoverF: 0.7, hoverA: 0.10, surge: 0.55, flare: 0.20, bank: 0.60 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['機身', '地面型軀幹(t11.chest)整組前傾攤平 —— 含腰腹段、背馱貨箱、防滾籠'],
    ['車長指揮塔', '地面型頭部(t11.head)+ 反傾中介 Group 站回垂直(兩態同一具塔)'],
    ['主翼 ×2', '雙臂側伸:上臂/前臂的臂側主翼板(finF)成翼面、圓筒大肩甲成翼根整流罩'],
    ['翼端旋翼 ×2', '拳側旋翼盤圓盾(t11.rotorDisc)轉成水平槳盤 + 盤心自轉層(userData.spin)'],
    ['翼上掛載', '雙側貨運掛架整組沿用(帆布大圓捆/麻袋/油桶/備胎/蜂群發射巢/吊掛貨櫃)'],
    ['起落腿 ×2', '同一組大腿/小腿/大平足(t11.thigh/shin/foot)在機腹下摺起'],
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
    t11.head(c, upright(chest, PITCH, 0, dim.headYl, 0.04));

    // ---- 雙臂側伸 = 主翼;拳端旋翼盤 = 翼端旋翼艙 ----
    const hands = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const arm = new THREE.Group();
      arm.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      arm.rotation.z = sx * (Math.PI / 2 + DIHED);   // 肢體幾何朝 −y ⇒ 繞 z 轉 90° 後朝 ±x = 翼展方向(多轉 = 上反)
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

    // ---- 起落腿 ×2:同一組腿件在機腹下摺起(反傾後再屈膝 ⇒ 腳掌朝前下方)----
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const root = new THREE.Group();
      root.position.set(sx * dim.legX, 0, 0);
      root.rotation.x = -PITCH - 0.35;       // 世界垂直再前擺(大腿朝前下)
      hull.add(root);
      t11.thigh(cx, root, { len: dim.thighL });
      const shin = new THREE.Group();
      shin.position.y = -dim.thighL;
      shin.rotation.x = 1.05;                // 膝後折(+x = 末端後移)⇒ Z 形起落腿
      root.add(shin);
      t11.shin(cx, shin, { len: dim.shinL });
      const foot = new THREE.Group();
      foot.position.y = -dim.shinL;
      foot.rotation.x = -0.72;
      shin.add(foot);
      t11.foot(cx, foot, { clear: dim.clear, footL: dim.footL });
    }

    // ---- 武裝硬點:掛架不動,武器改掛在反傾硬點上 ⇒ 槍口朝航向而不是朝天 ----
    for (const k of ['rackL', 'rackR']) if (c[k]) c[k] = upright(c[k], PITCH);
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
