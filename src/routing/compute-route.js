// One full route calculation: the corridor and its exposed cells. Runs in the
// route worker (see route-worker.js), so it must not touch the page or Leaflet.
import { ROUTE } from '../terrain-classes.js';
import { findDownhillRoutes, cellsWithin } from './downhill.js';
import { findExposedCells } from './exposure.js';
import { findHangs, hangsKnown } from './hang.js';
import { coreZoneMask } from './core-zone.js';
import { noGoMask } from './no-go.js';
import { wholeSlopeAnywhere } from './energy-model.js';

// Number of steps computeRoute reports through onStep (if a route is found).
export const routeSteps = (grid, settings) => ((wholeSlopeAnywhere(settings) || settings.showHangs) && !hangsKnown(grid, settings) ? 1 : 0) + 2;

// onStep(label) is called before each step, so the page can show progress.
export function computeRoute(grid, start, end, settings, onStep = () => {}) {
  const t0 = performance.now();
  const a = grid.cellAt(start);
  const b = grid.cellAt(end);
  if (a < 0 || b < 0) return { reason: 'outside' };

  let hangs = null;
  if (wholeSlopeAnywhere(settings) || settings.showHangs) {
    if (!hangsKnown(grid, settings)) onStep('Hänge abgrenzen'); // else cached from the last route
    hangs = findHangs(grid, settings); // cached for the steps below
  }
  // The skier may set off anywhere within goalRadius of A, as they may arrive anywhere near B.
  const starts = [a, ...cellsWithin(grid, a, settings.goalRadius).filter((cell) => cell !== a)];
  onStep('Korridor');
  const corridor = findDownhillRoutes(grid, starts, b, settings);
  if (!corridor.reason) {
    onStep('Exponierte Stellen');
    markExposure(grid, corridor, settings);
  }
  const result = { ...corridor };
  delete result.zone;
  result.startInNoGo = Boolean(settings.noGo?.length) && noGoMask(grid, settings.noGo)[a] === 1;
  if (settings.showHangs) {
    // For the debug view; a copy, as the worker keeps the original cached.
    result.hangLabels = hangs.labels.slice();
    result.hangSteepest = hangs.steepest;
  }
  if (settings.showZone && settings.zone) result.zoneMask = coreZoneMask(grid, settings.zone).slice(); // debug view
  result.heightA = grid.heights[a];
  result.heightB = grid.heights[b];
  result.ms = Math.round(performance.now() - t0);
  return result;
}

// Marks exposed corridor cells in the mask and counts them.
function markExposure(grid, corridor, settings) {
  const { mask } = corridor;
  const exposed = findExposedCells(grid, (cell) => mask[cell] === ROUTE.CORRIDOR, settings);
  corridor.exposedCells = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (exposed[i]) {
      mask[i] = ROUTE.EXPOSED;
      corridor.exposedCells += 1;
    }
  }
}
