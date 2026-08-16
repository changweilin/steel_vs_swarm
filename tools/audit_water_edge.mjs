// ============ 岸邊泡沫 / 水面倒影塊(anime_style_plan ⑤-2 / ⑤-3;序 9)============
// 2026-08-16。**本支只驗消費端**:`toon.js` 那一半(`FOAM`/`REFL`/`celFoam`/`CEL_REFL`/
// `setSeaDepthField`)的原文不變式住 `audit_soft_stroke` Ⅵ(lane-ink 的地盤,S11),
// 本支驗的是「誰把水深烤出來、誰把柱子蓋進去、倒影塊的名冊從哪來」。
//
//   Ⅰ **深度場的烤**(`terrain.bakeSeaDepth` 行為直測):陸地 = 0 / 深過 `FOAM.RANGE_M` = 255 /
//      中間帶真的有梯度 / 列 = z 欄 = x(DataTexture 的 `flipY` 恆 false)/ **無水域不烤** /
//      邊長走 `seaFieldN()` 推導且跟著 lowPower 折半 / **零 `rnd()`**
//   Ⅱ **蓋章**(`terrain.stampSeaBlockers` 行為直測):橫斷面 MUST 是 A30 的那一份 ——
//      有向盒吃 `hw2/hd2/ry`(local 軸 `sn = −sin`),圓只當 broad-phase。**只用外接圓的
//      症狀是「40m 長條建物旁邊一圈方形泡沫」**,而看得見的泡沫與擋得住彈的牆對不上正是
//      A30 那一族。另驗 main.js 的接線恰一處、排在 `inBorderBand` 之後。
//   Ⅲ **倒影塊**:名冊由 `blockers` 推導且 **MUST 排除邊界牆環**(A44:它是 `blockers` 的
//      第一批,`slice(0, N)` 剛好只選到它 ⇒ 四條邊各長出一道連續倒影牆而圖心一個都沒有)、
//      零共享 `rnd()`、`seaFade` 唯一來源 = `terrain.seaFadeAtWorld`、mesh 掛世界原點、
//      **不新增 `ShaderMaterial`**(走 `applyCelPatch` 的 define ⇒ gInfo 契約結構性繼承)、
//      而**浪高的補償常數 `REFL_WAVE_WRITERS` MUST === toon.js 真的寫入 `transformed` 的處數**
//      (上游哪天在 `CEL_WAVE` 那一段補 `#ifndef CEL_REFL`,這一條當場紅字)
//   Ⅳ **舊的格點泡沫片已退場**(§6:8m 格點 + 徑向漸層軟 alpha + 固定在 waterY+0.1 的平板;
//      兩份 shore band 並存 = 新的硬邊被舊的軟 alpha 糊掉,而每一條既有斷言照樣全綠)
//   Ⅴ **純表現層**:`waterY` / `WATER.*` / `terrainEnvCode` / `bakeWetGrid` / 涉水物理一格不碰;
//      權威層(`server/**` / `data.js`)零命中
//
// 反向驗證(§0 原則 9;字面替換一律 CRLF 容忍 `\r?\n`,替換無效 MUST 當場 exit 1;
// **期望值 MUST NOT 隨 `--break-*` 改變** —— 下面每一條比的都是真品該有的性質):
//   --break-foam    烤場不再讀地形高度(深度變成常數)⇒ Ⅰ **紅 3**(陸地 / 深水 / 列欄序);
//                   控制組(無水域不烤、邊長推導、零 rnd、取樣走 sampleField)MUST 仍綠
//   --break-stamp   蓋章退回外接圓(有向盒那一支拿掉)⇒ Ⅱ **紅 1**(盒外那一點被誤蓋);
//                   「盒心蓋得到」與「沿長軸蓋得到」兩條對照組 MUST 仍綠
//   --break-refl    倒影名冊不再排除邊界牆環 ⇒ Ⅲ **紅 2**;上限 / 全序 / MIN_H 三條仍綠
//   --break-fade    倒影的 seaFade 不再除以寫入處數 ⇒ Ⅲ **紅 1**(補償條)
import { readSrc, grabBlock, grabConst } from './audit_src.mjs';

const A = process.argv.slice(2);
const BRK = {
  foam: A.includes('--break-foam'), stamp: A.includes('--break-stamp'),
  refl: A.includes('--break-refl'), fade: A.includes('--break-fade'),
};
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
/** 剝註解(區塊註解只剝行首那一種 —— `//` 裡的 `server/**` 會被無條件樣式當成區塊起點) */
const code = (s) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (s.match(re) || []).length;
/** 字面替換 + 「沒咬到就當場失敗」(§5.4 ㋑:無聲 no-op 的 break 永遠是綠的) */
const bend = (src, re, to, tag) => {
  const out = src.replace(re, to);
  if (out === src) { console.error(`✗ ${tag}:樣式沒咬到原文,反向驗證等於沒跑`); process.exit(1); }
  return out;
};

const terrSrc = readSrc('public', 'js', 'terrain.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const toonSrc = readSrc('public', 'js', 'toon.js');
const terrC = code(terrSrc), bioC = code(bioSrc), mainC = code(mainSrc), toonC = code(toonSrc);

// 真品常數(`toon.js` import 不進 Node —— 它要 three;`grabConst` 抽原文求值)
const FOAM = new Function(`${grabConst(toonSrc, 'FOAM')}\nreturn FOAM;`)();
const REFL = new Function(`${grabConst(toonSrc, 'REFL')}\nreturn REFL;`)();

// ---------------------------------------------------------------- Ⅰ
console.log('Ⅰ 深度場的烤(bakeSeaDepth;泡沫的驅動量是水深不是岸線幾何)');
{
  let bakeSrc = `function bakeSeaDepth() ${grabBlock(terrSrc, 'function bakeSeaDepth() {')}`;
  if (BRK.foam) bakeSrc = bend(bakeSrc, /const d = waterY - sampleField\(heights, x, z\);/,
    'const d = waterY - 0;', '--break-foam');
  // 沙箱:`sampleField` / `heights` / `seaFieldN` / `lowPower` / `setSeaDepthField` 全部注入
  // ⇒ 量到的是 bakeSeaDepth **自己**的算術(量化、列欄序、無水域早退),不是別人的。
  const mk = (waterY, hFn, n = 8) => {
    let got = null;
    const fn = new Function('waterY', 'seaFieldN', 'lowPower', 'worldW', 'worldH', 'minX', 'minZ',
      'sampleField', 'heights', 'FOAM', 'setSeaDepthField', 'seaData', 'seaN',
      `${bakeSrc}\nreturn bakeSeaDepth;`)(
      waterY, () => n, () => false, 120, 120, -60, -60,
      (f, x, z) => f(x, z), hFn, FOAM,
      (data, size, bounds) => { got = { data: Array.from(data), size, bounds }; }, null, 0);
    return { ran: fn(), got: () => got };
  };
  // 灘面:高度只隨 z 變(z = −60 ⇒ −12m 深水 / z = +60 ⇒ +12m 高地)
  const ramp = mk(0.3, (x, z) => z * 0.2);
  ok(ramp.ran === true && ramp.got(), '有水域 ⇒ 真的烤,而且經 setSeaDepthField 交出去(唯一寫入點)');
  const g = ramp.got() || { data: [], size: 8, bounds: {} };
  const N = g.size, at = (i, j) => g.data[i * N + j];
  ok(at(N - 1, 0) === 0 && at(N - 1, N - 1) === 0,
    '陸地(高於水面)MUST = 0 ⇒ 泡沫的相位算不出帶 ⇒ 岸上沒有泡沫');
  ok(at(0, 0) === 255 && at(0, N - 1) === 255,
    `深過 FOAM.RANGE_M(${FOAM.RANGE_M}m)MUST = 255 ⇒ celFoam 的 celFade 早退 ⇒ 外海沒有泡沫`);
  ok(g.data.some((v) => v > 0 && v < 255),
    '中間帶真的有梯度(全 0 或全 255 = 這張場什麼都沒驅動,而畫面上只是「沒有泡沫」)');
  let mono = true;
  for (let i = 1; i < N; i++) if (at(i, 0) > at(i - 1, 0)) mono = false;
  ok(mono, '沿灘面單調(深 → 淺 → 乾;不單調 = 取樣點與高度場對不上)');
  let rowFlat = true, colVaries = false;
  for (let i = 0; i < N; i++) for (let j = 1; j < N; j++) if (at(i, j) !== at(i, 0)) rowFlat = false;
  for (let i = 1; i < N; i++) if (at(i, 0) !== at(0, 0)) colVaries = true;
  ok(rowFlat && colVaries,
    '列 = z / 欄 = x(DataTexture 的 flipY 恆 false;轉置的話泡沫會出現在垂直於岸線的那一邊)');
  ok(g.bounds && g.bounds.minX === -60 && g.bounds.minZ === -60 && g.bounds.w === 120 && g.bounds.h === 120,
    '取樣框交的是 { minX, minZ, w, h }(= 著色器 uSeaRect 的形狀;寫成 maxX/maxZ 會讓整張場錯位)');
  // ---- 控制組:這三條與 --break-foam 無關,MUST 恆綠 ----
  const dry = mk(null, () => -99);
  ok(dry.ran === false && dry.got() === null,
    '無水域 MUST NOT 烤(場留在 toon.js 的 1×1「很深」中性貼圖 ⇒ 恆無泡沫,原則 6)');
  const bakeReal = `function bakeSeaDepth() ${grabBlock(terrC, 'function bakeSeaDepth() {')}`;
  ok(/seaFieldN\(worldW, worldH, lowPower\(\)\)/.test(bakeReal) && !/\b(256|512|1024)\b/.test(bakeReal),
    '邊長走 seaFieldN() 推導並跟著 lowPower 折半(手寫 1024 = 低階裝置多背 1MB VRAM 而畫面一模一樣)');
  ok(!/\brnd\(|Math\.random\(/.test(bakeReal),
    '零 `rnd()` 消耗(§2.3:多抽一枚就把後面每一株植被的佈局整條推移,而畫面上只是「整張圖變了」)');
  ok(/sampleField\(heights, x, z\)/.test(bakeReal) && !/heights\[/.test(bakeReal),
    '取樣走 sampleField(= heightAt 的同一份三角化雙線性);自己再寫一份 = 泡沫的岸線與踩得到的岸線差半格');
  // TDZ:`bakeSeaDepth` 是 hoist 得到的函式宣告,但它讀的狀態是 `let` ⇒ 宣告擺在呼叫點
  // **之後**就是 ReferenceError,而訊息指向完全無關的地方(同 toon.js `_foamA` 那一段的坑)。
  const iLet = terrC.indexOf('let seaData = null, seaN = 0;');
  const iCall = terrC.indexOf('\n    bakeSeaDepth();');
  ok(iLet > 0 && iCall > iLet,
    '`let seaData / seaN` MUST 宣告在 `bakeSeaDepth()` 的呼叫點之前(TDZ:函式宣告 hoist 得到,`let` 不會)');
}

// ---------------------------------------------------------------- Ⅱ
console.log('\nⅡ 蓋章(stampSeaBlockers;繞過每一根柱子的那一步)');
{
  const bakeSrc = `function bakeSeaDepth() ${grabBlock(terrSrc, 'function bakeSeaDepth() {')}`;
  let stampSrc = `function stampSeaBlockers(blockers) ${grabBlock(terrSrc, 'function stampSeaBlockers(blockers) {')}`;
  if (BRK.stamp) stampSrc = bend(stampSrc,
    /if \(b\.hw2 != null\) \{\n\s*const lx = [^\n]*\n\s*if \(Math\.abs\(lx\)[^\n]*\n\s*\} else if/,
    'if (false) {\n          } else if', '--break-stamp');
  const run = (blockers, n = 64) => {
    let got = null;
    const stamp = new Function('waterY', 'seaFieldN', 'lowPower', 'worldW', 'worldH', 'minX', 'minZ',
      'sampleField', 'heights', 'FOAM', 'setSeaDepthField', 'seaData', 'seaN',
      `${bakeSrc}\n${stampSrc}\nreturn stampSeaBlockers;`)(
      0.3, () => n, () => false, 120, 120, -60, -60,
      (f, x, z) => f(x, z), () => -50, FOAM,
      (data, size, bounds) => { got = { data, size, bounds }; }, null, 0);
    const hit = stamp(blockers);
    const N = got.size, tx = 120 / N, tz = 120 / N;
    // 世界座標 → texel 讀數(與烤場同一個取樣點約定:texel 中心)
    const read = (x, z) => got.data[Math.min(N - 1, Math.max(0, Math.floor((z + 60) / tz))) * N
      + Math.min(N - 1, Math.max(0, Math.floor((x + 60) / tx)))];
    return { hit, read };
  };
  // 深湖(整片 255)+ 一根 r = 6m 的圓柱
  const cyl = run([{ x: 0, z: 0, y: -1, h: 20, r: 6 }]);
  ok(cyl.read(0, 0) === 0, '圓柱腳印內的深度場 = 0(乾)⇒ 泡沫繞著它走');
  ok(cyl.read(20, 0) === 255, '柱外仍是原深度(只蓋腳印,MUST NOT 暈開 —— 暈一圈就是第二份帶寬)');
  ok(cyl.hit > 0, '回報蓋到的 texel 數 > 0(0 = 這一支其實什麼都沒做,而畫面上只是「泡沫沒繞過柱子」)');
  // 有向盒:長 40m × 寬 6m,繞 Y 轉 45°(long axis 指向 +x/−z)。
  // 寬度 MUST > texel 邊長(120/64 = 1.875m),否則量到的是取樣格粒不是判定。
  const box = run([{ x: 0, z: 0, y: -1, h: 20, hw2: 20, hd2: 3, ry: Math.PI / 4, r: Math.hypot(20, 3) }]);
  ok(box.read(0, 0) === 0, '有向盒的盒心蓋得到(對照組:--break-stamp 之下 MUST 仍綠)');
  ok(box.read(10, -10) === 0,
    '沿盒的 local +x 軸(three Euler(0,ry,0) 的反解 ⇒ sn 取 **−sin**)10√2m 處**在盒內** ⇒ 蓋得到');
  ok(box.read(10, 10) === 255,
    '垂直於長軸、同樣落在**外接圓內**的那一點 MUST NOT 被蓋 —— 只用外接圓的症狀是「長條建物旁邊一圈方形泡沫」(A30)');
  // 整根都在水面以下的柱子:蓋了也看不到
  const sunk = run([{ x: -30, z: -30, y: -20, h: 5, r: 6 }]);
  ok(sunk.read(-30, -30) === 255, '整根在水面以下的柱子 MUST NOT 蓋(它撐不出水面,泡沫沒有理由繞它)');

  const stampReal = `function stampSeaBlockers(blockers) ${grabBlock(terrC, 'function stampSeaBlockers(blockers) {')}`;
  ok(/-Math\.sin\(b\.ry/.test(stampReal),
    'local 軸反解一律 `sn = −sin(ry)`(寫 +sin = 看得見的牆在這裡、泡沫繞過的牆在另一邊;A30)');
  ok(/Math\.hypot\(b\.hw2, b\.hd2\)/.test(stampReal),
    '圓只當 broad-phase,而且 MUST 是**外接**半對角(內切近似會把盒角提早剔掉)');
  ok(/bakeSeaDepth\(\)/.test(stampReal),
    '蓋章 MUST 先重烤:`heights` 在水盤建好之後還會被 carveTunnels / gradeRoadBeds 改(路塹與整平)');
  ok(!/\brnd\(|Math\.random\(/.test(stampReal), '零 `rnd()` 消耗(§2.3)');
  // ---- main.js 接線 ----
  ok(count(mainC, /terrain\.stampSeaBlockers\?\.\(/g) === 1,
    '接線恰一處(main.js;第二處 = 蓋兩次,而第二次會把第一次的結果原樣重算一遍)');
  const iBorder = mainC.indexOf('terrain.inBorderBand =');
  const iStamp = mainC.indexOf('terrain.stampSeaBlockers?.(');
  ok(iBorder > 0 && iStamp > iBorder,
    '排在 buildBiomes 之後(`inBorderBand` 立過的先例:建圖期拿不到 blockers,拿了就是循環)');
}

// ---------------------------------------------------------------- Ⅲ
console.log('\nⅢ 水面倒影塊(一份幾何、一個 draw call、朝向在頂點著色器算)');
{
  // ---- ① 補償常數 MUST === toon.js 真的寫入 transformed 的處數 ----
  const iRefl = toonC.indexOf('float rE = max(');
  const seg = iRefl > 0 ? toonC.slice(iRefl, toonC.indexOf('#include <project_vertex>', iRefl)) : '';
  const writers = count(seg, /transformed[^\n]*celSeaH\(/g);
  const wDecl = /const REFL_WAVE_WRITERS = (\d+);/.exec(bioC);
  ok(iRefl > 0 && writers > 0, 'toon.js 的頂點端找得到 CEL_REFL 的倒影分支');
  ok(!!wDecl && Number(wDecl[1]) === writers,
    `倒影的浪高補償常數 === toon.js 真的把 celSeaH × seaFade 寫進 transformed 的處數(現為 ${writers}:`
    + 'CEL_REFL 自己 1 + CEL_WAVE 的水面位移 1)—— 上游補上 `#ifndef CEL_REFL` 之後這一條會紅,那是**提醒**不是壞掉');
  ok(/rDir = rD2 \/ max\( rD, 1e-4 \)/.test(seg) && count(seg, /cameraPosition\.xz/g) === 1,
    '倒影方向由 cameraPosition 推導(恰一處,MUST NOT 手寫方向)');
  ok(/rLen = rD \* aReflO\.z \/ \( rE \+ aReflO\.z \)/.test(seg),
    '長度 = D·h/(e+h) 的鏡像反解(MUST NOT 手寫倍率)');

  // ---- ② 名冊(planReflectors 行為直測)----
  let planSrc = `function planReflectors(terrain, blockers) ${grabBlock(bioSrc, 'function planReflectors(terrain, blockers) {')}`;
  if (BRK.refl) planSrc = bend(planSrc,
    /if \(Math\.min\(b\.x - minX, maxX - b\.x, b\.z - minZ, maxZ - b\.z\) < inset\) continue;/,
    '', '--break-refl');
  const plan = new Function('edgeWallInsetM', 'REFL', `${planSrc}\nreturn planReflectors;`)(() => 40, REFL);
  const terr = { waterY: 0.3, minX: -600, maxX: 600, minZ: -600, maxZ: 600, heightAt: () => -2 };
  // 邊界牆環:盒心在夾制線**外側**(內面貼線、厚度往圖界方向長);其餘欄位與真品同形
  const ring = [];
  for (let k = 0; k < 40; k++) ring.push({ x: -600 + 40 - 6, z: -560 + k * 20, y: -1, h: 15, hw2: 30, hd2: 6, ry: Math.PI / 2 });
  const inner = [];
  for (let k = 0; k < 6; k++) inner.push({ x: k * 13, z: 0, y: -1, h: 30, hw2: 8, hd2: 8, ry: 0 });
  const sel = plan(terr, ring.concat(inner));
  ok(sel.every((b) => Math.abs(b.x) < 560),
    '名冊 MUST 排除邊界牆環(A44:它是 blockers 的**第一批**,naive slice 剛好只選到它 ⇒ 四條邊各長出一道連續倒影牆而圖心一個都沒有)');
  ok(sel.length === Math.min(inner.length, REFL.MAX_N),
    `名冊只收圖內那幾棟(應為 ${Math.min(inner.length, REFL.MAX_N)} 筆,實得 ${sel.length})`);
  // ---- 控制組:這三條與 --break-refl 無關,MUST 恆綠 ----
  const many = [];
  for (let k = 0; k < REFL.MAX_N * 3; k++) many.push({ x: (k % 20) * 7, z: Math.floor(k / 20) * 7, y: -1, h: 20 + k, r: 5 });
  ok(plan(terr, many).length === REFL.MAX_N,
    `上限 = REFL.MAX_N(${REFL.MAX_N};一份幾何一個 mesh ⇒ 上限是頂點預算不是 draw call)`);
  const tie = [{ x: 5, z: 0, y: -1, h: 20, r: 5 }, { x: -5, z: 0, y: -1, h: 20, r: 5 }];
  ok(plan(terr, tie)[0].x === -5 && plan(terr, tie.slice().reverse())[0].x === -5,
    '排序是**全序**(同分再比座標)—— 「前 N 個」在兩台客戶端上要是同一批,否則兩人看到的倒影不一樣');
  ok(plan(terr, [{ x: 0, z: 0, y: -1, h: REFL.MIN_H, r: 5 }]).length === 0,
    `水面上不到 REFL.MIN_H(${REFL.MIN_H}m)的東西不進名冊`);
  ok(plan({ ...terr, heightAt: () => 400 }, inner).length === 0,
    '腳不在近岸帶(站在高地上)的東西不進名冊 —— 近岸帶刻意**沿用同一個 MIN_H**(一個授權值,不是兩個)');
  ok(plan({ ...terr, waterY: null }, inner).length === 0, '無水域 ⇒ 空名冊(原則 6)');

  // ---- ③ 幾何與材質的原文契約 ----
  let buildSrc = `function buildWaterReflections(group, terrain, blockers, dynamics) ${grabBlock(bioC, 'function buildWaterReflections(group, terrain, blockers, dynamics) {')}`;
  if (BRK.fade) buildSrc = bend(buildSrc, / \/ REFL_WAVE_WRITERS;/, ';', '--break-fade');
  ok(/terrain\.seaFadeAtWorld\(b\.x, b\.z\) \/ REFL_WAVE_WRITERS/.test(buildSrc),
    'seaFade 的唯一來源 = terrain.seaFadeAtWorld(抄一份的症狀只是「圖界附近的倒影塊浮在平的水面上晃」),而且除以補償常數');
  ok(count(buildSrc, /terrain\.seaFadeAtWorld\(/g) === 1, 'seaFade 取值恰一處');
  ok(/mulberry32\(edgeSeed\(b\.x, b\.z/.test(buildSrc) && !/\brnd\b\s*[,)]|Math\.random\(/.test(buildSrc),
    '逐反射體的變化由**落點雜湊**自帶種子 ⇒ 零共享 `rnd()` 消耗(§2.3;同 flags.js / edgewall.js)');
  ok(/const gj = [^\n]*rnd\(\)[^\n]*\n\s*const wj = [^\n]*rnd\(\)[^\n]*\n\s*const g =/.test(buildSrc),
    '每段固定消耗 2 枚、淘汰檢查排在抽樣**之後**(§2.3 抽樣紀律)');
  ok(!/new THREE\.(Raw)?ShaderMaterial\(/.test(buildSrc) && /envMat\(REFL_C, \{/.test(buildSrc),
    '走 applyCelPatch 的 define 而不是自寫 ShaderMaterial(gInfo 宣告 / 軟性 alpha / 世界曲面三條**結構性繼承**)');
  ok(/refl: \{ y: wy \}/.test(buildSrc) && /soft: seaSoft\(\)/.test(buildSrc),
    '材質吃 refl(⇒ CEL_REFL + 類別碼恆 NONE)與 soft: seaSoft()(浪的振幅/頻率與水盤**同一份**)');
  ok(/mesh\.frustumCulled = false/.test(buildSrc),
    'frustumCulled MUST 關(頂點在著色器裡才拿到世界位置 ⇒ 包圍盒是原點旁邊一小塊,開著就整片不畫)');
  ok(/mesh\.castShadow = false/.test(buildSrc),
    'castShadow MUST 維持 false(陰影走 MeshDepthMaterial,沒有 CEL_REFL 補丁 ⇒ 會投出一片退化四邊形的影子)');
  ok(!/mesh\.position|mesh\.rotation|mesh\.scale/.test(buildSrc),
    'mesh MUST 掛在**世界原點**(identity matrix)—— 頂點分支直接把世界座標寫回 transformed,自己再帶一個位移就整批偏掉');
  ok(/aReflO/.test(buildSrc) && /'seaFade'/.test(buildSrc),
    '兩個逐頂點屬性(aReflO = 反射體的世界 XZ + 水上高;seaFade = 浪幅淡出)都掛上去了');
  ok(/visualPref\('reflect'\)/.test(buildSrc) && /mesh\.visible = a > 0/.test(buildSrc),
    '`reflect` 拉桿 = 0 ⇒ mesh 不可見 ⇒ 一個 draw call 都不進、一個像素都不寫(⑤-3 逐位元同舊制的證明面)');
  ok(!/REFL\.(SEG_N|GAP_F|MIN_H|MAX_N|HALF_F)\s*=/.test(bioC)
    && /REFL\.SEG_N/.test(buildSrc) && /REFL\.HALF_F/.test(buildSrc) && /REFL\.GAP_F/.test(buildSrc),
    '形狀常數一律取 toon.js 的 `REFL`,biomes.js **不手寫**(同 SEA_M/SEA_SEG 的紀律)');
  // 接線順序:名冊由碰撞柱推導 ⇒ MUST 排在所有 blockers.push 之後
  const iLastPush = bioC.lastIndexOf('blockers.push');
  // **MUST 找呼叫點不是宣告點**:函式簽章裡就有同一串字,`indexOf` 會停在檔案前段的宣告上
  // ⇒ 這一條就變成「宣告排在 push 之前」= 恆假,而紅字的理由完全不對(寫的時候踩過)。
  const iCall = bioC.indexOf('= buildWaterReflections(group, terrain, blockers, dynamics)');
  ok(iCall > iLastPush && iCall > 0,
    '接線 MUST 排在**所有** blockers.push 之後(少一批就是「那幾棟樓在水裡沒有影子」;同 planClimbRoutes)');
}

// ---------------------------------------------------------------- Ⅳ
console.log('\nⅣ 舊的格點泡沫片已退場(§6;兩份 shore band 並存 = 硬邊被軟 alpha 糊掉)');
{
  ok(!/shoreFoamTex/.test(bioC), '`shoreFoamTex()` 全檔零命中(連帶移除三個只染像素的 Math.random)');
  ok(!/foamTex/.test(bioC), '泡沫貼圖與它的 offset 漂移零命中');
  ok(!/mat\.opacity = 0\.36/.test(bioC), '「潮汐呼吸」(逐幀改 opacity)零命中');
  ok(/function buildWaterEdges\(group, terrain\)/.test(bioC),
    '`buildWaterEdges` 不再收 `dynamics`(泡沫是它唯一的動態消費端 ⇒ 留著就是一個沒人用的參數)');
  ok(/濕泥色/.test(bioSrc) && /tidx\.length/.test(bioC),
    '**潮間帶保留**(那是 envCode 2↔0 的另一件事,與泡沫無關)');
  ok(/celFoam/.test(toonC) && !/celFoam/.test(bioC),
    '現制的泡沫只住 toon.js 的 `celFoam`(biomes.js 一個字都沒有 ⇒ 不可能有第二份)');
}

// ---------------------------------------------------------------- Ⅴ
console.log('\nⅤ 純表現層(waterY / 涉水物理 / 水沼分類一格不碰)');
{
  const simSrc = readSrc('server', 'sim.js');
  const dataSrc = readSrc('public', 'js', 'data.js');
  for (const [n, s] of [['server/sim.js', simSrc], ['public/js/data.js', dataSrc]])
    ok(!/seaField|celFoam|stampSeaBlockers|seaFadeAtWorld|bakeSeaDepth/.test(s),
      `${n} 零命中(權威層一行未改 ⇒ npm run bal / npm test MUST 逐項不動)`);
  const envCode = `function terrainEnvCode(terrain, x, z) ${grabBlock(bioC, 'function terrainEnvCode(terrain, x, z) {')}`;
  ok(!/seaField|Foam|stampSea/.test(envCode),
    '`terrainEnvCode` MUST NOT 讀深度場 —— 「表現層規劃反過來決定權威水沼分類」那條口子是使用者 2026-08-13 逐案裁決的,MUST NOT 擴大適用');
  const bakeReal = `function bakeSeaDepth() ${grabBlock(terrC, 'function bakeSeaDepth() {')}`;
  const stampReal = `function stampSeaBlockers(blockers) ${grabBlock(terrC, 'function stampSeaBlockers(blockers) {')}`;
  ok(!/waterY\s*=[^=]/.test(bakeReal) && !/waterY\s*=[^=]/.test(stampReal) && !/heights\[[^\]]*\]\s*=/.test(stampReal),
    '兩支都只**讀** waterY 與 heights(寫回去 = 純表現層改到了涉水深與道路跨水判定)');
  // 水面幾何一行未動:分段數與兩張水面的 seaFade 仍是舊制那一份
  ok(/const wEdge = Math\.min\(curveMaxEdgeM\(\), seaSegM\(\)\);/.test(terrC),
    '水盤分段數一行未動(`min(curveMaxEdgeM, seaSegM)`;audit_world_curve 的水面那一條同吃)');
  ok(/wgeo\.setAttribute\('seaFade', new THREE\.BufferAttribute\(new Float32Array\(wp\.length \/ 3\), 1\)\)/.test(terrC),
    '緩衝空間外環水面仍顯式補 seaFade = 0 ⇒ `celFoam × vSeaFade` 恆 0 ⇒ 地平線那一圈**結構上**沒有泡沫');
  // seaFadeAt 是**轉呼**不是第二份實作(而 seaFadeOf MUST 保持自給自足)
  ok(/export const seaFadeAt = \(lx, ly, w, h\) => seaFadeOf\(/.test(terrC),
    '`seaFadeAt` 是轉呼 `seaFadeOf` 的薄殼(第二份實作的症狀只是「圖界附近的倒影塊浮在平的水面上晃」)');
  // alpha 是**共用通道**:對不透明的 cel 材質它是勾線門檻倍率(CEL_SOFT / CEL_INKA 契約),
  // 對水面是不透明度。`celFoam` 那一段把 a 推向 1(泡沫蓋住水底)在水面上是對的,但它
  // **只包在 `#ifdef CEL_WAVE` 裡、沒有再問一次 transparent** ⇒ 哪天有人把 `soft: seaSoft()`
  // 掛到不透明件上,那批物件的細勾線會靜默消失。消費端這一側守得住的就是這一條。
  const enclosing = (s, i) => {
    let d = 0, a = i;
    for (; a >= 0; a--) { const c = s[a]; if (c === '}') d++; else if (c === '{') { if (!d) break; d--; } }
    let b = a, e = 0;
    for (; b < s.length; b++) { const c = s[b]; if (c === '{') e++; else if (c === '}') { e--; if (!e) { b++; break; } } }
    return s.slice(a, b);
  };
  let seaUses = 0, seaOpaque = 0;
  for (const s of [terrC, bioC]) {
    let i = s.indexOf('soft: seaSoft()');
    while (i >= 0) { seaUses++; if (!/transparent: true/.test(enclosing(s, i))) seaOpaque++; i = s.indexOf('soft: seaSoft()', i + 1); }
  }
  ok(seaUses >= 2 && seaOpaque === 0,
    `吃 seaSoft() 的材質(${seaUses} 處)MUST 全部是 transparent —— 泡沫那一段把 gl_FragColor.a 推向 1,掛到不透明件上就是把 uSoftInk 蓋掉 = 那批物件的細勾線靜默消失`);
  const fadeOf = /^function seaFadeOf\(geo, w, h\) \{[\s\S]*?^\}/m.exec(terrC);
  ok(!!fadeOf && !/seaFadeAt/.test(fadeOf[0]),
    '`seaFadeOf` MUST 保持自給自足(只用 smooth01 / edgeWallInsetM)—— audit_soft_stroke Ⅵ 把它的原文丟進只注入那兩支的沙箱,反過來抽會讓那支在**呼叫時**丟 ReferenceError');
}

const flags = [BRK.foam && '--break-foam', BRK.stamp && '--break-stamp',
  BRK.refl && '--break-refl', BRK.fade && '--break-fade'].filter(Boolean).join(' ');
console.log(`\n${fail ? '❌' : '✅'} ${pass} 通過 / ${fail} 失敗${flags ? `  (${flags})` : ''}`);
process.exit(fail ? 1 : 0);
