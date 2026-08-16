# 戰場音效資產(Layer 2:CC0 開源樣本)

音效系統為**雙層**(見 [`../js/audio.js`](../js/audio.js)):

- **Layer 1 程序合成**(Web Audio 原生,零下載/永遠可用)= 天然 fallback,涵蓋**所有**音效類別。
- **Layer 2 CC0 樣本**(本目錄):只在「音質最吃樣本」的重點槽掛檔;`audio.js` 開機 `decodeAudioData`
  成功則優先播,**任何缺檔/取回/decode 失敗都自動退回 Layer 1**,無檔亦完整可玩。

> 授權底線:本目錄一律採 **CC0(公眾領域,免署名)**,與專案 3D 資產(Quaternius CC0)同準則。
> **MUST NOT** 放入需署名(BY)或非商業(NC)的檔案 —— 那會讓整個 repo 的散布條件被污染。

> ⚠ **下面那張表是稽核吃的「來源帳」,不是說明文字。** `tools/audit_audio_layers.mjs` 的
> Ⅷ 段與 `public/audio/**` 的實體檔案做**雙向**比對:①實體存在卻沒有登記 = **紅字**
> ②每一列 MUST 出現 `CC0` 字樣、MUST NOT 出現 `CC BY` / `-NC` / `BY-SA` = **紅字**
> ③登記了但檔案還沒到位 = **待補清單**(不判紅 —— 資產一天沒到、整條 CI 不該一天紅;
> 缺檔時該床靜默、`base` 頂著,系統照常運作)。
> 這是本專案唯一擋得住「最貴的錯」(授權污染整個 repo 的散布條件)的閘,而且完全離線。
> **加任何一個音檔 MUST 同時加一列**,而且 MUST 到該檔**自己的**授權頁確認寫著
> CC0 / CC0 1.0 / Public Domain —— Freesound 同一個包裡不同檔可以是不同授權。

---

## 目前收錄(全部 CC0,免署名)

| 檔案 | 用途 | 來源 |
|---|---|---|
| `bgm/menu.ogg` | 大廳/選單旋律(沉靜豎琴) | OpenGameArt《Meadow Thoughts》— Écrivain(**CC0**) |
| `bgm/battle.mp3` | 戰場旋律(戰鬥主題;無 ogg 版故用 mp3) | OpenGameArt《Battle Theme A》— cynicmusic(**CC0**) |
| `sfx/explosion.ogg` | 大型爆炸(拆塔/坦克/主堡/英雄殉爆) | 《50 CC0 Sci-Fi SFX》`explosion_01.ogg`(**CC0**) |
| `sfx/explosion_small.ogg` | 小型爆炸/殉爆/地雷/防空攔截 | 同上 `retro_explosion.ogg`(**CC0**) |
| `sfx/fire_gun.ogg` | 重機炮/實彈開火 | 同上 `shoot_01.ogg`(**CC0**) |
| `sfx/fire_light_ballistic.ogg` | 鋼鐵輕武器開火 | 同上 `shoot_02.ogg`(**CC0**) |
| `sfx/fire_beam.ogg` | 定向能光束 | 同上 `retro_laser_02.ogg`(**CC0**) |
| `sfx/fire_light_energy.ogg` | 蜂群雷射 | 同上 `retro_laser_01.ogg`(**CC0**) |
| `sfx/fire_missile.ogg` | 導引飛彈/火箭 | 同上 `rocket_01.ogg`(**CC0**) |

---

## 待補(⑦-1 地點床 / ⑦-4 行動版 BGM;**本輪未下載任何檔案**)

名冊已在 `audio.js`(`AMB_BASE` / `AMBIENCE` / `BGM_MANIFEST` 的 `low` 欄)登記,**檔案尚未取得**。
缺檔時系統照常運作:該床靜默、`base` 頂著、BGM 自動退回桌機版編碼(降級不例外)⇒
機制完成、內容待補。取得之後把每一列的「來源」欄從「待補」換成真正的授權頁即可。

| 檔案 | 用途 | 來源 |
|---|---|---|
| `amb/base.ogg` | 恆亮床(風 + 遠處戰場低頻;分區邊界不會被聽成一個洞) | 待補(**CC0**;見下方取得清單) |
| `amb/tunnel.ogg` | 洞內(隧道/地下道/明隧道)封閉迴響床 | 待補(**CC0**) |
| `amb/water.ogg` | 涉水床 | 待補(**CC0**) |
| `amb/swamp.ogg` | 沼澤床 | 待補(**CC0**) |
| `amb/camp.ogg` | 據點床(主堡/砲塔附近的機具低鳴) | 待補(**CC0**) |
| `amb/urban.ogg` | 市區床(建物密度驅動) | 待補(**CC0**) |
| `amb/forest.ogg` | 林地床(樹冠密度驅動) | 待補(**CC0**) |
| `bgm/menu-mobile.ogg` | 大廳 BGM 的**行動版編碼**(由現有 CC0 `menu.ogg` 重編) | 同 `bgm/menu.ogg`(**CC0**,允許改作免署名) |
| `bgm/battle-mobile.mp3` | 戰場 BGM 的**行動版編碼**(由現有 CC0 `battle.mp3` 重編) | 同 `bgm/battle.mp3`(**CC0**,允許改作免署名) |

**地點床規格**(記憶體算式見 `audio.js` `_ambVoice` 檔頭):mono、OGG Vorbis ≤ 96 kbps、
**8~12 秒無縫 loop**、每床 ≤ 150 KB。走 `HTMLAudioElement` **串流**再經
`createMediaElementSource` 接進匯流排 —— **MUST NOT** 改成 `decodeAudioData`:七床各 30 秒
立體聲 48k 是 ≈ 7 × 11 MB 常駐 PCM,而 decoded buffer 才是音效系統的真實成本。

**行動版 BGM 規格**:`menu.ogg` 2.4 MB / `battle.mp3` 3.3 MB → 目標各 ≤ 800 KB。
CC0 允許改作且免署名 ⇒ 不需另尋來源,但需要主機上有 ffmpeg。
⑦-4 的定案是「**另一份編碼**,不是只調低音量」—— 拿同一個檔案降 gain 不算做完。

**CC0 取得清單**(逐檔 MUST 到該檔自己的授權頁確認):
① **Kenney.nl**(全站 CC0,與 Quaternius 同準則;`Sci-Fi Sounds` / `Impact Sounds` / `UI Audio`
有可用的低頻床與機具聲)<https://kenney.nl/assets>
② **OpenGameArt 以 CC0 篩選**(本表既有的 SFX/BGM 就是從這裡來的,信任度已驗過)
<https://opengameart.org/art-search-advanced?field_art_licenses_tid%5B%5D=4949>
③ **Freesound.org** 用 License 篩選器選 `Creative Commons 0`(環境床最齊,但**逐檔**授權不同,
務必逐檔確認 —— `CC BY` 一個字就污染整個 repo 的散布條件)<https://freesound.org>
④ **Tallbeard《Music Loop Bundle》CC0** <https://tallbeard.itch.io/music-loop-bundle>

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
> `stomp` 自 2026-08-16 起是**乾/濕兩條鏈共用一顆 LFO**(⑦-2):走進水裡是交叉淡入不是換聲道,
> 「同相」因此是構造保證。**MUST NOT** 為濕床另建第二顆振盪器或第二個 `_moveVoice` ——
> 那就是「走進水裡會踏空一拍」,而兩顆 LFO 在任何靜態斷言上都看不出問題。

### 多 take(⑦-3)

`SFX_MANIFEST` 的值型別是 `string | string[]`:給一個槽 2~4 個 take,`_playSample` 逐次挑一個
(不重複上一次)並套 ±7%(`_RATE_JIT`)的 `playbackRate` 抖動 ⇒ 齊射不再是同一顆樣本疊七次。
**多 take 的檔案登記方式與單檔相同**:每一個 take 都是上表的一列(`sfx/explosion_a.ogg`、
`sfx/explosion_b.ogg` …),逐列各自標 CC0。
⚠ **MUST NOT 為了「聽得出有多個 take」放寬 `_DEDUP_S`(0.045s)或 `_MAX_VOICES`(24)** ——
那會把齊射的收斂拿掉,直接回到一牆噪音;變化只准發生在**跨去重窗之間**。稽核把這兩個現值釘死。

格式建議:OGG Vorbis(串流無 padding、循環無縫、瀏覽器全支援)。BGM 用 OGG 循環曲即可,
`audio.js` 以 `HTMLAudioElement` 串流(不 decode 進 buffer,長曲低功耗)。
