// ============ 建築加乘移除 + 護盾/裝甲分軌剋制 稽核 ============
// 用途:改 `data.js` 的 `BUILDING_VS_CAP` 夾制段 / `shieldSplit()` / `shieldRoleName()`,
// 或 `sim._damage()`、`sim._heroDmg()`、`tools/duel.mjs` 的 apply()、`tools/balance.mjs` 的
// 對建築 DPS、`game._hitFeedback`/`_lanceFeedback` 的估算之後跑。
// 跑法:`node tools/audit_shield_counter.mjs`
//
// 為什麼要這一支 —— 兩件改動各有一個「壞掉但不會報錯」的形狀:
//
// ① **建築加乘移除**(2026-08-02 使用者定案「移除對建築物加乘的武器」)。
//    加成有兩層:各武器的 `vs.building`(0.3~2.2)+ launcher 專屬的 `GRENADE.BUILDING_MUL`(×1.4)。
//    ②整組刪;①改成**只留懲罰**(夾到 ≤ `BUILDING_VS_CAP`)。這裡最容易壞的不是刪錯,而是
//    **夾制的名冊漏一張表** —— 招式(skill/ult)、`WEAPONS`、`DECOY`/`HYPER` 各自有 vs 表,
//    漏掉哪一張,那條路徑就還留著舊的攻城加成,而遊戲裡只會表現成「這招拆塔特別快」,
//    沒有任何錯誤訊息。故此處逐張表掃過去,而不是相信夾制迴圈寫對了。
//    另驗 `grenadeBuildingMul` 在**全儲存庫執行原文**中已無殘留(留一處消費端 = 加乘沒真的移除)。
//
// ② **護盾/裝甲分軌剋制**(使用者需求「加入擅長打護盾但主 HP 傷害較弱、會穿透護盾造成低比例
//    HP 傷害但總傷害較低等各類型武器」)。三個旋鈕 vsSp/vsHp/spPierce 的結算住 `shieldSplit`,
//    而**同一份拆分邏輯有四個消費端**(伺服器結算 / 客戶端 HUD 估算 / 對進戰模型 / 平衡模型)。
//    任一端自己手寫一次 `Math.min(sp, dmg)`,症狀是「HUD 數字與實際掉血對不上」或
//    「bal 說平衡但打起來不是」—— 兩者都極難從畫面反推。故此處驗**單一縫**:
//    伺服器/客戶端/兩支模型都 MUST 呼叫 shieldSplit,且 sim.js 全檔沒有第二處手寫的護盾扣減。
//
// 另驗一條數學不變量:**溢出按預算折回**。把打穿護盾後的溢出直接倒進裝甲層,會讓 vsSp 高的武器
// 在殘盾目標上白賺一次反護盾加成(打空盾那一發傷害暴衝),而且只在「盾剛好見底」那一發出現
// ⇒ 對局裡看起來就是隨機爆發傷害。這條用行為直測釘死,不看原文。
//
// 讀原文走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc } from './audit_src.mjs';
import * as DATA from '../public/js/data.js';
import { BUILDING_VS_CAP, shieldSplit, shieldRoleName, CHARACTERS, WEAPONS, DECOY, HYPER,
  heroWeapon, heroAbility, UNITS, MAPGEO,
  EX_SIEGE_WEAPONS, COUNTER_BUDGET, counterLoad, counterDmgF } from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';

// 合成戰場設定(同 test/e2e.mjs / audit_lance_hit.mjs 的 fakeBattleConfig;單線、台北 101 附近)
function fakeBattleConfig(L = 1) {
  const A = [25.0330, 121.5654];
  const D = 1600 * L, R = 6371000;
  const dLat = D * MAPGEO.REAL_SCALE / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const pts = [];
  for (let u = 0; u <= 1.001; u += 0.05) {
    const v = 1 - u;
    pts.push([v * v * A[0] + 2 * v * u * mid[0] + u * u * B[0], v * v * A[1] + 2 * v * u * mid[1] + u * u * B[1]]);
  }
  const sizeM = D / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B }, lanes: [pts],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D, geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '護盾剋制稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;

/** 剝掉區塊/行註解 —— 「全檔只有 N 處」MUST 只數執行原文(註解提到同一個名字不算縫破了) */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

const dataSrc = strip(readSrc('public', 'js', 'data.js'));
const simSrc = strip(readSrc('server', 'sim.js'));
const gameSrc = strip(readSrc('public', 'js', 'game.js'));
const duelSrc = strip(readSrc('tools', 'duel.mjs'));
const balSrc = strip(readSrc('tools', 'balance.mjs'));

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 建築加乘移除(加乘全刪、懲罰保留;夾制是推導不是逐武器手改)');
// ---------------------------------------------------------------------------
{
  t('BUILDING_VS_CAP === 1(建築剋制上限 = 無加乘)', BUILDING_VS_CAP === 1, `${BUILDING_VS_CAP}`);

  // 逐張 vs 表掃過去 —— 不相信夾制迴圈的名冊寫全了
  const tables = [
    ...Object.entries(WEAPONS).map(([k, w]) => [`WEAPONS.${k}`, w]),
    ['DECOY', DECOY], ['HYPER', HYPER],
    ...Object.entries(CHARACTERS).flatMap(([id, c]) =>
      ['light', 'heavy', 'skill', 'ult'].filter((s) => c[s]).map((s) => [`${id}.${s}`, c[s]])),
  ];
  const over = tables.filter(([, w]) => w?.vs?.building > BUILDING_VS_CAP);
  t(`所有 vs 表對建築無加乘(掃 ${tables.length} 張)`, over.length === 0,
    over.map(([n, w]) => `${n}=${w.vs.building}`).join(' '));

  // 懲罰保留:若連 <1 都被抹平,那是「移除整個建築剋制」不是「移除加乘」
  const under = tables.filter(([, w]) => w?.vs?.building < 1);
  t(`懲罰保留(${under.length} 張表仍 < 1:防空/反甲特化拆建築照樣吃虧)`, under.length > 0);

  // 解析後的實戰值同樣夾住(heroWeapon/heroAbility 是同一個 vs 參照 ⇒ 夾在源頭即全鏈生效)
  const solved = [];
  for (const id of Object.keys(CHARACTERS)) {
    for (const s of ['light', 'heavy']) { const w = heroWeapon(id, s, 3, true); if (w?.vs?.building > 1) solved.push(`${id}.${s}`); }
    for (const s of ['skill', 'ult']) { const a = heroAbility(id, s, 3); if (a?.vs?.building > 1) solved.push(`${id}.${s}`); }
  }
  t('heroWeapon/heroAbility 解析後仍無加乘(夾在源頭即全鏈生效)', solved.length === 0, solved.join(' '));

  // 夾制 MUST 是推導的一段迴圈,不是逐武器手改(1 宣告 + 夾制段的比較與指派各 1)
  t('夾制在 data.js 只有唯一一段推導迴圈',
    count(dataSrc, 'BUILDING_VS_CAP') === 3 && /w\.vs\.building > BUILDING_VS_CAP\) w\.vs\.building = BUILDING_VS_CAP;/.test(dataSrc),
    `${count(dataSrc, 'BUILDING_VS_CAP')} 處`);

  // launcher 對建築 ×1.4 整組退場(留一處消費端 = 加乘沒真的移除)
  t('GRENADE.BUILDING_MUL / grenadeBuildingMul 已無匯出', !('grenadeBuildingMul' in DATA) && !('GRENADE' in DATA));
  for (const [name, s] of [['data.js', dataSrc], ['sim.js', simSrc], ['duel.mjs', duelSrc], ['balance.mjs', balSrc], ['game.js', gameSrc]])
    t(`${name} 執行原文無 grenadeBuildingMul 殘留`, !/grenadeBuildingMul|BUILDING_MUL/.test(s));

  t('_heroDmg 不再有任何情境倍率(只剩 vsMult × buff)',
    /_heroDmg\(h, def, targetKind\) \{\s*return def\.dmg \* vsMult\(def, targetKind\) \* this\._buffMul\(h, 'dmg'\);/.test(simSrc));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅱ 分軌拆分單一縫(shieldSplit;四個消費端 MUST 全部吃這一支)');
// ---------------------------------------------------------------------------
{
  t('shieldSplit 只在 data.js 有一份實作', count(dataSrc, 'export function shieldSplit') === 1);
  // 旋鈕只准在 data.js 內被讀:結算(shieldSplit)、標籤(shieldRoleName)、解析轉呼(heroWeapon/
  // heroAbility)。消費端一旦自己讀 wd.vsSp 去乘,就是第二份拆分邏輯 —— 那正是 HUD 與實際掉血
  // 對不上、bal 說平衡但打起來不是的來源。
  // 「原樣轉交」是允許的(重建 def 時把三欄一起抄過去);**讀進來自己算**才是破縫。
  // 故先剝掉 `vsSp: X.vsSp` 這種轉交,剩下還提到旋鈕就是消費端在自己乘。
  const fwd = /\b(?:vsSp|vsHp|spPierce): [A-Za-z_$][\w$]*\.(?:vsSp|vsHp|spPierce)\b/g;
  const knob = /\bvsSp\b|\bvsHp\b|\bspPierce\b/;
  for (const [name, s] of [['sim.js', simSrc], ['duel.mjs', duelSrc], ['balance.mjs', balSrc], ['game.js', gameSrc]])
    t(`${name} 不自己讀旋鈕運算(一律經 shieldSplit;原樣轉交不算)`, !knob.test(s.replace(fwd, '')));
  // 重建 def 的地方 MUST 把三欄一起抄 —— 漏抄 = 招式版與武器版對同一個護盾軸有兩種行為
  t('sim.js 重建招式 def 時帶齊三個旋鈕',
    /vs: A\.vs, pen: A\.pen,\s*vsSp: A\.vsSp, vsHp: A\.vsHp, spPierce: A\.spPierce/.test(simSrc));
  t('data.js 的結算讀取點只有 shieldSplit 一處',
    count(dataSrc, 'const sMul = wd?.vsSp') === 1);

  // 伺服器:護盾扣減只准出現在 _damage,且經 shieldSplit
  t('sim.js import shieldSplit', /shieldSplit/.test(simSrc.split('\n').slice(0, 40).join('\n')));
  t('sim._damage 英雄分支經 shieldSplit 拆分',
    /const \{ toSp: toShield, toHp \} = shieldSplit\(wd, dmg, t\.sp \|\| 0\);/.test(simSrc));
  t('sim._damage 非英雄分支同樣吃 vsHp(經 shieldSplit(…, 0))',
    /dmg = shieldSplit\(wd, dmg, 0\)\.toHp;/.test(simSrc));
  t('sim.js 全檔沒有第二處手寫護盾拆分(Math.min(t.sp…))',
    !/Math\.min\(t\.sp/.test(simSrc) && count(simSrc, 'shieldSplit(') === 2,
    `shieldSplit 呼叫 ${count(simSrc, 'shieldSplit(')} 次`);

  // _damage 的 wd 參數:凡「有武器 def 在手」的傷害路徑 MUST 傳進去
  const dmgCalls = simSrc.split('\n').filter((l) => /this\._damage\(/.test(l));
  const withDef = dmgCalls.filter((l) => /(wp\.def|, def\)|, wd\))\s*\);?$/.test(l.trim()) || /0, (wp\.def|def|wd)\)/.test(l));
  t(`_damage 的武器路徑都帶 def(${withDef.length}/${dmgCalls.length} 條;其餘為環境/地雷/SAM)`,
    withDef.length >= 7, withDef.length + ' 條');

  // 客戶端估算與兩支離線模型
  t('game.js HUD 估算吃 shieldSplit(兩處回饋:直擊 + 貫穿)', count(gameSrc, 'shieldSplit(def,') === 2,
    `${count(gameSrc, 'shieldSplit(def,')} 處`);
  t('game.js 估算的護盾水位取自快照 ent.sp(MUST NOT 自算)', count(gameSrc, "shieldSplit(def, raw, ent.sp || 0)") === 2);
  t('duel.mjs apply() 經 shieldSplit(對進戰模型與 sim._damage 同一支)',
    /const \{ toSp, toHp \} = shieldSplit\(def, dmg, Math\.max\(0, T\.sh\)\);/.test(duelSrc));
  t('duel.mjs 無手寫護盾拆分殘留', !/Math\.min\(Math\.max\(0, T\.sh\), dmg\)/.test(duelSrc));
  t('balance.mjs 對建築/NPC 的 DPS 吃 vsHp(經 shieldSplit(…, 0))',
    count(balSrc, 'shieldSplit(w, w.dmg, 0).toHp') === 3, `${count(balSrc, 'shieldSplit(w, w.dmg, 0).toHp')} 處`);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅲ shieldSplit 行為(中性還原 / 預算守恆 / 三型 / 退化方向)');
// ---------------------------------------------------------------------------
{
  // 中性 = 逐位元舊制:這一條保證「沒標旗標的 28 名角色」完全不受本次改動影響
  for (const [dmg, sp] of [[100, 250], [100, 100], [100, 40], [100, 0], [0, 100]]) {
    const r = shieldSplit({}, dmg, sp), old = Math.min(sp, dmg);
    t(`中性 dmg${dmg}/盾${sp} 逐位元同舊制`, near(r.toSp, old) && near(r.toHp, dmg - old), `${r.toSp}/${r.toHp}`);
  }
  t('未帶 def(環境傷害)= 中性', near(shieldSplit(null, 100, 40).toSp, 40) && near(shieldSplit(undefined, 100, 40).toHp, 60));

  // 反護盾:護盾多掉、裝甲少掉
  const anti = { vsSp: 2, vsHp: 0.5 };
  t('反護盾滿盾:護盾吃 dmg × vsSp、裝甲 0',
    near(shieldSplit(anti, 100, 1000).toSp, 200) && near(shieldSplit(anti, 100, 1000).toHp, 0));
  // 預算守恆(核心不變量):盾只吃得下 sp/vsSp 的預算,剩下的才進裝甲
  const a2 = shieldSplit(anti, 100, 100);
  t('溢出按預算折回:盾 100 只消耗 50 點預算 ⇒ 裝甲 = 50 × vsHp',
    near(a2.toSp, 100) && near(a2.toHp, 25), `${a2.toSp}/${a2.toHp}`);
  t('MUST NOT 把溢出的護盾傷害直接倒進裝甲(那會是 (200−100)×0.5 = 50)', !near(a2.toHp, 50));

  // 穿盾:滿盾也一定見血,且見血量與護盾水位無關
  const pc = { spPierce: 0.5, vsHp: 0.8 };
  t('穿盾滿盾仍見血 = dmg × spPierce × vsHp', near(shieldSplit(pc, 100, 99999).toHp, 40));
  // 保底不是等額:護盾越薄,溢出的預算也會加進來 ⇒ 見血量只保證有下限、且隨護盾變薄單調不減
  const pcSeq = [99999, 60, 40, 20, 0].map((sp) => shieldSplit(pc, 100, sp).toHp);
  t('穿盾見血量恆 ≥ dmg × spPierce × vsHp(護盾再厚也有保底)', pcSeq.every((v) => v >= 40 - 1e-9), pcSeq.join(','));
  t('護盾越薄見血越多(單調不減)', pcSeq.every((v, i) => i === 0 || v >= pcSeq[i - 1]), pcSeq.join(','));
  t('spPierce=1 = 完全無視護盾(盾一點都不掉)',
    near(shieldSplit({ spPierce: 1 }, 100, 500).toSp, 0) && near(shieldSplit({ spPierce: 1 }, 100, 500).toHp, 100));

  // 反裝甲:鏡像
  const aa = { vsSp: 0.5, vsHp: 1.5 };
  t('反裝甲:同一發在護盾上只刮一半', near(shieldSplit(aa, 100, 500).toSp, 50));
  t('反裝甲:無護盾目標吃滿 vsHp', near(shieldSplit(aa, 100, 0).toHp, 150));

  // 退化方向一律朝「盾有效」(原則 6)
  const bk = shieldSplit({ vsSp: 0 }, 100, 500);
  t('vsSp=0 = 護盾全擋(MUST NOT 退化成無視護盾穿過去)', near(bk.toSp, 0) && near(bk.toHp, 0));

  // 單調性:vsSp 越高護盾掉越多、vsHp 越高裝甲掉越多
  const spSeq = [0.5, 1, 1.5, 2].map((v) => shieldSplit({ vsSp: v }, 100, 500).toSp);
  t('vsSp 單調遞增 → 護盾傷害單調遞增', spSeq.every((v, i) => i === 0 || v > spSeq[i - 1]), spSeq.join(','));
  const hpSeq = [0.5, 1, 1.5, 2].map((v) => shieldSplit({ vsHp: v }, 100, 0).toHp);
  t('vsHp 單調遞增 → 裝甲傷害單調遞增', hpSeq.every((v, i) => i === 0 || v > hpSeq[i - 1]), hpSeq.join(','));

  // 標籤由旋鈕推導
  t('標籤推導:中性無標籤 / 反護盾 / 穿盾 / 反裝甲',
    shieldRoleName({}) === '' && shieldRoleName({ vsSp: 1.7, vsHp: 0.7 }) === '反護盾'
    && shieldRoleName({ spPierce: 0.4 }) === '穿盾' && shieldRoleName({ vsSp: 0.7, vsHp: 1.2 }) === '反裝甲');
  t('死區:微幅偏離不掛標籤(避免圖鑑滿版噪音)', shieldRoleName({ vsSp: 1.02, vsHp: 0.98 }) === '');
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅳ 真 BattleSim 直測(伺服器結算與 shieldSplit 對得上)');
// ---------------------------------------------------------------------------
{
  const sim = new BattleSim(fakeBattleConfig(1));
  const h = sim.addHero('SWARM', 'pa', 't01');
  // 傷害刻意取「中性打不穿護盾」的量(< maxSp):兩發都把盾打光的話,削盾差異會被上限吃掉,
  // 這一段就永遠測不出反護盾生效與否(fixture 的假陰性,不是程式碼對)。
  const DMG = Math.floor(h.maxSp * 0.6);
  const shot = (wd) => {
    h.sp = h.maxSp; h.hp = h.maxHp; h.lastHitAt = -999;
    sim._damage(h, DMG, null, 0, 0, wd);
    return { sp: h.maxSp - h.sp, hp: h.maxHp - h.hp };
  };
  const n = shot(null), a = shot({ vsSp: 1.7, vsHp: 0.7 }), p = shot({ spPierce: 0.5, vsHp: 0.9 });
  t(`反護盾削盾更快(${n.sp.toFixed(0)} → ${a.sp.toFixed(0)};護盾上限 ${h.maxSp})`, a.sp > n.sp);
  t(`中性武器打不穿的盾,穿盾武器仍見血 ${p.hp.toFixed(1)}`, near(n.hp, 0) && p.hp > 0);
  t('護盾層不吃護甲減免(反護盾也一樣)', near(a.sp, Math.min(h.maxSp, DMG * 1.7)));

  // NPC(無護盾層)一樣吃 vsHp —— 「主 HP 傷害弱」只對英雄成立的話,那是隱形的第二套規則
  const npc = () => sim._add({ kind: 'soldier', side: 'STEEL', x: 40, z: 0, hp: UNITS.soldier.hp });
  const n1 = npc(); sim._damage(n1, 100, null, 0, 0, null);
  const n2 = npc(); sim._damage(n2, 100, null, 0, 0, { vsHp: 0.5 });
  t('NPC 也吃 vsHp(弱化 = 中性 × 0.5)',
    near(UNITS.soldier.hp - n2.hp, (UNITS.soldier.hp - n1.hp) * 0.5, 1e-6));
  const n3 = npc(); sim._damage(n3, 100, null, 0, 0, { vsSp: 3, spPierce: 0.9 });
  t('NPC 不受 vsSp/spPierce 影響(沒有護盾層可談)',
    near(UNITS.soldier.hp - n3.hp, UNITS.soldier.hp - n1.hp, 1e-6));
  for (const e of [n1, n2, n3]) sim.ents.delete(e.id);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅴ 配置紀律(2026-08-02 使用者定案的三條;全部是推導,不是「當初調的時候記得」)');
// ---------------------------------------------------------------------------
{
  // 掛了護盾軸旗標的武器名冊(逐一反查三條紀律)
  const flagged = [];
  for (const [id, c] of Object.entries(CHARACTERS))
    for (const s of ['light', 'heavy', 'skill', 'ult']) {
      const w = c[s];
      if (w && ((w.vsSp ?? 1) !== 1 || (w.vsHp ?? 1) !== 1 || (w.spPierce || 0) !== 0)) flagged.push([`${id}.${s}`, w]);
    }
  t(`共 ${flagged.length} 把武器掛了護盾軸(其餘逐位元不受本次改動影響)`, flagged.length > 0,
    flagged.map(([k]) => k).join(' '));

  // ── 紀律①:穿盾 / 反裝甲只准掛在原本吃建築加成的武器上 ──
  const roster = new Set(EX_SIEGE_WEAPONS);
  t('EX_SIEGE_WEAPONS 名冊逐一指得到真的武器', EX_SIEGE_WEAPONS.every((k) => {
    const [id, s] = k.split('.');
    return !!CHARACTERS[id]?.[s];
  }), EX_SIEGE_WEAPONS.filter((k) => { const [id, s] = k.split('.'); return !CHARACTERS[id]?.[s]; }).join(' '));
  const siegeOnly = flagged.filter(([, w]) => (w.spPierce || 0) > 0 || (w.vsHp ?? 1) > 1);
  const offRoster = siegeOnly.filter(([k]) => !roster.has(k));
  t(`穿盾 / 反裝甲(${siegeOnly.length} 把)全在 EX_SIEGE_WEAPONS 名冊內`, offRoster.length === 0,
    offRoster.map(([k]) => k).join(' '));
  // 反護盾走的是另一條路(剝加成 + 壓基礎傷害),刻意**不**受名冊限制 —— 釘住這個豁免,
  // 免得日後有人「順手」把它也塞進名冊,反護盾就再也掛不到非攻城武器上了
  const antiSh = flagged.filter(([, w]) => (w.vsSp ?? 1) > 1);
  t(`反護盾(${antiSh.length} 把)不受名冊限制(走剝加成 + 壓傷害那條路)`,
    antiSh.some(([k]) => !roster.has(k)), antiSh.map(([k]) => k).join(' '));

  // ── 紀律②:反護盾武器不得再有其他單位加成 ──
  const withBonus = antiSh.filter(([, w]) => Object.values(w.vs || {}).some((v) => v > 1));
  t('反護盾武器的 vs 表無任何 > 1 的加成', withBonus.length === 0,
    withBonus.map(([k, w]) => `${k}=${JSON.stringify(w.vs)}`).join(' '));
  t('反護盾武器仍保留 < 1 的懲罰(拿掉的是加成,不是整個剋制關係)',
    antiSh.every(([, w]) => Object.values(w.vs || {}).some((v) => v < 1)));
  // 夾制 MUST 排在 CLASS_SYM 之後 —— 那一段會把 armor/air 欄整組等比放大,排前面等於沒夾
  t('夾制排在 CLASS_SYM 對稱化之後(排前面會被等比放大重新推過 1)',
    dataSrc.indexOf('CLASS_SYM.SWARM_ARMOR_F = ') < dataSrc.indexOf('const VS_DEFS = ['));
  t('兩道夾制共用同一份 VS_DEFS 名冊(建築 + 反護盾各掃一次 = 遲早漏一張表)',
    count(dataSrc, 'const VS_DEFS = [') === 1 && count(dataSrc, 'for (const w of VS_DEFS)') === 1);

  // ── 紀律③:加成越多、越廣泛 ⇒ 基礎傷害越低 ──
  t('廣泛加成的單價高於挑目標的加成(BROAD > NARROW)', COUNTER_BUDGET.BROAD > COUNTER_BUDGET.NARROW,
    `${COUNTER_BUDGET.BROAD} vs ${COUNTER_BUDGET.NARROW}`);
  t('沒掛護盾軸 ⇒ 負載 0、折減 ×1(其餘 28 名角色逐位元不變)', (() => {
    for (const [id, c] of Object.entries(CHARACTERS))
      for (const s of ['light', 'heavy']) {
        const w = c[s];
        if (!w) continue;
        const isFlagged = (w.vsSp ?? 1) !== 1 || (w.vsHp ?? 1) !== 1 || (w.spPierce || 0) !== 0;
        if (!isFlagged && (counterLoad(w) !== 0 || counterDmgF(w) !== 1)) return false;
      }
    return true;
  })());
  t('折減對負載單調遞減且恆 ∈ (0, 1]', (() => {
    const seq = [0, 0.2, 0.5, 1, 2].map((L) => 1 / (1 + COUNTER_BUDGET.K * L));
    return seq[0] === 1 && seq.every((v, i) => v > 0 && v <= 1 && (i === 0 || v < seq[i - 1]));
  })());
  // 同樣的數字,掛在護盾軸比掛在類別剋制貴 —— 這就是「廣泛性加成」的定價
  const broadW = { vsSp: 1.5, vs: {} }, narrowW = { vsSp: 1.0001, vs: { armor: 1.5 } };
  t('同樣 +0.5:掛護盾軸的折減重於掛類別剋制', counterDmgF(broadW) < counterDmgF(narrowW),
    `${counterDmgF(broadW).toFixed(3)} vs ${counterDmgF(narrowW).toFixed(3)}`);
  // 掛旗標的武器實際傷害 MUST 低於未折減值(折減真的接上了 heroWeapon,不是只定義了函式)
  for (const [k, w] of flagged) {
    const [id, s] = k.split('.');
    if (s !== 'light' && s !== 'heavy') continue;
    const solved = heroWeapon(id, s, 1, false), f = counterDmgF(w);
    t(`${k} 基礎傷害吃到折減 ×${f.toFixed(3)}(${(w.dmg?.[0] ?? w.dmg).toFixed?.(0) ?? w.dmg[0]} → ${solved.dmg.toFixed(1)})`,
      f < 1 && near(solved.dmg, (Array.isArray(w.dmg) ? w.dmg[0] : w.dmg) * f, 1e-6));
  }
  // 廣泛型(反護盾/穿盾)MUST 比只掛 vsHp 的反裝甲吃更重的折減 —— 使用者原話的「基礎傷害會偏低」
  const broadF = flagged.filter(([, w]) => (w.vsSp ?? 1) > 1 || (w.spPierce || 0) > 0).map(([, w]) => counterDmgF(w));
  const narrowF = flagged.filter(([, w]) => (w.vsSp ?? 1) <= 1 && !(w.spPierce > 0)).map(([, w]) => counterDmgF(w));
  t('反護盾/穿盾的折減重於反裝甲(廣泛性加成 ⇒ 基礎傷害更低)',
    broadF.length > 0 && narrowF.length > 0 && Math.max(...broadF) < Math.min(...narrowF),
    `廣泛 ${broadF.map((v) => v.toFixed(3)).join(',')} / 反裝甲 ${narrowF.map((v) => v.toFixed(3)).join(',')}`);
}

console.log(`\n${fail ? '❌' : '✅'} 建築加乘移除 / 護盾分軌剋制稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
