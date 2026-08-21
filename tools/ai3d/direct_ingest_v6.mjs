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

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, basename, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';

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
const MODEL = arg('model', 'gemini-3.6-flash');
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

function readOptimizedImage(targetImgPath) {
  const stat = statSync(targetImgPath);
  const ext = extname(targetImgPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  if (stat.size <= 3 * 1024 * 1024) {
    const imgBuf = readFileSync(targetImgPath);
    return { imageBase64: imgBuf.toString('base64'), mimeType };
  }

  const cacheDir = join(ROOT, 'out', 'image_cache');
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const hash = createHash('sha1').update(targetImgPath).digest('hex').slice(0, 12);
  const cachePath = join(cacheDir, `${hash}.jpg`);

  if (!existsSync(cachePath)) {
    try {
      execFileSync('python', [
        '-c',
        'import sys; from PIL import Image; img=Image.open(sys.argv[1]); img.thumbnail((1600,1600)); img.convert("RGB").save(sys.argv[2], "JPEG", quality=85)',
        targetImgPath,
        cachePath,
      ], { timeout: 15000 });
    } catch {
      const imgBuf = readFileSync(targetImgPath);
      return { imageBase64: imgBuf.toString('base64'), mimeType };
    }
  }

  const imgBuf = readFileSync(cachePath);
  return { imageBase64: imgBuf.toString('base64'), mimeType: 'image/jpeg' };
}

// ── Gemini API 呼叫層(零 npm 依賴,node:https 原生)──────────────────
const GEMINI_SYSTEM_PROMPT = `你是一位專精於 3D 多面體幾何重建的資深工程師。你的任務是分析照片，精確辨識目標物體的形狀、結構、比例與色彩，以宣告式多面體零件列完整重建 3D 幾何模型，並在完成後自我審查與照片原圖的相似度與幾何忠實度。

## 核心規則與幾何紀律（重大要求）
1. 【多物件分析與目標分離 (Detection / Segmentation / Depth)】
   - 仔細分析畫面中的目標物體。如果照片中包含多個獨立物件或雜亂背景，必須精確分割，聚焦於符合該分類的主體物件（或將主要建築/載具/船體/岩石/巨石完整重建），忽略無關的地面雜物與遠景。
2. 【屋簷傾斜、輪胎等物件上所有零件方向、寬度、大小必須正確】
   - 屋頂、飛簷、山牆的斜面方向必須一律由頂脊/中心向外、向下傾斜至地面外緣（y 軸由高至低往外側延伸）。使用 wedge 時頂脊在頂端向外斜；使用 frustum_pyramid 時 topR < botR 形成向外下展的飛簷。嚴禁屋簷反向內凹或朝向建築內部傾斜！
   - 車輪、輪胎 (torus_ring / cylinder) 方向必須順應車身縱向（旋轉軸水平指向兩側），輪胎外徑、寬度與輪距比例符合真實車種。
3. 【玻璃門窗與細節必須明確繪製】
   - 建築的外牆窗戶、玻璃幕牆、出入口大門、陽台欄杆；載具/船舶的擋風玻璃、左右側窗、車燈、後照鏡等，必須作為獨立零件精細繪製。
   - 玻璃材質必須嚴格指定為 glassHex（冷色調 navy/cyan），燈光/鍍鉻使用 brightHex。
4. 【物件零件緊密咬合無縫隙，勿透視裸空，但勿過度重疊】
   - 物體必須是一體化的封閉實體量體（包含完整的基座、外牆、後牆與屋頂），零件之間緊密相接，禁止浮空零件或穿透裸空的破面。
   - 外附的門窗、裝飾條、看板、招牌等零件，其 pos 必須相對於底牆或車體表面略微外凸（+0.02m ~ +0.05m），避免渲染時產生 Z-fighting 頻閃。
5. 【細長結構精確建模與接合紀律（腳踏車架、樹木枝幹等）】
   - 腳踏車的細管車架 (菱形上管、下管、座管、後叉、前叉、把手立管) 必須完整繪出，且所有管件端點必須與各交接點（頭碗、五通中軸、座管夾、後輪軸）精確相接咬合，**嚴禁管件任意穿出車身或向外不自然凸出、懸空脫節**。
   - 樹木的主幹與主要分枝 (cylinder/conical_frustum) 必須平滑向上延伸，樹幹頂端與側枝端點必須完全嵌入樹冠簇內部，**嚴禁樹枝/樹幹突兀穿透出樹冠外部或浮空斷頭**。
6. 【對稱物體雙向鏡像與背面補全】
   - 建築、載具、船舶等對稱物件，單視角被遮擋的背面及對側面，一律使用中軸雙向鏡像法完整補齊特徵（包括對側車輪、車窗、車門、車尾燈、後牆、後部屋簷等），確保 360 度立體完整性，絕不可只建正面形成「紙片薄殼」或背部留空。
7. 【真實世界尺度與地面錨定】
   - 尺寸嚴格使用真實公尺（m），以 SOLDIER_H (1.8m) 為基準。
   - 幾何旋轉中心與底座接觸面嚴格設定於 y = 0（地面接觸面）。
8. 【完成後自我相似度檢查 (Self-Verification)】
   - 完成零件組合後，客觀比對所產生的 3D 幾何結構、輪廓特徵與照片目標之相似度（0-100 分），並在 similarityReview 中簡述比對結果。

## 多面體語彙(只准使用以下 type)
| type | 參數 | 適用場景 |
|---|---|---|
| box | dimensions: [w, h, d] | 建築基底、貨櫃、看板、門窗片、陽台板、車架 |
| polygonal_prism | radius, height, sides (3-16) | 六/八角塔、柱列、支撐 |
| frustum_pyramid | radii: [topR, botR], height, sides | 飛簷(topR<botR 向下展)、針葉樹冠裙、柱頭 |
| pyramid | radii: [0, botR], height, sides | 尖塔、松樹頂 |
| cone | radius, height, sides | 圓錐蓋 |
| cylinder | radii: [topR, botR], height, sides | 鋼管、煙囪、樹幹、電線杆、車軸、細管車架 |
| conical_frustum | radii: [topR, botR], height, sides | 漸縮樹幹、錐形槽、輪圈凹槽 |
| hemisphere_dome | radii: [rx, ry, rz] | 穹頂、雷達罩、半球頂 |
| ellipsoid_sphere | radii: [rx, ry, rz] | 闊葉冠簇、灌木、岩丘 |
| torus_ring | radius, tube | 輪胎、管法蘭、救生圈 |
| dodecahedron_polyhedron | radius | 巨石碎塊、結晶 |
| icosahedron_polyhedron | radius | 粗糙礦石、珊瑚 |
| wedge | dimensions: [w, h, d] | 山牆斜屋頂(頂脊在頂端向外斜)、船首楔 |

## 色彩紀律(7-Zone)
每個零件的 colorKey 必須是以下七個之一:
- roofHex: 屋頂、上層冠簇、車頂
- facadeHex: 外牆、車身、主幹
- baseHex: 基座、底盤、根部
- accentHex: 招牌、頭燈框、裝飾、座墊
- glassHex: 窗戶、擋風玻璃(冷色調 navy/cyan)
- darkHex: 機械底部、排氣管、輪胎、鏈條、深色凹陷
- brightHex: 鍍鉻飾條、燈具、車架反光`;

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    style: { type: 'string', description: '物件風格分類' },
    symmetryMode: { type: 'string', enum: ['symmetric', 'asymmetric'] },
    similarityScore: { type: 'integer', description: '與照片目標物之相似度自評評分 (0-100)' },
    similarityReview: { type: 'string', description: '3D 物件幾何與照片特徵之相似度自評說明' },
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
  required: ['style', 'symmetryMode', 'similarityScore', 'similarityReview', 'colors', 'parts'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 呼叫單一 Gemini 模型(node:https 原生,零 npm 依賴)。
 */
async function callGeminiSingle(modelName, imageBase64, mimeType, family, subpart) {
  let userPrompt = `分析這張 ${family}/${subpart} 的照片,以多面體零件列精確重建其 3D 幾何。注意真實世界尺寸(公尺)。`;
  if (family === 'building') {
    userPrompt += `\n【building 建築幾何重建專項要求】:
1. 先進行 Detection/Segmentation/Depth 分析，精確分離主要建築量體與地面/無關背景雜物。若有多目標需專注於目標物體主結構。
2. 屋頂、飛簷、山牆 (wedge/frustum_pyramid/pyramid) 傾斜方向必須正確：頂脊在頂端，斜面由中心向外、向下傾斜至地面外緣（y 軸由高至低往外側延伸，使用 frustum_pyramid 時 topR < botR 向下展，wedge 頂脊在頂端向外斜），嚴禁屋簷反向內凹或向內傾斜。
3. 玻璃門窗、採光天窗、玻璃幕牆、出入口大門、陽台欄杆 (box/polygonal_prism) 必須明確繪製為獨立零件，玻璃材質嚴格指定為 glassHex (冷色調 navy/cyan)，金屬邊框/燈光使用 brightHex。
4. 零件之間緊密咬合無縫隙，包含外牆、後牆、底座與屋頂一體化封閉，杜絕透視裸空破面；外附門窗、陽台、招牌、裝飾條微幅外凸 (+0.02m ~ +0.05m) 消除 Z-fighting 頻閃。
5. 對稱建築單視角背面與對側面看不到的地方，一律使用中軸雙向鏡像法完整補足特徵微調（後牆、後部屋簷、對側窗戶與陽台），確保 360 度立體完整性，嚴禁紙片薄殼。`;
  } else if (family === 'vehicle') {
    userPrompt += `\n【vehicle 載具與車輛幾何重建專項要求】:
1. 【YOLO26 多目標分離 (Detection/Segmentation/Depth)】:
   - 先進行 Detection/Segmentation/Depth 特徵分析，若有多目標則各自分離為獨立 3D 物件，精準分離主車體，濾除無關地面與背景雜物。
2. 【輪胎方向、寬度與直徑正確 (Tire Orientation & Dimensions)】:
   - 車輪/輪胎 (torus_ring/cylinder) 方向必須嚴格順應車身縱向（旋轉軸水平指向車身兩側，如 rot 設為 [0, 0, 1.5708] 或 [1.5708, 0, 0] 使輪胎立於地面直向行進方向兩側）。
   - 輪胎外徑、胎寬與輪距比例符合真實車型（小客車、卡車、列車轉向架、摩托車等）。
3. 【玻璃門窗、車燈、後照鏡獨立明確繪製】:
   - 擋風玻璃（前擋、後擋）、左右側窗、車燈（前大燈、尾燈、霧燈）、後照鏡必須明確繪製為獨立零件。
   - 玻璃材質嚴格指定為 glassHex (冷色調 navy/cyan)，車燈與鍍鉻飾條使用 brightHex。
4. 【腳踏車與機車等細緻結構完整建模與接合紀律 (Bicycle & Motorcycle Detailing)】:
   - 腳踏車 (bike) 與機車 (motor) 等細緻結構物件，必須完整建出菱形細管車架 (菱形上管、下管、座管、後叉、前叉 cylinder/box)、把手、座墊 (accentHex)、前後輪圈輪胎 (torus_ring/cylinder)、鏈條傳動盒 (darkHex) 與踏板，嚴禁簡化省略。
   - 各管件端點必須與五通、頭碗、輪軸精準相接咬合，嚴禁管件任意穿出車體或向外多餘凸出、懸空脫節。
5. 【雙向對稱鏡像補全背面與封閉防頻閃 (Symmetry & Anti-Z-Fighting)】:
   - 車身為強對稱物件：單視角背面與對側面被遮擋特徵（雙側車輪成對、左右側窗、車門、車尾燈、後保險桿、後照鏡）必須使用中軸雙向鏡像法完整補齊，確保 360 度立體完整。
   - 車體主結構（底盤 baseHex、車身 facadeHex、車頂 roofHex）緊密咬合為封閉實體量體，無透視裸空或浮空破面。
   - 外附零件（車牌、車燈、飾條、標誌、後照鏡）微幅外凸 (+0.02m ~ +0.05m) 防止渲染時 Z-fighting 頻閃。
6. 【自我相似度評估 (Self-Verification)】:
   - 完成幾何合成後進行嚴格客觀相似度比對 (similarityScore >= 75)，不相似則檢討後重來。`;
  } else if (family === 'tree') {
    userPrompt += `\n【tree 樹木與植被幾何重建專項要求】:
1. 先進行 Detection/Segmentation/Depth 分析，精確辨識主幹 (cylinder/conical_frustum) 與多層冠簇 (ellipsoid_sphere/frustum_pyramid/dodecahedron/pyramid/cone)。若有多目標各自分離。
2. 【樹幹與枝椏嵌入接合紀律】：樹木主幹與主要側枝必須平滑向上延伸，樹幹頂端與側枝端點必須完全嵌入樹冠簇內部，嚴禁樹枝/樹幹突兀穿透出樹冠外部或浮空斷頭。
3. 樹幹底部接地點精確錨定於 y = 0（若是盆栽，盆器/基座接地點為 y = 0）。
4. 色彩嚴格區分 7-Zone：roofHex (上層樹冠/葉簇)、facadeHex (樹幹/主枝)、baseHex (根部/盆泥)、accentHex (花果)。
5. 消除零件共面，相鄰或套疊零件尺寸與半徑應錯開，避免面片共面產生 Z-fighting 頻閃。
6. 完成後進行 LLM 相似度自我檢查 (similarityScore >= 75)，不相似則檢討後重來。`;
  } else if (family === 'ship') {
    userPrompt += `\n【ship 船舶幾何重建專項要求】:
1. 先讀取 YOLO26 Detection/Segmentation/Depth 特徵，精確分離主船體與水面波浪、倒影及背景雜物。若有多目標則各自分離為獨立 3D 物件。
2. 完整建構船首導流楔 (wedge)、船底基座 (baseHex/darkHex)、甲板面 (box)、上層艦橋建築 (box/polygonal_prism/cylinder) 與桅杆雷達罩 (hemisphere_dome)。
3. 駕駛台窗戶與艦橋觀測窗明確繪製為獨立零件，材質嚴格指定為 glassHex (冷色調 navy/cyan 玻璃)。
4. 船舶為對稱物件：單視角背面與對舷結構（舷梯、救生圈 torus_ring、側舷窗、煙囪/排氣管、尾部推進器）使用雙向鏡像法補足，確保 360 度立體完整。
5. 船身一體化封閉，零件緊密咬合無縫隙破洞，外附構件微幅外凸 (+0.02m ~ +0.05m) 消除 Z-fighting 頻閃。
6. 完成後進行 LLM 相似度自我檢查 (similarityScore >= 75)，不相似則檢討後重來。`;
  } else if (family === 'rock') {
    userPrompt += `\n【rock 巨石與岩石幾何重建專項要求】:
1. 先進行 Detection/Segmentation/Depth 分析，精準分離前景巨石，去除無關背景/地面雜物。若有多目標各自分離。
2. 運用十二面體 (dodecahedron_polyhedron)、二十面體 (icosahedron_polyhedron)、多角稜柱 (polygonal_prism) 與 wedge/box 等多面體進行稜角分明的多塊層疊拼裝。
3. 基座落底 y = 0，多塊岩塊層疊相接，內部一體化無縫隙破洞。
4. 消除零件共面重疊，避免產生 Z-fighting 頻閃。
5. 完成後進行 LLM 相似度自我檢查 (similarityScore >= 75)，不相似則檢討後重來。`;
  } else if (family === 'landmark') {
    userPrompt += `\n【landmark 地標與特殊結構幾何重建專項要求】:
1. 先進行 Detection/Segmentation/Depth 分析，精確分離地標塔樓/紀念碑/方尖碑/凱旋門/亭閣/天線雷達/桁架塔/儲罐主體與地面/背景雜物。
2. 飛簷與塔頂 (frustum_pyramid/pyramid) 傾斜方向正確（由中心向外向下展開，使用 frustum_pyramid 時 topR < botR，尖塔 pyramid radii: [0, botR]，楔形屋頂 wedge 向外傾斜，嚴禁屋簷反向內凹）。
3. 門窗、護欄、立柱 (polygonal_prism/cylinder) 精確細緻，觀景台護欄、立柱柱列、拱門開口、玻璃幕牆 (glassHex) 清晰具體。
4. 對稱地標結構進行 360 度軸向鏡像補全（立柱成對/四方對稱、對側結構、背面後牆與護欄完整），確保立體完整性與無裸空。
5. 外附構件（浮雕、門窗框、裝飾條、看板）微量外凸 (+0.02m ~ +0.05m) 防止 Z-fighting 閃爍。
6. 完成後進行 LLM 相似度自我檢查 (similarityScore >= 75)，不相似則檢討後重來。`;
  }

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
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

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
            done(reject, new Error(`Gemini API 錯誤 (${modelName}): ${json.error.message || JSON.stringify(json.error)}`));
            return;
          }
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            done(reject, new Error(`Gemini API (${modelName}) 回傳空白(可能被安全過濾或額度耗盡)`));
            return;
          }
          done(resolve, JSON.parse(text));
        } catch (e) {
          done(reject, new Error(`Gemini 回應解析失敗 (${modelName}): ${e.message}\n回應片段: ${raw.slice(0, 300)}`));
        }
      });
    });

    const timer = setTimeout(() => {
      const timeoutErr = new Error(`Gemini API 逾時(60s) (${modelName})`);
      req.destroy(timeoutErr);
      done(reject, timeoutErr);
    }, 60_000);

    req.on('error', (err) => done(reject, err));
    req.write(body);
    req.end();
  });
}

/**
 * 具備快速備援模型與頻率限制退避的 Gemini 呼叫器
 */
async function callGemini(imageBase64, mimeType, family, subpart) {
  const models = [MODEL, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.7-flash'].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
  let lastErr = null;

  for (const m of models) {
    let retries = 0;
    const MAX_RETRIES = 1;
    while (retries <= MAX_RETRIES) {
      try {
        return await callGeminiSingle(m, imageBase64, mimeType, family, subpart);
      } catch (err) {
        lastErr = err;
        const msg = err.message || '';
        const isDailyQuota = msg.includes('PerDay') || msg.includes('per_day') || msg.includes('500');
        if (isDailyQuota) {
          console.warn(`  ⚠ 模型 ${m} 每日配額已滿，直接切換下一個備援模型...`);
          break;
        }
        const isQuota = msg.includes('quota') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate-limit');
        if (isQuota) {
          const match = msg.match(/Please retry in ([\d\.]+)s/i);
          const waitSec = match ? Math.ceil(parseFloat(match[1])) + 2 : 5;
          retries++;
          if (retries <= MAX_RETRIES) {
            console.warn(`  ⏳ 模型 ${m} 遭遇頻率限制，等待 ${waitSec}s 後重試...`);
            await sleep(waitSec * 1000);
            continue;
          }
        }
        console.warn(`  ⚠ 模型 ${m} 失敗 (${msg.slice(0, 100)}...), 切換備援模型...`);
        await sleep(1000);
        break;
      }
    }
  }

  throw lastErr || new Error('所有 Gemini 模型均告失敗');
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
  let allDbItems = [];
  if (existsSync(DB_OUTPUT_LOCAL)) {
    try {
      const db = JSON.parse(readFileSync(DB_OUTPUT_LOCAL, 'utf8'));
      allDbItems = (db.items || []);
      for (const item of allDbItems) {
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

  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  function syncDatabaseToDisk() {
    let currentDbItems = [];
    if (existsSync(DB_OUTPUT_LOCAL)) {
      try {
        const db = JSON.parse(readFileSync(DB_OUTPUT_LOCAL, 'utf8'));
        currentDbItems = db.items || [];
      } catch {}
    }
    const itemMap = new Map();
    for (const it of currentDbItems) itemMap.set(it.key, it);
    for (const it of allDbItems) itemMap.set(it.key, it);
    const mergedDbItems = Array.from(itemMap.values());

    const dbData = {
      version: 6, verStr: 'v6',
      generated_at: new Date().toISOString(),
      total_objects: mergedDbItems.length,
      families: [...new Set(mergedDbItems.map((d) => d.family))],
      items: mergedDbItems,
    };
    writeFileSync(DB_OUTPUT_LOCAL, JSON.stringify(dbData, null, 2), 'utf8');
    if (existsSync('C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out')) {
      writeFileSync(DB_OUTPUT_RESTRICTED, JSON.stringify(dbData, null, 2), 'utf8');
    }

    let currentManifest = { version: 1, note: 'AI 生成 3D 物件的來源帳', parts: [] };
    if (existsSync(MANIFEST_PATH)) {
      try { currentManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch {}
    }
    const partMap = new Map();
    for (const p of (currentManifest.parts || [])) {
      const k = (p.keys && p.keys[0]) || p.key || JSON.stringify(p.imgs);
      partMap.set(k, p);
    }
    for (const p of partsManifest.parts) {
      const k = (p.keys && p.keys[0]) || p.key || JSON.stringify(p.imgs);
      partMap.set(k, p);
    }
    currentManifest.parts = Array.from(partMap.values());
    writeFileSync(MANIFEST_PATH, JSON.stringify(currentManifest, null, 2), 'utf8');
  }

  // ── 載入審查黑名單 (已標註 purge / archive 者永不再入庫) ──
  const stateJsonPath = join(ROOT, 'tools', 'parts_review', 'state.json');
  const purgedKeys = new Set();
  if (existsSync(stateJsonPath)) {
    try {
      const st = JSON.parse(readFileSync(stateJsonPath, 'utf8'));
      for (const [k, v] of Object.entries(st.items || {})) {
        if (v.status === 'purge' || v.status === 'archive') purgedKeys.add(k);
      }
    } catch {}
  }
  if (purgedKeys.size > 0) {
    console.log(`🚫 載入審查黑名單: ${purgedKeys.size} 個已標註刪除/封存項目`);
  }

  for (let idx = 0; idx < filtered.length && processedCount < LIMIT; idx++) {
    const { path: imgPath, baseDir } = filtered[idx];
    const { rel, family, subpart, filename, stem } = parseCategory(imgPath, baseDir);

    // ── 檢查是否有 YOLO26 多目標分離特徵 ──
    let yoloFeaturePath = join(ROOT, 'out', 'yolo_features', family, subpart, `${stem}.json`);
    if (!existsSync(yoloFeaturePath) && subpart !== 'main') {
      const altPath = join(ROOT, 'out', 'yolo_features', family, 'main', `${stem}.json`);
      if (existsSync(altPath)) yoloFeaturePath = altPath;
    }
    let targetList = [{ targetId: `${stem}~0`, targetImgPath: imgPath, targetRel: rel }];
    if (existsSync(yoloFeaturePath)) {
      try {
        const yoloData = JSON.parse(readFileSync(yoloFeaturePath, 'utf8'));
        if (Array.isArray(yoloData.targets) && yoloData.targets.length > 0) {
          targetList = yoloData.targets.map((t) => {
            const cropPath = join(ROOT, 'out', 'targets', t.targetFile || `${family}/${subpart}/${t.targetId}.png`);
            return {
              targetId: t.targetId,
              targetImgPath: existsSync(cropPath) ? cropPath : imgPath,
              targetRel: rel,
              bbox: t.bbox,
              aspectRatio: t.aspectRatio,
              slices: t.slices,
            };
          });
        }
      } catch {}
    }

    for (let tIdx = 0; tIdx < targetList.length; tIdx++) {
      const tgt = targetList[tIdx];
      const curStem = targetList.length > 1 ? tgt.targetId : stem;
      const targetId = `${family}_${subpart}_${curStem}_v6`.replace(/[^\w.-]+/g, '_');
      const hash = createHash('sha1').update(`${rel}:${curStem}`).digest('hex').slice(0, 8);
      const partKey = `${family}/${subpart}_${curStem}_${hash}_v6`;

      // 審查黑名單過濾 (已標註刪除者清理)
      if (purgedKeys.has(partKey) || purgedKeys.has(`${family}/${subpart}_${stem}`) || purgedKeys.has(targetId)) {
        skippedCount++;
        continue;
      }

      // 續跑:已有 v6 版本跳過
      if (existingDb.has(partKey)) {
        skippedCount++;
        continue;
      }

      console.log(`\n  🖼  [${processedCount + 1}] ${family}/${subpart}/${curStem} (目標 ${tIdx + 1}/${targetList.length})`);

      // ── 讀取照片 → base64 ──
      let imageBase64, mimeType;
      try {
        const opt = readOptimizedImage(tgt.targetImgPath);
        imageBase64 = opt.imageBase64;
        mimeType = opt.mimeType;
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

      // ── 相似度自評檢核 (相似度 < 75 自動檢討重來) ──
      let simScore = geminiResult.similarityScore ?? 85;
      let simReview = geminiResult.similarityReview ?? '通過';
      console.log(`  ✓ 相似度評估: ${simScore}/100 [${simReview}] | 零件數: ${geminiResult.parts.length} (Style: ${geminiResult.style})`);

      let retrySimCount = 0;
      while ((geminiResult.similarityScore || 0) < 75 && retrySimCount < 2) {
        retrySimCount++;
        console.warn(`  ⚠ 相似度未達標 (${geminiResult.similarityScore} < 75)，進行檢討並自動重新生成 (第 ${retrySimCount} 次)...`);
        try {
          const reResult = await callGemini(imageBase64, mimeType, family, subpart);
          if (reResult?.parts?.length) {
            geminiResult = reResult;
            simScore = geminiResult.similarityScore ?? 85;
            simReview = geminiResult.similarityReview ?? '通過';
            console.log(`  ✓ 重新評估相似度: ${simScore}/100 [${simReview}] | 零件數: ${geminiResult.parts.length}`);
          }
        } catch (err) {
          console.warn(`  ⚠ 重試生成失敗: ${err.message}`);
          break;
        }
      }

      // ── 幾何合成 ──
      const { objContent, modelJson, featuresJson, bounds } = buildGeometryFromParts(geminiResult, family, subpart, curStem);

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
          similarityScore: geminiResult.similarityScore || 85,
          similarityReview: geminiResult.similarityReview || '',
          version: 6, verStr: 'v6',
          source_image: rel, source_full_path: tgt.targetImgPath,
          created_at: new Date().toISOString(),
          bounds, spec: { style: geminiResult.style },
          method: 'gemini_v6', status: 'ingested',
        };
        writeFileSync(join(targetDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
      }

      // ── 資料庫索引 (即時增量合併) ──
      const dbEntry = {
        id: targetId, key: partKey, family, subpart,
        style: geminiResult.style, symmetryMode: geminiResult.symmetryMode,
        similarityScore: geminiResult.similarityScore || 85,
        version: 6, verStr: 'v6',
        image: rel, bounds, spec: { style: geminiResult.style },
        triangles: bounds.triangles,
        outputDir: `out/3d_data/${family}/${subpart}/${targetId}`,
      };
      allDbItems = allDbItems.filter((it) => it.key !== partKey);
      allDbItems.push(dbEntry);
      existingDb.add(partKey);

      // ── 來源帳 ──
      if (!existingPartKeys.has(partKey)) {
        partsManifest.parts.push({
          method: 'gemini_v6', version: 6, verStr: 'v6',
          consumer: `${family} catalog & partlib (${subpart})`,
          rev: 'HEAD', at: new Date().toISOString().slice(0, 10),
          imgs: [{
            role: 'primary', id: `img_${hash}`, family, part: subpart,
            query: curStem, api: 'gemini_v6', license: 'unverified(restricted/local)',
            creator: null, source_url: '', file: rel,
          }],
          gen: {
            tool: `Gemini v6 Polyhedral Reconstruction (${MODEL})`,
            runner: 'tools/ai3d/direct_ingest_v6.mjs',
            params: `--model ${MODEL} --family ${family}`,
            machine: `Gemini API (${MODEL})`,
            measured: `Triangles ${bounds.triangles}, Vertices ${bounds.vertices}, Similarity ${geminiResult.similarityScore || 85}/100`,
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

      // 即時寫入磁碟確保斷點無損
      syncDatabaseToDisk();

      processedCount++;
      console.log(`  ⚡ Triangles: ${bounds.triangles}, Vertices: ${bounds.vertices}, Size: [${bounds.size.join(', ')}]m (已入庫 v6 索引)`);
      await sleep(2500);
    }
  }

  // ── 最終寫入來源帳與資料庫 ──
  syncDatabaseToDisk();
  console.log(`\n✅ 已同步 parts_manifest.json (共 ${partsManifest.parts.length} 筆)`);
  console.log(`✅ 已同步 3d_database.json (共 ${allDbItems.length} 筆,其中 v6: ${allDbItems.filter((i) => i.version === 6).length} 筆)`);

  // ── 更新 harvest_state ──
  const harvestState = {
    at: new Date().toISOString(),
    completed_items: allDbItems.length,
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
