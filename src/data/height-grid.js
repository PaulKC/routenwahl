// Merges downloaded elevation tiles (all in the same metric crs) into one height grid.
import { toProjected, fromProjected } from './projection.js';

export function buildHeightGrid(tiles) {
  const cellSize = tiles[0].resolution;
  const west = Math.min(...tiles.map((t) => t.origin[0]));
  const north = Math.max(...tiles.map((t) => t.origin[1]));
  const east = Math.max(...tiles.map((t) => t.origin[0] + t.width * cellSize));
  const south = Math.min(...tiles.map((t) => t.origin[1] - t.height * cellSize));
  const width = Math.round((east - west) / cellSize);
  const height = Math.round((north - south) / cellSize);

  const heights = new Float32Array(width * height).fill(NaN); // NaN = no data
  for (const tile of tiles) {
    const col0 = Math.round((tile.origin[0] - west) / cellSize);
    const row0 = Math.round((north - tile.origin[1]) / cellSize);
    for (let r = 0; r < tile.height; r += 1) {
      for (let c = 0; c < tile.width; c += 1) {
        const h = tile.heights[r * tile.width + c];
        if (h > -1000 && h < 10000) heights[(row0 + r) * width + col0 + c] = h;
      }
    }
  }

  let gradients = null;
  let slopes = null;

  return {
    ...createGridGeometry({ crs: tiles[0].crs, west, north, width, height, cellSize }),
    heights,
    // Height change per metre eastwards (dzdx) and southwards (dzdy) per cell, by Horn's 3x3
    // method, computed on first use.
    gradients() {
      gradients ??= computeGradients(heights, width, height, cellSize);
      return gradients;
    },
    // Terrain slope in degrees per cell.
    slopes() {
      if (!slopes) {
        const { dzdx, dzdy } = this.gradients();
        slopes = new Float32Array(dzdx.length);
        const toDegrees = 180 / Math.PI;
        for (let i = 0; i < slopes.length; i += 1) slopes[i] = Math.atan(Math.hypot(dzdx[i], dzdy[i])) * toDegrees; // NaN next to missing data
      }
      return slopes;
    },
  };
}

// Where the grid's cells are, without the heights. `geometry` is plain data that can be
// sent to or from a worker and turned back into these helpers.
export function createGridGeometry(geometry) {
  const { crs, west, north, width, height, cellSize } = geometry;

  // Cell index for a coordinate in the grid's crs, or -1 outside the grid.
  const cellAtProjected = (x, y) => {
    const col = Math.floor((x - west) / cellSize);
    const row = Math.floor((north - y) / cellSize);
    return col >= 0 && col < width && row >= 0 && row < height ? row * width + col : -1;
  };

  return {
    geometry,
    width,
    height,
    cellSize,
    crs,
    cellAtProjected,
    // Index of the cell containing a WGS84 point, or -1 outside the grid.
    cellAt(latlng) {
      const { x, y } = toProjected(crs, latlng);
      return cellAtProjected(x, y);
    },
    // WGS84 position of a cell centre.
    latLngOf(index) {
      const col = index % width;
      const row = Math.floor(index / width);
      return fromProjected(crs, west + (col + 0.5) * cellSize, north - (row + 0.5) * cellSize);
    },
  };
}

function computeGradients(heights, width, height, cellSize) {
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    // Clamp at the grid edge so border cells reuse their own row/column.
    const up = Math.max(row - 1, 0) * width;
    const mid = row * width;
    const down = Math.min(row + 1, height - 1) * width;
    for (let col = 0; col < width; col += 1) {
      const left = Math.max(col - 1, 0);
      const right = Math.min(col + 1, width - 1);
      const a = heights[up + left];
      const b = heights[up + col];
      const c = heights[up + right];
      const d = heights[mid + left];
      const f = heights[mid + right];
      const g = heights[down + left];
      const h = heights[down + col];
      const i = heights[down + right];
      gx[mid + col] = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellSize);
      gy[mid + col] = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cellSize);
    }
  }
  return { dzdx: gx, dzdy: gy };
}
