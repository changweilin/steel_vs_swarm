// 固定 OSM fixture 瀏覽器驗收名冊(v1)。
// 鏡位只描述「由哪個 runtime 錨點往哪裡看」與偏移；實際世界座標、地面高度與 yaw
// 一律由瀏覽器現場的 battleConfig/terrain 推導，避免手寫座標跟兵線或地圖旋轉分家。

export const OSM_BROWSER_MANIFEST = Object.freeze({
  version: 1,
  viewport: Object.freeze({ width: 1280, height: 720 }),
  fixtures: Object.freeze({
    shibuya_dense: Object.freeze({
      fixture: 'shibuya_dense', venue: 'shibuya', teamSize: 5,
      shots: Object.freeze([
        Object.freeze({ id: 'spawn', anchor: 'swarmBase', target: 'center', back: 130, lateral: 22, eye: 28, targetEye: 6 }),
        Object.freeze({ id: 'lane', anchor: 'steelBase', target: 'laneMid', back: 130, lateral: -28, eye: 24, targetEye: 4 }),
      ]),
    }),
    roppongi_underpass: Object.freeze({
      fixture: 'roppongi_underpass', venue: 'roppongi', teamSize: 5,
      shots: Object.freeze([
        Object.freeze({ id: 'spawn', anchor: 'swarmBase', target: 'center', back: 130, lateral: 22, eye: 28, targetEye: 6 }),
        Object.freeze({ id: 'underpass', anchor: 'tunnelMid', target: 'tunnelMid', back: 42, lateral: 10, eye: 3.2, targetEye: 2.5 }),
      ]),
    }),
  }),
});

export function fixtureManifest(name) {
  return OSM_BROWSER_MANIFEST.fixtures[name] || null;
}
