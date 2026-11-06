// The info panel in the bottom left corner: the avalanche danger up top, the detailed
// parameters folded away under "Erweitert".
import { countStoredTiles, clearStoredTiles } from '../data/tile-store.js';
import { createDangerPicker } from './danger.js';
import { createZonePicker } from './zone-picker.js';

export function createPanel({ onReset, onSettingsChange, onShowTiles }) {
  const el = (id) => document.getElementById(id);
  el('reset').addEventListener('click', onReset);

  // Debug: tile outlines on the map and their legend entries.
  el('show-tiles').addEventListener('change', () => {
    const show = el('show-tiles').checked;
    document.body.classList.toggle('show-tiles', show);
    onShowTiles(show);
  });

  const zonePicker = createZonePicker({ onChange: () => changed() });

  // The value of a number input, between min and max; empty or invalid counts as 0.
  const number = (id, min = 0, max = Infinity) => Math.min(max, Math.max(min, Number(el(id).value) || 0));
  const angle = (id) => number(id, 0, 90);
  const checked = (id) => el(id).checked;

  // The route's settings from the inputs below; changing any of them recomputes the route.
  const SETTING_INPUTS = [
    'friction', 'max-speed', 'max-angle', 'goal-radius', 'cliff-angle', 'fall-distance', 'min-fall-height',
    'whole-slope', 'patch-size', 'hang-angle', 'rock-angle', 'rib-angle', 'aspect-split', 'show-hangs',
    'outside-max-angle', 'outside-whole-slope', 'show-zone', 'avoid-recommended',
  ];
  const settings = () => ({
    friction: number('friction'),
    maxSpeedKmh: number('max-speed', 1),
    maxAngle: angle('max-angle'),
    goalRadius: number('goal-radius'),
    cliffAngle: angle('cliff-angle'),
    fallDistance: number('fall-distance'),
    minFallHeight: number('min-fall-height'),
    wholeSlope: checked('whole-slope'),
    patchSize: number('patch-size'),
    hangAngle: angle('hang-angle'),
    rockAngle: angle('rock-angle'),
    ribAngle: number('rib-angle', 0, 180),
    aspectSplit: number('aspect-split', 0, 180),
    showHangs: checked('show-hangs'),
    zone: zoneSettings(),
    showZone: checked('show-zone'),
    avoidRecommended: checked('avoid-recommended'),
  });
  // The core zone with the max angle and whole-slope rule outside it, or null if it covers
  // every slope (or the level has nothing lower).
  const zoneSettings = () => {
    const zone = el('core-zone').hidden ? null : zonePicker.value();
    return zone && { ...zone, outsideMaxAngle: angle('outside-max-angle'), outsideWholeSlope: checked('outside-whole-slope') };
  };
  const changed = () => onSettingsChange(settings());

  // The danger level sets the max angle and whether the whole Hang counts; changing either
  // by hand overrides the level.
  const applyDanger = ({ maxAngle, wholeSlope, outsideMaxAngle, outsideWholeSlope }) => {
    el('max-angle').value = maxAngle;
    el('whole-slope').checked = wholeSlope;
    el('outside-max-angle').value = outsideMaxAngle;
    el('outside-whole-slope').checked = outsideWholeSlope;
  };
  const danger = createDangerPicker({
    onChange: (values) => {
      applyDanger(values);
      changed();
    },
    onBulletin: (bulletin) => zonePicker.setBulletin(bulletin?.zone ?? null, bulletin?.zoneText ?? ''),
  });
  applyDanger(danger.current());
  const dangerInputs = ['max-angle', 'whole-slope', 'outside-max-angle', 'outside-whole-slope'];
  for (const id of dangerInputs) {
    el(id).addEventListener('change', () => {
      danger.setCustom({
        maxAngle: angle('max-angle'),
        wholeSlope: checked('whole-slope'),
        outsideMaxAngle: angle('outside-max-angle'),
        outsideWholeSlope: checked('outside-whole-slope'),
      });
    });
  }

  // The snow buttons set the friction input under "Erweitert"; a typed value that matches none
  // leaves them all unpicked. Skis stop gliding below atan(friction).
  const snowButtons = [...el('snow-presets').querySelectorAll('button')];
  const showFriction = () => {
    const friction = number('friction');
    const glide = (Math.atan(friction) * 180 / Math.PI).toFixed(1);
    el('glide-angle').textContent = glide;
    el('snow-glide').textContent = `gleitet ab ${glide}°`;
    for (const button of snowButtons) {
      button.setAttribute('aria-checked', String(Number(button.dataset.friction) === friction));
    }
  };
  el('friction').addEventListener('input', showFriction);
  for (const button of snowButtons) {
    button.addEventListener('click', () => {
      el('friction').value = button.dataset.friction;
      el('friction').dispatchEvent(new Event('change'));
    });
  }
  showFriction();

  for (const id of SETTING_INPUTS) {
    el(id).addEventListener('change', () => {
      showFriction();
      changed();
    });
  }

  const refreshCacheInfo = async () => {
    const count = await countStoredTiles();
    el('clear-cache').textContent = `Höhendaten-Cache leeren (${count} Kacheln)`;
    el('clear-cache').disabled = count === 0;
  };
  el('clear-cache').addEventListener('click', async () => {
    await clearStoredTiles();
    refreshCacheInfo();
  });
  refreshCacheInfo();

  return {
    settings,
    refreshCacheInfo,
    showDangerFor: danger.setLocation,
    // The hint on what to click (or tap, on a touch screen) next.
    showPoints(start, end) {
      const click = window.matchMedia('(pointer: coarse)').matches ? 'Tippe' : 'Klicke';
      el('hint').textContent = !start
        ? `${click} auf die Karte, um den Start zu setzen`
        : !end
          ? `${click} auf die Karte, um das Ziel zu setzen`
          : 'Punkte können verschoben werden';
    },
    // A one-off message in place of the hint, until the points change.
    showMessage(text) {
      el('hint').textContent = text;
    },
    showWildlifeWarning(text) {
      el('wildlife-warning').textContent = text;
    },
    showElevationStatus(text, details = '') {
      el('elevation-status').textContent = text;
      el('elevation-details').textContent = details;
    },
    showRouteStatus(text, progress = null, details = '') {
      el('route-status').textContent = text;
      el('route-details').textContent = details;
      el('route-status').classList.toggle('busy', Boolean(progress));
      el('route-progress').hidden = !progress;
      if (progress) {
        el('route-progress').max = progress.total;
        el('route-progress').value = progress.done;
      }
    },
  };
}
