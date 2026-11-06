// The classified square around the skier for the camera view. The terrain is classified once
// for a large square (in a worker, see classify-worker.js, so the view keeps moving meanwhile)
// and kept: moving only cuts the drawn part out of it again (terrain-mesh.js), which is quick.
// Only near the square's edge is a new one classified.
import { decodedTiles, storedSwissTilesAround } from '../data/elevation-data.js';
import { buildHeightGrid } from '../data/height-grid.js';
import { tileAt, cropTile } from './local-terrain.js';
import { MESH_RADIUS } from './terrain-mesh.js';

const AREA_RADIUS = 1000; // metres classified around the skier
const CONTEXT = 150; // metres beyond the drawn part that must be classified too (Hänge, cliffs)
const STORED_RADIUS = 1500; // metres around the skier taken from the tile store

// classifyAround(at) resolves to the classified square around `at`
// ({ crs, grid, classes, x, y, tiles }), or null if the browser has no tiles there.
export function createAreaClassifier(settings) {
  let worker = null;
  let nextJob = 1;
  const jobs = new Map(); // id -> { resolve, reject }

  // Classifies `tile` in the worker; resolves to the classes per cell.
  const classify = (tile) => new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(new URL('./classify-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = jobs.get(data.id);
        jobs.delete(data.id);
        if (data.error) job?.reject(new Error(data.error));
        else job?.resolve(data.classes);
      };
      worker.onerror = (event) => {
        for (const job of jobs.values()) job.reject(new Error(event.message || 'Worker'));
        jobs.clear();
      };
    }
    const id = nextJob++;
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, tile: { ...tile, heights: tile.heights.slice() }, settings });
  });

  async function classifyAround(at) {
    const stored = await storedSwissTilesAround(at, STORED_RADIUS).catch(() => []);
    const urls = new Set();
    const tiles = [...decodedTiles(), ...stored].filter((t) => !urls.has(t.url) && urls.add(t.url));
    const hit = tileAt(tiles, at);
    if (!hit) return null;
    const tile = cropTile(tiles, hit.tile, hit.x, hit.y, AREA_RADIUS);
    const classes = await classify(tile);
    return { crs: tile.crs, grid: buildHeightGrid([tile]), classes, x: hit.x, y: hit.y, tiles };
  }

  return {
    classifyAround,
    terminate: () => worker?.terminate(),
  };
}

// Whether the drawn part around projected (x, y) and its context lie inside `area` (or null).
export const areaCovers = (area, x, y) => area
  && Math.max(Math.abs(x - area.x), Math.abs(y - area.y)) <= AREA_RADIUS - MESH_RADIUS - CONTEXT
  && Number.isFinite(area.grid.heights[area.grid.cellAtProjected(x, y)]);
