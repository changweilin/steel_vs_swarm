# 三種遊戲機制:部署與連線指南

本作有三種連線機制,**遊戲內容完全相同** —— 差別只在「權威伺服器住在哪裡」。
大廳的「連線機制」三選一(☁ 雲端伺服器 / 🛰 區網對戰 / 🖥 單機模式)即時切換,選擇會記在瀏覽器裡。

| 機制 | 權威模擬在哪 | 誰能一起玩 | 要準備什麼 |
|---|---|---|---|
| ☁ 雲端伺服器 | 雲端節點的 Node 行程 | 網路上任何人(知道網址 + PIN) | 一台有公開網址的機器 |
| 🛰 區網對戰 | 開房那台主機 | 同區網,或同一個 Tailscale tailnet | 主機跑 `npm run lan` |
| 🖥 單機模式 | **你的瀏覽器分頁** | 只有你(對手是電腦玩家) | 什麼都不用,可離線 |

三者共用同一支房間邏輯 `server/rooms.js`(`RoomHub`)與同一支權威模擬 `server/sim.js`。
單機不是「客戶端自己算」——是**把伺服器整支搬進分頁**,客戶端一樣只送輸入、收 8Hz 快照
(架構鐵則見 [`/CLAUDE.md`](../CLAUDE.md) A1)。

---

## 🖥 單機模式(個人版 / GitHub Actions 特化版)

### 本機玩
```bash
npm start
# 瀏覽器開 http://localhost:8620/  → 大廳選「🖥 單機模式」
```

### 靜態單機版(GitHub Pages)
`.github/workflows/pages-solo.yml` 會在推上 `main` 時自動打包並部署。首次啟用:

1. 儲存庫 **Settings → Pages → Source** 選 **GitHub Actions**。
2. 推一次 `main`(或到 Actions 手動 `workflow_dispatch`)。
3. 部署完成後開 `https://<帳號>.github.io/<儲存庫>/`。

本機驗證打包結果:
```bash
npm run build:solo          # 產出 dist/(純檔案複製,無 bundler)
npx --yes http-server dist -p 8621
# 開 http://localhost:8621/
```

**打包做了什麼**:`tools/build_solo.mjs` 只做檔案複製,不轉譯、不打包、不改任何一行原始碼。
輸出的 URL 佈局**鏡射儲存庫佈局**:

```
dist/
  index.html    ← 轉址到 ./public/?mode=solo(相對網址;Pages 專案站台在子路徑)
  .nojekyll     ← 沒有這個,Jekyll 會吃掉底線開頭的檔案
  public/**     ← 客戶端全部(含地圖/模型/音效資產,約 165 MB)
  server/       ← sim.js(權威模擬)/ bots.js(電腦玩家)/ rooms.js(房間中樞)
```

鏡射是**必要條件**而不是美觀選擇:瀏覽器裡的 import 鏈是
`public/js/localhost.js → ../../server/rooms.js → ../public/js/data.js`,
只有鏡射佈局才能讓 `data.js` 在整個分頁裡是**同一個模組實例**(平衡數值只有一份)。
`server/server.js` 的 dev 靜態伺服器出的是同一套路徑,所以本機開發與線上完全一致。

**靜態站台自動判定**:`public/js/netmode.js` 的 `soloOnly()` 認得 `*.github.io` / `*.pages.dev` /
`file:` 協定,在這些站台一律鎖成單機並把另外兩顆鈕停用 —— 靜態站台沒有 WebSocket 端點,
與其讓玩家按半天才看到「與伺服器斷線」,不如直接講清楚。

**能玩到什麼**:全部。建立地圖(真實道路兵線)、開戰時刻、劇情戰役、全部 32 角色、電腦玩家難度。
線上地圖服務(OSRM / Overpass / 地形磚)照樣是外部 fetch,被限流時退回程序生成兵線(見 `/CLAUDE.md` §2.4)。

---

## 🛰 區網對戰(含 Tailscale 跨網)

```bash
npm run lan          # = node server/server.js --lan --https
```

啟動後主機會印出三組網址:

```
本機:      https://localhost:8620
Tailscale:  https://100.x.y.z:8620
MagicDNS:   https://my-box.tail1234.ts.net:8620
區網:       https://192.168.1.20:8620
```

- **同一個 Wi-Fi**:隊友直接開「區網」那組。
- **跨網(不同城市/不同 ISP)**:雙方都裝 [Tailscale](https://tailscale.com/) 並 `tailscale up` 加入
  **同一個 tailnet**,隊友開「Tailscale」或「MagicDNS」那組即可。對遊戲而言與家用區網完全一樣 ——
  不必開防火牆通訊埠、不必固定 IP、不必 port forwarding。
- 主機找不到 Tailscale 位址時會印提示。偵測方式是介面位址落在 CGNAT 段 `100.64.0.0/10`。

### 為什麼要 `--https`
手機**陀螺儀瞄準只在 secure context 生效**。用 `http://<區網 IP>` 開的話瀏覽器**靜默不派送**
感測器事件(沒有錯誤、沒有權限提示,就是不動)。`--https` 會用系統 `openssl` 生一張自簽憑證,
SAN 帶上 localhost + 全部區網/Tailscale IP + MagicDNS 名。首次連線會有一次「不安全連線」警告,
點「繼續前往」即可,secure context 照樣成立。沒有 `openssl` 就自動退回 http(伺服器照樣起得來)。

### 進階:`tailscale serve`
想讓隊友連到**有正式憑證**的網址(免掉自簽警告),可以讓 Tailscale 代管 TLS:

```bash
npm start                                   # 先用純 http 起在 8620
tailscale serve --bg --https=443 8620       # tailnet 內以 https://<MagicDNS 名>/ 對外
```

> `tailscale funnel` 會把服務**公開到整個網際網路**。那等同自架一個公開節點,
> 請改看下面的雲端章節(至少要設 `--max-rooms`),不要在沒有任何限額的情況下開 funnel。

---

## ☁ 雲端伺服器(規劃未來上雲端)

```bash
npm run cloud        # = node server/server.js --cloud
```

`--cloud` 與區網模式的差別:

| 項目 | 區網 | 雲端 |
|---|---|---|
| TLS | 自簽憑證(`--https`) | **交給平台/反向代理終止**,行程只講 http |
| 監聽埠 | 8620 | `$PORT`(平台注入) |
| 房間上限 | 不限 | `--max-rooms`(預設 24) |
| 大廳廣播的加入網址 | 區網/Tailscale 位址 | **空**(節點內網位址對玩家沒意義,而且是資訊外洩) |
| 關機 | Ctrl-C | `SIGTERM` 寬限期內停掉全部戰局再退出 |

### 環境變數 / 參數

| 參數 | 環境變數 | 預設 | 說明 |
|---|---|---|---|
| `--port <n>` | `PORT` | 8620 | 監聽埠 |
| `--host <addr>` | `HOST` | `0.0.0.0` | 綁定位址 |
| `--cloud` | `SVS_CLOUD=1` | 關 | 雲端模式 |
| `--max-rooms <n>` | `SVS_MAX_ROOMS` | 雲端 24 / 區網 不限 | 同時存在的戰區上限 |

### 健康檢查
```
GET /healthz → {"ok":true,"mode":"cloud","uptime":123,"maxRooms":24,"rooms":2,"players":5,"battles":1}
```
平台的 liveness/readiness probe 指到這裡即可。

### 容器
```bash
docker build -t steel-vs-swarm .
docker run -p 8620:8620 -e SVS_CLOUD=1 steel-vs-swarm
```
`Dockerfile` 用 `node:22-alpine` + `npm ci --omit=dev`(唯一依賴 `ws`),沒有 build step。

### 玩家怎麼連
大廳選「☁ 雲端伺服器」→ 填節點網址 → 按「↯ 連線」。
可以直接貼 `https://node.example.com`(自動換成 `wss://`),也可以只填主機名。
網址記在 `localStorage`,下次自動帶入。

### 上雲之前還要處理的事(尚未實作,刻意列出來)

本次交付的是**單節點可上雲**:一台機器、房間存在記憶體、玩家自己填網址。
真的要開公開服務,以下每一項都還沒做,**不要以為現況已經涵蓋**:

1. **水平擴充**:房間狀態在行程記憶體裡,多個副本之間不共享 ⇒ 目前只能單副本,
   或在前面掛「依 PIN 黏著」的路由。要真正水平擴充需要把房間索引搬到共享儲存 —— 那會引入外部依賴,
   與 `/CLAUDE.md` A2「MUST NOT 新增 npm 依賴」衝突,必須先決定要不要破例。
2. **身分與濫用防治**:目前沒有帳號、沒有連線速率限制、沒有 Origin 白名單。
   `--max-rooms` 只擋「開房洗滿」,擋不住單一連線狂送訊息(訊息大小上限 1 MiB 已在 ws 層封頂)。
3. **觀測性**:只有 `/healthz` 與 stdout。本專案刻意沒有集中 Logger(`/CLAUDE.md` §4),
   上雲時建議由平台收 stdout,而不是在程式裡加 log 服務。
4. **地區延遲**:8Hz 快照對 RTT 不算敏感,但跨洲仍會明顯。多地區部署要先解決第 1 點。
5. **成本**:每間房一支 8Hz tick + 完整 `BattleSim`,CPU 是主要成本,記憶體其次。
   `--max-rooms` 就是為了讓單節點的最壞情況可預測。
