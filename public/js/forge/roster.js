// ============ 機體台名冊與原型分類(單一縫;dev-only)============
// 2026-08-12 使用者指示(第四輪):「機體展示台從人形機體擴充到所有機體,根據不同的原型
// 切換管理頁面,飛機/無人機這類有現實機體原型的歸在同一類」。
//
// **分類 MUST 推導,MUST NOT 手寫名冊** —— 判據全部取自既有的縫:
//   `charKind()`(data.js,32 名角色顯式標註)+ `CHARACTERS[].visual` + `MORPH_HUMANOID`。
// 手寫一份「哪台是人形」的清單的下場與 CLAUDE.md A33 ⑤ 同型:換陣營/改 visual 時清單靜默過期,
// 而畫面上只表現成「這台機體跑到別的分頁去了」,沒有任何錯誤訊息。
//
// ---- 一台機體可以有兩個「原型」----
// 變形者(morph)的地面型與飛行型是**兩個不同原型**(t06:齊天大聖 ↔ 察打一體無人機),
// 逐型態各自建模、各自對照自己的 2D 定案圖 ⇒ 名冊的單位是 **(機體, 型態)** 而不是機體。
// 這也正是使用者那句「飛機/無人機這類有現實機體原型的歸在同一類」的落點:變形者的飛行型
// 與 12 台純無人機共用同一套航空鷹架與同一個管理頁,而它的地面型待在人形/仿生頁。
//
// 名冊鍵 = `id` 或 `id@form`(form ∈ ground/flight)—— 覆寫層 specs.json、截圖檔名、
// 兩座看板的 URL 片段全部吃這一個字串,MUST NOT 任一端自己用 `${id}_${form}` 另拼一份。
//
// 本檔**零 three**:離線工具(fetch_protorefs / 稽核)與瀏覽器同吃這一份分類。
// import 路徑刻意寫**相對**(不是 `/public/js/…`):相對路徑在瀏覽器解析出來的絕對 URL
// 與其它 forge 檔的絕對寫法逐字相同(⇒ 同一個模組實例,不踩 A28 的「data.js 變兩份」),
// 而 Node 端(fetch_protorefs.mjs)只有相對路徑載得動 —— 兩端同吃一份分類的前提就是這個。

import { CHARACTERS, charKind, MORPH_HUMANOID } from '../data.js';
import { protoLayers, PROTO_LAYERS, mechaCodex, charCodex } from '../codex.js';
import { MECHA } from '../mecha.js';
import { LORE } from '../lore.js';

/** 三類管理頁。scaffold = 鍛造鷹架(forge.js 依此分流);proto = 這一類的原型層鍵。 */
export const CATS = [
  { key: 'humanoid', label: '人形機甲', scaffold: 'biped',
    tip: '人形特徵(VRM 標準骨)→ 機器人零件;比例滑桿可調' },
  { key: 'bionic', label: '仿生機體', scaffold: 'beast',
    tip: '動物原型 → 四足/獸型雙足骨架;比例住逐機 frame' },
  { key: 'airframe', label: '航空機體', scaffold: 'air',
    tip: '現實機型原型(旋翼機/定翼機/撲翼)→ 飛行骨架;無人機與變形者飛行型同頁' },
];
export const CAT_KEYS = CATS.map((c) => c.key);
export const catOf = (key) => CATS.find((c) => c.key === key) || null;

/** 型態標籤(名冊鍵的後綴;null = 這台只有一個型態) */
export const FORM_LABEL = { ground: '地面型', flight: '飛行型' };

export const entryKey = (id, form) => (form ? `${id}@${form}` : id);
export const splitKey = (key) => {
  const i = String(key).indexOf('@');
  return i < 0 ? { id: key, form: null } : { id: key.slice(0, i), form: key.slice(i + 1) };
};

/**
 * 逐 (機體, 型態) 推導分類。回傳 null = 這個型態不存在。
 *   drone            → airframe(12 台;`form:'avian'` 的仿生無人機仍是航空機 —— 使用者
 *                      那句話講的是「有現實機體原型的歸在同一類」,蜜蜂/翼龍是它的仿生層)
 *   robot + proto    → humanoid(t01/t02/t10/t12:visual.proto = 人形機體原型代號)
 *   robot + creature → bionic  (四足 form:'beast' / 獸型雙足 form:'biped')
 *   morph ground     → MORPH_HUMANOID 決定落 humanoid 還是 bionic(唯一真相在 data.js)
 *   morph flight     → airframe
 */
export function catFor(id, form = null) {
  const kind = charKind(id);
  const vis = CHARACTERS[id]?.visual || {};
  if (kind === 'drone') return form ? null : 'airframe';
  if (kind === 'robot') return form ? null : (vis.creature ? 'bionic' : 'humanoid');
  if (kind !== 'morph') return null;
  if (form === 'flight') return 'airframe';
  if (form === 'ground') return MORPH_HUMANOID.has(vis.ground) ? 'humanoid' : 'bionic';
  return null;   // 變形者沒有「無型態」的格子
}

/** 這台機體有哪些型態(變形者兩個、其餘一個 null) */
export const formsOf = (id) => (charKind(id) === 'morph' ? ['ground', 'flight'] : [null]);

/**
 * 這一格的原型出處(顯示 + 原型參考圖的查詢關鍵詞來源)。
 * 取自 `MECHA[id].proto` 的**對應層**,層集由 codex.js `protoLayers()` 推導 ——
 * MUST NOT 在這裡另判「這台該看哪一層」(那是 codex.js 的欄位表,見 A40 ③)。
 *   人形 → frame(機體原型)  仿生 → bionic/ground  航空 → air/frame
 * 恆補上 `real`(設計原型;PROTO_LAYERS 裡 `from: null` 那一層,每台都有)。
 */
export function protoRefsOf(id, form = null) {
  const have = new Set(protoLayers(id));
  const P = MECHA[id]?.proto || {};
  const cat = catFor(id, form);
  // 航空類仍收 `bionic`:仿生無人機(蜜蜂/翼龍/機械龍/鷹)的生物原型是它真正的外型依據,
  // 「歸在同一類」講的是管理頁,不是把它的仿生層丟掉。
  const want = cat === 'airframe' ? ['air', 'frame', 'bionic', 'real']
    : cat === 'bionic' ? ['ground', 'bionic', 'real']
      : ['ground', 'frame', 'bionic', 'real'];
  const out = [];
  for (const k of want) {
    if (!have.has(k) || !P[k]?.src) continue;
    if (out.some((o) => o.key === k)) continue;
    out.push({ key: k, label: PROTO_LAYERS.find((L) => L.key === k)?.label || k,
      src: P[k].src, note: P[k].note || '' });
  }
  return out;
}

/**
 * 這一格的**駕駛員關係**(機體 ⇄ 角色)。
 * 2026-08-12 使用者:「機體台中,機體與角色的關係還沒更新」—— 機體台原本只印機體暱稱與
 * 一個裸的角色 id(`t01`),而「這台是誰在開、他跟這台機體是什麼關係」整組不在畫面上;
 * 同一份東西在覆核台 :8641 是右欄的主體。兩座看板看的是同一件事的兩個角度,MUST 說同一句話。
 *
 * **每一欄都到原處取**(A40 ⑤:全高/機體名/主色/機種/陣營 MUST 到原處取):
 *   機體名/代號/陣營/機種/駕駛員 ← `mechaCodex().ident`(codex.js 的識別段)
 *   全高                          ← `mechaCodex().scaleM`(= `heroTargetH`,隨護甲內插)
 *   羈絆(機體與駕駛的關係)      ← `mechaCodex().deep.bond`(內容住 lore.js)
 *   呼號                          ← `charCodex().ident.code`
 *   國籍/職務/台詞                ← `LORE`
 * 這裡 MUST NOT 出現任何手寫的字串:mechs/*.js 的 `label` 是**建模註記**(「t01 重機甲」),
 * 拿它當機體名 = 同一台機體在名冊鈕與抬頭上叫兩個名字,而換陣營/改 machine 時只有一邊會跟著改。
 */
export function pilotOf(id) {
  const mc = mechaCodex(id);
  if (!mc) return null;
  const lo = LORE[id] || {};
  return {
    id,
    name: mc.ident.pilot,
    callsign: charCodex(id)?.ident.code || '',
    sideName: mc.ident.side,
    kindWord: mc.ident.kind,
    code: mc.ident.code,
    machine: mc.ident.name,
    heightM: mc.scaleM,
    nat: lo.nat || '',
    role: lo.role || '',
    quote: lo.quote || '',
    bond: mc.deep?.bond || '',
  };
}

/**
 * 這一格的**塗裝取值**(主色 / 陣營 / 色版階)—— 機體台與遊戲本體 MUST 讀出同一組。
 *
 * 2026-08-14 使用者:「遊戲中角色與機體的配對曾更動,機體台先修正到正確的配對關係」。
 * 病灶:主色原本手寫在 `mechs/<key>.js` 的 `hue:` 那一格,而主色是**角色**的屬性
 * (`CHARACTERS[id].visual.hue`)—— 換角色/改色時機體台留在舊值,實測 12 台漂掉
 * (t02 機體台粉紅 vs 遊戲淡藍最誇張)。同一族的另外兩格也是手寫的:陣營一律寫死
 * 'STEEL'(蜂群 12 台全部拿到鋼鐵色版),色版階一律寫死 'light'(遊戲只有人形機甲與
 * 獸型雙足是 light)。三格全部改成從**原處**取,機體檔從此不准再宣告主色。
 *
 * 色版階的判準鏡射 models.js 的 `heroPalette(vis, side, tier)` 呼叫點:
 *   buildRobotMech light / buildBipedBeast light
 *   buildBeastMech dark / buildDrone / buildFixedWing
 *   buildAvianDrone / buildMorphMech 一律 dark
 * ⇒ light ⟺ 機種是 robot 且不是四足獸型(`visual.form === 'beast'`)。
 *
 * 2026-08-14 使用者追加:「徽記/塗鴉/紋路等特徵也要渲染,例如零式的雙翼上下都要印紅日」。
 * ⇒ 連 `vis`(整份 `CHARACTERS[id].visual`)一起交出去,鷹架收尾時轉呼遊戲本體的
 * `paint.paintUnit(root, vis, side, tone)` —— 花紋/國旗/徽記/貼花**只有那一份實作**,
 * 機體台 MUST NOT 自己畫一套(逐機硬編的貼花會在改 `visual.paint` 時靜默過期)。
 * `vis` MUST 是整份而不是挑幾欄:`split` 走 `paintAxisSplit(root, inv, vis)` 讀的是
 * 機種/原型欄位(人馬上下 / 狼人左右 / 獵鷹前後),挑欄位交出去就會挑錯軸。
 */
export function paintOf(id) {
  const c = CHARACTERS[id] || {};
  const vis = c.visual || {};
  const light = charKind(id) === 'robot' && vis.form !== 'beast';
  return { hue: vis.hue ?? 0xffffff, side: c.side || 'STEEL', tier: light ? 'light' : 'dark', vis };
}

/** 全名冊(逐格 = 一個管理頁項目);順序 = CHARACTERS 宣告序 × 型態序 */
export function rosterEntries() {
  const out = [];
  for (const id of Object.keys(CHARACTERS)) {
    for (const form of formsOf(id)) {
      const cat = catFor(id, form);
      if (!cat) continue;
      const c = CHARACTERS[id];
      out.push({
        key: entryKey(id, form), id, form, cat,
        label: c.machine || id,
        formLabel: form ? FORM_LABEL[form] : '',
        code: MECHA[id]?.code || '',
        side: c.side, hue: c.visual?.hue ?? 0xffffff, paint: paintOf(id),
        pilot: pilotOf(id),
        protos: protoRefsOf(id, form),
      });
    }
  }
  return out;
}

/** 逐類分組(看板分頁直接吃) */
export function rosterByCat() {
  const all = rosterEntries();
  return CATS.map((c) => ({ ...c, entries: all.filter((e) => e.cat === c.key) }));
}
