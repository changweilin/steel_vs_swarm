// ============ v1 自然物正式名冊稽核 ============
// 使用者定案：v1 只採用岩石與針葉林；但任何節點仍須先通過零件台。
// 現況是四顆岩石為 ok，cf1..cf4 的木質／樹冠只有來源帳、尚未判 ok，故必須 fail-closed。
//
// 反向驗證：
//   --break-rock     從執行期岩石名冊移除一顆，岩石完整性 MUST 紅字。
//   --break-conifer  把未審 cf1 樹冠塞入執行期名冊，針葉 fail-closed MUST 紅字。
import { partKeys } from './ai3d/provenance.mjs';
import { readSrc } from './audit_src.mjs';
import {
  LEGACY_CONIFER_MODELS,
  LEGACY_NATURE_MODELS,
  LEGACY_ROCK_MODELS,
  isApprovedLegacyNatureKey,
  legacyNatureKey,
} from '../public/js/legacyNatureModels.js';

const BREAK_ROCK = process.argv.includes('--break-rock');
const BREAK_CONIFER = process.argv.includes('--break-conifer');

let pass = 0;
let fail = 0;
const ok = (condition, message) => {
  if (condition) {
    pass++;
    console.log(`  ✅ ${message}`);
  } else {
    fail++;
    console.log(`  ❌ ${message}`);
  }
};

const review = JSON.parse(readSrc('tools', 'parts_review', 'state.json')).items || {};
const manifest = JSON.parse(readSrc('tools', 'ai3d', 'parts_manifest.json')).parts || [];
const manifestKeys = new Set(manifest.flatMap(partKeys));
const source = readSrc('public', 'js', 'legacyNatureModels.js');

const EXPECTED_ROCKS = Object.freeze([
  'rock/collapse_a',
  'rock/facet_a',
  'rock/facet_b',
  'rock/mega_a',
]);
const CONIFER_CANDIDATES = Object.freeze([
  'tree/cf1_wood_a', 'tree/cf1_crown_a',
  'tree/cf2_wood_a', 'tree/cf2_crown_a',
  'tree/cf3_wood_a', 'tree/cf3_crown_a',
  'tree/cf4_wood_a', 'tree/cf4_crown_a',
]);

const runtimeRocks = LEGACY_ROCK_MODELS.map((row) => row.key);
if (BREAK_ROCK) runtimeRocks.pop();
const runtimeConifers = LEGACY_CONIFER_MODELS.map((row) => row.key);
if (BREAK_CONIFER) runtimeConifers.push(CONIFER_CANDIDATES[1]);

console.log('\nⅠ 審核與來源帳');
ok(EXPECTED_ROCKS.every((key) => review[key]?.status === 'ok'), '四顆岩石均已通過零件台');
ok(EXPECTED_ROCKS.every((key) => manifestKeys.has(key)), '四顆岩石均有來源帳');
ok(CONIFER_CANDIDATES.every((key) => manifestKeys.has(key)), 'cf1..cf4 木質與樹冠均有來源帳');
ok(CONIFER_CANDIDATES.every((key) => review[key]?.status !== 'ok'), 'cf1..cf4 尚無通過判決');

console.log('\nⅡ 正式名冊與 fail-closed');
ok(JSON.stringify(runtimeRocks) === JSON.stringify(EXPECTED_ROCKS), '執行期只收四顆已通過岩石且順序穩定');
ok(runtimeConifers.length === 0, '未通過的針葉節點不進執行期名冊');
ok(LEGACY_NATURE_MODELS.rock === LEGACY_ROCK_MODELS
  && LEGACY_NATURE_MODELS.conifer === LEGACY_CONIFER_MODELS, '類別映射共用同一份凍結名冊');
ok(Object.isFrozen(LEGACY_NATURE_MODELS)
  && Object.isFrozen(LEGACY_ROCK_MODELS)
  && LEGACY_ROCK_MODELS.every(Object.isFrozen), '名冊與列皆不可變');

console.log('\nⅢ key 契約與決定性');
ok(legacyNatureKey('rock', 'cairn-base') === 'rock/collapse_a'
  && legacyNatureKey('rock', 'cairn-middle') === 'rock/facet_a'
  && legacyNatureKey('rock', 'cairn-top') === 'rock/facet_b'
  && legacyNatureKey('rock', 'megalith') === 'rock/mega_a', '用途到 partlib key 的映射完整');
ok(legacyNatureKey('conifer', 'cf1') === null
  && legacyNatureKey('rock', 'unknown') === null
  && legacyNatureKey('tree', 'cf1') === null, '未知或未通過用途回 null');
ok(EXPECTED_ROCKS.every(isApprovedLegacyNatureKey)
  && CONIFER_CANDIDATES.every((key) => !isApprovedLegacyNatureKey(key)), '白名單判定不放行未審針葉');
ok(!source.includes('Math.random(') && !source.includes('mulberry32('), '純資料映射零亂數消耗');
ok(!/^\s*import\s/m.test(source), 'adapter 零 import、零 Three.js');

console.log(`\n${fail ? '❌' : '✅'} v1 自然物正式名冊：${pass} 通過，${fail} 失敗`);
if (fail) process.exit(1);
