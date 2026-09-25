// ============ Campaign UI Markup (chapter cards, mission briefings, settlement copy) ============
// Sole shared generation seam between live game `main.js` and local storybook `tools/story_book/`.
// Both environments share identical markup and CSS so offline review exactly mirrors in-game presentation.
//
// Boundaries:
//   1. Zero-DOM, zero-Three.js: generates pure HTML strings so offline tools and audits can execute in Node.
//      `envLabel` is imported from data.js rather than environment.js (which imports Three.js).
//   2. Stateless: unlock status, clear state, and pilot selection are passed in as arguments.
//   3. Event-free: elements provide `data-i` / `data-ch`; callers delegate clicks.

import { SIDES, CHARACTERS, charKind, envLabel } from './data.js';
import { chapterSide } from './story.js';
import { VENUES } from './venues.js';
import { avatarURL } from './portraits.js';
import { kindIconHTML } from './npcicon.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Unit kind display name (aria-label on avatar badges / character card unit row). */
export const kindLabelOf = (kind) => kind === 'drone' ? '無人機' : kind === 'morph' ? '變形者' : '機甲';

/**
 * Avatar with unit kind corner badge.
 * Single seam across all avatar placements (lobby roster, modal roster, pilot chip, card label, storybook).
 * Unit kind routes strictly via `charKind(id)` (mixed compositions decouple faction from unit kind).
 */
export function charAvatarHTML(id, cls = 'char-av') {
  const kind = charKind(id);
  return `<span class="av-wrap"><img class="${cls}" src="${esc(avatarURL(id))}" alt="" draggable="false">`
    + `<span class="av-kind" aria-label="${esc(kindLabelOf(kind))}">${kindIconHTML(kind)}</span></span>`;
}

/** Character chip for pilot selection, enemy roster preview, and storybook. */
export function heroChip(id, opts = {}) {
  const c = CHARACTERS[id] || {};
  const cls = 'sb-chip' + (opts.merc ? ' merc' : '') + (opts.on ? ' on' : '') + (opts.enemy ? ' enemy' : '');
  return `<button class="${cls}" data-ch="${esc(id)}"${opts.enemy ? ' disabled' : ''}>
      ${charAvatarHTML(id, 'sb-chip-av')}
      <span class="sb-chip-txt"><b>「${esc(c.code || '')}」</b>${esc(c.name || '')}${opts.merc ? '<i>傭兵</i>' : ''}</span>
    </button>`;
}

/** Venue display name (falls back to ID so missing data remains noticeable). */
export const venueName = (ch) => VENUES.find((x) => x.id === ch.venueId)?.name || ch.venueId;

/** Single-line venue metadata shared across cards and briefing headers. */
export const chapterMeta = (ch) =>
  `📍 ${esc(venueName(ch))} ・ ${esc(envLabel(ch.env))} ・ ${ch.teamSize}v${ch.teamSize}`;

/**
 * Chapter card HTML. `unlocked` and `cleared` flags are provided by callers.
 * Outer tag adapts to state (clickable buttons for unlocked chapters, divs for locked).
 */
export function chapterCardHTML(ch, i, side, { unlocked = true, cleared = false } = {}) {
  const sc = chapterSide(ch, side);
  const tag = unlocked ? 'button' : 'div';
  const state = cleared ? '<span class="chapter-state done">✓ 已通關</span>'
    : unlocked ? '<span class="chapter-state go">▶ 可出戰</span>'
    : '<span class="chapter-state lock">🔒 未解鎖</span>';
  return `<${tag} class="chapter-card${unlocked ? '' : ' locked'}${cleared ? ' cleared' : ''}" data-i="${i}">
      <span class="chapter-num">${i + 1}</span>
      <div class="chapter-body">
        <span class="chapter-title">${esc(ch.act)} ・ ${esc(sc.title)}</span>
        <span class="chapter-place">${chapterMeta(ch)}</span>
      </div>
      ${state}</${tag}>`;
}

/**
 * Pre-battle briefing: artwork -> narrative prose -> bilateral roster (pilot picker) -> mission objective.
 * @param {string} pilot Currently selected pilot ID for highlight state
 */
export function briefHTML(ch, i, side, pilot) {
  const foe = side === 'STEEL' ? 'SWARM' : 'STEEL';
  const sc = chapterSide(ch, side), ec = chapterSide(ch, foe);
  const cine = sc.img
    ? `<img class="sb-cine-img" src="${esc(sc.img)}" alt="${esc(sc.title)}" onerror="this.classList.add('sb-cine-fail')">`
    : '';
  const mercSet = new Set(sc.mercs);
  const yourChips = [...sc.heroes, ...sc.mercs]
    .map((id) => heroChip(id, { merc: mercSet.has(id), on: id === pilot })).join('');
  const foeMerc = new Set(ec.mercs);
  const foeChips = [...ec.heroes, ...ec.mercs].map((id) => heroChip(id, { merc: foeMerc.has(id), enemy: true })).join('');
  return `
    <div class="sb-cine sb-cine-${side}">
      ${cine}
      <div class="sb-cine-scrim"></div>
      <div class="sb-cine-corners"><i></i><i></i><i></i><i></i></div>
      <div class="sb-cine-tag">${side === 'STEEL' ? '協約 · 鋼鐵征討' : '同盟 · 蜂群逆襲'}</div>
      <div class="sb-cine-cap">
        <div class="sb-cine-act">${esc(ch.act)} ／ CH.${String(i + 1).padStart(2, '0')}</div>
        <div class="sb-cine-name">${esc(sc.title)}</div>
        <div class="sb-cine-meta">${chapterMeta(ch)}</div>
      </div>
    </div>
    <div class="sb-prose"><p class="sb-intro">${esc(sc.intro).replace(/\n\n+/g, '</p><p class="sb-intro">')}</p></div>
    <div class="sb-roster" style="--own:var(${side === 'STEEL' ? '--steel' : '--swarm'});--foe:var(${side === 'STEEL' ? '--swarm' : '--steel'})">
      <div class="sb-roster-h your">◈ 你的部隊 — 點選出戰主駕,其餘為 AI 僚機</div>
      <div class="sb-chips" id="sbYourChips">${yourChips}</div>
      <div class="sb-roster-h foe">✖ 當面之敵</div>
      <div class="sb-chips">${foeChips}</div>
    </div>
    <div class="sb-obj">${esc(sc.objective)}</div>`;
}

/**
 * Campaign settlement headline and narrative copy (sourced directly from story.js victory/defeat).
 * Returns `{ title, sub, color }` where color applies faction tint on victory and danger tint on defeat.
 */
export function overText(ch, side, won) {
  const sc = chapterSide(ch, side);
  return {
    title: won ? '任務達成' : '任務失敗',
    sub: won ? sc.victory : sc.defeat,
    color: won ? SIDES[side].color : 'var(--danger)',
  };
}

/** Campaign progress summary string beneath chapter selector; cleared count supplied by caller. */
export const progressText = (side, clearedN, total) =>
  `${SIDES[side].name}戰線:已通關 ${clearedN} / ${total}`
  + (clearedN >= total ? ' ・ 🏆 全戰線肅清!' : '');
