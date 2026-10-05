# Geographic Road Qualification

`mapRules.js` owns the geometry verdict used by interactive search, generated
recipes, the lane baker and room admission. Distances and occupancy metrics are
derived from the final coordinates. The nominal frame is distinct from the
expanded rendering/capture bounds. A canonical base anchors occupancy cells so
reversing faction ownership cannot change overlap eligibility.

`roadEvidence.js` traces each complete lane through connected driving-profile
edges, preserves source paths and way ownership, and applies the shared bridge
and tunnel portal rule. Sampled relief is retained with the recipe; grade and
reference infantry travel times are recomputed on replay. These are conservative
raw-elevation estimates before road grading and structural deck construction.
They do not claim measured road-deck heights or match-specific arrival times.

## Sources and eligibility

Every mother lane records OSM-baked, OSRM, synthetic or unverified provenance.
The interface reports both the mother and active subset. A single synthetic flag
does not certify geographic authenticity. Source versions, data fingerprints,
original geometry and way identifiers survive favorites, room ownership swaps
and joins. OSRM receipts additionally retain routing-node identifiers.

The real geographic catalogue requires the entire mother, its geometry and its
relief assessment to qualify. Unsupported entries remain visible as pending;
terrain/variant categories do not manufacture roads to fill catalogue slots.
The frozen source module is generated from versioned raw OSM/elevation fixtures.
New lane bakes also retain graph-derived source paths; missing source identifiers
leave evidence unavailable. A changed route requires recapture and regeneration.

Interactive selection uses bounded source requests, snap radiuses and alternative
routes. Missing roads, elevation or flanks omit the candidate. Offline service
failure does not create a geographic fallback; the separate random mode remains
available. Preference scoring follows eligibility and includes proximity, length
balance, separation, reference travel time and source grade.

Story campaigns retain their independently authored single-lane `m1` recipes and
existing tower policy. The server binds these recipes to the shipped route;
unverified source status stays visible. They are separate from the full-scale
three-road catalogue and cannot authorize arbitrary custom geographic geometry.

Checksums identify replay/invalidation and detect ordinary corruption. They are
not authenticity signatures. Bundled proofs are compared to shipped source
records; custom service receipts are host-provided, validated for geometry and
source consistency, and retained unchanged. The room server does not independently
authenticate public-service responses.

## Creation and replay

Favorites and room creation await preparation and the shared verdict. A borrowed
mixed-map elevation source must be assessed against its retained surface-road
mother. Preparation keys include the mother fingerprints and rule version;
cached and in-flight results transfer the same relief packet to new configurations.
Failed preparation clears inherited relief packets for every caller; stale UI
callbacks cannot save, open or overwrite a subsequently selected map.
Old custom favorites retain their coordinates and require regeneration when
incompatible; automatic shrinking would detach them from their source roads.

Server room creation recomputes reported distance, diagonal and overlap metrics
before settlement. It checks mother/subset identity, endpoints, navigation,
separation, length balance, tower geometry and source packets across transports.
Combat state and shared scene randomness remain outside these map checks.

Verification lives in `test/mapRules.mjs`, `test/mapPreparation.mjs`, `test/mapSelection.mjs`,
`test/mixedMap.mjs`, `test/randomMap.mjs` and the existing lane, observation and
relay audits. Commands live in `package.json`.
