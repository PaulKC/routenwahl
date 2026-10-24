// Avalanche danger picker: the simple way to set the max slope angle. The level comes from the
// current SLF bulletin for A and B (or the map centre before they are set) until a level is
// picked by hand. The bulletin's level carries an "SLF" tag; picking it follows the bulletin again.
import { loadBulletin, dangerAt, dangerRank } from '../data/avalanche-bulletin.js';

// Max slope angle per danger level, after the SLF's graphical reduction method (Harvey, Rhyner
// & Schweizer: Lawinenkunde, 2012; SLF "Achtung Lawinen!"): at 2 avoid slopes over 40°, at 3
// over 35°, at 4 over 30°. Level 1 has no limit there, so the cliff threshold of 45° is used;
// at 5 the SLF advises against tours altogether. Every level is set 5° below these values to
// keep a margin (40 / 35 / 30 / 25 / 20°).
// The SLF splits 2 and 3 into −, = and + (bulletin subdivision minus / neutral / plus); these
// fill the 5° band down to the next level, − the loosest and + the strictest. The SLF gives
// no angles for them; spreading them over the band is this app's choice.
// From 3 the steepest part of the whole Hang counts, not just the slope on the track
// (wholeSlope, see routing/hang.js).
export const DANGER_LEVELS = [
  { level: 1, name: 'gering', maxAngle: 40, wholeSlope: false },
  { level: 2, name: 'mässig', sub: { minus: 40, neutral: 37.5, plus: 35 }, wholeSlope: false },
  { level: 3, name: 'erheblich', sub: { minus: 35, neutral: 32.5, plus: 30 }, wholeSlope: true },
  { level: 4, name: 'gross', maxAngle: 25, wholeSlope: true },
  { level: 5, name: 'sehr gross', maxAngle: 20, wholeSlope: true, warning: 'Das SLF rät bei Stufe 5 von Skitouren ab.' },
];

const SUBDIVISION = { minus: '−', neutral: '=', plus: '+' };

const infoOf = (level) => DANGER_LEVELS.find((d) => d.level === level);

// onChange({ maxAngle, wholeSlope }) fires when the chosen level changes what it sets.
export function createDangerPicker({ onChange }) {
  const el = (id) => document.getElementById(id);
  const buttons = [...el('danger-levels').querySelectorAll('button')];
  const subButtons = [...el('danger-subs').querySelectorAll('button')];

  // 'slf' (the bulletin's level), { level, sub } picked by hand, or 'custom' when set under
  // "Erweitert". sub is 'minus', 'neutral' or 'plus'; it only matters for levels that have one.
  let mode = 'slf';
  const fallback = { level: 3, sub: 'plus' }; // where the bulletin has no level: the strictest 3 (30°)
  let location = [];
  let bulletin = null; // { level, subdivision, ... } at the location, null if none
  let bulletinState = 'loading'; // 'loading' | 'ok' | 'failed'
  let applied = null; // { maxAngle, wholeSlope } in effect

  const fromBulletin = () => (bulletin ? { level: bulletin.level, sub: bulletin.subdivision ?? 'neutral' } : null);
  const effective = () => (mode === 'slf' ? fromBulletin() ?? fallback : mode === 'custom' ? null : mode);

  function render() {
    const picked = effective();
    const slf = fromBulletin();
    for (const button of buttons) {
      const value = Number(button.dataset.level);
      button.setAttribute('aria-checked', String(value === picked?.level));
      button.classList.toggle('slf', value === slf?.level);
    }
    const info = infoOf(picked?.level);
    el('danger-subs').hidden = !info?.sub;
    for (const button of subButtons) {
      const { sub } = button.dataset;
      button.setAttribute('aria-checked', String(sub === picked?.sub));
      button.classList.toggle('slf', slf?.level === picked?.level && slf?.sub === sub);
    }
    el('danger-angle').textContent = applied ? `max. ${applied.maxAngle}°${applied.wholeSlope ? ' im ganzen Hang' : ''}` : '';
    // No text line under the buttons; the source of the level is the buttons' tooltip.
    el('danger-levels').title = describe(info);
    el('danger-warning').textContent = info?.warning ?? '';
  }

  function describe(info) {
    if (mode === 'custom') return 'Eigene Werte, unter „Erweitert“ eingestellt.';
    if (mode !== 'slf') return bulletin ? slfText() : '';
    const fallbackText = `${fallback.level}${info.sub ? SUBDIVISION[fallback.sub] : ''}`;
    if (bulletinState === 'loading') return 'SLF-Bulletin wird geladen…';
    if (bulletinState === 'failed') return `SLF-Bulletin nicht erreichbar. Solange gilt Stufe ${fallbackText}; bitte selbst wählen.`;
    if (!bulletin) return `Hier gibt es kein SLF-Bulletin (nur Schweiz, im Winter). Solange gilt Stufe ${fallbackText}; bitte selbst wählen.`;
    return slfText();
  }

  function slfText() {
    const sub = SUBDIVISION[bulletin.subdivision] ?? '';
    const { name } = infoOf(bulletin.level);
    const until = bulletin.validUntil.toLocaleString('de-CH', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return `SLF: ${bulletin.level}${sub} ${name}, ${bulletin.regions.join(', ')} · gültig bis ${until}`;
  }

  const settingsOf = (picked) => {
    const info = picked && infoOf(picked.level);
    return info ? { maxAngle: info.sub?.[picked.sub] ?? info.maxAngle, wholeSlope: info.wholeSlope } : null;
  };

  // Works out the settings for the current level and reports them if they changed.
  function update() {
    const next = settingsOf(effective());
    const changed = next && (next.maxAngle !== applied.maxAngle || next.wholeSlope !== applied.wholeSlope);
    if (next) applied = next;
    render();
    if (changed) onChange(applied);
  }

  async function lookUp() {
    try {
      const data = await loadBulletin();
      bulletinState = 'ok';
      // Of several points (A and B), the most dangerous counts.
      bulletin = location.map((ll) => dangerAt(data, ll)).filter(Boolean)
        .reduce((worst, d) => (!worst || dangerRank(d) > dangerRank(worst) ? d : worst), null);
    } catch {
      bulletinState = 'failed';
      bulletin = null;
    }
    update();
  }

  // Picking what the bulletin says follows the bulletin again.
  const pick = (picked) => {
    const slf = fromBulletin();
    const sameAsSlf = slf?.level === picked.level && (!infoOf(picked.level).sub || slf.sub === picked.sub);
    mode = sameAsSlf ? 'slf' : picked;
    update();
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const level = Number(button.dataset.level);
      const slf = fromBulletin();
      pick({ level, sub: slf?.level === level ? slf.sub : 'neutral' });
    });
  }
  for (const button of subButtons) {
    button.addEventListener('click', () => pick({ level: effective()?.level ?? fallback.level, sub: button.dataset.sub }));
  }

  // The starting settings are read with current(), so they aren't reported through onChange.
  applied = settingsOf(effective());
  render();

  return {
    // The points the bulletin is looked up for: A and B, or the map centre.
    setLocation(latlngs) {
      location = latlngs;
      lookUp();
    },
    // The angle or the whole-slope rule was set by hand under "Erweitert".
    setCustom(values) {
      mode = 'custom';
      applied = values;
      render();
    },
    current: () => applied,
  };
}
