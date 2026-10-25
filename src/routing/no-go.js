// Cells inside areas the route must not cross (wildlife rest zones, see data/wildlife-zones.js).
// settings.noGo lists them as { id, polygons } with polygons as GeoJSON MultiPolygon
// coordinates in WGS84.
import { toProjected } from '../data/projection.js';

const cache = new WeakMap(); // grid -> { key, mask }

// 1 for each cell whose centre lies inside one of the areas, 0 elsewhere.
export function noGoMask(grid, areas) {
  const key = areas.map((area) => area.id).join();
  const cached = cache.get(grid);
  if (cached?.key === key) return cached.mask;
  const { width, height, cellSize } = grid;
  const { crs, west, north } = grid.geometry;
  const mask = new Uint8Array(width * height);
  for (const area of areas) {
    for (const polygon of area.polygons) {
      // Rings in grid units, where cell (row, col) has its centre at (col, row).
      const rings = polygon.map((ring) => ring.map(([lng, lat]) => {
        const { x, y } = toProjected(crs, { lat, lng });
        return [(x - west) / cellSize - 0.5, (north - y) / cellSize - 0.5];
      }));
      fillPolygon(mask, width, height, rings);
    }
  }
  cache.set(grid, { key, mask });
  return mask;
}

// Scanline fill by the even-odd rule over all rings, so holes stay empty.
function fillPolygon(mask, width, height, rings) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const ring of rings) {
    for (const [, y] of ring) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  for (let row = Math.max(0, Math.ceil(top)); row <= Math.min(height - 1, Math.floor(bottom)); row += 1) {
    const crossings = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > row) !== (yj > row)) crossings.push(xi + ((row - yi) * (xj - xi)) / (yj - yi));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k]));
      const to = Math.min(width - 1, Math.floor(crossings[k + 1]));
      for (let col = from; col <= to; col += 1) mask[row * width + col] = 1;
    }
  }
}
