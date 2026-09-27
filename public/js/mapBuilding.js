// Shared building identity, durability, and rubble geometry. No renderer or transport state.
import { UNITS, SCENE_STRUCT } from './data.js';

export const MAP_BUILDING = Object.freeze({ RUBBLE_H: 0.18, ARMOR: 18 });
export const mapBuildingId = (key) => `building:${key}`;
export const buildingNear = (b,x,z,r) => Math.hypot(b.x-x,b.z-z) < r+Math.hypot(b.w,b.d)/2;
export function mapBuildingHp(width, depth, height) {
  const mass = Math.cbrt(Math.max(1, width * depth * height));
  return Math.round(UNITS.base.hp * Math.min(SCENE_STRUCT.MAX_F, Math.max(0.15, mass / 24)));
}

export function buildingBounds(boxes) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes) {
    const c = Math.abs(Math.cos(b.ry || 0)), s = Math.abs(Math.sin(b.ry || 0));
    const rx = c * b.hw2 + s * b.hd2, rz = s * b.hw2 + c * b.hd2;
    minX = Math.min(minX, b.x-rx); maxX = Math.max(maxX, b.x+rx);
    minZ = Math.min(minZ, b.z-rz); maxZ = Math.max(maxZ, b.z+rz);
    minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y+b.h);
  }
  return { x: (minX+maxX)/2, z: (minZ+maxZ)/2, y: minY, w: maxX-minX, d: maxZ-minZ, h: maxY-minY };
}

export function collapseBuildingBoxes(boxes, baseY) {
  for (const b of boxes) {
    b.y = baseY + (b.y-baseY) * MAP_BUILDING.RUBBLE_H;
    b.h *= MAP_BUILDING.RUBBLE_H;
    if (Number.isFinite(b.ty)) b.ty = baseY + (b.ty-baseY) * MAP_BUILDING.RUBBLE_H;
    delete b.cl;
  }
}

/** Distance to the real oriented walls, including courtyards and multiple volumes. */
export function buildingDistance(boxes, x, z, y = null, roofs = []) {
  let best = Infinity;
  for (const b of boxes) {
    const c = Math.cos(b.ry || 0), s = Math.sin(b.ry || 0), dx = x-b.x, dz = z-b.z;
    const lx = dx*c-dz*s, lz = dx*s+dz*c;
    const dy = y == null ? 0 : Math.max(b.y-y, y-b.y-b.h, 0);
    best = Math.min(best, Math.hypot(Math.max(0,Math.abs(lx)-b.hw2), Math.max(0,Math.abs(lz)-b.hd2), dy));
  }
  for (const roof of roofs) {
    if (roof.active===false) continue;
    let horizontal=Infinity;
    if (insideRing(x,z,roof.outer) && !(roof.holes || []).some(h=>insideRing(x,z,h))) horizontal=0;
    else for (const ring of [roof.outer,...(roof.holes || [])]) {
      for (let i=0,j=ring.length-1; i<ring.length; j=i++) {
        const a=ring[j],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1];
        const f=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz || 1)));
        horizontal=Math.min(horizontal,Math.hypot(x-a[0]-dx*f,z-a[1]-dz*f));
      }
    }
    best=Math.min(best,Math.hypot(horizontal,y==null ? 0 : y-roof.y));
  }
  return best;
}

function insideRing(x,z,ring) {
  let hit=false;
  for (let i=0,j=ring.length-1; i<ring.length; j=i++) {
    const a=ring[i],b=ring[j];
    if ((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}

export function buildingRayHit(boxes, ax,ay,az,bx,by,bz,pad=0,verticalPad=pad) {
  let best=null;
  for (const b of boxes) {
    const c=Math.cos(b.ry || 0),s=Math.sin(b.ry || 0),ox=ax-b.x,oz=az-b.z,dx=bx-ax,dz=bz-az;
    let lo=0,hi=1;
    const axes=[[ox*c-oz*s,dx*c-dz*s,-b.hw2-pad,b.hw2+pad],
      [ox*s+oz*c,dx*s+dz*c,-b.hd2-pad,b.hd2+pad],[ay,by-ay,b.y-verticalPad,b.y+b.h+verticalPad]];
    for (const [o,d,min,max] of axes) {
      if (Math.abs(d)<1e-9) { if (o<min || o>max) { hi=-1; break; } continue; }
      const a=(min-o)/d,z=(max-o)/d;
      lo=Math.max(lo,Math.min(a,z)); hi=Math.min(hi,Math.max(a,z));
    }
    if (hi>=lo && (best==null || lo<best)) best=lo;
  }
  return best;
}

export function buildingRoofIndex(roofs, cell = 64) {
  const grid = new Map();
  for (const roof of roofs) {
    const xs = roof.outer.map(p=>p[0]), zs = roof.outer.map(p=>p[1]);
    for (let i=Math.floor(Math.min(...xs)/cell); i<=Math.floor(Math.max(...xs)/cell); i++) {
      for (let j=Math.floor(Math.min(...zs)/cell); j<=Math.floor(Math.max(...zs)/cell); j++) {
        const key = `${i},${j}`;
        if (!grid.has(key)) grid.set(key,[]);
        grid.get(key).push(roof);
      }
    }
  }
  return (ax,ay,az,bx,by,bz,ignoreA=null,ignoreB=null) => {
    if (Math.abs(by-ay)<1e-8) return null;
    let best = null;
    for (let i=Math.floor(Math.min(ax,bx)/cell); i<=Math.floor(Math.max(ax,bx)/cell); i++) {
      for (let j=Math.floor(Math.min(az,bz)/cell); j<=Math.floor(Math.max(az,bz)/cell); j++) {
        for (const p of grid.get(`${i},${j}`) || []) {
          if (p.active===false || p.buildingKey===ignoreA || p.buildingKey===ignoreB) continue;
          const f=(p.y-ay)/(by-ay);
          if (f<0 || f>1 || (best && f>=best.f)) continue;
          const x=ax+(bx-ax)*f,z=az+(bz-az)*f;
          if (!insideRing(x,z,p.outer) || (p.holes || []).some(h=>insideRing(x,z,h))) continue;
          best={ f,key:p.buildingKey };
        }
      }
    }
    return best;
  };
}
