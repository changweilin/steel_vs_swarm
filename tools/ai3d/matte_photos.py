# 照片去背(skill photo-to-prop-forge §2 / 計畫書 §5.3 ①):photos/<fam>/<part>/*.jpg →
# out/matte/<fam>/<part>/*.png(RGBA)。跑在 tools/ai3d/.venv(rembg,CPU 可)。
# 產出也**不入版控**(.gitignore: tools/ai3d/out/)—— 入庫的只有零件 GLB。
# 用法:.venv/Scripts/python matte_photos.py [family] [part] [--home <資料家>]
#   .venv/Scripts/python matte_photos.py --rebbox [--home <資料家>]   # 只回填邊框帳,不動 matte
#   ⚠ 語料家會搬(runbook §5af-g)⇒ 資料家是**參數**不是「腳本住哪」;不給就沿用舊行為
#     (= 腳本自己的目錄),逐位元不變。
#
# **邊框帳 `entry.matte`(2026-08-10 §5au)**:`{wh: [w,h], origin: [ox,oy]}`,其中 wh = 縮圖後的
# 照片尺寸、origin = matte 畫布 (0,0) 在照片座標裡的位置 ⇒ **畫布座標 + origin = 照片座標**。
# 選片閘 ⑦(完整度太低)問的是「主體是不是被照片的邊框切掉了」,而這件事**只有去背的當下知道**:
# 畫布是「裁到主體 + 補邊」做出來的,補完之後每一張看起來都是主體浮在中央 —— 一棟屋頂被切掉的
# 房子與一個平頂貨櫃在 matte 上長得一模一樣(實測:bld_halftimber 頂邊 run 0.88 是真的被切掉,
# container 頂邊 run 0.48 只是箱子本來就有平頂,兩者在 matte 上分不開)。
# 缺這一筆的舊條目 ⇒ ⑦ **不評判**(寧缺勿錯),`--rebbox` 一次補齊(179 張實測 44s:模型是
# 決定性的,同一張照片重跑出同一個框,所以**不重寫 matte**,只把帳記上)。
import json
import sys
from pathlib import Path

# 進度行有 `✓`,而**繁中 Windows 的主控台預設是 cp950** ⇒ 印到第一個非 cp950 字元就
# `UnicodeEncodeError` **整支中止**(2026-08-09 實測:批次跑到第 4 張才死,前 3 張的
# 產出留著、後面的沒有,而回頭看目錄只會覺得「怎麼少了幾張」)。
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from PIL import Image
from rembg import remove, new_session

from matte_frame import frame
from manifest_store import merge_manifest

HERE = Path(__file__).parent
argv = sys.argv[1:]
HOME = Path(argv[argv.index('--home') + 1]).resolve() if '--home' in argv else HERE
REBBOX = '--rebbox' in argv
pos = [a for a in argv if not a.startswith('--')]
if '--home' in argv:
    pos = [a for a in pos if a != argv[argv.index('--home') + 1]]
PHOTOS = HOME / 'photos'
OUT = HOME / 'out' / 'matte'
MANIFEST = HOME / 'photo_manifest.json'

fam_filter = pos[0] if len(pos) > 0 else None
part_filter = pos[1] if len(pos) > 1 else None

# **設計圖不走去背**(§5aj-A ⑤;使用者 2026-08-09 定案「設計圖 + 照片總比例滿足 50+25+25」
# 之後,語料裡混進了 `src: 'drawing'` 的列)。理由不是「多花時間」而是**判定會錯**:
# rembg 對一張白底線稿會把整張紙當背景剝掉(或把紙當主體整片留下),而下游選片閘的門檻
# 全是拿**照片**校準的 —— 線稿在那些統計上是另一個分布,結論一律是垃圾。設計圖的品質閘
# 住 `plan_to_mesh.py --screen`,回寫的是**同一個** entry.screen 欄位。
# 名冊 MUST 由帳本的 `src` 欄推導,MUST NOT 在這裡手寫一份 `dwg_*` 清單(第二份實作:
# 型錄新增一列設計圖時,這裡不會有任何東西提醒你它過期了)。
MAN = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else []
DRAWING_PARTS = set()
for _e in MAN:
    if _e.get('src') == 'drawing':
        DRAWING_PARTS.add((_e.get('family'), _e.get('part')))
BY_ID = {(e.get('family'), e.get('part'), e.get('id')): e for e in MAN if e.get('ok')}
BY_FILE = {str((HOME / e.get('file')).resolve()): e for e in MAN if e.get('ok') and e.get('file')}

session = new_session('u2net')
n = 0
skipped_dwg = 0
skipped_loose = 0
booked = 0
for src in sorted(PHOTOS.rglob('*.*')):
    if src.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
        continue
    # 語料的佈局恆是 `photos/<族>/<零件>/*` ⇒ **只收深度剛好 2 的**。散在 `photos/<族>/*` 的檔案
    # (雲端同步、手動丟進來的)舊制會被 rglob 收進來,而 `parent.parent` 讓族名變成字面上的
    # `photos` ⇒ 產出落在 `out/matte/photos/<族>/`:那不是合法族名,選片閘逐族跑永遠掃不到它,
    # 帳本裡也沒有對應條目 ⇒ 63 張(2026-08-10 實測)沒有授權帳、沒有判決、也沒有消費端的檔案
    # 靜靜躺在那裡。使用者自己放的圖有正規入口(`fetch_photos.mjs --inbox` / `--adopt`,授權硬閘
    # 照跑),這裡 MUST 跳過並**說出來**,MUST NOT 靜默略過(也 MUST NOT 幫它猜零件名)。
    entry = BY_FILE.get(str(src.resolve()))
    if src.parent.parent.parent == PHOTOS:
        fam, part = src.parent.parent.name, src.parent.name
    elif entry and entry.get('restricted'):
        # 非出貨家允許把既有的 photos/<族>/* 編成 part=whole；檔案不搬動，來源路徑保持可追溯。
        fam, part = entry.get('family'), entry.get('part')
    else:
        skipped_loose += 1
        continue
    if fam_filter and fam != fam_filter:
        continue
    if part_filter and part != part_filter:
        continue
    if (fam, part) in DRAWING_PARTS:
        skipped_dwg += 1
        continue
    dst = OUT / fam / part / (src.stem + '.png')
    entry = entry or BY_ID.get((fam, part, src.stem))
    # `--rebbox`:matte 已經有了、只是帳上缺邊框 ⇒ 重跑模型只為了記帳,**不重寫 matte**
    # (模型是決定性的 ⇒ 重寫也會是同一張,但不寫就不可能寫壞)。
    fresh = not dst.exists()
    if REBBOX:
        # 回填模式**只補帳、不產 matte**(用法那一行的契約)。混在一起跑會在回填的同時把整批
        # 新照片也去背掉,而那是另一件事:回填是「補上舊條目缺的欄位」,產 matte 是採集的一站。
        if fresh or entry is None or 'matte' in entry:
            continue
    elif not fresh:
        continue
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        img = Image.open(src)
        img.load()
    except Exception as e:                              # 單張壞檔只記錄不中止(原則 6)
        print(f'✗ {fam}/{part}/{src.name}:{e}')
        continue
    img.thumbnail((2048, 2048), Image.LANCZOS)          # §5.2-9:2048 見方以內、短邊仍 ≥1024
    out = remove(img, session=session)
    # 裁到主體邊界 + 置中方形畫布(§5.2-1/2:單一主體、四周留邊)—— 算式住 matte_frame.py
    # 單一縫,`split_targets.py` 切出來的逐目標 matte 吃的是同一支(檔頭)。
    canvas, origin = frame(out)
    if entry is not None:
        entry['matte'] = {'wh': list(img.size), 'origin': [int(origin[0]), int(origin[1])]}
        booked += 1
    if fresh:
        canvas.save(dst)
        n += 1
        print(f'✓ {fam}/{part}/{dst.name}  {canvas.size[0]}px')
    else:
        print(f'· {fam}/{part}/{dst.name}  邊框回填 {img.size[0]}×{img.size[1]}')
if booked and MANIFEST.exists():
    merge_manifest(MANIFEST, MAN, {fam_filter} if fam_filter else None)
print(f'共 {n} 張' + (f';邊框帳 {booked} 筆' if booked else '')
      + (f';設計圖跳過 {skipped_dwg} 張(走 plan_to_mesh.py --screen)' if skipped_dwg else '')
      + (f';不在 <族>/<零件>/ 底下跳過 {skipped_loose} 張(自己放的圖走 fetch_photos.mjs --inbox / --adopt)'
         if skipped_loose else ''))
