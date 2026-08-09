# ============ 設計圖 → 3D 外殼(正投影輪廓的視覺外殼;runbook §5ai)============
#
# 使用者 2026-08-09 定案:「**建築部分也加入設計圖轉 3D 的功能,轉 3D 時只要處理外層表面就好**」。
#
# **為什麼這一支不是 img→3D 的另一個模型,而是幾何**:照片給的是「一個視角 + 明暗線索」,
# 深度得用模型猜(§5ag-c 的 hoodoo 就是猜不出厚度而塌成薄板);**設計圖給的是正投影的
# 精確輪廓** —— 立面 = 正面剪影、平面 = 足跡、側視 = 側面剪影。兩個以上的正交剪影決定的
# 視覺外殼(visual hull)是**解出來的**,不是生成出來的:
#   ① 逐視圖取外輪廓 → 多邊形
#   ② 各自沿自己那一軸拉伸成稜柱
#   ③ 稜柱**取交集** = 外殼
# 對建築(直角量體、退縮、斜屋頂)這條路比任何生成模型都準,而且**沒有 GPU、沒有權重、
# 零亂數、離線可驗**。階梯上它排在 T2-spz 之前:**有設計圖就別去猜**。
#
# —— 「只要處理外層表面」是**兩件事**,而它們剛好同一個實作 ——
#   ㋐ **只取最外層那條輪廓線**:設計圖裡滿是內部線條(窗格、樓層線、平面圖的隔間、
#      填充網點、尺寸線)。作法 = 在墨遮罩上取輪廓、挑出建築那一條、**整片填實**。
#      窗戶因此不會變成幾何上的凹洞,樓層線也不會變成溝槽 —— 那些是貼圖的事
#      (消費端 biomes 的立面材質本來就在畫窗格)。
#      這條規則在三處各擋一次(填實 / RETR_EXTERNAL / prism 只吃 exterior),拆掉任一處
#      另兩處還會補上 ⇒ 反向驗證 MUST 三處一起拆(audit 的 `--break-outer` 就是這麼做的)。
#   ㋑ **只有外殼,沒有室內**:視覺外殼天生就是一個閉合的外表面,樓板/隔間/中庭一概不生成。
#   ⇒ 這條規則同時是**三角形預算的主要旋鈕**:不取外輪廓的話,一張立面圖光是窗格就能生出
#      上千個面,而 `mass` 那一桶的逐節點上限是 2,981。
#
# 三個會靜默出錯的地方:
#   ① **輪廓有缺口 ⇒ 泛洪整片漏光**,結果是空網格而不是錯網格。故實體佔比低於 SOLID_MIN
#      直接報錯,MUST NOT 回傳一個空殼讓下游去發現(原則 6:寧缺勿錯,但要出聲)。
#      對策是形態學閉運算 `--close`(把細線的斷點接起來),閉太多會把窗框連成實心。
#   ② **圖框/標題欄/尺寸線也在畫布上**:它們是與建築分離的墨塊 ⇒ 一律**只取最大連通元件**
#      (與選片閘 ④ 同一條 doctrine:一個主體,不是「最大的那幾塊」)。
#   ③ **簡化容差是比例不是像素**:`--simplify` 乘的是該視圖輪廓的周長。寫死像素值的話,
#      換一張解析度不同的圖,同一個數字會從「保留退縮」變成「把整棟磨成方塊」。
#
# 軸的約定(遊戲座標,y 向上;與 normalize_parts.py 的包絡語意一致):
#   front 立面:圖 x → 世界 x、圖 y(上下翻)→ 世界 y、沿 **z** 拉伸
#   side  側視:圖 x → 世界 z、圖 y(上下翻)→ 世界 y、沿 **x** 拉伸
#   plan  平面:圖 x → 世界 x、圖 y → 世界 **z**、沿 **y** 拉伸
# 只給一張 front 時,深度取 `--depth`(預設 = 正面寬 × DEPTH_F)—— 那是**假設**不是量測,
# 故一律印出來;有 plan 或 side 就不會用到它。
#
# 環境:trimesh + shapely + manifold3d + opencv + numpy 的 venv
# (3060 機上現成的家 = Documents\study\TRELLIS.2-stableprojectorz\.venv;MUST NOT 進 package.json,A2)
#
# 管線位置(與 img→3D 那條路在 normalize 之前會合,下游完全共用):
#   設計圖 → **本支** → raw GLB → normalize_parts.py(置中/縮進包絡/剝材質)→ {family}.glb → intake_parts.mjs
#
# 用法:
#   python tools/ai3d/plan_to_mesh.py --front elev.png --out out.glb
#   python tools/ai3d/plan_to_mesh.py --front elev.png --side side.png --plan plan.png --out out.glb
#   python tools/ai3d/plan_to_mesh.py --front elev.png --debug out_dbg/   # 逐視圖存輪廓圖
import argparse
import os
import sys

import cv2
import numpy as np
import shapely.geometry as sg
import trimesh

# 繁中 Windows 主控台預設 cp950。**stderr 也要**:報錯訊息走的是 stderr,只設 stdout 的話
# 每一句「這看起來是渲染圖」都會變成亂碼(§5ae-f 那個坑的同一族)。
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, 'reconfigure'):
        _s.reconfigure(encoding='utf-8', errors='replace')

INK = 0.72          # 二值化:灰階 < INK×255 視為墨(設計圖是白底線稿)
SOLID_MIN = 0.02    # 外輪廓圍出來的實體佔畫布比例下限(低於此 = 輪廓有缺口)
FRAME_MAX = 0.70    # 大於這個比例的輪廓視為**圖框**(還剩得下候選時才淘汰)
LINEART_INK = 0.25  # 輪廓**內**的墨密度上限:線稿 ≤ 這個數,渲染圖遠高於它(見下)
DEPTH_F = 0.55      # 只有一張立面時的深度假設(× 正面寬);有 plan/side 就用不到
SIMPLIFY = 0.004    # 多邊形簡化容差(× 該輪廓周長)
CLOSE_PX = 3        # 形態學閉運算核(接起細線的斷點)
ALLOW_RENDER = False  # --allow-render:明知是渲染圖也要硬跑(模組層旗標,見 main())


def outer_mask(path, close_px=CLOSE_PX):
    """一張正投影圖 → 只含**建築外輪廓內部**的布林遮罩。

    matte(有意義的 alpha)直接吃 alpha;線稿走「墨 → 閉運算 → **取輪廓 → 整片填實**」。

    ⚠ **MUST NOT 用「從畫布邊界泛洪、淹不到的算實體」** —— 那是最直覺的寫法,而**每一張
    真的設計圖都有圖框**:圖框把整張紙圍起來 ⇒ 泛洪只淹到圖框外面 ⇒ 圖框內的所有留白
    連同建築變成一整塊,量到的外廓是**那張紙**不是那棟樓(合成測試實測寬度 0.6678 → 0.7366,
    而網格看起來完全正常)。改成「挑輪廓」之後圖框只是**另一個候選輪廓**,靠 FRAME_MAX 淘汰。
    填實那一步同時就是「只取外層表面」:輪廓**內部**的線條(窗、樓層線、隔間)一律被填掉。
    """
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f'讀不到圖:{path}')
    h, w = im.shape[:2]
    canvas = float(h * w)
    if im.ndim == 3 and im.shape[2] == 4 and im[:, :, 3].min() < 250:
        solid = (im[:, :, 3] > 128).astype(np.uint8)
        n, lab, stats, _ = cv2.connectedComponentsWithStats(solid, 8)
        if n <= 1:
            raise SystemExit(f'{os.path.basename(path)}:alpha 裡找不到主體')
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        mask = lab == big
        how, drop = 'alpha', 1.0 - mask.sum() / max(1, solid.sum())
    else:
        g = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2GRAY) if im.ndim == 3 else im
        ink = (g < INK * 255).astype(np.uint8)
        if close_px > 0:
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px))
            ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, k)
        cnts, _ = cv2.findContours(ink, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            raise SystemExit(f'{os.path.basename(path)}:圖上沒有任何線條')
        areas = [cv2.contourArea(c) for c in cnts]
        # 圖框 = 幾乎與整張紙同大的那個輪廓。**只有還剩得下候選時才淘汰它** ——
        # 建築本身佔滿整張紙的圖是合法的,不能因為「大」就把它當圖框丟掉。
        keep = [(a, c) for a, c in zip(areas, cnts) if a <= FRAME_MAX * canvas]
        framed = len(keep) < len(cnts)
        if not keep:
            keep = list(zip(areas, cnts))
            framed = False
        best = max(keep, key=lambda t: t[0])[1]
        mask = np.zeros((h, w), np.uint8)
        cv2.drawContours(mask, [best], -1, 1, cv2.FILLED)        # 填實 = 內部線條全數忽略
        mask = mask.astype(bool)
        how = 'ink+contour' + ('(已剔除圖框)' if framed else '')
        drop = 1.0 - cv2.contourArea(best) / max(1e-9, max(areas))
        # **線稿 vs 渲染圖**:這條路吃的是「輪廓 = 幾何」,而水彩/鉛筆渲染圖的墨是**調子**不是輪廓
        # ⇒ 門檻會把陰影一起吃進來、剪影邊緣碎掉、亮處變成洞(實測 CC0 六張:HABS 測繪線稿
        # 輪廓內墨密度 11.4%,而四張渲染圖 32~71%,穹頂那張的玫瑰窗直接變成一個貫穿的洞)。
        # 這種輸入**不會報錯,只會安靜地給你一個爛剪影** ⇒ 擋下來並要求顯式覆寫。
        # ⚠ 順序:先驗「輪廓圍不圍得起來」再驗「是不是渲染圖」。反過來的話,一條斷掉的線
        # 其遮罩就是那條線本身 ⇒ 墨密度 100% ⇒ 報成「這是渲染圖」,把人指到錯的方向。
        if float(mask.mean()) < SOLID_MIN:
            raise SystemExit(f'{os.path.basename(path)}:外輪廓只圍出 {mask.mean():.3%} 的畫布 —— '
                             f'輪廓多半有缺口,試著加大 --close(現在是 {close_px})')
        dens = float(ink[mask].mean()) if mask.any() else 1.0
        if dens > LINEART_INK and not ALLOW_RENDER:
            raise SystemExit(
                f'{os.path.basename(path)}:輪廓內墨密度 {dens:.1%} > {LINEART_INK:.0%} —— '
                f'這看起來是**渲染圖**不是線稿測繪圖。渲染圖的墨是調子,剪影會碎掉;'
                f'請換一張線稿(HABS/measured drawing 那一類),或加 --allow-render 硬跑')
        how += f'・墨密度 {dens:.1%}'
    frac = float(mask.mean())
    if frac < SOLID_MIN:
        raise SystemExit(f'{os.path.basename(path)}:外輪廓只圍出 {frac:.3%} 的畫布 —— '
                         f'輪廓多半有缺口,試著加大 --close(現在是 {close_px})')
    return mask, f'{how}・實體 {frac:.1%}・最大候選外的墨塊剔除 {drop:.1%}'


def mask_polygon(mask, simplify=SIMPLIFY):
    """遮罩 → 簡化後的外輪廓多邊形(影像座標,y 向下)。只取外輪廓,**不取洞**。"""
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cnts, key=cv2.contourArea)
    eps = simplify * cv2.arcLength(c, True)
    ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(np.float64)
    if len(ap) < 3:
        raise SystemExit('簡化後不足三點 —— --simplify 太大')
    poly = sg.Polygon(ap)
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.geom_type == 'MultiPolygon':
            poly = max(poly.geoms, key=lambda g: g.area)
    return poly, len(ap)


def prism(poly, mask_shape, axis, span, scale):
    """多邊形 → 沿 `axis` 貫穿 span 的稜柱(世界座標,y 向上、以原點為中心)。

    影像 y 一律翻轉(圖上往下 = 世界往下);拉伸方向給足夠長度,交集會把它切到位。
    """
    h, w = mask_shape
    xs, ys = np.array(poly.exterior.coords).T
    u = (xs - w / 2) * scale
    v = (h / 2 - ys) * scale                      # 翻轉:圖 y 向下 → 世界向上
    m = trimesh.creation.extrude_polygon(sg.Polygon(np.c_[u, v]), height=span)
    m.apply_translation((0, 0, -span / 2))        # 拉伸後置中(extrude 是 0→height)
    if axis == 'z':                               # front:平面 = xy,拉伸 z —— 已是這樣
        pass
    elif axis == 'x':                             # side:平面 = zy,拉伸 x
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, (0, 1, 0)))
    elif axis == 'y':                             # plan:平面 = xz,拉伸 y
        m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, (1, 0, 0)))
    return m


def build(front=None, side=None, plan=None, depth=None, simplify=SIMPLIFY, close_px=CLOSE_PX,
          debug=None, log=print):
    """正交視圖 → 視覺外殼。至少要有 front 或 plan。回 (mesh, 診斷 dict)。"""
    views = [('front', front, 'z'), ('side', side, 'x'), ('plan', plan, 'y')]
    views = [(n, p, a) for n, p, a in views if p]
    if not views:
        raise SystemExit('至少要給一張 --front / --side / --plan')
    info = {'views': []}

    # 尺度:以 front(沒有就用第一張)的**高度**當 1.0,其餘視圖照自己的像素比例對齊。
    ref = next((v for v in views if v[0] == 'front'), views[0])
    ref_mask, ref_note = outer_mask(ref[1], close_px)
    ref_h = np.ptp(np.where(ref_mask)[0]) + 1
    scale = 1.0 / ref_h

    parts = []
    cache = {ref[1]: (ref_mask, ref_note)}
    for name, path, axis in views:
        mask, note = cache.get(path) or outer_mask(path, close_px)
        poly, nv = mask_polygon(mask, simplify)
        span = 4.0 / scale                        # 貫穿用:比任何視圖都長,交集會切齊
        parts.append((name, prism(poly, mask.shape, axis, span, scale)))
        info['views'].append({'view': name, 'file': os.path.basename(path), 'note': note, 'poly_pts': nv})
        log(f'  {name:5s} {os.path.basename(path)[:34]:34s} {note}・輪廓 {nv} 點')
        if debug:
            os.makedirs(debug, exist_ok=True)
            cv2.imwrite(os.path.join(debug, f'{name}_mask.png'), (mask * 255).astype(np.uint8))

    if len(parts) == 1 and parts[0][0] == 'front':
        # 只有立面:深度是**假設**不是量測 ⇒ 一律講出來
        wcoords = np.array(list(sg.Polygon(parts[0][1].vertices[:, :2]).exterior.coords)) if False else None
        wide = float(np.ptp(parts[0][1].vertices[:, 0]))
        d = depth if depth else wide * DEPTH_F
        info['depth_assumed'] = round(d, 4)
        log(f'  ⚠ 只有一張立面 ⇒ 深度用**假設值** {d:.3f}(= 正面寬 {wide:.3f} × {DEPTH_F});'
            f'有平面圖或側視就不會用到它')
        slab = trimesh.creation.box((wide * 4, wide * 4, d))
        mesh = parts[0][1].intersection(slab)
    else:
        mesh = parts[0][1]
        for _, p in parts[1:]:
            mesh = mesh.intersection(p)

    if mesh.is_empty or len(mesh.faces) == 0:
        raise SystemExit('稜柱交集是空的 —— 各視圖的輪廓對不起來(檢查是不是同一棟、同一個比例)')
    mesh.apply_translation(-mesh.bounding_box.centroid)
    info.update(faces=len(mesh.faces), verts=len(mesh.vertices),
                watertight=bool(mesh.is_watertight), components=int(mesh.body_count),
                extent=[round(float(x), 4) for x in mesh.extents])
    return mesh, info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--front'), ap.add_argument('--side'), ap.add_argument('--plan')
    ap.add_argument('--out', default=None)
    ap.add_argument('--depth', type=float, default=None)
    ap.add_argument('--simplify', type=float, default=SIMPLIFY)
    ap.add_argument('--close', type=int, default=CLOSE_PX)
    ap.add_argument('--debug', default=None)
    ap.add_argument('--allow-render', action='store_true',
                    help='明知輸入是渲染圖(非線稿)也要硬跑 —— 剪影多半會碎')
    a = ap.parse_args()
    globals()['ALLOW_RENDER'] = a.allow_render
    mesh, info = build(a.front, a.side, a.plan, a.depth, a.simplify, a.close, a.debug)
    print(f"out: {info['faces']} 面 / {info['verts']} 點 / 元件 {info['components']} / "
          f"watertight {info['watertight']} / 外廓 {info['extent']}")
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        mesh.export(a.out)
        print(f'wrote {a.out}')


if __name__ == '__main__':
    main()
