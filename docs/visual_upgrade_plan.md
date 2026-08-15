# 畫面升級計畫(2026-08-03 那一輪)—— **已結案,只留編號字典與未量項**

> **這一輪的每一項都已出貨。** 設計與禁令住 `CLAUDE.md` §2.1 F(賽璐璐管線 / 後製 / 描邊寬度 /
> 陰影偏色 / 風化場 / 零件抖動 / 語意化地標 / 世界文字)與各 `tools/audit_*.mjs` 檔頭;
> 逐檔改了什麼住 git 歷史。**本檔只留兩件事**:①程式碼註解引用的 P/V 編號對照表
> ②當輪明講「還沒量」而至今仍沒量的項目。
>
> ⚠ **下一輪的畫面工作看 [`anime_style_plan.md`](anime_style_plan.md),不是本檔。**
> 本檔的做法有數處已被 2026-08-15 的定案取代(見末節「已被取代」),照抄會走回頭路。

## 1. 編號字典(source 註解引用的就是這些)

| 編號 | 題目 | 現在住哪 |
|---|---|---|
| P0-A | 漸層天空穹頂 + 雲 | `environment.js` `skyStops`/`makeSkyDome`/`makeClouds` |
| P0-B | 地形賽璐璐 + 色階梯 + 屬性場 | `terrain.js`(`envMat`/`GROUND_TONES`/`paintTerrainTones`)+ `field.js` |
| P0-C | 螢幕空間勾線 pass | `postfx.js` `INK`;§2.1「後製管線」 |
| P1-A | ramp 家族(2/3/4/soft) | `toon.js RAMPS`/`toonGradient(bands)`;A14 |
| P1-B | 陰影偏色搬進 ramp 查表 | `toon.js` `shadowTintRGB` + `RAMP_HOOK`;§2.1「陰影偏色」 |
| P1-C | 調色 + FXAA | `postfx.js`;`antialias` 只剩 `?post=0` 退路 |
| P1-D | 描邊寬度(世界寬 vs 螢幕下限取大) | `toon.js outlineMaterial`;§2.1「描邊寬度」 |
| P2-A | 風化屬性場 | `field.js bakeFieldTexture` → `toon.setWeatherField` → `celWeatherF()` |
| P2-B | 零件級細節抖動 | `xform.js partId`/`partJitter`;**建物刻意不吃**(見下) |
| P2-C | 語意化地標(擺在兵線/重生點/建築**旁邊**) | `beacons.js` + `biomes.placeBeacons` |
| V-A | 固定機位定場鏡頭組 | `tools/shot_scene.mjs`(`--ink=0/--grade=0/--post=0/--dof=0`) |
| V-B | 兵線與結構可通行泛洪 | `tools/audit_traverse.mjs` + `tools/venue_field.mjs` |
| V-C | 數值掃描移出 Playwright | **部分做不到**,見 §3 |
| V-D | 淨空數值檢查 | `audit_traverse.mjs`「淨空」段 |
| V-E | 世界文字 | `worldtext.js` + `biomes.buildWorldSigns`;A37 |

## 2. 三個「當時決定不做」的理由(仍然成立,不要回頭補完)

- **P2-B 刻意排除建物**:建物的足跡**就是**它的碰撞盒(`_losGrid` 上傳的有向盒與網格擠出用的是
  同一份 `hw2`/`hd2`),沒有餘裕可花 ⇒ 抖它就是 A30 的「看得見打不到」。障礙與地標另有宣告半徑
  (`HAZARDS[].r`/`MEGALITHS[].col.r`)且幾何住在裡面,所以它們吃得起 —— 而且兩個消費端都**抖完
  實測**水平外廓,頂出就把那一件退回原樣。
- **P2-C 的「旁邊」是使用者定案**(2026-08-03:兵線 / 重生點 / 建築單位**旁邊**,周遭看得見即可)。
  這一句把「會不會擋兵線」從「稽核要去發現的事」變成「構造保證」—— 落點一律過
  `areaFree(blocked, …, foot + PAD)`,而 `blocked` 本來就帶兵線走廊 17m / 塔位 30m / 主堡 70m。
  改回「放進兵線裡」就要 Overpass + 高程磚才驗得動(V-B 才有的東西)。
- **OSM 建物立面不當第四種錨點**:建物排在植被之後,錨在它上面的 pass 得晚跑,會失去
  `blockArea` 那層保護(樹會長穿電塔)。

## 3. V-C:數值那一半離不開 Playwright,這是結論不是缺工

掃描 ②~⑤(洞口漏天 / 斷面遮擋 / 透視破洞 / 洞內天空佔比)是對**真網格**打
`THREE.Raycaster`,而 three 走 CDN importmap、A2 禁止進 `package.json` ⇒ Node 沒有 three;
用手寫幾何近似等於**把受測物再實作一次**(§2.1),那種稽核會永遠全綠。掃描 ① 同理:覆蓋段的洞
是**打洞的三角形**,不是壓平的高度場(`carveTunnels` 只看得到開放補集)。

真的搬進 Node 的是更要緊的那一半:`venue_field.mjs makeCarvedField` 直接執行
`terrain.js carveTunnels` **原文**,`audit_traverse` 因此泛洪在**開挖後**的地面上。
淨空(V-D)刻意仍讀**天然**地形 ——「這座山蓋不蓋得住頂板」問的是沒被挖過的山。

## 4. 仍然沒量的(當輪自己列的驗收面,至今未關)

- **30 秒穩態幀時間,桌機 + 觸控,前後對照**。整條後製鏈的可行性是由這個數字決定的,而它從
  2026-08-03 起就掛在那裡。`anime_style_plan.md` 每一項新 pass 都會再壓一次同一條線。
- `hazards.js` / `biomes.js` / `models.js` 裡**會寫深度的半透明件**沒有逐一查過(`vfx.js` /
  `castfx.js` 已確認乾淨)—— 勾線 pass 讀深度緩衝,寫深度的粒子/光束會描成雜點。
- 設定頁樣品(`matsample.js`)在開著的時候多吃一個 WebGL context。

## 5. 已被 2026-08-15 定案取代(**照本檔做 = 走回頭路**)

| 本檔原文 | 現況 |
|---|---|
| 「Out of scope:不做 bloom / DoF / motion blur」 | **景深模糊已上線**(狙擊模式,`DOF`/`dofAimBlend`,§2.1)—— 這條禁令只剩「不做 bloom / motion blur」 |
| P1-A「3 階 ramp MUST 逐位元不變」 | `anime_style_plan.md` §0-b 定案**換學派**(累積光 + `smoothstep` 硬切 + HSV 位移),`bands` 語意改成硬度。ramp 逐位元不變那一條隨學派切換一起重寫 |
| P1-B「patch `getGradientIrradiance`」 | 錨點規則仍有效(§2.1「陰影偏色」③),但偏色手法改 HSV 位移 |
| P0-C 的 GLSL「見 `cel-shading-pipeline` skill L3」 | 線條那一半已拆成獨立 SKILL **`anime-line-control`**;`cel-shading-pipeline` 的 L3 現在是打光 |
| 開頭「六支 skill」對照表 | 2026-08-15 重整成九支,對照表見 `anime_style_plan.md` 開頭 |
| 「Gap analysis」表(本檔原有) | **整表刪除** —— 它描述的是 2026-08-03 的落後現況,每一列都已補上,留著只會被讀成現況 |

**仍然成立的那一句**:硬質金屬高光帶、rig 空間 triplanar 塗裝、`bakeContactAO`、
`markShared`/`disposeTree` 生命週期縫、`vegPartXform` 剛體不變式、`RES_GOV` —— 這幾項當時就
**優於參考專案**,兩輪都不要動。
