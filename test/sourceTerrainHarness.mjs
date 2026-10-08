import { battleBBox, battleRect, xzToLL, llToXZ } from '../public/js/data.js';
import { mapSourceCenter, mapSourceKey } from '../public/js/mapLayerSources.js';
import { isRandomMap } from '../public/js/randomMapRules.js';
import { randomMapSamplers } from '../public/js/randomMapSources.js';
import { RANDOM_MAP_TEXT } from '../public/js/randomMapContent.js';
import { geoKey } from '../public/js/geocache.js';
import { readSrc, grabFn } from '../tools/audit_src.mjs';

export function sourceTerrainHarness({ gridN = 5, elevation, imagery, get, put, roadImagerySampler = () => null } = {}) {
  const unexpected = async () => { throw new Error('Unexpected external map access'); };
  const deps = { battleBBox, battleRect, mapSourceCenter, mapSourceKey, geoKey,
    geoGet: get || unexpected, geoPut: put || (() => {}), GRID_N: gridN,
    fetchElevTerrarium: elevation || unexpected, fetchElevOpenMeteo: unexpected,
    fetchImagery: imagery || unexpected, xzToLL, llToXZ, isRandomMap, randomMapSamplers, RANDOM_MAP_TEXT,
    roadImagerySampler };
  return new Function(...Object.keys(deps), `${grabFn(readSrc('public', 'js', 'terrain.js'), 'buildTerrain')}; return buildTerrain;`)(...Object.values(deps));
}
