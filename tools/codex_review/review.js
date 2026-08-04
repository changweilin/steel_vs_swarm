// ============ 機體美術覆核台 — 頁面(dev-only)============
// 使用者需求(2026-08-04):「將已生成的每張機體圖配對到角色頭像、現有機體 3D 展示台,
// 點擊後出現武器招式等機體資訊、遊戲未公開的隱藏資訊,提供使用者確認勾選、局部重繪或重新下 prompt」。
//
// 四條紀律(與遊戲本體同一套):
//   ① **唯讀真品**:數值一律經 `heroWeapon()`/`heroAbility()`,原型與生成段一律經 `codex.js` ——
//      MUST NOT 在這裡自己算一份或抄一份文案(那就是圖鑑與覆核台分家,而且不會報錯)。
//   ② **3D 展示台就是遊戲那一台** `charPreview.js CharPreview`(共用 `makeUnit` + `stepLocomotion`)——
//      MUST NOT 為覆核台另寫預覽(module 層 .claude.md 對 charPreview.js 的同一條)。
//   ③ **重新下的 prompt 是覆核產物不是第二份 `imagePrompt`**:預設值一律由 `imagePrompt()` 產生,
//      使用者改過的存進 state.json 的 `prompt` 欄,並保留「還原成推導值」那顆鈕(A40 ⑥)。
//   ④ **缺圖與孤兒不藏**:配對由伺服器端推導,這裡照實畫出來(缺一格就是一格灰框)。
// three 走 CDN(A2:不進 package.json)⇒ **拿不到就要能降級**(CLAUDE.md 原則 6:降級,不例外)。
// 靜態 import charPreview.js 會連帶把 three 拉進模組圖:CDN 一擋(離線/公司代理/沙箱),
// 整頁在解析階段就死了 —— 配對、勾選、重下 prompt 這些不需要 3D 的工作也一起沒了。
// 故 3D 展示台改成**動態 import**,失敗只讓那一格顯示原因,其餘照常。
let CharPreview = null;
const threeReady = import('/public/js/charPreview.js')
  .then((m) => { CharPreview = m.CharPreview; return true; })
  .catch((e) => { console.warn('3D 展示台停用:', e?.message || e); return false; });
import {
  CHARACTERS, charKind, heroWeapon, heroAbility, heroArmor, heroMobility,
} from '/public/js/data.js';
import { LORE } from '/public/js/lore.js';
import {
  protoOf, mechaCodex, charCodex, textSeed, imagePrompt, modelSheet,
} from '/public/js/codex.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** 圖鑑數值一律修掉浮點雜訊(heroWeapon 的解析結果是連乘出來的:41.148934413846504)*/
const n1 = (v) => (Math.round(v * 10) / 10).toString();
const n2 = (v) => (Math.round(v * 100) / 100).toString();
const STATUS = { ok: ['✔ 已確認', 'ok'], redraw: ['✎ 局部重繪', 'flag'], reprompt: ['⟳ 重下 prompt', 'flag'] };

const app = { data: null, cur: null, preview: null, canvas: null, filter: 'all' };

// ---- 資料 ----------------------------------------------------------------
const api = async (body) => (await fetch('/api/review', body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : undefined)).json();

const itemOf = (slot) => app.data?.state?.items?.[slot] || null;
const rowOf = (id) => app.data.rows.find((r) => r.id === id);

/** 一名角色的覆核進度(用於清單徽章與篩選) */
function rowStat(r) {
  const has = r.shots.filter((s) => s.has);
  const ok = has.filter((s) => itemOf(s.slot)?.status === 'ok').length;
  const flag = has.filter((s) => ['redraw', 'reprompt'].includes(itemOf(s.slot)?.status)).length;
  return { want: r.shots.length, has: has.length, ok, flag, miss: r.shots.length - has.length };
}

// ---- 左側清單 ------------------------------------------------------------
function renderList() {
  const keep = (r) => {
    const st = rowStat(r);
    if (app.filter === 'todo') return st.has > st.ok + st.flag;
    if (app.filter === 'flag') return st.flag > 0;
    if (app.filter === 'miss') return st.miss > 0;
    return true;
  };
  $('crList').innerHTML = app.data.rows.filter(keep).map((r) => {
    const st = rowStat(r);
    const pill = st.miss === st.want ? `<span class="cr-pill miss">缺 ${st.miss}</span>`
      : st.flag ? `<span class="cr-pill flag">${st.flag} 意見</span>`
        : st.ok === st.has ? `<span class="cr-pill ok">✔ ${st.ok}</span>`
          : `<span class="cr-pill">${st.ok}/${st.has}</span>`;
    return `<div class="cr-row ${app.cur === r.id ? 'on' : ''}" data-id="${r.id}">
      <img src="/${r.avatar}" alt="" onerror="this.style.visibility='hidden'">
      <div class="cr-rn"><b>${esc(r.name)}</b><span>${r.id.toUpperCase()} ・ ${esc(r.kindWord)}</span></div>
      ${pill}</div>`;
  }).join('') || '<div class="cr-dim" style="padding:12px">(這個篩選沒有結果)</div>';
  for (const el of $('crList').querySelectorAll('.cr-row')) {
    el.onclick = () => select(el.dataset.id);
  }
}

function renderStat() {
  let has = 0, want = 0, ok = 0, flag = 0;
  for (const r of app.data.rows) {
    const s = rowStat(r); has += s.has; want += s.want; ok += s.ok; flag += s.flag;
  }
  $('crStat').textContent =
    `圖 ${has}/${want} ・ 已確認 ${ok} ・ 有意見 ${flag} ・ 缺 ${want - has} ・ 孤兒 ${app.data.orphans.length}`;
}

// ---- 右側:角色 / 機體 ---------------------------------------------------
function select(id) {
  app.cur = id;
  renderList();
  renderBody();
}

function weaponRows(id) {
  const out = [];
  for (const [slot, key] of [['light', '左鍵'], ['heavy', '右鍵']]) {
    const w = heroWeapon(id, slot, 1);
    if (!w) continue;
    const bits = [`傷害 ${n1(w.dmg)}`, `射速 ${n2(w.rate)}/s`, `彈匣 ${w.mag}`,
      `裝填 ${n1(w.reload)}s`, `射程 ${Math.round(w.range)}m`, w.r ? `爆風 ${n2(w.r)}m` : ''].filter(Boolean);
    out.push(`<div class="cr-wrow" data-play="${slot}"><b>${esc(w.name)}</b>
      <span class="cr-dim">${esc(w.rw || '')}</span> <span class="cr-pill">${esc(key)}</span>
      <div class="cr-nums">${bits.join(' ・ ')}</div></div>`);
  }
  for (const [slot, key] of [['skill', 'Q'], ['ult', 'E']]) {
    const a = heroAbility(id, slot, 1);
    if (!a) continue;
    const bits = [`電力 ${a.mp}`, `冷卻 ${a.cd}s`, a.dmg ? `傷害 ${a.dmg}` : '', a.heal ? `修復 ${a.heal}` : '',
      a.r ? `半徑 ${a.r}m` : '', a.dur ? `持續 ${a.dur}s` : ''].filter(Boolean);
    out.push(`<div class="cr-wrow" data-play="${slot}"><b>${esc(a.name)}</b>
      <span class="cr-pill">${esc(key)}</span>
      <div class="cr-dim">${esc(a.desc || '')}</div><div class="cr-nums">${bits.join(' ・ ')}</div></div>`);
  }
  return out.join('');
}

function renderBody() {
  const r = rowOf(app.cur);
  if (!r) { $('crBody').innerHTML = '<div class="cr-dim">← 左側挑一名角色</div>'; return; }
  const id = r.id;
  const lo = LORE[id] || {};
  const mc = mechaCodex(id), cc = charCodex(id);
  const kv = (o) => Object.entries(o).map(([k, v]) => `<b>${esc(k)}</b><div>${esc(v ?? '—')}</div>`).join('');

  $('crBody').innerHTML = `
  <div class="cr-head">
    <div class="cr-face">
      <img src="/${r.portrait}" alt="" onerror="this.src='/${r.avatar}'">
      <div class="cr-cap">${r.id.toUpperCase()} 立繪 / 頭像</div>
    </div>
    <div class="cr-stage" id="crStage">
      <div class="cr-stage-btns">
        <button class="segb" id="crMorph" hidden>✈ 變形</button>
        <button class="segb" id="crRun">⏸ 靜止</button>
      </div>
    </div>
    <div class="cr-meta">
      <h2>「${esc(r.code)}」${esc(r.name)}</h2>
      <div class="cr-mline">${esc(mc.ident.code)} ・ ${esc(r.sideName)} ・ ${esc(r.kindWord)}
        ・ 全高 ${mc.scaleM.toFixed(2)}m</div>
      <div class="cr-kv">${kv({
    機體: r.machine,
    國籍: `${lo.nat} ・ ${lo.age} 歲 ・ ${lo.sex}`,
    職務: lo.role,
    // heroMobility 吃的是 (機種, mods, 飛行態) —— 傳角色 id 會靜默回 0(m/s 欄整排變 0.0)
    裝甲: `${n1(heroArmor(id))} ・ 機動 ${n1(heroMobility(charKind(id), CHARACTERS[id].mods))} m/s`
      + (charKind(id) === 'morph' ? ` / 飛行 ${n1(heroMobility(charKind(id), CHARACTERS[id].mods, true))}` : ''),
    台詞: lo.quote,
  })}</div>
    </div>
  </div>

  <div class="cr-sec"><h3>機體圖(點圖覆核)</h3>
    <div class="cr-shots">${r.shots.map((s) => shotCard(s)).join('')}</div>
  </div>

  <div class="cr-sec"><h3>武器 / 招式(點一列在展示台播演出)</h3>${weaponRows(id)}</div>

  <div class="cr-sec"><h3>原型層</h3>
    <div class="cr-kv">${protoOf(id).map((L) =>
    `<b>${esc(L.label)}</b><div><b>${esc(L.src)}</b> ${esc(L.note)}</div>`).join('')}</div>
  </div>

  <div class="cr-sec cr-hide"><h3>⚑ 遊戲未公開:機體生成段(2D / 3D 用)</h3>
    <div class="cr-kv">${kv({
    剪影: mc.gen.sil, 量體比例: mc.gen.mass, 材質表面: mc.gen.mat,
    分件: (mc.gen.parts || []).join(' / '), 生圖關鍵詞: (mc.gen.tag || []).join('、'), 生成注意: mc.gen.note,
  })}</div>
  </div>

  <div class="cr-sec cr-hide"><h3>⚑ 遊戲未公開:角色生成段(立繪用)</h3>
    <div class="cr-kv">${kv({
    剪影: cc.gen.sil, 身高體格: cc.gen.mass, 膚髮衣料: cc.gen.mat,
    分件: (cc.gen.parts || []).join(' / '), 生圖關鍵詞: (cc.gen.tag || []).join('、'), 生成注意: cc.gen.note,
  })}</div>
  </div>

  <div class="cr-sec cr-hide"><h3>⚑ 遊戲未公開:對外生成文字(codex.js 推導)</h3>
    <label class="cr-dim">3D 建模單 modelSheet</label>
    <textarea class="cr-gen" readonly rows="8">${esc(modelSheet('mecha', id))}</textarea>
    <label class="cr-dim">文本生成種子 textSeed</label>
    <textarea class="cr-gen" readonly rows="10">${esc(textSeed('mecha', id))}</textarea>
  </div>`;

  for (const el of $('crBody').querySelectorAll('.cr-shot[data-slot]')) {
    el.onclick = () => openReview(el.dataset.slot);
  }
  for (const el of $('crBody').querySelectorAll('.cr-wrow[data-play]')) {
    el.onclick = () => app.preview?.play(el.dataset.play);
  }
  mountStage(id);
}

function shotCard(s) {
  const it = itemOf(s.slot);
  const [label, cls] = STATUS[it?.status] || ['— 未覆核', ''];
  const badge = s.assigned ? '<span class="cr-pill flag">指派</span>' : '';
  if (!s.has) {
    return `<div class="cr-shot"><div class="cr-none">缺圖</div>
      <div class="cr-sc"><span class="cr-pill miss">${esc(s.poseLabel)}${s.form ? `・${s.form}` : ''}</span></div></div>`;
  }
  return `<div class="cr-shot ${cls ? `on-${cls}` : ''}" data-slot="${s.slot}">
    <img src="/${s.url}" alt="" loading="lazy">
    <div class="cr-sc"><span class="cr-pill">${esc(s.poseLabel)}${s.form ? `・${s.form}` : ''}</span>
      ${badge}<span class="cr-pill ${cls}">${esc(label)}</span></div></div>`;
}

// ---- 3D 展示台(遊戲那一台)-----------------------------------------------
async function mountStage(id) {
  const box = $('crStage');
  if (!(await threeReady)) {
    // 降級:三維那一格說明白為什麼沒有,其餘功能不受影響(原則 6)
    box.innerHTML = '<div class="cr-none" style="height:100%">3D 展示台停用<br>(three CDN 連不到)</div>';
    return;
  }
  if (!app.canvas) {
    app.canvas = document.createElement('canvas');
    app.preview = new CharPreview(app.canvas);
    app.preview.start();
  }
  if (box !== app.canvas.parentElement) box.prepend(app.canvas);
  const c = CHARACTERS[id];
  app.preview.setChar(id, c.side);
  const morph = $('crMorph');
  morph.hidden = charKind(id) !== 'morph';
  morph.onclick = () => { morph.textContent = app.preview.toggleMorph() ? '⬇ 變形' : '✈ 變形'; };
  const RUN = { idle: '⏸ 靜止', slow: '🐢 慢速', normal: '▶ 正常' };
  const run = $('crRun');
  run.onclick = () => { app.preview.cycleRun(1); run.textContent = RUN[app.preview.runMode] || RUN.idle; };
  run.textContent = RUN[app.preview.runMode] || RUN.idle;
}

// ---- 覆核 modal:確認勾選 / 局部重繪 / 重新下 prompt ------------------------
function openReview(slot) {
  const r = rowOf(app.cur);
  const s = r.shots.find((x) => x.slot === slot);
  const it = itemOf(slot) || {};
  const regions = [...(it.regions || [])];
  // 重新下 prompt 的預設值一律取**推導值**(codex.imagePrompt);使用者改過的才存進 state
  const derived = imagePrompt('mecha', r.id);
  const m = $('crModal');
  m.hidden = false;
  m.innerHTML = `<div class="cr-mbox">
    <div class="cr-mimg" id="crImgWrap"><img src="/${s.url}" alt="" draggable="false"></div>
    <div class="cr-mside">
      <h3>${esc(r.name)} ・ ${esc(s.poseLabel)}${s.form ? `・${s.form}` : ''}</h3>
      <div class="cr-dim">${esc(s.file)}${s.assigned ? '(指派)' : ''}</div>

      <label>① 確認勾選</label>
      <div class="seg"><button class="segb ${it.status === 'ok' ? 'on' : ''}" data-st="ok">✔ 通過</button>
        <button class="segb ${it.status === 'redraw' ? 'on' : ''}" data-st="redraw">✎ 局部重繪</button>
        <button class="segb ${it.status === 'reprompt' ? 'on' : ''}" data-st="reprompt">⟳ 重下 prompt</button>
        <button class="segb" data-st="">✕ 清除</button></div>

      <label>② 局部重繪:在左圖拖曳框出要重畫的地方</label>
      <div class="cr-rgl" id="crRgl"></div>
      <input class="cr-note" id="crRnote" placeholder="這一框要改什麼(下一個框的說明)">

      <label>③ 重新下 prompt(預設 = codex.imagePrompt 推導值)</label>
      <textarea class="cr-gen" id="crPrompt" rows="9">${esc(it.prompt || derived)}</textarea>
      <div class="cr-acts">
        <button class="segb" id="crReset">↺ 還原成推導值</button>
        <button class="segb" id="crCopy">⧉ 複製</button>
      </div>

      <label>整體備註</label>
      <input class="cr-note" id="crNote" value="${esc(it.note || '')}" placeholder="給美術/生圖的整體意見">

      <div class="cr-acts">
        <button class="segb on" id="crSave">儲存</button>
        <button class="segb" id="crClose">關閉</button>
        <span class="cr-saved" id="crSaved"></span>
      </div>
    </div></div>`;

  const wrap = $('crImgWrap');
  const drawRegions = () => {
    for (const b of wrap.querySelectorAll('.cr-box')) b.remove();
    regions.forEach((g, i) => {
      const d = document.createElement('div');
      d.className = 'cr-box';
      d.style.cssText = `left:${g.x * 100}%;top:${g.y * 100}%;width:${g.w * 100}%;height:${g.h * 100}%`;
      d.innerHTML = `<i>${i + 1}. ${esc(g.note || '重繪')}</i>`;
      wrap.appendChild(d);
    });
    $('crRgl').innerHTML = regions.map((g, i) =>
      `<div><span>${i + 1}. ${esc(g.note || '重繪')} (${(g.w * 100) | 0}%×${(g.h * 100) | 0}%)</span>
       <button class="segb" data-del="${i}">✕</button></div>`).join('') || '(還沒有框)';
    for (const b of $('crRgl').querySelectorAll('[data-del]')) {
      b.onclick = () => { regions.splice(+b.dataset.del, 1); drawRegions(); };
    }
  };
  drawRegions();

  // 拖曳框選 → 正規化矩形(0~1),直接可餵給 inpaint 的 bbox
  let drag = null;
  const rect = () => wrap.querySelector('img').getBoundingClientRect();
  const at = (e) => {
    const b = rect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };
  wrap.onpointerdown = (e) => { drag = at(e); wrap.setPointerCapture(e.pointerId); };
  wrap.onpointermove = (e) => {
    if (!drag) return;
    const p = at(e);
    const g = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
    for (const b of wrap.querySelectorAll('.cr-box.tmp')) b.remove();
    const d = document.createElement('div');
    d.className = 'cr-box tmp';
    d.style.cssText = `left:${g.x * 100}%;top:${g.y * 100}%;width:${g.w * 100}%;height:${g.h * 100}%`;
    wrap.appendChild(d);
  };
  wrap.onpointerup = (e) => {
    if (!drag) return;
    const p = at(e), s0 = drag; drag = null;
    for (const b of wrap.querySelectorAll('.cr-box.tmp')) b.remove();
    const g = { x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y), w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) };
    if (g.w < 0.02 || g.h < 0.02) return;                       // 誤點不算一框
    g.note = $('crRnote').value.trim();
    $('crRnote').value = '';
    regions.push(g);
    drawRegions();
  };

  let status = it.status || '';
  for (const b of m.querySelectorAll('[data-st]')) {
    b.onclick = () => {
      status = b.dataset.st;
      for (const x of m.querySelectorAll('[data-st]')) x.classList.toggle('on', x.dataset.st === status && status);
    };
  }
  $('crReset').onclick = () => { $('crPrompt').value = derived; };
  $('crCopy').onclick = () => navigator.clipboard?.writeText($('crPrompt').value);
  $('crClose').onclick = () => { m.hidden = true; };
  m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  $('crSave').onclick = async () => {
    const prompt = $('crPrompt').value.trim();
    const item = status || regions.length || prompt !== derived || $('crNote').value.trim() ? {
      status,
      regions,
      // 與推導值相同就不存(存了就是第二份 imagePrompt,而且不會跟著欄位變 —— A40 ⑥)
      prompt: prompt !== derived ? prompt : undefined,
      note: $('crNote').value.trim() || undefined,
    } : null;
    const res = await api({ slot, item });
    app.data.state.items = res.items;
    $('crSaved').textContent = '已存檔 ✔';
    renderList(); renderStat(); renderBody();
    setTimeout(() => { m.hidden = true; }, 350);
  };
}

// ---- 孤兒檔(對不到任何一格的圖)------------------------------------------
function renderOrphans() {
  if (!app.data.orphans.length) return;
  const slots = app.data.rows.flatMap((r) => r.shots.filter((s) => !s.has)
    .map((s) => ({ slot: s.slot, label: `${r.id} ${s.form ? `${s.form}/` : ''}${s.pose}` })));
  const box = document.createElement('div');
  box.className = 'cr-sec cr-orph';
  box.innerHTML = `<h3>孤兒檔(${app.data.orphans.length})—— 檔名對不到任何一格,多半是機體換過手</h3>
    <div class="cr-shots">${app.data.orphans.map((f) => `<div class="cr-shot">
      <img src="/public/assets/cyberpunk_art/mechs/${f}" alt="" loading="lazy">
      <div class="cr-sc"><span class="cr-pill flag">${esc(f)}</span></div>
      <select class="cr-note" data-file="${esc(f)}">
        <option value="">(指派到…)</option>
        ${slots.map((s) => `<option value="${s.slot}">${esc(s.label)}</option>`).join('')}
      </select></div>`).join('')}</div>`;
  $('crBody').appendChild(box);
  for (const sel of box.querySelectorAll('select[data-file]')) {
    sel.onchange = async () => {
      await api({ assignFile: sel.dataset.file, assignSlot: sel.value });
      await load();
    };
  }
}

// ---- 啟動 ----------------------------------------------------------------
async function load() {
  app.data = await api();
  renderStat();
  renderList();
  renderBody();
  renderOrphans();
}
for (const b of $('crFilter').querySelectorAll('.segb')) {
  b.onclick = () => {
    app.filter = b.dataset.f;
    for (const x of $('crFilter').querySelectorAll('.segb')) x.classList.toggle('on', x === b);
    renderList();
  };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('crModal').hidden = true; });
await load();
select(app.data.rows[0].id);
