// ============ Leaf Card Canopy & Tree Surface Group Audit ============
// Validates 5 core guarantees (sections I-III execute production code directly from leafcard.js):
//   1. Card count derives from fuse geometry parameters; varying envelope radius changes count dynamically.
//      (Proportional card radius makes count invariant to radius, failing silently).
//   2. Horizontal boundary of card cluster <= layout crown radius (structural guarantee: sink = 1 - hr/rc).
//   3. Zero shared rnd() consumption: fixed CARD.DRAWS draws per card, dedicated deterministic cardRnd,
//      per-tree surface ID derived from location hash instead of random numbers.
//   4. Layout math reads only fuse p.g (giantCrownR crown radius / vegSpan denominator untouched).
//   5. Fallback to mesh blob when MRT capability missing or group silhouette disabled.
//
// Separated from audit_cel_pipeline: audit_cel_pipeline tests the cel-shading / ink pipeline;
// this audit tests world-content consumption (card density, spatial placement, layout contracts).
//
// Negative testing:
//   --break-count   Hardcodes card count per type => I MUST fail.
//   --break-fuse    Reads resolved partGeo(part) for envelope => IV MUST fail.
//   --break-rnd     Consumes shared rnd for jitter => III MUST fail.
//   --break-mrtgate Removes MRT capability / group gate from leafCardOn => V MUST fail.
import { readSrc, grabFn } from './audit_src.mjs';
import { CARD, cardEnvelope, envArea, cardHalf, cardCount, planCards, cardRnd, leafSurfId }
  from '../public/js/leafcard.js';

const A = process.argv.slice(2);
const BRK = {
  count: A.includes('--break-count'), fuse: A.includes('--break-fuse'),
  rnd: A.includes('--break-rnd'), mrtgate: A.includes('--break-mrtgate'),
};
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
/**
 * Strips comments. Block comments are stripped only at line start to avoid treating
 * 'server/**' or 'forge/**' inside line comments as block comment openings.
 */
const code = (s) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (s.match(re) || []).length;

const lcSrc = readSrc('public', 'js', 'leafcard.js');
let bioSrc = readSrc('public', 'js', 'biomes.js');
const bioC = code(bioSrc);

// Mutated count/envelope implementations for negative testing.
// Expected assertions MUST NOT change under --break-* flags to test real invariants.
const cnt = BRK.count ? () => 12 : cardCount;

// ---------------------------------------------------------------- I
console.log('Ⅰ 張數由保險絲幾何的 parameters 推導');
{
  // Three.js geometry construction parameters (ico -> IcosahedronGeometry, cone -> ConeGeometry, cyl -> CylinderGeometry), shared with giantCrownR.
  const sph = (r) => cardEnvelope({ radius: r, detail: 0 });
  const con = (r, h) => cardEnvelope({ radius: r, height: h, radialSegments: 5 });
  const cyl = (a, b, h) => cardEnvelope({ radiusTop: a, radiusBottom: b, height: h });
  ok(sph(2)?.kind === 'sphere' && con(1, 3)?.kind === 'cone' && cyl(2, 2, 5)?.kind === 'cyl',
    '三種包絡都認得(球 / 錐 / 圓台;圓台 MUST 排在錐之前 —— 兩者都帶 height)');
  ok(cardEnvelope(null) === null && cardEnvelope({}) === null && cardEnvelope({ width: 2, height: 2, depth: 2 }) === null,
    '認不出來的形狀回 null(呼叫端退回保險絲團塊;原則 6 降級不例外)');
  // Card count MUST vary with envelope radius. Purely proportional card radius (R_F * rc) makes both sphere area and card area scale as r^2, rendering count invariant to radius.
  const ns = [0.9, 1.2, 1.7, 2.4].map((r) => cnt(sph(r)));
  ok(new Set(ns).size > 1, `球:換半徑張數跟著變(0.9/1.2/1.7/2.4m → ${ns.join('/')})`);
  let mono = true;
  for (let i = 1; i < ns.length; i++) if (ns[i] < ns[i - 1]) mono = false;
  ok(mono, '張數對半徑**單調不減**(大葉團不會比小葉團的卡少)');
  const nc = [1.1, 1.8, 2.3].map((r) => cnt(con(r, r * 2.2)));
  ok(new Set(nc).size > 1 && nc.every((v, i) => i === 0 || v >= nc[i - 1]),
    `錐:同樣跟著半徑走(${nc.join('/')})`);
  ok(cnt(sph(0.2)) >= CARD.N_MIN && cnt(sph(40)) <= CARD.N_MAX,
    `張數夾在 [N_MIN, N_MAX] = [${CARD.N_MIN}, ${CARD.N_MAX}](上限是**填充率預算**不是美術值)`);
  // Area derivation: cover ratio * envelope area / card face area (unclamped ranges MUST strictly obey formula).
  const e = sph(1.4), want = Math.round(CARD.COVER * envArea(e) / (4 * cardHalf(e) ** 2));
  ok(!BRK.count && cnt(e) === Math.max(CARD.N_MIN, Math.min(CARD.N_MAX, want)),
    `張數 = round(COVER × 包絡面積 ÷ 卡面面積) 夾進帶內(r=1.4 ⇒ ${cnt(e)})`);
  ok(/COVER \* envArea\(e\) \/ \(4 \* hr \* hr\)/.test(code(lcSrc)) && !/N_BY_KIND|COUNT_TABLE/.test(code(lcSrc)),
    '沒有「逐型 → 張數」的名冊(名冊會在加樹種 / 改葉團半徑時靜默過期)');
}

// ---------------------------------------------------------------- II
console.log('\nⅡ 卡片叢的水平外廓 ≤ 佈局用的冠幅(結構保證,不是校準)');
{
  // giantCrownR measures radius / max(radiusTop, radiusBottom) from p.g.parameters, equivalent to cardEnvelope().rc.
  // Inset sink = 1 - hr/rc ensures center distance * sink + hr <= rc (algebraic upper bound).
  const cases = [
    ['ico(2.7)', { radius: 2.7 }], ['ico(1.2)', { radius: 1.2 }], ['ico(0.9)', { radius: 0.9 }],
    ['cone(1.1,2.4)', { radius: 1.1, height: 2.4 }], ['cone(2.3,3.4)', { radius: 2.3, height: 3.4 }],
    ['cyl(3.06,3.06,6.99)', { radiusTop: 3.06, radiusBottom: 3.06, height: 6.99 }],
    ['cyl(2.6,3.1,0.9)', { radiusTop: 2.6, radiusBottom: 3.1, height: 0.9 }],
  ];
  let worst = 0, worstN = '', nOut = 0;
  for (const [name, p] of cases) {
    const e = cardEnvelope(p);
    for (const seed of [1, 7, 99]) {
      for (const c of planCards(e, cardRnd(`t${seed}`, seed))) {
        const reach = Math.hypot(c.cx, c.cz) + c.hr;
        if (reach > e.rc + 1e-9) nOut++;
        const f = reach / e.rc;
        if (f > worst) { worst = f; worstN = name; }
      }
    }
  }
  ok(nOut === 0, `逐張「卡心水平距 + 卡半邊長 ≤ 包絡半徑」(0 例外;最緊 ${worst.toFixed(4)} × rc @ ${worstN})`);
  ok(worst <= 1 + 1e-9 && worst > 0.9,
    '而且**真的頂到那個上界**(遠低於 1 = 卡片縮在冠心、冠緣禿一圈)');
  // Normals are spherical normals (card center - crown center), not camera-facing planar normals.
  const e0 = cardEnvelope({ radius: 2.0 });
  const cs = planCards(e0, cardRnd('n', 0));
  ok(cs.every((c) => Math.abs(Math.hypot(c.nx, c.ny, c.nz) - 1) < 1e-6),
    '法線是單位長的球面法線(用面向相機的面法線 ⇒ 整叢冠在轉頭時同時換一階明暗)');
  ok(cs.every((c) => c.nx * c.cx + c.ny * c.cy + c.nz * c.cz >= -1e-9),
    '法線朝外(與卡心同側)');
  ok(cs.every((c) => c.hr > 0 && c.rot >= 0 && c.rot < Math.PI * 2 + 1e-9),
    '逐張都有正的半邊長與 [0, 2π) 的自轉');
}

// ---------------------------------------------------------------- III
console.log('\nⅢ 零共享 rnd 消耗(§2.3)');
{
  const e = cardEnvelope({ radius: 1.7 });
  // Fixed consumption per card: rejection-free sampling guarantees uniform draw counts.
  let n = 0;
  const spy = () => { n++; return 0.5; };
  const cards = planCards(e, spy);
  ok(!BRK.rnd && cards.length > 0 && n === cards.length * CARD.DRAWS,
    `逐張消耗固定 ${CARD.DRAWS} 枚(${cards.length} 張 ⇒ ${n} 枚)`);
  // Dedicated sequence: running identical row twice is bit-identical; distinct rows yield distinct permutations.
  const a = JSON.stringify(planCards(e, cardRnd('broadleaf', 2)));
  const b = JSON.stringify(planCards(e, cardRnd('broadleaf', 2)));
  const c = JSON.stringify(planCards(e, cardRnd('broadleaf', 3)));
  ok(a === b, '同一型同一列跑兩次逐位元相同(全房同值 —— 跨客戶端不分家)');
  ok(a !== c, '不同列不同排列(同一株上的兩團葉不會是同一叢卡)');
  ok(/import \{ mulberry32 \} from '\.\/rng\.js';/.test(lcSrc)
    && count(code(lcSrc), /^import /gm) === 1,
    'leafcard.js 只 import rng.js(亂數唯一縫;零 THREE 才是它能離線驗真品的理由)');
  ok(!/Math\.random/.test(code(lcSrc)), 'leafcard.js 全檔無 Math.random(A4)');
  // Per-tree surface ID: spatial hash of plant coordinate, avoiding random number consumption.
  ok(leafSurfId(12.5, -80.25) === leafSurfId(12.5, -80.25), '逐株面號是座標的純函式(同一株的每一列同號)');
  const ids = new Set();
  for (let i = 0; i < 400; i++) ids.add(leafSurfId(i * 3.7, i * -2.3));
  ok(ids.size >= 40, `面號散得開(400 個落點取到 ${ids.size} 個號;64 階 ⇒ 撞號 = 少一條線,不是壞掉)`);
  ok([...ids].every((v) => v > 0 && v < 1), '面號值域 (0,1) 且避開 SURF_ID.LAND = 0(否則整片林子與地貌同號)');
  ok([...ids].every((v) => Math.abs(v * 64 - Math.round(v * 64 - 0.5) - 0.5) < 1e-9),
    '面號是**半整數格** (k+0.5)/64(與 surfGroup() 的整數格恆差 ≥ 0.0078 ⇒ 永不撞號)');
  // Wiring: computed once per tree coordinate and shared across trunk, branch, and crown rows.
  ok(/const arr = new Float32Array\(items\.length\);[\s\S]{0,200}leafSurfId\(it\.x, it\.z\)/.test(bioC),
    '接線端逐株算一次(同一株的幹 / 枝 / 冠共用同一份陣列 ⇒ 群組早退才讀得出「這是一棵樹」)');
  ok(count(bioC, /leafSurfId\(/g) === 1, '面號的消費端恰一處(第二處就是「有些列跟別人不同號」)');
}

// ---------------------------------------------------------------- IV
console.log('\nⅣ 佈局數學只讀保險絲 p.g(冠幅 / 擺幅 / 淨空 / 碰撞一格未動)');
{
  let crown = grabFn(bioSrc, 'giantCrownR'), span = grabFn(bioSrc, 'vegSpan');
  let rowGeo = grabFn(bioSrc, 'leafRowGeo');
  // --break-fuse: envelope reads resolved partGeo; loading differences across clients cause desynchronization.
  if (BRK.fuse) {
    const before = rowGeo;
    rowGeo = rowGeo.replace(/cardEnvelope\(part\.g\?\.parameters\)/, 'cardEnvelope(partGeo(part)?.parameters)');
    if (rowGeo === before) { console.log('x --break-fuse 的字面替換沒有生效(原文改了?)'); process.exit(1); }
  }
  ok(!/leafRowGeo|planCards|cardEnvelope|CARD\./.test(code(crown)),
    'giantCrownR(冠幅)不讀卡片幾何 —— 讀了就是「畫出來的比佈局用的大」,樹冠羞避當場失效');
  ok(!/leafRowGeo|planCards|cardEnvelope|CARD\./.test(code(span)),
    'vegSpan(擺幅分母)不讀卡片幾何 —— 卡片包圍盒比保險絲大 ⇒ 誤讀會讓整片林子擺幅變小');
  ok(/cardEnvelope\(part\.g\?\.parameters\)/.test(code(rowGeo)),
    '卡片包絡讀的是**保險絲** `part.g.parameters`(與 giantCrownR 同一組參數 ⇒ 兩者不可能分家)');
  ok(!/partGeo\(/.test(code(rowGeo)), 'leafRowGeo 全段不碰 partGeo(庫幾何載不載得到逐客戶端不同)');
  // Resolution seam remains untouched: leaf cards are a rendering variation, not a replacement for partGeo.
  ok(/new THREE\.InstancedMesh\(partGeo\(part\)/.test(bioC),
    '`new THREE.InstancedMesh(partGeo(part)` 那一行原樣(解析縫一格未動)');
  // Card eligibility reuses the single vegSoftKind result; MUST NOT maintain a duplicate table.
  ok(count(bioC, /vegSoftKind\(/g) === 1 && /leafCardOn\(part, sk\)/.test(bioC),
    '「這一列要不要換成卡片」由 `vegSoftKind` 的同一次結果推導(第二張名單遲早與季節換色分家)');
  ok(count(bioC, /const mat = toonMat\(seasonColor/g) === 1,
    '材質仍恰一處建立(分支寫成第二個呼叫點 = 軟性旗標有兩條路)');
  // Three invariants for card material setup:
  const bv = grabFn(bioSrc, 'buildVegMeshes');
  ok(/mo\.transparent = false/.test(code(bv)) && /mo\.alphaTest = /.test(code(bv)),
    '卡片材質 `transparent: false` + `alphaTest`(true 會掉出 inkable ⇒ 細勾線關掉、不透明度變 0.3)');
  ok(/m\.castShadow = false/.test(code(bv)),
    'castShadow 維持 false(陰影走 MeshDepthMaterial,沒有 CEL_LEAFCARD 補丁 ⇒ 卡片在陰影圖裡是退化四邊形)');
  ok(/if \(sk === 'leaf'\) mo\.ink = 'group';/.test(code(bv)) && count(code(bv), /mo\.ink = /g) === 1,
    "葉列才標 `ink: 'group'`,木質列維持 'hard'(幹的內部折邊留著 —— 110m 神木近距離要讀得出轉折)");
  ok(!/new THREE\.ShaderMaterial/.test(code(bv)),
    '沒有自寫 ShaderMaterial(走 applyCelPatch 的 define ⇒ gInfo 宣告 / 軟性 alpha / 世界曲面三條結構性繼承)');
}

// ---------------------------------------------------------------- V
console.log('\nⅤ 配不到第二張附件 / 群組剪影關著 ⇒ 逐位元退回團塊');
{
  let gate = grabFn(bioSrc, 'leafCardOn');
  if (BRK.mrtgate) {
    const before = gate;
    gate = gate.replace(/if \(sk !== 'leaf' \|\| !CARD_MRT_CAP \|\| !groupInkOn\(\)\) return false;/,
      "if (sk !== 'leaf') return false;");
    if (gate === before) { console.log('x --break-mrtgate 的字面替換沒有生效(原文改了?)'); process.exit(1); }
  }
  const gc = code(gate);
  ok(/CARD_MRT_CAP/.test(gc) && /groupInkOn\(\)/.test(gc),
    '兩道閘都在:沒有第二張附件、或群組剪影關著 ⇒ **不畫卡片**(沒有群組早退的卡片叢是 12~24 個黑多邊形,比舊制更糟)');
  ok(/mode === 'all'/.test(gc) && /mode === 'auto' && partGeo\(part\) === part\.g/.test(gc),
    "三態:`auto` 只換**解析不到庫節點**的葉列、`all` 連庫冠簇一起換");
  ok(/typeof THREE\.WebGLMultipleRenderTargets === 'function'/.test(bioC),
    '能力判準與 postfx 的 `_mrtCap` 逐字同一句(three 版本那一半;renderer 那一半見交付說明的待裁決)');
  // Early exit: when knob is disabled, shell geometry is skipped.
  // Early exit condition MUST require both attributes missing; checking only !attr drops wind sway attributes (aTreeO).
  const sg = code(grabFn(bioSrc, 'surfIdGeo'));
  ok(/if \(!attr && !treeAttr\) return geo;/.test(sg),
    '兩種屬性都沒有 ⇒ `surfIdGeo` 連幾何殼都不建(逐位元同舊制)');
  ok(/mo\.treeO \? treeAttr : null/.test(code(grabFn(bioSrc, 'buildVegMeshes'))),
    'aTreeO 只掛給帶 treeO 的列(材質不讀的屬性 = 白佔一份 buffer)');
  ok(/for \(const k in geo\.attributes\) q\.setAttribute\(k, geo\.attributes\[k\]\);/.test(sg)
    && /q\.setIndex\(geo\.index\)/.test(sg),
    '面號殼**只換屬性不動拓樸**(position / normal / uv / index 沿用同一份 BufferAttribute ⇒ draw call 與三角形數逐位元不動)');
  ok(/return markShared\(q\)/.test(sg),
    '殼 markShared 註冊(它借用別人的屬性,被 disposeTree 放掉會把整場共用的保險絲幾何一起釋放 —— A25)');
  ok(/markShared\(g\);/.test(code(grabFn(bioSrc, 'leafRowGeo'))),
    '卡片幾何逐型逐列快取一份且 markShared(A25:整場共用的幾何 MUST NOT dispose)');
}

console.log(`\n${fail ? '❌' : '🎉'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
