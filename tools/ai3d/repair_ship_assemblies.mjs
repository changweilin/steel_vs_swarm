#!/usr/bin/env node
/**
 * 把 v6 照片船的盒狀船體收斂成封閉放樣船殼，並修正明顯漂浮與方向錯置。
 *
 * 本檔只規劃零件；實際頂點、面、OBJ 與 bounds 一律由 direct_ingest_v6 的
 * buildGeometryFromParts() 產生，避免稽核刀與零件台各自長出另一份船殼幾何。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGeometryFromParts } from './direct_ingest_v6.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DB_PATH = join(ROOT, 'out', '3d_database.json');
const MANIFEST_PATH = join(HERE, 'parts_manifest.json');
const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const OFFSET = Math.max(0, valueOf('--offset', 0));
const LIMIT = Math.max(1, valueOf('--limit', 5));
const DRY = args.includes('--dry-run');
const EPS = 1e-6;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function eulerAbsMatrix([rx = 0, ry = 0, rz = 0]) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    [Math.abs(cz*cy), Math.abs(cz*sy*sx-sz*cx), Math.abs(cz*sy*cx+sz*sx)],
    [Math.abs(sz*cy), Math.abs(sz*sy*sx+cz*cx), Math.abs(sz*sy*cx-cz*sx)],
    [Math.abs(-sy), Math.abs(cy*sx), Math.abs(cy*cx)],
  ];
}

function localHalf(p) {
  if (p.type === 'hull_polyhedron') return [p.dimensions[0]/2, p.dimensions[1]/2, p.dimensions[2]/2];
  if (p.dimensions) return p.dimensions.map((n) => Math.abs(Number(n) || 0) / 2);
  if (p.type === 'ellipsoid_sphere' || p.type === 'hemisphere_dome') return (p.radii || [1,1,1]).map(Math.abs);
  if (p.type === 'torus_ring') {
    const r = Math.abs(p.radius || 1) + Math.abs(p.tube || 0.2);
    return [r, Math.abs(p.tube || 0.2), r];
  }
  const radii = p.radii || [p.radius || 1, p.radius || 1];
  const r = Math.max(...radii.map((n) => Math.abs(Number(n) || 0)));
  return [r, Math.abs(Number(p.height) || 1) / 2, r];
}

function aabb(p) {
  const pos = p.pos || p.position || [0,0,0];
  if (p.type === 'hull_polyhedron') {
    const [w,h,d] = p.dimensions;
    const ry = (p.rot || p.rotation || [0,0,0])[1] || 0;
    const longX = Math.abs(Math.sin(ry)) > 0.7;
    const hx = (longX ? d : w) / 2, hz = (longX ? w : d) / 2;
    return { min:[pos[0]-hx,pos[1],pos[2]-hz], max:[pos[0]+hx,pos[1]+h,pos[2]+hz] };
  }
  if (p.type === 'hemisphere_dome' && Math.abs((p.rot || p.rotation || [0,0,0])[0] || 0) < 0.1 && Math.abs((p.rot || p.rotation || [0,0,0])[2] || 0) < 0.1) {
    const [rx,ry,rz] = p.radii || [1,1,1];
    return { min:[pos[0]-rx,pos[1],pos[2]-rz], max:[pos[0]+rx,pos[1]+ry,pos[2]+rz] };
  }
  const half = localHalf(p);
  const m = eulerAbsMatrix(p.rot || p.rotation || [0,0,0]);
  const e = m.map((row) => row[0]*half[0] + row[1]*half[1] + row[2]*half[2]);
  return { min:pos.map((v,i)=>v-e[i]), max:pos.map((v,i)=>v+e[i]) };
}

function overlap1(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1,b1) - Math.max(a0,b0));
}

function horizontalOverlap(a, b) {
  const ix = overlap1(a.min[0],a.max[0],b.min[0],b.max[0]);
  const iz = overlap1(a.min[2],a.max[2],b.min[2],b.max[2]);
  const aa = Math.max(EPS,(a.max[0]-a.min[0])*(a.max[2]-a.min[2]));
  return ix*iz/aa;
}

function gapVector(a, b, inset = 0.025) {
  return [0,1,2].map((axis) => {
    if (a.min[axis] > b.max[axis]) return b.max[axis] - a.min[axis] + inset;
    if (a.max[axis] < b.min[axis]) return b.min[axis] - a.max[axis] - inset;
    return 0;
  });
}

function inputPart(p) {
  const q = { ...p, pos:[...(p.position || p.pos || [0,0,0])], rot:[...(p.rotation || p.rot || [0,0,0])] };
  delete q.position;
  delete q.rotation;
  delete q.triangles;
  return q;
}

function longExtent(p, axis) {
  const b = aabb(p);
  return b.max[axis] - b.min[axis];
}

function isSubmarine(model) {
  const text = `${model.style || ''} ${model.id || ''}`.toLowerCase();
  return /submarine|submers|torpedo/.test(text) || model.parts.some((p) => /conning|periscope|diving_plane/.test(p.name.toLowerCase()));
}

function canonicalParts(model) {
  const parts = model.parts.map(inputPart);
  const axis = model.bounds.size[0] > model.bounds.size[2] ? 0 : 2;
  if (axis === 0) return { parts, rotated:false };
  for (const p of parts) {
    const [x,y,z] = p.pos;
    p.pos = [z,y,-x];
    p.rot[1] += Math.PI/2;
  }
  return { parts, rotated:true };
}

function repairSubmarine(model, baselineLength = 0) {
  const canonical = canonicalParts(model);
  let parts = canonical.parts;
  const root = parts.find((p)=>/main_hull/i.test(p.name));
  if (root) {
    const allBounds = parts.map(aabb);
    const minX = Math.min(...allBounds.map((b)=>b.min[0]));
    const maxX = Math.max(...allBounds.map((b)=>b.max[0]));
    const length = Math.max(baselineLength, ...model.bounds.size);
    const rawRadii = root.radii || [root.radius || 2.5,root.radius || 2.5];
    const beamR = Math.max(1,Math.min(...rawRadii.map((v)=>Math.abs(Number(v)||Infinity))));
    const oldPos = root.pos;
    const hull = {
      name:'main_hull', type:'ellipsoid_sphere', radii:[length*0.42,beamR,beamR],
      pos:[(minX+maxX)/2,oldPos[1],oldPos[2]], rot:[0,0,0], color:root.color,
    };
    parts = [hull,...parts.filter((p)=>p!==root)];
  }
  const hull = parts.find((p)=>/main_hull/i.test(p.name));
  if (hull) {
    const hb = aabb(hull);
    for (const p of parts.filter((q)=>q!==hull)) {
      const delta = gapVector(aabb(p),hb);
      if (Math.hypot(...delta) > 0.05 && !/wheel|cradle|support/.test(p.name.toLowerCase())) {
        p.pos = p.pos.map((v,i)=>v+delta[i]);
      }
    }
  }
  for (const periscope of parts.filter((p)=>/periscope|mast/i.test(p.name))) {
    const tower = parts.find((p)=>p!==periscope && /conning.*tower|sail/i.test(p.name));
    if (tower) periscope.pos[1] += aabb(tower).max[1]-aabb(periscope).min[1]-0.025;
  }
  const minY = Math.min(...parts.map((p)=>aabb(p).min[1]));
  if (Number.isFinite(minY) && Math.abs(minY) > 0.001) for (const p of parts) p.pos[1] -= minY;
  for (const p of parts) {
    const n = p.name.toLowerCase();
    if (/propeller|shaft|torpedo_body/.test(n) && /cylinder|conical_frustum/.test(p.type)) p.rot = [0,0,-Math.PI/2];
    if (/periscope|mast/.test(n) && /cylinder|conical_frustum/.test(p.type)) p.rot = [0,0,0];
  }
  return { parts, changes:[canonical.rotated?'長軸 Z→+X':'長軸維持 +X', `貼地位移 ${(-minY).toFixed(2)}m`, '潛艇改用封閉橢球耐壓殼'] };
}

function repairSurfaceShip(model) {
  const canonical = canonicalParts(model);
  const source = canonical.parts;
  const axis = 0;
  const cross = 2;
  const length = Math.max(model.bounds.size[0], model.bounds.size[2]);
  const hullName = /hull|bow|waterline|bottom_red|bottom_trim|red_stripe/i;
  const exclude = /window|deck|plane|stabilizer|fin|marking|propeller|shaft/i;
  const structural = source.filter((p) => hullName.test(p.name) && !exclude.test(p.name) && longExtent(p,axis) >= length*0.34);
  if (!structural.length) return { parts:source, changes:['找不到主船殼'] };

  const paired = structural.filter((p) => /left|right|port|starboard/i.test(p.name) && longExtent(p,axis) >= length*0.58);
  const groups = paired.length >= 2 ? paired.map((p) => [p]) : [structural];
  const consumed = new Set([
    ...structural,
    ...source.filter((p)=>p.type === 'wedge' && /bow/i.test(p.name) && !/deck|ramp|canopy/i.test(p.name)),
  ]);
  const hullParts = [];
  let deckTop = -Infinity;
  let bowSign = 1;
  for (const group of groups) {
    const boxes = group.map(aabb);
    const min = [0,1,2].map((i)=>Math.min(...boxes.map((b)=>b.min[i])));
    const max = [0,1,2].map((i)=>Math.max(...boxes.map((b)=>b.max[i])));
    const wedges = source.filter((p)=>/bow/i.test(p.name) && p.type === 'wedge');
    if (wedges.length) {
      const wc = (aabb(wedges[0]).min[axis] + aabb(wedges[0]).max[axis]) / 2;
      const hc = (min[axis] + max[axis]) / 2;
      bowSign = wc >= hc ? 1 : -1;
    }
    const beam = Math.max(0.6, max[cross] - min[cross]);
    const h = Math.max(0.45, max[1] - min[1]);
    const len = Math.max(beam*2.4, max[axis] - min[axis]);
    const pos = [0,min[1],0];
    pos[cross] = (min[cross]+max[cross])/2;
    pos[axis] = (min[axis]+max[axis])/2;
    let ry = Math.PI/2;
    if (bowSign < 0) ry += Math.PI;
    hullParts.push({
      name: groups.length > 1 ? `hull_poly_${hullParts.length+1}` : 'main_hull_polyhedron',
      type:'hull_polyhedron', dimensions:[beam,h,len], pos, rot:[0,ry,0],
      color:group.sort((a,b)=>longExtent(b,axis)-longExtent(a,axis))[0].color,
    });
    deckTop = Math.max(deckTop, min[1]+h);
  }

  let parts = [...hullParts, ...source.filter((p)=>!consumed.has(p))];
  const taperName = /superstructure|bridge_structure|bridge_base|bridge_main|bridge_cabin|cabin_structure|cabin_main|island_|funnel_structure|funnel_block/i;
  parts = parts.map((p) => {
    if (p.type !== 'box' || !p.dimensions || !taperName.test(p.name)) return p;
    const [w,h,d] = p.dimensions;
    if (Math.min(w,d) < 1 || h < 1) return p;
    return { ...p, type:'tapered_box', topDimensions:[w*0.82,d*0.82] };
  });

  const stackName = /deck|superstructure|bridge|cabin|island|funnel|mast|radar|tank|container|turret|gun/i;
  const decorName = /window|glass|ring|buoy|railing|stripe|marking|light|aircraft|propeller|shaft/i;
  const supports = [...hullParts];
  const movable = parts.filter((p)=>!hullParts.includes(p) && stackName.test(p.name) && !decorName.test(p.name))
    .sort((a,b)=>aabb(a).min[1]-aabb(b).min[1]);
  for (const p of movable) {
    const b = aabb(p);
    let support = null;
    for (const s of supports) {
      const sb = aabb(s);
      if (sb.max[1] > b.min[1] + 0.08 || horizontalOverlap(b,sb) < 0.12) continue;
      if (!support || sb.max[1] > aabb(support).max[1]) support = s;
    }
    if (support) {
      const top = aabb(support).max[1];
      const gap = b.min[1] - top;
      if (gap > 0.05 && gap < model.bounds.size[1]*0.55) p.pos[1] -= gap;
    } else {
      support = supports.filter((s)=> {
        const sb = aabb(s);
        const sc = (sb.min[1]+sb.max[1])/2;
        return sc < p.pos[1] && horizontalOverlap(b,sb)>=0.12 && sb.max[1] <= b.max[1]+0.08;
      }).sort((a,c)=>aabb(c).max[1]-aabb(a).max[1])[0] || null;
      if (support) {
        const penetration = aabb(support).max[1]-b.min[1];
        if (penetration > 0.05) p.pos[1] += penetration;
      }
    }
    supports.push(p);
  }

  const mastParts = parts.filter((p)=>/mast|radar_tower/i.test(p.name) && /cylinder|conical_frustum/.test(p.type));
  const domes = parts.filter((p)=>/radar.*dome|dome/i.test(p.name));
  for (const mast of mastParts) {
    const mb = aabb(mast);
    const below = supports.filter((p)=>p!==mast && aabb(p).max[1] <= mb.min[1]+0.08 && horizontalOverlap(mb,aabb(p))>=0.12)
      .sort((a,b)=>aabb(b).max[1]-aabb(a).max[1])[0];
    const child = domes.filter((p)=>aabb(p).min[1] >= mb.max[1]-0.08 && horizontalOverlap(aabb(p),mb)>=0.12)
      .sort((a,b)=>aabb(a).min[1]-aabb(b).min[1])[0];
    if (below && child && Math.abs((mast.rot||[])[0]||0)<0.1 && Math.abs((mast.rot||[])[2]||0)<0.1) {
      const bottom = aabb(below).max[1], top = aabb(child).min[1];
      if (top > bottom + 0.2) {
        mast.height = top-bottom;
        mast.pos[1] = (top+bottom)/2;
      }
    }
  }

  for (const p of parts) {
    const n = p.name.toLowerCase();
    if ((/main_gun|gun_turret|propeller_shaft/.test(n)) && /cylinder|conical_frustum/.test(p.type)) {
      p.height = Math.max(Number(p.height)||0, length*0.055);
      p.rot = axis === 0 ? [0,0,-Math.PI/2] : [Math.PI/2,0,0];
    }
    if (/life.*ring|lifebuoy|life_buoy/.test(n) && p.type === 'torus_ring') {
      p.rot = axis === 0 ? [Math.PI/2,0,0] : [0,0,Math.PI/2];
    }
    if (/mast|funnel|support|pillar/.test(n) && /cylinder|conical_frustum/.test(p.type)) {
      p.rot = [0,0,0];
      const r = Math.max(...(p.radii || [p.radius || 0]).map((v)=>Math.abs(Number(v)||0)));
      p.height = Math.max(Number(p.height)||0, r*2.4);
      const pb = aabb(p);
      const support = parts.filter((s)=>s!==p && /hull|deck|superstructure|bridge|cabin|island|base|funnel/i.test(s.name))
        .filter((s)=>horizontalOverlap(pb,aabb(s))>=0.12 && aabb(s).min[1] <= p.pos[1]+0.08)
        .sort((a,b)=>aabb(b).max[1]-aabb(a).max[1])[0];
      if (support) p.pos[1] = aabb(support).max[1] + p.height/2;
    }
    if (p.dimensions && /deck|platform/.test(n)) {
      const longest = Math.max(...p.dimensions);
      const thin = p.dimensions.indexOf(Math.min(...p.dimensions));
      p.dimensions[thin] = Math.max(p.dimensions[thin], longest*0.002);
    }
    if (p.dimensions) {
      const longest = Math.max(...p.dimensions);
      p.dimensions = p.dimensions.map((v)=>Math.max(v,0.02,longest*0.0016));
    }
  }

  const attachmentName = /window|glass|ring|buoy|railing|stripe|light|dome|roof|canopy|motor|ladder|wing|flag|anchor|crane_arm|pillar|seat/i;
  const attachmentSupports = parts.filter((p)=>!attachmentName.test(p.name) && !/propeller|shaft|aircraft/.test(p.name));
  for (const p of parts.filter((part)=>attachmentName.test(part.name))) {
    const pb = aabb(p);
    const support = attachmentSupports.filter((s)=>s!==p)
      .sort((a,b)=>Math.hypot(...gapVector(pb,aabb(a),0))-Math.hypot(...gapVector(pb,aabb(b),0)))[0];
    if (!support) continue;
    const delta = gapVector(pb,aabb(support));
    const gap = Math.hypot(...delta);
    if (gap > 0.05) {
      p.pos = p.pos.map((v,i)=>v+delta[i]);
    }
  }

  const placeOn = (children, parents) => {
    for (const child of parts.filter((p)=>children.test(p.name))) {
      const cb = aabb(child);
      const cx = (cb.min[0]+cb.max[0])/2, cz = (cb.min[2]+cb.max[2])/2;
      const parent = parts.filter((p)=>p!==child && parents.test(p.name))
        .filter((p)=> {
          const pb = aabb(p);
          return cx >= pb.min[0]-0.05 && cx <= pb.max[0]+0.05 && cz >= pb.min[2]-0.05 && cz <= pb.max[2]+0.05;
        })
        .sort((a,b)=>aabb(b).max[1]-aabb(a).max[1])[0];
      if (!parent) continue;
      child.pos[1] += aabb(parent).max[1]-aabb(child).min[1]-0.025;
    }
  };
  placeOn(/seat|deck|platform/i,/main_hull_polyhedron/i);
  placeOn(/bridge_cabin|bridge_structure|bridge_deck/i,/superstructure|bridge_base/i);
  placeOn(/roof_deck/i,/bridge|superstructure|cabin/i);
  placeOn(/funnel/i,/superstructure|bridge|cabin|island/i);
  placeOn(/integrated_mast_upper/i,/integrated_mast_lower/i);
  placeOn(/funnel_top/i,/funnel_base/i);
  placeOn(/mast|radar_tower|periscope/i,/funnel|superstructure|bridge|cabin|island|tower|main_hull/i);

  const stackExact = (childName, parentName) => {
    const child = parts.find((p)=>childName.test(p.name));
    const parent = parts.find((p)=>p!==child && parentName.test(p.name));
    if (child && parent) child.pos[1] += aabb(parent).max[1]-aabb(child).min[1]-0.025;
  };
  stackExact(/^integrated_mast_upper$/i,/^integrated_mast_lower$/i);
  stackExact(/^funnel_top$/i,/^funnel_base$/i);

  for (const dome of parts.filter((p)=>/dome/i.test(p.name))) {
    const db = aabb(dome);
    const dcx = (db.min[0]+db.max[0])/2, dcz = (db.min[2]+db.max[2])/2;
    const horizontalDistance = (part) => {
      const pb = aabb(part);
      return Math.hypot((pb.min[0]+pb.max[0])/2-dcx,(pb.min[2]+pb.max[2])/2-dcz);
    };
    const domeSpan = Math.max(db.max[0]-db.min[0],db.max[2]-db.min[2]);
    const nearbyMasts = parts.filter((p)=>/mast|radar_tower/i.test(p.name) && p!==dome)
      .filter((p)=>horizontalDistance(p) <= Math.max(0.75,domeSpan))
      .sort((a,b)=>aabb(b).max[1]-aabb(a).max[1]);
    let support = nearbyMasts[0] || null;
    if (!support) {
      support = parts.filter((p)=>p!==dome && /funnel|superstructure|bridge|cabin|island|mast|tower|deck|hull/i.test(p.name))
        .sort((a,b)=> {
          const ag = gapVector(db,aabb(a),0), bg = gapVector(db,aabb(b),0);
          return Math.hypot(ag[0],ag[2])-Math.hypot(bg[0],bg[2]) || aabb(b).max[1]-aabb(a).max[1];
        })[0] || null;
    }
    if (support) dome.pos[1] += aabb(support).max[1]-aabb(dome).min[1]-0.025;
  }

  const beforeMirror = parts.length;
  const sidePairs = [['left','right'],['port','starboard']];
  for (const p of [...parts]) {
    const lower = p.name.toLowerCase();
    for (const [a,b] of sidePairs) {
      const from = lower.includes(a) ? a : lower.includes(b) ? b : null;
      if (!from) continue;
      const to = from === a ? b : a;
      const mateName = p.name.replace(new RegExp(from,'i'),to);
      if (parts.some((q)=>q.name.toLowerCase()===mateName.toLowerCase())) break;
      const mate = { ...p, name:mateName, pos:[...p.pos], rot:[...p.rot] };
      mate.pos[2] *= -1;
      mate.rot[0] *= -1;
      mate.rot[2] *= -1;
      parts.push(mate);
      break;
    }
  }

  const minY = Math.min(...parts.map((p)=>aabb(p).min[1]));
  if (Number.isFinite(minY) && Math.abs(minY) > 0.001) for (const p of parts) p.pos[1] -= minY;

  return { parts, changes:[canonical.rotated?'長軸 Z→+X':'長軸維持 +X', `船殼 ${structural.length}→${hullParts.length}`, `漸縮艙室 ${parts.filter((p)=>p.type==='tapered_box').length}`, `鏡像補件 ${parts.length-beforeMirror}`, `貼地 ${(-minY).toFixed(2)}m`] };
}

function colorsOf(parts) {
  const pick = (re, fallback) => parts.find((p)=>re.test(p.name))?.color ?? fallback;
  return {
    roofHex:pick(/roof|deck/i,0x7f8c8d), facadeHex:pick(/hull|superstructure|cabin/i,0x95a5a6),
    baseHex:pick(/base|bottom/i,0x34495e), accentHex:pick(/accent|stripe/i,0xe67e22),
    glassHex:pick(/window|glass/i,0x1e293b), darkHex:pick(/dark|funnel/i,0x2c3e50),
    brightHex:pick(/light|radar/i,0xecf0f1),
  };
}

const db = readJson(DB_PATH);
const rows = (Array.isArray(db) ? db : db.items || db.models || []).filter((r)=>r.family==='ship' && r.version===6);
const selected = rows.slice(OFFSET, OFFSET+LIMIT);
const manifest = readJson(MANIFEST_PATH);

for (const row of selected) {
  const dir = join(ROOT,row.outputDir);
  const modelPath = join(dir,'model.json');
  if (!existsSync(modelPath)) throw new Error(`缺 model.json: ${row.outputDir}`);
  const old = readJson(modelPath);
  const baselinePath = join(dir.replace(/_v6$/,''),'model.json');
  const baselineLength = existsSync(baselinePath) ? Math.max(...readJson(baselinePath).bounds.size.filter((_,i)=>i!==1)) : 0;
  const repaired = isSubmarine(old) ? repairSubmarine(old,baselineLength) : repairSurfaceShip(old);
  const input = {
    style:old.style, symmetryMode:'symmetric', colors:colorsOf(old.parts), parts:repaired.parts,
  };
  const stem = basename(dir).replace(/^ship_hull_/,'').replace(/_v6$/,'');
  const built = buildGeometryFromParts(input,'ship','hull',stem);
  if (!DRY) {
    writeFileSync(modelPath, `${JSON.stringify(built.modelJson,null,2)}\n`,'utf8');
    writeFileSync(join(dir,'model.obj'), `${built.objContent}\n`,'utf8');
    const featuresPath = join(dir,'features.json');
    if (existsSync(featuresPath)) writeFileSync(featuresPath, `${JSON.stringify(built.featuresJson,null,2)}\n`,'utf8');
    const metadataPath = join(dir,'metadata.json');
    if (existsSync(metadataPath)) {
      const metadata = readJson(metadataPath);
      metadata.bounds = built.bounds;
      metadata.symmetryMode = 'symmetric';
      metadata.geometryReview = { version:1, repaired:true, rules:repaired.changes };
      writeFileSync(metadataPath, `${JSON.stringify(metadata,null,2)}\n`,'utf8');
    }
    row.bounds = built.bounds;
    row.triangles = built.bounds.triangles;
    const entry = manifest.parts.find((p)=>(p.keys || (p.key ? [p.key] : [])).includes(row.key));
    if (entry) {
      entry.post = { ...(entry.post||{}), bounds:built.bounds.size, repair:'closed_hull_v1' };
      if (entry.gen) entry.gen.measured = `Triangles ${built.bounds.triangles}, Vertices ${built.bounds.vertices}, Similarity ${row.similarityScore || '?'} /100`;
    }
  }
  console.log(`${DRY?'DRY ':'OK  '}${row.key}: ${repaired.changes.join(', ')}`);
}

if (!DRY) {
  writeFileSync(DB_PATH, `${JSON.stringify(db,null,2)}\n`,'utf8');
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest,null,2)}\n`,'utf8');
}

console.log(`完成 ${selected.length} 筆（offset=${OFFSET}, limit=${LIMIT}${DRY?', dry-run':''}）`);
