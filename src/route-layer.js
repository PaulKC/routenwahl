// Shows the downhill corridor and the shortest downhill route on the map.
import { buildHeightGrid } from './height-grid.js';
import { findDownhillRoutes, REACHABLE, CORRIDOR } from './downhill.js';
import { toLV95 } from './lv95.js';

const COLORS = {
  [REACHABLE]: [255, 152, 0, 90], // orange: downhill from A, but dead end
  [CORRIDOR]: [46, 125, 50, 150], // green: on some downhill route to B
};
const MAX_OVERLAY_PX = 2048;

export function createRouteLayer(map, showStatus) {
  const group = L.layerGroup().addTo(map);

  function clear() {
    group.clearLayers();
    showStatus('');
  }

  function compute(tiles, start, end) {
    clear();
    const t0 = performance.now();
    const grid = buildHeightGrid(tiles);
    const a = grid.cellAt(start);
    const b = grid.cellAt(end);
    if (a < 0 || b < 0) {
      showStatus('Route: A oder B liegt ausserhalb der Höhendaten');
      return null;
    }
    const result = findDownhillRoutes(grid, a, b);
    const ms = Math.round(performance.now() - t0);

    drawMask(grid, result.mask);
    if (result.path.length) {
      L.polyline(result.path.map(grid.latLngOf), { color: '#0d47a1', weight: 3 })
        .bindTooltip('Kürzeste streng abfallende Route')
        .addTo(group);
    }
    showStatus(describe(grid, a, b, result, ms));
    return result;
  }

  // Paints the mask into a canvas laid out in WGS84 so it lines up with the map.
  function drawMask(grid, mask) {
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
    if (maxRow < 0) return;
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
    for (let y = 0; y < h; y += 1) {
      const lat = bounds.getNorth() - ((y + 0.5) / h) * (bounds.getNorth() - bounds.getSouth());
      for (let x = 0; x < w; x += 1) {
        const lng = bounds.getWest() + ((x + 0.5) / w) * (bounds.getEast() - bounds.getWest());
        const { e, n } = toLV95({ lat, lng });
        const cell = grid.cellAtLV95(e, n);
        const color = cell >= 0 && COLORS[mask[cell]];
        if (color) image.data.set(color, (y * w + x) * 4);
      }
    }
    ctx.putImageData(image, 0, 0);
    L.imageOverlay(canvas.toDataURL(), bounds, { className: 'pixelated' }).addTo(group);
  }

  return { compute, clear };
}

function describe(grid, a, b, result, ms) {
  const hA = Math.round(grid.heights[a]);
  const hB = Math.round(grid.heights[b]);
  switch (result.reason) {
    case 'no-data':
      return 'Route: keine Höhendaten bei A oder B';
    case 'goal-higher':
      return `Route: B (${hB} m) liegt nicht tiefer als A (${hA} m)`;
    case 'blocked':
      return `Route: kein streng abfallender Weg von A (${hA} m) nach B (${hB} m). Orange = von A aus abwärts erreichbar.`;
    default: {
      const km = (result.length / 1000).toFixed(2);
      const ha = (result.corridorCells * grid.cellSize ** 2 / 10000).toFixed(1);
      const routes = result.log10Routes < 6
        ? Math.round(10 ** result.log10Routes).toLocaleString('de-CH')
        : `~10^${Math.floor(result.log10Routes)}`;
      return `Route: ${routes} mögliche Wege, Korridor ${ha} ha. Kürzester: ${km} km, ${hA - hB} Hm (${ms} ms)`;
    }
  }
}
