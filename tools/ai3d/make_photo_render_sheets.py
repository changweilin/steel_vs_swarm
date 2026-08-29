#!/usr/bin/env python3
"""把照片與固定五方向渲染排成可快速複核的接觸表。"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


CARD_W = 640
CARD_H = 470
COLS = 4
ROWS = 2
GAP = 12
MARGIN = 18


def contain(image, size, background=(230, 234, 240)):
    return ImageOps.contain(image.convert("RGB"), size, Image.Resampling.LANCZOS)


def card(entry):
    canvas = Image.new("RGB", (CARD_W, CARD_H), (31, 41, 55))
    draw = ImageDraw.Draw(canvas)
    source_box = (10, 30, CARD_W - 10, 320)
    preview_box = (10, 335, CARD_W - 10, 459)
    source = Image.open(entry["sourcePhoto"])
    rendered = Image.open(entry["previewPath"])
    source_view = contain(source, (source_box[2] - source_box[0], source_box[3] - source_box[1]))
    rendered_view = contain(rendered, (preview_box[2] - preview_box[0], preview_box[3] - preview_box[1]))
    sx = source_box[0] + (source_box[2] - source_box[0] - source_view.width) // 2
    sy = source_box[1] + (source_box[3] - source_box[1] - source_view.height) // 2
    rx = preview_box[0] + (preview_box[2] - preview_box[0] - rendered_view.width) // 2
    ry = preview_box[1] + (preview_box[3] - preview_box[1] - rendered_view.height) // 2
    canvas.paste(source_view, (sx, sy))
    canvas.paste(rendered_view, (rx, ry))
    label = f'{entry["family"]}/{entry["subpart"]}  {entry["key"].split("/")[-1]}'
    draw.text((10, 8), label[:105], fill=(236, 240, 245))
    draw.line((0, 326, CARD_W, 326), fill=(100, 116, 139), width=2)
    return canvas


def write_pages(entries, output_dir, stem):
    output_dir.mkdir(parents=True, exist_ok=True)
    per_page = COLS * ROWS
    pages = []
    for page_index in range(0, len(entries), per_page):
        page_entries = entries[page_index:page_index + per_page]
        sheet = Image.new(
            "RGB",
            (MARGIN * 2 + COLS * CARD_W + (COLS - 1) * GAP,
             MARGIN * 2 + ROWS * CARD_H + (ROWS - 1) * GAP),
            (13, 18, 26),
        )
        for index, entry in enumerate(page_entries):
            x = MARGIN + (index % COLS) * (CARD_W + GAP)
            y = MARGIN + (index // COLS) * (CARD_H + GAP)
            sheet.paste(card(entry), (x, y))
        page_path = output_dir / f"{stem}_{page_index // per_page + 1:02d}.jpg"
        sheet.save(page_path, quality=90, optimize=True)
        pages.append(str(page_path.resolve()))
    return pages


def main():
    parser = argparse.ArgumentParser(description="照片與渲染接觸表")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = json.loads(args.manifest.read_text(encoding="utf-8"))
    entries = data.get("approvedPhotoPairs", [])
    pages = {
        "all": write_pages(entries, args.output, "approved_pairs"),
        "building": write_pages([x for x in entries if x["family"] == "building"], args.output, "approved_building_pairs"),
        "vehicle": write_pages([x for x in entries if x["family"] == "vehicle"], args.output, "approved_vehicle_pairs"),
    }
    print(json.dumps({"pages": pages, "entries": len(entries)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
