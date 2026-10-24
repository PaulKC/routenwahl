// Converts between WGS84 lat/lng and the metric grids the elevation data comes in.
// Works in the page and in the route worker (no Leaflet).
import proj4 from 'https://cdn.jsdelivr.net/npm/proj4@2.12.1/+esm';

proj4.defs('EPSG:2056', '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 '
  + '+x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs'); // Swiss LV95
proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'); // UTM 33N (Norway)
proj4.defs('EPSG:2154', '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 '
  + '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'); // Lambert-93 (France)
const mgi = '+ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs';
proj4.defs('EPSG:31254', `+proj=tmerc +lat_0=0 +lon_0=10.3333333333333 +k=1 +x_0=0 +y_0=-5000000 ${mgi}`); // Austria GK West
proj4.defs('EPSG:31255', `+proj=tmerc +lat_0=0 +lon_0=13.3333333333333 +k=1 +x_0=0 +y_0=-5000000 ${mgi}`); // Austria GK Central
proj4.defs('EPSG:32632', '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs'); // UTM 32N (Italy, TINITALY)

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
