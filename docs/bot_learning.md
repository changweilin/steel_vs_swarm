# 電腦玩家學習策略(bot policy learning)

> 2026-08-06 使用者需求:「設計一個最佳操作策略的電腦玩家,平衡性調整時可不斷學習」。
> 本文是設計定案與操作手冊;縫的索引見 `CLAUDE.md §2.1`,逐項斷言見 `tools/audit_bot_policy.mjs`。

## 0. 一句話架構

**手寫的 `BOT_TACTIC` 是基準;離線自對戰學習迴圈(`tools/bot_learn.mjs`)持續優化其中的
「取捨型旋鈕」,成果寫進 `public/js/botPolicy.js`,`data.js` 載入時經單一夾制縫套回
`BOT_TACTIC`** —— 中/高難度 bot 上場就是學到的策略,平衡一調整就重學一輪。

```
 平衡調整(data.js 任何數值)
        │  balanceFingerprint() 變了
        ▼
 tools/bot_learn.mjs ──(真 BattleSim + 真 BotBrain 自對戰;CRN 配對鏡射)──► 候選策略
        │  鏡射高斯擾動 ES,逐輪擇優;收尾閘門:乾淨種子上沒贏過現行策略就不落地
        ▼
 public/js/botPolicy.js(工具產出;零 import)
        │  data.js 覆寫迴圈:botPolicySanitize() 夾制後套回 BOT_TACTIC 白名單鍵
        ▼
 server/bots.js BotBrain(this.tac 單一讀取縫)──► 一般對局 / npm run sim / e2e
```

## 1. 為什麼是「學取捨」而不是「學操作」

bot 的強度由兩類東西組成:

- **能力**:視野錐(`BOT_VIEW`)、手速/反應(`BOT_DIFF.gap/react`)、準度(`aimErr`)、
  移速/射程/傷害(全在平衡縫裡)。這一類 **MUST NOT 學** —— A32「電腦玩家 MUST NOT 比真人
  多看/多走」;學能力 = 把作弊偷渡回來,而且畫面上只表現成「AI 變準了」。
- **取捨**:先打誰(選敵權重)、什麼時候撤(護盾線/集結參數)、距離環怎麼拉(打帶跑)。
  這一類沒有唯一正解,**最佳值隨平衡漂移**(例:重武器射程壓縮後,KITE_FAR 的最佳值跟著變)——
  這正是「平衡性調整時可不斷學習」要解的問題:手調常數會在每次平衡改版後悄悄過時。

## 2. 可學習集合(`data.js BOT_LEARN.KEYS`)與三類排除

| 可學習(8 鍵) | 語意 |
|---|---|
| `W_THREAT` / `W_OUTPUT` / `W_EXEC` | 選敵三權重(對我傷害最高 / 敵方輸出核心 / 快陣亡) |
| `EXEC_S` | 撿尾刀收割窗秒數 |
| `RALLY_SP` / `RALLY_BACK_M` | 集結復出護盾線 / 集結點退到塔後多遠 |
| `KITE_NEAR` / `KITE_FAR` | 打帶跑距離環(可擊發貼上 / 裝填中拉開) |

排除的三類,每一類都有結構性理由(稽核 Ⅱ 釘住):

1. **使用者定案值**:`PULL_SP`(=0.5)、`BASE_HP`(=0.25)、`PULL_HP`、`RESUME_HP`、
   `EXEC_MAX` —— 2026-08-02 使用者定案或舊制平衡錨,`audit_bot_tactics` 以字面值守門。
2. **帳的時鐘** `THREAT_S`:`sim._hurtLog` 累加前的淡出吃同一支 `botThreatDecay` ——
   逐 brain 各走各的秒數 = 記帳與讀帳兩個時鐘(「第二份帳」的變體)。
3. **能力欄**(§1)。另外白名單 8 鍵**只被 `tactic`/`elite` 分支消費** ⇒ 新手/低難度
   **結構性地**逐位元維持舊制,不靠「記得別改到」。

## 3. 單一縫佈局

| 縫 | 住哪裡 | 規則 |
|---|---|---|
| 策略檔 | `public/js/botPolicy.js` | 工具產出、人手 MUST NOT 編輯、零 import;`tactic = {}` = 中性 = 逐位元同手寫基準 |
| 夾制 | `data.js botPolicySanitize()` | **唯一**一份:執行期覆寫與學習工具同吃。邊界(`BOT_LEARN.KEYS`)鏡射 `audit_bot_tactics` 守門線(W_THREAT 恆最重、RALLY_SP ∈ (0.9,1) 且 > PULL_SP、KITE 近 < 遠、RALLY_BACK_M < tower.range 推導上界)⇒ 壞掉的學習輪寫出再離譜的值也會被夾回合法域 |
| 套用 | `data.js` 覆寫迴圈 | 恰一處 `BOT_TACTIC[k] =`;只動白名單鍵 |
| 讀取 | `bots.js this.tac` | 旋鈕讀取的唯一縫(`BOT_TACTIC.` 在 bots.js 零殘留);預設 = 全域 BOT_TACTIC,學習迴圈逐 brain 注入候選策略只換這一個參照。data.js 四支 helper(`botTargetPrio`/`botThreatDecay`/`botSalvo`/`botKiteF`)加了尾參數 `T = BOT_TACTIC` —— 不傳 = 舊行為 |
| 基準留檔 | `data.js BOT_TACTIC_BASE` | 覆寫前的凍結快照(同 `rate0` 的留檔模式);中性不變式與收尾評測都量它 |
| 指紋 | `data.js balanceFingerprint()` | FNV-1a over UNITS/CHARACTERS/WEAPONS/ECON/SQUAD/GAME;策略追指紋不追 commit |
| 合成戰場 | `test/simrun.mjs buildConfig()` | 匯出共用(學習工具與稽核 MUST NOT 各抄一份);simrun 加了入口/worker 守衛,被 import 不執行主流程 |

## 4. 學習方法(為什麼是這個形狀)

- **評測 = 真自對戰**:候選策略 vs 現行策略,真 `BattleSim` + 真 `BotBrain`、兩邊同難度。
  策略的價值只能在「對手也在打」的環境量到 —— `lanesim`/`duel` 都沒有 AI 決策,量不到取捨。
- **CRN(共同亂數)+ 側別鏡射**:每顆種子把 `Math.random` 換成 `mulberry32(seed)`(只在工具
  行程內、跑完還原),同一顆種子跑「候選當 SWARM」與「候選當 STEEL」各一場取平均。CLAUDE.md
  的教訓:單場工事損血在 433~10298 之間跳、n≤3 能同時「證明」變好與變壞 —— 不做配對削減,
  訊號整個淹在雜訊裡。同策略同種子 ⇒ 適應度**恆等於 0**(稽核 Ⅴ 的落地保險)。
- **適應度 = 工事損血差 + 擊殺差×0.05 + 勝負 ±2**(候選視角):二元勝負在長局天生飽和
  (塔+主堡總 HP 數十萬,上限內常未分勝負),工事損血差才是連續、對「推得動線」敏感的量。
  預設場景 2v2 × 240s = 既有 AI 退化量測的同一把尺。
- **鏡射高斯擾動(θ ± σd)的 (1+λ) ES**:無梯度、對雜訊穩健、8 維參數 —— 比 RL 少幾個
  量級的樣本,而且每一步都是可直接上場的完整策略。無改善輪自動縮步長(σ ×0.7)。
- **收尾閘門**:逐輪接受吃的是小樣本訓練種子 ⇒ 最終策略換一批**沒用過**的種子對「被取代的
  那份策略」重測,沒贏就不寫檔(寧缺勿錯)。`--force` 只給除錯。

## 5. 操作手冊(平衡調整後的標準流程)

```bash
# 平衡數值改完、npm run bal 全綠之後:
node tools/bot_learn.mjs --iters 8 --seeds 8 --workers 4    # 學習(自動偵測指紋過期、暖啟動)
node tools/bot_learn.mjs --eval                             # 驗收:現行策略 vs 手寫基準
node tools/audit_bot_policy.mjs                             # 稽核(40 項)
node tools/bot_learn.mjs --reset                            # 隨時可回中性(= 手寫基準)
```

- 指紋過期只**提示**不阻擋:過期的好策略仍比中性好(原則 6);要重學就直接跑。
- 樣本量紀律:`--seeds` 是每輪的配對種子數(×2 側別 = 每候選場數)。單場變異數極大,
  正式輪 MUST ≥ 8;示範/冒煙才用 2~4。
- 學到的策略對**中/高難度**生效(白名單鍵只被 tactic/elite 分支消費);難度階梯
  (新手 < 低 < 中 < 高)由能力欄維持,不受學習影響。

## 6. 驗證矩陣(改了什麼 → 跑什麼)

見 `CLAUDE.md §5` 對應列。核心:`audit_bot_policy.mjs`(40 項;`--break-clamp` /
`--break-neutral` 反向驗證)+ `audit_bot_tactics.mjs` / `audit_bot_vision.mjs`(讀取縫升級後
MUST 全綠)+ `npm test`(bot 沿兵線推進)+ `npm run sim`(仍分得出勝負/不卡死)。
中性策略下全部行為逐位元同舊制 ⇒ `npm run bal` 天然不動。
