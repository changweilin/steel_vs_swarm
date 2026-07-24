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
| `sfx/explosion.ogg` | 大型爆炸(拆塔/坦克/主堡/英雄殉爆) | OpenGameArt「50 CC0 Sci-Fi SFX」`explosion_01.ogg` |
| `sfx/explosion_small.ogg` | 小型爆炸/殉爆/地雷/防空攔截 | 同上 `retro_explosion.ogg` |
| `bgm/menu.ogg` | 大廳/選單背景(較沉靜的環境床) | 同上 `loop_ambient_01.ogg` |
| `bgm/battle.ogg` | 戰場背景(機械張力環境床) | 同上 `loop_machine_03.ogg` |

**來源包**:OpenGameArt —《50 CC0 Sci-Fi SFX》(`sci-fi-sfx.zip`,2.4 MB,**CC0**)
<https://opengameart.org/content/50-cc0-sci-fi-sfx>
其餘所有音效(開火五分類 / 命中 / 招式 / UI / 空投…)皆由 Layer 1 程序合成,無需檔案。

BGM 現為 CC0 的**環境床**(sci-fi 機甲戰氛圍),非旋律曲。要換成正式旋律 BGM,把 CC0 曲
覆蓋 `bgm/menu.ogg` / `bgm/battle.ogg` 即可(檔名不變,`audio.js` 免改)。推薦 CC0 曲源:

- Tallbeard Studios《Music Loop Bundle》(200+ 無縫循環,**CC0**)<https://tallbeard.itch.io/music-loop-bundle>
- OpenGameArt「CC0 Music」<https://opengameart.org/content/cc0-music-0>

> Soundimage.org 音質佳但**要求署名**(非 CC0),故本專案未採用;若要用需自行處理署名義務。

---

## 擴充更多音效樣本(選配)

`audio.js` 的 `SFX_MANIFEST` 目前只掛爆炸兩槽。要為其他音效改用樣本:

1. 把 CC0 `.ogg` 放進 `sfx/`(建議 mono、≤ 96 kbps Vorbis、≤ 1 秒 → 每檔數十 KB)。
2. 在 `audio.js` `SFX_MANIFEST` 加一行 `槽名: 'audio/sfx/檔名.ogg'`。

可用槽名(未掛檔者現走程序合成):`impact`(命中)、`supply`(空投)、`crit`(爆擊)、
`missile_launch`(防空發射)、`fire_beam` / `fire_rail` / `fire_lob` / `fire_missile` /
`fire_gun` / `fire_shotgun` / `fire_light_energy` / `fire_light_ballistic`(開火,依 `trajClass` 分類)、
`cast_skill` / `cast_ult`(招式)、`ui_click` / `ui_buy` / `ui_alert`(UI)。

格式建議:OGG Vorbis(串流無 padding、循環無縫、瀏覽器全支援)。BGM 用 OGG 循環曲即可,
`audio.js` 以 `HTMLAudioElement` 串流(不 decode 進 buffer,長曲低功耗)。
