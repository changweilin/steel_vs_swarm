import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const contract = JSON.parse(await readFile('tools/mech_authoring/assets.json', 'utf8'));
const output = new URL(contract.authoring.outputs + '/', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = {};
for (const id of Object.keys(contract.assets)) {
  const report = JSON.parse(await readFile(new URL(`${id}/validation.json`, output), 'utf8'));
  const runtime = sha(await readFile(new URL(`_rebuild/runtime/${id}.js`, output)));
  const glb = sha(await readFile(new URL(`_rebuild/exports/${id}.glb`, output)));
  assert.equal(runtime, report.hashes.runtime, `${id}: clean runtime rebuild differs`);
  assert.equal(glb, report.hashes.glb, `${id}: clean GLB rebuild differs`);
  results[id] = { runtime, glb, byteIdentical: true };
}
await writeFile(new URL('rebuild-validation.json', output), JSON.stringify(results, null, 2) + '\n');
console.log(`Clean factory rebuild: ${Object.keys(results).length} assets have identical runtime and GLB bytes`);
