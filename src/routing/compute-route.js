// One full route calculation: corridor, exposure and the safest route. Runs in the
// route worker (see route-worker.js), so it must not touch the page or Leaflet.
import { findDownhillRoutes, CORRIDOR } from './downhill.js';
import { findExposedCells } from './exposure.js';
import { findSafestRoute, angleSearchRounds } from './safest-route.js';
import { findHangs } from './hang.js';

export const EXPOSED = 3; // mask value: corridor cell whose fall line runs into a cliff

// Number of steps computeRoute reports through onStep (if a route is found).
export const routeSteps = (settings) => (settings.wholeSlope || settings.showHangs ? 1 : 0) + 2 + 1 + angleSearchRounds(settings.maxAngle) + 1;

// onStep(label) is called before each step, so the page can show progress.
export function computeRoute(grid, start, end, settings, onStep = () => {}) {
  const t0 = performance.now();
  const a = grid.cellAt(start);
  const b = grid.cellAt(end);
  if (a < 0 || b < 0) return { reason: 'outside', path: [] };

  let hangs = null;
  if (settings.wholeSlope || settings.showHangs) {
    onStep('Hänge abgrenzen');
    hangs = findHangs(grid, settings); // cached for the steps below
  }
  onStep('Korridor');
  const corridor = findDownhillRoutes(grid, a, b, settings);
  let result = { ...corridor, path: [] };
  if (!corridor.reason) {
    onStep('Exponierte Stellen');
    const exposed = markExposure(grid, corridor, settings);
    result = { ...corridor, ...findSafestRoute(grid, a, corridor.zone, settings, exposed, onStep) };
    result.exposedRouteLength = exposedLength(result, exposed);
  }
  delete result.zone;
  if (settings.showHangs) {
    // For the debug view; a copy, as the worker keeps the original cached.
    result.hangLabels = hangs.labels.slice();
    result.hangSteepest = hangs.steepest;
  }
  result.heightA = grid.heights[a];
  result.heightB = grid.heights[b];
  result.ms = Math.round(performance.now() - t0);
  return result;
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
