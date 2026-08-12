// ============ 離線量測工具共用:Playwright 解析 + 開伺服器 ============
// 本專案的 npm 依賴只有 `ws`(見 /CLAUDE.md §1),**MUST NOT** 把 playwright 寫進 package.json。
// 版型/陀螺儀量測屬開發期工具,故改成「找得到就跑、找不到就明確跳過」:
// 開發機請自行 `npm i -g playwright`(或放在 node_modules),CI 沒裝就只會印一行說明並以 0 結束。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// 伺服器路徑一律由本檔位置推導 —— 量測工具常從別的 cwd 呼叫,相對路徑會找不到 server.js
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
];

/** 取得 playwright 的 chromium;找不到回傳 null(呼叫端印訊息後以 0 結束,不當成失敗) */
export async function chromiumOrNull() {
  const cands = [
    process.env.PW_MODULE,                       // 明確指定(裝在專案外的沙箱/CI 用)
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    `${process.env.HOME || ''}/.npm-global/lib/node_modules/playwright/index.mjs`,
    // Windows 全域安裝(`npm i -g playwright`)。少了這條,Windows 開發機每次都得手動
    // 設 PW_MODULE,而症狀是所有截圖工具一律印「找不到 playwright」直接跳過 = 假綠。
    `${process.env.APPDATA || ''}/npm/node_modules/playwright/index.mjs`,
  ].filter(Boolean);
  for (const c of cands) {
    try {
      // 絕對路徑一律走動態 import 並先轉成 file:// URL:playwright 的入口是 `.mjs`,
      // `require()` 吃不下(丟 ERR_REQUIRE_ESM),而 Windows 的 `C:/…` 不以 `/` 開頭 ⇒
      // 舊判斷會把它送進 require 然後靜默落到下一個候選。
      const abs = c.startsWith('/') || c.startsWith('file:') || /^[A-Za-z]:[\\/]/.test(c);
      const m = abs ? await import(c.startsWith('file:') ? c : pathToFileURL(c).href) : require(c);
      if (m?.chromium) return m.chromium;
    } catch { /* 下一個候選 */ }
  }
  return null;
}

/** 若環境變數指定了瀏覽器路徑或找得到預裝 chromium 就回傳,否則 undefined(交給 playwright 自己找) */
export function chromePath() {
  if (process.env.PW_CHROME && existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  return CHROME.find((p) => existsSync(p));
}

/** 這一頁到底是不是遊戲?(見 serve() 的沿用閘) */
const GAME_MARK = 'id="touchLayer"';
const isGame = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(800) });
    return r.ok && (await r.text()).includes(GAME_MARK);
  } catch { return false; }
};

/**
 * 開一個本專案的靜態伺服器(量測只需要 HTTP + 靜態檔,不必連 WS)。
 * 回傳 { url, close }。已經有人在該埠聽就直接沿用(不重複起,見 /CLAUDE.md 測試標準流程)。
 *
 * ⚠ **沿用前 MUST 確認那真的是遊戲**(2026-08-12 補):舊版只問「有沒有人在聽」,而
 * 預設埠 8631 與**機體展示台**(tools/humanoid_forge.mjs 的 DEFAULT_PORT)是同一個 ——
 * 開著看板跑 `audit_ui_layout`,量到的是看板那一頁:這一次它剛好炸在 `#touchLayer` 是
 * null,但同一個坑在別的量測工具上會安靜地量到別的頁面然後**全綠**。
 * 認不出來 MUST 換一個埠自己起,MUST NOT 沿用(也 MUST NOT 殺掉別人的伺服器)。
 */
export async function serve(port = 8631) {
  let p = port;
  if (await isGame(`http://localhost:${p}/`)) return { url: `http://localhost:${p}/`, close: () => {} };
  // 這個埠上有東西但不是遊戲 ⇒ 往後找一個沒人聽的埠自己起
  for (let i = 0; i < 20 && await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(400) })
    .then(() => true).catch(() => false); i++) p += 1;
  const url = `http://localhost:${p}/`;
  const ps = spawn(process.execPath, [join(ROOT, 'server', 'server.js'), '--port', String(p)],
    { stdio: 'ignore', cwd: ROOT });
  for (let i = 0; i < 40; i++) {
    if (await isGame(url)) return { url, close: () => ps.kill() };
    await new Promise((r) => setTimeout(r, 150));
  }
  ps.kill();
  throw new Error(`伺服器起不來:${url}`);
}

/** 找不到 playwright 時的統一出口:印說明、以 0 結束(不擋 CI) */
export function skipNoPlaywright(what) {
  console.log(`⏭  跳過${what}:找不到 playwright(開發機請 npm i -g playwright)`);
  process.exit(0);
}

/**
 * three 的等價 stub(**只實作 mobile.js 用到的四個 API**)。
 * three 走 CDN importmap,沙箱/CI 常被擋 ⇒ 量測時攔截該網址換成這一份;
 * 兩支觸控稽核(audit_gyro / audit_touch_gesture)**共用同一份** —— 各留一份就會漂。
 * 用法:page.route(THREE_CDN, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: THREE_STUB }))
 */
export const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';
export const THREE_STUB = `
const cp = (a, b) => ({
  x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
  y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
  z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  applyQuaternion(q) {
    const { x: vx, y: vy, z: vz } = this;
    const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
    this.x = vx + q.w * tx + q.y * tz - q.z * ty;
    this.y = vy + q.w * ty + q.z * tx - q.x * tz;
    this.z = vz + q.w * tz + q.x * ty - q.y * tx;
    return this;
  }
}
export class Euler {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.order = 'XYZ'; }
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; this.order = order; return this; }
}
export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  setFromAxisAngle(axis, angle) {
    const h = angle / 2, s = Math.sin(h);
    this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s; this.w = Math.cos(h);
    return this;
  }
  setFromEuler(e) {
    if (e.order !== 'YXZ') throw new Error('stub 只實作 YXZ');
    const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2);
    const s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 - s1 * s2 * c3;
    this.w = c1 * c2 * c3 + s1 * s2 * s3;
    return this;
  }
  multiply(q) { const r = cp(this, q); this.x = r.x; this.y = r.y; this.z = r.z; this.w = r.w; return this; }
}
`;
