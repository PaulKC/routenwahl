// Shows the downhill corridor and an example route on the map.
import { buildHeightGrid } from '../data/height-grid.js';
import { findDownhillRoutes, REACHABLE, CORRIDOR } from '../routing/downhill.js';
import { findExposedCells } from '../routing/exposure.js';
import { findSafestRoute } from '../routing/safest-route.js';
import { toLV95 } from '../data/lv95.js';

const EXPOSED = 3; // corridor cell whose fall line runs into a cliff
const COLORS = {
  [REACHABLE]: [255, 152, 0, 90], // orange: reachable from A, but dead end
  [CORRIDOR]: [46, 125, 50, 150], // green: on some route to B
  [EXPOSED]: [156, 39, 176, 170], // purple: on some route to B, but exposed
};
const MAX_OVERLAY_PX = 2048;

export function createRouteLayer(map, showStatus) {
  const group = L.layerGroup().addTo(map);
  let last = null; // { tiles, grid, start, end } so settings changes can recompute

  function clear() {
    last = null;
    group.clearLayers();
    showStatus('');
  }

  function compute(tiles, start, end, settings) {
    const grid = last?.tiles === tiles ? last.grid : buildHeightGrid(tiles);
    clear();
    last = { tiles, grid, start, end };
    const t0 = performance.now();
    const a = grid.cellAt(start);
    const b = grid.cellAt(end);
    if (a < 0 || b < 0) {
      showStatus('Route: A oder B liegt ausserhalb der Höhendaten');
      return null;
    }
    const corridor = findDownhillRoutes(grid, a, b, settings);
    let result = { ...corridor, path: [] };
    if (!corridor.reason) {
      const exposed = markExposure(grid, corridor, settings);
      result = { ...corridor, ...findSafestRoute(grid, a, corridor.zone, settings, exposed) };
      result.exposedRouteLength = exposedLength(result, exposed);
    }
    const ms = Math.round(performance.now() - t0);

    drawMask(grid, result.mask);
    L.circle(end, { radius: settings.goalRadius, color: '#c62828', weight: 2, dashArray: '4 4', fill: false })
      .bindTooltip('Zielbereich um B')
      .addTo(group);
    if (result.path.length) {
      L.polyline(result.path.map(grid.latLngOf), { color: '#0d47a1', weight: 3 })
        .bindTooltip('Sicherste Route')
        .addTo(group);
    }
    showStatus(describe(grid, a, b, result, ms));
    return result;
  }

  // Recomputes the last route with new settings, if there is one.
  function recompute(settings) {
    if (last) compute(last.tiles, last.start, last.end, settings);
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

  return { compute, recompute, clear };
}

// Marks exposed corridor cells in the mask, counts them and returns the exposure mask.
function markExposure(grid, corridor, settings) {
  const { mask } = corridor;
  const exposed = findExposedCells(grid, (cell) => mask[cell] === CORRIDOR, settings);
  corridor.exposedCells = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (exposed[i]) {
      mask[i] = EXPOSED;
      corridor.exposedCells += 1;
    }
  }
  return exposed;
}

// Approximate exposed length of the route (its share of exposed steps × total length).
function exposedLength({ path, length }, exposed) {
  const exposedSteps = path.slice(1).filter((cell) => exposed[cell]).length;
  return (length * exposedSteps) / Math.max(1, path.length - 1);
}

function describe(grid, a, b, result, ms) {
  const hA = Math.round(grid.heights[a]);
  const hB = Math.round(grid.heights[b]);
  switch (result.reason) {
    case 'no-data':
      return 'Route: keine Höhendaten bei A oder B';
    case 'goal-higher':
      return `Route: der Zielbereich um B (${hB} m) liegt nicht tiefer als A (${hA} m)`;
    case 'goal-steep':
      return `Route: der ganze Zielbereich um B ist steiler als die erlaubte Neigung (B: ${Math.round(result.goalSlope)}°)`;
    case 'blocked':
      return `Route: kein fahrbarer Weg von A (${hA} m) in den Zielbereich um B (${hB} m). Orange = von A aus erreichbar.`;
    default: {
      const km = (result.length / 1000).toFixed(2);
      const ha = (result.corridorCells * grid.cellSize ** 2 / 10000).toFixed(1);
      const speed = Math.round(result.arrivalSpeedKmh);
      const steepest = Math.round(result.maxSlope);
      const exposedHa = (result.exposedCells * grid.cellSize ** 2 / 10000).toFixed(1);
      const exposure = result.avoidsExposure
        ? 'meidet exponierte Stellen'
        : `nicht vermeidbar: ${Math.round(result.exposedRouteLength)} m exponiert`;
      return `Route: Korridor ${ha} ha, davon ${exposedHa} ha exponiert. Sicherste Route (${exposure}): steilste Stelle ${steepest}°, `
        + `${km} km, ${Math.round(result.descent)} Hm, Ankunft mit ${speed} km/h (${ms} ms)`;
    }
  }
}
