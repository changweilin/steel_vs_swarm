#!/usr/bin/env python3
"""以 Pillow 擷取岩石來源影像的可重現視覺特徵摘要。"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageOps

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def clamp(value, low, high):
    return max(low, min(high, value))


def luminance(pixel):
    r, g, b = pixel
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def analyze(path_text):
    path = Path(path_text)
    try:
        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            width, height = image.size
            image.thumbnail((128, 128), Image.Resampling.BILINEAR)
            flattened = getattr(image, "get_flattened_data", None)
            pixels = list(flattened()) if flattened else list(image.getdata())
    except Exception as exc:  # noqa: BLE001 - 單張失敗不阻塞整批候選
        return {"path": path_text, "status": "failed", "error": str(exc)}

    if not pixels:
        return {"path": path_text, "status": "failed", "error": "影像沒有像素"}

    count = len(pixels)
    sums = [sum(pixel[channel] for pixel in pixels) / count for channel in range(3)]
    lumas = [luminance(pixel) for pixel in pixels]
    green = 0
    water_sky = 0
    warm_earth = 0
    neutral_rock = 0
    dark = 0
    for r, g, b in pixels:
        if g > r * 1.08 and g > b * 1.02 and g > 45:
            green += 1
        if b > r * 1.10 and b > g * 0.94 and b > 70:
            water_sky += 1
        if r > b * 1.12 and r > g * 1.02 and r > 55:
            warm_earth += 1
        if max(r, g, b) - min(r, g, b) < 38 and 35 < (r + g + b) / 3 < 205:
            neutral_rock += 1
        if max(r, g, b) < 55:
            dark += 1

    sample_width, sample_height = image.size
    horizontal_edges = 0.0
    vertical_edges = 0.0
    edge_count = 0
    row_luma = [0.0] * sample_height
    for y in range(sample_height):
        for x in range(sample_width):
            current = luminance(image.getpixel((x, y)))
            row_luma[y] += current
            if x > 0:
                horizontal_edges += abs(current - luminance(image.getpixel((x - 1, y))))
                edge_count += 1
            if y > 0:
                vertical_edges += abs(current - luminance(image.getpixel((x, y - 1))))
                edge_count += 1
    edge_scale = max(1, edge_count * 255)
    row_mean = [value / max(1, sample_width) for value in row_luma]
    top_luma = sum(row_mean[: max(1, sample_height // 5)]) / max(1, sample_height // 5)
    bottom_start = max(0, sample_height - max(1, sample_height // 5))
    bottom_luma = sum(row_mean[bottom_start:]) / max(1, sample_height - bottom_start)

    quantized = {}
    for r, g, b in pixels:
        key = (int(r // 32) * 32, int(g // 32) * 32, int(b // 32) * 32)
        quantized[key] = quantized.get(key, 0) + 1
    dominant = sorted(quantized.items(), key=lambda item: item[1], reverse=True)[:6]

    return {
        "path": path_text,
        "status": "ok",
        "width": width,
        "height": height,
        "aspectRatio": round(width / max(1, height), 4),
        "meanRgb": [round(value, 2) for value in sums],
        "luminance": {
            "mean": round(sum(lumas) / count, 2),
            "range": round(max(lumas) - min(lumas), 2),
            "topMean": round(top_luma, 2),
            "bottomMean": round(bottom_luma, 2),
        },
        "coverage": {
            "green": round(green / count, 5),
            "waterSky": round(water_sky / count, 5),
            "warmEarth": round(warm_earth / count, 5),
            "neutralRock": round(neutral_rock / count, 5),
            "dark": round(dark / count, 5),
        },
        "edgeDensity": {
            "horizontal": round(horizontal_edges / edge_scale, 5),
            "vertical": round(vertical_edges / edge_scale, 5),
            "combined": round((horizontal_edges + vertical_edges) / max(1, edge_count * 255 * 2), 5),
        },
        "dominantColors": [
            {"rgb": list(color), "ratio": round(amount / count, 5)}
            for color, amount in dominant
        ],
        "capture": {
            "model": "gpt-5.6-luna",
            "mode": "local_visual_feature_capture",
            "downsample": [sample_width, sample_height],
            "deterministic": True,
        },
    }


def main():
    results = [analyze(value) for value in sys.argv[1:]]
    print(json.dumps(results, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
