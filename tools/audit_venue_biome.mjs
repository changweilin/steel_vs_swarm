// ============ Venue biome declaration vs surveyed map data (2026-08-04) ============
// User question: "Taroko and Hehuanshan are nowhere near a city, yet so many buildings? Is the biome
// really judged from map data? Check maps whose type does not fit."
//
// Why this audit exists: `VENUES[].mix` / `.type` are **hand-written venue declarations**, not measured
// values — the exact opposite of the `scen` / `relief` discipline ("MUST be measured"). And they have
// only two consumers: `biomes.js classify()` (ground-tone and vegetation weights) and `placeBoundary()`
// (whether the boundary band grows buildings). **Not a single building consumes them** — buildings follow
// only "does the map data contain buildings". So once an anchor moves to a roaded settlement (the `ll`
// comments in `venues.js` say it plainly: Hehuanshan → Puli town, Yangmingshan → Tianmu, Aokigahara →
// Kawaguchiko town, Uluru → Yulara, Okavango → Maun, Venice → Mestre…), that map gets that town's
// buildings while the declaration still reads "80% bare". This audit lays both side by side so the gap
// is visible.
//
// Measures two **independent** things (deliberately never merged into one number, see
// venue_field.landcoverFor header):
//   1 **Ground-cover mix**: landuse / natural / leisure polygon area share → against declared `mix`
//   2 **Building coverage**: building footprint area ÷ bbox area → against declared `mix.urban`
// Both measured inside the **L1 bbox** (`battleBBox(venueConfig(v, 1))`, same frame as scenario scans).
//
// Thresholds (`TOL`) are **judgment values** with semantics beside the constants — this file's job is to
// "pick out the maps worth looking at", not to fail all 27. Thresholds sit at "an order of magnitude off
// counts as mismatch".
//
// Network: Overpass (same mirror set as biomes.js), results cached in `tools/.scen_cache/`.
// Venues with unreachable map data are always marked **unverified**, MUST NOT be washed into passes
// (principle 6 / matrix general rule 4): the closing "N passed" excludes them, and anything unverified
// blocks an all-green.
//
// Usage: node tools/audit_venue_biome.mjs [--only=taroko,hehuanshan] [--offline] [--json=out.json]
//   `--offline` runs only section I (declaration self-consistency + buildings ignore mix + clipping +
//   roster) — that part is pure offline; `ci.yml` collects this half, the full version (map-data
//   sections II/III) hangs on `lane-scenarios.yml`.
// Exit code: 0 = no unadjudicated gaps and nothing unverified; 1 = unadjudicated gaps or unverified
// (needs a human)
//
// Reverse verification (both land on section I's offline assertions ⇒ no network needed):
//   --break-clip    back to "whole way counts" legacy ⇒ the four clipping assertions MUST go red
//   --break-roster  roster degrades to whole-venue pass ⇒ "new kinds still red" MUST go red
import { writeFileSync } from 'node:fs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { BIOMES, battleBBox } from '../public/js/data.js';
import { R_EARTH, d2r, landcoverFor } from './venue_field.mjs';
import { readSrc } from './audit_src.mjs';

const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
  return m ? [m[1], m[2] ?? '1'] : ['_', s];
}));
const ONLY = (ARG.only || '').split(',').filter(Boolean);

// ---- OSM tag → biome key (single seam) ----
// Key set MUST match `data.js BIOMES` — declaration and survey with different vocabularies cannot be compared.
// Classification only accepts "biome-speaking" tags; everything else (landuse=railway / natural=tree_row
// linears and the like) is unclassified, counted as "untagged" ⇒ low-coverage venues automatically read
// low-confidence instead of a forced composition.
const COVER_KIND = [
  ['water', /^(natural=(water|bay|strait|spring)|landuse=(reservoir|basin|salt_pond)|waterway=(riverbank|canal|dock)|water=.*)$/],
  ['wet', /^(natural=(wetland|mud)|landuse=aquaculture)$/],
  ['bare', /^(natural=(bare_rock|scree|shingle|sand|rock|cliff|glacier|desert|dune)|landuse=(quarry|salt_pond|landfill))$/],
  ['green', /^(natural=(wood|scrub|grassland|heath|fell|moor)|landuse=(forest|grass|meadow|farmland|farmyard|orchard|vineyard|allotments|village_green|greenfield|plant_nursery|recreation_ground)|leisure=(park|garden|golf_course|nature_reserve|recreation_ground))$/],
  ['urban', /^(landuse=(residential|commercial|industrial|retail|construction|military|education|institutional|garages|port|brownfield)|natural=)$/],
];
/** tag object → biome key (null when unclassifiable) */
export function coverKind(tags) {
  for (const k of ['landuse', 'natural', 'leisure', 'waterway', 'water']) {
    const v = tags?.[k];
    if (!v) continue;
    const s = `${k}=${v}`;
    for (const [kind, re] of COVER_KIND) if (re.test(s)) return kind;
  }
  return null;
}

// ---- Geometry: lon/lat polygon area (square meters) ----
// Equidistant cylindrical projection + shoelace. L1 bboxes span only hundreds of meters ⇒ projection
// error far below the "order of magnitude" threshold.
function polyAreaM2(geom, lat0) {
  const c = Math.cos(d2r(lat0));
  let a = 0;
  for (let i = 0, n = geom.length; i < n; i++) {
    const p = geom[i], q = geom[(i + 1) % n];
    a += (p.lon * c * R_EARTH * d2r(1)) * (q.lat * R_EARTH * d2r(1))
       - (q.lon * c * R_EARTH * d2r(1)) * (p.lat * R_EARTH * d2r(1));
  }
  return Math.abs(a) / 2;
}

const bboxAreaM2 = (b) => (b.maxLat - b.minLat) * d2r(1) * R_EARTH
  * (b.maxLng - b.minLng) * d2r(1) * R_EARTH * Math.cos(d2r((b.minLat + b.maxLat) / 2));

// ---- Polygon clipping into the L1 bbox (Sutherland–Hodgman; 2026-08-11) ----
// [Why clipping is mandatory] Overpass `out geom` returns the **whole way's full geometry** — touching
// one bbox corner counts the entire patch. But this file measures "what this **battlefield frame** looks
// like", not "how big the touching polygons are in total". Before clipping, hehuanshan was buried by a
// 4.28 km² `landuse=residential` (Puli town, **3.4x the 1.24 km² frame**) ⇒ measured urban 99% while not
// one building on the Hehuanshan battlefield sits inside that polygon. uluru / okavango / venice / rio
// share the same disease: the neighboring town's landuse counted whole.
// The symptom is hard to spot because it **never errors**: sane numbers, tidy layout, identical every
// round — just measuring the wrong thing. Tuning `mix` by it would rewrite declarations into "the
// anchor's neighboring town biome", which is exactly the defect this audit hunts.
// The clip rectangle is convex ⇒ S–H degenerate bridge edges on concave polygons have zero area, and the
// shoelace formula still yields the correct area.
function clipToBBox(geom, b) {
  const EDGES = [
    [(p) => p.lon >= b.minLng, 'lon', b.minLng], [(p) => p.lon <= b.maxLng, 'lon', b.maxLng],
    [(p) => p.lat >= b.minLat, 'lat', b.minLat], [(p) => p.lat <= b.maxLat, 'lat', b.maxLat],
  ];
  let poly = geom;
  for (const [inside, ax, at] of EDGES) {
    if (!poly.length) return [];
    const out = [];
    const cut = (p, q) => {          // p→q intersection with that boundary (linear interp; the ax axis is identically at)
      const t = (at - p[ax]) / (q[ax] - p[ax]);
      return ax === 'lon' ? { lon: at, lat: p.lat + (q.lat - p.lat) * t }
                          : { lat: at, lon: p.lon + (q.lon - p.lon) * t };
    };
    for (let i = 0, n = poly.length; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n], pi = inside(p), qi = inside(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(cut(p, q));
    }
    poly = out;
  }
  return poly;
}
/** Area after clipping into the bbox (fully outside ⇒ 0) */
const clippedAreaM2 = (geom, b, lat0) => {
  if (ARG['break-clip']) return polyAreaM2(geom, lat0);    // back to legacy: whole way counts (reverse verification)
  const p = clipToBBox(geom, b);
  return p.length >= 3 ? polyAreaM2(p, lat0) : 0;
};

/** Point-in-polygon test (ray casting) */
function ptInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lon, yi = poly[i].lat;
    const xj = poly[j].lon, yj = poly[j].lat;
    const intersect = ((yi > p.lat) !== (yj > p.lat))
      && (p.lon < (xj - xi) * (p.lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---- Decision thresholds (judgment values; semantics live here) ----
const TOL = {
  // Declared biome >= MAJOR but surveyed < MAJOR_MIN ⇒ mismatch (the declared main component does not exist)
  MAJOR: 0.30, MAJOR_MIN: 0.08,
  // Surveyed biome >= SURPRISE while declared < SURPRISE_DECL ⇒ mismatch (the map's main component undeclared)
  SURPRISE: 0.35, SURPRISE_DECL: 0.10,
  // Ground-cover share (tagged landuse/natural area ÷ bbox) below this ⇒ too few samples, report only
  COVER_MIN: 0.15,
  // Coverage: declared urban <= URBAN_LOW yet built >= BUILT_HIGH ⇒ "nowhere near a city, yet buildings"
  //   A true downtown like Taipei Xinyi covers 20~30%; mountain settlements <2%. 8% = "clearly a town".
  URBAN_LOW: 0.25, BUILT_HIGH: 0.08,
  // Reverse: declared urban >= MAJOR yet almost no buildings ⇒ "called downtown but empty land". This is
  // the only reverse criterion on the urban axis — landcover's urban share cannot be used (see JUDGED_AXES).
  BUILT_LOW: 0.03,
};

const BIO_KEYS = Object.keys(BIOMES);

// ---- Trusted axes (tightened after the 2026-08-11 user adjudication) ----
// [Why not judge every axis] OSM ground-cover tagging reliability **varies wildly by biome**; judging on
// unreliable axes means round after round of false positives, and false positives kill this list — that
// is this audit's true death.
//   - `water`: OSM always draws it (rivers/seas/lakes are cartography's skeleton) ⇒ trusted both ways.
//   - `green` / `bare` **cross-contaminate**: red desert tagged `natural=scrub` (→ green), alpine scree
//     tagged `scrub` or left untagged. uluru declares bare 95% but surveys 0%; giza declares bare 85% but
//     surveys green 97% — both declarations are right; what is wrong is judging on the "bare vs scrub"
//     line that OSM itself does not draw consistently.
//     ⇒ Merged into one "undeveloped land" axis: what cannot be told apart is not judged; what can
//     (developed vs undeveloped) is.
//   - `urban` landcover share is **untrustworthy both directions**: dense downtown blocks are rarely drawn
//     as `landuse=residential` (paris surveys 0% while coverage is 18%); conversely town-scale landuse can
//     fill the whole frame with only dozens of buildings (hehuanshan surveys 98% while coverage is 2.5%).
//     ⇒ Out of the landcover comparison; "is it downtown" is always judged by **building coverage**
//     (BUILT_HIGH / BUILT_LOW, both directions).
//   - `wet`: OSM rarely draws it (`natural=wetland` only in reserves) ⇒ not judged.
const JUDGED_AXES = [
  ['water', ['water']],
  ['未開發地', ['green', 'bare']],
];

// ---- Adjudicated roster (2026-08-11 user adjudication) ----
// [Why this table exists] `mix` is a **hand-written art declaration**, not a survey — the 2026-08-11 user
// decision reads "keep mix, acknowledge it as an art declaration". The venues below moved their anchors to
// neighboring towns for road networks (the `ll` comments in `venues.js` say so plainly) while `mix` still
// describes the landmark; that is a **deliberate trade-off**, not a pending bug.
// But "adjudicated" MUST NOT mean "this audit stops judging": gaps outside the roster still go red ⇒
// future `mix` edits, anchor moves, or OSM redraws in the area still get caught. Vanished rostered gaps
// print as stale without failing — map data drifts, and nobody is at fault for that.
// [Pardon the "kind", not the "venue"] Passing a whole venue is a rubber stamp: hehuanshan is pardoned
// today for "undeveloped land unsurfaced"; if its coverage jumps from 2.5% to 40% tomorrow (the area
// built over), that would be swallowed too — exactly what someone needs to know about. ⇒ The roster
// lists **which gap kinds** are accepted per entry; new kinds still go red.
const ACCEPTED = {
  blackforest: { kinds: ['built:high'], why: '錨點 = 鎮上(要路網);宣告描述的是黑森林' },
  kyoto: { kinds: ['built:high'], why: '錨點 = 右京梅津(要路網);宣告描述的是嵐山竹林寺町' },
};
/** Subtract roster-pardoned kinds from the gap list ⇒ whatever remains is "unseen by anyone" and MUST go red */
function unaccepted(id, notes) {
  if (ARG['break-roster']) return ACCEPTED[id] ? [] : notes;   // degrade to whole-venue pass (reverse verification)
  const kinds = ACCEPTED[id]?.kinds || [];
  return notes.filter((n) => !kinds.includes(n.kind));
}

let pass = 0, fail = 0, unverified = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`    ✓ ${m}`); } else { fail++; console.log(`    ✗ ${m}`); } };

const list = VENUES.filter((v) => !ONLY.length || ONLY.includes(v.id));
console.log(`== 場地地貌宣告 vs 圖資實測 ==  場地 ${list.length}、L1 bbox、`
  + `門檻 主成分 ${TOL.MAJOR}/${TOL.MAJOR_MIN}・意外 ${TOL.SURPRISE}/${TOL.SURPRISE_DECL}・建蔽 ${TOL.BUILT_HIGH}\n`);

// ---- I Declaration self-consistency (pure offline, no network) ----
console.log('Ⅰ 宣告自洽(mix 鍵集 / 總和 / type 對得上主成分)');
{
  const TYPE_OF = { green: '綠地', bare: '裸露地', urban: '市區', water: '水體', wet: '濕地' };
  let bad = [];
  for (const v of VENUES) {
    const keys = Object.keys(v.mix || {});
    const sum = keys.reduce((s, k) => s + v.mix[k], 0);
    const top = keys.slice().sort((a, b) => v.mix[b] - v.mix[a])[0];
    const single = v.mix[top] >= 0.8;
    if (!keys.length || keys.some((k) => !BIO_KEYS.includes(k))) bad.push(`${v.id}:鍵不合法`);
    else if (Math.abs(sum - 1) > 1e-6) bad.push(`${v.id}:mix 總和 ${sum.toFixed(2)}`);
    // Single-type (>=80%) type MUST be that main component; mixed types MUST read mixed
    else if (single && v.type !== TYPE_OF[top]) bad.push(`${v.id}:單一型主成分 ${top} 但 type=${v.type}`);
    else if (!single && v.type !== '混合' && v.type !== TYPE_OF[top]) bad.push(`${v.id}:type=${v.type} 對不上 ${top}`);
  }
  ok(!bad.length, `${VENUES.length} 個場地的 mix 鍵集/總和/type 自洽${bad.length ? ` —— ${bad.join('、')}` : ''}`);
  // This line is this file's reason for existing — pin it so nobody later "helpfully" wires mix into
  // the building pipeline: mix is a declaration, not a survey ⇒ it MUST NOT decide authoritative
  // geometry (buildings are collision columns + LOS occluders).
  const bio = readSrc('public', 'js', 'biomes.js');
  const i0 = bio.indexOf('  // ---- 聚落場(單一縫)');
  const i1 = bio.indexOf('  // 市區補間:把被 8 倍世界撐開的街廓填回連續街區');
  ok(i0 > 0 && i1 > i0 && !/\bmix\b/.test(bio.slice(i0, i1).replace(/\/\/.*$/gm, '')),
    '建物管線(聚落場 + 街廓配置)不讀 venue.mix —— 地貌一律由圖資判,宣告不參與');
  // Same fence's two more exits added 2026-08-05 (user report "too many buildings on green/bare land"):
  // boundary buildings are buildings too (they enter generic ⇒ same collision/facade path) ⇒ the urban
  // verdict MUST pass through the settlement field; fallback procedural blocks MUST fire only when the
  // map-data query fails (zero faces on a successful query = the true answer, not a reason to degrade).
  const bare = bio.replace(/\/\/.*$/gm, '');
  ok(/biome === 'urban' && !settlement\?\.\(x, z\)/.test(bare),
    '邊界樓(placeBoundary)的市區判定過聚落場 —— mix / 衛星誤判不得憑空生出建物');
  ok(/if \(!osmSource && \(!mix \|\| \(mix\.urban \|\| 0\) > 0\.1\)/.test(bare),
    '備援程序街區只在圖資查詢失敗(!osmSource)且宣告有市區成分時觸發 —— 查詢成功但零面域 ⇒ 荒野維持荒野');

  // ---- Clipping (2026-08-11; offline direct test, CI collects it) ----
  // This set guards the **measurement itself**: before clipping, one town-scale landuse 3.4x the frame
  // could bury the whole mix while the output looked perfectly normal (sane numbers, identical every
  // round) ⇒ only a frame with a known answer catches it.
  const B = { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };   // unit frame (area = 1° x 1° in m²)
  const A1 = bboxAreaM2(B), lat0 = 0.5;
  const sq = (x0, y0, x1, y1) => [{ lon: x0, lat: y0 }, { lon: x1, lat: y0 }, { lon: x1, lat: y1 }, { lon: x0, lat: y1 }];
  const near = (a, b) => Math.abs(a - b) / A1 < 1e-6;
  ok(clippedAreaM2(sq(2, 2, 3, 3), B, lat0) === 0, '裁剪:完全在方框外 ⇒ 面積 0(碰不到就不該計入)');
  ok(near(clippedAreaM2(sq(0.25, 0.25, 0.75, 0.75), B, lat0), A1 * 0.25),
    '裁剪:完全在框內 ⇒ 面積不變(裁剪 MUST NOT 順手改動本來就合格的那些)');
  ok(near(clippedAreaM2(sq(0.5, 0, 5, 1), B, lat0), A1 * 0.5),
    '裁剪:跨出框 ⇒ 只算框內那一半(hehuanshan 的 4.28 km² 鎮級 landuse 就是靠這一條收回來的)');
  ok(near(clippedAreaM2(sq(-3, -3, 4, 4), B, lat0), A1),
    '裁剪:整個方框被包住 ⇒ 上限恰是方框(否則單一多邊形就能量出 340% 的地被覆蓋)');

  // ---- Adjudicated roster (2026-08-11; offline direct test, CI collects it) ----
  // The roster encodes the **user's adjudication**, it does not switch section III off — these three lines are that boundary.
  const N = (kind) => [{ kind, text: '' }];
  const listed = Object.keys(ACCEPTED)[0], listedKind = ACCEPTED[listed].kinds[0];
  ok(unaccepted('__nobody__', N('built:high')).length === 1,
    '名冊:沒被裁決過的場地 ⇒ 落差原樣留下(名冊 MUST NOT 變成「反正都放行」)');
  ok(unaccepted(listed, N(listedKind)).length === 0,
    `名冊:已裁決的那一種落差 ⇒ 赦免(${listed}/${listedKind})`);
  ok(unaccepted(listed, N('__newkind__')).length === 1,
    '名冊:已裁決場地冒出**新種類**落差 ⇒ 照樣紅(整個場地放行 = 橡皮圖章)');
  ok(Object.keys(ACCEPTED).every((id) => VENUES.some((v) => v.id === id)),
    '名冊:條目全部是現役場地 id(場地改名 ⇒ 赦免會靜默套不上而不是報錯)');
  ok(Object.values(ACCEPTED).every((a) => a.why && a.kinds?.length),
    '名冊:每一筆 MUST 有理由與種類(沒寫理由的赦免,三個月後沒有人知道能不能撤)');
}

if (ARG.offline) {
  console.log(`\n(--offline:略過 Ⅱ/Ⅲ 的圖資實測)\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
  process.exit(fail ? 1 : 0);
}

// ---- II Per-venue survey ----
console.log('\nⅡ 圖資實測(地被組成 + 建蔽率)');
const rows = [];
for (const v of list) {
  const cfg = venueConfig(v, 1);
  const bbox = battleBBox(cfg);
  const lc = await landcoverFor(v.id, bbox);
  if (!lc) {
    unverified++;
    console.log(`  ${(v.id + ' ').padEnd(15, '·')} ⚠️ 取不到圖資(Overpass 不可達)⇒ 未驗`);
    continue;
  }
  const lat0 = (bbox.minLat + bbox.maxLat) / 2;
  const boxA = bboxAreaM2(bbox);
  const area = Object.fromEntries(BIO_KEYS.map((k) => [k, 0]));
  const coverPolys = [];
  for (const c of lc.covers) {
    const k = coverKind(c.tags);
    if (!k) continue;
    const a = clippedAreaM2(c.geometry, bbox, lat0);
    if (a <= 0) continue;
    area[k] += a;
    coverPolys.push({ kind: k, geom: c.geometry });
  }
  let built = 0;
  for (const b of lc.buildings) {
    const a = clippedAreaM2(b.geometry, bbox, lat0);
    if (a <= 0) continue;
    built += a;
    // OSM building footprints classified as urban; green/bare landcover excludes building areas
    const cp = {
      lon: b.geometry.reduce((s, pt) => s + pt.lon, 0) / b.geometry.length,
      lat: b.geometry.reduce((s, pt) => s + pt.lat, 0) / b.geometry.length,
    };
    const matched = coverPolys.find((c) => ptInPoly(cp, c.geom));
    if (matched) {
      if (matched.kind === 'green') {
        area.green = Math.max(0, area.green - a);
        area.urban += a;
      } else if (matched.kind === 'bare') {
        area.bare = Math.max(0, area.bare - a);
        area.urban += a;
      }
    } else {
      area.urban += a;
    }
  }
  const covered = BIO_KEYS.reduce((s, k) => s + area[k], 0);
  const measured = Object.fromEntries(BIO_KEYS.map((k) => [k, covered > 0 ? area[k] / covered : 0]));
  const coverF = Math.min(1, covered / boxA);      // tagged share of the bbox (confidence)
  const builtF = Math.min(1, built / boxA);        // building coverage

  const notes = [];
  const thin = coverF < TOL.COVER_MIN;
  if (!thin) {
    // Compare **trusted axes** only (see JUDGED_AXES): water, plus green+bare merged as "undeveloped".
    for (const [name, keys] of JUDGED_AXES) {
      const d = keys.reduce((s, k) => s + (v.mix[k] || 0), 0);
      const m = keys.reduce((s, k) => s + measured[k], 0);
      const kind = `axis:${name}`;
      if (d >= TOL.MAJOR && m < TOL.MAJOR_MIN) notes.push({ kind, text: `宣告 ${name} ${(d * 100) | 0}% 但圖資只有 ${(m * 100) | 0}%` });
      const expDecl = d + (name === 'water' && v.variant === 'swamp' ? (v.mix.wet || 0) : 0);
      if (m >= TOL.SURPRISE && expDecl < TOL.SURPRISE_DECL) notes.push({ kind, text: `圖資 ${name} ${(m * 100) | 0}% 但宣告只有 ${(d * 100) | 0}%` });
    }
  }
  // urban is judged by building coverage only (both directions) — landcover's urban share is
  // untrustworthy either way, see JUDGED_AXES.
  const du = v.mix.urban || 0;
  if (du <= TOL.URBAN_LOW && builtF >= TOL.BUILT_HIGH) {
    notes.push({ kind: 'built:high', text: `宣告非市區(urban ${(du * 100) | 0}%)但建蔽率 ${(builtF * 100).toFixed(1)}%` });
  }
  if (du >= TOL.MAJOR && builtF < TOL.BUILT_LOW) {
    notes.push({ kind: 'built:low', text: `宣告市區(urban ${(du * 100) | 0}%)但建蔽率只有 ${(builtF * 100).toFixed(1)}%` });
  }
  const fmt = (o) => BIO_KEYS.filter((k) => o[k] > 0.005).map((k) => `${k} ${(o[k] * 100) | 0}%`).join('・') || '—';
  rows.push({ id: v.id, type: v.type, declared: v.mix, measured, coverF, builtF, notes,
    buildings: lc.buildings.length, capped: lc.capped, thin });
  console.log(`  ${(v.id + ' ').padEnd(15, '·')} ${v.type.padEnd(4)} 宣告[${fmt(v.mix)}]  圖資[${fmt(measured)}]`
    + `  地被覆蓋 ${(coverF * 100) | 0}%  建蔽 ${(builtF * 100).toFixed(1)}%（${lc.buildings.length} 棟${lc.capped ? '，頂到額度' : ''}）`
    + (thin ? '  ⓘ 地被標註太稀疏,組成只報不判' : '')
    + (notes.length ? `\n${' '.repeat(19)}⚠️ ${notes.map((n) => n.text).join(';')}` : ''));
}

// ---- III Off-declaration map list ----
console.log('\nⅢ 不符合宣告類型的地圖');
{
  const bad = rows.map((r) => ({ ...r, fresh: unaccepted(r.id, r.notes) })).filter((r) => r.notes.length);
  const nFresh = bad.reduce((s, r) => s + r.fresh.length, 0);
  if (!bad.length) console.log('  (無)');
  for (const r of bad) {
    if (r.fresh.length) console.log(`  ${r.id}(${r.type}):${r.fresh.map((n) => n.text).join(';')}`);
    const pardoned = r.notes.filter((n) => !r.fresh.includes(n));
    if (pardoned.length) console.log(`  ・已裁決 ${r.id}(${r.type}):${pardoned.map((n) => n.text).join(';')}`
      + `\n      ↳ ${ACCEPTED[r.id].why}`);
  }
  // A vanished rostered gap ⇒ print but do not fail (map data drifts; nobody is at fault. Stale entries are the problem)
  const stale = Object.entries(ACCEPTED).flatMap(([id, a]) => {
    const r = rows.find((x) => x.id === id);
    return r ? a.kinds.filter((k) => !r.notes.some((n) => n.kind === k)).map((k) => `${id}/${k}`) : [];
  });
  if (stale.length) console.log(`  ⓘ 已裁決名冊有 ${stale.length} 筆不再落差(圖資變了?可以撤掉):${stale.join('、')}`);
  ok(!nFresh, `${rows.length} 個實測到的場地沒有**未裁決**的落差`
    + `${nFresh ? ` —— ${nFresh} 筆不符` : ''}`
    + `(已裁決 ${bad.reduce((s, r) => s + r.notes.length - r.fresh.length, 0)} 筆,見上)`);
  // **Reading notes for this list (a property of map data, not a program defect)**:
  // OSM ground-cover polygons read **systematically low** on "downtown" — dense downtown blocks are
  // rarely drawn as `landuse=residential` (a suburb/new-town convention), while parks always are
  // ⇒ a "declared urban 80% but surveyed urban 0%" like Paris is mostly tagging habit, not a wrong biome
  // call. "Is this really downtown" is always judged by **building coverage** (it measures actually
  // built-over land); ground-cover mix only informs the green/bare/water axes. Both numbers sit
  // together for exactly this reason.
  console.log('\n  ⓘ 讀法:地被的 urban 軸兩個方向都不可信(密市區街廓少被畫成 landuse=residential;'
    + '\n     反過來鎮級 landuse 可以劃滿整框卻只有幾十棟樓)⇒ 它已退出比對,「是不是市區」只看'
    + '**建蔽率**。\n     green/bare 互相污染(沙漠常被標成 scrub)⇒ 合併成「未開發地」一軸判。');
  const built = rows.filter((r) => (r.declared.urban || 0) <= TOL.URBAN_LOW && r.builtF >= TOL.BUILT_HIGH)
    .sort((a, b) => b.builtF - a.builtF);
  if (built.length) {
    console.log(`  ⓘ 宣告非市區卻蓋滿樓的場地(建蔽率排序):`
      + built.map((r) => `${r.id} ${(r.builtF * 100).toFixed(1)}%`).join('、'));
  }
}

if (ARG.json) writeFileSync(ARG.json, JSON.stringify({ tol: TOL, rows }, null, 1));
console.log(`\n${fail || unverified ? '❌' : '✅'} 通過 ${pass} 項`
  + `${fail ? `,失敗 ${fail} 項` : ''}${unverified ? `,未驗 ${unverified} 個場地(取不到圖資)` : ''}`);
process.exit(fail || unverified ? 1 : 0);
