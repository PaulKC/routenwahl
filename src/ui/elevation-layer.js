// Elevation tiles covering the A–B bounding box plus a margin, outlined on the map.
import { MAX_TILES, findElevationTiles, downloadTiles, hasDataAt } from '../data/elevation-data.js';
import { REGIONS, regionsAt } from '../data/regions.js';

const ELEVATION_MARGIN_M = 1500; // routes that avoid steep terrain often detour outside the A–B box

// load() resolves to the downloaded tiles, or null if it was cancelled or something failed.
// showStatus(summary, details) shows a short line and, under "Erweitert", the details.
export function createElevationLayer(map, showStatus) {
  const tileOutlines = L.layerGroup(); // shown only with the debug option, see setShowTiles
  let elevationRequest = null;

  function cancel() {
    elevationRequest?.abort();
    elevationRequest = null;
    tileOutlines.clearLayers();
    showStatus('', '');
  }

  async function load(start, end) {
    cancel();
    const request = new AbortController();
    elevationRequest = request;

    const bounds = L.latLngBounds(start, end);
    const dLat = ELEVATION_MARGIN_M / 111320;
    const dLng = ELEVATION_MARGIN_M / (111320 * Math.cos(bounds.getCenter().lat * Math.PI / 180));
    const bbox = [bounds.getWest() - dLng, bounds.getSouth() - dLat, bounds.getEast() + dLng, bounds.getNorth() + dLat];

    const loading = 'Höhendaten werden geladen…';
    const failedLine = 'Höhendaten konnten nicht geladen werden';
    showStatus(loading, 'Höhendaten: suche Datenquelle…');
    let region;
    try {
      region = await findRegion(start, end, request.signal);
    } catch (err) {
      if (!request.signal.aborted) showStatus(failedLine, `Höhendaten: Fehler (${err.message})`);
      return null;
    }
    if (request.signal.aborted) return null;
    if (!region) {
      const names = REGIONS.map((r) => r.name).join(', ');
      showStatus('Start und Ziel müssen im selben unterstützten Gebiet liegen', `Unterstützte Gebiete: ${names}`);
      return null;
    }

    showStatus(loading, `Höhendaten (${region.name}): suche Kacheln…`);
    let tiles;
    try {
      tiles = await findElevationTiles(region, bbox, request.signal);
    } catch (err) {
      if (!request.signal.aborted) showStatus(failedLine, `Höhendaten: Fehler (${err.message})`);
      return null;
    }
    if (request.signal.aborted) return null;
    if (tiles.length > MAX_TILES) {
      showStatus('Start und Ziel liegen zu weit auseinander', `Höhendaten: ${tiles.length} Kacheln, zu viele (max. ${MAX_TILES}).`);
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
      const coarse = region.coarse ? '. Nur 10 m Auflösung: Neigung und Absturzgelände werden unterschätzt' : '';
      const details = `Höhendaten (${region.name}${coarse}): ${loaded}/${tiles.length} Kacheln (${mb} MB, ${fromStore} aus dem Cache)${range}${errors}`;
      // Short line: progress while loading; once done only what the user must know.
      const summary = loaded + failed < tiles.length ? `${loading} ${Math.round(((loaded + failed) / tiles.length) * 100)} %`
        : failed ? `${failedLine} (${failed} von ${tiles.length} Kacheln)`
          : region.coarse ? 'Nur grobe Höhendaten (10 m): Steilheit wird unterschätzt' : '';
      showStatus(summary, details);
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

  // The first region (in order of preference) that has data at both A and B.
  async function findRegion(start, end, signal) {
    const atEnd = regionsAt(end);
    for (const region of regionsAt(start).filter((r) => atEnd.includes(r))) {
      try {
        if (await hasDataAt(region, start, signal) && await hasDataAt(region, end, signal)) return region;
      } catch (err) {
        if (signal.aborted) throw err;
        console.warn(`${region.name}: ${err.message}`); // service down: try the next region
      }
    }
    return null;
  }

  // Debug option: show the tile outlines on the map.
  function setShowTiles(show) {
    if (show) tileOutlines.addTo(map);
    else tileOutlines.remove();
  }

  return { load, cancel, setShowTiles };
}
