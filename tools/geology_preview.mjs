// Local-only visual review. Never mounted by the battle server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../public/js/', import.meta.url);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const html = path === '/' || path === '/edge-fill';
  const file = html ? new URL(path === '/' ? './geology_preview.html' : './edge_fill_preview.html', import.meta.url)
    : /^\/js\/[a-zA-Z0-9_-]+\.js$/.test(path) ? new URL(path.slice(4), root) : null;
  if (!file) { res.writeHead(404).end(); return; }
  try {
    const content = await readFile(fileURLToPath(file));
    res.writeHead(200, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
server.listen(8634, '127.0.0.1', () => console.log('Geology preview: http://127.0.0.1:8634'));
