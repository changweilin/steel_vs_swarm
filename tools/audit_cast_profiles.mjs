// 64 招 profile 覆蓋與視覺欄位稽核。
// 這是離線原文稽核：不得依瀏覽器是否載入成功而把缺欄位吞成跳過。
// 用法：node tools/audit_cast_profiles.mjs
import { readSrc } from './audit_src.mjs';

const original = readSrc('public', 'js', 'castfx.js');
const breaks = new Set(process.argv.slice(2));
let src = original;
if (breaks.has('--break-profile-signature')) {
  const broken = src.replace("accentMotif:'whale'", "accentMotif:'unsupported_signature'");
  if (broken === src) throw new Error('--break-profile-signature 替換無效');
  src = broken;
}

const ok = (condition, message) => {
  if (!condition) throw new Error(`✗ ${message}`);
  console.log(`  ✓ ${message}`);
};
const section = (name) => {
  const start = src.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  const end = src.indexOf('\n};', start);
  if (end < 0) throw new Error(`${name} 結束括號遺失`);
  return src.slice(start, end);
};
const keys = (body) => new Set([...body.matchAll(/(?:^|[,{\n])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]));
const rows = [...src.matchAll(/\['([^']+)',\s*'([^']+)',\s*'(skill|ult)',\s*'([^']+)',\s*'([^']+)'\]/g)]
  .map((m) => ({ id: m[1], ch: m[2], slot: m[3], arch: m[4], motif: m[5] }));
const signatures = [...src.matchAll(/\n\s*'([^']+)': \{ tellShape:'([^']+)', layout:'([^']+)', motion:'([^']+)', contact:'([^']+)', accentMotif:'([^']+)' \}/g)]
  .map((m) => ({ id: m[1], tellShape: m[2], layout: m[3], motion: m[4], contact: m[5], accentMotif: m[6] }));
const namesBody = src.slice(src.indexOf('const SIGNATURE_NAMES'), src.indexOf(']);', src.indexOf('const SIGNATURE_NAMES')));
const supportedMotifs = new Set([...namesBody.matchAll(/'([^']+)'/g)].map((m) => m[1]));
const shapeKeys = keys(section('SHAPE_MODE'));
const layoutKeys = keys(section('LAYOUT_SCALE'));
const styleKeys = keys(section('LAYOUT_STYLE'));
const motionKeys = keys(section('MOTION_STYLE'));
const contactKeys = keys(section('CONTACT_STYLE'));

console.log('== 64 招 profile 視覺簽名稽核 ==\n');
ok(rows.length === 64, `profile rows = 64（實際 ${rows.length}）`);
ok(new Set(rows.map((r) => r.id)).size === 64, 'profileId 全數唯一');
ok(signatures.length === 64, `visual signatures = 64（實際 ${signatures.length}）`);
ok(new Set(signatures.map((s) => s.id)).size === 64, 'signature id 全數唯一');
const rowIds = new Set(rows.map((r) => r.id));
ok(signatures.every((s) => rowIds.has(s.id)), '每個 signature 都對應角色槽位');
ok(rows.every((r) => signatures.some((s) => s.id === r.id)), '每個 profileId 都有完整 signature');
const visual = signatures.map((s) => [s.tellShape, s.layout, s.motion, s.contact, s.accentMotif].join('|'));
ok(new Set(visual).size === 64, '完整視覺簽名不可重複');
for (const s of signatures) {
  ok(shapeKeys.has(s.tellShape), `${s.id}: tellShape=${s.tellShape} 已映射`);
  ok(layoutKeys.has(s.layout) && styleKeys.has(s.layout), `${s.id}: layout=${s.layout} 已映射尺度/方向`);
  ok(motionKeys.has(s.motion), `${s.id}: motion=${s.motion} 已映射軌跡`);
  ok(contactKeys.has(s.contact), `${s.id}: contact=${s.contact} 已映射收尾`);
  ok(supportedMotifs.has(s.accentMotif), `${s.id}: accentMotif=${s.accentMotif} 已有 Canvas 簽名`);
}
console.log(`\n✅ 通過 ${64 * 5 + 7} 項`);
