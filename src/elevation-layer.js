// Elevation tiles covering the A–B bounding box plus a margin, outlined on the map.
import { MAX_TILES, findElevationTiles, downloadTiles } from './elevation-data.js';

const ELEVATION_MARGIN_M = 500;

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

    showStatus('Höhendaten: suche Kacheln…');
    let tiles;
    try {
      tiles = await findElevationTiles(bbox, request.signal);
    } catch (err) {
      if (!request.signal.aborted) showStatus(`Höhendaten: Fehler (${err.message})`);
      return;
    }
    if (request.signal.aborted) return;
    if (tiles.length > MAX_TILES) {
      showStatus(`Höhendaten: ${tiles.length} Kacheln, zu viele (max. ${MAX_TILES}). Punkte näher setzen.`);
      return;
    }

    const outlines = new Map();
    for (const tile of tiles) {
      const [w, s, e, n] = tile.bbox;
      outlines.set(tile.url, L.rectangle([[s, w], [n, e]], { color: '#777', weight: 1, fillOpacity: 0.05 })
        .bindTooltip(`swissALTI3D ${tile.square} (${tile.year})`)
        .addTo(tileOutlines));
    }

    let loaded = 0;
    let failed = 0;
    let bytes = 0;
    let min = Infinity;
    let max = -Infinity;
    const showProgress = () => {
      const mb = (bytes / 1e6).toFixed(1);
      const range = loaded ? `, ${Math.round(min)}–${Math.round(max)} m ü. M.` : '';
      const errors = failed ? `, ${failed} Fehler` : '';
      showStatus(`Höhendaten: ${loaded}/${tiles.length} Kacheln (${mb} MB)${range}${errors}`);
    };
    showProgress();

    await downloadTiles(tiles, request.signal, (tile, data, err) => {
      if (request.signal.aborted) return;
      if (data) {
        loaded += 1;
        bytes += data.bytes;
        min = Math.min(min, data.min);
        max = Math.max(max, data.max);
        outlines.get(tile.url).setStyle({ color: '#1565c0', fillOpacity: 0.1 });
      } else {
        failed += 1;
        outlines.get(tile.url).setStyle({ color: '#c62828', fillOpacity: 0.2 });
        console.error(err);
      }
      showProgress();
    });
  }

  return { load, cancel };
}
