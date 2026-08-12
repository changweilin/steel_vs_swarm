#!/usr/bin/env python3
# ============ 原型參考照的「全身 + 背景乾淨」量測(dev-only)============
# 2026-08-13 使用者:「必須搜索全身照,盡可能背景乾淨,現有的照片不符合條件的也重新搜索」。
#
# 本檔**只量、不判、不寫帳本**:逐張印一行 JSON,由 Node 端(screen_protorefs.mjs)決定
# 要不要判退並寫進帳本。理由是帳本的形狀只准有一份(refstore.mjs 檔頭)—— Python 這邊
# 再寫一份 manifest 的讀寫,兩邊遲早對不上,而症狀是「我明明判退了,採集端還是抓回同一張」。
#
# 三個量測(都刻意是**保守**的:寧可標出來讓人看,也不要靜靜地把好圖丟掉):
#   ① bg_clean  邊框環有多乾淨 = 環上像素落在「主背景色 ± 容差」內的比例。
#                棚拍白底/純色底 ≈ 1.0;草地、街景、雜物背景會明顯掉下來。
#   ② coverage  主體佔畫面的比例(非背景色的像素)。太小 = 主體只有一點點;
#                太大 = 幾乎貼滿(多半是特寫,而特寫看不到全身)。
#   ③ edge_touch 主體壓在邊框上的比例。全身照的主體四周會留白 ⇒ 這個值很小;
#                被裁掉的特寫/局部照則會壓著邊。
# 三個值都不需要辨識「這是什麼動物/機型」—— 那需要模型,而這裡要的只是「構圖對不對」。
#
# 用法:
#   python tools/screen_protorefs.py <圖檔...>            # 逐張印 JSON
#   python tools/screen_protorefs.py --tol 28 <圖檔...>
import json
import sys

from PIL import Image

MAX_SIDE = 256          # 量測用的縮圖邊長(構圖的判斷不需要原解析度,而原圖動輒數千像素)
RING_F = 0.04           # 邊框環的厚度(佔短邊比例)


def measure(path, tol=28):
    im = Image.open(path)
    w0, h0 = im.size
    im = im.convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    w, h = im.size
    px = im.load()
    ring = max(2, int(min(w, h) * RING_F))

    # 主背景色 = 邊框環的**眾數**(取每channel 16 階的直方圖峰;平均值會被雜色拉走)
    bins = {}
    ring_px = []
    for y in range(h):
        for x in range(w):
            if x < ring or y < ring or x >= w - ring or y >= h - ring:
                r, g, b = px[x, y]
                ring_px.append((r, g, b))
                k = (r >> 4, g >> 4, b >> 4)
                bins[k] = bins.get(k, 0) + 1
    if not ring_px:
        return None
    bk = max(bins, key=bins.get)
    sel = [c for c in ring_px if (c[0] >> 4, c[1] >> 4, c[2] >> 4) == bk]
    bg = tuple(sum(c[i] for c in sel) // len(sel) for i in range(3))

    near = lambda c: abs(c[0] - bg[0]) <= tol and abs(c[1] - bg[1]) <= tol and abs(c[2] - bg[2]) <= tol
    bg_clean = sum(1 for c in ring_px if near(c)) / len(ring_px)

    # 主體 = 不像背景色的像素;bbox 與邊框接觸度
    total = w * h
    subj = 0
    x0, y0, x1, y1 = w, h, -1, -1
    touch = 0
    for y in range(h):
        for x in range(w):
            if near(px[x, y]):
                continue
            subj += 1
            x0, y0 = min(x0, x), min(y0, y)
            x1, y1 = max(x1, x), max(y1, y)
            if x < ring or y < ring or x >= w - ring or y >= h - ring:
                touch += 1
    coverage = subj / total
    edge_touch = (touch / subj) if subj else 0.0
    box = [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h] if x1 >= 0 else [0, 0, 0, 0]
    return {
        "px": [w0, h0],
        "bg": list(bg),
        "bg_clean": round(bg_clean, 4),
        "coverage": round(coverage, 4),
        "edge_touch": round(edge_touch, 4),
        "box": [round(v, 4) for v in box],
    }


def main():
    args = sys.argv[1:]
    tol = 28
    if "--tol" in args:
        i = args.index("--tol")
        tol = int(args[i + 1])
        del args[i:i + 2]
    for p in args:
        try:
            m = measure(p, tol)
            print(json.dumps({"file": p, **(m or {"error": "空圖"})}, ensure_ascii=False))
        except Exception as e:                                   # noqa: BLE001
            # 讀不到就講清楚是哪一張(判退與否由 Node 端決定 —— 這裡只負責量)
            print(json.dumps({"file": p, "error": str(e)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
