// ============ 紙娃娃覆寫層 → 零件樹(套用縫;dev-only)============
// 「使用者把這台機體拖成什麼樣子」只有這一支把它變成幾何。兩座看板(機體展示台 :8631 /
// 覆核台鍛造區塊 :8621)都是經 forge.js 的收尾呼叫進來的 ⇒ **一份實作,兩邊同形**。
//
// ---- 骨架編輯為什麼不是直接寫 bone.rotation ----
// 骨架每一幀被真品 locomotion.js 覆寫(`j.g.rotation.x = j.base + …`、`hips.position.y =
// hipsY0 + …` 都是**絕對指派**)⇒ 直接寫骨頭的話,編輯值活不過一幀,而畫面上只表現成
// 「拖了沒反應」。故每根骨底下插一個**編輯座**(socket):
//     骨(locomotion 開的)→ 編輯座(使用者開的)→ 原本的子節點
// 角度/位置寫編輯座、骨長縮放編輯座的子節點 —— 兩邊各寫各的,播放骨架運動時編輯值仍在。
// 反過來也成立:編輯座 MUST NOT 動骨本身的 transform,否則 `hipsY0`/`neckY0` 這些
// **以建構值為基準**的驅動會與編輯值疊加成雙倍位移。
//
// ---- 零件鍵是建構序路徑 ----
// 索引 MUST 在插編輯座**之前**跑完(插座會改變子節點的層數);pid 寫進 userData 之後
// 就與樹的形狀脫鉤,之後怎麼插、怎麼黏貼都不影響既有的鍵。
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { toonMat, outlinify } from '/public/js/toon.js';
import { boneList, sanitizeDoll, pidOf, addKey, markSeed } from './doll.js';
import { makeShape, bevelGeo, mirrorGeo } from './shapes.js';
import { markTexture } from './mark.js';

/**
 * 逐零件/逐骨建索引(**MUST 在任何改動之前**跑)。
 * 回傳 { parts, bones, sockets, adds, matUse } 並寫進 unit.doll。
 *   parts   pid → Mesh(建構序路徑;不含描邊外殼與關節點標記)
 *   bones   骨架鍵 → 骨(同一顆物件掛在多個 rig 欄位時只留**第一個**鍵 —— 例如
 *           `tail`/`tailSegs.0` 是同一顆,兩個鍵各插一個編輯座就會疊成兩層偏移)
 *   matUse  材質 → 用它的 mesh 數(配色要不要改材質本體,依這個數字決定)
 */
export function indexUnit(unit) {
  const parts = new Map();
  const matUse = new Map();
  const walk = (o, path) => {
    o.children.forEach((c, i) => {
      if (c === unit.joints || c.userData.isOutline) return;
      const p = [...path, i];
      if (c.isMesh) {
        const pid = pidOf(p);
        c.userData.pid = pid;
        c.userData.dollBase = {
          p: c.position.clone(), r: c.rotation.clone(), s: c.scale.clone(),
          glow: c.material?.emissiveIntensity ?? 0,
        };
        parts.set(pid, c);
        for (const m of (Array.isArray(c.material) ? c.material : [c.material])) {
          if (m) matUse.set(m, (matUse.get(m) || 0) + 1);
        }
      }
      walk(c, p);
    });
  };
  walk(unit.group, []);

  const bones = new Map();
  const seen = new Set();
  for (const b of boneList(unit.rig)) {
    if (seen.has(b.obj)) continue;     // 同一顆骨的別名(tail ↔ tailSegs.0)只收第一個鍵
    seen.add(b.obj);
    bones.set(b.key, b.obj);
  }
  unit.doll = { parts, bones, matUse, sockets: new Map(), adds: new Map() };
  return unit.doll;
}

/** 插編輯座:骨的子節點整批搬進一個新 Group,Group 自己維持單位變換(⇒ 畫面逐位元不變) */
function socketOf(ix, key, bone) {
  let s = ix.sockets.get(key);
  if (s) return s;
  s = new THREE.Group();
  s.userData.dollSocket = key;
  for (const c of [...bone.children]) s.add(c);   // add() 會自動從舊父節點移除
  bone.add(s);
  ix.sockets.set(key, s);
  return s;
}

/**
 * 依需求補一個編輯座(編輯器選到某根骨時呼叫)。
 * 為什麼不在 `applyDoll` 裡一次把每根骨都插座:**沒有覆寫 = 逐位元同出廠**是這一族的底線,
 * 插一堆單位變換的 Group 雖然畫面不變,卻讓「這棵樹有沒有被改過」多一種答案。
 * 反過來,選到骨才補座 ⇒ 選取當下不必重鍛(重鍛會把步態歸零,選一根骨就重擺一次姿勢)。
 */
export function ensureSocket(ix, key) {
  const bone = ix?.bones.get(key);
  return bone ? socketOf(ix, key, bone) : null;
}

/** 骨長:沿骨軸(−y,segLimbF 的慣例)伸縮 —— 子骨只移位置,其餘子節點連幾何一起拉長 */
function applyBoneLen(sock, f, boneObjs) {
  if (f === 1) return;
  for (const c of sock.children) {
    c.position.y *= f;
    if (!boneObjs.has(c)) c.scale.y *= f;
  }
}

/** 換形狀:新幾何填滿原幾何的包圍盒(同一個中心 ⇒ 掛在肢體上的零件不會跳走) */
function applyShape(mesh, kind) {
  const g0 = mesh.geometry;
  g0.computeBoundingBox();
  const b = g0.boundingBox;
  const size = b.getSize(new THREE.Vector3());
  const ctr = b.getCenter(new THREE.Vector3());
  const geo = makeShape(kind, size);
  if (!geo) return;
  geo.translate(ctr.x, ctr.y, ctr.z);
  if (geo.userData.outlineGeo) geo.userData.outlineGeo.translate(ctr.x, ctr.y, ctr.z);
  swapGeo(mesh, geo);
}

/** 換掉一顆零件的幾何:舊的 dispose(A25)、描邊外殼跟著換(不換 = 看到的與描的不是同一顆)。
 *  `dropOld = false` 給黏貼件用 —— 複本與原件**共用**同一份幾何,在複本上 dispose
 *  等於把原件的幾何一起釋放掉(症狀:黏貼一次,被複製的那顆零件當場消失)。 */
function swapGeo(mesh, geo, dropOld = true) {
  const old = mesh.geometry;
  mesh.geometry = geo;
  mesh.userData.outlineGeo = geo.userData.outlineGeo || null;
  for (const c of mesh.children) {
    if (c.userData.isOutline) c.geometry = geo.userData.outlineGeo || geo;
  }
  if (dropOld && old !== geo) old.dispose();
}

/** 配色:材質被多顆零件共用時 MUST 換一份新的(否則改一顆連旁邊那一排一起變色)。
 *  重建走 toon.js 的 `toonMat` 真品入口 + 原材質記下的 celOpts,MUST NOT 用 material.clone()
 *  —— three 的 Material.copy 不搬 onBeforeCompile,賽璐璐補丁會整份掉光。 */
function applyColor(ix, mesh, color) {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!m) return;
  if ((ix.matUse.get(m) || 1) > 1) {
    const o = m.userData?.celOpts || {};
    const nm = toonMat(color, { celMetal: !!o.metal, rim: o.rim, bands: o.bands, soft: o.soft });
    nm.emissive.copy(m.emissive);
    nm.emissiveIntensity = m.emissiveIntensity;
    nm.transparent = m.transparent;
    nm.opacity = m.opacity;
    mesh.material = nm;
    ix.matUse.set(m, ix.matUse.get(m) - 1);
    ix.matUse.set(nm, 1);
  } else {
    m.color.setHex(color);
  }
}

/** 貼花(塗鴉/圖騰/烙印):投影到零件表面,幾何轉進**零件局部座標** ⇒ 隨動畫一起動 */
function applyMark(mesh, m, i) {
  const pos = new THREE.Vector3(...m.p);
  const nrm = new THREE.Vector3(...m.n).normalize();
  mesh.updateMatrixWorld(true);
  const wPos = pos.clone().applyMatrix4(mesh.matrixWorld);
  const wNrm = nrm.clone().transformDirection(mesh.matrixWorld).normalize();
  // 朝向:+Z 對準表面法線(DecalGeometry 沿投影器的 z 軸投影),再繞法線滾動 rot
  const dummy = new THREE.Object3D();
  dummy.position.copy(wPos);
  dummy.lookAt(wPos.clone().add(wNrm));
  dummy.rotateZ(m.rot || 0);
  // DecalGeometry 只吃非索引幾何 ⇒ 借一顆同世界變換的臨時 mesh(原零件一格不動)
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const tmp = new THREE.Mesh(src);
  tmp.matrixWorld.copy(mesh.matrixWorld);
  const depth = Math.max(0.08, m.size * 0.6);
  let geo;
  try {
    geo = new DecalGeometry(tmp, wPos, dummy.rotation, new THREE.Vector3(m.size, m.size, depth));
  } catch { geo = null; }
  if (src !== mesh.geometry) src.dispose();
  if (!geo || !geo.attributes.position?.count) { geo?.dispose(); return null; }
  geo.applyMatrix4(mesh.matrixWorld.clone().invert());   // 世界 → 零件局部
  const tex = markTexture({ ...m, seed: m.seed || markSeed(m.pid, i) });
  const mat = toonMat(0xffffff, { rim: 0 });
  mat.map = tex;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -4;
  const dm = new THREE.Mesh(geo, mat);
  dm.userData.noOutline = true;      // 貼花不掛反轉外殼(它是薄殼,描邊會整片變黑)
  dm.userData.dollMark = i;
  dm.renderOrder = 2;
  mesh.add(dm);
  return dm;
}

/** 黏貼件:複製一顆零件(或一根骨的整個子樹)掛到目標底下 */
function applyAdd(ix, unit, a, i) {
  const target = ix.sockets.get(a.to) || ix.bones.get(a.to) || ix.parts.get(a.to);
  const src = ix.parts.get(a.src) || ix.bones.get(a.src);
  if (!target || !src || src === target) return null;
  const g = src.clone(true);
  g.traverse((o) => {
    delete o.userData.pid;                       // 建構序路徑是原件的,複本 MUST NOT 帶著走
    delete o.userData.dollBase;
    if (!a.mirror) return;
    // 鏡射整棵子樹:逐節點翻 x 位置與 y/z 轉角,逐 mesh 翻幾何(繞序 + 法線)——
    // 只翻根節點的 scale.x 會把整棵樹的正面剔除掉(見 shapes.mirrorGeo 檔頭)
    if (o !== g) { o.position.x *= -1; o.rotation.y *= -1; o.rotation.z *= -1; }
    if (o.isMesh && !o.userData.isOutline) swapGeo(o, mirrorGeo(o.geometry), false);
  });
  g.position.set(...(a.p || [0, 0, 0]));
  g.rotation.set(...(a.r || [0, 0, 0]));
  g.scale.set(...(a.s || [1, 1, 1]));
  g.userData.dollAdd = i;
  target.add(g);
  ix.adds.set(addKey(i), g);
  return g;
}

/**
 * 套用一整份紙娃娃覆寫(**唯一縫**)。呼叫端傳的一律是「剛鍛造好的靜姿零件樹」——
 * 已經動過的樹再套一次會把偏移疊上去(pid 找到的是同一顆零件,但基準值已經不是出廠值)。
 * 回傳索引(編輯器要拿它做點選與拖曳)。
 */
export function applyDoll(unit, raw) {
  const ix = indexUnit(unit);
  const d = sanitizeDoll(raw);
  ix.doc = d;
  const boneObjs = new Set(ix.bones.values());

  // ① 骨架:角度 / 位置 / 骨長(全部寫編輯座,骨本身留給 locomotion)
  for (const [key, b] of Object.entries(d.bones)) {
    const bone = ix.bones.get(key);
    if (!bone) continue;
    const s = socketOf(ix, key, bone);
    if (b.p) s.position.set(...b.p);
    if (b.r) s.rotation.set(...b.r);
    if (b.len) applyBoneLen(s, b.len, boneObjs);
  }

  // ② 外觀零件:換形狀 → 邊緣 → 變換 → 配色/發光/隱藏
  // 換形狀 MUST 排在邊緣之前(鈍化吃的是**換完之後**那顆幾何,反過來就是磨了一顆等下被丟掉的)
  for (const [pid, q] of Object.entries(d.parts)) {
    const mesh = ix.parts.get(pid);
    if (!mesh) continue;
    if (q.shape) applyShape(mesh, q.shape);
    if (q.bevel) {
      const g = bevelGeo(mesh.geometry, q.bevel);
      if (g) swapGeo(mesh, g);
    }
    const base = mesh.userData.dollBase;
    if (q.p) mesh.position.set(base.p.x + q.p[0], base.p.y + q.p[1], base.p.z + q.p[2]);
    if (q.r) mesh.rotation.set(base.r.x + q.r[0], base.r.y + q.r[1], base.r.z + q.r[2]);
    if (q.s) mesh.scale.set(base.s.x * q.s[0], base.s.y * q.s[1], base.s.z * q.s[2]);
    if (q.color != null) applyColor(ix, mesh, q.color);
    if (q.glow != null && mesh.material?.emissiveIntensity != null) {
      mesh.material.emissiveIntensity = base.glow * q.glow;
    }
    if (q.hide) mesh.visible = false;
  }

  // ③ 黏貼件(排在零件變換之後:黏貼的是**現在這一顆**的樣子,含它剛換過的形狀)
  unit.group.updateMatrixWorld(true);
  d.adds.forEach((a, i) => applyAdd(ix, unit, a, i));

  // ④ 彩繪貼花(MUST 最後:投影吃的是零件**當下**的幾何與世界變換)
  unit.group.updateMatrixWorld(true);
  d.marks.forEach((m, i) => {
    const mesh = ix.parts.get(m.pid) || ix.adds.get(m.pid);
    if (mesh?.isMesh) applyMark(mesh, m, i);
  });
  return ix;
}

/** 黏貼件也要描邊(它是在 outlinify 之後才掛上去的);只補新掛的那一棵,避免整棵樹重描 */
export function outlineAdds(ix, width) {
  for (const g of ix.adds.values()) {
    let has = false;
    g.traverse((o) => { if (o.userData.isOutline) has = true; });
    if (!has) outlinify(g, width);
  }
}
