// ============ 後座力 → 開火中移動速度 稽核 ============
// 用途:改 `data.js` 的 `RECOIL`(任一階 `climb` / `MOVE_K` / `DECAY` / `END_RAD`)、
// `RECOIL_CLIMB_MAX`/`recoilMoveF()`,或 `game.js` 的 `_recoiling`/`_recoilMoveF`/`_tryFire`
// 位移懲罰段/`_updatePlayer` 後座回穩段/陣亡與換座機清帳,或 `main.js` 武器列的「射擊移速」後跑。
//
// 這條規則(2026-08-03 使用者定案)是:「後座力越大的武器,射擊中的移動速度下降越多,
// 最大後座力的重武器會將移動速度歸零、直到後座力結束」。三件事各自會**靜默**壞掉:
//   ① 曲線退回逐階手寫 ⇒ 序又亂掉(舊制:機槍全停、後座更大的榴彈砲完全不受影響),
//      而畫面上只表現成「這把槍動不了、那把重砲反而能跑」,沒有任何數字看得出來。
//   ② 時間窗退回舊制那個「到下一發窗口」的計時器 ⇒ 重武器打完一發早就恢復全速,
//      使用者要的那段「歸零直到後座結束」量不到(手感只是「好像沒什麼差」)。
//   ③ 係數在 `recoil.p +=` **之後**才定案 ⇒ `_recoiling()` 恆為真,取較嚴者變成單向棘輪:
//      打過一發重砲之後,係數再也降不回來 = 整場都在最嚴懲罰下走路。
//
// 手法比照 `audit_cc_flash.mjs`:曲線直接 import(data.js 是純模組),game.js 的方法
// **抽執行原文**評估(three 走 CDN、Node 端 import 不了整支;抄一份公式進稽核就永遠會通過)。
// 跑法:`node tools/audit_recoil_move.mjs`
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  RECOIL, RECOIL_CLIMB_MAX, recoilMoveF, recoilTier, recoilName,
  CHARACTERS, heroWeapon,
} from '../public/js/data.js';

const src = readSrc('public', 'js', 'game.js');
const dataSrc = readSrc('public', 'js', 'data.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const modelsSrc = readSrc('public', 'js', 'models.js');
const grab = (name) => grabMethod(src, name);

// 「全檔只有 N 處」MUST 只數**執行原文**:註解與 import 清單也提得到同一個名字,
// 連著數會把「說明寫得詳細」誤判成「縫破了」。
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const code = strip(src).split("} from './data.js';").slice(1).join("} from './data.js';");
const dataCode = strip(dataSrc);
const mainCode = strip(mainSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;

// 六階 profile 依後座量排序(跨槽位)—— 下面多段共用
const TIERS = ['light', 'heavy'].flatMap((s) => ['low', 'med', 'high'].map((k) => ({ s, k, p: RECOIL[s][k] })));
const BY_CLIMB = [...TIERS].sort((a, b) => a.p.climb - b.p.climb);

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 曲線(data.js:後座量 → 移速係數,推導不手寫)');
// ---------------------------------------------------------------------------
{
  t('RECOIL_CLIMB_MAX = 六階最大 climb', near(RECOIL_CLIMB_MAX, Math.max(...TIERS.map((x) => x.p.climb))),
    `${RECOIL_CLIMB_MAX}`);
  t('最大那一階 = 重武器高後座(「最大後座力的重武器」)',
    near(RECOIL_CLIMB_MAX, RECOIL.heavy.high.climb));
  const decl = /export const RECOIL_CLIMB_MAX =[\s\S]*?;/.exec(dataCode)?.[0] || '';
  t('MAX 推導不手寫(定義式內無數字字面值)', decl !== '' && !/\d/.test(decl), decl.replace(/\s+/g, ' '));
  t('MAX 由 Math.max 掃全表(任一階 climb 一改自己跟著走)',
    /Math\.max\(/.test(decl) && /RECOIL\[s\]/.test(decl));

  t('最大後座 ⇒ 移速歸零(嚴格 0)', recoilMoveF({ climb: RECOIL_CLIMB_MAX }) === 0,
    `${recoilMoveF({ climb: RECOIL_CLIMB_MAX })}`);
  t('無後座 ⇒ 不減速(係數 1)', recoilMoveF({ climb: 0 }) === 1);
  t('缺 climb / 空 profile 一律視同無後座',
    recoilMoveF(null) === 1 && recoilMoveF(undefined) === 1 && recoilMoveF({}) === 1);
  t('超過最大後座仍夾在 0(不長出負速度)', recoilMoveF({ climb: RECOIL_CLIMB_MAX * 9 }) === 0);
  t('負 climb 夾回 1', recoilMoveF({ climb: -1 }) === 1);

  t('六階 climb 跨槽位嚴格遞增(這是「後座量」當尺的前提)',
    BY_CLIMB.every((x, i) => i === 0 || x.p.climb > BY_CLIMB[i - 1].p.climb),
    BY_CLIMB.map((x) => `${x.s}.${x.k}=${x.p.climb}`).join(' '));
  t('六階移速係數嚴格遞減(後座越大降越多)',
    BY_CLIMB.every((x, i) => i === 0 || recoilMoveF(x.p) < recoilMoveF(BY_CLIMB[i - 1].p)),
    BY_CLIMB.map((x) => `${x.s}.${x.k}=${recoilMoveF(x.p).toFixed(3)}`).join(' '));
  t('連續掃描 0→MAX 單調不增', (() => {
    let prev = Infinity;
    for (let i = 0; i <= 500; i++) {
      const f = recoilMoveF({ climb: RECOIL_CLIMB_MAX * i / 500 });
      if (f > prev + 1e-12) return false;
      prev = f;
    }
    return true;
  })());
  t('每一階都有懲罰(不是只有「全速 / 全停」兩檔)', TIERS.every((x) => recoilMoveF(x.p) < 1));
  t('只有最大後座那一階歸零(其餘皆 > 0)',
    TIERS.filter((x) => recoilMoveF(x.p) === 0).map((x) => `${x.s}.${x.k}`).join(',') === 'heavy.high');
  t('MOVE_K = 1 ⇒ 降幅正比於後座量', (() => {
    if (RECOIL.MOVE_K !== 1) return true;   // K 改了就不該再驗「正比」這條具體形狀
    for (let i = 0; i <= 50; i++) {
      const c = RECOIL_CLIMB_MAX * i / 50;
      if (!near(recoilMoveF({ climb: c }), 1 - c / RECOIL_CLIMB_MAX)) return false;
    }
    return true;
  })());
  t('曲線族性質:任一 K > 0 兩個端點都不動', [0.4, 1, 2.5].every((K) => {
    const k0 = RECOIL.MOVE_K;
    RECOIL.MOVE_K = K;
    const ok = recoilMoveF({ climb: 0 }) === 1 && recoilMoveF({ climb: RECOIL_CLIMB_MAX }) === 0
      && BY_CLIMB.every((x, i) => i === 0 || recoilMoveF(x.p) < recoilMoveF(BY_CLIMB[i - 1].p));
    RECOIL.MOVE_K = k0;
    return ok;
  }));

  t('回穩速率 / 結束門檻 / 曲線指數皆為正', RECOIL.DECAY > 0 && RECOIL.END_RAD > 0 && RECOIL.MOVE_K > 0);
  t('結束門檻遠小於最小單發後座(否則輕武器連判定都進不去)',
    RECOIL.END_RAD < BY_CLIMB[0].p.climb / 3, `END_RAD=${RECOIL.END_RAD} min climb=${BY_CLIMB[0].p.climb}`);

  // 舊制那兩欄 MUST 整組退場 —— 留著就是「第二份分級表」,調曲線時它不會動
  t('舊制 move / slowF 兩欄已從六階 profile 移除',
    TIERS.every((x) => x.p.move === undefined && x.p.slowF === undefined));
  t('data.js 原文無 move: / slowF 殘留',
    !/\bmove:\s*'/.test(dataCode) && !/\bslowF\b/.test(dataCode));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅱ 消費端單一縫(game.js:係數一處定案、時間窗一處判定)');
// ---------------------------------------------------------------------------
{
  const fire = grab('_tryFire'), mf = grab('_recoilMoveF'), rg = grab('_recoiling');

  t('係數只由 data.js recoilMoveF 推導,且全檔只在 _tryFire 定案一次',
    count(code, 'recoilMoveF({') === count(fire, 'recoilMoveF({') && count(code, 'recoilMoveF({') === 2,
    `全檔 ${count(code, 'recoilMoveF({')} 處`);   // 三元的兩支
  // 舊制的 'stop'/'slow'/'free' 分級字串 MUST NOT 復辟。只掃**後座相關**的三段原文 ——
  // 全檔另有控場緩速 `this.slowF`(伺服器 mods 快照)是完全不同的一件事,連著掃會假紅字。
  t('後座相關原文 MUST NOT 自己寫一份分級 / 百分比表',
    [fire, mf, rg].every((s) => !/'stop'|'slow'|'free'|slowF/.test(s)));
  t('_recoilMoveF 一份實作、恰兩個消費端(地面 + 飛行)',
    count(code, '_recoilMoveF(') === 3, `${count(code, '_recoilMoveF(')} 處(含定義)`);
  t('_recoiling 一份實作、恰兩個消費端(時間窗 + 取較嚴者)',
    count(code, '_recoiling()') === 3, `${count(code, '_recoiling()')} 處(含定義)`);
  t('END_RAD 只在 _recoiling(時間窗判定不散寫)',
    count(code, 'RECOIL.END_RAD') === 1 && count(rg, 'RECOIL.END_RAD') === 1);
  t('時間窗量的是 recoil.p 這個狀態本身', /Math\.abs\(this\.recoil\.p\)\s*>\s*RECOIL\.END_RAD/.test(rg), rg);
  // 2026-08-16 起指數衰減收成 data.js 的唯一縫 `frictionFPS`(見那一段註解);
  // 語意與數值逐位元不動(`frictionFPS(k, dt)` **就是** `Math.exp(-k · dt)`),
  // 但 game.js MUST NOT 再自己寫一份 `Math.exp` —— 那是第二份幀率無關性的定義。
  t('回穩速率吃 RECOIL.DECAY(與時間窗同一條曲線)',
    /frictionFPS\(RECOIL\.DECAY, dt\)/.test(code) && count(code, 'RECOIL.DECAY') === 1);
  t('回穩 MUST 走 data.js 的阻尼縫,MUST NOT 自己寫 Math.exp',
    !/Math\.exp\(-dt \* RECOIL\.DECAY\)/.test(code));
  t('game.js 無手寫回穩常數(-dt * 7)', !/-dt \* 7\b/.test(code));

  // ③ 那個靜默棘輪:係數 MUST 排在 `recoil.p +=` 之前
  const iSet = fire.indexOf('this._recoilMoveF0 =');
  const iAdd = fire.indexOf('this.recoil.p +=');
  t('係數定案排在 recoil.p += 之前(否則 _recoiling 恆真 = 單向棘輪)',
    iSet > 0 && iAdd > 0 && iSet < iAdd, `set@${iSet} add@${iAdd}`);
  t('後座中取較嚴者(重砲的歸零不被下一發輕武器解除)',
    /this\._recoilMoveF0 = this\._recoiling\(\)[\s\S]{0,160}?Math\.min\(this\._recoilMoveF0/.test(fire));
  t('這一發的後座量只解析一次(climb 單一變數,上踢與係數同吃)',
    count(fire, 'const climb =') === 1 && /this\.recoil\.p \+= climb;/.test(fire));

  t('舊制計時器欄位全數退場',
    !/_recoilMoveUntil|_recoilSlowF|_recoilMove\b/.test(code));
  t('舊制「到下一發窗口」的計時式已無殘留', !/Math\.max\(0\.22, 1 \/ def\.rate\)/.test(code));

  // 位移懲罰只夾**移動輸入**;擊退是後座本身的位移,MUST NOT 一起被夾成 0
  const backLine = code.split('\n').find((l) => l.includes('prof.back') && l.includes('this.vel')) || '';
  t('擊退 back 走 this.vel,不吃移速係數', backLine !== '' && !backLine.includes('_recoilMoveF'), backLine.trim());
  t('地面移動鏈套一次移速係數', /this\.pos\.addScaledVector\(move,[\s\S]{0,200}?this\._recoilMoveF\(false\)/.test(code));
  t('飛行推杆鏈套一次移速係數(帶 fly 旗標)', /target\.multiplyScalar\([\s\S]{0,80}?this\._recoilMoveF\(true\)/.test(code));

  t('陣亡與換座機都清後座與係數(不跟著搬到下一具機體)',
    count(code, 'this._recoilMoveF0 = 1;') === 3 && count(code, 'this.recoil.p = 0;') === 2,
    `F0 ${count(code, 'this._recoilMoveF0 = 1;')} 處(含建構)`);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅲ 行為直測(執行 game.js 原文:歸零 → 直到後座力結束 → 恢復)');
// ---------------------------------------------------------------------------
{
  const proto = new Function('RECOIL', `return ({ ${grab('_recoiling')}, ${grab('_recoilMoveF')} });`)(RECOIL);
  const mk = (climb, f) => Object.assign(Object.create(null), proto, {
    recoil: { p: climb, y: 0 }, _recoilMoveF0: f,
  });
  const HH = RECOIL.heavy.high, LL = RECOIL.light.low;

  {
    const c = mk(HH.climb, recoilMoveF(HH));
    t('最大後座重武器:擊發當下地面移速 = 0', c._recoilMoveF(false) === 0);
    t('最大後座重武器:飛行機體吃 AIR_F 折扣(空中減半)',
      near(c._recoilMoveF(true), 1 - RECOIL.AIR_F), `${c._recoilMoveF(true)}`);
  }
  {
    const c = mk(LL.climb, recoilMoveF(LL));
    t('低後座輕武器:窗內為該武器係數', near(c._recoilMoveF(false), recoilMoveF(LL)));
    t('低後座輕武器:飛行時懲罰減半',
      near(c._recoilMoveF(true), 1 - (1 - recoilMoveF(LL)) * RECOIL.AIR_F));
  }
  {
    const c = mk(0, 0);
    t('後座已結束 ⇒ 恆全速(地面)', c._recoilMoveF(false) === 1);
    t('後座已結束 ⇒ 恆全速(飛行)', c._recoilMoveF(true) === 1);
    c.recoil.p = RECOIL.END_RAD;
    t('門檻邊界:剛好等於 END_RAD 視為已結束', c._recoilMoveF(false) === 1);
    c.recoil.p = RECOIL.END_RAD * 1.001;
    t('門檻邊界:略高於 END_RAD 仍在窗內', c._recoilMoveF(false) === 0);
  }
  {
    // 「歸零、直到後座力結束」:逐幀跑真的回穩曲線,量係數什麼時候放開
    const run = (prof, fps) => {
      const c = mk(prof.climb, recoilMoveF(prof));
      const dt = 1 / fps, rk = Math.exp(-dt * RECOIL.DECAY);
      let zeroS = 0, freed = -1;
      for (let i = 1; i <= fps * 5; i++) {
        c.recoil.p *= rk;
        const f = c._recoilMoveF(false);
        if (f === recoilMoveF(prof) && freed < 0) zeroS = i * dt;
        if (f === 1 && freed < 0) freed = i * dt;
      }
      return { zeroS, freed };
    };
    const closed = (prof) => Math.log(prof.climb / RECOIL.END_RAD) / RECOIL.DECAY;
    const a = run(HH, 60);
    t('最大後座:全程 0 直到後座結束,之後恢復全速', a.freed > 0 && near(a.zeroS, a.freed - 1 / 60, 1e-9),
      `zero=${a.zeroS.toFixed(3)}s freed=${a.freed.toFixed(3)}s`);
    t('懲罰時長 = 回穩曲線的閉式解(ln(climb/END_RAD)/DECAY)',
      Math.abs(a.freed - closed(HH)) <= 1 / 60 + 1e-9, `實測 ${a.freed.toFixed(3)}s / 解 ${closed(HH).toFixed(3)}s`);
    const b = run(HH, 240);
    t('幀率無關:60fps 與 240fps 結束時間一致', Math.abs(a.freed - b.freed) <= 1 / 60 + 1e-9,
      `${a.freed.toFixed(3)} vs ${b.freed.toFixed(3)}`);
    t('後座越大懲罰越久(輕低後座解除得早)', run(LL, 240).freed < b.freed,
      `light.low ${run(LL, 240).freed.toFixed(3)}s < heavy.high ${b.freed.toFixed(3)}s`);
    t('低後座武器同樣有窗、窗內就是它自己的係數', (() => {
      const c = mk(LL.climb, recoilMoveF(LL));
      const rk = Math.exp(-(1 / 60) * RECOIL.DECAY);
      c.recoil.p *= rk;
      return near(c._recoilMoveF(false), recoilMoveF(LL));
    })());
    t('持續射擊:每發把窗推回滿載(連射期間恆為該係數)', (() => {
      const c = mk(0, 1), rk = Math.exp(-(1 / 60) * RECOIL.DECAY);
      let ok = true;
      for (let i = 0; i < 120; i++) {
        if (i % 12 === 0) { c.recoil.p += HH.climb; c._recoilMoveF0 = recoilMoveF(HH); }
        c.recoil.p *= rk;
        if (c._recoilMoveF(false) !== 0) ok = false;
      }
      return ok;
    })());
  }
}

// ---------------------------------------------------------------------------
console.log('■ Ⅳ 取較嚴者(直接執行 _tryFire 那一段賦值原文)');
// ---------------------------------------------------------------------------
{
  const fire = grab('_tryFire');
  const expr = /this\._recoilMoveF0 = this\._recoiling\(\)[\s\S]*?;/.exec(fire)?.[0] || '';
  t('抓得到係數定案原文', expr !== '');
  const apply = new Function('c', 'climb', 'recoilMoveF',
    `${expr.replace(/\bthis\./g, 'c.')} return c._recoilMoveF0;`);
  const ctx = (recoiling, f0) => ({ _recoiling: () => recoiling, _recoilMoveF0: f0 });
  const HH = RECOIL.heavy.high, LL = RECOIL.light.low;

  t('後座已結束:直接取這一發的係數(較輕的也照樣生效)',
    near(apply(ctx(false, 0), LL.climb, recoilMoveF), recoilMoveF(LL)));
  t('後座未結束 + 這一發更嚴:換成更嚴的',
    near(apply(ctx(true, recoilMoveF(LL)), HH.climb, recoilMoveF), recoilMoveF(HH)));
  t('後座未結束 + 這一發較輕:保留較嚴的(重砲歸零不被輕武器提早解除)',
    near(apply(ctx(true, recoilMoveF(HH)), LL.climb, recoilMoveF), recoilMoveF(HH)));
  t('同武器連射:係數穩定不漂移(取較嚴者是冪等的)',
    near(apply(ctx(true, recoilMoveF(HH)), HH.climb, recoilMoveF), recoilMoveF(HH)));
  t('首發(F0 尚未定義)不炸且取這一發的值',
    near(apply({ _recoiling: () => true }, HH.climb, recoilMoveF), recoilMoveF(HH)));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅴ 現役武器與圖鑑顯示');
// ---------------------------------------------------------------------------
{
  const rows = [];
  for (const [id, ch] of Object.entries(CHARACTERS)) {
    for (const slot of ['light', 'heavy']) {
      if (!ch[slot]) continue;
      const prof = recoilTier(ch[slot], slot);
      rows.push({ id, slot, name: ch[slot].name, f: recoilMoveF(prof), lv: recoilName(ch[slot], slot) });
    }
  }
  t('現役武器全數解析得到係數 ∈ [0,1]', rows.length >= 60 && rows.every((r) => r.f >= 0 && r.f <= 1),
    `${rows.length} 把`);
  t('「移動歸零」真的出現在遊戲裡(至少一把重武器 = 0)',
    rows.some((r) => r.slot === 'heavy' && r.f === 0));
  t('歸零只發生在重武器(輕武器一把都不歸零)',
    rows.filter((r) => r.f === 0).every((r) => r.slot === 'heavy'),
    rows.filter((r) => r.f === 0 && r.slot === 'light').map((r) => r.name).join(','));
  t('同槽位:後座分級「高」的係數 ≤「中」≤「低」', ['light', 'heavy'].every((slot) => {
    const g = (lv) => rows.filter((r) => r.slot === slot && r.lv === lv).map((r) => r.f);
    const mn = (a) => (a.length ? Math.min(...a) : Infinity), mx = (a) => (a.length ? Math.max(...a) : -Infinity);
    return mx(g('高')) <= mn(g('中')) && mx(g('中')) <= mn(g('低'));
  }));
  t('解析後的 def.recoil 與 recoilTier 同一個 profile(heroWeapon 不另建)',
    near(recoilMoveF(heroWeapon('s01', 'heavy', 1).recoil), recoilMoveF(recoilTier(CHARACTERS.s01.heavy, 'heavy'))));

  t('圖鑑武器列有「射擊移速」且由 recoilMoveF(recoilTier(…)) 推導',
    /射擊移速 \$\{Math\.round\(recoilMoveF\(recoilTier\(/.test(mainCode));
  t('圖鑑 MUST NOT 手寫百分比 / 分級字串',
    !/'停止'|'減速'|'不受影響'/.test(mainCode) && count(mainCode, 'recoilMoveF(') === 1);
  t('後座分級標籤仍是 低/中/高(顯示層不動)',
    ['低', '中', '高'].every((l) => rows.some((r) => r.lv === l)));
  t('models.js 的機體後座動畫仍吃 kick(MUST NOT 改吃 climb 當第二把尺)',
    /recoilTier\(cw\.light, 'light'\)\.kick/.test(modelsSrc) && /recoilTier\(cw\.heavy, 'heavy'\)\.kick/.test(modelsSrc));
}

console.log(`\n${fail ? '❌' : '✅'} 後座力位移懲罰稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
