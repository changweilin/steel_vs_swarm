/**
 * Mapping Elf — Map Manager
 * Handles Leaflet map, layers, waypoints, multiple route polylines
 */
import L from 'leaflet';
import { interpolateRouteColor, interpolateReturnColor, cumulativeDistances } from './utils.js';
import { platform } from '../platform/index.js';

const TILE_LAYERS = {
  streets: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    cssClass: 'map-tiles-streets',
    provider: {
      id: 'carto-voyager',
      name: 'CARTO Voyager',
      attribution: '(c) OpenStreetMap contributors, (c) CARTO',
      homepage: 'https://carto.com/attribution/',
      offlineTileExport: {
        allowed: false,
        reason: '此圖層暫不支援離線圖磚匯出',
      },
    },
    options: {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
    },
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    cssClass: 'map-tiles-topo map-tiles-outdoor',
    provider: {
      id: 'opentopomap',
      name: 'OpenTopoMap',
      attribution: '(c) OpenTopoMap contributors',
      homepage: 'https://opentopomap.org/about',
      offlineTileExport: {
        allowed: false,
        reason: '此圖層暫不支援離線圖磚匯出',
      },
    },
    options: {
      attribution: '&copy; OpenTopoMap',
      maxZoom: 17,
    },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    cssClass: 'map-tiles-satellite',
    provider: {
      id: 'esri-world-imagery',
      name: 'Esri World Imagery',
      attribution: '(c) Esri',
      homepage: 'https://www.esri.com/',
      offlineTileExport: {
        allowed: false,
        reason: '此圖層暫不支援離線圖磚匯出',
      },
    },
    options: {
      attribution: '&copy; Esri',
      maxZoom: 19,
    },
  },
};

const DEFAULT_CENTER = [23.5, 121.0];
const DEFAULT_ZOOM = 8;
const MAP_TILE_THEMES = new Set(['dark', 'light']);
const OFFLINE_LAYER_PREFIX = 'offline:';
const TILE_LAYER_PERFORMANCE_OPTIONS = {
  updateWhenZooming: false,
  updateInterval: 180,
  keepBuffer: 3,
};
const TRANSPARENT_TILE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function normalizeMapTileTheme(themeName) {
  return MAP_TILE_THEMES.has(themeName) ? themeName : 'dark';
}

function getDocumentMapTileTheme() {
  return document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
}

function tileLayerClassName(name, config, themeName) {
  const theme = normalizeMapTileTheme(themeName);
  const layerClasses = [name, ...String(config.cssClass || '')
    .split(/\s+/)
    .map((value) => value.replace(/^map-tiles-/, ''))
    .filter(Boolean)];
  return [...new Set([
    'map-tiles',
    `map-tiles-${theme}`,
    ...layerClasses.flatMap((layerClass) => [
      `map-tiles-${layerClass}`,
      `map-tiles-${layerClass}-${theme}`,
    ]),
  ].filter(Boolean))]
    .join(' ');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function buildWeatherRoundIconHtml(icon) {
  const normalized = String(icon || '').replace(/\ufe0f/g, '');
  const map = {
    '☀': 'sun',
    '🌤': 'partly',
    '⛅': 'partly',
    '☁': 'cloud',
    '🌫': 'fog',
    '🌦': 'shower',
    '🌧': 'rain',
    '🌨': 'snow',
    '❄': 'snow',
    '⛈': 'storm',
    '❓': 'unknown',
  };
  const meta = { cls: map[normalized] || 'unknown', symbol: icon || '?' };
  return `<span class="weather-round-icon weather-round-icon--${meta.cls}" data-raw-icon="${escapeHtml(icon || '')}" aria-hidden="true">${escapeHtml(meta.symbol)}</span>`;
}

// Colors for alternative routes
const ROUTE_COLORS = ['#6ee7b7', '#60a5fa', '#f59e0b', '#f87171'];
const ROUTE_ALT_OPACITY = 0.4;
const ROUTE_SELECTED_OPACITY = 0.9;

// Max gradient chunks for the selected route polyline
const GRADIENT_CHUNKS = 80;
const ROUTE_HIT_WEIGHT = 22;
const STACKED_WAYPOINT_TOLERANCE_M = 30;
const ROUTE_OVERLAP_PROXIMITY_PX = {
  mouse: 18,
  touch: 28,
};
const ROUTE_LONG_PRESS_MOVE_TOLERANCE_PX = {
  mouse: 10,
  touch: 18,
};
const ROUTE_LAYER_DEBUG_KEY = 'mappingElfDebugRouteLayerCycle';
const WAYPOINT_DOUBLE_TAP_DELAY_MS = 360;
// Single-tap selection must wait longer than the double-tap window so double
// taps can resolve against the marker's pre-existing highlight state.
const WAYPOINT_SINGLE_TAP_DELAY_MS = WAYPOINT_DOUBLE_TAP_DELAY_MS + 40;
const WAYPOINT_DOUBLE_TAP_DISTANCE_PX = 30;
const WAYPOINT_TOUCH_TAP_MOVE_TOLERANCE_PX = 12;
const WAYPOINT_Z_BASE = 1300;
const WAYPOINT_Z_PAIR_STEP = 120;
const WAYPOINT_Z_SELECTED = 5000;
const WAYPOINT_PIN_HEIGHT_RATIO = 1.44;
const INTERMEDIATE_Z_OFFSET = -300;
const INTERMEDIATE_MARKER_SIZE = 18;
const HOVER_MARKER_SIZE = 10;

function waypointPinMetrics(size) {
  const height = Math.round(size * WAYPOINT_PIN_HEIGHT_RATIO);
  return {
    width: size,
    height,
    anchor: [size / 2, height],
  };
}

function waypointPinSvgHtml() {
  const pinPath = 'M18 1.7C9.05 1.7 1.8 8.95 1.8 17.9c0 12.35 16.2 32.4 16.2 32.4s16.2-20.05 16.2-32.4C34.2 8.95 26.95 1.7 18 1.7Z';
  return '<svg class="wp-pin-svg" viewBox="0 0 36 52" aria-hidden="true" focusable="false">' +
    `<path class="wp-pin-highlight-ring" d="${pinPath}"/>` +
    `<path class="wp-pin-body" d="${pinPath}"/>` +
    '<circle class="wp-pin-dot" cx="18" cy="17.9" r="8.1"/>' +
    '</svg>';
}

export class MapManager {
  constructor(containerId, onWaypointChange) {
    this.isFrozen = false; // Freeze map clicks and waypoint dragging
    this.onWaypointChange = onWaypointChange;
    this.onRouteSelect = null; // callback(index)
    this.onRouteHover = null; // callback(lat, lng) | callback(null, null)
    this.onWaypointSelect = null; // callback(wpIndex)
    this.onFrozenInteraction = null; // callback(reason)
    this.onWeatherBadgeClick = null; // callback(wpIndex)
    this.onWaypointDragEnd = null; // callback()
    this.isRoundTrip = false;
    this.turnaroundLatLng = null; // [lat,lng] of last forward waypoint for return-leg gradient split
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = []; // Weather emoji per waypoint index
    this.waypointColors = [];  // Gradient color strings per waypoint index
    this.waypointLabels = [];  // Custom labels for each waypoint index
    this.waypointMetadata = []; // Arbitrary metadata (ele, time, fileOrder) per waypoint index
    this.routePolylines = []; // Solid polylines for alternative routes
    this.gradientPolylines = []; // Gradient chunks for selected route
    this.routeHitPolyline = null; // Transparent selected-route interaction target
    this._overlapCycleState = new Map(); // Spatial leg-set key -> visible leg index
    this.selectedRouteIndex = 0;
    this.hoverMarker = null;
    this.currentLayerName = 'topo';
    this.currentTileTheme = getDocumentMapTileTheme();
    this.intermediateMarkers = [];
    this.returnWaypointMarkers = []; // Markers for round-trip return waypoints (same shape as outbound, dashed border)
    this.stackedWaypointFlags = []; // Per-waypoint flag: outbound marker shares lat/lng with a return marker
    this.waypointLayerSwapped = []; // true if outbound is on top of return at this index
    this.ignoreMapClick = false;
    this.dragLine = null;
    this.dragLine = null;
    this._dragWpIndex = undefined;
    this._lastMultiTouchAt = 0;
    this._blockMapClickTimer = null;
    this._activeWaypointGestureDepth = 0;
    this._activeWaypointDragDepth = 0;
    this._pendingWaypointIconUpdates = new Set();
    this._pendingAllWaypointIconUpdate = false;
    this._weatherPopups = new Map(); // Inline marker weather cards (colIdx -> { marker, badge, slot })
    this._weatherPopupCloseTimers = new Map();
    this._clickTimeout = null; // Global debunking for map/track clicks to avoid dual triggering with dblclick
    this._lastDblclickAt = 0;  // Timestamp of the last dblclick/double-tap, to suppress the trailing single click
    this._waypointClickTimeout = null; // Delay waypoint click selection so dblclick can cancel it first
    // Map cursor — placed by GPS button (goToMyLocation). Long-press / click
    // on the cursor opens an action menu (set as waypoint / copy coords / weather).
    this._mapCursor = null;
    this._mapCursorLatLng = null;
    this._mapCursorMenuPopup = null;
    this._cursorWeatherPopup = null; // Ad-hoc weather card anchored at the cursor (independent of weatherPoints)
    this.onMapCursorAction = null; // callback(action, lat, lng)
    this.onGpsFix = null; // callback(lat, lng)
    this._mapZoomingTimer = null;

    // Selection/Highlight state tracking
    this.highlightedWpIndex = -1;
    this.highlightedIsReturn = false;

    this.map = L.map(containerId, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      touchZoom: true,
      wheelDebounceTime: 24,
    });

    this.tileLayers = {};
    this.tileLayerConfigs = { ...TILE_LAYERS };
    this.offlineMapSources = {};
    for (const [name, config] of Object.entries(this.tileLayerConfigs)) {
      this.tileLayers[name] = L.tileLayer(config.url, {
        ...config.options,
        ...TILE_LAYER_PERFORMANCE_OPTIONS,
        className: tileLayerClassName(name, config, this.currentTileTheme),
      });
    }
    this.tileLayers.topo.addTo(this.map);

    const noteContainerMultiTouch = (event) => {
      if (this._isMultiTouchEvent(event)) this._noteMultiTouchGesture();
    };
    this.map.getContainer().addEventListener('touchstart', noteContainerMultiTouch, { passive: true });
    this.map.getContainer().addEventListener('touchmove', noteContainerMultiTouch, { passive: true });

    this.map.on('zoomstart', () => {
      this._setMapZooming(true);
    });
    this.map.on('zoomend', () => {
      if (this._mapZoomingTimer) clearTimeout(this._mapZoomingTimer);
      this._mapZoomingTimer = setTimeout(() => {
        this._mapZoomingTimer = null;
        this._setMapZooming(false);
      }, 120);
    });

    this.map.on('click', (e) => {
      if (this.isFrozen) {
        this._notifyFrozenInteraction('map-click');
        return;
      }
      if (Date.now() - this._lastMultiTouchAt < 700) return;
      if (this.ignoreMapClick) return;
      // A double-tap that just fired (zoom) sometimes still delivers a trailing
      // single `click`; ignore clicks landing within the double-tap window after
      // a dblclick so the second tap doesn't drop a stray waypoint.
      if (Date.now() - this._lastDblclickAt < WAYPOINT_SINGLE_TAP_DELAY_MS) return;
      if (this._clickTimeout) {
        // Second click of a quick pair → treat as a double tap, drop both.
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
        return;
      }
      const latlng = e.latlng;
      // Defer the waypoint commit past the double-tap window (rather than the old
      // 300 ms, which fired before Leaflet's ~360 ms double-tap detection closed),
      // and re-check no dblclick fired in the meantime.
      this._clickTimeout = setTimeout(() => {
        this._clickTimeout = null;
        if (Date.now() - this._lastDblclickAt < WAYPOINT_SINGLE_TAP_DELAY_MS) return;
        this.addWaypoint(latlng.lat, latlng.lng);
      }, WAYPOINT_SINGLE_TAP_DELAY_MS);
    });

    this.map.on('dblclick', () => {
      this._lastDblclickAt = Date.now();
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      }
    });

    // Prevent waypoint creation on map pan/movement
    this.map.on('movestart', () => {
      this.ignoreMapClick = true;
    });
    this.map.on('moveend', () => {
      this._blockMapClick();
    });

    // Prevent waypoint creation on long-press ( > 500ms )
    let mapPressStartTime = 0;
    const handlePressStart = (e) => {
      if (this._isMultiTouchEvent(e?.originalEvent || e)) {
        mapPressStartTime = 0;
        this._noteMultiTouchGesture();
        return;
      }
      mapPressStartTime = Date.now();
    };
    const handlePressEnd = (e) => {
      if (this._isMultiTouchEvent(e?.originalEvent || e)) {
        this._noteMultiTouchGesture();
        return;
      }
      if (Date.now() - mapPressStartTime > 500) {
        this._blockMapClick();
      }
    };

    this.map.on('mousedown', handlePressStart);
    this.map.on('touchstart', handlePressStart);
    this.map.on('mouseup', handlePressEnd);
    this.map.on('touchend', handlePressEnd);

    // Context menu on map (often triggered by long-press on mobile) should also block waypoint creation
    this.map.on('contextmenu', () => {
      this._blockMapClick();
    });
  }

  _setMapZooming(isZooming) {
    const el = this.map?.getContainer?.();
    if (!el) return;
    el.classList.toggle('is-map-zooming', isZooming);
  }

  _isMultiTouchEvent(event) {
    return !!(
      event?.touches?.length > 1 ||
      event?.targetTouches?.length > 1 ||
      event?.changedTouches?.length > 1
    );
  }

  _noteMultiTouchGesture() {
    this._lastMultiTouchAt = Date.now();
    this._blockMapClick(700);
  }

  _clearNativeSelection() {
    try {
      window.getSelection?.()?.removeAllRanges?.();
    } catch (_) { }
  }

  _blockMapClick(duration = 300) {
    this.ignoreMapClick = true;
    if (this._blockMapClickTimer) clearTimeout(this._blockMapClickTimer);
    this._blockMapClickTimer = setTimeout(() => {
      this.ignoreMapClick = false;
      this._blockMapClickTimer = null;
    }, duration);
  }

  isWaypointDragging() {
    return this._activeWaypointDragDepth > 0;
  }

  isWaypointInteracting() {
    return this._activeWaypointGestureDepth > 0 || this.isWaypointDragging();
  }

  _beginWaypointGesture() {
    this._activeWaypointGestureDepth++;
  }

  _endWaypointGesture() {
    if (this._activeWaypointGestureDepth <= 0) return;
    this._activeWaypointGestureDepth--;
    this._flushWaypointInteractionUpdates();
  }

  _beginWaypointDrag() {
    this._activeWaypointDragDepth++;
  }

  _endWaypointDrag() {
    if (this._activeWaypointDragDepth <= 0) return;
    this._activeWaypointDragDepth--;
    this._flushWaypointInteractionUpdates();
  }

  _flushWaypointInteractionUpdates() {
    if (!this.isWaypointInteracting()) {
      this._flushDeferredWaypointIconUpdates();
      this.onWaypointDragEnd?.();
    }
  }

  _deferWaypointIconUpdate(index = null) {
    if (Number.isInteger(index)) {
      this._pendingWaypointIconUpdates.add(index);
    } else {
      this._pendingAllWaypointIconUpdate = true;
    }
  }

  _refreshWaypointIcon(index) {
    const marker = this.waypointMarkers[index];
    if (!marker) return;
    marker._wpIndex = index;
    marker.setIcon(this._createIcon(index));
    this._applyColorToMarker(marker, index);
    marker._bindWaypointDomFallback?.();
    this._restoreWaypointHighlightDom();
  }

  _flushDeferredWaypointIconUpdates() {
    if (this.isWaypointDragging()) return;
    if (this._pendingAllWaypointIconUpdate) {
      this._pendingAllWaypointIconUpdate = false;
      this._pendingWaypointIconUpdates.clear();
      this._updateMarkerIcons(true);
      return;
    }
    if (this._pendingWaypointIconUpdates.size === 0) return;
    const updates = [...this._pendingWaypointIconUpdates];
    this._pendingWaypointIconUpdates.clear();
    updates.forEach((index) => this._refreshWaypointIcon(index));
    this._syncWeatherBadgeOpenStates();
  }

  _notifyFrozenInteraction(reason) {
    this.onFrozenInteraction?.(reason);
  }

  _emitWaypointChange() {
    const cb = this.onWaypointChange;
    if (!cb) return;
    const snapshot = this.waypoints.map((wp) => [wp[0], wp[1]]);
    const notify = () => cb(snapshot);
    if (this.isWaypointInteracting()) {
      (window.queueMicrotask || ((fn) => Promise.resolve().then(fn)))(notify);
      return;
    }
    notify();
  }

  _scheduleFrozenInteractionNotice(e, reason, delay = 500) {
    const oe = e?.originalEvent || e;
    const start = oe?.touches ? oe.touches[0] : oe;
    const startX = start?.clientX ?? 0;
    const startY = start?.clientY ?? 0;
    let timer = setTimeout(() => {
      timer = null;
      cleanup();
      this._notifyFrozenInteraction(reason);
    }, delay);

    const cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      cleanup();
    };
    const move = (ev) => {
      if (!timer) return;
      const cur = ev?.touches ? ev.touches[0] : ev;
      const dx = (cur?.clientX ?? startX) - startX;
      const dy = (cur?.clientY ?? startY) - startY;
      if (dx * dx + dy * dy > 64) cancel();
    };
    function cleanup() {
      document.removeEventListener('mouseup', cancel);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('touchend', cancel);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchcancel', cancel);
    }

    document.addEventListener('mouseup', cancel);
    document.addEventListener('mousemove', move);
    document.addEventListener('touchend', cancel);
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchcancel', cancel);
  }

  _startRubberBand(marker) {
    const idx = this.waypointMarkers.indexOf(marker);
    if (idx < 0) return;
    this._dragWpIndex = idx;
    if (this.dragLine) {
      this.map.removeLayer(this.dragLine);
    }
    this.dragLine = L.polyline([], {
      color: '#f59e0b', // 使用琥珀色(Amber)強調虛線
      weight: 3,
      dashArray: '6 6',
      opacity: 0.9,
      interactive: false,
    }).addTo(this.map);
    this._updateRubberBand(marker.getLatLng());
    this.showTrashZone('map');
  }

  _updateRubberBand(latlng) {
    if (!this.dragLine || this._dragWpIndex === undefined) return;
    const idx = this._dragWpIndex;
    const pts = [];
    if (idx > 0) pts.push(this.waypoints[idx - 1]);
    pts.push([latlng.lat, latlng.lng]);
    if (idx < this.waypoints.length - 1) pts.push(this.waypoints[idx + 1]);
    this.dragLine.setLatLngs(pts);
  }

  _stopRubberBand() {
    if (this.dragLine) {
      this.map.removeLayer(this.dragLine);
      this.dragLine = null;
    }
    this._dragWpIndex = undefined;
  }

  ensureTrashZone() {
    if (this.trashZoneEl) return this.trashZoneEl;
    const el = document.createElement('div');
    el.className = 'waypoint-trash-zone hidden';
    el.innerHTML =
      '<div class="waypoint-drop-target waypoint-drop-cancel" data-drop-action="cancel">' +
      '<svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">' +
      '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>' +
      '</svg>' +
      '<span class="waypoint-trash-label">取消</span>' +
      '</div>' +
      '<div class="waypoint-drop-target waypoint-drop-delete" data-drop-action="delete">' +
      '<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">' +
      '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>' +
      '</svg>' +
      '<span class="waypoint-trash-label">移除</span>' +
      '</div>';
    document.body.appendChild(el);
    this.trashZoneEl = el;
    return el;
  }

  showTrashZone(type = 'map') {
    const el = this.ensureTrashZone();
    el.classList.remove('hidden', 'is-hover', 'is-cancel-hover', 'is-map-drag', 'is-list-drag', 'is-table-drag');
    el.querySelectorAll('.waypoint-drop-target').forEach((target) => target.classList.remove('is-hover'));
    // Clear inline positioning from a previous 'table' show
    el.style.top = '';
    el.style.left = '';
    el.style.right = '';
    el.style.width = '';
    el.style.height = '';
    if (type === 'map') {
      el.classList.add('is-map-drag');
    } else if (type === 'list') {
      el.classList.add('is-list-drag');
    } else if (type === 'table') {
      el.classList.add('is-table-drag');
      this._positionTrashZoneTable();
    }
  }

  // Anchor the trash zone to the top of #bottom-panel (the divider line) so its
  // upper edge never crosses above. Height fits inside the panel — important
  // because the elevation chart can be expanded or collapsed.
  _positionTrashZoneTable() {
    const bp = document.getElementById('bottom-panel');
    if (!bp || !this.trashZoneEl) return;
    const rect = bp.getBoundingClientRect();
    // Cap height to the panel's own height so the bottom edge never extends
    // below the panel (which would push it off-screen on a fully collapsed
    // panel). Min 18px keeps it minimally visible.
    const height = Math.max(18, Math.min(72, rect.height - 2));
    this.trashZoneEl.style.top = `${rect.top}px`;
    this.trashZoneEl.style.left = '0';
    this.trashZoneEl.style.right = '0';
    this.trashZoneEl.style.width = '100%';
    this.trashZoneEl.style.height = `${height}px`;
  }

  hideTrashZone() {
    if (!this.trashZoneEl) return;
    this.trashZoneEl.classList.add('hidden');
    this.trashZoneEl.classList.remove('is-hover', 'is-cancel-hover');
    this.trashZoneEl.querySelectorAll('.waypoint-drop-target').forEach((target) => target.classList.remove('is-hover'));
  }

  getTrashZoneDropAction(clientX, clientY) {
    if (clientX == null || clientY == null) return false;
    if (!this.trashZoneEl || this.trashZoneEl.classList.contains('hidden')) return false;
    const isInRect = (rect) => (
      clientX >= rect.left - 10 &&
      clientX <= rect.right + 10 &&
      clientY >= rect.top - 10 &&
      clientY <= rect.bottom + 10
    );

    const targets = Array.from(this.trashZoneEl.querySelectorAll('[data-drop-action]'));
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (isInRect(rect)) return target.dataset.dropAction || false;
    }

    const rect = this.trashZoneEl.getBoundingClientRect();
    return isInRect(rect) ? 'delete' : false;
  }

  isOverTrashZone(clientX, clientY) {
    return this.getTrashZoneDropAction(clientX, clientY) === 'delete';
  }

  updateTrashZoneHover(clientX, clientY) {
    const action = this.getTrashZoneDropAction(clientX, clientY);
    const isDelete = action === 'delete';
    const isCancel = action === 'cancel';
    if (this.trashZoneEl) {
      this.trashZoneEl.classList.toggle('is-hover', isDelete);
      this.trashZoneEl.classList.toggle('is-cancel-hover', isCancel);
      this.trashZoneEl.querySelectorAll('[data-drop-action]').forEach((target) => {
        target.classList.toggle('is-hover', target.dataset.dropAction === action);
      });
    }
    return isDelete;
  }

  // ===== Map cursor (placed by GPS button — not a waypoint) =====

  setMapCursor(lat, lng) {
    this._mapCursorLatLng = [lat, lng];
    this._closeMapCursorMenu();
    this.closeCursorWeatherPopup();
    if (!this._mapCursor) {
      const icon = this._createMapCursorIcon();
      this._mapCursor = L.marker([lat, lng], {
        icon,
        interactive: true,
        keyboard: false,
        zIndexOffset: 800,
      }).addTo(this.map);
      this._attachMapCursorEvents(this._mapCursor);
    } else {
      this._mapCursor.setLatLng([lat, lng]);
    }
  }

  clearMapCursor() {
    this._closeMapCursorMenu();
    this.closeCursorWeatherPopup();
    if (this._mapCursor) {
      this.map.removeLayer(this._mapCursor);
      this._mapCursor = null;
    }
    this._mapCursorLatLng = null;
  }

  /**
   * Open an ad-hoc weather card popup anchored at the GPS cursor's location.
   * Independent of `_weatherPopups` (which keys by weatherPoints colIdx).
   */
  openCursorWeatherPopup(htmlContent, onReady) {
    if (!this._mapCursor || !this._mapCursorLatLng) return null;
    if (!this._cursorWeatherPopup) {
      this._cursorWeatherPopup = L.popup({
        className: 'weather-popup cursor-weather-popup',
        closeButton: false,
        closeOnClick: false,
        autoClose: false,
        autoPan: true,
        autoPanPaddingTopLeft: [20, 60],
        autoPanPaddingBottomRight: [20, 20],
        offset: [0, -28],
        maxWidth: 320,
        minWidth: 200,
      });
    }
    this._cursorWeatherPopup
      .setLatLng(this._mapCursorLatLng)
      .setContent(htmlContent)
      .openOn(this.map);

    const wrapper = this._cursorWeatherPopup.getElement();
    if (wrapper) {
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);
    }
    if (onReady) onReady(wrapper);
    return wrapper;
  }

  closeCursorWeatherPopup() {
    if (this._cursorWeatherPopup) {
      this.map.closePopup(this._cursorWeatherPopup);
      this._cursorWeatherPopup = null;
    }
  }

  isCursorWeatherPopupOpen() {
    return !!(this._cursorWeatherPopup && this._cursorWeatherPopup.isOpen?.());
  }

  _createMapCursorIcon() {
    return L.divIcon({
      className: 'map-cursor-icon',
      html:
        '<div class="map-cursor-pulse"></div>' +
        '<div class="map-cursor-pin">' +
        '<svg viewBox="0 0 24 24" width="36" height="36">' +
        '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor"/>' +
        '<circle cx="12" cy="9" r="3" fill="rgba(255,255,255,0.9)"/>' +
        '</svg>' +
        '</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });
  }

  _attachMapCursorEvents(marker) {
    let lpTimer = null;
    let touchStartX = 0, touchStartY = 0;
    let mouseStartX = 0, mouseStartY = 0;

    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (Date.now() - this._lastMultiTouchAt < 700) return;
      this._openMapCursorMenu();
    });

    marker.on('mousedown', (e) => {
      if (e.originalEvent.button !== 0) return;
      L.DomEvent.stopPropagation(e);
      mouseStartX = e.originalEvent.clientX;
      mouseStartY = e.originalEvent.clientY;
      const cancel = () => {
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', cancel);
      };
      const onMove = (ev) => {
        const dx = ev.clientX - mouseStartX, dy = ev.clientY - mouseStartY;
        if (dx * dx + dy * dy > 64) cancel();
      };
      lpTimer = setTimeout(() => {
        lpTimer = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', cancel);
        platform.vibrate(40);
        this._openMapCursorMenu();
      }, 500);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', cancel);
    });

    marker.on('touchstart', (e) => {
      if (this._isMultiTouchEvent(e.originalEvent)) {
        this._noteMultiTouchGesture();
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        return;
      }
      const t = e.originalEvent.touches[0];
      if (!t) return;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      lpTimer = setTimeout(() => {
        lpTimer = null;
        platform.vibrate(40);
        this._openMapCursorMenu();
      }, 500);
    });
    marker.on('touchmove', (e) => {
      if (!lpTimer) return;
      if (this._isMultiTouchEvent(e.originalEvent)) {
        this._noteMultiTouchGesture();
        clearTimeout(lpTimer);
        lpTimer = null;
        return;
      }
      const t = e.originalEvent.touches[0];
      if (!t) return;
      const dx = t.clientX - touchStartX, dy = t.clientY - touchStartY;
      if (dx * dx + dy * dy > 64) {
        clearTimeout(lpTimer); lpTimer = null;
      }
    });
    marker.on('touchend', (e) => {
      if (this._isMultiTouchEvent(e.originalEvent) || Date.now() - this._lastMultiTouchAt < 700) {
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        return;
      }
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    });
    marker.on('touchcancel', () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    });
    marker.on('contextmenu', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      this._openMapCursorMenu();
    });
  }

  _openMapCursorMenu() {
    if (!this._mapCursor || !this._mapCursorLatLng) return;
    const [lat, lng] = this._mapCursorLatLng;
    const latStr = lat.toFixed(5);
    const lngStr = lng.toFixed(5);

    const html =
      '<div class="map-cursor-menu">' +
      `<div class="map-cursor-coords clickable-coords" data-coords="${latStr}, ${lngStr}" title="點擊複製座標">${latStr}, ${lngStr}</div>` +
      '<button class="cursor-menu-btn" data-action="waypoint">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" fill="currentColor"/>' +
      '</svg>' +
      '<span>設為航點</span>' +
      '</button>' +
      '<button class="cursor-menu-btn" data-action="weather">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M19.36 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.64-4.96z" fill="currentColor"/>' +
      '</svg>' +
      '<span>開啟天氣卡</span>' +
      '</button>' +
      '<button class="cursor-menu-btn" data-action="windy">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"/>' +
      '</svg>' +
      '<span>開啟 Windy</span>' +
      '</button>' +
      '<button class="cursor-menu-btn" data-action="clear">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zM11 17H9v-8h2v8zm4 0h-2v-8h2v8z" fill="currentColor"/>' +
      '</svg>' +
      '<span>清除 GPS 游標</span>' +
      '</button>' +
      '<button class="cursor-menu-btn cursor-menu-cancel" data-action="dismiss">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>' +
      '</svg>' +
      '<span>關閉選單</span>' +
      '</button>' +
      '</div>';

    this._closeMapCursorMenu();
    const popup = L.popup({
      className: 'map-cursor-popup',
      closeButton: false,
      closeOnClick: true,
      autoClose: true,
      autoPan: true,
      offset: [0, -20],
      maxWidth: 220,
      minWidth: 180,
    })
      .setLatLng([lat, lng])
      .setContent(html)
      .openOn(this.map);

    this._mapCursorMenuPopup = popup;

    const wrapper = popup.getElement();
    if (!wrapper) return;
    L.DomEvent.disableClickPropagation(wrapper);
    L.DomEvent.disableScrollPropagation(wrapper);

    wrapper.querySelectorAll('.cursor-menu-btn, .clickable-coords').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = btn.dataset.action || (btn.classList.contains('clickable-coords') ? 'copy' : null);
        if (!action) return;
        this._closeMapCursorMenu();
        if (action === 'dismiss') {
          // Just close the menu — keep the cursor on the map.
          return;
        }
        if (this.onMapCursorAction) {
          this.onMapCursorAction(action, lat, lng);
        }
        if (action === 'waypoint') {
          this.clearMapCursor();
        }
      });
    });
  }

  _closeMapCursorMenu() {
    if (this._mapCursorMenuPopup) {
      this.map.closePopup(this._mapCursorMenuPopup);
      this._mapCursorMenuPopup = null;
    }
  }

  _findInsertionIndex(latlng) {
    if (this.waypoints.length < 2) return this.waypoints.length;
    let bestIndex = 1;
    let minDetour = Infinity;
    for (let i = 1; i < this.waypoints.length; i++) {
      const w1 = this.waypoints[i - 1];
      const w2 = this.waypoints[i];
      const d1 = L.latLng(w1[0], w1[1]).distanceTo(latlng);
      const d2 = L.latLng(w2[0], w2[1]).distanceTo(latlng);
      const d12 = L.latLng(w1[0], w1[1]).distanceTo(L.latLng(w2[0], w2[1]));
      const detour = d1 + d2 - d12;
      if (detour < minDetour) {
        minDetour = detour;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  switchLayer(layerName) {
    if (!this.tileLayers[layerName]) return;
    if (this.tileLayers[this.currentLayerName]) {
      this.map.removeLayer(this.tileLayers[this.currentLayerName]);
    }
    this.tileLayers[layerName].addTo(this.map);
    this.currentLayerName = layerName;
    this._syncTileLayerClassNames();
  }

  registerOfflineMapSources(sources = []) {
    const renderableSources = (sources || []).filter((source) => this._canRenderOfflineMapSource(source));
    const nextLayerNames = new Set(renderableSources.map((source) => this._offlineLayerName(source.id)));

    Object.keys(this.tileLayers).forEach((layerName) => {
      if (!layerName.startsWith(OFFLINE_LAYER_PREFIX) || nextLayerNames.has(layerName)) return;
      if (this.map.hasLayer(this.tileLayers[layerName])) this.map.removeLayer(this.tileLayers[layerName]);
      delete this.tileLayers[layerName];
      delete this.tileLayerConfigs[layerName];
      delete this.offlineMapSources[layerName];
      if (this.currentLayerName === layerName) this.switchLayer('topo');
    });

    renderableSources.forEach((source) => {
      const layerName = this._offlineLayerName(source.id);
      this.offlineMapSources[layerName] = source;
      this.tileLayerConfigs[layerName] = this._offlineLayerConfig(source);
      if (!this.tileLayers[layerName]) {
        this.tileLayers[layerName] = this._createOfflineMapTileLayer(source, layerName);
      }
    });

    this._syncTileLayerClassNames();
  }

  activateOfflineMapSource(source) {
    if (!this._canRenderOfflineMapSource(source)) return false;
    this.registerOfflineMapSources([source]);
    this.switchLayer(this._offlineLayerName(source.id));
    return true;
  }

  removeOfflineMapSource(sourceId) {
    const layerName = this._offlineLayerName(sourceId);
    if (!this.tileLayers[layerName]) return;
    if (this.currentLayerName === layerName) this.switchLayer('topo');
    if (this.map.hasLayer(this.tileLayers[layerName])) this.map.removeLayer(this.tileLayers[layerName]);
    delete this.tileLayers[layerName];
    delete this.tileLayerConfigs[layerName];
    delete this.offlineMapSources[layerName];
    this._syncTileLayerClassNames();
  }

  setTileTheme(themeName) {
    const nextTheme = normalizeMapTileTheme(themeName);
    if (this.currentTileTheme === nextTheme) {
      this._syncTileLayerClassNames();
      return;
    }
    this.currentTileTheme = nextTheme;
    this._syncTileLayerClassNames();
  }

  _syncTileLayerClassNames() {
    for (const [name, layer] of Object.entries(this.tileLayers)) {
      const config = this.tileLayerConfigs[name];
      if (!config) continue;
      const className = tileLayerClassName(name, config, this.currentTileTheme);
      layer.options.className = className;
      const container = layer.getContainer?.() || layer._container;
      if (!container) continue;
      for (const classToken of Array.from(container.classList)) {
        if (classToken.startsWith('map-tiles')) container.classList.remove(classToken);
      }
      className.split(/\s+/).forEach((classToken) => container.classList.add(classToken));
    }
  }

  setFrozen(val) {
    this.isFrozen = val;
  }

  addWaypoint(lat, lng, insertIndex = null) {
    const idx = insertIndex !== null ? insertIndex : this.waypoints.length;
    this.waypoints.splice(idx, 0, [lat, lng]);
    this.waypointLayerSwapped.splice(idx, 0, true);
    this.waypointWeather.splice(idx, 0, null);
    this.waypointColors.splice(idx, 0, null);
    this.waypointLabels.splice(idx, 0, null);
    this.waypointMetadata.splice(idx, 0, {});
    const icon = this._createIcon(idx);

    const marker = L.marker([lat, lng], {
      icon,
      draggable: false,
      zIndexOffset: WAYPOINT_Z_BASE,
    }).addTo(this.map);
    marker._wpIndex = idx;

    let _dragModeActive = false;
    let _justDragged = false;
    let _isTouchActive = false;
    let _leafletDragStartLatLng = null;

    const _enableDrag = () => {
      _dragModeActive = true;
      marker.dragging.enable();
      marker.getElement()?.classList.add('is-dragging');
      platform.vibrate(40);
    };

    const _disableDrag = () => {
      _dragModeActive = false;
      marker.dragging.disable();
      marker.getElement()?.classList.remove('is-dragging');
    };

    const clientPointToLatLng = (clientX, clientY, source = 'mouse', anchorOffset = null) => {
      const rect = this.map.getContainer().getBoundingClientRect();
      const yOffset = anchorOffset ? 0 : (source === 'touch' ? 40 : 0);
      return this.map.containerPointToLatLng([
        clientX - rect.left + (anchorOffset?.x ?? 0),
        clientY - rect.top - yOffset + (anchorOffset?.y ?? 0),
      ]);
    };

    const markerAnchorOffsetFromClient = (latlng, clientX, clientY) => {
      const rect = this.map.getContainer().getBoundingClientRect();
      const anchorPoint = this.map.latLngToContainerPoint(latlng);
      return {
        x: anchorPoint.x - (clientX - rect.left),
        y: anchorPoint.y - (clientY - rect.top),
      };
    };

    const restoreMapDragging = () => {
      setTimeout(() => this.map.dragging.enable(), 0);
    };

    // Desktop: right-click / context menu → Leaflet built-in drag.
    // Guard: on mobile Leaflet fires a synthetic contextmenu during a long-press
    // (before our 500ms timer). Do NOT call _enableDrag() then — enabling
    // Leaflet's built-in drag mid-touch leaves the start position undefined and
    // causes the marker to jump off-screen (same problem described in the touch
    // handler below). The manual touch-drag handler will activate at 500ms.
    marker.on('contextmenu', (e) => {
      L.DomEvent.stopPropagation(e);
      if (this.isFrozen) {
        this._notifyFrozenInteraction('waypoint-drag');
        return;
      }
      if (_isTouchActive || _longPressTimer !== null || _dragModeActive) return;
      _enableDrag();
    });

    // Desktop: left-button long-press (500ms) → manual drag
    let _mouseLPTimer = null;
    let _mousePendingClientX = 0, _mousePendingClientY = 0;
    let _mouseStartClientX = 0, _mouseStartClientY = 0;
    let _mouseGestureStarted = false;
    const startMouseLongPress = (oe) => {
      if (oe.button !== 0 || _dragModeActive) return;
      L.DomEvent.stop(oe);
      if (!_mouseGestureStarted) {
        _mouseGestureStarted = true;
        this._beginWaypointGesture();
      }

      _mousePendingClientX = oe.clientX;
      _mousePendingClientY = oe.clientY;
      _mouseStartClientX = oe.clientX;
      _mouseStartClientY = oe.clientY;
      this.map.dragging.disable();

      const cancelLP = () => {
        clearTimeout(_mouseLPTimer);
        _mouseLPTimer = null;
        document.removeEventListener('mousemove', onPendingMove, true);
        document.removeEventListener('mouseup', cancelLP, true);
        if (!_dragModeActive) restoreMapDragging();
        if (!_dragModeActive && _mouseGestureStarted) {
          _mouseGestureStarted = false;
          this._endWaypointGesture();
        }
      };
      const onPendingMove = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        _mousePendingClientX = ev.clientX;
        _mousePendingClientY = ev.clientY;
      };

      _mouseLPTimer = setTimeout(() => {
        document.removeEventListener('mousemove', onPendingMove, true);
        document.removeEventListener('mouseup', cancelLP, true);
        _mouseLPTimer = null;

        if (this.isFrozen) {
          this._notifyFrozenInteraction('waypoint-drag');
          restoreMapDragging();
          if (_mouseGestureStarted) {
            _mouseGestureStarted = false;
            this._endWaypointGesture();
          }
          return;
        }

        _dragModeActive = true;
        _justDragged = true; // Prevent subsequent click from triggering redundant highlight
        marker.getElement()?.classList.add('is-dragging');
        platform.vibrate(40);
        this.map.dragging.disable();
        this._beginWaypointDrag();

        const dragStartLatLng = marker.getLatLng();
        const dragAnchorOffset = markerAnchorOffsetFromClient(
          dragStartLatLng,
          _mouseStartClientX,
          _mouseStartClientY
        );
        this._startRubberBand(marker);

        const moveTo = (clientX, clientY) => {
          if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
          const latlng = clientPointToLatLng(clientX, clientY, 'mouse', dragAnchorOffset);
          marker.setLatLng(latlng);
          this._updateRubberBand(latlng);
          this.updateTrashZoneHover(clientX, clientY);
        };

        const onMove = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          moveTo(ev.clientX, ev.clientY);
        };
        const onUp = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          const dropAction = this.getTrashZoneDropAction(ev?.clientX, ev?.clientY);
          _dragModeActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          this.hideTrashZone();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          restoreMapDragging();
          document.removeEventListener('mousemove', onMove, true);
          document.removeEventListener('mouseup', onUp, true);
          const idx = this.waypointMarkers.indexOf(marker);
          try {
            if (idx >= 0) {
              if (dropAction === 'delete') {
                platform.vibrate([20, 40, 20]);
                this.removeWaypoint(idx);
              } else if (dropAction === 'cancel') {
                marker.setLatLng(dragStartLatLng);
              } else {
                const hasReleasePoint = Number.isFinite(ev?.clientX) && Number.isFinite(ev?.clientY);
                const pos = hasReleasePoint
                  ? clientPointToLatLng(ev.clientX, ev.clientY, 'mouse', dragAnchorOffset)
                  : marker.getLatLng();
                marker.setLatLng(pos);
                this.waypoints[idx] = [pos.lat, pos.lng];
                this._emitWaypointChange();
                // Post-drag highlight (on release)
                this.onWaypointSelect?.(idx, false);
              }
            }
          } finally {
            this._endWaypointDrag();
            if (_mouseGestureStarted) {
              _mouseGestureStarted = false;
              this._endWaypointGesture();
            }
          }
        };
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      }, 500);

      document.addEventListener('mousemove', onPendingMove, true);
      document.addEventListener('mouseup', cancelLP, true);
    };

    marker.on('mousedown', (e) => {
      if (e.originalEvent?._mappingElfWaypointDomHandled) return;
      if (this._isWeatherCardDomTarget(e.originalEvent?.target)) return;
      if (this._isWeatherBadgeDomTarget(e.originalEvent?.target)) return;
      startMouseLongPress(e.originalEvent);
    });

    // Touch: long-press (500ms) → manual drag (mirrors desktop handler).
    // We do NOT use marker.dragging.enable() here because Leaflet's built-in
    // drag needs a touchstart to anchor its start point; enabling it mid-touch
    // (500ms after the original touchstart) leaves the start position undefined,
    // causing the marker to jump off-screen on the first touchmove.
    let _longPressTimer = null;
    let _touchPendingClientX = 0, _touchPendingClientY = 0;
    let _touchStartClientX = 0, _touchStartClientY = 0;
    let _touchPressActive = false;
    let _touchTapHandledForPress = false;
    let _touchGestureStarted = false;
    let _lastWaypointTouchTapAt = 0;
    let _lastWaypointTouchTapX = 0;
    let _lastWaypointTouchTapY = 0;
    const getTouchPoint = (oe) => oe?.touches?.[0] || oe?.changedTouches?.[0] || oe;
    const touchMovedBeyondTapTolerance = (touch) => {
      if (!touch) return true;
      const dx = touch.clientX - _touchStartClientX;
      const dy = touch.clientY - _touchStartClientY;
      return dx * dx + dy * dy > WAYPOINT_TOUCH_TAP_MOVE_TOLERANCE_PX ** 2;
    };
    const handleWaypointTouchTap = (oe) => {
      const touch = oe?.changedTouches?.[0] || getTouchPoint(oe);
      if (
        !touch ||
        _dragModeActive ||
        touchMovedBeyondTapTolerance(touch) ||
        Date.now() - this._lastMultiTouchAt < 700
      ) {
        _lastWaypointTouchTapAt = 0;
        return false;
      }

      const now = Date.now();
      const dx = touch.clientX - _lastWaypointTouchTapX;
      const dy = touch.clientY - _lastWaypointTouchTapY;
      const isDoubleTap =
        _lastWaypointTouchTapAt > 0 &&
        now - _lastWaypointTouchTapAt <= WAYPOINT_DOUBLE_TAP_DELAY_MS &&
        dx * dx + dy * dy <= WAYPOINT_DOUBLE_TAP_DISTANCE_PX ** 2;

      if (!isDoubleTap) {
        _lastWaypointTouchTapAt = now;
        _lastWaypointTouchTapX = touch.clientX;
        _lastWaypointTouchTapY = touch.clientY;
        const idx = this.waypointMarkers.indexOf(marker);
        if (idx >= 0) this._scheduleWaypointSelect(idx, false, marker.getLatLng());
        return false;
      }

      _lastWaypointTouchTapAt = 0;
      handleWaypointDoubleClick({ originalEvent: oe });
      return true;
    };
    const startTouchLongPress = (oe) => {
      if (this._isMultiTouchEvent(oe)) {
        this._noteMultiTouchGesture();
        _isTouchActive = false;
        cleanupPendingTouchListeners();
        restoreMapDragging();
        return;
      }
      _isTouchActive = true;
      if (_dragModeActive) return;
      const touch = getTouchPoint(oe);
      if (!touch) return;
      cleanupPendingTouchListeners();
      oe.preventDefault?.();
      this._clearNativeSelection();
      if (!_touchGestureStarted) {
        _touchGestureStarted = true;
        this._beginWaypointGesture();
      }
      _touchPendingClientX = touch.clientX;
      _touchPendingClientY = touch.clientY;
      _touchStartClientX = touch.clientX;
      _touchStartClientY = touch.clientY;
      _touchPressActive = true;
      _touchTapHandledForPress = false;
      this.map.dragging.disable();

      _longPressTimer = setTimeout(() => {
        _longPressTimer = null;
        cleanupPendingTouchListeners();
        _touchPressActive = false;

        if (this.isFrozen) {
          this._notifyFrozenInteraction('waypoint-drag');
          _isTouchActive = false;
          restoreMapDragging();
          if (_touchGestureStarted) {
            _touchGestureStarted = false;
            this._endWaypointGesture();
          }
          return;
        }

        _dragModeActive = true;
        _justDragged = true; // Prevent subsequent click from triggering redundant highlight
        marker.getElement()?.classList.add('is-dragging');
        platform.vibrate(40);
        this.map.dragging.disable();
        this._beginWaypointDrag();

        const dragStartLatLng = marker.getLatLng();
        const dragAnchorOffset = markerAnchorOffsetFromClient(
          dragStartLatLng,
          _touchStartClientX,
          _touchStartClientY
        );
        this._startRubberBand(marker);
        let didTouchDragMove = false;

        let lastTouchClientX = null, lastTouchClientY = null;

        const moveTo = (clientX, clientY, countAsMove = true) => {
          if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
          lastTouchClientX = clientX;
          lastTouchClientY = clientY;
          if (countAsMove) didTouchDragMove = true;
          const latlng = clientPointToLatLng(clientX, clientY, 'touch', dragAnchorOffset);
          marker.setLatLng(latlng);
          this._updateRubberBand(latlng);
          this.updateTrashZoneHover(clientX, clientY);
        };

        const onTouchMove = (ev) => {
          if (this._isMultiTouchEvent(ev)) {
            this._noteMultiTouchGesture();
            onTouchCancel();
            return;
          }
          ev.preventDefault();
          const t = ev.touches[0];
          if (!t) return;
          moveTo(t.clientX, t.clientY);
        };
        const onTouchEnd = (ev) => {
          if (this._isMultiTouchEvent(ev) || Date.now() - this._lastMultiTouchAt < 700) {
            onTouchCancel();
            return;
          }
          const ct = ev?.changedTouches?.[0];
          const cx = ct?.clientX ?? lastTouchClientX;
          const cy = ct?.clientY ?? lastTouchClientY;
          const dropAction = this.getTrashZoneDropAction(cx, cy);
          _dragModeActive = false;
          _isTouchActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          this.hideTrashZone();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          restoreMapDragging();
          document.removeEventListener('touchmove', onTouchMove, true);
          document.removeEventListener('touchend', onTouchEnd, true);
          document.removeEventListener('touchcancel', onTouchCancel, true);
          const idx = this.waypointMarkers.indexOf(marker);
          try {
            if (idx >= 0) {
              if (dropAction === 'delete') {
                platform.vibrate([20, 40, 20]);
                this.removeWaypoint(idx);
              } else if (dropAction === 'cancel' || !didTouchDragMove) {
                marker.setLatLng(dragStartLatLng);
              } else {
                const hasReleasePoint = Number.isFinite(cx) && Number.isFinite(cy);
                const pos = hasReleasePoint
                  ? clientPointToLatLng(cx, cy, 'touch', dragAnchorOffset)
                  : marker.getLatLng();
                marker.setLatLng(pos);
                this.waypoints[idx] = [pos.lat, pos.lng];
                this._emitWaypointChange();
                // Post-drag highlight (on release)
                this.onWaypointSelect?.(idx, false);
              }
            }
          } finally {
            this._endWaypointDrag();
            if (_touchGestureStarted) {
              _touchGestureStarted = false;
              this._endWaypointGesture();
            }
          }
        };
        const onTouchCancel = () => {
          _dragModeActive = false;
          _isTouchActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          this.hideTrashZone();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          restoreMapDragging();
          document.removeEventListener('touchmove', onTouchMove, true);
          document.removeEventListener('touchend', onTouchEnd, true);
          document.removeEventListener('touchcancel', onTouchCancel, true);
          marker.setLatLng(dragStartLatLng);
          this._endWaypointDrag();
          if (_touchGestureStarted) {
            _touchGestureStarted = false;
            this._endWaypointGesture();
          }
        };
        // Capture active drag events before marker DOM fallbacks can stop them.
        document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
        document.addEventListener('touchend', onTouchEnd, true);
        document.addEventListener('touchcancel', onTouchCancel, true);
      }, 500);

      document.addEventListener('touchmove', onPendingTouchMove, { passive: false });
      document.addEventListener('touchend', onPendingTouchEnd);
      document.addEventListener('touchcancel', onPendingTouchCancel);
    };
    const moveTouchLongPress = (oe) => {
      if (this._isMultiTouchEvent(oe)) {
        this._noteMultiTouchGesture();
        finishTouchLongPress(oe, { processTap: false });
        return;
      }
      if (_longPressTimer) {
        const touch = getTouchPoint(oe);
        if (!touch) return;
        oe.preventDefault?.();
        this._clearNativeSelection();
        _touchPendingClientX = touch.clientX;
        _touchPendingClientY = touch.clientY;
      }
    };
    function cleanupPendingTouchListeners() {
      document.removeEventListener('touchmove', onPendingTouchMove);
      document.removeEventListener('touchend', onPendingTouchEnd);
      document.removeEventListener('touchcancel', onPendingTouchCancel);
    }
    const finishTouchLongPress = (oe, { processTap = true } = {}) => {
      const hadActivePress = _touchPressActive || _longPressTimer !== null || _dragModeActive;
      if (!hadActivePress) return;
      if (processTap && !_touchTapHandledForPress && !_dragModeActive) {
        _touchTapHandledForPress = true;
        handleWaypointTouchTap(oe);
      }
      endTouchLongPress();
    };
    function onPendingTouchMove(ev) {
      if (!_touchPressActive || !_longPressTimer) return;
      moveTouchLongPress(ev);
    }
    function onPendingTouchEnd(ev) {
      finishTouchLongPress(ev);
    }
    function onPendingTouchCancel(ev) {
      finishTouchLongPress(ev, { processTap: false });
    }
    const endTouchLongPress = () => {
      _isTouchActive = false;
      _touchPressActive = false;
      _touchTapHandledForPress = false;
      cleanupPendingTouchListeners();
      if (_longPressTimer) {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
      }
      if (!_dragModeActive) restoreMapDragging();
      if (!_dragModeActive && _touchGestureStarted) {
        _touchGestureStarted = false;
        this._endWaypointGesture();
      }
    };
    marker.on('touchstart', (e) => {
      if (e.originalEvent?._mappingElfWaypointDomHandled) return;
      if (this._isWeatherCardDomTarget(e.originalEvent?.target)) return;
      if (this._isWeatherBadgeDomTarget(e.originalEvent?.target)) return;
      startTouchLongPress(e.originalEvent);
    });
    marker.on('touchmove', (e) => {
      if (e.originalEvent?._mappingElfWaypointDomHandled) return;
      if (this._isWeatherCardDomTarget(e.originalEvent?.target)) return;
      if (this._isWeatherBadgeDomTarget(e.originalEvent?.target)) return;
      moveTouchLongPress(e.originalEvent);
    });
    marker.on('touchend', (e) => {
      if (e.originalEvent?._mappingElfWaypointDomHandled) return;
      if (this._isWeatherCardDomTarget(e.originalEvent?.target)) return;
      if (this._isWeatherBadgeDomTarget(e.originalEvent?.target)) return;
      finishTouchLongPress(e.originalEvent);
    });
    marker.on('touchcancel', (e) => finishTouchLongPress(e.originalEvent, { processTap: false }));

    marker._bindWaypointDomFallback = () => {
      const el = marker.getElement?.();
      if (!el) return;
      this._bindWeatherBadgeClick(marker, () => {
        const idx = this.waypointMarkers.indexOf(marker);
        if (idx >= 0) this.onWeatherBadgeClick?.(idx, false);
      }, '_mappingElfWaypointDomHandled');
      if (el._mappingElfWaypointDomBound) return;
      el._mappingElfWaypointDomBound = true;
      el.addEventListener('mousedown', (oe) => {
        if (this._isWeatherCardDomTarget(oe.target)) {
          return;
        }
        if (this._isWeatherBadgeDomTarget(oe.target)) return;
        if (oe.button !== 0 || _dragModeActive) return;
        oe._mappingElfWaypointDomHandled = true;
        oe.stopPropagation();
        oe.preventDefault();
        startMouseLongPress(oe);
      }, { capture: true });
      el.addEventListener('mouseup', (oe) => {
        if (this._isWeatherCardDomTarget(oe.target)) {
          return;
        }
        if (this._isWeatherBadgeDomTarget(oe.target)) return;
        if (!_dragModeActive && !_mouseLPTimer) restoreMapDragging();
        if (oe.button !== 0 || Date.now() - this._lastMultiTouchAt < 700) return;
        if (_dragModeActive || _justDragged) return;
        const idx = this.waypointMarkers.indexOf(marker);
        if (idx >= 0) this._scheduleWaypointSelect(idx, false, marker.getLatLng());
      }, { capture: true });
      el.addEventListener('mouseleave', () => {
        if (!_dragModeActive && !_mouseLPTimer) restoreMapDragging();
      }, { capture: true });
      el.addEventListener('click', (oe) => {
        if (this._isWeatherCardDomTarget(oe.target)) {
          return;
        }
        if (this._isWeatherBadgeDomTarget(oe.target)) return;
        oe._mappingElfWaypointDomHandled = true;
        oe.stopPropagation();
        oe.preventDefault();
        if (Date.now() - this._lastMultiTouchAt < 700) return;
        if (_dragModeActive || _justDragged) {
          if (_dragModeActive) _disableDrag();
          return;
        }
        const idx = this.waypointMarkers.indexOf(marker);
        if (idx >= 0) this._scheduleWaypointSelect(idx, false, marker.getLatLng());
      }, { capture: true });
      el.addEventListener('dblclick', (oe) => {
        if (this._isWeatherCardDomTarget(oe.target)) {
          return;
        }
        if (this._isWeatherBadgeDomTarget(oe.target)) {
          oe.preventDefault?.();
          oe.stopPropagation?.();
          return;
        }
        oe._mappingElfWaypointDomHandled = true;
        if (_mouseLPTimer) {
          clearTimeout(_mouseLPTimer);
          _mouseLPTimer = null;
        }
        endTouchLongPress();
        restoreMapDragging();
        handleWaypointDoubleClick({ originalEvent: oe });
      }, { capture: true });
      el.addEventListener('touchstart', (oe) => {
        if (this._isMultiTouchEvent(oe)) {
          this._noteMultiTouchGesture();
          endTouchLongPress();
          return;
        }
        if (this._isWeatherCardDomTarget(oe.target)) {
          return;
        }
        if (this._isWeatherBadgeDomTarget(oe.target)) return;
        oe._mappingElfWaypointDomHandled = true;
        oe.stopPropagation();
        startTouchLongPress(oe);
      }, { passive: false, capture: true });
      el.addEventListener('touchmove', (oe) => {
        if (this._isMultiTouchEvent(oe)) {
          this._noteMultiTouchGesture();
          endTouchLongPress();
          return;
        }
        if (this._isWeatherCardDomTarget(oe.target)) {
          return;
        }
        if (this._isWeatherBadgeDomTarget(oe.target)) return;
        oe._mappingElfWaypointDomHandled = true;
        oe.stopPropagation();
        moveTouchLongPress(oe);
      }, { passive: false, capture: true });
      el.addEventListener('touchend', (oe) => {
        if (this._isWeatherCardDomTarget(oe.target)) {
          return;
        }
        if (this._isWeatherBadgeDomTarget(oe.target)) return;
        oe._mappingElfWaypointDomHandled = true;
        oe.stopPropagation();
        oe.preventDefault?.();
        finishTouchLongPress(oe);
      }, { passive: false, capture: true });
      el.addEventListener('touchcancel', (oe) => {
        if (this._isWeatherCardDomTarget(oe.target)) {
          return;
        }
        if (this._isWeatherBadgeDomTarget(oe.target)) return;
        oe._mappingElfWaypointDomHandled = true;
        oe.stopPropagation();
        finishTouchLongPress(oe, { processTap: false });
      }, { passive: true, capture: true });
    };

    // Click/tap: cancel drag mode; on normal click → notify selection or weather badge
    marker.on('click', (e) => {
      if (e.originalEvent?._mappingElfWaypointDomHandled) return;
      if (Date.now() - this._lastMultiTouchAt < 700) {
        L.DomEvent.stopPropagation(e);
        return;
      }
      if (_dragModeActive || _justDragged) {
        L.DomEvent.stopPropagation(e);
        if (_dragModeActive) _disableDrag();
        return;
      }
      // Detect click on weather badge
      const target = e.originalEvent?.target;
      if (this._isWeatherCardDomTarget(target)) {
        L.DomEvent.stopPropagation(e);
        return;
      }
      if (target && target.closest && target.closest('.wp-weather-badge')) {
        L.DomEvent.stopPropagation(e);
        const idx = this.waypointMarkers.indexOf(marker);
        if (idx >= 0) {
          // waypoints need their colIdx for the weather card; main.js will provide a callback/helper
          // but for now we just find the column mapped to this waypoint.
          this.onWeatherBadgeClick?.(idx, false);
        }
        return;
      }
      const idx = this.waypointMarkers.indexOf(marker);
      if (idx >= 0) {
        this._scheduleWaypointSelect(idx, false, marker.getLatLng());
      }
    });

    const handleWaypointDoubleClick = (e) => {
      const oe = e?.originalEvent || e;
      oe?.preventDefault?.();
      oe?.stopPropagation?.();
      oe?.stopImmediatePropagation?.();
      L.DomEvent.stopPropagation(e?.originalEvent ? e : oe);
      if (Date.now() - this._lastMultiTouchAt < 700) return;
      this._clearWaypointClickTimeout();
      const idx = this.waypointMarkers.indexOf(marker);
      if (idx >= 0) {
        this._cycleWaypointLayerThenSelect(idx, false, marker.getLatLng());
      }
    };

    // Double-click on overlapped waypoint markers cycles the visible layer immediately.
    marker.on('dblclick', handleWaypointDoubleClick);

    // 綁定 Leaflet 內建拖曳功能 (Desktop 右鍵後觸發) 的事件
    marker.on('dragstart', () => {
      _leafletDragStartLatLng = marker.getLatLng();
      this._startRubberBand(marker);
      this._beginWaypointGesture();
      this._beginWaypointDrag();
    });
    marker.on('drag', (e) => {
      this._updateRubberBand(e.target.getLatLng());
      const oe = e.originalEvent;
      const cx = oe?.clientX ?? oe?.touches?.[0]?.clientX;
      const cy = oe?.clientY ?? oe?.touches?.[0]?.clientY;
      if (cx != null && cy != null) {
        this.updateTrashZoneHover(cx, cy);
      } else {
        // Fallback: derive screen coords from marker's lat/lng
        const cp = this.map.latLngToContainerPoint(e.target.getLatLng());
        const r = this.map.getContainer().getBoundingClientRect();
        this.updateTrashZoneHover(cp.x + r.left, cp.y + r.top);
      }
    });

    marker.on('dragend', (e) => {
      const oe = e.originalEvent;
      let dropX = oe?.clientX ?? oe?.changedTouches?.[0]?.clientX;
      let dropY = oe?.clientY ?? oe?.changedTouches?.[0]?.clientY;
      if (dropX == null || dropY == null) {
        const cp = this.map.latLngToContainerPoint(e.target.getLatLng());
        const r = this.map.getContainer().getBoundingClientRect();
        dropX = cp.x + r.left;
        dropY = cp.y + r.top;
      }
      const dropAction = this.getTrashZoneDropAction(dropX, dropY);
      this._blockMapClick();
      this._stopRubberBand();
      this.hideTrashZone();
      const pos = e.target.getLatLng();
      const idx = this.waypointMarkers.indexOf(marker);
      _disableDrag();
      try {
        if (idx >= 0) {
          if (dropAction === 'delete') {
            platform.vibrate([20, 40, 20]);
            this.removeWaypoint(idx);
          } else if (dropAction === 'cancel') {
            if (_leafletDragStartLatLng) marker.setLatLng(_leafletDragStartLatLng);
          } else {
            this.waypoints[idx] = [pos.lat, pos.lng];
            this._emitWaypointChange();
          }
        }
      } finally {
        this._endWaypointDrag();
        this._endWaypointGesture();
      }
      _leafletDragStartLatLng = null;
    });

    this.waypointMarkers.splice(idx, 0, marker);
    this._updateMarkerIcons();
    marker._bindWaypointDomFallback?.();
    this._emitWaypointChange();
  }

  removeWaypoint(index) {
    this.map.removeLayer(this.waypointMarkers[index]);
    this.waypoints.splice(index, 1);
    this.waypointLayerSwapped.splice(index, 1);
    this.waypointMarkers.splice(index, 1);
    this.waypointWeather.splice(index, 1);
    this.waypointColors.splice(index, 1);
    this.waypointLabels.splice(index, 1);
    this.waypointMetadata.splice(index, 1);
    this._updateMarkerIcons();
    this._emitWaypointChange();
  }

  removeLastWaypoint() {
    if (this.waypoints.length === 0) return;
    this.removeWaypoint(this.waypoints.length - 1);
  }

  moveWaypoint(index, offset) {
    const newIndex = index + offset;
    if (newIndex < 0 || newIndex >= this.waypoints.length) return;

    // Swap data
    const tempCoords = this.waypoints[index];
    this.waypoints[index] = this.waypoints[newIndex];
    this.waypoints[newIndex] = tempCoords;

    const tempMarker = this.waypointMarkers[index];
    this.waypointMarkers[index] = this.waypointMarkers[newIndex];
    this.waypointMarkers[newIndex] = tempMarker;

    const tempLabel = this.waypointLabels[index];
    this.waypointLabels[index] = this.waypointLabels[newIndex];
    this.waypointLabels[newIndex] = tempLabel;

    const tempWeather = this.waypointWeather[index];
    this.waypointWeather[index] = this.waypointWeather[newIndex];
    this.waypointWeather[newIndex] = tempWeather;

    const tempColor = this.waypointColors[index];
    this.waypointColors[index] = this.waypointColors[newIndex];
    this.waypointColors[newIndex] = tempColor;

    const tempMetadata = this.waypointMetadata[index];
    this.waypointMetadata[index] = this.waypointMetadata[newIndex];
    this.waypointMetadata[newIndex] = tempMetadata;

    const tempSwapped = this.waypointLayerSwapped[index];
    this.waypointLayerSwapped[index] = this.waypointLayerSwapped[newIndex];
    this.waypointLayerSwapped[newIndex] = tempSwapped;

    this._updateMarkerIcons();
    this._emitWaypointChange();
  }

  moveWaypointTo(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.waypoints.length) return;
    const clampedTo = Math.max(0, Math.min(this.waypoints.length - 1, toIndex));
    if (fromIndex === clampedTo) return;
    const total = this.waypoints.length;

    const moveInArray = (arr) => {
      arr.length = total;
      const [item] = arr.splice(fromIndex, 1);
      arr.splice(clampedTo, 0, item);
    };

    moveInArray(this.waypoints);
    moveInArray(this.waypointMarkers);
    moveInArray(this.waypointWeather);
    moveInArray(this.waypointColors);
    moveInArray(this.waypointLabels);
    moveInArray(this.waypointMetadata);
    moveInArray(this.waypointLayerSwapped);

    this._updateMarkerIcons();
    this._emitWaypointChange();
  }

  reverseWaypoints() {
    if (this.waypoints.length < 2) return;

    this.waypoints.reverse();
    this.waypointMarkers.reverse();
    this.waypointWeather.reverse();
    this.waypointColors.reverse();
    this.waypointLabels.reverse();
    this.waypointMetadata.reverse();
    this.waypointLayerSwapped.reverse();
    this.clearWaypointHighlight();
    this._updateMarkerIcons();
    this._emitWaypointChange();
  }

  clearWaypoints() {
    this.waypointMarkers.forEach((m) => this.map.removeLayer(m));
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = [];
    this.waypointColors = [];
    this.waypointLabels = [];
    this.waypointMetadata = [];
    this.clearAllRoutes();
    this._emitWaypointChange();
  }

  setWaypointWeather(index, emoji) {
    if (index < 0 || index >= this.waypointMarkers.length) return;
    this.waypointWeather[index] = emoji;
    if (this.isWaypointInteracting()) {
      this._deferWaypointIconUpdate(index);
      return;
    }
    this._refreshWaypointIcon(index);
    this._syncWeatherBadgeOpenStates();
  }

  clearWaypointWeather() {
    this.waypointWeather = [];
    this._updateMarkerIcons();
  }

  setWaypointLabels(labels) {
    this.waypointLabels = labels || [];
    this._updateMarkerIcons();
  }

  /** Set gradient colors (one per waypoint) so icons match the elevation profile. */
  setWaypointColors(colors) {
    this.waypointColors = colors || [];
    this._updateMarkerIcons();
  }

  setWaypointMetadata(index, meta) {
    if (index >= 0 && index < this.waypointMetadata.length) {
      this.waypointMetadata[index] = meta || {};
    }
  }

  getWaypointMetadata(index) {
    return this.waypointMetadata[index] || {};
  }

  /**
   * Draw a single route with continuous gradient coloring
   * @param {Array} routeCoords
   * @param {boolean} isRoundTrip - if true, gradient goes teal→red→teal (symmetric)
   */
  drawRoute(routeCoords, isRoundTrip = false) {
    this.clearAllRoutes();
    this._drawGradientRoute(routeCoords, isRoundTrip);
    this.selectedRouteIndex = 0;
  }

  /**
   * Draw multiple alternative routes on the map
   * @param {Array} routes - Array of { coords, label, index, ... }
   * @param {number} selectedIdx - Index of the currently selected route
   * @param {boolean} isRoundTrip - if true, gradient is symmetric (teal→red→teal)
   */
  drawMultipleRoutes(routes, selectedIdx = 0, isRoundTrip = false, turnaroundLatLng = null) {
    this.clearAllRoutes();
    this.selectedRouteIndex = selectedIdx;
    this.isRoundTrip = isRoundTrip;
    this.turnaroundLatLng = turnaroundLatLng;
    this._redrawRoutes(routes, selectedIdx);
  }

  /**
   * Visually select a route among alternatives
   * @param {Array} routes - Current alternatives
   * @param {number} selectedIdx - Index to select
   * @param {boolean} triggeredByUI - If true, skip redraw if index unchanged (avoids double-draw)
   */
  selectRoute(routes, selectedIdx, triggeredByUI = false) {
    // Skip redundant redraw when triggered by UI after a map-click already updated things
    if (this.selectedRouteIndex === selectedIdx && triggeredByUI) return;

    this.selectedRouteIndex = selectedIdx;
    this._redrawRoutes(routes, selectedIdx);

    if (this.onRouteSelect && !triggeredByUI) {
      this.onRouteSelect(selectedIdx);
    }
  }

  /**
   * Internal: clear and redraw all route polylines for a given selection
   */
  _redrawRoutes(routes, selectedIdx) {
    this.routePolylines.forEach((pl) => this.map.removeLayer(pl));
    this.routePolylines = [];
    this.clearGradientRoute();

    // Draw alternative routes first (behind selected)
    for (const route of routes) {
      if (route.index === selectedIdx) continue;

      const color = ROUTE_COLORS[route.index % ROUTE_COLORS.length];
      const pl = L.polyline(route.coords, {
        color,
        weight: 3,
        opacity: ROUTE_ALT_OPACITY,
        smoothFactor: 1,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '8 6',
        className: `route-line route-${route.index}`,
      }).addTo(this.map);

      pl._routeIndex = route.index;
      pl.on('click', (e) => {
        L.DomEvent.stop(e);
        if (this.isFrozen) {
          this._notifyFrozenInteraction('route-select');
          return;
        }
        if (this._clickTimeout) {
          clearTimeout(this._clickTimeout);
          this._clickTimeout = null;
        } else {
          this._clickTimeout = setTimeout(() => {
            this._clickTimeout = null;
            this.selectRoute(routes, route.index);
          }, 300);
        }
      });
      pl.on('dblclick', (e) => {
        L.DomEvent.stop(e);
        if (this._clickTimeout) {
          clearTimeout(this._clickTimeout);
          this._clickTimeout = null;
        }
        pl.bringToFront();
      });
      pl.bindTooltip(route.label, {
        sticky: true,
        className: 'route-tooltip',
        direction: 'top',
        offset: [0, -10],
      });
      this._bindRouteHoverEvents(pl);
      this.routePolylines.push(pl);
    }

    // Draw selected route as continuous gradient on top
    const selectedRoute = routes.find((r) => r.index === selectedIdx);
    if (selectedRoute) {
      this._drawGradientRoute(selectedRoute.coords, this.isRoundTrip || false, this.turnaroundLatLng);
    }
  }

  /**
   * Draw the selected route as GRADIENT_CHUNKS small polylines colored by
   * position along the route (t=0 at start → t=1 at end).
   * @param {Array} routeCoords
   * @param {boolean} isRoundTrip - if true, gradient goes teal→red→teal (symmetric)
   */
  _drawGradientRoute(routeCoords, isRoundTrip = false, turnaroundLatLng = null) {
    this.clearGradientRoute();
    const N = routeCoords.length;
    if (N < 2) return;

    // Use distance-based interpolation for better visual matching with markers/chart
    const dists = cumulativeDistances(routeCoords);
    const totalD = dists[N - 1] || 1;

    // Compute leg IDs across the whole route — used for cycling overlapping
    // passes via dblclick. Segments are strictly defined as waypoint-to-waypoint.
    const legIds = this._computeLegIds(routeCoords, dists, isRoundTrip);
    this._currentRouteLegIds = legIds;
    this._currentRouteCum = dists;
    this._syncAllMarkerLegIds();
    this._drawSelectedRouteHit(routeCoords);

    // Find split distance closest to turnaround waypoint
    let splitD = -1;
    let splitIdx = -1;
    if (turnaroundLatLng && N > 2) {
      const [tlat, tlng] = turnaroundLatLng;
      let minSq = Infinity;
      for (let i = 1; i < N - 1; i++) {
        const dSq = (routeCoords[i][0] - tlat) ** 2 + (routeCoords[i][1] - tlng) ** 2;
        if (dSq < minSq) { minSq = dSq; splitIdx = i; }
      }
      if (splitIdx > 0) splitD = dists[splitIdx];
    }

    const chunks = Math.min(GRADIENT_CHUNKS, N - 1);
    const chunkSize = (N - 1) / chunks;

    for (let chunk = 0; chunk < chunks; chunk++) {
      const startI = Math.floor(chunk * chunkSize);
      const endI = Math.min(Math.floor((chunk + 1) * chunkSize), N - 1);
      if (endI <= startI) continue;
      const splitPoints = [startI];
      if (splitIdx > startI && splitIdx < endI) splitPoints.push(splitIdx);
      for (let i = startI + 1; i < endI; i++) {
        if (legIds[i] !== legIds[i - 1]) splitPoints.push(i);
      }
      splitPoints.push(endI);
      splitPoints.sort((a, b) => a - b);

      for (let i = 0; i < splitPoints.length - 1; i++) {
        const subStart = splitPoints[i];
        const subEnd = splitPoints[i + 1];
        if (subEnd <= subStart) continue;
        this._addGradientRouteChunk({
          routeCoords,
          dists,
          legIds,
          startI: subStart,
          endI: subEnd,
          totalD,
          splitD,
          splitIdx,
          isRoundTrip,
        });
      }
    }

    this._bringOutboundRouteSegmentsToFront();
  }

  _drawSelectedRouteHit(routeCoords) {
    if (this.routeHitPolyline) {
      this.map.removeLayer(this.routeHitPolyline);
      this.routeHitPolyline = null;
    }

    const pl = L.polyline(routeCoords, {
      color: '#000',
      weight: ROUTE_HIT_WEIGHT,
      opacity: 0.01,
      smoothFactor: 1,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: true,
      bubblingMouseEvents: false,
      className: 'route-hit-line',
    }).addTo(this.map);

    pl._isRouteHit = true;
    this._bindRouteHoverEvents(pl);
    this._bindGradientRouteEvents(pl);
    this.routeHitPolyline = pl;
  }

  _addGradientRouteChunk({ routeCoords, dists, legIds, startI, endI, totalD, splitD, splitIdx, isRoundTrip }) {
    const d = dists[startI];
    let color;
    let isReturn;
    if (splitD > 0) {
      if (startI < splitIdx) {
        color = interpolateRouteColor(d / splitD);
        isReturn = false;
      } else {
        const denom = totalD - splitD;
        const t = denom > 0 ? (d - splitD) / denom : 0;
        color = interpolateReturnColor(t);
        isReturn = true;
      }
    } else {
      const xFrac = d / totalD;
      const t = isRoundTrip ? (1 - Math.abs(2 * xFrac - 1)) : xFrac;
      color = interpolateRouteColor(t);
      isReturn = isRoundTrip && (xFrac >= 0.5);
    }

    const pl = L.polyline(routeCoords.slice(startI, endI + 1), {
      color,
      weight: 5,
      opacity: ROUTE_SELECTED_OPACITY,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
      className: 'route-gradient-line',
    }).addTo(this.map);

    const primaryLegId = legIds[startI] ?? 0;
    const legSet = new Set();
    for (let i = startI; i < endI; i++) legSet.add(legIds[i] ?? primaryLegId);
    if (legSet.size === 0) legSet.add(primaryLegId);
    pl._isReturn = isReturn;
    pl._legId = primaryLegId;
    pl._legIds = Array.from(legSet);
    pl._routeStartI = startI;
    pl._routeEndI = endI;
    pl._routeDrawOrder = this.gradientPolylines.length;

    this.gradientPolylines.push(pl);
  }

  _bringOutboundRouteSegmentsToFront() {
    this.gradientPolylines
      .filter((pl) => pl._isReturn === false)
      .forEach((pl) => pl.bringToFront());
  }

  /**
   * Compute leg IDs along a route. Segments are defined by the "main waypoints"
   * (this.waypoints). Handles outbound, return (if isRoundTrip), and O-loops.
   */
  _computeLegIds(routeCoords, cumDists, isRoundTrip) {
    const N = routeCoords.length;
    if (N < 2) return new Array(N).fill(0);
    const wps = this.waypoints;
    if (wps.length < 2) return new Array(N).fill(0);

    const distM = (a, b) => {
      const dLat = (b[0] - a[0]) * 111320;
      const meanLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
      const dLng = (b[1] - a[1]) * 111320 * Math.cos(meanLat);
      return Math.sqrt(dLat * dLat + dLng * dLng);
    };

    const boundaries = [0];
    let searchStart = 0;

    // 1. Forward Leg: Find waypoint indices WP0 -> WP1 -> ... -> WPN-1
    for (let i = 0; i < wps.length; i++) {
      let minD = Infinity, minIdx = searchStart;
      // Sequential search: find the first occurrence of each waypoint after the last one.
      // This correctly handles loops and self-intersections.
      for (let j = searchStart; j < N; j++) {
        const d = distM(wps[i], routeCoords[j]);
        if (d < minD) { minD = d; minIdx = j; }
        if (d < 5) break; // Close enough
      }
      if (minIdx > searchStart) boundaries.push(minIdx);
      searchStart = minIdx;
    }

    // 2. Return Leg (optional): WPN-1 -> WPN-2 -> ... -> WP0
    if (isRoundTrip) {
      for (let i = wps.length - 2; i >= 0; i--) {
        let minD = Infinity, minIdx = searchStart;
        for (let j = searchStart; j < N; j++) {
          const d = distM(wps[i], routeCoords[j]);
          if (d < minD) { minD = d; minIdx = j; }
          if (d < 5) break;
        }
        if (minIdx > searchStart) boundaries.push(minIdx);
        searchStart = minIdx;
      }
    } else {
      // Check for O-loop: does the route end back at the start waypoint?
      const endDistToStart = distM(routeCoords[N - 1], wps[0]);
      if (endDistToStart < 20 && searchStart < N - 10) {
        boundaries.push(N - 1);
      }
    }

    // Assign legId based on the boundary intervals
    const legIds = new Array(N).fill(0);
    let currentLeg = 0;
    for (let i = 0; i < N; i++) {
      while (currentLeg < boundaries.length - 1 && i >= boundaries[currentLeg + 1]) {
        currentLeg++;
      }
      legIds[i] = currentLeg;
    }
    return legIds;
  }

  clearGradientRoute() {
    if (this.routeHitPolyline) {
      this.map.removeLayer(this.routeHitPolyline);
      this.routeHitPolyline = null;
    }
    this.gradientPolylines.forEach((pl) => this.map.removeLayer(pl));
    this.gradientPolylines = [];
    this._overlapCycleState.clear();
  }

  /**
   * Set km-interval intermediate markers (compact icons with matching hitboxes)
   * @param {Array<{lat,lng,cumDistM}>} points
   */
  setIntermediateMarkers(points, totalDistM = 0, turnaroundDistM = null) {
    this.clearIntermediateMarkers();
    points.forEach((pt) => {
      let color;
      if (turnaroundDistM && turnaroundDistM > 0 && totalDistM > turnaroundDistM) {
        if (pt.cumDistM <= turnaroundDistM) {
          const t = Math.max(0, Math.min(1, pt.cumDistM / turnaroundDistM));
          color = interpolateRouteColor(t);
        } else {
          const t = Math.max(0, Math.min(1, (pt.cumDistM - turnaroundDistM) / (totalDistM - turnaroundDistM)));
          color = interpolateReturnColor(t);
        }
      } else {
        const tLinear = totalDistM > 0 ? Math.min(1, pt.cumDistM / totalDistM) : 0;
        const t = this.isRoundTrip ? 1 - Math.abs(2 * tLinear - 1) : tLinear;
        color = interpolateRouteColor(t);
      }

      const weatherHtml = this._weatherBadgeHtml(pt.weatherIcon);
      const labelHtml = pt.label ? `<div class="marker-external-label">${escapeHtml(pt.label)}</div>` : '';

      const icon = L.divIcon({
        className: 'intermediate-point-icon',
        html: `<div class="intermediate-point-inner" style="background: ${color};">${weatherHtml}</div>${labelHtml}`,
        iconSize: [INTERMEDIATE_MARKER_SIZE, INTERMEDIATE_MARKER_SIZE],
        iconAnchor: [INTERMEDIATE_MARKER_SIZE / 2, INTERMEDIATE_MARKER_SIZE / 2],
      });

      const marker = L.marker([pt.lat, pt.lng], {
        icon,
        interactive: true,
        zIndexOffset: INTERMEDIATE_Z_OFFSET,
      }).addTo(this.map);
      marker._colIdx = pt.colIdx;
      marker._addOrder = this.intermediateMarkers.length;
      marker._cumDistM = pt.cumDistM;
      marker._isReturn = pt.isReturn;
      marker._legId = this._legIdAtCumDist(pt.cumDistM);
      const bindIntermediateWeatherBadgeClick = () => {
        this._bindWeatherBadgeClick(marker, () => {
          if (pt.colIdx !== undefined) this.onWeatherBadgeClick?.(pt.colIdx, true);
        }, '_mappingElfIntermediateDomHandled');
      };
      bindIntermediateWeatherBadgeClick();
      setTimeout(bindIntermediateWeatherBadgeClick, 0);

      marker.on('click', (e) => {
        if (e.originalEvent?._mappingElfIntermediateDomHandled) return;
        if (Date.now() - this._lastMultiTouchAt < 700) {
          L.DomEvent.stopPropagation(e);
          return;
        }
        // Detect click on weather badge
        const target = e.originalEvent?.target;
        if (this._isWeatherCardDomTarget(target)) {
          L.DomEvent.stopPropagation(e);
          return;
        }
        if (target && target.closest && target.closest('.wp-weather-badge')) {
          L.DomEvent.stopPropagation(e);
          if (pt.colIdx !== undefined) this.onWeatherBadgeClick?.(pt.colIdx, true);
          return;
        }

        if (this.onIntermediateSelect) this.onIntermediateSelect(pt.lat, pt.lng);
      });

      marker.on('dblclick', (e) => {
        L.DomEvent.stop(e);
        if (Date.now() - this._lastMultiTouchAt < 700) return;
        this._cycleOverlappingLayers(null, marker.getLatLng());
      });

      let lpTimer = null;
      let startX = 0, startY = 0;
      const startLP = (e) => {
        const oe = e.originalEvent;
        if (oe?._mappingElfIntermediateDomHandled) return;
        if (this._isWeatherBadgeDomTarget(oe?.target)) return;
        if (this._isWeatherCardDomTarget(oe?.target)) {
          L.DomEvent.stopPropagation(oe);
          return;
        }
        if (this._isMultiTouchEvent(oe)) {
          this._noteMultiTouchGesture();
          return;
        }
        if (oe.button !== undefined && oe.button !== 0) return;
        const touch = oe.touches ? oe.touches[0] : oe;
        startX = touch.clientX;
        startY = touch.clientY;
        lpTimer = setTimeout(() => {
          lpTimer = null;
          platform.vibrate(40);
          this._cycleOverlappingLayers(null, marker.getLatLng());
        }, 500);
      };
      const moveLP = (e) => {
        if (!lpTimer) return;
        const oe = e.originalEvent;
        if (this._isMultiTouchEvent(oe)) {
          this._noteMultiTouchGesture();
          endLP();
          return;
        }
        const touch = oe.touches ? oe.touches[0] : oe;
        if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) {
          clearTimeout(lpTimer);
          lpTimer = null;
        }
      };
      const endLP = () => {
        if (lpTimer) {
          clearTimeout(lpTimer);
          lpTimer = null;
        }
      };
      marker.on('mousedown touchstart', startLP);
      marker.on('mousemove touchmove', moveLP);
      marker.on('mouseup touchend mouseleave touchcancel', endLP);
      this.intermediateMarkers.push(marker);
    });
    this._syncWeatherBadgeOpenStates();
  }

  clearIntermediateMarkers() {
    this.intermediateMarkers.forEach((m) => this.map.removeLayer(m));
    this.intermediateMarkers = [];
  }

  /**
   * Render markers for round-trip return-leg waypoints. Same size/shape as
   * outbound waypoint markers but with a dashed border, return-gradient
   * background, and a small "↩" badge so the two legs are easy to tell apart.
   * Markers paired by wpIndex can be display-layer toggled even when route
   * snapping leaves them slightly offset. The `is-stacked` class remains a
   * visual hint for pairs whose coordinates are close enough to overlap.
   *
   * @param {Array<{lat,lng,wpIndex,label,color,colIdx,weather,cumDistM,_cum}>} points
   */
  setReturnWaypoints(points) {
    this.clearReturnWaypoints();
    const list = points || [];

    const validReturnWpIndices = new Set(
      list
        .map((pt) => Number.isInteger(pt.wpIndex) ? pt.wpIndex : -1)
        .filter((idx) => idx >= 0 && idx < this.waypoints.length)
    );
    const isNearWaypoint = (pt, idx) => {
      const wp = this.waypoints[idx];
      if (!wp || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) return false;
      return L.latLng(pt.lat, pt.lng).distanceTo(L.latLng(wp[0], wp[1])) <= STACKED_WAYPOINT_TOLERANCE_M;
    };
    const newFlags = this.waypoints.map((_, idx) =>
      list.some((pt) => {
        if (Number.isInteger(pt.wpIndex)) return pt.wpIndex === idx && isNearWaypoint(pt, idx);
        return isNearWaypoint(pt, idx);
      })
    );
    const flagsChanged =
      newFlags.length !== this.stackedWaypointFlags.length ||
      newFlags.some((f, i) => f !== this.stackedWaypointFlags[i]);
    validReturnWpIndices.forEach((i) => {
      if (this.waypointLayerSwapped[i] === undefined) {
        this.waypointLayerSwapped[i] = true;
      }
    });
    this.stackedWaypointFlags = newFlags;
    if (flagsChanged) this._updateMarkerIcons();

    list.forEach((pt) => {
      const isStacked = Number.isInteger(pt.wpIndex)
        ? isNearWaypoint(pt, pt.wpIndex)
        : this.waypoints.some((_, idx) => isNearWaypoint(pt, idx));
      const icon = this._createReturnIcon(pt, isStacked);
      const marker = L.marker([pt.lat, pt.lng], { icon, interactive: true }).addTo(this.map);
      const cumDistM = Number.isFinite(pt.cumDistM)
        ? pt.cumDistM
        : (Number.isFinite(pt._cum) ? pt._cum : undefined);
      marker._colIdx = pt.colIdx;
      marker._wpIndex = pt.wpIndex;
      if (cumDistM !== undefined) marker._cumDistM = cumDistM;
      marker._isReturn = true;
      const legId = this._legIdAtCumDist(cumDistM);
      if (legId !== undefined) marker._legId = legId;

      const outboundOnTop = this.waypointLayerSwapped[pt.wpIndex] ?? true;
      this.waypointMarkers[pt.wpIndex]?.setZIndexOffset(
        WAYPOINT_Z_BASE + (outboundOnTop ? WAYPOINT_Z_PAIR_STEP : 0)
      );
      marker.setZIndexOffset(WAYPOINT_Z_BASE + (outboundOnTop ? 0 : WAYPOINT_Z_PAIR_STEP));

      let _returnDragActive = false;
      let _returnJustDragged = false;

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (e.originalEvent?._mappingElfReturnWaypointDomHandled) return;
        if (Date.now() - this._lastMultiTouchAt < 700) return;
        if (_returnDragActive || _returnJustDragged) return;
        // Detect click on weather badge
        const target = e.originalEvent?.target;
        if (this._isWeatherCardDomTarget(target)) return;
        if (target && target.closest && target.closest('.wp-weather-badge')) {
          if (pt.colIdx !== undefined) this.onWeatherBadgeClick?.(pt.colIdx, true);
          return;
        }
        if (pt.wpIndex !== undefined) this._scheduleWaypointSelect(pt.wpIndex, true, marker.getLatLng());
      });

      const handleReturnWaypointDoubleClick = (e) => {
        const oe = e?.originalEvent || e;
        oe?.preventDefault?.();
        oe?.stopPropagation?.();
        oe?.stopImmediatePropagation?.();
        L.DomEvent.stopPropagation(e?.originalEvent ? e : oe);
        if (Date.now() - this._lastMultiTouchAt < 700) return;
        this._clearWaypointClickTimeout();
        this._cycleWaypointLayerThenSelect(marker._wpIndex, true, marker.getLatLng());
      };

      marker.on('dblclick', handleReturnWaypointDoubleClick);

      // Long-press drags the paired editable waypoint; dblclick cycles overlapped layers.
      let _lpTimer = null;
      let _pendingClientX = 0, _pendingClientY = 0;
      let _returnTouchStartClientX = 0, _returnTouchStartClientY = 0;
      let _returnTouchTapMoved = false;
      let _lastReturnTouchTapAt = 0;
      let _lastReturnTouchTapX = 0;
      let _lastReturnTouchTapY = 0;
      let _returnGestureStarted = false;
      const getPointer = (oe) => oe?.touches?.[0] || oe?.changedTouches?.[0] || oe;
      const restoreMapDragging = () => {
        setTimeout(() => this.map.dragging.enable(), 0);
      };
      const beginReturnGesture = () => {
        if (_returnGestureStarted) return;
        _returnGestureStarted = true;
        this._beginWaypointGesture();
      };
      const endReturnGesture = () => {
        if (!_returnGestureStarted) return;
        _returnGestureStarted = false;
        this._endWaypointGesture();
      };
      const returnTouchMovedBeyondTapTolerance = (touch) => {
        if (!touch) return true;
        const dx = touch.clientX - _returnTouchStartClientX;
        const dy = touch.clientY - _returnTouchStartClientY;
        return dx * dx + dy * dy > WAYPOINT_TOUCH_TAP_MOVE_TOLERANCE_PX ** 2;
      };
      const handleReturnWaypointTouchTap = (oe) => {
        const touch = oe?.changedTouches?.[0] || getPointer(oe);
        if (
          !touch ||
          _returnDragActive ||
          _returnTouchTapMoved ||
          returnTouchMovedBeyondTapTolerance(touch) ||
          Date.now() - this._lastMultiTouchAt < 700
        ) {
          _lastReturnTouchTapAt = 0;
          return false;
        }

        const now = Date.now();
        const dx = touch.clientX - _lastReturnTouchTapX;
        const dy = touch.clientY - _lastReturnTouchTapY;
        const isDoubleTap =
          _lastReturnTouchTapAt > 0 &&
          now - _lastReturnTouchTapAt <= WAYPOINT_DOUBLE_TAP_DELAY_MS &&
          dx * dx + dy * dy <= WAYPOINT_DOUBLE_TAP_DISTANCE_PX ** 2;

        if (!isDoubleTap) {
          _lastReturnTouchTapAt = now;
          _lastReturnTouchTapX = touch.clientX;
          _lastReturnTouchTapY = touch.clientY;
          if (pt.wpIndex !== undefined) this._scheduleWaypointSelect(pt.wpIndex, true, marker.getLatLng());
          return false;
        }

        _lastReturnTouchTapAt = 0;
        handleReturnWaypointDoubleClick({ originalEvent: oe });
        return true;
      };

      const cleanupLPListeners = () => {
        document.removeEventListener('mouseup', cancelLP, true);
        document.removeEventListener('mousemove', moveLPFromDom, true);
        document.removeEventListener('touchend', cancelLP);
        document.removeEventListener('touchmove', moveLPFromDom);
        document.removeEventListener('touchcancel', cancelLP);
      };

      const cancelLP = () => {
        if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
        cleanupLPListeners();
        if (!_returnDragActive) restoreMapDragging();
        if (!_returnDragActive) endReturnGesture();
      };

      const clientPointToLatLng = (clientX, clientY, source, anchorOffset = null) => {
        const rect = this.map.getContainer().getBoundingClientRect();
        const yOffset = anchorOffset ? 0 : (source === 'touch' ? 40 : 0);
        return this.map.containerPointToLatLng([
          clientX - rect.left + (anchorOffset?.x ?? 0),
          clientY - rect.top - yOffset + (anchorOffset?.y ?? 0),
        ]);
      };

      const markerAnchorOffsetFromClient = (latlng, clientX, clientY) => {
        const rect = this.map.getContainer().getBoundingClientRect();
        const anchorPoint = this.map.latLngToContainerPoint(latlng);
        return {
          x: anchorPoint.x - (clientX - rect.left),
          y: anchorPoint.y - (clientY - rect.top),
        };
      };

      const startManualReturnDrag = (source, initialClientX, initialClientY, anchorClientX = initialClientX, anchorClientY = initialClientY) => {
        const pairedMarker = this.waypointMarkers[marker._wpIndex];
        if (!pairedMarker) {
          restoreMapDragging();
          endReturnGesture();
          return;
        }
        if (this.isFrozen) {
          this._notifyFrozenInteraction('waypoint-drag');
          restoreMapDragging();
          endReturnGesture();
          return;
        }

        _returnDragActive = true;
        _returnJustDragged = true;
        marker.getElement()?.classList.add('is-dragging');
        pairedMarker.getElement()?.classList.add('is-dragging');
        this.map.dragging.disable();
        this._beginWaypointDrag();
        const dragStartLatLng = pairedMarker.getLatLng();
        const dragAnchorOffset = markerAnchorOffsetFromClient(
          dragStartLatLng,
          anchorClientX,
          anchorClientY
        );
        this._startRubberBand(pairedMarker);

        let lastClientX = null;
        let lastClientY = null;

        const moveTo = (clientX, clientY) => {
          if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
          lastClientX = clientX;
          lastClientY = clientY;
          const latlng = clientPointToLatLng(clientX, clientY, source, dragAnchorOffset);
          pairedMarker.setLatLng(latlng);
          marker.setLatLng(latlng);
          this._updateRubberBand(latlng);
          this.updateTrashZoneHover(clientX, clientY);
        };

        const cleanupDragListeners = () => {
          document.removeEventListener('mousemove', onMouseMove, true);
          document.removeEventListener('mouseup', onPointerUp, true);
          document.removeEventListener('touchmove', onTouchMove, true);
          document.removeEventListener('touchend', onPointerUp, true);
          document.removeEventListener('touchcancel', onTouchCancel, true);
        };

        const finishDrag = (clientX, clientY, forcedDropAction = null) => {
          const dropAction = forcedDropAction || this.getTrashZoneDropAction(clientX, clientY);
          _returnDragActive = false;
          _returnJustDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          this.hideTrashZone();
          setTimeout(() => { _returnJustDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          pairedMarker.getElement()?.classList.remove('is-dragging');
          restoreMapDragging();
          cleanupDragListeners();

          const idx = this.waypointMarkers.indexOf(pairedMarker);
          try {
            if (idx < 0) return;
            if (dropAction === 'delete') {
              platform.vibrate([20, 40, 20]);
              this.removeWaypoint(idx);
            } else if (dropAction === 'cancel') {
              pairedMarker.setLatLng(dragStartLatLng);
              marker.setLatLng(dragStartLatLng);
            } else {
              const hasReleasePoint = Number.isFinite(clientX) && Number.isFinite(clientY);
              const pos = hasReleasePoint
                ? clientPointToLatLng(clientX, clientY, source, dragAnchorOffset)
                : pairedMarker.getLatLng();
              pairedMarker.setLatLng(pos);
              marker.setLatLng(pos);
              this.waypoints[idx] = [pos.lat, pos.lng];
              this._emitWaypointChange();
              this.onWaypointSelect?.(idx, (this.waypointLayerSwapped[idx] ?? true) === false);
            }
          } finally {
            this._endWaypointDrag();
            endReturnGesture();
          }
        };

        function onMouseMove(ev) {
          ev.stopPropagation();
          ev.preventDefault();
          moveTo(ev.clientX, ev.clientY);
        }

        const onTouchMove = (ev) => {
          if (this._isMultiTouchEvent(ev)) {
            this._noteMultiTouchGesture();
            finishDrag(lastClientX, lastClientY, 'cancel');
            return;
          }
          ev.preventDefault();
          const t = ev.touches[0];
          if (!t) return;
          moveTo(t.clientX, t.clientY);
        };

        const onPointerUp = (ev) => {
          ev.stopPropagation?.();
          ev.preventDefault?.();
          if (source === 'touch' && (this._isMultiTouchEvent(ev) || Date.now() - this._lastMultiTouchAt < 700)) {
            finishDrag(lastClientX, lastClientY, 'cancel');
            return;
          }
          const point = getPointer(ev);
          finishDrag(
            point?.clientX ?? lastClientX,
            point?.clientY ?? lastClientY
          );
        };

        const onTouchCancel = (ev) => {
          ev.stopPropagation?.();
          ev.preventDefault?.();
          finishDrag(lastClientX, lastClientY, 'cancel');
        };

        if (source === 'touch') {
          // Capture active drag events before marker DOM fallbacks can stop them.
          document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
          document.addEventListener('touchend', onPointerUp, true);
          document.addEventListener('touchcancel', onTouchCancel, true);
        } else {
          document.addEventListener('mousemove', onMouseMove, true);
          document.addEventListener('mouseup', onPointerUp, true);
        }
      };
      
      const startLP = (e) => {
        const oe = e.originalEvent;
        if (this._isWeatherBadgeDomTarget(oe?.target)) return;
        if (this._isWeatherCardDomTarget(oe?.target)) {
          L.DomEvent.stopPropagation(oe);
          return;
        }
        if (this._isMultiTouchEvent(oe)) {
          this._noteMultiTouchGesture();
          return;
        }
        if (oe.button !== undefined && oe.button !== 0) return;
        L.DomEvent.stopPropagation(oe);
        if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
        cleanupLPListeners();
        const point = getPointer(oe);
        if (!point) return;
        beginReturnGesture();
        _pendingClientX = point.clientX;
        _pendingClientY = point.clientY;
        _returnTouchStartClientX = point.clientX;
        _returnTouchStartClientY = point.clientY;
        _returnTouchTapMoved = false;
        const source = oe.touches || oe.type?.startsWith('touch') ? 'touch' : 'mouse';
        if (source === 'touch') {
          oe.preventDefault?.();
          this._clearNativeSelection();
        }
        this.map.dragging.disable();
        
        _lpTimer = setTimeout(() => {
          _lpTimer = null;
          cleanupLPListeners();
          platform.vibrate(40);
          startManualReturnDrag(
            source,
            _pendingClientX,
            _pendingClientY,
            _returnTouchStartClientX,
            _returnTouchStartClientY
          );
        }, 500);

        document.addEventListener('mouseup', cancelLP, true);
        document.addEventListener('mousemove', moveLPFromDom, true);
        document.addEventListener('touchend', cancelLP);
        document.addEventListener('touchmove', moveLPFromDom, { passive: true });
        document.addEventListener('touchcancel', cancelLP);
      };
      
      const moveLP = (e) => {
        if (!_lpTimer) return;
        if (this._isMultiTouchEvent(e.originalEvent)) {
          this._noteMultiTouchGesture();
          cancelLP();
          return;
        }
        const point = getPointer(e.originalEvent);
        if (!point) return;
        if (e.originalEvent?.touches) {
          e.originalEvent.preventDefault?.();
          this._clearNativeSelection();
          const dx = point.clientX - _returnTouchStartClientX;
          const dy = point.clientY - _returnTouchStartClientY;
          if (dx * dx + dy * dy > WAYPOINT_TOUCH_TAP_MOVE_TOLERANCE_PX ** 2) {
            _returnTouchTapMoved = true;
          }
        }
        _pendingClientX = point.clientX;
        _pendingClientY = point.clientY;
      };

      function moveLPFromDom(oe) {
        if (_lpTimer) {
          oe.stopPropagation?.();
          if (!oe.touches) oe.preventDefault?.();
        }
        moveLP({ originalEvent: oe });
      }

      marker.on('mousedown touchstart', (e) => {
        if (e.originalEvent?._mappingElfReturnWaypointDomHandled) return;
        startLP(e);
      });
      marker.on('mousemove touchmove', (e) => {
        if (e.originalEvent?._mappingElfReturnWaypointDomHandled) return;
        if (this._isWeatherCardDomTarget(e.originalEvent?.target)) return;
        moveLP(e);
      });
      marker.on('mouseup touchend', (e) => {
        if (e.originalEvent?._mappingElfReturnWaypointDomHandled) return;
        if (this._isWeatherCardDomTarget(e.originalEvent?.target)) return;
        if (e.originalEvent?.type?.startsWith('touch')) {
          handleReturnWaypointTouchTap(e.originalEvent);
        }
        cancelLP();
      });
      marker.on('touchcancel', cancelLP);
      marker.on('contextmenu', (e) => {
        L.DomEvent.stop(e);
        cancelLP();
        if (this.isFrozen) this._notifyFrozenInteraction('waypoint-drag');
      });

      const bindReturnWaypointDomFallback = () => {
        const el = marker.getElement?.();
        if (!el) return;
        this._bindWeatherBadgeClick(marker, () => {
          if (pt.colIdx !== undefined) this.onWeatherBadgeClick?.(pt.colIdx, true);
        }, '_mappingElfReturnWaypointDomHandled');
        if (el._mappingElfReturnWaypointDomBound) return;
        el._mappingElfReturnWaypointDomBound = true;

        const wrap = (handler) => (oe) => {
          if (this._isMultiTouchEvent(oe)) {
            this._noteMultiTouchGesture();
            cancelLP();
            return;
          }
          if (this._isWeatherCardDomTarget(oe.target)) {
            return;
          }
          if (this._isWeatherBadgeDomTarget(oe.target)) return;
          oe._mappingElfReturnWaypointDomHandled = true;
          oe.stopPropagation();
          handler({ originalEvent: oe });
        };

        el.addEventListener('mousedown', wrap(startLP), { capture: true });
        el.addEventListener('mousemove', wrap(moveLP), { capture: true });
        el.addEventListener('click', (oe) => {
          if (this._isWeatherCardDomTarget(oe.target)) {
            return;
          }
          if (this._isWeatherBadgeDomTarget(oe.target)) return;
          oe._mappingElfReturnWaypointDomHandled = true;
          oe.stopPropagation();
          oe.preventDefault();
          if (Date.now() - this._lastMultiTouchAt < 700) return;
          if (_returnDragActive || _returnJustDragged) return;
          if (pt.wpIndex !== undefined) {
            this._scheduleWaypointSelect(pt.wpIndex, true, marker.getLatLng());
          }
        }, { capture: true });
        el.addEventListener('dblclick', (oe) => {
          if (this._isWeatherCardDomTarget(oe.target)) {
            return;
          }
          if (this._isWeatherBadgeDomTarget(oe.target)) {
            oe.preventDefault?.();
            oe.stopPropagation?.();
            return;
          }
          oe._mappingElfReturnWaypointDomHandled = true;
          cancelLP();
          restoreMapDragging();
          handleReturnWaypointDoubleClick({ originalEvent: oe });
        }, { capture: true });
        el.addEventListener('mouseup', (oe) => {
          if (this._isWeatherCardDomTarget(oe.target)) {
            return;
          }
          if (this._isWeatherBadgeDomTarget(oe.target)) return;
          oe._mappingElfReturnWaypointDomHandled = true;
          cancelLP();
          if (oe.button !== 0 || Date.now() - this._lastMultiTouchAt < 700) return;
          if (_returnDragActive || _returnJustDragged) return;
          if (pt.wpIndex !== undefined) {
            this._scheduleWaypointSelect(pt.wpIndex, true, marker.getLatLng());
          }
        }, { capture: true });
        el.addEventListener('touchstart', wrap(startLP), { passive: false, capture: true });
        el.addEventListener('touchmove', wrap(moveLP), { passive: false, capture: true });
        el.addEventListener('touchend', (oe) => {
          if (this._isWeatherCardDomTarget(oe.target)) {
            return;
          }
          if (this._isWeatherBadgeDomTarget(oe.target)) return;
          oe._mappingElfReturnWaypointDomHandled = true;
          oe.stopPropagation();
          oe.preventDefault?.();
          handleReturnWaypointTouchTap(oe);
          cancelLP();
        }, { passive: false, capture: true });
        el.addEventListener('touchcancel', (oe) => {
          if (this._isWeatherCardDomTarget(oe.target)) {
            return;
          }
          if (this._isWeatherBadgeDomTarget(oe.target)) return;
          oe._mappingElfReturnWaypointDomHandled = true;
          oe.stopPropagation();
          cancelLP();
        }, { passive: true, capture: true });
      };

      marker._bindReturnWaypointDomFallback = bindReturnWaypointDomFallback;
      bindReturnWaypointDomFallback();
      setTimeout(bindReturnWaypointDomFallback, 0);
      this.returnWaypointMarkers.push(marker);
    });
    this._restoreWaypointHighlightDom();
    this._syncWeatherBadgeOpenStates();
  }

  clearReturnWaypoints() {
    this.returnWaypointMarkers.forEach((m) => this.map.removeLayer(m));
    this.returnWaypointMarkers = [];
    if (this.stackedWaypointFlags.some(Boolean)) {
      this.stackedWaypointFlags = this.waypoints.map(() => false);
      this._updateMarkerIcons();
    }
  }

  _createReturnIcon(pt, isStacked) {
    const total = this.waypoints.length;
    const isEndpoint = (pt.wpIndex === 0 || pt.wpIndex === total - 1) && total > 1;
    const size = isEndpoint ? 40 : 36;
    const num = (pt.wpIndex ?? 0) + 1;
    const weatherHtml = this._weatherBadgeHtml(pt.weather);
    const labelHtml = pt.label ? `<div class="marker-external-label">${escapeHtml(pt.label)}</div>` : '';
    const innerStyle = pt.color
      ? `style="--wp-pin-fill:${pt.color}; --wp-pin-glow-color:${pt.color};"`
      : '';
    const cls = `custom-waypoint-icon return-leg${isStacked ? ' is-stacked' : ''}`;
    const metrics = waypointPinMetrics(size);
    return L.divIcon({
      className: cls,
      html:
        `<div class="wp-pin-shell">${weatherHtml}` +
        `<div class="wp-icon-inner" ${innerStyle}>` +
        `${waypointPinSvgHtml()}<span>${num}</span></div></div>${labelHtml}`,
      iconSize: [metrics.width, metrics.height],
      iconAnchor: metrics.anchor,
    });
  }

  clearAllRoutes() {
    this.routePolylines.forEach((pl) => this.map.removeLayer(pl));
    this.routePolylines = [];
    this.selectedRouteIndex = 0;
    this.clearHoverMarker();
    this.clearIntermediateMarkers();
    this.clearReturnWaypoints();
    this.clearGradientRoute();
  }

  // Keep clearRoute as alias
  clearRoute() {
    this.clearAllRoutes();
  }

  showHoverMarker(lat, lng, color = null) {
    const styleStr = color ? `background-color: ${color}; box-shadow: 0 0 0 1.5px rgba(255,255,255,0.9), 0 0 7px ${color};` : '';
    const html = color ? `<div style="width:100%; height:100%; border-radius:50%; ${styleStr}"></div>` : '';
    if (!this.hoverMarker) {
      const icon = L.divIcon({
        className: color ? '' : 'elevation-hover-marker',
        html: html,
        iconSize: [HOVER_MARKER_SIZE, HOVER_MARKER_SIZE],
        iconAnchor: [HOVER_MARKER_SIZE / 2, HOVER_MARKER_SIZE / 2],
      });
      this.hoverMarker = L.marker([lat, lng], { icon, interactive: false }).addTo(this.map);
    } else {
      this.hoverMarker.setLatLng([lat, lng]);
      if (color) {
        this.hoverMarker.setIcon(L.divIcon({
          className: '',
          html: html,
          iconSize: [HOVER_MARKER_SIZE, HOVER_MARKER_SIZE],
          iconAnchor: [HOVER_MARKER_SIZE / 2, HOVER_MARKER_SIZE / 2],
        }));
      }
    }
  }

  clearHoverMarker() {
    if (this.hoverMarker) {
      this.map.removeLayer(this.hoverMarker);
      this.hoverMarker = null;
    }
  }

  fitToRoute() {
    // Sync Leaflet's cached map size with the current DOM dimensions.
    // The map container can be resized by CSS (e.g. bottom panel drag) without
    // Leaflet knowing — invalidateSize must be called before fitBounds so the
    // padding calculations use the correct canvas size.
    this.map.invalidateSize({ animate: false });

    // Account for the side panel (right) and bottom weather panel overlaying the map
    const panelEl = document.querySelector('.side-panel.open');
    const rightPad = panelEl ? panelEl.offsetWidth + 50 : 50;
    // Bottom panel overlays the map on mobile (map-container bottom: 0), but on
    // desktop the map container is already clipped above it — avoid double-counting.
    const mapContainer = document.querySelector('.map-container');
    const mapBottomOffset = mapContainer ? parseInt(getComputedStyle(mapContainer).bottom) || 0 : 0;
    const bottomPanelEl = document.getElementById('bottom-panel');
    const bottomPad = (mapBottomOffset === 0 && bottomPanelEl) ? bottomPanelEl.offsetHeight + 50 : 50;
    const fitOpts = {
      paddingTopLeft: [50, 50],
      paddingBottomRight: [rightPad, bottomPad],
    };

    const allPl = [...this.routePolylines, ...this.gradientPolylines];
    if (allPl.length > 0) {
      const bounds = L.latLngBounds([]);
      allPl.forEach((pl) => bounds.extend(pl.getBounds()));
      this.map.fitBounds(bounds, fitOpts);
    } else if (this.waypoints.length > 0) {
      const bounds = L.latLngBounds(this.waypoints.map((w) => [w[0], w[1]]));
      this.map.fitBounds(bounds, fitOpts);
    }
  }

  goToMyLocation() {
    return platform.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }).then((pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      this.map.invalidateSize({ animate: false });
      this.map.setView([lat, lng], Math.max(this.map.getZoom(), 14), { animate: true });
      // Drop a map cursor at the GPS fix instead of adding a waypoint —
      // user can long-press the cursor to set as waypoint / copy / show weather.
      this.setMapCursor(lat, lng);
      this.onGpsFix?.(lat, lng);
      return { lat, lng };
    });
  }

  setWaypointsFromImport(coords, metadata = null) {
    // Suppress per-waypoint callbacks — fire once at the end to avoid
    // repeated route recalculations and weather panel re-renders during import.
    const cb = this.onWaypointChange;
    this.onWaypointChange = () => { };
    // Clear waypoint markers only. Do NOT call clearWaypoints() here: it also
    // clears the route polyline, wiping the imported track that was drawn
    // just before this call in _applyImportedResultCore / restoreImportedTrack.
    this.waypointMarkers.forEach((m) => this.map.removeLayer(m));
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = [];
    this.waypointColors = [];
    this.waypointLabels = [];
    this.waypointMetadata = [];
    coords.forEach((c, i) => {
      const [lat, lng] = Array.isArray(c) ? c : [c.lat, c.lng];
      const meta = (Array.isArray(c) ? null : c.meta) || (metadata ? metadata[i] : null);
      this.addWaypoint(lat, lng);
      if (meta) this.setWaypointMetadata(this.waypoints.length - 1, meta);
    });
    this.onWaypointChange = cb;
    this.fitToRoute();
    cb(this.waypoints);
  }

  _weatherBadgeHtml(icon) {
    const hasWeather = !!icon;
    return `<div class="wp-weather-badge${hasWeather ? ' is-loaded' : ' is-placeholder'}">` +
      `<span class="wp-weather-badge-face">${buildWeatherRoundIconHtml(icon || '?')}</span>` +
      '<div class="wp-weather-card-slot"></div>' +
      '</div>';
  }

  _findWeatherTargetMarker(colIdx, isIntermediate = false, waypointIndex = -1, isReturn = false) {
    if (isIntermediate) {
      return this.intermediateMarkers.find(m => m._colIdx === colIdx) || null;
    }
    if (isReturn) {
      return this.returnWaypointMarkers.find(m => m._colIdx === colIdx)
        || this.returnWaypointMarkers.find(m => m._wpIndex === waypointIndex)
        || null;
    }
    if (waypointIndex >= 0) return this.waypointMarkers[waypointIndex] || null;
    return this.waypointMarkers[colIdx] || null;
  }

  _weatherBadgeForMarker(marker) {
    return marker?.getElement?.()?.querySelector('.wp-weather-badge') || null;
  }

  _weatherCardSlotForBadge(badge) {
    if (!badge) return null;
    let slot = badge.querySelector('.wp-weather-card-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'wp-weather-card-slot';
      badge.appendChild(slot);
    }
    return slot;
  }

  _mobileWeatherCardLayer() {
    let layer = document.getElementById('mobile-weather-card-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'mobile-weather-card-layer';
      layer.className = 'wp-weather-card-slot mobile-weather-card-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  _shouldUseMobileWeatherCardLayer(htmlContent = '') {
    return window.matchMedia?.('(max-width: 768px)').matches
      && /\bweather-card\b[^>]*\bfull\b/.test(htmlContent);
  }

  _isWeatherCardDomTarget(target) {
    return !!target?.closest?.('.weather-card');
  }

  _isWeatherBadgeDomTarget(target) {
    return !!target?.closest?.('.wp-weather-badge') && !this._isWeatherCardDomTarget(target);
  }

  _bindWeatherBadgeClick(marker, notify, handledFlag = '_mappingElfWeatherBadgeClickHandled') {
    const el = marker?.getElement?.();
    if (!el || el._mappingElfWeatherBadgeClickBound) return;
    el._mappingElfWeatherBadgeClickBound = true;

    el.addEventListener('click', (oe) => {
      if (!this._isWeatherBadgeDomTarget(oe.target)) return;
      oe[handledFlag] = true;
      oe.preventDefault?.();
      oe.stopPropagation?.();
      oe.stopImmediatePropagation?.();
      notify?.();
    }, { capture: true });
  }

  _attachWeatherPopupEntry(colIdx, entry) {
    if (!entry) return false;
    const targetMarker = this._findWeatherTargetMarker(
      colIdx,
      !!entry.isIntermediate,
      Number.isInteger(entry.waypointIndex) ? entry.waypointIndex : -1,
      !!entry.isReturn
    ) || entry.marker;
    if (!targetMarker) return false;

    const badge = this._weatherBadgeForMarker(targetMarker);
    const useMobileLayer = this._shouldUseMobileWeatherCardLayer(entry.htmlContent);
    const slot = useMobileLayer ? this._mobileWeatherCardLayer() : this._weatherCardSlotForBadge(badge);
    if (!badge || !slot) return false;

    const needsRender = !slot.querySelector('.weather-card');
    if (needsRender && !entry.htmlContent) return false;
    entry.marker = targetMarker;
    entry.badge = badge;
    if (entry.slot && entry.slot !== slot) entry.slot.innerHTML = '';
    entry.slot = slot;

    badge.classList.remove('is-card-closing');
    badge.classList.add('is-card-open');
    targetMarker.getElement?.()?.classList.add('has-weather-card');

    if (needsRender && entry.htmlContent) {
      slot.innerHTML = entry.htmlContent;
    }

    L.DomEvent.disableClickPropagation(slot);
    L.DomEvent.disableScrollPropagation(slot);
    const card = slot.querySelector('.weather-card');
    if (card) {
      L.DomEvent.disableClickPropagation(card);
      L.DomEvent.disableScrollPropagation(card);
      if (needsRender && entry.onReady) entry.onReady(slot);
    }
    return true;
  }

  _syncWeatherBadgeOpenStates() {
    this._weatherPopups.forEach((entry, colIdx) => {
      this._attachWeatherPopupEntry(colIdx, entry);
    });
  }

  _createIcon(index) {
    const total = this.waypoints.length;
    let cls = '';
    if (index === 0 && total > 1) cls = 'start';
    else if (index === total - 1 && total > 1) cls = 'end';
    if (this.stackedWaypointFlags?.[index]) cls += (cls ? ' ' : '') + 'is-stacked';

    const weather = this.waypointWeather[index];
    const weatherHtml = this._weatherBadgeHtml(weather);

    const isEndpoint = (index === 0 || index === total - 1) && total > 1;
    const size = isEndpoint ? 40 : 36;
    const labelText = this.waypointLabels[index];
    const externalLabelText = labelText ? `${index + 1}. ${labelText}` : '';
    const externalLabel = externalLabelText
      ? `<div class="marker-external-label" data-label="${escapeHtml(externalLabelText)}" aria-label="${escapeHtml(externalLabelText)}"></div>`
      : '';
    const metrics = waypointPinMetrics(size);

    return L.divIcon({
      className: `custom-waypoint-icon ${cls}`,
      html:
        `<div class="wp-pin-shell">${weatherHtml}` +
        `<div class="wp-icon-inner">${waypointPinSvgHtml()}<span>${index + 1}</span></div>` +
        `</div>${externalLabel}`,
      iconSize: [metrics.width, metrics.height],
      iconAnchor: metrics.anchor,
    });
  }

  _updateMarkerIcons(force = false) {
    if (!force && this.isWaypointDragging()) {
      this._deferWaypointIconUpdate();
      return;
    }
    this.waypointMarkers.forEach((marker, i) => this._refreshWaypointIcon(i));
    this._syncWeatherBadgeOpenStates();
  }

  /** Apply the stored gradient color to a marker's DOM element. */
  _applyColorToMarker(marker, index) {
    const color = this.waypointColors[index];
    if (!color) return;
    const el = marker.getElement();
    if (el) {
      const inner = el.querySelector('.wp-icon-inner');
      if (inner) {
        inner.style.setProperty('--wp-pin-fill', color);
        inner.style.setProperty('--wp-pin-glow-color', color);
      }
    }
  }

  _bindRouteHoverEvents(polyline) {
    polyline.on('mousemove', (e) => {
      if (this.onRouteHover) this.onRouteHover(e.latlng.lat, e.latlng.lng);
    });
    polyline.on('mouseout', () => {
      if (this.onRouteHover) this.onRouteHover(null, null);
    });
  }

  _bindGradientRouteEvents(polyline) {
    let lpTimer = null;
    let lpTriggered = false;
    let startX = 0, startY = 0;
    let startSource = 'mouse';
    let routeInsertDragActive = false;
    let routeInsertPreview = null;
    let routeInsertLatLng = null;
    let routeInsertIndex = null;

    const domEventPoint = (oe) => {
      const touch = oe.touches?.[0] || oe.changedTouches?.[0] || oe;
      return touch ? { x: touch.clientX, y: touch.clientY } : { x: 0, y: 0 };
    };

    const domEventSource = (oe) => (
      oe?.type?.startsWith('touch') || oe?.touches || oe?.changedTouches ? 'touch' : 'mouse'
    );

    const domEventLatLng = (oe) => {
      const point = domEventPoint(oe);
      const rect = this.map.getContainer().getBoundingClientRect();
      return this.map.containerPointToLatLng([point.x - rect.left, point.y - rect.top]);
    };

    const startLongPress = (oe, latlng) => {
      if (this._isMultiTouchEvent(oe)) {
        this._noteMultiTouchGesture();
        return;
      }
      if (oe.button !== undefined && oe.button !== 0) return;
      lpTriggered = false;
      const point = domEventPoint(oe);
      startX = point.x;
      startY = point.y;
      startSource = domEventSource(oe);

      lpTimer = setTimeout(() => {
        lpTimer = null;
        lpTriggered = true;
        if (this.isFrozen) {
          this._notifyFrozenInteraction('route-edit');
          return;
        }
        platform.vibrate(40);
        startRouteInsertDrag(latlng, startSource);
      }, 500);
    };

    const moveLongPress = (oe) => {
      if (!lpTimer) return;
      if (this._isMultiTouchEvent(oe)) {
        this._noteMultiTouchGesture();
        clearTimeout(lpTimer);
        lpTimer = null;
        return;
      }
      const point = domEventPoint(oe);
      const source = domEventSource(oe);
      const tolerance = ROUTE_LONG_PRESS_MOVE_TOLERANCE_PX[source] ?? ROUTE_LONG_PRESS_MOVE_TOLERANCE_PX.mouse;
      if (Math.hypot(point.x - startX, point.y - startY) > tolerance) {
        clearTimeout(lpTimer);
        lpTimer = null;
        this._debugRouteLayerCycle('long-press-cancelled-by-move', { source, tolerance });
      }
    };

    const endLongPress = () => {
      if (routeInsertDragActive) return;
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = null;
      }
    };

    const cleanupRouteInsertDrag = () => {
      document.removeEventListener('mousemove', onRouteInsertMouseMove);
      document.removeEventListener('mouseup', onRouteInsertMouseUp);
      document.removeEventListener('touchmove', onRouteInsertTouchMove);
      document.removeEventListener('touchend', onRouteInsertTouchEnd);
      document.removeEventListener('touchcancel', onRouteInsertTouchCancel);
    };

    const updateRouteInsertPreview = (latlng) => {
      routeInsertLatLng = latlng;
      if (!routeInsertPreview) {
        routeInsertPreview = L.circleMarker(latlng, {
          radius: 8,
          color: '#fbbf24',
          weight: 3,
          fillColor: '#f59e0b',
          fillOpacity: 0.85,
          opacity: 1,
          interactive: false,
          pane: 'markerPane',
          className: 'route-insert-preview-marker',
        }).addTo(this.map);
      } else {
        routeInsertPreview.setLatLng(latlng);
      }
    };

    const finishRouteInsertDrag = (oe, shouldCommit = true) => {
      if (!routeInsertDragActive) return;
      routeInsertDragActive = false;
      cleanupRouteInsertDrag();
      this.map.dragging.enable();
      this._blockMapClick();

      if (oe && shouldCommit) {
        updateRouteInsertPreview(domEventLatLng(oe));
      }

      const latlng = routeInsertLatLng;
      const insertIndex = routeInsertIndex;
      if (routeInsertPreview) {
        this.map.removeLayer(routeInsertPreview);
        routeInsertPreview = null;
      }
      routeInsertLatLng = null;
      routeInsertIndex = null;

      if (shouldCommit && latlng) {
        this.addWaypoint(latlng.lat, latlng.lng, insertIndex ?? this._findInsertionIndex(latlng));
      }
    };

    function onRouteInsertMouseMove(ev) {
      updateRouteInsertPreview(domEventLatLng(ev));
    }

    function onRouteInsertMouseUp(ev) {
      finishRouteInsertDrag(ev, true);
    }

    const onRouteInsertTouchMove = (ev) => {
      if (this._isMultiTouchEvent(ev)) {
        this._noteMultiTouchGesture();
        finishRouteInsertDrag(ev, false);
        return;
      }
      ev.preventDefault();
      updateRouteInsertPreview(domEventLatLng(ev));
    };

    const onRouteInsertTouchEnd = (ev) => {
      if (this._isMultiTouchEvent(ev) || Date.now() - this._lastMultiTouchAt < 700) {
        this._noteMultiTouchGesture();
        finishRouteInsertDrag(ev, false);
        return;
      }
      finishRouteInsertDrag(ev, true);
    };

    function onRouteInsertTouchCancel(ev) {
      finishRouteInsertDrag(ev, false);
    }

    const startRouteInsertDrag = (latlng, source) => {
      routeInsertDragActive = true;
      routeInsertIndex = this._findInsertionIndex(latlng);
      updateRouteInsertPreview(latlng);
      this.map.dragging.disable();

      if (source === 'touch') {
        document.addEventListener('touchmove', onRouteInsertTouchMove, { passive: false });
        document.addEventListener('touchend', onRouteInsertTouchEnd);
        document.addEventListener('touchcancel', onRouteInsertTouchCancel);
      } else {
        document.addEventListener('mousemove', onRouteInsertMouseMove);
        document.addEventListener('mouseup', onRouteInsertMouseUp);
      }
    };

    polyline.on('mousedown touchstart', (e) => {
      if (e.originalEvent?._mappingElfRouteDomHandled) return;
      startLongPress(e.originalEvent, e.latlng);
    });

    polyline.on('mousemove touchmove', (e) => {
      if (e.originalEvent?._mappingElfRouteDomHandled) return;
      moveLongPress(e.originalEvent);
    });

    polyline.on('mouseup touchend mouseleave touchcancel', endLongPress);

    polyline.on('click', (e) => {
      L.DomEvent.stop(e);
      if (Date.now() - this._lastMultiTouchAt < 700) return;
      if (lpTriggered || routeInsertDragActive) return;
      if (this.isFrozen) {
        this._notifyFrozenInteraction('route-edit');
        return;
      }

      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      } else {
        this._clickTimeout = setTimeout(() => {
          this._clickTimeout = null;
          // 單擊恢復為新增航點
          const insertIdx = this._findInsertionIndex(e.latlng);
          this.addWaypoint(e.latlng.lat, e.latlng.lng, insertIdx);
        }, 300);
      }
    });

    polyline.on('dblclick', (e) => {
      if (e.originalEvent?._mappingElfRouteDomHandled) return;
      L.DomEvent.stop(e);
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      }
      // 雙擊保留切換功能
      this._cycleOverlappingLayers(polyline, e.latlng, { source: 'mouse' });
    });

    const el = polyline.getElement?.();
    if (!el) return;

    const bindPathEvent = (types, handler, opts = {}) => {
      types.forEach((type) => el.addEventListener(type, handler, opts));
    };
    bindPathEvent(['mousedown', 'touchstart'], (oe) => {
      oe._mappingElfRouteDomHandled = true;
      startLongPress(oe, domEventLatLng(oe));
    }, { passive: true, capture: true });
    bindPathEvent(['mousemove', 'touchmove'], (oe) => {
      oe._mappingElfRouteDomHandled = true;
      moveLongPress(oe);
    }, { passive: true, capture: true });
    bindPathEvent(['mouseup', 'touchend', 'mouseleave', 'touchcancel'], (oe) => {
      oe._mappingElfRouteDomHandled = true;
      endLongPress();
    }, { passive: true, capture: true });
    bindPathEvent(['dblclick'], (oe) => {
      oe._mappingElfRouteDomHandled = true;
      oe.preventDefault();
      oe.stopPropagation();
      oe.stopImmediatePropagation?.();
      L.DomEvent.stop(oe);
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      }
      this._cycleOverlappingLayers(polyline, domEventLatLng(oe), { source: domEventSource(oe) });
    }, { capture: true });
  }

  /**
   * Look up the leg id at a given cumulative distance along the current route.
   * Uses binary search on this._currentRouteCum (cumulative distance per coord).
   */
  _legIdAtCumDist(cumDistM) {
    const cum = this._currentRouteCum;
    const legs = this._currentRouteLegIds;
    if (!cum || !legs || !Number.isFinite(cumDistM)) return undefined;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < cumDistM) lo = mid + 1;
      else hi = mid;
    }
    return legs[lo] ?? 0;
  }

  /**
   * On dblclick: send the entire leg the clicked chunk belongs to (all chunks
   * sharing the same _legId) to the back, exposing whatever leg sat underneath.
   * Repeated dblclicks rotate through any number of overlapping passes — round
   * trips, multi-turnaround, figure-8, repeated laps, arbitrary self-crossings.
   * Falls back to spatial proximity grouping if leg ids weren't computed.
   */
  _cycleOverlappingLayers(clickedObject, latlng, options = {}) {
    if (!this.gradientPolylines.length) {
      this._debugRouteLayerCycle('no-gradient-polylines', options);
      return false;
    }

    // Refresh leg IDs on all markers to ensure they match current route state
    this._syncAllMarkerLegIds();

    const source = options.source === 'touch' ? 'touch' : 'mouse';
    const proximityPx = options.proximityPx ?? ROUTE_OVERLAP_PROXIMITY_PX[source] ?? ROUTE_OVERLAP_PROXIMITY_PX.mouse;
    const nearby = this._findOverlappingRouteChunks(latlng, clickedObject, { proximityPx });
    const legs = this._uniqueNearbyLegs(nearby);
    if (nearby.length < 2) {
      this._debugRouteLayerCycle('nearby-chunks-too-few', { source, proximityPx, nearby: nearby.length, legs });
    }
    if (legs.length < 2) {
      this._debugRouteLayerCycle('nearby-legs-too-few', { source, proximityPx, nearby: nearby.length, legs });
      return false;
    }

    const key = this._overlapStackKey(legs);
    const clickedLegs = this._polylineLegIds(clickedObject);
    const clickedLeg = clickedLegs.find((leg) => legs.includes(leg));
    const previousLeg = this._overlapCycleState.has(key)
      ? this._overlapCycleState.get(key)
      : (clickedLeg !== undefined ? clickedLeg : (this._frontmostNearbyLeg(nearby, legs) ?? legs[0]));
    const previousIdx = Math.max(0, legs.indexOf(previousLeg));
    const nextLeg = legs[(previousIdx + 1) % legs.length];
    this._overlapCycleState.set(key, nextLeg);

    this._bringOverlapLegToFront(legs, nextLeg);
    this._syncOverlapMarkerStack(legs, nextLeg, latlng);
    this._debugRouteLayerCycle('switched', { source, proximityPx, legs, previousLeg, nextLeg });
    return true;
  }

  _findOverlappingRouteChunks(latlng, clickedObject = null, options = {}) {
    const clickPx = this.map.latLngToContainerPoint(latlng);
    const proximityPx = options.proximityPx ?? ROUTE_OVERLAP_PROXIMITY_PX.mouse;
    const near = [];

    const segmentDistancePx = (p, a, b) => {
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const wx = p.x - a.x;
      const wy = p.y - a.y;
      const lenSq = vx * vx + vy * vy;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq)) : 0;
      const x = a.x + t * vx;
      const y = a.y + t * vy;
      return Math.hypot(p.x - x, p.y - y);
    };

    const minDistanceToPolyline = (pl) => {
      const coords = pl.getLatLngs();
      if (!coords || coords.length === 0) return Infinity;
      if (coords.length === 1) {
        const px = this.map.latLngToContainerPoint(coords[0]);
        return Math.hypot(px.x - clickPx.x, px.y - clickPx.y);
      }
      let minD = Infinity;
      for (let i = 0; i < coords.length - 1; i++) {
        const a = this.map.latLngToContainerPoint(coords[i]);
        const b = this.map.latLngToContainerPoint(coords[i + 1]);
        minD = Math.min(minD, segmentDistancePx(clickPx, a, b));
      }
      return minD;
    };

    this.gradientPolylines.forEach((pl) => {
      const d = minDistanceToPolyline(pl);
      if (d <= proximityPx) near.push({ pl, d });
    });
    if (clickedObject?.getLatLngs && !near.some((item) => item.pl === clickedObject)) {
      near.push({ pl: clickedObject, d: 0 });
    }
    return near.sort((a, b) => a.d - b.d || (a.pl._routeDrawOrder ?? 0) - (b.pl._routeDrawOrder ?? 0));
  }

  _uniqueNearbyLegs(nearby) {
    const seen = new Set();
    const legs = [];
    nearby.forEach(({ pl }) => {
      this._polylineLegIds(pl).forEach((id) => {
        if (id === undefined || seen.has(id)) return;
        seen.add(id);
        legs.push(id);
      });
    });
    return legs.sort((a, b) => a - b);
  }

  _frontmostNearbyLeg(nearby, legs) {
    const legSet = new Set(legs);
    let frontLeg;
    let frontIndex = -1;
    nearby.forEach(({ pl }) => {
      const matchingLegs = this._polylineLegIds(pl).filter((id) => legSet.has(id));
      if (!matchingLegs.length) return;
      const el = pl.getElement?.();
      const idx = el?.parentNode ? Array.prototype.indexOf.call(el.parentNode.children, el) : -1;
      if (idx > frontIndex) {
        frontIndex = idx;
        frontLeg = matchingLegs[0];
      }
    });
    return frontLeg;
  }

  _polylineLegIds(polyline) {
    if (!polyline) return [];
    const ids = [];
    if (polyline._legId !== undefined) ids.push(polyline._legId);
    if (Array.isArray(polyline._legIds)) {
      polyline._legIds.forEach((id) => {
        if (id !== undefined && !ids.includes(id)) ids.push(id);
      });
    }
    return ids;
  }

  _markerLegIds(marker) {
    if (!marker) return [];
    const ids = [];
    if (marker._legId !== undefined) ids.push(marker._legId);
    if (Array.isArray(marker._legIds)) {
      marker._legIds.forEach((id) => {
        if (id !== undefined && !ids.includes(id)) ids.push(id);
      });
    }
    return ids;
  }

  _routeLegIsReturn(legId) {
    const chunks = this.gradientPolylines.filter((pl) => this._polylineLegIds(pl).includes(legId));
    if (!chunks.length) return null;
    const returnCount = chunks.filter((pl) => pl._isReturn === true).length;
    const outboundCount = chunks.filter((pl) => pl._isReturn === false).length;
    if (returnCount === outboundCount) return null;
    return returnCount > outboundCount;
  }

  _debugRouteLayerCycle(reason, details = {}) {
    try {
      if (localStorage.getItem(ROUTE_LAYER_DEBUG_KEY) !== '1') return;
      console.debug('[MappingElf route-layer-cycle]', reason, details);
    } catch (_) {
      // Ignore storage access failures; route cycling should never depend on debug logging.
    }
  }

  _overlapStackKey(legs) {
    return legs.join('|');
  }

  _bringOverlapLegToFront(legs, topLeg) {
    const ordered = legs.filter((leg) => leg !== topLeg).concat(topLeg);
    ordered.forEach((leg) => {
      this.gradientPolylines
        .filter((pl) => this._polylineLegIds(pl).includes(leg))
        .forEach((pl) => pl.bringToFront());
    });
  }

  _syncOverlapMarkerStack(legs, topLeg, clickLatLng) {
    const legSet = new Set(legs);
    const allMarkers = [
      ...this.intermediateMarkers,
      ...this.waypointMarkers,
      ...this.returnWaypointMarkers,
    ];

    const markerLegs = (m) => this._markerLegIds(m);
    const matchesAny = (m) => markerLegs(m).some((id) => legSet.has(id));
    const matchesTop = (m) => markerLegs(m).includes(topLeg);
    const switchablePairKey = (m) => {
      const idx = m._wpIndex ?? this.waypointMarkers.indexOf(m);
      return idx >= 0 && this._hasReturnWaypointPair(idx) ? `wp:${idx}` : null;
    };
    const coordKey = (m) => {
      const pairKey = switchablePairKey(m);
      if (pairKey) return pairKey;
      const ll = m.getLatLng();
      return `${Math.round(ll.lat * 100000)},${Math.round(ll.lng * 100000)}`;
    };
    const groups = new Map();
    allMarkers.filter(matchesAny).forEach((m) => {
      const key = coordKey(m);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });
    const nearClick = (m) => !clickLatLng || m.getLatLng().distanceTo(clickLatLng) <= 30;
    const candidates = [];
    groups.forEach((group) => {
      const groupLegs = new Set();
      group.forEach((m) => markerLegs(m).forEach((id) => {
        if (legSet.has(id)) groupLegs.add(id);
      }));
      if (group.length > 1 && groupLegs.size > 1) {
        candidates.push(...group);
      } else {
        candidates.push(...group.filter(nearClick));
      }
    });
    this._syncStackedWaypointLayerForTopLeg(topLeg, legs);
    if (candidates.length < 2) return;

    const isWaypointMarker = (m) => this.waypointMarkers.includes(m) || this.returnWaypointMarkers.includes(m);
    const rank = new Map(legs.map((leg, i) => [leg, i]));
    candidates
      .sort((a, b) => {
        const ar = Math.min(...markerLegs(a).map((id) => rank.get(id) ?? 0));
        const br = Math.min(...markerLegs(b).map((id) => rank.get(id) ?? 0));
        return ar - br;
      })
      .forEach((m, i) => m.setZIndexOffset((isWaypointMarker(m) ? WAYPOINT_Z_BASE : 200) + i * 20));
    candidates
      .filter(matchesTop)
      .forEach((m) => m.setZIndexOffset(isWaypointMarker(m) ? WAYPOINT_Z_SELECTED : 900));
    this._syncStackedWaypointLayerForTopLeg(topLeg, legs);
  }

  _syncStackedWaypointLayerForTopLeg(topLeg, legs = null) {
    const legSet = Array.isArray(legs) ? new Set(legs) : null;
    const topIsReturn = this._routeLegIsReturn(topLeg);
    let highlightedPairNeedsRefresh = false;

    this.waypointMarkers.forEach((outbound, idx) => {
      const ret = this.returnWaypointMarkers.find((m) => m._wpIndex === idx);
      if (!outbound || !ret) return;

      const outboundIds = this._markerLegIds(outbound);
      const returnIds = this._markerLegIds(ret);
      const pairMatchesGroup = !legSet || [...outboundIds, ...returnIds].some((id) => legSet.has(id));
      if (!pairMatchesGroup) return;

      const outboundMatchesTop = outboundIds.includes(topLeg);
      const returnMatchesTop = returnIds.includes(topLeg);
      let outboundOnTop = null;

      if (topIsReturn === true && (returnMatchesTop || !legSet || returnIds.some((id) => legSet.has(id)))) {
        outboundOnTop = false;
      } else if (topIsReturn === false && (outboundMatchesTop || !legSet || outboundIds.some((id) => legSet.has(id)))) {
        outboundOnTop = true;
      } else if (outboundMatchesTop !== returnMatchesTop) {
        outboundOnTop = outboundMatchesTop;
      }

      if (outboundOnTop === null) return;

      this.waypointLayerSwapped[idx] = outboundOnTop;
      outbound.setZIndexOffset(WAYPOINT_Z_BASE + (outboundOnTop ? WAYPOINT_Z_PAIR_STEP : 0));
      ret.setZIndexOffset(WAYPOINT_Z_BASE + (outboundOnTop ? 0 : WAYPOINT_Z_PAIR_STEP));

      const topIsReturnMarker = !outboundOnTop;
      if (this.highlightedWpIndex === idx && this.highlightedIsReturn !== topIsReturnMarker) {
        highlightedPairNeedsRefresh = true;
      }
    });

    if (highlightedPairNeedsRefresh) {
      this._highlightTopWaypointLayer(this.highlightedWpIndex);
    }
  }

  /**
   * Send all markers belonging to a specific leg (or direction flag) to the 
   * back by lowering their z-index relative to all other markers.
   * @param {number|boolean} idOrFlag
   * @param {L.LatLng} clickLatLng - optional proximity check for boundary waypoints
   */
  _sendLegMarkersToBack(idOrFlag, clickLatLng = null) {
    const allMarkers = [
      ...this.intermediateMarkers,
      ...this.waypointMarkers,
      ...this.returnWaypointMarkers
    ];

    const stackedWaypointIndex = (m) => {
      const idx = m._wpIndex ?? this.waypointMarkers.indexOf(m);
      return idx >= 0 && this._hasReturnWaypointPair(idx) ? idx : -1;
    };
    
    // Explicit comparison to handle numeric leg IDs and boolean direction flags correctly.
    // Also checks m._legIds (plural) for markers that sit at leg boundaries.
    const isTarget = (m) => {
      const stackedIdx = stackedWaypointIndex(m);
      if (stackedIdx >= 0) {
        if (typeof idOrFlag === 'boolean') return m._isReturn === idOrFlag;
        if (m._legId === idOrFlag) return true;
        if (m._legIds?.includes(idOrFlag)) return true;
        if (m._legId !== undefined || m._legIds) return false;
      }

      // 1. Primary match (flag or specific ID)
      if (typeof idOrFlag === 'boolean' && m._isReturn === idOrFlag) return true;
      if (m._legId === idOrFlag) return true;
      if (m._legIds && m._legIds.includes(idOrFlag)) return true;

      // 2. If the marker already has an explicit, non-matching leg affinity,
      // it belongs to the leg that just rose to the top — do NOT sweep it
      // via proximity. Without this guard, two stacked markers from opposing
      // legs would both go to back and never visually swap.
      if (m._legId !== undefined) return false;

      // 3. Proximity fallback for markers without leg info (legacy / edge cases).
      if (clickLatLng) {
        const dist = m.getLatLng().distanceTo(clickLatLng);
        if (dist < 15) return true; // 15 meters tolerance
      }

      return false;
    };

    const sameLeg = allMarkers.filter(isTarget);
    if (!sameLeg.length) return;

    this._syncStackedWaypointLayerForBack(idOrFlag, isTarget);

    // Check if there are markers NOT in this group to avoid unnecessary z-index reduction
    const othersExist = allMarkers.some(m => !isTarget(m));
    if (!othersExist) return;

    let minOffset = 0;
    for (const m of allMarkers) {
      const off = m.options.zIndexOffset || 0;
      if (off < minOffset) minOffset = off;
    }
    sameLeg.forEach(m => m.setZIndexOffset(minOffset - 100));
  }

  /**
   * Keep colocated outbound/return waypoint pairs visually aligned with the
   * route leg being sent behind. Route cycling used to lower polylines and
   * generic markers only; stacked main waypoints kept their old per-waypoint
   * swap state, so the visible waypoint could disagree with the visible track.
   */
  _syncStackedWaypointLayerForBack(idOrFlag, isTarget) {
    this.waypointMarkers.forEach((outbound, idx) => {
      const ret = this.returnWaypointMarkers.find((m) => m._wpIndex === idx);
      if (!outbound || !ret) return;

      const isPrimaryTarget = (m) => {
        if (typeof idOrFlag === 'boolean') return m._isReturn === idOrFlag;
        if (m._legId === idOrFlag) return true;
        if (m._legIds?.includes(idOrFlag)) return true;
        if (m._legId !== undefined || m._legIds) return false;
        return isTarget(m);
      };

      const outboundMovesBack = isPrimaryTarget(outbound);
      const returnMovesBack = isPrimaryTarget(ret);
      if (outboundMovesBack === returnMovesBack) return;

      // true means outbound rests above return; false means return rests above outbound.
      this.waypointLayerSwapped[idx] = returnMovesBack;
      outbound.setZIndexOffset(WAYPOINT_Z_BASE + (returnMovesBack ? WAYPOINT_Z_PAIR_STEP : 0));
      ret.setZIndexOffset(WAYPOINT_Z_BASE + (returnMovesBack ? 0 : WAYPOINT_Z_PAIR_STEP));
    });
  }

  /**
   * Update the cumulative distances for outbound waypoints and sync their leg IDs.
   * Called by main.js when route calculation finishes.
   */
  setWaypointDistances(dists) {
    this.waypointMarkers.forEach((m, i) => {
      if (Number.isFinite(dists[i])) {
        m._cumDistM = dists[i];
      } else {
        delete m._cumDistM;
        delete m._legId;
        delete m._legIds;
      }
      m._isReturn = false;
    });
    this._syncAllMarkerLegIds();
  }

  /**
   * Refresh _legId on all markers (waypoint, return, intermediate) based on their 
   * stored _cumDistM and the current route's leg ID mapping.
   */
  _syncAllMarkerLegIds() {
    const all = [...this.waypointMarkers, ...this.returnWaypointMarkers, ...this.intermediateMarkers];
    const cum = this._currentRouteCum;
    const legs = this._currentRouteLegIds;
    if (!cum || !legs) return;

    all.forEach(m => {
      if (Number.isFinite(m._cumDistM)) {
        let lo = 0, hi = cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < m._cumDistM) lo = mid + 1;
          else hi = mid;
        }
        
        const ids = new Set();
        ids.add(legs[lo] ?? 0);
        // If at a boundary between legs, associate with both so it switches with either
        if (lo > 0 && Math.abs(m._cumDistM - cum[lo]) <= STACKED_WAYPOINT_TOLERANCE_M) {
          ids.add(legs[lo - 1] ?? 0);
        }
        if (lo < cum.length - 1 && Math.abs(cum[lo] - m._cumDistM) <= STACKED_WAYPOINT_TOLERANCE_M) {
          ids.add(legs[lo + 1] ?? legs[lo] ?? 0);
        }
        
        m._legId = legs[lo] ?? 0;
        m._legIds = Array.from(ids);
      } else {
        delete m._legId;
        delete m._legIds;
      }
    });
  }

  getCurrentLayerInfo() {
    const layer = this.tileLayers[this.currentLayerName];
    const config = this.tileLayerConfigs[this.currentLayerName];
    if (layer) {
      return {
        name: this.currentLayerName,
        urlTemplate: layer._url,
        maxZoom: layer.options.maxZoom || 18,
        attribution: layer.options.attribution || config?.provider?.attribution || null,
        provider: config?.provider ? { ...config.provider } : null,
        offlineMapSource: this.offlineMapSources[this.currentLayerName] || null,
      };
    }
    return null;
  }

  _offlineLayerName(sourceId) {
    return `${OFFLINE_LAYER_PREFIX}${sourceId}`;
  }

  _canRenderOfflineMapSource(source) {
    const nativeRenderableFormats = new Set(['mapsforge', 'mbtiles']);
    return !!source?.id
      && nativeRenderableFormats.has(source.format)
      && source.rendererStatus === 'ready'
      && platform.supportsOfflineMapRendering?.();
  }

  _offlineLayerConfig(source) {
    return {
      cssClass: 'map-tiles-offline map-tiles-native',
      provider: {
        id: `offline-${source.id}`,
        name: source.name || 'Offline map',
        attribution: source.attribution || '',
        homepage: null,
        offlineTileExport: {
          allowed: false,
          reason: 'App 離線底圖暫不支援匯出為 .melmap 圖磚',
        },
      },
      options: {
        attribution: source.attribution || source.name || 'Offline map',
        minZoom: source.minZoom ?? 0,
        maxZoom: source.maxZoom ?? 22,
      },
    };
  }

  _createOfflineMapTileLayer(source, layerName) {
    const config = this._offlineLayerConfig(source);
    const OfflineMapTileLayer = L.GridLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('img');
        tile.alt = '';
        tile.setAttribute('role', 'presentation');
        tile.decoding = 'async';
        tile.src = TRANSPARENT_TILE_DATA_URL;
        platform.getOfflineMapTile?.({
          ...source.storage,
          format: source.format,
          tileMimeType: source.tileMimeType || '',
          z: coords.z,
          x: coords.x,
          y: coords.y,
        }).then((result) => {
          tile.src = result?.dataUrl || TRANSPARENT_TILE_DATA_URL;
          done(null, tile);
        }).catch((err) => {
          console.warn('Offline map tile read failed:', err);
          tile.src = TRANSPARENT_TILE_DATA_URL;
          done(null, tile);
        });
        return tile;
      },
    });

    return new OfflineMapTileLayer({
      ...config.options,
      ...TILE_LAYER_PERFORMANCE_OPTIONS,
      className: tileLayerClassName(layerName, config, this.currentTileTheme),
      tileSize: 256,
    });
  }

  /** Reset all waypoint markers to their resting z-index offset and remove
   *  any .is-selected class. Outbound rests at 0; return rests at 100 so that
   *  by default the (dashed) return circle is the one the user sees at stacked
   *  locations — only when an outbound marker is highlighted does it rise
   *  above its return counterpart. */
  _toggleWaypointLayer(idx, { select = true } = {}) {
    if (idx === undefined || idx < 0 || !this._hasReturnWaypointPair(idx)) return;
    
    // Toggle the swap state for this specific waypoint index
    this.waypointLayerSwapped[idx] = !this.waypointLayerSwapped[idx];
    this._resetWaypointMarkerZ();

    if (select) this._highlightTopWaypointLayer(idx);
  }

  _cycleWaypointOverlapLayers(idx, _latlng = null, { select = true } = {}) {
    if (idx === undefined || idx < 0 || !this._hasReturnWaypointPair(idx)) return false;

    this.waypointLayerSwapped[idx] = !(this.waypointLayerSwapped[idx] ?? true);
    this._resetWaypointMarkerZ();
    if (select) this._highlightTopWaypointLayer(idx);
    return true;
  }

  _clearWaypointClickTimeout() {
    if (this._waypointClickTimeout) {
      clearTimeout(this._waypointClickTimeout);
      this._waypointClickTimeout = null;
    }
  }

  _waypointSelectionLatLng(wpIndex, isReturn = false) {
    const marker = isReturn
      ? this.returnWaypointMarkers.find((m) => m._wpIndex === wpIndex)
      : this.waypointMarkers[wpIndex];
    if (marker?.getLatLng) return marker.getLatLng();

    const wp = this.waypoints[wpIndex];
    return wp ? L.latLng(wp[0], wp[1]) : null;
  }

  _isWaypointLayerSelected(wpIndex, isReturn = false) {
    const marker = isReturn
      ? this.returnWaypointMarkers.find((m) => m._wpIndex === wpIndex)
      : this.waypointMarkers[wpIndex];
    return !!marker?.getElement?.()?.classList.contains('is-selected');
  }

  _isWaypointPairHighlighted(wpIndex) {
    if (this.highlightedWpIndex !== wpIndex) return false;
    return this._isWaypointLayerSelected(wpIndex, false)
      || this._isWaypointLayerSelected(wpIndex, true);
  }

  _topWaypointLayerIsReturn(wpIndex, fallbackIsReturn = false) {
    if (!this._hasReturnWaypointPair(wpIndex)) return fallbackIsReturn;
    return (this.waypointLayerSwapped[wpIndex] ?? true) === false;
  }

  _selectWaypointFromMap(wpIndex, isReturn = false, latlng = null) {
    if (this._hasReturnWaypointPair(wpIndex) && this._isWaypointPairHighlighted(wpIndex)) {
      this._cycleWaypointOverlapLayers(
        wpIndex,
        latlng || this._waypointSelectionLatLng(wpIndex, isReturn),
        { select: false }
      );
      this._highlightTopWaypointLayer(wpIndex);
      return;
    }

    this.onWaypointSelect?.(wpIndex, this._topWaypointLayerIsReturn(wpIndex, isReturn), false);
  }

  _scheduleWaypointSelect(wpIndex, isReturn = false, latlng = null) {
    this._clearWaypointClickTimeout();
    this._waypointClickTimeout = setTimeout(() => {
      this._waypointClickTimeout = null;
      this._selectWaypointFromMap(wpIndex, isReturn, latlng);
    }, WAYPOINT_SINGLE_TAP_DELAY_MS);
  }

  _deferWaypointSelect(wpIndex, isReturn = false, shouldToggle = false) {
    this._clearWaypointClickTimeout();
    setTimeout(() => this.onWaypointSelect?.(wpIndex, isReturn, shouldToggle), 0);
  }

  _cycleWaypointLayerThenSelect(wpIndex, isReturn = false, latlng = null) {
    if (this._hasReturnWaypointPair(wpIndex)) {
      this._cycleWaypointOverlapLayers(
        wpIndex,
        latlng || this._waypointSelectionLatLng(wpIndex, isReturn),
        { select: false }
      );
      this._deferTopWaypointLayerHighlight(wpIndex);
      return;
    }

    this._deferWaypointSelect(wpIndex, this._topWaypointLayerIsReturn(wpIndex, isReturn), false);
  }

  _deferTopWaypointLayerHighlight(idx) {
    this._clearWaypointClickTimeout();
    setTimeout(() => this._highlightTopWaypointLayer(idx), 0);
  }

  _highlightTopWaypointLayer(idx) {
    if (idx === undefined || idx < 0 || !this._hasReturnWaypointPair(idx)) return;

    // Highlight the one that has been brought to the top.
    const isOutboundOnTop = this.waypointLayerSwapped[idx];
    if (isOutboundOnTop) {
      this.highlightWaypoint(idx);
      this.onWaypointSelect?.(idx, false);
    } else {
      this.highlightReturnWaypoint(idx, true); // True to bypass onWaypointSelect circularity
      this.onWaypointSelect?.(idx, true);
    }
  }

  /**
   * Reset all marker z-indices to their default stack order.
   * Default: outbound leg is above return leg.
   * Overridden by waypointLayerSwapped[idx].
   */
  _resetWaypointMarkerZ() {
    this.waypointMarkers.forEach((m, i) => {
      m.getElement()?.classList.remove('is-selected', 'has-highlighted-weather-card');
      const outboundOnTop = this.waypointLayerSwapped[i] ?? true;
      const offset = WAYPOINT_Z_BASE + (outboundOnTop ? WAYPOINT_Z_PAIR_STEP : 0);
      m.setZIndexOffset(offset);
    });
    this.returnWaypointMarkers.forEach((m) => {
      m.getElement()?.classList.remove('is-selected', 'has-highlighted-weather-card');
      const i = m._wpIndex;
      const outboundOnTop = i !== undefined ? (this.waypointLayerSwapped[i] ?? true) : true;
      const offset = WAYPOINT_Z_BASE + (outboundOnTop ? 0 : WAYPOINT_Z_PAIR_STEP);
      m.setZIndexOffset(offset);
    });
    this.intermediateMarkers.forEach((m) => {
      m.getElement()?.classList.remove('has-highlighted-weather-card');
    });
  }

  _hasReturnWaypointPair(idx) {
    return idx >= 0
      && idx < this.waypointMarkers.length
      && this.returnWaypointMarkers.some((m) => m._wpIndex === idx);
  }

  _restoreWaypointHighlightDom() {
    if (this.highlightedWpIndex < 0) return;
    const m = this.highlightedIsReturn
      ? this.returnWaypointMarkers.find((x) => x._wpIndex === this.highlightedWpIndex)
      : this.waypointMarkers[this.highlightedWpIndex];
    if (!m) return;

    const el = m.getElement();
    el?.classList.add('is-selected');
    if (el?.classList.contains('has-weather-card')) {
      el.classList.add('has-highlighted-weather-card');
    }
    m.setZIndexOffset(WAYPOINT_Z_SELECTED);
  }

  /** Highlight an outbound waypoint marker by index. Bumps the marker's
   *  Leaflet zIndexOffset so it rises above any colocated return marker
   *  and route interval markers. */
  highlightWaypoint(wpIndex) {
    this._resetWaypointMarkerZ();
    this.highlightedWpIndex = wpIndex;
    this.highlightedIsReturn = false;
    const m = this.waypointMarkers[wpIndex];
    if (m) {
      const el = m.getElement();
      el?.classList.add('is-selected');
      if (el?.classList.contains('has-weather-card')) {
        el.classList.add('has-highlighted-weather-card');
      }
      m.setZIndexOffset(WAYPOINT_Z_SELECTED);
    }
  }

  /** Highlight a return-leg waypoint marker by wpIndex. */
  highlightReturnWaypoint(wpIndex) {
    this._resetWaypointMarkerZ();
    this.highlightedWpIndex = wpIndex;
    this.highlightedIsReturn = true;
    const m = this.returnWaypointMarkers.find((x) => x._wpIndex === wpIndex);
    if (m) {
      const el = m.getElement();
      el?.classList.add('is-selected');
      if (el?.classList.contains('has-weather-card')) {
        el.classList.add('has-highlighted-weather-card');
      }
      m.setZIndexOffset(WAYPOINT_Z_SELECTED);
    }
  }

  /** Remove all waypoint selection highlights (outbound + return). */
  clearWaypointHighlight() {
    this.highlightedWpIndex = -1;
    this.highlightedIsReturn = false;
    this._resetWaypointMarkerZ();
  }

  /**
   * Expand the marker's weather badge into an inline weather card.
   * Multiple cards can coexist because each one lives inside its own badge.
   * @param {number} colIdx - weather column index
   * @param {string} htmlContent - full inner HTML for the card
   * @param {function} onReady - callback(wrapper) fired when the card is in DOM
   * @param {boolean} isIntermediate - if true, attach to intermediate markers
   * @param {boolean} isReturn - if true, attach to return-leg waypoint markers
   */
  openWeatherPopup(colIdx, htmlContent, onReady, isIntermediate = false, waypointIndex = -1, isReturn = false) {
    const targetMarker = this._findWeatherTargetMarker(colIdx, isIntermediate, waypointIndex, isReturn);
    if (!targetMarker) return;
    const badge = this._weatherBadgeForMarker(targetMarker);
    const useMobileLayer = this._shouldUseMobileWeatherCardLayer(htmlContent);
    const slot = useMobileLayer ? this._mobileWeatherCardLayer() : this._weatherCardSlotForBadge(badge);
    if (!badge || !slot) return;

    const existing = this._weatherPopups.get(colIdx);
    if (existing && (existing.badge !== badge || existing.slot !== slot)) {
      this._closeInlineWeatherCardNow(colIdx, existing);
    }

    const closeTimer = this._weatherPopupCloseTimers.get(colIdx);
    if (closeTimer) {
      clearTimeout(closeTimer);
      this._weatherPopupCloseTimers.delete(colIdx);
    }

    badge.classList.remove('is-card-closing');
    badge.classList.add('is-card-open');
    targetMarker.getElement?.()?.classList.add('has-weather-card');
    slot.innerHTML = htmlContent;

    L.DomEvent.disableClickPropagation(slot);
    L.DomEvent.disableScrollPropagation(slot);
    const card = slot.querySelector('.weather-card');
    if (card) {
      L.DomEvent.disableClickPropagation(card);
      L.DomEvent.disableScrollPropagation(card);
    }

    const entry = {
      marker: targetMarker,
      badge,
      slot,
      closeToken: null,
      htmlContent,
      onReady,
      isIntermediate,
      waypointIndex,
      isReturn,
    };
    this._weatherPopups.set(colIdx, entry);

    // Call onReady callback so event handlers can be bound
    if (onReady) onReady(slot);
  }

  /**
   * Remove an inline marker weather card without animation.
   */
  _closeInlineWeatherCardNow(colIdx, entry) {
    const closeTimer = this._weatherPopupCloseTimers.get(colIdx);
    if (closeTimer) clearTimeout(closeTimer);
    this._weatherPopupCloseTimers.delete(colIdx);
    entry.badge?.classList.remove('is-card-open', 'is-card-closing');
    const currentMarker = this._findWeatherTargetMarker(
      colIdx,
      !!entry.isIntermediate,
      Number.isInteger(entry.waypointIndex) ? entry.waypointIndex : -1,
      !!entry.isReturn
    ) || entry.marker;
    currentMarker?.getElement?.()?.classList.remove('has-weather-card');
    this._weatherBadgeForMarker(currentMarker)?.classList.remove('is-card-open', 'is-card-closing');
    if (entry.slot) entry.slot.innerHTML = '';
    this._weatherPopups.delete(colIdx);
  }

  /**
   * Close a specific inline weather card or all of them.
   * @param {number} colIdx - if undefined, closes ALL cards
   */
  closeWeatherPopup(colIdx, options = {}) {
    const animate = options.animate === true;

    if (colIdx !== undefined) {
      const entry = this._weatherPopups.get(colIdx);
      if (entry) {
        const card = entry.slot?.querySelector('.weather-card');
        const isMobileLayerCard = entry.slot?.classList.contains('mobile-weather-card-layer');
        if (!animate || isMobileLayerCard || !entry.badge || !card) {
          this._closeInlineWeatherCardNow(colIdx, entry);
          return;
        }
        const token = Symbol('weather-close');
        entry.closeToken = token;
        entry.badge.classList.remove('is-card-open');
        entry.badge.classList.add('is-card-closing');
        let finished = false;
        const finish = () => {
          if (finished || entry.closeToken !== token) return;
          finished = true;
          this._closeInlineWeatherCardNow(colIdx, entry);
        };
        card.addEventListener('animationend', finish, { once: true });
        this._weatherPopupCloseTimers.set(colIdx, setTimeout(finish, 260));
      }
    } else {
      this._weatherPopups.forEach((entry, idx) => this._closeInlineWeatherCardNow(idx, entry));
      this._weatherPopups.clear();
    }
  }

  /** Check if a specific weather popup is currently open. */
  isWeatherPopupOpen(colIdx) {
    if (colIdx === undefined) return this._weatherPopups.size > 0;
    return this._weatherPopups.has(colIdx);
  }
}
