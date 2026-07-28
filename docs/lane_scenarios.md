# 1v1 兵線立體場景測試地圖

手動測試「兵線上的立體交通結構」時,不必自己在世界地圖上找位置 —— 下面七種場景各自指定一張
**預設場地**,開 1v1(每邊 1 人 ⇒ 1 條兵線)直接選那張場地即可。

場地清單的滑鼠提示(桌機把游標移到場地按鈕上)會顯示該場地 1v1 兵線實測走得到的場景;
鈕面刻意不寫(見 `/CLAUDE.md` A20:鈕面 MUST NOT 加括號補述)。

## 七種場景與判定

| # | 場景 | 代號 | 判定(遊戲內對應) |
|---|---|---|---|
| ① | 地下道 | `tunnel` | 兵線走進 OSM `tunnel` way,且該段**執行期真的成洞**(地表高過路面 + `TUN.CLEAR` + `ROOF_T` ⇒ `tunnelCoverIntervals` 有覆蓋區間)。平坦市區掛 tunnel tag 但蓋不出洞的不算 |
| ② | 地面高架橋 | `bridge` | 兵線**走在**橋面上(OSM `bridge` way,通行寬夾 `PASS_W`);橋面是可站立表面,底下可通行 |
| ③ | 明隧道 | `gallery` | 覆蓋段的側向土牆藏不住結構(`tunnelWallProfile` 判 `open`)⇒ 該側改蓋外露頂板 + 落地擋土 facade + 扶壁 |
| ④ | 平交道 | `crossing` | 兵線上有 OSM `railway=level_crossing` 節點(地面鐵軌與道路平面交會,遊戲內立警示柱 + 抬起的遮斷器) |
| ⑤ | 穿越高架橋底部 | `underBridge` | 兵線與某座橋的走廊**幾何交叉但不共節點** ⇒ 從橋下鑽過(橋面底緣是天花碰撞,跳不穿) |
| ⑥ | 穿越地下道上方 | `overTunnel` | 兵線與某條**覆蓋段**隧道交叉但不共節點 ⇒ 從洞頂的山體地表走過 |
| ⑦ | 一側高於一座砲塔的地形 | `highGround` | 兵線某一側的地形高出兵線 ≥ 一座砲塔高(`altTier()` = `TARGET_H.tower`),且連續涵蓋 ≥60 遊戲公尺 —— 這正是高度差加成(`ALTITUDE`)的觸發門檻 |

⑦ 的側向掃描距離預設 300 遊戲公尺(≈ 英雄重武器射程上限):站在那片高地上真的打得到兵線,
高度差加成才有意義。要看更貼身的高地,`--side=150` 重跑即可。

## 怎麼重跑判定

```bash
node tools/audit_lane_scenarios.mjs            # 全部場地
node tools/audit_lane_scenarios.mjs --only=jinlong,london
```

- 需要外網(Overpass 路網 + AWS terrarium 高程);抓過的結果快取在 `tools/.scen_cache/`,
  之後純離線可重跑。沙箱沒有這兩個出口時,改跑 GitHub Actions 的「兵線場景掃描」workflow。
- 判定與執行期同源:兵線走 `venueConfig(v, 1)`、bbox 走 `battleBBox`、路網查詢字串與
  `biomes.js` 同一份、高程走 `terrain.js` 的 terrarium 主來源並重跑同一條高度管線;
  隧道覆蓋與明隧道**直接執行 `biomes.js` 的函式原文**。
- 稽核同時複驗 `venues.js` 的 `VENUES[].scen` 標記:多標/漏標一律紅字。
  **標記 MUST 由實測產生**,不得手寫臆測。

## 為什麼判定要「執行期真的成洞/成橋」

OSM 的 `tunnel`/`bridge` tag 只說現實世界有這個結構,遊戲裡建不建得出來還要看地形:
平坦市區的地下道在高度場上根本沒有山體可以藏天花板,`buildRoads` 會把它當一般道路處理
(不開挖、不立門洞)。稽核因此一律把覆蓋區間算出來再判,避免「圖資有、遊戲裡沒有」的假陽性。
