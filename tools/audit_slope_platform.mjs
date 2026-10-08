// ============ Slope platform cut, retaining walls and support pillars audit (executes biomes.js and terrain.js source) ============
// Cause: on sloped terrain, base and turret foundation platforms are partly buried by terrain and partly left floating.
// Fix:
//   1. Terrain cut (carvePlatforms): lower terrain above the platform base inside the platform OBB to a flat level to avoid burial.
//   2. Retaining Walls: stand walls along the cut edge where original terrain sits above the deck, plus cap on top.
//   3. Support Pillars: add foundation pillars plus collision posts under floating spans where the gap exceeds 0.5m.
//
// Run via node tools/audit_slope_platform.mjs
// Reverse check via node tools/audit_slope_platform.mjs --break-wall
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

// Extract genuine buildPlatformSlopeFeatures source text
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

// Extract genuine buildBaseWaterPads source text
function loadBasePads() {
  const p0 = bioSrc.indexOf('const BASE_PAD_R =');
  const p1 = bioSrc.indexOf('export function makeTunnelIndex', p0);
  if (p0 < 0 || p1 <= p0) throw new Error('biomes.js 主堡承台切片標記找不到');
  const body = bioSrc.slice(p0, p1);
  const fn = new Function('THREE', 'envMat', 'terrainEnvCode', 'makeDeckIndex', 'baseMarkingTex', 'GAME', 'WATER', 'TOWER_PAD_R', 'TOWER_PAD_T', 'TOWER_BASE_R', 'buildPlatformSlopeFeatures', 'roadStructureGeo',
    `${body}\nreturn { buildBaseWaterPads, BASE_PAD_R, BASE_PAD_T };`
  );
  return fn(mockThree(), () => ({}), () => 0, () => () => null, () => ({}),
    { HERO_HEAL_R: 12, HERO_SPAWN_OFF: 6, HERO_SPAWN_SIDE: 4 },
    { SWAMP_BAND: 2.2, GRID_M: 8 }, 4.5, 1.0, 6.76, () => {},
    (_kind, w, h, d) => new (mockThree().BoxGeometry)(w, h, d)
  );
}

// Extract carvePlatforms source text for logic verification
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
  // Build a slope tilting toward +x: y = 10 + x * 0.2
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

  // Place one 10x10 platform at (0, 0) with height dy = 10, seated at lane height and cut flat to 10.0
  // +x side (x > 0) original terrain runs 10 to 19 and must be cut to 10.0
  // Far -x side (x < -10) must stay fully unchanged
  const origFarLeft = heights[5 * N + 0]; // x = -45
  carvePlatforms([{
    cx: 0, cz: 0, hw: 5, hd: 5, ry: 0, y: 10, margin: 0.8, padT: 1.0,
  }]);

  ok(syncCount === 1, `有開挖到地形節點時觸發 syncHeights: ${syncCount}`);
  // Check center point and right-side cut
  const kCenter = 5 * N + 5; // x = 5
  ok(heights[kCenter] <= 9.75001, `平台開挖底面沉降至 9.75m (消除與 10.0m 承台共面 Z-fighting): ${heights[kCenter]}`);
  ok(heights[5 * N + 0] === origFarLeft, `平台範圍外遠處地形保持不變: ${heights[5 * N + 0]}`);
}

console.log('Ⅱ 擋土牆生成稽核 (buildPlatformSlopeFeatures - Retaining Walls)');
{
  const { buildPlatformSlopeFeatures } = loadSlopeFeatures();
  const group = { children: [], add(m) { this.children.push(m); } };
  const cols = [];

  // Simulate sloped terrain along x, platform center (0, 0), dy = 10, padT = 1.0
  // +x side (x > 0) original height 14 sits above dy = 10, so it is a cut slope
  // -x side (x < 0) original height 6 sits below dy = 10, so it floats
  const terrain = {
    natureAt: (x, z) => 10 + x * 0.5,
    heightAt: (x, z) => 10 + x * 0.5,
  };

  buildPlatformSlopeFeatures({
    group, terrain, cols,
    cx: 0, cz: 0, hw: 6, hd: 6, ry: 0, dy: 10, padT: 1.0, padKind: 'tower',
  });

  // Retaining walls must appear on the +x edge only, never on the -x side
  const wallBoxes = group.children.filter((c) => c.geometry?.type === 'BoxGeometry');
  ok(wallBoxes.length > 0, `切坡側成功建立擋土牆區段: ${wallBoxes.length}`);

  // Check every wall segment sits on the high-ground side (x > 0)
  const allOnHighSide = wallBoxes.every((c) => c.position.x > 0);
  ok(allOnHighSide, '擋土牆僅在地形高於平台之切方側生成');

  // Check wall tops rise above the cut-slope terrain
  const caps = wallBoxes.filter((c) => c.geometry.h === 0.25);
  ok(caps.length > 0, `擋土牆頂部具備壓頂防護 (Coping Cap): ${caps.length}`);
  const maxCapY = Math.max(...caps.map((c) => c.position.y));
  ok(maxCapY > 10 + 1.2, `擋土牆壓頂高過平台面至少 1.2m: ${maxCapY.toFixed(2)}m`);

  // Check wall bases sink into ground and deck base, closing float and bottom gaps
  const wallBodies = wallBoxes.filter((c) => c.geometry.h > 0.25);
  const allEmbedded = wallBodies.every((c) => c.position.y - c.geometry.h * 0.5 < 9.0);
  ok(allEmbedded, '擋土牆底部深入地表與台底，消滅懸空與漏底縫隙');

  // Check wall bodies carry a sloped batter for the cut
  const slopedWalls = wallBodies.filter((c) => c.geometry?.leanX > 0);
  ok(slopedWalls.length > 0, `擋土牆本體具備斜坡開挖仰斜率 (Sloped Batter): ${slopedWalls.length}`);

  // Check corner pillars close the gaps between adjacent cut edges
  const cornerPosts = wallBodies.filter((c) => Math.abs(c.geometry.w - c.geometry.d) < 1e-4);
  ok(cornerPosts.length > 0, `切坡轉角處建立轉角柱閉合四角空隙: ${cornerPosts.length}`);

  // Check that collision posts are registered
  ok(cols.some((c) => c.x > 0 && c.h > 1.0), '擋土牆在切坡側登記阻擋碰撞體');
}

console.log('Ⅲ 支撐柱生成稽核 (buildPlatformSlopeFeatures - Support Piers)');
{
  const { buildPlatformSlopeFeatures } = loadSlopeFeatures();
  const group = { children: [], add(m) { this.children.push(m); } };
  const cols = [];

  // +x side stays flat or cut, -x side floats over a deep gap (heightAt = 5, botY = 9, gap = 4.0m)
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

  // Check pillar bases sink into the ground
  const deepEnough = piers.every((p) => p.position.y - p.geometry.h * 0.5 < 5.0);
  ok(deepEnough, '支撐柱底部深入地面 0.6m 確保無漏底破綻');

  // Check cols carries matching pillar collision
  const pierCols = cols.filter((c) => c.r > 1.0);
  ok(pierCols.length === piers.length, `支撐柱全數納入物理碰撞柱 (cols): ${pierCols.length}/${piers.length}`);
}

console.log('Ⅳ 平地環境防劣化稽核 (Zero overhead on flat terrain)');
{
  const { buildPlatformSlopeFeatures } = loadSlopeFeatures();
  const group = { children: [], add(m) { this.children.push(m); } };
  const cols = [];

  // Fully flat ground (height = 9.0, dy = 10, padT = 1.0, botY = 9.0, gap = 0)
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
