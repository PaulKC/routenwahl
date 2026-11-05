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
import { decodedTiles, storedSwissTilesAround } from '../data/elevation-data.js';
import { toProjected } from '../data/projection.js';
import {
  tileAt, cropGrid, createHeightSampler, computeSkyline, gridNorthOffset, magneticDeclination,
} from '../camera/local-terrain.js';
import { classifyCells, SKIABLE, EXPOSED, TOO_STEEP, CLIFF } from '../camera/classify.js';
import { createOrientation, requestOrientationPermission } from '../camera/orientation.js';

export const THREE_URL = 'https://unpkg.com/three@0.169.0/build/three.module.min.js';

const EYE_HEIGHT = 2.7; // metres above the ground
const GRID_RADIUS = 400; // metres classified around the skier: Hänge and cliffs need context
const MESH_RADIUS = 250; // metres drawn
const STORED_RADIUS = 1500; // metres around the skier taken from the tile store
const RECENTRE_DISTANCE = 40; // metres moved before the terrain is cut again
const RINGS = [10, 25, 50, 100, 200]; // distance rings, metres
const MAX_GPS_ACCURACY = 100; // metres: coarser fixes (e.g. a laptop's Wi-Fi guess) aren't used
const DEFAULT_FOV = 67; // degrees across the long side of the camera image (typical main camera)
const FOV_KEY = 'skitour-camera-fov';
const COLORS = {
  [SKIABLE]: [46, 125, 50, 95],
  [EXPOSED]: [156, 39, 176, 140],
  [TOO_STEEP]: [229, 57, 53, 125],
  [CLIFF]: [33, 33, 33, 170],
};
const deg = Math.PI / 180;

// A button under "Mein Standort" that opens the camera view. settings() gives the panel's
// current settings, fallbackPosition() a { latlng, label } to stand at without GPS.
export function createCameraControl(map, { settings, fallbackPosition }) {
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
      openCameraView({ settings: settings(), fallback: fallbackPosition() });
    });
    return bar;
  };
  control.addTo(map);
}

let open = false;

function openCameraView({ settings, fallback }) {
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
      <span><i style="background: rgb(46 125 50)"></i>Fahrbar</span>
      <span><i style="background: rgb(156 39 176)"></i>Exponiert</span>
      <span><i style="background: rgb(229 57 53)"></i>Zu steil</span>
      <span><i style="background: rgb(33 33 33)"></i>Absturz</span>
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
      close = startScene(THREE, { view, video, status, labels, stream, permission, settings, fallback, close });
    })
    .catch((err) => {
      status.textContent = `3D-Bibliothek konnte nicht geladen werden (${err.message})`;
    });
}

function startScene(THREE, { view, video, status, labels, stream, permission, settings, fallback, close: closeView }) {
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
  let terrain = null; // see buildTerrain
  let building = false;
  let yawOffset = 0; // degrees, set by dragging (positive turns the view left)
  let pitchOffset = 0; // degrees (positive looks up)
  let headingSet = false; // the initial view direction without sensors has been chosen
  let fovLong = Number(localStorage.getItem(FOV_KEY)) || DEFAULT_FOV;
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
  async function buildTerrain() {
    if (building) return;
    building = true;
    const at = position.latlng;
    status.textContent = 'Gelände wird berechnet…';
    try {
      const stored = await storedSwissTilesAround(at, STORED_RADIUS).catch(() => []);
      const urls = new Set();
      const tiles = [...decodedTiles(), ...stored].filter((t) => !urls.has(t.url) && urls.add(t.url));
      const hit = tileAt(tiles, at);
      if (!hit) {
        message = 'Keine Höhendaten hier. Erst zu Hause eine Route in dieser Gegend berechnen, dann sind sie gespeichert.';
        terrain ??= { crs: null };
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 30)); // let the status show first
      const next = makeTerrain(THREE, tiles, hit, settings);
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
          yawOffset = -(forced?.heading ?? terrain.downhill);
          pitchOffset = forced?.pitch ?? -12;
        }
      }
      smoothed.copy(terrain.eyeAt(hit.x, hit.y));
    } catch (err) {
      message = `Gelände: Fehler (${err.message})`;
      console.error(err);
    } finally {
      building = false;
      if (position && terrain?.crs && distanceFromCentre() > RECENTRE_DISTANCE) buildTerrain();
    }
  }

  // --- Interaction -------------------------------------------------------------------------
  const pointers = new Map();
  let pinch = null;
  const degPerPixel = () => camera.fov / view.clientHeight;
  const onDown = (e) => {
    if (e.target.closest('button')) return;
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), fov: fovLong };
    }
  };
  const onMove = (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const point = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, point);
    if (pointers.size === 1) {
      // The overlay follows the finger: dragging right turns the view left.
      yawOffset += (point.x - last.x) * degPerPixel();
      pitchOffset = Math.max(-80, Math.min(80, pitchOffset + (point.y - last.y) * degPerPixel()));
    } else if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      setFov(pinch.fov, pinch.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)));
    }
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  // Spreading the fingers makes the overlay bigger: a narrower field of view.
  const setFov = (from, scale) => {
    const half = Math.atan(Math.tan((from * deg) / 2) * scale) / deg;
    fovLong = Math.max(20, Math.min(120, 2 * half));
    try {
      localStorage.setItem(FOV_KEY, String(fovLong));
    } catch {
      // storage blocked: the setting lasts until the view closes
    }
  };
  const onWheel = (e) => {
    e.preventDefault();
    setFov(fovLong, Math.exp(e.deltaY * 0.001));
  };
  view.addEventListener('pointerdown', onDown);
  view.addEventListener('pointermove', onMove);
  view.addEventListener('pointerup', onUp);
  view.addEventListener('pointercancel', onUp);
  view.addEventListener('wheel', onWheel, { passive: false });
  const terrainButton = view.querySelector('.camera-terrain');
  terrainButton.addEventListener('click', () => {
    const on = terrainButton.getAttribute('aria-pressed') !== 'true';
    terrainButton.setAttribute('aria-pressed', String(on));
    terrain?.setShaded?.(on);
  });
  view.querySelector('.camera-reset').addEventListener('click', () => {
    yawOffset = orientation.current() ? 0 : -(forced?.heading ?? terrain?.downhill ?? 0);
    pitchOffset = orientation.current() ? 0 : -12;
    setFov(DEFAULT_FOV, 1);
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
    const focal = Math.max(imageW, imageH) / 2 / Math.tan((fovLong * deg) / 2); // in image pixels
    const scale = Math.max(width / imageW, height / imageH);
    camera.fov = (2 * Math.atan(height / 2 / (focal * scale))) / deg;
    camera.updateProjectionMatrix();

    const sensor = orientation.current();
    if (sensor) {
      if (shownValid) shown.slerp(sensor, 0.3);
      else shown.copy(sensor);
      shownValid = true;
    }
    camera.quaternion.setFromAxisAngle(yAxis, yawOffset * deg);
    if (sensor && orientation.absolute && terrain?.northOffset !== undefined) {
      // The sensors point to magnetic north, the terrain's frame to its grid's north.
      camera.quaternion.multiply(north.setFromAxisAngle(yAxis, -terrain.northOffset * deg));
    }
    if (sensor) camera.quaternion.multiply(shown);
    camera.quaternion.multiply(turn.setFromAxisAngle(xAxis, pitchOffset * deg));

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
    closeView();
  }
  return stop;
}

// The 3D terrain around the tile hit `hit` ({ tile, x, y }): a mesh of the 2 m grid within
// MESH_RADIUS, coloured by class, the distance rings and the skyline. The frame has its origin
// at (cx, cy) and the ground there (h0): x = east, y = up, z = south, in metres.
function makeTerrain(THREE, tiles, hit, settings) {
  const { tile, x: cx, y: cy } = hit;
  const grid = cropGrid(tiles, tile, cx, cy, GRID_RADIUS);
  const classes = classifyCells(grid, settings);
  const { west, north, cellSize, width } = grid.geometry;
  const { heights } = grid;
  const heightAtProjected = (x, y) => {
    const cell = grid.cellAtProjected(x, y);
    return cell < 0 ? NaN : heights[cell];
  };
  const h0 = heightAtProjected(cx, cy);
  const group = new THREE.Group();

  // Mesh: one vertex per cell centre within MESH_RADIUS (a square).
  const first = Math.max(0, Math.floor((GRID_RADIUS - MESH_RADIUS) / cellSize));
  const count = Math.min(width - first, Math.ceil((2 * MESH_RADIUS) / cellSize));
  const positions = new Float32Array(count * count * 3);
  const colors = new Uint8Array(count * count * 4);
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      const cell = (first + r) * width + first + c;
      const v = r * count + c;
      const h = heights[cell];
      positions[v * 3] = west + (first + c + 0.5) * cellSize - cx;
      positions[v * 3 + 1] = Number.isFinite(h) ? h - h0 : 0;
      positions[v * 3 + 2] = cy - (north - (first + r + 0.5) * cellSize);
      const color = COLORS[classes[cell]];
      if (color) colors.set(color, v * 4);
    }
  }
  const index = [];
  const valid = (r, c) => Number.isFinite(heights[(first + r) * width + first + c]);
  for (let r = 0; r < count - 1; r += 1) {
    for (let c = 0; c < count - 1; c += 1) {
      if (!valid(r, c) || !valid(r, c + 1) || !valid(r + 1, c) || !valid(r + 1, c + 1)) continue;
      const a = r * count + c;
      const b = a + 1;
      const d = a + count;
      const e = d + 1;
      index.push(a, d, b, b, d, e); // counterclockwise seen from above
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
  geometry.setIndex(index.length > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geometry.computeVertexNormals();

  // Drawn twice: first only into the depth buffer, so the colours of terrain hidden behind a
  // ridge or a bump don't show through, then the colours on top. With "Gelände" on, the first
  // pass draws the terrain grey and shaded instead.
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const shaded = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
  const base = new THREE.Mesh(geometry, depthOnly);
  base.renderOrder = 0;
  const colored = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  colored.renderOrder = 1;
  group.add(base, colored);

  // Distance rings around the centre of the terrain, a little above the ground, as segments
  // that skip where there is no data.
  const ringPoints = [];
  for (const radius of RINGS) {
    const steps = Math.max(48, Math.round(radius * 2));
    let previous = null;
    for (let i = 0; i <= steps; i += 1) {
      const az = (i / steps) * 2 * Math.PI;
      const px = cx + radius * Math.sin(az);
      const py = cy + radius * Math.cos(az);
      const h = heightAtProjected(px, py);
      const point = Number.isFinite(h) ? [px - cx, h - h0 + 0.3, cy - py] : null;
      if (point && previous) ringPoints.push(...previous, ...point);
      previous = point;
    }
  }
  const ringGeometry = new THREE.BufferGeometry();
  ringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ringPoints, 3));
  const rings = new THREE.LineSegments(ringGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  rings.renderOrder = 2;
  group.add(rings);

  // Skyline from the eye at the centre, drawn far away and on top of everything.
  const sample = createHeightSampler(tiles, tile.crs);
  const skyline = computeSkyline(sample, cx, cy, h0 + EYE_HEIGHT);
  const skyPoints = [];
  const far = 3000;
  const skyPoint = (i) => {
    const angle = skyline[i % skyline.length];
    if (!Number.isFinite(angle)) return null;
    const az = ((i % skyline.length) / skyline.length) * 2 * Math.PI;
    return [far * Math.cos(angle) * Math.sin(az), EYE_HEIGHT + far * Math.sin(angle), -far * Math.cos(angle) * Math.cos(az)];
  };
  for (let i = 0; i < skyline.length; i += 1) {
    const a = skyPoint(i);
    const b = skyPoint(i + 1);
    if (a && b) skyPoints.push(...a, ...b);
  }
  const skyGeometry = new THREE.BufferGeometry();
  skyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(skyPoints, 3));
  const sky = new THREE.LineSegments(skyGeometry, new THREE.LineBasicMaterial({ color: 0xffeb3b, depthTest: false, transparent: true, opacity: 0.9 }));
  sky.renderOrder = 3;
  group.add(sky);

  // Downhill direction at the centre, clockwise from grid north, for the first view without sensors.
  const { dzdx, dzdy } = grid.gradients();
  const centreCell = grid.cellAtProjected(cx, cy);
  const downhill = (Math.atan2(-dzdx[centreCell], dzdy[centreCell]) / deg + 360) % 360;
  const latlng = grid.latLngOf(centreCell);

  return {
    crs: tile.crs,
    cx,
    cy,
    h0,
    group,
    downhill: Number.isFinite(downhill) ? downhill : 0,
    northOffset: gridNorthOffset(tile.crs, latlng) + magneticDeclination(latlng),
    // Eye position in this frame above projected (x, y), or null without data there.
    eyeAt(x, y) {
      const h = heightAtProjected(x, y);
      return Number.isFinite(h) ? new THREE.Vector3(x - cx, h - h0 + EYE_HEIGHT, cy - y) : null;
    },
    // Ground height in this frame at frame coordinates (x, z).
    heightAtLocal: (x, z) => heightAtProjected(cx + x, cy - z) - h0,
    setShaded(on) {
      base.material = on ? shaded : depthOnly;
    },
    dispose() {
      for (const object of [base, colored, rings, sky]) {
        object.geometry.dispose();
        object.material.dispose();
      }
      depthOnly.dispose();
      shaded.dispose();
    },
  };
}
