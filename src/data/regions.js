// Regions with elevation data. Each region knows its metric grid (crs), the
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

// Square tiles of `size` metres in the region's crs covering bbox; url(x0, y0, x1, y1) gives
// the request for one tile. Used for services that cut out any area (WCS / WMS).
function gridTiles(region, bbox, size, url) {
  const [west, south, east, north] = bbox;
  const corners = [[south, west], [south, east], [north, east], [north, west]]
    .map(([lat, lng]) => toProjected(region.crs, { lat, lng }));
  const index = (v) => Math.floor(v / size);
  const tiles = [];
  for (let i = index(Math.min(...corners.map((c) => c.x))); i <= index(Math.max(...corners.map((c) => c.x))); i += 1) {
    for (let j = index(Math.min(...corners.map((c) => c.y))); j <= index(Math.max(...corners.map((c) => c.y))); j += 1) {
      const [x0, y0, x1, y1] = [i * size, j * size, (i + 1) * size, (j + 1) * size];
      tiles.push({
        key: `${region.id}:${i}-${j}`,
        url: url(x0, y0, x1, y1),
        outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => fromProjected(region.crs, x, y)),
      });
    }
  }
  return tiles;
}

const PX = 1000 / RESOLUTION; // pixels per 1 km tile

const norway = {
  id: 'no',
  name: 'Norwegen',
  crs: 'EPSG:25833',
  bounds: [4.0, 57.9, 31.5, 71.5],
  baseLayer: 'Norwegen Topo',

  // Kartverket's national terrain model (DTM) through its WCS.
  async findTiles(bbox) {
    return gridTiles(this, bbox, 1000, (x0, y0, x1, y1) => 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833'
      + '?service=WCS&version=1.0.0&request=GetCoverage&coverage=NHM_DTM_25833&format=GeoTIFF&crs=EPSG:25833'
      + `&bbox=${x0},${y0},${x1},${y1}&width=${PX}&height=${PX}`);
  },
};

const france = {
  id: 'fr',
  name: 'Frankreich',
  crs: 'EPSG:2154',
  // Mainland west of the Alpine border, the southern French Alps, and Corsica.
  bounds: [[-5.2, 42.3, 7.05, 51.1], [5.5, 43.6, 7.7, 45.15], [8.5, 41.3, 9.6, 43.1]],
  baseLayer: 'Frankreich Plan IGN',

  // IGN RGE ALTI (1 m, from lidar in the mountains) through the Géoplateforme raw-data WMS.
  async findTiles(bbox) {
    return gridTiles(this, bbox, 1000, (x0, y0, x1, y1) => 'https://data.geopf.fr/wms-r'
      + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES='
      + `&CRS=EPSG:2154&BBOX=${x0},${y0},${x1},${y1}&WIDTH=${PX}&HEIGHT=${PX}&FORMAT=image/geotiff`);
  },
};

// Land Tirol's laser-scan terrain model (50 cm) through its WCS. North Tirol and East Tirol
// come in different Gauss-Krüger zones, so they are two regions.
const tirolWcs = (coverage, crs) => (x0, y0, x1, y1) => 'https://gis.tirol.gv.at/arcgis/services/Service_Public/terrain/MapServer/WCSServer'
  + `?service=WCS&version=1.0.0&request=GetCoverage&coverage=${coverage}&crs=${crs}`
  + `&bbox=${x0},${y0},${x1},${y1}&width=${PX}&height=${PX}&format=GeoTIFF`;

const northTirol = {
  id: 'at-tirol',
  name: 'Tirol',
  crs: 'EPSG:31254',
  bounds: [10.08, 46.75, 11.80, 47.62],
  baseLayer: 'OpenTopoMap',
  async findTiles(bbox) {
    return gridTiles(this, bbox, 1000, tirolWcs('Gelaendemodell_50cm_M28', this.crs));
  },
};

const eastTirol = {
  id: 'at-osttirol',
  name: 'Osttirol',
  crs: 'EPSG:31255',
  bounds: [11.73, 46.63, 12.98, 47.76],
  baseLayer: 'OpenTopoMap',
  async findTiles(bbox) {
    return gridTiles(this, bbox, 1000, tirolWcs('Gelaendemodell_50cm_M31', this.crs));
  },
};

// TINITALY 1.1 from INGV: all of Italy, but only 10 m, so slopes come out flatter and small
// cliffs disappear. Used where no finer data is available.
const italy = {
  id: 'it',
  name: 'Italien',
  crs: 'EPSG:32632',
  bounds: [6.6, 35.4, 18.6, 47.1],
  baseLayer: 'OpenTopoMap',
  coarse: true,
  async findTiles(bbox) {
    return gridTiles(this, bbox, 2000, (x0, y0, x1, y1) => 'https://tinitaly.pi.ingv.it/TINItaly_1_1/wcs'
      + '?service=WCS&version=2.0.1&request=GetCoverage&coverageId=TINItaly_1_1__tinitaly_dem&format=image/tiff'
      + `&subset=E(${x0},${x1})&subset=N(${y0},${y1})`);
  },
};

// In order of preference where regions overlap (finer data first). Which one is used for a
// route is decided by where data actually exists (see elevation-layer.js).
export const REGIONS = [switzerland, northTirol, eastTirol, france, norway, italy];

// bounds is one box [west, south, east, north] or a list of them.
export function regionsAt({ lat, lng }) {
  const inBox = ([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n;
  return REGIONS.filter(({ bounds }) => (Array.isArray(bounds[0]) ? bounds.some(inBox) : inBox(bounds)));
}

// The preferred region for a point, by bounds only (good enough for picking a base map).
export function regionAt(latlng) {
  return regionsAt(latlng)[0] ?? null;
}
