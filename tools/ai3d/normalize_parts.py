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
#
# 用法(Blender 5.x;欄位分隔用 `|` —— `:` 會撞上 Windows 磁碟機代號):
#   blender --background --python tools/ai3d/normalize_parts.py -- \
#     --out public/assets/models/parts/rock.glb \
#     --node "collapse_a=<src.glb>|1.5|1000[|ry_deg[|dy]]" --node "facet_a=<src.glb>|1.15|900" ...
#   dy = 縮放後的縱向平移(m):實拍岩體常比 fallback ico 扁,置中會讓消費端算好的
#        底面懸空 —— 基座件用 dy 沉到「底 = −消費端 p.y」貼地(仍 MUST 收在包絡內)。
#   目標欄寫 "r"(等比,岩族原行為逐位元不變)或 "r x hy"(如 "3.0x5.0" = 非等向:
#   水平、縱向各自縮到包絡 × FIT)。非等向是給樹冠/板根用的:樹冠 fallback 是 ico 球,
#   而實拍樹冠天生比球扁 —— 等比縮的話填不滿縱向,零件表的 sy 再壓一次就成薄餅;
#   拉滿球包絡後,消費端 sy 壓出來的比例才與舊 ico 同款(板根同理:cone 的 r 與 h/2 差很遠)。
import bpy
import sys
import math

FIT = 0.95          # 包絡餘裕:縮到 fallback × 0.95(浮點與後續 stretch 都吃不掉契約)

argv = sys.argv[sys.argv.index('--') + 1:]


def opt_all(name):
    return [argv[i + 1] for i, a in enumerate(argv) if a == f'--{name}']


OUT = opt_all('out')[0]
NODES = []          # (node_name, src_glb, target_r, target_hy|None, tri_cap, ry_deg, dy)
for spec in opt_all('node'):
    name, rest = spec.split('=', 1)
    bits = rest.split('|')
    tr, thy = (bits[1].split('x') + [None])[:2] if 'x' in bits[1] else (bits[1], None)
    NODES.append((name, bits[0], float(tr), float(thy) if thy else None, int(bits[2]),
                  float(bits[3]) if len(bits) > 3 else 0.0,
                  float(bits[4]) if len(bits) > 4 else 0.0))

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
for (name, src, target_r, target_hy, tri_cap, ry_deg, dy) in NODES:
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
        ob.rotation_euler = (0.0, 0.0, math.radians(ry_deg))   # Blender Z-up;匯出時轉 glTF Y-up
        bpy.ops.object.transform_apply(rotation=True)

    # ③ 減面(先減後量:減面本身會微動外廓)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > tri_cap:
        mod = ob.modifiers.new('dec', 'DECIMATE')
        mod.ratio = tri_cap / tris * 0.98
        bpy.ops.object.modifier_apply(modifier='dec')

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

    # ④ 剝材質 / UV / 色彩屬性
    ob.data.materials.clear()
    for uv in list(ob.data.uv_layers):
        ob.data.uv_layers.remove(uv)
    for ca in list(ob.data.color_attributes):
        ob.data.color_attributes.remove(ca)

    tris_fin = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'NODE {name}: tris={tris_fin} r={r_fin:.3f}/{target_r} zspan={z_max * s_z:.3f}/{hy}')
    made.append(ob)

# 只留產出節點,其他(SF3D 場景空節點等)全刪
for o in list(bpy.data.objects):
    if o not in made:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_yup=True,
    export_materials='NONE', export_normals=True, export_apply=True,
)
print('WROTE', OUT)
