// Elevation tiles (square GeoTIFFs in the region's metric grid) for an area.
import { fetchTile, fetchStoredTile, storedTileUrls } from './tile-store.js';
import { toProjected } from './projection.js';

export const MAX_TILES = 100;
const PARALLEL_DOWNLOADS = 6;

// Decoded tiles of this page visit, keyed by URL, so moving a point only loads what is new.
const tileCache = new Map();

// Lists the tiles of `region` covering bbox [west, south, east, north] (WGS84).
export async function findElevationTiles(region, bbox, signal) {
  const tiles = await region.findTiles(bbox, signal);
  return tiles.map((tile) => ({ ...tile, crs: region.crs }));
}

// Whether `region` has an elevation value at `latlng`. Regions are boxes that overlap at
// borders; their services return no data outside their own country, so this tells them apart.
// The tile it loads is the one the route will need anyway.
export async function hasDataAt(region, latlng, signal) {
  const d = 0.0002; // ~20 m box around the point
  const tiles = await findElevationTiles(region, [latlng.lng - d, latlng.lat - d, latlng.lng + d, latlng.lat + d], signal);
  const { x, y } = toProjected(region.crs, latlng);
  for (const tile of tiles) {
    const data = await downloadTile(tile, signal);
    const col = Math.floor((x - data.origin[0]) / data.resolution);
    const row = Math.floor((data.origin[1] - y) / data.resolution);
    if (col < 0 || col >= data.width || row < 0 || row >= data.height) continue;
    const h = data.heights[row * data.width + col];
    if (h > -1000 && h < 10000) return true;
  }
  return false;
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
  return decodeTile(tile, fetched);
}

// The tiles decoded during this page visit, whatever region they are from.
export const decodedTiles = () => [...tileCache.values()];

// Swiss tiles within `radius` metres of `latlng` that earlier visits left in the tile store,
// decoded without downloading anything (the camera view must work offline). Tiles of other
// regions are only found among decodedTiles(), as their URLs don't name the square they cover.
export async function storedSwissTilesAround(latlng, radius) {
  const { x, y } = toProjected('EPSG:2056', latlng);
  const newest = new Map(); // square -> { year, url }
  for (const url of await storedTileUrls()) {
    // e.g. .../swissalti3d_2022_2673-1194_2_2056_5728.tif: survey year, then the km square's
    // south-west corner.
    const match = url.match(/swissalti3d_(\d{4})_(\d{4})-(\d{4})_/);
    if (!match) continue;
    const [, year, east, north] = match;
    const [x0, y0] = [Number(east) * 1000, Number(north) * 1000];
    if (x0 > x + radius || x0 + 1000 < x - radius || y0 > y + radius || y0 + 1000 < y - radius) continue;
    const square = `${east}-${north}`;
    if (!newest.has(square) || newest.get(square).year < year) newest.set(square, { year, url });
  }
  const tiles = [];
  for (const [key, { year, url }] of newest) {
    if (tileCache.has(url)) {
      tiles.push(tileCache.get(url));
      continue;
    }
    const fetched = await fetchStoredTile(url);
    if (fetched) tiles.push(await decodeTile({ key, year, url, crs: 'EPSG:2056' }, fetched));
  }
  return tiles;
}

async function decodeTile(tile, { buffer, fromStore }) {
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
    resolution: Math.abs(image.getResolution()[0]),
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
