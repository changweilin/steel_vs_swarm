// ============ 戰場音效系統(唯一縫)============
// 純客戶端表現層 —— 伺服器/sim 不涉;bal/e2e 天然不受影響。
//
// 雙層架構(比照 models.js 的 MODEL_MANIFEST + 程序生成 fallback):
//   Layer 1 程序合成(Web Audio API 原生,零依賴/零下載/永遠可用)= 天然 fallback。
//   Layer 2 CC0 開源樣本(SFX_MANIFEST / BGM_MANIFEST):decode 成功則優先播,
//           失敗(檔案缺/取回失敗/decode 失敗)就自動退回 Layer 1 —— 無檔亦完整可玩。
//
// 低功耗設計:單一 AudioContext、共用白噪 buffer、BufferSource/合成節點播完即釋放、
//   每音上限(_MAX_VOICES)、同音去重窗(_DEDUP_S)、依距離剔除(_MAX_DIST)+ CPU 端
//   平移/增益(StereoPanner,不用逐音 HRTF PannerNode);長曲 BGM 走 HTMLAudioElement
//   串流(不 decode 進 buffer)。
//
// 武器音效由既有彈道分類縫 trajClass 推導(MUST NOT 手寫逐武器表),與彈道演出同源。
import { trajClass } from './data.js';

// ---- 調校常數(純客戶端手感,非平衡數值;伺服器不 import 本檔) ----
const _MAX_VOICES = 24;      // 同時發聲上限(超過即丟棄新音,防齊射爆量)
const _MAX_DIST = 240;       // 超過此距離的事件音直接剔除(公尺)
const _REF_DIST = 26;        // 增益衰減參考距離
const _DEDUP_S = 0.045;      // 同一音效去重窗(秒)—— 同 tick 多單位齊射收斂成少數聲
const _MASTER_DEF = 0.8;     // 預設主音量
const _SFX_DEF = 0.9;        // 音效相對音量
const _BGM_DEF = 0.42;       // 背景音樂相對音量(壓在音效之下)
const _LS_KEY = 'svs_audio'; // localStorage 設定鍵

// Layer 2 樣本清單(放進 public/audio/ 即自動啟用;缺檔則走程序合成)。
// 「音質最吃樣本」的重點槽才掛檔;其餘(命中/招式/UI…)一律程序合成。
// 擴充方式:把 CC0 檔放進對應路徑並在此加一行 —— 見 public/audio/README.md。
const SFX_MANIFEST = {
  explosion: 'audio/sfx/explosion.ogg',         // 大型爆炸(拆塔/坦克/主堡)
  explosion_small: 'audio/sfx/explosion_small.ogg', // 小型爆炸/殉爆/地雷
};
const BGM_MANIFEST = {
  menu: 'audio/bgm/menu.ogg',
  battle: 'audio/bgm/battle.ogg',
};

const _clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class GameAudio {
  constructor() {
    this._dead = false;      // Web Audio 不可用時全面 no-op(降級不例外)
    this._ctx = null;
    this._master = null;     // 主匯流排 gain
    this._sfx = null;        // 音效匯流排 gain
    this._noise = null;      // 共用白噪 buffer(1s,全噪音音源重用)
    this._buffers = {};      // 已 decode 的樣本 AudioBuffer(缺則 undefined → 合成)
    this._active = 0;        // 目前發聲數(上限管制)
    this._last = new Map();  // 音效去重:id → ctx 時間戳
    this._scene = null;      // 目前 BGM 場景意圖('menu' | 'battle')
    this._unlocked = false;
    this._bgm = {};          // name → { el, ok }
    this._bgmFade = null;    // BGM 淡入淡出計時器

    // 設定(音量/靜音)持久化
    const saved = this._load();
    this.master = saved.master ?? _MASTER_DEF;
    this.muted = saved.muted ?? false;

    // 首次使用者手勢(autoplay 政策)才建/恢復 AudioContext 並啟動 BGM。
    this._onGesture = () => this.unlock();
    window.addEventListener('pointerdown', this._onGesture, { once: false });
    window.addEventListener('keydown', this._onGesture, { once: false });
  }

  // ---- 設定持久化 ----
  _load() {
    try { return JSON.parse(localStorage.getItem(_LS_KEY)) || {}; } catch { return {}; }
  }
  _save() {
    try { localStorage.setItem(_LS_KEY, JSON.stringify({ master: this.master, muted: this.muted })); } catch { /* 私密模式忽略 */ }
  }

  // ---- 生命週期 ----
  /** 首次手勢:建立/恢復 AudioContext、載入樣本、套用當前 BGM 場景 */
  unlock() {
    if (this._dead) return;
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._dead = true; return; }
      try {
        this._ctx = new AC();
        this._master = this._ctx.createGain();
        this._sfx = this._ctx.createGain();
        this._master.connect(this._ctx.destination);
        this._sfx.connect(this._master);
        this._buildNoise();
        this._applyVolume();
        this._loadSamples();
      } catch { this._dead = true; return; }
    }
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    if (!this._unlocked) {
      this._unlocked = true;
      if (this._scene) this._applyScene(this._scene);   // 手勢前設定的場景延後至此播放
    }
  }

  dispose() {
    window.removeEventListener('pointerdown', this._onGesture);
    window.removeEventListener('keydown', this._onGesture);
    clearInterval(this._bgmFade);
    for (const b of Object.values(this._bgm)) { try { b.el.pause(); } catch { /* noop */ } }
    try { this._ctx?.close(); } catch { /* noop */ }
    this._dead = true;
  }

  // ---- 音量/靜音 ----
  setMaster(v) { this.master = _clamp(v, 0, 1); this._applyVolume(); this._save(); }
  toggleMute() { this.muted = !this.muted; this._applyVolume(); this._save(); return this.muted; }
  _applyVolume() {
    const m = this.muted ? 0 : this.master;
    if (this._master) this._master.gain.value = m;
    // BGM 走 HTMLAudioElement,單獨套音量(串流不經 WebAudio 匯流排)
    for (const [name, b] of Object.entries(this._bgm)) {
      if (b.ok) b.el.volume = (name === this._scene && !this.muted) ? this.master * _BGM_DEF : 0;
    }
  }

  // ---- Layer 2 樣本載入(失敗靜默,退合成)----
  async _loadSamples() {
    for (const [id, url] of Object.entries(SFX_MANIFEST)) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await this._ctx.decodeAudioData(await res.arrayBuffer());
        this._buffers[id] = buf;
      } catch { /* 缺檔/decode 失敗 → 保持 undefined → 合成 fallback */ }
    }
    for (const [name, url] of Object.entries(BGM_MANIFEST)) {
      const el = new Audio();
      el.loop = true; el.preload = 'auto'; el.volume = 0;
      el.addEventListener('canplaythrough', () => { this._bgm[name].ok = true; if (this._scene === name && this._unlocked) this._applyScene(name); }, { once: true });
      el.addEventListener('error', () => { this._bgm[name].ok = false; }, { once: true });
      el.src = url;
      this._bgm[name] = { el, ok: false };
    }
  }

  _buildNoise() {
    const sr = this._ctx.sampleRate;
    const buf = this._ctx.createBuffer(1, sr, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  // ================= 對外 API =================

  /** 本地自機開火:以真實武器 def 走精確音色(自身無空間定位) */
  fire(def, slot, side) {
    if (this._dead || !this._ctx) return;
    this._play(this._fireId(def, slot, side), { gain: slot === 'heavy' ? 0.95 : 0.6 });
  }

  /** 遠端事件 → 音效(cam 供距離/平移;youId 用來略過自身已本地播過的音)*/
  onEvent(ev, cam, youId) {
    if (this._dead || !this._ctx) return;
    const e = ev.e;
    // 有座標的事件:模擬 z 北 → three z 南(-ev.z)
    const hasPos = ev.x != null && ev.z != null;
    const spat = hasPos ? this._spatial(cam, ev.x, -ev.z, ev.y) : { gain: 0.85, pan: 0 };
    if (hasPos && !spat) return;   // 太遠,剔除

    switch (e) {
      case 'shot': {
        if (ev.pid === youId) return;                 // 自機已由 fire() 播過
        // 遠端只有 slot/side(無完整 def)→ 依陣營/輕重取通用音色(低功耗)
        const id = ev.slot === 'heavy' ? 'fire_heavy_generic'
          : (ev.side === 'SWARM' ? 'fire_light_energy' : 'fire_light_ballistic');
        this._play(id, spat);
        break;
      }
      case 'plasma':
        if (ev.pid === youId) return;
        this._play(ev.slot === 'heavy' ? 'fire_beam' : 'fire_shotgun', spat);
        break;
      case 'die': {
        const big = ev.kind === 'tower' || ev.kind === 'base' || ev.kind === 'tank'
          || ev.kind === 'heli' || ev.kind === 'bunker';
        if (ev.kind === 'civilian') break;             // 平民倒地不炸
        this._play(big ? 'explosion' : 'explosion_small', spat);
        break;
      }
      case 'boom':                                     // 地雷/防空攔截/自殺機殉爆
        this._play('explosion_small', { gain: spat.gain * _clamp((ev.r || 10) / 12, 0.5, 1.4), pan: spat.pan });
        break;
      case 'cast':                                     // 招式(含自身:cast 事件會回送自己)
        this._play(ev.slot === 'ult' ? 'cast_ult' : 'cast_skill', spat);
        break;
      case 'crit':
        if (ev.pid === youId) this._play('crit', { gain: 0.7, pan: 0 });
        break;
      case 'sam': {                                    // 防空飛彈發射
        const f = ev.from;
        const s2 = f ? this._spatial(cam, f[0], -f[1], 2) : spat;
        if (s2) this._play('missile_launch', s2);
        break;
      }
      case 'airfall':                                  // 空投來襲通報
        this._play('supply', { gain: 0.55, pan: 0 });
        break;
      case 'airdrop':                                  // 開箱
        this._play('supply', spat);
        break;
      case 'buy':                                      // 八軌升級(僅本人)
        if (ev.pid === youId) this._play('ui_buy', { gain: 0.6, pan: 0 });
        break;
      case 'relay':                                    // 偵察脈衝
        this._play('ui_alert', { gain: 0.5, pan: 0 });
        break;
      case 'lock':                                     // 被鎖定警告(僅被鎖者)
        if (ev.tpid === youId) this._play('ui_alert', { gain: 0.55, pan: 0 });
        break;
      default: break;                                  // 其餘事件無音
    }
  }

  /** UI 音效(按鈕/系統)*/
  ui(id) {
    if (this._dead || !this._ctx) return;
    this._play(id === 'buy' ? 'ui_buy' : id === 'alert' ? 'ui_alert' : 'ui_click', { gain: 0.4, pan: 0 });
  }

  /** 背景音樂場景:'menu'(大廳)| 'battle'(戰場)*/
  setScene(name) {
    if (this._dead) return;
    this._scene = name;
    if (this._unlocked) this._applyScene(name);
  }

  _applyScene(name) {
    // 交叉淡出:目標曲淡入至 BGM 音量,其餘淡出至 0
    clearInterval(this._bgmFade);
    const target = this.master * _BGM_DEF;
    for (const [n, b] of Object.entries(this._bgm)) {
      if (!b.ok) continue;
      if (n === name && !this.muted) { b.el.play().catch(() => {}); }
    }
    this._bgmFade = setInterval(() => {
      let done = true;
      for (const [n, b] of Object.entries(this._bgm)) {
        if (!b.ok) continue;
        const want = (n === name && !this.muted) ? target : 0;
        const cur = b.el.volume;
        const nv = cur + _clamp(want - cur, -0.04, 0.04);
        b.el.volume = _clamp(nv, 0, 1);
        if (Math.abs(nv - want) > 0.005) done = false;
        else if (want === 0 && !b.el.paused) b.el.pause();
      }
      if (done) clearInterval(this._bgmFade);
    }, 40);
  }

  // ================= 內部:合成/播放 =================

  /** 依武器分類縫推導開火音色(單一縫,與彈道演出同源)*/
  _fireId(def, slot, side) {
    if (!def) return side === 'SWARM' ? 'fire_light_energy' : 'fire_light_ballistic';
    if (slot !== 'heavy') {
      if (def.fan) return 'fire_shotgun';
      return side === 'SWARM' ? 'fire_light_energy' : 'fire_light_ballistic';
    }
    // 重武器:走五分類彈道
    const tc = trajClass(def);
    if (tc === 'lob') return 'fire_lob';
    if (tc === 'guide') return 'fire_missile';
    if (tc === 'fnf') return 'fire_fnf';
    if (tc === 'line') {
      if (def.type === 'beam') return 'fire_beam';
      if (def.type === 'rail') return 'fire_rail';
      return 'fire_gun';
    }
    if (def.fan) return 'fire_shotgun';   // 扇形電漿(flat + fan)
    return 'fire_heavy_generic';
  }

  /** 空間化:回傳 { gain, pan };太遠回 null */
  _spatial(cam, wx, wz, wy) {
    if (!cam) return { gain: 0.85, pan: 0 };
    const p = cam.position;
    const dx = wx - p.x, dz = wz - p.z, dy = (wy != null ? wy : p.y) - p.y;
    const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
    if (dist > _MAX_DIST) return null;
    const gain = _clamp(_REF_DIST / (_REF_DIST + dist), 0.06, 1);
    // 相機世界右向量 = matrixWorld 第一欄(相機朝 -Z,本地 +X 為右)
    const e = cam.matrixWorld.elements;
    let hl = Math.hypot(dx, dz) || 1;
    const pan = _clamp((e[0] * dx + e[2] * dz) / hl, -1, 1);
    return { gain, pan };
  }

  /** 統一播放閘:去重窗 + 發聲上限,再分派樣本/合成 */
  _play(id, { gain = 1, pan = 0 } = {}) {
    const t = this._ctx.currentTime;
    const last = this._last.get(id) || 0;
    if (t - last < _DEDUP_S) return;         // 去重窗內收斂
    this._last.set(id, t);
    if (this._active >= _MAX_VOICES) return; // 發聲上限
    if (this._buffers[id]) this._playSample(id, gain, pan);
    else this._synth(id, gain, pan);
  }

  /** 匯流排入口:gain → stereoPanner → sfx;回傳 gain 節點供包絡 */
  _bus(pan) {
    const g = this._ctx.createGain();
    let out = g;
    if (this._ctx.createStereoPanner) {
      const sp = this._ctx.createStereoPanner();
      sp.pan.value = pan;
      g.connect(sp); sp.connect(this._sfx); out = sp;
    } else { g.connect(this._sfx); }   // 舊瀏覽器無 StereoPanner:略過平移
    return g;
  }

  _count(dur) {
    this._active++;
    setTimeout(() => { this._active = Math.max(0, this._active - 1); }, dur * 1000 + 60);
  }

  _playSample(id, gain, pan) {
    const src = this._ctx.createBufferSource();
    src.buffer = this._buffers[id];
    const g = this._bus(pan);
    g.gain.value = gain;
    src.connect(g);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* noop */ } };
    src.start();
    this._count(Math.min(src.buffer.duration, 2));
  }

  // ---- Layer 1 程序合成音庫 ----
  _noiseSrc() { const s = this._ctx.createBufferSource(); s.buffer = this._noise; s.loop = true; return s; }

  /** 通用包絡:attack→decay 到 0 */
  _adsr(g, t, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _synth(id, gain, pan) {
    const ctx = this._ctx, t = ctx.currentTime, g = this._bus(pan);
    const P = gain;   // 峰值總量
    switch (id) {
      case 'fire_light_energy': {           // 蜂群輕武器:雷射「啾」
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(320, t + 0.11);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.4;
        o.connect(bp); bp.connect(g); this._adsr(g, t, P * 0.5, 0.005, 0.11);
        o.start(t); o.stop(t + 0.14); this._count(0.16); break;
      }
      case 'fire_light_ballistic': {        // 鋼鐵輕武器:實彈脆響
        const n = this._noiseSrc(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1100;
        n.connect(hp); hp.connect(g); this._adsr(g, t, P * 0.6, 0.002, 0.07);
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.05);
        const og = ctx.createGain(); og.gain.setValueAtTime(P * 0.4, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        o.connect(og); og.connect(this._sfx);
        n.start(t); n.stop(t + 0.09); o.start(t); o.stop(t + 0.07); this._count(0.1); break;
      }
      case 'fire_shotgun': {                // 散彈/電漿扇:寬噪爆
        const n = this._noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.16);
        n.connect(lp); lp.connect(g); this._adsr(g, t, P * 0.8, 0.003, 0.17);
        n.start(t); n.stop(t + 0.2); this._count(0.22); break;
      }
      case 'fire_heavy_generic':
      case 'fire_gun': {                    // 重機炮:低頻砸擊 + 噪
        const n = this._noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
        n.connect(lp); lp.connect(g); this._adsr(g, t, P * 0.85, 0.003, 0.18);
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
        const og = ctx.createGain(); og.gain.setValueAtTime(P * 0.7, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(og); og.connect(this._sfx);
        n.start(t); n.stop(t + 0.22); o.start(t); o.stop(t + 0.22); this._count(0.24); break;
      }
      case 'fire_lob': {                    // 榴彈/迫砲:悶「碰」
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.22);
        o.connect(g); this._adsr(g, t, P * 0.9, 0.004, 0.26);
        const n = this._noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        const ng = ctx.createGain(); ng.gain.setValueAtTime(P * 0.4, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        n.connect(lp); lp.connect(ng); ng.connect(this._sfx);
        o.start(t); o.stop(t + 0.3); n.start(t); n.stop(t + 0.2); this._count(0.32); break;
      }
      case 'fire_beam': {                   // 定向能:電漿嗡鳴
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 520;
        const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 55;
        const lg = ctx.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(o.frequency);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
        o.connect(hp); hp.connect(g); this._adsr(g, t, P * 0.55, 0.01, 0.22);
        o.start(t); o.stop(t + 0.24); lfo.start(t); lfo.stop(t + 0.24); this._count(0.26); break;
      }
      case 'fire_rail': {                   // 超電磁炮:上揚蓄力 + 炸響
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(280, t); o.frequency.exponentialRampToValueAtTime(1600, t + 0.16);
        const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(P * 0.5, t + 0.16); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(og); og.connect(this._sfx);
        const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.7;
        n.connect(bp); bp.connect(g); g.gain.setValueAtTime(0.0001, t); g.gain.setValueAtTime(0.0001, t + 0.15);
        g.gain.exponentialRampToValueAtTime(P * 0.7, t + 0.17); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.start(t); o.stop(t + 0.32); n.start(t + 0.15); n.stop(t + 0.34); this._count(0.36); break;
      }
      case 'fire_fnf':                      // 火箭發射
      case 'fire_missile': {                // 導引飛彈
        const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.28); bp.Q.value = 0.8;
        n.connect(bp); bp.connect(g); this._adsr(g, t, P * 0.7, 0.02, 0.3);
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
        const og = ctx.createGain(); og.gain.setValueAtTime(P * 0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(og); og.connect(this._sfx);
        n.start(t); n.stop(t + 0.34); o.start(t); o.stop(t + 0.24); this._count(0.36); break;
      }
      case 'explosion': {                   // 大型爆炸
        const n = this._noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2000, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.5);
        n.connect(lp); lp.connect(g); this._adsr(g, t, P, 0.004, 0.6);
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
        const og = ctx.createGain(); og.gain.setValueAtTime(P * 0.9, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(og); og.connect(this._sfx);
        n.start(t); n.stop(t + 0.64); o.start(t); o.stop(t + 0.64); this._count(0.66); break;
      }
      case 'explosion_small': {             // 小型爆炸/殉爆
        const n = this._noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(240, t + 0.3);
        n.connect(lp); lp.connect(g); this._adsr(g, t, P * 0.9, 0.003, 0.34);
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.3);
        const og = ctx.createGain(); og.gain.setValueAtTime(P * 0.7, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        o.connect(og); og.connect(this._sfx);
        n.start(t); n.stop(t + 0.36); o.start(t); o.stop(t + 0.36); this._count(0.38); break;
      }
      case 'impact': {                      // 命中金屬叩擊
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 440;
        const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 620;
        o.connect(g); o2.connect(g); this._adsr(g, t, P * 0.5, 0.001, 0.07);
        o.start(t); o.stop(t + 0.08); o2.start(t); o2.stop(t + 0.08); this._count(0.1); break;
      }
      case 'crit': {                        // 爆擊亮響
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1300, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.18);
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 1950;
        const o2g = ctx.createGain(); o2g.gain.setValueAtTime(P * 0.25, t); o2g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g); o2.connect(o2g); o2g.connect(this._sfx); this._adsr(g, t, P * 0.6, 0.002, 0.2);
        o.start(t); o.stop(t + 0.22); o2.start(t); o2.stop(t + 0.14); this._count(0.24); break;
      }
      case 'cast_skill': {                  // 小招:上揚能量湧動
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(760, t + 0.32);
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(480, t); o2.frequency.exponentialRampToValueAtTime(1140, t + 0.32);
        const o2g = ctx.createGain(); o2g.gain.setValueAtTime(P * 0.3, t); o2g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
        o.connect(g); o2.connect(o2g); o2g.connect(this._sfx); this._adsr(g, t, P * 0.6, 0.03, 0.36);
        o.start(t); o.stop(t + 0.4); o2.start(t); o2.stop(t + 0.4); this._count(0.42); break;
      }
      case 'cast_ult': {                    // 大招:厚重和聲 + 次低頻
        for (const [f, gg] of [[220, 0.5], [330, 0.4], [440, 0.3]]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.5, t + 0.6);
          const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(P * gg * 0.6, t + 0.18); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
          o.connect(og); og.connect(lp); lp.connect(this._sfx); o.start(t); o.stop(t + 0.72);
        }
        const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(70, t); sub.frequency.exponentialRampToValueAtTime(45, t + 0.6);
        sub.connect(g); this._adsr(g, t, P * 0.7, 0.02, 0.7); sub.start(t); sub.stop(t + 0.72); this._count(0.74); break;
      }
      case 'missile_launch': {              // 防空飛彈嘶射
        const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.setValueAtTime(800, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3); bp.Q.value = 1;
        n.connect(bp); bp.connect(g); this._adsr(g, t, P * 0.6, 0.02, 0.32);
        n.start(t); n.stop(t + 0.36); this._count(0.38); break;
      }
      case 'ui_click': {                    // UI 點按
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 760;
        o.connect(g); this._adsr(g, t, P * 0.5, 0.001, 0.05); o.start(t); o.stop(t + 0.06); this._count(0.08); break;
      }
      case 'ui_buy': {                      // 升級:兩段上揚
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(620, t); o.frequency.setValueAtTime(930, t + 0.08);
        o.connect(g); this._adsr(g, t, P * 0.55, 0.005, 0.16); o.start(t); o.stop(t + 0.18); this._count(0.2); break;
      }
      case 'ui_alert': {                    // 警報:三連脈衝
        for (let i = 0; i < 3; i++) {
          const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 680;
          const og = ctx.createGain(); const t0 = t + i * 0.12;
          og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(P * 0.4, t0 + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
          o.connect(og); og.connect(this._sfx); o.start(t0); o.stop(t0 + 0.1);
        }
        this._count(0.42); break;
      }
      case 'supply': {                      // 空投提示:柔和兩音
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(520, t); o.frequency.setValueAtTime(690, t + 0.12);
        o.connect(g); this._adsr(g, t, P * 0.45, 0.01, 0.24); o.start(t); o.stop(t + 0.26); this._count(0.28); break;
      }
      default: { try { g.disconnect(); } catch { /* noop */ } break; }
    }
  }
}
