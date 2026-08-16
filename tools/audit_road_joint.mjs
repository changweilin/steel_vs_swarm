// ============ 橋/隧道/地下道 ⇄ 一般道路「接合處」稽核(離線直測,執行 biomes.js 原文)============
// 使用者需求(2026-07-30):「橋/隧道/地下道內的馬路寬度與外部馬路標線與寬度要對齊,接合處貼合,
// 風格盡可能一致。」三件事拆成三條不變量,本稽核逐條把關:
//
//  ① **寬度/標線對齊**:結構的通行半寬 `strucHw` 為遊戲性夾到 ≥ PASS_W/2(機甲並行),但**塗裝**
//     車道半寬一律走單一縫 `carriageHw` = roadWidth/2 —— 與結構外那條路的通行半寬**同一個值**
//     ⇒ 車道數、分向線、路緣線位置在洞口/橋頭逐條對上。禁止在結構那側改吃 hw、也禁止「差額
//     不夠寬就退回 hw」的分岔(舊版 `avoidHw >= AVOID_MIN ? laneHw : hw` 就是這種潛伏縫:
//     標線寬度隨圖資 lanes 值在接合處跳動)。差額 hw − carriageHw = 避車道邊帶(純視覺)。
//  ② **接合處貼合**:結構寬與外部路寬不同 ⇒ 洞口/橋頭一道橫向硬階(結構節點刻意不入 nodeArms,
//     路口「寬度縮減梯形」補不到)。改由結構端往外鋪 `ROAD_FLARE_M` 長的漸縮帶,半寬 `flareHw`
//     由 hw smoothstep 收到車道寬、起點高度**逐位元**取結構路面高。純視覺:MUST NOT 進
//     decks / tunnelSegs / cols / 走廊(通行寬唯一縫仍只有 strucHw 一份)。
//  ③ **風格一致**:橋與隧道都是工程結構物 ⇒ 恆柏油(`strc || brg` 定調 urban),且橋面照畫標線
//     (舊版 `!brg` 把橋整段排除 = 上橋瞬間車道線消失,橋卻鋪著避車道邊帶)。標線基準高走
//     單一縫 `markBaseAt`(結構 tFloorAt / 橋 deckAt − ROAD_LIFT),回退貼地取樣會把標線畫到
//     覆蓋段上方的山頂或橋下河床。
//
// 跑法:node tools/audit_road_joint.mjs   退出碼:0 = 全綠;1 = 紅字
// **改完 MUST 反向驗證**(把判定寫回壞版,對應條目 MUST 紅字):
//   ⓐ `const mHw = laneHw;` 改回 `const mHw = avoidHw >= AVOID_MIN ? laneHw : hw;` ⇒ Ⅲ 紅。
//   ⓑ `const laneHw = carriageHw(way.tags);` 改回手寫 `roadWidth(way.tags) / 2` ⇒ Ⅰ/Ⅲ 紅(推導手寫)。
//   ⓒ 標線閘門加回 `!brg &&` ⇒ Ⅲ 紅(橋面無標線)。
//   ⓓ `if (strc || brg) biome = 'urban';` 改回 `if (strc)` ⇒ Ⅲ 紅(橋面鋪泥土/水色)。
//   ⓔ 漸縮帶起點高度改吃 `terrain.heightAt(...)` 而非結構路面高 ⇒ Ⅳ 紅(接合處高差不貼合)。
//   ⓕ 漸縮帶的邊界/撞山跳過條件任一刪掉 ⇒ Ⅳ 紅(楔形伸出地圖 / 沿山坡爬上去)。
// 讀原文 MUST 走 readSrc(㋑):CRLF 檢出的工作區裡,逐行剝註解 `//.*$` 靜默失效,
// 註解裡提到的 dropLaneBridges 會被算進「恰一份實作一個呼叫點」的計數(2026-08-05 實測紅字)。
//
// ---- 接縫紀律:同族 symptom(2026-08-16 併入,`docs/anime_style_plan.md` ④-4;純註解,零斷言改動)----
// 本支守的三條不變量與參考專案記錄過的「路口接縫」是同一族。以下兩列落在本支範圍內,
// 今天**沒有斷言**在守 —— 列在這裡是因為「要改接合處」的人會先開這一支:
//
//  ㋐ **路口是三個不同的數字,不是一個。** 症狀:**路口中央出現一塊有缺角的裸地**。
//     成因是把兩條臂各自鋪到**自己的中心線**;正解是三條不同的線 —— 車道鋪到它遇到的那條路的
//     **遠側**路緣線、人行道停在**近側**、次要臂**抵住**主要臂的路緣線。本專案今天沒有「路口鋪面」
//     這個東西(路口靠 `nodeArms` 的寬度縮減梯形),但 ② 的漸縮帶是同一件事的另一端:
//     一樣是「兩條寬度不同的路怎麼交會」、一樣純視覺。⇒ 日後真要鋪路口面時,
//     MUST NOT 用「各自鋪到中心線」那條看起來最自然的規則。
//  ㋑ **車道經過的地方要斷緣石。** 症狀:**停車場 / 側路的出入口橫著一道草皮或緣石**。
//     本專案唯一的緣石是地下道的 `UND.COPE` 帶,而它**純視覺不進碰撞** ⇒
//     **任何連通性檢查都永遠找不到一條橫在入口上的緣石**。完整敘事住 `audit_underpass.mjs`
//     的檔頭尾段(緣石是那一支的東西)。
//
// ⚠ 這兩列**刻意沒有做成斷言**:㋐ 的那個功能還不存在(沒有東西可以驗)、㋑ 的判定面在
//    `audit_underpass`。把它們寫成假斷言會讓「這裡有人在守」變成一句謊。
import { readSrc } from './audit_src.mjs';

const src = readSrc('public', 'js', 'biomes.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

const slice = (a, b, what) => {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`切片標記找不到(${what};改過就要同步改稽核)`);
  return src.slice(i, j);
};

// ---- 寬度推導家族(執行原文)----
const widthSrc = slice('const ROAD_W = {', '};', 'ROAD_W') + '};\n'
  + /const PASS_W = \d+(\.\d+)?;/.exec(src)[0] + '\n'
  + slice('function roadWidth(tags) {', '// 路面顏色(cel-shaded)', 'roadWidth…flareHw');
const W = new Function(`${widthSrc}
  return { ROAD_W, PASS_W, roadWidth, strucHw, carriageHw, flareHw, ROAD_FLARE_M };`)();

// 圖資 tag 樣本:ROAD_W 全家族 × lanes 變體(含把 base 撐過 PASS_W 的多車道)
const TAGS = [];
for (const h of Object.keys(W.ROAD_W)) {
  TAGS.push({ highway: h });
  for (const lanes of ['1', '2', '3', '4', '5', '6', '8']) TAGS.push({ highway: h, lanes });
}
TAGS.push({}, { highway: 'nonsense' }, { highway: 'primary', lanes: 'x' });

console.log('Ⅰ 塗裝車道半寬單一縫(carriageHw:結構內外同一個值)');
{
  ok(/^const carriageHw = \(tags\) => roadWidth\(tags\) \/ 2;$/m.test(src),
    'Ⅰ carriageHw MUST 只有一份、且由 roadWidth 推導(不得手寫寬度常數)');
  // 一般道路的通行半寬(buildRoads hwWay,非橋 ⇒ 不夾 PASS_W)= roadWidth/2 ⇒ MUST 與 carriageHw 逐位元相等
  const bad = TAGS.filter((t) => W.carriageHw(t) !== Math.max(W.roadWidth(t) / 2, 0));
  ok(bad.length === 0, `Ⅰ 塗裝車道半寬 MUST === 一般路通行半寬(不符 ${bad.length} 組)`);
  const narrow = TAGS.filter((t) => W.strucHw(t) < W.carriageHw(t));
  ok(narrow.length === 0, `Ⅰ 結構通行寬 MUST NOT 窄於塗裝車道寬(不符 ${narrow.length} 組)`);
  // 差額 = 避車道邊帶;結構夾寬生效時(窄路)差額 > 0、寬路(≥PASS_W)差額歸零 = 結構內外完全等寬
  const clamped = TAGS.filter((t) => W.roadWidth(t) < W.PASS_W);
  ok(clamped.every((t) => W.strucHw(t) - W.carriageHw(t) > 0), 'Ⅰ 窄路進結構:差額 > 0(交給避車道 + 漸縮帶)');
  const wide = TAGS.filter((t) => W.roadWidth(t) >= W.PASS_W);
  ok(wide.length > 0 && wide.every((t) => W.strucHw(t) === W.carriageHw(t)),
    `Ⅰ 寬路(≥PASS_W)進結構:通行寬 === 塗裝寬,零階差(樣本 ${wide.length})`);
  // 主幹道全家族都畫得出標線(標線閘門 mHw >= 2 不得把真實道路整級刷掉)
  const MAIN_HW = /^(motorway|trunk|primary|secondary|tertiary)$/;
  const mains = TAGS.filter((t) => MAIN_HW.test(t.highway || ''));
  ok(mains.every((t) => W.carriageHw(t) >= 2), 'Ⅰ 主幹道家族的塗裝半寬 MUST ≥ 2(標線閘門不刷掉整級道路)');
}

console.log('Ⅱ 漸縮曲線(flareHw:兩端貼合、切線歸零、單調)');
{
  const hw = 8, cw = 5;
  ok(W.flareHw(hw, cw, 0) === hw, 'Ⅱ t=0 MUST === 結構通行寬(貼合結構端)');
  ok(W.flareHw(hw, cw, 1) === cw, 'Ⅱ t=1 MUST === 塗裝車道寬(貼合一般路端)');
  ok(W.flareHw(hw, cw, -0.5) === hw && W.flareHw(hw, cw, 1.7) === cw, 'Ⅱ 參數 MUST 夾制在 [0,1]');
  ok(Math.abs(W.flareHw(hw, cw, 0.5) - (hw + cw) / 2) < 1e-12, 'Ⅱ 中點 = 兩端平均(對稱)');
  let mono = true;
  for (let k = 1; k <= 40; k++) if (W.flareHw(hw, cw, k / 40) > W.flareHw(hw, cw, (k - 1) / 40) + 1e-12) mono = false;
  ok(mono, 'Ⅱ 由結構寬到車道寬 MUST 單調收窄(不得中途外擴)');
  const d = (t) => (W.flareHw(hw, cw, t + 1e-4) - W.flareHw(hw, cw, t - 1e-4)) / 2e-4;
  ok(Math.abs(d(0.0002)) < 0.02 && Math.abs(d(0.9998)) < 0.02, 'Ⅱ 兩端切線 MUST ≈ 0(接結構、接一般路都不折角)');
  ok(W.flareHw(8, 8, 0.5) === 8, 'Ⅱ 零階差(hw === cw)MUST 恆等寬');
  ok(/^const ROAD_FLARE_M = \d+(\.\d+)?;$/m.test(src) && W.ROAD_FLARE_M >= 6 && W.ROAD_FLARE_M <= 30,
    `Ⅱ 漸縮長度 MUST 具名且在合理帶(現值 ${W.ROAD_FLARE_M}m)`);
}

console.log('Ⅲ 標線消費端單一縫 + 橋隧同款風格(原文)');
{
  ok(/const laneHw = carriageHw\(way\.tags\);/.test(src), 'Ⅲ buildRoads 的車道半寬 MUST 吃 carriageHw(不得手寫 roadWidth/2)');
  ok(/const avoidHw = \(brg \|\| strc\) \? Math\.max\(0, hw - laneHw\) : 0;/.test(src),
    'Ⅲ 避車道差額 MUST 由 hw − laneHw 推導');
  ok(/^ {6}const mHw = laneHw;$/m.test(src), 'Ⅲ 標線半寬 MUST 恆 = 車道半寬(單一值,無分岔)');
  ok(!/avoidHw >= AVOID_MIN \? laneHw : hw/.test(src),
    'Ⅲ MUST NOT 依差額在 laneHw / hw 之間切換(標線寬度會在接合處跳動)');
  ok(/if \(biome === 'urban' && mHw >= 2\) \{/.test(src),
    'Ⅲ 標線閘門 MUST 只看柏油 + 塗裝寬(不得再排除橋面 !brg)');
  ok(/const markBaseAt = strc \? \(s\) => tFloorAt\(s\)\s*\n\s*: brg \? \(s, gx, gz\) => deckAt\(s, gx, gz\) - ROAD_LIFT : null;/.test(src),
    'Ⅲ 標線基準高 MUST 只有 markBaseAt 一份(結構 tFloorAt / 橋 deckAt − ROAD_LIFT)');
  ok((src.match(/markBaseAt\b/g) || []).length >= 4,
    'Ⅲ markYB(實線)與 dashLine(虛線)兩消費端 MUST 都吃 markBaseAt');
  ok(!/const yB = strc \? tFloorAt\(d\) : null;/.test(src), 'Ⅲ 虛線 MUST NOT 留舊版「只認結構」的基準高');
  const emit = src.match(/emitLine\(run, [^)]*\)/g) || [];
  // `markYB` 之後還可以再帶參數(2026-08-01 起帶 dropSeg:落進別條路洞內斷面的那一格不成面),
  // 這條斷言管的是「基準高有沒有傳」,MUST NOT 因為多一個尾參數就紅字
  ok(emit.length >= 4 && emit.every((e) => /markYB[,)]/.test(e)),
    `Ⅲ emitLine 全部呼叫 MUST 傳 markYB(共 ${emit.length} 處;漏傳 = 該條線退回貼地取樣)`);
  ok(emit.every((e) => /\(run, mHw,/.test(e)), 'Ⅲ emitLine 的夾高取樣半寬 MUST 吃 mHw');
  ok(/if \(strc \|\| brg\) biome = 'urban';/.test(src), 'Ⅲ 橋與隧道 MUST 同款定調柏油(工程結構物無土石路面)');
  ok(/if \(!strc && !brg && main && lamps\.length < 380\) \{/.test(src),
    'Ⅲ 地面路燈 MUST 仍排除橋與隧道(橋有橋燈、洞有天花燈)');
  ok(/\} else if \(!brg && !strc && \(biome === 'green' \|\| biome === 'wet'\)/.test(src),
    'Ⅲ 行道樹 MUST 仍排除橋與隧道');
}

console.log('Ⅳ 銜接漸縮帶(行為直測:執行原文區塊)');
{
  const flareSrc = slice('      // ---- 銜接漸縮帶(2026-07-30 使用者需求「接合處貼合」)----',
    '\n      const at = (d) => {', '漸縮帶區塊');
  ok(/flareHw\(hw, laneHw, t\)/.test(flareSrc), 'Ⅳ 漸縮半寬 MUST 由 flareHw(hw → 車道寬)推導');
  ok((src.match(/flareHw\(/g) || []).length === 1, 'Ⅳ flareHw MUST 只有一個消費端(漸縮帶;邊帶吃同一個 fhw,MUST NOT 自己再算一次)');
  for (const bad of ['decks.push', 'tunnelSegs.push', 'cols.push', 'corridors.push', 'blockArea(', 'rnd('])
    ok(!flareSrc.includes(bad), `Ⅳ 漸縮帶是純視覺 MUST NOT 出現 ${bad}`);
  ok(flareSrc.includes('b.pos.push') && flareSrc.includes('b.idx.push') && flareSrc.includes('b.uv.push'),
    'Ⅳ 漸縮帶 MUST 進路面桶(同色同材質同 draw call)');
  ok(/terrain\.minX \+ inb \+ ROAD_FLARE_M/.test(flareSrc) && /terrain\.maxZ - inb - ROAD_FLARE_M/.test(flareSrc),
    'Ⅳ 邊界跳過條件 MUST 以 ROAD_FLARE_M 為餘裕(楔形不得伸出地圖)');
  ok(/yFar > yEnd \+ [\d.]+ \|\| yFar < yEnd - [\d.]+/.test(flareSrc),
    'Ⅳ MUST 有「往外撞進山體 / 懸空」跳過條件');

  const run = (nP, x0, dx) => Array.from({ length: nP }, (_, i) => [x0 + dx * i, 0]);
  const cumOf = (r) => r.map((p, i) => (i === 0 ? 0 : Math.hypot(p[0] - r[0][0], p[1] - r[0][1])));
  const bucket = () => ({ pos: [], nrm: [], col: [], uv: [], idx: [], base: 0 });
  const flare = new Function('C', `with (C) { ${flareSrc}\n return b; }`);
  const base = (o) => ({
    inb: 4, AVOID_MIN: 1.5, CLAMP: 0.7, ROAD_LIFT: 0.45,
    ROAD_FLARE_M: W.ROAD_FLARE_M, flareHw: W.flareHw,
    hw: 8, laneHw: 5, avoidHw: 3, brg: false, strc: true,
    terrain: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, heightAt: () => 5 },
    tFloorAt: () => 5, deckAt: () => 5.45, b: bucket(), walk: bucket(), ...o,
  });
  const build = (o) => {
    const c = base(o);
    c.run = c.run || run(21, -50, 5);
    c.nP = c.run.length; c.cum = cumOf(c.run);
    flare(c);
    c.b.walk = c.walk;                      // 邊帶與楔形同一次呼叫產出,一起帶回
    return c.b;
  };
  const sect = (b, k) => {   // 第 k 個截面(每截面 4 頂點):[半寬, y]
    const p = (q) => [b.pos[(k * 4 + q) * 3], b.pos[(k * 4 + q) * 3 + 1], b.pos[(k * 4 + q) * 3 + 2]];
    const a = p(0), d = p(3);
    return [Math.hypot(a[0] - d[0], a[2] - d[2]) / 2, a[1]];
  };

  {
    const b = build({});
    const FN1 = b.base / 8;                       // 兩端 × (FN+1) 截面
    ok(b.base === 2 * FN1 * 4 && FN1 >= 3, `Ⅳ 兩端各鋪一片楔形(${FN1} 截面/端)`);
    for (const e of [0, 1]) {
      const k0 = e * FN1;
      ok(Math.abs(sect(b, k0)[0] - 8) < 1e-9, `Ⅳ 端${e} 結構側截面半寬 === hw(貼合結構)`);
      ok(Math.abs(sect(b, k0 + FN1 - 1)[0] - 5) < 1e-9, `Ⅳ 端${e} 外側截面半寬 === 車道寬(貼合一般路)`);
      let mono = true;
      for (let k = 1; k < FN1; k++) if (sect(b, k0 + k)[0] > sect(b, k0 + k - 1)[0] + 1e-9) mono = false;
      ok(mono, `Ⅳ 端${e} 半寬逐截面單調收窄`);
    }
    // 繞行朝向:全部三角形法線 MUST 朝 +Y(兩端 d 與 p 同時反號 ⇒ 朝向不翻)
    let up = 0, down = 0;
    for (let t = 0; t < b.idx.length; t += 3) {
      const v = [0, 1, 2].map((q) => {
        const i = b.idx[t + q] * 3;
        return [b.pos[i], b.pos[i + 1], b.pos[i + 2]];
      });
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
      const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      (e1[2] * e2[0] - e1[0] * e2[2]) >= 0 ? up++ : down++;
    }
    ok(b.idx.length > 0 && down === 0, `Ⅳ 楔形三角形 MUST 全部朝 +Y(朝下 ${down} 個 = 背面剔除後消失)`);
  }
  {   // 地下道引道端:結構路面比地表低 ⇒ 起點高度 MUST 逐位元取結構路面高,再融回一般路面
    const b = build({ tFloorAt: () => 3 });
    const FN1 = b.base / 8;
    ok(Math.abs(sect(b, 0)[1] - 3.45) < 1e-12, 'Ⅳ 起點高 === 結構路面高 + ROAD_LIFT(接合處零高差)');
    ok(Math.abs(sect(b, FN1 - 1)[1] - 5.45) < 1e-12, 'Ⅳ 末端高 === 一般路面貼地高(融回外部)');
    let mono = true;
    for (let k = 1; k < FN1; k++) if (sect(b, k)[1] < sect(b, k - 1)[1] - 1e-12) mono = false;
    ok(mono, 'Ⅳ 高度沿漸縮帶單調過渡(不上下起伏)');
  }
  {   // 橋:起點高 = deckAt(橋面表面高,不再加 ROAD_LIFT)
    const b = build({ brg: true, strc: false, deckAt: () => 5.6, tFloorAt: () => NaN });
    ok(b.base > 0 && Math.abs(sect(b, 0)[1] - 5.6) < 1e-12, 'Ⅳ 橋頭起點高 === deckAt(橋面表面)');
  }
  {   // 避車道邊帶同步漸縮(2026-07-31):洞內外 MUST 同斷面 —— 車道寬不變、邊帶寬收到零
    const b = build({});
    const w = b.walk;
    const FN1 = b.base / 8;
    ok(w.base === 8 * FN1, `Ⅳ 邊帶截面數 MUST 與楔形一致(${w.base / 4} 截面 × 內外緣)`);
    const off = (k, q) => {   // 第 k 截面第 q 點的側向偏移(run 沿 +X ⇒ 側向 = z)
      const i = (k * 4 + q) * 3;
      return Math.abs(w.pos[i + 2]);
    };
    const yOf = (k, q) => w.pos[(k * 4 + q) * 3 + 1];
    for (const e of [0, 1]) {
      const k0 = e * FN1;
      ok(Math.abs(off(k0, 0) - 5.1) < 1e-9 && Math.abs(off(k0, 1) - 7.9) < 1e-9,
        `Ⅳ 端${e} 結構側邊帶 MUST 自車道緣(laneHw+0.1)鋪到結構緣(hw−0.1)`);
      ok(Math.abs(off(k0 + FN1 - 1, 0) - off(k0 + FN1 - 1, 1)) < 1e-9,
        `Ⅳ 端${e} 外側邊帶寬 MUST 收到零(接上一般路 = 只剩車道)`);
      let mono = true;
      for (let k = 1; k < FN1; k++) if (off(k0 + k, 1) > off(k0 + k - 1, 1) + 1e-9) mono = false;
      ok(mono, `Ⅳ 端${e} 邊帶外緣逐截面單調收窄(與楔形同一條 fhw)`);
      ok(Math.abs(off(k0, 0) - off(k0 + FN1 - 1, 0)) <= 0.25, `Ⅳ 端${e} 車道緣 MUST 全程不漂(斷面不跳階;容差 = 一個路緣寬)`);
      ok(yOf(k0, 0) > sect(b, k0)[1] + 0.1, `Ⅳ 端${e} 邊帶 MUST 高於路面(路緣高 0.12)`);
    }
    let down = 0;
    for (let t = 0; t < w.idx.length; t += 3) {
      const v = [0, 1, 2].map((q) => { const i = w.idx[t + q] * 3; return [w.pos[i], w.pos[i + 1], w.pos[i + 2]]; });
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
      const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      if ((e1[2] * e2[0] - e1[0] * e2[2]) < 0) down++;
    }
    ok(w.idx.length > 0, 'Ⅳ 邊帶 MUST 真的產出三角形');
    ok(build({ avoidHw: 1.2 }).walk.base === 0, 'Ⅳ 差額 < AVOID_MIN 時邊帶同步不鋪(與楔形同進退)');
  }
  {   // 跳過條件
    ok(build({ avoidHw: 1.2 }).base === 0, 'Ⅳ 差額 < AVOID_MIN(幾乎無階差)不鋪');
    const border = build({ run: run(21, 400, 5), terrain: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, heightAt: () => 5 } });
    ok(border.base > 0 && border.base === 20, 'Ⅳ 貼邊界那端不鋪(另一端照鋪)');
    ok(build({ terrain: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, heightAt: () => 40 } }).base === 0,
      'Ⅳ 往外撞進山體(覆蓋段貼齊 run 端)兩端都不鋪');
    ok(build({ brg: true, strc: false, deckAt: () => 20, tFloorAt: () => NaN }).base === 0,
      'Ⅳ 橋頭懸空(斷鏈端點)不鋪');
  }
}

console.log('Ⅴ 權威幾何不變(通行寬唯一縫仍是 strucHw)');
{
  ok(/^const strucHw = \(tags\) => Math\.max\(roadWidth\(tags\) \/ 2, PASS_W \/ 2\);$/m.test(src),
    'Ⅴ 結構通行半寬 MUST 只有 strucHw 一份');
  ok(/const hw = \(brg \|\| strc\) \? strucHw\(way\.tags\) : hwWay;/.test(src),
    'Ⅴ buildRoads 的通行寬 MUST 仍吃 strucHw(decks / tunnelSegs / 牆 / 門洞全靠它)');
  ok(/const hw = \(bridge \|\| wet \|\| strc\) \? strucHw\(way\.tags \|\| \{\}\) : hwWay;/.test(src),
    'Ⅴ markGradeCorridors 的走廊寬 MUST 仍吃 strucHw');
  // 塗裝縫 MUST NOT 滲進權威幾何:走廊/開挖剖面/物理段一律不得改吃 carriageHw
  const corr = slice('function markGradeCorridors(', '\nfunction buildRoads(', 'markGradeCorridors');
  ok(!corr.includes('carriageHw') && !corr.includes('flareHw'), 'Ⅴ 走廊登記 MUST NOT 吃塗裝/漸縮縫');
  const carve = slice('      const hwWay = strucHw(way.tags);', 'tunnelRuns.push(', 'carveTunnels 指派');
  ok(!carve.includes('carriageHw'), 'Ⅴ 開挖剖面 MUST NOT 吃塗裝縫(開挖窄於路面 = 路緣埋進土裡)');
  const segs = src.match(/tunnelSegs\.push\(\{[\s\S]{0,420}?\}\);/g) || [];
  ok(segs.length >= 2 && segs.every((s) => /\bhw\b/.test(s) && !/laneHw|carriageHw|flareHw/.test(s)),
    'Ⅴ 隧道物理段 MUST 仍以通行寬 hw 上傳(伺服器量體零漂移)');
  const decks = src.match(/decks\.push\(\{[\s\S]{0,320}?\}\);/g) || [];
  ok(decks.length >= 1 && decks.every((s) => /\bhw,/.test(s) && !/laneHw|carriageHw|flareHw/.test(s)),
    'Ⅴ 橋面碰撞段 MUST 仍以通行寬 hw 登記');
}

// ============ Ⅵ 結構的建置範圍:離兵線多遠一律照建 ============
// 2026-08-04 使用者定案:「高架橋/地下道/隧道/明隧道**就算在兵線之外也建立**,
// 除非會干擾兵線,或違反其他規則。」
// 這一段釘的是「沒有那道閘」—— 而「沒有」正是最容易被人不知不覺加上去的東西:
// 場地選單只看兵線(scen 標記),很容易讓人以為結構本來就只服務兵線,順手加一道
// 「離兵線 N 公尺外就不建」來省 draw call。加了之後畫面上只表現成「這張圖的橋比較少」。
{
  console.log('\nⅥ 結構建置範圍(離兵線多遠一律照建)');
  // 剝註解:註解裡當然可以提到兵線,會壞事的是真的去判它(㋑)
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const build = strip(slice('function buildRoads(', '  // ---- 路口:斑馬線', 'buildRoads'));
  // 建置端 MUST **拿不到**兵線 —— 這比「原文裡沒有距離判定」更硬:簽章裡沒有那個參數,
  // 就結構性地不可能長出「離兵線多遠就不建」的閘。
  //(注意 `lanes` 在 buildRoads 裡是**車道數**、`laneHw` 是塗裝車道半寬,都與兵線無關。)
  ok(/^function buildRoads\(group, roads, terrain, center, mix, rnd, season, covers = \[\], inclSwamp = false, bores = \[\]\) \{/
    .test(build), 'buildRoads 的簽章沒有兵線參數(結構性地不可能依兵線距離篩選)');
  ok(!/\bcfg\b/.test(build), 'buildRoads 全段拿不到 cfg(兵線/主堡/塔位一概不可見)');
  ok(/for \(const way of roads\) \{/.test(build), '逐 way 跑完整份 roadInput(不是只挑兵線附近的)');
  // 結構 way MUST 排在 maxRuns 截斷之前(2026-07-22 倫敦橋數浮動案的既有結論,不得倒退)
  ok(/return out\.concat\(plain\);/.test(src),
    '結構鏈排在一般道路之前(maxRuns 截斷依陣列序 ⇒ 結構不會整批被犧牲)');
  // 會讓結構消失的刀:恰三把,每一把都對得上使用者那句話裡的一個例外,而且都有記帳
  const cuts = [
    ['dropLaneBridges', 'laneWet', '兵線跨水補橋是唯一結算 ⇒ 走廊內重疊的真橋剔除(= 干擾兵線)'],
    ['dedupeCrossingBridges', 'crossing', '十字路口只留一座橋(2026-07-28 使用者定案 = 其他規則)'],
    ['dedupeParallelBridges', 'parallel', '平行雙幅橋/雙孔隧道疊在一起(單層原則)'],
  ];
  for (const [fn, key, why] of cuts) {
    ok((strip(src).match(new RegExp(`\\b${fn}\\(`, 'g')) || []).length === 2,
      `${fn} 恰一份實作一個呼叫點`);
    ok(new RegExp(`strucDrop\\.${key} =`).test(src), `${fn} 有記帳(strucDrop.${key}:${why})`);
  }
  ok(/const strucDrop = \{ parallel: 0, laneWet: 0, crossing: 0 \};/.test(src),
    '記帳表恰三欄 —— 新增第四把刀 MUST 同步記帳(不然結構少了查不出原因)');
  ok(/strucWays: strucN\(roadInput\)/.test(src) && /\bstrucDrop,/.test(src),
    'stats 帶出結構總數與逐把刀的剔除數(冒煙時看得到「這張圖有幾座橋、被砍了幾座、為什麼」)');
}

console.log(`\n道路接合稽核:${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
