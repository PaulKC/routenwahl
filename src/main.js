import { createMap } from './map.js';
import { createPointPicker } from './points.js';
import { createPanel } from './panel.js';
import { createElevationLayer } from './elevation-layer.js';
import { createRouteLayer } from './route-layer.js';

const map = createMap('map');

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
