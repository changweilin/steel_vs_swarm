// ============ 世界文字(圖資名字 → 招牌)稽核(離線)============
// 這一批的失敗模式全部**不會報錯**,只會「怪怪的」:
//   ・沒有名字時掛出假名/空牌 ⇒ 玩家以為那座洞真的叫這個名字;
//   ・缺字裝置上一排豆腐框 ⇒ 比沒有招牌難看得多;
//   ・牌面長寬比與 atlas 格子分家 ⇒ 字被壓扁,而「有點怪」查不出所以然;
//   ・雙面牌背面鏡像字 ⇒ 只有繞到背後才看得到;
//   ・改了 Overpass 查詢卻沒動快取版本 ⇒ 新標牌在所有「以前開過這張圖」的機器上永遠不出現;
//   ・掛牌時多抽一枚 `rnd()` ⇒ 整張圖的植被/建物佈局跟著位移(§2.3),而畫面上只是「地圖變了」。
// 故逐條釘死。純函式(名字解析)一律**執行真品原文**,幾何規則以原文單一縫查核。
//
// `worldtext.js` import three ⇒ Node 端載不進來,名字解析那幾支以 `new Function` 抽原文執行
// (與 audit_visual_prefs Ⅱ 同一套做法);其餘走 `audit_src.mjs` 讀原文(㋑ CRLF)。
// 用法:node tools/audit_world_text.mjs [--break-cache]
import { readSrc, grabFn } from './audit_src.mjs';
import { pickName, pickRef } from '../public/js/vernacular.js';
import { VISUAL_KNOBS } from '../public/js/visualPrefs.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };

const wtSrc = readSrc('public', 'js', 'worldtext.js');
let bioSrc = readSrc('public', 'js', 'biomes.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const helpSrc = readSrc('public', 'js', 'help.js');
if (process.argv.includes('--break-cache')) {
  const broken = bioSrc.replace(/geoKey\('osmF', 5,/, "geoKey('osmF', 4,");
  if (broken === bioSrc) throw new Error('--break-cache 無法造出舊快取版本');
  bioSrc = broken;
}
const bare = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (bare(s).match(re) || []).length;

// 各語域的格子像素(從 worldtext 原文解析,MUST NOT 手抄一份)
const STYLE_PX = Object.fromEntries(
  [...wtSrc.matchAll(/^  (\w+): \{ cw: (\d+), ch: (\d+)/gm)]
    .map((m) => [m[1], { cw: +m[2], ch: +m[3] }]),
);

// 取名規則住 `vernacular.js pickName`(該檔零 import ⇒ 直接 import 真品,不必抽原文)。
// `worldtext.resolveName` 只是替它補上設定頁那個語言預設值的薄殼 —— 驗的是同一份規則。
const MAX_CHARS = 14;
const resolveName = (tags, lang) => pickName(tags, lang, MAX_CHARS);
const resolveRef = pickRef;

// ============ Ⅰ 名字解析:沒有名字就不掛牌 ============
console.log('\nⅠ 名字解析(resolveName / resolveRef)');
{
  ok(resolveName({ name: '燕子口隧道' }, 'local') === '燕子口隧道', '取得當地名');
  ok(resolveName({}, 'local') === null, '**沒有 name 一律回 null**(MUST NOT 用假名填充,原則 6)');
  ok(resolveName(null, 'local') === null, 'tags 為 null 不炸');
  ok(resolveName({ name: '   ' }, 'local') === null, '全空白視同沒有名字');
  ok(resolveName({ name: 'a'.repeat(40) }, 'local') === null, '超長名字放棄(那是公告欄不是招牌)');
  // 語言:zh / en 取對應譯名,沒有譯名退回原文(MUST NOT 因為沒譯名就整塊消失)
  const t = { name: 'Taroko Gorge', 'name:zh': '太魯閣峽谷', 'name:zh-Hant': '太魯閣峽谷', 'name:en': 'Taroko Gorge' };
  ok(resolveName(t, 'zh') === '太魯閣峽谷' && resolveName(t, 'en') === 'Taroko Gorge'
    && resolveName(t, 'local') === 'Taroko Gorge', '三種語言各取各的');
  ok(resolveName({ name: 'X' }, 'zh') === 'X' && resolveName({ name: 'X' }, 'en') === 'X',
    '沒有譯名時退回原文(不是回 null)');
  // 外部資料清理:OSM 是使用者產生內容,控制字元/換行/連續空白都可能出現
  ok(resolveName({ name: 'A\u0000B' }, 'local') === 'A B', '控制字元收斂成空白');
  ok(resolveName({ name: ' A   B ' }, 'local') === 'A B', '連續空白收斂、前後修剪');
  // ref:多值取第一個
  ok(resolveRef({ ref: '3;5' }) === '3', 'ref 多值取第一個');
  ok(resolveRef({ ref: 'A'.repeat(20) }) === null && resolveRef({}) === null, '過長 / 缺 ref 回 null');
  // 語言選項與旋鈕表對帳:兩份名單分家 = 選了某個語言結果沒有任何反應
  const langs = VISUAL_KNOBS.worldTextLang.choices;
  ok(langs.every((l) => resolveName(t, l) !== null), `旋鈕表的每一個語言 ${langs.join('/')} 解析器都認得`);
  ok(VISUAL_KNOBS.worldTextLang.def === 'local', '預設 = 當地原文(真實感的來源)');
}

// ============ Ⅱ 缺字 / 額度 / 比例 / 鏡像 ============
console.log('\nⅡ 牌面規則');
{
  ok(/export function canRenderText/.test(wtSrc) && /measureText\( *PUA *\)/.test(wtSrc.replace(/\s+/g, ' ')),
    '缺字偵測以私用區字元的量測寬度當基準(A2 不准加字型檔 ⇒ 只能這樣測)');
  ok(/miss \/ n <= 0\.2/.test(wtSrc), '缺字超過兩成整串放棄(半排豆腐框比沒有招牌難看)');
  ok(/if \(this\.full \|\| !cp\?\.t \|\| !canRenderText\(all\)\) return false;/.test(wtSrc),
    'add() 三道閘:額度滿 / 無字 / 缺字 一律不掛');
  ok(/const all = cp \? \[cp\.t, cp\.s, cp\.en\]/.test(wtSrc),
    '缺字驗**整塊牌**(主名 + 日常副行 + 拉丁副名;副行也會變豆腐框)');
  ok(/export const SIGN_MAX/.test(wtSrc) && /this\.area >= ATLAS_MAX \* ATLAS_MAX \* FILL/.test(wtSrc),
    '額度 = 格數硬上限 **與** 圖集面積兩道閘(混合長寬比後「格數」不再等於「裝得下」)');
  // 比例:格子與牌面都是 4:1,寬由高推導 —— 牌子不准為了容納長名字而拉長
  ok(/const w = it\.h \* signAspect\(it\.style\)/.test(wtSrc),
    '牌寬由**該語域自己的**格子長寬比推導(拉長牌面就會與 atlas 分家 = 字被壓扁)');
  ok(/s = Math\.max\(8, s \* maxW \/ tw\)/.test(wtSrc),
    '長名字縮字級而不是拉牌面(字級由 measureText 決定,不是猜的)');
  // 鏡像:兩片背對背單面,而不是一片 DoubleSide
  ok(!/DoubleSide/.test(bare(wtSrc)), '沒有 DoubleSide(雙面板背面會變鏡像字)');
  ok(/emit\(false\);/.test(wtSrc) && /if \(it\.both\) emit\(true\);/.test(wtSrc),
    '雙面牌 = 兩片背對背的單面四邊形');
  // 不透明:透明件會在勾線 pass 的深度緩衝留斑點
  ok(!/transparent: *true/.test(bare(wtSrc)), '牌面不透明(透明件在勾線 pass 下會變成斑點)');
  ok(/rim: 0/.test(wtSrc), 'rim 0(掠射角洗白會讓字整片消失)');
  // 一個 draw call:全場的字合併成一個 mesh
  ok(count(wtSrc, /new THREE\.Mesh\(/g) === 1 && /BufferGeometry/.test(wtSrc),
    '全場文字合併成**一個** mesh(每塊牌一個材質 = draw call 爆掉)');
  ok(/if \(!this\.items\.length\) return null;/.test(wtSrc),
    '一塊牌都沒有時回 null(空 mesh 一樣吃一次 draw call 與一份 GPU 緩衝)');
  ok(/\+ 0\.5\) \/ cv\.width/.test(wtSrc) && /- 0\.5\) \/ cv\.width/.test(wtSrc),
    'atlas 的 UV 內縮半像素(相鄰格在 LinearFilter 下會滲色)');
}

// ============ Ⅲ 接線:位置取自真幾何、零亂數、快取版本 ============
console.log('\nⅢ 接線(biomes.js)');
{
  ok(count(bioSrc, /function buildWorldSigns\(/g) === 1
    && count(bioSrc, /buildWorldSigns\(/g) === 2, 'buildWorldSigns 一份實作、一個呼叫點');
  ok(count(bioSrc, /new SignSheet\(/g) === 1, 'SignSheet 只在這一處建(沒有第二套文字圖層)');
  // 位置 MUST 取自各構件已經定案的幾何
  ok(/tags: way\.tags,   \/\/ tags:洞口匾額/.test(bioSrc), '洞口匾額的字掛在 portals 那一筆記錄上');
  ok(/signSpots\.push\(\{ kind: 'bridge'/.test(bioSrc) && /deckAt\(cum\[i0\]/.test(bioSrc),
    '橋名牌的錨點取自**橋自己的**幾何(deckAt / run),不是另算一次');
  ok(/portals: roadRes\.portals, signSpots: roadRes\.signSpots/.test(bioSrc),
    '兩種錨點都從 buildRoads 的回傳拿(MUST NOT 在別處重建)');
  // 零亂數:掛牌不得消耗 rnd,否則整張圖的佈局位移
  const fn = bioSrc.slice(bioSrc.indexOf('function buildWorldSigns('),
    bioSrc.indexOf('\n}', bioSrc.indexOf('function buildWorldSigns(')) + 2);
  ok(!/\brnd\(\)/.test(bare(fn)) && !/Math\.random/.test(fn),
    '掛牌不呼叫共享亂數(多抽一枚就把整張圖的植被/建物佈局推移,§2.3)');
  // 語料庫那五種要挑字 ⇒ 一定有亂數,但 MUST 是**呼叫端注入的專屬 seed**(biomes 的 signRnd):
  // 在這裡自己 new 一個、或動到共享那一條,整張圖的植被/建物佈局就跟著漂。
  ok(/corpus, rnd, used/.test(fn) && !/mulberry32/.test(fn),
    '語料庫挑字用注入的專屬亂數(不自己建、不碰共享序列)');
  ok(/const signRnd = mulberry32\(/.test(bioSrc) && /rnd: signRnd/.test(bioSrc),
    'signRnd 是獨立 seed 且只餵給世界文字');
  ok(/const ry = Math\.atan2\(-x, -z\)/.test(fn), '標牌朝向由座標推導(面向戰場中心),不是抽的');
  // 純表現層:不得新增碰撞
  ok(!/blockers/.test(bare(fn)) && !/blockArea/.test(bare(fn)),
    '不新增任何碰撞柱(原則 4:表現層不得動權威幾何)');
  ok(/建物的 ry|if \(!b\.commercial\) continue;/.test(fn), '住宅不掛招牌(量會爆掉且不合理)');
  // Overpass 查詢改了 ⇒ 快取版本 MUST 跟著跳
  ok(/geoKey\('osmF', 5,/.test(bioSrc),
    '圖資快取版本已跳到 5(完整面域契約 + pois／地貌／車站入口；不跳版會讓舊快取靜默缺欄)');
  ok(/node\["place"/.test(bioSrc) && /node\["natural"="peak"\]/.test(bioSrc)
    && /node\["highway"="motorway_junction"\]/.test(bioSrc) && /node\["railway"~"\^\(station\|halt\)\$"\]/.test(bioSrc),
    '四類具名點位都進查詢');
  ok(/tags\.place \|\| tags\.natural === 'peak'/.test(bioSrc),
    '具名點位的分支排在「其餘一律當建物」之前(漏了就會在地名節點長出一棟樓)');
  ok(/pois: osmData\?\.pois/.test(bioSrc), '舊快取沒有 pois 時安全(可選鏈,不炸)');
  ok(/entrances: osmData\?\.entrances/.test(bioSrc), '舊快取沒有 entrances 時安全(可選鏈,不炸)');
}

// ============ Ⅳ 設定與說明 ============
console.log('\nⅣ 設定頁');
{
  ok(/d\.choices/.test(mainSrc) && /class="seg seg-sm"|'seg seg-sm'/.test(mainSrc),
    '互斥選項渲染成分段按鈕(§2.1「一組互斥選項」的統一樣式)');
  ok(!/worldTextLang/.test(bare(mainSrc)),
    'main.js 沒有把語言鍵寫死(控件型別由 choices 這一欄推導)');
  ok(/世界文字/.test(helpSrc), '說明講得到世界文字語言這一項');
}


// ============ Ⅴ 圖集裝箱(packCells:混合長寬比的排版)============
// 併入語料庫招牌之後,格子不再是同一個尺寸(直式招牌 1:5、路標 16:5、佈告欄 4:3)⇒
// 固定格網塞不下。裝箱是**純算術**,故直接抽原文執行真品:重疊 / 越界 / 靜默截斷
// 三種壞法都不會報錯,只表現成「某塊牌上出現隔壁那塊牌的半個字」或「那塊牌沒出現」。
console.log('\nⅤ 圖集裝箱');
{
  const packCells = new Function(`${grabFn(wtSrc, 'packCells')}\nreturn packCells;`)();
  const styles = Object.entries(STYLE_PX);
  // 五種語域各 6 塊 —— 現役最壞情況的形狀組合
  const cells = [];
  for (let k = 0; k < 6; k++) for (const [, s] of styles) cells.push({ cw: s.cw, ch: s.ch });
  const lay = packCells(cells, 2048, 2048);
  ok(lay.dropped === 0, `五種語域各 6 塊全部裝得下(實得 dropped=${lay.dropped})`);
  ok(lay.rects.length === cells.length, `每一格都有位置`);
  ok(lay.W <= 2048 && lay.H <= 2048, `畫布不超過 2048(實得 ${lay.W}×${lay.H})`);
  let inside = true, overlap = false;
  for (let a = 0; a < lay.rects.length; a++) {
    const r = lay.rects[a];
    if (r.x < 0 || r.y < 0 || r.x + r.w > lay.W || r.y + r.h > lay.H) inside = false;
    for (let b = 0; b < a; b++) {
      const q = lay.rects[b];
      if (r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h) overlap = true;
    }
  }
  ok(inside, `每一格都落在畫布內`);
  ok(!overlap, `每一格互不重疊(重疊 = 招牌上出現隔壁那塊牌的半個字)`);
  ok(lay.rects.every((r, i) => r.i === i), `回傳順序還原成呼叫端順序(排序後不還原 = UV 全部配錯牌)`);
  // 裝不下要**明講**,不是靜默截斷
  const tiny = packCells(cells, 256, 256);
  ok(tiny.dropped > 0 && tiny.dropped + tiny.rects.length === cells.length,
    '畫布不夠時 dropped 計數正確(靜默截斷會讓「那塊牌為什麼沒出現」永遠查不出來)');
  ok(packCells([{ cw: 4096, ch: 64 }], 2048, 2048).dropped === 1, `單格超寬直接記 dropped`);
  // 決定性:同輸入逐位元同輸出
  ok(JSON.stringify(packCells(cells, 2048, 2048)) === JSON.stringify(lay), `裝箱是決定性的`);
  // signDropped MUST 從 mesh 交出去(呼叫端/稽核才看得到)
  ok(/signDropped/.test(wtSrc), `build() 交出 signDropped`);
  // UV 的 v 翻轉(canvas 原點左上、UV 原點左下);行為對照組在 tools/shot_signs.mjs
  ok(/const v1 = 1 - \(r\.y \+ 0\.5\) \/ cv\.height/.test(wtSrc),
    'v 由畫布座標翻過來(沒翻 = 整批招牌上下顛倒,不報錯)');
  ok(/ClampToEdgeWrapping/.test(wtSrc), `圖集 ClampToEdge(Repeat 會在格緣抓到隔壁那塊牌的字)`);
}
console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
