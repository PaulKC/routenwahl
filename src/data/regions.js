// Regions with high-resolution elevation data. Each region knows its metric grid (crs), the
// base map that suits it, and how to list 1 km x 1 km GeoTIFF tiles for an area.
//
// findTiles(bbox, signal) takes [west, south, east, north] in WGS84 and resolves to
// [{ key, url, outline }], where outline is the tile's corners as WGS84 lat/lngs.
import { toProjected, fromProjected } from './projection.js';

const RESOLUTION = 2; // metres per pixel

const switzerland = {
  id: 'ch',
  name: 'Schweiz',
  crs: 'EPSG:2056',
  bounds: [5.9, 45.8, 10.5, 47.9],
  baseLayer: 'Winterlandeskarte',

  // swissALTI3D from the swisstopo STAC API; the newest survey of each 1 km square.
  async findTiles(bbox, signal) {
    const items = 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items';
    const newest = new Map();
    let url = `${items}?bbox=${bbox.join(',')}&limit=100`;
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
          const [w, s, e, n] = item.bbox;
          newest.set(square, {
            key: square, year, url: asset.href, outline: [{ lat: s, lng: w }, { lat: s, lng: e }, { lat: n, lng: e }, { lat: n, lng: w }],
          });
        }
      }
      url = page.links.find((l) => l.rel === 'next')?.href;
    }
    return [...newest.values()];
  },
};

const norway = {
  id: 'no',
  name: 'Norwegen',
  crs: 'EPSG:25833',
  bounds: [4.0, 57.9, 31.5, 71.5],
  baseLayer: 'Norwegen Topo',

  // Kartverket's national terrain model (DTM) through its WCS, which cuts out any area at any
  // resolution. We ask for 1 km squares of the UTM 33N grid so tiles can be cached.
  async findTiles(bbox) {
    const [west, south, east, north] = bbox;
    const corners = [[south, west], [south, east], [north, east], [north, west]]
      .map(([lat, lng]) => toProjected(this.crs, { lat, lng }));
    const km = (v) => Math.floor(v / 1000);
    const tiles = [];
    for (let e = km(Math.min(...corners.map((c) => c.x))); e <= km(Math.max(...corners.map((c) => c.x))); e += 1) {
      for (let n = km(Math.min(...corners.map((c) => c.y))); n <= km(Math.max(...corners.map((c) => c.y))); n += 1) {
        const [x0, y0, x1, y1] = [e * 1000, n * 1000, (e + 1) * 1000, (n + 1) * 1000];
        const size = 1000 / RESOLUTION;
        tiles.push({
          key: `${e}-${n}`,
          url: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage'
            + `&coverage=NHM_DTM_25833&format=GeoTIFF&crs=EPSG:25833&bbox=${x0},${y0},${x1},${y1}&width=${size}&height=${size}`,
          outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => fromProjected(this.crs, x, y)),
        });
      }
    }
    return tiles;
  },
};

export const REGIONS = [switzerland, norway];

export function regionAt({ lat, lng }) {
  return REGIONS.find(({ bounds: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n) ?? null;
}
