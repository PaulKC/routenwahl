// Shows the downhill corridor and an example route on the map. The calculation runs in a
// Web Worker; starting a new one while another is running cancels the old one.
import { createGridGeometry } from '../data/height-grid.js';
import { REACHABLE, CORRIDOR } from '../routing/downhill.js';
import { EXPOSED } from '../routing/compute-route.js';
import { toLV95 } from '../data/lv95.js';

const COLORS = {
  [REACHABLE]: [255, 152, 0, 90], // orange: reachable from A, but dead end
  [CORRIDOR]: [46, 125, 50, 150], // green: on some route to B
  [EXPOSED]: [156, 39, 176, 170], // purple: on some route to B, but exposed
};
const MAX_OVERLAY_PX = 2048;

// showStatus(text, busy) shows a status line; busy is true while a calculation runs.
export function createRouteLayer(map, showStatus) {
  const group = L.layerGroup().addTo(map);
  let last = null; // { tiles, start, end, settings } of the current calculation
  let worker = null;
  let workerTiles = null; // tiles the worker already has a height grid for
  let running = null; // id of the calculation in progress, or null
  let nextId = 1;

  function startWorker() {
    worker = new Worker(new URL('../routing/route-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => show(data);
    worker.onerror = (event) => show({ id: running, error: event.message });
    workerTiles = null;
  }

  // Stops a calculation in progress. Terminating is the only way to interrupt the worker.
  function cancel() {
    if (running === null) return;
    worker.terminate();
    worker = null;
    running = null;
  }

  function clear() {
    cancel();
    last = null;
    group.clearLayers();
    showStatus('', false);
  }

  function compute(tiles, start, end, settings) {
    clear();
    last = { tiles, start, end, settings };
    if (!worker) startWorker();
    running = nextId++;
    const plain = (ll) => ({ lat: ll.lat, lng: ll.lng });
    worker.postMessage({
      id: running,
      tiles: workerTiles === tiles ? null : tiles.map(({ origin, width, height, resolution, heights }) => ({ origin, width, height, resolution, heights })),
      start: plain(start),
      end: plain(end),
      settings,
    });
    workerTiles = tiles;
    showStatus('Route wird berechnet…', true);
  }

  // Recomputes the last route with new settings, if there is one.
  function recompute(settings) {
    if (last) compute(last.tiles, last.start, last.end, settings);
  }

  function show({ id, result, geometry, error }) {
    if (id !== running) return; // an older calculation that was replaced
    running = null;
    if (error) {
      showStatus(`Route: Fehler bei der Berechnung (${error})`, false);
      return;
    }
    const grid = createGridGeometry(geometry);
    if (result.mask) drawMask(grid, result.mask);
    L.circle(last.end, { radius: last.settings.goalRadius, color: '#c62828', weight: 2, dashArray: '4 4', fill: false })
      .bindTooltip('Zielbereich um B')
      .addTo(group);
    if (result.path.length) {
      L.polyline(result.path.map(grid.latLngOf), { color: '#0d47a1', weight: 3 })
        .bindTooltip('Sicherste Route')
        .addTo(group);
    }
    showStatus(describe(grid, result), false);
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

function describe(grid, result) {
  const hA = Math.round(result.heightA);
  const hB = Math.round(result.heightB);
  const { ms } = result;
  switch (result.reason) {
    case 'outside':
      return 'Route: A oder B liegt ausserhalb der Höhendaten';
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
