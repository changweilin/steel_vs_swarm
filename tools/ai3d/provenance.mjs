// ============ 照片資料家的身分宣告縫 ============
//
// `<家>/corpus.json` 讀取 + 路徑正規化。唯一消費端 = `tools/ai3d/fetch_photos.mjs`
// (`--adopt` 收非 CC0 的資格判定)。
//
// 三條紀律:
//   ① **沒有這個檔 = 出貨用**(舊行為逐位元不變)。
//   ② **讀不懂就當出貨用**(寧缺勿錯:壞掉的宣告檔 MUST NOT 變成放行非 CC0 的後門)。
//   ③ 這個家刻意住**儲存庫之外** ⇒ 只有明著帶路徑才讀得到。
//      ⇒「不會被誤拿去出貨」是**構造保證**,不是紀律。
//
// A2:零 npm 依賴。
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * **資料家路徑正規化**:`photos/` 目錄本身若帶著 `corpus.json` 的父目錄,
 * 回父目錄(家),否則原樣。
 */
export function normalizeCorpusHome(home) {
  if (!home) return home;
  const root = resolve(home);
  const parent = dirname(root);
  return basename(root).toLowerCase() === 'photos' && existsSync(join(parent, 'corpus.json')) ? parent : root;
}

/**
 * **資料家的身分宣告** `<家>/corpus.json`(2026-08-11 使用者定案:「授權問題的照片放在專案外
 * 一樣的路徑跑 img to 3D 管線,**先別放遊戲中**」)。
 *
 * 回 `{ shipping, why, declared }`:沒宣告 = 可以(逐位元同舊行為)。
 */
export function corpusMeta(home) {
  const p = join(normalizeCorpusHome(home) || '', 'corpus.json');
  if (!home || !existsSync(p)) return { shipping: true, why: null, declared: false };
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { shipping: j.shipping !== false, why: j.why || null, declared: true };
  } catch { return { shipping: true, why: null, declared: false }; }   // 紀律 ②
}
