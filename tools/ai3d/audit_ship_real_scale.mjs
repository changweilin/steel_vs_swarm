#!/usr/bin/env node

/**
 * 船艦照片 v6 的真實尺度與特殊輪廓稽核。
 *
 * 逐列核對 ship_scale_catalog 的 62 張照片是否都有公尺尺度，並確認生成後
 * bounds 與目標長／高／寬一致。特殊船型另驗照片可辨識特徵：航母甲板設備、
 * 郵輪陽台與救生艇、散裝貨艙蓋、貨櫃艙格、雙體船隧道及潛艇泵噴環。
 * --break-scale / --break-detail 只破壞記憶體副本，必須使對應斷言轉紅。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveShipScale, SHIP_SCALE_ROW_COUNT } from './ship_scale_catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE,'..','..');
const DB_PATH = join(ROOT,'out','3d_database.json');
const args = new Set(process.argv.slice(2));
const BREAK_SCALE = args.has('--break-scale');
const BREAK_DETAIL = args.has('--break-detail');
const db = JSON.parse(readFileSync(DB_PATH,'utf8'));
const rows = (db.items || db).filter((row)=>row.family==='ship' && row.version===6);
const failures = [];
let brokeScale = false, brokeDetail = false;

function fail(row,message) {
  failures.push(`${row?.key || 'catalog'}: ${message}`);
}

function count(parts,re) {
  return parts.filter((part)=>re.test(part.name)).length;
}

function requireCount(row,parts,re,min,label) {
  const actual = count(parts,re);
  if (actual < min) fail(row,`${label} ${actual}/${min}`);
}

if (rows.length !== 62 || SHIP_SCALE_ROW_COUNT !== 62) fail(null,`尺度列數 rows=${rows.length}, catalog=${SHIP_SCALE_ROW_COUNT}, expected=62`);

for (const row of rows) {
  const modelPath = join(ROOT,row.outputDir,'model.json');
  if (!existsSync(modelPath)) {
    fail(row,'缺少 model.json');
    continue;
  }
  const model = JSON.parse(readFileSync(modelPath,'utf8'));
  const spec = resolveShipScale(row,model,model.bounds.size);
  const measured = [...model.bounds.size];
  if (BREAK_SCALE && !brokeScale) {
    measured[0] *= 0.5;
    brokeScale = true;
  }
  for (let axis=0;axis<3;axis++) {
    const error = Math.abs(measured[axis]-spec.size[axis])/spec.size[axis];
    const tolerance = axis===0 ? 0.015 : 0.08;
    if (error > tolerance) fail(row,`bounds 軸 ${axis}=${measured[axis].toFixed(3)}m，目標 ${spec.size[axis].toFixed(3)}m，誤差 ${(error*100).toFixed(2)}%`);
  }

  let parts = model.parts || [];
  if (BREAK_DETAIL && !brokeDetail && /aircraft_carrier/i.test(`${row.style} ${model.style}`)) {
    parts = parts.filter((part)=>part.name !== 'landing_centerline');
    brokeDetail = true;
  }
  const identity = `${row.key} ${row.style || ''} ${model.style || ''}`;
  if (/aircraft_carrier/i.test(identity)) {
    requireCount(row,parts,/^landing_centerline$/,1,'降落中線');
    requireCount(row,parts,/^aircraft_elevator_/,2,'升降機');
    requireCount(row,parts,/^deck_aircraft_/,8,'甲板機群');
    requireCount(row,parts,/^deck_edge_catwalk_/,2,'甲板邊走道');
  }
  if (/cruise_ship|cruise ship/i.test(identity)) {
    requireCount(row,parts,/^balcony_band_/,6,'陽台帶');
    requireCount(row,parts,/^lifeboat_/,16,'救生艇');
  }
  if (/Disney%20Adventure|Disney Adventure/i.test(identity)) {
    requireCount(row,parts,/^disney_funnel_\d+$/,4,'四煙囪');
    requireCount(row,parts,/^forward_bridge_wing$/,1,'前橋翼');
  }
  if (/explorer-of-the-seas/i.test(identity)) requireCount(row,parts,/^aft_terrace_/,3,'艉部露台');
  if (/圖2-超日王號|e7642302|GettyImages/i.test(identity)) requireCount(row,parts,/ski_jump/i,1,'滑躍甲板');
  if (/LNG|methan/i.test(identity)) requireCount(row,parts,/^lng_pipe_run_/,3,'LNG 管路');
  if (/bulk/i.test(identity)) requireCount(row,parts,/^cargo_hatch_/,7,'散裝貨艙蓋');
  if (/container|cargo_ship/i.test(identity)) requireCount(row,parts,/^container_bay_/,9,'貨櫃艙格');
  if (/catamaran|TurboJET_Barca/i.test(identity)) {
    requireCount(row,parts,/^main_hull_(port|starboard)$/,2,'雙船殼');
    requireCount(row,parts,/^catamaran_bridge_tunnel$/,1,'橋接隧道');
  }
  if (/fishing/i.test(identity)) requireCount(row,parts,/^fishing_winch$/,1,'漁撈絞盤');
  if (/submarine/i.test(identity)) requireCount(row,parts,/^stern_pumpjet_ring$/,1,'艉部泵噴環');
}

if (BREAK_SCALE && !brokeScale) fail(null,'--break-scale 未找到可破壞尺度列');
if (BREAK_DETAIL && !brokeDetail) fail(null,'--break-detail 未找到航母細節');

if (failures.length) {
  console.error(`船艦實尺稽核失敗：${failures.length} 項`);
  for (const message of failures) console.error(`  ${message}`);
  process.exitCode = 1;
} else {
  console.log(`船艦實尺稽核通過：${rows.length} 艘，尺度列 ${SHIP_SCALE_ROW_COUNT}，特殊船型細節完整`);
}
