// ============ 專案原生功能性建築（非 img-to-3D）============
// 這六類的用途識別、程序剪影與碰撞剖面是遊戲語意的一部分，必須走 biomes.js 的
// LANDMARKS 原生生成器；照片只可作美術參考，不得進正式 img-to-3D 執行期型錄。
// 本檔零 THREE、零 DOM，瀏覽器場景與 Node 建模工具共用同一份排除名冊。

import { BUILDING_FUNCTIONS, taggedBuildingFunction } from './buildingFunctions.js';

export const NATIVE_FUNCTIONAL_BUILDINGS = Object.freeze({
  hospital: 'bld_hospital',
  school: 'bld_school',
  station: 'bld_station',
  temple: 'bld_temple',
  church: 'bld_church',
  museum: 'bld_museum',
});

export const NATIVE_FUNCTIONAL_KINDS = Object.freeze(Object.keys(NATIVE_FUNCTIONAL_BUILDINGS));
export const NATIVE_FUNCTIONAL_SUBPARTS = Object.freeze(Object.values(NATIVE_FUNCTIONAL_BUILDINGS));

export const isNativeFunctionalSubpart = (family, subpart) =>
  family === 'building' && NATIVE_FUNCTIONAL_SUBPARTS.includes(subpart);

/** OSM tags → 原生功能性建築類型；其餘建物交還 biomes.js 的一般分類。 */
export function nativeFunctionalKind(tags = {}) {
  const functional = taggedBuildingFunction(tags);
  if (functional) {
    if (tags.architecture === 'stave' || tags.building === 'stave_church') return null;
    const kind = BUILDING_FUNCTIONS[functional.type].landmark;
    return Object.hasOwn(NATIVE_FUNCTIONAL_BUILDINGS, kind) ? kind : null;
  }
  return null;
}
