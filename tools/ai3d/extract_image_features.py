#!/usr/bin/env python3
"""
extract_image_features.py

直接讀取照片，萃取物件外觀細部特徵：
1. 影像尺寸、長寬比 (Aspect Ratio)
2. 色彩分析 (主體色彩、次要點綴色、玻璃窗色、金屬/暗部色)
3. 空間亮度與邊緣分佈 (垂直三段 Profile、水平對稱性分數)
4. 物件語意細分型態 (Sub-style Classification)
5. 對稱性判定 (Symmetric vs Asymmetric)
"""

import sys
import os
import json
import math
from PIL import Image
import numpy as np

def rgb_to_hex(r, g, b):
    return int(f"0x{r:02x}{g:02x}{b:02x}", 16)

def analyze_photo(img_path):
    if not os.path.exists(img_path):
        return None
    try:
        with Image.open(img_path) as orig:
            img = orig.convert('RGB')
            w, h = img.size
            aspect_ratio = round(w / max(1, h), 3)

            # 縮小為 128x128 進行高速色彩與空間分析
            thumb = img.resize((128, 128), Image.Resampling.BILINEAR)
            arr = np.array(thumb, dtype=np.float32)

            # 亮度圖 (Luminance)
            lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]

            # 水平對稱性分析 (左半部 vs 翻轉右半部)
            left_half = lum[:, :64]
            right_half_flipped = np.fliplr(lum[:, 64:])
            diff = np.abs(left_half - right_half_flipped)
            symmetry_score = round(float(1.0 - (np.mean(diff) / 255.0)), 3)

            # 垂直亮度分佈 (Top 33%, Mid 34%, Bot 33%)
            top_lum = float(np.mean(lum[:42, :]))
            mid_lum = float(np.mean(lum[42:85, :]))
            bot_lum = float(np.mean(lum[85:, :]))

            # 色彩採樣 (排除最上方 10% 天空/背景後的中心主體區)
            subject_area = arr[15:115, 15:115, :]
            mean_color = np.mean(subject_area, axis=(0, 1))
            primary_r, primary_g, primary_b = int(mean_color[0]), int(mean_color[1]), int(mean_color[2])

            # 尋找高飽和度/對比次要色 (Trim / Accent)
            flat_pixels = subject_area.reshape(-1, 3)
            dists = np.linalg.norm(flat_pixels - mean_color, axis=1)
            accent_idx = np.argmax(dists)
            accent_r, accent_g, accent_b = int(flat_pixels[accent_idx, 0]), int(flat_pixels[accent_idx, 1]), int(flat_pixels[accent_idx, 2])

            # 窗戶/陰影暗色
            dark_pixels = flat_pixels[lum[15:115, 15:115].reshape(-1) < 80]
            if len(dark_pixels) > 0:
                dark_mean = np.mean(dark_pixels, axis=0)
                dark_r, dark_g, dark_b = int(dark_mean[0]), int(dark_mean[1]), int(dark_mean[2])
            else:
                dark_r, dark_g, dark_b = 40, 50, 60

            # 金屬/亮部色
            bright_pixels = flat_pixels[lum[15:115, 15:115].reshape(-1) > 180]
            if len(bright_pixels) > 0:
                bright_mean = np.mean(bright_pixels, axis=0)
                bright_r, bright_g, bright_b = int(bright_mean[0]), int(bright_mean[1]), int(bright_mean[2])
            else:
                bright_r, bright_g, bright_b = 200, 210, 220

            return {
                'width': w,
                'height': h,
                'aspectRatio': aspect_ratio,
                'symmetryScore': symmetry_score,
                'profiles': {
                    'topLuminance': round(top_lum, 1),
                    'midLuminance': round(mid_lum, 1),
                    'botLuminance': round(bot_lum, 1),
                },
                'colors': {
                    'primaryHex': rgb_to_hex(primary_r, primary_g, primary_b),
                    'primaryRgb': [primary_r, primary_g, primary_b],
                    'accentHex': rgb_to_hex(accent_r, accent_g, accent_b),
                    'accentRgb': [accent_r, accent_g, accent_b],
                    'darkHex': rgb_to_hex(dark_r, dark_g, dark_b),
                    'darkRgb': [dark_r, dark_g, dark_b],
                    'brightHex': rgb_to_hex(bright_r, bright_g, bright_b),
                    'brightRgb': [bright_r, bright_g, bright_b],
                }
            }
    except Exception as e:
        return {'error': str(e)}

def classify_semantic_style(family, subpart, stem, raw_info):
    s = stem.lower()
    style = 'generic'
    symmetry_mode = 'symmetric'  # 預設多數人造載具與古典對稱建築為對稱

    if family == 'building':
        if any(k in s for k in ['partenone', 'parthenon', 'temple', 'acropolis', 'pantheon']):
            style = 'classical_temple'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['pisa', 'round_tower', 'leaning', 'campanile']):
            style = 'leaning_arcade_tower'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['houou', 'phoenix', 'kyoto', 'pagoda', 'heritage', 'pavilion', 'temple_asia']):
            style = 'asian_pagoda_pavilion'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['white-tower', 'castle', 'fortress', 'bastion', 'keep']):
            style = 'castle_fortress'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['bld_tower', 'tower', 'state-capitol', 'taipei', 'dji', 'run-in', 'scaled', 'skyscraper']):
            style = 'modern_skyscraper_tower'
            symmetry_mode = 'symmetric'
        else:
            style = 'commercial_residential'
            symmetry_mode = 'asymmetric'  # 隨機現代建築背面增加逃生梯/管線/排氣

    elif family == 'vehicle':
        symmetry_mode = 'symmetric'
        if subpart == 'car':
            if any(k in s for k in ['pickup', 'truck_bed', 'hilux', 'tacoma', 'f150']):
                style = 'pickup_truck'
            elif any(k in s for k in ['sports', 'coupe', 'ferrari', 'porsche', 'gt', 'race', 'supercar']):
                style = 'sports_coupe'
            elif any(k in s for k in ['suv', 'crossover', 'jeep', 'land', 'cruiser', 'rav4']):
                style = 'suv_crossover'
            elif any(k in s for k in ['classic', 'vintage', 'beetle', 'retro', 'antique', '1950', '1960']):
                style = 'classic_vintage'
            else:
                style = 'sedan_hatchback'
        elif subpart == 'heavy':
            if any(k in s for k in ['tanker', 'fuel', 'oil', 'liquid', 'gas']):
                style = 'tanker_truck'
            elif any(k in s for k in ['dump', 'tipper', 'quarry', 'gravel']):
                style = 'dump_truck'
            elif any(k in s for k in ['mixer', 'cement', 'concrete']):
                style = 'cement_mixer'
            elif any(k in s for k in ['crane', 'boom', 'heavy_lift', 'hoist']):
                style = 'crane_construction'
            elif any(k in s for k in ['box', 'van', 'delivery', 'fedex', 'cargo_box']):
                style = 'box_van_delivery'
            else:
                style = 'semi_tractor'
        elif subpart == 'motor':
            if any(k in s for k in ['sport', 'ninja', 'ducati', 'racing', 'superbike', 'cbr']):
                style = 'sportbike'
            elif any(k in s for k in ['cruiser', 'chopper', 'harley', 'davidson', 'bobber']):
                style = 'cruiser_chopper'
            elif any(k in s for k in ['scooter', 'moped', 'vespa', 'gogoro', 'yamaha_jog']):
                style = 'scooter_moped'
            elif any(k in s for k in ['adventure', 'adv', 'enduro', 'gs', 'rally']):
                style = 'adventure_motor'
            else:
                style = 'standard_motor'
        elif subpart == 'bike':
            if any(k in s for k in ['road', 'drop', 'racing', 'touring', 'speed']):
                style = 'road_bike'
            elif any(k in s for k in ['mountain', 'mtb', 'suspension', 'trail', 'downhill']):
                style = 'mountain_bike'
            elif any(k in s for k in ['city', 'cruiser', 'basket', 'commuter', 'classic_bike']):
                style = 'city_cruiser'
            else:
                style = 'cargo_bike'
        elif subpart == 'train':
            if any(k in s for k in ['bullet', 'shinkansen', 'high_speed', 'emu', 'tgv', 'ice', 'streamline']):
                style = 'bullet_train_emu'
            elif any(k in s for k in ['loco', 'diesel', 'electric_loco', 'freight_train', 'engine']):
                style = 'locomotive'
            elif any(k in s for k in ['coach', 'passenger', 'carriage']):
                style = 'passenger_coach'
            else:
                style = 'freight_wagon'

    elif family == 'ship':
        if any(k in s for k in ['carrier', 'enterprise', 'nimitz', 'liaoning', 'shandong', 'flight_deck']):
            style = 'aircraft_carrier'
            symmetry_mode = 'asymmetric'  # 航母艦島在右舷
        elif any(k in s for k in ['container', 'cargo', 'box_ship', 'maersk', 'evergreen', 'cosco']):
            style = 'container_ship'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['tanker', 'bulk', 'oil_carrier', 'ore', 'vlcc']):
            style = 'oil_tanker_bulk'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['cruise', 'liner', 'passenger', 'ferry', 'yacht']):
            style = 'cruise_liner'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['tug', 'workboat', 'tow', 'pusher']):
            style = 'tugboat_workboat'
            symmetry_mode = 'symmetric'
        else:
            style = 'general_cargo_ship'
            symmetry_mode = 'symmetric'

    elif family == 'tree':
        symmetry_mode = 'asymmetric'
        if any(k in s for k in ['conifer', 'pine', 'spruce', 'fir', 'cedar', 'sp_conifer']):
            style = 'conifer_pine'
            symmetry_mode = 'symmetric'  # 針葉樹/松柏外觀近似錐體對稱
        elif any(k in s for k in ['camphor', 'oak', 'broadleaf', 'banyan', 'bl_camphor']):
            style = 'broadleaf_camphor_oak'
        elif any(k in s for k in ['cryptomeria', 'redwood', 'sequoia', 'giant', 'gt_cryptomeria']):
            style = 'giant_cryptomeria_redwood'
        elif any(k in s for k in ['baobab', 'bottle', 'sp_baobab']):
            style = 'baobab_tree'
        elif any(k in s for k in ['dragon', 'palm', 'gt_dragontree', 'frond']):
            style = 'palm_dragontree'
        else:
            style = 'broadleaf_camphor_oak'

    elif family == 'rock':
        symmetry_mode = 'asymmetric'
        if any(k in s for k in ['basalt', 'column', 'prism', 'hexagonal', 'joint']):
            style = 'columnar_basalt'
        elif any(k in s for k in ['boulder', 'glacial', 'erratic', 'round', 'smooth']):
            style = 'weathered_boulder'
        else:
            style = 'jagged_crag'

    return {
        'style': style,
        'symmetryMode': symmetry_mode
    }

def analyze_all_photos_to_json(roots, out_json_path):
    exts = ('.jpg', '.jpeg', '.png', '.webp')
    results = {}
    for r in roots:
        if not os.path.exists(r):
            continue
        for root_dir, _, files in os.walk(r):
            for f in files:
                if f.lower().endswith(exts):
                    full_p = os.path.join(root_dir, f)
                    rel_p = os.path.relpath(full_p, r).replace('\\', '/')
                    segs = rel_p.split('/')
                    fam = segs[0] if len(segs) > 0 else 'misc'
                    sub = segs[1] if len(segs) > 2 else ('mass' if fam == 'building' else ('hull' if fam == 'ship' else ('canopy' if fam == 'tree' else 'main')))
                    stem = os.path.splitext(f)[0]
                    raw = analyze_photo(full_p)
                    if raw and 'error' not in raw:
                        classification = classify_semantic_style(fam, sub, stem, raw)
                        results[full_p] = {
                            'image': rel_p,
                            'fullPath': full_p,
                            'family': fam,
                            'subpart': sub,
                            'stem': stem,
                            'analysis': raw,
                            'classification': classification
                        }
    with open(out_json_path, 'w', encoding='utf-8') as fp:
        json.dump(results, fp, ensure_ascii=False, indent=2)
    print(f"Extracted features for {len(results)} images to {out_json_path}")

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--all':
        roots = [
            r'C:\Users\user\Documents\study\ai3d_restricted\photos',
            r'C:\Users\user\.gemini\antigravity\worktrees\steel_vs_swarm\enhanced_3d_reconstruction_pipeline\tools\ai3d\photos'
        ]
        out_p = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), 'extracted_features.json')
        analyze_all_photos_to_json(roots, out_p)
    elif len(sys.argv) > 1:
        img_p = sys.argv[1]
        fam = sys.argv[2] if len(sys.argv) > 2 else 'misc'
        sub = sys.argv[3] if len(sys.argv) > 3 else 'main'
        stem = sys.argv[4] if len(sys.argv) > 4 else os.path.splitext(os.path.basename(img_p))[0]

        raw = analyze_photo(img_p)
        if not raw or 'error' in raw:
            print(json.dumps({'error': raw.get('error', 'Failed to read image') if raw else 'Empty result'}))
            sys.exit(0)

        classification = classify_semantic_style(fam, sub, stem, raw)
        result = {
            'image': img_p,
            'family': fam,
            'subpart': sub,
            'stem': stem,
            'analysis': raw,
            'classification': classification
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
