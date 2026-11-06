// Web Worker that classifies the terrain around the skier for the camera view (see
// classify.js), so the camera image keeps moving while it runs.
// Message in:  { id, tile, settings } (tile: one cropped tile, see local-terrain.js cropTile)
// Message out: { id, classes } or { id, error }
import { buildHeightGrid } from '../data/height-grid.js';
import { classifyCells } from './classify.js';

self.onmessage = ({ data: { id, tile, settings } }) => {
  try {
    const classes = classifyCells(buildHeightGrid([tile]), settings);
    self.postMessage({ id, classes }, [classes.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
