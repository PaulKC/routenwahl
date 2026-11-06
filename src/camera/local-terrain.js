// The terrain around the skier for the camera view, cut from elevation tiles that are already
// in the browser (decoded this visit or kept in the tile store). Nothing is downloaded here.
import { buildHeightGrid } from '../data/height-grid.js';
import { toProjected } from '../data/projection.js';

const inTile = (tile, x, y) => x >= tile.origin[0] && x < tile.origin[0] + tile.width * tile.resolution
  && y <= tile.origin[1] && y > tile.origin[1] - tile.height * tile.resolution;

const heightIn = (tile, x, y) => {
  const col = Math.floor((x - tile.origin[0]) / tile.resolution);
  const row = Math.floor((tile.origin[1] - y) / tile.resolution);
  const h = tile.heights[row * tile.width + col];
  return h > -1000 && h < 10000 ? h : NaN;
};

// The tile with a height at `latlng`, its crs, and the position in that crs, or null.
export function tileAt(tiles, latlng) {
  for (const tile of tiles) {
    const { x, y } = toProjected(tile.crs, latlng);
    if (inTile(tile, x, y) && Number.isFinite(heightIn(tile, x, y))) return { tile, x, y };
  }
  return null;
}

// Height at (x, y) in `crs` from any of the tiles, NaN where none has one. Remembers the last
// tile it found, as the next lookup is usually close by.
export function createHeightSampler(tiles, crs) {
  const own = tiles.filter((tile) => tile.crs === crs);
  let last = own[0];
  return (x, y) => {
    if (!last || !inTile(last, x, y)) {
      last = own.find((tile) => inTile(tile, x, y));
      if (!last) return NaN;
    }
    return heightIn(last, x, y);
  };
}

// The heights of the square of 2 × radius metres around (x, y) as one tile, on the pixel grid
// of `anchor` (the tile under the skier) and cut from the tiles of its crs and resolution.
// Cells no tile covers are NaN.
export function cropTile(tiles, anchor, x, y, radius) {
  const { crs, resolution: res } = anchor;
  const [ox, oy] = anchor.origin;
  const west = ox + Math.floor((x - radius - ox) / res) * res;
  const north = oy - Math.floor((oy - (y + radius)) / res) * res;
  const size = Math.ceil((2 * radius) / res);
  const heights = new Float32Array(size * size).fill(NaN);
  for (const tile of tiles) {
    if (tile.crs !== crs || Math.abs(tile.resolution - res) > 1e-6) continue;
    // Offsets of this tile's pixels in the window, in whole cells.
    const col0 = Math.round((tile.origin[0] - west) / res);
    const row0 = Math.round((north - tile.origin[1]) / res);
    const rFrom = Math.max(0, -row0);
    const rTo = Math.min(tile.height, size - row0);
    const cFrom = Math.max(0, -col0);
    const cTo = Math.min(tile.width, size - col0);
    for (let r = rFrom; r < rTo; r += 1) {
      for (let c = cFrom; c < cTo; c += 1) {
        heights[(row0 + r) * size + col0 + c] = tile.heights[r * tile.width + c];
      }
    }
  }
  return { crs, origin: [west, north], width: size, height: size, resolution: res, heights };
}

// The same square as a height grid (see height-grid.js).
export const cropGrid = (tiles, anchor, x, y, radius) => buildHeightGrid([cropTile(tiles, anchor, x, y, radius)]);

// Angle in degrees of true north in the projected grid, clockwise from the grid's north
// (meridian convergence; up to about 2° in Switzerland).
export function gridNorthOffset(crs, latlng) {
  const a = toProjected(crs, latlng);
  const b = toProjected(crs, { lat: latlng.lat + 0.01, lng: latlng.lng });
  return (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
}

// Rough magnetic declination in degrees (east positive) for the Alps around 2026, from a
// linear fit (Grenoble ~2.5°, Bern ~3.3°, Innsbruck ~4.5°). Phone compasses point to magnetic
// north. Elsewhere it is off by a few degrees, which the alignment drag absorbs anyway.
export const magneticDeclination = ({ lng }) => 3.3 + 0.35 * (lng - 8);

// The skyline seen from (x, y, eyeHeight): for each of `steps` directions (clockwise from grid
// north) the highest elevation angle of the terrain in radians, out to maxDistance metres.
// -Infinity where no terrain was found.
export function computeSkyline(sample, x, y, eyeHeight, { steps = 720, minDistance = 30, maxDistance = 6000 } = {}) {
  const angles = new Float32Array(steps).fill(-Infinity);
  for (let i = 0; i < steps; i += 1) {
    const az = (i / steps) * 2 * Math.PI;
    const dx = Math.sin(az);
    const dy = Math.cos(az);
    let best = -Infinity;
    // Steps grow with the distance: 2 % of it, at least 4 m.
    for (let d = minDistance; d <= maxDistance; d += Math.max(4, d * 0.02)) {
      const h = sample(x + dx * d, y + dy * d);
      if (!Number.isFinite(h)) continue;
      // The earth's curvature lowers distant terrain (d² / 2R, less 13 % for refraction).
      const angle = Math.atan2(h - (0.87 * d * d) / (2 * 6371000) - eyeHeight, d);
      if (angle > best) best = angle;
    }
    angles[i] = best;
  }
  return angles;
}
