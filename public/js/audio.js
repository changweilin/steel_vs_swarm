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
// 低功耗旗標的唯一真相住 mobile.js(localStorage svs_lowpower;手機未設定過 = 預設開)
import { lowPower } from './mobile.js';

const _MAX_VOICES = 24;      // 同時發聲上限(超過即丟棄新音,防齊射爆量)
const _MAX_DIST = 240;       // 超過此距離的事件音直接剔除(公尺)
const _REF_DIST = 26;        // 增益衰減參考距離
const _DEDUP_S = 0.045;      // 同一音效去重窗(秒)—— 同 tick 多單位齊射收斂成少數聲
const _MASTER_DEF = 0.8;     // 預設主音量
const _SFX_DEF = 0.9;        // 音效相對音量
const _BGM_DEF = 0.42;       // 背景音樂相對音量(壓在音效之下)
const _LS_KEY = 'svs_audio'; // localStorage 設定鍵
// 移動環境音(程序循環;每類別僅 1 個常駐聲道 = 最多 4 聲道,低功耗全關)。
// 各類別基準音量(壓得比開火/爆炸低,只當「戰場在動」的環境床)。
const _MOVE = { rotor: 0.5, engine: 0.42, wingflap: 0.34, stomp: 0.5 };

// Layer 2 樣本清單(放進 public/audio/ 即自動啟用;缺檔則走程序合成)。
// 「音質最吃樣本」的重點槽才掛檔;其餘(命中/招式/UI…)一律程序合成。
// 擴充方式:把 CC0 檔放進對應路徑並在此加一行 —— 見 public/audio/README.md。
const SFX_MANIFEST = {
  explosion: 'audio/sfx/explosion.ogg',         // 大型爆炸(拆塔/坦克/主堡)
  explosion_small: 'audio/sfx/explosion_small.ogg', // 小型爆炸/殉爆/地雷
  // 2026-07-24 開火樣本(使用者定案「一般模式射擊用真實樣本」;皆 CC0《50 Sci-Fi SFX》;
  // 缺檔/低功耗自動退回 Layer 1 合成)。彈道分類(_fireId)命中這些槽即優先播樣本。
  fire_gun: 'audio/sfx/fire_gun.ogg',                 // 重機炮/實彈(shoot_01)
  fire_light_ballistic: 'audio/sfx/fire_light_ballistic.ogg', // 鋼鐵輕武器(shoot_02)
  fire_beam: 'audio/sfx/fire_beam.ogg',               // 定向能光束(retro_laser_02)
  fire_light_energy: 'audio/sfx/fire_light_energy.ogg', // 蜂群雷射(retro_laser_01)
  fire_missile: 'audio/sfx/fire_missile.ogg',         // 導引飛彈/火箭(rocket_01)
};
const BGM_MANIFEST = {
  menu: 'audio/bgm/menu.ogg',      // CC0《Meadow Thoughts》Écrivain(沉靜豎琴)
  battle: 'audio/bgm/battle.mp3',  // CC0《Battle Theme A》cynicmusic(戰鬥旋律;mp3 無 ogg 版)
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
    this._bgmGrace = null;   // 真曲載入寬限計時(逾時仍無檔 → 起程序備援)
    this._proc = null;       // 程序旋律備援引擎(僅真曲缺檔/decode 失敗時運轉)
    this._move = {};         // 移動環境音常駐聲道:cat → { g, sp, rate[] }
    // 低功耗旗標(單一真相 = localStorage svs_lowpower,與 game.js 算圖降階同鍵):
    // 開 = 射擊/爆炸走 Layer 1 合成 + 關閉移動環境音(使用者定案「低功耗用合成音」)。
    // 讀值 MUST 走 mobile.js lowPower() —— 「沒設定過」在手機上要吃「預設開」,
    // 直接比對 localStorage === '1' 會讓手機的預設值失效(音效仍走取樣、環境音仍開)。
    this.lowPower = lowPower();

    // 設定持久化:音效(SFX)/ 音樂(BGM)各自獨立音量與開關;相容舊版單一 {master,muted}
    const saved = this._load();
    if (saved.sfxVol != null) {
      this.sfxVol = _clamp(saved.sfxVol, 0, 1);
      this.bgmVol = _clamp(saved.bgmVol ?? _BGM_DEF, 0, 1);
      this.sfxOn = saved.sfxOn ?? true;
      this.bgmOn = saved.bgmOn ?? true;
    } else {                                   // 舊版 master/muted → 拆成雙聲道(音效沿用 master、音樂取預設)
      const m = saved.master ?? _MASTER_DEF, on = !(saved.muted ?? false);
      this.sfxVol = m; this.bgmVol = _BGM_DEF; this.sfxOn = on; this.bgmOn = on;
    }

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
    try { localStorage.setItem(_LS_KEY, JSON.stringify({ sfxVol: this.sfxVol, bgmVol: this.bgmVol, sfxOn: this.sfxOn, bgmOn: this.bgmOn })); } catch { /* 私密模式忽略 */ }
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
    clearTimeout(this._bgmGrace);
    this._procStop();
    for (const b of Object.values(this._bgm)) { try { b.el.pause(); } catch { /* noop */ } }
    try { this._ctx?.close(); } catch { /* noop */ }
    this._dead = true;
  }

  // ---- 音量/開關(音效 SFX 與 音樂 BGM 各自獨立)----
  setSfx(v) { this.sfxVol = _clamp(v, 0, 1); this._applyVolume(); this._save(); }
  setBgm(v) { this.bgmVol = _clamp(v, 0, 1); this._applyVolume(); this._save(); }
  setSfxOn(on) { this.sfxOn = !!on; this._applyVolume(); this._save(); }
  setBgmOn(on) {
    this.bgmOn = !!on; this._save();
    // 音樂開關要真正啟停當前曲(播放/暫停由 _applyScene 的交叉淡出處理)
    if (this._unlocked && this._scene) this._applyScene(this._scene);
    else this._applyVolume();
  }
  /** 低功耗切換(與 game.js 共用 svs_lowpower 旗標;main.js 的 setLowPower switch 一併呼叫此處)。
   *  開 → 射擊/爆炸退合成 + 立即靜掉移動環境音;不動 BGM(串流本就低耗)。 */
  setLowPower(on) {
    this.lowPower = !!on;
    if (this.lowPower) this._stopMove();   // 立刻收掉常駐移動聲道
  }
  _applyVolume() {
    if (this._master) this._master.gain.value = 1;               // 主匯流排恆 1,音量各聲道自理
    if (this._sfx) this._sfx.gain.value = this.sfxOn ? this.sfxVol : 0;
    // BGM 走 HTMLAudioElement,單獨套音量(串流不經 WebAudio 匯流排)
    for (const [name, b] of Object.entries(this._bgm)) {
      if (b.ok) b.el.volume = (name === this._scene && this.bgmOn) ? this.bgmVol : 0;
    }
    // 程序旋律備援走 WebAudio 匯流排,音量跟 BGM 聲道一起走
    if (this._proc && this._ctx) this._proc.out.gain.setTargetAtTime(this.bgmOn ? this.bgmVol : 0, this._ctx.currentTime, 0.15);
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
    // 交叉淡出:目標曲淡入至音樂音量,其餘淡出至 0
    clearInterval(this._bgmFade);
    clearTimeout(this._bgmGrace);
    const target = this.bgmVol;
    const fileOk = this._bgm[name]?.ok;
    // 程序備援:真曲就緒或關音樂 → 收掉;真曲尚未就緒 → 給寬限,逾時仍無檔才起備援
    // (避免正常載入期間先響一下合成旋律再被真曲蓋掉;缺檔/decode 失敗才真的頂上)。
    if (fileOk || !this.bgmOn) this._procStop();
    else this._bgmGrace = setTimeout(() => {
      if (this._scene === name && !this._bgm[name]?.ok && this.bgmOn && this._unlocked) this._procStart(name);
    }, 1400);
    for (const [n, b] of Object.entries(this._bgm)) {
      if (!b.ok) continue;
      if (n === name && this.bgmOn) { b.el.play().catch(() => {}); }
    }
    this._bgmFade = setInterval(() => {
      let done = true;
      for (const [n, b] of Object.entries(this._bgm)) {
        if (!b.ok) continue;
        const want = (n === name && this.bgmOn) ? target : 0;
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
    // 低功耗 = 一律走 Layer 1 合成(所有樣本槽都有對應合成 case,故必有聲);一般模式有樣本優先。
    if (!this.lowPower && this._buffers[id]) this._playSample(id, gain, pan);
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

  // ================= 移動環境音(程序循環)=================
  // 連續/週期音,不同於一次性事件音:每類別只建「一個常駐聲道」(rotor/engine/wingflap/stomp),
  // 靠 game.js 每幀挑「最近的移動源」餵 setMove(音量/平移/速率)—— 靜止則音量歸零(聲道續存)。
  // 全部程序合成 loop(無縫、音高隨速度變、最多 4 聲道),比一次性樣本更適合連續音且更省。

  /** 取得/惰性建立某類別的常駐聲道;低功耗時不建。回傳 { g, sp, rate[] }。 */
  _moveVoice(cat) {
    if (this._dead || !this._ctx || this.lowPower) return null;
    if (this._move[cat]) return this._move[cat];
    const ctx = this._ctx;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    let sp = null;
    if (ctx.createStereoPanner) { sp = ctx.createStereoPanner(); sp.pan.value = 0; g.connect(sp); sp.connect(this._sfx); }
    else g.connect(this._sfx);
    const rate = [];   // { p: AudioParam, base } —— setMove 依速度縮放(引擎轉速/葉片斬波速)
    // 斬波器:噪源經帶通後,用 LFO 對增益做 0↔1 開合(旋翼葉片拍擊/振翅/履帶震動的節奏感)
    const chopped = (srcFilter, lfoType, lfoHz, addRate) => {
      const chop = ctx.createGain(); chop.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.type = lfoType; lfo.frequency.value = lfoHz;
      const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(chop.gain);
      srcFilter.connect(chop); chop.connect(g); lfo.start();
      if (addRate) rate.push({ p: lfo.frequency, base: lfoHz });
    };
    if (cat === 'engine') {                          // 引擎轟鳴:鋸齒基頻 + 低頻噪(穩定不斬波)
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 46;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
      o.connect(lp); lp.connect(g); o.start(); rate.push({ p: o.frequency, base: 46 });
      const n = this._noiseSrc(); const nlp = ctx.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 150;
      const ng = ctx.createGain(); ng.gain.value = 0.45; n.connect(nlp); nlp.connect(ng); ng.connect(g); n.start();
    } else if (cat === 'rotor') {                    // 旋翼:寬噪帶通 + 快速方波斬波(葉片斬)
      const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.7;
      n.connect(bp); n.start(); chopped(bp, 'square', 15, true); rate.push({ p: bp.frequency, base: 520 });
    } else if (cat === 'wingflap') {                 // 振翅:較高空氣感噪 + 較慢正弦斬波(拍翼)
      const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.9;
      n.connect(bp); n.start(); chopped(bp, 'sine', 8, true); rate.push({ p: bp.frequency, base: 1100 });
    } else {                                          // stomp 重機具震地:極低頻轟隆 + 慢震(踏步/履帶)
      const n = this._noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 95;
      n.connect(lp); n.start(); chopped(lp, 'sine', 2.6, true);
    }
    return (this._move[cat] = { g, sp, rate });
  }

  /** 每幀由 game.js 呼叫:gain 為 0..1「存在感」(距離×密度×移動),此處乘上類別基準音量
   *  (_MOVE = 各類別響度的單一調校縫);gain≈0 時不會硬建聲道。 */
  setMove(cat, gain, pan = 0, rate = 1) {
    if (this._dead || !this._ctx || this.lowPower) return;
    const v = gain > 0.002 ? this._moveVoice(cat) : this._move[cat];
    if (!v) return;
    const t = this._ctx.currentTime;
    v.g.gain.setTargetAtTime(Math.max(0.0001, _clamp(gain, 0, 1) * (_MOVE[cat] || 0.4)), t, 0.14);
    if (v.sp) v.sp.pan.setTargetAtTime(_clamp(pan, -1, 1), t, 0.14);
    const r = _clamp(rate, 0.5, 1.8);
    for (const it of v.rate) it.p.setTargetAtTime(it.base * r, t, 0.14);
  }

  /** 低功耗切換或離場:把所有常駐移動聲道靜音(聲道保留,下次再拉起)。 */
  _stopMove() {
    if (!this._ctx) return;
    const t = this._ctx.currentTime;
    for (const v of Object.values(this._move)) v.g.gain.setTargetAtTime(0.0001, t, 0.1);
  }

  // ================= 程序旋律備援 BGM =================
  // 僅在真曲「缺檔 / 取回失敗 / decode 失敗」時頂上(檔在就永不啟動 = 零額外開銷)。
  // 前瞻排程(setInterval 每 30ms 排到 +0.25s):貝斯 + 和弦墊 + 主旋律琶音(+ battle 鼓組)。

  _procStart(mood) {
    if (this._dead || !this._ctx || (this._proc && this._proc.mood === mood)) return;
    this._procStop();
    const ctx = this._ctx;
    const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(this._master);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.bgmOn ? this.bgmVol : 0.0002), ctx.currentTime + 1.5);
    const cfg = mood === 'battle'
      ? { bpm: 128, root: 45, scale: [0, 3, 5, 7, 10], prog: [0, 5, 7, 3], drums: true,  lead: 'sawtooth', pad: 'triangle' }  // A2 小調:緊張
      : { bpm: 74,  root: 48, scale: [0, 2, 4, 7, 9], prog: [9, 5, 0, 7], drums: false, lead: 'triangle', pad: 'sine' };      // C3 大調五聲:沉靜
    const proc = { mood, out, cfg, step: 0, next: ctx.currentTime + 0.08, timer: null };
    proc.timer = setInterval(() => this._procTick(proc), 30);
    this._proc = proc;
  }

  _procStop() {
    const p = this._proc; if (!p) return;
    this._proc = null;
    clearInterval(p.timer);
    try {
      const t = this._ctx.currentTime;
      p.out.gain.cancelScheduledValues(t);
      p.out.gain.setTargetAtTime(0.0001, t, 0.25);
      setTimeout(() => { try { p.out.disconnect(); } catch { /* noop */ } }, 700);
    } catch { /* noop */ }
  }

  _procTick(proc) {
    if (this._dead) { clearInterval(proc.timer); return; }
    const ctx = this._ctx, cfg = proc.cfg;
    const six = 60 / cfg.bpm / 4;                    // 十六分音符秒長
    const ahead = ctx.currentTime + 0.25;
    while (proc.next < ahead) {
      const t = proc.next, s = proc.step;
      const bar = Math.floor(s / 16) % cfg.prog.length;
      const chord = cfg.root + cfg.prog[bar];
      if (s % 16 === 0) for (const iv of [0, 7, 12]) this._procNote(proc, chord + iv, t, six * 15, 0.085, cfg.pad, 0.35);  // 和弦墊
      if (s % 4 === 0) this._procNote(proc, chord - 12, t, six * 3.6, 0.32, cfg.pad, 0.02);                                // 貝斯(每拍)
      if (s % 2 === 0) {                                                                                                    // 主旋律琶音(每八分)
        const deg = cfg.scale[(s / 2 + bar * 2) % cfg.scale.length];
        this._procNote(proc, chord + 12 + deg, t, six * 1.7, 0.12, cfg.lead, 0.01);
      }
      if (cfg.drums) {
        if (s % 4 === 0) this._procDrum(proc, t, 'kick');
        if (s % 4 === 2) this._procDrum(proc, t, 'snare');
        if (s % 2 === 1) this._procDrum(proc, t, 'hat');
      }
      proc.step++; proc.next += six;
    }
  }

  _procNote(proc, midi, t, dur, peak, wave, atk) {
    const ctx = this._ctx;
    const o = ctx.createOscillator(); o.type = wave; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(proc.out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _procDrum(proc, t, kind) {
    const ctx = this._ctx, out = proc.out;
    if (kind === 'kick') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.18);
    } else {                                          // snare / hat 走噪(高通差在轉角頻率與時長)
      const n = this._noiseSrc(); const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = kind === 'snare' ? 1400 : 6000;
      const pk = kind === 'snare' ? 0.15 : 0.05, d = kind === 'snare' ? 0.14 : 0.05;
      const g = ctx.createGain(); g.gain.setValueAtTime(pk, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + d + 0.02);
    }
  }
}
