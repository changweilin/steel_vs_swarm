// ============ 專案原生功能性建築（非 img-to-3D）============
// 這六類的用途識別、程序剪影與碰撞剖面是遊戲語意的一部分，必須走 biomes.js 的
// LANDMARKS 原生生成器；照片只可作美術參考，不得進正式 img-to-3D 執行期型錄。
// 本檔零 THREE、零 DOM，瀏覽器場景與 Node 建模工具共用同一份排除名冊。

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
  const building = tags.building;
  const amenity = tags.amenity;
  if (amenity === 'hospital' || building === 'hospital') return 'hospital';
  if (amenity === 'school' || amenity === 'university' || amenity === 'college'
    || building === 'school' || building === 'university') return 'school';
  if (building === 'train_station' || tags.railway === 'station' || amenity === 'bus_station') return 'station';
  if (amenity === 'place_of_worship') {
    if (tags.religion === 'christian' && tags.architecture !== 'stave') return 'church';
    if (tags.religion === 'buddhist' && tags.building !== 'stupa' && tags.building !== 'pagoda') return 'temple';
    if (tags.religion === 'taoist' || (!tags.religion && building !== 'shrine' && building !== 'synagogue' && building !== 'gurdwara' && building !== 'stupa')) return 'temple';
    return null;
  }
  if (tags.tourism === 'museum' || building === 'museum') return 'museum';
  return null;
}
