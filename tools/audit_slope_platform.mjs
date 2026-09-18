// ============ 斜坡平台開挖、擋土牆與支撐柱稽核 (執行 biomes.js 與 terrain.js 原文) ============
// 起因：在斜坡地形上，主堡與砲塔的基座平台會有一部分被地形埋住穿模，另一部分懸空。
// 修法：
//   1. 地形開挖 (carvePlatforms)：將平台 OBB 範圍內高於台底的地形下切整平，避免掩埋。
//   2. 擋土牆 (Retaining Walls)：在開挖切坡處（原地形高於台面）沿邊緣立擋土牆並上壓頂。
//   3. 支撐柱 (Support Pillars)：在懸空部位（台底距地面 > 0.5m）追加基礎支撐柱與碰撞柱。
//
// 跑法：node tools/audit_slope_platform.mjs
// 反向驗證：node tools/audit_slope_platform.mjs --break-wall
import { readSrc } from './audit_src.mjs';

const bioSrc = readSrc('public', 'js', 'biomes.js');
const terrainSrc = readSrc('public', 'js', 'terrain.js');
const BREAK_WALL = process.argv.includes('--break-wall');

function mockThree() {
  class MockMesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = {
        x: 0, y: 0, z: 0,
        set(x, y, z) { this.x = x; this.y = y; this.z = z; },
      };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
  }
  class MockBoxGeometry {
    constructor(w, h, d) {
      this.type = 'BoxGeometry'; this.w = w; this.h = h; this.d = d;
      this.attributes = {
        position: {
          count: 8,
          getY: (i) => (i < 4 ? -h * 0.5 : h * 0.5),
          getX: () => 0,
          getZ: () => 0,
          setX: () => {},
          setZ: () => {},
        },
      };
    }
  }
  class MockCylinderGeometry {
    constructor(rt, rb, h, seg) { this.type = 'CylinderGeometry'; this.rt = rt; this.rb = rb; this.h = h; this.seg = seg; }
  }
  class MockPlaneGeometry {
    constructor(w, h) { this.type = 'PlaneGeometry'; this.w = w; this.h = h; }
  }
  return {
    DoubleSide: 2,
    Mesh: MockMesh,
    BoxGeometry: MockBoxGeometry,
    CylinderGeometry: MockCylinderGeometry,
    PlaneGeometry: MockPlaneGeometry,
  };
}

// 抽取 buildPlatformSlopeFeatures 原文
function loadSlopeFeatures(mutate = (s) => s) {
  const p0 = bioSrc.indexOf('function retainingWallTex()');
  const p1 = bioSrc.indexOf('// 陸地砲塔基座與標線', p0);
  if (p0 < 0 || p1 <= p0) throw new Error('biomes.js 斜坡功能切片標記找不到');
  let body = bioSrc.slice(p0, p1);
  if (BREAK_WALL) {
    body = body.replace('origY > dy + 0.15', 'origY > dy + 999.0');
  }
  body = mutate(body);
  const fn = new Function('THREE', 'envMat', 'TOWER_BASE_R', 'BASE_PAD_SUPPORT_F', '_platformTexCache',
    `${body}\nreturn { buildPlatformSlopeFeatures, retainingWallTex };`
  );
  return fn(mockThree(), () => ({}), 6.76, 0.72, new Map());
}

// 抽取 buildBaseWaterPads 原文
function loadBasePads() {
  const p0 = bioSrc.indexOf('const BASE_PAD_R =');
  const p1 = bioSrc.indexOf('export function makeTunnelIndex', p0);
  if (p0 < 0 || p1 <= p0) throw new Error('biomes.js 主堡承台切片標記找不到');
  const body = bioSrc.slice(p0, p1);
  const fn = new Function('THREE', 'envMat', 'terrainEnvCode', 'makeDeckIndex', 'baseMarkingTex', 'GAME', 'WATER', 'TOWER_PAD_R', 'TOWER_PAD_T', 'TOWER_BASE_R', 'buildPlatformSlopeFeatures',
    `${body}\nreturn { buildBaseWaterPads, BASE_PAD_R, BASE_PAD_T };`
  );
  return fn(mockThree(), () => ({}), () => 0, () => () => null, () => ({}),
    { HERO_HEAL_R: 12, HERO_SPAWN_OFF: 6, HERO_SPAWN_SIDE: 4 },
    { SWAMP_BAND: 2.2, GRID_M: 8 }, 4.5, 1.0, 6.76, () => {}
  );
}

// 抽取 carvePlatforms 原文邏輯驗證
function loadCarvePlatforms() {
  const p0 = terrainSrc.indexOf('function carvePlatforms(platforms) {');
  const p1 = terrainSrc.indexOf('await onProgress?.(1', p0);
  if (p0 < 0 || p1 <= p0) throw new Error('terrain.js carvePlatforms 切片標記找不到');
  const body = terrainSrc.slice(p0, p1);
  const fn = new Function('N', 'minX', 'maxX', 'minZ', 'maxZ', 'heights', 'syncHeights',
    `${body}\nreturn { carvePlatforms };`
  );
  return fn;
}

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

console.log('Ⅰ 地形切方開挖稽核 (carvePlatforms)');
{
  const N = 10;
  const minX = -45, maxX = 45, minZ = -45, maxZ = 45;
  // 構造一個朝 +x 傾斜的斜坡: y = 10 + x * 0.2
  const heights = new Float32Array(N * N);
  const DXg = (maxX - minX) / (N - 1), DZg = (maxZ - minZ) / (N - 1);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = minX + DXg * j;
      heights[i * N + j] = 10 + x * 0.2;
    }
  }

  let syncCount = 0;
  const factory = loadCarvePlatforms();
  const { carvePlatforms } = factory(N, minX, maxX, minZ, maxZ, heights, () => { syncCount++; });

  // 在 (0, 0) 放置一個 10x10 平台，高度 dy = 10 (落坐在兵線高度，切方整平至 10.0)
  // +x 側 (x > 0) 原地形高達 10 ~ 19，應該被開挖至 10.0
  // -x 側遠處 (x < -10) 應該完全保持不變
  const origFarLeft = heights[5 * N + 0]; // x = -45
  carvePlatforms([{
    cx: 0, cz: 0, hw: 5, hd: 5, ry: 0, y: 10, margin: 0.8, padT: 1.0,
  }]);

  ok(syncCount === 1, `有開挖到地形節點時觸發 syncHeights: ${syncCount}`);
  // 檢查中心點與右側開挖
  const kCenter = 5 * N + 5; // x = 5
  ok(heights[kCenter] <= 9.75001, `平台開挖底面沉降至 9.75m (消除與 10.0m 承台共面 Z-fighting): ${heights[kCenter]}`);
  ok(heights[5 * N + 0] === origFarLeft, `平台範圍外遠處地形保持不變: ${heights[5 * N + 0]}`);
}

console.log('Ⅱ 擋土牆生成稽核 (buildPlatformSlopeFeatures - Retaining Walls)');
{
  const { buildPlatformSlopeFeatures } = loadSlopeFeatures();
  const group = { children: [], add(m) { this.children.push(m); } };
  const cols = [];

  // 模擬斜坡地形: x 軸方向斜坡，平台中心 (0, 0), dy = 10, padT = 1.0
  // +x 側 (x > 0) 原地形高 = 14 (高於 dy = 10，屬於挖方切坡)
  // -x 側 (x < 0) 原地形高 = 6 (低於 dy = 10，屬於懸空)
  const terrain = {
    natureAt: (x, z) => 10 + x * 0.5,
    heightAt: (x, z) => 10 + x * 0.5,
  };

  buildPlatformSlopeFeatures({
    group, terrain, cols,
    cx: 0, cz: 0, hw: 6, hd: 6, ry: 0, dy: 10, padT: 1.0, padKind: 'tower',
  });

  // 擋土牆應該在 +x 側邊緣生成，而 -x 側不應生成擋土牆
  const wallBoxes = group.children.filter((c) => c.geometry?.type === 'BoxGeometry');
  ok(wallBoxes.length > 0, `切坡側成功建立擋土牆區段: ${wallBoxes.length}`);

  // 檢查所有擋土牆區段均位於高地側 (x > 0)
  const allOnHighSide = wallBoxes.every((c) => c.position.x > 0);
  ok(allOnHighSide, '擋土牆僅在地形高於平台之切方側生成');

  // 檢查擋土牆頂面高過切坡開挖地形
  const caps = wallBoxes.filter((c) => c.geometry.h === 0.25);
  ok(caps.length > 0, `擋土牆頂部具備壓頂防護 (Coping Cap): ${caps.length}`);
  const maxCapY = Math.max(...caps.map((c) => c.position.y));
  ok(maxCapY > 10 + 1.2, `擋土牆壓頂高過平台面至少 1.2m: ${maxCapY.toFixed(2)}m`);

  // 檢查牆底深入地表與台底（消滅懸空與漏底縫隙）
  const wallBodies = wallBoxes.filter((c) => c.geometry.h > 0.25);
  const allEmbedded = wallBodies.every((c) => c.position.y - c.geometry.h * 0.5 < 9.0);
  ok(allEmbedded, '擋土牆底部深入地表與台底，消滅懸空與漏底縫隙');

  // 檢查擋土牆本體具備斜坡開挖仰斜率 (Sloped Batter)
  const slopedWalls = wallBodies.filter((c) => c.geometry?.leanX > 0);
  ok(slopedWalls.length > 0, `擋土牆本體具備斜坡開挖仰斜率 (Sloped Batter): ${slopedWalls.length}`);

  // 檢查切坡相鄰邊轉角柱 (Corner Pillars) 閉合
  const cornerPosts = wallBodies.filter((c) => Math.abs(c.geometry.w - c.geometry.d) < 1e-4);
  ok(cornerPosts.length > 0, `切坡轉角處建立轉角柱閉合四角空隙: ${cornerPosts.length}`);

  // 檢查碰撞柱是否有登記
  ok(cols.some((c) => c.x > 0 && c.h > 1.0), '擋土牆在切坡側登記阻擋碰撞體');
}

console.log('Ⅲ 支撐柱生成稽核 (buildPlatformSlopeFeatures - Support Piers)');
{
  const { buildPlatformSlopeFeatures } = loadSlopeFeatures();
  const group = { children: [], add(m) { this.children.push(m); } };
  const cols = [];

  // +x 側平整或切坡，-x 側深谷懸空 (heightAt = 5, botY = 9 -> gap = 4.0m)
  const terrain = {
    natureAt: (x, z) => (x < -1 ? 5 : 9.5),
    heightAt: (x, z) => (x < -1 ? 5 : 9.5),
  };

  buildPlatformSlopeFeatures({
    group, terrain, cols,
    cx: 0, cz: 0, hw: 8, hd: 8, ry: 0, dy: 10, padT: 1.0, padKind: 'tower',
  });

  const piers = group.children.filter((c) => c.geometry?.type === 'CylinderGeometry');
  ok(piers.length > 0, `懸空部位成功生成立體圓柱墩座: ${piers.length}`);

  // 檢查柱體底部深入地面
  const deepEnough = piers.every((p) => p.position.y - p.geometry.h * 0.5 < 5.0);
  ok(deepEnough, '支撐柱底部深入地面 0.6m 確保無漏底破綻');

  // 檢查 cols 是否有對應支撐柱碰撞
  const pierCols = cols.filter((c) => c.r > 1.0);
  ok(pierCols.length === piers.length, `支撐柱全數納入物理碰撞柱 (cols): ${pierCols.length}/${piers.length}`);
}

console.log('Ⅳ 平地環境防劣化稽核 (Zero overhead on flat terrain)');
{
  const { buildPlatformSlopeFeatures } = loadSlopeFeatures();
  const group = { children: [], add(m) { this.children.push(m); } };
  const cols = [];

  // 完全平坦地面 (height = 9.0, dy = 10, padT = 1.0 -> botY = 9.0, gap = 0)
  const flatTerrain = {
    natureAt: () => 9.0,
    heightAt: () => 9.0,
  };

  buildPlatformSlopeFeatures({
    group, terrain: flatTerrain, cols,
    cx: 0, cz: 0, hw: 8, hd: 8, ry: 0, dy: 10, padT: 1.0, padKind: 'tower',
  });

  ok(group.children.length === 0, `平地環境不生成多餘擋土牆與支撐柱: count = ${group.children.length}`);
  ok(cols.length === 0, `平地環境不額外增加障礙碰撞體: cols = ${cols.length}`);
}

console.log('Ⅴ 陸地主堡基礎承台與標線稽核 (Land Base Foundation Slab & Markings)');
{
  const { buildBaseWaterPads, BASE_PAD_T } = loadBasePads();
  const group = { children: [], add(m) { this.children.push(m); } };
  const basesW = [{ side: 'STEEL', x: 0, z: 0 }];
  const terrain = { heightAt: () => 10.0, waterY: null, minX: -100, minZ: -100 };
  const decks = [], cols = [];

  const pads = buildBaseWaterPads(group, basesW, terrain, decks, cols);
  ok(pads.length === 1, `陸地主堡成功登錄 pads: ${pads.length}`);
  const slabs = group.children.filter((c) => c.geometry?.type === 'BoxGeometry' && c.geometry.h === BASE_PAD_T);
  ok(slabs.length === 1, `陸地主堡成功建立混凝土基礎承台 (slab): ${slabs.length}`);
  ok(decks.length === 1, `陸地主堡成功建立站立面 (deck): ${decks.length}`);
  const markings = group.children.filter((c) => c.geometry?.type === 'PlaneGeometry');
  ok(markings.length === 1, `陸地主堡表面成功渲染軍事基地標線: ${markings.length}`);
}

console.log(`\n${fail === 0 ? '✅ 全綠' : '❌ 有紅字'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
