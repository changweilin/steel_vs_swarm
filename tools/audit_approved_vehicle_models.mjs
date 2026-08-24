import fs from 'node:fs';
import {
  APPROVED_VEHICLE_MODELS,
  approvedVehicleModel,
  approvedVehicleModelAt,
} from '../public/js/approvedVehicleModels.js';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const rows = process.argv.includes('--break-count')
  ? APPROVED_VEHICLE_MODELS.slice(1)
  : APPROVED_VEHICLE_MODELS;

check(rows.length === 14, `正式 v6 載具數應為 14，實得 ${rows.length}`);
check(new Set(rows.map((row) => row.key)).size === 14, '載具 key 必須唯一');

for (const row of rows) {
  check(row.version === 6, `${row.key}: 僅准 v6`);
  check(row.sceneBasis.authoredNose === '+x', `${row.key}: 鼻頭約定必須是 +x`);
  check(row.sceneBasis.origin.every(Number.isFinite), `${row.key}: 來源原點必須為有限數值`);
  check(row.dimensions.L >= row.dimensions.W, `${row.key}: L 必須取長軸`);
  check(row.dimensions.H > 0, `${row.key}: H 必須為正`);
  check(row.axles.positions.length >= 2, `${row.key}: 至少需要兩根車軸`);
  check(row.axles.wheelbase > 0, `${row.key}: wheelbase 必須由軸位推導為正`);
  check(row.axles.wheelCount >= 4, `${row.key}: 至少需要四輪`);
  check(row.materials.includes('body'), `${row.key}: 缺少 body 材質語意`);
  check(row.materials.includes('tire'), `${row.key}: 缺少 tire 材質語意`);
  check(row.parts.every((part) => typeof part.type === 'string'), `${row.key}: 零件缺少通用 renderer 所需 type`);
  check(row.parts.every((part) => part.position.every(Number.isFinite)), `${row.key}: 零件位置含非有限值`);
  check(approvedVehicleModel(row.key) === row, `${row.key}: key accessor 未回傳型錄原列`);
}

check(approvedVehicleModelAt(-1) === APPROVED_VEHICLE_MODELS.at(-1), '負索引必須穩定環繞');
const source = fs.readFileSync(new URL('../public/js/approvedVehicleModels.js', import.meta.url), 'utf8');
check(!source.includes('Math.random'), '適配器不得使用 Math.random()');
check(!source.includes("from 'three'"), '適配器不得建立第二份 THREE 建模出口');

if (failures.length) {
  for (const message of failures) console.error(`❌ ${message}`);
  process.exitCode = 1;
} else {
  console.log(`✅ 通過 ${APPROVED_VEHICLE_MODELS.length} 款 v6 場景載具型錄稽核`);
}
