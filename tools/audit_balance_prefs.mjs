// ============ 平衡性設定旋鈕與升級曲線稽核(離線)============
// 用途:驗證 `public/js/balancePrefs.js` 的八項升級曲線起終點與基礎數值倍率拉桿、
// 預設值(1.0x)、夾制範圍(0.1~10x)、曲線內插計算、`index.html` 雙掛載點與 `help.js` 說明條目。
//
// 跑法:node tools/audit_balance_prefs.mjs
import { readSrc } from './audit_src.mjs';
import {
  BALANCE_KNOBS, balancePref, balanceMul, setBalancePref,
  resetBalancePrefs, balancePrefsDefault, upgradeCurveMul, onBalanceChange,
} from '../public/js/balancePrefs.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('\nⅠ 旋鈕表定義 (BALANCE_KNOBS)');
{
  const total = Object.keys(BALANCE_KNOBS).length;
  ok(total >= 25, `旋鈕總數 ${total} 項 (≥25)`);

  const UPGRADES = ['lw', 'hw', 'sk', 'ult', 'hp', 'ar', 'sp', 'ch'];
  for (const u of UPGRADES) {
    const s = `upg_${u}_start`, e = `upg_${u}_end`;
    ok(s in BALANCE_KNOBS, `八項升級包含起點: ${s}`);
    ok(e in BALANCE_KNOBS, `八項升級包含終點: ${e}`);
    ok(BALANCE_KNOBS[s].group === 'upgrade', `${s} 分組為 upgrade`);
    ok(BALANCE_KNOBS[e].group === 'upgrade', `${e} 分組為 upgrade`);
  }

  const STATS = ['speed', 'rate', 'dmg', 'cd', 'range', 'sight', 'bounty', 'mpCost', 'respawn'];
  for (const st of STATS) {
    const k = `stat_${st}`;
    ok(k in BALANCE_KNOBS, `基礎數值包含: ${k}`);
    ok(BALANCE_KNOBS[k].group === 'stat', `${k} 分組為 stat`);
  }

  for (const [k, d] of Object.entries(BALANCE_KNOBS)) {
    const valid = Number.isFinite(d.def) && d.def === 1.0
      && d.min === 0.1 && d.max === 10 && d.step === 0.1
      && typeof d.label === 'string' && d.label.length > 0
      && typeof d.hint === 'string' && d.hint.length > 0;
    ok(valid, `${k}: 預設值 1.0, 範圍 [0.1, 10], 步長 0.1, 具繁體中文標籤與說明`);
  }
}

console.log('\nⅡ 數值存取、夾制與還原預設');
{
  resetBalancePrefs();
  ok(balancePrefsDefault(), 'reset 後全部回到預設 (balancePrefsDefault === true)');
  ok(balancePref('stat_speed') === 1.0, '預設移速倍率為 1.0');
  ok(balanceMul('speed') === 1.0, 'balanceMul(speed) 預設為 1.0');

  // 設定合法值
  const v1 = setBalancePref('stat_speed', 2.5);
  ok(v1 === 2.5 && balancePref('stat_speed') === 2.5, '寫入合法值 2.5 成功');
  ok(balanceMul('speed') === 2.5, 'balanceMul 讀取到最新值 2.5');
  ok(!balancePrefsDefault(), '修改後 balancePrefsDefault === false');

  // 超界夾制
  const vOver = setBalancePref('stat_speed', 15.0);
  ok(vOver === 10.0 && balancePref('stat_speed') === 10.0, '超界值 15.0 夾制為 10.0');

  const vUnder = setBalancePref('stat_speed', 0.01);
  ok(vUnder === 0.1 && balancePref('stat_speed') === 0.1, '低界值 0.01 夾制為 0.1');

  // 非法鍵名安全處理
  ok(setBalancePref('invalid_key_xyz', 5.0) === 1.0, '非法鍵名寫入安全忽略');
  ok(balancePref('invalid_key_xyz') === 1.0, '非法鍵名讀取回傳 1.0');

  // 還原預設
  resetBalancePrefs();
  ok(balancePrefsDefault(), '再次 reset 後回到全預設');
  ok(balancePref('stat_speed') === 1.0, '移速倍率還原為 1.0');
}

console.log('\nⅢ 升級曲線內插計算 (upgradeCurveMul)');
{
  resetBalancePrefs();
  ok(upgradeCurveMul('lw', 1) === 1.0, '預設狀態 Lv1 輕武器曲線倍率為 1.0');
  ok(upgradeCurveMul('lw', 4) === 1.0, '預設狀態 Lv4 輕武器曲線倍率為 1.0');
  ok(upgradeCurveMul('hp', 0) === 1.0, '預設狀態 Lv0 裝甲上限曲線倍率為 1.0');
  ok(upgradeCurveMul('hp', 3) === 1.0, '預設狀態 Lv3 裝甲上限曲線倍率為 1.0');

  // 戰鬥面向 (Lv1..4)
  setBalancePref('upg_lw_start', 2.0);
  setBalancePref('upg_lw_end', 5.0);
  ok(near(upgradeCurveMul('lw', 1), 2.0), 'lw Lv1 命中起點 2.0');
  ok(near(upgradeCurveMul('lw', 4), 5.0), 'lw Lv4 命中終點 5.0');
  ok(near(upgradeCurveMul('lw', 2), 3.0), 'lw Lv2 線性內插為 3.0 (2 + 3 * 1/3)');
  ok(near(upgradeCurveMul('lw', 3), 4.0), 'lw Lv3 線性內插為 4.0 (2 + 3 * 2/3)');

  // 防禦面向 (Lv0..3)
  setBalancePref('upg_hp_start', 1.5);
  setBalancePref('upg_hp_end', 3.0);
  ok(near(upgradeCurveMul('hp', 0), 1.5), 'hp Lv0 命中起點 1.5');
  ok(near(upgradeCurveMul('hp', 3), 3.0), 'hp Lv3 命中終點 3.0');
  ok(near(upgradeCurveMul('hp', 1), 2.0), 'hp Lv1 線性內插為 2.0 (1.5 + 1.5 * 1/3)');
  ok(near(upgradeCurveMul('hp', 2), 2.5), 'hp Lv2 線性內插為 2.5 (1.5 + 1.5 * 2/3)');

  resetBalancePrefs();
}

console.log('\nⅣ UI 與 DOM 結構檢查');
{
  const html = readSrc('public', 'index.html');
  ok(html.includes('data-setpage="balance"'), 'index.html 包含 data-setpage="balance" 分頁按鈕');
  ok(html.includes('id="pauseBalanceMount"'), 'index.html 包含 pauseBalanceMount 掛載容器');
  ok(html.includes('id="lobbyBalanceMount"'), 'index.html 包含 lobbyBalanceMount 掛載容器');
  ok(html.includes('data-tipkey="balance"'), 'index.html 包含 data-tipkey="balance" 懸浮提示錨點');

  const helpSrc = readSrc('public', 'js', 'help.js');
  ok(helpSrc.includes('balance: {') && helpSrc.includes('平衡性調整'), 'help.js UI_TIPS 包含 balance 條目');

  const mainSrc = readSrc('public', 'js', 'main.js');
  ok(mainSrc.includes('renderBalanceSettings'), 'main.js 包含 renderBalanceSettings');
}

console.log(`\n========================================`);
console.log(`結果: ${pass} 通過, ${fail} 失敗`);
if (fail > 0) process.exit(1);
