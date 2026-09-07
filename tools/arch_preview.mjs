// ============ 立體視覺驗收工作室 (dev-only; 建築與路網立體檢驗) ============
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { serve, DEFAULT_PORT } from '../test/architecturePreview.mjs';

export { serve, DEFAULT_PORT };

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  serve();
}
