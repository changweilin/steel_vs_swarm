import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'out/limb_grip_review'
IMAGES=OUT/'runtime'
specs={}
for file in ['assets.json','morphers.json']:
    specs.update(json.loads((ROOT/'tools/mech_authoring'/file).read_text())['assets'])
ids=list(specs)
size=300
views=['front','side','back','top','oblique']
def tile(sheet,file,x,y,label):
    image=Image.open(file).convert('RGB')
    image=ImageOps.contain(image,(size,size))
    sheet.paste(image,(x+(size-image.width)//2,y+24+(size-image.height)//2))
    ImageDraw.Draw(sheet).text((x+8,y+6),label,fill='white')
for start in range(0,len(ids),4):
    page=Image.new('RGB',(size*len(views),324*4),'#18212e')
    for row,id in enumerate(ids[start:start+4]):
        for col,view in enumerate(views):
            tile(page,IMAGES/f'{id}-ground-idle-neutral-{view}.png',col*size,row*324,id+' / '+view)
    page.save(OUT/f'geometry-{start//4+1}.png')
overview=Image.new('RGB',(size*4,324*8),'#18212e')
for index,id in enumerate(ids):
    tile(overview,IMAGES/f'{id}-ground-idle-oblique.png',index%4*size,index//4*324,id)
overview.save(OUT/'overview.png')
grips=sorted(IMAGES.glob('*-ground-grip-*.png'))
sheet=Image.new('RGB',(size*4,324*((len(grips)+3)//4)),'#18212e')
for index,file in enumerate(grips):
    tile(sheet,file,index%4*size,index//4*324,file.stem.replace('-ground-grip-',' / '))
sheet.save(OUT/'grips.png')
flight_ids=[id for id in ids if 'forms' in specs[id]]
for start in range(0,len(flight_ids),4):
    page=Image.new('RGB',(size*len(views),324*4),'#18212e')
    for row,id in enumerate(flight_ids[start:start+4]):
        for col,view in enumerate(views):
            tile(page,IMAGES/f'{id}-flight-idle-neutral-{view}.png',col*size,row*324,id+' flight / '+view)
    page.save(OUT/f'flight-geometry-{start//4+1}.png')
flyers=['m04','t07','t08','s10','m08']
for id in flyers:
    form='flight' if 'forms' in specs[id] else 'ground'
    frames=[Image.open(IMAGES/f'{id}-{form}-animation-{i}-oblique.png').convert('RGB') for i in range(60)]
    frames[0].save(OUT/f'{id}-flight.gif',save_all=True,append_images=frames[1:],duration=33,loop=0)
    frames=[Image.open(IMAGES/f'{id}-{form}-animation-neutral-{i}-oblique.png').convert('RGB') for i in range(60)]
    frames[0].save(OUT/f'{id}-flight-neutral.gif',save_all=True,append_images=frames[1:],duration=33,loop=0)
    cycle=Image.new('RGB',(size*4,324*4),'#18212e')
    for index in range(16):
        tile(cycle,IMAGES/f'{id}-{form}-animation-neutral-{index}-oblique.png',index%4*size,index//4*324,id+f' / {index/30:.2f}s')
    cycle.save(OUT/f'{id}-cycle.png')
flight=Image.new('RGB',(size*4,324*len(flyers)),'#18212e')
for row,id in enumerate(flyers):
    form='flight' if 'forms' in specs[id] else 'ground'
    for col,index in enumerate([0,4,8,12]):
        tile(flight,IMAGES/f'{id}-{form}-animation-neutral-{index}-oblique.png',col*size,row*324,id+f' / {index/30:.2f}s')
flight.save(OUT/'flight.png')
print('Gallery written')
