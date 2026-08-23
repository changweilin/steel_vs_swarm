#!/usr/bin/env node
/**
 * v6 img→3D 管線離線閘：
 * ① YOLO26 detect/segment/depth 三模型與 schema-v2 真快取。
 * ② 只有語意符合分類的多目標會拆分。
 * ③ ingest 缺快取不得偷吃原圖。
 * ④ 生成後必須渲染三視圖並由第二次 LLM 呼叫複核；低分回饋下一輪，未過不得入庫。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../audit_src.mjs';

const argv = process.argv.slice(2);
const broken = argv.includes('--break-yolo') ? 'yolo11n-seg.pt'
  : argv.includes('--break-review') ? "reviewGeometry = async () => ({ similarityScore: 100, verdict: 'pass' })"
    : null;
let py = readFileSync(join(ROOT, 'tools', 'ai3d', 'yolo_depth_segment.py'), 'utf8');
let js = readFileSync(join(ROOT, 'tools', 'ai3d', 'direct_ingest_v6.mjs'), 'utf8');
const reconcile = readFileSync(join(ROOT, 'tools', 'ai3d', 'reconcile_v6_review.mjs'), 'utf8');
if (argv.includes('--break-yolo')) py = py.replace('yolo26n-seg.pt', broken);
if (argv.includes('--break-review')) js = js.replace('async function reviewGeometry', broken);

const checks = [];
const ok = (name, pass) => checks.push({ name, pass: Boolean(pass) });

ok('YOLO26 detection model', py.includes('"yolo26n.pt"'));
ok('YOLO26 segmentation model', py.includes('"yolo26n-seg.pt"') && !py.includes('yolo11n-seg.pt') && !py.includes('yolov8n-seg.pt'));
ok('YOLO26 depth model', py.includes('"yolo26n-depth.pt"'));
ok('real depth tensor', py.includes('result.depth.data'));
ok('depth raw persistence', py.includes('np.save(raw_path'));
ok('segmentation mask persistence', py.includes('maskFile'));
ok('schema-v2 cache gate', py.includes('SCHEMA_VERSION = 2') && py.includes('cache_valid(feature_file)'));
ok('semantic family filter', py.includes('FAMILY_LABELS') && py.includes('row["className"] in allowed'));
ok('multi-target id', py.includes('target_id = f"{stem}~{index}"'));
ok('ingest rejects missing YOLO cache', js.includes('缺少 YOLO26 快取，拒絕直接送 LLM'));
ok('YOLO features enter LLM prompt', js.includes('不得重新猜測目標邊界') && js.includes('JSON.stringify(yoloFeatures)'));
ok('three-view preview renderer', js.includes("render_poly_preview.py") && js.includes("'out', 'review_previews'"));
ok('independent image-vs-render review', js.includes('async function reviewGeometry(')
  && js.includes("{ inlineData: { mimeType: 'image/png', data: preview } }"));
ok('review critique feeds retry', js.includes('callGemini(imageBase64, mimeType, family, subpart, tgt.features, critique)'));
ok('failed review cannot persist', js.includes('仍未通過獨立相似度閘，拒絕入庫'));
ok('authoritative review is persisted', js.includes('similarityScore: simScore') && js.includes('similarityVerdict: review.verdict'));
ok('review reconciliation uses stable identity', js.includes('stableTargetOfKey') && reconcile.includes('stableOfKey'));
ok('purge removes v6 child targets', reconcile.includes("replace(/~\\d+$/, '')")
  && reconcile.includes("(?:_\\\\d+)?_v6$"));
ok('purge path containment guard', reconcile.includes('拒絕刪除未驗證路徑') && reconcile.includes('sources.length !== 1'));
ok('purge tombstone blocks reingest', reconcile.includes('v6_purge_manifest.json') && js.includes('v6_purge_manifest.json'));

for (const check of checks) console.log(`${check.pass ? '✓' : '✗'} ${check.name}`);
const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
