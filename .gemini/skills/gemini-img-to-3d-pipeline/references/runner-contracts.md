# Runner contracts

## Environment matrix

| Component | Required condition | Notes |
|---|---|---|
| Common preprocessing | Python 3.11 with Pillow, NumPy, SciPy, trimesh | `audit_split_targets.py` must import successfully |
| Blender postprocess | Blender 5.2 headless | Used by normalize/intake; do not substitute a GUI-only manual step |
| GPU | NVIDIA CUDA, measured target RTX 3060 12GB | GPU models run sequentially |
| Disk | 30–50GB free recommended | Weights, temporary meshes, sheets; never commit weights |

## SF3D

Pass `--venv <home>`. The data home must provide:

```text
<home>/.venv/Scripts/python.exe
<home>/vendor/stable-fast-3d/run.py
```

Accept the upstream model license and download weights outside the repository. Use only for sculptural tree parts and
the skill-approved fallback/prescreen cases. Do not use SF3D to impersonate a T2 building or Hunyuan rock replacement.

## T2-spz

Pass `--t2 <checkout>`. The checkout must provide:

```text
<checkout>/.venv/Scripts/python.exe
<checkout>/run_t2_gate.py
<checkout>/binarize_feed.py
```

Measured behavior on the target machine: about 3.4GB peak VRAM and about 19GB resident system RAM. Require roughly
20GB free system RAM before load. Feed images through the repository's binarization stage. The raw double shell must
pass `solidify_parts.py` before normalize; do not apply the SF3D solidity threshold to raw T2 output.

## Hunyuan3D-2GP

Pass `--hunyuan <adapter>`. The adapter contract is:

```text
<adapter> <image1> <image2> ... --output-dir <directory>
```

Accept either output layout:

```text
<output-dir>/<index>/mesh.glb
<output-dir>/<target-id>.glb
```

Read the exact checkout README before writing the adapter. Do not guess Python modules, flags, checkpoints, or output
names. Run only 2GP shape generation. The measured project setup used WSL2, about 2.5GB VRAM, 4.9GB weights, and
61–67 seconds per image. The paint stage is excluded.

For a WSL checkout, expose a Windows `.cmd` or executable adapter which:

1. converts every Windows input/output path using `wslpath`;
2. activates the documented WSL environment;
3. invokes the documented shape-only entrypoint;
4. returns a non-zero exit code on missing or corrupt output;
5. writes GLBs back to the requested Windows output directory.

## Runner smoke acceptance

- Process exactly one image per route.
- Record runner path, checkout commit, Python, CUDA, Blender, elapsed time, VRAM, and system RAM.
- Require a readable GLB and contact sheet.
- Require `.feed.json` to map output index/name to the correct mother photo and target.
- Require provenance method to equal `trellis2_spz`, `hunyuan_2gp`, or `sf3d` as selected.
- Do not continue a failed route by changing its method silently.

