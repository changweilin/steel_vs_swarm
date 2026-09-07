# 程序森林

神木群落與邊界樹木共用 `public/js/forest.js`。11 種樹種各有 3 個確定性骨架變體；落點決定變體，再沿用每株尺寸、朝向與細節種子。分枝生成使用獨立亂數，不多消耗場景共用序列。

造型參考主工作目錄的 `tools/ai3d/photos/tree/`：

- `broadleaf_tree/CC0_broadleaf_tree_001.jpg`：開展側枝、不對稱傘冠。
- `conifer_tree/CC0_conifer_tree_001.jpg`：長直幹、漸縮枝層、冠間空隙。
- `buttressed_giant/CC0_buttressed_giant_002.jpg`：板根、冠部分枝與不規則輪廓。

照片只作造型參考；遊戲無需載入照片或呼叫外部生成服務。

## 分佈設定

修改 `TREE_SPECIES` 每種樹的欄位：

| 欄位 | 單位與作用 |
| --- | --- |
| `lat` | 絕對緯度，南北半球共用；四值為「外側下界、偏好下界、偏好上界、外側上界」。 |
| `altitude` | 原始海拔公尺，四值同上；不使用遊戲放大或道路整平後的地形。 |
| `share` | 適生區內的相對權重範圍，依群落座標選定；不是最終百分比硬配額。 |
| `form` | `spire` 針葉、`tiers` 輪生、`open` 疏冠、`umbrella` 傘冠、`buttress` 板根。 |

偏好區間權重為 1，往外側界線線性降至 0。緯度權重 × 海拔權重 × 群落權重，最後正規化為各樹種機率。`treeDistribution(latitude, altitude, mix)` 可直接查看比例；這是遊戲美術分佈，不宣稱精確重建原生植物區系。無可用樹種時略過。

群落以中心位置決定樹種，同群保留同種林相；邊界逐落點抽樣。碰撞、高度限制與樹冠羞避沿用既有流程，冠幅取所有變體的保守包絡。幹、枝、葉仍共用樹基風相位與風擺材質。

驗證：`node tools/audit_forest.mjs`、`node tools/audit_tree_joints.mjs`。新增抽樣稽核也納入 `npm run check`。
