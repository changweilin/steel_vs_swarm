"""Contact sheets of unchanged source images and exact build renders for visual review."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
contract = json.loads((HERE / 'assets.json').read_text(encoding='utf8'))
OUT = (HERE / contract['authoring']['outputs']).resolve()
parser = argparse.ArgumentParser()
parser.add_argument('--ids', nargs='+')
args = parser.parse_args()
ids = args.ids or list(contract['assets'])
views = ['reference', 'front', 'side', 'back', 'top', 'shield_deploy', 'run']
for start in range(0, len(ids), 4):
    rows = ids[start:start + 4]
    sheet = Image.new('RGB', (224 * len(views), 248 * len(rows)), '#20232a')
    draw = ImageDraw.Draw(sheet)
    for row, id in enumerate(rows):
        for col, view in enumerate(views):
            file = OUT / id / (view + '.png')
            if not file.exists():
                continue
            sheet.paste(Image.open(file).convert('RGB').resize((224, 224)), (col * 224, row * 248 + 24))
            draw.text((col * 224 + 8, row * 248 + 6), id + ' / ' + view, fill='white')
    sheet.save(OUT / ('review-' + '-'.join(rows) + '.png'))
for kind in ['aerial', 'ground']:
    rows = [id for id, spec in contract['assets'].items() if (spec['kind'] == 'aerial') == (kind == 'aerial')]
    overview = Image.new('RGB', (4 * 520, 3 * 292), '#20232a')
    draw = ImageDraw.Draw(overview)
    for i, id in enumerate(rows):
        spec = contract['assets'][id]
        x, y = i % 4 * 520, i // 4 * 292
        reference = (HERE / spec['inputs']['image']).resolve()
        render = OUT / id / 'reference.png'
        if not render.exists():
            continue
        for j, file in enumerate([reference, render]):
            tile = ImageOps.contain(Image.open(file).convert('RGB'), (254, 260))
            overview.paste(tile, (x + j * 260 + (254 - tile.width) // 2, y + 28 + (260 - tile.height) // 2))
        draw.text((x + 8, y + 8), id + '  image -> rigid 3D', fill='white')
    overview.save(OUT / (kind + '-overview.png'))
