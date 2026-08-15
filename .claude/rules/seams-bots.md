# §2.1 D — 電腦玩家(bot)(單一真相縫)

> 本檔 = 根 `CLAUDE.md` §2.1 D 全文,2026-08-16 由根檔拆出。**編號一格未動** —— 程式碼與稽核檔頭寫「CLAUDE.md §2.1 D」指的就是這裡。
> 讀本檔前 MUST 已內化根 `CLAUDE.md` §0 十條核心原則;禁令總表見 [`antipatterns.md`](antipatterns.md),改完要跑什麼見 [`verification.md`](verification.md)。
> **共通鐵律(不逐列重述)**:消費端 MUST 全部走這個縫、MUST NOT 另寫第二份實作或在別處二次運算、**推導值 MUST NOT 手寫**、純表現層 MUST NOT 動權威幾何。「稽核」欄 = 該縫的細節與症狀敘事所在(檔頭),改它先開那支。


| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 操作節奏 | `BOT_DIFF`/`BOT_OPS`/`botOpGap()` + `bots._op()` | MUST NOT 另寫 tick 計數節流;持續開火刻意只吃反應時間、不吃手速閘 |
| 視野 | `BOT_VIEW`/`botFovHalf()` + `bots._fovHalf()`/`_bearing()`/`_face()`/`_turn()`/`_alertLook()`;方位來源 `sim._hurtLog()` | 半視角推導(相機吃**垂直** fov ⇒ 以 `ASPECT` 換算),**只限水平**。選敵閘門只住 `_acquire`。`h.ry` **唯一寫入點 = `_turn`**、步進只准經 `viewLockStep`(`_face` 只寫意圖)。受擊警戒方位只准來自 `_hurtLog`,記在主視野機、MUST 排在狀態機**之後**。推線朝向 MUST 取**前進方向**。稽核 `audit_bot_vision` |
| 戰術(選敵/撤退/打帶跑) | `BOT_DIFF.tactic·elite` + `BOT_TACTIC` + `botTargetPrio()`/`botThreatDecay()`/`botSalvo()`/`botExecW()`/`botKiteF()`;記帳 `sim._hurtLog()`/`_dmgOut()` | **分層只認旗標**,MUST NOT 比對難度字串(新手/低難度逐位元維持舊制)。選敵三項 MUST 正規化成候選集內佔比;帳只有一份(輸出**兩條結算路徑都要記**);威脅累加 MUST **先淡出舊帳再加**。撤退三道閘缺一不可(遲滯帶 / RETREAT 不被 RALLY 搶走 / 「扛半條護盾」量近期傷害且**排除塔與主堡刮傷**);RALLY = 還在挨打邊退邊打、脫離接觸就停火停步;`prog` MUST 走 `_progAt`。稽核 `audit_bot_tactics` |
| 定位分類與策略 | `BOT_ROLE_FEATS`/`BOT_ROLES`/`BOT_ROLE`/`BOT_BUY_ORDER` + `botRoleFeats()`/`botRoleScores()`/`botRoleOf()`(唯一分類處)/`botRoleRoster()`/`botRoleNorm()`/`botRoleMul()`/`botRoleTactic()`(唯一覆寫處)/`botBuyOrder()` + `botTacticCross()`;消費端 `bots._resolveRole()` → `this.tac` | ①分類推導,**MUST NOT 出現任何逐角色名冊**(五條特徵吃 `HEX_AXES[].val` 同一份取值函式)。②特徵是相對全場的**對數分位**(`aid` 是具名例外,`power` 刻意不收)。③定位 = 剖面內積 argmax,特徵**置中**、`Σ\|w\| = 1`。④策略是既有旋鈕的覆寫,**MUST NOT 出現 `if (role === …)` 行為分支**;五個新旋鈕基準逐一等於改制前硬編碼。⑤覆寫 MUST 以角色數加權**幾何平均 = 1** 正規化;夾到邊界的逐項印出來;`PRIO_STRUCT` 下界刻意是 1。⑥只在 `BOT_DIFF.tactic` 之下解析(A33)。⑦與學習迴圈疊加(五個新旋鈕不進學習白名單);解析點 MUST 在 `update()` 而非建構函式,基準 MUST 只記一次(`_tacBase`)。設計全文 `docs/bot_design.md`;稽核 `audit_bot_role` |
| 學習策略 | 策略檔 `botPolicy.js`(工具產出、零 import、**人手 MUST NOT 編輯**)+ `BOT_TACTIC_BASE`(凍結基準)/`BOT_LEARN`(白名單+邊界)/`botPolicySanitize()`(夾制唯一縫)/覆寫迴圈/`balanceFingerprint()`;讀取縫 `bots.this.tac`;迴圈 `tools/bot_learn.mjs` | ①**只學取捨不學能力**(視野/手速/準度 MUST NOT 進白名單,A32);②使用者定案值與帳的時鐘(`THREAT_S`)不可學;③白名單鍵 MUST 只被 tactic/elite 分支消費;④夾制只有一份(執行期與工具同吃)。`BOT_TACTIC.` 在 bots.js 零殘留;空 policy = 中性 = 逐位元同基準。學習輪收尾閘門:乾淨種子上沒贏過就不寫檔。設計全文 `docs/bot_design.md`;稽核 `audit_bot_policy` |
| 碰撞量體 / 實體碰撞 | `SELF_F`/`selfCollider()`/`COLLIDE_KINDS` + 客戶端 `_collide()`/`_sweepBlockers()`/`_unitSolids()`/`_circleEnter()`/`_pushOutCircle()`/`COLLIDER` + 伺服器 `solidResolve()`/`_solidsNear()`/`solidPush()`/`solidEnter()`;呼叫端 `bots._move()` | 電腦玩家碰撞法則一律跟真人一樣。量體只有 `selfCollider` 一份;障礙集兩個來源鏡射客戶端兩個迴圈(上傳碰撞柱走 `_losGrid`)。**掃掠與 push-out 缺一不可**(對建物與對單位皆然);`fwd === 0` MUST 歸「遠半」交給掃掠;圓柱幾何收成 `_circleEnter`/`_pushOutCircle` 各一份且與伺服器逐案例同值;單位與世界障礙在**同一趟** pass 交錯收斂、順序 MUST 先單位後世界(**世界幾何贏**);垂直帶 ε 兩端同式。`bots` 的 `h.x`/`h.z` **唯一寫入點 = `_move`**,且 MUST 配撞牆繞行(`_skirt`/`_stuck`)。稽核 `audit_bot_vision` + `audit_npc_collide` |

