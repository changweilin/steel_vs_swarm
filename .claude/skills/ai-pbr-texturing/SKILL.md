---
name: ai-pbr-texturing
description: Synthesize delighted, physically-based (PBR) texture sets for a 3D mesh using open-source models and ComfyUI node graphs. Trigger when the user asks to texture/re-texture a model, generate albedo/normal/metallic/roughness maps, remove baked lighting (delight), UV-bake, or build a texturing node pipeline.
license: MIT
compatibility: Python 3.10+, CUDA GPU, ComfyUI; outputs GLB/PNG PBR sets for Unity/Unreal/Blender
---

# AI PBR Texturing & Delighting (Open-Source)

You generate **clean, delighted PBR texture sets** (Base Color / Normal / Metallic / Roughness / Opacity) for a mesh. The #1 rule in game texturing: **no baked lighting** — engine dynamic lights must own the shading. Delight the source first, then synthesize maps, then bake to UVs.

## 1. Pipeline (model-agnostic, ANIA 5-stage pattern)
```
[ source image ]
   → [ DELIGHT ]        StableDelight / Hunyuan3D-Delight   (kill highlights, shadows, GI)
   → [ mesh ]           (from ai-mesh-generation skill)
   → [ MULTI-VIEW PBR ] ComfyUI graph: Flux + ControlNet → albedo/normal/metallic/roughness
   → [ UV BAKE ]        project multi-view → UV space → export GLB
```
ANIA (SciTePress 2026) defines these as 5 swappable nodes: preprocess → mesh-gen → mesh-opt → multi-view gen → UV-map synthesis. Keep each stage replaceable so a better delight/bake model can drop in without rewiring.

## 2. Tool reference

### Delighting (MUST run before texturing)
- **StableDelight** — diffusion delighter; removes specular highlights + projected shadows, yields a uniform diffuse/albedo. Source: the Stable-X family (find the current repo; verify before running).
- **Hunyuan3D-Delight** — Tencent Hunyuan3D delight module; same purpose, part of the Hunyuan3D repo.
- **Why it matters:** any highlight/shadow left in the albedo double-shades under the engine's own lights → the asset looks dirty and inconsistent across maps.

### TRELLIS.2 built-in appearance (shortcut)
- TRELLIS.2's O-Voxel VAE predicts per-vertex **Base Color / Metallic / Roughness / Opacity** directly and exports a Blender-compatible GLB — including transparency (mesh nets, leaf edges). If TRELLIS.2 geometry already carries acceptable PBR, **skip re-texturing**; only run this skill for a style change or higher-res maps. (See the `ai-mesh-generation` skill.)

### 3DGenStudio — ComfyUI node pipeline
- **Repo:** https://github.com/visualbruno/3DGenStudio
- **Run:** inside ComfyUI. Chain **Flux2Dev / Flux2Klein9B + ControlNet** texture nodes for high-precision projection, inpainting, and normal-map synthesis. Graph/Kanban view lets the agent wire geometry-edit → auto-UV-unwrap → texture-bake and drag-drop a style reference. This is the primary **agent-orchestrable** open path.

### ANIA engine — model-agnostic orchestration
- **Source:** ANIA paper (SciTePress 2026), architecture reference (no single repo). Use it as the mental model for staging + hot-swapping delight/bake models.

## 3. Output contract
- Emit a full PBR set: **Base Color (delighted albedo), Normal, Metallic, Roughness**, + Opacity/Alpha when the mesh has cutouts.
- Match the game's texture budget: **≤2K for hero assets, ≤1K for background** (aligns with `web3d-game-orchestrator`). Do not ship 8K into a browser game.
- Deliver as GLB with embedded maps, or PNG set + material JSON.

## 4. Constraints
- **Never bake lighting into albedo.** Delight is non-optional for any photographed/rendered source.
- Prefer open-source (StableDelight + 3DGenStudio/ComfyUI). Only use commercial APIs (Tripo 8K native, 3D AI Studio Texture API, Scenario style-LoRA) when the user accepts cloud upload or needs a trained house style.
- Textures are a separate offline pipeline; only the final GLB/PNG enters the game repo.
- All code/comments in English.

_Source: `research/AI 3D 遊戲開發資源指南 (台灣用語版).md` §2._
