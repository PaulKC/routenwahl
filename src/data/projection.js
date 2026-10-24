// Converts between WGS84 lat/lng and the metric grids the elevation data comes in.
// Works in the page and in the route worker (no Leaflet).
import proj4 from 'https://cdn.jsdelivr.net/npm/proj4@2.12.1/+esm';

proj4.defs('EPSG:2056', '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 '
  + '+x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs'); // Swiss LV95
proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'); // UTM 33N (Norway)

const converters = new Map();
const converter = (crs) => {
  if (!converters.has(crs)) converters.set(crs, proj4('EPSG:4326', crs));
  return converters.get(crs);
};

// { x: easting, y: northing } in metres.
export function toProjected(crs, { lat, lng }) {
  const [x, y] = converter(crs).forward([lng, lat]);
  return { x, y };
}

export function fromProjected(crs, x, y) {
  const [lng, lat] = converter(crs).inverse([x, y]);
  return { lat, lng };
}
