# Faction asset authoring

The faction contract is [factions.json](../tools/mech_authoring/factions.json). Its Blender
adapter replaces the two faction NPC and combat-building silhouettes through their existing
builders. Third-party troops and civilians keep their own builders. Gameplay dimensions still
come from `data.js` and are fitted once by `models.js`.

Swarm uses lightweight carbon trusses, overlapping honeycomb armor, replaceable exposed power
packs, open ducted rotors and distributed relay structures. Steel uses welded armor wedges,
recessed vision slits, paired hydraulic joints, protected coaxial rotors and fortified foundry
structures. These are original authored designs based on the fictional doctrines in
`characters.md`; no photographic dimensions or image reconstruction are claimed. Palettes
derive from `factionModelStyle.js` rather than a second color table.

The shared Blender mesh exporter batches geometry by driver joint and material. The same bones
drive editable Blender action tracks and the runtime's existing gait, aim, suspension and
event-clock recoil. Rigid mechanical parts stay attached to their moving joints; damage never
rewrites their vertices. Swarm gait is alert and responsive; Steel gait uses a slower weight
transfer. Tower barrel order and the separately attached base batteries preserve the weapon API.

Editable scenes and review evidence live in `out/faction_reference/`; GLBs live in
`public/assets/models/factions/`; generated runtime batches live in `public/js/forge/factionAssets/`.
Commands belong to `package.json`. The MCP route launches factory Blender workers so authoring
cannot delete an unrelated live scene. A rebuild uses isolated output paths. Validation combines
source hashes, independently loaded GLBs, multiple poses, monochrome silhouettes and the shipped
renderer. User visual approval remains separate from technical validation.
