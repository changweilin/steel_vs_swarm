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
node tools/audit_visual_prefs.mjs    # 畫面旋鈕 / 陰影偏色 / 風化場 / 抖動 / 景深 / **3D LUT 取代不疊加 / 斜向轉場(縫 + 呼叫端)**
#   ±--break-lutstack(LUT 改查已經被 split-tone 動過的顏色 ⇒ Ⅶ MUST 紅)
#   ±--break-wipe(閘門退成無條件 + 幕的端點不再外推 ⇒ Ⅷ MUST 紅 2 條,而 Ⅷ-b 順序 MUST 仍綠)
#   ±--break-wipepair(`_wipeCut` 只遮不揭 ⇒ Ⅷ-h MUST 紅 2 條:「成對」與「`playWipe` 恰三處」——
#                     後者是同一個缺陷的第二個指紋,而 Ⅷ-i/j 的重入守衛與狀態閘 MUST 仍綠)
node tools/audit_soft_stroke.mjs     # 軟性物質(細勾線 + 飄揚 + 陣風 + 海浪 + 稻/草/芒草波 + 國旗)
#                                    #  + **玩家位移擾動 + 岸邊泡沫/倒影 + 墨線斷筆 + 掠射抑制項恰一項**
#   ±--break-ink/--break-anchor/--break-wave/--break-gust
#   ±--break-char(位移加項拿掉)/--break-charR(擾動半徑換成常數)
#   ±--break-charslot(空槽不再顯式歸零 ⇒ 行為直測 MUST 紅 2 條)/--break-foam(泡沫不由水深驅動)
#   ±--break-inkbreak(alpha 寫入點退回 `= uSoftInk;` ⇒ Ⅱ + Ⅺ MUST 紅 2 條)
#   ±--break-inkanchor(斷筆錨點帶回平移欄 mat3 → mat4 ⇒ Ⅺ MUST 紅)
#   ±--break-graze(深度門檻再疊一項 `+ ( 1.0 - nz )` ⇒ Ⅺ「兩者擇一」MUST 紅)
node tools/audit_daynight.mjs        # 時間流逝(日夜循環)+ 太陽/月亮軌道 + 主光換手 + 影子
#   ±--break-clock/--break-fade/--break-elev/--break-cockpit/--break-range
node tools/audit_cel_pipeline.mjs    # 賽璐璐管線(ramp / 天空 / 地形色階 / 描邊寬度 / 地貌不出接縫
                                     #  / **gInfo.a 半位元組打包 / 表面群組 / 內部折邊抑制 / 地貌分區子帶
                                     #    / 溶入 / 霧 ≡ 勾線淡出 / 賽璐璐學派**)
#   ±--break-scale/--break-inkinfo/--break-land/--break-lutland
#   ±--break-contrib(貢獻從編碼與寫入端一起拿掉 ⇒ Ⅷ①② + 寫入端條 MUST 紅 4 條)
#   ±--break-occl(最近面覆寫改成 mix ⇒ 「結果只會是 0 或 1」MUST 紅)
#   ±--break-nearest(附件 1 改回線性內插 ⇒ NearestFilter 那一條 MUST 紅)
#   ±--break-selff(SELF_F / GRAZE_K 寫回 1.0 / 0.0 ⇒ 兩條 MUST 紅)
#   ±--break-grp(群組早退整段刪掉 ⇒ 「五格同號且至少一格是 GROUP」MUST 紅)
#   ±--break-dissolve(discard 錨點挪到 opaque_fragment 之後 + 快取鍵拿掉 D + 死亡閘改成恒 true ⇒ Ⅸ MUST 紅 3 條)
#   ±--break-landink(子帶改用計畫字面的 `* 0.1` + 拿掉拉桿閘 ⇒ Ⅸ MUST 紅 3 條)
#   ±--break-fade(淡出錨回相機 far 平面 ⇒ Ⅹ MUST 紅 3 條)
#     ⚠ 既知粗糙處:這一支會在印完 3 條紅字之後以 TypeError 收場(壞版把 `_inkFadeM` 整支刪掉,
#       而後面那段行為直測還要 `.exec(P)[0]`)。仍以 exit 1 收尾 ⇒「MUST 紅」成立,但訊息會蓋在堆疊底下
#   ±--break-school(School B 的 ramp hook 換回查表 + 硬切重組整段刪掉 ⇒ Ⅺ MUST 紅 4 條,
#                   而 Ⅰ 的 ramp 斷言與 audit_visual_prefs Ⅱ MUST 仍全綠 —— 它們守的是仍在服役的 School A)
#   ±--break-cutfloor(暗側地板改成手寫 0.25 < 102/255 ⇒ Ⅺ 的 A14 ② MUST 紅 2 條)
#   ±--break-neutral(拿掉暗側亮度重正規化 ⇒ Ⅺ 的 A14 ③ MUST 紅 2 條,含 28665 組的數值恆等式)
#   ±--break-cutorder(bands 4 的帶改得比 3 還窄 ⇒ Ⅺ 的硬度階梯 MUST 紅)
#   ±--break-schoolmix(多一處繞過 toon.js 的裸 MeshToonMaterial ⇒ Ⅺ⑧ 凍結名冊 MUST 紅)
#   ±--break-shadowtype(投影型別換回 PCFShadowMap ⇒ Ⅺ⑨ MUST 紅)
node tools/audit_struct_ink.mjs      # 立體結構的線工授權(⑨:零原生材質 / 貢獻推導不手寫 /
                                     #  坑門混凝土共用具名號 / 底色凍結 + 提亮只准 emissive / 零 rnd)
#   ±--break-rawmat(結構區塊多一支原生材質 ⇒ Ⅰ MUST 紅)
#   ±--break-contrib(貢獻改手寫常數 ⇒ Ⅱ MUST 紅 3 條)
#   ±--break-surf(三處具名號拿掉 ⇒ Ⅲ MUST 紅 2 條)
#   ±--break-emissive(換淺底色代替 emissive ⇒ Ⅳ MUST 紅 4 條)
node tools/audit_leaf_card.mjs       # 葉片卡冠層 / 整棵樹的剪影(張數推導 / 外廓 ≤ 保險絲冠幅 / 零共享 rnd
                                     #  / 佈局只讀 p.g / 無 MRT 必退回)
#   ±--break-count(張數改逐型手寫)/--break-fuse(包絡改讀庫幾何)
#   ±--break-rnd(抖動改吃共享 rnd)/--break-mrtgate(能力與群組閘拿掉)
node tools/audit_rock_ink.mjs        # 剪影優先:巨岩兩群組 / 石堆逐款一號 + 貢獻由 detailR 推導 / 遠景背景的注入
#   ±--break-rocksurf(巨岩群組指派整段拿掉)/--break-detsurf(取號移進內層零件迴圈)
#   ±--break-ctr(貢獻改手寫常數)
node tools/audit_ambient_motion.mjs  # 環境動態(落花 / 落葉粒子:季節閘 / 色調推導 / 分群 / 兩頻率 / 自轉軸
                                     #  / 沿中心線環繞 / 預跑 / 亂數帳 / 接線契約)
#   ±--break-tone/--break-petal/--break-spin/--break-wrap/--break-prewarm/--break-rnd/--break-shared/--break-off
node tools/audit_water_edge.mjs      # 岸邊泡沫的深度場(烤 + 蓋章)/ 水面倒影塊的名冊與幾何 / 舊泡沫退場 / 純表現層
#   ±--break-foam(烤場不再讀地形高度 ⇒ Ⅰ 紅 3:陸地 / 深水 / 列欄序;四條控制組仍綠)
#   ±--break-stamp(蓋章退回外接圓 ⇒ Ⅱ 紅 1:盒外那一點被誤蓋;兩條「盒內」對照組仍綠)
#   ±--break-refl(倒影名冊不排除邊界牆環 ⇒ Ⅲ 紅 2;上限 / 全序 / MIN_H 三條仍綠)
#   ±--break-fade(倒影的 seaFade 不再除以寫入處數 ⇒ Ⅲ 紅 1)
node tools/audit_gpu_lifecycle.mjs   # 表現層資源生命週期(A25)+ RES_GOV
node tools/audit_damp_fps.mjs        # 幀率無關阻尼(lerpFPS / frictionFPS 唯一縫)+ 背景分頁的 dt 夾制
#   ±--break-damp(逼近權重換回 min(1, k·dt) ⇒ 互補/可加性/幀率無關三條 MUST 紅)
node tools/audit_anim_weights.mjs    # 動畫權重向量(⑥-3;縫恰一份 / 離地門檻注入 / 三軌和 = 1 / 缺欄不回 NaN)
                                     #  + **⑤-1 植被擾動的餵入端**(Ⅶ)
#   ±--break-second/--break-thresh/--break-sum/--break-gate/--break-hand
#   ±--break-tread(killswitch 的早退拿掉 ⇒ 「?tread=0 回空陣列」行為直測 MUST 紅)
#   ±--break-charspd(速率改由 _charSlots 自己再推導一次 ⇒ 「沒有第二份速度推導」等三條 MUST 紅)
#   ±--break-charorder(餵入點移到 _updateEnts 之前 ⇒ 順序那一條 MUST 紅)
node tools/audit_audio_layers.mjs    # 音效層級(地點床名冊與優先序 / 乾濕同相 / 多 take / 低記憶體階梯 / CC0 來源帳)
#   ±--break-prio/--break-base/--break-margin/--break-sync/--break-take/--break-tier/--break-licence
node tools/audit_gait_anat.mjs        # 步態關節曲線(前後肢拓樸/佔空比/等速後掠/站姿型/跳躍分級/交戰姿態)
#   ±--break-lock/--break-duty/--break-hip/--break-rest/--break-posture
node tools/audit_morph_rig.mjs       # 變形過程(兩態零件對應 / 反推的共同錨 / 換樹接得上 / 淡出淡入時間表)
#   ±--break-class/--break-defer/--break-fade/--break-rest/--break-anchor/--break-post/--break-once
node tools/audit_object_joints.mjs   # 程序生成零件接合(--seeds 8)
node tools/audit_siteplan.mjs        # 都市計畫 / 樹冠羞避 / 地質排列 / 聚落場 / 整棟量體 / 平面整平
#   ±--break-line/--break-shy/--break-strike/--break-gate/--break-mass/--break-mass2/--break-roof
#   ±--break-prof/--break-fill/--break-glass/--break-flat
node tools/audit_beacons.mjs         # 語意化地標
node tools/audit_world_text.mjs      # 世界文字(圖集 / 版面 / 裝箱 / 接線);±--break-cache
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
node tools/audit_zone_cut.mjs        # §0-a 線工切面可行性樁(Ⅰ~Ⅴ 離線;CI 收得到)
#   --census                            # 只印 29 場地普查(序 14 貼圖規格的論據)
#   --venue <id> --team <n> [--tex 2048] [--png] [--sweep-rank] [--sweep-areamin]
#   ±--break-quantize(MUST 挑**市區 + θ≠0** 場地驗)/--break-slope/--break-merge/--break-order
#   ±--break-rnd/--break-keepout(MUST 挑**有結構**的場地驗)/--break-id/--break-label
#   ⚠ `--venue` 那一段需外網或 `tools/.scen_cache`(㋓);沒有 `--venue` 時只跑離線的 Ⅰ~Ⅴ
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
node tools/audit_ctrl_mode.mjs       # 操作方式 + 戰場選單 + 按鍵風格 + **頁面級觸控硬化(Ⅹ)**
#   ±--break-viewport/--break-textadj/--break-touchdev/--break-touchact
node tools/audit_vehicle_spec.mjs    # 載具/擺件型錄(宣告盒 ⊇ 實測外廓且不虛胖 / 輪心 = R / 鼻頭在 +x
                                     #  / 零 import 零亂數 / 消費端零第二份實作 / 停車場碰撞盒四角凍結
                                     #  / detailR 哨兵 / 公設分桶數 / 凹處往外堆 / 可視角 / 兩份 AABB 交叉比對)
#   ±--break-spec(輪拱保險桿改回手寫)/--break-dup(停車場繞過型錄)/--break-face(鼻頭改 −x)
#   ±--break-recess(凹處往內挖)/--break-sight(可視角門檻拿掉)
#   ±--break-batch(公設顏色回到材質)/--break-detr(DETAIL_DEFS 縮回舊尺度)
#   ±--break-converge(edgewall/beacons 寫回手工副本)/--break-hazard(hazards 略過合併)
node tools/audit_wildlife.mjs        # 鳥群(四項積分器行為直測 / 分群 / 零共享 rnd / 錨不到就不放
                                     #  / 剪影下限 / 幀率無關 / biomes 接線)
#   ±--break-spring/--break-noise/--break-friction/--break-group
#   ±--break-rnd/--break-anchor/--break-snap
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

#### 5.5-0 判準通則(**適用下表全部;根 §5.4 ㋗ 的全文**)

下表大量出現「MUST 逐項不動 / 逐位元不變」。**判準本身有三處天生的雜訊,拿逐字元 diff 去比會得到假紅字**;
2026-08-16 三道並行窗各自踩到一次,一併記在這裡:

- **㋗-1 `audit_touch_layout` / `audit_touch_gesture` / `audit_ui_layout` 的框線數字有 run-to-run 抖動**
  (±1~4px,**pristine 自己也會抖**)⇒ 判準是「**通過數 + 失敗案例集合**不變」,MUST NOT 逐字元 diff。
  `audit_touch_layout` 那 **8/60 既有紅字 MUST 維持在 8** —— 變多才是真的動到版型。
- **㋗-2 `npm test` 有 5 處輸出隨機**(PIN / 掉落現金 / TC 稀有度 / 爆風結算尾數 / 障礙種類)⇒ 同上,
  判準是「✅ 的**條數**相同 + 斷言逐項相同」,那幾行數字每次都會不一樣。
- **㋗-3 `audit_traverse --json` 的 `cells` 欄天生非決定性**:`BattleSim` 建構期以 `Math.random()` 擺
  第三方野營碉堡 ⇒ `sim.solidResolve` 每次看到的障礙不同,**同一份程式碼**實測 barcelona 三次跑出
  319591 / 319585 / 319579。拿它做逐位元 A/B 的人都會踩到 ⇒ 比對 MUST **排除該欄**,或改用
  `buildStructs` 輸出的雜湊。⚠ 同一支的**全場地計數**也不能拿 BASELINE 比 —— 它的判定吃外部圖資,
  工作樹的 `tools/.scen_cache` 內容一換,結構數就變(實測 91/18 → 121/21 而程式一行沒改)。

另兩條抽原文的錨點紀律(㋑ 家族,2026-08-16 各踩過一次):

- 改 `toon.js` 的 `opaque_fragment` 前置區塊或 `void main()` 宣告區 ⇒ **`audit_soft_stroke` 那兩條
  「排在 `#include <opaque_fragment>` 之後」的錨 MUST 收在 `applyCelPatch` 之內**(`opaqueAnchor()`)——
  2026-08-16 起 `toonPlain` 在檔案更後面也有一次同樣的 `.replace(…)`,全檔 `lastIndexOf` 會指到那一次,
  兩條斷言從此紅在**完全錯的理由**上。
- **`public/js/toon.js` 與 `public/js/postfx.js` 的 GLSL 註解裡出現反引號**是本族踩過四次的坑
  (2026-08-16 兩道窗各兩次)—— 見下表第一列,`audit_client_syntax` Ⅲ 抓得到,但**要記得先跑它**。

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
| **`gInfo.a` 半位元組打包 / 表面群組 / outlineContribution / 內部折邊抑制 / 群組早退**(`toon.js` 的 `INK_CLASS`·`INK_LEVELS`·`inkQuant`·`INK_PACK_GLSL`·`INK_UNPACK_GLSL`·`SURF_ID`·`surfGroup`·`joinSurfGroup`·`INK_REPEAT_M`·`inkRepeat`·`applyCelPatch` 的六個新選項 / `postfx.js` 的 `INK_MRT.SELF_F`·`GRAZE_K`·`_mkRT` 的 NearestFilter·勾線三個讀取點·`_wantInfo` 第三消費端 / `data.js` 的 `INK_CTR`·`inkCtrM` / `visualPrefs.js` 的九格新旋鈕)| `audit_cel_pipeline` ±**九支** `--break`(每一支 MUST 對應紅字)+ `audit_soft_stroke` ±**八支** + `audit_visual_prefs` / `audit_gpu_lifecycle`(既有斷言 MUST 逐項不動)+ `audit_client_syntax`(㋖;**GLSL 註解裡的反引號**是這一族踩過四次的坑)+ `npm run audit:net` / `audit_solo_boot`(**`postfx.js` 多一條 `import … from './toon.js'` 的模組邊**,A28 家族不該憑推理放行)+ `audit_world_curve` / `audit_daynight` / `audit_ground_*` / `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8`(幾何與 rnd 序列一格未動 ⇒ MUST **逐項不變**)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` 只多了不進 `balanceFingerprint` 的表現層常數,`sim.js` / `server/**` 一行未改;動了就是純表現層漏到判定上)+ **㋓ `shot_scene` 三輪 md5 對照**(旋鈕全關 / `--pref inkMrt=on` / `--pref lutSrc=baked`,MUST 與改制前**逐張相同**;手法與 2026-08-13 那一輪逐字相同,**但兩個新陷阱見 `docs/_pending/shots-baseline.md`**:`-prefs` 那一組跨進程不穩定 ⇒ MUST 以「同一輪環境下的 pre/post 對拍」為準,而 `--stations meta.json` 回放**不等於**同參數的新鮮推導 ⇒ venue/team 相同時 MUST NOT 帶它)+ **㋓ 真 GPU MRT `readPixels` 重跑 64 組往返**(離線的 Ⅷ① 只證明**數學**對,證明不了驅動上的 8bit / half 位階)+ **㋓ 真 GPU:新的 `attribute`(`aSurfId`/`aCard`/`aReflO`)與 `varying`(`vSurfId`/`vSeaFade`)會不會讓整批物件不畫 —— `gl.getError()` MUST 為 0** |
| **墨線斷筆 / 掠射抑制項 / 地貌分區子帶 / LUT 取代不疊加 / 斜向轉場 / 溶入 / 勾線淡出錨**(`toon.js` 的 `INK_BREAK`·`_inkBreakA`·`celInkBreak`·`vCelInkP`·`CEL_INKA`/`CEL_INKB`·`LAND_ZONE_N`·`landZoneId`·`CEL_LAND_ID`·`_landInkA`·`CEL_DIS`·`celDissolve`·`setDissolve`·`celHash`/`celNoise` 的提出 / `postfx.js` 的 `INK.FADE_F`·`_inkFadeM`·`uFade0`/`uFade1`·`_wipeMaterial`·`setWipe`·`playWipe`·`_tickWipe`·chain 插點·`_quads` 推導式 dispose·群組早退的 LAND 例外 / `data.js` 的 `WIPE`·`wipeAt`·`DISSOLVE`·`dissolveAt` / `cutin.js` 的 `setPipeline`·`wipe`)| `audit_soft_stroke` ±**三支**新 `--break` 且**八支既有 `--break` MUST 仍各自咬得住** —— 本輪動過 Ⅱ 的三條既有斷言,而那一段正是「軟性契約斷掉」的唯一防線,三條的**語意**(恰一處寫入 / 非軟性件恆寫 1 / 只給不透明件)MUST 逐條保住 + `audit_cel_pipeline` ±**三支**新 `--break` 且**九支既有 MUST 仍咬得住** + `audit_visual_prefs` ±**兩支**新 `--break` + `audit_gpu_lifecycle`(dispose 名冊改推導,既有斷言 MUST 逐項不動)+ `audit_client_syntax` ±`--break-glsl`(㋖)+ `npm run audit:net` / `audit_solo_boot`(`postfx.js` 多一條 `data.js` import、`cutin.js` 多一支選用消費端)+ `audit_damp_fps` / `audit_touch_gesture` / `audit_view_lock` / `audit_spectator_cam` / `audit_recoil_move` / `audit_world_curve` / `audit_daynight`(既有斷言 MUST 逐項不動)+ ground / siteplan / beacons / `audit_object_joints --seeds 8`(**零共享 `rnd()` 消耗** ⇒ MUST **逐位元不變**,判準是輸出逐字元相同不是「仍全綠」)+ **`npm run bal` / `npm test` MUST 逐項不動**(㋗-2)+ **㋓ `shot_scene` 三輪 md5 對照**(`--pref inkBreak=0` / `landInk=0` / `wipe=0` MUST 與改制前**逐張相同**)+ **㋓ `--pref inkBreak=0.6` 與 `+ inkMrt=on`**(斷筆唯一的驗收面)+ **㋓ 平移不變性直測**(同一台機體放在 (0,0) 與 (137, −91),同一組相對機位截圖,機體佔的那一塊 MUST 逐像素相同 —— `mat3` 那一條唯一驗得到的地方;寫成 `mat4` 之後每一條離線斷言照樣全綠)+ **㋓ `shot_scene` 五種天氣 A/B**(④-3 唯一的驗收面:`clear` MUST **像素相同**,其餘四種 MUST 看得出遠景的線收在霧裡)+ **㋓ 溶入五格定裝照**(k = 0/0.25/0.5/0.75/1,背景各拍一次**天空與地形** —— 洞邊的墨線在兩種背景下是**不同**的行為)+ **㋓ `audit_cockpit` / `audit_muzzle`**(`SVS_URL` MUST 指向本工作區的埠)+ **㋕ 真機**:①把 `wipe` 拉起來放一次自己的大招 ②`landInk` 拉起來看拼圖接縫有沒有被描出來(那是這一項的**已知代價**,不是 bug)+ **㋓ 真 GPU `gl.getError()` MUST 為 0**:`vCelInkP` 是**對每一份不透明 cel 材質都成立**的新 varying(`vDisP` / `vLandId` 只在各自的 define 之下),而 WebGL1 的 varying 下限只有 8 個 vec4 ⇒ 「整批物件不畫、console 一個字都沒有」是這一族的典型死法,離線這端**量不到** |
| **賽璐璐學派切換**(`toon.js` 的 `CEL_CUT`·`cutOf`·`SHADOW_V_F`·`_school`·`celSchool()`·`RAMP_PATCH_A`·`RAMP_PATCH_B`·`RAMP_CAN`·`CEL_LUM_GLSL`·`CEL_KEY_GLSL`·`CEL_CUT_DECL_GLSL`·`CEL_CUT_MIX_GLSL`·`celCutUniforms`·`tintA`·`coolOn`·`toonPlain` / `visualPrefs.js` 的 `celSchool` / `data.js` 的 `SHADOW` 檔頭 / `game.js` 的 `shadowMap.type`)| `audit_cel_pipeline` ±**六支**新 `--break`(每一支 MUST 對應紅字)+ `audit_visual_prefs`(Ⅰ 多一條 def、Ⅱ 多三條;**既有 20 條偏色斷言 MUST 逐項不動**)+ `audit_soft_stroke` / `audit_gpu_lifecycle` / `audit_world_curve` / `audit_daynight`(MUST 逐項不動)+ `audit_client_syntax`(㋖)+ `npm run audit:net` / `audit_solo_boot` + **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` **只改註解**;動了就是純表現層漏進判定)+ **㋓ `shot_scene` 三層 md5 對照**(手法同 2026-08-13 的 LUT 那一輪,**兩個新陷阱**見上一列與 `docs/_pending/shots-baseline.md`)+ **㋕ 真機開一場 School B**(洞內 / 隧道在硬切下會平成一塊黑 —— 那是序 12b 的 emissive 要解的,而它依賴本項先落地)。⚠ 改 `RAMPS[3][0]` MUST 回頭看 `CEL_CUT.SHADOW_V`(它是推導值,會自己跟著走 —— 要檢查的是**跟著走之後還好不好看**);改 `CEL_CUT` 任一帶 MUST 重跑 Ⅺ⑤ 的階梯序;**def 翻成 `'b'` 之前 MUST 先把 `biomes.js` 那 4 處裸 `MeshToonMaterial` 改吃 `toonPlain`**(A14 ④) |
| **立體結構的材質 / 線工授權 / 坑門表面群組 / 洞口反光帶**(`biomes.js` 的 `bandPitchM` 與 `buildRoads` → `makeDeckIndex` 那一區的 22 支材質、`stripeLit`/`stripeDark`/`stripeCtr`;`toon.js` 的 `SURF_ID.CONCRETE`/`inkRepeat` 消費端) | `audit_struct_ink` ±**四支** `--break`(每一支 MUST 對應紅字)+ **既有七支幾何稽核逐項不動**(`audit_open_tunnel` / `audit_underpass` / `audit_layer_block` / `audit_road_joint` / `audit_road_bed` / `audit_bridge_crossing` / `audit_bridge_tower_pad` / `audit_water_skirt`)—— **這八支就是「視覺改動有沒有漏進幾何」的判決面,判準是逐項不動不是「仍全綠」** + `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_*` / `audit_world_edge` **逐字元相同**(結構區塊零共享 `rnd()` 消耗)+ `audit_cel_pipeline` / `audit_soft_stroke` / `audit_visual_prefs` / `audit_gpu_lifecycle` / `audit_climb` / `audit_slope_move` / `audit_npc_collide` / `audit_world_height` / `audit_terrain_ray` 全綠 + `audit_client_syntax`(㋖)+ `npm run audit:net` / `audit_solo_boot` + **`npm run bal` / `npm test` MUST 逐項不動** + **㋓ `shot_tunnels --kind tunnel\|underpass\|gallery` 三輪與改制前基準並排**(洞內是這一族**唯一沒有任何離線稽核看得到**的地方;判準 MUST 是「同一套 `--synth` 下的前後對照」—— 沙箱裡取不到衛星影像,拿絕對亮度門檻當閘會是假紅字)+ **㋓ `shot_scene --venue taroko --pref inkMrt=on`**(⑨-3 / ⑨-4 只住第二張附件 ⇒ 不帶這個旗標會得到「改了沒反應」的假結論)+ **㋕ 真機**:走進山體隧道與地下道各一次、走上高架橋一次(判準三條:洞內看得出拱頂/樑/柱的輪廓、洞口黃帶亮著而牆沒有整片被提亮、坑門混凝土與上方山坡之間有一條線而額牆與 collar 之間沒有)。⚠ 改 `TUN.COL_GAP` / 欄杆帶高 / `UND.COPE` MUST 回頭看 `audit_struct_ink` Ⅱ-e(那幾條斷言釘的是**推導的單調性**,不是現值) |
| **落花 / 落葉粒子**(`public/js/petals.js` 全檔 / `biomes.js` 的 `foliageCrown`·`petalGeo`·`PETAL_OFF`·`buildPetals` 與 `dynamics` 之後那一段接線 / `ENV.seasons[].accent` 的消費) | `audit_ambient_motion` ±**八支** `--break-*`(每一支 MUST 對應紅字)+ **`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` / `ground_qc` / `ground_seam` / `ground_enclave` / `ground_border` / `audit_world_edge` 逐項不變** —— 這九支是「**零共享 `rnd()` 消耗**」的唯一證明面,而**判準是「逐項不變」不是「仍全綠」**(它們驗規則不驗位置,序列被推移時全部照樣綠)+ `audit_soft_stroke` / `audit_cel_pipeline` / `audit_gpu_lifecycle` / `audit_visual_prefs` / `audit_world_curve` 逐項不變(材質走 `envMat` ⇒ 勾線 alpha 契約與 `gInfo` 宣告都是繼承來的)+ `audit_client_syntax`(㋖;名冊多一支 `petals.js`)+ `npm run audit:net` / `audit_solo_boot`(新增客戶端模組:URL 佈局鏡射 + `data.js` 單一模組實例)+ **`npm run bal` / `npm test` MUST 逐項不動**(`ENV.seasons[].accent` 只被讀取)+ **㋓ `shot_scene --venue taroko` 的春 / 秋 / 夏各一張**(「像不像在飄」與三色調的實際觀感只有實拍看得到)+ **㋓ 幀成本**(逐幀 `setMatrixAt` + `instanceMatrix` 上傳量;`RES_GOV` 只調解析度、調不掉它 —— 現有雨雪粒子 1600/1100 顆逐幀寫 position 是可比較的基準)+ **㋕ 真機**(低功耗階梯 `MAX_TOTAL_LOW` / `MAX_FIELDS_LOW` 的實際數字 MUST 在真機量過再定值)。⚠ 改 `PETAL.CELL_M` / `MIN_CROWNS` / `DENSITY` MUST 回頭看 `audit_ambient_motion` Ⅲ・Ⅳ 的測試場還咬不咬得到上限 |
| **葉片卡冠層 / 整棵樹的剪影 / 巨岩・石堆・遠景的表面群組與貢獻**(`public/js/leafcard.js` 全檔 / `biomes.js` 的 `MEGA_BODY_F`·`_msbox`·`placeMegaliths` 的群組指派·`CARD_MRT_CAP`·`groupInkOn`·`leafCardOn`·`leafCardTex`·`leafRowGeo`·`surfIdGeo`·`buildVegMeshes` 的三行·`buildBackdrop({ ctr })` 與其呼叫點 / `ground.js` 細節發射迴圈的 `surf`·`contrib`) | `audit_leaf_card` ±**四支** `--break` + `audit_rock_ink` ±**三支** + **`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_*` / `audit_world_edge` / `audit_world_height` / `audit_gpu_lifecycle` / `audit_world_curve` 逐項不變**(零共享 `rnd()` 的唯一證明面;判準同上)+ `audit_cel_pipeline` / `audit_soft_stroke` / `audit_visual_prefs` / `audit_ambient_motion` 全綠(⚠ `audit_soft_stroke` Ⅳ⑤ 的 `vegSoftKind(` 恰一次與 `const mat = toonMat(seasonColor` 恰一次是這一族最容易被順手打破的兩條)+ `audit_client_syntax` ±`--break-glsl`(㋖;名冊多一支 `leafcard.js`)+ `npm run audit:net` / `audit_solo_boot` + **`npm run bal` / `npm test` MUST 逐項不動** + **`intake_parts` MUST 全綠;⚠ `leafCard` 的預設一旦翻成 `auto`/`all`,MUST 先重跑 `measure_veg_tris --kinds`/`--giants` 更新 `tri_budget.json` 的 `measured_kind_tris`/`measured_veg_total_max` 再跑 `intake_parts`** —— 它是整層總量閘的**分母**(被取代的現值),葉片卡把逐型現值改大 ⇒ 那道閘**變鬆**,而紅字與真正的三角形成本無關 + **㋓ 真 GPU 直測**(新的 `attribute`/`varying` 會不會讓整批物件不畫 —— `gl.getError()` MUST 為 0、開→關→再開 MUST **逐位元還原**)+ **㋓ `shot_scene --venue taroko --pref inkMrt=on` / `shot_veg`**(「這顆岩看起來像不像一顆岩」「這叢冠讀不讀得出鋸齒」在每一條斷言上都是綠的)+ **㋕ 真機**(走到一片露頭旁繞一圈、站上全圖最高點看遠山、走到圖界看那一圈假山;林子裡貼著樹走)。⚠ 改 `MEGA_BODY_F` 或 `meta.col.r` 的定義 MUST 回頭看 `audit_rock_ink` Ⅰ 印出來的比值分佈(`col.r` 一動整批比值平移,而**每一條斷言仍會過**);改 `CARD.SIZE_M`/`COVER`/`N_MAX` MUST 回頭量真機填充率 |
| **岸邊泡沫 / 水面倒影塊的消費端**(`terrain.js` 的 `seaFadeAt`・`seaFadeAtWorld`・`bakeSeaDepth`・`stampSeaBlockers` 與對外 API 那兩欄 / `main.js` 的 `terrain.stampSeaBlockers?.()` 那一行 / `biomes.js` 的 `REFL_WAVE_WRITERS`・`REFL_C`・`planReflectors`・`buildWaterReflections`・`buildWaterEdges` 的泡沫分支退場) | `audit_water_edge` ±**四支** `--break`(條數見 §5.1)+ **`audit_soft_stroke` MUST 逐項不變**(toon 側一行未改;⚠ 它的 Ⅵ 用 `^function seaFadeOf…^}` 抽原文丟進**只注入 `smooth01`/`edgeWallInsetM`** 的沙箱 ⇒ `seaFadeOf` MUST 保持自給自足,抽函式的方向不可反過來)+ **ground / siteplan / beacons / object_joints / world_edge / world_height / world_curve / gpu_lifecycle / cel_pipeline / visual_prefs / climb / layer_block / npc_collide / slope_move / leaf_card / rock_ink / ambient_motion 逐項不變**(`audit_terrain_ray` 只有那一行 ms 讀數會跳,那是計時不是語意)+ `audit_open_tunnel` / `audit_underpass` / `audit_road_joint` / `audit_road_bed` / `audit_road_grid` / `audit_world_text` / `audit_vernacular` / `audit_ground_drape` / `audit_mini_map` / `audit_bridge_crossing` / `audit_water_skirt` / `audit_bridge_tower_pad` / `audit_lane_navigation` 全綠(㋔)+ `audit_client_syntax` ±`--break-glsl`(㋖)+ `npm run audit:net` / `audit_solo_boot`(**`terrain.js` 多一條 `import { lowPower } from './mobile.js'`** ⇒ A28 家族的模組邊不該憑推理放行)+ **`npm run bal` / `npm test` MUST 逐項不動**(㋗-2)+ **㋓ `shot_scene --venue <有水域的場地> --dof=0 --curve=0` 的 `waterline` 機位三輪**(預設 / `--pref foam=0` / `--pref reflect=1`;「泡沫像不像浪」「倒影是亮的還是暗的」離線一條都驗不到)+ **㋓ 真 GPU**(`aReflO` / `vSeaFade` ⇒ `gl.getError()` MUST 為 0;`reflect` 0 → 1 → 0 MUST **逐位元還原**)+ **㋕ 真機走到岸邊**(泡沫有沒有跟著浪上下、有沒有繞過柱子、53m 外環那一圈 MUST 一點泡沫都沒有)。⚠ 改 `FOAM.TEXEL_M` / `FOAM.RANGE_M` MUST 回頭量建構耗時(**MUST 收在一格 `SLICE_MS` = 16ms 之內**,超過就要挪到既有的階段回報點之後,MUST NOT 自己新增 `await`) |
| **載具 / 擺件型錄**(`public/js/vehicles.js` 全檔 / `siteplan.js` 的 `LOT_STALL`·`LOT_PAINT`·`CIVIC_PARTS.lot`·`buildCivic` 的分組合併 / `hazards.js BUILDERS.wreck` / `biomes.js` 的 `vehGroup`·`car()`·`makeTrain()`) | `audit_vehicle_spec` ±**七支** `--break` + **`audit_siteplan` / `audit_object_joints --seeds 8` 的差異 MUST 只有「碰撞柱根數」與「接合數」兩處**(車有輪子了 ⇒ 零件變多是**預期**;`異常 0 項` 與 `265 項` MUST 不動)+ **`audit_beacons` / `audit_ground_*` / `audit_world_edge` 逐位元不變**(零共享 `rnd()` 的證明面)+ `audit_soft_stroke` / `audit_cel_pipeline` / `audit_visual_prefs` / `audit_gpu_lifecycle` / `audit_leaf_card` / `audit_rock_ink` / `audit_water_edge` / `audit_ambient_motion` / `audit_world_height` / `audit_world_curve` / `audit_climb` / `audit_layer_block` / `audit_npc_collide` / `audit_slope_move` / `audit_daynight` 全綠 + `audit_client_syntax`(㋖;名冊多一支 `vehicles.js`)+ `npm run audit:net` / `audit_solo_boot` + **`npm run bal` / `npm test` MUST 逐項不動** + **㋓ `shot_scene --venue shibuya --dof=0 --curve=0`**(「這一台車看起來像不像車」離線一條斷言都量不到)+ **㋕ 真機**:貼著停車場走一圈(九台車的碰撞盒仍貼合、車輪真的觸地)、開一場看封路車禍、看一次行駛列車。⚠ 三支稽核(`audit_object_joints:577` / `audit_siteplan:95` / `audit_soft_stroke:311`)的 `new Function` 樁**MUST 注入 `makeVehicle`**(後兩支另加 `makeRecess`,soft_stroke 還要**一併抽** `LOT_STALL` 與 `LOT_PAINT` 的原文)—— 漏掉任何一格的症狀是整支稽核在 `const CIVIC_PARTS = {…}` 那一行 `ReferenceError`,而錯誤訊息與「接合 / 場址 / 軟性物質」完全無關,很容易被讀成「稽核壞了」。⚠ 改 `LOT_STALL` MUST 回頭看 `audit_vehicle_spec` Ⅵ(碰撞盒四角是**凍結常數**);改 `VEHICLE_SPEC.sedan` 的 `waist` MUST 回頭看 `audit_siteplan` 的「掛碰撞的一律有量體」(車身頂 < 1.0m 會被判成隱形絆腳石) |
| **鳥群(⑥-2)**(`public/js/wildlife.js` 全檔 / `biomes.js` 的 `BIRDS_OFF`·`shoreRing`·`buildFlocks` 與其呼叫點) | `audit_wildlife` ±**七支** `--break` + **`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` / `ground_qc` 逐項不動**(⑥-2 是**純新增**且零共享 rnd ⇒ 這五支是唯一的證明面)+ `audit_damp_fps`(摩擦吃 `frictionFPS`;⚠ 那一支的掃描名冊目前只有 `data.js`/`game.js`/`locomotion.js`/`animweights.js` —— **`wildlife.js` SHOULD 補進第 40 行那一組 `readSrc`**,現況由 `audit_wildlife` Ⅰ 就地釘住同樣的三條 ⇒ 沒有缺口,但兩份名冊遲早分家)+ `audit_cel_pipeline`(鳥群走既有 `envMat` ⇒ Ⅵ 的自寫 ShaderMaterial 計數 MUST **不變**;變了就是有人自己寫了材質)+ `audit_daynight`(**不投影**;那一支掃不到 biomes.js ⇒ 這一條只有 `audit_wildlife` Ⅷ 在守)+ `audit_gpu_lifecycle` / `audit_world_height`(高度夾在 `objHeightMax()`)/ `audit_world_edge`(水平夾在 `edgeWallInsetM()`)+ `audit_client_syntax`(㋖)+ `npm run audit:net` / `audit_solo_boot` + **`npm run bal` / `npm test` MUST 逐項不動** + **㋓ `shot_scene --venue <有水域的場地> --pref birds=1`**(「像不像鳥」「有沒有真的在飛」離線一條都驗不到;`instanceMatrix.needsUpdate` 忘了會凍結而**每一支稽核全綠**)+ **㋕ 真機看一次**(牠們有沒有繞著水岸飛、拍翼有沒有整群同步)。⚠ 改 `FLOCK.SPRING` / `FRICTION_K` / `SPEED` MUST 回頭看 `TRACK_MIN` / `V_MAX` 兩個門檻(它們是**實測**出來的判準,不是旋鈕) |
| **動畫權重向量**(`public/js/animweights.js` 全檔 / `locomotion.stepLocomotion` 收尾的 `L.w` / `game.js` 的 `_entWeights`·`_stepSelfWeights`·`_moveCat` 的 air 判定·`_updateMoveAudio` 的 `moveGate`/`rate`) | `audit_anim_weights` ±**五支** `--break`(每一支 MUST 對應紅字)+ **`audit_gait_anat` 逐字不變**(`stepLocomotion` 只多寫一格 `L.w`、不讀任何新東西 ⇒ 步態逐位元不動;這就是計畫 ⑥ 驗證欄那句「既有斷言 MUST 逐項不動」)+ `audit_morph_rig`/`audit_paper_doll`/`audit_damp_fps`(**`animweights.js` MUST 進 `audit_damp_fps` 的掃描名冊** —— 名冊漏掉的檔案裡寫 `Math.min(1, dt·k)` 一樣掃不到而那支照樣全綠)+ `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot` + ㋔ game.js 那一批(`npc_collide`/`climb`/`layer_block`/`slope_move`/`view_lock`/`spectator_cam`/`blood_splat`)+ **`npm run bal` / `npm test` MUST 逐項不動**。⚠ **音效端刻意不是逐位元中性**:離地門檻由 3m 收斂到 `MORPH.GROUND_Y`(2m)、`moveGate`/`rate` 的輸入由未阻尼的 `_moveSpd` 換成阻尼過的權重 ⇒ ①2~3m 高度帶內的英雄從此**立刻**切到飛行型音床(舊制慢一拍)②靜止/起步的音量過渡不再有 8Hz 插值鋸齒。這兩項**沒有任何離線模型守得住**(`npm run bal` 不模型化音效)⇒ MUST 列進交付說明的未驗項並**真機聽一次**(㋕) |
| **⑤-1 植被擾動的餵入端**(`game.js` 的 `TREAD`·`_charSlots`·`_selfSpd`·`_stepSelfWeights` 的閘門·主迴圈的 `setCelChar(this._charSlots())`) | `audit_anim_weights` Ⅶ ±**三支** `--break`(每一支 MUST 對應紅字;既有五支 MUST 仍各自紅字)+ **`audit_gait_anat` 逐字不變**(`locomotion.js` 一行未改)+ `audit_soft_stroke`(`toon.js` 那一半 MUST 逐項不動)+ `audit_damp_fps` ±`--break-damp`(`_charSlots` 不自己阻尼,但它是 game.js 掃描名冊的一部分)+ `audit_client_syntax`(㋖)+ ㋔ game.js 那一批 + **`npm run bal` / `npm test` MUST 逐項不動** + **㋓ `audit_muzzle`/`audit_cockpit`/`audit_cast_jump`**(game.js 動過;`SVS_URL` MUST 指向本工作區的埠)。⚠ **「草真的被撥開了嗎」離線一條都驗不到** —— GLSL 在 Node 端執行不了,原文不變式只證明「有這個機制」⇒ ㋓ `shot_scene` 的 `lane_mid`/`hilltop` 在 `?tread=0` 與預設下各拍一張:**`?tread=0` MUST 與改制前 md5 逐位元相同**(那是「早退不加」的驗收面),預設下 MUST 看得出機體腳邊的草倒向外側 |
| **轉場的呼叫端**(`game._wipeCut` + 建構子的 `playWipe('reveal')` + `_updateDeathSeq` 的 `done` 分支 + `_applySnap` 的 `m.over`) | `audit_visual_prefs` **Ⅷ-h~j**(**三條呼叫端斷言**:cover 與 reveal 成對 / `playWipe` 恰三處 + `_wipeCut` 恰兩個呼叫點 / 重入守衛 `first` 與 `s.cut` / 狀態閘不跟著延後 —— 縫那一半住同一段的 Ⅷ-a~g)±`--break-wipepair`(把 `_wipeCut` 裡 `p.playWipe('reveal', null, opts);` 那一行刪掉 ⇒ 第一條 MUST 紅;**替換無效 MUST 當場 `process.exit(1)`**,樣式用 `\r?\n`)+ ㋔ game.js 那一批 + **`npm run bal` / `npm test` MUST 逐項不動** + **㋓ 真瀏覽器把旋鈕開起來各走一次**:開戰 / 陣亡 / 結算三個時機,判準是「幕拉開之後畫面回得來」(`_wipeA` MUST 回 0)。⚠ **旋鈕開著時 `hud.over` 與陣亡過場收尾各延後 `WIPE.COVER_S`(0.34s)** —— 那是設計上的時序改動,不是 bug |
| **音效層級**(`public/js/audio.js` 全檔 / `game.js` 的 `_updateMoveAudio`·`_updatePlaceAudio`·`_ambDensityAt`·`_clearAroundBunker` 的快取失效 / `public/audio/README.md` 的來源帳 / `public/audio/**` 新增任何檔案) | `audit_audio_layers` ±**七支** `--break`(每一支 MUST 對應紅字;`--break-take` 的兩條「去重窗現值」與 `--break-tier` 的三條「`bgmUrl` / 補載入」是**對照組 MUST 仍綠**)+ `audit_anim_weights`(移動床的 gate 吃的是權重向量)+ `audit_client_syntax`(㋖)+ `npm run audit:net`(⚠ 稽核檔內 **MUST NOT 出現帶前導斜線的 `audio` 路徑字面** —— `audit_net_modes.mjs` 的 `strayPaths` 掃 `tools/*.mjs`,踩到會紅在一個完全不相干的訊息上)+ `audit_solo_boot` + ㋔ game.js 那一批 + **`npm run bal` / `npm test` MUST 逐項不動**(純表現層,伺服器不 import `audio.js`)。**放進 `public/audio/**` 的任何檔案 MUST 同時在 README 的來源帳補一列**(Ⅷ 段雙向比對:實體存在卻沒登記 = 紅)。⚠ ㋕ 真機三件離線驗不到:①**低功耗開→關**之後樣本 MUST 回來(這是本項最容易靜默壞掉的一格)②走進水裡的腳步 MUST 是**交叉淡入不是換聲道**(踏空一拍只有耳朵聽得到)③地點床的優先序聽起來對不對 |
| **頁面級觸控硬化 / 裝置 vs 版型旗標**(`style.css` 的 `body.touch-dev` 區塊與 `body.touch-dev #game`、根層 `text-size-adjust`、`body.touch-ui` 的 `--tl-*` 與安全區、`mobile.installTouchUI()` 的 `touch-dev` 掛載、`index.html` 的 viewport meta) | `audit_ctrl_mode` **Ⅹ** ±**四支** `--break-viewport`/`--break-textadj`/`--break-touchdev`/`--break-touchact`(每一支 MUST 對應紅字;`--break-touchdev` 下 Ⅹ⑤ **MUST 仍綠** —— 兩欄同時對才代表旗標拆開了)+ `audit_touch_layout` / `audit_touch_gesture` / `audit_ui_layout` / `audit_gyro` MUST **逐項不動**(判準見 ㋗-1:框線數字有 run-to-run 抖動,`audit_touch_layout` 的 **8/60 既有紅 MUST 維持在 8**)+ `audit_client_syntax`(㋖)+ `npm run audit:net` / `audit_solo_boot` + ㋒ + **㋕ 真機**:①房主鎖「限定滑鼠鍵盤」時在手機上仍**捏合不動、下拉不刷新、長按不選字**(這正是改制前壞掉的那一格,而它在離線這端只表現成選擇器字串不同)②iPhone 橫握 HUD 下帶比例與直握一致(text-size-adjust 的唯一驗收面)③有觸控螢幕的 Windows 筆電第一次吃到 `#game{touch-action:none}` 與 `user-select:none` —— 是**刻意**的行為改變 |
| **線工切面 / 執行期分區場**(`public/js/zonecut.js` / `public/js/landfield.js` 全檔 / `audit_zone_cut.mjs` / `venue_field.cutLinesFor` / `venue_field` 的 `buildStructs`·`projectArc`·`ptAt`·`sampleAlong` / `ground.js cellZoneAt` 的**判定順序**) | `audit_zone_cut` ±**八支** `--break`(每一支 MUST 對應紅字;`--break-quantize` MUST 挑**市區 + θ≠0** 場地 —— 山區的界線多半來自坡度等值線、不經投影 ⇒ 壞版在那裡咬不動;`--break-keepout` MUST 挑**有結構**的場地。兩支都已加**適用性硬閘**:挑錯輸入 MUST 當場 `process.exit(1)` 並說明該挑什麼,MUST NOT 讓它報綠)+ `audit_traverse`(四支函式搬家 ⇒ **MUST 做 A/B**:`--only=<有快取的場地> --json=` 前後比對,而**比對 MUST 排除 `cells` 欄**,見 ㋗-3)+ `audit_underpass`/`audit_venue_biome --offline`/`audit_lane_scenarios`(㋓;venue_field 的既有 export 一格未動 ⇒ MUST 逐項不變)+ ground 那一批 + `siteplan`/`beacons`/`object_joints --seeds 8`/`road_grid`/`slope_move`/`cel_pipeline`/`client_syntax`/`solo_boot` + `audit_osm_relay`/`measure_osm_relay`(新增 OSM payload 與配額)+ **`npm run bal` / `npm test` MUST 逐項不動**(`server/sim.js` 與平衡資料不得受表現層分區影響)+ 改 `logo_lib.encodePNG` MUST 重跑 `flatten_logo`/`split_logo`/`compose_logo` 比對 md5(⚠ 那三支的 `OUT_DIR` 是**寫死的絕對路徑**,指向出貨儲存庫的 `public/assets` —— 在 worktree 裡跑會寫到別的儲存庫去;2026-08-16 改採**原文層 A/B**:抽 `git show HEAD:tools/logo_lib.mjs` 的舊 `encodePNG` 原文、以樁掉的 `writeFileSync` 捕捉位元組,與新的 `pngBytes` 逐位元比對) |
| 建構期讓步(`buildYield` / `await onProgress`) | `audit_client_syntax`(㋖:`await` 落在非 async 的回呼裡是 SyntaxError)+ **`audit_siteplan` Ⅵ 與 `audit_open_tunnel` Ⅵ**(兩支真的執行 biomes/terrain 原文,沙箱要吃得下 await)+ biomes 那一批(siteplan/beacons/open_tunnel/underpass/road_joint/world_text/object_joints/ground_*)+ **A/B 直測 MUST 比對產出**(同一場地 warm 跑兩次,`blockers`/`decks`/`tunnels` 逐項相同 = 讓步沒有動到取樣順序)+ ㋒ |
| 程序生成物件擺位(`BUILDERS`/`VEG_DEFS`/`vegPartXform`/`MEGALITHS`/`synthMegalith`/`decorateMegalith`/`rockProbe`) | `audit_object_joints --seeds 8`(約 23000 接合;FLOAT/PARTIAL/DETACHED/ISOLATED 四硬失敗;豁免附理由;巨岩段含「兩端支承」具名救援) |
| 場址配置(都市計畫 / 羞避 / 地質排列) | `audit_siteplan` ±`--break-line`/`--break-shy`/`--break-strike` + **`intake_parts`**(外廓契約 + 三角形**兩道閘**:單件 ≤ 族上限、**逐款 Σ 庫零件 ≤ `kind_factor` × 該款現值**;**改 `GIANT_DEFS` 任一零件表 MUST 重量 `tri_budget.json` 的 `kind_tris`**)+ `audit_beacons` + ㋔ + **`audit_traverse`(㋓:沿街多出數百棟 ⇒ 街廓夾出來的通道要仍走得通;沙箱降級的未驗結果 MUST NOT 當綠燈)** + ㋒ |
| 聚落場 / 建物來源信任階梯 / 場地 `mix` | `audit_siteplan` Ⅴ・Ⅵ・Ⅶ ±`--break-gate` + `audit_venue_biome --offline` ±`--break-clip`/`--break-roster`(兩支都落在離線那一段 ⇒ CI 收得到)+ **完整版 `audit_venue_biome`(㋓)** + ㋔ + ㋒ |
| 建物零件庫(整棟量體 / 三帶 UV / 層高) | `audit_siteplan` Ⅴ ±`--break-mass`/`--break-mass2`/`--break-roof`/`--break-storey` + `intake_parts`(含 **UV 契約**,反向驗證兩支)+ **逐位元不變 MUST 用量的**:`measure_building_tris --live --osm-cache` 錄播 Overpass 後做 A/B(同一張圖兩次 `--live` 差到 ±70%)+ `shot_facades` 排面與 `shot_scene` 的 `mass_near`/`masslow_near`(㋓)+ 3D 零件對照台 0 缺件/0 孤兒/0 未記載 + ㋔ |
| **平面整平 / 前置去噪 / 小區塊併入鄰居 / 封底 / 窗牆帶的平整條件 / 招牌落點的平整條件 / 窗格輪廓 / 窗格貼齊面板**(`normalize_parts.py` 的 `PLANAR_*`(含 `SMALL_F`/`MERGE_DEG`/`DN_*`)·`SEAL_*`·`_plane_groups`·`_face_adj`·`_denoise`·`_planarize`·`_base_seal`·`_open_share`·`--replanar`·`--uvbands` 後兩欄 / **`public/js/wallpanel.js` 全檔** / `parts_src` 的 `meshFaces`·`flatWalls`·`wallFlatness`·`solidConverge` / `wallpanel.planeGroups` / `tri_budget` 的 `planar_spec`(含 `small_f`/`merge_deg`/`dn_*`)·`sign_flat_min` / `MASS.UVB.FLAT_*`·`SIGN_FLAT_MIN`·`PANEL` / `bldFaceList` / `biomes.alignedGeo`·`pitchGrid` / `facadeTex` 的 `snap`·`pane`·`wrapS`·`FACADE_PX.FRAME`·`ANISO`) | `audit_siteplan` Ⅴ ±**`--break-flat`**(MUST 紅 3 條)+ **`--break-merge`** / **`--break-denoise`**(各 MUST 紅 5 條)+ **`--break-seal`**(MUST 紅 4 條)+ **⑥-d 的行為直測**(真的切一次面板、跑四種網格:格數恆為 ≥1 整數、u 跨距恆為 1/cols 的整數倍、v 恆收在窗牆帶內、共用頂點真的會出現)+ `audit_client_syntax`/`audit_solo_boot`/`audit:net`(新增客戶端模組 `wallpanel.js`)+ **`intake_parts`**(從成品 GLB 重量平整度;反向驗證 = 把**整平前**的 `building.glb` 餵給它,MUST 紅 22 條,其中「已合併整平」與「真的平整的 ≥ 60%」各節點都要紅)+ **重烤 MUST 兩趟**(帶寬是「該群面積佔比」⇒ 先 `--replanar` 拿到整平後的幾何、量出佔比,再從**原始** base 重跑一次把量到的值烤進 `--uvbands`;拿整平後的 GLB 再整平一次 = 這一顆被推了兩倍)+ **`--break-*` 的字面替換 MUST NOT 綁現值**(2026-08-14 實測:`--break-roof` 綁死 `masslow: { roof: 0.203 …}`,重量帶寬之後它是靜默 no-op、紅字由 2 條掉成 1 條而壞版根本沒被造出來 —— §5.4 ㋑)+ 名冊三處 MUST 同步(`BLD_LIB` 第三格連第五欄、`MASS.UVB`、`tri_budget`)+ `audit_auto_intake` + `audit_object_joints --seeds 8` + `audit_beacons` + `audit_client_syntax`(㋖)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js`/`sim.js` 一行未改)+ **㋓ `shot_facades`**(窗框與硬邊只有貼圖排面看得到;量化判準 = 窗邊「過渡 texel」佔比 MUST 從 22~30% 掉到個位數)+ **㋓ `shot_scene` 的 `mass_near`/`masslow_near`**(素牆帶長大之後那幾棟塔還讀不讀得出是辦公樓)+ **㋕ 貼著塔走一圈**(招牌不再浮在尖塔前面) |
| 整棟量體的**碰撞剖面 / 尺寸貼合 / 招牌落點 / 窗間距**(`bldProfile`/`profGeo`/`fitNode`/`fitScale`/`slabBox`/`bldFace`/`MASS.UVB`/`FACADES[].win`/`nodeProfile`/`--uvbands`) | `audit_siteplan` Ⅴ ±`--break-prof`/`--break-fill`/`--break-glass`(各紅 4 / 1 / 2 條)+ **`intake_parts`**(剖面宣告 = 實測、三帶 v 界、名冊涵蓋率)+ `audit_auto_intake` ±`--break-append`(名冊追加要連剖面一起補、撤下要逐位元可逆)+ `audit_object_joints --seeds 8` + `audit_beacons` + `audit_client_syntax`(㋖)+ **`npm run bal` / `npm test` MUST 逐項不動**(平衡與 sim 一行未改)+ **改剖面段數/名冊 MUST 回頭看 `LOS.MAX_OCC` 餘裕**(16 棟 ×(段數−1)根柱)+ **㋓:`shot_scene` 的 `mass_near`/`masslow_near` 與 `shot_facades`**(三帶接縫落在哪、無縫玻璃牆讀不讀得出來、撐滿基地後的比例,只有截圖看得到)+ **㋕:貼著塔走一圈**(退縮平台站得上去、上半段不再撞到空氣)+ `audit_traverse`(㋓;地面層通行寬理應逐位元不動) |
| 鏡像貼補 | ⚠ **先看 `docs/ai3d_runbook.md` §5aj-C**(改制待執行)+ `mesh_sym --gate` + **`node_sheet --ref`(四面黏土對照 —— 這一族的錯只有截圖看得到)** + `intake_parts`(外廓與預算 MUST 逐位元不動)+ `audit_object_joints --seeds 8` + `audit_beacons`/`audit_siteplan` + 3D 對照台 0-0-0 + ㋒ |
| 語意化地標 | `audit_beacons` ±`--break-extent`/`--break-pad` + `audit_object_joints`/`audit_gpu_lifecycle` + ㋒ |
| 世界文字 | `audit_world_text` ±`--break-cache` + `audit_vernacular` + **`shot_signs`(㋓:版面與缺字偵測只有這裡看得到)** + `audit_visual_prefs`(旋鈕表多一個 `choices`)+ ㋔ + ㋒ |
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
| 觸控「一次點擊」的判定(`LOOK.TAP_MS`/`TAP_SLOP_PX` / `_bindButtons` / `_tapNear` / `_tapOk` / `_dropTap` / `_tickTap`) | `audit_touch_gesture` ±**`--break-tap`**(⑧ 那一段 MUST 紅,而「按住型」那三條是**對照組 MUST 仍綠**)+ **`audit_gyro`**(它的合成點擊 MUST 是 down + up 一對 —— 只送 pointerdown 等於「按著沒放」,三條會紅而理由是假的)+ `audit_ctrl_mode`/`audit_touch_layout`/`audit_ui_layout` MUST 逐項不動 + `audit_client_syntax`(㋖)+ ㋒(`data.js`/`sim.js` 一行未改 ⇒ `npm run bal` / `npm test` MUST 逐項不動)+ **㋕ 真機**:從搖桿邊緣滑到鄰近鈕 MUST NOT 觸發、按住招式鈕超過 260ms 放開 MUST NOT 施放(這是**刻意**的行為改變,不是 bug)|
| 視窗尺寸定案 / 旋轉 debounce(`VIEWPORT`/`isIOS`/`viewportSettleMs`/`bumpViewport`/`onViewportSettled`/`game._offResize`) | `audit_ctrl_mode` **Ⅸ**(原文:只有一份等待時間 + 消費端沒繞過)+ `audit_touch_gesture` **⑨** ±**`--break-debounce`**(行為:連發合併成一次)+ `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot`(game.js 多一條 mobile.js import)+ ㋒ + **㋕ 真機轉一次**(iOS 的 500ms 只有在真的旋轉時才驗得到;桌機拖曳視窗邊緣 MUST 仍即時跟上) |
| **幀率無關阻尼**(`data.js` 的 `frictionFPS`/`lerpFPS` / `camAngleStep` / `game.js` 的相機·砲塔·座艙·機體插值·後座回穩·空氣阻力 / `locomotion.js` 的 `damp()`·`FX_K`) | **`audit_damp_fps` ±`--break-damp`**(內建對照組:同一把尺量舊制 MUST 量得出 7× 的差別 —— 沒有它,「幀率無關」那句可能只是恆真)+ `audit_spectator_cam`/`audit_view_lock`/`audit_recoil_move`/`audit_gait_anat`/`audit_morph_rig`/`audit_paper_doll`(五支的既有斷言 MUST 逐項不動)+ `audit_bot_vision`(**`viewLockStep` 是具名例外,MUST 逐位元不動**)+ `audit_client_syntax`(㋖)+ **`npm run bal` / `npm test` MUST 逐項不動**(改的全是純表現層;動了就是漏到權威側)。⚠ **這一改不是逐位元中性的**:60fps 上與舊制的相對落差最大 7.9%(k = 10),現役 k 3~10 都在容差內 ⇒ 不必回頭重調係數;超過 10% 就要重調,稽核有守門。⚠ **`viewLockStep` 的逼近項 MUST NOT 順手改成 `lerpFPS`** —— 它同時是 `server/bots.js _turn`(bot 朝向唯一寫入點)的來源,伺服器固定 8Hz ⇒ 舊式在小角度是「一個 tick 轉到位」,換成指數逼近就是權威側行為改變,要照 §5.6 補一輪 AI 退化量測 |
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

### 5.5-2026-08-17 旗面布料波形

| 改動 | MUST 跑 |
|---|---|
| `toon.js CEL_SWAY_H` 的 `swPiece` / `swRate` / `swPhase` / 3.3× 快顫 | `audit_soft_stroke` Ⅲ ±`--break-cloth` + `audit_client_syntax`(㋖)+ `audit_cel_pipeline` / `audit_visual_prefs` / `audit_gpu_lifecycle` / `audit_world_curve` + `audit_object_joints --seeds 8` / `audit_siteplan` / `audit_beacons`(零幾何、零共享 `rnd()`,判準逐項不動)+ `npm run bal` / `npm test` 逐項不動 + 真 GPU:`gl.getError() = 0`、旗桿側不動、同圈旗面不同速不同相位、植被擺動觀感不變 |

### 5.5-2026-08-17 地貌苔草／濕痕遮罩

| 改動 | MUST 跑 |
|---|---|
| `toon.js LAND_MASK_N`・`landMaskId`・`celTriNoise`・`celLandMask`・`CEL_LAND_FIELD` 快取鍵 | `audit_cel_pipeline` Ⅸ④ ±`--break-landmask` + `audit_client_syntax`(㋖)+ `audit_visual_prefs` / `audit_soft_stroke` / `audit_gpu_lifecycle` / `audit_world_curve` + `audit_zone_cut` / `audit_ground_*` / `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8`(零幾何、零共享 `rnd()`,判準逐項不動)+ `npm run bal` / `npm test` 逐項不動 + ㋓ 真 GPU:`gl.getError() = 0`、taroko 崖面繞拍確認三平面換手無接縫、`landInk=0/1` 只改遮罩邊不改顏色 |

### 5.5-2026-08-17 權威死亡溶出

| 改動 | MUST 跑 |
|---|---|
| `DISSOLVE.OUT_S` / `dissolveOutAt` / `toon.enableDissolve` / `game._dissolveGhosts` | `audit_cel_pipeline` Ⅸ ±`--break-dissolve`(三條紅字：錨點、快取鍵、權威 `die` 閘)+ `audit_client_syntax`(㋖)+ `audit_visual_prefs` / `audit_soft_stroke` / `audit_gpu_lifecycle` / `audit_world_curve` + `audit_view_lock` / `audit_spectator_cam` / `audit_recoil_move` / `audit_damp_fps`(移除前先摘除所有戰鬥消費端)+ `npm run bal` / `npm test` 逐項不動 + ㋓ 真 GPU：不透明 cel 材質洞邊無額外輪廓、死亡後 0.45s 溶出、單純離開迷霧視野必須立即消失 |

---

