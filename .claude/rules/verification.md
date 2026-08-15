# §5 回歸驗證:離線稽核清單 + 改了什麼 → 跑什麼

> 本檔 = 根 `CLAUDE.md` §5.1 的稽核/資產管線指令清單 + §5.5 驗證矩陣 + §5.6,2026-08-16 由根檔拆出。**小節編號一格未動**。
> 常用 npm 指令、§5.2 測試標準流程、§5.3 `npm run bal` 不變式、§5.4 矩陣通則(㋐~㋖)**留在根 `CLAUDE.md`** —— 那四段每一次改動都適用,不該要求先讀本檔。
> **本檔 MUST 在動手改東西之後、宣稱完成之前打開。**「改了什麼」那一欄查不到你動的東西時,回根 §5.4 ㋔ 的相鄰稽核通則。

---

### 5.1(續)離線稽核與資產管線指令

**離線稽核**(一律不需伺服器/瀏覽器/網路;`--break-*` = 反向驗證,見原則 9):

```bash
node tools/audit_aoe_trim.mjs        # 攻擊範圍收斂 + 三軸預算 + 爆風家族帶
node tools/audit_fire_rate.mjs       # 射速壓縮 + 連發演出
node tools/audit_recoil_move.mjs     # 後座力 → 開火中移速
node tools/audit_speed_comp.mjs      # 移速壓縮(拉近差距 / 排序不變)
node tools/audit_shield_counter.mjs  # 建築加乘移除 / 護盾分軌 / 對建築 DPS 收斂
node tools/audit_hex_stats.mjs       # 圖鑑六角能力圖
node tools/audit_weapon_gate.mjs     # 射程界 / 光暈 / 容差 / 高度制空 / 稜線 / 導引
node tools/audit_lance_hit.mjs       # 直線貫穿命中(含垂直帶換框)
node tools/audit_self_ult.mjs        # 純自身型補償 + 跟隨玩家的輔助機隊
node tools/audit_ult_carrier.mjs     # 招式載具遞送(含發射點與槽位 CD 帶)
node tools/audit_flight_power.mjs    # 三種載具彈道 / HP 校準 / 飛行動力學
node tools/audit_bot_vision.mjs      # 電腦玩家視野 + 碰撞
node tools/audit_bot_tactics.mjs     # 電腦玩家戰術(選敵 / 撤退 / 打帶跑)
node tools/audit_bot_role.mjs        # 定位分類與策略(末段印現役定位名冊)
node tools/audit_bot_policy.mjs      # 學習策略(夾制 / 中性 / 白名單)
node tools/audit_npc_collide.mjs     # NPC 飛行高度基準 + NPC ⇄ 機體碰撞
node tools/audit_shop_auto.mjs       # 商店掃貨 / 預約
node tools/audit_story_talk.mjs      # 劇情戰役攻堅順序鎖血 + 區域 BOSS 關卡(HP 地板 / 對白窗)+ 階段對話 + 本地故事書
#   ±--break-stage/--break-gate/--break-cast/--break-quota/--break-book/--break-floor/--break-talk
node tools/audit_story_map.mjs       # 劇情戰役地圖(單兵線 / 非對稱塔位 / 迷你尺度)+ NPC BOSS(分段 HP / 狂暴 / 活動範圍 / 恢復 / 不重生)
#   ±--break-stage/--break-hpmul/--break-full/--break-cap/--break-enrage/--break-respawn/--break-team
#   ±--break-prefill/--break-sp/--break-hpscale/--break-allybot
node tools/story_book.mjs --report   # 本地故事書的頁面索引(章 × 陣營 × 頁;缺頁一律列出來)
node tools/audit_blood_splat.mjs     # 受擊濺血提示
node tools/audit_cc_flash.mjs        # 異常狀態致盲白幕 + 蓄力跳水平移速
node tools/audit_world_height.mjs    # 世界高度上限(遊戲天花板 / 物件上限)
node tools/audit_world_edge.mjs      # 世界邊界(障礙環型錄 / 緩衝空間布景 / 視線邊界背景)
node tools/audit_world_curve.mjs     # 世界曲面(拐點 / 地平線反解 / 幾何細度)
node tools/audit_visual_prefs.mjs    # 畫面旋鈕 / 陰影偏色 / 風化場 / 抖動 / 景深
node tools/audit_soft_stroke.mjs     # 軟性物質(細勾線 + 飄揚 + 陣風 + 海浪 + 稻/草/芒草波 + 國旗)
node tools/audit_daynight.mjs        # 時間流逝(日夜循環)+ 太陽/月亮軌道 + 主光換手 + 影子
#   ±--break-clock/--break-fade/--break-elev/--break-cockpit/--break-range
node tools/audit_cel_pipeline.mjs    # 賽璐璐管線(ramp / 天空 / 地形色階 / 描邊寬度 / 地貌不出接縫)
node tools/audit_gpu_lifecycle.mjs   # 表現層資源生命週期(A25)+ RES_GOV
node tools/audit_gait_anat.mjs        # 步態關節曲線(前後肢拓樸/佔空比/等速後掠/站姿型/跳躍分級/交戰姿態)
#   ±--break-lock/--break-duty/--break-hip/--break-rest/--break-posture
node tools/audit_morph_rig.mjs       # 變形過程(兩態零件對應 / 反推的共同錨 / 換樹接得上 / 淡出淡入時間表)
#   ±--break-class/--break-defer/--break-fade/--break-rest/--break-anchor/--break-post/--break-once
node tools/audit_object_joints.mjs   # 程序生成零件接合(--seeds 8)
node tools/audit_siteplan.mjs        # 都市計畫 / 樹冠羞避 / 地質排列 / 聚落場 / 整棟量體 / 平面整平
#   ±--break-line/--break-shy/--break-strike/--break-gate/--break-mass/--break-mass2/--break-roof
#   ±--break-prof/--break-fill/--break-glass/--break-flat
node tools/audit_beacons.mjs         # 語意化地標
node tools/audit_world_text.mjs      # 世界文字(圖集 / 版面 / 裝箱 / 接線)
node tools/audit_vernacular.mjs      # 在地文字語料
node tools/audit_codex.mjs           # 角色 / 機體檔案格式
node tools/audit_paper_doll.mjs      # 機體台紙娃娃系統(骨架/零件/彩繪覆寫層 + 存檔語意)
node tools/audit_layer_block.mjs     # 塗層雙面阻擋 + 隧道頂板(A6b)
node tools/audit_open_tunnel.mjs     # 明隧道
node tools/audit_underpass.mjs       # 地下道 + 結構資格閘
node tools/audit_road_grid.mjs       # 地圖主方位(旋轉)+ 道路 16 方向量化
node tools/audit_road_joint.mjs      # 道路塗裝寬 / 結構接合 / 立體結構建置範圍
node tools/audit_road_bed.mjs        # 道路路基整平
node tools/audit_slope_move.mjs      # 地形坡度移動
node tools/audit_terrain_ray.mjs     # 地形解析射線
node tools/audit_climb.mjs           # 攀爬路線 + 障礙橫斷面(A30/A31)
node tools/audit_bridge_crossing.mjs # 橋交會去重
node tools/audit_water_skirt.mjs     # 馬路橫切繞行
node tools/audit_bridge_tower_pad.mjs# 橋上砲塔墩座
node tools/audit_mini_map.mjs        # 迷你地圖(縮小比推導 / 只剩前線塔 / 緩衝 1/3 / 剪短保真 / 手機閘門)
node tools/audit_map_rules.mjs       # 砲塔佈局 #4
node tools/audit_lane_sep.mjs / audit_lane_grade_sep.mjs   # 兵線分離 / #5 洞口涵蓋
node tools/audit_lane_navigation.mjs # 兵線導航規則
node tools/audit_ground_tile.mjs      # 地貌拼圖的顏色(選款區塊)與花紋(逐格互異)+ 緩衝空間底毯
#   ⚠ 貼合(斜坡破圖)在 audit_ground_drape.mjs —— 那一支要真瀏覽器(㋓,見下方)
node tools/audit_ground_qc.mjs / audit_ground_seam.mjs / audit_ground_enclave.mjs
node tools/audit_minimap_view.mjs    # 小地圖顯示範圍
node tools/audit_view_lock.mjs       # 視野鎖定
node tools/audit_spectator_cam.mjs   # 觀戰相機
node tools/audit_ctrl_mode.mjs       # 操作方式 + 戰場選單 + 按鍵風格
node tools/audit_ui_layout.mjs       # 選單版型 / 鈕面文字 / 懸浮提示 / 圖示
node tools/audit_touch_layout.mjs / audit_touch_gesture.mjs
node tools/audit_osm_relay.mjs       # 路網中繼(payload 淨化 / 逐格單調 / 接線順序)
node tools/audit_solo_boot.mjs       # 單機開機(data.js 單一模組實例)
node tools/audit_client_syntax.mjs   # 客戶端模組語法閘(全部 public/js/*.js 逐支 node --check)
node tools/audit_venue_biome.mjs --offline   # 場地地貌宣告自洽(CI 收這一半)
```

**需外網 / 真瀏覽器(㋓,沙箱跑不動 → GitHub Actions 或真機)**:

```bash
node tools/audit_ground_drape.mjs    # 地被貼合(斜坡破圖;--break-sag = ?sag=0 關掉抬升)
node tools/audit_traverse.mjs        # 兵線與結構可通行泛洪(27 場地;--break-slope 反向驗證)
node tools/audit_lane_scenarios.mjs  # 場地場景標記 MUST 由實測產生
node tools/audit_venue_biome.mjs     # 完整版:宣告 vs 圖資實測的地被組成與建蔽率
node tools/bake_venue_lanes.mjs      # 重烤 venueLanes.js
node tools/bake_venue_grid.mjs       # 重烤 venueGrid.js(場地主方位;--only <ids> / --dry)
node tools/measure_osm_relay.mjs     # 路網中繼 payload 實測(核對 maxPayload / MAX_BYTES 餘裕)
node tools/bake_venue_text.mjs       # 重烤 venueText.js(在地文字語料)
node tools/shot_scene.mjs --venue taroko     # 定場鏡頭組(--ink=0/--grade=0/--post=0/--dof=0/?curve=0)
#   --pref inkMrt=on --pref lutSrc=baked     # 設定頁旋鈕種進 localStorage —— 預設值全是「不生效」
#                                            #   ⇒ 折邊勾線 / LUT / 空氣透視 / 陰影偏色在定場照裡本來一張都拍不到
node tools/shot_facades.mjs / shot_signs.mjs / shot_tunnels.mjs / shot_units.mjs
node tools/shot_morph.mjs            # 變形過程膠片(八台變形者 m=0/0.25/0.5/0.75/1 + 對應率 + 換樹落差;--fold = ?morph=0 對照組)
node tools/shot_borders.mjs --port 8641    # 地貌界線拼圖全組合實拍圖錄(--seeds N / --only zoneA|zoneB)
node tools/audit_gyro.mjs            # 陀螺儀(MUST 用 https/localhost 真機)
node tools/audit_cockpit.mjs   # FPV 座艙：取景四規則 + 單件 ≤5% + 狙擊零零件 + HUD ≤1/6
#   ±--break-single/--break-scope/--break-hud/--break-grid/--break-anim；--parts = 逐件明細
node tools/audit_muzzle.mjs / audit_cast_jump.mjs
```

**資產管線(img→3D;全文 `docs/ai3d_runbook.md`)**:

```bash
node tools/ai3d/harvest_loop.mjs --home <資料家> --rounds 0 --every 15   # 週期採集(刻意不入庫)
node tools/ai3d/fetch_photos.mjs --inbox | --adopt | --plan              # 自己放圖 / 收編 / 配比
python tools/ai3d/matte_photos.py --rebbox --home <資料家>               # 回填截斷閘的邊框帳
python tools/ai3d/split_targets.py --home <資料家> --sheet               # 圈選 + 分離
python tools/ai3d/screen_mattes.py --sheet                              # 三道篩選(模糊/太小/截斷)
python tools/ai3d/audit_split_targets.py --home <資料家>                 # 圈選/分離/篩選稽核
node tools/ai3d/intake_parts.mjs     # 零件庫入庫閘(外廓契約 + 三角形預算)
node tools/ai3d/auto_intake.mjs --src <產出目錄> --home <資料家>   # 第 ⑦⑧ 站:自動入庫 + 收尾稽核(紅字整批回滾)
node tools/ai3d/apply_verdicts.mjs --home <資料家>                # 第 ⑨ 站:執行對照台的人眼判決(regen/reimg/purge)
node tools/ai3d/audit_auto_intake.mjs   # 自動入庫與撤下 + 圖檔三態與啟停閘門 + 封存區/重跑順位(離線)
                                        #   ±--break-append/--break-rollback/--break-blacklist/--break-spawn/--break-panel/--break-pane
                                        #   ±--break-home/--break-corpus/--break-home-arg/--break-on/--break-keys/--break-redo/--break-archive
node tools/ai3d/mesh_sym.mjs --gate  # 「另一面空不空」量測 + 該補的名冊
node tools/ai3d/node_sheet.mjs --glb <glb> [--ref <舊 glb>]   # 節點四面黏土對照(需 playwright)
node tools/ai3d/gen2d.mjs --audit    # rig 節點涵蓋 / 描述子詞表 / 補圖優先序 / ★ 外觀權威
node tools/ai3d/measure_*_tris.mjs   # 三角形預算量測(需 playwright)
node tools/bot_learn.mjs             # 電腦玩家策略學習迴圈(--eval / --reset)
```

---

### 5.5 改了什麼 → MUST 跑什麼

| 改動 | 驗證 |
|---|---|
| 任何 `public/js/*.js`;**GLSL 住在 JS 樣板字串**的那幾支尤其(`vfx.js` `SHIELD_VERT`/`SHIELD_FRAG`、`toon.js` 曲面與賽璐璐補丁、`environment.js` 天空穹頂 —— 這些檔案的 GLSL `//` 註解裡 **MUST NOT 出現反引號**,一個就把整支 .js 的字串收掉,而 node 報的位置指向註解那一行的中文字;**而且它不一定讓檔案解析不過** —— 2026-08-13 實測 postfx.js 的反引號收在一個「後面接得起來」的位置,`node --check` 全綠而管線在建構子丟 `.a is not a function`。這一條自該日起由 `audit_client_syntax` **Ⅲ** 自動守) | `audit_client_syntax` ±`--break-glsl`;名冊由目錄推導、副檔名 MUST 換 `.mjs`(`.js` 走 CommonJS 解析 ⇒ 頂層 `import` 整批誤報)。㋖ |
| 任何平衡數值(小兵/角色武器/`SQUAD.BUFF`/HEROIC/塔/賞金/八軌價格) | `npm run bal` 全綠;動角色武器一併看 ⑤ 離群列 |
| 射程/傷害/`sight`/`RANGE_SIGHT_F` | e2e:輕武器 NPC range ≥170(#INC-104)、t01/s02 `crit:0`、s02 heavy = launcher、「塔 310 > 所有輕武器」與「所有重武器 > 塔 310」雙不等式 |
| 角色機種編制(`CHARACTERS[].kind`/`visual`/換機種的 `mods.armor`) | e2e「機體混編陣營分佈」(7/3/2・3/7/2・2/2/4 + 32 名皆有 kind + 12/12/8 款 1:1)+ bal ①(EHP 池與推導值)+ ⑤(`CLASS_SYM` 分組)+ `audit_muzzle`/`audit_cockpit`/`audit_cast_jump`(㋓) |
| 射速壓縮 / 連發演出 | `audit_fire_rate` + **`npm run bal` 全綠(⑦c 最敏感)** + `npm test`(**射速一改,任何寫死秒數的測項會靜默失效** ⇒ 期望值 MUST 由解析後的 `wl.rate`/`wl.reload` 推導)+ ㋔ |
| 移速壓縮 | `audit_speed_comp` ±`--break` + **bal ①④⑤⑦ 四條一起看**(④ 的變形者剩餘 EHP 是 K 的下界守門值)+ `audit_aoe_trim`(`mobDmgF` 中點跟著漂)+ ㋔ |
| 開火中位移懲罰 | `audit_recoil_move` + `audit_fire_rate`(`recoilTier` 仍吃 `rate0`)+ `audit_view_lock`(**後座力仍不得被鎖定抵銷**)+ ㋒ |
| 攻擊範圍收斂 / 三軸預算 / 爆風家族帶 | `audit_aoe_trim` ±`--break` + **bal ⑦a 與 ①④⑤ 一起看**(範圍換火力的補償會位移單體模型)+ `npm test` 該段 + **`audit_weapon_gate`(核心帶縮小 ⇒ MUST 重掃 `SEEK.R_M`)** + `audit_shield_counter`(傷害鏈比對 MUST 走全鏈) |
| 對建築 DPS 收斂 / 任一 `vs.building` | `audit_shield_counter` Ⅵ + `npm test` 該段 + **bal ④ 是主要校準錨**、⑤ 逐角色離群一併看 |
| 建築加乘 / 護盾分軌 / 護盾軸配置 | `audit_shield_counter` + **bal 四不變式會位移** + `npm test` 該段 + ㋔ |
| 圖鑑六角能力圖 | `audit_hex_stats` + `audit_shield_counter` Ⅵ(`buildDps` 改吃 `weaponDps`)+ `audit_ui_layout`/`audit_ctrl_mode` + ㋒ |
| 波次節奏 `GAME.WAVE_S` / `waveComp` / `_prefillLanes` | e2e「出兵間隔固定 + 開場預置兵線」(期望值 MUST 由同一份規則推出)+ bal ①(波次 EHP/DPS)|
| 陣營小兵強化 | e2e 該段 + **bal 四不變式 MUST 不動**(bal 模型是未強化的基準波次) |
| 八軌階梯 / 戰鬥分數 | `npm test`(**MUST 先重啟伺服器**)+ `audit_shop_auto` + **`npm run bal`**(③ 已退場不判定,但 ⑦ 的升級節奏會位移 —— 交付率與對局長度都要看)+ `audit_bot_role`(bot 採購前置篩選)+ `audit_client_syntax`(㋖)|
| `ECON.UPG_STEPS` | e2e「八軌升級階梯 + 戰鬥分數門檻」+ `audit_shop_auto` + bal ⑦(升級節奏)|
| 商店掃貨 / 預約 | `audit_shop_auto` + `audit_ui_layout` + ㋒(bal 不模型化購買順序) |
| 劇情戰役地圖 / NPC BOSS(`STORY_MAP`/`BOSS`/`mapPlan`/`mapArg`/`siteCPs`/`solveTowerSites` 劇情分支/`towerLayoutAudit` 軟規則降級/`sim` 的 `isBoss`·`_bossAnchor`·`_bossSync`·`_bossEnrage`·`_applyUpg`·`_healBody`·`_prefillLanes`/`bots` 的 `_zoneClamp`·`_home`·`_hold`/`rooms` 的旗標正規化/`venueConfig` 第三參數/`game._updateHpBar` 光暈) | `audit_story_map` ±**十支** `--break`(每一支 MUST 對應紅字)+ `audit_story_talk`(攻堅鎖血是同一條規則的另一端;`_siegeFell` 的呼叫端變兩處)+ `audit_mini_map`(`mapArg` 換了入口,迷你那一套 MUST 逐位元不動)+ **`npm run bal` / `npm test` MUST 全綠**(bal 三個模型與 e2e 都不帶 `defSide` ⇒ 動了就是漏到一般對戰上;e2e 另有旗標正規化的 WS 直測)+ `audit_world_edge`(裙改吃 `edgeBufferM(mapArg(cfg))` ⇒ 原文錨點與沙箱自由變數要跟著走)+ `audit_siteplan`/`audit_beacons`/`audit_object_joints --seeds 8`/`audit_road_grid`(三個建圖消費端改吃 `mapArg`,完整戰場 MUST 逐位元不變)+ `audit_bot_vision`/`audit_bot_tactics`/`audit_bot_role`/`audit_bot_policy`(位置寫入唯一縫多一道夾制)+ `audit_weapon_gate`/`audit_shop_auto`(`buy` 拆出 `_applyUpg`、多一道 BOSS 閘)+ `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot` + **㋓ 真瀏覽器開一場劇情戰役**(敵方三座塔 + 我方零塔、BOSS 站在據點上不追人、血條外圍光暈隨段數換色 —— 建圖與表現層那一半沒有任何離線稽核驗得到)。⚠ 改 `STORY_MAP.DEF_STAGES` MUST 回頭重跑本支 Ⅱ(地圖尺度自己會跟著走,但塔位還塞不塞得下要重驗);`audit_lane_grade_sep` 需 `tools/.osm_cache`(㋓) |
| 攻堅順序鎖血 / 區域 BOSS 關卡 / 劇情階段對話(`siegeHpFloor`·`_bossFell`·`siegeTalkS`·`SIEGE.TALK_S`·`BLD_HP_FLOOR` / `siegeTalk` 事件 / game.js 的事件分流) | `audit_story_talk` ±`--break-stage`/`--break-gate`/`--break-cast`/`--break-quota`/`--break-floor`/`--break-talk` + **`audit_story_map` Ⅴ・Ⅶ**(HP 地板與對白窗的行為直測住那一支:它才有真的 BOSS) + **`npm test`(MUST 先重啟伺服器;旗標關掉時 sim 逐項不變)** + `npm run bal` MUST 逐項不動(鎖血只在劇情房生效,bal/duel/lanesim 都沒有 `siege`)+ `audit_weapon_gate`/`audit_bot_vision`/`audit_bot_tactics`(`_damage`/`_tgBlockedD`/`bots._acquire` 各多一道閘)+ `audit_client_syntax`(㋖)+ `audit_ui_layout` + 改對白內容 ⇒ 只需本支 |
| 劇情畫面標記 `storyui.js` / 本地故事書 `tools/story_book` | `audit_story_talk` Ⅷ ±`--break-book` + **`audit_ui_layout`**(頭像唯一縫換了家,規則沒變)+ `npm run audit:net`(新增一支可啟停的 dev 工具 ⇒ ⑦ 段的埠號 import 與 kind 分流會多一列)+ `audit_solo_boot` + `audit_client_syntax`(㋖)+ `story_book --report`(缺頁 0)+ **真瀏覽器開一次遊戲的劇情分頁**(㋕:標記從 main.js 搬走了,章節卡/簡報/選主駕要仍然一模一樣)。改 `storyui.js` 的任何一行 = **兩個消費端一起動**,MUST 兩邊都看 |
| 對進戰模型 / `ALTITUDE.*` / `FAN_*` / `CLASS_SYM.K` | bal ⑤(陣營與機種 50±5pp、**較高方 50±3pp**、非豁免角色 ∈ 20~80%、接近期損失 ≤40%);改 `K` 一併看 ① |
| 機種底盤(`UNITS[kind]` 的 hp/shield/speed/fly/**sight**、`SQUAD.HP_F`/`ARMOR_F`、`EVASION.AIR_BONUS`) | **bal ⑤f**(三個底盤兩兩 ≈50%;robot/morph 那一格是結構保證 —— `UNITS.morph` 一動就紅字)+ ⑤b + ⑦c + ①(HP_F 是清波剩餘率的校準錨)+ 改 `sight` 另 MUST 看迷霧/索敵與 #INC-104 高空射擊。反向驗證:把 `SQUAD.HP_F` 調到 1.0(⑤f 34.6% 紅)或讓 `UNITS.morph.sight` 偏離 robot(robot/morph 25.1% 紅) |
| 前線交戰模型(`lanesim.mjs`) | `npm run bal` ⑦ 全段(**b 的三條單軸自驗是模型有沒有壞掉的哨兵**)+ `audit_aoe_trim` Ⅴ + ㋒ |
| 招式配置 `fx`/`add` | bal ⑥:雙扇形 MUST 兩招貼身、單扇形 ≥1、密度 ≥ 非扇形 ×2;s07/m07 具名豁免 MUST NOT 為湊標換掉 |
| 招式手勢 / 純自身型補償 | `audit_self_ult` ±`--break-eq`/`--break-alpha`/`--break-brk` + `audit_ult_carrier` + `audit_flight_power` + **bal ⑦f**(自身型組 9 台 MUST 全數 > 0)+ `npm test` + ㋔ |
| 輔助機隊(自身強化型) | `audit_self_ult` Ⅴ・Ⅵ ±`--break-stack`/`--break-tempo` + `audit_ult_carrier`(kami 恰**兩個**具名生成點;三支 `--break` 仍 MUST 咬得住)+ `npm test` 該段 + **bal ⑦f**(「輔助機損失」那一行 MUST > 0 —— 恆 0 = 模型裡根本沒被打過)+ ㋔ |
| 招式載具發射點 / 槽位 CD 帶 | `audit_ult_carrier` Ⅳ ±`--break-origin` + `audit_self_ult` Ⅵ + `npm test` 該段 + **bal 全綠**(⑦f 載具交付率會位移)+ ㋔ |
| 大招載具遞送 | `audit_ult_carrier` ±`--break-cd`/`--break-guard`/`--break-boom` + `npm test` 兩段 + **bal 全綠** + `npm run sim` + ㋔ |
| 三種載具形式 / 彈道 | `audit_flight_power` Ⅰ・Ⅱ ±`--break` + e2e 三段 + **bal ⑦f**(三招實得比 MUST ≤1.8× 且全數 > 0;改 `KAMI_EQ`/半徑 MUST 回頭看這一項) |
| 載具 HP 校準 / 爆風面積 / `SPECIAL` 預算 | `audit_flight_power` Ⅰ + e2e「載具 HP 一律由砲塔反解」+ **bal ⑦f 與 ⑦c** —— **改砲塔任一數值或波次編制 MUST 重跑全部** |
| 飛行動力學 | `audit_flight_power` Ⅲ~Ⅵ + e2e「bot 飛行機體受擊掉高」+ ㋒(bal 不模型化飛行高度) |
| 射程球心 / 出膛初速 / 飛行時間 / 榴彈火控 / 射程界 | `audit_weapon_gate` Ⅳ・Ⅴ・Ⅵ・Ⅺ・Ⅻ ±`--break` + `npm test` 該段 + ㋒(bal 不模型化彈道)+ ㋔ |
| 射程閘門容差 / 爆風量體 / 光暈 / 高度制空 | `audit_weapon_gate`(八段)+ ㋒ + ㋔ |
| 高地壓制(`HIGH_SUP` / `sim._stampSup`·`_supF`·`_missP` / `bots._speed` / `game._mobility`)| `audit_weapon_gate` ③b + **反向驗證四支**(拿掉 `_damage` 的戳記 / 補償改吃 `pm` / bots 不折速 / **三個值歸零 + `ALTITUDE` 爆擊代價還原 ⇒ `npm run bal` MUST 逐位元回到上線前**,最後這支是這一族最有力的一道)+ **`npm run bal` 全綠且 ①②③④⑥⑦ MUST 逐項不動**(那些全是同高度模型 ⇒ 動了就是壓制漏到 dh = 0 的路徑上)+ `audit_speed_comp` Ⅳ(唯一取速處多一個乘數,形狀仍釘死)+ `npm test`(**MUST 先重啟伺服器**;高空拆堡那一場會變慢)+ `audit_client_syntax`(㋖)+ ㋔ + **真機冒煙**(㋕:移速那一軸沒有任何離線模型在守 —— ⑤ 幾乎不計價、⑦ 是同高度模型) |
| 閃避範圍(`evadable`)/ 爆風逐目標擲骰 / 維持 DPS 補償 / NPC 爆炸型武器 | `audit_weapon_gate` ⅩⅢ + **反向驗證六支**(拿掉爆風擲骰 / `continue` 改 `return` / NPC 改回單體直擊 / 拿掉補償 / 補償改吃全體平均 / 補償也套到輕武器,六支 MUST 各自紅字)+ **`npm run bal` 全綠,且 MUST 與改制前(`git checkout <main> -- data.js sim.js tools/`)逐項對照** —— 補償後期望值不變 ⇒ 差異只該剩「散彈輕武器不再被誤判成可閃」那一項(s04/s09/t03) + `npm test`(**MUST 先重啟伺服器**)+ `audit_speed_comp`(閃避門檻同一條速度軸)+ ㋔。**動爆炸型名冊(給某把武器/建築 `r`)另加一條**:半徑一律由 `npcBlastR` 自 `UNITS` 推導 ⇒ 反向驗證 = 把該半徑歸零(`STRUCT_W`/`WEAPONS`/`GAME.AA_AMBUSH.R` 都是可變物件,連檔案都不用改)、`audit_weapon_gate` ⅩⅢ⑥b・⑥c MUST 對應紅字;bal 只會因為它進了 `evadeComped` 而位移(與半徑大小無關),MUST 逐列與改制前對照 —— 塔/主堡/伏擊飛彈**逐項不動**是預期結果(bal 的塔是期望值模型,補償後期望不變),動的只有 ① 的 drone 列。**改完另量一次 tick 成本**(`_blast` 是全 ents 掃描,現在每座塔每發都跑一次;實測 3 兵線 5v5 × 300s 為 −3.4%,在雜訊內) |
| 射後不理追擊 / 爆風擴散 | `audit_weapon_gate` Ⅸ・Ⅹ + ㋒ |
| 地形稜線遮蔽 | `audit_weapon_gate` Ⅷ + ㋒(e2e 不上傳 `hgt` ⇒ 確定性斷言 MUST 全數不動)+ **重算 `server.js maxPayload` 餘裕** |
| 直線貫穿命中 / 垂直帶換框 | `audit_lance_hit` ±反向驗證 + ㋒ |
| 導引 / 射後不理鎖定(A41) | `audit_weapon_gate` Ⅵ + ㋒ |
| 填彈(`_refillIfDone`/`_gateFire`/`heroReload`)/ 扇形錐緣 | `audit_weapon_gate`(Ⅴ-b)+ `npm test` 兩段(AoE 各跨**三個彈匣** —— 只驗一匣一定全綠)+ **bal 全綠**(⑦ 的 fan 幾何本來就已算到量體 ⇒ 模型不動)+ ㋔ |
| `hitH`/`TARGET_H`/`HERO_SIZE`/`hitR`/`TARGET_R` | headless `_blast` 直測(垂直帶內同額、`EDGE·r` 外歸零、塔頂 = 塔底)+ `audit_lance_hit` + `audit_weapon_gate` Ⅲ |
| `AIR`/`envTrigger`/`TERRAIN_FX` | headless 直測(小跳仍踩雷、蓄力跳不踩;無人機 y=10 仍灼傷;騰空 wet 立停)+ 真機水域冒煙 |
| `aoeClass`/`trajClass`/`LANCE`/`ARMING` | 32 角分類覆蓋 + `heroLance` 衰減直測(首發全額、之後 `DECAY^i`)+ bal 不動 |
| bot 操作節奏 `BOT_DIFF`/`BOT_OPS` | e2e「電腦難度操作節奏」+ `npm run sim` + 沙包輸出 MUST 隨難度單調遞增 |
| bot 視野 / 碰撞 | `audit_bot_vision` + `npm test`(bot 沿兵線推進)+ **AI 退化量測**(見 5.6)+ ㋒ |
| bot 戰術 | `audit_bot_tactics` + `audit_bot_vision` + `audit_blood_splat`(`_hurtLog` 共用縫)+ `npm test` + `npm run sim`(**MUST 仍分得出勝負**)+ **AI 退化量測** |
| bot 定位分類與策略 | `audit_bot_role` ±`--break-role`/`--break-norm`/`--break-tier` + `audit_bot_tactics`/`audit_bot_policy`/`audit_bot_vision` + `npm test` + **bal 不動**(平衡指紋未變 ⇒ botPolicy.js 不過期)+ `npm run sim` + **AI 退化量測** |
| bot 學習策略 | `audit_bot_policy` ±`--break-clamp`/`--break-neutral` + `audit_bot_tactics`/`audit_bot_vision` + `npm test` + `npm run sim` + `npm run audit:net`/`audit_solo_boot`(data.js 多一支 import)+ **bal**(中性逐位元同舊制;學習輪落地後四不變式仍 MUST 全綠) |
| NPC 飛行高度基準 / 客戶端單位碰撞 | `audit_npc_collide` ±`--break-ratchet`/`--break-deck`/`--break-sweep` + `audit_bot_vision`(伺服器那半 MUST 逐位元不動)+ ㋔ + ㋒ |
| 世界高度上限 | `audit_world_height` ±`--break-ceil`/`--break-obj`/`--break-cap` + `audit_siteplan`(`placeBoundary` 多吃 `objScaleFit`)+ ㋔ + ㋒ |
| 世界邊界 / 邊界牆型錄 / 緩衝布景 / 視線背景 | `audit_world_edge` ±`--break-lap`/`--break-buffer`/`--break-fit`/`--break-face`/`--break-run`/`--break-slope`/`--break-boxh`/`--break-land` + `audit_slope_move`(坡度門檻是共用的那兩條線) + `audit_siteplan`(`placeBoundary` 的沙箱要多注入 `edgeWallDeepM`)+ **裙 MUST 擺在 terrain.js 開挖/射線/打洞三支稽核抽原文的標題之外**(落在裡面那些沙箱會一起執行而 `ReferenceError`)+ `audit_cel_pipeline`/`audit_world_curve`(envMat 計數與水面分段 MUST 逐位元不動)+ `audit_client_syntax`(㋖)+ `audit_net_modes`/`audit_solo_boot`(新增客戶端模組)+ `audit_beacons`(`mergeGeos` 多一個選用參數,不給 = 逐位元同舊制)+ **`shot_scene` 的 `edge_wall`/`edge_far` 兩張(㋓:這一整套只有站在邊界往外看才看得到)** + ㋔ + ㋒ |
| 世界曲面 | `audit_world_curve` ±`--break-knee`/`--break-edge` + ㋔ + **`audit_client_syntax`**(㋖;曲面的 GLSL 都住樣板字串裡,舊 Ⅷ 段的窄版語法閘已整併進那一支)+ `npm run audit:net`/`audit_solo_boot`(toon.js 多一條 data.js import)+ **`npm test`/`bal` MUST 逐項不動** + `shot_scene ?curve=0`(㋓) |
| 景深模糊 | `audit_visual_prefs` Ⅵ ±八支 `--break` + `audit_gpu_lifecycle` ⑦ + `audit_cel_pipeline`/`audit_soft_stroke`(**勾線的 alpha 契約 MUST 逐位元不動**)+ **`npm test`(data.js 動了 ⇒ 不是 ㋒,但 MUST 逐項不動)** + `npm run audit:net`/`audit_solo_boot` + `audit_ui_layout` + `shot_scene --dof=0`(㋓) |
| 時間流逝 / 太陽・月亮 / 影子(`DAYCLOCK`·`clockHour`·`phaseBlend`·`sunDirAt`·`bodyFade`·`SHADOW` / `environment.js` 的 `TIMES`·`setHour`·`makeBodies` / `game._simT`·座艙投影旗標·`renderer.shadowMap` / `models.makeUnit` 收尾 / `ground.buildGroundCover` 收尾 / `visualPrefs.shadow`) | `audit_daynight` ±五支 `--break`(每一支 MUST 對應紅字)+ `audit_cel_pipeline`/`audit_visual_prefs`/`audit_soft_stroke`/`audit_world_curve`/`audit_gpu_lifecycle`(天空穹頂與勾線契約 MUST 逐項不動)+ `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot`(game.js 多一條 visualPrefs import)+ **`npm run bal` / `npm test` MUST 逐項不動**(純表現層:`sim.js` 一行未改,`data.js` 只多了不進 `balanceFingerprint` 的常數;動了就是漏到判定上)+ **㋓ `shot_scene --time <四選一> --elapsed <真實秒>`**(這是唯一拍得到「時間在走」的地方 —— 同一組機位跑 0/200/400/600 四輪比色;`--shadow=0` 拍前後對照)+ **㋓ 真的開一場單機戰**(shot_scene 沒有任何 `castShadow` 的東西 ⇒ **影子那一半它一張都拍不到**;實測手法 = playwright 驅動大廳→房間→開戰,量 `envFx.hour` 隨真實時間前進、開關陰影圖比對像素差)+ **㋕ 兩台同房**(天色分家的症狀只有兩台並排才看得到)。⚠ 改 `SHADOW.TEXEL_M` MUST 回頭看檔頭那兩個數(機體影子的 texel 數 / 涵蓋半徑),它們是這個取捨的驗收面 |
| 畫面旋鈕 / 陰影偏色 / 風化場 / 零件抖動 | `audit_visual_prefs` ±反向驗證 + `audit_cel_pipeline`/`audit_gpu_lifecycle` + `audit_object_joints` + `audit_ui_layout`/`audit_ctrl_mode` + ㋒ |
| 軟性物質 | `audit_soft_stroke` ±`--break-ink`/`--break-anchor` + `audit_cel_pipeline`/`audit_gpu_lifecycle`/`audit_visual_prefs` + `audit_object_joints`(擺動是頂點位移 ⇒ 零件表接合 MUST 逐位元不動)+ `audit_siteplan`/`audit_beacons` + ㋒ |
| 海浪 / 陣風包絡 / 稻浪·草波·芒草波 | `audit_soft_stroke` Ⅵ・Ⅶ・Ⅷ ±`--break-wave`/`--break-gust` + **`audit_world_curve`**(水面分段多了第二把尺,曲面那一半的保證 MUST 仍在算式裡)+ `audit_cel_pipeline`/`audit_gpu_lifecycle`/`audit_ground_tile`/`audit_ground_qc` + `audit_client_syntax`(㋖)+ **真 GPU 直測(㋓:GLSL 在 Node 端執行不了 —— 同一台相機同一個場景,只推進 `stepCelWind`,`readPixels` 比對。時鐘不動 MUST 逐位元相同(否則差異不是來自時鐘)、推進之後 MUST 有像素改變、`gl.getError()` MUST 為 0(新的 `attribute float seaFade` 會不會讓整批物件不畫))** + **`shot_scene` 的 `waterline`(㋓:浪的形狀與岸線的扇貝邊只有實拍看得到)** + ㋒(data.js/sim.js 一行未動 ⇒ `npm run bal`/`npm test` MUST 逐項不變) |
| 國旗物件 | `audit_soft_stroke` Ⅸ + `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot`(新增客戶端模組 flags.js,且 biomes.js 多 import lore.js)+ `audit_siteplan`/`audit_beacons`/`audit_object_joints`(**零共享 rnd ⇒ 佈局 MUST 逐位元不動**)+ **旗面排面實拍(㋓:31 款畫成一張圖人眼核對 —— 離線稽核只驗得到「有沒有畫」,驗不到「認不認得出是哪一國」;GB/AU 少了斜十字會讀成北歐旗)** + **`shot_scene` 站到主堡旗陣旁(㋓:旗子有沒有真的立起來 —— `areaFree` 的格子探針把整圈靜默淘汰時,回傳的數字是 0 而沒有任何錯誤訊息)** + ㋒ |
| 賽璐璐管線 / 描邊寬度 | `audit_cel_pipeline` ±`--break-scale` + `audit_gpu_lifecycle` ⑦ + **`shot_scene` 前後對照 + 幀時量測(㋓;這是唯一決定勾線可不可行的數據)** + ㋒ |
| 表現層資源生命週期 / `RES_GOV`(自適應解析度;2026-08-12 起**全平台**,含震盪熄火 `FLIP_MAX` 與背景分頁不入帳) | `audit_gpu_lifecycle` ±`--break-resgov-all`/`--break-resgov-flip`/`--break-resgov-hidden` + **行為直測**(抽 `_tickResGov` 原文餵合成幀時:滿速 0 次調整 / 穩定慢速降到 `MIN` / 尖峰不入帳 / 兩階之間來回 ⇒ 熄火且**不回彈**)+ 真機 60s heap 不單調上升 |
| 勾線資訊緩衝 / **任何新增進場景的 `ShaderMaterial`** | `audit_cel_pipeline` Ⅵ ±`--break-inkinfo` + `audit_gpu_lifecycle` ⑦ + `audit_soft_stroke`(RT0.a 的軟性契約 MUST 逐位元不動)+ **真 GPU 直測(㋓,這一族唯一驗得到「會不會整批物件消失」的地方)**:①**逐材質型別掃一遍** —— Basic/Toon/Lambert/Standard/Physical/Phong/Matcap/Sprite/Points/Line/LineDashed 各畫一顆進 MRT,`gl.getError()` MUST 全 0;②全場景 A/B(開/關/再關)MUST 零錯誤、關回去**逐位元還原**、天空帶墨線數三者相同 + ㋒ |
| 地貌類別碼 / 地貌法線 / LUT 地貌分支(`INK_CLASS`/`LAND_SURF_ID`/`land`·`landNrm`/`landNrmAt`/`lutApplyLand`/`_wantInfo`) | `audit_cel_pipeline` Ⅶ ±`--break-land`/`--break-lutland` + `audit_visual_prefs`/`audit_soft_stroke`/`audit_gpu_lifecycle`/`audit_world_curve` + `audit_client_syntax`(㋖;**Ⅲ 那一段就是這一輪補的** —— GLSL 註解裡的反引號可以收在一個「後面接得起來」的位置,`node --check` 全綠而管線在建構子炸)+ ground/terrain 那一批(ground_tile/seam/enclave/qc/border、siteplan、beacons、object_joints、world_edge:幾何一格未動,MUST 逐項不變)+ **㋒ 逐位元**(`data.js`/`sim.js`/伺服器一行未改 ⇒ `npm run bal` / `npm test` MUST 逐項不動)+ **㋓ `shot_scene` 三輪 A/B**:①旋鈕全關 ⇒ 與改制前**逐位元相同**(13 張定場照 md5 全同,2026-08-13 實測);②`--pref inkMrt=on` ⇒ 地面那張黑色網格 MUST 消失而建物/道路/樹的線 MUST 還在;③`--pref lutSrc=baked`(折邊勾線仍關著)⇒ MUST **一條線都沒有多**(多出來就是兩個消費端被綁在一起了) |
| 3D LUT 調色 | `audit_visual_prefs` + `audit_cel_pipeline` + **真 GPU 直測**(`matsample` readPixels:`none` ⇄ `baked` 只差量化(mean 1.28/765)、強度 0 / 檔案不存在 / 切回 `none` 三者**逐位元相同**、人工反相 LUT 天翻地覆 = 表真的被查了)+ ㋒ |
| 空氣透視(雙色霧) | `audit_visual_prefs` + `audit_cel_pipeline` + **真 GPU 直測**(`matsample` 走真品管線 readPixels:拉桿 0% ⇔ 還原後**逐位元相同**、把霧帶推到 knee 之外 ⇒ 補正**恆 0**、沒餵距離 ⇒ 不生效)+ ㋒(data.js/sim.js 一行未動 ⇒ `npm run bal`/`npm test` MUST 逐項不變) |
| 建構期讓步(`buildYield` / `await onProgress`) | `audit_client_syntax`(㋖:`await` 落在非 async 的回呼裡是 SyntaxError)+ **`audit_siteplan` Ⅵ 與 `audit_open_tunnel` Ⅵ**(兩支真的執行 biomes/terrain 原文,沙箱要吃得下 await)+ biomes 那一批(siteplan/beacons/open_tunnel/underpass/road_joint/world_text/object_joints/ground_*)+ **A/B 直測 MUST 比對產出**(同一場地 warm 跑兩次,`blockers`/`decks`/`tunnels` 逐項相同 = 讓步沒有動到取樣順序)+ ㋒ |
| 程序生成物件擺位(`BUILDERS`/`VEG_DEFS`/`vegPartXform`/`MEGALITHS`/`synthMegalith`/`decorateMegalith`/`rockProbe`) | `audit_object_joints --seeds 8`(約 23000 接合;FLOAT/PARTIAL/DETACHED/ISOLATED 四硬失敗;豁免附理由;巨岩段含「兩端支承」具名救援) |
| 場址配置(都市計畫 / 羞避 / 地質排列) | `audit_siteplan` ±`--break-line`/`--break-shy`/`--break-strike` + **`intake_parts`**(外廓契約 + 三角形**兩道閘**:單件 ≤ 族上限、**逐款 Σ 庫零件 ≤ `kind_factor` × 該款現值**;**改 `GIANT_DEFS` 任一零件表 MUST 重量 `tri_budget.json` 的 `kind_tris`**)+ `audit_beacons` + ㋔ + **`audit_traverse`(㋓:沿街多出數百棟 ⇒ 街廓夾出來的通道要仍走得通;沙箱降級的未驗結果 MUST NOT 當綠燈)** + ㋒ |
| 聚落場 / 建物來源信任階梯 / 場地 `mix` | `audit_siteplan` Ⅴ・Ⅵ・Ⅶ ±`--break-gate` + `audit_venue_biome --offline` ±`--break-clip`/`--break-roster`(兩支都落在離線那一段 ⇒ CI 收得到)+ **完整版 `audit_venue_biome`(㋓)** + ㋔ + ㋒ |
| 建物零件庫(整棟量體 / 三帶 UV / 層高) | `audit_siteplan` Ⅴ ±`--break-mass`/`--break-mass2`/`--break-roof`/`--break-storey` + `intake_parts`(含 **UV 契約**,反向驗證兩支)+ **逐位元不變 MUST 用量的**:`measure_building_tris --live --osm-cache` 錄播 Overpass 後做 A/B(同一張圖兩次 `--live` 差到 ±70%)+ `shot_facades` 排面與 `shot_scene` 的 `mass_near`/`masslow_near`(㋓)+ 3D 零件對照台 0 缺件/0 孤兒/0 未記載 + ㋔ |
| **平面整平 / 前置去噪 / 小區塊併入鄰居 / 封底 / 窗牆帶的平整條件 / 招牌落點的平整條件 / 窗格輪廓 / 窗格貼齊面板**(`normalize_parts.py` 的 `PLANAR_*`(含 `SMALL_F`/`MERGE_DEG`/`DN_*`)·`SEAL_*`·`_plane_groups`·`_face_adj`·`_denoise`·`_planarize`·`_base_seal`·`_open_share`·`--replanar`·`--uvbands` 後兩欄 / **`public/js/wallpanel.js` 全檔** / `parts_src` 的 `meshFaces`·`flatWalls`·`wallFlatness`·`solidConverge` / `wallpanel.planeGroups` / `tri_budget` 的 `planar_spec`(含 `small_f`/`merge_deg`/`dn_*`)·`sign_flat_min` / `MASS.UVB.FLAT_*`·`SIGN_FLAT_MIN`·`PANEL` / `bldFaceList` / `biomes.alignedGeo`·`pitchGrid` / `facadeTex` 的 `snap`·`pane`·`wrapS`·`FACADE_PX.FRAME`·`ANISO`) | `audit_siteplan` Ⅴ ±**`--break-flat`**(MUST 紅 3 條)+ **`--break-merge`** / **`--break-denoise`**(各 MUST 紅 5 條)+ **`--break-seal`**(MUST 紅 4 條)+ **⑥-d 的行為直測**(真的切一次面板、跑四種網格:格數恆為 ≥1 整數、u 跨距恆為 1/cols 的整數倍、v 恆收在窗牆帶內、共用頂點真的會出現)+ `audit_client_syntax`/`audit_solo_boot`/`audit:net`(新增客戶端模組 `wallpanel.js`)+ **`intake_parts`**(從成品 GLB 重量平整度;反向驗證 = 把**整平前**的 `building.glb` 餵給它,MUST 紅 22 條,其中「已合併整平」與「真的平整的 ≥ 60%」各節點都要紅)+ **重烤 MUST 兩趟**(帶寬是「該群面積佔比」⇒ 先 `--replanar` 拿到整平後的幾何、量出佔比,再從**原始** base 重跑一次把量到的值烤進 `--uvbands`;拿整平後的 GLB 再整平一次 = 這一顆被推了兩倍)+ **`--break-*` 的字面替換 MUST NOT 綁現值**(2026-08-14 實測:`--break-roof` 綁死 `masslow: { roof: 0.203 …}`,重量帶寬之後它是靜默 no-op、紅字由 2 條掉成 1 條而壞版根本沒被造出來 —— §5.4 ㋑)+ 名冊三處 MUST 同步(`BLD_LIB` 第三格連第五欄、`MASS.UVB`、`tri_budget`)+ `audit_auto_intake` + `audit_object_joints --seeds 8` + `audit_beacons` + `audit_client_syntax`(㋖)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js`/`sim.js` 一行未改)+ **㋓ `shot_facades`**(窗框與硬邊只有貼圖排面看得到;量化判準 = 窗邊「過渡 texel」佔比 MUST 從 22~30% 掉到個位數)+ **㋓ `shot_scene` 的 `mass_near`/`masslow_near`**(素牆帶長大之後那幾棟塔還讀不讀得出是辦公樓)+ **㋕ 貼著塔走一圈**(招牌不再浮在尖塔前面) |
| 整棟量體的**碰撞剖面 / 尺寸貼合 / 招牌落點 / 窗間距**(`bldProfile`/`profGeo`/`fitNode`/`fitScale`/`slabBox`/`bldFace`/`MASS.UVB`/`FACADES[].win`/`nodeProfile`/`--uvbands`) | `audit_siteplan` Ⅴ ±`--break-prof`/`--break-fill`/`--break-glass`(各紅 4 / 1 / 2 條)+ **`intake_parts`**(剖面宣告 = 實測、三帶 v 界、名冊涵蓋率)+ `audit_auto_intake` ±`--break-append`(名冊追加要連剖面一起補、撤下要逐位元可逆)+ `audit_object_joints --seeds 8` + `audit_beacons` + `audit_client_syntax`(㋖)+ **`npm run bal` / `npm test` MUST 逐項不動**(平衡與 sim 一行未改)+ **改剖面段數/名冊 MUST 回頭看 `LOS.MAX_OCC` 餘裕**(16 棟 ×(段數−1)根柱)+ **㋓:`shot_scene` 的 `mass_near`/`masslow_near` 與 `shot_facades`**(三帶接縫落在哪、無縫玻璃牆讀不讀得出來、撐滿基地後的比例,只有截圖看得到)+ **㋕:貼著塔走一圈**(退縮平台站得上去、上半段不再撞到空氣)+ `audit_traverse`(㋓;地面層通行寬理應逐位元不動) |
| 鏡像貼補 | ⚠ **先看 `docs/ai3d_runbook.md` §5aj-C**(改制待執行)+ `mesh_sym --gate` + **`node_sheet --ref`(四面黏土對照 —— 這一族的錯只有截圖看得到)** + `intake_parts`(外廓與預算 MUST 逐位元不動)+ `audit_object_joints --seeds 8` + `audit_beacons`/`audit_siteplan` + 3D 對照台 0-0-0 + ㋒ |
| 語意化地標 | `audit_beacons` ±`--break-extent`/`--break-pad` + `audit_object_joints`/`audit_gpu_lifecycle` + ㋒ |
| 世界文字 | `audit_world_text` ±反向驗證 + `audit_vernacular` + **`shot_signs`(㋓:版面與缺字偵測只有這裡看得到)** + `audit_visual_prefs`(旋鈕表多一個 `choices`)+ ㋔ + ㋒ |
| 在地文字語料 | `audit_vernacular` ±反向驗證 + `audit_world_text` + **重跑 `bake_venue_text.mjs`**(不重烤 = 底本走舊規則、執行期補收走新規則,兩份語料在同一張圖上打架)+ ㋒ |
| 角色 / 機體檔案格式 | `audit_codex` ±`--break-layer`/`--break-align`/`--break-pose` + `gen2d --audit` + `audit_hex_stats`/`audit_ui_layout`/`audit_ctrl_mode` + `audit_net_modes`/`audit_solo_boot`(新增客戶端模組)+ ㋒ |
| 機體台紙娃娃系統(`tools/humanoid_forge/` 的 `doll.js`/`shapes.js`/`mark.js`/`dollapply.js`/`dolledit.js`/`specstore.mjs`/`boardapi.mjs`/`refstrip.js`/`wpnview.js`/`board.css` 與 forge.js 的 `finishUnit`)/ **共用展示台**(`stage.js` 場景+演出+圖示工具列 / `versions.js` 版本表 / 兩座宿主 `viewer.js`·`codex_review/review.js` / `board.css` 的 `.fbar`) | `audit_paper_doll` ±`--break-stageseam`/`--break-pair`/`--break-morph`/`--break-rebuild`/`--break-twostage`(展示台那五支;每一支 MUST 對應紅字)±`--break-clamp`/`--break-key`/`--break-seam`/`--break-order`/`--break-roster`/`--break-patch`/`--break-socket`/`--break-overlay`/`--break-entry`/`--break-dollvis`/`--break-reframe` + **兩座看板各開一次**(㋕:編輯器/原型照帶/樣式/覆寫層全是共用的 —— 覆核台調比例之後機體台的紙娃娃 MUST 還在)+ ㋒(幾乎全在 `tools/`;`forgeMorphUnit` 只多交出兩棵子單位、遊戲端不讀 ⇒ `npm test`/`npm run bal` MUST 逐項不變)+ **㋕ 兩座看板各開一次**(這一族的鈕面與版面純視覺,離線只量得到結構)+ **㋕ 開一次機體台看變形**(2026-08-14 使用者:「新版展示台 UI 要跟舊版一樣,可以看變形過程」——「按了型態鈕台上沒反應」與「變形被砍成瞬切」在離線這端只表現成原文對不上,而原文是可以改對而行為仍錯的;逐版各切一次,`__forge.morphM()` MUST 是**連續**爬升而不是一步到 1)。兩條會靜默壞掉的線:①改 `mechs/<key>.js` 的**零件順序** ⇒ 舊覆寫會落到別的零件上(鍵 = 建構序路徑),MUST 在該機體台上目視覆核一次;②**純視覺的壞法(疊層蓋住機體、版面擠掉)離線稽核只量得到結構** ⇒ 動過任一座看板的版面 MUST 走 headless 入口實拍一張(`window.__forge.__shot` / `window.__cr.shot`,落盤路由住 `boardapi.mjs`)|
| 塗層阻擋 / 隧道頂板 | `audit_layer_block` ±反向對照 + `audit_underpass`/`audit_open_tunnel`(幾何 MUST 逐位元不變)+ ㋒ |
| 明隧道 | `audit_open_tunnel` + `audit_underpass` + `audit_slope_move` + `shot_tunnels`(㋓) |
| 地下道 / 結構資格閘 | `audit_underpass` ±反向驗證(`gMinOf` 只量中心線 / 拿掉基準線收斂 / 拿掉全寬拆縫) |
| 地圖主方位(`mapRot`/`rotXZ`/`llToXZ`/`xzToLL`/`battleRect`/`battleBBox`/`venueGrid.js`/`roadGridRotDeg`/`GRID_HW`/`main.resolveMapRot`/`biomes.fetchGridRoads`) | `audit_road_grid` ±`--break-drift`/`--break-dense`/`--break-relax`/`--break-rotbox`/`--break-rotover` + `audit_client_syntax`(㋖)+ 改角度推導或取樣面 MUST 跑 `bake_venue_grid --only manhattan,barcelona,chicago,kyoto,shibuya --dry`(㋓)並與 `venueGrid.js` 現值比對 —— **烘焙 MUST 冪等**,重烤跑出不同的值就是有人動到抓取範圍或量測框 + **`audit_world_edge`**(裙的原文沙箱自由變數清單要跟著走,漏一個就是 `ReferenceError` 而其餘原文斷言照樣全綠)+ `audit_ground_qc` ⑦ + `audit_weapon_gate` Ⅻ⑷(sim.js 的比例尺原文閘)+ `npm test`(**MUST 先重啟伺服器**)+ **`npm run bal` MUST 逐項不動**(旋轉是等距同構)+ 改 `gridAngle`/大馬路取樣面 MUST **重烤 `venueGrid.js`**(㋓)|
| 道路 16 方向量化(`roadgrid.js` / `biomes.js` 的接線) | `audit_road_grid` ±三支 `--break` + `audit_road_joint`/`audit_road_bed`/`audit_underpass`/`audit_open_tunnel`/`audit_bridge_crossing`/`audit_water_skirt`(走廊/橋隧全部吃量化後的同一份路網)+ `audit_siteplan`/`audit_ground_qc`(建物與擺件朝向取自道路)+ **`audit_traverse`(㋓:路網幾何動了,兵線與結構要仍走得通;沙箱降級的未驗結果 MUST NOT 當綠燈)** + 真機看一張市區圖(㋕)|
| 道路塗裝寬 / 結構接合 / 立體結構建置範圍 | `audit_road_joint` + `audit_underpass`/`audit_open_tunnel` 不變式 MUST 不動 |
| 道路路基整平 | `audit_road_bed` + `audit_slope_move` + 隧道兩支不變式 |
| 地形坡度移動 / `MAX_ROAD_GRADE_DEG` | `audit_slope_move` |
| 地形射線 / 打洞 | `audit_terrain_ray`(與暴力掃逐條一致;加速比 MUST 兩位數) |
| 可通行性 | `audit_traverse` ±`--break-slope`(㋓;另有四項**不需網路**的開挖鏡射行為直測) |
| `SOLDIER_H`/`HERO_SIZE.mul`/`BRIDGE_RISE`/`TUN.CLEAR` | `audit_traverse` 的「淨空」段(剖面寫錯基準是**完全無聲**的);機體高度 MUST 由 `heroTargetH` 推導,MUST NOT 手寫 4.5 |
| 攀爬路線 / 障礙橫斷面 | `audit_climb`(Ⅲ 兩端對同一盒同線段 MUST 同判) |
| 橋交會去重(`dedupeCrossingBridges`)/ 馬路橫切繞行(`skirtWaterClips`/`PED_HW`)/ 橋上砲塔墩座(`planTowerBridgePads`/`TOWER_PAD_AXIS`/`TOWER_BASE_R`) | `audit_bridge_crossing`(優先度 兵線 > 鐵路 > 大馬路 > 小馬路;鐵路容差 `gap=0` 只認真交叉)/ `audit_water_skirt`(斜交對稱穿越 MUST 建橋不繞;步道一律不進橋樑管線)/ `audit_bridge_tower_pad`(沿橋軸與水側走位帶 ≥ 基座 + 8m;`TOWER_BASE_R` 不變) |
| 迷你地圖(`MINI`/`towerStages`/`laneChainF`/`miniScaleF`/`mapScaleF`/`miniAllowed`/`miniOnlyFor` / 五支尺度函式的第二參數 / `solveTowerSites`·`towerLayoutAudit`·`towerTunnelAudit` 的 mini / `edgeBufferM(mini)`·`terrain.bufferM` / `venues.venueLaneKey`·`VENUE_LANE_KEYS`·`venueLaneModes`·`trimLaneTo`·`venueConfig` / `venueLanes.js` 的 `m1` / `bake_venue_lanes.mjs` / `mapSelect.setMini` / `rooms.validateBattleConfig` / main.js 的手機閘門) | `audit_mini_map` ±`--break-buffer`/`--break-stage`/`--break-team`/`--break-full` + **`npm run bal` / `npm test` MUST 逐項不動**(bal 的三個模型與 e2e 都不帶 mini ⇒ 動了就是漏到一般對戰上)+ `audit_map_rules`/`audit_lane_sep`/`audit_road_grid`(塔位求解多一個參數,完整版 MUST 逐位元不變)+ `audit_world_edge`(裙的深度改吃 `edgeBufferM(mini)` 並對外交出 `bufferM` ⇒ 原文錨點與沙箱自由變數要跟著走)+ `audit_beacons`/`audit_siteplan`/`audit_object_joints --seeds 8`(biomes 三處 solveTowerSites 多一個參數)+ `audit_ground_tile`(底毯的深度改讀 `terrain.bufferM`)+ `audit_client_syntax`(㋖)+ `audit_ui_layout`(新增分段鈕 + `UI_TIPS.miniMap`)+ `npm run audit:net`/`audit_solo_boot` + **㋓ 真瀏覽器開一場迷你的單機戰**(塔數 = 兵線 ×4、`terrain.bufferM` = 完整版 ÷3、兵線 1 條 —— 建圖那一半沒有任何離線稽核驗得到)+ **㋕ 手機真機**(四道閘門要真的擋得住,而「鈕面沒反應」在離線稽核上只表現成原文對不上)。⚠ 改 `MINI.STAGES` 或 `FULL_STAGES` MUST 回頭重跑 `audit_mini_map` Ⅵ(縮小比自己會跟著走,但塔位還塞不塞得下要重驗) |
| `venueLanes.js` 重烤 / 烘焙鍵(`VENUE_LANE_KEYS`/`venueLaneKey`/`venueLaneModes`)/ `TOWER_*` / `tower.range` | `audit_map_rules`(#4;逐鍵各驗自己的型態 —— 拿完整戰場的五階塔鏈去驗 `m1` 那條短兵線 = 整排假紅字)+ `audit_lane_sep` + `audit_lane_grade_sep`(#5)+ `audit_mini_map` Ⅴ・Ⅵ + `audit_story_map` Ⅰ・Ⅱ(劇情與迷你 2v2 的整份幾何 MUST 仍**逐位元相同** —— 兩者共用 `m1`,分家了就是鍵被拆成兩份)。⚠ **重烤 MUST 分批 `ONLY=`**:不帶 ONLY 時任何一個場地 Overpass 失敗就會被整個從表裡刪掉(`keep` 只在 ONLY 模式保留其餘場地),而畫面上只表現成「那張圖的兵線變成合成弧」 |
| 兵線導航規則(`UTURN_MAX_DEG`/`TURN_ACCUM_MAX_DEG` + 三支 audit/bake 閘門) | `audit_lane_navigation`;規則①③生效於既有場地需重烤(㋓)+ **`audit_traverse`**(前者驗幾何契約、後者驗「機體真的走得過去」,不可互相取代) |
| 場地場景標記 / `VENUES[].ll` / `MAPGEO` | `audit_lane_scenarios`(標記 MUST 由實測產生;③⑨ 分流只有 `spansWater()` 一支)+ 重烤(㋓) |
| 場地選單的路線/地形說明(`venueRoute`/`reliefTier`/`RELIEF_TIERS`/`venueTip`/`venueBrief`/`renderVenues`/`.venue-desc`) | `audit_ui_layout`;摘要 MUST 全由 `venueConfig()` + `laneTacticsXZ()` 推導(手寫長度/彎曲度 = 重烤兵線後靜默分家)、起伏門檻 MUST 是 `altTier()` 的倍數(與 ⑧ 判定同一把尺)、說明 MUST 走 `tip.attachTip`(MUST NOT 退回 `title=`)、換人數 MUST 重掛 |
| 塔或機甲任一數值 | 重算 `towerHp = 1.8 × heroEHP × heroDPS / towerDPS` |
| `MAP_EXPAND`/`CLEAR_F`/`LANE_MIN`/塔位 | headless 建 `BattleSim` 數 `sim.camps.length`(L1 2/2、L2 4/4、L3 6/6) |
| 地貌交界(`planSeamOverlays`/`SEAM_STYLES`/`seamAlpha`)/ 小區域組合風格(`planEnclaves`/`ENCLAVE_STYLES`)/ 都市規劃朝向(`ground.js` orient/`gridA`) | `audit_ground_seam` / `audit_ground_enclave`(**消費端 MUST NOT 硬編第二份組合表**)/ `audit_ground_qc` ⑦(垂直街道網 mod 90° 摺疊不抵銷;orient 固定抽 2 枚 rnd)—— 三支皆需 `audit_ground_qc` 全綠 |
| 功能性區塊 / 3D 物件互不重疊(`PATCH_GAP`/`DET_GAP`/`obbDist`/`obbNear`/`footNear`/`detailR`/`overlapPs`/`detFree`;2026-08-11 使用者定案「田/停車場/球場這類功能性區塊與 3D 物件等等也不可互相重疊」) | `audit_ground_qc` ⑤(執行原文 + 內建對照組:退回等面積圓的壞版本必須又放行互切案例)+ `audit_siteplan` + `audit_object_joints --seeds 8` + **`tools/shot_borders.mjs`(㋓:印「互相重疊 區塊/擺件」硬指標 MUST 全 0 —— 足跡自真品幾何反推,離線稽核看不到實際落點)** + ㋒。**判定 MUST 吃真實足跡**(rect 有向盒 / blob 手繪輪廓外接圓),等面積圓近似 MUST NOT 復辟;`PATCH_GAP` MUST < 陣列間隙 1.6 與家族延伸間隙 1.2(否則沿街格陣與農田拼布被自己的規則拆散);自然類↔自然類刻意維持 `SEP_F` 邊緣互融 |
| 地貌拼圖的顏色與花紋(`CARPET_LOT`/`carpetLotAt`/`CARPET_SEL`/`SUB_COL`/`colDist`/`carpetOrder`/`planCarpetVariants`/`CARPET_VARIANTS`/`baseFill`/`emitFace`/`face9`)、`CARPET`·`ZONES`·`ENCLAVE_STYLES[].carpet` 的權重、底毯點綴名冊(`DETAIL_DEFS`/`TILT`/`REG`/`AQ_DET`/`DIVE`/`scatterDetails`)、緩衝空間底毯(`BUF_CELL_F`)(2026-08-12 三項 + 2026-08-13 四項回報) | `audit_ground_tile` ±`--break-lot`/`--break-var`/**`--break-order`**(對照組 = 舊制,內建)+ `audit_soft_stroke`(Ⅷ 直接執行 `DETAIL_DEFS` 原文 ⇒ 新零件用到的每一支 `BufferGeometry` 就地變換都要在那支樁上,漏了整支稽核爆掉而理由與軟性無關)+ `audit_ground_seam`(**同款異變體不發外溢**;鏡射實作要跟著有這一條)+ `audit_ground_enclave`/`audit_ground_border`/`audit_ground_qc` + `audit_siteplan`/`audit_object_joints --seeds 8`(底毯選款一換,`scatterDetails` 撒的細節種類跟著換)+ `audit_world_edge`(緩衝空間多了一層底毯,裙本身一格未動)+ `audit_client_syntax`(㋖)+ **`shot_scene --dof=0 --curve=0` 的 `edge_far`/`hilltop`/`lane_mid`(㋓:「緩衝空間看起來是不是一床方塊拼被」「顏色是不是還在跳」只有實拍看得到 —— 離線稽核只量得到換色間距的中位數)** + `shot_borders`(㋓)+ ㋒ |
| 陸域地貌認養地形三角形(`emitCell`/`inQuad`/`invBil`/`cellQuads`)| **`audit_ground_tile` Ⅳ ±`--break-adopt`** + **`audit_ground_drape`(㋓,唯一量得到「破圖率」的地方;底毯/外溢/界線 MUST 全 0.0%,而穿出量 p99 MUST **恰等於**各自的 lift —— 那個數字就是共面的指紋)** + ground 那一批(ground_seam/enclave/qc/border:規劃層一行未改,MUST 逐項不變)+ `audit_cel_pipeline`(貼地 (0,1,0) 與 `pushLandN` 仍逐一配對)+ `audit_siteplan`/`audit_beacons`/`audit_object_joints --seeds 8`(灘線閘仍整格判 ⇒ `landCells` 與**共享 rnd 序列逐位元不動**,散布序列不得推移)+ `audit_client_syntax`(㋖)+ **㋒ 逐位元**(`data.js`/`sim.js` 一行未改)+ 改認養候選範圍或抖動幅度 MUST 回頭看 `orphans`(結構上恆 0)|
| 農田田埂 / 田塊對齊(`BUND`/`FARM_GAP`/`emitBund`/`BUND_SUBS`/`withCluster`/家族延伸 rect 分支)| **`audit_ground_qc` ⑧**(對齊反解、`FARM_GAP = 2×BUND.HW` 的**行為證明**「兩塊正鄰位的埂真的接上」、斷面繞向、叢集門檻)+ `audit_ground_drape` 的 `patch` 層(㋓;田埂進特徵層那一批)+ `audit_cel_pipeline`(多一層掛 `landNrm` 的貼地件:埂頂吃地形法線、垂直面吃自己的面法線)+ `audit_ground_tile`/`ground_seam`/`ground_border` + `audit_siteplan`/`audit_object_joints --seeds 8`(**對齊反解會位移 rnd 序列** ⇒ 這些不是「逐位元不動」而是「仍全綠」)+ **㋕ 真機走到田邊看一次**(埂有沒有厚度、兩塊之間有沒有接上,只有站在地上看得到)|
| 農牧地表四季(`SEASON_I`/`groundTex` 的 season / DEFS 的 `seasonal` / 新地表 `pasture`)| **`audit_ground_tile` Ⅴ**(抽畫筆原文餵記錄型假 2D context:四季兩兩 MUST 畫出不同的東西**且不只是換底色**;名冊對齊;季節只進快取鍵)+ `audit_ground_enclave`(新地表要在 DEFS∩SIZE 內)+ `audit_ground_qc` ⑧(`pasture` 進了 `rectFarm` ⇒ 自動有埂)+ `audit_client_syntax`(㋖)+ **㋓ 同一個機位拍四季各一張**(「秋天的水田是割過的稻茬」這種事離線只驗得到指令流不同,驗不到它像不像)+ ㋒(`data.js`/`sim.js` 一行未改)|
| 地被貼合抬升(`SAG`/`groundSagAt`/`drapeSag`/`?sag=0`) | **`audit_ground_drape` ±`--break-sag`(㋓)** —— 這一族**沒有任何離線防線**:皮沉在地形下多少,只有拿真的幾何去減真的地形才量得到,而每一支既有稽核在破圖 22% 的那一版上照樣全綠。至少跑一個山區場地(taroko)+ 一個平原(shibuya):**平地 MUST 幾乎全 0**(平面恆 0 是這一層的設計不變式,平地也動 = 公式寫反了)+ `audit_ground_tile`/`ground_seam`/`ground_enclave`/`ground_qc`/`ground_border`(選款/交界/界線一行未改,MUST 逐項不變)+ `audit_siteplan`/`audit_beacons`/`audit_object_joints --seeds 8`(抬升**零 rnd 消耗** ⇒ 散布序列不得推移)+ `audit_client_syntax`(㋖)+ **㋒ 逐位元**(`data.js`/`sim.js` 一行未改)+ 改上限或尺度 MUST 回頭看 **lift 階梯**(底毯 0.07 < 外溢 < 界線 < 道路 0.18:`ROAD` 上限就是為那 0.11 的餘裕訂的)與 **`buildBiomes` 建構時間**(逐頂點 32 次高程取樣,實測 +30%)|
| 地貌界線拼圖(`planBorderPuzzle`/`BORDER_KINDS`/`BORDER_STYLES`/`borderKindOf`/**`borderCornerArc`**;16 方向直線/轉彎/岔路,接力連結;**轉彎與岔路是整片畫出來的接頭拼圖** —— 直段退縮讓位、圓弧與兩臂相切、逐臂楔形在中心交會,MUST NOT 退回對接+墊片)/ **繞向 `sweepUpY`** / **兩側切線 `BORDER_CUT`+`borderCutAlpha`+`planSeamOverlays` 的 `hardOf`** / **帶量測 `BORDER_BAND`+`bdCross`** / **同地貌的色距窄門 `CARPET_DE`+`BORDER_SAME_ZONE`** / **帶內強制乾地 `bandDryAt`**(2026-08-11 三項 + 2026-08-13 兩項回報) | `audit_ground_border` ±**`--break-de`**(對照組 ⓐ~ⓗ 內建)+ `audit_ground_seam`(subCoarse 仍一份 / 切線判準轉呼 `borderKindOf`)+ `audit_ground_qc` + `audit_siteplan`(拼圖迴避改了 `tryPatch` 的前置閘)+ `audit_object_joints --seeds 8` + `audit_client_syntax`(㋖)+ **`tools/shot_borders.mjs`(㋓:26 種底毯地表兩兩 325 組的實拍圖錄;走真品 `buildGroundCover`,取景瞄真的畫出來的分界線頂點並與 `borderKindOf` 雙向核對,並印出**「橫跨分界線」硬指標 MUST 全 0**(拼圖與擺件的迴避住 `tryPatch`/`addDetail`,那兩支要 THREE ⇒ 離線稽核碰不到)—— 「哪一組交界看起來不對」只有這裡看得到)** + ㋒。**同地貌色距窄門**(2026-08-13「顏色劇烈變化處也使用對應地貌的分界線覆蓋」):`borderKindOf` 的同地貌分支只由 `colDist ≥ CARPET_DE.LINE` 觸發、種類取 `BORDER_SAME_ZONE`(一地貌一種,水域刻意沒有);門檻**兩個方向都要有牙**(小色差恆 null 才守得住 2026-08-11「同地貌不畫線」的網狀病灶,大色差恆有線才是這一輪的定案),稽核另量「排序後的相鄰對有幾對跨門檻」(0 = 規則永遠不生效、過半 = 又切回網狀)。**帶內強制乾地**(2026-08-13「確保水域/沼澤在分界線的區塊內不會觸發異常狀態」):底毯換手在**畫出來的那條線**上而 `terrainEnvCode` 量的是真實地形,最多差半個帶寬(最寬 9m)⇒ 站在沙灘圖案上卻被判泡在水裡。遮罩 `bandDryAt` 由 ground.js 產出(純幾何、半徑取**逐段** `hwOfKind`)、`biomes.terrainEnvCode` 消費、**`main.js` 在 `buildBiomes` 之後、`bakeWetGrid` 之前**裝上;`buildBiomes` 開頭 MUST 清成 null 且 ground.js MUST NOT 讀它 —— 建圖期底毯分區自己就吃 `terrainEnvCode`,提前掛上就是「界線改分區、分區又改界線」的循環,而症狀是同一張圖每次建出來都不一樣(每一格都還是照規則選的,沒有任何既有斷言看得見)。**這是本專案唯一一處由表現層規劃反過來決定權威水沼分類的地方**(2026-08-13 使用者在被告知與原則 4 的張力後仍選這條路),MUST NOT 擴大適用範圍 |
| 小地圖顯示範圍 | `audit_minimap_view` |
| 視野鎖定 | `audit_view_lock` + `audit_touch_layout` + `audit_ui_layout` |
| 觀戰相機 | `audit_spectator_cam` + `audit_ctrl_mode` Ⅶ + `audit_touch_layout` + `audit_ui_layout` + ㋒ |
| 受擊濺血 | `audit_blood_splat` + ㋒ |
| 致盲白幕 / 蓄力跳 | `audit_cc_flash` |
| 操作方式 / 戰場選單 | `audit_ctrl_mode` + `npm test`「操作方式由房主選擇」段(**MUST 先重啟伺服器**,見 5.2)+ `audit_touch_layout` + `audit_ui_layout` |
| 懸浮提示 / 按鍵風格 / 房間設定分頁 / 圖示 | `audit_ui_layout` 0.5 段 + `audit_ctrl_mode` Ⅲ + `audit_touch_layout` + ㋒ |
| `mobile.js`/`_applyLook`/`_moveAxis`/`_cmd`/觸控 CSS | ①桌機 MUST 不回歸 ②`audit_touch_layout`(四分區零重疊、觸控目標 ≥44×40、`.tl-sys` 固定 grid)③疊層可點性 ④`audit_touch_gesture` |
| 橫式商店兩欄 / 全螢幕方向 | `audit_touch_layout` 升級工坊段(六種持握)/ `audit_ctrl_mode` Ⅶ(原文無 `orientation.lock`、`unlock()` 恰兩處) |
| `#touchLayer` 節點位置 / `--tl-*` | 搖桿 MUST 留 body 層 + 保留 `body.touch-ui` 保險預設值;真機大廳端對端量測 |
| 選單版型 / 任何鈕面文字 | `audit_ui_layout`(鈕面無括號補述、桌機並排直式維持並排、`.cd-art` 解除 sticky、疊層 ✕ 規則) |
| 陀螺儀(`Gyro`/`gyroSrc`/`LOOK.GYRO_*`/`TOUCH.gyro` 預設值) | `audit_gyro`(兩感測路徑、俯仰同號、自動切換、**宣告的預設值為關**)+ `audit_ctrl_mode` Ⅶ(預設值的 CI 版斷言 —— audit_gyro 要 playwright,沒裝就整支跳過)+ **MUST 用 https/localhost 真機測**(非 secure context 靜默無感測事件) |
| FPV 座艙(`COCKPIT` 任一格 / `ndcFrac` / `INK_W` / `COCK_BODY` / `_cockBody` / `_frameCockpitStruct` / `_mountCockpitWeapon` / `_syncCockpitWeapon` / `HUD_BOTTOM_F` / `fitHudBand` / CSS `.hud-bottom`) | **㋓ `audit_cockpit`**(取景四規則 + 中央九宮格淨空 + 單件 ≤5% + 狙擊零零件 + HUD ≤1/6)±**五支** `--break-single`/`--break-scope`/`--break-hud`/`--break-grid`/`--break-anim`(每一支 MUST 對應紅字;`SVS_URL` MUST 指向**本工作區**的埠)。⚠ **準星錐那一欄的最小值 MUST ≥ 12.7°** —— 那是中央格邊中點的張角,低於它就是夾制沒有真的認格(而錐那一欄仍會綠)+ `audit_ui_layout`/`audit_touch_layout`/`audit_ctrl_mode`(HUD 帶換了尺寸;**觸控版那一層 MUST 逐項不動** —— 它的版面是逐格量出來的)+ `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot`+ `audit_view_lock`/`audit_spectator_cam`/`audit_npc_collide`/`audit_gpu_lifecycle`/`audit_layer_block`/`audit_slope_move`/`audit_climb`(㋔ game.js)+ **`npm run bal` / `npm test` MUST 逐項不動**(純表現層:`data.js`/`sim.js`/伺服器一行未改)+ **㋓ 定裝照**(逐機體把座艙畫在灰底上、疊**九宮格**與準星錐與頂緣線:「這一台的座艙看起來不是這一台」「某幾台的座艙是空的」這兩種壞法**每一條斷言都會過**;`_cockBody` 的取件數 MUST 逐機體 > 0)+ ㋕ 真機開一場(進出狙擊模式各一次:零件 MUST 全消失、退出 MUST 全回來;**帶旋翼的機體看槳盤真的在轉**;榴彈機體壓低準星看砲管抬起來)。⚠ 動畫那一族的壞法**每一條靜止斷言都會過** —— 新增任何「座艙裡會動的東西」MUST 同時決定它走哪一條:進 `cockpitSpin`/`cockpitFlap`(建構期取樣)或進 `_solveGunPose` 的反解(動畫幅度) |
| 英雄機體建模(`geo3d.js` / `forge/**` / `makeUnit` 的 hero 分支 / `locomotion.morphSwap` / `charPreview` 的變形把手) | **㋓ 三支真瀏覽器稽核**(`SVS_URL=http://localhost:<本工作區的埠>` —— 8620 上常跑著**另一個 checkout**,在那裡驗到的是別份程式碼而且不會報錯):`audit_muzzle`(32 英雄槍口朝向/位置/後座)、`audit_cockpit`(FPV 取景四規則)、`audit_cast_jump`;+ `audit_paper_doll`(收尾鉤 + 兩座看板同形)+ `audit_codex` + `audit_cel_pipeline`(`outlineW` 換家、只准一份)+ `audit_client_syntax`(**名冊 MUST 遞迴子目錄**,否則 `forge/` 那 42 支全落在名冊外)+ `npm run audit:net`/`audit_solo_boot`(新增客戶端模組)+ **`npm test` / `npm run bal` MUST 逐項不動**(`data.js`/`sim.js`/伺服器一行未改)+ ㋕ 真機開一場戰鬥(建模那一半沒有任何離線稽核驗得到)|
| 變形者的變形過程(`morphrig.js` 全檔 / `forge.js` 的 `forgeTagged`·`captureMorphPlan`·`relTRS`·`trsOf`·`fadeEntry` / `locomotion.js` 的 `morphSwap`·`morphPose`·`morphSide` / 任一支 `mechs/*_flight.js` 的擺位) | `audit_morph_rig` ±**七支** `--break`(每一支 MUST 對應紅字)+ `audit_gait_anat`/`audit_paper_doll`(locomotion 多一支 post-pass、forge 多一段建構期反推;兩者 MUST 逐項不動)+ `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot`(新增客戶端模組 morphrig.js)+ `audit_gpu_lifecycle`/`audit_cel_pipeline`(淡入淡出改的是**材質實例**的 `transparent`/`opacity`/`depthWrite`,原值 MUST 記下來還原)+ **`npm run bal` / `npm test` MUST 逐項不動**(純表現層:`data.js`/`sim.js`/伺服器一行未改)+ **㋓ `tools/shot_morph.mjs`**(這一族唯一看得到「像不像在變形」的地方 —— 對應錯一組的症狀是某塊裝甲橫飛過機體,而**換樹落差仍是 0**:兩棵樹會**一致地**錯,離線斷言照樣全綠)+ **㋓ `audit_muzzle`**(飛行槍口那一條 MUST 讀 `rigAir` —— 地面型那一棵自 2026-08-15 起會跟著擺到飛行佈局,拿它量出來的數既不是地面型也不是飛行型的設計值)+ ㋕ 真機蓄力跳起飛一次。⚠ 改 `MORPH_FX.HALF`/`FADE` MUST 回頭看 `shot_morph` 的換樹落差(帶內 MUST 恆 0);改任一 `mechs/*_flight.js` 的建構器**呼叫順序**會讓標籤序號重排 ⇒ MUST 重跑 `shot_morph` 看對應率有沒有掉 |
| 步態關節曲線 / 交戰姿態 / 跳躍分級(`gaitcurve.js` 全檔 / `locomotion.js` 的 `flexChain`·`stepQuad`·`stepBiped`·`stepAerial`·`stepJumpPose` / `forge.js` 的 rig `limb` / 任一台 `gait.limb`) | `audit_gait_anat` ±**五支** `--break`(每一支 MUST 對應紅字)+ `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot`(新增客戶端模組 gaitcurve.js)+ `audit_paper_doll`(機體台走真品 `stepLocomotion`,rig 契約只多一個欄位)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js`/`sim.js`/伺服器一行未改 —— 動了就是純表現層漏到判定上)+ **㋓ `audit_muzzle`/`audit_cockpit`/`audit_cast_jump`**(槍口朝向與座艙取景吃的是骨架每一幀的姿勢,步態一改就要重驗;`SVS_URL` MUST 指向本工作區的埠)+ **㋕ 真機各看一次**:四足小跑/襲步(前腕在撐地那半週期 MUST 不動、後跗 MUST 跟著膝一起沉)、六足三角步態、奔跑中開火(槍口 MUST NOT 隨步伐左右掃)、撲翼機開火(MUST 停拍)、蓄力跳(頂點 MUST 收腿、落地 MUST 比小跳蹲得深)—— 這一族的壞法全部只表現成「動起來怪怪的」,沒有任何錯誤訊息 |
| 骨架 / 關節 / 步態 / 武裝掛點 | 全角色 rig 稽核 + `audit_cast_jump` + `audit_muzzle`(32 英雄 + NPC 四陣營) |
| 三種遊戲機制 / 單機打包 | `audit_net_modes` + `audit_solo_boot` + `npm test` 單機段與 WS 全段 + `audit_ui_layout` |
| 路網中繼(`osmrelay.js` / `biomes.js` 的定案表與兩支 fetcher / `main.js` 的 `osmGate`·`onOsmRelay` / `rooms.js` 的 `t:'osm'`) | `audit_osm_relay` ±`--break-monotone`/`--break-clone`/`--break-wait`/`--break-cache`/`--break-label` + `npm run audit:net`/`audit_solo_boot`(新增客戶端模組 + rooms.js 多一條 import)+ `npm test`(**MUST 先重啟伺服器**;WS 段有中繼來回的行為直測)+ `audit_client_syntax`(㋖)+ biomes 那一批(siteplan/beacons/open_tunnel/underpass/road_joint/world_text/object_joints;圖資輸入的來源變了,幾何 MUST 逐項不動)+ **`npm run bal` 與 `npm test` 的模擬段 MUST 逐項不動**(平衡與 sim 一行未改)+ 改任一上限或動到 Overpass 查詢額度 MUST 重跑 **`tools/measure_osm_relay.mjs`**(㋓;實測 5v5 密市區 1.05MB = maxPayload 餘裕 1.9× / MAX_BYTES 餘裕 1.6×,不厚)+ **兩台同房實測(㋕:一台開房、一台入房,比對橋隧與建物;中繼壞掉的症狀是「你說的那座橋我這邊沒有」)** |
| 區網同時多路徑 | `audit_net_modes` ⑥(含起真 server 打四路的行為直測)+ `npm test` WS 全段 |
| 主堡陣營歸屬對調(`rooms.rollSideSwap`;開房 + 再戰回房各擲一次) | `audit_net_modes`(實作一份、恰兩處呼叫、**MUST NOT 移進 `startBattle`** —— 那會讓客戶端房間階段的地形預建整份作廢)+ `npm test` 該段(**MUST 先重啟伺服器**) |
| 開發工具啟停 / dev 對照台 | **`npm run audit:net` ⑦ 段**(全專案唯一「HTTP 進來 → spawn 行程」的路徑 ⇒ 閘門本身就是要驗的東西)+ `audit_ui_layout` (8) 段(`main.js` **一個埠號都不准寫死**)+ `npm test`(伺服器有動,不是 ㋒) |
| 採集端 / 圈選分離篩選(`tools/ai3d/*`) | `audit_split_targets.py` ±`--break-contain`/`--break-erode`/`--break-touch` + `fetch_photos --plan`/`--adopt` 行為直測 + `harvest_loop --dry` + `intake_parts`(讀取縫未動 ⇒ MUST 逐項不變)+ ㋒(全在 `tools/`,遊戲一行未動) |
| 採集迴圈啟停 / 圖檔三態 / dev 工具型錄 | **`npm run audit:net` ⑦ 段**(逐工具依 `kind` 分流:job MUST 無埠、存活判準是子行程;含起真 server 打 `/dev/tools` 的行為直測 —— **逐支真的啟停一次**那一段是這一族唯一驗得到「按下去到底有沒有反應」的地方)+ `audit_auto_intake` Ⅸ ±`--break-spawn`/`--break-panel`/`--break-home-arg`/`--break-on` + `audit_solo_boot`(dev_supervisor 多一條 import)+ `audit_ui_layout`(`main.js` 一個埠號都不准寫死;鈕面 MUST 讀推導欄 `on`)+ **`npm test`**(server.js 那條路由的後端動了)+ 起零件台**用非預設埠**實測(㋕;8622 跨 session 存活 ⇒ 在預設埠上驗到的是舊程式碼)+ **真的按一次那顆鈕**(㋕:兩個入口都要 —— 遊戲設定頁與零件台窄帶;「鈕面沒反應」在離線稽核上只表現成原文對不上,而原文是可以改對而行為仍錯的) |
| 封存區 / 判決字彙 / 來源帳鍵 / 重跑順位 | `audit_auto_intake` Ⅷ・Ⅺ ±`--break-keys`/`--break-redo`/`--break-archive` + `parts_review --report`(**封存那幾列 MUST 印得出來**;缺件/孤兒/未記載仍三個 0)+ `apply_verdicts --dry`(行為直測:archive 分支要印「撤節點並封存」且來源圖張數 **> 0** —— 印 0 就是鍵的正規化又壞了)+ `harvest_loop --dry` 開關 `--no-redo` 各一次(重跑張數 MUST 只差在那一項)+ ㋒(工具動了,遊戲沒動) |
| 自動入庫 / 撤下 / 判決迴路 | `audit_auto_intake` ±`--break-append`/`--break-rollback`/`--break-blacklist` + `intake_parts` + `parts_review --report`(缺件/孤兒/未記載 **三個 0**)+ `apply_verdicts --dry`(**行為直測**:輪替名冊 ≥2 的煞車與單一字串格的擋下都要看得到)+ `harvest_loop --dry`(新的 ⑦⑧ 兩站要印得出來)+ `audit_siteplan`/`audit_beacons`/`audit_object_joints --seeds 8`。**工具動了但遊戲沒動 ⇒ `npm test`/`npm run bal` MUST 逐項不變**;真正跑一次入庫要 Blender + GLB ⇒ ㋓(3060 那台) |

### 5.6 AI 退化量測(bot 改動專屬)
- **MUST NOT 拿 `npm run sim` 的勝負旗標** —— 5v5 塔+主堡總 HP 數十萬,改前改後在 1800s 上限內一律「未分勝負」,二元訊號天生飽和。
- 判準以**變異小的結構性指標**為準:`繞行%`(`_skirtUntil` 生效的 tick 比,高難度 5v5×600s ≈ **4.0%**,SD≈0.2 —— 全套指標裡唯一精確的一個;卡死就會飆高)≫ `engage%`(≈ **9%**;視野錐有沒有誤殺交戰機會看它)≫ 開火數。工事損血只用來看有沒有塌到量級外。
- **樣本數 MUST 跟著場景規模走**:5v5×600s 的單場工事損血在 433~10298 之間跳 ⇒ n≤3 能同時「證明」變好與變壞(2026-08-02 兩個方向各踩一次,補到 n=6 才看出值域幾乎完全重疊)。2v2×240s 的基準是 **24 場**平均(高難度:工事損血 ≈3600、擊殺 ≈76、RALLY 佔比 ≈0.10 —— RALLY 佔比衝到 0.3 以上就是「bot 一直在撤退」)。
- **取 base 對照時 `git stash` 不可靠**(變更已 commit 就是 no-op,會安靜地拿新程式碼當基準;切分支也會污染仍在跑的背景樣本)—— 一律 `git show <rev>:path` 把 `sim.js`/`bots.js`/`data.js` 三支倒進暫存目錄各跑各的。
- 定位分類專屬:定位版 vs 關掉 `_resolveRole` 的同一批 bot 做 **CRN 配對鏡射**自對戰,量工事損血差。

---

