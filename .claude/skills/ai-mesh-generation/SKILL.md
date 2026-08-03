---
name: ai-mesh-generation
description: Generate 3D geometry (mesh) from a single image or text prompt using open-source models, then retopologize into game-ready low-poly. Trigger when the user asks to turn an image/concept into a 3D model, create a mesh/base mesh, do image-to-3D or text-to-3D, split a model into parts, or clean up AI-generated topology.
license: MIT
compatibility: Python 3.10+, CUDA GPU (8GB+ VRAM) or Apple Silicon (MLX); exports GLB/OBJ for Blender/Unity/Unreal
---

# AI Mesh Generation (Open-Source Geometry Pipeline)

> **Boundary in this repo (steel_vs_swarm) — read before running any of this.**
> Procedural generation is the **default** here, not the fallback: `CLAUDE.md` §1 pairs
> `MODEL_MANIFEST` with a procedural fallback, and `.claude/skills/procedural-object-detail`
> covers parametric generators, deterministic seeding and attribute-field variation. So
> "never hand-model when a generator will do" below means an **AI mesh generator or a
> parametric one** — it is not a licence to prefer a baked GLB over a parametric generator.
> Reach for this pipeline only for a hero asset a parametric generator genuinely cannot
> express, because a baked mesh gives up everything the generator gives for free: per-instance
> variation, zero binary payload, and determinism across clients. Anything that does cross
> over enters as geometry + delighted base colour only (see `ai-pbr-texturing`); normal maps
> MUST be deleted and the gltf rewritten to drop the reference.

You are a 3D asset TA. Turn an image or prompt into a **topologically clean, engine-importable mesh**. The open-source path favors local deployment (privacy, zero API cost). Never hand-model when a generator + retopo pass will do.

## 1. Pick the tool by sub-task

| Sub-task | Tool | Why |
|---|---|---|
| Image→3D, high-fidelity, PBR-ready geometry | **TRELLIS.2 (4B)** | Native O-Voxel, exports GLB with PBR, runs on 8GB VRAM |
| Retopo an AI/dense mesh → artist-grade low-poly | **MeshAnything V2** | Quad-dominant, clean edge flow, ≤1600 faces |
| One image → structured multi-part object (arm/torso/head) | **PartCrafter** | One-shot compositional parts for modular props/colliders |
| Single-image → mesh, fast baseline (fallback) | **InstantMesh** | Sparse-view LRM, lightweight |
| Local desktop GUI + CLI, privacy-first | **Modly** | Wraps Hunyuan3D-Mini, built-in smoothing/decimation |

Canonical pipeline: **TRELLIS.2 (dense mesh) → MeshAnything V2 (retopo) → export GLB**. PartCrafter substitutes stage 1 when the asset is inherently multi-part.

## 2. Tool reference (repo + invocation + hard constraints)

### TRELLIS.2 — Microsoft, 4B image-to-3D
- **Repo/weights:** https://github.com/microsoft/TRELLIS.2 · `microsoft/TRELLIS.2-4B` (Hugging Face)
- **Run:** `git clone` the repo, follow its README to install; load `microsoft/TRELLIS.2-4B`, feed an RGB image, export **GLB**. Apple Silicon: use the MLX port. Exact entrypoint/flags live in the repo README — read it, don't guess.
- **Constraints:** needs ≥8GB VRAM for consumer GPUs (e.g. RTX 3060); H100 does 1024³ voxels in ~17s. Output is dense — **always pass it through retopo (stage 2) before rigging/animation**. Outputs Base Color / Metallic / Roughness / Opacity directly (see the `ai-pbr-texturing` skill to decide if you still need a re-texture pass).

### MeshAnything V2 — artist-created mesh / retopology
- **Repo:** https://github.com/buaacyw/meshanything (project page: buaacyw.github.io/meshanything-v2)
- **Run:** clone, install per README, feed a **dense** source mesh (from TRELLIS.2 / an LRM like Rodin), get back a quad-dominant low-poly.
- **Constraints (MUST honor or it fails silently):**
  - Input up-axis **MUST be +Y**; normalize the mesh to a **unit bounding box** first.
  - Hard cap **≤1600 faces** — the input must have sharp, well-defined features; blobby inputs can't be expressed in the budget.
  - It is a *topology cleaner*, not a generator. Garbage-in on features = garbage low-poly out.

### PartCrafter — structured multi-part generation
- **Repo:** https://github.com/wgsxm/PartCrafter (NeurIPS 2025)
- **Run:** single RGB image in → multiple part meshes out (one-shot). Also does 3D-Front-style scene layouts.
- **Use for:** props that need separable colliders / physics parts (a chair → back/seat/legs; a robot → limbs/torso/head). Feeds modular assembly directly.

### InstantMesh — fast single-image baseline
- **Repo:** https://github.com/tencentarc/instantmesh
- **Use as** the low-VRAM / quick-draft fallback when TRELLIS.2 is too heavy.

### Modly — local desktop app (Win/Linux/macOS)
- **Repo:** https://github.com/lightningpixel/modly
- **Run:** GUI or its **CLI** (agent-callable) for image→mesh with adaptive smoothing + decimation, fully local GPU.

## 3. Handoff & output contract
- Emit **GLB** (preferred) or OBJ, +Y up, unit-scaled, watertight where the engine needs collision.
- Dense generator output → retopo → **then** send to the `ai-rigging-motion` skill for skeleton/skin.
- Texture/PBR concerns belong to the `ai-pbr-texturing` skill; do not bake lighting into geometry.

## 4. Constraints
- Prefer local open-source models; only fall back to a commercial API (Tripo P1.0, Meshy-6, Luma Ray 3.2) when the user explicitly accepts cloud upload / has no capable GPU.
- Do not add a build step, bundler, or npm dependency to the host game project — these tools run as a **separate offline asset pipeline**, their output (GLB) is the only thing that enters the repo.
- All generated code/comments in English.

_Source: `research/AI 3D 遊戲開發資源指南 (台灣用語版).md` §1._
