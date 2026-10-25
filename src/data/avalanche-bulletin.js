// Current Swiss avalanche bulletin from the SLF (CC BY 4.0, attribution "WSL-Institut für
// Schnee- und Lawinenforschung SLF" with a link to www.slf.ch). The GeoJSON holds one polygon
// per group of warning regions that share the same bulletin, in WGS84 lon/lat.
// API docs: https://aws.slf.ch/api/bulletin/caaml
const BULLETIN_URL = 'https://aws.slf.ch/api/bulletin/caaml/v4/de/geojson';

const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const LEVEL = { low: 1, moderate: 2, considerable: 3, high: 4, very_high: 5 };
const SUB_RANK = { minus: 0, neutral: 1, plus: 2 };

// Orders dangers by level, then by subdivision (− < = < +); a missing subdivision counts as =.
export const dangerRank = ({ level, subdivision }) => level * 3 + (SUB_RANK[subdivision] ?? 1);

let pending = null;

// Resolves to the bulletin, or rejects if it can't be loaded. Loaded again once it has expired.
export function loadBulletin() {
  if (pending) return pending;
  pending = fetch(BULLETIN_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`SLF ${res.status}`);
      return res.json();
    })
    .then((collection) => {
      const features = collection.features ?? [];
      const ends = features.map((f) => Date.parse(f.properties.validTime?.endTime)).filter(Number.isFinite);
      const validUntil = ends.length ? new Date(Math.min(...ends)) : null;
      if (validUntil) setTimeout(() => { pending = null; }, Math.max(0, validUntil - Date.now()));
      return { features, validUntil };
    })
    .catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}

// The danger at a point: { level, subdivision, zone, zoneText, regions, validUntil }, or null
// outside the bulletin's regions (outside Switzerland, or out of season when there is no
// bulletin). Where the bulletin gives several ratings (by elevation or time of day), the
// highest counts. zone is where that level holds (see coreZoneOf), zoneText the SLF's
// sentence for it ("Gefahrenstufe … an West- über Nordost- bis Südosthängen über 2600m.").

export function dangerAt(bulletin, { lat, lng }) {
  const feature = bulletin.features.find((f) => containsPoint(f.geometry, lng, lat));
  if (!feature) return null;
  let best = null;
  for (const rating of feature.properties.dangerRatings ?? []) {
    const level = LEVEL[rating.mainValue];
    const danger = { level, subdivision: rating.customData?.CH?.subdivision ?? null };
    if (level && (!best || dangerRank(danger) > dangerRank(best))) best = danger;
  }
  if (!best) return null;
  return {
    ...best,
    ...coreZoneOf(feature.properties.avalancheProblems ?? [], best.level),
    regions: (feature.properties.regions ?? []).map((r) => r.name),
    validUntil: new Date(feature.properties.validTime?.endTime),
  };
}

// The core zone of a level: the aspects and the lowest elevation of the avalanche problems
// rated at that level, as { zone: { aspects, minElevation }, zoneText }. Of several such
// problems the zone covers all their aspects from the lowest of their elevations. A problem
// without aspects or a lower bound covers all aspects or elevations, and so does a lower bound
// that isn't in metres (e.g. "treeline"). An upper bound is left out, which only makes the
// zone larger. zone is null when no problem is rated at the level.
function coreZoneOf(problems, level) {
  const atLevel = problems.filter((p) => LEVEL[p.dangerRatingValue] === level);
  if (!atLevel.length) return { zone: null, zoneText: '' };
  const aspects = new Set();
  let minElevation = Infinity;
  for (const problem of atLevel) {
    const listed = problem.aspects?.length ? problem.aspects : ASPECTS;
    for (const aspect of listed) aspects.add(aspect);
    const bound = parseFloat(problem.elevation?.lowerBound); // NaN when missing or not metres
    minElevation = Math.min(minElevation, Number.isFinite(bound) ? bound : -Infinity);
  }
  const texts = [...new Set(atLevel.map((p) => p.customData?.CH?.coreZoneText).filter(Boolean))];
  return {
    zone: { aspects: ASPECTS.filter((a) => aspects.has(a)), minElevation: Number.isFinite(minElevation) ? minElevation : null },
    zoneText: texts.join(' '),
  };
}

function containsPoint(geometry, x, y) {
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  // Inside the outer ring and outside its holes, by the even-odd rule over all rings.
  return polygons.some((rings) => rings.reduce((inside, ring) => inside !== inRing(ring, x, y), false));
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
