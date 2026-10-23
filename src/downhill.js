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
// B is a target zone: arriving at any cell within goalRadius metres of B counts.
//
// The search runs in two passes over the height grid:
//   1. forward from A:  the most energy the skier can arrive with at each cell,
//   2. backward from B: the least energy needed at each cell to still make it into B's zone.
// A cell lies on some feasible route ("the corridor") when 1. is at least 2.
//
// The example route is the "safest" feasible route: first, its steepest point is as gentle
// as possible (found by lowering the angle limit until no route is left); then, among the
// routes under that limit, it prefers gentle terrain over steep and short over long.

export const REACHABLE = 1; // reachable from A, but B can't be reached from here
export const CORRIDOR = 2; // on at least one feasible route from A to B

const G = 9.81;
const EPSILON = 1e-3; // ignore improvements smaller than 1 mm of energy
const UNREACHABLE = -1;
const SAFEST_ANGLE_PRECISION = 0.5; // degrees
const STEEPNESS_PENALTY = 4; // a step at the angle limit costs 1 + 4 = 5x a flat step

export const speedToEnergy = (kmh) => (kmh / 3.6) ** 2 / (2 * G);
export const energyToSpeed = (energy) => Math.sqrt(2 * G * energy) * 3.6;

export function findDownhillRoutes(grid, start, goal, settings) {
  const terrain = createTerrain(grid, settings);

  const energy = findMaxArrivalEnergy(terrain, start);
  const mask = new Uint8Array(terrain.size);
  const reachableCells = markWhere(mask, REACHABLE, (i) => energy[i] >= 0);
  const noRoute = { mask, reachableCells, corridorCells: 0, path: [] };

  const zone = cellsWithin(grid, goal, settings.goalRadius);
  const problem = checkGoal(terrain, start, goal, zone, energy);
  if (problem) return { ...noRoute, ...problem };

  const arrivals = zone.filter((cell) => energy[cell] >= 0);
  const needed = findMinEnergyNeeded(terrain, arrivals, energy);
  const corridorCells = markWhere(mask, CORRIDOR, (i) => energy[i] >= 0 && energy[i] >= needed[i] - EPSILON);

  const route = findSafestRoute(grid, start, zone, settings);
  return { mask, reachableCells, corridorCells, reason: null, ...route };
}

// The feasible route whose steepest point is as gentle as possible (see top of file).
function findSafestRoute(grid, start, zone, settings) {
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

// Binary min-heap of (priority, cell) pairs.
function createMinHeap() {
  const priorities = [];
  const cells = [];
  const swap = (i, j) => {
    [priorities[i], priorities[j]] = [priorities[j], priorities[i]];
    [cells[i], cells[j]] = [cells[j], cells[i]];
  };
  return {
    size: () => cells.length,
    push(priority, cell) {
      priorities.push(priority);
      cells.push(cell);
      for (let i = cells.length - 1; i > 0;) {
        const parent = (i - 1) >> 1;
        if (priorities[parent] <= priorities[i]) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop() {
      const top = cells[0];
      const lastPriority = priorities.pop();
      const lastCell = cells.pop();
      if (cells.length) {
        priorities[0] = lastPriority;
        cells[0] = lastCell;
        for (let i = 0; ;) {
          const left = 2 * i + 1;
          const right = left + 1;
          let smallest = i;
          if (left < cells.length && priorities[left] < priorities[smallest]) smallest = left;
          if (right < cells.length && priorities[right] < priorities[smallest]) smallest = right;
          if (smallest === i) break;
          swap(i, smallest);
          i = smallest;
        }
      }
      return top;
    },
  };
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
// still.
function findMaxArrivalEnergy(terrain, start) {
  const { heights, maxEnergy, frictionLoss } = terrain;
  const energy = new Float32Array(terrain.size).fill(UNREACHABLE);

  energy[start] = 0;
  relaxUntilStable(terrain.size, [start], (cell, update) => {
    terrain.forEachNeighbour(cell, (next, diagonal) => {
      if (!terrain.isSkiable(next)) return;
      const arrival = Math.min(maxEnergy, energy[cell] + heights[cell] - heights[next] - frictionLoss[diagonal]);
      if (arrival >= 0 && arrival > energy[next] + EPSILON) {
        energy[next] = arrival;
        update(next);
      }
    });
  });
  return energy;
}

// Pass 2: the least energy needed at each reachable cell to still make it into B's zone.
function findMinEnergyNeeded(terrain, goalCells, arrivalEnergy) {
  const { heights, maxEnergy, frictionLoss } = terrain;
  const needed = new Float32Array(terrain.size).fill(Infinity);

  for (const cell of goalCells) needed[cell] = 0;
  relaxUntilStable(terrain.size, goalCells, (cell, update) => {
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
function relaxUntilStable(size, firstCells, relax) {
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

  firstCells.forEach(update);
  while (count) {
    const cell = queue[head];
    head = (head + 1) % size;
    count -= 1;
    queued[cell] = 0;
    relax(cell, update);
  }
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
