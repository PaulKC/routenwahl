// Shows the downhill corridor on the map, with the start and goal areas and the status line
// that sums it up. The calculation runs in the route worker (see routing/route-client.js).
import { createGridGeometry } from '../data/height-grid.js';
import { createRouteClient } from '../routing/route-client.js';
import { ROUTE_MAP_COLORS } from '../terrain-classes.js';
import { cellOverlay } from './cell-overlay.js';

// Debug view of the Hänge: each Hang in its own colour, picked from its number.
const hangColor = (label) => {
  const hue = (label * 137.508) % 360; // golden angle: neighbouring numbers get distant hues
  const c = (1 - Math.abs(((hue / 60) % 2) - 1)) * 255;
  const [r, g, b] = [[255, c, 0], [c, 255, 0], [0, 255, c], [0, c, 255], [c, 0, 255], [255, 0, c]][Math.floor(hue / 60)];
  return [r, g, b, 140];
};
const ZONE_COLOR = [27, 94, 140, 70]; // debug view of the core zone, SLF blue

// showStatus(text, progress, details) shows a short status line and, under "Erweitert", the
// details that explain it; progress is { label, done, total } while a
// calculation runs and null otherwise.
export function createRouteLayer(map, showStatus) {
  const group = L.layerGroup().addTo(map);
  let last = null; // { tiles, start, end, settings } of the current calculation
  let hoverOff = null; // removes the debug view's hover tooltip
  let shown = null; // { mask, grid } of the route on the map, for the camera view
  const client = createRouteClient(show);

  // Removes the route; a calculation in progress runs on (keeping the worker's caches), but its
  // result isn't shown.
  function clear() {
    client.cancel();
    last = null;
    shown = null;
    group.clearLayers();
    hoverOff?.();
    hoverOff = null;
    showStatus('', null);
  }

  function compute(tiles, start, end, settings) {
    clear();
    last = { tiles, start, end, settings };
    client.run(tiles, start, end, settings);
    showStatus('Route wird berechnet…', { label: 'Start', done: 0, total: 1 });
  }

  // Recomputes the last route with new settings, if there is one.
  function recompute(settings) {
    if (last) compute(last.tiles, last.start, last.end, settings);
  }

  // A message from the worker about the latest calculation (see route-client.js).
  function show({ progress, result, geometry, error }) {
    if (progress) {
      showStatus(`Route wird berechnet: ${progress.label}`, progress);
      return;
    }
    if (error) {
      showStatus('Route: Fehler bei der Berechnung', null, error);
      return;
    }
    const grid = createGridGeometry(geometry);
    if (result.mask) shown = { mask: result.mask, grid };
    if (result.zoneMask) drawCells(grid, result.zoneMask, () => ZONE_COLOR); // debug view
    if (result.hangLabels) showHangs(grid, result.hangLabels, result.hangSteepest);
    if (result.mask) drawCells(grid, result.mask, (value) => ROUTE_MAP_COLORS[value]);
    L.circle(last.start, { radius: last.settings.goalRadius, color: '#2e7d32', weight: 2, dashArray: '4 4', fill: false })
      .bindTooltip('Startbereich')
      .addTo(group);
    L.circle(last.end, { radius: last.settings.goalRadius, color: '#c62828', weight: 2, dashArray: '4 4', fill: false })
      .bindTooltip('Zielbereich')
      .addTo(group);
    const { summary, details } = describe(grid, result);
    showStatus(summary, null, details);
  }

  // Debug view: colours each Hang and names it and its steepest patch under the cursor.
  function showHangs(grid, labels, steepest) {
    drawCells(grid, labels, hangColor);
    const tooltip = L.tooltip({ direction: 'right', offset: [12, 0] });
    const hover = (e) => {
      const label = labels[grid.cellAt(e.latlng)];
      if (!label) {
        tooltip.remove();
        return;
      }
      tooltip.setLatLng(e.latlng).setContent(`Hang ${label}: steilste Partie ${steepest[label].toFixed(1)}°`);
      if (!map.hasLayer(tooltip)) tooltip.addTo(map);
    };
    map.on('mousemove', hover);
    hoverOff = () => {
      map.off('mousemove', hover);
      tooltip.remove();
    };
  }

  const drawCells = (grid, mask, colorOf) => cellOverlay(grid, mask, colorOf)?.addTo(group);

  // The mask of the route on the map (ROUTE values, see terrain-classes.js) and
  // its grid, or null.
  const current = () => shown;

  return { compute, recompute, clear, current };
}

// { summary, details }: a short line for the panel and the full explanation for "Erweitert".
function describe(grid, result) {
  const hA = Math.round(result.heightA);
  const hB = Math.round(result.heightB);
  const { ms } = result;
  switch (result.reason) {
    case 'outside':
      return { summary: 'Keine Höhendaten für Start oder Ziel', details: 'A oder B liegt ausserhalb der Höhendaten.' };
    case 'no-data':
      return { summary: 'Keine Höhendaten für Start oder Ziel', details: 'Keine Höhendaten bei A oder B.' };
    case 'goal-higher':
      return {
        summary: 'Keine Route: das Ziel liegt nicht tiefer als der Start',
        details: `Der Zielbereich um B (${hB} m) liegt nicht tiefer als A (${hA} m).`,
      };
    case 'goal-steep':
      return {
        summary: 'Keine Route: das Ziel ist zu steil',
        details: `Der ganze Zielbereich um B ist steiler als die erlaubte Neigung (B: ${Math.round(result.goalSlope)}°).`,
      };
    case 'goal-no-go':
      return {
        summary: 'Keine Route: das Ziel liegt in einer Wildruhezone',
        details: 'Der ganze Zielbereich um B liegt in einer Wildruhezone, die nicht betreten werden darf.',
      };
    case 'blocked':
      if (result.startInNoGo) {
        return {
          summary: 'Keine Route: der Start liegt in einer Wildruhezone',
          details: 'A liegt in einer Wildruhezone, die nicht betreten werden darf, und der Startbereich kommt nicht aus ihr heraus.',
        };
      }
      return {
        summary: 'Keine fahrbare Route',
        details: `Kein fahrbarer Weg von A (${hA} m) in den Zielbereich um B (${hB} m). Orange = von A aus erreichbar.`
          + (result.hangTooSteepCells ? ' Rot = für sich fahrbar, aber der Hang ist zu steil.' : ''),
      };
    default: {
      const ha = (result.corridorCells * grid.cellSize ** 2 / 10000).toFixed(1);
      const exposedHa = (result.exposedCells * grid.cellSize ** 2 / 10000).toFixed(1);
      return {
        summary: `Fahrbar: ${Math.round(hA - hB)} Hm${result.exposedCells ? ', teils exponiert' : ''}`,
        details: `Korridor ${ha} ha, davon ${exposedHa} ha exponiert, von A (${hA} m) nach B (${hB} m) (${ms} ms)`,
      };
    }
  }
}
