import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const foundation = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Blender Foundation');
const installed = existsSync(foundation) ? readdirSync(foundation)
  .filter(name => name.startsWith('Blender ')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  .map(name => path.join(foundation, name, 'blender.exe')).find(existsSync) : null;
const blender = process.env.BLENDER_BIN || installed || 'blender';
const args = process.argv.slice(2), selector = args.indexOf('--asset');
const requested = selector < 0 ? 'all' : args[selector + 1];
const contractArg = args.indexOf('--contract');
const contractFile = contractArg < 0 ? 'assets.json' : args[contractArg + 1];
const contract = JSON.parse(readFileSync(path.join(root, 'tools/mech_authoring', contractFile), 'utf8'));
const ids = requested === 'all' ? Object.keys(contract.assets) : requested.split(',');
if (ids.some(id => !contract.assets[id])) throw new Error(`Unknown asset: ${requested}`);
const flags = args.filter((_, i) => selector < 0 || (i !== selector && i !== selector + 1));
// A factory process per asset prevents unused datablocks and previous actions entering the editable source.
for (const id of ids) {
  const processArgs = ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python', path.join(root, 'tools/mech_authoring/build.py'), '--', '--asset', id, ...flags];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(blender, processArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  });
  if (code) { process.exitCode = code; break; }
}
