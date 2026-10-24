// The info panel in the bottom left corner: the avalanche danger up top, the detailed
// parameters folded away under "Erweitert".
import { countStoredTiles, clearStoredTiles } from '../data/tile-store.js';
import { createDangerPicker } from './danger.js';

const formatLatLng = (ll) => `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;

export function createPanel({ onReset, onSettingsChange }) {
  const el = (id) => document.getElementById(id);
  el('reset').addEventListener('click', onReset);

  const settings = () => ({
    friction: Math.max(0, Number(el('friction').value) || 0),
    maxSpeedKmh: Math.max(1, Number(el('max-speed').value) || 1),
    maxAngle: Math.min(90, Math.max(0, Number(el('max-angle').value) || 0)),
    goalRadius: Math.max(0, Number(el('goal-radius').value) || 0),
    cliffAngle: Math.min(90, Math.max(0, Number(el('cliff-angle').value) || 0)),
    fallDistance: Math.max(0, Number(el('fall-distance').value) || 0),
    minFallHeight: Math.max(0, Number(el('min-fall-height').value) || 0),
    wholeSlope: el('whole-slope').checked,
    patchSize: Math.max(0, Number(el('patch-size').value) || 0),
    hangAngle: Math.min(90, Math.max(0, Number(el('hang-angle').value) || 0)),
    aspectSplit: Math.min(180, Math.max(0, Number(el('aspect-split').value) || 0)),
  });

  // The danger level sets the max angle and whether the whole Hang counts; changing either
  // by hand overrides the level.
  const applyDanger = ({ maxAngle, wholeSlope }) => {
    el('max-angle').value = maxAngle;
    el('whole-slope').checked = wholeSlope;
  };
  const danger = createDangerPicker({
    onChange: (values) => {
      applyDanger(values);
      onSettingsChange(settings());
    },
  });
  applyDanger(danger.current());
  for (const id of ['max-angle', 'whole-slope']) {
    el(id).addEventListener('change', () => {
      const { maxAngle, wholeSlope } = settings();
      danger.setCustom({ maxAngle, wholeSlope });
    });
  }

  // Snow presets set the friction input; the angle below which skis stop gliding is atan(friction).
  const showFriction = () => {
    const friction = Math.max(0, Number(el('friction').value) || 0);
    el('glide-angle').textContent = (Math.atan(friction) * 180 / Math.PI).toFixed(1);
    const preset = [...el('snow-preset').options].find((o) => o.value && Number(o.value) === friction);
    el('snow-preset').value = preset ? preset.value : '';
  };
  el('friction').addEventListener('input', showFriction);
  el('snow-preset').addEventListener('change', () => {
    el('friction').value = el('snow-preset').value;
    el('friction').dispatchEvent(new Event('change'));
  });
  showFriction();

  for (const id of ['max-angle', 'whole-slope', 'patch-size', 'hang-angle', 'aspect-split', 'friction', 'max-speed', 'goal-radius', 'cliff-angle', 'fall-distance', 'min-fall-height']) {
    el(id).addEventListener('change', () => {
      showFriction();
      onSettingsChange(settings());
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
    showElevationStatus(text) {
      el('elevation-status').textContent = text;
    },
    showRouteStatus(text, progress = null) {
      el('route-status').textContent = text;
      el('route-status').classList.toggle('busy', Boolean(progress));
      el('route-progress').hidden = !progress;
      if (progress) {
        el('route-progress').max = progress.total;
        el('route-progress').value = progress.done;
      }
    },
  };
}
