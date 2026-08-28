// 64 招 profile 覆蓋與視覺欄位稽核。
// 這是離線原文稽核：不得依瀏覽器是否載入成功而把缺欄位吞成跳過。
// 用法：node tools/audit_cast_profiles.mjs
import { readSrc } from './audit_src.mjs';

const original = readSrc('public', 'js', 'castfx.js');
const particlesOriginal = readSrc('public', 'js', 'castparticles.js');
const breaks = new Set(process.argv.slice(2));
let src = original;
let particles = particlesOriginal;
if (breaks.has('--break-profile-signature')) {
  const broken = src.replace("accentMotif:'whale'", "accentMotif:'unsupported_signature'");
  if (broken === src) throw new Error('--break-profile-signature 替換無效');
  src = broken;
}
if (breaks.has('--break-culture')) {
  const broken = src.replace("  s01:{culture:", "  s01_missing:{culture:");
  if (broken === src) throw new Error('--break-culture 替換無效');
  src = broken;
}
if (breaks.has('--break-shield-structure')) {
  const broken = src.replace("form === 'tomb_phalanx'", "form === 'tomb_phalanx_missing'");
  if (broken === src) throw new Error('--break-shield-structure 替換無效');
  src = broken;
}
if (breaks.has('--break-particle-capacity')) {
  const broken = particles.replace('PARTICLE_CAPACITY_NORMAL = 1024', 'PARTICLE_CAPACITY_NORMAL = 1023');
  if (broken === particles) throw new Error('--break-particle-capacity 替換無效');
  particles = broken;
}
if (breaks.has('--break-particle-instancing')) {
  const broken = particles.replace('new THREE.InstancedMesh(', 'new THREE.Mesh(');
  if (broken === particles) throw new Error('--break-particle-instancing 替換無效');
  particles = broken;
}
if (breaks.has('--break-particle-recipe')) {
  const broken = src.replace('count: 64 + ((i * 17) % 65)', 'count: 1 + ((i * 17) % 65)');
  if (broken === src) throw new Error('--break-particle-recipe 替換無效');
  src = broken;
}

let checks = 0;
const ok = (condition, message) => {
  if (!condition) throw new Error(`✗ ${message}`);
  checks++;
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
const layoutStructureKeys = keys(section('LAYOUT_STRUCTURE'));
const cultures = [...section('CULTURAL_PALETTES').matchAll(/(?:^|\n)\s*([a-z]\d+)\s*:\{culture:'([^']+)',\s*accent:(0x[0-9a-f]+),\s*structure:'([^']+)',\s*shieldForm:'([^']+)'/g)]
  .map((m) => ({ ch: m[1], culture: m[2], accent: m[3], structure: m[4], shieldForm: m[5] }));
const cultureFrames = [...section('CULTURE_FRAME').matchAll(/([a-z]\d+):'([^']+)'/g)]
  .map((m) => ({ ch: m[1], frame: m[2] }));
const cultureFrameCases = new Set([...src.matchAll(/case '([^']+)':/g)].map((m) => m[1]));
const shieldBody = src.slice(src.indexOf('function shieldField'), src.indexOf('/** dome 攔截場'));
const compositorBody = src.slice(src.indexOf('function profileCastCompositor'), src.indexOf('// ---------------- 角色 → 唯一 profileId'));
const compositorFrameBody = compositorBody.slice(compositorBody.indexOf('push(scene, effects, g, dur'));
const entryBody = src.slice(src.indexOf('export function spawnCastFx'), src.length);

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
ok(cultures.length === 32, `文化 palette = 32（實際 ${cultures.length}）`);
ok(new Set(cultures.map((c) => c.ch)).size === 32, '文化 palette 角色全數唯一');
ok(new Set(cultures.map((c) => c.shieldForm)).size === 32, 'shieldForm 每台機體唯一');
ok(cultures.every((c) => c.culture && c.accent && c.structure && c.shieldForm), '文化欄位完整');
ok(rows.every((r) => cultures.some((c) => c.ch === r.ch)), '每個施法角色都有文化 palette');
ok(cultureFrames.length === 32 && rows.every((r) => cultureFrames.some((f) => f.ch === r.ch)), '32 台機體都有文化幾何外框');
ok(cultureFrames.every((f) => cultureFrameCases.has(f.frame)), '文化外框全數有 Canvas 幾何實作');
const domeForms = rows.filter((r) => r.arch === 'dome').map((r) => cultures.find((c) => c.ch === r.ch)?.shieldForm);
ok(domeForms.length === 7 && new Set(domeForms).size === 7, '七招防護場使用七種 fieldForm');
ok(domeForms.every((form) => form && shieldBody.includes(`'${form}'`)), '七種防護場皆有獨立三維結構分支');
ok((shieldBody.match(/new THREE\.Mesh\(DOME/g) || []).length === 1, '只有穆卡納斯聖所保留穹頂幾何');
ok(/const PARTICLE_RECIPES = Object\.fromEntries\(PROFILE_ROWS\.map/.test(src), '64 招都有 data-driven particle recipe');
ok(/count: 64 \+ \(\(i \* 17\) % 65\)/.test(src), 'normal particle recipe count is deterministic');
const recipeCounts = Array.from({ length: 64 }, (_, i) => 64 + ((i * 17) % 65));
ok(Math.min(...recipeCounts) === 64 && Math.max(...recipeCounts) === 128, 'normal particle recipe count spans 64..128');
ok(/system: i % 2/.test(src), 'particle recipe selects one of two shared systems');
ok(/shape: sig\.tellShape, layout: sig\.layout, motion: sig\.motion, contact: sig\.contact/.test(src), 'particle recipe consumes explicit shape/layout/motion/contact');
ok(/accentMotif: sig\.accentMotif, phase: i \* 0\.37, tempo:/.test(src), 'particle recipe consumes explicit accent/phase/tempo');
ok(/PARTICLE_CAPACITY_NORMAL = 1024/.test(particles), 'normal particle capacity = 1024');
ok(/PARTICLE_CAPACITY_LOW = 512/.test(particles), 'low-power particle capacity = 512');
ok(/function activeCapacity\(\) \{ return lowPower\(\) \? PARTICLE_CAPACITY_LOW : PARTICLE_CAPACITY_NORMAL; \}/.test(particles), 'active capacity follows existing lowPower seam');
ok(/mesh\.count = capacity \/ PARTICLE_SYSTEM_COUNT/.test(particles), 'active instance count is split across two draw layers');
ok(/>> \(lowPower\(\) \? 1 : 0\)/.test(particles), 'low-power halves every cast recipe');
ok(/new THREE\.InstancedMesh\(/.test(particles), 'particles use shared instanced mesh systems');
ok(/new THREE\.InstancedBufferAttribute/.test(particles), 'particle fields are instanced attributes');
ok(/attribute vec4 aStyle/.test(particles) && /sys\.style\.array/.test(particles), 'shader consumes profile style fields');
ok(/uSystem/.test(particles) && /makeMaterial\(system\)/.test(particles), 'two particle systems have distinct shader layers');
ok(/DynamicDrawUsage/.test(particles), 'spawn attributes use DynamicDrawUsage');
ok(/addUpdateRange\(start, count\)/.test(particles), 'only dirty slot ranges upload');
ok(/const ENGINES = new WeakMap\(\)/.test(particles), 'particle pools are scene scoped');
ok(/engine\.cursor\+\+ % engine\.capacity/.test(particles), 'ring cursor is bounded by active capacity');
ok(/systems\[slot % PARTICLE_SYSTEM_COUNT\]/.test(particles)
  && /Math\.floor\(slot \/ PARTICLE_SYSTEM_COUNT\)/.test(particles), 'each global slot maps to exactly one particle layer');
ok(!/Math\.random/.test(particles), 'particle spawning has no Math.random');
ok(/CAST_PARTICLE_DRAW_LAYERS = 2/.test(particles) && /CAST_FIXED_DRAW_LAYERS_MIN = 4/.test(particles) && /CAST_FIXED_DRAW_LAYERS_MAX = 6/.test(particles), 'cast draw layers are fixed at 4..6 including two particle systems');
const namedStructuralLayers = [...compositorBody.matchAll(/addLayer\('([^']+)'/g)].map((m) => m[1]);
ok(namedStructuralLayers.length === 3 && new Set(namedStructuralLayers).size === 3, 'compositor has three ordinary structural layer draws');
ok(namedStructuralLayers.includes('struct.culturalSeal') && namedStructuralLayers.includes('struct.layoutStructure') && namedStructuralLayers.includes('struct.accentMotif'), 'ordinary layer budget derives named cultural/layout/accent draws');
ok(/layers\.push\('struct\.shieldField'\)/.test(compositorBody) && /profile\.arch === 'dome'/.test(compositorBody), 'dome profiles replace accent with named shield field layer');
ok(/g\.userData\.castLayers = layers/.test(compositorBody) && /push\(scene, effects, g, dur/.test(compositorBody), 'compositor records and submits exactly its bounded layers');
ok(/field\.g\.traverse/.test(compositorBody) && /for \(const material of fieldMaterials\)/.test(compositorFrameBody)
  && !/\.traverse\(/.test(compositorFrameBody), 'shield materials are collected once; frame updates never traverse the scene tree');
ok(entryBody.includes('profileCastCompositor(scene, effects, P);'), 'spawnCastFx uses the profiled compositor entry');
ok(!entryBody.includes('fxCastBeat(scene, effects, P);') && !entryBody.includes('(ARCHS[arch] || fxAura)'), 'spawnCastFx does not submit legacy archetype layers');
for (const s of signatures) {
  ok(shapeKeys.has(s.tellShape), `${s.id}: tellShape=${s.tellShape} 已映射`);
  ok(layoutKeys.has(s.layout) && styleKeys.has(s.layout), `${s.id}: layout=${s.layout} 已映射尺度/方向`);
  ok(layoutStructureKeys.has(s.layout), `${s.id}: layout=${s.layout} 已映射場域結構`);
  ok(motionKeys.has(s.motion), `${s.id}: motion=${s.motion} 已映射軌跡`);
  ok(contactKeys.has(s.contact), `${s.id}: contact=${s.contact} 已映射收尾`);
  ok(supportedMotifs.has(s.accentMotif), `${s.id}: accentMotif=${s.accentMotif} 已有 Canvas 簽名`);
}
if (breaks.has('--break-particle-capacity') || breaks.has('--break-particle-instancing')) {
  // 反向旗標只需讓對應 invariant 失敗；保持正常檢查內容以便定位破壞點。
  if (!breaks.has('--break-particle-capacity') && !breaks.has('--break-particle-instancing')) throw new Error('particle reverse flag 未命中');
}
console.log(`\n✅ 通過 ${checks} 項`);
