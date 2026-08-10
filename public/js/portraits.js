// ============ 角色頭像 / 立繪(程序生成 SVG + 手繪覆蓋)============
// 與 models.js 同一套路:先查 manifest 有無手繪檔,沒有就走程序生成 fallback。
// 後續補上手繪立繪時,只要把檔名登記進 PORTRAIT_MANIFEST 即可,不必動任何呼叫端。
//
// 風格對齊賽璐璐核心(toon.js):平塗色塊 + 單一暗部多邊形 + 粗黑描邊,不做漸層陰影。
// 立繪 viewBox 300×400(半身),頭像共用同一份 SVG,只是把 viewBox 裁到頭部。

import { CHARACTERS, SIDES, charKind } from './data.js';
import { LORE } from './lore.js';
// 亂數直取唯一縫 `rng.js`(`hazards.js` 只是舊入口的 re-export,而它 import three)——
// 走舊入口的話,本檔連同所有 import 它的模組(storyui.js …)在 Node 端就再也載不起來,
// 離線稽核只好退回「讀原文用 regex 猜」。行為逐位元不變:兩邊是同一支 `mulberry32`。
import { mulberry32 } from './rng.js';

/** 已有手繪立繪/頭像的角色 id(對齊 public/assets/characters・avatars 現有檔案)。
 * 新角色上線但美術未到位時,不列入此表即自動退回程序生成 fallback。 */
const DRAWN_ART_IDS = [
  's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12',
  't01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10', 't11', 't12',
  'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08',
];
/** 手繪立繪覆蓋表:id -> 圖檔路徑(相對 public/)。留空 = 全部走程序生成。一律原圖,不去背。 */
export const PORTRAIT_MANIFEST = Object.fromEntries(
  DRAWN_ART_IDS.map((id) => [id, `assets/characters/${id}_base.png`]));
/** 手繪頭像覆蓋表(未登記則沿用立繪或程序生成)。一律原圖,不去背。 */
export const AVATAR_MANIFEST = Object.fromEntries(
  DRAWN_ART_IDS.map((id) => [id, `assets/avatars/${id}.png`]));

export const hasDrawnArt = (id) => !!PORTRAIT_MANIFEST[id];

const OUTLINE = '#14161a';
const cache = new Map();

const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;
/** f<0 變暗、f>0 變亮(線性混黑/白;賽璐璐只需要兩階,不做 gamma) */
function shade(color, f) {
  const n = typeof color === 'number' ? color : parseInt(color.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
const seedOf = (id) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---- 髮型:回傳 { back, front }(SVG path/圖形字串;back 畫在頭之前)----
function hairShapes(style, col) {
  const dk = shade(col, -0.32);
  const st = `stroke="${OUTLINE}" stroke-width="3"`;
  switch (style) {
    case 'long':
      return {
        back: `<path d="M88,146 C82,80 112,58 150,58 C188,58 218,80 212,146 L222,306 L188,296 L196,180 L104,180 L112,296 L78,306 Z" fill="${col}" ${st}/>`,
        front: `<path d="M96,138 C94,84 118,66 150,66 C182,66 206,84 204,138 C190,120 176,106 148,110 C126,113 108,122 96,138 Z" fill="${dk}" ${st}/>`,
      };
    case 'bun':
      return {
        back: `<circle cx="150" cy="62" r="30" fill="${dk}" ${st}/>`,
        front: `<path d="M96,140 C94,86 118,68 150,68 C182,68 206,86 204,140 C196,116 178,104 150,104 C122,104 104,116 96,140 Z" fill="${col}" ${st}/>`,
      };
    case 'curl':
      return {
        back: `<g fill="${col}" ${st}>${[[104, 96], [150, 74], [196, 96], [92, 138], [208, 138]]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="30"/>`).join('')}</g>`,
        front: `<path d="M98,136 C98,90 120,72 150,72 C180,72 202,90 202,136 C188,114 172,104 150,104 C128,104 112,114 98,136 Z" fill="${dk}" ${st}/>`,
      };
    case 'crop':
      return { back: '', front: `<path d="M100,132 C100,92 122,76 150,76 C178,76 200,92 200,132 C186,116 172,108 150,108 C128,108 114,116 100,132 Z" fill="${col}" ${st}/>` };
    case 'hood':
      return {
        back: `<path d="M78,160 C72,80 108,50 150,50 C192,50 228,80 222,160 L214,208 L196,150 L104,150 L86,208 Z" fill="${col}" ${st}/>`,
        front: `<path d="M100,124 C104,96 124,84 150,84 C176,84 196,96 200,124 C180,112 120,112 100,124 Z" fill="${dk}" ${st}/>`,
      };
    case 'bald':
      return { back: '', front: `<path d="M100,128 C102,94 124,80 150,80 C176,80 198,94 200,128 C194,112 176,102 150,104 C126,106 110,114 100,128 Z" fill="${dk}" ${st}/>` };
    default: // short
      return {
        back: `<path d="M92,142 C88,84 116,62 150,62 C184,62 212,84 208,142 L200,190 L188,132 L112,132 L100,190 Z" fill="${col}" ${st}/>`,
        front: `<path d="M98,134 C98,88 120,70 150,70 C180,70 202,88 202,134 C184,110 158,102 132,112 C116,118 106,124 98,134 Z" fill="${col}" ${st}/>`,
      };
  }
}

/** 頭戴裝備:無人機操作員 = FPV 目鏡;機甲駕駛 = 半罩頭盔 + 單眼 HUD */
function gearShapes(kind, hue) {
  const lens = shade(hue, 0.25);
  const dk = shade(hue, -0.45);
  const st = `stroke="${OUTLINE}" stroke-width="3"`;
  if (kind === 'drone') {
    return `
      <path d="M86,132 L214,132 L214,120 L86,120 Z" fill="${dk}" ${st}/>
      <rect x="94" y="126" width="112" height="34" rx="12" fill="${shade(hue, -0.25)}" ${st}/>
      <rect x="104" y="134" width="38" height="18" rx="7" fill="${lens}" stroke="${OUTLINE}" stroke-width="2"/>
      <rect x="158" y="134" width="38" height="18" rx="7" fill="${lens}" stroke="${OUTLINE}" stroke-width="2"/>
      <rect x="106" y="136" width="14" height="5" rx="2" fill="#ffffff" opacity="0.85"/>
      <rect x="160" y="136" width="14" height="5" rx="2" fill="#ffffff" opacity="0.85"/>`;
  }
  return `
    <path d="M92,140 C92,80 116,58 150,58 C184,58 208,80 208,140 L208,150 L190,150 L190,112 L110,112 L110,150 L92,150 Z" fill="${shade(hue, -0.2)}" ${st}/>
    <path d="M92,140 L110,140 L110,178 C110,188 102,192 96,186 L90,168 Z" fill="${dk}" ${st}/>
    <path d="M208,140 L190,140 L190,178 C190,188 198,192 204,186 L210,168 Z" fill="${dk}" ${st}/>
    <rect x="152" y="136" width="52" height="16" rx="6" fill="${lens}" stroke="${OUTLINE}" stroke-width="2"/>
    <circle cx="196" cy="144" r="3.4" fill="#fff"/>`;
}

function buildSVG(id) {
  const c = CHARACTERS[id];
  if (!c) return '';
  const art = LORE[id]?.art || {};
  const rnd = mulberry32(seedOf(id));
  const hue = c.visual?.hue ?? 0x8899aa;
  const hueHex = hex(hue);
  const kind = charKind(id);
  const sideCol = c.side === 'MERC' ? '#b9a06a' : SIDES[c.side].color;

  const skin = art.skin || '#e6c6a6';
  const hair = art.hair || '#2b2622';
  const eye = art.eye || '#3a2c22';
  const style = art.style || (rnd() > 0.5 ? 'short' : 'crop');
  const H = hairShapes(style, hair);

  const armor = shade(hue, -0.35);
  const armorLit = shade(hue, -0.1);
  // 背景速度線:賽璐璐漫畫感,角度依角色種子微變
  const lineA = -18 - rnd() * 14;
  const lines = Array.from({ length: 9 }, (_, i) => {
    const x = -60 + i * 46 + rnd() * 12;
    const w = 4 + rnd() * 13;
    return `<rect x="${x.toFixed(1)}" y="-120" width="${w.toFixed(1)}" height="640" fill="#ffffff" opacity="${(0.03 + rnd() * 0.05).toFixed(3)}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="72%">
      <stop offset="0" stop-color="${shade(hue, -0.55)}"/>
      <stop offset="1" stop-color="#0c0e12"/>
    </radialGradient>
    <clipPath id="frame"><rect x="0" y="0" width="300" height="400"/></clipPath>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="300" height="400" fill="url(#bg)"/>
    <g transform="rotate(${lineA.toFixed(1)} 150 200)">${lines}</g>
    <circle cx="150" cy="150" r="104" fill="${sideCol}" opacity="0.10"/>

    <!-- 軀幹 / 駕駛服 -->
    <path d="M28,400 C36,318 92,266 150,266 C208,266 264,318 272,400 Z" fill="${armor}" stroke="${OUTLINE}" stroke-width="4"/>
    <path d="M112,272 L150,318 L188,272 L206,282 L150,344 L94,282 Z" fill="${armorLit}" stroke="${OUTLINE}" stroke-width="3"/>
    <rect x="126" y="196" width="48" height="56" fill="${shade(skin, -0.18)}" stroke="${OUTLINE}" stroke-width="3"/>

    ${H.back}
    <!-- 頭 -->
    <path d="M98,140 C98,96 120,78 150,78 C180,78 202,96 202,140 C202,182 178,216 150,216 C122,216 98,182 98,140 Z"
          fill="${skin}" stroke="${OUTLINE}" stroke-width="4"/>
    <!-- 眼睛落在目鏡/面罩高度:無人機操作員被目鏡完全遮住,機甲駕駛只露左眼(右眼是 HUD 單目鏡) -->
    <ellipse cx="132" cy="143" rx="7.5" ry="5" fill="${eye}" stroke="${OUTLINE}" stroke-width="2"/>
    <ellipse cx="168" cy="143" rx="7.5" ry="5" fill="${eye}" stroke="${OUTLINE}" stroke-width="2"/>
    <path d="M141,190 Q150,196 159,190" fill="none" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>
    ${H.front}
    ${gearShapes(kind, hue)}

    <!-- 賽璐璐暗部:右半側單一色塊(不做漸層)-->
    <path d="M150,0 L300,0 L300,400 L206,400 C214,320 190,266 150,260 Z" fill="#0a0d12" opacity="0.20"/>
    <rect x="0" y="0" width="300" height="400" fill="none" stroke="${sideCol}" stroke-width="3" opacity="0.55"/>
  </g>
</svg>`;
}

const uri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** 半身立繪(300×400)。已登記手繪檔 → 直接回傳原圖路徑(不去背) */
export function portraitURL(id) {
  if (PORTRAIT_MANIFEST[id]) return PORTRAIT_MANIFEST[id];
  let svg = cache.get(id);
  if (!svg) { svg = buildSVG(id); cache.set(id, svg); }
  return uri(svg);
}

/** 頭像(正方形):裁到頭部的同一份 SVG */
export function avatarURL(id) {
  if (AVATAR_MANIFEST[id]) return AVATAR_MANIFEST[id];
  if (PORTRAIT_MANIFEST[id]) return PORTRAIT_MANIFEST[id];
  const key = `a:${id}`;
  let svg = cache.get(key);
  if (!svg) {
    svg = buildSVG(id)
      .replace('viewBox="0 0 300 400" width="300" height="400"', 'viewBox="76 46 148 148" width="148" height="148"');
    cache.set(key, svg);
  }
  return uri(svg);
}
