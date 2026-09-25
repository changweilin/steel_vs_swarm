# ACG 機體立繪生圖指南 —— 變形者篇（Morphers）

本文件專供專案 8 部**雙模式可變機甲（Morphers）**的立繪（Character Standee Art）生成與提示詞（Prompt）撰寫使用。

---

## 一、 通用生圖原則與 Prompt 規範

1. **【最高版面準則】雙模式同框與 70 / 30 比例規範**：
   * 變形者機體必須**在同一張畫布上完整呈現兩種模式**，並具備可相互變形的機械邏輯關聯性。
   * **主要型態（Primary Form，70% 佔比）**：選擇最具視覺張力與戰鬥風格的模式作為前景主體，主導畫面核心。
   * **次要型態（Secondary Form，30% 佔比）**：於背景或畫布角落作為伴隨型態，展示另一模式的戰術功能與形態變化。
2. **【零件互變通則】構件型態對應與飛行艙門密封**：
   * **零件本體一致**：主副模式由同一套機械零件變形而來（如同一組頭部／座艙、同一組主裝甲外殼、同組動力系統），不可在次要模式任意新增多餘的獨立外部零件。
   * **飛行時步足完全收容**：當處於飛行／浮空模式時，地面模式所使用之四肢或步足**必須完全收折封入腹面機艙（Belly Bay）且腹部閉合平滑**，絕對不可有吊掛在外的殘留肢體。
3. **【形態通則】原型非人形者嚴禁添加人形特徵**：
   * 若該機體原型為仿生獸型、昆蟲、恐龍或純飛行載具，非人形狀態下嚴禁畫出人類面孔、直立人類雙腿或五指人手。
4. **【最高防呆】嚴禁將機體名、角色名、招式名稱寫入生圖 Prompt**：
   * 絕對不可出現任何機體、角色或技能專有名詞，避免 AI 產生誤導性文字、字牌或錯置的人形駕駛員。
   * 請一律直球描述**兩種形態的機械結構、變形構件、武器裝備與色彩配比**。
5. **【最高防呆】嚴禁任何畫面文字與圖表標註**：
   * Prompt 必備負向約束：`STRICTLY NO TEXT, NO LABELS, NO ANNOTATIONS, NO LEADER LINES, NO INFOGRAPHIC DIAGRAMS, NO BASE PEDESTALS`。
6. **避色色幕背景（Chroma-Key Background）**：
   * 背景色必須選擇在該機體**兩型態本體、武器、塗裝、徽記、旗幟、戰鬥光效中完全未出現的鮮豔單色**（如 Chroma Green `#00FF00`、Chroma Magenta `#FF00FF` 或 Chroma Sky-Blue `#0088FF`），以利全自動無損去背。

---

## 二、 變形者篇規格與生圖參數表（共 8 部）

| 機體編號 | 參考代號（禁入Prompt） | 主要型態（70%）與特徵 | 次要型態（30%）與特徵 | 互變核心共用構件 | 主配色／比重 | 副配色／比重 | 避色底色 | 徽記／圖騰／位置 | 武器特徵與裝備位置 | 防呆規則（個別機體嚴禁特徵） | 其他注意事項 | 推薦戰鬥動作與風格 |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| **s03** | 林翎<br>「利維坦」 | **飛鯨浮空艦（Sky-Whale）**<br>巨型流線機械鯨體，背部指揮塔艦橋，四足完全封入腹艙，象牙貼平頰側，胸鰭後掠展開相控陣雷達。 | **機械巨象（Colossus Elephant）**<br>四足柱狀重裝象腿落地衝鋒，雙耳展開為相控陣雷達，雙牙前下後翹成月牙。 | 象鼻 $\leftrightarrow$ 獨角螺旋光矛；象耳 $\leftrightarrow$ 後掠胸鰭；四足收納進腹艙；共享同一具氣囊軀幹與無頸鯨首。 | 碧海青天色（`0x9ef2e6` 綠松石青）<br>約 70% | 槍鐵灰隔艙稜條、高亮青藍光譜<br>約 30% | **純洋紅**<br>`#FF00FF` | 艦體／象腹側面印有林翎專屬**對稱線描羽紋徽（tattoo）** | **輕**：耳廓相控陣高頻波束槍。<br>**重**：額隆微波發射矩陣／挺直的獨角穿透長矛光束。 | 飛鯨模式下**嚴禁出現任何外露象腿**！獨角與象鼻為同一構件，不可在頭上多長一根角。 | 兩態體積差距與構件對應需嚴格落實。 | 飛鯨於上方俯衝疾馳，獨角雷光激盪；下方巨象仰天長嘯，重足踏破陣線。 |
| **s10** | 卡佳・塔姆<br>「羽陣」 | **迅猛龍地面型（Raptor Ground）**<br>【定案 70% 主型態】深蹲低伏獵殺姿態，長吻齒列，前爪帶折疊羽刃收攏於臂側，後足第二趾翹起致命高頻振盪鐮刀爪，長尾平衡。 | **始祖鳥飛行型（Archaeopteryx Flight）**<br>【定案 30% 次型態】雙臂前爪羽刃完全展開為寬大分片羽翼，尾羽如扇面攤平，如猛禽般盤旋俯衝。 | 前爪羽刃 $\leftrightarrow$ 飛行羽翼；龍吻頭顱共用；鐮刀足在飛行時向後貼腹收攏；剛性長尾 $\leftrightarrow$ 尾羽扇面。 | 骨白鈦金屬（`0xd7b87f` 淺鈦金/羽灰白）<br>約 70% | 曜石黑關節、電磁赤金亮線<br>約 30% | **純深藍**<br>`#0044FF` | 簡約幾何線條（minimal），刻於大腿前緣與機背 | **背脊武器架**：長莢發射電磁穿顱長矛，短莢發射相位脈衝雷射（兩態皆朝向機首）。 | **迅猛龍為趾行深蹲，嚴禁畫成直立人形腿！** 飛行時雙腿必須向後收起，不可拖地行走。 | 前爪羽片在地面模式是折疊收縮的刀刃，飛行時完全張開成翼。 | 地面迅猛龍躍起撲殺，第二趾鐮刀爪寒芒四射；空中始祖鳥展翅滑翔鎖定。 |
| **t06** | 陸小川<br>「輕功」 | **齊天靈猴地面型（Monkey Mech）**<br>【定案 70% 主型態】美猴王人型靈猴機甲，猴面額戴雙螺旋金箍，頭頂鳳翅紫金冠雙翎，身手矯健，雙手揮舞發光如意金箍棒。 | **筋斗雲無人飛翼（UAV Cloud Flight）**<br>【定案 30% 次型態】靈猴肢體折疊鎖定，身後筋斗雲飛翼展開成高空超音速無人長航偵察飛翼。 | 金箍棒 $\leftrightarrow$ 無人機中軸機身整流罩；身軀金屬骨架 $\leftrightarrow$ 飛翼核心；雙翎天線 $\leftrightarrow$ 翼端空速管。 | 齊天朱砂赤紅（`0xffb44d` 亮橙朱紅）<br>約 65% | 耀眼金箍明黃、紫金金屬光澤<br>約 35% | **純翠綠**<br>`#00E600` | 極簡京劇臉譜風格金屬線條（minimal） | **手持**：長棒型熔核焚天電漿砲。<br>**胸側**：特裝高初速微聲機槍孔。 | **靈猴必須靈活矯捷，嚴禁畫成笨重大猩猩！** 飛行型態必須是乾淨流線的無人飛翼。 | 紫金雙翎為感測天線，飛翼形態轉為後掠尾梢。 | 靈猴金箍棒橫掃千軍，烈火電漿噴湧；上方筋斗雲無人機高速掠過劃出音障雲。 |
| **t11** | 拉斐爾・富恩特斯<br>「老兵」 | **阿特拉斯步兵型（Atlas Biped）**<br>【定案 70% 主型態】粗獷鉚接老式重步兵機甲，頭戴等腰直角三角頭盔（正面露臉），肩上配置寬大貨物托盤平台，雙手各持一面旋翼圓盾。 | **傾轉旋翼飛翼巡邏機（Tiltrotor B-2）**<br>【定案 30% 次型態】雙臂旋翼圓盾向上傾轉為推進旋翼，三角頭盔與雙肩托盤拼合成 B-2 匿蹤三角飛翼。 | 三角頭盔 $\leftrightarrow$ 飛翼機首機鼻；雙手旋翼圓盾 $\leftrightarrow$ 左右傾轉螺旋槳；肩上托盤 $\leftrightarrow$ 飛翼主翼面。 | 叢林數碼迷彩綠（`0x8a9a5a` 橄欖綠）<br>約 70% | 硝煙鐵黑、油污黃銅色、黃白警示條<br>約 30% | **純洋紅**<br>`#FF00FF` | 車體各處帶有數碼迷彩（camo）與磨損老兵軍團編號 | **肩甲托盤上方**：右架雙聯 12.7mm 機槍莢，左架 SPG-9 無後座力砲（恆朝前發射）。 | **武器一律安裝在肩上托盤頂面**，雙手持圓盾，嚴禁手持肩砲。 | 等腰直角三角頭盔是本機核心標誌，飛行時即為三角機首。 | 老兵機甲雙盾護胸、肩砲狂暴齊射；背景飛翼巡邏機低空傾轉掠過支援。 |
| **m01** | 德揚・科瓦切維奇<br>「渡鴉」 | **吸血鬼突襲型機甲（Vampire Assault）**<br>【定案 70% 主型態】高挑冷峻的人型機甲，widow's peak 尖突面罩與單片眼眶，身後披掛深色三角滑翔翼（呈摺疊披風狀）。<br>*(若依調整設定狼人：則為高大狼人戰鬥姿)* | **三角滑翔超音速飛行態（Delta Glider）**<br>【定案 30% 次型態】身後雙半翼展開鎖定為完整水平大三角滑翔翼，低空高速滑翔突襲。<br>*(若依調整設定飛鼠：則為展開滑翔膜之飛鼠態)* | 背後雙半翼披風 $\leftrightarrow$ 拼合鎖定之水平三角主翼；胸甲核心與推進噴口共用。 | 塞爾維亞深藍（`0xd94f2f` 國旗三色系）<br>約 60% | 紅白藍三色飾條（natflag 紅白藍）、黑曜石冷光<br>約 40% | **純翠綠**<br>`#00E600` | 胸甲與滑翔翼端帶有清晰**塞爾維亞紅白藍三色國旗飾帶** | **右手**：六管加特林機槍艙。<br>**左手**：雙聯穿盾導引飛彈發射箱。 | **嚴禁直升機螺旋槳！** 2026-08-13 已明確定案「移除旋翼，改成三角滑翔翼」。 | 披風是折疊的三角滑翔翼，兩態共用此翼面。 | 吸血鬼姿態單手加特林開火，另一手飛彈出膛；背後三角翼以超音速掠過天際。 |
| **m05** | 瑪爾塔・韋恩<br>「鎖喉」 | **狼人深屈型機甲（Werewolf Ground）**<br>【定案 70% 主型態】深屈四足狼形機械獸，身軀拉長，狼吻獠牙，四肢呈 X 字形伸展，四肢關節間貼附緊湊的連體飛膜（Patagium）。 | **滑翔飛鼠飛行型（Flying Squirrel Flight）**<br>【定案 30% 次型態】四肢向四周完全張開如飛鼠般極致繃緊飛膜，頭部微縮，在夜空中貼地滑翔索敵。 | 四肢骨架 $\leftrightarrow$ 飛鼠骨架；連體飛膜（Patagium）$\leftrightarrow$ 滑翔翼面；狼吻下顎 $\leftrightarrow$ 前端感測整流罩。 | 劇毒暗紫灰（`0x55516c` 深夜灰紫）<br>約 65% | 霓虹電光青、高壓散熱亮銅色<br>約 35% | **純翠綠**<br>`#00E600` | 左右軸向反轉陰陽分色塗裝（split: 'x', splitFlip: true） | **背部右側**：整合式摺疊三管電磁機砲。<br>**背部左側**：全向自導飛彈微型莢艙。 | **嚴禁鳥羽翅膀！** 2026-08-13 已明確定案「移除羽毛翅膀，改為四肢 X 字型展開之連體飛鼠飛膜」。 | 飛膜貼合四肢關節，不可脫離肢體懸空。 | 狼人型態利爪刨地狂奔，獠牙滴落電漿；上方飛鼠型態展開膜翼如幽靈般無聲滑翔。 |
| **m07** | 約蘭妲・里奧斯<br>「落閘」 | **犀角金龜展翅型（Rhino Beetle Flight）**<br>【定案 70% 主型態】巨大厚重金屬犀角朝天，背部巨大厚甲鞘翅呈 V 字向兩側高高掀起，下方展開兩對透明高頻震顫的機械膜翅撲翼。 | **金龜重裝陣地型（Rhino Beetle Ground）**<br>【定案 30% 次型態】鞘翅完全闔上貼背鎖定形成不動鐵壁，六隻昆蟲節肢緊抓地面，背部防空砲塔升起。 | 巨大犀角、前胸背板、昆蟲三節身軀、六隻昆蟲跗節完全共用；僅鞘翅開闔與膜翅伸展。 | 叢林甲蟲墨綠（`0x5fa833` 帶金屬虹彩）<br>約 75% | 焦黑昆蟲腹板、能量青金石藍光縫<br>約 25% | **純洋紅**<br>`#FF00FF` | 鞘翅外表面雕刻幾何甲蟲圖騰（totem） | **背部甲殼中央**：雙聯裝 35mm 厄利孔高射防空旋轉砲塔。<br>**頭下口器兩側**：扇面防衛電漿噴射口。 | **昆蟲是頭胸腹三節，沒有脖子！** 六隻腳是昆蟲節肢與跗節，**嚴禁獸爪肉墊、嚴禁人型雙腿**！ | 鞘翅為純防禦重裝甲外殼，膜翅為真正飛行推進撲翼。 | 展翅金龜懸空怒吼，雙聯防空砲對空掃射；陣地金龜收翅如堅不可摧之綠色堡壘。 |
| **m08** | 維迪雅・拉托爾<br>「空號」 | **消音黑豹地面型（Panther Ground）**<br>【定案 70% 主型態】極度流線低矮的四足黑豹機械獸，絨質消音裝甲，圓潤豹首與三角耳，細長金屬平衡尾，伏地前行。 | **展翅夜梟飛行型（Owl Glider Flight）**<br>【定案 30% 次型態】背部隱藏的雙肩無聲夜梟羽翼完全向前掠展開，雙肩狙擊管平伸，在夜色中無聲滑翔。 | 豹身四足與尾巴 $\leftrightarrow$ 滑翔時收攏之機腹；雙肩隱形羽翼 $\leftrightarrow$ 摺疊貼身之肩甲；消音毛面材質兩態一致。 | 匿蹤啞光深炭黑（`0x8f7f70` 絨面吸波黑）<br>約 80% | 幽靈冰晶藍感測鏡、微光電磁導軌<br>約 20% | **純洋紅**<br>`#FF00FF` | 覆蓋全機的暗夜微光數碼迷彩（camo） | **雙肩頂部**：雙肩對稱配置大口徑消音反器材重狙。<br>**前胸下部**：特裝微聲點射槍。 | **整台機體嚴禁強烈金屬高光與硬反光**（必須為吸音吸波啞光消光質感）！純貓科／鳥類仿生，無人型特徵。 | 雙肩羽翼平時收縮貼合於豹背，飛行時向前掠張開。 | 黑豹低伏於陰影中悄無聲息潛行；上方夜梟滑翔型展開巨大消音羽翼無聲鎖定。 |

---

## 三、 變形者通用英文生圖 Prompt 模板（標準結構）

```text
Premium ACG game character portrait standee of the transformable morpher mecha, depicting dual forms in one dynamic cinematic anime composition to demonstrate seamless mechanical transformation coherence. STRICTLY NO TEXT, NO LABELS, NO ANNOTATIONS, NO LEADER LINES, NO INFOGRAPHIC DIAGRAMS, NO BASE PEDESTALS. Pure anime mecha character art.
PROPORTION RATIO:
- PRIMARY HERO FORM (Dominant 70% of composition, center/foreground): [PRIMARY MODE DESCRIPTION, ANATOMY, AND POSE]. [CRITICAL CONSTRAINTS: e.g. If airborne, all ground legs completely retracted and sealed inside ventral bays with smooth belly; if beast, zero human limbs].
- SECONDARY COMPLEMENTARY FORM (Accompanying 30% of composition, lower/background): [SECONDARY MODE DESCRIPTION SHOWING IDENTICAL MECHANICAL PARTS TRANSFORMED: e.g. limbs deployed, wings folded/extended, weapon components corresponding].
SHARED TRANSFORMATION DETAILS: Both forms share the exact same [LIST SHARED MODULES: hull, head, plates, power core].
Livery is primarily [PRIMARY COLOR AND RATIO], accented with [SECONDARY COLOR AND RATIO]. Embellished with [EMBLEM/TATTOO/FLAG DETAILS].
Weaponry prominently equipped: [WEAPON 1 WITH FIRING SFX] and [WEAPON 2 WITH FIRING SFX].
Stylized in Cyberpunk Edgerunners and Arcane high-contrast anime cel-shading with bold black graphic inking and subtle floating glowing hexagonal tactical energy particles.
BACKGROUND: A uniform, flat, solid bright chroma [CHROMA COLOR: green/magenta/blue] background without gradients or shadows for clean chroma-key transparency.
```
