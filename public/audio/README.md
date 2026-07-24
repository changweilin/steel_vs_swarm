# 戰場音效資產(Layer 2:CC0 開源樣本)

音效系統為**雙層**(見 [`../js/audio.js`](../js/audio.js)):

- **Layer 1 程序合成**(Web Audio 原生,零下載/永遠可用)= 天然 fallback,涵蓋**所有**音效類別。
- **Layer 2 CC0 樣本**(本目錄):只在「音質最吃樣本」的重點槽掛檔;`audio.js` 開機 `decodeAudioData`
  成功則優先播,**任何缺檔/取回/decode 失敗都自動退回 Layer 1**,無檔亦完整可玩。

> 授權底線:本目錄一律採 **CC0(公眾領域,免署名)**,與專案 3D 資產(Quaternius CC0)同準則。
> **MUST NOT** 放入需署名(BY)或非商業(NC)的檔案 —— 那會讓整個 repo 的散布條件被污染。

---

## 目前收錄(全部 CC0,免署名)

| 檔案 | 用途 | 來源 |
|---|---|---|
| `bgm/menu.ogg` | 大廳/選單旋律(沉靜豎琴) | OpenGameArt《Meadow Thoughts》— Écrivain(**CC0**) |
| `bgm/battle.mp3` | 戰場旋律(戰鬥主題;無 ogg 版故用 mp3) | OpenGameArt《Battle Theme A》— cynicmusic(**CC0**) |
| `sfx/explosion.ogg` | 大型爆炸(拆塔/坦克/主堡/英雄殉爆) | 《50 CC0 Sci-Fi SFX》`explosion_01.ogg` |
| `sfx/explosion_small.ogg` | 小型爆炸/殉爆/地雷/防空攔截 | 同上 `retro_explosion.ogg` |
| `sfx/fire_gun.ogg` | 重機炮/實彈開火 | 同上 `shoot_01.ogg` |
| `sfx/fire_light_ballistic.ogg` | 鋼鐵輕武器開火 | 同上 `shoot_02.ogg` |
| `sfx/fire_beam.ogg` | 定向能光束 | 同上 `retro_laser_02.ogg` |
| `sfx/fire_light_energy.ogg` | 蜂群雷射 | 同上 `retro_laser_01.ogg` |
| `sfx/fire_missile.ogg` | 導引飛彈/火箭 | 同上 `rocket_01.ogg` |

**SFX 來源包**:OpenGameArt —《50 CC0 Sci-Fi SFX》(`sci-fi-sfx.zip`,2.4 MB,**CC0**)
<https://opengameart.org/content/50-cc0-sci-fi-sfx>。其餘開火分類(榴彈/軌道砲/散彈/導引/火箭)、
命中/招式/UI/空投,以及**移動環境音**(旋翼/引擎/振翅/重機具震地)皆由 Layer 1 程序合成,無檔。

### 三條音源決策(2026-07-24 定案)
1. **BGM = 真曲 + 程序備援**:上表兩首 CC0 旋律曲為主;若檔案缺/decode 失敗,`audio.js` 的
   **程序旋律引擎**(`_procStart`,和弦墊+貝斯+琶音,battle 另加鼓)頂上 —— 永遠是旋律不是噪音。
   換曲:把 CC0 旋律覆蓋 `bgm/menu.ogg`(ogg)/ `bgm/battle.mp3`(mp3/ogg 皆可,改 `BGM_MANIFEST` 副檔名)。
2. **射擊 = 真實樣本**:上表 5 個 `fire_*` 槽掛 CC0 樣本,`trajClass` 命中即優先播(缺檔退合成)。
3. **移動 = 程序循環**:連續/週期音(旋翼斬波、引擎轟鳴、拍翼、履帶震地)用程序 loop —— 無縫、
   音高隨速度變、每類別僅 1 常駐聲道(≤4),比一次性樣本更省更順。

> **低功耗模式**(設定頁 `低功耗模式` = `svs_lowpower`):射擊/爆炸一律退 Layer 1 合成、移動環境音全關;
> BGM 不受影響(串流本就低耗)。
> 換 BGM 的其他 CC0 曲源:Tallbeard《Music Loop Bundle》(**CC0**)<https://tallbeard.itch.io/music-loop-bundle>、
> OpenGameArt「CC0 Music」<https://opengameart.org/content/cc0-music-0>。
> Soundimage.org 音質佳但**要求署名**(非 CC0),本專案不採用。

---

## 擴充更多音效樣本(選配)

`audio.js` 的 `SFX_MANIFEST` 已掛爆炸 ×2 + 開火 ×5。要為其他音效改用樣本:

1. 把 CC0 `.ogg` 放進 `sfx/`(建議 mono、≤ 96 kbps Vorbis、≤ 1 秒 → 每檔數十 KB)。
2. 在 `audio.js` `SFX_MANIFEST` 加一行 `槽名: 'audio/sfx/檔名.ogg'`。

仍可加掛的槽名(未掛檔者現走程序合成):`impact`(命中)、`supply`(空投)、`crit`(爆擊)、
`missile_launch`(防空發射)、`fire_rail` / `fire_lob` / `fire_shotgun`(其餘開火分類)、
`cast_skill` / `cast_ult`(招式)、`ui_click` / `ui_buy` / `ui_alert`(UI)。
已掛樣本:`explosion` / `explosion_small` / `fire_gun` / `fire_light_ballistic` / `fire_beam` /
`fire_light_energy` / `fire_missile`。開火槽由 `trajClass` 分類(單一縫)。

> 移動環境音(`rotor`/`engine`/`wingflap`/`stomp`)刻意**不吃樣本**:連續/週期音用程序 loop
> 才無縫且可隨速度變音高(見 `audio.js` `_moveVoice`);別把它們改成一次性樣本槽。

格式建議:OGG Vorbis(串流無 padding、循環無縫、瀏覽器全支援)。BGM 用 OGG 循環曲即可,
`audio.js` 以 `HTMLAudioElement` 串流(不 decode 進 buffer,長曲低功耗)。
