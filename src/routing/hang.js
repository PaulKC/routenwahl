// The slope of the whole Hang a cell lies on, for the reduction method's rule that from danger
// level 3 the steepest part of the whole slope counts, not just the slope under the skis.
//
//   1. Steepness of a patch: the median slope of the patchSize × patchSize metres around each
//      cell, so a patch only counts as steep when most of it is (the reduction method's
//      "steilste Hangpartie", taken as 10 × 10 m to not miss locally steep parts).
//   2. A Hang is a connected area of patches from hangAngle (30°) up to rockAngle (55°), since
//      slab avalanches hardly release on flatter terrain and steeper terrain is rock that holds
//      little snow; ridges, shoulders, basins and rock bands separate Hänge (the cliff and
//      exposure check covers the rock). It only grows into cells whose aspect is within
//      ribAngle (30°) of the neighbouring cell's, so ribs and gully edges end a Hang while a
//      gently curving bowl stays one, and within aspectSplit (60°) of the Hang's mean aspect,
//      so a north face and the east face beside it are separate Hänge.
//   3. Each cell of a Hang gets the steepest patch of its Hang. Cells in no Hang keep their own
//      slope, and no cell is judged gentler than its own slope.

const cache = new WeakMap(); // grid -> { key, hangs }

// The Hänge of the grid: { slopes, labels, steepest }. slopes is the slope in degrees to judge
// each cell by under the whole-slope rule, labels the number of each cell's Hang (0 = none)
// and steepest[n] the steepest patch of Hang n.
export function findHangs(grid, settings) {
  const { patchSize, hangAngle, rockAngle, ribAngle, aspectSplit } = settings;
  const key = `${patchSize}/${hangAngle}/${rockAngle}/${ribAngle}/${aspectSplit}`;
  const cached = cache.get(grid);
  if (cached?.key === key) return cached.hangs;
  const patches = patchSteepness(grid, patchSize);
  const hangs = spreadOverHang(grid, patches, settings);
  cache.set(grid, { key, hangs });
  return hangs;
}

export const hangSlopes = (grid, settings) => findHangs(grid, settings).slopes;

// Median slope and mean downhill direction (unit vector east/south) of the patch around each cell.
// The median comes from a histogram of the window's slopes in 0.1° bins that slides along each
// row: moving one cell on adds the column entering the window and removes the one leaving it,
// so the cost grows with the window's width rather than its area (Huang's running median).
const BINS_PER_DEGREE = 10;

function patchSteepness(grid, patchSize) {
  const { width, height, cellSize } = grid;
  const slopes = grid.slopes();
  const { dzdx, dzdy } = grid.gradients();
  const half = Math.floor(Math.max(1, Math.round(patchSize / cellSize)) / 2);
  const fullWindow = (2 * half + 1) ** 2;
  const steepness = new Float32Array(width * height).fill(NaN);
  const dirX = new Float32Array(width * height);
  const dirY = new Float32Array(width * height);
  const bin = new Int16Array(width * height).fill(-1); // -1 = no data
  for (let i = 0; i < bin.length; i += 1) {
    if (!Number.isNaN(slopes[i])) bin[i] = Math.min(90 * BINS_PER_DEGREE, Math.round(slopes[i] * BINS_PER_DEGREE));
  }
  const histogram = new Int32Array(90 * BINS_PER_DEGREE + 1);

  for (let row = 0; row < height; row += 1) {
    const top = Math.max(0, row - half);
    const bottom = Math.min(height - 1, row + half);
    histogram.fill(0);
    let n = 0;
    let gx = 0;
    let gy = 0;
    let median = 0; // bin of the median
    let below = 0; // values in bins under `median`
    // Adds (sign 1) or removes (sign -1) one column of the window.
    const addColumn = (col, sign) => {
      for (let r = top; r <= bottom; r += 1) {
        const i = r * width + col;
        const b = bin[i];
        if (b < 0) continue;
        histogram[b] += sign;
        n += sign;
        if (b < median) below += sign;
        gx += sign * dzdx[i];
        gy += sign * dzdy[i];
      }
    };
    for (let col = 0; col < Math.min(half, width); col += 1) addColumn(col, 1);
    for (let col = 0; col < width; col += 1) {
      if (col + half < width) addColumn(col + half, 1);
      if (col - half - 1 >= 0) addColumn(col - half - 1, -1);
      if (n * 2 < fullWindow) continue; // mostly no data
      // Move to the bin holding the lower middle value.
      const k = (n - 1) >> 1;
      while (below > k) {
        median -= 1;
        below -= histogram[median];
      }
      while (below + histogram[median] <= k) {
        below += histogram[median];
        median += 1;
      }
      const cell = row * width + col;
      steepness[cell] = median / BINS_PER_DEGREE;
      const length = Math.hypot(gx, gy);
      if (length > 0) {
        dirX[cell] = -gx / length;
        dirY[cell] = -gy / length;
      }
    }
  }
  return { steepness, dirX, dirY, windowCells: 2 * half + 1 };
}

function spreadOverHang(grid, { steepness, dirX, dirY, windowCells }, { hangAngle, rockAngle, ribAngle, aspectSplit }) {
  const { width, height } = grid;
  const own = grid.slopes();
  const result = Float32Array.from(own);
  const labels = new Int32Array(width * height); // 0 = not yet in a Hang
  const steepestOf = [0];
  const minCos = Math.cos((aspectSplit * Math.PI) / 180);
  // The patch aspect is smoothed over the window, so a sharp rib turns it gradually over about
  // the window's width; a rib of ribAngle shows as ribAngle / windowCells per cell.
  const minRibCos = Math.cos((ribAngle / windowCells) * (Math.PI / 180));
  const inHang = (cell) => steepness[cell] >= hangAngle && steepness[cell] <= rockAngle;

  for (let seed = 0; seed < result.length; seed += 1) {
    if (labels[seed] || !inHang(seed)) continue;
    const label = steepestOf.length;
    // Flood fill one Hang outwards from the seed (breadth first, so the mean aspect stays that
    // of the cells around the seed instead of drifting along one long arm), keeping the sum
    // of its cells' downhill directions as its mean aspect.
    const members = [seed];
    let sumX = 0;
    let sumY = 0;
    let steepest = 0;
    labels[seed] = label;
    for (let i = 0; i < members.length; i += 1) {
      const cell = members[i];
      sumX += dirX[cell];
      sumY += dirY[cell];
      if (steepness[cell] > steepest) steepest = steepness[cell];
      const meanLength = Math.hypot(sumX, sumY) || 1;
      const col = cell % width;
      const row = (cell - col) / width;
      for (let r = Math.max(0, row - 1); r <= Math.min(height - 1, row + 1); r += 1) {
        for (let c = Math.max(0, col - 1); c <= Math.min(width - 1, col + 1); c += 1) {
          const neighbour = r * width + c;
          if (labels[neighbour] || !inHang(neighbour)) continue;
          if (dirX[neighbour] * dirX[cell] + dirY[neighbour] * dirY[cell] < minRibCos) continue; // rib or gully
          if ((dirX[neighbour] * sumX + dirY[neighbour] * sumY) / meanLength < minCos) continue; // other aspect
          labels[neighbour] = label;
          members.push(neighbour);
        }
      }
    }
    for (const cell of members) {
      if (steepest > result[cell]) result[cell] = steepest;
    }
    steepestOf.push(steepest);
  }
  return { slopes: result, labels, steepest: steepestOf };
}
