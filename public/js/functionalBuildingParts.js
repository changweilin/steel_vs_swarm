import { mat3FromEulerXYZ } from './partTransform.js';
import { architecturalRoofParts } from './architectureRoofParts.js';
import { FUNCTIONAL_DETAIL_LIMIT } from './functionalArchitectureCatalog.js';

// Semantic ornament uses the existing part format. Roof patches require a caller-validated convex site.
export function functionalBuildingParts(edges, baseY, topY, style, roofSite = null, roofHalf = 0, roofBudget = 12) {
  const design = style?.functionalDesign;
  if (!design || !edges.length) return { parts: [], replacesRoof: false };
  const parts = [], motif = design.motif;
  const add = (g, p, c, role, r = [0, 0, 0]) => {
    if (parts.length < FUNCTIONAL_DETAIL_LIMIT) parts.push({ g, p, c, role: `function-${role}`, r, colorVariant: style.variant });
  };
  const front = edges.reduce((a, b) => a.hw2 >= b.hw2 ? a : b);
  const fronts = edges.filter(edge => edge.hw2 >= front.hw2 * 0.9 && Math.abs(Math.cos(edge.ry - front.ry)) > 0.99).slice(0, 2);
  const w = Math.min(front.hw2 * 1.3, 10), h = Math.min(topY - baseY, 5);
  const facade = (g, x, y, c, role, depth = 0.12) => {
    // Both wall faces work for either polygon winding; thickness stays within existing facade trim depth.
    for (const edge of fronts) for (const side of [-1, 1]) {
      const ca = Math.cos(edge.ry), sa = Math.sin(edge.ry), z = side * (edge.hd2 + depth);
      add(g, [edge.x + x * ca - z * sa, baseY + y, edge.z + x * sa + z * ca], c, role, [0, -edge.ry, 0]);
    }
  };
  facade(['box', w, Math.min(0.5, h * 0.12), 0.2], 0, h * 0.92, style.trim, 'entrance-lintel');
  const cross = (emit, x, y, size, color, role) => {
    emit(['box', size * 0.2, size, size * 0.15], x, y, color, role);
    emit(['box', size * 0.68, size * 0.2, size * 0.15], x, y + size * 0.16, color, role);
  };
  if (motif === 'hospital') {
    facade(['box', Math.min(w, 3.2), h * 0.7, 0.15], 0, h * 0.51, 0xe7f1ed, 'medical-panel');
    cross(facade, 0, h * 0.51, h * 0.5, 0x328485, 'medical-cross');
  } else if (['church', 'orthodox'].includes(motif)) {
    cross(facade, 0, h * 0.5, h * 0.55, style.trim, 'christian-cross');
  } else if (motif === 'synagogue') {
    // Paired tablets distinguish the facade without assigning a regional Christian symbol.
    for (const sign of [-1, 1]) facade(['box', w * 0.18, h * 0.5, 0.2], sign * w * 0.12, h * 0.5, style.trim, 'tablets');
  } else if (motif === 'library') {
    for (let i = 0; i < 5; i++) facade(['box', w * 0.11, h * (0.35 + (i % 3) * 0.08), 0.22], (i - 2) * w * 0.16, h * 0.48, i % 2 ? style.roof : style.trim, 'book-spines');
  } else if (['civic', 'museum'].includes(motif)) {
    for (let i = 0; i < 6; i++) facade(['box', w * 0.055, h * 0.78, 0.3], (i - 2.5) * w * 0.17, h * 0.42, style.trim, 'portico-column');
    if (motif === 'museum') facade(['box', w * 0.25, h * 0.32, 0.24], 0, h * 0.48, style.roof, 'exhibition-panel');
  } else if (motif === 'station') {
    facade(['box', w * 0.8, h * 0.3, 0.22], 0, h * 0.55, style.roof, 'station-board');
    for (let i = -1; i <= 1; i++) facade(['box', w * 0.17, h * 0.04, 0.25], i * w * 0.22, h * 0.55, 0xe8e2cf, 'departure-board');
  } else if (motif === 'school') {
    for (let i = 0; i < 5; i++) facade(['box', w * 0.14, h * 0.52, 0.18], (i - 2) * w * 0.19, h * 0.45, i % 2 ? style.trim : style.roof, 'campus-bay');
  } else if (['factory', 'warehouse', 'energy', 'thermal', 'hydro', 'wind', 'solar', 'nuclear', 'substation', 'water'].includes(motif)) {
    for (const sign of [-1, 1]) {
      facade(['box', w * 0.34, h * 0.75, 0.15], sign * w * 0.24, h * 0.4, 0x58646b, 'loading-door');
      for (let i = 1; i < 5; i++) facade(['box', w * 0.32, 0.05, 0.2], sign * w * 0.24, h * i * 0.15, style.trim, 'door-slat');
    }
  } else if (['temple', 'shrine', 'mandir', 'pagoda', 'stupa', 'gurdwara', 'mosque', 'square_minaret'].includes(motif)) {
    for (const sign of [-1, 1]) facade(['box', w * 0.08, h * 0.8, 0.26], sign * w * 0.42, h * 0.4, style.trim, 'sanctuary-column');
    if (motif === 'shrine') {
      facade(['box', w, h * 0.1, 0.28], 0, h * 0.8, style.trim, 'torii-crossbeam');
      facade(['box', w * 1.05, h * 0.1, 0.28], 0, h * 0.96, style.roof, 'torii-cap');
    }
  }
  if (!roofSite || roofHalf < 0.8 || roofBudget < 0.3) return { parts, replacesRoof: false };
  const [cx, cz] = roofSite, r = roofHalf * 0.7, roofStart = parts.length;
  const roof = (g, x, y, z, color, role, rotation = [0, 0, 0]) => add(g, [cx + x, topY + y, cz + z], color, role, rotation);
  const block = (w, height, d, x, y, z, color, role) => roof(['box', w, height, d], x, y + height / 2, z, color, role);
  const cylinder = (radius, height, x, y, z, color, role, topRadius = radius, segments = 12) => roof(['cyl', topRadius, radius, height, segments], x, y + height / 2, z, color, role);
  const patch = (form, x, z, width, depth, y = 0) => {
    const poly = { outer: [[x-width/2,z-depth/2],[x+width/2,z-depth/2],[x+width/2,z+depth/2],[x-width/2,z+depth/2]].map(([px,pz]) => [cx+px,cz+pz]), holes: [] };
    for (const part of architecturalRoofParts(poly, topY + y, style, form, null, Math.min(12, topY-baseY))) {
      if (parts.length < FUNCTIONAL_DETAIL_LIMIT) parts.push({ ...part, role: `function-${motif}-roof` });
    }
  };
  const religious = ['temple','shrine','mandir','pagoda','stupa','gurdwara','church','orthodox','synagogue','mosque','square_minaret'].includes(motif);
  if (['mosque', 'square_minaret', 'gurdwara', 'orthodox', 'stupa'].includes(motif)) {
    cylinder(r * 0.63, r * 0.3, 0, 0, 0, style.wall, 'dome-drum');
    if (motif !== 'square_minaret') patch('dome', 0, 0, r * 1.26, r * 1.26, r * 0.3);
    const count = motif === 'stupa' ? 0 : motif === 'square_minaret' ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const x = (i ? 1 : -1) * r, z = -r * 0.65;
      if (motif === 'square_minaret') block(r * 0.4, r * 2, r * 0.4, x, 0, z, style.wall, 'square-minaret');
      else cylinder(r * 0.16, r * 1.65, x, 0, z, style.wall, motif === 'mosque' ? 'minaret-shaft' : 'cupola-shaft');
      cylinder(r * 0.24, r * 0.12, x, r * 1.35, z, style.trim, 'tower-balcony');
      if (motif === 'orthodox' || motif === 'gurdwara') patch('dome', x, z, r * 0.55, r * 0.55, r * 1.65);
      else cylinder(r * 0.23, r * 0.5, x, r * 1.65, z, style.roof, 'tower-cap', 0);
    }
    cylinder(r * 0.05, r * 0.4, 0, r * 0.9, 0, style.trim, 'finial');
    if (motif === 'orthodox') {
      const emit = (g, x, y, color, role) => roof(g, x, y, 0, color, role);
      cross(emit, 0, r * 1.35, r * 0.45, style.trim, 'christian-cross');
    }
  } else if (['temple', 'shrine', 'pagoda', 'mandir'].includes(motif)) {
    const tiers = motif === 'pagoda' ? 3 : motif === 'mandir' ? 4 : 2;
    for (let i = 0; i < tiers; i++) {
      const size = r * 1.8 * Math.pow(0.72, i), y = i * r * 0.6;
      block(size * 0.68, r * 0.42, size * 0.68, 0, y, 0, style.wall, 'tier-body');
      patch(motif === 'mandir' ? 'spire' : style.roofForm, 0, 0, size, size * 0.8, y + r * 0.42);
      for (const sign of [-1, 1]) block(size * 0.12, r * 0.1, size * 0.82, sign * size * 0.3, y + r * 0.3, 0, style.trim, 'eave-bracket');
    }
  } else if (motif === 'church') {
    patch(style.roofForm, r * 0.3, 0, r * 1.2, r * 1.55);
    block(r * 0.65, r * 1.35, r * 0.65, -r * 0.7, 0, 0, style.wall, 'bell-tower');
    patch('spire', -r * 0.7, 0, r * 0.7, r * 0.7, r * 1.35);
    const emit = (g, x, y, color, role) => roof(g, x, y, 0, color, role);
    cross(emit, -r * 0.7, r * 2.2, r * 0.5, style.trim, 'christian-cross');
  } else if (motif === 'synagogue') patch('vault', 0, 0, r * 1.8, r * 1.4);
  else if (['station', 'school', 'library', 'museum', 'civic', 'warehouse', 'factory'].includes(motif)) {
    if (motif === 'station') patch('vault', 0, 0, r * 1.9, r * 1.5);
    else if (motif === 'factory') {
      for (const x of [-r * 0.6, r * 0.6]) cylinder(r * 0.15, r * 1.7, x, 0, 0, style.trim, 'vent-stack');
    } else if (motif === 'museum' || motif === 'library') {
      for (const x of [-r * 0.55, r * 0.55]) block(r * 0.55, r * 0.18, r * 1.5, x, 0, 0, 0x769aa4, 'gallery-skylight');
    } else if (motif === 'civic' || motif === 'school') {
      cylinder(r * 0.03, r * 1.5, 0, 0, 0, style.trim, 'flagpole');
      block(r * 0.55, r * 0.3, r * 0.04, r * 0.27, r * 1.1, 0, style.roof, 'civic-banner');
    }
  } else if (motif === 'solar') {
    for (let i = -1; i <= 1; i++) block(r * 1.7, r * 0.12, r * 0.45, 0, r * 0.12, i * r * 0.6, 0x284f70, 'solar-panel');
  } else if (motif === 'wind') {
    cylinder(r * 0.06, r * 1.7, 0, 0, 0, style.trim, 'turbine-mast');
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      roof(['box', r * 0.1, r, r * 0.08], Math.sin(a) * r * 0.5, r * 1.7 + Math.cos(a) * r * 0.5, 0, style.wall, 'turbine-blade', [0, 0, -a]);
    }
  } else if (['energy', 'thermal', 'nuclear', 'water', 'hydro', 'substation', 'hospital'].includes(motif)) {
    for (const x of [-r * 0.55, r * 0.55]) {
      if (motif === 'substation') {
        block(r * 0.7, r * 0.6, r * 0.8, x, 0, 0, style.trim, 'transformer');
        for (const z of [-r * 0.25, r * 0.25]) cylinder(r * 0.09, r * 0.5, x, r * 0.6, z, 0x625646, 'insulator');
      } else if (motif === 'water' || motif === 'hydro') cylinder(r * 0.4, r * 0.3, x, 0, 0, 0x608e9b, 'water-tank');
      else if (motif === 'thermal') cylinder(r * 0.15, r * 2, x, 0, 0, style.trim, 'plant-stack');
      else if (motif === 'nuclear') cylinder(r * 0.4, r, x, 0, 0, style.wall, 'cooling-tower', r * 0.28);
      else block(r * 0.6, r * 0.35, r * 0.8, x, 0, 0, style.trim, 'ventilation-unit');
    }
  }
  // Uniform compression preserves joints when a tagged building is already near the world cap.
  const roofs = parts.slice(roofStart);
  const halfHeight = part => {
    const dims = part.g[0] === 'mesh' ? part.g[2] : part.g[0] === 'box' ? part.g.slice(1, 4)
      : [2 * Math.max(part.g[1], part.g[2]), part.g[3], 2 * Math.max(part.g[1], part.g[2])];
    const matrix = mat3FromEulerXYZ(part.r);
    return dims.reduce((sum, value, i) => sum + Math.abs(matrix[3 + i]) * value / 2, 0);
  };
  const rise = roofs.reduce((max, p) => Math.max(max, p.p[1] - topY + halfHeight(p)), 0);
  if (rise > roofBudget) for (const part of roofs) {
    const scale = roofBudget / rise;
    part.p = [cx + (part.p[0] - cx) * scale, topY + (part.p[1] - topY) * scale, cz + (part.p[2] - cz) * scale];
    part.s = [scale, scale, scale];
  }
  return { parts, replacesRoof: religious && roofs.length > 0 };
}
