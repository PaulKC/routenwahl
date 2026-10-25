// Wildlife rest zones ("Wildruhezonen") outlined on the map: loaded for the map view from
// zoom level MIN_ZOOM on, and for every route (see forRoute). Hovering a zone names it, its
// rule and its protection period.
import { loadZones, inProtectionPeriod } from '../data/wildlife-zones.js';

const MIN_ZOOM = 11;
const ROUTE_MARGIN_M = 1500; // as for the elevation data, see elevation-layer.js

const STYLES = {
  binding: { color: '#c62828', weight: 2, fillColor: '#c62828', fillOpacity: 0.08 },
  recommended: { color: '#c62828', weight: 2, dashArray: '6 5', fillColor: '#c62828', fillOpacity: 0.04 },
  inactive: { color: '#757575', weight: 1.5, dashArray: '2 5', fillOpacity: 0 }, // outside the protection period
};

export function createWildlifeLayer(map) {
  const group = L.layerGroup().addTo(map);
  map.attributionControl.addAttribution('Wildruhezonen: <a href="https://www.bafu.admin.ch/">BAFU</a>');
  const drawn = new Set();
  let viewRequest = null;

  function draw(zones) {
    for (const zone of zones) {
      if (drawn.has(zone.id)) continue;
      drawn.add(zone.id);
      const active = inProtectionPeriod(zone);
      const style = !active ? STYLES.inactive : zone.binding ? STYLES.binding : STYLES.recommended;
      L.geoJSON({ type: 'MultiPolygon', coordinates: zone.polygons }, { style })
        .bindTooltip(describe(zone, active), { sticky: true })
        .addTo(group);
    }
  }

  async function showView() {
    viewRequest?.abort();
    if (map.getZoom() < MIN_ZOOM) return;
    const request = new AbortController();
    viewRequest = request;
    const b = map.getBounds();
    try {
      draw(await loadZones([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], request.signal));
    } catch {
      // shown again on the next move; a route reports it (see forRoute)
    }
  }
  map.on('moveend', showView);
  showView();

  return {
    // The zones around A and B (with the margin the elevation data has), drawn on the map.
    // Rejects if they can't be loaded.
    async forRoute(start, end) {
      const bounds = L.latLngBounds(start, end);
      const dLat = ROUTE_MARGIN_M / 111320;
      const dLng = ROUTE_MARGIN_M / (111320 * Math.cos(bounds.getCenter().lat * Math.PI / 180));
      const zones = await loadZones([bounds.getWest() - dLng, bounds.getSouth() - dLat, bounds.getEast() + dLng, bounds.getNorth() + dLat]);
      draw(zones);
      return zones;
    },
  };
}

function describe(zone, active) {
  const escape = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const lines = [
    `<b>Wildruhezone ${escape(zone.name)}</b>`,
    `${zone.binding ? 'Rechtsverbindlich' : 'Empfohlen'}: ${escape(zone.rule)}`,
    `Schutzzeit ${escape(zone.period)}${active ? '' : ' (jetzt nicht)'}`,
  ];
  if (zone.info) lines.push(escape(zone.info));
  return lines.join('<br>');
}
