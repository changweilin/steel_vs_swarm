# 序 6 / ⑦ 音效與 BGM(⑦-1 區域環境音 / ⑦-2 gain-ride 常駐 stem / ⑦-3 多 take + playbackRate 抖動 / ⑦-4 低記憶體階梯;§0-d「補名冊,架構不動」)  (key: seq6-audio)

## 摘要

現況查證屬實:`public/js/audio.js`(690 行)已具雙層、去重窗(`_DEDUP_S`)、聲部上限(`_MAX_VOICES`)、距離剔除、StereoPanner、BGM 串流交叉淡入、程序旋律備援,而且移動床的 gain ride 早就走 `setTargetAtTime`(⇒ 天生 click-free 且幀率無關,序 2 的 `lerpFPS` 不必碰它)。缺的正是計畫列的四件:①沒有**地點**環境音(只有 rotor/engine/wingflap/stomp 四類**移動**床)②移動床沒有濕/乾地面變體、也沒接動畫權重 ③每個事件單檔重複播、無 `playbackRate` 抖動 ④`lowPower` 只擋「播」不擋「載」——`unlock()` 無條件呼叫 `_loadSamples()`,手機(lowPower 預設開)照樣下載並 decode 七個永遠不會播的 SFX buffer,BGM 也照吃 5.6MB 桌機編碼。落地做法:在 audio.js 加一張**純資料名冊 + 一支純函式解析器**(`AMB_BASE`/`AMBIENCE`/`ambienceMix`),量測端接在 game.js 既有的 `_updateMoveAudio` 旁邊,密度查詢**複用既有的 A6 碰撞網格 `this._blockGrid`**(零新索引、零共享 `rnd()`)。新稽核 `audit_audio_layers.mjs` 以執行原文驗名冊/優先序/gain 推導/同相/階梯/授權六段,全部離線可驗。本項純表現層:`data.js`/`sim.js`/`server/**` 一行不動。

## 縫

### Layer 2 樣本名冊(⑦-3 多 take 的落點)
`public/js/audio.js:36`

現行:
```js
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
```

**改成**: 值的型別由 `string` 放寬成 `string | string[]`(2~4 個 take)。單字串一律逐位元同舊制(解析成長度 1 的陣列)。`BGM_MANIFEST`(:47)同步改成逐場景 `{ hi, low }` 兩種編碼,取用只准經新縫 `bgmUrl(name, low)`(⑦-4)。名冊本身仍是純資料 ⇒ 稽核以 `grabConst` 抽真品原文。

### 樣本註冊點(⑦-4 低階階梯唯一落點)
`public/js/audio.js:167`

現行:
```js
  async _loadSamples() {
    for (const [id, url] of Object.entries(SFX_MANIFEST)) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await this._ctx.decodeAudioData(await res.arrayBuffer());
        this._buffers[id] = buf;
      } catch { /* 缺檔/decode 失敗 → 保持 undefined → 合成 fallback */ }
    }
```

**改成**: 最前面加低階早退:`if (this.lowPower) { this._loadBgm(); return; }` —— 低階**整份 SFX 名冊不註冊**(SKILL L5:decoded buffer 才是音效系統的真實成本),BGM 仍載但走 `bgmUrl(name, true)` 的行動版編碼。BGM 那一段(:176~183)拆成 `_loadBgm()` 以便兩條路共用。⚠ 連帶 MUST 改 `setLowPower`(見下一列),否則設定頁把低功耗關掉之後樣本永遠不補載。

### 低功耗開關(補載入路徑)
`public/js/audio.js:149`

現行:
```js
  /** 低功耗切換(與 game.js 共用 svs_lowpower 旗標;main.js 的 setLowPower switch 一併呼叫此處)。
   *  開 → 射擊/爆炸退合成 + 立即靜掉移動環境音;不動 BGM(串流本就低耗)。 */
  setLowPower(on) {
    this.lowPower = !!on;
    if (this.lowPower) this._stopMove();   // 立刻收掉常駐移動聲道
  }
```

**改成**: 補 else 分支:`else if (this._ctx && !this._sfxLoaded) this._loadSamples();`(旗標 `_sfxLoaded` 在 `_loadSamples` 成功走完時置位)。舊制沒有這一條時,加了 ⑦-4 的早退就會變成「關掉低功耗後音效永遠停在合成,而且沒有任何錯誤訊息」。地點床同理:低階不註冊,關掉低功耗才補建。

### 統一播放閘(去重窗 + 聲部上限;⑦-3 MUST NOT 動它)
`public/js/audio.js:347`

現行:
```js
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
```

**改成**: **一行不改**,但 `_DEDUP_S = 0.045`(:24)與 `_MAX_VOICES = 24`(:21)由稽核釘死現值。多 take 的變化只發生在**跨去重窗之間**,MUST NOT 為了「聽得出有多個 take」把去重窗放寬——那會把齊射的收斂拿掉,直接回到一牆噪音。樣本存在性判斷 `this._buffers[id]` 改成陣列判空。

### 樣本播放(⑦-3 take 選擇 + playbackRate 抖動落點)
`public/js/audio.js:376`

現行:
```js
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
```

**改成**: `this._buffers[id]` 成為陣列 ⇒ 逐次挑一個 take(`Math.random()`,不重複上一次:記 `this._lastTake.get(id)`);`src.playbackRate.value = 1 + (Math.random() * 2 - 1) * _RATE_JIT`(`_RATE_JIT` 新常數,MUST ∈ [0.05, 0.10] = 計畫的 ±5~10%)。⚠ `_count` 的時長 MUST 除以 rate(`Math.min(src.buffer.duration / rate, 2)`)—— 不除的話聲部計數提早/延後釋放,`_MAX_VOICES` 靜默漂掉。`Math.random()` 在此**不違反 A4**:那條管的是確定性散布路徑(世界佈局),而 take 選擇是逐事件、純客戶端、不進任何共享 `rnd()` 序列;同檔 `_buildNoise()`(:190)已是先例。稽核釘死 audio.js 的 `Math.random()` 只准出現在這三處。

### 移動床基準音量表(⑦-2 兩種地面變體的落點)
`public/js/audio.js:29`

現行:
```js
// 移動環境音(程序循環;每類別僅 1 個常駐聲道 = 最多 4 聲道,低功耗全關)。
// 各類別基準音量(壓得比開火/爆炸低,只當「戰場在動」的環境床)。
const _MOVE = { rotor: 0.5, engine: 0.42, wingflap: 0.34, stomp: 0.5 };
```

**改成**: `stomp` 拆成乾/濕兩個增益(`stomp` / `stomp_wet`),表補一列。⚠ 拆的是**增益**不是聲道 —— 見下一列的單一 LFO 紀律。

### 移動床常駐聲道(⑦-2「sync 同相」的結構保證所在)
`public/js/audio.js:583`

現行:
```js
    } else {                                          // stomp 重機具震地:極低頻轟隆 + 慢震(踏步/履帶)
      const n = this._noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 95;
      n.connect(lp); n.start(); chopped(lp, 'sine', 2.6, true);
    }
```

**改成**: stomp 改成**一顆 LFO 驅動兩條鏈**:同一個 `lfo` 同時開合乾床(低通 95Hz)與濕床(帶通 ~300Hz + 較短衰減 = 踩水聲)的 chop gain,兩條各接自己的 `gainDry`/`gainWet` 再匯進 `v.g`。**「同相」因此是構造保證而不是一段同步程式** —— 參考專案用 `sync` 旗標讓兩個檔案跑同一個時鐘,本專案是程序 loop ⇒ 共用同一顆振盪器就是更強的同一件事,而且不可能漂。⚠ MUST NOT 為濕床另建第二顆 LFO 或第二個 `_moveVoice`:那正是計畫要解的「走進水裡會踏空一拍」。`chopped()`(:564)需回傳 chop 節點供第二條鏈掛載。

### 移動床 gain ride(已 click-free、已幀率無關;地點床沿用同一寫法)
`public/js/audio.js:590`

現行:
```js
  /** 每幀由 game.js 呼叫:gain 為 0..1「存在感」(距離×密度×移動),此處乘上類別基準音量
   *  (_MOVE = 各類別響度的單一調校縫);gain≈0 時不會硬建聲道。 */
  setMove(cat, gain, pan = 0, rate = 1) {
    if (this._dead || !this._ctx || this.lowPower) return;
    const v = gain > 0.002 ? this._moveVoice(cat) : this._move[cat];
    if (!v) return;
    const t = this._ctx.currentTime;
    v.g.gain.setTargetAtTime(Math.max(0.0001, _clamp(gain, 0, 1) * (_MOVE[cat] || 0.4)), t, 0.14);
    if (v.sp) v.sp.pan.setTargetAtTime(_clamp(pan, -1, 1), t, 0.14);
```

**改成**: 簽章補一格濕度:`setMove(cat, gain, pan, rate, wet = 0)`;`stomp` 時乾床套 `gain × (1 − wet)`、濕床套 `gain × wet` ⇒ **兩者恆和為 gain**(SKILL L2 的 `walk − walkWater` 同一條:不會出現雙重腳步)。其餘類別 `wet` 恆 0 ⇒ 逐位元同舊制。新增 `setAmbience(dists)` 走**同一套** `setTargetAtTime` 寫法(常駐床、MUST NOT `stop()`)。⚠ 地點床 MUST NOT 走 `_play`:那條路會被去重窗與 `_MAX_VOICES` 吃掉,症狀是「交火最激烈的時候環境音整片消失」。

### 地點環境音名冊 + 純函式解析器(⑦-1 的新縫;本項的核心)
`public/js/audio.js:31`

現行:
```js
const _MOVE = { rotor: 0.5, engine: 0.42, wingflap: 0.34, stomp: 0.5 };

// Layer 2 樣本清單(放進 public/audio/ 即自動啟用;缺檔則走程序合成)。
```

**改成**: 在 `_MOVE` 之後、`SFX_MANIFEST` 之前插入一段**連續**區塊(供稽核 `grabBlock('// ---- 地點環境音')` 整段抽出執行):`AMB_BASE = { url:'audio/amb/base.ogg', vol:0.30 }`(恆亮床,**刻意不在 AMBIENCE 裡** —— 它無條件、無球,放進名冊就要為它發明一組永遠成立的 r/m)+ `const AMBIENCE = [...]`(逐列 `{ id, url, vol, r, m }`,**陣列順序 = 優先序**)+ `export function ambienceMix(q)`。解析:`for (const a of AMBIENCE) { const g = _clamp((a.r - (q[a.id] ?? Infinity)) / a.m, 0, 1); if (g > 0) return { id: a.id, g }; } return null;`(first-match-wins,與參考專案逐字同一條)。gain 公式全專案只有這一行。名冊現值(七床):tunnel/water/swamp 三床吃二元查詢(`r:0.5, m:0.5`)、urban/forest 吃密度(`d = 1 − 密度01`,`r/m` 在同一個正規化空間)、camp 吃公尺(`r:34, m:14`)。⚠ `m` 逐床 MUST 不同 —— 那個差別就是「邊界的性格」(城市淡 26m、洞口淡 6m)。

### 每幀量測端(地點床/濕度的唯一量測處)
`public/js/game.js:8314`

現行:
```js
    for (const cat of ['rotor', 'engine', 'wingflap', 'stomp']) {
      const b = best[cat];
      if (!b) { a.setMove(cat, 0, 0, 1); continue; }
      const dist = REF / (REF + b.d);                                  // 距離衰減
      const dens = cl(0.55 + cnt[cat] * 0.14, 0.55, 1);                // 密度:場上越多同類越響
      // 地面型(引擎/踏地)靜止仍有怠速底噪但小;飛行型(旋翼/翅膀)本就常動
      const moveGate = (cat === 'stomp' || cat === 'engine')
        ? cl(0.35 + b.spd * 0.09, 0.35, 1)
        : cl(0.5 + b.spd * 0.05, 0.5, 1);
      const presence = cl(dist * dens * moveGate, 0, 1);               // 0..1;類別基準響度在 audio 端乘
      const hl = Math.hypot(b.dx, b.dz) || 1;
      const pan = cl((e[0] * b.dx + e[2] * b.dz) / hl, -1, 1);
```

**改成**: 三件事。①`b.spd` 改經新的具名存取器 `_moveWeight(ent)`(現階段回 `ent.loco?.amp ?? cl(ent._moveSpd / 6, 0, 1)`),⑥-3 動畫權重向量落地時**只有這一支要換**;②`best[cat]` 多記 `wet`(勝出那一台的 `terrainEnvCode(this.terrain, p.x, p.z) === 1 ? 1 : 0`,只對勝出者算一次),`stomp` 傳 `setMove(..., wet)`;③迴圈後呼叫新的 `this._updatePlaceAudio()`。⚠ 現制 :8303 `if (ent.isSelf || ...) continue` 把**自機排除在移動床之外** ⇒ 計畫講的「走進水裡會踏空一拍」是自己的腳步,不含自機就量不到那個症狀 ⇒ `stomp`/`engine` 兩類 MUST 納入自機(`pan = 0`、`wet` 取 `this._env.ground === 1 ? 1 : 0`,不必再查一次)。這是**刻意的可聽行為改變**,照 ⑧-1 的前例記進計畫的執行紀錄。

### 自機當幀環境(water/swamp 兩床的零成本來源)
`public/js/game.js:7449`

現行:
```js
    this._env = this._envAt();   // 當幀環境(水/沼):移動減速、pos 回報、狀態結算(伺服器)皆讀它
```

**改成**: `_updatePlaceAudio()` 直接讀 `this._env.ground`(0 乾 / 1 水 / 2 沼)當 water/swamp 兩床的查詢值,**不再算第二份** —— `_envAt()` 每幀已經跑過(:3695,規則見 `seams-terrain.md` 的 `terrainEnvCode` 那一列)。tunnel 床同理讀既有的 `this.terrain.tunnelAt(x, z)`。三床合計每幀 0 次新的地形取樣。

### 密度查詢:複用 A6 碰撞網格(urban / forest 兩床,零新索引、零 rnd)
`public/js/game.js:745`

現行:
```js
  _buildBlockGrid(blockers) {
    const C = 64;
    const grid = new Map();
    blockers.forEach((b) => {
      const r = b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r;
      const i0 = Math.floor((b.x - r) / C), i1 = Math.floor((b.x + r) / C);
      const j0 = Math.floor((b.z - r) / C), j1 = Math.floor((b.z + r) / C);
```

**改成**: **MUST NOT 另建第二個索引**。`_updatePlaceAudio` 以同一個 `this._blockGrid`(`C = 64`)算逐格密度:`bld = 該格 b.bld 計數 / URB_FULL`、`tree = 該格 cl === 'tree' 計數 / FOR_FULL`,結果**逐格快取**在 `this._ambDens`(Map,鍵同為 `"i,j"`)⇒ 玩家每走進一個新格才算一次,平時零成本;四鄰格心雙線性內插避免 64m 的硬階梯(那個階梯是聽得出來的)。⚠ 快取 MUST 與 `_blockGrid` **同一處失效**(見下一列),否則碉堡把整個街廓拆掉之後市區床還在響 —— 與「幽靈站立面」同一族的 bug。零共享 `rnd()` 消耗(§2.3):整段只讀既有陣列。

### 碉堡淨空後的索引重建(密度快取的失效點)
`public/js/game.js:3273`

現行:
```js
    if (removed) {
      this._blockGrid = this._buildBlockGrid(this.terrain.blockers || []);   // 碰撞柱與視覺一致(A6)
      this.terrain.rebuildBlockerTops?.();   // 頂面站立索引同步重建(拆掉的樓不留幽靈站立面)
      this.terrain.rebuildClimbs?.();        // 攀爬路線索引同步重建(拆掉的樓不留通往空中的梯子)
    }
```

**改成**: 補一行 `this._ambDens?.clear();   // 地點床密度快取(拆掉的樓不留幽靈市區聲)`。掛在既有的三行旁邊 ⇒ 不新增 main.js 的接線,`terrain` 的對外介面一格未動。

### 授權來源帳(⑦-5 CC0 底線,離線可驗)
`public/audio/README.md:22`

現行:
```js
| 檔案 | 用途 | 來源 |
|---|---|---|
| `bgm/menu.ogg` | 大廳/選單旋律(沉靜豎琴) | OpenGameArt《Meadow Thoughts》— Écrivain(**CC0**) |
| `bgm/battle.mp3` | 戰場旋律(戰鬥主題;無 ogg 版故用 mp3) | OpenGameArt《Battle Theme A》— cynicmusic(**CC0**) |
| `sfx/explosion.ogg` | 大型爆炸(拆塔/坦克/主堡/英雄殉爆) | 《50 CC0 Sci-Fi SFX》`explosion_01.ogg` |
```

**改成**: 這張表從此是**來源帳**不是說明文字:稽核與 `public/audio/**` 的實體檔案做**雙向**比對(表有檔沒有 = 紅、檔有表沒有 = 紅),每一列 MUST 出現 `CC0` 字樣且 MUST NOT 出現 `CC BY`/`-NC`/`BY-SA`。新增地點床七列、行動版 BGM 兩列、多 take 各列。⚠ 這是本項唯一擋得住「最貴的錯」(授權污染整個 repo 的散布條件)的閘,而且完全離線。

## 寫入檔案
- `public/js/audio.js` (edit) — 本項主體:地點床名冊 `AMB_BASE`/`AMBIENCE` + 純函式 `ambienceMix`、`setAmbience`、stomp 乾濕雙鏈(單一 LFO)、`setMove` 補 wet 參數、多 take + `playbackRate` 抖動、`bgmUrl(name, low)`、`_loadSamples` 低階早退與 `setLowPower` 補載入。獨佔,無其他項目會動。
- `tools/audit_audio_layers.mjs` (create) — 新稽核(Ⅰ~Ⅷ 段 + 七支 `--break-*`)。獨佔。
- `public/js/game.js` (edit) — 三處小 hunk:①`_updateMoveAudio`(:8294~8328)接 `_moveWeight()`/`wet`/納入自機/呼叫 `_updatePlaceAudio` ②新增 `_updatePlaceAudio()` + `_ambDens` 密度查詢(複用 `_blockGrid`)③`_clearAroundBunker`(:3273)補一行快取失效。⚠ **本項唯一的高衝突檔** —— 序 3/4(postfx/toon 勾線)、序 5(vfx 落花)、序 7 都可能動 game.js,但那些落在渲染/管線區塊,與 :3273 / :8294 不相鄰。
- `public/audio/README.md` (edit) — 來源帳補列(地點床 ×7、行動版 BGM ×2、多 take 各列)+ 把「這張表是稽核吃的帳」寫進檔頭。獨佔。
- `public/audio/amb/base.ogg` (create) — 恆亮床(風/遠處戰場低頻)。⚠ 本輪**未下載**:CC0 取得清單見 blockedOn;缺檔時 `ambienceMix` 照樣運作、該床靜默(降級不例外)。
- `public/audio/amb/tunnel.ogg` (create) — 洞內(隧道/地下道/明隧道)封閉迴響床。同上,未下載。
- `public/audio/amb/water.ogg` (create) — 涉水床。同上,未下載。
- `public/audio/amb/swamp.ogg` (create) — 沼澤床。同上,未下載。
- `public/audio/amb/urban.ogg` (create) — 市區床(密度驅動)。同上,未下載。
- `public/audio/amb/forest.ogg` (create) — 林地床(密度驅動)。同上,未下載。
- `public/audio/amb/camp.ogg` (create) — 據點床(主堡/砲塔附近的機具低鳴)。同上,未下載。
- `public/audio/bgm/menu-mobile.ogg` (create) — ⑦-4「另一份 mobile BGM 編碼」——由現有 CC0 `menu.ogg`(2.4MB)重編(CC0 允許改作、免署名)。未產出。
- `public/audio/bgm/battle-mobile.mp3` (create) — 同上,由 `battle.mp3`(3.3MB)重編;副檔名維持 mp3 = 全瀏覽器通吃(避開 Safari 的 ogg/opus 坑)。未產出。
- `.claude/rules/verification.md` (edit) — §5.1(續)加一行 `audit_audio_layers` 指令、§5.5 加一列「改了音效 → 跑什麼」。**共用檔,與其他序衝突**;建議合併時最後上。
- `.claude/rules/seams-ui-net.md` (edit) — §2.1 H 補一列「音效層級(地點床 / 移動床 / 事件音 / BGM 階梯)」—— 音效至今**沒有任何 §2.1 列**(規則只散在 audio.js 檔頭與 README),本輪正好補上。**共用檔**。
- `CLAUDE.md` (edit) — §2.1 目錄的 `seams-ui-net.md` 那一列主題名補「音效層級」四個字(一格文字)。**共用檔、全專案最高衝突**;可與上一列一起最後上。
- `docs/anime_style_plan.md` (edit) — 「執行紀錄」追加序 6 那一列(做了什麼 / 用什麼守住 / 留下什麼)+ 記下「自機納入移動床」這個刻意的可聽行為改變。**共用檔**(每一序都會追加自己那一列,但各自是不同行)。

## 步驟
1. 步 0(基準,MUST 先做):`npm run bal > /tmp/bal.base.txt` 與 `npm test > /tmp/test.base.txt` 留檔;`node tools/audit_client_syntax.mjs` 確認起點全綠。本項宣稱「bal/test 逐項不動」,沒有基準就只是宣稱。
2. 步 1(⑦-3,最小、最獨立,先落地驗管線):audio.js 的 `SFX_MANIFEST` 值放寬成 `string | string[]`,加 `_RATE_JIT = 0.07`;`_loadSamples` 逐槽 decode 成陣列;`_play` 的存在性判斷改陣列判空;`_playSample` 挑 take(不重複上一次)+ 設 `playbackRate` + `_count` 除以 rate。此時名冊仍全是單字串 ⇒ **行為逐位元同舊制**(rate 抖動除外),先驗這一點。
3. 步 2(⑦-4 上半):`_loadSamples` 拆出 `_loadBgm()`;加 `bgmUrl(name, low)` 唯一縫與 `BGM_MANIFEST` 的 `{ hi, low }` 兩格;`_loadSamples` 最前面加 `if (this.lowPower) { this._loadBgm(); return; }`;`setLowPower(false)` 補 `_loadSamples()` 補載入 + `_sfxLoaded` 旗標。**MUST 當場手測**:桌機開 → 有樣本;設定頁開低功耗 → 合成;再關掉 → 樣本回來(這一步就是最容易靜默壞掉的那一格)。
4. 步 3(⑦-1 名冊與解析器):audio.js 插入 `// ---- 地點環境音(唯一縫)----` 區塊:`AMB_BASE`、`AMBIENCE`(七列)、`export function ambienceMix(q)`。**MUST 是純的**:不碰 `this`、不碰 THREE/DOM、只用同檔的 `_clamp` ⇒ 稽核才抽得出來丟 `new Function`。此時還沒有任何呼叫端。
5. 步 4(⑦-1 播放端):audio.js 加 `_ambVoice(id)`(惰性建常駐 `HTMLAudioElement` loop,`volume:0`、`loop:true`、`autoplay` 在 `unlock()` 之後;低階只建 `AMB_BASE`)與 `setAmbience(q)`(呼叫 `ambienceMix`,勝出床 ride 到 `vol × g`、其餘 ride 到 0,base 恆在 `AMB_BASE.vol`)。⚠ 常駐床**永不 `pause()`/`stop()`**(那正是「離開再回來,床從頭開始」的病因);`dispose()` 才收。killswitch `?amb=0` 讓 `setAmbience` 整支早退。
6. 步 5(⑦-1 量測端):game.js 新增 `_updatePlaceAudio()` —— 讀 `this._env.ground`(water/swamp)、`this.terrain.tunnelAt`(tunnel)、`this._ambDens` 雙線性密度(urban/forest)、`this.ents` 靜態結構最近距離(camp),組成 `q` 交給 `audio.setAmbience(q)`;在 `_updateMoveAudio` 末尾呼叫。`_clearAroundBunker`(:3273)補 `this._ambDens?.clear()`。
7. 步 6(⑦-2):`chopped()` 回傳 chop 節點;`_moveVoice('stomp')` 改成一顆 LFO 驅動乾/濕兩條鏈;`setMove` 補 `wet` 參數並讓兩床增益恆和為 gain;game.js 加 `_moveWeight(ent)` 具名存取器(現階段 `ent.loco?.amp ?? …`)、`best[cat]` 記 `wet`、`stomp`/`engine` 納入自機(pan 0、wet 取 `this._env.ground === 1`)。
8. 步 7(稽核):寫 `tools/audit_audio_layers.mjs` 的 Ⅰ~Ⅷ 段與七支 `--break-*`。⚠ 逐支 break MUST 在字面替換無效時 `process.exit(1)` 當場失敗(§5.4 ㋑),樣式一律 `\r?\n`;⚠ 檔內 MUST NOT 出現字面 `'/audio/'`(見 risks)。
9. 步 8(授權帳):把七床 + 兩份行動版 BGM + 各多 take 的來源逐列寫進 `public/audio/README.md`,每列標 CC0 與來源網址;跑 Ⅷ 段雙向比對(此時檔案還沒下載 ⇒ Ⅷ 應報「表有檔沒有」為**待補清單**而非紅字,見 audits 說明)。
10. 步 9(回歸):跑 audits 欄全部;`npm run bal` / `npm test` 與步 0 的基準**逐項 diff**;`audit_client_syntax` 必跑(㋖)。
11. 步 10(文件):`.claude/rules/verification.md` 兩處、`.claude/rules/seams-ui-net.md` 一列、根 `CLAUDE.md` §2.1 目錄一格、`docs/anime_style_plan.md` 執行紀錄一列。**MUST 最後做**(共用檔,先做只會多一次 rebase)。
12. 步 11(㋓ 真機):見 audits 的最後三項 —— 音效這一族的正確性有一半只有耳朵驗得到。

## 稽核
- `node tools/audit_audio_layers.mjs`
- `node tools/audit_audio_layers.mjs --break-prio`
- `node tools/audit_audio_layers.mjs --break-base`
- `node tools/audit_audio_layers.mjs --break-margin`
- `node tools/audit_audio_layers.mjs --break-sync`
- `node tools/audit_audio_layers.mjs --break-take`
- `node tools/audit_audio_layers.mjs --break-tier`
- `node tools/audit_audio_layers.mjs --break-licence`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_npc_collide.mjs`
- `node tools/audit_climb.mjs`
- `node tools/audit_layer_block.mjs`
- `node tools/audit_slope_move.mjs`
- `node tools/audit_view_lock.mjs`
- `node tools/audit_spectator_cam.mjs`
- `node tools/audit_gait_anat.mjs`
- `node tools/audit_damp_fps.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `npm run audit:net`
- `node tools/audit_solo_boot.mjs`
- `npm run bal`
- `npm test`
- `node tools/audit_ui_layout.mjs`

## 反向驗證
- `--break-prio` — 壞版: 把 `ambienceMix` 的 first-match-wins `return` 改成累加所有 g > 0 的床(`out[a.id] = g; continue;`),回傳整份 map ⇒ **MUST 紅**: Ⅱ 的「兩床同時在範圍內 ⇒ 只有宣告序在前那一床有增益」與「勝出床至多一床、Σ gain ≤ 1」兩條 MUST 紅。這正是參考專案 symptom 表的『Overlapping zones both play』
- `--break-base` — 壞版: 把 `AMB_BASE.vol` 改成 0(或把 `AMB_BASE` 併進 `AMBIENCE` 當普通一列) ⇒ **MUST 紅**: Ⅲ 的「恆亮床 vol > 0」與 Ⅱ 的「所有床都不在範圍內時仍有聲」MUST 紅 —— 那一床沒了,分區邊界就會被聽成一個洞
- `--break-margin` — 壞版: 把 `AMBIENCE` 每一列的 `m` 統一改成同一個值 ⇒ **MUST 紅**: Ⅲ 的「`m` 至少兩個相異值」MUST 紅(邊界的性格 = 城市淡 26m、洞口淡 6m;全部一樣 = 每個交界聽起來都同一種)
- `--break-sync` — 壞版: 在 `_moveVoice('stomp')` 裡為濕床另建第二顆 `ctx.createOscillator()` 當 chop LFO ⇒ **MUST 紅**: Ⅴ 的「stomp 的 chop LFO 恰一顆、兩條鏈掛同一顆」MUST 紅 —— 這就是「走進水裡踏空一拍」的成因,而兩顆 LFO 在任何靜態斷言上都看不出問題
- `--break-take` — 壞版: 把 `_RATE_JIT` 改成 0 **並**把 `SFX_MANIFEST` 的陣列列改回單字串 ⇒ **MUST 紅**: Ⅵ 的「抖動幅度 ∈ [0.05, 0.10]」與「至少一槽有 2~4 個 take」MUST 紅。另加一條對照:`_DEDUP_S` 與 `_MAX_VOICES` 的現值斷言 MUST **仍綠**(證明 break 咬的是 take/抖動,不是順手把去重窗一起改掉)
- `--break-tier` — 壞版: 拿掉 `_loadSamples` 開頭的 `if (this.lowPower) { this._loadBgm(); return; }` 早退 ⇒ **MUST 紅**: Ⅶ 的「低階整份 SFX 名冊不註冊(早退 MUST 排在 fetch 迴圈之前)」MUST 紅;連帶「`bgmUrl` 恰一處」與「`setLowPower(false)` 有補載入路徑」兩條當對照 MUST 仍綠
- `--break-licence` — 壞版: 往 `public/audio/README.md` 的來源表注入一列 `| sfx/x.ogg | 測試 | 某站(**CC BY 4.0**) |` ⇒ **MUST 紅**: Ⅷ 的「來源帳每一列 MUST 是 CC0」MUST 紅。同段的雙向比對(表有檔沒有 / 檔有表沒有)另以刪除一列的方式各驗一次

## 會靜默壞掉的地方
- **`tools/audit_audio_layers.mjs` 裡寫出字面 `'/audio/'`(前導斜線)會讓 `npm run audit:net` 紅,而訊息完全不相干。** `audit_net_modes.mjs:118` 的 `strayPaths` 正規式是 `/['"`]\/(js|css|assets|audio)\//`,掃的就是 `tools/*.mjs`,紅字寫的是「量測工具 MUST 用 /public/… 絕對路徑」。稽核內一律用 `join(ROOT, 'public', 'audio')` 與不帶前導斜線的 `audio/amb/`。
- **低功耗關掉之後樣本永遠不補載。** ⑦-4 的早退一加,`setLowPower(false)` 若沒補 `_loadSamples()`,音效就永久停在 Layer 1 合成 —— **有聲音、沒有錯誤訊息、每一條既有斷言全綠**,使用者只會說「設定好像沒作用」。這是本項最可能靜默壞掉的一格。
- **地點床誤走 `_play`。** `_play` 有去重窗與 `_MAX_VOICES`;常駐床走它就會在齊射時被丟棄,症狀是「打得最兇的時候環境音消失」。常駐床 MUST 比照 `_moveVoice` 直接掛匯流排、不進 `_active` 計數。
- **`_count()` 沒有除以 `playbackRate`。** rate 抖動 ±7% 之後實際時長變了,聲部計數的釋放時機跟著錯位,`_MAX_VOICES` 在長時間交火後緩慢漂掉(偏保守 ⇒ 音效愈打愈少)。沒有任何錯誤訊息。
- **為了『聽得出多個 take』而放寬 `_DEDUP_S`。** 那會直接回到 SKILL symptom 表的『A volley of fire is a wall of noise』。變化只准發生在跨去重窗之間;稽核把 `_DEDUP_S`/`_MAX_VOICES` 現值釘死正是為了擋這個誘惑。
- **密度快取沒有跟著碰撞柱失效。** 碉堡淨空會 in-place splice `terrain.blockers`;`_ambDens` 不清就會在被拆平的街廓上繼續播市區床 —— 與 `rebuildBlockerTops` 那條「幽靈站立面」同一族,而且更難察覺。
- **64m 密度網格的硬階梯是聽得出來的。** 不做四鄰雙線性內插的話,走過格界會有一次音量跳變;而每一條離線斷言都會過(gain 仍在 [0,1]、優先序仍對)。
- **常駐床的記憶體。** 七床若走 `decodeAudioData` 常駐,以 30s 立體聲 48k 計 ≈ 7 × 11MB PCM;那正是 SKILL L5 說「decoded buffer 才是音效系統的真實成本」的那個坑。⇒ 地點床 MUST 走 `HTMLAudioElement` 串流(與 BGM 同一條路),或把每床壓到 8~12s 無縫 loop 再 decode。實作前 MUST 先定案並寫進 README。
- **稽核若把『名冊檔案存在』當硬斷言,就打破了『無檔亦完整可玩』。** Ⅷ 段對**實體存在的檔**做雙向授權比對;對**名冊宣告但尚未下載**的床只列待補清單、不判紅(否則資產一天沒到,整條 CI 一天紅)。
- **`Math.random()` 進 audio.js 之後被人搬到會影響佈局的地方。** A4 管的是確定性散布路徑,本項的 take/抖動不是;但唯一能防止日後誤用的是把允許的呼叫點釘死(`_buildNoise` / take 挑選 / rate 抖動,恰三處)並斷言 audio.js 不 import `rng.js`。
- **自機納入移動床是可聽的行為改變。** 現制 `_updateMoveAudio` 明確 `continue` 掉 `ent.isSelf`;納入之後玩家會第一次聽到自己的機體。這是計畫 ⑦-2 那句症狀的前提,但仍 MUST 照 ⑧-1 的前例記進執行紀錄,不能當成 bugfix 悄悄帶過。
- **`audio.js` 透過 `mobile.js` 間接 import THREE ⇒ Node 端 import 不了整支。** 稽核 MUST 全程走 `readSrc` + `grabConst`/`grabFn`/`grabBlock` + `new Function`,MUST NOT 改成 `import`(那樣 `--break-*` 一支都咬不到,而且看起來一樣綠)。

## 逐位元中性

"分兩個面向,兩者都要證明而不是宣稱。**權威側 = 嚴格逐位元:**`data.js` / `sim.js` / `server/**` / `test/` 一行不動,改的只有 `public/js/audio.js`(純表現層、伺服器不 import)與 `public/js/game.js` 的三處純渲染迴圈 hunk ⇒ `npm run bal` 與 `npm test` MUST 與步 0 留下的基準**逐項相同**;`balanceFingerprint()` 不變 ⇒ `botPolicy.js` 不過期。相鄰稽核(npc_collide / climb / layer_block / slope_move / view_lock / spectator_cam / gait_anat / damp_fps / gpu_lifecycle)MUST 逐項不動。**表現側 = 旋鈕關即同舊制:**killswitch `?amb=0` 讓 `setAmbience` 整支早退、`_RATE_JIT = 0` 讓 `playbackRate` 恆 1、`SFX_MANIFEST` 的值維持單字串時解析成長度 1 的陣列(挑 take 的 `Math.random()` 對長度 1 的陣列恆回同一顆)、`setMove` 的 `wet` 預設 0 使乾床增益 `gain × (1 − 0) ≡ gain`、非 stomp 類別完全不經過新分支 ⇒ 三個關法任一成立時,聽到的與改制前**逐樣本相同**。⚠ 但**預設開啟的地點床本身就是可聽的新行為**(那是這一項的功能),而「自機納入移動床」更是刻意的行為改變 —— 這兩件事 MUST NOT 包裝成「逐位元中性」。怎麼證:①`bal`/`test` 兩份 diff 空;②`?amb=0` + `_RATE_JIT=0` 下用真瀏覽器錄 30s WAV(`MediaStreamDestination` 接 `_master`)與改制前同一場景同一種子的錄音做 md5 比對(這是唯一真的量得到「同不同」的方法,聽感比對不算)。"

## 卡在
- **七個地點床 + 兩份行動版 BGM 的 CC0 音檔尚未取得(本輪依指示未下載任何東西)。** 缺檔時系統照樣運作(該床靜默、base 頂著),但 ⑦-1 在真機上是聽不出來的 ⇒ 資產到位前這一項只能算「機制完成、內容待補」。建議來源(**逐檔 MUST 到該檔自己的授權頁確認寫著 CC0 / CC0 1.0 / Public Domain,再抄進 README 來源帳**;Freesound 同一個包裡不同檔可以是不同授權,`CC BY` 一個字就污染整個 repo 的散布條件):① **Kenney.nl**(全站 CC0,與 Quaternius 同一準則;`Sci-Fi Sounds`/`Impact Sounds`/`UI Audio` 有可用的低頻床與機具聲)② **OpenGameArt 以 CC0 篩選**(README 既有的兩個 SFX/BGM 來源就是從這裡來的,信任度已驗過)③ **Freesound.org 用 License 篩選器選 Creative Commons 0**(環境床最齊,但**逐檔**授權不同,務必逐檔確認)④ **Tallbeard《Music Loop Bundle》CC0**(README 已列為換 BGM 的備選)。規格:mono、OGG Vorbis ≤ 96kbps、**8~12s 無縫 loop**(見 risks 的記憶體算式)、每床 ≤ 150KB。
- **行動版 BGM 需要重編碼**(`menu.ogg` 2.4MB / `battle.mp3` 3.3MB → 目標各 ≤ 800KB)。CC0 允許改作且免署名,所以不需要另尋來源,但需要主機上有 ffmpeg。⑦-4 的定案是「**另一份編碼**,不是只調低音量」,所以拿同一個檔案降 gain 不算做完。
- **⑦-2 的『動畫權重向量』(計畫 ⑥-3)本輪尚未落地。** 結論是**不阻塞**:`locomotion.js:517-518` 的 `L.ph`(步態相位,嚴格耦合位移=不滑步)與 `L.amp`(0~1.2,已阻尼的步態振幅)今天就存在,等價於權重向量裡「他在不在走路」那一格。做法 = 在 game.js 開一支具名存取器 `_moveWeight(ent)`(現階段回 `ent.loco?.amp ?? cl(ent._moveSpd / 6, 0, 1)`),⑥-3 落地時**只有這一支要換**,呼叫端一行不動 —— 這才是「先用現成的、之後再換縫」,直接散讀 `ent.loco.amp` 就會變成之後要全檔追。
- **兩個需要使用者裁決的問題(建議一併問掉,不要自行定案):**①**自機是否納入移動床** —— 計畫 ⑦-2 講的「走進水裡會踏空一拍」在語意上就是自己的腳步,而現制 `game.js:8303` 明確排除自機。我的建議是納入(僅 stomp/engine、pan 0),但那是玩家第一次聽到自己的機體,屬於可聽的行為改變。②**七床的名冊內容與優先序**(現提案:tunnel > water > swamp > camp > urban > forest,base 恆亮)—— 宣告順序就是規則本身,重排一次就是換一套聽感,值得先確認而不是事後調。
- **共用文件的合併順位。** `.claude/rules/verification.md`、`.claude/rules/seams-ui-net.md`、根 `CLAUDE.md`、`docs/anime_style_plan.md` 四支每一序都會動。建議本項的文件變更排在最後上(步 10),或由整合者統一補;程式碼那五個檔(audio.js / audit_audio_layers.mjs / game.js 三處 hunk / README.md / public/audio/**)之外**沒有任何交集**。
- **順帶查到、但刻意不做的一條(留給使用者決定):`audio.js` 全檔沒有 `visibilitychange` 處理** —— 切到背景分頁時 BGM 與常駐床照樣播(SKILL 明列為「最多人回報的音訊抱怨」;`game.js:2931` 與 `main.js:1943` 已有 `document.hidden` 的先例)。計畫 ⑦ 的四條沒有列它,依「衝突時以計畫為主 + 刻意設計 MUST NOT 自行補完」,本輪**不動**,只回報。
