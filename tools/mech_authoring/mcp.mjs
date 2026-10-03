import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Use the installed MCP server without adding an authoring dependency to the game. */
export async function blenderMcp(name, args, timeout = 300000) {
  const executable = process.env.BLENDER_MCP_BIN || path.join(process.env.USERPROFILE || '', '.local/bin/mcp-for-blender.exe');
  if (!existsSync(executable)) throw new Error('Set BLENDER_MCP_BIN to the installed Blender MCP executable');
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map();
  let sequence = 0, buffer = '', diagnostics = '';
  child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-3000); });
  child.stdout.on('data', data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    }
  });
  const fail = error => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`Blender MCP exited (${code}): ${diagnostics}`)));
  const timer = setTimeout(() => { fail(new Error(`Blender MCP timed out: ${name}`)); child.kill(); }, timeout);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'steel-vs-swarm-authoring', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const result = await request('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    return result;
  } finally { clearTimeout(timer); child.kill(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const name of ['get_addon_status', 'get_scene_info']) {
    const result = await blenderMcp(name, { user_prompt: 'Inspect the isolated combat animation authoring scene' }, 45000);
    console.log(JSON.stringify({ name, result }));
  }
}
