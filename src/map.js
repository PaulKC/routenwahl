// Base map with swisstopo and OpenTopoMap layers.
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
    'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; OpenTopoMap (CC-BY-SA)',
    }),
  };

  const overlays = {
    'Hangneigung > 30°': L.tileLayer(swisstopo('ch.swisstopo.hangneigung-ueber_30', 'png'), {
      maxZoom: 19,
      opacity: 0.6,
      attribution: swisstopoAttribution,
    }),
  };

  const view = loadView();
  const map = L.map(elementId, {
    center: view.center,
    zoom: view.zoom,
    layers: [baseLayers['Winterlandeskarte']],
  });
  map.on('moveend', () => saveView(map));

  L.control.layers(baseLayers, overlays).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  return map;
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
