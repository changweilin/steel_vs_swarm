import assert from 'node:assert/strict';
import { BATTLE_GEOLOGY, SYNTH_GEOLOGY, battleGeology, battleGeologySlope } from '../public/js/geologyBattle.js';
import { GEOLOGY_TYPES } from '../public/js/geology.js';
import { readSrc, grabFn } from './audit_src.mjs';

export function auditBattleGeology() {
  let checked = 0;
  const source = readSrc('public', 'js', 'biomes.js');
  // Execute the actual browser adapter; renderer stub retains exactly the supplied mesh data.
  const THREE = { Mesh: class { constructor(geometry, material) { Object.assign(this, { geometry, material }); } } };
  const code = grabFn(source, 'buildGeologyMegalith');
  assert(code, 'Battle adapter exists');
  const build = new Function('battleGeology', 'rockMat', 'runtimeMeshDataGeometry', 'THREE', `${code}; return buildGeologyMegalith;`)(
    battleGeology, () => ({}), mesh => mesh, THREE);
  for (const key of ['auto', ...Object.keys(BATTLE_GEOLOGY)]) for (let seed = 0; seed < 12; seed++) {
    for (const slope of [0, 60, 90]) {
      const entry = battleGeology(key, seed, { slope });
      assert.deepEqual(entry, battleGeology(key, seed, { slope }));
      const { vertices, faces, colors } = entry.meshData, { col } = entry.battle;
      assert(vertices.length > 0 && vertices.every(Number.isFinite));
      assert.equal(colors.length, vertices.length);
      assert(faces.every(i => Number.isInteger(i) && i >= 0 && i < vertices.length / 3));
      assert(faces.length / 3 < 7000, `${key}: bounded triangle budget`);
      const envelope = BATTLE_GEOLOGY[key]?.col ?? SYNTH_GEOLOGY.col;
      assert(col.r <= envelope.r + 1e-8 && col.h <= envelope.h + 1e-8);
      assert(Math.abs(entry.bounds.min[1]) < 1e-8);
      for (let i = 0; i < vertices.length; i += 3) {
        assert(Math.hypot(vertices[i], vertices[i + 2]) <= col.r + 1e-8);
        assert(vertices[i + 1] >= -1e-8 && vertices[i + 1] <= col.h + 1e-8);
      }
      if (slope > 45) assert(GEOLOGY_TYPES[entry.generation.type].terrainFit);
      else if (key !== 'auto') assert.equal(entry.generation.type, BATTLE_GEOLOGY[key].type);
      const g = { children: [], userData: {}, add(mesh) { this.children.push(mesh); } };
      const meta = build(g, key, seed, { slope });
      assert.deepEqual(g.children[0].geometry, entry.meshData);
      assert.deepEqual(meta.col, col);
      assert(meta.anchor.generated && g.children[0].material.vertexColors);
      checked++;
    }
  }
  assert.equal(battleGeologySlope(() => 12, 0, 0, 40), 0);
  assert(Math.abs(battleGeologySlope((x, z) => 2 * x, 0, 0, 40) - Math.atan(2) * 180 / Math.PI) < 1e-9);
  assert(battleGeologySlope((x, z) => x > 20 ? 100 : 0, 0, 0, 40) > 45, 'Outer footprint cliff detected');
  assert.equal(battleGeologySlope(() => NaN, 0, 0, 40), null);
  assert(battleGeologySlope((x, z) => .8 * x + .8 * z, 0, 0, 40) > 45, 'Diagonal gradient is not underestimated');
  for (const slope of [0, 60]) {
    const fieldTypes = new Set(Array.from({ length: 12 }, (_, seed) => battleGeology('auto', seed, { formationSeed: 123, slope }).generation.type));
    assert.equal(fieldTypes.size, 1, 'One formation uses one rock type');
  }
  assert.throws(() => battleGeology('missing', 1), RangeError);
  assert(!source.includes('const ROCK_TONES'), 'Legacy synthesis recipes retired');
  assert(source.includes('if (anchor.generated) return;'), 'No duplicate decorations');
  const placement = grabFn(source, 'placeMegaliths');
  assert(!placement.slice(0, placement.indexOf('\n')).includes('rnd'), 'No shared scene RNG injected');
  assert(!placement.includes('lichens'), 'No floating duplicate lichen planes');
  assert(placement.includes('forestEnvironmentAt(terrain, x, z)'), 'Battle climate reaches the generator');
  const cold = battleGeology('torres', 42, { climate: 'alpine', temperature: -10 });
  const hot = battleGeology('torres', 42, { climate: 'arid', temperature: 35, moisture: .05 });
  assert(cold.generation.surfaces.find(row => row.kind === 'snow').coverage > 0);
  assert.equal(hot.generation.surfaces.find(row => row.kind === 'snow').coverage, 0);
  assert.equal(hot.generation.surfaces.find(row => row.kind === 'moss').coverage, 0);
  console.log(`Battle geology: ${checked} deterministic meshes, real adapter, slope gates and measured envelopes passed.`);
  return checked;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/audit_battle_geology.mjs')) auditBattleGeology();
