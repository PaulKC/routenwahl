// Sorts each cell of a height grid by whether it can be skied under the current settings, with
// the same rules as the route (see routing/energy-model.js): the max angle from the avalanche
// danger, the core zone, the whole-slope rule from level 3, and exposure above cliffs.
// Unlike the route this doesn't ask whether a cell can be reached from A: the camera view shows
// the terrain in front of the skier as it is.
import { createTerrain } from '../routing/energy-model.js';
import { findExposedCells } from '../routing/exposure.js';
import { CAMERA } from '../terrain-classes.js';

// Uint8Array with one of the CAMERA classes (terrain-classes.js) per cell, 0 where there is no data.
export function classifyCells(grid, settings) {
  const terrain = createTerrain(grid, settings);
  const slopes = grid.slopes();
  const exposed = findExposedCells(grid, terrain.isSkiable, settings);
  const classes = new Uint8Array(slopes.length);
  for (let i = 0; i < slopes.length; i += 1) {
    const slope = slopes[i];
    if (!Number.isFinite(slope)) continue;
    if (slope >= settings.cliffAngle) classes[i] = CAMERA.CLIFF;
    else if (!terrain.isSkiable(i)) classes[i] = CAMERA.TOO_STEEP;
    else classes[i] = exposed[i] ? CAMERA.EXPOSED : CAMERA.SKIABLE;
  }
  return classes;
}
