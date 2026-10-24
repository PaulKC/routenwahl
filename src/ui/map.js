// Base map with swisstopo, Kartverket and OpenTopoMap layers.
import { regionAt } from '../data/regions.js';

const swisstopo = (layer, format = 'jpeg') =>
  `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.${format}`;
const swisstopoAttribution = '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>';

export function createMap(elementId) {
  const baseLayers = {
    'Landeskarte': L.tileLayer(swisstopo('ch.swisstopo.pixelkarte-farbe'), {
      maxZoom: 19,
      attribution: swisstopoAttribution,
    }),
    'Winterlandeskarte': L.tileLayer(swisstopo('ch.swisstopo.pixelkarte-farbe-winter'), {
      maxZoom: 19,
      attribution: swisstopoAttribution,
    }),
    'Norwegen Topo': L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    }),
    'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; OpenTopoMap (CC-BY-SA)',
    }),
  };

  const overlays = {
    'Hangneigung > 30° (nur Schweiz)': L.tileLayer(swisstopo('ch.swisstopo.hangneigung-ueber_30', 'png'), {
      maxZoom: 19,
      opacity: 0.6,
      attribution: swisstopoAttribution,
    }),
  };

  // The national maps only cover their own country, so pick the one for where the map is.
  const baseLayerFor = (latlng) => baseLayers[regionAt(latlng)?.baseLayer ?? 'OpenTopoMap'];
  const regionalLayers = new Set([baseLayers['Landeskarte'], baseLayers['Winterlandeskarte'], baseLayers['Norwegen Topo']]);

  const view = loadView();
  let baseLayer = baseLayerFor(L.latLng(view.center));
  const map = L.map(elementId, {
    center: view.center,
    zoom: view.zoom,
    layers: [baseLayer],
  });
  map.on('baselayerchange', (e) => { baseLayer = e.layer; });
  map.on('moveend', () => {
    saveView(map);
    // Leave a national map that doesn't cover the view; other choices are the user's.
    const preferred = baseLayerFor(map.getCenter());
    if (regionalLayers.has(baseLayer) && preferred !== baseLayer && !sameRegion(baseLayers, baseLayer, preferred)) {
      map.removeLayer(baseLayer);
      map.addLayer(preferred);
      baseLayer = preferred;
    }
  });

  L.control.layers(baseLayers, overlays).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  // As a control in the same corner, Leaflet stacks the legend below the layer switcher,
  // so it moves down instead of overlapping when the switcher opens.
  addElementAsControl(map, 'legend', 'topright');
  return map;
}

// Landeskarte and Winterlandeskarte both cover Switzerland, so switching between them is fine.
function sameRegion(baseLayers, a, b) {
  const swiss = [baseLayers['Landeskarte'], baseLayers['Winterlandeskarte']];
  return swiss.includes(a) && swiss.includes(b);
}

function addElementAsControl(map, elementId, position) {
  const element = document.getElementById(elementId);
  const control = L.control({ position });
  control.onAdd = () => {
    element.classList.add('leaflet-control');
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
    return element;
  };
  control.addTo(map);
}

// The last map position and zoom are kept in localStorage so a reload opens at the same spot.
const VIEW_KEY = 'skitour.mapView';
const DEFAULT_VIEW = { center: [46.8, 8.6], zoom: 9 };

function loadView() {
  try {
    const { lat, lng, zoom } = JSON.parse(localStorage.getItem(VIEW_KEY));
    if ([lat, lng, zoom].every(Number.isFinite)) return { center: [lat, lng], zoom };
  } catch {
    // nothing saved yet, or storage unavailable
  }
  return DEFAULT_VIEW;
}

function saveView(map) {
  const { lat, lng } = map.getCenter();
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat, lng, zoom: map.getZoom() }));
  } catch {
    // storage unavailable (e.g. private mode); the view just won't be remembered
  }
}
