// Core zone picker: the aspects (a compass rose of 8 wedges) and the elevation above which the
// danger level holds; on other slopes it counts as about one level lower (routing/core-zone.js).
// It follows the bulletin's core zone until changed by hand; "SLF" brings that back.
import { ASPECTS } from '../routing/core-zone.js';

const WEDGE_RADIUS = 46;
const LABELS = { N: [0, -30], E: [30, 0], S: [0, 30], W: [-30, 0] };

// onChange() fires when the zone changes; value() is the zone ({ aspects, minElevation }) or
// null when it covers every slope.
export function createZonePicker({ onChange }) {
  const el = (id) => document.getElementById(id);
  const rose = el('zone-rose');
  const elevation = el('zone-elevation');
  const ALL = { aspects: ASPECTS, minElevation: null };
  let bulletinZone = null; // { aspects, minElevation } from the bulletin, null if none
  let bulletinText = '';
  let manual = null; // the zone set by hand, null while following the bulletin

  const wedges = ASPECTS.map((aspect, k) => {
    const point = (bearing) => {
      const rad = (bearing * Math.PI) / 180;
      return `${(WEDGE_RADIUS * Math.sin(rad)).toFixed(2)} ${(-WEDGE_RADIUS * Math.cos(rad)).toFixed(2)}`;
    };
    const wedge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wedge.setAttribute('d', `M0 0 L${point(k * 45 - 22.5)} A${WEDGE_RADIUS} ${WEDGE_RADIUS} 0 0 1 ${point(k * 45 + 22.5)} Z`);
    wedge.dataset.aspect = aspect;
    wedge.setAttribute('role', 'checkbox');
    wedge.setAttribute('tabindex', '0');
    wedge.setAttribute('aria-label', aspect);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = aspect;
    wedge.append(title);
    rose.append(wedge);
    return wedge;
  });
  for (const [label, [x, y]] of Object.entries(LABELS)) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.textContent = label;
    rose.append(text);
  }

  const current = () => manual ?? bulletinZone ?? ALL;
  const same = (a, b) => a.aspects.join() === b.aspects.join() && a.minElevation === b.minElevation;

  function render() {
    const zone = current();
    for (const wedge of wedges) wedge.setAttribute('aria-checked', String(zone.aspects.includes(wedge.dataset.aspect)));
    if (document.activeElement !== elevation) elevation.value = zone.minElevation ?? '';
    el('zone-slf').hidden = !bulletinZone;
    el('zone-slf').classList.toggle('active', !manual);
    el('core-zone').title = bulletinText ? `SLF: ${bulletinText}` : '';
  }

  // A zone equal to the bulletin's follows the bulletin again.
  function set(zone) {
    manual = bulletinZone && same(zone, bulletinZone) ? null : zone;
    render();
    onChange();
  }

  const toggle = (wedge) => {
    const { aspects, minElevation } = current();
    const picked = wedge.dataset.aspect;
    const next = aspects.includes(picked) ? aspects.filter((a) => a !== picked) : [...aspects, picked];
    set({ aspects: ASPECTS.filter((a) => next.includes(a)), minElevation });
  };
  for (const wedge of wedges) {
    wedge.addEventListener('click', () => toggle(wedge));
    wedge.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle(wedge);
      }
    });
  }
  elevation.addEventListener('change', () => {
    const metres = parseFloat(elevation.value);
    set({ aspects: current().aspects, minElevation: Number.isFinite(metres) ? metres : null });
  });
  el('zone-slf').addEventListener('click', () => {
    if (!manual) return;
    manual = null;
    render();
    onChange();
  });

  render();

  return {
    // The bulletin's zone at the location, or null.
    setBulletin(zone, text) {
      const before = current();
      bulletinZone = zone;
      bulletinText = text;
      if (manual && bulletinZone && same(manual, bulletinZone)) manual = null;
      render();
      if (!same(before, current())) onChange();
    },
    value() {
      const zone = current();
      return zone.aspects.length === ASPECTS.length && zone.minElevation === null ? null : zone;
    },
  };
}
