// ============ 單機特化版打包(GitHub Actions → GitHub Pages)============
// 用法:node tools/build_solo.mjs [輸出目錄,預設 dist]
//
// 【這不是 build step】本檔**只做檔案複製**:沒有 bundler、沒有轉譯、沒有壓縮、沒有改寫任何一行原始碼
// (見 /CLAUDE.md §1「無 build step」)。理由是單機版與伺服器版跑的是**同一份程式碼**:
// 只要輸出的 URL 佈局鏡射儲存庫佈局(`/public/**` + `/server/*.js`),
// 瀏覽器裡 `public/js/localhost.js → ../../server/rooms.js → ../public/js/data.js` 這條 import 鏈就成立,
// 而且 `data.js` 在整個分頁裡是同一個模組實例(平衡數值只有一份)。
//
//   dist/
//     index.html          ← 轉址到 ./public/?mode=solo(GitHub Pages 專案站台是子路徑,故用相對網址)
//     .nojekyll           ← 不加這個,Jekyll 會吃掉底線開頭的檔案
//     public/**           ← 客戶端全部(含地圖/模型/音效資產)
//     server/sim.js|bots.js|rooms.js   ← 權威模擬 + 電腦玩家 + 房間中樞(在瀏覽器裡跑)
//
// **MUST NOT** 把 `server/server.js` 複製進去:那是 Node 傳輸層(import http/fs/ws),
// 靜態站台既跑不動也不需要,複製過去只會讓人誤以為靜態版有伺服器。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));

// 瀏覽器版單機要用到的伺服器模組(與 server/server.js 的 BROWSER_SERVER_FILES 同一份清單)
const SERVER_FILES = ['sim.js', 'bots.js', 'rooms.js'];

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let files = 0, bytes = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) {
      const r = copyDir(s, d);
      files += r.files; bytes += r.bytes;
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
      files++; bytes += fs.statSync(s).size;
    }
  }
  return { files, bytes };
}

const INDEX = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>無人戰略:鋼鐵與蜂群 — 單機版</title>
<meta http-equiv="refresh" content="0; url=./public/?mode=solo">
<link rel="icon" href="./public/favicon.png" type="image/png">
<style>
  body { background: #05070a; color: #9fb2bf; font-family: system-ui, sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  a { color: #6fd3ff; }
</style>
</head>
<body>
<p>載入單機版戰術終端…若沒有自動前往,請點 <a href="./public/?mode=solo">這裡</a>。</p>
<script>location.replace('./public/?mode=solo');</script>
</body>
</html>
`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const pub = copyDir(path.join(ROOT, 'public'), path.join(OUT, 'public'));

fs.mkdirSync(path.join(OUT, 'server'), { recursive: true });
for (const f of SERVER_FILES) fs.copyFileSync(path.join(ROOT, 'server', f), path.join(OUT, 'server', f));

fs.writeFileSync(path.join(OUT, 'index.html'), INDEX);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log('==============================================');
console.log('  單機特化版打包完成(純檔案複製,無 build step)');
console.log(`  輸出:   ${OUT}`);
console.log(`  public: ${pub.files} 個檔案 ・ ${mb(pub.bytes)}`);
console.log(`  server: ${SERVER_FILES.join(' / ')}`);
console.log('  本機預覽:npx --yes http-server dist -p 8621   然後開 http://localhost:8621/');
console.log('==============================================');
