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

### F. 建築整棟節點的消費端縫 + T2 入庫路徑 — env: 3060 — **F0 之後(2026-08-07 交接)**

前置全部備齊:生成器有了(§5n,T2-spz 建築雙 ◎、幾何 + PBR 一次出)、減面路徑量過了
(§5o,**MUST 先實體化**)。缺的只有**消費端** —— 建築目前沒有「整棟」這個節點,
所以 §5i 以來每一顆建築產出都只能停在硬碟上(§5i/§5m/§5n/§5o 待續同一條)。
順序 MUST 是**先開縫、再入庫**(§5m ④ 的原話:「先開縫再入庫」)。

1. **先量再開**:建築整棟的三角形預算沒有量過,而 §5o 已證明 **500 面這一級留不住識別特徵**
   (Art Deco 的退縮量體被抹平,`dev_p95` 0.0088 → 0.0144)。先跑
   `tools/ai3d/measure_building_tris.mjs` 取得現值,再定 `tri_budget.json families.building`
   的整棟級距 —— 預算與縫 **MUST 同一輪定案**,分兩次做的話縫會照舊 400~900 開下去,
   而那個級距生出來的每一棟都是同一團方塊(D-1 教訓的同一條:先量家族再為它生成)。
2. **縫開在哪**:建物是 `biomes.js` 的 `BUILDERS`(拉伸量體 + 有向盒碰撞 `hw2/hd2/ry`),
   與 `beacons.js KIND_PARTS` 的零件式**不是同一種消費端**。整棟節點 MUST 維持
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
