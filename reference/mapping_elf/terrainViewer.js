import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { haversineDistance, cumulativeDistances } from './utils.js';
import { WeatherFx3D } from './weatherFx3D.js';

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
// Overpass mirrors tried in order — the main instance is frequently rate-limited
// (429) or times out, which previously dropped the whole 圖資 layer. Falling
// through to mirrors makes the map-feature download succeed far more often.
const OVERPASS_APIS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const GRID_SIZE = 25;

// The coarse downloaded grid is lightly smoothed and upsampled to a finer field
// (SUBDIV fine samples per coarse cell) that is shared by BOTH the rendered
// surface and the iso-lines. This makes the terrain read smooth instead of
// faceted (kills the regular diagonal "corduroy" artefact) and keeps the
// contours hugging the same surface so they no longer break through it. Missing
// elevation (holes) propagates through, so blank tiles aren't drawn.
const SUBDIV = 6;
const FIELD_SIZE = (GRID_SIZE - 1) * SUBDIV + 1; // 145

export class TerrainViewer {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.clock = new THREE.Clock();

    this.routePoints = [];
    this.routeElevations = [];
    // Per-vertex route gradient colours (THREE.Color[], aligned to routePoints),
    // mirroring the 2D map / elevation-chart gradient. null → legacy single colour.
    this._routeColors = null;
    this.terrainMesh = null;
    this.routeLine = null;
    this.routeTube = null;
    // Vertical drop-line "stems" connecting a suspended (absolute-elevation) track
    // to the terrain surface below it (Plan §II-4). Built with the route, hidden
    // unless the 絕對海拔 (suspended) mode is on.
    this._routeStemGroup = null;
    this._absoluteElevation = false;
    // Time-dynamic trail reveal (Plan §II-1): when on, the tube + overlay line are
    // progressively revealed up to the player's current position (CZML-Path style)
    // instead of drawn whole. These cache the geometry's segment counts so the
    // per-frame draw-range/instance-count update is cheap.
    this._routeReveal = false;
    this._routeTubeSegs = 0;
    this._routeTubeRadial = 8;
    this._routeLineSegs = 0;
    this.waypointMarkers = [];
    this.weatherLabels = [];
    this.playerMarker = null;
    this.playerPath = null;

    this.contourGroup = null;
    this.contourLabelGroup = null;
    this.waypointLabelGroup = null;
    this.weatherGroup = null;

    // Contour precision: 'high' | 'low' | 'none'. Drives the iso-line interval
    // (smaller = more bands) and visibility. Rebuilt from the cached grid.
    this._contourPrecision = 'high';
    this._contourLabelsVisible = true;

    // Global text-label size: 'large' (default) | 'small' | 'none'. Scales (or
    // hides) every billboard/text sprite on the model — contour heights, weather
    // tags, waypoint signs and map-feature names. Each registered sprite stores
    // its base scale so the factor is applied relative to that.
    this._labelScale = 'large';
    this._labelSprites = [];
    this._LABEL_FACTORS = { large: 1, small: 0.6, none: 0 };

    // --- Map features (roads / water / land cover / buildings) ---
    this.featureGroup = null;
    this.featureLabelGroup = null;
    this._featuresVisible = true;
    this._weatherVisible = true;
    // Point-landmark models (peaks/trees/towers/viewpoints/monuments) are visual
    // embellishments rather than base map imagery, so 特效 (effects) can declutter
    // them independently of 圖資 — visible only when BOTH 圖資 and 特效 are on.
    this.landmarkGroup = null;

    // --- Clickable 3D markers (billboard signboards) ---
    this._onMarkerClick = null;
    this._pickables = [];                 // THREE objects with userData.detail
    this._raycaster = null;
    this._pointer = new THREE.Vector2();
    this._pointerDownInfo = null;         // { x, y, t } for click-vs-drag detection
    this._pointerHandlersBound = false;
    this._markerScale = 1;                // marker size factor, scaled to terrain

    // Wide (pixel-width) line materials — contours + route track — that need
    // their `resolution` kept in sync with the renderer size.
    this._lineMaterials = [];

    this._grid = null;
    this._bbox = null;
    // Smoothed/upsampled height field shared by the surface mesh + contours, and
    // the valid (hole-excluded) elevation range over it.
    this._field = null;
    // Per-vertex land-cover family (FIELD_SIZE²) baked into the terrain colours.
    this._landCoverField = null;
    // Per-vertex true slope (FIELD_SIZE²) used by the terrain colouring.
    this._slopeField = null;
    this._fieldMinV = 0;
    this._fieldMaxV = 1;
    this._terrainInfo = null;
    // Vertical datum: terrain (and everything on it) is shifted down by the
    // terrain's minimum elevation, so the empty band below the lowest ground
    // (e.g. sea-level 0–500 m that isn't on the map) isn't rendered.
    this._elevBase = 0;
    // Vertical scale applied to every elevation in _latLngToLocal. 1 = true scale.
    // When "海拔高度歸一化" is on, the scale is recomputed so the terrain's relief
    // fills a consistent fraction of its horizontal span regardless of how flat
    // or mountainous the area actually is.
    this._elevScale = 1;
    this._elevNormalized = false;
    // Cached source data for an in-place geometry rebuild (normalization toggle)
    // that doesn't re-download anything.
    this._buildCtx = null;
    this._featuresData = null;
    // Bbox the in-memory _featuresData were built for, so a redraw can safely
    // reuse them as a fallback only when the area hasn't changed.
    this._featuresDataBbox = null;

    this._playing = false;
    this._speed = 1;
    this._progress = 0;
    this._animFrameId = null;
    this._onProgressChange = null;
    this._onPlayStateChange = null;
    this._onInfo = null;
    this._onLoad = null;
    this._onClose = null;
    this._onMetrics = null;
    this._onTerrainComputed = null;
    this._onFeaturesComputed = null;
    // Fired once a background map-feature download finishes and drapes onto the
    // model, so the UI can re-evaluate layer toggles (圖資 availability).
    this._onFeaturesReady = null;
    // Monotonic id of the current build; background feature loads carry the id
    // they started under and bail if it no longer matches (model was rebuilt).
    this._buildToken = 0;

    this._abortController = null;
    this._aborted = false;
    this._loading = false;

    // --- Route timing / metrics (set in loadRouteData) ---
    this._distances = null;       // cumulative metres, aligned to routePoints
    this._times = null;           // cumulative elapsed hours, aligned to routePoints
    this._fatigue = null;         // per-vertex fatigue fraction 0..1
    this._startMs = null;         // departure timestamp (ms epoch)
    this._totalDistM = 0;
    this._weatherPoints = [];
    this._centerLat = 0;
    this._centerLng = 0;
    this._worldSpan = 2000;       // approx terrain span (world units)

    // --- Environment (day/night + weather) ---
    this._envEnabled = true;
    this._weatherAnimEnabled = true; // rain/snow/sky-tint + volumetric weather rigs
    this._effectsEnabled = true;     // decorative landmark models (peaks/trees/towers/…)
    this._sun = null;
    this._sunTarget = null;
    this._moon = null;
    this._ambient = null;
    this._hemi = null;
    this._rain = null;
    this._snow = null;
    this._currentWeatherCat = 'clear';
    this._lightningT = 0;
    this._lightningTimer = 4 + Math.random() * 6;

    // --- Weather marker badges + real 3D weather phenomena ---
    // Each weather point gets a compact static badge (emoji + temperature, for
    // at-a-glance reading and click-to-inspect). The actual animation is no longer
    // a flat icon: a volumetric 3D weather rig (drifting cloud banks, falling rain
    // shafts, swirling snow, ground fog, a pulsing sun, forked lightning) grows in
    // world space at each point — see WeatherFx3D — gated by the 3-state 天氣
    // toggle (on: animates; noAnim/off: hidden).
    this._weatherIconEntries = [];
    this._weather3d = null;

    // --- Animated hiker ---
    this._person = null;
    this._personPhase = 0;

    this._lastMetricsEmit = 0;
  }

  show() {
    this.container.classList.remove('hidden');
    if (!this._checkWebGL()) {
      throw new Error('WebGL 無法使用，請更新瀏覽器或檢查顯示卡設定');
    }
    try {
      this._initScene();
      // Only start the render loop if one isn't already running, so re-showing
      // an already-open viewer (e.g. the toolbar "更新" rebuild) doesn't spawn a
      // second requestAnimationFrame loop and double the render/playback rate.
      if (this._animFrameId == null) this._animate();
    } catch (err) {
      console.error('TerrainViewer init failed:', err);
    }
  }

  hide() {
    this.container.classList.add('hidden');
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  destroy() {
    this.hide();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.controls = null;
  }

  onClose(cb) {
    this._onClose = cb;
  }

  onProgressChange(cb) {
    this._onProgressChange = cb;
  }

  // cb(playing) — fired when playback starts/stops, including the automatic stop
  // when the hiker reaches the end of the route, so the UI can sync its
  // play/pause button.
  onPlayStateChange(cb) {
    this._onPlayStateChange = cb;
  }

  onInfo(cb) {
    this._onInfo = cb;
  }

  // cb(metrics) — position-driven live readout (date/time, dist, elev, speed,
  // grade, fatigue, weather). Fired on scrub and during playback.
  onMetrics(cb) {
    this._onMetrics = cb;
  }

  // cb({ active, percent, title, detail, aborted, error })
  onLoad(cb) {
    this._onLoad = cb;
  }

  // cb({ grid, bbox }) — fired once after a fresh elevation-grid download so the
  // caller can persist it (per-favourite terrain cache). Not fired on a cache hit.
  onTerrainComputed(cb) {
    this._onTerrainComputed = cb;
  }

  // cb({ features, bbox }) — fired once after a fresh map-feature download so the
  // caller can persist it alongside the terrain cache. Not fired on a cache hit.
  onFeaturesComputed(cb) {
    this._onFeaturesComputed = cb;
  }

  // cb() — fired once a background map-feature download has been draped onto the
  // model, so the UI can re-enable the 圖資 layer toggle now that features exist.
  onFeaturesReady(cb) {
    this._onFeaturesReady = cb;
  }

  isLoading() {
    return this._loading;
  }

  // True once a terrain model has been built and is still resident in the scene
  // (it survives hide()/show()). Lets the caller re-show a cached model on
  // re-entry instead of rebuilding it from scratch.
  hasBuiltScene() {
    return !!(this.scene && this.terrainMesh);
  }

  abort() {
    if (!this._loading) return;
    this._aborted = true;
    if (this._abortController) {
      try { this._abortController.abort(); } catch { /* noop */ }
    }
  }

  // state.blocking === false marks a non-blocking phase (e.g. the background 圖資
  // download): the model stays interactive and isLoading() reads false, even
  // though the same progress channel keeps counting up toward 100.
  _emitLoad(state) {
    this._loading = !!state.active && state.blocking !== false;
    if (this._onLoad) this._onLoad(state);
  }

  getTerrainInfo() {
    return this._terrainInfo;
  }

  setContoursVisible(visible) {
    if (this.contourGroup) this.contourGroup.visible = visible;
  }

  setContourLabelsVisible(visible) {
    this._contourLabelsVisible = !!visible;
    // Labels only show when contours themselves are visible.
    if (this.contourLabelGroup) {
      this.contourLabelGroup.visible = !!visible && this._contourPrecision !== 'none';
    }
  }

  // Record a text sprite + its authored base scale so the global label-size
  // control can rescale/hide it later. Called right after the caller sets the
  // sprite's scale.
  _registerLabel(sprite) {
    if (!sprite || !sprite.scale) return sprite;
    sprite.userData.baseScale = { x: sprite.scale.x, y: sprite.scale.y };
    this._labelSprites.push(sprite);
    this._applyLabelScaleTo(sprite);
    return sprite;
  }

  _applyLabelScaleTo(sprite) {
    const base = sprite.userData.baseScale;
    if (!base) return;
    const f = this._LABEL_FACTORS[this._labelScale] ?? 1;
    if (f <= 0) {
      sprite.visible = false;
    } else {
      sprite.visible = true;
      sprite.scale.set(base.x * f, base.y * f, 1);
    }
  }

  // Global text-label size: 'large' | 'small' | 'none'. Rescales (or hides)
  // every registered text sprite. Group-level toggles (weather/contour labels)
  // still gate their own groups, so a label shows only when both allow it.
  setLabelScale(scale) {
    const s = (scale === 'small' || scale === 'none') ? scale : 'large';
    this._labelScale = s;
    for (const sprite of this._labelSprites) this._applyLabelScaleTo(sprite);
  }

  getLabelScale() {
    return this._labelScale;
  }

  setFeaturesVisible(visible) {
    this._featuresVisible = !!visible;
    if (this.featureGroup) this.featureGroup.visible = this._featuresVisible;
    if (this.featureLabelGroup) this.featureLabelGroup.visible = this._featuresVisible;
    this._applyLandmarkVisibility();
  }

  isFeaturesVisible() {
    return this._featuresVisible;
  }

  hasMapFeatures() {
    return !!(this.featureGroup && this.featureGroup.children.length);
  }

  // True once a point-landmark model (peak/tree/tower/viewpoint/monument) exists,
  // so the 特效 toggle's expanded scope has something to show/hide.
  hasLandmarks() {
    return !!(this.landmarkGroup && this.landmarkGroup.children.length);
  }

  // Landmarks need BOTH layers on: 圖資 gates them as map-derived content, 特效
  // additionally lets the user declutter these decorative models independently
  // of the weather layer/animation.
  _applyLandmarkVisibility() {
    if (this.landmarkGroup) this.landmarkGroup.visible = this._featuresVisible && this._effectsEnabled;
  }

  // Contour precision: 'high' (dense bands) | 'low' (sparse bands) | 'none'.
  // Rebuilds the iso-lines from the cached elevation grid.
  setContourPrecision(precision) {
    const p = (precision === 'low' || precision === 'none') ? precision : 'high';
    // No-op if nothing changed and the matching geometry already exists (avoids
    // rebuilding the just-built contours right after load).
    const alreadyBuilt = p === 'none' ? !this.contourGroup : !!this.contourGroup;
    if (p === this._contourPrecision && alreadyBuilt) return;
    this._contourPrecision = p;
    if (!this.scene || !this._grid || !this._bbox || !this._field) return;
    this._rebuildContours();
  }

  getContourPrecision() {
    return this._contourPrecision;
  }

  _rebuildContours() {
    // Tear down the existing contour geometry/labels, then rebuild for the
    // current precision (unless 'none').
    for (const grp of [this.contourGroup, this.contourLabelGroup]) {
      if (!grp) continue;
      this.scene.remove(grp);
      grp.traverse((child) => {
        // Drop contour-label sprites from the global label registry so the
        // label-size control doesn't keep touching disposed sprites.
        if (child.isSprite) this._labelSprites = this._labelSprites.filter((s) => s !== child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          // Drop the wide-line material from the resolution-tracked list.
          this._lineMaterials = this._lineMaterials.filter((m) => m !== child.material);
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    }
    this.contourGroup = null;
    this.contourLabelGroup = null;
    if (this._contourPrecision === 'none') {
      if (this._onInfo) this._onInfo(this._terrainInfo);
      return;
    }
    this._createContours(this._bbox);
    if (this.contourLabelGroup) this.contourLabelGroup.visible = this._contourLabelsVisible;
    if (this._onInfo) this._onInfo(this._terrainInfo);
  }

  // cb(detail) — fired when a 3D billboard/waypoint marker is clicked.
  onMarkerClick(cb) {
    this._onMarkerClick = cb;
  }

  // Toggles the weather badge/label layer (the 3-state 天氣 button's "hints").
  // Turning hints off also implies no animation (nothing left to animate).
  setWeatherVisible(visible) {
    this._weatherVisible = !!visible;
    if (this.weatherGroup) this.weatherGroup.visible = this._weatherVisible;
    this._applyWeather3DVisibility();
  }

  // The 3D weather phenomena are the weather layer's animation: shown only when
  // BOTH the 天氣 hints are visible AND the animation state is on (the 3-state
  // 天氣 button's middle state keeps hints but drops this).
  _applyWeather3DVisibility() {
    if (this._weather3d) this._weather3d.setVisible(this._weatherVisible && this._weatherAnimEnabled);
  }

  // Day/night + directional sunlight driven by the route time. When off, the
  // scene falls back to a neutral, evenly-lit look.
  setEnvironmentEnabled(enabled) {
    this._envEnabled = !!enabled;
    this._applyEnvironment(this._metricsAtProgress(this._progress));
  }

  // Weather animation: precipitation particles, weather-driven sky/fog tint, and
  // the volumetric 3D weather rigs. Driven by the 3-state 天氣 button (on / no
  // animation / off) — independent of the 特效 (landmark decoration) toggle.
  setWeatherAnimEnabled(enabled) {
    this._weatherAnimEnabled = !!enabled;
    if (this._rain) this._rain.visible = false;
    if (this._snow) this._snow.visible = false;
    this._applyEnvironment(this._metricsAtProgress(this._progress));
    this._applyWeather3DVisibility();
  }

  // 特效: declutters the point-landmark models (peaks/trees/towers/viewpoints/
  // monuments) — they're decoration on top of the base 圖資 layer, not the map
  // data itself, so this can hide them without touching weather or the route.
  setEffectsEnabled(enabled) {
    this._effectsEnabled = !!enabled;
    this._applyLandmarkVisibility();
  }

  isEnvironmentEnabled() {
    return this._envEnabled;
  }

  isWeatherAnimEnabled() {
    return this._weatherAnimEnabled;
  }

  isEffectsEnabled() {
    return this._effectsEnabled;
  }

  // --- Layer availability: lets the UI grey out toggles that can't do anything
  // for this route (no weather points, no precipitation, no major-contour
  // labels), so a no-op toggle doesn't look broken.
  hasWeatherData() {
    return !!(this.weatherGroup && this.weatherLabels.length);
  }

  hasContourLabels() {
    return !!(this.contourLabelGroup && this.contourLabelGroup.children.length);
  }

  // True when any weather point along the route is something the FX layer can
  // actually show (rain/snow/fog/cloud tint) — i.e. not plain clear sky.
  routeHasWeatherFx() {
    return (this._weatherPoints || []).some((p) => {
      const code = p?.weatherCode;
      return code != null && TerrainViewer.weatherCategory(code) !== 'clear';
    });
  }

  play() {
    if (!this.playerPath || this.playerPath.getPoint(0) === undefined) return;
    // Pressing play after the hiker has reached the end restarts from the start
    // instead of sitting stuck at 100%.
    if (this._progress >= 1) {
      this._progress = 0;
      this._updatePlayerPosition();
      if (this._onProgressChange) this._onProgressChange(this._progress);
    }
    this._playing = true;
    if (this._onPlayStateChange) this._onPlayStateChange(true);
  }

  pause() {
    const was = this._playing;
    this._playing = false;
    if (was && this._onPlayStateChange) this._onPlayStateChange(false);
  }

  setSpeed(speed) {
    this._speed = speed;
  }

  setProgress(t) {
    this._progress = Math.max(0, Math.min(1, t));
    this._updatePlayerPosition();
    this._emitMetrics(true);
    if (this._onProgressChange) this._onProgressChange(this._progress);
  }

  getProgress() {
    return this._progress;
  }

  isPlaying() {
    return this._playing;
  }

  getSpeed() {
    return this._speed;
  }

  // Snapshot the camera pose + playback position/speed so a caller can restore
  // them later — e.g. the player's playlist hopping back to a route it left.
  getViewState() {
    if (!this.camera || !this.controls) return null;
    return {
      pos: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      progress: this._progress,
      speed: this._speed,
    };
  }

  // Restore a previously captured view state onto the currently built scene.
  // Camera coordinates are local to the route/bbox they were captured from, so
  // this is only meaningful when re-applied to that same route.
  applyViewState(state) {
    if (!state || !this.camera || !this.controls) return;
    if (Array.isArray(state.pos)) this.camera.position.fromArray(state.pos);
    if (Array.isArray(state.target)) this.controls.target.fromArray(state.target);
    this.controls.update();
    if (Number.isFinite(state.speed)) this._speed = state.speed;
    if (Number.isFinite(state.progress)) this.setProgress(state.progress);
  }

  // Snap the camera to a preset viewing angle with north (+Z) pointing up, while
  // leaving OrbitControls free so the user can still orbit/tilt afterwards.
  //   'top' — straight-down (垂直俯視)
  //   '45'  — 45° oblique (45度視角)
  // The current zoom distance and look-at target are preserved.
  applyViewPreset(mode) {
    if (!this.camera || !this.controls) return;
    const target = this.controls.target.clone();
    const dist = Math.max(this.camera.position.distanceTo(target), this.controls.minDistance + 1);
    // phi = polar angle from +Y. Top-down ≈ 0; oblique = 45° off vertical.
    const phi = mode === 'top' ? 0.0005 : Math.PI / 4;
    // Place the camera due south of the target so looking toward +Z (north) puts
    // north at the top of the screen.
    const theta = Math.PI; // three.js spherical: atan2(x, z)
    const sinPhi = Math.sin(phi);
    const offset = new THREE.Vector3(
      dist * sinPhi * Math.sin(theta),
      dist * Math.cos(phi),
      dist * sinPhi * Math.cos(theta)
    );
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.controls.update();
  }

  // "海拔高度歸一化" — when on, the vertical scale is recomputed so the relief
  // reads boldly 3D for any route; when off, elevations render at true scale.
  // Rebuilds the model geometry in place (no re-download) when a scene exists.
  setElevationNormalized(on) {
    this._elevNormalized = !!on;
    this._recomputeElevScale();
    if (this.hasBuiltScene()) this._rebuildScene();
  }

  isElevationNormalized() {
    return this._elevNormalized;
  }

  // Derive the vertical scale from the current normalization flag, terrain relief
  // and horizontal span. Targets a relief of ~35% of the span so framing always
  // works; clamped so flat-terrain DEM noise isn't blown up absurdly.
  _recomputeElevScale() {
    if (!this._elevNormalized) { this._elevScale = 1; return; }
    const range = Math.max(this._fieldMaxV - this._fieldMinV, 1);
    const targetRelief = (this._worldSpan || 2000) * 0.35;
    this._elevScale = Math.max(0.25, Math.min(targetRelief / range, 6));
  }

  async loadRouteData(routeData) {
    const { coords, elevations, waypoints, weatherPoints, routeStats, timing, routeColors, cachedTerrain } = routeData;
    if (!coords || coords.length < 2) return;

    // Honour the persisted "海拔高度歸一化" preference for the initial build so the
    // first paint uses the right vertical scale (no rebuild needed on open).
    if (typeof routeData.elevNormalized === 'boolean') this._elevNormalized = routeData.elevNormalized;

    // On a toolbar "更新" rebuild (preserveView) keep the user where they were
    // looking instead of snapping back to the default overview, so a refresh
    // feels like an in-place update rather than re-opening the model.
    const preserveView = !!routeData.preserveView && !!this.camera && !!this.controls;
    const prevView = preserveView
      ? { pos: this.camera.position.clone(), target: this.controls.target.clone(), progress: this._progress }
      : null;

    this.routePoints = coords;
    this.routeElevations = elevations || coords.map(() => 0);
    this._weatherPoints = Array.isArray(weatherPoints) ? weatherPoints : [];
    this._routeColors = Array.isArray(routeColors) && routeColors.length === coords.length
      ? routeColors.map((c) => new THREE.Color(c[0], c[1], c[2]))
      : null;
    // Each open starts at high-precision contours with labels on (the UI resets
    // its toggles to match), so the initial build uses the right interval.
    this._contourPrecision = 'high';
    this._contourLabelsVisible = true;

    // Timing track for the position-driven readout + day/night animation.
    this._distances = Array.isArray(timing?.distances) && timing.distances.length === coords.length
      ? timing.distances
      : cumulativeDistances(coords);
    this._totalDistM = this._distances[this._distances.length - 1] || 0;
    this._times = Array.isArray(timing?.times) && timing.times.length === coords.length ? timing.times : null;
    this._fatigue = Array.isArray(timing?.fatigue) && timing.fatigue.length === coords.length ? timing.fatigue : null;
    this._startMs = Number.isFinite(timing?.startMs) ? timing.startMs : Date.now();

    this._aborted = false;
    this._abortController = new AbortController();

    // Reuse a previously downloaded elevation grid (per-favourite cache) when one
    // is supplied and matches the current grid resolution; otherwise download it.
    const cacheHit = cachedTerrain
      && Array.isArray(cachedTerrain.grid)
      && cachedTerrain.grid.length === GRID_SIZE
      && cachedTerrain.bbox;

    let bbox;
    let gridData;
    if (cacheHit) {
      bbox = cachedTerrain.bbox;
      this._centerLat = (bbox.minLat + bbox.maxLat) / 2;
      this._centerLng = (bbox.minLng + bbox.maxLng) / 2;
      gridData = cachedTerrain.grid;
      this._emitLoad({ active: true, percent: 80, title: '建立地形模型', detail: '讀取暫存高程資料…' });
      // The cached rebuild (e.g. a "更新" redraw) is otherwise synchronous, so
      // yield one frame to let the progress bar + interrupt button actually paint
      // and give the user a window to abort before the geometry is regenerated.
      await new Promise((r) => setTimeout(r, 16));
      if (this._aborted) { this._emitLoad({ active: false, percent: 0, aborted: true }); return; }
    } else {
      bbox = this._computeBbox(coords);
      this._centerLat = (bbox.minLat + bbox.maxLat) / 2;
      this._centerLng = (bbox.minLng + bbox.maxLng) / 2;
      this._emitLoad({ active: true, percent: 3, title: '建立地形模型', detail: '下載高程資料中…' });

      try {
        gridData = await this._fetchElevationGrid(bbox, (p) => {
          this._emitLoad({ active: true, percent: 3 + p * 80, title: '建立地形模型', detail: '下載高程資料中…' });
        });
      } catch (err) {
        if (this._aborted) {
          this._emitLoad({ active: false, percent: 0, aborted: true });
          return;
        }
        this._emitLoad({ active: false, percent: 0, error: err });
        return;
      }

      if (this._aborted || gridData == null) {
        this._emitLoad({ active: false, percent: 0, aborted: true });
        return;
      }

      // Hand the freshly downloaded grid back so the caller can cache it.
      if (this._onTerrainComputed) {
        try { this._onTerrainComputed({ grid: gridData, bbox }); } catch { /* noop */ }
      }
    }

    this._grid = gridData;
    this._bbox = bbox;
    // Smoothed, upsampled height field shared by the surface mesh and the
    // contours (sets this._fieldMinV / this._fieldMaxV over valid data only).
    this._field = this._buildFineField(gridData);
    // Datum: anchor at the lowest *valid* ground (holes excluded) so the model
    // never starts from a spurious sea-level 0 m skirt and the empty band
    // beneath the terrain isn't rendered.
    this._elevBase = this._fieldMinV;

    if (!this.scene) {
      this._initScene();
    }

    // Terrain span (world units) — set before markers so they can scale to the
    // model size and stay visible at the default camera distance.
    const cx = (bbox.minLng + bbox.maxLng) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const span = Math.max(
      haversineDistance([bbox.minLat, bbox.minLng], [bbox.minLat, bbox.maxLng]),
      haversineDistance([bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.minLng])
    );
    this._worldSpan = span;
    // Scale markers/hiker to the terrain so they stay visible at the default
    // framing (camera sits ~1.1× the span away).
    this._markerScale = Math.max(1, span / 300);
    // Vertical scale depends on the relief + span, both known now, so the initial
    // geometry is baked at the right scale for the normalization preference.
    this._recomputeElevScale();

    this._emitLoad({ active: true, percent: 88, title: '建立地形模型', detail: '計算等高線與軌跡…' });

    this._clearScene();
    this._createTerrain(bbox);
    this._createContours(bbox);
    this._createRoutePath(coords, elevations, bbox);
    this._createWaypoints(waypoints, bbox);
    this._createWeatherLabels(weatherPoints, bbox);
    this._setupPlayer(coords, elevations, bbox);
    this._setupEnvironment();

    // Map features (roads / rivers / water / land cover / buildings). Cached
    // vector data builds synchronously (instant); a fresh Overpass download is
    // slow and flaky, so it must NOT block the model from appearing — it's fetched
    // in the background after the build completes and draped on once it arrives.
    // Keep the previous build's features (same area) as a fallback so a flaky
    // download doesn't blank the whole 圖資 layer on a redraw.
    const prevFeatures = this._featuresData;
    const prevFeaturesBbox = this._featuresDataBbox;
    const cachedFeatures = cachedTerrain && cachedTerrain.features ? cachedTerrain.features : null;
    if (cachedFeatures) {
      try { this._buildMapFeatures(cachedFeatures, bbox); } catch (err) { console.warn('map features failed:', err); }
      this._featuresData = cachedFeatures;
      this._featuresDataBbox = bbox;
    } else {
      // Features arrive asynchronously; clear any stale ones so a rebuild in the
      // meantime (e.g. the normalization toggle) doesn't drape the old area's data.
      this._featuresData = null;
      this._featuresDataBbox = null;
    }
    this._buildCtx = { coords, elevations, waypoints, weatherPoints, bbox };
    // Token identifying THIS build so a background feature download that resolves
    // after the user rebuilt/closed the model doesn't paint onto a stale scene.
    const buildToken = (this._buildToken = (this._buildToken || 0) + 1);

    if (this._onInfo) this._onInfo(this._terrainInfo);

    // Frame the model larger in the view (closer camera) so the terrain reads
    // bigger and dense 20 m contours aren't crammed together on screen. The
    // default sits noticeably closer than a fit-to-screen distance.
    const dist = Math.max(span * 1.12, 1000);

    // Aim at the terrain's mid-height (datum-shifted) so the model is framed,
    // not the empty space the old y=0 target used to look at.
    const midElev = this._terrainInfo
      ? (this._terrainInfo.elevMin + this._terrainInfo.elevMax) / 2
      : this._elevBase;
    const center = this._latLngToLocal(cy, cx, midElev, bbox);
    if (prevView) {
      // Refresh: restore the prior camera pose and playback position.
      this.controls.target.copy(prevView.target);
      this.camera.position.copy(prevView.pos);
      this._progress = Math.max(0, Math.min(1, prevView.progress));
    } else {
      this.controls.target.set(center.x, center.y, center.z);
      this.camera.position.set(center.x + dist * 0.3, center.y + dist * 0.4, center.z + dist);
    }
    this.controls.update();

    this._setupResizeHandler();
    this._updateLineResolutions();
    // Place the hiker/cursor at the current progress so a freshly built (or
    // refreshed) model shows them on the track right away, not parked at origin.
    this._updatePlayerPosition();
    this._emitMetrics(true);

    // Kick off the background map-feature download (only when the cache didn't
    // already supply it) before closing out the load state, so the same progress
    // channel keeps counting up through the 圖資 phase instead of hiding and a
    // separate widget reopening at 0%. blocking: false keeps the model
    // interactive throughout — only the readout is shared, not the busy-lock.
    if (!cachedFeatures && !this._aborted) {
      this._emitLoad({ active: true, percent: 90, blocking: false, title: '建立地形模型', detail: '更新圖資中…' });
      this._loadMapFeaturesInBackground(bbox, buildToken, prevFeatures, prevFeaturesBbox);
    } else {
      this._emitLoad({ active: false, percent: 100 });
    }
  }

  // Download map features off the critical path and drape them onto the already
  // visible model. Guarded by the build token so a download that resolves after
  // the user rebuilt/closed the model is discarded instead of painting a stale
  // scene. A failed download reuses the previous build's features (same area).
  // Progress (90→100, blocking: false) rides the same onLoad channel as the
  // terrain build so the UI shows one continuous bar rather than a second one.
  async _loadMapFeaturesInBackground(bbox, token, prevFeatures, prevFeaturesBbox) {
    let featuresData = null;
    try {
      featuresData = await this._fetchMapFeatures(bbox, (p) => {
        this._emitLoad({ active: true, percent: 90 + p * 10, blocking: false, detail: '更新圖資中…' });
      });
    } catch { featuresData = null; }
    if (this._aborted || token !== this._buildToken || !this.scene) {
      this._emitLoad({ active: false, percent: 100 });
      return;
    }
    if (!featuresData && prevFeatures && this._bboxApproxEqual(bbox, prevFeaturesBbox)) {
      featuresData = prevFeatures;
    }
    if (!featuresData) {
      this._emitLoad({ active: false, percent: 100 });
      return;
    }
    if (featuresData !== prevFeatures && this._onFeaturesComputed) {
      try { this._onFeaturesComputed({ features: featuresData, bbox }); } catch { /* noop */ }
    }
    try { this._buildMapFeatures(featuresData, bbox); } catch (err) {
      console.warn('map features failed:', err);
      this._emitLoad({ active: false, percent: 100 });
      return;
    }
    this._featuresData = featuresData;
    this._featuresDataBbox = bbox;
    // Apply the persisted label size + layer visibility to the freshly added
    // feature objects, then let the UI re-evaluate toggles now that 圖資 exists.
    this.setLabelScale(this._labelScale);
    if (this.featureGroup) this.featureGroup.visible = this._featuresVisible;
    if (this.featureLabelGroup) this.featureLabelGroup.visible = this._featuresVisible;
    this._applyLandmarkVisibility();
    this._updateLineResolutions();
    this._emitLoad({ active: false, percent: 100 });
    if (this._onFeaturesReady) {
      try { this._onFeaturesReady(); } catch { /* noop */ }
    }
  }

  _checkWebGL() {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
    } catch { return false; }
  }

  // True once a terrain height field exists, so the 3D-print export (STL / 3MF)
  // has something to build a solid from.
  hasExportableModel() {
    return !!(this._field && this._bbox);
  }

  // Build a compact, print-oriented description of the current model for the
  // STL / 3MF exporter (Plan §IV). Coordinates are millimetres in a Z-up frame
  // (X east, Y north, Z up) scaled so the horizontal span == sizeMm; the on-screen
  // vertical scale (incl. 海拔歸一化) is preserved so the print matches the view.
  // Terrain holes are filled flat (min elevation) so the exported solid stays
  // watertight, and a per-grid land-cover family drives 3MF colour blocking (§IV-3).
  getExportSource({ sizeMm = 150, baseThicknessMm = 4 } = {}) {
    if (!this._field || !this._bbox) return null;
    const N = FIELD_SIZE;
    const bbox = this._bbox;
    const field = this._field;
    const minElev = this._fieldMinV;
    const span = Math.max(1, this._worldSpan || 2000);
    const k = sizeMm / span;

    const X = new Float32Array(N * N);
    const Y = new Float32Array(N * N);
    const Z = new Float32Array(N * N);
    let minZ = Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (N - 1);
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1);
        const raw = field[i][j];
        const elev = this._isHole(raw) ? minElev : raw;    // holes filled flat for a manifold solid
        const p = this._latLngToLocal(lat, lng, elev, bbox);
        const idx = i * N + j;
        X[idx] = p.x * k; Y[idx] = p.z * k; Z[idx] = p.y * k;
        if (Z[idx] < minZ) minZ = Z[idx];
      }
    }

    // Per-grid land-cover family for colour blocking: land / green / soil / urban,
    // plus a water overlay (water is excluded from the terrain-colour field, so it
    // is rasterised separately here).
    const areas = (this._featuresData && this._featuresData.areas) || [];
    const buildings = (this._featuresData && this._featuresData.buildings) || [];
    const famGrid = this._buildLandCoverField(areas, buildings, bbox);
    const FAM = { land: 0, green: 1, soil: 2, urban: 3, water: 4 };
    const family = new Uint8Array(N * N);
    const latSpan = (bbox.maxLat - bbox.minLat) || 1;
    const lngSpan = (bbox.maxLng - bbox.minLng) || 1;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const f = famGrid[i][j];
        family[i * N + j] = f === 'green' ? FAM.green : f === 'soil' ? FAM.soil : f === 'urban' ? FAM.urban : FAM.land;
      }
    }
    for (const ar of areas) {
      if (ar.cls !== 'water' && ar.cls !== 'wetland') continue;
      const rings = ar.rings || [];
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const holes = rings.slice(1).filter((h) => h && h.length >= 3);
      let rminLat = Infinity, rmaxLat = -Infinity, rminLng = Infinity, rmaxLng = -Infinity;
      for (const [la, lo] of outer) { if (la < rminLat) rminLat = la; if (la > rmaxLat) rmaxLat = la; if (lo < rminLng) rminLng = lo; if (lo > rmaxLng) rmaxLng = lo; }
      const i0 = Math.max(0, Math.floor((rminLat - bbox.minLat) / latSpan * (N - 1)));
      const i1 = Math.min(N - 1, Math.ceil((rmaxLat - bbox.minLat) / latSpan * (N - 1)));
      const j0 = Math.max(0, Math.floor((rminLng - bbox.minLng) / lngSpan * (N - 1)));
      const j1 = Math.min(N - 1, Math.ceil((rmaxLng - bbox.minLng) / lngSpan * (N - 1)));
      for (let i = i0; i <= i1; i++) {
        const lat = bbox.minLat + latSpan * i / (N - 1);
        for (let j = j0; j <= j1; j++) {
          const lng = bbox.minLng + lngSpan * j / (N - 1);
          if (!this._pointInRing(lat, lng, outer)) continue;
          if (holes.some((h) => this._pointInRing(lat, lng, h))) continue;
          family[i * N + j] = FAM.water;
        }
      }
    }

    return {
      N, X, Y, Z, family,
      route: this._exportRouteSamples(bbox, k),
      baseZ: minZ - Math.max(0.5, baseThicknessMm),
      sizeMm,
    };
  }

  // Route polyline draped onto the terrain SURFACE (not the GPS elevation) in
  // print millimetres, densified so the exported ridge (Plan §IV-1) hugs the
  // printed relief smoothly.
  _exportRouteSamples(bbox, k) {
    const coords = this.routePoints;
    if (!coords || coords.length < 2) return [];
    const dLatCell = (bbox.maxLat - bbox.minLat) / (FIELD_SIZE - 1);
    const dLngCell = (bbox.maxLng - bbox.minLng) / (FIELD_SIZE - 1);
    const out = [];
    const drape = (lat, lng) => {
      const elev = this._sampleGridElevation(lat, lng);
      const p = this._latLngToLocal(lat, lng, elev, bbox);
      return [p.x * k, p.z * k, p.y * k];
    };
    for (let i = 0; i < coords.length - 1; i++) {
      const [la, lo] = coords[i];
      const [lb, lob] = coords[i + 1];
      const steps = Math.min(20, Math.max(1, Math.ceil(Math.max(Math.abs(lb - la) / dLatCell, Math.abs(lob - lo) / dLngCell))));
      for (let s = 0; s < steps; s++) { const t = s / steps; out.push(drape(la + (lb - la) * t, lo + (lob - lo) * t)); }
    }
    const last = coords[coords.length - 1];
    out.push(drape(last[0], last[1]));
    return out;
  }

  _initScene() {
    if (this.renderer) return;

    let w = this.container.clientWidth;
    let h = this.container.clientHeight;
    if (w < 1 || h < 1) {
      w = this.container.parentElement?.clientWidth || window.innerWidth;
      h = this.container.parentElement?.clientHeight || window.innerHeight;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200000;

    this._bindPointerHandlers();
    this._bindContextLossHandlers();
  }

  // Mobile browsers drop the WebGL context when the tab is backgrounded for a
  // while; without handling, the next frame throws and can take the page down.
  // Swallow the loss (so the browser keeps the page and attempts a restore),
  // pause the loop, then resume + rebuild the geometry once the context returns.
  _bindContextLossHandlers() {
    if (this._contextHandlersBound || !this.renderer) return;
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._contextLost = true;
      if (this._animFrameId) {
        cancelAnimationFrame(this._animFrameId);
        this._animFrameId = null;
      }
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      this._contextLost = false;
      // Re-upload GPU resources by rebuilding from the cached source data, then
      // resume the render loop if the viewer is still open.
      try { if (this._buildCtx) this._rebuildScene(); } catch (err) { console.warn('context restore rebuild failed:', err); }
      if (!this.container.classList.contains('hidden') && this._animFrameId == null) this._animate();
    }, false);
    this._contextHandlersBound = true;
  }

  // Click-to-inspect: distinguishes a click from an orbit drag, then raycasts
  // against the billboard/waypoint markers and reports the hit's detail.
  _bindPointerHandlers() {
    if (this._pointerHandlersBound || !this.renderer) return;
    const el = this.renderer.domElement;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    el.addEventListener('pointerdown', (e) => {
      this._pointerDownInfo = { x: e.clientX, y: e.clientY, t: now() };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this._pointerDownInfo;
      this._pointerDownInfo = null;
      if (!d) return;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (moved > 6 || (now() - d.t) > 600) return; // drag / long-press → orbit, not a pick
      this._handlePick(e);
    });
    this._pointerHandlersBound = true;
  }

  _handlePick(e) {
    if (!this.camera || !this.renderer || !this._onMarkerClick || !this._pickables.length) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (!this._raycaster) this._raycaster = new THREE.Raycaster();
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObjects(this._pickables, false);
    for (const h of hits) {
      const detail = h.object?.userData?.detail;
      if (detail) { this._onMarkerClick(detail); return; }
    }
  }

  // ---------- Environment: day/night lighting + weather ----------

  _setupEnvironment() {
    this._ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this._ambient);

    this._hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a2a1a, 0.4);
    this.scene.add(this._hemi);

    this._sun = new THREE.DirectionalLight(0xffeedd, 1.2);
    this._sun.castShadow = true;
    const d = 50000;
    this._sun.shadow.camera.left = -d;
    this._sun.shadow.camera.right = d;
    this._sun.shadow.camera.top = d;
    this._sun.shadow.camera.bottom = -d;
    this._sun.shadow.camera.far = 400000;
    this._sun.shadow.mapSize.width = 1024;
    this._sun.shadow.mapSize.height = 1024;
    this._sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this._sun);

    this._sunTarget = new THREE.Object3D();
    this.scene.add(this._sunTarget);
    this._sun.target = this._sunTarget;

    // A soft cool fill that doubles as moonlight at night.
    this._moon = new THREE.DirectionalLight(0xaaccff, 0.0);
    this.scene.add(this._moon);

    this._createPrecipitation();
    this._applyEnvironment(this._metricsAtProgress(this._progress));
  }

  // Approximate solar position for a date + location. Precision is well beyond
  // what a visual day/night cycle needs; the model uses a declination from the
  // day-of-year and an hour-angle from local clock time (longitude-corrected to
  // the Asia/Taipei UTC+8 standard meridian used by the weather data).
  _sunPosition(dateMs, lat, lng) {
    const date = new Date(dateMs);
    const toRad = Math.PI / 180;
    const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
    const decl = 23.44 * Math.sin(toRad * (360 / 365) * (dayOfYear - 81));
    const localHour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    // 4 min per degree from the 120°E standard meridian (UTC+8).
    const solarTime = localHour + (lng - 120) * 4 / 60;
    const H = 15 * (solarTime - 12); // hour angle, degrees

    const latR = lat * toRad;
    const declR = decl * toRad;
    const Hr = H * toRad;
    const sinEl = Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(Hr);
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl))); // radians

    let cosAz = (Math.sin(declR) - Math.sin(el) * Math.sin(latR)) / (Math.cos(el) * Math.cos(latR) || 1e-6);
    cosAz = Math.max(-1, Math.min(1, cosAz));
    let az = Math.acos(cosAz); // from north, 0..π
    if (Hr > 0) az = 2 * Math.PI - az; // afternoon → west

    // World frame: +x east, +y up, +z north.
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az)
    );
    return { elevationDeg: el / toRad, azimuthDeg: az / toRad, dir };
  }

  // Colour/intensity presets keyed on sun elevation. Lerps between night,
  // twilight, golden-hour and day so the transition is smooth during playback.
  _skyPreset(elevDeg) {
    const stops = [
      { e: -90, sky: 0x05060f, sun: 0x14213a, sunI: 0.0, amb: 0x1a2138, ambI: 0.32, hemiS: 0x10182e, hemiG: 0x05070c, hemiI: 0.28, moonI: 0.55 },
      { e: -6,  sky: 0x16213d, sun: 0x3a4a78, sunI: 0.10, amb: 0x29314f, ambI: 0.40, hemiS: 0x35406a, hemiG: 0x161a26, hemiI: 0.42, moonI: 0.30 },
      { e: 0,   sky: 0x5a4a6a, sun: 0xff8a4a, sunI: 0.55, amb: 0x4a4660, ambI: 0.48, hemiS: 0x7a6a8a, hemiG: 0x2a221c, hemiI: 0.5, moonI: 0.05 },
      { e: 6,   sky: 0x8fb0d8, sun: 0xffcaa0, sunI: 1.05, amb: 0x9aa6c0, ambI: 0.55, hemiS: 0x9fc0e8, hemiG: 0x3a2e22, hemiI: 0.55, moonI: 0.0 },
      { e: 35,  sky: 0x7fb4ec, sun: 0xfff3e0, sunI: 1.35, amb: 0xc7d4e8, ambI: 0.6, hemiS: 0x87ceeb, hemiG: 0x3a2a1a, hemiI: 0.6, moonI: 0.0 },
      { e: 90,  sky: 0x6fa8e8, sun: 0xffffff, sunI: 1.45, amb: 0xd6e2f2, ambI: 0.62, hemiS: 0x9bd0f5, hemiG: 0x3a2a1a, hemiI: 0.62, moonI: 0.0 },
    ];
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (elevDeg >= stops[i].e && elevDeg <= stops[i + 1].e) { lo = stops[i]; hi = stops[i + 1]; break; }
    }
    if (elevDeg <= stops[0].e) { lo = hi = stops[0]; }
    if (elevDeg >= stops[stops.length - 1].e) { lo = hi = stops[stops.length - 1]; }
    const span = (hi.e - lo.e) || 1;
    const f = Math.max(0, Math.min(1, (elevDeg - lo.e) / span));
    const mix = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), f);
    const num = (a, b) => a + (b - a) * f;
    return {
      sky: mix(lo.sky, hi.sky),
      sun: mix(lo.sun, hi.sun),
      sunI: num(lo.sunI, hi.sunI),
      amb: mix(lo.amb, hi.amb),
      ambI: num(lo.ambI, hi.ambI),
      hemiS: mix(lo.hemiS, hi.hemiS),
      hemiG: mix(lo.hemiG, hi.hemiG),
      hemiI: num(lo.hemiI, hi.hemiI),
      moonI: num(lo.moonI, hi.moonI),
    };
  }

  _applyEnvironment(metrics) {
    if (!this._sun || !this.scene) return;
    const span = this._worldSpan || 2000;
    const sunDist = Math.max(span * 4, 40000);

    if (!this._envEnabled) {
      // Fixed bright-daytime look, independent of the route clock: same sky
      // colour, sun colour/intensity, fill light and shadows as a high sun, so
      // turning the day/night cycle off lights the scene like daytime instead of
      // the old dim, shadowless neutral fallback.
      const preset = this._skyPreset(55); // high midday sun
      const target = this.controls?.target || new THREE.Vector3();
      // Sun high overhead but tilted toward the south-east so the relief still
      // casts legible shadows (a dead-overhead sun flattens them out).
      const dir = new THREE.Vector3(0.32, 0.9, 0.28).normalize();
      this.scene.background = preset.sky.clone();
      this.scene.fog = null;
      if (this._sunTarget) this._sunTarget.position.copy(target);
      this._sun.position.copy(target).add(dir.multiplyScalar(sunDist));
      this._sun.color.copy(preset.sun);
      this._sun.intensity = preset.sunI;
      this._sun.castShadow = true;
      this._ambient.color.copy(preset.amb); this._ambient.intensity = preset.ambI;
      this._hemi.color.copy(preset.hemiS);
      this._hemi.groundColor.copy(preset.hemiG);
      this._hemi.intensity = preset.hemiI;
      if (this._moon) this._moon.intensity = 0.0;
      if (this._rain) this._rain.visible = false;
      if (this._snow) this._snow.visible = false;
      this._currentWeatherCat = 'clear';
      return;
    }

    const dateMs = metrics?.dateMs ?? this._startMs ?? Date.now();
    const lat = metrics?.lat ?? this._centerLat;
    const lng = metrics?.lng ?? this._centerLng;
    const sun = this._sunPosition(dateMs, lat, lng);
    const preset = this._skyPreset(sun.elevationDeg);

    // Weather dims/colours the sky and softens shadows.
    const cat = (this._weatherAnimEnabled && metrics?.weather?.cat) ? metrics.weather.cat : 'clear';
    this._currentWeatherCat = cat;
    const wx = this._weatherModifier(cat);

    const target = this.controls?.target || new THREE.Vector3();
    if (this._sunTarget) this._sunTarget.position.copy(target);
    this._sun.position.copy(target).add(sun.dir.clone().multiplyScalar(sunDist));
    this._sun.color.copy(preset.sun);
    this._sun.intensity = Math.max(0, preset.sunI * wx.sun);
    this._sun.castShadow = sun.elevationDeg > 1 && wx.shadow;

    this._ambient.color.copy(preset.amb);
    this._ambient.intensity = preset.ambI * wx.amb;
    this._hemi.color.copy(preset.hemiS);
    this._hemi.groundColor.copy(preset.hemiG);
    this._hemi.intensity = preset.hemiI * wx.amb;
    if (this._moon) {
      this._moon.intensity = preset.moonI;
      this._moon.position.copy(target).add(new THREE.Vector3(-sun.dir.x, Math.max(0.4, -sun.dir.y), -sun.dir.z).multiplyScalar(sunDist));
    }

    const sky = preset.sky.clone().lerp(new THREE.Color(wx.tint), wx.tintAmt);
    this.scene.background = sky;

    if (wx.fog > 0) {
      const near = span * (1.0 - wx.fog * 0.7);
      const far = span * (3.5 - wx.fog * 2.2);
      this.scene.fog = new THREE.Fog(sky.clone().lerp(new THREE.Color(0xffffff), 0.05), Math.max(10, near), Math.max(near + 50, far));
    } else {
      this.scene.fog = null;
    }

    // Toggle the right precipitation system.
    const wantRain = this._weatherAnimEnabled && (cat === 'rain' || cat === 'drizzle' || cat === 'thunder');
    const wantSnow = this._weatherAnimEnabled && cat === 'snow';
    if (this._rain) {
      this._rain.visible = wantRain;
      this._rain.material.opacity = cat === 'thunder' ? 0.5 : (cat === 'drizzle' ? 0.28 : 0.42);
    }
    if (this._snow) this._snow.visible = wantSnow;
  }

  // Per-category multipliers: how much weather dims light, tints the sky and
  // adds fog. Kept gentle so the terrain and track stay readable.
  _weatherModifier(cat) {
    switch (cat) {
      case 'cloudy':  return { sun: 0.7, amb: 1.05, shadow: true,  fog: 0.12, tint: 0xb8c2d0, tintAmt: 0.18 };
      case 'fog':     return { sun: 0.45, amb: 1.1, shadow: false, fog: 0.6,  tint: 0xc8d0da, tintAmt: 0.4 };
      case 'drizzle': return { sun: 0.55, amb: 1.05, shadow: false, fog: 0.3, tint: 0x9aa6b4, tintAmt: 0.3 };
      case 'rain':    return { sun: 0.4, amb: 1.0, shadow: false, fog: 0.4,  tint: 0x7e8a99, tintAmt: 0.4 };
      case 'snow':    return { sun: 0.6, amb: 1.15, shadow: false, fog: 0.35, tint: 0xd8e2ee, tintAmt: 0.35 };
      case 'thunder': return { sun: 0.3, amb: 0.95, shadow: false, fog: 0.45, tint: 0x5e6a7c, tintAmt: 0.5 };
      default:        return { sun: 1.0, amb: 1.0, shadow: true,  fog: 0.0,  tint: 0xffffff, tintAmt: 0.0 };
    }
  }

  // WMO weather code → coarse visual category used by the FX + sky tint.
  static weatherCategory(code) {
    const c = Number(code);
    if (!Number.isFinite(c) || c < 0) return 'clear';
    if (c === 0 || c === 1) return 'clear';
    if (c === 2) return 'cloudy';
    if (c === 3) return 'cloudy';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95) return 'thunder';
    return 'cloudy';
  }

  // WMO weather code → emoji (matches weatherService's WMO_CODES table).
  static weatherIcon(code) {
    const c = Number(code);
    const map = {
      0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
      51: '🌦️', 53: '🌦️', 55: '🌧️', 56: '🌧️', 57: '🌧️',
      61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
      71: '🌨️', 73: '🌨️', 75: '❄️', 77: '❄️',
      80: '🌦️', 81: '🌧️', 82: '⛈️', 85: '🌨️', 86: '❄️',
      95: '⛈️', 96: '⛈️', 99: '⛈️',
    };
    if (map[c]) return map[c];
    return ({
      clear: '☀️', cloudy: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', thunder: '⛈️',
    })[TerrainViewer.weatherCategory(c)] || '☀️';
  }

  _createPrecipitation() {
    // Particles live in a unit box [-0.5, 0.5]^3; the Points object is scaled
    // and positioned each frame to sit in front of the camera.
    const makePoints = (count, color, size, opacity) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = Math.random() - 0.5;
        pos[i * 3 + 1] = Math.random() - 0.5;
        pos[i * 3 + 2] = Math.random() - 0.5;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color,
        size,
        transparent: true,
        opacity,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      pts.renderOrder = 5;
      return pts;
    };

    this._rain = makePoints(700, 0xafd0ff, 2.6, 0.42);
    this._snow = makePoints(500, 0xffffff, 5.0, 0.8);
    this.scene.add(this._rain);
    this.scene.add(this._snow);
  }

  _updateWeatherParticles(dt) {
    const active = this._weatherAnimEnabled
      ? (this._currentWeatherCat === 'snow' ? this._snow
        : (['rain', 'drizzle', 'thunder'].includes(this._currentWeatherCat) ? this._rain : null))
      : null;
    if (this._rain) this._rain.visible = active === this._rain;
    if (this._snow) this._snow.visible = active === this._snow;
    if (!active || !this.camera) return;

    // Box centred in front of the camera, sized by the view distance so the
    // weather fills the frame without depending on the player position.
    const target = this.controls?.target || new THREE.Vector3();
    const viewDist = this.camera.position.distanceTo(target);
    const boxSize = Math.max(600, Math.min(viewDist * 1.3, this._worldSpan * 3 || 6000));
    const center = this.camera.position.clone().lerp(target, 0.55);
    active.position.copy(center);
    active.scale.setScalar(boxSize);

    const isSnow = active === this._snow;
    const fall = (isSnow ? 0.12 : 0.9) * dt; // fraction of the box per second
    const arr = active.geometry.getAttribute('position');
    const sway = isSnow ? 0.04 : 0.0;
    this._fxTime = (this._fxTime || 0) + dt;
    for (let i = 0; i < arr.count; i++) {
      let y = arr.getY(i) - fall;
      if (y < -0.5) y += 1;
      arr.setY(i, y);
      if (sway) {
        let x = arr.getX(i) + Math.sin((this._fxTime + i) * 1.5) * sway * dt;
        if (x > 0.5) x -= 1; else if (x < -0.5) x += 1;
        arr.setX(i, x);
      }
    }
    arr.needsUpdate = true;

    // Occasional lightning flash during thunderstorms.
    if (this._currentWeatherCat === 'thunder' && this._envEnabled) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningT = 1;
        this._lightningTimer = 4 + Math.random() * 7;
      }
      if (this._lightningT > 0) {
        this._lightningT = Math.max(0, this._lightningT - dt * 4);
        if (this._ambient) this._ambient.intensity = 0.95 + this._lightningT * 1.8;
      }
    }
  }

  _computeBbox(coords) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lat, lng] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const padLat = (maxLat - minLat) * 0.3 + 0.01;
    const padLng = (maxLng - minLng) * 0.3 + 0.01;
    minLat -= padLat; maxLat += padLat;
    minLng -= padLng; maxLng += padLng;

    // Expand the shorter side so the downloaded area is a square in real-world
    // distance — the rendered terrain (x = E-W metres, z = N-S metres) then comes
    // out square rather than a thin sliver for a mostly-straight route. Longitude
    // degrees are foreshortened by cos(lat), so compare distances, not raw spans.
    const cLat = (minLat + maxLat) / 2;
    const cLng = (minLng + maxLng) / 2;
    const cosLat = Math.cos(cLat * Math.PI / 180) || 1e-6;
    const nsDist = maxLat - minLat;                 // ∝ N-S distance
    const ewDist = (maxLng - minLng) * cosLat;      // ∝ E-W distance
    if (nsDist > ewDist) {
      const half = (nsDist / cosLat) / 2;           // widen longitude
      minLng = cLng - half; maxLng = cLng + half;
    } else if (ewDist > nsDist) {
      const half = ewDist / 2;                       // grow latitude
      minLat = cLat - half; maxLat = cLat + half;
    }
    return { minLat, maxLat, minLng, maxLng };
  }

  // True when two bboxes describe essentially the same area (sub-metre tolerance
  // in degrees), used to decide whether cached/in-memory map features still apply.
  _bboxApproxEqual(a, b) {
    if (!a || !b) return false;
    const e = 1e-5; // ~1 m
    return Math.abs(a.minLat - b.minLat) < e && Math.abs(a.maxLat - b.maxLat) < e
      && Math.abs(a.minLng - b.minLng) < e && Math.abs(a.maxLng - b.maxLng) < e;
  }

  _latLngToLocal(lat, lng, elev, bbox) {
    const cx = (bbox.minLng + bbox.maxLng) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const R = 6371000;
    const toRad = Math.PI / 180;
    const x = R * toRad * (lng - cx) * Math.cos(toRad * cy);
    const y = (elev - (this._elevBase || 0)) * (this._elevScale || 1);
    const z = R * toRad * (lat - cy);
    return { x, y, z };
  }

  // Interpolated terrain elevation (metres) at a lat/lng on the rendered surface,
  // so points can be dropped onto it. Samples the same fine field as the mesh;
  // falls back to the datum height over a hole.
  _sampleGridElevation(lat, lng) {
    const field = this._field;
    const bbox = this._bbox;
    if (!field || !bbox) return this._elevBase || 0;
    const gx = (lng - bbox.minLng) / (bbox.maxLng - bbox.minLng) * (FIELD_SIZE - 1);
    const gy = (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat) * (FIELD_SIZE - 1);
    const v = this._sampleSmooth(field, gy, gx, FIELD_SIZE);
    return this._isHole(v) ? (this._elevBase || 0) : v;
  }

  // True when a lat/lng falls over a terrain "hole" (missing elevation data),
  // i.e. where the surface mesh skips its tile and nothing is drawn. Map
  // features must skip the same spots, otherwise they drape onto the basin-floor
  // datum and float/stretch in the blank space beyond the visible terrain.
  _isOverHole(lat, lng) {
    const field = this._field;
    const bbox = this._bbox;
    if (!field || !bbox) return false;
    const gx = (lng - bbox.minLng) / (bbox.maxLng - bbox.minLng) * (FIELD_SIZE - 1);
    const gy = (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat) * (FIELD_SIZE - 1);
    return this._isHole(this._sampleSmooth(field, gy, gx, FIELD_SIZE));
  }

  // Split a polyline ([lat,lng][]) into runs of consecutive points that sit on
  // real (non-hole) terrain, so a road/river/outline isn't drawn across a blank
  // tile. Runs shorter than 2 points are dropped by the caller.
  _splitPolylineAtHoles(pts) {
    const runs = [];
    let cur = [];
    for (const p of pts) {
      if (this._isOverHole(p[0], p[1])) {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
      } else {
        cur.push(p);
      }
    }
    if (cur.length >= 2) runs.push(cur);
    return runs;
  }

  // fetch with a per-request timeout that also honours the shared abort signal.
  async _fetchWithTimeout(url, parentSignal, ms) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (parentSignal) {
      if (parentSignal.aborted) ctrl.abort();
      else parentSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  }

  async _fetchElevationGrid(bbox, onProgress) {
    const lats = [];
    const lngs = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (GRID_SIZE - 1);
      for (let j = 0; j < GRID_SIZE; j++) {
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (GRID_SIZE - 1);
        lats.push(lat);
        lngs.push(lng);
      }
    }

    const signal = this._abortController?.signal;
    const elevations = [];
    const total = lats.length;
    const batchSize = 100;
    const batchCount = Math.ceil(total / batchSize);
    let batchIdx = 0;

    for (let start = 0; start < total; start += batchSize) {
      if (this._aborted) return null;
      const end = Math.min(start + batchSize, total);
      const batchLats = lats.slice(start, end);
      const batchLngs = lngs.slice(start, end);
      const latsStr = batchLats.map(v => v.toFixed(4)).join(',');
      const lngsStr = batchLngs.map(v => v.toFixed(4)).join(',');
      const url = `${ELEVATION_API}?latitude=${latsStr}&longitude=${lngsStr}`;

      let success = false;
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        if (this._aborted) return null;
        try {
          const resp = await this._fetchWithTimeout(url, signal, 15000);
          if (resp.ok) {
            const data = await resp.json();
            if (data.elevation) elevations.push(...data.elevation);
            else elevations.push(...batchLats.map(() => null));
            success = true;
          } else if (resp.status === 429) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
          } else {
            // Missing data → null (a hole), not a flat sea-level 0 m patch.
            elevations.push(...batchLats.map(() => null));
            success = true;
          }
        } catch {
          if (this._aborted) return null;
          if (attempt >= 2) {
            elevations.push(...batchLats.map(() => null));
            success = true;
          } else {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
      if (!success) elevations.push(...batchLats.map(() => null));

      batchIdx++;
      onProgress?.(batchIdx / batchCount);
    }

    const grid = [];
    let idx = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      const row = [];
      for (let j = 0; j < GRID_SIZE; j++) {
        const v = elevations[idx++];
        row.push(Number.isFinite(v) ? v : null); // null = hole (missing data)
      }
      grid.push(row);
    }
    return grid;
  }

  // Sample a colour ramp whose stops are in ABSOLUTE units (metres of elevation).
  // Clamps to the end stops.
  static _rampSampleAbs(stops, x) {
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (x <= first.t) return first.c.slice();
    if (x >= last.t) return last.c.slice();
    let lo = first, hi = last;
    for (let i = 0; i < stops.length - 1; i++) {
      if (x >= stops[i].t && x <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break; }
    }
    const span = (hi.t - lo.t) || 1;
    const f = (x - lo.t) / span;
    return [lo.c[0] + (hi.c[0] - lo.c[0]) * f,
            lo.c[1] + (hi.c[1] - lo.c[1]) * f,
            lo.c[2] + (hi.c[2] - lo.c[2]) * f];
  }

  // Vegetation (綠地) tint keyed on ABSOLUTE elevation (metres). Lowland and
  // montane forest stay green well up the slopes; only beyond the (Taiwan)
  // treeline does it fade to alpine grass, bare rock and finally a snow cap.
  // Using true altitude — not the relief-normalised height the previous ramp
  // used — keeps a low summit green instead of painting every local peak grey.
  static _vegRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.29, 0.47, 0.24] }, // coastal / lowland green
      { t: 700,  c: [0.23, 0.43, 0.20] }, // lush forest
      { t: 1600, c: [0.30, 0.46, 0.25] }, // montane forest
      { t: 2600, c: [0.43, 0.51, 0.32] }, // subalpine scrub (olive)
      { t: 3200, c: [0.64, 0.62, 0.46] }, // treeline grass / tan
      { t: 3500, c: [0.68, 0.66, 0.61] }, // bare alpine rock
      { t: 3850, c: [0.94, 0.95, 0.97] }, // snow cap
    ], elevM);
  }

  // Bare-ground (裸露地) tint: earthy brown → tan → pale rock with altitude.
  static _soilRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.55, 0.45, 0.27] }, // earthy brown
      { t: 1000, c: [0.63, 0.53, 0.35] }, // loam
      { t: 2500, c: [0.73, 0.66, 0.51] }, // sandy
      { t: 3400, c: [0.80, 0.77, 0.70] }, // pale rock
      { t: 3800, c: [0.93, 0.93, 0.92] }, // light peak
    ], elevM);
  }

  // Built-up (市區) tint: slate grey, lightening slightly with altitude.
  static _urbanRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.45, 0.46, 0.49] }, // slate grey
      { t: 1500, c: [0.55, 0.56, 0.59] }, // mid grey
      { t: 3000, c: [0.66, 0.67, 0.70] }, // light grey
      { t: 3800, c: [0.86, 0.87, 0.90] }, // near-white
    ], elevM);
  }

  // Final per-vertex terrain colour from land-cover family + ABSOLUTE elevation +
  // slope:
  //   green (default) → 山林色系 (forest / grassland / parks)
  //   soil            → 土黃色系 (bare ground / farmland / quarry / brownfield)
  //   urban           → 灰色系   (built-up / residential / commercial blocks)
  // Green/default vegetation greens the low-and-mid ground and only turns to
  // rock/snow on genuinely high or steep terrain; soil stays earthy; urban stays
  // grey. Steep ground exposes bare rock (vegetation can't cling to cliffs), so
  // ridges and peaks pick up natural rocky highlights while valleys and gentle
  // slopes read green — instead of the old scheme that greyed every summit.
  static _terrainColorFor(family, elevM, slope) {
    if (family === 'urban') return TerrainViewer._urbanRampColor(elevM);
    if (family === 'soil')  return TerrainViewer._soilRampColor(elevM);
    const veg = TerrainViewer._vegRampColor(elevM);
    const rock = [0.55, 0.53, 0.50];
    const s = Number.isFinite(slope) ? slope : 0;
    let rockAmt = Math.max(0, Math.min(1, (s - 0.7) / 1.0)); // ~35° starts, ~80° full
    // OSM-confirmed vegetation resists the rock blend far more than unlabelled ground.
    rockAmt *= (family === 'green') ? 0.3 : 0.75;
    // Keep snow caps white rather than greying them on steep summits.
    if (elevM > 3550) rockAmt *= 0.2;
    return [
      veg[0] + (rock[0] - veg[0]) * rockAmt,
      veg[1] + (rock[1] - veg[1]) * rockAmt,
      veg[2] + (rock[2] - veg[2]) * rockAmt,
    ];
  }

  // OSM land-cover class → terrain colour family + raster priority (a higher
  // priority wins where polygons overlap, so a park inside a town reads green).
  // Water is intentionally absent — it keeps its own translucent surface overlay
  // instead of tinting the ground.
  static _landCoverFamily(cls) {
    switch (cls) {
      case 'forest':
      case 'grass':  return { family: 'green', pri: 3 };
      case 'waste':  return { family: 'soil',  pri: 2 };
      case 'urban':  return { family: 'urban', pri: 1 };
      default:       return null;
    }
  }

  // Even-odd ray-cast point-in-polygon test ([lat,lng] ring, lat=y, lng=x).
  _pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const yi = ring[i][0], xi = ring[i][1];
      const yj = ring[k][0], xj = ring[k][1];
      const denom = (yj - yi) || 1e-12;
      const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / denom + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Rasterise the area polygons onto the fine field grid, producing a per-vertex
  // land-cover family (null → default green). Each polygon is only tested over
  // the grid cells inside its lat/lng bounding box, so this stays cheap even with
  // hundreds of areas. Holes (rings[1..]) are subtracted so an inner lake/clearing
  // doesn't inherit the outer cover.
  _buildLandCoverField(areas, buildings, bbox) {
    const N = FIELD_SIZE;
    const fam = [];
    const pri = [];
    for (let i = 0; i < N; i++) { fam.push(new Array(N).fill(null)); pri.push(new Array(N).fill(0)); }
    const latSpan = (bbox.maxLat - bbox.minLat) || 1;
    const lngSpan = (bbox.maxLng - bbox.minLng) || 1;

    for (const ar of (areas || [])) {
      const info = TerrainViewer._landCoverFamily(ar.cls);
      if (!info) continue;
      const rings = ar.rings || [];
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const holes = rings.slice(1).filter((h) => h && h.length >= 3);

      let rminLat = Infinity, rmaxLat = -Infinity, rminLng = Infinity, rmaxLng = -Infinity;
      for (const [la, lo] of outer) {
        if (la < rminLat) rminLat = la; if (la > rmaxLat) rmaxLat = la;
        if (lo < rminLng) rminLng = lo; if (lo > rmaxLng) rmaxLng = lo;
      }
      const i0 = Math.max(0, Math.floor((rminLat - bbox.minLat) / latSpan * (N - 1)));
      const i1 = Math.min(N - 1, Math.ceil((rmaxLat - bbox.minLat) / latSpan * (N - 1)));
      const j0 = Math.max(0, Math.floor((rminLng - bbox.minLng) / lngSpan * (N - 1)));
      const j1 = Math.min(N - 1, Math.ceil((rmaxLng - bbox.minLng) / lngSpan * (N - 1)));

      for (let i = i0; i <= i1; i++) {
        const lat = bbox.minLat + latSpan * i / (N - 1);
        for (let j = j0; j <= j1; j++) {
          if (info.pri <= pri[i][j]) continue;
          const lng = bbox.minLng + lngSpan * j / (N - 1);
          if (!this._pointInRing(lat, lng, outer)) continue;
          if (holes.some((h) => this._pointInRing(lat, lng, h))) continue;
          fam[i][j] = info.family;
          pri[i][j] = info.pri;
        }
      }
    }

    // Built-up density: where several building footprints fall in one fine cell
    // and no higher-priority cover (park / forest / farmland) claimed it, mark the
    // ground urban (灰). This makes real townscapes read grey even where OSM has
    // no landuse=residential polygon — the gap that previously left city blocks
    // painted green.
    if (Array.isArray(buildings) && buildings.length) {
      const counts = [];
      for (let i = 0; i < N; i++) counts.push(new Array(N).fill(0));
      for (const b of buildings) {
        const ring = b.ring;
        if (!ring || ring.length < 3) continue;
        let cla = 0, clo = 0;
        for (const [la, lo] of ring) { cla += la; clo += lo; }
        cla /= ring.length; clo /= ring.length;
        const gi = Math.round((cla - bbox.minLat) / latSpan * (N - 1));
        const gj = Math.round((clo - bbox.minLng) / lngSpan * (N - 1));
        if (gi < 0 || gi >= N || gj < 0 || gj >= N) continue;
        counts[gi][gj] += 1;
      }
      const urban = TerrainViewer._landCoverFamily('urban');
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          if (counts[i][j] >= 3 && urban.pri > pri[i][j]) {
            fam[i][j] = urban.family;
            pri[i][j] = urban.pri;
          }
        }
      }
    }
    return fam;
  }

  // Re-tint the (already built) terrain mesh so each vertex uses its land-cover
  // family's elevation ramp instead of the single default green ramp. Called once
  // the map features are available; the colours live on the terrain geometry, so
  // they persist regardless of the "圖資" overlay toggle.
  _applyLandCoverColors(areas, buildings, bbox) {
    if (!this.terrainMesh || !this._field) return;
    const colorAttr = this.terrainMesh.geometry.getAttribute('color');
    if (!colorAttr) return;
    const fam = this._buildLandCoverField(areas, buildings, bbox);
    this._landCoverField = fam;

    const field = this._field;
    const N = FIELD_SIZE;
    const minElev = this._fieldMinV;
    const slopes = this._slopeField || this._computeFieldSlopes(field, bbox, N);
    let idx = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const raw = field[i][j];
        const elev = this._isHole(raw) ? minElev : raw;
        const [r, g, b] = TerrainViewer._terrainColorFor(fam[i][j], elev, slopes[i][j]);
        colorAttr.setXYZ(idx, r, g, b);
        idx++;
      }
    }
    colorAttr.needsUpdate = true;
  }

  _createTerrain(bbox) {
    const field = this._field;
    const N = FIELD_SIZE;
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    const indices = [];
    const uvs = [];

    const minElev = this._fieldMinV;
    // Per-vertex true slope (independent of the vertical render scale) drives the
    // rock-vs-vegetation blend so ridges/cliffs read rocky and valleys green.
    const slopes = this._computeFieldSlopes(field, bbox, N);
    this._slopeField = slopes;

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (N - 1);
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1);
        const raw = field[i][j];
        // Holes get a placeholder height; the quads touching them are skipped so
        // they never appear on screen.
        const elev = this._isHole(raw) ? minElev : raw;
        const p = this._latLngToLocal(lat, lng, elev, bbox);
        vertices.push(p.x, p.y, p.z);
        uvs.push(j / (N - 1), i / (N - 1));

        // Colour by absolute elevation + slope; land cover is painted in later by
        // _applyLandCoverColors once the map features have downloaded.
        const [r, g, b] = TerrainViewer._terrainColorFor(null, elev, slopes[i][j]);
        colors.push(r, g, b);
      }
    }

    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < N - 1; j++) {
        // Skip any quad touching missing data — blank tiles aren't drawn.
        if (this._isHole(field[i][j]) || this._isHole(field[i][j + 1]) ||
            this._isHole(field[i + 1][j]) || this._isHole(field[i + 1][j + 1])) continue;
        const a = i * N + j;
        const b = i * N + j + 1;
        const c = (i + 1) * N + j;
        const d = (i + 1) * N + j + 1;
        // Alternate the split diagonal per cell (checkerboard) so the
        // triangulation has no consistent direction — this removes the regular
        // diagonal "corduroy" wrinkle that a uniform split produces.
        if ((i + j) & 1) {
          indices.push(a, b, d);
          indices.push(a, d, c);
        } else {
          indices.push(a, b, c);
          indices.push(b, d, c);
        }
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    // Smooth per-vertex normals from the height-field gradient (central
    // differences) instead of averaging triangle faces. Triangulation-derived
    // normals alternate cell-to-cell and read as regular directional wrinkles
    // that shift with the light angle; gradient normals are independent of how
    // the quads are split, so the surface shades cleanly.
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this._computeFieldNormals(field, bbox, N), 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      // Matte surface: less specular glint so any residual facets don't catch
      // the light and read as wrinkles.
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
      // Push terrain fragments slightly back in the depth buffer so coincident
      // contour/route lines win and don't z-fight / break through.
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.scene.add(this.terrainMesh);
  }

  // Smooth analytic normals (N×N×3, vertex order matching _createTerrain) from
  // the height field's gradient. Using the continuous slope rather than the
  // triangle facets removes the triangulation-dependent "corduroy" wrinkle that
  // changed with the sun direction. World spacing between fine samples is needed
  // so the slope is in true world units (x east, z north, y up).
  _computeFieldNormals(field, bbox, N) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const dx = R * toRad * ((bbox.maxLng - bbox.minLng) / (N - 1)) * Math.cos(toRad * cy) || 1;
    const dz = R * toRad * ((bbox.maxLat - bbox.minLat) / (N - 1)) || 1;

    const normals = new Float32Array(N * N * 3);
    const at = (i, j) => {
      const ii = i < 0 ? 0 : (i >= N ? N - 1 : i);
      const jj = j < 0 ? 0 : (j >= N ? N - 1 : j);
      const v = field[ii][jj];
      return this._isHole(v) ? null : v;
    };
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const c = at(i, j);
        // Hole vertices aren't drawn; give them a flat up-normal so they don't
        // poison neighbour shading via interpolation.
        const center = c == null ? 0 : c;
        const hl = at(i, j - 1) ?? center;
        const hr = at(i, j + 1) ?? center;
        const hd = at(i - 1, j) ?? center;
        const hu = at(i + 1, j) ?? center;
        const gx = (hr - hl) / (2 * dx); // ∂h/∂x
        const gz = (hu - hd) / (2 * dz); // ∂h/∂z
        tmp.set(-gx, 1, -gz).normalize();
        const o = (i * N + j) * 3;
        normals[o] = tmp.x;
        normals[o + 1] = tmp.y;
        normals[o + 2] = tmp.z;
      }
    }
    return normals;
  }

  // True-world slope magnitude (rise/run) per fine-field vertex, in the vertex
  // order used by _createTerrain. Computed from ABSOLUTE elevations and true world
  // spacing so it's independent of the vertical render scale — the "海拔歸一化"
  // toggle exaggerates the relief but must not change the terrain colouring.
  _computeFieldSlopes(field, bbox, N) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const dx = R * toRad * ((bbox.maxLng - bbox.minLng) / (N - 1)) * Math.cos(toRad * cy) || 1;
    const dz = R * toRad * ((bbox.maxLat - bbox.minLat) / (N - 1)) || 1;
    const at = (i, j) => {
      const ii = i < 0 ? 0 : (i >= N ? N - 1 : i);
      const jj = j < 0 ? 0 : (j >= N ? N - 1 : j);
      const v = field[ii][jj];
      return this._isHole(v) ? null : v;
    };
    const slopes = [];
    for (let i = 0; i < N; i++) {
      const row = new Array(N);
      for (let j = 0; j < N; j++) {
        const c = at(i, j);
        const center = c == null ? 0 : c;
        const hl = at(i, j - 1) ?? center;
        const hr = at(i, j + 1) ?? center;
        const hd = at(i - 1, j) ?? center;
        const hu = at(i + 1, j) ?? center;
        const gx = (hr - hl) / (2 * dx);
        const gz = (hu - hd) / (2 * dz);
        row[j] = Math.hypot(gx, gz);
      }
      slopes.push(row);
    }
    return slopes;
  }

  // --- Smoothed / upsampled height field -------------------------------------

  _isHole(v) {
    return v == null || !Number.isFinite(v);
  }

  // Build the fine render/contour field from the coarse download grid: a
  // hole-aware light blur (softens DEM terracing) followed by a Catmull-Rom
  // upsample to FIELD_SIZE (bilinear near holes). Records valid min/max in
  // this._fieldMinV / this._fieldMaxV.
  _buildFineField(grid) {
    const N = GRID_SIZE;

    // 1) Hole-aware 3×3 blur of the coarse grid.
    const sm = [];
    for (let i = 0; i < N; i++) {
      const row = [];
      for (let j = 0; j < N; j++) {
        if (this._isHole(grid[i][j])) { row.push(null); continue; }
        let sum = 0;
        let w = 0;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || ii >= N || jj < 0 || jj >= N) continue;
            const v = grid[ii][jj];
            if (this._isHole(v)) continue;
            const wt = (di === 0 && dj === 0) ? 4 : 1;
            sum += v * wt;
            w += wt;
          }
        }
        row.push(w > 0 ? sum / w : grid[i][j]);
      }
      sm.push(row);
    }

    // 2) Upsample to the fine field.
    const field = [];
    let minV = Infinity;
    let maxV = -Infinity;
    for (let fi = 0; fi < FIELD_SIZE; fi++) {
      const row = [];
      const gy = fi / (FIELD_SIZE - 1) * (N - 1);
      for (let fj = 0; fj < FIELD_SIZE; fj++) {
        const gx = fj / (FIELD_SIZE - 1) * (N - 1);
        const v = this._sampleSmooth(sm, gy, gx, N);
        row.push(v);
        if (v != null) { if (v < minV) minV = v; if (v > maxV) maxV = v; }
      }
      field.push(row);
    }

    this._fieldMinV = Number.isFinite(minV) ? minV : 0;
    this._fieldMaxV = Number.isFinite(maxV) ? maxV : (this._fieldMinV + 1);
    return field;
  }

  // Catmull-Rom (bicubic) sample of a grid at fractional coords; bilinear when
  // the 4×4 neighbourhood isn't fully valid; null when a bilinear corner is a
  // hole (so the fine sample is itself a hole and won't be drawn).
  _sampleSmooth(grid, gy, gx, N) {
    const j0 = Math.max(0, Math.min(N - 1, Math.floor(gx)));
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(gy)));
    const j1 = Math.min(N - 1, j0 + 1);
    const i1 = Math.min(N - 1, i0 + 1);
    const c00 = grid[i0][j0];
    const c01 = grid[i0][j1];
    const c10 = grid[i1][j0];
    const c11 = grid[i1][j1];
    if (this._isHole(c00) || this._isHole(c01) || this._isHole(c10) || this._isHole(c11)) return null;
    const tx = gx - j0;
    const ty = gy - i0;

    const g = (di, dj) => {
      const ii = Math.max(0, Math.min(N - 1, i0 + di));
      const jj = Math.max(0, Math.min(N - 1, j0 + dj));
      return grid[ii][jj];
    };

    // Fall back to bilinear if any of the wider 4×4 stencil is a hole.
    let allValid = true;
    for (let di = -1; di <= 2 && allValid; di++) {
      for (let dj = -1; dj <= 2; dj++) {
        if (this._isHole(g(di, dj))) { allValid = false; break; }
      }
    }
    if (!allValid) {
      const top = c00 + (c01 - c00) * tx;
      const bot = c10 + (c11 - c10) * tx;
      return top + (bot - top) * ty;
    }

    const cr = (p0, p1, p2, p3, t) =>
      0.5 * ((2 * p1) + (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    const col = [];
    for (let di = -1; di <= 2; di++) {
      col.push(cr(g(di, -1), g(di, 0), g(di, 1), g(di, 2), tx));
    }
    return cr(col[0], col[1], col[2], col[3], ty);
  }

  // ---------- Contour lines (等高線) ----------

  _niceContourInterval() {
    // Fixed resolution per precision: high = 20 m, low = 100 m.
    return this._contourPrecision === 'low' ? 100 : 20;
  }

  _createContours(bbox) {
    const field = this._field;
    const minElev = this._fieldMinV;
    const maxElev = this._fieldMaxV;
    const range = maxElev - minElev;

    const interval = this._niceContourInterval();
    const majorEvery = this._contourPrecision === 'low' ? 4 : 5;

    this._terrainInfo = {
      elevMin: minElev,
      elevMax: maxElev,
      contourInterval: interval,
      gridSize: GRID_SIZE,
    };

    if (range < 1 || !field) return;

    this.contourGroup = new THREE.Group();
    this.contourLabelGroup = new THREE.Group();

    const minorVerts = [];
    const majorVerts = [];
    const labelAnchors = []; // { level, point: Vector3 }

    // Lift the iso-lines a touch above the surface so they read clearly without
    // breaking through it. Small, because they now share the surface field.
    const lift = Math.max(1.5, range * 0.004);

    const startLevel = Math.ceil(minElev / interval) * interval;
    for (let level = startLevel; level < maxElev; level += interval) {
      const isMajor = Math.round(level / interval) % majorEvery === 0;
      const segments = this._marchingSquares(field, level, bbox, lift);
      const sink = isMajor ? majorVerts : minorVerts;
      for (const seg of segments) {
        sink.push(seg.a.x, seg.a.y, seg.a.z, seg.b.x, seg.b.y, seg.b.z);
      }
      if (isMajor && segments.length) {
        // Pick a mid segment so the label sits inside the terrain, not on an edge.
        const mid = segments[Math.floor(segments.length / 2)];
        labelAnchors.push({
          level,
          point: new THREE.Vector3(
            (mid.a.x + mid.b.x) / 2,
            (mid.a.y + mid.b.y) / 2 + 4,
            (mid.a.z + mid.b.z) / 2
          ),
        });
      }
    }

    const ms = this._markerScale || 1;

    // Wide (pixel-width) iso-lines so they read clearly and are ~2× the old
    // 1px hairlines.
    if (minorVerts.length) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(minorVerts);
      const mat = new LineMaterial({ color: 0xe8d9b5, linewidth: 1, transparent: true, opacity: 0.4 });
      const seg = new LineSegments2(geo, mat);
      seg.computeLineDistances();
      this.contourGroup.add(seg);
      this._lineMaterials.push(mat);
    }

    if (majorVerts.length) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(majorVerts);
      const mat = new LineMaterial({ color: 0xfff0c2, linewidth: 1.75, transparent: true, opacity: 0.75 });
      const seg = new LineSegments2(geo, mat);
      seg.computeLineDistances();
      this.contourGroup.add(seg);
      this._lineMaterials.push(mat);
    }

    this.scene.add(this.contourGroup);

    // Elevation labels, scaled to the terrain so they're actually legible (the
    // old fixed 40×14 size was invisible on real-scale terrain).
    for (const anchor of labelAnchors) {
      const label = this._createLabel(`${Math.round(anchor.level)} m`, anchor.point.x, anchor.point.y, anchor.point.z, 0xfff0c2);
      label.scale.set(48 * ms, 16 * ms, 1);
      this._registerLabel(label);
      this.contourLabelGroup.add(label);
    }
    this.scene.add(this.contourLabelGroup);
    this._updateLineResolutions();
  }

  _cellToWorld(fi, fj, level, bbox, lift) {
    const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * fi / (FIELD_SIZE - 1);
    const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * fj / (FIELD_SIZE - 1);
    const p = this._latLngToLocal(lat, lng, level + (lift || 2), bbox);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  // Marching squares over the fine height field for a single iso-level. Cells
  // touching a hole are skipped so no contour is drawn over missing data.
  _marchingSquares(field, level, bbox, lift) {
    const segments = [];
    const lerp = (a, b) => (level - a) / (b - a);

    for (let i = 0; i < FIELD_SIZE - 1; i++) {
      for (let j = 0; j < FIELD_SIZE - 1; j++) {
        const tl = field[i][j];
        const tr = field[i][j + 1];
        const br = field[i + 1][j + 1];
        const bl = field[i + 1][j];
        if (this._isHole(tl) || this._isHole(tr) || this._isHole(br) || this._isHole(bl)) continue;

        let idx = 0;
        if (tl > level) idx |= 8;
        if (tr > level) idx |= 4;
        if (br > level) idx |= 2;
        if (bl > level) idx |= 1;
        if (idx === 0 || idx === 15) continue;

        // Edge crossing points in fractional grid coords.
        const top = () => [i, j + lerp(tl, tr)];
        const right = () => [i + lerp(tr, br), j + 1];
        const bottom = () => [i + 1, j + lerp(bl, br)];
        const left = () => [i + lerp(tl, bl), j];

        const pairs = [];
        switch (idx) {
          case 1: case 14: pairs.push([left, bottom]); break;
          case 2: case 13: pairs.push([bottom, right]); break;
          case 3: case 12: pairs.push([left, right]); break;
          case 4: case 11: pairs.push([top, right]); break;
          case 6: case 9: pairs.push([top, bottom]); break;
          case 7: case 8: pairs.push([top, left]); break;
          case 5: pairs.push([top, right], [bottom, left]); break;
          case 10: pairs.push([top, left], [bottom, right]); break;
          default: break;
        }

        for (const [ea, eb] of pairs) {
          const [ai, aj] = ea();
          const [bi, bj] = eb();
          segments.push({
            a: this._cellToWorld(ai, aj, level, bbox, lift),
            b: this._cellToWorld(bi, bj, level, bbox, lift),
          });
        }
      }
    }
    return segments;
  }

  // Route gradient colour at arc-length fraction f (0..1), matching the 2D map.
  // Falls back to the legacy cyan when no per-vertex colours were supplied.
  _routeColorAtFrac(f) {
    const cols = this._routeColors;
    if (!cols || !cols.length) return new THREE.Color(0x00d4ff);
    if (cols.length === 1) return cols[0].clone();
    const D = this._distances;
    if (D && D.length === cols.length && this._totalDistM > 0) {
      const { idx, f: ff } = this._bracketByDist(this._clampU(f) * this._totalDistM);
      const a = cols[idx];
      const b = cols[Math.min(idx + 1, cols.length - 1)];
      return a.clone().lerp(b, ff);
    }
    const idx = Math.max(0, Math.min(cols.length - 1, Math.round(this._clampU(f) * (cols.length - 1))));
    return cols[idx].clone();
  }

  _createRoutePath(coords, elevations, bbox) {
    if (!coords || coords.length < 2) return;

    const hasGradient = !!(this._routeColors && this._routeColors.length === coords.length);
    const legacyColor = new THREE.Color(0x00d4ff);
    // Dynamic minor draping offset (Plan §II): lift the track a small,
    // relief-proportional amount above the surface instead of a fixed +5 m. On a
    // tall model +5 m disappears into the terrain (Z-fighting / track sinking);
    // scaling with the elevation range keeps a consistent visible float at any
    // model size while never lifting the track conspicuously off the ground.
    const relief = Math.max(1, this._fieldMaxV - this._fieldMinV);
    const routeLift = Math.max(5, relief * 0.01);
    const pts = coords.map(([lat, lng], i) => {
      const elev = elevations?.[i] ?? 0;
      const p = this._latLngToLocal(lat, lng, elev + routeLift, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    });

    // Centripetal Catmull-Rom curve (Plan §II): centripetal parameterisation
    // never overshoots or loops at sharp turns the way the uniform variant does,
    // so tight switchbacks read as smooth curves rather than cusps. The curve is
    // then resampled at an even arc-length spacing dense enough that both the 3D
    // tube AND the overlay line follow the real bends instead of cutting the
    // corner between sparsely-sampled GPS vertices (the "straight-line cutting"
    // artefact). Sample count scales with the track's on-model length, clamped.
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    let curveLen = 0;
    try { curveLen = curve.getLength(); } catch { curveLen = 0; }
    const targetSpacing = Math.max(6, (this._worldSpan || 2000) / 500);
    const segCount = Math.max(
      pts.length * 2,
      Math.min(4000, Math.round((curveLen || pts.length * targetSpacing) / targetSpacing))
    );
    // Arc-length-even samples: even tube rings + gradient fraction == distance
    // fraction, so the resampled colours line up with the 2D route gradient.
    const sampled = curve.getSpacedPoints(segCount);

    // Tube geometry gives the track a shaded 3D body. Gradient colours are applied
    // ring-by-ring so it reads like the 2D route line.
    const tubularSegments = segCount;
    const radialSegments = 8;
    const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, 6, radialSegments, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: hasGradient ? 0xffffff : legacyColor,
      vertexColors: hasGradient,
      emissive: hasGradient ? 0x000000 : legacyColor,
      emissiveIntensity: hasGradient ? 0 : 0.3,
      roughness: 0.4,
      metalness: 0.3,
    });
    if (hasGradient) {
      const ringCount = tubularSegments + 1;
      const vertsPerRing = radialSegments + 1;
      const colorArr = new Float32Array(ringCount * vertsPerRing * 3);
      for (let ring = 0; ring < ringCount; ring++) {
        const col = this._routeColorAtFrac(ringCount > 1 ? ring / (ringCount - 1) : 0);
        for (let j = 0; j < vertsPerRing; j++) {
          const vi = (ring * vertsPerRing + j) * 3;
          colorArr[vi] = col.r;
          colorArr[vi + 1] = col.g;
          colorArr[vi + 2] = col.b;
        }
      }
      tubeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colorArr, 3));
    }
    this.routeTube = new THREE.Mesh(tubeGeo, tubeMat);
    this.routeTube.castShadow = true;
    this.scene.add(this.routeTube);
    // Cache the tube's tubular/radial segment counts so the trail-reveal mode can
    // clamp the index draw-range to the traveled portion (Plan §II-1).
    this._routeTubeSegs = tubularSegments;
    this._routeTubeRadial = radialSegments;

    // Bright always-on overlay line carrying the same gradient. A wide (pixel
    // width) Line2 so the track stays clearly visible and thick at any zoom. It
    // follows the SAME resampled smooth curve as the tube, so the visible line no
    // longer cuts across corners at sparsely-sampled sharp turns.
    const positions = [];
    for (const v of sampled) positions.push(v.x, v.y, v.z);
    const lineGeo = new LineGeometry();
    lineGeo.setPositions(positions);
    if (hasGradient) {
      const lineColors = [];
      const denom = Math.max(1, sampled.length - 1);
      for (let i = 0; i < sampled.length; i++) {
        const col = this._routeColorAtFrac(i / denom);
        lineColors.push(col.r, col.g, col.b);
      }
      lineGeo.setColors(lineColors);
    }
    const lineMat = new LineMaterial({
      color: hasGradient ? 0xffffff : 0x88eeff,
      vertexColors: hasGradient,
      linewidth: 4,           // screen-space pixels
      transparent: true,
      opacity: 0.95,
    });
    this.routeLine = new Line2(lineGeo, lineMat);
    this.routeLine.computeLineDistances();
    this.scene.add(this.routeLine);
    this._lineMaterials.push(lineMat);
    // Number of segment instances in the overlay line (one per gap between
    // resampled points) — the reveal mode limits instanceCount to this fraction.
    this._routeLineSegs = Math.max(1, sampled.length - 1);

    // ----- Suspended-absolute drop stems (Plan §II-4) -----
    // Thin vertical lines from the track down to the terrain surface beneath each
    // (subsampled) route vertex, making the track's suspension in 3D space legible
    // when the 絕對海拔 mode is on. Built once, hidden until toggled.
    this._buildRouteStems(coords, elevations, routeLift, bbox);

    // Honour a persisted trail-reveal preference for the freshly built geometry.
    this._applyRouteReveal();
  }

  // Build the vertical drop-lines connecting the suspended track to the ground.
  // Subsampled so a dense track doesn't spawn thousands of stems. Stems are
  // skipped where the track barely floats (< ~4 m above terrain) or over a hole.
  _buildRouteStems(coords, elevations, routeLift, bbox) {
    if (!coords || coords.length < 2) return;
    const step = Math.max(1, Math.floor(coords.length / 80));
    const verts = [];
    const pushStem = (i) => {
      const [lat, lng] = coords[i];
      if (this._isOverHole(lat, lng)) return;
      const routeElev = (elevations?.[i] ?? 0) + routeLift;
      const groundElev = this._sampleGridElevation(lat, lng);
      if (routeElev - groundElev < 4) return; // barely floating → no stem needed
      const top = this._latLngToLocal(lat, lng, routeElev, bbox);
      const bot = this._latLngToLocal(lat, lng, groundElev, bbox);
      verts.push(top.x, top.y, top.z, bot.x, bot.y, bot.z);
    };
    for (let i = 0; i < coords.length; i += step) pushStem(i);
    pushStem(coords.length - 1);
    if (verts.length < 6) return;

    const geo = new LineSegmentsGeometry();
    geo.setPositions(verts);
    const mat = new LineMaterial({ color: 0xffb066, linewidth: 1.2, transparent: true, opacity: 0.55 });
    const stems = new LineSegments2(geo, mat);
    stems.computeLineDistances();
    stems.visible = this._absoluteElevation;
    this._routeStemGroup = stems;
    this.scene.add(stems);
    this._lineMaterials.push(mat);
  }

  // Suspended-absolute mode (Plan §II-4): show the drop stems so the track reads
  // as floating at its true elevation above the terrain. Geometry is prebuilt, so
  // this just flips visibility — no rebuild.
  setAbsoluteElevation(on) {
    this._absoluteElevation = !!on;
    if (this._routeStemGroup) this._routeStemGroup.visible = this._absoluteElevation;
  }

  isAbsoluteElevation() {
    return this._absoluteElevation;
  }

  // Time-dynamic trail reveal (Plan §II-1): when on, the tube + overlay line only
  // draw up to the player's progress; when off, the whole track is shown.
  setRouteRevealMode(on) {
    this._routeReveal = !!on;
    this._applyRouteReveal();
  }

  isRouteRevealMode() {
    return this._routeReveal;
  }

  // Clamp the route geometry's drawn extent to the traveled fraction (reveal on)
  // or restore it in full (reveal off). Cheap — no geometry rebuild — so it can be
  // called every frame from _updatePlayerPosition.
  _applyRouteReveal() {
    const tube = this.routeTube;
    const line = this.routeLine;
    if (tube && tube.geometry) {
      const idx = tube.geometry.index;
      if (idx) {
        if (!this._routeReveal) {
          tube.geometry.setDrawRange(0, idx.count);
        } else {
          const segs = this._routeTubeSegs || 0;
          const radial = this._routeTubeRadial || 8;
          const shown = Math.max(1, Math.round(this._clampU(this._progress) * segs));
          tube.geometry.setDrawRange(0, Math.min(idx.count, shown * radial * 6));
        }
      }
    }
    if (line && line.geometry) {
      if (!this._routeReveal) {
        line.geometry.instanceCount = Infinity;
      } else {
        const segs = this._routeLineSegs || 0;
        line.geometry.instanceCount = Math.max(1, Math.round(this._clampU(this._progress) * segs));
      }
    }
  }

  _createWaypoints(waypoints, bbox) {
    if (!waypoints || waypoints.length === 0) return;
    const ms = this._markerScale || 1;

    waypoints.forEach((wp, i) => {
      const [lat, lng] = wp.coords || wp;
      const elev = wp.elevation ?? 0;
      const p = this._latLngToLocal(lat, lng, elev, bbox);

      // Prefer the gradient colour supplied by the 2D map (per-waypoint); fall
      // back to the legacy start/mid/end scheme when none is given.
      const fallbackCss = i === 0 ? '#00ff88' : (i === waypoints.length - 1 ? '#ff4466' : '#ffaa44');
      const colorCss = wp.color || fallbackCss;

      const name = wp.label || `WP${i + 1}`;
      const detail = {
        type: 'waypoint',
        index: i,
        label: name,
        colorCss,
        elevation: wp.elevation ?? null,
        lat, lng,
        distanceM: wp.distanceM ?? null,
        isStart: i === 0,
        isEnd: i === waypoints.length - 1,
      };

      // Colour-matched flag-on-pole planted at the waypoint itself (旗幟標示),
      // echoing the 2D map's pin colour so the ground point reads clearly even
      // when the floating name plaque is scrolled/zoomed out of legibility.
      const flag = this._buildWaypointFlag(colorCss, ms);
      flag.position.set(p.x, p.y, p.z);
      flag.userData.detail = detail;
      this.scene.add(flag);
      this.waypointMarkers.push(flag);
      this._pickables.push(flag);

      // Signboard billboard whose downward pin points at the waypoint — no ground
      // sphere. Half the previous size. Click → detail.
      const sign = this._createBillboard(name, colorCss);
      const signH = 13 * ms;
      sign.scale.set(signH * (256 / 96), signH, 1);
      this._registerLabel(sign);
      sign.position.set(p.x, p.y, p.z);
      sign.userData.detail = detail;
      this.scene.add(sign);
      this.waypointMarkers.push(sign);
      this._pickables.push(sign);
    });
  }

  // A small flag-on-pole marker (旗幟標示) planted at a route waypoint's ground
  // point, coloured to match the 2D map's per-waypoint pin. Feet sit at y = 0;
  // the caller positions the group at the waypoint's world coordinate.
  _buildWaypointFlag(colorCss, ms) {
    const g = new THREE.Group();
    const poleH = 11 * ms;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32 * ms, 0.38 * ms, poleH, 6),
      new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5 })
    );
    pole.position.y = poleH / 2;
    pole.castShadow = true;
    g.add(pole);

    const flagW = 5 * ms;
    const flagH = 3.2 * ms;
    const flagMat = new THREE.MeshStandardMaterial({
      color: colorCss, side: THREE.DoubleSide, roughness: 0.7,
      emissive: colorCss, emissiveIntensity: 0.18,
    });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(flagW, flagH), flagMat);
    flag.position.set(flagW / 2, poleH - flagH / 2, 0);
    flag.castShadow = true;
    g.add(flag);
    return g;
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // A signboard-style billboard (rounded plaque with a colour-keyed border and a
  // downward pin) showing a name; always faces the camera.
  _createBillboard(text, colorCss) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 96);

    ctx.font = 'bold 30px Inter, "Noto Sans TC", sans-serif';
    const tw = ctx.measureText(text).width;
    const bw = Math.min(244, Math.max(80, tw + 60));
    const bh = 52;
    const bx = (256 - bw) / 2;
    const by = 5;

    // Pin tail pointing down toward the marker.
    ctx.beginPath();
    ctx.moveTo(128 - 11, by + bh - 2);
    ctx.lineTo(128 + 11, by + bh - 2);
    ctx.lineTo(128, by + bh + 18);
    ctx.closePath();
    ctx.fillStyle = colorCss;
    ctx.fill();

    // Plaque.
    this._roundRectPath(ctx, bx, by, bw, bh, 12);
    ctx.fillStyle = 'rgba(12,14,20,0.92)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = colorCss;
    ctx.stroke();

    // Colour dot + name.
    ctx.fillStyle = colorCss;
    ctx.beginPath();
    ctx.arc(bx + 18, by + bh / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 32, by + bh / 2 + 1, bw - 44);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.center.set(0.5, 0);
    return sprite;
  }

  _createWeatherLabels(weatherPoints, bbox) {
    this._weatherIconEntries = [];
    // A rebuild disposes the old rigs before growing fresh ones for this build.
    if (this._weather3d) { this._weather3d.dispose(); this._weather3d = null; }
    if (!weatherPoints || weatherPoints.length === 0) return;

    this.weatherGroup = new THREE.Group();
    this.scene.add(this.weatherGroup);

    // World-space anchors for the volumetric 3D weather rigs, one per point.
    const rigPoints = [];

    const ms0 = this._markerScale || 1;
    weatherPoints.forEach((pt) => {
      if (!pt || !pt.coords) return;
      const [lat, lng] = pt.coords;
      // Sit the icon on the rendered terrain surface (sampled from the grid),
      // not at the supplied/sea-level elevation that left it floating below.
      const surfElev = this._sampleGridElevation(lat, lng);
      const p = this._latLngToLocal(lat, lng, surfElev + 18 * ms0, bbox);

      const icon = pt.weatherCode != null ? TerrainViewer.weatherIcon(pt.weatherCode) : '☀️';
      const cat = pt.weatherCode != null ? TerrainViewer.weatherCategory(pt.weatherCode) : 'clear';
      const temp = pt.temperature != null ? `${Math.round(pt.temperature)}°C` : '';

      // Each marker owns a canvas/texture so its icon can be repainted per frame
      // as a live weather animation when 天氣特效 is enabled.
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        sizeAttenuation: true,
      });
      const label = new THREE.Sprite(spriteMat);
      label.position.set(p.x, p.y, p.z);
      // Scale to the terrain so the labels are legible (the default fixed size is
      // invisible on real-scale terrain).
      const ms = this._markerScale || 1;
      label.scale.set(60 * ms, 20 * ms, 1);

      const entry = { sprite: label, canvas, ctx, texture, cat, icon, temp };
      // The badge is a static reference chip now — the animation is the 3D rig.
      this._paintWeatherLabel(entry);

      // Anchor the 3D weather rig on the terrain surface directly under the badge.
      const surf = this._latLngToLocal(lat, lng, surfElev, bbox);
      rigPoints.push({ pos: new THREE.Vector3(surf.x, surf.y, surf.z), cat });

      // Not registered with _registerLabel: the weather icon/temperature badge is
      // content gated by the 天氣／特效 toggles, not the 字體 (text label size)
      // control, so it must stay visible even when 字體 is set to 關 (none).
      label.userData.detail = {
        type: 'weather',
        label: pt.label || '天氣點',
        icon,
        temperature: pt.temperature ?? null,
        weatherCode: pt.weatherCode ?? null,
        elevation: pt.elevation ?? null,
        lat, lng,
      };
      this.weatherGroup.add(label);
      this.weatherLabels.push(label);
      this._weatherIconEntries.push(entry);
      this._pickables.push(label);
    });

    // Grow the volumetric 3D weather phenomena in world space at each point.
    this._weather3d = new WeatherFx3D(this.scene, { scale: ms0, worldSpan: this._worldSpan });
    this._weather3d.build(rigPoints);
    this._applyWeather3DVisibility();
  }

  // Paint one weather marker's canvas: a compact rounded badge with the emoji and
  // temperature. Drawn once on build — the moving weather is now the volumetric
  // 3D rig (WeatherFx3D), so the badge stays a static, legible reference chip.
  _paintWeatherLabel(entry) {
    const { ctx, canvas, icon, temp } = entry;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.font = 'bold 32px Inter, "Noto Sans TC", sans-serif';
    const tw = temp ? ctx.measureText(temp).width : 0;
    const glyphW = 44;            // reserved width for the icon/animation
    const gap = temp ? 10 : 0;
    const pad = 16;
    const bw = glyphW + gap + tw + pad * 2;
    const bh = 50;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;

    // Rounded badge background (matches _createLabel's styling).
    const r = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();

    const gcx = bx + pad + glyphW / 2;
    const gcy = H / 2;
    ctx.fillStyle = '#ffffff';
    ctx.font = '30px Inter, "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, gcx, gcy);

    if (temp) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px Inter, "Noto Sans TC", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(temp, bx + pad + glyphW + gap, gcy);
    }

    entry.texture.needsUpdate = true;
  }

  _createLabel(text, x, y, z, colorHex) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 80;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 32px Inter, "Noto Sans TC", sans-serif';
    const metrics = ctx.measureText(text);
    const tw = metrics.width;

    const pad = 16;
    const bw = tw + pad * 2;
    const bh = 50;
    const bx = (canvas.width - bw) / 2;
    const by = (canvas.height - bh) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, y, z);
    sprite.scale.set(60, 20, 1);
    return sprite;
  }

  // ---------- Map features (道路 / 河流 / 水體 / 綠地 / 荒地 / 建築) ----------

  // Classify an OSM element's tags into a render category, or null to ignore.
  // Returns { group:'line'|'area'|'building', kind, cls } where kind drives the
  // colour/label priority and cls the line/area style.
  static _classifyFeature(tags) {
    if (!tags) return null;
    if (tags.building && tags.building !== 'no') return { group: 'building', kind: 'building', cls: 'building' };
    // building:part lets one complex landmark be modelled as several stacked/offset
    // blocks (Plan §III). Parsed alongside the parent footprint so towers on a
    // podium, wings and stepped massing render as distinct volumes.
    if (tags['building:part'] && tags['building:part'] !== 'no') return { group: 'building', kind: 'building', cls: 'part' };

    const hw = tags.highway;
    if (hw && tags.area !== 'yes') {
      if (/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(hw)) return { group: 'line', kind: 'road', cls: 'major' };
      if (/^(residential|unclassified|service|living_street|road|pedestrian)$/.test(hw)) return { group: 'line', kind: 'road', cls: 'minor' };
      if (/^(footway|path|track|cycleway|steps|bridleway)$/.test(hw)) return { group: 'line', kind: 'road', cls: 'trail' };
      return { group: 'line', kind: 'road', cls: 'minor' };
    }

    const ww = tags.waterway;
    if (ww && !tags.tunnel) {
      if (/^(river|canal)$/.test(ww)) return { group: 'line', kind: 'water', cls: 'river' };
      if (/^(stream|ditch|drain|brook)$/.test(ww)) return { group: 'line', kind: 'water', cls: 'stream' };
    }

    // 濕地 (沼澤 marsh / 潮間帶 intertidal flats) — a water-domain cover kept
    // visually distinct from open water, classified before water/green so it wins.
    if (tags.natural === 'wetland' || tags.natural === 'mud' || tags.natural === 'saltmarsh'
      || tags.wetland || tags.tidal === 'yes' || tags.landuse === 'salt_pond') {
      return { group: 'area', kind: 'water', cls: 'wetland' };
    }
    if (tags.natural === 'water' || tags.water || tags.landuse === 'reservoir' || tags.landuse === 'basin') {
      return { group: 'area', kind: 'water', cls: 'water' };
    }
    if (tags.natural === 'wood' || tags.landuse === 'forest') return { group: 'area', kind: 'green', cls: 'forest' };
    if (/^(grass|meadow|village_green|recreation_ground|farmland|farmyard|orchard|cemetery|allotments|vineyard)$/.test(tags.landuse || '')
      || /^(scrub|heath|grassland|fell)$/.test(tags.natural || '')
      || /^(park|garden|nature_reserve|golf_course|pitch|recreation_ground|common)$/.test(tags.leisure || '')) {
      return { group: 'area', kind: 'green', cls: 'grass' };
    }
    if (/^(brownfield|greenfield|landfill|quarry|construction|industrial|railway)$/.test(tags.landuse || '')
      || /^(bare_rock|scree|sand|shingle|mud|rock|cliff)$/.test(tags.natural || '')) {
      return { group: 'area', kind: 'waste', cls: 'waste' };
    }
    // Built-up / urban land cover (matches the tinted urban blocks on the 2D map).
    if (/^(residential|commercial|retail|education|institutional|civic|garages)$/.test(tags.landuse || '')
      || tags.place === 'neighbourhood' || tags.place === 'quarter') {
      return { group: 'area', kind: 'urban', cls: 'urban' };
    }
    return null;
  }

  static _featureName(tags) {
    if (!tags) return null;
    return tags['name:zh'] || tags['name:zh-Hant'] || tags.name || tags['name:en'] || null;
  }

  // Classify an OSM point (node) into a landmark render category, or null to
  // ignore (Plan §III-1). Drives which procedural 3D model _buildMapFeatures spawns.
  static _classifyPoint(tags) {
    if (!tags) return null;
    const nat = tags.natural;
    if (nat === 'peak' || nat === 'volcano') return { cls: 'peak' };
    if (nat === 'saddle') return { cls: 'saddle' };
    if (nat === 'tree') return { cls: 'tree' };
    const mm = tags.man_made;
    if (mm && /^(tower|mast|communications_tower|water_tower|lighthouse|chimney)$/.test(mm)) {
      return { cls: mm === 'lighthouse' ? 'lighthouse' : 'tower' };
    }
    if (tags.tourism && /^(viewpoint|attraction|artwork)$/.test(tags.tourism)) return { cls: 'viewpoint' };
    if (tags.historic && /^(monument|memorial|castle|ruins|archaeological_site)$/.test(tags.historic)) return { cls: 'monument' };
    return null;
  }

  // Parse an OSM length that may carry a unit ("18", "18 m", "60'"). Returns a
  // value in metres, or NaN.
  static _parseLengthM(v) {
    if (v == null) return NaN;
    const s = String(v).trim();
    let m = /^([\d.]+)\s*(m|meter|metre|metres|meters)?$/i.exec(s);
    if (m) return parseFloat(m[1]);
    m = /^([\d.]+)\s*(ft|feet|foot|')$/i.exec(s);        // imperial fallback
    if (m) return parseFloat(m[1]) * 0.3048;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // Building height derivation hierarchy (Plan §III):
  //   1) explicit `height` / `building:height` (metres, unit-aware)
  //   2) `building:levels` (+ `roof:levels`) × 3 m per level
  //   3) a regional-statistical default keyed on the building/type tag, so an
  //      untagged footprint gets a plausible mass instead of a flat 6 m slab.
  static _buildingHeight(tags) {
    const h = TerrainViewer._parseLengthM(tags.height ?? tags['building:height']);
    if (Number.isFinite(h) && h > 0) return Math.max(2, h);

    const lv = parseFloat(tags['building:levels'] ?? tags.levels);
    if (Number.isFinite(lv) && lv > 0) {
      const roofLv = parseFloat(tags['roof:levels']);
      const levels = lv + (Number.isFinite(roofLv) ? roofLv : 0);
      return Math.max(2.5, levels * 3);       // Plan §III: 3 m / level
    }

    // Statistical fallback by building class (metres). Low houses stay low;
    // apartments/offices/landmarks rise. Keyed off the building=* value.
    const kind = String(tags.building || tags['building:part'] || 'yes').toLowerCase();
    const H = {
      house: 6, detached: 6, semidetached_house: 6, bungalow: 4, cabin: 4, hut: 3,
      terrace: 8, garage: 3, garages: 3, shed: 3, roof: 3, carport: 3, greenhouse: 4,
      apartments: 15, residential: 12, dormitory: 15, hotel: 18,
      commercial: 11, retail: 8, office: 20, supermarket: 9,
      industrial: 9, warehouse: 10, manufacture: 10,
      church: 14, cathedral: 22, chapel: 9, mosque: 14, temple: 12, shrine: 6,
      school: 9, university: 14, college: 14, hospital: 16, public: 11,
      civic: 12, government: 14, stadium: 24, train_station: 12,
    };
    return H[kind] ?? 7;
  }

  // Base offset of a building (or building:part) above the ground — lets a floor
  // that starts partway up (min_height) or a raised part float on a podium.
  static _buildingMinHeight(tags) {
    const mh = TerrainViewer._parseLengthM(tags.min_height ?? tags['building:min_height']);
    if (Number.isFinite(mh) && mh > 0) return mh;
    const ml = parseFloat(tags['building:min_level'] ?? tags.min_level);
    if (Number.isFinite(ml) && ml > 0) return ml * 3;
    return 0;
  }

  // Roof descriptor for pitched-roof modelling (Plan §III). Only tagged roofs
  // (`roof:shape`) get a 3D cap; untagged buildings stay flat-topped as before,
  // so the common case is unchanged and this only ever adds detail.
  static _roofInfo(tags) {
    const shape = (tags['roof:shape'] || '').toLowerCase();
    const pitched = /^(pyramidal|hipped|gabled|round|dome|conical|cone|mansard|half-hipped|gambrel|skillion)$/.test(shape);
    if (!pitched) return null;
    let h = TerrainViewer._parseLengthM(tags['roof:height']);
    const rl = parseFloat(tags['roof:levels']);
    if (!Number.isFinite(h) && Number.isFinite(rl) && rl > 0) h = rl * 2.5;
    const colour = TerrainViewer._parseHexColour(tags['roof:colour'] || tags['roof:color']);
    return { shape, height: Number.isFinite(h) && h > 0 ? h : null, colour };
  }

  // Roof surface triangles (Plan §III-4). Returns a flat [x,y,z,…] position array
  // capping a footprint's wall top (springY) with a pitched roof up to apexY,
  // specialised by roof shape:
  //   • gabled/gambrel → a ridge along the footprint's long axis (PCA), so the
  //     long sides slope up to the ridge and the ends form triangular gables — a
  //     simplified straight-skeleton for the common rectangular case.
  //   • skillion       → a single mono-pitch plane sloping along the long axis.
  //   • hipped / pyramidal / dome / conical / mansard / (default) → a hip apex
  //     fan to a single peak over the centroid (never self-intersects).
  static _roofPositions(shape, worldXZ, springY, apexY, cx, cz) {
    const n = worldXZ.length;
    const pos = [];
    const roofH = apexY - springY;

    // Footprint principal axis (direction of maximum spread) via the 2×2
    // covariance eigen-angle — the ridge/slope runs along this long axis.
    const principalAxis = () => {
      let sxx = 0, szz = 0, sxz = 0;
      for (const [x, z] of worldXZ) { const dx = x - cx, dz = z - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
      const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      return [Math.cos(theta), Math.sin(theta)];
    };
    const projRange = (dx, dz) => {
      let tMin = Infinity, tMax = -Infinity;
      for (const [x, z] of worldXZ) { const t = (x - cx) * dx + (z - cz) * dz; if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
      return [tMin, tMax];
    };

    if (shape === 'gabled' || shape === 'gambrel') {
      const [dx, dz] = principalAxis();
      const [tMin, tMax] = projRange(dx, dz);
      for (let i = 0; i < n; i++) {
        const [ax, az] = worldXZ[i];
        const [bx, bz] = worldXZ[(i + 1) % n];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        let t = (mx - cx) * dx + (mz - cz) * dz;
        t = Math.max(tMin, Math.min(tMax, t));       // ridge point above the edge
        pos.push(ax, springY, az, bx, springY, bz, cx + dx * t, apexY, cz + dz * t);
      }
      return pos;
    }

    if (shape === 'skillion') {
      const [dx, dz] = principalAxis();
      const [tMin, tMax] = projRange(dx, dz);
      const span = (tMax - tMin) || 1;
      const hAt = (x, z) => springY + (((x - cx) * dx + (z - cz) * dz) - tMin) / span * roofH;
      const cH = springY + roofH * 0.5;
      for (let i = 0; i < n; i++) {
        const [ax, az] = worldXZ[i];
        const [bx, bz] = worldXZ[(i + 1) % n];
        pos.push(ax, hAt(ax, az), az, bx, hAt(bx, bz), bz, cx, cH, cz);
      }
      return pos;
    }

    // Hip / pyramidal / dome / conical / mansard / default: apex fan to one peak.
    for (let i = 0; i < n; i++) {
      const [ax, az] = worldXZ[i];
      const [bx, bz] = worldXZ[(i + 1) % n];
      pos.push(ax, springY, az, bx, springY, bz, cx, apexY, cz);
    }
    return pos;
  }

  // Parse a CSS-style hex colour ("#a0522d") to a 0xRRGGBB int, or null.
  static _parseHexColour(v) {
    if (!v) return null;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v).trim());
    return m ? parseInt(m[1], 16) : null;
  }

  // Download vector map features inside the terrain bbox from Overpass. Returns a
  // compact, serialisable structure { lines, areas, buildings } so it can be
  // cached. Parsed once here; rendering happens in _buildMapFeatures.
  async _fetchMapFeatures(bbox, onProgress) {
    const s = bbox.minLat.toFixed(5), w = bbox.minLng.toFixed(5);
    const n = bbox.maxLat.toFixed(5), e = bbox.maxLng.toFixed(5);
    const bb = `${s},${w},${n},${e}`;
    const q = `[out:json][timeout:30];(` +
      `way["highway"](${bb});` +
      `way["waterway"](${bb});` +
      `way["natural"~"water|wood|scrub|heath|grassland|wetland|mud|saltmarsh|bare_rock|scree|sand|shingle"](${bb});` +
      `way["water"](${bb});` +
      `way["wetland"](${bb});` +
      `way["tidal"="yes"](${bb});` +
      `way["landuse"](${bb});` +
      `way["leisure"~"park|garden|nature_reserve|golf_course|pitch|recreation_ground|common"](${bb});` +
      `way["building"](${bb});` +
      `way["building:part"](${bb});` +
      // Point landmarks (Plan §III-1): peaks, notable trees, towers/masts,
      // viewpoints and monuments become directional 3D models.
      `node["natural"~"peak|volcano|saddle|tree"](${bb});` +
      `node["man_made"~"tower|mast|communications_tower|water_tower|lighthouse|chimney"](${bb});` +
      `node["tourism"~"viewpoint|attraction|artwork"](${bb});` +
      `node["historic"~"monument|memorial|castle|ruins|archaeological_site"](${bb});` +
      `relation["natural"~"water|wetland"](${bb});` +
      `relation["landuse"~"forest|reservoir|basin"](${bb});` +
      `relation["leisure"~"park|nature_reserve"](${bb});` +
      `);out geom 6000;`;

    onProgress?.(0.1);
    const encoded = encodeURIComponent(q);
    // Try each Overpass mirror in turn so one being rate-limited / down doesn't
    // blank the whole feature layer.
    let data = null;
    let lastErr = null;
    for (const api of OVERPASS_APIS) {
      if (this._aborted) throw new Error('aborted');
      try {
        // Per-mirror timeout kept modest so falling through several mirrors can't
        // stall the (blocking) feature download for too long.
        const resp = await this._fetchWithTimeout(`${api}?data=${encoded}`, this._abortController?.signal, 18000);
        if (!resp.ok) { lastErr = new Error(`Overpass ${resp.status}`); continue; }
        data = await resp.json();
        break;
      } catch (err) {
        if (this._aborted) throw err;
        lastErr = err;
      }
    }
    if (!data) throw lastErr || new Error('Overpass failed');
    onProgress?.(0.8);

    const lines = [];
    const areas = [];
    const buildings = [];
    const points = [];
    const ringFrom = (geom) => geom.filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lon)).map((g) => [g.lat, g.lon]);

    for (const el of data.elements || []) {
      const tags = el.tags || {};
      const name = TerrainViewer._featureName(tags);

      // Point landmarks (nodes) are classified separately — _classifyFeature only
      // handles line/area/building ways, so nodes must be routed before it.
      if (el.type === 'node') {
        if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
        const pcat = TerrainViewer._classifyPoint(tags);
        if (pcat) {
          points.push({
            cls: pcat.cls, name, lat: el.lat, lon: el.lon,
            h: TerrainViewer._parseLengthM(tags.height ?? tags['building:height']),
          });
        }
        continue;
      }

      const cat = TerrainViewer._classifyFeature(tags);
      if (!cat) continue;

      if (el.type === 'way' && Array.isArray(el.geometry)) {
        const pts = ringFrom(el.geometry);
        if (cat.group === 'line') {
          if (pts.length >= 2) lines.push({ kind: cat.kind, cls: cat.cls, name, pts });
        } else if (cat.group === 'building') {
          if (pts.length >= 4) buildings.push({
            name, ring: pts,
            h: TerrainViewer._buildingHeight(tags),
            minH: TerrainViewer._buildingMinHeight(tags),
            roof: TerrainViewer._roofInfo(tags),
            part: cat.cls === 'part',
          });
        } else {
          if (pts.length >= 4) areas.push({ kind: cat.kind, cls: cat.cls, name, rings: [pts] });
        }
      } else if (el.type === 'relation' && Array.isArray(el.members) && cat.group === 'area') {
        const outers = [];
        const inners = [];
        for (const m of el.members) {
          if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
          const r = ringFrom(m.geometry);
          if (r.length >= 4) (m.role === 'inner' ? inners : outers).push(r);
        }
        for (const outer of outers) areas.push({ kind: cat.kind, cls: cat.cls, name, rings: [outer, ...inners] });
      }
    }

    onProgress?.(1);
    return { lines, areas, buildings, points };
  }

  // --- Clip vector features to the terrain bbox -------------------------------
  // Overpass returns the full geometry of any way/relation that merely touches
  // the query box, so features routinely extend far past the downloaded area.
  // Draping those out-of-bounds vertices samples clamped edge elevations, so
  // they sprawl beyond the terrain mesh and badly distort the scene. Clipping
  // every line/ring to the bbox keeps the rendered features inside the model and
  // makes their footprint match the 2D map. Coordinates are [lat, lng]; the box
  // is lat∈[minLat,maxLat], lng∈[minLng,maxLng].

  // Liang–Barsky clip of one segment a→b. Returns the clipped endpoints plus
  // whether each end was cut (so a polyline can be split into runs at the
  // boundary), or null when the segment lies entirely outside the box.
  _clipSegmentToBbox(a, b, bbox) {
    const x0 = a[1], y0 = a[0];
    const dx = b[1] - a[1], dy = b[0] - a[0];
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - bbox.minLng, bbox.maxLng - x0, y0 - bbox.minLat, bbox.maxLat - y0];
    let t0 = 0, t1 = 1;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) return null; // parallel to this edge and on its outside
      } else {
        const r = q[k] / p[k];
        if (p[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
    }
    return {
      a2: [a[0] + dy * t0, a[1] + dx * t0],
      b2: [a[0] + dy * t1, a[1] + dx * t1],
      enter: t0 > 0,
      exit: t1 < 1,
    };
  }

  // Clip a polyline to the bbox, returning an array of in-bounds sub-polylines
  // (a line can leave and re-enter the rectangle).
  _clipPolylineToBbox(pts, bbox) {
    const runs = [];
    let cur = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = this._clipSegmentToBbox(pts[i], pts[i + 1], bbox);
      if (!seg) { if (cur && cur.length >= 2) runs.push(cur); cur = null; continue; }
      if (!cur || seg.enter) {
        if (cur && cur.length >= 2) runs.push(cur);
        cur = [seg.a2, seg.b2];
      } else {
        cur.push(seg.b2);
      }
      if (seg.exit) { if (cur.length >= 2) runs.push(cur); cur = null; }
    }
    if (cur && cur.length >= 2) runs.push(cur);
    return runs;
  }

  // Sutherland–Hodgman clip of a polygon ring (open, list of [lat,lng]) against
  // the bbox rectangle. Returns the clipped ring (possibly empty).
  _clipRingToBbox(ring, bbox) {
    if (!ring || ring.length < 3) return [];
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const clip = (poly, inside, cross) => {
      if (!poly.length) return poly;
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const cur = poly[i];
        const prev = poly[(i + poly.length - 1) % poly.length];
        const curIn = inside(cur), prevIn = inside(prev);
        if (curIn) {
          if (!prevIn) out.push(cross(prev, cur));
          out.push(cur);
        } else if (prevIn) {
          out.push(cross(prev, cur));
        }
      }
      return out;
    };
    let p = ring;
    p = clip(p, (q) => q[1] >= bbox.minLng, (a, b) => lerp(a, b, (bbox.minLng - a[1]) / (b[1] - a[1])));
    p = clip(p, (q) => q[1] <= bbox.maxLng, (a, b) => lerp(a, b, (bbox.maxLng - a[1]) / (b[1] - a[1])));
    p = clip(p, (q) => q[0] >= bbox.minLat, (a, b) => lerp(a, b, (bbox.minLat - a[0]) / (b[0] - a[0])));
    p = clip(p, (q) => q[0] <= bbox.maxLat, (a, b) => lerp(a, b, (bbox.maxLat - a[0]) / (b[0] - a[0])));
    return p;
  }

  // Category label for a landmark node that carries no OSM name, so unnamed
  // peaks/towers/viewpoints still get an on-model name in 3D. Peaks/saddles add
  // the terrain-sampled elevation so nearby summits stay distinguishable.
  _fallbackLandmarkName(cls, lat, lon) {
    if (cls === 'peak' || cls === 'saddle') {
      const base = cls === 'peak' ? '山峰' : '鞍部';
      const e = typeof this._sampleGridElevation === 'function' ? this._sampleGridElevation(lat, lon) : null;
      return Number.isFinite(e) ? `${base} ${Math.round(e)} m` : base;
    }
    const names = {
      tower: '高塔',
      lighthouse: '燈塔',
      chimney: '煙囪',
      viewpoint: '觀景點',
      monument: '紀念地標',
    };
    return names[cls] || null;
  }

  // Build a small procedural 3D model for an OSM point landmark (Plan §III-1).
  // Feet sit at the group origin (y = 0) and the model grows upward; the caller
  // drapes it onto the terrain. Symbolic (marker-scale, ms) rather than physically
  // sized, matching the viewer's other markers so it stays visible at any zoom.
  _buildPointModel(cls, ms, realH) {
    const g = new THREE.Group();
    const add = (mesh, y) => { mesh.castShadow = true; if (y != null) mesh.position.y = y; g.add(mesh); return mesh; };

    if (cls === 'tree') {
      const trunkH = 5 * ms;
      add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.8 * ms, 1.1 * ms, trunkH, 8),
        new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 })
      ), trunkH / 2);
      const foliMat = new THREE.MeshStandardMaterial({ color: 0x3f7d34, roughness: 0.85, flatShading: true });
      add(new THREE.Mesh(new THREE.ConeGeometry(4 * ms, 7 * ms, 9), foliMat), trunkH + 2.5 * ms);
      add(new THREE.Mesh(new THREE.ConeGeometry(2.8 * ms, 5 * ms, 9), foliMat), trunkH + 6 * ms);
      return g;
    }

    if (cls === 'peak' || cls === 'saddle') {
      const cairnH = (cls === 'peak' ? 7 : 4) * ms;
      add(new THREE.Mesh(
        new THREE.ConeGeometry(4 * ms, cairnH, 6),
        new THREE.MeshStandardMaterial({ color: 0x8a8079, roughness: 0.95, flatShading: true })
      ), cairnH / 2);
      const poleH = 6 * ms;
      add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.35 * ms, 0.35 * ms, poleH, 6),
        new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5 })
      ), cairnH + poleH / 2);
      // Triangular red pennant near the pole top.
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(2 * ms, 3.4 * ms, 3),
        new THREE.MeshStandardMaterial({ color: 0xe23b3b, emissive: 0x3a0000, emissiveIntensity: 0.3, side: THREE.DoubleSide })
      );
      flag.rotation.z = -Math.PI / 2;
      flag.position.set(1.6 * ms, cairnH + poleH - 1.4 * ms, 0);
      flag.castShadow = true;
      g.add(flag);
      return g;
    }

    if (cls === 'tower' || cls === 'lighthouse' || cls === 'chimney') {
      // Height nudged by a tagged real height but kept in a visible symbolic band.
      const h = Math.max(12 * ms, Math.min(Number.isFinite(realH) && realH > 0 ? realH * ms * 0.3 : 16 * ms, 30 * ms));
      const isLh = cls === 'lighthouse';
      add(new THREE.Mesh(
        new THREE.CylinderGeometry(1.4 * ms, 2.2 * ms, h, 12),
        new THREE.MeshStandardMaterial({ color: isLh ? 0xf2f2f2 : 0x9aa0a8, roughness: 0.7, flatShading: true })
      ), h / 2);
      if (isLh) {
        // Red band + an emissive lamp on top.
        add(new THREE.Mesh(
          new THREE.CylinderGeometry(1.55 * ms, 1.7 * ms, h * 0.18, 12),
          new THREE.MeshStandardMaterial({ color: 0xd63b3b, roughness: 0.6 })
        ), h * 0.6);
        add(new THREE.Mesh(
          new THREE.SphereGeometry(1.5 * ms, 12, 8),
          new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffcc44, emissiveIntensity: 0.9 })
        ), h + 1.2 * ms);
      }
      return g;
    }

    // Generic signpost (viewpoint / attraction / artwork / monument).
    const poleH = 8 * ms;
    add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.4 * ms, 0.4 * ms, poleH, 6),
      new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 })
    ), poleH / 2);
    const sign = add(new THREE.Mesh(
      new THREE.BoxGeometry(6 * ms, 3.2 * ms, 0.5 * ms),
      new THREE.MeshStandardMaterial({ color: 0x3f6f8f, emissive: 0x0a1a26, emissiveIntensity: 0.25, roughness: 0.6 })
    ), poleH + 1.2 * ms);
    sign.position.z = 0; // faces +z (travel/view direction)
    return g;
  }

  // Render the parsed map features into this.featureGroup (geometry) and
  // this.featureLabelGroup (names). Everything is draped onto the rendered
  // terrain surface so it sits on the ground.
  _buildMapFeatures(data, bbox) {
    if (!data || !this.scene) return;
    this.featureGroup = new THREE.Group();
    this.featureLabelGroup = new THREE.Group();
    this.landmarkGroup = new THREE.Group();
    this.scene.add(this.featureGroup);
    this.scene.add(this.featureLabelGroup);
    this.scene.add(this.landmarkGroup);

    const ms = this._markerScale || 1;
    const range = Math.max(1, this._fieldMaxV - this._fieldMinV);
    const baseLift = Math.max(2, range * 0.004);
    const dLatCell = (bbox.maxLat - bbox.minLat) / (FIELD_SIZE - 1);
    const dLngCell = (bbox.maxLng - bbox.minLng) / (FIELD_SIZE - 1);

    // Drape a lat/lng onto the terrain surface.
    const world = (lat, lng, lift) => {
      const elev = this._sampleGridElevation(lat, lng);
      const p = this._latLngToLocal(lat, lng, elev + lift, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    };

    // ----- Lines (roads + waterways), batched per style for few draw calls -----
    const LINE_STYLE = {
      major:  { color: 0xf2b134, width: 3.0, opacity: 0.95, lift: baseLift * 1.6 },
      minor:  { color: 0xe9e3d4, width: 2.0, opacity: 0.9,  lift: baseLift * 1.4 },
      trail:  { color: 0xcf8a4a, width: 1.6, opacity: 0.85, lift: baseLift * 1.3 },
      river:  { color: 0x35a3ff, width: 2.8, opacity: 0.92, lift: baseLift * 0.9 },
      stream: { color: 0x73c2ff, width: 1.7, opacity: 0.85, lift: baseLift * 0.9 },
    };
    const buckets = {};
    const drapeLine = (pts, lift) => {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [la, lo] = pts[i];
        const [lb, lob] = pts[i + 1];
        const steps = Math.min(14, Math.max(1, Math.ceil(Math.max(Math.abs(lb - la) / dLatCell, Math.abs(lob - lo) / dLngCell))));
        for (let st = 0; st < steps; st++) {
          const t = st / steps;
          out.push(world(la + (lb - la) * t, lo + (lob - lo) * t, lift));
        }
      }
      out.push(world(pts[pts.length - 1][0], pts[pts.length - 1][1], lift));
      return out;
    };
    const labelCands = [];
    // `key` (optional) is the dedupe identity: named features dedupe on the name
    // (so the same road/peak name appearing twice yields one label), but generic
    // fallback names ("山峰", "觀景點", …) pass a position-based key so several
    // unnamed landmarks don't all collapse into a single shared label.
    const pushLabelCand = (name, pos, color, pri, key) => {
      if (name) labelCands.push({ name, pos, color, pri, key: key || name });
    };

    for (const ln of (data.lines || [])) {
      const style = LINE_STYLE[ln.cls] || LINE_STYLE.minor;
      const key = ln.cls;
      let labelMid = null;
      let labelLen = -1;
      // Clip to the terrain box so a road/river only partly inside the area
      // doesn't shoot a long segment off the edge of the model, then break the
      // clipped run at any terrain holes so nothing drapes across blank tiles.
      const clippedRuns = this._clipPolylineToBbox(ln.pts, bbox)
        .flatMap((run) => this._splitPolylineAtHoles(run));
      for (const run of clippedRuns) {
        const w = drapeLine(run, style.lift);
        if (w.length < 2) continue;
        const verts = (buckets[key] = buckets[key] || []);
        for (let i = 0; i < w.length - 1; i++) {
          verts.push(w[i].x, w[i].y, w[i].z, w[i + 1].x, w[i + 1].y, w[i + 1].z);
        }
        if (w.length > labelLen) { labelLen = w.length; labelMid = w[Math.floor(w.length / 2)]; }
      }
      if (labelMid) {
        const pri = ln.kind === 'water' ? (ln.cls === 'river' ? 1 : 7) : (ln.cls === 'major' ? 3 : (ln.cls === 'trail' ? 7 : 5));
        pushLabelCand(ln.name, labelMid.clone().setY(labelMid.y + 10 * ms), ln.kind === 'water' ? 0x9fd8ff : 0xffd27a, pri);
      }
    }
    for (const key of Object.keys(buckets)) {
      const verts = buckets[key];
      if (!verts.length) continue;
      const style = LINE_STYLE[key];
      const geo = new LineSegmentsGeometry();
      geo.setPositions(verts);
      const mat = new LineMaterial({ color: style.color, linewidth: style.width, transparent: true, opacity: style.opacity });
      const seg = new LineSegments2(geo, mat);
      seg.computeLineDistances();
      this.featureGroup.add(seg);
      this._lineMaterials.push(mat);
    }

    // ----- Land cover -----
    // Green (山林) / soil (土黃) / urban (灰) cover is painted directly INTO the
    // terrain surface (per-vertex, gradiented by altitude) by _applyLandCoverColors
    // — not as a translucent sheet over it — so the relief reads as coloured
    // ground. Only water/wetland keep a draped translucent surface (they aren't
    // terrain). Building footprints feed the urban-density classification too.
    this._applyLandCoverColors(data.areas, data.buildings, bbox);

    const AREA_STYLE = {
      water:   { color: 0x2b86d9, opacity: 0.62, outline: 0x6fc0ff, lift: baseLift * 0.6,  labelColor: 0x9fd8ff, pri: 0 },
      // 濕地 (潮間帶 / 沼澤) — a muddy teal-green, distinct from open blue water.
      wetland: { color: 0x4f8f78, opacity: 0.5,  outline: 0x8fd6bb, lift: baseLift * 0.55, labelColor: 0xade8cf, pri: 1 },
      forest:  { labelColor: 0x9be07a, pri: 2 },
      grass:   { labelColor: 0xc7f29a, pri: 2 },
      waste:   { labelColor: 0xe6d3a0, pri: 4 },
      urban:   { labelColor: 0xe2dccf, pri: 5 },
    };
    const localXZ = (lat, lng) => {
      const p = this._latLngToLocal(lat, lng, 0, bbox);
      return new THREE.Vector2(p.x, p.z); // ground-plane (x, z) for triangulation
    };
    for (const ar of (data.areas || [])) {
      const style = AREA_STYLE[ar.cls] || AREA_STYLE.grass;
      // Families baked into the terrain skip the overlay fill + outline; they only
      // contribute a name label. Water (and anything unbaked) draws a surface.
      const baked = !!TerrainViewer._landCoverFamily(ar.cls);
      const rings = ar.rings || [];
      if (!rings.length || rings[0].length < 3) continue;

      // Build the 2D contour + holes (deduping a closed ring's repeated last pt).
      const toShape2D = (ring) => {
        const r = ring.slice();
        if (r.length > 1) {
          const a = r[0], b = r[r.length - 1];
          if (a[0] === b[0] && a[1] === b[1]) r.pop();
        }
        return r;
      };
      // Clip the outer contour and any holes to the terrain box so the fill
      // doesn't spill past the model onto clamped edge elevations.
      const outer = this._clipRingToBbox(toShape2D(rings[0]), bbox);
      if (outer.length < 3) continue;
      const holes = rings.slice(1)
        .map((r) => this._clipRingToBbox(toShape2D(r), bbox))
        .filter((h) => h.length >= 3);

      if (!baked) {
        const contour2D = outer.map(([la, lo]) => localXZ(la, lo));
        const holes2D = holes.map((h) => h.map(([la, lo]) => localXZ(la, lo)));
        let faces;
        try { faces = THREE.ShapeUtils.triangulateShape(contour2D, holes2D); } catch { faces = null; }
        if (faces && faces.length) {
          // Combined vertex list (contour then holes), draped per-vertex so the
          // fill hugs the terrain; translucent so any interior bump reads.
          const combinedLL = [...outer, ...holes.flat()];
          const verts3D = combinedLL.map(([la, lo]) => world(la, lo, style.lift));
          // Per-vertex hole flags: any triangle touching a terrain hole is dropped
          // so the fill stops at the real terrain edge instead of sheeting down to
          // the basin floor across blank tiles.
          const combinedHole = combinedLL.map(([la, lo]) => this._isOverHole(la, lo));
          const positions = [];
          for (const f of faces) {
            if (f.some((idx) => combinedHole[idx])) continue;
            for (const idx of f) {
              const v = verts3D[idx];
              if (v) positions.push(v.x, v.y, v.z);
            }
          }
          if (positions.length) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geo.computeVertexNormals();
            const mat = new THREE.MeshStandardMaterial({
              color: style.color, transparent: true, opacity: style.opacity,
              roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
              depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.renderOrder = 1;
            this.featureGroup.add(mesh);
          }
        }

        // Outline — split at holes so it traces only the on-terrain part of the ring.
        const ov = [];
        for (const seg of this._splitPolylineAtHoles([...outer, outer[0]])) {
          const ow = drapeLine(seg, style.lift + baseLift * 0.4);
          for (let i = 0; i < ow.length - 1; i++) ov.push(ow[i].x, ow[i].y, ow[i].z, ow[i + 1].x, ow[i + 1].y, ow[i + 1].z);
        }
        if (ov.length >= 6) {
          const geo = new LineSegmentsGeometry();
          geo.setPositions(ov);
          const mat = new LineMaterial({ color: style.outline, linewidth: 1.4, transparent: true, opacity: 0.65 });
          const seg = new LineSegments2(geo, mat);
          seg.computeLineDistances();
          this.featureGroup.add(seg);
          this._lineMaterials.push(mat);
        }
      }

      // Label at the ring centroid (skipped if that point is over a hole).
      let cla = 0, clo = 0;
      for (const [la, lo] of outer) { cla += la; clo += lo; }
      cla /= outer.length; clo /= outer.length;
      if (!this._isOverHole(cla, clo)) {
        const labelLift = (baked ? baseLift * 0.8 : style.lift) + 14 * ms;
        pushLabelCand(ar.name, world(cla, clo, labelLift), style.labelColor, style.pri);
      }
    }

    // ----- Buildings: extruded footprints, largest first, capped -----
    const ringArea = (ring) => {
      let a = 0;
      for (let i = 0; i < ring.length - 1; i++) a += ring[i][1] * ring[i + 1][0] - ring[i + 1][1] * ring[i][0];
      return Math.abs(a) / 2;
    };
    const blds = (data.buildings || [])
      .map((b) => ({ ...b, _a: ringArea(b.ring) }))
      .sort((a, b) => b._a - a._a)
      .slice(0, 350);
    // OSM "Simple 3D Buildings" rule: when a footprint is broken into building:part
    // volumes, the parent building=* outline must NOT be extruded too (the parts
    // define the 3D mass), otherwise the full-height parent box double-renders
    // behind them and z-fights. Collect part centroids once; a parent whose
    // footprint contains any part is rendered as a label only.
    const ringCentroidLL = (ring) => {
      let la = 0, lo = 0;
      for (const [a, o] of ring) { la += a; lo += o; }
      return [la / ring.length, lo / ring.length];
    };
    const partCentroids = blds.filter((b) => b.part).map((b) => ringCentroidLL(b.ring));
    const hasSubParts = (ring) => partCentroids.length > 0 && partCentroids.some(([la, lo]) => this._pointInRing(la, lo, ring));
    const bldMat = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    // Default roof material for tagged pitched roofs (Plan §III) — a muted clay
    // that reads distinctly from the grey walls. Coloured roofs get their own.
    const roofMatDefault = new THREE.MeshStandardMaterial({ color: 0x8f6b57, roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    const elevScale = this._elevScale || 1;
    for (const b of blds) {
      let ring = b.ring.slice();
      if (ring.length > 1) {
        const a = ring[0], z = ring[ring.length - 1];
        if (a[0] === z[0] && a[1] === z[1]) ring.pop();
      }
      // Drop / clip footprints that fall outside the terrain box.
      ring = this._clipRingToBbox(ring, bbox);
      if (ring.length < 3) continue;
      // Drop footprints over a terrain hole — there's no ground to stand on, so
      // they'd otherwise float at the basin floor in blank space.
      if (ring.some(([la, lo]) => this._isOverHole(la, lo))) continue;

      // Parent shell that is subdivided into building:parts → render only its
      // label; the parts (looped separately) carry the 3D mass.
      const shellOnly = !b.part && hasSubParts(ring);

      // Precompute footprint world (x, z), the shape (in x,-z), the ground datum
      // and the footprint's smallest plan dimension (for a default roof pitch).
      const shape = new THREE.Shape();
      const worldXZ = [];
      let baseY = Infinity;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      let cx = 0, cz = 0;
      ring.forEach(([la, lo], i) => {
        const p = this._latLngToLocal(la, lo, 0, bbox);
        if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
        worldXZ.push([p.x, p.z]);
        cx += p.x; cz += p.z;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
        // Elevation datum uses TRUE metres; the ground the building stands on is
        // that datum lifted by the vertical render scale (so normalised terrain
        // doesn't bury the footprint), while the building keeps its true height.
        const e = this._sampleGridElevation(la, lo) - (this._elevBase || 0);
        if (e < baseY) baseY = e;
      });
      if (!Number.isFinite(baseY)) continue;
      cx /= worldXZ.length; cz /= worldXZ.length;
      const groundY = baseY * elevScale;

      // Stepped massing: a raised part / upper floor starts at min_height and the
      // walls rise to the roof spring line (or the full height when flat-topped).
      const totalH = Math.max(2, b.h);
      const minH = Math.max(0, Math.min(b.minH || 0, totalH - 1));
      const roof = b.roof || null;
      const planDim = Math.max(1, Math.min(maxX - minX, maxZ - minZ));
      let roofH = 0;
      if (roof) {
        roofH = Number.isFinite(roof.height) && roof.height > 0
          ? roof.height
          : Math.max(2, Math.min(planDim * 0.35, 8));   // default pitch from footprint
        roofH = Math.min(roofH, (totalH - minH) * 0.6);  // never eat the whole wall
      }
      const wallTopM = totalH - roofH;                   // spring line (metres above ground)
      const wallDepth = Math.max(0.5, wallTopM - minH);

      if (!shellOnly) {
        let geo = null;
        try { geo = new THREE.ExtrudeGeometry(shape, { depth: wallDepth, bevelEnabled: false }); } catch { geo = null; }
        if (geo) {
          geo.rotateX(-Math.PI / 2);
          geo.translate(0, groundY + minH, 0);
          const mesh = new THREE.Mesh(geo, bldMat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.featureGroup.add(mesh);

          // Pitched roof (Plan §III-4): shape-specialised cap — a ridge for
          // gabled roofs, a mono-pitch plane for skillion, else a hip/pyramidal
          // apex fan. All are built from the wall-top ring so they stay valid on
          // messy OSM footprints without a full straight-skeleton's artefacts.
          if (roofH > 0.5 && worldXZ.length >= 3) {
            const springY = groundY + wallTopM;
            const apexY = groundY + totalH;
            const pos = TerrainViewer._roofPositions(roof.shape, worldXZ, springY, apexY, cx, cz);
            const rgeo = new THREE.BufferGeometry();
            rgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            rgeo.computeVertexNormals();
            const rmat = roof.colour != null
              ? new THREE.MeshStandardMaterial({ color: roof.colour, roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide })
              : roofMatDefault;
            const rmesh = new THREE.Mesh(rgeo, rmat);
            rmesh.castShadow = true;
            rmesh.receiveShadow = true;
            this.featureGroup.add(rmesh);
          }
        }
      }

      if (b.name && b._a > 0 && !b.part) {
        pushLabelCand(b.name, new THREE.Vector3(cx, groundY + totalH + 4 * ms, cz), 0xcfcabf, 6);
      }
    }

    // ----- Point landmarks: peaks / trees / towers / viewpoints (Plan §III-1) -----
    // Each mapped node becomes a small directional 3D model draped on the terrain.
    // Totals are capped (and trees capped harder) so a park full of individually
    // mapped trees can't spawn thousands of meshes.
    const allPoints = data.points || [];
    const nonTree = allPoints.filter((p) => p.cls !== 'tree');
    const trees = allPoints.filter((p) => p.cls === 'tree');
    for (const p of [...nonTree.slice(0, 120), ...trees.slice(0, 60)]) {
      const { lat, lon } = p;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLng || lon > bbox.maxLng) continue;
      if (this._isOverHole(lat, lon)) continue;
      const model = this._buildPointModel(p.cls, ms, p.h);
      if (!model) continue;
      model.position.copy(world(lat, lon, baseLift));
      this.landmarkGroup.add(model);
      // Label landmarks (skip trees — they'd flood the label layer). Named nodes
      // use their OSM name; unnamed peaks/towers/viewpoints/… fall back to a
      // category label (peaks carry their elevation) so no 3D indicator is left
      // nameless. Fallback labels sort after named ones (pri + 3) so the label
      // cap fills real place names first, and use a position-based dedupe key so
      // multiple generic labels survive instead of collapsing into one.
      if (p.cls !== 'tree') {
        const color = (p.cls === 'peak' || p.cls === 'saddle') ? 0xffd9a0 : 0xd8e0ea;
        const pri = (p.cls === 'peak') ? 2 : 6;
        const labelPos = model.position.clone().setY(model.position.y + 16 * ms);
        if (p.name) {
          pushLabelCand(p.name, labelPos, color, pri);
        } else {
          const fb = this._fallbackLandmarkName(p.cls, lat, lon);
          if (fb) pushLabelCand(fb, labelPos, color, pri + 3, `${p.cls}@${lat.toFixed(4)},${lon.toFixed(4)}`);
        }
      }
    }

    // ----- Labels: dedupe by name, prioritise, cap, then build sprites -----
    const seen = new Set();
    labelCands.sort((a, b) => a.pri - b.pri);
    let made = 0;
    for (const c of labelCands) {
      if (made >= 70) break;
      const key = (c.key || c.name).trim();
      if (!c.name.trim() || seen.has(key)) continue;
      seen.add(key);
      const label = this._createLabel(key, c.pos.x, c.pos.y, c.pos.z, c.color);
      label.scale.set(46 * ms, 15 * ms, 1);
      this._registerLabel(label);
      this.featureLabelGroup.add(label);
      made++;
    }

    this.featureGroup.visible = this._featuresVisible;
    this.featureLabelGroup.visible = this._featuresVisible;
    this._applyLandmarkVisibility();
    this._updateLineResolutions();
  }

  _setupPlayer(coords, elevations, bbox) {
    if (!coords || coords.length < 2) return;
    const ms = this._markerScale || 1;

    const pts = coords.map(([lat, lng], i) => {
      const elev = elevations?.[i] ?? 0;
      const p = this._latLngToLocal(lat, lng, elev + 20, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    });

    this.playerPath = new THREE.CatmullRomCurve3(pts);
    this.playerMarker = null;   // no sphere — the inverted-cone cursor marks the spot

    // 3D position cursor: a single inverted cone (tip pointing down at the route
    // point) sitting just below the hiker. Half the previous marker size.
    this._cursorGroup = new THREE.Group();
    const coneH = 13 * ms;
    this._cursorHeight = coneH;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(6 * ms, coneH, 16),
      new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff5500, emissiveIntensity: 0.9 })
    );
    cone.rotation.x = Math.PI;        // apex points straight down at the point
    cone.position.y = coneH / 2;      // tip at the cursor-group origin (the point)
    this._cursorGroup.add(cone);
    this._cursorCone = cone;
    this.scene.add(this._cursorGroup);

    // Animated gingerbread/clay figure standing on the cursor cone. Built from
    // primitives with pivoting limbs so it can actually run.
    this._person = this._createPersonFigure(ms);
    this.scene.add(this._person);

    // Progress ring (half size).
    const ringGeo = new THREE.RingGeometry(6.5 * ms, 9 * ms, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    this.playerRing = new THREE.Mesh(ringGeo, ringMat);
    this.scene.add(this.playerRing);

    // Trail line behind player
    const trailMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.3 });
    const trailGeo = new THREE.BufferGeometry();
    this.playerTrail = new THREE.Line(trailGeo, trailMat);
    this.scene.add(this.playerTrail);

    this._progress = 0;
    this._updatePlayerPosition();

    // Remove existing player light if any
    if (this._playerLight) {
      this.scene.remove(this._playerLight);
    }
    this._playerLight = new THREE.PointLight(0xff6600, 0.5, Math.max(500, 600 * ms));
    this.scene.add(this._playerLight);
  }

  // A small gingerbread/clay figure built from primitives, with shoulder/hip
  // pivots so the arms and legs can swing for a real running gait. Feet sit at
  // the group origin (y=0) and the body grows upward; the group is placed on top
  // of the cursor cone and yawed to face the direction of travel. Dimensions are
  // in world units, scaled by the terrain's marker scale (ms).
  _createPersonFigure(ms) {
    const group = new THREE.Group();
    group.rotation.order = 'YXZ'; // yaw (face travel) before forward lean

    // Warm clay/gingerbread body with a touch of emissive so it stays readable
    // at night, plus white "icing" trims and small face/button details.
    const dough = new THREE.MeshStandardMaterial({ color: 0xb5742f, roughness: 0.85, metalness: 0.0, emissive: 0x4a2c10, emissiveIntensity: 0.3 });
    const icing = new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.55, emissive: 0x4a3a2a, emissiveIntensity: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.6 });
    const candy = new THREE.MeshStandardMaterial({ color: 0xd64545, roughness: 0.5, emissive: 0x3a0e0e, emissiveIntensity: 0.2 });

    const add = (mesh) => { mesh.castShadow = true; return mesh; };

    // Dimensions.
    const legR = 1.5 * ms, legLen = 6 * ms, legFull = legLen + legR * 2;
    const armR = 1.2 * ms, armLen = 5.5 * ms, armFull = armLen + armR * 2;
    // Shorter torso so the body no longer towers over the legs (was 7).
    const torsoR = 2.6 * ms, torsoLen = 3.6 * ms, torsoFull = torsoLen + torsoR * 2;
    const headR = 3.2 * ms;

    const hipY = legFull;                       // hips sit one leg-length up
    const shoulderY = hipY + torsoFull;         // top of torso
    const headY = shoulderY + headR * 0.75;

    // A limb that hangs from a pivot group placed at the joint, so rotating the
    // pivot about X swings the limb fore/aft.
    const makeLimb = (rad, len, mat) => {
      const pivot = new THREE.Group();
      const full = len + rad * 2;
      const mesh = add(new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 10), mat));
      mesh.position.y = -full / 2; // top of capsule at the pivot
      pivot.add(mesh);
      return pivot;
    };

    // Legs. Tucked in a little closer together so their rounded tops sit under
    // the pelvis below and there's no air gap at the hip.
    const legX = 1.45 * ms;
    const legL = makeLimb(legR, legLen, dough);
    const legR2 = makeLimb(legR, legLen, dough);
    legL.position.set(-legX, hipY, 0);
    legR2.position.set(legX, hipY, 0);
    // White icing cuffs at the feet.
    const footL = add(new THREE.Mesh(new THREE.SphereGeometry(legR * 1.15, 10, 8), icing));
    footL.position.y = -(legFull) + legR * 0.6; legL.add(footL);
    const footR = add(new THREE.Mesh(new THREE.SphereGeometry(legR * 1.15, 10, 8), icing));
    footR.position.y = -(legFull) + legR * 0.6; legR2.add(footR);
    group.add(legL, legR2);

    // Pelvis/hip bridging the torso bottom and the leg tops. Kept the SAME width
    // as the torso (never wider) and pushed low with a strong vertical overlap of
    // the torso's lower hemisphere, so the body→hip line reads as one continuous
    // dough form instead of a protruding "butt" with a hard seam. A gentle
    // vertical squash rounds the hips without bulging them out sideways.
    const pelvis = add(new THREE.Mesh(new THREE.SphereGeometry(torsoR, 16, 12), dough));
    pelvis.position.set(0, hipY + torsoR * 0.4, 0);
    pelvis.scale.set(1.0, 0.82, 1.0);
    group.add(pelvis);

    // Torso. Its lower hemisphere overlaps the pelvis above for a seamless join.
    const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(torsoR, torsoLen, 6, 14), dough));
    torso.position.y = hipY + torsoFull / 2;
    group.add(torso);

    // Buttons down the front (+z faces travel direction).
    for (let b = 0; b < 2; b++) {
      const btn = add(new THREE.Mesh(new THREE.SphereGeometry(0.7 * ms, 8, 6), candy));
      btn.position.set(0, hipY + torsoFull * (0.4 + b * 0.3), torsoR * 0.85);
      group.add(btn);
    }

    // Arms hanging from the shoulders.
    const armL = makeLimb(armR, armLen, dough);
    const armR3 = makeLimb(armR, armLen, dough);
    const shoX = torsoR + armR * 0.4;
    armL.position.set(-shoX, shoulderY - armR, 0);
    armR3.position.set(shoX, shoulderY - armR, 0);
    const handL = add(new THREE.Mesh(new THREE.SphereGeometry(armR * 1.1, 10, 8), icing));
    handL.position.y = -(armFull) + armR * 0.6; armL.add(handL);
    const handR = add(new THREE.Mesh(new THREE.SphereGeometry(armR * 1.1, 10, 8), icing));
    handR.position.y = -(armFull) + armR * 0.6; armR3.add(handR);
    group.add(armL, armR3);

    // Head + face (eyes look toward +z, the travel direction).
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(headR, 16, 14), dough));
    head.position.y = headY;
    group.add(head);
    for (const sx of [-1, 1]) {
      const eye = add(new THREE.Mesh(new THREE.SphereGeometry(0.5 * ms, 8, 6), dark));
      eye.position.set(sx * headR * 0.42, headY + headR * 0.12, headR * 0.82);
      group.add(eye);
    }
    const smile = add(new THREE.Mesh(new THREE.TorusGeometry(headR * 0.4, 0.28 * ms, 6, 12, Math.PI), dark));
    smile.rotation.x = Math.PI;            // open side up → a smile
    smile.position.set(0, headY - headR * 0.28, headR * 0.78);
    group.add(smile);

    this._personParts = { group, legL, legR: legR2, armL, armR: armR3 };
    return group;
  }

  _updatePlayerPosition() {
    if (!this.playerPath) return;

    // Arc-length parameterised so progress (and the readout) advances by
    // distance travelled, matching the mileage/altitude/time figures.
    const ms = this._markerScale || 1;
    const coneH = this._cursorHeight || 0;
    const pt = this.playerPath.getPointAt(this._clampU(this._progress));

    if (this._cursorGroup) {
      const bob = Math.sin(this._personPhase * 4) * 3 * ms;
      this._cursorGroup.position.set(pt.x, pt.y + bob, pt.z);
      if (this._cursorCone) this._cursorCone.rotation.y += 0.04;
    }

    if (this._person) {
      const parts = this._personParts;
      const phase = this._personPhase;
      const moving = this._playing;
      // Stride cadence rises with movement speed (personPhase advances by
      // dt*speed in _animate), and amplitude grows from a gentle idle sway to a
      // full run, so a faster route plays a faster gait.
      const cadence = 11;
      const amp = moving ? 0.95 : 0.06;
      const swing = Math.sin(phase * cadence);
      const bob = Math.abs(swing) * (moving ? 1.8 : 0.3) * ms;

      // Stand on top of the cursor cone.
      this._person.position.set(pt.x, pt.y + coneH + bob, pt.z);

      // Face the direction of travel (path tangent).
      const tan = this.playerPath.getTangentAt
        ? this.playerPath.getTangentAt(this._clampU(this._progress))
        : null;
      if (tan && (tan.x || tan.z)) this._person.rotation.y = Math.atan2(tan.x, tan.z);
      this._person.rotation.x = moving ? 0.2 : 0.0; // lean forward when running

      if (parts) {
        parts.legL.rotation.x = swing * amp;
        parts.legR.rotation.x = -swing * amp;
        parts.armL.rotation.x = -swing * amp * 0.9;
        parts.armR.rotation.x = swing * amp * 0.9;
      }
    }

    if (this.playerRing) {
      this.playerRing.position.copy(pt);
      this.playerRing.lookAt(this.camera.position);
    }

    if (this.playerTrail) {
      const trailCount = Math.floor(this._progress * 100);
      if (trailCount >= 2) {
        const trailPts = [];
        for (let i = Math.max(0, trailCount - 30); i <= trailCount; i++) {
          const t = i / 100;
          if (t <= this._progress) {
            trailPts.push(this.playerPath.getPointAt(this._clampU(t)));
          }
        }
        const trailGeo = new THREE.BufferGeometry().setFromPoints(trailPts);
        this.playerTrail.geometry.dispose();
        this.playerTrail.geometry = trailGeo;
      }
    }

    if (this._playerLight) {
      this._playerLight.position.copy(pt);
    }

    // Reveal the track up to the current position when trail mode is on.
    if (this._routeReveal) this._applyRouteReveal();

    const metrics = this._metricsAtProgress(this._progress);
    this._applyEnvironment(metrics);
    this._emitMetrics(false, metrics);
  }

  _clampU(u) {
    return Math.max(0, Math.min(1, u));
  }

  // Find the route vertex bracket + interpolation factor for a cumulative
  // distance, via binary search over the cumulative-distance array.
  _bracketByDist(cumDistM) {
    const D = this._distances;
    if (!D || D.length < 2) return { idx: 0, f: 0 };
    if (cumDistM <= D[0]) return { idx: 0, f: 0 };
    const last = D.length - 1;
    if (cumDistM >= D[last]) return { idx: last - 1, f: 1 };
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (D[mid] <= cumDistM) lo = mid; else hi = mid;
    }
    const span = D[hi] - D[lo];
    return { idx: lo, f: span > 0 ? (cumDistM - D[lo]) / span : 0 };
  }

  // Position-driven readout for the side HUD + the day/night animation.
  _metricsAtProgress(t) {
    const coords = this.routePoints;
    if (!coords || coords.length < 2 || !this._distances) {
      return { progress: t, dateMs: this._startMs };
    }
    const tt = this._clampU(t);
    const cumDistM = tt * this._totalDistM;
    const { idx, f } = this._bracketByDist(cumDistM);
    const j = Math.min(idx + 1, coords.length - 1);
    const lerp = (a, b) => a + (b - a) * f;

    const lat = lerp(coords[idx][0], coords[j][0]);
    const lng = lerp(coords[idx][1], coords[j][1]);
    const elev = this.routeElevations || [];
    const elevM = lerp(elev[idx] ?? 0, elev[j] ?? 0);
    const timeH = this._times ? lerp(this._times[idx] ?? 0, this._times[j] ?? 0) : null;
    const fatiguePct = this._fatigue ? lerp(this._fatigue[idx] ?? 0, this._fatigue[j] ?? 0) * 100 : null;

    // Smooth speed/grade over a small index window so single-segment noise
    // doesn't make the readout jump.
    const D = this._distances;
    const lo = Math.max(0, idx - 2);
    const hi = Math.min(D.length - 1, idx + 3);
    const wDist = D[hi] - D[lo];
    let speedKmh = null;
    if (this._times && wDist > 0) {
      const wTime = (this._times[hi] ?? 0) - (this._times[lo] ?? 0);
      if (wTime > 0) speedKmh = (wDist / 1000) / wTime;
    }
    const gradePct = wDist > 0 ? ((elev[hi] ?? 0) - (elev[lo] ?? 0)) / wDist * 100 : 0;

    const dateMs = (this._startMs != null && timeH != null) ? this._startMs + timeH * 3600000 : this._startMs;

    let weather = null;
    if (this._weatherPoints && this._weatherPoints.length) {
      let best = Infinity;
      let nearest = null;
      for (const pt of this._weatherPoints) {
        const c = pt.coords || (pt.lat != null ? [pt.lat, pt.lng] : null);
        if (!c) continue;
        const d = haversineDistance([lat, lng], c);
        if (d < best) { best = d; nearest = pt; }
      }
      if (nearest) {
        const code = nearest.weatherCode;
        weather = {
          code,
          cat: TerrainViewer.weatherCategory(code),
          icon: code != null ? TerrainViewer.weatherIcon(code) : '',
          temperature: nearest.temperature ?? nearest.temp ?? null,
        };
      }
    }

    return {
      progress: tt,
      lat,
      lng,
      distM: cumDistM,
      totalDistM: this._totalDistM,
      elevM,
      timeH,
      dateMs,
      speedKmh,
      gradePct,
      fatiguePct,
      weather,
    };
  }

  _emitMetrics(force, metrics) {
    if (!this._onMetrics) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!force && now - this._lastMetricsEmit < 80) return;
    this._lastMetricsEmit = now;
    this._onMetrics(metrics || this._metricsAtProgress(this._progress));
  }

  // Rebuild the whole model in place from the cached source data (no network),
  // re-baking the current vertical scale into the geometry. Used by the
  // normalization toggle. Preserves the camera pose, playback position and every
  // layer/visibility toggle so the rebuild is seamless.
  _rebuildScene() {
    if (!this.scene || !this._buildCtx) return;
    const { coords, elevations, waypoints, weatherPoints, bbox } = this._buildCtx;
    const prevView = (this.camera && this.controls)
      ? { pos: this.camera.position.clone(), target: this.controls.target.clone(), progress: this._progress }
      : null;
    const wasPlaying = this._playing;
    this._playing = false;
    if (wasPlaying && this._onPlayStateChange) this._onPlayStateChange(false);

    this._clearScene();
    this._createTerrain(bbox);
    if (this._contourPrecision !== 'none') this._createContours(bbox);
    this._createRoutePath(coords, elevations, bbox);
    this._createWaypoints(waypoints, bbox);
    this._createWeatherLabels(weatherPoints, bbox);
    this._setupPlayer(coords, elevations, bbox);
    this._setupEnvironment();
    if (this._featuresData) {
      try { this._buildMapFeatures(this._featuresData, bbox); } catch (err) { console.warn('map features failed:', err); }
    }

    // Reapply the persisted layer/label state to the freshly built objects.
    this.setLabelScale(this._labelScale);
    if (this.contourLabelGroup) {
      this.contourLabelGroup.visible = this._contourLabelsVisible && this._contourPrecision !== 'none';
    }
    if (this.weatherGroup) this.weatherGroup.visible = this._weatherVisible;
    if (this.featureGroup) this.featureGroup.visible = this._featuresVisible;
    if (this.featureLabelGroup) this.featureLabelGroup.visible = this._featuresVisible;
    this._applyLandmarkVisibility();

    if (prevView) {
      this.controls.target.copy(prevView.target);
      this.camera.position.copy(prevView.pos);
      this._progress = Math.max(0, Math.min(1, prevView.progress));
      this.controls.update();
    }
    this._updateLineResolutions();
    this._updatePlayerPosition();
    this._emitMetrics(true);
    if (this._onInfo) this._onInfo(this._terrainInfo);
  }

  _clearScene() {
    const toRemove = [];
    this.scene.traverse((child) => {
      if (child !== this.scene && child !== this.camera) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(child => {
      this.scene.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    this.waypointMarkers = [];
    this.weatherLabels = [];
    this._weatherIconEntries = [];
    this.terrainMesh = null;
    this.routeLine = null;
    this.routeTube = null;
    this._routeStemGroup = null;
    this._routeTubeSegs = 0;
    this._routeLineSegs = 0;
    this.contourGroup = null;
    this.contourLabelGroup = null;
    this.waypointLabelGroup = null;
    this.weatherGroup = null;
    this.featureGroup = null;
    this.featureLabelGroup = null;
    this.landmarkGroup = null;
    this._labelSprites = [];
    this._landCoverField = null;
    this._slopeField = null;
    this.playerMarker = null;
    this.playerRing = null;
    this.playerTrail = null;
    this.playerPath = null;
    this._person = null;
    this._personParts = null;
    this._cursorGroup = null;
    this._cursorCone = null;
    this._cursorHeight = 0;
    this._pickables = [];
    this._lineMaterials = [];
    this._sun = null;
    this._sunTarget = null;
    this._moon = null;
    this._ambient = null;
    this._hemi = null;
    this._rain = null;
    this._snow = null;
    // The rigs' GPU resources were freed by the traversal above; drop the handle
    // so update() no-ops until the next build grows fresh rigs.
    this._weather3d = null;
    this._playerLight = null;
    if (this.scene) this.scene.fog = null;
  }

  // Keep wide-line (LineMaterial) resolution in sync with the renderer, else the
  // pixel-width lines render at the wrong thickness or vanish.
  _updateLineResolutions() {
    if (!this.renderer || !this._lineMaterials.length) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    for (const m of this._lineMaterials) {
      if (m && m.resolution) m.resolution.set(size.x, size.y);
    }
  }

  _setupResizeHandler() {
    if (this._resizeHandler) return;
    const handler = () => {
      if (!this.container || !this.renderer) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this._updateLineResolutions();
    };
    window.addEventListener('resize', handler);
    this._resizeHandler = handler;
  }

  _animate() {
    if (!this.container || this.container.classList.contains('hidden')) return;
    if (!this.renderer || !this.scene || !this.camera) return;
    if (this._contextLost) return;

    this._animFrameId = requestAnimationFrame(() => this._animate());
    this.controls?.update();

    // One delta per frame (also avoids a progress jump after a long pause).
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (this._playing && this.playerPath) {
      this._personPhase += dt * this._speed;
      this._progress += dt * this._speed * 0.05;
      let reachedEnd = false;
      if (this._progress >= 1) {
        this._progress = 1;
        this._playing = false;
        reachedEnd = true;
      }
      this._updatePlayerPosition();
      if (this._onProgressChange) this._onProgressChange(this._progress);
      // The hiker walked to the end: stop playback and let the UI reset its
      // play/pause button.
      if (reachedEnd && this._onPlayStateChange) this._onPlayStateChange(false);
    }

    // Weather keeps moving even while paused so a scrubbed-to frame still reads
    // as "raining/snowing", but stays subtle enough not to mask the terrain.
    this._updateWeatherParticles(dt);
    // Drive the volumetric 3D weather phenomena anchored at each weather point
    // (cloud drift, falling rain/snow, swirling fog, lightning). Distant rigs are
    // culled inside update() so a long route stays cheap.
    if (this._weather3d) this._weather3d.update(dt, this.camera);

    this.renderer.render(this.scene, this.camera);
  }
}
