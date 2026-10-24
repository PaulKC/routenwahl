// Avalanche danger picker: the simple way to set the max slope angle. The level comes from the
// current SLF bulletin for A and B (or the map centre before they are set) until a level is
// picked by hand. The bulletin's level carries an "SLF" tag; picking it follows the bulletin again.
import { loadBulletin, dangerAt } from '../data/avalanche-bulletin.js';

// Max slope angle per danger level, after the SLF's graphical reduction method (Harvey, Rhyner
// & Schweizer: Lawinenkunde, 2012; SLF "Achtung Lawinen!"): at 2 avoid slopes over 40°, at 3
// over 35°, at 4 over 30°. Level 1 has no limit there, so the cliff threshold of 45° is used;
// at 5 the SLF advises against tours altogether, 25° is only what the map still shows.
export const DANGER_LEVELS = [
  { level: 1, name: 'gering', maxAngle: 45 },
  { level: 2, name: 'mässig', maxAngle: 40 },
  { level: 3, name: 'erheblich', maxAngle: 35 },
  { level: 4, name: 'gross', maxAngle: 30 },
  { level: 5, name: 'sehr gross', maxAngle: 25, warning: 'Das SLF rät bei Stufe 5 von Skitouren ab.' },
];

const SUBDIVISION = { minus: '−', neutral: '=', plus: '+' };

// onChange(maxAngle) fires when the chosen level changes the max angle.
export function createDangerPicker({ onChange }) {
  const el = (id) => document.getElementById(id);
  const buttons = [...el('danger-levels').querySelectorAll('button')];

  // 'slf' (the bulletin's level), a level 1-5 picked by hand, or 'custom' when the angle was typed under "Erweitert".
  let mode = 'slf';
  const fallbackLevel = 3; // where the bulletin has no level
  let location = [];
  let bulletin = null; // { level, ... } at the location, null if none
  let bulletinState = 'loading'; // 'loading' | 'ok' | 'failed'
  let angle = null;

  const effectiveLevel = () => (mode === 'slf' ? bulletin?.level ?? fallbackLevel : mode === 'custom' ? null : mode);

  function render() {
    const level = effectiveLevel();
    for (const button of buttons) {
      const value = Number(button.dataset.level);
      button.setAttribute('aria-checked', String(value === level));
      button.classList.toggle('slf', value === bulletin?.level);
    }
    const info = DANGER_LEVELS.find((d) => d.level === level);
    el('danger-angle').textContent = angle === null ? '' : `max. ${angle}°`;
    el('danger-info').textContent = describe(info);
    el('danger-warning').textContent = info?.warning ?? '';
  }

  function describe(info) {
    if (mode === 'custom') return 'Eigene Neigung, unter „Erweitert“ eingestellt.';
    if (mode !== 'slf') return bulletin ? slfText() : '';
    if (bulletinState === 'loading') return 'SLF-Bulletin wird geladen…';
    if (bulletinState === 'failed') return `SLF-Bulletin nicht erreichbar. Solange gilt Stufe ${info.level}; bitte selbst wählen.`;
    if (!bulletin) return `Hier gibt es kein SLF-Bulletin (nur Schweiz, im Winter). Solange gilt Stufe ${info.level}; bitte selbst wählen.`;
    return slfText();
  }

  function slfText() {
    const sub = SUBDIVISION[bulletin.subdivision] ?? '';
    const { name } = DANGER_LEVELS.find((d) => d.level === bulletin.level);
    const until = bulletin.validUntil.toLocaleString('de-CH', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return `SLF: ${bulletin.level}${sub} ${name}, ${bulletin.regions.join(', ')} · gültig bis ${until}`;
  }

  // Works out the angle for the current level and reports it if it changed.
  function update() {
    const info = DANGER_LEVELS.find((d) => d.level === effectiveLevel());
    const next = info ? info.maxAngle : angle;
    const changed = next !== angle;
    angle = next;
    render();
    if (changed && angle !== null) onChange(angle);
  }

  async function lookUp() {
    try {
      const data = await loadBulletin();
      bulletinState = 'ok';
      // Of several points (A and B), the most dangerous counts.
      bulletin = location.map((ll) => dangerAt(data, ll)).filter(Boolean)
        .reduce((worst, d) => (!worst || d.level > worst.level ? d : worst), null);
    } catch {
      bulletinState = 'failed';
      bulletin = null;
    }
    update();
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const level = Number(button.dataset.level);
      mode = level === bulletin?.level ? 'slf' : level;
      update();
    });
  }

  // The starting angle is read with maxAngle(), so it isn't reported through onChange.
  angle = DANGER_LEVELS.find((d) => d.level === effectiveLevel()).maxAngle;
  render();

  return {
    // The points the bulletin is looked up for: A and B, or the map centre.
    setLocation(latlngs) {
      location = latlngs;
      lookUp();
    },
    // The angle was typed by hand under "Erweitert".
    setCustom(value) {
      mode = 'custom';
      angle = value;
      render();
    },
    maxAngle: () => angle,
  };
}
