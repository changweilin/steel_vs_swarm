// ============ 地形坡度移動(上坡減速 / 下坡加速 / 陡坡爬不上去)稽核 ============
// 用途:改 `data.js` 的 `SLOPE`/`slopeDeg`/`slopeMoveF`/`slopeBlocked`、`MAPGEO.MAX_ROAD_GRADE_DEG`,
//       或 `game.js` 的 `_slopeDegAlong`/`_slopeMoveF`/`_updatePlayer` 移動段與 passable 閘後跑。
// 跑法:`node tools/audit_slope_move.mjs`
//
// 這個系統的形狀 = **data.js 一條曲線 → game.js 兩個消費端(速度倍率 + 通行閘)**,
// 而每一種寫壞法在遊戲裡都不會報錯,只會「手感怪」或「某面山莫名上不去」:
//   ① 平緩帶脫鉤兵線坡度限制(手寫 16)⇒ 之後有人調 MAX_ROAD_GRADE_DEG,兵線就開始被自己的
//      坡度稅拖慢 —— 推線走廊全速是這個設計的前提,不是巧合。
//   ② 拿站立面 `_surf` 量坡度(而非裸地形 `heightAt`)⇒ 上橋引道那一步被 deckAt 捕捉成垂直跳階,
//      量出 ~90° = 橋永遠上不去;隧道天花之下同理(路面比山頂低一大截 = 假峭壁)。
//   ③ 拿當幀位移量速度倍率(而非固定前瞻 PROBE_M)⇒ 同一道坡在 30fps 與 120fps 量出不同陡度。
//   ④ 下坡也擋 / 騰空也擋 ⇒ 陡坡上的機體把自己鎖死、跳過懸崖邊緣被空氣牆彈回。
//   ⑤ 「爬不上去」用倍率 0 表達 ⇒ 玩家分不出「很慢」與「上不去」,且逐軸滑行(沿等高線橫走)失效。
//
// 手法比照 `audit_cc_flash.mjs`:曲線直接 import(data.js 是純模組),game.js 的方法**抽執行原文**
// 評估(three 走 CDN、Node 端 import 不了整支;抄一份公式進稽核就永遠會通過)。
import { SLOPE, slopeDeg, slopeMoveF, slopeBlocked, slopeSnapM, MAPGEO, AIR } from '../public/js/data.js';
import { readSrc } from './audit_src.mjs';

const src = readSrc('public', 'js', 'game.js');

/** 抽出 class 方法的原文(含大括號區塊);與 audit_cc_flash.mjs 同一手法 */
const grab = (name) => {
  const i = src.indexOf(`\n  ${name}(`);
  if (i < 0) throw new Error(`找不到 ${name}`);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
};

// 「全檔只有 N 處」MUST 只數執行原文:註解與 import 清單也提得到同一個名字,連著數會把
// 「說明寫得詳細」誤判成「縫破了」。
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  .split("} from './data.js';").slice(1).join("} from './data.js';");

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 坡度常數(平緩帶 = 兵線坡度限制;阻擋角推導不手寫)');
// ---------------------------------------------------------------------------
{
  t('平緩帶 EASE_DEG 綁 MAPGEO.MAX_ROAD_GRADE_DEG(16°,MUST NOT 手寫)',
    SLOPE.EASE_DEG === MAPGEO.MAX_ROAD_GRADE_DEG && SLOPE.EASE_DEG === 16, `${SLOPE.EASE_DEG}`);
  t('阻擋角 = 平緩帶 × BLOCK_F(推導回填)', near(SLOPE.BLOCK_DEG, SLOPE.EASE_DEG * SLOPE.BLOCK_F),
    `${SLOPE.BLOCK_DEG}`);
  t('阻擋角嚴格大於平緩帶(否則內插分母 0)', SLOPE.BLOCK_DEG > SLOPE.EASE_DEG);
  t('阻擋角 < 90°(垂直面以下就該擋)', SLOPE.BLOCK_DEG < 90, `${SLOPE.BLOCK_DEG}`);
  t('上坡最低倍率 ∈ (0,1)(> 0:爬不上去 MUST 由 slopeBlocked 表達,不是倍率 0)',
    SLOPE.UP_MIN_F > 0 && SLOPE.UP_MIN_F < 1, `${SLOPE.UP_MIN_F}`);
  t('下坡最高倍率 > 1(下坡加速)', SLOPE.DOWN_MAX_F > 1, `${SLOPE.DOWN_MAX_F}`);
  t('前瞻距離 PROBE_M > 0', SLOPE.PROBE_M > 0);
  t('人造鋪面門檻 STRUCT_M > 0', SLOPE.STRUCT_M > 0);
  // data.js 原文:阻擋角 MUST 是推導回填而非字面量
  const dsrc = readSrc('public', 'js', 'data.js');
  t('data.js 以 EASE_DEG × BLOCK_F 回填 BLOCK_DEG(MUST NOT 手寫角度)',
    /SLOPE\.BLOCK_DEG\s*=\s*SLOPE\.EASE_DEG\s*\*\s*SLOPE\.BLOCK_F;/.test(dsrc));
  t('data.js 的 EASE_DEG 取自 MAPGEO.MAX_ROAD_GRADE_DEG',
    /EASE_DEG:\s*MAPGEO\.MAX_ROAD_GRADE_DEG/.test(dsrc));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅱ 坡度曲線(平緩帶恆 1 → 上坡遞減 / 下坡遞增 → 阻擋角外夾制)');
// ---------------------------------------------------------------------------
{
  t('帶號坡度角:上坡正、下坡負、平地 0',
    slopeDeg(10, 10) > 0 && slopeDeg(-10, 10) < 0 && near(slopeDeg(0, 10), 0));
  t('slopeDeg 45° 實測', near(slopeDeg(7, 7), 45) && near(slopeDeg(-7, 7), -45));
  t('平地恆全速', near(slopeMoveF(0), 1));
  t('平緩帶內(上下坡皆)恆全速',
    near(slopeMoveF(SLOPE.EASE_DEG), 1) && near(slopeMoveF(-SLOPE.EASE_DEG), 1)
    && near(slopeMoveF(SLOPE.EASE_DEG * 0.99), 1) && near(slopeMoveF(-SLOPE.EASE_DEG * 0.5), 1));
  t('平緩帶邊界連續(跨過去不跳階)',
    near(slopeMoveF(SLOPE.EASE_DEG + 1e-6), 1, 1e-6) && near(slopeMoveF(-SLOPE.EASE_DEG - 1e-6), 1, 1e-6));
  t('上坡:陡度越大越慢(嚴格單調遞減)', (() => {
    let prev = Infinity;
    for (let i = 0; i <= 200; i++) {
      const f = slopeMoveF(SLOPE.EASE_DEG + (SLOPE.BLOCK_DEG - SLOPE.EASE_DEG) * i / 200);
      if (i && f >= prev) return false;
      prev = f;
    }
    return true;
  })());
  t('下坡:陡度越大越快(嚴格單調遞增)', (() => {
    let prev = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const f = slopeMoveF(-(SLOPE.EASE_DEG + (SLOPE.BLOCK_DEG - SLOPE.EASE_DEG) * i / 200));
      if (i && f <= prev) return false;
      prev = f;
    }
    return true;
  })());
  t('上坡在阻擋角觸底 = UP_MIN_F', near(slopeMoveF(SLOPE.BLOCK_DEG), SLOPE.UP_MIN_F));
  t('下坡在阻擋角觸頂 = DOWN_MAX_F', near(slopeMoveF(-SLOPE.BLOCK_DEG), SLOPE.DOWN_MAX_F));
  t('更陡的下坡夾在 DOWN_MAX_F(不會越滑越快到失控)',
    near(slopeMoveF(-89), SLOPE.DOWN_MAX_F) && near(slopeMoveF(-SLOPE.BLOCK_DEG * 2), SLOPE.DOWN_MAX_F));
  t('倍率恆 > 0(爬不上去 MUST NOT 用倍率 0 表達)', (() => {
    for (let d = -90; d <= 90; d += 0.5) if (!(slopeMoveF(d) > 0)) return false;
    return true;
  })());
  t('中點對稱:上下坡的偏離量各自線性(半途 = 一半增益)',
    near(slopeMoveF((SLOPE.EASE_DEG + SLOPE.BLOCK_DEG) / 2), 1 + (SLOPE.UP_MIN_F - 1) / 2)
    && near(slopeMoveF(-(SLOPE.EASE_DEG + SLOPE.BLOCK_DEG) / 2), 1 + (SLOPE.DOWN_MAX_F - 1) / 2));
  t('null/undefined/NaN 一律當平地', near(slopeMoveF(), 1) && near(slopeMoveF(null), 1));
  t('阻擋:超過阻擋角的上坡擋下', slopeBlocked(SLOPE.BLOCK_DEG + 0.01) && slopeBlocked(89));
  t('阻擋:阻擋角以內的上坡放行(邊界不含)', !slopeBlocked(SLOPE.BLOCK_DEG) && !slopeBlocked(SLOPE.EASE_DEG));
  t('阻擋:**下坡一律放行**(否則陡坡上會把自己鎖死)',
    !slopeBlocked(-SLOPE.BLOCK_DEG - 30) && !slopeBlocked(-89) && !slopeBlocked(-90));
  t('阻擋:平地/空值放行', !slopeBlocked(0) && !slopeBlocked() && !slopeBlocked(null));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅲ 兵線不受坡度稅(推線走廊恆全速的設計前提)');
// ---------------------------------------------------------------------------
{
  // 兵線的 16° 量在**真實世界**(mapSelect maxLaneGrade 用真實公尺 + 真實高程);遊戲空間水平
  // 放大 1/REAL_SCALE 倍、高程不放大 ⇒ 同一條路在遊戲空間的坡度被壓平。
  const laneGameDeg = Math.atan(Math.tan(MAPGEO.MAX_ROAD_GRADE_DEG * D2R) * MAPGEO.REAL_SCALE) / D2R;
  t(`合格兵線在遊戲空間的最陡坡 ≈ ${laneGameDeg.toFixed(2)}° < 平緩帶 ${SLOPE.EASE_DEG}°`,
    laneGameDeg < SLOPE.EASE_DEG, `${laneGameDeg}`);
  t('且留有 ≥25% 餘裕(重烤/改尺度不會讓兵線突然開始被課稅)',
    laneGameDeg <= SLOPE.EASE_DEG * 0.75, `${laneGameDeg}`);
  t('最陡合格兵線恆全速', near(slopeMoveF(laneGameDeg), 1) && !slopeBlocked(laneGameDeg));
  // 遊戲空間的阻擋角換回真實世界:只有峭壁擋人(一般山坡照樣爬得上去,只是慢)
  const blockRealDeg = Math.atan(Math.tan(SLOPE.BLOCK_DEG * D2R) / MAPGEO.REAL_SCALE) / D2R;
  t(`阻擋角換回真實世界 ≈ ${blockRealDeg.toFixed(1)}°(≥45°:只擋峭壁)`, blockRealDeg >= 45, `${blockRealDeg}`);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅳ 消費端單一縫(game.js 執行原文:速度倍率 + 通行閘各一處)');
// ---------------------------------------------------------------------------
{
  t('坡度量測只有 _slopeDegAlong 一支(全檔只有它呼叫 data.js slopeDeg)',
    count(code, 'slopeDeg(') === 1 && count(grab('_slopeDegAlong'), 'slopeDeg(') === 1,
    `slopeDeg ${count(code, 'slopeDeg(')} 處`);
  t('速度倍率只有 _slopeMoveF 一處呼叫 data.js slopeMoveF',
    count(code, ' slopeMoveF(') === 1 && count(grab('_slopeMoveF'), ' slopeMoveF(') === 1);
  t('移動位移確實乘上 slopeF(漏掉 = 整個減速/加速靜默失效)',
    /const slopeF = this\._slopeMoveF\(move\);/.test(code)
    && /this\.pos\.addScaledVector\(move,[\s\S]{0,300}?\* slopeF \*/.test(code));
  t('通行閘只有一處呼叫 slopeBlocked,且在 passable 內',
    count(code, 'slopeBlocked(') === 1
    && /const passable = \(cx, cz\) => \{[\s\S]*?slopeBlocked\(this\._slopeDegAlong\(px0, pz0, py0, cx - px0, cz - pz0\)\)[\s\S]*?return false;/.test(code));
  // 攀爬(climb.js)是陡壁的垂直通道:被坡度閘擋下會連 y 一起還原 = 整套攀爬失效
  t('攀爬中豁免坡度閘(兩套垂直通道 MUST NOT 互相否決)',
    /if \(!climbing && slopeBlocked\(/.test(code));
  t('通行閘量的是「位移前 → 候選點」的實際步進(非前瞻常數)',
    /slopeBlocked\(this\._slopeDegAlong\(px0, pz0, py0, cx - px0, cz - pz0\)\)/.test(code));
  t('速度倍率量的是固定前瞻 PROBE_M(MUST NOT 拿當幀位移 → 手感隨幀率浮動)',
    /const k = SLOPE\.PROBE_M \/ m;/.test(grab('_slopeMoveF'))
    && !/dt/.test(grab('_slopeMoveF')));
  const deg = grab('_slopeDegAlong');
  t('坡度量裸地形 heightAt(MUST NOT 拿站立面 _surf 當高程 → 上橋引道變假峭壁)',
    count(deg, 't.heightAt(x0 + dx, z0 + dz) - t.heightAt(x0, z0)') === 1
    && !/slopeDeg\([^)]*_surf/.test(deg));
  t('人造鋪面(橋面/隧道路面/屋頂)豁免:比對站立面與裸地形高差 vs SLOPE.STRUCT_M',
    /Math\.abs\(this\._surf\(x, z, y0\) - t\.heightAt\(x, z\)\) <= SLOPE\.STRUCT_M/.test(deg)
    && /if \(!bare\(x0, z0\) \|\| !bare\(x0 \+ dx, z0 \+ dz\)\) return 0;/.test(deg));
  t('飛行/騰空豁免(跳過懸崖邊緣 MUST NOT 被坡度擋)',
    /this\._flying\(\)/.test(deg) && /this\._env\?\.air/.test(deg));
  t('坡度閘在地面分支之外亦生效:閘門條件為 heightAt(裸地形恆有)',
    /if \(this\.terrain\.heightAt\) \{[\s\S]{0,400}?const passable = /.test(code));
  t('橋隧判定改 optional(放寬閘門後不得對無橋隧地圖丟例外)',
    /const ce = this\.terrain\.ceilingAt\?\.\(cx, cz, py0\);/.test(code));
  t('陡坡提示節流(完全擋死才播報,且與 _floodWarnAt 同一種 8s 節流)',
    /slopeStop && this\.pos\.x === px0 && this\.pos\.z === pz0 && now - this\._slopeWarnAt > 8/.test(code)
    && /this\._slopeWarnAt = 0;/.test(code));
  t('_slopeMoveF / _slopeDegAlong MUST NOT 出現硬編角度(規則全在 data.js SLOPE)',
    !/\b(16|32)\b/.test(grab('_slopeMoveF') + deg));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅴ 行為直測(執行 game.js 原文:合成高度場 + 橋面/隧道/騰空)');
// ---------------------------------------------------------------------------
{
  const proto = new Function('SLOPE', 'slopeDeg', 'slopeMoveF',
    `return ({ ${grab('_slopeDegAlong')}, ${grab('_slopeMoveF')} });`)(SLOPE, slopeDeg, slopeMoveF);
  /**
   * grade = 沿 +x 的高程斜率(tan);deck != null 時站立面被抬高 deck 公尺(橋面),
   * tunnel != null 時站立面比地形低 tunnel 公尺(隧道路面)。
   */
  const mk = ({ grade = 0, deck = null, tunnel = null, air = false, flying = false, pos = { x: 0, y: 0, z: 0 } } = {}) => {
    const lift = (deck != null ? deck : 0) - (tunnel != null ? tunnel : 0);
    return Object.assign(Object.create(null), proto, {
      pos,
      _env: { air },
      _flying: () => flying,
      terrain: { heightAt: (x) => x * grade },
      // 站立面一律由**當下的** terrain.heightAt 推(測資可換掉 terrain);lift = 橋面抬高 / 隧道下沉
      _surf(x) { return this.terrain.heightAt(x) + lift; },
    });
  };
  const dirF = (c, dx, dz) => c._slopeMoveF({ x: dx, z: dz });

  {
    const flat = mk({ grade: 0 });
    t('平地:坡度 0、倍率 1', near(flat._slopeDegAlong(0, 0, 0, 10, 0), 0) && near(dirF(flat, 1, 0), 1));
  }
  {
    const g = Math.tan(SLOPE.EASE_DEG * D2R);
    const c = mk({ grade: g });
    t('正好平緩帶:上下坡皆全速',
      near(c._slopeDegAlong(0, 0, 0, 10, 0), SLOPE.EASE_DEG, 1e-9)
      && near(dirF(c, 1, 0), 1) && near(dirF(c, -1, 0), 1));
  }
  {
    const mid = (SLOPE.EASE_DEG + SLOPE.BLOCK_DEG) / 2;
    const c = mk({ grade: Math.tan(mid * D2R) });
    t('中等陡坡:上坡減速、下坡加速、橫走(等高線)全速',
      dirF(c, 1, 0) < 1 && dirF(c, -1, 0) > 1 && near(dirF(c, 0, 1), 1),
      `up=${dirF(c, 1, 0).toFixed(3)} down=${dirF(c, -1, 0).toFixed(3)} side=${dirF(c, 0, 1).toFixed(3)}`);
    t('上坡倍率 = 曲線值(兩端同一把尺)', near(dirF(c, 1, 0), slopeMoveF(mid), 1e-9));
    t('斜向(45°)行進吃到的坡度 < 正面上坡', c._slopeDegAlong(0, 0, 0, 7, 7) < c._slopeDegAlong(0, 0, 0, 10, 0));
  }
  {
    const steep = SLOPE.BLOCK_DEG + 10;
    const c = mk({ grade: Math.tan(steep * D2R) });
    t('峭壁:上坡 slopeBlocked 成立、下坡不成立',
      slopeBlocked(c._slopeDegAlong(0, 0, 0, 1, 0)) && !slopeBlocked(c._slopeDegAlong(0, 0, 0, -1, 0)));
    t('峭壁:沿等高線橫走不被擋(逐軸滑行還有路走)',
      !slopeBlocked(c._slopeDegAlong(0, 0, 0, 0, 1)) && !slopeBlocked(c._slopeDegAlong(0, 0, 0, 0, -1)));
    t('峭壁下坡仍只加速到 DOWN_MAX_F', near(dirF(c, -1, 0), SLOPE.DOWN_MAX_F));
  }
  {
    const g = Math.tan((SLOPE.BLOCK_DEG + 20) * D2R);
    t('騰空(_env.air):坡度歸零 —— 跳過懸崖邊緣不被擋',
      mk({ grade: g, air: true })._slopeDegAlong(0, 0, 0, 1, 0) === 0);
    t('飛行型態:坡度歸零', mk({ grade: g, flying: true })._slopeDegAlong(0, 0, 0, 1, 0) === 0);
    t('橋面(站立面高於裸地形 > STRUCT_M):坡度歸零 —— 上橋引道不被當峭壁',
      mk({ grade: g, deck: SLOPE.STRUCT_M + 5 })._slopeDegAlong(0, 0, 0, 1, 0) === 0);
    t('隧道路面(站立面低於裸地形 > STRUCT_M):坡度歸零',
      mk({ grade: g, tunnel: SLOPE.STRUCT_M + 5 })._slopeDegAlong(0, 0, 0, 1, 0) === 0);
    t('鋪面高差在 STRUCT_M 以內仍照吃坡度(路面 lift 不當豁免用)',
      mk({ grade: g, deck: SLOPE.STRUCT_M * 0.5 })._slopeDegAlong(0, 0, 0, 1, 0) > 0);
    // 洞內豁免(2026-07-31 使用者回報「進明隧道卡卡的」):明隧道段的側坡地表可與路面同高
    //(高差閘抓不到),但 tunnelAt 捕捉(y < ceil)= 站的是結構路面 ⇒ 坡度一律歸零。
    t('隧道天花之下(tunnelAt 捕捉)即使鋪面高差 < STRUCT_M 也歸零 —— 明隧道洞內不忽走忽卡', (() => {
      const c = mk({ grade: g });
      c.terrain.tunnelAt = () => ({ floor: 0, ceil: 8 });   // 高差 0(側坡地表 = 路面)仍豁免
      return c._slopeDegAlong(0, 0, 0, 1, 0) === 0;
    })());
    t('天花之上(y ≥ ceil,站洞頂山體)不吃洞內豁免,坡度照量', (() => {
      const c = mk({ grade: g });
      c.terrain.tunnelAt = () => ({ floor: 0, ceil: 8 });
      return c._slopeDegAlong(0, 0, 20, 1, 0) > 0;
    })());
    t('零位移回 0(不除以 0)', mk({ grade: g })._slopeDegAlong(0, 0, 0, 0, 0) === 0);
    t('無 heightAt 的地形回 0(降級不例外)', (() => {
      const c = mk({ grade: g }); c.terrain = {};
      return c._slopeDegAlong(0, 0, 0, 1, 0) === 0;
    })());
  }
  {
    // 前瞻取樣:推杆量(類比搖桿半推)MUST NOT 改變量到的坡度 —— 量的是地形不是速度
    const c = mk({ grade: Math.tan((SLOPE.EASE_DEG + 5) * D2R) });
    t('推杆半推與滿推量到同一個坡(前瞻距離固定 PROBE_M)',
      near(dirF(c, 1, 0), c._slopeMoveF({ x: 0.35, z: 0 }), 1e-12));
    t('推杆歸零:倍率 1(不做無謂取樣)', near(c._slopeMoveF({ x: 0, z: 0 }), 1));
  }
  {
    // 前瞻距離就是 PROBE_M:把坡改成「PROBE_M 之後才變陡」,量到的是前瞻點的高度差
    const c = Object.assign(mk({}), {
      terrain: { heightAt: (x) => (x <= 0 ? 0 : x * Math.tan(SLOPE.BLOCK_DEG * D2R)) },
    });
    const d = c._slopeDegAlong(0, 0, 0, SLOPE.PROBE_M, 0);
    t('前瞻量測落在 PROBE_M 處', near(d, SLOPE.BLOCK_DEG, 1e-9), `${d}`);
  }
  t('騰空門檻沿用 AIR.OFF_GROUND 的 _env.air(不另立第二套騰空判定)',
    /_env\?\.air/.test(grab('_slopeDegAlong')) && AIR.OFF_GROUND > 0);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅵ 下坡貼地(離地量 MUST NOT 逐幀累積 —— 蓄力會被判成騰空而中斷)');
// ---------------------------------------------------------------------------
// 病灶:偏陡的下坡上,地表每幀掉的比自由落體同時間掉的多 ⇒ 機體被留在半空、離地量逐幀累加,
// 兩三幀後 onGround 轉偽,`_updatePlayer` 的 else 分支把 `charge` 清零 = 蓄力中斷。
// onGround 那道容差只擋得住一幀;判定既然說「在地面上」,位置就得跟著吸回去。
{
  t('落差上界只有 data.js slopeSnapM 一份(消費端 MUST NOT 手寫 tan(BLOCK_DEG))',
    count(code, 'slopeSnapM(') === 1 && !/Math\.tan\(SLOPE\.BLOCK_DEG/.test(code));
  t('上界推導自阻擋角(改 BLOCK_F / SNAP_F 自己跟著走,MUST NOT 手寫角度)',
    near(SLOPE.SNAP_DEG, Math.min(89, SLOPE.BLOCK_DEG * SLOPE.SNAP_F), 1e-12)
    && near(slopeSnapM(10), Math.tan(SLOPE.SNAP_DEG * D2R) * 10, 1e-12)
    && slopeSnapM(0) === 0 && slopeSnapM(-5) === 0);
  t('上界 MUST 寬於阻擋角(下坡不擋 ⇒ 走得下去但爬不上來的坡也要貼地)',
    SLOPE.SNAP_DEG > SLOPE.BLOCK_DEG && SLOPE.SNAP_DEG < 90);
  t('斷崖仍彈飛:一步 0.5m 的落差上界仍是坡度量級(不是幾十公尺的瞬移)',
    slopeSnapM(0.5) < 3);
  t('貼地掛在 onGround 那一處,且排除上升段與蓄力跳騰空',
    /if \(onGround && !this\._lowG && this\.vy <= 0 && this\.pos\.y > gy[\s\S]{0,220}?this\.pos\.y = gy; this\.vy = 0;/.test(code));
  t('貼地量的是「本幀實際水平位移」(px0/pz0 → pos)',
    /slopeSnapM\(Math\.hypot\(this\.pos\.x - px0, this\.pos\.z - pz0\)\)/.test(code));

  // 行為直測:逐幀模擬「等速下坡」,離地量 MUST 收斂到 0。
  // 這一段是 `_updatePlayer` 的**鏡射**(那支綁死 three / 地形 / 碰撞,抽不出來執行)——
  // 上面四項靜態斷言就是把鏡射釘回真品的那把鎖:公式或條件一改,靜態先紅。
  const step = (gradeDeg, dt = 1 / 60, frames = 120, speed = 30) => {
    const tan = Math.tan(gradeDeg * D2R);
    const surf = (x) => -x * tan;                     // 沿 +x 走 = 下坡
    let x = 0, y = 0, vy = 0, airborne = 0;
    for (let i = 0; i < frames; i++) {
      const px0 = x, py0 = y;
      x += speed * dt;
      const gy = surf(x);
      const stepDrop = Math.max(0, surf(px0) - gy);
      const onGround = y <= gy + 0.05 || (vy <= 0 && y <= gy + stepDrop + 0.05);
      if (onGround && vy <= 0 && y > gy && y - gy <= slopeSnapM(Math.abs(x - px0))) { y = gy; vy = 0; }
      if (!onGround) airborne++;
      vy -= 9.8 * dt; y += vy * dt;
      if (y < gy) { y = gy; vy = 0; }
      void py0;
    }
    return airborne;
  };
  t('平緩下坡:全程貼地(基準行為不變)', step(SLOPE.EASE_DEG) === 0);
  t('偏陡下坡(阻擋角):全程貼地 = 蓄力不中斷', step(SLOPE.BLOCK_DEG) === 0, `${step(SLOPE.BLOCK_DEG)} 幀騰空`);
  t('走得下去但爬不上來的陡坡(貼地上界)仍全程貼地',
    step(SLOPE.SNAP_DEG * 0.98) === 0, `${step(SLOPE.SNAP_DEG * 0.98)} 幀騰空`);
  t('低幀率(30fps)同樣貼地(離地量 MUST NOT 隨步進放大)',
    step(SLOPE.BLOCK_DEG, 1 / 30) === 0, `${step(SLOPE.BLOCK_DEG, 1 / 30)} 幀騰空`);
  t('高速衝下陡坡仍貼地', step(SLOPE.BLOCK_DEG, 1 / 60, 120, 60) === 0);
  t('超過上界的落差(近乎垂直的崖面)MUST 彈飛,不是被吸著滑下去',
    step(86) > 0, `${step(86)} 幀騰空`);
}

console.log(`\n${fail ? '❌' : '✅'} 地形坡度移動稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
