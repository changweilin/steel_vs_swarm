// 最新照片→零件路由唯一縫。族名只決定預設工具；最後仍以 fallback 形狀與消費端契約驗收。
export const ROUTES = Object.freeze({
  building: { method: 'trellis2_spz', lane: 'gpu_t2', output: 'glb', note: '整棟量體 / 建物模組' },
  rock: { method: 'hunyuan_2gp', lane: 'gpu_shape', output: 'glb', fallback: 'sf3d', note: '實心不規則岩體' },
  tree: { method: 'sf3d', lane: 'gpu_sf3d', output: 'glb', note: '只做雕塑性冠簇 / 根 / 枝叉；小植被維持程序生成' },
  landmark: { method: 'llm_parts', lane: 'data', output: 'parts', note: '規則人造幾何寫純資料零件列' },
  vehicle: { method: 'llm_parts', lane: 'data', output: 'parts', note: '沿用 vehicles.js 型錄與生成器，不烤整台 GLB' },
  ship: { method: 'llm_parts', lane: 'data', output: 'parts', note: '拆成船體 / 艙面 / 桅桿等純資料零件，不烤完成品' },
});

export const routeFor = (family) => ROUTES[family] || {
  method: 'procedural', lane: 'hold', output: 'none', note: '沒有既有消費縫，先保留照片與候選，不猜 fallback',
};

export const gpuFamilies = (families) => families.filter((family) => routeFor(family).output === 'glb');
export const dataFamilies = (families) => families.filter((family) => routeFor(family).output === 'parts');
