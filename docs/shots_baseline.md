# 序 12(§0-b 賽璐璐學派)定場照基準與 A/B —— md5 全表

> 2026-08-16。`docs/anime_style_plan.md` 序 12(§0-b)的基準照證據面。
> 工作樹 `svs_anime`,`tools/shot_scene.mjs`(Playwright,本機全域安裝)。
> 圖檔本身住 `tools/.shots_scene/w3-{base,now,pre,B}`(`.gitignore` 已含 `tools/.shots_scene/`),本檔只留 md5。
>
> **這一支長期有價值的不是 md5 而是第 2・3 節的兩個拍照陷阱** —— 任何人下一次拿 `shot_scene`
> 做 A/B 都會踩到,而兩者的症狀都是「看起來有人動到了不該動的東西」,
> 然後有人去追一個不存在的 bug。改視覺層之前 MUST 先讀那兩節。

## 0. 四組是什麼

| 目錄 | 程式 | 旋鈕 | 用途 |
|---|---|---|---|
| `w3-base` | **改制前** | 預設 | 步驟 0 的基準(動任何一行程式之前拍的,78 張) |
| `w3-now` | 改制後 | `celSchool` 預設 = a | 逐位元中性的 GPU 層證據 |
| `w3-pre` | **還原出來的改制前**(把窗 3 的每一處編輯反向拿掉) | 預設 | ⚠ 見第 2 節:這一組才是同環境的對照 |
| `w3-B` | 改制後 | `--pref celSchool=b` | School B 的 A/B(65 張) |

拍攝矩陣:taroko(山)× {預設 / `inkMrt=on lutSrc=baked shadowMech=1 shadowEnv=1` /
`--time dusk --elapsed 300` / `--time night`} + shibuya(市)× {預設 / 同上四旋鈕}。每組 13 張。

## 1. 結論

- **School A(預設)逐位元中性**:65/78 張與第一輪基準 md5 **全同**;剩下 13 張(兩組 `-prefs`)見第 2 節,
  已證明**與本輪改動無關**。
- **School B 真的生效**:65/65 張全部與 School A 不同(taroko default / dusk / night / prefs + shibuya default),
  而且 dusk / night 那兩輪的暗側**跟著天色走**(主光色取 three 自己的 `directionalLights[i].color`)。
- **權威層**:`npm run bal` 與窗 2 基準 **diff 0 行**;`npm test` 全綠、零紅字(差異只有隨機化的
  傷害 / 現金 / 稀有度 / PIN 那幾行數字,assertion 本身逐項相同)。

## 2. ⚠ `-prefs` 那一組在本機上**跨進程不穩定**,而且與程式無關

第一輪基準(`w3-base`)之後的**每一次**重拍,`taroko-prefs` 與 `shibuya-prefs` 都有 6~7 張與它不同
(差異像素 0.03~0.56%、max Δ ≤ 72,集中在 aerial / hilltop / mega_orbit_180·270 / spawn_* 這些廣角機位)。

**它不是本輪改動造成的** —— 把窗 3 的每一處編輯**反向拿掉**、還原出一份改制前的 `toon.js`(`w3-pre`)重拍:

| 對照 | 結果 |
|---|---|
| 還原出來的改制前 vs 改制後 A | **13/13 逐位元相同**(taroko-prefs);**13/13 相同**(shibuya-prefs) |
| 還原出來的改制前 vs 第一輪基準 | 6~7 張不同,而且是與「改制後 vs 第一輪基準」**完全同一批** |
| 同一份程式連拍四次(1st-in-batch / 2nd-in-batch / 兩次獨立進程) | 四次**互相全同** |

⇒ 第一輪基準那一次落在另一個環境狀態上(推測是首次啟動瀏覽器時的 GPU / ANGLE 狀態)。
**紀律**:`-prefs`(MRT 勾線 + LUT + 兩根偏色拉桿全開)這一組的 md5 對照 MUST 以
「**同一輪環境下的 pre/post 對拍**」為準,MUST NOT 拿隔了幾十分鐘的第一輪當基準
—— 否則下一個人會把那 6 張讀成「有人動到 School A」,然後去追一個不存在的 bug。

## 3. `--stations meta.json` 回放陷阱(2026-08-17 已修正)

同一個 `--venue` / `--team` 下,`--stations` 回放與不帶它的推導 **13/13 全部不同**(而兩者各自跨進程穩定)。
根因不是場景非決定性,而是舊版 `shot_scene` 在寫 meta 前先對 `p` / `look` 做
`Math.round()`。差不到 0.5m 就足以讓整張圖的線邊一起平移,純視覺 A/B 會把它誤讀成材質改變。

2026-08-17 起 meta 保留完整浮點機位,只有 console 顯示值會四捨五入。新 meta 可用於像素 A/B;
舊 meta 的 `p` / `look` 若全是整數就是已污染基準,MUST 重建而不是繼續回放。

## 4. School B 的量測(taroko,`--pref celSchool=b` vs 預設)

| 機位 | 差異像素 | max Δ | 亮度中位數 A → B | 平均彩度 A → B |
|---|---|---|---|---|
| hilltop | 56.97% | 25 | 74 → 65 | 0.224 → 0.203 |
| aerial | 20.37% | 31 | — | — |
| spawn_SWARM | 10.76% | 20 | 90 → 90 | 0.222 → 0.220 |
| veg_near | 6.19% | 26 | 105 → 105 | 0.436 → 0.435 |
| mega_orbit_90 | 3.05% | 32 | 85 → 85 | 0.261 → 0.261 |
| lane_mid_L1(shibuya) | 2.41% | 33 | 95 → 95 | 0.208 → 0.208 |
| hilltop(`--time night`) | — | — | 36 → 31 | 0.134 → 0.135 |

讀法:**受光面兩派幾乎逐位元相同**(School A 的 ramp 頂階 = 1.0,School B 的 `celCut = 1` ⇒ 同一個值),
差別全部落在**背光面與投影裡**。`bands: 4` 的地形因此最明顯(hilltop 56.97%):
舊制那面坡走的是 4 階裡的中間兩階(0.62 / 0.81),硬切之後整片收成單一的 `SHADOW_V = 0.5`
—— 這正是規格 risks 第 3 條說的「整片山坡回到兩塊色」,也是**使用者裁決③**要看的那一張。

⚠ 現值 `HUE_MIN_A = 1` 的色相位移在畫面上**偏保守**(平均彩度幾乎不動)。
`SHADOW_HUE` 在 a = 1 時的乘數是 `[0.927, 1.003, 1.186]` —— 那是「方向」的長度,不是「濃度」。
拉桿仍可到 3(峰值 ≈ ±16/255)。**下限取多少是使用者裁決②**。

## 5. md5 全表(前 8 碼)

| 組 | 機位 | 基準(改制前,第一輪) | 改制後 A | **改制前重拍(同環境對照)** | School B |
|---|---|---|---|---|---|
| shibuya-default | aerial.png | ce4db892 | ce4db892 | — | 7abd04b4 |
| shibuya-default | edge_far.png | d9030ac6 | d9030ac6 | — | 3321ead7 |
| shibuya-default | edge_wall.png | ac9be3ec | ac9be3ec | — | 1f8f1beb |
| shibuya-default | first_tower_L1.png | a56a052d | a56a052d | — | 91aa2df4 |
| shibuya-default | hilltop.png | c6827ba1 | c6827ba1 | — | 61569ee5 |
| shibuya-default | lane_mid_L1.png | 95e82c86 | 95e82c86 | — | cc4dc858 |
| shibuya-default | mega_orbit_0.png | c7690fff | c7690fff | — | d156cf0c |
| shibuya-default | mega_orbit_180.png | eed6b2f3 | eed6b2f3 | — | 6b596d4c |
| shibuya-default | mega_orbit_270.png | 11222a91 | 11222a91 | — | 85ce9aee |
| shibuya-default | mega_orbit_90.png | 3fbe9026 | 3fbe9026 | — | 86aa8e65 |
| shibuya-default | spawn_STEEL.png | 1daa8c01 | 1daa8c01 | — | 8cd08f7e |
| shibuya-default | spawn_SWARM.png | 569bde55 | 569bde55 | — | 3161fb69 |
| shibuya-default | veg_near.png | 55c92902 | 55c92902 | — | 222702e5 |
| shibuya-prefs | aerial.png | 0cfec96b | c5b10f3b | c5b10f3b | — |
| shibuya-prefs | edge_far.png | 130efd69 | 130efd69 | 130efd69 | — |
| shibuya-prefs | edge_wall.png | 4ba425da | 4ba425da | 4ba425da | — |
| shibuya-prefs | first_tower_L1.png | a660d3c1 | 6fa8062c | 6fa8062c | — |
| shibuya-prefs | hilltop.png | 017ed940 | 3988b76b | 3988b76b | — |
| shibuya-prefs | lane_mid_L1.png | d8c8ecb3 | c230965d | c230965d | — |
| shibuya-prefs | mega_orbit_0.png | e2261781 | e2261781 | e2261781 | — |
| shibuya-prefs | mega_orbit_180.png | e8e98abb | 51aca197 | 51aca197 | — |
| shibuya-prefs | mega_orbit_270.png | 4bd9c09b | 5a215492 | 5a215492 | — |
| shibuya-prefs | mega_orbit_90.png | caafac24 | caafac24 | caafac24 | — |
| shibuya-prefs | spawn_STEEL.png | 7c94db33 | 7c94db33 | 7c94db33 | — |
| shibuya-prefs | spawn_SWARM.png | 2c05adfa | bebf8d56 | bebf8d56 | — |
| shibuya-prefs | veg_near.png | 7e6b9acf | 7e6b9acf | 7e6b9acf | — |
| taroko-default | aerial.png | b467924b | b467924b | — | 88708573 |
| taroko-default | edge_far.png | b02b4c4a | b02b4c4a | — | 9abcacb2 |
| taroko-default | edge_wall.png | 84e6f674 | 84e6f674 | — | fff0ab4f |
| taroko-default | first_tower_L1.png | ed2b8b5f | ed2b8b5f | — | 7595eb1b |
| taroko-default | hilltop.png | a9134974 | a9134974 | — | 26c75c54 |
| taroko-default | lane_mid_L1.png | 0122fb34 | 0122fb34 | — | 59fdfa02 |
| taroko-default | mega_orbit_0.png | 9d5f0e4b | 9d5f0e4b | — | 8fb26445 |
| taroko-default | mega_orbit_180.png | c82cf0cd | c82cf0cd | — | 6aa27c61 |
| taroko-default | mega_orbit_270.png | 53a597ea | 53a597ea | — | 3362f357 |
| taroko-default | mega_orbit_90.png | e47a2f4f | e47a2f4f | — | 41774ce6 |
| taroko-default | spawn_STEEL.png | 76f01efc | 76f01efc | — | d3aa355a |
| taroko-default | spawn_SWARM.png | 8b65fed7 | 8b65fed7 | — | 1e21f19a |
| taroko-default | veg_near.png | 98998d7b | 98998d7b | — | 4177657e |
| taroko-dusk | aerial.png | 56e2ca39 | 56e2ca39 | — | d9d34360 |
| taroko-dusk | edge_far.png | 9c268c62 | 9c268c62 | — | 678933b0 |
| taroko-dusk | edge_wall.png | e8c8a88c | e8c8a88c | — | 246459d4 |
| taroko-dusk | first_tower_L1.png | c74e0a0b | c74e0a0b | — | c9e932c1 |
| taroko-dusk | hilltop.png | 423cae25 | 423cae25 | — | e9d7cdfd |
| taroko-dusk | lane_mid_L1.png | 8e9c9042 | 8e9c9042 | — | 34a1a68a |
| taroko-dusk | mega_orbit_0.png | 88a663ea | 88a663ea | — | 7ef52cf9 |
| taroko-dusk | mega_orbit_180.png | e9e116be | e9e116be | — | 9884be5f |
| taroko-dusk | mega_orbit_270.png | 5d39b95b | 5d39b95b | — | 9b2622b9 |
| taroko-dusk | mega_orbit_90.png | 3b20e574 | 3b20e574 | — | b79b851f |
| taroko-dusk | spawn_STEEL.png | bfed0f2a | bfed0f2a | — | 1585fbc0 |
| taroko-dusk | spawn_SWARM.png | ec0014fa | ec0014fa | — | 98f2575f |
| taroko-dusk | veg_near.png | fb861b19 | fb861b19 | — | e1d682d7 |
| taroko-night | aerial.png | 5e1483ff | 5e1483ff | — | 51418d14 |
| taroko-night | edge_far.png | 7003c9b6 | 7003c9b6 | — | 342a9af8 |
| taroko-night | edge_wall.png | 506a72fd | 506a72fd | — | 8dec8e73 |
| taroko-night | first_tower_L1.png | 01fe3bc4 | 01fe3bc4 | — | 82ed5852 |
| taroko-night | hilltop.png | 1a656398 | 1a656398 | — | 921a8bc5 |
| taroko-night | lane_mid_L1.png | 55855419 | 55855419 | — | 555da85b |
| taroko-night | mega_orbit_0.png | 7a2c92af | 7a2c92af | — | 6979f71a |
| taroko-night | mega_orbit_180.png | 8250ccf0 | 8250ccf0 | — | eebe219c |
| taroko-night | mega_orbit_270.png | 94b93ee1 | 94b93ee1 | — | e441b2e6 |
| taroko-night | mega_orbit_90.png | ab284002 | ab284002 | — | ce7fd458 |
| taroko-night | spawn_STEEL.png | 71e8f52a | 71e8f52a | — | 4b6b7d8e |
| taroko-night | spawn_SWARM.png | dbbf8667 | dbbf8667 | — | 41ff997b |
| taroko-night | veg_near.png | bcb6c02c | bcb6c02c | — | 4eb956b8 |
| taroko-prefs | aerial.png | e33911c5 | 2b99913d | 2b99913d | c4be4d61 |
| taroko-prefs | edge_far.png | 60913d85 | 60913d85 | 60913d85 | 50a8133c |
| taroko-prefs | edge_wall.png | 9ce86b83 | 9ce86b83 | 9ce86b83 | 83b6d7ba |
| taroko-prefs | first_tower_L1.png | 1f074c2b | 1f074c2b | 1f074c2b | b7c8d205 |
| taroko-prefs | hilltop.png | 7d8cb9cc | 801af0ee | 801af0ee | 1956acce |
| taroko-prefs | lane_mid_L1.png | 8e48b8af | 8e48b8af | 8e48b8af | 393509ea |
| taroko-prefs | mega_orbit_0.png | a9e26ec1 | a9e26ec1 | a9e26ec1 | e2ed3379 |
| taroko-prefs | mega_orbit_180.png | 84db1072 | c4deca52 | c4deca52 | 8e554e8c |
| taroko-prefs | mega_orbit_270.png | 522310f5 | 67220ab4 | 67220ab4 | 9711a7be |
| taroko-prefs | mega_orbit_90.png | a9eee187 | a9eee187 | a9eee187 | aff7fc16 |
| taroko-prefs | spawn_STEEL.png | ac5fe98b | 616fd71a | 616fd71a | aa21a202 |
| taroko-prefs | spawn_SWARM.png | 3c2b05a4 | 13812a66 | 13812a66 | b43d6b15 |
| taroko-prefs | veg_near.png | 1d9d189b | 1d9d189b | 1d9d189b | 62d0e7ad |
