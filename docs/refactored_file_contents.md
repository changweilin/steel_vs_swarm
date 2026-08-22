You are an expert AI documentation architect. Your task is to refactor, deduplicate, and optimize all project memory and instruction files (including `CLAUDE.md`, `AGENTS.md`, and related rule documents) following the Progressive Disclosure and Single Source of Truth (SSOT) principles.

Please review the existing documentation and codebase, then reorganize them according to the following rules:

### Objectives:
1. **Enforce SSOT (Single Source of Truth)**:
   - Remove redundant schema definitions, API shapes, or type definitions that already exist in code files (e.g., TypeScript types, Prisma/Drizzle schemas, OpenAPI). Point directly to the source files instead.
   - If logic details or edge cases are specific to a single function/file, move them into code comments (JSDoc / Docstrings) and remove them from memory markdown files.
   - Remove basic language conventions, syntax guidelines, and lint/style rules that are already covered by ESLint, Prettier, Biome, or standard type checks.

2. **Streamline Root Instruction Files (`CLAUDE.md` / `AGENTS.md`)**:
   - Keep root files under 150-200 lines.
   - Retain ONLY:
     - Essential Build, Test, Lint, and Typecheck commands.
     - High-level architecture map / directory overview.
     - Critical project-wide gotchas and non-obvious operational constraints.
     - A "Read When / Trigger" documentation index pointing to deep docs.

3. **Decentralize & Structure Modular Knowledge**:
   - Move deep domain architecture, workflow SOPs, and complex workflows into `docs/*.md`.
   - Move subsystem-specific constraints into subfolder configs (e.g., `packages/*/CLAUDE.md`) or dedicated modular rules (e.g., `.claude/rules/*.md`).
   - For recurring complex operational workflows, convert them into structured definitions in `.claude/skills/` (using English for all agent SKILL definitions and code comments).

### Output Requirements:
1. **Audit & Cleanup Summary**: A bulleted list of duplicated, obsolete, or misplaced items identified and removed.
2. **Refactored File Contents**: Provide the complete, production-ready markdown content for each resulting file (e.g., root `CLAUDE.md`, updated `AGENTS.md`, and any newly created `docs/*.md` or `.claude/rules/*.md`).