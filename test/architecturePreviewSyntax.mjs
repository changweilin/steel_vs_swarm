import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { serve } from './architecturePreview.mjs';

const server = serve(0);
try {
  await once(server, 'listening');
  const html = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert(script, 'preview module exists');
  const checked = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: script, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'preview controls have unique IDs');
  console.log('PASS: served preview JavaScript parses and controls have unique IDs.');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
