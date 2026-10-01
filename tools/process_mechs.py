"""Process generated mech standing portraits to transparent PNGs.
Reads JPGs from public/assets/mechs/ and produces transparent PNGs using chroma key removal.
"""
import os
import sys
from clean_skills import clean_skill

MECHS_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'mechs')

def process_all_mechs():
    jpgs = sorted([f for f in os.listdir(MECHS_DIR) if f.endswith('.jpg')])
    print(f"Found {len(jpgs)} mech JPGs in {MECHS_DIR}")
    for f in jpgs:
        base = os.path.splitext(f)[0]
        src = os.path.join(MECHS_DIR, f)
        dst_png = os.path.join(MECHS_DIR, f"{base}.png")
        if not os.path.exists(dst_png) or os.path.getmtime(src) > os.path.getmtime(dst_png):
            stype = clean_skill(src, dst_png)
            print(f"Processed {f} -> {base}.png (chroma: {stype})")
        else:
            print(f"Up to date: {base}.png")

if __name__ == '__main__':
    process_all_mechs()
