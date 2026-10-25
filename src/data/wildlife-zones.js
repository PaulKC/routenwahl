// Swiss wildlife rest zones ("Wildruhezonen") from the federal dataset of the BAFU, through
// the geo.admin.ch API (layer ch.bafu.wrz-wildruhezonen_portal, free to use with attribution
// "BAFU"). Each zone is binding ("rechtsverbindlich", entry banned by law) or recommended
// ("empfohlen"), and holds during its protection period ("schutzzeit", e.g. 01.12. - 30.04.).
// The layer has no routes through the zones; some cantons publish those separately.
const IDENTIFY_URL = 'https://api3.geo.admin.ch/rest/services/all/MapServer/identify';
const LAYER = 'ch.bafu.wrz-wildruhezonen_portal';
const PAGE_SIZE = 50;
const SWITZERLAND = [5.9, 45.8, 10.5, 47.9]; // rough box; no zones outside it

const zones = new Map(); // id -> zone, every zone loaded so far
const loadedBoxes = []; // boxes whose zones are all in `zones`

// A zone: { id, name, binding, rule, period, info, url, bbox: [west, south, east, north],
// polygons: [[ring of [lng, lat], ...], ...] } (polygons as GeoJSON MultiPolygon coordinates).
function toZone(feature) {
  const p = feature.properties ?? feature.attributes ?? {};
  const { geometry } = feature;
  return {
    id: feature.featureId ?? feature.id,
    name: p.wrz_name ?? p.label ?? 'Wildruhezone',
    binding: p.schutzs_de === 'rechtsverbindlich',
    rule: p.best_de ?? '',
    period: p.schutzzeit ?? '',
    info: (p.zusatzinformation ?? '').trim(),
    url: p.url_kanton || null,
    bbox: feature.bbox,
    polygons: geometry?.type === 'Polygon' ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [],
  };
}

const contains = (outer, inner) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// All zones touching the box [west, south, east, north] (WGS84). Rejects if the API can't be
// reached.
export async function loadZones(box, signal) {
  if (!overlaps(box, SWITZERLAND)) return [];
  if (!loadedBoxes.some((loaded) => contains(loaded, box))) {
    const seen = new Set();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const params = new URLSearchParams({
        geometryType: 'esriGeometryEnvelope',
        geometry: box.join(','),
        geometryFormat: 'geojson',
        sr: '4326',
        layers: `all:${LAYER}`,
        tolerance: '0',
        returnGeometry: 'true',
        limit: String(PAGE_SIZE),
        offset: String(offset),
        lang: 'de',
      });
      const res = await fetch(`${IDENTIFY_URL}?${params}`, { signal });
      if (!res.ok) throw new Error(`geo.admin.ch ${res.status}`);
      const { results = [] } = await res.json();
      let added = 0;
      for (const feature of results) {
        const zone = toZone(feature);
        if (!seen.has(zone.id)) added += 1;
        seen.add(zone.id);
        if (zone.polygons.length) zones.set(zone.id, zone);
      }
      // A short page is the last; a page with nothing new means the API ignored the offset.
      if (results.length < PAGE_SIZE || !added) break;
    }
    loadedBoxes.push(box);
  }
  return [...zones.values()].filter((zone) => !zone.bbox || overlaps(zone.bbox, box));
}

// Whether the date lies in the zone's protection period ("01.12. - 30.04.", which may run
// over New Year). A period that can't be read counts as always.
export function inProtectionPeriod(zone, date = new Date()) {
  const match = zone.period.match(/(\d{1,2})\.(\d{1,2})\.?\s*-\s*(\d{1,2})\.(\d{1,2})\./);
  if (!match) return true;
  const [from, to] = [[match[2], match[1]], [match[4], match[3]]].map(([m, d]) => Number(m) * 100 + Number(d));
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  return from <= to ? today >= from && today <= to : today >= from || today <= to;
}
