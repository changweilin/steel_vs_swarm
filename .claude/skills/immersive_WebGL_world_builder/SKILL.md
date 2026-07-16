# Skill: Immersive WebGL World Builder

## Description
An iterative workflow for conceptualizing, architecting, and developing high-end 3D WebGL scenes (using Three.js, WebGPUL, Shaders, etc.). This skill ensures that technology always serves the creative vision, establishing a clear blueprint before any code is written, and prioritizes continuous, incremental refinement.

---

## Workflow Phases

The Agent must strictly guide the user through these four phases sequentially. Do not jump to coding until Phase 3 is completed and approved.

### Phase 1: Concept & World Exploration
**Goal:** Extract the artistic and experiential vision from the user.
*   **Action:** Prompt the user to describe their desired world. If any of the following details are missing, proactively ask clarifying questions to define:
    *   **Visuals & Atmosphere:** Mood, lighting tone, color palette, level of realism vs. stylization.
    *   **Composition:** Camera perspective, focal points, framing, and spatial depth.
    *   **Interaction & Motion:** How the user interacts with the world, hover effects, camera transitions.
    *   **Animation & Dynamics:** Ambient movements, physics, particle behavior.
    *   **Assets Strategy:** What should be mathematically/procedurally generated versus loaded as external 3D assets (GLTF/OBJ).

### Phase 2: Tech Stack Alignment
**Goal:** Map the creative concept to the most efficient and robust WebGL/WebGPU ecosystem.
*   **Action:** Analyze the approved concept from Phase 1 and recommend the precise technical stack.
*   **Rule:** The stack must follow the idea, not the other way around.
*   **Potential Technologies to Consider:**
    *   **Core:** Three.js / WebGL / WebGPU
    *   **Shaders:** Vanilla GLSL / Three.js Shading Language (TSL)
    *   **Animation & Physics:** GSAP (GreenSock), Rapier, custom math-based Euler integration
    *   **Rendering Pipeline:** Post-processing passes (Bloom, SSAO, Depth of Field, custom fragment shader overlays)
    *   **Procedural Systems:** Custom BufferGeometry, GPU/CPU Particle Systems
*   **Output:** A structured recommendation table explaining *why* each technology is selected to support the specific atmosphere or mechanics.

### Phase 3: Detailed Coding Prompt (The Blueprint)
**Goal:** Create a comprehensive technical blueprint that serves as a single source of truth before writing the actual application.
*   **Action:** Generate a detailed, structured coding prompt. This prompt must define:
    1.  **Scene Structure & Hierarchy:** Tree structure of groups, meshes, lights, and cameras.
    2.  **Materials & Shaders:** Specific material types (e.g., MeshPhysicalMaterial vs. custom RawShaderMaterial) and uniform bindings.
    3.  **Lighting Setup:** Light types, positions, colors, intensities, and shadow configurations.
    4.  **Animation & Interaction Loops:** Tick functions, GSAP timelines, event listeners (mousemove, scroll, resize).
    5.  **Technical Constraints:** Performance targets, texture sizes, canvas scaling, clean-up/disposal logic to prevent memory leaks.
*   **Output:** The fully compiled "Blueprint Prompt" for the user's review and validation.

### Phase 4: First Implementation & Iterative Refinement
**Goal:** Deploy the initial scaffold and polish it through targeted, feedback-driven iterations.
*   **Action 1 (First Implementation):** Write the clean, modular boilerplate code based on the approved Blueprint Prompt. Keep it structured and highly commented.
*   **Action 2 (Iterative Polishing):** Emphasize to the user that the first draft is just the foundation. Prompt the user to test and collaborate on adjusting:
    *   **Proportions & Spatial Layout:** Fine-tuning object scales, positions, and camera FOV.
    *   **Shader Refinement:** Adjusting noise algorithms, color blending, and vertex displacements.
    *   **Motion Design:** Easing curves, transition speeds, damping/damping factor on controls.
    *   **Visual Noise Control:** Reducing distracting elements to focus on the core atmosphere.
    *   **Performance Optimization:** Asset optimization, drawing calls reduction, frustum culling.

---

## Agent System Guidelines
1.  **Never Code First:** If the user asks for a Three.js scene directly, gently pause them and initiate **Phase 1** to capture the artistic vision first.
2.  **Be a Creative Partner:** Don't just act as a code generator. Offer creative suggestions on atmosphere, camera angles, and shader techniques that elevate the user's initial idea.
3.  **Encourage Micro-Iterations:** In Phase 4, avoid rewriting the entire codebase for minor changes. Instead, provide targeted code snippets or specific file modifications to keep the debugging loop fast and precise.