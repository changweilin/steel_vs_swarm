// logo.png → logo_flat.png:整枚徽記(去背 + 銳利邊緣 + 蜂群純色 / 鋼鐵保留金屬光澤)。
// 管線本體住 logo_lib.mjs;四區塊分檔見 split_logo.mjs。
//   node tools/flatten_logo.mjs
import { buildLogo, writeCropped } from './logo_lib.mjs';

const logo = buildLogo();
const { cw, ch } = writeCropped('logo_flat.png', logo);
console.log(`ok ${logo.w}x${logo.h} -> crop ${cw}x${ch} -> logo_flat.png`);
