import { llToXZ } from './data.js';
import { randomMapModel, randomMapSamplers } from './randomMapSources.js';
import { RANDOM_MAP_TEXT } from './randomMapContent.js';
import { RANDOM_MAP_RANGES } from './randomMapRules.js';

export function drawRandomMapPreview(container, cfg) {
  if (!container) return;
  const model = randomMapModel(cfg), sample = randomMapSamplers(cfg), b = model.bounds;
  const canvas = document.createElement('canvas');
  const n = 128, size = 1024;
  canvas.width = canvas.height = size;
  canvas.setAttribute('aria-label', RANDOM_MAP_TEXT.preview);
  const ctx = canvas.getContext('2d');
  const h = new Float32Array(n * n);
  const cell = size / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = b.minX + (i + .5) / n * (b.maxX - b.minX), z = b.minZ + (j + .5) / n * (b.maxZ - b.minZ);
    const height = h[j * n + i] = sample.elevationAt(x, z);
    const shade = .82 + .2 * Math.max(-1, Math.min(1, height / RANDOM_MAP_RANGES.elevation.amplitudeM[1]));
    const rgb = sample.sampleColor(x, z).map(value => Math.round(value * shade));
    ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.fillRect(i * cell, j * cell, cell, cell);
  }
  ctx.strokeStyle = '#cdd6b766'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let j = 1; j < n; j++) for (let i = 1; i < n; i++) {
    const level = Math.floor(h[j * n + i] / 4);
    if (Math.floor(h[j * n + i - 1] / 4) !== level) { ctx.moveTo(i * cell, j * cell); ctx.lineTo(i * cell, (j + 1) * cell); }
    if (Math.floor(h[(j - 1) * n + i] / 4) !== level) { ctx.moveTo(i * cell, j * cell); ctx.lineTo((i + 1) * cell, j * cell); }
  }
  ctx.stroke();
  const project = p => {
    const [x, z] = llToXZ(p[0], p[1], cfg.center);
    return [(x - b.minX) / (b.maxX - b.minX) * size, (z - b.minZ) / (b.maxZ - b.minZ) * size];
  };
  for (const road of model.roads) {
    ctx.beginPath();
    road.geometry.forEach((p, i) => { const [x, y] = project([p.lat, p.lon]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = road.tags.highway === 'primary' ? '#e0c986' : '#bac3c5';
    ctx.lineWidth = road.tags.highway === 'primary' ? 6 : 3; ctx.stroke();
  }
  for (const [side, base] of Object.entries(cfg.bases)) {
    const [x, y] = project(base); ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fillStyle = side === 'SWARM' ? '#ffc247' : '#5fd0f2'; ctx.fill();
  }
  container.replaceChildren(canvas);
}
