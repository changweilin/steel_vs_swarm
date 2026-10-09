#!/usr/bin/env node
/**
 * tools/audit_suite.mjs
 *
 * Global regression suite (Full CI Offline Audit Suite Runner)
 * Gatekeeper unifying local development and CI flow, ensuring the full offline audit array
 * and balance checks run item by item before a PR.
 */

import { spawnSync, spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const AUDIT_SCRIPTS = [
  // -- Core simulation, connection mechanism, and syntax gate --
  'tools/audit_net_modes.mjs',
  'tools/audit_client_syntax.mjs',
  'tools/audit_comment_discipline.mjs',
  'tools/audit_weather_surface.mjs',

  // -- Core map rules, lane topology, and movement blocking --
  'tools/audit_map_rules.mjs',
  'test/mapSelection.mjs',
  'test/mixedMap.mjs',
  'test/randomMap.mjs',
  'test/mapRules.mjs',
  'test/mapPreparation.mjs',
  'test/venueRoadSources.mjs',
  'test/mapCatalogue.mjs',
  'tools/audit_map_evidence.mjs',
  'tools/audit_habitat.mjs',
  'test/shoreline.mjs',
  'tools/audit_facility_fusion.mjs',
  'tools/audit_lane_sep.mjs',
  'tools/audit_lane_navigation.mjs',
  'tools/audit_mother_lanes.mjs',
  'tools/audit_terrain_ray.mjs',
  'tools/audit_layer_block.mjs',
  'tools/audit_open_tunnel.mjs',
  'tools/audit_underpass.mjs',
  'tools/audit_road_joint.mjs',
  'test/roadStructures.mjs',
  'test/roadNetworkAppearance.mjs',
  'test/roadJunctionBounds.mjs',
  'test/roadFurniture.mjs',
  'tools/audit_road_bed.mjs',
  'tools/audit_slope_platform.mjs',
  'tools/audit_world_height.mjs',
  'tools/audit_forest.mjs',
  'test/naturalAppearance.mjs',
  'tools/audit_seasonal_environment.mjs',
  'tools/audit_geology.mjs',
  'tools/audit_zone_cut.mjs',

  // -- Core geometry volumes, weapon adjudication, and combat physics --
  'tools/audit_gpu_lifecycle.mjs',
  'tools/audit_object_joints.mjs',
  'test/boundaryJoins.mjs',
  'tools/audit_npc_collide.mjs',
  'tools/audit_lance_hit.mjs',
  'tools/audit_building_damage.mjs',
  'tools/audit_fan_cone.mjs',
  'tools/audit_weapon_gate.mjs',
  'tools/audit_aoe_trim.mjs',
  'tools/audit_fire_rate.mjs',
  'tools/audit_recoil_move.mjs',
  'tools/audit_speed_comp.mjs',
  'tools/audit_hex_stats.mjs',
  'tools/audit_climb.mjs',
  'tools/audit_cc_flash.mjs',
  'tools/audit_heal_archetypes.mjs',
  'tools/audit_flight_power.mjs',
  'tools/audit_slope_move.mjs',

  // -- Core controls, camera views, and in-match economy --
  'tools/audit_view_lock.mjs',
  'tools/audit_ctrl_mode.mjs',
  'tools/audit_spectator_cam.mjs',
  'tools/audit_minimap_view.mjs',
  'tools/audit_shop_auto.mjs',

  // -- Core bot AI tactical state machine --
  'tools/audit_bot_vision.mjs',
  'tools/audit_bot_role.mjs',
  'tools/audit_bot_policy.mjs',
  'tools/audit_bot_tactics.mjs',

  // -- Auxiliary presentation-layer algorithms (CI keeps category D) --
  'tools/audit_anim_weights.mjs',
  'tools/audit_audio_layers.mjs',
  'tools/audit_damp_fps.mjs',
  'tools/audit_cull.mjs',
  'tools/audit_tex_stream.mjs',
  'tools/audit_taa_drs.mjs',
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

// Syntax gate fails fast: it guards against white screens, so run it synchronously first; if it is red the rest need not waste CPU.
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
