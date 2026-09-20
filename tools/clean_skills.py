"""Clean character skill illustrations background to transparent.
Handles chroma key background removal (Green, Magenta, Blue, White),
internal loops/holes (between limbs, weapons, chassis, canopy windows),
edge color decontamination (despill), vignette battle scenes, HUD overlay
preservation, and anti-aliased alpha.
"""
import os
import cv2
import numpy as np
from PIL import Image

def clean_skill(src_path, out_path):
    fname = os.path.basename(src_path)
    im = Image.open(src_path).convert('RGB')
    arr = np.array(im)
    h, w, _ = arr.shape

    # 1. Screen detection from border pixels
    borders = np.concatenate([arr[0, :], arr[-1, :], arr[:, 0], arr[:, -1]], axis=0)
    is_green = (borders[:, 1].astype(int) > borders[:, 0].astype(int) + 25) & (borders[:, 1].astype(int) > borders[:, 2].astype(int) + 25)
    is_mag = (borders[:, 0].astype(int) > borders[:, 1].astype(int) + 25) & (borders[:, 2].astype(int) > borders[:, 1].astype(int) + 25)
    is_blue = (borders[:, 2].astype(int) > borders[:, 0].astype(int) + 25) & (borders[:, 2].astype(int) > borders[:, 1].astype(int) + 25)
    is_white = (borders[:, 0] > 240) & (borders[:, 1] > 240) & (borders[:, 2] > 240)

    counts = [('green', np.sum(is_green)), ('magenta', np.sum(is_mag)), ('blue', np.sum(is_blue)), ('white', np.sum(is_white))]
    counts.sort(key=lambda x: x[1], reverse=True)
    stype, scount = counts[0]

    r = arr[:, :, 0].astype(float)
    g = arr[:, :, 1].astype(float)
    b = arr[:, :, 2].astype(float)

    if stype == 'green':
        bg_col = np.median(borders[is_green], axis=0)
        is_chroma = (g > r + 15) & (g > b + 15)
    elif stype == 'magenta':
        bg_col = np.median(borders[is_mag], axis=0)
        is_chroma = (r > g + 15) & (b > g + 15)
    elif stype == 'blue':
        bg_col = np.median(borders[is_blue], axis=0)
        is_chroma = (b > r + 15) & (b > g + 15)
    else:
        bg_col = np.median(borders[is_white], axis=0)
        is_chroma = (r > 235) & (g > 235) & (b > 235)

    diff = np.linalg.norm(arr.astype(float) - bg_col.astype(float), axis=-1)

    # 2. Candidate background seed
    if stype == 'white':
        bg_seed = (diff < 30).astype(np.uint8)
        low_t, high_t = 18, 38
    else:
        bg_seed = ((diff < 60) & is_chroma).astype(np.uint8)
        low_t, high_t = 36, 62

    # Special case: t04 HUD preservation
    if fname.startswith('t04_big'):
        hud_zone = np.zeros((h, w), bool)
        hud_zone[90:240, 460:720] = True
        hud_non_bg = hud_zone & ((r > g) | (diff > 45))
        bg_seed[hud_non_bg] = 0

    # Special case: t02 cockpit canopy window
    if fname.startswith('t02_big'):
        flood_map = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(bg_seed, flood_map, (0, 0), 2)
        ext_bg = (flood_map[1:-1, 1:-1] == 1)
        int_holes = np.zeros((h, w), bool)
    else:
        flood_map = np.zeros((h + 2, w + 2), np.uint8)
        for x in range(0, w, 5):
            if bg_seed[0, x]: cv2.floodFill(bg_seed, flood_map, (x, 0), 2)
            if bg_seed[h - 1, x]: cv2.floodFill(bg_seed, flood_map, (x, h - 1), 2)
        for y in range(0, h, 5):
            if bg_seed[y, 0]: cv2.floodFill(bg_seed, flood_map, (0, y), 2)
            if bg_seed[y, w - 1]: cv2.floodFill(bg_seed, flood_map, (w - 1, y), 2)
        ext_bg = (flood_map[1:-1, 1:-1] == 1)

        # Internal holes
        if stype == 'white':
            int_candidates = (diff < 20) & (~ext_bg)
            num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(int_candidates.astype(np.uint8))
            int_holes = np.zeros((h, w), bool)
            for l in range(1, num_labels):
                if stats[l, cv2.CC_STAT_AREA] >= 30:
                    int_holes[labels == l] = True
        else:
            int_holes = (diff < 60) & is_chroma & (~ext_bg)

    # Special case for s03 boba cup transparent plastic showing magenta
    if fname.startswith('s03'):
        cup_zone = (arr[:, :, 1] < 60) & (arr[:, :, 0] > 170) & (arr[:, :, 2] > 170)
        int_holes = int_holes | cup_zone

    all_bg = ext_bg | int_holes

    # 3. Alpha construction
    alpha = np.full((h, w), 255, dtype=np.float32)
    ramp = np.clip((diff - low_t) / (high_t - low_t) * 255.0, 0, 255)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    dilated_bg = cv2.dilate(all_bg.astype(np.uint8), kernel, iterations=1) > 0
    alpha[dilated_bg] = ramp[dilated_bg]
    alpha[all_bg & (diff <= low_t)] = 0

    # Retain solid core for HUD in t04
    if fname.startswith('t04_big'):
        hud_zone = np.zeros((h, w), bool)
        hud_zone[90:240, 460:720] = True
        hud_prot = hud_zone & (r > g) & (diff > 45)
        alpha[hud_prot] = 255

    # Anti-alias transition boundary
    alpha[alpha >= 248] = 255
    trans_mask = (alpha > 0) & (alpha < 248)
    blurred_alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    alpha[trans_mask] = blurred_alpha[trans_mask]
    alpha[all_bg & (diff < low_t)] = 0
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)

    # 4. Despill (color decontamination)
    fg_arr = arr.copy().astype(float)
    rf, gf, bf = fg_arr[:, :, 0], fg_arr[:, :, 1], fg_arr[:, :, 2]

    # Mask for despill: transition pixels and border edge pixels
    despill_mask = (alpha > 0) & (alpha < 255)
    # Also include inner boundary edge pixels (distance transform <= 2)
    edge_inner = (cv2.distanceTransform((alpha == 255).astype(np.uint8), cv2.DIST_L2, 3) <= 2) & (alpha == 255)
    despill_mask = despill_mask | edge_inner

    # Exclude HUD in t04 from despill
    if fname.startswith('t04_big'):
        hud_zone = np.zeros((h, w), bool)
        hud_zone[90:240, 460:720] = True
        despill_mask = despill_mask & (~hud_zone)

    if stype == 'green':
        excess = np.maximum(0, gf - np.maximum(rf, bf))
        apply_mask = despill_mask & (excess > 5)
        fg_arr[:, :, 1] = np.where(apply_mask, gf - excess * 0.95, gf)
    elif stype == 'magenta':
        excess = np.maximum(0, np.minimum(rf - gf, bf - gf))
        apply_mask = despill_mask & (excess > 5)
        fg_arr[:, :, 0] = np.where(apply_mask, rf - excess * 0.95, rf)
        fg_arr[:, :, 2] = np.where(apply_mask, bf - excess * 0.95, bf)
    elif stype == 'blue':
        excess = np.maximum(0, bf - np.maximum(rf, gf))
        apply_mask = despill_mask & (excess > 5)
        fg_arr[:, :, 2] = np.where(apply_mask, bf - excess * 0.95, bf)

    out = np.dstack([np.clip(fg_arr, 0, 255).astype(np.uint8), alpha])
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(out).save(out_path)
    return stype

if __name__ == '__main__':
    char_dir = os.path.join('public', 'assets', 'characters')
    skills = sorted([f for f in os.listdir(char_dir) if f.endswith('_skill.png')])
    print(f'Starting clean_skills on {len(skills)} images...')
    for f in skills:
        src = os.path.join(char_dir, f)
        stype = clean_skill(src, src)
        print(f'Cleaned {f} ({stype})')
    print('All skill portraits cleaned successfully!')
