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
  marker.on('dragend', loadElevation);
  points[kind] = marker;
}

map.on('click', (e) => {
  if (!points.start) placePoint('start', e.latlng);
  else if (!points.end) {
    placePoint('end', e.latlng);
    loadElevation();
  }
  update();
});

document.getElementById('reset').addEventListener('click', () => {
  for (const kind of ['start', 'end']) {
    if (points[kind]) map.removeLayer(points[kind]);
    points[kind] = null;
  }
  cancelElevation();
  update();
});

// Elevation tiles covering the A–B bounding box plus a margin, outlined on the map.
const ELEVATION_MARGIN_M = 500;
const tileOutlines = L.layerGroup().addTo(map);
const elevationStatus = document.getElementById('elevation-status');
let elevationRequest = null;

function cancelElevation() {
  elevationRequest?.abort();
  elevationRequest = null;
  tileOutlines.clearLayers();
  elevationStatus.textContent = '';
}

async function loadElevation() {
  if (!points.start || !points.end) return;
  cancelElevation();
  const request = new AbortController();
  elevationRequest = request;

  const bounds = L.latLngBounds(points.start.getLatLng(), points.end.getLatLng());
  const dLat = ELEVATION_MARGIN_M / 111320;
  const dLng = ELEVATION_MARGIN_M / (111320 * Math.cos(bounds.getCenter().lat * Math.PI / 180));
  const bbox = [bounds.getWest() - dLng, bounds.getSouth() - dLat, bounds.getEast() + dLng, bounds.getNorth() + dLat];

  elevationStatus.textContent = 'Höhendaten: suche Kacheln…';
  let tiles;
  try {
    tiles = await findElevationTiles(bbox, request.signal);
  } catch (err) {
    if (!request.signal.aborted) elevationStatus.textContent = `Höhendaten: Fehler (${err.message})`;
    return;
  }
  if (request.signal.aborted) return;
  if (tiles.length > MAX_TILES) {
    elevationStatus.textContent = `Höhendaten: ${tiles.length} Kacheln, zu viele (max. ${MAX_TILES}). Punkte näher setzen.`;
    return;
  }

  const outlines = new Map();
  for (const tile of tiles) {
    const [w, s, e, n] = tile.bbox;
    outlines.set(tile.url, L.rectangle([[s, w], [n, e]], { color: '#777', weight: 1, fillOpacity: 0.05 })
      .bindTooltip(`swissALTI3D ${tile.square} (${tile.year})`)
      .addTo(tileOutlines));
  }

  let loaded = 0;
  let failed = 0;
  let bytes = 0;
  let min = Infinity;
  let max = -Infinity;
  const showProgress = () => {
    const mb = (bytes / 1e6).toFixed(1);
    const range = loaded ? `, ${Math.round(min)}–${Math.round(max)} m ü. M.` : '';
    const errors = failed ? `, ${failed} Fehler` : '';
    elevationStatus.textContent = `Höhendaten: ${loaded}/${tiles.length} Kacheln (${mb} MB)${range}${errors}`;
  };
  showProgress();

  await downloadTiles(tiles, request.signal, (tile, data, err) => {
    if (request.signal.aborted) return;
    if (data) {
      loaded += 1;
      bytes += data.bytes;
      min = Math.min(min, data.min);
      max = Math.max(max, data.max);
      outlines.get(tile.url).setStyle({ color: '#1565c0', fillOpacity: 0.1 });
    } else {
      failed += 1;
      outlines.get(tile.url).setStyle({ color: '#c62828', fillOpacity: 0.2 });
      console.error(err);
    }
    showProgress();
  });
}

update();
