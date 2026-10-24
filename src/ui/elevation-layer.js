// Elevation tiles covering the A–B bounding box plus a margin, outlined on the map.
import { MAX_TILES, findElevationTiles, downloadTiles } from '../data/elevation-data.js';
import { REGIONS, regionAt } from '../data/regions.js';

const ELEVATION_MARGIN_M = 1500; // routes that avoid steep terrain often detour outside the A–B box

// load() resolves to the downloaded tiles, or null if it was cancelled or something failed.
export function createElevationLayer(map, showStatus) {
  const tileOutlines = L.layerGroup().addTo(map);
  let elevationRequest = null;

  function cancel() {
    elevationRequest?.abort();
    elevationRequest = null;
    tileOutlines.clearLayers();
    showStatus('');
  }

  async function load(start, end) {
    cancel();
    const request = new AbortController();
    elevationRequest = request;

    const bounds = L.latLngBounds(start, end);
    const dLat = ELEVATION_MARGIN_M / 111320;
    const dLng = ELEVATION_MARGIN_M / (111320 * Math.cos(bounds.getCenter().lat * Math.PI / 180));
    const bbox = [bounds.getWest() - dLng, bounds.getSouth() - dLat, bounds.getEast() + dLng, bounds.getNorth() + dLat];

    const region = regionAt(start);
    if (!region || regionAt(end) !== region) {
      const names = REGIONS.map((r) => r.name).join(', ');
      showStatus(`Höhendaten: A und B müssen im selben unterstützten Gebiet liegen (${names})`);
      return null;
    }

    showStatus(`Höhendaten (${region.name}): suche Kacheln…`);
    let tiles;
    try {
      tiles = await findElevationTiles(region, bbox, request.signal);
    } catch (err) {
      if (!request.signal.aborted) showStatus(`Höhendaten: Fehler (${err.message})`);
      return null;
    }
    if (request.signal.aborted) return null;
    if (tiles.length > MAX_TILES) {
      showStatus(`Höhendaten: ${tiles.length} Kacheln, zu viele (max. ${MAX_TILES}). Punkte näher setzen.`);
      return null;
    }

    const outlines = new Map();
    for (const tile of tiles) {
      outlines.set(tile.url, L.polygon(tile.outline, { color: '#777', weight: 1, fillOpacity: 0.05, interactive: false })
        .addTo(tileOutlines));
    }

    const loadedTiles = [];
    let loaded = 0;
    let failed = 0;
    let fromStore = 0;
    let bytes = 0;
    let min = Infinity;
    let max = -Infinity;
    const showProgress = () => {
      const mb = (bytes / 1e6).toFixed(1);
      const range = min <= max ? `, ${Math.round(min)}–${Math.round(max)} m ü. M.` : '';
      const errors = failed ? `, ${failed} Fehler` : '';
      showStatus(`Höhendaten: ${loaded}/${tiles.length} Kacheln (${mb} MB, ${fromStore} aus dem Cache)${range}${errors}`);
    };
    showProgress();

    await downloadTiles(tiles, request.signal, (tile, data, err) => {
      if (request.signal.aborted) return;
      if (data) {
        loaded += 1;
        loadedTiles.push(data);
        if (data.fromStore) fromStore += 1;
        bytes += data.bytes;
        if (data.min <= data.max) { // false for a tile that is all sea / no data
          min = Math.min(min, data.min);
          max = Math.max(max, data.max);
        }
        outlines.get(tile.url).setStyle({ color: '#1565c0', fillOpacity: 0.1 });
      } else {
        failed += 1;
        outlines.get(tile.url).setStyle({ color: '#c62828', fillOpacity: 0.2 });
        console.error(err);
      }
      showProgress();
    });
    return request.signal.aborted || failed ? null : loadedTiles;
  }

  return { load, cancel };
}
