#!/usr/bin/env python3
"""把 v6 model.json 軟體光柵化成固定五方向視圖，供 LLM 與來源圖複核。"""

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


def rotate(vertex, yaw, pitch):
    x, y, z = vertex
    cy, sy = math.cos(yaw), math.sin(yaw)
    x, z = x * cy + z * sy, -x * sy + z * cy
    cp, sp = math.cos(pitch), math.sin(pitch)
    y, z = y * cp - z * sp, y * sp + z * cp
    return x, y, z


def face_normal(a, b, c):
    ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    ac = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    nx = ab[1] * ac[2] - ab[2] * ac[1]
    ny = ab[2] * ac[0] - ab[0] * ac[2]
    nz = ab[0] * ac[1] - ab[1] * ac[0]
    length = max(math.sqrt(nx * nx + ny * ny + nz * nz), 1e-9)
    return nx / length, ny / length, nz / length


def render_view(draw, vertices, faces, colors, panel_x, panel_w, height, yaw, label):
    rotated = [rotate(v, yaw, math.radians(-12)) for v in vertices]
    xs = [v[0] for v in rotated]
    ys = [v[1] for v in rotated]
    span_x = max(max(xs) - min(xs), 1e-6)
    span_y = max(max(ys) - min(ys), 1e-6)
    margin = 46
    scale = min((panel_w - margin * 2) / span_x, (height - margin * 2) / span_y)
    cx = panel_x + panel_w * 0.5 - (min(xs) + max(xs)) * 0.5 * scale
    cy = height * 0.54 + (min(ys) + max(ys)) * 0.5 * scale
    projected = [(cx + x * scale, cy - y * scale, z) for x, y, z in rotated]

    rows = []
    light = (0.35, 0.8, 0.48)
    for i in range(0, len(faces), 3):
        ia, ib, ic = faces[i:i + 3]
        a, b, c = rotated[ia], rotated[ib], rotated[ic]
        normal = face_normal(a, b, c)
        shade = max(0.0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2])
        band = 0.35 if shade < 0.2 else 0.58 if shade < 0.55 else 0.82
        if len(colors) == len(vertices) * 3:
            base = [sum(colors[index * 3 + channel] for index in (ia, ib, ic)) / 3 for channel in range(3)]
            factor = 0.66 + band * 0.42
            color = tuple(max(0, min(255, int(channel * 255 * factor))) for channel in base)
        else:
            color = (int(50 + 100 * band), int(80 + 120 * band), int(105 + 125 * band))
        rows.append(((a[2] + b[2] + c[2]) / 3.0, (ia, ib, ic), color))

    for _, (ia, ib, ic), color in sorted(rows, reverse=True):
        polygon = [(projected[k][0], projected[k][1]) for k in (ia, ib, ic)]
        draw.polygon(polygon, fill=color, outline=(25, 35, 48))

    draw.text((panel_x + 14, 14), label, fill=(225, 232, 240))
    draw.line((panel_x + margin, height - 30, panel_x + panel_w - margin, height - 30), fill=(120, 135, 150), width=2)


def main():
    parser = argparse.ArgumentParser(description="渲染 v6 model.json 五方向視圖")
    parser.add_argument("model")
    parser.add_argument("output")
    args = parser.parse_args()

    model_path = Path(args.model)
    output_path = Path(args.output)
    data = json.loads(model_path.read_text(encoding="utf-8"))
    mesh = data["meshData"]
    flat = mesh["vertices"]
    vertices = [tuple(flat[i:i + 3]) for i in range(0, len(flat), 3)]
    faces = [int(i) for i in mesh["faces"]]
    colors = mesh.get("colors", [])
    if not vertices or len(faces) < 3:
        raise ValueError("model.json 沒有可渲染網格")

    views = (
        (math.radians(-35), "FRONT 3/4"),
        (math.radians(0), "SIDE +Z"),
        (math.radians(90), "FRONT"),
        (math.radians(180), "SIDE -Z"),
        (math.radians(-90), "REAR"),
    )
    width, height = 2560, 512
    image = Image.new("RGB", (width, height), (18, 24, 34))
    draw = ImageDraw.Draw(image)
    panel_w = width // len(views)
    for index, (yaw, label) in enumerate(views):
        render_view(draw, vertices, faces, colors, panel_w * index, panel_w, height, yaw, label)
        if index:
            draw.line((panel_w * index, 0, panel_w * index, height), fill=(55, 65, 78), width=2)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


if __name__ == "__main__":
    main()
