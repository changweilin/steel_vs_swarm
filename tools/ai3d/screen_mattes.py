# 選片閘(runbook 佇列 F0):matte 的統計淘汰 + 人眼判決,結論回寫 photo_manifest.json。
#
# 為什麼需要這一支:fetch_photos.mjs 的兩道閘(CC0/PD 授權 + 短邊 ≥1024)比對的是圖庫的
# **文字後設資料**,擋不住「這張是不是一棵完整的樹」。2026-08-07 把既有 82 張 tree 族 matte
# 一次攤開(out_sheets/tree_mattes.png),人眼分桶:剝空/主體太小 ~25、葉片特寫/標本 ~11、
# 古書掃描/版畫/明信片 ~13、主體不是樹 ~9、含遊客 2,真正可用的全身單株只有 ~16~18 張
# ⇒ 語料庫是「污染」不是「不足」,再抓一輪只會等比例再抓進 4/5 的垃圾。
#
# 四個桶裡三個有便宜的統計特徵(runbook F0),本閘只做這三桶;「不是樹」與「含人」
# **沒有便宜的統計特徵,MUST 留給人眼**(photo_sheet.mjs / --sheet 的倖存者 sheet),
# 人眼判決以 --human 回寫,MUST NOT 想用 fill 之類的尺代勞(§5n 的教訓)。
#
# 門檻是拿 82 張既有 matte 校準出來的(2026-08-07;硬約束 = 人眼已判可用的 16 張零誤殺):
#   ① 剝空/主體太小:整畫布 α>128 覆蓋率 < BLANK_COV(0.05;可用 16 張的最低值 0.100 = 2× 邊際)
#      或畫布最長邊 < MIN_CANVAS(300px;matte_photos.py 的畫布 = 主體 bbox × 1.18 ⇒ 畫布小
#      = 主體在 ≥1024 的原圖裡只佔一角;可用 16 張最小畫布 481px)。實測抓 27 張,對上人眼 ~25。
#   ② 平面印刷品:主體 bbox(α>128)內填滿率 ≥ PRINT_FILL(0.85)——「主體是一張紙」;
#      樹再茂密也留得下輪廓縫(可用 16 張的最高填滿率 0.643)。四角不透明改成輔助訊號不當
#      硬條件:雜散半透明像素會把 α>16 的 bbox 撐出紙外,角落落在透明區(82 張實測全 0)。
#      實測抓 10 張(#7/30/32/37/41/43/44/61/62/70),全數確為掃描/畫作/明信片。
#   ③ 葉片標本:覆蓋率 ≥ SPEC_COV(0.28)∧ 長寬比 ∈ SPEC_ASP(0.8~1.3)∧ 原圖邊框
#      std ≤ SPEC_BSTD(20,背景純色)。三條缺一不可:大橡樹 #16(cov 0.393、asp 1.05)靠
#      bstd 62.5 安全;白描猴麵包樹 #58/60(bstd 0.8/8.0,人眼判可用)靠 asp 1.40 安全。
#      實測抓 3 張葉片特寫(#71/74/75);herbarium 壓葉標本(#6/8/9/10)邊緣有比例尺與標籤、
#      統計上抓不乾淨,刻意留給人眼。
#
# ⚠ **①的 cov 與 ② 的 fill 是 tree 專用,MUST NOT 原樣套到別族**(2026-08-09 實測,
#    硬約束改用「已經出貨的 25 張來源」當真品名單):兩條門檻都是拿 82 張 tree matte 校準的,
#    而它們各自內建了一個「樹長什麼樣」的假設。
#      ① cov:樹是密實團塊,桁架水塔與細長石柱不是 ⇒ 全族套下去誤殺 **3 張已出貨來源**
#         (landmark/tank `ov_6d02b9e0` 0.024、`ov_15922084` 0.092、rock/mg_tower
#         `ov_163a0902` 0.034 = 魔鬼塔那顆)。畫布下限 MIN_CANVAS 量的是「主體在原圖裡多大」,
#         與主體形狀無關 ⇒ 那一半全族通用。
#      ② fill:「主體是一張紙」的前提是主體本身留得下輪廓縫 —— 而**建物就是個方盒**,
#         bbox 填滿率天生接近 1(建物族已出貨最高 0.909,tree 只有 0.765)⇒ 0.85 誤殺
#         building/roofcap `ov_f18913fc`。別族改用 PRINT_FILL_OTHER(0.93,零誤殺)。
#    兩條在非校準族**降級成觀察線**(watched()),MUST NOT 直接放棄:它們抓的東西在那些族
#    照樣存在(1932 年畢業紀念冊封面 fill 0.854、舊 hoodoo 那張 cov 0.016),只是統計上
#    分不開真品與紙 ⇒ 交給人眼,而不是靜默放過。
#    順帶一提:「主體太小」在跨族上**沒有乾淨的統計特徵** —— 本輪 hoodoo 的贏家 `ov_929bc3d9`
#    畫布只有 588px(主體在 2816×2112 原圖裡佔一小塊)卻是四族裡最好的一顆,而輸家
#    `wc_112762573` 畫布 1590px、cov 0.016。兩張各贏一項,單一門檻分不開它們。
#
# —— 2026-08-09 使用者定案:「挑選的照片盡可能乾淨,只有目標物件無其他物件,且光源充足」——
#   ④ **多主體**:matte 最大連通元件佔全體 α>128 面積 < MULTI_MAIN(0.70)⇒ 淘汰。
#      「只有目標物件」量在 **matte** 上而不是照片上:本輪 hoodoo 的贏家原圖有三顆蘑菇岩
#      加電線桿,而去背只留下一顆(main 0.984)—— 照片髒不等於輸入髒。
#      門檻校準(244 張 matte × 25 張已出貨來源):已出貨最低 0.778(landmark/tank 的桁架腿
#      會被切成幾塊)⇒ 0.70 留 10% 邊際,**零誤殺**,淘汰 28 張。
#   ⑤ **光源不足**:主體像素平均亮度 < LUM_MIN(35)**且** 暗部佔比 ≥ DARK_FRAC(0.70)⇒ 淘汰。
#      兩條 AND 是必要的:深色玄武岩在好光下也是低亮度,只看平均會把它連坐;真正的欠曝是
#      「又暗又整片壓在暗部」。已出貨最低 lum 43.5 / 最高 dark 0.632 ⇒ 兩邊各留 ~11~24% 邊際,
#      **零誤殺**,淘汰 13 張。
#   ④⑤ 之間還有一段統計分不開的帶(本輪實例:熱氣球那張 main 0.760,而已出貨的水塔 0.778)
#      ⇒ **不淘汰,進觀察名單 sheet**(`*_watch.png`,格子標上 main/lum),交給人眼。
#      把門檻收到 0.77 去「剛好」抓到熱氣球就是拿兩個樣本過擬合,而代價是誤殺真品。
#
# —— 2026-08-10 使用者定案:「同一張照片可能有好幾個目標,圈選目標,分離,篩選太模糊 / 太小 /
#    完整度太低的,再進入 img to 3D 管線」(§5au)——
#   **判決的單位從「一張照片」變成「一個目標」**:`split_targets.py` 先把多目標的 matte 切成
#   `out/targets/<fam>/<part>/<id>~n.png`,本閘就逐目標各判一次,回寫 `entry.targets[i].screen`;
#   `entry.screen`(fetch_photos 的 have() 與 harvest_loop 都讀它)= **只要還有一個目標活著就 pass**。
#   沒被切的照片一切照舊、逐位元不變 —— 切出來的檔案是額外的,母 matte 永遠留在原地。
#   三個篩選條件裡「太小」**不是新的閘**:①的 `MIN_CANVAS` 量的就是「這個主體在原圖裡有多大」,
#   切開之後它自動變成逐目標的量(一張五顆遠景石頭的照片 ⇒ 五個 200px 目標 ⇒ 五個都判太小),
#   多寫一條就是第二把尺。新的只有兩條:
#   ⑥ **太模糊**:主體切出來、長邊**縮**到 512(只縮不放)、對亮度取 Laplacian,再除以主體亮度
#      標準差 ⇒ `sharp`。三個地方會讓這把尺量錯,全部踩過:
#        ㋐ **MUST 只縮不放**:一個 54px 的小主體放大到 512 一定糊,而那是「太小」不是「太模糊」
#           —— 已出貨的 canopy `ov_71b76588` 就是 54px,放大量出 0.057、不放大量出 1.6 以上。
#           兩件事分開量,才不會用一條線同時管兩個毛病(而且 ① 已經在管小了)。
#        ㋑ **MUST 除以主體亮度標準差**:低對比的主體(深色玄武岩)不是失焦,與 ⑤ 同一條理由。
#        ㋒ **MUST 先侵蝕遮罩再取樣**:matte 的輪廓是「主體 vs 全透明」的硬邊,Laplacian 在那裡
#           爆表 ⇒ 不侵蝕的話**每一張都銳利**。侵蝕 4 格 > 3×3 核的作用範圍,邊界的填值碰不到取樣點。
#      門檻 0.25:校準名單(見下)最低 0.473、全體最低 0.156 ⇒ 留 1.9× 邊際,實測淘汰 1 張
#      (一條魚,`sh_sage/ov_ef6d3` 0.156)。**刻意不收到 0.30** —— 那會多殺一支衛星天線(0.262)
#      與一顆砂岩(0.279),兩者都不是失焦而是**表面本來就沒有紋理**。這把尺分不開「光滑」與
#      「失焦」,所以線壓低、0.25~0.50 那一帶進觀察名單。
#   ⑦ **完整度太低(截斷)**:主體被照片的**邊框**切掉。MUST 同時滿足兩件事 ——
#      主體框真的碰到照片邊界(`entry.matte` 的邊框帳;`matte_photos.py --rebbox` 回填),
#      **且**那一條邊上被主體覆蓋的比例 ≥ `CUT_RUN`。只看後者不行:平頂的箱子、圓弧的碗口
#      在自己的 bbox 上邊本來就是滿的(實測 container 0.48、chimney 1.00 的底邊)。
#      **只有頂邊當淘汰線**,另外三邊進觀察名單 —— 這三個豁免各有一個已出貨來源當反證:
#        ・底邊 = 地面接觸,本來就平(`building/chimney` 底邊 run 1.00;`normalize_parts --dy` 就是
#          為了把這種底面壓回地面才存在的);
#        ・左右 = 橫向延伸的東西(`tree/sh_boxwood` 左邊 run 0.82 的一排黃楊、擋土牆、街屋)。
#      頂邊沒有這種正當理由:一個物件的頂是它與天空的交界。校準名單裡碰到頂邊的只有 chimney
#      一張、run 0.18 ⇒ 門檻 0.35 留 1.9× 邊際,實測淘汰 2 張(一棟被切掉屋頂的半木造、一個
#      占滿畫面的玻璃碗)。缺邊框帳 ⇒ **不評判**(寧缺勿錯,同 ③ 的 bstd)。
#
# ⚠ **校準名單只算「matte 真的餵過生成器」的來源**(2026-08-10 訂正,很反直覺):
#    `parts_manifest.json` 裡有 7 個來源走 Route A(`llm_parts`)—— 人眼**讀照片**手寫 primitive,
#    matte 從來不是它的輸入。其中兩張 `landmark/tank` 各含**一座水塔加一整棟房子**,
#    拿它們當「不可淘汰」的硬約束,等於要求選片閘放行多主體照片。名冊改由 `method` 推導
#    (`CAL_METHODS`,`split_targets.py` 同一份定義),27 張。
#
# 紀律:
#   - 結論回寫 photo_manifest.json 的 entry.screen = { v: 'pass'|'reject', why, at } ——
#     fetch_photos.mjs 的 have()/--plan 只計 screen 未淘汰的條目(F0:「可用張數不是下載張數」,
#     不回寫的話下一輪又會以為抓夠了)。
#   - **人眼判決恆勝統計**:screen.why == 'human' 的條目重跑統計不覆寫;救回誤殺走
#     `--human pass`。判決不變就不改寫 at(帳本 diff 只留真變化)。
#   - 淘汰的也出 sheet(out/sheets/<fam>_screen_reject.png)——誤殺要看得見才救得回(原則 6)。
#   - 零亂數、零網路;跑在 tools/ai3d/.venv(PIL + numpy,rembg 環境本來就有)。
#
# 用法:
#   .venv/Scripts/python screen_mattes.py                     # 統計七桶 + 回寫帳本 + 印摘要
#   .venv/Scripts/python screen_mattes.py --family tree       # 只跑某一族(預設 tree)
#   .venv/Scripts/python screen_mattes.py --home <資料家>     # 語料不在本 checkout 底下時
#       ⚠ 語料家會搬(runbook §5af-g:一個 worktree 被刪掉,整份 superset 跟著沒了)⇒ 資料家
#         是**參數**不是「腳本住哪」。不給就沿用舊行為(= 腳本自己的目錄),逐位元不變。
#   .venv/Scripts/python screen_mattes.py --dry               # 只印不寫
#   .venv/Scripts/python screen_mattes.py --sheet             # 另產倖存者/淘汰者 contact sheet
#   .venv/Scripts/python screen_mattes.py --human reject ov_x1,ov_x2   # 人眼淘汰(含人/不是樹)
#   .venv/Scripts/python screen_mattes.py --human pass ov_x1           # 人眼救回統計誤殺
#   .venv/Scripts/python screen_mattes.py --purge ov_x1                # ✕ 刪除來源圖 + 進黑名單
#       (2026-08-10:對照台判 ✕ 時由 apply_verdicts.mjs 呼叫;黑名單的表達方式見 apply_purge 檔頭
#        —— 帳本條目 MUST 留著且 ok 維持 True,否則下一輪會把同一張圖重新下載回來)
import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone

# Windows 主控台預設 cp950,吃不下摘要裡的「⇒/⚠」⇒ stdout 一律 UTF-8(輸出檔案不受影響)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
# 資料家(matte / photos / 帳本 / sheet)= --home,不給就是腳本自己的目錄(舊行為)。
# argparse 在 main() 才跑,而這幾個常數是模組層 ⇒ 先在這裡撈一次 argv(零副作用)。
_HOME = HERE
if '--home' in sys.argv:
    _HOME = os.path.abspath(sys.argv[sys.argv.index('--home') + 1])
MATTE = os.path.join(_HOME, 'out', 'matte')
PHOTOS = os.path.join(_HOME, 'photos')
MANIFEST = os.path.join(_HOME, 'photo_manifest.json')
SHEETS = os.path.join(_HOME, 'out', 'sheets')

# 校準名單 = matte 真的被餵進生成器的那些 method(檔頭 ⚠);Route A 的 `llm_parts` 與
# Route 0 的 `plan_hull` 讀的是照片,不在此列。與 split_targets.py 同一份定義。
CAL_METHODS = ('sf3d', 'trellis2_spz', 'hunyuan_2gp', 'simple_geom_tree')

TREE_CAL_FAMS = ('tree',)  # ①② 是拿 82 張 tree matte 校準的 ⇒ 那兩條門檻只在這幾族當淘汰線
BLANK_COV = 0.05      # ① 整畫布 α>128 覆蓋率下限(可用 16 張最低 0.100);tree 專用
MIN_CANVAS = 300      # ① 畫布最長邊下限 px(可用 16 張最小 481);全族通用
PRINT_FILL = 0.85     # ② bbox 內填滿率上限(可用 16 張最高 0.643);tree 專用
PRINT_FILL_OTHER = 0.93  # ② 別族的淘汰線:建物 bbox 本來就接近填滿(已出貨最高 0.909)
SPEC_COV = 0.28       # ③ 葉片標本:覆蓋率下限
SPEC_ASP = (0.8, 1.3) # ③ 長寬比帶(白描猴麵包樹 #58 asp 1.40 在帶外)
SPEC_BSTD = 20.0      # ③ 原圖邊框 std 上限(大橡樹 #16 bstd 62.5 在帶外)
MULTI_MAIN = 0.70     # ④ 多主體:最大連通元件面積佔比下限(已出貨 25 張最低 0.778)
LUM_MIN = 35.0        # ⑤ 光源不足:主體平均亮度下限(已出貨最低 43.5)
DARK_FRAC = 0.70      # ⑤ 光源不足:主體暗部(luma<40)佔比上限(已出貨最高 0.632)
SHARP_MIN = 0.25      # ⑥ 太模糊:normalised Laplacian 下限(校準名單最低 0.473、全體最低 0.156)
SHARP_PX = 512        # ⑥ 取樣尺寸;主體長邊**只縮不放**到這個值(檔頭 ㋐)
SHARP_ER = 4          # ⑥ 取樣前侵蝕格數(> 3×3 核的作用範圍;檔頭 ㋒)
CUT_RUN = 0.35        # ⑦ 完整度:碰到照片邊界那一條邊上,主體覆蓋比例的上限(校準名單頂邊最高 0.18)
CUT_TOL = 2           # ⑦ 距照片邊界幾格以內算「碰到」(吸收去背羽化與縮圖重取樣)
CUT_SIDES = ('top',)  # ⑦ **只有頂邊當淘汰線**;底/左/右各有已出貨來源當反證(檔頭)
WATCH_MAIN = 0.90     # 觀察名單(不淘汰,只上 sheet 給人眼):主體佔比
WATCH_LUM = 55.0      # 觀察名單:平均亮度
WATCH_SHARP = 0.50    # 觀察名單:銳利度(0.25~0.50 = 分不開「光滑」與「失焦」的那一帶)
DARK_L = 40.0         # 「暗部」的亮度界(0~255 luma)


def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def matte_stats(path):
    """單張 matte 的統計特徵;bbox 一律取 α>128(α>16 會被雜散像素撐大,四角/填滿率全失真)。

    ④⑤ 的三個新欄位(main / lum / dark)在**縮到 512 的副本**上算 —— 連通元件標記與亮度
    平均對解析度不敏感(實測 512 與原尺寸的 main 差 <0.01),而原尺寸逐張標記會讓整輪多花
    幾分鐘;①②③ 仍吃原尺寸(畫布下限與填滿率就是尺寸的函數,縮了就量錯)。
    """
    im = Image.open(path)
    a = np.asarray(im.convert('RGBA'))[:, :, 3]
    h, w = a.shape
    cov = float((a > 128).mean())
    sm = _subject_stats(im)
    ys, xs = np.where(a > 128)
    if len(xs) == 0:
        return {'canvas': max(w, h), 'cov': cov, 'fill': 0.0, 'asp': 0.0, 'corners': 0,
                'sharp': None, 'bbox': None, 'run': {}, **sm}
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = int(x1 - x0 + 1), int(y1 - y0 + 1)
    sub = a[y0:y1 + 1, x0:x1 + 1]
    p = max(3, min(bw, bh) // 50)
    corners = sum(1 for cy, cx in ((0, 0), (0, bw - p), (bh - p, 0), (bh - p, bw - p))
                  if sub[cy:cy + p, cx:cx + p].mean() > 128)
    solid = sub > 128
    return {'canvas': max(w, h), 'cov': cov, 'fill': float(solid.mean()),
            'asp': (bw / bh) if bh else 0.0, 'corners': corners,
            'sharp': _sharp(im, (int(x0), int(y0), int(x1) + 1, int(y1) + 1)),
            'bbox': (int(x0), int(y0), int(x1) + 1, int(y1) + 1),
            # ⑦ 用:主體 bbox 四條邊上,被主體蓋住的比例
            'run': {'top': float(solid[0].mean()), 'bot': float(solid[-1].mean()),
                    'lf': float(solid[:, 0].mean()), 'rt': float(solid[:, -1].mean())},
            **sm}


def _sharp(im, bbox):
    """⑥ 銳利度:主體長邊**只縮不放**到 SHARP_PX,侵蝕後取 Laplacian 標準差 ÷ 主體亮度標準差。

    三條紀律的理由在檔頭 ㋐㋑㋒;主體小到取不到樣就回 None(不評判,那是 ① 的守備範圍)。
    """
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    crop = im.convert('RGBA').crop(bbox)
    s = SHARP_PX / float(max(bw, bh))
    if s < 1.0:                                   # ㋐ 只縮不放
        crop = crop.resize((max(2, int(bw * s)), max(2, int(bh * s))), Image.LANCZOS)
    arr = np.asarray(crop).astype(np.float32)
    m = arr[:, :, 3] > 128
    if m.sum() < 256:
        return None
    lum = 0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]
    er = ndimage.binary_erosion(m, np.ones((3, 3), bool), iterations=SHARP_ER)   # ㋒
    if er.sum() < 256:
        er = m
    # 遮罩外填主體平均:卷積核在邊界附近才不會吃到未定義的 RGB(侵蝕已保證取樣點碰不到這一圈)
    lap = ndimage.laplace(np.where(m, lum, lum[m].mean()))
    return float(lap[er].std() / (lum[m].std() + 1e-6))                          # ㋑


def cut_sides(st, pbb, wh):
    """⑦ 被照片邊框切掉的邊;`pbb`(主體在照片座標的框)或 `wh` 缺一 ⇒ 回 None = 不評判。"""
    if not pbb or not wh or not st.get('run'):
        return None
    (x0, y0, x1, y1), (w, h) = pbb, wh
    touch = {'top': y0 <= CUT_TOL, 'bot': y1 >= h - CUT_TOL,
             'lf': x0 <= CUT_TOL, 'rt': x1 >= w - CUT_TOL}
    return {s: st['run'].get(s, 0.0) for s, t in touch.items() if t and st['run'].get(s, 0.0) >= CUT_RUN}


def _subject_stats(im):
    """④⑤ 用的主體統計:最大連通元件佔比 main、主體平均亮度 lum、主體暗部佔比 dark。

    連通元件取 α>128 的**面積**佔比而不是「幾塊」:桁架水塔的腿本來就會被切成好幾塊
    (已出貨的 `ov_6d02b9e0` 有 4 塊)⇒ 數塊數會把真品跟「三顆蘑菇岩」判成同一類;
    面積佔比則分得開(前者 0.778 = 一個主體 + 碎腿,後者 0.35 = 好幾個主體)。
    """
    sm = im.convert('RGBA').copy()
    sm.thumbnail((512, 512))
    arr = np.asarray(sm)
    mask = arr[:, :, 3] > 128
    tot = int(mask.sum())
    if tot == 0:
        return {'main': 0.0, 'lum': 0.0, 'dark': 1.0}
    lab, _ = ndimage.label(mask)
    sizes = np.bincount(lab.ravel())[1:]
    rgb = arr[:, :, :3].astype(np.float32)
    luma = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    sl = luma[mask]
    return {'main': float(sizes.max() / tot), 'lum': float(sl.mean()),
            'dark': float((sl < DARK_L).mean())}


def border_std(fam, part, stem):
    """原圖邊框環的 RGB std(背景純色偵測);找不到原圖回 None ⇒ ③ 不成立(寧缺勿錯)。"""
    for ext in ('jpg', 'jpeg', 'png', 'webp'):
        p = os.path.join(PHOTOS, fam, part, stem + '.' + ext)
        if not os.path.exists(p):
            continue
        try:
            ph = Image.open(p)
            ph.thumbnail((512, 512))
            rgb = np.asarray(ph.convert('RGB')).astype(np.float32)
            b = 16
            ring = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3),
                                   rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
            return float(ring.std(axis=0).mean())
        except Exception:
            return None
    return None


def verdict_of(st, bstd, fam='tree', cut=None):
    """七統計桶;回 (v, why)。統計通過 = ('pass', 'stat') —— 待人眼,不是最終可用。

    順序有意義:「太小」(①)排在「太模糊」(⑥)之前 —— 一個 54px 的主體兩條都會踩到,而
    正確的理由是小不是糊(檔頭 ㋐)。`cut` 由 `cut_sides()` 給,None = 缺邊框帳 ⇒ ⑦ 不評判。
    """
    cal = fam in TREE_CAL_FAMS
    if (cal and st['cov'] < BLANK_COV) or st['canvas'] < MIN_CANVAS:
        return 'reject', 'blank'
    if st['fill'] >= (PRINT_FILL if cal else PRINT_FILL_OTHER):
        return 'reject', 'print'
    if (st['cov'] >= SPEC_COV and SPEC_ASP[0] <= st['asp'] <= SPEC_ASP[1]
            and bstd is not None and bstd <= SPEC_BSTD):
        return 'reject', 'specimen'
    if st['main'] < MULTI_MAIN:
        return 'reject', 'multi'
    if st['lum'] < LUM_MIN and st['dark'] >= DARK_FRAC:
        return 'reject', 'dark'
    if st.get('sharp') is not None and st['sharp'] < SHARP_MIN:
        return 'reject', 'blur'
    if cut and any(s in cut for s in CUT_SIDES):
        return 'reject', 'cut'
    return 'pass', 'stat'


def watched(st, fam='tree', cut=None):
    """統計放行但值得人眼多看一眼(不淘汰)。

    ①② 在非校準族**降級成觀察線而不是放棄**:tree 的門檻在那些族會誤殺真品(檔頭 ⚠),
    但它抓的那兩種東西(空/小主體、整張紙)在那些族一樣存在 —— 1932 年畢業紀念冊封面
    (fill 0.854)與舊 hoodoo 那張(cov 0.016)就落在這一帶。降級 = 人眼看得到,而不是
    被統計悄悄吃掉,也不是被統計悄悄放過。
    """
    if st['main'] < WATCH_MAIN or st['lum'] < WATCH_LUM:
        return True
    if st.get('sharp') is not None and st['sharp'] < WATCH_SHARP:
        return True
    if cut:                       # 碰到邊框但不是頂邊(底 = 地面接觸、左右 = 橫向延伸)⇒ 人眼看
        return True
    if fam not in TREE_CAL_FAMS and (st['fill'] >= PRINT_FILL or st['cov'] < BLANK_COV):
        return True
    return False


def load_manifest():
    with open(MANIFEST, encoding='utf-8') as f:
        return json.load(f)


def save_manifest(m):
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
        f.write('\n')


def contact_sheet(cells, out_path):
    """cells = [(matte_path, label)];8 欄縮圖 sheet,零亂數。
    空桶 MUST 刪掉上一輪的舊 sheet —— 留著 = 人眼複核的是早已淘汰的幻影名單。"""
    if not cells:
        if os.path.exists(out_path):
            os.remove(out_path)
            print(f'sheet → {os.path.relpath(out_path, HERE)} 已移除(這一桶現在是空的)')
        return
    CW, PAD, LBL, COLS = 210, 4, 15, 8
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msjh.ttc', 11)
    except Exception:
        font = ImageFont.load_default()
    rows = (len(cells) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * (CW + PAD) + PAD, rows * (CW + LBL + PAD) + PAD), (245, 245, 245))
    dr = ImageDraw.Draw(sheet)
    for i, (path, label) in enumerate(cells):
        im = Image.open(path).convert('RGBA')
        bg = Image.new('RGBA', im.size, (38, 38, 38, 255))
        im = Image.alpha_composite(bg, im).convert('RGB')
        im.thumbnail((CW, CW))
        box = Image.new('RGB', (CW, CW), (38, 38, 38))
        box.paste(im, ((CW - im.width) // 2, (CW - im.height) // 2))
        x = PAD + (i % COLS) * (CW + PAD)
        y = PAD + (i // COLS) * (CW + LBL + PAD)
        sheet.paste(box, (x, y))
        dr.text((x + 1, y + CW + 1), label, fill=(20, 20, 20), font=font)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sheet.save(out_path)
    print(f'sheet → {os.path.relpath(out_path, HERE)}  ({len(cells)} 格)')


def roll_up(e):
    """被切開的照片:`entry.screen` = 只要還有一個目標活著就 pass(fetch_photos 的 have() 與
    harvest_loop 讀的都是這一欄)。回 True = 有變更。

    人眼直接對**母照片 id** 下的判決恆勝(與逐目標的人眼判決同一條規則)—— 不然「我已經把整張
    判掉了」會被 rollup 悄悄推翻。
    """
    tg = e.get('targets')
    if not tg:
        return False
    prev = e.get('screen') or {}
    if prev.get('why') == 'human':
        return False
    v = 'pass' if any((t.get('screen') or {}).get('v') == 'pass' for t in tg) else 'reject'
    if prev.get('v') == v and prev.get('why') == 'targets':
        return False
    e['screen'] = {'v': v, 'why': 'targets', 'at': now_iso()}
    return True


def apply_human(manifest, fam, mode, ids):
    """人眼判決回寫;id = 帳本 id(母照片)**或** `entry.targets[].id`(單一目標)。人眼恆勝統計。
    回 (命中數, 變更數) —— 判決不變就不改寫 at(檔頭契約:帳本 diff 只留真變化)。"""
    ids = set(ids)
    v = 'reject' if mode == 'reject' else 'pass'
    hit = set()
    changed = 0
    for e in manifest:
        if e.get('family') != fam or not e.get('ok'):
            continue
        for holder, hid in [(e, e.get('id'))] + [(t, t.get('id')) for t in e.get('targets') or []]:
            if hid not in ids:
                continue
            hit.add(hid)
            prev = holder.get('screen')
            if prev and prev.get('v') == v and prev.get('why') == 'human':
                continue
            holder['screen'] = {'v': v, 'why': 'human', 'at': now_iso()}
            changed += 1
        if roll_up(e):
            changed += 1
    for i in ids - hit:
        print(f'⚠ 帳本裡沒有 {fam} 族的 {i}(或 ok:false),跳過')
    return len(hit), changed


def apply_purge(manifest, fam, ids, dry=False):
    """✕ 刪除來源圖(2026-08-10 使用者定案:人眼判 purge 時**連節點一起撤下**,照片真的刪掉)。

    做兩件事,而**兩件都要做**:
      ① **真刪檔**:原圖 + 它的 matte + 它切出來的每一個目標。留著的話下一輪去背又把它
         推進管線一次(GPU 白燒),而日誌上完全正常。
      ② **黑名單**:帳本條目**留著**且 `ok` 維持 True —— 這一條反直覺但它才是黑名單本身:
         `fetch_photos.mjs` 的 `seen` 是「`e.ok` 或持續性失敗」,把 ok 改成 False 會讓這張圖
         **下一輪被重新下載**(擋了一邊、漏了另一邊,而兩邊都不會報錯)。淘汰改由
         `screen = {v:'reject', why:'human'}` 表達 ⇒ `usable()` 不算它、`--adopt` 的
         id 去重也擋得住、`harvest_loop.pendingMattes` 的 rejected 集合同樣吃這一欄。
         `why` 用 `'human'` 是必要的:統計重跑只讓過 `why == 'human'` 的條目(人眼恆勝),
         寫成 `'purged'` 的話下一次跑統計就把判決洗掉了。

    id 一律當**母照片**解:使用者的判決是「刪除原始照片」,而目標是它切出來的
    (只想擋掉其中一個目標請用 `--human reject <目標 id>`)。回 (命中數, 刪檔數)。
    """
    ids = set(ids)
    hit = 0
    removed = 0
    for e in manifest:
        if e.get('family') != fam or e.get('id') not in ids:
            continue
        hit += 1
        files = [e.get('file')] + [t.get('file') for t in e.get('targets') or []]
        files.append(os.path.join('out', 'matte', fam, e.get('part') or '', f"{e['id']}.png"))
        for rel in files:
            if not rel:
                continue
            p = rel if os.path.isabs(rel) else os.path.join(_HOME, rel)
            if not os.path.exists(p):
                continue
            print(f"  − {os.path.relpath(p, _HOME)}")
            if not dry:
                os.remove(p)
            removed += 1
        e['purged'] = {'at': now_iso(), 'by': 'apply_verdicts'}
        e['screen'] = {'v': 'reject', 'why': 'human', 'at': now_iso()}
        for t in e.get('targets') or []:
            t['screen'] = {'v': 'reject', 'why': 'human', 'at': now_iso()}
    for i in ids:
        if not any(e.get('family') == fam and e.get('id') == i for e in manifest):
            print(f'⚠ 帳本裡沒有 {fam} 族的 {i},跳過')
    return hit, removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--family', default='tree')
    ap.add_argument('--home', default=None)                  # 已在模組層讀過(MATTE/PHOTOS/…);此處只為 --help 與拒收未知旗標
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--sheet', action='store_true')
    ap.add_argument('--human', nargs=2, metavar=('pass|reject', 'id[,id..]'))
    ap.add_argument('--purge', metavar='id[,id..]',
                    help='刪除來源圖:真刪原圖/matte/目標 + 進黑名單(對照台判 ✕ 時由 apply_verdicts.mjs 呼叫)')
    args = ap.parse_args()
    fam = args.family

    manifest = load_manifest()

    if args.purge:
        hit, removed = apply_purge(manifest, fam, [s for s in args.purge.split(',') if s], args.dry)
        if args.dry:
            print(f'刪除來源圖 {hit} 筆 / {removed} 個檔(--dry:未寫入也未刪檔)')
        elif hit:
            save_manifest(manifest)
            print(f'刪除來源圖 {hit} 筆,共刪 {removed} 個檔;帳本條目留著當黑名單(不會再被抓/收編/送生成)')
        else:
            print('沒有命中任何條目 —— 未寫入')
        return

    if args.human:
        mode, raw = args.human
        if mode not in ('pass', 'reject'):
            raise SystemExit('--human 第一個參數只能是 pass 或 reject')
        n, changed = apply_human(manifest, fam, mode, [s for s in raw.split(',') if s])
        if args.dry:
            print(f'人眼判決 {mode} × {n} 筆(其中 {changed} 筆是變更)(--dry:未寫入)')
        elif changed:
            save_manifest(manifest)
            print(f'人眼判決 {mode} × {n} 筆已回寫({changed} 筆變更)')
        else:
            print(f'人眼判決 {mode} × {n} 筆,判決皆與帳上相同 —— 未寫入')
        return

    by_id = {}
    for e in manifest:
        if e.get('family') == fam and e.get('ok'):
            by_id.setdefault((e.get('part'), e.get('id')), []).append(e)

    files = sorted(glob.glob(os.path.join(MATTE, fam, '*', '*.png')))
    if not files:
        raise SystemExit(f'找不到 {fam} 族的 matte({os.path.relpath(os.path.join(MATTE, fam), HERE)});先跑 matte_photos.py')

    # 判決的單位:被切開的照片 ⇒ 逐目標(檔頭 §5au);沒被切的 ⇒ 母 matte,與改制前逐位元相同。
    units, orphans, missing = [], [], []
    for f in files:
        part = os.path.basename(os.path.dirname(f))
        stem = os.path.splitext(os.path.basename(f))[0]
        entries = by_id.get((part, stem), [])
        if not entries:
            orphans.append(f'{part}/{stem}')
        tg = next((e['targets'] for e in entries if e.get('targets')), None)
        if not tg:
            units.append((f, part, stem, None, entries))
            continue
        for t in tg:
            p = os.path.join(_HOME, t.get('file', ''))
            if os.path.exists(p):
                units.append((p, part, stem, t, entries))
            else:
                missing.append(t.get('id'))

    counts = {'blank': 0, 'print': 0, 'specimen': 0, 'multi': 0, 'dark': 0,
              'blur': 0, 'cut': 0, 'human': 0, 'pass': 0}
    changed = 0
    n_tgt = sum(1 for u in units if u[3] is not None)
    pass_cells, rej_cells, watch_cells = [], [], []
    for path, part, stem, holder, entries in units:
        st = matte_stats(path)
        mt = next((e['matte'] for e in entries if e.get('matte')), None) or {}
        # 主體在**照片座標**裡的框:目標由 split_targets 記在帳上,母 matte 則是「畫布框 + origin」
        if holder is not None:
            pbb = holder.get('pbb')
        elif st.get('bbox') and mt.get('origin'):
            ox, oy = mt['origin']
            pbb = [st['bbox'][0] + ox, st['bbox'][1] + oy, st['bbox'][2] + ox, st['bbox'][3] + oy]
        else:
            pbb = None
        cut = cut_sides(st, pbb, mt.get('wh'))
        v, why = verdict_of(st, border_std(fam, part, stem), fam, cut)

        # 人眼恆勝統計;判決寫在「這個單位」自己的 screen 上(目標 → targets[i].screen)
        holders = [holder] if holder is not None else entries
        eff_v, eff_why = v, why
        for h in holders:
            prev = h.get('screen')
            if prev and prev.get('why') == 'human':
                eff_v, eff_why = prev['v'], 'human'
                continue
            if not prev or prev.get('v') != v or prev.get('why') != why:
                h['screen'] = {'v': v, 'why': why, 'at': now_iso()}
                changed += 1
        counts['human' if eff_why == 'human' and eff_v == 'reject' else (eff_why if eff_v == 'reject' else 'pass')] += 1
        # 標籤要塞得進 210px 的格子(超出就疊在一起 = 整張 sheet 讀不了)⇒ 縮寫欄名 + 截短 stem
        uid = holder['id'] if holder is not None else stem
        sharp = st.get('sharp')
        label = (f'{part[:12]} {uid[:12]} m{st["main"]:.2f} l{st["lum"]:.0f}'
                 + (f' s{sharp:.2f}' if sharp is not None else ''))
        if eff_v == 'pass':
            pass_cells.append((path, label))
            if watched(st, fam, cut):
                watch_cells.append((st['main'], path,
                                    f'{label} f{st["fill"]:.2f} c{st["cov"]:.2f}'
                                    + (f' 切{"/".join(cut)}' if cut else '')))
        else:
            rej_cells.append((path, f'[{eff_why}] {label}'))
    for e in {id(e): e for _, _, _, _, es in units for e in es}.values():
        if roll_up(e):
            changed += 1
    watch_cells.sort(key=lambda t: t[0])                     # 最可疑的排前面
    watch_cells = [(f, lb) for _, f, lb in watch_cells]

    print(f'{fam} 族 {len(units)} 個目標(matte {len(files)} 張,其中 {n_tgt} 個來自被切開的照片):'
          f'剝空/主體太小 {counts["blank"]}、印刷品 {counts["print"]}、葉片標本 {counts["specimen"]}、'
          f'多主體 {counts["multi"]}、光源不足 {counts["dark"]}、太模糊 {counts["blur"]}、'
          f'截斷 {counts["cut"]}、人眼淘汰 {counts["human"]} ⇒ 倖存 {counts["pass"]}(待人眼/已可用)')
    if watch_cells:
        print(f'  觀察名單 {len(watch_cells)} 張(統計放行但主體佔比 <{WATCH_MAIN}、亮度 <{WATCH_LUM:.0f}、'
              f'銳利度 <{WATCH_SHARP} 或碰到照片邊框;--sheet 會另出一張,人眼決定留不留)')
    if missing:
        print(f'⚠ 帳本上有 {len(missing)} 個目標的檔案不見了(先重跑 split_targets.py):'
              f'{", ".join(str(m) for m in missing[:6])}')
    if orphans:
        print(f'⚠ {len(orphans)} 張 matte 在帳本裡找不到對應條目(結論寫不回去):{", ".join(orphans[:6])}…'
              if len(orphans) > 6 else f'⚠ 帳本缺條目:{", ".join(orphans)}')
    if not args.dry and changed:
        save_manifest(manifest)
        print(f'帳本已回寫({changed} 筆 screen 變更)→ 之後 fetch_photos.mjs --plan 計的是可用張數')
    elif args.dry:
        print('(--dry:未寫入)')

    if args.sheet:
        contact_sheet(pass_cells, os.path.join(SHEETS, f'{fam}_screen_pass.png'))
        contact_sheet(rej_cells, os.path.join(SHEETS, f'{fam}_screen_reject.png'))
        contact_sheet(watch_cells, os.path.join(SHEETS, f'{fam}_screen_watch.png'))


if __name__ == '__main__':
    main()
