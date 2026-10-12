from pathlib import Path
from PIL import Image, ImageDraw, ImageOps
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'out/weapon_revision'
SRC=OUT/'runtime'
actors=[('t08','ground'),('m04','ground'),('s03','ground'),('t06','ground'),('m05','ground'),('m08','ground'),
        ('s03','flight'),('t06','flight'),('m05','flight'),('m08','flight')]
views=['front-neutral','side-neutral','back-neutral','weapon-detail','light-detail-6','heavy-detail-12']
for start in range(0,len(actors),4):
    sheet=Image.new('RGB',(1800,324*min(4,len(actors)-start)),'#152033');draw=ImageDraw.Draw(sheet)
    for row,(id,form) in enumerate(actors[start:start+4]):
        for col,view in enumerate(views):
            file=SRC/f'{id}-{form}-{view}.png'
            if file.exists():
                image=ImageOps.contain(Image.open(file).convert('RGB'),(300,300));sheet.paste(image,(col*300,row*324+24))
            draw.text((col*300+6,row*324+6),f'{id} {form} / {view}',fill='white')
    sheet.save(OUT/f'gallery-{start//4+1}.png')
for id,form in actors:
    for action in ['light','heavy','run']:
        files=[SRC/f'{id}-{form}-{action}-{frame}.png' for frame in range(0,180 if action!='run' else 120,6)]
        frames=[Image.open(file).convert('RGB') for file in files if file.exists()]
        if frames:frames[0].save(OUT/f'{id}-{form}-{action}.gif',save_all=True,append_images=frames[1:],duration=100,loop=0)
    if id=='t06':
        frames=[Image.open(SRC/f'{id}-{form}-light-detail-{frame}.png').convert('RGB') for frame in range(0,180,6)]
        frames[0].save(OUT/f'{id}-{form}-gesture.gif',save_all=True,append_images=frames[1:],duration=100,loop=0)
