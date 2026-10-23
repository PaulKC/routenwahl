// Exposure: a cell can be gentle enough to ski, but if you fall there you slide down the
// fall line. A cell counts as exposed when its fall line runs into a cliff: a stretch of
// terrain at least as steep as cliffAngle that drops at least minFallHeight metres (so
// small walls and embankments don't count).
//
// The fall line is followed cell by cell, always to the neighbour with the steepest drop.
// It is followed for fallDistance metres, and further for as long as the terrain is steep
// enough to keep sliding. A cliff found on the way is followed to its foot to measure its
// full height. In the 2 m data rock faces often alternate between just above and just below
// cliffAngle, so short gentler gaps inside a cliff don't end it.

const KEEP_SLIDING_ANGLE = 30; // degrees: on terrain this steep a fall doesn't stop
const CLIFF_GAP = 10; // metres of gentler terrain that still count as part of the same cliff

// Returns a Uint8Array with 1 for every cell where test(cell) holds and that is exposed.
export function findExposedCells(grid, test, { fallDistance, cliffAngle, minFallHeight }) {
  const { width, height, heights, cellSize } = grid;
  const slopes = grid.slopes();
  const size = width * height;
  const exposed = new Uint8Array(size);
  const diagonal = cellSize * Math.SQRT2;

  // Neighbour on the fall line (steepest drop per metre), or -1 if none is lower.
  const fallLineStep = (cell) => {
    const col = cell % width;
    const row = (cell - col) / width;
    let best = -1;
    let bestGradient = 0;
    for (let dr = -1; dr <= 1; dr += 1) {
      const r = row + dr;
      if (r < 0 || r >= height) continue;
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = col + dc;
        if ((dr === 0 && dc === 0) || c < 0 || c >= width) continue;
        const next = r * width + c;
        const gradient = (heights[cell] - heights[next]) / (dr && dc ? diagonal : cellSize);
        if (gradient > bestGradient) { // NaN (no data) never wins
          bestGradient = gradient;
          best = next;
        }
      }
    }
    return best;
  };

  const fallsOffCliff = (cell) => {
    let travelled = 0;
    let inCliff = false;
    let cliffDrop = 0; // height lost so far on the current cliff
    let gap = 0; // metres of gentler terrain since the last cliff cell
    for (let at = cell; ;) {
      if (slopes[at] >= cliffAngle) {
        inCliff = true;
        gap = 0;
      }
      const stillSliding = travelled <= fallDistance || slopes[at] >= KEEP_SLIDING_ANGLE;
      if (!inCliff && !stillSliding) return false;

      const next = fallLineStep(at);
      if (next === -1) return false;
      const step = next % width !== at % width && Math.floor(next / width) !== Math.floor(at / width) ? diagonal : cellSize;
      if (inCliff) {
        cliffDrop += heights[at] - heights[next];
        if (cliffDrop >= minFallHeight) return true;
        if (slopes[at] < cliffAngle) {
          gap += step;
          if (gap > CLIFF_GAP) {
            inCliff = false;
            cliffDrop = 0;
          }
        }
      }
      travelled += step;
      at = next;
    }
  };

  for (let cell = 0; cell < size; cell += 1) {
    if (test(cell) && fallsOffCliff(cell)) exposed[cell] = 1;
  }
  return exposed;
}
