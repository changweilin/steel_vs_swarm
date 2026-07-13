---
name: ai-rigging-motion
description: Auto-rig a static mesh (skeleton + skin weights) and generate character animation from text or video using open-source models. Trigger when the user asks to rig/auto-rig a model, generate skin weights, animate a character, do text-to-motion or video-to-motion, retarget animation, or rig non-humanoid/creature meshes.
license: MIT / Apache-2.0 (per repo)
compatibility: Python 3.10+, CUDA GPU; outputs rigged FBX/GLB compatible with Mixamo naming, Unity/Unreal
---

# AI Rigging, Skinning & Motion (Open-Source)

You take a **static mesh** and make it **animatable**: predict a skeleton, solve skin weights, then drive it with generated motion. Open-source now handles non-humanoid rigs and natural-language motion — no manual weight painting.

## 1. Pick the tool by sub-task

| Sub-task | Tool | Why |
|---|---|---|
| Rig any topology incl. multi-leg / creature / non-standard | **UniRig** | Autoregressive skeleton-tree tokenization, no human template |
| Joint skeleton + skin-weight generation, one pass | **SkinTokens (TokenRig)** | FSQ-CVAE skin tokens, +98–133% skin accuracy vs split pipelines |
| Single image → fully-rigged, ready-to-animate character | **AniGen** | Unified S³ field (shape+skeleton+skin), flow-matching |
| Text prompt → 3D skeletal motion clip | **HY-Motion 1.0** | 1B DiT + flow matching, physics-plausible |
| Real-time / streaming NPC motion from language | **TextOp**, **MotionStreamer** | Interactive tracker policy / causal streaming TAE |
| Text-to-motion + motion style transfer, benchmarked | **ViMoGen** | DiT T2M/TM2M, ships MBench |

Canonical pipeline: **SkinTokens (rig+skin)** → **HY-Motion (author clips)** or **MotionStreamer/TextOp (live NPC control)** → export FBX/GLB.

## 2. Tool reference (repo + role + constraints)

### UniRig — VAST-AI, universal skeleton rigging (SIGGRAPH 2025)
- **Repo:** https://github.com/VAST-AI-Research/UniRig
- **Role:** predicts topologically-correct skeletons for arbitrary meshes via Bone-Point Cross Attention; trained on Rig-XL (14k rigs). **Use this when a humanoid template would fail** (quadrupeds, insects, mechs, tentacled creatures).

### SkinTokens / TokenRig — VAST-AI, unified rig+skin
- **Repo:** https://github.com/VAST-AI-Research/SkinTokens
- **Role:** compresses skin-weight matrices into discrete SkinTokens (FSQ-CVAE) and generates **skeleton topology + skin weights in one autoregressive sequence** — removes the error accumulated by "rig first, skin later". Preferred default rigger.

### AniGen — single image → animatable asset (SIGGRAPH 2026)
- **Source:** arXiv 2604.08746 (paper; check for released weights).
- **Role:** one image → shape + skeleton + skin jointly (S³ fields), guaranteeing geometry/joint consistency. Use when starting from a 2D concept instead of a finished mesh.

### HY-Motion 1.0 — Tencent Hunyuan, text-to-motion
- **Repo:** https://github.com/Tencent-Hunyuan/HY-Motion-1.0
- **Run:** clone, install per README, prompt e.g. `"a person performs a squat, then pushes a barbell overhead"` → skeletal 3D motion sequence. 1B params, DiT + flow matching.

### Real-time motion (streaming NPC control)
- **TextOp** — https://github.com/TeleHuman/Textop — two-layer (motion diffusion AR + tracker policy) for live language-driven control.
- **MotionStreamer** — https://github.com/zju3dv/MotionStreamer — causal TAE, seamless streaming; smooth motion switching for dynamic NPCs.
- **ViMoGen** — https://github.com/MotrixLab/ViMoGen — T2M + style transfer, MBench eval.

## 3. Output contract
- Emit **FBX or GLB** with an embedded skeleton; use **Mixamo-compatible bone names** so downstream animation clips and retargeting just work.
- Verify joints don't distort/clip at extreme poses before delivery (the classic auto-rig failure).
- Rig input **MUST** be the retopologized low-poly (from `ai-mesh-generation`), not the dense generator output.

## 4. Constraints
- Non-humanoid mesh → **do not** force a humanoid template; route to UniRig/SkinTokens.
- Prefer open-source local rigging; use a commercial API (Uthana Motion Layer, 3D AI Studio Auto-Rig, Neural4D) only when the user accepts cloud upload or needs one-click humanoid retargeting.
- Rigging/motion is an offline pipeline; only the rigged FBX/GLB enters the game repo.
- All code/comments in English.

_Source: `research/AI 3D 遊戲開發資源指南 (台灣用語版).md` §3._
