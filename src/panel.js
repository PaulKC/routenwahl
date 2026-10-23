// The info panel in the bottom left corner.
const formatLatLng = (ll) => `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;

export function createPanel({ onReset }) {
  const el = (id) => document.getElementById(id);
  el('reset').addEventListener('click', onReset);

  return {
    showPoints(start, end) {
      el('start-coords').textContent = start ? formatLatLng(start) : '–';
      el('end-coords').textContent = end ? formatLatLng(end) : '–';
      el('hint').textContent = !start
        ? 'Klicke auf die Karte, um den Start zu setzen'
        : !end
          ? 'Klicke auf die Karte, um das Ziel zu setzen'
          : 'Punkte können verschoben werden';
    },
    showElevationStatus(text) {
      el('elevation-status').textContent = text;
    },
    showRouteStatus(text) {
      el('route-status').textContent = text;
    },
  };
}
