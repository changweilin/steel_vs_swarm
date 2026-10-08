// Fixed OSM fixture browser acceptance roster (v1).
// Camera slots only describe which runtime anchor looks where plus offsets; world coordinates, ground height and yaw
// always derive from the live browser battleConfig and terrain, so hand-written coordinates cannot drift from lanes or map rotation.

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
