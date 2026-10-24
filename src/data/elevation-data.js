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
  const heights = await readHeights(image);
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

// Reads the first band as a Float32Array. Kartverket leaves out the internal blocks of a
// GeoTIFF that are entirely sea (byte count 0), which geotiff.js can't read, so such files
// are read block by block and the missing blocks become NaN (no data).
async function readHeights(image) {
  const byteCounts = image.fileDirectory.TileByteCounts;
  if (!image.isTiled || byteCounts.every((count) => count > 0)) return (await image.readRasters())[0];

  const width = image.getWidth();
  const height = image.getHeight();
  const blockWidth = image.getTileWidth();
  const blockHeight = image.getTileHeight();
  const blocksAcross = Math.ceil(width / blockWidth);
  const decoder = await GeoTIFF.getDecoder(image.fileDirectory);
  const heights = new Float32Array(width * height).fill(NaN);
  for (let by = 0; by < Math.ceil(height / blockHeight); by += 1) {
    for (let bx = 0; bx < blocksAcross; bx += 1) {
      if (!byteCounts[by * blocksAcross + bx]) continue;
      const block = new Float32Array((await image.getTileOrStrip(bx, by, 0, decoder)).data);
      for (let r = 0; r < blockHeight && by * blockHeight + r < height; r += 1) {
        for (let c = 0; c < blockWidth && bx * blockWidth + c < width; c += 1) {
          heights[(by * blockHeight + r) * width + bx * blockWidth + c] = block[r * blockWidth + c];
        }
      }
    }
  }
  return heights;
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
