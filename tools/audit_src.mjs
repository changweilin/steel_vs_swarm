// ============ 稽核共用:讀「執行原文」與抽方法區塊 ============
// 一批稽核(audit_minimap_view / audit_cc_flash …)不 import 客戶端模組,而是**讀原始碼文字**:
// game.js 的 three 走 CDN importmap,Node 端解析不了整支;抄一份公式進稽核則永遠會通過。
// 這支把兩件跨檔重複的事收成單一縫:
//   ① `readSrc()` —— 讀檔並把換行正規化成 `\n`。
//      **為什麼一定要正規化**:稽核大量用「逐行剝註解」`line.replace(/\/\/.*$/, '')` 與
//      `split('\n')` 處理原文。JS 的 `.` 不吃 `\r`、`$`(無 m 旗標)也不匹配 `\r` 之前,
//      於是 CRLF 檢出的工作區裡**整條剝註解規則靜默失效** —— 註解裡提到的名字被算進
//      「全檔只有 N 處」的單一縫計數、`MM_NEAR` 連著 `//` 註解被丟進 JSON.parse 直接炸。
//      同一份程式碼在 LF 全綠、CRLF 紅字,是稽核本身的可攜性 bug,不是被驗的程式碼有問題。
//      正規化只做在**進稽核的那一刻**(不改檔),⇒ 不論工作區怎麼檢出,稽核判讀一致。
//   ② `grabMethod()` —— 以大括號配對抽出 class 方法原文(含區塊),供 `new Function` 直測行為。
// 消費端 MUST 走這兩支,MUST NOT 自己 `readFileSync` 原文或再抄一份大括號配對。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 儲存庫根目錄(本檔在 tools/ 底下) */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 讀原文;換行一律正規化為 `\n`(CRLF / 單獨 CR 檢出的工作區也驗得準) */
export const readSrc = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n?/g, '\n');

/** 從 `i` 起做大括號配對,回傳到區塊結束為止的原文(grabMethod / grabFn 共用,MUST NOT 各抄一份) */
const grabAt = (src, i) => {
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
};

/**
 * 抽出 class 方法的原文(含大括號區塊)。
 * @param {string} src  已正規化的原文
 * @param {string} name 方法名(以 `\n  name(` 定位 —— 兩格縮排 = class 成員)
 */
export const grabMethod = (src, name) => {
  const i = src.indexOf(`\n  ${name}(`);
  if (i < 0) throw new Error(`找不到 ${name}`);
  return grabAt(src, i);
};

/**
 * 抽出**頂層具名函式**的原文(含大括號區塊);供非 class 的模組(server.js 等)用。
 * @param {string} src  已正規化的原文
 * @param {string} name 函式名(以 `\nfunction name(` 定位 —— 零縮排 = 模組頂層)
 */
export const grabFn = (src, name) => {
  const i = src.indexOf(`\nfunction ${name}(`);
  if (i < 0) throw new Error(`找不到 function ${name}`);
  return grabAt(src, i);
};
