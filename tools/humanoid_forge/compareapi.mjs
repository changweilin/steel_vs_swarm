// ============ 機體三版本比對與複雜度 API (dev-only) ============
// 支援本專案 (steel_vs_swarm)、steel_v_swarm (Godot)、argon blender vfx (Blender 高精) 三版本比對。
//
// 契約:
//   GET /api/compare/complexity?id=<id>  回傳三版本的建模組成複雜度統計 (JSON)
//   GET /api/compare/glb?ver=<ver>&id=<id>  串流提供 GLB 檔案 (model/gltf-binary)
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../audit_src.mjs';

export const PATHS = {
  current: ROOT,
  steel_v_swarm: 'C:\\Users\\user\\Documents\\app\\steel_v_swarm',
  argon_vfx: 'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\argon blender vfx',
  argon_npc: 'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\argon blender npc',
  argon_build: 'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\argon blender build',
};

function parseGLB(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  let vertCount = 0, triCount = 0, primCount = 0;
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      primCount++;
      if (prim.indices != null && gltf.accessors[prim.indices]) {
        triCount += Math.floor(gltf.accessors[prim.indices].count / 3);
      }
      if (prim.attributes?.POSITION != null && gltf.accessors[prim.attributes.POSITION]) {
        vertCount += gltf.accessors[prim.attributes.POSITION].count;
      }
    }
  }
  const animations = (gltf.animations || []).map((a) => a.name);
  return {
    fileSize: buf.length,
    meshCount: (gltf.meshes || []).length,
    primCount,
    vertCount,
    triCount,
    nodeCount: (gltf.nodes || []).length,
    materialCount: (gltf.materials || []).length,
    animations,
  };
}

const COMPLEXITY_CACHE = new Map();

export async function getComplexity(rawId) {
  const id = (rawId || '').split('@')[0];
  if (!id) return null;
  if (COMPLEXITY_CACHE.has(id)) return COMPLEXITY_CACHE.get(id);

  const res = {
    id,
    current: null,
    steel_v_swarm: null,
    argon_vfx: null,
  };

  // 1. 本專案 (steel_vs_swarm): forge 零件檔 (hero assets 或 factionAssets)
  try {
    let modPath = join(ROOT, 'public', 'js', 'forge', 'assets', `${id}.js`);
    let isFaction = false;
    if (!existsSync(modPath)) {
      const fPath = join(ROOT, 'public', 'js', 'forge', 'factionAssets', `${id}.js`);
      if (existsSync(fPath)) {
        modPath = fPath;
        isFaction = true;
      }
    }
    if (existsSync(modPath)) {
      const mod = isFaction
        ? await import(`../../public/js/forge/factionAssets/${id}.js`)
        : await import(`../../public/js/forge/assets/${id}.js`);
      const asset = mod.default;
      let parts = 0, verts = 0, tris = 0;
      for (const m of asset.meshes || []) {
        parts += (m.parts || []).length;
        verts += (m.positions?.length || 0) / 3;
        tris += (m.indices?.length || 0) / 3;
      }
      const st = await stat(modPath).catch(() => null);
      res.current = {
        name: '本專案 (steel_vs_swarm)',
        arch: isFaction ? '陣營具名零件組裝 (JS Module)' : '程序化具名零件組裝 (JS Module)',
        path: isFaction ? `public/js/forge/factionAssets/${id}.js` : `public/js/forge/assets/${id}.js`,
        fileSize: st ? st.size : 0,
        parts,
        meshCount: (asset.meshes || []).length,
        primCount: (asset.meshes || []).length,
        vertCount: verts,
        triCount: tris,
        nodeCount: (asset.joints || []).length,
        jointCount: (asset.joints || []).length,
        materialCount: Object.keys(asset.materials || {}).length,
        animations: isFaction
          ? ['idle', 'walk', 'run', 'fire / aim (rig/weapon)']
          : ['idle', 'walk', 'run', 'light', 'heavy', 'skill', 'ult', 'morph (locomotion.js)'],
      };
    } else if (id.startsWith('guer_') || id.startsWith('mili_')) {
      res.current = {
        name: '本專案 (steel_vs_swarm)',
        arch: '第三方程序化動態裝配 (Three.js procedural rig)',
        path: 'public/js/npcModels.js',
        fileSize: 0,
        parts: 10,
        meshCount: 6,
        primCount: 6,
        vertCount: 420,
        triCount: 280,
        nodeCount: 6,
        jointCount: 6,
        materialCount: 4,
        animations: ['idle', 'walk', 'run', 'fire / aim'],
      };
    }
  } catch (err) {
    res.current = { error: String(err?.message || err) };
  }

  // 2. steel_v_swarm (Godot 專案戰鬥模型)
  try {
    const pCombat = join(PATHS.steel_v_swarm, 'assets', 'models', 'combat', `${id}.glb`);
    const pFaction = join(PATHS.steel_v_swarm, 'assets', 'models', 'factions', `${id}.glb`);
    const pRef = join(PATHS.steel_v_swarm, 'assets', 'models', 'reference', `${id}.glb`);
    const p = existsSync(pFaction) ? pFaction : (existsSync(pCombat) ? pCombat : (existsSync(pRef) ? pRef : null));
    if (p) {
      const buf = await readFile(p);
      const meta = parseGLB(buf);
      res.steel_v_swarm = {
        name: 'steel_v_swarm (Godot)',
        arch: '遊戲最佳化 GLB 戰鬥模型',
        path: p.replace(PATHS.steel_v_swarm, 'app/steel_v_swarm').replace(/\\/g, '/'),
        ...meta,
      };
    } else {
      res.steel_v_swarm = {
        name: 'steel_v_swarm (Godot)',
        status: 'none',
        arch: '無專案 GLB 模型',
        path: 'app/steel_v_swarm/',
        fileSize: 0,
        triCount: 0,
        vertCount: 0,
        meshCount: 0,
        primCount: 0,
        nodeCount: 0,
        materialCount: 0,
        animations: [],
      };
    }
  } catch (err) {
    res.steel_v_swarm = { error: String(err?.message || err) };
  }

  // 3. argon blender (Blender 高精 VFX / NPC / 建築 模型)
  try {
    const pBuild = join(PATHS.argon_build, `${id}.glb`);
    const pNpc = join(PATHS.argon_npc, `${id}.glb`);
    const pVfx = join(PATHS.argon_vfx, `${id}.glb`);
    const isBuild = existsSync(pBuild) || id.endsWith('_base') || id.endsWith('_tower') || id.endsWith('_bunker');
    const isNpcPath = isBuild || existsSync(pNpc) || id.includes('_');
    const p = existsSync(pBuild) ? pBuild : (existsSync(pNpc) ? pNpc : (existsSync(pVfx) ? pVfx : null));
    const targetName = isBuild ? 'argon blender build' : (isNpcPath ? 'argon blender npc' : 'argon blender vfx');
    const targetRelPath = isBuild
      ? `tools/ai3d/argon blender build/${id}.glb`
      : (isNpcPath ? `tools/ai3d/argon blender npc/${id}.glb` : `tools/ai3d/argon blender vfx/${id}.glb`);
    if (p) {
      const buf = await readFile(p);
      const meta = parseGLB(buf);
      res.argon_vfx = {
        name: targetName,
        arch: 'Blender 原生高精模型 (GLB)',
        path: targetRelPath,
        ...meta,
      };
    } else {
      res.argon_vfx = {
        name: targetName,
        arch: isNpcPath ? 'Blender 原生高精模型 (GLB - 檔案待後續補上)' : 'Blender 原生高精 VFX 模型 (GLB)',
        path: targetRelPath,
        status: 'pending',
      };
    }
  } catch (err) {
    res.argon_vfx = { error: String(err?.message || err) };
  }

  COMPLEXITY_CACHE.set(id, res);
  return res;
}

export async function getGLB(verKey, rawId) {
  const id = (rawId || '').split('@')[0];
  if (!id) return null;

  let filePath = null;
  if (verKey === 'steel_v_swarm') {
    const pFaction = join(PATHS.steel_v_swarm, 'assets', 'models', 'factions', `${id}.glb`);
    const pCombat = join(PATHS.steel_v_swarm, 'assets', 'models', 'combat', `${id}.glb`);
    const pRef = join(PATHS.steel_v_swarm, 'assets', 'models', 'reference', `${id}.glb`);
    filePath = existsSync(pFaction) ? pFaction : (existsSync(pCombat) ? pCombat : (existsSync(pRef) ? pRef : null));
  } else if (verKey === 'argon_vfx' || verKey === 'argon_npc' || verKey === 'argon_build') {
    const pBuild = join(PATHS.argon_build, `${id}.glb`);
    const pNpc = join(PATHS.argon_npc, `${id}.glb`);
    const pVfx = join(PATHS.argon_vfx, `${id}.glb`);
    filePath = existsSync(pBuild) ? pBuild : (existsSync(pNpc) ? pNpc : (existsSync(pVfx) ? pVfx : null));
  } else if (verKey === 'current_combat') {
    filePath = join(PATHS.current, 'public', 'assets', 'models', 'combat', `${id}.glb`);
  }
  if (!filePath || !existsSync(filePath)) return null;
  return readFile(filePath);
}

export async function handleCompareApi(req, res, send) {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/compare/complexity') {
    const id = u.searchParams.get('id');
    const comp = await getComplexity(id);
    if (!comp) {
      send(400, JSON.stringify({ error: 'Missing or invalid id' }), 'application/json');
      return true;
    }
    send(200, JSON.stringify(comp), 'application/json');
    return true;
  }

  if (u.pathname === '/api/compare/glb') {
    const ver = u.searchParams.get('ver');
    const id = u.searchParams.get('id');
    const buf = await getGLB(ver, id);
    if (!buf) {
      send(404, 'GLB Not Found');
      return true;
    }
    res.writeHead(200, {
      'content-type': 'model/gltf-binary',
      'content-length': buf.length,
      'cache-control': 'public, max-age=3600',
    });
    res.end(buf);
    return true;
  }

  return false;
}
