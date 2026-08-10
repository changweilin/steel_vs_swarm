# 圈選目標 + 分離(2026-08-10 §5au;使用者定案:「同一張照片可能有好幾個目標,圈選目標,分離,
# 篩選太模糊/太小/完整度太低的,再進入 img to 3D 管線」)。
#
#   out/matte/<fam>/<part>/<id>.png   ──本支──▶   out/targets/<fam>/<part>/<id>~1.png, ~2.png …
#                                                 + 帳本 entry.targets[]
#
# **這一支只做幾何,不做判決**。「太模糊 / 太小 / 完整度太低」全部住選片閘 `screen_mattes.py`
# (⑥⑦ 與既有 ①~⑤ 同一個地方),本支只負責把「一張多目標的 matte」變成「幾張單目標的 matte」。
# 分成兩支的理由不是潔癖:淘汰線是**拿已出貨來源校準**出來的,而校準名單、觀察名單、人眼判決回寫、
# contact sheet 全都已經住在選片閘裡 —— 在這裡再判一次就是第二套門檻,而症狀會是「同一張圖在兩支
# 工具裡的結論不一樣」。
#
# —— 圈選是什麼 ——
# **matte 的 alpha 本身就是圈選**(rembg 已經把顯著物件圈出來了),缺的只有「分離」:把 alpha 拆成
# 一個一個目標。這條與選片閘 ④ 的既有 doctrine 是同一條 —— 「量在 matte 上而不是照片上:本輪
# hoodoo 的贏家原圖有三顆蘑菇岩加電線桿,而去背只留下一顆」。照片髒不等於輸入髒,所以**不需要**
# 第二個偵測模型(SAM 之類);u2net 沒圈到的東西本支也救不回來,那是已知上界不是 bug。
#
# —— 分離規則:面積佔比 + bbox 包含,不是「數塊數」——
# 連通元件數量**不能**當目標數(選片閘 ④ 檔頭量過:已出貨的桁架水塔 `ov_6d02b9e0` 有 4 塊,
# 那是一個主體的腿被 alpha 切斷)。故:
#   ① 由大到小掃元件;bbox 被既有種子的 bbox 蓋掉 ≥ `CONTAIN_F` 的,一律**併進那個種子**
#      —— 一根腿、一片屋簷、一段被前景遮斷的軀幹,投影上都落在主體的框裡面。
#   ② 沒被蓋到、而且面積 ≥ `SEED_F` 的,才成為**新的種子** = 一個新目標。
#   ③ 兩者皆非 = **碎屑**(電線、路人的一隻腳、去背的雜訊),丟掉並記帳。
# 已知擋不住的一種:兩個目標在投影上重疊(一顆石頭擋在另一顆前面)⇒ 併成一個。沒有深度資訊就
# 分不開,交給人眼(與「不是樹 / 含人」同一個桶)。
#
# —— 為什麼「已出貨的來源被切開」不算誤殺(2026-08-10 實測,這一條很反直覺)——
# 校準名單裡有兩張 `landmark/tank` 被本規則切成 2 塊,乍看是誤殺;把元件上色印出來一看,
# **那兩張本來就各有兩個物件**(水塔 + 一整棟房子)。它們之所以「已出貨」是因為走的是
# **Route A(`llm_parts`)—— 人眼讀照片、手寫 primitive,matte 從來不是它的輸入**。
# ⇒ 零誤殺的硬約束 MUST 只算 **matte 真的餵過生成器**的來源(`sf3d`/`trellis2_spz`/`hunyuan_2gp`/
# `simple_geom_tree`,實測 27 張),名冊由 `parts_manifest.json` 的 `method` 推導(`CAL_METHODS`,
# 與 `screen_mattes.py` 同一份定義)。那 27 張在本規則下**一張都沒有被切開**。
#
# 紀律:
#   - **單一主體且沒有碎屑 ⇒ 一個檔都不產**(帳本也不長 `targets` 欄)⇒ 既有 181 張 matte 與
#     它們的下游逐位元不變。切出來的檔案是**額外**的,母 matte 永遠留在原地(誤切要救得回來)。
#   - 畫布框取走 `matte_frame.frame()` 單一縫(檔頭),MUST NOT 在這裡自己 crop + pad。
#   - 目標 id 的格式(`<照片 id>~<n>`)只在本檔定義一次;**下游一律讀帳本 `targets[].id`,
#     MUST NOT 去拆檔名** —— 拆檔名就是第二份命名規則,而 harvest_loop 那邊是 JS、對不起來的
#     時候沒有任何東西會報錯(症狀是已出貨的來源被重新餵上 GPU,§5as-d 的同一個坑)。
#   - 零亂數、零網路。決定性:同一張 matte 跑兩次的切法與排序逐位元相同(面積排序,同面積比座標)。
#
# 用法:
#   .venv/Scripts/python split_targets.py --home <資料家>              # 全族
#   .venv/Scripts/python split_targets.py --home <資料家> --family rock
#   .venv/Scripts/python split_targets.py --home <資料家> --dry        # 只印不寫
#   .venv/Scripts/python split_targets.py --home <資料家> --sheet      # 母圖 + 切出來的目標 contact sheet
import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from matte_frame import ALPHA_SOLID, frame

HERE = os.path.dirname(os.path.abspath(__file__))
_HOME = HERE
if '--home' in sys.argv:
    _HOME = os.path.abspath(sys.argv[sys.argv.index('--home') + 1])
MATTE = os.path.join(_HOME, 'out', 'matte')
TARGETS = os.path.join(_HOME, 'out', 'targets')
MANIFEST = os.path.join(_HOME, 'photo_manifest.json')
SHEETS = os.path.join(_HOME, 'out', 'sheets')

SEED_F = 0.12       # ② 成為「另一個目標」的面積下限(佔全體 α>128 面積)
CONTAIN_F = 0.60    # ① bbox 被種子蓋掉這麼多 ⇒ 是那個主體的一部分,不是新目標
DEBRIS_MIN = 0.03   # ③ 碎屑佔比低於此 ⇒ 不值得為了清它重出一張(單一主體維持逐位元不變)
FEATHER = 3         # 寫檔時把種子遮罩外擴幾格,把 α≤128 的羽化邊一起帶走(否則輪廓會多一圈硬邊)
TARGET_SEP = '~'    # 目標 id = <照片 id><SEP><n>;**全專案只有這一處定義**


def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def target_id(photo_id, n):
    return f'{photo_id}{TARGET_SEP}{n}'


def _bbox(sl):
    """ndimage 的 slice → (x0, y0, x1, y1),x1/y1 不含。"""
    return (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)


def _area(b):
    return max(1, (b[2] - b[0]) * (b[3] - b[1]))


def _inter(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def _union(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def plan(mask):
    """把 α>128 遮罩分成幾個目標。回 (seeds, debris_share, n_comp, labels)。

    seeds 依面積由大到小排序(同面積比 bbox 左上角)⇒ `~1` 恆是主目標,而且是決定性的。
    **labels 一起回傳**:切圖要用同一份標記,分開跑第二次 `ndimage.label` 就是第二份實作。
    """
    lab, n = ndimage.label(mask)
    if n == 0:
        return [], 0.0, 0, lab
    sizes = np.bincount(lab.ravel())[1:]
    slices = ndimage.find_objects(lab)
    tot = float(sizes.sum())
    seeds, debris = [], 0.0
    for i in sorted(range(n), key=lambda i: (-sizes[i], _bbox(slices[i]))):
        b = _bbox(slices[i])
        host, cover = None, 0.0
        for s in seeds:
            f = _inter(b, s['bbox']) / _area(b)
            if f > cover:
                host, cover = s, f
        if host is not None and cover >= CONTAIN_F:      # ① 同一個主體的碎片
            host['labels'].append(i + 1)
            host['bbox'] = _union(host['bbox'], b)
            host['area'] += float(sizes[i])
        elif sizes[i] >= SEED_F * tot:                   # ② 另一個目標
            seeds.append({'labels': [i + 1], 'bbox': b, 'area': float(sizes[i])})
        else:                                            # ③ 碎屑
            debris += float(sizes[i])
    seeds.sort(key=lambda s: (-s['area'], s['bbox']))
    for s in seeds:
        s['share'] = s['area'] / tot
    return seeds, debris / tot, n, lab


def cut(im, lab, seed):
    """從母 matte 挖出一個目標:只留這個種子的元件(含羽化邊),再走同一支畫布框取。"""
    keep = np.isin(lab, seed['labels'])
    if FEATHER > 0:
        keep = ndimage.binary_dilation(keep, np.ones((3, 3), bool), iterations=FEATHER)
    a = np.asarray(im).copy()
    a[:, :, 3] = np.where(keep, a[:, :, 3], 0)
    return frame(Image.fromarray(a, 'RGBA'))


def load_manifest():
    with open(MANIFEST, encoding='utf-8') as f:
        return json.load(f)


def contact_sheet(cells, out_path):
    """cells = [(PIL 圖, 標籤)];空桶刪舊 sheet(與 screen_mattes 同一條:幻影名單不能留)。"""
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
    for i, (im, label) in enumerate(cells):
        bg = Image.new('RGBA', im.size, (38, 38, 38, 255))
        vis = Image.alpha_composite(bg, im.convert('RGBA')).convert('RGB')
        vis.thumbnail((CW, CW))
        box = Image.new('RGB', (CW, CW), (38, 38, 38))
        box.paste(vis, ((CW - vis.width) // 2, (CW - vis.height) // 2))
        x = PAD + (i % COLS) * (CW + PAD)
        y = PAD + (i // COLS) * (CW + LBL + PAD)
        sheet.paste(box, (x, y))
        dr.text((x + 1, y + CW + 1), label, fill=(20, 20, 20), font=font)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sheet.save(out_path)
    print(f'sheet → {os.path.relpath(out_path, HERE)}  ({len(cells)} 格)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--family', default=None)
    ap.add_argument('--home', default=None)          # 已在模組層讀過;此處只為 --help 與拒收未知旗標
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--sheet', action='store_true')
    args = ap.parse_args()

    manifest = load_manifest()
    by_key = {(e.get('family'), e.get('part'), e.get('id')): e for e in manifest if e.get('ok')}

    pat = os.path.join(MATTE, args.family or '*', '*', '*.png')
    files = sorted(glob.glob(pat))
    if not files:
        raise SystemExit(f'找不到 matte({os.path.relpath(os.path.dirname(pat), HERE)});先跑 matte_photos.py')

    n_split = n_clean = n_plain = n_orphan = 0
    changed = 0
    cells = []
    for f in files:
        fam = os.path.basename(os.path.dirname(os.path.dirname(f)))
        part = os.path.basename(os.path.dirname(f))
        stem = os.path.splitext(os.path.basename(f))[0]
        entry = by_key.get((fam, part, stem))
        if entry is None:
            n_orphan += 1
            continue
        im = Image.open(f).convert('RGBA')
        seeds, debris, ncomp, lab = plan(np.asarray(im)[:, :, 3] > ALPHA_SOLID)

        if len(seeds) <= 1 and debris < DEBRIS_MIN:
            n_plain += 1
            if entry.pop('targets', None) is not None:   # 門檻調過之後重跑:舊的切法要清掉
                changed += 1
            continue
        n_split += 1 if len(seeds) >= 2 else 0
        n_clean += 1 if len(seeds) <= 1 else 0

        org = (entry.get('matte') or {}).get('origin')
        out_dir = os.path.join(TARGETS, fam, part)
        # 上一輪的判決 MUST 活過重跑:`screen_mattes.py` 把判決寫在 `targets[i].screen` 上,
        # 而這一支每次都重算 recs ⇒ 直接覆寫 = **把逐目標的選片判決(含人眼判決)整組洗掉**,
        # 而畫面上只表現成「這幾張怎麼又要重看一次」(2026-08-10 冪等性測試抓到)。
        prev = {t.get('id'): t for t in (entry.get('targets') or [])}
        recs = []
        for k, s in enumerate(seeds, 1):
            tid = target_id(stem, k)
            canvas, _off = cut(im, lab, s)
            rel = os.path.relpath(os.path.join(out_dir, tid + '.png'), _HOME).replace('\\', '/')
            rec = {'id': tid, 'file': rel, 'share': round(s['share'], 4)}
            # 目標在**照片座標**裡的框(截斷閘 ⑦ 要它);母 matte 缺邊框帳就不寫,⑦ 自然不評判
            if org:
                rec['pbb'] = [int(s['bbox'][0] + org[0]), int(s['bbox'][1] + org[1]),
                              int(s['bbox'][2] + org[0]), int(s['bbox'][3] + org[1])]
            old = prev.get(tid)
            if old and all(old.get(f) == rec.get(f) for f in ('file', 'share', 'pbb')):
                rec = old                       # 幾何逐位元相同 ⇒ 整筆沿用(判決留著)
            elif old and (old.get('screen') or {}).get('why') == 'human':
                rec['screen'] = old['screen']   # 幾何變了,但「這是一條魚」不會因為重切而改變
            recs.append(rec)
            if not args.dry:
                os.makedirs(out_dir, exist_ok=True)
                canvas.save(os.path.join(out_dir, tid + '.png'))
            if args.sheet:
                cells.append((canvas, f'{part[:10]} {tid[-12:]} {canvas.size[0]}px'))
        if entry.get('targets') != recs:
            entry['targets'] = recs
            changed += 1
        print(f'✂ {fam}/{part}/{stem[:14]}  {ncomp} 元件 → {len(seeds)} 目標'
              + (f'、碎屑 {debris:.1%}' if debris >= DEBRIS_MIN else ''))

    print(f'\n{len(files)} 張 matte:切成多目標 {n_split} 張、只清碎屑 {n_clean} 張、'
          f'原樣不動 {n_plain} 張(不產檔 ⇒ 下游逐位元不變)')
    if n_orphan:
        print(f'⚠ {n_orphan} 張 matte 在帳本裡找不到條目 ⇒ 跳過(結論寫不回去)')
    if args.dry:
        print('(--dry:未寫入)')
    elif changed:
        with open(MANIFEST, 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        print(f'帳本已回寫({changed} 筆 targets 變更)')

    if args.sheet:
        contact_sheet(cells, os.path.join(SHEETS, f'{args.family or "all"}_targets.png'))


if __name__ == '__main__':
    main()
