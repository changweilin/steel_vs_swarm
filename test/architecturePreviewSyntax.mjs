import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { serve } from './architecturePreview.mjs';

const server = serve(0);
try {
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(origin + '/')).text();
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert(script, 'preview module exists');
  const checked = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: script, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'preview controls have unique IDs');
  const geographic = await (await fetch(origin + '/preview/geographicPreview.js')).text();
  const imports = [...(script + geographic).matchAll(/from\s+['"](\/[^'"]+)['"]/g)].map(match => match[1]);
  assert(!imports.some(url => url.startsWith('/js/')), 'preview modules use the mirrored public layout');
  for (const url of new Set(imports)) {
    const response = await fetch(origin + url);
    assert.equal(response.status, 200, 'preview import is served: ' + url);
  }
  const manifest = await fetch(origin + '/public/assets/map-evidence/manifest.json');
  assert.equal(manifest.status, 200, 'relative evidence assets use the same public layout');
  assert(Object.keys((await manifest.json()).venues).length > 0, 'evidence manifest contains venue priors');
  console.log('PASS: preview JavaScript parses, controls have unique IDs, and public modules/assets are served.');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
