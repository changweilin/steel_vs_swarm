// ============ 離線量測工具共用:Playwright 解析 + 開伺服器 ============
// 本專案的 npm 依賴只有 `ws`(見 /CLAUDE.md §1),**MUST NOT** 把 playwright 寫進 package.json。
// 版型/陀螺儀量測屬開發期工具,故改成「找得到就跑、找不到就明確跳過」:
// 開發機請自行 `npm i -g playwright`(或放在 node_modules),CI 沒裝就只會印一行說明並以 0 結束。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    `${process.env.HOME || ''}/.npm-global/lib/node_modules/playwright/index.mjs`,
  ];
  for (const c of cands) {
    try {
      const m = c.startsWith('/') ? await import(c) : require(c);
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

/**
 * 開一個本專案的靜態伺服器(量測只需要 HTTP + 靜態檔,不必連 WS)。
 * 回傳 { url, close }。已經有人在該埠聽就直接沿用(不重複起,見 /CLAUDE.md 測試標準流程)。
 */
export async function serve(port = 8631) {
  const url = `http://localhost:${port}/`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(800) });
    if (r.ok) return { url, close: () => {} };
  } catch { /* 沒人在聽 → 自己起一個 */ }
  const ps = spawn(process.execPath, [join(ROOT, 'server', 'server.js'), '--port', String(port)],
    { stdio: 'ignore', cwd: ROOT });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (r.ok) return { url, close: () => ps.kill() };
    } catch { /* 還沒起來 */ }
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
