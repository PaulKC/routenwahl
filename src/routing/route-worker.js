// Web Worker that runs the route calculation off the main thread so the map stays usable.
// Message in:  { id, tiles | null, start, end, settings } (tiles is null when unchanged)
// Message out: { id, result, geometry } or { id, error }
// To cancel a calculation the page terminates this worker and starts a new one.
import { buildHeightGrid } from '../data/height-grid.js';
import { computeRoute } from './compute-route.js';

let grid = null; // height grid of the last tiles sent, reused while only settings change

self.onmessage = ({ data: { id, tiles, start, end, settings } }) => {
  try {
    if (tiles) grid = buildHeightGrid(tiles);
    const result = computeRoute(grid, start, end, settings);
    const transfer = result.mask ? [result.mask.buffer] : [];
    self.postMessage({ id, result, geometry: grid.geometry }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
