// Reconstruct committed environment recipes in factory workers so a live Blender scene cannot enter the project.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../audit_src.mjs';
import { blenderMcp } from '../mech_authoring/mcp.mjs';
import { SHORELINE, SHORE_FACILITIES } from '../../public/js/shorelineCatalog.js';

const args = process.argv.slice(2);
assert(args.every(arg => arg === '--no-render'), 'Only --no-render is supported; BLENDER_BIN selects the existing CLI');
const out = path.join(ROOT, 'out/environment_project');
await mkdir(out, { recursive: true });
let blender = process.env.BLENDER_BIN;
if (!blender) {
  const user_prompt = '此branch先前commit的Blender建模,自動重建完整工程結構';
  for (const name of ['get_addon_status', 'get_scene_info']) await blenderMcp(name, { user_prompt }, 45000);
  const result = await blenderMcp('execute_blender_code', {
    code: 'import bpy, json\nprint(json.dumps({"binary": bpy.app.binary_path}))', user_prompt,
  }, 45000);
  const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  blender = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).binary;
}
assert(typeof blender === 'string' && blender, 'An existing Blender executable is required');

async function run(executable, flags, label) {
  console.log(label);
  const log = path.join(out, label.replaceAll(/[^a-zA-Z0-9_-]/g, '_') + '.log');
  let output = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, flags, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await writeFile(log, output);
  assert.equal(code, 0, `${label} failed; see ${log}\n${output.slice(-4000)}`);
}

const jobs = [
  { id: 'transport', sources: [['tools/transport_authoring/source.mjs'], ['tools/transport_authoring/export_review.mjs']],
    scripts: ['tools/transport_authoring/author.py', 'tools/transport_authoring/preview.py'] },
  { id: 'scenery', sources: [['tools/scenery_authoring/shot.mjs']],
    scripts: ['tools/scenery_authoring/author.py', 'tools/scenery_authoring/preview.py'] },
  { id: 'boundary', sources: [['tools/boundary_authoring/review.mjs'], ['tools/boundary_authoring/review.mjs', '--joins']],
    scripts: ['tools/boundary_authoring/author.py', 'tools/boundary_authoring/preview.py',
      { path: 'tools/boundary_authoring/preview.py', globals: { REVIEW_JOINS: true } }] },
  { id: 'ambient', sources: [], scripts: ['tools/ambient_authoring/author.py'] },
  { id: 'roads', sources: [['tools/road_structure_authoring/shot.mjs']],
    scripts: ['tools/road_structure_authoring/author.py',
      { path: 'tools/road_structure_authoring/preview.py', globals: { RENDER_REVIEWS: false } }] },
  { id: 'facades', sources: [['tools/facade_authoring/shot.mjs']],
    scripts: ['tools/facade_authoring/author.py', 'tools/facade_authoring/preview.py'] },
  { id: 'walkways', review: 'urban-sidewalks', sources: [['tools/walkway_authoring/shot.mjs']],
    scripts: ['tools/walkway_authoring/author.py', 'tools/walkway_authoring/preview.py'] },
  { id: 'shoreline', review: 'library-0', sources: [['tools/shoreline_authoring/shot.mjs']],
    scripts: ['tools/shoreline_authoring/author.py',
      { path: 'tools/shoreline_authoring/preview.py', globals: { RENDER_KEYS: [] } }] },
];
const hash = data => createHash('sha256').update(data).digest('hex');
const recipes = {};
for (const job of jobs) for (const entry of job.scripts) {
  const source = typeof entry === 'string' ? entry : entry.path;
  recipes[source] = hash(await readFile(path.join(ROOT, source)));
}
await mkdir(path.join(ROOT, 'out/shoreline_review'), { recursive: true });
await writeFile(path.join(ROOT, 'out/shoreline_review/catalog.json'),
  JSON.stringify({ facilities: SHORE_FACILITIES, variants: SHORELINE.VARIANTS }));
const config = path.join(out, 'build.json');
await writeFile(config, JSON.stringify({ jobs, recipes, render: !args.includes('--no-render') }, null, 2));
const script = path.join(ROOT, 'tools/environment_authoring/build.py');
const invoke = (stage, label) => run(blender,
  ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', stage, config], label);
for (const job of jobs) {
  for (const flags of job.sources) await run(process.execPath, flags, 'source-' + flags.join('-'));
  await invoke(job.id, 'build-' + job.id);
}
await invoke('assemble', 'assemble');
await invoke('verify', 'verify');
console.log(path.join(out, 'environment-project.blend'));
