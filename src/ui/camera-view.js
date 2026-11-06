// Camera view: the live camera image with the terrain in front of the skier coloured by
// whether it can be skied (same rules as the route, see camera/classify.js). The terrain is
// drawn in 3D with three.js from the skier's eye, placed by GPS and turned by the phone's
// orientation sensors, so the colours lie on the slopes in the picture.
//
// It is made for the near terrain (about 5 to 200 m) and uses the full 2 m elevation grid
// there, with distance rings to judge how far away a colour is. GPS and compass are only
// roughly right, so dragging moves the overlay onto the real terrain (the yellow skyline helps
// at a distance), and two fingers (or the mouse wheel) set the camera's field of view.
//
// Only elevation tiles already in the browser are used, never downloaded. Without a GPS
// fix (e.g. on a laptop) the view stands at A, or the map centre, and dragging looks around;
// ?cam=lat,lng[,heading[,pitch]] in the address puts it at a given point, looking that way.
//
// The parts live in src/camera: terrain-area.js classifies the terrain around the skier,
// terrain-mesh.js draws it, alignment.js handles dragging and pinching, orientation.js the
// sensors. This file opens and closes the view and runs the render loop.
import { toProjected } from '../data/projection.js';
import { createOrientation, requestOrientationPermission } from '../camera/orientation.js';
import { createAreaClassifier, areaCovers } from '../camera/terrain-area.js';
import { makeTerrain, EYE_HEIGHT, RINGS } from '../camera/terrain-mesh.js';
import { createAlignment, DEFAULT_FOV } from '../camera/alignment.js';
import { GREEN, PURPLE, ORANGE, RED, DARK } from '../terrain-classes.js';

export const THREE_URL = 'https://unpkg.com/three@0.169.0/build/three.module.min.js';

const RECENTRE_DISTANCE = 20; // metres moved before the drawn part is cut again
const MAX_GPS_ACCURACY = 100; // metres: coarser fixes (e.g. a laptop's Wi-Fi guess) aren't used
const deg = Math.PI / 180;
const rgb = ([r, g, b]) => `rgb(${r} ${g} ${b})`;

// A button under "Mein Standort" that opens the camera view. settings() gives the panel's
// current settings, route() the route on the map ({ mask, grid } or null) and
// fallbackPosition() a { latlng, label } to stand at without GPS.
export function createCameraControl(map, { settings, route, fallbackPosition }) {
  const control = L.control({ position: 'topleft' });
  control.onAdd = () => {
    const bar = L.DomUtil.create('div', 'leaflet-bar camera-control');
    const button = L.DomUtil.create('a', 'camera-button', bar);
    button.href = '#';
    button.role = 'button';
    button.title = 'Kamera: fahrbares Gelände im Bild';
    button.setAttribute('aria-label', button.title);
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(button, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      openCameraView({ settings: settings(), route: route(), fallback: fallbackPosition() });
    });
    return bar;
  };
  control.addTo(map);
}

let open = false;

function openCameraView({ settings, route, fallback }) {
  if (open) return;
  open = true;
  // Both asked for in the tap itself, before anything is awaited (iOS needs that).
  const permission = requestOrientationPermission();
  const phone = matchMedia('(pointer: coarse)').matches;
  const stream = phone && navigator.mediaDevices?.getUserMedia
    ? navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).catch(() => null)
    : Promise.resolve(null);

  const view = document.createElement('div');
  view.className = 'camera-view';
  view.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="camera-labels"></div>
    <div class="camera-bar">
      <button type="button" class="camera-close" aria-label="Kamera schliessen">✕</button>
      <div class="camera-status" role="status">Wird geladen…</div>
      <button type="button" class="camera-terrain" aria-pressed="${!phone}" title="Gelände grau zeigen">Gelände</button>
      <button type="button" class="camera-reset" title="Ausrichtung und Bildwinkel zurücksetzen">↺</button>
    </div>
    <div class="camera-legend">
      <span><i style="background: ${rgb(GREEN)}"></i>Fahrbar</span>
      <span><i style="background: ${rgb(PURPLE)}"></i>Exponiert</span>
      <span class="camera-dead-end" hidden><i style="background: ${rgb(ORANGE)}"></i>Sackgasse</span>
      <span><i style="background: ${rgb(RED)}"></i>Zu steil</span>
      <span><i style="background: ${rgb(DARK)}"></i>Absturz</span>
    </div>
    <div class="camera-hint">Ziehen: Bild auf das Gelände schieben · Zwei Finger: Bildwinkel</div>`;
  document.body.append(view);
  const video = view.querySelector('video');
  const status = view.querySelector('.camera-status');
  const labels = view.querySelector('.camera-labels');

  let close = () => {
    view.remove();
    open = false;
    stream.then((s) => s?.getTracks().forEach((track) => track.stop()));
  };
  view.querySelector('.camera-close').addEventListener('click', () => close());

  import(THREE_URL)
    .then((THREE) => {
      if (!open) return;
      close = startScene(THREE, { view, video, status, labels, stream, permission, settings, route, fallback, close });
    })
    .catch((err) => {
      status.textContent = `3D-Bibliothek konnte nicht geladen werden (${err.message})`;
    });
}

function startScene(THREE, { view, video, status, labels, stream, permission, settings, route, fallback, close: closeView }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  view.insertBefore(renderer.domElement, labels);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 8000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-1, 2, -1); // light from the north-west, like a hillshade
  scene.add(sun);

  let hasVideo = false;
  stream.then((s) => {
    if (!s) return;
    video.srcObject = s;
    video.play().catch(() => {});
    hasVideo = true;
    view.classList.add('with-video');
  });

  const orientation = createOrientation(THREE);
  orientation.start(permission);

  // --- State -------------------------------------------------------------------------------
  const params = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
  const forced = params?.length >= 2 && params.every(Number.isFinite)
    ? { latlng: { lat: params[0], lng: params[1] }, label: 'Testpunkt', heading: params[2], pitch: params[3] } : null;
  let position = null; // { latlng, accuracy, label }
  let terrain = null; // the drawn part, see makeTerrain
  let area = null; // the classified square, see terrain-area.js
  const areas = createAreaClassifier(settings);
  let building = false;
  // Turned and zoomed by hand on top of the sensors: { yaw, pitch, fov }, see alignment.js.
  const alignment = createAlignment(view, () => camera.fov / view.clientHeight);
  let headingSet = false; // the initial view direction without sensors has been chosen
  let message = '';
  const smoothed = new THREE.Vector3(); // camera position in the terrain's frame
  const shown = new THREE.Quaternion(); // sensor orientation, smoothed
  let shownValid = false;

  // --- Position ----------------------------------------------------------------------------
  const useFallback = () => {
    if (position) return;
    const at = forced ?? fallback;
    setPosition({ latlng: at.latlng, accuracy: null, label: at.label });
  };
  let watch = null;
  if (forced) useFallback();
  else if ('geolocation' in navigator) {
    watch = navigator.geolocation.watchPosition((p) => {
      if (p.coords.accuracy > MAX_GPS_ACCURACY) {
        useFallback();
        return;
      }
      setPosition({ latlng: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracy: p.coords.accuracy, label: 'GPS' });
    }, useFallback, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
    setTimeout(useFallback, 4000); // no fix yet: stand at the fallback until one arrives
  } else useFallback();

  function setPosition(next) {
    // A test position (no GPS) is replaced by the first GPS fix, never the other way round.
    if (position?.label === 'GPS' && next.label !== 'GPS') return;
    position = next;
    if (!terrain || terrain.crs && distanceFromCentre() > RECENTRE_DISTANCE) buildTerrain();
  }
  const projected = () => toProjected(terrain.crs, position.latlng);
  const distanceFromCentre = () => {
    const { x, y } = projected();
    return Math.hypot(x - terrain.cx, y - terrain.cy);
  };

  // --- Terrain -----------------------------------------------------------------------------
  // Cuts the drawn part around the current position out of `area`, classifying a new area
  // first if the position is near its edge. Without tiles here the old area is kept (and the
  // message says so).
  async function buildTerrain() {
    if (building) return;
    building = true;
    const at = position.latlng;
    try {
      let here = area && toProjected(area.crs, at);
      if (!areaCovers(area, here?.x, here?.y)) {
        status.textContent = 'Gelände wird berechnet…';
        const t0 = performance.now();
        const next = await areas.classifyAround(at);
        if (next) area = next;
        else message = 'Keine Höhendaten hier. Erst zu Hause eine Route in dieser Gegend berechnen, dann sind sie gespeichert.';
        if (!area) {
          terrain ??= { crs: null };
          return;
        }
        console.info(`Kamera: Gelände klassiert in ${Math.round(performance.now() - t0)} ms`);
        here = toProjected(area.crs, at);
      }
      const next = makeTerrain(THREE, area, here.x, here.y, route);
      view.querySelector('.camera-dead-end').hidden = !next.usesRoute;
      if (terrain?.group) {
        scene.remove(terrain.group);
        terrain.dispose();
      }
      terrain = next;
      scene.add(terrain.group);
      terrain.setShaded(view.querySelector('.camera-terrain').getAttribute('aria-pressed') === 'true');
      message = '';
      if (!headingSet) {
        headingSet = true;
        // Without sensors look downhill (or as given), slightly down.
        if (!orientation.current()) {
          alignment.yaw = -(forced?.heading ?? terrain.downhill);
          alignment.pitch = forced?.pitch ?? -12;
        }
      }
      smoothed.copy(terrain.eyeAt(here.x, here.y) ?? smoothed);
    } catch (err) {
      message = `Gelände: Fehler (${err.message})`;
      console.error(err);
    } finally {
      building = false;
      if (position && terrain?.crs && distanceFromCentre() > RECENTRE_DISTANCE) buildTerrain();
    }
  }

  // --- Buttons -----------------------------------------------------------------------------
  const terrainButton = view.querySelector('.camera-terrain');
  terrainButton.addEventListener('click', () => {
    const on = terrainButton.getAttribute('aria-pressed') !== 'true';
    terrainButton.setAttribute('aria-pressed', String(on));
    terrain?.setShaded?.(on);
  });
  view.querySelector('.camera-reset').addEventListener('click', () => {
    alignment.yaw = orientation.current() ? 0 : -(forced?.heading ?? terrain?.downhill ?? 0);
    alignment.pitch = orientation.current() ? 0 : -12;
    alignment.setFov(DEFAULT_FOV, 1);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') stop();
  };
  document.addEventListener('keydown', onKey);

  // --- Drawing -----------------------------------------------------------------------------
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const turn = new THREE.Quaternion();
  const north = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const ringPoint = new THREE.Vector3();
  const labelEls = RINGS.map((r) => {
    const el = document.createElement('span');
    el.textContent = `${r} m`;
    labels.append(el);
    return el;
  });
  let frame = requestAnimationFrame(draw);

  function draw() {
    frame = requestAnimationFrame(draw);
    const width = view.clientWidth;
    const height = view.clientHeight;
    const canvas = renderer.domElement;
    if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height);
    }
    camera.aspect = width / height;
    // The field of view spans the long side of the camera image, shown cropped to fill the
    // screen (object-fit: cover); without video the screen is the image.
    const [imageW, imageH] = hasVideo && video.videoWidth ? [video.videoWidth, video.videoHeight] : [width, height];
    const focal = Math.max(imageW, imageH) / 2 / Math.tan((alignment.fov * deg) / 2); // in image pixels
    const scale = Math.max(width / imageW, height / imageH);
    camera.fov = (2 * Math.atan(height / 2 / (focal * scale))) / deg;
    camera.updateProjectionMatrix();

    const sensor = orientation.current();
    if (sensor) {
      if (shownValid) shown.slerp(sensor, 0.3);
      else shown.copy(sensor);
      shownValid = true;
    }
    camera.quaternion.setFromAxisAngle(yAxis, alignment.yaw * deg);
    if (sensor && orientation.absolute && terrain?.northOffset !== undefined) {
      // The sensors point to magnetic north, the terrain's frame to its grid's north.
      camera.quaternion.multiply(north.setFromAxisAngle(yAxis, -terrain.northOffset * deg));
    }
    if (sensor) camera.quaternion.multiply(shown);
    camera.quaternion.multiply(turn.setFromAxisAngle(xAxis, alignment.pitch * deg));

    if (terrain?.group && position) {
      const { x, y } = projected();
      const eye = terrain.eyeAt(x, y);
      if (eye) smoothed.lerp(eye, 0.2);
      camera.position.copy(smoothed);
    }
    renderer.render(scene, camera);
    placeLabels(width, height);
    showStatus(sensor);
  }

  // Each ring's distance is written where it crosses the middle of the view.
  function placeLabels(width, height) {
    camera.getWorldDirection(forward);
    const az = Math.atan2(forward.x, -forward.z);
    RINGS.forEach((r, i) => {
      const el = labelEls[i];
      const h = terrain?.heightAtLocal?.(camera.position.x + r * Math.sin(az), camera.position.z - r * Math.cos(az));
      if (!Number.isFinite(h)) {
        el.hidden = true;
        return;
      }
      ringPoint.set(camera.position.x + r * Math.sin(az), h + 0.5, camera.position.z - r * Math.cos(az)).project(camera);
      el.hidden = ringPoint.z > 1 || Math.abs(ringPoint.x) > 1 || Math.abs(ringPoint.y) > 1;
      el.style.transform = `translate(${((ringPoint.x + 1) / 2) * width}px, ${((1 - ringPoint.y) / 2) * height}px)`;
    });
  }

  let lastStatus = '';
  function showStatus(sensor) {
    let text;
    if (message) text = message;
    else if (!position) text = 'Position wird gesucht…';
    else if (!terrain?.group) text = 'Gelände wird berechnet…';
    else {
      const where = position.label === 'GPS' ? `GPS ±${Math.round(position.accuracy)} m` : position.label;
      const heading = !sensor ? 'kein Lagesensor' : orientation.absolute ? 'Kompass' : 'kein Kompass';
      text = `${where} · ${Math.round(terrain.h0 + camera.position.y - EYE_HEIGHT)} m · ${heading}`;
    }
    if (text !== lastStatus) status.textContent = lastStatus = text;
  }

  function stop() {
    cancelAnimationFrame(frame);
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    orientation.stop();
    document.removeEventListener('keydown', onKey);
    terrain?.dispose?.();
    renderer.dispose();
    renderer.forceContextLoss();
    areas.terminate();
    closeView();
  }
  return stop;
}
