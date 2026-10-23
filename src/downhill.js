// Finds every route from A to B that a skier can ride while carrying speed.
//
// Energy model: the skier's speed is stored as energy in metres of height (v² / 2g).
// Every step to one of the 8 neighbouring cells
//   - adds the height lost (or subtracts the height gained),
//   - subtracts friction × step length,
//   - is capped at the max speed,
// and is only allowed if the energy stays at or above zero. So flat or slightly uphill
// bits are fine as long as the skier arrives with enough speed. Cells whose terrain is
// steeper than maxAngle are off limits (only A itself may be steeper).
//
// The search runs in two passes over the height grid:
//   1. forward from A:  the most energy the skier can arrive with at each cell,
//   2. backward from B: the least energy needed at each cell to still make it to B.
// A cell lies on some feasible route ("the corridor") when 1. is at least 2.

export const REACHABLE = 1; // reachable from A, but B can't be reached from here
export const CORRIDOR = 2; // on at least one feasible route from A to B

const G = 9.81;
const EPSILON = 1e-3; // ignore improvements smaller than 1 mm of energy
const UNREACHABLE = -1;

export const speedToEnergy = (kmh) => (kmh / 3.6) ** 2 / (2 * G);
export const energyToSpeed = (energy) => Math.sqrt(2 * G * energy) * 3.6;

export function findDownhillRoutes(grid, start, goal, settings) {
  const terrain = createTerrain(grid, settings);

  const { energy, previous } = findMaxArrivalEnergy(terrain, start);
  const mask = new Uint8Array(terrain.size);
  const reachableCells = markWhere(mask, REACHABLE, (i) => energy[i] >= 0);
  const noRoute = { mask, reachableCells, corridorCells: 0, path: [] };

  const problem = checkGoal(terrain, start, goal, energy);
  if (problem) return { ...noRoute, ...problem };

  const needed = findMinEnergyNeeded(terrain, goal, energy);
  const corridorCells = markWhere(mask, CORRIDOR, (i) => energy[i] >= 0 && energy[i] >= needed[i] - EPSILON);

  const { path, length } = traceRoute(terrain, previous, goal);
  return {
    mask,
    reachableCells,
    corridorCells,
    reason: null,
    path,
    length,
    descent: terrain.heights[start] - terrain.heights[goal],
    arrivalSpeedKmh: energyToSpeed(energy[goal]),
  };
}

// Grid plus the rules of the energy model.
function createTerrain(grid, { friction, maxSpeedKmh, maxAngle }) {
  const { width, height, heights, cellSize } = grid;
  const slopes = grid.slopes();
  const stepLength = [cellSize, cellSize * Math.SQRT2]; // [straight, diagonal]
  const frictionLoss = [friction * cellSize, friction * cellSize * Math.SQRT2];

  return {
    width,
    heights,
    slopes,
    size: width * height,
    maxEnergy: speedToEnergy(maxSpeedKmh),
    stepLength,
    frictionLoss,

    isSkiable: (cell) => slopes[cell] <= maxAngle, // false for NaN (no data)

    // Calls visit(neighbour, diagonal) for each of the up to 8 neighbours; diagonal is 0 or 1.
    forEachNeighbour(cell, visit) {
      const col = cell % width;
      const row = (cell - col) / width;
      for (let dr = -1; dr <= 1; dr += 1) {
        const r = row + dr;
        if (r < 0 || r >= height) continue;
        for (let dc = -1; dc <= 1; dc += 1) {
          const c = col + dc;
          if ((dr === 0 && dc === 0) || c < 0 || c >= width) continue;
          visit(r * width + c, dr !== 0 && dc !== 0 ? 1 : 0);
        }
      }
    },
  };
}

// Pass 1: the most energy the skier can have on arrival at each cell, starting at A standing
// still. previous[cell] is the neighbour that energy came from, for tracing a route back.
function findMaxArrivalEnergy(terrain, start) {
  const { heights, maxEnergy, frictionLoss } = terrain;
  const energy = new Float32Array(terrain.size).fill(UNREACHABLE);
  const previous = new Int32Array(terrain.size).fill(-1);

  energy[start] = 0;
  relaxUntilStable(terrain.size, start, (cell, update) => {
    terrain.forEachNeighbour(cell, (next, diagonal) => {
      if (!terrain.isSkiable(next)) return;
      const arrival = Math.min(maxEnergy, energy[cell] + heights[cell] - heights[next] - frictionLoss[diagonal]);
      if (arrival >= 0 && arrival > energy[next] + EPSILON) {
        energy[next] = arrival;
        previous[next] = cell;
        update(next);
      }
    });
  });
  return { energy, previous };
}

// Pass 2: the least energy needed at each reachable cell to still make it to B.
function findMinEnergyNeeded(terrain, goal, arrivalEnergy) {
  const { heights, maxEnergy, frictionLoss } = terrain;
  const needed = new Float32Array(terrain.size).fill(Infinity);

  needed[goal] = 0;
  relaxUntilStable(terrain.size, goal, (cell, update) => {
    // Look at the step from each reachable neighbour `from` into `cell`.
    terrain.forEachNeighbour(cell, (from, diagonal) => {
      if (arrivalEnergy[from] < 0) return;
      const neededAtFrom = Math.max(0, needed[cell] - (heights[from] - heights[cell]) + frictionLoss[diagonal]);
      if (neededAtFrom <= maxEnergy && neededAtFrom < needed[from] - EPSILON) {
        needed[from] = neededAtFrom;
        update(from);
      }
    });
  });
  return needed;
}

// Label-correcting search: processes cells from a queue, and relax(cell, update) calls
// update(other) whenever it improved another cell's value, which queues that cell again.
// Ends when nothing improves any more.
function relaxUntilStable(size, first, relax) {
  const queue = new Int32Array(size); // circular buffer
  const queued = new Uint8Array(size);
  let head = 0;
  let count = 0;

  const update = (cell) => {
    if (queued[cell]) return;
    queued[cell] = 1;
    queue[(head + count) % size] = cell;
    count += 1;
  };

  update(first);
  while (count) {
    const cell = queue[head];
    head = (head + 1) % size;
    count -= 1;
    queued[cell] = 0;
    relax(cell, update);
  }
}

// Why there can't be a route to B, or null if pass 2 is worth running.
function checkGoal(terrain, start, goal, energy) {
  const { heights, slopes } = terrain;
  if (Number.isNaN(heights[start]) || Number.isNaN(heights[goal])) return { reason: 'no-data' };
  if (!(heights[goal] < heights[start])) return { reason: 'goal-higher' };
  if (!terrain.isSkiable(goal)) return { reason: 'goal-steep', goalSlope: slopes[goal] };
  if (energy[goal] < 0) return { reason: 'blocked' };
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

// Example route: follow the most-energy predecessors back from B to A.
function traceRoute(terrain, previous, goal) {
  const { width, stepLength } = terrain;
  const path = [];
  let length = 0;
  for (let cell = goal; cell !== -1 && path.length < terrain.size; cell = previous[cell]) {
    if (path.length) {
      const last = path[path.length - 1];
      const diagonal = last % width !== cell % width && Math.floor(last / width) !== Math.floor(cell / width);
      length += stepLength[diagonal ? 1 : 0];
    }
    path.push(cell);
  }
  return { path: path.reverse(), length };
}
