# ============ 設計圖 → 3D 外殼稽核(plan_to_mesh.py 的離線驗證;runbook §5ai)============
#
# 這一支能存在的理由,正是設計圖與照片的差別:**期望答案是算得出來的**。
# 一張合成立面圖的剪影是幾何,不是「看起來像不像」⇒ 每一條斷言都拿得出數字
# (面數 / 外廓 / 體積 / 尤拉示性數),不需要人眼、不需要 GPU、不需要網路。
# 對照組是**同一棟樓的兩張圖**(有窗 vs 無窗、有圖框 vs 無圖框)——
# 使用者定案的那條規則(「轉 3D 時只要處理外層表面就好」)因此變成一條可以紅字的斷言:
# 兩張圖 MUST 生出**逐位元相同**的網格。
#
# 用法(3060 機上的 venv:Documents\study\TRELLIS.2-stableprojectorz\.venv):
#   python tools/ai3d/audit_plan_mesh.py
#   python tools/ai3d/audit_plan_mesh.py --break-outer   # 反向:把「只取外層輪廓」三處一起拆
#   python tools/ai3d/audit_plan_mesh.py --break-frame   # 反向:不淘汰圖框輪廓
#
# ⚠ `--break-outer` MUST 三處一起拆(填實 / RETR_EXTERNAL / prism 只吃 exterior)——
#    只拆前兩處,第三處會把洞再吃掉一次 ⇒ 窗戶版仍是 12 面盒 = **反向驗證假綠**(實測)。
import argparse
import importlib.util
import os
import sys
import tempfile

import cv2
import numpy as np

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('p2m', os.path.join(HERE, 'plan_to_mesh.py'))
p2m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p2m)

ap = argparse.ArgumentParser()
ap.add_argument('--break-outer', action='store_true')
ap.add_argument('--break-frame', action='store_true')
A = ap.parse_args()

if A.break_frame:
    p2m.FRAME_MAX = 1e9                       # 圖框不再被當圖框
if A.break_outer:
    # 反向:把「只取外輪廓」拿掉 —— 改成連內部的洞一起收(RETR_CCOMP + shapely 的 holes)。
    # 這就是使用者那句話的反面:窗與樓層線變成真的幾何空洞。
    import shapely.geometry as _sg
    _poly = p2m.mask_polygon

    def _holed(mask, simplify=p2m.SIMPLIFY):
        cnts, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        areas = [cv2.contourArea(c) for c in cnts]
        oi = int(np.argmax(areas))

        def simp(c):
            return cv2.approxPolyDP(c, simplify * cv2.arcLength(c, True), True).reshape(-1, 2).astype(float)
        shell = simp(cnts[oi])
        if len(shell) < 4:                    # 退化輪廓(Ⅶ 的缺口案例)⇒ 交回真品,讓它照常報錯
            return _poly(mask, simplify)
        holes = [simp(c) for i, c in enumerate(cnts)
                 if i != oi and hier[0][i][3] == oi and len(simp(c)) >= 4]
        poly = _sg.Polygon(shell, holes)
        if not poly.is_valid:
            poly = poly.buffer(0)
        return poly, len(shell)
    p2m.mask_polygon = _holed

    _fill = p2m.outer_mask

    def _nofill(path, close_px=p2m.CLOSE_PX):
        """遮罩 = **墨本身**(不填實)⇒ 被線條圍起來的白全都成了洞。
        這才是那條規則真正的反面:窗與樓層線之間的空白變成幾何上的空洞。"""
        im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        g = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2GRAY) if im.ndim == 3 else im
        ink = (g < p2m.INK * 255).astype(np.uint8)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px))
        return cv2.morphologyEx(ink, cv2.MORPH_CLOSE, k).astype(bool), 'break-outer'
    p2m.outer_mask = _nofill

    # 「只取外層表面」在真品裡由**三處**共同保證,而最後一道才是決定性的:
    #   ① outer_mask 把輪廓填實 ② mask_polygon 走 RETR_EXTERNAL ③ prism 只吃 poly.exterior
    # 只拆前兩處,③ 會把洞再吃掉一次 ⇒ 反向驗證會**假綠**(實測:窗戶版仍是 12 面盒)。
    def _prism_holes(poly, mask_shape, axis, span, scale):
        import trimesh as _tm
        h, w = mask_shape

        def xf(c):
            a = np.array(c)
            return np.c_[(a[:, 0] - w / 2) * scale, (h / 2 - a[:, 1]) * scale]
        p2 = _sg.Polygon(xf(poly.exterior.coords), [xf(r.coords) for r in poly.interiors])
        m = _tm.creation.extrude_polygon(p2, height=span)
        m.apply_translation((0, 0, -span / 2))
        if axis == 'x':
            m.apply_transform(_tm.transformations.rotation_matrix(np.pi / 2, (0, 1, 0)))
        elif axis == 'y':
            m.apply_transform(_tm.transformations.rotation_matrix(-np.pi / 2, (1, 0, 0)))
        return m
    p2m.prism = _prism_holes

D = tempfile.mkdtemp()
OK = FAIL = 0


def chk(name, cond, got=''):
    global OK, FAIL
    if cond:
        OK += 1
        print(f'  ✅ {name}  {got}')
    else:
        FAIL += 1
        print(f'  ❌ {name}  {got}')


def draw(name, fn, w=600, h=800):
    img = np.full((h, w), 255, np.uint8)
    fn(img)
    p = os.path.join(D, name)
    cv2.imwrite(p, img)
    return p


def elev_windows(img):
    """方樓立面 + 6×10 格窗 + 樓層線 —— 內部線條是雜訊,不該變成幾何。"""
    cv2.rectangle(img, (100, 100), (500, 700), 0, 3)
    for r in range(10):
        y = 130 + r * 56
        cv2.line(img, (105, y), (495, y), 0, 1)
        for c in range(6):
            x = 118 + c * 62
            cv2.rectangle(img, (x, y + 8), (x + 40, y + 40), 0, 2)


def elev_plain(img):
    cv2.rectangle(img, (100, 100), (500, 700), 0, 3)


def elev_setback(img):
    pts = np.array([[100, 700], [100, 200], [300, 200], [300, 100], [500, 100], [500, 700]])
    cv2.polylines(img, [pts], True, 0, 3)


def plan_rect(img):
    cv2.rectangle(img, (150, 250), (450, 550), 0, 3)


def sheet(img):
    """真的設計圖長這樣:圖框 + 標題欄 + 尺寸線,建築在中間。"""
    cv2.rectangle(img, (100, 100), (500, 700), 0, 3)
    cv2.rectangle(img, (20, 20), (580, 780), 0, 2)
    cv2.rectangle(img, (380, 720), (570, 770), 0, 2)
    cv2.line(img, (60, 100), (60, 700), 0, 1)


B = dict(log=lambda *_: None)
print('— Ⅰ 只取外層表面:窗 / 樓層線 MUST NOT 變成幾何 —')
win, i_win = p2m.build(front=draw('win.png', elev_windows), **B)
plain, i_pl = p2m.build(front=draw('plain.png', elev_plain), **B)
chk('有窗 vs 無窗:面數相同', i_win['faces'] == i_pl['faces'], f"{i_win['faces']} vs {i_pl['faces']}")
chk('有窗 vs 無窗:外廓相同', i_win['extent'] == i_pl['extent'], f"{i_win['extent']}")
chk('方樓 = 12 面盒', i_win['faces'] == 12, f"{i_win['faces']} 面")
chk('watertight 單元件', i_win['watertight'] and i_win['components'] == 1)

print('\n— Ⅱ 只有外殼:沒有室內幾何 —')
chk('體積 = 自身凸包(凸量體 ⇒ 無內部面/空洞)',
    abs(win.volume - win.convex_hull.volume) / win.volume < 1e-9,
    f'{win.volume:.6f} vs {win.convex_hull.volume:.6f}')
chk('尤拉示性數 = 2(單一閉合外表面)', win.euler_number == 2, str(win.euler_number))

print('\n— Ⅲ 圖框 / 標題欄 / 尺寸線 MUST 被剔掉 —')
sh, i_sh = p2m.build(front=draw('sheet.png', sheet), **B)
chk('有圖框 vs 無圖框:外廓相同', i_sh['extent'] == i_pl['extent'], f"{i_sh['extent']} vs {i_pl['extent']}")
chk('有圖框 vs 無圖框:面數相同', i_sh['faces'] == i_pl['faces'], f"{i_sh['faces']} vs {i_pl['faces']}")

print('\n— Ⅳ 視覺外殼:兩個正交剪影決定量體 —')
hull, i_h = p2m.build(front=draw('setback.png', elev_setback), plan=draw('plan.png', plan_rect), **B)
chk('退縮立面 × 方平面 ⇒ 比盒複雜', i_h['faces'] > 12, f"{i_h['faces']} 面")
chk('watertight 單元件', i_h['watertight'] and i_h['components'] == 1)
chk('高度正規化 = 1.0(以 front 全高為 1)', abs(hull.extents[1] - 1.0) < 0.02, f'{hull.extents[1]:.4f}')
chk('深度由平面圖決定 300/600', abs(hull.extents[2] - 0.5) < 0.02, f'{hull.extents[2]:.4f}')
chk('寬度被平面圖夾住 300/600', abs(hull.extents[0] - 0.5) < 0.02, f'{hull.extents[0]:.4f}')

print('\n— Ⅴ 只有立面時,深度是假設而且 MUST 講出來 —')
one, i_one = p2m.build(front=draw('plain2.png', elev_plain), **B)
chk('回報 depth_assumed', 'depth_assumed' in i_one, str(i_one.get('depth_assumed')))
dep, _ = p2m.build(front=draw('plain3.png', elev_plain), depth=0.25, **B)
chk('--depth 覆寫生效', abs(dep.extents[2] - 0.25) < 1e-6, f'{dep.extents[2]:.4f}')

print('\n— Ⅵ 決定性 + 解析度無關 —')
again, _ = p2m.build(front=draw('plain4.png', elev_plain), **B)
chk('同輸入逐位元相同', np.array_equal(np.sort(one.vertices, 0), np.sort(again.vertices, 0)))
big, i_big = p2m.build(front=draw('big.png', lambda im: cv2.rectangle(im, (200, 200), (1000, 1400), 0, 6),
                                  w=1200, h=1600), **B)
chk('2× 解析度的方樓仍是 12 面(簡化容差是比例)', i_big['faces'] == 12, f"{i_big['faces']} 面")

print('\n— Ⅶ-b 渲染圖 MUST 被擋下(它不會報錯,只會安靜地給一個爛剪影) —')


def rendered(img):
    """水彩/鉛筆渲染圖的樣子:輪廓內大面積是調子,不是線條。"""
    cv2.rectangle(img, (100, 100), (500, 700), 90, -1)
    cv2.rectangle(img, (100, 100), (500, 700), 0, 3)


try:
    p2m.build(front=draw('render.png', rendered), **B)
    chk('渲染圖被擋下', False, '沒有報錯')
except SystemExit as ex:
    chk('渲染圖被擋下', '渲染圖' in str(ex), str(ex)[:44])
p2m.ALLOW_RENDER = True
try:
    _, i_r = p2m.build(front=draw('render2.png', rendered), **B)
    chk('--allow-render 可硬跑', i_r['faces'] > 0, f"{i_r['faces']} 面")
finally:
    p2m.ALLOW_RENDER = False
chk('線稿不被誤擋(同一棟樓的線稿版照過)', i_pl['faces'] == 12, f"{i_pl['faces']} 面")

print('\n— Ⅶ 輪廓有缺口 MUST 出聲,不可回空殼 —')
try:
    p2m.build(front=draw('gap.png', lambda im: cv2.line(im, (100, 100), (500, 100), 0, 2)), **B)
    chk('缺口輪廓報錯', False, '沒有報錯')
except SystemExit as ex:
    chk('缺口輪廓報錯(且指到「缺口」而不是「渲染圖」)', '缺口' in str(ex), str(ex)[:56])

print(f'\n{"🎉" if not FAIL else "❌"} 設計圖 → 3D 外殼稽核:通過 {OK} 項,失敗 {FAIL} 項')
sys.exit(1 if FAIL else 0)
