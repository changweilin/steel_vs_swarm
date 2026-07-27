// ============ 表現層資源生命週期稽核(GPU 洩漏 / 每幀熱路徑)============
// 用途:效能回歸的靜態防線。這一類 bug 在功能測試裡**永遠是綠的** —— 遊戲照跑、命中照算,
// 只有幀率隨對局時間往下掉,所以必須用「原始碼文字」把規則釘住。
//
// 釘住四條:
//   ① 地形不得回到 raycast 目標:`terrain.mesh` MUST NOT 出現在 intersectObjects 的引數裡
//      (193² = 73,728 個三角形,three 每次逐面線性掃完 ⇒ 每顆子彈每幀 ~1ms)。
//   ② 一次性 3D 物件從場景移除時 MUST 釋放 GPU 資源:`scene.remove` 不會 dispose 幾何/材質,
//      three 靠 dispose 事件回收 —— 漏掉就是「打越久越卡」。彈體走物件池(_dropBullet)、
//      特效走 _freeEffect。
//   ③ 共用幾何 MUST 經 toon.js `markShared` 註冊(否則 disposeTree 會把整場共用的那份放掉,
//      之後所有借用者變空白)。
//   ④ 高頻特效 MUST NOT 每次新建幾何:beamLine / axisCylinder / shockRing / 能量珠一律
//      吃單位幾何 + scale。
// 跑法:`node tools/audit_gpu_lifecycle.mjs`
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(join(ROOT, 'public', 'js', f), 'utf8');
const game = read('game.js'), vfx = read('vfx.js'), toon = read('toon.js'), castfx = read('castfx.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
/** 去掉註解與樣板字串,只留「真的會執行的程式碼」—— 註解裡提到 terrain.mesh 不算違規 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const G = code(game), V = code(vfx);

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
}

console.log('\n⑤ 觸控裝置的填充率設定');
{
  ok(/antialias: !isTouchUI\(\)/.test(G), '觸控裝置關閉 MSAA(行動 GPU 頻寬瓶頸)');
  ok(/TOUCH_DPR_MAX/.test(G) && /isTouchUI\(\) \? TOUCH_DPR_MAX : 2/.test(G),
    '像素比上限:觸控 TOUCH_DPR_MAX / 桌機 2(桌機行為不變)');
  ok(/lowPower\(\)\) return 1/.test(G), '低功耗模式仍夾到 1(舊行為不得回歸)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
