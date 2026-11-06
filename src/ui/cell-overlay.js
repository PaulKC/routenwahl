// Cell values of a height grid (a route mask, the Hänge, ...) as an image on the map.
import { toProjected } from '../data/projection.js';

const MAX_OVERLAY_PX = 2048;
const EXACT_EVERY_PX = 16; // overlay pixels between exact projections; the rest is interpolated

// Paints the cells into a canvas laid out in WGS84 so it lines up with the map. mask has one
// entry per cell of the grid; 0 is left empty, other values get colorOf(value) as
// [r, g, b, a]. Returns the canvas as a Leaflet image overlay, or null if mask is all 0.
export function cellOverlay(grid, mask, colorOf) {
  let [minRow, maxRow, minCol, maxCol] = [Infinity, -1, Infinity, -1];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const col = i % grid.width;
    const row = (i - col) / grid.width;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }
  if (maxRow < 0) return null;
  const corners = [[minRow, minCol], [minRow, maxCol], [maxRow, minCol], [maxRow, maxCol]]
    .map(([r, c]) => grid.latLngOf(r * grid.width + c));
  const bounds = L.latLngBounds(corners).pad(0.05);

  const metresPerDegLat = 111320;
  const metresPerDegLng = 111320 * Math.cos(bounds.getCenter().lat * Math.PI / 180);
  const scale = Math.min(1, MAX_OVERLAY_PX / Math.max(
    ((bounds.getEast() - bounds.getWest()) * metresPerDegLng) / grid.cellSize,
    ((bounds.getNorth() - bounds.getSouth()) * metresPerDegLat) / grid.cellSize,
  ));
  const w = Math.max(1, Math.round(((bounds.getEast() - bounds.getWest()) * metresPerDegLng) / grid.cellSize * scale));
  const h = Math.max(1, Math.round(((bounds.getNorth() - bounds.getSouth()) * metresPerDegLat) / grid.cellSize * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  // Projecting every pixel is slow, so each row projects every EXACT_EVERY_PX-th pixel and
  // interpolates in between (off by millimetres at this scale).
  const lngAt = (x) => bounds.getWest() + ((x + 0.5) / w) * (bounds.getEast() - bounds.getWest());
  for (let y = 0; y < h; y += 1) {
    const lat = bounds.getNorth() - ((y + 0.5) / h) * (bounds.getNorth() - bounds.getSouth());
    for (let x0 = 0; x0 < w; x0 += EXACT_EVERY_PX) {
      const x1 = Math.min(x0 + EXACT_EVERY_PX, w - 1);
      const p0 = toProjected(grid.crs, { lat, lng: lngAt(x0) });
      const p1 = toProjected(grid.crs, { lat, lng: lngAt(x1) });
      for (let x = x0; x < Math.min(x0 + EXACT_EVERY_PX, w); x += 1) {
        const t = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
        const cell = grid.cellAtProjected(p0.x + t * (p1.x - p0.x), p0.y + t * (p1.y - p0.y));
        const color = cell >= 0 && mask[cell] && colorOf(mask[cell]);
        if (color) image.data.set(color, (y * w + x) * 4);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return L.imageOverlay(canvas.toDataURL(), bounds, { className: 'pixelated' });
}
