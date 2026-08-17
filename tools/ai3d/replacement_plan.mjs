#!/usr/bin/env node
// 2026-08-15 以前生成物的逐件替代佇列。只規劃，不直接撤件；新件通過 intake + 人眼後才封存舊件。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProvenance, normalizeCorpusHome, partKeys } from './provenance.mjs';
import { routeFor } from './pipeline_policy.mjs';
import { rosterSlots } from './intake_recipes.mjs';

export const DEFAULT_CUTOFF = '2026-08-15';
export const LEGACY_METHODS = new Set(['sf3d', 'hunyuan_2gp', 'trellis2_spz', 'simple_geom_tree']);
const loadJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };

export function legacyJobs({ cutoff = DEFAULT_CUTOFF, provenance = loadProvenance() } = {}) {
  return provenance.parts.filter((row) => LEGACY_METHODS.has(row.method) && (!row.at || row.at < cutoff))
    .flatMap((row) => {
      const imgs = row.imgs || [];
      const primary = imgs.find((img) => img.role === 'primary') || imgs[0] || {};
      return partKeys(row).map((key) => ({
        key, at: row.at || null, oldMethod: row.method,
        family: primary.family || key.split('/')[0], part: primary.part || null,
        sourceId: primary.id || null, route: routeFor(primary.family || key.split('/')[0]),
      }));
    });
}

export function candidateCounts(home) {
  const manifest = loadJson(join(normalizeCorpusHome(home), 'photo_manifest.json'), []);
  const out = new Map();
  for (const row of manifest) {
    if (!row.ok || row.screen?.v === 'reject') continue;
    const key = `${row.family}/${row.part}`;
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

export function replacementPlan({ homes = [], cutoff = DEFAULT_CUTOFF } = {}) {
  const automaticKeys = new Set(rosterSlots().flatMap((slot) => slot.names));
  const counts = homes.map(normalizeCorpusHome)
    .filter((home) => existsSync(join(home, 'photo_manifest.json')))
    .map((home) => ({ home, counts: candidateCounts(home) }));
  return legacyJobs({ cutoff }).map((job) => ({
    ...job,
    automatic: automaticKeys.has(job.key),
    candidates: counts.map(({ home, counts: byKey }) => ({
      home, count: byKey.get(`${job.family}/${job.part}`) || 0,
    })).filter((row) => row.count),
  }));
}

function optAll(name) {
  const out = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[++i]);
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/replacement_plan.mjs')) {
  const homes = optAll('home');
  const cutoff = process.argv.includes('--cutoff') ? process.argv[process.argv.indexOf('--cutoff') + 1] : DEFAULT_CUTOFF;
  const rows = replacementPlan({ homes, cutoff });
  if (process.argv.includes('--json')) console.log(JSON.stringify({ cutoff, rows }, null, 2));
  else {
    console.log(`8/15 前待替代 ${rows.length} 件(cutoff < ${cutoff})`);
    for (const row of rows) {
      const supply = row.candidates.length ? row.candidates.map((x) => `${x.count}張@${x.home}`).join('、') : '同類照片 0 張';
      const lane = row.automatic ? '自動換槽' : '人工配方';
      console.log(`  ${row.key}  ${row.oldMethod} → ${row.route.method}  [${row.family}/${row.part || '?'}]  ${lane}・${supply}`);
    }
  }
}
