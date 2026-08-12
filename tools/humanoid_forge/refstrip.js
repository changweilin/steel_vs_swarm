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
export function refStripHTML(layers) {
  return layers?.length ? layers.map((L) => `
    <div class="ref-src"><b>${esc(L.label)}</b> ${esc(L.src)}
      ${L.note ? `<span>—— ${esc(L.note)}</span>` : ''}</div>
    <div class="proto-strip">${L.imgs.length
    ? L.imgs.map((m) => `<figure class="proto"><a href="${m.url}" target="_blank" rel="noopener">
          <img src="${m.url}" alt="${esc(m.file)}" loading="lazy"></a>
          <figcaption>${esc(m.license)} ・ ${esc(m.creator || '—')}</figcaption></figure>`).join('')
    : '<div class="dim">(未採集;跑 node tools/fetch_protorefs.mjs)</div>'}</div>`).join('')
    : '<div class="dim">(這一格沒有原型層)</div>';
}

/** 取某一格(roster key)的原型參考照名冊 */
export const fetchRefs = (key) => apiImgs(`/api/protorefs?key=${encodeURIComponent(key)}`);
/** 取某一名角色的 2D 定案圖名冊 */
export const fetchArt = (ch) => apiImgs(`/api/protoimgs?id=${encodeURIComponent(ch)}`);
