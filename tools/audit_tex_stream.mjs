// ============ Texture streaming / Virtual Texturing seam audit (presentation only) ============
// Guards the camera-view & distance-driven VRAM mip streaming single seam:
//   ① `public/js/tex.js` is zero-import, deterministic (no RNG), and server-isolated.
//   ② Pure distance / visibility / sniper-zoom / hysteresis math resolves level 0
//     (near), level 1 (mid), level 2 (far), and maxDrop (beyond FAR_M or invisible /
//     frustum-culled / occluded / outside sniper scope circle).
//   ③ `applyTexLevel` disposes the old WebGLTexture before slicing `tex.mipmaps`
//     so WebGL2 immutable `texStorage2D` frees high-res VRAM and allocates the
//     downsampled pyramid; `tex.userData.texStream` stays non-enumerable.
//   ④ Producer wiring (`terrain.js`, `ground.js`, `biomes.js`, `paint.js`,
//     `worldtext.js`, `vesselModels.js`) and `game.js` `_tickTexStream()` between
//     `_tickCull()` and `_renderCulledMain()`.
// Run: `node tools/audit_tex_stream.mjs`
import { readSrc } from './audit_src.mjs';
import {
  MIP_ANISO,
  TEX_STREAM,
  mipLevels,
  mipExtent,
  vramBytesOfChain,
  streamBandM,
  streamMaxDrop,
  streamTargetLevel,
  registerStreamTex,
  applyTexLevel,
  collectMatStreamTexs,
  collectTreeStreamTexs,
  meshStreamAnchors,
  noteTexDemand,
  flushTexStream,
} from '../public/js/tex.js';
import { lodDue } from '../public/js/lod.js';

let texSrc = readSrc('public', 'js', 'tex.js');
let gameSrc = readSrc('public', 'js', 'game.js');
let terrainSrc = readSrc('public', 'js', 'terrain.js');
const groundSrc = readSrc('public', 'js', 'ground.js');
const biomesSrc = readSrc('public', 'js', 'biomes.js');
const paintSrc = readSrc('public', 'js', 'paint.js');
const worldtextSrc = readSrc('public', 'js', 'worldtext.js');
const vesselSrc = readSrc('public', 'js', 'vesselModels.js');
const simSrc = readSrc('server', 'sim.js');

let pass = 0, fail = 0;
const ok = (c, msg) => {
  if (c) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
};

const BREAKS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--break-')));
const bend = (src, tag, re, to) => {
  if (!BREAKS.has(tag)) return src;
  const out = src.replace(re, to);
  if (out === src) {
    console.error(`✗ ${tag}: pattern did not match target source`);
    process.exit(1);
  }
  return out;
};

gameSrc = bend(gameSrc, '--break-tick', /this\._tickTexStream\(\);/, 'this._tickTexStreamX();');
texSrc = bend(texSrc, '--break-dispose', /if \(typeof tex\.dispose === 'function'\) tex\.dispose\(\);/, '');
terrainSrc = bend(terrainSrc, '--break-producer', /registerStreamTex\(tex\);/, '');

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('== Texture streaming / Virtual Texturing seam audit ==\n');

console.log('① tex.js 零依賴單一縫與權威層隔離');
{
  const T = code(texSrc);
  ok(!/^\s*import\s/m.test(T), 'tex.js 無 import(零外部依賴,離線可直測)');
  ok(!/Math\.random|mulberry32/.test(T), 'tex.js 零亂數消耗(純決定性降採樣與距離映射)');
  ok(!/tex\.js/.test(code(simSrc)), '伺服器權威層(sim.js)不引用 tex.js');
  ok(MIP_ANISO === 4 && TEX_STREAM.NEAR_M === 150 && TEX_STREAM.MID_M === 300 && TEX_STREAM.FAR_M === 600,
    '距離分級錨定 150 / 300 / 600m(與 LOD.NEAR_M / MID_M / FAR_M 對齊)');
  ok(/if \(typeof tex\.dispose === 'function'\) tex\.dispose\(\);/.test(T),
    'applyTexLevel 切換 mipmaps[0] 前必先呼叫 tex.dispose() 釋放舊 WebGL2 texStorage2D');
}

console.log('\n② 距離、視野剔除、狙擊倍率與遲滯純數學驗證');
{
  const b0 = vramBytesOfChain(1024, 1024, 0);
  const b1 = vramBytesOfChain(1024, 1024, 1);
  const b2 = vramBytesOfChain(1024, 1024, 2);
  const b3 = vramBytesOfChain(1024, 1024, 3);
  ok(b0 === 5592404 && b1 === 1398100 && b2 === 349524 && b3 === 87380,
    `1024² RGBA8 mip 鏈顯存精確遞減(L0=${b0}B → L1=${b1}B → L2=${b2}B → L3=${b3}B,省 98.4%)`);
  ok(streamMaxDrop(1024, 1024) === 3 && streamMaxDrop(64, 64) === 2 && streamMaxDrop(16, 16) === 0,
    'streamMaxDrop 守住 MIN_RES_PX=16px 底線(小貼圖不退化到邊界溢色)');

  // Visible across distance bands (normal mode, aimBlend = 0)
  ok(streamTargetLevel(80 * 80, true, 0) === 0, '視野內近景(80m ≤ 150m) → Level 0 (全解析度)');
  ok(streamTargetLevel(220 * 220, true, 0) === 1, '視野內中景(220m ≤ 300m) → Level 1 (1/2 解析度)');
  ok(streamTargetLevel(450 * 450, true, 0) === 2, '視野內遠景(450m ≤ 600m) → Level 2 (1/4 解析度)');
  ok(streamTargetLevel(750 * 750, true, 0) === 3, '超遠景(750m > 600m) → Level 3 (1/8 低清版本)');

  // Invisible / culled (outside frustum, occluded, or outside sniper scope mask)
  ok(streamTargetLevel(20 * 20, false, 0) === 3 && streamTargetLevel(20 * 20, false, 1) === 3,
    '不可見區域(視錐外 / 遮擋剔除 / 狙擊鏡圈外,即使距離 20m) → 僅載入低清版本(Level 3)');

  // Sniper zoom extension (aimBlend = 1 doubles band distances)
  ok(streamBandM(150, 1) === 300 && streamTargetLevel(250 * 250, true, 1) === 0,
    '狙擊開鏡(aimBlend=1)鏡圈內 250m 目標自動升階為 Level 0 高清貼圖');

  // Hysteresis anti-flapping at 150m boundary (HYST = 0.9 => 135m upgrade threshold)
  ok(streamTargetLevel(142 * 142, true, 0, 0) === 0 && streamTargetLevel(142 * 142, true, 0, 1) === 1
    && streamTargetLevel(130 * 130, true, 0, 1) === 0,
    '邊界遲滯(135m~150m 遲滯帶):原 L0 維持 L0、原 L1 需進入 ≤135m 才升回 L0,杜絕邊界抖動');
}

console.log('\n③ 貼圖生命週期、多消費端需求匯流與分幀預算實測');
{
  let disposedCount = 0;
  const mockTex = {
    image: { width: 512, height: 512 },
    mipmaps: [],
    userData: {},
    dispose() { disposedCount++; },
  };
  registerStreamTex(mockTex, { id: 'test_512' });
  const st = mockTex.userData.texStream;
  ok(st && st.chain.length === mipLevels(512, 512) && mockTex.generateMipmaps === false,
    'registerStreamTex 建立完整 CPU mip 鏈並關閉自動 generateMipmaps');
  ok(JSON.stringify(mockTex.userData) === '{}',
    'tex.userData.texStream 設為 non-enumerable(避免 Texture.copy JSON.stringify 破壞 canvas 鏈)');

  // Downgrade to level 3 (64x64)
  const changedDown = applyTexLevel(mockTex, 3);
  ok(changedDown && disposedCount === 1 && st.level === 3
    && mockTex.image.width === 64 && mockTex.mipmaps[0].width === 64
    && st.vramBytes === vramBytesOfChain(512, 512, 3),
    '降階至 Level 3:先 dispose 舊緩衝,再將基底 mip 切為 64×64');

  // Upgrade back to level 0 (512x512)
  const changedUp = applyTexLevel(mockTex, 0);
  ok(changedUp && disposedCount === 2 && st.level === 0
    && mockTex.image.width === 512 && mockTex.mipmaps[0].width === 512
    && st.vramBytes === vramBytesOfChain(512, 512, 0),
    '升階回 Level 0:先 dispose 低清緩衝,再還原 512×512 完整 mip 鏈');

  // Multi-consumer demand aggregation + flushTexStream
  const texShared = registerStreamTex({ image: { width: 256, height: 256 }, mipmaps: [], userData: {} }, { id: 'shared' });
  const texCulled = registerStreamTex({ image: { width: 256, height: 256 }, mipmaps: [], userData: {} }, { id: 'culled' });
  // Frame 1: texShared is used by an invisible mesh at 30m, a visible mesh at 400m, and a visible mesh at 180m
  noteTexDemand(texShared, 30 * 30, false, 1);
  noteTexDemand(texShared, 400 * 400, true, 1);
  noteTexDemand(texShared, 180 * 180, true, 1);
  // texCulled is only used by an invisible/culled mesh at 40m
  noteTexDemand(texCulled, 40 * 40, false, 1);
  const stats = flushTexStream([texShared, texCulled], 1, 0, { forceAll: true, isDue: lodDue });
  ok(texShared.userData.texStream.level === 1 && texCulled.userData.texStream.level === 3 && stats.savedVramBytes > 0,
    '多消費端匯流:共用貼圖取最近可見距離(180m→L1),全不可見貼圖降為最低清(L3)');

  // Tree collection & spatial cell anchors
  const root = {
    traverse(fn) {
      fn({
        isMesh: true,
        material: {
          map: texShared,
          userData: { celOpts: { paint: { tex: texCulled } } },
        },
      });
    },
  };
  const collected = collectTreeStreamTexs(root);
  ok(collected.length === 2 && collected.includes(texShared) && collected.includes(texCulled),
    'collectTreeStreamTexs 完整蒐集 map / emissiveMap / paint.tex 三種材質貼圖槽');

  const wideMesh = {
    geometry: {
      attributes: {
        position: {
          count: 4,
          array: new Float32Array([-300, 0, -300, -290, 0, -290, 300, 0, 300, 310, 0, 310]),
        },
      },
    },
  };
  const anchors = meshStreamAnchors(wideMesh, 64);
  ok(anchors.length === 2 && anchors[0].x < 0 && anchors[1].x > 0,
    'meshStreamAnchors 將跨區大網格切分為空間格網錨球(遠處分塊不釘死近處解析度)');

  const instCount = 2048;
  const instArr = new Float32Array(instCount * 16);
  for (let i = 0; i < instCount; i++) {
    const base = i * 16;
    instArr[base] = 1; instArr[base + 5] = 1; instArr[base + 10] = 1; instArr[base + 15] = 1;
    instArr[base + 12] = i === 17 ? 10 : 900;
    instArr[base + 14] = i === 17 ? 10 : 900;
  }
  const instAnchors = meshStreamAnchors({
    isInstancedMesh: true,
    count: instCount,
    instanceMatrix: { array: instArr },
  }, 64);
  ok(instAnchors.length === 2 && instAnchors.some((a) => Math.abs(a.x - 10) < 1),
    'meshStreamAnchors 完整掃描 InstancedMesh 全部實例(不因抽樣步進漏掉近處格網)');
}

console.log('\n④ 貼圖產出端與 game.js 渲染管線接線驗證');
{
  const G = code(gameSrc);
  ok(/registerStreamTex\(tex\)/.test(code(terrainSrc)), 'terrain.js 衛星影像貼圖已註冊串流');
  ok((code(groundSrc).match(/registerStreamTex\(t\)/g) || []).length >= 2, 'ground.js 地被與邊界貼圖已註冊串流');
  ok((code(biomesSrc).match(/registerStreamTex\(/g) || []).length >= 7,
    'biomes.js 葉卡/國旗/立面(map+emissive)/道路/基地與砲塔標線/擋土牆貼圖全數註冊串流');
  ok((code(paintSrc).match(/registerStreamTex\(tex\)/g) || []).length >= 2, 'paint.js 機體塗裝與日之丸貼花已註冊串流');
  ok(/registerStreamTex\(tex\)/.test(code(worldtextSrc)), 'worldtext.js 世界文字圖集已註冊串流');
  ok(/registerStreamTex\(texture\)/.test(code(vesselSrc)), 'vesselModels.js 船舷字樣貼圖已註冊串流');

  ok(/import \{[^}]*flushTexStream[^}]*\} from '\.\/tex\.js'/.test(G), 'game.js 引用 tex.js 串流介面');
  ok(/this\._tickCull\(\);\s*this\._tickTexStream\(\);\s*this\._renderCulledMain\(\);/.test(G),
    '_tickTexStream 嚴格位於 _tickCull 之後、_renderCulledMain 之前(首幀渲染前先降階遠處/視野外貼圖)');
  ok(/ent\._cullFrame === frame/.test(G) && !/new Set\(this\._culled\)/.test(G),
    '_tickTexStream 透過 _cullFrame 戳記 O(1) 判定剔除態(零 Set 配置)');
  ok(/flushTexStream\(reg, frame, aimBlend, \{ isDue: lodDue, forceAll \}\)/.test(G),
    '_tickTexStream 複用 lod.js lodDue 節流與 dofAimBlend 狙擊曲線');
  ok(/this\._streamTexReg\?\.clear\(\)/.test(G), 'dispose() 離場清空 _streamTexReg 貼圖註冊表');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
