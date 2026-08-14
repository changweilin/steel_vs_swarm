// ============ 變形者兩態共用縫(dev-only;不是一台機體,index.js 不收)============
// 2026-08-13 使用者指示:「盡量用相同零件變形切換地面/飛行形態」。
// ⇒ 變形者的飛行型 MUST 由**地面型那一份零件建構器**組裝出來,兩態的差別只有「擺位」:
//   同一顆頭、同一片胸甲、同一組四肢、同一把武器,換一組靜態旋轉就是另一個型態。
//   各畫一組的下場是兩座管理頁看起來像兩台機,而兩邊都不會報錯(t06/t11/m01/m05 的
//   飛行檔原本就只共用一顆頭,其餘全是另寫的幾何)。
//
// 本檔只放**兩態共用的那幾件事**,零幾何:
//   ① bipedDims:forge.js 餵給人形建構器的那一組公尺尺寸(飛行檔要拿到同一份才會同尺寸)
//   ② posed:把一顆「反向抵銷母體傾角」的中介 Group 掛上去(飛行姿態的共同句型)
//
// ⚠ ① 是 forge.js:184-192 那段算式的鏡射。**預設值刻意不複製** —— 四台變形者地面型的
//   prop 都把十個鍵寫滿了,缺鍵一律當場拋錯;悄悄補一份自己的預設 = forge.js 改了
//   HUMANOID.def 之後兩態的零件尺寸靜默分家,而畫面上只表現成「飛行型好像胖了一點」。
import * as THREE from 'three';

const KEYS = ['hips', 'legSplay', 'thigh', 'shin', 'shoulderY', 'shoulderX', 'upperArm', 'foreArm', 'head', 'girth'];

/**
 * 地面型(人形鷹架)的骨架公尺尺寸 —— 飛行檔用它餵同一組建構器。
 * D = 地面型的 default export(讀 D.prop 與 D.height);回傳值的鍵名逐字同 forge.js 的區域變數。
 */
export function bipedDims(D, height) {
  const P = D.prop || {};
  for (const k of KEYS) if (typeof P[k] !== 'number') throw new Error(`[_morph] ${D.label}:prop.${k} 缺席 —— 變形者地面型 MUST 把十個人形特徵寫滿(飛行型吃同一份)`);
  const H = height ?? D.height ?? 6.0;
  const G = P.girth;
  const hipY = P.hips * H;
  const thighL = P.thigh * hipY, shinL = P.shin * hipY;
  const shoulderY = P.shoulderY * H;
  return {
    H, G, hipY, thighL, shinL,
    clear: Math.max(0.1, hipY - thighL - shinL),
    legX: P.legSplay * H * Math.max(1, G * 0.9),
    shoulderX: P.shoulderX * H * Math.max(1, G * 0.9),
    upperArmL: P.upperArm * H, foreArmL: P.foreArm * H,
    waistYl: 0.12 * H, shoulderYl: shoulderY - hipY, headYl: P.head * H - hipY,
    footL: 0.3 + 0.22 * G,
  };
}

/**
 * 飛行檔用的建構情境:把地面型那一份 `c.G` / `c.dims` 補回航空鷹架的 baseCtx。
 * 航空鷹架的 baseCtx 恆給 `G: 1` 與 `dims: {...air}`(forge.js:437)—— 直接拿去餵地面型
 * 建構器的話,凡是乘 `c.G` 的零件(t11 girth 1.15)會比地面型瘦一圈,而兩張截圖分開看
 * 都很正常。`c` 是三支建構器共用的同一個物件 ⇒ 在 body() 裡改一次即可。
 */
export function groundCtx(c, dim) {
  c.G = dim.G;
  c.dims = { shoulderYl: dim.shoulderYl, waistYl: dim.waistYl, shoulderX: dim.shoulderX, headYl: dim.headYl };
  return c;
}

/**
 * 把 `segLimbF` 的分節規格**靜態**組起來(飛行檔用:同一組肢件、另一組姿態)。
 * 四足鷹架的 `D.legF/legH` 回傳的就是這種規格陣列 —— 飛行型不需要步態鏈,只要擺好位置,
 * 但零件 MUST 是同一批(自己在飛行檔另寫一組腿 = 兩態的腿長得不一樣,而兩張圖分開看都正常)。
 * poses[i] = 第 i 節的 rotation.x(省略則沿用該節宣告的 base)。
 */
export function staticLimb(parent, segs, poses = [], pos = [0, 0, 0], rot = null) {
  const root = new THREE.Group();
  root.position.set(pos[0], pos[1], pos[2]);
  if (rot) root.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  parent.add(root);
  let cur = root;
  segs.forEach((s, i) => {
    if (i > 0) {
      const j = new THREE.Group();
      const pv = s.piv;
      j.position.set(pv ? pv[0] : 0, pv ? pv[1] : -segs[i - 1].len, pv ? pv[2] : 0);
      j.rotation.x = poses[i] != null ? poses[i] : (s.base || 0);
      cur.add(j);
      cur = j;
    } else if (poses[0] != null) root.rotation.x += poses[0];
    s.draw(cur);
  });
  return root;
}

/** 反傾中介 Group:掛在傾了 `pitch` 的母體之下,讓子零件回到世界水平(座艙/旋翼盤/起落腿) */
export function upright(parent, pitch, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.x = -pitch;
  parent.add(g);
  return g;
}
