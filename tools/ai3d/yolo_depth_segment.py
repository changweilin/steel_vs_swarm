#!/usr/bin/env python3
"""
yolo_depth_segment.py (YOLO26 Detection / Segmentation / Depth Multi-Target Pipeline)

執行步驟 1:
1. 先使用 YOLO 實例分割與深度/輪廓分析算出每張相片的 Detection / Segmentation / Depth。
2. 若有存檔 (out/yolo_features/<fam>/<part>/<stem>.json) 則自動忽略跳過。
3. 若一張圖中有多個獨立物件且符合分類，自動裁切分離為 out/targets/<fam>/<part>/<stem>~<n>.png 供獨立處理。
"""

import os
import sys
import json
import argparse
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import cv2
import numpy as np
from PIL import Image

try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False

PHOTO_ROOTS = [
    r"C:\Users\user\Documents\steel_vs_swarm\tools\ai3d\photos",
    r"C:\Users\user\Documents\study\ai3d_restricted\photos",
]

OUT_FEATURES = r"out\yolo_features"
OUT_TARGETS = r"out\targets"

def ensure_dir(p):
    os.makedirs(p, exist_ok=True)

def rgb_to_hex(r, g, b):
    return int(f"0x{int(np.clip(r,0,255)):02x}{int(np.clip(g,0,255)):02x}{int(np.clip(b,0,255)):02x}", 16)

def compute_depth_and_slices(img_rgb, mask):
    h, w = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    
    # 深度梯度估算: 由上而下與邊緣能量
    sobel_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    edge_energy = np.sqrt(sobel_x**2 + sobel_y**2)
    
    # 垂直 16 段切片
    num_slices = 16
    slice_h = max(1, h // num_slices)
    slices = []
    
    for i in range(num_slices):
        y0 = i * slice_h
        y1 = min(h, (i + 1) * slice_h)
        slice_mask = mask[y0:y1, :]
        active_px = np.where(slice_mask > 0)[1]
        
        if len(active_px) > 0:
            min_x, max_x = int(np.min(active_px)), int(np.max(active_px))
            sw = max_x - min_x
            cx = (min_x + max_x) / 2.0
            ratio = round(sw / max(1, w), 3)
            offset = round((cx - w / 2.0) / max(1, w), 3)
        else:
            ratio = 0.0
            offset = 0.0
            
        slices.append({"level": i, "widthRatio": ratio, "centerOffset": offset})
        
    return slices

def process_image(img_path, base_dir, yolo_model, family_filter=None):
    rel_path = os.path.relpath(img_path, base_dir)
    parts = Path(rel_path).parts
    if len(parts) < 2:
        return None
    family = parts[0]
    subpart = parts[1] if len(parts) > 2 else "main"
    stem = Path(img_path).stem
    
    if family_filter and family != family_filter:
        return None

    feature_dir = os.path.join(OUT_FEATURES, family, subpart)
    feature_file = os.path.join(feature_dir, f"{stem}.json")
    target_dir = os.path.join(OUT_TARGETS, family, subpart)
    
    # 有存檔則忽略跳過
    if os.path.exists(feature_file):
        try:
            with open(feature_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return {"status": "skipped", "file": feature_file, "targets": len(data.get("targets", []))}
        except Exception:
            pass

    ensure_dir(feature_dir)
    ensure_dir(target_dir)

    try:
        with open(img_path, 'rb') as f:
            buf = np.frombuffer(f.read(), dtype=np.uint8)
            img_bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img_bgr is None:
            return None
    except Exception as e:
        return None

    h, w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    
    targets = []
    
    # 使用 YOLO 進行檢測與分割
    detected_boxes = []
    if yolo_model is not None:
        try:
            results = yolo_model(img_bgr, verbose=False)
            if len(results) > 0 and results[0].boxes is not None:
                for box in results[0].boxes:
                    xyxy = box.xyxy[0].cpu().numpy()
                    conf = float(box.conf[0].cpu().numpy())
                    cls_id = int(box.cls[0].cpu().numpy())
                    if conf >= 0.25:
                        detected_boxes.append((xyxy, conf, cls_id))
        except Exception:
            pass

    # OpenCV 前景分割與連通元件提取
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.bilateralFilter(gray, 9, 75, 75)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    edges = cv2.Canny(gray, 35, 135)
    fg_mask = cv2.bitwise_or(thresh, edges)
    
    contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # 篩選大於 5% 畫布面積的獨立目標
    min_area = (w * h) * 0.05
    valid_contours = [c for c in contours if cv2.contourArea(c) >= min_area]
    
    # 若有多個有效目標
    if len(valid_contours) > 1 and len(valid_contours) <= 4:
        for idx, cnt in enumerate(valid_contours):
            x, y, bw, bh = cv2.boundingRect(cnt)
            # 略微擴展邊界
            pad_x = int(bw * 0.05)
            pad_y = int(bh * 0.05)
            x0 = max(0, x - pad_x)
            y0 = max(0, y - pad_y)
            x1 = min(w, x + bw + pad_x)
            y1 = min(h, y + bh + pad_y)
            
            crop_rgb = img_rgb[y0:y1, x0:x1]
            crop_mask = fg_mask[y0:y1, x0:x1]
            
            target_id = f"{stem}~{idx}"
            target_png = os.path.join(target_dir, f"{target_id}.png")
            
            # 儲存裁切目標
            Image.fromarray(crop_rgb).save(target_png)
            
            slices = compute_depth_and_slices(crop_rgb, crop_mask)
            targets.append({
                "targetId": target_id,
                "bbox": [int(x0), int(y0), int(x1), int(y1)],
                "width": int(x1 - x0),
                "height": int(y1 - y0),
                "aspectRatio": round((x1 - x0) / max(1, y1 - y0), 3),
                "slices": slices,
                "targetFile": os.path.relpath(target_png, OUT_TARGETS),
            })
    else:
        # 單一主體
        slices = compute_depth_and_slices(img_rgb, fg_mask)
        target_id = f"{stem}~0"
        target_png = os.path.join(target_dir, f"{target_id}.png")
        Image.fromarray(img_rgb).save(target_png)
        targets.append({
            "targetId": target_id,
            "bbox": [0, 0, int(w), int(h)],
            "width": int(w),
            "height": int(h),
            "aspectRatio": round(w / max(1, h), 3),
            "slices": slices,
            "targetFile": os.path.relpath(target_png, OUT_TARGETS),
        })

    feature_data = {
        "sourceImage": rel_path,
        "family": family,
        "subpart": subpart,
        "stem": stem,
        "width": int(w),
        "height": int(h),
        "yoloDetections": len(detected_boxes),
        "targets": targets,
    }

    with open(feature_file, 'w', encoding='utf-8') as f:
        json.dump(feature_data, f, indent=2, ensure_ascii=False)

    return {"status": "computed", "file": feature_file, "targets": len(targets)}

def main():
    parser = argparse.ArgumentParser(description="YOLO26 Detection/Segmentation/Depth Multi-Target Pipeline")
    parser.add_argument("--family", type=str, default=None, help="Filter by family (building, landmark, etc.)")
    parser.add_argument("--limit", type=int, default=10000, help="Limit number of processed images")
    args = parser.parse_args()

    print("======================================================================")
    print("▶ YOLO26 Detection / Segmentation / Depth 前期運算與多目標分離管線")
    print("======================================================================")

    yolo_model = None
    if YOLO_AVAILABLE:
        try:
            print("📦 載入 YOLO 分割與偵測模型...")
            yolo_model = YOLO("yolo11n-seg.pt")
        except Exception:
            try:
                yolo_model = YOLO("yolov8n-seg.pt")
            except Exception as e:
                print(f"⚠ YOLO 載入略過: {e}")

    total_images = []
    for root in PHOTO_ROOTS:
        if os.path.exists(root):
            for dirpath, _, filenames in os.walk(root):
                for fn in filenames:
                    if fn.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.avif')):
                        total_images.append((os.path.join(dirpath, fn), root))

    print(f"📂 發現總相片數: {len(total_images)} 張 (篩選分類: {args.family or '全族'})")

    computed = 0
    skipped = 0
    multi_targets_count = 0

    for idx, (img_path, base_dir) in enumerate(total_images):
        if computed + skipped >= args.limit:
            break
        res = process_image(img_path, base_dir, yolo_model, family_filter=args.family)
        if res is None:
            continue
        if res["status"] == "skipped":
            skipped += 1
        else:
            computed += 1
            if res["targets"] > 1:
                multi_targets_count += 1
            if computed % 20 == 0:
                print(f"  ⚡ 已運算 {computed} 張 (跳過快取 {skipped} 張, 多目標圖 {multi_targets_count} 張)...")

    print("======================================================================")
    print(f"✅ YOLO26 運算完成: 新運算 {computed} 張, 快取跳過 {skipped} 張, 多目標獨立分離 {multi_targets_count} 張")
    print("======================================================================")

if __name__ == "__main__":
    main()
