// ============ 小地圖顯示範圍稽核(周遭 / 全部)============
// 用途:改 `game.js` 的 `mmMode` / `_mmWindow` / `_world2mm` / `_world2mmFull` / `MM_NEAR` 後,
// 驗證兩件最容易壞、又最難用肉眼看出來的事:
//   ① **full 模式 MUST 與舊行為完全一致** —— `_world2mm` 等於 `_world2mmFull`,底圖裁切等於整張。
//      這條顧的是「加了新模式,結果沒切模式的人也受影響」。
//   ② **`_world2mmFull` MUST NOT 隨模式改變**(見 /CLAUDE.md A24)—— 「已探索」累積罩 `_mmSeen`
//      是整場累積的持久資料,座標框跟著顯示窗跑的話,每切一次模式先前探索過的區域就整片錯位。
// 另驗周遭模式的半徑公式、自機置中、貼邊夾制、地圖小於顯示窗時退回全圖、觀戰無座機。
//
// 為什麼用「抽方法原文」而不是 import:`game.js` 的 three 走 CDN importmap,Node 端解析不了;
// 但這三支方法只吃 `this.terrain` / `this.pos` / `this.mmMode` / `this.heroKind`,
// 抽出來評估驗的仍是**真正的程式碼文字**(不是另抄一份公式,抄一份就永遠會通過)。
// 跑法:`node tools/audit_minimap_view.mjs`
// 讀原文與抽方法走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabMethod } from './audit_src.mjs';

const src = readSrc('public', 'js', 'game.js');
const grab = (name) => grabMethod(src, name);

const MM_NEAR = JSON.parse(
  '{' + /const MM_NEAR = \{([\s\S]*?)\n\};/.exec(src)[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean).join(' ')
    .replace(/(\w+):/g, '"$1":').replace(/,\s*$/, '') + '}',
);
// 替身值:本稽核驗的是**顯示窗幾何**,不是平衡數值(那條在 npm run bal)。
// 取代表性的視野半徑即可,MUST NOT 為了對數字而 import data.js —— 平衡一調這支就會無故變紅。
const GAME = { AIM_SIGHT_MULT: 1.6 };
const UNITS = { mech: { sight: 200 }, drone: { sight: 240 } };

const body = `({ ${grab('_mmWindow')}, ${grab('_world2mm')}, ${grab('_world2mmFull')} })`;
const proto = new Function('MM_NEAR', 'GAME', 'UNITS', `return ${body};`)(MM_NEAR, GAME, UNITS);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const terrain = { minX: -1000, maxX: 1000, minZ: -600, maxZ: 600 };
const mk = (mode, x, z, kind = 'mech') => Object.assign(Object.create(null), proto, {
  terrain, mmMode: mode, heroKind: kind, pos: { x, z }, _mmWin: null,
});

console.log('■ full 模式 = 舊行為(全圖框)');
{
  const c = mk('full', 300, 100);
  const v = c._mmWindow(); c._mmWin = v;
  t('顯示窗 = 地形 bbox', v.x0 === -1000 && v.x1 === 1000 && v.z0 === -600 && v.z1 === 600, JSON.stringify(v));
  const a = c._world2mm(300, 100, 220, 220), b = c._world2mmFull(300, 100, 220, 220);
  t('_world2mm 與 _world2mmFull 完全一致', near(a[0], b[0]) && near(a[1], b[1]), `${a} vs ${b}`);
  t('舊公式對得上(x=300 → 143)', near(a[0], (300 + 1000) / 2000 * 220), String(a[0]));
  const c0 = c._world2mm(-1000, -600, 220, 220), c1 = c._world2mm(1000, 600, 220, 220);
  t('底圖裁切參數 = 整張(0,0,220,220)', near(c0[0], 0) && near(c0[1], 0) && near(c1[0], 220) && near(c1[1], 220));
}

console.log('■ near 模式:以自機為中心、涵蓋視野');
{
  const c = mk('near', 0, 0);
  const v = c._mmWindow(); c._mmWin = v;
  const r = Math.max(MM_NEAR.MIN_R, 200 * 1.6 * MM_NEAR.PAD);
  t('半徑 = max(MIN_R, sight × 瞄準加成 × PAD)', near(v.x1 - v.x0, 2 * r), `寬 ${v.x1 - v.x0} 期望 ${2 * r}`);
  t('自機置中', near((v.x0 + v.x1) / 2, 0) && near((v.z0 + v.z1) / 2, 0), JSON.stringify(v));
  const self = c._world2mm(0, 0, 220, 220);
  t('自機畫在正中央', near(self[0], 110) && near(self[1], 110), String(self));
  const edge = c._world2mm(r, 0, 220, 220);
  t('窗緣落在畫布邊', near(edge[0], 220), String(edge));
  t('比 full 模式放大', (v.x1 - v.x0) < 2000);
}

console.log('■ near 模式:貼邊夾制與小地圖退化');
{
  const c = mk('near', 980, 590);
  const v = c._mmWindow();
  t('顯示窗不超出地圖右緣', v.x1 <= terrain.maxX + 1e-9, JSON.stringify(v));
  t('顯示窗不超出地圖下緣', v.z1 <= terrain.maxZ + 1e-9, JSON.stringify(v));
  t('貼邊後窗寬不變(只平移不縮)', near(v.x1 - v.x0, 2 * Math.max(MM_NEAR.MIN_R, 200 * 1.6 * MM_NEAR.PAD)));

  const tiny = { minX: -100, maxX: 100, minZ: -80, maxZ: 80 };
  const c2 = Object.assign(Object.create(null), proto, { terrain: tiny, mmMode: 'near', heroKind: 'mech', pos: { x: 0, z: 0 } });
  const v2 = c2._mmWindow();
  t('地圖比顯示窗小 → 該軸退回全圖', v2.x0 === -100 && v2.x1 === 100 && v2.z0 === -80 && v2.z1 === 80, JSON.stringify(v2));
}

console.log('■ 觀戰(無座機)');
{
  const c = mk('near', 0, 0, null);
  const v = c._mmWindow();
  t('無 heroKind → 用 SPEC_R', near(v.x1 - v.x0, 2 * Math.max(MM_NEAR.MIN_R, MM_NEAR.SPEC_R * 1.6 * MM_NEAR.PAD)), JSON.stringify(v));
}

console.log('■ 已探索罩恆為全圖框(切模式不錯位)');
{
  const full = mk('full', 300, 100), nr = mk('near', 300, 100);
  nr._mmWin = nr._mmWindow();
  const a = full._world2mmFull(500, 200, 220, 220), b = nr._world2mmFull(500, 200, 220, 220);
  t('_world2mmFull 不隨模式改變', near(a[0], b[0]) && near(a[1], b[1]), `${a} vs ${b}`);
  const c = nr._world2mm(500, 200, 220, 220);
  t('_world2mm 在 near 模式與 full 框不同(才有放大效果)', !near(c[0], b[0]));
}

console.log(fail ? `\n✗ ${pass} 通過 / ${fail} 失敗` : `\n✓ 小地圖顯示範圍 ${pass} 項全通過`);
process.exit(fail ? 1 : 0);
