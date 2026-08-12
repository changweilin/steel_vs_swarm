// ============ 人形特徵 → 機器人零件鍛造(dev-only 原型;不進遊戲)============
// 研究來源:AniCompanion(three-vrm)的 VRM 人形角色技術 —— 「任何模型即插即用、動作可
// 重定向」建立在**所有角色共用同一組標準化人形特徵**(VRM 1.0 必要骨)之上。本原型把同一
// 思路移植到機體制:HUMANOID 特徵表(拓撲固定、比例逐機可調)+ 逐機「特徵 → 零件」轉換。
//
// 2026-08-12 使用者指示:每個機型要有獨特細節(關節/胸口/頭部/武器),參考原型資料
// (mecha.js 原型層 + gen 六欄)與 2D 定案圖(public/assets/cyberpunk_art/mechs/);
// 變形者的人形地面型態一併處理。名冊 = 遊戲真名冊的人形子集(8 台):
//   機甲 4:t01 bastion / t02 seraph / t10 aegis / t12 colossus
//   變形者人形地面型 4(data.js MORPH_HUMANOID):t06 monkey / t11 atlas / m01 vampire / m05 wolf
// 每台的關節「機構語彙」刻意互異(這正是獨特細節的骨幹):
//   t01 外露液壓缸+缸頭環 / t02 雙件式肌腱缸 / t10 全包覆+彈匣筒 / t12 疊板+節端軸環 /
//   t06 裸缸+亮桿芯 / t11 工業液壓+鉚釘 / m01 烤漆蓋板細縫 / m05 圓盤螺栓+外露腱桿。
//
// 單一真相縫:出廠規格 = 本檔 MECH_SPECS;使用者調整 = tools/humanoid_forge/specs.json
// **覆寫層**(只存差異;機體台 /api/forge 寫、兩座檢視台讀),合併只有 mergeSpec() 一份。
//
// 產物仍是本專案 rig 契約的具名 Group 零件樹(kind 'biped'),**刻意不用 SkinnedMesh**
// (docs/ai3d_runbook.md §0 定案)—— 真品 locomotion.js 一行不改直接驅動;
// 掌行(t06 knuckle)/ 趾行(m05 legBase+關節 base)/ 尾配重(tailSegs)全走既有 rig 旗標。
//
// ⚠ 正式整合前的已知欠帳(原型階段刻意容忍,入 public/js 前 MUST 收掉):
//   - segLimbF/bxF/cylF/matF/outlineWF 鏡射 models.js 未匯出內部函式
//     (models.js:5076/:122/:128/:112/:119)—— 正式整合應改 export 共用,MUST NOT 留兩份。
//   - MOVE_SIG/CAST_SIG 的值抄自 models.js:7544/:7587(未匯出)—— 同上。
//   - 槍口焰(attachMuzzleFlames)未掛;開火演出以 lightGlow / heavy.glow 閃光代替。

import * as THREE from 'three';
import { toonMat, outlinify } from '/public/js/toon.js';
import { heroPalette } from '/public/js/paint.js';

// ---- models.js 內部積木的鏡射(見檔頭欠帳說明)------------------------------
function matF(color, opts = {}) {
  const { metalness, roughness, ...rest } = opts;
  return toonMat(color, { ...rest, celMetal: (metalness ?? 0) >= 0.5 });
}
function bxF(parent, w, h, d, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matF(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cylF(parent, rt, rb, h, seg, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), matF(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function sphF(parent, r, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), matF(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const dimF = (c, f) => new THREE.Color(c).multiplyScalar(f);
const outlineWF = (target) => Math.min(0.45, Math.max(0.05, target * 0.016));
const IRON = 0x23262a, GUNMETAL = 0x1a1d20, COAL = 0x14171a, INK = 0x0d0f11;

/** 分節肢:鏡射 models.js segLimb(:5076)。符號慣例同源 —— 肢體幾何朝 −y,
 *  +x 旋轉 = 末端後移 ⇒ 膝後折為正、肘前折為負、踝取反號。 */
function segLimbF(parent, pos, segs, chain) {
  const root = new THREE.Group();
  root.position.set(pos[0], pos[1], pos[2]);
  parent.add(root);
  let cur = root;
  segs.forEach((s, i) => {
    if (i > 0) {
      const j = new THREE.Group();
      const pv = s.piv;
      j.position.set(pv ? pv[0] : 0, pv ? pv[1] : -segs[i - 1].len, pv ? pv[2] : 0);
      j.rotation.x = s.base || 0;
      cur.add(j);
      chain.push({ g: j, base: s.base || 0, k: s.k || 0, d: s.d || 0 });
      cur = j;
    }
    s.draw(cur);
  });
  return root;
}

// ---- 關節機構語彙(逐機互異的「字母」;每台只用自己那一套)---------------------
/** t01/t11/t06:外露液壓缸(單端錨、斜置、不跨樞軸)+ 缸頭關節環;core 給亮桿芯 */
function hydCyl(p, r, len, x, y, z, tiltX, core = null) {
  const c = cylF(p, r, r, len, 6, x, y, z, IRON, { metalness: 0.85 });
  c.rotation.x = tiltX;
  cylF(p, r * 1.5, r * 1.5, r * 1.2, 8, x, y + len * 0.55, z, 0x3a4048, { metalness: 0.8 });
  if (core) {
    const k = cylF(p, r * 0.55, r * 0.55, len * 0.5, 6, x, y - len * 0.45, z, core, { metalness: 0.9 });
    k.rotation.x = tiltX;
  }
  return c;
}
/** t02:雙件式肌腱缸(上段深色缸體 + 下段外露亮活塞桿)—— 生體 × 機構的縫合感 */
function sinew(p, h, x, y, z, lite) {
  cylF(p, 0.11, 0.11, h * 0.62, 8, x, y + h * 0.16, z, IRON, { metalness: 0.8 });
  cylF(p, 0.05, 0.05, h * 0.92, 6, x, y - h * 0.06, z, lite, { metalness: 0.9 });
}
/** t12:蜈蚣體節 —— 兩片圓角感的疊板(下片窄薄前移壓出疊層陰影)+ 節末外露軸環 */
function seg2(p, w, len, d, y, main, sub) {
  bxF(p, w, len, d, 0, y - len / 2, 0, main, { metalness: 0.55 });
  bxF(p, w * 0.9, len * 0.94, d * 0.92, 0, y - len / 2 - len * 0.03, 0.03, sub, { metalness: 0.55 });
  const ax = cylF(p, w * 0.32, w * 0.32, w * 0.28, 10, 0, y - len, 0, COAL, { metalness: 0.85 });
  ax.rotation.z = Math.PI / 2;
}

// ══════════ ① 標準化人形特徵表(對齊 VRM 1.0 必要骨)══════════
// 比例以身高 1.0 正規化;def = 預設值,逐機規格(spec.prop)只覆寫想改的格子,
// 使用者調整(specs.json)再覆寫一層 —— 三層合併只有 mergeSpec()/resolveProp() 一條路。
export const HUMANOID = {
  hips:      { vrm: 'hips',                        def: 0.52 },
  legSplay:  { vrm: 'leftUpperLeg/rightUpperLeg',  def: 0.085 },
  thigh:     { vrm: 'lowerLeg 樞軸(膝)',          def: 0.48 },
  shin:      { vrm: 'foot 樞軸(踝)',              def: 0.44 },
  shoulderY: { vrm: 'upperArm(肩線高)',           def: 0.80 },
  shoulderX: { vrm: 'leftUpperArm/rightUpperArm',  def: 0.16 },
  upperArm:  { vrm: 'lowerArm 樞軸(肘)',          def: 0.155 },
  foreArm:   { vrm: 'hand 樞軸(腕)',              def: 0.14 },
  head:      { vrm: 'head',                        def: 0.875 },
  girth:     { vrm: '(網格量體;VRM 交給模型)',    def: 1.0 },
};

export function resolveProp(spec) {
  const p = {};
  for (const k of Object.keys(HUMANOID)) p[k] = spec.prop?.[k] ?? HUMANOID[k].def;
  return p;
}

/** 覆寫層合併(唯一縫):base = MECH_SPECS 出廠值,ovr = specs.json 那一格。
 *  MUST 恆回**新物件**(含無覆寫時)—— 回傳 base 參照的話,機體台滑桿改的是出廠規格本體,
 *  「與出廠值比對」永遠相等 ⇒ 儲存永遠存成 null(2026-08-12 實測踩過)。 */
export function mergeSpec(base, ovr) {
  return {
    ...base,
    hue: ovr?.hue ?? base.hue,
    prop: { ...base.prop, ...(ovr?.prop || {}) },
    knobs: { ...(base.knobs || {}), ...(ovr?.knobs || {}) },
  };
}

// ══════════ ② 逐機「特徵 → 零件」細節(2026-08-12 依原型資料 + 2D 圖定案)══════════
// 每台一格:prop 比例(照 models.js builder 與圖面實測)、pose 關節靜姿、
// head/chest/pelvis/thigh/shin/foot/armUp/armFore 逐特徵 builder、
// mount(武裝掛法,回傳 rig 武器契約)、extra(尾/掌行等 rig 旗標)。
// ctx = { PAL, accent, G(粗細), H(全高), sx(左右號), K(旋鈕:barrelF/accentF)}。
const MECH_DETAIL = {
  // ── t01「莫洛茲」過裝甲重機甲(bastion):球肩吞頭、乘員蛋艙、斧砲+轉輪鼓 ──
  t01: {
    label: '莫洛茲(t01 重機甲)', hue: 0xd6e4ef,
    prop: { hips: 0.47, legSplay: 0.13, thigh: 0.45, shin: 0.42, shoulderY: 0.76, shoulderX: 0.24, upperArm: 0.147, foreArm: 0.2, head: 0.83, girth: 1.35 },
    gait: { strideF: 1.45, bob: 0.16, sway: 0.11, top: 7, armBase: 0.12 },
    moveSig: { poise: 0.86, idleF: 0.42, idleA: 1.9, launch: 0.1, spool: 0.95, brake: 0.1, settle: 2.2 },
    castSig: { omni: 'stomp', dir: 'swing' },
    doc: [['head', '沉肩小方頭+雙彎牛角+橫條眼'], ['chest', '桶胸+乘員蛋艙(分模線+潛望鏡)+反應爐'], ['hips', '戰車裙甲+ERA 反應塊+牽引鉤'], ['leg ×2', '重裝樁腿:外露液壓缸+膝後雙活塞+巨足'], ['arm ×2', '球形巨肩吞頭、細上臂→巨前臂反差'], ['hand L', 'Kord 重機槍(散熱套筒環+彈鏈箱)'], ['hand R', '152mm 斧砲(轉輪榴彈鼓+月牙斧刃)']],
    head(c, h) {
      const { PAL, accent, G } = c;
      bxF(h, 0.42 * G, 0.38, 0.46, 0, 0.05, 0, PAL.mid, { metalness: 0.6 });
      bxF(h, 0.34 * G, 0.1, 0.07, 0, 0.09, 0.25, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 橫條眼
      bxF(h, 0.52 * G, 0.16, 0.28, 0, 0.28, 0.02, PAL.main);                       // 頭頂護甲簷
      for (const sx of [-1, 1]) {                                                  // 雙彎牛角(2D 定案的骷髏面甲角)
        const horn = cylF(h, 0.045, 0.07, 0.5, 6, sx * 0.3 * G, 0.3, 0.06, 0xd8d4c8, { metalness: 0.6 });
        horn.rotation.z = sx * 0.85;
        const tip = cylF(h, 0.02, 0.045, 0.24, 6, sx * 0.52 * G, 0.52, 0.06, 0xd8d4c8, { metalness: 0.6 });
        tip.rotation.z = sx * 0.35;
      }
    },
    chest(c, ch, d) {
      const { PAL, accent, G } = c;
      const top = d.shoulderY, bot = d.waistY;
      bxF(ch, d.shoulderX * 1.5, top - bot + 0.4, 1.0 * G, 0, (top + bot) / 2 + 0.1, 0, PAL.main, { metalness: 0.6 });
      const egg = sphF(ch, 0.44, 0, (top + bot) / 2 + 0.05, 0.5 * G, PAL.main, { metalness: 0.6 });
      egg.scale.set(1.2, 1.05, 0.75);                                              // 乘員艙蛋形凸甲
      const seam = cylF(ch, 0.43, 0.43, 0.04, 14, 0, (top + bot) / 2 + 0.27, 0.5 * G, PAL.deep, { metalness: 0.7 });
      seam.scale.set(1.25, 1, 0.78);                                               // 艙蓋分模線
      bxF(ch, 0.1, 0.07, 0.12, 0, (top + bot) / 2 + 0.42, 0.62 * G, PAL.deep, { metalness: 0.6 });  // 車長周視鏡
      for (const sx of [-1, 1])
        bxF(ch, 0.09, 0.06, 0.1, sx * 0.15, (top + bot) / 2 + 0.38, 0.66 * G, PAL.deep, { metalness: 0.6 });  // 乘員潛望鏡對
      const ring = cylF(ch, 0.3, 0.3, 0.1, 14, 0, (top + bot) / 2 + 0.02, 0.78 * G, PAL.mid, { metalness: 0.7 });
      ring.rotation.x = Math.PI / 2;                                               // 反應爐環框
      const core = cylF(ch, 0.2, 0.2, 0.13, 14, 0, (top + bot) / 2 + 0.02, 0.82 * G, accent, { emissive: accent, emissiveIntensity: 1.5 });
      core.rotation.x = Math.PI / 2;
      bxF(ch, 0.95, 0.6, 0.4, 0, top + 0.02, -0.6 * G, PAL.mid);                   // 背部散熱堆
      for (let i = 0; i < 4; i++)
        bxF(ch, 0.15, 0.56, 0.08, -0.35 + i * 0.23, top + 0.02, -0.82 * G, c.dark, { metalness: 0.7 });  // 散熱柵
      for (const sx of [-1, 1]) {
        const ex = cylF(ch, 0.06, 0.06, 0.4, 8, sx * 0.42, top - 0.2, -0.72 * G, c.dark, { metalness: 0.7 });
        ex.rotation.x = 0.35;                                                      // 排氣管
        const ant = bxF(ch, 0.04, 0.6, 0.04, sx * 0.34, top + 0.55, -0.6 * G, IRON, { metalness: 0.8 });
        ant.rotation.z = sx * 0.18;                                                // 指揮天線
        bxF(ch, 0.09, 0.09, 0.09, sx * 0.43, top + 0.86, -0.6 * G, accent, { emissive: accent, emissiveIntensity: 1.2 });
        bxF(ch, 0.26, 0.32, 0.5, sx * d.shoulderX * 0.62, top + 0.08, 0.04, PAL.mid, { metalness: 0.6 });  // 護頸圍甲(填肩谷)
      }
    },
    pelvis(c, hips, d) {
      const { PAL, G } = c;
      bxF(hips, 0.9 * G, 0.42, 0.68 * G, 0, 0.04, 0, PAL.deep, { metalness: 0.6 });
      bxF(hips, 0.6 * G, 0.28, 0.1, 0, -0.06, 0.38 * G, PAL.mid);                  // 車首下裝甲
      bxF(hips, 0.13, 0.1, 0.08, 0, -0.2, 0.36 * G, PAL.deep, { metalness: 0.7 }); // 牽引鉤
      for (const sx of [-1, 1]) {
        const skirt = bxF(hips, 0.4, 0.56, 0.5 * G, sx * 0.58 * G, -0.12, 0, PAL.main);
        skirt.rotation.z = sx * 0.2;                                               // 大裙甲
        for (const oy of [-0.13, 0.13])
          bxF(skirt, 0.08, 0.2, 0.34, sx * 0.21, oy, 0, PAL.mid, { metalness: 0.6 });  // ERA 反應塊
      }
    },
    thigh(c, l, d) {
      const { PAL, G, sx } = c;
      const ball = cylF(l, 0.2 * G, 0.2 * G, 0.3, 8, 0, 0.02, 0, PAL.deep, { metalness: 0.7 });
      ball.rotation.z = Math.PI / 2;                                               // 髖球
      bxF(l, 0.55 * G, d.len * 1.02, 0.6 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });
      hydCyl(l, 0.055, d.len * 0.62, sx * 0.16 * G, -d.len * 0.48, 0.33 * G, 0.14);  // 大腿主液壓缸
      bxF(l, 0.2, 0.34, 0.16, sx * 0.32 * G, -d.len * 0.5, -0.14 * G, PAL.mid);    // 側推進莢
    },
    shin(c, l, d) {
      const { PAL, G } = c;
      bxF(l, 0.56 * G, 0.26, 0.62 * G, 0, -0.03, 0.05, PAL.mid);                   // 膝蓋大蓋甲
      for (const ox of [-0.13, 0.13])                                              // 膝後雙活塞桿
        cylF(l, 0.04, 0.04, d.len * 0.55, 6, ox, -d.len * 0.3, -0.3 * G, IRON, { metalness: 0.85 }).rotation.x = -0.18;
      bxF(l, 0.5 * G, d.len * 1.0, 0.55 * G, 0, -d.len * 0.5, -0.02, PAL.main, { metalness: 0.6 });
      bxF(l, 0.32 * G, 0.26, 0.14, 0, -d.len * 0.62, -0.32 * G, PAL.mid);          // 腿肚配重
    },
    foot(c, l, d) {
      const { PAL } = c;
      bxF(l, 0.5, 0.2, d.footL, 0, -d.clear * 0.5, d.footL * 0.15, PAL.deep);      // 巨足
      bxF(l, 0.52, 0.12, 0.24, 0, -d.clear * 0.4, d.footL * 0.58, PAL.mid);        // 腳尖甲
      bxF(l, 0.36, 0.14, 0.16, 0, -d.clear * 0.42, -d.footL * 0.34, PAL.mid);      // 腳跟配重
    },
    armUp(c, a, d) {
      const { PAL, accent, G, sx } = c;
      const pad = sphF(a, 0.42 * G, sx * 0.2, 0.14, 0, PAL.main, { metalness: 0.6 });
      pad.scale.set(1.0, 0.85, 1.05);                                              // 圓弧巨球肩
      bxF(a, 0.38 * G, 0.09, 0.5, sx * 0.2, 0.46, 0, dimF(accent, 0.85));          // 肩頂識別甲
      bxF(a, 0.32 * G, 0.18, 0.07, sx * 0.2, -0.14, 0.4 * G, PAL.mid, { metalness: 0.6 });  // 肩甲下垂護簷
      bxF(a, 0.22, d.len * 0.9, 0.26, 0, -d.len * 0.55, 0, PAL.deep);              // 細上臂軸
    },
    armFore(c, a, d) {
      const { PAL, G, sx } = c;
      bxF(a, 0.44 * G, d.len * 1.0, 0.5 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });  // 巨前臂(粗於上臂)
      bxF(a, 0.13, 0.44, 0.26, sx * 0.28 * G, -d.len * 0.5, -0.07, PAL.mid);       // 前臂外掛甲
      hydCyl(a, 0.04, d.len * 0.5, -sx * 0.13 * G, -d.len * 0.35, 0.28 * G, -0.3); // 前臂液壓缸
    },
    mount(c, F) {
      const { PAL, accent, G, K } = c;
      const REST = 1.36, AIM = { sh: -0.78, el: -0.52 }, AIMA = 1.57 - (AIM.sh + AIM.el);
      // 右手斧砲:轉輪榴彈鼓(鼓軸 MUST ∥ 砲軸)+ 粗短砲管 + 月牙斧刃
      bxF(F.handR, 0.32, 0.3, 0.34, 0, -0.12, 0.02, c.dark);
      const gr = new THREE.Group();
      gr.position.set(0.22, -0.2, 0.28);
      gr.rotation.set(REST, 0, 0.14);
      F.handR.add(gr);
      const BL = 1.7 * K.barrelF;
      bxF(gr, 0.4, 0.55, 0.4, 0, 0.1, 0, PAL.mid, { metalness: 0.7 });             // 後膛托
      bxF(gr, 0.14, 0.24, 0.2, 0, -0.2, -0.22, c.dark, { metalness: 0.7 });        // 握把
      cylF(gr, 0.3, 0.3, 0.36, 10, 0, 0.55, 0.08, PAL.main, { metalness: 0.65 });  // 轉輪榴彈鼓
      for (let i = 0; i < 6; i++) {
        const th = i / 6 * Math.PI * 2;
        cylF(gr, 0.05, 0.05, 0.38, 6, Math.cos(th) * 0.19, 0.55, 0.08 + Math.sin(th) * 0.19, COAL);  // 六膛室 ∥ 砲管
      }
      cylF(gr, 0.16, 0.19, BL, 10, 0, 0.8 + BL / 2, 0, GUNMETAL, { metalness: 0.82 });  // 152mm 粗短主管
      for (const t of [0.35, 0.7])
        cylF(gr, 0.22, 0.22, 0.09, 10, 0, 0.8 + BL * t, 0, PAL.mid, { metalness: 0.75 });  // 加強環
      for (const ox of [-0.2, 0.2])
        cylF(gr, 0.06, 0.06, BL * 0.5, 6, ox, 0.75 + BL * 0.35, -0.09, IRON, { metalness: 0.8 });  // 駐退復進雙筒
      cylF(gr, 0.23, 0.23, 0.3, 10, 0, 0.95 + BL, 0, INK, { metalness: 0.85 });    // 制退器
      const hMuz = cylF(gr, 0.2, 0.2, 0.11, 10, 0, 1.14 + BL, 0, accent, { emissive: accent, emissiveIntensity: 0.3 });
      const axe = new THREE.Group();                                               // 月牙大斧刃(側掛砲管前段)
      axe.position.set(0.22, 0.8 + BL * 0.55, 0.02);
      gr.add(axe);
      bxF(axe, 0.1, 1.3, 1.0, 0.2, 0, 0.22, PAL.mid, { metalness: 0.72 });         // 斧刃主面
      for (const oy of [-1, 1]) {
        const tip = bxF(axe, 0.09, 0.44, 0.7, 0.2, oy * 0.76, 0.06, PAL.mid, { metalness: 0.72 });
        tip.rotation.x = -oy * 0.5;                                                // 月牙收弧端板
      }
      bxF(axe, 0.06, 1.7, 0.4, 0.32, 0, 0.5, dimF(accent, 0.95));                  // 刃緣月牙亮線
      bxF(axe, 0.09, 0.6, 0.34, 0.18, 0, -0.36, c.dark, { metalness: 0.7 });       // 斧背反刃鉤
      // 左手 Kord 重機槍(輕武器):散熱套筒環 + 彈鏈箱
      bxF(F.handL, 0.3, 0.28, 0.32, 0, -0.12, 0.02, c.dark);
      const gl = new THREE.Group();
      gl.position.set(-0.22, -0.2, 0.28);
      gl.rotation.set(REST, 0, -0.14);
      F.handL.add(gl);
      const KL = 1.3 * K.barrelF;
      bxF(gl, 0.26, 0.44, 0.3, 0, 0.08, 0, PAL.mid, { metalness: 0.7 });           // 機匣
      bxF(gl, 0.12, 0.22, 0.18, 0, -0.18, -0.2, c.dark, { metalness: 0.7 });       // 握把
      cylF(gl, 0.09, 0.09, KL, 8, 0, 0.3 + KL / 2, 0, GUNMETAL, { metalness: 0.82 });  // 槍管
      for (const t of [0.25, 0.45, 0.65, 0.85])
        cylF(gl, 0.12, 0.12, 0.07, 8, 0, 0.3 + KL * t, 0, IRON, { metalness: 0.78 });   // 散熱套筒環(Kord 識別)
      bxF(gl, 0.24, 0.26, 0.05, 0, 0.36 + KL, 0, INK, { metalness: 0.85 });        // 橫翼平板制退器
      const lMuz = cylF(gl, 0.07, 0.07, 0.08, 8, 0, 0.42 + KL, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });
      bxF(gl, 0.28, 0.36, 0.24, -0.24, 0.14, 0.02, PAL.main, { metalness: 0.6 });  // 彈鏈箱(外側掛)
      bxF(gl, 0.24, 0.07, 0.2, -0.24, 0.36, 0.02, dimF(accent, 0.8));              // 彈箱蓋識別
      bxF(gl, 0.06, 0.36, 0.09, 0, 0.26, -0.24, IRON, { metalness: 0.7 });         // 提把
      return {
        gunR: { g: gr, rest: REST, aim: AIMA }, gunL: { g: gl, rest: REST, aim: AIMA },
        muzzles: { light: { n: lMuz, r: 0.07 }, heavy: { n: hMuz, r: 0.2 } },
        lightGlowM: [lMuz], heavyGlowM: [hMuz], heavyPivot: [],
        weap: { light: 'L', heavy: 'R' },
        hvy: { armR: 0.22, armL: 0.1, chest: 0.07, gun: 0.06 },
        aimPose: { rShoulderX: AIM.sh, rElbowX: AIM.el, lShoulderX: AIM.sh, lShoulderY: 0, lElbowX: AIM.el },
        wpn: { light: { nodes: [gl], ref: gl, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gr], ref: gr, muz: hMuz, fwd: 'y' } },
      };
    },
  },

  // ── t02「加拉泰亞-7」神經同步機(seraph):倒三角胸、肌腱缸、單角單眼、雙手長狙 ──
  t02: {
    label: '加拉泰亞-7(t02 神經同步機)', hue: 0xff9ec4,
    prop: { hips: 0.56, legSplay: 0.055, thigh: 0.5, shin: 0.47, shoulderY: 0.86, shoulderX: 0.21, upperArm: 0.175, foreArm: 0.16, head: 0.94, girth: 0.82 },
    gait: { strideF: 1.5, bob: 0.1, sway: 0.07, top: 8, armBase: 0.05 },
    moveSig: { poise: 0.08, idleF: 2.45, idleA: 0.95, launch: 0.93, spool: 0.05, brake: 0.95, settle: 0.38 },
    castSig: { omni: 'spin', dir: 'jab' },
    doc: [['head', '單角單眼小頭+楔形顎+臍帶纜插座'], ['chest', '倒三角上胸(底邊=肩線)+肩上 binder 莢'], ['hips', '裸細骨盆+外露脊柱肌腱'], ['leg ×2', '細長腿:肌腱缸+尖膝甲+脛前亮刃'], ['arm ×2', '加長細臂(雙手托長狙用)'], ['hand L', '前握把扶托(同一把狙的護木)'], ['hand R', '同步狙擊砲+下掛高斯衝鋒模組+刺槍']],
    head(c, h) {
      const { PAL, accent, G } = c;
      bxF(h, 0.34 * G, 0.3, 0.4, 0, 0.05, 0, PAL.mid, { metalness: 0.7 });
      const eye = sphF(h, 0.09, 0, 0.08, 0.2, accent, { emissive: accent, emissiveIntensity: 2.0 });  // 單圓獨眼
      eye.scale.set(1, 1, 0.6);
      bxF(h, 0.26, 0.05, 0.08, 0, 0.19, 0.2, PAL.deep);                            // 壓眉稜
      const jaw = bxF(h, 0.18, 0.12, 0.3, 0, -0.1, 0.16, PAL.main, { metalness: 0.7 });
      jaw.rotation.x = 0.12;                                                       // 楔形顎
      const horn = cylF(h, 0.012, 0.055, 0.72, 5, 0, 0.6, 0.1, 0xe8d9a0, { metalness: 0.8 });
      horn.rotation.x = -0.25;                                                     // 額頂前傾單角
      bxF(h, 0.2, 0.05, 0.05, 0, 0.02, -0.22, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 後腦識別條
    },
    chest(c, ch, d) {
      const { PAL, accent, G } = c;
      const top = d.shoulderY, bot = d.waistY;
      const w = d.shoulderX * 1.05;
      const tri = new THREE.Shape();
      tri.moveTo(-w, top + 0.12);
      tri.lineTo(w, top + 0.12);                                                   // 底邊 = 肩線
      tri.lineTo(0.13, bot);
      tri.lineTo(-0.13, bot);
      const pec = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.55 * G, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 }), matF(PAL.main, { metalness: 0.7 }));
      pec.position.z = -0.28 * G;
      ch.add(pec);
      bxF(ch, 0.3, top - 0.1, 0.5, 0, (top + 0.1) / 2, 0, PAL.deep, { metalness: 0.7 });  // 窄腰心柱(下延補到骨盆)
      for (const sx of [-1, 1])
        bxF(ch, 0.05, (top - bot) * 0.6, 0.4, sx * 0.19, (top + bot) / 2, 0.02, PAL.mid);  // 窄腰側肋
      sinew(ch, 0.7, 0, bot + 0.2, -0.3, PAL.lite);                                // 外露脊柱肌腱(背)
      sinew(ch, 0.55, 0, bot - 0.25, 0.12, PAL.lite);                              // 腰腹前肌束(2D 定案的裸腰段)
      bxF(ch, w * 2, 0.07, 0.05, 0, top + 0.1, 0.28 * G, dimF(accent, 0.8));       // 肩線識別稜
      cylF(ch, 0.24, 0.24, 0.04, 12, 0, top - 0.55, 0.3 * G, PAL.deep, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      bxF(ch, 0.3, 0.3, 0.16, 0, top - 0.55, 0.32 * G, accent, { emissive: accent, emissiveIntensity: 1.3 });  // 方形核心
      for (const sx of [-1, 1]) {                                                  // 肩上 binder 莢(蓄力展翼)
        const piv = new THREE.Group();
        piv.position.set(sx * (w + 0.02), top + 0.3, -0.03);
        ch.add(piv);
        bxF(piv, 0.2, 1.0, 0.6, 0, 0.12, 0, PAL.main, { metalness: 0.7 });
        bxF(piv, 0.22, 0.11, 0.62, 0, 0.54, 0, dimF(accent, 0.85), { emissive: accent, emissiveIntensity: 0.9 });  // 莢頂識別條
        bxF(piv, 0.04, 0.7, 0.46, sx * 0.13, 0.07, 0, PAL.mid);                    // 外側凹槽板
        bxF(piv, 0.22, 0.2, 0.62, 0, -0.4, 0, PAL.deep);                           // 底部收束楔
        c.binderPivots.push({ obj: piv, rest: { x: 0, y: 0, z: 0 }, deploy: { x: 0, y: sx * 0.5, z: 0 } });
      }
      bxF(ch, 0.45, 0.4, 0.34, 0, top - 0.05, -0.4 * G, PAL.mid);                  // 背部連接埠
      const sok = cylF(ch, 0.11, 0.11, 0.12, 10, 0, top - 0.05, -0.6 * G, COAL, { metalness: 0.85 });
      sok.rotation.x = Math.PI / 2;                                                // 臍帶纜圓插座
      const rg = cylF(ch, 0.15, 0.15, 0.04, 10, 0, top - 0.05, -0.57 * G, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.5 });
      rg.rotation.x = Math.PI / 2;
      for (const yy of [0.5, 0.28, 0.06])
        cylF(ch, 0.06, 0.06, 0.09, 8, 0, bot + yy, -0.34 * G, PAL.deep, { metalness: 0.8 }).rotation.x = Math.PI / 2;  // 脊椎神經插栓列
    },
    pelvis(c, hips) {
      const { PAL, G } = c;
      bxF(hips, 0.55 * G, 0.28, 0.42 * G, 0, 0.0, 0, PAL.deep, { metalness: 0.7 });  // 裸細骨盆(無裙甲)
    },
    thigh(c, l, d) {
      const { PAL, G } = c;
      sinew(l, d.len * 0.9, 0, -d.len * 0.46, 0.12 * G, PAL.lite);                 // 外露肌腱缸
      bxF(l, 0.25 * G, d.len * 1.02, 0.3 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.7 });
      bxF(l, 0.1, d.len * 0.66, 0.11, c.sx * 0.16 * G, -d.len * 0.52, -0.05, PAL.mid);  // 側肋條
    },
    shin(c, l, d) {
      const { PAL, accent, G } = c;
      bxF(l, 0.29 * G, 0.2, 0.34 * G, 0, -0.01, 0.09, dimF(accent, 0.7));          // 尖膝甲
      sinew(l, d.len * 0.85, 0, -d.len * 0.48, -0.03, PAL.lite);
      bxF(l, 0.21 * G, d.len * 1.0, 0.25 * G, 0, -d.len * 0.5, 0.01, PAL.main, { metalness: 0.7 });
      bxF(l, 0.07, d.len * 0.62, 0.05, 0, -d.len * 0.5, 0.16 * G, PAL.lite, { metalness: 0.9 });  // 脛前亮刃
      bxF(l, 0.11, d.len * 0.48, 0.2, c.sx * 0.14 * G, -d.len * 0.66, -0.11, PAL.mid);  // 腿肚推進鰭
    },
    foot(c, l, d) {
      const { PAL, accent } = c;
      bxF(l, 0.24, 0.15, d.footL, 0, -d.clear * 0.55, d.footL * 0.2, PAL.deep);    // 窄長足
      bxF(l, 0.25, 0.09, 0.18, 0, -d.clear * 0.45, d.footL * 0.62, dimF(accent, 0.6));
    },
    armUp(c, a, d) {
      const { PAL, G } = c;
      bxF(a, 0.34 * G, 0.34, 0.38 * G, 0, 0.08, 0, PAL.mid, { metalness: 0.7 });   // 窄肩座(莢艙立肩上,不包肩)
      sinew(a, d.len * 0.9, 0, -d.len * 0.46, 0, PAL.lite);
      bxF(a, 0.19 * G, d.len * 1.0, 0.22 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.7 });
    },
    armFore(c, a, d) {
      const { PAL, G } = c;
      bxF(a, 0.21 * G, 0.16, 0.24 * G, 0, -0.01, 0, PAL.deep);                     // 肘小方塊
      sinew(a, d.len * 0.85, 0, -d.len * 0.46, 0, PAL.lite);
      bxF(a, 0.17 * G, d.len * 1.0, 0.19 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.7 });
      bxF(a, 0.22 * G, 0.14, 0.26 * G, 0, -d.len * 0.98, 0.02, PAL.mid, { metalness: 0.7 });  // 腕部收束護腕
    },
    mount(c, F) {
      const { PAL, accent, K, H } = c;
      // 雙手托同一把長狙:主砲 + 下掛高斯衝鋒模組 + 前端刺槍 —— 掛右手,左手扶護木
      const REST = 1.3, AIM = { shR: -0.85, elR: -0.45, shL: -0.85, elL: -0.45 }, AIMA = 1.57 - (AIM.shR + AIM.elR);
      bxF(F.handR, 0.2, 0.22, 0.26, 0, -0.1, 0.02, c.dark);
      bxF(F.handL, 0.2, 0.22, 0.26, 0, -0.1, 0.02, c.dark);
      const gr = new THREE.Group();
      gr.position.set(0.16, -0.18, 0.24);
      gr.rotation.set(REST, 0, 0.1);
      F.handR.add(gr);
      const BL = 0.62 * H * K.barrelF;                                             // 比機體略高的反器材長狙
      bxF(gr, 0.2, 0.66, 0.3, 0, 0.05, 0, PAL.mid, { metalness: 0.75 });           // 機匣(長)
      bxF(gr, 0.1, 0.2, 0.16, 0, -0.2, -0.2, c.dark, { metalness: 0.7 });          // 握把
      bxF(gr, 0.16, 0.5, 0.12, 0, -0.32, -0.02, PAL.main, { metalness: 0.7 });     // 托肩尾托
      cylF(gr, 0.07, 0.09, BL, 8, 0, 0.5 + BL / 2, 0, GUNMETAL, { metalness: 0.85 });  // 主砲管
      bxF(gr, 0.05, BL * 0.8, 0.1, 0, 0.55 + BL * 0.4, 0.1, PAL.main, { metalness: 0.75 });  // 上導軌肋
      const lco = cylF(gr, 0.1, 0.1, BL * 0.36, 8, 0, 0.5 + BL * 0.25, 0, PAL.deep, { metalness: 0.8 });  // 軌道加速段
      lco.scale.set(1, 1, 1.25);
      const core = cylF(gr, 0.045, 0.045, BL * 0.5, 6, 0, 0.5 + BL * 0.3, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 軌間電漿(蓄力發光)
      const hMuz = cylF(gr, 0.075, 0.075, 0.1, 8, 0, 0.56 + BL, 0, accent, { emissive: accent, emissiveIntensity: 0.4 });  // 主砲膛口
      const spike = cylF(gr, 0.012, 0.05, 0.5, 5, 0, 0.85 + BL, 0.07, 0xe8d9a0, { metalness: 0.85 });  // 前端刺槍
      spike.rotation.x = 0.02;
      // 下掛高斯衝鋒模組(輕武器):3 節短線圈 + 細副槍管
      for (const t of [0.1, 0.2, 0.3])
        cylF(gr, 0.06, 0.06, 0.07, 8, 0, 0.5 + BL * t, -0.13, IRON, { metalness: 0.8 });
      cylF(gr, 0.03, 0.03, BL * 0.42, 6, 0, 0.5 + BL * 0.32, -0.13, GUNMETAL, { metalness: 0.85 });
      const lMuz = cylF(gr, 0.04, 0.04, 0.06, 8, 0, 0.5 + BL * 0.54, -0.13, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 副槍口
      return {
        gunR: { g: gr, rest: REST, aim: AIMA }, gunL: null,
        muzzles: { light: { n: lMuz, r: 0.04 }, heavy: { n: hMuz, r: 0.08 } },
        lightGlowM: [lMuz], heavyGlowM: [hMuz, core], heavyPivot: c.binderPivots,
        weap: { light: 'R', heavy: 'R' },
        hvy: { armR: 0.18, armL: 0.12, chest: 0.06, gun: 0.05 },
        aimPose: { rShoulderX: AIM.shR, rElbowX: AIM.elR, lShoulderX: AIM.shL, lShoulderY: 0.35, lElbowX: AIM.elL },
        wpn: { light: { nodes: [gr], ref: gr, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gr], ref: gr, muz: hMuz, fwd: 'y' } },
      };
    },
  },

  // ── t10「軌跡」攔截機甲(aegis):塔盾+腕砲+雙肩 VLS+雙雷達,關節語彙 =「藏」──
  t10: {
    label: '軌跡(t10 攔截機甲)', hue: 0x7fe8c9,
    prop: { hips: 0.52, legSplay: 0.1, thigh: 0.48, shin: 0.46, shoulderY: 0.85, shoulderX: 0.18, upperArm: 0.14, foreArm: 0.16, head: 0.93, girth: 1.1 },
    gait: { strideF: 1.4, bob: 0.12, sway: 0.09, top: 7.5, armBase: 0.1 },
    moveSig: { poise: 0.58, idleF: 0.82, idleA: 1.05, launch: 0.2, spool: 0.58, brake: 0.52, settle: 1.05 },
    castSig: { omni: 'stomp', dir: 'jab' },
    doc: [['head', '小方盔+遮光簷+雙感測窗+側耳雷達盤'], ['chest', '方正胸廓+斜仰相控陣+背部追蹤雷達盤'], ['hips', 'V 形前裙甲、側面留給塔盾'], ['leg ×2', '樁腿:脛前護脛+小腿攔截彈匣筒'], ['arm ×2', '不對稱:左盾掛架/右砲前臂,關節全藏'], ['hand L', '方形塔盾(接地齒+十字肋+觀察窗)'], ['hand R', '30mm 雙聯速射砲(多孔制退+供彈箱)+ 肩 VLS×12']],
    head(c, h) {
      const { PAL, accent, G } = c;
      bxF(h, 0.38 * G, 0.32, 0.4, 0, 0.05, 0, PAL.mid, { metalness: 0.6 });
      bxF(h, 0.34 * G, 0.045, 0.16, 0, 0.2, 0.16, PAL.main);                       // 前額遮光簷(零增高)
      bxF(h, 0.3 * G, 0.16, 0.06, 0, 0.03, 0.21, PAL.deep);                        // 梯形面甲
      bxF(h, 0.05, 0.14, 0.05, 0, 0.03, 0.24, PAL.mid);                            // T 形鼻樑肋
      for (const sx of [-1, 1]) {
        bxF(h, 0.07, 0.06, 0.04, sx * 0.1 * G, 0.06, 0.24, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 雙感測窗
        const ear = cylF(h, 0.1, 0.1, 0.045, 10, sx * 0.21 * G, 0.05, 0, dimF(accent, 0.6), { emissive: accent, emissiveIntensity: 0.4 });
        ear.rotation.z = Math.PI / 2;                                              // 側耳圓盤雷達
      }
    },
    chest(c, ch, d) {
      const { PAL, accent, G } = c;
      const top = d.shoulderY, bot = d.waistY;
      bxF(ch, d.shoulderX * 1.5, top - bot + 0.3, 0.85 * G, 0, (top + bot) / 2 + 0.1, 0, PAL.main, { metalness: 0.6 });
      bxF(ch, 0.4, 0.3, 0.06, 0, (top + bot) / 2 + 0.05, 0.44 * G, accent, { emissive: accent, emissiveIntensity: 1.1 });  // 胸口發光方板
      const arr = bxF(ch, 0.66, 0.4, 0.07, 0, top - 0.1, 0.42 * G, PAL.deep, { metalness: 0.7 });
      arr.rotation.x = -0.35;                                                      // 斜仰相控陣搜索雷達
      for (let i = 0; i < 6; i++)
        bxF(arr, 0.07, 0.07, 0.02, -0.2 + (i % 3) * 0.2, i < 3 ? 0.09 : -0.09, 0.045, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 收發單元
      const trk = cylF(ch, 0.24, 0.24, 0.08, 12, 0, top - 0.15, -0.5 * G, PAL.deep, { metalness: 0.7 });
      trk.rotation.x = 1.05;                                                       // 背部追蹤雷達盤
      const face = bxF(ch, 0.3, 0.22, 0.02, 0, top - 0.06, -0.58 * G, accent, { emissive: accent, emissiveIntensity: 0.5 });
      face.rotation.x = 1.05;
      for (const sx of [-1, 1]) {
        bxF(ch, 0.06, 0.06, 0.03, sx * 0.45, (top + bot) / 2 + 0.15, 0.44 * G, accent, { emissive: accent, emissiveIntensity: 0.8 });  // IFF 識別燈
        // 雙肩 VLS 2×3 發射箱(重武器):管口朝天、高過頭頂
        const box = bxF(ch, 0.48, 0.44, 0.58, sx * (d.shoulderX * 0.72), top + 0.32, -0.08, PAL.mid, { metalness: 0.6 });
        for (let i = 0; i < 6; i++) {
          const cx = (i % 2 === 0 ? -0.11 : 0.11), cz = (Math.floor(i / 2) - 1) * 0.17;
          cylF(box, 0.07, 0.07, 0.1, 8, cx, 0.22, cz, COAL, { metalness: 0.8 });
          const port = cylF(box, 0.055, 0.055, 0.05, 8, cx, 0.28, cz, accent, { emissive: accent, emissiveIntensity: 1.0 });
          c.vlsPorts.push(port);
        }
        for (const oz of [-0.14, 0.14])
          cylF(box, 0.055, 0.055, 0.4, 8, sx * 0.3, -0.02, oz, GUNMETAL, { metalness: 0.8 }).rotation.x = 0.06;  // 再裝填彈筒
      }
    },
    pelvis(c, hips, d) {
      const { PAL, G } = c;
      bxF(hips, 0.75 * G, 0.4, 0.6 * G, 0, 0.02, 0, PAL.deep, { metalness: 0.6 });
      const ap = bxF(hips, 0.48 * G, 0.4, 0.13, 0, -0.14, 0.32 * G, PAL.main);
      ap.rotation.x = 0.16;                                                        // V 形前裙甲
    },
    thigh(c, l, d) {
      const { PAL, G } = c;
      const ball = cylF(l, 0.17 * G, 0.17 * G, 0.26, 8, 0, 0.02, 0, PAL.deep, { metalness: 0.75 });
      ball.rotation.z = Math.PI / 2;                                               // 唯一外露的髖球關節
      bxF(l, 0.4 * G, d.len * 1.02, 0.44 * G, 0, -d.len * 0.5, 0, PAL.main, { metalness: 0.6 });
      bxF(l, 0.17, d.len * 0.55, 0.36, c.sx * 0.24 * G, -d.len * 0.5, 0, PAL.mid); // 大腿側裝甲板
    },
    shin(c, l, d) {
      const { PAL, G, sx } = c;
      const bolt = cylF(l, 0.11, 0.11, 0.06, 10, sx * 0.21 * G, -0.02, 0, COAL, { metalness: 0.85 });
      bolt.rotation.z = Math.PI / 2;                                               // 膝側圓形樞軸螺栓
      bxF(l, 0.42 * G, 0.24, 0.1, 0, -0.05, 0.22 * G, PAL.mid);                    // 膝前大蓋甲
      bxF(l, 0.36 * G, d.len * 1.0, 0.42 * G, 0, -d.len * 0.5, -0.01, PAL.main, { metalness: 0.6 });
      bxF(l, 0.3 * G, d.len * 0.62, 0.05, 0, -d.len * 0.5, 0.22 * G, PAL.mid);     // 脛前護脛(盾線步兵)
      for (const oy of [-0.35, -0.62])
        cylF(l, 0.05, 0.05, 0.3, 8, sx * 0.22 * G, d.len * oy, -0.1, COAL, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 攔截彈匣圓筒
    },
    foot(c, l, d) {
      const { PAL } = c;
      bxF(l, 0.42, 0.19, d.footL, 0, -d.clear * 0.5, d.footL * 0.12, PAL.deep);    // 穩定大腳
      bxF(l, 0.45, 0.1, 0.2, 0, -d.clear * 0.42, d.footL * 0.55, PAL.mid);
    },
    armUp(c, a, d) {
      const { PAL, accent, G, sx } = c;
      bxF(a, 0.42 * G, 0.34, 0.46 * G, 0, 0.08, 0, PAL.main, { metalness: 0.6 }); // 方肩甲(肩球藏在裡面)
      if (sx < 0) {                                                                // 持盾側肩側裙甲(不對稱)
        const sk = bxF(a, 0.14, 0.5, 0.5, sx * 0.3 * G, -0.1, 0, PAL.mid);
        sk.rotation.z = sx * 0.12;
        bxF(sk, 0.05, 0.5, 0.06, sx * 0.05, 0, 0.24, dimF(accent, 0.8));
      }
      bxF(a, 0.24, d.len * 0.95, 0.26, 0, -d.len * 0.52, 0, PAL.deep);
    },
    armFore(c, a, d) {
      const { PAL, G } = c;
      for (const t of [0.15, 0.32, 0.49])                                          // 波紋管疊環(2D 的肘腕之間)
        cylF(a, 0.13 - 0.012 * (t * 6), 0.13 - 0.012 * (t * 6), 0.09, 10, 0, -d.len * t, 0, IRON, { metalness: 0.7 });
      bxF(a, 0.3 * G, d.len * 0.62, 0.34 * G, 0, -d.len * 0.72, 0.01, PAL.main, { metalness: 0.6 });
    },
    mount(c, F) {
      const { PAL, accent, G, K, H } = c;
      // 左前臂塔盾(高 ≈ 全高六成):接地齒 + 外翻簷 + 十字肋 + 觀察窗 + 防撞塊
      const SH = 0.58 * H, SW = 0.38 * H;
      const sh = new THREE.Group();
      sh.position.set(-0.2 * G, -0.35, 0.2);
      sh.rotation.z = -0.06;
      F.foreL.add(sh);
      bxF(sh, 0.14, SH, SW, 0, -SH * 0.18, 0, PAL.main, { metalness: 0.6 });       // 盾面
      bxF(sh, 0.16, SH * 0.3, SW * 0.86, 0, SH * 0.24, 0, PAL.mid, { metalness: 0.6 });  // 附加裝甲層
      bxF(sh, 0.18, 0.1, SW * 1.06, 0, SH * 0.34, 0, PAL.mid);                     // 頂緣外翻簷
      for (const oz of [-SW * 0.32, SW * 0.32])
        bxF(sh, 0.16, 0.22, 0.1, 0, -SH * 0.72, oz, COAL, { metalness: 0.8 });     // 盾底接地齒
      bxF(sh, 0.04, SH * 0.9, 0.09, -0.09, -SH * 0.18, 0, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.8 });  // 十字肋(縱)
      bxF(sh, 0.04, 0.09, SW * 0.8, -0.09, -SH * 0.1, 0, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.8 });   // 十字肋(橫)
      bxF(sh, 0.05, 0.05, SW * 0.3, -0.08, SH * 0.22, SW * 0.24, COAL);            // 觀察窗縫
      for (const oy of [-1, 1]) for (const oz of [-1, 1])
        bxF(sh, 0.16, 0.12, 0.12, 0, oy * SH * 0.44, oz * SW * 0.46, PAL.deep);    // 四角防撞塊
      // 右前臂 30mm 速射砲(輕武器):雙聯管 + 圓護筒 + 多孔制退 + 供彈箱。
      // 砲管沿 gg-local +y ⇒ gunPitch 的 aim MUST = 1.57 − 臂鏈總俯仰(−0.5 −0.35)= 2.42
      const gg = new THREE.Group();
      gg.position.set(0.1 * G, -0.5, 0.16);
      gg.rotation.x = 1.45;
      F.foreR.add(gg);
      const BL = 1.35 * K.barrelF;
      cylF(gg, 0.15, 0.15, 0.5, 10, 0, 0.15, 0, PAL.deep, { metalness: 0.75 });    // 根部圓護筒
      for (const ox of [-0.07, 0.07])
        cylF(gg, 0.045, 0.045, BL, 8, ox, 0.3 + BL / 2, 0, GUNMETAL, { metalness: 0.85 });  // 雙聯砲管
      bxF(gg, 0.3, 0.14, 0.2, 0, 0.4 + BL, 0, INK, { metalness: 0.85 });           // 平板多孔制退器
      for (const ox of [-0.08, 0, 0.08])
        cylF(gg, 0.025, 0.025, 0.03, 6, ox, 0.4 + BL, 0.1, COAL);                  // 制退孔面
      const lMuz = bxF(gg, 0.2, 0.06, 0.06, 0, 0.48 + BL, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });  // 砲口燈
      bxF(gg, 0.22, 0.26, 0.3, 0, -0.12, -0.16, PAL.mid, { metalness: 0.6 });      // 供彈箱
      bxF(gg, 0.06, 0.5, 0.08, 0.1, 0.2, -0.12, PAL.deep);                         // 供彈滑槽
      const hMuz = c.vlsPorts[2];                                                  // 重武器槍口錨 = VLS 其中一管
      return {
        gunR: { g: gg, rest: 1.45, aim: 2.42 }, gunL: null,
        muzzles: { light: { n: lMuz, r: 0.09 }, heavy: { n: hMuz, r: 0.06 } },
        lightGlowM: [lMuz], heavyGlowM: c.vlsPorts, heavyPivot: [],
        weap: { light: 'R', heavy: 'N' },
        hvy: { chest: 0.05, gun: 0.04 },
        aimPose: { rShoulderX: -0.5, rElbowX: -0.35 },                             // 只舉砲臂;左臂守盾交還步態
        wpn: { light: { nodes: [gg], ref: gg, muz: lMuz, fwd: 'y' }, heavy: { nodes: [sh], ref: sh, muz: hMuz, fwd: 'z' } },
      };
    },
  },

  // ── t12「巨兵」訊號掃描機(colossus):圓角大頭雙圓眼、蜈蚣疊板節、眉心砲、天線叢 ──
  t12: {
    label: '巨兵(t12 訊號掃描機)', hue: 0xb8ffb0,
    prop: { hips: 0.44, legSplay: 0.1, thigh: 0.41, shin: 0.37, shoulderY: 0.82, shoulderX: 0.22, upperArm: 0.16, foreArm: 0.19, head: 0.95, girth: 1.25 },
    gait: { strideF: 1.55, bob: 0.13, sway: 0.1, top: 8, armBase: 0.08 },
    moveSig: { poise: 0.2, idleF: 0.7, idleA: 0.85, launch: 0.15, spool: 0.4, brake: 0.3, settle: 1.4 },
    castSig: { omni: 'dance', dir: 'jab' },
    doc: [['head', '圓角大頭:雙圓眼+眉心砲口+耳盤+天線叢'], ['chest', '雙層圓角胸甲+橫置腹節+三光點紋章+訊號艙'], ['hips', '橫置膠囊骨盆+半埋髖軸環(無裙甲)'], ['leg ×2', '蜈蚣疊板四段腿+圓膠鞋足三趾板'], ['arm ×2', '半球圓肩+疊板長臂(垂手過膝)+三指'], ['hand L', 'RF 測向環(靜態微光,不進戰鬥 glow)'], ['hand R', '掃描脈衝槍;重武器=眉心標定砲(機載)']],
    head(c, h) {
      const { PAL, accent, G } = c;
      const skull = bxF(h, 0.55 * G, 0.72, 0.5, 0, 0.16, 0, PAL.main, { metalness: 0.55 });
      skull.rotation.x = 0.06;                                                     // 圓角矩形大頭殼(前傾)
      bxF(h, 0.5 * G, 0.6, 0.46, 0, 0.16, 0.05, PAL.mid, { metalness: 0.55 });     // 第二層殼板
      cylF(h, 0.13, 0.16, 0.16, 10, 0, -0.24, 0, PAL.deep, { metalness: 0.7 });    // 細頸柱(上細下粗)
      const brow = cylF(h, 0.05, 0.05, 0.06, 8, 0, 0.42, 0.26, accent, { emissive: accent, emissiveIntensity: 1.4 });
      brow.rotation.x = Math.PI / 2;                                               // 眉心標定砲口
      c.browCannon = brow;
      for (const sx of [-1, 1]) {
        sphF(h, 0.11, sx * 0.14 * G, 0.24, 0.24, accent, { emissive: accent, emissiveIntensity: 1.8 });  // 雙大圓眼(全機最亮)
        const rim = cylF(h, 0.13, 0.13, 0.03, 12, sx * 0.14 * G, 0.24, 0.25, PAL.deep, { metalness: 0.7 });
        rim.rotation.x = Math.PI / 2;                                              // 眼眶環
        const ear = cylF(h, 0.1, 0.1, 0.04, 10, sx * 0.29 * G, 0.2, 0, PAL.deep, { metalness: 0.6 });
        ear.rotation.z = Math.PI / 2;                                              // 耳盤(Laputa 收音孔)
      }
      bxF(h, 0.16, 0.03, 0.04, 0, 0.06, 0.26, COAL);                               // 小嘴縫
      for (let i = 0; i < 5; i++) {                                                // 頭頂後緣天線叢(不等長細鞭)
        const L = 0.5 + (i % 3) * 0.16;
        const ant = bxF(h, 0.025, L, 0.025, -0.16 + i * 0.08, 0.55 + L / 2, -0.2, IRON, { metalness: 0.8 });
        ant.rotation.z = (i - 2) * 0.12;
        if (i === 2) sphF(h, 0.035, -0.16 + i * 0.08 - Math.sin(0.0) * 0, 0.55 + L + 0.03, -0.2, PAL.deep, { metalness: 0.6 });  // 最長那根帶配重球
      }
    },
    chest(c, ch, d) {
      const { PAL, accent, G } = c;
      const top = d.shoulderY, bot = d.waistY;
      bxF(ch, d.shoulderX * 1.45, top - bot + 0.5, 0.9 * G, 0, (top + bot) / 2 + 0.12, 0, PAL.main, { metalness: 0.55 });
      bxF(ch, d.shoulderX * 1.05, (top - bot) * 0.7, 0.2, 0, (top + bot) / 2 + 0.12, 0.42 * G, PAL.lite, { metalness: 0.55 });  // 前胸圓角板(雙層)
      bxF(ch, d.shoulderX * 0.9, 0.34, 0.86 * G, 0, bot - 0.02, 0.02, PAL.mid, { metalness: 0.55 });  // 橫置腹節
      for (const sx of [-1, 1])
        bxF(ch, 0.06, (top - bot) * 0.62, 0.05, sx * 0.26, (top + bot) / 2 + 0.1, 0.53 * G, PAL.mid);  // 胸前縱肋
      bxF(ch, 0.36, (top - bot) * 0.66, 0.03, 0, (top + bot) / 2 + 0.1, 0.53 * G, dimF(PAL.main, 0.82));  // 紋章艙蓋框
      for (let i = 0; i < 3; i++)
        cylF(ch, 0.05, 0.05, 0.03, 10, 0, (top + bot) / 2 + 0.32 - i * 0.22, 0.56 * G, accent, { emissive: accent, emissiveIntensity: 1.2 }).rotation.x = Math.PI / 2;  // 縱列三光點紋章
      const sig = bxF(ch, 0.5, 0.34, 0.3, 0.2, top + 0.05, -0.5 * G, PAL.mid, { metalness: 0.55 });  // 背部訊號處理艙
      for (let i = 0; i < 3; i++) {
        const L = 0.55 + i * 0.18;
        const ant = bxF(sig, 0.02, L, 0.02, -0.1 + i * 0.12, 0.2 + L / 2, 0, IRON, { metalness: 0.8 });
        ant.rotation.x = -0.15;
      }
    },
    pelvis(c, hips, d) {
      const { PAL, G } = c;
      const slab = bxF(hips, 0.8 * G, 0.4, 0.55 * G, 0, 0.0, 0, PAL.deep, { metalness: 0.6 });  // 橫置膠囊骨盆
      cylF(hips, 0.34, 0.34, 0.14, 12, 0, 0.24, 0, PAL.mid, { metalness: 0.7 });   // 大直徑平端關節環(封接縫)
      for (const sx of [-1, 1]) {
        const ax = cylF(hips, 0.12, 0.12, 0.18, 10, sx * 0.4 * G, -0.05, 0, COAL, { metalness: 0.8 });
        ax.rotation.z = Math.PI / 2;                                               // 半埋髖軸環
      }
      bxF(hips, 0.3 * G, 0.22, 0.08, 0, -0.12, 0.3 * G, PAL.mid);                  // 胯前小圓角護板
    },
    thigh(c, l, d) { seg2(l, 0.42 * c.G, d.len, 0.46 * c.G, 0, c.PAL.main, c.PAL.mid); },
    shin(c, l, d) {
      seg2(l, 0.36 * c.G, d.len * 0.6, 0.4 * c.G, 0, c.PAL.main, c.PAL.mid);       // 脛節
      seg2(l, 0.31 * c.G, d.len * 0.42, 0.35 * c.G, -d.len * 0.58, c.PAL.mid, c.PAL.main);  // 蹠節(配色反轉)
      bxF(l, 0.4 * c.G, 0.2, 0.12, 0, -0.06, 0.2 * c.G, c.PAL.mid);                // 圓角方膝甲
    },
    foot(c, l, d) {
      const { PAL } = c;
      bxF(l, 0.42, 0.18, d.footL, 0, -d.clear * 0.5, d.footL * 0.1, PAL.main, { metalness: 0.5 });  // 圓頭膠鞋足掌
      for (const ox of [-0.13, 0, 0.13])
        bxF(l, 0.11, 0.12, 0.16, ox, -d.clear * 0.45, d.footL * 0.52, PAL.mid);    // 三枚圓角趾板
    },
    armUp(c, a, d) {
      const { PAL, G } = c;
      const pad = sphF(a, 0.34 * G, c.sx * 0.1, 0.12, 0, PAL.main, { metalness: 0.55 });
      pad.scale.set(1, 0.8, 1);                                                    // 光滑半球圓肩甲
      const ant = bxF(a, 0.02, 0.5, 0.02, c.sx * 0.24 * G, 0.5, -0.06, IRON, { metalness: 0.8 });
      ant.rotation.z = c.sx * 0.35;                                                // 肩甲斜出天線
      seg2(a, 0.3 * G, d.len, 0.32 * G, -0.05, PAL.main, PAL.mid);
    },
    armFore(c, a, d) {
      const { PAL, G } = c;
      seg2(a, 0.27 * G, d.len * 0.55, 0.29 * G, 0, PAL.main, PAL.mid);             // 前臂節(疊環最密)
      seg2(a, 0.24 * G, d.len * 0.45, 0.26 * G, -d.len * 0.55, PAL.mid, PAL.main);
    },
    mount(c, F) {
      const { PAL, accent, G, K } = c;
      // 左腕 RF 測向環(靜態微光,MUST NOT 進戰鬥 glow)+ 三指
      const ring = cylF(F.handL, 0.16, 0.16, 0.1, 12, 0, -0.02, 0, PAL.deep, { metalness: 0.8 });
      cylF(F.handL, 0.17, 0.17, 0.03, 12, 0, -0.02, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });
      for (const g of [F.handL, F.handR]) for (const ox of [-0.09, 0, 0.09])
        bxF(g, 0.09, 0.38, 0.09, ox, -0.3, 0.03, PAL.mid, { metalness: 0.55 }).rotation.x = ox === 0 ? 0 : 0.08;  // 三根圓角長指
      cylF(F.handR, 0.05, 0.05, 0.02, 8, 0, -0.12, 0.09, accent, { emissive: accent, emissiveIntensity: 1.0 }).rotation.x = Math.PI / 2;  // 右掌心測向器
      // 右手掃描脈衝槍(輕武器)
      const gr = new THREE.Group();
      gr.position.set(0.14, -0.22, 0.2);
      gr.rotation.set(1.4, 0, 0.1);
      F.handR.add(gr);
      const BL = 0.85 * K.barrelF;
      bxF(gr, 0.24, 0.6, 0.26, 0, 0.1, 0, PAL.main, { metalness: 0.55 });          // 圓角機匣
      bxF(gr, 0.1, 0.2, 0.16, 0, -0.18, -0.18, PAL.deep, { metalness: 0.6 });      // 圓角握把
      cylF(gr, 0.06, 0.03, BL, 8, 0, 0.42 + BL / 2, 0, GUNMETAL, { metalness: 0.8 });  // 細圓錐射束管
      for (const t of [0.3, 0.6])
        cylF(gr, 0.09, 0.09, 0.06, 8, 0, 0.42 + BL * t, 0, IRON, { metalness: 0.75 });  // 聚焦環
      const lMuz = sphF(gr, 0.065, 0, 0.48 + BL, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });  // 管口光球
      bxF(gr, 0.08, 0.05, 0.14, 0, 0.42, -0.14, dimF(accent, 0.5));                // 照門
      return {
        gunR: { g: gr, rest: 1.4, aim: 2.72 }, gunL: null,                         // aim = 1.57 − (−0.8 − 0.35)
        muzzles: { light: { n: lMuz, r: 0.07 }, heavy: { n: c.browCannon, r: 0.05 } },
        lightGlowM: [lMuz], heavyGlowM: [c.browCannon], heavyPivot: [],
        weap: { light: 'R', heavy: 'N' },                                          // 重武器 = 眉心砲(機載)
        hvy: { chest: 0.04, gun: 0.04 },
        aimPose: { rShoulderX: -0.8, rElbowX: -0.35 },                             // 單手托一把,左臂自由
        wpn: { light: { nodes: [gr], ref: gr, muz: lMuz, fwd: 'y' }, heavy: { nodes: [c.browCannon], ref: c.browCannon, muz: c.browCannon, fwd: 'z' } },
      };
    },
  },

  // ── t06「輕功」齊天式(monkey 人形地面型):掌行長臂、金箍猴面、肩扛如意棒、尾砲 ──
  t06: {
    label: '齊天式(t06 變形者・地面型)', hue: 0xffb84d,
    prop: { hips: 0.42, legSplay: 0.1, thigh: 0.44, shin: 0.42, shoulderY: 0.78, shoulderX: 0.18, upperArm: 0.3, foreArm: 0.31, head: 0.83, girth: 0.85 },
    gait: { strideF: 1.15, bob: 0.14, sway: 0.09, top: 8.5, armBase: 0.15, legBase: -0.1 },
    knuckle: true,                                                                 // 掌行:前肢是前腳(rig.knuckle)
    moveSig: { poise: 0.38, idleF: 1.92, idleA: 1.05, launch: 0.94, spool: 0.08, brake: 0.6, settle: 0.42 },
    castSig: { omni: 'dance', dir: 'swing' },
    doc: [['head', '金箍+雙翎+短圓吻猴面+火眼金睛+猴耳盤'], ['chest', '圓潤胸艙+光翼翼根盒+搶修背包+虎皮裙腰甲'], ['hips', '裸露內構骨盆+accent 腰帶'], ['leg ×2', '深蹲短後腿+分趾爪+足底噴口'], ['arm ×2', '2 倍長掌行臂:裸缸+亮桿芯+掌背護甲'], ['hand ×2', '掌行前腳(平攤掌面+三指列+拇指)'], ['武裝', '肩扛如意棒(輕)+五節尾端熔核砲(重),皆機載']],
    head(c, h) {
      const { PAL, accent, G } = c;
      sphF(h, 0.26 * G, 0, 0.1, 0, PAL.main, { metalness: 0.5 }).scale.set(1, 0.92, 0.95);  // 圓頂盔殼
      const band = cylF(h, 0.27 * G, 0.27 * G, 0.07, 14, 0, 0.24, 0, 0xe8b33a, { metalness: 0.85 });  // 拋光金箍
      for (const sx of [-1, 1]) {
        const fe = bxF(h, 0.03, 0.5, 0.05, sx * 0.16 * G, 0.5, -0.1, 0xe8b33a, { metalness: 0.7 });
        fe.rotation.z = sx * 0.35; fe.rotation.x = -0.3;                           // 紫金冠翎羽(後掠)
        const ear = cylF(h, 0.08, 0.08, 0.035, 10, sx * 0.26 * G, 0.05, 0, PAL.mid, { metalness: 0.6 });
        ear.rotation.z = Math.PI / 2;                                              // 圓盤猴耳
        sphF(h, 0.065, sx * 0.1 * G, 0.12, 0.21, 0xffd76a, { emissive: 0xffd76a, emissiveIntensity: 1.6 });  // 火眼金睛
      }
      const muzz = bxF(h, 0.2 * G, 0.14, 0.18, 0, -0.06, 0.2, PAL.lite, { metalness: 0.5 });
      muzz.rotation.x = 0.05;                                                      // 短圓吻雷公嘴
      for (const ox of [-0.06, 0.02, 0.08])                                        // 頸部金色管束(2D 頸側可見)
        cylF(h, 0.025, 0.025, 0.24, 6, ox, -0.22, -0.02, 0xe8b33a, { metalness: 0.8 });
    },
    chest(c, ch, d) {
      const { PAL, accent, G } = c;
      const top = d.shoulderY, bot = d.waistY;
      bxF(ch, d.shoulderX * 1.6, (top - bot) * 0.72, 0.8 * G, 0, top - (top - bot) * 0.3, 0, PAL.main, { metalness: 0.5 });  // 圓潤胸艙
      bxF(ch, d.shoulderX * 1.2, 0.12, 0.06, 0, top - 0.3, 0.42 * G, accent, { emissive: accent, emissiveIntensity: 1.0 });  // 胸前識別燈
      bxF(ch, 0.3, (top - bot) * 0.4, 0.34, 0, bot + 0.2, -0.06, GUNMETAL, { metalness: 0.7 });  // 腰腹裸內構
      for (const sx of [-1, 1])
        bxF(ch, 0.04, (top - bot) * 0.36, 0.04, sx * 0.1, bot + 0.2, 0.12, 0xe8b33a, { metalness: 0.8 });  // 金色骨架線
      bxF(ch, 0.6 * G, 0.5, 0.26, 0, top - 0.5, -0.5 * G, PAL.mid, { metalness: 0.55 });  // 搶修背包
      bxF(ch, 0.16, 0.3, 0.1, 0.24 * G, top - 0.42, -0.66 * G, PAL.deep);          // 摺收械爪
      bxF(ch, 0.18, 0.22, 0.1, -0.24 * G, top - 0.42, -0.66 * G, PAL.main);        // 工具匣
      bxF(ch, 0.16, 0.05, 0.02, -0.24 * G, -0.28 + top, -0.71 * G, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 警示條
      for (const sx of [-1, 1]) {                                                  // 光翼翼根盒(地面熄滅)
        const wr = bxF(ch, 0.2, 0.14, 0.3, sx * 0.42 * G, top - 0.15, -0.55 * G, PAL.deep, { metalness: 0.7 });
        bxF(wr, 0.16, 0.03, 0.26, 0, 0.085, 0, dimF(accent, 0.9), { emissive: accent, emissiveIntensity: 0.7 });
      }
    },
    pelvis(c, hips, d) {
      const { PAL, accent, G } = c;
      bxF(hips, 0.62 * G, 0.32, 0.5 * G, 0, 0.02, 0, GUNMETAL, { metalness: 0.7 }); // 裸露內構骨盆
      bxF(hips, 0.64 * G, 0.08, 0.52 * G, 0, 0.2, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });  // accent 腰帶
      const fr = bxF(hips, 0.3 * G, 0.26, 0.06, 0, -0.1, 0.28 * G, 0xa8802a, { metalness: 0.4 });
      fr.rotation.x = -0.45;                                                       // 虎皮裙前腰片(暗金)
      for (const sx of [-1, 1]) {
        const sp = bxF(hips, 0.06, 0.24, 0.22 * G, sx * 0.32 * G, -0.08, 0.06, 0xa8802a, { metalness: 0.4 });
        sp.rotation.z = sx * 0.55;                                                 // 側包片
      }
    },
    thigh(c, l, d) {
      const { PAL, G } = c;
      bxF(l, 0.3 * G, d.len * 1.02, 0.36 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.5 });  // 大片琥珀甲
      cylF(l, 0.05, 0.05, 0.02, 8, c.sx * 0.16 * G, -d.len * 0.35, 0.19 * G, COAL); // 圓孔飾
    },
    shin(c, l, d) {
      const { PAL, G } = c;
      bxF(l, 0.2 * G, d.len * 1.0, 0.22 * G, 0, -d.len * 0.5, 0, GUNMETAL, { metalness: 0.7 });  // 暗色細瘦露構造
      cylF(l, 0.08, 0.08, 0.04, 10, c.sx * 0.11 * G, -0.02, 0, 0xe8b33a, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 金色圓盤膝軸
      cylF(l, 0.05, 0.07, 0.12, 8, 0, -d.len * 0.9, -0.12, COAL, { metalness: 0.8 }).rotation.x = -0.5;  // 足底噴口(朝後)
    },
    foot(c, l, d) {
      const { PAL } = c;
      bxF(l, 0.3, 0.13, d.footL * 0.8, 0, -d.clear * 0.5, d.footL * 0.1, PAL.deep);
      for (const ox of [-0.09, 0, 0.09])
        bxF(l, 0.08, 0.08, 0.24, ox, -d.clear * 0.5, d.footL * 0.5, 0xd8d4c8, { metalness: 0.7 });  // 分趾爪
    },
    armUp(c, a, d) {
      const { PAL, G } = c;
      cylF(a, 0.17 * G, 0.17 * G, 0.06, 12, 0, 0.08, 0, 0xe8b33a, { metalness: 0.8 });  // 小圓肩鈕(金)
      bxF(a, 0.22 * G, d.len * 1.0, 0.26 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.5 });
      bxF(a, 0.1, d.len * 0.6, 0.12, c.sx * 0.14 * G, -d.len * 0.45, -0.06, GUNMETAL, { metalness: 0.6 });  // 黑色柔性肌束
      hydCyl(a, 0.032, d.len * 0.55, -c.sx * 0.12 * G, -d.len * 0.62, 0.14 * G, -0.1, 0xd8d4c8);  // 裸缸+亮桿芯
    },
    armFore(c, a, d) {
      const { PAL, G } = c;
      bxF(a, 0.19 * G, d.len * 1.0, 0.22 * G, 0, -d.len * 0.5, 0.02, PAL.mid, { metalness: 0.6 });  // 前臂暗色
      cylF(a, 0.07, 0.07, 0.035, 10, c.sx * 0.1 * G, -0.01, 0, 0xe8b33a, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 金色肘軸盤
    },
    mount(c, F) {
      const { PAL, accent, G, K, H } = c;
      // 掌行前腳:平攤掌面 + 三指列 + 拇指 + 掌背護甲(雙手同型;武器全機載)
      for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
        bxF(g, 0.24 * G, 0.08, 0.32, 0, -0.16, 0.06, PAL.deep);                    // 平攤掌面
        for (const ox of [-0.07, 0, 0.07])
          bxF(g, 0.06, 0.06, 0.2, ox, -0.16, 0.26, 0xd8d4c8, { metalness: 0.7 });  // 前伸指列
        bxF(g, 0.06, 0.06, 0.14, sx * -0.13 * G, -0.16, 0.1, 0xd8d4c8, { metalness: 0.7 });  // 內側拇指
        bxF(g, 0.2 * G, 0.06, 0.24, 0, -0.1, 0.04, PAL.lite, { metalness: 0.6 });  // 掌背耐磨護甲
      }
      // 輕武器:右肩肩扛如意棒(黑鐵棒身+兩端金箍;gunPitch 俯仰)。
      // 棒身沿 +y、掛胸(無臂鏈)⇒ 前指 = rotation.x 1.57;行軍 rest 1.35 微上揚
      const staff = new THREE.Group();
      staff.position.set(0.4, c.dims.shoulderYl + 0.15, 0);
      staff.rotation.set(1.35, 0, -0.05);
      F.chest.add(staff);
      const SL = 0.3 * H * K.barrelF;
      cylF(staff, 0.05, 0.05, SL * 2, 10, 0, SL * 0.12, 0, GUNMETAL, { metalness: 0.85 });  // 棒身(前長後短)
      for (const oy of [SL * 1.05, -SL * 0.8])
        cylF(staff, 0.065, 0.065, 0.18, 10, 0, oy, 0, 0xe8b33a, { metalness: 0.85, emissive: 0xe8b33a, emissiveIntensity: 0.4 });  // 兩端金箍
      const lMuz = cylF(staff, 0.07, 0.07, 0.06, 10, 0, SL * 1.16, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 前端槍口環
      bxF(staff, 0.1, 0.14, 0.22, 0, -SL * 0.2, -0.1, PAL.deep, { metalness: 0.6 });  // 電容匣兼肩墊
      return {
        gunR: { g: staff, rest: 1.35, aim: 1.57 }, gunL: null,                     // 肩扛樞軸(weap 'N' + gunR:猩猩肩砲同款)
        muzzles: { light: { n: lMuz, r: 0.07 }, heavy: null },                     // heavy 由 extra 的尾砲補
        lightGlowM: [lMuz], heavyGlowM: [], heavyPivot: [],
        weap: { light: 'N', heavy: 'N' },
        hvy: { chest: 0.05 },
        aimPose: null,
        wpn: { light: { nodes: [staff], ref: staff, muz: lMuz, fwd: 'y' }, heavy: null },
      };
    },
    extra(c, F, rig) {
      const { PAL, accent, G } = c;
      // 五節收分長尾 + 尾端熔核砲(重武器;行軍上捲由 whipTail 的 base 疊加)
      const segs = [];
      let cur = F.hips;
      let py = -0.05, pz = -0.3 * G;
      for (let i = 0; i < 5; i++) {
        const t = new THREE.Group();
        t.position.set(0, py, pz);
        t.rotation.x = 0.55 - i * 0.06;                                            // 逐節上捲蓄勢
        cur.add(t);
        const r = 0.11 * G - i * 0.016;
        const body = cylF(t, r, r * 0.85, 0.5, 8, 0, 0, -0.25, PAL.main, { metalness: 0.55 });
        body.rotation.x = Math.PI / 2;
        cylF(t, r + 0.03, r + 0.03, 0.05, 8, 0, 0, -0.02, IRON, { metalness: 0.8 }).rotation.x = Math.PI / 2;  // 節間關節環
        segs.push(t);
        cur = t; py = 0; pz = -0.5;
      }
      const gunT = cylF(cur, 0.12 * G, 0.14 * G, 0.55, 10, 0, 0, -0.75, GUNMETAL, { metalness: 0.8 });
      gunT.rotation.x = Math.PI / 2;                                               // 尾端熔核砲身
      cylF(cur, 0.16 * G, 0.16 * G, 0.1, 10, 0, 0, -0.52, IRON, { metalness: 0.8 }).rotation.x = Math.PI / 2;  // 機匣環
      const hMuz = cylF(cur, 0.13 * G, 0.13 * G, 0.07, 10, 0, 0, -1.05, accent, { emissive: accent, emissiveIntensity: 1.6 });
      hMuz.rotation.x = Math.PI / 2;                                               // 砲口充能環
      rig.tailSegs = segs;
      rig.tailUp = 0.12;
      rig.muzzles.heavy = { n: hMuz, r: 0.13 * G };
      rig.heavy.glow.push({ mesh: hMuz, base: 1.6 });
      rig.wpn.heavy = { nodes: [gunT], ref: gunT, muz: hMuz, fwd: '-z' };
    },
  },

  // ── t11「老兵」可變式戰術指導機(atlas):貨運掛架、指揮塔頭、旋翼盾、鉚接工業甲 ──
  t11: {
    label: '老兵(t11 變形者・地面型)', hue: 0x8a9a5a,
    prop: { hips: 0.5, legSplay: 0.115, thigh: 0.46, shin: 0.42, shoulderY: 0.78, shoulderX: 0.2, upperArm: 0.175, foreArm: 0.16, head: 0.9, girth: 1.15 },
    gait: { strideF: 1.35, bob: 0.13, sway: 0.1, top: 7, armBase: 0.1 },
    moveSig: { poise: 0.42, idleF: 0.68, idleA: 1.4, launch: 0.08, spool: 0.8, brake: 0.18, settle: 1.7 },
    castSig: { omni: 'stomp', dir: 'jab' },
    doc: [['head', '車長指揮塔:雙觀察窗(一格裂痕)+頂圓塔+鞭天線'], ['chest', '鉚接梯形胸甲+防滾籠+背馱貨箱+雙側貨運掛架'], ['hips', '寬扁骨盆+後腰雙配重塊(警示條+吊環)'], ['leg ×2', '短粗鉚接腿:圓筒膝關節+螺栓蓋+大平足'], ['arm ×2', '臂兼主翼板+外露液壓撐桿'], ['hand ×2', '雙拳各持旋翼盤圓盾(輪緣+四徑肋)'], ['武裝', '右架雙聯機槍莢(輕)+左架集束布撒器(重)']],
    head(c, h) {
      const { PAL, accent, G } = c;
      bxF(h, 0.4 * G, 0.36, 0.42, 0, 0.05, 0, PAL.main, { metalness: 0.6 });       // 指揮塔體(斜切感)
      for (const sx of [-1, 1])
        bxF(h, 0.12, 0.09, 0.03, sx * 0.09 * G, 0.1, 0.22, 0x8fa8b8, { metalness: 0.3 });  // 並排雙觀察窗(不發光)
      bxF(h, 0.05, 0.015, 0.035, 0.09 * G, 0.1, 0.225, 0x3a3f45);                  // 裂痕貼膠帶(斜條)
      cylF(h, 0.14 * G, 0.15 * G, 0.16, 10, 0, 0.31, -0.04, PAL.mid, { metalness: 0.6 });  // 頂部圓塔
      for (let i = 0; i < 4; i++) {
        const th = i / 4 * Math.PI * 2 + 0.4;
        bxF(h, 0.035, 0.03, 0.02, Math.cos(th) * 0.13 * G, 0.33, -0.04 + Math.sin(th) * 0.13, 0x8fa8b8, { metalness: 0.3 });  // 環列觀察鏡
      }
      bxF(h, 0.13, 0.02, 0.12, 0.03, 0.41, -0.04, PAL.deep);                       // 半開小艙蓋
      const whip = bxF(h, 0.018, 0.85, 0.018, -0.16 * G, 0.7, -0.12, IRON, { metalness: 0.8 });
      whip.rotation.z = -0.08;                                                     // 鞭狀長天線(全機最高)
    },
    chest(c, ch, d) {
      const { PAL, accent, G } = c;
      const top = d.shoulderY, bot = d.waistY;
      bxF(ch, d.shoulderX * 1.5, top - bot + 0.3, 0.95 * G, 0, (top + bot) / 2 + 0.1, 0, PAL.main, { metalness: 0.6 });
      bxF(ch, d.shoulderX * 1.1, 0.11, 0.05, 0, (top + bot) / 2 + 0.05, 0.5 * G, accent, { emissive: accent, emissiveIntensity: 1.0 });  // 胸前識別燈
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++)
          bxF(ch, 0.035, 0.035, 0.035, sx * (d.shoulderX * 0.72), (top + bot) / 2 - 0.3 + i * 0.24, 0.49 * G, PAL.deep, { metalness: 0.7 });  // 板縫鉚釘列
        bxF(ch, 0.12, 0.4, 0.06, sx * (d.shoulderX * 0.62), (top + bot) / 2 + 0.12, 0.5 * G, PAL.mid);  // 豎直進氣柵
      }
      for (const sx of [-1, 1]) {                                                  // 防滾籠(駕駛位頂)
        const bar = cylF(ch, 0.03, 0.03, 0.5, 6, sx * 0.18, top + 0.2, 0.1, IRON, { metalness: 0.8 });
        bar.rotation.x = 0.5;
      }
      cylF(ch, 0.03, 0.03, 0.4, 6, 0, top + 0.3, 0.02, IRON, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 頂樑
      for (let i = 0; i < 3; i++)
        sphF(ch, 0.028, -0.12 + i * 0.12, top + 0.31, 0.05, 0xfff2b8, { emissive: 0xfff2b8, emissiveIntensity: 0.9 });  // 工作燈
      bxF(ch, 0.5, 0.32, 0.5 * G, 0.08, top + 0.1, -0.4 * G, 0x6a6f5a, { metalness: 0.3 });  // 背馱貨箱(略歪)
      bxF(ch, 0.4, 0.26, 0.4 * G, -0.14, top + 0.04, -0.55 * G, 0x7a7360, { metalness: 0.3 }).rotation.y = 0.12;
      for (const sx of [-1, 1]) {                                                  // 雙側貨運掛架(滿載)
        const rack = new THREE.Group();
        rack.position.set(sx * (d.shoulderX * 1.35), top + 0.16, 0);
        rack.rotation.z = sx * 0.12;
        ch.add(rack);
        if (sx > 0) c.rackR = rack; else c.rackL = rack;                           // mount 消費(不靠 children 掃描)
        bxF(rack, 0.5 * G, 0.14, 1.2, 0, 0, 0, PAL.mid, { metalness: 0.6 });       // 掛架樑
        bxF(rack, 0.08, 0.05, 1.2, sx * 0.24 * G, 0.08, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 臂端警示條
        bxF(rack, 0.34, 0.3, 0.44, 0, 0.22, 0.3, 0x7a7360, { metalness: 0.3 });    // 帆布捆
        cylF(rack, 0.14, 0.14, 0.26, 10, 0, 0.2, -0.28, 0x4a4f42, { metalness: 0.5 }).rotation.z = Math.PI / 2;  // 油桶
        if (sx > 0) {
          cylF(rack, 0.17, 0.17, 0.1, 12, 0, 0.24, 0.68, 0x2e3138, { metalness: 0.4 }).rotation.z = Math.PI / 2;  // 備胎
        } else {
          const crate = bxF(rack, 0.3, 0.26, 0.4, 0, -0.32, 0.55, 0x8f7f4a, { metalness: 0.3 });  // 吊掛瓦楞貨櫃(懸空縫)
          for (const oz of [0.4, 0.7]) bxF(rack, 0.02, 0.2, 0.02, 0, -0.12, oz, IRON, { metalness: 0.8 });  // 吊桿
        }
        const nest = bxF(rack, 0.26, 0.24, 0.2, 0, 0.06, -0.62, PAL.deep, { metalness: 0.6 });  // 蜂群發射巢(管口朝後)
        for (const oy of [-0.05, 0.05]) for (const ox of [-0.06, 0.06])
          cylF(nest, 0.04, 0.04, 0.06, 8, ox, oy, -0.11, COAL, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      }
    },
    pelvis(c, hips, d) {
      const { PAL, accent, G } = c;
      bxF(hips, 0.8 * G, 0.36, 0.6 * G, 0, 0.02, 0, PAL.deep, { metalness: 0.6 });
      bxF(hips, 0.5 * G, 0.26, 0.1, 0, -0.08, 0.32 * G, PAL.mid);                  // 前擋板
      for (const sx of [-1, 1]) {                                                  // 後腰雙配重塊
        const w = bxF(hips, 0.24 * G, 0.26, 0.2, sx * 0.3 * G, 0.0, -0.34 * G, PAL.mid, { metalness: 0.6 });
        bxF(w, 0.2 * G, 0.04, 0.16, 0, 0.15, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 頂面警示條
        cylF(w, 0.03, 0.03, 0.06, 6, 0, -0.16, 0, IRON, { metalness: 0.8 });        // 下緣吊環
      }
    },
    thigh(c, l, d) {
      const { PAL, G } = c;
      bxF(l, 0.4 * G, d.len * 1.02, 0.46 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });
      for (let i = 0; i < 3; i++)
        bxF(l, 0.035, 0.035, 0.035, 0.19 * G, -d.len * (0.25 + i * 0.2), 0.22 * G, PAL.deep, { metalness: 0.7 });  // 鉚釘列
    },
    shin(c, l, d) {
      const { PAL, G, sx } = c;
      const knee = cylF(l, 0.15 * G, 0.15 * G, 0.3, 12, 0, -0.02, 0, PAL.mid, { metalness: 0.65 });
      knee.rotation.z = Math.PI / 2;                                               // 圓筒膝關節鼓包
      cylF(l, 0.055, 0.055, 0.03, 6, sx * 0.17 * G, -0.02, 0, COAL, { metalness: 0.85 }).rotation.z = Math.PI / 2;  // 六角螺栓蓋
      bxF(l, 0.36 * G, d.len * 0.55, 0.42 * G, 0, -d.len * 0.32, 0, PAL.main, { metalness: 0.6 });  // 鉚接疊板(上)
      bxF(l, 0.4 * G, d.len * 0.5, 0.46 * G, 0, -d.len * 0.75, 0.01, PAL.mid, { metalness: 0.6 });  // 疊板(下,外擴)
      hydCyl(l, 0.035, d.len * 0.4, 0, -d.len * 0.3, -0.22 * G, -0.15, PAL.lite);   // 小腿後液壓撐桿
    },
    foot(c, l, d) {
      const { PAL } = c;
      bxF(l, 0.44, 0.18, d.footL * 1.1, 0, -d.clear * 0.5, d.footL * 0.12, PAL.deep);  // 大平足掌
      bxF(l, 0.46, 0.1, 0.2, 0, -d.clear * 0.42, d.footL * 0.62, PAL.mid);         // 趾板
    },
    armUp(c, a, d) {
      const { PAL, accent, G } = c;
      cylF(a, 0.22 * G, 0.22 * G, 0.3, 12, 0, 0.06, 0, PAL.main, { metalness: 0.6 }).rotation.z = Math.PI / 2;  // 圓筒大肩甲
      cylF(a, 0.05, 0.05, 0.04, 8, 0, 0.2, -0.1, COAL, { metalness: 0.7 });        // 肩排氣口
      bxF(a, 0.26 * G, d.len * 1.0, 0.3 * G, 0, -d.len * 0.5, 0, PAL.main, { metalness: 0.6 });
      const wing = bxF(a, 0.06, d.len * 0.95, 0.4, c.sx * 0.17 * G, -d.len * 0.5, -0.02, PAL.mid, { metalness: 0.6 });  // 臂側主翼板
      bxF(wing, 0.02, d.len * 0.85, 0.04, c.sx * 0.03, 0, 0.2, accent, { emissive: accent, emissiveIntensity: 0.7 });   // 翼前緣識別條
    },
    armFore(c, a, d) {
      const { PAL, G } = c;
      hydCyl(a, 0.035, d.len * 0.5, 0, -d.len * 0.2, -0.16 * G, -0.25, PAL.lite);  // 肘內側液壓撐桿
      bxF(a, 0.24 * G, d.len * 1.0, 0.28 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });
      bxF(a, 0.05, d.len * 0.6, 0.3, c.sx * 0.15 * G, -d.len * 0.55, 0, PAL.mid);  // 前臂翼板段
    },
    mount(c, F) {
      const { PAL, accent, G, K } = c;
      // 雙拳 + 拳側旋翼盤圓盾(地面是盾、飛行旋轉)
      for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
        bxF(g, 0.3, 0.3, 0.3, 0, -0.14, 0.02, c.dark);                             // 大方指節拳
        const disc = new THREE.Group();
        disc.position.set(sx * 0.26 * G, -0.14, 0.02);
        g.add(disc);
        const face = cylF(disc, 0.5, 0.5, 0.05, 16, 0, 0, 0, PAL.mid, { metalness: 0.65 });
        face.rotation.z = Math.PI / 2;                                             // 盤面
        const rim = cylF(disc, 0.55, 0.55, 0.04, 16, 0, 0, 0, dimF(accent, 0.85), { emissive: accent, emissiveIntensity: 0.6 });
        rim.rotation.z = Math.PI / 2;                                              // accent 輪緣
        cylF(disc, 0.1, 0.1, 0.09, 10, sx * 0.05, 0, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 槳轂
        for (let i = 0; i < 4; i++) {
          const rib = bxF(disc, 0.03, 0.05, 0.92, sx * 0.045, 0, 0, PAL.deep, { metalness: 0.7 });
          rib.rotation.x = i * Math.PI / 4;                                        // 四條徑肋十字
        }
      }
      // 右架雙聯機槍莢(輕武器)—— 掛在右貨架下方
      const pod = new THREE.Group();
      pod.position.set(0.05, -0.22, 0.42);
      (c.rackR || F.chest).add(pod);
      const ML = 0.85 * K.barrelF;
      bxF(pod, 0.3, 0.22, 0.5, 0, 0, 0, PAL.deep, { metalness: 0.65 });            // 共構機匣
      for (const ox of [-0.07, 0.07]) cylF(pod, 0.028, 0.028, ML, 8, ox, 0, 0.45 + ML / 2, GUNMETAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;  // 並列雙管
      const lMuz = bxF(pod, 0.2, 0.06, 0.05, 0, 0, 0.5 + ML, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 槍口環燈
      for (const ox of [-0.07, 0.07]) bxF(pod, 0.08, 0.16, 0.12, ox, -0.18, 0.05, PAL.mid);  // 下垂雙彈匣
      // 左架集束布撒器(重武器):方箱 + 2×3 發光膛口 + 俯仰樞軸(蓄力上仰)
      const piv = new THREE.Group();
      piv.position.set(-0.05, 0.34, -0.1);
      (c.rackL || F.chest).add(piv);
      bxF(piv, 0.4, 0.3, 0.62, 0, 0, 0, PAL.mid, { metalness: 0.6 });              // 布撒方箱
      bxF(piv, 0.34, 0.05, 0.56, 0, 0.17, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 頂蓋識別條
      const ports = [];
      for (let i = 0; i < 6; i++) {
        const px = (i % 3 - 1) * 0.11, py2 = (i < 3 ? 0.06 : -0.06);
        const p = cylF(piv, 0.045, 0.045, 0.05, 8, px, py2, 0.32, accent, { emissive: accent, emissiveIntensity: 0.9 });
        p.rotation.x = Math.PI / 2;
        ports.push(p);                                                             // 2×3 發光膛口
      }
      return {
        gunR: null, gunL: null,
        muzzles: { light: { n: lMuz, r: 0.08 }, heavy: { n: ports[1], r: 0.05 } },
        lightGlowM: [lMuz], heavyGlowM: ports,
        heavyPivot: [{ obj: piv, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.18, y: 0, z: 0 } }],  // 蓄力上仰、擊發反坐
        weap: { light: 'N', heavy: 'N' },
        hvy: { chest: 0.06 },
        aimPose: null,
        wpn: { light: { nodes: [pod], ref: pod, muz: lMuz, fwd: 'z' }, heavy: { nodes: [piv], ref: piv, muz: ports[1], fwd: 'z' } },
      };
    },
  },

  // ── m01「渡鴉」貴族突襲機(vampire):高立領、摺收旋翼、胸飾組、雙槍 M134+地獄火 ──
  m01: {
    label: '渡鴉(m01 變形者・地面型)', hue: 0xd94f4f,
    prop: { hips: 0.54, legSplay: 0.06, thigh: 0.48, shin: 0.46, shoulderY: 0.82, shoulderX: 0.145, upperArm: 0.155, foreArm: 0.15, head: 0.9, girth: 0.9 },
    gait: { strideF: 1.3, bob: 0.05, sway: 0.05, top: 8, armBase: 0.05 },
    moveSig: { poise: 0.85, idleF: 0.9, idleA: 0.4, launch: 0.9, spool: 0.1, brake: 0.7, settle: 0.4 },
    castSig: { omni: 'spin', dir: 'swing' },
    doc: [['head', '楔形頭殼+面罩感測條+widow’s peak+單片眼鏡環'], ['chest', '高立領三片環抱(外黑內紅)+菱形胸針+雙排釦'], ['hips', '收攏披風三片裙板+accent 滾邊'], ['leg ×2', '修長直腿+膝圓盤蓋+小腿摺收旋翼+尖頭鞋'], ['arm ×2', '平板肩章+反折禮服袖口(烤漆蓋板關節)'], ['hand R', 'M134 六管速射艙(輕)'], ['hand L', '地獄火雙聯發射管(重)']],
    head(c, h) {
      const { PAL, accent, G } = c;
      bxF(h, 0.36 * G, 0.3, 0.4, 0, 0.05, 0, PAL.main, { metalness: 0.75 });       // 楔形頭殼(高光澤)
      bxF(h, 0.3 * G, 0.06, 0.05, 0, 0.1, 0.21, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 橫貫面罩感測條
      bxF(h, 0.12, 0.1, 0.16, 0, -0.09, 0.14, PAL.mid);                            // 短下顎塊
      const peak = bxF(h, 0.07, 0.16, 0.04, 0, 0.26, 0.16, PAL.deep);
      peak.rotation.x = -0.3;                                                      // widow's peak 尖突
      for (const sx of [-1, 1]) {
        const sb = bxF(h, 0.04, 0.2, 0.2, sx * 0.19 * G, 0.06, -0.02, PAL.deep);
        sb.rotation.x = -0.35;                                                     // 後掠鬢角板
      }
      const mono = cylF(h, 0.075, 0.075, 0.02, 12, 0.1 * G, 0.1, 0.22, dimF(accent, 0.7), { emissive: accent, emissiveIntensity: 0.4 });
      mono.rotation.x = Math.PI / 2;                                               // 右眼單片眼鏡環
      const crest = bxF(h, 0.05, 0.3, 0.2, 0, 0.32, -0.08, PAL.mid, { metalness: 0.75 });
      crest.rotation.x = 0.5;                                                      // 頭盔中脊後掠尖冠
    },
    chest(c, ch, d) {
      const { PAL, accent, G } = c;
      const top = d.shoulderY, bot = d.waistY;
      bxF(ch, d.shoulderX * 1.7, top - bot + 0.2, 0.72 * G, 0, (top + bot) / 2 + 0.08, 0, PAL.main, { metalness: 0.75 });  // 上寬下收楔胸(烤漆)
      bxF(ch, d.shoulderX * 1.2, 0.1, 0.05, 0, (top + bot) / 2 + 0.2, 0.38 * G, accent, { emissive: accent, emissiveIntensity: 1.1 });  // 識別燈橫條
      const pin = bxF(ch, 0.12, 0.12, 0.05, 0, top - 0.2, 0.4 * G, accent, { emissive: accent, emissiveIntensity: 1.3 });
      pin.rotation.z = Math.PI / 4;                                                // 45° 菱形胸針
      for (const sx of [-1, 1]) {
        const vb = bxF(ch, 0.05, 0.34, 0.04, sx * 0.12, top - 0.32, 0.4 * G, PAL.lite, { metalness: 0.8 });
        vb.rotation.z = sx * 0.5;                                                  // V 形領巾雙斜板
        for (let i = 0; i < 3; i++)
          cylF(ch, 0.028, 0.028, 0.02, 8, sx * 0.1, (top + bot) / 2 - 0.1 - i * 0.16, 0.38 * G, dimF(accent, 0.7)).rotation.x = Math.PI / 2;  // 雙排釦 2×3
        const collar = bxF(ch, 0.13, 0.7, 0.36, sx * 0.28 * G, top + 0.36, -0.2 * G, COAL, { metalness: 0.75 });
        collar.rotation.z = sx * 0.2;                                              // 高豎立領(外黑)
        bxF(collar, 0.04, 0.6, 0.3, -sx * 0.05, 0, 0.02, 0x8a1f2a, { metalness: 0.4 });  // 內襯 accent 紅
      }
      bxF(ch, 0.24, 0.55, 0.3, 0, top + 0.3, -0.3 * G, COAL, { metalness: 0.75 }); // 中央後領片
      const fair = bxF(ch, 0.5 * G, 0.8, 0.1, 0, (top + bot) / 2 + 0.15, -0.42 * G, PAL.mid, { metalness: 0.75 });  // 背脊整流罩(收旋翼桅)
      bxF(fair, 0.06, 0.7, 0.03, 0, 0, -0.06, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 整流罩燈條
      const mast = cylF(ch, 0.035, 0.035, 0.9, 8, 0, (top + bot) / 2 + 0.5, -0.5 * G, GUNMETAL, { metalness: 0.8 });
      mast.rotation.x = -1.2;                                                      // 機首旋翼桅(折收貼背)
      for (const sx of [-1, 1]) {
        const bl = bxF(ch, 0.05, 1.0, 0.02, sx * 0.06, (top + bot) / 2 + 0.2, -0.56 * G, IRON, { metalness: 0.7 });
        bl.rotation.x = -1.25; bl.rotation.z = sx * 0.06;                          // 折收槳葉(長刀狀)
      }
    },
    pelvis(c, hips, d) {
      const { PAL, accent, G } = c;
      bxF(hips, 0.6 * G, 0.3, 0.46 * G, 0, 0.0, 0, PAL.deep, { metalness: 0.7 });  // 窄骨盆
      for (const [ox, w, L] of [[-0.19, 0.22, 0.6], [0.19, 0.22, 0.6], [0, 0.2, 0.7]]) {
        const p = bxF(hips, w * G, L, 0.04, ox * G, -L / 2 + 0.05, -0.26 * G, COAL, { metalness: 0.7 });
        p.rotation.x = 0.14;                                                       // 收攏披風三片裙板
        if (ox === 0) bxF(p, 0.2 * G, 0.05, 0.02, 0, -L / 2 + 0.03, -0.01, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 滾邊
      }
    },
    thigh(c, l, d) {
      const { PAL, G } = c;
      bxF(l, 0.24 * G, d.len * 1.02, 0.28 * G, 0, -d.len * 0.5, 0.01, PAL.main, { metalness: 0.75 });  // 修長直腿(烤漆)
      cylF(l, 0.03, 0.03, 0.28, 8, 0, -d.len * 0.98, 0, COAL, { metalness: 0.7 }).rotation.z = Math.PI / 2;  // 關節細縫環帶
    },
    shin(c, l, d) {
      const { PAL, G, sx } = c;
      cylF(l, 0.09 * G, 0.09 * G, 0.04, 12, sx * 0.13 * G, -0.01, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 膝圓盤蓋
      bxF(l, 0.21 * G, d.len * 1.0, 0.24 * G, 0, -d.len * 0.5, 0.01, PAL.main, { metalness: 0.75 });
      const rot = new THREE.Group();                                               // 小腿後摺收腿旋翼
      rot.position.set(0, -d.len * 0.55, -0.16 * G);
      l.add(rot);
      const m2 = cylF(rot, 0.025, 0.025, 0.4, 6, 0, 0, 0, GUNMETAL, { metalness: 0.8 });
      m2.rotation.x = -0.55;                                                       // 桅(微後傾)
      for (let i = 0; i < 3; i++) {
        const bl = bxF(rot, 0.035, 0.5, 0.015, 0, 0.12, -0.07, IRON, { metalness: 0.7 });
        bl.rotation.x = -0.6; bl.rotation.y = (i - 1) * 0.12;                      // 3 片槳葉收攏貼腿
      }
      bxF(l, 0.045, 0.045, 0.045, sx * 0.12 * G, -d.len * 0.7, -0.1, sx < 0 ? 0xd23b3b : 0x3bd25a, { emissive: sx < 0 ? 0xd23b3b : 0x3bd25a, emissiveIntensity: 0.8 });  // 航行燈左紅右綠
    },
    foot(c, l, d) {
      const { PAL } = c;
      bxF(l, 0.26, 0.14, d.footL * 0.8, 0, -d.clear * 0.55, d.footL * 0.12, PAL.deep);
      const toe = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 8), matF(PAL.main, { metalness: 0.75 }));
      toe.rotation.x = Math.PI / 2;
      toe.position.set(0, -d.clear * 0.6, d.footL * 0.62);
      l.add(toe);                                                                  // 尖頭鞋錐
    },
    armUp(c, a, d) {
      const { PAL, accent, G, sx } = c;
      bxF(a, 0.3 * G, 0.04, 0.36, sx * 0.03, 0.16, 0, PAL.mid, { metalness: 0.8 });  // 平板肩章
      bxF(a, 0.26 * G, 0.03, 0.05, sx * 0.03, 0.19, 0.16, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 肩章飾條
      cylF(a, 0.04, 0.04, 0.03, 8, sx * 0.12 * G, 0.05, -0.1, COAL, { metalness: 0.7 });  // 肩排氣口
      bxF(a, 0.21 * G, d.len * 1.0, 0.24 * G, 0, -d.len * 0.5, 0, PAL.main, { metalness: 0.75 });
    },
    armFore(c, a, d) {
      const { PAL, G } = c;
      bxF(a, 0.19 * G, d.len * 1.0, 0.22 * G, 0, -d.len * 0.5, 0.01, PAL.main, { metalness: 0.75 });
      bxF(a, 0.24 * G, 0.11, 0.28 * G, 0, -d.len * 0.92, 0.01, PAL.lite, { metalness: 0.8 });  // 反折禮服袖口
    },
    mount(c, F) {
      const { PAL, accent, K } = c;
      const REST = 1.35, AIM = { sh: -0.78, el: -0.5 }, AIMA = 1.57 - (AIM.sh + AIM.el);
      // 右手 M134 六管速射艙(輕武器)
      bxF(F.handR, 0.2, 0.22, 0.24, 0, -0.1, 0.02, c.dark);
      const gr = new THREE.Group();
      gr.position.set(0.16, -0.18, 0.24);
      gr.rotation.set(REST, 0, 0.12);
      F.handR.add(gr);
      const ML = 0.95 * K.barrelF;
      bxF(gr, 0.24, 0.4, 0.26, 0, 0.06, 0, PAL.mid, { metalness: 0.75 });          // 機匣
      bxF(gr, 0.1, 0.2, 0.15, 0, -0.18, -0.18, COAL, { metalness: 0.7 });          // 握把
      for (let i = 0; i < 6; i++) {
        const th = i / 6 * Math.PI * 2;
        cylF(gr, 0.032, 0.032, ML, 6, Math.cos(th) * 0.075, 0.3 + ML / 2, Math.sin(th) * 0.075, GUNMETAL, { metalness: 0.85 });  // 六管環列
      }
      for (const t of [0.45, 0.9])
        cylF(gr, 0.11, 0.11, 0.05, 10, 0, 0.3 + ML * t, 0, IRON, { metalness: 0.8 });  // 束管環
      const lMuz = cylF(gr, 0.1, 0.1, 0.05, 10, 0, 0.34 + ML, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 槍口發光環
      bxF(gr, 0.16, 0.24, 0.18, 0.14, 0.1, 0.02, PAL.deep, { metalness: 0.7 });    // 側掛供彈鏈匣
      // 左手地獄火雙聯發射管(重武器)
      bxF(F.handL, 0.2, 0.22, 0.24, 0, -0.1, 0.02, c.dark);
      const gl = new THREE.Group();
      gl.position.set(-0.16, -0.18, 0.24);
      gl.rotation.set(REST, 0, -0.12);
      F.handL.add(gl);
      const HL = 0.9 * K.barrelF;
      bxF(gl, 0.24, HL, 0.32, 0, 0.2 + HL / 2 - 0.2, 0, PAL.mid, { metalness: 0.7 });  // 方形發射器框
      for (const oz of [-0.09, 0.09]) {
        cylF(gl, 0.075, 0.075, HL * 0.95, 8, 0, 0.2 + HL / 2 - 0.2, oz, GUNMETAL, { metalness: 0.8 });  // 上下雙管
        const win = cylF(gl, 0.06, 0.06, 0.04, 8, 0, HL + 0.03, oz, accent, { emissive: accent, emissiveIntensity: 0.9 });
        if (oz > 0) c.hellfireMuz = win;                                           // 管口導引窗
      }
      bxF(gl, 0.09, 0.18, 0.14, 0, -0.06, -0.26, COAL, { metalness: 0.7 });        // 握把
      return {
        gunR: { g: gr, rest: REST, aim: AIMA }, gunL: { g: gl, rest: REST, aim: AIMA },
        muzzles: { light: { n: lMuz, r: 0.1 }, heavy: { n: c.hellfireMuz, r: 0.08 } },
        lightGlowM: [lMuz], heavyGlowM: [c.hellfireMuz], heavyPivot: [],
        weap: { light: 'R', heavy: 'L' },
        hvy: { armL: 0.2, armR: 0.08, chest: 0.06, gun: 0.05 },
        aimPose: { rShoulderX: AIM.sh, rElbowX: AIM.el, lShoulderX: AIM.sh, lShoulderY: 0, lElbowX: AIM.el },
        wpn: { light: { nodes: [gr], ref: gr, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gl], ref: gl, muz: c.hellfireMuz, fwd: 'y' } },
      };
    },
  },

  // ── m05「鎖喉」電戰機(wolf):趾行深屈、狼吻齒列、鬃刺天線、三管旋砲+彈箱 ──
  m05: {
    label: '鎖喉(m05 變形者・地面型)', hue: 0x5551cc,
    prop: { hips: 0.49, legSplay: 0.09, thigh: 0.45, shin: 0.53, shoulderY: 0.76, shoulderX: 0.175, upperArm: 0.17, foreArm: 0.165, head: 0.84, girth: 1.05 },
    gait: { strideF: 1.35, bob: 0.11, sway: 0.08, top: 9, armBase: 0.1, legBase: -0.2 },
    pose: { knee: { base: 0.42, k: 0.62, d: 0.15 }, ankle: { base: -0.26, k: -0.3, d: 0.55 } },   // 趾行深屈
    moveSig: { poise: 0.82, idleF: 0.85, idleA: 0.42, launch: 0.86, spool: 0.22, brake: 0.32, settle: 1.2 },
    castSig: { omni: 'roar', dir: 'swing' },
    doc: [['head', '楔形狼吻+錯咬齒列+怒眉稜+後掠立耳'], ['chest', '胸毛疊瓦板+肩位進氣口+電戰散熱鰭背包'], ['hips', '折收雙垂尾裙甲+三節狼尾配重'], ['leg ×2', '趾行深屈:跟腱桿+三趾爪+後距突(跟不落地)'], ['arm ×2', '肩尖獠刺+圓盤螺栓關節+持槍露爪'], ['hand R', '12.7 三管電磁旋砲(雙線圈環)'], ['hand L', '追債者 2×2 制導彈箱(四發光膛口)']],
    head(c, h) {
      const { PAL, accent, G } = c;
      bxF(h, 0.34 * G, 0.28, 0.36, 0, 0.05, 0, PAL.mid, { metalness: 0.6 });       // 頭殼
      const snout = bxF(h, 0.17 * G, 0.14, 0.34, 0, -0.01, 0.32, PAL.main, { metalness: 0.6 });  // 楔形長吻
      bxF(h, 0.1, 0.08, 0.1, 0, 0.0, 0.5, COAL);                                   // 鼻端
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {                      // 錯咬雙齒列
        bxF(h, 0.025, 0.05, 0.025, sx * (0.05 + i * 0.035), -0.09, 0.3 + i * 0.06, 0xd8d4c8, { metalness: 0.6 });
        bxF(h, 0.02, 0.045, 0.02, sx * (0.04 + i * 0.035), -0.13, 0.33 + i * 0.06, 0xd8d4c8, { metalness: 0.6 });
      }
      bxF(h, 0.26 * G, 0.05, 0.05, 0, 0.1, 0.19, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 面罩感測條
      for (const sx of [-1, 1]) {
        const brow = bxF(h, 0.12, 0.04, 0.1, sx * 0.09 * G, 0.15, 0.17, PAL.deep);
        brow.rotation.z = sx * 0.15; brow.rotation.x = -0.2;                       // 怒眉稜(內高外低)
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 5), matF(PAL.mid, { metalness: 0.6 }));
        ear.position.set(sx * 0.13 * G, 0.26, -0.06);
        ear.rotation.x = -0.5;
        h.add(ear);                                                                // 後掠短立耳
      }
      cylF(h, 0.09, 0.1, 0.1, 10, 0, -0.18, -0.02, IRON, { metalness: 0.7 });      // 頸根關節環(蛇腹)
    },
    chest(c, ch, d) {
      const { PAL, accent, G } = c;
      const top = d.shoulderY, bot = d.waistY;
      bxF(ch, d.shoulderX * 1.6, top - bot + 0.25, 0.85 * G, 0, (top + bot) / 2 + 0.1, 0, PAL.lite, { metalness: 0.6 });  // 銀灰主甲
      bxF(ch, d.shoulderX * 1.15, 0.11, 0.05, 0, top - 0.14, 0.44 * G, accent, { emissive: accent, emissiveIntensity: 1.1 });  // 識別燈
      for (const [w, oy] of [[0.5, -0.28], [0.38, -0.14], [0.27, -0.02]]) {        // 胸毛疊瓦板(大塊,由寬到窄)
        const p = bxF(ch, w * G, 0.16, 0.08, 0, top + oy - 0.3, 0.46 * G, PAL.main, { metalness: 0.55 });
        p.rotation.x = -0.15;
      }
      for (const sx of [-1, 1])
        bxF(ch, 0.14, 0.4, 0.36, sx * (d.shoulderX * 0.8), top + 0.05, 0.05, PAL.deep, { metalness: 0.6 });  // 肩位直立進氣口
      const bp = bxF(ch, 0.6 * G, 0.5, 0.26, 0, top - 0.4, -0.5 * G, PAL.deep, { metalness: 0.6 });  // 電戰背包
      for (const sx of [-1, 1]) for (let i = 0; i < 2; i++)
        bxF(ch, 0.02, 0.4, 0.1, sx * (0.31 * G), top - 0.4, -0.56 * G - i * 0.12, IRON, { metalness: 0.7 });  // 散熱鰭格柵
      for (let i = 0; i < 5; i++) {                                                // 頸背鬃刺天線列(由長到短後掠)
        const L = 0.42 - i * 0.05;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, L, 5), matF(i === 2 ? c.accent : PAL.deep, i === 2 ? { emissive: c.accent, emissiveIntensity: 0.8 } : { metalness: 0.7 }));
        spike.position.set(0, top + 0.15 - i * 0.12, -0.3 * G - i * 0.1);
        spike.rotation.x = -0.9;
        ch.add(spike);
        if (i !== 2) sphF(ch, 0.02, 0, top + 0.15 - i * 0.12 + Math.cos(0.9) * L * 0.5, -0.3 * G - i * 0.1 - Math.sin(0.9) * L * 0.5, c.accent, { emissive: c.accent, emissiveIntensity: 0.9 });  // 刺尖 accent 球
      }
    },
    pelvis(c, hips, d) {
      const { PAL, accent, G } = c;
      bxF(hips, 0.62 * G, 0.3, 0.5 * G, 0, 0.02, 0, PAL.deep, { metalness: 0.6 });
      for (const sx of [-1, 1]) {                                                  // 折收雙垂尾成下背裙甲
        const fin = bxF(hips, 0.04, 0.4, 0.7, sx * 0.2 * G, -0.16, -0.3 * G, PAL.mid, { metalness: 0.6 });
        fin.rotation.x = -1.5; fin.rotation.y = sx * 0.12;
        bxF(fin, 0.03, 0.08, 0.1, 0, 0.18, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 尾梢 accent
      }
    },
    thigh(c, l, d) {
      const { PAL, G, sx } = c;
      bxF(l, 0.32 * G, d.len * 1.02, 0.38 * G, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });  // 靛藍方箱大腿
      cylF(l, 0.1 * G, 0.1 * G, 0.05, 12, sx * 0.18 * G, 0.0, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 髖圓盤+螺栓
      cylF(l, 0.03, 0.03, 0.02, 6, sx * 0.18 * G, 0.0, 0.001, COAL, { metalness: 0.9 }).rotation.z = Math.PI / 2;
    },
    shin(c, l, d) {
      const { PAL, G, sx } = c;
      cylF(l, 0.09 * G, 0.09 * G, 0.05, 12, sx * 0.15 * G, -0.01, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 膝圓盤
      bxF(l, 0.26 * G, d.len * 0.62, 0.3 * G, 0, -d.len * 0.31, 0, PAL.mid, { metalness: 0.6 });   // 小腿 = 雙發機艙段
      bxF(l, 0.22 * G, d.len * 0.45, 0.24 * G, 0, -d.len * 0.76, 0.02, PAL.main, { metalness: 0.6 });  // 長蹠骨段
      cylF(l, 0.05, 0.06, 0.1, 8, 0, -d.len * 0.55, -0.17 * G, COAL, { metalness: 0.8 }).rotation.x = -0.4;  // 足底噴口
      cylF(l, 0.02, 0.02, d.len * 0.4, 6, 0, -d.len * 0.72, -0.13 * G, 0xd8d4c8, { metalness: 0.9 }).rotation.x = -0.06;  // 跟腱桿(下端懸空)
      cylF(l, 0.07, 0.07, 0.06, 10, 0, -d.len * 0.95, 0, IRON, { metalness: 0.7 });  // 踝防塵罩環
    },
    foot(c, l, d) {
      const { PAL } = c;
      bxF(l, 0.26, 0.12, d.footL * 0.9, 0, -d.clear * 0.5, d.footL * 0.25, PAL.deep);  // 長蹠骨足掌(前段觸地)
      for (const ox of [-0.08, 0, 0.08])
        bxF(l, 0.07, 0.07, 0.22, ox, -d.clear * 0.5, d.footL * 0.68, 0xd8d4c8, { metalness: 0.7 });  // 三趾爪
      const dew = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 5), matF(0xd8d4c8, { metalness: 0.7 }));
      dew.position.set(0, -d.clear * 0.3, -d.footL * 0.2);
      dew.rotation.x = -2.6;
      l.add(dew);                                                                  // 後距突 dewclaw(不觸地)
    },
    armUp(c, a, d) {
      const { PAL, G, sx } = c;
      bxF(a, 0.34 * G, 0.3, 0.4 * G, 0, 0.07, 0, PAL.main, { metalness: 0.6 });    // 方形大肩甲
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 5), matF(PAL.deep, { metalness: 0.7 }));
      spike.position.set(sx * 0.2 * G, 0.3, 0);
      spike.rotation.z = sx * 0.5;
      a.add(spike);                                                                // 肩尖獠刺
      bxF(a, 0.2 * G, d.len * 1.0, 0.24 * G, 0, -d.len * 0.5, 0, PAL.mid, { metalness: 0.6 });
    },
    armFore(c, a, d) {
      const { PAL, G, sx } = c;
      cylF(a, 0.08 * G, 0.08 * G, 0.04, 12, sx * 0.12 * G, -0.01, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 肘圓盤
      bxF(a, 0.18 * G, d.len * 1.0, 0.22 * G, 0, -d.len * 0.5, 0.01, PAL.main, { metalness: 0.6 });
    },
    mount(c, F) {
      const { PAL, accent, K } = c;
      const REST = 1.62, AIM = { sh: -0.78, el: -0.5 }, AIMA = 1.57 - (AIM.sh + AIM.el);  // rest 近水平:趾行手位低防戳地
      // 右手三管電磁旋砲(輕武器)+ 露爪
      for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
        bxF(g, 0.2, 0.2, 0.22, 0, -0.09, 0.02, c.dark);
        for (const ox of [-0.07, 0, 0.07])
          bxF(g, 0.05, 0.05, 0.16, ox + sx * 0.02, -0.16, 0.14, 0xd8d4c8, { metalness: 0.7 }).rotation.z = sx * 0.12;  // 握槍仍露三爪
      }
      const gr = new THREE.Group();
      gr.position.set(0.15, -0.16, 0.22);
      gr.rotation.set(REST, 0, 0.1);
      F.handR.add(gr);
      const RL = 1.05 * K.barrelF;
      bxF(gr, 0.2, 0.4, 0.24, 0, 0.05, 0, PAL.mid, { metalness: 0.7 });            // 機匣
      bxF(gr, 0.09, 0.18, 0.14, 0, -0.16, -0.16, COAL, { metalness: 0.7 });        // 握把
      for (let i = 0; i < 3; i++) {
        const th = i / 3 * Math.PI * 2;
        cylF(gr, 0.038, 0.038, RL, 6, Math.cos(th) * 0.06, 0.28 + RL / 2, Math.sin(th) * 0.06, GUNMETAL, { metalness: 0.85 });  // 三管三角環列
      }
      for (const t of [0.4, 0.75])
        cylF(gr, 0.1, 0.1, 0.05, 10, 0, 0.28 + RL * t, 0, accent, { emissive: accent, emissiveIntensity: 0.5 });  // 雙加速線圈環
      const lMuz = cylF(gr, 0.085, 0.085, 0.05, 10, 0, 0.32 + RL, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });
      // 左手追債者 2×2 制導彈箱(重武器)
      const gl = new THREE.Group();
      gl.position.set(-0.15, -0.16, 0.22);
      gl.rotation.set(REST, 0, -0.1);
      F.handL.add(gl);
      const BL2 = 0.7 * K.barrelF;
      bxF(gl, 0.3, BL2, 0.32, 0, 0.1 + BL2 / 2, 0, PAL.mid, { metalness: 0.7 });   // 方箱
      const ports = [];
      for (const ox of [-0.08, 0.08]) for (const oz of [-0.08, 0.08]) {
        const p = cylF(gl, 0.05, 0.05, 0.05, 8, ox, BL2 + 0.12, oz, accent, { emissive: accent, emissiveIntensity: 0.9 });
        ports.push(p);                                                             // 四發光膛口
      }
      bxF(gl, 0.22, 0.07, 0.03, 0, BL2 + 0.05, 0.18, dimF(accent, 0.6), { emissive: accent, emissiveIntensity: 0.4 });  // 鎖定感測條
      bxF(gl, 0.09, 0.16, 0.13, 0, -0.04, -0.2, COAL, { metalness: 0.7 });         // 握把
      return {
        gunR: { g: gr, rest: REST, aim: AIMA }, gunL: { g: gl, rest: REST, aim: AIMA },
        muzzles: { light: { n: lMuz, r: 0.09 }, heavy: { n: ports[0], r: 0.05 } },
        lightGlowM: [lMuz], heavyGlowM: ports, heavyPivot: [],
        weap: { light: 'R', heavy: 'L' },
        hvy: { armL: 0.2, armR: 0.08, chest: 0.05, gun: 0.05 },
        aimPose: { rShoulderX: AIM.sh, rElbowX: AIM.el, lShoulderX: AIM.sh, lShoulderY: 0, lElbowX: AIM.el },
        wpn: { light: { nodes: [gr], ref: gr, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gl], ref: gl, muz: ports[0], fwd: 'y' } },
      };
    },
    extra(c, F, rig) {
      const { PAL } = c;
      const segs = [];                                                             // 三節狼尾配重(尾梢不發光)
      let cur = F.hips, pz = -0.26 * c.G;
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Group();
        t.position.set(0, -0.02, pz);
        t.rotation.x = 0.5;
        cur.add(t);
        const r = 0.06 - i * 0.012;
        cylF(t, r, r * 0.8, 0.4, 7, 0, 0, -0.2, PAL.mid, { metalness: 0.55 }).rotation.x = Math.PI / 2;
        cylF(t, r + 0.02, r + 0.02, 0.04, 7, 0, 0, -0.01, IRON, { metalness: 0.8 }).rotation.x = Math.PI / 2;
        segs.push(t);
        cur = t; pz = -0.4;
      }
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), matF(PAL.deep, { metalness: 0.5 }));
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(0, 0, -0.46);
      cur.add(tip);                                                                // 尾梢毛簇錐(不發光)
      rig.tailSegs = segs;
      rig.tailUp = 0.08;
    },
  },
};

// ══════════ ③ 名冊與規格解析 ══════════
export const FORGE_IDS = ['t01', 't02', 't10', 't12', 't06', 't11', 'm01', 'm05'];

/** 出廠規格(單一真相;specs.json 只放覆寫) */
export const MECH_SPECS = FORGE_IDS.map((id) => {
  const d = MECH_DETAIL[id];
  return {
    id, label: d.label, hue: d.hue,
    height: 6.0,                       // 展示台統一取景高;正式整合走 heroTargetH
    prop: d.prop, gait: d.gait, knobs: { barrelF: 1, accentF: 1 },
    moveSig: d.moveSig, castSig: d.castSig,
  };
});
// 舊介面相容(檢視台/機體台都以 SPECS 列名冊)
export const SPECS = MECH_SPECS;

/** 特徵 → 零件轉換表(逐機;檢視台/機體台顯示用) */
export function conversionDoc(spec) {
  return (MECH_DETAIL[spec.id]?.doc || []).map(([feat, part]) => ({ feat, part }));
}

/**
 * 鍛造一台人形機體:規格 → 具名 Group 零件樹 + 完整 rig 契約。
 * 回傳 { group, rig, joints }。knobs:barrelF 武器長度倍率 / accentF 發光強度倍率。
 */
export function forgeHumanoidMech(spec) {
  const D = MECH_DETAIL[spec.id];
  if (!D) throw new Error(`未知機型:${spec.id}`);
  const P = resolveProp(spec);
  const H = spec.height;
  const PAL = heroPalette({ hue: spec.hue }, 'STEEL', 'light');
  const accent = new THREE.Color(spec.hue);
  const G = P.girth;
  const K = { barrelF: spec.knobs?.barrelF ?? 1, accentF: spec.knobs?.accentF ?? 1 };

  // 人形特徵 → 世界尺寸(公尺)
  const hipY = P.hips * H;
  const thighL = P.thigh * hipY, shinL = P.shin * hipY;
  const clear = Math.max(0.1, hipY - thighL - shinL);
  const legX = P.legSplay * H * Math.max(1, G * 0.9);
  const shoulderY = P.shoulderY * H, shoulderX = P.shoulderX * H * Math.max(1, G * 0.9);
  const upperArmL = P.upperArm * H, foreArmL = P.foreArm * H;
  const headY = P.head * H;
  const waistYl = 0.12 * H, shoulderYl = shoulderY - hipY, headYl = headY - hipY;

  const g = new THREE.Group();
  const legChainL = [], legChainR = [], armChainL = [], armChainR = [];
  const joints = new THREE.Group();
  joints.visible = false;
  g.add(joints);
  const jointDot = (x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, depthTest: false }));
    m.userData.noOutline = true;
    m.renderOrder = 5;
    m.position.set(x, y, z);
    joints.add(m);
  };

  const baseCtx = { PAL, accent, G, H, K, dark: PAL.dark, binderPivots: [], vlsPorts: [], dims: { shoulderYl, waistYl, shoulderX } };
  const pose = D.pose || {};
  const knee = pose.knee || { base: 0.06, k: 0.62, d: 0.15 };
  const ankle = pose.ankle || { base: 0.02, k: -0.3, d: 0.55 };
  const elbow = pose.elbow || { base: -0.18, k: -0.5, d: 0.3 };
  const wrist = pose.wrist || { base: 0, k: 0.22, d: 0.65 };

  // ---- 下肢(腿掛 g 不掛 hips:骨盆浮沉不帶腿 = 不滑步)----
  const footL = 0.3 + 0.22 * G;
  const mkLeg = (sx) => segLimbF(g, [sx * legX, hipY, 0], [
    { len: thighL, draw: (l) => D.thigh({ ...baseCtx, sx }, l, { len: thighL }) },
    { len: shinL, base: knee.base, k: knee.k, d: knee.d, draw: (l) => D.shin({ ...baseCtx, sx }, l, { len: shinL }) },
    { len: 0, base: ankle.base, k: ankle.k, d: ankle.d, draw: (l) => D.foot({ ...baseCtx, sx }, l, { clear, footL }) },
  ], sx < 0 ? legChainL : legChainR);
  const legL = mkLeg(-1), legR = mkLeg(1);
  jointDot(-legX, hipY, 0); jointDot(legX, hipY, 0);
  jointDot(-legX, hipY - thighL, 0); jointDot(legX, hipY - thighL, 0);
  jointDot(-legX, hipY - thighL - shinL, 0); jointDot(legX, hipY - thighL - shinL, 0);

  // ---- 軀幹三節:hips → chest → head ----
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  D.pelvis(baseCtx, hips, { shoulderX });
  const chest = new THREE.Group();
  hips.add(chest);
  D.chest(baseCtx, chest, { shoulderX, shoulderY: shoulderYl, waistY: waistYl });
  const head = new THREE.Group();
  head.position.set(0, headYl, 0.04);
  chest.add(head);
  D.head(baseCtx, head);
  jointDot(0, hipY, 0); jointDot(0, shoulderY, 0); jointDot(0, headY, 0.04);

  // ---- 上肢 ----
  let handL = null, handR = null, foreL = null, foreR = null;
  const mkArm = (sx) => segLimbF(chest, [sx * shoulderX, shoulderYl, 0], [
    { len: upperArmL, draw: (a) => D.armUp({ ...baseCtx, sx }, a, { len: upperArmL }) },
    { len: foreArmL, base: elbow.base, k: elbow.k, d: elbow.d, draw: (a) => { D.armFore({ ...baseCtx, sx }, a, { len: foreArmL }); if (sx < 0) foreL = a; else foreR = a; } },
    { len: 0, base: wrist.base, k: wrist.k, d: wrist.d, draw: (a) => { if (sx < 0) handL = a; else handR = a; } },
  ], sx < 0 ? armChainL : armChainR);
  const armL = mkArm(-1), armR = mkArm(1);
  jointDot(-shoulderX, shoulderY, 0); jointDot(shoulderX, shoulderY, 0);
  jointDot(-shoulderX, shoulderY - upperArmL, 0); jointDot(shoulderX, shoulderY - upperArmL, 0);
  jointDot(-shoulderX, shoulderY - upperArmL - foreArmL, 0); jointDot(shoulderX, shoulderY - upperArmL - foreArmL, 0);

  // ---- 武裝(逐機掛法)----
  const F = { g, hips, chest, head, handL, handR, foreL, foreR };
  const W = D.mount(baseCtx, F);

  // ---- rig 契約 ----
  const stride = (thighL + shinL) * spec.gait.strideF * 2;
  const rig = g.userData.rig = {
    kind: 'biped',
    hips, chest, head, legL, legR, armL, armR,
    legChainL, legChainR, armChainL, armChainR,
    hipsY0: hipY, headY0: headYl,
    stride, bob: spec.gait.bob, sway: spec.gait.sway, top: spec.gait.top,
    legBase: spec.gait.legBase || 0, armBase: spec.gait.armBase,
    gunArm: W.gunR ? 1 : 0,
    knuckle: D.knuckle ? 1 : 0,
    aimPose: W.aimPose,
    weap: W.weap, hvy: W.hvy,
    gunR: W.gunR, gunL: W.gunL,
    muzzles: W.muzzles,
    wpn: W.wpn,
    kickAmp: { light: 1, heavy: 1.3 },
    moveSig: spec.moveSig, castSig: spec.castSig,
    s: 1,
  };
  if (D.extra) D.extra(baseCtx, F, Object.assign(rig, { heavy: { glow: [], pivot: [] } }));

  // 發光強度旋鈕:整棵樹的 emissiveIntensity ×accentF(在記錄 glow base 之前套用)
  if (K.accentF !== 1) g.traverse((o) => {
    if (o.isMesh && o.material?.emissiveIntensity) o.material.emissiveIntensity *= K.accentF;
  });
  rig.lightGlow = (W.lightGlowM || []).map((m) => ({ mesh: m, base: m.material.emissiveIntensity }));
  const hg = (W.heavyGlowM || []).map((m) => ({ mesh: m, base: m.material.emissiveIntensity }));
  rig.heavy = rig.heavy && rig.heavy.glow.length
    ? { glow: [...rig.heavy.glow, ...hg], pivot: W.heavyPivot || [] }
    : { glow: hg, pivot: W.heavyPivot || [] };

  outlinify(g, outlineWF(H));
  return { group: g, rig, joints };
}
