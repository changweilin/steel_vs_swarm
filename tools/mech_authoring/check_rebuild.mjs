import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const refresh = process.argv.includes('--refresh-source');
const option = process.argv.indexOf('--contract');
const contractFile = option < 0 ? 'assets.json' : process.argv[option + 1];
const contract = JSON.parse(await readFile(new URL(contractFile, import.meta.url), 'utf8'));
const output = new URL(contract.authoring.outputs + '/', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = {};
for (const id of Object.keys(contract.assets)) {
  const report = JSON.parse(await readFile(new URL(`${id}/validation.json`, output), 'utf8'));
  const runtime = sha(await readFile(new URL(`_rebuild/runtime/${id}.js`, output)));
  const glb = sha(await readFile(new URL(`_rebuild/exports/${id}.glb`, output)));
  assert.equal(glb, report.hashes.glb, `${id}: clean GLB rebuild differs`);
  if (refresh) {
    const originalFile = new URL(`../../public/js/forge/assets/${id}.js`, import.meta.url);
    const rebuiltFile = new URL(`_rebuild/runtime/${id}.js`, output);
    const { default: original } = await import(originalFile.href);
    const { default: rebuilt } = await import(rebuiltFile.href);
    // A shared builder extension can change its fingerprint without changing an existing asset.
    // Promote only after proving every geometric, material and motion value and exact GLB unchanged.
    assert.equal(original.source.image, rebuilt.source.image, `${id}: reference image changed`);
    assert.deepEqual({ ...original, source: rebuilt.source }, rebuilt,
      `${id}: refresh would change authored content`);
    report.editableSourceRecipe ||= original.source;
    await writeFile(originalFile, await readFile(rebuiltFile));
    report.hashes.runtime = runtime;
    report.measurements.source = rebuilt.source;
    await writeFile(new URL(`${id}/validation.json`, output), JSON.stringify(report, null, 2) + '\n');
  }
  assert.equal(runtime, report.hashes.runtime, `${id}: clean runtime rebuild differs`);
  results[id] = { runtime, glb, byteIdentical: true };
}
await writeFile(new URL('rebuild-validation.json', output), JSON.stringify(results, null, 2) + '\n');
console.log(`Clean factory rebuild: ${Object.keys(results).length} assets have identical runtime and GLB bytes`);
