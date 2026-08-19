#!/usr/bin/env node
/**
 * direct_ingest_v6.mjs (v6.0 Gemini 直讀照片多面體 3D 重建引擎)
 *
 * 與 v5 (`direct_ingest_all.mjs`) 並存,差異只在「怎麼決定每張照片長什麼形狀」:
 *   v5 = Python CV 萃取特徵 → 手寫規則匹配樣板 → 幾何合成
 *   v6 = Gemini API 直讀照片 → 結構化輸出回傳多面體零件列 → 幾何合成
 *
 * 幾何合成器(12 個多面體生成器)、落盤格式(model.json/features.json/metadata.json/model.obj)、
 * 資料庫索引(3d_database.json / parts_manifest.json)全部沿用 v5 — 零件台、稽核、消費端無感。
 *
 * 三條紀律:
 *   ① **可續跑**:讀 3d_database.json,已完成的跳過(Resume Protocol)。
 *   ② **降級不例外**(原則 6):API 失敗 → 記 error 跳過,MUST NOT 中止整批。
 *   ③ **零 npm 依賴**(A2):用 node:https 原生 fetch 呼叫 Gemini API。
 *
 * 用法:
 *   GEMINI_API_KEY=... node tools/ai3d/direct_ingest_v6.mjs
 *   GEMINI_API_KEY=... node tools/ai3d/direct_ingest_v6.mjs --limit 5
 *   GEMINI_API_KEY=... node tools/ai3d/direct_ingest_v6.mjs --family building
 *   GEMINI_API_KEY=... node tools/ai3d/direct_ingest_v6.mjs --model gemini-2.5-pro
 *   GEMINI_API_KEY=... node tools/ai3d/direct_ingest_v6.mjs --only building/mass
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname, basename, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const PHOTO_ROOTS = [
  'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\photos',
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\photos',
];

const OUT_ROOTS = [
  join(ROOT, 'out', '3d_data'),
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out\\3d_data',
];

const MANIFEST_PATH = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');
const DB_OUTPUT_LOCAL = join(ROOT, 'out', '3d_database.json');
const DB_OUTPUT_RESTRICTED = 'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out\\3d_database.json';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ── CLI 參數 ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const LIMIT = Number(arg('limit', Infinity));
const FAMILY_FILTER = arg('family');
const ONLY_FILTER = arg('only');
const MODEL = arg('model', 'gemini-3.7-flash');
const API_KEY = process.env.GEMINI_API_KEY || '';

// ── 照片掃描 ──────────────────────────────────────────────────────────
function findImages(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  function scan(curr) {
    for (const ent of readdirSync(curr, { withFileTypes: true })) {
      const full = join(curr, ent.name);
      if (ent.isDirectory()) scan(full);
      else if (IMAGE_EXTS.has(extname(ent.name).toLowerCase())) results.push(full);
    }
  }
  scan(dir);
  return results;
}

function parseCategory(photoPath, baseDir) {
  const rel = relative(baseDir, photoPath).replace(/\\/g, '/');
  const segs = rel.split('/');
  const family = segs[0] || 'misc';
  const subpart = segs.length > 2 ? segs[1]
    : (family === 'building' ? 'mass' : (family === 'ship' ? 'hull' : (family === 'tree' ? 'canopy' : 'main')));
  const filename = segs[segs.length - 1];
  const stem = basename(filename, extname(filename));
  return { rel, family, subpart, filename, stem };
}

// ── Gemini API 呼叫層(零 npm 依賴,node:https 原生)──────────────────
const GEMINI_SYSTEM_PROMPT = `你是一位專精於 3D 多面體幾何重建的工程師。你的工作是分析一張照片,精確辨識物體的形狀、結構、比例與色彩,然後以宣告式多面體零件列描述該物件的 3D 幾何。

## 多面體語彙(只准使用以下 type)
| type | 參數 | 適用場景 |
|---|---|---|
| box | dimensions: [w, h, d] | 建築基底、貨櫃、看板、陽台板 |
| polygonal_prism | radius, height, sides (3-16) | 六/八角塔、柱列、支撐 |
| frustum_pyramid | radii: [topR, botR], height, sides | 飛簷、針葉樹冠裙、柱頭 |
| pyramid | radii: [0, botR], height, sides | 尖塔、松樹頂 |
| cone | radius, height, sides | 圓錐蓋 |
| cylinder | radii: [topR, botR], height, sides | 鋼管、煙囪、樹幹、電線杆 |
| conical_frustum | radii: [topR, botR], height, sides | 漸縮樹幹、錐形槽 |
| hemisphere_dome | radii: [rx, ry, rz] | 穹頂、雷達罩 |
| ellipsoid_sphere | radii: [rx, ry, rz] | 闊葉冠簇、灌木、岩丘 |
| torus_ring | radius, tube | 輪胎、管法蘭 |
| dodecahedron_polyhedron | radius | 巨石碎塊、結晶 |
| icosahedron_polyhedron | radius | 粗糙礦石、珊瑚 |
| wedge | dimensions: [w, h, d] | 山牆屋頂、船首楔 |

## 色彩紀律(7-Zone)
每個零件的 colorKey 必須是以下七個之一:
- roofHex: 屋頂、上層冠簇、車頂
- facadeHex: 外牆、車身、主幹
- baseHex: 基座、底盤、根部
- accentHex: 招牌、頭燈框、裝飾
- glassHex: 窗戶、擋風玻璃(冷色調 navy/cyan)
- darkHex: 機械底部、排氣管、輪胎、深色凹陷
- brightHex: 鍍鉻飾條、燈具

## 重要規則
1. 每個零件 MUST 有 pos(position [x,y,z])且 y=0 為地面接觸面
2. 拼裝時各零件不重疊且精確相接
3. 對稱物件使用鏡射(沿 Z 軸)
4. 不要把天空/雲/背景誤認為幾何
5. 玻璃 MUST 與車身/牆面顏色嚴格分離
6. 尺寸使用公尺,符合真實世界比例`;

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    style: { type: 'string', description: '物件風格分類' },
    symmetryMode: { type: 'string', enum: ['symmetric', 'asymmetric'] },
    colors: {
      type: 'object',
      properties: {
        roofHex: { type: 'integer' },
        facadeHex: { type: 'integer' },
        baseHex: { type: 'integer' },
        accentHex: { type: 'integer' },
        glassHex: { type: 'integer' },
        darkHex: { type: 'integer' },
        brightHex: { type: 'integer' },
      },
      required: ['roofHex', 'facadeHex', 'baseHex', 'accentHex', 'glassHex', 'darkHex', 'brightHex'],
    },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '零件名稱' },
          type: { type: 'string', description: '多面體類型' },
          dimensions: { type: 'array', items: { type: 'number' }, description: '[w,h,d] for box/wedge' },
          radius: { type: 'number', description: 'prism/dodecahedron/icosahedron' },
          radii: { type: 'array', items: { type: 'number' }, description: '[topR,botR] or [rx,ry,rz]' },
          height: { type: 'number' },
          sides: { type: 'integer' },
          tube: { type: 'number', description: 'torus tube radius' },
          pos: { type: 'array', items: { type: 'number' }, description: '[x,y,z] position' },
          rot: { type: 'array', items: { type: 'number' }, description: '[rx,ry,rz] rotation in radians' },
          colorKey: { type: 'string', description: '7-Zone 色彩鍵' },
        },
        required: ['name', 'type', 'pos', 'colorKey'],
      },
    },
  },
  required: ['style', 'symmetryMode', 'colors', 'parts'],
};

/**
 * 呼叫 Gemini API(node:https 原生,零 npm 依賴)。
 * 送入照片 base64 + 系統提示詞 → 取回結構化 JSON。
 */
async function callGemini(imageBase64, mimeType, family, subpart) {
  const userPrompt = `分析這張 ${family}/${subpart} 的照片,以多面體零件列精確重建其 3D 幾何。注意真實世界尺寸(公尺)。`;

  const body = JSON.stringify({
    contents: [{
      parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: userPrompt },
      ],
    }],
    systemInstruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(raw);
          if (json.error) {
            reject(new Error(`Gemini API 錯誤: ${json.error.message || JSON.stringify(json.error)}`));
            return;
          }
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            reject(new Error('Gemini API 回傳空白(可能被安全過濾或額度耗盡)'));
            return;
          }
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error(`Gemini 回應解析失敗: ${e.message}\n回應片段: ${raw.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120_000, () => { req.destroy(); reject(new Error('Gemini API 逾時(120s)')); });
    req.write(body);
    req.end();
  });
}

// ── 多面體幾何合成器(沿用 v5 全套 12 個生成器)──────────────────────
function buildGeometryFromParts(geminiResult, family, subpart, stem) {
  const vertices = [];
  const normals = [];
  const uvs = [];
  const faces = [];
  const partsOut = [];

  const colors = geminiResult.colors || {};
  const colorMap = {
    roofHex: colors.roofHex || 0x7f8c8d,
    facadeHex: colors.facadeHex || 0x95a5a6,
    baseHex: colors.baseHex || 0x34495e,
    accentHex: colors.accentHex || 0xe67e22,
    darkHex: colors.darkHex || 0x2c3e50,
    brightHex: colors.brightHex || 0xecf0f1,
    glassHex: colors.glassHex || 0x1e293b,
  };
  if (!colorMap.glassHex || colorMap.glassHex === colorMap.facadeHex) {
    colorMap.glassHex = 0x1e293b;
  }

  function transformPoint(vx, vy, vz, px, py, pz, rx, ry, rz) {
    let x = vx, y = vy, z = vz;
    if (rx) { const c = Math.cos(rx), s = Math.sin(rx); const y1 = y * c - z * s, z1 = y * s + z * c; y = y1; z = z1; }
    if (ry) { const c = Math.cos(ry), s = Math.sin(ry); const x1 = x * c + z * s, z1 = -x * s + z * c; x = x1; z = z1; }
    if (rz) { const c = Math.cos(rz), s = Math.sin(rz); const x1 = x * c - y * s, y1 = x * s + y * c; x = x1; y = y1; }
    return [x + px, y + py, z + pz];
  }

  const f4 = (n) => Number(Number(n).toFixed(4));
  const f3 = (n) => Number(Number(n).toFixed(3));

  // 1. Box
  function addBox(w, h, d, px, py, pz, rx, ry, rz, partName, color) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const vBase = vertices.length / 3;
    const rawVerts = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd],
      [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd],
    ];
    for (const [vx, vy, vz] of rawVerts) {
      const [x, y, z] = transformPoint(vx, vy, vz, px, py, pz, rx, ry, rz);
      vertices.push(f4(x), f4(y), f4(z)); uvs.push(0.5, 0.5); normals.push(0, 1, 0);
    }
    for (const [a, b, c] of [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]) {
      faces.push(vBase + a, vBase + b, vBase + c);
    }
    partsOut.push({ name: partName, type: 'box', dimensions: [f3(w), f3(h), f3(d)],
      position: [f3(px), f3(py), f3(pz)], rotation: [f3(rx), f3(ry), f3(rz)], color, triangles: 12 });
  }

  // 2. Polygonal Prism
  function addPrism(sides, radius, h, px, py, pz, rx, ry, rz, partName, color) {
    const vBase = vertices.length / 3;
    const hh = h / 2;
    for (let i = 0; i < sides; i++) {
      const th = (i / sides) * Math.PI * 2;
      const [x, y, z] = transformPoint(Math.cos(th) * radius, -hh, Math.sin(th) * radius, px, py, pz, rx, ry, rz);
      vertices.push(f4(x), f4(y), f4(z)); uvs.push(i / sides, 0); normals.push(0, -1, 0);
    }
    for (let i = 0; i < sides; i++) {
      const th = (i / sides) * Math.PI * 2;
      const [x, y, z] = transformPoint(Math.cos(th) * radius, hh, Math.sin(th) * radius, px, py, pz, rx, ry, rz);
      vertices.push(f4(x), f4(y), f4(z)); uvs.push(i / sides, 1); normals.push(0, 1, 0);
    }
    const [bx, by, bz] = transformPoint(0, -hh, 0, px, py, pz, rx, ry, rz);
    vertices.push(f4(bx), f4(by), f4(bz)); uvs.push(0.5, 0.5); normals.push(0, -1, 0);
    const [tx, ty, tz] = transformPoint(0, hh, 0, px, py, pz, rx, ry, rz);
    vertices.push(f4(tx), f4(ty), f4(tz)); uvs.push(0.5, 0.5); normals.push(0, 1, 0);
    const bc = vBase + 2 * sides, tc = vBase + 2 * sides + 1;
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides;
      faces.push(vBase + i, vBase + n, vBase + sides + n);
      faces.push(vBase + i, vBase + sides + n, vBase + sides + i);
      faces.push(bc, vBase + n, vBase + i);
      faces.push(tc, vBase + sides + i, vBase + sides + n);
    }
    partsOut.push({ name: partName, type: 'polygonal_prism', sides, radius: f3(radius), height: f3(h),
      position: [f3(px), f3(py), f3(pz)], rotation: [f3(rx), f3(ry), f3(rz)], color, triangles: 4 * sides });
  }

  // 3. Frustum Pyramid (也服務 pyramid/cylinder/conical_frustum/cone)
  function addFrustum(sides, topR, botR, h, px, py, pz, rx, ry, rz, partName, color, typeName = 'frustum_pyramid') {
    const vBase = vertices.length / 3;
    const hh = h / 2;
    for (let i = 0; i < sides; i++) {
      const th = (i / sides) * Math.PI * 2 + (sides === 4 ? Math.PI / 4 : 0);
      const [x, y, z] = transformPoint(Math.cos(th) * botR, -hh, Math.sin(th) * botR, px, py, pz, rx, ry, rz);
      vertices.push(f4(x), f4(y), f4(z)); uvs.push(i / sides, 0); normals.push(0, -1, 0);
    }
    for (let i = 0; i < sides; i++) {
      const th = (i / sides) * Math.PI * 2 + (sides === 4 ? Math.PI / 4 : 0);
      const [x, y, z] = transformPoint(Math.cos(th) * topR, hh, Math.sin(th) * topR, px, py, pz, rx, ry, rz);
      vertices.push(f4(x), f4(y), f4(z)); uvs.push(i / sides, 1); normals.push(0, 1, 0);
    }
    const [bx, by, bz] = transformPoint(0, -hh, 0, px, py, pz, rx, ry, rz);
    vertices.push(f4(bx), f4(by), f4(bz)); uvs.push(0.5, 0.5); normals.push(0, -1, 0);
    const [tx, ty, tz] = transformPoint(0, hh, 0, px, py, pz, rx, ry, rz);
    vertices.push(f4(tx), f4(ty), f4(tz)); uvs.push(0.5, 0.5); normals.push(0, 1, 0);
    const bc = vBase + 2 * sides, tc = vBase + 2 * sides + 1;
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides;
      faces.push(vBase + i, vBase + n, vBase + sides + n);
      faces.push(vBase + i, vBase + sides + n, vBase + sides + i);
      if (botR > 0) faces.push(bc, vBase + n, vBase + i);
      if (topR > 0) faces.push(tc, vBase + sides + i, vBase + sides + n);
    }
    partsOut.push({ name: partName, type: typeName, sides, radii: [f3(topR), f3(botR)], height: f3(h),
      position: [f3(px), f3(py), f3(pz)], rotation: [f3(rx), f3(ry), f3(rz)], color, triangles: 4 * sides });
  }

  // 7. Sphere / Hemisphere / Ellipsoid
  function addSphere(rx, ry, rz, px, py, pz, rotX, rotY, rotZ, partName, color, isHemi = false) {
    const segsW = 10, segsH = 8;
    const vBase = vertices.length / 3;
    const maxLat = isHemi ? Math.PI / 2 : Math.PI;
    for (let j = 0; j <= segsH; j++) {
      const phi = (j / segsH) * maxLat, sinP = Math.sin(phi), cosP = Math.cos(phi);
      for (let i = 0; i <= segsW; i++) {
        const th = (i / segsW) * Math.PI * 2;
        const vx = Math.cos(th) * sinP * rx, vy = cosP * ry, vz = Math.sin(th) * sinP * rz;
        const [x, y, z] = transformPoint(vx, vy, vz, px, py, pz, rotX, rotY, rotZ);
        vertices.push(f4(x), f4(y), f4(z)); uvs.push(i / segsW, j / segsH);
        normals.push(vx / (rx || 1), vy / (ry || 1), vz / (rz || 1));
      }
    }
    const rowSize = segsW + 1;
    for (let j = 0; j < segsH; j++) {
      for (let i = 0; i < segsW; i++) {
        const a = vBase + j * rowSize + i, b = vBase + (j + 1) * rowSize + i;
        const c = vBase + (j + 1) * rowSize + (i + 1), d = vBase + j * rowSize + (i + 1);
        faces.push(a, b, c); faces.push(a, c, d);
      }
    }
    if (isHemi) {
      const botC = vertices.length / 3;
      const [bx, by, bz] = transformPoint(0, 0, 0, px, py, pz, rotX, rotY, rotZ);
      vertices.push(f4(bx), f4(by), f4(bz)); uvs.push(0.5, 0.5); normals.push(0, -1, 0);
      const botRow = vBase + segsH * rowSize;
      for (let i = 0; i < segsW; i++) faces.push(botC, botRow + i, botRow + i + 1);
    }
    partsOut.push({ name: partName, type: isHemi ? 'hemisphere_dome' : 'ellipsoid_sphere',
      radii: [f3(rx), f3(ry), f3(rz)],
      position: [f3(px), f3(py), f3(pz)], rotation: [f3(rotX), f3(rotY), f3(rotZ)], color,
      triangles: (segsW * segsH * 2) + (isHemi ? segsW : 0) });
  }

  // 8. Torus
  function addTorus(R, r, px, py, pz, rx, ry, rz, partName, color) {
    const segsR = 10, segsT = 6;
    const vBase = vertices.length / 3;
    for (let j = 0; j <= segsR; j++) {
      const u = (j / segsR) * Math.PI * 2, cosU = Math.cos(u), sinU = Math.sin(u);
      for (let i = 0; i <= segsT; i++) {
        const v = (i / segsT) * Math.PI * 2;
        const vx = (R + r * Math.cos(v)) * cosU, vy = r * Math.sin(v), vz = (R + r * Math.cos(v)) * sinU;
        const [x, y, z] = transformPoint(vx, vy, vz, px, py, pz, rx, ry, rz);
        vertices.push(f4(x), f4(y), f4(z)); uvs.push(j / segsR, i / segsT);
        normals.push(cosU * Math.cos(v), Math.sin(v), sinU * Math.cos(v));
      }
    }
    const rowS = segsT + 1;
    for (let j = 0; j < segsR; j++) {
      for (let i = 0; i < segsT; i++) {
        const a = vBase + j * rowS + i, b = vBase + (j + 1) * rowS + i;
        const c = vBase + (j + 1) * rowS + (i + 1), d = vBase + j * rowS + (i + 1);
        faces.push(a, b, c); faces.push(a, c, d);
      }
    }
    partsOut.push({ name: partName, type: 'torus_ring', radius: f3(R), tube: f3(r),
      position: [f3(px), f3(py), f3(pz)], rotation: [f3(rx), f3(ry), f3(rz)], color, triangles: segsR * segsT * 2 });
  }

  // 9. Wedge
  function addWedge(w, h, d, px, py, pz, rx, ry, rz, partName, color) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const vBase = vertices.length / 3;
    const rawVerts = [[-hw,-hh,-hd],[hw,-hh,-hd],[hw,-hh,hd],[-hw,-hh,hd],[-hw,hh,-hd],[hw,hh,-hd]];
    for (const [vx, vy, vz] of rawVerts) {
      const [x, y, z] = transformPoint(vx, vy, vz, px, py, pz, rx, ry, rz);
      vertices.push(f4(x), f4(y), f4(z)); uvs.push(0.5, 0.5); normals.push(0, 1, 0);
    }
    for (const [a, b, c] of [[0,2,1],[0,3,2],[0,1,5],[0,5,4],[2,3,4],[2,4,5],[0,4,3],[1,2,5]]) {
      faces.push(vBase + a, vBase + b, vBase + c);
    }
    partsOut.push({ name: partName, type: 'wedge', dimensions: [f3(w), f3(h), f3(d)],
      position: [f3(px), f3(py), f3(pz)], rotation: [f3(rx), f3(ry), f3(rz)], color, triangles: 8 });
  }

  // 10. Dodecahedron
  function addDodecahedron(r, px, py, pz, rx, ry, rz, partName, color) {
    const vBase = vertices.length / 3;
    const phi = (1 + Math.sqrt(5)) / 2, a = r / Math.sqrt(3), b = a / phi, c = a * phi;
    const rawVerts = [
      [-a,-a,-a],[-a,-a,a],[-a,a,-a],[-a,a,a],[a,-a,-a],[a,-a,a],[a,a,-a],[a,a,a],
      [0,-b,-c],[0,-b,c],[0,b,-c],[0,b,c],[-b,-c,0],[-b,c,0],[b,-c,0],[b,c,0],
      [-c,0,-b],[-c,0,b],[c,0,-b],[c,0,b],
    ];
    for (const [vx, vy, vz] of rawVerts) {
      const [x, y, z] = transformPoint(vx, vy, vz, px, py, pz, rx, ry, rz);
      vertices.push(f4(x), f4(y), f4(z)); uvs.push(0.5, 0.5); normals.push(vx / r, vy / r, vz / r);
    }
    for (const p of [[0,8,4,14,12],[0,16,2,10,8],[0,12,1,17,16],[8,10,6,18,4],[2,13,3,11,10],[2,16,17,3,13],
      [4,18,19,5,14],[6,15,7,19,18],[6,10,11,7,15],[1,9,5,14,12],[1,17,3,11,9],[5,19,7,15,9]]) {
      faces.push(vBase + p[0], vBase + p[1], vBase + p[2]);
      faces.push(vBase + p[0], vBase + p[2], vBase + p[3]);
      faces.push(vBase + p[0], vBase + p[3], vBase + p[4]);
    }
    partsOut.push({ name: partName, type: 'dodecahedron_polyhedron', radius: f3(r),
      position: [f3(px), f3(py), f3(pz)], rotation: [f3(rx), f3(ry), f3(rz)], color, triangles: 36 });
  }

  // 11. Icosahedron(v5 沒有完整生成器,補上)
  function addIcosahedron(r, px, py, pz, rx, ry, rz, partName, color) {
    const vBase = vertices.length / 3;
    const t = (1 + Math.sqrt(5)) / 2;
    const n = r / Math.sqrt(1 + t * t);
    const rawVerts = [
      [-n,t*n,0],[n,t*n,0],[-n,-t*n,0],[n,-t*n,0],
      [0,-n,t*n],[0,n,t*n],[0,-n,-t*n],[0,n,-t*n],
      [t*n,0,-n],[t*n,0,n],[-t*n,0,-n],[-t*n,0,n],
    ];
    for (const [vx, vy, vz] of rawVerts) {
      const [x, y, z] = transformPoint(vx, vy, vz, px, py, pz, rx, ry, rz);
      vertices.push(f4(x), f4(y), f4(z)); uvs.push(0.5, 0.5); normals.push(vx / r, vy / r, vz / r);
    }
    const icoFaces = [
      [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
      [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ];
    for (const [a, b, c] of icoFaces) faces.push(vBase + a, vBase + b, vBase + c);
    partsOut.push({ name: partName, type: 'icosahedron_polyhedron', radius: f3(r),
      position: [f3(px), f3(py), f3(pz)], rotation: [f3(rx), f3(ry), f3(rz)], color, triangles: 20 });
  }

  // ── 根據 Gemini 回傳的零件列驅動生成器 ──
  const gParts = geminiResult.parts || [];
  for (const p of gParts) {
    const pos = p.pos || [0, 0, 0];
    const rot = p.rot || [0, 0, 0];
    const col = colorMap[p.colorKey] || colorMap.facadeHex;
    const px = pos[0] || 0, py = pos[1] || 0, pz = pos[2] || 0;
    const rx = rot[0] || 0, ry = rot[1] || 0, rz = rot[2] || 0;
    const nm = p.name || 'part';

    switch (p.type) {
      case 'box': {
        const d = p.dimensions || [1, 1, 1];
        addBox(d[0], d[1], d[2], px, py, pz, rx, ry, rz, nm, col);
        break;
      }
      case 'polygonal_prism': {
        addPrism(p.sides || 6, p.radius || 1, p.height || 1, px, py, pz, rx, ry, rz, nm, col);
        break;
      }
      case 'frustum_pyramid': {
        const r = p.radii || [0.5, 1];
        addFrustum(p.sides || 4, r[0], r[1], p.height || 1, px, py, pz, rx, ry, rz, nm, col, 'frustum_pyramid');
        break;
      }
      case 'pyramid': {
        const r = p.radii || [0, 1];
        addFrustum(p.sides || 4, 0.001, r[1] || p.radius || 1, p.height || 1, px, py, pz, rx, ry, rz, nm, col, 'pyramid');
        break;
      }
      case 'cone': {
        addFrustum(p.sides || 12, 0.001, p.radius || 1, p.height || 1, px, py, pz, rx, ry, rz, nm, col, 'cone');
        break;
      }
      case 'cylinder': {
        const r = p.radii || [p.radius || 1, p.radius || 1];
        addFrustum(p.sides || 12, r[0], r[1], p.height || 1, px, py, pz, rx, ry, rz, nm, col, 'cylinder');
        break;
      }
      case 'conical_frustum': {
        const r = p.radii || [0.5, 1];
        addFrustum(p.sides || 12, r[0], r[1], p.height || 1, px, py, pz, rx, ry, rz, nm, col, 'conical_frustum');
        break;
      }
      case 'hemisphere_dome': {
        const r = p.radii || [1, 1, 1];
        addSphere(r[0], r[1], r[2], px, py, pz, rx, ry, rz, nm, col, true);
        break;
      }
      case 'ellipsoid_sphere': {
        const r = p.radii || [1, 1, 1];
        addSphere(r[0], r[1], r[2], px, py, pz, rx, ry, rz, nm, col, false);
        break;
      }
      case 'torus_ring': {
        addTorus(p.radius || 1, p.tube || 0.2, px, py, pz, rx, ry, rz, nm, col);
        break;
      }
      case 'dodecahedron_polyhedron': {
        addDodecahedron(p.radius || 1, px, py, pz, rx, ry, rz, nm, col);
        break;
      }
      case 'icosahedron_polyhedron': {
        addIcosahedron(p.radius || 1, px, py, pz, rx, ry, rz, nm, col);
        break;
      }
      case 'wedge': {
        const d = p.dimensions || [1, 1, 1];
        addWedge(d[0], d[1], d[2], px, py, pz, rx, ry, rz, nm, col);
        break;
      }
      default:
        console.warn(`  ⚠ 未知零件類型「${p.type}」,跳過: ${nm}`);
    }
  }

  // ── 計算邊界框 ──
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const vx = vertices[i], vy = vertices[i + 1], vz = vertices[i + 2];
    if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
    if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
  }
  if (!isFinite(minX)) { minX = maxX = minY = maxY = minZ = maxZ = 0; }

  const bounds = {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [f3(maxX - minX), f3(maxY - minY), f3(maxZ - minZ)],
    rMax: f3(Math.max(Math.hypot(minX, minZ), Math.hypot(maxX, maxZ))),
    triangles: faces.length / 3,
    vertices: vertices.length / 3,
  };

  // ── OBJ 輸出 ──
  const objLines = [
    `# 3D Model: ${family}/${subpart}/${stem} (v6 Gemini)`,
    `# Style: ${geminiResult.style} | Symmetry: ${geminiResult.symmetryMode}`,
    `# Dimensions: ${bounds.size.join(' x ')} m`,
    `# Triangles: ${bounds.triangles} | Vertices: ${bounds.vertices}`,
  ];
  for (let i = 0; i < vertices.length; i += 3) objLines.push(`v ${vertices[i]} ${vertices[i + 1]} ${vertices[i + 2]}`);
  for (let i = 0; i < uvs.length; i += 2) objLines.push(`vt ${uvs[i]} ${uvs[i + 1]}`);
  for (let i = 0; i < normals.length; i += 3) objLines.push(`vn ${normals[i]} ${normals[i + 1]} ${normals[i + 2]}`);
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i] + 1, b = faces[i + 1] + 1, c = faces[i + 2] + 1;
    objLines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }

  const modelJson = {
    id: `${family}_${subpart}_${stem}`, family, subpart,
    style: geminiResult.style, symmetryMode: geminiResult.symmetryMode,
    spec: { style: geminiResult.style }, bounds,
    parts: partsOut, reconstructedFeatures: [],
    meshData: { vertexCount: vertices.length / 3, triangleCount: faces.length / 3, vertices, normals, uvs, faces },
  };

  const featuresJson = {
    id: `${family}_${subpart}_${stem}`,
    sourceImage: `${family}/${subpart}/${stem}`,
    style: geminiResult.style, symmetryMode: geminiResult.symmetryMode,
    colors: colorMap,
    totalParts: partsOut.length,
    partNames: partsOut.map((p) => p.name),
    polyhedralPrimitivesUsed: [...new Set(partsOut.map((p) => p.type))],
  };

  return { objContent: objLines.join('\n'), modelJson, featuresJson, bounds };
}

// ── 主程式 ────────────────────────────────────────────────────────────
async function main() {
  console.log('======================================================================');
  console.log('▶ AI 3D v6.0 Gemini 直讀照片多面體 3D 重建引擎');
  console.log(`  模型: ${MODEL}`);
  console.log('======================================================================');

  if (!API_KEY) {
    console.error('❌ 請設定 GEMINI_API_KEY 環境變數:');
    console.error('   set GEMINI_API_KEY=your-key-here    (Windows cmd)');
    console.error('   $env:GEMINI_API_KEY="your-key-here" (PowerShell)');
    process.exit(1);
  }

  for (const root of OUT_ROOTS) {
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }

  // ── 載入既有資料庫(續跑)──
  const existingDb = new Set();
  if (existsSync(DB_OUTPUT_LOCAL)) {
    try {
      const db = JSON.parse(readFileSync(DB_OUTPUT_LOCAL, 'utf8'));
      for (const item of (db.items || [])) {
        if (item.version === 6) existingDb.add(item.key);
      }
    } catch { /* 損壞不是例外 */ }
  }

  // ── 掃描照片 ──
  const allImages = [];
  for (const root of PHOTO_ROOTS) {
    if (existsSync(root)) {
      const imgs = findImages(root);
      console.log(`📂 發現照片來源: ${root} (共 ${imgs.length} 張)`);
      for (const img of imgs) allImages.push({ path: img, baseDir: root });
    } else {
      mkdirSync(root, { recursive: true });
    }
  }

  // ── 篩選 ──
  const filtered = allImages.filter(({ path: imgPath, baseDir }) => {
    const { family, subpart } = parseCategory(imgPath, baseDir);
    if (FAMILY_FILTER && family !== FAMILY_FILTER) return false;
    if (ONLY_FILTER && `${family}/${subpart}` !== ONLY_FILTER) return false;
    return true;
  });

  console.log(`\n🔍 篩選後清單: ${filtered.length} 張照片(上限: ${LIMIT})。開始 Gemini 3D 重建...`);

  // ── 載入 parts_manifest ──
  let partsManifest = { version: 1, note: 'AI 生成 3D 物件的來源帳', parts: [] };
  if (existsSync(MANIFEST_PATH)) {
    try { partsManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch {}
  }
  const existingPartKeys = new Set(partsManifest.parts.flatMap((p) => p.keys || (p.key ? [p.key] : [])));

  const database3D = [];
  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let idx = 0; idx < filtered.length && processedCount < LIMIT; idx++) {
    const { path: imgPath, baseDir } = filtered[idx];
    const { rel, family, subpart, filename, stem } = parseCategory(imgPath, baseDir);
    const targetId = `${family}_${subpart}_${stem}_v6`.replace(/[^\w.-]+/g, '_');
    const hash = createHash('sha1').update(rel).digest('hex').slice(0, 8);
    const partKey = `${family}/${subpart}_${stem}_${hash}_v6`;

    // 續跑:已有 v6 版本跳過
    if (existingDb.has(partKey)) {
      skippedCount++;
      continue;
    }

    console.log(`\n  🖼  [${processedCount + 1}] ${family}/${subpart}/${filename}`);

    // ── 讀取照片 → base64 ──
    let imageBase64, mimeType;
    try {
      const imgBuf = readFileSync(imgPath);
      imageBase64 = imgBuf.toString('base64');
      const ext = extname(imgPath).toLowerCase();
      mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    } catch (e) {
      console.warn(`  ⚠ 讀取照片失敗: ${e.message}`);
      errorCount++;
      continue;
    }

    // ── 呼叫 Gemini ──
    let geminiResult;
    try {
      geminiResult = await callGemini(imageBase64, mimeType, family, subpart);
    } catch (e) {
      console.warn(`  ⚠ Gemini API 失敗: ${e.message}`);
      errorCount++;
      continue;  // 降級不例外(原則 6)
    }

    if (!geminiResult?.parts?.length) {
      console.warn('  ⚠ Gemini 回傳零件列為空,跳過');
      errorCount++;
      continue;
    }

    console.log(`  ✓ Gemini 回傳 ${geminiResult.parts.length} 個零件 (Style: ${geminiResult.style})`);

    // ── 幾何合成 ──
    const { objContent, modelJson, featuresJson, bounds } = buildGeometryFromParts(geminiResult, family, subpart, stem);

    // ── 原子落盤 ──
    for (const outRoot of OUT_ROOTS) {
      const targetDir = join(outRoot, family, subpart, targetId);
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      writeFileSync(join(targetDir, 'model.obj'), objContent, 'utf8');
      writeFileSync(join(targetDir, 'model.json'), JSON.stringify(modelJson, null, 2), 'utf8');
      writeFileSync(join(targetDir, 'features.json'), JSON.stringify(featuresJson, null, 2), 'utf8');
      const metadata = {
        id: targetId, key: partKey, family, subpart,
        style: geminiResult.style, symmetryMode: geminiResult.symmetryMode,
        version: 6, verStr: 'v6',
        source_image: rel, source_full_path: imgPath,
        created_at: new Date().toISOString(),
        bounds, spec: { style: geminiResult.style },
        method: 'gemini_v6', status: 'ingested',
      };
      writeFileSync(join(targetDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    }

    // ── 資料庫索引 ──
    database3D.push({
      id: targetId, key: partKey, family, subpart,
      style: geminiResult.style, symmetryMode: geminiResult.symmetryMode,
      version: 6, verStr: 'v6',
      image: rel, bounds, spec: { style: geminiResult.style },
      triangles: bounds.triangles,
      outputDir: `out/3d_data/${family}/${subpart}/${targetId}`,
    });

    // ── 來源帳 ──
    if (!existingPartKeys.has(partKey)) {
      partsManifest.parts.push({
        method: 'gemini_v6', version: 6, verStr: 'v6',
        consumer: `${family} catalog & partlib (${subpart})`,
        rev: 'HEAD', at: new Date().toISOString().slice(0, 10),
        imgs: [{
          role: 'primary', id: `img_${hash}`, family, part: subpart,
          query: stem, api: 'gemini_v6', license: 'unverified(restricted/local)',
          creator: null, source_url: '', file: rel,
        }],
        gen: {
          tool: `Gemini v6 Polyhedral Reconstruction (${MODEL})`,
          runner: 'tools/ai3d/direct_ingest_v6.mjs',
          params: `--model ${MODEL} --family ${family}`,
          machine: `Gemini API (${MODEL})`,
          measured: `Triangles ${bounds.triangles}, Vertices ${bounds.vertices}`,
        },
        post: {
          tool: 'tools/ai3d/direct_ingest_v6.mjs',
          fit: 1.0, bounds: bounds.size,
          note: `Extents [${bounds.size.join(', ')}]m, rMax ${bounds.rMax}m`,
        },
        keys: [partKey],
      });
      existingPartKeys.add(partKey);
    }

    processedCount++;
    console.log(`  ⚡ Triangles: ${bounds.triangles}, Vertices: ${bounds.vertices}, Size: [${bounds.size.join(', ')}]m`);
  }

  // ── 寫入來源帳 ──
  writeFileSync(MANIFEST_PATH, JSON.stringify(partsManifest, null, 2), 'utf8');
  console.log(`\n✅ 已更新 parts_manifest.json (共 ${partsManifest.parts.length} 筆)`);

  // ── 合併 3d_database.json(v5 + v6 共存)──
  let existingItems = [];
  if (existsSync(DB_OUTPUT_LOCAL)) {
    try {
      const db = JSON.parse(readFileSync(DB_OUTPUT_LOCAL, 'utf8'));
      existingItems = (db.items || []).filter((item) => item.version !== 6);
    } catch { /* 損壞不是例外 */ }
  }
  const allItems = [...existingItems, ...database3D];
  const dbData = {
    version: 6, verStr: 'v6',
    generated_at: new Date().toISOString(),
    total_objects: allItems.length,
    families: [...new Set(allItems.map((d) => d.family))],
    items: allItems,
  };
  writeFileSync(DB_OUTPUT_LOCAL, JSON.stringify(dbData, null, 2), 'utf8');
  if (existsSync('C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out')) {
    writeFileSync(DB_OUTPUT_RESTRICTED, JSON.stringify(dbData, null, 2), 'utf8');
  }
  console.log(`✅ 已更新 3d_database.json (共 ${allItems.length} 筆,其中 v6: ${database3D.length} 筆)`);

  // ── 更新 harvest_state ──
  const harvestState = {
    at: new Date().toISOString(),
    completed_items: allItems.length,
    status: `completed_v6_gemini_${processedCount}_items`,
  };
  writeFileSync(join(ROOT, 'tools', 'ai3d', 'harvest_state.json'), JSON.stringify(harvestState, null, 2), 'utf8');

  console.log('======================================================================');
  console.log(`🎉 v6 完成: 處理 ${processedCount} 張, 跳過 ${skippedCount} 張(已完成), 失敗 ${errorCount} 張`);
  console.log('======================================================================');
}

main().catch((err) => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
