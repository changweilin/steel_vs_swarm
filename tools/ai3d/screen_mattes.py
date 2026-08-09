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
#   .venv/Scripts/python screen_mattes.py                     # 統計五桶 + 回寫帳本 + 印摘要
#   .venv/Scripts/python screen_mattes.py --family tree       # 只跑某一族(預設 tree)
#   .venv/Scripts/python screen_mattes.py --home <資料家>     # 語料不在本 checkout 底下時
#       ⚠ 語料家會搬(runbook §5af-g:一個 worktree 被刪掉,整份 superset 跟著沒了)⇒ 資料家
#         是**參數**不是「腳本住哪」。不給就沿用舊行為(= 腳本自己的目錄),逐位元不變。
#   .venv/Scripts/python screen_mattes.py --dry               # 只印不寫
#   .venv/Scripts/python screen_mattes.py --sheet             # 另產倖存者/淘汰者 contact sheet
#   .venv/Scripts/python screen_mattes.py --human reject ov_x1,ov_x2   # 人眼淘汰(含人/不是樹)
#   .venv/Scripts/python screen_mattes.py --human pass ov_x1           # 人眼救回統計誤殺
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
WATCH_MAIN = 0.90     # 觀察名單(不淘汰,只上 sheet 給人眼):主體佔比
WATCH_LUM = 55.0      # 觀察名單:平均亮度
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
        return {'canvas': max(w, h), 'cov': cov, 'fill': 0.0, 'asp': 0.0, 'corners': 0, **sm}
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = int(x1 - x0 + 1), int(y1 - y0 + 1)
    sub = a[y0:y1 + 1, x0:x1 + 1]
    p = max(3, min(bw, bh) // 50)
    corners = sum(1 for cy, cx in ((0, 0), (0, bw - p), (bh - p, 0), (bh - p, bw - p))
                  if sub[cy:cy + p, cx:cx + p].mean() > 128)
    return {'canvas': max(w, h), 'cov': cov, 'fill': float((sub > 128).mean()),
            'asp': (bw / bh) if bh else 0.0, 'corners': corners, **sm}


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


def verdict_of(st, bstd, fam='tree'):
    """五統計桶;回 (v, why)。統計通過 = ('pass', 'stat') —— 待人眼,不是最終可用。"""
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
    return 'pass', 'stat'


def watched(st, fam='tree'):
    """統計放行但值得人眼多看一眼(不淘汰)。

    ①② 在非校準族**降級成觀察線而不是放棄**:tree 的門檻在那些族會誤殺真品(檔頭 ⚠),
    但它抓的那兩種東西(空/小主體、整張紙)在那些族一樣存在 —— 1932 年畢業紀念冊封面
    (fill 0.854)與舊 hoodoo 那張(cov 0.016)就落在這一帶。降級 = 人眼看得到,而不是
    被統計悄悄吃掉,也不是被統計悄悄放過。
    """
    if st['main'] < WATCH_MAIN or st['lum'] < WATCH_LUM:
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


def apply_human(manifest, fam, mode, ids):
    """人眼判決回寫;id = 帳本 id(= matte 檔名 stem)。人眼恆勝統計。
    回 (命中數, 變更數) —— 判決不變就不改寫 at(檔頭契約:帳本 diff 只留真變化)。"""
    ids = set(ids)
    v = 'reject' if mode == 'reject' else 'pass'
    hit = set()
    changed = 0
    for e in manifest:
        if e.get('family') != fam or not e.get('ok') or e.get('id') not in ids:
            continue
        hit.add(e['id'])
        prev = e.get('screen')
        if prev and prev.get('v') == v and prev.get('why') == 'human':
            continue
        e['screen'] = {'v': v, 'why': 'human', 'at': now_iso()}
        changed += 1
    for i in ids - hit:
        print(f'⚠ 帳本裡沒有 {fam} 族的 {i}(或 ok:false),跳過')
    return len(hit), changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--family', default='tree')
    ap.add_argument('--home', default=None)                  # 已在模組層讀過(MATTE/PHOTOS/…);此處只為 --help 與拒收未知旗標
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--sheet', action='store_true')
    ap.add_argument('--human', nargs=2, metavar=('pass|reject', 'id[,id..]'))
    args = ap.parse_args()
    fam = args.family

    manifest = load_manifest()

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

    counts = {'blank': 0, 'print': 0, 'specimen': 0, 'multi': 0, 'dark': 0, 'human': 0, 'pass': 0}
    changed = 0
    orphans = []
    pass_cells, rej_cells, watch_cells = [], [], []
    for f in files:
        part = os.path.basename(os.path.dirname(f))
        stem = os.path.splitext(os.path.basename(f))[0]
        st = matte_stats(f)
        v, why = verdict_of(st, border_std(fam, part, stem), fam)
        entries = by_id.get((part, stem), [])
        if not entries:
            orphans.append(f'{part}/{stem}')
        eff_v, eff_why = v, why
        for e in entries:
            prev = e.get('screen')
            if prev and prev.get('why') == 'human':      # 人眼判決恆勝,統計重跑不覆寫
                eff_v, eff_why = prev['v'], 'human'
                continue
            if not prev or prev.get('v') != v or prev.get('why') != why:
                e['screen'] = {'v': v, 'why': why, 'at': now_iso()}
                changed += 1
        counts['human' if eff_why == 'human' and eff_v == 'reject' else (eff_why if eff_v == 'reject' else 'pass')] += 1
        # 標籤要塞得進 210px 的格子(超出就疊在一起 = 整張 sheet 讀不了)⇒ 縮寫欄名 + 截短 stem
        label = f'{part[:12]} {stem[:10]} m{st["main"]:.2f} l{st["lum"]:.0f}'
        if eff_v == 'pass':
            pass_cells.append((f, label))
            if watched(st, fam):
                watch_cells.append((st['main'], f, f'{label} f{st["fill"]:.2f} c{st["cov"]:.2f}'))
        else:
            rej_cells.append((f, f'[{eff_why}] {label}'))
    watch_cells.sort(key=lambda t: t[0])                     # 最可疑的排前面
    watch_cells = [(f, lb) for _, f, lb in watch_cells]

    print(f'{fam} 族 matte {len(files)} 張:'
          f'剝空/主體太小 {counts["blank"]}、印刷品 {counts["print"]}、葉片標本 {counts["specimen"]}、'
          f'多主體 {counts["multi"]}、光源不足 {counts["dark"]}、'
          f'人眼淘汰 {counts["human"]} ⇒ 倖存 {counts["pass"]}(待人眼/已可用)')
    if watch_cells:
        print(f'  觀察名單 {len(watch_cells)} 張(統計放行但主體佔比 <{WATCH_MAIN} 或亮度 <{WATCH_LUM:.0f};'
              f'--sheet 會另出一張,人眼決定留不留)')
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
