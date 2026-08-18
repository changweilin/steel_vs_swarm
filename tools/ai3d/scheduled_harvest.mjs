#!/usr/bin/env node
/**
 * 定時執行照片搜尋與擴充任務 (依據免費 API 額度與冷卻窗期)
 *
 * 職責:
 *   1. 依據免費 API (Openverse, Wikimedia Commons, Pexels, Pixabay, Unsplash, Google)
 *      的速率限制與冷卻時間 (預設每輪間隔 15 分鐘)，定時循環搜尋並擴充零件庫照片。
 *   2. 符合零件庫分類 (tree, rock, building, landmark 等各零件槽位) 與乾淨背景取景要求。
 *   3. 全域跨資料庫去重，已存在照片不重複下載。
 *   4. 授權自動分流:
 *      - CC0 / Public Domain -> C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d\photos (專案出貨庫)
 *      - 其他非 CC0 (CC-BY, CC-BY-SA, Unsplash 等) -> C:\Users\user\Documents\study\ai3d_restricted\photos (限制授權研究庫)
 *
 * 用法:
 *   node tools/ai3d/scheduled_harvest.mjs                  # 預設執行 1 輪 (每輪 20 張上限)
 *   node tools/ai3d/scheduled_harvest.mjs --every 15 --rounds 0  # 定時每 15 分鐘持續循環執行
 *   node tools/ai3d/scheduled_harvest.mjs --rounds 4 --every 15  # 定時執行 4 輪，每輪間隔 15 分鐘
 *   node tools/ai3d/scheduled_harvest.mjs --family rock          # 僅搜尋特定分類 (如 rock)
 *   node tools/ai3d/scheduled_harvest.mjs --limit 10             # 設定每輪下載上限 10 張
 *   node tools/ai3d/scheduled_harvest.mjs --dry                  # 模擬測試 (不真正下載與寫入)
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const ROUNDS = Number(opt('rounds', '1'));
const FOREVER = !(ROUNDS > 0) || flag('forever') || (argv.includes('--rounds') && ROUNDS === 0);
const EVERY_MIN = Number(opt('every', '15'));
const LIMIT = Number(opt('limit', '20'));
const FAMILY = opt('family');
const PART = opt('part');
const DRY = flag('dry');
const PLAN = flag('plan');

function runFetchPhotos() {
  return new Promise((resolve) => {
    const args = [
      join(HERE, 'fetch_photos.mjs'),
      '--route-license',
      '--limit', String(LIMIT),
    ];
    if (FAMILY) args.push('--family', FAMILY);
    if (PART) args.push('--part', PART);
    if (DRY) args.push('--dry');
    if (PLAN) args.push('--plan');

    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('====================================================================');
  console.log('       零件庫照片定時擴充任務 (授權自動分流 + API 額度調度)');
  console.log('====================================================================');
  console.log('  排程模式:   ' + (FOREVER ? '持續循環執行 (FOREVER)' : `執行 ${ROUNDS} 輪`));
  console.log('  冷卻間隔:   ' + EVERY_MIN + ' 分鐘 (符合 API 限流窗期與 429 退避規範)');
  console.log('  單輪上限:   ' + LIMIT + ' 張');
  if (FAMILY) console.log('  指定分類:   ' + FAMILY);
  if (PART) console.log('  指定零件:   ' + PART);
  if (DRY) console.log('  執行模式:   乾跑測試 (DRY RUN)');

  let currentRound = 1;
  while (FOREVER || currentRound <= ROUNDS) {
    const tag = FOREVER ? '' : `/${ROUNDS}`;
    console.log(`\n▶ [${new Date().toLocaleTimeString()}] 開始執行第 ${currentRound}${tag} 輪任務...`);
    const ok = await runFetchPhotos();
    if (PLAN) break;

    if (FOREVER || currentRound < ROUNDS) {
      const nextTime = new Date(Date.now() + EVERY_MIN * 60_000).toLocaleTimeString();
      console.log(`\n⏳ 第 ${currentRound} 輪結束。依 API 免費額度與冷卻規範，等待 ${EVERY_MIN} 分鐘後執行下一輪...`);
      console.log(`   (下次執行時間約為: ${nextTime})`);
      await sleep(EVERY_MIN * 60_000);
    }
    currentRound++;
  }

  console.log('\n✓ 定時擴充任務排程已完成。');
}

process.on('SIGINT', () => {
  console.log('\n\n⏹ 接收到中斷訊號，已安全停止定時排程。');
  process.exit(0);
});

main().catch((e) => {
  console.error('執行失敗:', e);
  process.exit(1);
});
