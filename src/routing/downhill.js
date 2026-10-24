// Finds every route from A to B that a skier can ride while carrying speed (see
// energy-model.js for how speed, friction and the angle limit work).
//
// A and B are zones: setting off from any cell within goalRadius metres of A, and arriving at
// any cell within goalRadius metres of B, counts. `starts` lists A's zone, A first.
//
// The search runs in two passes over the height grid:
//   1. forward from A:  the most energy the skier can arrive with at each cell,
//   2. backward from B: the least energy needed at each cell to still make it into B's zone.
// A cell lies on some feasible route ("the corridor") when 1. is at least 2.
// The caller picks an example route through it (see safest-route.js).
import {
  EPSILON, createTerrain, findMaxArrivalEnergy, findMinEnergyNeeded,
} from './energy-model.js';

export const REACHABLE = 1; // reachable from A, but B can't be reached from here
export const CORRIDOR = 2; // on at least one feasible route from A to B
export const HANG_TOO_STEEP = 4; // reachable by its own slope, but its Hang is too steep

export function findDownhillRoutes(grid, starts, goal, settings) {
  const terrain = createTerrain(grid, settings);

  const energy = findMaxArrivalEnergy(terrain, starts);
  const mask = new Uint8Array(terrain.size);
  const reachableCells = markWhere(mask, REACHABLE, (i) => energy[i] >= 0);
  // Under the whole-slope rule, show what only the Hang's steepness rules out.
  const hangTooSteepCells = settings.wholeSlope
    ? markHangTooSteep(mask, grid, starts, settings, energy) : 0;
  const zone = cellsWithin(grid, goal, settings.goalRadius);
  const noRoute = { mask, reachableCells, hangTooSteepCells, corridorCells: 0, zone };

  const problem = checkGoal(terrain, starts[0], goal, zone, energy);
  if (problem) return { ...noRoute, ...problem };

  const arrivals = zone.filter((cell) => energy[cell] >= 0);
  const needed = findMinEnergyNeeded(terrain, arrivals, energy);
  const corridorCells = markWhere(mask, CORRIDOR, (i) => energy[i] >= 0 && energy[i] >= needed[i] - EPSILON);

  return { mask, reachableCells, hangTooSteepCells, corridorCells, zone, reason: null };
}

// Cells the skier could reach from A judging each cell by its own slope, but not under the
// whole-slope rule (energy is the latter).
function markHangTooSteep(mask, grid, starts, settings, energy) {
  const ownSlopeEnergy = findMaxArrivalEnergy(createTerrain(grid, { ...settings, wholeSlope: false }), starts);
  return markWhere(mask, HANG_TOO_STEEP, (i) => ownSlopeEnergy[i] >= 0 && energy[i] < 0);
}

// All cells whose centre lies within radius metres of the centre of `center`.
export function cellsWithin(grid, center, radius) {
  const { width, height, cellSize } = grid;
  const col = center % width;
  const row = (center - col) / width;
  const reach = Math.floor(radius / cellSize);
  const cells = [];
  for (let r = Math.max(0, row - reach); r <= Math.min(height - 1, row + reach); r += 1) {
    for (let c = Math.max(0, col - reach); c <= Math.min(width - 1, col + reach); c += 1) {
      if (Math.hypot(r - row, c - col) * cellSize <= radius) cells.push(r * width + c);
    }
  }
  return cells;
}

// Why there can't be a route into B's zone, or null if pass 2 is worth running.
function checkGoal(terrain, start, goal, zone, energy) {
  const { heights, limitSlopes } = terrain;
  if (Number.isNaN(heights[start]) || Number.isNaN(heights[goal])) return { reason: 'no-data' };
  if (!zone.some((cell) => heights[cell] < heights[start])) return { reason: 'goal-higher' };
  if (!zone.some(terrain.isSkiable)) return { reason: 'goal-steep', goalSlope: limitSlopes[goal] };
  if (!zone.some((cell) => energy[cell] >= 0)) return { reason: 'blocked' };
  return null;
}

// Sets mask[i] = value wherever test(i) holds and returns how many cells that was.
function markWhere(mask, value, test) {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (test(i)) {
      mask[i] = value;
      count += 1;
    }
  }
  return count;
}
