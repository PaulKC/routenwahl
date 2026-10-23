// Strictly downhill routes on a height grid. A route moves between neighbouring cells
// (8 directions) and every step must end lower than it started. Because height always
// drops, routes can't loop, so the set of all routes from A to B is the "corridor":
// cells reachable downhill from A from which B is still reachable downhill.

export const REACHABLE = 1; // reachable downhill from A, but B can't be reached from here
export const CORRIDOR = 2; // on at least one downhill route from A to B

export function findDownhillRoutes(grid, start, goal) {
  const { width, height, heights, cellSize } = grid;
  const size = width * height;
  const mask = new Uint8Array(size);
  const queue = new Int32Array(size);

  const neighbours = (index, visit) => {
    const col = index % width;
    const row = (index - col) / width;
    for (let dr = -1; dr <= 1; dr += 1) {
      const r = row + dr;
      if (r < 0 || r >= height) continue;
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = col + dc;
        if ((dr === 0 && dc === 0) || c < 0 || c >= width) continue;
        visit(r * width + c, dr !== 0 && dc !== 0);
      }
    }
  };

  // 1. Everything reachable from A by only going down.
  let head = 0;
  let tail = 0;
  mask[start] = REACHABLE;
  queue[tail++] = start;
  while (head < tail) {
    const cell = queue[head++];
    const h = heights[cell];
    neighbours(cell, (n) => {
      if (!mask[n] && heights[n] < h) { // NaN (no data) compares false
        mask[n] = REACHABLE;
        queue[tail++] = n;
      }
    });
  }

  const base = { mask, reachableCells: tail, corridorCells: 0, path: [] };
  if (Number.isNaN(heights[start]) || Number.isNaN(heights[goal])) return { ...base, reason: 'no-data' };
  if (!(heights[goal] < heights[start])) return { ...base, reason: 'goal-higher' };
  if (!mask[goal]) return { ...base, reason: 'blocked' };

  // 2. Walk back up from B through reachable cells: those form the corridor.
  head = 0;
  tail = 0;
  mask[goal] = CORRIDOR;
  queue[tail++] = goal;
  while (head < tail) {
    const cell = queue[head++];
    const h = heights[cell];
    neighbours(cell, (n) => {
      if (mask[n] === REACHABLE && heights[n] > h) {
        mask[n] = CORRIDOR;
        queue[tail++] = n;
      }
    });
  }
  const corridor = queue.slice(0, tail).sort((a, b) => heights[b] - heights[a]);

  // 3. Going through the corridor from high to low, find the shortest route and count
  //    all routes (in log10 because the number explodes quickly).
  const distance = new Float64Array(size).fill(Infinity);
  const logRoutes = new Float64Array(size).fill(-Infinity);
  const previous = new Int32Array(size).fill(-1);
  distance[start] = 0;
  logRoutes[start] = 0;
  const diagonal = cellSize * Math.SQRT2;
  for (const cell of corridor) {
    if (distance[cell] === Infinity) continue;
    const h = heights[cell];
    neighbours(cell, (n, isDiagonal) => {
      if (mask[n] !== CORRIDOR || !(heights[n] < h)) return;
      const d = distance[cell] + (isDiagonal ? diagonal : cellSize);
      if (d < distance[n]) {
        distance[n] = d;
        previous[n] = cell;
      }
      const a = logRoutes[n];
      const b = logRoutes[cell];
      const hi = Math.max(a, b);
      logRoutes[n] = hi + Math.log10(10 ** (a - hi) + 10 ** (b - hi));
    });
  }

  const path = [];
  for (let cell = goal; cell !== -1; cell = previous[cell]) path.push(cell);
  path.reverse();

  return {
    ...base,
    reason: null,
    corridorCells: corridor.length,
    path,
    length: distance[goal],
    descent: heights[start] - heights[goal],
    log10Routes: logRoutes[goal],
  };
}
