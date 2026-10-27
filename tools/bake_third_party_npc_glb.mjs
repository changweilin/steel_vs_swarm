// 烘焙第三方 NPC 單位與建築的 Procedural Mesh 為 GLB
// 輸出目錄: C:\Users\user\Documents\steel_vs_swarm\tools\ai3d\argon blender npc
import { chromiumOrNull, serve } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_DIR = 'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\argon blender npc';

const THIRD_PARTY_UNITS = [
  { id: 'guer_soldier', mapKind: 'creep:soldier', side: 'GUER' },
  { id: 'guer_rocketeer', mapKind: 'creep:rocketeer', side: 'GUER' },
  { id: 'guer_howitzer', mapKind: 'creep:howitzer', side: 'GUER' },
  { id: 'guer_tank', mapKind: 'creep:tank', side: 'GUER' },
  { id: 'guer_heli', mapKind: 'creep:heli', side: 'GUER' },
  { id: 'guer_bunker', mapKind: 'bunker', side: 'GUER' },
  { id: 'mili_soldier', mapKind: 'creep:soldier', side: 'MILI' },
  { id: 'mili_rocketeer', mapKind: 'creep:rocketeer', side: 'MILI' },
  { id: 'mili_howitzer', mapKind: 'creep:howitzer', side: 'MILI' },
  { id: 'mili_tank', mapKind: 'creep:tank', side: 'MILI' },
  { id: 'mili_heli', mapKind: 'creep:heli', side: 'MILI' },
  { id: 'mili_bunker', mapKind: 'bunker', side: 'MILI' },
];

async function main() {
  const chromium = await chromiumOrNull();
  if (!chromium) {
    console.error('Playwright / Chromium 未安裝');
    process.exit(1);
  }

  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  console.log(`啟動伺服器並載入環境...`);
  const server = await serve(8645);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(server.url, { waitUntil: 'networkidle' });

  console.log(`開始烘焙 12 款第三方單位/建築 GLB 至: ${TARGET_DIR}`);

  const results = [];
  for (const item of THIRD_PARTY_UNITS) {
    try {
      const glbBase64 = await page.evaluate(async ({ mapKind, side }) => {
        const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
        const { makeUnit } = await import('/public/js/models.js');
        const unit = makeUnit(mapKind, side, { ring: false });

        // 移除 runtime 賽璐璐描邊外殼與識別光圈 (維持 glTF 標準網格乾淨性)
        const toRemove = [];
        unit.group.traverse((o) => {
          if (o.userData.isOutline || o.userData.teamRing) toRemove.push(o);
        });
        for (const o of toRemove) o.parent?.remove(o);

        const exporter = new GLTFExporter();
        const arrayBuf = await new Promise((resolve, reject) => {
          exporter.parse(
            unit.group,
            (buf) => resolve(buf),
            (err) => reject(err),
            { binary: true }
          );
        });

        // 轉為 Base64 傳回 Node.js
        const bytes = new Uint8Array(arrayBuf);
        let binary = '';
        const len = bytes.byteLength;
        const chunkSize = 0x8000;
        for (let i = 0; i < len; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
        }
        return btoa(binary);
      }, { mapKind: item.mapKind, side: item.side });

      const buffer = Buffer.from(glbBase64, 'base64');
      const outPath = path.join(TARGET_DIR, `${item.id}.glb`);
      fs.writeFileSync(outPath, buffer);
      results.push({ id: item.id, size: buffer.length, status: 'OK' });
      console.log(`  ✓ [${item.id}.glb] 成功寫入 (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      results.push({ id: item.id, error: err.message, status: 'FAIL' });
      console.error(`  ✗ [${item.id}.glb] 烘焙失敗:`, err.message);
    }
  }

  await browser.close();
  server.close();

  console.log('\n烘焙完成總結:');
  console.table(results);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
