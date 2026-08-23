#!/usr/bin/env python3
"""YOLO26 Detection / Segmentation / Depth 前處理與多目標切分。"""

import argparse
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from ultralytics import YOLO

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
PHOTO_ROOTS = (
    Path(r"C:\Users\user\Documents\steel_vs_swarm\tools\ai3d\photos"),
    Path(r"C:\Users\user\Documents\study\ai3d_restricted\photos"),
)
OUT_FEATURES = ROOT / "out" / "yolo_features"
OUT_TARGETS = ROOT / "out" / "targets"
OUT_DEPTH = ROOT / "out" / "yolo_depth"
OUT_MASKS = ROOT / "out" / "yolo_masks"
SCHEMA_VERSION = 2
REVIEW_STATE = ROOT / "tools" / "parts_review" / "state.json"
MODEL_NAMES = {
    "detection": "yolo26n.pt",
    "segmentation": "yolo26n-seg.pt",
    "depth": "yolo26n-depth.pt",
}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}

# COCO 類別只在語意吻合時拆成獨立目標；沒有對應類別的建築、岩石、樹木保留整張主體。
FAMILY_LABELS = {
    "vehicle": {"bicycle", "car", "motorcycle", "bus", "train", "truck", "boat"},
    "ship": {"boat"},
    "tree": {"potted plant"},
}


def stable_target(key: str) -> str:
    return re.sub(r"_[0-9a-f]{8}_v6$", "", key)


def load_review_targets(status: str | None):
    if not status:
        return None
    try:
        state = json.loads(REVIEW_STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"無法讀取審查狀態: {REVIEW_STATE}") from exc
    return {
        stable_target(key)
        for key, verdict in state.get("items", {}).items()
        if key.endswith("_v6") and verdict.get("status") == status
    }


def rel_posix(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def read_image(path: Path):
    buf = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("無法解碼影像")
    return image


def parse_category(path: Path, corpus: Path):
    rel = path.relative_to(corpus)
    parts = rel.parts
    if len(parts) < 2:
        return None
    family = parts[0]
    default_subparts = {"building": "mass", "ship": "hull", "tree": "canopy"}
    subpart = parts[1] if len(parts) > 2 else default_subparts.get(family, "main")
    return family, subpart, rel.as_posix()


def cache_valid(feature_file: Path) -> bool:
    try:
        data = json.loads(feature_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if data.get("schemaVersion") != SCHEMA_VERSION or data.get("models") != MODEL_NAMES:
        return False
    required = [data.get("depth", {}).get("rawFile"), data.get("depth", {}).get("previewFile")]
    for target in data.get("targets", []):
        required.extend((target.get("targetFile"), target.get("maskFile")))
    return bool(data.get("targets")) and all(p and (ROOT / p).is_file() for p in required)


def box_rows(result):
    rows = []
    if result.boxes is None:
        return rows
    names = result.names
    for box in result.boxes:
        xyxy = box.xyxy[0].detach().cpu().numpy().tolist()
        cls_id = int(box.cls[0].detach().cpu().item())
        rows.append({
            "classId": cls_id,
            "className": str(names.get(cls_id, cls_id)),
            "confidence": round(float(box.conf[0].detach().cpu().item()), 6),
            "bbox": [round(float(v), 3) for v in xyxy],
        })
    return rows


def segmentation_rows(result, width: int, height: int):
    rows = box_rows(result)
    masks = result.masks.data.detach().cpu().numpy() if result.masks is not None else []
    for index, row in enumerate(rows):
        if index >= len(masks):
            row["mask"] = None
            continue
        mask = cv2.resize(masks[index].astype(np.float32), (width, height), interpolation=cv2.INTER_LINEAR)
        row["mask"] = mask >= 0.5
    return rows


def depth_array(result, width: int, height: int):
    depth = getattr(result, "depth", None)
    data = getattr(depth, "data", None)
    if data is None:
        raise RuntimeError("YOLO26 depth 結果缺少 result.depth.data")
    arr = np.squeeze(data.detach().cpu().numpy().astype(np.float32))
    if arr.ndim != 2:
        raise RuntimeError(f"YOLO26 depth 維度異常: {arr.shape}")
    if arr.shape != (height, width):
        arr = cv2.resize(arr, (width, height), interpolation=cv2.INTER_LINEAR)
    return arr


def depth_summary(depth: np.ndarray, mask: np.ndarray):
    values = depth[np.logical_and(mask, np.isfinite(depth))]
    if values.size == 0:
        return None
    q = np.percentile(values, [5, 25, 50, 75, 95])
    return {
        "minM": round(float(values.min()), 5),
        "maxM": round(float(values.max()), 5),
        "meanM": round(float(values.mean()), 5),
        "p05M": round(float(q[0]), 5),
        "p25M": round(float(q[1]), 5),
        "medianM": round(float(q[2]), 5),
        "p75M": round(float(q[3]), 5),
        "p95M": round(float(q[4]), 5),
    }


def slice_features(mask: np.ndarray, depth: np.ndarray):
    height, width = mask.shape
    edges = np.linspace(0, height, 17, dtype=int)
    rows = []
    for level, (y0, y1) in enumerate(zip(edges[:-1], edges[1:])):
        section = mask[y0:y1]
        _, xs = np.where(section)
        if xs.size == 0:
            rows.append({"level": level, "widthRatio": 0.0, "centerOffset": 0.0, "depthMedianM": None})
            continue
        min_x, max_x = int(xs.min()), int(xs.max())
        center = (min_x + max_x) * 0.5
        d = depth[y0:y1][section]
        d = d[np.isfinite(d)]
        rows.append({
            "level": level,
            "widthRatio": round((max_x - min_x + 1) / max(1, width), 4),
            "centerOffset": round((center - width * 0.5) / max(1, width), 4),
            "depthMedianM": round(float(np.median(d)), 5) if d.size else None,
        })
    return rows


def target_candidates(family: str, detections, segmentations, width: int, height: int):
    allowed = FAMILY_LABELS.get(family)
    if not allowed:
        return [{"className": family, "confidence": 1.0, "bbox": [0, 0, width, height], "mask": np.ones((height, width), dtype=bool)}]

    matched = [row for row in segmentations if row["className"] in allowed and row.get("mask") is not None]
    if matched:
        return matched

    candidates = []
    for row in detections:
        if row["className"] not in allowed:
            continue
        x0, y0, x1, y1 = (int(round(v)) for v in row["bbox"])
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(width, x1), min(height, y1)
        if x1 <= x0 or y1 <= y0:
            continue
        mask = np.zeros((height, width), dtype=bool)
        mask[y0:y1, x0:x1] = True
        candidates.append({**row, "mask": mask})
    if candidates:
        return candidates

    return [{"className": family, "confidence": 1.0, "bbox": [0, 0, width, height], "mask": np.ones((height, width), dtype=bool)}]


def save_depth(depth: np.ndarray, raw_path: Path, preview_path: Path):
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(raw_path, depth.astype(np.float32), allow_pickle=False)
    finite = depth[np.isfinite(depth)]
    lo, hi = np.percentile(finite, [2, 98]) if finite.size else (0.0, 1.0)
    norm = np.clip((depth - lo) / max(float(hi - lo), 1e-6), 0.0, 1.0)
    preview = np.round((1.0 - norm) * 65535.0).astype(np.uint16)
    ok, encoded = cv2.imencode(".png", preview)
    if not ok:
        raise OSError(f"無法編碼深度預覽: {preview_path}")
    encoded.tofile(preview_path)


def process_image(path: Path, corpus: Path, models, args):
    parsed = parse_category(path, corpus)
    if parsed is None:
        return None
    family, subpart, source_rel = parsed
    if args.family and family != args.family:
        return None
    if args.only and f"{family}/{subpart}" != args.only:
        return None

    stem = path.stem
    if args.review_targets is not None and f"{family}/{subpart}_{stem}" not in args.review_targets:
        return None
    feature_file = OUT_FEATURES / family / subpart / f"{stem}.json"
    if not args.force and feature_file.is_file() and cache_valid(feature_file):
        data = json.loads(feature_file.read_text(encoding="utf-8"))
        return "skipped", len(data["targets"])

    image = read_image(path)
    height, width = image.shape[:2]
    detect_result = models["detection"].predict(image, device=args.device, verbose=False)[0]
    segment_result = models["segmentation"].predict(image, device=args.device, verbose=False)[0]
    depth_result = models["depth"].predict(image, device=args.device, verbose=False)[0]
    detections = box_rows(detect_result)
    segmentations = segmentation_rows(segment_result, width, height)
    depth = depth_array(depth_result, width, height)

    base_dir = Path(family) / subpart
    raw_depth = OUT_DEPTH / base_dir / f"{stem}.npy"
    preview_depth = OUT_DEPTH / base_dir / f"{stem}.png"
    save_depth(depth, raw_depth, preview_depth)

    targets = []
    for index, candidate in enumerate(target_candidates(family, detections, segmentations, width, height)):
        mask = candidate["mask"]
        ys, xs = np.where(mask)
        if xs.size == 0:
            continue
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        pad_x = max(2, int((x1 - x0) * 0.05))
        pad_y = max(2, int((y1 - y0) * 0.05))
        x0, x1 = max(0, x0 - pad_x), min(width, x1 + pad_x)
        y0, y1 = max(0, y0 - pad_y), min(height, y1 + pad_y)
        target_id = f"{stem}~{index}"
        target_path = OUT_TARGETS / base_dir / f"{target_id}.png"
        mask_path = OUT_MASKS / base_dir / f"{target_id}.png"
        target_path.parent.mkdir(parents=True, exist_ok=True)
        mask_path.parent.mkdir(parents=True, exist_ok=True)
        crop = cv2.cvtColor(image[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
        Image.fromarray(crop).save(target_path)
        Image.fromarray((mask.astype(np.uint8) * 255)).save(mask_path)
        targets.append({
            "targetId": target_id,
            "className": candidate["className"],
            "confidence": round(float(candidate["confidence"]), 6),
            "bbox": [x0, y0, x1, y1],
            "width": x1 - x0,
            "height": y1 - y0,
            "aspectRatio": round((x1 - x0) / max(1, y1 - y0), 4),
            "targetFile": rel_posix(target_path, ROOT),
            "maskFile": rel_posix(mask_path, ROOT),
            "depth": depth_summary(depth, mask),
            "slices": slice_features(mask, depth),
        })

    if not targets:
        raise RuntimeError("YOLO26 未產生任何有效目標")

    feature_data = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceImage": source_rel,
        "sourceFullPath": str(path),
        "family": family,
        "subpart": subpart,
        "stem": stem,
        "width": width,
        "height": height,
        "models": MODEL_NAMES,
        "detection": {"count": len(detections), "objects": detections},
        "segmentation": {
            "count": len(segmentations),
            "objects": [{k: v for k, v in row.items() if k != "mask"} for row in segmentations],
        },
        "depth": {
            "rawFile": rel_posix(raw_depth, ROOT),
            "previewFile": rel_posix(preview_depth, ROOT),
            "units": "meters",
            "summary": depth_summary(depth, np.ones((height, width), dtype=bool)),
        },
        "targets": targets,
    }
    feature_file.parent.mkdir(parents=True, exist_ok=True)
    feature_file.write_text(json.dumps(feature_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return "computed", len(targets)


def discover_images():
    rows = []
    for corpus in PHOTO_ROOTS:
        if not corpus.is_dir():
            continue
        for path in corpus.rglob("*"):
            if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
                rows.append((path, corpus))
    return sorted(rows, key=lambda row: str(row[0]).lower())


def main():
    parser = argparse.ArgumentParser(description="YOLO26 Detection/Segmentation/Depth 多目標前處理")
    parser.add_argument("--family")
    parser.add_argument("--only", help="只處理 family/subpart")
    parser.add_argument("--review-status", help="只處理零件台指定狀態（例如 regen）的 v6 穩定目標")
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--device", default=None, help="Ultralytics device，例如 0 或 cpu")
    parser.add_argument("--force", action="store_true", help="忽略有效快取並重算")
    args = parser.parse_args()
    args.review_targets = load_review_targets(args.review_status)

    print("▶ 載入 YOLO26 Detection / Segmentation / Depth 模型")
    models = {name: YOLO(model_name) for name, model_name in MODEL_NAMES.items()}
    images = discover_images()
    computed = skipped = failed = multi = 0
    for path, corpus in images:
        if computed + skipped >= args.limit:
            break
        try:
            result = process_image(path, corpus, models, args)
        except Exception as exc:
            failed += 1
            print(f"  ⚠ {path}: {exc}", file=sys.stderr)
            continue
        if result is None:
            continue
        status, target_count = result
        if status == "skipped":
            skipped += 1
        else:
            computed += 1
            multi += int(target_count > 1)
            print(f"  ✓ {path.name}: {target_count} 個目標")

    print(f"✅ YOLO26 完成：新算 {computed}、快取 {skipped}、多目標圖 {multi}、失敗 {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
