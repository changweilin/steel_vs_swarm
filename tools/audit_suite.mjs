#!/usr/bin/env node
/**
 * tools/audit_suite.mjs
 *
 * 全域回歸驗證套件 (Full CI Offline Audit Suite Runner)
 * 統一本地開發與 CI 流程之守門機制，確保 PR 前逐項執行完整離線稽核陣列與平衡驗證。
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const AUDIT_SCRIPTS = [
  // ── 核心模擬、連線機制與語法守門 ──
  'tools/audit_net_modes.mjs',
  'tools/audit_client_syntax.mjs',

  // ── 核心地圖規則、兵線拓撲與通行阻擋 ──
  'tools/audit_map_rules.mjs',
  'tools/audit_lane_sep.mjs',
  'tools/audit_lane_navigation.mjs',
  'tools/audit_terrain_ray.mjs',
  'tools/audit_layer_block.mjs',
  'tools/audit_open_tunnel.mjs',
  'tools/audit_underpass.mjs',
  'tools/audit_road_joint.mjs',
  'tools/audit_road_bed.mjs',
  'tools/audit_world_height.mjs',
  'tools/audit_zone_cut.mjs',

  // ── 核心幾何量體、武器判定與戰鬥物理 ──
  'tools/audit_gpu_lifecycle.mjs',
  'tools/audit_object_joints.mjs',
  'tools/audit_npc_collide.mjs',
  'tools/audit_lance_hit.mjs',
  'tools/audit_weapon_gate.mjs',
  'tools/audit_aoe_trim.mjs',
  'tools/audit_fire_rate.mjs',
  'tools/audit_recoil_move.mjs',
  'tools/audit_speed_comp.mjs',
  'tools/audit_hex_stats.mjs',
  'tools/audit_climb.mjs',
  'tools/audit_cc_flash.mjs',
  'tools/audit_flight_power.mjs',
  'tools/audit_slope_move.mjs',

  // ── 核心控制、相機視角與局內經濟 ──
  'tools/audit_view_lock.mjs',
  'tools/audit_ctrl_mode.mjs',
  'tools/audit_spectator_cam.mjs',
  'tools/audit_minimap_view.mjs',
  'tools/audit_shop_auto.mjs',

  // ── 核心 Bot AI 戰術狀態機 ──
  'tools/audit_bot_vision.mjs',
  'tools/audit_bot_role.mjs',

  // ── 輔助表現層演算法 (CI 保留類別 D) ──
  'tools/audit_anim_weights.mjs',
  'tools/audit_audio_layers.mjs',
  'tools/audit_damp_fps.mjs',
];

console.log(`== 執行完整回歸驗證矩陣 (${AUDIT_SCRIPTS.length} 項離線稽核) ==\n`);

let passed = 0;
let failed = 0;
const failures = [];

const t0 = Date.now();

for (let i = 0; i < AUDIT_SCRIPTS.length; i++) {
  const item = AUDIT_SCRIPTS[i];
  const [script, ...args] = item.split(' ');
  const label = `[${i + 1}/${AUDIT_SCRIPTS.length}] ${item}`;
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
console.log(`驗證結果: ${passed} 通過 / ${failed} 失敗 (耗時 ${elapsed}s)`);
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
  console.log('🎉 所有離線稽核全部通過！\n');
  process.exit(0);
}
