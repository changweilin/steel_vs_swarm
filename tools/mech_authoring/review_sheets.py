"""Contact sheets of unchanged source images and exact build renders for visual review."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--ids', nargs='+')
parser.add_argument('--contract', default='assets.json')
parser.add_argument('--views', nargs='+')
parser.add_argument('--tile-size', type=int, default=224)
args = parser.parse_args()
contract = json.loads((HERE / args.contract).read_text(encoding='utf8'))
OUT = (HERE / contract['authoring']['outputs']).resolve()
ids = args.ids or list(contract['assets'])
views = args.views or ['reference', 'front', 'side', 'back', 'top', 'shield_deploy', 'run']
size = args.tile_size
for start in range(0, len(ids), 4):
    rows = ids[start:start + 4]
    sheet = Image.new('RGB', (size * len(views), (size + 24) * len(rows)), '#20232a')
    draw = ImageDraw.Draw(sheet)
    for row, id in enumerate(rows):
        for col, view in enumerate(views):
            file = (HERE / contract['assets'][id]['inputs']['image']).resolve() if view == 'source' else OUT / id / (view + '.png')
            if not file.exists():
                if args.views:
                    raise FileNotFoundError(file)
                continue
            tile = ImageOps.contain(Image.open(file).convert('RGB'), (size, size))
            sheet.paste(tile, (col * size + (size - tile.width) // 2, row * (size + 24) + 24 + (size - tile.height) // 2))
            draw.text((col * size + 8, row * (size + 24) + 6), id + ' / ' + view, fill='white')
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

if all('forms' in contract['assets'][id] for id in ids):
    rows=(len(ids)+1)//2
    size=384
    overview=Image.new('RGB',(size*4,(size+24)*rows),'#20232a')
    draw=ImageDraw.Draw(overview)
    for i,id in enumerate(ids):
        for j,view in enumerate(['reference','flight_reference']):
            tile=ImageOps.contain(Image.open(OUT/id/(view+'.png')).convert('RGB'),(size,size))
            x=(i%2*2+j)*size;y=(i//2)*(size+24)
            overview.paste(tile,(x+(size-tile.width)//2,y+24+(size-tile.height)//2))
            draw.text((x+10,y+6),id+' / '+('ground' if j==0 else 'flight'),fill='white')
    overview.save(OUT/'morphers-overview.png')
