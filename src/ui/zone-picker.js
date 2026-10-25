// Core zone picker, drawn like the SLF's graphic: the aspects as a rose of 8 petals and the
// elevation above which the danger level holds as a mountain shaded above that line; on other slopes it counts as about one level lower (routing/core-zone.js).
// It follows the bulletin's core zone until changed by hand; "SLF" brings that back.
import { ASPECTS } from '../routing/core-zone.js';

const SHOULDER = 40; // radius where neighbouring petals meet
const TIP = 46; // radius of a petal's tip
const LABEL_RADIUS = 29;
const LABELED = ['N', 'E', 'S', 'W'];

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

  const point = (bearing, radius) => {
    const rad = (bearing * Math.PI) / 180;
    return [radius * Math.sin(rad), -radius * Math.cos(rad)].map((v) => v.toFixed(2)).join(' ');
  };
  // Each petal runs from the centre out to its two shoulders and a pointed tip between them.
  const wedges = ASPECTS.map((aspect, k) => {
    const wedge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wedge.setAttribute('d', `M0 0 L${point(k * 45 - 22.5, SHOULDER)} L${point(k * 45, TIP)} L${point(k * 45 + 22.5, SHOULDER)} Z`);
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
  const labels = LABELED.map((aspect) => {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const [x, y] = point(ASPECTS.indexOf(aspect) * 45, LABEL_RADIUS).split(' ');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.dataset.aspect = aspect;
    text.textContent = aspect;
    rose.append(text);
    return text;
  });

  const current = () => manual ?? bulletinZone ?? ALL;
  const same = (a, b) => a.aspects.join() === b.aspects.join() && a.minElevation === b.minElevation;

  function render() {
    const zone = current();
    for (const wedge of wedges) wedge.setAttribute('aria-checked', String(zone.aspects.includes(wedge.dataset.aspect)));
    for (const label of labels) label.classList.toggle('on', zone.aspects.includes(label.dataset.aspect));
    if (document.activeElement !== elevation) elevation.value = zone.minElevation ?? '';
    // Without an elevation the whole mountain is shaded and the line goes.
    const bounded = zone.minElevation !== null;
    el('zone-above-rect').setAttribute('height', bounded ? 42 : 70);
    el('zone-line').style.display = bounded ? '' : 'none';
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
