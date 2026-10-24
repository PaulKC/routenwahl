// Base map with swisstopo, Kartverket, IGN and OpenTopoMap layers.
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
    'Frankreich Plan IGN': L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
      + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.ign.fr/">IGN</a>',
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
  const regionalLayers = new Set(['Landeskarte', 'Winterlandeskarte', 'Norwegen Topo', 'Frankreich Plan IGN']
    .map((name) => baseLayers[name]));

  const view = loadView();
  let baseLayer = baseLayerFor(L.latLng(view.center));
  const map = L.map(elementId, {
    center: view.center,
    zoom: view.zoom,
    layers: [baseLayer],
  });
  let userPicked = false; // set once the user chooses a base map in the layer switcher
  let switching = false; // Leaflet also fires baselayerchange for our own switches
  map.on('baselayerchange', (e) => {
    baseLayer = e.layer;
    if (!switching) userPicked = true;
  });
  map.on('moveend', () => {
    saveView(map);
    // Follow the region in view until the user picks a map; even then, leave a national map
    // that doesn't cover the view.
    const preferred = baseLayerFor(map.getCenter());
    const follow = !userPicked || regionalLayers.has(baseLayer);
    if (follow && preferred !== baseLayer && !sameRegion(baseLayers, baseLayer, preferred)) {
      switching = true;
      map.removeLayer(baseLayer);
      map.addLayer(preferred);
      switching = false;
      baseLayer = preferred;
    }
  });

  // The layer switcher goes inside the "Karte" card so it opens and closes like the legend
  // (click on the title) instead of Leaflet's hover-to-expand icon, which is fiddly on a phone.
  const layers = L.control.layers(baseLayers, overlays, { collapsed: false }).addTo(map);
  const layersContainer = layers.getContainer();
  layersContainer.classList.remove('leaflet-control'); // the card is the control now
  document.getElementById('basemap').append(layersContainer);
  L.control.scale({ imperial: false }).addTo(map);
  // As controls in the same corner, Leaflet stacks the cards, so opening one pushes the
  // next one down instead of overlapping it.
  addCardAsControl(map, 'basemap', 'topright');
  addCardAsControl(map, 'legend', 'topright');
  return map;
}

// Landeskarte and Winterlandeskarte both cover Switzerland, so switching between them is fine.
function sameRegion(baseLayers, a, b) {
  const swiss = [baseLayers['Landeskarte'], baseLayers['Winterlandeskarte']];
  return swiss.includes(a) && swiss.includes(b);
}

// A <details> card shown as a map control; whether it is open is remembered across reloads.
function addCardAsControl(map, elementId, position) {
  const element = document.getElementById(elementId);
  const key = `skitour.card.${elementId}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) element.open = saved === 'open';
  } catch {
    // storage unavailable: keep the default from index.html
  }
  element.addEventListener('toggle', () => {
    try {
      localStorage.setItem(key, element.open ? 'open' : 'closed');
    } catch {
      // storage unavailable (e.g. private mode); the state just won't be remembered
    }
  });
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
