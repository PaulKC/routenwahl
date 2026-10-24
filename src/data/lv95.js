// WGS84 <-> Swiss LV95 (EPSG:2056) with swisstopo's approximate formulas (accurate to about 1 m).

export function toLV95(latlng) {
  const phi = (latlng.lat * 3600 - 169028.66) / 10000;
  const lambda = (latlng.lng * 3600 - 26782.5) / 10000;
  const e = 2600072.37
    + 211455.93 * lambda
    - 10938.51 * lambda * phi
    - 0.36 * lambda * phi ** 2
    - 44.54 * lambda ** 3;
  const n = 1200147.07
    + 308807.95 * phi
    + 3745.25 * lambda ** 2
    + 76.63 * phi ** 2
    - 194.56 * lambda ** 2 * phi
    + 119.79 * phi ** 3;
  return { e, n };
}

export function fromLV95(e, n) {
  const y = (e - 2600000) / 1e6;
  const x = (n - 1200000) / 1e6;
  const lambda = 2.6779094
    + 4.728982 * y
    + 0.791484 * y * x
    + 0.1306 * y * x ** 2
    - 0.0436 * y ** 3;
  const phi = 16.9023892
    + 3.238272 * x
    - 0.270978 * y ** 2
    - 0.002528 * x ** 2
    - 0.0447 * y ** 2 * x
    - 0.0140 * x ** 3;
  return L.latLng(phi * 100 / 36, lambda * 100 / 36);
}
