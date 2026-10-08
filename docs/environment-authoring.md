# Environment authoring project

`tools/environment_authoring/build.mjs` replays the committed transport, scenery,
boundary, ambient, road, facade, walkway and shoreline recipes. Commands live in
`package.json`; `BLENDER_BIN` selects an existing Blender CLI. Otherwise the
installed MCP seam resolves the running Blender executable. Browser reviews use
the existing external Playwright runtime and cached Three.js modules.

Each module runs in a factory Blender process. Existing authoring recipes own
geometry; production review exporters own assembled examples. Rebuilt JavaScript
mesh data is captured under the ignored output directory rather than replacing
the game's shipped modules. Independent editable module files and the combined
`out/environment_project/environment-project.blend` preserve scene boundaries,
module collections, packed images and recipe text blocks.

The generated manifest binds scenes and recipes to the branch commit, Blender
version and project hash. Validation reopens the combined file in another factory
process, compares scene structure, checks packed images and requires rebuilt mesh
bytes to match the shipped modules. Renders provide representative module views;
the browser captures retain the production material review. These synthetic
examples do not constitute geographic reconstruction or survey evidence.
