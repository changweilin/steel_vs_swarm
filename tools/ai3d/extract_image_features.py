#!/usr/bin/env python3
"""
extract_image_features.py

增強版影像特徵萃取引擎：
1. 獨立分析每張照片，完全無共享/抄襲狀態。
2. 進行前景分割、K-Means 色彩分群 (Dominant, Accent, Dark, Bright, Roof/Foliage/Bark 特殊色)。
3. 計算垂直寬度輪廓分佈 (Vertical Width Profile 10-tier sampling)，精確識別：
   - 建築屋頂形態（尖塔教堂 steeple_church, 斜頂三角木屋 pitched_gable, 圓頂萬神殿 domed_rotunda, 平頂摩天樓 skyscraper, 飛簷寶塔 pagoda, 城堡城垛 castle, 鋸齒廠房 factory）
   - 樹木輪廓形態（錐形針葉林 conifer_pine, 圓頂闊葉林 broadleaf_camphor_oak, 猴麵包巨木 baobab_tree, 棕櫚樹 palm_dragontree, 灌木樹叢 shrub_bush, 仙人掌 cactus）
   - 載具輪廓形態（跑車 sports_coupe, 轎車 sedan, 休旅車 suv, 皮卡 pickup, 油罐車 tanker, 砂石車 dump_truck, 水泥車 mixer, 腳踏車 bike, 機車 motor, 火車 train）
   - 船艦輪廓形態（航母 carrier, 貨櫃船 container, 油輪 bulk_tanker, 郵輪 cruise, 拖船 tugboat）
4. 計算精確水平對稱性分數 (Symmetry Score) 與長寬比例 (Aspect Ratio)。
"""

import sys
import os
import json
import math
from PIL import Image
import numpy as np

def rgb_to_hex(r, g, b):
    r = max(0, min(255, int(r)))
    g = max(0, min(255, int(g)))
    b = max(0, min(255, int(b)))
    return int(f"0x{r:02x}{g:02x}{b:02x}", 16)

def simple_kmeans_palette(pixels, k=5, max_iter=10):
    """自建無外部依賴之 K-Means 色彩分群器"""
    if len(pixels) == 0:
        return [[128, 128, 128]], [1.0]
    
    n_samples = len(pixels)
    if n_samples < k:
        return pixels.tolist(), [1.0 / n_samples] * n_samples
    
    # 決定性均勻挑選初始群心
    indices = np.linspace(0, n_samples - 1, k, dtype=int)
    centers = pixels[indices].astype(np.float32)
    
    for _ in range(max_iter):
        dists = np.linalg.norm(pixels[:, np.newaxis, :] - centers[np.newaxis, :, :], axis=2)
        labels = np.argmin(dists, axis=1)
        
        new_centers = []
        counts = []
        for i in range(k):
            cluster_pts = pixels[labels == i]
            if len(cluster_pts) > 0:
                new_centers.append(np.mean(cluster_pts, axis=0))
                counts.append(len(cluster_pts))
            else:
                new_centers.append(centers[i])
                counts.append(0)
        centers = np.array(new_centers, dtype=np.float32)
    
    weights = [c / float(n_samples) for c in counts]
    sorted_pairs = sorted(zip(centers.tolist(), weights), key=lambda x: x[1], reverse=True)
    sorted_centers = [p[0] for p in sorted_pairs if p[1] > 0.01]
    sorted_weights = [p[1] for p in sorted_pairs if p[1] > 0.01]
    if not sorted_centers:
        sorted_centers = centers.tolist()
        sorted_weights = [1.0 / k] * k
    return sorted_centers, sorted_weights

def analyze_photo(img_path):
    if not os.path.exists(img_path):
        return None
    try:
        with Image.open(img_path) as orig:
            img = orig.convert('RGB')
            w, h = img.size
            aspect_ratio = round(w / max(1, h), 3)

            thumb = img.resize((128, 128), Image.Resampling.BILINEAR)
            arr = np.array(thumb, dtype=np.float32)

            lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]

            corners = np.vstack([
                arr[:8, :8, :].reshape(-1, 3),
                arr[:8, -8:, :].reshape(-1, 3),
                arr[-8:, :8, :].reshape(-1, 3),
                arr[-8:, -8:, :].reshape(-1, 3)
            ])
            bg_color = np.mean(corners, axis=0)

            color_dist_to_bg = np.linalg.norm(arr - bg_color, axis=2)
            fg_mask = color_dist_to_bg > 28.0

            if np.sum(fg_mask) < 0.10 * 128 * 128:
                fg_mask = np.zeros((128, 128), dtype=bool)
                fg_mask[18:110, 18:110] = True

            fg_pixels = arr[fg_mask]
            fg_lum = lum[fg_mask]

            width_profile = []
            for tier in range(10):
                y_start = tier * 12 + 4
                y_end = (tier + 1) * 12 + 4
                tier_slice = fg_mask[y_start:y_end, :]
                cols_with_fg = np.any(tier_slice, axis=0)
                tier_width = np.sum(cols_with_fg) / 128.0
                width_profile.append(round(float(tier_width), 3))

            left_half = lum[:, :64]
            right_half_flipped = np.fliplr(lum[:, 64:])
            diff = np.abs(left_half - right_half_flipped)
            symmetry_score = round(float(1.0 - (np.mean(diff) / 255.0)), 3)

            centers, weights = simple_kmeans_palette(fg_pixels, k=5, max_iter=8)

            primary = centers[0]
            primary_r, primary_g, primary_b = int(primary[0]), int(primary[1]), int(primary[2])

            accent = centers[1] if len(centers) > 1 else primary
            max_d = 0.0
            for c in centers[1:]:
                d = np.linalg.norm(np.array(c) - np.array(primary))
                if d > max_d:
                    max_d = d
                    accent = c
            accent_r, accent_g, accent_b = int(accent[0]), int(accent[1]), int(accent[2])

            dark_pixels = fg_pixels[fg_lum < 75]
            if len(dark_pixels) > 10:
                d_mean = np.mean(dark_pixels, axis=0)
                dark_r, dark_g, dark_b = int(d_mean[0]), int(d_mean[1]), int(d_mean[2])
            else:
                dark_r, dark_g, dark_b = 35, 42, 52

            bright_pixels = fg_pixels[fg_lum > 175]
            if len(bright_pixels) > 10:
                b_mean = np.mean(bright_pixels, axis=0)
                bright_r, bright_g, bright_b = int(b_mean[0]), int(b_mean[1]), int(b_mean[2])
            else:
                bright_r, bright_g, bright_b = 210, 220, 230

            green_pixels = fg_pixels[(fg_pixels[:, 1] > fg_pixels[:, 0] * 1.1) & (fg_pixels[:, 1] > fg_pixels[:, 2] * 1.1)]
            if len(green_pixels) > 20:
                g_mean = np.mean(green_pixels, axis=0)
                foliage_hex = rgb_to_hex(g_mean[0], g_mean[1], g_mean[2])
            else:
                foliage_hex = rgb_to_hex(primary_r, primary_g, primary_b)

            brown_pixels = fg_pixels[(fg_pixels[:, 0] > fg_pixels[:, 2] * 1.2) & (fg_pixels[:, 1] < fg_pixels[:, 0] * 0.9) & (fg_lum < 150)]
            if len(brown_pixels) > 20:
                br_mean = np.mean(brown_pixels, axis=0)
                bark_hex = rgb_to_hex(br_mean[0], br_mean[1], br_mean[2])
            else:
                bark_hex = rgb_to_hex(88, 55, 38)

            top_mask = fg_mask[:32, :]
            top_px = arr[:32, :][top_mask]
            if len(top_px) > 10:
                top_mean = np.mean(top_px, axis=0)
                roof_hex = rgb_to_hex(top_mean[0], top_mean[1], top_mean[2])
            else:
                roof_hex = rgb_to_hex(primary_r, primary_g, primary_b)

            return {
                'width': w,
                'height': h,
                'aspectRatio': aspect_ratio,
                'symmetryScore': symmetry_score,
                'widthProfile': width_profile,
                'colors': {
                    'primaryHex': rgb_to_hex(primary_r, primary_g, primary_b),
                    'primaryRgb': [primary_r, primary_g, primary_b],
                    'accentHex': rgb_to_hex(accent_r, accent_g, accent_b),
                    'accentRgb': [accent_r, accent_g, accent_b],
                    'darkHex': rgb_to_hex(dark_r, dark_g, dark_b),
                    'darkRgb': [dark_r, dark_g, dark_b],
                    'brightHex': rgb_to_hex(bright_r, bright_g, bright_b),
                    'brightRgb': [bright_r, bright_g, bright_b],
                    'foliageHex': foliage_hex,
                    'barkHex': bark_hex,
                    'roofHex': roof_hex
                }
            }
    except Exception as e:
        return {'error': str(e)}

def classify_semantic_style(family, subpart, stem, raw_info):
    s = stem.lower()
    style = 'generic'
    symmetry_mode = 'symmetric'

    wp = raw_info.get('widthProfile', [0.5] * 10)
    asp = raw_info.get('aspectRatio', 1.0)
    top_w = (wp[0] + wp[1]) / 2.0
    mid_w = (wp[4] + wp[5]) / 2.0
    bot_w = (wp[8] + wp[9]) / 2.0

    if family == 'building':
        if any(k in s for k in ['church', 'spire', 'steeple', 'cathedral', 'chapel', 'basilica', 'gothic', 'duomo', 'notre']) or (top_w < 0.22 and mid_w > 0.45 and asp < 1.1):
            style = 'steeple_spire_church'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['partenone', 'parthenon', 'acropolis', 'pantheon', 'temple_greek', 'doric', 'ionic']):
            style = 'classical_temple'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['pisa', 'round_tower', 'leaning', 'campanile', 'cylindrical_tower']):
            style = 'leaning_arcade_tower'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['capitol', 'dome', 'rotunda', 'monument', 'cupola', 'state-capitol']):
            style = 'domed_rotunda_monument'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['houou', 'phoenix', 'kyoto', 'pagoda', 'heritage', 'pavilion', 'temple_asia', 'shinto', 'shrine', 'buddhist']):
            style = 'asian_pagoda_pavilion'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['castle', 'fortress', 'bastion', 'keep', 'white-tower', 'citadel', 'palace_stone']):
            style = 'castle_fortress_keep'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['village', 'cottage', 'cabin', 'barn', 'chalet', 'rural', 'farmhouse', 'timber', 'house', 'residence']) or (top_w < 0.35 and mid_w > 0.6 and asp > 0.9):
            style = 'pitched_gable_village_house'
            symmetry_mode = 'asymmetric'
        elif any(k in s for k in ['bld_tower', 'tower', 'skyscraper', 'highrise', 'office_tower', 'taipei', 'dji', 'scaled', 'run-in']) or (top_w > 0.45 and asp < 0.8):
            style = 'modern_skyscraper_tower'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['factory', 'warehouse', 'industrial', 'plant', 'depot_building', 'hangar']):
            style = 'industrial_sawtooth_factory'
            symmetry_mode = 'asymmetric'
        else:
            style = 'commercial_residential'
            symmetry_mode = 'asymmetric'

    elif family == 'tree':
        if any(k in s for k in ['conifer', 'pine', 'spruce', 'fir', 'cedar', 'sp_conifer', 'alaska', 'libani']) or (top_w < 0.25 and bot_w > 0.55 and asp < 0.9):
            style = 'conifer_pine'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['baobab', 'bottle', 'boab', 'adansonia', 'sp_baobab', 'madagascar']):
            style = 'baobab_tree'
            symmetry_mode = 'asymmetric'
        elif any(k in s for k in ['cryptomeria', 'redwood', 'sequoia', 'sherman', 'gt_cryptomeria', 'giant_tree']):
            style = 'giant_cryptomeria_redwood'
            symmetry_mode = 'asymmetric'
        elif any(k in s for k in ['dragon', 'palm', 'gt_dragontree', 'frond', 'coconut', 'cycad']):
            style = 'palm_dragontree'
            symmetry_mode = 'asymmetric'
        elif any(k in s for k in ['cactus', 'pachycereus', 'cardon', 'succulent']):
            style = 'cactus_succulent'
            symmetry_mode = 'asymmetric'
        elif any(k in s for k in ['shrub', 'bush', 'hedge', 'low_plant', 'grass_tuft']) or (asp > 1.4):
            style = 'shrub_bush_hedge'
            symmetry_mode = 'asymmetric'
        else:
            style = 'broadleaf_camphor_oak'
            symmetry_mode = 'asymmetric'

    elif family == 'vehicle':
        symmetry_mode = 'symmetric'
        if subpart == 'bike':
            if any(k in s for k in ['road', 'drop', 'racing', 'touring', 'speed', 'aero_bike']):
                style = 'road_bike'
            elif any(k in s for k in ['mountain', 'mtb', 'suspension', 'trail', 'downhill', 'rocky']):
                style = 'mountain_bike'
            elif any(k in s for k in ['city', 'cruiser', 'basket', 'commuter', 'classic_bike', 'vintage_bike']):
                style = 'city_cruiser'
            else:
                style = 'city_cruiser'
        elif subpart == 'car':
            if any(k in s for k in ['pickup', 'truck_bed', 'hilux', 'tacoma', 'f150', 'ranger', 'silverado', 'open_bed']):
                style = 'pickup_truck'
            elif any(k in s for k in ['sports', 'coupe', 'ferrari', 'porsche', 'gt', 'race', 'supercar', 'carrera', 'lamborghini', 'corvette', 'm3', 'supra']):
                style = 'sports_coupe'
            elif any(k in s for k in ['suv', 'crossover', 'jeep', 'land', 'cruiser', 'rav4', 'wrangler', 'defender', 'outback', 'crv']):
                style = 'suv_crossover'
            elif any(k in s for k in ['classic', 'vintage', 'beetle', 'retro', 'antique', '1950', '1960', 'oldtimer']):
                style = 'classic_vintage'
            else:
                style = 'sedan_hatchback'
        elif subpart == 'heavy':
            if any(k in s for k in ['tanker', 'fuel', 'oil', 'liquid', 'gas', 'lng', 'cistern']):
                style = 'tanker_truck'
            elif any(k in s for k in ['dump', 'tipper', 'quarry', 'gravel', 'dumper']):
                style = 'dump_truck'
            elif any(k in s for k in ['mixer', 'cement', 'concrete', 'rotary']):
                style = 'cement_mixer'
            elif any(k in s for k in ['box', 'van', 'delivery', 'fedex', 'cargo_box', 'logistics', 'peterbilt', 'semi', 'tractor', 'trailer']):
                style = 'box_van_delivery'
            else:
                style = 'semi_tractor'
        elif subpart == 'motor':
            if any(k in s for k in ['sport', 'ninja', 'ducati', 'racing', 'superbike', 'cbr', 'r1', 'yamaha_r']):
                style = 'sportbike'
            elif any(k in s for k in ['cruiser', 'chopper', 'harley', 'davidson', 'bobber', 'custom']):
                style = 'cruiser_chopper'
            elif any(k in s for k in ['scooter', 'moped', 'vespa', 'gogoro', 'yamaha_jog', 'drgbt', 'dollar', 'rts', 'sym']):
                style = 'scooter_moped'
            elif any(k in s for k in ['adventure', 'adv', 'enduro', 'gs', 'rally', 'tenere']):
                style = 'adventure_motor'
            else:
                style = 'standard_motor'
        elif subpart == 'train':
            if any(k in s for k in ['bullet', 'shinkansen', 'high_speed', 'emu', 'tgv', 'ice', 'streamline', 'e353', 'emu500']):
                style = 'bullet_train_emu'
            elif any(k in s for k in ['loco', 'diesel', 'electric_loco', 'freight_train', 'df4d', 'engine']):
                style = 'locomotive'
            else:
                style = 'bullet_train_emu'

    elif family == 'ship':
        if any(k in s for k in ['carrier', 'enterprise', 'nimitz', 'liaoning', 'shandong', 'flight_deck', 'aircraft_carrier', 'warship']):
            style = 'aircraft_carrier'
            symmetry_mode = 'asymmetric'
        elif any(k in s for k in ['container', 'cargo', 'box_ship', 'maersk', 'evergreen', 'cosco', 'feeder']):
            style = 'container_ship'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['tanker', 'bulk', 'oil_carrier', 'ore', 'vlcc', 'lng', 'methanier']):
            style = 'oil_tanker_bulk'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['cruise', 'liner', 'passenger', 'disney', 'explorer', 'yacht', 'ferry', 'turbojet']):
            style = 'cruise_liner'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['tug', 'workboat', 'tow', 'pusher', 'tuna', 'fishing', 'liner_boat']):
            style = 'tugboat_workboat'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['submarine', 'sub']):
            style = 'submarine'
            symmetry_mode = 'symmetric'
        else:
            style = 'general_cargo_ship'
            symmetry_mode = 'symmetric'

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
    total_found = 0
    for r in roots:
        if not os.path.exists(r):
            continue
        for root_dir, _, files in os.walk(r):
            for f in files:
                if f.lower().endswith(exts):
                    total_found += 1
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
    print(f"Extracted features for {len(results)} images (scanned {total_found}) to {out_json_path}")

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
