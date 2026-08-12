// ============ 武器獨立檢視(兩座看板共用;dev-only)============
// 「哪些節點屬於這把武器」的唯一真相 = `rig.wpn[slot].nodes` —— 那是 FPV 座艙同源的既有縫。
// 武器檢視 = **同一棵零件樹的一個可見性子集 + 依它的包圍盒重新取景**,
// MUST NOT 為武器台另建一份武器幾何:兩份幾何會各自演化,台上調好的與機體上掛的不是同一把。
//
// 2026-08-12 第五輪追加:使用者「機體美術台沒看到武器模組跳轉頁面」⇒ 覆核台 :8641 也要這一頁,
// 於是這段邏輯有了**第二個消費端**,整組搬出來共用(展示台 :8631 的 applyView 轉呼)。
//
// 一條容易漏的線:回到機體時的「全部顯示」MUST 尊重紙娃娃的**隱藏**覆寫
// (`userData.dollHidden`)—— 直接 `visible = true` 掃全樹的話,切一次武器頁再切回來,
// 使用者藏起來的零件就自己冒出來了,而覆寫層裡它明明還是隱藏的。
import * as THREE from 'three';

/** 三態(兩座看板的鈕面順序同吃這一份) */
export const WPN_VIEWS = [['mech', '機體'], ['light', '武器・輕'], ['heavy', '武器・重']];
export const wpnLabel = (v) => (WPN_VIEWS.find(([k]) => k === v) || [, v])[1];
export const wpnSlotName = (v) => (v === 'light' ? '輕' : '重');

/** 這一格有沒有掛這個槽位(沒有 = 鈕面不出現;`mech` 恆回 null) */
export function wpnOf(unit, slot) {
  return slot && slot !== 'mech' ? unit?.rig?.wpn?.[slot] || null : null;
}

/**
 * 可見性子集:`mech` = 全開(尊重紙娃娃隱藏),武器 = 只留那把武器的節點。
 * @returns true = 已套用;false = 這一格沒掛這個槽位(呼叫端 MUST 退回機體檢視)
 */
export function showWpn(unit, slot) {
  unit.group.traverse((o) => { if (o.isMesh) o.visible = !o.userData.dollHidden; });
  const w = wpnOf(unit, slot);
  if (!w) return slot === 'mech' || !slot;
  const keep = new Set();
  for (const n of w.nodes || []) n.traverse((o) => keep.add(o));
  unit.group.traverse((o) => { if (o.isMesh && !keep.has(o)) o.visible = false; });
  return true;
}

/**
 * 武器取景:回 { center, dist } 或 null(空盒 = 這一格沒掛,呼叫端退回機體取景)。
 * 包圍盒量的是**世界**座標 ⇒ 呼叫端 MUST 先 updateMatrixWorld。
 */
export function wpnFrame(unit, slot) {
  const w = wpnOf(unit, slot);
  if (!w) return null;
  unit.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const n of w.nodes || []) box.expandByObject(n);
  if (box.isEmpty()) return null;
  return {
    center: box.getCenter(new THREE.Vector3()),
    dist: Math.max(0.6, box.getSize(new THREE.Vector3()).length()),
  };
}

/**
 * 取景 + 定向一次做完(兩座看板的鏡頭都是「target + position」這一組)。
 * MUST **當場** lookAt:互動時是 loop 裡的 controls.update() 在轉鏡頭,而 headless 檢視
 * (pane 不合成 ⇒ rAF 不跑)沒有 loop,只搬 position 不轉向的話拍到的是上一個取景的朝向。
 */
export function applyWpnCamera(camera, target, f) {
  target.copy(f.center);
  // 距離 MUST 留餘裕:視角半高 = D·tan(fov/2),而 f.dist 是**包圍盒對角線**⇒ 物件半高 = dist/2。
  // 舊的方位向量長度 1.53×dist 在 fov 38° 下算出來的可視半高是 0.527×dist —— 與 0.5 只差 5%,
  // 武器一斜、畫布一寬就伸出畫面(2026-08-12 實測 t01 斧砲被切掉左半)。
  // 1.9× 對角線 ⇒ 可視半高 0.65×dist,約三成餘裕,長條狀的武器轉到任何角度都收得進去。
  const FIT = 1.9;
  const d = new THREE.Vector3(0.9, 0.45, 1.15).normalize().multiplyScalar(f.dist * FIT);
  camera.position.copy(f.center).add(d);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}
