import { createMap } from './ui/map.js';
import { createPointPicker } from './ui/points.js';
import { createPanel } from './ui/panel.js';
import { createElevationLayer } from './ui/elevation-layer.js';
import { createRouteLayer } from './ui/route-layer.js';
import { createSearch } from './ui/search.js';
import { createWildlifeLayer } from './ui/wildlife-layer.js';

// ?debug in the address shows the debug options under "Erweitert".
document.body.classList.toggle('debug', new URLSearchParams(location.search).has('debug'));

const map = createMap('map');
createSearch(map);

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

const elevation = createElevationLayer(map, panel.showElevationStatus);
const routes = createRouteLayer(map, panel.showRouteStatus);
const wildlife = createWildlifeLayer(map);

// The wildlife rest zones around the current route: the route must not cross them, whatever
// the season; the recommended ones only if they are to be avoided.
let routeZones = [];
const routeSettings = (settings) => ({
  ...settings,
  noGo: routeZones
    .filter((zone) => zone.binding || settings.avoidRecommended)
    .map(({ id, polygons }) => ({ id, polygons })),
});

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

const picker = createPointPicker(map, {
  onMove: panel.showPoints,
  onSet: (start, end) => {
    showDanger();
    findRoutes(start, end);
  },
});

// The avalanche danger is looked up for A and B once set, before that for the map centre.
function showDanger() {
  const { start, end } = picker.latLngs();
  const points = [start, end].filter(Boolean);
  panel.showDangerFor(points.length ? points : [map.getCenter()]);
}
map.on('moveend click', showDanger);

panel.showPoints(null, null);
showDanger();

// Installable app that also starts offline (see sw.js).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // not available here (e.g. plain http on another host); the app works without it
  });
}

// Handy for debugging in the browser console.
window.app = { map, picker, elevation, routes, wildlife };
