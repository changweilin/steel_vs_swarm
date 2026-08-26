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
import { resolveShipScale } from './ship_scale_catalog.mjs';

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
const GENERATED_SHIP_DETAIL_RE = /^(landing_centerline|angled_landing_line|aircraft_elevator_|deck_edge_catwalk_|deck_aircraft_|ski_jump_ramp$|passenger_deck_tier_|upper_deck_core|balcony_|lifeboat_|disney_funnel_|forward_bridge_wing|aft_terrace_|lng_pipe_run_|lng_manifold_|cargo_hatch_[5-7]$|container_bay_|catamaran_bridge_tunnel|fishing_winch|aft_work_frame|vls_cell_|ciws_aft|stern_pumpjet_ring|stern_propulsor_hub|sealed_)/i;

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
    const pos = [0,0,0];
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
      if (gap > 0.05 && gap < model.bounds.size[1]*0.80) p.pos[1] -= gap;
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

  const attachmentName = /window|glass|ring|buoy|railing|stripe|light|dome|roof|canopy|motor|ladder|wing|flag|anchor|crane_arm|pillar|seat|lifeboat|stabilizer/i;
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

  const portStabilizer = parts.find((p)=>/port.*stabilizer|stabilizer.*port/i.test(p.name));
  const starboardStabilizer = parts.find((p)=>/starboard.*stabilizer|stabilizer.*starboard/i.test(p.name));
  if (portStabilizer && starboardStabilizer) {
    const x = (portStabilizer.pos[0]+starboardStabilizer.pos[0])*0.5;
    const flightDeck = parts.find((p)=>/flight_deck/i.test(p.name));
    const deckBox = flightDeck ? aabb(flightDeck) : null;
    const y = deckBox ? (deckBox.min[1]+deckBox.max[1])*0.5 : (portStabilizer.pos[1]+starboardStabilizer.pos[1])*0.5;
    const stabilizerHalfBeam = (aabb(portStabilizer).max[2]-aabb(portStabilizer).min[2])*0.5;
    const z = deckBox ? Math.max(0.1,deckBox.max[2]-stabilizerHalfBeam+0.025) : (Math.abs(portStabilizer.pos[2])+Math.abs(starboardStabilizer.pos[2]))*0.5;
    const portSign = Math.sign(portStabilizer.pos[2]) || 1;
    portStabilizer.pos = [x,y,portSign*z];
    starboardStabilizer.pos = [x,y,-portSign*z];
    starboardStabilizer.rot = [-portStabilizer.rot[0],portStabilizer.rot[1],-portStabilizer.rot[2]];
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

function addShipClassDetails(parts, row, model) {
  const identity = `${row.key} ${model.style || ''}`;
  for (let i=parts.length-1;i>=0;i--) if (GENERATED_SHIP_DETAIL_RE.test(parts[i].name)) parts.splice(i,1);
  const bounds = parts.map(aabb);
  const lo = [0,1,2].map((i)=>Math.min(...bounds.map((b)=>b.min[i])));
  const hi = [0,1,2].map((i)=>Math.max(...bounds.map((b)=>b.max[i])));
  const L = hi[0]-lo[0], H = hi[1]-lo[1], B = hi[2]-lo[2];
  const hull = parts.find((p)=>/main_hull/i.test(p.name));
  const deckCandidate = parts.filter((p)=>/flight_deck|main_deck|cargo_deck|weather_deck|deck$/i.test(p.name))
    .reduce((best,p)=>!best || (aabb(p).max[0]-aabb(p).min[0])*(aabb(p).max[2]-aabb(p).min[2]) > (aabb(best).max[0]-aabb(best).min[0])*(aabb(best).max[2]-aabb(best).min[2]) ? p : best,null);
  const deck = deckCandidate && aabb(deckCandidate).max[0]-aabb(deckCandidate).min[0] >= L*0.40 ? deckCandidate : hull;
  const deckTop = deck ? aabb(deck).max[1] : H*0.25;
  const hullColor = hull?.color ?? 0x8d99a6;
  const deckColor = deck?.color ?? 0x4b5563;
  const bright = parts.find((p)=>/radar|window/i.test(p.name))?.color ?? 0xe5e7eb;
  const glass = parts.find((p)=>/window|glass/i.test(p.name))?.color ?? 0x17384a;
  const add = (part) => {
    if (!parts.some((p)=>p.name.toLowerCase()===part.name.toLowerCase())) parts.push(part);
  };

  if (/aircraft_carrier/i.test(identity)) {
    const fd = parts.find((p)=>/flight_deck/i.test(p.name)) || deck;
    const fb = fd ? aabb(fd) : { min:[-L/2,deckTop,-B/2], max:[L/2,deckTop,B/2] };
    const top = fb.max[1];
    add({ name:'landing_centerline', type:'box', dimensions:[0.45,0.05,L*0.62], pos:[L*0.02,top+0.025,0], rot:[0,Math.PI/2,0], color:0xf4f1de });
    add({ name:'angled_landing_line', type:'box', dimensions:[0.38,0.055,L*0.46], pos:[-L*0.08,top+0.03,-B*0.12], rot:[0,Math.PI/2-0.12,0], color:0xf4f1de });
    add({ name:'aircraft_elevator_forward', type:'box', dimensions:[B*0.18,0.08,L*0.075], pos:[L*0.23,top+0.04,B*0.28], rot:[0,Math.PI/2,0], color:0x606770 });
    add({ name:'aircraft_elevator_aft', type:'box', dimensions:[B*0.17,0.08,L*0.07], pos:[-L*0.28,top+0.04,-B*0.28], rot:[0,Math.PI/2,0], color:0x606770 });
    add({ name:'deck_edge_catwalk_port', type:'box', dimensions:[1.0,0.55,L*0.68], pos:[-L*0.02,top-0.25,fb.max[2]-0.45], rot:[0,Math.PI/2,0], color:hullColor });
    add({ name:'deck_edge_catwalk_starboard', type:'box', dimensions:[1.0,0.55,L*0.68], pos:[-L*0.02,top-0.25,fb.min[2]+0.45], rot:[0,Math.PI/2,0], color:hullColor });
    for (let i=0;i<10;i++) {
      const x = -L*0.36 + (i%5)*L*0.075;
      const z = (i<5 ? -1 : 1) * B*(0.27 + (i%2)*0.06);
      add({ name:`deck_aircraft_${String(i+1).padStart(2,'0')}`, type:'wedge', dimensions:[B*0.075,L*0.002,L*0.025], pos:[x,top+L*0.002,z], rot:[0,Math.PI/2,0], color:0xb7c0ca });
    }
    if (/圖2-超日王號|e7642302|GettyImages/i.test(identity) && !parts.some((p)=>/ski_jump/i.test(p.name))) {
      add({ name:'ski_jump_ramp', type:'wedge', dimensions:[B*0.72,H*0.07,L*0.13], pos:[L*0.42,top+H*0.025,0], rot:[0,Math.PI/2,0], color:deckColor });
    }
  }

  if (/cruise_ship|cruise ship/i.test(identity)) {
    const sideY = deckTop + Math.max(1,H*0.18);
    for (let tier=0;tier<3;tier++) {
      const tierY = sideY+tier*H*0.09;
      const tierLength = L*(0.68-tier*0.05);
      for (const side of [-1,1]) {
        add({ name:`balcony_support_${tier+1}_${side<0?'port':'starboard'}`, type:'tapered_box', dimensions:[B*0.12,H*0.075,tierLength], topDimensions:[B*0.10,tierLength*0.97], pos:[-L*0.04,tierY,side*B*0.415], rot:[0,Math.PI/2,0], color:bright });
        add({ name:`balcony_band_${tier+1}_${side<0?'port':'starboard'}`, type:'box', dimensions:[0.16,Math.max(0.35,H*0.025),tierLength], pos:[-L*0.04,tierY,side*B*0.47], rot:[0,Math.PI/2,0], color:glass });
      }
    }
    for (let i=0;i<8;i++) for (const side of [-1,1]) {
      add({ name:`lifeboat_${String(i+1).padStart(2,'0')}_${side<0?'port':'starboard'}`, type:'ellipsoid_sphere', radii:[Math.max(0.35,B*0.018),Math.max(0.35,H*0.018),Math.max(1,L*0.012)], pos:[-L*0.29+i*L*0.08,sideY,side*B*0.47], rot:[0,Math.PI/2,0], color:0xe9a23b });
    }
    if (/Disney%20Adventure|Disney Adventure/i.test(identity)) {
      for (let i=0;i<4;i++) {
        const x = -L*0.12+(i%2)*L*0.22;
        const z = (i<2?-1:1)*B*0.11;
        const supportTop = Math.max(deckTop,...parts.filter((p)=>!GENERATED_SHIP_DETAIL_RE.test(p.name)).map(aabb)
          .filter((box)=>x>=box.min[0] && x<=box.max[0] && z>=box.min[2] && z<=box.max[2]).map((box)=>box.max[1]));
        const plinthH = H*0.18, funnelH = H*0.18;
        add({ name:`disney_funnel_plinth_${i+1}`, type:'box', dimensions:[B*0.10,plinthH,B*0.10], pos:[x,supportTop+plinthH*0.5,z], rot:[0,0,0], color:bright });
        add({ name:`disney_funnel_${i+1}`, type:'cylinder', sides:8, radii:[B*0.045,B*0.06], height:funnelH, pos:[x,supportTop+plinthH+funnelH*0.5,z], rot:[0,0,0], color:0xb3262e });
      }
      add({ name:'forward_bridge_wing', type:'tapered_box', dimensions:[B*0.90,H*0.08,L*0.10], topDimensions:[B*0.78,L*0.08], pos:[L*0.32,deckTop+H*0.34,0], rot:[0,Math.PI/2,0], color:bright });
    }
    if (/explorer-of-the-seas/i.test(identity)) {
      for (let i=0;i<3;i++) add({ name:`aft_terrace_${i+1}`, type:'tapered_box', dimensions:[B*(0.88-i*0.09),H*0.055,L*(0.14-i*0.018)], topDimensions:[B*(0.80-i*0.08),L*(0.12-i*0.016)], pos:[-L*(0.36-i*0.025),deckTop+H*(0.22+i*0.07),0], rot:[0,Math.PI/2,0], color:bright });
    }
  }

  if (/LNG|methan/i.test(identity)) {
    for (const z of [-B*0.16,0,B*0.16]) add({ name:`lng_pipe_run_${z<0?'port':z>0?'starboard':'center'}`, type:'cylinder', sides:8, radii:[Math.max(0.12,B*0.008),Math.max(0.12,B*0.008)], height:L*0.62, pos:[-L*0.03,deckTop+H*0.045,z], rot:[0,0,-Math.PI/2], color:0xd6dde5 });
    for (let i=0;i<3;i++) add({ name:`lng_manifold_${i+1}`, type:'cylinder', sides:8, radii:[Math.max(0.10,B*0.006),Math.max(0.10,B*0.006)], height:B*0.42, pos:[-L*0.20+i*L*0.20,deckTop+H*0.045,0], rot:[Math.PI/2,0,0], color:0xd6dde5 });
  }

  if (/bulk/i.test(identity)) {
    for (let i=0;i<7;i++) add({ name:`cargo_hatch_${i+1}`, type:'tapered_box', dimensions:[B*0.72,H*0.025,L*0.085], topDimensions:[B*0.66,L*0.078], pos:[-L*0.28+i*L*0.09,deckTop+H*0.012,0], rot:[0,Math.PI/2,0], color:0xc7c9c3 });
  }

  if (/container|cargo_ship/i.test(identity)) {
    for (let i=parts.length-1;i>=0;i--) if (/container_stack|deck_containers|container_deck_area/i.test(parts[i].name)) parts.splice(i,1);
    const obstacles = parts.filter((p)=>/bridge|superstructure|cabin|island/i.test(p.name)).map(aabb);
    let bay = 0;
    for (let candidate=0;candidate<11 && bay<6;candidate++) {
      const x = -L*0.27+candidate*L*0.065;
      const probe = { min:[x-L*0.034,deckTop,-B*0.40], max:[x+L*0.034,deckTop+H*0.13,B*0.40] };
      if (obstacles.some((box)=>overlap1(probe.min[0],probe.max[0],box.min[0],box.max[0])>0 && overlap1(probe.min[2],probe.max[2],box.min[2],box.max[2])>0)) continue;
      for (let rowZ=-1;rowZ<=1;rowZ++) add({ name:`container_bay_${bay+1}_${rowZ+2}`, type:'box', dimensions:[B*0.24,H*0.12,L*0.065], pos:[x,deckTop+H*0.06,rowZ*B*0.25], rot:[0,Math.PI/2,0], color:[0xb94b42,0x315c7d,0xc98b35][(bay+rowZ+3)%3] });
      bay++;
    }
  }

  if (/catamaran|TurboJET_Barca/i.test(identity)) {
    const existingDemiHulls = parts.filter((p)=>/hull/i.test(p.name) && p.type==='hull_polyhedron' && Math.abs(p.pos[2])>B*0.08);
    if (existingDemiHulls.length===2) {
      existingDemiHulls.sort((a,b)=>b.pos[2]-a.pos[2]);
      existingDemiHulls[0].name = 'main_hull_port';
      existingDemiHulls[1].name = 'main_hull_starboard';
    }
    const hasTwinHull = parts.some((p)=>/main_hull.*port/i.test(p.name)) && parts.some((p)=>/main_hull.*starboard/i.test(p.name));
    const rootIndex = hasTwinHull ? -1 : parts.findIndex((p)=>/main_hull_polyhedron/i.test(p.name));
    if (!hasTwinHull && rootIndex >= 0) {
      const root = parts[rootIndex];
      const beam = root.dimensions[0];
      const demi = { ...root, dimensions:[beam*0.34,root.dimensions[1],root.dimensions[2]], pos:[...root.pos] };
      parts.splice(rootIndex,1,
        { ...demi, name:'main_hull_port', pos:[demi.pos[0],demi.pos[1],B*0.28] },
        { ...demi, name:'main_hull_starboard', pos:[demi.pos[0],demi.pos[1],-B*0.28] });
    }
    const deckBox = deck ? aabb(deck) : null;
    const tunnelHeight = Math.max(0.2,H*0.025);
    const tunnelY = deckBox ? deckBox.min[1]-tunnelHeight*0.5+0.02 : deckTop-H*0.04;
    add({ name:'catamaran_bridge_tunnel', type:'box', dimensions:[B*0.62,tunnelHeight,L*0.34], pos:[L*0.02,tunnelY,0], rot:[0,Math.PI/2,0], color:hullColor });
  }

  if (/fishing/i.test(identity)) {
    add({ name:'fishing_winch', type:'cylinder', sides:10, radii:[Math.max(0.15,B*0.045),Math.max(0.15,B*0.045)], height:Math.max(0.4,B*0.18), pos:[-L*0.20,deckTop+Math.max(0.15,B*0.045),0], rot:[Math.PI/2,0,0], color:0x46515d });
    add({ name:'aft_work_frame', type:'box', dimensions:[Math.max(0.08,B*0.015),Math.max(0.5,H*0.22),Math.max(0.08,B*0.015)], pos:[-L*0.20,deckTop+H*0.11,0], rot:[0,0,0], color:0xd0d5da });
  }

  if (/warship|military_ship|naval/i.test(identity) && !/submarine|aircraft_carrier/i.test(identity)) {
    for (let i=0;i<4;i++) add({ name:`vls_cell_${i+1}`, type:'box', dimensions:[B*0.09,H*0.018,L*0.025], pos:[L*(0.17+i*0.035),deckTop+H*0.01,(i%2?-1:1)*B*0.07], rot:[0,Math.PI/2,0], color:0x39434d });
    add({ name:'ciws_aft', type:'cylinder', sides:10, radii:[B*0.025,B*0.032], height:H*0.07, pos:[0,deckTop+H*0.035,0], rot:[0,0,0], color:bright });
  }

  if (/submarine/i.test(identity)) {
    const hb = hull ? aabb(hull) : { min:lo, max:hi };
    const sternY = (hb.min[1]+hb.max[1])*0.5;
    add({ name:'stern_pumpjet_ring', type:'torus_ring', radius:Math.max(0.5,B*0.34), tube:Math.max(0.08,B*0.045), pos:[hb.min[0],sternY,0], rot:[0,0,Math.PI/2], color:0x303841 });
    add({ name:'stern_propulsor_hub', type:'cylinder', sides:12, radii:[Math.max(0.18,B*0.10),Math.max(0.18,B*0.10)], height:Math.max(0.5,L*0.025), pos:[hb.min[0],sternY,0], rot:[0,0,Math.PI/2], color:0x252b32 });
  }

  for (const p of parts) if (/mast|funnel|stack/i.test(p.name) && /cylinder|conical_frustum/.test(p.type)) p.rot = [0,0,0];
}

function sealShipCabins(parts) {
  for (let i=parts.length-1;i>=0;i--) {
    if (/cockpit_seating|seat_row_|open_interior|cabin_interior|bridge_interior/i.test(parts[i].name)) parts.splice(i,1);
  }
  const hull = parts.find((part)=>/main_hull/i.test(part.name));
  const wallColor = parts.find((part)=>/cabin|bridge|superstructure/i.test(part.name) && !/window|glass|roof/i.test(part.name))?.color
    ?? hull?.color ?? 0x9aa7b2;
  const structuralRoom = /cabin|bridge|superstructure|sealed_/i;
  const roomDetail = /window|glass|roof|deck|wing|mast|radar/i;
  const supportSurface = /deck|platform|hull|cabin|bridge|superstructure|sealed_/i;
  const roofs = parts.filter((part)=>/^(canopy_roof|roof_canopy|rear_canopy_roof)$/i.test(part.name));

  for (const roof of roofs) {
    const roofBox = aabb(roof);
    const alreadyClosed = parts.some((part)=>part!==roof && structuralRoom.test(part.name)
      && (!roomDetail.test(part.name) || /^sealed_/i.test(part.name))
      && horizontalOverlap(roofBox,aabb(part))>=0.52
      && aabb(part).min[1]<roofBox.min[1]
      && aabb(part).max[1]>=roofBox.min[1]-0.08);
    if (alreadyClosed) continue;
    const support = parts.filter((part)=>part!==roof && supportSurface.test(part.name) && !/roof|window|glass/i.test(part.name))
      .filter((part)=>horizontalOverlap(roofBox,aabb(part))>=0.35 && aabb(part).max[1]<=roofBox.min[1]+0.08)
      .sort((a,b)=>aabb(b).max[1]-aabb(a).max[1])[0] || hull;
    if (!support) continue;
    const supportTop = aabb(support).max[1]-0.025;
    const height = Math.max(0.35,roofBox.min[1]-supportTop+0.05);
    const worldLength = (roofBox.max[0]-roofBox.min[0])*0.92;
    const worldBeam = (roofBox.max[2]-roofBox.min[2])*0.90;
    parts.push({
      name:`sealed_cabin_${roof.name.toLowerCase().replace(/[^a-z0-9]+/g,'_')}`,
      type:'tapered_box', dimensions:[worldBeam,height,worldLength],
      topDimensions:[worldBeam*0.90,worldLength*0.96],
      pos:[(roofBox.min[0]+roofBox.max[0])*0.5,supportTop+height*0.5,(roofBox.min[2]+roofBox.max[2])*0.5],
      rot:[0,Math.PI/2,0], color:wallColor,
    });
  }

  const cockpit = parts.find((part)=>/cockpit_windshield/i.test(part.name));
  if (cockpit && !parts.some((part)=>/cabin|bridge|superstructure|sealed_cockpit/i.test(part.name) && !/window|glass/i.test(part.name))) {
    const cb = aabb(cockpit);
    const deck = parts.filter((part)=>/deck|hull|platform/i.test(part.name))
      .filter((part)=>horizontalOverlap(cb,aabb(part))>0 && aabb(part).max[1]<=cb.max[1])
      .sort((a,b)=>aabb(b).max[1]-aabb(a).max[1])[0] || hull;
    if (deck) {
      const baseY = aabb(deck).max[1]-0.025;
      const height = Math.max(0.45,cb.max[1]-baseY+0.16);
      const worldLength = Math.max(1.2,(cb.max[0]-cb.min[0])*2.1);
      const worldBeam = Math.max(1.0,(cb.max[2]-cb.min[2])*0.94);
      parts.push({
        name:'sealed_cockpit_enclosure', type:'tapered_box',
        dimensions:[worldBeam,height,worldLength], topDimensions:[worldBeam*0.86,worldLength*0.82],
        pos:[(cb.min[0]+cb.max[0])*0.5-worldLength*0.18,baseY+height*0.5,(cb.min[2]+cb.max[2])*0.5],
        rot:[0,Math.PI/2,0], color:wallColor,
      });
    }
  }

  const glazing = parts.filter((part)=>/windshield|canopy_glass|side_window_(left|right|port|starboard)/i.test(part.name));
  const hasOpaqueRoom = parts.some((part)=>structuralRoom.test(part.name)
    && (!roomDetail.test(part.name) || /^sealed_/i.test(part.name)));
  if (glazing.length && !hasOpaqueRoom) {
    const glassBoxes = glazing.map(aabb);
    const glassBox = {
      min:[0,1,2].map((axis)=>Math.min(...glassBoxes.map((box)=>box.min[axis]))),
      max:[0,1,2].map((axis)=>Math.max(...glassBoxes.map((box)=>box.max[axis]))),
    };
    const top = parts.find((part)=>/^(bimini_top|canopy_top)$/i.test(part.name));
    const topBox = top ? aabb(top) : glassBox;
    const footprint = top ? topBox : glassBox;
    const support = parts.filter((part)=>/deck|platform|hull/i.test(part.name))
      .filter((part)=>horizontalOverlap(footprint,aabb(part))>0.15 && aabb(part).max[1]<=topBox.max[1])
      .sort((a,b)=>aabb(b).max[1]-aabb(a).max[1])[0] || hull;
    if (support) {
      const baseY = aabb(support).max[1]-0.025;
      const roofY = top ? topBox.min[1]+0.05 : glassBox.max[1]+0.12;
      const height = Math.max(0.45,roofY-baseY);
      const worldLength = Math.max(1.2,(footprint.max[0]-footprint.min[0])*0.94);
      const worldBeam = Math.max(1.0,(footprint.max[2]-footprint.min[2])*0.94);
      parts.push({
        name:'sealed_glazed_cabin_enclosure', type:'tapered_box',
        dimensions:[worldBeam,height,worldLength], topDimensions:[worldBeam*0.90,worldLength*0.90],
        pos:[(footprint.min[0]+footprint.max[0])*0.5,baseY+height*0.5,(footprint.min[2]+footprint.max[2])*0.5],
        rot:[0,Math.PI/2,0], color:wallColor,
      });
    }
  }
}

function applyWorldScale(parts, worldScale) {
  for (const p of parts) {
    const matrix = eulerAbsMatrix(p.rot || [0,0,0]);
    const localScale = [0,1,2].map((axis)=>matrix[0][axis]*worldScale[0]+matrix[1][axis]*worldScale[1]+matrix[2][axis]*worldScale[2]);
    p.pos = p.pos.map((v,i)=>v*worldScale[i]);
    if (p.dimensions) p.dimensions = p.dimensions.map((v,i)=>v*localScale[i]);
    if (p.topDimensions) p.topDimensions = [p.topDimensions[0]*localScale[0],p.topDimensions[1]*localScale[2]];
    if (p.type === 'ellipsoid_sphere' || p.type === 'hemisphere_dome') p.radii = p.radii.map((v,i)=>v*localScale[i]);
    else if (p.radii) p.radii = p.radii.map((v)=>v*(localScale[0]+localScale[2])/2);
    if (Number.isFinite(p.height)) p.height *= localScale[1];
    if (Number.isFinite(p.radius)) p.radius *= (localScale[0]+localScale[2])/2;
    if (Number.isFinite(p.tube)) p.tube *= (localScale[0]+localScale[1]+localScale[2])/3;
  }
  for (const p of parts) {
    if (!/mast|funnel|stack|periscope/i.test(p.name) || !/cylinder|conical_frustum/.test(p.type)) continue;
    p.rot = [0,0,0];
    const radius = Math.max(...(p.radii || [p.radius || 0]).map((value)=>Math.abs(Number(value)||0)));
    p.height = Math.max(Number(p.height)||0,radius*2.4);
  }
  const minY = Math.min(...parts.map((p)=>aabb(p).min[1]));
  for (const p of parts) p.pos[1] -= minY;
}

function scalePartsToSize(parts, targetSize) {
  const before = parts.map(aabb);
  const lo = [0,1,2].map((i)=>Math.min(...before.map((b)=>b.min[i])));
  const hi = [0,1,2].map((i)=>Math.max(...before.map((b)=>b.max[i])));
  const measured = hi.map((v,i)=>Math.max(EPS,v-lo[i]));
  const worldScale = targetSize.map((v,i)=>v/measured[i]);
  applyWorldScale(parts,worldScale);
  return { measured, worldScale };
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
  old.parts = old.parts.filter((part)=>!GENERATED_SHIP_DETAIL_RE.test(part.name));
  const baselinePath = join(dir.replace(/_v6$/,''),'model.json');
  const baselineLength = existsSync(baselinePath) ? Math.max(...readJson(baselinePath).bounds.size.filter((_,i)=>i!==1)) : 0;
  const repaired = isSubmarine(old) ? repairSubmarine(old,baselineLength) : repairSurfaceShip(old);
  addShipClassDetails(repaired.parts,row,old);
  sealShipCabins(repaired.parts);
  const detailBounds = repaired.parts.map(aabb);
  const measuredSize = [0,1,2].map((i)=>Math.max(...detailBounds.map((b)=>b.max[i]))-Math.min(...detailBounds.map((b)=>b.min[i])));
  const scaleSpec = resolveShipScale(row,old,measuredSize);
  scalePartsToSize(repaired.parts,scaleSpec.size);
  repaired.changes.push(`實尺 ${scaleSpec.size.map((n)=>n.toFixed(1)).join('×')}m (${scaleSpec.confidence})`);
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
      metadata.realScale = { version:1, className:scaleSpec.className, targetSize:scaleSpec.size, confidence:scaleSpec.confidence, source:scaleSpec.source };
      writeFileSync(metadataPath, `${JSON.stringify(metadata,null,2)}\n`,'utf8');
    }
    row.bounds = built.bounds;
    row.triangles = built.bounds.triangles;
    row.realScale = { className:scaleSpec.className, targetSize:scaleSpec.size, confidence:scaleSpec.confidence };
    const entry = manifest.parts.find((p)=>(p.keys || (p.key ? [p.key] : [])).includes(row.key));
    if (entry) {
      entry.post = { ...(entry.post||{}), bounds:built.bounds.size, repair:'closed_hull_v2_real_scale', realScale:scaleSpec.size, scaleConfidence:scaleSpec.confidence };
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
