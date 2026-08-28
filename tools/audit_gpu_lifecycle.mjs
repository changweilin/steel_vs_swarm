// ============ 表現層資源生命週期稽核(GPU 洩漏 / 每幀熱路徑)============
// 用途:效能回歸的靜態防線。這一類 bug 在功能測試裡**永遠是綠的** —— 遊戲照跑、命中照算,
// 只有幀率隨對局時間往下掉,所以必須用「原始碼文字」把規則釘住。
//
// 釘住四條:
//   ① 地形不得回到 raycast 目標:`terrain.mesh` MUST NOT 出現在 intersectObjects 的引數裡
//      (193² = 73,728 個三角形,three 每次逐面線性掃完 ⇒ 每顆子彈每幀 ~1ms)。
//   ② 一次性 3D 物件從場景移除時 MUST 釋放 GPU 資源:`scene.remove` 不會 dispose 幾何/材質,
//      three 靠 dispose 事件回收 —— 漏掉就是「打越久越卡」。彈體走物件池(_dropBullet)、
//      特效走 _freeEffect；InstancedMesh 另有 instance buffer，必須顯式 dispose。
//   ③ 共用幾何 MUST 經 toon.js `markShared` 註冊(否則 disposeTree 會把整場共用的那份放掉,
//      之後所有借用者變空白)。
//   ④ 高頻特效 MUST NOT 每次新建幾何:beamLine / axisCylinder / shockRing / 能量珠一律
//      吃單位幾何 + scale。
// 跑法:`node tools/audit_gpu_lifecycle.mjs`
import { readSrc } from './audit_src.mjs';

const read = (f) => readSrc('public', 'js', f);
const game = read('game.js'), vfx = read('vfx.js'), toon = read('toon.js'), castfx = read('castfx.js');
const postfx = read('postfx.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
// ---- 反向驗證(原則 9)----
// 把判定改回壞版本,稽核 MUST 在對應條目紅字。替換無效 MUST **當場失敗** —— `readSrc` 已把
// 換行正規化成 \n,但樣式一旦與原文對不上,break 會安靜地變成 no-op 而整支照樣全綠。
const BREAKS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--break-')));
const bend = (src, tag, re, to) => {
  if (!BREAKS.has(tag)) return src;
  const out = src.replace(re, to);
  if (out === src) { console.error(`✗ ${tag}:替換無效(樣式沒咬到原文,反向驗證等於沒跑)`); process.exit(1); }
  return out;
};
/** 去掉註解與樣板字串,只留「真的會執行的程式碼」—— 註解裡提到 terrain.mesh 不算違規 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const gameSrc = [
  ['--break-resgov-all', /\n(\s*)this\._resGov = \{/, '\n$1if (isTouchUI()) this._resGov = {'],
  ['--break-resgov-flip', /if \(g\.flips >= RES_GOV\.FLIP_MAX\) g\.off = true;/, ''],
  ['--break-resgov-hidden', /if \(typeof document !== 'undefined' && document\.hidden\) return;/, ''],
].reduce((s, [tag, re, to]) => bend(s, tag, re, to), game);
const toonSrc = bend(toon, '--break-instance-dispose', /\n\s*if \(o\.isInstancedMesh\) o\.dispose\(\);/, '');
const vfxSrc = bend(vfx, '--break-vfx-instance', /new THREE\.InstancedMesh/, 'new THREE.Mesh');
const G = code(gameSrc), V = code(vfxSrc), T = code(toonSrc);

console.log('== 表現層資源生命週期稽核 ==\n');

console.log('① 地形不回 raycast 目標');
{
  const calls = [...G.matchAll(/intersectObjects?\(([^;]*?)\)/g)].map((m) => m[1]);
  ok(calls.length > 0, `找得到 raycast 呼叫(${calls.length} 處)`);
  ok(!calls.some((a) => /terrain\s*\.\s*mesh/.test(a)),
    'intersectObjects 的目標清單不含 terrain.mesh');
  ok(/rayTerrain\s*\?\.\(/.test(G) || /rayTerrain\(/.test(G), 'game.js 改走 terrain.rayTerrain 解析射線');
  ok(/function rayTerrain\(/.test(read('terrain.js')), 'terrain.js 提供 rayTerrain');
  ok(/rayTerrain,/.test(read('terrain.js')), 'rayTerrain 已列入 terrain 回傳介面');
}

console.log('\n② 一次性物件回收');
{
  ok(/_dropBullet\(b\)/.test(G), '彈體移除走 _dropBullet(物件池 / 釋放)');
  // 彈體/視覺彈體的移除路徑不得只有裸 scene.remove
  const bulletBareRemove = /scene\.remove\(b\.mesh\)\s*;\s*\n\s*this\.(bullets|_visShells)\.splice/.test(G);
  ok(!bulletBareRemove, '彈體 MUST NOT 只 scene.remove 就 splice(那是 GPU 洩漏)');
  ok(/_freeEffect\(e\)/.test(G) && /this\.effects\.splice\(i, 1\)/.test(G),
    '特效逾時走 _freeEffect(釋放後才 splice)');
  ok(/e\.dispose\s*\(\)\s*;?\s*else\s+disposeTree\(e\.obj\)/.test(G),
    '_freeEffect:自帶 dispose 優先,否則走共用 disposeTree');
  ok(/FX_MAX/.test(G) && /const FX_MAX = \d+/.test(G), '特效清單有上限保險 FX_MAX');
  ok(/PROJ_POOL_MAX/.test(G), '彈體池有池深上限 PROJ_POOL_MAX');
  ok(/for \(const e of this\.effects\) this\._freeEffect\(e\)/.test(G),
    'dispose():離場時清空特效(不把上一局的緩衝帶進下一局)');
  ok(/this\._projPool/.test(G) && /disposeTree\(m\)/.test(G), 'dispose():彈體池一併釋放');
  ok(/if \(o\.isInstancedMesh\) o\.dispose\(\)/.test(T),
    'disposeTree 顯式釋放 InstancedMesh 自有的 instance buffer');
}

console.log('\n③ 共用幾何註冊');
{
  ok(/export function markShared\(/.test(toon) && /export function disposeTree\(/.test(toon),
    'toon.js 是 markShared / disposeTree 的唯一縫');
  ok(!/function disposeTree\(/.test(code(castfx)), 'castfx.js MUST NOT 自帶第二份 disposeTree');
  ok(/import \{[^}]*markShared[^}]*\} from '\.\/toon\.js'/.test(castfx), 'castfx.js 引用共用 markShared');
  ok(/import \{[^}]*markShared[^}]*\} from '\.\/toon\.js'/.test(vfx), 'vfx.js 引用共用 markShared');
  // castfx 的 5 個共用幾何常數都要包在 markShared 裡
  const un = ['PLANE', 'CYL', 'OCT', 'DOME', 'SHELL']
    .filter((k) => !new RegExp(`const ${k} = markShared\\(`).test(castfx));
  ok(un.length === 0, `castfx.js 共用幾何全數 markShared${un.length ? `(漏:${un.join(', ')})` : ''}`);
  ok(/_unitGeo\.set\(key, g = markShared\(make\(\)\)\)/.test(V), 'vfx.js 單位幾何工廠一律 markShared');
}

console.log('\n④ 高頻特效不重配幾何');
{
  // 取函式本體。**先吃完參數列**再開始配對大括號 —— 解構預設值(`{ ttl = 0.4 } = {}`)
  // 也是大括號,從函式名直接數的話第一組參數括號就會把本體「收掉」,抽出來永遠是空的。
  const fn = (name) => {
    const i = V.indexOf(`function ${name}(`);
    if (i < 0) return '';
    let j = V.indexOf('(', i), pd = 0;
    for (; j < V.length; j++) {
      if (V[j] === '(') pd++;
      else if (V[j] === ')') { pd--; if (pd === 0) { j++; break; } }
    }
    let d = 0, started = false;
    for (; j < V.length; j++) {
      if (V[j] === '{') { d++; started = true; }
      else if (V[j] === '}') { d--; if (started && d === 0) { j++; break; } }
    }
    return V.slice(i, j);
  };
  for (const [name, expect] of [['beamLine', 'unitCylinder'], ['axisCylinder', 'unitCylinder'],
    ['shockRing', 'unitRing'], ['gundamBeam', 'unitRing'], ['ionBreath', 'unitThroat']]) {
    const body = fn(name);
    ok(body.includes(expect), `${name} 使用共用單位幾何(${expect})`);
    ok(!/new THREE\.(Cylinder|Ring|Sphere)Geometry\(/.test(body), `${name} 不再每次 new 幾何`);
  }
  ok(/const _numTex = new Map\(\)/.test(V), '傷害數字貼圖有快取(不再每發上傳一張)');
  ok(!/dispose\(\) \{ mat\.map\.dispose\(\)/.test(V), '快取貼圖 MUST NOT 被單次特效 dispose');
  ok((fn('gundamBeam').match(/new THREE\.InstancedMesh/g) || []).length === 1,
    '光束行進環合併為單一 InstancedMesh(draw call 不隨環數增加)');
  ok((fn('ionBreath').match(/new THREE\.InstancedMesh/g) || []).length === 2,
    '離子珠 / 電弧各合併為一個 InstancedMesh(draw call 固定為 2)');
}

console.log('\n⑤ 觸控裝置的填充率設定');
{
  // MSAA 對 pass 畫出來的勾線一點用都沒有 ⇒ 後製管線上線後改由 FXAA 負責;
  // 只有 `?post=0`(退回舊的直接 render)才把 MSAA 開回來,且仍維持舊制「觸控一律關」。
  ok(/antialias: off\('post'\) && !isTouchUI\(\)/.test(G),
    'MSAA 只在 ?post=0 的退路上開,且觸控仍一律關(舊行為不得回歸)');
  ok(/TOUCH_DPR_MAX/.test(G) && /isTouchUI\(\) \? TOUCH_DPR_MAX : 2/.test(G),
    '像素比上限:觸控 TOUCH_DPR_MAX / 桌機 2(桌機行為不變)');
  ok(/lowPower\(\)\) return 1/.test(G), '低功耗模式仍夾到 1(舊行為不得回歸)');
}

console.log('\n⑥ 自適應解析度調節器(全平台,天花板以下浮動)');
{
  ok(/const RES_GOV = \{/.test(G) && /_tickResGov\(/.test(G), '調節器存在(RES_GOV + _tickResGov)');
  // 2026-08-12:桌機一併啟用。舊制的「只在觸控建 _resGov」MUST NOT 復辟 —— 桌機 4K 螢幕的
  // 天花板是 2(每幀 4 倍像素),而內顯與獨顯差一個量級,舊制在那裡的行為就只是掉幀。
  ok(/\n\s*this\._resGov = \{/.test(G) && !/if \(isTouchUI\(\)\) this\._resGov =/.test(G),
    '全平台啟用(撐得住時 _resScale 恆 1 ⇒ 一次 setPixelRatio 都不會打,逐位元同舊制)');
  ok(/if \(!g \|\| g\.off \|\| !\(ms > 0\) \|\| ms > RES_GOV\.SPIKE_MS\) return/.test(G),
    '尖峰幀過濾(GC / 載入 / 分頁切回不觸發降階)+ 熄火後完全退出');
  ok(/document\.hidden\) return;/.test(G),
    '背景分頁不入帳(切回來的補償幀不代表穩態負載,會白白吃掉一階)');
  ok(/Math\.max\(RES_GOV\.MIN, /.test(G), '降階有下限 RES_GOV.MIN(不會無限降到糊)');
  ok(/this\._resScale = Math\.min\(1, /.test(G), '升階上限 = 1(動態縮放 MUST NOT 突破 _dpr() 天花板)');
  ok(/this\.renderer\.setPixelRatio\(this\._dpr\(\) \* this\._resScale\)/.test(G),
    '像素比落地唯一出口 _applyRes(天花板 × 縮放,勿散寫 setPixelRatio)');
  ok(/g\.cool = Math\.min\(RES_GOV\.COOL_MAX, g\.cool \* 2\)/.test(G),
    '升階指數退避(能力邊界不震盪)');
  // 震盪熄火:退避拉長的是「多久再試一次」,救不了「能力剛好卡在兩階之間」——
  // 那種機器上升降會一直交替,而每次調整都要重配整條後製鏈的 RT。
  ok(/FLIP_MAX/.test(G) && /if \(g\.flips >= RES_GOV\.FLIP_MAX\) g\.off = true;/.test(G),
    '震盪熄火(方向反轉累計 FLIP_MAX 次 ⇒ 永久停手)');
  ok(/if \(g\.dir !== 0 && dir !== g\.dir\) g\.flips\+\+;/.test(G),
    '只數**方向反轉**(連續同向是在收斂,數進去會提早熄火)');
  // 熄火 MUST NOT 回彈:停在當下那一階才是量測認可撐得住的那一階
  const govBody = G.slice(G.indexOf('_tickResGov(ms, now)'), G.indexOf('// ---------------- 快照同步'));
  ok(govBody.length > 100 && !/this\._resScale = 1\b/.test(govBody),
    '熄火 MUST NOT 把 _resScale 拉回 1(那等於把玩家丟回撐不住的那一階)');
  // 落地出口唯一性:game.js 內 setPixelRatio 只准出現在 _initScene 初始化與 _applyRes 兩處
  ok([...G.matchAll(/setPixelRatio\(/g)].length === 2, 'setPixelRatio 全檔僅 2 處(初始化 + _applyRes)');
}

console.log('\n⑦ 後製管線(postfx.js)的資源生命週期與 RES_GOV 交互');
{
  const P = code(postfx);
  ok(/export class Pipeline/.test(P), 'postfx.js 匯出 Pipeline');
  // A25:3 個 RT + depthTexture + 3 個 FullScreenQuad 材質,一個都不能漏
  ok(/dispose\(\) \{[\s\S]*?rt\.depthTexture\?\.dispose\(\)[\s\S]*?rt\.dispose\(\)/.test(P),
    'dispose():三個 RenderTarget 與 depthTexture 都釋放');
  ok(/q\.material\.dispose\(\)[\s\S]*?q\.dispose\(\)/.test(P),
    'dispose():三個 FullScreenQuad 的材質與 quad 本身都釋放');
  const rtN = [...P.matchAll(/new THREE\.WebGLRenderTarget\(/g)].length;
  ok(rtN === 1, `RenderTarget 只有一個建構點(工廠 mk;實測 ${rtN} 處)`);
  ok(/this\.pipeline\?\.dispose\(\)/.test(G), 'game.js dispose() 收掉管線(離場不留殭屍緩衝)');
  // RES_GOV:RT 尺寸 MUST 由 drawing buffer 取得(那已經是 _dpr() × _resScale 的結果)。
  // 管線自己算像素比 = 調節器降階時 RT 尺寸不動 = 調節器整個變成 no-op,而畫面上完全看不出來。
  ok(/getDrawingBufferSize/.test(P), 'RT 尺寸吃 renderer.getDrawingBufferSize(跟著 _resScale 走)');
  ok(!/devicePixelRatio|setPixelRatio/.test(P),
    'postfx.js MUST NOT 自己算像素比(否則 RES_GOV 調節器變成 no-op)');
  // 行動裝置降級路徑:半浮點 RT 在 tile GPU 上是頻寬成本
  ok(/opts\.lowPower \? THREE\.UnsignedByteType : THREE\.HalfFloatType/.test(P),
    '低功耗/觸控走 8bit RT(半浮點的頻寬成本是 tile GPU 的瓶頸)');
  ok(/lowPower: lowPower\(\) \|\| isTouchUI\(\)/.test(G), 'game.js 把低功耗/觸控旗標餵給管線');
  // 最後一 pass 同時負責線性 → sRGB ⇒ 不論開關怎麼設都 MUST 跑
  ok(/chain\.push\('fxaa'\)/.test(P) && /uAA/.test(P),
    'FXAA pass 恆執行(它兼任色彩空間轉換),?fxaa=0 只把邊緣混合關掉');
  ok(/r\.setRenderTarget\(null\)/.test(P), 'render() 結束時 render target 歸零(PiP 照樣畫在畫布上)');
  ok(/off\('post'\) \? null/.test(G), '?post=0 退回舊的直接 render(整支管線可關)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
