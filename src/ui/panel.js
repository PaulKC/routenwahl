// The info panel in the bottom left corner: the avalanche danger up top, the detailed
// parameters folded away under "Erweitert".
import { countStoredTiles, clearStoredTiles } from '../data/tile-store.js';
import { createDangerPicker } from './danger.js';
import { createZonePicker } from './zone-picker.js';

const formatLatLng = (ll) => `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;

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

  const settings = () => ({
    friction: Math.max(0, Number(el('friction').value) || 0),
    maxSpeedKmh: Math.max(1, Number(el('max-speed').value) || 1),
    maxAngle: angleOf('max-angle'),
    goalRadius: Math.max(0, Number(el('goal-radius').value) || 0),
    cliffAngle: Math.min(90, Math.max(0, Number(el('cliff-angle').value) || 0)),
    fallDistance: Math.max(0, Number(el('fall-distance').value) || 0),
    minFallHeight: Math.max(0, Number(el('min-fall-height').value) || 0),
    wholeSlope: el('whole-slope').checked,
    patchSize: Math.max(0, Number(el('patch-size').value) || 0),
    hangAngle: Math.min(90, Math.max(0, Number(el('hang-angle').value) || 0)),
    rockAngle: Math.min(90, Math.max(0, Number(el('rock-angle').value) || 0)),
    ribAngle: Math.min(180, Math.max(0, Number(el('rib-angle').value) || 0)),
    aspectSplit: Math.min(180, Math.max(0, Number(el('aspect-split').value) || 0)),
    showHangs: el('show-hangs').checked,
    zone: zoneSettings(),
    showZone: el('show-zone').checked,
  });
  const angleOf = (id) => Math.min(90, Math.max(0, Number(el(id).value) || 0));
  // The core zone with the max angle and whole-slope rule outside it, or null if it covers
  // every slope (or the level has nothing lower).
  const zoneSettings = () => {
    const zone = el('core-zone').hidden ? null : zonePicker.value();
    return zone && { ...zone, outsideMaxAngle: angleOf('outside-max-angle'), outsideWholeSlope: el('outside-whole-slope').checked };
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
        maxAngle: angleOf('max-angle'),
        wholeSlope: el('whole-slope').checked,
        outsideMaxAngle: angleOf('outside-max-angle'),
        outsideWholeSlope: el('outside-whole-slope').checked,
      });
    });
  }

  // The snow buttons set the friction input under "Erweitert"; a typed value that matches none
  // leaves them all unpicked. Skis stop gliding below atan(friction).
  const snowButtons = [...el('snow-presets').querySelectorAll('button')];
  const showFriction = () => {
    const friction = Math.max(0, Number(el('friction').value) || 0);
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

  for (const id of [...dangerInputs, 'show-zone', 'patch-size', 'hang-angle', 'rock-angle', 'rib-angle', 'aspect-split', 'show-hangs', 'friction', 'max-speed', 'goal-radius', 'cliff-angle', 'fall-distance', 'min-fall-height']) {
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
    showPoints(start, end) {
      el('start-coords').textContent = start ? formatLatLng(start) : '–';
      el('end-coords').textContent = end ? formatLatLng(end) : '–';
      el('hint').textContent = !start
        ? 'Klicke auf die Karte, um den Start zu setzen'
        : !end
          ? 'Klicke auf die Karte, um das Ziel zu setzen'
          : 'Punkte können verschoben werden';
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
