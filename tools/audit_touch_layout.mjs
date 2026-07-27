// ============ 觸控版型幾何稽核(四分區 A / M / L / R)============
// 用途:改 `mobile.js` 版型、`style.css` 觸控段或 `index.html` 的 #touchLayer 骨架後,
// 驗證每一種持握 × 機種 × 左右手下,控件都「不出界 / 不互相重疊 / 觸控目標夠大」。
//
// 為什麼要有這支:手機版的缺陷幾乎全是**幾何**問題(肩鍵壓到機體資訊、系統鍵壓到肩鍵、
// 提示折行後蓋住操控帶),肉眼在桌機瀏覽器上看不出來,而真機又不可能每次都拿在手上量。
//
// 不需要 three.js —— 只載 DOM/CSS(3D 模組在沙箱/CI 常因 CDN 被擋而載不到),
// 再灌入代表性 HUD 內容量框。跑法:`node tools/audit_touch_layout.mjs [-v]`
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const VIEWS = [
  { n: '844x390 橫', w: 844, h: 390 },
  { n: '667x375 橫', w: 667, h: 375 },
  { n: '932x430 橫', w: 932, h: 430 },
  { n: '390x844 直', w: 390, h: 844 },
  { n: '360x640 直', w: 360, h: 640 },
  { n: '768x1024 直', w: 768, h: 1024 },
];
const KINDS = ['drone', 'mech', 'morph', 'spec'];

// 四分區的量測對象:A 機體資訊 / M 小地圖 / L 左手控件(移動搖桿 + 十字鍵 + 直條)/
// R 右手控件(ABXY + 視角搖桿 + 直條)+ 兩個會長大的提示層
const SEL = {
  A: '.hud-self', M: '#minimap',
  stick: '#tlStick', dpad: '#tlDpad', gp: '.tl-gp', rstick: '#tlRStick',
  sysl: '.tl-sys-l', sysr: '.tl-sys-r',
  feed: '#killFeed', civ: '#civPrompt',
};
// 觸控目標下限 44×40(見 /CLAUDE.md 驗證矩陣)
const TAP = ['.tl-sysb', '.tl-gp .tl-gb', '.tl-dp-b'];

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('觸控版型稽核');

const verbose = process.argv.includes('-v');
const srv = await serve();
const browser = await chromium.launch({ executablePath: chromePath() });
let bad = 0, cases = 0;

for (const v of VIEWS) {
  const page = await browser.newPage({
    viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    // main.js 沒跑(three 可能載不到)⇒ 手動掛版型 class 並灌入代表性內容
    document.body.classList.add('touch-ui');
    const p = window.innerHeight >= window.innerWidth;
    document.body.classList.toggle('ori-portrait', p);
    document.body.classList.toggle('ori-landscape', !p);
    document.getElementById('touchLayer').hidden = false;
    document.getElementById('game').style.display = '';
    document.getElementById('connect').style.display = 'none';
    const set = (id, t) => { const n = document.getElementById(id); if (n) n.textContent = t; };
    set('hudSideName', 'SWARM ・ 蜂群斥候');
    set('spText', '護盾 180/180'); set('hpText', '結構 640/640'); set('mpText', '電力 100/100');
    set('wpnName', '脈衝步槍'); set('wpnAmmo', '24/24');
    set('burstName', '重武器 · 榴彈'); set('burstCd', '就緒');
    set('abSkillName', '偵察脈衝'); set('abUltName', '蜂群突襲'); set('abMobilName', '完美迴避');
    set('moneyText', '1250'); set('knText', '7');
    const sq = document.getElementById('squadRow');
    if (sq) sq.innerHTML = '<span class="sq-cell">1</span><span class="sq-cell">2</span><span class="sq-cell">3</span>';
    const kf = document.getElementById('killFeed');
    if (kf) kf.innerHTML = '<div>蜂群斥候 擊墜 鋼鐵重裝</div><div>鋼鐵狙擊 擊墜 蜂群工兵</div>';
    const cp = document.getElementById('civPrompt');
    if (cp) {
      cp.innerHTML = '平民(中立)<button class="civ-btn" data-act="civFollow">跟隨</button>'
        + '<button class="civ-btn" data-act="civAway">驅趕</button>';
      cp.classList.add('on');
    }
  });

  for (const kind of KINDS) for (const lefty of [false, true]) {
    // 等同 TouchControls.setKind() + applyLefty()
    await page.evaluate(({ kind, lefty }) => {
      document.body.classList.toggle('touch-lefty', lefty);
      const fly = kind === 'drone' || kind === 'morph' || kind === 'spec';
      document.querySelectorAll('[data-act="dive"]').forEach((n) => { n.hidden = !fly; });
      document.querySelectorAll('[data-act="swap"]').forEach((n) => { n.hidden = kind !== 'drone'; });
      const spec = kind === 'spec';
      document.querySelectorAll('.gb-a, .gb-aim, [data-act="shop"], [data-act="menu"]')
        .forEach((n) => { n.hidden = spec; });
      document.body.classList.toggle('tl-spec', spec);
    }, { kind, lefty });

    const out = await page.evaluate(({ SEL, TAP }) => {
      const r = {}, small = [];
      for (const [k, s] of Object.entries(SEL)) {
        const el = document.querySelector(s);
        if (!el || el.hidden) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        r[k] = [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)];
      }
      for (const s of TAP) {
        for (const el of document.querySelectorAll(s)) {
          if (el.hidden || el.offsetParent === null) continue;
          const b = el.getBoundingClientRect();
          if (b.width < 44 || b.height < 40) {
            small.push(`${s}[${el.textContent.trim().slice(0, 4)}] ${Math.round(b.width)}x${Math.round(b.height)}`);
          }
        }
      }
      // ABXY 圓形判定區:相鄰兩鈕圓心距 MUST ≥ 兩半徑和(否則按 X 打到 A)
      const gb = [...document.querySelectorAll('.tl-gp .tl-gb')].filter((n) => !n.hidden)
        .map((n) => n.getBoundingClientRect());
      let abxy = true;
      for (let i = 0; i < gb.length; i++) for (let j = i + 1; j < gb.length; j++) {
        const d = Math.hypot((gb[i].left + gb[i].right) / 2 - (gb[j].left + gb[j].right) / 2,
                             (gb[i].top + gb[i].bottom) / 2 - (gb[j].top + gb[j].bottom) / 2);
        if (d + 0.5 < (gb[i].width + gb[j].width) / 2) abxy = false;
      }
      // 肩鍵/扳機逐列左右對應:L ⇄ R 同一列、ZL ⇄ ZR 同一列,且 ZL/ZR 在 L/R **下方**。
      // ZL(僅飛行機種)與 ⇄換機(僅無人機)會 hidden ⇒ 用 grid-row 固定列,這裡驗它真的沒塌陷。
      const rowOf = (sel) => {
        const el = document.querySelector(sel);
        if (!el || el.hidden || el.offsetParent === null) return null;
        const b = el.getBoundingClientRect();
        return { t: b.top, b: b.bottom };
      };
      const pad = {
        L: rowOf('.tl-sys-l [data-act="reload"]'), ZL: rowOf('.tl-sys-l [data-act="dive"]'),
        R: rowOf('.tl-sys-r [data-act="aim"]'), ZR: rowOf('.tl-sys-r [data-act="gyro"]'),
      };
      return { r, small, abxy, pad };
    }, { SEL, TAP });

    cases++;
    const tag = `${v.n} ${kind}${lefty ? ' 左手' : ''}`;
    const msgs = [];
    const keys = Object.keys(out.r);
    const ov = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      if (ov(out.r[keys[i]], out.r[keys[j]])) msgs.push(`重疊 ${keys[i]}×${keys[j]}`);
    }
    for (const [k, b] of Object.entries(out.r)) {
      if (b[0] < -1 || b[1] < -1 || b[2] > v.w + 1 || b[3] > v.h + 1) msgs.push(`出界 ${k} ${b}`);
    }
    for (const s of out.small) msgs.push(`觸控目標過小 ${s}`);
    if (!out.abxy) msgs.push('ABXY 圓心距不足');
    // 肩鍵/扳機逐列對應(見 index.html #touchLayer 的 .tl-sys 註解)
    const P = out.pad;
    const align = (a, b) => a && b && Math.abs(a.t - b.t) <= 1.5;
    if (P.L && P.R && !align(P.L, P.R)) msgs.push(`L / R 不同列(top ${Math.round(P.L.t)} vs ${Math.round(P.R.t)})`);
    if (P.ZL && P.ZR && !align(P.ZL, P.ZR)) msgs.push(`ZL / ZR 不同列(top ${Math.round(P.ZL.t)} vs ${Math.round(P.ZR.t)})`);
    if (P.ZR && P.R && P.ZR.t < P.R.b - 1) msgs.push('ZR MUST 排在 R 下方');
    if (P.ZL && P.L && P.ZL.t < P.L.b - 1) msgs.push('ZL MUST 排在 L 下方');
    // ZL 隱藏(地面機甲)時 ZR 的列位 MUST 不變 —— 驗 grid 列沒有塌陷
    if (!P.ZL && P.ZR && P.R && Math.abs(P.ZR.t - P.R.b) > 8) msgs.push('ZL 隱藏後 ZR 的列位跑掉(grid 列塌陷?)');

    if (msgs.length) { bad++; console.log(`✗ ${tag}\n    ${msgs.join('\n    ')}`); }
    else if (verbose) console.log(`✓ ${tag}`);
    if (verbose) {
      for (const [k, b] of Object.entries(out.r)) {
        console.log(`    ${k.padEnd(5)} l${String(b[0]).padStart(4)} t${String(b[1]).padStart(4)}`
          + ` r${String(b[2]).padStart(4)} b${String(b[3]).padStart(4)}  ${b[2] - b[0]}×${b[3] - b[1]}`);
      }
    }
  }
  // ── 疊層可點性回歸 ──────────────────────────────────────────────
  // `#game` 是 position:fixed ⇒ 本身就是堆疊脈絡,疊層的 z 20 只在它內部有效;
  // 住在 body 的 #touchLayer(z 9)實際上壓在整個 #game 之上,滿版的 #tlLook 會吃掉
  // 疊層的每一次點擊(症狀:選單/商店開了以後任何按鍵都沒反應、也關不掉)。
  // 故 mobile.js syncBlocked() 會在疊層開著時整層收起 —— 這裡驗「收起後點得到、沒收起就點不到」。
  const ov = await page.evaluate(() => {
    document.body.classList.remove('touch-lefty');
    document.getElementById('pauseOverlay').style.display = '';
    const hit = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'missing';
      const b = el.getBoundingClientRect();
      if (!b.width) return 'zero';
      const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return el.contains(h) || h === el ? 'ok' : `<${h?.tagName.toLowerCase()} id=${h?.id}>`;
    };
    const before = ['#resumeBtn', '#pauseLeaveBtn', '.pause-tab'].map(hit);
    document.body.classList.add('tl-off');          // = syncBlocked() 收起搖桿
    const after = ['#resumeBtn', '#pauseLeaveBtn', '.pause-tab'].map(hit);
    document.body.classList.remove('tl-off');
    document.getElementById('pauseOverlay').style.display = 'none';
    return { before, after };
  });
  cases++;
  const stuck = ov.before.filter((r) => r !== 'ok').length;
  const free = ov.after.every((r) => r === 'ok');
  if (!free) { bad++; console.log(`✗ ${v.n} 疊層按鈕收起搖桿後仍點不到:${JSON.stringify(ov.after)}`); }
  else if (!stuck) { bad++; console.log(`✗ ${v.n} 疊層在**未**收起搖桿時就點得到 —— 斷言失去意義,請確認 #touchLayer 的堆疊關係是否已改變`); }
  else if (verbose) console.log(`✓ ${v.n} 疊層:未收起被 ${ov.before[0]} 擋住、收起後三顆鈕都點得到`);

  await page.close();
}
await browser.close();
srv.close();
console.log(bad ? `\n✗ ${bad}/${cases} 組版型有問題` : `\n✓ ${cases} 組版型全部通過(不出界 / 不重疊 / 觸控目標 ≥ 44×40)`);
process.exit(bad ? 1 : 0);
