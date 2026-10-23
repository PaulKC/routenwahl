import { createMap } from './map.js';
import { createPointPicker } from './points.js';
import { createPanel } from './panel.js';
import { createElevationLayer } from './elevation-layer.js';

const map = createMap('map');

const panel = createPanel({
  onReset: () => {
    picker.reset();
    elevation.cancel();
  },
});

const elevation = createElevationLayer(map, panel.showElevationStatus);

const picker = createPointPicker(map, {
  onMove: panel.showPoints,
  onSet: elevation.load,
});

panel.showPoints(null, null);

// Handy for debugging in the browser console.
window.app = { map, picker, elevation };
