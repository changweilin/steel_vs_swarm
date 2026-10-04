// ============ 機體立繪與 3D 比對審查工作台 (dev-only) ============
// 比對各機體 2D 立繪 (PNG/JPG)、3D 即時模型 (Three.js / CharPreview)
// 與 docs/art_gen.md 的規格，支援視覺判定 (通過/更正/重繪)、改善方向編輯與即時寫回 Markdown。
// img 生圖英文模板唯一 settlement 點為 docs/art_gen_img_prompts.md，本台不承載生圖模板。
//
// 邊界原則：
//   ① 住 tools/ 不住 public/ (不進打包 solo 與 release)
//   ② 零 npm 依賴 (使用 node:http, node:fs/promises, node:path)
//   ③ 單一真相縫：直接讀取與更新 docs/art_gen.md（§四之三張規格總表，含 img 錯誤繪製列；§二全機體共通／§三體態分組注意事項另有編輯分頁）
//
// 跑法：
//   node tools/mech_prompt_review.mjs            # 起 dev server (預設 :8625)
//   node tools/mech_prompt_review.mjs --port 9000
//   node tools/mech_prompt_review.mjs --sync-init # 批次寫入初始審查判定至 Markdown

import http from 'node:http';
import fs from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

export const DEFAULT_PORT = 8625;

const UNIFIED_FILE = path.join(ROOT, 'docs', 'art_gen.md');
const FILES = {
  robots: {
    category: 'robots',
    title: '機甲篇（Robots）',
    file: UNIFIED_FILE,
    section: '4.1'
  },
  drones: {
    category: 'drones',
    title: '無人機篇（Drones）',
    file: UNIFIED_FILE,
    section: '4.2'
  },
  morphers: {
    category: 'morphers',
    title: '變形者篇（Morphers）',
    file: UNIFIED_FILE,
    section: '4.3'
  }
};

export const INITIAL_REVIEWS = {
  s06: { verdict: '通過', improvement: '造型與構圖完全符合規範。半人馬四足機甲特徵明確，灰藍/冷銀鋼色配比正確，右手持磁軌長槍、背部防空飛彈點火升空，無人形腿違規。' },
  s07: { verdict: '通過', improvement: '8條觸手分工與金色古文明圖騰符合，去背羽化邊緣乾淨，觸手連續性良好。' },
  s09: { verdict: '通過', improvement: '袋鼠仿生、反曲深蹲腿與粗大平衡長尾完整，雙管霰彈槍噴射火網動作張力十足，腹部育兒袋飛彈槽細節到位。' },
  t01: { verdict: '通過', improvement: '骨白骷髏面甲、牛角與白藍紅國旗肩飾精確，左右手武器歸屬正確（右斧砲／左機槍）。' },
  t02: { verdict: '通過', improvement: '修長身形與生體褐色肌腱束極具識別度，冰晶粉紫藍塗裝優雅，電磁長矛貫地電弧與腰側衝鋒槍均完全符合。' },
  t03: { verdict: '通過', improvement: '低伏大猩猩體態、破障巨砲與推土防盾完美，去背邊緣乾淨，胸腹排氣熱核蒸汽生動。' },
  t04: { verdict: '通過', improvement: '四足低伏獵犬與雪地數碼迷彩符合，背砲為固定導軌無握把，無台座。' },
  t05: { verdict: '通過', improvement: '長頸涉禽鴕鳥反曲雙足構型優異，瓷白與丹頂朱紅比例精確，翼部光子長矛光束動態感強烈，無人形肢體違規。' },
  t10: { verdict: '通過', improvement: '左右手武器與動作歸屬正確，雙耳雷達與雙肩前向發射箱符合。' },
  t12: { verdict: '通過', improvement: '厚重巨兵胸前重裝甲與眉心電磁砲優秀，右手持脈衝長槍歸屬正確。' },
  m02: { verdict: '通過', improvement: '暴龍水平脊椎與猙獰巨顎、喉部電漿磁軌巨砲、玄武岩鱗片圖騰完美呈現，純獸型無人形化，衝擊波與電弧視覺強大。' },
  m06: { verdict: '通過', improvement: '四足劍龍象柱腿與尾刺棒完整，背脊8片五角骨板扇面齊射子母巡飛彈，亞馬遜幾何圖騰細緻，金屬青銅綠色彩飽滿。' },

  s01: { verdict: '通過', improvement: '四具涵道旋翼桶（左右對稱各2具）完整呈現，蜂形流線軀幹、機首機槍與兩側火箭巢齊射震撼，純無人機無肢體。' },
  s02: { verdict: '通過', improvement: '六具涵道旋翼桶（左右對稱各3具）完整呈現，雙層厚鋼板底盤、機腹12.7mm機槍與溫壓火箭齊射震撼，純無人機無肢體。' },
  s04: { verdict: '通過', improvement: '零戰風單翼機、日之丸徽記、機鼻倒三角工兵鏟破甲衝角極具辨識度，電漿與霰彈齊射符合，零手腳純空戰風格。' },
  s05: { verdict: '通過', improvement: 'X構型雙層碳纖維裸架、紫色電容與銅管裸露，雙聯磁軌機槍與巡飛彈蜂群軌跡動態張力極高，純FPV鏤空競速質感。' },
  s08: { verdict: '通過', improvement: '修道院瓷白共軸雙旋翼球體、兩側綠十字醫療吊艙與狙擊針管、機腹防衛機槍完全依循防呆規範，神聖懸浮氛圍佳。' },
  s11: { verdict: '通過', improvement: '大展弦比修長滑翔翼、V型尾翼、精密鐘錶刻度與鈦白金屬質感極佳，手術刀般聚焦光柱精準，零肢體純長航機型。' },
  s12: { verdict: '通過', improvement: '鴨式三角主翼折疊鉸鏈、幾何星圖圖騰、中心星象砲光柱與菱形感測球機頭符合規範，穿雲動態優秀。' },
  t07: { verdict: '通過', improvement: '成功移除背部多餘共軸雙槳。仿生翼龍金屬膜翼、長喙狙擊管完整，無人形肢體，腹下收爪純飛行態標準。' },
  t08: { verdict: '通過', improvement: '蜿蜒東方機械神龍、櫻花粉白塗裝、粉色刀片羽翼與喉部同心圓音波砲表現卓越，四爪緊扣腹下純飛行態；無旋翼（舊版6涵道敘述作廢，以Blender定案為準）。' },
  t09: { verdict: '通過', improvement: '波斯幾何圖騰無尾大三角飛翼、背部蜂巢彈射巡飛彈、機首守衛機槍完全符合匿蹤母機規格，大後掠三角幾何乾淨。' },
  m03: { verdict: '通過', improvement: '雙尾桁、倒U尾翼、偶極天線與機腹探測艙到位，尾槳去背邊緣乾淨。' },
  m04: { verdict: '通過', improvement: '仿生獵鷹獨立羽刃翼、游牧雄鷹圖騰、肩上恰好4枚細長羽毛飛彈精確無誤，純飛行姿態，羽片層次分明。' },

  s03: { verdict: '通過', improvement: '飛鯨浮空艦（70%）腹艙密封無外露象腿、獨角雷光；巨象衝鋒態（30%）雷達耳與牙矛構件互變邏輯嚴謹，羽紋刺青清晰。' },
  s10: { verdict: '通過', improvement: '迅猛龍深蹲低伏獵殺態（70%）折疊羽刃與高頻鐮刀爪、始祖鳥展翅滑翔態（30%）羽片展開對應，互變零件完全一致，赤金亮線分色優異。' },
  t06: { verdict: '通過', improvement: '齊天靈猴人型矯健持如意金箍棒（70%）、筋斗雲無人飛翼（30%）中軸整流罩與空速管構件精準對應，雙翎天線與臉譜線條到位。' },
  t11: { verdict: '通過', improvement: '阿特拉斯三角面盔、托盤肩台與旋翼圓盾（70%）、B-2匿蹤傾轉旋翼巡邏機（30%）互變結構吻合，數碼迷彩與重步兵裝甲質感佳。' },
  m01: { verdict: '通過', improvement: '吸血鬼人型突襲態與超音速三角滑翔翼結構正確，左右手武器歸屬正確（右加特林／左飛彈箱）。' },
  m05: { verdict: '通過', improvement: '大腿後方多餘雙腿已完全移除。狼人深屈雙足直立主型態（70%）無飛膜四肢清晰；上方滑翔飛鼠次型態（30%）四肢X字緊繃滑翔膜，無羽毛，毒紫電光青配色完美。' },
  m07: { verdict: '通過', improvement: '犀角金龜兩態昆蟲結構與墨綠虹彩符合，背部防空砲開火完整，無台座。' },
  m08: { verdict: '通過', improvement: '消音黑豹低伏潛行態（70%）與展翅夜梟前掠狙擊態（30%）肩甲羽翼折疊/展開機制嚴密，全機啞光消光質感到位，零高光反射規範落實。' }
};

/** 掃描統一文件中的全部規格總表（§四：4.1 機甲／4.2 無人機／4.3 變形者） */
function scanSpecTables(lines) {
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('| 機體編號 |')) continue;
    let categoryKey = null;
    for (let h = i - 1; h >= Math.max(0, i - 6); h--) {
      const head = lines[h];
      if (/^###?\s+4\.1|機甲篇規格表/.test(head)) { categoryKey = 'robots'; break; }
      if (/^###?\s+4\.2|無人機篇規格表/.test(head)) { categoryKey = 'drones'; break; }
      if (/^###?\s+4\.3|變形者篇規格表/.test(head)) { categoryKey = 'morphers'; break; }
    }
    tables.push({ headerIdx: i, categoryKey });
  }
  return tables;
}

/** 解析統一文件內指定分類的機體規格表格 */
export async function parseMarkdownFile(categoryKey) {
  const meta = FILES[categoryKey];
  const content = await readFile(meta.file, 'utf8');
  const lines = content.split(/\r?\n/);

  const table = scanSpecTables(lines).find(t => t.categoryKey === categoryKey);
  if (!table) {
    throw new Error(`未在 ${meta.file} 找到 ${meta.title} 規格表格`);
  }
  const headerIdx = table.headerIdx;

  const rawHeaders = lines[headerIdx].split('|').map(s => s.trim()).filter(Boolean);
  const sepLine = lines[headerIdx + 1];

  const hasVerdict = rawHeaders.includes('視覺判定');
  const hasImprovement = rawHeaders.includes('改善方向');

  const rows = [];
  let cur = headerIdx + 2;
  while (cur < lines.length && lines[cur].trim().startsWith('|')) {
    const rawCells = lines[cur].split('|').map(s => s.trim());
    // 去除前後空項目
    if (rawCells.length >= 2 && rawCells[0] === '' && rawCells[rawCells.length - 1] === '') {
      rawCells.shift();
      rawCells.pop();
    }
    const rowObj = {};
    for (let c = 0; c < rawHeaders.length; c++) {
      rowObj[rawHeaders[c]] = rawCells[c] || '';
    }

    // 擷取乾淨 ID (例如 "**s06**" -> "s06")
    const idRaw = rowObj['機體編號'] || '';
    const idMatch = idRaw.match(/[smt]\d{2}/i);
    const id = idMatch ? idMatch[0].toLowerCase() : idRaw;
    rowObj._id = id;
    rowObj._rawLineIdx = cur;
    rowObj._category = categoryKey;

    // 預設或既有判定
    if (!hasVerdict && INITIAL_REVIEWS[id]) {
      rowObj['視覺判定'] = INITIAL_REVIEWS[id].verdict;
    }
    if (!hasImprovement && INITIAL_REVIEWS[id]) {
      rowObj['改善方向'] = INITIAL_REVIEWS[id].improvement;
    }

    rows.push(rowObj);
    cur++;
  }

  return {
    categoryKey,
    title: meta.title,
    filePath: meta.file,
    headerIdx,
    headers: rawHeaders,
    hasVerdict,
    hasImprovement,
    rows,
    lines
  };
}

/** 獲取所有 32 部機體的完整聚合資訊 */
export async function getAllMechsData() {
  const mechsDir = path.join(ROOT, 'public', 'assets', 'mechs');
  const mechAssetFiles = fs.existsSync(mechsDir) ? fs.readdirSync(mechsDir) : [];

  const list = [];
  for (const cat of ['robots', 'drones', 'morphers']) {
    const parsed = await parseMarkdownFile(cat);
    for (const r of parsed.rows) {
      const id = r._id;
      const pngFile = mechAssetFiles.find(f => f.startsWith(`${id}_`) && f.endsWith('.png'));
      const jpgFile = mechAssetFiles.find(f => f.startsWith(`${id}_`) && f.endsWith('.jpg'));

      // 解析代號與角色名 (例如 "瑪雅・柯爾曼<br>「輓歌」")
      const refCode = r['參考代號'] || r['參考代號（禁入Prompt）'] || '';
      const parts = refCode.split(/<br\s*\/?>|\n/i).map(s => s.trim().replace(/^「|」$/g, ''));
      const pilot = parts[0] || '';
      const nickname = parts[1] || parts[0] || '';

      list.push({
        id,
        category: cat,
        categoryName: parsed.title,
        pilot,
        nickname,
        rawHeaders: parsed.headers,
        fields: r,
        verdict: r['視覺判定'] || INITIAL_REVIEWS[id]?.verdict || '',
        improvement: r['改善方向'] || INITIAL_REVIEWS[id]?.improvement || '',
        imagePng: pngFile ? `/public/assets/mechs/${pngFile}` : null,
        imageJpg: jpgFile ? `/public/assets/mechs/${jpgFile}` : null,
        side: id.startsWith('t') ? 'STEEL' : (id.startsWith('s') ? 'SWARM' : 'SPEC')
      });
    }
  }
  return list;
}

/** 寫回 Markdown 檔案（原子且精準更新特定列或加入新欄位） */
export async function updateMechInMarkdown(mechId, updates = {}) {
  let targetCat = null;
  for (const cat of ['robots', 'drones', 'morphers']) {
    const parsed = await parseMarkdownFile(cat);
    if (parsed.rows.some(r => r._id === mechId)) {
      targetCat = cat;
      break;
    }
  }

  if (!targetCat) {
    throw new Error(`找不到機體編號 ${mechId}`);
  }

  const parsed = await parseMarkdownFile(targetCat);
  const lines = [...parsed.lines];
  let headers = [...parsed.headers];

  // 確保標頭有「視覺判定」與「改善方向」
  let needHeaderUpdate = false;
  if (!headers.includes('視覺判定')) {
    headers.push('視覺判定');
    needHeaderUpdate = true;
  }
  if (!headers.includes('改善方向')) {
    headers.push('改善方向');
    needHeaderUpdate = true;
  }

  if (needHeaderUpdate) {
    lines[parsed.headerIdx] = '| ' + headers.join(' | ') + ' |';
    // 更新分隔線
    const seps = headers.map((h, i) => {
      if (h === '機體編號' || h === '參考代號' || h === '參考代號（禁入Prompt）' || h === '避色色幕底色' || h === '避色底色' || h === '視覺判定') {
        return ':---:';
      }
      return ':---';
    });
    lines[parsed.headerIdx + 1] = '| ' + seps.join(' | ') + ' |';
  }

  // 更新各列
  let cur = parsed.headerIdx + 2;
  while (cur < lines.length && lines[cur].trim().startsWith('|')) {
    const rawCells = lines[cur].split('|').map(s => s.trim());
    if (rawCells.length >= 2 && rawCells[0] === '' && rawCells[rawCells.length - 1] === '') {
      rawCells.shift();
      rawCells.pop();
    }

    const rowObj = {};
    for (let c = 0; c < parsed.headers.length; c++) {
      rowObj[parsed.headers[c]] = rawCells[c] || '';
    }

    const idRaw = rowObj['機體編號'] || '';
    const idMatch = idRaw.match(/[smt]\d{2}/i);
    const rowId = idMatch ? idMatch[0].toLowerCase() : idRaw;

    // 若是目標機體，合併 updates
    if (rowId === mechId) {
      Object.assign(rowObj, updates);
      if (updates.verdict) rowObj['視覺判定'] = updates.verdict;
      if (updates.improvement !== undefined) rowObj['改善方向'] = updates.improvement;
    } else {
      // 補齊舊表格缺的初審欄位
      if (!rowObj['視覺判定']) {
        rowObj['視覺判定'] = INITIAL_REVIEWS[rowId]?.verdict || '';
      }
      if (!rowObj['改善方向']) {
        rowObj['改善方向'] = INITIAL_REVIEWS[rowId]?.improvement || '';
      }
    }

    // 重組本行
    const newCells = headers.map(h => {
      const val = (rowObj[h] || '').replace(/\|/g, '&#124;').replace(/\r?\n/g, '<br>');
      return val;
    });
    lines[cur] = '| ' + newCells.join(' | ') + ' |';
    cur++;
  }

  await writeFile(parsed.filePath, lines.join('\n'), 'utf8');
  return { ok: true, file: parsed.filePath, mechId };
}

/** 批次初始化同步所有 Markdown 檔案 */
export async function syncAllInitialReviews() {
  for (const cat of ['robots', 'drones', 'morphers']) {
    const parsed = await parseMarkdownFile(cat);
    for (const r of parsed.rows) {
      if (INITIAL_REVIEWS[r._id]) {
        await updateMechInMarkdown(r._id, INITIAL_REVIEWS[r._id]);
      }
    }
  }
}

// ============ 注意事項表格（§二全機體／§三各類別）讀寫 ============
export const NOTES_TABLES = [
  { key: 'global', title: '全機體共通注意事項', heading: /^##\s+二、/ },
  { key: 'humanoid', title: '人形機體注意事項', heading: /^###\s+3\.1/ },
  { key: 'beast', title: '仿生獸型注意事項', heading: /^###\s+3\.2/ },
  { key: 'flyer', title: '飛行生物注意事項', heading: /^###\s+3\.3/ },
  { key: 'craft', title: '飛行載具注意事項', heading: /^###\s+3\.4/ },
  { key: 'morphmech', title: '變形者注意事項', heading: /^###\s+3\.5/ }
];

/** 解析統一文件內四張注意事項表格（列鍵為「項目」欄） */
export async function parseNotesTables() {
  const content = await readFile(UNIFIED_FILE, 'utf8');
  const lines = content.split(/\r?\n/);
  const out = [];
  for (const def of NOTES_TABLES) {
    const headIdx = lines.findIndex(l => def.heading.test(l));
    if (headIdx === -1) throw new Error(`未在統一文件找到 ${def.title}`);
    let headerIdx = -1;
    for (let i = headIdx + 1; i < lines.length; i++) {
      if (/^##?\s+/.test(lines[i]) && i > headIdx + 1 && !lines[i].startsWith('###')) break;
      if (/^###\s+/.test(lines[i]) && lines[i] !== lines[headIdx] && def.key !== 'global') break;
      if (/\|\s*項目\s*\|/.test(lines[i])) { headerIdx = i; break; }
    }
    if (headerIdx === -1) throw new Error(`未在 ${def.title} 找到注意事項表格`);
    const headers = lines[headerIdx].split('|').map(s => s.trim()).filter(Boolean);
    const rows = [];
    for (let cur = headerIdx + 2; cur < lines.length && lines[cur].trim().startsWith('|'); cur++) {
      const cells = lines[cur].split('|').map(s => s.trim());
      if (cells.length >= 2 && cells[0] === '' && cells[cells.length - 1] === '') { cells.shift(); cells.pop(); }
      const rowObj = {};
      for (let c = 0; c < headers.length; c++) rowObj[headers[c]] = cells[c] || '';
      rows.push({ item: rowObj['項目'] || '', values: rowObj, lineIdx: cur });
    }
    out.push({ key: def.key, title: def.title, headers, rows, headerIdx, ids: (lines[headIdx].match(/[smt]\d{2}/gi) || []).map(s => s.toLowerCase()) });
  }
  return out;
}

/** 更新注意事項表格單一列（values 以欄名為鍵；「項目」欄不可改） */
export async function updateNotesRow(tableKey, item, values = {}) {
  const def = NOTES_TABLES.find(t => t.key === tableKey);
  if (!def) throw new Error(`未知注意事項表格 ${tableKey}`);
  const content = await readFile(UNIFIED_FILE, 'utf8');
  const lines = content.split(/\r?\n/);
  const tables = await parseNotesTables();
  const table = tables.find(t => t.key === tableKey);
  const row = table.rows.find(r => r.item === item);
  if (!row) throw new Error(`在 ${def.title} 找不到項目 ${item}`);
  const merged = { ...row.values, ...values };
  delete merged['項目'];
  const newCells = table.headers.map(h => {
    const raw = h === '項目' ? item : (merged[h] || '');
    return String(raw).replace(/\|/g, '／').replace(/\r?\n/g, '<br>');
  });
  lines[row.lineIdx] = '| ' + newCells.join(' | ') + ' |';
  await writeFile(UNIFIED_FILE, lines.join('\n'), 'utf8');
  return { ok: true, file: UNIFIED_FILE, table: tableKey, item };
}

// ============ 前端 HTML / CSS / JS 模板 ============
function renderHtmlPage(localThree = false) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>機體立繪與 3D 比對審查工作台 · Steel vs Swarm</title>
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<script type="importmap">
{
  "imports": {
    "three": "${localThree ? '/review-deps/three.module.js' : 'https://unpkg.com/three@0.160.0/build/three.module.js'}",
    "three/addons/": "${localThree ? '/review-deps/addons/' : 'https://unpkg.com/three@0.160.0/examples/jsm/'}"
  }
}
</script>
<style>
  :root {
    --bg-dark: #090d16;
    --panel-bg: rgba(16, 24, 40, 0.95);
    --panel-border: rgba(94, 234, 212, 0.18);
    --panel-border-glow: rgba(56, 189, 248, 0.35);
    --text-main: #f1f5f9;
    --text-muted: #94a3b8;
    --accent-cyan: #38bdf8;
    --accent-emerald: #10b981;
    --accent-amber: #f59e0b;
    --accent-rose: #f43f5e;
    --pass-bg: rgba(16, 185, 129, 0.15);
    --pass-border: #10b981;
    --fix-bg: rgba(245, 158, 11, 0.15);
    --fix-border: #f59e0b;
    --redraw-bg: rgba(244, 63, 94, 0.15);
    --redraw-border: #f43f5e;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg-dark);
    color: var(--text-main);
    font-family: 'Noto Sans TC', sans-serif;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header.app-nav {
    height: 52px;
    background: rgba(13, 18, 30, 0.98);
    border-bottom: 1px solid var(--panel-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    z-index: 100;
  }
  .brand-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-title {
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 0.5px;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brand-badge {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid var(--accent-cyan);
    color: var(--accent-cyan);
    font-family: 'JetBrains Mono', monospace;
  }
  .filters-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .btn-filter, .btn-verdict-filter {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-filter:hover, .btn-verdict-filter:hover {
    color: #fff;
    border-color: var(--accent-cyan);
  }
  .btn-filter.active, .btn-verdict-filter.active {
    background: rgba(56, 189, 248, 0.2);
    border-color: var(--accent-cyan);
    color: #fff;
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.25);
  }
  .search-input {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #fff;
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 6px;
    outline: none;
    width: 140px;
  }
  .search-input:focus {
    border-color: var(--accent-cyan);
  }

  /* 主區域三分欄 */
  main.app-workspace {
    flex: 1;
    display: grid;
    grid-template-columns: 240px 1fr 480px;
    overflow: hidden;
  }

  /* 左側機體列表 */
  .mech-roster-pane {
    background: rgba(12, 17, 29, 0.96);
    border-right: 1px solid var(--panel-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .roster-header {
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    justify-content: space-between;
  }
  .roster-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mech-card-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
  }
  .mech-card-item:hover {
    background: rgba(56, 189, 248, 0.08);
    border-color: rgba(56, 189, 248, 0.3);
  }
  .mech-card-item.active {
    background: rgba(56, 189, 248, 0.16);
    border-color: var(--accent-cyan);
    box-shadow: inset 0 0 12px rgba(56, 189, 248, 0.15);
  }
  .card-thumb {
    width: 42px;
    height: 42px;
    border-radius: 6px;
    background: #1a2233;
    object-fit: contain;
    border: 1px solid rgba(255,255,255,0.1);
  }
  .card-info {
    flex: 1;
    overflow: hidden;
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }
  .card-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-cyan);
  }
  .card-name {
    font-size: 13px;
    font-weight: 700;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-sub {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge-verdict {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }
  .badge-verdict.pass { background: var(--pass-bg); border: 1px solid var(--pass-border); color: #34d399; }
  .badge-verdict.fix { background: var(--fix-bg); border: 1px solid var(--fix-border); color: #fbbf24; }
  .badge-verdict.redraw { background: var(--redraw-bg); border: 1px solid var(--redraw-border); color: #fb7185; }
  .badge-verdict.none { background: rgba(148, 163, 184, 0.1); border: 1px solid rgba(148, 163, 184, 0.3); color: #94a3b8; }

  /* 中間視覺比對區：2D vs 3D 雙視圖 */
  .visual-compare-pane {
    display: grid;
    grid-template-columns: 1fr 1fr;
    background: #0f1523;
    overflow: hidden;
    position: relative;
    border-right: 1px solid var(--panel-border);
  }
  .view-subpanel {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    border-right: 1px solid rgba(255,255,255,0.06);
    overflow: hidden;
  }
  .subpanel-bar {
    min-height: 38px;
    flex-shrink: 0;
    flex-wrap: wrap;
    background: rgba(18, 26, 43, 0.85);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    z-index: 10;
  }
  .subpanel-title {
    font-size: 12px;
    font-weight: 700;
    color: #cbd5e1;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .view-viewport {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background-size: 16px 16px;
    background-image: linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  }
  .img-standee {
    max-width: 92%;
    max-height: 92%;
    object-fit: contain;
    filter: drop-shadow(0 15px 25px rgba(0,0,0,0.6));
    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
  }
  .canvas-3d {
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
  }
  .subpanel-controls {
    position: absolute;
    bottom: 12px;
    left: 12px;
    right: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    pointer-events: none;
  }
  .subpanel-controls > * {
    pointer-events: auto;
  }
  .btn-tool-sm {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #e2e8f0;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 5px;
    cursor: pointer;
    backdrop-filter: blur(8px);
    transition: all 0.15s;
  }
  .btn-tool-sm:hover {
    background: var(--accent-cyan);
    color: #000;
  }
  .btn-tool-sm.active {
    background: var(--accent-cyan);
    color: #000;
    font-weight: 700;
  }

  /* 右側規格與寫回工作區 */
  .spec-workbench-pane {
    background: rgba(14, 20, 32, 0.98);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .workbench-header {
    padding: 14px 18px;
    border-bottom: 1px solid var(--panel-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(18, 26, 44, 0.8);
  }
  .workbench-title-box {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .workbench-mech-name {
    font-size: 18px;
    font-weight: 900;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .workbench-mech-sub {
    font-size: 12px;
    color: var(--text-muted);
  }
  .workbench-body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .form-section {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .section-label {
    font-size: 12px;
    font-weight: 800;
    color: var(--accent-cyan);
    display: flex;
    align-items: center;
    gap: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .verdict-btn-group {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
  }
  .btn-verdict-choice {
    padding: 8px;
    font-size: 13px;
    font-weight: 800;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(30, 41, 59, 0.7);
    color: var(--text-muted);
    transition: all 0.15s;
    text-align: center;
  }
  .btn-verdict-choice:hover {
    color: #fff;
  }
  .btn-verdict-choice.active.pass {
    background: var(--pass-bg);
    border-color: var(--pass-border);
    color: #34d399;
    box-shadow: 0 0 12px rgba(16, 185, 129, 0.3);
  }
  .btn-verdict-choice.active.fix {
    background: var(--fix-bg);
    border-color: var(--fix-border);
    color: #fbbf24;
    box-shadow: 0 0 12px rgba(245, 158, 11, 0.3);
  }
  .btn-verdict-choice.active.redraw {
    background: var(--redraw-bg);
    border-color: var(--redraw-border);
    color: #fb7185;
    box-shadow: 0 0 12px rgba(244, 63, 94, 0.3);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-title {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
  }
  .field-input, .field-textarea {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #f8fafc;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    line-height: 1.45;
  }
  .field-input:focus, .field-textarea:focus {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
  }
  .field-textarea {
    min-height: 64px;
    resize: vertical;
  }

  .model-preview-box {
    background: rgba(10, 15, 25, 0.95);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 6px;
    padding: 10px;
    font-size: 12px;
    color: #e2e8f0;
    line-height: 1.6;
    max-height: 160px;
    overflow-y: auto;
    white-space: pre-wrap;
  }
  .workbench-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    border-bottom: 1px solid var(--panel-border);
    background: rgba(18, 26, 44, 0.8);
  }
  .notes-row-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .notes-item-title {
    font-size: 13px;
    font-weight: 800;
    color: #fff;
  }
  .workbench-footer {
    padding: 12px 18px;
    border-top: 1px solid var(--panel-border);
    background: rgba(18, 26, 44, 0.95);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .btn-save-md {
    flex: 1;
    background: linear-gradient(135deg, #0284c7, #0369a1);
    border: 1px solid var(--accent-cyan);
    color: #fff;
    font-size: 13px;
    font-weight: 800;
    padding: 9px 16px;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .btn-save-md:hover {
    background: linear-gradient(135deg, #0369a1, #0284c7);
    box-shadow: 0 4px 16px rgba(56, 189, 248, 0.5);
    transform: translateY(-1px);
  }
  .status-toast {
    font-size: 11px;
    color: var(--accent-emerald);
    font-weight: 700;
  }
</style>
</head>
<body>

<header class="app-nav">
  <div class="brand-group">
    <div class="brand-title">
      <span>戰術審查台</span> // 機體立繪與 3D 比對工作台
    </div>
    <div class="brand-badge" id="statsBadge">載入中...</div>
  </div>

  <div class="filters-group">
    <button class="btn-filter active" data-cat="all">全部 (32)</button>
    <button class="btn-filter" data-cat="robots">機甲 (12)</button>
    <button class="btn-filter" data-cat="drones">無人機 (12)</button>
    <button class="btn-filter" data-cat="morphers">變形者 (8)</button>
    <span style="width:1px;height:18px;background:rgba(255,255,255,0.15);margin:0 4px;"></span>
    <button class="btn-verdict-filter active" data-v="all">全狀態</button>
    <button class="btn-verdict-filter" data-v="通過">✅ 通過</button>
    <button class="btn-verdict-filter" data-v="更正">⚠️ 更正</button>
    <button class="btn-verdict-filter" data-v="重繪">🔄 重繪</button>
    <input type="text" id="searchInput" class="search-input" placeholder="搜尋 ID / 角色名...">
  </div>
</header>

<main class="app-workspace">
  <!-- 左欄：機體清單 -->
  <aside class="mech-roster-pane">
    <div class="roster-header">
      <span>機體清單 (ROSTER)</span>
      <span id="rosterCount">0 / 32</span>
    </div>
    <div class="roster-list" id="rosterList"></div>
  </aside>

  <!-- 中欄：2D 立繪 vs 3D 即時模型雙比對 -->
  <section class="visual-compare-pane">
    <!-- 2D 立繪展示 -->
    <div class="view-subpanel">
      <div class="subpanel-bar">
        <span class="subpanel-title">
          <span>🖼️ 2D Standee 遊戲立繪</span>
          <span style="font-size:10px;color:var(--text-muted);" id="imgFormatLabel">PNG 透明版</span>
        </span>
        <div style="display:flex;gap:4px;">
          <button class="btn-tool-sm active" id="btnImgPng">去背 PNG</button>
          <button class="btn-tool-sm" id="btnImgJpg">色幕 JPG</button>
        </div>
      </div>
      <div class="view-viewport" id="imgViewport">
        <img id="standeeImg" class="img-standee" src="" alt="立繪載入中">
      </div>
      <div class="subpanel-controls">
        <button class="btn-tool-sm" id="btnBgGrid">格線底</button>
        <button class="btn-tool-sm" id="btnBgBlack">純黑底</button>
        <button class="btn-tool-sm" id="btnBgWhite">純白底</button>
        <button class="btn-tool-sm" id="btnResetZoom">重置縮放</button>
      </div>
    </div>

    <!-- 3D 即時模型展示 -->
    <div class="view-subpanel">
      <div class="subpanel-bar">
        <span class="subpanel-title">
          <span>🎮 3D WebGL 模型 (遊戲真品)</span>
          <span id="referenceReviewLabel" style="font-size:10px;color:var(--accent-cyan);display:none;">立繪重建・骨架與護盾動作</span>
          <span id="morphPoseLabel" style="font-size:10px;color:var(--accent-cyan);display:none;">地面型 (Pose 0)</span>
        </span>
        <div style="display:flex;gap:4px;">
          <button class="btn-tool-sm" id="btnActionLight">輕射擊</button>
          <button class="btn-tool-sm" id="btnActionAttack">重射擊</button>
          <button class="btn-tool-sm" id="btnActionSkill">防守招式</button>
          <button class="btn-tool-sm" id="btnActionUlt">攻擊招式</button>
          <button class="btn-tool-sm" id="btnRunMode">🏃 運動：靜止</button>
          <button class="btn-tool-sm" id="btnMorphToggle" style="display:none;color:#38bdf8;">🔄 切換飛行型</button>
        </div>
      </div>
      <div class="view-viewport" style="background:#151c2e;">
        <canvas id="cv3d" class="canvas-3d"></canvas>
      </div>
      <div class="subpanel-controls">
        <button class="btn-tool-sm" id="btn3dReset">重置視角</button>
        <button class="btn-tool-sm" id="btn3dSpin">暫停自轉</button>
        <button class="btn-tool-sm" id="btn3dGrid">參考地網</button>
        <button class="btn-tool-sm" id="btnShieldDeploy" disabled>展開護盾</button>
        <button class="btn-tool-sm" id="btnShieldRetract" disabled>收起護盾</button>
        <button class="btn-tool-sm" id="btnRig" disabled>顯示骨架</button>
      </div>
    </div>
  </section>

  <!-- 右欄：規格比對與編輯寫回 Markdown -->
  <aside class="spec-workbench-pane">
    <div class="workbench-header">
      <div class="workbench-title-box">
        <div class="workbench-mech-name">
          <span id="wbMechId">--</span>
          <span id="wbMechName">選取機體</span>
          <span id="wbVerdictBadge" class="badge-verdict none">待審核</span>
        </div>
        <div class="workbench-mech-sub" id="wbMechSub">規格對齊與 Markdown 寫回</div>
      </div>
    </div>

    <div class="workbench-tabs">
      <button class="btn-tool-sm active" id="tabSpec">機體規格</button>
      <button class="btn-tool-sm" id="tabNotes">注意事項</button>
      <select id="notesTableSel" class="search-input" style="display:none;width:150px;">
        <option value="global">全機體共通</option>
        <option value="humanoid">人形機體</option>
        <option value="beast">仿生獸型</option>
        <option value="flyer">飛行生物</option>
        <option value="craft">飛行載具</option>
        <option value="morphmech">變形者</option>
      </select>
    </div>
    <div class="workbench-body" id="notesPane" style="display:none;"></div>
    <div class="workbench-body" id="workbenchForm">
      <!-- 審核判定按鈕組 -->
      <div class="form-section">
        <div class="section-label">視覺審核判定 (VERDICT)</div>
        <div class="verdict-btn-group">
          <button class="btn-verdict-choice pass" data-val="通過">✅ 通過</button>
          <button class="btn-verdict-choice fix" data-val="更正">⚠️ 更正</button>
          <button class="btn-verdict-choice redraw" data-val="重繪">🔄 重繪</button>
        </div>
      </div>

      <!-- 改善方向與審查筆記 -->
      <div class="form-section">
        <div class="section-label">改善方向與視覺分析筆記</div>
        <div class="field-group">
          <textarea id="fieldImprovement" class="field-textarea" placeholder="輸入視覺審核發現的差異、改進建議或瑕疵說明..."></textarea>
        </div>
      </div>

      <!-- 動態載入的表格各欄位 -->
      <div class="form-section" id="tableFieldsContainer">
        <div class="section-label">機體規格明細</div>
        <!-- 動態渲染欄位輸入框 -->
      </div>

      <!-- 3D建模指引（三段 prompt 皆取自 docs/art_gen.md；生圖模板全文見 docs/art_gen_img_prompts.md） -->
      <div class="form-section">
        <div class="section-label">3D建模指引</div>
        <div class="field-group">
          <div class="field-title">全機體 prompt（§二共用）</div>
          <div class="model-preview-box" id="ppGlobal">--</div>
        </div>
        <div class="field-group">
          <div class="field-title" id="ppCatTitle">對應分類 prompt</div>
          <div class="model-preview-box" id="ppCategory">--</div>
        </div>
        <div class="field-group">
          <div class="field-title">個別機體 prompt（§四）</div>
          <div class="model-preview-box" id="ppMech">--</div>
        </div>
      </div>
    </div>

    <div class="workbench-footer">
      <span class="status-toast" id="saveStatus"></span>
      <button class="btn-save-md" id="btnSaveMd">💾 儲存寫回 Markdown (Ctrl+S)</button>
    </div>
  </aside>
</main>

<script type="module">
let allMechs = [];
let currentMech = null;
let activeCat = 'all';
let activeVerdict = 'all';
let searchQuery = '';
let preview3D = null;
let preview3DError = '';
let imgMode = 'png'; // 'png' or 'jpg'
let autoSpin = true;
let showGrid = true;

// 3D 展示台與名冊載入解耦:3D 失敗(CDN 被擋/WebGL 不可用/模組錯誤)不可拖垮左側清單。
// 動態 import + try/catch,名冊 fetch 不等待 3D。
async function initPreview3D() {
  try {
    const { CharPreview } = await import('/public/js/charPreview.js');
    const cv3d = document.getElementById('cv3d');
    preview3D = new CharPreview(cv3d);
    preview3D.start();
  } catch (err) {
    preview3D = null;
    preview3DError = String(err?.message || err);
    console.error('3D 展示台初始化失敗(名冊不受影響):', err);
  }
}

// 載入機體資料(獨立於 3D;失敗要顯示原因而非空白清單)
async function fetchMechs() {
  const rosterCount = document.getElementById('rosterCount');
  const statsBadge = document.getElementById('statsBadge');
  try {
    const res = await fetch('/api/mechs');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    allMechs = Array.isArray(data) ? data : [];
    if (!allMechs.length) throw new Error('後端回傳 0 筆(檢查 docs/art_gen.md §四規格總表)');
  } catch (err) {
    allMechs = [];
    console.error('機體清單載入失敗:', err);
    if (rosterCount) rosterCount.textContent = '載入失敗';
    if (statsBadge) statsBadge.textContent = '清單載入失敗: ' + String(err?.message || err);
    const container = document.getElementById('rosterList');
    if (container) container.innerHTML = '<div style="padding:12px;font-size:12px;color:#f87171;">載入失敗: '
      + String(err?.message || err) + '</div>';
    return;
  }
  updateStats();
  renderRoster();
  if (allMechs.length > 0) {
    const requested = new URLSearchParams(location.search).get('mech');
    selectMech(allMechs.some(m => m.id === requested) ? requested : allMechs[0].id);
  }
}

function updateStats() {
  const total = allMechs.length;
  const pass = allMechs.filter(m => m.verdict === '通過').length;
  const fix = allMechs.filter(m => m.verdict === '更正').length;
  const redraw = allMechs.filter(m => m.verdict === '重繪').length;
  document.getElementById('statsBadge').textContent = \`通過 \${pass} / 更正 \${fix} / 重繪 \${redraw} (共 \${total})\`;
}

function filterMechs() {
  return allMechs.filter(m => {
    if (activeCat !== 'all' && m.category !== activeCat) return false;
    if (activeVerdict !== 'all' && m.verdict !== activeVerdict) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchId = m.id.toLowerCase().includes(q);
      const matchName = (m.pilot || '').toLowerCase().includes(q);
      const matchNick = (m.nickname || '').toLowerCase().includes(q);
      if (!matchId && !matchName && !matchNick) return false;
    }
    return true;
  });
}

function renderRoster() {
  const filtered = filterMechs();
  document.getElementById('rosterCount').textContent = \`\${filtered.length} / \${allMechs.length}\`;
  const container = document.getElementById('rosterList');
  container.innerHTML = '';
  if (!filtered.length) {
    container.innerHTML = allMechs.length
      ? '<div style="padding:12px;font-size:12px;color:#94a3b8;">篩選條件下無機體(切換分類/狀態/搜尋)</div>'
      : '<div style="padding:12px;font-size:12px;color:#94a3b8;">無機體資料</div>';
    return;
  }

  filtered.forEach(m => {
    const card = document.createElement('div');
    card.className = 'mech-card-item' + (currentMech && currentMech.id === m.id ? ' active' : '');
    card.onclick = () => selectMech(m.id);

    let vClass = 'none';
    if (m.verdict === '通過') vClass = 'pass';
    else if (m.verdict === '更正') vClass = 'fix';
    else if (m.verdict === '重繪') vClass = 'redraw';

    card.innerHTML = \`
      <img class="card-thumb" src="\${m.imagePng || m.imageJpg || ''}" loading="lazy">
      <div class="card-info">
        <div class="card-top">
          <span class="card-id">\${m.id.toUpperCase()}</span>
          <span class="badge-verdict \${vClass}">\${m.verdict || '待審'}</span>
        </div>
        <div class="card-name">\${m.nickname || m.pilot || m.id}</div>
        <div class="card-sub">\${m.pilot}</div>
      </div>
    \`;
    container.appendChild(card);
  });
}

function selectMech(id) {
  const m = allMechs.find(x => x.id === id);
  if (!m) return;
  currentMech = m;

  // 更新卡片選取態
  document.querySelectorAll('.mech-card-item').forEach(el => {
    el.classList.toggle('active', el.querySelector('.card-id').textContent === id.toUpperCase());
  });

  // 更新標題
  document.getElementById('wbMechId').textContent = m.id.toUpperCase();
  document.getElementById('wbMechName').textContent = m.nickname ? \`\${m.pilot}「\${m.nickname}」\` : m.pilot;
  document.getElementById('wbMechSub').textContent = \`\${m.categoryName} · \${m.side} 陣營\`;

  // 審核判定 Badge
  const badge = document.getElementById('wbVerdictBadge');
  badge.textContent = m.verdict || '未判定';
  badge.className = 'badge-verdict ' + (m.verdict === '通過' ? 'pass' : (m.verdict === '更正' ? 'fix' : (m.verdict === '重繪' ? 'redraw' : 'none')));

  // 判定按鈕群
  document.querySelectorAll('.btn-verdict-choice').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === m.verdict);
  });

  // 改善方向
  document.getElementById('fieldImprovement').value = m.improvement || '';

  // 更新 2D 立繪
  updateStandeeImage();

  // 更新 3D 模型
  update3DModel();

  // 渲染動態表格欄位
  renderTableFields();

  // 三段 prompt 預覽（全機體／對應分類／個別機體，皆取自 art_gen.md）
  updatePromptPreview();
}

function updateStandeeImage() {
  if (!currentMech) return;
  const img = document.getElementById('standeeImg');
  const src = imgMode === 'png' ? currentMech.imagePng : currentMech.imageJpg;
  img.src = src || '';
  document.getElementById('imgFormatLabel').textContent = imgMode === 'png' ? 'PNG 去背版' : 'JPG 原始色幕版';
  document.getElementById('btnImgPng').classList.toggle('active', imgMode === 'png');
  document.getElementById('btnImgJpg').classList.toggle('active', imgMode === 'jpg');
}

function update3DModel() {
  if (!currentMech) return;
  if (!preview3D) {
    const morphLabel = document.getElementById('morphPoseLabel');
    if (morphLabel) {
      morphLabel.style.display = 'inline-block';
      morphLabel.textContent = preview3DError ? '3D 不可用(' + preview3DError + ')' : '3D 初始化中…';
    }
    return;
  }
  try {
    preview3D.setChar(currentMech.id, currentMech.side);
    const authored = !!preview3D.unit?.userData.rig?.referenceMotion;
    document.getElementById('referenceReviewLabel').style.display = authored ? '' : 'none';
    for (const id of ['btnShieldDeploy', 'btnShieldRetract', 'btnRig']) document.getElementById(id).disabled = !authored;
    document.getElementById('btnRig').classList.remove('active');
    preview3D.setRigVisible(false);
    preview3D.setShield(false);

    const isMorpher = currentMech.category === 'morphers';
    const btnMorph = document.getElementById('btnMorphToggle');
    const morphLabel = document.getElementById('morphPoseLabel');
    if (isMorpher) {
      btnMorph.style.display = 'inline-block';
      morphLabel.style.display = 'inline-block';
      morphLabel.textContent = preview3D.morphM > 0.5 ? '飛行型 (Pose 1)' : '地面型 (Pose 0)';
      btnMorph.textContent = preview3D.morphM > 0.5 ? '🔄 切換地面型' : '🔄 切換飛行型';
    } else {
      btnMorph.style.display = 'none';
      morphLabel.style.display = 'none';
    }
  } catch (err) {
    console.error('3D 模型載入失敗:', err);
  }
}

function renderTableFields() {
  if (!currentMech) return;
  const container = document.getElementById('tableFieldsContainer');
  container.innerHTML = '<div class="section-label">機體規格明細</div>';

  const ignoreKeys = ['機體編號', '參考代號', '參考代號（禁入Prompt）', '視覺判定', '改善方向', '_id', '_rawLineIdx', '_category'];
  for (const [key, val] of Object.entries(currentMech.fields)) {
    if (ignoreKeys.includes(key)) continue;

    const group = document.createElement('div');
    group.className = 'field-group';

    const title = document.createElement('div');
    title.className = 'field-title';
    title.textContent = key;

    const isLong = val.length > 50 || val.includes('\\n') || val.includes('<br>');
    const input = document.createElement(isLong ? 'textarea' : 'input');
    input.className = isLong ? 'field-textarea' : 'field-input';
    input.value = val.replace(/<br\\s*\\/?>/gi, '\\n');
    input.dataset.key = key;
    input.oninput = (e) => {
      currentMech.fields[key] = e.target.value.replace(/\\n/g, '<br>');
    };

    group.appendChild(title);
    group.appendChild(input);
    container.appendChild(group);
  }
}

async function ensureNotes() {
  if (notesCache.length) return;
  const res = await fetch('/api/notes');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  notesCache = await res.json();
}

function segText(rows) {
  return rows.map(r => '【' + r.item + '】' + String(r.values['內容'] || '').split(/<br[^>]*>/gi).join('\\n')).join('\\n\\n');
}

// 三段 prompt 預覽：全機體（§二）＋對應分類（§三，標題含該機體編號者全取）＋個別機體（§四）
async function updatePromptPreview() {
  if (!currentMech) return;
  const elG = document.getElementById('ppGlobal');
  const elC = document.getElementById('ppCategory');
  const elM = document.getElementById('ppMech');
  const elT = document.getElementById('ppCatTitle');
  try {
    await ensureNotes();
    const g = notesCache.find(t => t.key === 'global');
    elG.textContent = g ? segText(g.rows) : '—';
    const groups = notesCache.filter(t => t.key !== 'global' && (t.ids || []).includes(currentMech.id));
    elT.textContent = groups.length ? '對應分類 prompt（' + groups.map(x => x.title).join('／') + '）' : '對應分類 prompt';
    elC.textContent = groups.length ? groups.map(x => '[' + x.title + ']\\n' + segText(x.rows)).join('\\n\\n') : '—';
    const ignore = ['機體編號', '參考代號', '參考代號（禁入Prompt）', '視覺判定', '改善方向', '_id', '_rawLineIdx', '_category'];
    const parts = [];
    for (const [k, v] of Object.entries(currentMech.fields)) {
      if (ignore.includes(k)) continue;
      parts.push('【' + k + '】' + String(v).split(/<br[^>]*>/gi).join('\\n'));
    }
    elM.textContent = parts.join('\\n\\n') || '—';
  } catch (err) {
    const msg = '載入失敗: ' + String((err && err.message) || err);
    elG.textContent = msg;
    elC.textContent = msg;
    elM.textContent = msg;
  }
}

// 寫回 Markdown 儲存
async function saveCurrentMech() {
  if (!currentMech) return;
  const statusEl = document.getElementById('saveStatus');
  statusEl.textContent = '儲存中...';

  const updates = {
    verdict: currentMech.verdict,
    improvement: document.getElementById('fieldImprovement').value,
    ...currentMech.fields
  };

  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentMech.id,
        updates
      })
    });
    const data = await res.json();
    if (data.ok) {
      currentMech.verdict = updates.verdict;
      currentMech.improvement = updates.improvement;
      statusEl.textContent = '✅ 已成功寫回 Markdown！';
      updateStats();
      renderRoster();
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } else {
      statusEl.textContent = '❌ 儲存失敗: ' + data.error;
    }
  } catch (err) {
    statusEl.textContent = '❌ 網路錯誤: ' + err.message;
  }
}

// 事件綁定
document.querySelectorAll('.btn-verdict-choice').forEach(btn => {
  btn.onclick = () => {
    if (!currentMech) return;
    const v = btn.dataset.val;
    currentMech.verdict = v;
    document.querySelectorAll('.btn-verdict-choice').forEach(b => b.classList.toggle('active', b === btn));
    const badge = document.getElementById('wbVerdictBadge');
    badge.textContent = v;
    badge.className = 'badge-verdict ' + (v === '通過' ? 'pass' : (v === '更正' ? 'fix' : 'redraw'));
  };
});

document.getElementById('btnSaveMd').onclick = saveWorkbench;

// 鍵盤快捷鍵
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveWorkbench();
  }
});

// 分類與狀態切換
document.querySelectorAll('.btn-filter').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeCat = btn.dataset.cat;
    renderRoster();
  };
});

document.querySelectorAll('.btn-verdict-filter').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.btn-verdict-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeVerdict = btn.dataset.v;
    renderRoster();
  };
});

document.getElementById('searchInput').oninput = (e) => {
  searchQuery = e.target.value;
  renderRoster();
};

// 2D 立繪按鈕
document.getElementById('btnImgPng').onclick = () => { imgMode = 'png'; updateStandeeImage(); };
document.getElementById('btnImgJpg').onclick = () => { imgMode = 'jpg'; updateStandeeImage(); };

document.getElementById('btnBgGrid').onclick = () => {
  document.getElementById('imgViewport').style.background = '';
};
document.getElementById('btnBgBlack').onclick = () => {
  document.getElementById('imgViewport').style.background = '#000000';
};
document.getElementById('btnBgWhite').onclick = () => {
  document.getElementById('imgViewport').style.background = '#ffffff';
};
document.getElementById('btnResetZoom').onclick = () => {
  document.getElementById('standeeImg').style.transform = 'scale(1)';
};

// 3D 控制按鈕
document.getElementById('btnMorphToggle').onclick = () => {
  if (!preview3D) return;
  preview3D.toggleMorph();
  const isFlight = preview3D.morphTarget > 0.5;
  document.getElementById('morphPoseLabel').textContent = isFlight ? '飛行型 (Pose 1)' : '地面型 (Pose 0)';
  document.getElementById('btnMorphToggle').textContent = isFlight ? '🔄 切換地面型' : '🔄 切換飛行型';
};

document.getElementById('btnActionAttack').onclick = () => {
  if (!preview3D || !currentMech) return;
  preview3D.play('heavy');
};

for (const [id, action] of [['btnActionLight', 'light'], ['btnActionSkill', 'def'], ['btnActionUlt', 'atk']]) {
  document.getElementById(id).onclick = () => preview3D?.play(action);
}
document.getElementById('btnShieldDeploy').onclick = () => preview3D?.setShield(true);
document.getElementById('btnShieldRetract').onclick = () => preview3D?.setShield(false);
document.getElementById('btnRig').onclick = event => {
  const on = event.currentTarget.classList.toggle('active');
  preview3D?.setRigVisible(on);
};

document.getElementById('btnRunMode').onclick = () => {
  if (!preview3D) return;
  preview3D.cycleRun(1);
  const label = preview3D.runMode === 'idle' ? '靜止' : (preview3D.runMode === 'slow' ? '慢跑' : '衝刺');
  document.getElementById('btnRunMode').textContent = '🏃 運動：' + label;
};

document.getElementById('btn3dSpin').onclick = () => {
  autoSpin = !autoSpin;
  if (preview3D) preview3D.spinScale = autoSpin ? 1 : 0;
  document.getElementById('btn3dSpin').textContent = autoSpin ? '暫停自轉' : '恢復自轉';
};

document.getElementById('btn3dReset').onclick = () => {
  if (preview3D) {
    preview3D.yaw = Math.PI;
    preview3D.pitch = 0.18;
    preview3D.dist = preview3D._fitDist(preview3D.fitR);
    preview3D.viewR = preview3D.wantR = preview3D.fitR;
  }
};

document.getElementById('btn3dGrid').onclick = () => {
  showGrid = !showGrid;
  if (preview3D && preview3D.ground) {
    preview3D.ground.visible = showGrid;
  }
  document.getElementById('btn3dGrid').textContent = showGrid ? '隱藏地網' : '顯示地網';
};

let notesCache = [];
let activePane = 'spec';
function switchPane(name) {
  activePane = name;
  document.getElementById('workbenchForm').style.display = name === 'spec' ? '' : 'none';
  document.getElementById('notesPane').style.display = name === 'notes' ? '' : 'none';
  document.getElementById('tabSpec').classList.toggle('active', name === 'spec');
  document.getElementById('tabNotes').classList.toggle('active', name === 'notes');
  document.getElementById('notesTableSel').style.display = name === 'notes' ? '' : 'none';
  document.getElementById('btnSaveMd').textContent = name === 'notes'
    ? '💾 儲存注意事項寫回 Markdown (Ctrl+S)'
    : '💾 儲存寫回 Markdown (Ctrl+S)';
  if (name === 'notes') loadNotesTable(document.getElementById('notesTableSel').value);
}
async function loadNotesTable(key) {
  const wrap = document.getElementById('notesPane');
  wrap.innerHTML = '<div style="padding:12px;font-size:12px;color:#94a3b8;">載入中...</div>';
  try {
    const res = await fetch('/api/notes');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    notesCache = await res.json();
  } catch (err) {
    wrap.innerHTML = '<div style="padding:12px;font-size:12px;color:#f87171;">載入失敗: ' + String((err && err.message) || err) + '</div>';
    return;
  }
  let table = null;
  for (const t of notesCache) if (t.key === key) table = t;
  if (!table) {
    wrap.innerHTML = '<div style="padding:12px;font-size:12px;color:#f87171;">無此表格: ' + key + '</div>';
    return;
  }
  renderNotesRows(table);
}
function renderNotesRows(table) {
  const wrap = document.getElementById('notesPane');
  wrap.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'section-label';
  head.textContent = table.title + '（共' + table.rows.length + '列）';
  wrap.appendChild(head);
  table.rows.forEach(function(row) {
    const card = document.createElement('div');
    card.className = 'notes-row-card';
    const title = document.createElement('div');
    title.className = 'notes-item-title';
    title.textContent = row.item;
    card.appendChild(title);
    table.headers.forEach(function(h) {
      if (h === '項目') return;
      const g = document.createElement('div');
      g.className = 'field-group';
      const lab = document.createElement('div');
      lab.className = 'field-title';
      lab.textContent = h;
      const ta = document.createElement('textarea');
      ta.className = 'field-textarea';
      ta.value = (row.values[h] || '').replace(/<br\\s*\\/?>/gi, '\\n');
      g.appendChild(lab);
      g.appendChild(ta);
      card.appendChild(g);
    });
    wrap.appendChild(card);
  });
}
async function saveAllNotesFromPane() {
  const statusEl = document.getElementById('saveStatus');
  const key = document.getElementById('notesTableSel').value;
  const table = notesCache.find(t => t.key === key);
  if (!table) {
    statusEl.textContent = '❌ 無此表格: ' + key;
    return;
  }
  const cards = document.querySelectorAll('#notesPane .notes-row-card');
  if (!cards.length) {
    statusEl.textContent = '❌ 注意事項尚未載入';
    return;
  }
  statusEl.textContent = '儲存中...';
  try {
    for (let i = 0; i < cards.length && i < table.rows.length; i++) {
      const values = {};
      const tas = cards[i].querySelectorAll('textarea');
      for (const ta of tas) values[(ta.previousElementSibling || ta.previousSibling).textContent] = ta.value;
      const res = await fetch('/api/save-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: key, item: table.rows[i].item, values: values })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || ('列 ' + table.rows[i].item + ' 寫回失敗'));
    }
    statusEl.textContent = '✅ 注意事項已寫回 Markdown！';
    await loadNotesTable(key);
    setTimeout(function() { statusEl.textContent = ''; }, 3000);
  } catch (err) {
    statusEl.textContent = '❌ 儲存失敗: ' + err.message;
  }
}
function saveWorkbench() {
  if (activePane === 'notes') saveAllNotesFromPane();
  else saveCurrentMech();
}
document.getElementById('tabSpec').onclick = function() { switchPane('spec'); };
document.getElementById('tabNotes').onclick = function() { switchPane('notes'); };
document.getElementById('notesTableSel').onchange = function(e) { loadNotesTable(e.target.value); };

fetchMechs();
initPreview3D().then(() => { if (currentMech) update3DModel(); });
window.__MECH_REVIEW = { get preview() { return preview3D; }, selectMech };
</script>
</body>
</html>`;
}

// ============ HTTP 伺服器 ============
export function serve(port = DEFAULT_PORT, { threeModule = process.env.THREE_MODULE, pageFile = null, extraFiles = {} } = {}) {
  // An optional existing dependency copy keeps the review bench usable offline.
  const localModules = new Map();
  for (const [url, file] of Object.entries(extraFiles)) localModules.set(url, path.resolve(file));
  if (threeModule) {
    localModules.set('/review-deps/three.module.js', path.resolve(threeModule));
    for (const module of ['loaders/GLTFLoader.js', 'utils/SkeletonUtils.js', 'utils/BufferGeometryUtils.js']) {
      localModules.set('/review-deps/addons/' + module,
        path.join(path.dirname(path.resolve(threeModule)), module.replaceAll('/', '_')));
    }
    for (const file of localModules.values()) {
      if (!fs.existsSync(file)) throw new Error(`Missing offline review module: ${file}`);
    }
  }
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.glb': 'model/gltf-binary'
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      const pathname = decodeURIComponent(url.pathname);

      // API: 獲取全部機體
      if (pathname === '/api/mechs') {
        const data = await getAllMechsData();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
        return;
      }

      // API: 寫回 Markdown
      if (pathname === '/api/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const { id, updates } = JSON.parse(body);
            const result = await updateMechInMarkdown(id, updates);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
          }
        });
        return;
      }

      // API: 注意事項表格讀取
      if (pathname === '/api/notes') {
        try {
          const tables = await parseNotesTables();
          const slim = tables.map(t => ({ key: t.key, title: t.title, headers: t.headers, ids: t.ids, rows: t.rows.map(r => ({ item: r.item, values: r.values })) }));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(slim));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
        return;
      }

      // API: 注意事項表格寫回
      if (pathname === '/api/save-notes' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const { table, item, values } = JSON.parse(body);
            const result = await updateNotesRow(table, item, values);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
          }
        });
        return;
      }

      // 首頁
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(pageFile ? await readFile(pageFile, 'utf8') : renderHtmlPage(!!threeModule));
        return;
      }

      // 靜態資源映射
      let targetFile = localModules.get(pathname) || null;
      if (!targetFile && pathname.startsWith('/public/')) {
        targetFile = path.join(ROOT, pathname);
      } else if (pathname === '/favicon.png') {
        targetFile = path.join(ROOT, 'public', 'favicon.png');
      }

      if (targetFile && fs.existsSync(targetFile)) {
        const ext = path.extname(targetFile).toLowerCase();
        const type = mimeTypes[ext] || 'application/octet-stream';
        const data = await readFile(targetFile);
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(err));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[機體審查台] 伺服器啟動完成: http://127.0.0.1:${port}`);
  });

  return server;
}

// 支援命令列執行
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--sync-init')) {
    console.log('[機體審查台] 執行批次初始化同步判定至 Markdown...');
    syncAllInitialReviews().then(() => {
      console.log('[機體審查台] 同步完成！');
      process.exit(0);
    });
  } else {
    const portArgIdx = process.argv.indexOf('--port');
    const port = portArgIdx >= 0 ? parseInt(process.argv[portArgIdx + 1], 10) : DEFAULT_PORT;
    serve(port);
  }
}
