# ============ GLB 零件正規化(Blender headless;runbook §4-C.2)============
#
# 輸入:SF3D 的原始 mesh.glb(有貼圖、任意比例、任意置中)
# 輸出:public/assets/models/parts/{family}.glb —— 只有幾何 + 法線的具名節點
#
# 逐節點做四件事(intake_parts.mjs 的外廓契約在這裡兌現):
#   ① 置中:包圍盒中心 → 原點(fallback 是 `['ico', r]` 這類**置中** primitive,
#      消費端 KIND_PARTS 的 p: 位移就是以置中件為前提寫的;「原點對齊接合面」只適用
#      牆模組那類有明確接合面的零件,石頭的接合語意 = 置中疊放)
#   ② 等比縮放:水平徑向與縱向半跨都收進 fallback 包絡 × FIT(留 5% 餘裕吸浮點),
#      且水平徑向 ≥ 包絡 × 0.5(intake 的「fallback 沒有虛胖」下界)
#   ③ 減面:Decimate 到三角形預算內(tri_budget.json 的量測上界)
#   ④ 剝材質/貼圖/UV:partlib 只吃幾何,顏色由零件表 `c:` 決定(CLAUDE.md §1)
#      —— **唯一例外 `--boxuv <node>`**:整棟量體那一桶的消費端是 biomes 的立面材質
#      (窗格貼圖 + 夜間自發光),節點沒有 UV 就整棟採到 (0,0) 一個 texel = 純色板。
#      剝掉來源 UV(T2/SF3D 自己貼圖的那一份)之後**重建**盒投影 UV,見下方 BOXUV。
#      整棟量體那兩桶再多一條
#      `--uvbands <node>=<roof>|<plain>[|<minz>|<wall_ny>[|<flat_deg>|<flat_min>]]`:把朝上的
#      面分到貼圖底部那一帶、傾斜與朝下的分到中間那一帶(單一材質群組換不掉屋頂材質,
#      只好把區分移進 UV),見下方 UVBANDS。`--roofband` 是它的兩帶特例,保留可用。
#      2026-08-13 起中間那一帶再收「近垂直但**不平整**」的面(使用者「密集窗戶圖層只貼
#      垂直地面且完全平整的平面牆」),判據與 ②-a 的整平共用 `_plane_groups`。
#   ⑤ `--replanar <node>`:對 `--base` 裡**已出貨**的節點就地整平(見下方 REPLANAR)。
#
# 用法(Blender 5.x;欄位分隔用 `|` —— `:` 會撞上 Windows 磁碟機代號):
#   blender --background --python tools/ai3d/normalize_parts.py -- \
#     --out public/assets/models/parts/rock.glb \
#     --node "collapse_a=<src.glb>|1.5|1000[|ry_deg[|dy]]" --node "facet_a=<src.glb>|1.15|900" ...
#   dy = 縮放後的縱向平移(m):實拍岩體常比 fallback ico 扁,置中會讓消費端算好的
#        底面懸空 —— 基座件用 dy 沉到「底 = −消費端 p.y」貼地(仍 MUST 收在包絡內)。
#   目標欄寫 "@<群組名>" = **這一顆與同群的其他顆共用一個變換**(2026-08-08;搭配
#     `--group "<群組名>=r[xhy]"`)。用途:一株樹拆成木質 / 葉冠兩顆節點 —— 各自縮到
#     自己的包絡就是兩個不同的縮放,樹會散開,而外廓契約與三角形預算全綠、只有截圖看得出來。
#   目標欄寫 "r"(等比,岩族原行為逐位元不變)或 "r x hy"(如 "3.0x5.0" = 非等向:
#   水平、縱向各自縮到包絡 × FIT)。非等向是給樹冠/板根用的:樹冠 fallback 是 ico 球,
#   而實拍樹冠天生比球扁 —— 等比縮的話填不滿縱向,零件表的 sy 再壓一次就成薄餅;
#   拉滿球包絡後,消費端 sy 壓出來的比例才與舊 ico 同款(板根同理:cone 的 r 與 h/2 差很遠)。
import bpy
import os
import sys
import math
import random

FIT = 0.95          # 包絡餘裕:縮到 fallback × 0.95(浮點與後續 stretch 都吃不掉契約)

# ============ 平面整平(2026-08-11 定;2026-08-13 使用者「建築外部不平整的多塊法線角小的
#              平面牆合併平整」改寫)============
# 「平面整平只有建築」。**「只有建築」是推導不是名冊**,而且需要**兩把尺** ——
#   ㋐ 平面分數(法線分群後前 6 群佔總面積):岩 .052~.188 / 建築 .266~.566,中間乾淨空隙
#      ⇒ 取幾何中點 .224。
#   ㋑ 碎屑佔比(最大連通元件以外的面積):岩+建築 ≤.414 / 樹族木質 .697~.856 ⇒ 取中點 .54。
#   只用 ㋐ 的話**木質幹會被整平**(圓柱分群少 ⇒ 分數 .88~.95,比任何建築都高),而且
#   呼叫端沒帶旗標就靜默發生 —— 所以排除做成幾何推導,不靠「記得加 --no-planar」。
# 常數住這裡(而不是與 `_planarize` 放在一起)的唯一理由:`--uvbands` 的參數檢查要用
# `PLANAR_DEG`,而參數解析排在最前面。
PLANAR_SPLIT = 0.224
PLANAR_ISLAND_MAX = 0.54
# 舊制三個結構性問題(實測見下),這一輪一起修:
#   ㋐ **分群只看法線**:退縮塔的前牆與退縮一階之後的前牆法線完全相同 ⇒ 落進同一群,
#      群的最佳平面落在兩者中間,於是**兩面本來各自是平的牆互相被推歪**。
#      ⇒ 加上「平面偏移」這一條,合併的語意才真的是使用者說的那一句。
#   ㋑ **位移上限是另一個數字**(跨距 × 0.01):與「多近算同一面牆」無關 ⇒ 該合併的合併不了。
#      ⇒ 收成**一個**數字 `PLANAR_OFF_F`:同一個容差既決定「算不算同一面牆」也決定
#         「最多推多遠」,而且夾的是**對原始位置的累計位移** ⇒ 多趟收斂不會累積成塌陷。
#   ㋒ **只跑一趟**:頂點推上平面之後法線就變了,群結構要重算才收得乾淨。⇒ 跑 `PLANAR_PASSES` 趟。
#   ㋓ **沒有焊接**:glTF 匯入的是逐面拆開的三角形湯(`_weld` 檔頭的同一個坑)⇒ 共位頂點
#      被不同群各推各的 = 沿群界撕開。⇒ 本支自己建**共位對照表**(不動拓樸、不動頂點數、
#      不動著色 ⇒ 對其他族逐位元無副作用),共位頂點一律一起推。
#
# 現役五顆整棟量體節點實測(tools/ai3d/parts_src.mjs `wallFlatness` / `flatWalls`;
# mass_a/b/c・masslow_a/b 依序):
#   相鄰近垂直面夾角落在 (0.5°, 12°] 的**面積佔比** 53.5 / 63.0 / 55.7 / 52.6 / 64.1%
#     —— 這一欄就是使用者說的「不平整的多塊法線角小的平面牆」,是這一輪要消掉的東西
#   近垂直面裡真的貼在自己那一群平面上(≤6°)的佔比 53.9 / 61.5 / 78.9 / 90.2 / 74.1%
# 參數由這五顆掃出來(見 docs/ai3d_runbook.md §5as 的逐格對照):`OFF_F` 0.02→0.03 對
# mass_a 是 47.5%→42.2% 素牆帶(唯一有感的一格),再大就開始把真的退縮階併掉;
# `PASSES` 1→8 讓小角佔比再降三分之一而位移上限不變(累計夾制),8 趟之後已收斂。
#
# ---- 2026-08-13 第二輪:使用者「盡可能提高平整度,**水平處也要盡可能整平**,
#      **邊角盡量修復為直角**」(圈了屋頂 / 退縮頂 / 簷口 / 牆頂交界那幾處)----
# 第一輪只把**牆**推平,而三個成因讓水平面與邊角留在原地:
#   ㋔ **邊角被平均磨圓**:同時屬於兩片平面的頂點,舊制是「逐群各投影一次再平均」——
#      那個平均點恰好落在兩個平面**中間**,於是每一條牆與牆、牆與屋頂的交界都被磨成圓角。
#      ⇒ 改成解**平面交線**(2 面)/ **交點**(3 面):頂點落在交線上 = 邊角就是那兩個平面
#         真正的夾角,而它們若都被吸到軸上就是直角。實測小角佔比 18.0% → **8.2%**。
#   ㋕ **平面本身沒有吸到軸上**:一面 3° 歪的「水平」屋頂,整平只會把它整成一面 3° 歪的平面。
#      ⇒ 群的最佳平面若已經很接近水平/垂直就**吸附到恰好**(門檻沿用 `WALL_NY` = 0.15,
#         推導不是新數字:那正是「近垂直」那條線)。軸對齊 55.0% → 65.2%。
#   ㋖ **碎屑不屬於任何大群**:尖刺與屋頂上的碎片各自成群、都在 `MIN_F` 之下 ⇒ 一動不動。
#      ⇒ 不屬於任何大群的頂點,若離某個大平面在容差之內就**吸上去**。
# 實測(五顆節點平均;牆 / 屋頂 / 近水平 / 軸對齊 / 小角):
#   第一輪 85.6 / 56.1 / 38.5 / 55.0 / 16.7%  →  這一輪 89.2 / 57.3 / 45.8 / 65.2 / **7.5%**
PLANAR_DEG = 12.0         # 法線夾角在此之內**才可能**是同一面牆
PLANAR_OFF_F = 0.03       # 跨距 × 此值 = 合併容差,**同時**是對原始位置的累計位移上限
PLANAR_PASSES = 16        # 重算群結構的趟數(累計夾制 ⇒ 多跑只會更收斂,不會更歪;8→16 再降 0.7pp)
PLANAR_MIN_F = 0.005      # 群面積佔比低於此 ⇒ 不值得整(舊值 0.02 把半數牆板擋在門外)
PLANAR_AXIS = 0.15        # 群法線的 |n.z| ≤ 此值 ⇒ 吸成**恰好垂直**;≥ √(1−此²) ⇒ 恰好水平
                          #   值 = `WALL_NY`(「近垂直」那條線),MUST NOT 另發明一個數字
# `PLANAR_MAX_F`(舊的第二個位移上限)**已退場** —— 它與合併容差是同一件事的兩個數字,
# 而兩個數字不一致的症狀正是 ㋑。MUST NOT 復辟。

argv = sys.argv[sys.argv.index('--') + 1:]


def opt_all(name):
    return [argv[i + 1] for i, a in enumerate(argv) if a == f'--{name}']


OUT = opt_all('out')[0]


def _target(s):
    """`"3.0"` = 等比 / `"3.0x5.0"` = 非等向。回傳 (r, hy|None)。"""
    tr, thy = (s.split('x') + [None])[:2] if 'x' in s else (s, None)
    return float(tr), (float(thy) if thy else None)


# `--group "gname=r[xhy]"`:**同一群的節點共用一個變換**(置中與縮放由聯集算)。
# 2026-08-08 加入。為什麼需要:一株樹拆成「木質」「葉冠」兩顆節點時,兩顆是同一株的兩半 ——
# 各自置中、各自縮到自己的包絡 = 兩個不同的縮放係數 ⇒ **樹會散開**(葉冠浮在樹幹旁邊),
# 而且外廓契約與三角形預算都會全綠,只有截圖看得出來。共用變換之後,相對位置是烤進頂點的,
# 結構上不可能散;消費端那幾列因此共用同一組 `px/y/pz`(= 聯集中心),少一個可以寫錯的地方。
GROUPS = {}
for spec in opt_all('group'):
    gname, tgt = spec.split('=', 1)
    GROUPS[gname] = _target(tgt)

NODES = []          # (node_name, src_glb, target_r, target_hy|None, tri_cap, ry_deg, dy, group|None)
for spec in opt_all('node'):
    name, rest = spec.split('=', 1)
    bits = rest.split('|')
    if bits[1].startswith('@'):
        grp = bits[1][1:]
        if grp not in GROUPS:
            raise SystemExit(f'{name}:未宣告的群組 @{grp}(要先給 --group "{grp}=r[xhy]")')
        tr, thy = GROUPS[grp]
    else:
        grp = None
        tr, thy = _target(bits[1])
    NODES.append((name, bits[0], tr, thy, int(bits[2]),
                  float(bits[3]) if len(bits) > 3 else 0.0,
                  float(bits[4]) if len(bits) > 4 else 0.0, grp))

# ---- 清場 ----
bpy.ops.wm.read_factory_settings(use_empty=True)

made = []

# --base <glb>:先把既有零件庫整支匯入並全數保留 —— 追加節點時不必重跑舊節點的來源
# (重跑 = 減面/縮放全部重算一次,舊節點有機會位元漂移;保留 = 舊節點逐位元原樣)。
# 同名節點 MUST 是「取代」不是「並存」:Blender 對撞名物件會自動改名成 `name.001`,
# 於是重跑一顆既有節點會**靜默**留下舊的那顆繼續當真品(消費端與 intake 都按名字查),
# 新的那顆變成沒人引用的孤兒 —— 讀數完全正常,只是這次重跑等於沒發生
# (2026-08-06:tower_a/mesa_a 想留三角形餘裕而重跑,實際輸出仍是舊版,由對照台的孤兒
#  清單與 GLB 節點表才看出來)。
# --drop <node>:把 base 裡的某個節點**刪掉**(可重複)。用途是「消費端不再引用它了」——
# 節點表換形之後留下的舊節點沒有任何消費端,只會一直出現在對照台的孤兒清單裡,而且照樣
# 佔著 GLB 的下載體積。與同名取代共用同一段刪除邏輯(含 `.NNN` 尾碼),語意差別只有
# 「刪完要不要重生」。MUST NOT 拿它來「清掉看不順眼的節點」:孤兒清單是對照台的產出,
# 刪之前先確認消費端真的不引用了(node tools/parts_review.mjs --report)。
BASE = (opt_all('base') or [None])[0]
DROP = set(opt_all('drop'))
# --boxuv <node>:替該節點**重建盒投影 UV**(可重複)。給「整棟量體」那一桶用 ——
# 它是四桶裡唯一**吃貼圖**的消費端(biomes 的立面材質:窗格 + 夜間自發光),而 ④ 一律
# 把來源 UV 剝掉(來源是 T2/SF3D 自己貼圖的 UV,留著會把立面貼圖映成亂碼)。
# 沒有 UV 也不會報錯,只是整棟採到 (0,0) 那一個 texel = 一塊沒有窗的純色板。
# 投影規則沿用原 BoxGeometry 的「逐面 0..1」慣例:依主導法線分軸,另兩軸各自 +0.5。
# 座標系:Blender Z-up,匯出 +Y up ⇒ 遊戲的 (X, Y, Z) = Blender 的 (x, z, −y)。
# 平面整平的總開關(預設**開**;`--no-planar` 給樹族那幾支呼叫端)
NO_PLANAR = '--no-planar' in argv

BOXUV = set(opt_all('boxuv'))
# --roofband "<node>=<frac>[|<minz>]":**屋頂帶 UV**(2026-08-09 使用者回報「斜頂屋頂外觀
# 變摩天大樓的玻璃」的**後半**)。前半(換一張材質感的牆)已在 biomes 那一側落地,但庫節點
# 是**單一材質群組** ⇒ three 只取 `material[0]`,方盒那條路的「第 3/4 格 = 屋頂材質」對它
# 完全不生效 ⇒ 窗格照樣印在斜屋頂上。單一群組這件事不能改(拆群組 = 每一棟多一個 draw call,
# 而 `pick_n` 的整條推導就是 draw call 上界),於是把區分**移進 UV**:
#   朝上面(法線 Blender z > minz)→ **平面投影**壓進 v ∈ [0, frac]
#   其餘(牆面 + 真朝下的底面)   → 原本的逐面盒投影,v 壓進 [frac, 1]
# 消費端 `facadeTex` 於是把畫布底部那 `frac` 條畫成屋頂(瓦縫/浪板),上面 (1−frac) 照舊畫牆。
# **兩個數字 MUST 與 biomes 的 `MASS.ROOF_BAND` / `ROOF_MINZ` 同值**(tri_budget 存量測、
# audit_siteplan 釘住相等、intake_parts 直接量 GLB 的 UV 帶)—— 分家不會報錯,只會讓屋頂
# 的那一條接縫落在牆上。
#
# **為什麼是「法線門檻」而不是沿用盒投影的「主導軸」**:主導軸等價於門檻 0.577(1/√3),
# 而實測 masslow_a 的屋頂面落在 n.y ∈ [0.45, 0.55](非等向 fit 把穀倉拉高 ⇒ 坡更陡)、
# masslow_b 的尖頂落在 [0.65, 0.80] —— 用主導軸判,穀倉那一顆的**整個屋頂**會被判成牆。
# 門檻取兩顆量出來的空檔中點(牆的尖峰止於 0.15、屋頂的尖峰起於 0.45)。
#
# ---- 2026-08-12:兩帶 → **三帶**(`--uvbands`;`--roofband` 是它的兩帶特例,保留可用)----
# 使用者定案「建築外部的密集窗戶圖層與外掛招牌只貼垂直地面且平整的平面牆」。
# 貼圖是盒投影上去的 ⇒ **面越斜,同一段 u/v 就攤在越長的表面上**:退縮頂的斜切面、尖塔、
# 屋簷底上的窗格是被拉糊的一片。舊制只分兩群(朝上 / 其餘),那些斜面全在「其餘」= 窗格帶。
# 三帶把傾斜獨立出來:
#   朝上   n.z > minz              → v ∈ [0, roof)              屋頂
#   傾斜   wall_ny < |n.z| ≤ minz、或朝下 → v ∈ [roof, roof+plain)  **素牆**(沒有窗)
#   近垂直 |n.z| ≤ wall_ny         → v ∈ [roof+plain, 1]        窗牆
# 三個數字 MUST 與 biomes 的 `MASS.UVB[桶]` 同值(tri_budget 存量測、audit_siteplan 釘住
# 相等、intake_parts 直接量 GLB 的 UV 帶)—— 分家不會報錯,只會讓那兩條接縫落在錯的地方。
UVBANDS = {}
for spec in opt_all('roofband'):
    rbname, rest = spec.split('=', 1)
    bits = rest.split('|')
    rb_frac = float(bits[0])
    rb_minz = float(bits[1]) if len(bits) > 1 else 0.30
    assert 0.0 < rb_frac < 1.0, f'--roofband {rbname}:frac 要在 (0,1) 之間'
    assert 0.0 < rb_minz < 1.0, f'--roofband {rbname}:minz 要在 (0,1) 之間'
    UVBANDS[rbname] = (rb_frac, 0.0, rb_minz, 0.0, 0.0, 0.0)   # plain/wall_ny/flat 全 0 ⇒ 逐位元同兩帶
for spec in opt_all('uvbands'):
    ubname, rest = spec.split('=', 1)
    bits = rest.split('|')
    assert len(bits) >= 2, f'--uvbands {ubname}:至少要 <roof>|<plain>[|<minz>|<wall_ny>[|<flat_deg>|<flat_min>]]'
    ub_roof, ub_plain = float(bits[0]), float(bits[1])
    ub_minz = float(bits[2]) if len(bits) > 2 else 0.30
    ub_wall = float(bits[3]) if len(bits) > 3 else 0.15
    # 2026-08-13:窗牆帶的第二個條件「完全平整」。0 = 關掉 ⇒ 逐位元回上一輪的純傾角分帶
    ub_fdeg = float(bits[4]) if len(bits) > 4 else 0.0
    ub_fmin = float(bits[5]) if len(bits) > 5 else PLANAR_MIN_F
    assert 0.0 < ub_roof and 0.0 <= ub_plain and ub_roof + ub_plain < 1.0, \
        f'--uvbands {ubname}:roof + plain 要在 (0,1) 之間'
    assert 0.0 < ub_wall < ub_minz < 1.0, f'--uvbands {ubname}:要滿足 0 < wall_ny < minz < 1'
    # 平整門檻 MUST 遠嚴於分群容差:兩個用同一個數字的話「有分到群就算平」= 這道閘恆真
    assert ub_fdeg == 0.0 or 0.0 < ub_fdeg < PLANAR_DEG, \
        f'--uvbands {ubname}:flat_deg 要在 (0, {PLANAR_DEG}) 之間(分群容差本身不是平整門檻)'
    UVBANDS[ubname] = (ub_roof, ub_plain, ub_minz, ub_wall, ub_fdeg, ub_fmin)
# --mirror <node>=<x|z|auto>:**鏡像貼補**(2026-08-08 使用者定案「建築另一面是空的,
# 使用鏡像貼補空的部分」)。單張照片只約束得到看得見的那幾面 —— 退縮階/簷帶/裙樓只長在
# 被拍到的那半,另一半是模型自己補的一片平板。切一半、鏡射過去、**焊住接縫**。
#
# **為什麼住在這裡(Blender)而不是 solidify_parts(pymeshlab/trimesh)**:那一端試過兩種
# 寫法都把網格撕爛(§5ac 實測,對照組留檔)——(a)切半再鏡射 = 沿切面再開一圈自由邊,
# 留下的與鏡射過去的是**兩張各自開口的殼**,開放邊 16 → 362、裙樓整條不見;
# (b)整份鏡射再疊合 = 重疊的雙層殼讓等值面重採樣的內外號誌打架,開放邊 → 1,119(z 軸)
# / 5,016(x 軸,連目標面數都打不到)。兩者的共同前提都是「resample 會幫我熔合」,
# 而它只對**單層**輸入成立。Blender 的 Mirror modifier 走的是完全不同的路:
# bisect 切面 + clip + **merge threshold 直接焊頂點**,不重建等值面 ⇒ 一條新的自由邊都不生。
#
# 留哪半 = **面積大的那半**(空的那半在網格上不是洞、是一片光滑的板,開放邊與元件數都
# 判不出來,面積才判得出來:細節多 = 面積大)。`auto` 再從兩個水平軸裡挑不對稱較大的。
# 軸是**遊戲座標**:遊戲 x = Blender X、遊戲 z = **Blender Y**(匯出 +Y up 時互換)。
# **MUST NOT 對非對稱典型的主體套用**(岩體/枯幹:鏡射會做出一顆假的雙生岩)。
MIRROR = {}
for spec in opt_all('mirror'):
    mname, mtgt = spec.split('=', 1)
    if mtgt not in ('x', 'z', 'auto'):
        raise SystemExit(f'--mirror {mname}:軸只能是 x / z / auto(遊戲座標的水平兩軸)')
    MIRROR[mname] = mtgt

# --rework "<node>=<x|z|auto|none>[|<warp>]":**對 `--base` 裡已出貨的節點就地動刀**
# (2026-08-09 使用者定案「img to 3D 會出現另一面是空的問題,由正面對稱的區塊去補對應的區塊,
#  包含建築 / 巨岩 / 假山都這樣處理」)。
#
# **為什麼不是「重跑 --node」**:出貨節點的 SF3D 原檔多半已經對不回來(parts_manifest 的
# `source_gap`:同一個 fit 重跑只得到 220/402 而出貨的是 234/426,剪影明顯是另一顆),
# 而且重跑會把減面/縮放整條重算 = 一顆本來沒人要動的零件位元漂移。§5ab 重減面那一輪
# 已經走過這條路(「刀落在已出貨的節點本身」),這裡把它做成具名旗標。
#
# **外廓逐位元不動是這條路的核心不變式**:動刀前先記下 `nodeExtent` 量的那兩個數
# (水平徑向 rMax、縱向 y 兩端),動完等比還原 —— 於是 intake 的外廓契約(上界 fallback 包絡、
# 下界 0.5×)**兩邊都不可能因為這一刀而改變**,唯一變的是殼裡面的形狀。
# (鏡射本身也不會撐大:鏡射面過包圍盒中點 ⇒ 該軸包圍盒不變,其餘軸只會縮不會脹。)
#
# `warp` = **去對稱化**振幅(× 最長跨距):鏡射之後兩半逐位元相同 = 一顆假的雙生岩
# (§5ac-c 因此把岩體列為禁區)。低頻位移場沿頂點法線推開之後,鏡射殘差回到天然岩體的
# 水準,而「空的那一面被填滿」不受影響 —— 兩件事各有各的量測(tools/ai3d/mesh_sym.mjs)。
# 位移是**逐頂點**的連續場 ⇒ 不新增任何一條自由邊、三角形數逐位元不變。
# 建築 MUST 給 0:對稱正是那一型的取捨(§5ac-c),歪掉的摩天樓不是「更自然」。
#
# 第四欄 `tri_cap`(選用;2026-08-09):**就地減面到某個上限**,軸給 `none` 就是「只減面」。
# 用途:`families.veg` 的 `node_cap` 是「成長額度 ÷ Σ(名冊列 × instance)」⇒ **名冊本身是
# 除數** —— 每加一列,既有節點的逐件上限就跟著降。針葉三種進名冊那一輪把 cap 由 249 壓到
# 203,而 `vleaf_a12/a20` 是 211 ⇒ 差 8 個三角形。**MUST NOT 改推導式讓自己過關**(把 whole
# 列從除數裡拿掉會讓 cap 跳到 318,那是為了讓新增品過關而放寬一道安全閘);正確的動作是
# 把那兩顆減到上限之內,而外廓仍由 `_restore_ext` 逐位元還原 ⇒ 佈局數學一格不動。
# --replanar <node>:**對 `--base` 裡已出貨的節點就地整平**(2026-08-13 使用者
# 「建築外部不平整的多塊法線角小的平面牆合併平整」)。
# 與 `--rework` 同一條紀律(外廓 `_restore_ext` 逐位元還原、面數不上升、焊接先行),
# 差別只有這一刀做什麼:`--rework` 是鏡射貼補,本旗標只跑 `_planarize`。
# **為什麼不是把 `--rework` 加一個模式**:那一支的第一欄是鏡射軸,而整平與鏡射沒有共同參數
# ——塞進去就是「axis=none 又不減面又不 warp」那個已經被擋掉的空刀再開一個後門。
# ⚠ 這一刀**改變窗牆帶的分帶結果** ⇒ 同一次呼叫 MUST 一併重烤 `--uvbands`(UV 段吃的是
#    最終座標,順序上本來就排在後面),而且重烤完 MUST 重量 `nodeProfile` 改寫 biomes 名冊。
REPLANAR = set(opt_all('replanar'))

REWORK = {}
for spec in opt_all('rework'):
    rname, rest = spec.split('=', 1)
    bits = rest.split('|')
    if bits[0] not in ('x', 'z', 'auto', 'none'):
        raise SystemExit(f'--rework {rname}:軸只能是 x / z / auto / none')
    mode = bits[2] if len(bits) > 2 else 'half'
    if mode not in ('half', 'union'):
        raise SystemExit(f'--rework {rname}:第三欄只能是 half / union')
    cap = int(bits[3]) if len(bits) > 3 and bits[3] else 0
    if bits[0] == 'none' and not float(bits[1] or 0) and not cap:
        raise SystemExit(f'--rework {rname}:axis=none 又不減面又不 warp = 這一刀什麼都沒做')
    REWORK[rname] = (bits[0], float(bits[1]) if len(bits) > 1 and bits[1] else 0.0, mode, cap)


def _ext(ob):
    """`nodeExtent`(入庫閘與對照台的那把尺)在 Blender 端的對應:水平徑向 + 縱向兩端。
    Blender Z-up、匯出 +Y up ⇒ 遊戲水平 = Blender XY、遊戲縱向 = Blender Z。"""
    vs = ob.data.vertices
    return (max(math.hypot(v.co.x, v.co.y) for v in vs),
            min(v.co.z for v in vs), max(v.co.z for v in vs))


def _restore_ext(ob, e0):
    """把外廓還原成 e0(等比縮水平、縮+平移縱向)—— 動刀前後 `nodeExtent` 逐位元相同。"""
    r0, z0, z1 = e0
    vs = ob.data.vertices
    r1 = max(math.hypot(v.co.x, v.co.y) for v in vs)
    s = r0 / r1 if r1 > 0 else 1.0
    for v in vs:
        v.co.x *= s; v.co.y *= s
    a = min(v.co.z for v in vs); b = max(v.co.z for v in vs)
    sz = (z1 - z0) / (b - a) if b > a else 1.0
    for v in vs:
        v.co.z = z0 + (v.co.z - a) * sz


def _weld(ob, name):
    """依距離焊頂點,並回報**原本的拆分比**(頂點數 ÷ 面數)。

    ⚠ 這一步對 `--rework` 是必要條件,不是保險:glTF 匯出器為了法線接縫把頂點拆開,
    而 **Blender 的 glTF 匯入器預設不會焊回去** ⇒ 平面著色的節點(拆分比 ≈ 3)在
    Blender 眼裡是一堆**互不相連的三角形**。對三角形湯做 bisect/clip 的下場實測:
    hoodoo_a 382 面 → 96 面(整顆爛掉)、tower_a 開放邊 0 → 170。焊完才是真正的拓樸。

    焊接會抹掉來源的自訂分裂法線 ⇒ 著色風格由呼叫端依拆分比還原(見 `_shade`)。"""
    me = ob.data
    ratio = len(me.vertices) / max(1, len(me.polygons))
    span = max(max(v.co[a] for v in me.vertices) - min(v.co[a] for v in me.vertices) for a in range(3))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=max(span * 1e-4, 1e-6))
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f'WELD {name}: 頂點 {ratio * len(me.polygons):.0f} → {len(me.vertices)}(原拆分比 {ratio:.2f})')
    return ratio


# 拆分比 ≥ 這個數 = 來源是**逐面**拆開的(平面著色);以下 = 平滑著色(帶硬邊)。
# 現役節點兩群分得很開:平滑 0.64~1.14、平面 2.92~3.00 ⇒ 門檻放中間,不是校準值。
FLAT_RATIO = 2.0


def _shade(ob, ratio):
    """把著色風格還原成來源那一種(焊接會把自訂分裂法線抹掉,不還原 = 低面數岩體
    從有稜有角變成一顆平滑的馬鈴薯,而所有讀數都正常)。"""
    if ratio >= FLAT_RATIO:
        bpy.ops.object.shade_flat()
    else:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))


# ============ 底部貼平(2026-08-11 使用者定案)============
# 平面整平那一半的常數住在檔頭(參數解析要用),見 `PLANAR_*`。
#

# 底部貼平:使用者定義「放在平面時,最下緣要貼齊平面」+ 手繪圖(2026-08-11):
# **把凸出平面以下的那一段整個切掉**。嚴格度階梯「建築最嚴、岩石其次、樹最寬鬆」。
# ⚠ 這三個值是**設計目標不是校準值**:掃過已出貨 46 顆,建築接觸率 .0014~.3575(中位 .080)、
# 樹中位 0、新產出 .000~.0195 —— 整個零件庫沒有一顆是貼齊的,沒有正例可以錨。明講勝過假裝。
BASE_TARGET = {'building': 0.90, 'rock': 0.35}   # 樹族缺席 = 不動
BASE_EPS_F = 0.02          # 「貼齊」的容差 = 跨距 × 此值
BASE_MAX_CUT_F = 0.12      # 最多鏟掉跨距的這麼多(寧可不達標也不砍掉一截樓)


def _family_of_out(out_path):
    """族 = 產出檔名(零件庫就是逐族一個 GLB)⇒ 推導,不是名冊。"""
    return os.path.splitext(os.path.basename(out_path))[0]


def _planar_score(ob):
    """法線分群後前 6 群佔總面積 —— 「這顆是不是人造平面主體」。"""
    me = ob.data
    tot, grp = 0.0, {}
    for p in me.polygons:
        n = p.normal
        k = (round(n.x, 1), round(n.y, 1), round(n.z, 1))
        grp[k] = grp.get(k, 0.0) + p.area
        tot += p.area
    return sum(sorted(grp.values(), reverse=True)[:6]) / tot if tot > 0 else 0.0


def _island_share(ob):
    """最大連通元件以外的面積佔比。"""
    me = ob.data
    adj = {}
    for p in me.polygons:
        vv = list(p.vertices)
        for i in range(len(vv)):
            a, b = vv[i], vv[(i + 1) % len(vv)]
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)
    seen, comp_of, cid = set(), {}, 0
    for v in adj:
        if v in seen:
            continue
        st = [v]
        seen.add(v)
        comp_of[v] = cid
        while st:
            u = st.pop()
            for w in adj[u]:
                if w not in seen:
                    seen.add(w)
                    comp_of[w] = cid
                    st.append(w)
        cid += 1
    if cid <= 1:
        return 0.0
    area = {}
    for p in me.polygons:
        c = comp_of.get(p.vertices[0], 0)
        area[c] = area.get(c, 0.0) + p.area
    tot = sum(area.values()) or 1.0
    return (tot - max(area.values())) / tot


def _span_of(me):
    return max(max(v.co[a] for v in me.vertices) - min(v.co[a] for v in me.vertices) for a in range(3))


def _coloc(me, span):
    """共位頂點對照表(頂點索引 → 代表索引)。**不動拓樸**:只是讓「同一個位置」的那幾個
    頂點在整平時一起走。glTF 匯入的是逐面拆開的三角形湯(見 `_weld` 檔頭),不做這一步
    就是共位頂點被不同群各推各的 ⇒ 沿著群界撕開一條看得見的縫,而面數/元件數全部正常。"""
    q = max(span * 1e-4, 1e-6)
    seen, rep = {}, [0] * len(me.vertices)
    for v in me.vertices:
        k = (round(v.co.x / q), round(v.co.y / q), round(v.co.z / q))
        rep[v.index] = seen.setdefault(k, v.index)
    return rep


def _solve3(N, d):
    """解 3×3 線性方程(高斯消去 + 部分樞軸);奇異回 None。Blender 的 python 沒有 numpy。"""
    m = [[N[0][0], N[0][1], N[0][2], d[0]],
         [N[1][0], N[1][1], N[1][2], d[1]],
         [N[2][0], N[2][1], N[2][2], d[2]]]
    for c in range(3):
        piv = max(range(c, 3), key=lambda r: abs(m[r][c]))
        if abs(m[piv][c]) < 1e-7:
            return None
        m[c], m[piv] = m[piv], m[c]
        for r in range(3):
            if r == c:
                continue
            f = m[r][c] / m[c][c]
            for k in range(c, 4):
                m[r][k] -= f * m[c][k]
    return (m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2])


def _plane_groups(me, off, deg=PLANAR_DEG, axis=0.0):
    """貪心分群:法線夾角 ≤ `deg` **且** 平面偏移 ≤ `off`。每收一片就重擬(面積加權)⇒
    群的平面是它自己那幾片的最佳平面,不是第一片的法線。零亂數、依面索引定序 ⇒ 決定性。
    `public/js/wallpanel.js wallPanels` 是同一條規則的**執行期端**(離線量測轉呼它;
    這一份是匯出端的刀,兩邊各寫一份正是那道閘的本錢)。

    `axis > 0` = **軸向吸附**(2026-08-13 ㋕):最佳平面已經很接近水平/垂直就吸到恰好。
    ⚠ 只有 `_planarize` 傳它 —— UV 分帶那一段 MUST NOT 吸附,否則烤進去的「平整」名冊與
    執行期 `wallPanels`(不吸附)分家,而那一份才是真的決定窗貼在哪裡的。"""
    cos_t = math.cos(math.radians(deg))
    hi = math.sqrt(max(0.0, 1.0 - axis * axis)) if axis else 2.0
    groups = []

    def refit(g):
        nx = ny = nz = cx = cy = cz = a = 0.0
        for p in g['faces']:
            f = me.polygons[p]
            nx += f.normal.x * f.area; ny += f.normal.y * f.area; nz += f.normal.z * f.area
            cx += f.center.x * f.area; cy += f.center.y * f.area; cz += f.center.z * f.area
            a += f.area
        ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        n = (nx / ln, ny / ln, nz / ln)
        if axis:
            az = abs(n[2])
            if az <= axis:                      # 近垂直 ⇒ 吸成恰好垂直(Blender z = 遊戲 Y)
                h = math.hypot(n[0], n[1]) or 1.0
                n = (n[0] / h, n[1] / h, 0.0)
            elif az >= hi:                      # 近水平 ⇒ 吸成恰好水平
                n = (0.0, 0.0, 1.0 if n[2] > 0 else -1.0)
        g['n'] = n
        g['c'] = (cx / a, cy / a, cz / a) if a else g['c']
        g['area'] = a

    for p in me.polygons:
        n, c = p.normal, p.center
        for g in groups:
            gn, gc = g['n'], g['c']
            if n.x * gn[0] + n.y * gn[1] + n.z * gn[2] < cos_t:
                continue
            if abs((c.x - gc[0]) * gn[0] + (c.y - gc[1]) * gn[1] + (c.z - gc[2]) * gn[2]) > off:
                continue
            g['faces'].append(p.index)
            refit(g)
            break
        else:
            groups.append({'n': (n.x, n.y, n.z), 'c': (c.x, c.y, c.z), 'faces': [p.index], 'area': p.area})
    return groups


def _planarize(ob, name):
    """把「法線角小而且本來就幾乎同一個平面」的那幾塊**合併**成一個平面,再把它們的頂點
    推上去。**只動位置不動拓樸** ⇒ 面數 / 元件數 / 邊界邊 / 頂點數逐項不變,三角形預算
    不受影響(這是它與鏡射/貼平最大的差別)。"""
    score = _planar_score(ob)
    island = _island_share(ob)
    if score < PLANAR_SPLIT or island >= PLANAR_ISLAND_MAX:
        why = (f'平面分數 {score:.3f} < {PLANAR_SPLIT}' if score < PLANAR_SPLIT
               else f'碎屑佔比 {island:.3f} ≥ {PLANAR_ISLAND_MAX}(不是實心單體)')
        print(f'PLANAR {name}: 略過 —— {why}')
        return
    me = ob.data
    span = _span_of(me)
    off = span * PLANAR_OFF_F
    rep = _coloc(me, span)
    home = [v.co.copy() for v in me.vertices]   # 累計夾制的原點
    moved = 0
    for _ in range(PLANAR_PASSES):
        me.update()
        tot = sum(p.area for p in me.polygons) or 1.0
        own = {}                                 # 代表頂點 → [群, …]
        big = []
        for g in _plane_groups(me, off, axis=PLANAR_AXIS):
            if g['area'] / tot < PLANAR_MIN_F:
                continue
            big.append(g)
            for vi in {rep[vi] for fi in g['faces'] for vi in me.polygons[fi].vertices}:
                own.setdefault(vi, []).append(g)
        moved = len(big)
        if not own:
            break
        # ㋖ 殘料吸附:不屬於任何大群的頂點(尖刺 / 屋頂碎片)離某個大平面夠近就吸上去
        for v in me.vertices:
            if v.index != rep[v.index] or v.index in own:
                continue
            best, bd = None, off
            for g in big:
                d = ((v.co.x - g['c'][0]) * g['n'][0] + (v.co.y - g['c'][1]) * g['n'][1]
                     + (v.co.z - g['c'][2]) * g['n'][2])
                if abs(d) <= abs(bd):
                    best, bd = g, d
            if best:
                own[v.index] = [best]
        # ㋔ 同時屬於兩片以上平面的頂點:解**交線 / 交點**,不是逐群投影再平均 ——
        #    平均點落在兩個平面**中間**,那就是把每一條邊角磨成圓角(這一輪要修的東西)。
        for vi, gs in own.items():
            v = me.vertices[vi].co
            pick = []                            # 取彼此最不平行的最多三面(平行面沒有新約束)
            for g in gs:
                if all(abs(q['n'][0] * g['n'][0] + q['n'][1] * g['n'][1] + q['n'][2] * g['n'][2]) < 0.94
                       for q in pick):
                    pick.append(g)
                if len(pick) == 3:
                    break
            ds = [g['n'][0] * g['c'][0] + g['n'][1] * g['c'][1] + g['n'][2] * g['c'][2] for g in pick]
            tgt = None
            if len(pick) == 1:
                n = pick[0]['n']
                t = ds[0] - (n[0] * v.x + n[1] * v.y + n[2] * v.z)
                tgt = (v.x + n[0] * t, v.y + n[1] * t, v.z + n[2] * t)
            elif len(pick) == 2:
                a, b = pick[0]['n'], pick[1]['n']
                L = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
                ll = math.sqrt(L[0] * L[0] + L[1] * L[1] + L[2] * L[2])
                if ll > 1e-6:                    # 交線上離 v 最近的點
                    u = (L[0] / ll, L[1] / ll, L[2] / ll)
                    tgt = _solve3([a, b, u], [ds[0], ds[1], u[0] * v.x + u[1] * v.y + u[2] * v.z])
            elif len(pick) == 3:
                tgt = _solve3([pick[0]['n'], pick[1]['n'], pick[2]['n']], ds)
            if tgt is None:                      # 退回逐群投影再平均(奇異或平行)
                ax = ay = az = 0.0
                for g in gs:
                    n, c = g['n'], g['c']
                    t = (v.x - c[0]) * n[0] + (v.y - c[1]) * n[1] + (v.z - c[2]) * n[2]
                    ax -= t * n[0]; ay -= t * n[1]; az -= t * n[2]
                tgt = (v.x + ax / len(gs), v.y + ay / len(gs), v.z + az / len(gs))
            x, y, z = tgt
            h = home[vi]
            dx, dy, dz = x - h.x, y - h.y, z - h.z
            ln = math.sqrt(dx * dx + dy * dy + dz * dz)
            if ln > off:                        # 累計位移夾在合併容差之內(同一個數字)
                s = off / ln
                x, y, z = h.x + dx * s, h.y + dy * s, h.z + dz * s
            v.x, v.y, v.z = x, y, z
        # 共位頂點跟著代表走(拓樸沒變,只是它們本來就該是同一個點)
        for v in me.vertices:
            if rep[v.index] != v.index:
                v.co = me.vertices[rep[v.index]].co.copy()
    me.update()
    far = max((v.co - home[v.index]).length for v in me.vertices) if me.vertices else 0.0
    print(f'PLANAR {name}: 分數 {score:.3f} / 碎屑 {island:.3f} ⇒ {PLANAR_PASSES} 趟、'
          f'末趟整平 {moved} 群(合併容差 = 累計位移上限 {off:.4f},實得最大位移 {far:.4f})')


def _hull_area(pts):
    """2D 凸包面積(monotone chain);Blender 的 python 沒有 scipy ⇒ 自己寫。
    **只拿來當足跡(整顆的影子)**,MUST NOT 拿它當斷面積 —— 見 `_cut_cap` 的警語。"""
    p = sorted(set((round(x, 9), round(y, 9)) for x, y in pts))
    if len(p) < 3:
        return 0.0

    def half(seq):
        h = []
        for q in seq:
            while len(h) >= 2 and ((h[-1][0] - h[-2][0]) * (q[1] - h[-2][1])
                                   - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0])) <= 0:
                h.pop()
            h.append(q)
        return h
    hull = half(p)[:-1] + half(list(reversed(p)))[:-1]
    a = 0.0
    for i in range(len(hull)):
        x1, y1 = hull[i]
        x2, y2 = hull[(i + 1) % len(hull)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _cut_cap(me, z, apply_to=None):
    """在高度 z 切一刀、丟掉下面那一段、補平面蓋。回蓋子總面積。
    `apply_to=None` ⇒ 在**副本**上量(掃描用);給 mesh ⇒ 真的寫回去。

    ⚠ **量的就是「這一刀會得到多大的蓋子」本身,不是任何替身。** 2026-08-11 的錯就出在
    拿**凸包面積**當斷面積:裙邊那一段的斷面是幾片細長、彼此分開的碎片,凸包把它們框成
    一大塊(實測 0.786 × 足跡 ⇒ 掃描判定「這一層可以」),而真正有材料的只有十分之一
    (蓋子 0.0075 vs 足跡 0.0938 = 8%)。選層與讀數都繼承同一個替身,所以連改四次都沒改到。
    """
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    res = bmesh.ops.bisect_plane(
        bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=(0.0, 0.0, z), plane_no=(0.0, 0.0, 1.0), clear_inner=True)
    # 只補**切環**(`geom_cut`):網格本來就有的破洞不該被這一刀順手補掉
    ring = [g for g in res['geom_cut'] if isinstance(g, bmesh.types.BMEdge)]
    area = 0.0
    if ring:
        for f in bmesh.ops.contextual_create(bm, geom=ring).get('faces', []):
            area += f.calc_area()
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if apply_to is not None:
        bm.to_mesh(apply_to)
        apply_to.update()
    bm.free()
    return area


def _base_contact(ob, eps):
    """接觸率 = 貼在平面上的投影面積 ÷ **足跡**(整顆的影子)。回 (接觸率, 最低 z)。
    分母 MUST 是足跡而不是「所有朝下的面」—— 後者把簷口/陽台/退縮階的下緣全算進去,
    一顆底部完美平整、上方懸挑很多的量體讀數照樣很低。"""
    me = ob.data
    z0 = min(v.co.z for v in me.vertices)
    foot = _hull_area([(v.co.x, v.co.y) for v in me.vertices])
    hit = 0.0
    for p in me.polygons:
        if p.normal.z > -0.3:
            continue
        if max(me.vertices[i].co.z for i in p.vertices) <= z0 + eps:
            hit += abs(p.normal.z) * p.area
    return (hit / foot if foot > 0 else float('nan')), z0


def _base_flatten(ob, name, fam):
    """底部貼平:把凸出平面以下的那一段整個切掉,斷面補成一個平面蓋(使用者手繪圖)。

    切到哪一層 = 掃最底 `BASE_MAX_CUT_F` 這一段,**逐層真的切一刀量蓋子**,取第一個達到
    `target × 平坦值` 的高度 —— 裙邊那一段蓋子面積陡升、本體那一段平坦,膝點就是裙邊的頂。
    """
    target = BASE_TARGET.get(fam)
    if target is None:
        return
    me = ob.data
    span = max(max(v.co[a] for v in me.vertices) - min(v.co[a] for v in me.vertices) for a in range(3))
    eps = span * BASE_EPS_F
    c0, z0 = _base_contact(ob, eps)
    # ⚠ `target` 是「斷面要達到**平坦值**的幾成」,**不是**接觸率的門檻。兩者不可混用:
    # 接觸率的分母是**凸包**足跡,而 L 形 / 雙瓣這種非凸量體的凸包會把中間的空隙也算進去
    # ⇒ 接觸率天生達不到 0.9,拿它當閘門就變成「永遠要鏟」或「永遠鏟不夠」
    # (2026-08-11 實測:twin1 的底部是兩瓣,鏟到 0.105 × 跨距 接觸率也只有 0.192)。
    # 閘門改成「**現在的底面已經夠平了嗎**」= t≈0 那一層的斷面有沒有到平坦值的 target。
    steps = 24
    levels = [BASE_MAX_CUT_F * span * i / steps for i in range(0, steps + 1)]
    areas = [_cut_cap(me, z0 + t) for t in levels]          # 直接切、直接量,沒有替身
    plateau = max(areas) if areas else 0.0
    if plateau <= 0:
        print(f'BASE {name}({fam}): 量不到斷面 ⇒ 不動')
        return
    if areas[0] >= target * plateau:
        print(f'BASE {name}({fam}): 底面斷面已達平坦值的 {areas[0] / plateau:.2f} '
              f'(≥ {target})⇒ 不動')
        return
    best = None
    for t, a in zip(levels[1:], areas[1:]):
        if a >= target * plateau:
            best = t
            break
    if best is None:
        print(f'BASE {name}({fam}): 鏟到上限 {BASE_MAX_CUT_F} × 跨距 斷面仍只有平坦值的 '
              f'{max(areas) and areas[-1] / plateau:.2f} ⇒ 不鏟(寧可不達標也不砍掉一截)')
        return
    cap = _cut_cap(me, z0 + best, apply_to=me)
    c1, _ = _base_contact(ob, eps)
    # 接觸率是**診斷**不是驗收(分母是凸包 ⇒ 非凸量體天生 <1);驗收看「斷面/平坦值」
    print(f'BASE {name}({fam}): 鏟掉 {best / span:.3f} × 跨距 ⇒ 斷面 {cap:.5f} '
          f'= 平坦值的 {cap / plateau:.2f}(目標 {target});'
          f'接觸率(診斷,對凸包){c0:.3f} → {c1:.3f}')


def _mirror(ob, axis, name, mode='half'):
    """鏡像貼補。回 (軸, 不對稱度) 或 None(量不到)。

    兩種刀,**依主體是不是人造的**選,不是喜好問題:

    `half`(切一半 → 翻過去 → 焊接縫):量體本來就左右對稱的東西(建築)用這把。
      對圓渾的岩體它會做出**葉緣** —— 保留的那半在切面上是最寬的斷面,而表面是斜著離開
      切面的,翻一份接上去就在切面接成一道銳脊:實測 mega_c 從一顆卵石變成一片有中脊的
      葉子、mesa_a 的平頂變成尖峰、collapse_a 變成楔形(§5ad 黏土對照留檔)。

    `union`(整份鏡射 → **精確布林聯集**):岩體用這把。聯集取的是兩者的**外包絡** ——
      本來就厚的那半原封不動、空的那半被鏡像撐出來,接縫是內凹的岩溝而不是外凸的銳脊,
      平頂/塊狀輪廓因此保得住。與 §5ac-b 失敗的「整份鏡射再疊合」不是同一件事:那一版
      是把兩張殼疊在一起交給等值面重採樣自己想辦法(內外號誌打架 ⇒ 開放邊 1,119),
      這裡是真的做布林。"""
    vs = ob.data.vertices
    # 遊戲 x/z → Blender X/Y(匯出 +Y up 時 Blender Z 才是遊戲的縱向)
    axes = [0, 1] if axis == 'auto' else [{'x': 0, 'z': 1}[axis]]
    pick = None
    for ax in axes:
        lo = min(v.co[ax] for v in vs); hi = max(v.co[ax] for v in vs)
        mid = (lo + hi) / 2
        aP = sum(p.area for p in ob.data.polygons if p.center[ax] >= mid)
        aN = sum(p.area for p in ob.data.polygons if p.center[ax] < mid)
        tot = aP + aN
        if tot <= 0:
            continue
        asym = abs(aP - aN) / tot
        if pick is None or asym > pick[0]:
            pick = (asym, ax, mid, aP >= aN)
    if pick is None:
        print(f'MIRROR {name}: 量不到不對稱(退化輸入)—— 略過')
        return None
    asym, ax, mid, keep_pos = pick
    for v in vs:
        v.co[ax] -= mid
    span = max(abs(v.co[ax]) for v in vs) or 1.0
    if mode == 'union':
        dup = ob.copy()
        dup.data = ob.data.copy()
        bpy.context.collection.objects.link(dup)
        for v in dup.data.vertices:
            v.co[ax] = -v.co[ax]
        # 單軸取負 = 座標系換手 ⇒ 面的朝向整份翻過來,不翻回來布林會判錯內外
        dup.data.flip_normals()
        mod = ob.modifiers.new('bool', 'BOOLEAN')
        mod.operation = 'UNION'
        mod.object = dup
        mod.solver = 'EXACT'
        bpy.ops.object.modifier_apply(modifier='bool')
        bpy.data.objects.remove(dup, do_unlink=True)
        print(f'MIRROR {name}: 軸 {"xz"[ax]}(遊戲座標)・不對稱 {asym:.3f}・聯集・'
              f'面 {sum(len(p.vertices) - 2 for p in ob.data.polygons)}')
        return (ax, asym)
    mod = ob.modifiers.new('mir', 'MIRROR')
    mod.use_axis = tuple(i == ax for i in range(3))
    mod.use_bisect_axis = mod.use_axis
    # bisect 預設留**負**側;要留正側就翻 bisect 方向
    mod.use_bisect_flip_axis = tuple((i == ax) and keep_pos for i in range(3))
    mod.use_clip = True
    mod.use_mirror_merge = True
    mod.merge_threshold = span * 1e-3      # 焊接縫;比例值,絕對值不可移植(§5r ⑥)
    bpy.ops.object.modifier_apply(modifier='mir')
    print(f'MIRROR {name}: 軸 {"xz"[ax]}(遊戲座標)・不對稱 {asym:.3f}・'
          f'留 {"+" if keep_pos else "-"} 半・面 {sum(len(p.vertices) - 2 for p in ob.data.polygons)}')
    return (ax, asym)


def _topo(ob):
    """(邊界邊數, 鬆散元件數) —— 這一刀有沒有把網格撕爛的兩個讀數(與
    `tools/ai3d/mesh_sym.mjs` 同一組定義,一邊在 Blender 一邊在 Node,結論可互相對帳)。"""
    me = ob.data
    ecnt, adj = {}, {}
    for p in me.polygons:
        vv = list(p.vertices)
        for i in range(len(vv)):
            a, b = vv[i], vv[(i + 1) % len(vv)]
            k = (a, b) if a < b else (b, a)
            ecnt[k] = ecnt.get(k, 0) + 1
            adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
    seen, comps = set(), 0
    for v in adj:
        if v in seen:
            continue
        comps += 1
        st = [v]; seen.add(v)
        while st:
            u = st.pop()
            for w in adj[u]:
                if w not in seen:
                    seen.add(w); st.append(w)
    return sum(1 for c in ecnt.values() if c == 1), comps


# 鏡射後的面數下界(× 原面數)。切一半再翻一份 ⇒ 面數只會**持平或上升**;真的掉下來
# 表示 bisect 在這顆網格上崩了(實測 hoodoo_a 的 z 平面:382 → 96 —— 那顆是
# Hunyuan3D-2GP 的產出,焊完 V=139/F=382 已經不是流形,同一顆的 x 平面卻好端端 616)。
# 少了這道閘,壞掉的節點會**安靜地**出貨:外廓照樣還原、預算照樣綠、intake 一句話都不會說。
MIRROR_MIN_F = 0.8


# 去對稱化的位移場:三個低頻正弦(1~5 個瓣跨過整顆),相位/方向由**節點名**決定
# ⇒ 同一個名字永遠得到同一顆(決定性;產出是要進版控的二進位檔)。
WARP_F = (1.3, 2.6, 4.7)      # 頻率(每跨距的瓣數):低頻 = 「這一側比較胖」而不是砂紙
WARP_W = (1.0, 0.55, 0.30)    # 各階權重(和為 1.85,下面正規化)


def _warp(ob, amp, name):
    """低頻場把鏡射造成的完美對稱打散。位移**只是位置的函數** ⇒ 拓樸、面數、開放邊
    逐位元不變。

    ⚠ 方向 MUST 取**徑向**(離節點中心),MUST NOT 取頂點法線:glTF 匯入器不會把匯出時
    為了法線接縫拆開的頂點焊回去(mega_a 219 個頂點裡只有 144 個相異座標)⇒ 逐頂點法線
    在那些**座標重合但各自獨立**的頂點上是不同的向量,推一下就把網格沿每一條硬邊撕開
    (實測 mega_a 開放邊 0 → 164、元件 1 → 7)。位置的函數對重合頂點給出同一個位移,
    結構上不可能撕。岩體對中心近似星形 ⇒ 徑向與法線本來就幾乎同向。"""
    me = ob.data
    vs = me.vertices
    span = max(max(v.co[a] for v in vs) - min(v.co[a] for v in vs) for a in range(3))
    ctr = [(max(v.co[a] for v in vs) + min(v.co[a] for v in vs)) / 2 for a in range(3)]
    rng = random.Random(f'warp:{name}')
    waves = []
    for k in range(3):
        d = [rng.gauss(0, 1) for _ in range(3)]
        ln = math.sqrt(sum(c * c for c in d)) or 1.0
        waves.append(([c / ln for c in d], rng.uniform(0, 2 * math.pi),
                      2 * math.pi * WARP_F[k] / span, WARP_W[k]))
    wsum = sum(WARP_W)
    moved = 0.0
    for v in vs:
        t = 0.0
        for (d, ph, kf, w) in waves:
            t += w * math.sin((d[0] * v.co.x + d[1] * v.co.y + d[2] * v.co.z) * kf + ph)
        t /= wsum
        rx = v.co.x - ctr[0]; ry = v.co.y - ctr[1]; rz = v.co.z - ctr[2]
        ln = math.sqrt(rx * rx + ry * ry + rz * rz)
        if ln <= 1e-9:
            continue
        dz = amp * span * t
        v.co.x += rx / ln * dz; v.co.y += ry / ln * dz; v.co.z += rz / ln * dz
        moved += abs(dz)
    print(f'WARP {name}: 振幅 {amp:.3f}×跨距 {span:.3f}・平均位移 {moved / len(vs):.4f}')


if BASE:
    bpy.ops.import_scene.gltf(filepath=BASE)
    regen = {n[0] for n in NODES} | DROP
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            continue
        # `.001` 尾碼一併清:base 若已被舊版本汙染過(撞名自動改名留下的孤兒),
        # 只比對精確名字會把孤兒留在輸出裡 —— 它沒有消費端,但會一直出現在對照台
        if o.name.split('.')[0] in regen:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        o.data.materials.clear()
        made.append(o)

# ---- `--replanar`:對 base 裡已出貨的節點就地整平(2026-08-13)----
# 紀律與 `--rework` 逐條相同:焊接先行(三角形湯整不動)、外廓逐位元還原、著色風格還原、
# 面數 MUST NOT 上升(整平只動位置 ⇒ 這一條是結構保證,驗它是為了擋住「有人順手加了刀」)。
if REPLANAR:
    assert BASE, '--replanar 要有 --base(它動的是已出貨節點)'
    byname = {o.name.split('.')[0]: o for o in made}
    dup = REPLANAR & ({n[0] for n in NODES} | set(REWORK))
    assert not dup, f'同一顆節點不可同時 --replanar 與 --node/--rework:{sorted(dup)}'
    miss = REPLANAR - set(byname)
    assert not miss, f'--replanar 指到 base 裡不存在的節點:{sorted(miss)}'
    for rname in sorted(REPLANAR):
        ob = byname[rname]
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        e0 = _ext(ob)
        t0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except RuntimeError:
            pass
        ratio = _weld(ob, rname)
        _planarize(ob, rname)
        _restore_ext(ob, e0)
        _shade(ob, ratio)
        e1 = _ext(ob)
        assert max(abs(a - b) for a, b in zip(e0, e1)) < 1e-5, f'{rname}:外廓還原失敗 {e0} → {e1}'
        t1 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        assert t1 <= t0, f'{rname}:面數上升 {t0} → {t1}(整平只動位置,上升 = 有人多加了一刀)'
        print(f'REPLANAR {rname}: tris {t0} → {t1}・外廓 r={e1[0]:.4f} y=[{e1[1]:.4f},{e1[2]:.4f}](逐位元還原)')

# ---- `--rework`:對 base 裡已出貨的節點就地動刀(鏡像貼補 + 去對稱化)----
# MUST 排在 BOXUV **之前**(它吃的是最終座標),也 MUST 與 `--node` 互斥 —— 同一顆節點
# 又重生又就地改,重生那條會先把它刪掉,rework 只會安靜地什麼都沒做。
if REWORK:
    assert BASE, '--rework 要有 --base(它動的是已出貨節點)'
    byname = {o.name.split('.')[0]: o for o in made}
    dup = set(REWORK) & {n[0] for n in NODES}
    assert not dup, f'同一顆節點不可同時 --node 與 --rework:{sorted(dup)}'
    miss = set(REWORK) - set(byname)
    assert not miss, f'--rework 指到 base 裡不存在的節點:{sorted(miss)}'
    for rname, (axis, warp, mode, tcap) in REWORK.items():
        ob = byname[rname]
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        e0 = _ext(ob)
        t0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except RuntimeError:
            pass          # 這顆本來就沒有自訂分裂法線
        ratio = _weld(ob, rname)
        o0, c0 = _topo(ob)
        if axis != 'none':
            _mirror(ob, axis, rname, mode)
        # 一顆岩是一顆岩:鬆散元件變多 = 這一刀把它炸成漂浮的碎片(實測 tower_a 走聯集
        # 那把刀:元件 1 → 14,而面數只掉 6% —— 光看面數的閘門完全攔不住,黏土圖上是
        # 一地碎屑)。MUST 在減面之前驗:減面會把碎屑磨掉一部分,讀數反而變好看。
        o1, c1 = _topo(ob)
        assert c1 <= c0, f'{rname}:鏡射把網格炸成碎片(鬆散元件 {c0} → {c1})—— 別出貨'
        assert o1 <= o0 + 0.05 * t0, f'{rname}:鏡射開出新的破口(邊界邊 {o0} → {o1})—— 別出貨'
        # 面數 MUST NOT 上升:鏡射會多出切面那一圈(+17~26% 實測),而現役節點的預算餘裕
        # 只有 2%(chimney_a 217/222、ac_a 279/285)—— 「就地動刀」的意思是**預算與外廓
        # 都不動**,只有殼裡的形狀變。減面比 1.2:1 以下,遠離 §5e 量到的 2.4~3:1 撕裂區。
        t1 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        assert axis == 'none' or t1 >= t0 * MIRROR_MIN_F, \
            f'{rname}:鏡射把面數打掉了({t0} → {t1})—— 這顆網格撐不住這一刀,別出貨'
        if t1 > t0:
            mod = ob.modifiers.new('dec', 'DECIMATE')
            mod.ratio = t0 / t1 * 0.98
            bpy.ops.object.modifier_apply(modifier='dec')
        # 就地減面(第四欄):排在 warp **之前** —— 減面之後頂點少了,同一個振幅的位移
        # 場會在更粗的網格上放大成可見的凹凸;而 warp 之後再減面則會把剛推出來的起伏磨掉。
        if tcap:
            t1b = sum(len(p.vertices) - 2 for p in ob.data.polygons)
            if t1b > tcap:
                mod = ob.modifiers.new('dec', 'DECIMATE')
                mod.ratio = tcap / t1b * 0.98
                bpy.ops.object.modifier_apply(modifier='dec')
        if warp:
            _warp(ob, warp, rname)
        _restore_ext(ob, e0)
        _shade(ob, ratio)
        e1 = _ext(ob)
        assert max(abs(a - b) for a, b in zip(e0, e1)) < 1e-5, \
            f'{rname}:外廓還原失敗 {e0} → {e1}'
        t2 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        assert t2 <= t0, f'{rname}:面數上升 {t0} → {t2}(預算餘裕吃不下)'
        print(f'REWORK {rname}: tris {t0} → {t2}・邊界邊 {o0} → {o1}・元件 {c0} → {c1}・'
              f'外廓 r={e1[0]:.4f} y=[{e1[1]:.4f},{e1[2]:.4f}](逐位元還原)')

pending = {}        # group → [ob, ...](置中與縮放延到全群備齊之後)
for (name, src, target_r, target_hy, tri_cap, ry_deg, dy, grp) in NODES:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=src)
    news = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not news:
        raise RuntimeError(f'{src} 匯入後沒有 mesh')
    # SF3D 輸出是單一 mesh;若多個就 join
    bpy.ops.object.select_all(action='DESELECT')
    for o in news:
        o.select_set(True)
    bpy.context.view_layer.objects.active = news[0]
    if len(news) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    # 套掉匯入變換(SF3D 的 glTF 可能帶節點旋轉),之後全在網格頂點上操作
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 變化朝向(facet_b 與 facet_a 同源,轉個角度別讓玩家一眼看出同一顆)
    if ry_deg:
        # ⚠ `rotation_mode = 'XYZ'` MUST 先設(2026-08-08 實測):**glTF importer 把物件設成
        # `QUATERNION`**,而在那個模式下賦值 `rotation_euler` 是**靜默無效**的 —— `transform_apply`
        # 照樣回 FINISHED、euler 照樣歸零,頂點一個都沒動。⇒ 這個旗標從第一天起就是 no-op
        # (所有帶 ry 的節點都沒有真的轉過;所幸 facet_a/b 各自有自己的來源與減面比,
        #  沒有退化成同一顆)。判準:轉 60° 之後包圍盒 MUST 變(x ±0.378 → ±0.446)。
        ob.rotation_mode = 'XYZ'
        ob.rotation_euler = (0.0, 0.0, math.radians(ry_deg))   # Blender Z-up;匯出時轉 glTF Y-up
        bpy.ops.object.transform_apply(rotation=True)

    # ②-a 平面整平 / ②-a2 底部貼平(2026-08-11;**預設開**,對象由推導決定)。
    #     MUST 排在減面**之前**:整平讓共面的面真的共面、鏟平改變斷面,
    #     排在減面之後就是對著已收進預算的網格再動一刀。
    if not NO_PLANAR:
        _planarize(ob, name)
    _base_flatten(ob, name, _family_of_out(OUT))

    # ②-b 鏡像貼補(MUST 排在減面**之前**:鏡射保留一半的面、再翻一份 ⇒ 面數大致不變,
    #     排在減面之後會直接把預算翻倍)。鏡射面過**物件原點** ⇒ 先把該軸的包圍盒中點
    #     平移到 0(後面 ① 的置中會再收一次,所以不必平移回來)。
    if name in MIRROR:
        bpy.context.view_layer.objects.active = ob
        _mirror(ob, MIRROR[name], name)

    # ③ 減面(先減後量:減面本身會微動外廓)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > tri_cap:
        mod = ob.modifiers.new('dec', 'DECIMATE')
        mod.ratio = tri_cap / tris * 0.98
        bpy.ops.object.modifier_apply(modifier='dec')

    # ④ 剝材質 / UV / 色彩屬性(群組成員一樣要剝 ⇒ 排在分流之前)
    ob.data.materials.clear()
    for uv in list(ob.data.uv_layers):
        ob.data.uv_layers.remove(uv)
    for ca in list(ob.data.color_attributes):
        ob.data.color_attributes.remove(ca)

    if grp:
        # 群組成員:置中與縮放延後(要等全群備齊才算得出聯集)。dy 對群組沒有語意
        # ——「貼地」是整群的事,由群組包絡與消費端的 y 決定。
        assert not dy, f'{name}:群組節點不支援 dy(貼地是整群的事)'
        pending.setdefault(grp, []).append(ob)
        made.append(ob)
        continue

    # ① 置中(包圍盒中心 → 原點)
    vs = ob.data.vertices
    xs = [v.co.x for v in vs]; ys = [v.co.y for v in vs]; zs = [v.co.z for v in vs]
    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; cz = (min(zs) + max(zs)) / 2
    for v in vs:
        v.co.x -= cx; v.co.y -= cy; v.co.z -= cz
    # ② 縮放。Blender Z-up ⇒ 遊戲的「水平」= XY、「縱向」= Z(匯出 +Y up 時互換)。
    #    等比(舊行為,岩族逐位元不變)/ 非等向(target_hy 給定:兩軸各自拉滿包絡 × FIT)
    r_max = max(math.hypot(v.co.x, v.co.y) for v in vs)
    z_max = max(abs(v.co.z) for v in vs)
    hy = target_hy if target_hy is not None else target_r
    if target_hy is None:
        s = min(FIT * target_r / r_max, FIT * target_r / z_max)
        s_xy = s_z = s
    else:
        s_xy = FIT * target_r / r_max
        s_z = FIT * hy / z_max
    for v in vs:
        v.co.x *= s_xy
        v.co.y *= s_xy
        v.co.z *= s_z
    r_fin = r_max * s_xy
    assert r_fin >= 0.5 * target_r, f'{name}:縮放後水平徑向 {r_fin:.3f} < 下界 {0.5 * target_r:.3f}(高瘦輸入不適合這個 fallback)'
    if dy:
        for v in vs:
            v.co.z += dy          # Blender Z-up;匯出 +Y up 時 = 遊戲的縱向平移
        # 界限取**完整包絡**(FIT 是縮放餘裕;dy 的用途是貼地,intake 驗的是完整包絡)
        assert abs(-z_max * s_z + dy) <= hy and abs(z_max * s_z + dy) <= hy, f'{name}:dy 把縱向推出包絡'

    tris_fin = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'NODE {name}: tris={tris_fin} r={r_fin:.3f}/{target_r} zspan={z_max * s_z:.3f}/{hy}')
    made.append(ob)

# ---- 群組:一個變換套給全群(聯集置中 + 聯集縮放)----
for gname, obs in pending.items():
    target_r, target_hy = GROUPS[gname]
    allv = [(v, o) for o in obs for v in o.data.vertices]
    xs = [v.co.x for v, _ in allv]; ys = [v.co.y for v, _ in allv]; zs = [v.co.z for v, _ in allv]
    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; cz = (min(zs) + max(zs)) / 2
    for v, _ in allv:
        v.co.x -= cx; v.co.y -= cy; v.co.z -= cz
    r_max = max(math.hypot(v.co.x, v.co.y) for v, _ in allv)
    z_max = max(abs(v.co.z) for v, _ in allv)
    hy = target_hy if target_hy is not None else target_r
    if target_hy is None:
        s_xy = s_z = min(FIT * target_r / r_max, FIT * target_r / z_max)
    else:
        s_xy = FIT * target_r / r_max
        s_z = FIT * hy / z_max
    for v, _ in allv:
        v.co.x *= s_xy; v.co.y *= s_xy; v.co.z *= s_z
    r_fin = r_max * s_xy
    assert r_fin >= 0.5 * target_r, \
        f'群組 {gname}:縮放後水平徑向 {r_fin:.3f} < 下界 {0.5 * target_r:.3f}'
    print(f'GROUP {gname}: r={r_fin:.3f}/{target_r} zspan={z_max * s_z:.3f}/{hy} '
          f'({len(obs)} 顆共用同一個變換)')
    for o in obs:
        t = sum(len(p.vertices) - 2 for p in o.data.polygons)
        vv = o.data.vertices
        rr = max(math.hypot(v.co.x, v.co.y) for v in vv)
        z0 = min(v.co.z for v in vv); z1 = max(v.co.z for v in vv)
        print(f'NODE {o.name}: tris={t} r={rr:.3f} z=[{z0:.3f},{z1:.3f}] (群組 {gname})')

# ---- 盒投影 UV(MUST 排在置中/縮放/dy **之後**:它吃的是最終座標)----
# `--roofband` 走**同一段**:它不是另一種投影,只是在同一份逐面盒投影上多分一條帶
# —— 分兩段寫就是「兩份 UV 規則」,而它們分家的樣子是「牆對得上、屋頂差一條縫」。
# 這一段吃 `made`,而 `--base` 帶進來的既有節點也在裡面 ⇒ 對已出貨節點只重建 UV、
# **幾何逐位元不動**(同 `--rework` 的那條路,但連頂點都不碰)。
for o in made:
    nm = o.name.split('.')[0]
    band = UVBANDS.get(nm)
    if nm not in BOXUV and not band:
        continue
    me = o.data
    # base 節點本來就帶著上一輪的 UV ⇒ 先清乾淨,否則 `uv_layers.new` 只是加**第二層**
    # (three 取第 0 層 = 舊的那一份),看起來就是「這一輪的 UV 完全沒有生效」
    for old in list(me.uv_layers):
        me.uv_layers.remove(old)
    uv = me.uv_layers.new(name='UVMap')
    frac, pfrac, minz, wall_ny, fdeg, fmin = band or (0.0, 0.0, 1.0, 0.0, 0.0, 0.0)
    # 2026-08-13:窗牆帶的資格 = 近垂直 **∧** 真的貼在自己那一群的平面上。
    # 判據與 `_planarize` 共用 `_plane_groups`(同一次分群,兩個消費端);量測端是
    # `parts_src.mjs flatWalls`,`intake_parts` 拿它從成品 GLB 重算一次再比對。
    flat_fi = None
    if fdeg > 0.0:
        off_f = _span_of(me) * PLANAR_OFF_F
        tot_a = sum(p.area for p in me.polygons) or 1.0
        cos_f = math.cos(math.radians(fdeg))
        flat_fi = set()
        for g in _plane_groups(me, off_f):
            # **群本身也要近垂直** —— 少了這一條,一片近垂直的面只要落在一個傾斜的群裡就
            # 算「平整的牆」,而執行期 `wallpanel.wallPanels` 是連群一起判的 ⇒ 兩邊分家
            # (症狀:`intake_parts` 說傾斜面的 v 跑進窗牆帶,而那一面在遊戲裡真的有窗)
            if g['area'] / tot_a < fmin or abs(g['n'][2]) > wall_ny:
                continue
            gn = g['n']
            for fi in g['faces']:
                fn = me.polygons[fi].normal
                if abs(fn.z) <= wall_ny and fn.x * gn[0] + fn.y * gn[1] + fn.z * gn[2] >= cos_f:
                    flat_fi.add(fi)
    up_n = 0
    tilt_n = 0
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))   # 0=x 1=y 2=z(Blender)
        roof = n.z > minz                             # Blender z = 遊戲 Y
        # 素牆:傾斜 / 朝下(2026-08-12)+ **近垂直但不平整**(2026-08-13)。
        # pfrac = 0 ⇒ 逐位元同兩帶舊制;fdeg = 0 ⇒ 逐位元同純傾角三帶。
        tilt = (not roof) and pfrac > 0.0 and (
            abs(n.z) > wall_ny or (flat_fi is not None and poly.index not in flat_fi))
        if roof:
            up_n += 1
        elif tilt:
            tilt_n += 1
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            if roof:         # 屋頂:一律**平面投影**(從上往下看),不看主導軸
                u2, v2 = v.x + 0.5, -v.y + 0.5
            elif ax == 0:    # 遊戲 ±X 面:u ← 遊戲 Z(= −y)、v ← 遊戲 Y(= z)
                u2, v2 = -v.y + 0.5, v.z + 0.5
            elif ax == 1:    # 遊戲 ±Z 面:u ← 遊戲 X(= x)、v ← 遊戲 Y(= z)
                u2, v2 = v.x + 0.5, v.z + 0.5
            else:            # 遊戲 ±Y 面(頂/底):u ← X、v ← 遊戲 Z(= −y)
                u2, v2 = v.x + 0.5, -v.y + 0.5
            v2 = min(max(v2, 0.0), 1.0)
            if band:
                if roof:
                    v2 = v2 * frac
                elif tilt:
                    v2 = frac + v2 * pfrac
                else:
                    v2 = frac + pfrac + v2 * (1.0 - frac - pfrac)
            # ⚠ **glTF 匯出端會把 v 翻過來**(glTF 的 UV 原點在左上、Blender 在左下)——
            # 實測已出貨的四顆節點 corr(高度, glTF v) = **−1.0000**,而消費端那張立面貼圖是
            # 我們自己的 `CanvasTexture`(`flipY` 預設 true ⇒ v=0 採到畫布**底部**)⇒
            # 舊制的庫節點立面是**上下顛倒**的:基座暗帶印在屋簷、女兒牆帶與店面遮陽棚
            # 印在地面(方盒那條路走 BoxGeometry 自己的 UV,是正的 ⇒ 同一張圖上兩種方向,
            # 而且沒有任何錯誤訊息)。這裡先在**消費端座標**(v = 高度)算完,存檔前再翻回去。
            uv.data[li].uv = (min(max(u2, 0.0), 1.0), 1.0 - v2)
    if band:
        print(f'UVBANDS {o.name}: {len(me.polygons)} 面,朝上 {up_n} 面 '
              f'({up_n / len(me.polygons) * 100:.1f}%)→ v ∈ [0, {frac}](minz {minz});'
              f'素牆 {tilt_n} 面({tilt_n / len(me.polygons) * 100:.1f}%)→ [{frac}, {frac + pfrac}]'
              f'(wall_ny {wall_ny}、平整門檻 {fdeg}° / 群 ≥ {fmin});'
              f'窗牆 {len(me.polygons) - up_n - tilt_n} 面')
    else:
        print(f'BOXUV {o.name}: {len(me.polygons)} 面重建盒投影 UV')
missing = (BOXUV | set(UVBANDS)) - {o.name.split('.')[0] for o in made}
assert not missing, f'--boxuv / --roofband / --uvbands 指到不存在的節點:{sorted(missing)}'

# 只留產出節點,其他(SF3D 場景空節點等)全刪
for o in list(bpy.data.objects):
    if o not in made:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_yup=True,
    # `export_texcoords` 顯式為真:BOXUV 那幾顆的 UV 是消費端立面貼圖的唯一依據,
    # 而 `export_materials='NONE'` 很容易讓人以為「反正沒材質,UV 也不用留」。
    export_materials='NONE', export_normals=True, export_texcoords=True, export_apply=True,
)
print('WROTE', OUT)
