# Satellite and OSM Map Evidence

Map creation prepares a versioned observation field before saving a favorite or
opening a room. Room prebuilding awaits the field before land-surface generation;
the existing loaded handshake still gates battle entry.

## Sources and support

| Input | Support | Use |
|---|---|---|
| ESA WorldCover 2021 v200 | Packaged numeric uint8 crops for every entry in VENUES, including story venues | Historical land-cover prior; native nominal resolution 10 m. |
| Existing RGB imagery | Raw, unstylized pixels; transparent missing tiles excluded from analysis | Green/gray fractions, brightness, texture variation and directional contrast. |
| Existing Terrarium elevation | Original metres, before amplification, grading and carving | Slope and local ridge/valley/rolling/steep descriptors. |
| Existing OSM queries | Shared projected/catalogued polygons, priorities and holes | Semantic cover and footprint agreement; exact building footprints remain owned by the existing building pipeline. |
| Geology and tree species | Unknown | No lithology or species is inferred from RGB or land-cover classes. |

Custom geographic maps use available RGB, elevation and OSM observations. Numeric
WorldCover crops are bundled for preset venues; there is no runtime WorldCover
downloader for arbitrary user-selected locations. Synthetic maps use their own
scene seed and conservative cover fallback when observations are unavailable. Sentinel multispectral indices and a learned classifier
are outside this implementation.

WorldCover is a dated prior, not a current survey or a building detector. See the
[official source](https://esa-worldcover.org/en/data-access) and
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The shipped JSON crops retain attribution, product identity, source URLs, numeric
pixel SHA-256, header SHA-256 and compressed-block SHA-256. In-game help exposes
the attribution and source date. Software licensing does not replace source licensing.

## Single seams

| Module | Responsibility |
|---|---|
| mapEvidence.js | Pure feature extraction, projection frame, quantization, validation, sampling and dry-surface resolution. |
| mapEvidenceLoader.js / mapEvidenceWorker.js | Preset loading, bounded worker lifetime, fallback computation and derived IndexedDB records. |
| mapPreparation.js | Explicit creation lifecycle, existing terrain/OSM providers, source-only terrain inputs and favorite metadata. |
| mapEvidenceRelay.js | Stateless, browser/Node-safe bounded envelope and shared sanitization. |
| main.js | Favorite/open-room/story/restart waits, room observation gate and stale-room rejection. |
| rooms.js | Host-only immutable room record, frame verification and join/reattach replay. |
| tools/venue_field.mjs | Node-side provider entry for numeric WorldCover capture. |
| tools/worldcover_source.mjs | Narrow range reader for the supported ESA uint8 Deflate GeoTIFF layout. Unsupported layouts fail before publishing. |
| tools/prepare_map_evidence.mjs | Crops derived from the venue roster and real battle boxes, with a halo across team and story modes. |

The frame uses battleRect() and xzToLL() directly, including the frozen map bearing
and game/real scale. Analysis uses nominal 20 m real cells, capped at 192 per side.
This is observation resolution, not mesh or collision resolution.

## Numeric field

Each cell has twelve bytes, in this order:

| Channel | Meaning |
|---|---|
| Cover | Native WorldCover codes; zero means unknown. |
| Confidence | Ordinal support: 0 unknown, 1 prior/weak RGB, 2 corroborated RGB or OSM boundary support, 3 OSM support covering at least four of five probes. These are not calibrated probabilities. |
| Texture | Quantized local brightness variation across 20/60/180 m stencils. |
| Coherence | Directional contrast, not a learned structure tensor or GLCM model. |
| Slope | Degrees from original real-metre elevations; missing samples omitted. |
| Coupling | Five-point fraction inside the selected OSM polygon; holes remain excluded. |
| Sources | Bits: WorldCover 1, RGB 2, OSM 4, valid slope 8, prior/OSM conflict 16. |
| Landform | 0 unknown, 1 plain, 2 rolling, 3 ridge, 4 valley, 5 steep. |
| Green fraction | Quantized local RGB vegetation support. |
| Gray fraction | Quantized local low-saturation fraction; never enough to fabricate an urban label. |
| Brightness | Local mean RGB brightness. |
| Geology | Zero/unknown. |

OSM semantic footprints take precedence over a conflicting historical prior and
retain a conflict bit. Generic green OSM areas keep observed vegetation subtypes.
RGB alone can provide weak green support; gray rock, shadows or bright roofs do
not generate building evidence. Gray fraction, texture variation and directional
contrast can corroborate an existing built prior, without creating one from RGB.

## Cache and room lifecycle

The existing geocache.js database owns derived records. Keys include algorithm
version, exact frame and fingerprints of numeric source pixels, raw elevations,
semantic masks, polygon agreement and prior identity. A complete hit skips worker
feature extraction. Source sampling still verifies that inputs have not changed.

Only complete own-source observations persist: imagery and elevation must be
complete, OSM must have answered, and a venue prior must have loaded when requested.
Partial records can be used in memory but never replace complete cache entries.
Writes resolve after transaction completion; quota failures and denied storage
degrade silently. At most 24 derived entries remain, each bounded by the field size.
The existing clear-cache control clears them with other geographic inputs.

The room host consumes the same validated bytes sent to other clients. The server
checks the frozen battle frame and stores one detached immutable record. It sends
that record once and replays it for joins and reattachments; it stays out of repeated
sync payloads and never mutates battleConfig. Received observations remain in
client memory and never enter that client's persistent geographic cache.

Guests await the host record before affected generation. A timed-out observation
is omitted; a late record can rebuild a room preview, but never a running battle.
Stale completions are rejected by room/player/frame identity. Workers time out and
terminate; unsupported workers use the same pure function synchronously.

## Generation boundary

The habitat recipe consumes the room's validated observations for dry surface
materials, canopy structure and low vegetation. Exact OSM polygons, roads, slope
gates and terrainEnvCode() retain precedence. Water and swamp authority do not
come from WorldCover or RGB evidence. Buildings retain exact OSM footprints;
botanical models and trunk collision keep the existing climate-aware forest seam.
See [habitat generation](habitat-generation.md) for the deployed recipe.

The generated scene is a plausible interpretation of cover structure, not a
surveyed reconstruction of terrain, building height, lithology or tree species.
No local accuracy estimate is claimed here.

## Verification

audit_map_evidence.mjs verifies every source crop and all venue/team/mode frames,
unknown and conflict masks, polygon holes, real-metre slopes, deterministic byte
replay, bounded host-only envelopes, detached solo ownership, joins, reconnects
and creation ordering. shot_map_evidence.mjs exercises actual browser module
workers and IndexedDB cold/warm/invalidation/recovery/eviction paths.
Its creation mode exercises the real terrain/OSM preparation with numeric tile
fixtures; THREE_CACHE can supply the existing production CDN modules offline.
Commands live in package.json.
