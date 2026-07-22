import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mechsDir = path.resolve(__dirname, '../public/assets/cyberpunk_art/mechs');

function pad(n) {
  return String(n).padStart(2, '0');
}

// 1. Steel mechs t04 to t12
for (let i = 4; i <= 12; i++) {
  const num = pad(i);
  const srcPrefix = (i % 2 === 0) ? 't01' : 't02';
  for (const pose of ['static', 'moving', 'heavy']) {
    const target = path.join(mechsDir, `t${num}_${pose}.png`);
    const src = path.join(mechsDir, `${srcPrefix}_${pose}.png`);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(src, target);
      console.log(`Copied ${path.basename(src)} -> ${path.basename(target)}`);
    }
  }
}

// 2. Merc mechs m02 to m08
for (let i = 2; i <= 8; i++) {
  const num = pad(i);
  for (const mode of ['flight', 'ground']) {
    for (const pose of ['static', 'moving', 'heavy']) {
      const target = path.join(mechsDir, `m${num}_${mode}_${pose}.png`);
      const src = path.join(mechsDir, `m01_${mode}_${pose}.png`);
      if (!fs.existsSync(target)) {
        fs.copyFileSync(src, target);
        console.log(`Copied ${path.basename(src)} -> ${path.basename(target)}`);
      }
    }
  }
}

console.log('All missing mech placeholders successfully filled!');
