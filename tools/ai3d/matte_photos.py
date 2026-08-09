# 照片去背(skill photo-to-prop-forge §2 / 計畫書 §5.3 ①):photos/<fam>/<part>/*.jpg →
# out/matte/<fam>/<part>/*.png(RGBA)。跑在 tools/ai3d/.venv(rembg,CPU 可)。
# 產出也**不入版控**(.gitignore: tools/ai3d/out/)—— 入庫的只有零件 GLB。
# 用法:.venv/Scripts/python matte_photos.py [family] [part] [--home <資料家>]
#   ⚠ 語料家會搬(runbook §5af-g)⇒ 資料家是**參數**不是「腳本住哪」;不給就沿用舊行為
#     (= 腳本自己的目錄),逐位元不變。
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

HERE = Path(__file__).parent
argv = sys.argv[1:]
HOME = Path(argv[argv.index('--home') + 1]).resolve() if '--home' in argv else HERE
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
DRAWING_PARTS = set()
if MANIFEST.exists():
    for _e in json.loads(MANIFEST.read_text(encoding='utf-8')):
        if _e.get('src') == 'drawing':
            DRAWING_PARTS.add((_e.get('family'), _e.get('part')))

session = new_session('u2net')
n = 0
skipped_dwg = 0
for src in sorted(PHOTOS.rglob('*.*')):
    if src.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
        continue
    fam, part = src.parent.parent.name, src.parent.name
    if fam_filter and fam != fam_filter:
        continue
    if part_filter and part != part_filter:
        continue
    if (fam, part) in DRAWING_PARTS:
        skipped_dwg += 1
        continue
    dst = OUT / fam / part / (src.stem + '.png')
    if dst.exists():
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
    # 裁到主體邊界 + 置中方形畫布(§5.2-1/2:單一主體、四周留邊)
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    side = int(max(out.size) * 1.18)                    # ~85% 佔幅
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(out, ((side - out.width) // 2, (side - out.height) // 2))
    canvas.save(dst)
    n += 1
    print(f'✓ {fam}/{part}/{dst.name}  {canvas.size[0]}px')
print(f'共 {n} 張' + (f';設計圖跳過 {skipped_dwg} 張(走 plan_to_mesh.py --screen)' if skipped_dwg else ''))
