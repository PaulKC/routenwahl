// Keeps downloaded elevation GeoTIFFs in the browser's Cache Storage so a reload doesn't
// download them again. Tile URLs contain the survey year, so a new survey gets a new URL.
const CACHE_NAME = 'skitour-elevation-tiles-v1';
const MAX_STORED_TILES = 400; // about 500 MB at ~1.2 MB per tile; the oldest stored go first

const openStore = () => (globalThis.caches ? caches.open(CACHE_NAME) : Promise.resolve(null));

// Returns { buffer, fromStore } for the tile at url, downloading and storing it if needed.
export async function fetchTile(url, signal) {
  const store = await openStore().catch(() => null); // unavailable e.g. outside a secure context
  const stored = await store?.match(url);
  if (stored) return { buffer: await stored.arrayBuffer(), fromStore: true };

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  if (store) {
    await store.put(url, new Response(buffer, { headers: { 'Content-Type': 'image/tiff' } }));
    await trimStore(store);
  }
  return { buffer, fromStore: false };
}

async function trimStore(store) {
  const keys = await store.keys(); // in the order they were stored
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_STORED_TILES))) {
    await store.delete(request);
  }
}

export async function countStoredTiles() {
  const store = await openStore().catch(() => null);
  return store ? (await store.keys()).length : 0;
}

export async function clearStoredTiles() {
  if (globalThis.caches) await caches.delete(CACHE_NAME);
}
