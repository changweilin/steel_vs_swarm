// ============ 受擊濺血提示 稽核(2026-08-02 使用者需求)============
// 需求原文:「被攻擊時的畫面要有半透明紅色濺血提示,會視敵人射擊的方向,決定濺血位置,
//            傷害越高濺血的血滴越大」。
// 改 `data.js` 的 `BLOOD`/`bloodAlpha`/`bloodFrac`/`bloodDropR`/`bloodDropN`/`bloodScreenUv`、
// `sim.js` 的 `_hurtLog`/`_flushHurt`/`_damage`、`game.js` 的 `_bloodSplat`/`_updateBlood`/`_clearBlood`、
// `main.js` 的 `hud.blood`、`.blood-vig`/`.blood-splat` CSS 或 `#bloodVig` 標記之後跑。
//
// 這支盯的是「**看得見但量不出來**」的那一批寫壞法(本專案無 runtime logger,靠離線稽核當防線):
//   ① 方位自己猜:客戶端只有血量落差,猜出來的方向必定與伺服器分家(A1)⇒ 方位 MUST 只來自
//      伺服器 `hurt` 事件。症狀是「血噴的方向跟被打的方向對不上」,肉眼分不出是延遲還是 bug。
//   ② 高程跨框相減:英雄的 `ay` 是**絕對**高程、NPC/塔在伺服器是**離地**高(地基恆 0)——
//      相減等於拿場地海拔當高度差(`_altDh` 踩過同一個坑,見 /CLAUDE.md §2.1)。
//      症狀是「在高海拔戰區被小兵打,血一律噴在畫面頂端」。
//   ③ flush 點放進 `tick()`:傷害同時發生在 tick 內與訊息處理當下(heroHit/detonate),
//      放錯地方會漏掉 tick 之間回報進來的命中 —— 而漏掉的那些「只是偶爾沒噴血」,沒人查得出來。
//   ④ 血滴大小吃絕對傷害:各機種 EHP 差一個量級 ⇒ 輕甲被擦一下就滿版、重甲被打爆卻沒感覺。
//   ⑤ CSS 掛 transition/animation:與逐幀曲線相爭(`.cc-flash` 同族禁令),峰值被鈍化。
//   ⑥ 濺血跟著鏡頭滑:血漬噴在座艙玻璃上就該黏著不動 ⇒ 位置在建立時烤死,MUST NOT 每幀重算。
//
// 手法比照 `audit_cc_flash.mjs`:曲線直接 import(data.js 是純模組)、`game.js` 抽**執行原文**、
// 伺服器那半以真的 `BattleSim` 行為直測。跑法:`node tools/audit_blood_splat.mjs`
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  BLOOD, bloodDur, bloodAlpha, bloodFrac, bloodDropR, bloodDropN, bloodScreenUv, MAPGEO,
} from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';

const gameSrc = readSrc('public', 'js', 'game.js');
const simSrc = readSrc('server', 'sim.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const css = readSrc('public', 'css', 'style.css');
const html = readSrc('public', 'index.html');

// 「全檔只有 N 處」MUST 只數**執行原文**:註解與 import 清單也提得到同一個名字,
// 連著數會把「說明寫得詳細」誤判成「縫破了」。
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const gameCode = strip(gameSrc).split("} from './data.js';").slice(1).join("} from './data.js';");
const simCode = strip(simSrc);
const mainCode = strip(mainSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 曲線與常數(data.js BLOOD:推導不手寫、半透明、單一縫)');
// ---------------------------------------------------------------------------
{
  t('總長 = HOLD_S + FADE_S(推導不手寫)', near(bloodDur(), BLOOD.HOLD_S + BLOOD.FADE_S), `${bloodDur()}`);
  t('峰值 MUST 半透明(PEAK < 1;調到 1 = 擋住視野,違反「半透明」需求)',
    BLOOD.PEAK > 0 && BLOOD.PEAK < 1, `${BLOOD.PEAK}`);
  t('停留段:剛噴上去即峰值', near(bloodAlpha(bloodDur()), BLOOD.PEAK));
  t('停留段:剩餘 = FADE_S 仍為峰值(邊界)', near(bloodAlpha(BLOOD.FADE_S), BLOOD.PEAK));
  t('停留段長度實測 = HOLD_S', near((() => {
    const D = bloodDur();
    let last = D;
    for (let i = 0; i <= 2000; i++) { const x = D - i * D / 2000; if (near(bloodAlpha(x), BLOOD.PEAK, 1e-12)) last = x; else break; }
    return D - last;
  })(), BLOOD.HOLD_S, bloodDur() / 2000 + 1e-9));
  t('漸淡段單調遞減且收斂到 0', (() => {
    let prev = Infinity;
    for (let i = 0; i <= 60; i++) {
      const a = bloodAlpha(BLOOD.FADE_S * (1 - i / 60));
      if (a > prev + 1e-12) return false;
      prev = a;
    }
    return near(bloodAlpha(0), 0);
  })());
  t('逾時 / 負值一律夾住(不外溢)', near(bloodAlpha(-5), 0) && near(bloodAlpha(bloodDur() * 9), BLOOD.PEAK));
  // 消費端 MUST NOT 手抄任何一個數字
  for (const [k, v] of Object.entries(BLOOD)) {
    if (typeof v !== 'number') continue;
    const lit = String(v);
    t(`BLOOD.${k} = ${lit} MUST NOT 被消費端手抄`,
      !new RegExp(`(?<![\\d.])${lit.replace('.', '\\.')}(?![\\d])`).test(
        [gameCode, mainCode].join('\n').replace(/BLOOD\.\w+/g, '')
          .split('\n').filter((l) => /blood|Blood|BLOOD/.test(l)).join('\n')));
  }
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅱ 血滴大小 ← 傷害「佔自機總量的比例」(MUST NOT 吃絕對傷害值)');
// ---------------------------------------------------------------------------
{
  t('REF_F 是校準錨:一擊打掉 REF_F 比例 = 滿格', near(bloodFrac(0.22 * 1000, 1000) / (0.22 / BLOOD.REF_F), 1, 1e-9)
    || near(bloodFrac(BLOOD.REF_F * 1000, 1000), 1), `${bloodFrac(BLOOD.REF_F * 1000, 1000)}`);
  t('同一份傷害:總量大的機體份量小(比例制,不是絕對值制)',
    bloodFrac(100, 500) > bloodFrac(100, 5000));
  t('份量單調遞增且夾在 0~1', (() => {
    let prev = -1;
    for (let d = 0; d <= 2000; d += 25) {
      const f = bloodFrac(d, 1000);
      if (f < prev - 1e-12 || f < 0 || f > 1) return false;
      prev = f;
    }
    return true;
  })());
  t('零 / 負傷害 / 零總量 = 不濺血', bloodFrac(0, 1000) === 0 && bloodFrac(-9, 1000) === 0 && bloodFrac(50, 0) === 0);
  t('血滴半徑單調遞增,兩端 = DROP_MIN / DROP_MAX',
    near(bloodDropR(0), BLOOD.DROP_MIN) && near(bloodDropR(1), BLOOD.DROP_MAX)
    && bloodDropR(0.3) < bloodDropR(0.7));
  t('傷害越高血滴越大(需求原文;以真實 EHP 尺度直測)',
    bloodDropR(bloodFrac(20, 1200)) < bloodDropR(bloodFrac(120, 1200))
    && bloodDropR(bloodFrac(120, 1200)) < bloodDropR(bloodFrac(400, 1200)));
  t('血滴數單調遞增,兩端 = N_MIN / N_MAX',
    bloodDropN(0) === BLOOD.N_MIN && bloodDropN(1) === BLOOD.N_MAX && bloodDropN(0.3) <= bloodDropN(0.7));
  t('超出範圍的份量一律夾住', near(bloodDropR(9), BLOOD.DROP_MAX) && near(bloodDropR(-9), BLOOD.DROP_MIN));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅲ 濺血位置 ← 攻擊者方位(含背後:夾在畫面邊緣,MUST NOT 折回中央)');
// ---------------------------------------------------------------------------
{
  const halfV = 68 * Math.PI / 180 / 2;
  const halfH = Math.atan(Math.tan(halfV) * 1.78);
  const uv = (b, e = 0) => bloodScreenUv(b, e, halfH, halfV);
  t('正前方 = 畫面正中', near(uv(0).u, 0.5) && near(uv(0).v, 0.5));
  t('右邊來的打在右邊、左邊來的打在左邊', uv(halfH * 0.5).u > 0.5 && uv(-halfH * 0.5).u < 0.5);
  t('偏離越多越靠邊(單調)', (() => {
    let prev = -1;
    for (let i = 0; i <= 40; i++) { const u = uv(halfH * i / 40).u; if (u < prev - 1e-12) return false; prev = u; }
    return true;
  })());
  t('背後中彈**貼齊**左右邊緣(既不折回中央,也不飛出畫面外)',
    near(uv(Math.PI * 0.95).u, 1 - BLOOD.EDGE) && near(uv(-Math.PI * 0.95).u, BLOOD.EDGE),
    `${uv(Math.PI * 0.95).u} / ${uv(-Math.PI * 0.95).u}`);
  t('邊緣內縮 = BLOOD.EDGE(血斑不會有一半跑到畫面外)',
    near(uv(halfH).u, 1 - BLOOD.EDGE) && near(uv(-halfH).u, BLOOD.EDGE));
  t('任何方位/仰角(含 ±π 全掃)u、v MUST 恆落在 [EDGE, 1−EDGE]', (() => {
    for (let i = -64; i <= 64; i++) {
      for (let j = -64; j <= 64; j += 8) {
        const { u, v } = uv(Math.PI * i / 64, Math.PI * j / 64);
        if (u < BLOOD.EDGE - 1e-12 || u > 1 - BLOOD.EDGE + 1e-12) return false;
        if (v < BLOOD.EDGE - 1e-12 || v > 1 - BLOOD.EDGE + 1e-12) return false;
      }
    }
    return true;
  })());
  t('上方來的打在畫面上緣(v 由上往下 ⇒ 仰角正 = v 小)', uv(0, halfV * 0.6).v < 0.5 && uv(0, -halfV * 0.6).v > 0.5);
  t('取不到高程(elev = 0)⇒ 垂直畫在中線(寧缺勿錯)', near(uv(Math.PI * 0.3, 0).v, 0.5));
  t('半視角越窄(狙擊)同一方位越靠邊 ⇒ 不必為狙擊另寫一份縮放',
    bloodScreenUv(0.2, 0, halfH * 0.4, halfV * 0.4).u > uv(0.2).u);
  t('半視角非法(0/負)不炸且回中線',
    near(bloodScreenUv(1, 1, 0, 0).u, 0.5) && near(bloodScreenUv(1, 1, -1, -1).v, 0.5));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅳ 伺服器原文:方位只從 _damage 記帳,flush 排在取走 events 之前');
// ---------------------------------------------------------------------------
{
  const hurtLog = grabMethod(simSrc, '_hurtLog');
  const flush = grabMethod(simSrc, '_flushHurt');
  const frame = grabMethod(simSrc, '_frame');
  const dmg = grabMethod(simSrc, '_damage');
  t('_hurtLog 只有一份實作', count(simCode, '_hurtLog(') === 1 + count(strip(dmg), 'this._hurtLog('),
    `${count(simCode, '_hurtLog(')} 處`);
  t('_damage 兩條路徑都掛上(護盾全擋早退 + 一般結算)', count(strip(dmg), 'this._hurtLog(') === 2,
    `${count(strip(dmg), 'this._hurtLog(')} 處`);
  t('_flushHurt 只在 _frame() 呼叫(唯一 flush 點)', count(simCode, 'this._flushHurt()') === 1
    && strip(frame).includes('this._flushHurt()'));
  t('_flushHurt MUST 排在取走 events 之前', (() => {
    const f = strip(frame);
    return f.indexOf('this._flushHurt()') < f.indexOf('this.events;');
  })());
  t('MUST NOT 放進 tick()(會漏掉 tick 之間回報進來的命中)',
    !strip(grabMethod(simSrc, 'tick')).includes('_flushHurt'));
  t('無攻擊者座標(環境傷害)一律不記', /by\.x == null \|\| by\.z == null/.test(strip(hurtLog)));
  t('只記主視野機(僚機無 flush 點,累積會漏水)', /this\.heroes\.get\(t\.pid\) !== t/.test(strip(hurtLog)));
  t('高程只在「攻擊者也是英雄且有 ay」時附上(跨框相減的坑)',
    /by\.hero && by\.ay != null/.test(strip(hurtLog)));
  t('MUST NOT 拿 _sightY/離地高當高程來源(那是離地框)',
    !/_sightY|LOS\.EYE_M|LOS\.TGT_M/.test(strip(hurtLog)) && !/_sightY/.test(strip(flush)));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅴ 伺服器行為直測(真 BattleSim)');
// ---------------------------------------------------------------------------
{
  const A = [25.0330, 121.5654], D = 1600, R = 6371000;
  const realD = D * MAPGEO.REAL_SCALE, dLat = realD / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]], mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const lane = [];
  for (let s = 0; s <= 1.001; s += 0.05) lane.push([A[0] + (B[0] - A[0]) * s, A[1]]);
  const sizeM = D / (0.85 * Math.SQRT2);
  const sim = new BattleSim({
    center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B }, lanes: [lane],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D, geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  });
  const vic = sim.addHero('SWARM', 'p_v', 'm01');
  const atk = sim.addHero('STEEL', 'p_a', 'm01');
  atk.x = vic.x + 100; atk.z = vic.z - 40; atk.ay = 123.5;
  const hurts = (side = 'SWARM') => sim.snapshotFor(side).ev.filter((e) => e.e === 'hurt');

  sim._damage(vic, 40, atk, 0);
  sim._damage(vic, 60, atk, 0);
  const h1 = hurts();
  t('同一 tick 同一攻擊者併成一筆(散彈一次多發 = 一坨大血漬)', h1.length === 1, `${h1.length} 筆`);
  t('事件指名受擊者(tpid)', h1[0]?.tpid === 'p_v');
  t('帶攻擊者座標', Math.abs(h1[0]?.x - atk.x) < 0.2 && Math.abs(h1[0]?.z - atk.z) < 0.2);
  t('傷害量合計', near(h1[0]?.v, 100, 0.2), `${h1[0]?.v}`);
  t('英雄攻擊者帶絕對高程 ay', h1[0]?.ay === 123.5);

  sim._tickN++;
  t('下一 tick 無傷害 ⇒ 無事件(不重複發)', hurts().length === 0);

  sim._tickN++;
  sim._damage(vic, 25, atk, 0);
  t('同 tick 多份快照共用同一份事件(events 只清一次)',
    hurts('SWARM').length === 1 && hurts('STEEL').length === 1);

  sim._tickN++;
  const npc = [...sim.ents.values()].find((e) => !e.hero && !e.neutral && e.x != null && e.side === 'STEEL');
  sim._damage(vic, 10, atk, 0);
  if (npc) sim._damage(vic, 10, npc, 0);
  const h2 = hurts();
  t('不同攻擊者各一筆', h2.length === (npc ? 2 : 1), `${h2.length} 筆`);
  t('NPC 攻擊者不帶 ay(伺服器算不出它的絕對高程 ⇒ 寧缺勿錯)',
    !npc || h2.some((h) => h.ay === undefined));

  sim._tickN++;
  sim._damage(vic, 30, null, 0);
  t('環境傷害(沼澤/火場,by = null)不濺血(沒有方位可言)', hurts().length === 0);

  sim._tickN++;
  vic.sp = vic.maxSp; vic.hp = vic.maxHp;
  sim._damage(vic, 5, atk, 0);
  t('護盾全擋仍濺血(早退路徑也 MUST 記帳)', hurts().length === 1);

  sim._tickN++;
  const wing = sim.squads.get('p_v').bodies.find((b) => b !== sim.heroes.get('p_v'));
  if (wing) sim._damage(wing, 20, atk, 0);
  t('僚機挨打不噴在座艙玻璃上', !wing || hurts().length === 0);
  t('僚機不留累積帳(無 flush 點 ⇒ 會漏水)', !wing || wing._hurt == null);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅵ 客戶端原文:方位只來自伺服器事件、位置烤死、清帳齊全');
// ---------------------------------------------------------------------------
{
  const splat = strip(grabMethod(gameSrc, '_bloodSplat'));
  const upd = strip(grabMethod(gameSrc, '_updateBlood'));
  t('唯一觸發點 = hurt 事件且指名自己(A1:方位 MUST NOT 客戶端自己猜)',
    count(gameCode, '_bloodSplat(') === 2
    && /ev\.e === 'hurt'[\s\S]{0,160}?ev\.tpid === this\.youId[\s\S]{0,40}?this\._bloodSplat\(ev\)/.test(gameCode),
    `${count(gameCode, '_bloodSplat(')} 處`);
  t('MUST NOT 從血量落差自造方位(_prevVital 不得出現在濺血路徑)',
    !/_prevVital/.test(splat) && !/_prevVital/.test(upd));
  t('sim 的 z MUST 反號(與 boom/die 同一條換算)', /-ev\.z/.test(splat));
  t('相機矩陣自己 invert(matrixWorldInverse 是 renderer.render 才寫的)',
    /matrixWorld\)\.invert\(\)/.test(splat) && !/matrixWorldInverse/.test(splat));
  t('水平方位走 atan2(右, 前)⇒ 背後也有解', /Math\.atan2\(p\.x, fwd\)/.test(splat));
  t('仰角只在事件帶 ay 時才算(跨框相減的坑)', /ev\.ay != null \? Math\.atan2/.test(splat));
  t('半視角吃當下鏡頭(狙擊縮 FOV 自動跟著收)', /cam\.fov/.test(splat) && /cam\.aspect/.test(splat));
  t('位置/大小/數量全走 data.js 曲線(消費端不自寫)',
    /bloodScreenUv\(/.test(splat) && /bloodDropR\(/.test(splat) && /bloodDropN\(/.test(splat)
    && /bloodFrac\(/.test(splat));
  t('份量分母 = 自機總量上限(maxHp + maxSp)', /this\.maxHp \|\| 0\) \+ \(this\.maxSp \|\| 0/.test(splat));
  t('同時存在的血斑有上限(BLOOD.MAX;最舊的先退場)',
    /this\._blood\.length > BLOOD\.MAX[\s\S]{0,40}?shift\(\)/.test(splat));
  t('逐幀衰減 ← bloodAlpha,清空那幀仍推一次後才早退',
    /bloodAlpha\(b\.left\)/.test(upd) && /this\._bloodOn/.test(upd));
  t('_updateBlood 掛在主迴圈(與 _updateCcFlash 同一處)',
    /this\._updateCcFlash\(dt\);[\s\S]{0,200}?this\._updateBlood\(dt\);/.test(gameCode));
  t('陣亡 / 換座機 MUST 清帳(血漬不跟著下一條命 / 下一具機體)',
    count(gameCode, 'this._clearBlood()') >= 2
    && /_clearCcFlash\(\);[\s\S]{0,200}?_clearBlood\(\)/.test(gameCode),
    `${count(gameCode, 'this._clearBlood()')} 處`);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅶ HUD / 標記 / 樣式(逐幀曲線 MUST NOT 與 CSS 過渡相爭)');
// ---------------------------------------------------------------------------
{
  t('#bloodVig 標記存在且掛 .blood-vig', /id="bloodVig"[^>]*class="blood-vig"/.test(html));
  t('hud.blood 只有一份實作', count(mainCode, 'blood: (') === 1);
  t('依 id 對帳(新建 / 更新 opacity / 移除),MUST NOT 每幀重建 DOM',
    /data-bid/.test(mainCode) && /el\.remove\(\)/.test(mainCode) && !/innerHTML\s*=/.test(
      mainCode.split('blood: (')[1]?.split('\n    },')[0] || ''));
  t('位置與圖樣在建立時烤死(血漬黏在玻璃上,不跟著鏡頭滑)', (() => {
    const body = mainCode.split('blood: (')[1]?.split('\n    },')[0] || '';
    const create = body.split('box.appendChild(el);')[0];
    const after = body.split('box.appendChild(el);')[1] || '';
    return /el\.style\.left/.test(create) && /backgroundImage/.test(create)
      && !/el\.style\.left/.test(after) && !/backgroundImage/.test(after);
  })());
  const blk = css.split('.blood-splat {')[1]?.split('}')[0] || '';
  t('.blood-splat MUST NOT 掛 transition / animation(與逐幀曲線相爭)',
    blk !== '' && !/transition|animation/.test(blk), blk.trim());
  t('.blood-vig 不吃指標事件且壓在 HUD(z 10)之下', (() => {
    const v = css.split('.blood-vig {')[1]?.split('}')[0] || '';
    const z = Number((v.match(/z-index:\s*(\d+)/) || [])[1]);
    return /pointer-events:\s*none/.test(v) && z > 0 && z < 10;
  })());
  t('血色 MUST 是紅色系(需求原文「紅色濺血」)', (() => {
    const body = mainCode.split('blood: (')[1]?.split('\n    },')[0] || '';
    const cols = [...body.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)];
    return cols.length > 0 && cols.every(([, r, g, b]) => Number(r) >= Number(g) && Number(r) >= Number(b));
  })());
}

console.log(`\n${fail ? '❌' : '✅'} 受擊濺血提示稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
