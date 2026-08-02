// ============ NPC / 攻擊建築 圖示(圖鑑選項的小圖,單一縫)============
// 2026-07-31 使用者定案:NPC 選項加入簡單圖示。
//
// 為什麼是內嵌 SVG 而不是 3D 模組截圖:
//   ① 零資產、零載入、零快取失效 —— 圖鑑格是 96px 寬的小方塊,截圖在這個尺寸只剩一團色塊;
//   ② `currentColor` 讓圖示直接吃選取態(.segb.on / .unit-btn.on)與陣營色,截圖做不到;
//   ③ 確定性:圖示與 `UNITS` 同一份鍵集,新增兵種漏畫會直接退回問號而不是壞圖。
// 風格對齊陣營軍旗(index.html `.crest`):平塗硬邊、無漸層、無描邊寬度變化,一律 24×24 視框。
//
// 純表現層。MUST NOT 拿它當兵種存在性的真相 —— 名冊仍是 `data.js UNITS` / `THIRD.COMP`。

/** kind → SVG 內容(不含 <svg> 外框;外框由 npcIconHTML 統一產生)*/
export const NPC_ICONS = {
  // 步兵:鋼盔 + 軀幹 + 步槍
  soldier: '<path d="M6 7a5 5 0 0 1 9 0v1H6z"/><path d="M4 7h13v1.6H4z"/>'
    + '<path d="M7.5 10h6L16 13v11H5V13z"/><path d="M17 9.4h5V11h-5z"/><path d="M18.6 11h1.6v4h-1.6z"/>',
  // 火箭兵:肩扛發射管(尾焰口在後)
  rocketeer: '<path d="M6 8a5 5 0 0 1 9 0v1H6z"/><path d="M7.5 11h6L16 14v10H5V14z"/>'
    + '<path d="M8 4.6h11V8H8z"/><path d="M19 3.2l4 3.1-4 3.1z"/><path d="M5 4.6h3V8H5z"/>',
  // 榴彈砲:大車輪 + 高仰角砲管 + 駐鋤
  howitzer: '<circle cx="9" cy="17" r="6"/><path d="M9 14.6L21 3l2.4 2.4-12 11.6z"/>'
    + '<path d="M4 14l-3 8h4l2.6-6.4z"/><path d="M6 12.6h7V16H6z"/>',
  // 坦克:履帶 + 車體 + 砲塔 + 砲管
  tank: '<path d="M1 17h22v5H1z"/><path d="M3 12h18v4H3z"/><path d="M8 7h7v4H8z"/>'
    + '<path d="M14 8.2h9v1.8h-9z"/>',
  // 裝甲車:斜首車體 + 三輪
  apc: '<path d="M2 11l4-4h11l4 5v3H2z"/><path d="M13 8.4h9V10h-9z"/>'
    + '<circle cx="6" cy="18" r="3"/><circle cx="12.5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/>',
  // 直升機:主旋翼 + 機身 + 尾桁 + 尾旋翼
  heli: '<path d="M2 4h20v1.8H2z"/><path d="M11.2 5.8h1.6V8h-1.6z"/>'
    + '<path d="M6 8h9l3 3v4H6z"/><path d="M15 10.6h8V13h-8z"/><path d="M21 8h1.8v8H21z"/>'
    + '<path d="M5 18h12v1.8H5z"/><path d="M7 15h1.6v3H7z"/><path d="M14 15h1.6v3H14z"/>',
  // 砲塔:基座 + 立柱 + 砲頭
  tower: '<path d="M3 20h18v3H3z"/><path d="M8 10h8v10H8z"/><path d="M6 4h12v6H6z"/>'
    + '<path d="M17 6h6v2.2h-6z"/><path d="M11 1h2v3h-2z"/>',
  // 主堡:雉堞城牆 + 主樓 + 拱門
  base: '<path d="M1 8h3v3H1zM6 8h3v3H6zM11 8h3v3h-3zM16 8h3v3h-3zM21 8h2v3h-2z"/>'
    + '<path d="M1 11h22v12H1z"/><path d="M9 15h6v8H9z" fill="#05070a"/>'
    + '<path d="M9 4h6v4H9z"/><path d="M11 1h2v3h-2z"/>',
  // 碉堡:低矮掩體 + 射孔
  bunker: '<path d="M2 20h20v3H2z"/><path d="M4 11a8 8 0 0 1 16 0v9H4z"/>'
    + '<path d="M7 13.6h10V17H7z" fill="#05070a"/>',
  // 平民:無武裝人形
  civilian: '<circle cx="12" cy="5.5" r="4"/><path d="M6 24v-8a6 6 0 0 1 12 0v8z"/>',
  // 未列名兵種的保底(名冊擴張時看得出「這裡漏畫了」,而不是破圖)
  _: '<path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22zm-1 16h2v2h-2zm3.6-6.4c0 2-2.6 2.2-2.6 4h-2c0-2.6 2.6-2.8 2.6-4a1.6 1.6 0 0 0-3.2 0H7.4a3.6 3.6 0 0 1 7.2 0z"/>',
};

/**
 * 圖鑑選項的小圖(消費端唯一取字處)。
 * `currentColor` 是刻意的 —— 選取態/陣營色由外層 class 決定,圖示自己 MUST NOT 寫死顏色。
 */
export const npcIconHTML = (kind) =>
  `<svg class="npc-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${NPC_ICONS[kind] || NPC_ICONS._}</svg>`;

// ============ 機種圖示(無人機 / 機甲 / 變形者;標在頭像旁邊)============
// 2026-08-02 使用者定案:「設計無人機/機甲/變形者的圖示,標示在頭像旁邊」。
//
// 為什麼與 NPC 圖示同住一支:兩者是同一件事(平塗 24×24、吃 `currentColor`、缺鍵回退問號),
// 分兩支就會長出兩套風格與兩份保底規則。**名冊真相仍是 `data.js CHARACTERS[ch].kind`** ——
// 2026-08-02 機體混編後陣營 ≠ 機種,圖示 MUST 由 `charKind()` 取,MUST NOT 由 `side` 推。
export const KIND_ICONS = {
  // 無人機:X 形機臂 + 四片旋翼盤 + 中央機身
  drone: '<path d="M3.6 5L5 3.6l5.6 5.6-1.4 1.4z"/><path d="M19 3.6L20.4 5l-5.6 5.6-1.4-1.4z"/>'
    + '<path d="M5 20.4L3.6 19l5.6-5.6 1.4 1.4z"/><path d="M20.4 19L19 20.4l-5.6-5.6 1.4-1.4z"/>'
    + '<circle cx="4.6" cy="4.6" r="3.2"/><circle cx="19.4" cy="4.6" r="3.2"/>'
    + '<circle cx="4.6" cy="19.4" r="3.2"/><circle cx="19.4" cy="19.4" r="3.2"/>'
    + '<path d="M9 9h6v6H9z"/>',
  // 機甲:座艙頭 + 厚軀幹 + 雙肩掛架 + 雙腿(人形雙足,與 buildRobotMech 的剪影一致)
  robot: '<path d="M8 1h8v4.2H8z"/><path d="M9.6 2.4h4.8V4H9.6z" fill="#05070a"/>'
    + '<path d="M6 6h12v9H6z"/><path d="M2 7.4h3.4v6H2z"/><path d="M18.6 7.4H22v6h-3.4z"/>'
    + '<path d="M7 16h3.4v7H7z"/><path d="M13.6 16H17v7h-3.4z"/>',
  // 變形者:飛行型機首 + 後掠翼,底下接地面型雙腿 —— 兩種型態同時出現 = 「會變形」
  morph: '<path d="M12 1.6l4.6 5.2H7.4z"/><path d="M8 7.4h8v7.6H8z"/>'
    + '<path d="M7.6 8.6L1 12.4l6.6 1.2z"/><path d="M16.4 8.6L23 12.4l-6.6 1.2z"/>'
    + '<path d="M8.2 16h3v6.8h-3z"/><path d="M13 16h3v6.8h-3z"/>',
};

/**
 * 機種圖示(消費端唯一取字處;頭像角標 / 角色卡標籤共用)。
 * 未知機種回退 `NPC_ICONS._` 的問號圖 —— 與 NPC 圖示同一條保底規則,漏畫看得出來而不是破圖。
 */
export const kindIconHTML = (kind) =>
  `<svg class="kind-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${KIND_ICONS[kind] || NPC_ICONS._}</svg>`;
