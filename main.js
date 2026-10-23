const swisstopo = (layer, format = 'jpeg') =>
  `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.${format}`;
const swisstopoAttribution = '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>';

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

const map = L.map('map', {
  center: [46.8, 8.6],
  zoom: 9,
  layers: [baseLayers['Winterlandeskarte']],
});

L.control.layers(baseLayers, overlays).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

// Start and end point: first click sets the start, second the end. Both can be dragged.
const pinIcon = (kind, label) => L.divIcon({
  className: '',
  html: `<span class="pin ${kind}">${label}</span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const points = { start: null, end: null };
const line = L.polyline([], { color: '#333', weight: 2, dashArray: '6 6' }).addTo(map);

const formatLatLng = (ll) => `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;

function update() {
  document.getElementById('start-coords').textContent = points.start ? formatLatLng(points.start.getLatLng()) : '–';
  document.getElementById('end-coords').textContent = points.end ? formatLatLng(points.end.getLatLng()) : '–';
  document.getElementById('hint').textContent = !points.start
    ? 'Klicke auf die Karte, um den Start zu setzen'
    : !points.end
      ? 'Klicke auf die Karte, um das Ziel zu setzen'
      : 'Punkte können verschoben werden';
  line.setLatLngs(points.start && points.end ? [points.start.getLatLng(), points.end.getLatLng()] : []);
}

function placePoint(kind, latlng) {
  const marker = L.marker(latlng, {
    icon: pinIcon(kind, kind === 'start' ? 'A' : 'B'),
    draggable: true,
  }).addTo(map);
  marker.on('drag', update);
  points[kind] = marker;
}

map.on('click', (e) => {
  if (!points.start) placePoint('start', e.latlng);
  else if (!points.end) placePoint('end', e.latlng);
  update();
});

document.getElementById('reset').addEventListener('click', () => {
  for (const kind of ['start', 'end']) {
    if (points[kind]) map.removeLayer(points[kind]);
    points[kind] = null;
  }
  update();
});

update();
