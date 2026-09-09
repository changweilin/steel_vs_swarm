// Execute production procedural models with the repository's Three.js revision.
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const three = process.env.THREE_MODULE || fileURLToPath(new URL('../out/forest_review/three.module.js', import.meta.url));
const utils = process.env.THREE_BUFFER_UTILS || fileURLToPath(new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url));
if (!existsSync(three) || !existsSync(utils)) throw new Error('Set THREE_MODULE and THREE_BUFFER_UTILS to Three.js 0.160 modules');
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s === 'three') return {url:${JSON.stringify(pathToFileURL(three).href)},shortCircuit:true};
    if (s === 'three/addons/utils/BufferGeometryUtils.js') return {url:${JSON.stringify(pathToFileURL(utils).href)},shortCircuit:true};
    return next(s,c);
  }`), import.meta.url);
export const THREE = await import('three');
if (THREE.REVISION !== '160') throw new Error(`Expected Three.js 0.160, got ${THREE.REVISION}`);
export const { createGroundParts, generateGroundPart } = await import('../public/js/proceduralGroundParts.js');
export function groundModelDefinitions() {
  const variants = createGroundParts();
  return Object.fromEntries(Object.entries(variants).map(([type, parts]) => [type, parts.flat()]));
}
