#!/usr/bin/env node
/**
 * tools/audit_offline_suite.mjs
 *
 * Offline regression suite (Offline Presentation and World Audit Suite)
 * Collects 21 non-core offline audits for visual style, environment dressing, weather dynamics,
 * and world codex text.
 * For local art and copy maintenance on demand, never blocks the main CI.
 *
 * Usage:
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
  // Cel rendering and water fields.
  'tools/audit_cel_pipeline.mjs',
  'tools/audit_visual_prefs.mjs',
  'tools/audit_visual_presets.mjs',
  'tools/audit_soft_stroke.mjs',
  'tools/audit_struct_ink.mjs',
  'tools/audit_base_water_pad.mjs',
  'tools/audit_rock_ink.mjs',
  'tools/audit_leaf_card.mjs',
  'tools/audit_water_edge.mjs',
  'tools/audit_wavefronts.mjs',

  // -- B. Environment dressing and background motion (6 items) --
  'tools/audit_ambient_motion.mjs',
  'tools/audit_wildlife.mjs',
  'test/ambientAppearance.mjs',
  'tools/audit_aquatics.mjs',
  'tools/audit_daynight.mjs',
  'tools/audit_weather_dynamics.mjs',
  'tools/audit_weather_visuals.mjs',

  // -- C. World codex copy, bestiary, and generation prompts (6 items) --
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
