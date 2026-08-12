// 地貌界線拼圖截圖組(2026-08-11)—— node tools/shot_borders.mjs
// 前置:本 worktree 的伺服器在跑(node server/server.js --port 8641);Playwright 借 mapping_elf 的安裝。
// 用法:node tools/shot_borders.mjs [--port 8641] [--out DIR] [--w 400] [--h 300] [--only green|bare]
//
// 「所有地貌排列組合的截圖」:26 種底毯地表兩兩共 325 組,逐組一張實拍。
// 真品路徑(這是本工具唯一有意義的理由):場景一律由 public/js/ground.js 的 buildGroundCover
// 建 —— 真材質、真畫筆、真 planBorderPuzzle,不另寫一份鏡射渲染。
//
// 怎麼讓「指定的兩種地表」同框:底毯款式由 cellSubAt 的低頻值雜訊沿世界座標挑(波長 ~166m;
// 2026-08-12 起取值點量化成**選款區塊** carpetLotAt ⇒ 一塊色至少一個 lot 寬,而相鄰區塊的索引
// 可以跳不只 1 格 —— 自然可達的組合因此變多,但同一顆種子上換得比較慢),
// 消費端無從指定 —— 所以**不指定**:每個分區對建一座夠大的場地(左右各一個分區),讓兩側
// 自然把該分區的款式整批鋪出來,再從**真的建出來的網格**找「哪兩款在哪裡相鄰」下鏡頭。
// 取樣點 = carpet mesh 的逐格中心頂點(emitCell 每格 9 頂點,index%9===4 = G[4] 中心),
// 不是重算一份幾何。分界線種類雙向核對:畫面附近真的有哪種 border mesh(userData.gborder)
// vs borderKindOf 的預測 —— 不一致在報表標 MISMATCH。
//
// 地形剖面的兩個必要條件(不滿足就拍不到那個分區):
//   ① alpine 由**相對高程**觸發(cellZoneAt 需 relief>40 且 hC>hMin+relief*0.62)⇒ 高地側
//      給 50m 平台、對側緩降到 4m(降幅 46m / 220m ⇒ 坡度 0.21 < 強制裸地門檻 0.28);
//      urban/water/wet 不吃高程晉升 ⇒ 界線落在 x=0,green/bare 會晉升 ⇒ 界線落在等高線上。
//   ② water/wet 走 envCode(與伺服器遮罩同一規則),不是 classifyPure;深水需 h < waterY-2.5。
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { readSrc } from './audit_src.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = arg('--port', '8641');
const OUT = path.resolve(arg('--out', 'tools/.shots/borders'));
const W = parseInt(arg('--w', '400'), 10);
const H = parseInt(arg('--h', '300'), 10);
const ONLY = arg('--only', '');
// 同分區內接壤的款式仍受清單順序約束(t 仍是連續場,只是改在**選款區塊中心**取值 ⇒ 相鄰區塊的索引可以跳不只 1),
// 換種子 = 換雜訊場的空間排列 ⇒ 掃多輪才把自然可達的組合收滿
const SEEDS = parseInt(arg('--seeds', '4'), 10);
fs.mkdirSync(OUT, { recursive: true });

// ---- 期望值:從 ground.js 原文抽 borderKindOf + CARPET(與稽核同一條「執行原文」紀律)----
const src = readSrc('public', 'js', 'ground.js');
const grab = (re) => {
  const m = src.match(re);
  if (!m) throw new Error(`ground.js 原文抽取失敗:${re}`);
  return m[0].replace('export ', '');
};
const truth = new Function([
  grab(/export const BORDER_KINDS = \{[\s\S]*?\n\};/),
  grab(/export const BORDER_STYLES = \{[\s\S]*?\n\};/),
  grab(/export const BORDER_SUB_RULES = \[[\s\S]*?\n\];/),
  grab(/export function borderKindOf\(subA, subB, za, zb\) \{[\s\S]*?\n\}/),
  src.match(/const CARPET = \{[\s\S]*?\n\};/)[0],
].join('\n') + '\nreturn { BORDER_KINDS, BORDER_STYLES, borderKindOf, CARPET };')();
// 地貌級的解(不吃 sub 覆寫):短 run 被併回鄰段時,實見的就會是這一個 —— 那是
// planBorderPuzzle 的 runMinM 刻意做的(接力是換一段,不是每格換一次),不算「沒畫到」
const zoneKind = (za, zb) => truth.BORDER_STYLES[za < zb ? `${za}|${zb}` : `${zb}|${za}`] || null;
// sub → 地貌。**兩屬的款式**(steppe / scree 同時在裸露地與高地清單裡)無法由款式反查斷定:
// 執行期看的是格子自己的 zoneGrid,同一款在高地格就是高地。這種組合的期望值標 ambiguous,
// 不計入「未見預期分界線」——否則工具會拿一個自己算錯的期望去判真品紅字。
const SUBZ = new Map(), SUB_ZN = new Map();
for (const zn in truth.CARPET) {
  for (const s of truth.CARPET[zn]) {
    if (!SUBZ.has(s)) SUBZ.set(s, zn);
    if (!SUB_ZN.has(s)) SUB_ZN.set(s, new Set());
    SUB_ZN.get(s).add(zn);
  }
}
const ALL_SUBS = [...SUBZ.keys()];
const ambig = (s) => SUB_ZN.get(s).size > 1;
const wantPairs = [];
for (let a = 0; a < ALL_SUBS.length; a++) {
  for (let b = a + 1; b < ALL_SUBS.length; b++) {
    const [sA, sB] = [ALL_SUBS[a], ALL_SUBS[b]].sort();
    wantPairs.push({ key: `${sA}|${sB}`, subA: sA, subB: sB,
                     kind: truth.borderKindOf(sA, sB, SUBZ.get(sA), SUBZ.get(sB)),
                     ambiguous: ambig(sA) || ambig(sB) });
  }
}
console.log(`底毯地表 ${ALL_SUBS.length} 種 → 兩兩組合 ${wantPairs.length} 組` +
            `(跨地貌有分界線 ${wantPairs.filter((p) => p.kind).length};` +
            `同地貌不畫線 ${wantPairs.filter((p) => !p.kind).length};` +
            `款式兩屬 ${wantPairs.filter((p) => p.ambiguous).length})`);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });

console.log('逐分區對建場景(真品 buildGroundCover)…');
const t0 = Date.now();
const SUBZ_OBJ = Object.fromEntries(SUBZ);
// 功能性區塊名冊(edge:'ink')—— 由 DEFS 原文推導,MUST NOT 手寫
const INK_SUBS = Object.entries(new Function(src.match(/const DEFS = \{[\s\S]*?\n\};/)[0] + '\nreturn DEFS;')())
  .filter(([, d]) => d.edge === 'ink').map(([k]) => k);
console.log(`功能性區塊(edge:'ink')${INK_SUBS.length} 種`);

const report = await page.evaluate(async ({ W, H, ONLY, SUBZ_OBJ, SEEDS, INK_LIST }) => {
  const INK_SUBS = new Set(INK_LIST);
  const THREE = await import('three');
  const G = await import('/public/js/ground.js');
  const { setCelSun, updateCelLight } = await import('/public/js/toon.js');

  const ZONES = ['green', 'bare', 'urban', 'wet', 'water', 'alpine'];   // alpine 恆在右(高程側)
  const PAIRS = [];
  for (let a = 0; a < ZONES.length; a++) for (let b = a; b < ZONES.length; b++) PAIRS.push([ZONES[a], ZONES[b]]);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x93b9da, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const SUN = new THREE.Vector3(0.45, 0.82, 0.35).normalize();
  setCelSun(SUN);
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 4000);

  const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const WATER_Y = 2.0;
  const makeWorld = (zA, zB) => {
    const worldW = 2600, worldH = 900;
    const minX = -worldW / 2, minZ = -worldH / 2;
    const hiAlpine = zB === 'alpine';          // 高地恆在右半
    const sideOf = (x) => (x < 0 ? zA : zB);
    const roll = (x, z) => Math.sin(x * 0.0075) * 1.4 + Math.cos(z * 0.011) * 1.1;
    const heightAt = (x, z) => {
      const zn = sideOf(x);
      if (zn === 'water') {                    // 近岸淺水 → 遠處深水(deepwater 需 h < waterY-2.5)
        const d = Math.min(1, Math.abs(x) / (worldW * 0.40));
        return 1.2 - d * 5.4 + roll(x, z) * 0.15;
      }
      if (hiAlpine) {
        // 右:50m 平台 = 高地;左:自 x=0 緩降 46m / 220m(坡度 0.21 < 0.28 強制裸地門檻)
        if (x >= 0) return 50 + roll(x, z) * 0.4;
        const t = Math.min(1, -x / 220);
        return 50 - t * 46 + roll(x, z) * 0.4;
      }
      return 4 + roll(x, z);                   // 其餘:平緩低地(relief < 40 ⇒ 不會誤生 alpine)
    };
    // alpine 側交給高程晉升(classifyPure 回 green);water/wet 交給 envCode
    const classifyPureAt = (x) => {
      const zn = sideOf(x);
      return (zn === 'water' || zn === 'wet' || zn === 'alpine') ? 'green' : zn;
    };
    const envCodeAt = (x) => {
      const zn = sideOf(x);
      return zn === 'water' ? 1 : zn === 'wet' ? 2 : 0;
    };
    return { terrain: { heightAt, minX, maxX: minX + worldW, minZ, maxZ: minZ + worldH,
                        worldW, worldH, waterY: WATER_Y }, classifyPureAt, envCodeAt };
  };

  const disposeTree = (root) => {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) m?.dispose();
    });
  };

  const out = { shots: [], builds: [], errors: [] };
  const seen = new Set();

  for (const [zA, zB] of PAIRS) {
    if (ONLY && ONLY !== `${zA}|${zB}`) continue;
    for (let si = 0; si < SEEDS; si++) {
    const rec = { zonePair: `${zA}|${zB}`, si };
    let group = null;
    try {
      const { terrain, classifyPureAt, envCodeAt } = makeWorld(zA, zB);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x93b9da);
      const dir = new THREE.DirectionalLight(0xffffff, 2.0);
      dir.position.copy(SUN).multiplyScalar(600);
      scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x3a4048, 1.15));
      group = new THREE.Group();
      scene.add(group);

      rec.stats = G.buildGroundCover(group, terrain, {
        isBlocked: () => false,
        classifyAt: classifyPureAt,
        classifyPureAt,
        envCodeAt,
        blockers: [],
        season: 'summer',
        seed: (0x5B0D + si * 0x9E3779B1) | 0,     // 換種子 = 換雜訊場 ⇒ 款式的空間排列不同
        rnd: mulberry32(0xB07DE7 + si),
        roadClear: () => false,
      });

      // ---- 取樣真品網格:carpet 每 9 頂點一格,index%9===4 = 格中心 ----
      const centres = [], borders = [];
      group.traverse((o) => {
        if (!o.isMesh) return;
        const ud = o.userData, pos = o.geometry.attributes?.position;
        if (!pos) return;
        if (ud.glayer === 'carpet' && ud.gsub) {
          for (let i = 4; i < pos.count; i += 9) {
            centres.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), sub: ud.gsub });
          }
        } else if (ud.glayer === 'border' && ud.gborder) {
          for (let i = 0; i < pos.count; i += 2) {
            borders.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), kind: ud.gborder });
          }
        }
      });
      rec.cells = centres.length; rec.borderPts = borders.length;
      rec.subs = [...new Set(centres.map((c) => c.sub))].sort().join(',');

      // ---- 「有沒有東西橫跨分界線」(2026-08-11 使用者第二項)----
      // 只有真的建出來才量得到:特徵拼圖與 3D 細節的迴避住 tryPatch / addDetail 的 bdCross,
      // 而那兩支要 THREE ⇒ 離線稽核碰不到。這裡拿**畫出來的帶頂點**當點雲,逐件量最近距離:
      // 帶心那一圈(CROSS_R 內)本來就不該有拼圖或擺件站著。
      {
        const CROSS_R = 1.2;
        const BC = 8, bg = new Map();
        for (const b of borders) {
          const k2 = `${Math.floor(b.x / BC)},${Math.floor(b.z / BC)}`;
          let l = bg.get(k2); if (!l) { l = []; bg.set(k2, l); }
          l.push(b);
        }
        const onBand = (x, z) => {
          const ci = Math.floor(x / BC), cj = Math.floor(z / BC);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const l = bg.get(`${ci + di},${cj + dj}`);
            if (!l) continue;
            for (const b of l) if ((b.x - x) ** 2 + (b.z - z) ** 2 < CROSS_R * CROSS_R) return true;
          }
          return false;
        };
        let patchHit = 0, patchN = 0, detHit = 0, detN = 0;
        group.traverse((o) => {
          if (!o.isMesh) return;
          if (o.userData.gshape) {                       // 特徵拼圖(田/停車場/球場…)
            const p = o.geometry.attributes.position;
            patchN++;
            for (let i = 0; i < p.count; i++) {
              if (onBand(p.getX(i), p.getZ(i))) { patchHit++; break; }
            }
          } else if (o.isInstancedMesh) {                // 3D 細節擺件
            const m = new THREE.Matrix4();
            for (let i = 0; i < o.count; i++) {
              o.getMatrixAt(i, m);
              detN++;
              if (onBand(m.elements[12], m.elements[14])) detHit++;
            }
          }
        });
        rec.cross = { patchHit, patchN, detHit, detN };
      }

      // ---- 「功能性區塊與 3D 物件不可互相重疊」(2026-08-11 使用者第二輪)----
      // 從**真的建出來的幾何**反推每一塊的足跡:rect = 7×6 網格(角點 = 索引 0/6/41/35)、
      // blob = 12 外圈 + 12 內圈 + 中心(索引 24)。逐塊反推而不是重算一份配置,才驗得到真品。
      {
        const foots = [];
        group.traverse((o) => {
          if (!o.isMesh || !o.userData.gshape) return;
          const p = o.geometry.attributes.position, ink = INK_SUBS.has(o.userData.gsub);
          if (o.userData.gshape === 'rect') {
            for (let b = 0; b + 42 <= p.count; b += 42) {
              const q = [0, 6, 41, 35].map((k) => [p.getX(b + k), p.getZ(b + k)]);
              const cx = (q[0][0] + q[2][0]) / 2, cz = (q[0][1] + q[2][1]) / 2;
              foots.push({ ink, q, x: cx, z: cz,
                           r: Math.max(...q.map((v) => Math.hypot(v[0] - cx, v[1] - cz))) });
            }
          } else {
            for (let b = 0; b + 25 <= p.count; b += 25) {
              const cx = p.getX(b + 24), cz = p.getZ(b + 24);
              let r = 0;
              for (let k = 0; k < 12; k++) r = Math.max(r, Math.hypot(p.getX(b + k) - cx, p.getZ(b + k) - cz));
              foots.push({ ink, x: cx, z: cz, r });
            }
          }
        });
        // 凸多邊形 / 圓的分離軸判定(四邊形取自己的邊法線;圓退化成中心 ± r)
        const axesOf = (f) => {
          if (!f.q) return [];
          const a = [];
          for (let i = 0; i < 4; i++) {
            const p0 = f.q[i], p1 = f.q[(i + 1) % 4];
            const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l = Math.hypot(dx, dz) || 1;
            a.push([-dz / l, dx / l]);
          }
          return a;
        };
        const span = (f, ax, az) => {
          if (!f.q) { const c = f.x * ax + f.z * az; return [c - f.r, c + f.r]; }
          let mn = Infinity, mx = -Infinity;
          for (const v of f.q) { const d = v[0] * ax + v[1] * az; if (d < mn) mn = d; if (d > mx) mx = d; }
          return [mn, mx];
        };
        const olap = (a, b) => {
          if (Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r) return false;   // 廣相
          const axes = [...axesOf(a), ...axesOf(b)];
          if (!axes.length) return true;                                    // 圓↔圓:廣相即結論
          const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
          if (!a.q || !b.q) axes.push([dx / l, dz / l]);                    // 圓要補中心連線軸
          for (const [ax, az] of axes) {
            const [a0, a1] = span(a, ax, az), [b0, b1] = span(b, ax, az);
            if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
          }
          return true;
        };
        let inkOlap = 0;
        for (let i = 0; i < foots.length; i++) {
          for (let j = i + 1; j < foots.length; j++) {
            if (!foots[i].ink && !foots[j].ink) continue;                   // 自然類彼此刻意互融
            if (olap(foots[i], foots[j])) inkOlap++;
          }
        }
        // 3D 物件互穿:足跡半徑由零件實幾何量(與 ground.js detailR 同義,這裡對真品幾何量)。
        // **MUST 先把同一個物件的零件併回去**:一件物件的每個零件各是一支 InstancedMesh
        // (盆栽的盆與灌木、籃球架的柱與板…),它們本來就互相重疊 —— 逐 mesh 數會把
        // 「一件物件」數成好幾組互疊。同一件的零件共用同一個 (x,z),據此合併取最大半徑。
        const dmap = new Map();
        group.traverse((o) => {
          if (!o.isInstancedMesh) return;
          o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          const ur = Math.hypot(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)),
                                Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)));
          const m = new THREE.Matrix4(), s = new THREE.Vector3();
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, m);
            s.setFromMatrixColumn(m, 0);
            const x = m.elements[12], z = m.elements[14], r = ur * s.length();
            const k2 = `${x},${z}`;
            const prev = dmap.get(k2);
            if (!prev) dmap.set(k2, { x, z, r });
            else if (r > prev.r) prev.r = r;
          }
        });
        const dets = [...dmap.values()];
        const DC = 8, dg = new Map();
        for (const d of dets) {
          const k2 = `${Math.floor(d.x / DC)},${Math.floor(d.z / DC)}`;
          let l = dg.get(k2); if (!l) { l = []; dg.set(k2, l); }
          l.push(d);
        }
        let detOlap = 0;
        for (const d of dets) {
          const ci = Math.floor(d.x / DC), cj = Math.floor(d.z / DC);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const l = dg.get(`${ci + di},${cj + dj}`);
            if (!l) continue;
            for (const o2 of l) {
              if (o2 === d) continue;
              // 容差取**距離**而不是距離平方:DET_GAP = 0 ⇒ 相切合法,而相切在平方域上
              // 是「差 1e-6」等級的浮點平手,拿平方比會把相切的兩叢草判成互疊
              if (Math.hypot(o2.x - d.x, o2.z - d.z) < d.r + o2.r - 1e-4) detOlap++;
            }
          }
        }
        rec.olap = { ink: inkOlap, foots: foots.length, det: detOlap / 2, dets: dets.length };
      }

      const CS = 16;
      const hk = (x, z) => `${Math.floor(x / CS)},${Math.floor(z / CS)}`;
      const hash = new Map(), bhash = new Map();
      for (const c of centres) {
        let l = hash.get(hk(c.x, c.z)); if (!l) { l = []; hash.set(hk(c.x, c.z), l); } l.push(c);
      }
      for (const b of borders) {
        let l = bhash.get(hk(b.x, b.z)); if (!l) { l = []; bhash.set(hk(b.x, b.z), l); } l.push(b);
      }
      // 最近的「指定種類」分界線頂點(取景瞄的是真的畫出來的線,不是推測的位置)
      const nearestBorder = (x, z, kind, r = 26) => {
        let best = null, bd2 = r * r;
        const R = Math.ceil(r / CS);
        for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
          const l = bhash.get(`${Math.floor(x / CS) + di},${Math.floor(z / CS) + dj}`);
          if (!l) continue;
          for (const b of l) {
            if (kind && b.kind !== kind) continue;
            const d2 = (b.x - x) ** 2 + (b.z - z) ** 2;
            if (d2 < bd2) { bd2 = d2; best = b; }
          }
        }
        return best ? { ...best, d: Math.sqrt(bd2) } : null;
      };
      // 找異款相鄰格(距離 < 1.6 格距);逐組合收多個候選點,挑「離該種分界線最近」那個取景
      const CELL_R2 = 21 * 21, MAX_CAND = 60;
      const cand = new Map();
      for (const c of centres) {
        const ci = Math.floor(c.x / CS), cj = Math.floor(c.z / CS);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const l = hash.get(`${ci + di},${cj + dj}`);
          if (!l) continue;
          for (const o2 of l) {
            if (o2.sub === c.sub) continue;
            if ((o2.x - c.x) ** 2 + (o2.z - c.z) ** 2 > CELL_R2) continue;
            const first = c.sub < o2.sub;
            const key = first ? `${c.sub}|${o2.sub}` : `${o2.sub}|${c.sub}`;
            if (seen.has(key)) continue;
            let l2 = cand.get(key);
            if (!l2) { l2 = []; cand.set(key, l2); }
            if (l2.length >= MAX_CAND) continue;
            l2.push({
              subA: first ? c.sub : o2.sub, subB: first ? o2.sub : c.sub,
              x: (c.x + o2.x) / 2, y: (c.y + o2.y) / 2, z: (c.z + o2.z) / 2,
              ax: c.x, az: c.z, bx: o2.x, bz: o2.z,
            });
          }
        }
      }
      rec.found = cand.size;

      for (const [key, list] of cand) {
        const subA = list[0].subA, subB = list[0].subB;
        const want = G.borderKindOf(subA, subB, SUBZ_OBJ[subA], SUBZ_OBJ[subB]);
        let pick = null, hit = null;
        if (want) {
          // 逐候選點找該種分界線,取最近的那個當取景中心
          for (const p of list) {
            const b = nearestBorder(p.x, p.z, want);
            if (b && (!hit || b.d < hit.d)) { pick = p; hit = b; }
          }
          if (!pick) { pick = list[0]; hit = nearestBorder(pick.x, pick.z, null); }
        } else {
          // 刻意無界的組合(市區換鋪面 / 水域深淺 / 高地換款):挑**離任何分界線最遠**的
          // 候選點,畫面才是乾淨的「無分界線換款」,不會誤入旁邊別組的線
          let far = -1;
          for (const p of list) {
            const b = nearestBorder(p.x, p.z, null, 40);
            const d = b ? b.d : 999;
            if (d > far) { far = d; pick = p; }
          }
          pick = pick || list[0];
        }
        // 取景中心 = 真的畫出來的分界線頂點(找不到才退回兩格中點)
        const cxT = hit ? hit.x : pick.x, czT = hit ? hit.z : pick.z;
        const cyT = hit?.y != null ? hit.y : pick.y;
        // 視線垂直於「兩格連線」⇒ 兩種地表分居畫面左右、分界線縱貫畫面;
        // 垂線取**遠離地圖中心**那一側 ⇒ 視線朝圖內,鏡頭後方才是圖界(不會拍到圖外背景)
        const ux = pick.bx - pick.ax, uz = pick.bz - pick.az, ul = Math.hypot(ux, uz) || 1;
        const D = 34, el = 34 * Math.PI / 180, hd = D * Math.cos(el);
        let px = -uz / ul, pz = ux / ul;
        if ((cxT + px * hd) ** 2 + (czT + pz * hd) ** 2 < (cxT - px * hd) ** 2 + (czT - pz * hd) ** 2) {
          px = -px; pz = -pz;
        }
        camera.position.set(cxT + px * hd, cyT + D * Math.sin(el), czT + pz * hd);
        camera.lookAt(cxT, cyT, czT);
        camera.updateMatrixWorld(true);
        updateCelLight(camera);
        renderer.render(scene, camera);
        seen.add(key);
        out.shots.push({
          key, subA, subB, zonePair: `${zA}|${zB}`,
          kindSeen: hit ? hit.kind : null, kindOk: !!(hit && want && hit.kind === want),
          borderD: hit ? +hit.d.toFixed(1) : null,
          x: +cxT.toFixed(1), z: +czT.toFixed(1),
          img: canvas.toDataURL('image/jpeg', 0.85),
        });
      }
    } catch (e) {
      rec.error = e.message;
      out.errors.push(`${zA}|${zB}: ${e.message}`);
    }
    if (group) disposeTree(group);
    out.builds.push(rec);
    }
  }
  return out;
}, { W, H, ONLY, SUBZ_OBJ, SEEDS, INK_LIST: INK_SUBS });

console.log(`建構+渲染耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
let crossBad = 0, olapBad = 0;
for (const b of report.builds) {
  const c = b.cross, v = b.olap;
  if (c && (c.patchHit || c.detHit)) crossBad++;
  if (v && (v.ink || v.det)) olapBad++;
  console.log(`  ${b.zonePair.padEnd(15)} cells=${String(b.cells ?? '-').padStart(5)}` +
              ` border=${String(b.borderPts ?? '-').padStart(6)}` +
              (c ? `  橫跨 拼圖 ${c.patchHit}/${c.patchN} 擺件 ${c.detHit}/${c.detN}` : '') +
              (v ? `  互疊 區塊 ${v.ink}/${v.foots} 擺件 ${v.det}/${v.dets}` : '') +
              (b.error ? `  ✗ ${b.error}` : ''));
}
if (report.errors.length) console.log('例外:', report.errors);
// 兩條硬指標(使用者兩輪定案),MUST 全部 0:
//   ①田/停車場/球場/3D 物件都不應該橫跨分界線 ②功能性區塊與 3D 物件也不可互相重疊
console.log(crossBad === 0
  ? '橫跨分界線:0(拼圖與擺件全數讓開帶心)'
  : `⚠ 橫跨分界線:${crossBad} 座場景有拼圖/擺件壓在帶心上`);
console.log(olapBad === 0
  ? '互相重疊:0(功能性區塊零重疊、3D 物件零互穿)'
  : `⚠ 互相重疊:${olapBad} 座場景有功能性區塊/3D 物件互疊`);

// ---- 落檔 + 期望值核對 ----
const got = new Map(report.shots.map((s) => [s.key, s]));
let noBorder = 0, missing = 0, merged = 0;
const rows = [];
for (const p of wantPairs) {
  const s = got.get(p.key);
  if (!s) { missing++; rows.push({ ...p, zoneA: SUBZ.get(p.subA), zoneB: SUBZ.get(p.subB), shot: null }); continue; }
  fs.writeFileSync(path.join(OUT, `${p.subA}__${p.subB}.jpg`), Buffer.from(s.img.split(',')[1], 'base64'));
  // 期望有分界線的組合,畫面裡就必須真的看得到線;無界組合本來就沒有,款式兩屬者期望值不可信。
  // **實見 = 地貌級的解**時記成「接力併段」而不是缺陷:sub 覆寫解出來的那一小段長度不足
  // runMinM 就會被併回鄰段(planBorderPuzzle),那是刻意的
  const zk = zoneKind(SUBZ.get(p.subA), SUBZ.get(p.subB));
  const isMerged = !!(p.kind && !s.kindOk && s.kindSeen && s.kindSeen === zk && p.kind !== zk);
  if (isMerged) merged++;
  else if (p.kind && !p.ambiguous && !s.kindOk) noBorder++;
  rows.push({ ...p, zoneA: SUBZ.get(p.subA), zoneB: SUBZ.get(p.subB),
              shot: `${p.subA}__${p.subB}.jpg`, kindSeen: s.kindSeen, kindOk: s.kindOk, merged: isMerged,
              borderD: s.borderD, zonePair: s.zonePair, at: [s.x, s.z] });
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(rows, null, 1));

console.log(`\n出圖 ${wantPairs.length - missing}/${wantPairs.length} 組;缺 ${missing};` +
            `畫面內未見預期分界線 ${noBorder};接力併段(實見地貌級的解)${merged}`);
if (missing) console.log('缺的組合:', rows.filter((r) => !r.shot).map((r) => r.key).join(' '));
if (noBorder) {   // 只列「有圖卻沒框到線」的;沒出圖的已在上一行單獨列
  console.log('未見預期分界線:', rows.filter((r) => r.shot && r.kind && !r.ambiguous && !r.kindOk && !r.merged)
    .map((r) => `${r.key}(預期 ${r.kind}/實見 ${r.kindSeen ?? '無'})`).join('  '));
}
console.log(`→ ${OUT}`);
await browser.close();
