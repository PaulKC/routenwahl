// Elevation tiles (1 km x 1 km GeoTIFFs in the region's metric grid) for an area.
import { fetchTile } from './tile-store.js';

export const MAX_TILES = 100;
const PARALLEL_DOWNLOADS = 6;

// Decoded tiles of this page visit, keyed by URL, so moving a point only loads what is new.
const tileCache = new Map();

// Lists the tiles of `region` covering bbox [west, south, east, north] (WGS84).
export async function findElevationTiles(region, bbox, signal) {
  const tiles = await region.findTiles(bbox, signal);
  return tiles.map((tile) => ({ ...tile, crs: region.crs }));
}

async function downloadTile(tile, signal) {
  if (tileCache.has(tile.url)) return { ...tileCache.get(tile.url), fromStore: true };
  let fetched;
  try {
    fetched = await fetchTile(tile.url, signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`${tile.key}: ${err.message}`);
  }
  const { buffer, fromStore } = fetched;
  const image = await (await GeoTIFF.fromArrayBuffer(buffer)).getImage();
  const [heights] = await image.readRasters();
  let min = Infinity;
  let max = -Infinity;
  for (const h of heights) {
    if (!(h > -1000 && h < 10000)) continue; // nodata
    if (h < min) min = h;
    if (h > max) max = h;
  }
  const data = {
    ...tile,
    bytes: buffer.byteLength,
    fromStore,
    width: image.getWidth(),
    height: image.getHeight(),
    origin: image.getOrigin(), // top-left corner in the tile's crs
    resolution: image.getResolution()[0],
    heights,
    min,
    max,
  };
  tileCache.set(tile.url, data);
  return data;
}

// Downloads all tiles with a few requests in flight; onTile(tile, data | null, error) reports each one.
export async function downloadTiles(tiles, signal, onTile) {
  const queue = [...tiles];
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const tile = queue.shift();
      try {
        onTile(tile, await downloadTile(tile, signal), null);
      } catch (err) {
        if (!signal.aborted) onTile(tile, null, err);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));
}
