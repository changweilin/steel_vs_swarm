# ACG 機體立繪 img 生圖 Prompt 模板（32部共用）

> img 生圖英文模板之**唯一 settlement 點**。規格值唯一來源為 `docs/art_gen.md` §四規格總表（原型剪影、配色比重、徽記、輕重武器、護盾紋路、防呆規則）；32部推薦戰鬥動作見本檔 §五；通用原則見本檔 §一；特效文化簽名見 `docs/ability-vfx-direction.md`。
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
| DYNAMIC COMBAT ACTION | 本檔 §五32部機體推薦戰鬥動作與風格 |
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

---

## 五、32部機體推薦戰鬥動作與風格（DYNAMIC COMBAT ACTION）

| 機體編號 | 推薦戰鬥動作與風格 |
| :---: | :--- |
| **s06** | 前揚雙前蹄、右手平舉磁軌狙擊長槍瞄準，背部飛彈垂直點火升空。 |
| **s07** | 4 條步足如章魚般抓緊焦土，4 條上方觸手向前狂舞，激發出多層拓撲電漿網。 |
| **s09** | 蓄力躍起騰空瞬間，長尾向後舒展平衡，雙手持雙管長槍斜向下轟出大面積火網。 |
| **t01** | 碎冰重踏突進姿態，斧砲寒芒暴閃，重機槍拋殼，腳底掀起暴風雪震波。 |
| **t02** | 高空靈動大跳躍下墜瞬間，單膝微屈，雙手持超長電磁長矛貫穿地面，電光環繞。 |
| **t03** | 雙拳與巨砲砸地狂嘯，胸腹排氣管噴出滾滾熱核蒸汽，周圍焦土碎石飛濺。 |
| **t04** | 伏臥在雪堆殘垣間，背部反器材重砲砲口微調鎖定，砲口制退器激發出強烈衝擊波。 |
| **t05** | 在平原上以高鐵般極速貼地滑步奔馳，長頸平伸，右翼展開亮出超導長矛光束。 |
| **t10** | 左手上揚啟動全息雷達屏障，肩部垂直飛彈破蓋而出，右手機砲斜指天際噴吐火舌。 |
| **t12** | 巍峨挺立如不動巨塔，眉心標定砲充盈刺眼白光，右手脈衝長槍平端掃描戰場。 |
| **m02** | 巨顎暴怒張開至極限，喉部超導磁軌砲蓄力產生刺目電弧，巨足重踏撕裂地面。 |
| **m06** | 低伏前進，背部 8 片骨板向兩側微傾展開，數十枚子母彈如同暴雨般呈扇面齊射升空。 |
| **s01** | 高速戰術大角度側傾俯衝，機槍咆哮噴火，兩側火箭巢齊射升空。 |
| **s02** | 懸停於戰場上空，巨大的溫壓火箭破膛而出，尾焰烈火撕裂空氣，機槍向下傾瀉金屬風暴。 |
| **s04** | 低空超音速俯衝破空衝撞，機鼻工兵鏟破甲向前，電漿與霰彈同時怒吼。 |
| **s05** | 以 90 度極限側切翻滾穿越廢墟障礙，機身後方拖曳出霓虹紫色運動軌跡與微型蜂群。 |
| **s08** | 穩定懸浮於槍林彈雨中，共軸雙槳高速旋轉，兩側電磁長針發出神聖白光狙穿敵陣。 |
| **s11** | 於平流層靜默滑翔，V 尾穩定氣流，機首射出如手術刀般筆直耀眼的光子聚焦光束。 |
| **s12** | 高速穿破雲層，鴨翼靈敏轉向，機頭藍色光電感測球鎖定地面，頂部星象砲轟出粗壯光柱。 |
| **t07** | 翼膜迎風鼓起，長喙狙擊管瞄準目標，槍口消焰器綻放微弱白光。 |
| **t08** | 於粉紅花瓣與電磁雲霧中蜿蜒盤旋，龍口怒張釋放同心圓音波震波，雙翼帶起疾風。 |
| **t09** | 高空巡航，背部艙蓋彈開，巡飛彈帶動火箭助推器呼嘯破空而出，劃過長空。 |
| **m03** | 穿梭於風雪冰川裂隙，尾推螺旋槳疾轉，翼下火箭呼嘯發射，偶極天線陣列閃爍導航光。 |
| **m04** | 展翅翱翔俯衝，翼端指羽微調氣流，肩上 4 枚細長羽毛飛彈同時點火無聲突襲。 |
| **s03** | 飛鯨於上方俯衝疾馳，獨角雷光激盪；下方巨象仰天長嘯，重足踏破陣線。 |
| **s10** | 地面迅猛龍躍起撲殺，第二趾鐮刀爪寒芒四射；空中始祖鳥展翅滑翔鎖定。 |
| **t06** | 靈猴金箍棒橫掃千軍，烈火電漿噴湧；上方筋斗雲高速掠過劃出音障雲。 |
| **t11** | 老兵機甲雙盾護胸、肩砲狂暴齊射；背景飛翼巡邏機低空傾轉掠過支援。 |
| **m01** | 吸血鬼姿態單手加特林開火，另一手飛彈出膛；背後三角翼以超音速掠過天際。 |
| **m05** | 狼人型態利爪刨地狂奔，獠牙滴落電漿；上方飛鼠型態展開膜翼如幽靈般無聲滑翔。 |
| **m07** | 展翅金龜懸空怒吼，雙聯防空砲對空掃射；陣地金龜收翅如堅不可摧之綠色堡壘。 |
| **m08** | 黑豹低伏於陰影中悄無聲息潛行；上方夜梟滑翔型展開巨大消音羽翼無聲鎖定。 |
