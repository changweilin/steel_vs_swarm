# AI 3D Asset Pipeline — Execution Runbook

> **Audience: AI agents.** This is the operational sequel to `docs/ai3d_asset_plan.md`
> (decisions + method split, esp. §8 Appendix A) and the skills
> `.claude/skills/photo-to-prop-forge/` (static contract) / `.claude/skills/mech-part-forge/` (dynamic) /
> **`.claude/skills/photo-to-3d-pipeline/` (the procedure: photo sourcing → route by geometry class →
> img→three.js parts or local Blender GLB → gates)**.
> Read those first; this file tells you **what to run next, where it can run, and how to prove it worked**.
> Update the Status Ledger and Trial Log below as you complete steps — this file is the hand-off state.

---

## 1. Status ledger (update on every completed step)

| Item | Status | Evidence |
|---|---|---|
| P1 seam (`public/js/partlib.js` + `beacons.js` `['lib', name, fallback]` + `main.js warmModels` preload) | **DONE 2026-08-05** | PR #127; `audit_beacons` 68 green, `--break-extent` reverse-red; full audit battery + `npm test` + `npm run bal` green |
| Photo fetcher `tools/ai3d/fetch_photos.mjs` (CC0 double gate, resumable, manifest) | **DONE 2026-08-05** | Same PR |
| Photo DB round 1 (GitHub Actions `fetch-photos.yml`) | **DONE 2026-08-05** | Run 30973968007 success: **35 photos, all CC0/PD**, artifact `photo-db` id 8917619002 (63 MB, expires 2026-09-04) |
| Photo DB gap-fill (parts at 0, see §4 step A) | **DONE 2026-08-05** (3060 local run, not Actions — see Trial Log) | Broadened queries + 3 fetcher fixes; **all 14 parts at target** (55 photos), licence re-audit 55/55 CC0/PD; throttle-cooldown loop needed 3 extra rounds for `lattice`/`tank` |
| Photo DB integrity pass (magic-bytes gate + manifest path portability) | **DONE 2026-08-05** (§5d) | 2 whole PDFs had passed the licence audit as `ok` photos (bytes, not licence, was the lie) — de-booked, deleted, refetched; 28 absolute-path manifest rows migrated to relative POSIX; final audit **61/61 ok = real image + file present + CC0/PD**, all 14 parts at target |
| P2b pilot — LLM-written pure-data parts (regular geometry) | **DONE 2026-08-05** | `tank` (watertower) KIND_PARTS rewritten: 2-segment legs, central riser, 2 X-brace panels ×4 faces, 3 drum ribs; foot 5.2→5.6 (measured 5.56); `audit_beacons` 68 green + `--break-extent` red; `audit_object_joints --seeds 8` 0 anomalies; `npm test` green (fresh worktree server, WS_URL=8666); `npm run bal` **bit-identical** (diff vs pre-change baseline); before/after lane-distance renders with collider overlay |
| P2c pilot — img→3D GLB parts (organic geometry) | **DONE 2026-08-05** (§5e; gate opened same day) | `public/assets/models/parts/rock.glb` shipped: 3 nodes (`collapse_a`/`facet_a`/`facet_b`, 938/882/588 tris) consumed by beacons `cairn` via `['lib', …]`; SF3D measured on the 3060 (peak VRAM 6.17 GB, warm 13.6 s / 2 images); intake 14/14; `audit_beacons` 68 + reverse-red; `audit_object_joints --seeds 8` 21311/0; cel 52 / visual_prefs 124 / gpu 54 / siteplan 168; e2e green; bal green (structurally bit-identical — balance tooling imports neither beacons nor partlib); fallback-vs-lib renders with collider overlay (`tools/shot_beacons.mjs`) |
| biomes consumption-loop seam (`p.lib` field; plan §8 correction 1) | **DONE 2026-08-05** (§5f) | `partGeo(p) = (p.lib && libGeo(p.lib)) \|\| p.g` in `buildVegMeshes` (draw only; no `lib:` rows yet ⇒ frame bit-identical); pinned by `audit_siteplan` Ⅴ (+3 assertions, manual reverse-verify both red modes); full battery green |
| `giantCrownR` GLB-compat (plan §8 correction 1) | **DONE 2026-08-05 — by contract, zero code change** (§5f) | Vertex scan would be a determinism bug (layout ← load state, §2.3); layout math pinned to the fuse `p.g` (audit red if it touches `libGeo`/`partGeo`/`.lib`); intake envelope makes fuse crown radii conservative. Canopy GLBs unblocked |
| 3D 零件對照台 (`tools/parts_review.mjs` + `tools/ai3d/parts_manifest.json` provenance ledger) | **DONE 2026-08-05** (§7) | Settings-page dev tool (`npm run parts`, port 8622); generated-vs-original side by side from the **real** `buildBeacon`; states method + source img per part. Found two silent bugs on first run — see §7 |
| **D-1 static scale-out — 綠地首批(神木樹冠)** | **DONE 2026-08-05** (§5g) | `tree.glb` 12 nodes (4 shapes × size ladder 10/8/7/6/5/4.5/3.5, 212–215 tris each) consumed by **biomes** `GIANT_DEFS` via the `lib:` field — 25 rows across 9 of 11 species; intake extended to the biomes consumer (113 green, reverse-red); `audit_siteplan` 171→174 (both new gates reverse-red); object_joints 21311/0; beacons 68 + reverse-red; soft_stroke 73 / cel 52 / visual_prefs 124 / gpu 54; e2e green (fresh server :8666); `npm run bal` green (⑦f 1.63× unchanged); review board extended to biomes (16 rows, 0 gaps) with side-by-side render |
| **D-2 megalith seam — 巨岩呼叫點守衛 + 首批低面數岩塊** | **DONE 2026-08-05** (§5h) | `biomes.js MEGA_LIB` 名冊 + `megaGeo`(一律 clone,bakeContactAO 就地烤頂點色)5 呼叫點(marble 塊/崩落塊/伴生丘/hoodoo 整柱/疊石);`rock.glb` +3 單位包絡節點 `mega_a/b/c`(284/272/274 tris);`families.megalith` 逐件上限 306 = 4×1071÷14(推導);intake 125 green + bogus-node reverse-red;siteplan 176 + reverse-red;object_joints 21311/0;beacons 68 ± reverse;gpu/cel/visual_prefs/soft_stroke green |
| Photo catalog round 5 — 逐樹種大擴充(使用者定案「大量下載不同樹種」) | **IN PROGRESS 2026-08-05** | +12 tree-species rows / +4 rock kinds / +4 img→3D-friendly building modules;fetcher 改**逐主機**節流 + `excluded_source` 排館藏(§5h)+ 樹種列優先;4 輪抓到 sequoia/baobab/maple/cypress/strata/chimney/rooftank **7 個零件達標**,conifer/pine/willow/banyan/tropical/karst/acunit/dormer 待續 |
| **D-3 逐樹種冠簇拆分(第一步)** | **PARTIAL 2026-08-05** (§5h) | `tree.glb` +6 節點(e/f 兩形 × 3 尺寸階):dougfir/sitka/taiwania 三種原本共用 `canopy_d35` **一顆**,現各有自己的冠形;sequoia/meranti 各多接一列原本無 lib 的 ico。**4 形 → 6 形,不是 11 形** —— 卡在語料而非管線,見 §5h |
| P3 dynamic track (mech slots) | **BLOCKED on agy quota**(2026-08-05 §5h) | t01 七槽兩輪全 429 RESOURCE_EXHAUSTED(gemini-3.1-flash-image);`--no-ref` 也一樣 = 模型級額度。models.js 刻意續留不動(無真零件可校準的縫 = 10× 貴的失敗)。額度重置後:`node tools/ai3d/gen2d.mjs --only t01 --no-ref --limit 7` |
| **D-4 建築族首批 — 屋頂配件桶幾何縫 + families.building 預算量測** | **PARTIAL 2026-08-06** (§5i) | 使用者定案「大量下載不同國家、城市、小鎮、風格的建築物照片,再 img→3D;無視舊有物件直接畫,禁止使用原版重繪」。`families.building` 預算**先量測後生成**(新工具 `measure_building_tris.mjs`,shibuya/manhattan/seoul 三場 --live 實測;InstancedMesh 桶的逐桶節點上限由 instance 上界反推);`building.glb` 首批 2 節點(`chimney_a` 220 tris / `ac_a` 402 tris)接進 `BLD_LIB` + `buildBldBucket` 桶建構表(零 rnd、draw call 不變);照片目錄 +19 列(module + 17 國家/風格整棟列),第 1 輪收 55 張;**tank_a 未出貨**(候選全是場景照/有人入鏡,等 tank_wood 冷卻輪);對照台 + intake + audit_siteplan(184,含反向)+ bal 全綠 |

| **D-5 巨岩族第二批 — 跨國地質岩層/奇石 img→3D + 預算錯帳修正 + 決定性修正** | **PARTIAL 2026-08-06** (§5j) | 使用者定案「大量下載不同國家地區的地質岩層或奇石/巨岩的照片,再進行 img to 3D;無視舊有的物件直接畫,禁止使用原版重繪」。照片目錄 rock 族 +17 列(逐岩型對位 `synthMegalith` 11 型 + 跨國地質/奇石列)且族序提前;5 輪抓到 **69 張**。`rock.glb` +5 節點:`mega_d/e/f`(294 tris,block 名冊 3 → 6)+ **`tower_a`/`mesa_a`(372/371,整座庫節點**,實拍魔鬼塔;新增 tower/mesa 兩個呼叫點,megaGeo 凍結清單 5 → 7)。**兩筆既有錯帳一併修掉**:①`families.megalith` 的分子分母量的不是同一個東西(新工具 `measure_megalith_tris.mjs`:整顆 max 1071 → **3114**、件數 14 → **29**、逐件上限 306 → **430**);②`cliffPlant` 傘色與 `nest` 蛋位/鳥抽的是**共用 `rnd()`** 而那兩支只在 `rockProbe` 量到壁面時才跑 ⇒ 有沒有載到零件庫會走出兩條佈局(§2.3 / A4;實測改前 block 名冊已 1/300 分家,整座型節點上線後 62/300)。intake 170 / siteplan 187(+3,兩條反向驗證逐條紅)/ joints 21516-0 / beacons 68 ± reverse / cel 52 / visual_prefs 124 / gpu 54 / soft_stroke 73;e2e 全綠(fresh server :8666)、`npm run bal` 全綠(⑦f 1.63× 不動);對照台 0 缺件 / 0 孤兒 / 0 未記載來源 |

| **D-6 樹族第二批 — 逐樹種冠形補齊 + 一般植被開族(灌木/闊葉/針葉)+ Quaternius 退場** | **PARTIAL 2026-08-06** (§5k) | 使用者定案「大量下載不同國家地區的不同樹種,如灌木/闊葉林/針葉林/各種大小神木的照片,再進行 img to 3D;無視舊有的物件直接畫,禁止使用原版重繪」+ 追問後定案「**連 Quaternius 一起換掉**」。①照片目錄 tree 族 +26 列(灌木 6 / 闊葉 8 / 針葉 6 / 神木 6,逐列點名國家地區)、族序提前;3 輪抓到 **25 張**後撞上小時級 IP 節流(§5i 同款,3 輪 ×0 張)。②**新工具 `photo_sheet.mjs`**(§5j「人眼先看照片」升格為正式工具):82 張逐張看,語意可用 13 張(~1/6),其中 CGI/館藏/明信片/有人入鏡/浮水印一次擋掉。③`tree.glb` **+18 節點**:神木 9 顆(g/h/i/j/k 五形)⇒ 11 種神木**各有專屬節點名,但不是 11 個專屬形狀**(**2026-08-06 使用者質疑後更正**:`i` 與舊制 `a` 同一張照片、`g` 與舊制 `b` 同一張 ⇒ 11 種實際只對到 **9 張**照片;且 `lib:` 這條縫換不掉骨架,見 §5k),且 klinki/alerce 這兩種**第一次接得上**(冠簇 2.2~3.0m 小於舊制最小節點 3.325 —— 這正是使用者說的「各種**大小**神木」);一般植被 9 顆(bush/vleaf/vcone)。④**`families.veg` 預算先量測後生成**(新工具 `measure_veg_tris.mjs`,四個綠地場地 team 3 實測),且 `whole_factor = 4.0` 這一次是**量出來的**(Quaternius 退場釋出 585,966~1,669,392 tris)。⑤**broadleaf/birch/shrub 退出 `NATURE_MANIFEST`** 改走零件表 + 照片冠簇(掛在名冊裡的型別連 `buildVegMeshes` 都不會被呼叫 ⇒ `lib:` 列會接在沒人看得到的路徑上);silvergrass/deadtree 留著(不在使用者這一輪點名的四類裡,草葉鏤空貼圖 SF3D 生不出來)。intake 234 / siteplan 187 / joints 21516-0 / beacons 68 / cel 52 / visual_prefs 124 / gpu 54 / soft_stroke 73;e2e 全綠(fresh server :8666)、`npm run bal` 全綠(⑦f 1.09× 不動);對照台 0 缺件 / 0 孤兒 / 0 未記載 |

| **D-8 樹族首件 — deadtree 遷零件表 + 整樹節點縫(`whole:`)+ `tree/snag_a` T2 入庫** | **DONE 2026-08-07 夜** (§5u) | 使用者定案「缺口補平當作被砍伐或雷擊損毀,自然的樹木本來就不完美,繼續」⇒ §5t 神木那半的縫 + 預算同輪定案。①**縫 = `VEG_DEFS` 新增 def 層 `whole:`**(整樹節點:lib 載到 ⇒ 這一型只畫那一顆、保險絲零件全藏 —— synthMegalith tower 的資料路徑版;載不到 ⇒ **逐位元**退回 parts;解析仍只經 `partGeo` 三份縫之一);deadtree 退出 `NATURE_MANIFEST`(§5k ⑤ broadleaf 同路,Quaternius DeadTree_1/2 退場)。②**預算先量再開**:uluru(bare 0.95)加入取樣面 —— deadtree instance 上界 **121**(blackforest 僅 15);blackforest 重量 1,591,970 → 1,561,264 = Quaternius 枯木退場釋出 30,706 ⇒ 成長額度 592,199 → **622,905**、`node_cap` 223 → **225**(分母 2,917 → 3,038;既有節點 max 214 仍綠)。③`tree/snag_a` = §5p 漂白刺果松 ◎(seed 1234)走 `--mode wrap` 刀 48,673→200 水密單元件,非等向拉滿 ico(3.2)、200 ≤ 225 留餘裕。intake 244 / siteplan 187 / soft 73 / beacons 68 / joints 21611-0 / gpu 54 / cel 52 / visual 124 / bal 全綠 / e2e 全綠(fresh :8666)/ 對照台 0 缺件 0 孤兒 0 未記載 |
| **D-7 T2 首件入庫 — 實體化刀進 `tools/ai3d` + `rock/tower_a` 改 T2 重生成** | **DONE 2026-08-07 晚** (§5t) | 使用者指示「跑」(巨石首件入庫 + 實體化刀定案)。**零縫改動**:同名取代 `rock/tower_a`(§5l 記錄 SF3D 版「柱狀節理全失、頂面變圓」;§5o 實測 T2 C→500 柱身+裙錐都在)⇒ biomes.js 一行未動、rnd 枚數/座號組逐位元不變。鏈 = T2-spz seed 42 天然閉合注(47,725 面撕裂薄殼)→ **`tools/ai3d/solidify_parts.py`**(§5o C 路徑出貨版;佇列 F.3 選項 (a) 定案 + 3×3 參數掃描全平台)→ 500 面水密單元件(kf_p95 0.94%)→ normalize 同名取代 → **392 tris**(上限 430 留餘裕)。`METHODS` +`trellis2_spz`(§5p 待續③ 兌現)、manifest 拆列(mesa_a 留 sf3d)。intake 240 / siteplan 187 / beacons 68 ± 兩反向紅 / joints 21611-0 / gpu 54 / soft 73 / cel 52 / visual 124 / megalith rnd 對帳 1000 顆 + cap 430 重推不動 / bal 全綠(⑦f 1.78×)/ e2e 全綠(fresh :8666)/ 對照台 0 缺件 0 孤兒 0 未記載;黏土人眼:柱身直紋 + 裙錐 + 平頂都在 |
| **Hunyuan3D-2GP gate(fallback chain 下一階)+ 首個 2GP 節點 `rock/hoodoo_a`** | **DONE 2026-08-06 晚** (§5m) | 閘門**開**:WSL2 獨立 venv(.venv311hy;torch 2.5.1+cu121 + mmgp 3.2.7),profile 3 / steps 30 / octree 256 / mc,§5l 同組知名主體 7 張全過 —— **逐張 torch 峰值恆 2524MiB(GPU 全程 free ≥10.2GB)、61~67s/張**、權重 4.9GB(下載 16 分)。品質恰好收復 §5l 的兩個 SF3D 失敗型態:hoodoo 同一張 wc_112762573 SF3D 塌片(0.065/0.227)→ 2GP **0.274 ◎ 帽岩/細頸/基座全在**;Art Deco 摩天樓 SF3D 0.048 立面殼 → 2GP **0.447 ◎ 退縮量體逐階可見**;魔鬼塔 0.404 ◎ 裙錐+平頂。人眼 7 取 3(~1/2,遠高於 SF3D 的 ~1/6)。**`rock/hoodoo_a` 出貨**(§5j 待續① 補完):MEGA_LIB.hoodoo 列啟用、兩段式減面 213,682→560(pymeshlab)→382(Blender)、包絡 95%、預算 430 留餘裕;分母 29 不動(hoodoo ≤4 < marble 8,tri_budget 註記);intake 240 / siteplan 187 / joints **21611-0** / beacons 68 ± reverse / cel 52 / visual_prefs 124 / gpu 54 / soft_stroke 73 / megalith rnd 對帳 1000-1000;bal 全綠(⑦f 1.09× 不動);對照台 0 缺件/0 孤兒/0 未記載(METHODS +`hunyuan_2gp`),座號組重掃 [1,7,10]→[1,7,10,**22**](hoodoo 型只在 #22/#33);保險絲 vs 零件庫並排截圖 |
| **TRELLIS gate (plan §1 `⚠ must measure first`)** | **MEASURED — FAILS on this card, 2026-08-06**(§5l;plan §1/§7/§8 更正已於同日晚寫入)| 使用者問「有其他更適合的模型嗎」⇒ 十天沒人撞過的那道閘終於被撞。WSL2 Ubuntu 24.04 遷到 `D:\wsl\Ubuntu`(C: 23GB → 119GB)、GPU 直通 OK、零 sudo 裝完 TRELLIS(7.5GB venv + 2.9GB 權重,`kaolin` 走 NVIDIA 預編 wheel、`flash-attn` 以 `ATTN_BACKEND=xformers` 取代、`nvdiffrast`/`nvdiffrec` 幾何路徑不需要)。**TRELLIS-image-large 前三階全過、flexicubes 網格抽取在 9.58GB 空閒下 OOM**;TRELLIS.2-4B 官方 24GB 且解析度下限 512³ ⇒ plan §1 fallback chain 上面兩階在這張卡上是空的,而 §1 那一行把兩代的 VRAM 數字混寫了。**零節點出貨**(來源帳與 `METHODS` 不動)。同輪建立三族知名主體的 SF3D 基準:摩天樓 fill 0.048 ✗ / 神木 0.274 / Devils Tower 0.313 ◎,三者皆失去識別特徵;「最乾淨的照片 fill 最低」為 plan §8 的分流原則提供了第一組實測數字 |
| **薄殼大比例減面閘門(T2 產出 50k→~500;§5n 待續②)** | **MEASURED 2026-08-07 凌晨**(§5o)| **直接減面關、先實體化再減面開**。A trimesh quadric **打不到預算又不報錯**(2000/900/500 三個目標回同一個 2,865~6,076 面 = 預算 5.7~12.2 倍);B pymeshlab 打得到但產出是**三角形湯**(499 面 / 468~479 元件 / v:f 2.8 = 每元件 1~1.5 面);C 先 uniform volumetric resample 再 quadric = 唯一兩者成立(500 面 / 元件 1~9 / v:f 0.48~0.58 / 開放邊 0~97,dev_mean 恆 ≈ offset 本身)。**方法論**:表面偏差量不出撕裂(B→500 的 dev_p95 只有 0.0034~0.0057 卻是彩紙)⇒ 判準是 **v:f 與 面/元件**。原生網格更乾淨那條假設**被否掉**:`--decimate 500` 重跑得 473,280 面仍有 205,236 開放邊 / 9,898 元件(0.434/面,50k 版 0.653/面)⇒ 兇手不是 fork 的 86:1 減面,O-Voxel 輸出本身就不封閉;且 50k 與 473k 黏土渲染肉眼分不出來。500 面留不住建築識別特徵(Art Deco 退縮量體被抹平)⇒ 建築節點的預算與消費端縫要一起定。零節點出貨 |
| **佇列 F0 — 神木語料重採(選片閘 + 可用帳 + 孤立單株重採 + T2 複驗)** | **PARTIAL 2026-08-07**(§5p;閘與帳 DONE,**冠簇路線已定案(§5q:葉冠不走 img→3D,只收雕塑性主體)**,剩語料續補)| `screen_mattes.py` 三統計桶 + 人眼回寫,known-good 16 張零誤殺、反向驗證紅;`fetch_photos --plan` 改計**可用**張數、sequoia want 歸零;兩輪重採 +6 可用(樹族 16→22,canopy 6→9);T2 黏土 5/5 不碎不生遊客(枯幹 ◎ 體積型、茂密冠層 △ 浮雕);授權 264/264;photo DB 搬家至 F0 分支 worktree |
| **冠層造型路線 — 瓣化(v5~v7 + 降級鏈)vs 簡單幾何版 → **首批入庫**(conifer2 / broadleaf 整樹節點)** | **SHIPPED 2026-08-08**(§5w~§5z-o;`--touch` 1.15 與入庫路線皆已定案)+ **針葉冠形第六輪 SHIPPED 2026-08-08**(§5z-r 星盤 → §5z-s 凹面 + 誤差 + 闊葉樹頂包覆)| **§5z-r 星盤(使用者手稿)**:針葉葉冠改「上視各角邊長內凹 + 側視每層下緣內凹 + 層間平面錯開疊加 + 越上層角越短而頂角越尖 + 頂部不露幹 + **不需要樹枝**」。一層 = **2·n·arc** 面(`prim_star`);層間距與幹頂高都是**解**出來的(前者要求最上層頂點落在冠頂、後者量最上層**谷底**母線);逐句稽核 `check_star.py` 四樹種 40 條全綠 + `--break-notch/-cave/-cover` 各只咬紅該咬的一條。**兩個坑**:逐層照抄語料 `r_out` ⇒ 整冠塌成牙籤(輪廓 112% → **10.2%**,而面數/契約/watertight 全綠)⇒ 角長改等比階梯、兩端量出來;`notch` 的實際深度會隨 `arc` 漂(arc 3 的 .5 實測是 .567)⇒ 正規化。**第六次「指標與目的不同軸」**:星盤輪廓 58~64% 對上現行 112~123% 是「大退步」,而俯視那一格直接把話講完 —— 現行版從上面看是一個**乾淨的六邊形**。價目表:`arc` 幾乎不影響畫面 ⇒ 使用者定案 **arc 2 全族**(角數與谷底逐樹種)、**直接入庫** ⇒ `cf2_wood_a` 80 / `cf2_crown_a` 192 = **272 面**、整層 85.9% → **87.1%**;消費端只改一個數(葉冠包絡 cyl 高 7.41 → 8.52,因為**葉冠的頂現在就是整株的頂** —— 木質頂梢同輪退場)。`tree.glb` 與另一分支已逐節點對過帳:**只差這兩顆** ⇒ 乾淨取代。驗收 intake 237 / joints 11908-0 / e2e / bal 全綠 / 對照台 0-0-0。**同日 §5z-s 第二輪**:尖銳度改由**側輪廓凹面**(`--star-curve`)給而不是把上層拉高(`sharp` 1.3 → 0.15,層高全距 2.30 → 1.15),角長/層高/錯開角各加一組零均值誤差 —— **凹面與適度誤差在同一個序列上互斥**(底部相鄰層只差 2.3%、誤差 10%)⇒ 「越上層越短/越尖」的定律搬到**名目階梯**,realized 改驗「誤差零均值有界 + 趨勢跨 lag 遞減」(lag 推導);面數不變而輪廓 58/63% → **76/87%**。同輪**闊葉樹頂包覆**:軸心是空的(旁瓣全在 r>0)⇒ 補一顆同款 ico 葉團,尺寸由「要蓋住什麼」解出來(中位數尺寸那一版實測 45 → 45 = 沒有作用),射線可見 233 → **0**,+20 面。以下為前一輪:**§5z-o 入庫輪**:一株 = 木質 + 葉冠**兩顆節點**(`VEG_DEFS.whole` 改陣列 + 全有全無;一列 = 一份材質 ⇒ 併成一顆會同時吃掉季節色與 A39 軟性),兩顆由 `normalize_parts --group` **共用同一個變換**(各自縮放 = 樹散開,而契約與預算全綠、只有截圖看得出來)。**預算模型換本尊**:flat `node_cap` 對整樹節點結構性失效 ⇒ 改鎖整層總量(`measure_veg_tris --kinds` 量逐型現值);量到成長額度早已用掉 **92.4%**、shrub 一列佔 **59.1%** ⇒ `bush_a09` 減面 213 → 140 讓額度。**最貴的發現**:§5z 五輪的剪影全對 v7 瓣化原型量、從沒對過遊戲裡那棵樹 —— 闊葉因此是進步、針葉是退步(7.9 倍面數換更稀疏),針葉改**疊層多角錐(凸角朝上、平整面朝下)172 面**後整層消耗 98.2% → **85.9%**。新工具 `tools/shot_veg.mjs`(fallback vs lib 並排,走遊戲自己的 `buildVegMeshes`)。intake 237 / siteplan 187 / beacons 68 / joints 21611-0 / soft 73 / gpu 54 / cel 52 / visual 124 / e2e / bal 全綠 / 對照台 0-0-0。**定場圖(賽璐璐 + 勾線)仍未補**。以下為原型期紀錄:使用者手稿「冠層莢化放射 + 樹幹迴轉」→ 逐瓣誤差 → 逐叢瓣化 → 五顆降級旋鈕 → **簡單幾何版**(旁瓣佈局照舊、葉冠整組換基本體:針葉多角錐 / 闊葉橢球或多面體 / 幹枝圓台多面柱 / 尖端細錐;茂密度一顆旋鈕;拿掉葉冠 = 枯木)。佈局收成三個縫(`trunk_cut`/`clump_metrics`/`plan_lobes`),抽出前後 v7 **逐位元相同**。針葉:簡單幾何 `mid` **1,138 面**同時過成長額度(13.3%)與 tree 族 `kind_factor`(2,000),而 v7 的目標是 2,949(只過前者);闊葉主旋鈕是 `--major` 不是茂密度。**`--touch` 定案 = 1.15**(§5z-n,使用者 2026-08-08):兩族**同面數** ⇒ 預算逐位元不動(針葉 1,220×73 = 14.3% / 闊葉 1,256×211 = 42.5% / 合計 56.8%),只是孤兒多拉長、**刪除數不變**;歷史對照組以 `R4` 常數顯式釘死,重跑逐格對上舊值。列圖 `out_simple/sheet_*.png` 十一張。**零節點出貨、儲存庫只有 runbook 改動**;原型住 study clone `simple_tree.py`/`canopy_petals.py`/`sheet_simple.py`(⚠ 該 clone **無 `.git`** ⇒ 定案值 MUST 在 §5z-n 留字面紀錄) |
| **D-10 建築整棟量體 — 首顆節點 `building/mass_a` 入庫 + deco 上限欠帳清掉(佇列 F 步驟 3~5)** | **SHIPPED 2026-08-08 深夜** (§5ab) | 使用者對 §5aa 的兩個收尾問題各回一字:**「減面」**+**「開」**。①**deco 欠帳清掉**:採用四場取樣(`node_caps` 222/373/285),chimney_a 234 → **217**、ac_a 426 → **279**;刀落在**已出貨的節點本身**(1.08:1 / 1.53:1),因為 SF3D 原檔**復現不出**出貨那兩顆(只得到 220/402、黏土一看是另一顆)⇒ 記下 `post.source_gap` 與新規矩「來源帳 MUST 記到輸出目錄與序號」。②**首顆整棟節點**:來源是 §5n 閘門那一輪就生好、還躺在 `out_gate/` 的 Art Deco 摩天樓 ⇒ **不必重跑 T2**(避開 free RAM 19.8GB 貼著 20GB 門檻的風險)。③**最貴的發現**:`--cells` 在建築上**不是解析度旋鈕而是「濾掉立面凹槽」的旋鈕** —— 預設 256 把 T2 生出來的垂直窗格凹槽逐條重採樣成隨機凸起,整棟讀起來是**侵蝕岩**;往細調(384/512)`kf_p95` 從 0.91% 掉到 0.51% 而畫面更糟(§5o「表面偏差量不出撕裂」換了個面貌),往粗調到 **72** 才讓凹槽落在取樣解析度之下、而尺度大一個量級的退縮階梯完整保留(再粗到 56 裙樓斷成浮塊)。逐檔黏土 56/72/96/128/160/256/384/512。⇒ `mass_a` **2,898 面**(上限 2,981)。④**只有截圖看得到的缺陷**:附件掛在**方盒**頂而庫節點收在 0.95×b.h 且末端是尖塔 ⇒ 看板/天線/程序頂塔**浮在半空** ⇒ 挑中的那幾棟純視覺附件一律改推丟棄桶(`vis()` 19 處,**只換目的地、rnd 照抽**),而**帶碰撞柱的兩件 MUST NOT 進丟棄桶**(少一根碰撞柱 = 載到庫與沒載到的權威幾何分家)。**亂數不變是量的**:載庫 vs 不載庫的 `veg 530 / mega 10 / beacon 9 / climb 122` 逐項相同。⑤新機位 `shot_scene mass_near`(比對幾何物件本身找到 instance 再反推鏡位)—— 整棟量體是**唯一吃立面貼圖**的庫節點,UV 一錯就是純色板而離線閘門全綠。實測 shibuya:主量體桶 671 → 647(13 棟換 + 11 頂程序頂塔退場),`mass_a` 佔全場 2.9%。intake **241** / siteplan **197**(`--break-mass` 4 條紅)/ joints 21611-0 / beacons 68 / gpu 54 / soft 73 / cel 52 / visual 124 / e2e 全綠 / bal 全綠且逐項不動 / 對照台 0-0-0 / **traverse 96-19**(與上線前同一組既有基準紅字)。**§5ac 同輪追加鏡像貼補**(使用者看過定場圖後定案「另一面是空的,使用鏡像貼補空的部分」):空的不是破面(六個方向都有面),是**沒被拍到的那半沒有內容** —— 量得出來的指標是半空間**面積**不對稱(z 12.3% / x 0.6%;空的那半是一片光滑的板,開放邊與元件數判不出來)。**刀的位置比刀本身重要**:放在 solidify 端的兩種寫法都把網格撕爛(切半鏡射 開放邊 16 → 362、裙樓整條不見;整份疊合 1,119 / 5,016 開放邊),共同的錯誤前提是「resample 會幫我熔合」——它只對**單層**輸入成立 ⇒ `solidify_parts.py --mirror` 整支退回。正確位置 = **`normalize_parts.py --mirror <node>=<x|z|auto>`**(Blender Mirror modifier 的 bisect + clip + 焊頂點,不重建等值面 ⇒ 一條新的自由邊都不生),留哪半由面積決定、MUST 排在減面之前。實測**鏡射後比不鏡射還乾淨**(開放邊 18 → **15**),面 2,898 → 2,921(仍 ≤ 2,981)。未做:真機冒煙、名冊只有一顆(十幾棟塔樓同剪影) |
| **D-11 鏡像貼補推廣到巨岩/假山 — 先量「哪一面真的是空的」,再決定用哪一把刀** | **SHIPPED 2026-08-09** (§5ad) | 使用者定案「img to 3D 會出現另一面是空的問題,由正面對稱的區塊去補對應的區塊,包含建築/巨岩/假山都這樣處理」。**這是條件句 ⇒ 先做尺再做刀**:兩支新儀器 `mesh_sym.mjs`(半空間面積不對稱 / 鏡射殘差 / 邊界邊 / 鬆散元件 —— 空的那半是**光滑的板**不是洞,只有面積判得出來)+ `node_sheet.mjs`(節點的**四個面**黏土對照,繞相機不轉模型 ⇒ 結構上不會重蹈 §5ac-e 的 `ry` no-op)。閘門 `EMPTY_ASYM = 0.12` **錨在使用者自己判定過的那一顆**(§5ac-a 的 `mass_a` 0.123)⇒ 15 顆現役節點只有 **6 顆**該補,MUST NOT 退回逐顆手挑的名冊。刀改成 `--rework`(落在**已出貨節點**上,`source_gap` 讓重跑原檔不可行),**外廓與面數逐位元不動**(`nodeExtent` 那兩個數動完等比還原;鏡射多出的切面一律減面回原值 ≤1.2:1)。**必要前置 = 先焊頂點**(glTF 匯入器不會焊回匯出時的法線接縫拆分 ⇒ 平面著色節點在 Blender 眼裡是三角形湯:hoodoo_a 382→96 面、tower_a 開放邊 0→170),著色風格依原拆分比還原。**兩把刀依主體是不是人造的選**:`half`(bisect,建築)對圓渾岩體會做出**葉緣**(mega_c 變成有中脊的葉子、mesa_a 平頂變尖峰、chimney_a 變帳篷);`union`(精確布林)取外包絡 ⇒ 接縫是內凹岩溝而非外凸銳脊。**三道閘各對應一次實測失敗**(面數 ≥0.8×、鬆散元件不增(tower_a union 1→**14** 而面數只掉 6%)、邊界邊 ≤ +5% 面數),MUST 排在減面之前。去對稱化 `warp` 的方向 **MUST 取徑向不取頂點法線**(法線在座標重合的獨立頂點上不同 ⇒ 沿每條硬邊撕開,mega_a 開放邊 0→164),振幅錨在天然殘差帶(0.030~0.274,中位 0.073);**有破口的節點 MUST warp 0**。出貨 **4 顆岩節點**(collapse_a/facet_a/mega_c union、mega_d half;不對稱 0.13~0.18 → ≤0.014),`mega_d` 是明確的贏(舊版整塊缺角+破洞),另三顆是**交換**(補滿 ↔ 接縫多一道對稱凹槽)。**沒出貨**:hoodoo_a(兩刀皆撐不住,來源 V=139/F=382 非流形 ⇒ 該重生成)、chimney_a(union 過不了閘、half 是回歸 ⇒ `building.glb` **逐位元不變**)、ac_a 與其餘 7 顆岩節點(門檻之下 = 沒有空的那一面)。intake 241 / siteplan 197(`--break-shy` 紅)/ beacons 68(`--break-extent` 紅)/ joints 21611-0 / cel 52 / visual 124 / gpu 54 / soft 73 / bal 全綠 / e2e 全綠(fresh :8666)/ 對照台 0-0-0;**反向驗證**:hoodoo_a 與 tower_a 的兩道閘實測會紅。未跑:真機冒煙、traverse(㋓;理由上不受影響 —— 巨岩碰撞算式 MUST NOT 讀庫幾何,而外廓逐位元還原) |
| **D-12 建築續 — `mass` 名冊補到 2 顆 + 語料端兩個「合法但沒用」的坑** | **SHIPPED 2026-08-09** (§5ae) | 使用者「繼續處理建築」⇒ 收 §5ab-f 的第 2 條(名冊只有一顆 = 十幾棟塔樓同剪影)。①**「還有 3 張沒用過」裡有 2 張不是建築** —— 是同一本 1932 年畢業紀念冊的封面與封底;兩個機制同時放行且都不報錯:館藏源 `smithsonian_african_american_history_museum` 不在 `EXCLUDED_SOURCES`、而 Openverse 對它回不出尺寸 ⇒ `size_unknown` 讓短邊 1024 那道閘**結構性地量不到**。補上排除源 + 人眼 reject(id 留在 seen,不會重抓)⇒ `--plan` 才開始說實話。**規矩**:`--plan` 的「抓夠了」只證明下載成功,不證明內容對。②`want` 4 → 8、查詢改成六句**具名單一主體**(舊的 `art deco skyscraper` 全庫只有 6 筆);補抓 3 張,採用 **Fisher Building**(藍天下整棟入鏡)。③生成配方**一個字沒改**(T2-spz 1024_cascade/seed 1234 → `--cells 72 --offset 0.006 --target 2900` → 非等向 0.5×0.5 + `--boxuv`):117.0s / 2,890 MiB / raw 4.31M → 49,169 面;實體化結果**比 mass_a 乾淨**(0 開放邊 / 1 元件 vs 16 / 6),`mass_b` **2,900 面** ≤ 2,981。④**最有價值的發現**:mass_b 的半空間面積不對稱 x 0.004 / z 0.014,**遠在 §5ad 的 0.12 閘門之下 = 不需要鏡像貼補**。與 mass_a 鏡射前的 z 0.123 對照,兩顆的差別只有**語料**(緊裁的夜景 crown vs 藍天下的整棟)⇒ **「另一面是空的」是單張照片只約束得到被拍到的那幾面的後果,上游修語料勝過下游動刀**;選片準則多一條「這一桶要整棟入鏡」。⑤**兩份會靜默過期的手寫清單**(`shot_scene` 的載入讀數 + `mass_near` 認人,名冊擴充時兩處都還只認得 mass_a —— 同 `% 3` 輪替除數那個坑)⇒ 新讀取縫 `partlib.js libNames()`(唯讀快照,**只給離線工具**,遊戲路徑一律走 `libGeo(具名節點)`)。⑥順手修掉 `matte_photos.py` 在繁中 Windows 主控台的 cp950 `UnicodeEncodeError`(批次跑到第 4 張才死、前 3 張留著)。intake **245** / siteplan 197(`--break-mass` 3 條紅)/ joints 21611-0 / beacons 68 / cel 52 / visual 124 / gpu 54 / soft 73 / bal 全綠 / e2e 全綠(fresh :8668)/ 對照台 0-0-0(mass_b 的帳含 `gen.out` 輸出目錄與檔名)/ 定場圖 `mass_near` **同時看得到兩種剪影**。draw call 不隨名冊長度增加(上限仍是 pick_n = 16,分配走位置雜湊、零 rnd)。未做:真機冒煙、`chimney_a` 仍待重生成、mass_c(GE Building / 布魯托主義板樓已 matte)|
| **D-14 `chimney_a` 重生成 — 換模型不換語料;hoodoo 判退(階梯要走對那一階)** | **SHIPPED 2026-08-09** (§5ag) | 使用者「繼續」⇒ 收 §5af-g 的第 1、3 條(§5ad-f 起掛了兩輪的兩顆重生成)。§5af 記的 RAM 障礙自己解除(15.1 → **23.0GB avail**)。①**先看照片**(既有紀律)當場解釋了兩顆的失敗:chimney 出貨版那張是**仰角極陡、基座出框**、hoodoo 出貨版那張**主體只佔畫面 15% 且 alpha 糊成一片**(T2 以 alpha>204 取 bbox ⇒ 餵進去的是一小塊)。②三注一起跑(配方一字未改):chimney 舊語料 **270 面 / 0 開放邊 / 2 元件 / watertight / kf_p95 0.72%** ◎;chimney 三連煙囪(平視整組入鏡)**6 元件** ✗;hoodoo 乾淨單體 500 面 / 單元件 / kf_p95 0.98% —— **讀數全綠而黏土是一片薄板** ✗。③**hoodoo 判退,`rock.glb` 逐位元不變**:單張照片只約束得到被拍到那一面,而 hoodoo 的辨識特徵**恰好全在剪影上** ⇒ 模型沒理由給它厚度(「幾何品質指標量不出形狀對不對」,同 §5ab-b 的另一面)。§5ad-f 說「正解是重生成」沒錯,但**重生成 MUST 走階梯上對的那一階** —— hoodoo 是實心岩體 ⇒ 2GP(WSL2),拿 T2 換是把階梯走反。④**chimney 採用:同一張照片、換模型**(SF3D → T2-spz;§5n 早已量到 T2 對建築/規則幾何雙 ◎)。**216 面**、邊界邊 **189 → 0**、半空間不對稱 **0.214 → 0.053**(掉到 `EMPTY_ASYM = 0.12` 之下)⇒ §5ad-f 列為「兩把鏡像刀都不適用」的那個問題**重生成之後不存在了** —— §5ae-d「上游修勝過下游動刀」的第二次兌現,而 §5ad 那把刀當初正是為了救這一顆才被逼出來的。**外廓逐位元相同**(0.570 / ±0.475)⇒ 純粹同名取代,消費端與碰撞語意一格不動。⑤**準則補一句**:三連煙囪輸給仰拍那張,與 §5ae-d 的「整體入鏡」表面矛盾 —— 差別是**主體數**,222 面的預算分不出三根柱子,而**碎法是元件數不是面數**。⇒「整體入鏡」的前提是**主體只有一個**。intake 245 / mesh_sym 名冊 16 → **15 顆** / siteplan 197(`--break-mass` 3 紅)/ beacons 68 ± 反向 / joints 21611-0 / world_height 49 / cel 52 / visual 124 / gpu 54 / soft 73 / e2e 全綠(fresh :8672)/ bal 全綠 / 對照台 0-0-0 (`parts_manifest` 30 → 31 列,ac_a 與 chimney_a **拆列**,同 §5t 的 mesa_a)。未做見 §5ag-f |
| **D-16 設計圖 → 3D 外殼(`plan_hull`)** | **功能 SHIPPED / 零節點出貨 2026-08-09** (§5ai) | 使用者定案「建築部分也加入設計圖轉 3D 的功能,轉 3D 時只要處理外層表面就好」。①**這一段不是模型是幾何**:照片只給一個視角 + 明暗線索(深度得猜,§5ag-c 的 hoodoo 就是猜不出厚度而讀數全綠地塌成薄板),而設計圖給的是**正投影的精確輪廓** ⇒ 逐視圖取外輪廓 → 沿自己那一軸拉伸 → **稜柱取交集** = 視覺外殼,**解出來的**。零 GPU / 零權重 / 零亂數 / 離線可驗;階梯多一階且排最前:**有設計圖就別去猜**。②**「只要處理外層表面」是兩件事而剛好同一個實作**:只取最外層輪廓(窗/樓層線/隔間一律填實 —— 那些是貼圖的事,也是三角形預算的主要旋鈕:不填實光窗格就上千面,而 mass 桶上限 2,981)+ 只有外殼沒有室內。**這條規則在三處各擋一次**(填實 / RETR_EXTERNAL / prism 只吃 exterior),而這件事是**被反向驗證逼出來的** —— 只拆前兩處第三處會把洞再吃一次 ⇒ 窗戶版仍是 12 面盒 = **假綠**。③三個「不報錯只給爛結果」的坑全部量過:**每一張真設計圖都有圖框**(最直覺的邊界泛洪寫法會量到「那張紙」不是「那棟樓」,合成實測寬 0.6678 → 0.7366 而網格看起來正常)⇒ 改挑輪廓 + `FRAME_MAX`;**渲染圖不是線稿**(墨是調子不是輪廓 ⇒ 剪影碎掉、亮處變洞;CC0 六張實測 HABS 線稿墨密度 **11.4%** vs 四張渲染圖 **32~71%**)⇒ `LINEART_INK = 0.25` 硬擋 + `--allow-render`;**缺口報錯 MUST 排在渲染圖判定之前**(斷線遮罩的墨密度是 100%,反過來會把人指到錯的方向)。④真圖實測 HABS Tudor Place 南立面:圖框/標題欄剔除、窗與線腳填實、煙囪山牆保留 ⇒ **160 面 / 單元件 / watertight**。⑤**零節點出貨,而理由是形狀不是品質**:那張唯一乾淨線稿是**寬高比 3.6:1 的兩層宅邸**,而唯一吃整棟量體的桶服務 >55m 商辦塔樓、非等向 fit 會把它拉成帶山牆煙囪的高塔 ⇒ 缺的是**塔樓立面測繪圖**(同 §5ag-c 判退 hoodoo 那一條:讀數不能替形狀背書)。`bld_drawing` 語料列**刻意不帶 `grp`**(輸入格式不是建物類別,進分母會稀釋 50/25/25)。`audit_plan_mesh.py` **21 項全綠**;反向 `--break-outer` **9 條紅**、`--break-frame` 1 條紅。遊戲程式碼一行未動。未做見 §5ai-g |
| **D-15 `hoodoo_a` 換掉(語料 + 後處理一起)+ 選片標準與建築語料配比兩條定案** | **SHIPPED 2026-08-09** (§5ah) | 使用者「繼續」⇒ 收 §5ag-f 第 1 條(掛了三輪的 hoodoo 重生成);中途追加兩條定案(選片乾淨單一主體 + 光源充足;建築 50/25/25)。①**「重生成」這個處方只對一半**:2GP 的原生輸出**一直都是水密的**(213,682 面 / 開放邊 0 / 元件 1),非流形是**後處理**做出來的 —— 舊路 `FaceReducer(pymeshlab quadric) 380:1` 把邊塌成非流形(焊點 139,閉合流形理論值 193),換成 `solidify --mode resample` 之後焊點 **192**。**這條會靜默傳染**:`mesh_sym` 的「邊界邊 0」對非流形完全無感,只有真的動刀才現形。②**但只換後處理不夠** —— 黏土仍是「團塊 + 小角」(照片主體只佔 15%,2GP 忠實地把底下那面崖壁一起生了出來)⇒ 同一階(2GP)換語料 `ov_929bc3d9`:焊點**恰好 193 = 閉合流形理論值**,黏土四面是**層理石柱 + 過寬帽岩 + 裙狀基座** = 消費端註解寫的那個東西。**外廓與面數逐位元相同**(0.950 / ±0.950 / 382)⇒ 純粹同名取代。⚠ 目標欄 MUST 是非等向 `1x1`;一度寫成等比 ⇒ 徑向 0.5997(契約仍過)= 整柱比碰撞柱細 37%,而**所有離線閘門全綠**。③**鏡像刀這次跑得動了,而結果該退**:網格變流形之後 union 在第一顆候選上 `382 → 374 / 元件 1 → 1 / 三道閘全過`(對比 §5ad-f 的 382 → 128)⇒ **那道閘從頭到尾沒錯,它擋的是上游的爛網格**;但黏土否決(z 聯集把**頸部**做成兩根叉開的柱子,而頸部是 hoodoo 的辨識特徵),新語料那顆兩把刀更是被元件閘直接擋下(1→3 / 1→2)⇒ **出貨不做鏡像貼補**,x 0.159 是「石柱歪 + 帽岩偏心」的天然形狀不是空的一面。§5ad-f 那行因果講反了:撐不住的原因在網格,該重生成的原因在照片。④**選片標準**落在兩支工具各一半(下載前只有查詢用字管得到「乾淨」;「幾個主體 / 光夠不夠」要看 matte)⇒ `screen_mattes.py` 新增 ④多主體(最大連通元件**面積**佔比 < 0.70)與 ⑤光源不足(`lum<35 ∧ dark≥0.70`),門檻拿**已出貨的 25 張來源**校準、**零誤殺**(反向掃描:0.778 起開始誤殺桁架水塔)。三個決定:**量在 matte 不是照片**(本輪贏家原圖三顆蘑菇岩 + 電線桿,去背只剩一顆)、**取面積佔比不取塊數**(水塔的腿是 4 塊但只有一個主體)、**統計分不開的一帶進觀察名單 sheet**(熱氣球 0.760 vs 水塔 0.778 ⇒ 收到 0.77 就是拿兩個樣本過擬合)。⑤**順手撞到既有兩道閘是「樹形狀」的**:①`BLANK_COV`(樹是密實團塊)誤殺 3 張已出貨(含魔鬼塔)、②`PRINT_FILL`(前提是主體留得下輪廓縫,而**建物就是個方盒**)誤殺 1 張 ⇒ 收成 `TREE_CAL_FAMS` + 別族實測校準的 `PRINT_FILL_OTHER 0.93`,兩條在非校準族**降級成觀察線而不是放棄**;tree 三桶讀數 **27/10/3 與 F0 逐位元相同**。⑥**建築配比**只約束帶 `grp` 的整棟建物列(零件列進分母 = 50% 會隨零件數浮動),新增 12 列、舊區域風格列**一列沒刪**只降 `want`(刪列會讓已抓照片變孤兒);**配比是驗出來的**(`buildingMix()` 現算、`--plan` 印目標 vs 現有、抓取前 `buildingMixDrift()` 擋)。⑦兩支工具的資料家改成參數 `--home`(§5af-g 記過一次「worktree 被刪 ⇒ 語料跟著沒」)。intake 245 / mesh_sym 15 顆 / siteplan 197(`--break-shy` 3 紅)/ beacons 68 ± 反向 / joints 21611-0 / world_height 49 / cel 52 / visual 124 / gpu 54 / soft 73 / e2e **584 綠**(fresh :8674;⚠ 埠走 `WS_URL=` 不是 `PORT=`)/ bal 全綠且逐項同 §5af/§5ag。未做見 §5ah-i |
| **D-13 冒煙那一項終於跑得動 — 而它一跑就發現整條建築線在 main 上是死碼** | **SHIPPED 2026-08-09** (§5af) | 使用者「繼續 ai3d_runbook.md」⇒ 收連三輪(§5ab-f/§5ad-g/§5ae-g)未做清單的第 1 條**真機冒煙**。①**沒人跑得動的原因與 §5z-t 同款**:`shot_scene` 的 `cfg.env` 寫死 `day`,而立面 `emissiveMap` 只在 `time === 'night'` 點亮 ⇒ 整棟量體節點**唯一真正要驗的東西**(它是唯一吃立面貼圖的庫節點,盒投影 UV 一錯白天只是「有 tint 的板」、夜裡才看得出「沒有窗的板」)**從來沒有被畫過**。補 `--time/--season/--weather` 透傳,非預設值進檔名後綴,**合法值當場驗打錯就停**(`TIMES[x] || TIMES.day` 會讓 `--time nigth` 拍出一組白天的圖而讀數全正常)。②**冒煙第一回合就撞到更大的事**:`mass_near` 機位連兩個場地整個消失 ⇒ 補讀數(機位消失 MUST 講得出原因)⇒ `挑中 0 棟`。追出來是**兩個 PR 各自綠、合起來壞**的語意衝突:`7135050`(PR #170 = §5aa~§5ae 整條建築線)寫在 `bldCap: 170` 的底上、`MASS.MIN_H = 55` 完全合理;`f94515f`(PR #169 = 世界高度上限)獨立把 `bldCap` 改成 `objHeightMax()` = 2×26 = **52**;兩者改的不是同幾行、git 合得乾乾淨淨,而 main 上 `b.commercial && b.h > 55` **結構性地永遠是空的** ⇒ `mass_a`+`mass_b`(5,821 tris、兩輪 img→3D 的產出)**一顆都沒被擺出去過**,同一刀還砍掉退縮頂塔(`b.h > 55`)、第二層退縮(`b.h > 100`)、屋頂天線(`b.h > 60`)。**沒有任何東西會說**:intake 245 綠、siteplan 197 綠且 `--break-mass` 照樣紅、對照台 0 孤兒、e2e/bal 全綠。③使用者定案**提高物件高度上限** ⇒ `OBJ_F 2 → 4`(104m);連帶 `CEIL_PEAK_F 2.5 → 4.5`(結構保證)與**使用者沒點名的第三個** `CEIL_AVG_F 4 → 6` —— 地表恆 ≤ 最高海拔 ⇒ 平均項係數不大於峰頂項的話「取 max 的兩端各自勝出」當場退化成單一項(稽核 Ⅰ 補一條把這個前提明寫)。④**守門線**:稽核 Ⅲ 新增「吃建物高度的門檻 MUST 全部 < `objHeightMax()`」,門檻**自 biomes 原文抽**(之後再加一條 `b.h > N` 自動跟著驗),新反向旗標 `--break-cap` ⇒ 紅字並逐一列出構不到的 55/60/100m(既有 `--break-obj` 是把上限往上推,咬不到這一條)。⑤**冒煙結果**:夜間立面**通過**(挑中 15~16 棟,兩顆庫節點的窗格與程序方盒一樣亮著橘光 ⇒ 盒投影 UV 契約成立);岩體四面**通過**(新機位 `mega_orbit_{0,90,180,270}` **繞相機不轉模型** ⇒ §5ac-e 的 `ry` no-op 結構上不可能重蹈;shibuya 拍到 `rock/tower_a` 四面實心);碰撞**用量的**(水平徑向 0.475 / 縱向 ±0.47 對權威方盒 ±0.5 ⇒ 可見量體恆收在碰撞柱內,方向是對的;代價「被空氣擋住」≤2.5% 寬 / 3% 高,上限翻倍後絕對值最壞約 3.1m —— 有造型的節點裝進方盒碰撞柱的**固有**取捨,A30 不准動碰撞柱 ⇒ 記錄不修)。⑥順手修掉兩個「讀數正常但拍錯東西」的坑:機位算在第一次 render **之前**(`matrixWorld` 未更新)、頂點數相同**不保證**是單獨一顆(合併桶撞號 ⇒ 實測「外接半徑 733.5m」把相機擺到 1.4km 外拍空氣;門檻吃 `objHeightMax()×2`,擋掉幾顆一律印出來,正常門檻下 taroko 那一局就擋掉 1 顆)。world_height **49**(+2)/ intake 245 / siteplan 197(`--break-mass` 3 紅)/ beacons 68 ± 反向 / joints 21611-0 / cel 52 / visual 124 / gpu 54 / soft 73 / e2e 全綠(fresh :8670)/ bal 全綠且**逐項與 §5ae 逐位元相同**(⑦f 1.78×;WORLD_H 不進平衡模型)/ **traverse 93-19 —— 敗數與改動前(§5ab 的 96-19)相同且是同一組**(門檻活過來 ⇒ 那幾行的 `rnd()` 重新被消耗 ⇒ 全圖佈局重排,這一項因此非跑不可;19 條逐條對回既有基線的四個成因,一條新的都沒有)。未做見 §5af-g |
| **D-9 建築整棟量體 — 預算級距 + 消費端縫(佇列 F 步驟 1~2)** | **SHIPPED 2026-08-08(縫);零節點出貨** (§5aa) | 使用者定案「接著處理建築的部分」→ 選「**執行佇列 F**」,**推翻 plan §8.1 的 `BUILDERS` 那一列**(同日稍早的「只做景觀樹木與石頭」;plan 已標注覆寫)。①**量測直接否決「整桶換」**:四場 `--live` 實測(新增 taipei101 —— 建物最多的一張,1,114 棟)主量體 instance 上界 **1,325**、桶總量 15,900 tris ⇒ 整桶換的逐節點上限只有 **36 tris**,而 §5o 已證 500 面就留不住 Art Deco 的退縮量體 ⇒ 「只換子集」是**推導出來的**。②子集大小由兩條約束取較嚴者:細節下限(cap ≥ 2 × 500)⇒ N ≤ 47、draw call(額外 mesh ≤ 立面段現行的 16)⇒ N ≤ **16** ⇒ `node_cap` = 3 × 15,900 ÷ 16 = **2,981**;高度門檻沿用既有的退縮頂塔 55m。③縫 = `BLD_LIB` 第四桶 `mass`(值可為**輪替名冊**陣列,除數由長度推導),`bldGeo(key, i)` 仍是唯一解析縫(`libGeo(` 全檔恰 3 處);碰撞/LOS 有向盒一格不動(A30)、零 rnd(A4)、庫沒載到全數落回方盒。④**材質契約**:傳該立面款現做的 `wall` 材質(窗格 + 夜間自發光 + tint 全保住)⇒ 節點 MUST 帶**盒投影 UV**(`normalize_parts.py --boxuv`,本輪一併實作 + round-trip 驗過)。④-b **那條路真的走過一次**(§5aa-c2:暫時把 `mass` 指到既有節點實測)—— 主量體 671 → 658、13 棟落進 5 個帶貼圖的新 mesh(額外 draw call 5 < 上界 16)。⑤**逐位元不變是量的**:新旗標 `--osm-cache` 錄播 Overpass(同一張圖兩次 `--live` 差到 ±70%),A/B 後全場 tris / mesh 數 / 每個桶 / 671 筆逐實例尺寸普查逐位元相同。⑥**順手量到一筆欠帳**:同一批資料重推 deco 三桶,上限 chimney 240→222 / acbox 435→285 ⇒ 已出貨的 234/426 會超標(2026-08-06 那輪沒取到 taipei101)—— 本輪刻意不動閘門,記在 `tri_budget.resample_2026_08_08`。intake 237 / siteplan **194**(`--break-mass` 恰 3 條紅)/ joints 21611-0 / beacons 68 ± 反向 / gpu 54 / soft 73 / cel 52 / visual 124 / e2e 全綠(fresh :8666)/ bal 全綠且**逐項不動** / 對照台 0-0-0。未做清單見 §5aa-g |
| **TRELLIS.2-spz fork gate(§5l 頭兩階的翻案)** | **MEASURED — OPEN 2026-08-06 深夜**(§5n)| 使用者指示「先在 3060 上跑閘門量測」。IgorAherne StableProjectorz fork = Windows 原生 + 全預編 cp311 wheel + 逐階段 CPU offload;§5l/§5m 同組 7 張 **7/7 全過 @1024_cascade,59~226s/張、torch 峰值 2.7~3.4GB、裝置 free 恆 ≥5.4GB** —— §5l 殺掉 TRELLIS 1 的網格抽取在 O-Voxel 路徑上不是事。**真門檻是 RAM**(low_vram 模型駐留 CPU ~19GB,avail <20GB 載入無聲死);fill 前篩對 O-Voxel 雙層薄殼**結構性不適用**(七張全 ✗ 而人眼兩張 ◎);建築雙 ◎ 是甜蜜點(幾何+PBR 一次出);「同一張 matte ≠ 同一個輸入」(T2 裁 alpha>204 bbox + 預乘,軟 alpha matte 整段被裁)。**零節點出貨**(METHODS 不動);階梯更新 = `T2-spz(建築/要貼圖)→ 2GP(實心岩體)→ SF3D(快篩)→ procedural`;venv 住 study clone `Documents\study\TRELLIS.2-stableprojectorz\.venv` |

## 2. Environment matrix (measured 2026-08-05 — do not rediscover, trust this)

| Environment | Can do | Cannot do (measured) |
|---|---|---|
| **CC sandbox** (this repo's remote sessions) | All offline audits; e2e (`node server/server.js` then `npm test`); `npm run bal`; editing + push; GitHub MCP (PR/Actions API); HF MCP (search + the curated `dynamic_space` roster) | Egress to `api.openverse.org` / `commons.wikimedia.org` / `huggingface.co` / `upload.wikimedia.org` / `*.blob.core.windows.net` — all CONNECT 403 ⇒ **no photo ingress, no artifact ingress, no HF gradio calls**. No GPU (`nvidia-smi` absent). Raw `api.github.com` REST is gated (MCP tools work; `curl` with `$GITHUB_TOKEN` returns "GitHub access is not enabled") |
| **GitHub Actions** (ubuntu runner) | Open egress ⇒ photo fetching (proven, run 1); licence re-audit; artifact publishing | No GPU. SF3D weights are licence-gated on HF ⇒ inference here would need an `HF_TOKEN` secret **which only the repo owner can add** — do not attempt without it |
| **User's RTX 3060 12 GB machine** | **SF3D proven 2026-08-05** (weights local, peak VRAM 6.17 GB, warm 13.6 s / 2 images); Blender 5.2 LTS (headless normalise proven); `agy` 2D; **photo fetching (open egress — measured 2026-08-05; step A does not need Actions)**; `uv 0.5.30` present. **WSL2 Ubuntu 24.04 with working GPU passthrough** (measured 2026-08-06 §5l; VHD moved to `D:\wsl\Ubuntu` — see right) — this is the only viable home for the CUDA-extension model stack; **Hunyuan3D-2GP proven there 2026-08-06 晚 (§5m): torch peak 2524MiB constant, 61–67s/image, weights 4.9GB, venv `~/ai3d/.venv311hy`**; **TRELLIS.2 via the stableprojectorz fork proven on native Windows 2026-08-06 深夜 (§5n): 7/7 @1024³, torch peak ≤3.4GB, 59–226s/image, needs ≥20GB free RAM to load, venv `Documents\study\TRELLIS.2-stableprojectorz\.venv`** — the img→3D ladder on this card is now `T2-spz(buildings/textured)→ 2GP(solid rock)→ SF3D(fast prescreen)→ procedural` | Python 3.13 is system default — the model stack lives in the **3.11 venv** at `<venv home>/tools/ai3d/.venv` (never in `package.json`, A2; venv home = worktree `zen-albattani-b33990`, §5d; **photo-DB home moved 2026-08-07 (§5p)** to the F0 branch worktree `self-buff-support-scaling-866a87` — the 305-entry superset; the copy that had grown in `reverent-pascal-fcd63e` is now stale). **Official TRELLIS builds are out on this card — measured, not assumed** (§5l): TRELLIS-image-large clears cond/sparse-structure/slat but its flexicubes mesh extraction OOMs with **9.58 GB free**, after removing unused decoders, per-stage CPU offload and `expandable_segments`; official TRELLIS.2-4B needs 24 GB and its floor resolution is 512³. **The stableprojectorz fork reverses this for TRELLIS.2 (§5n, measured)** — those rungs are no longer empty, but only via that fork's build. Native Windows cannot build the stack (no MSVC) ⇒ WSL2 only; its `ext4.vhdx` was 95.69 GB on a 98 %-full C: and **cannot grow at the host level** (WSL-side `df` shows the virtual 1 TB and will mislead you). **Wikimedia IP throttle**: bulk original-size downloads from `upload.wikimedia.org` trip HTTP 429 with `Retry-After: 600` after ~30 images, then ~2–3 images per 10-min window; most Openverse CC0 results are Wikimedia-hosted, so this throttles both APIs' downloads (search quota itself is fine — 200/day anon, measured) |
| **HF Spaces** | `stabilityai/stable-fast-3d` (official gradio Space) as no-GPU fallback — drive it from a machine that can reach `huggingface.co`, i.e. the 3060 box or a browser; **not** from the sandbox | The HF MCP `dynamic_space` roster has **no mesh-generating space** (checked: only image/video/audio tools; `stabilityai/stable-fast-3d` is not MCP-enabled → HTTP 404 via MCP) |

**Consequence an agent must internalise**: photos and GLBs cannot pass through the sandbox.
The sandbox's role is seams, tools, audits, docs, and PRs. Anything touching pixels or meshes runs on
the 3060 (or Actions for photo fetching only).

## 3. Fixed rules (violating any of these = revert, no discussion)

1. **Parts, never finished props** — assembly/variation stays in existing code (skill §0; plan §2).
2. **CC0/PD only, photos never enter the repo** — only part-library GLBs do (plan §4.1; `.gitignore` has `tools/ai3d/photos/`).
3. **Fuse stays** — `['lib', name, <fallback primitive>]`: the fallback descriptor is the degradation path AND the offline extent bound. Export tooling MUST reject a GLB part whose measured extent exceeds its fallback's extent (encoded in `partExtent`, `partlib.js` header).
4. **Zero extra `rnd()` consumption** when swapping geometry (CLAUDE.md §2.3 / A4).
5. **`markShared()` for library geometry; consumers that mutate must `.clone()`** (A25; `beacons._geo` does).
6. **Geometry + base colour only** — no normal/metal/roughness maps (CLAUDE.md §1).
7. **Triangle budget derived from measured current values**, never hand-written (plan §2.1-6).
8. **Method split by geometry class** (plan §8 Appendix A): regular/man-made → LLM-written pure-data part rows; organic → img→3D GLB; small vegetation → stays procedural; mechs → Track A only.
9. **Every generated object carries a provenance record** — one row in `tools/ai3d/parts_manifest.json`
   naming **which method** (key from `tools/ai3d/provenance.mjs METHODS`) and **which img**
   (id + licence + source URL). No record ⇒ the review board lists it under 未記載來源 and it is not
   done. Never copy derivable numbers (extents, triangle counts, part counts) into that file —
   they come from the consumer part table and the GLB itself.

## 4. Execution queue (in order; each step names its environment)

### A. Photo gap-fill — env: GitHub Actions — ~15 min
Round 1 left these at/below half: `rock/collapse 0/4`, `rock/talus 1/4`, `landmark/lattice 1/4`,
`landmark/tank 0/3`, `building/window 1/4`, `building/roofcap 0/4`.
Root cause is almost certainly query wording + the ≥1024 px short-side filter, not supply.

1. Edit `PHOTO_CATALOG` queries in `tools/ai3d/fetch_photos.mjs` for the deficient parts
   (broader nouns, e.g. `"water tower"`, `"rooftop parapet"`, `"fallen boulder"`; keep 2–3 queries/part).
2. Push to the dev branch (path-filtered auto-trigger) **or** dispatch `照片庫抓取` manually
   (`workflow_dispatch`, inputs `family`, `limit`).
3. Success = `--plan` step shows all parts at target, licence re-audit step green, new `photo-db` artifact.
4. Do **not** loosen the CC0 regexes or the 1024 px filter to make numbers move.

### B. P2b pilot — LLM-written parts for one landmark — env: 3060 (or any machine with the photo artifact) — ½ day
Target: `watertower` (or `pylon`) in `public/js/beacons.js KIND_PARTS` — the plan's P2 pilot family.

1. Download the `photo-db` artifact; open the `landmark/tank/*` photos.
2. Rewrite/extend that kind's part rows (pure primitives, richer silhouette: tank ribs, riser legs,
   cross-braces) using the photo as **measurement reference only**. Keep nominal `foot` honest — the
   audit checks it **both ways** (no under-report, no padding).
3. Gates: `node tools/audit_beacons.mjs` (+ `--break-extent`), `node tools/audit_object_joints.mjs --seeds 8`,
   `npm test`, `npm run bal` (must be bit-identical — this is presentation-layer),
   then the review board (§7): add the provenance row, look at old-vs-new side by side, tick 通過.
   In-game smoke: the landmark reads better at lane distance, collider matches visuals.
4. This pilot needs **no Python, no GPU, no GLB** — it is the cheapest end-to-end proof of the method split.

### C. P0 + P2c pilot — first GLB parts (rock family) — env: 3060 — 1–2 days
1. **P0 (unchanged from plan §6)**: `tools/ai3d/.venv` with Python 3.10/3.11; install SF3D first;
   measure VRAM + seconds; record in this file. Fallback chain: SF3D → keep procedural.
   (TRELLIS/Hunyuan can wait; rocks do not need them.)
2. Pick 2–3 `rock/facet` photos from the artifact → `rembg` matte → SF3D → Blender headless:
   decimate, **origin on the mating face**, +Y up, strip textures, export
   `public/assets/models/parts/rock.glb` with named nodes (`facet_a`, `facet_b`, `collapse_a`).
3. Write the intake checker (extend `tools/ai3d/`): measures each GLB part's extent, verifies
   ≤ its fallback descriptor's extent, verifies triangle budget vs measured current rock triangle count.
4. Wire consumption: add `'rock'` to `PART_LIBS` in `public/js/partlib.js`; **beacons-style consumers
   only** at first. For `MEGALITHS`/`VEG_DEFS` (biomes), first implement the consumption-loop seam
   (plan §8 correction 1: optional `p.lib` next to `p.g`, resolved at build time — module-scope
   `libGeo()` can never work; and solve `giantCrownR` before ANY canopy part).
5. Gates: full static battery (skill §5) — `audit_object_joints --seeds 8`, `audit_beacons` ±reverse,
   `audit_traverse`, `audit_cel_pipeline`, `audit_visual_prefs`, `audit_gpu_lifecycle`,
   `npm test`, `npm run bal` (bit-identical), `shot_scene.mjs --venue taroko` before/after,
   30 s steady-state frame-time (desktop + touch emulation).
6. Provenance + review: `node tools/ai3d/intake_parts.mjs` must be green **and** the part needs its
   row in `parts_manifest.json` (method + img) before the review board (§7) counts it as done.

### D. Scale-out static (only after B and C are both green)
Batches of ≤5 assets, full gate set per batch (plan §6). Order: megalith facets → landmark upgrades
(mixed method) → building modules (LLM parts) → giant-tree parts (**after** `giantCrownR` fix).

**D-1 giant-tree canopies: DONE 2026-08-05** (§5g). What the next batch inherits from it:
1. **Measure the family before generating for it.** The per-part cap that fits rocks was meaningless
   for trees; the gate that mattered (per-species total) did not exist until the measurement did.
   Any new family gets its own `tri_budget.json families.<fam>` entry, measured, before wiring.
2. **Match the AI part to the fallback's *shape*, not to the slot's name** — `ico` rows only, because
   the envelope is what the offline contract checks. A `cone`/`box` row needs a part generated to that
   proportion, not a blob squeezed into it.
3. Remaining tree work: `buttress` + `fork` nodes (photo supply still short — Wikimedia PDFs/429s),
   then `VEG_DEFS` ordinary trees (**check the draw-call and triangle maths again**: ordinary
   vegetation has orders of magnitude more instances than the handful of giant trees).

### F0. 神木語料重採 — env: 3060(開放 egress)— **最優先;使用者定案 2026-08-07**

> 使用者定案:「**神木要重新找,有神木全身照片的圖,無其他干擾的照片**」。
> 下一支分支**先做這一項**,F(建築縫)排其後。
> **進度 2026-08-07(§5p + §5q)**:①選片閘 `screen_mattes.py` 上線(known-good 16 零誤殺 +
> 反向驗證)②`--plan` 改計可用張數 ③重採 +6 可用(16→22)④T2 黏土複驗 5/5 **不再碎裂、
> 不再生出遊客**(枯幹 ◎ 體積型)⑤**冠簇路線已定案(§5q)**:葉冠逐 seed 三注全不可用 +
> 斜側語料採集端死 ⇒ 冠簇維持程序 ico + 貼圖,img→3D 只收雕塑性主體(枯幹/板根/扭曲樹幹)。
> 剩:缺額續補(小時級節流,冷卻重跑同指令)。

**這是語料問題不是模型問題,而且已經有三組獨立證據**:SF3D(§5c/§5k)、Hunyuan3D-2GP
(§5m③)、TRELLIS.2-spz(§5n③/§5o 逐族對照)在**同一批 sequoia** 上全數碎裂,而同樣這三個
模型在岩石/建築上都出得來 ⇒ 差別只可能在輸入。換模型救不回來,已經換過兩次了。

**病灶具體是什麼**(§5o 的逐族對照表 `out_sheets/t2_tree.png` 一眼看得到):
①**畫面裡有人** —— 站在樹下當比例尺的遊客被當成主體的一部分,T2 兩張都**把人也生成出來**;
②**不是全身** —— 樹幹局部特寫,樹冠與樹根都不在框內,模型沒有輪廓可推,只能生出一片樹皮板;
③matte 剝不掉他們 —— RMBG 把站在樹前的人一併判成前景(它做的是前景/背景,不是「主體/非主體」)。

**採集條件(硬性,四條)**:
1. **全身**:基部/樹根到樹冠頂端都在同一個框內,樹佔畫面高度 ≥60%,但四邊要留白
   (matte 之後要取 bbox;貼邊會被裁掉,§5n 的 hoodoo 就是這樣變石板的)。
2. **無干擾**:畫面內**無人/車/欄杆/解說牌/步道護欄**;背景**不可有同高度的鄰樹交疊**
   —— 剝背景會把交疊的鄰樹連著剝進來,那和遊客是同一個病。
3. 單株、正面或 3/4;天空或均質背景最佳(§5m 落選族的同一條理由:背景同質才剝得乾淨)。
4. 授權仍是 **CC0/PD 雙閘 + 短邊 ≥1024**。**MUST NOT 為了湊數放寬**(§4-A 的原話),
   也 MUST NOT 用裁切/合成假造一張「全身照」。

**先看語料庫再決定抓不抓 —— 已經看過了,結論是「污染」不是「不足」**(2026-08-07,
`tree_matte_sheet.py` → `out_sheets/tree_mattes.png`,把既有 **82 張 tree 族 matte** 一次攤開):
人眼分桶大約是 —— **剝空/主體太小 ~25 張**(matte 之後畫面上什麼都不剩)、**葉片特寫/植物標本
~11 張**、**古書掃描/版畫/明信片等平面印刷品 ~13 張**、**主體根本不是樹 ~9 張**
(掃到烏龜、魚、骨頭、岩柱)、**含遊客 2 張**(正是 §5n/§5o 餵給 T2 的那兩張 sequoia,
matte 上就看得到人)、**真正可用的全身單株只有 ~16~18 張**。
⇒ **fetcher 的兩道閘(CC0/PD 授權 + 短邊 ≥1024)擋不住「這張是不是一棵完整的樹」** ——
查詢字是拿去比對圖庫的**文字後設資料**,不是比對畫面。所以 F0 的第一步不是再抓一輪,
是**補上選片閘**;再抓一輪只會等比例地再抓進 4/5 的垃圾。
既有語料裡當場可用的名單(sheet 編號 → 家/檔名,下一支分支可直接餵):
`03 bl_jacaranda` / `15·16·19·20·21·25 canopy` / `27 cf_araucaria` /
`34·35·36 cf_juniper_tree` / `45 gt_cryptomeria` / `56 sp_acacia` /
`58·60 sp_baobab` / `64 sp_conifer` —— **acacia / baobab / canopy 這幾家正是「曠野孤立單株、
背景是天空、沒有遊客」的典型**,與下面的策略互相印證。

**取得策略(關鍵:別再往 sequoia 鑽)**:
- **紅杉的失敗是結構性的** —— 它出名的原因就是「大到拍不下」,所以絕大多數照片不是
  遊客當比例尺就是仰角局部;換查詢字救不回這件事。
- **樹種放寬**:遊戲要的是「神木 = 巨木」,不必是紅杉。**猴麵包樹 / 龍血樹 / 曠野孤立橡樹 /
  孤立松柏**這一類天生就是單株立在空地上、背景是天空、沒有遊客 —— 命中率高一個量級,
  而且正好滿足全部四條。`VEG_DEFS` 消費的是**冠簇/樹幹/板根**這些零件,不是「這是哪一種樹」。
- 查詢字往**孤立單株**走(`lone tree`, `isolated tree against sky`, `solitary baobab`,
  `tree full height silhouette`),而不是 `sequoia trunk` 這種必然回傳局部特寫的字。
- 每一株候選 MUST 跑 `tools/ai3d/photo_sheet.mjs` 人眼複核(既有紀律:**先看照片再看網格**)——
  「有沒有人、是不是全身」這兩件事**沒有便宜的統計特徵**,別想用 fill 之類的尺代勞。

**選片閘要做成什麼**(便宜的先做,別一開始就想自動化):
- **人眼 sheet 是主判準**(`photo_sheet.mjs` / 上面那支 `tree_matte_sheet.py`)——「有沒有人、
  是不是全身」沒有便宜的統計特徵,MUST NOT 想用 fill 之類的尺代勞(§5n 已經示範過一次
  「拿為別的模型設計的尺去判死」會發生什麼事)。
- 但**四個桶裡有三個是統計抓得到的**,值得先自動淘汰掉再送人眼:①**剝空** = matte 的
  alpha 覆蓋率過低(這一桶最大,~25 張,而且純算術);②**平面印刷品**(古書掃描/版畫/
  明信片)= alpha 幾乎填滿整個矩形 + 四角都是不透明 ⇒ 「主體是一張紙」;③**葉片標本** =
  極高的 alpha 覆蓋率 + 長寬比接近 1 + 背景純色。剩下的「不是樹」與「含人」才需要人眼。
- 這一支腳本住 `tools/ai3d/`(離線,零 npm 依賴,A2)還是留在 study clone,由下一支分支定;
  真正重要的是**結論要回寫進 `fetch_photos.mjs` 的 `--plan` 帳**,否則下一輪又會以為抓夠了。

**驗收**:①選片閘跑完後 `tree/*` 的**可用**張數(不是下載張數)到位 + 授權稽核仍綠;
②contact sheet 逐張人眼確認「全身 + 無人 + 無交疊鄰樹」;③選 3~5 張重餵一次 T2
(**matte MUST 先二值化 alpha**,>16 → 255,§5n)並出**黏土**對照 —— 通過才輪得到入庫,
不通過就回到 ① 繼續採。**MUST NOT 拿 §5k 那批舊 sequoia matte 重跑**(matte 上就看得到
遊客,重跑只會再證明一次同一件事)。

### F. 建築整棟節點的消費端縫 + T2 入庫路徑 — env: 3060 — **步驟 1~2 DONE 2026-08-08(§5aa);3~5 待續**

> **範圍覆寫(2026-08-08 使用者定案)**:`docs/ai3d_asset_plan.md` §8.1 同日稍早把 `BUILDERS`
> 列為「不做」(「只做景觀樹木與石頭」);使用者被問到這條衝突時選擇**執行佇列 F**。
> plan §8.1 已標注這條覆寫,以本節為準。
>
> **進度:步驟 1~5 全數 DONE**。①**先量再開**(§5aa-b:四場 `--live` 實測 + 逐實例尺寸普查;
> 量測直接否決「整桶換」—— 逐節點只有 36 tris)②**縫**(§5aa-c:`BLD_LIB` 第四桶
> `mass`,輪替名冊 + `pick_n = 16` 子集;A/B 逐位元相同)③**入庫路徑**(§5t 的
> `solidify_parts.py` + 本輪補上的 `normalize_parts --boxuv`)④**首顆節點入庫**
> (§5ab:`building/mass_a` 2,898 面,來源是 §5n 就生好的 Art Deco 摩天樓)
> ⑤**驗收全綠含 `audit_traverse`**。剩下的只有**真機冒煙**與**名冊擴充**,見 §5ab-f。

前置全部備齊:生成器有了(§5n,T2-spz 建築雙 ◎、幾何 + PBR 一次出)、減面路徑量過了
(§5o,**MUST 先實體化**)。缺的只有**消費端** —— 建築目前沒有「整棟」這個節點,
所以 §5i 以來每一顆建築產出都只能停在硬碟上(§5i/§5m/§5n/§5o 待續同一條)。
順序 MUST 是**先開縫、再入庫**(§5m ④ 的原話:「先開縫再入庫」)。

1. **先量再開**:建築整棟的三角形預算沒有量過,而 §5o 已證明 **500 面這一級留不住識別特徵**
   (Art Deco 的退縮量體被抹平,`dev_p95` 0.0088 → 0.0144)。先跑
   `tools/ai3d/measure_building_tris.mjs` 取得現值,再定 `tri_budget.json families.building`
   的整棟級距 —— 預算與縫 **MUST 同一輪定案**,分兩次做的話縫會照舊 400~900 開下去,
   而那個級距生出來的每一棟都是同一團方塊(D-1 教訓的同一條:先量家族再為它生成)。
2. **縫開在哪**:~~建物是 `biomes.js` 的 `BUILDERS`~~ ⚠ **筆誤,已更正(§5aa-a)**:`BUILDERS`
   住 **`hazards.js`**(障礙物),與城市建物無關;真正的消費端是 `biomes.js` 一般建物繪製段的
   `InstancedMesh`(單位 `BoxGeometry` + **6 材質群組** + 逐實例 `scale = (w,h,d)` + 逐實例 tint,
   逐立面款各一個)。它與 `beacons.js KIND_PARTS` 的零件式**不是同一種消費端**。整棟節點 MUST 維持
   ①碰撞/LOS 仍走既有有向盒(A30:看得見多粗 = 撞得到多粗 = 打得到多粗,權威幾何一格不動)
   ②`['lib', name, fallback]` 的保險絲契約(`partlib.js`;庫載不到就走程序生成)
   ③**佈局數學只讀保險絲**(§2.3:庫幾何隨載入成敗而異,佈局讀它 = 跨客戶端分家)。
3. **T2 入庫路徑要先定案**(→ §5t 已定案:選項 (a) 落地為 `tools/ai3d/solidify_parts.py`,
   參數已掃描;建築批直接沿用):`normalize_parts.py` 目前沒有實體化那一刀,而 Blender 沒有
   volumetric resample。兩個選項 ——(a)入庫**前**的離線步驟(pymeshlab,住 study clone
   或 `tools/ai3d/` 的 venv,**MUST NOT 進 `package.json`**,A2);(b)`normalize_parts.py`
   多吃一個 `--solidify` 旗標。傾向 (a):新相依不進出貨路徑,且 §5o 的 C 路徑參數
   (cell = 對角線/256、offset = 對角線 ×0.6%)還沒掃描過,先留在量測側。
4. **入庫閘照舊**:`intake_parts.mjs` 外廓契約 + 三角形兩道閘(單件 ≤ 族上限、逐款
   Σ 庫零件 ≤ `kind_factor` × 該款現值);`provenance.mjs METHODS` 這一輪才第一次加
   `trellis2_spz` 鍵(§5n/§5o 都是零節點出貨所以沒加),帳列 MUST 含 `imgs[].file`。
5. **驗收**:`intake` / `siteplan` / `audit_object_joints` / `beacons` ±reverse / `gpu` /
   `soft_stroke` / `cel` / `visual_prefs` 全綠 + `npm test` + `npm run bal` 不動(地物散布,
   伺服器不涉入)+ 3D 零件對照台 0 缺件 / 0 孤兒 / 0 未記載 + 真機冒煙。
   **`audit_traverse`(㋓)這次不能省** —— 整棟建物會動到街廓夾出來的通道寬。
6. **不要順手做的事**:①神木族**不要拿現有語料**再餵 T2(§5n③/§5o 逐族對照都證明碎裂 +
   把照片裡的遊客一起生出來)—— 那條走**佇列 F0**(重採全身無干擾照片)才有意義;
   ②hoodoo 那張的失敗是 matte 軟 alpha
   被 T2 前處理裁掉(§5n),餵 T2 的 matte **MUST 先二值化 alpha**(>16 → 255);
   ③岩石類有逐 seed 方差(浮雕化/貼圖掉色),要出貨得 per-seed 重抽,別只跑一顆就下結論。

### E. Track A dynamic (plan §3/P3–P4) — env: 3060 — unchanged
Do not start before D's first batch ships; the rig contract makes failures 10× more expensive.

## 5b. Trial log (2026-08-05, 3060-machine session — step A + step B)

- **Step A ran locally, not on Actions** (allowed by §2: the 3060 box has open egress; faster feedback
  and photos land exactly where B/C consume them). Round-1 `photo-db` artifact downloaded into
  `tools/ai3d/` first so the resumable manifest semantics hold.
- **429 root cause measured**: Openverse *search* quota is healthy (`x-ratelimit-available-anon_sustained: 199/200`);
  the failures are *downloads* from `upload.wikimedia.org` (Varnish edge, `Retry-After: 600`) — most
  Openverse CC0 hits are Wikimedia-hosted originals of several MB. After ~30 downloads the IP is
  throttled; each subsequent 10-min window admits ~2–3 more.
- **Three fetcher fixes** (all in `tools/ai3d/fetch_photos.mjs`):
  1. `seen` now counts only `ok` entries — transient failures no longer permanently block a photo
     (old behaviour contradicted the header's "resumable" promise: one throttled run blackballed
     every candidate it touched).
  2. Commons fallback now also fires when Openverse *returned results but every download failed*
     (previously only on zero results — an entirely-throttled query never degraded).
  3. HTTP 429 ⇒ early-exit the whole round (`cooled` flag) and **do not write the failure to the
     manifest** (it is the round's network state, not a fact about the photo); 179 stale 429 rows
     pruned from the manifest.
- Gap-fill result: **all 14 parts at target** (55 photos, licence re-audit 55/55 CC0/PD). The last
  four photos (`lattice` 1, `tank` 3) needed a cooldown-retry loop (~11 min/round, 3 productive
  rounds) — budget for that whenever bulk-fetching from this IP again.
- Tank photo cross-check (after the rewrite landed — throttle delayed the photos): the Dallas-type
  four-leg tower photo confirms the part vocabulary (X-brace panels between horizontal struts,
  central riser, bottom ring, conical roof + finial). One deliberate deviation: legs stay vertical
  (two-segment taper) instead of splaying — the tilted-part extent tax is documented in the
  part-table comment.
- **P2b executed** (§4-B): `tank` rewritten as 57 pure-data parts (was 12). Two engineering notes
  now recorded in the part table's comment: ① tilted parts pay the 3D-half-diagonal extent tax
  (foot 5.2→5.6 for a true visual extent of ~4.3); ② `buildBeacon`'s `stretch` scales tilted parts'
  *position* but not *length* ⇒ X-braces must anchor on the vertical leg axes (+0.18 m end margin),
  never on horizontal strut endpoints. A centre-y doubling bug in the brace math survived the extent
  audit (extent ignores y) and was caught only by the **screenshot loop** — keep shooting before/after.
- **SF3D licence gate probed**: `hf` CLI (logged in as `winniexchang`) cannot see gated
  `stabilityai/stable-fast-3d` ⇒ owner must accept the licence on HF (and the token must allow
  gated-repo read) before P0 venv work is worth starting. Blender also absent (owner install).

## 5c. Trial log (2026-08-05, 3060-machine session — step C prep after owner unblocked installs)

- **P0 environment fully built** (weights are the only missing piece):
  `tools/ai3d/.venv` = uv-provisioned CPython 3.11.11; torch **2.5.1+cu121** (`cuda.is_available()` ✓
  on the 3060); all SF3D requirements; **both native extensions compiled on Windows**
  (`texture_baker`/`uv_unwrapper` real `_C.cp311-win_amd64.pyd`, ~34 s / ~14 s builds, VS2022
  Community + CUDA toolkit 12.6, `uv pip install --no-build-isolation` after `uv pip install
  setuptools wheel ninja` — uv venvs ship without pip/setuptools). `from sf3d.system import SF3D` OK.
  Blender **5.2 LTS** installed via winget. Vendor clone + venv + weights dirs are gitignored.
- **SF3D weights still 403** after the owner reported accepting the licence — the API answer is
  "not in the authorized list" for the `winniexchang` token (x111281@gmail.com). Public files
  (LICENSE/README) download fine ⇒ the token works; the *grant* is missing. Accept on
  https://huggingface.co/stabilityai/stable-fast-3d while logged in as that exact account.
- **HF Space fallback measured and rejected**: the official `stabilityai/stable-fast-3d` gradio
  Space is a *stateful event chain* — `/run_button` via `gradio_client` raises a hidden upstream
  exception, and `/requires_bg_remove` returns a UI-update dict, not a model (session state the API
  client never populates). Do not budget time on driving it headlessly; plan §8's "Space fallback"
  is browser-manual only.
- **Photo pool quality finding (the big one for Track B)**: numeric targets ≠ usable inputs.
  Human review of every rock candidate: **~1/15 usable** for image→3D — the CC0-only corpus is
  dominated by museum scans, stereograph cards, watercolours, night shots and scene photos
  (licence gate stays; this is an input-curation problem, not a licence problem). Two remedies that
  worked, in order: ① **query for named single-object landforms** — `glacial erratic` returned a
  33 MP, frame-filling, evenly-lit single boulder (now `rock/collapse ov_4a7de829`, the pilot's
  primary input); ② **crop single subjects out of scene photos** (still CC0) — `facet_a_crop.png`
  from `ov_92b0`'s left boulder. Also: one Commons "photo" was a 148-page **PDF** (fetcher should
  gain a magic-bytes/MIME check some round).
- **Intake checker + measured triangle budget shipped** (runbook C.3 done ahead of the GLB):
  `tools/ai3d/intake_parts.mjs` executes the beacons pure block for `['lib', name, fallback]`
  descriptors, parses GLB by hand (zero npm deps), verifies vertex extents fit the fallback
  envelope **both ways** (over = A30, under-half = bloated upper bound) and triangle count ≤
  `tri_budget.json` (measured: synthMegalith across 200 seeds min 85 / p50 380 / p90 548 /
  **max 1071**, factor 1.0 with recorded justification).
- **Next single action when the gate opens**: `hf download stabilityai/stable-fast-3d --local-dir
  tools/ai3d/weights/sf3d` → run one image through `vendor/stable-fast-3d/run.py` (venv python,
  `--texture-resolution 512`), record VRAM/seconds here → Blender headless normalise (origin on
  mating face, +Y up, strip textures, named nodes `facet_a`/`collapse_a`) → intake checker →
  wire `PART_LIBS = ['rock']` + cairn `['lib', …]` descriptors → full static battery.

## 5e. Trial log (2026-08-05, 3060-machine session — P2c executed: first GLB parts shipped)

- **Gate opened** (owner accepted the licence) → weights downloaded (4.02 GB, ~6 min).
  **Measured**: cold run 3 m 02 s (includes one-time dinov2/CLIP aux downloads), **warm run 13.6 s
  for 2 images end-to-end, peak VRAM 6.17 GB** at `--texture-resolution 512` — comfortable on the
  12 GB 3060; plan §1's "SF3D 6 GB" confirmed.
- **Do not decimate raw SF3D output in Blender** — the ~50k-tri shell tears into dark speckle
  holes at 50:1 ratios (first attempt, visible in the screenshot loop). Use SF3D's own
  `--remesh_option triangle --target_vertex_count 520` → clean solid ~944/808-tri meshes straight
  out; Blender then only centres/scales/strips (its decimate stays as a mild safety trim, e.g.
  808→588 for the 0.85 m node — harmless at that ratio).
- **Input curation is a mesh-level fact, not just a photo-level one**: batched all 15 matted rock
  candidates through SF3D (13.6 s… batching is ~free) and contact-sheeted the meshes — only
  **5/15 solid** (indices 2/6/8/9/11); crops-from-scene-photos (`facet_a_crop`) and museum-scan
  survivors all came out as thin shells or flakes. §5c's "~1/15 usable" holds at the mesh stage
  too; the reliable route stays "named single-object landform" queries. Batch + contact sheet is
  now the standard pick flow (render script kept in scratchpad; promote if reused).
- **Final picks** (node = consumer role, photo family ≠ node name): `collapse_a` ← batch 6
  (facet `ov_f7e1cc51`, blocky), `facet_a` ← batch 11 (collapse `ov_62d21e5a`, lumpy),
  `facet_b` ← batch 8 (collapse `ov_0012000f`, smooth, +137° yaw for same-source disguise).
- **`normalize_parts.py` shipped** (tools/ai3d): centre-to-origin + envelope-fit (FIT 0.95) +
  strip materials/UV/colour + optional per-node `ry`/`dy`. `dy` exists because real boulders are
  flatter than the fallback ico — centring left the base stone hovering 12 cm; `dy −0.12` puts its
  underside at −0.9 = the consumer's `p.y`, so it grounds at **every** stretch value (`py·s − hy·s`).
  Field separator is `|` (`:` collides with Windows drive letters).
- **Wiring**: `PART_LIBS = ['rock']`; cairn's three stack stones → `['lib', 'rock/…', ['ico', r]]`
  with the old ico as fuse. `foot` untouched — `partExtent(lib) ≡ fallback extent` by contract.
- **Gates all green**: intake 14/14; `audit_beacons` 68 + `--break-extent` reverse-red;
  `audit_object_joints --seeds 8` 21311 joints / 0 anomalies; cel 52 / visual_prefs 124 / gpu 54 /
  siteplan 168; e2e green (fresh server on 8666, user's 8620 servers untouched); bal green and
  structurally bit-identical (balance tooling imports neither beacons.js nor partlib.js nor the GLB).
  **Visual closure** via new `tools/shot_beacons.mjs`: same seed shot twice — fuse path (no
  `loadPartLibs`) renders the old all-ico cairn, lib path renders the three AI rocks solid and
  grounded, collider cylinder overlaid (r 2.28 unchanged — set by the untouched scatter stone).
- **`audit_traverse` ran on the 3060** (first time on this machine; warm `.scen_cache` copied from
  the main checkout): **89 pass / 20 fail — and the failure set is line-for-line identical at the
  pre-change commit 2c1d123** (A/B in the zen-albattani worktree, same cache). So it is a
  **pre-existing baseline red** (bridge mid-deck / underpass-interior waypoints unreachable in 14
  venues + several collapsed bridge-clearance readings, e.g. 0.45 m), not something this change
  introduced — structurally it cannot be: traverse's pipeline (venue_field/terrain/biomes flood)
  never touches beacons/partlib/the GLB. Tracked as its own issue outside this runbook.
- Remaining smoke (interactive, next real-game session): walk past a cairn in taroko + 30 s
  steady-state frame time. Expected delta is negligible: +~2.2k tris per cairn, merged into the
  same colour buckets (draw-call count unchanged), few cairns per map.

## 5f. Trial log (2026-08-05, 3060-machine session — biomes seam + giantCrownR resolution)

- **Seam shipped**: `biomes.js` now imports `libGeo`; a single build-time resolver
  `const partGeo = (p) => (p.lib && libGeo(p.lib)) || p.g;` sits next to `vegSoftKind`, and
  `buildVegMeshes` draws `partGeo(part)`. That is the **entire** code change (plus comments) —
  no `lib:` rows exist in any table yet, so today's frame is bit-identical, same as P1's landing.
- **The `giantCrownR` "hard blocker" dissolved by contract, not by code** — and the plan's own
  proposed fix (vertex scan) turned out to be a latent bug: crown radius feeds `planShyGrove`
  (shrink + lean) → items → blockers → `blocked` cells → every later placement. A GLB-derived
  radius varies with **load success**, so scanning loaded geometry would diverge the whole layout
  per client (§2.3) with zero error message. Resolution: **layout math (`giantCrownR`, `vegSpan`)
  reads the fuse `p.g` only**; the intake envelope (GLB ≤ fallback, ≥ half) makes fuse-derived
  radii conservative — gaps err wider (原則 6), canopy shyness never under-spaces. Canopy GLBs
  are unblocked with `giantCrownR` untouched. Plan §8 correction 1 annotated so nobody
  "re-fixes" it into the scan.
- **Audit support** (原則 9): 3 new assertions in `audit_siteplan` Ⅴ — ① exactly one `libGeo(`
  call in biomes and it is `partGeo`'s definition; ② the veg loop draws `partGeo(part)`;
  ③ `giantCrownR`/`vegSpan` stripped source contains no `libGeo`/`partGeo`/`.lib`.
  Reverse-verified both ways (crown reading `partGeo` ⇒ ③ red; a second inline `libGeo` call in
  the loop ⇒ ①② red). 168 → 171 items.
- **CRLF found a real audit bug**: `audit_road_joint` red'd "dropLaneBridges 恰一份實作一個呼叫點"
  on this machine — **pre-existing, not this change** (A/B: HEAD content converted to CRLF reds
  identically; `git show` LF content passes). Root cause is the exact ㋑ trap: it used raw
  `readFileSync`, and this workspace is CRLF-checked-out (`core.autocrlf=true`) ⇒ per-line
  `//.*$` comment-stripping silently fails ⇒ a comment mentioning `dropLaneBridges(` joins the
  count. Fixed to `readSrc` (86/86 green). ~22 more audits still use raw `readFileSync` and may
  be silently *weaker* on CRLF — spun off as its own task (chip), do not fold into this branch.
- **Gates** (this machine, CRLF workspace): siteplan 171 (+ both reverse modes red);
  soft_stroke 73; beacons 68 + `--break-extent` reverse-red; object_joints `--seeds 8`
  21311/0; gpu 54; cel 52; visual_prefs 124; open_tunnel 159; underpass 155; road_joint 86;
  climb 211; ground_qc/seam/enclave, terrain_ray 11, bridge_crossing 16, water_skirt 8,
  bridge_tower_pad 23, road_bed 16, world_text 57, vernacular 287 — all green. `npm run bal`
  green (balance tooling imports neither biomes nor partlib). e2e on a fresh worktree server
  (port 8666, user's 8620 untouched): green.
- **Next consumer note** (queue D): `MEGALITHS`/`synthMegalith` are imperative builders running at
  biome-build time — they need **no seam**, just guarded `libGeo('rock/…') ?? primitive` at the
  call site (zero extra `rnd()` either way; no in-place geometry mutation ⇒ no clone). The
  declarative seam above covers `VEG_DEFS`/`GIANT_DEFS`/`GIANT_DECO`. Road props / civic parts
  stay LLM-parts territory (method split) — do not extend `partGeo` there.

## 5g. Trial log (2026-08-05, 3060-machine session — queue D first batch: giant-tree canopies)

First consumer outside beacons. What was actually new (the rest was the rock recipe replayed):

- **A triangle budget that a per-part cap cannot express.** Measured first (playwright, biomes source
  + real three): a whole giant tree today is **259–402 tris** across 13–20 parts, and one canopy
  cluster is **20** (an `ico`). An AI part cannot be 20. Cap-per-part alone is a trap here: swap every
  canopy on a tree and each part passes while the tree becomes 20×. So `tri_budget.json` gained
  `families.tree` with **two** gates — per part ≤ heaviest whole tree today (402, same rule shape as
  rock), **plus per-species Σ(library parts) ≤ 4× that species' current total**. Measured outcome:
  2.2–3.7×, worst species meranti 315 → ~890. Draw calls unchanged (one InstancedMesh per part row,
  before and after).
- **Only `ico` canopy rows are swappable, and that is geometry not taste.** A `cone` fallback's
  envelope is `{r, h/2}` (e.g. `cone(7,26)` = r7 / hy13) — fitting a canopy blob into it stretches it
  into a column. `ico` is a sphere, which is what a photographed crown actually fits. Two species
  (klinki, alerce) are **deliberately left alone**: their crown clusters are 2.2–3.0 m, smaller than
  the smallest node (3.325), and forcing them in would break the envelope contract.
- **Non-uniform scaling added to `normalize_parts.py`** (`"r x hy"` target form; `"r"` keeps the old
  equal-ratio path bit-identical for rock). Real crowns are flatter than a sphere: fit equal-ratio and
  the node under-fills the vertical envelope, then the part row's `sy` squashes it again into a pancake.
- **Input curation, again, is the whole game.** First 14 tree photos → **1 solid mesh** (the queries
  `tree crown isolated sky` / `buttress root rainforest` return herbarium sheets and dark forest
  scenes). Re-queried for *named single subjects* — `solitary oak tree meadow`, `lone tree field`,
  `isolated tree grassland` — and 6 photos gave **5 solid meshes**. Same tool, same params. §5c's
  finding generalises: the wording of the query beats every model knob.
  `buttress` is still short (Wikimedia keeps serving book-scan PDFs and 429s) — buttress/fork parts
  are **not done**, and the ledger says so rather than pretending the family is complete.
- **Two seams extended rather than copied** (原則 2): `parts_src.mjs` gained `bioLibDescs()` — it
  executes the `VEG_DEFS`/`GIANT_DEFS` source with `cyl/cone/ico` **stubs that return descriptor
  arrays**, so biomes rows land in the exact same vocabulary `fbEnvelope` already speaks; and the
  review board now derives rows from both consumers, building the veg side with the game's own
  `buildVegMeshes` (exported for this; no second assembler on the board).
- **A gate that counts what it cannot execute.** `bioLibDescs` also returns the raw count of `lib:` in
  the source; intake reds when it differs from what the executable tables yielded — otherwise a `lib:`
  row added to `GIANT_DECO` (which builds `THREE.TorusGeometry` directly, so the stubs cannot reach it)
  would simply never be verified. First run of that gate went red on **its own doc comments** —
  the ㋑ trap in miniature: source counting must strip comments.
- **Provenance: one record can own several keys.** A size ladder is one generation job baked at
  several scales; four entries with `keys: [...]` beat twelve near-identical ones (and twelve would
  drift, with the stale ones still looking fine). `loadProvenance` now accepts `key` or `keys`.
- **Not yet done**: in-game smoke (walk a grove + 30 s steady-state frame time) and `audit_traverse`
  (㋓ network; canopies touch no collider — trunk colliders are registered by the scatter code and are
  untouched — so no route can change, but it has not been run). `audit_ui_layout` reds on this machine
  **identically at the pre-change tree** (A/B'd via `git stash`) — pre-existing, unrelated.

## 5h. Trial log (2026-08-05 night, 3060-machine session — scale-out campaign, user redirect)

**User decisions (this session; supersede where they conflict):**
1. **所有物件(神木/巨石/建築)一律照片→img→3D**,大量下載**不同樹種**的照片 —— §3 rule 8 的
   method split 修訂:building modules 從 LLM-parts 改走 img→3D GLB(landmark 純資料表維持);
   樹族改**逐樹種**列(11 神木種逐種對位 + VEG 常見種)。
2. **無視舊有物件、不要只是原版重繪** —— 落地為:①逐樹種專屬冠簇(現況 9 種共用 4 形 →
   每種自己的形狀);②巨岩塊/hoodoo 換實拍;③包絡契約不變(fuse 仍是尺寸上界,「新設計」
   改的是形狀來源,不是尺寸紀律)。
3. 機體維持 rig 槽位契約(骨架 = ControlNet 類比),**3D 外皮全新設計** —— 即 Track A 原案;
   出圖以 codex 設計敘述為權威(`--no-ref` 模式本來就是這個語意)。

**Landed:**
- **Megalith seam(D-2,狀態帳)**:命令式建造端的第一個消費端。要點:megaGeo MUST clone
  (`bakeContactAO` 就地 setAttribute 頂點色 —— 共用庫幾何被烤一次,全場帶著別顆岩的 AO);
  節點契約 = **單位包絡**(ico(1)),呼叫端 mesh.scale 拉尺寸 ⇒ 一顆節點服務任意大小;
  rnd 枚數兩條路恆等(佈局逐位元不變);`audit_siteplan` Ⅴ 改釘「恰兩份解析(partGeo+megaGeo)
  + 呼叫點凍結清單 5 處 + col/anchor 回傳塊無庫引用」。`audit_object_joints` 的 megal 沙箱
  要多抽 MEGA_LIB/megaGeo 兩段並注入 `libGeo = () => null`(= 走保險絲;接合真相在保險絲上)。
- **mesh_stats.mjs(新工具)**:封閉網格有號體積 ÷ 包圍盒 = 實心度(fill)。塊狀候選
  fill ≥ ~0.34,薄殼/碎片 < 0.15 —— 19 顆 6 中,與 §5e 人眼結論一致;人眼只需複核前幾名
  (本輪抓到兩顆統計合格但語意錯誤的:博物館老照片**有人入鏡**、立體鏡**雙聯卡** ——
  fill 篩不掉「內容錯誤」,人眼那一步不可省)。
- **fetch_photos 逐主機節流**:429 只封該主機(upload.wikimedia.org),其他主機照抓;
  舊制「一顆 429 整輪收工」讓 Commons-heavy 的零件把整輪陪葬,排後面的樹種列永遠輪不到
  (同一個病灶的另一面:工作清單順序 = 優先序,樹種列 MUST 排在 fork/buttress 前)。
- **normalize_parts --base**:追加節點時整支匯入既有 GLB 原樣保留 —— 舊節點不重跑
  (重跑 = 減面/縮放重算,位元漂移)。
- **agy 額度牆**:t01 七槽 2D 切圖兩輪全數 429 RESOURCE_EXHAUSTED。額度是模型級
  (gemini-3.1-flash-image),與 read_file 權限無關。P3 停在牆前,models.js 一行未動。
- **樹族的真瓶頸不是張數,是「CC0 = 館藏數位化」**(本輪最重要的一個發現,也推翻了
  §5c/§5g「換個查詢措辭就好」的樂觀版本)。逐樹種查詢**照張數是成功的**(baobab 6/6、
  maple 6/6、cypress 5/5、sequoia 6/6),但 26 顆 SF3D 產出逐張看過去,`fill` 排名最前的是:
  1832 年的**猴麵包樹石版畫**、19 世紀伐木營地的**蛋白相紙**、**臘葉標本壓葉**(白色標本帶
  清晰可見)、**立體鏡雙聯卡**、鉛筆素描明信片。授權全部合法、解析度全部達標、統計全部合格
  —— 只是它們不是現代單體攝影。成因是結構性的:CC0 語料的重心是博物館/圖書館的數位化館藏
  (實測供應者分佈:rawpixel 50 / Commons 20 / Cooper Hewitt 13 / …)。
  **兩層對策**:①`mesh_stats.mjs` 的 fill 只篩得掉薄殼,篩不掉「內容錯誤」⇒ 人眼那一步
  **不可省**(這一輪它擋下了六顆);②fetcher 加 `excluded_source`(排除純館藏型供應者;
  rawpixel 刻意留著 —— 它同時供應現代攝影與公版版畫,砍掉會連最好的那幾張一起砍)。
  ⇒ **逐樹種專屬冠簇本輪只推進到 6 形**(新增 e/f 兩形,拆開 dougfir/sitka/taiwania 原本
  共用 `canopy_d35` 的三種),不是 11 形。誠實記在這裡而不是報成完成。
- **playwright 補上了**(`npm install -g playwright` + `npm link playwright`)。兩個注意:
  ①ESM `import` **不吃 `NODE_PATH`**(那是 CJS 的機制)⇒ memory 裡那條「全域 + NODE_PATH」
  對 `.mjs` 工具無效,要 `npm link`;②**本儲存庫的 `node_modules` 是受版控的**(唯一依賴 ws
  隨庫附帶,A2)⇒ `npm link` 會改到 tracked 的 `.package-lock.json`,MUST 還原並把連結
  加進 `.gitignore`,否則看起來像「本專案依賴 playwright」。`shot_giants.mjs` 的 8620 硬編
  URL 順手改成可指定。
- **建築族擋在預算量測**(不是擋在照片):chimney 5/5、rooftank 5/5 已到位,但
  `families.building` 的三角形上限 MUST 量測(§2.1-6),量法與 tree 族同樣是 playwright 頁內
  執行 `LANDMARKS` 原文 + 真 three。**MUST NOT 手寫一個好看的數字** ⇒ 停在這裡,下一輪第一件事。

## 5i. Trial log (2026-08-06, 3060-machine session — 建築族首批:使用者定案「大量下載不同國家/城市/小鎮/風格的建築物照片再 img→3D,無視舊有物件直接畫,禁止使用原版重繪」)

- **兩個資料家並存**(§5d 的單一資料家已不成立,記清楚免得下一輪撲空):venv/vendor/weights
  住 `zen-albattani-b33990/tools/ai3d`(絕對路徑,不可搬);**照片庫/photo_manifest/matte/SF3D
  產出住 `reverent-pascal-fcd63e/tools/ai3d`**(§5h 那一輪在那裡跑的 fetch)。本輪流程:目錄改在
  本 worktree → `cp fetch_photos.mjs` 到 reverent-pascal 跑 fetch;matte/run.py 用 zen 的 venv、
  吃 reverent-pascal 的檔案。GLB/manifest/預算檔一律落在**本 worktree**。
- **InstancedMesh 桶的預算與 rock/tree 是不同的幾何學**(本輪最重要的方法結論):一顆節點
  幾何被全桶 instance 共用 ⇒ GPU 成本 = 節點 tris × instance 數,「單件 ≤ 最重整件」在這裡毫無
  意義。故 `families.building` 的逐桶節點上限 = (whole_factor−1) × 配件桶總量上界 ÷ 名冊桶數 ÷
  該桶 instance 上界(全部量測/可數:`measure_building_tris.mjs` 三個最密市區 --live 實測
  chimneys 212 / roofTanks 97 / roofBoxes 117,配件桶合計上界 50,936 tris,全場 1.47M~1.72M)
  ⇒ chimney 240 / tank 525 / acbox 435;名冊全換滿的最壞情況 = 4× 現值(≈204k,佔最重場景
  11.8%)。`parts_src.triBudget()` 新增 `nodeCap(fam, kind)`,intake 與對照台同吃。
- **接線 = 桶建構表,不是逐呼叫點散裝**:`BLD_LIB` 名冊(單位包絡:box(1,1,1)/cyl(1,1,1),
  instance scale 本來就是尺寸)+ `bldGeo` 守衛 + **`buildBldBucket` 桶建構表**(單位 primitive
  保險絲 + 桶色 + InstancedMesh 一次定案;遊戲三個呼叫點與對照台 `bld` 建構器同吃 ⇒ 台上
  沒有第二套組裝器)。零 rnd、draw call 逐位元不變、屋頂配件本無碰撞柱(A30 的「佈局讀庫」
  問題天然不存在)。`audit_siteplan` Ⅴ 改釘「恰三份解析 + bldGeo 只在三桶 + 消費點恰 3 處」,
  反向驗證(拔煙囪桶保險絲 ⇒ 紅 2/3)。
- **建築照片是 SF3D 的甜蜜點**:79 張 matte 全批(tvc 520)→ mesh_stats 塊狀候選 ~30/79
  (樹/岩輪次是 ~1/15)—— 建築天生塊狀。但**人眼那一步照樣不可省**:統計前段照樣混進
  蒙古包**有人入鏡**(§5h 同款)、整片屋頂**場景照**(rooftank 查詢命中率 0/5 可用)、
  以及兩顆統計合格語意荒謬的**蛋形/球形**(window 立面照的 SF3D 產出)。contact sheet
  渲染器升格為正式工具 `mesh_sheet.mjs`(§5e 備註「reused 就 promote」兌現)。
- **首批兩顆**:`chimney_a` ← 磚砌工業煙囪仰拍(brick chimney,rawpixel CC0;938 → 234 tris
  ≤ 240)、`ac_a` ← 白色商辦量體(building rooftop 查詢;節點角色 = 屋頂機房箱,照片族 ≠
  節點名;986 → 426 ≤ 435)。normalize 非等向 0.6×0.5 / 0.65×0.5 —— box 包絡 r 0.707 容得下,
  但桶的 S=(w,h,w) 以**軸寬**為準,貼滿 0.707 會比原單位盒視覺胖一圈(對角 vs 軸向的差,
  mega 的 ico 包絡沒有這一題)。
- **人造直線輪廓的減面路線與岩族相反**(實測,兩張截圖都留在 §5i 這一輪的 out 目錄):
  SF3D 超低 tvc 的等向 remesh 會把直線磨圓 —— tvc 120 的煙囪是**彎香蕉**、tvc 220 的方箱是
  鵝卵石(岩族 tvc 150 沒事:岩石本來就是塊團)。正確路線 = 挑選版 tvc 520 出貨 + normalize
  內建的 Blender collapse decimate 溫和減面(3.9:1 / 2.3:1;§5e「溫和減面無害」的上緣)。
  另:單位包絡節點的**遊戲內模樣**要把 instance scale 烤進去才看得出來(俯拍預覽小心
  glTF y-up ↔ Blender z-up:object scale 的 y 是 glTF 的 −z,軸搞錯會把「拉高」變「拉深」)。
- **tank_a 未出貨(誠實記錄)**:rooftank 現有 5 照全是場景照;`tank_wood`(木製水塔,具名
  單一主體)列已進目錄,但 dormer/tank_wood 的候選重度 Wikimedia-hosted —— 本輪撞上
  **深度 IP 節流**:與 §5b「每 10 分鐘窗放 2~3 張」不同,第 1 輪 55 張爆量後
  **連續 7 輪(≈80 分鐘)整輪 0 張**,是小時級的長時窗。結論:單輪 ≤55 張的爆量會把
  同一天的後續輪次全部賠掉 —— 下次大量抓取把 `--limit` 壓在 ~25,或隔天再補缺額。
  BLD_LIB 的 tank 列在節點入庫前保持註解(intake「名冊有、GLB 無」紅字驗證過會咬人 ——
  這是特性)。補抓指令:`node fetch_photos.mjs --family building --limit 25`(reverent-pascal
  資料家),tank_wood/dormer/acunit 達標後從 §5i 的 mesh_sheet 挑選流程續跑。
- **cp950 主控台會咬 Python 工具**:matte_photos.py 印 `✓` 直接 UnicodeEncodeError 死在
  第一張(exit 0,看起來像跑完)—— 跑任何會印非 ASCII 的 venv 工具一律帶
  `PYTHONIOENCODING=utf-8`。另:matte 的 rglob 在 fetch 還在下載時列舉會漏檔,重跑一次
  就補上(可續跑語意)。
- **量測選點**:場景照/仰拍導致 SF3D 背面外推失敗的比例遠低於樹族;`bld_*` 整棟風格列
  17 列有 13 列首輪就至少 2 張達標(barn/chalet/halftimber/stonecottage/lighthouse 全滿),
  歐洲城市立面列(rowhouse/shophouse)與亞洲列(hanok/minka 部分)卡在 Commons 429。
  **整棟節點還沒有消費端**(邊界樓/程序街區/巨岩石屋是候選)—— 下一輪先開縫再入庫,
  不要先塞節點(孤兒節點會被對照台點名)。

## 5j. Trial log (2026-08-06, 3060-machine session — 巨岩族第二批:使用者定案「大量下載不同國家地區的地質岩層或奇石/巨岩的照片再 img→3D,無視舊有的物件直接畫,禁止使用原版重繪」)

- **照片目錄改成逐岩型對位消費端**(結構同第 5 輪的逐樹種列):`synthMegalith` 有 11 個岩型
  (dome/slab/tower/spire/arch/mesa/hoodoo/fin/basalt/granite/marble),目錄補上其中九型
  (granite 沿用 `tor`、hoodoo 沿用既有列改點名卡帕多奇亞)+ 八列跨國地質岩層/奇石
  (褶皺/條紋/海蝕柱/蜂窩岩/巨石墓/石灰華/熔岩/石林)。**族序把 rock 提到最前面** ——
  tree 族還有 5 列零張,排在後面的族在無 `--family` 的整輪跑法裡永遠輪不到(§5h 同款坑)。
- **抓取節流實測(與 §5i 的「小時級長時窗」不同)**:本輪 5 輪 × `--limit 25`,第 1~2 輪各
  25 張、第 3~5 輪合計 +19 張(69 張封頂)。429 全數來自 **Commons fallback**,Openverse
  自家 CDN(rawpixel/wordpress.org photos)整輪暢通 ⇒ §5i 的「單輪 ≤25」策略有效,
  但**達標與否取決於該列的候選是不是 Wikimedia-hosted**,不是取決於總量。
- **本輪最重要的方法結論:人眼那一步 MUST 先看照片,再看網格。** 第一次挑選只看
  `mesh_stats` + contact sheet,選出的五顆**全部語意錯誤**:兩張是**藍色 CGI 地形算圖**
  (`mg_dome` 整列 5/5 都是同一組合成算圖 —— 這是 §5c「館藏掃描」之外的**新失敗型態**:
  CC0 平台上的 3D render 資料集)、一張彩繪石雕、一張**維也納城門明信片**、一張 19 世紀
  風景照。統計全部合格(fill 0.20~0.51、tris 800~1000)、licence 全部合格。改成先出
  **照片 contact sheet** 逐張看,49 張裡語意可用的只有 9 張 —— 與 §5c 的「~1/15」同量級。
- **出貨五顆**:`mega_d` ← 海蝕拱殘丘(Hardeep Asrani)、`mega_e` ← 花崗岩平衡巨礫
  (Alan Mattingly)、`mega_f` ← 砂岩刃脊(Sakin Shrestha)、**`tower_a`/`mesa_a` ← 魔鬼塔
  兩張(Carol M Highsmith,PD)**。後兩顆是**整座**節點(崖錐 + 柱身/疊層同一顆),
  接在 `synthMegalith` 的 tower/mesa 兩個分支上:載到庫就不 add 原 primitive,
  **但迴圈照跑** —— 它負責消耗亂數並把 y/r 推到終值(H/topR/sideDef 讀它)。
- **預算錯帳(修掉)**:`families.megalith` 的分子只量 `synthMegalith`、分母只數它的三個
  迴圈,**兩者都漏掉 `decorateMegalith` 的疊石堆**(最多 3 堆 × 5 顆 = 15),而 MEGA_LIB
  這份名冊從第一天就同時服務那兩支。新工具 `measure_megalith_tris.mjs` 把兩者收進**同一次**
  量測(placeMegaliths 的建造順序,200 種子 × 5 尺寸 = 1000 顆):整顆 max **3114**、
  件數解析上限 **29**(抽樣核對 19 ≤ 29)⇒ 逐件上限 **430**(舊 306)。分母 MUST 取解析值、
  分子取量測值 —— 拿抽樣當分母會把閘門算鬆,而鬆掉的閘門不報錯。
- **決定性錯帳(修掉,本輪最有價值的一項)**:同一支工具順手加了「有無零件庫,rnd() 枚數
  MUST 逐顆相同」的對帳,當場紅字。根因是兩處**共用 `rnd()` 混進局部種子的建造器**:
  `cliffPlant` 的蕈傘色、`nest` 的蛋位 ×2 與停棲鳥 —— 而這兩支只在 `rockProbe` **實測到
  壁面/座面**時才跑 ⇒ 幾何一換,跑到的次數就變,共用序列被多抽/少抽幾枚。
  症狀是「載得到零件庫的人與載不到的人,整張圖的植被與巨岩佈局不一樣」,沒有任何錯誤訊息。
  **改前只有 block 名冊時就已經 1/300 顆分家**(D-2 那一輪沒量到),整座型節點上線後 62/300。
  改成走各自的 `lr()` 之後 1000/1000 相同。
- **`normalize_parts.py` 的靜默陷阱(修掉)**:`--base` 重跑**同名**節點時,Blender 撞名自動
  改成 `name.001` ⇒ 舊的那顆繼續當真品(消費端與 intake 都按名字查),新的變孤兒。
  本輪為了留三角形餘裕重跑 tower_a/mesa_a,讀數一切正常而**那次重跑等於沒發生**。
  改成「base 匯入時先刪掉這一輪要重生的同名(含 `.NNN` 尾碼)物件」。
- **逐件上限是量測推導值 ⇒ 出貨 MUST 留餘裕**:tower_a/mesa_a 第一版 421 tris 貼著上限 430,
  而上限會隨岩體零件表重量而移動 —— 貼著上限出貨等於把下一次重量變成紅字。收到 372/371。
- **視覺閉環**(scratchpad `shot_mega.mjs`,同一顆座號、同一顆相機,保險絲 vs 零件庫):
  mesa 從「三段疊層圓柱 + 裙錐」變成一整座有斜坡側翼的實拍岩體、tower 從階梯狀圓柱塔變成
  渾厚岩丘、marble 堆的塊面明顯多樣化。**tower 的新輪廓比舊制矮胖**(節點水平撐滿的是
  `RX = r0×2.0`,那個值本來含山腳崖錐)—— 讀起來像方山而不像火山頸,下一輪若要保住
  「柱」的識別度,應該讓整座節點只撐到柱徑、崖錐留給 primitive。
- **待續**:①`hoodoo` 列仍**不出貨**(六張候選裡單一主體的那兩張過 SF3D 都在**細腰處斷成
  兩截** —— 細頸正是這一型的識別特徵,也正是 SF3D 最容易掉的地方);②`mg_dome` 整列需要
  重下查詢(現有 5 張全是 CGI 算圖);③`spire`/`fin`/`arch`/`slab`/`basalt` 五個岩型分支
  尚未開庫;④照片仍有 12 列未達標(karst 1/5、mg_marble 1/5、mg_basalt 2/6、mg_slab 2/5、
  st_* 六列 0~1)。補抓指令:`node fetch_photos.mjs --family rock --limit 25`(reverent-pascal
  資料家),隔輪冷卻。

## 5k. Trial log (2026-08-06, 3060-machine session — 樹族第二批:使用者定案「大量下載不同國家地區的不同樹種,如灌木/闊葉林/針葉林/各種大小神木的照片再 img→3D,無視舊有的物件直接畫,禁止使用原版重繪」)

- **開工第一件事是一個路由發現,而且它改掉一半的範圍**:`biomes.js NATURE_MANIFEST` 讓
  **broadleaf / birch / shrub / silvergrass / deadtree 五型吃 Quaternius CC0 的 GLB**
  (有葉片鏤空貼圖),`VEG_DEFS` 那幾張零件表只是**載入失敗時的保險絲** —— 掛在名冊裡的型別
  `buildVegMeshes` **連呼叫都不會被呼叫到**,在那幾張表上加 `lib:` 列等於接在沒人看得到的
  路徑上,而且沒有任何錯誤訊息(intake 全綠、對照台也全綠,因為那兩支問的是「零件表與 GLB
  對不對得起來」,不是「遊戲畫不畫得到」)。使用者的「灌木/闊葉林」剛好整整兩類都在名冊裡
  ⇒ **停下來問**,定案「連 Quaternius 一起換掉」。落地方式:三型退出名冊、改走零件表 +
  照片冠簇,而 **只換 `ico` 冠簇、樹幹/枝條維持 primitive**(§3 rule 1 parts-never-props:
  SF3D 吃一張整棵樹的照片會吐出一整棵樹,那是成品,烤進去就沒有逐實例變化了)。
  兩條路徑都零 `rnd()` 消耗(散布早就跑完)⇒ **佈局逐位元不變**,只換畫出來的幾何。
  silvergrass/deadtree 留在名冊裡:不在使用者點名的四類內,而草葉的鏤空貼圖是 SF3D 生不出來的。
- **`families.veg` 是第五個預算族,而它的除數不是桶數是「名冊列 × 該型 instance 數」**
  (新工具 `measure_veg_tris.mjs`)。與 building 族同樣是 InstancedMesh,但**差一個數量級**:
  屋頂煙囪一張圖 212 座,灌木 1909 叢。均分「總額度」的 building 公式套下去,灌木那一列
  分到 **27 tris —— 比現行的 ico(20)還小**,等於這一族永遠不准接。改成均分「**成長**額度」
  (node_cap = (whole_factor−1) × 植被層總量 ÷ Σ(名冊列 × instance) + 現值)才有意義。
  **`whole_factor = 4.0` 這一次是量出來的不是沿用的**:Quaternius 退場後四場實測釋出
  585,966~1,669,392 tris(取最小值 blackforest 2,184,169 → 1,598,203)⇒ 植被層可長到
  193,355 + 585,966 = 4.03× 現值,而每一個量過的場地都不比改制前重。
- **量測工具的指紋 MUST 問真品**:第一版只用幾何參數當指紋,而 `ico(0.9)` 同時是 shrub 與
  conifer2 的零件、`ico(1.7)` 同時是 broadleaf 與 borderrock 的 ⇒ 兩型的 instance 數**互相
  灌到對方頭上**(實測 shrub 與 conifer2 同時報 2044,加起來比整層植被的三角形總量還多)。
  改成頁內呼叫**真品 `buildVegMeshes`** 逐型建一株樣本、讀它的幾何參數 **+ 材質色**
  —— 季節色是 `seasonColor` 算的,在工具端抄一份色表就是第二份實作。改完只剩 birch/mangrove
  一組無解碰撞(同參同色),整群加總 = 偏緊。
- **本輪最貴的一課:三角形預算會回頭決定「這張照片能不能用」,而症狀是撕裂不是紅字。**
  第一版 node_cap = 140(灌木兩列都接),而實拍冠簇原生 336~414 tris ⇒ 減面比 2.4~3:1,
  正好落在 §5e「Blender 硬減面把 SF3D 的殼撕出洞」那個區間:**外廓契約全綠、預算全綠、
  對照台全綠,截圖上樹冠裂成一片一片**。三次嘗試都留在這裡當存證:①換更乾淨的來源(g02
  橡樹冠 1128 → 140 = 8:1,更糟);②SF3D 直接生到 tvc 70(黃楊當場塌成薄殼 fill 0.075);
  ③**真正的解是回頭改名冊** —— 灌木 1909 個 instance,它一列的價錢等於其餘九列的總和,
  把頂端那一小簇留給保險絲(畫面上只是頂上的小球)⇒ Σ 4826 → 2917、cap 140 → **218**,
  減面比回到 1.5:1 以內,截圖乾淨。**名冊本身是旋鈕**,這是這一族與 rock/tree 最不一樣的地方。
- **尺寸階 MUST 逐列一顆,而這條只有截圖抓得到**:第一版讓 `vleaf_a17` 同時服務 `ico(2.7)`
  與 `ico(1.7)` 兩列(包絡契約「≤ fallback 且 ≥ 一半」照樣全綠)⇒ 2.7 那一列拿到的冠簇
  只有標稱的 60%,畫面上是**樹冠浮在樹幹上方、中間開一道縫**。外廓稽核不看 y,而 y 正是
  接合那一軸(§5g/§4-B ④ 的老坑,第三次踩到)。改成逐列一顆、目標一律 `R x R` 拉滿包絡。
- **`photo_sheet.mjs`(新工具)**:§5j 的「人眼 MUST 先看照片再看網格」升格為正式工具
  (同 `mesh_sheet.mjs` 的來歷)。82 張逐張看,語意可用 **13 張(~1/6)**,擋下的東西這一輪
  又多兩種型態:**浮水印**(bristlecone 三張)與**去背後只剩剪影的 PNG 去背圖**(相思樹)。
  實作坑:`setContent` 給的是 opaque origin,`file://` 子資源會被 Chromium 一律擋掉,
  **每一格都空白且沒有錯誤訊息** ⇒ HTML 要寫到磁碟再 `goto('file:///…')`;輸出目錄
  `.sheet` 就在來源目錄底下,不濾掉的話下一輪會把上一輪的 sheet 當照片再收一次(index 全部位移)。
- **`normalize_parts.py --drop`(新旗標)**:節點表換形之後,`canopy_a10/b10/d8/f6` 四顆
  沒有任何消費端 —— 對照台的孤兒清單抓到了,但當時沒有任何辦法把它們從 GLB 裡拿掉
  (`--base` 只會整支保留)。與同名取代共用同一段刪除邏輯,語意差別只有「刪完要不要重生」。
- **對照台的一個潛伏 bug 被這一輪的帳觸發**:來源帳**兩種寫法都合法**(`key` 與 `keys`,
  一筆帳掛多個鍵是刻意允許的),但 `parts_review.mjs` 的純資料件那一段直接讀 `p.key`
  ⇒ 一筆用 `keys:` 寫的純資料件會讓**整支 `--report` TypeError 掛掉**,而那是「這一輪到底
  交付了什麼」的唯一離線出口。改成走 `keys ?? [key]` 的同一條正規化。
- **神木那半是舊配方重播,而「逐種一個專屬冠形」只做到一半(更正)**:①名義上 11 種各有
  自己的節點,但 `canopy_i*` 與舊制 `canopy_a*` 出自**同一張**照片(ov_b1917d71 橡樹冠)、
  `canopy_g*` 與舊制 `canopy_b*` 出自同一張(ov_4e78d273 孤樹)⇒ **11 種對到 9 張照片**,
  redwood/meranti 與 euc/dinizia 各是同一顆冠形的不同尺寸階。挑片時 MUST 先比對「這張前幾輪
  用過沒有」(來源帳 `parts_manifest.json` 的 `imgs[].id` 就是答案 —— 這一輪是漏查,不是查不到);
  真正卡住的是語意可用的冠簇照片只有 9 張,要 11 張得等節流退去。②**klinki / alerce 第一次
  接得上**:它們的冠簇只有 2.2~3.0m,比舊制最小節點(3.325)還小,§5g 當時是**刻意跳過**的,
  這一輪才補得上使用者說的「各種**大小**神木」。逐株閘實測 488~1207 tris(上限 1036~1608)。
- **`lib:` 這條縫只換「一顆冠簇長什麼樣」,換不掉「這棵樹長什麼樣」**(使用者 2026-08-06
  「為何新物件跟舊物件結構這麼像」的正解,比上一條的照片重複**更根本**):這一輪對零件表的
  diff **逐行都是 `+ lib: '…'`** —— `y`/`px`/`pz`/`sy` 一個都沒動、零件沒有增減、樹幹與枝條
  完全沒換(rule 1:只換零件不換成品),再加上包絡契約**強制**每顆新幾何收進它取代的那顆球裡
  ⇒ 剪影骨架(幾顆冠簇、擺在哪、多大、樹幹什麼比例)**逐位元還是舊設計**,變的只有每一團的
  表面起伏。這是縫的射程,不是照片的問題:**換再多不同樹種的照片,骨架都不會變**。
  要讓「結構」不一樣,動的是零件表本身(冠簇數量/偏移/傾角/樹幹收分),而那會同時改到保險絲
  剪影與 `giantCrownR`/`vegSpan` ⇒ 全圖植被佈局跟著位移(仍逐位元決定性),稽核與 bal 要整套
  重跑 —— 是一次獨立的改制,MUST NOT 當成這一輪的補丁塞進來。
- **(同日續作)使用者質疑後把「結構」也換掉了 —— 零件表骨架逐種重寫**:上一條說「換再多照片
  骨架都不會變」,使用者的回應是「那就動零件表」。落地範圍 = **VEG 五型 + 神木四種**:
  闊葉改不對稱寬展冠(主冠偏心 + 側簇各朝不同方位 + 兩根斜出側枝)、白樺改細高窄冠(葉簇沿幹
  上段縱向錯落)、灌木改叢生三團(寬 > 高、沒有主幹)、老雲杉改層疊枝盤(六層遞縮,不是四顆疊球)、
  紅樹林改低平寬冠 + 多方位支柱根;神木則把 meranti/dinizia/tualang **同一份配方**拆成三種剪影
  (攤平圓盤 / 被風削平的凹頂 / 枝下高極高的聚冠),klinki 改成南洋杉的**三層輪生枝盤**(層間留空隙)。
  四件必須連帶處理的事,一件都不能省:
  ①**接合會斷**(joints 當場 20 項紅字):冠盤上移 1.5m,meranti 的翅果簇就 DETACHED;新加的
  紅樹林支柱根離幹 0.12~0.2m 就 ISOLATED。改骨架 MUST 配 `audit_object_joints --seeds 8`。
  ②**兩份預算同時失效**:`families.tree kind_tris` 是量測快照(klinki 286 → 386),
  `families.veg` 的植被層總量也漲(193,355 → 212,963)—— 前者的量測從臨時腳本升格成
  `measure_veg_tris.mjs --giants`(**MUST NOT `loadPartLibs`**:量的是保險絲現值,載了零件庫
  等於拿自己的產出當基準 = 恆綠 = 沒有閘門)。
  ③**名冊是雙向旋鈕**:骨架變豐富 ⇒ 每一團都接庫的話 Σ instance-rows 2917 → 3779、cap 223 → 176,
  又掉回撕裂區。把「被主冠擋住大半」的小簇退回保險絲,額度留給看得見的那幾團;逐株閘同理
  (meranti 一度貼到 1215/1260 = 96%,讓出一列後回到 972/1260)。
  ④**保險絲剪影也一起變了**,這是刻意的:骨架住在零件表,`g` 與 `lib` 讀的是同一張表 ⇒ 載不到
  GLB 的人看到的也是新樹型,只是每一團是 ico 而不是實拍起伏。
- **抓取節流:又是小時級的長時窗**(§5i 同款,與 §5b 的「10 分鐘窗放 2~3 張」不同)。
  第 1 輪 25 張之後,第 2~3 輪 0 張,再加 3 輪 × 15 分鐘冷卻仍 0 張。這一輪另外量到
  **Openverse 自己也開始回 HTTP 401**(第 3 輪起;先前只有 Commons 的 429)⇒ 兩個 API 同時
  進節流時整輪真的一張都拿不到。補抓指令:`node fetch_photos.mjs --family tree --limit 25`
  (reverent-pascal 資料家),**隔天再跑**。
- **待續(誠實記錄)**:①**26 個新照片列裡有 20 列還在 0~3 張**(灌木只有 boxwood/rhodo/sage
  到貨、闊葉只有 jacaranda/olive、針葉只有 cedar/araucaria/juniper、神木只有 cryptomeria 1 張);
  ②因此**一般植被的三個型只各有一個形狀**(灌木黃楊、闊葉橡樹冠、針葉雲杉 + 猴謎樹頂梢)——
  使用者要的「不同國家地區的不同樹種」在**神木**那半兌現了(11 形),在**一般植被**那半還沒有,
  補足要等照片(**但骨架已經逐型不同了** —— 見上面的零件表重寫);③`conifer`/`conifer3`/`conifer4`
  的冠層是 cone/cyl 包絡,**不換**(塞進去會被
  拉成柱子);④`sapling`/`bamboo` 未接(sapling 冠簇 0.36~0.55m、bamboo 全是 cone);
  ⑤未跑:`audit_traverse`(㋓ 需網路;冠簇不登記碰撞柱、Quaternius 退場也不動碰撞 ⇒ 路徑
  結構上不可能改變,但沒跑就是沒跑)、真機互動冒煙(走過一片林子 + 30 秒穩態幀時)。
  **幀時這一輪有反向的好消息**:Quaternius 退場讓 aokigahara 全場三角形從 2,711,079 掉到
  1,447,601(四場皆降 27~49%),而植被層只從 161,783 升到 175,178。

## 5l. Trial log (2026-08-06, 3060-machine session — plan §1 那道「must measure first」的 TRELLIS 閘門終於被跑了,而它**沒過**)

> 起因是使用者問「新完成的 3D 物件都用哪些方法?有其他更適合的模型嗎?」。答案的前半是帳上讀得到的
> (23 筆來源帳:22 筆 SF3D、1 筆純資料件),後半就是這一節 —— plan §1 從 2026-08-04 起掛著
> `⚠ must measure first`,十天內每一輪都直接從梯子最底層的 SF3D 開始,那道閘從來沒有人去撞。

- **這張卡跑不動 TRELLIS,而且是排除掉所有可疑因素之後的結論。** 逐階段量測(WSL2 Ubuntu 24.04 /
  RTX 3060 12GB / torch 2.5.1+cu121 / xformers backend / `SPCONV_ALGO=native`):

  | 階段 | 可用顯存 | torch 配置 | 結果 |
  |---|---|---|---|
  | 起始 | 9165 MiB | 1413 MiB | — |
  | 影像條件(DINOv2) | 9695 MiB | 1431 MiB | ✅ |
  | 稀疏結構取樣 → 4158 voxels | 9685 MiB | 1432 MiB | ✅ |
  | slat 取樣 | 9681 MiB | 1432 MiB | ✅ |
  | mesh 解碼器上 GPU | 9581 MiB | 1605 MiB | ✅ 常駐成功 |
  | **flexicubes 網格抽取** | — | — | ❌ **CUDA out of memory** |

  失敗點恆定在 `trellis/models/structured_latent_vae/decoder_mesh.py to_representation` →
  `representations/mesh/cube2mesh.py`。**排除項逐條都做過了**:未用的兩個解碼器(`slat_decoder_gs`
  /`slat_decoder_rf`)`pop` 掉不載、其餘四個模型逐階段 `.to('cuda')`/`.to('cpu')` 只留當前那一個、
  `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`、停掉佔著 VRAM 的 ollama 把基準壓到 1.0GB。
  **在 9.58GB 完全空著的情況下,單是 flexicubes 那一步就吃不下** ⇒ 官方寫的 16GB 是真的,
  而「12GB 跑得動」的社群回報要嘛是別的輸出格式(gaussian/radiance field 不走 flexicubes)、
  要嘛是量化建置。前三階全過這件事值得記著:**出局的不是 TRELLIS 的推論,是它的網格抽取**。

- **plan §1 的那一行本身就寫錯了,而錯法是把兩代混在一起。** 原文:「TRELLIS.2-4B … README says
  24GB;community/ComfyUI builds report **8GB@256 / 12GB@512**」—— 256/512 是 **TRELLIS 1** 的
  sparse-structure 解析度,TRELLIS.2 的解析度下限就是 512³、官方要 24GB(A100/H100 驗證)。
  兩者的門檻、參數量(1.2B vs 4B)、可調旋鈕都不一樣,合成一行的結果是**梯子最上面那一階根本
  不存在**:在 12GB 卡上 TRELLIS.2 連載都不必試,而 TRELLIS 1 也只走得完前三階。
  `Fallback chain` 的頭兩階 `TRELLIS.2@512 → TRELLIS.2@256` 在這張卡上是空的。

- **安裝面積比 plan 估的小一個量級,這一條對下一個人有用**:只要**幾何**不要 PBR(plan §0
  「Hunyuan's paint stage is never run」同一條),`nvdiffrast`/`nvdiffrec` 整組跳過;`flash-attn`
  走官方支援的 `ATTN_BACKEND=xformers`(預編 wheel,不現場編譯)。**零 sudo**:Ubuntu 24.04 自帶
  gcc/g++/make/git/nvcc 與 libGL/glib,只缺 cmake/ninja 而兩者 `uv pip` 裝得到。實際落地 7.5GB
  venv + 2.9GB 權重,不是官方說的 50–100GB。**但 `kaolin` 是必要的**(我一開始判斷它只服務算圖
  ⇒ 錯):flexicubes 的 mesh 表徵吃它,NVIDIA 有對應 torch 2.5.1+cu121 的預編 wheel
  (`-f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html`),不必編譯。
  另外 `plyfile`/`xatlas`/`pyvista`/`pymeshfix`/`igraph` 是模組層 import,一次補齊。

- **逐階段 offload 有一個會靜默壞掉的地方**:`Pipeline.device` 取「第一個有裝置的模型的裝置」,
  模型分散兩個裝置時它回報 `cpu` ⇒ 內部建立的輸入張量跟著建在 CPU 上,與已上 GPU 的權重打架,
  錯誤訊息是 `Input type (torch.FloatTensor) and weight type (torch.cuda.FloatTensor) should be
  the same`,看起來像模型 bug 而不是自己的 offload 寫錯。把 `device` 釘死成 cuda 即可。

- **WSL2 是這台機器上唯一可行的路,而它的 VHD 要先搬家。** 原生 Windows 編不動(沒有 MSVC),
  TRELLIS 官方也說 Windows 支援是實驗性、建議 WSL2。Ubuntu 的 `ext4.vhdx` 已經 95.69GB 且住在
  C:,而 C: 當時只剩 23GB / 98% 滿 ⇒ **VHD 在宿主端長不了**(WSL 內 `df` 顯示 870G 可用是虛擬
  大小,會騙人)。`wsl --manage Ubuntu --move D:\wsl\Ubuntu` 走完約 29 分鐘(95GB,實測 C: 讀
  ~50MB/s / D: 寫 ~60MB/s),搬完 **C: 23GB → 119GB**;搬移期間 `wsl -l -v` 會整個卡住(服務被
  鎖),那是正常的、不是掛掉。GPU 直通搬移前後都正常。

- **SF3D 在三族「知名主體」上的基準(使用者定案的測試集:都市建築 / 知名神木 / 知名巨岩)**,
  同一組參數 `--texture-resolution 512 --remesh_option triangle --target_vertex_count 520`,
  峰值 VRAM 6.1–6.2GB:

  | 主體 | 來源 | tris | fill | `mesh_stats` 判讀 | 目視 |
  |---|---|---|---|---|---|
  | Art Deco 摩天樓塔冠 | Openverse CC0 | 802 | **0.048** | 殼/碎片 ✗ | 糊成一團 + 一片突出平板,退縮量體全失 |
  | Chief Sequoyah 神木 | Commons PD | 928 | 0.274 | 比例偏(柱/板) | 一根光滑柱體,板根與火痕樹洞不見 |
  | Devils Tower 巨岩 | Highsmith PD | 930 | 0.313 | 塊狀候選 ◎ | 量體對了,但**柱狀節理**全失、頂面變圓 |
  | hoodoo 帽岩+細頸 | Commons PD | 570 | 0.065 | 殼/碎片 ✗ | 塌成薄片 |
  | hoodoo 整座 | 同上 | 900 | 0.227 | 比例偏 | 塌成薄片 |

  **一個反直覺、而且方向上支持 plan §8 的量測:最乾淨的那張照片(夜空背景、輪廓分明的摩天樓)
  fill 最低。** 規則性人造幾何從單一角落視角看,單前饋模型推不出深度,只生出一片立面殼 ——
  §8 把「規則/人造幾何 → 純資料件、有機不規則 → img→3D」當成分流原則,這是它第一次有實測數字,
  而不是只有論證。反過來說 **Devils Tower 是全場唯一過前篩的**,也正好落在 §8 說的那一格。

- **hoodoo 那六張的實際盤點(§5j 待續 ① 的補完)**:2 張 Bryce 全景、1 張熱氣球觀光照、
  **1 張刻著 KAPADOKYA 的觀光紀念品陶藝**、1 張三柱+電線、1 張乾淨單體(`wc_112762573`,
  平衡帽岩 + 細頸 + 藍天)。紀念品是 §5j「彩繪石雕」之外的**另一種**失敗型態,列進 `photo_sheet`
  的擋下清單。可用度 1 clean + 2 croppable,與 §5c/§5j 的 ~1/6 同量級。

- **未跑 / 待續**:①**fallback chain 的下一階還沒撞** —— `Hunyuan3D 2.1 shape-only`(官方 10GB,
  對這裡實測的 9.5GB 可用仍屬邊緣)⇒ 應直接走 **Hunyuan3D-2GP** 低規建置(內建 CPU offload,
  plan §1 表裡本來就列著);②因此**這一輪一顆節點都沒有出貨**,`parts_manifest.json` 不動、
  `METHODS` 不新增 `trellis` 鍵(沒有產物就不該有方法字彙,原則 6);③plan §1/§8 的更正尚未寫入
  (使用者指示先寫 runbook)。

## 5m. Trial log (2026-08-06 晚, 3060-machine session — Hunyuan3D-2GP 閘門:**開**;首個 2GP 節點 hoodoo_a 出貨)

> §5l 三件待續的收尾輪:①fallback chain 下一階撞了(這一節);②plan §1/§7/§8 更正寫入
> (§1 表拆開 TRELLIS 1 / TRELLIS.2 兩代、fallback chain 頭兩階標空、§8 補 SF3D 三族 fill 實測);
> ③照片節流同晚探測**未退**(tree --limit 25 一輪 0 張,Openverse 401 + Commons 429 都還在封 —— 隔天再抓)。

- **2GP 在這張卡全開,而且餘裕大得反直覺**:§5l 同組知名主體 7 張全過,**逐張 torch 峰值
  恆 2524MiB、GPU 全程 free ≥10.2GB、61~67s/張**(SF3D 6.17GB/7s —— 2GP 慢 9 倍但 VRAM
  只吃 40%)。安裝:獨立 venv `~/ai3d/.venv311hy`(不動 §5l 的 TRELLIS venv,量測可重現;
  torch 2.5.1+cu121 + mmgp 3.2.7 + transformers 4.49.0;uv venv 缺 setuptools 的 §5c 老坑又咬一次
  —— mmgp→optimum.quanto 要它)。`diso` 不裝(dmc 是編譯件),`mc_algo='mc'` 走 skimage;
  texgen/custom_rasterizer 整組跳過(plan §0 paint 不跑)。權重 `tencent/Hunyuan3D-2`
  dit-v2-0 fp16 4.9GB(下載 16 分、熱載 3.6s)。runner `~/ai3d/run_hy.py`(mmgp offload
  profile 3 + `_execution_device` 釘 cuda,gradio_app 的做法照抄)。
- **品質恰好收復 §5l 點名的兩個 SF3D 失敗型態**(fill 前篩 + 人眼渲染複核):
  ①hoodoo **同一張** `wc_112762573`:SF3D 兩參數皆塌片(0.065/0.227)→ 2GP **0.274 ◎,
  帽岩/細頸/基座全保住**(細頸正是 §5j 待續① 說 SF3D 最容易掉的識別特徵);
  ②Art Deco 摩天樓:SF3D 0.048 立面殼 → 2GP **0.447 ◎,退縮量體一階一階清楚**——
  原生 3D 擴散推得出深度,單前饋推不出,§8 分流原則的第二組實測數字(方向仍支持分流:
  規則幾何的純資料件仍然零成本零授權,2GP 只是把「必須用照片的人造物」從不可能變成可行);
  ③魔鬼塔 0.404 ◎(裙狀崖錐 + 平頂)。7 張人眼取 3(~1/2;SF3D 語料可用率 ~1/6)。
  落選四張仍是輸入問題(場景照地面片、背景元素黏進網格、空心殼)—— 挑片紀律不變。
- **`rock/hoodoo_a` 出貨**(D-5 待續① 補完;首個非 SF3D 的庫節點):
  兩段式減面 —— 2GP 原生是 **mc 實心網格 watertight**(213,682 面),pymeshlab quadric
  大比例(213k→560)安全(§5e 的撕裂警告是「SF3D 薄殼 + Blender 硬減面」那條路),
  末段 Blender 1.5:1 溫和(560→382 ≤ 430 留餘裕,§5j 教訓)。單位包絡 1×1、佔比 95%。
  MEGA_LIB.hoodoo 列啟用(呼叫點 D-5 就寫好了,逐柱一顆、柱數 2~4、兩條路零 rnd);
  **預算分母 29 不動**(hoodoo 型整顆 = 4+4+2+15 = 25 < marble 的 29,tri_budget 註記)。
- **座號組重掃踩到一個「差點量錯」**:直呼 `synthMegalith(mulberry32(seed))` 掃出來的
  seed→岩型映射與台子**不同** —— 台子雜湊過(`(seed×2654435761)>>>0`)。用錯映射會挑到
  一顆台上根本不是 hoodoo 型的座號,而台上只顯示「這顆座號沒用到這個節點」= 看起來像
  掃過了。正確映射下 hoodoo 型只在 #22/#33;#1 mesa、#7 tower、#10 marble 各自必要
  (mega_f 只有 marble 的 8 疊塊輪得到)⇒ **加 #22 成四顆,不換掉誰**。
- **wsl.exe 會把多行腳本的換行接成空白**(本輪三次踩同一個坑才定位):`wsl -- bash -lc '<多行>'`
  的變數賦值行被接進上一行變成 `cd` 的多餘參數,`$M` 靜默變空;heredoc 同理被絞。
  對策 = 一律 Write 落地 .sh 到 /mnt/c、`tr -d '\r'` 拷進 WSL 再執行;另外 `bash -lc 'A && B & echo'`
  的 `&` 把**整串**丟背景,wsl.exe 一退出 distro 幾秒內 teardown 連 nohup 都帶走 ——
  長跑一律讓 wsl.exe 前景活著(外層背景任務)。
- **閘門全綠**:intake 240(hoodoo_a 包絡/預算 4 項新增)/ siteplan 187 / joints 21611-0
  (hoodoo 柱的接合全乾淨)/ beacons 68 + `--break-extent` 反向紅 / cel 52 / visual_prefs 124 /
  gpu 54 / soft_stroke 73 / `measure_megalith_tris` rnd 對帳 1000/1000(hoodoo 節點載入下);
  e2e 全綠(**8666 上先撞到一支 8.4 小時的舊伺服器** —— #INC-101 流程救了這一輪:kill 後
  fresh server 再測)/ bal 全綠(⑦f 1.09× 不動)。對照台 0 缺件/0 孤兒/0 未記載;
  provenance `METHODS` +`hunyuan_2gp` 鍵(§5l 當時不加是因為零產物;現在有了),
  帳列含 `imgs[].file`(漏了這一欄的症狀 = 台上「原圖不在本機」而照片明明在)。
  視覺閉環:座號 #22 保險絲 vs 零件庫並排(左 = 平滑柱+綠苔平帽的程序 hoodoo、
  右 = 實拍岩柱群),兩側都落地、崩落塊/疊石正常。
- **未跑 / 待續**:①`audit_traverse`(㋓;巨岩零件不動碰撞柱 ⇒ 結構上路徑不可能變,但沒跑
  就是沒跑);②真機互動冒煙(走過 hoodoo 巨岩 + 30 秒穩態幀時);③2GP 對**神木**沒有幫上
  (兩張 sequoia 都碎 —— 樹的問題仍是輸入語料不是模型);④摩天樓 0.447 那顆**沒有出貨**
  (整棟建物節點還沒有消費端,§5i 待續同款 —— 先開縫再入庫);⑤照片 20+ 列缺額等節流退
  (隔天 `--family tree/rock/building --limit 25` 逐族);⑥hoodoo 只有 _a 一形,#33 那顆
  座號留給下一形驗異質性。

## 5n. Trial log (2026-08-06 深夜→07 凌晨, 3060-machine session — TRELLIS.2(stableprojectorz fork)閘門:**開**;§5l「頭兩階是空的」被 fork 翻案)

> 使用者問「TRELLIS.2-stableprojectorz 專案的 img to 3D 可應用於 steel_vs_swarm 嗎」——
> §5l 判 TRELLIS.2 出局的前提是**官方建置**(24GB、Linux-only);IgorAherne 的
> StableProjectorz fork 宣稱 8GB@1024³ + Windows 原生 + 全預編 cp311 wheel,正好逐條
> 對著 §5l 的死因打 ⇒ 使用者指示「先在 3060 上跑閘門量測」。本輪**原生 Windows**
> (非 WSL2),獨立 venv,§5l/§5m 同組 7 張 matte,同一支 `mesh_stats` 前篩。

- **閘門開:7/7 全過 @1024_cascade,59~226s/張,VRAM 餘裕大到反直覺。** 量測環境:
  study clone `C:\Users\user\Documents\study\TRELLIS.2-stableprojectorz`(venv `.venv`、
  runner `run_t2_gate.py`、產出 `out_gate*/`)、torch 2.8.0+cu128 / xformers 0.0.32.post2 /
  triton-windows 3.4;參數 = 模型自身預設(steps 12 / ss 7.5·0.7·5.0 / shape 7.5·0.5·3.0 /
  tex 1.0·0.0·3.0;fork API 的 12 步「快檔」**就是** TRELLIS.2-4B pipeline.json 的原廠值)、
  seed 1234、decimation 50k、texture 1024:

  | 主體 | 總秒 | sample+decode+glb | raw faces | torch 峰值 |
  |---|---|---|---|---|
  | hoodoo `wc_112762573` | 111.3 | 91.0+6.2+14.1 | 3.84M | 2853MiB |
  | 神木 `wc_82407863` | 59.4 | 51.7+2.8+4.9 | 1.45M | 2746MiB |
  | 神木 `wc_82468948` | 61.2 | 53.1+2.9+5.2 | 1.54M | 2746MiB |
  | Art Deco 摩天樓 `ov_5846` | 226.4 | 198.4+19.1+9.0 | 12.19M | 3409MiB |
  | 直櫺辦公樓 `ov_fde7` | 133.2 | 114.5+10.3+8.4 | 6.18M | 2974MiB |
  | 魔鬼塔 `ov_163a` | 111.3 | 96.8+7.6+6.9 | 4.32M | 2909MiB |
  | 魔鬼塔 `ov_f94b` | 106.0 | 93.0+6.5+6.5 | 3.96M | 2890MiB |

  nvidia-smi 每秒輪詢全程裝置峰值 6648MiB(含桌面基準 ~2.3GB)= **free 恆 ≥5.4GB**;
  §5l 殺掉 TRELLIS 1 的網格抽取,在 O-Voxel 路徑上是 decode 峰值 0.7~3.4GB 的小事。
  載入 68s(權重駐留 CPU)。速度定位:SF3D 7s ≪ 2GP 61~67s ≈ **T2 59~226s**(voxel 數
  隨主體變,建築最貴;steps 25 時魔鬼塔 292.6s)。
- **真正的門檻是 RAM 不是 VRAM**:low_vram 模式整套模型駐留 CPU **~19GB**,32GB 機器
  avail <20GB 時 `from_pretrained` **無聲死亡**(exit 5、零 traceback —— 第一次背景跑就這樣
  死的,GPU 從頭到尾沒被碰)。對策已寫進 runner:依 pipeline type 踢掉用不到的模型
  (cascade 不用 `tex_slat_flow_model_512`)、matte 有 alpha 就踢 rembg ⇒ 載完 avail 2~3.5GB
  可跑完整批。跑批前先確認 avail ≥20GB,或先關瀏覽器。
- **安裝的三個坑(下一個人照抄)**:①installer 的 urllib 抓 GitHub release zip 只有
  17~62KB/s(pip 同時在抓 torch 會把頻寬搶光)——先 pip 完再 curl zip,dinov3 1.07GB +
  RMBG-2.0 785MB 就恢復 ~11MB/s;②**wheel 沒打包 `flex_gemm/kernels/triton/`**(`try: import
  except: pass` 靜默吞掉,直到 to_glb 的 grid_sample 才炸 `has no attribute 'triton'`;取樣
  不炸是因為 spconv 分派吃 `ALGORITHM` 設定恆走 EXPLICIT_GEMM)⇒ 從上游 FlexGEMM 拷
  `kernels/triton/` 進 site-packages,而上游 HEAD 的 `spconv/__init__.py` 又引用八個不存在的
  submanifold 模組 ⇒ init 补 try/except(有留檔註解);③sm_86 自動偵測會選 `flash_attn`
  而 whl/ 沒有那顆 ⇒ **`ATTN_BACKEND=xformers` 必須顯式設**(§5l 同款)。附帶:Blender
  headless 的相對 render 路徑會落到**磁碟根目錄**(`C:\out_gate\`),一律給絕對路徑。
- **`mesh_stats` 的 fill 這把尺對 TRELLIS.2 結構性不適用 —— 別拿它判死最強的模型。**
  七張全被判「殼/碎片 ✗」(fill 0.004~0.025),而人眼有兩張 ◎:O-Voxel 產出是**雙層
  薄殼**(trimesh 驗證:焊掉 UV 縫後開放邊 ~0、`fix_normals` 後 fill 仍趨近 0 = 幾何上
  封閉但不包體積,by construction)。fill 的語意是「實心度」,是為 SF3D 設計的(薄殼 =
  垃圾);對 T2 薄殼 = 常態,判讀只能靠人眼渲染(Blender headless 兩視角 contact sheet,
  `render_gate.py`/`sheet_gate.py`)。連帶警告:**薄殼大比例減面正是 §5e 撕裂警告的那一族**
  (2GP 是實心 mc 網格才敢 213k→560),入庫前 MUST 實測 50k→~500 的減面路徑(**§5o 已實測:
  直接減面確實壞掉,要先實體化**)。
- **人眼判讀(對照 §5l SF3D / §5m 2GP 同組)**:
  ①**建築雙 ◎ —— 這是 T2 的甜蜜點**:Art Deco 摩天樓四面退縮量體 + 窗格貼圖全在
  (SF3D 0.048 立面殼、2GP 0.447 shape-only);直櫺辦公樓箱體 + 垂直櫺線完整。且 T2 是
  **幾何 + PBR 貼圖一次出**(2GP 的 paint 從來沒跑)⇒ 建築整棟節點的縫(§5i/§5m 待續)
  開了之後,T2 是首選生成器;②魔鬼塔 seed 1234 = 正面浮雕背面開口 △,seed 42/steps 25 =
  **全閉合筒身+裙錐 ◎ 但貼圖整體掉成深藍 ✗** ⇒ 浮雕化是**逐 seed 抽籤不是結構性失敗**,
  shape 與 texture 各自有方差 ⇒ 岩石類要 per-seed 重抽紀律(挑片紀律的延伸);③神木仍碎
  且**把照片裡的遊客生成出來**(2GP 同病)—— 樹的問題仍是輸入語料不是模型(§5m ③ 不變)。
- **同一張 matte ≠ 同一個輸入(本輪最重要的一課)**:hoodoo 錨點圖三種輸入三種結果 ——
  SVS matte(下半身**軟 alpha 漸層**,≤8/255)→ T2 preprocess「bbox 取 alpha>204 裁切 +
  RGB×alpha 預乘到黑」把基座**整段裁掉** ⇒ 生成石板,忠於它看到的殘片;同檔案 2GP 全身
  保住是因為 hy3dgen 前處理自己閾值化;原圖 + fork 內建 RMBG-2.0 → 背景同質岩壁剝不掉 ⇒
  **場景地形塊**(hoodoo 本體帽岩/細頸/基座俱全,但埋在場景裡 = §5m 落選同族)。
  ⇒ 接進 SVS 管線的紀律:**餵 T2 的 matte MUST 先驗 alpha 直方圖、軟 alpha 先二值化**
  (>16 → 255);同時這解釋了 §5l SF3D 在同一張的 0.065/0.227 —— 那半條帳也是輸入的。
- **定位定案**:fallback chain 頭兩階從「空」變「**開(fork 版)**」,階梯 =
  `T2-spz(建築/規則幾何、要貼圖時)→ 2GP(實心岩體)→ SF3D(量產快篩)→ procedural`。
  T2 不取代 2GP:薄殼 vs 實心、9~30 倍慢於 SF3D、RAM 門檻高;它拿下的是「SF3D 推不出
  深度、2GP 沒有貼圖」的那一格。
- **未跑 / 待續**:①**零節點出貨** ⇒ `METHODS` 不加鍵、`parts_manifest` 不動(原則 6,
  §5l 同款);②薄殼 50k→~500 大比例減面未測 —— 這是入庫前的下一道閘(**已於 §5o 跑完:
  直接減面關、先實體化再減面開**);③512 / 1536 兩檔
  解析度未量(512 應更快,1536 疑似撞 RAM);④plan §1 表待補一行 fork 建置(與官方
  TRELLIS.2 分列,勿再混寫 —— §5l 的教訓);⑤建築整棟節點的消費端縫仍未開(§5i/§5m
  待續同款),開了才輪得到 T2 的甜蜜點兌現;⑥texture 掉色(魔鬼塔深藍)未歸因,懷疑
  tex_slat 對 seed 敏感,出貨輪要 A/B。

## 5o. Trial log (2026-08-07 凌晨, 3060-machine session — §5n 待續② 的薄殼減面閘門:直接減面**關**,「先實體化再減面」把它**打開**)

> §5n 收尾寫著「薄殼大比例減面正是 §5e 撕裂警告的那一族,入庫前 MUST 實測 50k→~500」。
> 這一輪就是那道閘。量測環境同 §5n(study clone、同一個 `.venv`,另裝 `pymeshlab 2025.7` +
> `fast-simplification` + `rtree`),腳本 `decim_gate.py`(三條路徑 + 拓樸/偏差量測)與
> `render_decim.py`(黏土渲染),產出 `out_decim*/`。**零節點出貨**(`METHODS`/`parts_manifest` 不動)。

- **結論**:T2(O-Voxel)的產出**不能**直接走 §5m 那條兩段式減面入庫;要進零件庫必須多一道
  **實體化(volumetric resample)**。三條路徑逐一實測(四顆主體 × 目標 2000/900/500):

  | 主體 | src 面/開放邊/元件 | A trimesh quadric 實得面 | B pymeshlab→500 面/元件/v:f | C 實體化→500 面/元件/v:f/開放邊 |
  |---|---|---|---|---|
  | Art Deco 摩天樓 `ov_5846` | 49,845 / 34,751 / 3,123 | **4,688(三個目標同值)** | 491 / 335 / 2.24 | 499 / 8 / 0.58 / 97 |
  | 直櫺辦公樓 `ov_fde7` | 49,385 / 22,517 / 990 | **6,076** | 497 / 398 / 2.50 | 500 / 9 / 0.48 / 0 |
  | 魔鬼塔 `ov_163a` | 49,791 / 32,509 / 2,534 | **4,646** | 499 / 479 / 2.86 | 500 / 3 / 0.51 / 8 |
  | hoodoo `wc_112762573` | 47,567 / 23,029 / 1,364 | **2,865** | 499 / 468 / 2.83 | 500 / 2 / 0.50 / 0 |

- **路徑 A(trimesh / fast-simplification quadric,保拓樸)結構性打不到預算,而且不報錯。**
  2000 / 900 / 500 三個目標回傳**逐位元同一個面數**(2,865~6,076 = 預算的 5.7~12.2 倍)——
  它塌不過元件邊界,撞到地板就停,然後**照樣回傳一顆網格**。呼叫端要 500 拿到 6,076,
  唯一會攔下來的地方是 `intake_parts` 的三角形閘;少了那道閘就是「零件庫悄悄多了 12 倍面數」。
- **路徑 B(pymeshlab quadric,`preservetopology=False`)打得到精確目標,代價是產出變成三角形湯。**
  499 面 / 468~479 元件 / v:f ≈ 2.8 ⇒ **平均每個元件 1.0~1.5 面** = 幾乎每一面都是一片孤立三角形。
  對塊狀岩體(魔鬼塔)遠看還像個東西(孤立三角形照樣覆蓋在原輪廓上),對建築當場炸開
  (Art Deco 剩幾片大三角 + 一叢針狀刺)。
- **方法論:表面偏差(dev)量不出撕裂 —— 誰拿它當通過條件,誰就會把彩紙入庫。**
  以包圍盒對角線正規化的最近距離,B→500 的 `dev_p95` 只有 0.0034~0.0057(魔鬼塔 0.0045),
  完全「合格」,因為**孤立三角形本來就貼在原表面上**。真正的偵測器是拓樸兩欄:
  健康的封閉件 **v:f ≈ 0.5、面/元件 = 全部**;三角形湯 **v:f → 3、面/元件 → 1**。
  唯一 dev 也一起爆掉的是 Art Deco(0.0686)—— 那是因為它連輪廓都沒剩。
- **路徑 C(先 uniform volumetric resample 實體化,再 quadric)是唯一兩者同時成立的路。**
  `generate_resampled_uniform_mesh`(cell = 對角線/256、offset = 對角線 ×0.6%)把雙層殼併成
  一層等值面 ⇒ 之後的 quadric 就與 §5m 那顆 2GP 實心 mc 網格同處境。精確打到 500 面、
  **v:f 0.48~0.58、元件 1~9、開放邊 0~97**;`dev_mean` 恆 **0.0051~0.0057 ≈ offset 本身**
  —— 偏差的主項是設計上的等距外移而不是撕裂,這條自洽性檢查值得留著當回歸判準。
- **「原生網格比較乾淨」這條假設被否掉了 —— 兇手不是 fork 的 86:1 減面。**
  魔鬼塔重跑一次 `--decimate 500`(4,318,700 → **473,280** 面,132.4s,torch 峰值 2,911MiB 不變,
  glb 匯出 6.9→17.4s):**開放邊 205,236(0.434/面)、元件 9,898**。50k 版是 0.653/面 ——
  同一個量級,**O-Voxel 的輸出本身就不是封閉面**(§5n 已用 trimesh 驗過「焊掉 UV 縫後 fill 仍趨近 0」,
  這一輪是同一件事的拓樸版證據)。⇒ 「取原生網格再自己減面」不是解法,實體化是必需品。
  附帶:50k 與 473k 的黏土渲染**肉眼幾乎分不出來** ⇒ fork 的預設減面在外觀上沒有損失,
  沒有理由為了品質去付 RAM 與匯出時間(473k 那次載入後 `ram_avail` 只剩 **1.3GB**,起跳是 20.3GB)。
- **人眼複核 MUST 剝貼圖(clay pass;`render_decim.py` 一律清掉材質),但 clay 也看不出不封閉。**
  逐族對照表(`family_sheet.py` → `out_sheets/t2_{building,rock,tree}.png`:輸入 matte → 貼圖
  兩視角 → 黏土)跑完之後,§5n 的「建築雙 ◎」**維持成立** —— 黏土渲染下 Art Deco 的退縮量體
  一階一階都在、直櫺辦公樓箱體完整,立面上那些縱向紋路是**窗帶/櫺線本身**,不是破洞
  (魔鬼塔柱身的縱溝同理,那是它真實的柱狀節理)。⇒ **「不封閉」在物件尺度上是看不見的**,
  能分辨的只有開放邊/元件那兩個數字;clay pass 的用途是「識別特徵在不在」與「減面後有沒有塌」,
  MUST NOT 拿它當封閉性的判準(反過來,貼圖 pass 連減面塌陷都會蓋掉,更不能用)。
  clay 真正抓到的一件事是**背面**:魔鬼塔兩顆的側視都是一片開口的殼(§5n 記的「正面浮雕、
  背面開口」),而那正是「薄殼」在畫面上唯一自己現形的地方。
- **500 面這一級留不住建築的識別特徵**:C→500 的魔鬼塔 ◎(柱身 + 裙狀崖錐都在),但 Art Deco
  的退縮量體被抹平成一團(`dev_p95` 2000 面 0.0088 → 500 面 0.0144)。⇒ 建築整棟節點若真要用 T2,
  **預算不是 500 這一級**;這件事要與 §5i/§5m 待續的「消費端縫」一起定,別分兩次做。
- **逐族對照表(交接用)**:`family_sheet.py` → `out_sheets/t2_{building,rock,tree}.png`,
  逐列 = 輸入 matte → T2 貼圖兩視角 → 黏土。**建築 2/2 ◎**(退縮量體/箱體+櫺線,幾何 + PBR
  一次出);**巨石 2/3 ◎**(魔鬼塔兩張;側視看得到背面開口 = 薄殼在畫面上唯一現形處)、
  hoodoo ✗ 是 matte 軟 alpha 被裁的輸入問題;**神木 0/2**(碎裂,而且把照片裡的遊客一起
  生成出來 —— §5n③「樹的問題是輸入語料不是模型」再確認一次)。⇒ 這張表直接定了下一輪的
  兩件事:**建築的生成品質已經夠了,缺的只有消費端縫(佇列 F)**;而**神木要回到採集端重來**
  (佇列 F0,使用者定案「重新找有神木全身、無其他干擾的照片」—— 三個模型在同一批 sequoia
  上全數碎裂,換模型已經換過兩次了)。
- **未跑 / 待續**:①實體化那一刀**還沒進 `normalize_parts.py`** —— 這一輪只在 study clone 量,
  出貨輪要決定它是入庫前的離線步驟還是 normalise 的一段(前者較符合 A2/原則 6:
  Blender 沒有 volumetric resample,pymeshlab 是**新的離線相依**,MUST NOT 進 `package.json`)
  **(→ §5t 已定案落地:入庫前離線步驟 `tools/ai3d/solidify_parts.py`)**;
  ②C 的兩個旋鈕(cell 256 / offset 0.6%)沒有掃描,offset 直接決定「胖多少」而包絡契約會抓它
  **(→ §5t 已掃描:3×3 全平台,凍結值在平台中央)**;
  ③建築預算該落在哪一級沒量(2000 面看起來夠,但零件庫現行是 400~900);
  ④§5n 待續 ③④⑤⑥ 原封不動(512/1536 解析度、plan §1 補行、消費端縫、texture 掉色)。

## 5p. Trial log (2026-08-07, 3060-machine session — 佇列 F0 執行:選片閘上線、語料帳改「可用張數」、孤立單株重採、T2 黏土複驗 5/5 不再碎裂)

> 使用者指示「接著 PR #160 的進度,在 main 重開一個分支繼續」⇒ 本輪 = **佇列 F0 逐條照做**
> (F0 是使用者 2026-08-07 定案的最優先;佇列 F 建築縫排下一輪)。

- **選片閘 `tools/ai3d/screen_mattes.py` 上線(F0 第一步「補閘,不是再抓一輪」)**:三統計桶
  (門檻與 82 張校準記錄全住檔頭)—— 剝空/主體太小 27、印刷品 10、葉片標本 3,對上人眼分桶
  ~25/~13/~11;**已知可用 16 張零誤殺**(硬約束;可用者最低 cov 0.100 vs 門檻 0.05 = 2× 邊際);
  反向驗證 `BLANK_COV 0.05→0.30` ⇒ 倖存 42→7 紅(原則 9)。統計倖存 42 逐格人眼再淘汰 26
  (烏龜/魚/壓葉標本/浮世繪明信片/含遊客紅杉…)⇒ 82 張既有 matte 可用 = **16**,與 F0 的
  「~16~18」逐張對上。人眼判決(`--human pass|reject`)恆勝統計、統計重跑不覆寫;淘汰者另出
  `out/sheets/tree_screen_reject.png`(誤殺看得見才救得回,原則 6)。
- **帳的語意換掉(F0:「可用張數不是下載張數」)**:`fetch_photos.mjs` 的 `have()`/`--plan`
  只計 screen 未淘汰的條目;淘汰條目仍佔 `seen` ⇒ 同一張垃圾不會被重新下載。`sp_sequoia`
  **want 歸零**(結構性失敗,F0 定案別再抓);F0 列排樹族最前(`gt_dragontree` 新開 +
  canopy/sp_baobab/sp_acacia/sp_conifer/sp_pine 上移),查詢往 lone / isolated /
  full height silhouette 句式。
- **重採兩輪**(Openverse 間歇 401/429、Commons 429 —— §5h 的小時級節流原樣):21 筆新入帳
  (dragontree 3 / canopy 4(其中 4 張是磁碟有檔、帳上從缺的舊檔補登)/ baobab 7 /
  boxwood 3 / cedar 1 / juniper 1 / cypress 2)→ matte → 過閘:統計淘汰 10、人眼淘汰 5
  (向量剪貼圖/柑橘圖鑑版畫(dragontree 查詢誤中)/鄰樹殘塊/老照片含地形塊/樹+大岩塊)
  ⇒ 新增可用 6,樹族可用 **16 → 22**(canopy 6→9 = 句式改善的主證;dragontree 三張只活
  一張石版畫 —— 照片兩張都不是活樹)。另有一小輪**誤啟動**(見下環境筆記 ④)+4 張:
  長頸鹿/犀牛(acacia 查詢)/葫蘆工藝品/岩塊(baobab 查詢)—— 全數「不是樹」人眼淘汰;
  這正是 F0 診斷的再現:**節流主機的淺頁好貨抓完之後,越深的頁面垃圾率越高**,
  續補要等冷卻拿淺頁,不是加深翻頁。
- **T2 黏土複驗(驗收 ③;5 張:大橡樹#16、密冠橡樹(新)、漂白刺果松枯幹(新)、南洋杉#27、
  猴麵包樹白描#58;matte 先二值化 >16→255(study clone `binarize_feed.py`),1024_cascade
  seed 1234)**:**5/5 出網格、58~94s、torch 峰值 ≤2.8GB、raw faces 1.3M~5.5M —— §5n③/§5o
  的「碎裂 + 把遊客生出來」兩個病灶隨語料修正一起消失**(clay `out_clay_f0/`、對照表
  `out_sheets/t2_tree_f0.png`)。人眼判讀:**枯幹 ◎**(真正體積型,側視有厚度 —— 形狀線索強、
  無葉冠的主體是 T2 樹族的甜蜜點,對位 deadtree/snag 節點);其餘四張 △ = **可辨識的樹,但
  單張正面照的茂密冠層出的是「浮雕」**(側視薄板;§5n 薄殼傾向在葉冠主體上的表現形)。
  ⇒ F0 的診斷成立:碎裂的成因是輸入語料;「冠簇節點要不要走 T2」是**下一個問題**
  (浮雕轉不了視角),不是這一輪的失敗。
- **執行環境三筆**:①photo DB(photos 533MB + out 437MB + `photo_manifest.json` 305 筆)自
  reverent-pascal-fcd63e 搬到本分支 worktree(那份已是最新超集;zen-albattani-b33990 從此
  只是 rembg venv 的家);②Windows 主控台 cp950:`screen_mattes.py` 內建 stdout 重設 UTF-8,
  `matte_photos.py` 要帶 `PYTHONIOENCODING=utf-8` 跑(第一次沒帶:第一張存檔成功、print 就炸);
  ③T2 首跑 exit 139 段錯誤 —— **與 rembg 去背同時跑,模型載入撞 RAM**(§5n 的 <20GB 警告以
  另一種死法現形);單獨重跑(avail 19.2GB)全過。**T2 載入與 rembg MUST NOT 同時跑**;
  ④`fetch_photos.mjs` 的 `main()` 是**頂層呼叫** —— 任何 `import` 它的動作(哪怕只想拿
  `PHOTO_CATALOG` 驗個鍵)都會**當場開跑抓取**。要檢查型錄用 `grep`/文字工具,別 import。
- **驗收對帳**:①授權稽核 **264/264 ok 條目 0 違規**;②閘冪等(重跑零改寫、人眼判決保留);
  ③`--plan` F0 列現值:dragontree 1/5、canopy 9/12、baobab 3/6、acacia 1/6、conifer 1/8、
  pine 0/8 —— **缺額是真缺額**,續補用同指令(小時級節流,冷卻後重跑)。
- **未跑 / 待續**:①孤立松柏(conifer/pine)這一輪整批被 401/429 吃掉,冷卻後續抓;
  ②冠簇的浮雕問題:要嘛換斜側面/多視角照片語料,要嘛冠簇維持程序 ico + 照片貼圖,由樹族
  入庫輪定;③枯幹那顆 ◎ 要入庫得走佇列 F 定案的實體化 + 減面路徑(§5o C 路徑),`METHODS`
  的 `trellis2_spz` 鍵仍等**首個入庫節點**才加(原則 6,§5n 同款)**(→ §5t 已加:
  首件 = `rock/tower_a`)**;④`screen_mattes.py` 的
  三桶門檻是 82 張校準的凍結值 —— 語料結構大改(例如大量白背景商品照湧入)要重校,別默默沿用。

## 5q. Trial log (2026-08-07 午後, 3060-machine session — 冠簇路線定案:葉冠不走 img→3D)

> §5p 待續② 的收斂輪:兩個假說各補一組量測,同日關閉。

- **逐 seed 對照(同一張密冠橡樹 matte,seed 1234/42/7;`out_sheets/t2_tree_seed_probe.png`)**:
  1234 = 浮雕(側視薄板帶少量起伏)、42 = **一片平板**(最壞)、7 = 有體積但整團碎塊雲
  (無主幹、葉簇彼此不相連)⇒ **葉冠在 T2 上是逐 seed 抽籤,而且沒有一注是可用冠簇** ——
  單張正面照對「毛茸茸的體積」給不出深度約束,落點在平板與碎雲之間漂。與岩石的 per-seed
  方差(§5n③)不同族:岩石是「浮雕 vs 閉合」兩注都有救、重抽有意義;葉冠是三種都不能用,
  重抽沒有出口。
- **斜側語料探針(`gt_oblique` 列,5 張)**:空拍/俯視查詢撈回的主體天生太小(matte 畫布
  253~711px,4/5 進剝空桶),唯一統計倖存是一座**空拍小島**(人眼淘汰)⇒ 斜側路線在
  **採集端**就死了 —— CC0 語料裡「離機夠近的單株俯拍」實際上不存在,與紅杉「大到拍不下」
  同族的結構性缺片。探針列已 want 歸零收斂(列上有結論註解)。
- **定案(樹族入庫輪的前提)**:①**冠簇維持程序 ico + 照片貼圖**,MUST NOT 再把葉冠照片
  餵 img→3D(三個模型 × 換語料 × 換 seed 都量過了);②**img→3D 對樹族只收雕塑性主體** ——
  枯幹/板根/扭曲樹幹(§5p 的漂白枯幹 ◎ 是範本),對位 deadtree/snag/buttress 節點;
  ③F0 語料庫的價值不因此縮水:可用 22 張裡的冠層照是**貼圖與輪廓參考**(程序冠簇的
  albedo 來源),不是幾何來源。
- 帳面:gt_oblique 5 張全淘汰(4 統計 + 1 人眼),樹族可用維持 22;兩個已收斂的
  want 0 列(sp_sequoia / gt_oblique)不再產生缺額。

## 5r. Trial log (2026-08-07 午後, 3060-machine session — 浮雕救援閘門:幾何閉合**關**,岩石浮雕注的唯一路徑 = per-seed 重抽)

> 使用者問「葉冠或岩石變浮雕時,能不能把水平角度當對稱去跑?多補幾個視角、缺口接合處
> 做近似?」⇒ 方法盤點(工具逐一驗在 venv:pymeshlab 有 **CGAL `generate_alpha_wrap`**、
> screened Poisson、凸包;fork API 收多圖但只用第一張(`generation.py:411/428`)——
> 多圖條件混合要小改 `run()`,列為未跑)+ 閘門實測 `symfill_gate.py`(study clone;
> 測試品 = §5n 魔鬼塔 **seed 1234 浮雕殼**,對照組 = **seed 42 天然閉合**那注,全變體
> 閉合後走 §5o 的 C 路徑到 500 面;產出 `out_symfill{,2}/` + `out_sheets/t2_symfill.png`)。
> 本段跑了**兩輪**:首輪結論被對抗覆核推翻一半,第二輪(誠實版)才定案 —— 兩輪都留著,
> 因為錯的那半正是機制所在。

- **首輪(鏡射平面 = 開放邊界中位數)**:指標把 V1a 鏡射+wrap2% 判為全綠(水密單元件、
  kf_p95 2.3%,勝凸包基線 6.9% 三倍),黏土卻在頂部長出**隧道與簷帽** —— 幻影材料撕裂尺
  與 kf 尺都量不到。**對抗覆核揪出成因:前提整個是錯的** —— T2 殼撕裂遍佈(實測 75% 頂點
  是邊界、2534 元件),「開放邊界 = 後緣」不成立,邊界深度分佈 ≈ 全殼分佈 ⇒ 中位數 =
  體中位平面 ⇒ **鏡射把殼從中剖半**(49% 頂點被鏡穿體、副本突出前緣達原深度 47%)。
  首輪測的是稻草人。
- **第二輪(誠實版:鏡射平面 = 深度背側極值 P99;rot4 軸改包圍盒足跡中心)**:
  V1a 閉合 kf 降到 0.9% 且水密,但深度膨脹到 1.379(CTRL 真塔深 0.944,**+46%**)——
  **殼本身就包過塔身超過半圈**,貼背極值鏡射必然長出**雙瓣體**(黏土側視 = 兩座塔以
  細橋相連),C500 還微破(10 開放邊/2 元件,平面接觸帶太薄)。V2 修軸後 14 → 3 元件
  (覆核者以擬合真軸反事實實測 = 2)⇒ 首輪的 14 元件主要是**質心軸被前板拉偏**的污染,
  但修好也仍碎。⇒ **兩種平面選法用互補的方式證明同一件事:T2 浮雕殼不是「有乾淨後緣的
  半個物體」,鏡射補全沒有合法平面可選** —— 中位面剖體、極值面雙瓣,中間任何位置是
  兩者的線性混合。
- **其餘變體與對照**:V1b wrap5% 減面後破(64~70 開放邊);V3 Poisson 的**本體 kf 0.42%
  全場最佳**,崩的是 C 路徑那一段(42 萬面 Poisson 包膜減面到 932/514 面全開放邊 ——
  目標都沒打到;歸因寫「Poisson 崩」是錯置,覆核已修正);CTRL 再印證 §5o ——「天然閉合」
  也是 2.9 萬開放邊/2443 元件的殼,C 路徑一支就收拾成水密(**不需要 wrap**)。
- **定案(岩石救援紀律)**:①浮雕注的**唯一路徑 = per-seed 重抽**(60~110s GPU;跨 seed
  形狀差 ~9% 但形狀「對」,黏土全場最像)**(→ §5s 部分取代:「唯一」不再成立,缺口楔形
  補丁開為具名備援)**;②**幾何閉合救援閘門關**(鏡射/旋轉/Poisson
  對 T2 浮雕注全數不合格,兩輪實測)**(→ §5s 收窄:不合格的是「整片」鏡射/旋轉/Poisson;
  「補丁照洞剪」的缺口緣鏡射是實測過的例外)**;③工具箱正面收穫:wrap2%+C 能把任意破殼變水密
  單元件 —— 對「形對殼碎」的失敗型態留用,但 CTRL 顯示那種型態 C 路徑自己就夠;
  ④**kf 尺必要不充分**:撕裂尺 + kf + 黏土人眼三者缺一不可(「人眼是主判準」第三次實證:
  fill 尺 §5n、選片統計 §5p、kf 尺本輪);⑤報表紀律:CTRL 的 kf 是**跨 seed 形狀距離**
  不是品質(裸讀 JSON 會把凸包排在重抽前面 —— 報表列已加 `cross_seed_kf` 標記);
  ⑥alpha 的百分比基底是**各 soup 自己的對角線**(跨變體差 13~16%),MUST NOT 把
  「wrap2%」當可移植常數。
- **未跑 / 待續**:①多圖條件混合(同圖/鏡像當多視角)—— `get_cond` 本就收 list、差
  `run()` 一段聚合;在重抽紀律面前優先度低;②葉冠不因此翻案(§5q):這些方法能閉合
  葉冠,但閉合從來不是葉冠的缺口。

## 5s. Trial log (2026-08-07 晚, 3060-machine session — 楔形補丁:§5r「閘門關」部分翻案 —— 補丁照洞剪,缺口緣鏡射就能用)

> 使用者覆核 §5r 第二輪:「誠實鏡射失敗的原因是缺口只有約 30°,拿兩個 150° 去接當然不對,
> 另一片剪一部分去補洞即可」——**方向完全正確、量級低估**:實測缺口 −121°..−6°(span
> 115°;方位角面積直方圖、軸 = 包圍盒足跡中心、空 bin 門檻 = 0.35×中位 bin 面積 ——
> 缺口弧佔圓周 32% 卻只含 4.5% 表面積,r≥0.35 的外牆帶只剩 0.1%,弧內全是 r≈0.22 的
> 內層殘料)。§5r 兩輪的死因就此收斂成一句:**不是鏡射不行,是拿整片 ~240° 的殼去疊
> 115° 的洞**。實測 `symfill_wedge.py` + `gap_probe.py`(study clone;測試品/對照組同
> §5r;產出 `out_symfill3/` + `out_sheets/t2_symfill_wedge.png`)。本輪照 §5r 的教訓
> **先過三鏡頭對抗覆核再定案**(幾何/量測/紀律;零 REFUTED,修正條目已折入下文)。

- **V5a(缺口兩緣各做過軸垂直面鏡射、各補半跨)是唯一過 C500 的補丁變體**:closed 水密
  單元件 kf_p95 0.84%,C500 **水密 0 開放邊單元件**(§5r 第二輪 V1a 的 C500 還有 10 開放邊);
  深度 0.7049 → **0.9338** —— 補丁把背面鼓回去、貼著 CTRL 真塔深 0.9445,不是第二輪的
  1.379 雙瓣。**機制(覆核修正版,MUST NOT 寫成「接縫零位錯」)**:鏡射只固定平面上的點、
  殼緣是參差的 —— 鏡射面取在缺口緣是把緣接縫的帶對帶錯位**壓到 ~2% diag = 恰在 wrap
  alpha 的橋接尺度內**,並把主位錯集中到缺口中線一條(~10% diag)交給 wrap 收;單邊全跨
  (V5b/V5c)與旋轉帶(V5d)的遠緣接縫是 17~34% diag、超出 wrap 能橋的尺度 ⇒ closed 都
  水密、**C500 全破**(19/25/4 開放邊、3/4/5 元件),MUST NOT 用。整組 7~8s CPU、
  複跑逐位元相同(構造路徑零亂數)。
- **判準升級:§5r④ 的三把尺不夠,六把缺一不可,每把都有本輪存證的盲區反例**:
  ①C500 拓樸(盲區:§5r 首輪 V1a 全綠卻長隧道);②kf(正面識別特徵);③**dev(反向:
  結果取樣→到原殼距離)= 幻影增料偵測器** —— R2 V1a 0.451 爆表、V5a 0.252 貼著跨 seed
  基準 0.271,kf 對這兩者全盲(0.93% vs 0.84%);**不是品質排序尺**(分不開好楔壞楔,
  MUST NOT 拿它排名);④ext[depth](合法帶 = [原殼深, 真塔深];盲區:V5b 深度 0.934 像樣
  但 C500 破);⑤**gap_after(閉合後重跑缺口偵測)≤ 3°** —— 對照組 **V0(不補丁直接
  wrap2%+C500)水密 + kf 0.7% + dev 0.8% 全綠、gap_after 卻是 101°**:wrap 與殼互在 alpha
  鄰域 ⇒ 兩把距離尺構造性全綠,而它只是把開放殼包了皮,黏土側視仍看得進殼內。門檻不是
  0(1~2 bin 量化 + 補丁抬中位數會生 1° 假縫,V5a 實測如此)、是 closed 階段的閘(C500
  粗網格噪音 4~5°);它自己的盲區 = V5c 拿貼著前板的片把方位補滿拿到 0.0 而深度根本沒
  復原;⑥黏土人眼(主判準第四次實證)。
- **黏土人眼(t2_symfill_wedge.png)**:V5a = 單一塔體、3/4 前視乾淨;缺陷 = **背側中下段
  一大片凹窩**(不是小瑕疵;候選成因兩個未分 —— 殼自己參差的下緣被鏡進補丁、或中線接縫
  10% diag 被 wrap 塌成口袋)。品質序:CTRL 天然閉合 > V5a > 其餘全滅。另 V5a closed 與
  CTRL C500 同為薄殼空腔(volume 0.033/0.038 vs bbox ~0.75)—— 外包絡對、非實心,
  遊戲道具無妨,但 500 面預算有一部分花在內壁上。
- **定案(改寫 §5r ①②,原文留著已加取代標註)**:①浮雕注救援 = **per-seed 重抽為主
  (品質);V5a 楔形補丁開為具名備援** —— 適用於「這一注的正面已被人眼挑中非保不可」
  (kf 0.84% vs 重抽跨 seed 9.3% = 差一個量級)或 GPU 不可用(7~8s CPU vs 60~110s GPU);
  ②只准 V5a 型(兩緣半跨),整片鏡射/旋轉/Poisson 維持關;③**缺口 MUST 實測不准目測**
  (目測 30° vs 實測 115°),且量測 MUST 連門檻一起釘:0.35×中位 bin、360 bin(0.2~0.5
  是平台、0.2 以下懸崖;左緣隨門檻漂 ~5°,與 margin 4° 同量級);**缺口偵測只有
  `find_gap` 一份**(gap_probe 已改轉呼 —— 舊版自帶第二份預設 0.02 的實作,同一顆殼量出
  1° vs 115° 兩個答案,原則 2 的反模式);④適用域:find_gap 取最長單一空段、V5a 構造
  隱含 span < 180°(健康帶要 ≥ 半跨)—— 多缺口/超半圈的浮雕注不在覆蓋內,仍走重抽;
  ⑤**n=1 未升常設**:整輪只測魔鬼塔 seed 1234 一顆標本(§5r 的結論就曾兩度在同一顆殼上
  被推翻),升格常設路徑前 MUST 至少再驗一顆浮雕注。
- **未跑 / 待續**:①第二顆浮雕標本(升格常設的前提,見定案⑤);②跨 seed 楔形(從 CTRL
  seed 42 的真背面剪楔補這一注 ——「同注正面 + 他注背面」若同時贏過 V5a 品質與重抽成本,
  定案①的分工要重寫);③wedge + C 路徑**不 wrap** 的對照(CTRL 證明 C 路徑自己能收拾
  2.9 萬開放邊,wrap 那一步貢獻了面積 +27% 的圓潤化,必要性未測);④margin 未掃描
  (現值 4°;g0−e 側鏡射源落在缺口內部近乎無料 = 虛設,真正的重疊只在中線與 g1 側);
  ⑤V5a 背側凹窩可否以底面切平/實心化收掉(岩石本就 `sinkBaseY` 埋底)—— 由入庫輪定;
  ⑥腳本仍住 study clone(§5o 同款:等首個入庫節點才搬 `tools/ai3d/`)**(→ §5t:C 路徑
  出貨版已搬 `tools/ai3d/solidify_parts.py`;`symfill_wedge.py` 楔形救援仍住 study clone,
  等第一顆「非救不可的浮雕注」再搬)**。

## 5t. Trial log (2026-08-07 晚, 3060-machine session — T2 首件入庫:`rock/tower_a` 改 T2 重生成 + 實體化刀落地 `tools/ai3d/solidify_parts.py`)

> 使用者指示「跑」(巨石首件入庫 + 實體化刀定案)。落點刻意選**零縫改動**的那一格:
> `rock/tower_a` 同名取代(`normalize_parts.py --base` 的既有語意)—— 消費端 tower 呼叫點、
> rnd 枚數、座號組、`MEGA_LIB` 名冊全部逐位元不動,整輪只動 GLB + 來源帳 + 工具。
> 動機不是「多一顆」是「換臉」:§5l 早記錄 SF3D 版 tower fill 0.313「量體對了,但**柱狀
> 節理全失**、頂面變圓」,而 §5o 實測 T2 C→500「柱身 + 裙狀崖錐都在」。

- **來源與 seed**:來源圖 `ov_163a0902`(CC0,Highsmith 魔鬼塔 —— 與 mesa_a 同一張;
  原 tower_a 的 `ov_f94b5c10` 退役)。**seed 42 天然閉合注**(per-seed 重抽紀律 §5m③/§5r:
  seed 1234 抽到浮雕注 —— 就是 §5r/§5s 的那顆標本;天然閉合注在手就不必動用楔形救援)。
  matte 先二值化 alpha >16→255(§5n)。
- **實體化刀定案(佇列 F.3 選項 (a) 的 repo 版)**:`tools/ai3d/solidify_parts.py` ——
  §5o C 路徑(uniform volumetric resample 實體化 + quadric)的出貨實作,pymeshlab venv
  **外部**(A2;3060 現成的家 = study clone `.venv`),pymeshlab 不出 GLB ⇒ 內部經 trimesh
  轉檔。study clone 的 `decim_gate.py`/`symfill_gate.py` 退回量測史料,出貨縫只有這一份
  (原則 2)。**參數掃描**(§5o 待續② 欠的):3×3(cells 192/256/320 × offset 0.4/0.6/0.8%)
  對 seed-42 殼**九組全數收斂水密單元件 500 面** —— 平台很寬,凍結值 256/0.006 落在平台
  中央不是揀好看的;offset 單調控制貼合度(0.4% → kf 0.73%、0.8% → 1.17%),出貨仍用
  跨族驗證值 0.006(0.004 略貼但只在這一顆殼上驗過;「太低 = 薄壁斷開」的風險面沒掃)。
- **鏈與數字**:T2 raw 47,725 面 / 29,239 開放邊 / 2,443 元件(O-Voxel 輸出本身就是撕裂
  薄殼,§5o)→ solidify 500 面水密單元件(kf_p95 0.94% / dev_p95 1.15%)→ normalize
  (Blender 同名取代,非等向 1.0×1.0 拉滿單位包絡 × FIT 0.95)→ **392 tris**。首跑 420
  太貼上限(430),重跑目標 400 收 392 —— §5j 教訓「貼著上限出貨 = 把下一次重量變成紅字」
  (前例 372/371/382 全在 90% 以下)。
- **來源帳**:`METHODS` +`trellis2_spz` 鍵(§5p 待續③ 的「等首個入庫節點」= 本輪);
  manifest 原 mesa_a/tower_a 合列**拆成兩列**(一次生成作業的語意已不成立):mesa_a 留
  sf3d、tower_a 新列記 T2 全參數(seed、掃描結論、兩段後處理)。
- **驗收全綠**:intake 240 / siteplan 187 / beacons 68 ±兩反向紅 / joints 21611-0 / gpu 54 /
  soft_stroke 73 / cel 52 / visual_prefs 124 / **megalith rnd 對帳 1000 顆逐顆相同 + 逐件
  上限 430 重推不動**(tower_a 372→392 不動 max = basalt 3114)/ `npm run bal` 全綠
  (⑦f 1.78× 不動 —— 純表現層)/ e2e 全綠(fresh server :8666)/ 對照台 0 缺件 0 孤兒
  0 未記載(tower_a 列:方法 T2-spz、來源圖、消費端 megalith、392 tris / 95% 包絡)。
  黏土人眼:柱身直紋 + 裙狀崖錐 + 平頂都在。
- **神木那半:刀已驗通,縫與預算是下一輪**(同日晚,使用者問「可以嘗試神木部分了嗎」):
  ①**枯幹走不了岩族的刀** —— 三連敗實測:凍結參數 24 元件、offset 加大 11~33 元件、
  wrap 後直接 quadric 12 元件。成因鏈:T2 對細枝主體的原殼是**空間上斷開的孤島群**
  (漂白刺果松 `ov_6f0ad84c` 實測 1,428 元件;resample 忠實所以照斷)+ 細管拓樸在低預算
  quadric 下被塌成**串珠**。②解 = `--mode wrap` 三段(已進 `solidify_parts.py`):
  alpha wrap 2% 橋接(§5r ③「形對殼碎」預留的正是這一型;wrap 後 4 元件、最大佔 99.3%)
  → 取最大元件(丟掉的 0.7% 是離體浮枝)→ **拓樸保護** quadric。**500/300/220 三級距
  全數水密單元件**(kf_p95 1.3~2.0%),黏土 C500 蒼勁多枝 ◎、C220 輪廓仍在 ⇒
  **veg 級距(node_cap 223)撐得住枯幹**;resample 模式對 tower 迴歸逐位元一致。
  ③下一輪 = 縫 + 預算同輪定案(佇列 F.1 同款):deadtree 退出 `NATURE_MANIFEST` 改走
  零件表(§5k ⑤ 的 broadleaf 前例)+ lib 列;**開列前先量** —— deadtree 住 `bare` 地貌
  (裸露地場地,量測挑 uluru 這類;現行四個綠地場地量不到它),而 veg 的 `node_cap` 是
  「成長額度 ÷ Σ(lib 列 × instance 上界)」:deadtree 列進分母 cap 就降,**既有節點
  ~215 tris 離 223 只有 8 tris 餘裕** —— cap 降過頭會把已出貨節點變紅,同時 deadtree 的
  Quaternius 檔退場又會把成長額度加回來(staleness ①③ 兩條同時動,不重量就開列 = 賭)。
- **其餘待續**:①真機冒煙(使用者下次開圖:tower 型巨岩換臉,柱狀節理看得出來);
  ②texture 掉色(§5n 待續⑥)不影響 —— partlib 只吃幾何,顏色由零件表 `c:` 給。

## 5u. Trial log (2026-08-07 夜, 3060-machine session — 樹族首件入庫:deadtree 遷零件表 + 整樹節點縫 + `tree/snag_a`)

> 使用者定案:「沒關係,能接起來就好,缺口補平當作被砍伐或雷擊損毀,自然的樹木本來就
> 不完美,繼續」⇒ §5t 神木那半的縫 + 預算,同輪定案(佇列 F.1「預算與縫 MUST 同一輪」)。

- **縫 = `VEG_DEFS` 的 def 層 `whole:`(整樹節點)**:`{ g, y, c, lib }` —— lib 載到 ⇒
  這一型**只畫那一顆節點**(保險絲零件全藏;synthMegalith tower「載到就不 add 原
  primitive」的資料路徑版);載不到 ⇒ rows = parts **逐位元**退回舊制(比任何 fuse-blob
  近似都乾淨 —— 這正是選 def 層而不是 per-part lib 的理由:枯幹沒有球形部件,per-part
  的 fuse 載不到時會畫出一顆掛著大球的樹)。三條紀律:①佈局(`vegSpan`/散布)仍只讀
  `parts`;②庫解析仍只經 `partGeo`(判「載到沒」= `partGeo(whole) !== whole.g`,
  audit_siteplan「解析恰三份」不動);③`whole.g` 只當入庫包絡與世界尺度,不是渲染備援。
  `bioLibDescs` 多吐一列 desc(fb = whole.g),`lib:` 字面計數自動平衡(原文 46 = 解析 46)。
- **deadtree 退出 `NATURE_MANIFEST`**(§5k ⑤ broadleaf 同路;§5q 定案樹族 img→3D 只收
  雕塑性主體 —— 枯幹正是首件):Quaternius DeadTree_1/2 退場(gltf 檔留在 assets 目錄,
  已無引用;要不要清檔由出貨版打包輪定),散布/佈局零 rnd 變化。
- **預算先量再開**(staleness ①③ 兩條同時動,§5t 預告的那筆帳):①uluru(bare 0.95,
  deadtree 的上界地貌)加入取樣面 —— **deadtree instance 上界 121**(blackforest 僅 15;
  綠地場地量不到它,§5t 的判斷成立);②blackforest 全場重量 1,591,970 → **1,561,264** =
  Quaternius 枯木退場釋出 **30,706** ⇒ 成長額度 592,199 → **622,905**;③`node_cap` =
  622,905 ÷ 3,038 + 20 = **225**(舊 223;分母 +121)—— 既有 veg 節點 max 214 仍綠。
  若只加分母不重量額度,cap 掉到 214.9 = 貼著既有節點零餘裕(§5t 預警的賭局,量測解掉)。
- **`tree/snag_a`**:§5p 漂白刺果松枯幹 ◎(`ov_6f0ad84c`,CC0 USFS;seed 1234 出來就 ◎
  不需重抽)→ `--mode wrap` 刀(§5t)48,673 面 1,428 元件 → **200 面水密單元件**
  (kf_p95 2.4%)→ normalize 非等向拉滿 ico(3.2)(≈ 全高 6.1m × it.s 0.7~1.4)。
  200 ≤ 225 留 11% 餘裕(§5j 教訓)。黏土:多刺蒼勁枯幹,缺枝/補痕照使用者定案讀作
  砍伐/雷擊損毀。
- **驗收全綠**:intake 244(snag_a 四條契約全過)/ siteplan 187 / soft_stroke 73(deadtree
  維持非軟性)/ beacons 68 / joints 21611-0 / gpu 54 / cel 52 / visual 124 / `npm run bal`
  全綠 / e2e 全綠(fresh :8666)/ 對照台 0 缺件 0 孤兒 0 未記載(snag_a 列:T2-spz、
  來源圖、消費端 deadtree[3]、200 tris / 95% 包絡)。
- **未跑 / 待續**:①真機冒煙(裸露地場地看枯木換臉 + 保險絲路徑不迴歸);②板根/扭曲幹
  是下一批(GIANT_DEFS 板根鰭的 per-part 縫 —— cone fuse 的非等向 normalize 已就緒,
  語料要回 F0 續抓);③`--mode wrap` 的 alpha 只在這一顆殼上驗過 2%,語料多了要掃
  (§5t 凍結值紀律同款);④卡在 §5p 的 conifer/pine 語料缺額照舊(冷卻後續抓)。

## 5v. Trial log (2026-08-07 深夜, 3060-machine session — 冠層複測:wrap 刀對六張冠層標本,§5q 定案維持、機制升級成可量的數)

> 使用者指示「再檢查有樹冠層的樹」—— wrap 刀救回枯幹之後,§5q「葉冠不走 img→3D」的
> 定案值得拿新刀重審一次(定案當時沒有這把刀)。六張冠層 T2 標本全部過刀
> (密冠橡樹 seed 1234/42/7、大橡樹 #16、南洋杉 #27、猴麵包白描 #58)。

- **閉合全勝、身分全敗 —— §5q 維持,而且第三次驗證了它那句話**(「這些方法能閉合葉冠,
  但閉合從來不是葉冠的缺口」):wrap 刀把六張全部閉成水密單元件(連 §5q 的「最壞平板」
  seed 42 都是),但 ①**平板注閉合後還是板**:密冠 1234/42、南洋杉、猴麵包的**水平深度比**
  (min(x,z)/max(x,z))= 0.01~0.08,黏土側視就是一片薄板 —— 深度不存在,閉合造不出來;
  ②**真體積樹被熔掉**:大橡樹 #16 是六張裡唯一的真 3D(深度比 **0.80**,原殼是
  幹 + 枝椏濾網 + 葉簇的漂亮橡樹,§5p 當時人眼判 △ 其實冤枉它了)—— 但 wrap 的橋接
  尺度恰好抹掉細枝濾網,380 面出來是「蠟燭熔岩插在盤子上」。**枯幹 ◎ 與冠層 ✗ 的分界
  就此講清楚:身分住在粗肢(wrap 保得住的尺度)= 可救;身分住在細絲 = 橋接即熔毀**;
  ③碎塊雲 seed 7 在 alpha 2% 撞 MemoryError、4% 閉成深度比 0.98 的圓丘(kf 5.5%)——
  是「一團東西」不是「一棵樹」,冠簇節點另有 SF3D 現役貨,不缺這一注。
- **`depth_ratio` 前篩進 `solidify_parts.py`**:< 0.15 = 浮雕/平板注,免跑閉合免看黏土
  直接判(六張標本 + 魔鬼塔兩注校準:平板 0.01~0.08 / 楔形缺口浮雕 0.70(§5s 那顆,
  楔形可救)/ 真體積 0.80~0.98)。與 §5o「fill 尺對 T2 不適用」互補:fill 量殼的封閉度、
  depth_ratio 量**形狀本身有沒有背面**。
- **順帶迴歸確認**:§5u 的 `whole:` 縫只掛在 deadtree 上,冠層樹種(broadleaf/birch/
  shrub/conifer*/mangrove + 神木)rows = parts 逐位元不變 —— uluru/blackforest 兩輪量測
  的逐型 instance 指紋全部對得上(那兩張表就是遷移後量的),soft_stroke/joints/e2e 全綠。
- 結論:樹族 img→3D 的邊界穩定在 §5q 原判 —— **只收雕塑性主體**(枯幹 ◎ 已入庫;
  板根/扭曲幹排隊),冠層維持程序冠簇 + 照片貼圖;oak16 這種真體積樹若要用,出路是
  高預算 GIANT 節點(數千面)—— 現行預算(veg 225 / tree 402)下無解,不立佇列。
  **(→ §5w 使用者手稿翻案了冠層的出路:不膨脹、用排列造體積 —— 莢化放射)**

## 5w. Trial log (2026-08-07 深夜, 3060-machine session — 使用者手稿:冠層莢化放射 + 樹幹迴轉;原型三層級黏土)

> 使用者上傳手繪流程圖:「葉冠的部分參考我的手稿處理…樹幹的部分則直接旋轉360度補滿」。
> 追問定案兩件事:①每一片 = **浮雕板沿平背鏡射閉合成有厚度的「莢」**再繞軸放射
> (不是薄片交叉);②過軸片數 **2~6 逐株隨機**。手稿把單片薄板(側視即消失)明確 X 掉。
> **這個設計繞開了 §5v 的死結**:不膨脹(wrap 熔毀路線)、用**排列**造體積 ——
> 而且「平背鏡射」對薄板是**合法鏡射**:§5r 鏡射之死是因為塔殼不是「半個物體」,
> 冠層板恰恰就是半個物體,貼背鏡射正是它的正確閉合。原型 `canopy_pods.py`(study clone;
> 測試品 = 密冠橡樹 seed 1234,§5q 判死的那張;產出 `out_pods/`)。

- **管線**:寬度剖面切幹/冠(密冠橡樹實測幹只佔底部 6%H,「葉裙拖地」樹型)→
  幹 = 寬度剖面迴轉 360°(lathe,軸過鏡射面)→ 冠 = 板 + 貼背鏡射 → **wrap 前**兩半
  先退開 sep(wrap 以圓角橋接緣邊;第一版在 wrap 後 z×3 縮放,緣面被拉成梯田狀平帶,
  黏土讀起來像切片水果 —— 厚度 MUST 在 wrap 前給)→ 水密單莢 → K 莢繞軸 180° 均分
  (莢過軸雙面 ⇒ 180° 即滿覆蓋)+ 逐莢高/徑微抖(定值,零亂數)。
- **三層級黏土**:①高模(莢 3.6k 面):K6 俯視是一頂真正的密葉冠、K4 側視莢間暗袋讀作
  葉蔭 —— 葉叢起伏全在,質感 ◎;②遊戲級(莢 100 面,K4 全樹 464):剪影仍是有機圓頂、
  花形都在,葉叢起伏被抹平 —— 與現行 ico 冠簇同級但**剪影不對稱 + 逐株 K 變化**,
  細節靠遊戲內既有的葉色抖動 + 軟性擺動補;③莢 60 面(全樹 304):可用但更鈍。
- **入庫是下一輪的縫**(本輪只驗機制):「2~6 逐株隨機」在 VEG_DEFS 的表達是新消費型態
  —— 莢 = 一顆 lib 節點、逐株 K 由**位置雜湊**推(零共享 rnd,§2.3),InstancedMesh
  逐列 instance 數會隨 K 變 ⇒ buildVegMeshes 要新機制(零縮放矩陣藏莢 or 逐莢展開
  instance 名冊),預算走 veg node_cap(100 面莢 ≤ 225 ✓)+ 逐株 Σ 上限(K=6 × 100 +
  幹 ≈ 660,超過單株 ico 冠簇現值 —— 要走 §5u 同款「先量再開」)。適用樹種:密冠/
  圓頂型闊葉(broadleaf 家族);oak16 型的枝椏濾網樹**不適用**(莢化會把濾網壓成實牆,
  §5v 的教訓換個方向再現)。
- **未跑 / 待續**:①使用者過目三層級黏土 → 選定質感檔位與適用樹種;②縫 + 預算輪
  (依 §5u 模式:量測 → 開縫 → 入庫 → 全砲火);③trunk 迴轉對「幹佔比高」的樹種
  (oak16 6%H 是特例)要重驗剖面取樣;④sep 只在密冠橡樹上調過 0.05,換語料要掃。
- **v3(同日;使用者二修,v2 的莢被退件)**:①「2~6」是**俯視瓣數**不是過軸片數 ——
  奇數瓣(3/5)用**半片**各自繞軸擺,偶數瓣 = 半片成對(同一機制的特例);②莢 MUST NOT
  直線墊厚(v2 的 sep 平移 = 使用者原話「直接墊厚浮雕,邊緣看起來是拉直的」)—— 要進
  **r-θ 座標**:瓣 = 半片剖影**繞軸部分迴轉**(與樹幹 360° 迴轉同一個框架),z 向厚度
  映成角向 Δθ 楔 ⇒ 邊緣是弧、厚度 ∝ 半徑(近軸收尖、緣端飽滿)、浮雕表面起伏跟著映成
  角向起伏。`canopy_petals.py`(半莢 wrap 閉合 → `bend_wedge` 楔彎 → K 瓣 360/K 均分、
  左右半片輪流取 = 相鄰瓣剪影不同;瓣張角 = `fill` × 360/K 留花瓣缺口)。正俯視黏土
  (新工具 `render_top.py`,out_dir MUST 傳絕對路徑 —— Blender 相對 filepath 會解析到
  磁碟根)K3 = 三瓣風車、K5 = 五瓣風車,花形與手稿一致;側視量感、葉叢起伏都在。
  待使用者校準:瓣的胖瘦(現值 fill 0.62 偏尖楔,手稿的瓣更圓潤 —— 旋鈕是 fill 與
  逐瓣 r 剖面)、質感檔位、適用樹種。
- **v4(同日;使用者手稿二 —— 尖楔瓣 X 掉,瓣要圓潤)**:瓣的角向半寬從常數改成沿
  徑向脊的**圓弧包絡** `W(u) = 0.14 + 0.86·sin(πu)^0.85`(近軸收細柄、中段鼓滿、梢端
  收圓;兩端不歸零 —— 柄與梢都留肉),`half_deg` 語意改為中段半寬、近軸爆脹以 1.9×
  夾住;fill 0.62 → 0.72。俯視 K5 = 五瓣圓瓣花(柄細中鼓梢收、緣帶鋸齒),與手稿二的
  團塊瓣一致;側視圓頂量感不退、葉隙讀作透光孔。
- **v5(同日;使用者定案黑桃瓣)**:寬度包絡改三段 ——「每瓣黑桃狀膨脹,半徑 1/3 以內
  當作樹枝(可以小一些),最大點抓半徑 2/3,膨脹拉大一點,例如 3 瓣可拉到 110~120°,
  以此類推」⇒ ①u ≤ 1/3 樹枝段:**物理**細柄(branch_w/r,近軸夾住);②1/3 → 2/3
  smoothstep 鼓到滿寬,滿寬 = **0.96 × 360/K**(K=3 ⇒ 115°,隨 K 等比);③2/3 → 梢端
  收尖,tip_p **< 1 = 凸肩**(寬度撐得久、末端急收 = 黑桃圓肩;首版 p=1.3 凹收讀成
  箭頭,被退)。K3/K5 俯視:細枝柄 + 圓肩鼓瓣 + 收尖,黑桃花形成立。

## 5x. Trial log (2026-08-07, 3060-machine session — 逐瓣 r/θ ±1/8 誤差 + 遊戲級減面檔位)

> 使用者定案:「**樹木旁瓣的 r 和 theta 加入 ±1/8 的誤差,角度總和還是 360 度**」。
> v5 的瓣是**均分**的(360k/K)、只有 ±8% 的高/徑微抖 —— 俯視讀起來是機械風車。

- **誤差 MUST 零均值**(`petal_jitter`,定值零亂數 §2.3):角格 `Δθ_k = 360/K ×(1 + e_k)`,
  `Σ e = 0` ⇒ **Σ Δθ = 360.000000° 逐位元**(K=2~6 實測全部到小數第六位);徑向那一組同樣
  零均值 ⇒ 平均冠幅不動(誤差是**重分配**不是把樹放大,同 `AOE_BUDGET.NORM` 與
  `BUILD_DPS` 的同一條)。**順序是「先減均值、再等比放大到恰好 ±1/8」** —— 反過來
  (先夾到 ±1/8 再減均值)會把總和推離 360°,而那一刀補回去的就是另一個誤差。
- **瓣心 = 自己那一格的中央**(前面各格累積 + 半格),MUST NOT 沿用 `360k/K` —— 格不等寬,
  均分擺位會和格錯開,瓣一邊咬進鄰格、另一邊留出雙倍缺口。
- **瓣寬 MUST 吃自己那一格**(`bend_wedge` 收 `span` 不收 `K`):缺口佔比恆 `1−fill`。
  「固定寬 + 只抖擺位」是**不成立**的省事版 —— 不相咬的條件是
  `e_k + e_{k+1} ≥ 2(fill−1) = −0.08`,而 ±1/8 的相鄰和下界是 −0.25。實測(fill 0.96,
  逐 K 掃最小缺口):定案版 K2~K6 = **+7.20 / +4.64 / +3.40 / +2.75 / +2.28°**(全正);
  固定寬版 = +7.20 / +0.81 / **−1.33 / −0.26 / −0.53°** ⇒ **K=4/5/6 三檔相鄰瓣真的互穿**
  (fill 0.96 是使用者鎖死的鼓滿值,要保它就只能讓寬度跟著格走)。
- **⚠ 這一條改變了入庫的縫**:θ 誤差是**角向楔彎**(非仿射),instance 矩陣表達不了 ⇒
  「一顆瓣節點 + K 個 instance 矩陣」的原計畫**不成立**(r 誤差與高度抖是等比縮放,矩陣
  照樣吃得下;只有 θ 吃不下)。三條出路,§5w 待續② 的「二選一」要一起定:
  ㋐ **烤 2+3+4+5+6 = 20 顆瓣節點**(逐 K 逐位次各一顆,誤差烤進幾何)—— 矩陣退回純
  旋轉+縮放,代價是 lib 列數 ×,`lib_instance_rows` 跟著漲;
  ㋑ **逐 instance 一個 `aSpanF` 屬性 + 頂點著色器再彎一次**(節點只烤一顆:局部座標下
  `φ = atan2(z, x)`、`φ *= aSpanF` 即精確,與既有 `CEL_SWAY` 同層可共存)—— 列數不變,
  代價是多一條著色器路徑;
  ㋒ `fill` 降到 ≤ 0.875 換回「固定寬 + 抖擺位」—— 一顆節點、零新機制,但賠掉使用者
  鎖死的鼓滿值。
- **減面(§5w 待續①「先減面再彎折」)驗通且順序有理由**:`bend_wedge` 是純頂點映射
  (不動拓樸)⇒ 先減再彎;**先彎再減會讓 quadric 拿彎過的曲面算誤差、把楔的角向弧
  當成「可以拉直的曲面」抹掉**。半莢是 wrap 出來的水密實心單元件 ⇒ 走 §5m 的直接
  quadric(§5o「先實體化」那條是給 T2 雙層薄殼的,這裡不適用),`preservetopology`
  保住水密 —— 四個檔位出來全部 `watertight=True`。
- **拓樸底 = 100/108 面,而且不報錯**:目標寫 60 拿回來的還是 100/108(preservetopology
  之下再降就得破拓樸)。與 §5o「trimesh quadric 打不到預算又不報錯」同一族,只是這次
  是 pymeshlab 的 preserve 分支 —— **面數目標 MUST 拿產出實測回讀**,不可信參數。
- **檔位實測**(每瓣目標 → 全樹面數 K2/K3/K4/K5/K6):
  100(= 拓樸底)→ 288/388/496/596/**704**;160 → 400/560/720/880/**1040**;
  225(= 現行 `node_cap`)→ 528/752/976/1200/**1424**;高模 → 8180…24380。
  人眼:100 側視是**水晶碎片**(葉叢起伏全丟、剪影開始破);160 起回到有機團塊;
  225 只比 160 好一點點。俯視三檔位都保得住黑桃花形(細枝柄 + 鼓肩 + 缺口)。
- **預算天花板 ≈ 170,是推導不是手感**:broadleaf 走瓣化 ⇒ 逐株列數由 2 變成
  `1 幹 + K 瓣`(平均 K=4 ⇒ 5),`lib_instance_rows` 3038 − 211×2 + 211×5 = **3671**,
  `622,905 / 3671 ≈ 170`。⇒ **可用區間 = [100 拓樸底, 170 預算天花板]**,`--faces 160`
  是唯一同時落在裡面又不讀成碎片的檔位(這一輪的建議值;正式數字仍走 §5u 模式,
  由 `measure_veg_tris.mjs` 對**選定樹種**重量一次)。
### 5x-b. 入庫縫定案 ㋑(逐 instance)+ 適用樹種的兩道閘(同日,使用者「那就逐 instance」)

- **㋑ 成立的理由是可證的**:`bend_wedge` 的 `φ = (t/tmax)·alpha(u; span)`,而 `alpha` 對
  `span` **幾乎**是齊次的 ⇒ 一顆基準瓣 + 逐 instance 一個純量 `aSpanF`、著色器裡
  `φ = atan2(z, x); φ *= aSpanF; (x, z) = r·(cos φ, sin φ)` 就能重現任意格寬。
  「幾乎」的兩個例外都是**刻意的**:樹枝段的 `branch_w / r`(物理細柄)與梢端保底 `0.03`
  都不隨 span 走 ⇒ **單一基準瓣打不到全域精確**。實測(相對包圍盒對角):
  | 方案 | 節點數 | draw call | 最壞偏差 |
  |---|---|---|---|
  | 單顆基準瓣(S₀ = 90°)吃全部 K | 1 | 2 | **1.63%**(集中在 K=2:span/S₀ = 2.25 ⇒ 細枝柄被撐成 2.25 倍寬,賠掉使用者鎖死的「樹枝段」) |
  | **逐 K 一顆基準瓣(K=2~6)+ `aSpanF` 只吃 ±1/8** | 6 | 6 | **0.16%**(逐 K 最壞 1.98e-3 / 1.98e-3 / 1.39e-3 / 1.25e-3 / 3.88e-4) |
  | ㋐ 全烤(逐 K 逐位次) | 21 | 21 | 0 |
  ⇒ **定案 = 逐 K 基準瓣 + 逐 instance `aSpanF` ∈ [0.875, 1.125]**。三角形預算與列數
  **與方案無關**(Σ instance 數一樣),差的只有 GLB 節點數與 draw call。
- **A39 ⑦ 連帶**:新的彎折 define 與 `aSpanF` MUST 進 `customProgramCacheKey`(不進 = three
  共用舊程式 = 那批材質整批不彎,而且不報錯);排序上先彎再交給 `CEL_SWAY` 的擺動位移
  (擺動錨在整株局部座標,彎折不動 y ⇒ 兩者正交)。
- **適用樹種:兩道閘,都是量出來的**(F0 五張語料實跑,`--faces 160` K5 俯視 + 側視):
  | 語料 | depth_ratio | 冠寬/冠高 | 結果 |
  |---|---|---|---|
  | 密冠橡樹 | 0.029 | **1.60** | ✓ 黑桃花形、側視有機團塊 |
  | 猴麵包樹(白描) | 0.012 | **1.52** | ✓ 最乾淨的一朵 |
  | 南洋杉 | 0.064 | **0.89** | ✗ **過了 dr 閘仍不成立** —— 攤成放射尖星 |
  | 大橡樹#16 | **0.804** | 1.25 | ✗ 薄刃 + 側視雙層板 |
  | 漂白枯幹 | **0.531** | 0.97 | ✗ 碎片 |
  ①**輸入閘 = `depth_ratio < 0.15`**(§5v 已進 `solidify_parts.py` 的同一支前篩):貼背鏡射
  只對「半個物體」合法,本來就有厚度的產出翻一倍就是雙層板(oak16 / juniper 兩張把這條
  演出來)。②**形狀閘 = 冠寬/冠高 ≥ ~1.2**(新):南洋杉 dr 只有 0.064、閘一穩穩過,瓣化
  出來卻是尖星 —— **錐形/尖塔樹的身分在垂直方向**,而瓣是放射鋪開的機制,兩者互斥。
  現有語料的分界很寬(1.52/1.60 ✓ vs 0.89 ✗),不是壓線判讀。
  ⇒ 對回遊戲樹型:**broadleaf 家族(橫展圓冠)+ 粗幹稀冠型可收;conifer2 / birch 這類
  直立錐形或細高型排除**(適用名冊仍待使用者定案 —— 這兩道閘只負責把不可能的先刪掉)。
- **未跑 / 待決**:①適用名冊拍板(閘已備好,使用者過目本輪對照表後定);②選定後
  `measure_veg_tris` 重量 + `node_cap` 重算 + intake 外廓契約;③`buildVegMeshes` 的
  逐株 K(位置雜湊 2~6,零共享 rnd §2.3)+ `aSpanF` instanced attribute + toon.js 彎折
  define;④全砲火 + 對照台(`veg` builder 那一列)。
  原型與黏土:study clone `canopy_petals.py`、`sheet_species.py`、`out_petals/`
  (`v6/` 高模、`game/`=100、`f160/`、`f225/`、`sp_*/` 逐樹種,各含 `top/`+`side/`;
  總表 `out_petals/species_sheet.png`)。

## 5y. Trial log (2026-08-07, 3060-machine session — v7 逐叢瓣化:可分離就分開膨脹旋轉、分層錯開)

> 使用者定案:「**如果葉冠可分離則分開膨脹、旋轉,越細的分越多旁瓣(數量無上限),
> 相鄰高度層的分岔角度盡量錯開**」。v6 是「整片冠 = 一瓣 × K」;v7 把冠拆成叢,
> 逐叢自己彎、自己轉、自己決定要複製幾瓣。

- **①可分離才分,分不開逐位元退回 v6**(原則 6):葉冠取連通元件,>1 叢走 v7,否則走
  v6 整片單瓣。`--no-split` 對照組實測與 `f160` 逐頂點 **max|Δ| = 0.0**。
- **叢的篩選 MUST 報帳**:T2 產出是**萬件等級的湯**(密冠橡樹 5,007 件 / 猴麵包樹 1,313 件 /
  南洋杉 3,657 件;面積 >0.5% 的只有 16~30 件)⇒ 由大到小取到累積 `--cover` 或撞到
  `--floor` 為止,**丟幾件、丟掉多少面積一律印出來**(靜默截斷是禁令)。實測
  密冠橡樹取 43 叢 = 面積 31.4%(丟 4,964 件 / 68.6%)、猴麵包樹取 23 叢 = 74.8%
  (丟 1,290 件 / 25.2%)—— 密冠那 68.6% 是真的細碎葉點,而 ③ 的複製把它補了回來。
- **③ 越細分越多旁瓣,無上限**:`N = round(最大叢等效直徑 ÷ 這叢等效直徑)`,下限 1、
  **不設上限**(使用者指定)。等效直徑取 `√面積`(單一數、對碎形邊界穩)。同一叢的 N 瓣
  **輪替交錯**進格位 —— 連著擺會把細枝擠成一撮,散開才是「一圈細枝」。
- **④ 相鄰高度層錯開 = 真的最大化**:層厚 = **叢高中位數**(推導不手寫)⇒ 密冠橡樹/猴麵包樹
  各 6 層;層內 Σ Δθ 仍恆 **360.000000°**(v6 的零均值誤差照舊,逐層各算一份);層間偏移
  取「本層瓣心到上一層瓣心的**最小**圓周距離最大」的那一個(720 取樣掃描)。**MUST NOT
  手寫半格或黃金角當常數** —— 各層瓣數不同(8/27/29/16/4/8),半格偏移在瓣數不等時對不齊,
  而畫面上只表現成「某兩層還是疊著」。實測偏移 154 / 229 / 46.5 / 225.5 / 0.5°。
- **⚠ 逐叢彎折會讓外圈整圈浮在空中**(v7 第一版實跑):每叢的 `bend_wedge` 在**自己的**
  徑向帶上正規化 ⇒ 一叢掛在 r ∈ [0.6, 0.8] 的,與主幹之間什麼都沒有。使用者說的
  「**分岔**」正是那一段 ⇒ 補 `twig()` 錐管(幹的冠內主幹頂 → 該叢內緣,粗細 ∝ 叢大小)。
  枝 MUST 在**楔彎之後**併入(它本來就沿 +X 直走,再彎一次會捲成弧)、但在縮放與旋轉
  **之前**(那兩步是整瓣的等比/剛體,枝要跟著走)。補完之後側視才是「樹枝 + 枝端葉團」。
- **人眼**:密冠橡樹 43 叢 / 6 層 / 144 瓣 = **真的像一棵樹**(側視圓頂 + 枝端葉團、俯視
  放射枝配葉團);猴麵包樹 23 叢 / 6 層 / 92 瓣同樣成立。這是 v6 沒有的東西 —— v6 是
  「一朵花」,v7 是「一棵有枝有叢的樹」。
- **⚠ 但它已經不是一般植被的量級了**(這一輪最重要的數字):160 面/瓣 ⇒ 密冠橡樹全樹
  **25,424** 面、猴麵包樹 **16,632** 面。往下壓的實測(40 面/瓣 + `--floor` 0.006 ⇒ 13 叢 /
  3 層 / 25 瓣 / 1,570 面)**人眼判退**:冠太開、只剩幾根刺,連 v6 的剪影都不如。
  ⇒ **v7 的可用下界遠高於 veg 預算(node_cap 225 × 逐株 Σ)**,它落在 §5v 自己點名的那條
  出路上 ——「高預算 GIANT 節點(數千面)」。定位因此分成兩層,而且**不互斥**:
  | | 機制 | 全樹面數 | 家 |
  |---|---|---|---|
  | v6 | 整片冠 × K 瓣(K=2~6) | 400~1,424 | 一般植被(broadleaf 家族) |
  | v7 | 逐叢 × 分層錯開 × 越細越多 | 16k~25k | **神木 / GIANT 級**(單株、instance 數個位數) |
  v6 的 §5x-b 入庫縫(逐 K 基準瓣 + `aSpanF`)**不受影響**;v7 因為逐叢幾何各異、瓣數無上限,
  走的是「整株烤成一顆 GIANT 節點」那條(§5u 的 `whole:` 縫已經在,deadtree 正是先例)。
- **未跑 / 待決**:①v7 要不要吃 GIANT(神木)那一格 —— 使用者定;②吃的話走 `whole:`
  縫 + GIANT 預算重量(神木 instance 數少,數千面可能撐得住);③`--cover`/`--floor`
  兩顆旋鈕與 ③ 的 N 上限(目前照使用者指定不設)要對著預算掃一次;④南洋杉那類
  §5x-b 形狀閘擋掉的樹型,v7 也不會救 —— 閘照舊。
  原型:`canopy_petals.py`(v7 路徑 + `--no-split` 對照組)、`out_petals/v7_oak`、
  `v7_baobab`、`v7_oak_lo`(各含 `top/`+`side/`)。

### 5y-b. 兩族的拆法相反(同日,使用者退掉 v7 的一刀切)

> 使用者:「**拆太多了,闊葉林不用拆這麼多份,除非是有非常顯著是不同主幹分岔。
> 針葉林的部分可以拆更細部,但最後丟棄內部的網格點,把外部包絡**」。

- **分流用的是既有那把尺**(`leaf_family` = §5x-b 的形狀閘 冠寬/冠高 ≥ 1.2),MUST NOT
  另立第二個判準 —— 兩處各判一次遲早出現「閘說闊葉、拆法走針葉」。
- **闊葉:只認顯著主幹分岔**(`major_forks`,等效直徑 ≥ `--major` 0.6 × 最大叢)。
  v7 把密冠橡樹當成 43 叢 = 把**每一團葉點**都讀成一根主枝;收緊之後密冠橡樹 43 → **2 根**、
  猴麵包樹 23 → **6 根**,留 ≤1 根就逐位元退回 v6(單幹闊葉的常態)。
- **針葉:細拆 + 外包絡**(`envelope` = 凸包(叢 ∪ 貼背鏡射))。三件事一次解決:
  ①凸包的定義就是「丟掉所有內部點」(使用者原話);②鏡射讓包絡對稱於背面,否則彎折後
  半邊瓣是刀背;③輸出天生水密單元件 ⇒ 這一族**不必跑 `wrap_close`、也不必減面**,
  每片自然落在幾十面 —— **針葉能細拆到 71 叢而不爆掉,靠的就是這一步**。
- **⚠ ③「越細分越多」的錨點沒設,收緊之後當場現形**:`N = round(dmax/d)` 讓**最大的那一叢
  恆得 1 瓣** ⇒ 密冠橡樹兩根分岔 = 全樹 **2 瓣 / 400 面**,樹沒了。比值只講相對多寡,絕對量
  要有錨(`--kbase`,逐族預設):**闊葉 4**(每根主幹分岔各自回到 v6 的 K 瓣)、**針葉 1**
  (細拆之後叢本來就有幾十個,再乘 4 直接爆)。
- **⚠ 幹與冠之間會開一段空隙**:分岔起點原本寫死 `trunk_top + 0.25H`,而密冠橡樹的
  `trunk_top` 在 6%H、冠底卻在 45%H ⇒ 主幹迴轉頂端搆不到冠。改成**最低那一叢的底**
  (推導不手寫),主幹 lathe 一起抬上去。
- **實測(160 面/瓣)**:
  | 樹型 | 叢 → 分岔/細拆 | 層 / 瓣 | 全樹面數 |
  |---|---|---|---|
  | 闊葉・密冠橡樹 | 43 → **2 根** | 2 / 9 | **1,540**(v7 是 25,424) |
  | 闊葉・猴麵包樹 | 23 → **6 根** | 2 / 32 | 5,304(v7 是 16,632) |
  | 針葉・南洋杉 | 3,657 → **71 叢** | 10 / 170 | 15,064 |
  人眼:闊葉回到「一棵蘑菇冠闊葉樹」(v7 的 144 片碎裂沒了);**南洋杉第一次成立** ——
  §5x-b 判它「攤成放射尖星、形狀閘擋掉」,細拆 + 外包絡之後是**錐形剪影 + 逐層枝叢**,
  那條形狀閘因此只適用於「整片冠 × K 瓣」的 v6,不適用於這一族(閘的適用範圍要跟著改)。
- **量級因此分成三段**(§5y 的兩段再分):闊葉走 v7 = **1.5k~5.3k 面**(比 v6 的
  400~1,424 高一階,但離針葉的 15k 還遠)、針葉走 v7 = **15k = GIANT 級**、v6 仍是
  一般植被那一格。**闊葉這一段是新出現的中間檔**,要不要開得看 GIANT / veg 兩邊的預算。
- **未跑 / 待決**:①`--major` 0.6 只在兩張闊葉語料上掃過(43→2、23→6),換語料要重掃;
  ②針葉的 `--cf-floor` 0.002 是實測選的(0.0004 → 450 叢 / 2,600 瓣 / 149,852 面爆掉、
  0.004 → 37 叢偏疏);③三段量級各自歸哪一格,等使用者定。

### 5y-c. 可見性剔除:從外面看不到的先刪,輪廓包絡是排序的結果

> 使用者:「**網格點太多的話,從外面看不到的內部開始合併刪除,最外層的輪廓包絡盡可能保留**」。

- **判準 = 曝露度**(`cull_hidden`):96 個 Fibonacci 球面方向,逐面數「從這裡射得出去的
  方向有幾個」。曝露度 0 = 完全被別的瓣包住 ⇒ 無條件刪;**預算破了才**按曝露度由低到高
  往上吃(使用者原話的前提子句是「太多的話」)。
- **「輪廓盡可能保留」MUST 是這個排序的結果,不是第二條規則**:剪影面的曝露度天然最高,
  排序自動把它們留到最後。反過來做(先 quadric 再想辦法保輪廓)行不通 —— quadric 對所有
  頂點一視同仁,吃掉的正好是稀疏的剪影邊緣,而面數看起來完全正常。
- **判定 MUST 在組裝完的整棵樹上做**:收穫來自瓣與瓣互相埋沒,逐瓣各自判等於一個都刪不掉。
- **⚠ 兩個靜默失敗,都是這一輪踩出來的**:
  ①**MUST NOT 用法向篩方向**。第一版寫 `n·d > 0` 只射朝外半球 —— 而 `lathe()` 的繞序讓
  **主幹法向朝內**,於是射線全射進實心裡、**整根樹幹被當成內部刪掉**(y-min −0.326 →
  −0.044)。面數只掉 6.7%、報表看起來完全正常。改成起點沿**射線方向**外推、完全不看法向:
  判的是「這個位置暴不暴露在外面」,與繞序無關(組裝件的繞序本來就沒人保證)。
  ②**輪廓保留度 MUST NOT 拿頂點凸包量**。凸包看不到「中間破一個洞」—— 剔到 1,500 面、
  冠上開了大洞的那一版,凸包比仍然逐方向 **100%**,守門數等於什麼都沒守到。改成
  **平行射線掃剪影覆蓋率**(逐方向 160² 條平行射線,數打得到的條數),逐方向取**最小值**
  (平均會把「某一個角度整片凹掉」平均掉,而那正是要抓的)。
- **實測(南洋杉 71 叢 / 170 瓣 / 15,064 面)**:
  | 預算 | 面數 | 刪掉 | 輪廓保留 min | 人眼 |
  |---|---|---|---|---|
  | 0(只刪看不到的) | 13,080 | **13.2%** | **99.9%** | 與原版分不出來 |
  | 8,000 | 8,000 | 46.9% | 94.0% | 仍成立 |
  | 6,000 | 6,000 | 60.2% | 81.6% | 邊緣,開始透 |
  | 4,000 | 4,000 | 73.4% | 57.6% | **破**:枝叢變散片、整棵看得穿 |
  | 2,000 | 2,000 | 86.7% | 29.4% | 廢 |
  ⇒ **13.2% 是純賺**(只刪完全看不到的,輪廓 99.9%),之後每砍一半就付一截輪廓;
  **守門線 ≈ 90%**(人眼與數字在 94% / 81.6% 之間翻轉)⇒ 針葉的可用下界 ≈ **8,000 面**。
- **收穫逐族差很多**:針葉 13.2%(170 瓣互相埋沒)、闊葉只有 **0.2~0.9%**(9~32 瓣、彼此
  幾乎不重疊,本來就沒有內部)。這一步是**針葉那一族的**省法,對闊葉近乎無效 —— 對闊葉
  仍要靠 §5y-b 的分岔數與逐瓣面數。
- **未跑 / 待決**:①`--budget` 要填多少等預算輪定;②96 個方向 / eps 0.0015×對角 兩個取樣
  參數只在這三張語料上跑過;③剔除後網格不再水密(內部被挖掉)—— 這一族本來就走
  「整株烤成一顆節點」,不吃 intake 的水密要求,但入庫時 MUST 確認外廓契約仍量得到。

### 5y-d. 減叢 vs 減面誰划算 + 三檔位的預算算術(決策用數字)

- **⚠ 兩條路線的輪廓數字原本不可比**:`silhouette_keep` 是「處理後 ÷ 這一次自己的原版」,
  減叢那一路每一階都對自己量 ⇒ 逐階都是 99.8~100%,讀起來像「減叢完全免費」。
  **統一對同一個基準量**(71 叢 / 13,080 面)之後才看得到真相:
  | 面數 | 減叢(少幾團葉,每團完整) | 減面(每團都在,打洞) |
  |---|---|---|
  | ~1,500 | — | 22% |
  | ~2,000 | **61.4%**(16 叢 / 23 瓣 / 2,123) | 29.5% |
  | ~4,000 | — | 57.6% |
  | ~6,000 | 78.5%(37 叢 / 67 瓣 / 5,877) | **81.7%** |
  | 8,000 | — | **94.1%** |
  兩條線**在 ~5,000 面交叉**:預算寬鬆時剔除幾乎免費(它只吃看不到的);預算一緊,
  剔除開始在每一團葉上打洞,而減叢是「少幾團、留下的完整」⇒ 低預算端減叢贏一倍。
- **⇒ 作業順序定案:先減叢逼近目標,再用剔除收尾**(組合實測,同一基準):
  | 組合 | 面數 | 輪廓保留 min |
  |---|---|---|
  | 37 叢 + 剔到 4,000 | 4,000 | **76.4%** |
  | 71 叢 + 剔到 4,000(純減面) | 4,000 | 57.6% |
  | 37 叢 + 剔到 3,000 | 3,000 | 67.4% |
  | 16 叢 + 剔到 1,500 | 1,500 | 57.9% |
  同樣 4,000 面,先減叢再剔面比純減面**多留 18.8pp 輪廓**。
- **預算算術**(來源:`tri_budget.json` —— veg 成長額度 **622,905**、現行植被總量上界
  212,963;instance 上界 broadleaf 211 / conifer2 73 / birch 98 / mangrove 98;
  神木 `placeGiantGroves` 上界 = 6 群 × 5~11 株 = **≤66 株**;tree 族 `kind_factor` 4
  ⇒ 換完整株 ≤ 5 × 現值(259~402)≈ **2,000 面/株**):
  | 方案 | 面數/株 | × instance 上界 | 佔成長額度 |
  |---|---|---|---|
  | v6 瓣化(K 平均 4) | ~880 | broadleaf 211 ⇒ 185,680 | **30%** ✓ |
  | v7 闊葉 | 1,537 | broadleaf 211 ⇒ 324,307 | **52%** ✓(吃掉一半) |
  | v7 針葉 @90% 門檻 | ~7,500 | conifer2 73 ⇒ 547,500 | **88%** ✗ |
  | v7 針葉 @90% 門檻 | ~7,500 | 神木 66 ⇒ 495,000 | **79%**,且已超 tree 族 `kind_factor` 上限(2,000)近 4 倍 ✗ |
  ⇒ **v7 針葉在現行預算下沒有位置**:過 90% 輪廓門檻要 7,500+ 面/株,而任何一格能給的
  只有 1,000~2,800。三條出路,**要選哪一條是使用者的決定**:
  ㋐ 降守門線(4,000 面 = 76.4%、3,000 = 67.4%);
  ㋑ 當 hero 資產(每張圖 1~3 株,13,080 面 × 3 = 39k = 6% 額度,輪廓 100%);
  ㋒ 再退掉別的東西換額度(§5u deadtree 那一輪的作法)。
  **v6 瓣化與 v7 闊葉都塞得下**,差別是 30% vs 52%。
- **未跑**:①以上是**上界算術**(instance 上界 × 面數上界),真值要 `measure_veg_tris.mjs`
  對選定樹種實跑;②神木 66 株是 `placeGiantGroves` 的**規劃上界**,地形淘汰後的真值未量;
  ③闊葉語料只有兩張(密冠橡樹 1,537 / 猴麵包樹 5,256)—— **猴麵包樹那張是 6 根分岔 × 32 瓣,
  已經是 v7 闊葉的 3.4 倍**,「1,537 面/株」不是穩定值,名冊定了要逐種重量。

### 5y-e. 共面合併:第三顆旋鈕,而且是唯一真正免費的那一顆

> 使用者:「**將相鄰且法線接近的面合併呢?**」

- **`merge_coplanar`**:法線夾角 < `--merge-deg` 的相鄰面取連通群,以該群的**邊界多邊形**
  重新三角化(`mapbox_earcut`,環依面積排序 ⇒ 最大的當外環、其餘當洞)。
  同一個平面上多餘的切割線刪掉**完全不改形狀**,所以它是三顆旋鈕裡唯一免費的。
- **順序 MUST 是「合併 → 剔除 → 減叢」**(由便宜到貴):剔除會把共面群切碎(邊界變鋸齒),
  反過來做合併的機會就沒了。
- **⚠ 沒有面積守恆守衛的話,它會靜靜地把整片挖掉**:0.1° 門檻下實測 **138/142 群**的
  邊界多邊形面積只有原群面積的 6.7% —— 那些群根本不是單純平面片(重疊 / 摺疊),
  合併下去等於把那一片刪掉,而報表只會顯示「省得更多」(面數 −30.5%),
  只有輪廓保留度掉到 **82.9%** 才抓得到。加上守衛(邊界面積 MUST 對得上群面積 ±2%,
  不對就原樣保留)之後,**每一個門檻的輪廓都回到 100%**,而省下的幅度也回到真實水準。
  門檻與省幅**非單調**(0.1° 省最少、2° 最多),因為門檻越鬆群越大、越容易碰到守衛 —— 
  這正是守衛在做事的證據,MUST NOT 拿「調鬆一點省更多」當直覺。
- **實測(同一基準 = 71 叢 / 13,080 面)**:
  | 方案 | 面數 | 輪廓保留 min |
  |---|---|---|
  | 71 叢 合併 + 剔除 | **11,258** | **99.9%** |
  | 37 叢 合併 + 剔除 | **5,110** | 78.5% |
  | 37 叢 只剔除(§5y-d) | 5,877 | 78.5% |
  | 16 叢 合併 + 剔除 | **1,791** | 61.3% |
  | 16 叢 只剔除(§5y-d) | 2,123 | 61.4% |
  ⇒ **同樣的輪廓、少 13~16% 的面**,逐階皆然。針葉的「免費那一段」因此從 §5y-c 的
  13.2% 擴到 **25.3%**(15,064 → 11,258,輪廓 99.9%)。
- **闊葉幾乎沒有共面可合**(1,540 → 1,533,−0.5%):它的瓣是 quadric 減過的有機曲面,
  本來就沒有多餘的平面切割線;針葉的瓣是**凸包**,才有那麼多共面小面可以併。
  ⇒ 這顆旋鈕與 §5y-c 的剔除一樣,**收穫集中在針葉那一族**。
- **預算連帶**:針葉過 90% 輪廓門檻的成本從 ~7,500 面/株降到 **~6,900**(× 73 = 81% 額度)
  —— 方向對,但**還是塞不下 conifer2**;§5y-d 的三條出路(降門檻 / hero 資產 / 換額度)
  維持不變。
- **未跑**:①`--merge-deg` 2.0 是實測選的(0.1~5° 掃過),換語料要重掃;②守衛的 ±2%
  只在這兩張語料上驗過;③合併後仍是三角網格(glTF 要三角形),沒有走 polygon 路線。

### 5y-f. 球面替代 / 合併太靠近的結構 —— 兩顆都做了,結論與直覺相反

> 使用者:「**進行更多簡化的幾何處理,例如使用球面、或合併太靠近的結構**」。

- **球面替代(`blob`,`--blob`)**:一叢換成貼著它主軸的**橢球** = 單位 icosphere 經 PCA 軸
  縮放(20 面 / subdiv 0,而凸包動輒 40~90 面)。軸取 **PCA 不取包圍盒**(斜插的葉叢用
  軸對齊盒量會虛胖一圈,而虛胖的球會蓋掉鄰叢的縫隙 = 剪影反而變胖);半徑取該軸投影的
  **P95 不取最大值**(單一離群點會把整顆球撐大)。
  | 門檻 | 面數 | 輪廓保留 min |
  |---|---|---|
  | 全部凸包(對照) | 11,258 | 99.9% |
  | 只換 < 0.3× 最大叢 | **10,689** | **97.5%** ← 肉眼分不出來 |
  | < 0.6× | 5,494 | 70.6% |
  | 全部換球 | 4,716 | 59.4% |
  ⇒ **只有最小的那一批值得換**(−5% 面 / −2.4pp,並排看不出差別);推到 0.6× 之後,
  同樣 5,000 面的預算下**輸給「直接少幾叢」**(5,110 面 @ 78.5%)。
- **合併太靠近的結構(`merge_near_clumps`,`--near`)**:中心距 < `near` ×(兩叢等效半徑和)
  就併成一叢(單一連結)。**與 `--cf-floor` 的差別是「併」不是「丟」** ⇒ floor 可以放到
  0.0004,丟掉的面積從 **54.5% 降到 24.4%**。
  **⚠ 但「併」MUST 只併瓣位、不併形狀**:第一版把併起來的群整個凸包,團與團之間的縫隙
  一起被包進去 = 一顆糊掉的大 blob,**等面數下輪廓比「丟碎屑」還差 27pp**(51.7% vs 78.5%)。
  改成群內**逐元件**各自取包絡之後形狀才回來。
  **⚠ 而它省不了面數**:面數 ≈(留下幾個元件)×(複製幾瓣),合併只動「幾叢」這個中間量。
  實測 floor 0.001 + near 1.2 = 22,536 面(2× 凸包對照)、輪廓 min 87.6% / **mean 102.5%**
  —— mean 破百的意思是它**比基準更飽滿**(把被丟掉的那 30% 面積找回來了)。
  ⇒ 這顆旋鈕的用途是**品質**不是預算:要一棵更密的樹就開它,要省面數它幫不上忙。
- **三次量測指向同一條原則**:等面數之下,**「少幾團完整的葉」永遠贏過「每一團都留但畫得更粗」**
  —— 減叢 > 減面(§5y-d,4,000 面 +18.8pp)、減叢 > 球面(本節,5,000 面 +7.9pp)、
  減叢 > 合併(本節,5,000 面 +26.8pp)。原因是這棵樹的**識別度住在「一團一團 + 團間的縫」**:
  粗化每一團會把所有團一起糊掉,丟掉幾團則讓剩下的維持銳利(§5y 那次「100 面/瓣 = 水晶碎片」
  被人眼判退,是同一件事的第一次現形)。
- **旋鈕總表(針葉,由便宜到貴;闊葉只有 ①⑤ 有感)**:
  | # | 旋鈕 | 代價 | 幅度(針葉) |
  |---|---|---|---|
  | ① | 共面合併 `--merge-deg` | 零 | −14% |
  | ② | 可見性剔除 `--cull` | 零 | −13% |
  | ③ | 球面替代 `--blob 0.3` | −2.4pp | −5% |
  | ④ | 合併太靠近 `--near` | **不省面**(+品質) | — |
  | ⑤ | 減叢 `--cf-floor` | 線性掉輪廓 | 任意 |
  | ⑥ | 減面 `--budget` | 最貴(< 5,000 面時) | 任意 |
  ①②③ 疊起來 = **−29%(15,064 → 10,689,輪廓 97.5%)**,之後才動 ⑤。
- **未跑**:①`--blob` 的 0.3 門檻與 P95 只在南洋杉上掃過;②`--near` 的品質模式沒有對
  「更密的樹是否值得 2× 面數」下判斷,那要看名冊定在哪一格;③闊葉對 ①②③ 幾乎無感
  (瓣少、彼此不重疊、曲面已減過),它的旋鈕只有分岔數與逐瓣面數。

### 5y-g. 降級鏈:使用者定案的**順序**做成一條可跑的階梯

> 使用者:「**減少瓣數、減少瓣與瓣的距離、減少葉冠分離的判斷標準,可以橢球、圓柱、
> 圓錐、角錐等簡易多邊形組合取代的話就取代、逐步放寬取代標準,最後剩餘的放寬合併的
> 法線夾角**」。⇒ `lod_ladder.py`,每一階只動**一顆**旋鈕(這樣「面數掉多少 / 輪廓賠多少」
> 逐階歸得了因),順序逐字照定案。

- **基本體替代 `best_prim`**:四種候選(橢球 20 面 / 圓柱 24 / 圓錐 12 / 角錐 8),主軸與
  尺寸走 `_pca_frame`(PCA + P95,與 `blob` **同一份**,MUST NOT 各寫一份);誤差 =
  「叢表面取樣點到基本體表面的 RMS 距離 ÷ 特徵長」—— 量**表面距離不量體積比**,體積比
  對薄片型的叢完全無感(兩邊都近乎零體積卻差很多)。誤差 > `--prim-tol` ⇒ 不換(原則 6)。
  **實測選型嚴重偏圓柱**(71 叢裡 65~67 選圓柱,橢球/圓錐/角錐合計 4~6):六角柱對
  「扁長葉叢」就是最好的 RMS 近似。四種都給是對的(真的有叢挑了別的),但別預期均分。
- **實測階梯**(針葉南洋杉,對同一基準 71 叢 / 13,080 面):
  | 階 | 面數 | 輪廓 min / mean |
  |---|---|---|
  | 原樣 | 11,258 | 99.9% / 100.0% |
  | ①瓣數 ×0.7 | **7,836** | 81.7% / 93.1% |
  | ①瓣數 ×0.5 | **6,206** | 78.4% / 87.5% |
  | ②瓣距 4%→2% | 6,232 | 78.6% / 87.9% |
  | ②瓣距 →1% | 6,225 | 78.8% / 88.2% |
  | ③分離門檻 ×2 | **2,949** | 65.3% / 78.7% |
  | ③分離門檻 ×4 | **1,340** | 58.9% / 71.9% |
  | ④基本體 tol .01 | 1,092 | 52.9% / 61.8% |
  | ④基本體 tol .02 | 644 | 40.9% / 51.3% |
  | ④基本體 tol .05 | **500** | 35.3% / 47.4% |
  | ⑤合併夾角 5° | 488 | 35.2% / 46.9% |
  | ⑤合併夾角 15° | 507 | 35.3% / 47.4% |
- **兩階的行為與名字不一樣,MUST 照實用**:
  ①**②「減少瓣與瓣的距離」不是面數旋鈕**(6,206 → 6,232 → 6,225,平的),它把 ① 讓出的
  角度補回去 ⇒ **零面數成本換回 +0.4pp 輪廓**。所以它 MUST 與 ① **同時**用(①減瓣數、
  ②立刻把剩下的瓣加寬補位),當成獨立的一階去期待它省面是誤讀。
  ②**⑤「放寬合併的法線夾角」排在鏈尾幾乎是 no-op**(500 → 488;放到 15° 反而回到 507 ——
  群變大之後被面積守恆守衛擋下的更多)。它的價值在鏈**頭**就已經領走了(§5y-e:2° 免費
  −14%)。⇒ 使用者把它排最後是對的**順序**,但它在那個位置的**幅度**接近零。
- **①③④ 才是真正的面數槓桿**:① 第一刀最划算(−30% 面 / −18pp);③ 幅度最大
  (6,225 → 1,340);④ 能一路壓到 **500 面** —— 這是這條鏈第一次進到一般植被的量級
  (node_cap 225 × 幾個節點),證明機制**收得下去**,只是那個檔位的輪廓只剩 35%。
- **人眼分界在 6,206 與 1,340 之間**:6,206 仍讀作針葉樹(略疏),1,340 剩兩三團浮在幹上、
  已經不是樹。⇒ **實用區間 = 6,000~11,000 面**,與 §5y-d/e 的守門線(≈90% 輪廓)一致,
  對 conifer2 的 73 株預算結論**不變**。
- **未跑**:①階梯只在南洋杉上跑過,闊葉那條(分岔數 + 逐瓣面數)沒有對應的鏈;
  ②`--nscale` / `--gap` / `--prim-tol` 的每一格都是手選的,不是解出來的 —— 要做成
  「給定預算自動選檔」還得把這張表擬成曲線;③基本體目前逐叢**獨立**挑,沒有做
  使用者說的「**組合**」(一叢用兩個以上基本體拼)—— 那是下一步。

### 5y-h. ⚠ 更正:守門線 MUST 逐槓桿分開訂 —— §5y-d「針葉塞不下」的結論作廢

> 使用者:「**先看圖片,要壓到多少面才夠?**」—— 看圖之後,先前那條全域守門線是錯的。

- **錯在哪**:§5y-c 訂的「輪廓保留 ≈ 90%」是拿**減面**(在每一團葉上打洞)那一組校準的,
  然後被 §5y-d/e **當成全域門檻**去算預算,結論是「v7 針葉在現行預算下沒有位置」。
  而降級鏈的 2,949 面那一階輪廓只有 **65.3%**,人眼卻**仍讀作針葉樹**(分層、枝叢、幹都在,
  只是稀);同樣 65% 的減面版早就破了。
- **原因**:同一個輪廓百分比,**來源不同、好看程度差很多** —— 減叢掉的是「幾團完整的葉」
  (剩下的仍銳利),減面掉的是「每一團上的洞」(全部一起糊)。⇒ **守門線 MUST 逐槓桿訂**:
  減面 ≥ 90%、**減叢 ≥ 65%**。拿單一數字跨槓桿比較,就會像 §5y-d 那樣把可行方案判死。
- **目標面數(回答使用者的問題)**:
  | 掛哪 | instance 上界 | 可負擔面/株 | 對應階 |
  |---|---|---|---|
  | **conifer2 全量,吃 1/3 額度** | 73 | **2,844** | ③門檻×2 = **2,949** ✓ |
  | conifer2,吃 1/2 額度 | 73 | 4,266 | ①×0.5 與 ③ 之間 |
  | 神木 tree 族(`kind_factor` 硬閘) | ≤66 | **2,010** | ③×2 與 ×4 之間 |
  | hero 資產 | 1~3 | 不用壓 | 原樣 11,258 |
  ⇒ **目標 ≈ 2,900 面/株,現行階梯已經打得到**;conifer2 全量 73 × 2,949 = 215,301 =
  額度的 **35%**,塞得下。**§5y-d 的「沒有位置」與那三條出路(降門檻 / hero / 換額度)
  一併作廢** —— 它是拿錯門檻算出來的。
- **人眼分界改訂在 2,949 與 1,340 之間**(§5y-g 寫的「6,206 與 1,340 之間」偏保守):
  1,340 面剩兩三團浮在幹上、層次沒了,那才是破。
- **未跑**:①這次判讀是**單張側視縮圖**,MUST 補「遊戲內實際尺寸 + 賽璐璐材質 + 勾線」
  的定場圖再確認(勾線會把稀疏處的破綻放大);②2,844 這個數字假設 conifer2 吃 1/3 額度
  —— 額度怎麼分是名冊那一輪的事;③還沒動過的槓桿 = **基本體組合**(一叢用兩三個基本體
  拼,目前每叢只挑一個),要再往下壓(例如只吃 1/6 額度)從那裡下手。

## 5z. Trial log (2026-08-08 — 簡單幾何版:旁瓣佈局照舊,葉冠整組換成基本體)

> 使用者:「**另外嘗試一個簡單幾何版本,旁瓣處理完成後葉冠直接用簡單幾何圖形取代,
> 針葉林使用多角錐,闊葉林使用多面體或橢球,樹枝樹幹使用圓柱、圓台或多面柱,尖端使用
> 細圓錐或細角錐**;可調整不同茂密程度,或拿掉葉冠變枯木;與先前對話的版本列圖比較。」
> ⇒ `simple_tree.py`(新)+ `sheet_simple.py`(列圖),產出 `out_simple/sheet_*.png` 五張。

### 5z-a. 它**不是**降級鏈的第 N 階,是另一條路線

| | §5y-g ④ 基本體替代 | 本輪 簡單幾何版 |
|---|---|---|
| 挑形狀的依據 | 逐叢 **RMS 誤差**挑四種裡最像的(實測 71 叢裡 65~67 挑到圓柱) | **樹種指定**:針葉多角錐 / 闊葉橢球或多面體 |
| 過不了門檻 | `--prim-tol` 退回凸包 ⇒ 一棵樹是**混血** | 沒有門檻、沒有退路,葉冠**整組**換掉 |
| 幹與枝 | 沿用浮雕 lathe / 錐管 | 一起換成圓台堆疊 / 收尖細錐 |
兩者 MUST NOT 互相取代:前者的目的是「在不太走鐘的前提下省面」,後者是「換一種造型語言」。

### 5z-b. 佈局 MUST 共用,否則列圖比較沒有意義

列圖比較的前提是**只有葉冠幾何這一個變因**在動 ⇒ 從 `canopy_petals.py` 抽出三個縫,
兩版同吃:`trunk_cut`(幹/冠分界)、`clump_metrics`(逐叢量測,新增 `r_out`/`y_lo`/`y_hi`
三欄只有簡單幾何版讀)、`plan_lobes`(③複製幾瓣 / ④分幾層 / 層內角格與零均值誤差 /
層間錯開偏移)。**抽出前後 v7 逐位元相同**(重跑 lod00 同參數,`max|ΔV| = 0.0`、faces 全等)
—— 這是抽縫唯一可接受的驗收方式。另補 `twig(r1 → 0)` 的單一頂點分支(= 使用者的「尖端」);
r1 > 0 的路徑逐位元不變。**MUST NOT 靠「給一個很小的 r1」假裝收尖** —— 梢端會留一圈零面積
三角形(法線 NaN),勾線那一 pass 會在每一根枝的尖端畫出一坨黑點。

### 5z-c. 基本體:面數是**算出來的**,不是問函式庫要來的

自建 `prim_cone` / `prim_bipyr` / `prim_prism`(+ trimesh icosphere 當橢球),面數精確:

| 基本體 | 面數 | 用途 |
|---|---|---|
| 多角錐 `cone(n)` | 2n−2(n=6 ⇒ **10**) | 針葉葉冠(使用者指定)、尖端 |
| 雙角錐 `bipyr(n)` | 2n(n=4 = **八面體 8**、n=6 ⇒ 12) | 闊葉的「多面體」選項 |
| 多面柱 `prism(n, taper)` | 4n−4(n=6 ⇒ **20**) | 幹與枝:taper=1 圓柱 / <1 圓台 / n 小 多面柱 |
| 橢球 `icosphere(0/1)` | **20** / 80 | 闊葉葉冠(使用者指定) |
「圓柱 / 圓台 / 多面柱」是**同一支函式的三組參數**,「細圓錐 / 細角錐」是同一支的兩個 n ——
分開寫成三支五支就是同一件事的第 N 份實作。自建的理由是**面數就是這一版的賣點**:靠
`trimesh.creation` 的慣例去猜面數,等於沒有預算。全部驗過 watertight 且體積為正(繞序正確)。

### 5z-d. 切向半徑取**弦長**,不取弧長、也不取叢自己的厚度

浮雕板的 z 向厚度趨近零(它是半個物體),v7 是把 z 映成角向楔 `bend_wedge`;**基本體不會彎**
⇒ 三個軸改成圓柱座標:徑向 ← `r_in ~ r_out`、垂直 ← 叢高、切向 ← `r_mid × sin(fill × span / 2)`。
取**弧長**會在瓣數少時(span 180°)撐出一顆比樹還寬的球;取**叢自己的 z** 會薄成一張紙。
弦長同時讓 `--gap`(瓣與瓣的距離)在本版維持原本的語意。

### 5z-e. ⚠ 幹的剖面吃到冠高 —— 剪影 88% 而「樹沒了」

第一版 `stack_trunk` 把寬度剖面吃到 `y_top`,而針葉樹走**中央主幹**時 `y_top` = 冠頂
⇒ **把冠寬讀成幹寬**,長出一根與樹冠等粗的六角柱,葉冠整個埋進去。
**兩個指標都沒有反應**:面數 2,532 正常、輪廓保留 min **88.0% / mean 96.0%**(比修好之後的
73.0% / 76.4% 還「漂亮」—— 因為那根柱子把剪影填滿了)。只有看圖才發現。
⇒ 修法:剖面 MUST 只吃 `y ≤ trunk_top`,冠內那一截 MUST 是外推的收斂錐(`r_end_f`,
與 v7 `tp += [(tp[-1][0] * 0.6, spine_top)]` 同一條規則;中央主幹取 0.35)。
**這是 §5y-h「先看圖片」的第二次現形**,而且比第一次更硬:上一次是「同一個百分比、來源不同
好看程度不同」,這一次是**百分比往錯的方向動**。⇒ 輪廓保留度 MUST NOT 單獨當守門數。

### 5z-f. 實測:針葉(南洋杉,對 v7 原樣 11,258 面量剪影)

| 版本 | 面數 | 輪廓 min / mean | 人眼 |
|---|---|---|---|
| v5 黑桃瓣 K5(整片冠) | 900 | 74.2% / 77.3% | 一朵花,不是樹 |
| v7 逐叢瓣化 原樣 | 11,258 | 100% / 100% | 基準 |
| 降級鏈 ③門檻×2 | 2,949 | 65.3% / 78.8% | 一堆浮著的板片 |
| 降級鏈 ④基本體 tol.05 | 500 | 35.3% / 47.4% | 破 |
| **簡單幾何 逐瓣多角錐 full** | **2,532** | **73.0% / 76.4%** | **分層針葉樹,枝叢清楚** |
| 簡單幾何 疊層多角錐 | **172** | 95.6% / 116.5% | 經典低模聖誕樹 |
| 簡單幾何 整冠單錐 | **82** | 83.9% / 98.1% | 一顆錐,遠景 LOD |
| 簡單幾何 枯木 bare | 144 | 8.5% / 14.2% | 只剩一根桿 + 三根枝,太光 |
| 簡單幾何 枯木 sparse | 288 | 12.5% / 17.2% | **讀作枯木** |
**同面數下贏降級鏈**:2,532 vs 2,949 —— 面數少 14%、輪廓 min 高 7.7pp(mean 反而低 2.4pp,
兩個數字打架),而**圖差得很多**:降級鏈那一階是散落的板片,簡單幾何是有層次的枝叢。
⇒ 這一組是「數字幾乎打平、圖不打平」的典型,判準只能是圖(§5y-h)。原因與 §5y-h 同一條:
降級鏈到那一階是**在每一團葉上打洞**,簡單幾何是**每一團都完整、只是換成一顆錐**。

**茂密程度階梯**(同一棵樹,一顆旋鈕同時動 ①瓣數 ②瓣距 ③分離門檻 —— §5y-g 實測 ② 不省
面數、它是 ① 的補償,MUST 同時動):

| 檔 | 面數 | 輪廓 min / mean | 人眼 |
|---|---|---|---|
| bare | 178 | 25.5% / 30.7% | 不是樹 |
| sparse | 438 | 46.0% / 53.9% | 疏但成立 |
| **mid** | **1,138** | 56.2% / 63.3% | **乾淨的分層針葉樹** |
| full | 2,532 | 73.0% / 76.4% | 較密 |
| lush | 13,464 | 84.1% / 94.2% | 密,但回到 GIANT 級面數 |
| full・四角錐 `sections 4` | 1,848 | 70.4% / 74.6% | 與六角錐幾乎分不出來 |
| full・八角錐 `sections 8` | 3,216 | 73.8% / 77.1% | 同上 |
⇒ **邊數是最便宜的旋鈕**:6 → 4 省 27% 面而人眼無感;要再省先動它,不要先動茂密度。

### 5z-g. 實測:闊葉 —— `--major` 是這一族的主旋鈕,不是茂密度

| 版本 | 面數 | 輪廓 min / mean | 人眼 |
|---|---|---|---|
| 橡樹 v5 黑桃瓣 K5 | 880 | 228% / 281% | (基準 v7 橡樹本身很薄) |
| 橡樹 v7 逐叢瓣化 | 1,533 | 100% / 100% | 基準 |
| 橡樹 簡單幾何 橢球 `major .6` | 240 | 81.6% / 94.2% | **兩坨,像蝴蝶不像樹** |
| 橡樹 簡單幾何 雙角錐 `major .6` | 168 | 72.3% / 83.2% | 同上,更有稜 |
| 橡樹 簡單幾何 八面體 `major .6` | 132 | 62.3% / 80.4% | 同上,最省 |
| **橡樹 簡單幾何 `major .3`** | 3,904 | 242% / 271% | **圓潤的團塊冠,成立** |
| 橡樹 簡單幾何 `major .15` | 14,292 | 270% / 320% | 更飽滿,但已是 GIANT 級 |
| 橡樹 整冠單橢球 | **80** | 90.2% / 113.6% | 一顆球,遠景 LOD |
| 猴麵包樹 v7 逐叢瓣化 | 5,256 | 100% / 100% | 基準 |
| **猴麵包樹 簡單幾何 橢球** | **748** | **94.1% / 100.2%** | **成立**(6 根分岔 × 32 瓣) |
- **`--major 0.6` 對簡單幾何版太緊**:§5y-b 訂它是為了收掉 v7 的「43 叢 = 43 根主枝」,而
  v7 靠**一瓣繞著彎**把 2 根分岔撐成整片冠;**基本體不會彎** ⇒ 同樣 2 根就只能是兩坨。
  ⇒ 這一族的主旋鈕是分岔數,茂密度是次要的。猴麵包樹(6 根)不必調就成立,正說明問題
  出在「分岔太少」而不是「基本體不行」。
- **剪影 % 在這一族不可跨版本讀**:v7 橡樹的瓣是**薄刃**(浮雕板減面而來),基本體是**實體**
  ⇒ 同一個剪影框裡自然覆蓋得多,242% 不代表「比基準好 2.4 倍」。這一族一律以圖為準。

**分岔開夠之後,再用茂密度把面數壓回預算**(橡樹 `--major .3`;% 只在這張表**內部**可比):

| 檔 | 面數 | 輪廓 min / mean | × broadleaf 211 | 佔成長額度 | 人眼 |
|---|---|---|---|---|---|
| bare | 536 | 169% / 206% | 113,096 | **18.2%** ✓ | 團塊少,像大灌木 |
| **sparse** | **1,276** | 215% / 244% | 269,236 | **43.2%** ✓ | **圓潤團塊冠,成立** |
| mid | 2,892 | 233% / 255% | 610,212 | 98.0% ✗ | 更密,但塞不下 |
| full | 3,904 | 242% / 271% | 823,744 | 132% ✗ | 同上 |
| sparse・雙角錐 | 892 | 195% / 220% | 188,212 | **30.2%** ✓ | 有稜的團塊 |
| **sparse・八面體** | **700** | 190% / 208% | 147,700 | **23.7%** ✓ | 最省,結晶感 |
⇒ **闊葉的答案 = `major .3` + `sparse`(1,276)或 `sparse 八面體`(700)**,兩者都同時過
成長額度與 `kind_factor`;`mid` 以上兩道閘都過不了。**換基本體比調茂密度便宜**:
橢球 20 面 → 雙角錐 12 → 八面體 8,面數掉 45% 而輪廓只掉 25pp、圖上仍是同一棵樹。

### 5z-h. 枯木是**同一副骨架的另一態**,不是另一棵樹

`--crown none` 走**同一份佈局**,只是把葉冠基本體換成收尖的細錐(= 光禿的枝,一路伸到
`r_out`),幹頂再補一根斷梢。⇒ 同一棵樹的「有葉 / 無葉」兩態,骨架逐位元同一副。
`bare` 那一檔太光(針葉 144 面、闊葉 96 面,剩一根桿加三根枝),**`sparse` + `--twig-r 0.02`
才讀作枯木**(針葉 288 面 / 闊葉 456 面)。
- **⚠ 枯木 MUST 走中央主幹**:闊葉在有葉時是「幹到冠底就分岔」(v7 的作法),而枯木沿用
  那一條的下場是**所有枝從同一點放射 = 一叢星芒**(實測闊葉枯木 456 面那一版)。葉冠一拿掉,
  遮住那個交會點的東西就沒了 ⇒ 枯木一律 `leader`(幹走到冠頂、枝**沿著幹**掛在自己的高度)。

### 5z-i. 預算算術(對 `tri_budget.json`:veg 成長額度 622,905;tree 族 `kind_factor` 硬閘 ≈ 2,000 面/株)

| 方案 | 面/株 | × instance 上界 | 佔成長額度 | `kind_factor` |
|---|---|---|---|---|
| 針葉 簡單幾何 **mid** | 1,138 | conifer2 73 ⇒ 83,074 | **13.3%** ✓ | ✓ |
| 針葉 簡單幾何 full | 2,532 | 73 ⇒ 184,836 | 29.7% ✓ | **✗ 超過 2,000** |
| 針葉 疊層多角錐 | 172 | 73 ⇒ 12,556 | 2.0% ✓ | ✓ |
| **闊葉 `major .3`・sparse** | 1,276 | broadleaf 211 ⇒ 269,236 | **43.2%** ✓ | ✓ |
| 闊葉 `major .3`・sparse 八面體 | 700 | 211 ⇒ 147,700 | **23.7%** ✓ | ✓ |
| 闊葉 `major .3`・mid | 2,892 | 211 ⇒ 610,212 | 98.0% ✗ | ✗ |
| 闊葉 整冠單橢球 | 80 | 211 ⇒ 16,880 | 2.7% ✓ | ✓ |
| 枯木 sparse(針葉) | 288 | deadtree 121 ⇒ 34,848 | 5.6% ✓ | ✓ |
⇒ **針葉的答案是 `mid` = 1,138 面/株**:同時過「成長額度」與「tree 族 `kind_factor`」兩道閘,
而 §5y-h 為 v7 訂的目標是 2,900(只過得了前者)。簡單幾何版把針葉那一格的成本壓到**四成以下**。
**闊葉是 `major .3` + `sparse`(1,276)**;兩族合計 269,236 + 83,074 = **56.6%** 額度,
其餘(shrub 1909 / birch 98 / mangrove 98 / deadtree 121)還有 43% 可用。

### 5z-k. 第二輪四條(同日,使用者看過列圖之後)

> ①「**樹枝不要全部都是水平分岔,0~30° 斜上都有可能,同一棵角度 ±3° 的誤差內,分岔高度也
> 上下錯開**」②「**闊葉林的葉冠盡量胖一點,偏心率 0.5~1**」③「**針葉林的葉冠使用雙錐體,
> 盡量細長,0.2~0.4**」④「**葉冠體積高比例重合時合併**」。

- **⚠「偏心率」在這裡讀作「短軸/長軸」而不是天文學的 `e = √(1−b²/a²)`** —— 這是一個**取捨**,
  MUST 記下來:照 `e` 讀的話,闊葉的 0.5~1 是**越來越扁長**(與同一句的「盡量胖一點」相反)、
  針葉的 0.2~0.4 反而接近球(與「盡量細長」相反)。**兩句話同時成立的只有軸比這個讀法**,
  故 `FAM_RATIO = {conifer: (0.2, 0.4), broadleaf: (0.5, 1.0)}`。若使用者要的是天文學定義,
  兩族的數對互換即可(`clamp_ratio` 不必改)。
- **① 仰角是「這一棵樹」的性質,不是逐枝亂數**:`--branch-deg` 逐株落在 0~30°,同一棵樹內
  只有 `--branch-jit` ±3° 的**零均值**誤差,走 `petal_jitter` **同一支**(§2.3 的亂數紀律 ——
  在這裡另起一條序列就是第二份決定性來源)。
- **① 掛枝高度是「解」出來的,不是另外抽的**:葉冠位置早被佈局定死 ⇒ `y_att = y_c − r_in·tanθ`。
  這一步順便兌現「分岔高度上下錯開」的一半(`r_in` 逐叢不同 ⇒ 掛點自然散開);**另一半必須
  顯式給** —— 同一叢複製出來的 N 瓣 `r_in`/`y_c` 完全相同,不另加一道零均值錯開(`--fork-jit`
  × 層厚)的話,那 N 根枝會**疊在同一個高度**上,而畫面上只表現成「這一圈枝好像是一片」。
- **① 的連帶:幹高 MUST 由最高的掛枝點反推**。斜上的枝把掛點往下推,但闊葉「幹到冠底就
  分岔」那條規則會讓內圈的高叢掛在 `fork_y` **之上** ⇒ 枝的根部懸空。⇒ `y_top =
  max(冠底或冠頂, max(y_att))`,而這也把幾何合成的順序倒過來:**先定案逐瓣,再建幹**。
- **③ 雙錐體的尖端 MUST 對齊最長軸**(`AXIS_OF[argmax(rad)]`,推導不手寫):三軸來自量測
  (徑向 ← `r_in~r_out`、垂直 ← 叢高、切向 ← 弦長),誰最長逐叢不同;把軸寫死成「徑向」,
  扁而高的叢會被擺成一根橫躺的針。順帶修掉一個潛伏的錯:`AXIS_PERM['t']` 原本寫成 `[2,1,0]`
  (尖端仍留在 Y 上 = 這個選項無效),正解是 `[0,2,1]`。
- **②③ 的夾制 MUST 保住最長軸**:`clamp_ratio` 只夾另外兩軸。三軸一起 clip 會把整顆縮小
  (`np.clip(r, lo·L, hi·L)` 對 `hi < 1` 連最長軸都會砍到 `hi·L`),剪影當場少一圈。
- **④ 與 §5y-f 的 `merge_near_clumps` 是兩件事,MUST NOT 合併成一支**:那一支量的是**叢**的
  中心距、發生在**佈局之前**、併的是**瓣位**;這一支量的是**擺好之後**兩顆冠層基本體真的
  疊了多少**體積**,門檻是「交集 ÷ 較小那顆」。代理用**等體積球**(`r_eq = (abc)^⅓`,球球
  交集有閉式解)—— 橢球對橢球的真交集沒有閉式解,而「高比例重合」這個判準本來就只需要
  「疊得多不多」。**併起來的那一顆 MUST 覆蓋成員**(圓柱框下逐軸取 `|偏移| + 該成員半徑`
  的最大值),MUST NOT 取平均半徑 —— 那會把兩顆縮成更小的一顆,剪影開洞(§5y-f「整群一次
  凸包等面數下輪廓還差 27pp」是同一個坑的另一面)。

**實測(逐條疊上去,這樣「面數掉多少 / 形變多少」歸得了因)**:

| 針葉・density mid(對 v7 11,258 量) | 面數 | 輪廓 min / mean |
|---|---|---|
| ① 第一輪(多角錐・水平枝) | 1,138 | 59.0% / 66.0% |
| ② + 雙錐體 | 1,284 | 61.7% / 68.2% |
| ③ + 軸比 .2~.4(細長) | 1,284 | **52.7% / 56.1%** |
| ④ + 分岔 18°±3° / 高度錯開 | 1,284 | 52.6% / 56.1% |
| **⑤ + 重合合併 .5 = 定案** | **1,212** | 52.8% / 56.3% |
| 分岔 0°(全水平) | 1,212 | 52.9% / 56.4% |
| 分岔 30°(最斜) | 1,212 | 52.9% / 56.4% |
| 合併門檻 .8(只併幾乎重疊) | 1,248 | 52.8% / 56.3% |

| 闊葉・major .3 + sparse(對 v7 1,533 量;% 只在表內可比) | 面數 | 輪廓 min / mean |
|---|---|---|
| ① 第一輪(橢球・水平枝) | 1,276 | 215.0% / 244.6% |
| ② + 軸比 .5~1(胖) | 1,276 | 218.9% / 256.2% |
| ③ + 分岔 18°±3° / 高度錯開 | 1,276 | 220.5% / 257.0% |
| **④ + 重合合併 .5 = 定案** | **1,236** | 220.5% / 257.0% |
| 軸比 .8~1(最胖) | **1,056** | 231.3% / 283.7% |
| 雙角錐 + 軸比 .5~1 | **868** | 204.3% / 231.8% |
| 枯木(斜枝 + 高度錯開) | 456 | 56.6% / 65.8% |

四條的性價比差很多,**而且有兩條與直覺相反**:
- **③ 軸比是這一輪最貴的一刀**(針葉 −9.0pp 輪廓、**零面數成本**)。這不是 bug ——
  「盡量細長」本來就是把體積拿掉,付的是剪影不是面數。要不要付這個價是造型決定。
- **④ 分岔仰角對剪影幾乎無感**(0° 與 30° 差 0.1pp),但幾何 `max|ΔV| = 0.165` = **樹高的 17%**
  —— 枝被葉冠遮住了。⇒ **判這一條 MUST 看枯木**,拿有葉狀態的剪影或縮圖去看等於沒看。
- **⑤ 重合合併真的免費**:針葉 −72 面(併掉 6 顆)、闊葉 −40 面(2 顆),輪廓 +0.1pp / 0.0pp。
  門檻 .8 只併掉一半(1,248)⇒ .5 是實測選的,換語料要重掃。
- **② 與 ④ 互相加成**:闊葉軸比拉到 .8~1(最胖)之後面數反而從 1,276 掉到 **1,056** ——
  胖了以後彼此重合更多、被合併掉的更多。「調胖」在這一版是**省面**的方向,不是耗面的方向。
- **雙角錐當闊葉冠也成立**(868 面,12 面/顆 vs 橢球 20):輪廓 −16pp 但圖上仍是同一棵樹,
  是目前最省的闊葉檔。

**分岔仰角只能在枯木上判**(`sheet_round2_branch.png`,針葉 288 面 / 闊葉 456 面,逐格面數相同):
0° 是一圈水平刺、30° 是明顯斜上的枝且掛點沿幹分布,兩者一眼可分;而剪影 min 從 15.9% 到
15.9%(針葉)、22.5% 到 23.9%(闊葉)—— **這個數字對這一條完全沒有解析度**。
⚠ 但同一張表也給了一個**還沒兌現**的結果:「不錯開高度」(`--fork-jit 0`)與「同株誤差 0°」
(`--branch-jit 0`)在闊葉 sparse 上**看不出差別**(剪影 ±0.1pp,圖上也分不出)——
那一檔每叢只複製一兩瓣,兩顆次級旋鈕沒有作用對象。要判它們 MUST 找**同一叢複製多瓣**的
檔位(針葉 full / lush),這一輪沒跑。

**預算連帶**(instance 上界 conifer2 73 / broadleaf 211,成長額度 622,905):
針葉定案 1,212 ⇒ **14.2%**;闊葉定案 1,236 ⇒ **41.9%**、軸比 .8~1 版 1,056 ⇒ 35.8%、
雙角錐版 868 ⇒ **29.4%**。兩族合計 **43.6%~56.1%**,`kind_factor` 2,000 那道硬閘全數通過。

### 5z-l. 第三輪兩條:淨幹下 1/4 不分岔 + 懸空葉冠放大/清理

> ①「**樹幹下面 1/4 的部分不要有樹枝分岔,未滿足的話延伸到滿足即可**」
> ②「**好幾個葉冠看起來懸空沒有連結、太稀疏,調整放大或清理**」。

- **① 延伸的是幹,不是把枝往上推**:把犯規的枝夾到那條線上,最低的一圈枝會**全部擠在同一個
  高度** —— 而「分岔高度上下錯開」才剛做完(§5z-k ①)。⇒ 往**下**延伸淨幹,量是**解**出來的:
  `Δ = (frac·Hₜ − a) / (1 − frac)`(a = 最低掛枝點離地),frac = ¼ 即 `Δ = (H − 4a)/3`。
  **「即可」= 取等號**,MUST NOT 多給 —— 多給就是憑空把樹拉長,那不是使用者要的。
  實測延伸量:針葉 21.0%H / 闊葉 29.9%H / 枯木 16.0%H(逐棵不同,因為它是解出來的)。
- **② 的真兇是第二輪自己製造的**:`r_mid` 在 `clamp_ratio` **之前**算,而夾制會把徑向半徑
  夾小 ⇒ 葉冠內緣退到枝端**之外**,中間空一截 = 看起來懸空。⇒ **內緣釘在枝端**
  (`r_mid = r_in + rad[0]`,無枝的釘到軸)是**構造保證**,不是事後檢查。
  「有沒有連結」因此分成兩層,MUST 分開處理:**與枝/幹的連結靠構造**、**與鄰居的連結是密度問題**。
- **② 的第二層才是「放大或清理」**:對鄰居的最大重疊 < `--lonely` 者先**逐步**放大到
  `--grow-max`,仍碰不到就刪。**MUST 逐步試而不是一次乘到底** —— 一次乘滿會把本來只差一點的
  那幾顆變成一坨。距離函式 `lobe_dist` 與 ④ 合併**共用一支**:兩個判定用不同的距離,
  「併掉的」與「判成孤立的」會是兩組樹。
- **⚠ 釘枝端單獨開的時候輪廓是掉的**(52.8% → **49.2%**):它把葉冠往內拉,樹**變小但變連貫**。
  ⇒ 它是「修連結」不是「加輪廓」,MUST NOT 拿剪影去驗它有沒有做對;真正把輪廓拉回來的是
  後面的孤兒放大(49.2 → 56.8)與淨幹延伸(56.8 → 60.2,多出來的那截幹落在掃描框內)。
  這一條是本輪第三次遇到「指標與目的不同軸」(前兩次:§5z-e 的胖樹幹、§5z-k 的分岔仰角)。

| 針葉・density mid | 面數 | 輪廓 min / mean |
|---|---|---|
| 第二輪定案 | 1,212 | 52.8% / 56.3% |
| + 內緣釘枝端 | 1,236 | 49.2% / 53.8% |
| + 孤兒放大 25 / 清掉 21 (`--lonely .02`) | **984** | 56.8% / 61.9% |
| **+ 淨幹 ¼ = 定案** | **1,004** | **60.2% / 65.5%** |
| `--lonely .05`(清更多) | 968 | 61.0% / 68.9% |

| 闊葉・major .3 + sparse | 面數 | 輪廓 min / mean |
|---|---|---|
| 第二輪定案 | 1,236 | 220.5% / 257.0% |
| **第三輪定案**(放大 28 / 清掉 3 / 合併 1) | **1,216** | 280.2% / 325.1% |

**面數與輪廓同時改善**(針葉 1,212 → 1,004 而輪廓 +7.4pp):清掉的是真的孤零零掛著的那 21 顆,
留下的放大之後連成團 —— 這與 §5y-f「等面數之下少幾團完整的葉永遠贏過每一團都留但畫得更粗」
是同一條原則的第四次現形。**預算**:針葉 1,004 × 73 = **11.8%**、闊葉 1,216 × 211 = **41.2%**。

### 5z-m. 第四輪:太稀疏 → **先拉長填滿空間**,還是太稀疏才刪

> 使用者:「**太稀疏的葉冠先嘗試拉長放大填滿空間,還是太稀疏再刪除**」。
> ⇒ 三段依序:㋐拉長 → ㋑等比放大 → ㋒刪除。刪除退成**最後手段**。

- **⚠ 判準也得換,不然「拉長」沒有意義**:§5z-l 的孤兒判定沿用 `sphere_overlap` 的**等體積球**
  重疊比,而等體積球是**各向同性**的 —— 它量不出「朝鄰居那個方向夠不夠長」,而使用者要的
  正是往那個方向填。⇒ 改成**方向性支撐半徑**的接觸率
  `contact = (supᵢ(u) + supⱼ(−u)) / d`,`sup(rad,u) = √Σ(rₖuₖ)²`(軸對齊橢球的閉式解),
  ≥ 1 就是真的碰到了。**合併那一支仍走體積比** —— 使用者當時的原話是「**體積**高比例重合」,
  兩個判準各自對應各自那句話,MUST NOT 互相取代;距離向量則共用 `lobe_dir`。
  (雙錐 / 多角錐內接於同一顆橢球 ⇒ `sup` 是**高估**,偏差朝「不刪」,原則 6。)
- **㋐拉長是逐軸加權,不是等比**:`f = 1 + (s−1)·w`,`w = |Δₖ| / max|Δ|` —— 朝最近鄰的**主要
  方向**拉滿、其餘按比例。等比放大填的是**體積**,拉長填的才是**那一道縫**。
- **⚠ 拉長刻意不再過 `clamp_ratio`**:軸比是「這一族長什麼樣」的預設,而孤兒本來就是例外處理;
  再夾一次等於把剛拉出去的長度收回來 —— `clamp_ratio` 保最長軸,拉長軸之後其餘兩軸會被
  推回 `lo × 新最長軸`,整顆退化成等比放大。這是「兩條規則互相抵消」的典型,MUST 記著。
- **逐顆就地更新**(後面的葉冠看得到前面剛拉長的)⇒ 一顆補上之後順帶救活鄰居,刪除數自然降。

| 針葉・density mid | 面數 | 輪廓 min / mean | 拉長 / 放大 / 刪 |
|---|---|---|---|
| 不處理(`--touch 0`) | 1,256 | 53.1% / 57.4% | — |
| **只刪不拉長**(對照組) | 1,016 | **41.9% / 47.7%** | 0 / 0 / **多** |
| **拉長→放大→刪 = 定案** | 1,220 | 57.1% / 61.9% | **16 / 0 / 3** |
| 拉長上限 4.0 | 1,256 | **65.7% / 72.7%** | 更多 / 0 / 更少 |
| `--touch 1.15`(要求更貼) | 1,220 | 62.4% / 68.8% | — |
| 闊葉 不處理 | 1,276 | 222.5% / 247.8% | — |
| **闊葉 定案** | 1,256 | 242.5% / 274.9% | **14 / 0 / 1** |

- **刪除真的退成最後手段**:針葉 21 → **3**、闊葉 3 → **1**,而且**一顆都沒用到㋑等比放大**
  —— 拉長就夠了。「只刪不拉長」那一組是這條規則的反面對照:面數最少(1,016)但輪廓掉到
  **41.9%**,圖上就是被挖得稀稀落落 —— 正是使用者要避免的那個樣子。
- **⚠ 拉長上限不宜再放大**:`--stretch-max 4.0` 的數字最漂亮(65.7%,面數只多 36),但圖上
  會長出**單一片異常大的扁平菱形** —— 一顆葉冠被拉成一大片薄板。2.5 是「填得滿但不生巨片」
  的實測選值;要更密請改 `--touch`(1.15 同面數、+5.3pp,而且不生巨片),不要改 `--stretch-max`。
- **代價**:面數從 §5z-l 的 1,004 升到 1,220(留下了 18 顆本來要刪的),輪廓 60.2% → 57.1%
  —— 拉長只填縫、不像等比放大那樣把三個軸一起吹胖。這是使用者指定的取捨,不是退化。
  預算:針葉 1,220 × 73 = **14.3%**、闊葉 1,256 × 211 = **42.6%**。

### 5z-n. 第五輪:`--touch` 定案 = **1.15**(§5z-j ⑨ 收斂;代價為零)

> 使用者 2026-08-08:「`--touch` 設 1.15」。§5z-j ⑨ 那條「造型決定」由此關閉。
> 列圖 `out_simple/sheet_touch.png`(兩族 × 兩值 × 側視/俯視,2×4)。

- **1.15 有機制解釋,不是憑感覺加的安全係數**:接觸率的支撐半徑 `sup` 是**軸對齊橢球**的
  閉式解,而葉冠基本體(雙錐 / 多角錐)**內接於**那顆橢球 ⇒ `sup` 系統性**高估**
  (§5z-m 已註明「偏差朝不刪,原則 6」)。⇒ `1.0` 是**橢球意義上**的剛好碰到,而那一對
  **實體**之間其實還隔著一道縫;1.15 是把這個系統性高估補回去的餘裕。MUST NOT 改回 1.0
  —— 1.0 是幾何上的剛好,不是畫面上的貼合。
- **代價是零**:兩族**面數逐位元不變** ⇒ **預算完全不動**(針葉 1,220 × 73 = 89,060 = **14.3%**、
  闊葉 1,256 × 211 = 265,016 = **42.5%**、合計 354,076 = **56.8%**;`kind_factor` 2,000 兩族皆過)。
  動的只有孤兒處理的**分派**:針葉 拉長 16 → **25**、等比放大 0 → **1**、刪 **3 → 3**。
  **刪除數不變是這一輪的關鍵讀數** —— 更嚴的門檻沒有把更多葉冠判死,它只是讓本來就在的
  那些多拉長一點(§5z-m「刪除退成最後手段」在更嚴的門檻下**仍然成立**)。

| `--touch` | 針葉 mid 面數 | 輪廓 min / mean | 闊葉 `major .3`+sparse 面數 | 輪廓 min / mean |
|---|---|---|---|---|
| 1.0(§5z-m 定案) | 1,220 | 57.1% / 61.9% | 1,256 | 242.5% / 274.9% |
| **1.15 = 定案** | **1,220** | **62.4% / 68.8%** | **1,256** | **266.5% / 318.5%** |

- **闊葉這一半是本輪才第一次有數字**:§5z-m 的表只量了針葉的 1.15,而**預算是逐族算的**
  (闊葉 instance 211,是針葉 73 的三倍)⇒ 少那一半,定案的代價就是猜的。補齊後才知道
  「代價為零」對兩族同時成立。
- **⚠ 輪廓這個數字對兩族讀法相反,闊葉的 +43.6pp MUST NOT 當成品質證據**:
  `silhouette_keep` 回的是 `nb / na` = **新 ÷ v7 基準**的剪影覆蓋率比,不是「保留度」。
  針葉 <100% ⇒ 越高 = 越接近 v7;**闊葉 >200% ⇒ 越高 = 離 v7 越遠(更胖)**。
  ⇒ 闊葉那一格只有**圖**能判(§5z 這一族的老規矩:判準是圖,剪影只當哨兵 —— §5z-j
  已有四次「指標與目的不同軸」的前科)。**看圖的結論**:針葉 1.15 的葉片更粗、俯視星形的
  輻條間縫隙收小 = 更貼;闊葉 1.15 的橢球顆粒變大並彼此相接、樹冠連成一團、枝幹空隙被蓋住,
  且**沒有** `--stretch-max 4.0` 那個「單一片異常大的扁平菱形」失敗型態。兩族都是使用者
  要的「同面數、圖上更密」。
- **⚠ 改預設值會讓歷史對照組靜默漂移**:`sheet_round4`(§5z-m 那張)有五格是吃預設的,
  預設一改就變成「同一個標籤、不同的數字,而且不報錯」⇒ 新增 `R4 = {'touch': 1.0}` 常數把
  §5z-m 的格子**顯式釘死**(同 R1/R2 的「對照組的定義只准有一份」)。本輪重跑逐格對上舊值
  (針葉 1,220 / 57.1% / 61.9%、闊葉 1,256 / 242.5% / 274.9%)= 這道釘子有效。
- **⚠ 原型碼未版控,定案 MUST 在此留字面紀錄**:study clone **沒有 `.git`** ⇒ 落地面只存在
  那台機器上。重建時照抄這一行:
  `ap.add_argument('--touch', type=float, default=1.15, …)`(`simple_tree.py`)。
  儲存庫端**零消費端**(`--touch` 與觸控 UI 的 `touch` 完全無關)⇒ 本輪儲存庫只有 runbook 改動。

### 5z-o. 入庫輪:走零件庫,一株 = **木質 + 葉冠兩顆節點**;預算模型換本尊

> 使用者 2026-08-08 定案:①**走零件庫**(§5z-j ③);②闊葉**保圓潤冠**,寧可從 shrub 挖額度;
> ③針葉改**疊層多角錐,凸角朝上、平整面朝下**。列圖 `out_simple/sheet_bl_budget.png`、
> 並排 `tools/.shots/veg/`。

- **一顆整樹節點行不通,MUST 是兩顆**:一列 = 一個 InstancedMesh = **一份材質** ⇒ 整株併成
  一列會同時失去 ①樹幹與葉冠同色 ②`seasonColor` 季節換色(那一列沒有 `key`)③**A39 軟性物質**
  (`vegSoftKind` 逐列判 ⇒ 只能二選一:樹幹跟著風擺,或葉子不擺)。三樣都沒有錯誤訊息。
  §5u 的 `snag_a` 能單列是因為枯幹**本來就單色、不換季、不是軟性** —— 不是「整株一列」成立。
  ⇒ `def.whole` 改成**陣列 + 全有全無**(`every`:只載到木質 = 一棵沒有葉子的樹,比整型退回
  保險絲更糟)。生成端同步拆群,**合併輸出逐頂點位元不變**(索引記群、不換序 —— 換序會讓
  §5z-f~§5z-n 四輪的產物不能宣稱可重跑)。
- **兩顆 MUST 共用一個變換**(`normalize_parts --group`,本輪新增):各自縮到自己的包絡 = 兩個
  不同的縮放 ⇒ **樹會散開**,而外廓契約與三角形預算**全綠**、只有截圖看得出來。共用之後相對
  位置烤進頂點,消費端兩列因此共用同一個 `y`(= 聯集半跨),少一個可以寫錯的地方。
- **預算模型:flat `node_cap` 對整樹節點結構性失效,改鎖整層總量**。`node_cap` 的語意是
  「一顆節點換掉一個零件」,而一株樹本來就是一顆葉團的四五倍 —— 拿它比只會恆紅。而它一向
  只是「整層總量 ≤ 成長額度」的**保守代理**(逐列均分、假設每列吃滿)⇒ 直接量本尊:
  `Σ (該型庫節點和 − 被取代的現值) × 該型 instance 上界 ≤ 成長額度`,被取代的現值 =
  whole 走 `measured_kind_tris`(整株,本輪新增 `measure_veg_tris --kinds` 量的)、逐件走 20 × 列數。
  **比代理更緊也更準**。`node_cap` 仍是逐件列(shrub/birch/mangrove)的閘,不退場。
- **量出來的第一件事:成長額度早就用掉 92.4%**,而 **shrub 一列吃 59.1%**(`bush_a09` 213 tris
  × 1909 instance)。NATURE_MANIFEST 只剩 silvergrass(§5k 定案留著)⇒ **這一桶倒不出更多額度,
  只能重分配**。使用者定案「闊葉保圓潤冠、從 shrub 挖」⇒ `bush_a09` 減面 213 → **140**
  (1909 叢的填充灌木單株 213 面本來就與它在畫面上的份量不成比例)。
- **⚠ 這一輪最貴的發現:§5z 五輪的量測面從頭到尾都不是遊戲裡那棵樹**。全部剪影都對 **v7 瓣化
  原型**量,而 v7 從來沒有出貨。以真實路徑(`loadPartLibs` + `buildVegMeshes`)並排才看得到:
  闊葉對 v7 是 267%(比 v7 胖)⇒ 對現況也胖 ⇒ **進步**(枝椏真的伸進冠內,現況那幾根枝是斷在
  半空的);針葉對 v7 只有 62%(比 v7 瘦)⇒ 對現況**更瘦** ⇒ 逐瓣散葉版讀成「光禿樹幹上的碎葉片」,
  **付 7.9 倍面數(155 → 1,220)換到比現況更稀疏的樹**。這是「指標與目的不同軸」第五次現形,
  也是最貴的一次。**新工具 `tools/shot_veg.mjs`** 把這個對照補成常設閘(照 `shot_beacons` 的形狀:
  同一型拍 fallback vs lib 兩張,走遊戲自己的 `buildVegMeshes`)—— `shot_giants` 從原文重建、
  不載零件庫,驗不到這條路。
- **針葉定案 = 疊層多角錐**(`--crown tiers`,使用者「凸角朝上、平整面朝下」):`prim_cone`
  單錐(底環 + 底蓋在 −Y、尖點在 +Y),**MUST 是 `FAM_PRIM_TIERS` 的預設而不是記得傳
  `--prim cone`**(忘了傳不報錯,只靜默出 `bipyr` 雙錐 —— 上下都尖,層與層互相戳進去,
  下緣那條平整陰影線沒了 = 針葉樹一眼可辨的特徵沒了;`sheet_simple` 的 `lonely` 前科同款)。
  8 層 × 10 面 = **172 面**(木質 92 / 葉冠 80),比現況 155 只多 17 ⇒ 整層消耗 98.2% → **85.9%**。
- **順帶修掉一個既有假證據**:新增 `sheet_simple._check_pass` 旗標對帳閘(格子設了但 `PASS`
  沒帶下去 = 靜默照預設跑)⇒ 咬到 `sheet_round3` 的「lonely .05」自 §5z-m 換判準後一直畫成定案;
  該格移除(判準本身沒了,重跑不出來),其餘吃預設的格子一律以 `R4 = {'touch': 1.0}` 顯式釘死。
- **驗收**:intake **237**(整層消耗 535,155 / 622,905 = 85.9%)/ siteplan 187 / beacons 68 /
  joints 21611-0 / soft_stroke 73 / gpu 54 / cel 52 / visual_prefs 124 / **e2e 全綠**(fresh :8666)/
  **`npm run bal` 全綠**(⑦f 1.78× 不動)/ 對照台 **0 缺件 0 孤兒 0 未記載**
  (`METHODS` + `simple_geom_tree`:AI 網格不出貨、只有佈局來自語料)。退掉的 6 列 per-part lib
  對應的 `vcone_a20/a16/a14/b09`、`vleaf_a27/a17` 六顆節點以 `--drop` 移除(先由對照台確認零消費端)。
- **未跑 / 待續**:①**定場圖仍未補**(§5z-j ②:遊戲內尺寸 + 賽璐璐 + 勾線;`shot_veg` 是黏土
  等級的並排,不是定場)—— 勾線對疊層錐是加分還是扣分仍沒量過;②真機冒煙(綠地場地看林相
  換臉 + 保險絲路徑不迴歸);③針葉**頂梢歸在木質**(使用者原話「尖端」與樹枝樹幹同組)⇒
  圖上是一根棕色細尖,現況那一版是綠的 —— 要不要改歸葉冠是造型決定,未動;④`--bole` 改總高
  那條(§5z-j ⑩)在整樹節點下已由 `--group` 的聯集包絡吸收,但 `vegSpan`(擺動分母)仍讀
  `parts` ⇒ 保險絲全高 8.95 vs 節點 8.50 有 5% 差(FIT 餘裕),純表現層、未處理。

### 5z-r. 第六輪:針葉葉冠改**星盤**(使用者手稿;上視內凹 + 下緣內凹 + 層間錯開疊加)

> 使用者 2026-08-08 附圖(五角/四角/三角星的俯視、一株針葉樹的側視、一條長弧)+ 七句話:
> 「上視圖中各角邊長內凹,側視圖中每層下緣內凹,不同層之間的平面旋轉角度錯開疊加,
> 越上層水平邊長越短、但頂部角越尖銳,頂部樹幹不要露出,此作法不需要樹枝;
> 每層幾角/每層角長/每層間距/每層錯開多少角度/層數/樹幹粗細/高度等參數視樹種而定」。
> 列圖 `out_simple/sheet_star.png`(vs 現行)、`sheet_star_knob.png`(反向驗證)、
> `sheet_star_cost.png`(價目表);遊戲真實路徑並排 `tools/.shots/veg/conifer2_*`。
> 使用者看圖後同日定案三條:**arc 全族取 2**(價目表那三張側視疊起來看不出差別,而 ×3 是
> +37% 面數)、**谷底逐樹種各給一個**、**直接入庫** ⇒ `cf2_wood_a` / `cf2_crown_a` 重烤出貨。
>
> ⚠ **章節編號跳過 p/q**:`§5z-p`(針葉圓弧裙)與 `§5z-q`(開源模組候補道)寫在分支
> `claude/3d-modeling-terrain-types-a1e620` 的**未 commit** 工作區裡(worktree
> `starred-image-annotation-e46a45`),本工作區看不到。本輪的對照組「現行 = 疊層圓弧裙 268 面」
> 就是那一輪的產物,而兩邊都動 `tree.glb` 與本檔 ⇒ 合併時 MUST 手動挑。**本輪已逐節點對過帳**:
> 那一支的 `tree.glb` 與本工作區改動前**只差 `cf2_wood_a`/`cf2_crown_a` 兩顆**(30 個節點逐一
> 比對三角形數,其餘完全相同)—— 而這兩顆正是本輪重烤的對象 ⇒ 星盤版是乾淨的取代,
> 圓弧裙那一輪**沒有其他東西會被吃掉**。合併時 `tree.glb` 取本輪這一份即可;runbook 兩節並存。

**七句話 → 七個幾何決策**,每一個都住自己那一個縫(`simple_tree.py`):

| 手稿 | 落在哪 | 怎麼做 |
|---|---|---|
| ①上視各角邊長內凹 | `prim_star` 的 ρ(t) | 極座標 `ρ = 1 − (1−notch)·sin(πt)/max sin`,谷底 MUST < 兩角之間**弦**的中點 `cos(π/n)` —— 那才是「內凹」的定義,大於它只是個鈍角多邊形 |
| ②側視每層下緣內凹 | `prim_star` 的 y(ρ) | 邊界高度跟著自己的半徑走 `y = −1 + hollow·(1−ρ)^cave`;**`cave < 1` 才是內凹**(y″ < 0 ⇒ 曲線恆在「角尖—裙心」那條弦之上)。**零面數成本** —— 凹是邊界頂點自己的高度給的,不是多鋪一圈環 |
| ③層間平面旋轉錯開 | `plan_star` 的 `ang` | `ang = k × twist`,twist 未給 = **半個角距 π/n**(錯開量的最大值,推導不手寫) |
| ④疊加 | `plan_star` 的 `ov` | 每層錐高 `A = ov·Δ·(1+sharp·f)`,`ov > 1` ⇒ 每層頂點高過上一層角尖 |
| ⑤越上層水平邊長越短 | `plan_star` 的 R 階梯 | **等比階梯**,兩端量出來(見下方坑①) |
| ⑥但頂部角越尖銳 | `plan_star` 的 `sharp` | 角長在收、錐高在漲 ⇒ 頂角半角 `atan(R/A)` 兩頭一起變小(實測 spruce 71.7° → 22.6°) |
| ⑦頂部樹幹不要露出 | `star_trunk_top` | 閉式解 `y* = y_a − (y_a−y_t)·margin·r_幹 /(notch·R)`,**量谷底母線不量角尖**(角尖那條最寬,拿它算會讓幹剛好從兩角之間的凹口穿出來 —— 而那正是轉個方位就看得到的那一面) |

- **「不需要樹枝」是刪掉一段而不是繞過它**:`limbs` 同時是幹高(`y_top`)與淨幹(`--bole`)的輸入
  ⇒ MUST 在生成處擋掉,留著空跑就是「一批看不見的枝在偷偷決定幹要多高」(§5z-o 的 tiers 正是
  那樣)。`--spire` 同輪對星盤關閉:最上層星盤自己的頂點就是樹尖,而且它是**葉冠、是綠的**;
  `--spire` 補的那一根歸木質 ⇒ 對星盤而言正好是使用者要消掉的「露出來的樹幹」
  (§5z-o 待續③ 記的「圖上是一根棕色細尖」由此關閉)。木質因此 **92 → 80 面**。
- **面數是算式不是量出來的**:一層 = **2·n·arc**(上錐面 + 下裙面各 `n·arc`),`arc` = 每個角之間
  取幾個樣本(1 = 不內凹 / 2 = 折線內凹 / 3+ = 曲線內凹)。**`arc=1 且 hollow=0` ⇒ 與 `prim_cone`
  同一顆多角錐**(體積逐位元相同,只有底蓋走扇形多 2 面)= 這一輪整組可反向驗證的錨。
- **逐句稽核 `check_star.py`**(四樹種 × 10 條 = 40 項,全綠):①②走單位體閉式、③④⑤⑥ 走**匯出
  的那顆**(以面的連通分量拆回逐層,不是重跑一次 `plan_star` —— 重跑就是拿實作驗自己)、
  ⑦ 是**射線可見性實測**(幹頂 6 點 × 144 方位全被葉冠擋下)、⑧ 木質面數 = 幹段數 × 柱面數。
  反向驗證 `--break-notch` / `--break-cave` / `--break-cover` **各只咬紅該咬的那一條**
  (`--break-cover` 把餘裕 1.25 → 0.15 ⇒ 6 個幹頂點 144 方位**全部**看得到)。
  `--break-cover` MUST 走**旗標**(`--star-cover`)傳進子行程:樹是另一個行程建的,
  在稽核端 monkeypatch 只改到本行程那一份 ⇒ 反向驗證恆綠 = 假綠。

**⚠ 坑① 逐層照抄語料的 `r_out` ⇒ 整冠塌成一根牙籤,而面數/契約/watertight 全綠。**
第一版照 `tiers` 的作法逐層取該層最遠外緣、再要求單調遞減。但語料的**最下層**是貼著幹的那幾叢
(南洋杉實測 raw R:**0.057** / 0.350 / 0.352 / **0.393** / 0.305 / 0.336 / 0.140 / 0.125 ——
最寬的是第 3 層不是第 0 層)⇒ 由下往上夾等於整冠被 0.057 封頂,輪廓保留從 tiers 的 112% 掉到
**10.2%**。⇒ 角長改成**等比階梯**:底層 = 整冠量到的最遠外緣、公比 `q` = (最上層外緣 ÷ 底層)
^(1/(L−1)) 再夾進 [tipf^(1/(L−1)), taper]。兩端都是量出來的、只有「中間怎麼排」是規則,而且
`R_k ≤` 語料最遠外緣 ⇒ **冠幅不會憑空長大**(`giantCrownR` 與碰撞柱的基準不動)。層間距同理是
**解**出來的:要求最上層的頂點恰好落在冠頂 ⇒ `Δ = S / (L−1 + ov(1+sharp))`,樹不會比語料高一截。

**⚠ 坑② `notch` 的實際深度會隨 `arc` 漂**:直接吃 `sin(πt)`,arc 2 取得到 sin(π/2)=1
(谷底真的是 notch),arc 3 只取到 sin(π/3)=0.866 ⇒ `notch=.5` 實測是 **0.567**。同一個旗標、
同一個數字,換個 arc 就是另一個形狀而且不報錯 —— 與 §5z-n 的 R4「對照組的定義只准有一份」同族。
⇒ 除以 `max(w)` 正規化;arc ≤ 2 之下是恆等,不動既有形狀。

**⚠ 第六次「指標與目的不同軸」——這次輪廓錯得最明顯**:星盤 **58~64%** 對上現行圓弧裙
**112~123%**,照數字讀是大退步。而**俯視那一格直接把話講完**:現行版從上面看是一個
**乾淨的六邊形**(一疊圓弧裙 = 同軸旋轉體,轉幾層都還是一個多邊形),星盤是一顆放射狀的星。
側視也一樣:現行版讀成「一疊燈罩 / 一座寶塔」,星盤是一眼可辨的針葉樹。`silhouette_keep` 量的是
**對 v7 那團 11k 面原型的面積覆蓋**,而星盤的內凹與兜起的裙**就是在把面積挖掉** ——
它扣的正是這一輪要加的東西。⇒ 判準仍是圖,輪廓只當「有沒有整個塌掉」的哨兵(坑① 就是它抓到的)。

**價目表(`sheet_star_cost.png`;現行 268 面)**

| 檔位 | 面數 | 對現行 | 圖上 |
|---|---|---|---|
| 5 角 × arc 2 | 240 | −10% | 角少、每層五瓣 |
| **6 角 × arc 2** | **272** | **+1%** | **與 ×3/×4 幾乎看不出差別** |
| 6 角 × arc 3 | 368 | +37% | 谷底變成一段平的,側視同上 |
| 6 角 × arc 4 | 464 | +73% | 谷底變成弧線,側視同上 |

⇒ **`arc` 這顆旋鈕在這個尺度上幾乎不影響畫面**(側視三張疊起來看不出差別、俯視也只有谷底那一小段
不同)⇒ **建議取 arc 2**:同樣一棵樹,+37% 的面數換不到看得見的東西。真正管俯視長相的是
`notch`(.35 = 細長尖角 / .70 = 寬角),那是**造型決定,留給使用者**。

**預算**(本工作區基準:整層消耗 535,155 / 622,905 = **85.9%**,conifer2 現值 172 tris;
`(節點和 − 155) × 73`):

| 冠形 | 木質 | 葉冠 | 合計 | 整層消耗 |
|---|---|---|---|---|
| §5z-o 疊層多角錐(本輪之前) | 92 | 80 | 172 | 85.9% |
| §5z-p 疊層圓弧裙(另一分支,未 commit) | 92 | 176 | 268 | 87.0% |
| **星盤 6角×2 = 出貨** | **80** | **192** | **272** | **87.1%**(實測 542,455 / 622,905)|
| 星盤 6角×3 | 80 | 288 | 368 | 88.2% |
| 星盤 6角×4 | 80 | 384 | 464 | 89.3% |

**入庫(同輪,使用者定案「直接入庫」)**

- **消費端只改一個數**:`VEG_DEFS.conifer2.whole` 葉冠那一列的包絡 `cyl(1.92,1.92,**7.41**)` →
  `cyl(1.92,1.92,**8.52**)`。理由是這一輪的形狀本身:星盤把「尖端」還給了葉冠 —— 最上層星盤
  自己的頂點就是樹尖(而且是**綠的**),舊制那根**木質**頂梢同輪退場 ⇒ **葉冠節點的頂 = 整株的頂**
  (節點縱向 [−2.13, **+4.25**],舊包絡只到 ±3.71)。沿用舊值的話 intake 會紅在「葉冠比包絡高」,
  而那正是這一輪要的形狀。木質那一列反而縮到樹尖之下(縱向 [−4.25, +3.39]),包絡不動。
  `y = 4.251`(= 聯集半跨)與 `--group CF2=1.98x4.475` 皆**不變** ⇒ 世界尺度逐位元同上一輪。
- **非等向擬合是既有性質、不是這一輪引入的**:原型的聯集長寬比 r/hy = 0.678,遊戲那個框是
  0.4425 ⇒ 縱向被拉伸 1.53×,樹比黏土列圖上更修長。八條斷言**全部在逐軸仿射下保持**
  (內凹、兜裙、遞減、越尖、幹頂覆蓋都是同軸比較)⇒ 稽核結論不受擬合影響;真正的判準是
  `shot_veg` 那兩張:**保險絲版是一疊蒼白的團塊,星盤版是一棵一眼可辨的雲杉**。
- **驗收**:intake **237**(整層 **87.1%**)/ siteplan 187 / beacons 68 / joints 11908-**0** /
  soft_stroke 73 / gpu 54 / cel 52 / visual_prefs 124 / open_tunnel 163 / underpass 161 /
  road_joint 86 / **e2e 全綠**(fresh :8666)/ **`npm run bal` 全綠**(⑦f 1.78× 不動)/
  對照台 **0 缺件 0 孤兒 0 未記載**。

- **逐樹種參數表 `STAR_SPECIES`**(手稿最後一句):鍵名對得上 `VEG_DEFS` 的四列針葉
  (fir=conifer / spruce=conifer2 / cypress=conifer3 / cedar=conifer4),讓「哪一列吃哪一組」
  不必再翻譯一次。**分工 MUST 講清楚**:層數 / 每層間距 / 角長 / 幹粗 / 高度仍由**語料**給
  (§5z-b 的佈局共用縫),而每層幾角 / 內凹深度 / 下緣凹度 / 裙深 / 尖銳度 / 錯開角度 / 逐層收分
  是**造型**(浮雕板量不出「角」這種東西)⇒ 住那張表。
- **未跑 / 待續**:①~~檔位與 `notch`~~ **已定案**(arc 2 全族 / 角數與谷底逐樹種 / 直接入庫,
  使用者 2026-08-08)—— 但**只有 `conifer2` 有庫節點**,fir/cedar/cypress 三列仍走 `parts`
  保險絲,那三組參數等於還沒上過畫面;②~~定場圖仍未補~~ **已跑完(§5z-t)**:卡了四輪的原因是**兩支工具各缺一半**
  (`shot_scene` 有管線不載庫 / `shot_veg` 載庫沒管線),補齊後量到**星盤吃到的墨比周圍舊樹還少**
  (2.61% vs 2.83%)⇒ 勾線對這個冠形**中性偏加分**;③`--star-taper` 與
  `--star-tipf` 在這張語料上**都沒有作用**(語料自己的 q = 0.849 已經比兩個夾制都嚴)⇒ 兩顆旋鈕
  等於沒驗過,換樹種語料才知道;④**闊葉不吃星盤**(手稿講的是針葉),`--crown star` 對 broadleaf
  沒有擋、但也沒有意義;⑤入庫時 `--bole` 改總高那條(§5z-j ⑩)與 `vegSpan` 的 5% 差
  (§5z-o 待續④)一併要重算;⑥層數仍吃語料(`--star-layers` 已備但只跑過預設)。

### 5z-s. 星盤第二輪 + 闊葉樹頂包覆(同日;尖銳度改由**輪廓凹面**給,所有參數加誤差)

> 使用者 2026-08-08 兩句:①「**上層的頂角不要那麼高,每層高度相近,用凹面的方法增加尖銳度,
> 旋轉角度/角長/層高等所有參數都適度加入誤差**」;②「**闊葉林的樹頂,使用闊葉樹冠包覆
> (跟其他葉冠相似的形狀)**」。兩件都已出貨(`cf2_*` / `bl_*` 四顆節點重烤)。

**①-a 尖銳度的來源換人**:舊制靠 `sharp` 逐層放大錐高(spruce 1.3 ⇒ 最上層比最下層高 2.3 倍)
—— 那正是使用者說的「頂角太高」。改成 **`--star-curve`(側輪廓凹度)**:
`R_k = R_top + (R₀ − R_top)·(1 − u^curve)`,u = k/(L−1)。斜率 `−(R₀−R_top)·curve·u^(curve−1)`
在 u 小時平緩、u 大時陡 ⇒ **下半近乎等寬、上半急速收尖** = 手稿中間那條長弧。
`sharp` 一律降到 0.10~0.20(層高全距 1.10~1.20 = 「相近」)。
**⑥「頂部角越尖銳」不需要放寬**:半角 = atan(R/A),A 幾乎不變而 R 遞減就足夠 —— 反而更尖
(spruce 名目 68.2° → 34.6°)。**舊制的等比階梯 `q^k` 是凸的**(先降快後降慢),與這一條相反。

**①-b 誤差是三組零均值抖動**(`petal_jitter` 同一支,MUST NOT 另起亂數序列):角長 / 層高 /
錯開角。**唯一仍夾制的是層高** —— 它綁著「疊加」(A > Δ),破了就是層間露出樹幹(看得見);
夾制是解出來的 `(ov−1)/ov / 2`。

**⚠ 這一輪最有價值的發現:凹面與「適度誤差」在同一個序列上互斥,必須選邊。**
curve > 1 的定義就是「下半近乎等寬」⇒ 底部相鄰兩層的角長只差 **2.3%**(spruce 實測),
而使用者要的誤差是 10% ⇒ **任何看得見的誤差都會讓底部某兩層互換名次**,稽核 ⑤⑥ 當場紅字
(實測 半角 66.6° → 68.6° 反向)。兩條路:把誤差夾到 1% 以下(那句話等於沒做),或把定律
搬到誤差之前。**選後者**,並把稽核重切成四段:
- ⑤⑥ 驗**名目階梯**(`--star-jit 0` 跑一次)—— 定律沒有鬆掉,只是搬到誤差之前的那一層;
- ⑨ 驗**誤差本身**:零均值(實測 ±0.0000)、逐層有界(≤ 該項夾制)、且**三項都真的有誤差**
  (光驗「有界」的話,誤差寫死成 0 也會全綠);
- ⑩ 驗**趨勢**:最寬在最底、最窄在最頂,且**跨 lag 層恆遞減** —— `lag` **推導不手寫**
  = 最小的 j 使名目跨 j 層的落差 > 2×誤差幅(spruce 誤差 0.10 ⇒ lag = 4)。
- ⑥-b/⑥-c 把使用者那兩句話變成可驗的形式:層高全距 **= 1 + sharp**(恆等)且 ≤ 1.25;
  **尖銳度主要來自輪廓** —— 半角取對數後 R 與 A 的貢獻可加,要求 R 那一份 ≥ 3 × A
  (spruce 1.15 vs 0.10)。只驗「有沒有變尖」的話,把 `sharp` 調回 1.3 也會過。

**②闊葉樹頂包覆:三次才對,前兩次都「全綠但沒作用」**
- 第一版:尺寸取現有葉冠的**中位數**、蓋在木質最高點 ⇒ 144 方位看得到 **45 → 45**,
  與沒有這一顆**一模一樣**。兩個成因疊在一起:㋐`rad` 是圓柱座標 (徑向, 垂直, 切向),
  而離軸的旁瓣**徑向是薄的那一軸**(實測中位數 0.039 / 0.137 / 0.069)⇒ 照抄三軸會在軸心
  生出一片**立起來的薄片**;㋑「木質最高點」在密冠橡樹上是一根**離軸 0.19 的枝梢**,
  軸心的葉團再大也蓋不到它。
- 第二版:兩個水平軸都取切向、目標改成**幹頂** ⇒ 幹頂那一個點蓋住了(0/144),
  但**截圖與改動前一模一樣** —— 真正露出來的是**分岔點到幹頂那一整段**:旁瓣一律擺在
  `r_mid > 0` 上(語料量到的是離軸的葉團)⇒ **軸心是空的**,幹就從那個洞直直戳出去。
- 定案:尺寸由「要蓋住什麼」**解**出來 —— 縱向 = 分岔到幹頂的一半、水平 = 最內圈葉團的
  **內緣**(中位數 `r_mid − 徑向半徑`),兩者再 **÷ ico 內切半徑**(`ico_inradius()`,
  推導不手寫;不除的話上段 20% 會從面上戳出來,實測仍有 24/144 而截圖只差幾根細線)。
  ⇒ **233 → 0**。「跟其他葉冠相似的形狀」因此讀成**同一顆基本體**(ico、同 key、同季節色),
  MUST NOT 讀成「同一個尺寸」—— 同尺寸那一版證明過補不起來。**成本 +20 面**(一顆 ico)。
- 稽核 ⑪ 五條含**內建反向對照**(`--no-cap` MUST 看得見);判準是**沿幹身取樣的射線可見性**,
  不是單一個點 —— 單點版正是第二版「全綠但沒作用」的成因。

**驗收**:check_star **78 條**(四樹種 × 14 + 闊葉 6)全綠 + `--break-notch/-cave/-cover`
各只咬紅一條;intake **237**(整層 **87.8%**:conifer2 272 / broadleaf 1,276)/ siteplan 187 /
beacons 68 / joints 11908-0 / soft 73 / gpu 54 / cel 52 / visual 124 / **e2e 全綠** /
**`npm run bal` 全綠** / 對照台 0-0-0。
**輪廓這次與目的同向**(前一輪是反的):spruce 58/63% → **76/87%**、fir 59/66% → 74/88%、
cypress 64/78% → 85/105% —— 凹面在收尖的同時把下半段補胖了,兩件事一起發生。

### 5z-t. 定場圖那一項終於跑得動了 —— 卡了四輪的原因是**兩支工具各缺一半**

> §5y-h ①、§5z-j ②、§5z-o 待續①、§5z-r 待續② —— 同一項(「遊戲內尺寸 + 賽璐璐 + 勾線的
> 定場圖」)連著四輪掛在「未跑」上。這一輪先問「為什麼跑不動」,答案不是沒時間:

| 工具 | 有賽璐璐 + 勾線管線 | 載零件庫 |
|---|---|---|
| `shot_scene.mjs`(定場鏡頭組) | ✅ | **❌ 從來沒載過** |
| `shot_veg.mjs`(§5z-o 新建) | **❌ 黏土** | ✅ |

⇒ 一支畫的是**保險絲那棵樹**(而檔案裡早就換成庫節點了)、另一支畫的是**沒有管線的黏土**。
兩邊都出得了圖、都不報錯 —— 這一項因此**沒有任何一支工具跑得完**。同 §5z-o 對 `shot_giants`
記的那一條(「從原文重建、不載零件庫,驗不到這條路」),只是這次卡住的是一整個驗收項目。

**補上的三件事**(本輪儲存庫改動只有這兩支工具 + 本節,**遊戲檔一格未動**):
1. **`shot_scene` 載零件庫**(`--lib=0` 保留舊行為當「前」),並把**載到幾顆**印進 log 與 meta
   —— 載入失敗時消費端逐位元退回保險絲,那與「根本沒載」畫出來的圖一模一樣,沒有讀數就分不出。
   實測 blackforest:`libN 6`、地物 mesh **1577 → 1563**(整樹節點取代多列零件)。
2. **`shot_veg` 接上 `postfx.Pipeline`**(`--post=0` 保留黏土輸出)。但**它答不了勾線那一題**,
   而且答不了的理由是結構性的:勾線 pass 的第一行對「背景是遠平面」的像素早退,而 `shot_veg`
   的背景就是清除色 ⇒ **一棵孤零零站在空背景前的樹畫不出線**(`--ink` 開關的 PNG 逐位元相同)。
   ⇒ 勾線只能在**有地形、有鄰木**的場景裡量。
3. **`shot_scene` 補一個 `veg_near` 機位**:既有機位最近的樹也在 60~100m 外,一棵樹十幾個像素高。
   位置**照樣是推導的** —— 取離兵線中段最近的那株「高 ≥ 4m 的植被 instance」,取景比例與
   `shot_veg` 同一組(距離 2.2×樹高 / 眼高 0.55×)。認樹用**幾何包圍盒的高**,不比對列名
   (名字會改,高度不會)。

**⚠ 順手咬到一個一直都壞著的旗標**:`shot_scene` 的圖層隔離 `--ink=0` / `--grade=0` / `--fxaa=0`
**從來沒有生效過**。`flag()` 回的是 `0`/`1`,而 `Pipeline` 的判定是 `opts.ink !== false` ——
**`0 !== false` 為真** ⇒ 三個旗標全是 no-op。而 `--post=0` 看起來正常,只因為它在本檔內另被當
truthy 用(`layers.post ? new Pipeline(…) : null`)—— **同一個旗標兩套解讀,壞掉的那半沒人發現**。
這一支的賣點正是「這張圖變醜是哪一層造成的」,而那個能力**一直是不存在的**。
改回布林之後 `--ink=0` 才真的產生不同的 PNG(569,817 → 557,936 bytes)。

**⚠ 第二個:機位是推導的 ⇒ `--lib` 的前後兩張站在不同的地方拍不同的樹**(blackforest 實測
`veg_near` 的 z 從 185 跑到 239 —— 因為換掉的正是拿來推導機位的那些幾何)。這一支的賣點
「改動前後各拍一次」對 `--lib` 直接不成立 ⇒ 新增 **`--stations <meta.json>` 回放**
(座標仍來自某一輪的推導,只是把「哪一輪」講清楚;meta 本來就已經把機位寫進去了)。

**勾線的答案:中性偏加分,不是扣分。** 同一機位、同一場景,量「開勾線 vs 關勾線」改變的像素:

| 區域 | 有墨像素 | 平均落墨 |
|---|---|---|
| 全幀 | 2.26% | 20.4 |
| **近景星盤針葉樹** | **2.61%** | 19.9 |
| 遠景林帶(全是保險絲幾何) | 2.83% | 18.0 |
| 地面 | 0.29% | — |

⇒ 星盤那棵樹吃到的墨**比周圍那些舊樹還少**(2.61% vs 2.83%)。§5z-j ② 擔心的「平面大、線條稀」
與「硬邊多 ⇒ 一團黑線」**兩個都沒有發生**:層與層之間的深度落差被勾線讀成乾淨的層緣,
而同一層內部的共面三角形不生線。**同機位的 lib vs 保險絲對照**(`_zoom_ink.png` / `_zoom_fuse.png`)
是這一整輪最有力的一張:舊的 conifer2 是一疊歪斜團塊頂著一根**棕色細尖**,星盤是一棵一眼可辨的雲杉。

**未跑**:①這一項只在 **blackforest** 量過(綠地);裸露地 / 市區場地的勾線密度不同,
但那與冠形無關;②`veg_near` 挑的是「離兵線中段最近的那株高 ≥ 4m 的植被」—— blackforest 挑到的
恰好是 conifer2,別的場地可能挑到別型(那不是壞掉,只是那一張圖驗的是別的東西,meta 有機位可查)。

### 5z-j. 未跑 / 待決

①**兩族的檔位是建議不是定案**(針葉 `mid` 1,138 / 闊葉 `major .3`+`sparse` 1,276)——
額度怎麼分仍是名冊那一輪的事;②~~定場圖仍未補~~ **已跑完(§5z-t,2026-08-08)**:遊戲內尺寸 + 賽璐璐 + 勾線的定場圖
終於跑得動(先修好兩支工具各缺一半的問題),而「加分還是扣分」的答案是**中性偏加分** ——
星盤針葉樹吃到的墨比周圍的舊樹還少(2.61% vs 2.83%),兩個擔心的失敗型態都沒有發生;③**入庫縫未動**:
~~簡單幾何版是逐株程序生成的**純資料件**…要不要這樣做是使用者的決定~~ **已定案:走零件庫
(使用者 2026-08-08),見 §5z-o** —— 一株 = 木質 + 葉冠**兩顆節點**(一列一份材質,併成一顆
會同時吃掉季節色與 A39 軟性),兩顆由 `normalize_parts --group` 共用同一個變換;
④`--major` 只在兩張闊葉語料上掃過(同 §5y-b 的未跑①);⑤三個新旋鈕
(`--sections` / `--trunk-knots` / `--limb-sections`)只掃過 sections,另兩個沒有;
⑥**還沒動過的槓桿仍是「基本體組合」**(一叢兩三顆拼)—— 對簡單幾何版尤其自然;
⑦第二輪的兩顆次級旋鈕(`--fork-jit` / `--branch-jit`)在**闊葉 sparse 上量不到**,要在
同一叢複製多瓣的檔位(針葉 full / lush)重判;⑧`--merge-vol .5` 與 `--branch-deg` 的
逐株分佈(0~30° 怎麼抽)都只在這三張語料上看過,**逐株抽法要等入庫縫那一輪才定**
(遊戲端是逐株位置雜湊,不是這裡的單一參數);⑨~~`--touch` 該定 1.0 還是 1.15~~ **已定案
= 1.15(使用者 2026-08-08),見 §5z-n**:兩族同面數 ⇒ 預算逐位元不動,代價為零;
⑩淨幹 `--bole .25` 只驗過三張語料,
而它會**改變樹的總高**(延伸 16~30%H)⇒ 入庫時 `giantCrownR` 與 instance 的縮放基準要一起重算;
⑪**針葉冠形自 §5z-r 起改走星盤**(使用者手稿),①~⑩ 裡凡是講「針葉葉冠長什麼樣」的
(疊層多角錐 / 圓弧裙 / 逐瓣散葉)一律以 §5z-r 為準 —— 那幾條的**佈局**部分(分層、淨幹、
語料量測)仍然有效,只有葉冠那一顆基本體換掉了。

## 5aa. Trial log (2026-08-08, 3060-machine session — 佇列 F 第一段:整棟量體的**預算 + 消費端縫**;零節點出貨)

> 使用者定案:「**ai3d_runbook.md 接著處理建築的部分**」→ 追問後選「**執行佇列 F**」,
> 明知這**推翻 `docs/ai3d_asset_plan.md` §8.1 的 `BUILDERS` 那一列**(同日稍早定的
> 「只做景觀樹木與石頭」)。plan §8.1 已同步標注這條覆寫。

### 5aa-a. 佇列 F 步驟 2 的「`biomes.js` 的 `BUILDERS`」是**筆誤**

`BUILDERS` 住 **`hazards.js`**(障礙物:神木/倒木/防空陣地/中繼站…),與城市建物無關。
真正的消費端是 `biomes.js` 一般建物繪製段的那個 `InstancedMesh`:
**單位 `BoxGeometry` + 6 材質群組(`[wall,wall,roof,roof,wall,wall]`,BoxGeometry 群組序
+x,−x,+y,−y,+z,−z)+ 逐實例 `scale = (w,h,d)` + 逐實例 tint**,逐立面款各一個(16 個 draw call)。
這一條差別不是名字問題:那 6 個材質群組決定了「整棟節點能不能保住立面窗格與夜間自發光」,
而 `hazards.js BUILDERS` 是逐件 primitive 的**另一種**消費端形狀。佇列 F 的原文已更正。

### 5aa-b. 先量再開 —— 而量測直接否決了「整桶換」

`measure_building_tris.mjs` 加了兩件事:①**印出 `stats.buildings`**(`--live` 只是「有沒有讓它
連出去」,Overpass 掛掉會靜默退回程序生成街區,而那一輪的 instance 數會低一個量級 = 上限
看起來很寬鬆,沒有任何錯誤訊息);②**逐實例矩陣拆解**做尺寸普查(整棟節點的 instance 上界
不是「這張圖有幾棟樓」而是「這條選取規則挑中幾棟」)。四場 `--live` 實測:

| 場地 | 建物 | 全場 tris | 建物桶合計 | 主量體 instance | >40m | >55m | >100m | 最高 |
|---|---|---|---|---|---|---|---|---|
| shibuya | 558 | 1,062,292 | 38,316 | 671 | 59 | 21 | 2 | 132m |
| manhattan | 479 | 1,183,325 | 37,108 | 590 | 100 | 55 | 9 | 132m |
| seoul | 887 | 1,225,097 | 53,644 | 1,035 | 82 | 39 | 0 | 69m |
| **taipei101** | **1,114** | 1,205,428 | **59,736** | **1,325** | **157** | **71** | 0 | 69m |

⇒ 主量體桶總量上界 **15,900 tris**(1,325 × 12)。成長額度 = 3 × 15,900 = 47,700 ⇒
**整桶換的逐節點上限只有 36 tris**(比現行的單位方盒 12 只多兩打三角形),而 §5o 已實測
**500 面就留不住 Art Deco 的退縮量體**。**「只換一個子集」因此是量出來的結論,不是偏好** ——
這正是佇列 F 步驟 1「預算與縫 MUST 同一輪定案」要防的那件事:先開 400~900 的縫再來想辦法,
生出來的每一棟還是同一團方塊。

子集大小 `pick_n` 由兩條約束反推、取較嚴者:①**畫面細節下限** cap ≥ 2 × §5o 的 500 面失敗點
⇒ N ≤ 47;②**draw call** —— 整棟節點的幾何與方盒不同 ⇒ 挑中的棟數就是額外 InstancedMesh 的
上限,而立面段現行 16 個並自述「仍是常數級」⇒ 再加同一個量級為止 ⇒ N ≤ 16。②較嚴 ⇒
`pick_n = 16`、`node_cap = 47,700 ÷ 16 = **2,981**`(最壞 16 × 2,981 = 47,696 = 最重場景的 4.0%)。
高度門檻 `min_h = 55` **沿用 biomes 既有的退縮頂塔門檻**(MUST NOT 另發明數字);四場合格
棟數 21/55/39/71 全 > 16 ⇒ 密市區恆由 `pick_n` 夾住,郊區自然少於 16 棟。

### 5aa-c. 縫的形狀(三條契約 + 一條新的材質契約)

`BLD_LIB` 收第四桶 `mass`,值的第一格**可以是陣列**(輪替名冊,同 `MEGA_LIB.block`;一款
打天下 = 同一條天際線十幾棟同剪影,就是零件庫紀律「烤整棟樓會把逐實例變化丟掉」的同一個病),
輪替除數由名冊長度推導。`bldGeo(key, i)` 是**唯一**解析縫(`libGeo(` 全檔仍恰 3 處);
`buildBldBucket.mass(n, mat, i)` 是唯一桶建構點。

- ①**碰撞/LOS 一格不動**(A30):有向盒仍是 `b.w/2`、`b.d/2`、`b.ry`,那幾行沒被碰過。
- ②**保險絲**:名冊空著或庫沒載到 ⇒ `massOk` 空 ⇒ 一棟都不挑 ⇒ 主量體全數落回單位方盒。
- ③**佈局數學只讀權威資料**:挑選只讀 `b.commercial/h/x/z`,**零 `rnd()` 消耗**(§2.3 / A4);
  等高時以 `x`/`z` 定序(不能靠 sort 的實作穩定性決定跨客戶端誰入選)。
- ④**材質**(這一輪新加的):庫節點是單一群組 ⇒ three 取材質陣列第 0 格,故傳**該立面款
  現做的 `wall` 材質**(窗格貼圖 + 夜間自發光 + 逐實例 tint 全部保住);自己 new 一份就是
  第二套立面材質,症狀是「那幾棟高樓晚上不亮」。代價 = 頂面也吃立面貼圖(換到的是最高的
  十幾棟,俯視看到頂面的機會遠低於「晚上不亮」)。⇒ **節點契約多一條:匯出端 MUST 給
  盒投影 UV**(沿用原 BoxGeometry 的 0..1 逐面慣例),否則整棟只採到 (0,0) 那一個 texel
  = 一塊沒有窗的純色板。這一刀**尚未實作**(見待續)。

另一個看不見的坑:逐實例色抖的雜湊原本吃 `inst` 的**陣列索引**,而拆桶會把索引整排往前移
⇒ 其餘每一棟的色相都跟著平移(沒有錯誤訊息,只表現成「這張圖的街廓配色跟上次不一樣」)。
改吃 `t.ord`(拆桶前的原始序);名冊空著時 `ord === i` ⇒ 逐位元同舊制。

### 5aa-c2. 那條路真的被走過一次(零節點出貨 ≠ 沒驗過)

縫開好而名冊空著時,新程式碼**一行都不會被執行** —— 「A/B 逐位元相同」只證明了它是 no-op。
故做了一次**暫時性**的實測(改完即還原,不入版控):把 `mass` 那一列指到既有的
`building/ac_a`,並讓量測探針先 `loadPartLibs()`,對同一份錄播圖資跑 shibuya。

- 主量體桶(6 材質群組)instance **671 → 658**,少掉的 **13** 棟落進**單材質且帶貼圖**的
  新 mesh:instance 分佈 5 + 4 + 2 + 1 + 1 = 13,分散在 **5 個立面款** ⇒ **額外 draw call 5 個**
  (`pick_n = 16` 是上界,實得遠低於它)。
- 那五個 mesh 的材質 `.map` 非空 ⇒ **立面貼圖(窗格 + 夜間自發光)真的接上了**,
  這正是 §5aa-c ④ 要保住的東西。
- 13 而不是 16:shibuya 的合格**建物**(commercial ∧ h > 55m)本來就只有 13 棟
  —— 普查表那欄 21 數的是**實例**(含 ≥8m 寬的裙樓/頂塔)。`pick_n` 是上限不是配額。

同一輪順帶量到一個**與這次改動無關但值得記**的數:載入零件庫之後 shibuya 全場三角形
1,062,292 → **1,282,707**(+20.8%)—— 那是 rock/tree/building 既有節點的真實成本,
而所有預算量測都是在**沒有載入零件庫**的基準上做的(這是對的:額度要從「還沒換」的現值算)。

`--boxuv` 也單獨驗過一次(拿既有 GLB 當來源 round-trip):輸出的 `TEXCOORD_0` 存在、
u ∈ [0.067, 0.929]、v ∈ [0.125, 0.902] —— 逐面 0..1 的盒投影成立。

### 5aa-d. 逐位元不變**用量的**,不是用讀的

新旗標 `measure_building_tris.mjs --osm-cache`:把 Overpass 回應錄下來重播。**不是為了快** ——
同一支指令、同一張圖(shibuya)、相隔五分鐘的兩次 `--live`,建物 558 ↔ 842 棟、
主量體 671 ↔ 982 個、煙囪 144 ↔ 249 座(±70%)⇒ 改動前後各抓各的圖資,量到的差異全是圖資的。
錄好之後跑 A/B(`git show HEAD:public/js/biomes.js` 覆蓋 → 量 → 還原):
全場三角形、mesh 數、**每一個桶的 instance 與 tris、671 筆逐實例尺寸普查**——
`JSON.stringify` 逐位元相同。

### 5aa-e. ⚠ 順手量到的欠帳:deco 那三桶的上限是拿**低估的樣本**推的

同一批四場資料重推屋頂配件桶:instance 上界 chimney 212 → **269**、tank 97 → **160**、
acbox 117 → **209**(全部在 taipei101 —— 2026-08-06 那一輪根本沒取到這張圖),
桶總量上界 50,936 → **59,736** ⇒ 逐桶上限 chimney 240 → **222**、acbox 435 → **285**,
而**已出貨的 `chimney_a` 是 234、`ac_a` 是 426 ⇒ 兩顆都會超標**。

本輪**刻意不動 deco 閘門**:使用者這一輪要的是整棟量體的縫,回頭重切兩顆已出貨資產不在
範圍內,而且 `chimney_a` 當初就是 938 → 234(3.9:1)減出來的、已經在 §5e「溫和減面無害」的
上緣,再減一刀 MUST 配黏土人眼複核。**這是欠帳**,已寫進 `tri_budget.json` 的
`families.building.resample_2026_08_08`(含 `finding` / `variance_warning` / `contamination_note`),
下一輪建築批 MUST 一併處理:二選一 —— 重減面到新上限,或改用比「跨場地取最大」更穩的上界規則
(那個統計量本身就會隨取樣次數單調往上爬,而上限跟著往下掉)。
另外記一筆:`cornices` 桶的指紋是「BoxGeometry + 材質色 ffffff」,四場都量到比主量體還多的
instance ⇒ 白色單位方盒的 InstancedMesh 不只簷口帶一種,那一桶是**高估**的(只進分子、
不進任何除數 ⇒ 不影響本輪 mass 的推導,但修 deco 閘門時 MUST 先把指紋收窄)。

### 5aa-f. 驗收

`intake_parts` 237 / `audit_siteplan` **194**(+7,`--break-mass` 反向驗證**恰 3 條紅**:
pick_n 與預算分家 / 拿掉保險絲閘 / 色抖吃拆桶後的新索引)/ `audit_object_joints --seeds 8`
21611-0 / `audit_beacons` 68 ± 反向紅 / `gpu` 54 / `soft_stroke` 73 / `cel` 52 / `visual_prefs` 124 /
`npm test` 全綠(fresh server :8666)/ `npm run bal` **全綠且逐項不動**(⑦f 1.78×、
⑦c 66.0/77.6/52.1 與上一輪逐字相同)/ 3D 零件對照台 0 缺件 / 0 孤兒 / 0 未記載。

`audit_traverse`(㋓)也跑了:**96 通過 / 19 紅**,而那 19 條是**既有基準**(記錄在案的
「泛洪鍵漏 sid / 缺鏈接與邊界裁切 / 淨空撞 deckAt 夾制 / civicblvd 舊快取」那一批,
全部是稽核端而不是遊戲破圖),與本輪無關 —— 本輪的縫在 A/B 上逐位元相同,
街廓通道寬不可能變。**節點入庫那一輪仍 MUST 再跑一次**(那時它才真的會動到量體外廓)。

### 5aa-g. 未做(下一支分支接手的就是這幾條)

1. **零節點出貨** —— 縫開好了、預算定了,但 `BLD_LIB.mass` 那一列仍是註解(同 `tank` 的處理)。
   佇列 F 步驟 4(入庫閘)與 `provenance.mjs METHODS` 的 `trellis2_spz` 都還沒被走到。
2. ~~**盒投影 UV 那一刀沒實作**~~ **已實作(本輪)**:`normalize_parts.py --boxuv <node>` ——
   剝掉來源 UV 之後依主導法線分軸重建(±X → (gz,gy)、±Y(頂/底)→ (gx,gz)、±Z → (gx,gy)),
   各面映到 0..1;`export_texcoords=True` 顯式打開(`export_materials='NONE'` 很容易讓人以為
   UV 也不用留)。round-trip 驗過(§5aa-c2)。**還沒被真的 T2 產出走過一次。**
3. **T2 生成本身沒跑** —— 語料是 §5i 那 55 張建築照(photo DB 家見環境矩陣);
   餵 T2 的 matte **MUST 先二值化 alpha**(>16 → 255,§5n),減面走 §5t 已定案的
   `solidify_parts.py`(先實體化再減面)。目標面數這一輪很寬鬆(≤ 2,981),
   §5o 那條「500 面留不住識別特徵」的限制在這個級距上不成立。
4. **真機冒煙未跑** —— 縫是 no-op 所以不急,但節點入庫那一輪 MUST 跑:
   蓋到的是**最高的十幾棟**,要看的兩件事是「夜間立面有沒有亮」與「頂塔/裙樓有沒有跟整棟
   節點自己的頂部造型疊成兩頂帽子」(本輪已讓 `lib` 只掛主量體那一列,但那是設計不是實測)。
5. ~~**`audit_traverse`(㋓)**~~ 本輪**跑了**(96/19,19 = 既有基準紅字,見 §5aa-f);
   節點入庫那一輪 MUST 再跑一次 —— 那時整棟量體的外廓才真的會變。

## 5ab. Trial log (2026-08-08 深夜, 3060-machine session — 佇列 F 第二段:deco 欠帳清掉 + **首顆整棟量體節點 `building/mass_a` 入庫**)

> 使用者對 §5aa 收尾的兩個問題各回一個字:**「減面」**(採用重取樣、把兩顆已出貨節點減到位)
> +**「開」**(生成並入庫第一顆整棟量體節點)。兩件都做完了。

### 5ab-a. deco 欠帳:採用四場取樣,兩顆節點同輪減到位

`node_caps` chimney 240 → **222** / tank 525 → **373** / acbox 435 → **285**(分子 50,936 → 59,736、
instance 上界 212/97/117 → 269/160/209,全部來自 taipei101 —— 2026-08-06 那一輪沒取到它)。
兩顆已出貨節點跟著補一刀:**chimney_a 234 → 217、ac_a 426 → 279**。

**刀落在已出貨的節點本身,不是從 SF3D 原檔重跑** —— 因為原檔**復現不出**出貨的那兩顆:
`sf3d_bld_final/{chimney,ac}/0/mesh.glb` 配 manifest 記著的 0.6×0.5 / 0.65×0.5 只得到 220 / 402,
而且黏土對照一看就是**另一顆**(垛口狀的頂沒了)。⇒ 那兩顆的真正來源(哪一批輸出的第幾顆)
**沒有被記下來**,已寫進 manifest 的 `post.source_gap`,規矩補一條:**下一批建築節點的帳
MUST 記到輸出目錄與序號**。減面比 1.08:1 / 1.53:1,遠離 §5e 的 2.4~3:1 撕裂區;黏土四格
對照(shipped vs trimmed × 兩顆)人眼複核:垛口頂/凹槽/收分/方箱頂脊全部還在。

### 5ab-b. `--cells` 在建築上不是解析度旋鈕,是**濾掉立面凹槽**的旋鈕

節點來源 = §5n 閘門那一輪就已經生好、還躺在 `out_gate/` 的 **Art Deco 摩天樓**
(`ov_5846d9e4…`,art deco skyscraper / CC0 / athrasher;T2-spz 1024_cascade seed 1234,
226.4s、torch 峰值 3,409 MiB、raw 12,187,288 面 → 匯出 49,845 面)⇒ **這一輪不必重跑 T2**
(也就避開了「free RAM 19.8GB 貼著 20GB 門檻」那個風險)。

要把它從 49,845 面的雙層薄殼(34,751 開放邊 / 3,123 元件 / v:f 0.91)壓到 ~2,900 面,走
§5t 已定案的 `solidify_parts.py --mode resample`。**預設 `--cells 256` 出來的東西讀起來是
一塊侵蝕岩,不是一棟樓** —— T2 把立面的窗格陣列生成了一整片**垂直凹槽**,而
volumetric resample 在 2,900 面的預算下把那些凹槽逐條重採樣成隨機凸起。
往**細**調(384 / 512)只是把凹槽採得更清楚 ⇒ 更糟(kf_p95 從 0.91% 掉到 0.51% ——
**表面偏差變小而畫面變差**,§5o「表面偏差量不出撕裂」的同一條在這裡換了個面貌)。

正確方向是**往粗**:讓凹槽落在取樣解析度之下被抹平,而尺度大一個量級的**退縮階梯**
完整保留。逐檔黏土對照 56 / 72 / 96 / 128 / 160 / 256 / 384 / 512:

| cells | 面 | 開放邊 | 元件 | v:f | 黏土 |
|---|---|---|---|---|---|
| 56 | 2900 | 26 | 11 | 0.49 | ✗ 裙樓斷成浮塊 |
| **72** | **2900** | **16** | **6** | **0.50** | **◎ 階梯 + 裙樓 + 冠塔都在,面平整** |
| 96 | 2900 | 40 | 5 | 0.51 | ○ 略有凹槽殘噪 |
| 128 / 160 | 2900 | 56 / 60 | 4 / 5 | 0.51 | △ 凹槽回來了 |
| 256(預設)| 2899 | 97 | 10 | 0.51 | ✗ 侵蝕岩 |
| 384 / 512 | 2900 | 134 / 180 | 24 / 20 | 0.51 | ✗ 更碎 |

⇒ **`--cells 72 --offset 0.006 --target 2900`**;normalize 非等向 `0.5x0.5` + **`--boxuv`**
⇒ `building/mass_a` **2,898 面**(上限 2,981 留餘裕)、水平徑向 0.475、縱向 ±0.47。

### 5ab-c. 一個只有截圖看得到的缺陷:附件浮在半空

節點上線後的第一張 `mass_near` 定場圖立刻現形:**看板/天線/程序頂塔浮在塔尖上方**。
成因是算術的 —— 屋頂附件一律掛在**方盒**頂 `gy + b.h`,而庫節點縱向收在 0.95×b.h
且末端本來就收成尖塔 ⇒ 130m 的樓差 3.25m,而且尖塔那一段幾乎沒有實體。

修法 = **挑中的那幾棟,純視覺附件一律不掛**(節點自帶退縮頂塔與立面,再疊一頂程序頂塔
就是「兩頂帽子」)。兩條紀律:
1. **只換「推去哪裡」,`rnd()` 照抽** —— `const vis = (arr) => (libMass ? sink : arr)`,
   19 處純視覺 push 改成 `vis(x).push(...)`。引數原樣求值 ⇒ 亂數序列在結構上不可能變
   (同 `synthMegalith` 整座型分支的「庫節點只換 add 進場景」)。
2. **帶碰撞柱的兩件 MUST NOT 進丟棄桶**(主量體 + 臨街裙樓)—— 少掛一根碰撞柱會讓
   「載到庫的客戶端」與「沒載到的」**權威幾何分家**(A30 + §2.3),而那是看不出來的。

**亂數不變是量的**:同一份錄播圖資,載庫 vs 不載庫的 `stats` 指紋
`veg 530 / megaliths 10 / beacons 9 / climbs 122` **逐項相同**(那四個都排在建物之後,
序列一動就會漂)。同一組數字也證實了縫本身仍是 no-op:不載庫時全場三角形 1,062,292 /
mesh 1573 / 主量體 671 —— 與 §5aa-d 的 base 逐位元相同。

### 5ab-d. 實測成本與畫面

shibuya(錄播圖資)載庫後:主量體桶 671 → **647**(13 棟換成庫節點 + 11 頂程序頂塔退場),
全場三角形 1,062,292 → **1,295,924**(+22.0%,**這是三族既有節點的總成本**,不是這一顆的)。
`mass_a` 自己的帳:13 × 2,898 = 37,674 tris = 最壞情況 16 × 2,981 = 47,696 的 79%,
佔該場全場 2.9%。

新機位 **`shot_scene.mjs` 的 `mass_near`**(推導不手寫:比對**幾何物件本身**找到第一個整棟
庫節點的 instance,再照它的高度反推鏡位)—— 既有機位幾乎拍不到那十幾棟,而它是**唯一吃
立面貼圖**的庫節點,盒投影 UV 一錯就是一塊沒有窗的純色板而所有離線閘門全綠。
同輪把 `libN` 的名冊補上 `building/*` 三顆(那個讀數是「庫到底載到沒」的唯一證據)。
畫面:兩棟階梯狀塔樓,窗格立面、退縮階、裙樓與冠塔都在,四周方盒樓完全不受影響。

### 5ab-e. 驗收

`intake_parts` **241** / `audit_siteplan` **197**(+3;`--break-mass` 反向 **4 條紅**)/
`audit_object_joints --seeds 8` 21611-0 / `beacons` 68 / `gpu` 54 / `soft_stroke` 73 / `cel` 52 /
`visual_prefs` 124 / `npm test` 全綠(fresh :8667)/ `npm run bal` **全綠且逐項不動** /
3D 零件對照台 0 缺件 / 0 孤兒 / 0 未記載 / `audit_traverse` **96-19**(與節點上線**前**同一組
既有基準紅字 ⇒ 街廓通道寬確實沒動,因為碰撞柱一格都沒改)。

### 5ab-f. 未做

1. **真機冒煙**(唯一還沒跑的):要看的兩件事是**夜間立面會不會亮**(庫節點吃的是該立面款
   現做的 `wall` 材質,`emissiveMap` 應該照常)與**貼著塔走一圈的碰撞**(碰撞柱仍是方盒
   ±0.5,而節點內縮到 0.475 ⇒ 貼牆時會離牆面約 2.5% 樓寬,預期是「撞得到但看起來有一點縫」)。
2. **名冊只有一顆** —— `BLD_LIB.mass` 是輪替名冊,但現在只有 `mass_a`,所以同一張圖上
   十幾棟塔樓是**同一個剪影**(尺寸各異但形狀相同)。第二、三顆的語料 `bld_tower` 還有 3 張
   沒用過;`out_gate` 裡另一棟(`ov_fde797a7`,柱廊矮量體)不適合這一桶(它不是塔樓)。
3. **`--cells` 的結論只在這一張語料上量過** —— 「往粗調濾掉立面凹槽」對所有 T2 建築產出
   應該都成立(凹槽 vs 量體的尺度差是通則),但第二顆入庫時 MUST 重跑一次逐檔黏土。
4. deco 那兩顆的**來源帳缺口**(§5ab-a)只補了規矩,沒補回歷史。

## 5ac. Trial log (2026-08-08 深夜, 3060-machine session — 鏡像貼補:**刀的位置比刀本身重要**)

> 使用者看過 §5ab 的定場圖後定案:「**圖中建築另一面是空的,使用鏡像貼補空的部分**」。

### 5ac-a. 先確認「空」是什麼意思 —— 不是破面,是**沒被拍到的那半沒有東西**

逐面法線分向量面積:±x 21.1 / 20.9%、±z 19.1 / 19.3%、±y 10.4 / 9.3% ⇒ **六個方向都有面**,
不是缺一面。真正的「空」是**內容**:單張照片只約束得到看得見的那幾面,退縮階 / 簷帶 /
裙樓只長在被拍到的那半,另一半是模型自己補的一片平板。量得出來的指標是**半空間面積
不對稱**:z 軸 12.3% / x 軸 0.6%(空的那半在網格上不是洞、是一片光滑的板 ⇒ 開放邊與
元件數都判不出來,**面積才判得出來**:細節多 = 面積大)。

### 5ac-b. 兩次失敗:鏡射放在 solidify 端,兩種寫法都把網格撕爛

| 寫法(在 `solidify_parts.py`,鏡射排在實體化之前) | 結果 |
|---|---|
| (a) 切一半 → 鏡射 → 接上 | 開放邊 16 → **362**、元件 6 → 13、**裙樓整條不見**,黏土是碎片 |
| (b) 整份鏡射 → 與原注疊合(z 軸) | 開放邊 → **1,119**、元件 → 24、v:f 0.68 |
| (b) 同上但 x 軸 | 面數 **打不到目標**(5,058)、開放邊 5,016、元件 230 = 三角形湯 |
| (b) 先 solidify 清乾淨再鏡射疊合 | 一樣壞(1,412 / 6,440 開放邊)⇒ **不是輸入髒的問題** |

共同的錯誤前提是「**後面的 resample 會幫我熔合**」。它只對**單層**輸入成立:
(a) 沿平面切下去等於再開一圈長長的自由邊,留下的與鏡射過去的是兩張各自開口的殼;
(b) 重疊的雙層殼讓等值面重採樣的內外號誌打架。`solidify_parts.py` 的 `--mirror` 因此
**整支退回**(出貨的工具不留一個會把網格撕爛的旗標);這張表是它的墓誌銘。

### 5ac-c. 刀的正確位置 = **Blender 端的 bisect + weld**

`normalize_parts.py --mirror <node>=<x|z|auto>`:Mirror modifier 的
`use_bisect_axis` + `use_clip` + `use_mirror_merge`(threshold = 該軸跨距 × 1e-3,**比例值**,
絕對值不可移植)。它走的是完全不同的路 —— **切面 + 直接焊頂點,不重建等值面**
⇒ 一條新的自由邊都不生。留哪半由**面積**決定,`auto` 再從兩個水平軸挑不對稱較大的那一軸。
MUST 排在減面**之前**(鏡射保留一半再翻一份 ⇒ 面數大致不變;排在減面之後直接把預算翻倍)。
軸是**遊戲座標**:遊戲 x = Blender X、遊戲 z = **Blender Y**(匯出 +Y up 時互換)。

實測(同一顆 `mc_72` 進去):

| | 面 | 開放邊 | 元件 | v:f |
|---|---|---|---|---|
| 不鏡射(§5ab 出貨的那顆)| 2,898 | 18 | 5 | 0.50 |
| **`--mirror auto`(挑到 z)** | **2,921** | **15** | 6 | 0.50 |
| `--mirror x` | 2,920 | 36 | 8 | 0.50 |

⇒ **鏡射後比不鏡射還乾淨**(15 < 18),面數仍在 2,981 之下。黏土六格(三版 × 正/背)
確認:左右各有一道裙樓、冠塔對稱、看不到接縫。定場圖 `mass_near`:兩棟塔樓都成了
左右對稱的階梯塔,而周圍方盒樓完全不受影響。

**MUST NOT 對非對稱典型的主體套用** —— 岩體/枯幹鏡射出來是一顆假的雙生岩。
對稱化是這一型(Art Deco 塔樓)的**取捨**,不是通則。

### 5ac-d. 驗收

`intake_parts` 241(mass_a 2,921 ≤ 2,981)/ `audit_siteplan` 197 / `object_joints` 21611-0 /
`beacons` 68 / `gpu` 54 / `soft` 73 / `cel` 52 / `visual` 124 / 對照台 0-0-0。
消費端、預算、亂數三者都沒動(換的只是同一個節點名的幾何)⇒ `npm test` / `npm run bal` /
`audit_traverse` 沿用 §5ab 那一輪的結果。

### 5ac-e. ⚠ 之前所有「多視角」複核**全部是同一個視角** —— `ry` 是 no-op

使用者回報鏡射後「還是有一些地方空的沒有補全」,回頭查才發現:`normalize_parts.py` 的
**`ry`(變化朝向)從第一天起就沒有作用**。

- 症狀:拿同一顆節點跑 ry 0/60/120/180/240/300,匯出的**包圍盒逐位元相同**
  (x ±0.378 / z ±0.420)。而 `mesh_sheet` 是固定機位 ⇒ §5ab/§5ac 那幾張「4 視角 / 6 格
  正背對照」**其實是同一張圖印了好幾次**,我從來沒有看過這顆節點的背面。
- 根因:**glTF importer 把物件的 `rotation_mode` 設成 `QUATERNION`**,而在那個模式下賦值
  `rotation_euler` 是**靜默無效**的 —— `transform_apply` 照樣回 `{'FINISHED'}`、euler 照樣歸零,
  頂點一個都沒動。修法一行:賦值前先 `ob.rotation_mode = 'XYZ'`。
  判準寫進註解:轉 60° 之後包圍盒 MUST 變(x ±0.378 → ±0.446)。
- 連帶:所有帶 `ry` 的既有節點(`rock/facet_b` 那一族「同源轉個角度別讓玩家看出同一顆」)
  **都沒有真的轉過**。所幸 `facet_a`(882 面 / r 1.0925)與 `facet_b`(588 面 / r 0.8075)
  各自有自己的來源與減面比,**沒有退化成同一顆** —— 但「同源要轉角度」這條紀律至今沒生效。
  修好之後**重跑它們會改變已出貨資產**,要不要重跑是下一輪的決定。
- 修好後補拍的四視角(0/90/180/270)確認:**外殼是完整的**,四面都有立面、沒有缺面、
  沒有中空 —— 鏡像貼補那一刀是成立的。

### 5ac-f. 那麼「還是有一些地方空的」是什麼 —— **量體內部的空洞,不是缺面**

四視角補拍之後看得到的是:①**壁柱之間的深槽**(T2 把立面窗格生成了整片垂直凹槽,
`--cells 72` 抹掉了大部分,剩下的在某些角度讀成一條條穿透的縫)②**冠塔中央的裂口**
③**裙樓中段的缺口**。這些都在**輪廓之內**,鏡射補不到(鏡射只處理「左右不對稱」)。

下一輪要處理的是**形態學閉合**這一類的操作,而不是再鏡射一次。候選(未驗):
- `--offset` 加大(等值面外推越多,窄縫越容易被橋起來)—— 代價是稜線圓潤化,
  §5o 已記過這條 trade-off,MUST 逐檔黏土;
- 重採樣前先做一次 **dilate → erode**(pymeshlab 沒有現成的,但 `generate_resampled_uniform_mesh`
  跑兩次不同 offset 就是近似的閉合);
- 或**換一張語料**:這一張的立面凹槽特別深(art deco skyscraper 的垂直線條),
  `bld_tower` 還有 3 張沒用過,其中平整立面的那種天生沒有這個問題。

## 5ad. Trial log (2026-08-09, 3060-machine session — 鏡像貼補推廣到巨岩/假山:**先量「哪一面真的是空的」,再決定用哪一把刀**)

> 使用者定案:「img to 3D 會出現另一面是空的問題,**由正面對稱的區塊去補對應的區塊**,
> 包含**建築 / 巨岩 / 假山**都這樣處理。」

### 5ad-a. 這一句是**條件句** ⇒ 先做尺,再做刀

「**會出現**另一面是空的問題,(那時)由正面對稱的區塊去補」—— 沒有空的那一面就沒有要補的東西。
而 §5ac 的教訓是這件事**不能靠眼睛決定**(§5ac-e:`ry` 是 no-op ⇒ 那幾張「多視角」其實是同一張)。
所以這一輪先補上兩支缺掉的儀器:

| 工具 | 回答的問題 | 為什麼非有不可 |
|---|---|---|
| `tools/ai3d/mesh_sym.mjs` | 四個數:①半空間面積不對稱 ②鏡射殘差 ③邊界邊 ④鬆散元件 | §5ac-a 的量法正式化。空的那半在網格上**不是洞、是一片光滑的板** ⇒ ③④ 對它完全無感,只有①判得出來 |
| `tools/ai3d/node_sheet.mjs` | 一顆節點的**四個面**長什麼樣(給 `--ref` 就舊/新兩列) | §5ac-e 那句「我從來沒有看過這顆節點的背面」的直接補救。**繞相機不轉模型** ⇒ 結構上不可能重蹈 `ry` no-op |

**閘門錨在使用者自己判定過的那一顆**:§5ac-a 量到 `mass_a` 鏡射前 z 軸 **0.123** / x 軸 0.006,
而使用者對著那張定場圖說的正是「這棟建築另一面是空的」⇒ `EMPTY_ASYM = 0.12` 是那句話的量化,
不是挑出來的數字。`mesh_sym --gate` 因此可以直接印出名冊(15 顆現役節點 → **6 顆**):

```
rock      collapse_a 0.184(x) / hoodoo_a 0.167(z) / facet_a 0.135(z) / mega_d 0.133(z) / mega_c 0.131(z)
building  chimney_a 0.214(z)          ← ac_a 0.072 與 mass_a(已補)在門檻之下
```

**MUST NOT 改成逐顆手挑的名冊**:對一顆四面都長好的岩體照樣切半鏡射,換來的不是「補滿」,
而是一顆左右對稱、接縫帶凹槽的假石頭(下面 5ad-c 有黏土留檔)。

### 5ad-b. 刀改成 `--rework`:落在**已出貨的節點**上,外廓與預算逐位元不動

`--mirror` 只在「從 SF3D 原檔重跑一顆節點」那條路上才有用,而**出貨節點的原檔多半對不回來**
(`parts_manifest` 的 `source_gap`:同一組 fit 重跑 chimney/ac 只得到 220/402,而出貨的是 234/426,
剪影明顯是另一顆)。§5ab 重減面那一輪已經走過「刀落在已出貨的節點本身」,這一輪把它做成具名旗標:

```
--rework "<node>=<x|z|auto|none>[|<warp>][|half|union]"      # 要有 --base
```

**核心不變式:動刀前先記下 `nodeExtent` 量的那兩個數(水平徑向 rMax、縱向 y 兩端),動完等比還原。**
於是 intake 的外廓契約(上界 fallback 包絡、下界 0.5×)**兩邊都不可能因為這一刀而改變**,
唯一變的是殼裡面的形狀。**面數同理只准降不准升** —— 鏡射會多出切面那一圈(+17~26% 實測),
而現役節點的預算餘裕只有 2%(chimney_a 217/222、ac_a 279/285)⇒ 一律減面回原值(比 ≤ 1.2:1,
遠離 §5e 量到的 2.4~3:1 撕裂區)。

**必要前置:先依距離焊頂點。** glTF 匯出器為了法線接縫把頂點拆開,而 **Blender 的 glTF 匯入器
預設不會焊回去** ⇒ 平面著色的節點(拆分比 ≈ 3)在 Blender 眼裡是**一堆互不相連的三角形**。
對三角形湯做 bisect 的實測下場:`hoodoo_a` 382 面 → **96 面**、`tower_a` 開放邊 0 → **170**。
焊接會抹掉自訂分裂法線 ⇒ 著色風格依**原拆分比**還原(≥2 平面 / 以下 30° 角平滑),
不還原的話低面數岩體會從有稜有角變成一顆平滑的馬鈴薯,而所有讀數都正常。

### 5ad-c. **兩把刀,依主體是不是人造的選** —— 這不是喜好問題

| 刀 | 做法 | 對誰成立 |
|---|---|---|
| `half` | bisect + clip + 焊接縫(§5ac 那一把) | 量體本來就左右對稱的東西(建築) |
| `union` | 整份鏡射 → **精確布林聯集** | 岩體 |

`half` 對圓渾的岩體會做出**葉緣**:保留的那半在切面上是最寬的斷面,而表面是**斜著**離開切面的,
翻一份接上去就在切面接成一道銳脊。四視角黏土實測(scratchpad 留檔):`mega_c` 從一顆卵石變成
**一片有中脊的葉子**、`mesa_a` 的**平頂變成尖峰**、`collapse_a` 變成楔形、`chimney_a` 變成一頂帳篷。
`union` 取的是兩者的**外包絡** ⇒ 本來就厚的那半原封不動、空的那半被鏡像撐出來,接縫是內凹的
岩溝而不是外凸的銳脊,平頂/塊狀輪廓保得住。

與 §5ac-b 失敗的「整份鏡射再疊合」**不是同一件事**:那一版是把兩張殼疊在一起交給等值面重採樣
自己想辦法(內外號誌打架 ⇒ 開放邊 1,119),這裡是真的做布林。代價是**布林要求輸入夠乾淨**:
逐顆實測 union 在 12 顆岩節點裡有 6 顆炸掉(見下表)。

### 5ad-d. 三道閘,每一道都對得上一次實測的失敗

| 閘 | 擋掉的東西 |
|---|---|
| 面數 ≥ 原值 × 0.8 | `hoodoo_a` 的 z 平面 bisect:382 → 96(同一顆的 x 平面卻好端端 616)。焊完 V=139/F=382 已經不是流形 |
| 鬆散元件 MUST NOT 增加 | `tower_a` 走 union:元件 1 → **14**,而**面數只掉 6%** —— 光看面數完全攔不住,黏土圖上是一地碎屑 |
| 邊界邊 ≤ 原值 + 5% 面數 | `mesa_a` union 175 → 257、`facet_b` union 60 → 119 |

三道閘 MUST 排在**減面之前**:減面會把碎屑磨掉一部分,讀數反而變好看。
少了這幾道,壞掉的節點會**安靜地**出貨 —— 外廓照樣還原、預算照樣綠、intake 一句話都不會說。

逐顆 × 逐刀的實測結果(✅ = 過閘):

```
            union  half        union  half              union  half
collapse_a   ✅    ✅   mega_b   ✅    ✅   mega_f        ❌    ❌(元件 1→16 / 1→4)
facet_a      ✅    ✅   mega_c   ✅    ✅   tower_a       ❌    ✅(元件 1→14)
facet_b      ❌    ✅   mega_d   ❌    ✅   mesa_a        ❌    ❌(邊界邊 175→257 / 194)
mega_a       ✅    ✅   mega_e   ❌    ✅   hoodoo_a      ❌    ❌(面 382→128 / 96)
```

### 5ad-e. 去對稱化(`warp`):**位移 MUST 只是位置的函數**

鏡射之後兩半逐位元相同 = 一顆假的雙生岩(§5ac-c 因此把岩體列為禁區)。低頻位移場沿**徑向**
推開之後,鏡射殘差回到天然岩體的水準,而「空的那一面被填滿」不受影響。

⚠ 方向 MUST 取徑向,**MUST NOT 取頂點法線**:座標重合但各自獨立的頂點(見 5ad-b)在逐頂點
法線下是不同的向量,推一下就把網格沿每一條硬邊撕開(實測 `mega_a` 開放邊 0 → **164**、
元件 1 → **7**)。位置的函數對重合頂點給出同一個位移,結構上不可能撕(實測:warp 0 與 0.05
的開放邊/元件**逐項相同**)。岩體對中心近似星形 ⇒ 徑向與法線本來就幾乎同向。

振幅錨在**天然水準**:未鏡射節點的鏡射殘差落在 0.030~0.274(中位數 ≈0.073)。掃描 0.05 / 0.08 /
0.11 三檔,0.08 讓全體落在 0.030~0.111(中位 0.075)= 正中天然帶。**但有破口的節點 MUST warp 0** ——
裂縫兩側是不同座標的頂點,位移會把縫拉開(實測 `mesa_a` 0.08:黏土圖上原本的細縫變成黑色溝壑)。
出貨取 0.05(watertight 那幾顆),換來 sym 0.020~0.064,偏保守。

### 5ad-f. 出貨的名冊(4 顆)與**沒出貨的三顆**

| 節點 | 刀 | warp | 不對稱(補完) | 面 | 判讀 |
|---|---|---|---|---|---|
| `rock/collapse_a` | union | 0.05 | x 0.184 → **0.003** | 938 → 918 | 缺角補起來;頂面多一道對稱鞍部 |
| `rock/facet_a` | union | 0(有 4 條邊界邊) | z 0.135 → **0.002** | 882 → 864 | 兩端多一道垂直裂溝 |
| `rock/mega_c` | union | 0.05 | z 0.131 → **0.014** | 274 → 268 | 同上 |
| `rock/mega_d` | half | 0(246 條邊界邊) | z 0.133 → **0.002** | 291 → 285 | **這一顆是明確的贏** —— 舊版整塊缺角 + 破洞,補完輪廓完整 |

- `rock/hoodoo_a`(0.167):**兩把刀都撐不住**(面 382→128 / 96)。根因在來源 —— 它是 §5m 的
  Hunyuan3D-2GP 產出,焊完 V=139 / F=382,閉合流形應該是 V=193 ⇒ 這顆網格本身就不是流形。
  正解是**重生成**這一顆,不是硬補。
- `building/chimney_a`(0.214):union 過不了元件閘(2→3),`half` 過閘**但黏土上是回歸** ——
  它變成一頂尖帳篷,更不像煙囪了(舊版本來就是一顆歪塊;`parts_manifest` 的 `source_gap`
  已經記過「出貨那顆的來源找不回來」)。同樣是**重生成**的活,這一輪不動它,`building.glb` 逐位元不變。
- `building/ac_a`(0.072)/ 其餘 7 顆岩節點:**在門檻之下 = 沒有空的那一面**,一格都不動。
- **樹族刻意不在這一輪**(使用者點名的是建築 / 巨岩 / 假山)。順手量到:`tree.glb` 30 顆裡有 10 顆
  過門檻(`canopy_f38`/`f5` 高達 **0.724**、`bl_wood_a` 0.449),但**冠層那一族的高不對稱不等於「空的」**
  —— 它們是**枝葉本來就疏密不均**,而且幾乎每顆都有數百條邊界邊(葉片是開放面片)⇒ 這把刀對它們
  多半會過不了 5ad-d 的閘。要不要做是另一輪的決定,數字在 `mesh_sym --gate` 隨時印得出來。
- `building/mass_a`:§5ac 已補(現值 asymZ 0.000 / symZ 0.000),這一輪不重跑。

⚠ **使用者要看的取捨**:4 顆裡 `mega_d` 是明確的贏;另外三顆是**交換** —— 空的那一面確實補滿了
(不對稱 0.13~0.18 → 0.003 以下),代價是接縫處多一道對稱的凹槽/鞍部。要收窄成「只補真的有破洞
的那幾顆」的話,把上表其餘三列從 `--rework` 拿掉重跑即可(工具是決定性的,重跑就回到舊版)。

### 5ad-g. 驗收

`intake_parts` **241**(外廓與預算逐位元不動 ⇒ 讀數與 §5ac 完全相同)/ `audit_siteplan` **197**
(`--break-shy` 3 條紅)/ `audit_beacons` **68**(`--break-extent` 1 條紅)/ `object_joints --seeds 8`
**21611 接合 / 0 異常** / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm run bal` 全綠(⑦f 不動)/ `npm test` 全綠(fresh server :8666)/ 3D 對照台 0 缺件 0 孤兒 0 未記載。
**反向驗證**:`--rework "hoodoo_a=z|0"` MUST 紅字「鏡射把面數打掉了(382 → 96)」;
`--rework "tower_a=auto|0|union"` MUST 紅字「炸成碎片(鬆散元件 1 → 14)」——兩條都實測會紅。

**未跑**:①真機冒煙(走到岩體旁邊繞一圈看四面)②`audit_traverse`(㋓ 需網路;**理由上不受影響** ——
巨岩的碰撞/佈局算式 MUST NOT 讀庫幾何(`megaGeo` 檔頭),而外廓這一輪逐位元還原)。

### 5ad-h. 一個副作用要記著

`mass_a` 是唯一帶 UV 的庫節點,而 `--base` 匯入再匯出會依 UV 接縫**重新拆頂點**
(8,523 → 8,565,+0.5%);形狀、面數(2,921)、外廓、UV 對應全都不變。這一輪最後沒有動
`building.glb`(chimney_a 退回),所以沒有落地;**下次任何要動 `building.glb` 的一輪,
這 42 個重複頂點會跟著出現,不是 bug**。

## 5ae. Trial log (2026-08-09, 3060-machine session — 建築續:`mass` 名冊補到 2 顆,而**語料才是那個「另一面是空的」的根因**)

> 使用者:「繼續處理建築」。§5ab-f 的未做清單第 2 條:名冊只有一顆 ⇒ 同一張圖上挑中的
> 十幾棟塔樓是**同一個剪影**(尺寸各異、形狀相同),而所有離線閘門全綠。

### 5ae-a. 「還有 3 張沒用過」是真的,但那 3 張裡有 2 張不是建築

§5ab-f 記著 `bld_tower` 還有 3 張語料。點開來看:`ov_fde797a7` 是柱廊矮量體(那一條記對了,
不適合這一桶),而 **`ov_6588f838` / `ov_6ca0f9f9` 是同一本 1932 年畢業紀念冊的封面與封底** ——
浮雕的裝飾藝術大樓 + 一條藍緞帶,另一張是空白卡紙背面。授權合法、位元是真的 JPEG、
`--plan` 一路顯示「這一列 4/4 抓夠了」。

兩個機制**同時**放它們進來,兩個都沒有錯誤訊息:

1. 供應者 `smithsonian_african_american_history_museum` **不在 `EXCLUDED_SOURCES`** 裡
   (清單有 8 個 Smithsonian 系,就差這一個)。⇒ 本輪補上。
2. Openverse 對這個源回不出尺寸 ⇒ 帳本記 `size_unknown` ⇒ 短邊 1024 那道閘
   **結構性地量不到**(`Math.min(it.w || Infinity, …)`)。這是**刻意的行為**(檔頭寫著
   「沒回的照收並標記」),但它與 ①的漏網合起來,正好讓純館藏掃描件無條件穿過兩道閘。

處置:`screen_mattes.py --family building --human reject <兩個 id>`(人眼判決恆勝統計,
且 id 留在 `seen` ⇒ 同一張垃圾不會被重新下載)。`have()` 因此掉到 2/8,`--plan` 才開始說實話。

**教訓寫成一條規矩**:`--plan` 的「抓夠了」只證明**下載成功**,不證明**內容對**;
一列語料在第一次真的要用之前,人眼那一關等於還沒跑。

### 5ae-b. 補抓 + 選片

`bld_tower` 的 `want` 4 → **8**,查詢從 3 句擴到 6 句、全部改成**具名的單一主體**
(`stepped skyscraper setback` / `brutalist concrete tower block` / `modernist office tower` /
`gothic revival skyscraper`)—— 舊的三句在 Openverse 只有個位數結果(`art deco skyscraper`
全庫 **6 筆**)。一輪抓到 3 張(第 4 張撞 `upload.wikimedia.org` 的 429,那是**本輪網路狀態**
不入帳):

| 候選 | 判讀 |
|---|---|
| **`ov_8811db29`(Fisher Building, Detroit)** | ◎ **採用** —— 藍天下的單一主體,裙樓/塔身/退縮/綠銅錐頂/尖塔**整棟都在畫面裡** |
| `wc_378871`(GE Building) | ○ 塔身好,但埋在整片天際線裡(去背要跟一排樓打架)⇒ 留給 mass_c |
| `ov_c343cdcb`(布魯托主義板樓) | ○ 同上,已 matte 未生成 |

順手修掉一個會**中途截斷批次**的坑:`matte_photos.py` 的進度行有 `✓`,而繁中 Windows
主控台預設 cp950 ⇒ 印到那個字元就 `UnicodeEncodeError` **整支中止**(實測跑到第 4 張才死,
前 3 張的產出留著、後面的沒有,回頭看目錄只覺得「怎麼少了幾張」)。修法一行 `reconfigure`。

### 5ae-c. 生成:**配方一個字都沒改**

T2-spz `1024_cascade` / steps 12 / seed 1234 / decimate 50 / tex 1024 ⇒
**117.0s**(sample 94.7 + decode 7.0 + glb 15.4)、torch 峰值 2,890 MiB、
raw 4,309,688 面 → 匯出 49,169 面(雙層薄殼:36,435 開放邊 / 2,910 元件 / v:f 0.93)。
跑批當下 avail RAM **19.7GB**,貼著 §5n 記的 20GB 門檻 —— 這一次沒有無聲死亡,但那條
警語照舊有效。**輸出目錄與檔名記進帳本的 `gen.out` 欄**(§5ab-a 立的新規矩的第一次兌現)。

實體化沿用 §5ab-b 定案的 `--cells 72 --offset 0.006 --target 2900`(建築上它是「濾掉立面
凹槽」的旋鈕),**未重新掃描** —— 同一族、同一種主體。結果比 mass_a 乾淨:

| | 面 | 開放邊 | 元件 | v:f | kf_p95 |
|---|---|---|---|---|---|
| `mass_a`(§5ab)| 2,900 | 16 | 6 | 0.50 | 0.95% |
| **`mass_b`** | **2,900** | **0** | **1** | 0.50 | 1.06% |

normalize 非等向 `0.5x0.5` + `--boxuv` ⇒ **2,900 面**(上限 2,981)、水平徑向 0.475、縱向 ±0.475。

### 5ae-d. 最有價值的發現:**mass_b 不需要鏡像貼補**

`mesh_sym`(§5ad 那把尺)量 `mass_b`:半空間面積不對稱 **x 0.004 / z 0.014** ——
遠在 `EMPTY_ASYM = 0.12` 之下,閘門一顆都沒點名。

對照 `mass_a` 鏡射**前**的 z 0.123。兩顆同一支模型、同一組參數、同一支實體化刀,
差別只有**語料**:mass_a 的來源是夜景**crown 的緊裁特寫**(只有兩個面被拍到),
mass_b 是藍天下的**整棟**。⇒ 「另一面是空的」不是 img→3D 的固有病,是**單張照片
只約束得到被拍到的那幾面**這件事的直接後果。**上游修語料,勝過下游動刀**:
§5ad 那把刀是既有節點的補救(而它在圓渾岩體上只能換到一個交換),
新節點該做的是**挑一張把整棟拍進去的照片**。選片準則因此多一條:
**這一桶要的是「整棟入鏡」,不是「最好看的局部」**。

### 5ae-e. 兩份會靜默過期的手寫清單(名冊一擴充就中招)

`shot_scene.mjs` 裡有兩處手寫節點清單,名冊補到第 2 顆時**兩處都還只認得 `mass_a`**:
①「載到幾顆」讀數(那是「庫到底載到沒」的唯一證據);②`mass_near` 機位的認人
(挑中 `mass_b` 的那幾棟拍不到,而畫面上只表現成「這張圖好像沒換到庫節點」)。
這與 runbook 記過的 `% 3` 輪替除數是**同一個坑**:檔案在、intake 綠、而工具永遠看不到新節點。

修法 = 新增讀取縫 **`partlib.js libNames()`**(這一次真的載進來的節點名,唯讀快照):
讀數改由它推導(shibuya 實測 **46 顆**),機位改認**整個 `building/mass_*` 家族**。
`libNames()` **只給離線量測/出圖工具用** —— 遊戲路徑一律走 `libGeo(具名節點)`,
MUST NOT 拿它枚舉「有什麼就畫什麼」(那會讓畫面隨 GLB 內容漂移,而零件表才是真相)。

### 5ae-f. 驗收

`intake_parts` **245**(+4:mass_b 的三條外廓 + 一條預算,2,900 ≤ 2,981)/
`audit_siteplan` **197**(`--break-mass` **3 條紅**)/ `object_joints --seeds 8` 21611-0 /
`beacons` 68 / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm run bal` 全綠 / `npm test` 全綠(fresh server :8668)/ 3D 對照台 0 缺件 0 孤兒
**0 未記載來源**(mass_b 的帳含 `gen.out`)/ 定場圖 `shot_scene --venue shibuya --live`
的 `mass_near`:畫面上**同時看得到兩種剪影** —— 階梯方塔(mass_a)與細塔身 + 尖頂(mass_b),
兩者的立面窗格都在(盒投影 UV 正常)。

**draw call 不隨名冊長度增加**:挑中的棟數上限仍是 `pick_n = 16`,每一棟最多落進一個
mesh ⇒ 額外 mesh ≤ 16(§5aa 的推導不受影響);分到哪一顆由**位置雜湊** `djAt` 決定,
零 `rnd()` 消耗。

### 5ae-g. 未做

1. **真機冒煙**(§5ab-f 第 1 條仍在):夜間立面會不會亮、貼著塔走一圈的碰撞。
2. **`building/chimney_a` 仍待重生成**(§5ad-f:鏡像兩把刀都不適用,而它的來源在
   `post.source_gap` 已記「找不回來」)。`chimney` 那一列語料同樣該重抓。
3. `measure_building_tris` 的 A/B **這一輪不適用**(改動本來就會換掉一半塔樓的幾何,
   逐位元不變不是這一輪的判準);預算那一面由 intake 的 2,981 與上面的 draw call 上界擋住。
4. mass_c(GE Building / 布魯托主義板樓,兩張都已 matte)。

## 5af. Trial log (2026-08-09, 3060-machine session — 冒煙那一項終於跑得動了,而它一跑就發現**整條建築線在 main 上是死碼**)

> 使用者:「繼續 ai3d_runbook.md」。未做清單連三輪(§5ab-f / §5ad-g / §5ae-g)的第 1 條都是
> **真機冒煙**,而它一直沒跑的原因與 §5z-t 記的一模一樣:**兩支工具各缺一半**。
> 這一輪先把工具補齊,然後那項冒煙立刻回報了一件比它自己更重要的事。

### 5af-a. 為什麼「夜間立面」三輪都沒人跑得動 —— `cfg.env` 是寫死的

`shot_scene.mjs` 從第一天起就寫著 `cfg.env = { season:'summer', time:'day', weather:'clear' }`。
而 `biomes.js` 的夜間旗標是 `cfg.env?.time === 'night'`(:6953),立面的 `emissiveMap` 只在
夜裡點亮(:7718)⇒ **沒有任何離線工具畫過夜景**。這正好是整棟量體節點唯一真正要驗的東西:
它是**唯一吃立面貼圖**的庫節點,盒投影 UV 一錯,白天看到的只是「一塊有 tint 的板」、
**夜裡才看得出是一塊沒有窗的板**(§5ab-c 那條材質契約就是為這件事立的)。

⇒ 補 `--time / --season / --weather` 透傳(非預設值進檔名後綴,免得日夜兩輪互相覆寫)。
**合法值當場驗、打錯就停**:`environment.js` 是 `TIMES[env?.time] || TIMES.day`、`biomes.js` 是
`=== 'night'` ⇒ 打成 `--time nigth` 會拍出一組**白天**的圖,而每一行讀數都正常 —— 與 §5z-t
那個 `--ink=0` no-op 是同一種失效(旗標沒作用,而畫面看起來完全合理)。

### 5af-b. 冒煙的第一個回合:**站不出來的那 15 棟**

補完旗標跑 `shot_scene --venue shibuya --live --time night`,夜景是對的(程序方盒的窗格
一格一格亮著),但 **`mass_near` 那張機位整個不見了**。換 manhattan 再跑一次,還是不見。
前一天 §5ae 明明量到 shibuya 挑中 13 棟。

先補讀數(**機位消失 MUST 講得出原因**,否則分不出「挑不到」與「認錯人」——兩者都不報錯),
答案是 `整棟量體挑中 0 棟`。往上追:

| commit | `OVER.bldCap` | `MASS.MIN_H` |
|---|---|---|
| `7135050`(PR #170 = §5aa~§5ae 整條建築線)| **170** | 55 |
| `f94515f`(PR #169 = 世界高度上限)| **`objHeightMax()` = 2 × 26 = 52** | (那支沒有這一段)|
| `8ddee35`(main,兩者合併後)| **52** | **55** |

兩個 PR **改的不是同幾行**,git 合得乾乾淨淨;壞掉的是**組合**:所有建物高度都夾 52m,
於是 `generic.filter(b => b.commercial && b.h > 55)` **結構性地永遠是空的**。
同一刀還砍掉三件更早的東西 —— 退縮頂塔(`b.h > 55`)、第二層退縮(`b.h > 100`)、
屋頂天線(`b.h > 60`)。**天際線的「婚禮蛋糕」剪影整個消失,而沒有任何東西會說**:
`intake_parts` 245 綠(它驗 GLB,不驗「這顆有沒有被擺出去」)、`audit_siteplan` 197 綠
且 `--break-mass` 照樣紅(它驗 pick_n 與預算同一份、驗保險絲、驗色抖序 —— 就是沒驗
「門檻構不構得到」)、3D 對照台 0 孤兒(名冊有引用)、`npm test` / `npm run bal` 全綠
(那兩支不模型化地物)。**兩輪 img→3D 的產出(`mass_a` 2,921 + `mass_b` 2,900 tris)
在 main 上一顆都沒有被擺出去過。**

### 5af-c. 定案與守門線

使用者定案**提高物件高度上限**(而不是把門檻改成推導值)⇒ `OBJ_F 2 → 4`(52 → **104m**)。
連帶**兩個係數都要動,而第二個使用者沒點名**:
- `CEIL_PEAK_F 2.5 → 4.5` —— `CEIL_PEAK_F > OBJ_F` 是「物件恆構不到天花板」的**結構保證**;
- `CEIL_AVG_F 4 → 6` —— 地表恆 ≤ 最高海拔 ⇒ **平均項的係數不大於峰頂項的話,平坦市區
  那一項永遠贏不了**,§WORLD_H ③ 的「取 max 的兩端各自勝出」當場退化成單一項。
  稽核 Ⅰ 因此多一條把這個前提明寫出來(舊制 4 > 2.5 剛好成立,所以從來沒人注意到它是前提)。

**守門線 = 稽核 Ⅲ 新增一條**:吃建物高度的門檻 MUST 全部 < `objHeightMax()`。
門檻**從 `biomes.js` 原文抽**(`b.h > N` 逐條 + `MIN_H: N`),不是手抄 —— 之後有人再加一條
自動跟著驗。反向驗證新旗標 `--break-cap`(把上限調回 2 倍)⇒ 紅字並**逐一列出構不到的
55 / 60 / 100m**;既有的 `--break-obj` 咬不到這一條(它是把上限往**上**推)。

### 5af-d. 冒煙結果(三輪未做的那一條,這次真的跑了)

**①夜間立面 —— 通過。** 上限抬高後 shibuya 挑中 **15~16 棟**,`mass_near_night` 上兩顆庫節點
(`mass_a` 階梯方塔 / `mass_b` 細塔身 + 尖頂)的**窗格與旁邊的程序方盒一樣亮著橘光**
⇒ 盒投影 UV 契約成立,不是「一塊沒有窗的純色板」。同一張圖上兩種剪影都在(§5ae 的
名冊擴充在夜裡照樣成立),挑中的那幾棟頭上也沒有浮在半空的附件(§5ab-c 的修法還在)。

**②岩體四面 —— 通過。** 新機位 `mega_orbit_{0,90,180,270}`:**繞相機、不轉模型**
(§5ac-e 那次「多視角其實是同一個視角」的 `ry` no-op,結構上不可能重蹈)。
shibuya 拍到 `rock/tower_a`(r 28.6m / h 43.5m),四面都是實心的,裙錐與平頂完整。

**③碰撞 —— 量,不用走的。** `intake` 的外廓讀數就是答案:`mass_a`/`mass_b` 水平徑向
**0.475**、縱向 **±0.47**,而權威有向盒是單位盒的 ±0.5 ⇒ 看得見的量體**恆收在碰撞柱之內**
(方向是對的:永遠不會「看得穿卻走不進」)。代價是「被空氣擋住」最多 2.5% 寬 / 3% 高 ——
上限抬到 104m 之後**絕對值跟著翻倍**(最壞約 3.1m)。這不是這一輪引入的,而是「有造型的
節點裝進方盒碰撞柱」的**固有**取捨(退縮與尖頂造成的落差比它大一個量級),而 A30 不准動
碰撞柱(那是與伺服器共用的權威幾何)⇒ **記錄,不修**。

### 5af-e. 順手修掉兩個「讀數正常但拍錯東西」的坑

1. **機位是在第一次 render 之前算的**,而 three 的 `matrixWorld` 要等 render 才更新 ⇒
   `Box3.setFromObject` 讀到的是舊矩陣。補 `scene.updateMatrixWorld(true)`。
2. **頂點數相同不保證是單獨一顆**:合併過的桶偶爾撞上同一個數字,而它的包圍盒橫跨整張圖
   (實測 shibuya 某一局「外接半徑 733.5m、高 39.5m」⇒ 四台相機被擺到 1.4km 外拍空氣,
   而每一行讀數都正常)。門檻吃**權威常數** `objHeightMax() × 2`,擋掉幾顆一律印出來。
   **這不是罕見案例** —— 正常門檻下 taroko 那一局就擋掉 1 顆。

### 5af-f. 驗收

`audit_world_height` **49**(47 + 2 條新斷言)/ `intake_parts` 245 / `audit_siteplan` **197**
(`--break-mass` 3 條紅)/ `audit_beacons` 68(`--break-extent` 1 紅)/ `object_joints --seeds 8`
**21611 接合 0 異常** / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm test` 全綠(fresh server :8670)/ `npm run bal` 全綠且**逐項與 §5ae 逐位元相同**
(⑦f 1.78×、交付率 89.2 / 92.0 / 51.8 —— WORLD_H 不進平衡模型)。
**反向驗證**:`--break-cap` ⇒ Ⅲ 紅並列出 55 / 60 / 100m;`--break-obj` ⇒ Ⅱ 紅 2 條;
`--break-ceil` ⇒ Ⅰ・Ⅱ 紅 6 條。

**`audit_traverse`(㋓)93 過 / 19 敗 —— 敗數與改動前(§5ab 記的 96-19)相同,而且是同一組。**
這一項在本輪特別重要:門檻活過來 ⇒ `b.h > 55` 那幾行的 `rnd()` **重新被消耗** ⇒ 共享亂數序列
往後推移 ⇒ **全圖地物佈局重排**,街廓夾出來的通道寬等於整組換過一次(不是跨客戶端分歧,
是與上一版不同的一張圖)。逐條對回既有基線的四個成因,**一條新的都沒有**
(過關數 96 → 93 是逐局圖資可用性的浮動,同一支歷來 89 ~ 96 都出現過):

| 類別 | 筆數 | 場地 | 成因(既有,全是稽核端) |
|---|---|---|---|
| 航點不可達 | 10 | shibuya・manhattan・paris・yosemite・venice・civicblvd・roppongi・taroko・london・chicago | 全是「橋面中段 / 地下道引道 / 隧道洞口」⇒ 泛洪 `visited` 鍵漏 `sid` + `buildStructs` 沒鏡射 `chainWays` 與邊界裁切 |
| 橋下淨空 | 9 | shibuya 0.75m・giza 1.98/3.13・civicblvd 1.99/2.08/3.74・roppongi **0.45**/2.91・london 3.84 | 斷言與 `deckAt` 刻意的貼地夾制矛盾(`ROAD_LIFT = 0.45`;roppongi 那一筆**逐位元就是它** = 這組紅字仍是原班人馬的指紋)|

⚠ 兩件事要記著:①**第一次跑時把輸出接到 `tail -25`**,19 條紅字全部捲掉只剩總計 —— 重跑才拿得到
名單(這一支要 30 分鐘,別接管線);②收尾的 exit code 1 是那 19 條,不是工具壞了。

### 5af-g. 未做

1. **`building/chimney_a` 重生成**(§5ae-g 第 2 條原封不動)+ `chimney` 那一列語料重抓。
2. **mass_c**(GE Building / 布魯托主義板樓;⚠ §5ae 補抓的那 3 張**連同 photo-DB superset 一起沒了**,
   要重抓 —— 見下面第 4 條的語料現況)。
3. **`rock/hoodoo_a` 重生成**(§5ad-f:兩把鏡像刀都撐不住,根因是 2GP 那顆網格本身不是流形)。
   ⚠ **T2-spz 這一輪跑不動**:它要 ≥20GB avail RAM 才載得進來(§5n),而本輪機器只有 15.1/31.7GB
   (要跑得先請使用者關掉 Chrome / Discord / Spotify / Steam)。
4. **⚠ 語料現況(2026-08-09 覆核,推翻 §5ae 結尾那句)**:`self-buff-support-scaling-866a87`
   **worktree 已經不存在**,§5p 搬過去的 305 筆 superset 連同 §5ae 剛抓的 3 張一起沒了。
   全機器只剩兩份、都在 worktree 裡:`reverent-pascal-fcd63e`(533MB,manifest 2026-08-06;
   building 22 / rock 16 / tree 22 / landmark 4)與 `zen-albattani-b33990`(279MB,更舊)。
   **上面第 1、3 條要的語料還在**(`photos/building/chimney` 5 張、`photos/rock/hoodoo` 6 張 ——
   含出貨那顆的來源 `wc_112762573`);第 2 條的要重抓。
5. 真人在遊戲裡走一圈(本輪的「冒煙」仍是離線截圖 + 量測,不是真的操控機體貼著塔繞)。

## 5ag. Trial log (2026-08-09, 3060-machine session — 掛了兩輪的 `chimney_a` 重生成:**換模型不換語料**,而 hoodoo 判退)

> 使用者:「繼續」。§5af-g 的第 1、3 條(`chimney_a` / `hoodoo_a` 重生成)—— §5af 記的 RAM
> 障礙自己解除了(15.1 → **23.0GB avail**),T2-spz 載得進來,兩顆一起試。

### 5ag-a. 先看照片:兩族的語料庫裡**都躺著比出貨版更好的一張**

`screen_mattes` 那一輪的紀律(**先看照片再看網格**)這次直接決定了結果。把兩族既有的 matte
攤成 contact sheet 人眼分桶:

| 族 | 出貨版用的那一張 | 判讀 |
|---|---|---|
| chimney | `ov_551789bb` | 磚砌工業煙囪,**仰角極陡、基座出框**。「一顆歪塊」的成因寫在照片上 |
| hoodoo | `wc_112762573` | **主體只佔畫面約 15%、alpha 糊成一片**(= §F0 的「剝空/主體太小」桶)。T2 以 alpha>204 取 bbox ⇒ 餵進去的是一小塊 |

另外找到的候選:chimney 有一張 `ov_7f8d8e91`(三連磚煙囪,**平視、整組入鏡、白背景**)、
hoodoo 有一張 `ov_929bc3d9`(**乾淨單體:帽岩 + 細頸 + 基座,去背俐落**)。
兩張都完全符合 §5ae-d 立的「整棟/整株入鏡」準則 ⇒ 直覺上都該勝出。**實測兩張都判退。**

### 5ag-b. 三注一起跑(1024_cascade / steps 12 / seed 1234,配方一字未改)

| 餵入 | raw 面 | 實體化後(`--cells 72 --offset 0.006`)| 判讀 |
|---|---|---|---|
| chimney `ov_551789bb`(**舊語料**)| 2.00M → 48,316 | **270 面 / 0 開放邊 / 2 元件 / watertight / kf_p95 0.72%** | ◎ 採用 |
| chimney `ov_7f8d8e91`(三連)| 3.55M → 49,762 | 270 面 / 0 開放邊 / **6 元件** | ✗ 黏土上碎成一塊平台加兩根樁 |
| hoodoo `ov_929bc3d9` | 2.15M → 48,517 | 500 面 / 0 開放邊 / 1 元件 / kf_p95 0.98% | **✗ 讀數漂亮而黏土是浮雕板** |

**跑批當下 `ram_avail` 掉到 3.3GB** —— §5n 那條「≥20GB 才載得進來」的門檻是真的在用,不是餘裕。

### 5ag-c. hoodoo 判退:**讀數全綠而形狀是錯的**,只有黏土看得出來

新版 hoodoo 的每一個數字都比舊版好(0 開放邊、單元件、kf_p95 0.98%),而四面黏土一擺出來
就結束了:**舊版是帽岩 + 細頸 + 基座的立體團塊,新版是一片薄板**(正面寬、側面剩一條)。
單張照片只約束得到被拍到的那一面,而 hoodoo 的辨識特徵**恰好全在剪影上** ⇒ 模型沒有理由
給它厚度。這與 §5ab-b 的「表面偏差量不出撕裂」是同一句話的另一面:**幾何品質指標量不出
「這個形狀對不對」**。

⇒ **`rock/hoodoo_a` 這一輪不動**,`rock.glb` 逐位元不變。§5ad-f 說「正解是重生成」是對的,
但**重生成 MUST 走階梯上對的那一階**:`T2-spz(建築/規則幾何)→ 2GP(實心岩體)→ SF3D → procedural`
—— hoodoo 是實心岩體,而它現在這顆本來就是 2GP 出的。要重生成得回 WSL2 跑 2GP(換語料到
`ov_929bc3d9` 仍值得試,**但要換的是那一階,不是那一張**)。拿 T2 去換,是把階梯走反。

### 5ag-d. chimney 採用:**同一張照片、換模型**,而「另一面是空的」自己消失了

| | 面 | 邊界邊 | 元件 | 半空間不對稱 | 水平徑向 / 縱向 |
|---|---|---|---|---|---|
| 舊(SF3D,2026-08-06)| 234 → 217 | **189** | 2 | **0.214** | 0.570 / ±0.475 |
| 新(T2-spz,本輪)| **216** | **0** | 2 | **0.053** | 0.570 / ±0.475 |

黏土四面:舊版是**帶裂縫的歪塊**(189 條邊界邊在圖上就是那些裂口),新版是**方形斷面 +
階狀收分的磚煙囪**,四面讀起來是同一個東西。

三件事值得記著:
1. **外廓逐位元相同**(0.570 / ±0.475)⇒ 消費端的 `S=(w,h,w)` 與碰撞語意一格不動,
   這一顆是純粹的「同名取代」。
2. **不對稱 0.214 → 0.053,掉到 `EMPTY_ASYM = 0.12` 之下** ⇒ §5ad-f 把它列為「兩把鏡像刀
   都不適用」的那個問題,**重生成之後不存在了**。這是 §5ae-d「上游修勝過下游動刀」的第二次
   兌現,只是這次修的是**模型**不是語料 —— 而 §5ad 那把刀當初正是為了救這一顆才被逼出來的。
3. **三連煙囪那張輸給仰拍那張**,與 §5ae-d 的準則表面上矛盾:「整組入鏡」在那裡是對的,
   在這裡卻碎成 6 元件。差別是**主體數**:mass 那一桶要的是**一棟**,而三連煙囪是**三根柱子
   加一塊底座**,222 面的預算分不出三根柱子。⇒ 準則要補一句:**「整體入鏡」的前提是主體只有一個**;
   多主體的照片在低預算節點上會碎,而碎法是元件數,不是面數。

### 5ag-e. 驗收

`intake_parts` **245**(chimney_a 216 ≤ 222;外廓三條與舊版逐位元相同)/ `mesh_sym --gate`
名冊 16 → **15 顆**(chimney_a 退出)/ `audit_siteplan` **197**(`--break-mass` 3 紅)/
`audit_beacons` 68(`--break-extent` 1 紅)/ `object_joints --seeds 8` **21611 接合 0 異常** /
`world_height` 49 / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm test` 全綠(fresh server :8672)/ `npm run bal` 全綠 /
3D 對照台 **0 缺件 0 孤兒 0 未記載**(chimney_a 那一列已拆出獨立帳,method `trellis2_spz`、
含 `gen.out`)。`parts_manifest` 由 30 → 31 列(ac_a 與 chimney_a **拆列**,同 §5t 的 mesa_a)。

⚠ §5ad-h 記的副作用如期出現:`--base` 重新匯入匯出 `building.glb` 會依 UV 接縫重拆 `mass_a`
的頂點。形狀 / 面數 / 外廓 / UV 對應全部不變。

### 5ag-f. 未做

1. **`rock/hoodoo_a` 仍待重生成 —— 但要走 2GP(WSL2),不是 T2**(理由見 5ag-c)。
   語料建議用 `ov_929bc3d9`(乾淨單體)而不是出貨版那張糊掉的。
2. **mass_c** 與 chimney 那一列的語料補抓(§5af-g 第 2、4 條原封不動)。
3. 真人在遊戲裡看一眼新煙囪(離線黏土與 intake 都過了,但屋頂配件在對局距離長什麼樣沒看過)。

## 5ah. Trial log (2026-08-09, 3060-machine session — `hoodoo_a` 終於換掉:**語料與後處理要一起換**;同輪落地使用者的兩條選片/配比定案)

> 使用者:「繼續 ai3d_runbook.md」⇒ §5ag-f 第 1 條(掛了三輪的 `rock/hoodoo_a` 重生成)。
> 中途使用者追加兩條定案:「**挑選的照片盡可能乾淨,只有目標物件無其他物件,且光源充足**」
> 與「**建築照片 50% 一般市區、25% 鄉村或觀光旅宿、25% 功能型(寺廟/教堂/醫院/車站/學校/
> 博物館/公家機構)**」。

### 5ah-a. 先把「重生成」這個處方拆開:出問題的**不只是**那張照片

§5ad-f 記的病灶是「這顆網格本身不是流形(焊完 V=139 / F=382,閉合流形應為 193)⇒ 鏡像刀
把面數打成 128/96」,處方是「重生成」。本輪第一件事是去看**原始輸出**還在不在 ——
`~/ai3d/out_hy/wc_112762573_raw.glb` 還在,而它的讀數是:

```
213,682 面 / 106,789 點 / 開放邊 0 / 元件 1 / watertight True
```

**2GP 的原生輸出一直都是水密的**。非流形是**後處理**做出來的:出貨那顆走的是
`hy3dgen FaceReducer(pymeshlab quadric)213,682 → 560` + Blender `560 → 382`,
而 quadric 在 380:1 這種比例上會把邊塌成非流形。⇒ 這一條的正解不是(只是)換照片,
是**把後處理換成 §5o/§5t 之後才有的那條路**:`solidify_parts.py --mode resample`
(體積重採樣 → quadric)。實測同一顆 raw:

| 後處理 | 面 | 焊點 | 開放邊 | 元件 | 水密 | kf_p95 |
|---|---|---|---|---|---|---|
| 舊(FaceReducer + Blender)| 382 | **139** | 0 | 1 | — | 未量 |
| 新(solidify c192/o0.004)| 382 | **192** | 0 | 1 | **True** | 1.01% |

閉合流形的理論值是 `F/2 + 2 = 193`。**這是一條會靜默傳染的路**:凡是走舊兩段式
quadric 出貨的節點都有同樣風險,而 `mesh_sym` 的「邊界邊 0」對它完全無感
(非流形不是破洞)—— 只有真的去動刀才會現形。現役 `hunyuan_2gp` 只有這一顆。

### 5ah-b. 但**只換後處理不夠** —— 黏土說話

換完後處理的那一顆:asymZ 0.167 → **0.189**、asymX 0.018 → **0.126**(兩軸都跨過
`EMPTY_ASYM`),而四面黏土上仍是 §5ag-a 講的那個東西:**一坨大團塊頂著一根小角**。
原因寫在照片上(§5ag-a 已記):`wc_112762573` 的主體只佔畫面約 15%,而 2GP 忠實地把
**底下那面崖壁**一起生了出來。

於是把 §5ag-c 的建議真的執行掉:**同一階(2GP),換語料**。`ov_929bc3d9`(Kent G. Budge,
CC0)原圖是三顆蘑菇岩 + 電線桿的坡地照 —— 髒,但**去背之後只剩一顆**(main 0.984)。
61.6s / torch 峰值 2,524 MiB(與 §5m 逐位元同一組讀數),raw 225,518 面 watertight 單元件。

| | 面 | 焊點 | 開放邊 | 元件 | 水密 | asymX / asymZ |
|---|---|---|---|---|---|---|
| 舊(出貨版)| 382 | 139 | 0 | 1 | — | 0.018 / 0.167 |
| 新語料 + 新後處理 | 382 | **193** | 0 | 1 | **True** | 0.159 / 0.028 |

**焊點恰好 193 = 閉合流形的理論值。** 黏土四面是一根**層理石柱頂著過寬帽岩、底下一圈裙狀
基座** —— 正是消費端 `synthMegalith` 那一行註解寫的「風化蘑菇岩群:細腰石柱頂著過寬帽岩」。
舊版是「團塊 + 角」,新版是蘑菇岩。

**外廓與面數逐位元相同**(水平徑向 0.950 / 縱向 ±0.950 / 382 面)⇒ 消費端的
`scale(r×1.5, h×0.55, r×1.5)` 與 `RX/RZ` 碰撞語意一格不動,純粹同名取代。

⚠ **`--node` 的目標欄 MUST 維持非等向 `1x1`**:中途一度寫成等比(`1`),外廓當場變成
徑向 0.5997 / 縱向 0.950 —— 契約仍過(下界是包絡的一半),但消費端的碰撞半徑吃的是
`r*1.5`(= 節點徑向 1.0 的位置)⇒ 整柱會比碰撞柱細 37%,而**所有離線閘門全綠**。
`1x1` 是「兩軸各自拉滿 ico(1) 包絡」,舊版就是這麼縮的。

### 5ah-c. 鏡像刀:這次**跑得動了**,而它的結果**該退**

§5ad-f 說 hoodoo_a「兩把刀都撐不住」。網格變流形之後,`union` 刀在**第一顆候選**
(舊語料 + 新後處理)上跑得乾乾淨淨:`382 → 374 面 / 邊界邊 0 → 0 / 元件 1 → 1 / 外廓逐位元還原`
—— 三道閘全過(對比 §5ad-f 的 382 → 128)。**所以那道閘從頭到尾沒有錯,它擋的是上游的爛網格。**

但黏土否決了它:z 軸聯集把**頸部**做成兩根叉開的柱子中間一個洞(第 2、4 個視角看得最清楚)。
而頸部正是 hoodoo 的辨識特徵。第二顆候選(新語料)更直接 —— `auto` 選 x 軸(0.159),
union **元件 1 → 3**、half **元件 1 → 2**,兩把刀都被 §5ad-d 的閘當場擋下。

⇒ **hoodoo_a 出貨不做鏡像貼補**,它會留在 `mesh_sym --gate` 的名單上(x 0.159)。
那個 0.159 不是「空的一面」,是**石柱本身歪 + 帽岩偏心**的天然形狀。這是這一族第一次
出現「刀能跑、閘也過、但形狀退步」與「刀跑不動」分屬兩回事的案例;§5ad-f 的那一行
(「兩把刀都撐不住 ⇒ 該重生成」)**因果講反了**:撐不住的原因在網格,而該重生成的原因在照片。

### 5ah-d. 使用者定案 ①:選片標準 = 乾淨單一主體 + 光源充足

落點是**兩支工具各一半**,而且要講清楚哪一半在哪裡:

- `fetch_photos.mjs`(下載**之前**):能驗的只有授權與尺寸;**唯一能影響「乾淨/單一主體」的
  旋鈕是查詢用字**(skill §2 量過的最大槓桿)⇒ 檔頭改寫成使用者這句話,規則仍是「具名單一主體」。
- `screen_mattes.py`(去背**之後**):「畫面裡有幾個東西」「光夠不夠」要看 matte 才量得到
  ⇒ 新增兩桶,門檻拿**已經出貨的 25 張來源**當真品名單校準(F0 那份人眼名單住在已被刪掉的
  worktree,而「出貨過」是更硬的標籤):

| 桶 | 判據 | 已出貨的極值 | 定案門檻 | 淘汰 |
|---|---|---|---|---|
| ④ 多主體 | matte 最大連通元件**面積**佔比 `main` | 最低 0.778 | `< 0.70` | 28 / 244 |
| ⑤ 光源不足 | 主體平均亮度 `lum` **且** 暗部佔比 `dark` | lum 43.5 / dark 0.632 | `lum < 35 ∧ dark ≥ 0.70` | 13 / 244 |

兩桶**零誤殺**。反向掃描把邊界量出來了:`MULTI_MAIN` 一調到 0.778 就開始誤殺
(landmark/tank `ov_6d02b9e0` —— 桁架水塔的腿會被切成好幾塊,那是**一個**主體的碎片);
`LUM_MIN 50 / DARK_FRAC 0.60` 開始誤殺 `wc_133471453`(暗色針葉)。

三個設計決定:
1. **量在 matte 不是照片上**。本輪的贏家 `ov_929bc3d9` 原圖有三顆蘑菇岩加電線桿,去背只剩一顆
   ⇒ **照片髒不等於輸入髒**。反過來也成立(§5ag-b 的三連煙囪:照片乾淨,而三個主體在 222 面的
   預算下碎成 6 元件)。
2. **取面積佔比不取塊數**。已出貨的水塔有 4 塊(腿),而「三顆蘑菇岩」是 0.35 —— 數塊數把兩者
   判成同一類,面積佔比分得開。
3. **統計分不開的一帶不淘汰,進觀察名單 sheet**(`*_screen_watch.png`,格子標上 main/lum/fill/cov)。
   本輪的實例:熱氣球那張 `main 0.760` vs 已出貨水塔 `0.778` —— 把門檻收到 0.77 去「剛好」抓到
   熱氣球就是拿兩個樣本過擬合。**人眼那一步不是懶惰,是這裡真的沒有便宜的統計特徵**(檔頭原有的
   doctrine,本輪第二次兌現)。

### 5ah-e. 順手撞到的:**既有的兩道閘是「樹形狀」的**,套到別族會吃掉真品

把選片閘第一次跑遍四族(F0 只跑過 tree)就出事:

| 閘 | 為什麼是樹形狀 | 套到別族的誤殺 |
|---|---|---|
| ① `BLANK_COV = 0.05`(畫布覆蓋率)| 樹是密實團塊 | landmark/tank `ov_6d02b9e0` 0.024・`ov_15922084` 0.092・rock/mg_tower `ov_163a0902` 0.034(**魔鬼塔那顆**)|
| ② `PRINT_FILL = 0.85`(bbox 填滿率 = 「主體是一張紙」)| 前提是主體留得下輪廓縫,而**建物就是個方盒** | building/roofcap `ov_f18913fc` 0.909 |

⇒ 兩條收成 `TREE_CAL_FAMS`(只在校準過的族當淘汰線);② 另給別族一條實測校準的
`PRINT_FILL_OTHER = 0.93`(建物已出貨最高 0.909,零誤殺)。**MUST NOT 直接放棄那兩條** ——
它們抓的東西在別族一樣存在(1932 年畢業紀念冊封面 fill 0.854、舊 hoodoo 那張 cov 0.016)
⇒ 在非校準族**降級成觀察線**,人眼看得到而不是被統計悄悄吃掉、也不是悄悄放過。
tree 族的三桶讀數 **27 / 10 / 3 與 F0 逐位元相同**(那三條一格沒動)。

⚠ 留一筆**未解**:tree/canopy `ov_71b76588` 是已出貨來源,而它的 matte cov = **0.001**
(幾乎全空)⇒ 被 tree 自己那條 ① 淘汰。F0 的校準基準是「人眼判可用的 16 張」、本輪是
「出貨過的 25 張」,兩份標籤在這一張上不一致。**刻意不動 `BLANK_COV`**(不為一個反例
放寬一條校準過的門檻);要嘛那顆節點當初不是用這張 matte 生的,要嘛 matte 後來重生過 ——
下一輪碰 tree 族時查。

### 5ah-f. 使用者定案 ②:建築語料 50 / 25 / 25

配比只約束**整棟建物**(新的 `grp` 欄),窗格/簷口/冷氣機/屋頂水塔那些是**零件**不是建物 ——
把它們算進分母,50% 就會隨「這一輪加了幾個零件列」浮動,而那與使用者說的那句話無關。

| 組 | 列 | 配額 |
|---|---|---|
| `urban` 一般市區 | tower 9・office 6・apartment 6・corner 5・rowhouse 5・shophouse 4・warehouse 5 | **40 / 80 = 50.0%** |
| `rural` 鄉村或觀光旅宿 | inn 3・barn 2・windmill 2・chalet 2・minka 2・hanok 2・medit 2・stonecottage 2・halftimber 1・adobe 1・yurt 1 | **20 / 80 = 25.0%** |
| `civic` 功能型 | temple 3・church 3・station 3・school 3・museum 2・civic 2・hospital 2・pagoda 1・lighthouse 1 | **20 / 80 = 25.0%** |

新增 12 列(office/apartment/corner/inn/temple/station/school/museum/civic/hospital + 既有列重分組),
舊的區域風格列**一列都沒刪**,只把 `want` 降下來 —— 刪列會讓已經抓到的照片變成沒人認領的孤兒,
而降 `want` 只是「不再補」(第 6 輪的跨國風格廣度因此原樣保留)。

**配比是驗出來的不是註解**:`buildingMix()` 逐列現算,`--plan` 印「目標 vs 現有」兩欄,
`buildingMixDrift()` 在每次抓取**之前**擋下偏離(反向驗證:把 `bld_tower.want` 改成 30 ⇒
`urban 60.4%` 紅字)。手寫在註解裡的比例會在下一次有人改某一列時**靜默過期**(同 §5ae-e
那兩份手寫清單),而照片是有配額成本的。

改制前(選片閘跑過四族之後的**可用**張數):`urban 6/42 = 14.3%`・`rural 26/42 = 61.9%`・
`civic 10/42 = 23.8%` —— 一般市區缺口 34 張,正是這條定案要補的那一塊。
第一輪補抓(`--home … --family building --limit 40`)下載 29 張後撞上
`upload.wikimedia.org` 的 IP 級 429 ⇒ `urban 22/66 = 33.3%`・`rural 28/66 = 42.4%`・
`civic 16/66 = 24.2%`。**這幾個數字算的是「下載成功」而不是「可用」** —— 新語料還沒 matte、
還沒過 ④⑤ 兩桶,那一步才會把分母修回真話(§5ah-i 第 1、2 條)。

### 5ah-g. 資料家改成參數(`--home`)

`fetch_photos.mjs` 與 `screen_mattes.py` 都把「資料家」綁在腳本自己的目錄上,而 §5af-g 已經
記過一次代價:一個 worktree 被刪掉,305 筆 superset 跟著沒了。兩支各加一個 `--home <資料家>`
(不給 = 舊行為逐位元不變);帳本的相對路徑基準同步改吃 `HOME`(否則一給 `--home` 就會寫進
`../../…` 這種跨 worktree 的路徑)。

### 5ah-h. 驗收

`intake_parts` **245**(hoodoo_a 382 ≤ 430;外廓三條與舊版逐位元相同)/ `mesh_sym --gate`
名單 15 顆(hoodoo_a 仍在,軸由 z 改 x)/ `audit_siteplan` **197**(`--break-shy` 3 紅)/
`audit_beacons` 68(`--break-extent` 1 紅)/ `object_joints --seeds 8` **21611 接合 0 異常** /
`world_height` 49 / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm test` **584 綠**(fresh server :8674;⚠ 埠不是 `PORT=` 而是 `WS_URL=ws://localhost:<port>`)/
`npm run bal` 全綠(⑦f 1.78×、交付率 89.2 / 92.0 / 51.8 —— 與 §5af/§5ag 逐項相同)。

**反向驗證**:選片閘 `MULTI_MAIN` 掃 0.60 / 0.70 / 0.778 / 0.80 / 0.90 ⇒ 0.778 起開始誤殺
已出貨來源;`LUM_MIN/DARK_FRAC` 掃 (35,0.70) / (45,0.70) / (50,0.60) ⇒ 最後一組起誤殺;
配比 `bld_tower.want = 30` ⇒ `buildingMixDrift` 紅字。

### 5ah-i. 未做

1. **建築語料只補到一半,而卡住的是「下載主機」不是「語料池」** —— 這一條量過了,別重新診斷:
   第一輪 29 張(`urban 14.3% → 33.3%`),之後三輪冷卻只再拿到 **1 / 0 / 1** 張,
   輸出裡滿版都是 `Commons 失敗(…):HTTP 429`,很容易讀成「CC0 沒料了 ⇒ 該改查詢用字」。
   **不是。** 直接打 Openverse 查(唯讀、不下載)量到的**未收且短邊 ≥1024** 的候選:

   | 查詢 | 未收 ≥1024 | | 查詢 | 未收 ≥1024 |
   |---|---|---|---|---|
   | `railway station building` | **18** | | `brick townhouse facade` | **10** |
   | `city hall building` | **18** | | `country inn building` | **8** |
   | `residential apartment block` | **8** | | `buddhist temple building` | **6** |
   | `curtain wall office building` | 5 | | `corner commercial building` | 3 |

   ⇒ 供給充足,綁住的是 `upload.wikimedia.org` 的 IP 級下載窗(大多數 Openverse CC0 命中
   都託管在那裡)。**症狀會誤導**:候選被 `hostCool` 跳過 ⇒ 該列當輪視同沒料 ⇒ 退到 Commons ⇒
   印出來的是一整排 Commons 429,而**真正的瓶頸從頭到尾是下載那一步**。
   對策只有「時間」:同指令每 ~11 分鐘重跑一輪,urban 還缺 17 張 ≈ 1~1.5 小時的無人值守滴流
   (`node tools/ai3d/fetch_photos.mjs --home <資料家> --family building --limit 40`)。
   **MUST NOT** 因為看到那排 429 就去放寬 CC0 / 1024px 兩道硬閘,或急著改查詢用字。
2. **新語料一張都還沒 matte**(新增 12 列 + 補抓的 29 張)⇒ ④⑤ 兩桶還沒看過它們,
   `--plan` 那兩欄現在算的是「下載成功」不是「可用」。順序是
   `matte_photos.py building` → `screen_mattes.py --home … --family building --sheet` → 看 watch sheet。
3. `mass_c`(§5af-g 第 2 條原封不動);新的 `bld_office`/`bld_apartment`/`bld_corner` 三列
   正是它的語料來源 ⇒ 兩件事現在合流了。
4. **`ov_71b76588` 的 cov 0.001 之謎**(§5ah-e 末)。
5. 真人在遊戲裡走到蘑菇岩旁邊繞一圈(本輪的「看」仍是離線黏土四面 + 讀數)。
6. `audit_traverse`(㋓ 需網路;**理由上不受影響** —— 巨岩碰撞與佈局算式 MUST NOT 讀庫幾何,
   而外廓這一輪逐位元還原、`rnd()` 消耗不變)。

## 5ai. Trial log (2026-08-09, 3060-machine session — 設計圖 → 3D:**這一段不是模型,是幾何**)

> 使用者:「**建築部分也加入設計圖轉 3D 的功能,轉 3D 時只要處理外層表面就好**」。

### 5ai-a. 為什麼它不該是「再接一個 img→3D 模型」

照片給的是「一個視角 + 明暗線索」,深度得**猜** —— §5ag-c 的 hoodoo 就是猜不出厚度而塌成
薄板,而讀數(0 開放邊 / 單元件 / kf_p95 0.98%)全綠。**設計圖給的是正投影的精確輪廓**:
立面 = 正面剪影、平面 = 足跡、側視 = 側面剪影。兩個以上的正交剪影決定的視覺外殼是
**解出來的**:

```
逐視圖取外輪廓 → 多邊形 → 各自沿自己那一軸拉伸成稜柱 → 稜柱取交集 = 外殼
```

⇒ 新工具 `tools/ai3d/plan_to_mesh.py`,方法鍵 `plan_hull`。**零 GPU、零權重、零亂數、
離線可驗**,下游與 img→3D 完全共用(`normalize_parts` → `intake_parts`)。
階梯因此多一階、而且排在最前面:**`設計圖 → plan_hull` ≫ `T2-spz` ≫ `2GP` ≫ `SF3D` ≫ `procedural`
—— 有設計圖就別去猜。**

### 5ai-b. 「只要處理外層表面」是兩件事,而它們剛好同一個實作

㋐ **只取最外層那條輪廓線**:設計圖裡滿是內部線條(窗格、樓層線、隔間、填充網點、尺寸線)。
   作法 = 取輪廓 → **整片填實** ⇒ 窗戶不會變成幾何凹洞、樓層線不會變成溝槽(那些是貼圖的事,
   消費端的立面材質本來就在畫窗格)。這同時是**三角形預算的主要旋鈕**:不填實的話一張立面圖
   光是窗格就能生出上千個面,而 `mass` 那一桶的逐節點上限是 2,981。
㋑ **只有外殼,沒有室內**:視覺外殼天生就是閉合的外表面,樓板/隔間/中庭一概不生成。

**這條規則在三處各擋一次**(填實 / `RETR_EXTERNAL` / `prism` 只吃 `poly.exterior`),
而這件事是**被反向驗證逼出來的**:只拆前兩處,第三處會把洞再吃掉一次 ⇒ 窗戶版仍然是
12 面盒 ⇒ **反向驗證假綠**。`--break-outer` 因此 MUST 三處一起拆(拆完紅 9 條)。

### 5ai-c. 三個「不會報錯只會給爛結果」的地方,全部量過

| # | 坑 | 症狀 | 對策 |
|---|---|---|---|
| ① | **每一張真的設計圖都有圖框** | 最直覺的寫法(從畫布邊界泛洪、淹不到的算實體)會被圖框整個框住 ⇒ 量到的外廓是**那張紙**不是那棟樓(合成實測寬度 0.6678 → **0.7366**,而網格看起來完全正常)| 改成「挑輪廓」:圖框只是另一個候選,`FRAME_MAX = 0.70` 淘汰它 —— 但**只有還剩得下候選時才淘汰**(建築佔滿整張紙是合法的)|
| ② | **渲染圖不是線稿** | 水彩/鉛筆渲染圖的墨是**調子**不是輪廓 ⇒ 門檻把陰影一起吃進來、剪影邊緣碎掉、亮處變成洞(實測那張穹頂教堂的玫瑰窗變成一個貫穿的洞)| 輪廓**內**的墨密度:CC0 六張實測 **HABS 測繪線稿 11.4% / 四張渲染圖 32~71%** ⇒ `LINEART_INK = 0.25` 硬擋 + `--allow-render` 顯式覆寫 |
| ③ | **輪廓有缺口** | 結果是**空網格**而不是錯網格 | `SOLID_MIN` 報錯並指向 `--close`;**順序 MUST 是「先驗缺口再驗渲染圖」** —— 反過來的話一條斷線的遮罩就是那條線本身、墨密度 100%,會報成「這是渲染圖」把人指到錯的方向 |

### 5ai-d. 實測:一張真的 HABS 測繪圖

`ov_dc769773`(Tudor Place 南立面測繪圖,CC0,7484×6000):圖框與標題欄被剔掉、
窗與線腳被填實、煙囪與山牆保留 ⇒ **160 面 / 82 點 / 單元件 / watertight**、輪廓 40 點、
墨密度 13.3%。遮罩圖(`--debug`)是一條乾淨的建築剪影。

⚠ 一個小殘留:圖上的**地坪線**與建築輪廓相連 ⇒ 剪影底部帶一條薄裙。對 massing 節點影響很小
(正規化會收進單位包絡),沒有為它加旋鈕 —— 加一個 `--crop-bottom` 只是把判斷交給手感。

### 5ai-e. **本輪零節點出貨,而理由是形狀不是品質**

管線通了,但 CC0 語料裡唯一那張乾淨線稿是**兩層樓的寬矮宅邸**(寬高比 3.6:1),
而目前唯一吃「整棟量體」的桶是 `BLD_LIB.mass` —— 它服務的是 **`b.h > 55m` 的商辦塔樓**,
而 `normalize_parts` 的非等向 fit 會把各軸**各自**拉滿包絡 ⇒ 一棟寬矮宅邸會被拉成一根
帶山牆與煙囪的高塔。**與其塞一顆形狀不對的進去,不如把缺口寫清楚**(同 §5ag-c 判退 hoodoo
的同一條:讀數不能替形狀背書)。要出貨需要的是**塔樓的立面測繪圖**,不是更多渲染圖。

順帶一提,`bld_drawing` 這一列**刻意不帶 `grp`**:設計圖是**輸入格式**不是建物類別,
進了分母就把使用者的 50/25/25 稀釋掉了。要不要讓設計圖也照類型配比,是使用者的決定。

### 5ai-f. 驗收

`audit_plan_mesh.py` **21 項全綠**(Ⅰ 只取外層表面 / Ⅱ 無室內幾何(體積 = 凸包、尤拉數 = 2)/
Ⅲ 圖框剔除 / Ⅳ 視覺外殼(退縮立面 × 方平面,高寬深逐項對上像素比)/ Ⅴ 單視圖深度是假設且
會講出來 / Ⅵ 決定性 + 解析度無關 / Ⅶ 缺口報錯 / Ⅶ-b 渲染圖被擋且線稿不被誤擋)。
**反向驗證**:`--break-outer` ⇒ **9 條紅**(12 面盒變 32 面、體積 0.008 vs 0.243、尤拉數 0);
`--break-frame` ⇒ 1 條紅。
遊戲程式碼一行未動 ⇒ `npm test` / `npm run bal` / 全套地物稽核**結構上不受影響**(本輪未重跑)。

### 5ai-g. 未做

1. **塔樓立面測繪圖**(見 5ai-e)—— 有了才出得了第一顆 `plan_hull` 節點。
2. **多視圖那條路還沒吃過真圖**:合成測試涵蓋 front × plan,但真實 HABS 圖組的立面/平面
   是**分開的檔案且比例尺不同** ⇒ 對位規則(現在是「以 front 的高當 1.0」)還沒被真圖考驗過。
3. 低矮建物目前沒有任何「整棟量體」的消費端桶(只有 >55m 那一個)—— 要用寬矮宅邸這類語料,
   得先決定要不要開第二個桶。

## 5d. Trial log (2026-08-05, 3060-machine session — gate re-probe + photo-DB integrity)

- **SF3D gate re-probed: still closed.** Token itself is healthy — `whoami-v2` shows a classic
  `read`-role access token ("WillyRnnoise") on `winniexchang`, public files (LICENSE/README)
  download fine — but `model.safetensors` returns 403 *"you are not in the authorized list"*.
  The repo is **`gated: auto`** ⇒ clicking "Agree" on the model page while logged in as
  `winniexchang` grants instantly, no human review. Whatever was accepted earlier landed on a
  different account or was never submitted. When it opens, resume at §5c's "next single action".
- **Data home recorded** (hand-off state): the gitignored ai3d working set (`.venv`, `photos/`,
  `photo_manifest.json`, `vendor/stable-fast-3d`, `weights/`, `out/matte`) lives in worktree
  **`.claude/worktrees/zen-albattani-b33990/tools/ai3d/`** — the venv has absolute paths, do not
  move it; run the fetcher from that copy (data is keyed off the script's own dir).
- **Magic-bytes gate shipped** (the §5c "fetcher should gain a magic-bytes check" item):
  `sniffImage()` accepts JPEG/PNG/WebP header bytes only; a non-image download now books
  `ok:false` (it is a fact about the file, same rule as 404 — unlike 429 which never books)
  and never lands on disk. Extension and Content-Type are both untrusted.
- The pool scan found the predicted corruption **already inside the "green" DB**: two whole
  Internet Archive book-scan **PDFs** booked as `ok` rock/facet photos (7 MB + 25 MB,
  `wc_91723690` / `wc_93938159`) — the licence audit passes them because *Public domain is true*;
  only the bytes reveal the lie. De-booked, deleted, refetched → **all 14 parts back at target,
  61 ok entries, 61/61 real image + file present + CC0/PD**.
- **Second fetcher bug caught by the same scan**: `entry.file` was made relative by
  `replace(HERE + '/', '')`, which is separator-sensitive ⇒ on Windows it silently no-oped and
  the manifest recorded **absolute paths of whatever worktree ran the fetch** (28 rows; the
  Actions/Linux rows were fine — why round 1 never showed it). Fixed with `path.relative` +
  POSIX separators; the 28 rows migrated. Portability moral: the artifact/manifest must never
  encode the machine it was fetched on.

## 5. Trial log (2026-08-05, sandbox session)

- Actions run 1 (`fetch-photos.yml` #30973968007): 118 manifest entries, 35 ok, **0 licence violations**,
  63 MB artifact. Per-part tallies in §4-A.
- HF Space route probed from sandbox: `dynamic_space` requires MCP-enabled spaces;
  `stabilityai/stable-fast-3d` is not (404); the curated roster contains no image→mesh tool.
  ⇒ Space fallback must be driven from the 3060/browser, not from sandbox MCP.
- Artifact ingress to sandbox probed: MCP hands out a signed `*.blob.core.windows.net` URL; proxy 403.
  Raw `api.github.com` REST with the session token: "GitHub access is not enabled for this session".
  ⇒ recorded in §2; do not burn time re-testing.

## 7. Review board — 3D 零件對照台 (generated vs original, side by side)

User decision (2026-08-05): *「在設定頁面另外建立 docs/ai3d_runbook.md 生成的 3D 物件與原版 3D
物件比較的工具,須說明使用哪個生成方法與 img,操作比照生圖對照台」*.

**How to run** — same three ways as the 2D board:

```bash
npm run parts
```

`node tools/parts_review.mjs --report` prints the pairing table without a browser;
`--port` / `--photos <某個 tools/ai3d 目錄>` override the port and where source photos are looked up.
In-game it is the second row of 設定 → 開發工具(本機) (▶ 啟動 / ↗ 開啟 / ⏹ 停止, port **8622**) —
that row exists because the tool is registered in `tools/dev_supervisor.mjs TOOLS`; the settings page
derives the list from the server, so no client code was touched.

**What one row shows**

| | |
|---|---|
| Left pane | **原版** — for GLB parts, the fuse path (procedural primitive, part library deliberately not loaded); for pure-data parts, the pre-rewrite table built by **that revision's own `buildBeacon`**, served from `git show <rev>:public/js/beacons.js` |
| Right pane | **AI 生成** — the real game path (library loaded / current table) |
| Both | one shared camera and one seed (two different angles are not a comparison), collider cylinder overlaid, live readout: triangles / meshes(= draw calls) / collider r,h. The readout **names where that cylinder came from**, because the three consumers differ: beacons = measured `beaconCollider`, giant trees = bounding box (the real collider lives in the scatter code), megaliths = the registered `meta.col` |
| 來源圖 | every img with role, licence, creator, query and a link to the source page; the photo itself is served from whichever `tools/ai3d` data home has it (§5d) and says so plainly when it is not on this machine |
| 生成方法 | method label + why that method (plan §8 split), tool, runner, params, machine, measured VRAM/seconds, post-processing, landing rev |
| 數據對照 | GLB extent vs fallback envelope (+ verdict), triangles vs the measured budget; for pure-data parts, part count / measured extent / nominal `foot` then-vs-now |
| Bottom | 缺件 (descriptor → missing node ⇒ whole prop silently falls back), 孤兒節點 (node nobody uses), 未記載來源, ledger problems — never hidden, same rule as the 2D board |

**Where each fact lives** (no second copy anywhere):
`tools/ai3d/parts_src.mjs` reads the consumer part table, `PART_LIBS`, the fallback envelope and the
GLB (shared with `intake_parts.mjs` — it used to own all four); `tools/ai3d/provenance.mjs` holds the
method vocabulary and reads `parts_manifest.json`; the page only draws. Both panes are built by the
game's own `buildBeacon` — the board contains no second assembler and no second primitive builder.

**The ordering that makes it true**: `libGeo` is module state, so every "原版" must be built *before*
`loadPartLibs()` and cached. Getting that wrong produces two identical panes and no error message —
i.e. a confident, wrong "the AI part looks much like the original".

**One builder per consumer** (`build(…, builder)`): `beacon` → `beacons.buildBeacon`, `veg` →
`biomes.buildVegMeshes`, `mega` → biomes' own `synthMegalith` → `decorateMegalith` →
`jitterMegalith` → `bakeContactAO`, in `placeMegaliths`' order. The megalith one has to be a
**synthesised** rock: `MEGA_LIB` nodes only appear in `synthMegalith` (marble stack / talus blocks /
satellite domes) and `decorateMegalith` (cairn) — the named `MEGALITHS[].build` eat no library part
at all, so they would render bit-identically on both sides. An unknown builder now renders
**nothing** and logs; see silent bug 3.

**Framing is measured, never derived from the descriptor** (2026-08-06, silent bug 4). `whole` frames
the group's own bounding sphere; `part` shows only the meshes that were **swapped**, hides the rest,
and points the camera at the **largest** hit — one node is placed many times (`rock/mega_a` sits in 7
places across a 290 m outcrop), so framing their union turns every one of them into a dot.

Finding those meshes takes two passes, in this order. First, identify them **on the generated side by
measured vertex count** (`megaGeo` / `buildBeacon` both clone, so the count survives) and pair the
original side **by position** (centre inside the node's bounding sphere × `PAIR_F`). Never assume the
two panes' traversal indices line up: the imperative megalith builder replaces several primitives
with one library node (measured 92 → 49 meshes), so index pairing misses all of them and the only
symptom is "this row fell back to whole". Second, if the count identifies nothing — beacons merge by
material (cairn: 11 parts → 8 meshes), so the node's vertices are mixed into a bucket — fall back to
the **per-index diff** = "everything this kind swapped"; that path does require equal mesh counts.

When it does fall back to `whole`, say **which** reason: "this seed doesn't use this node" (the
imperative megalith picks types per seed — and the board names a seed that does) is not the same as
"the board couldn't pair them", and writing one message for both turns a working button into a
broken-looking one. The seed set must cover every library node: `[1, 3, 7]` reached neither
`rock/mega_e` nor `rock/mega_f`, hence `[1, 7, 10]` — re-scan when nodes are added.

Hiding is not a second assembler — the group is still the game's own, vertex for vertex — and the
readout still measures the whole prop, so it cannot lie. `near`/`far` track the distance.

**Four silent bugs found so far** (this is what the board is for):

1. `partlib.js` / `models.js` fetch **relative** asset URLs (`assets/models/parts/rock.glb`), and the
   dev boards serve the repo root ⇒ 404 ⇒ the library fell back to primitives and the "generated"
   pane quietly drew the original. Fixed with `<base href="/public/">` (URL layout mirrors the
   repo layout, A28) — **and the same line was missing from the 2D board**, whose 3D stage had been
   showing procedural fallbacks instead of the CC0 GLB units all along.
2. §5b's "*57 pure-data parts (was 12)*" — the board derives **11** from rev `32ec7b5`. The counts are
   derived from both revisions' part tables now, so the manifest records no part counts at all.
3. (2026-08-06) The megalith nodes `rock/mega_a|b|c` — the newest generation round, and the first
   **imperative** consumer — had a row on the board but no builder: `build()` fell through to
   `buildBeacon('megalith')`, whose `KIND_PARTS[kind] || KIND_PARTS.cairn` silently substituted the
   **cairn beacon**. And because the cairn eats `rock/*` nodes itself, the two panes genuinely
   differed and the readouts genuinely moved — it looked completely normal while the rock had never
   once been on stage. Fixed by adding the `mega` builder (three exports in `biomes.js`; behaviour
   bit-identical, `placeMegaliths` is still the only in-game caller) and by making an unrecognised
   builder/kind render nothing and log, instead of letting `buildBeacon` cover for it.
4. (2026-08-06) Owner: *「PR147 畫的 3D 物件在零件展示台沒有看到,只看到跟舊有物件重繪」*. Bug 3
   put the megaliths on stage; the **camera** then kept them off screen. Framing came from the
   offline descriptor and the registered collider, neither of which is the thing on stage, so one
   cause produced three symptoms: the camera always looked at `(0, y, 0)` (giant-tree canopy nodes
   sit 5.8 m off axis and never made it to the middle of the frame); the distance was `collider
   height × 1.35` with no horizontal term (a 58 m tall, 207 m wide megalith put the camera *inside*
   the rock — a flat grey wall in both panes); and unit-envelope nodes (`ico(1)` at `[0,0,0]`) could
   not be framed at all, so the 零件 button was simply disabled for `rock/mega_*`. Net effect:
   PR #147's output was on the board and unviewable. Fixed as above; `far` was also pinned at 500,
   which turned the 290 m outcrop into an all-black pane once the camera did back off far enough.

## 6. Open questions for the repo owner (do not guess)

1. Add an `HF_TOKEN` repo secret (with SF3D licence accepted) if CPU inference in Actions should ever
   be attempted; otherwise all inference stays on the 3060.
2. `fetch-photos.yml`'s push trigger is pinned to branch `claude/photo-db-img-to-3d-8j9tbe`;
   after PR #127 merges, keep only `workflow_dispatch` (edit the `on:` block) or repoint the branch.
3. ~~Accept the SF3D licence~~ — **RESOLVED 2026-08-05** (owner accepted on `winniexchang`;
   weights downloaded, P2c executed same day, §5e).
4. ~~Approve installing Blender~~ — **RESOLVED 2026-08-05** (Blender 5.2 LTS via winget, §5c).
