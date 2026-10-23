// Finds every route from A to B that a skier can ride while carrying speed (see
// energy-model.js for how speed, friction and the angle limit work).
//
// B is a target zone: arriving at any cell within goalRadius metres of B counts.
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

export function findDownhillRoutes(grid, start, goal, settings) {
  const terrain = createTerrain(grid, settings);

  const energy = findMaxArrivalEnergy(terrain, start);
  const mask = new Uint8Array(terrain.size);
  const reachableCells = markWhere(mask, REACHABLE, (i) => energy[i] >= 0);
  const zone = cellsWithin(grid, goal, settings.goalRadius);
  const noRoute = { mask, reachableCells, corridorCells: 0, zone };

  const problem = checkGoal(terrain, start, goal, zone, energy);
  if (problem) return { ...noRoute, ...problem };

  const arrivals = zone.filter((cell) => energy[cell] >= 0);
  const needed = findMinEnergyNeeded(terrain, arrivals, energy);
  const corridorCells = markWhere(mask, CORRIDOR, (i) => energy[i] >= 0 && energy[i] >= needed[i] - EPSILON);

  return { mask, reachableCells, corridorCells, zone, reason: null };
}

// All cells whose centre lies within radius metres of the centre of `center`.
function cellsWithin(grid, center, radius) {
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
  const { heights, slopes } = terrain;
  if (Number.isNaN(heights[start]) || Number.isNaN(heights[goal])) return { reason: 'no-data' };
  if (!zone.some((cell) => heights[cell] < heights[start])) return { reason: 'goal-higher' };
  if (!zone.some(terrain.isSkiable)) return { reason: 'goal-steep', goalSlope: slopes[goal] };
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
