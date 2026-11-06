// Runs route calculations in the route worker (route-worker.js) from the page, one at a time.
//
// The worker keeps the height grid of the tiles it was sent last, and with it everything that
// doesn't depend on A and B (slopes, Hänge, ...), which is most of the work. So it is only sent
// tiles when they change, and isn't interrupted while it has the right ones: a newer
// calculation waits for the current one, whose result is then dropped. Only with other tiles
// is the worker stopped and a new one started.

// onMessage(data) gets the worker's messages for the latest calculation only: its progress
// ({ progress }) and then its end ({ result, geometry } or { error }).
export function createRouteClient(onMessage) {
  let worker = null;
  let workerTiles = null; // key of the tiles the worker has a height grid for
  let busy = null; // id of the calculation the worker is running, or null
  let wanted = null; // id of the calculation whose result is to be passed on, or null
  let waiting = null; // { id, message, key, tiles } to send when the worker is done
  let nextId = 1;

  function startWorker() {
    worker = new Worker(new URL('./route-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => receive(data);
    worker.onerror = (event) => receive({ id: busy, error: event.message });
    workerTiles = null;
    busy = null;
  }

  const tilesKey = (tiles) => tiles.map((tile) => tile.url ?? `${tile.origin}`).sort().join('|');

  // Sends a calculation, with the tiles only if the worker doesn't have them yet.
  function send({ id, message, key, tiles }) {
    const plainTiles = key === workerTiles ? null
      : tiles.map(({ crs, origin, width, height, resolution, heights }) => ({ crs, origin, width, height, resolution, heights }));
    worker.postMessage({ id, tiles: plainTiles, ...message });
    busy = id;
    workerTiles = key;
  }

  function receive(data) {
    const { id, progress, error } = data;
    if (progress) {
      if (id === wanted) onMessage(data);
      return;
    }
    if (id === busy) {
      busy = null;
      if (error) workerTiles = null; // its grid may be broken: send the tiles again
      if (waiting) {
        send(waiting);
        waiting = null;
      }
    }
    if (id !== wanted) return; // an older calculation that was replaced
    wanted = null;
    onMessage(data);
  }

  // Starts a calculation from start to end (Leaflet LatLngs) on the tiles; it replaces any
  // earlier one.
  function run(tiles, start, end, settings) {
    const key = tilesKey(tiles);
    // Other tiles: the worker's caches are of no use, so stop it rather than wait for it.
    if (worker && busy !== null && key !== workerTiles) {
      worker.terminate();
      worker = null;
    }
    if (!worker) startWorker();
    const id = nextId++;
    wanted = id;
    const plain = (ll) => ({ lat: ll.lat, lng: ll.lng });
    const message = {
      start: plain(start),
      end: plain(end),
      settings,
    };
    if (busy === null) send({ id, message, key, tiles });
    else waiting = { id, message, key, tiles };
  }

  // Drops the latest calculation: one in progress runs on (keeping the worker's caches), but
  // its result isn't passed on.
  function cancel() {
    wanted = null;
    waiting = null;
  }

  return { run, cancel };
}
