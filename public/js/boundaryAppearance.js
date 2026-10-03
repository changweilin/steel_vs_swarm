import { BOUNDARY_SURFACES } from './boundaryMeshData.js';
import { facetMeshData } from './vesselGeometry.js';
import { sceneryBoxData } from './sceneryAppearance.js';

const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const rgb = color => [16, 8, 0].map(shift => linear(((color >> shift) & 255) / 255));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const append = (out, data) => {
  const offset = out.vertices.length / 3;
  out.vertices.push(...data.vertices);
  out.colors.push(...data.colors);
  out.faces.push(...data.faces.map(i => i + offset));
};
const empty = () => ({ vertices: [], colors: [], faces: [] });
function faceted(data, angle = 30) {
  const result = facetMeshData(data, angle);
  result.colors = data.faces.flatMap(i => data.colors.slice(i * 3, i * 3 + 3));
  return result;
}

// Tile the authored face in physical metres; stretching a complete wall stretches its mortar too.
function facing(out, corners, colors, style) {
  const source = BOUNDARY_SURFACES.meshes[style];
  const crest = Math.max(...source.vertices.filter((_,i)=>i%3===2));
  const width = Math.hypot(...corners[1].map((v, i) => v - corners[0][i]));
  const height = Math.hypot(...corners[3].map((v, i) => v - corners[0][i]));
  const stone = style === 'ashlar';
  const rows = Math.max(1, Math.ceil(height / (stone ? 1.4 : 3)));
  const cols = Math.max(1, Math.ceil(width / (stone ? 3.5 : 4)));
  const point = (u, v) => mix(mix(corners[0], corners[1], u), mix(corners[3], corners[2], u), v);
  const color = (u, v) => mix(mix(colors[0], colors[1], u), mix(colors[3], colors[2], u), v);
  const a = corners[1].map((v, i) => v - corners[0][i]);
  const b = corners[3].map((v, i) => v - corners[0][i]);
  const normal = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const length = Math.hypot(...normal);
  if (length < 1e-9) return;
  for (let row = 0; row < rows; row++) {
    const cuts = [0, 1];
    for (let col = 1; col < cols + (stone && row % 2 ? 1 : 0); col++) {
      const u = (col - (stone && row % 2 ? .5 : 0)) / cols;
      if (u > 0 && u < 1) cuts.push(u);
    }
    cuts.sort((a, b) => a - b);
    for (let col = 0; col < cuts.length - 1; col++) {
      const offset = out.vertices.length / 3;
      for (let i = 0; i < source.vertices.length; i += 3) {
        const u = cuts[col] + (source.vertices[i] + .5) * (cuts[col + 1] - cuts[col]);
        const v = (row + source.vertices[i + 1] + .5) / rows;
        // Parent edges remain exact, while internal mortar recesses into the original envelope.
        const edge = u < 1e-9 || u > 1 - 1e-9 || v < 1e-9 || v > 1 - 1e-9;
        const inset = edge ? 0 : source.vertices[i + 2] - crest;
        out.vertices.push(...point(u, v).map((n, axis) => n + normal[axis] / length * inset));
        const tone = .96 + .04 * Math.sin(corners[0][0] * 1.7 + row * 2.8 + col * 4.1);
        out.colors.push(...color(u, v).map(n => n * source.shades[i / 3] * tone));
      }
      out.faces.push(...source.faces.map(i => i + offset));
    }
  }
}

export function boundarySectionAppearance(kind, data, sectionLength) {
  const style = kind === 'citywall' ? 'ashlar'
    : ['levee', 'seawall', 'canalbank', 'barricade'].includes(kind) ? 'concrete' : null;
  if (!style) return data;
  const out = empty(), vertex = i => data.vertices.slice(i * 3, i * 3 + 3);
  const color = i => data.colors.slice(i * 3, i * 3 + 3);
  for (let i = 0; i < data.faces.length; i += 6) {
    const [a, b, d, , c] = data.faces.slice(i, i + 6);
    // Only longitudinal, raised faces receive tiles; bottom faces and caps retain their topology.
    if (d === a + sectionLength && c === b + sectionLength
      && Math.abs(vertex(b)[1] - vertex(a)[1]) > .05) {
      facing(out, [vertex(b), vertex(c), vertex(d), vertex(a)], [color(b), color(c), color(d), color(a)], style);
    } else {
      const indices = data.faces.slice(i, i + 6), offset = out.vertices.length / 3;
      out.vertices.push(...indices.flatMap(vertex));
      out.colors.push(...indices.flatMap(color));
      out.faces.push(...indices.map((_, k) => offset + k));
    }
  }
  return faceted(out);
}

function boxSurface(size, color, style) {
  const [w,h,d] = size.map(n => n/2), out = empty(), colors = Array(4).fill(rgb(color));
  facing(out, [[-w,-h,d],[w,-h,d],[w,h,d],[-w,h,d]], colors, style);
  facing(out, [[w,-h,-d],[-w,-h,-d],[-w,h,-d],[w,h,-d]], colors, style);
  const vertices = [-w,-h,-d,w,-h,-d,w,h,-d,-w,h,-d,-w,-h,d,w,-h,d,w,h,d,-w,h,d];
  append(out, { vertices, colors: Array.from({length:8},()=>rgb(color)).flat(),
    faces: [0,4,7,0,7,3,5,1,2,5,2,6,3,7,6,3,6,2,0,1,5,0,5,4] });
  return faceted(out);
}

const masonry = new Set(['wall-course','barbican-wall','watchtower','buffer-wall']);
const concrete = new Set(['gate-pier','wing-wall','buffer-levee','fallen-deck','deck-girder','deck-parapet']);
const chamfer = new Set(['battlement','course-joint','gate-arch','gate-frame','gate-hoist','gate-bridge','gate-leaf','barbican-gate']);
export function applyBoundaryAppearance(parts) {
  return parts.map(part => {
    if (part.g[0] !== 'box') return part;
    const size = part.g.slice(1,4);
    let data;
    if (part.boundarySurface) {
      const source = BOUNDARY_SURFACES.meshes[part.boundarySurface];
      data = faceted({ vertices: source.vertices.map((v,i)=>v*size[i%3]), faces: source.faces,
        colors: source.shades.flatMap(t=>rgb(part.c).map(n=>n*t)) });
    } else if (masonry.has(part.role) || concrete.has(part.role)) {
      data = boxSurface(size, part.c, masonry.has(part.role) ? 'ashlar' : 'concrete');
    } else if (chamfer.has(part.role)) {
      data = sceneryBoxData(size);
      data.colors = Array.from({length:data.vertices.length/3},()=>rgb(part.c)).flat();
    } else return part;
    return { ...part, g: ['mesh', data, size], c: null };
  });
}

export function boundaryTetrapodMesh(name, dimensions, color, tipRatio = null) {
  const source = BOUNDARY_SURFACES.meshes[name];
  const tipRadius = tipRatio == null ? null : Math.max(...source.vertices.flatMap((_,i)=>
    i%3===0 && source.vertices[i+1]===.5 ? [Math.hypot(source.vertices[i],source.vertices[i+2])] : []));
  const vertices = source.vertices.map((v, i) => {
    if (tipRatio == null || i % 3 === 1) return v * dimensions[i % 3];
    const start = Math.floor(i / 3) * 3, t = source.vertices[start + 1] + .5;
    const radial = Math.hypot(source.vertices[start], source.vertices[start + 2]);
    const fillet = Math.min(1, radial / (.5*(1-t) + tipRadius*t));
    const radius = (.5*(1-t) + tipRatio*.5*t) * fillet;
    return v / radial * radius * dimensions[i % 3];
  });
  return faceted({ vertices, faces: source.faces, colors: source.shades.flatMap(t=>rgb(color).map(n=>n*t)) }, 40);
}

const wrap = n => ((n % 1) + 1) % 1;
export function boundaryRockHeight(y, x, z, h) {
  if (y <= 0) return y;
  const { side, period, values } = BOUNDARY_SURFACES.relief;
  const u = wrap(x / period) * (side - 1), v = wrap(z / period) * (side - 1);
  const ix = Math.floor(u), iz = Math.floor(v), fx = u - ix, fz = v - iz;
  const a = values[iz*side+ix]*(1-fx)+values[iz*side+ix+1]*fx;
  const b = values[(iz+1)*side+ix]*(1-fx)+values[(iz+1)*side+ix+1]*fx;
  const relief = a*(1-fz)+b*fz;
  return y - Math.min(.8, h*.04) * relief * Math.min(1,y/1.5) * (1-y/h);
}

export function boundaryGeologySurface(kind, len, depth, bufferDepth) {
  if (kind !== 'cliff') return boundaryRockHeight;
  const section = BOUNDARY_SURFACES.sections.cliff;
  const crest = section.find(p=>p[1]===1)[0] * depth;
  return (y,x,z,h) => {
    const smooth = value => { const t=Math.max(0,Math.min(1,value)); return t*t*(3-2*t); };
    const ends = Math.min(smooth((x+len/2)/(len*.18)),smooth((len/2-x)/(len*.18)));
    let level=0;
    for(let i=1;i<section.length;i++) {
      const [a,ha]=section[i-1],[b,hb]=section[i], v=z/depth;
      if(v>=a && v<=b) {level=ha+(hb-ha)*(v-a)/(b-a);break;}
    }
    // The authored scarp continues over the body/buffer split; only the outer perimeter tapers.
    if(bufferDepth>0 && z<crest) level=(.9+.1*smooth((z+depth/2+bufferDepth)/(depth*.3)))
      *smooth((z+depth/2+bufferDepth)/(depth*.3));
    const rise=h*level*ends*(.86+.14*y/h);
    return boundaryRockHeight(rise,x,z,h);
  };
}

export function boundaryRockAppearance(data) {
  const strata = BOUNDARY_SURFACES.strata;
  const colors = data.vertices.flatMap((v,i) => {
    if (i % 3 !== 0) return [];
    const y = data.vertices[i+1], band = Math.floor(y/1.8 + v*.035);
    const tone = strata[((band % strata.length) + strata.length) % strata.length];
    return data.colors.slice(i,i+3).map(n=>n*tone);
  });
  return faceted({ ...data, colors }, 28);
}
