// ============ Prologue Cinematic Intro & Asset Pre-caching ============
// Displays full-screen cinematic narrative crawl with dynamic camera framing
// across 5 unique historical artworks while buffering core game assets in the background.
// Supports both Landscape (Desktop / mobile landscape) and Portrait (mobile portrait) layouts
// with a fixed, non-obscuring narrative text box where prose scrolls upward smoothly.

export const PROLOGUE_SCENES = [
  {
    id: 'economy_runaway',
    side: 'SPEC',
    img: 'assets/story/story_prologue_01_scholar.png',
    tag: 'TEHRAN // 德黑蘭・純粹的算式',
    badge: '第一節',
    title: '經濟學的暴走',
    paragraphs: [
      '這是一場誰都負擔得起的戰爭。',
      '十五年前，一位德黑蘭的空氣動力學教授寫下一句乾淨得近乎無辜的命題：防禦的成本，必須低於攻擊。',
      '他想用經濟學終結戰爭——如果一枚攻擊比它摧毀的目標更便宜，理性的國家就不會再輕啟戰端。',
      '他錯得很徹底。他證明的不是「戰爭打不起」，而是「戰爭打不完」：當一架能擊沉坦克的自殺無人機只要四百八十美元，殺戮就成了全世界最廉價的商品，人人買得起，於是人人都在買。',
    ],
    camera: {
      landscape: {
        start: { scale: 1.18, x: -6, y: -6 },
        mid:   { scale: 1.12, x: 0, y: -8 },
        end:   { scale: 1.05, x: 4, y: -4 },
      },
      portrait: {
        start: { scale: 1.25, x: -4, y: -10 },
        mid:   { scale: 1.18, x: 0, y: -8 },
        end:   { scale: 1.10, x: 2, y: -6 },
      },
    },
  },
  {
    id: 'swarm_requiem',
    side: 'SWARM',
    img: 'assets/story/story_prologue_02_swarm.png',
    tag: 'MARIUPOL, 2022 // 馬里烏波爾・無人機的琴弦',
    badge: '第二節',
    title: '蜂群的鎮魂曲',
    paragraphs: [
      '烏克蘭的天空最先黑成一片。成群結隊、以千計數的廉價無人機像蜂群一樣撲向鋼鐵的軍隊，一種新的信仰隨之誕生——蜂群主義，「死的是機器，不是人。」',
      '把人從危險裡撤出來，躲在螢幕後面遙控，讓便宜的、可拋棄的機器去死。',
      '同盟由此集結：一群工程師、電競選手、音樂老師、退役感測官，用車庫改裝的六旋翼與跳頻晶片，把「用數量淹沒質量」寫成了整個時代的戰術。',
      '他們的旗幟是一位在馬里烏波爾失去弟弟的指揮官，她把六十架蜂群指揮得像一支管弦樂團，卻拒絕替任何一架機器取名：「哀悼留給人。機器，我們再印一台。」',
    ],
    camera: {
      landscape: {
        start: { scale: 1.20, x: 4, y: -8 },
        mid:   { scale: 1.14, x: -4, y: -10 },
        end:   { scale: 1.06, x: -8, y: -6 },
      },
      portrait: {
        start: { scale: 1.25, x: 4, y: -12 },
        mid:   { scale: 1.18, x: 0, y: -8 },
        end:   { scale: 1.10, x: -2, y: -6 },
      },
    },
  },
  {
    id: 'steel_epitaph',
    side: 'STEEL',
    img: 'assets/story/story_prologue_03_steel.png',
    tag: 'MOSCOW, 2022 // 莫斯科近郊・四百八十美元',
    badge: '第三節',
    title: '鋼鐵的墓誌銘',
    paragraphs: [
      '而在鋼鐵的那一端，一位俄羅斯上將的獨子，一名普通的機槍手，死在了一件比步槍還便宜的東西手裡。屍體旁是一台造價四百八十美元的自殺無人機殘片。',
      '他無法接受自己人死得如此廉價。葬禮後第三天，他向總參提交重裝雙足平台的量產案，附言只有一句：',
      '「一枚四百八十美元的無人機，換走了我一場三百萬美元也買不回的葬禮。給我的士兵穿上鋼鐵。」',
      '協約由此成形——他們相信厚重的裝甲、相信把駕駛員包成一顆蛋的乘員艙、相信用鋼鐵的存量去換蜂群的消耗。',
      '他們笨重、昂貴、補充有冷卻，完全違背這個時代的邏輯，可他們偏要造。裡面的人，要活著回來。',
    ],
    camera: {
      landscape: {
        start: { scale: 1.20, x: -10, y: -8 },
        mid:   { scale: 1.14, x: 2, y: -10 },
        end:   { scale: 1.06, x: -4, y: -6 },
      },
      portrait: {
        start: { scale: 1.25, x: -8, y: -12 },
        mid:   { scale: 1.18, x: 2, y: -8 },
        end:   { scale: 1.10, x: 0, y: -6 },
      },
    },
  },
  {
    id: 'price_of_freedom',
    side: 'SPEC',
    img: 'assets/story/story_prologue_04_mercenary.png',
    tag: 'GLOBAL WAR // 雙生之悲與傭兵',
    badge: '第四節',
    title: '自由的價格',
    paragraphs: [
      '兩種信仰，兩位各自失去至親的人，隔著陣營在戰報裡對照了整整三年，像照鏡子：一個失去弟弟，一個失去兒子，都死於對方陣營的同一種武器。',
      '戰火從東亞的玻璃帷幕燒起，沿著沙漠的補給線、歐洲的濃霧密林，一路蔓延到大洋彼岸的金融心臟，最後折返回黑海北岸的那座半島，在一座要塞港市的暮色裡匯聚成決戰。',
      '而在兩軍之間，還有第三種人——傭兵。他們駕駛能在飛行與地面之間變形的機甲，不談立場，只認合約：「哪邊付錢都一樣快。」',
      '蜂群的錢和鋼鐵的錢在他們眼裡是同一種顏色，今天替你炸開一條路，明天可能就替出價更高的人炸你。他們是這場戰爭的潤滑油，也是它永遠停不下來的另一個理由。',
    ],
    camera: {
      landscape: {
        start: { scale: 1.14, x: 6, y: -6 },
        mid:   { scale: 1.09, x: 0, y: -8 },
        end:   { scale: 1.05, x: -4, y: -4 },
      },
      portrait: {
        start: { scale: 1.24, x: -14, y: -8 },
        mid:   { scale: 1.24, x: 14, y: -8 },
        end:   { scale: 1.10, x: 0, y: -6 },
      },
    },
  },
  {
    id: 'spear_and_shield',
    side: 'SPEC',
    img: 'assets/story/story_prologue_01_scholar.png',
    tag: 'EPILOGUE // 終曲・無休止的震顫',
    badge: '第五節',
    title: '矛與盾的命題',
    paragraphs: [
      '從台北到克里米亞，這場征討繞了大半個地球，最後繞回了它開始的地方。',
      '你可以站在鋼鐵這一端，替沒能穿上裝甲的孩子補上那一層；也可以站在蜂群那一端，用數量與速度證明，便宜的東西一樣能贏。同一片戰場，兩種答案。',
      '而那位寫下命題的教授，如今每晚仍坐在帳篷裡，替敵我雙方陣亡的操作員，各寫一行不署名的哀悼詩。',
      '「我想造的是讓戰爭打不起的東西，結果造出了讓戰爭打不完的東西。」',
      '夜色沉沉，矛與盾的呼嘯，在戰線兩側永無休止地震顫。',
    ],
    camera: {
      landscape: {
        start: { scale: 1.12, x: -4, y: -8 },
        mid:   { scale: 1.08, x: 0, y: -6 },
        end:   { scale: 1.05, x: 3, y: -4 },
      },
      portrait: {
        start: { scale: 1.30, x: -4, y: -14 },
        mid:   { scale: 1.18, x: 0, y: -10 },
        end:   { scale: 1.08, x: 0, y: -6 },
      },
    },
  },
];

const PRELOAD_ASSETS = [
  'assets/story/story_prologue_01_scholar.png',
  'assets/story/story_prologue_02_swarm.png',
  'assets/story/story_prologue_03_steel.png',
  'assets/story/story_prologue_04_mercenary.png',
  'assets/logo_flat.png',
  'assets/story/story_ch1_steel.png',
  'assets/story/story_ch1_swarm.png',
  'assets/loading/steel_vs_swarm_1.png',
  'assets/loading/steel_vs_mercenary_1.png',
  'assets/loading/swarm_vs_mercenary_1.png',
];

const PROLOGUE_SEEN_KEY = 'svs_prologue_seen';

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function isLandscape() {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= window.innerHeight;
}

function calcCameraTransform(camGroup, t) {
  // 運鏡只動框內照片：邊界框本身不動，照片在框內做中幅平移 + 明顯推拉。
  // 位移 ±3.2% / ±2.6%，縮放 1.06~1.22；框體 inset -3% 安全邊內永不露邊。
  // 文字捲速由 autoScrollSpeed 單獨控制，此處只改幅度、不動速度。
  const cam = camGroup?.[isLandscape() ? 'landscape' : 'portrait'];
  if (!cam) return 'none';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const f = Math.max(0, Math.min(1, t));
  const lerp = (a, b, p) => a + (b - a) * p;
  let scale, x, y;
  if (f < 0.5) {
    const p = easeInOutQuad(f * 2);
    scale = lerp(cam.start.scale, cam.mid.scale, p);
    x = lerp(cam.start.x, cam.mid.x, p);
    y = lerp(cam.start.y, cam.mid.y, p);
  } else {
    const p = easeInOutQuad((f - 0.5) * 2);
    scale = lerp(cam.mid.scale, cam.end.scale, p);
    x = lerp(cam.mid.x, cam.end.x, p);
    y = lerp(cam.mid.y, cam.end.y, p);
  }
  const s = clamp(scale, 1.06, 1.22).toFixed(3);
  const tx = clamp(x * 0.22, -3.2, 3.2).toFixed(2);
  const ty = clamp(y * 0.18, -2.6, 2.6).toFixed(2);
  return `translate3d(${tx}%, ${ty}%, 0) scale(${s})`;
}

/** Preloads assets into browser cache while reporting real-time progress. */
export async function bufferGameCache(onProgress) {
  let loaded = 0;
  const total = PRELOAD_ASSETS.length + 2; // +1 fonts, +1 3D models warm
  const report = (name) => {
    loaded++;
    const pct = Math.min(100, Math.round((loaded / total) * 100));
    onProgress?.({ loaded, total, pct, name, ready: loaded >= total });
  };

  const tasks = PRELOAD_ASSETS.map((src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { report(src); resolve(); };
    img.onerror = () => { report(src); resolve(); };
    img.src = src;
  }));

  // Fonts
  tasks.push(
    (document.fonts?.ready || Promise.resolve())
      .then(() => report('fonts'))
      .catch(() => report('fonts'))
  );

  // 3D models warm
  if (typeof window !== 'undefined' && typeof window.__warmModels === 'function') {
    tasks.push(
      window.__warmModels()
        .then(() => report('models'))
        .catch(() => report('models'))
    );
  } else {
    report('models');
  }

  await Promise.all(tasks);
  return true;
}

/** Check if player has already viewed the prologue intro. */
export function hasSeenPrologue() {
  try {
    return localStorage.getItem(PROLOGUE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mark prologue intro as seen. */
export function markPrologueSeen() {
  try {
    localStorage.setItem(PROLOGUE_SEEN_KEY, '1');
  } catch {
    // Ignore incognito storage error
  }
}

/**
 * Controller for the Prologue Intro cinematic overlay.
 * Features:
 * 1. Fixed, non-moving narrative card positioned to leave artwork focal points unobstructed.
 * 2. Continuous upward text crawling within the fixed box, paced for comfortable reading.
 * 3. 5 sequential unique scenes with synchronized camera panning & cross-fades.
 * 4. Dual landscape/portrait responsive geometry.
 * 5. Double-click & 650ms long-press skip once background buffering completes.
 */
export class PrologueIntroController {
  constructor(options = {}) {
    this.options = options;
    this.root = document.getElementById('prologueIntro');
    this.scenesContainer = document.getElementById('prologueScenes');
    this.box = document.getElementById('prologueNarrativeBox');
    this.viewport = document.getElementById('prologueCrawlViewport');
    this.content = document.getElementById('prologueCrawlContent');
    this.badgeEl = document.getElementById('prologueBoxBadge');
    this.titleEl = document.getElementById('prologueBoxTitle');
    this.statusEl = document.getElementById('prologueBufferStatus');
    this.skipHintEl = document.getElementById('prologueSkipHint');
    this.dateTagEl = document.getElementById('prologueDateTag');
    this.holdIndicator = document.getElementById('prologueHoldIndicator');
    this.holdCircle = document.getElementById('prologueHoldCircle');

    this.activeSceneIdx = -1;
    this.isBufferComplete = false;
    this.bufferPercent = 0;
    this.destroyed = false;
    this.animRaf = null;

    // Scrolling kinetics (tuned to ~20px/sec for comfortable natural reading)
    this.autoScrollSpeed = 20;
    this.lastFrameTime = 0;
    this.userScrollPauseUntil = 0;

    this.holdStart = 0;
    this.holdRaf = null;
    this.lastTapTime = 0;
  }

  initDOM() {
    if (this.scenesContainer) {
      // 模糊底圖一律用當下節劇照做靜態外推（邊界以外）；運鏡只動框內照片。
      this.scenesContainer.innerHTML = PROLOGUE_SCENES.map((sc, idx) => `
        <div class="prologue-scene-item" id="prologueSceneItem-${idx}" data-idx="${idx}">
          <div class="prologue-bg-blur" style="background-image: url('${sc.img}')"></div>
          <div class="prologue-fg-frame"><div class="prologue-fg-art" style="background-image: url('${sc.img}')"></div></div>
        </div>
      `).join('');
    }

    if (!this.content) return;

    this.content.innerHTML = PROLOGUE_SCENES.map((sc, idx) => `
      <section class="prologue-crawl-section" data-idx="${idx}" id="prologue-crawl-${sc.id}">
        <div class="pcs-chapter-mark">
          <span class="pcs-badge">${sc.badge}</span>
          <span class="pcs-title-inline">▍${sc.title}</span>
        </div>
        <div class="pcs-paras">
          ${sc.paragraphs.map((p) => `<p>${p}</p>`).join('')}
        </div>
      </section>
    `).join('') + `
      <div class="prologue-crawl-end">
        <div class="pce-divider">❖ ❖ ❖</div>
        <p class="pce-note">—— 序幕終曲・歷史檔案解密完畢 ——</p>
        <button id="prologueFinishBtn" class="btn big steel-btn prologue-finish-btn" type="button">
          ▶ 進入戰術終端
        </button>
      </div>
    `;

    document.getElementById('prologueFinishBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.finish();
    });

    this.bindEvents();
  }

  bindEvents() {
    // User manual scroll detection inside the fixed viewport
    const pauseScroll = () => {
      this.userScrollPauseUntil = performance.now() + 3200;
    };

    this.viewport?.addEventListener('wheel', pauseScroll, { passive: true });
    this.viewport?.addEventListener('touchstart', pauseScroll, { passive: true });
    this.viewport?.addEventListener('touchmove', pauseScroll, { passive: true });

    this.viewport?.addEventListener('scroll', () => {
      this.updateSceneState();
    }, { passive: true });

    // Double-click / Double-tap detection
    this.root?.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.trySkip('dblclick');
    });

    this.root?.addEventListener('touchend', (e) => {
      if (e.target.closest('#prologueFinishBtn')) return;
      const now = performance.now();
      if (now - this.lastTapTime < 350) {
        e.preventDefault();
        this.trySkip('doubletap');
      }
      this.lastTapTime = now;
    });

    // Long press detection
    this.root?.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#prologueFinishBtn')) return;
      this.startLongPress(e);
    });

    const cancelLongPress = () => this.cancelLongPress();
    window.addEventListener('pointerup', cancelLongPress);
    window.addEventListener('pointercancel', cancelLongPress);
    window.addEventListener('resize', () => this.updateSceneState());
  }

  startLongPress(e) {
    this.cancelLongPress();
    this.holdStart = performance.now();
    const duration = 650;

    if (this.holdIndicator) {
      this.holdIndicator.classList.add('active');
      const x = Math.max(45, Math.min(window.innerWidth - 45, e.clientX || window.innerWidth / 2));
      const y = Math.max(45, Math.min(window.innerHeight - 45, e.clientY || window.innerHeight / 2));
      this.holdIndicator.style.left = `${x}px`;
      this.holdIndicator.style.top = `${y}px`;
    }

    const step = () => {
      if (this.destroyed) return;
      const elapsed = performance.now() - this.holdStart;
      const progress = Math.min(1, elapsed / duration);

      if (this.holdCircle) {
        const circumference = 2 * Math.PI * 26;
        const offset = circumference * (1 - progress);
        this.holdCircle.style.strokeDashoffset = `${offset}`;
      }

      if (progress >= 1) {
        this.cancelLongPress();
        this.trySkip('longpress');
      } else {
        this.holdRaf = requestAnimationFrame(step);
      }
    };
    this.holdRaf = requestAnimationFrame(step);
  }

  cancelLongPress() {
    if (this.holdRaf) {
      cancelAnimationFrame(this.holdRaf);
      this.holdRaf = null;
    }
    if (this.holdIndicator) {
      this.holdIndicator.classList.remove('active');
    }
    if (this.holdCircle) {
      const circumference = 2 * Math.PI * 26;
      this.holdCircle.style.strokeDashoffset = `${circumference}`;
    }
  }

  trySkip(source) {
    if (!this.isBufferComplete) {
      this.showBufferWarning();
      return;
    }
    this.finish();
  }

  showBufferWarning() {
    if (!this.statusEl) return;
    this.statusEl.classList.add('flash-warn');
    this.statusEl.innerHTML = `<span class="prologue-warn-tag">⚠️ 戰術數據下載中（${this.bufferPercent}%），暫存完成後即可跳過</span>`;
    setTimeout(() => {
      if (!this.destroyed && this.statusEl) {
        this.statusEl.classList.remove('flash-warn');
        this.renderStatus();
      }
    }, 1800);
  }

  renderStatus() {
    if (!this.statusEl || !this.skipHintEl) return;
    if (this.isBufferComplete) {
      this.statusEl.innerHTML = `<span class="prologue-check">✔</span> 戰術數據暫存完成`;
      this.statusEl.classList.add('ready');
      this.skipHintEl.innerHTML = `<span class="prologue-key-badge">雙擊</span> 或 <span class="prologue-key-badge">長按</span> 任意處取消播放`;
      this.skipHintEl.classList.add('unlocked');
    } else {
      this.statusEl.innerHTML = `<span class="prologue-spinner"></span> 數據暫存中 ${this.bufferPercent}%`;
      this.statusEl.classList.remove('ready');
      this.skipHintEl.innerHTML = `雙擊或長按跳過（緩衝下載中…）`;
      this.skipHintEl.classList.remove('unlocked');
    }
  }

  setScene(idx, transformStr) {
    if (idx < 0 || idx >= PROLOGUE_SCENES.length) return;
    const scene = PROLOGUE_SCENES[idx];

    if (this.activeSceneIdx !== idx) {
      this.activeSceneIdx = idx;
      if (this.dateTagEl) this.dateTagEl.textContent = scene.tag;
      if (this.badgeEl) this.badgeEl.textContent = scene.badge;
      if (this.titleEl) this.titleEl.textContent = scene.title;

      const items = this.root?.querySelectorAll('.prologue-scene-item');
      items?.forEach((item, i) => {
        item.classList.toggle('active', i === idx);
      });

      // Update active highlight classes on section elements
      const sections = this.content?.querySelectorAll('.prologue-crawl-section');
      sections?.forEach((sec, i) => sec.classList.toggle('active', i === idx));
    }

    const activeItem = document.getElementById(`prologueSceneItem-${idx}`);
    if (activeItem && transformStr) {
      // 運鏡只動框內照片：邊界框靜止，照片在框內平移/推拉、超出即裁切；
      // 框外模糊底圖用當下劇照靜態外推，不跟運鏡，避免邊界晃動。
      const fg = activeItem.querySelector('.prologue-fg-art');
      if (fg) fg.style.transform = transformStr;
    }
  }

  updateSceneState() {
    if (!this.viewport || !this.content) return;
    const sections = this.content.querySelectorAll('.prologue-crawl-section');
    if (!sections.length) return;

    const scrollTop = this.viewport.scrollTop;
    const viewportH = this.viewport.clientHeight;
    // Reading focus point is located 36% below the top edge of the text box
    const focusY = scrollTop + viewportH * 0.36;

    // 章節之間有 margin 空隙(offsetHeight 不含 margin)：焦點落在空隙時
    // 不可預設回第 0 節(否則每次轉場都閃現第一張圖)，改取最近一節，
    // 空隙內運鏡停在該節邊緣，保持連續不跳閃。
    let targetIdx = (Number.isInteger(this.activeSceneIdx) && this.activeSceneIdx >= 0)
      ? this.activeSceneIdx : 0;
    let secProgress = 0;
    let bestDist = Infinity;

    sections.forEach((sec, idx) => {
      const top = sec.offsetTop;
      const h = sec.offsetHeight;
      if (focusY >= top && focusY <= top + h) {
        targetIdx = idx;
        secProgress = h > 0 ? (focusY - top) / h : 0;
        bestDist = -1;
      } else if (bestDist >= 0) {
        const d = focusY < top ? top - focusY : focusY - (top + h);
        if (d < bestDist) {
          bestDist = d;
          targetIdx = idx;
          secProgress = focusY < top ? 0 : 1;
        }
      }
    });

    const scene = PROLOGUE_SCENES[targetIdx];
    const trans = calcCameraTransform(scene.camera, secProgress);
    this.setScene(targetIdx, trans);
  }

  play(startIdx = 0) {
    if (!this.root) return;
    const n = Math.floor(Number(startIdx));
    const clamped = Number.isFinite(n)
      ? Math.max(0, Math.min(PROLOGUE_SCENES.length - 1, n))
      : 0;
    this.initDOM();
    this.root.style.display = 'flex';
    this.root.classList.remove('prologue-fadeout');
    this.root.classList.add('prologue-active');

    if (this.viewport) this.viewport.scrollTop = 0;

    // Initial scene (supports jumping straight into a middle chapter)
    this.setScene(clamped);
    this.renderStatus();

    // 跳轉到指定章節：把捲動位置移到該節內，使焦點落在該節前段，
    // 之後自動上捲會自然接續後面章節。
    if (clamped > 0) {
      requestAnimationFrame(() => {
        if (this.destroyed || !this.viewport || !this.content) return;
        const sec = this.content.querySelector(`.prologue-crawl-section[data-idx="${clamped}"]`);
        if (sec) {
          const focusTop = sec.offsetTop + sec.offsetHeight * 0.15;
          this.viewport.scrollTop = Math.max(0, focusTop - this.viewport.clientHeight * 0.36);
        }
        this.updateSceneState();
        if (this.activeSceneIdx !== clamped) this.setScene(clamped);
      });
    }

    // Start background buffering
    bufferGameCache((p) => {
      if (this.destroyed) return;
      this.bufferPercent = p.pct;
      if (p.ready) {
        this.isBufferComplete = true;
      }
      this.renderStatus();
    }).then(() => {
      if (!this.destroyed) {
        this.isBufferComplete = true;
        this.bufferPercent = 100;
        this.renderStatus();
      }
    });

    // Start smooth upward crawl animation loop
    this.lastFrameTime = performance.now();
    const frame = (now) => {
      if (this.destroyed) return;
      const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;

      if (now > this.userScrollPauseUntil && this.viewport) {
        const maxScroll = this.viewport.scrollHeight - this.viewport.clientHeight;
        if (this.viewport.scrollTop < maxScroll) {
          this.viewport.scrollTop += this.autoScrollSpeed * dt;
          this.updateSceneState();
        }
      }

      this.animRaf = requestAnimationFrame(frame);
    };
    this.animRaf = requestAnimationFrame(frame);
  }

  finish() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.animRaf) cancelAnimationFrame(this.animRaf);
    this.cancelLongPress();

    markPrologueSeen();

    if (this.root) {
      this.root.classList.add('prologue-fadeout');
      setTimeout(() => {
        if (this.root) {
          this.root.style.display = 'none';
          this.root.classList.remove('prologue-active', 'prologue-fadeout');
        }
        this.options.onFinished?.();
      }, 650);
    } else {
      this.options.onFinished?.();
    }
  }
}

/** Entry function to play prologue if first visit or forced. `startIdx` jumps straight into a middle chapter. */
export function playPrologueIntro({ onFinished, force = false, startIdx = 0 } = {}) {
  if (!force && hasSeenPrologue()) {
    onFinished?.();
    return null;
  }

  const controller = new PrologueIntroController({ onFinished });
  controller.play(startIdx);
  return controller;
}
