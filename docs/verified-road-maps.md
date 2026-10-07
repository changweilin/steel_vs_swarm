# Geographic Road Qualification

`mapRules.js` owns the geometry verdict used by interactive search, generated
recipes, the lane baker and room admission. Distances and occupancy metrics are
derived from the final coordinates. The nominal frame is distinct from the
expanded rendering/capture bounds. A canonical base anchors occupancy cells so
reversing faction ownership cannot change overlap eligibility. A fixed geographic
direction anchors navigation sampling so a faction swap cannot shift its sample grid.

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

Urban and fully geographic frames require three verified driving-profile roads.
Green/bare-leading presets may instead use a verified middle road with two
deterministic generated flanks. Leading-biome ties retain the green/bare category
for the catalogue's water/wet variants. The exception retains the full mother
frame, grade, endpoint, balance, separation, navigation and tower verdicts.
Generated flanks are explicitly labelled and bound to the admitted recipe;
changing a source ID or merely declaring a green palette cannot authorize an
arbitrary layout. Unsupported entries remain visible as pending.
The frozen source module is generated from versioned raw OSM/elevation fixtures.
New lane bakes retain graph-derived source paths; missing source identifiers
leave evidence unavailable. Road-search captures preserve original OSM map JSON,
node-resolved ways and Terrarium tiles in a separate fixture directory. Dense
requests split into bounded subregions while retaining the original responses.
Raw JSON captures are stored losslessly with gzip; provenance hashes refer to
the preserved uncompressed bytes. Source decoding stays in the shared fixture
provider. Scenario/relief hints from replaced layouts are omitted until measured
again; variant structure intentions remain visible without claiming completion.
The common road graph serves both full-road and natural-hybrid bakes. Full-road
fixture searches reject incomplete/excessive relief before preference ranking,
and final rotation participates in the geometry verdict. Changed routes require
regenerated source evidence; captured search windows never rescale their roads.
Bounded natural diagnostics preserve search limits, source hashes, rejection
counts and the least maximum grade among complete relief candidates. A failed
search describes its captured window and sampled layouts; it cannot prove that
the entire region has no qualifying layout.

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
mother. A natural-hybrid surface is permitted only while the resulting mixed
palette remains green/bare-leading; regional selection continues past palettes
that invalidate that policy. Preparation keys include mother fingerprints,
road mode and rule version;
cached and in-flight results transfer the same relief packet to new configurations.
Failed preparation clears inherited relief packets for every caller; stale UI
callbacks cannot save, open or overwrite a subsequently selected map.
Old custom favorites retain their coordinates and require regeneration when
incompatible; automatic shrinking would detach them from their source roads.
Known preset favorites with obsolete source packets rebuild from the current
catalogue without changing authored story routes.

Server room creation recomputes reported distance, diagonal and overlap metrics
before settlement. It checks mother/subset identity, endpoints, navigation,
separation, length balance, tower geometry and source packets across transports.
Room admission detaches the host recipe before normalization and ownership swaps;
the solo transport shares memory, unlike JSON messages over a socket.
Combat state and shared scene randomness remain outside these map checks.

Verification lives in `test/mapRules.mjs`, `test/venueRoadSources.mjs`,
`test/mapCatalogue.mjs`, `test/mapPreparation.mjs`, `test/mapSelection.mjs`, `test/mixedMap.mjs`,
`test/randomMap.mjs` and the existing lane, observation and
relay audits. Commands live in `package.json`.
