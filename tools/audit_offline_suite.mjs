#!/usr/bin/env node
/**
 * tools/audit_offline_suite.mjs
 *
 * 離線回歸驗證套件 (Offline Presentation & World Audit Suite)
 * 收錄視覺風格、環境裝飾、天候動態與世界觀圖鑑等 21 項非核心離線稽核。
 * 供本機美術與文案專項維護時隨時調用，不阻擋主線 CI。
 *
 * 用法:
 *   node tools/audit_offline_suite.mjs
 *   npm run audit:offline
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const OFFLINE_AUDIT_SCRIPTS = [
  // ── A. 純視覺風格與賽璐璐渲染管線 (8 項) ──
  'tools/audit_cel_pipeline.mjs',
  'tools/audit_visual_prefs.mjs',
  'tools/audit_soft_stroke.mjs',
  'tools/audit_struct_ink.mjs',
  'tools/audit_base_water_pad.mjs',
  'tools/audit_rock_ink.mjs',
  'tools/audit_leaf_card.mjs',
  'tools/audit_water_edge.mjs',

  // ── B. 環境裝飾與背景動態 (6 項) ──
  'tools/audit_ambient_motion.mjs',
  'tools/audit_wildlife.mjs',
  'tools/audit_aquatics.mjs',
  'tools/audit_daynight.mjs',
  'tools/audit_weather_dynamics.mjs',
  'tools/audit_weather_visuals.mjs',

  // ── C. 世界觀文案、圖鑑與生成提示詞 (7 項) ──
  'tools/audit_codex.mjs',
  'tools/audit_vernacular.mjs',
  'tools/audit_world_text.mjs',
  'tools/audit_vehicle_spec.mjs',
  'tools/audit_siteplan.mjs',
  'tools/audit_beacons.mjs',
  'tools/audit_venue_biome.mjs --offline',
];

console.log(`== 執行離線表現層與世界觀驗證 (${OFFLINE_AUDIT_SCRIPTS.length} 項離線稽核) ==\n`);

let passed = 0;
let failed = 0;
const failures = [];

const t0 = Date.now();

for (let i = 0; i < OFFLINE_AUDIT_SCRIPTS.length; i++) {
  const item = OFFLINE_AUDIT_SCRIPTS[i];
  const [script, ...args] = item.split(' ');
  const label = `[${i + 1}/${OFFLINE_AUDIT_SCRIPTS.length}] ${item}`;
  process.stdout.write(`${label.padEnd(50, ' ')} ... `);

  const res = spawnSync('node', [resolve(rootDir, script), ...args], {
    cwd: rootDir,
    encoding: 'utf-8',
    env: process.env,
  });

  if (res.status === 0) {
    passed++;
    console.log('✅ PASS');
  } else {
    failed++;
    console.log('❌ FAIL');
    failures.push({
      item,
      output: (res.stdout || '') + '\n' + (res.stderr || ''),
    });
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n========================================`);
console.log(`離線驗證結果: ${passed} 通過 / ${failed} 失敗 (耗時 ${elapsed}s)`);
console.log(`========================================\n`);

if (failed > 0) {
  console.error('❌ 失敗項目詳細資訊:\n');
  for (const f of failures) {
    console.error(`--- [${f.item}] ---`);
    console.error(f.output.trim());
    console.error('\n');
  }
  process.exit(1);
} else {
  console.log('🎉 所有離線表現層稽核全部通過！\n');
  process.exit(0);
}
