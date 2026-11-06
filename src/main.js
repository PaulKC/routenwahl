// Wires the parts of the app together. The flow: the user sets A and B on the map (points.js),
// the elevation tiles around them are loaded (elevation-layer.js) together with the wildlife
// rest zones (wildlife-layer.js), then the route is computed and drawn (route-layer.js). The
// panel (panel.js) holds the settings and shows what each step is doing.
import { createMap } from './ui/map.js';
import { createPointPicker } from './ui/points.js';
import { createPanel } from './ui/panel.js';
import { createElevationLayer } from './ui/elevation-layer.js';
import { createRouteLayer } from './ui/route-layer.js';
import { createSearch } from './ui/search.js';
import { createWildlifeLayer } from './ui/wildlife-layer.js';
import { createSheets } from './ui/sheets.js';
import { createLocateControl } from './ui/locate.js';
import { createCameraControl } from './ui/camera-view.js';

// ?debug in the address shows the debug options under "Erweitert".
document.body.classList.toggle('debug', new URLSearchParams(location.search).has('debug'));

// --- Map and what is drawn on it -----------------------------------------------------------
// The layers report their progress in the panel, created just below.
const map = createMap('map');
createSearch(map);
const elevation = createElevationLayer(map, (...status) => panel.showElevationStatus(...status));
const routes = createRouteLayer(map, (...status) => panel.showRouteStatus(...status));
const wildlife = createWildlifeLayer(map);

// --- Panel ---------------------------------------------------------------------------------
const panel = createPanel({
  onReset: () => {
    picker.reset();
    elevation.cancel();
    routes.clear();
    panel.showWildlifeWarning('');
    showDanger();
  },
  onSettingsChange: (settings) => routes.recompute(routeSettings(settings)),
  onShowTiles: (show) => elevation.setShowTiles(show),
});

// --- Controls ------------------------------------------------------------------------------
createSheets(map);
createLocateControl(map, panel.showMessage);
// Without GPS (e.g. on a laptop) the camera view stands at A, or else the map centre. It
// colours the terrain like the route on the map where there is one.
createCameraControl(map, {
  settings: () => panel.settings(),
  route: () => routes.current(),
  fallbackPosition: () => {
    const { start } = picker.latLngs();
    return start ? { latlng: start, label: 'Test: Punkt A' } : { latlng: map.getCenter(), label: 'Test: Kartenmitte' };
  },
});

// --- A and B to route ----------------------------------------------------------------------
const picker = createPointPicker(map, {
  onMove: panel.showPoints,
  onSet: (start, end) => {
    showDanger();
    findRoutes(start, end);
  },
});

// The wildlife rest zones around the current route: the route must not cross them, whatever
// the season; the recommended ones only if they are to be avoided.
let routeZones = [];
function routeSettings(settings) {
  return {
    ...settings,
    noGo: routeZones
      .filter((zone) => zone.binding || settings.avoidRecommended)
      .map(({ id, polygons }) => ({ id, polygons })),
  };
}

async function findRoutes(start, end) {
  routes.clear();
  const [tiles, zones] = await Promise.all([
    elevation.load(start, end),
    wildlife.forRoute(start, end).catch(() => null),
  ]);
  panel.refreshCacheInfo();
  // Skip if the points moved again while the tiles were loading.
  const current = picker.latLngs();
  if (!tiles || !current.start?.equals(start) || !current.end?.equals(end)) return;
  routeZones = zones ?? [];
  panel.showWildlifeWarning(zones ? '' : 'Wildruhezonen konnten nicht geladen werden: bitte selbst prüfen.');
  routes.compute(tiles, start, end, routeSettings(panel.settings()));
}

// --- Avalanche danger ----------------------------------------------------------------------
// The avalanche danger is looked up for A and B once set, before that for the map centre.
function showDanger() {
  const { start, end } = picker.latLngs();
  const points = [start, end].filter(Boolean);
  panel.showDangerFor(points.length ? points : [map.getCenter()]);
}
map.on('moveend click', showDanger);

panel.showPoints(null, null);
showDanger();

// --- Offline app and debugging -------------------------------------------------------------
// Installable app that also starts offline (see sw.js).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // not available here (e.g. plain http on another host); the app works without it
  });
}

// Handy for debugging in the browser console.
window.app = { map, picker, elevation, routes, wildlife };
