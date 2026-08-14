// ============ 機體展示台檢視器(dev-only;不進遊戲)============
// 驗證兩件事:
//   ① 全角度完整 —— 鍛造出來的機體是 360° 實心零件樹(軌道鏡頭 + 自動環繞檢視);
//   ② 可動態移動 —— rig 契約齊全,真品 locomotion.js(stepBiped / stepQuad / stepAerial /
//      stepCombatFx / stepCastPose)一行不改直接驅動。
// 驅動方式鏡射 charPreview.js 的跑步機:機體固定原點、地面反向捲動,
// stepLocomotion 以「假位移」(0, -speed*dt, 0) 量到真實速度 —— 與戰場同一套演算。
//
// 2026-08-12 使用者第四輪:「機體展示台從人形機體擴充到所有機體,根據不同的原型切換管理
// 頁面;武器與機體獨立展示編輯,但加入跳轉連結。」本檔因此有三件新事:
//   ① **分類分頁**:名冊與分類全部取自 roster.js(推導,零手寫清單);缺 mechs/ 檔的格子
//      仍列出來但標「未建模」—— 藏起來的話「還有幾台沒做」就沒有地方看得到。
//   ② **武器獨立檢視**:武器不是另外一棵樹,而是同一棵樹的 `rig.wpn[slot].nodes` 子集
//      (那是 FPV 同源的既有單一縫)。切到武器頁 = 只顯示那個子集 + 依它的包圍盒重新取景,
//      MUST NOT 為了武器台另建一份武器幾何(第二份實作 ⇒ 台上調好的與機體上掛的不是同一把)。
//   ③ **原型參考圖**:2D 定案圖(/api/protoimgs)與真實原型照片(/api/protorefs)並列;
//      兩份名冊都由伺服器端目錄/帳本推導,MUST NOT 在這裡拼檔名。
//
// 旋翼自轉:名冊只有 `unit.spin`(= 戰場 game.js spinners 吃的 `userData.spin` 那一份),
// 展示台每幀推進同一份清單 —— MUST NOT 自己 traverse 場景找槳葉(那就是第二份名冊)。
//
// 2026-08-14 使用者:「機體台的新版展示台 UI 要跟舊版一樣,可以看變形過程,以後擴充不同
// 版本時都用同一套展示台」+「機體鍛造的建模展示**直接套用**展示台」。
// ⇒ **場景與演出整組住 `stage.js`**(兩座看板共用的那一座),版本住 `versions.js`。
// 本檔從此只是它的**宿主**:名冊欄 / 分頁資訊欄 / 覆核標記 / 參考圖帶 / 紙娃娃面板,
// 一行 three、一行版本分支都沒有。

import { SPECS, conversionDoc, resolveProp, HUMANOID } from '../../public/js/forge/forge.js';
import { CATS, catOf, rosterByCat, splitKey, FORM_LABEL } from '../../public/js/forge/roster.js';
import { makeStage } from './stage.js';
import { makeDollEditor } from './dolledit.js';
import {
  fetchArt, fetchRefs, dropRefsCache, artStripHTML, refStripHTML, bindRefStrip,
} from './refstrip.js';
// 頭像路徑只有 portraits.js 一份(手繪在冊就回檔案、不在冊回程序生成的 data URI)。
// 回傳值是**相對 public/ 的路徑** —— 遊戲頁面的根就是 public/,而本台的根是儲存庫根,
// 故消費端補前綴;MUST NOT 在這裡另寫一份 `assets/avatars/${id}.png`(換成手繪/退回生成
// 都會靜默分家)。
import { avatarURL } from '/public/js/portraits.js';

// 使用者調整覆寫層(specs.json;/api/forge 讀寫)—— 合併只走 mergeSpec 單一縫。
// 2026-08-12 第五輪起本台**可寫**(紙娃娃編輯器存 `doll` 那一欄);比例滑桿仍住覆核台,
// 兩邊寫的是同一份檔、同一個路由,而且是**逐欄**寫入(見 specstore.mjs 的 patch 語意)。
let OVR = {};
try {
  const r = await fetch('/api/forge');
  if (r.ok) OVR = (await r.json()).mechs || {};
} catch { /* 沒有覆寫檔 = 全走出廠規格 */ }
async function saveOvr(id, patch) {
  const r = await fetch('/api/forge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, ovr: patch }),
  });
  return (await r.json()).mechs || {};
}

// ---- 狀態 ----
const ROSTER = rosterByCat();
/** 右欄分頁(標記 = 覆核意見 + 紙娃娃;它同時就是編輯模式的開關,見 setTab) */
const PANEL_TABS = [['data', '資料'], ['ref', '參考圖'], ['rig', '結構'], ['mark', '標記']];
let cat = CATS[0].key;              // 目前管理頁
let tab = 'data';                   // 右欄分頁
let spec = SPECS[0];
let draftDoll = null;               // 紙娃娃草稿(尚未存檔的那一份;null = 照已存檔的走)
let editor = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
/** 程序生成的頭像回的是 data URI(已是完整 URL),手繪的是相對 public/ 的路徑 */
const avatarSrc = (id) => {
  const u = avatarURL(id);
  return /^(data:|https?:|\/)/.test(u) ? u : `/public/${u}`;
};
/** 機體名恆取 data.js 那一份(spec.label 是建模註記,見 forge.js MECH_SPECS 的欄位說明) */
const mechName = (s) => s.pilot?.machine || s.label;

// ---- 展示台(兩座看板共用的那一座;場景/演出/版本/型態全住 stage.js)-------------
// 本檔只給它三樣東西:覆寫層查詢、重鍛後要重畫哪一塊、以及「型態鈕按下去 = 換名冊那一格」。
const stage = makeStage({
  ovrOf: (id) => OVR[id],
  onBuild: () => renderPanel(),
});

function setSpec(s) {
  spec = s;
  cat = s.cat;
  draftDoll = OVR[s.id]?.doll || null;
  stage.setSpec(s, draftDoll);
  editor?.load(draftDoll);
  renderCatButtons();
  renderRail();
  renderPanel();
}

// ---- UI ----------------------------------------------------------------------
// 名冊欄:分類鈕(逐類進度)+ 逐列一格。
// 一列 = 一個 (機體, 型態):頭像 / 機體名 / 駕駛員 / 型態 / 覆核標記,一眼掃得到「誰開哪一台、
// 哪幾台我看過了」。改版前這是頂部一整排 20 顆寬鈕 —— 掃不到人,還吃掉整個畫面上緣。
function renderCatButtons() {
  const box = $('catSeg');
  box.innerHTML = '';
  for (const c of ROSTER) {
    const done = c.entries.filter((e) => SPECS.some((s) => s.id === e.key)).length;
    const b = document.createElement('button');
    b.className = 'segb' + (c.key === cat ? ' on' : '');
    b.innerHTML = `${c.label} <span class="fm">${done}/${c.entries.length}</span>`;
    b.title = c.tip;
    b.onclick = () => {
      cat = c.key;
      const first = SPECS.find((s) => s.cat === cat);
      if (first) setSpec(first); else { renderCatButtons(); renderRail(); }
    };
    box.appendChild(b);
  }
  const done = SPECS.length, all = ROSTER.reduce((n, c) => n + c.entries.length, 0);
  $('hdCount').textContent = `已建模 ${done}/${all} 格 ・ 已覆核 ${markedN()}/${done}`;
}

function renderRail() {
  const box = $('railList');
  box.innerHTML = '';
  const group = ROSTER.find((c) => c.key === cat);
  const h = document.createElement('div');
  h.className = 'rl-h';
  h.textContent = `${group.label} ・ ${group.tip}`;
  box.appendChild(h);
  for (const e of group.entries) {
    const s = SPECS.find((x) => x.id === e.key);
    const pl = e.pilot;
    const b = document.createElement('button');
    b.className = 'rl' + (s ? (s === spec ? ' on' : '') : ' missing');
    const form = e.form ? ` <span class="fm">${e.formLabel}</span>` : '';
    b.innerHTML = `<img src="${esc(avatarSrc(e.id))}" alt="">
      <span class="rl-txt">
        <span class="rl-m">${esc(pl?.machine || e.label)}${form}${s ? '' : ' <span class="fm">未建模</span>'}</span>
        <span class="rl-p">${esc(e.id)} ・ ${esc(pl?.name || '')}</span>
      </span>
      <span class="rl-mk">${s ? markIcon(e.key) : ''}</span>`;
    if (pl) b.title = `${pl.code} ${pl.machine}\n駕駛員「${pl.callsign}」${pl.name}`
      + ` ・ ${pl.sideName} ・ ${pl.kindWord} ・ 全高 ${pl.heightM.toFixed(2)} m`;
    if (s) b.onclick = () => setSpec(s); else b.disabled = true;
    box.appendChild(b);
  }
}

// ---- 覆核意見標記 --------------------------------------------------------------
// 2026-08-12 使用者第六輪:「以可讀性、**易於標記**為主」。標記有兩種,這裡是「這一台我看
// 過了沒、有沒有意見」那一種(另一種是紙娃娃的零件標記,住 dolledit.js)。
//
// 三條:
//   ① **存在既有的覆寫層**(specs.json 的同一格,欄位 `review`)—— 那支 patch 是逐欄的
//      (specstore.mjs 檔頭),多一欄不會洗掉紙娃娃;另開第二本帳就是第二套存檔語意。
//   ② 字彙只有 `MARK_STATUS` 一份:鈕面、名冊徽章、頁首計數全部由它推導,
//      MUST NOT 任一處自己寫 '✔'/'✎'(加第四個判決時會有地方靜默過期)。
//   ③ 意見是**逐格**的(名冊鍵),不是逐角色 —— 變形者兩個型態各自看、各自標。
export const MARK_STATUS = [
  { key: 'ok', icon: '✔', label: '已確認', tip: '這一格看過了,可以出貨' },
  { key: 'fix', icon: '✎', label: '待修', tip: '有意見:形狀/比例/零件要改' },
  { key: 'ref', icon: '◔', label: '缺參考', tip: '缺 2D 定案圖或原型照,先別動手' },
];
const markOf = (key) => OVR[key]?.review || null;
const markDef = (st) => MARK_STATUS.find((m) => m.key === st) || null;
const markIcon = (key) => {
  const d = markDef(markOf(key)?.status);
  return d ? `<span title="${esc(d.label)}">${d.icon}</span>` : '';
};
const markedN = () => SPECS.filter((s) => markOf(s.id)).length;

/** 寫一筆意見(status 為 null = 清掉這一格的意見)。時間戳只為了「這句話是什麼時候寫的」。 */
async function saveMark(status, note) {
  const review = status || note
    ? { status: status || null, note: note || '', at: new Date().toISOString().slice(0, 16).replace('T', ' ') }
    : null;
  OVR = await saveOvr(spec.id, { review });
  renderCatButtons();
  renderRail();
  renderPanel();
}

// ---- 2D 定案圖 / 原型參考照 ----------------------------------------------------
// 標記與名冊取得整組住 refstrip.js(2026-08-12 第五輪:覆核台也要這兩帶)——
// 兩座看板 MUST 是同一份標記 + 同一份 CSS(board.css),各寫一份就會各自演化。
// 這裡只剩「這一格要看哪幾張」:變形者只列**本型態**那幾張(飛行型的頁面不該拿地面型的
// 圖當建模依據),以及「面板已換機就別把上一台的圖畫進去」那道時序閘。
async function fillArtStrip(forId) {
  const box = $('artStrip');
  if (!box) return;
  const j = await fetchArt(spec.ch);
  if (spec.id !== forId || !$('artStrip')) return;             // 面板已換機
  const want = spec.form === 'flight' ? '_flight_' : spec.form === 'ground' ? '_ground_' : null;
  box.innerHTML = artStripHTML((j.imgs || []).filter((m) => !want || m.file.includes(want)));
}
async function fillRefStrip(forId, fresh = false) {
  const box = $('refStrip');
  if (!box) return;
  if (fresh) dropRefsCache(spec.id);          // 剛改過帳本 ⇒ 快取那一份已經是舊的
  const j = await fetchRefs(spec.id);
  if (spec.id !== forId || !$('refStrip')) return;
  box.innerHTML = refStripHTML(j.layers || [], spec.id);
  // 判決/註解/重搜/自己貼的行為也住 refstrip.js(標記與行為同一份 —— 兩座看板各綁一份的話,
  // 其中一座遲早少一個 dropRefsCache,而症狀是「我標了它還在」)
  bindRefStrip(box, spec.id, () => fillRefStrip(spec.id, true));
}

/**
 * 抬頭:**機體 ⇄ 角色**(2026-08-12 使用者:「機體台中,機體與角色的關係還沒更新」)。
 * 這一台是誰在開、他跟這台機體是什麼關係(`bond`)—— 那是建模時最該看見的一段設定,
 * 原本只在覆核台 :8641 有,機體台這邊只印一個裸的 `t01`。
 *
 * 三條:
 *   ① 每一欄都到原處取(roster.pilotOf 單一縫)—— 這裡 MUST NOT 出現任何手寫的姓名/陣營/
 *      機種/公尺數,也 MUST NOT 拿 `spec.label`(建模註記)當機體名。
 *   ② **全高與取景高分開印**:`pilot.heightM` 是遊戲裡的真實全高(heroTargetH,隨護甲內插),
 *      `spec.height` 只是展示台的統一取景高 —— 兩個數字併成一個就會有人拿取景高去改機體比例。
 *   ③ 頭像取 portraits.js 的 `avatarURL`(手繪不在冊時自動退回程序生成,不會留破圖)。
 */
function pilotHTML(spec) {
  const p = spec.pilot;
  const form = spec.form ? `・${FORM_LABEL[spec.form]}` : '';
  if (!p) {   // 理論上不會發生(名冊由 CHARACTERS 推導);缺了要看得出來,MUST NOT 靜默留白
    return `<h3>${esc(spec.label)} <small>${esc(spec.ch)}${form}</small></h3>
      <div class="note">(查不到這一格的駕駛員 —— data.js / mecha.js 對不上)</div>`;
  }
  return `
    <h3>「${esc(p.code)}」${esc(p.machine)}
      <small>${esc(catOf(spec.cat)?.label || spec.cat)}${form}</small></h3>
    <div class="pilot">
      <!-- 一張 54px 的頭像刻意不 lazy:pane 不合成時 lazy 影像永遠不觸發,
           headless 檢視看到的會是一格空白(而 HTTP 上那張圖是 200) -->
      <img src="${esc(avatarSrc(spec.ch))}" alt="">
      <div>
        <div class="pl-name">「${esc(p.callsign)}」${esc(p.name)}
          <span class="dim">${esc(spec.ch)}</span></div>
        <div class="pl-line">${esc(p.sideName)} ・ ${esc(p.kindWord)} ・ 全高 ${p.heightM.toFixed(2)} m</div>
        <div class="pl-line dim">${esc(p.nat)} ・ ${esc(p.role)}</div>
      </div>
    </div>
    ${p.quote ? `<div class="pl-quote">「${esc(p.quote)}」</div>` : ''}
    ${p.bond ? `<h4>機體與駕駛的關係(lore.js bond ・ 建模設定依據)</h4>
      <div class="pl-bond">${esc(p.bond)}</div>` : ''}
    <div class="note">建模鷹架 ${esc(spec.kind)} ・ 展示台取景高 ${spec.height} m
      (不是機體全高)・ 名冊鍵 ${esc(spec.id)}</div>`;
}

function renderPanel() {
  const quad = spec.kind === 'quad', air = spec.kind === 'air';
  const p = resolveProp(spec);
  const rows = conversionDoc(spec)
    .map((r) => `<tr><td>${esc(r.feat)}</td><td>${esc(r.part)}</td></tr>`).join('');
  const propRows = Object.keys(HUMANOID)
    .map((k) => {
      const ovr = spec.prop?.[k] != null;
      return `<tr class="${ovr ? 'ovr' : ''}"><td>${k}</td><td>${p[k]}</td><td>${HUMANOID[k].vrm}</td></tr>`;
    }).join('');
  // rig 契約檢查驗的是**那個版本自己的**契約(新版的契約拿去驗退役的舊建構器一定對不上:
  // 舊 morph 是單樹 rig.pose、舊 biped 沒有 legChainL/R —— 那不是「舊版壞了」,是兩份契約
  // 本來就不同)⇒ 印哪幾條由版本表回答,本檔只負責畫。
  const chan = stage.ver.rigLines(stage.unit, spec)
    .map(([n, ok]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${n}</li>`).join('');

  // 四個分頁的內容。**武器檢視的入口只在舞台工具列**:改版前這裡還有一組文字跳轉
  // (→檢視輕武器 / ←回到機體),與工具列那組是同一個功能的第二份入口 —— 兩邊要各自
  // 維護選取態,而它們遲早會說出不一樣的話(使用者第六輪:「整併重複的資訊與功能」)。
  const body = {
    data: () => pilotHTML(spec),
    ref: () => `
      <h4>2D 定案圖(建模設計權威;點圖開大圖)</h4>
      <div id="artStrip" class="proto-strip"><div class="dim">載入中…</div></div>
      <h4>真實原型參考照(CC0/PD;關鍵詞取自 mecha.js proto)</h4>
      <div id="refStrip"><div class="dim">載入中…</div></div>`,
    rig: () => `
      <h4>特徵 → 零件轉換</h4>
      <table><tr><th>${air ? '機體特徵' : quad ? '生物特徵' : '人形特徵(VRM 骨)'}</th><th>零件</th></tr>${rows}</table>
      ${quad || air ? '' : `<h4>人形比例(身高 1.0 正規化;<span class="ovr-k">黃 = 本機覆寫</span>)</h4>
      <table><tr><th>特徵</th><th>值</th><th>VRM 對應</th></tr>${propRows}</table>`}
      <h4>rig 契約(locomotion.js 消費通道)</h4>
      <ul class="chan">${chan}</ul>
      <div class="note">武器檢視 = 同一棵零件樹的 rig.wpn.&lt;槽位&gt;.nodes 子集(FPV 座艙同源的
        那一份),不是另建的第二份幾何 —— 入口在舞台下方的「檢視」。</div>`,
    mark: () => markTabHTML(),
  }[tab] || (() => '');

  $('panelBody').innerHTML = body();
  renderTabs();
  if (tab === 'ref') { fillArtStrip(spec.id); fillRefStrip(spec.id); }
  if (tab === 'mark') bindMarkTab();
}

/** 分頁鈕:標記分頁掛徽章(這一格有沒有意見,不必點進去才知道) */
function renderTabs() {
  const box = $('panelTabs');
  box.innerHTML = '';
  const mk = markDef(markOf(spec.id)?.status);
  for (const [k, label] of PANEL_TABS) {
    const b = document.createElement('button');
    b.className = 'segb' + (k === tab ? ' on' : '');
    b.innerHTML = k === 'mark' && mk ? `${label} ${mk.icon}` : label;
    // 標記分頁 = 編輯模式 ⇒ 沒有紙娃娃索引的版本(舊版對照)灰掉它
    b.disabled = k === 'mark' && !stage.ver.caps.edit;
    b.title = b.disabled ? `${stage.ver.label}沒有紙娃娃索引(只能看,不能標記)` : '';
    b.onclick = () => setTab(k);
    box.appendChild(b);
  }
}

/** 分頁切換。**標記分頁 = 編輯模式**:紙娃娃編輯器不再是另一顆全域開關 —— 改版前它一開
 *  就把整個資訊欄蓋掉,而你正在對照的 2D 定案圖當場消失。 */
function setTab(k) {
  tab = k === 'mark' && !stage.ver.caps.edit ? 'data' : k;
  const on = tab === 'mark';
  // 一邊自轉一邊拖 gizmo,拖到的是「拖的那一瞬間鏡頭在的地方」⇒ 進標記模式先停自轉
  stage.setEdit(on);
  editor.setOn(on);
  $('dollPanel').hidden = !on;
  renderPanel();
}

/** 標記分頁上半:覆核意見(下半 = 紙娃娃編輯器,由 dolledit.js 掛在 #dollPanel) */
function markTabHTML() {
  const r = markOf(spec.id) || {};
  return `
    <h4>覆核意見(這一格看過了沒 / 有什麼要改)</h4>
    <div class="mk-row"><div class="seg" id="mkSeg">${MARK_STATUS.map((m) =>
    `<button class="segb${r.status === m.key ? ' on' : ''}" data-mk="${m.key}"
       title="${esc(m.tip)}">${m.icon} ${m.label}</button>`).join('')}
      <button class="segb" data-mk="" title="清掉這一格的意見">✕ 清除</button></div></div>
    <textarea class="mk-note" id="mkNote" placeholder="一句話寫下要改什麼(存進 specs.json 的 review 欄)"
      >${esc(r.note || '')}</textarea>
    <div class="mk-row"><button class="segb" id="mkSave">💾 存這句話</button>
      <span class="mk-stat">${r.at ? `上次 <b>${esc(r.at)}</b>` : '(還沒有意見)'}</span></div>
    <div class="mk-sep"></div>
    <div class="note">下面是零件標記:點機體上的零件選它,改形狀/配色或貼彩繪;
      2D 定案圖與原型照留在「參考圖」分頁,標記時不會被蓋掉。</div>`;
}

function bindMarkTab() {
  for (const b of $('panelBody').querySelectorAll('[data-mk]')) {
    b.onclick = () => saveMark(b.dataset.mk || null, $('mkNote').value.trim());
  }
  $('mkSave').onclick = () => saveMark(markOf(spec.id)?.status || null, $('mkNote').value.trim());
}

// ---- 掛上展示台 ---------------------------------------------------------------
// 工具列(檢視 / 型態 / 速度 / 演出 / 視角 / 版本,全是圖示鈕)由 stage.js 依名冊產生 ——
// **兩座看板同一份鈕面**,index.html 只放兩個空容器。
// `onPick` 只攔型態與版本這兩種「看板也要跟著動」的切換:
//   ・型態 = 換名冊那一格(台上型態 ≡ 選中的那一格;換格不重鍛 ⇒ 變形過程照樣演完);
//   ・版本 = 換完要重畫右欄(結構欄印的是**那個版本自己的** rig 契約)。
stage.mount($('stageHost'), $('stageBar'), {
  tag: $('stageTag'),
  onPick: (kind, key) => {
    if (kind === 'form') {
      const s = stage.formSpec(key);
      if (s) setSpec(s);
      return true;
    }
    if (kind === 'ver') {
      stage.setVersion(key);
      if (!stage.ver.caps.edit && tab === 'mark') setTab('data');
      renderPanel();
      return true;
    }
    return false;
  },
});

// ---- headless 檢視(.claude/skills/headless-3d-inspection):pane 不合成 ⇒ rAF 不跑、
// 截圖工具逾時 —— 一律走「手動步進 + 顯式渲染一幀 + POST /__shot 落盤」這條路 ----
window.__shot = async (name, w = 1280, h = 800, opts = {}) => {
  const { camera, controls, renderer, canvas } = stage;
  if (opts.yaw != null || opts.dist != null || opts.pitch != null) {
    const H = spec.height;
    const t = controls.target.clone();
    const d = opts.dist ?? H * 2.6, yaw = opts.yaw ?? 0, pit = opts.pitch ?? 0.16;
    camera.position.set(
      t.x + Math.sin(yaw) * Math.cos(pit) * d,
      t.y + Math.sin(pit) * d,
      t.z + Math.cos(yaw) * Math.cos(pit) * d);
    camera.lookAt(t);
  }
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  stage.render();
  const r = await fetch(`/__shot/${name}`, { method: 'POST', body: canvas.toDataURL('image/png') });
  return (await r.json()).path;
};
window.__scene = { scene: stage.scene, camera: stage.camera, renderer: stage.renderer,
  controls: stage.controls, THREE: stage.THREE };
window.__forge = {
  specs: () => SPECS.map((s) => s.id),
  cats: () => ROSTER.map((c) => ({ key: c.key, n: c.entries.length,
    done: c.entries.filter((e) => SPECS.some((s) => s.id === e.key)).length })),
  setSpec: (id) => setSpec(SPECS.find((s) => s.id === id) || spec),
  height: () => spec.height,       // 取景基準(__shot 的預設鏡距 = 它 ×2.6;截圖工具 --distF 用)
  setView: (v) => { stage.setView(v); renderPanel(); },
  reframe: () => stage.applyView(true),   // 步進之後重新取景(headless 拍武器頁用)
  ent: () => stage.ent,
  rig: () => stage.unit?.rig,
  setSpeed: (sel) => stage.setSpeed(typeof sel === 'number' ? (sel ? (sel < 0.6 ? 'walk' : 'run') : 'idle') : sel),
  // 演出:四個槽位同一支(招式的定向/全向由 castDirF 推,headless 不必自己傳 dir)
  play: (slot) => stage.play(slot),
  fire: (slot) => stage.play(slot === 'heavy' ? 'heavy' : 'light'),
  cast: (_dir, slot = 'ult') => stage.play(slot),
  step: (n = 1, dt = 1 / 60) => stage.step(n, dt),
  simT: () => stage._t,
  joints: (on) => stage.setJoints(!!on),
  // 版本 / 型態:headless 一律走與人一樣的那條路(換型態 = 選另一格,而且不重鍛)
  versions: () => stage.versions(),
  setVersion: (k) => { stage.setVersion(k); renderPanel(); },
  version: () => stage.ver.key,
  setForm: (f) => { const s = stage.formSpec(f); if (s) setSpec(s); },
  form: () => spec.form || null,
  // 型態進度(0 地面 / 1 飛行):**讀** locomotion 算好的那一份,拍變形過程逐幀對照用
  morphM: () => stage.morphM(),
  // 紙娃娃(headless 檢視:直接餵一份覆寫文件,不必操作面板)。
  // MUST 同時餵給編輯器 —— 只改草稿的話,面板統計說 0、而下一次面板觸發的重鍛會把
  // 這份文件整份蓋掉(兩份草稿 = 兩個真相)。
  doll: (doc) => { draftDoll = doc; stage.rebuild(doc); editor.load(doc); },
  dollIndex: () => ({
    parts: [...(stage.unit?.doll?.parts.keys() || [])],
    bones: [...(stage.unit?.doll?.bones.keys() || [])],
  }),
  // headless 入口一律走**與人一樣的那條路**(setTab):編輯模式的開關只有一個
  tab: (k) => setTab(k),
  edit: (on) => setTab(on ? 'mark' : 'data'),
  mark: () => markOf(spec.id),
};

editor = makeDollEditor({
  scene: stage.scene, camera: stage.camera, canvas: stage.canvas, orbit: stage.controls,
  unit: () => stage.unit,
  // 結構改動(換形狀/邊緣/黏貼/貼花/配色/骨長)→ 重鍛;取景刻意不動
  rebuild: (doc) => { draftDoll = doc; stage.rebuild(doc); },
  save: async (doc) => { OVR = await saveOvr(spec.id, { doll: doc }); },
  stored: () => OVR[spec.id]?.doll || null,
  specKey: () => spec.id,
});
editor.mount($('dollPanel'));

setSpec(SPECS[0]);
