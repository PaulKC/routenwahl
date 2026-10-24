// Merges downloaded swissALTI3D tiles into one LV95-aligned height grid.
import { toLV95, fromLV95 } from './lv95.js';

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
        if (h > -1000) heights[(row0 + r) * width + col0 + c] = h;
      }
    }
  }

  // Cell index for a LV95 coordinate, or -1 outside the grid.
  const cellAtLV95 = (e, n) => {
    const col = Math.floor((e - west) / cellSize);
    const row = Math.floor((north - n) / cellSize);
    return col >= 0 && col < width && row >= 0 && row < height ? row * width + col : -1;
  };

  let slopes = null;

  return {
    width,
    height,
    cellSize,
    heights,
    cellAtLV95,
    // Terrain slope in degrees per cell (Horn's 3x3 method), computed on first use.
    slopes() {
      slopes ??= computeSlopes(heights, width, height, cellSize);
      return slopes;
    },
    // Index of the cell containing a WGS84 point, or -1 outside the grid.
    cellAt(latlng) {
      const { e, n } = toLV95(latlng);
      return cellAtLV95(e, n);
    },
    // WGS84 position of a cell centre.
    latLngOf(index) {
      const col = index % width;
      const row = Math.floor(index / width);
      return fromLV95(west + (col + 0.5) * cellSize, north - (row + 0.5) * cellSize);
    },
  };
}

function computeSlopes(heights, width, height, cellSize) {
  const slopes = new Float32Array(width * height);
  const toDegrees = 180 / Math.PI;
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
      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellSize);
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cellSize);
      slopes[mid + col] = Math.atan(Math.hypot(dzdx, dzdy)) * toDegrees; // NaN next to missing data
    }
  }
  return slopes;
}
