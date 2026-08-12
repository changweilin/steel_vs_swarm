// ============ 紙娃娃編輯器:互動 + 面板(dev-only)============
// 使用者第五輪:「可以拖曳調整骨架的角度/長度/位置/播放骨架運動等,加入外觀零件拖曳調整/
// 邊緣鈍化銳化/更換形狀/縮放/移動/旋轉/黏貼/配色/塗鴉/圖騰設計/烙印等」。
//
// 分工三層,與既有的「格式 / 內容 / 演出」同一條:
//   doll.js       文件格式(零 THREE:鍵推導、夾制、正規化)—— 離線稽核驗這一支
//   dollapply.js  文件 → 幾何(唯一套用縫;兩座看板同吃)
//   本檔          手怎麼碰它(點選 / 拖曳 / 面板)—— 只寫**草稿文件**,MUST NOT 自己動幾何
//
// 兩條會靜默壞掉的線:
//   ① **拖曳直接動物件、放手才寫回文件**。每動一格就重鍛整棵樹的話,gizmo 抓著的那顆物件
//      在同一幀被 dispose 掉 —— three 的拖曳狀態指向舊物件,滑鼠一移機體就飛走。
//      故:變換類(移動/旋轉/縮放)即時動物件、放手回寫;結構類(換形狀/邊緣/黏貼/貼花/
//      配色)才重鍛。
//   ② 重鍛之後 MUST 依**鍵**重新掛回選取(舊物件已經不存在了)。拿舊參照續掛的症狀是
//      gizmo 還在畫面上、拖起來卻什麼都沒發生。
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  emptyDoll, sanitizeDoll, dollStats, isEmptyDoll, boneLabel, markSeed,
  SHAPE_LABEL, MARK_LABEL, DOLL_LIMITS, DOLL_NOTE, addKey,
} from './doll.js';
import { ensureSocket } from './dollapply.js';
import { shapeKeys } from './shapes.js';
import { markKinds } from './mark.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const hex6 = (c) => `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
const r3 = (v) => Math.round(v * 1000) / 1000;
const TABS = [['bone', '骨架'], ['part', '零件'], ['paint', '彩繪']];
const GIZMOS = [['translate', '移動'], ['rotate', '旋轉'], ['scale', '縮放']];

/**
 * @param ctx {
 *   scene, camera, canvas, orbit,      three 場景四件(orbit = OrbitControls,拖曳時要停掉)
 *   unit(),                            目前的零件樹(每次重鍛後由 refresh 告知)
 *   rebuild(doc),                      以草稿重鍛(回新的 unit)
 *   save(doc), stored(), specKey()     存檔 / 已存檔的那一份 / 目前機體鍵(面板抬頭)
 * }
 */
export function makeDollEditor(ctx) {
  const ed = {
    on: false, tab: 'bone', gizmo: 'translate',
    sel: null,                       // { type:'bone'|'part'|'add', key }
    doc: emptyDoll(),
    paint: { kind: markKinds()[0], color: 0xf05a3c, size: 0.6, rot: 0, text: '' },
    msg: '',
  };
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let panel = null, timer = 0, box = null;

  // ---- gizmo(three 官方 TransformControls;拖曳中停掉軌道鏡頭)----
  const tc = new TransformControls(ctx.camera, ctx.canvas);
  tc.addEventListener('dragging-changed', (e) => {
    ctx.orbit.enabled = !e.value;
    if (!e.value) commitTransform();     // 放手才回寫文件(見檔頭 ①)
  });
  const tcHelper = tc.getHelper ? tc.getHelper() : tc;   // r160 起 gizmo 以 helper 進場景
  tcHelper.visible = false;
  ctx.scene.add(tcHelper);

  const ix = () => ctx.unit()?.doll || null;
  /** 目前選取對應的**物件**(骨 → 編輯座:編輯值一律寫在座上,見 dollapply 檔頭) */
  function selObject() {
    const I = ix();
    if (!I || !ed.sel) return null;
    const { type, key } = ed.sel;
    if (type === 'bone') return I.sockets.get(key) || null;
    if (type === 'add') return I.adds.get(key) || null;
    return I.parts.get(key) || null;
  }

  /**
   * 選到骨:當場補一個編輯座讓 gizmo 掛得住。
   * MUST NOT 靠「先寫一格空覆寫再重鍛」達成 —— 空覆寫會被 sanitizeDoll 當成沒有改動丟掉
   * (覆寫層只存差異),於是重鍛出來的樹上根本沒有那個座,gizmo 掛不上去:
   * 症狀是「選了骨卻拖不動」,而面板、選單、統計每一格看起來都正常。
   */
  function ensureBone(key) { ensureSocket(ix(), key); }

  /** 放手:把物件現在的變換寫回草稿(零件是**相對出廠值的差**,骨與黏貼件是絕對值) */
  function commitTransform() {
    const o = selObject();
    if (!o || !ed.sel) return;
    const { type, key } = ed.sel;
    if (type === 'bone') {
      const b = ed.doc.bones[key] || (ed.doc.bones[key] = {});
      b.p = [r3(o.position.x), r3(o.position.y), r3(o.position.z)];
      b.r = [r3(o.rotation.x), r3(o.rotation.y), r3(o.rotation.z)];
    } else if (type === 'add') {
      const a = ed.doc.adds[Number(key.slice(1))];
      if (a) {
        a.p = [r3(o.position.x), r3(o.position.y), r3(o.position.z)];
        a.r = [r3(o.rotation.x), r3(o.rotation.y), r3(o.rotation.z)];
        a.s = [r3(o.scale.x), r3(o.scale.y), r3(o.scale.z)];
      }
    } else {
      const base = o.userData.dollBase;
      const q = ed.doc.parts[key] || (ed.doc.parts[key] = {});
      q.p = [r3(o.position.x - base.p.x), r3(o.position.y - base.p.y), r3(o.position.z - base.p.z)];
      q.r = [r3(o.rotation.x - base.r.x), r3(o.rotation.y - base.r.y), r3(o.rotation.z - base.r.z)];
      q.s = [r3(o.scale.x / base.s.x), r3(o.scale.y / base.s.y), r3(o.scale.z / base.s.z)];
    }
    ed.doc = sanitizeDoll(ed.doc);       // 夾制只有一份(doll.js),拖出界的值當場收回來
    render();
  }

  /**
   * 結構改動 → 重鍛(去抖;重鍛後依**鍵**重新掛回 gizmo)。
   * `repaint = false` 給滑桿拖曳用:重畫面板會把使用者正抓著的那根滑桿換成新節點,
   * 拖到一半就斷(症狀:每拖一格要重按一次)。滑桿放開(change)時才整片重畫。
   */
  function rebuild(now = false, repaint = true) {
    clearTimeout(timer);
    const go = () => {
      ed.doc = sanitizeDoll(ed.doc);
      ctx.rebuild(ed.doc);
      attach();
      if (repaint) render();
    };
    if (now) go(); else timer = setTimeout(go, 120);
  }

  /** 掛 gizmo + 選取框 */
  function attach() {
    const o = selObject();
    if (box) { box.parent?.remove(box); box.geometry.dispose(); box.material.dispose(); box = null; }
    if (!ed.on || !o) { tc.detach(); tcHelper.visible = false; return; }
    if (ed.tab === 'paint') {
      tc.detach();          // MUST 是 detach 不是 visible=false:藏起來的 gizmo 照樣攔指標
    } else {
      tc.attach(o);
      tc.setMode(ed.tab === 'bone' && ed.gizmo === 'scale' ? 'rotate' : ed.gizmo);
      tc.setSize(0.8);
    }
    box = new THREE.BoxHelper(o, 0x7fd8ff);
    box.material.depthTest = false;
    box.userData.noOutline = true;
    ctx.scene.add(box);
  }

  /** 點畫面:零件/骨架分頁選取,彩繪分頁貼上一枚圖樣 */
  function pick(ev) {
    const I = ix();
    if (!ed.on || !I) return;
    const r = ctx.canvas.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, ctx.camera);
    const hits = ray.intersectObject(ctx.unit().group, true)
      .filter((h) => h.object.isMesh && h.object.visible && !h.object.userData.isOutline
        && !h.object.userData.dollMark && h.object.parent?.visible !== false);
    if (!hits.length) return;
    const h = hits[0];
    const obj = h.object;
    if (ed.tab === 'paint') return paintAt(h);
    if (ed.tab === 'part') {
      const add = ancestorAdd(obj);
      ed.sel = add != null ? { type: 'add', key: addKey(add) } : { type: 'part', key: obj.userData.pid };
    } else {
      const key = boneOf(obj);
      if (!key) return;
      ed.sel = { type: 'bone', key };
      ed.lastBone = key;
      ensureBone(key);
    }
    attach();
    render();
  }

  /** 這顆零件屬於哪一根骨:沿父鏈往上找第一個**編輯得到**的骨(推導,零名冊) */
  function boneOf(obj) {
    const I = ix();
    const byObj = new Map([...I.bones].map(([k, v]) => [v, k]));
    for (let o = obj; o; o = o.parent) {
      const k = byObj.get(o);
      if (k) return k;
    }
    return null;
  }
  /** 這顆零件是不是黏貼件的一部分(是的話選整件,不是選裡面那一顆 mesh) */
  function ancestorAdd(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData.dollAdd != null) return o.userData.dollAdd;
    return null;
  }

  /** 貼一枚彩繪:命中點與面法線一律換算成**該零件的局部座標**(存世界座標會隨動畫飄走) */
  function paintAt(h) {
    const obj = h.object;
    const pid = obj.userData.pid;
    if (!pid) { ed.msg = '黏貼件上暫不支援彩繪(先把它存成零件覆寫)'; return render(); }
    const lp = obj.worldToLocal(h.point.clone());
    const ln = (h.face?.normal || new THREE.Vector3(0, 0, 1)).clone().normalize();
    ed.doc.marks.push({
      pid, kind: ed.paint.kind,
      p: [r3(lp.x), r3(lp.y), r3(lp.z)], n: [r3(ln.x), r3(ln.y), r3(ln.z)],
      rot: ed.paint.rot, size: ed.paint.size, color: ed.paint.color,
      text: ed.paint.text || undefined,
      seed: markSeed(pid, ed.doc.marks.length),
    });
    ed.msg = `已貼上${MARK_LABEL[ed.paint.kind]}(第 ${ed.doc.marks.length} 枚)`;
    rebuild(true);
  }

  // ---- 面板 -------------------------------------------------------------------
  const row = (label, inner) => `<label class="d-row"><span>${label}</span>${inner}</label>`;
  const seg = (id, items, cur) => `<div class="seg">${items.map(([k, l]) =>
    `<button class="segb${k === cur ? ' on' : ''}" data-${id}="${k}">${l}</button>`).join('')}</div>`;

  function boneTab() {
    const I = ix();
    const keys = I ? [...I.bones.keys()] : [];
    const cur = ed.sel?.type === 'bone' ? ed.sel.key : '';
    const b = ed.doc.bones[cur] || {};
    const edited = Object.keys(ed.doc.bones);
    return `
      <div class="d-note">點機體上的零件 = 選它所屬的骨;拖 gizmo 調角度/位置,骨長用滑桿。
        編輯值寫在**編輯座**上,播放骨架運動時不會被步態覆寫。</div>
      ${seg('gizmo', GIZMOS.slice(0, 2), ed.gizmo)}
      ${row('骨', `<select data-bone>${['<option value="">(未選)</option>',
      ...keys.map((k) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(boneLabel(k))}
        ${ed.doc.bones[k] ? ' ●' : ''}</option>`)].join('')}</select>`)}
      ${cur ? `
        ${row('骨長', `<input type="range" data-blen min="${DOLL_LIMITS.len[0]}" max="${DOLL_LIMITS.len[1]}"
          step="0.01" value="${b.len ?? 1}"><i>${r3(b.len ?? 1)}</i>`)}
        <div class="d-btns">
          <button class="segb" data-act="boneReset">還原這根骨</button>
          <button class="segb" data-act="bonePose">複製目前姿勢</button>
        </div>` : ''}
      <div class="d-list">${edited.length ? edited.map((k) => `<span class="d-chip${k === cur ? ' on' : ''}"
        data-pickbone="${esc(k)}">${esc(boneLabel(k))}</span>`).join('') : '<span class="d-dim">(還沒有骨架調整)</span>'}</div>`;
  }

  function partTab() {
    const sel = ed.sel;
    const isAdd = sel?.type === 'add';
    const q = (!sel || isAdd) ? {} : (ed.doc.parts[sel.key] || {});
    const edited = Object.keys(ed.doc.parts);
    return `
      <div class="d-note">點機體上的零件即選取;移動/旋轉/縮放拖 gizmo,其餘用下面的旋鈕。
        換形狀是「填滿原零件的包圍盒」⇒ 不會跑位。</div>
      ${seg('gizmo', GIZMOS, ed.gizmo)}
      <div class="d-sel">選取:${sel ? esc(isAdd ? `黏貼件 ${sel.key}` : sel.key) : '(未選)'}</div>
      ${sel && !isAdd ? `
        ${row('形狀', `<select data-shape><option value="">(原樣)</option>${shapeKeys().map((k) =>
      `<option value="${k}"${q.shape === k ? ' selected' : ''}>${SHAPE_LABEL[k] || k}</option>`).join('')}</select>`)}
        ${row('邊緣', `<input type="range" data-bevel min="-1" max="1" step="0.05" value="${q.bevel ?? 0}">
          <i>${(q.bevel ?? 0) > 0 ? '鈍化' : (q.bevel ?? 0) < 0 ? '銳化' : '原樣'} ${r3(q.bevel ?? 0)}</i>`)}
        ${row('配色', `<input type="color" data-color value="${hex6(q.color ?? 0xb8c2cc)}">
          <button class="segb sm" data-act="colorClear">清除</button>`)}
        ${row('發光', `<input type="range" data-glow min="${DOLL_LIMITS.glow[0]}" max="${DOLL_LIMITS.glow[1]}"
          step="0.05" value="${q.glow ?? 1}"><i>${r3(q.glow ?? 1)}</i>`)}
        <div class="d-btns">
          <button class="segb" data-act="hide">${q.hide ? '顯示' : '隱藏'}這顆</button>
          <button class="segb" data-act="paste">黏貼複本</button>
          <button class="segb" data-act="pasteMirror">鏡射黏貼</button>
          <button class="segb" data-act="partReset">還原這顆</button>
        </div>
        <div class="d-note">黏貼 = 複製這顆零件掛到**目前選取的骨**底下(骨架分頁選骨);
          選不到骨就掛回它自己的骨。</div>` : ''}
      ${isAdd ? `<div class="d-btns"><button class="segb" data-act="addDrop">刪掉這件黏貼件</button></div>` : ''}
      <div class="d-list">${ed.doc.adds.map((a, i) => `<span class="d-chip${sel?.key === addKey(i) ? ' on' : ''}"
        data-pickadd="${i}">黏貼 ${i + 1}・${esc(a.src)}→${esc(a.to)}</span>`).join('')}</div>
      <div class="d-list">${edited.length ? edited.map((k) => `<span class="d-chip${sel?.key === k ? ' on' : ''}"
        data-pickpart="${esc(k)}">${esc(k)}</span>`).join('') : '<span class="d-dim">(還沒有零件調整)</span>'}</div>`;
  }

  function paintTab() {
    const P = ed.paint;
    return `
      <div class="d-note">選好圖樣後**點機體表面**貼上去(貼花投影到那顆零件,隨動畫一起動)。</div>
      ${seg('mark', markKinds().map((k) => [k, MARK_LABEL[k]]), P.kind)}
      ${row('顏色', `<input type="color" data-pcolor value="${hex6(P.color)}">`)}
      ${row('大小', `<input type="range" data-psize min="${DOLL_LIMITS.markSize[0]}" max="${DOLL_LIMITS.markSize[1]}"
        step="0.05" value="${P.size}"><i>${r3(P.size)} m</i>`)}
      ${row('旋轉', `<input type="range" data-prot min="-3.14" max="3.14" step="0.05" value="${P.rot}">
        <i>${Math.round((P.rot * 180) / Math.PI)}°</i>`)}
      ${row('文字', `<input type="text" data-ptext maxlength="${DOLL_LIMITS.text}" value="${esc(P.text)}"
        placeholder="(選填:塗鴉字/烙印字)">`)}
      <div class="d-list">${ed.doc.marks.length ? ed.doc.marks.map((m, i) =>
      `<span class="d-chip" data-dropmark="${i}">${MARK_LABEL[m.kind]} ${i + 1} ✕</span>`).join('')
      : '<span class="d-dim">(還沒有彩繪)</span>'}</div>`;
  }

  function render() {
    if (!panel) return;
    if (!ed.on) { panel.innerHTML = ''; panel.hidden = true; return; }
    panel.hidden = false;
    const st = dollStats(ed.doc);
    panel.innerHTML = `
      <h4>紙娃娃編輯 <small>${esc(ctx.specKey())}</small></h4>
      ${seg('tab', TABS, ed.tab)}
      <div class="d-body">${ed.tab === 'bone' ? boneTab() : ed.tab === 'part' ? partTab() : paintTab()}</div>
      <div class="d-foot">
        <button class="segb" data-act="save">💾 儲存</button>
        <button class="segb" data-act="reload">放棄變更</button>
        <button class="segb" data-act="clear">全部還原</button>
      </div>
      <div class="d-stat">骨 ${st.bones}・零件 ${st.parts}・彩繪 ${st.marks}・黏貼 ${st.adds}
        ${ed.msg ? `<b>${esc(ed.msg)}</b>` : ''}</div>
      <div class="d-dim">${esc(DOLL_NOTE)}</div>`;
    bind();
  }

  function bind() {
    const q = (s) => panel.querySelector(s);
    const all = (s) => panel.querySelectorAll(s);
    for (const b of all('[data-tab]')) b.onclick = () => {
      ed.tab = b.dataset.tab;
      ed.msg = '';
      // 選取跟著分頁走:骨架分頁只握骨、零件分頁只握零件/黏貼件。
      // 不清的話,在零件分頁上調「形狀/邊緣/配色」會寫進一個以**骨鍵**當零件鍵的格子 ——
      // 它通得過鍵的字集閘、存得進檔案,而且永遠對不到任何一顆零件(改了完全沒反應)。
      const want = ed.tab === 'bone' ? ['bone'] : ed.tab === 'part' ? ['part', 'add'] : ['bone', 'part', 'add'];
      if (ed.sel && !want.includes(ed.sel.type)) ed.sel = null;
      attach();
      render();
    };
    for (const b of all('[data-gizmo]')) b.onclick = () => { ed.gizmo = b.dataset.gizmo; attach(); render(); };
    for (const b of all('[data-mark]')) b.onclick = () => { ed.paint.kind = b.dataset.mark; render(); };
    for (const c of all('[data-pickbone]')) c.onclick = () => {
      ed.sel = { type: 'bone', key: c.dataset.pickbone };
      ed.lastBone = ed.sel.key;
      ed.tab = 'bone';
      attach(); render();
    };
    for (const c of all('[data-pickpart]')) c.onclick = () => { ed.sel = { type: 'part', key: c.dataset.pickpart }; attach(); render(); };
    for (const c of all('[data-pickadd]')) c.onclick = () => { ed.sel = { type: 'add', key: addKey(+c.dataset.pickadd) }; attach(); render(); };
    for (const c of all('[data-dropmark]')) c.onclick = () => { ed.doc.marks.splice(+c.dataset.dropmark, 1); rebuild(true); };
    const bs = q('[data-bone]');
    if (bs) bs.onchange = () => {
      ed.sel = bs.value ? { type: 'bone', key: bs.value } : null;
      if (bs.value) { ed.lastBone = bs.value; ensureBone(bs.value); }
      attach(); render();
    };
    /** 滑桿三件套:改值 → 就地更新標籤 → 重鍛但不重畫;放開才整片重畫 */
    const slider = (el, apply, label) => {
      if (!el) return;
      el.oninput = () => {
        apply(+el.value);
        const i = el.parentElement.querySelector('i');
        if (i) i.textContent = label(+el.value);
        rebuild(false, false);
      };
      el.onchange = () => render();
    };
    slider(q('[data-blen]'), (v) => {
      const b = ed.doc.bones[ed.sel.key] || (ed.doc.bones[ed.sel.key] = {});
      b.len = v;
    }, (v) => r3(v));
    const sh = q('[data-shape]');
    if (sh) sh.onchange = () => { patchPart({ shape: sh.value || undefined }); rebuild(true); };
    slider(q('[data-bevel]'), (v) => patchPart({ bevel: v }),
      (v) => `${v > 0 ? '鈍化' : v < 0 ? '銳化' : '原樣'} ${r3(v)}`);
    slider(q('[data-glow]'), (v) => patchPart({ glow: v }), (v) => r3(v));
    const col = q('[data-color]');
    if (col) col.oninput = () => { patchPart({ color: parseInt(col.value.slice(1), 16) }); rebuild(false, false); };
    // 彩繪參數只影響**下一枚**貼花(已貼上的住文件裡)⇒ 不必重鍛,只更新標籤
    const pc = q('[data-pcolor]');
    if (pc) pc.oninput = () => { ed.paint.color = parseInt(pc.value.slice(1), 16); };
    const ps = q('[data-psize]');
    if (ps) ps.oninput = () => {
      ed.paint.size = +ps.value;
      ps.parentElement.querySelector('i').textContent = `${r3(ed.paint.size)} m`;
    };
    const pr = q('[data-prot]');
    if (pr) pr.oninput = () => {
      ed.paint.rot = +pr.value;
      pr.parentElement.querySelector('i').textContent = `${Math.round((ed.paint.rot * 180) / Math.PI)}°`;
    };
    const pt = q('[data-ptext]');
    if (pt) pt.oninput = () => { ed.paint.text = pt.value; };
    for (const b of all('[data-act]')) b.onclick = () => act(b.dataset.act);
  }

  function patchPart(patch) {
    if (ed.sel?.type !== 'part') return;
    const q = ed.doc.parts[ed.sel.key] || (ed.doc.parts[ed.sel.key] = {});
    Object.assign(q, patch);
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete q[k];
  }

  async function act(a) {
    const sel = ed.sel;
    if (a === 'save') {
      const doc = sanitizeDoll(ed.doc);
      await ctx.save(isEmptyDoll(doc) ? null : doc);
      ed.msg = isEmptyDoll(doc) ? '與出廠相同,已清除紙娃娃覆寫' : '已儲存 ✔';
      return render();
    }
    if (a === 'reload') { ed.doc = sanitizeDoll(ctx.stored()); ed.sel = null; return rebuild(true); }
    if (a === 'clear') { ed.doc = emptyDoll(); ed.sel = null; return rebuild(true); }
    if (a === 'boneReset' && sel?.type === 'bone') { delete ed.doc.bones[sel.key]; return rebuild(true); }
    if (a === 'partReset' && sel?.type === 'part') { delete ed.doc.parts[sel.key]; return rebuild(true); }
    if (a === 'colorClear' && sel?.type === 'part') { patchPart({ color: undefined }); return rebuild(true); }
    if (a === 'hide' && sel?.type === 'part') {
      const q = ed.doc.parts[sel.key] || {};
      patchPart({ hide: q.hide ? undefined : true });
      return rebuild(true);
    }
    if (a === 'addDrop' && sel?.type === 'add') {
      ed.doc.adds.splice(Number(sel.key.slice(1)), 1);
      ed.sel = null;
      return rebuild(true);
    }
    if ((a === 'paste' || a === 'pasteMirror') && sel?.type === 'part') {
      // 黏到「目前選取的骨」;沒選骨就掛回這顆零件自己所屬的那根(掛在 mesh 底下也行,
      // 但掛在骨上才會跟著該肢體動,這是紙娃娃「換裝」要的行為)
      const mesh = ix()?.parts.get(sel.key);
      const to = ed.lastBone || (mesh ? boneOf(mesh) : null);
      if (!to) { ed.msg = '找不到可掛的骨'; return render(); }
      ed.doc.adds.push({ src: sel.key, to, p: [0, 0, 0], ...(a === 'pasteMirror' ? { mirror: true } : {}) });
      ed.sel = { type: 'add', key: addKey(ed.doc.adds.length - 1) };
      ed.msg = `已黏貼到 ${boneLabel(to)}`;
      return rebuild(true);
    }
    if (a === 'bonePose' && sel?.type === 'bone') {
      // 「複製目前姿勢」:把播放中的步態角固化成編輯值 —— 擺 pose 最快的一條路
      const I = ix();
      const bone = I?.bones.get(sel.key);
      if (!bone) return;
      const b = ed.doc.bones[sel.key] || (ed.doc.bones[sel.key] = {});
      b.r = [r3(bone.rotation.x), r3(bone.rotation.y), r3(bone.rotation.z)];
      ed.msg = '已固化目前姿勢';
      return rebuild(true);
    }
  }

  // ---- 對外 -------------------------------------------------------------------
  ctx.canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) ed._down = [e.clientX, e.clientY]; });
  ctx.canvas.addEventListener('pointerup', (e) => {
    // 只有「沒有拖動視角」的那一下才算點選(否則環繞鏡頭一放手就換選取)
    const d = ed._down;
    if (!d || tc.dragging || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 4) return;
    if (e.button === 0) pick(e);
  });

  return {
    ed,
    mount(el) { panel = el; render(); },
    setOn(on) {
      ed.on = on;
      if (!on) { ed.sel = null; }
      attach();
      render();
    },
    /** 換機體 / 重鍛之後:接手新的文件與新的樹 */
    load(doc) {
      ed.doc = sanitizeDoll(doc);
      ed.sel = null;
      ed.lastBone = null;    // 換機體 ⇒ 上一台的骨鍵在這一台可能根本不存在(黏貼會掛不上)
      ed.msg = '';
      attach();
      render();
    },
    refresh() { attach(); render(); },
    doc: () => ed.doc,
    dispose() { tc.detach(); tc.dispose(); tcHelper.parent?.remove(tcHelper); },
  };
}
