"""Clean character portraits background to transparent.
Handles chroma key background removal, internal holes (loops, cables, handles),
edge color decontamination (despill), artifact removal, and anti-aliased alpha.
"""
import os
import cv2
import numpy as np
from PIL import Image
import rembg

def clean_portrait(src_path, out_path):
    fname = os.path.basename(src_path)
    im = Image.open(src_path).convert('RGB')
    w, h = im.size
    arr = np.array(im)

    # 1. Background color estimation
    borders = np.concatenate([arr[0, :], arr[-1, :], arr[:, 0], arr[:, -1]], axis=0)
    bg_color = np.median(borders, axis=0)
    r_bg, g_bg, b_bg = bg_color

    # 2. rembg mask
    rem = rembg.remove(im)
    rem_arr = np.array(rem)
    rem_alpha = rem_arr[:, :, 3]

    # 3. Color distance
    diff = np.linalg.norm(arr.astype(float) - bg_color.astype(float), axis=-1)

    # 4. Background candidates:
    # Close to bg_color OR rejected by rembg OR white border artifact (s05)
    white_edge = ((arr[:, :, 0] > 230) & (arr[:, :, 1] > 230) & (arr[:, :, 2] > 230) & (rem_alpha < 140))
    is_bg_color = (diff < 52) | white_edge

    # Flood fill from outside to identify true external background
    flood_map = np.zeros((h + 2, w + 2), np.uint8)
    bg_seed = is_bg_color.astype(np.uint8)
    for x in range(0, w, 10):
        if bg_seed[0, x]: cv2.floodFill(bg_seed, flood_map, (x, 0), 2)
        if bg_seed[h - 1, x]: cv2.floodFill(bg_seed, flood_map, (x, h - 1), 2)
    for y in range(0, h, 10):
        if bg_seed[y, 0]: cv2.floodFill(bg_seed, flood_map, (0, y), 2)
        if bg_seed[y, w - 1]: cv2.floodFill(bg_seed, flood_map, (w - 1, y), 2)

    ext_bg = (flood_map[1:-1, 1:-1] == 1)

    # Internal holes: any pixel matching bg_color
    int_holes = (diff < 48)

    # Initial alpha
    alpha = rem_alpha.copy()
    alpha[ext_bg] = 0
    alpha[int_holes] = 0

    # Special handling for s03 boba cup transparent plastic showing magenta
    if fname.startswith('s03'):
        cup_zone = (arr[:, :, 1] < 50) & (arr[:, :, 0] > 180) & (arr[:, :, 2] > 180)
        alpha[cup_zone] = 0

    # Special handling for t05 green watercolor splatters on background
    if fname.startswith('t05'):
        green_splatter = (alpha > 0) & (arr[:, :, 1].astype(int) > arr[:, :, 0].astype(int) + 20) & (arr[:, :, 1].astype(int) > arr[:, :, 2].astype(int) + 20)
        alpha[green_splatter] = 0

    # Special handling for m06: remove smoke / pipe debris under left elbow
    if fname.startswith('m06'):
        for y in range(715, h):
            alpha[y, :240] = 0

    # 5. Connected components to remove detached floating noise/splashes
    binary_fg = (alpha > 30).astype(np.uint8)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary_fg, connectivity=8)
    if num_labels > 1:
        main_label = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        main_area = stats[main_label, cv2.CC_STAT_AREA]
        for l in range(1, num_labels):
            if l != main_label:
                # If area is smaller than threshold, delete it
                if fname.startswith('s09'):
                    # Keep hunting hound in s09 (>5% of main area)
                    if stats[l, cv2.CC_STAT_AREA] < main_area * 0.05:
                        alpha[labels == l] = 0
                else:
                    if stats[l, cv2.CC_STAT_AREA] < main_area * 0.02:
                        alpha[labels == l] = 0

    # 6. VFX De-spill (color decontamination)
    fg_arr = arr.copy().astype(float)
    r, g, b = fg_arr[:, :, 0], fg_arr[:, :, 1], fg_arr[:, :, 2]

    if g_bg > r_bg + 25 and g_bg > b_bg + 25:
        # Green screen: suppress green spill where g > max(r, b)
        excess = np.maximum(0, g - np.maximum(r, b))
        edge_mask = (alpha > 0) & (excess > 8)
        fg_arr[:, :, 1] = np.where(edge_mask, g - excess * 0.95, g)
    elif r_bg > g_bg + 25 and b_bg > g_bg + 25:
        # Magenta screen: suppress r and b excess over g
        excess = np.maximum(0, np.minimum(r - g, b - g))
        edge_mask = (alpha > 0) & (excess > 8)
        fg_arr[:, :, 0] = np.where(edge_mask, r - excess * 0.95, r)
        fg_arr[:, :, 2] = np.where(edge_mask, b - excess * 0.95, b)
    elif b_bg > r_bg + 25 and b_bg > g_bg + 25:
        # Blue screen: suppress b excess over max(r, g)
        excess = np.maximum(0, b - np.maximum(r, g))
        edge_mask = (alpha > 0) & (excess > 8)
        fg_arr[:, :, 2] = np.where(edge_mask, b - excess * 0.95, b)

    # 7. Alpha edge polish:
    # Snap solid core to 255
    alpha = np.where(alpha >= 248, 255, alpha)
    # Anti-alias transition boundary
    trans_mask = (alpha > 5) & (alpha < 248)
    blurred_alpha = cv2.GaussianBlur(alpha.astype(np.float32), (3, 3), 0)
    alpha[trans_mask] = blurred_alpha[trans_mask]
    # Strict background suppression
    alpha[diff < 40] = 0

    out = np.dstack([np.clip(fg_arr, 0, 255).astype(np.uint8), alpha.astype(np.uint8)])
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(out).save(out_path)
    return bg_color

if __name__ == '__main__':
    char_dir = os.path.join('public', 'assets', 'characters')
    files = sorted([f for f in os.listdir(char_dir) if f.endswith('_base.png')])
    for f in files:
        src = os.path.join(char_dir, f)
        bg = clean_portrait(src, src)
        print(f'Cleaned {f}')
