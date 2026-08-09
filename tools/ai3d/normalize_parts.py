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
#      斜屋頂那一桶再多一條 `--roofband <node>=<frac>`:把朝上的面分到貼圖底部那一帶
#      (單一材質群組換不掉屋頂材質,只好把區分移進 UV),見下方 ROOFBAND。
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
import sys
import math
import random

FIT = 0.95          # 包絡餘裕:縮到 fallback × 0.95(浮點與後續 stretch 都吃不掉契約)

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
ROOFBAND = {}
for spec in opt_all('roofband'):
    rbname, rest = spec.split('=', 1)
    bits = rest.split('|')
    rb_frac = float(bits[0])
    rb_minz = float(bits[1]) if len(bits) > 1 else 0.30
    assert 0.0 < rb_frac < 1.0, f'--roofband {rbname}:frac 要在 (0,1) 之間'
    assert 0.0 < rb_minz < 1.0, f'--roofband {rbname}:minz 要在 (0,1) 之間'
    ROOFBAND[rbname] = (rb_frac, rb_minz)
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
    band = ROOFBAND.get(nm)
    if nm not in BOXUV and not band:
        continue
    me = o.data
    # base 節點本來就帶著上一輪的 UV ⇒ 先清乾淨,否則 `uv_layers.new` 只是加**第二層**
    # (three 取第 0 層 = 舊的那一份),看起來就是「這一輪的 UV 完全沒有生效」
    for old in list(me.uv_layers):
        me.uv_layers.remove(old)
    uv = me.uv_layers.new(name='UVMap')
    frac, minz = band or (0.0, 1.0)
    up_n = 0
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))   # 0=x 1=y 2=z(Blender)
        roof = n.z > minz                             # Blender z = 遊戲 Y
        if roof:
            up_n += 1
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
                v2 = v2 * frac if roof else frac + v2 * (1.0 - frac)
            # ⚠ **glTF 匯出端會把 v 翻過來**(glTF 的 UV 原點在左上、Blender 在左下)——
            # 實測已出貨的四顆節點 corr(高度, glTF v) = **−1.0000**,而消費端那張立面貼圖是
            # 我們自己的 `CanvasTexture`(`flipY` 預設 true ⇒ v=0 採到畫布**底部**)⇒
            # 舊制的庫節點立面是**上下顛倒**的:基座暗帶印在屋簷、女兒牆帶與店面遮陽棚
            # 印在地面(方盒那條路走 BoxGeometry 自己的 UV,是正的 ⇒ 同一張圖上兩種方向,
            # 而且沒有任何錯誤訊息)。這裡先在**消費端座標**(v = 高度)算完,存檔前再翻回去。
            uv.data[li].uv = (min(max(u2, 0.0), 1.0), 1.0 - v2)
    if band:
        print(f'ROOFBAND {o.name}: {len(me.polygons)} 面,朝上 {up_n} 面 '
              f'({up_n / len(me.polygons) * 100:.1f}%)壓進 v ∈ [0, {frac}](minz {minz})')
    else:
        print(f'BOXUV {o.name}: {len(me.polygons)} 面重建盒投影 UV')
missing = (BOXUV | set(ROOFBAND)) - {o.name.split('.')[0] for o in made}
assert not missing, f'--boxuv / --roofband 指到不存在的節點:{sorted(missing)}'

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
