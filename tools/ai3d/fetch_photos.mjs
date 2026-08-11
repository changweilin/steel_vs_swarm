#!/usr/bin/env node
/**
 * 照片庫抓取器(docs/ai3d_asset_plan.md §4.1;Track B 靜態零件的照片來源)
 *
 * 「照片數據庫」= 下方 PHOTO_CATALOG(逐物件族 × 逐零件的查詢型錄)+ photo_manifest.json
 * (帳本)+ photos/(檔案,**勿入版控** —— 照片只是離線輸入,入庫的只有零件 GLB)。
 *
 * 四條紀律:
 *   ① **授權硬閘,不是建議**:查詢寫死 `license=cc0`,而且逐張複驗回傳欄位
 *      (Openverse `license` ∈ {cc0, pdm};Commons LicenseShortName 含 CC0 / Public domain)。
 *      **CC-BY 也拒收** —— 烤進 repo 的石頭沒有地方放署名,而授權違規沒有任何錯誤訊息。
 *   ② **可續跑補缺**:每個零件有目標張數(want),重跑只補不足的部分,已有的照片
 *      與帳本原樣保留(同 gen2d.mjs ① 的續跑語意)。
 *   ③ **記帳**:每一張都寫進 photo_manifest.json({source_url, license, creator,
 *      retrieved_at, …}),skill photo-to-prop-forge §1 規定的欄位一項不少。
 *   ④ **降級不例外**(原則 6):單一 API 掛掉/單張下載失敗只記 fail 繼續,
 *      MUST NOT 中止整批;Openverse 沒料改問 Wikimedia Commons。
 *
 * 選片標準(2026-08-09 使用者定案:「挑選的照片盡可能乾淨,只有目標物件無其他物件,
 * 且光源充足」;一張好照片勝過三張拼湊的):
 *   ㋐ 這裡能過濾的:授權(CC0/PD)、短邊 ≥1024(API 有回尺寸才驗,沒回的照收並在帳本
 *      標 `size_unknown`)。**查詢用字是唯一能在下載之前影響「乾淨/單一主體」的旋鈕**
 *      ⇒ 一律具名單一主體(`glacial erratic` 而不是 `rocks`),MUST NOT 寫場景詞。
 *   ㋑ 這裡過濾不了的:「畫面裡有幾個東西」「光夠不夠」——那要看**去背之後的 matte**
 *      才量得到 ⇒ 住 `screen_mattes.py` 的 ④多主體 / ⑤光源不足(門檻拿已出貨來源校準,
 *      零誤殺),統計分不開的一帶進該支的觀察名單 sheet 交給人眼。
 *   ⇒ **這兩支是同一道閘的兩半**:改了任一邊的標準,另一邊要跟著看。
 *
 * ⚠ 沙箱跑不動(CLAUDE.md ㋓):api.openverse.org / commons.wikimedia.org 走不出代理
 *    ⇒ 本工具在真機(3060 那台)或 GitHub Actions 上跑。
 *
 * 用法:
 *   node tools/ai3d/fetch_photos.mjs --plan               只印工作清單與缺額(不打 API;
 *                                                        計的是「可用」張數 —— 選片閘
 *                                                        screen_mattes.py 淘汰的不算)
 *   node tools/ai3d/fetch_photos.mjs --family rock        只抓某一族(rock|tree|landmark|building)
 *   node tools/ai3d/fetch_photos.mjs --part rock/facet    只抓某一個零件
 *   node tools/ai3d/fetch_photos.mjs --limit 10           本輪最多下載幾張
 *   node tools/ai3d/fetch_photos.mjs --review             列出已抓照片供人工挑選(路徑 + 尺寸 + 來源)
 *   node tools/ai3d/fetch_photos.mjs --home <資料家>      語料不在本 checkout 底下時(帳本與 photos/ 同住那裡)
 *   node tools/ai3d/fetch_photos.mjs --inbox             印出「自己放圖的地方」在哪、格式怎麼寫(順便建好資料夾)
 *   node tools/ai3d/fetch_photos.mjs --adopt             把 inbox 裡的圖收編成正式語料(授權硬閘照跑)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusMeta } from './provenance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// 資料家(photos/ 與帳本)= `--home`,不給就是腳本自己的目錄(舊行為逐位元不變)。
// ⚠ 語料家會搬:runbook §5af-g 記過一次「worktree 被刪掉,整份 305 筆 superset 跟著沒了」——
// 把資料家綁在「腳本住哪」等於逼每一個 checkout 各養一份語料。同 screen_mattes.py --home。
const _HOME_I = process.argv.indexOf('--home');
const HOME = _HOME_I >= 0 ? process.argv[_HOME_I + 1] : HERE;
const PHOTOS = join(HOME, 'photos');
const MANIFEST = join(HOME, 'photo_manifest.json');
const UA = 'steel-vs-swarm-asset-pipeline/1.0 (CC0 photo sourcing; contact: repo issues)';

// ============ 照片型錄(唯一縫)============
// 族/零件對齊計畫書 §4.2 的「AI 該產出什麼」:查詢是**零件**不是成品(拍整棵樹沒有用,
// image→3D 要的是樹冠模組/枝叉/板根各自成像)。want = 每零件目標張數(多抓幾張供挑選,
// 一件零件最後只用一張 —— skill §1:一張好照片勝過三張拼湊的)。
export const PHOTO_CATALOG = {
  // 第 5 輪大擴充(2026-08-05 使用者定案):「大量下載不同樹種的 2D 照片再 img→3D,
  // 無視舊有物件、不要只是原版重繪」⇒ 樹族改成**逐樹種**列(GIANT_DEFS 的 11 個真實
  // 樹種逐種對位 + VEG_DEFS 常見樹種),查詢一律走實測有效的「具名單一主體」句式;
  // 岩族加四個新岩型;建築族加 img→3D 友善的單一主體模組(使用者定案:建築也走
  // img→3D,計畫書 §8 方法分流已修訂)。族序 = 抓取優先序(fetcher 依序補缺)
  // ⇒ **第 7 輪把 rock 提到最前面**(2026-08-06 使用者定案「大量下載不同國家地區的
  // 地質岩層或奇石/巨岩的照片」):tree 族還有 5 列零張,排在後面的族在無 `--family`
  // 的整輪跑法裡永遠輪不到(§5h 已用「樹種列優先」踩過同一個坑)。
  // ⇒ **第 8 輪把 tree 提到最前面**(2026-08-06 使用者定案「大量下載不同國家地區的不同
  // 樹種,如灌木/闊葉林/針葉林/各種大小神木的照片」):同一條族序規則,這一輪換樹族排頭。
  tree: {                                                  // VEG_DEFS / GIANT_DEFS:樹冠模組/枝叉/板根
    // —— F0 輪(2026-08-07 使用者定案「神木要重新找,有神木全身照片的圖,無其他干擾的照片」)——
    // 語料庫攤開後的診斷是「污染不是不足」(82 張 matte 人眼只剩 ~16 張可用;統計分桶與門檻住
    // screen_mattes.py 檔頭、規格住 runbook 佇列 F0):下載張數不再是帳 ⇒ have() 只計選片閘
    // 未淘汰的條目。**紅杉別再抓**(結構性失敗:它出名的原因就是「大到拍不下」,絕大多數照片
    // 不是遊客當比例尺就是仰角局部,換查詢字救不回來)⇒ sp_sequoia want 歸零。樹種放寬到
    // 「天生單株立在空地、背景是天空」的巨木 —— 遊戲要的是「神木 = 巨木」,VEG_DEFS/GIANT_DEFS
    // 消費的是冠簇/樹幹/板根的**形狀**,不是樹種名。查詢往「孤立單株 + 全身輪廓」句式走
    // (lone / isolated / full height silhouette),刻意避開 trunk/bark 這類必然回傳局部特寫
    // 的字。列序 = 抓取優先序:F0 列排樹族最前(族序規則同第 7/8 輪)。
    gt_dragontree: { want: 5, q: ['dragon blood tree socotra', 'dracaena draco tree canary', 'lone dragon tree'] }, // 龍血樹(F0 點名;天生傘冠單株)
    // 斜側視角探針列(§5p 待續② → §5q 已收斂,want 歸零):實測 5 張 —— 空拍單株的主體
    // 天生太小(matte 畫布 253~711px,4/5 被剝空桶擋),唯一倖存是一座**小島**(空拍查詢
    // 撈到的是島/林不是樹)⇒ 斜側語料在**採集端**就死了,救不了冠簇;冠簇定案走
    // 程序 ico + 貼圖(§5q),img→3D 只收雕塑性主體(枯幹/樹幹/板根)。
    gt_oblique: { want: 0, q: [] },
    canopy:   { want: 12, q: ['solitary oak tree meadow', 'lone tree field', 'isolated tree grassland', 'isolated tree against sky', 'tree full height silhouette'] }, // 曠野孤立橡樹(F0 點名;+全身輪廓句式)
    sp_baobab:  { want: 6, q: ['solitary baobab', 'lone baobab tree', 'baobab tree', 'adansonia tree'] },          // 猴麵包樹(F0 點名;既有 2 張可用正是這一型)
    sp_acacia:  { want: 6, q: ['umbrella thorn acacia', 'acacia tree savanna', 'lone acacia tree'] },              // 傘刺金合歡(F0 策略的同型印證家)
    sp_conifer: { want: 8, q: ['lone spruce tree field', 'solitary fir tree meadow', 'single conifer tree'] },     // 孤立松柏(F0 點名)
    sp_pine:    { want: 8, q: ['lone scots pine tree', 'stone pine tree isolated', 'solitary pine tree field'] },  // 孤立松柏(F0 點名)
    // —— 第 8 輪大擴充(2026-08-06 使用者定案)——
    // 使用者點名四組:**灌木 / 闊葉林 / 針葉林 / 各種大小神木**,跨國跨地區逐樹種。
    // 對位方式同第 5 輪(逐樹種)與第 7 輪(逐岩型):**對位的是消費端那一列的形狀**,
    // 不是照片家的名字(節點角色 ≠ 照片家,§5e/§5i/§5j 已三度證實):
    //   sh_* → VEG_DEFS.shrub 的 ico(0.9)/ico(0.6) 兩顆矮團
    //   bl_* → VEG_DEFS.broadleaf ico(2.7)/ico(1.7)、birch ico(2.0)/ico(1.2)
    //   cf_* → VEG_DEFS.conifer2 的 ico 簇疊冠(conifer/3/4 是 cone/cyl 包絡,**不換**)
    //   gt_* → GIANT_DEFS 尚無專屬冠形的樹種(§5h 只推進到 6 形/11 種)+ 小徑冠簇
    //          (klinki/alerce 的冠簇只有 2.2~3.0m,比現有最小節點 3.325 還小 ⇒ 這一輪
    //           才有機會補上使用者說的「各種**大小**神木」)
    // 查詢一律「具名單一主體 + 地區」句式(§5c 實測:句式勝過所有模型旋鈕),
    // 且刻意避開 forest / woodland / grove 這類**整片**詞 —— 那是暗景與雜訊的來源。
    // 新列排在既有缺額列之前:buttress/sp_willow/sp_banyan 的候選重度 Wikimedia-hosted,
    // 排前面會把每一輪都撞死在 429 上(§5h 同款坑)。
    // 灌木(使用者「灌木」;矮團冠,VEG_DEFS.shrub)
    sh_rhodo:   { want: 4, q: ['rhododendron bush in bloom', 'azalea shrub isolated'] },                  // 喜馬拉雅/日本
    sh_juniper: { want: 4, q: ['juniper shrub isolated', 'creeping juniper bush rock'] },                 // 地中海/北美高山
    sh_sage:    { want: 4, q: ['sagebrush desert shrub', 'creosote bush desert plant'] },                 // 北美大盆地
    sh_heather: { want: 4, q: ['gorse bush yellow flower', 'heather shrub moorland'] },                   // 蘇格蘭/北歐
    sh_boxwood: { want: 4, q: ['boxwood shrub garden', 'rounded topiary shrub'] },                        // 歐洲庭園
    sh_protea:  { want: 4, q: ['protea shrub fynbos', 'banksia shrub australia'] },                       // 南非/澳洲
    // 闊葉林(使用者「闊葉林」;VEG_DEFS.broadleaf / birch)
    bl_beech:   { want: 4, q: ['solitary beech tree field', 'lone beech tree meadow'] },                  // 中歐
    bl_birch:   { want: 4, q: ['lone silver birch tree', 'solitary birch tree field'] },                  // 北歐/西伯利亞
    bl_plane:   { want: 4, q: ['lone plane tree', 'solitary sycamore tree field'] },                      // 地中海/英國
    bl_chestnut:{ want: 4, q: ['lone horse chestnut tree', 'solitary chestnut tree meadow'] },            // 巴爾幹/西歐
    bl_jacaranda:{ want: 4, q: ['jacaranda tree in bloom', 'flamboyant tree isolated'] },                 // 南美/南非
    bl_olive:   { want: 4, q: ['ancient olive tree', 'old olive tree isolated'] },                        // 地中海
    bl_mango:   { want: 4, q: ['lone mango tree field', 'large mango tree isolated'] },                   // 南亞/熱帶
    bl_camphor: { want: 4, q: ['large camphor tree', 'lone zelkova tree'] },                              // 東亞
    // 針葉林(使用者「針葉林」;VEG_DEFS.conifer2 的簇疊冠)
    cf_spruce:  { want: 4, q: ['lone norway spruce tree', 'solitary spruce tree meadow'] },               // 北歐/阿爾卑斯
    cf_larch:   { want: 4, q: ['lone larch tree autumn', 'solitary larch tree'] },                        // 西伯利亞/阿爾卑斯
    cf_cedar:   { want: 4, q: ['lebanon cedar tree', 'old cedar tree isolated'] },                        // 黎巴嫩/喜馬拉雅
    cf_araucaria:{ want: 4, q: ['monkey puzzle tree', 'araucaria tree isolated'] },                       // 智利/南美
    cf_yew:     { want: 4, q: ['ancient yew tree churchyard', 'lone yew tree'] },                         // 英國
    cf_juniper_tree:{ want: 4, q: ['old juniper tree twisted', 'bristlecone pine tree'] },                // 北美高山
    // 各種大小神木(使用者「各種大小神木」;GIANT_DEFS 尚無專屬冠形的樹種 + 小徑冠簇)
    gt_dougfir: { want: 5, q: ['douglas fir tree isolated', 'lone douglas fir tree'] },                   // 北美西岸
    gt_sitka:   { want: 5, q: ['sitka spruce tree', 'lone spruce tree coast'] },                          // 阿拉斯加/英國
    gt_kauri:   { want: 5, q: ['kauri tree new zealand', 'giant kauri tree'] },                           // 紐西蘭
    gt_cryptomeria:{ want: 5, q: ['giant cryptomeria tree', 'japanese cedar giant tree'] },               // 日本屋久島/台灣
    gt_dipterocarp:{ want: 5, q: ['emergent rainforest tree crown', 'tall tropical tree isolated'] },     // 婆羅洲
    gt_alerce:  { want: 4, q: ['alerce tree patagonia', 'fitzroya tree chile'] },                         // 巴塔哥尼亞
    // —— 第 4 輪品質補抓(2026-08-05)——首批 14 張過 SF3D 只有 1 顆實心:buttress 查詢
    // 命中臘葉標本掃描、canopy 命中夜拍。與 rock 族同一帖藥:「具名單一主體」。
    // (canopy 列已上移到 F0 輪 —— 它就是「曠野孤立橡樹」那一列)
    // —— 第 5 輪逐樹種列(GIANT_DEFS 對位;缺額續補)——
    // sp_sequoia:F0 定案**別再抓**(結構性失敗;既有 6 張全數不可用:2 張含遊客、4 張剝空/
    // 仰角局部)。列留著讓 --plan 把歷史下載與淘汰數印出來;want 0 = 永無缺額,不再花額度。
    sp_sequoia: { want: 0, q: [] },
    sp_cypress: { want: 5, q: ['italian cypress tree', 'lone cypress tree', 'mediterranean cypress isolated'] },
    sp_euc:     { want: 6, q: ['lone gum tree paddock', 'eucalyptus tree isolated', 'gum tree australia'] },
    sp_tropical:{ want: 6, q: ['kapok tree isolated', 'rainforest emergent tree', 'lone tropical tree field'] },
    // —— 逐樹種列(VEG_DEFS / 場地地貌對位;sp_acacia / sp_baobab 已上移到 F0 輪)——
    sp_willow:  { want: 5, q: ['weeping willow tree isolated', 'lone willow tree lake'] },
    sp_maple:   { want: 6, q: ['lone maple tree field', 'solitary maple tree autumn', 'isolated maple tree'] },
    sp_banyan:  { want: 5, q: ['banyan tree isolated', 'large fig tree isolated', 'lone ficus tree'] },
    sp_cherry:  { want: 5, q: ['lone cherry blossom tree', 'sakura tree isolated', 'cherry tree in bloom field'] },
    fork:     { want: 8, q: ['tree branch fork bare', 'large tree bough', 'lone bare oak tree winter', 'dead standing tree'] },
    buttress: { want: 14, q: ['ceiba buttress roots', 'kapok tree trunk buttress', 'moreton bay fig trunk', 'strangler fig trunk', 'ficus macrophylla roots'] },
  },
  rock: {                                                  // MEGALITHS:岩面/崩落塊/落石堆
    // 第 3 輪品質補抓(2026-08-05):數量達標 ≠ img→3D 可用 —— CC0 語料重度偏向博物館
    // 掃描/畫作/立體鏡老照片,rock 族逐張人眼覆核後可用率近乎零。改用「現代、單體、
    // 站在空地上」的地物詞:glacial erratic(冰川漂礫)正是「孤立巨石」的專名。
    facet:    { want: 9, q: ['glacial erratic boulder', 'erratic boulder', 'granite boulder isolated'] },
    // 第 2 輪放寬名詞(runbook §4-A:第 1 輪 0/4、1/4 的成因是查詢措辭太窄,不是沒料)
    collapse: { want: 7, q: ['glacial erratic', 'balanced rock formation', 'fallen boulder'] },
    talus:    { want: 4, q: ['scree slope', 'talus slope mountain', 'rock debris slope'] },
    // —— 新岩型(第 5 輪;MEGALITHS/rockfield 的形狀字彙擴充)——
    hoodoo:   { want: 6, q: ['fairy chimney cappadocia', 'hoodoo rock formation', 'sandstone hoodoo', 'mushroom rock desert'] },
    tor:      { want: 6, q: ['granite tor dartmoor', 'granite tor', 'weathered granite outcrop'] },
    karst:    { want: 5, q: ['limestone karst pinnacle', 'karst rock formation', 'limestone pinnacle'] },
    strata:   { want: 5, q: ['tilted rock strata', 'sedimentary rock outcrop', 'layered rock formation'] },
    // —— 第 7 輪大擴充(2026-08-06 使用者定案):「大量下載不同國家地區的地質岩層或
    // 奇石/巨岩的照片,再進行 img to 3D;無視舊有的物件直接畫,禁止使用原版重繪」——
    // 結構同第 5 輪的逐樹種列:**逐岩型對位消費端**(`biomes.js synthMegalith` 的 11 型
    // dome/slab/tower/spire/arch/mesa/hoodoo/fin/basalt/granite/marble)—— 對位的是
    // 「這一型的形狀」,不是照片家的名字(節點角色 ≠ 照片家,§5e/§5i 已兩度證實)。
    // granite tor 沿用既有 `tor` 列、hoodoo 沿用既有 `hoodoo` 列(改點名卡帕多奇亞),
    // 其餘九型各開一列;查詢一律走實測有效的「具名單一主體」句式(§5c:句式勝過所有
    // 模型旋鈕),且**逐列點名不同國家/地區的那個地物專名** —— 專名才是 CC0 語料裡
    // 真正存在的檢索詞(`glacial erratic` 一詞換來整個岩族的第一顆可用件)。
    mg_dome:    { want: 5, q: ['granite dome rock', 'bornhardt inselberg', 'sugarloaf granite monolith'] },        // 巴西/澳洲/西非
    mg_slab:    { want: 5, q: ['tilted rock slab outcrop', 'leaning monolith rock', 'standing rock slab'] },       // 北歐/澳洲
    mg_tower:   { want: 5, q: ['devils tower rock', 'quartzite pillar zhangjiajie', 'sandstone tower butte'] },    // 美國/中國
    mg_spire:   { want: 5, q: ['granite spire peak', 'rock needle pinnacle', 'aiguille granite tower'] },          // 巴塔哥尼亞/白朗峰
    mg_arch:    { want: 5, q: ['natural rock arch', 'sandstone arch desert', 'natural stone bridge rock'] },       // 猶他/馬爾他
    mg_mesa:    { want: 5, q: ['sandstone butte desert', 'mesa rock formation desert', 'tepui table mountain'] },  // 紀念碑谷/委內瑞拉
    mg_fin:     { want: 5, q: ['sandstone fin ridge', 'rock fin formation', 'knife edge rock ridge'] },            // 猶他/挪威
    mg_basalt:  { want: 6, q: ['columnar basalt rock', 'giants causeway basalt column', 'basalt column cliff'] },  // 北愛/冰島
    mg_marble:  { want: 5, q: ['marble rock formation', 'rounded marble boulder', 'white marble outcrop'] },       // 智利/希臘
    // —— 地質岩層與奇石(使用者句中的「地質岩層」「奇石」;供 fin/slab/mesa 的層理外觀
    // 與 rockfield 露頭字彙,不逐一對位單一岩型)——
    st_folded:  { want: 5, q: ['folded rock strata', 'geological fold anticline', 'contorted rock layers'] },      // 阿爾卑斯/蘇格蘭
    st_banded:  { want: 5, q: ['banded sandstone dome', 'bungle bungle beehive rock', 'striped rock formation'] }, // 澳洲 Purnululu
    st_seastack:{ want: 5, q: ['sea stack rock coast', 'coastal rock stack isolated', 'rock stack ocean'] },       // 澳洲/冰島/蘇格蘭
    st_tafoni:  { want: 4, q: ['tafoni honeycomb weathering rock', 'honeycomb rock formation'] },                  // 地中海/加州
    st_dolmen:  { want: 5, q: ['dolmen megalith stone', 'standing stone menhir', 'megalithic standing stone'] },   // 韓國/愛爾蘭/法國
    st_travertine:{ want: 4, q: ['travertine terrace rock', 'travertine rock formation'] },                        // 土耳其/黃石
    st_lava:    { want: 4, q: ['volcanic rock outcrop', 'lava rock formation isolated'] },                         // 冰島/夏威夷
    st_pinnacle:{ want: 4, q: ['limestone stone forest pinnacle', 'pinnacles desert limestone'] },                 // 中國石林/澳洲
  },
  building: {                                                // hazards BUILDERS:窗格/簷口/陽台/外管
    // ⚠ 本族的**整棟建物**列(帶 `grp` 欄那些)受配比約束,見檔尾 BUILDING_MIX 與 buildingMix()。
    window:   { want: 4, q: ['window facade', 'office building facade', 'factory windows'] },
    roofcap:  { want: 4, q: ['rooftop parapet', 'building rooftop', 'roof cornice'] },
    balcony:  { want: 3, q: ['concrete balcony facade', 'apartment balcony module'] },
    piping:   { want: 3, q: ['industrial external piping wall', 'building exterior pipes'] },
    // —— img→3D 友善的單一主體屋頂/立面模組(第 5 輪;使用者定案建築走 img→3D)——
    acunit:   { want: 6, q: ['air conditioner outdoor unit', 'hvac rooftop unit', 'air conditioning condenser'] },
    rooftank: { want: 5, q: ['rooftop water tank', 'stainless steel water tank', 'plastic water tank'] },
    chimney:  { want: 5, q: ['brick chimney', 'industrial chimney stack', 'old brick smokestack'] },
    dormer:   { want: 5, q: ['dormer window roof', 'roof dormer'] },
    // —— 第 6 輪大擴充(2026-08-06 使用者定案):「大量下載不同國家、城市、小鎮、風格的
    // 建築物照片,再進行 img to 3D;無視舊有物件直接畫,禁止使用原版重繪」——
    // 查詢一律走實測有效的「具名單一主體」句式(§5c/§5g:句式勝過所有模型旋鈕);
    // 建物多為獨棟開闊地主體(穀倉/風車/教堂/農舍…),貼街相連的立面列(rowhouse/shophouse)
    // 明知 SF3D 會出薄殼,仍收 —— fill 預篩會擋,留作立面模組語料。列序 = 抓取優先序:
    // 本批接線的模組列在前(tank_wood 供水塔第二款式),整棟風格列供本批與後續批次。
    tank_wood:      { want: 5, q: ['wooden water tower rooftop', 'wooden water tank tower', 'rooftop wooden water tower new york'] },
    // ============ 整棟建物(`grp` 欄 = 配比分組;見上方 BUILDING_MIX)============
    // ⚠ 只有帶 `grp` 的列進配比;上面那些是**零件**(窗格/屋頂配件)不是建物,不在其中。
    // ⚠ `src` 欄 = **輸入格式**('photo' 預設 / 'drawing' 測繪線稿),與 `grp` **正交**:
    //    前者決定走哪一條轉換路(img→3D vs plan_to_mesh 的視覺外殼),後者決定配比。
    //    詳見檔尾 BUILDING_MIX 註解 ④。
    // —— ㋐ 一般市區(50%):街廓裡真的排成一排的那些樓。整棟量體那一桶(building/mass_*)
    //        的語料來源,也是 planBlocks 沿街配置看得到的主體 ——
    bld_tower:      { grp: 'urban', want: 9, q: ['art deco skyscraper', 'stepped skyscraper setback', 'brutalist concrete tower block',
      'modernist office tower', 'gothic revival skyscraper', 'apartment tower block'] },               // 市中心高樓
    bld_office:     { grp: 'urban', want: 6, q: ['curtain wall office building', 'mid century modern office building', 'concrete office block sunlit'] }, // 一般辦公樓
    bld_apartment:  { grp: 'urban', want: 6, q: ['walk up apartment building', 'residential apartment block', 'housing block facade sunlit'] },          // 一般住宅樓
    bld_corner:     { grp: 'urban', want: 5, q: ['corner commercial building', 'street corner building', 'mixed use building street'] },                 // 街角商業樓
    bld_rowhouse:   { grp: 'urban', want: 5, q: ['brick townhouse facade', 'amsterdam canal house facade', 'victorian terraced house'] },                // 歐洲城市街屋
    bld_shophouse:  { grp: 'urban', want: 4, q: ['shophouse facade', 'colonial shophouse'] },                                                            // 東南亞城鎮
    bld_warehouse:  { grp: 'urban', want: 5, q: ['brick warehouse', 'old factory building', 'industrial warehouse exterior'] },                          // 工業
    // ⚠ 查詢 MUST 帶 **`photocopy of (measured) drawing`** 這個字面詞組(2026-08-09 實測,§5ak-g):
    //   HABS 的**相片**與**測繪圖**在 Commons 上共用同一套命名(相片的標題也叫
    //   `SOUTH (FRONT) ELEVATION - …`),所以 `HABS drawing elevation X` 撈回來的多半是相片;
    //   而測繪圖掃描的檔名一律以 `Photocopy of drawing` / `Photocopy of measured drawing` 開頭。
    //   撈到相片不會報錯 —— 它會一路走到 plan_to_mesh 才被判退,浪費一整輪配額。
    dwg_tower:      { grp: 'urban', src: 'drawing', want: 4, q: ['photocopy of measured drawing elevation commercial building',
      'photocopy of drawing elevation office building', 'photocopy of measured drawing elevation warehouse',
      'photocopy of drawing elevation apartment building'] },
    // —— ㋑ 鄉村 / 觀光旅宿(25%)——
    bld_inn:        { grp: 'rural', want: 3, q: ['country inn building', 'mountain lodge hotel', 'ryokan traditional inn'] },   // 觀光旅宿
    bld_barn:       { grp: 'rural', want: 2, q: ['red barn field', 'old wooden barn', 'lone barn meadow'] },                    // 美國鄉間
    bld_windmill:   { grp: 'rural', want: 2, q: ['dutch windmill', 'stone windmill isolated', 'old windmill field'] },          // 荷蘭
    bld_chalet:     { grp: 'rural', want: 2, q: ['alpine chalet', 'swiss chalet mountain', 'wooden mountain hut alps'] },       // 瑞士山城
    bld_minka:      { grp: 'rural', want: 2, q: ['japanese thatched farmhouse', 'gassho zukuri house', 'thatched roof cottage'] }, // 日本合掌造
    bld_hanok:      { grp: 'rural', want: 2, q: ['korean hanok house', 'hanok traditional building'] },                         // 韓國
    bld_medit:      { grp: 'rural', want: 2, q: ['santorini white house', 'whitewashed greek house', 'mediterranean house isolated'] }, // 地中海
    bld_stonecottage:{ grp: 'rural', want: 2, q: ['stone cottage', 'scottish blackhouse', 'stone farmhouse countryside'] },     // 蘇格蘭/愛爾蘭
    bld_halftimber: { grp: 'rural', want: 1, q: ['half timbered house', 'fachwerkhaus', 'tudor house'] },                       // 德/英老鎮
    bld_adobe:      { grp: 'rural', want: 1, q: ['adobe house', 'pueblo adobe building', 'mud brick house'] },                  // 美洲西南/北非
    bld_yurt:       { grp: 'rural', want: 1, q: ['mongolian yurt', 'ger tent grassland'] },                                     // 蒙古草原
    dwg_house:      { grp: 'rural', src: 'drawing', want: 2, q: ['photocopy of measured drawing elevation house',
      'photocopy of drawing elevation farmhouse', 'photocopy of measured drawing elevation barn',
      'photocopy of drawing elevation cottage'] },
    // —— ㋒ 功能型(25%):使用者點名的寺廟/教堂/醫院/車站/學校/博物館/公家機構 ——
    bld_temple:     { grp: 'civic', want: 3, q: ['buddhist temple building', 'shinto shrine building', 'taoist temple hall'] }, // 寺廟
    bld_church:     { grp: 'civic', want: 3, q: ['village church', 'white wooden church', 'country church steeple'] },          // 教堂
    bld_station:    { grp: 'civic', want: 3, q: ['railway station building', 'historic train station building'] },              // 車站
    bld_school:     { grp: 'civic', want: 3, q: ['red brick schoolhouse', 'school building exterior'] },                        // 學校
    bld_museum:     { grp: 'civic', want: 2, q: ['neoclassical museum building', 'museum building exterior'] },                 // 博物館
    bld_civic:      { grp: 'civic', want: 2, q: ['city hall building', 'courthouse building'] },                                // 公家機構
    bld_hospital:   { grp: 'civic', want: 2, q: ['hospital building exterior', 'clinic building exterior'] },                   // 醫院
    bld_pagoda:     { grp: 'civic', want: 1, q: ['japanese pagoda', 'five storied pagoda', 'stone pagoda'] },                   // 東亞塔樓(宗教)
    bld_lighthouse: { grp: 'civic', want: 1, q: ['lighthouse tower', 'coastal lighthouse isolated'] },                          // 海岸公共設施
    dwg_civic:      { grp: 'civic', src: 'drawing', want: 2, q: ['photocopy of measured drawing elevation church',
      'photocopy of drawing elevation school building', 'photocopy of measured drawing front elevation courthouse',
      'photocopy of drawing elevation railroad station'] },
  },
  landmark: {                                                // beacons KIND_PARTS:桁架節/微波碟/水塔桶/貨櫃
    lattice:  { want: 4, q: ['electricity pylon', 'transmission tower', 'steel lattice tower'] },
    dish:     { want: 3, q: ['microwave dish antenna tower', 'parabolic antenna'] },
    tank:     { want: 3, q: ['water tower', 'water tank', 'elevated water tank'] },
    // ⚠ 舊查詢字 `shipping container single` / `cargo container isolated` 抓回來的 3 張是
    // **兩張維多利亞玻璃魚缸 + 一張港口全景**(2026-08-10 §5av-c 人眼複核):博物館把玻璃
    // 容器編目成 "container",而「單一主體」那類修飾字對館藏標題完全無效。改用**具名的
    // 那個東西**(skill:「Ask for a named single subject, never a scene or a category」)——
    // 貨櫃的具名說法是 intermodal / corten / conex,而 `stacked` 才是這一款要的樣子。
    container:{ want: 3, q: ['intermodal freight container', 'stacked shipping containers yard',
                             'conex box container'] },
  },
};

// ============ 整棟建物的語料配比(2026-08-09 使用者定案)============
// 「建築照片的部分 50% 挑一般市區建築,25% 挑鄉村或觀光旅宿建築,25% 挑功能型建築
//   如寺廟/教堂/醫院/車站/學校/博物館/公家機構等等」
//
// 三條紀律:
//   ① **配比只約束「整棟建物」**(帶 `grp` 欄的列)。窗格/簷口/冷氣機/屋頂水塔/煙囪那些
//      是**零件**不是建物 —— 把它們算進分母,50% 就會隨「這一輪加了幾個零件列」浮動,
//      而那與使用者說的那句話無關。
//   ② **配比是驗出來的,不是註解**:`buildingMix()` 逐列加總 `want` 現算,`--plan` 與每次
//      抓取前都印;偏差超過 MIX_TOL 直接紅字擋下。手寫在註解裡的比例會在下一次有人改
//      某一列 want 時**靜默過期**(同 §5ae-e 那兩份手寫清單),而照片是真金白銀的配額。
//   ③ 分組是**用途**不是風格:同一種立面既可能是市區辦公樓也可能是鄉間旅館 ⇒ 以「這棟樓
//      在城市裡扮演什麼角色」歸類,因為消費端(planBlocks 沿街配置 / 整棟量體桶)吃的正是角色。
//   ④ **`grp`(建物類別)與 `src`(輸入格式)是正交的兩維,MUST NOT 併成一欄**
//      (2026-08-09 使用者第二輪定案:「設計圖 + 照片**總比例**滿足 50 + 25 + 25 即可」)。
//      設計圖曾經是**不帶 grp** 的單獨一列(§5ai-e 的理由:「輸入格式不是建物類別」)——
//      使用者這句話推翻了它:分母含設計圖。而「把設計圖當第四個類別」是另一種錯:
//      50/25/25 三個數字加起來就是 1,多一個類別**當場算不出來**,drift 守門線只會在
//      每一組都印出一個錯的百分比。故:`grp` 唯一決定配比、`src` 唯一決定走哪條轉換路
//      (photo → matte + img→3D;drawing → plan_to_mesh 的正投影視覺外殼)。
//      逐組的設計圖配額取**同一個比例**(各組 want 的 ~9%:urban 4/44、rural 2/22、civic 2/22)
//      ⇒ 加進分母之後 50/25/25 仍然是**整除**的,不吃 MIX_TOL 的餘裕。比例壓得低是因為
//      §5ai-e 的產出率:六張測繪圖只有一張是乾淨線稿(其餘是水彩/版畫渲染,`plan_to_mesh`
//      的 LINEART_INK 會擋);但它是**唯一**能給出精確正投影輪廓的輸入,值一成的配額。
//   ⑤ **設計圖 MUST NOT 走照片的選片閘**:`matte_photos.py`/`screen_mattes.py` 的門檻是拿
//      **照片**校準的(主體佔比、亮度、bbox 填滿率),線稿的統計是另一個分布 —— 而且設計圖
//      根本不需要去背。它的品質閘是 `plan_to_mesh.py --screen` 那三道(輪廓圍不圍得起來 /
//      是不是渲染圖 / 圖框),回寫的欄位與選片閘同一個(`entry.screen`)⇒ have() 一視同仁。
// ============ 取景階梯(2026-08-10 使用者定案)============
// 「搜索 img 要使用更精準的關鍵字,盡量抓背景乾淨、無太多干擾、目標清晰的圖」。
//
// 為什麼是**階梯**而不是把字直接改進型錄的 `q`:
//   ① 型錄的 `q` 已經是「具名單一主體」句式(§5c 實測:句式勝過所有模型旋鈕),那是**主體**;
//      這裡加的是**取景**(背景乾不乾淨、光夠不夠),兩個維度混寫進同一行就再也拆不開,
//      而下一輪要調的通常只有其中一個。
//   ② 加了取景字的查詢**候選池必然更小** —— CC0 圖庫本來就不大,先問窄的會讓某些零件
//      一張都撈不到。故:先跑型錄原本的查詢,**只有缺額還在**才往下走這幾階
//      ⇒ 供給充足時逐位元同舊行為(既有 390 筆帳本不受影響)。
//   ③ 逐族分開:「plain sky」對曠野孤木/巨岩是對的,對建物要的是「立面正面、無遮擋」;
//      共用一份就會把建物查成天空照。
// 取景字只取**已量到有效的那一類**:isolated / plain background / clear sky / unobstructed
// (§5c 的 `lone tree field` 一族);MUST NOT 寫 studio / product shot —— CC0 圖庫裡那是
// 商品照,對岩體與樹是空的。
// 只給照片列:設計圖(`src: 'drawing'`)的查詢是測繪圖名,套取景字只會把它查成 0 筆。
export const CLEAN_Q = {
  tree:     ['isolated against plain sky', 'clear background full tree', 'unobstructed daylight'],
  rock:     ['isolated against plain sky', 'clear background sunlit', 'unobstructed single boulder'],
  building: ['whole building unobstructed', 'clear sky plain background', 'sunlit facade no trees'],
  landmark: ['isolated against sky', 'unobstructed clear background'],
  _:        ['isolated plain background', 'unobstructed daylight'],
};
const CLEAN_BASE_N = 2;      // 只拿型錄前 N 條當底(全展開會把一輪的 API 額度燒在同一個零件上)

/** 這個零件這一輪要跑的查詢序:型錄原句在前,取景階梯在後(缺額還在才會走到)。 */
export function queryLadder(fam, def) {
  if (srcOf(def) !== 'photo') return [...def.q];
  const tail = CLEAN_Q[fam] || CLEAN_Q._;
  return [...def.q, ...def.q.slice(0, CLEAN_BASE_N).flatMap((q) => tail.map((t) => `${q} ${t}`))];
}

export const BUILDING_MIX = { urban: 0.50, rural: 0.25, civic: 0.25 };
const MIX_TOL = 0.02;                                        // 配額是整數 ⇒ 允許的四捨五入餘裕
export const SRC_KINDS = ['photo', 'drawing'];               // 輸入格式(預設 photo)
export const srcOf = (def) => def.src || 'photo';

/** 現行型錄的實際配比(逐列 want 加總;只計帶 grp 的整棟建物列)。
 *
 * `bySrc` = 逐組的 photo / drawing 拆帳:沒有這一欄,「配比對了」會蓋掉「這一組全是設計圖、
 * 一張照片都沒有」(兩者的轉換路完全不同 ⇒ 那不是同一份語料)。
 */
export function buildingMix(catalog = PHOTO_CATALOG) {
  const by = {}; const bySrc = {}; let total = 0;
  for (const [part, def] of Object.entries(catalog.building || {})) {
    const src = srcOf(def);
    if (!SRC_KINDS.includes(src)) throw new Error(`building/${part}:未知輸入格式 ${src}`);
    // 設計圖沒有 grp 就會**靜默逃出分母** —— 那正是使用者這一輪推翻的舊行為(④)。
    if (src !== 'photo' && !def.grp) throw new Error(`building/${part}:${src} 列缺 grp,配比會漏算它`);
    if (!def.grp) continue;
    if (!(def.grp in BUILDING_MIX)) throw new Error(`building/${part}:未知分組 ${def.grp}`);
    by[def.grp] = (by[def.grp] || 0) + def.want; total += def.want;
    (bySrc[def.grp] ||= {})[src] = (bySrc[def.grp]?.[src] || 0) + def.want;
  }
  const share = {};
  for (const g of Object.keys(BUILDING_MIX)) share[g] = total ? (by[g] || 0) / total : 0;
  return { by, bySrc, total, share };
}

/** 偏離定案配比就回傳訊息(呼叫端負責印/擋);沒偏離回 null。 */
export function buildingMixDrift(catalog = PHOTO_CATALOG) {
  const { by, total, share } = buildingMix(catalog);
  const bad = Object.entries(BUILDING_MIX).filter(([g, t]) => Math.abs(share[g] - t) > MIX_TOL);
  if (!bad.length) return null;
  const row = (g) => `${g} ${by[g] || 0}/${total} = ${(share[g] * 100).toFixed(1)}%(定案 ${(BUILDING_MIX[g] * 100).toFixed(0)}%)`;
  return `整棟建物配比偏離定案:${Object.keys(BUILDING_MIX).map(row).join('・')}`;
}

// ---- CLI ----
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const ONLY_FAM = opt('family');
const ONLY_PART = opt('part');                               // 'rock/facet' 形式
const LIMIT = Number(opt('limit') || 20);

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];
// 「已有」計的是**可用**張數,不是下載張數(F0 的診斷:82 張 tree matte 只有 ~16 張可用)——
// 選片閘 screen_mattes.py 淘汰的條目(entry.screen.v === 'reject')不算,否則帳面永遠「抓夠了」
// 而語料裡躺著 4/5 的垃圾。淘汰條目仍留在 seen(見下)⇒ 同一張垃圾不會被重新下載。
const usable = (e) => e.ok && !(e.screen && e.screen.v === 'reject');
const have = (fam, part) => manifest.filter((e) => e.family === fam && e.part === part && usable(e)).length;
const screened = (fam, part) => manifest.filter((e) => e.family === fam && e.part === part && e.ok && e.screen && e.screen.v === 'reject').length;

function workList() {
  const out = [];
  for (const [fam, parts] of Object.entries(PHOTO_CATALOG)) {
    if (ONLY_FAM && fam !== ONLY_FAM) continue;
    for (const [part, def] of Object.entries(parts)) {
      if (ONLY_PART && `${fam}/${part}` !== ONLY_PART) continue;
      const got = have(fam, part);
      if (got < def.want) out.push({ fam, part, def, got, need: def.want - got });
    }
  }
  return out;
}

// ---- 授權複驗(硬閘的第二道:不信任查詢參數,逐張再驗一次)----
const CC0_RE = /^(cc0|pdm)$/i;                               // Openverse 的 license 欄
const COMMONS_OK = /cc0|public domain/i;                     // Commons 的 LicenseShortName
const TIFF_THUMB_W = 2400;                                   // TIFF 走 MediaWiki 縮圖(見 searchCommons)

async function jget(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// 供應者排除(2026-08-05 第 5 輪實測):CC0 的語料重心是**博物館/圖書館的數位化館藏** ——
// 逐張人眼複核 19+26 顆 SF3D 產出,fill 排名前段一再是臘葉標本壓葉、19 世紀蛋白照片、
// 石版畫、立體鏡雙聯卡、鉛筆素描明信片。那些東西 img→3D 生不出可用幾何,而**授權完全合法**
// ⇒ 篩不掉的話,每一輪的 GPU 時間都花在注定要丟的候選上。這裡排掉純館藏型供應者;
// rawpixel 刻意留著(它同時供應現代攝影與公版版畫,砍掉會連最好的那幾張一起砍)。
// 2026-08-09 補一列 `smithsonian_african_american_history_museum`(§5ae):`bld_tower` 的 4 張
// 語料裡有 2 張是**同一本 1932 年畢業紀念冊的封面與封底**(浮雕的裝飾藝術大樓 + 空白卡紙背面)。
// 它們同時踩中兩個機制:①這個館藏源不在排除清單裡;②API 回不出尺寸 ⇒ `size_unknown` ⇒
// 短邊 1024 那道閘**結構性地量不到**(`Math.min(null || Infinity, …)`)。兩者都合法、都不報錯,
// 而 `--plan` 因此一直顯示「這一列抓夠了」—— 直到有人真的把圖點開來看。
const EXCLUDED_SOURCES = ['smithsonian_cooper_hewitt_museum', 'museumsvictoria', 'digitaltmuseum',
  'sciencemuseum', 'statensmuseum', 'clevelandmuseum', 'smithsonian_national_museum_of_natural_history',
  'smithsonian_institution_archives', 'smithsonian_libraries', 'smithsonian_african_american_history_museum',
  'brooklynmuseum', 'thorvaldsensmuseum',
  'floraon', 'inaturalist', 'biodiversity_heritage_library'].join(',');

/** Openverse:免金鑰;license=cc0 已含 public domain mark */
async function searchOpenverse(q, n) {
  const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0&page_size=${n}`
    + `&excluded_source=${EXCLUDED_SOURCES}`;
  const j = await jget(u);
  return (j.results || []).filter((it) => CC0_RE.test(it.license || '')).map((it) => ({
    id: `ov_${it.id}`, url: it.url, w: it.width, h: it.height,
    license: it.license, creator: it.creator || null,
    source_url: it.foreign_landing_url || it.url, api: 'openverse',
  }));
}

/** Wikimedia Commons:補地標類;逐張驗 extmetadata 的授權欄 */
async function searchCommons(q, n) {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
    + `&generator=search&gsrnamespace=6&gsrlimit=${n}&gsrsearch=${encodeURIComponent(q)}`
    + `&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=${TIFF_THUMB_W}`;
  const j = await jget(u);
  const pages = Object.values(j?.query?.pages || {});
  return pages.map((p) => {
    const ii = p.imageinfo?.[0]; if (!ii) return null;
    const lic = ii.extmetadata?.LicenseShortName?.value || '';
    if (!COMMONS_OK.test(lic)) return null;                  // 硬閘:CC-BY 一律拒收
    // **TIFF 改吃 MediaWiki 幫我們算好的 JPEG 縮圖**(2026-08-09;§5ak-c)。
    // 理由是語料本身:使用者要的測繪圖幾乎全是 HABS 那一批,而 **HABS 在 Commons 上一律是
    // 5000px 的典藏 TIFF** ⇒ 舊制的 magic-byte 嗅探把每一張都判成「非影像位元組」並記成
    // **持續性失敗**(那條規則會讓同一張永遠不再重試)= 三個設計圖列**結構性地**永遠抓不到東西,
    // 而畫面上只看得到一排 ✗。縮圖那條路同時省掉幾十 MB 的下載,而 2400px 的短邊仍遠高於
    // 1024 的下限(⇒ 尺寸閘 MUST 改吃**縮圖的**尺寸,吃原圖就會放行一張其實只有 800px 的檔案)。
    // ⚠ **只放行 TIFF**:PDF/DjVu 的「縮圖」是第一頁的渲染,而 2026-08-05 那張「照片」正是
    //   148 頁的 PDF —— 那不是我們要的東西,維持拒收(嗅探仍是最後一道)。
    // ⚠ 副檔名 MUST 允許後面接查詢字串:`ii.url` 帶著 `?utm_source=…&utm_content=original`
    //   ⇒ 錨在字串尾的 `\.tiff?$` **一張都比對不到**,而症狀與完全沒改一樣(照樣一排
    //   「非影像位元組」)。同一條寫法早就在 download() 的副檔名解析裡了。
    const tif = /\.tiff?(?:\?|$)/i.test(ii.url || '');
    const url = tif && ii.thumburl ? ii.thumburl : ii.url;
    const [w, h] = tif && ii.thumburl ? [ii.thumbwidth, ii.thumbheight] : [ii.width, ii.height];
    return {
      id: `wc_${p.pageid}`, url, w, h,
      license: lic, creator: ii.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, '') || null,
      source_url: ii.descriptionurl, api: 'commons',
    };
  }).filter(Boolean);
}

// magic bytes 嗅探:副檔名與 Content-Type 都不可信(2026-08-05 實測 Commons 一張「照片」
// 是 148 頁 PDF)⇒ 只認檔案開頭位元組;認得的三種 = 影像管線吃得下的三種格式。
function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function download(it, fam, part) {
  const dir = join(PHOTOS, fam, part);
  mkdirSync(dir, { recursive: true });
  const ext = (it.url.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const file = join(dir, `${it.id}.${ext}`);
  if (existsSync(file)) return file;
  const r = await fetch(it.url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  // 非影像是「這張檔案的事實」不是網路狀態 ⇒ 照 404 的規矩記進帳本(ok:false),不落地。
  if (!sniffImage(buf)) throw new Error(`非影像位元組(${buf.subarray(0, 4).toString('hex')})`);
  writeFileSync(file, buf);
  return file;
}

// ============ 自己放圖的地方(2026-08-10 使用者定案)============
// `<資料家>/inbox/<族>/<零件>/` 丟圖進去,`--adopt` 收編成正式語料(搬進 photos/、寫進帳本),
// 之後跟抓下來的照片走**完全同一條路**(去背 → 選片閘 → img→3D)。
//
// 三條紀律,一條都不能省:
//   ① **授權硬閘不因為是手動放的就鬆開**。烤進 repo 的石頭沒有地方放署名(檔頭 ①),而
//      「這張是我自己找的」不是授權。⇒ 每個零件資料夾要有 `sources.json` 記每張圖的授權
//      與出處;沒記到的**不收**,原檔留在 inbox 不動(不是刪掉 —— 那是使用者的檔案)。
//   ② **inbox MUST 在 photos/ 之外**。放在 photos/ 底下的話,`_inbox` 會被 matte_photos.py
//      當成一個「族」整個去背,而它的統計對不上任何一族的門檻 = 一批看起來很奇怪的淘汰。
//   ③ 尺寸與位元組照驗(短邊 ≥1024 / magic bytes)—— 這兩道跟來源無關,是 img→3D 的輸入條件。
const INBOX = join(HOME, 'inbox');

/** 影像尺寸:PNG/JPEG/WebP 直接讀檔頭(A2 不准加相依,而短邊 1024 是硬閘 ⇒ 自己解)。
 *  認不出來回 null ⇒ 走帳本既有的 `size_unknown` 語意(降級不例外,原則 6)。*/
export function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xd0 && m <= 0xd9) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      // SOF0..SOF15,扣掉 DHT(c4)/JPG(c8)/DAC(cc) —— 那三個不是影格標頭
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const t = b.toString('ascii', 12, 16);
    if (t === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L') {
      const n = b.readUInt32LE(21);
      return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

const licenceOk = (l) => CC0_RE.test(String(l || '').trim()) || COMMONS_OK.test(String(l || ''));

function adoptInbox() {
  mkdirSync(INBOX, { recursive: true });
  // 這個家出不出貨(`corpus.json`;沒宣告 = 出貨用,以下逐位元同舊行為)。
  // **非出貨家才鬆授權**,而且鬆的只有「是不是 CC0/PD」這一條 —— 仍然要求逐張**有記**授權字串
  // (來源帳的意義就是「這張是哪來的」,不記等於沒帳)。收進來的每一筆蓋 `restricted` 戳記。
  const meta = corpusMeta(HOME);
  if (!meta.shipping) {
    console.log(`⚠ 非出貨語料家(${HOME}/corpus.json 宣告 shipping:false)`);
    console.log(`   ${meta.why || ''}`);
    console.log('   ⇒ 授權不限 CC0/PD,但每一張仍 MUST 記下實際授權;收進來的逐筆蓋 restricted 戳記。');
  }
  const fams = readdirSync(INBOX, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (!fams.length) {
    console.log(`自己放圖的地方(空的):${INBOX}`);
    console.log('  結構  inbox/<族>/<零件>/圖檔 + 同一層一個 sources.json');
    console.log(`  族/零件 用型錄裡現成的名字(例:${Object.keys(PHOTO_CATALOG).join(' / ')});`);
    console.log('        零件名見 `--plan` 印的那份清單,寫錯了本工具會告訴你。');
    console.log('  sources.json 例:');
    console.log('    {');
    console.log('      "_default": { "license": "cc0", "creator": "我自己拍的", "source_url": "" },');
    console.log('      "big-rock.jpg": { "license": "cc0", "creator": "Jane Doe", "source_url": "https://…" }');
    console.log('    }');
    console.log('  授權**只收 CC0 / Public domain**(CC-BY 也不行:烤進 repo 的零件沒地方放署名)。');
    return;
  }
  let took = 0; let left = 0;
  for (const f of fams) {
    for (const p of readdirSync(join(INBOX, f.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = join(INBOX, f.name, p.name);
      const known = PHOTO_CATALOG[f.name]?.[p.name];
      if (!known) { console.warn(`✗ ${f.name}/${p.name}:型錄裡沒有這個零件(--plan 看清單);整個資料夾原樣留著`); left++; continue; }
      let src = {};
      try { src = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8')); }
      catch { console.warn(`✗ ${f.name}/${p.name}:缺 sources.json ⇒ 沒有授權就不收(檔案原樣留著)`); left++; continue; }
      for (const name of readdirSync(dir)) {
        if (name === 'sources.json') continue;
        const rec = src[name] || src._default;
        if (!rec) { console.warn(`✗ ${f.name}/${p.name}/${name}:sources.json 裡沒有這一張(也沒有 _default)`); left++; continue; }
        if (meta.shipping) {
          if (!licenceOk(rec.license)) { console.warn(`✗ ${f.name}/${p.name}/${name}:授權「${rec.license}」不是 CC0/PD ⇒ 不收`); left++; continue; }
        } else if (!String(rec.license || '').trim()) {
          console.warn(`✗ ${f.name}/${p.name}/${name}:非出貨家仍要記授權(license 空白)⇒ 不收`); left++; continue;
        }
        const buf = readFileSync(join(dir, name));
        const kind = sniffImage(buf);
        if (!kind) { console.warn(`✗ ${f.name}/${p.name}/${name}:非影像位元組(${buf.subarray(0, 4).toString('hex')})`); left++; continue; }
        const size = imageSize(buf);
        if (size && Math.min(size.w, size.h) < 1024) {
          console.warn(`✗ ${f.name}/${p.name}/${name}:短邊 ${Math.min(size.w, size.h)} < 1024 ⇒ 不夠餵 img→3D`); left++; continue;
        }
        const id = `manual_${name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 48)}`;
        // 去重吃的是**帳本條目在不在**,而不是 `ok` —— 被 `screen_mattes.py --purge` 刪掉的圖
        // 條目仍留著(那份條目就是黑名單本身,見該支的 apply_purge 檔頭)⇒ 同一張圖再放一次
        // 也不會被收編回來。理由要講出來,不然使用者只看到「已收編過」而檔案明明不在 photos/。
        const prev = manifest.find((e) => e.id === id && e.family === f.name && e.part === p.name);
        if (prev) {
          console.log(`・ ${f.name}/${p.name}/${name}:${prev.purged ? '這張圖先前被判 ✕ 刪除(黑名單)' : `已收編過(id ${id})`},略過`);
          continue;
        }
        const outDir = join(PHOTOS, f.name, p.name);
        mkdirSync(outDir, { recursive: true });
        const outFile = join(outDir, `${id}.${kind}`);
        writeFileSync(outFile, buf);
        rmSync(join(dir, name));
        manifest.push({
          family: f.name, part: p.name, id, query: '(手動放圖)', api: 'manual',
          source_url: rec.source_url || '', license: rec.license, creator: rec.creator || null,
          retrieved_at: new Date().toISOString(), w: size?.w || null, h: size?.h || null,
          size_unknown: size ? undefined : true,
          // 非出貨家的每一筆都帶戳記 —— 帳本自己就說得出「這張不能出貨」,
          // 不必回頭去問它住在哪個目錄(而目錄是會被搬的)
          restricted: meta.shipping ? undefined : true,
          file: relative(HOME, outFile).split('\\').join('/'), ok: true,
        });
        writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
        took++;
        console.log(`✓ ${f.name}/${p.name} ← ${name}(${rec.license})`);
      }
    }
  }
  console.log(`\n收編 ${took} 張${left ? `;${left} 張留在 inbox 沒收(理由見上)` : ''}。`);
  if (took) console.log('下一步:去背 → 選片閘 → img→3D(或直接 `node tools/ai3d/harvest_loop.mjs --rounds 1`)。');
}

async function main() {
  if (flag('adopt') || flag('inbox')) { adoptInbox(); return; }
  // 配比守門線排在最前面:型錄本身寫壞了,抓下來的每一張都是照著壞配額抓的(而照片有配額成本)。
  const drift = buildingMixDrift();
  if (drift) { console.error(`❌ ${drift}`); process.exit(1); }
  const work = workList();
  if (flag('review')) {
    for (const e of manifest.filter((e) => e.ok)) {
      console.log(`${e.family}/${e.part}  ${e.file}  ${e.w || '?'}×${e.h || '?'}  ${e.license}  ${e.source_url}`);
    }
    return;
  }
  if (flag('plan') || !work.length) {
    console.log('工作清單(零件:可用/目標;「可用」= 下載成功且未被選片閘淘汰):');
    for (const [fam, parts] of Object.entries(PHOTO_CATALOG)) {
      for (const [part, def] of Object.entries(parts)) {
        const rej = screened(fam, part);
        console.log(`  ${fam}/${part}: ${have(fam, part)}/${def.want}${rej ? `(選片閘另淘汰 ${rej} 張)` : ''}`);
      }
    }
    // 整棟建物配比:目標(型錄 want)與**手上真的有幾張**分開印 —— 前者是定案、後者是現況,
    // 混成一個數字就看不出「還缺哪一組」(而缺的那一組正是下一輪要抓的)。
    const mix = buildingMix();
    const got = {}; const gotSrc = {}; let gotTotal = 0;
    for (const [part, def] of Object.entries(PHOTO_CATALOG.building)) {
      if (!def.grp) continue;
      const n = have('building', part); got[def.grp] = (got[def.grp] || 0) + n; gotTotal += n;
      (gotSrc[def.grp] ||= {})[srcOf(def)] = (gotSrc[def.grp]?.[srcOf(def)] || 0) + n;
    }
    console.log('\n整棟建物配比(使用者 2026-08-09 定案 50/25/25;分母含設計圖):');
    for (const g of Object.keys(BUILDING_MIX)) {
      const tgt = `${mix.by[g] || 0}/${mix.total} = ${(mix.share[g] * 100).toFixed(1)}%`;
      const cur = gotTotal ? `${got[g] || 0}/${gotTotal} = ${((got[g] || 0) / gotTotal * 100).toFixed(1)}%` : '0';
      console.log(`  ${g.padEnd(6)} 目標 ${tgt.padEnd(20)} 現有 ${cur}`);
    }
    // 逐組的**輸入格式**拆帳:配比對了不代表語料對了 —— 照片與設計圖走的是兩條完全不同的
    // 轉換路(img→3D vs plan_to_mesh),混成一個數字就看不出「這一組全是設計圖」。
    console.log('  ── 輸入格式拆帳(目標 → 現有;drawing 走 plan_to_mesh 那條幾何路)──');
    for (const g of Object.keys(BUILDING_MIX)) {
      const cell = (s) => `${s} ${mix.bySrc[g]?.[s] || 0}→${gotSrc[g]?.[s] || 0}`;
      console.log(`  ${g.padEnd(6)} ${SRC_KINDS.map(cell).join('・')}`);
    }
    if (!work.length) console.log('\n缺額為零,不用抓。');
    return;
  }

  let fetched = 0;
  let cooled = false;   // 撞上 IP 級限流(2026-08-05 實測 upload.wikimedia.org Retry-After: 600)
  let searchThrottled = 0;                  // 連續「兩個搜尋 API 都零結果且至少一邊限流」的查詢數
  const SEARCH_COOL_N = 6;                  // 到這個數才判定搜尋層被封(間歇 401/429 不足以早退)
  // 節流是**逐主機**的:upload.wikimedia.org 撞 429 不代表 rawpixel/flickr 也被封 ——
  // 舊制「一顆 429 整輪收工」讓 Commons-hosted 候選多的零件把整輪額度全數陪葬,
  // 排在後面的零件永遠輪不到。改成:被封主機記進 hostCool,本輪只跳過同主機的候選。
  const hostCool = new Set();
  const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };
  for (const { fam, part, def, need } of work) {
    if (cooled || fetched >= LIMIT) break;
    // seen 收成功條目 + **持續性失敗**(非影像位元組/403/404 —— 那是「這張檔案的事實」):
    // 少了後者,選片閘把可用數清零之後,每一輪都會把同一份 PDF / 同一批 403 重新下載一次、
    // 再 append 一筆重複 fail 列(2026-08-07 帳上實測 acunit 一張 PDF 已疊 8 筆),而且無效
    // 請求還燒掉 upload.wikimedia.org 的 429 額度 = 真候選整輪被 hostCool 跳過。
    // 暫時性失敗(429 限流)本來就不進帳本 ⇒ 重跑天然能再試(②的「可續跑」不受影響);
    // 其他未知錯誤(5xx/網路斷)不匹配樣式 ⇒ 照舊可重試。
    const PERSIST_FAIL_RE = /非影像位元組|HTTP 40[34]/;
    const seen = new Set(manifest.filter((e) => e.family === fam && e.part === part
      && (e.ok || PERSIST_FAIL_RE.test(e.error || ''))).map((e) => e.id));
    for (const q of queryLadder(fam, def)) {
      if (cooled || fetched >= LIMIT) break;
      const tryItems = async (items) => {
        for (const it of items) {
          if (cooled || fetched >= LIMIT || have(fam, part) >= def.want) break;
          if (seen.has(it.id)) continue;
          if (hostCool.has(hostOf(it.url))) continue;   // 該主機本輪已被 429 封鎖:跳過,別燒成失敗
          seen.add(it.id);
          // 選片過濾:短邊 <1024 直接跳過(skill §5.3:不足 1024 不准進 image→3D);尺寸未知照收並標記
          const short = Math.min(it.w || Infinity, it.h || Infinity);
          if (short < 1024) continue;
          const entry = {
            family: fam, part, id: it.id, query: q, api: it.api,
            // 輸入格式進帳本(預設 photo 不寫 ⇒ 既有條目逐位元不變):下游的 python 端靠
            // 這一欄認出「這張不是照片」,MUST NOT 在那邊再抄一份零件名單(第二份實作)。
            ...(srcOf(def) === 'photo' ? {} : { src: srcOf(def) }),
            source_url: it.source_url, license: it.license, creator: it.creator,
            retrieved_at: new Date().toISOString(), w: it.w || null, h: it.h || null,
            size_unknown: !(it.w && it.h) || undefined,
          };
          try {
            // 帳本一律記「相對**資料家**的 POSIX 路徑」:舊制 replace(HERE + '/') 在 Windows 上
            // 因分隔符不符靜默失效 ⇒ 別台 worktree 的絕對路徑漏進帳本(2026-08-05 實測 28 筆)。
            // 基準 MUST 是 HOME 不是 HERE —— 帳本與照片住同一個資料家,拿腳本位置當基準的話
            // `--home` 一給,帳本裡就會出現 `../../…` 這種跨 worktree 的相對路徑。
            entry.file = relative(HOME, await download(it, fam, part)).split('\\').join('/');
            entry.ok = true;
            fetched++;
            console.log(`✓ ${fam}/${part} ← ${it.id}(${it.license})`);
          } catch (e) {
            entry.ok = false; entry.error = e.message;
            console.warn(`✗ ${fam}/${part} ← ${it.id}:${e.message}`);
            // 429 = IP 級限流:它是「這一輪的網路狀態」不是「這張照片的屬性」⇒ 不進帳本
            // (帳本記的是授權與檔案的事實;持續性失敗如 404 仍照記)。封鎖只及**該主機**,
            // 其他主機的候選照抓;全輪早退(cooled)只留給搜尋 API 本身被限流的情況。
            if (/HTTP 429/.test(e.message)) { hostCool.add(hostOf(it.url)); continue; }
          }
          manifest.push(entry);
          writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
          await new Promise((r) => setTimeout(r, 1100));     // 禮貌限速(Openverse 匿名額度)
        }
      };
      let items = [];
      let more = [];
      let q429 = false;   // 這一條查詢的「搜尋層」有沒有撞限流(Openverse 額度耗盡實測回 401 或 429)
      try { items = await searchOpenverse(q, need * 3); } catch (e) { q429 ||= /HTTP (401|429)/.test(e.message); console.warn(`Openverse 失敗(${q}):${e.message}`); }
      await tryItems(items);
      // 降級不例外(④):Openverse「搜尋零結果」**或「有結果但下載被限流(429)整批失敗」**
      // 同一條查詢都降級到 Commons 再試 —— 舊制只蓋前者,實測 Openverse 匿名額度一燒完,
      // 缺額零件就永遠補不滿,而畫面上只看得到「✗ HTTP 429」一排。
      if (have(fam, part) < def.want && fetched < LIMIT) {
        try { more = await searchCommons(q, need * 3); } catch (e) { q429 ||= /HTTP (401|429)/.test(e.message); console.warn(`Commons 失敗(${q}):${e.message}`); }
        await tryItems(more);
      }
      // 搜尋層的全輪早退(檔頭註解一直承諾、2026-08-07 之前從未實作):兩個搜尋 API 都
      // 拿不出半個結果、而且至少一邊回限流,連續 SEARCH_COOL_N 條查詢都如此 = 搜尋層真的
      // 被封 ⇒ 再掃剩下的幾十列只是對已限流的主機多打幾百發、延長封鎖。單發 429 MUST NOT
      // 早退(實測 401/429 是間歇的,後面的查詢還撈得到);計數在任何一批結果進來時歸零。
      if (items.length || more.length) searchThrottled = 0;
      else if (q429 && ++searchThrottled >= SEARCH_COOL_N) cooled = true;
      if (have(fam, part) >= def.want) break;
    }
  }
  if (cooled || hostCool.size) console.log(`\n⚠ 撞上來源 IP 級限流(HTTP 429${hostCool.size ? `;被封主機:${[...hostCool].join(', ')}` : ''}),約 10 分鐘後重跑同指令續補。`);
  console.log(`\n本輪下載 ${fetched} 張;重跑同指令可續補缺額。`);
}

// 進入點守衛:只有被當指令跑才啟動。import 本檔(例如只想拿 PHOTO_CATALOG 驗型錄)
// MUST NOT 觸發抓取 —— 2026-08-07 實測一次 import 當場開跑一整輪(runbook §5p ④)。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
