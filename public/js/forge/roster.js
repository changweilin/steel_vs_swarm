// ============ Mech Showcase Roster and Archetype Taxonomy (Single Seam; dev-only) ============
// Taxonomy MUST be derived dynamically from canonical data seams; MUST NOT use hardcoded lists:
//   charKind() (data.js, 32 characters explicit) + CHARACTERS[].visual + MORPH_HUMANOID.
// Hand-written categorization tables drift silently when characters or visuals change.
//
// Dual-stance support:
// Variable-geometry morph mechs possess two distinct archetypes across stances (e.g. t06 monkey king vs UCAV).
// Each stance has independent 3D modeling and concept art references.
// The roster atomic unit is (mech, stance), allowing morph flight stances to share aerial scaffolds
// with UAVs while ground stances reside in humanoid/biomimetic categories.
//
// Roster key = `id` or `id@form` (form in ground/flight).
// Specs overlays, snapshot filenames, and showcase URLs consume this canonical string format.
//
// Zero Three.js dependency: shared between offline CLI tools (audits, fetchers) and browser clients.
// Relative imports ensure single module instance resolution in the browser without duplicating data.js.

import { CHARACTERS, charKind, MORPH_HUMANOID } from '../data.js';
import { protoLayers, PROTO_LAYERS, mechaCodex, charCodex } from '../codex.js';
import { MECHA } from '../mecha.js';
import { LORE } from '../lore.js';

/** Showcase category taxonomy. scaffold = forge scaffold branch; proto = archetype layer key. */
export const CATS = [
  { key: 'humanoid', label: '人形機甲', scaffold: 'biped',
    tip: '人形特徵(VRM 標準骨)→ 機器人零件;比例滑桿可調' },
  { key: 'bionic', label: '仿生機體', scaffold: 'beast',
    tip: '動物原型 → 四足/獸型雙足骨架;比例住逐機 frame' },
  { key: 'airframe', label: '航空機體', scaffold: 'air',
    tip: '現實機型原型(旋翼機/定翼機/撲翼)→ 飛行骨架;無人機與變形者飛行型同頁' },
];
export const CAT_KEYS = CATS.map((c) => c.key);
export const catOf = (key) => CATS.find((c) => c.key === key) || null;

/** Stance label dictionary for roster key suffix (null = single stance). */
export const FORM_LABEL = { ground: '地面型', flight: '飛行型' };

export const entryKey = (id, form) => (form ? `${id}@${form}` : id);
export const splitKey = (key) => {
  const i = String(key).indexOf('@');
  return i < 0 ? { id: key, form: null } : { id: key.slice(0, i), form: key.slice(i + 1) };
};

/**
 * Derives archetype category for a (mech, stance) tuple. Returns null if invalid.
 *   drone            -> airframe (biomimetic drones retain avian/insect forms under aerial category)
 *   robot + proto    -> humanoid (t01/t02/t10/t12)
 *   robot + creature -> bionic (quadruped form:'beast' or digitigrade form:'biped')
 *   morph ground     -> humanoid if MORPH_HUMANOID, otherwise bionic (single seam in data.js)
 *   morph flight     -> airframe
 */
export function catFor(id, form = null) {
  const kind = charKind(id);
  const vis = CHARACTERS[id]?.visual || {};
  if (kind === 'drone') return form ? null : 'airframe';
  if (kind === 'robot') return form ? null : (vis.creature ? 'bionic' : 'humanoid');
  if (kind !== 'morph') return null;
  if (form === 'flight') return 'airframe';
  if (form === 'ground') return MORPH_HUMANOID.has(vis.ground) ? 'humanoid' : 'bionic';
  return null;   // Morph mechs have no untyped single-slot entry.
}

/** Returns available stances for a mech (morph mechs yield 2, others yield [null]). */
export const formsOf = (id) => (charKind(id) === 'morph' ? ['ground', 'flight'] : [null]);

/**
 * Returns archetype reference layers for this slot from MECHA[id].proto.
 * Layer hierarchy is derived via codex.js protoLayers() to prevent duplicated layer logic.
 *   humanoid -> frame
 *   bionic   -> ground / bionic
 *   airframe -> air / frame / bionic (biomimetic UAVs preserve biological design reference)
 * Always appends 'real' design archetype.
 */
export function protoRefsOf(id, form = null) {
  const have = new Set(protoLayers(id));
  const P = MECHA[id]?.proto || {};
  const cat = catFor(id, form);
  // Aerial category retains 'bionic': biomimetic UAVs use animal forms as visual design ground truth.
  const want = cat === 'airframe' ? ['air', 'frame', 'bionic', 'real']
    : cat === 'bionic' ? ['ground', 'bionic', 'real']
      : ['ground', 'frame', 'bionic', 'real'];
  const out = [];
  for (const k of want) {
    if (!have.has(k) || !P[k]?.src) continue;
    if (out.some((o) => o.key === k)) continue;
    out.push({ key: k, label: PROTO_LAYERS.find((L) => L.key === k)?.label || k,
      src: P[k].src, note: P[k].note || '' });
  }
  return out;
}

/**
 * Pilot-mech relationship binding for roster display.
 * All fields MUST resolve from canonical authority sources:
 *   machine name / code / side / kind / pilot <- mechaCodex().ident
 *   height M                                   <- mechaCodex().scaleM
 *   bond                                       <- mechaCodex().deep.bond
 *   callsign                                   <- charCodex().ident.code
 *   nationality / role / quote                 <- LORE
 * Developer labels in mechs/*.js are modeling notes and MUST NOT be used as display names.
 */
export function pilotOf(id) {
  const mc = mechaCodex(id);
  if (!mc) return null;
  const lo = LORE[id] || {};
  return {
    id,
    name: mc.ident.pilot,
    callsign: charCodex(id)?.ident.code || '',
    sideName: mc.ident.side,
    kindWord: mc.ident.kind,
    code: mc.ident.code,
    machine: mc.ident.name,
    heightM: mc.scaleM,
    nat: lo.nat || '',
    role: lo.role || '',
    quote: lo.quote || '',
    bond: mc.deep?.bond || '',
  };
}

/**
 * Livery parameter derivation (hue / faction side / palette tier).
 * MUST match runtime battle simulation values:
 * - Palette tier mirrors models.js heroPalette: light iff robot and not quad beast.
 * - Decals/textures: exports complete CHARACTERS[id].visual to feed paint.paintUnit single seam.
 *   Entire vis object is required because paintAxisSplit relies on form/proto fields.
 */
export function paintOf(id) {
  const c = CHARACTERS[id] || {};
  const vis = c.visual || {};
  const light = charKind(id) === 'robot' && vis.form !== 'beast';
  return { hue: vis.hue ?? 0xffffff, side: c.side || 'STEEL', tier: light ? 'light' : 'dark', vis };
}

/** Complete roster entries ordered by CHARACTERS declaration sequence x stance sequence. */
export function rosterEntries() {
  const out = [];
  for (const id of Object.keys(CHARACTERS)) {
    for (const form of formsOf(id)) {
      const cat = catFor(id, form);
      if (!cat) continue;
      const c = CHARACTERS[id];
      out.push({
        key: entryKey(id, form), id, form, cat,
        label: c.machine || id,
        formLabel: form ? FORM_LABEL[form] : '',
        code: MECHA[id]?.code || '',
        side: c.side, hue: c.visual?.hue ?? 0xffffff, paint: paintOf(id),
        pilot: pilotOf(id),
        protos: protoRefsOf(id, form),
      });
    }
  }
  return out;
}

/** Groups roster entries by category taxonomy for showcase tabs. */
export function rosterByCat() {
  const all = rosterEntries();
  return CATS.map((c) => ({ ...c, entries: all.filter((e) => e.cat === c.key) }));
}
