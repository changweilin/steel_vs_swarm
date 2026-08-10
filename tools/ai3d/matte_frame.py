# 去背產物的**畫布框取**單一縫(2026-08-10 §5au):裁到主體邊界 + 置中方形畫布。
#
# 為什麼要抽出來:`split_targets.py` 把一張多目標的 matte 切成逐目標的 matte,而**切出來的每一張
# 都必須與 `matte_photos.py` 產出的那些長得一模一樣** —— 同樣的留邊比例、同樣的置中規則、同樣的
# 取整方式。下游三個東西全部吃這個形狀:選片閘 ① 的畫布下限(`MIN_CANVAS`,量的就是這個 side)、
# SF3D/T2 的 preprocess(以 alpha bbox 取景),以及人眼複核的 contact sheet。各寫一份的話,兩條路
# 產出的 matte 會有一點點不同的留邊,而症狀是**選片閘的門檻對其中一條路系統性地偏移** —— 沒有錯誤
# 訊息,只表現成「切出來的目標好像比較容易被判太小」。
#
# 紀律:
#   - `PAD_F` / 取整 / 貼上位置 MUST 逐位元同 2026-08-10 之前 `matte_photos.py` 的內嵌算式
#     (`int(max(w,h) * 1.18)`、`(side - w) // 2`)—— 這一支是**抽出**不是重寫,既有 181 張 matte
#     不能因為換了實作就要重做。稽核 `audit_split_targets.py` Ⅰ 拿舊算式逐案例對帳。
#   - 零亂數、零網路;PIL 以外不依賴任何東西(離線稽核要直接 import 它)。
from PIL import Image

PAD_F = 1.18        # 方形畫布邊長 = 主體最長邊 × 此值(≈ 85% 佔幅);改它 = 既有語料全部要重做
ALPHA_SOLID = 128   # 「這一格是主體」的 alpha 門檻;與 screen_mattes.py 的統計同一條線


def subject_bbox(im, thr=ALPHA_SOLID):
    """α>thr 的外接框 (x0, y0, x1, y1);全透明回 None。

    **刻意不是 `Image.getbbox()`** —— 那一支吃的是 α>0,而雜散半透明像素會把框撐出主體之外
    (screen_mattes 檔頭 ②:α>16 的 bbox 會讓四角/填滿率全失真)。裁切用 α>0(留住羽化邊),
    量測用 α>thr,兩者是不同的問題。
    """
    a = im.convert('RGBA').split()[3]
    return a.point(lambda v: 255 if v > thr else 0).getbbox()


def frame(im):
    """裁到主體邊界 + 置中到方形畫布;回 (canvas, origin)。

    全透明(getbbox 回 None)時**不裁切但照樣補邊** —— 那是 2026-08-10 之前的行為,雖然那種
    matte 一定會被選片閘 ① 擋掉,行為還是要一致(這一支是抽出不是重寫)。
    """
    im = im.convert('RGBA')
    bbox = im.getbbox()          # 裁切吃 α>0:羽化邊屬於主體,切掉會在輪廓上留一圈硬邊
    if bbox:
        im = im.crop(bbox)
    side = int(max(im.size) * PAD_F)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    off = ((side - im.width) // 2, (side - im.height) // 2)
    canvas.paste(im, off)
    x0, y0 = (bbox[0], bbox[1]) if bbox else (0, 0)
    # origin = 畫布 (0,0) 在**原座標系**裡的位置 ⇒ 畫布座標 + origin = 原座標。
    # 截斷閘(⑦ 完整度)要問「主體有沒有碰到照片邊框」,而那個資訊在裁切的當下就丟掉了:
    # 回傳它,呼叫端才有辦法把畫布上的任何一點換算回照片座標。
    return canvas, (x0 - off[0], y0 - off[1])
