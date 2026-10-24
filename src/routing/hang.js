// The slope of the whole Hang a cell lies on, for the reduction method's rule that from danger
// level 3 the steepest part of the whole slope counts, not just the slope under the skis.
//
//   1. Steepness of a patch: the median slope of the patchSize × patchSize metres around each
//      cell, so a patch only counts as steep when most of it is (the reduction method's
//      "steilste Hangpartie", taken as 10 × 10 m to not miss locally steep parts).
//   2. A Hang is a connected area of patches at hangAngle (30°) or steeper, since avalanches
//      hardly release on flatter terrain; ridges, shoulders and basins separate Hänge. It only
//      grows into cells whose aspect is within aspectSplit of the Hang's mean aspect, so a
//      north face and the east face beside it are separate Hänge.
//   3. Each cell of a Hang gets the steepest patch of its Hang. Cells in no Hang keep their own
//      slope, and no cell is judged gentler than its own slope.

const cache = new WeakMap(); // grid -> { key, hangs }

// The Hänge of the grid: { slopes, labels, steepest }. slopes is the slope in degrees to judge
// each cell by under the whole-slope rule, labels the number of each cell's Hang (0 = none)
// and steepest[n] the steepest patch of Hang n.
export function findHangs(grid, { patchSize, hangAngle, aspectSplit }) {
  const key = `${patchSize}/${hangAngle}/${aspectSplit}`;
  const cached = cache.get(grid);
  if (cached?.key === key) return cached.hangs;
  const patches = patchSteepness(grid, patchSize);
  const hangs = spreadOverHang(grid, patches, hangAngle, aspectSplit);
  cache.set(grid, { key, hangs });
  return hangs;
}

export const hangSlopes = (grid, settings) => findHangs(grid, settings).slopes;

// Median slope and mean downhill direction (unit vector east/south) of the patch around each cell.
function patchSteepness(grid, patchSize) {
  const { width, height, cellSize } = grid;
  const slopes = grid.slopes();
  const { dzdx, dzdy } = grid.gradients();
  const half = Math.floor(Math.max(1, Math.round(patchSize / cellSize)) / 2);
  const steepness = new Float32Array(width * height).fill(NaN);
  const dirX = new Float32Array(width * height);
  const dirY = new Float32Array(width * height);
  const window = new Float32Array((2 * half + 1) ** 2);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      let n = 0;
      let gx = 0;
      let gy = 0;
      for (let r = Math.max(0, row - half); r <= Math.min(height - 1, row + half); r += 1) {
        for (let c = Math.max(0, col - half); c <= Math.min(width - 1, col + half); c += 1) {
          const i = r * width + c;
          if (Number.isNaN(slopes[i])) continue;
          window[n] = slopes[i];
          n += 1;
          gx += dzdx[i];
          gy += dzdy[i];
        }
      }
      if (n * 2 < window.length) continue; // mostly no data
      const cell = row * width + col;
      steepness[cell] = median(window, n);
      const length = Math.hypot(gx, gy);
      if (length > 0) {
        dirX[cell] = -gx / length;
        dirY[cell] = -gy / length;
      }
    }
  }
  return { steepness, dirX, dirY };
}

// Middle value of the first n entries (sorts them in place).
function median(values, n) {
  const part = values.subarray(0, n).sort();
  return n % 2 ? part[(n - 1) / 2] : (part[n / 2 - 1] + part[n / 2]) / 2;
}

function spreadOverHang(grid, { steepness, dirX, dirY }, hangAngle, aspectSplit) {
  const { width, height } = grid;
  const own = grid.slopes();
  const result = Float32Array.from(own);
  const labels = new Int32Array(width * height); // 0 = not yet in a Hang
  const steepestOf = [0];
  const minCos = Math.cos((aspectSplit * Math.PI) / 180);

  for (let seed = 0; seed < result.length; seed += 1) {
    if (labels[seed] || !(steepness[seed] >= hangAngle)) continue;
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
          if (labels[neighbour] || !(steepness[neighbour] >= hangAngle)) continue;
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
