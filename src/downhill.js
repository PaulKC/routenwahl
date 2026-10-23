// Downhill routes for a skier who carries speed. Speed is tracked as energy in metres of
// height (v² / 2g). Each step to one of the 8 neighbouring cells adds the height lost and
// subtracts friction × distance; the energy is capped at the max speed and must never drop
// below zero. So flat or slightly uphill bits are fine as long as there is enough speed.
//
// Cells steeper than maxAngle (terrain slope, not the direction of travel) are off limits;
// only A itself may be steeper.
//
// The "corridor" is every cell on some feasible route from A to B: the most energy a skier
// can arrive there with is at least the energy needed from there to still reach B.

export const REACHABLE = 1; // reachable from A, but B can't be reached from here
export const CORRIDOR = 2; // on at least one feasible route from A to B

const G = 9.81;
const EPSILON = 1e-3; // ignore improvements smaller than 1 mm of energy

export const speedToEnergy = (kmh) => (kmh / 3.6) ** 2 / (2 * G);
export const energyToSpeed = (energy) => Math.sqrt(2 * G * energy) * 3.6;

export function findDownhillRoutes(grid, start, goal, { friction, maxSpeedKmh, maxAngle }) {
  const { width, height, heights, cellSize } = grid;
  const size = width * height;
  const maxEnergy = speedToEnergy(maxSpeedKmh);
  const slopes = grid.slopes();
  const stepCost = [friction * cellSize, friction * cellSize * Math.SQRT2]; // [straight, diagonal]

  const neighbours = (index, visit) => {
    const col = index % width;
    const row = (index - col) / width;
    for (let dr = -1; dr <= 1; dr += 1) {
      const r = row + dr;
      if (r < 0 || r >= height) continue;
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = col + dc;
        if ((dr === 0 && dc === 0) || c < 0 || c >= width) continue;
        visit(r * width + c, dr !== 0 && dc !== 0 ? 1 : 0);
      }
    }
  };

  // Label-correcting search: a cell goes back into the queue whenever its value improves.
  const queue = new Int32Array(size);
  const queued = new Uint8Array(size);
  let head = 0;
  let count = 0;
  const push = (cell) => {
    if (queued[cell]) return;
    queued[cell] = 1;
    queue[(head + count) % size] = cell;
    count += 1;
  };
  const pop = () => {
    const cell = queue[head];
    head = (head + 1) % size;
    count -= 1;
    queued[cell] = 0;
    return cell;
  };

  // 1. Most energy the skier can have on arrival at each cell, starting at A standing still.
  const best = new Float32Array(size).fill(-1); // -1 = not reachable
  const previous = new Int32Array(size).fill(-1);
  best[start] = 0;
  push(start);
  while (count) {
    const cell = pop();
    const e = best[cell];
    const h = heights[cell];
    neighbours(cell, (n, diagonal) => {
      if (!(slopes[n] <= maxAngle)) return; // too steep, or no data
      const arrival = Math.min(maxEnergy, e + h - heights[n] - stepCost[diagonal]);
      if (arrival >= 0 && arrival > best[n] + EPSILON) { // NaN (no data) fails both checks
        best[n] = arrival;
        previous[n] = cell;
        push(n);
      }
    });
  }

  const mask = new Uint8Array(size);
  let reachableCells = 0;
  for (let i = 0; i < size; i += 1) {
    if (best[i] >= 0) {
      mask[i] = REACHABLE;
      reachableCells += 1;
    }
  }

  const base = { mask, reachableCells, corridorCells: 0, path: [] };
  if (Number.isNaN(heights[start]) || Number.isNaN(heights[goal])) return { ...base, reason: 'no-data' };
  if (!(heights[goal] < heights[start])) return { ...base, reason: 'goal-higher' };
  if (!(slopes[goal] <= maxAngle)) return { ...base, reason: 'goal-steep', goalSlope: slopes[goal] };
  if (best[goal] < 0) return { ...base, reason: 'blocked' };

  // 2. Least energy needed at each reachable cell to still make it to B.
  const need = new Float32Array(size).fill(Infinity);
  need[goal] = 0;
  push(goal);
  while (count) {
    const cell = pop();
    const required = need[cell];
    const h = heights[cell];
    neighbours(cell, (p, diagonal) => {
      if (best[p] < 0) return;
      // Stepping p -> cell must leave at least `required`, and energy can't exceed the cap.
      const atP = Math.max(0, required - (heights[p] - h) + stepCost[diagonal]);
      if (atP <= maxEnergy && atP < need[p] - EPSILON) {
        need[p] = atP;
        push(p);
      }
    });
  }

  let corridorCells = 0;
  for (let i = 0; i < size; i += 1) {
    if (best[i] >= 0 && best[i] >= need[i] - EPSILON) {
      mask[i] = CORRIDOR;
      corridorCells += 1;
    }
  }

  // 3. Example route: follow the most-energy predecessors back from B.
  const path = [];
  let length = 0;
  for (let cell = goal; cell !== -1 && path.length < size; cell = previous[cell]) {
    if (path.length) {
      const last = path[path.length - 1];
      const diagonal = last % width !== cell % width && Math.floor(last / width) !== Math.floor(cell / width);
      length += diagonal ? cellSize * Math.SQRT2 : cellSize;
    }
    path.push(cell);
  }
  path.reverse();

  return {
    ...base,
    reason: null,
    corridorCells,
    path,
    length,
    descent: heights[start] - heights[goal],
    arrivalSpeedKmh: energyToSpeed(best[goal]),
  };
}
