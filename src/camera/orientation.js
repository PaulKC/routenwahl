// Which way the phone's rear camera looks, from the orientation sensors, as a three.js
// quaternion in a frame with x = east, y = up, z = south (a camera looks along its -z).
//
// Android gives the orientation relative to magnetic north (deviceorientationabsolute).
// iOS gives it relative to where the phone pointed when the page started listening, plus the
// compass heading (webkitCompassHeading); the difference between the two is tracked and
// smoothed, so the gyroscope keeps the view steady and the compass keeps it pointing north.
// Without either the view still turns with the phone, but north is unknown (`absolute` false)
// and the user has to line it up by hand.
// Asks for the sensors where the browser wants that (iOS). Must be called in a tap, before
// anything is awaited, as iOS only asks then. Resolves to whether they may be used.
export function requestOrientationPermission() {
  if (!('DeviceOrientationEvent' in window)) return Promise.resolve(false);
  if (typeof DeviceOrientationEvent.requestPermission !== 'function') return Promise.resolve(true);
  return DeviceOrientationEvent.requestPermission().then((state) => state === 'granted').catch(() => false);
}

export function createOrientation(THREE) {
  const deg = Math.PI / 180;
  const euler = new THREE.Euler();
  const zee = new THREE.Vector3(0, 0, 1);
  const toCamera = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° about x
  const screenTurn = new THREE.Quaternion();
  const northTurn = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const device = new THREE.Quaternion();
  const v = new THREE.Vector3();

  const target = new THREE.Quaternion();
  let have = false;
  let absolute = false;
  let compassSin = 0; // smoothed iOS compass correction, as a unit vector
  let compassCos = 0;
  let lastEvent = 0;

  const screenAngle = () => (screen.orientation?.angle ?? window.orientation ?? 0) * deg;
  const headingOf = (vector) => Math.atan2(vector.x, -vector.z); // clockwise from north (-z)

  const handle = (e) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    lastEvent = performance.now();
    // W3C angles are intrinsic Z-X'-Y''; in three.js's y-up frame that is this YXZ order.
    euler.set(e.beta * deg, e.alpha * deg, -e.gamma * deg, 'YXZ');
    device.setFromEuler(euler);
    target.copy(device).multiply(toCamera).multiply(screenTurn.setFromAxisAngle(zee, -screenAngle()));

    if (Number.isFinite(e.webkitCompassHeading)) {
      // iOS reports the heading of the phone's top edge, or of the rear camera when the phone
      // is held upright (top edge pointing up, so it has no heading).
      const top = v.set(0, 0, -1).applyQuaternion(device);
      const dir = Math.hypot(top.x, top.z) > 0.5 ? top : v.set(0, -1, 0).applyQuaternion(device);
      const correction = e.webkitCompassHeading * deg - headingOf(dir);
      const k = absolute ? 0.05 : 1; // follow slowly: the compass jitters, the gyroscope doesn't
      compassSin += k * (Math.sin(correction) - compassSin);
      compassCos += k * (Math.cos(correction) - compassCos);
      absolute = true;
      // Turning the view clockwise (seen from above) is a negative turn about y.
      target.premultiply(northTurn.setFromAxisAngle(yAxis, -Math.atan2(compassSin, compassCos)));
    } else if (e.type === 'deviceorientationabsolute' || e.absolute) {
      absolute = true;
    }
    have = true;
  };

  const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  let listening = false;

  return {
    // Starts listening once permission (see requestOrientationPermission) is given.
    start(permission) {
      if (listening || !('DeviceOrientationEvent' in window)) return;
      listening = true;
      permission.then((granted) => granted && listening && window.addEventListener(eventName, handle));
    },
    stop() {
      listening = false;
      window.removeEventListener(eventName, handle);
    },
    // The latest orientation, or null if no sensor reading arrived in the last second.
    current() {
      return have && performance.now() - lastEvent < 1000 ? target : null;
    },
    get absolute() {
      return absolute;
    },
  };
}
