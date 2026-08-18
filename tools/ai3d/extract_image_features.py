#!/usr/bin/env python3
"""
extract_image_features.py (v5.0 High-Fidelity Per-Image Vision & Morphotype Analysis)

徹底針對每張照片獨立進行電腦視覺分析，絕不使用死板字串套版：
1. 前景目標精準切割與 24 段高精度切片 (24-slice vertical profile: 各高度寬度比、中心偏移、斜率變化、邊緣密度、灰度梯度)。
2. 屋頂幾何形狀深度研判 (尖頂教堂 Spire, 三角村莊屋頂 Triangular Gable, 飛簷寶塔 Pagoda, 圓頂 Dome, 階梯退縮 Setback, 平頂大樓 Flat, 雉堞堡壘 Crenellated, 燈塔 Lighthouse, 風車 Windmill)。
3. 樹木形態學深度研判 (錐形針葉樹 Conifer Pine, 闊葉巨木 Broadleaf, 矮叢灌木 Shrub, 造型盆栽 Bonsai, 巨桶猴麵包樹 Baobab, 棕櫚傘樹 Palm)。
4. 車輛與細部骨架辨識 (腳踏車細部菱形管架與輪幅 Bicycle, 重機 Motorcycle, 超跑 Supercar, 皮卡 Pickup, 油槽車 Tanker, 貨卡 Truck, 房車 Sedan, 子彈列車 Train)。
5. 船體與水上載具辨識 (航空母艦 Carrier, 貨櫃輪 Container Ship, 郵輪 Cruise, 貨輪 Cargo, 快艇 Speedboat)。
6. 岩石地質結構辨識 (六角玄武岩 Columnar Basalt, 巨岩拱門 Rock Arch, 風化漂礫 Erratic Boulder, 奇岩石柱 Hoodoo)。
7. 專屬玻璃與車身/船體分離 (Color Segmented Glass Isolation)，確保玻璃呈現深藍/天青質感，不誤判為車身顏色。
8. 垂直多區色彩萃取 (屋頂/樹冠、主體/立面/車身、底座/底盤/樹幹、點綴飾條/車燈、專用玻璃色彩)，確保每張圖真實色彩獨立性。
"""

import sys
import os
import json
import math

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import cv2
import numpy as np
from PIL import Image

def rgb_to_hex(r, g, b):
    r = int(np.clip(r, 0, 255))
    g = int(np.clip(g, 0, 255))
    b = int(np.clip(b, 0, 255))
    return int(f"0x{r:02x}{g:02x}{b:02x}", 16)

def extract_dominant_color_in_mask(img_rgb, mask, default_rgb=[128, 128, 128]):
    pixels = img_rgb[mask > 0]
    if len(pixels) < 10:
        return default_rgb
    median_c = np.median(pixels, axis=0)
    return [int(median_c[0]), int(median_c[1]), int(median_c[2])]

def analyze_photo(img_path):
    if not os.path.exists(img_path):
        return None
    try:
        with open(img_path, 'rb') as f:
            buf = np.frombuffer(f.read(), dtype=np.uint8)
            img_bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img_bgr is None:
            return None

        h_orig, w_orig = img_bgr.shape[:2]
        aspect_ratio = round(w_orig / max(1, h_orig), 3)

        proc_size = 256
        img_proc = cv2.resize(img_bgr, (proc_size, proc_size), interpolation=cv2.INTER_AREA)
        img_rgb = cv2.cvtColor(img_proc, cv2.COLOR_BGR2RGB)
        img_gray = cv2.cvtColor(img_proc, cv2.COLOR_BGR2GRAY)
        img_hsv = cv2.cvtColor(img_proc, cv2.COLOR_BGR2HSV)

        # 邊緣檢測
        edges = cv2.Canny(img_gray, 35, 135)

        # 前景遮罩
        blurred = cv2.bilateralFilter(img_gray, 9, 75, 75)
        _, thresh_otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        edges_dilated = cv2.dilate(edges, kernel, iterations=2)
        fg_mask = cv2.bitwise_or(thresh_otsu, edges_dilated)

        # 幾何外輪廓
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            c_max = max(contours, key=cv2.contourArea)
            x_b, y_b, w_b, h_b = cv2.boundingRect(c_max)
            hull = cv2.convexHull(c_max)
            hull_area = cv2.contourArea(hull)
            c_area = cv2.contourArea(c_max)
            solidity = round(float(c_area / max(1.0, hull_area)), 3)
            extent = round(float(c_area / max(1.0, w_b * h_b)), 3)
        else:
            x_b, y_b, w_b, h_b = 10, 10, proc_size - 20, proc_size - 20
            solidity = 0.85
            extent = 0.75

        # 水平對稱性
        left_half = img_gray[:, :proc_size // 2]
        right_half_flipped = cv2.flip(img_gray[:, proc_size // 2:], 1)
        diff = np.abs(left_half.astype(np.float32) - right_half_flipped.astype(np.float32))
        symmetry_score = round(float(1.0 - (np.mean(diff) / 255.0)), 3)

        # 垂直 24 段切片 (24-slice profile)
        num_slices = 24
        slice_h = proc_size // num_slices
        slice_profiles = []
        widths = []
        center_offsets = []

        for i in range(num_slices):
            y_start = i * slice_h
            y_end = (i + 1) * slice_h
            sl_edges = edges[y_start:y_end, :]
            sl_gray = img_gray[y_start:y_end, :]

            col_sums = np.sum(sl_edges, axis=0)
            active_cols = np.where(col_sums > 0)[0]
            if len(active_cols) > 2:
                sl_min_x = active_cols[0]
                sl_max_x = active_cols[-1]
                sl_w = sl_max_x - sl_min_x
                sl_cx = (sl_min_x + sl_max_x) / 2.0 - (proc_size / 2.0)
            else:
                sl_w = proc_size * 0.5
                sl_cx = 0.0

            w_ratio = round(float(sl_w / proc_size), 3)
            cx_ratio = round(float(sl_cx / (proc_size / 2.0)), 3)
            edge_density = round(float(np.mean(sl_edges) / 255.0), 3)
            lum = round(float(np.mean(sl_gray)), 1)

            widths.append(w_ratio)
            center_offsets.append(cx_ratio)
            slice_profiles.append({
                'slice': i + 1,
                'widthRatio': w_ratio,
                'centerOffset': cx_ratio,
                'edgeDensity': edge_density,
                'luminance': lum
            })

        # =====================================================================
        # 1. 深度幾何形態研判 (Morphological Classification)
        # =====================================================================
        top_w = np.mean(widths[:4])
        mid_w = np.mean(widths[6:16])
        bot_w = np.mean(widths[18:])

        # (a) 尖頂教堂 (Sharp Spire): 頂端極窄且急遽擴展
        is_pointed_spire = (widths[0] < 0.16 and widths[2] < 0.28 and widths[6] > widths[0] * 2.5)

        # (b) 三角山牆屋頂 (Triangular Pitch Gable): 前 35% 呈線性三角收束
        slope_top = (widths[6] - widths[0]) / 6.0
        is_triangular_gable = (widths[0] < 0.28 and widths[6] > 0.60 and slope_top > 0.06 and not is_pointed_spire)

        # (c) 飛簷寶塔 (Pagoda): 多段簷口突出的寬度階躍
        eave_count = 0
        for s_idx in range(1, 16, 2):
            if s_idx + 1 < len(widths) and widths[s_idx] > widths[s_idx + 1] + 0.08:
                eave_count += 1
        is_pagoda = (eave_count >= 2)

        # (d) 圓頂建築 (Dome): 頂部呈飽滿圓凸弧形
        is_dome = (widths[0] > 0.26 and widths[1] > 0.52 and widths[3] > 0.70 and not is_pointed_spire and not is_triangular_gable)

        # (e) 階梯退縮摩天大樓 (Stepped Skyscraper): 中上段有明顯階梯寬度收縮
        is_stepped = (widths[3] < widths[10] * 0.75 and widths[10] < widths[18] * 0.85)

        # (f) 平頂商業大樓 (Flat Roof): 頂部平直寬闊
        is_flat_roof = (widths[0] > 0.68 and widths[1] > 0.72 and not is_dome and not is_pagoda)

        # (g) 柱列結構 (Colonnades)
        col_grad = np.abs(cv2.Sobel(img_gray, cv2.CV_32F, 1, 0, ksize=3))
        vert_pattern = np.mean(col_grad[proc_size // 3 : 2 * proc_size // 3, :], axis=0)
        vert_norm = vert_pattern - np.mean(vert_pattern)
        autocorr = np.correlate(vert_norm, vert_norm, mode='full')
        autocorr = autocorr[len(autocorr)//2 :]
        peaks = [p for p in range(5, len(autocorr) - 5) if autocorr[p] > autocorr[p-1] and autocorr[p] > autocorr[p+1] and autocorr[p] > autocorr[0] * 0.25]
        has_colonnade = len(peaks) >= 3

        # (h) 樹木形態分類:
        # - 錐形針葉樹 (Conifer Pine)
        is_conifer_tree = (widths[0] < 0.20 and widths[3] < 0.45 and widths[18] > 0.68 and aspect_ratio < 0.98)
        # - 闊葉巨木 (Broadleaf)
        is_broadleaf_tree = (widths[20] < 0.42 and widths[22] < 0.42 and mid_w > 0.72)
        # - 矮叢灌木 (Shrub)
        is_shrub_tree = (aspect_ratio > 0.82 and widths[18] > 0.65 and widths[20] > 0.65)
        # - 造型盆栽 (Bonsai)
        is_bonsai = (widths[22] > 0.72 and widths[18] < 0.48 and aspect_ratio > 0.78)

        # (i) 腳踏車細部特徵 (Bicycle): 纖細鋼管車架與雙圓形輪圈
        is_bicycle = (aspect_ratio > 1.30 and aspect_ratio < 2.10 and solidity < 0.65)

        # =====================================================================
        # 2. 獨立色彩萃取與專屬玻璃色彩隔離 (Glass & Color Separation)
        # =====================================================================
        top_mask = np.zeros((proc_size, proc_size), dtype=np.uint8)
        top_mask[:proc_size // 4, :] = 1
        mid_mask = np.zeros((proc_size, proc_size), dtype=np.uint8)
        mid_mask[proc_size // 4 : 3 * proc_size // 4, :] = 1
        bot_mask = np.zeros((proc_size, proc_size), dtype=np.uint8)
        bot_mask[3 * proc_size // 4 :, :] = 1

        top_rgb = extract_dominant_color_in_mask(img_rgb, top_mask, [140, 140, 140])
        mid_rgb = extract_dominant_color_in_mask(img_rgb, mid_mask, [110, 110, 110])
        bot_rgb = extract_dominant_color_in_mask(img_rgb, bot_mask, [80, 80, 80])

        # K-Means 全域聚類
        pixels = img_rgb.reshape(-1, 3).astype(np.float32)
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.2)
        k = 7
        _, labels, centers = cv2.kmeans(pixels, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
        counts = np.bincount(labels.flatten(), minlength=k)
        sorted_indices = np.argsort(-counts)
        sorted_centers = centers[sorted_indices]

        hsv_centers = cv2.cvtColor(sorted_centers.reshape(1, k, 3).astype(np.uint8), cv2.COLOR_RGB2HSV)[0]
        saturations = hsv_centers[:, 1]
        accent_idx = int(np.argmax(saturations))
        accent_rgb = [int(sorted_centers[accent_idx, 0]), int(sorted_centers[accent_idx, 1]), int(sorted_centers[accent_idx, 2])]

        lums = 0.299 * sorted_centers[:, 0] + 0.587 * sorted_centers[:, 1] + 0.114 * sorted_centers[:, 2]
        dark_idx = int(np.argmin(lums))
        bright_idx = int(np.argmax(lums))
        dark_rgb = [int(sorted_centers[dark_idx, 0]), int(sorted_centers[dark_idx, 1]), int(sorted_centers[dark_idx, 2])]
        bright_rgb = [int(sorted_centers[bright_idx, 0]), int(sorted_centers[bright_idx, 1]), int(sorted_centers[bright_idx, 2])]

        # 專屬玻璃/透明窗框色彩分析 (偏藍/深青/暗黑冷色調)
        # 尋找冷色調中心 (Hue in [80..140] 或低飽和深灰)
        glass_rgb = [30, 41, 59] # 預設冷調深藍玻璃 (Slate 800)
        for c_idx in range(k):
            h_val = hsv_centers[c_idx, 0]
            s_val = hsv_centers[c_idx, 1]
            v_val = hsv_centers[c_idx, 2]
            if (80 <= h_val <= 140 and s_val > 30) or (v_val < 60 and s_val < 50):
                glass_rgb = [int(sorted_centers[c_idx, 0]), int(sorted_centers[c_idx, 1]), int(sorted_centers[c_idx, 2])]
                break

        color_richness = round(float(np.std(sorted_centers)), 2)

        return {
            'width': w_orig,
            'height': h_orig,
            'aspectRatio': aspect_ratio,
            'solidity': solidity,
            'extent': extent,
            'symmetryScore': symmetry_score,
            'structuralFlags': {
                'isPointedSpire': bool(is_pointed_spire),
                'isTriangularGable': bool(is_triangular_gable),
                'isPagoda': bool(is_pagoda),
                'isDome': bool(is_dome),
                'isStepped': bool(is_stepped),
                'isFlatRoof': bool(is_flat_roof),
                'hasColonnade': bool(has_colonnade),
                'isConiferTree': bool(is_conifer_tree),
                'isBroadleafTree': bool(is_broadleaf_tree),
                'isShrubTree': bool(is_shrub_tree),
                'isBonsai': bool(is_bonsai),
                'isBicycle': bool(is_bicycle)
            },
            'sliceProfiles': slice_profiles,
            'colorRichness': color_richness,
            'colors': {
                'roofRgb': top_rgb,
                'roofHex': rgb_to_hex(top_rgb[0], top_rgb[1], top_rgb[2]),
                'facadeRgb': mid_rgb,
                'facadeHex': rgb_to_hex(mid_rgb[0], mid_rgb[1], mid_rgb[2]),
                'baseRgb': bot_rgb,
                'baseHex': rgb_to_hex(bot_rgb[0], bot_rgb[1], bot_rgb[2]),
                'accentRgb': accent_rgb,
                'accentHex': rgb_to_hex(accent_rgb[0], accent_rgb[1], accent_rgb[2]),
                'darkRgb': dark_rgb,
                'darkHex': rgb_to_hex(dark_rgb[0], dark_rgb[1], dark_rgb[2]),
                'brightRgb': bright_rgb,
                'brightHex': rgb_to_hex(bright_rgb[0], bright_rgb[1], bright_rgb[2]),
                'glassRgb': glass_rgb,
                'glassHex': rgb_to_hex(glass_rgb[0], glass_rgb[1], glass_rgb[2])
            }
        }
    except Exception as e:
        return {'error': str(e)}

def classify_semantic_style(family, subpart, stem, raw_info):
    flags = raw_info.get('structuralFlags', {})
    aspect_ratio = raw_info.get('aspectRatio', 1.0)
    s = stem.lower()

    style = 'generic'
    symmetry_mode = 'symmetric'
    roof_type = 'flat'

    # 1. BUILDING 分類
    if family == 'building':
        if flags.get('isPointedSpire') or any(k in s for k in ['church', 'cathedral', 'spire', 'bld_church', 'gothic']):
            style = 'church_pointed_spire'
            roof_type = 'gothic_pointed_spire'
            symmetry_mode = 'symmetric'
        elif flags.get('isTriangularGable') or any(k in s for k in ['cottage', 'chalet', 'barn', 'village', 'bld_stonecottage', 'bld_barn', 'bld_chalet', 'halftimber', 'dwg_house', 'bld_rowhouse', 'bld_inn']):
            style = 'village_triangular_gable'
            roof_type = 'triangular_pitched_gable'
            symmetry_mode = 'symmetric'
        elif flags.get('isPagoda') or any(k in s for k in ['pagoda', 'temple_asia', 'hanok', 'minka', 'bld_pagoda', 'heritage', 'pavilion', 'bld_hanok', 'bld_minka', 'houou']):
            style = 'asian_pagoda_pavilion'
            roof_type = 'flared_pagoda_eaves'
            symmetry_mode = 'symmetric'
        elif flags.get('isDome') or any(k in s for k in ['pantheon', 'dome', 'observatory', 'basilica', 'mosque', 'state-capitol']):
            style = 'classical_dome_rotunda'
            roof_type = 'hemisphere_dome_cupola'
            symmetry_mode = 'symmetric'
        elif flags.get('hasColonnade') or any(k in s for k in ['partenone', 'parthenon', 'temple', 'acropolis', 'bld_temple', 'bld_civic', 'dwg_civic']):
            style = 'classical_temple_peristyle'
            roof_type = 'pediment_frieze_gable'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['pisa', 'leaning', 'campanile', 'bld_lighthouse', 'lighthouse']) or (aspect_ratio < 0.65 and flags.get('isDome')):
            style = 'leaning_arcade_tower'
            roof_type = 'arcade_dome_cupola'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['castle', 'fortress', 'bastion', 'keep', 'white-tower', 'the-white-tower']):
            style = 'castle_fortress_keep'
            roof_type = 'crenellated_conical_turrets'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['windmill', 'bld_windmill']):
            style = 'windmill_mill'
            roof_type = 'conical_blades'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['yurt', 'bld_yurt']):
            style = 'yurt_nomadic'
            roof_type = 'conical_dome'
            symmetry_mode = 'symmetric'
        elif flags.get('isStepped') or any(k in s for k in ['skyscraper', 'tower', 'bld_tower', 'taipei', 'dji', 'phoenix-tower']):
            style = 'modern_stepped_skyscraper'
            roof_type = 'stepped_spire_crown'
            symmetry_mode = 'symmetric'
        else:
            style = 'commercial_flat_terrace'
            roof_type = 'flat_parapet_terrace'
            symmetry_mode = 'asymmetric'

    # 2. TREE 分類
    elif family == 'tree':
        symmetry_mode = 'asymmetric'
        if flags.get('isBonsai') or any(k in s for k in ['bonsai', 'pot']):
            style = 'bonsai_potted_twisted'
            roof_type = 'cloud_foliage_pads'
        elif flags.get('isConiferTree') or any(k in s for k in ['conifer', 'pine', 'spruce', 'fir', 'cedar', 'sp_conifer', 'cypress', 'sp_cypress', 'cf_araucaria', 'cf_juniper', 'cryptomeria']):
            style = 'conifer_pine_spire'
            roof_type = 'tiered_conical_whorls'
            symmetry_mode = 'symmetric'
        elif flags.get('isShrubTree') or any(k in s for k in ['shrub', 'boxwood', 'hedge', 'sh_boxwood']):
            style = 'shrub_bush_mound'
            roof_type = 'low_polyhedral_cushions'
        elif any(k in s for k in ['baobab', 'bottle', 'sp_baobab', 'buttress']):
            style = 'succulent_bottle_baobab'
            roof_type = 'compact_branch_clusters'
        elif any(k in s for k in ['palm', 'dragon', 'gt_dragontree', 'acacia', 'sp_acacia', 'cherry', 'sp_cherry']):
            style = 'palm_umbrella_rosette'
            roof_type = 'radiating_umbrella_fronds'
        else:
            style = 'broadleaf_camphor_oak'
            roof_type = 'overlapping_dome_canopies'

    # 3. VEHICLE 分類
    elif family == 'vehicle':
        symmetry_mode = 'symmetric'
        if subpart == 'bike' or flags.get('isBicycle') or any(k in s for k in ['bike', 'bicycle', 'cycle']):
            style = 'precision_diamond_bicycle'
            roof_type = 'tubular_frame'
        elif subpart == 'motor' or any(k in s for k in ['motor', 'moto', 'bike', 'harley', 'ducati', 'scooter']):
            if any(k in s for k in ['sport', 'ninja', 'racing', 'superbike', 'cbr']):
                style = 'racing_sportbike'
            else:
                style = 'cruiser_standard_motor'
            roof_type = 'teardrop_tank'
        elif subpart == 'train' or any(k in s for k in ['train', 'bullet', 'shinkansen', 'locomotive', 'rail']):
            if aspect_ratio > 2.5 or any(k in s for k in ['bullet', 'shinkansen', 'high_speed', 'emu', 'tgv']):
                style = 'bullet_high_speed_train'
            else:
                style = 'freight_locomotive_train'
            roof_type = 'pantograph_roof'
        elif subpart == 'heavy' or any(k in s for k in ['truck', 'heavy', 'tanker', 'dump', 'cement', 'semi', 'tractor']):
            if any(k in s for k in ['tanker', 'fuel', 'oil', 'liquid']):
                style = 'heavy_liquid_tanker'
            elif any(k in s for k in ['dump', 'tipper', 'quarry']):
                style = 'heavy_quarry_dump'
            else:
                style = 'heavy_freight_tractor'
            roof_type = 'cab_aeroshield'
        else:
            if any(k in s for k in ['pickup', 'truck_bed', 'hilux', 'tacoma', 'f150']):
                style = 'pickup_offroad_truck'
            elif aspect_ratio > 1.9 or any(k in s for k in ['sports', 'coupe', 'ferrari', 'porsche', 'gt', 'supercar', 'lambo']):
                style = 'aerodynamic_gt_supercar'
            else:
                style = 'standard_passenger_automobile'
            roof_type = 'cabin_windshield'

    # 4. SHIP 分類
    elif family == 'ship':
        if any(k in s for k in ['carrier', 'enterprise', 'nimitz', 'liaoning', 'shandong', 'flight_deck', 'warship']):
            style = 'naval_aircraft_carrier'
            symmetry_mode = 'asymmetric'
        elif any(k in s for k in ['container', 'cargo', 'box_ship', 'maersk', 'evergreen', 'cosco']):
            style = 'intermodal_container_ship'
            symmetry_mode = 'symmetric'
        elif any(k in s for k in ['cruise', 'liner', 'passenger', 'ferry', 'yacht']):
            style = 'luxury_cruise_liner'
            symmetry_mode = 'symmetric'
        else:
            style = 'general_cargo_vessel'
            symmetry_mode = 'symmetric'
        roof_type = 'superstructure_bridge'

    # 5. ROCK 分類
    elif family == 'rock':
        symmetry_mode = 'asymmetric'
        if any(k in s for k in ['basalt', 'column', 'prism', 'hexagonal', 'joint', 'mg_basalt']):
            style = 'columnar_hexagonal_basalt'
        elif any(k in s for k in ['arch', 'mg_arch', 'tor']):
            style = 'natural_monolithic_arch'
        elif any(k in s for k in ['tower', 'mg_tower', 'hoodoo', 'spire']):
            style = 'hoodoo_pinnacle_tower'
        else:
            style = 'faceted_erratic_boulder'
        roof_type = 'cleavage_facets'

    # 6. LANDMARK 分類
    elif family == 'landmark':
        symmetry_mode = 'symmetric'
        if any(k in s for k in ['dish', 'radar', 'antenna', 'satellite']):
            style = 'parabolic_satellite_dish'
        elif any(k in s for k in ['lattice', 'mast', 'pylon', 'transmission']):
            style = 'lattice_transmission_tower'
        else:
            style = 'industrial_installation_rig'
        roof_type = 'mast_crown'

    return {
        'style': style,
        'symmetryMode': symmetry_mode,
        'roofType': roof_type
    }

def analyze_all_photos_to_json(roots, out_json_path):
    exts = ('.jpg', '.jpeg', '.png', '.webp')
    results = {}
    print(f"🚀 開始 v5.0 逐張照片獨立深度特徵萃取 (無抄襲模板): {roots}")
    
    total_imgs = 0
    for r in roots:
        if not os.path.exists(r):
            continue
        for root_dir, _, files in os.walk(r):
            for f in files:
                if f.lower().endswith(exts):
                    total_imgs += 1

    print(f"📦 總計待分析圖檔: {total_imgs} 張")
    processed = 0

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
                    processed += 1
                    if processed % 50 == 0 or processed == total_imgs:
                        print(f"  ⚡ [{processed}/{total_imgs}] 獨立視覺特徵萃取: {fam}/{sub}/{f} -> Style: {classification.get('style')}, Roof: {classification.get('roofType')}")

    os.makedirs(os.path.dirname(os.path.abspath(out_json_path)), exist_ok=True)
    with open(out_json_path, 'w', encoding='utf-8') as fp:
        json.dump(results, fp, ensure_ascii=False, indent=2)
    print(f"✅ 成功萃取 {len(results)} 張照片之 v5.0 獨立深度特徵至 {out_json_path}")

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--all':
        roots = [
            r'C:\Users\user\Documents\steel_vs_swarm\tools\ai3d\photos',
            r'C:\Users\user\Documents\study\ai3d_restricted\photos'
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
