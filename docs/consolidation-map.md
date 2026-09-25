# JS 碎片群整合清單（供下一對話）

> 產出：2026-09-25 盤點。本輪只刪圖檔/孤兒稽核，未動 JS 架構。
> 合併時遵守：單一結算縫（勿建第二份真相）、`data.js` 為平衡唯一真相、
> 散布路徑勿用 `Math.random()`、動工前開 `public/js/.claude.md` §1 查邊界。

## 群組（檔數 / 加總）

| 群 | 檔案 | 備註 |
|---|---|---|
| vehicle(4) | vehicleIndividualBodies73k, vehicleCatalog, vehicles26k, vehicleModels | `vehicleEveryday/Industry/Equipment/Variants/Consists/Parts` (6 檔) 已收攏至 `vehicleCatalog`；`vehicles.js` 嚴守零 import / 零 THREE / 零亂數之碰撞外層縫保留 |
| vessel(3) | vesselModels, vesselCatalog, vesselGeometry4k | `vesselEquipmentModels` 併入 `vesselModels`；`vesselLayout` 併入 `vesselCatalog`；`vesselGeometry` 供屋頂/建築/環境純幾何共用保留 |
| ground(7) | ground237k, terrain82k, proceduralGroundParts21k, groundCatalog16k, groundPartCatalog13k, groundMarkings12k, proceduralGround8k | ground.js 是 hub；`groundVisitorSites/Landscapes/Venues` 已收攏進 groundPartCatalog / groundCatalog / proceduralGround |
| arch(7) | architectureStyles43k, architectureFacadeParts24k, architectureRoofParts11k, functionalArchitectureCatalog13k, regionalArchitecture8k, towerBuildings5k, architecturePartGeometry3k | `roofProfiles` 併入 `architectureRoofParts`；`functionalArchitecture` 併入 `functionalArchitectureCatalog`；`towerBuildingRules` 併入 `towerBuildings`；`nativeFunctionalBuildings` 併入 `buildingFunctions` |
| env(3) | environment51k, environmentParts45k, environmentCatalog5k | environmentParts 為 hub；`environmentArchitecture` 已併入 environmentParts |
| venue(4) | venueText135k, venues41k, venueLanes35k, venueGrid1k | venueGrid 僅 roadgrid/venueGrid/稽核/bake 引用；bake_venue_* 三支工具對應 |
| building(5) | buildingAppurtenances109k, buildingDiversity29k, buildingFunctions14k, approvedBuildingModels12k, buildingUnitModels11k | buildingDiversity 被 7 支 import 的 hub；`nativeFunctionalBuildings` 已收攏至 `buildingFunctions` |
| osm(5) | osmAreas58k, osmBuilding29k, osmrelay19k, osmAreaObjects9k, osmQuery7k | osmAreas 被 5 支 import 的 hub |
| wall(2) | wallDecorations, wallpanel | `wallDecorationCatalog` 已併入 `wallDecorations`；`wallpanel` 供 `audit_siteplan` 驗證零 import 面板切分，保留獨立 |
| story(5) | lore143k, storytalk38k, story37k, codex28k, storyui8k | 與 tools/story_book 共用 storyui 縫，勿拆 |
| audio_vfx(7) | toon162k, castfx104k, vfx79k, postfx68k, audio52k, petals16k, castparticles13k | toon 被 32 支 import 的全域 hub，動它=動全部 |
| char_npc(13) | locomotion112k, aquatics69k, mecha52k, npcModels40k, charPreview37k, matsample34k, summonModels27k, wildlife22k, gaitcurve21k, pedestrian19k, morphrig15k, portraits11k, npcicon6k | forge/ 目錄另有 45 支 mechs（0.93MB） |
| geo_terrain(13) | biomes761k, edgewall63k, roadgrid55k, geology47k, hazards43k, siteplan33k, mapSelect29k, forestSpecies24k, edgeSlope24k, forest19k, mapgen16k, geologyPhenomena6k, geologyBattle4k | biomes/data/rng/toon 為全域 hub |

## 建議順序

1. ✅ **已完成 (Stage 1)**：`wallDecorationCatalog`＋`environmentArchitecture`＋`groundVisitorSites/Landscapes/Venues`（5 支碎片已整併至相應主模組，刪除 5 檔，全單元測試與平衡稽核通過）。
2. ✅ **已完成 (Stage 2)**：
   - `vessel(5 -> 3)`：`vesselEquipmentModels` 併入 `vesselModels`，`vesselLayout` 併入 `vesselCatalog`（刪除 2 檔）。
   - `vehicle(10 -> 4)`：`vehicleEveryday`, `vehicleIndustry`, `vehicleEquipment`, `vehicleVariants`, `vehicleConsists`, `vehicleParts`（6 檔）全數收攏至 `vehicleCatalog`；`vehicles.js` 零 import 碰撞縫與 `vehicleModels` 3D 渲染縫保留（刪除 6 檔）。
3. ✅ **已完成 (Stage 3)**：
   - `arch(11 -> 7)` + `building(5)`：
     - `towerBuildingRules` 併入 `towerBuildings.js`（刪除 1 檔）。
     - `nativeFunctionalBuildings` 併入 `buildingFunctions.js`（刪除 1 檔）。
     - `functionalArchitecture` 併入 `functionalArchitectureCatalog.js`（刪除 1 檔）。
     - `roofProfiles` 併入 `architectureRoofParts.js`（刪除 1 檔）。
     - `test/roofSeams.mjs` 透過 `doorFinish` 單一縫對齊動態門色；全 CI、離線稽核（42 項）與平衡測試全過。
4. ground/venue/osm：牽涉 bake 工具與伺服器地形縫，最後動。

## 本輪已刪（備份在 D:\data\steel_vs_swarm_ai3d）

- `backup/assets/characters/` 11 張（無人引用）
- `public/assets/cyberpunk_art/characters/` 16 張（與 characters 同名但位元組皆不同；舊稿，僅 D 槽留存）
- logo 5 PNG（留 `logo_flat.png`＋`logo_parts.json`；split/flatten/compose 工具需自 D 槽還原才可跑）
- 孤兒稽核 14 支＋`clean_portraits.py`；34 支「疑似孤兒」經查仍被 CI/文件/他支引用而保留（含 lane_scenarios、venue_biome、traverse、lane_grade_sep、audit_src 共用基建）
