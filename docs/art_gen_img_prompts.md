# ACG 機體立繪 img 生圖 Prompt 模板（32部共用）

> img 生圖英文模板之**唯一 settlement 點**。規格值唯一來源為 `docs/art_gen.md` §四規格總表（原型剪影、配色比重、徽記、輕重武器、護盾紋路、推薦戰鬥動作、防呆規則）；通用原則與注意事項見 `docs/art_gen.md` §二／§三；特效文化簽名見 `docs/ability-vfx-direction.md`。
>
> **防呆**：機體名、角色名、招式名稱**禁入 Prompt**（§四列出僅供紋路對照）；畫面**禁文字圖表台座**（`STRICTLY NO TEXT, NO LABELS, NO ANNOTATIONS, NO LEADER LINES, NO INFOGRAPHIC DIAGRAMS, NO BASE PEDESTALS`）；原型非人形者禁人形特徵，無人機武器禁手持；攻招／守招名禁入 Prompt。

---

## 一、通用生圖原則（img 生圖用）

1. **ACG風格與氛圍光效**：厚塗分色＋硬派墨線漫畫風（Bold anime ink linework, dynamic cel-shading，Cyberpunk Edgerunners × Arcane）；點綴微光六角戰術全息浮空能量粒子，僅氛圍光效，不得生成文字視窗或圖表。
2. **名稱禁入Prompt**：嚴禁機體名、角色名、招式名稱入Prompt，一律直球描述機械結構、仿生器官、武器造型、材質與色彩。
3. **畫面文字圖表禁令**：生圖畫面禁文字、標註、圖表、台座；英文禁令為 `STRICTLY NO TEXT, NO LABELS, NO ANNOTATIONS, NO LEADER LINES, NO INFOGRAPHIC DIAGRAMS, NO BASE PEDESTALS`。
4. **非人形防呆通則**：原型非人形者嚴禁預設人形特徵：獸型／多足／涉禽／恐龍／軟體頭足／昆蟲／純飛行載具不可出現人類直立腿、人臉、五指人手；無人機武器一律機身內嵌／砲塔／翼下掛架，不可手持。
5. **避色色幕去背規範**：選用本體、武器、塗裝、徽記、戰鬥光效中完全未出現之鮮豔單色（#00FF00／#FF00FF／#0088FF系），確保無損自動去背。
6. **攻招守招護盾呈現註記**：見本檔 §四（攻招／守招名僅定義特效文化簽名，不可寫入生圖 Prompt；護盾紋路僅裝飾）。

---

## 二、機甲／無人機模板（§四 4.1／4.2 填表用）

```text
Premium ACG game character portrait standee of [PROTOTYPE + BLENDER SILHOUETTE DELTA], from Steel vs Swarm in a dynamic combat action pose. STRICTLY NO TEXT, NO LABELS, NO ANNOTATIONS, NO LEADER LINES, NO INFOGRAPHIC DIAGRAMS, NO BASE PEDESTALS. Pure anime mecha character art. [NON-HUMANOID CONSTRAINT IF APPLICABLE]. The mecha is built with [ANATOMY AND CHASSIS]. Armor livery is primarily [PRIMARY COLOR AND RATIO], accented with [SECONDARY COLOR AND RATIO]. Embellished with [EMBLEM/FLAG/TATTOO]. LIGHT weapon: [LIGHT WEAPON MOUNT + TYPE + FIRING EFFECT]. HEAVY weapon: [HEAVY WEAPON MOUNT + TYPE + FIRING EFFECT]. Cultural shield motif (presentation only, never gameplay): [SHIELDFORM + CULTURE + FRAME]. Action pose: [DYNAMIC COMBAT ACTION]. Stylized in Cyberpunk Edgerunners and Arcane high-contrast anime cel-shading with bold black graphic inking and subtle floating glowing hexagonal tactical energy particles. BACKGROUND: A uniform, flat, solid bright chroma [CHROMA COLOR] background without gradients or shadows for clean chroma-key transparency.
```

| Prompt 佔位 | `docs/art_gen.md` §四欄位 |
| :--- | :--- |
| PROTOTYPE + BLENDER SILHOUETTE DELTA | 主原型與核心外觀 |
| NON-HUMANOID CONSTRAINT | 防呆規則 |
| ANATOMY AND CHASSIS | 主原型與核心外觀＋其他注意事項掛載行 |
| PRIMARY / SECONDARY COLOR AND RATIO | 主配色／比重，副配色／比重 |
| EMBLEM/FLAG/TATTOO | 徽記／圖騰／旗幟與位置 |
| LIGHT / HEAVY WEAPON | 輕武器，重武器（含掛載位置與類型） |
| SHIELDFORM + CULTURE + FRAME | 護盾紋路（純呈現） |
| DYNAMIC COMBAT ACTION | 推薦戰鬥動作與風格 |
| CHROMA COLOR | 避色色幕底色 |

---

## 三、變形者模板（§四 4.3 填表用，雙模式 70／30）

```text
Premium ACG game character portrait standee of the transformable morpher mecha, depicting dual forms in one dynamic cinematic anime composition to demonstrate seamless mechanical transformation coherence. STRICTLY NO TEXT, NO LABELS, NO ANNOTATIONS, NO LEADER LINES, NO INFOGRAPHIC DIAGRAMS, NO BASE PEDESTALS. Pure anime mecha character art.
PROPORTION RATIO:
- PRIMARY HERO FORM (Dominant 70% of composition, center/foreground): [PRIMARY MODE ANATOMY AND POSE]. [CRITICAL CONSTRAINTS].
- SECONDARY COMPLEMENTARY FORM (Accompanying 30%, lower/background): [SECONDARY MODE WITH IDENTICAL PARTS TRANSFORMED].
SHARED TRANSFORMATION DETAILS: Both forms share the exact same [SHARED MODULES].
Livery is primarily [PRIMARY COLOR AND RATIO], accented with [SECONDARY COLOR AND RATIO]. Embellished with [EMBLEM/TATTOO/FLAG].
LIGHT weapon: [LIGHT WEAPON + TYPE + SFX]. HEAVY weapon: [HEAVY WEAPON + TYPE + SFX]. Cultural shield motif (presentation only): [SHIELDFORM + CULTURE + FRAME].
Stylized in Cyberpunk Edgerunners and Arcane high-contrast anime cel-shading with bold black graphic inking and subtle floating glowing hexagonal tactical energy particles.
BACKGROUND: A uniform, flat, solid bright chroma [CHROMA COLOR] background without gradients or shadows for clean chroma-key transparency.
```

| Prompt 佔位 | `docs/art_gen.md` §四欄位 |
| :--- | :--- |
| PRIMARY MODE ANATOMY AND POSE | 主要型態（70%） |
| CRITICAL CONSTRAINTS | 防呆規則 |
| SECONDARY MODE | 次要型態（30%） |
| SHARED MODULES | 互變核心共用構件 |
| PRIMARY / SECONDARY COLOR AND RATIO | 主配色／比重，副配色／比重 |
| EMBLEM/TATTOO/FLAG | 徽記／圖騰／位置 |
| LIGHT / HEAVY WEAPON | 輕武器，重武器 |
| SHIELDFORM + CULTURE + FRAME | 護盾紋路（純呈現） |
| CHROMA COLOR | 避色底色 |

---

## 四、攻招／守招／護盾紋路呈現註記（僅供特效對照）

攻招（atk）與守招（def）名稱僅定義特效文化簽名（見 `docs/ability-vfx-direction.md`），不可寫入生圖 Prompt；護盾紋路（shieldForm）僅裝飾，不改伺服器結算。
