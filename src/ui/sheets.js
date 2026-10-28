// On a phone the panel and the map cards would cover most of the map, so there (see COMPACT,
// which must match the media queries in style.css) they become sheets:
//   - The panel docks to the bottom edge and folds down to the hint and the danger level.
//     Tapping or swiping its handle opens it for the core zone, snow and "Erweitert".
//   - "Karte" and "Legende" move off the map into one sheet opened by the "Ebenen" button.
// On larger screens none of this shows and the panel and cards stay as they are.
export const COMPACT = '(max-width: 600px), (max-height: 500px)';

export function createSheets(map) {
  const el = (id) => document.getElementById(id);
  const panel = el('panel');
  const handle = el('panel-handle');
  const backdrop = el('sheet-backdrop');
  const compact = window.matchMedia(COMPACT);

  const setPanelOpen = (open) => {
    panel.classList.toggle('collapsed', !open);
    handle.setAttribute('aria-expanded', String(open));
    if (!open) panel.scrollTop = 0;
  };
  setPanelOpen(false);

  // A swipe up opens the panel, a swipe down closes it, a tap toggles it.
  let startY = null;
  handle.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointerup', (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    const open = panel.classList.contains('collapsed');
    setPanelOpen(Math.abs(dy) < 20 ? open : dy < 0);
  });
  handle.addEventListener('pointercancel', () => {
    startY = null;
  });
  // Keyboard users get the same toggle (pointer taps are handled above).
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPanelOpen(panel.classList.contains('collapsed'));
    }
  });

  // The layers sheet is Leaflet's top-right control corner, restyled in style.css while
  // body.layers-open is set; the backdrop catches taps so they don't set a point on the map.
  const setLayersOpen = (open) => {
    document.body.classList.toggle('layers-open', open);
    el('layers-button').setAttribute('aria-expanded', String(open));
    if (open) {
      el('basemap').open = true;
      el('legend').open = true;
    }
  };
  el('layers-button').addEventListener('click', () => setLayersOpen(!document.body.classList.contains('layers-open')));
  el('layers-close').addEventListener('click', () => setLayersOpen(false));
  backdrop.addEventListener('click', () => setLayersOpen(false));
  compact.addEventListener('change', () => setLayersOpen(false));

  // Leaflet's scale and attribution sit just above the docked panel.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--panel-height', `${panel.offsetHeight}px`);
    map.invalidateSize();
  }).observe(panel);
}
