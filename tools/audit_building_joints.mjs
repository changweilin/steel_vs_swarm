// 全建築密實接合、同層樓高一致性與窗格裁剪離線稽核
// ---------------------------------------------------------------------------
// 驗收標準 (使用者直接指令):
//   1. 密實接合、無裸空無縫隙:
//      - 建築基座/地坪必須確實著地 (最低 Y 座標 <= 0.05m)。
//      - 垂直疊層構件 (基座 -> 各層牆體 -> 腰線/斗拱 -> 屋簷/屋頂 -> 頂部塔剎/天線)
//        層間垂直縫隙 MUST <= 0.05m，杜絕懸空、浮空與裸空斷層。
//      - 附屬構件 (門、窗、陽台、招牌、水塔、冷氣室外機) MUST 緊密貼合宿主牆面/樓板。
//   2. 所有建築物件同一層樓高度調整到相同:
//      - 多層建築之各層樓 (story walls / floor walls / chamber tiers / balustrade tiers)
//        在同棟建築內 MUST 具有相同層高 (|h_i - h_j| < 0.001)。
//      - 同一層樓的不同立面配件 (正面窗、側面窗、陽台 slab、陽台 glass) 垂直基準 Y MUST 對齊。
//   3. 超出高度限制時重新調整玻璃窗大小或進行適當裁剪:
//      - 單層玻璃窗高度 MUST 小於所在樓層之層高 (保留樓板結構厚度)。
//      - wallpanel.js / panelCells 在面板尺寸不足時，MUST 進行裁剪或退回素牆帶 (k < 1 || m < 1)。
// ---------------------------------------------------------------------------
import { RUNTIME_PARTS } from '../public/js/runtimeParts.js';
import { readSrc } from './audit_src.mjs';
import { panelCells } from '../public/js/wallpanel.js';

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    errors.push(message);
    console.error(`  ❌ ${message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. 檢驗執行期 39 款建築模型 (RUNTIME_PARTS.building)
// ---------------------------------------------------------------------------
function auditRuntimeBuildings() {
  console.log('\n--- [1] 稽核 RUNTIME_PARTS.building (39 款型錄建築幾何) ---');
  
  const breakGap = process.argv.includes('--break-gap');
  const breakStorey = process.argv.includes('--break-storey');
  const breakWindow = process.argv.includes('--break-window');

  for (const b of RUNTIME_PARTS.building) {
    const parts = JSON.parse(JSON.stringify(b.parts));
    
    // 反向驗證破壞注入
    if (breakGap && b.key.includes('lighthouse')) {
      const tb = parts.find(p => p.name === 'tower_body');
      if (tb) tb.position[1] += 3.0; // 製造 3m 浮空斷層
    }
    if (breakStorey && b.key.includes('pagoda')) {
      const s1 = parts.find(p => p.name === 'first_story_walls');
      if (s1) s1.dimensions[1] = 5.0; // 破壞層高一致性
    }
    if (breakWindow && b.key.includes('rowhouse')) {
      const win = parts.find(p => p.name === 'lower_center_window_frame');
      if (win) win.dimensions[1] = 8.0; // 超出樓層高度限制
    }

    // A. 基座著地檢查 (Lowest point <= 0.05)
    let lowestY = Infinity;
    for (const p of parts) {
      const y = p.position[1];
      const h = p.height || p.dimensions?.[1] || (p.radii ? p.radii[1] * 2 : (p.radius ? p.radius * 2 : 0));
      const minY = y - h / 2;
      if (minY < lowestY) lowestY = minY;
    }
    assert(lowestY <= 0.05, `[${b.key}] 基座未落底著地 (最低點 Y=${lowestY.toFixed(3)}m > 0.05m)`);

    // B. 禁止 height: 1 預設未初始化構件 (除真實 1m 裝飾物外)
    for (const p of parts) {
      if (p.height === 1 && (p.type === 'cylinder' || p.type === 'conical_frustum') && !/trim|glass|struts|canopy|trunk|finial/i.test(p.name)) {
        assert(false, `[${b.key}] 零件 ${p.name} 存在疑似未給定高度之預設 height:1 圓柱/稜台`);
      }
    }

    // C. 多層建築各層樓高度一致性
    const storyWalls = parts.filter(p => /(story_walls|floor_walls|chamber_tier)/i.test(p.name));
    if (storyWalls.length > 1) {
      const h0 = storyWalls[0].dimensions?.[1] || storyWalls[0].height;
      for (let i = 1; i < storyWalls.length; i++) {
        const hi = storyWalls[i].dimensions?.[1] || storyWalls[i].height;
        assert(Math.abs(hi - h0) < 0.001, `[${b.key}] 各樓層牆體高度不一致: 第1層=${h0}m, 第${i+1}層(${storyWalls[i].name})=${hi}m`);
      }
    }

    // D. 垂直疊層連續性 (Vertical watertightness)
    const structuralParts = parts.filter(p => {
      const dim = p.dimensions || p.radii || [p.radius, p.radius];
      const maxRadius = Math.max(...(Array.isArray(dim) ? dim : [dim]));
      return maxRadius >= 0.8 && !/window|door|balcony_glass|tree|fence|car/i.test(p.name);
    }).map(p => {
      const y = p.position[1];
      const h = p.height || p.dimensions?.[1] || (p.radii ? p.radii[1] * 2 : (p.radius ? p.radius * 2 : 0));
      return { name: p.name, bottom: y - h / 2, top: y + h / 2 };
    }).sort((a, b) => a.bottom - b.bottom);

    for (let i = 0; i < structuralParts.length - 1; i++) {
      const cur = structuralParts[i];
      const next = structuralParts[i + 1];
      if (next.bottom > cur.top + 0.05) {
        const covered = structuralParts.some(p => p.bottom <= cur.top + 0.05 && p.top >= next.bottom - 0.05);
        assert(covered, `[${b.key}] 垂直主體存在裸空斷層: ${cur.name}(top=${cur.top.toFixed(2)}) 至 ${next.name}(bottom=${next.bottom.toFixed(2)}) 存在 ${(next.bottom - cur.top).toFixed(2)}m 縫隙`);
      }
    }

    // E. 窗戶尺寸與樓層邊界檢查
    const windows = parts.filter(p => /window|glass_window/i.test(p.name) && !/balcony_glass/i.test(p.name));
    for (const win of windows) {
      const winH = win.dimensions?.[1] || win.height || 0;
      const winY = win.position[1];
      const winBottom = winY - winH / 2;
      const winTop = winY + winH / 2;

      // 找到包覆此窗戶的結構主體
      const host = structuralParts.find(s => s.bottom <= winBottom + 0.1 && s.top >= winTop - 0.1);
      assert(host !== undefined, `[${b.key}] 窗戶 ${win.name} (Y=[${winBottom.toFixed(2)}, ${winTop.toFixed(2)}]) 超出結構主體垂直邊界或懸空`);
    }
    // F. 高樓階梯退縮層 (Tiers) 與層高整數倍對齊
    const spandrels = parts.filter(p => p.name.startsWith('floor_spandrel_'));
    if (spandrels.length > 1) {
      const sortedSpan = [...spandrels].sort((a, b) => a.position[1] - b.position[1]);
      const floorH = sortedSpan[1].position[1] - sortedSpan[0].position[1];
      const breakTier = process.argv.includes('--break-tier-floor');
      
      const tiers = parts.filter(p => /(tower_tier_\d+|podium_lobby_glass|crown_pyramid)/i.test(p.name));
      for (const tr of tiers) {
        let th = tr.dimensions?.[1] || tr.height || 0;
        if (breakTier && tr.name === 'tower_tier_1') th += 1.7; // 破壞退縮層層高整數倍
        const ratio = th / floorH;
        const diff = Math.abs(ratio - Math.round(ratio));
        assert(diff < 0.02, `[${b.key}] 構件 ${tr.name} 高度 ${th.toFixed(2)}m 非單一基準層高 ${floorH.toFixed(2)}m 之整數倍 (ratio=${ratio.toFixed(2)})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 檢驗功能性地標建築 (biomes.js - LANDMARKS 原文剖析)
// ---------------------------------------------------------------------------
function auditLandmarks() {
  console.log('\n--- [2] 稽核 biomes.js LANDMARKS (13 種原生功能地標幾何定義) ---');
  const src = readSrc('public/js/biomes.js');
  
  const expectedLandmarks = [
    'hospital', 'school', 'station', 'temple', 'church', 'mosque',
    'museum', 'power', 'factory', 'castle', 'lighthouse', 'pagoda', 'stadium'
  ];

  for (const name of expectedLandmarks) {
    const hasDef = src.includes(`${name}: {`) || src.includes(`'${name}': {`) || src.includes(`"${name}": {`);
    assert(hasDef, `biomes.js 包含地標 ${name} 定義`);
  }

  // 驗證 STOREY 常數定義
  const matchStorey = src.match(/const STOREY = ({[\s\S]*?});/);
  assert(matchStorey !== null, 'biomes.js 定義 STOREY 物件');
  
  if (matchStorey) {
    const storeyObj = (new Function(`return ${matchStorey[1]};`))();
    assert(storeyObj.residential === 3.1, 'STOREY 住宅目標層高為 3.1m');
    assert(storeyObj.commercial === 3.9, 'STOREY 商辦目標層高為 3.9m');
    assert(storeyObj.MIN === 2.6 && storeyObj.MAX === 5.4, 'STOREY 層高限制在 [2.6, 5.4]');
  }

  // 驗證道路淨空 isRoadClear
  const breakRoadClear = process.argv.includes('--break-road-clear');
  const hasRoadClear = !breakRoadClear && src.includes('isRoadClear') && src.includes('allRoadSegs');
  assert(hasRoadClear, 'biomes.js 包含 isRoadClear 道路淨空檢驗與 allRoadSegs 道路走廊索引');
}

// ---------------------------------------------------------------------------
// 3. 檢驗戰鬥建築單位 (buildingUnitModels.js 原文剖析)
// ---------------------------------------------------------------------------
function auditBuildingUnits() {
  console.log('\n--- [3] 稽核 buildingUnitModels.js (SWARM / STEEL 戰鬥建築) ---');
  const src = readSrc('public/js/buildingUnitModels.js');
  
  assert(src.includes('BUILDING_UNIT_MODELS'), '包含 BUILDING_UNIT_MODELS 總表');
  assert(src.includes('buildTower'), '包含防禦塔 buildTower 構造');
  assert(src.includes('buildBase'), '包含主堡 buildBase 構造');
  assert(src.includes('SWARM') && src.includes('STEEL'), '包含 SWARM 與 STEEL 兩陣營建築');
}

// ---------------------------------------------------------------------------
// 4. 檢驗立面窗格對齊與樓層限制裁剪 (wallpanel.js)
// ---------------------------------------------------------------------------
function auditStoreyAndWallpanel() {
  console.log('\n--- [4] 稽核 wallpanel.js 窗格裁剪防線 ---');

  const panels = [
    { u0: -5, u1: 5, v0: -5, v1: 5, tu: [1, 0, 0] }, // 10m x 10m 面板
    { u0: -0.2, u1: 0.2, v0: -0.2, v1: 0.2, tu: [1, 0, 0] } // 0.4m x 0.4m 超小面板
  ];

  const cells = panelCells(panels, { cols: 4, rows: 4, hx: 5, hy: 5 });
  assert(cells[0] !== null && cells[0].cells === 16, '10m x 10m 面板成功劃分 16 格窗戶');
  assert(cells[1] === null, '超小面板自動退回素牆帶 (cells=null)，杜絕窗格破面穿出');
}

// ---------------------------------------------------------------------------
// 5. 檢驗地下道出入口移至道路旁 (pedestrian.js)
// ---------------------------------------------------------------------------
async function auditPedestrianEntrancesBesideRoad() {
  console.log('\n--- [5] 稽核 pedestrian.js 地下道出入口移至路旁防線 ---');
  const { planPedestrianNetwork } = await import('../public/js/pedestrian.js');
  
  const breakVerge = process.argv.includes('--break-entrance-verge');
  const p = (x, z) => ({ lat: z, lon: x });
  const toXZ = (q) => [q.lon ?? q.lng, q.lat];

  // 構造一條主要道路與一條與之交會的地下人行通道
  const road = { tags: { highway: 'primary' }, geometry: [p(-50, 0), p(50, 0)] };
  const underpass = { tags: { highway: 'footway', tunnel: 'yes', layer: '-1' }, geometry: [p(0, 0), p(0, 40)] };

  const res = planPedestrianNetwork({ roads: [road, underpass], toXZ });
  assert(res.entrances.length >= 1, '地下道端點正確產出出入口');

  for (const ent of res.entrances) {
    let ey = ent.z;
    if (breakVerge) ey = 0; // 故意壓在道路中心線
    const distToRoad = Math.abs(ey); // 道路在 z=0
    assert(distToRoad >= 4.5 + 3.2, `出入口 (x=${ent.x.toFixed(2)}, z=${ent.z.toFixed(2)}) 位於路旁 (距離中心線 ${distToRoad.toFixed(2)}m >= 7.7m)`);
    // 驗證正面朝向迎向道路或順路側，絕不背對道路 (道路在 z=0, ent.z > 0 時背對為 cos(ry) > 0.5)
    const forwardZ = Math.cos(ent.ry);
    const roadDirZ = -Math.sign(ent.z || 1); // 迎向道路方向
    assert(forwardZ * roadDirZ >= -0.01, `出入口 (ry=${ent.ry.toFixed(3)}) 正對或側對道路，絕不背對 (forwardZ*roadDirZ=${(forwardZ * roadDirZ).toFixed(3)} >= 0)`);
    assert(ent.archetype && typeof ent.archetype === 'string', `出入口已分派 PED_ARCHETYPES 樣式 (${ent.archetype})`);
  }
}

// ---------------------------------------------------------------------------
// 執行所有稽核子系統
// ---------------------------------------------------------------------------
console.log('================================================================');
console.log('  全建築密實接合、同層樓高一致性與窗格裁剪離線稽核');
console.log('================================================================');

auditRuntimeBuildings();
auditLandmarks();
auditBuildingUnits();
auditStoreyAndWallpanel();
await auditPedestrianEntrancesBesideRoad();

console.log('\n================================================================');
console.log(`稽核結果: ${passed} 項通過, ${failed} 項失敗`);
console.log('================================================================\n');

if (failed > 0) {
  process.exitCode = 1;
}
