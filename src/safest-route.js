// The "safest" feasible route from A into B's zone: first, its steepest point is as gentle
// as possible (found by lowering the angle limit until no route is left); then, among the
// routes under that limit, it prefers gentle terrain over steep and short over long.
import {
  EPSILON, energyToSpeed, createTerrain, findMaxArrivalEnergy, findMinEnergyNeeded,
} from './energy-model.js';
import { createMinHeap } from './min-heap.js';

const SAFEST_ANGLE_PRECISION = 0.5; // degrees
const STEEPNESS_PENALTY = 4; // a step at the angle limit costs 1 + 4 = 5x a flat step

export function findSafestRoute(grid, start, zone, settings) {
  // Binary search for the lowest angle limit that still lets the skier reach B's zone.
  let feasible = settings.maxAngle;
  let infeasible = 0;
  while (feasible - infeasible > SAFEST_ANGLE_PRECISION) {
    const angle = (feasible + infeasible) / 2;
    const energy = findMaxArrivalEnergy(createTerrain(grid, { ...settings, maxAngle: angle }), start);
    if (zone.some((cell) => energy[cell] >= 0)) feasible = angle;
    else infeasible = angle;
  }

  const terrain = createTerrain(grid, { ...settings, maxAngle: feasible });
  const energy = findMaxArrivalEnergy(terrain, start);
  const arrivals = zone.filter((cell) => energy[cell] >= 0);
  const needed = findMinEnergyNeeded(terrain, arrivals, energy);
  const { path, energyAtEnd } = findGentlestPath(terrain, start, arrivals, needed, feasible);

  const { width, slopes, heights, stepLength } = terrain;
  let length = 0;
  for (let i = 1; i < path.length; i += 1) {
    const diagonal = path[i] % width !== path[i - 1] % width && Math.floor(path[i] / width) !== Math.floor(path[i - 1] / width);
    length += stepLength[diagonal ? 1 : 0];
  }
  const end = path[path.length - 1];
  return {
    path,
    length,
    maxSlope: Math.max(...path.slice(1).map((cell) => slopes[cell])),
    descent: heights[start] - heights[end],
    arrivalSpeedKmh: energyToSpeed(energyAtEnd),
  };
}

// Dijkstra from A where a step costs its length × (1 + penalty × (slope / angleLimit)²).
// The skier's energy is carried along the path, and a step is only taken if the energy left
// is at least what that cell needs to still reach B (from pass 2), so the result is always
// rideable. Stops at the first cell of B's zone it settles.
function findGentlestPath(terrain, start, goalCells, needed, angleLimit) {
  const { size, heights, slopes, maxEnergy, frictionLoss, stepLength } = terrain;
  const isGoal = new Uint8Array(size);
  for (const cell of goalCells) isGoal[cell] = 1;
  const cost = new Float64Array(size).fill(Infinity);
  const energy = new Float32Array(size);
  const previous = new Int32Array(size).fill(-1);
  const done = new Uint8Array(size);
  const queue = createMinHeap();

  cost[start] = 0;
  queue.push(0, start);
  while (queue.size()) {
    const cell = queue.pop();
    if (done[cell]) continue;
    done[cell] = 1;
    if (isGoal[cell]) return { path: tracePath(previous, cell), energyAtEnd: energy[cell] };

    terrain.forEachNeighbour(cell, (next, diagonal) => {
      if (done[next] || !terrain.isSkiable(next)) return;
      const arrival = Math.min(maxEnergy, energy[cell] + heights[cell] - heights[next] - frictionLoss[diagonal]);
      if (!(arrival >= 0 && arrival >= needed[next] - EPSILON)) return;
      const steepness = slopes[next] / angleLimit;
      const nextCost = cost[cell] + stepLength[diagonal] * (1 + STEEPNESS_PENALTY * steepness * steepness);
      if (nextCost < cost[next]) {
        cost[next] = nextCost;
        energy[next] = arrival;
        previous[next] = cell;
        queue.push(nextCost, next);
      }
    });
  }
  return { path: [start], energyAtEnd: 0 }; // not reached: pass 2 guarantees a way on
}

function tracePath(previous, end) {
  const path = [];
  for (let cell = end; cell !== -1; cell = previous[cell]) path.push(cell);
  return path.reverse();
}
