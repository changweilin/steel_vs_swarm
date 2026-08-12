// ============ 原型參考照帶(兩座看板共用的標記;dev-only)============
// 「這一格的原型長什麼樣」是 3D 建模的設計權威。它有兩個消費端 ——
// 機體展示台 :8631 的側欄、機體美術覆核台 :8641 的鍛造區塊 —— 兩邊 MUST 是**同一份標記 +
// 同一份 CSS**(board.css),各寫一份「長得很像」的版面 = 它從此各自演化,而你在其中一台
// 看到的東西從來沒有在另一台出現過(CLAUDE.md 對 storyui.js 的同一條)。
//
// 名冊一律由伺服器推導(`/api/protoimgs` = 目錄本身、`/api/protorefs` = 採集帳本),
// **MUST NOT 在客戶端拼檔名** —— 拼出來的路徑在圖還沒採集時是 404,而畫面上只是一格破圖。
//
// 本檔零 import(含零 THREE):兩座看板的降級路徑不同(覆核台的 three 是動態 import),
// 參考照帶不該跟著 3D 一起消失。
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const CACHE = new Map();
/** 取名冊(逐 URL 快取:切角色會來回切,重取只是白費一趟) */
export async function apiImgs(url) {
  if (!CACHE.has(url)) {
    try {
      const r = await fetch(url);
      CACHE.set(url, r.ok ? await r.json() : {});
    } catch { CACHE.set(url, {}); }
  }
  return CACHE.get(url);
}

/** 2D 定案圖的圖說(檔名 → 型態・姿態;檔名規則的唯一解讀處) */
export const protoCap = (file) => {
  const form = file.includes('_flight_') ? '飛行型・' : file.includes('_ground_') ? '地面型・' : '';
  const pose = file.includes('moving') ? '移動' : file.includes('heavy') ? '重擊' : '定裝';
  return form + pose;
};

/** 2D 定案圖帶(`/api/protoimgs` 的 `imgs`) */
export function artStripHTML(imgs) {
  return imgs?.length
    ? imgs.map((m) => `<figure class="proto"><a href="${m.url}" target="_blank" rel="noopener">
        <img src="${m.url}" alt="${esc(m.file)}" loading="lazy"></a>
        <figcaption>${protoCap(m.file)}</figcaption></figure>`).join('')
    : '<div class="dim">(這一格還沒有 2D 定案圖)</div>';
}

/**
 * 真實原型參考照帶(`/api/protorefs` 的 `layers`)。
 * 授權與作者**逐張印出來** —— 這批圖是 CC0/PD 採集來的,圖說就是它的授權憑據
 * (帳本在 tools/proto_refs/manifest.json,採集走 tools/fetch_protorefs.mjs)。
 */
export function refStripHTML(layers, key = '') {
  return layers?.length ? layers.map((L) => `
    <div class="ref-src"><b>${esc(L.label)}</b> ${esc(L.src)}
      ${L.note ? `<span>—— ${esc(L.note)}</span>` : ''}</div>
    <div class="proto-strip">${L.imgs.length
    ? L.imgs.map((m) => `<figure class="proto${m.user ? ' user' : ''}">
          <a href="${m.url}" target="_blank" rel="noopener">
          <img src="${m.url}" alt="${esc(m.file)}" loading="lazy"></a>
          <figcaption>${m.user ? '使用者提供' : `${esc(m.license)} ・ ${esc(m.creator || '—')}`}</figcaption>
          ${key ? `<div class="ref-act">
            <button class="segb sm" data-refbad="${esc(m.file)}" data-layer="${esc(L.key)}"
              title="這張完全不符合原型:刪掉並記進黑名單(下一輪不會再抓回來)">✕ 不符</button>
            <button class="segb sm" data-refnote="${esc(m.file)}" data-layer="${esc(L.key)}"
              title="寫一句話:這張哪裡對、哪裡不對">✎</button>
          </div>` : ''}
          ${m.note ? `<div class="ref-note">${esc(m.note)}</div>` : ''}</figure>`).join('')
    : '<div class="dim">(未採集;跑 node tools/fetch_protorefs.mjs)</div>'}</div>
    ${key ? refTuneHTML(L) : ''}`).join('')
    : '<div class="dim">(這一格沒有原型層)</div>';
}

/**
 * 逐層的「重新搜索」控制(2026-08-12 使用者:「加入標記與註解以重新搜索,或是使用者直接
 * 貼上照片」)。兩個出口:
 *   ㋐ **關鍵詞覆寫** —— 存進帳本,下一次 `node tools/fetch_protorefs.mjs` 就用它去找;
 *      這裡**刻意不連外網**(看板負責講清楚要找什麼,採集是採集端的事,節流也都在那邊)。
 *   ㋑ **自己貼照片** —— 貼上/拖進來/選檔都行,授權欄一律標 `user`。
 * 欄位預設帶的是「現在真的在用的那一個查詢詞」,MUST NOT 留白讓人自己猜。
 */
function refTuneHTML(L) {
  return `<div class="ref-tune" data-layer="${esc(L.key)}">
    <label class="ref-q"><span>搜尋詞</span>
      <input type="text" data-q value="${esc(L.q || '')}"
        placeholder="換一組英文關鍵詞(型號/廠牌比通名準)"></label>
    <label class="ref-q"><span>註解</span>
      <input type="text" data-tnote value="${esc(L.tuneNote || '')}"
        placeholder="這一層原本抓到什麼、為什麼不對"></label>
    <div class="ref-tbtn">
      <button class="segb sm" data-save>💾 存搜尋詞</button>
      <button class="segb sm" data-paste>📋 貼上照片</button>
      <label class="segb sm" style="cursor:pointer">📁 選檔<input type="file" accept="image/*"
        data-file hidden multiple></label>
      <span class="ref-tstat">${L.over ? '已覆寫' : '推導詞'}${L.rejects ? ` ・ 黑名單 ${L.rejects}` : ''}</span>
    </div>
  </div>`;
}

/** 三條寫入路由的唯一呼叫處(兩座看板同吃;MUST NOT 任一端自己拼 fetch) */
export const refPost = async (act, body) => {
  const r = await fetch(`/api/protorefs/${act}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || j.why || `HTTP ${r.status}`);
  return j;
};

/** 檔案 → dataURL(貼上/拖曳/選檔三條路共用) */
export const fileToDataURL = (f) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(new Error('讀不到這個檔'));
  fr.readAsDataURL(f);
});

/**
 * 把上面那些鈕接起來(**標記與重搜的行為也只有一份**:標記在這裡產生,事件就該在這裡綁 ——
 * 兩座看板各綁一份的話,其中一座遲早少一個 `dropRefsCache`,而症狀是「我標了它還在」)。
 * @param box  參考照帶的容器
 * @param key  roster key(空的話這一帶是唯讀,不會有任何鈕)
 * @param reload 重畫這一帶(呼叫端自己知道要怎麼重取)
 */
export function bindRefStrip(box, key, reload) {
  if (!box || !key) return;
  const upload = async (layer, files, note = '') => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try { await refPost('upload', { key, layer, data: await fileToDataURL(f), note }); }
      catch (e) { alert(`貼上失敗:${e.message}`); }
    }
    reload();
  };

  for (const b of box.querySelectorAll('[data-refbad]')) {
    b.onclick = async () => {
      // 判不符 = 刪檔 + 進黑名單 ⇒ 不可逆,先問一句;順手收「為什麼不對」當這一層的註解
      const note = prompt('這張哪裡不符合原型?(會存成這一層的註解,下一輪照它調整搜尋詞)', '');
      if (note === null) return;
      try { await refPost('reject', { key, layer: b.dataset.layer, file: b.dataset.refbad, note }); }
      catch (e) { alert(`標記失敗:${e.message}`); }
      reload();
    };
  }
  for (const b of box.querySelectorAll('[data-refnote]')) {
    b.onclick = async () => {
      const note = prompt('這張圖的註解(留白 = 清掉)', '');
      if (note === null) return;
      try { await refPost('annotate', { key, layer: b.dataset.layer, file: b.dataset.refnote, note }); }
      catch (e) { alert(`註解失敗:${e.message}`); }
      reload();
    };
  }
  for (const t of box.querySelectorAll('.ref-tune')) {
    const layer = t.dataset.layer;
    const note = () => t.querySelector('[data-tnote]').value;
    t.querySelector('[data-save]').onclick = async () => {
      try { await refPost('retune', { key, layer, q: t.querySelector('[data-q]').value, note: note() }); }
      catch (e) { alert(`存不進去:${e.message}`); }
      reload();
    };
    t.querySelector('[data-paste]').onclick = async () => {
      // clipboard.read 要使用者手勢 + 權限;拿不到 MUST 講清楚還有哪兩條路,
      // MUST NOT 靜默什麼都沒發生(那看起來就像這顆鈕壞了)
      try {
        const items = await navigator.clipboard.read();
        const files = [];
        for (const it of items) {
          const type = it.types.find((x) => x.startsWith('image/'));
          if (type) files.push(new File([await it.getType(type)], 'paste', { type }));
        }
        if (!files.length) return alert('剪貼簿裡沒有圖片(複製一張圖再按,或直接把檔案拖進這一塊)');
        await upload(layer, files, note());
      } catch (e) { alert(`讀不到剪貼簿(${e.message})—— 也可以把圖片檔拖進這一塊,或用「選檔」`); }
    };
    t.querySelector('[data-file]').onchange = (ev) => upload(layer, [...ev.target.files], note());
    // 拖進來:整塊都是投放區(dragover MUST preventDefault,否則瀏覽器直接開那張圖)
    t.ondragover = (ev) => { ev.preventDefault(); t.classList.add('drop'); };
    t.ondragleave = () => t.classList.remove('drop');
    t.ondrop = (ev) => {
      ev.preventDefault();
      t.classList.remove('drop');
      upload(layer, [...ev.dataTransfer.files], note());
    };
  }
}

/** 取某一格(roster key)的原型參考照名冊 */
export const fetchRefs = (key) => apiImgs(`/api/protorefs?key=${encodeURIComponent(key)}`);
/** 剛改過帳本(判不符/註解/貼上)⇒ 丟掉這一格的快取,否則畫面會停在改之前那一份 */
export const dropRefsCache = (key) => CACHE.delete(`/api/protorefs?key=${encodeURIComponent(key)}`);
/** 取某一名角色的 2D 定案圖名冊 */
export const fetchArt = (ch) => apiImgs(`/api/protoimgs?id=${encodeURIComponent(ch)}`);
