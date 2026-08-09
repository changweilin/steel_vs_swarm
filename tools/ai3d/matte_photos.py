# 照片去背(skill photo-to-prop-forge §2 / 計畫書 §5.3 ①):photos/<fam>/<part>/*.jpg →
# out/matte/<fam>/<part>/*.png(RGBA)。跑在 tools/ai3d/.venv(rembg,CPU 可)。
# 產出也**不入版控**(.gitignore: tools/ai3d/out/)—— 入庫的只有零件 GLB。
# 用法:.venv/Scripts/python matte_photos.py [family] [part]
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
PHOTOS = HERE / 'photos'
OUT = HERE / 'out' / 'matte'

fam_filter = sys.argv[1] if len(sys.argv) > 1 else None
part_filter = sys.argv[2] if len(sys.argv) > 2 else None

session = new_session('u2net')
n = 0
for src in sorted(PHOTOS.rglob('*.*')):
    if src.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
        continue
    fam, part = src.parent.parent.name, src.parent.name
    if fam_filter and fam != fam_filter:
        continue
    if part_filter and part != part_filter:
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
print(f'共 {n} 張')
