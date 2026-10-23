// swissALTI3D elevation tiles (1 km x 1 km GeoTIFFs, LV95) from the swisstopo STAC API.
const STAC_ITEMS = 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items';
const RESOLUTION = '2'; // metres per pixel; '0.5' is also available but ~16x larger
const MAX_TILES = 100;
const PARALLEL_DOWNLOADS = 6;

// Downloaded tiles, keyed by asset URL, so moving a point only fetches what is new.
const tileCache = new Map();

// Lists the newest tile for every 1 km square that intersects bbox [west, south, east, north].
async function findElevationTiles(bbox, signal) {
  const newest = new Map();
  let url = `${STAC_ITEMS}?bbox=${bbox.join(',')}&limit=100`;
  while (url) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`STAC ${res.status}`);
    const page = await res.json();
    for (const item of page.features) {
      // Item ids look like swissalti3d_2022_2673-1194: year, then the tile's km coordinates.
      const [, year, square] = item.id.split('_');
      const asset = Object.values(item.assets).find(
        (a) => a.href.endsWith('.tif') && a.href.includes(`_${RESOLUTION}_2056_`),
      );
      if (!asset) continue;
      const previous = newest.get(square);
      if (!previous || previous.year < year) {
        newest.set(square, { square, year, bbox: item.bbox, url: asset.href });
      }
    }
    url = page.links.find((l) => l.rel === 'next')?.href;
  }
  return [...newest.values()];
}

async function downloadTile(tile, signal) {
  if (tileCache.has(tile.url)) return tileCache.get(tile.url);
  const res = await fetch(tile.url, { signal });
  if (!res.ok) throw new Error(`${tile.square}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const image = await (await GeoTIFF.fromArrayBuffer(buffer)).getImage();
  const [heights] = await image.readRasters();
  let min = Infinity;
  let max = -Infinity;
  for (const h of heights) {
    if (h < -1000) continue; // nodata
    if (h < min) min = h;
    if (h > max) max = h;
  }
  const data = {
    ...tile,
    bytes: buffer.byteLength,
    width: image.getWidth(),
    height: image.getHeight(),
    origin: image.getOrigin(), // LV95 (EPSG:2056) top-left corner
    heights,
    min,
    max,
  };
  tileCache.set(tile.url, data);
  return data;
}

// Downloads all tiles with a few requests in flight; onTile(tile, data | null, error) reports each one.
async function downloadTiles(tiles, signal, onTile) {
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
