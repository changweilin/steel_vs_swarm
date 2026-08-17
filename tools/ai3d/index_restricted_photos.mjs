#!/usr/bin/env node
// 把非出貨資料家裡既有但尚未入帳的照片編入候選帳；絕不替它補造授權。
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { corpusMeta, normalizeCorpusHome } from './provenance.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const HOME = normalizeCorpusHome(resolve(opt('home') || '.'));
const DRY = argv.includes('--dry');
const PHOTOS = join(HOME, 'photos');
const MANIFEST = join(HOME, 'photo_manifest.json');
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function files(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...files(path));
    else if (EXTS.has(extname(ent.name).toLowerCase())) out.push(path);
  }
  return out;
}

function main() {
  if (!existsSync(PHOTOS)) throw new Error(`找不到 ${PHOTOS}`);
  const corpus = corpusMeta(HOME);
  if (corpus.shipping) throw new Error('這支只准處理 corpus.json shipping:false 的限制授權家');
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];
  const seen = new Set(manifest.map((row) => row.file?.replace(/\\/g, '/')));
  let added = 0;
  for (const path of files(PHOTOS).sort()) {
    const rel = relative(HOME, path).replace(/\\/g, '/');
    if (seen.has(rel)) continue;
    const seg = relative(PHOTOS, path).split(/[\\/]/);
    const family = seg[0];
    const part = seg.length >= 3 ? seg[1] : 'whole';
    const stem = basename(path, extname(path)).replace(/[^\w.-]+/g, '_').slice(0, 72) || 'photo';
    const suffix = createHash('sha1').update(rel).digest('hex').slice(0, 8);
    manifest.push({
      family, part, id: `restricted_${stem}_${suffix}`, query: '(本機限制授權照片)', api: 'manual',
      source_url: '', license: 'unverified(restricted corpus)', creator: null,
      retrieved_at: new Date().toISOString(), restricted: true, file: rel, ok: true,
    });
    added++;
  }
  if (!DRY && added) writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`限制授權候選:新增 ${added} 張${DRY ? '(dry)' : ''};既有 ${manifest.length - added} 張`);
}

main();
