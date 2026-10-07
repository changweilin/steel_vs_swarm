// logo.png to logo_flat.png: full emblem (matte cutout + crisp edges + swarm flat colors / steel keeps metallic sheen).
// Pipeline core lives in logo_lib.mjs; four-quadrant split layout in split_logo.mjs.
//   node tools/flatten_logo.mjs
import { buildLogo, writeCropped } from './logo_lib.mjs';

const logo = buildLogo();
const { cw, ch } = writeCropped('logo_flat.png', logo);
console.log(`ok ${logo.w}x${logo.h} -> crop ${cw}x${ch} -> logo_flat.png`);
