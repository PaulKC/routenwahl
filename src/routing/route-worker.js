// Web Worker that runs the route calculation off the main thread so the map stays usable.
// Message in:  { id, tiles | null, start, end, settings } (tiles is null when unchanged)
// Message out: { id, progress: { label, done, total } } while running, then
//              { id, result, geometry } or { id, error }
// To cancel a calculation the page terminates this worker and starts a new one.
import { buildHeightGrid } from '../data/height-grid.js';
import { computeRoute, routeSteps } from './compute-route.js';

let grid = null; // height grid of the last tiles sent, reused while only settings change

self.onmessage = ({ data: { id, tiles, start, end, settings } }) => {
  try {
    const total = routeSteps(settings) + (tiles ? 1 : 0);
    let done = 0;
    const onStep = (label) => self.postMessage({ id, progress: { label, done: done++, total } });
    if (tiles) {
      onStep('Höhenraster');
      grid = buildHeightGrid(tiles);
    }
    const result = computeRoute(grid, start, end, settings, onStep);
    const transfer = [result.mask, result.hangLabels, result.zoneMask].filter(Boolean).map((array) => array.buffer);
    self.postMessage({ id, result, geometry: grid.geometry }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
