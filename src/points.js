// Start and end point: first click sets the start, second the end. Both can be dragged.
const pinIcon = (kind, label) => L.divIcon({
  className: '',
  html: `<span class="pin ${kind}">${label}</span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// onMove fires while points change; onSet fires once both are placed and after each drag.
export function createPointPicker(map, { onMove, onSet }) {
  const points = { start: null, end: null };
  const line = L.polyline([], { color: '#333', weight: 2, dashArray: '6 6' }).addTo(map);

  const latLngs = () => ({
    start: points.start?.getLatLng() ?? null,
    end: points.end?.getLatLng() ?? null,
  });

  function moved() {
    const { start, end } = latLngs();
    line.setLatLngs(start && end ? [start, end] : []);
    onMove(start, end);
  }

  function place(kind, latlng) {
    const marker = L.marker(latlng, {
      icon: pinIcon(kind, kind === 'start' ? 'A' : 'B'),
      draggable: true,
    }).addTo(map);
    marker.on('drag', moved);
    marker.on('dragend', () => onSet(points.start.getLatLng(), points.end.getLatLng()));
    points[kind] = marker;
  }

  map.on('click', (e) => {
    if (points.start && points.end) return;
    place(points.start ? 'end' : 'start', e.latlng);
    moved();
    if (points.end) onSet(points.start.getLatLng(), points.end.getLatLng());
  });

  function reset() {
    for (const kind of ['start', 'end']) {
      if (points[kind]) map.removeLayer(points[kind]);
      points[kind] = null;
    }
    moved();
  }

  return { reset, latLngs };
}
