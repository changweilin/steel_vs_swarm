// ============ 國旗(旗面型錄 + 國籍歸屬規則)============
// 2026-08-13 使用者:「遊戲中加入國旗物件(國家比例為 地圖:駐軍國:敵對國 = 30:60:10),
// 建立國旗飄揚的動畫」。本檔管**寫哪一國**與**旗面長什麼樣**;掛在哪、怎麼飄是別人的事:
//   ・落點與旗桿      → `biomes.js`(建物構件 + 主堡旗陣)
//   ・飄揚(頂點位移) → `toon.js` 的 `SOFT_KINDS.cloth`(A39 軟性物質,細勾線 + 隨風飄揚)
//   ・貼圖畫布        → 呼叫端把 2D context 交給 `drawFlag()`(本檔不碰 DOM,見下)
//
// ---- 三條邊界 ----
// ① **零 THREE、零 DOM、只 import `rng.js`**(同 `edgewall.js` 的先例)。旗面是「一疊色帶
//    加幾個記號」的**純資料描述子**,畫的動作交給呼叫端給的 ctx ⇒ 「這一版式畫不畫得出來、
//    這一國認不認得出來」在 Node 端就驗得到,不必開瀏覽器。這正是這一族唯一能離線驗的一半。
// ② **零共享 `rnd()` 消耗**(§2.3)。挑國一律由**落點座標雜湊**餵自己的 `mulberry32` ——
//    共享序列多抽一枚就把後面每一株植被、每一棟建物的佈局整條推移,而畫面上只表現成
//    「整張圖變了」,沒有任何錯誤訊息。
// ③ **陣營的國家名冊 MUST 推導**(原則 2):由 `data.js CHARACTERS[].side` × `lore.js LORE[].nat`
//    當場交叉出來,MUST NOT 在本檔手寫一份「蜂群有哪些國家」—— 手寫的那一份會在換陣營
//    (CLAUDE.md §2.1「角色機種」那一列:換陣營時一整組要跟著搬)之後靜默過期,而旗子照掛。
//
// ---- 「駐軍國 / 敵對國」怎麼判定(2026-08-13 使用者定案:依戰場半邊)----
// 旗子落在哪一側,駐軍國就從**那一側主堡的陣營**名冊裡抽,敵對國從對面抽。理由是它在
// 建圖期就拿得到且**跨客戶端逐位元一致**:`bases.SWARM` / `bases.STEEL` 是開房當下由
// `rooms.rollSideSwap` 定案、隨 battleConfig 廣播全房的(那支的檔頭:擲點 MUST 留在房間
// 階段,正是為了客戶端的地形預建)。改成「由玩家選角推導」就得等選角完成 ⇒ 場景要重建。
import { mulberry32 } from './rng.js';

/**
 * 旗面比例(寬:高)。2:3 與 1:2 都有,取 5:3 當全體公稱值 —— 場上是幾十公尺外的小物件,
 * 逐國精確比例看不出來,而**版面**(色帶方向、記號位置)要跟著同一個框才畫得準。
 */
export const FLAG_RATIO = 5 / 3;

/**
 * 旗面版式型錄(ISO 3166-1 alpha-2)。
 *   f  'h' 橫帶 / 'v' 直帶 / 'solid' 單色底
 *   c  底色(solid 取第一色)
 *   w  各帶權重(省略 = 等分)
 *   m  記號,逐筆 [型別, ...參數];座標一律是**比例**(0~1 的旗面寬/高)⇒ 換貼圖尺寸不必改表
 * 記號型別:disc 圓 / ring 環 / cross 北歐十字 / star 星 / canton 左上角塊 / bar 矩形 /
 *           tri 旗桿側三角 / sun 光芒 / diamond 菱形 / crescent 新月(圓 + 挖一個偏心圓)
 * **這是「認得出是哪一國」的精度,不是紋章學精度**:國徽一律簡化成圓/星/條。
 */
export const FLAG_DESIGNS = {
  UA: { f: 'h', c: ['#0057b7', '#ffd700'] },
  RU: { f: 'h', c: ['#ffffff', '#0039a6', '#d52b1e'] },
  BY: { f: 'h', c: ['#c8313e', '#4aa657'], w: [2, 1], m: [['bar', 0, 0, 0.11, 1, '#ffffff'], ['bar', 0.03, 0, 0.05, 1, '#c8313e']] },
  PL: { f: 'h', c: ['#ffffff', '#dc143c'] },
  EE: { f: 'h', c: ['#0072ce', '#000000', '#ffffff'] },
  DE: { f: 'h', c: ['#000000', '#dd0000', '#ffce00'] },
  FR: { f: 'v', c: ['#002395', '#ffffff', '#ed2939'] },
  IT: { f: 'v', c: ['#009246', '#ffffff', '#ce2b37'] },
  ES: { f: 'h', c: ['#aa151b', '#f1bf00', '#aa151b'], w: [1, 2, 1], m: [['bar', 0.2, 0.36, 0.1, 0.28, '#ad1519']] },
  CH: { f: 'solid', c: ['#d52b1e'], m: [['cross', 0.5, 0.2, '#ffffff']] },
  // 聯合旗**一定要有斜十字**:只畫正十字的話它讀起來是北歐旗(冰島/挪威),而聯合旗
  // 同時是倫敦場地的地圖國與澳洲的角隅 ⇒ 兩面旗一起認錯。故收成一個複合記號 `jack`。
  GB: { f: 'solid', c: ['#012169'], m: [['jack', 1, 1]] },
  RS: { f: 'h', c: ['#c6363c', '#0c4076', '#ffffff'], m: [['bar', 0.24, 0.28, 0.12, 0.44, '#c6363c']] },
  TR: { f: 'solid', c: ['#e30a17'], m: [['crescent', 0.38, 0.5, 0.2, 0.07, '#ffffff', '#e30a17'], ['star', 0.56, 0.5, 0.1, 5, '#ffffff']] },
  IL: { f: 'solid', c: ['#ffffff'], m: [['bar', 0, 0.12, 1, 0.12, '#0038b8'], ['bar', 0, 0.76, 1, 0.12, '#0038b8'], ['star', 0.5, 0.5, 0.19, 6, '#0038b8']] },
  IR: { f: 'h', c: ['#239f40', '#ffffff', '#da0000'], m: [['bar', 0.44, 0.4, 0.12, 0.2, '#da0000']] },
  IN: { f: 'h', c: ['#ff9933', '#ffffff', '#138808'], m: [['ring', 0.5, 0.5, 0.15, 0.03, '#000088']] },
  CN: {
    f: 'solid', c: ['#de2910'],
    m: [['star', 0.17, 0.28, 0.16, 5, '#ffde00'], ['star', 0.33, 0.14, 0.06, 5, '#ffde00'],
      ['star', 0.4, 0.26, 0.06, 5, '#ffde00'], ['star', 0.4, 0.42, 0.06, 5, '#ffde00'],
      ['star', 0.33, 0.54, 0.06, 5, '#ffde00']],
  },
  TW: { f: 'solid', c: ['#fe0000'], m: [['canton', 0.5, 0.5, '#000095'], ['sun', 0.25, 0.25, 0.13, 12, '#ffffff'], ['disc', 0.25, 0.25, 0.07, '#ffffff']] },
  JP: { f: 'solid', c: ['#ffffff'], m: [['disc', 0.5, 0.5, 0.3, '#bc002d']] },
  KR: {
    f: 'solid', c: ['#ffffff'],
    m: [['disc', 0.5, 0.5, 0.2, '#cd2e3a'], ['halfdisc', 0.5, 0.5, 0.2, '#0047a0'],
      ['bar', 0.1, 0.18, 0.14, 0.06, '#000000'], ['bar', 0.1, 0.76, 0.14, 0.06, '#000000'],
      ['bar', 0.76, 0.18, 0.14, 0.06, '#000000'], ['bar', 0.76, 0.76, 0.14, 0.06, '#000000']],
  },
  KP: {
    f: 'h', c: ['#024fa2', '#ffffff', '#ed1c27', '#ffffff', '#024fa2'], w: [1, 0.3, 2.4, 0.3, 1],
    m: [['disc', 0.33, 0.5, 0.18, '#ffffff'], ['star', 0.33, 0.5, 0.14, 5, '#ed1c27']],
  },
  MN: { f: 'v', c: ['#c4272f', '#015197', '#c4272f'], m: [['bar', 0.06, 0.28, 0.05, 0.44, '#f9cf02']] },
  US: {
    f: 'h', c: ['#b22234', '#ffffff', '#b22234', '#ffffff', '#b22234', '#ffffff', '#b22234'],
    m: [['canton', 0.4, 0.54, '#3c3b6e'], ['star', 0.12, 0.16, 0.06, 5, '#ffffff'],
      ['star', 0.28, 0.16, 0.06, 5, '#ffffff'], ['star', 0.2, 0.3, 0.06, 5, '#ffffff'],
      ['star', 0.12, 0.44, 0.06, 5, '#ffffff'], ['star', 0.28, 0.44, 0.06, 5, '#ffffff']],
  },
  MX: { f: 'v', c: ['#006847', '#ffffff', '#ce1126'], m: [['disc', 0.5, 0.5, 0.13, '#8a6a3c']] },
  CU: {
    f: 'h', c: ['#002a8f', '#ffffff', '#002a8f', '#ffffff', '#002a8f'],
    m: [['tri', 0.38, '#cf142b'], ['star', 0.13, 0.5, 0.13, 5, '#ffffff']],
  },
  BR: { f: 'solid', c: ['#009c3b'], m: [['diamond', 0.5, 0.5, 0.42, 0.42, '#ffdf00'], ['disc', 0.5, 0.5, 0.19, '#002776']] },
  AR: { f: 'h', c: ['#74acdf', '#ffffff', '#74acdf'], m: [['sun', 0.5, 0.5, 0.1, 16, '#f6b40e']] },
  AU: {
    f: 'solid', c: ['#00247d'],
    m: [['jack', 0.5, 0.5], ['star', 0.25, 0.78, 0.1, 7, '#ffffff'],
      ['star', 0.72, 0.3, 0.08, 7, '#ffffff'], ['star', 0.8, 0.55, 0.07, 7, '#ffffff'],
      ['star', 0.7, 0.76, 0.07, 7, '#ffffff']],
  },
  EG: { f: 'h', c: ['#ce1126', '#ffffff', '#000000'], m: [['disc', 0.5, 0.5, 0.11, '#c09300']] },
  ZA: { f: 'h', c: ['#e03c31', '#ffffff', '#001489'], m: [['bar', 0, 0.4, 1, 0.2, '#007749'], ['tri', 0.42, '#000000'], ['tri', 0.3, '#ffb612']] },
  BW: { f: 'h', c: ['#6da9d2', '#ffffff', '#000000', '#ffffff', '#6da9d2'], w: [3, 0.5, 2, 0.5, 3] },
};

/**
 * 中文國名(`lore.js` 的 `nat` 欄)→ ISO。**取值 MUST 經 `natIso()`**,別直接查這張表:
 * 那一欄有「烏克蘭(克里米亞韃靼)」「中國(重慶)」這種帶括號補述的寫法(全形與半形括號
 * 都出現過),直接查表兩筆都回 null ⇒ 那兩位的國家從名冊裡無聲消失。
 */
export const NAT_ISO = {
  烏克蘭: 'UA', 俄羅斯: 'RU', 白俄羅斯: 'BY', 波蘭: 'PL', 愛沙尼亞: 'EE', 德國: 'DE',
  法國: 'FR', 義大利: 'IT', 西班牙: 'ES', 瑞士: 'CH', 英國: 'GB', 塞爾維亞: 'RS',
  土耳其: 'TR', 以色列: 'IL', 伊朗: 'IR', 印度: 'IN', 中國: 'CN', 台灣: 'TW',
  日本: 'JP', 南韓: 'KR', 北韓: 'KP', 蒙古: 'MN', 美國: 'US', 墨西哥: 'MX',
  古巴: 'CU', 巴西: 'BR', 阿根廷: 'AR', 澳洲: 'AU', 埃及: 'EG', 南非: 'ZA', 波札那: 'BW',
};

/** 中文國名 → ISO;括號補述(全形/半形)一律切掉。查無此國回 null(寧缺勿錯) */
export function natIso(nat) {
  if (!nat) return null;
  const base = String(nat).split(/[(（]/)[0].trim();
  return NAT_ISO[base] || null;
}

/**
 * 旗幟 emoji → ISO(`venues.js` 的 `country` 欄)。與 `vernacular.js flagToIso` 同一條換算,
 * 但本檔零 import(見檔頭 ①)⇒ 這裡另有一份**十行的純算術**,不是另一份規則。
 * 區域指示符 U+1F1E6('A')起算。
 */
export function isoOfFlagEmoji(emoji) {
  const cps = [...String(emoji || '')].map((c) => c.codePointAt(0));
  if (cps.length !== 2 || cps.some((c) => c < 0x1f1e6 || c > 0x1f1ff)) return null;
  return cps.map((c) => String.fromCharCode(65 + c - 0x1f1e6)).join('');
}

/**
 * 陣營國家名冊(推導,見檔頭 ③)。呼叫端把 `data.js` 的 CHARACTERS 與 `lore.js` 的 LORE
 * 傳進來(本檔零 import),回 `{ SWARM: [iso...], STEEL: [...], MERC: [...] }`。
 * 名冊 MUST **去重且定序**:順序是挑國的索引依據,靠物件鍵序會在改角色表之後整批位移
 * ⇒ 同一張圖上的旗子換了國家,而沒有任何東西改變過。
 */
export function sideIsoRoster(CHARACTERS, LORE) {
  const out = {};
  for (const id in CHARACTERS) {
    const side = CHARACTERS[id]?.side;
    const iso = natIso(LORE?.[id]?.nat);
    if (!side || !iso || !FLAG_DESIGNS[iso]) continue;
    (out[side] ||= new Set()).add(iso);
  }
  const r = {};
  for (const s in out) r[s] = [...out[s]].sort();
  return r;
}

/**
 * 國家比例(2026-08-13 使用者定案)。三份 MUST 加起來 = 1;
 * 「地圖國」拿不到(自訂地圖沒有 country 欄)⇒ 那 30% **併進駐軍國**(原則 6 降級不例外):
 * 併進敵對國的話一張圖上會有四成敵旗,而那正是這張表要表達的相反的事。
 */
export const FLAG_MIX = { MAP: 0.30, GARRISON: 0.60, ENEMY: 0.10 };

/** 落點種子:座標雜湊(零共享 rnd,見檔頭 ②)。格粒 1m ⇒ 同一根旗桿恆同一國 */
export function flagSeed(x, z) {
  const xi = Math.round(x) | 0, zi = Math.round(z) | 0;
  return (Math.imul(xi, 0x9e3779b1) ^ Math.imul(zi, 0x85ebca77) ^ 0x5bf03635) >>> 0;
}

/**
 * 挑一面旗的國家。
 * @param seed     `flagSeed(x, z)`
 * @param roster   { map: iso|null, garrison: [iso...], enemy: [iso...] }
 * @returns { iso, role } role ∈ 'map'|'garrison'|'enemy';全空回 null(寧缺勿錯 ⇒ 不掛旗)
 * **兩枚亂數固定消耗**(§2.3 抽樣紀律):一枚決定角色、一枚決定名冊內第幾個。
 * 淘汰(名冊是空的)排在抽樣**之後** —— 「空的就跳過抽樣」會讓後面每一根旗桿的序列位移。
 */
export function pickFlagIso(seed, { map = null, garrison = [], enemy = [] } = {}) {
  const rnd = mulberry32(seed);
  const u = rnd(), v = rnd();
  const mapOk = !!(map && FLAG_DESIGNS[map]);
  const gar = garrison.filter((i) => FLAG_DESIGNS[i]);
  const foe = enemy.filter((i) => FLAG_DESIGNS[i]);
  // 地圖國缺席 ⇒ 它那一份併進**駐軍**:駐軍的門檻要往上長,不是地圖的門檻往下縮。
  // 只把 mapCut 歸零(而 garCut = mapCut + GARRISON)的話,空出來的 30% 全部落到最後那個
  // else 分支 = 敵旗變成 40% —— 一張自訂地圖上四成掛著敵國的旗,而比例表看起來完全正常。
  const mapCut = mapOk ? FLAG_MIX.MAP : 0;
  const garCut = mapCut + FLAG_MIX.GARRISON + (mapOk ? 0 : FLAG_MIX.MAP);
  const pick = (list) => (list.length ? list[Math.min(list.length - 1, Math.floor(v * list.length))] : null);
  if (u < mapCut) return { iso: map, role: 'map' };
  if (u < garCut) {
    const iso = pick(gar);
    return iso ? { iso, role: 'garrison' } : (mapOk ? { iso: map, role: 'map' } : null);
  }
  const iso = pick(foe);
  return iso ? { iso, role: 'enemy' } : (mapOk ? { iso: map, role: 'map' } : null);
}

/**
 * 把一面旗畫進呼叫端給的 2D context(本檔不建立 canvas,見檔頭 ①)。
 * ctx 的原點 = 旗面左上(旗桿在左);w/h = 像素尺寸。
 * 認不得的 ISO 一律**不畫**並回 false —— 畫一面空白旗比不掛旗更糟(那看起來像投降旗)。
 */
export function drawFlag(ctx, w, h, iso) {
  const d = FLAG_DESIGNS[iso];
  if (!d) return false;
  const cols = d.c || ['#cccccc'];
  // ---- 底(單色 / 橫帶 / 直帶)----
  if (d.f === 'solid') {
    ctx.fillStyle = cols[0];
    ctx.fillRect(0, 0, w, h);
  } else {
    const ws = d.w && d.w.length === cols.length ? d.w : cols.map(() => 1);
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    const span = d.f === 'v' ? w : h;
    let at = 0;
    cols.forEach((c, i) => {
      const t = span * ws[i] / sum;
      ctx.fillStyle = c;
      // 逐帶多畫半格再蓋回去:相鄰兩帶用非整數邊界時中間會透出一條底色縫
      if (d.f === 'v') ctx.fillRect(Math.floor(at), 0, Math.ceil(t) + 1, h);
      else ctx.fillRect(0, Math.floor(at), w, Math.ceil(t) + 1);
      at += t;
    });
  }
  // ---- 記號 ----
  for (const mk of d.m || []) drawMark(ctx, w, h, mk);
  return true;
}

function drawMark(ctx, w, h, [t, ...a]) {
  const R = (v) => v * h;   // 半徑類一律以**高**為尺:以寬為尺的話同一顆星在 5:3 的旗上是橢圓
  switch (t) {
    case 'disc': {
      const [cx, cy, r, c] = a;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.arc(cx * w, cy * h, R(r), 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'halfdisc': {   // 太極的下半(上半由前一筆 disc 畫)
      const [cx, cy, r, c] = a;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.arc(cx * w, cy * h, R(r), 0, Math.PI); ctx.fill();
      break;
    }
    case 'ring': {
      const [cx, cy, r, lw, c] = a;
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1, R(lw)); ctx.beginPath();
      ctx.arc(cx * w, cy * h, R(r), 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'cross': {      // 北歐/聯合旗式十字:直桿偏旗桿側 + 橫桿置中
      const [cx, th, c] = a;
      ctx.fillStyle = c;
      ctx.fillRect(cx * w - R(th) / 2, 0, R(th), h);
      ctx.fillRect(0, h / 2 - R(th) / 2, w, R(th));
      break;
    }
    case 'canton': {
      const [cw, ch, c] = a;
      ctx.fillStyle = c; ctx.fillRect(0, 0, cw * w, ch * h);
      break;
    }
    case 'bar': {
      const [x, y, bw, bh, c] = a;
      ctx.fillStyle = c; ctx.fillRect(x * w, y * h, bw * w, bh * h);
      break;
    }
    case 'tri': {        // 旗桿側三角(古巴/南非)
      const [tw, c] = a;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(tw * w, h / 2); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
      break;
    }
    case 'diamond': {
      const [cx, cy, rx, ry, c] = a;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(cx * w, (cy - ry) * h); ctx.lineTo((cx + rx) * w, cy * h);
      ctx.lineTo(cx * w, (cy + ry) * h); ctx.lineTo((cx - rx) * w, cy * h);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'sun': {
      const [cx, cy, r, rays, c] = a;
      ctx.fillStyle = c;
      for (let i = 0; i < rays; i++) {
        const th0 = i / rays * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx * w + Math.cos(th0) * R(r) * 2, cy * h + Math.sin(th0) * R(r) * 2);
        ctx.lineTo(cx * w + Math.cos(th0 + 0.22) * R(r), cy * h + Math.sin(th0 + 0.22) * R(r));
        ctx.lineTo(cx * w + Math.cos(th0 - 0.22) * R(r), cy * h + Math.sin(th0 - 0.22) * R(r));
        ctx.closePath(); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx * w, cy * h, R(r), 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'crescent': {   // 圓 + 挖一個偏心圓(挖的顏色 = 底色,呼叫端指定)
      const [cx, cy, r, off, c, cut] = a;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.arc(cx * w, cy * h, R(r), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = cut; ctx.beginPath();
      ctx.arc(cx * w + R(off), cy * h, R(r) * 0.82, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'jack': {
      // 聯合旗(複合記號):白斜十字 → 紅斜十字 → 白正十字 → 紅正十字,畫在左上角
      // rw × rh 的區域裡。**GB 與 AU 共用這一支** —— 各畫一份的話,改了其中一面另一面
      // 不會跟著改(而澳洲那一面小到不會有人注意到它跟本國旗不一樣)。
      const [rw, rh] = a;
      const bw = rw * w, bh = rh * h;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, bw, bh); ctx.clip();
      ctx.fillStyle = '#012169'; ctx.fillRect(0, 0, bw, bh);
      const diag = (lw, c) => {
        ctx.strokeStyle = c; ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(bw, bh);
        ctx.moveTo(bw, 0); ctx.lineTo(0, bh);
        ctx.stroke();
      };
      diag(bh * 0.20, '#ffffff');
      diag(bh * 0.10, '#c8102e');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bw / 2 - bh * 0.16, 0, bh * 0.32, bh);
      ctx.fillRect(0, bh / 2 - bh * 0.16, bw, bh * 0.32);
      ctx.fillStyle = '#c8102e';
      ctx.fillRect(bw / 2 - bh * 0.09, 0, bh * 0.18, bh);
      ctx.fillRect(0, bh / 2 - bh * 0.09, bw, bh * 0.18);
      ctx.restore();
      break;
    }
    case 'star': {
      const [cx, cy, r, pts, c] = a;
      ctx.fillStyle = c; ctx.beginPath();
      for (let i = 0; i < pts * 2; i++) {
        const rr = R(r) * (i % 2 ? 0.44 : 1);
        const th0 = -Math.PI / 2 + i * Math.PI / pts;
        const px = cx * w + Math.cos(th0) * rr, py = cy * h + Math.sin(th0) * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    default: break;   // 認不得的記號**跳過**而不是丟例外:型錄擴充時舊版本仍畫得出底色
  }
}
