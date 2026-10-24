// Service worker: makes the app installable and lets it start offline.
//   - The app's own files: network first, so changes show on the next reload; the cached copy
//     is used offline.
//   - Libraries from unpkg / jsdelivr: their URLs name a fixed version, so cache first.
//   - Everything else (map and elevation tiles, SLF bulletin, place search) is left to the
//     browser. Elevation tiles have their own cache (src/data/tile-store.js), which this
//     worker never touches.
const CACHE = 'skitour-app-v1';

const APP_FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'src/main.js',
  'src/data/avalanche-bulletin.js', 'src/data/elevation-data.js', 'src/data/height-grid.js',
  'src/data/projection.js', 'src/data/regions.js', 'src/data/tile-store.js',
  'src/routing/compute-route.js', 'src/routing/downhill.js', 'src/routing/energy-model.js',
  'src/routing/exposure.js', 'src/routing/hang.js', 'src/routing/min-heap.js',
  'src/routing/route-worker.js', 'src/routing/safest-route.js',
  'src/ui/danger.js', 'src/ui/elevation-layer.js', 'src/ui/map.js', 'src/ui/panel.js',
  'src/ui/points.js', 'src/ui/route-layer.js', 'src/ui/search.js',
];
const LIBRARIES = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/geotiff@2.1.3/dist-browser/geotiff.js',
  'https://cdn.jsdelivr.net/npm/proj4@2.12.1/+esm',
];
const isLibrary = (url) => /^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.+@\d/.test(url);

self.addEventListener('install', (event) => {
  // One file that fails to load mustn't stop the install; it is cached on first use instead.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => Promise.allSettled([...APP_FILES, ...LIBRARIES].map((url) => cache.add(url))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Drop older versions of this worker's cache, and only those.
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names
      .filter((name) => name.startsWith('skitour-app-') && name !== CACHE)
      .map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (isLibrary(request.url)) event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true })
      ?? (request.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
