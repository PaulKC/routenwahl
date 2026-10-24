// The "safest" feasible route from A into B's zone:
//   0. it avoids exposed cells completely if any route can; otherwise it keeps its exposed
//      stretch as short as it can,
//   1. its steepest point is as gentle as possible (found by lowering the angle limit until
//      no route is left),
//   2. among the routes under that limit, it prefers gentle terrain over steep and short
//      over long.
import {
  EPSILON, energyToSpeed, createTerrain, startCells, findMaxArrivalEnergy, findMinEnergyNeeded,
} from './energy-model.js';
import { createMinHeap } from './min-heap.js';

const SAFEST_ANGLE_PRECISION = 0.5; // degrees
const STEEPNESS_PENALTY = 4; // a step at the angle limit costs 1 + 4 = 5x a flat step
const EXPOSURE_PENALTY = 1000; // an exposed step costs like 1 km of flat terrain

// Number of rounds the angle search takes for a given angle limit.
export const angleSearchRounds = (maxAngle) => Math.max(0, Math.ceil(Math.log2(maxAngle / SAFEST_ANGLE_PRECISION)));

// `starts` lists A's zone, A first. `exposed` is a mask of cells to stay out of (or null). onStep(label) is called before each
// step: the exposure check, every angle search round and the final path search.
export function findSafestRoute(grid, starts, zone, settings, exposed, onStep = () => {}) {
  const reachesZone = (angle, blocked) => {
    const energy = findMaxArrivalEnergy(createTerrain(grid, { ...settings, maxAngle: angle, blocked }), starts);
    return zone.some((cell) => energy[cell] >= 0);
  };
  onStep('Sicherste Route: exponierte Stellen umgehbar?');
  const avoidsExposure = Boolean(exposed) && reachesZone(settings.maxAngle, exposed);
  const blocked = avoidsExposure ? exposed : null;

  // Binary search for the lowest angle limit that still lets the skier reach B's zone.
  let feasible = settings.maxAngle;
  let infeasible = 0;
  const rounds = angleSearchRounds(settings.maxAngle);
  for (let round = 1; feasible - infeasible > SAFEST_ANGLE_PRECISION; round += 1) {
    onStep(`Sicherste Route: Winkelsuche ${round}/${rounds}`);
    const angle = (feasible + infeasible) / 2;
    if (reachesZone(angle, blocked)) feasible = angle;
    else infeasible = angle;
  }

  onStep('Sicherste Route: Wegsuche');
  const terrain = createTerrain(grid, { ...settings, maxAngle: feasible, blocked });
  const energy = findMaxArrivalEnergy(terrain, starts);
  const arrivals = zone.filter((cell) => energy[cell] >= 0);
  const needed = findMinEnergyNeeded(terrain, arrivals, energy);
  const penalised = avoidsExposure ? null : exposed;
  const { path, energyAtEnd } = findGentlestPath(terrain, starts, arrivals, needed, feasible, penalised);

  const { width, slopes, limitSlopes, heights, stepLength } = terrain;
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
    maxHangSlope: settings.wholeSlope ? Math.max(...path.slice(1).map((cell) => limitSlopes[cell])) : null,
    descent: heights[path[0]] - heights[end],
    arrivalSpeedKmh: energyToSpeed(energyAtEnd),
    avoidsExposure,
  };
}

// Dijkstra from A's zone where a step costs its length × (1 + penalty × (slope / angleLimit)²),
// plus a large extra cost for cells in the optional `penalised` mask.
// The skier's energy is carried along the path, and a step is only taken if the energy left
// is at least what that cell needs to still reach B (from pass 2), so the result is always
// rideable. Stops at the first cell of B's zone it settles.
function findGentlestPath(terrain, starts, goalCells, needed, angleLimit, penalised) {
  const { size, heights, limitSlopes, maxEnergy, frictionLoss, stepLength } = terrain;
  const isGoal = new Uint8Array(size);
  for (const cell of goalCells) isGoal[cell] = 1;
  const cost = new Float64Array(size).fill(Infinity);
  const energy = new Float32Array(size);
  const previous = new Int32Array(size).fill(-1);
  const done = new Uint8Array(size);
  const queue = createMinHeap();

  for (const cell of startCells(terrain, starts)) {
    cost[cell] = 0;
    queue.push(0, cell);
  }
  while (queue.size()) {
    const cell = queue.pop();
    if (done[cell]) continue;
    done[cell] = 1;
    if (isGoal[cell]) return { path: tracePath(previous, cell), energyAtEnd: energy[cell] };

    terrain.forEachNeighbour(cell, (next, diagonal) => {
      if (done[next] || !terrain.isSkiable(next)) return;
      const arrival = Math.min(maxEnergy, energy[cell] + heights[cell] - heights[next] - frictionLoss[diagonal]);
      if (!(arrival >= 0 && arrival >= needed[next] - EPSILON)) return;
      const steepness = limitSlopes[next] / angleLimit;
      const exposure = penalised?.[next] ? EXPOSURE_PENALTY : 0;
      const nextCost = cost[cell] + stepLength[diagonal] * (1 + STEEPNESS_PENALTY * steepness * steepness + exposure);
      if (nextCost < cost[next]) {
        cost[next] = nextCost;
        energy[next] = arrival;
        previous[next] = cell;
        queue.push(nextCost, next);
      }
    });
  }
  return { path: [starts[0]], energyAtEnd: 0 }; // not reached: pass 2 guarantees a way on
}

function tracePath(previous, end) {
  const path = [];
  for (let cell = end; cell !== -1; cell = previous[cell]) path.push(cell);
  return path.reverse();
}
