// ============ 選單版型稽核(大廳 / 房間 / 選角 / 疊層,直式手機)============
// 用途:改 `index.html` 的選單骨架、`style.css` 的 `body.touch-ui.ori-portrait` 段,
// 或 `main.js` 的按鈕字串後,驗證「桌機左右並排的區塊/按鍵,手機直式也左右並排」這條原則,
// 以及選角詳細說明不再被頭像/展示台蓋住。
//
// 為什麼要有這支:手機版的選單缺陷同樣是**幾何**問題 ——
//   ① 三顆入口鈕改直排 ⇒ 第三顆「劇情戰役」被推到摺線以下,玩家回報「沒看到劇情模式的按鍵」;
//   ② `.cd-art` 的 sticky 在單欄版型下會把不透明的頭像黏在容器頂端、蓋掉詳細說明。
// 兩者在桌機瀏覽器上都看不出來,肉眼也量不準,故一律用量框斷言。
//
// 不需要 three.js —— 只載 DOM/CSS(3D 模組在沙箱/CI 常因 CDN 被擋而載不到),
// 選角面板改以代表性骨架灌進去量。跑法:`node tools/audit_ui_layout.mjs [-v]`
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';
import { readSrc } from './audit_src.mjs';

// 直式是本次改版的主場;橫式一併量,確保「並排」原則沒把橫式撐爆(667×375 是最窄的一組)
const VIEWS = [
  { n: '360x640 直', w: 360, h: 640 },
  { n: '390x844 直', w: 390, h: 844 },
  { n: '412x915 直', w: 412, h: 915 },
  { n: '768x1024 直', w: 768, h: 1024 },
  { n: '667x375 橫', w: 667, h: 375 },
  { n: '844x390 橫', w: 844, h: 390 },
];

const verbose = process.argv.includes('-v');
let bad = 0, cases = 0;
const ok = (cond, msg) => {
  cases++;
  if (!cond) { bad++; console.log(`  ✗ ${msg}`); } else if (verbose) console.log(`  ✓ ${msg}`);
};

// ---------------------------------------------------------------------------
// 0)按鈕文字精簡:鈕面 MUST NOT 出現括號補述(玩家指定「括號連同內部文字都移除」)
//    來源兩處 —— index.html 的靜態鈕、main.js 動態指派 textContent 的鈕。
// ---------------------------------------------------------------------------
{
  console.log('▍按鈕文字(去括號補述)');
  const html = readSrc('public', 'index.html');
  for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
    const txt = m[1].replace(/<[^>]*>/g, '').trim();
    ok(!/[（(]/.test(txt), `index.html 鈕面「${txt}」MUST NOT 含括號補述`);
  }
  const js = readSrc('public', 'js', 'main.js');
  // ① `xxxBtn.textContent = '…'` / `btn.textContent = a ? '…' : '…'`(含樣板字串)
  for (const m of js.matchAll(/\b(?:\w*[Bb]tn|add|back)\.textContent\s*=\s*([^;]+);/g)) {
    for (const s of m[1].matchAll(/['`]([^'`]*)['`]/g)) {
      ok(!/[（(]/.test(s[1]), `main.js 鈕面「${s[1]}」MUST NOT 含括號補述`);
    }
  }
  // ② innerHTML 樣板裡直接寫死的 <button>(展示台的變形/放大鈕就住在這裡,只掃 textContent 會漏)
  for (const m of js.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)) {
    const txt = m[1].replace(/\$\{[^}]*\}/g, '').trim();
    if (txt) ok(!/[（(]/.test(txt), `main.js 內嵌鈕面「${txt}」MUST NOT 含括號補述`);
  }
}

// ---------------------------------------------------------------------------
// 0.5)GUI 說明一律懸浮提示 + 按鍵風格統一 + NPC 圖示(2026-07-31 使用者定案)
//     這一段**不需要瀏覽器**,故排在 playwright 閘門之前 —— 沙箱/CI 沒有 chromium 時
//     至少這些單一縫斷言仍然跑得到。
// ---------------------------------------------------------------------------
{
  console.log('\n▍GUI 懸浮提示 / 按鍵風格 / NPC 圖示');
  const html = readSrc('public', 'index.html');
  const css = readSrc('public', 'css', 'style.css');
  const mainJs = readSrc('public', 'js', 'main.js');
  const help = await import(new URL('../public/js/help.js', import.meta.url));
  const icons = await import(new URL('../public/js/npcicon.js', import.meta.url));
  const data = await import(new URL('../public/js/data.js', import.meta.url));

  // (1) 常駐說明 MUST 已下架(留一份在畫面上 = 兩份會漂的說明)
  for (const cls of ['room-note', 'shop-note', 'dead-hint', 'pause-note', 'load-tip', 'link-hint']) {
    ok(!html.includes(`"${cls}"`), `index.html MUST NOT 再有常駐說明 .${cls}`);
    ok(!new RegExp(`\\.${cls}\\s*[,{]`).test(css), `style.css MUST NOT 再留 .${cls} 的死規則`);
  }
  ok(!html.includes('id="linkHint"') && !mainJs.includes('linkHint'),
    '連線機制的說明 MUST 改掛各鈕自己的懸浮提示(`attachTip`),常駐列已移除');

  // (2) 靜態標記只准寫 key,文字一律從 UI_TIPS 取(唯一縫)
  const keys = [...html.matchAll(/data-tipkey="([^"]+)"/g)].map((m) => m[1]);
  ok(keys.length > 0, `index.html 有 ⓘ 提示標記(${keys.length} 顆)`);
  for (const k of new Set(keys)) ok(!!help.UI_TIPS[k], `data-tipkey="${k}" 在 help.js UI_TIPS 有對應條目`);
  ok(!/data-tip="[^"]{12,}"/.test(html),
    'index.html MUST NOT 直接寫提示文字(只准寫 data-tipkey;寫死 = 說明分頁與 ⓘ 兩份會漂)');
  ok(/function syncTips\(/.test(mainJs) && /installTips\(\);/.test(mainJs),
    'main.js MUST 有 `syncTips()` 灌文字 + `installTips()` 安裝委派');
  ok(/syncTips\(\);\s*\/\/ 提示文字/.test(mainJs),
    '切換鍵鼠 ⇄ 搖桿 MUST 重跑 syncTips(UI_TIPS 有 pTouch 兩版)');

  // (3) 說明分頁的「介面」類 MUST 由 UI_TIPS 推導,不得手抄第二份
  const uiCat = help.HELP.find((c) => c.id === 'ui');
  ok(!!uiCat, '說明分頁有「介面」類別');
  ok(uiCat && uiCat.items.length === Object.keys(help.UI_TIPS).length
    && uiCat.items.every((it, i) => it === Object.values(help.UI_TIPS)[i]),
    '「介面」類的條目 MUST 就是 UI_TIPS 本身(同一個物件參考 = 推導而非抄寫)');

  // (4) 按鍵風格統一:分段按鈕只有一套
  ok(/^\.segb \{/m.test(css) && /^\.seg \{/m.test(css), 'style.css 有 `.seg`/`.segb` 分段按鈕單一縫');
  ok(!/\.tset-segb?\b/.test(css), '舊的 `.tset-seg`/`.tset-segb` MUST 已改名(留著 = 兩套樣式並存)');
  for (const dead of ['.pause-tab {', '.help-cat {', '.unit-side-btn {', '.diff-select']) {
    ok(!css.includes(dead), `\`${dead.replace(' {', '')}\` MUST NOT 自己寫一份鈕面樣式`);
  }
  ok(!/diff-select/.test(mainJs),
    '電腦難度 MUST NOT 退回 <select>(手機會叫出系統選單、風格與旁邊那列不一)');

  // (5) NPC 圖示覆蓋現役名冊(缺鍵會回退問號圖,但那是保底不是及格)
  const roster = new Set([
    'soldier', 'rocketeer', 'howitzer', 'tank', 'heli', 'tower', 'base', 'bunker', 'civilian',
    ...Object.values(data.THIRD.COMP).flat(),
  ]);
  for (const k of roster) ok(!!icons.NPC_ICONS[k], `npcicon.js 有 ${k} 的圖示`);
  ok(!!icons.NPC_ICONS._, 'npcicon.js 有未列名兵種的保底圖示');
  ok(icons.npcIconHTML('soldier').includes('currentColor'),
    '圖示 MUST 吃 currentColor(選取態/陣營色才跟得動)');
  ok(/npcIconHTML\(kind\)/.test(mainJs), '單位牆 MUST 走 npcicon.js 單一縫產生圖示');

  // (6) 機種圖示標在頭像旁邊(2026-08-02 使用者定案)
  //     名冊 = 現役三機種(`HERO_SIZE` 是每個機種都得有體型區間的那一份)⇒ 新增機種漏畫會直接紅字。
  for (const k of Object.keys(data.HERO_SIZE)) {
    ok(!!icons.KIND_ICONS[k], `npcicon.js 有 ${k} 機種的圖示`);
  }
  ok(Object.keys(icons.KIND_ICONS).length === Object.keys(data.HERO_SIZE).length,
    '機種圖示不多不少,與現役機種一一對應(多畫一個 = 名冊已經漂了)');
  ok(icons.kindIconHTML('drone').includes('currentColor'),
    '機種圖示 MUST 吃 currentColor(選取態 .char-btn.on 才翻得動色)');
  ok(icons.kindIconHTML('不存在的機種').includes(icons.NPC_ICONS._),
    '未知機種回退問號圖(與 NPC 圖示同一條保底規則,漏畫看得出來而不是破圖)');
  // 2026-08-11:頭像/小卡/劇情版面的標記唯一縫自 main.js 搬到 `storyui.js`(遊戲本體與
  // 本地故事書 tools/story_book 共用同一份)。**規則沒有變**,只是縫換了家。
  const storyUi = readSrc('public', 'js', 'storyui.js');
  ok((storyUi.match(/function charAvatarHTML/g) || []).length === 1
    && !/function charAvatarHTML/.test(mainJs),
    '頭像 + 機種角標只有一份標記產生器(storyui.js `charAvatarHTML`,main.js 不得留第二份)');
  ok(![mainJs, storyUi].some((s) => /<img class="char-av"/.test(s) || /<img src="\$\{avatarURL/.test(s)),
    '所有頭像 MUST 走 `charAvatarHTML`,MUST NOT 自己拼 <img>(漏一處 = 那面牆沒有角標)');
  ok(/charKind\(id\)/.test(storyUi.slice(storyUi.indexOf('function charAvatarHTML'),
    storyUi.indexOf('function charAvatarHTML') + 500)),
    '機種取自 `charKind()`(2026-08-02 混編後陣營 ≠ 機種,MUST NOT 由 side 推)');
  ok(!/three/.test(storyUi.split('\n').filter((l) => l.startsWith('import ')).join('\n')),
    'storyui.js MUST 維持零 three(離線稽核與故事書都要載得起來,見該檔檔頭邊界 ①)');
  ok(/\.av-kind \{/.test(css) && /\.kind-ico \{/.test(css), 'style.css 有角標版位規則');

  // (7) 商店掃貨 / 預約(2026-08-02 使用者定案):鈕在 HTML、判定在 game.js,兩邊各一份
  ok(html.includes('id="shopSweepBtn"'), 'index.html 有掃貨鈕');
  ok(html.includes('data-tipkey="shopAuto"') && !!help.UI_TIPS.shopAuto,
    '掃貨/預約有 ⓘ 懸浮提示,且文字住 UI_TIPS(說明分頁自動同步)');
  ok(/st\.sweepable/.test(mainJs)
    && !/_sweepPick/.test(mainJs.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')),
    '掃貨鈕的可用狀態吃 game.js 傳來的 `sweepable`,MUST NOT 在 UI 端自己再算一次買不買得起');
  ok(/st\.toggleReserve\(item\)/.test(mainJs),
    '預約鈕只呼叫 `toggleReserve`(名單與排程都住 game.js)');

  // (8) 設定頁的「開發工具」列(2026-08-04 使用者定案:2D 生圖對照台加進設定 + 後端啟停鈕)
  //     工具本體住 tools/,設定頁只有一列開關與一條連結。**清單/網址/顯不顯示一律問伺服器** ——
  //     那條路由只回應 loopback、雲端不掛、出貨版連 tools/ 都沒有(閘門本身的稽核在 audit_net_modes ⑦)。
  ok((mainJs.match(/function renderDevTools\(/g) || []).length === 1,
    '開發工具列只有一份實作(`renderDevTools`)');
  ok((mainJs.match(/function syncDevTools\(/g) || []).length === 1,
    '狀態同步只有一份實作(`syncDevTools`)');
  // 開設定頁時 MUST 重問一次:狀態會被終端機那邊改掉(Ctrl+C),鈕面停在上一次的答案就是騙人
  for (const mnt of ['pauseVisualMount', 'lobbyVisualMount']) {
    ok(new RegExp(`renderVisualSettings\\(\\$\\('${mnt}'\\)\\); syncDevTools\\(\\)`).test(mainJs),
      `切到設定頁(${mnt})MUST 重問一次開發工具狀態`);
  }
  ok(/await syncDevTools\(\);/.test(mainJs), '按完啟停 MUST 重問一次(鈕面才跟得上實際狀態)');
  for (const id of ['pauseDevMount', 'lobbyDevMount']) {
    ok(html.includes(`id="${id}"`), `index.html 有 #${id} 掛載點`);
    ok(mainJs.includes(`'${id}'`), `main.js 的掛載點名冊含 ${id}`);
  }
  ok(!html.replace(/<!--[\s\S]*?-->/g, '').includes('開發工具'),
    '「開發工具」小標 MUST 由 renderDevTools 產生 —— 寫成靜態標記會在出貨版留下一個空的區塊標題');
  ok(!Object.keys(help.UI_TIPS).some((k) => /dev/i.test(k)),
    '開發工具的說明 MUST NOT 進 UI_TIPS(那一份會被推導進玩家看得到的說明分頁)');

  // 埠號的真相住工具自己(codex_review.mjs `DEFAULT_PORT`)⇒ 客戶端 MUST 一個數字都不寫死
  const codexSrc = readSrc('tools', 'codex_review.mjs');
  ok(/export const DEFAULT_PORT = \d+;/.test(codexSrc),
    'tools/codex_review.mjs 匯出 `DEFAULT_PORT`(埠號的唯一真相)');
  ok(!/localhost:\d+/.test(mainJs),
    'main.js MUST NOT 寫死開發工具的網址或埠(網址由 GET /dev/tools 給)');
  ok(/fetch\('\/dev\/tools'/.test(mainJs) && /x-dev-tools/.test(mainJs),
    '客戶端問 `/dev/tools`,而改變狀態的請求帶 `x-dev-tools` 非簡單標頭(擋跨來源 CSRF)');
  ok(!/function devHost\(/.test(mainJs),
    '客戶端 MUST NOT 自己判一次 hostname —— 說了算的是伺服器那條路由的 loopback 閘');

  // 鈕面吃「埠上有沒有人在聽」;停不掉的(終端機起的)MUST 變灰而不是假裝停得掉
  ok(/t\.listening \? '⏹ 停止' : '▶ 啟動'/.test(mainJs), '啟停鈕面吃 `listening`');
  ok(/power\.disabled = t\.listening && !t\.owned/.test(mainJs),
    '不是這裡啟動的那一支 MUST 停不掉(鈕變灰),MUST NOT 憑一個埠號決定殺誰');
  ok(/open\.disabled = !t\.listening/.test(mainJs), '沒起來時「開啟」是灰的(免得開出一頁連線錯誤)');
}

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('選單版型稽核');
const srv = await serve();
const browser = await chromium.launch({ executablePath: chromePath() });

/** 代表性選角面板骨架(對齊 main.js charDetailHTML / unitDetailHTML 的節點結構) */
const CHAR_SKELETON = `
<div class="cd-lower">
  <div class="cd-art cd-art-char">
    <div class="cd-portrait">
      <div style="width:100%;aspect-ratio:3/4;background:#123"></div>
      <div class="cd-tag steel">鋼鐵軍團・機甲</div>
    </div>
    <div class="cd-arthint">點立繪 ▸ 生平・興趣・專長・與機體的機緣</div>
    <div id="stageBottom"><div class="cd-stage small"><canvas class="cd-canvas"></canvas></div></div>
  </div>
  <div class="cd-body">
    <p class="cd-bio"><b class="cd-bio-tag">生平</b>退役自協約第七機動旅,轉任前線教官後又被召回戰場;
      他相信裝甲的厚度就是弟兄回家的機率,所以每一次推進都算到最後一格。</p>
    <div class="cd-stats"><div class="cd-stat"><span>結構</span><i><b style="width:70%"></b></i><em>640</em></div></div>
    <div class="cd-kit"><div class="cd-row"><span class="cd-key">左鍵</span>
      <div><b>脈衝步槍</b><div class="cd-nums">傷害 34 ・ 射程 210m ・ 射速 6.0/s</div></div></div></div>
    <div class="cd-foot">數值為 Lv1 → Lv2 → Lv3 → Lv4;已含英雄倍率。</div>
  </div>
</div>`;

for (const v of VIEWS) {
  console.log(`\n▍${v.n}`);
  const page = await browser.newPage({
    viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate((skeleton) => {
    // main.js 沒跑(three 可能載不到)⇒ 手動掛版型 class 並攤開選單各畫面
    const portrait = window.innerHeight >= window.innerWidth;
    document.body.classList.add('touch-ui');
    document.body.classList.toggle('ori-portrait', portrait);
    document.body.classList.toggle('ori-landscape', !portrait);
    document.getElementById('touchLayer').hidden = true;
    const show = (id) => { const e = document.getElementById(id); if (e) e.style.display = ''; };
    const hide = (id) => { const e = document.getElementById(id); if (e) e.style.display = 'none'; };
    const box = (sel, root = document) => {
      const e = root.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
    };
    const out = { vw: window.innerWidth, vh: window.innerHeight, portrait };
    // 鈕面文字有沒有溢出方框(clip-path 會把溢出的字裁掉,肉眼只看得到「字被切一半」)
    const fits = (sel) => {
      const e = document.querySelector(sel); if (!e) return null;
      return e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1;
    };
    out.fits = {};

    // ---- 大廳 ----
    show('connect');
    out.lobby = {
      map: box('#mapBuilderBtn'), open: box('#openRoomBtn'), story: box('#storyBtn'),
      panel: box('.connect-box'),
      // 首屏可見度以捲動容器座標算(.screen 是 position:fixed + overflow:auto)
      scrollTop: document.getElementById('connect').scrollTop,
    };
    for (const k of ['mapBuilderBtn', 'openRoomBtn', 'storyBtn']) out.fits[k] = fits(`#${k}`);
    // 連線機制三選一(雲端 / 區網 / 單機):直式同樣 MUST 左右並排(見 /CLAUDE.md A20)
    out.link = { cloud: box('#link_cloud'), lan: box('#link_lan'), solo: box('#link_solo') };
    for (const k of ['link_cloud', 'link_lan', 'link_solo']) out.fits[k] = fits(`#${k}`);
    out.hoverflow = {};
    const noHScroll = (id) => { const e = document.getElementById(id); return e.scrollWidth <= e.clientWidth + 1; };
    out.hoverflow.connect = noHScroll('connect');
    hide('connect');

    // ---- 房間(陣營卡 + 動作列 + 選角)----
    show('room');
    document.getElementById('charSection').style.display = '';
    document.getElementById('charDetail').innerHTML = skeleton;
    // 陣營卡各補一個空位鈕,量得到實際卡高
    for (const s of ['SWARM', 'STEEL']) {
      document.querySelector(`#side${s} .side-slots`).innerHTML =
        '<div class="slot empty"><button class="slot-btn">＋ 入座</button><button class="slot-btn">＋ 電腦</button></div>';
    }
    // 房間設定分頁(電腦難度 ⇄ 操作方式;一次只攤開一組)——真品 DOM 由 main.js renderBotDiff()
    // 與 mobile.js renderCtrlModeRow() 注入,這裡照它們的形狀補一份骨架,
    // 好讓下面的 noHScroll('room') 真的量得到這兩列的寬度。說明已改 ⓘ 懸浮提示,不再有常駐文字。
    document.getElementById('botDiffRow').innerHTML =
      '<span class="seg seg-sm">'
      + ['新手', '低', '中', '高'].map((t) => `<button class="segb" type="button">${t}</button>`).join('')
      + '</span><button class="tip-dot" type="button" data-tip="電腦難度說明">ⓘ</button>';
    document.getElementById('roomCtrlMount').innerHTML =
      '<div class="set-row"><span class="seg seg-sm">'
      + ['◈ 不限定', '⌨ 限定滑鼠鍵盤', '🕹 限定搖桿']
        .map((t) => `<button class="segb" type="button">${t}</button>`).join('')
      + '</span><button class="tip-dot" type="button" data-tip="操作方式說明">ⓘ</button></div>';
    // 分頁預設收著操作方式那一頁 —— 這裡兩頁都攤開,量的是「最寬的那一組會不會撐出橫向捲動」
    document.getElementById('roomCtrlMount').hidden = false;
    out.room = {
      steel: box('#sideSTEEL'), swarm: box('#sideSWARM'),
      ready: box('#readyBtn'), start: box('#startBattleBtn'), leave: box('#leaveRoomBtn'),
      portrait: box('.cd-art-char > .cd-portrait'),
      stage: box('.cd-art-char > #stageBottom'),
      art: box('.cd-art-char'), body: box('.cd-body'),
      section: box('.char-section'),
    };
    for (const k of ['readyBtn', 'startBattleBtn', 'leaveRoomBtn']) out.fits[k] = fits(`#${k}`);
    out.fits.slotBtn = fits('.slot.empty .slot-btn');
    out.hoverflow.room = noHScroll('room');
    hide('room');

    // ---- 疊層(戰場選單:繼續 / 離開兩顆)----
    show('game'); show('pauseOverlay');
    out.pause = {
      resume: box('#resumeBtn'), leave: box('#pauseLeaveBtn'), boxw: box('.pause-box'),
    };
    for (const k of ['resumeBtn', 'pauseLeaveBtn']) out.fits[k] = fits(`#${k}`);
    hide('pauseOverlay');

    // ---- 疊層右上角 ✕:MUST 存在、MUST NOT 壓住任何內容 ----
    // ✕ 是 position:absolute(不佔流內空間)⇒ 標題色條 / 浮右統計會鑽到它底下。
    // `.story-brief-box` 刻意例外(第一件是全幅過場立繪,留白會破圖,✕ 只壓到裝飾角標)。
    out.ovclose = {};
    for (const id of ['pauseOverlay', 'shopOverlay', 'worldOverlay', 'touchOverlay', 'lobbyMenu']) {
      const ov = document.getElementById(id); if (!ov) continue;
      ov.style.display = '';
      const bx = ov.querySelector('.overlay-box');
      const x = ov.querySelector('.ov-close');
      if (!x) { out.ovclose[id] = { hasClose: false }; ov.style.display = 'none'; continue; }
      const xb = x.getBoundingClientRect();
      const covered = [];
      for (const el of bx.querySelectorAll('*')) {
        if (el === x || x.contains(el) || !el.textContent.trim() || el.children.length) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;
        if (b.right <= xb.left || b.left >= xb.right || b.bottom <= xb.top || b.top >= xb.bottom) continue;
        covered.push(el.textContent.trim().slice(0, 14));
      }
      out.ovclose[id] = { hasClose: true, w: xb.width, h: xb.height, covered };
      ov.style.display = 'none';
    }
    hide('game');
    return out;
  }, CHAR_SKELETON);

  // 「同列」= 垂直範圍有交集,**MUST NOT 比對 y 相等** —— `.row` 是 align-items: center,
  // 大鈕(.btn.big)與小鈕(.btn)同列時 y 本來就不一樣(橫式沒有統一鈕高)。
  const sameRow = (a, b) => !!a && !!b && a.y < b.b - 0.5 && b.y < a.b - 0.5;
  const leftOf = (a, b) => a && b && a.r <= b.x + 0.5;

  // 1)大廳三入口 MUST 同列,且整組落在首屏(不必捲動就看得到「劇情戰役」)
  const L = r.lobby;
  ok(sameRow(L.map, L.open) && sameRow(L.open, L.story), '大廳三入口同列(建立地圖 / 開戰時刻 / 劇情戰役)');
  ok(leftOf(L.map, L.open) && leftOf(L.open, L.story), '大廳三入口由左至右不重疊');
  // 首屏可見度只在直式斷言:橫式高度只有 375,題頭壓縮後仍不可能把整個面板塞進一屏(捲動是正常的)
  if (r.portrait) ok(L.story && L.story.b <= r.vh, `「劇情戰役」在首屏內(bottom ${Math.round(L.story?.b)} ≤ ${r.vh})`);
  ok(L.story && L.story.h >= 44, `入口鈕觸控高度 ≥44(${Math.round(L.story?.h)})`);

  // 1.5)連線機制三選一 MUST 同列(桌機左右並排 ⇒ 直式也左右並排,窄屏只准收窄欄寬 + 降字級)
  const K = r.link;
  ok(sameRow(K.cloud, K.lan) && sameRow(K.lan, K.solo), '連線機制三選一同列(雲端 / 區網 / 單機)');
  ok(leftOf(K.cloud, K.lan) && leftOf(K.lan, K.solo), '連線機制三選一由左至右不重疊');
  ok(K.solo && K.solo.r <= r.vw + 0.5, '連線機制列不出界');

  // 2)陣營卡 MUST 左右並排(STEEL 左 / SWARM 右)
  const R = r.room;
  ok(sameRow(R.steel, R.swarm), '陣營卡同列');
  ok(leftOf(R.steel, R.swarm), '陣營卡 STEEL 在左、SWARM 在右且不重疊');
  ok(R.steel && R.steel.r <= r.vw + 0.5 && R.swarm && R.swarm.r <= r.vw + 0.5, '陣營卡不出界');

  // 3)房間動作列 MUST 同列
  ok(sameRow(R.ready, R.start) && sameRow(R.start, R.leave), '房間動作列同列(準備 / 開戰 / 離開)');
  ok(leftOf(R.ready, R.start) && leftOf(R.start, R.leave), '房間動作列由左至右不重疊');
  ok(R.ready && R.ready.h >= 44, `動作鈕觸控高度 ≥44(${Math.round(R.ready?.h)})`);

  // 4)選角:直式 = 頭像 ▏展示台 左右並排 + 說明吃滿寬;橫式 = 維持桌機的左欄(頭像上、展示台下)
  if (r.portrait) {
    ok(sameRow(R.portrait, R.stage), '選角:頭像與展示台同列');
    ok(leftOf(R.portrait, R.stage), '選角:頭像在左、展示台在右且不重疊');
    ok(R.stage && R.stage.h >= 140, `選角:展示台高度足夠(${Math.round(R.stage?.h)} ≥ 140)`);
    ok(R.art && R.body && R.art.b <= R.body.y + 0.5, '選角:頭像/展示台區不與詳細說明重疊(sticky 已解除)');
    ok(R.body && R.body.w >= r.vw * 0.7, `選角:詳細說明吃滿寬(${Math.round(R.body?.w)} ≥ ${Math.round(r.vw * 0.7)})`);
  } else {
    ok(leftOf(R.art, R.body), '選角(橫式):頭像欄在左、詳細說明在右');
  }

  // 4.4)畫面 MUST NOT 橫向溢出(手機上出現左右捲動 = 有元件被擠出去了)
  for (const [k, v] of Object.entries(r.hoverflow)) ok(v === true, `#${k} 無橫向溢出`);

  // 4.5)鈕面文字 MUST 不溢出方框(clip-path 會直接把字裁掉)
  for (const [k, v] of Object.entries(r.fits)) ok(v === true, `鈕面文字不溢出方框:#${k}`);

  // 5)疊層按鈕列 MUST 同列(不再一律改直排)
  const P = r.pause;
  ok(sameRow(P.resume, P.leave), '戰場選單:繼續 / 離開同列');
  ok(leftOf(P.resume, P.leave), '戰場選單:繼續 / 離開不重疊');
  ok(P.resume && P.resume.h >= 44, `戰場選單鈕觸控高度 ≥44(${Math.round(P.resume?.h)})`);

  // 6)疊層右上角 ✕:存在、觸控目標夠大、且沒有內容被壓在底下
  for (const [id, c] of Object.entries(r.ovclose)) {
    ok(c.hasClose, `#${id} MUST 有右上角關閉鍵 ✕`);
    if (!c.hasClose) continue;
    ok(c.w >= 34 && c.h >= 34, `#${id} 的 ✕ 夠大(${Math.round(c.w)}×${Math.round(c.h)})`);
    ok(c.covered.length === 0, `#${id} 的 ✕ 沒有壓住內容${c.covered.length ? `:${c.covered.join('、')}` : ''}`);
  }

  await page.close();
}

await browser.close();
srv.close();
console.log(`\n${bad ? '✗' : '✓'} 選單版型稽核:${cases - bad}/${cases} 通過`);
process.exit(bad ? 1 : 0);
