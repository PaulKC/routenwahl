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
