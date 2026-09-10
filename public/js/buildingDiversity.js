// 純規劃：不依賴 Three.js、不消耗場景共享亂數。
import {
  ARCHITECTURE_STYLES, ARCHITECTURE_PROFILES, ARCHITECTURE_SITE,
  BUILDING_FUNCTION_RANGES, CULTURAL_REGIONS, CULTURAL_AFFINITY_RATIO,
} from './architectureStyles.js';
import { buildContainmentIndex } from './osmAreas.js';
import { BUILDING_FUNCTIONS, taggedBuildingFunction } from './buildingFunctions.js';

export function architectureHash(value, salt = '') {
  const text = `${value}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return h >>> 0;
}

/** 依國家代碼或經緯度判定所屬文化圈 */
export function detectCulturalRegion(location = {}) {
  const country = String(location.country || location.iso || '').trim().toUpperCase();
  if (country) {
    for (const [regionKey, reg] of Object.entries(CULTURAL_REGIONS)) {
      if (reg.countries?.includes(country)) return regionKey;
    }
  }
  const lat = location.lat ?? location.center?.lat ?? location.ll?.[0];
  const lon = location.lng ?? location.lon ?? location.center?.lng ?? location.center?.lon ?? location.ll?.[1];
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const regions = Object.entries(CULTURAL_REGIONS).filter(([,reg]) => reg.bbox?.length === 4)
      .sort(([,a],[,b]) => (a.bbox[2]-a.bbox[0])*(a.bbox[3]-a.bbox[1]) - (b.bbox[2]-b.bbox[0])*(b.bbox[3]-b.bbox[1]));
    for (const [regionKey, reg] of regions) {
      const [minLat, minLon, maxLat, maxLon] = reg.bbox || [];
      if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) return regionKey;
    }
  }
  return null;
}

/** 推導建築地點與功能分類 */
export function inferBuildingFunction(building = {}, poly = null, context = {}) {
  const tags = building.tags || {};
  const explicit = taggedBuildingFunction(tags);
  if (explicit) return explicit;
  const bld = String(tags.building || tags['building:part'] || '');
  // 校區／醫療園區等只有邊界標籤時，僅傳給未指定用途的屋身。
  // 宿舍、車庫、禮拜堂等已有自身形制的建物不繼承整個園區用途。
  if (!bld || bld === 'yes') {
    const parent = taggedBuildingFunction(context.parentTags);
    if (parent && ['hospital', 'school', 'university', 'kindergarten', 'station', 'plant', 'substation', 'water'].includes(parent.type)) {
      return { ...parent, inherited: true };
    }
  }
  const shop = String(tags.shop || '');
  const amenity = String(tags.amenity || '');
  const landuse = String(tags.landuse || context.landuse || '');
  const points = poly?.outer || [];
  const width = points.length ? Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) : (building.w || 10);
  const depth = points.length ? Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) : (building.d || 10);
  const area = width * depth;
  const levels = Number.parseFloat(tags['building:levels'] || tags.levels);
  const rawH = Number.parseFloat(tags.height);

  // 1. 商業區 (Commercial)
  if (bld === 'skyscraper' || (levels >= 14) || (rawH >= 45) || (context.urban && area > 1400 && levels >= 8)) {
    return { category: 'commercial', type: 'skyscraper', key: 'commercial_skyscraper' };
  }
  if (/mall|supermarket|department_store/.test(shop) || /retail|commercial/.test(bld) && area > 600 && (levels <= 4 || !levels)) {
    return { category: 'commercial', type: 'retail', key: 'commercial_retail' };
  }
  if (tags.office || /office|commercial/.test(bld) || /commercial/.test(landuse)) {
    return { category: 'commercial', type: 'office', key: 'commercial_office' };
  }

  // 2. 工業區 (Industrial)
  if (tags.power || bld === 'power' || /substation|generator|transformer/.test(tags.power || '')) {
    return { category: 'industrial', type: 'power', key: 'industrial_power' };
  }
  if (/warehouse|depot|storage/.test(bld)) {
    return { category: 'industrial', type: 'warehouse', key: 'industrial_warehouse' };
  }
  if (/industrial|factory|manufacture|works|workshop/.test(bld) || /industrial/.test(landuse)) {
    return { category: 'industrial', type: 'factory', key: 'industrial_factory' };
  }

  // 3. 鄉村 (Rural)
  if (bld === 'greenhouse' || tags.greenhouse) {
    return { category: 'rural', type: 'greenhouse', key: 'rural_greenhouse' };
  }
  if (/farm|barn|stable|farm_auxiliary|cowshed/.test(bld) || /farmland|farmyard|orchard|vineyard/.test(landuse) || context.rural && area < 250) {
    return { category: 'rural', type: 'farmhouse', key: 'rural_farmhouse' };
  }

  // 4. 觀光區 (Tourism / Civic / Cultural)
  if (/museum|theatre|historic|temple|church|mosque|shrine|castle|pagoda/.test(bld) || tags.tourism === 'museum' || tags.historic) {
    return { category: 'tourism', type: 'cultural', key: 'tourism_cultural' };
  }
  if (/visitor_center|information/.test(tags.tourism || '') || tags.information === 'office' || (tags.tourism && area < 400)) {
    return { category: 'tourism', type: 'visitor', key: 'tourism_visitor' };
  }

  // 5. 住宅郊區 (Residential / Suburban)
  if (/apartments|dormitory/.test(bld) || (/residential/.test(bld) && (levels >= 4 || area > 500))) {
    return { category: 'residential', type: 'apartment', key: 'residential_apartment' };
  }
  if (context.elongated || context.density > ARCHITECTURE_SITE.urbanNeighbors || width < 7 || depth < 7) {
    return { category: 'residential', type: 'alley', key: 'residential_alley' };
  }
  if ((bld === 'house' || bld === 'detached' || bld === 'semidetached_house') && !context.urban) {
    return { category: 'residential', type: 'townhouse', key: 'residential_townhouse' };
  }

  // 6. 無專屬標籤時：依環境尺度與確定性雜湊產生豐富多元分類
  const idHash = architectureHash(context.identity || building.sourceId || `${width},${depth}`, `${context.seed || 0}:bld_func`);
  const prob = (idHash >>> 0) / 4294967296;

  if (context.urban) {
    if (area >= 800) {
      if (prob < 0.45) return { category: 'commercial', type: 'skyscraper', key: 'commercial_skyscraper' };
      if (prob < 0.80) return { category: 'commercial', type: 'office', key: 'commercial_office' };
      return { category: 'commercial', type: 'retail', key: 'commercial_retail' };
    }
    if (area >= 300) {
      if (prob < 0.40) return { category: 'residential', type: 'apartment', key: 'residential_apartment' };
      if (prob < 0.70) return { category: 'commercial', type: 'office', key: 'commercial_office' };
      if (prob < 0.88) return { category: 'commercial', type: 'retail', key: 'commercial_retail' };
      return { category: 'tourism', type: 'cultural', key: 'tourism_cultural' };
    }
    if (prob < 0.40) return { category: 'residential', type: 'alley', key: 'residential_alley' };
    if (prob < 0.70) return { category: 'residential', type: 'townhouse', key: 'residential_townhouse' };
    if (prob < 0.88) return { category: 'commercial', type: 'retail', key: 'commercial_retail' };
    return { category: 'commercial', type: 'office', key: 'commercial_office' };
  }

  if (context.rural) {
    if (prob < 0.60) return { category: 'rural', type: 'farmhouse', key: 'rural_farmhouse' };
    if (prob < 0.88) return { category: 'rural', type: 'greenhouse', key: 'rural_greenhouse' };
    return { category: 'tourism', type: 'visitor', key: 'tourism_visitor' };
  }

  if (prob < 0.45) return { category: 'residential', type: 'townhouse', key: 'residential_townhouse' };
  if (prob < 0.70) return { category: 'residential', type: 'apartment', key: 'residential_apartment' };
  if (prob < 0.85) return { category: 'commercial', type: 'retail', key: 'commercial_retail' };
  if (prob < 0.94) return { category: 'industrial', type: 'factory', key: 'industrial_factory' };
  return { category: 'tourism', type: 'cultural', key: 'tourism_cultural' };
}

/** 依功能類別與確定性種子計算樓高與層數（未標註 height/levels 時隨機抽取） */
export function sampleBuildingHeight(functionKey, seed, identity, area = {}) {
  const tags = area.tags || {};
  const rawH = Number.parseFloat(tags.height);
  if (Number.isFinite(rawH) && rawH > 2) {
    const levels = Math.max(1, Math.round(rawH / 3.4));
    return { height: Math.min(120, rawH), levels, floorH: rawH / levels };
  }
  const rawL = Number.parseFloat(tags['building:levels']);
  if (Number.isFinite(rawL) && rawL > 0) {
    const floorH = 3.2;
    return { height: Math.min(120, Math.max(3.2, rawL * floorH)), levels: Math.round(rawL), floorH };
  }

  const range = BUILDING_FUNCTION_RANGES[functionKey] || BUILDING_FUNCTION_RANGES.residential_townhouse;
  const hash = architectureHash(identity, `${seed}:h_levels`);
  const t = hash / 4294967296;
  const levels = Math.round(range.levels[0] + t * (range.levels[1] - range.levels[0]));
  const hashF = architectureHash(identity, `${seed}:h_floor`);
  const tf = hashF / 4294967296;
  const floorH = range.floorH[0] + tf * (range.floorH[1] - range.floorH[0]);
  const height = Math.max(range.minH, Math.min(range.maxH, levels * floorH));
  return { height: Math.round(height * 10) / 10, levels, floorH: Math.round(floorH * 10) / 10 };
}

export function architectureWeights(context = {}) {
  const profile = context.slope >= ARCHITECTURE_SITE.slopeDeg ? 'hillside'
    : context.urban ? 'urban' : context.rural ? 'rural' : 'plain';
  let weights = { ...ARCHITECTURE_PROFILES[profile] };
  const functional = context.functionInfo?.locked && BUILDING_FUNCTIONS[context.functionInfo.type];
  if (functional) weights = Object.fromEntries(functional.styles.map(id => [id, 10]));
  if (!functional && context.courtyard) weights.courtyard = (weights.courtyard || 10) * 2;
  if (context.elongated) {
    if (weights.machiya) weights.machiya *= 1.5;
    if (weights.industrial) weights.industrial *= 1.5;
  }

  // 已知用途／樓高不套用不相容的固定地域剪影。
  const taggedHeight = Number.parseFloat(context.building?.tags?.height);
  const levelsHeight = Number.parseFloat(context.building?.tags?.['building:levels']) * 3.2;
  const height = context.targetHeight || taggedHeight || levelsHeight;
  if (height) {
    weights = Object.fromEntries(Object.entries(weights).filter(([id]) =>
      !ARCHITECTURE_STYLES[id].maxHeight || height <= ARCHITECTURE_STYLES[id].maxHeight));
  }

  // 依座標位置所屬文化圈調整權重：符合文化者占 60%
  const region = context.region || detectCulturalRegion(context.location || context);
  if (region && CULTURAL_REGIONS[region]) {
    const culturalStyleIds = new Set(CULTURAL_REGIONS[region].styles || []);
    // 注入該文化圈風格候選
    for (const styleId of culturalStyleIds) {
      if (!functional && weights[styleId] == null && ARCHITECTURE_STYLES[styleId]
        && (!height || !ARCHITECTURE_STYLES[styleId].maxHeight || height <= ARCHITECTURE_STYLES[styleId].maxHeight)
        && (!context.functionInfo || !ARCHITECTURE_STYLES[styleId].categories
          || ARCHITECTURE_STYLES[styleId].categories.includes(context.functionInfo.category))) {
        weights[styleId] = 10;
      }
    }
    const cultKeys = Object.keys(weights).filter(k => culturalStyleIds.has(k));
    const otherKeys = Object.keys(weights).filter(k => !culturalStyleIds.has(k));
    const cultSum = cultKeys.reduce((sum, k) => sum + weights[k], 0);
    const otherSum = otherKeys.reduce((sum, k) => sum + weights[k], 0);

    if (cultSum > 0 && otherSum > 0) {
      const cultTarget = CULTURAL_AFFINITY_RATIO;
      const otherTarget = 1 - CULTURAL_AFFINITY_RATIO;
      const cultScale = cultTarget / cultSum;
      const otherScale = otherTarget / otherSum;
      const balanced = {};
      for (const k of cultKeys) balanced[k] = weights[k] * cultScale * 100;
      for (const k of otherKeys) balanced[k] = weights[k] * otherScale * 100;
      weights = balanced;
    }
  }

  // 地形安全高於文化加權；文化注入不得重新引入不適合陡坡的風格。
  if (!functional && context.slope >= ARCHITECTURE_SITE.steepSlopeDeg) {
    weights = Object.fromEntries(Object.entries(weights).filter(([id]) => ARCHITECTURE_STYLES[id].foundation));
  }
  return { profile, weights, region };
}

export function chooseArchitecture(seed, identity, context = {}) {
  const funcInfo = context.functionInfo || inferBuildingFunction(context.building, context.poly, context);
  const heightInfo = sampleBuildingHeight(funcInfo.key, seed, identity, context.building || {});
  const functional = funcInfo.locked && BUILDING_FUNCTIONS[funcInfo.type];
  const { profile, weights, region } = architectureWeights({ ...context, functionInfo: funcInfo, targetHeight: heightInfo.height });
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let pick = architectureHash(identity, seed) / 4294967296 * total;
  let id = Object.keys(weights).at(-1);
  for (const [key, weight] of Object.entries(weights)) {
    pick -= weight;
    if (pick < 0) { id = key; break; }
  }


  return {
    ...ARCHITECTURE_STYLES[id],
    ...(functional ? {
      proceduralOnly: true, functionLocked: true, structureOnly: !!functional.structureOnly,
      // 功能不因陡坡而改成住宅；程序外環沿用已驗證的逐段擋土基礎。
      foundation: 'retaining',
      ...(['religious', 'heritage'].includes(functional.category) ? { era: 'historic' } : {}),
      ...(functional.roofForm ? { roofForm: functional.roofForm } : {}),
    } : {}),
    id, profile, region, slope: context.slope || 0,
    variant: architectureHash(identity, `${seed}:variant`) % 3,
    functionInfo: funcInfo,
    targetHeight: heightInfo.height,
    levels: heightInfo.levels,
    floorH: heightInfo.floorH,
  };
}

/** 用地採最小包含面；密度用空間格，坡度量裸地，不讀建物屋頂。 */
export function createArchitecturePlanner({
  areas = [], terrain, seed = 0, mix = null, center = null, venue = null, country = null, location = null,
} = {}) {
  const land = buildContainmentIndex(areas);
  const cells = new Map();
  const cell = ARCHITECTURE_SITE.densityCellM;
  for (const area of areas) {
    if (!(area.tags?.building || area.tags?.['building:part']) || !area.centroid) continue;
    const key = `${Math.floor(area.centroid.x / cell)},${Math.floor(area.centroid.z / cell)}`;
    cells.set(key, (cells.get(key) || 0) + 1);
  }

  const loc = location || { center, venue, country: country || venue?.country };
  const region = detectCulturalRegion(loc);

  return (building, poly = null, settlement = false) => {
    const centerPt = building.centroid || { x: building.x || 0, z: building.z || 0 };
    const x = centerPt.x, z = centerPt.z;
    const parent = land.parentOf({ centroid: centerPt });
    const use = parent?.tags?.landuse || building.tags?.landuse || '';
    let density = 0;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) density += cells.get(`${cx + i},${cz + j}`) || 0;
    const d = ARCHITECTURE_SITE.probeM;
    const heights = [[x - d, z], [x + d, z], [x, z - d], [x, z + d]]
      .map(([px, pz]) => terrain?.heightAt?.(px, pz));
    let slope = heights.every(Number.isFinite)
      ? Math.atan(Math.hypot(heights[1] - heights[0], heights[3] - heights[2]) / (2 * d)) * 180 / Math.PI : 0;
    const site = poly ? sampleBuildingSite(poly, terrain) : null;
    if (site) slope = Math.max(slope, site.slope);
    const rural = /farmland|farmyard|orchard|vineyard|meadow|allotments/.test(use) || building.tags?.building === 'farm'
      || (use === 'residential' && density < ARCHITECTURE_SITE.urbanNeighbors && !settlement);
    const urban = !rural && (/commercial|retail|industrial/.test(use)
      || settlement || density >= ARCHITECTURE_SITE.urbanNeighbors || (!areas.length && (mix?.urban || 0) > 0.4));
    // 輪廓直接進 seed：同地址的多個 outer 各有變體，輸入順序不改選款。
    const identity = `${building.sourceId || `${x},${z}`}|${JSON.stringify(poly?.outer || [])}`;
    const points = poly?.outer || [];
    const width = points.length ? Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) : (building.w || 10);
    const depth = points.length ? Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) : (building.d || 10);
    const elongated = Math.max(width, depth) / Math.max(0.001, Math.min(width, depth)) > 2.5;

    const ctx = {
      slope, urban, rural, courtyard: !!poly?.holes?.length, elongated,
      density, landuse: use, parentTags: parent?.tags, building, poly, region, location: loc,
      seed, identity,
    };
    ctx.functionInfo = inferBuildingFunction(building, poly, ctx);
    return { ...chooseArchitecture(seed, identity, ctx), site };
  };
}

/** 保留所有通過尺度防線的候選；文化匹配與變形代價共同決定機率。 */
export function pickArchitectureModel(ranked, style, seed) {
  if (!ranked.length) return null;
  const affinity = new RegExp(style.affinity);
  const weighted = ranked.map(row => ({ row, weight: Math.exp(-row.score * 2)
    * (affinity.test(`${row.entry.subpart} ${row.entry.style}`) ? 4 : 1) }));
  let pick = architectureHash(seed, style.id) / 4294967296 * weighted.reduce((sum, row) => sum + row.weight, 0);
  for (const row of weighted) { pick -= row.weight; if (pick < 0) return row.row; }
  return weighted.at(-1).row;
}

/** 坡地基礎、風格與落地高度共用裸地採樣。 */
export function sampleBuildingSite(poly, terrain) {
  const segments = [];
  if (typeof terrain?.heightAt !== 'function') return null;
  let min = Infinity, max = -Infinity, slope = 0;
  for (const ring of [poly.outer, ...(poly.holes || [])]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-5) continue;
      const count = Math.max(1, Math.ceil(length / ARCHITECTURE_SITE.foundationProbeM));
      for (let j = 0; j < count; j++) {
        const point = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const start = point(j / count), end = point((j + 1) / count);
        const y0 = terrain.heightAt(...start), y1 = terrain.heightAt(...end);
        if (!Number.isFinite(y0) || !Number.isFinite(y1)) return null;
        min = Math.min(min, y0, y1); max = Math.max(max, y0, y1);
        slope = Math.max(slope, Math.atan2(Math.abs(y1 - y0), length / count) * 180 / Math.PI);
        segments.push({ start, end, y: Math.min(y0, y1) });
      }
    }
  }
  return segments.length ? { min, max, slope, segments } : null;
}
