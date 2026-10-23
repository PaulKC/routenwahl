// The energy model for a skier who carries speed. Speed is stored as energy in metres of
// height (v² / 2g). Every step to one of the 8 neighbouring cells
//   - adds the height lost (or subtracts the height gained),
//   - subtracts friction × step length,
//   - is capped at the max speed,
// and is only allowed if the energy stays at or above zero. So flat or slightly uphill
// bits are fine as long as the skier arrives with enough speed. Cells whose terrain is
// steeper than maxAngle are off limits (only A itself may be steeper).

const G = 9.81;
export const EPSILON = 1e-3; // ignore improvements smaller than 1 mm of energy
const UNREACHABLE = -1;

export const speedToEnergy = (kmh) => (kmh / 3.6) ** 2 / (2 * G);
export const energyToSpeed = (energy) => Math.sqrt(2 * G * energy) * 3.6;

// Grid plus the rules of the energy model.
export function createTerrain(grid, { friction, maxSpeedKmh, maxAngle }) {
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
export function findMaxArrivalEnergy(terrain, start) {
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
export function findMinEnergyNeeded(terrain, goalCells, arrivalEnergy) {
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
