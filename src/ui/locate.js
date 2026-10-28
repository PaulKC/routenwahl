// "Mein Standort": a button under the zoom buttons that centres the map on the device's
// position and marks it with a dot and its accuracy circle.
export function createLocateControl(map, onError) {
  const dot = L.circleMarker([0, 0], {
    radius: 7, color: 'white', weight: 2, fillColor: '#1565c0', fillOpacity: 1, interactive: false,
  });
  const accuracy = L.circle([0, 0], {
    radius: 1, color: '#1565c0', weight: 1, fillOpacity: 0.12, interactive: false,
  });

  const control = L.control({ position: 'topleft' });
  let button;
  control.onAdd = () => {
    const bar = L.DomUtil.create('div', 'leaflet-bar locate-control');
    button = L.DomUtil.create('a', 'locate-button', bar);
    button.href = '#';
    button.role = 'button';
    button.title = 'Mein Standort';
    button.setAttribute('aria-label', 'Mein Standort');
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(button, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      button.classList.add('busy');
      map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true });
    });
    return bar;
  };
  control.addTo(map);

  map.on('locationfound', (e) => {
    button.classList.remove('busy');
    dot.setLatLng(e.latlng).addTo(map);
    accuracy.setLatLng(e.latlng).setRadius(e.accuracy).addTo(map);
  });
  map.on('locationerror', (e) => {
    button.classList.remove('busy');
    onError(e.code === 1
      ? 'Standort nicht freigegeben: bitte in den Browser-Einstellungen erlauben.'
      : 'Standort nicht verfügbar.');
  });
}
