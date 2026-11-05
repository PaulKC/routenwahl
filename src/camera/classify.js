// Sorts each cell of a height grid by whether it can be skied under the current settings, with
// the same rules as the route (see routing/energy-model.js): the max angle from the avalanche
// danger, the core zone, the whole-slope rule from level 3, and exposure above cliffs.
// Unlike the route this doesn't ask whether a cell can be reached from A: the camera view shows
// the terrain in front of the skier as it is.
import { createTerrain } from '../routing/energy-model.js';
import { findExposedCells } from '../routing/exposure.js';

export const SKIABLE = 1;
export const EXPOSED = 2; // skiable, but a fall there runs into a cliff
export const TOO_STEEP = 3; // steeper than the max angle, or its Hang is
export const CLIFF = 4; // as steep as the cliff angle or steeper

// Uint8Array with one of the classes above per cell, 0 where there is no data.
export function classifyCells(grid, settings) {
  const terrain = createTerrain(grid, settings);
  const slopes = grid.slopes();
  const exposed = findExposedCells(grid, terrain.isSkiable, settings);
  const classes = new Uint8Array(slopes.length);
  for (let i = 0; i < slopes.length; i += 1) {
    const slope = slopes[i];
    if (!Number.isFinite(slope)) continue;
    if (slope >= settings.cliffAngle) classes[i] = CLIFF;
    else if (!terrain.isSkiable(i)) classes[i] = TOO_STEEP;
    else classes[i] = exposed[i] ? EXPOSED : SKIABLE;
  }
  return classes;
}
