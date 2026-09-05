#!/usr/bin/env node
/**
 * tools/audit_suite.mjs
 *
 * 全域回歸驗證套件 (Full CI Offline Audit Suite Runner)
 * 統一本地開發與 CI 流程之守門機制，確保 PR 前逐項執行完整離線稽核陣列與平衡驗證。
 */

import { spawnSync, spawn } from 'node:child_process';
import { cpus } from 'node:os';
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

const ARGS = new Set(process.argv.slice(2));
const jobsArg = process.argv.slice(2).find((a) => a.startsWith('--jobs='));
const JOBS = ARGS.has('--serial') ? 1
  : Math.max(1, parseInt(jobsArg?.split('=')[1] || '', 10) || Math.min(cpus().length, 8));

console.log(`== 執行完整回歸驗證矩陣 (${AUDIT_SCRIPTS.length} 項離線稽核,並行 ${JOBS}) ==\n`);

let passed = 0;
let failed = 0;
const failures = [];

const t0 = Date.now();

// 語法閘快敗:它是白畫面守門,先同步跑,紅了後面不必浪費 CPU。
const GATE = 'tools/audit_client_syntax.mjs';
{
  const gate = spawnSync('node', [resolve(rootDir, GATE)], { cwd: rootDir, encoding: 'utf-8', env: process.env });
  const gateOk = gate.status === 0;
  console.log(`[gate] ${GATE} ... ${gateOk ? '✅ PASS' : '❌ FAIL'}`);
  if (!gateOk) {
    console.error((gate.stdout || '') + '\n' + (gate.stderr || ''));
    process.exit(1);
  }
}
const QUEUE = AUDIT_SCRIPTS.filter((s) => s !== GATE);

const runOne = (item, idx) => new Promise((res) => {
  const [script, ...args] = item.split(' ');
  const label = `[${idx + 1}/${QUEUE.length}] ${item}`;
  const cp = spawn('node', [resolve(rootDir, script), ...args], { cwd: rootDir, env: process.env });
  let out = '', err = '';
  cp.stdout?.on('data', (d) => { out += d; });
  cp.stderr?.on('data', (d) => { err += d; });
  cp.on('close', (code) => {
    const ok = code === 0;
    console.log(`${label.padEnd(50, ' ')} ... ${ok ? '✅ PASS' : '❌ FAIL'}`);
    res({ item, ok, output: `${out}\n${err}` });
  });
});

{
  let next = 0;
  const workers = Array.from({ length: Math.min(JOBS, QUEUE.length) }, async () => {
    while (next < QUEUE.length) {
      const i = next++;
      const r = await runOne(QUEUE[i], i);
      if (r.ok) passed++;
      else { failed++; failures.push(r); }
    }
  });
  await Promise.all(workers);
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
