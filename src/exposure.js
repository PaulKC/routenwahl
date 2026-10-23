// Exposure: a cell can be gentle enough to ski, but if you fall there you slide down the
// fall line. A cell counts as exposed when its fall line runs into terrain at least as
// steep as cliffAngle within fallDistance metres.
//
// The fall line is followed cell by cell, always to the neighbour with the steepest drop,
// until it has covered fallDistance or reaches a spot with no lower neighbour.

// Returns a Uint8Array with 1 for every cell where test(cell) holds and that is exposed.
export function findExposedCells(grid, test, { fallDistance, cliffAngle }) {
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

  for (let cell = 0; cell < size; cell += 1) {
    if (!test(cell)) continue;
    let travelled = 0;
    for (let at = cell; at !== -1 && travelled <= fallDistance;) {
      if (slopes[at] >= cliffAngle) {
        exposed[cell] = 1;
        break;
      }
      const next = fallLineStep(at);
      if (next === -1) break;
      travelled += next % width !== at % width && Math.floor(next / width) !== Math.floor(at / width) ? diagonal : cellSize;
      at = next;
    }
  }
  return exposed;
}
