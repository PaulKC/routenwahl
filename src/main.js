import { createMap } from './ui/map.js';
import { createPointPicker } from './ui/points.js';
import { createPanel } from './ui/panel.js';
import { createElevationLayer } from './ui/elevation-layer.js';
import { createRouteLayer } from './ui/route-layer.js';
import { createSearch } from './ui/search.js';

const map = createMap('map');
createSearch(map);

const panel = createPanel({
  onReset: () => {
    picker.reset();
    elevation.cancel();
    routes.clear();
  },
  onSettingsChange: (settings) => routes.recompute(settings),
});

const elevation = createElevationLayer(map, panel.showElevationStatus);
const routes = createRouteLayer(map, panel.showRouteStatus);

async function findRoutes(start, end) {
  routes.clear();
  const tiles = await elevation.load(start, end);
  panel.refreshCacheInfo();
  // Skip if the points moved again while the tiles were loading.
  const current = picker.latLngs();
  if (!tiles || !current.start?.equals(start) || !current.end?.equals(end)) return;
  routes.compute(tiles, start, end, panel.settings());
}

const picker = createPointPicker(map, {
  onMove: panel.showPoints,
  onSet: findRoutes,
});

panel.showPoints(null, null);

// Handy for debugging in the browser console.
window.app = { map, picker, elevation, routes };
