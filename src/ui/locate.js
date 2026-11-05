// "Mein Standort": a button under the zoom buttons that shows the device's position as a dot
// with its accuracy circle and keeps it up to date. The map follows the position until it is
// moved by hand; a tap on the button then centres it again, and a tap while following stops.
// A cone on the dot shows where the phone points (compass), or failing that the direction of
// travel from GPS.
const FOLLOW_ZOOM = 15;
const COLOR = '#1565c0';
const STALE_COLOR = '#9e9e9e'; // the last position, while no new one arrives

export function createLocateControl(map, onError) {
  // The dot sits above the cone, which is a marker (markerPane, z-index 600).
  map.createPane('position').style.zIndex = 620;
  const dot = L.circleMarker([0, 0], {
    radius: 8, color: 'white', weight: 2, fillColor: COLOR, fillOpacity: 1, interactive: false, pane: 'position',
  });
  const accuracy = L.circle([0, 0], {
    radius: 1, color: COLOR, weight: 1, fillOpacity: 0.12, interactive: false,
  });
  // The cone: a marker whose icon is turned to the heading; hidden until one is known.
  const cone = L.marker([0, 0], {
    icon: L.divIcon({ className: 'heading-cone', iconSize: [90, 90], iconAnchor: [45, 45], html: '<span></span>' }),
    interactive: false,
    keyboard: false,
  });
  let compassHeading = null; // degrees from north, from the compass
  let gpsHeading = null; // degrees from north, from GPS while moving
  const compass = createCompass((heading) => {
    compassHeading = heading;
    showHeading();
  });

  const showHeading = () => {
    const heading = compassHeading ?? gpsHeading;
    if (mode === 'off' || !found || heading === null) {
      cone.remove();
      return;
    }
    cone.setLatLng(dot.getLatLng()).addTo(map);
    cone.getElement().firstChild.style.transform = `rotate(${heading}deg)`;
  };

  // 'off', 'free' (dot shown, map moved by hand) or 'follow'
  let mode = 'off';
  let found = false; // a position arrived since tracking started
  let button;

  const setMode = (next) => {
    mode = next;
    button.classList.toggle('active', mode !== 'off');
    button.classList.toggle('following', mode === 'follow');
    button.title = mode === 'follow' ? 'Standort nicht mehr verfolgen' : 'Mein Standort';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(mode === 'follow'));
  };

  const start = () => {
    found = false;
    compass.start(); // in the tap itself: iOS only asks for the compass on a user gesture
    button.classList.add('busy');
    setMode('follow');
    map.locate({ watch: true, setView: false, enableHighAccuracy: true, maximumAge: 5000 });
  };
  const stop = () => {
    map.stopLocate();
    compass.stop();
    compassHeading = gpsHeading = null;
    button.classList.remove('busy');
    dot.remove();
    accuracy.remove();
    cone.remove();
    setMode('off');
  };

  const control = L.control({ position: 'topleft' });
  control.onAdd = () => {
    const bar = L.DomUtil.create('div', 'leaflet-bar locate-control');
    button = L.DomUtil.create('a', 'locate-button', bar);
    button.href = '#';
    button.role = 'button';
    setMode('off');
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(button, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      if (mode === 'off') start();
      else if (mode === 'free') {
        setMode('follow');
        if (found) map.setView(dot.getLatLng(), Math.max(map.getZoom(), FOLLOW_ZOOM));
      } else stop();
    });
    return bar;
  };
  control.addTo(map);

  // Moving the map by hand stops following; the dot keeps updating.
  map.on('dragstart', () => {
    if (mode === 'follow') setMode('free');
  });

  map.on('locationfound', (e) => {
    if (mode === 'off') return;
    button.classList.remove('busy');
    dot.setLatLng(e.latlng).setStyle({ fillColor: COLOR }).addTo(map);
    accuracy.setLatLng(e.latlng).setRadius(e.accuracy).addTo(map);
    if (mode === 'follow') {
      if (found) map.panTo(e.latlng);
      else map.setView(e.latlng, Math.max(map.getZoom(), FOLLOW_ZOOM));
    }
    found = true;
    // Browsers only give a heading while moving (NaN or null when standing still).
    if (Number.isFinite(e.heading) && e.speed > 0.5) gpsHeading = e.heading;
    showHeading();
  });
  // Out in the mountains the signal comes and goes: once a position was found, a lost one only
  // greys the dot until the next fix. Without one yet, or without permission, tracking stops.
  map.on('locationerror', (e) => {
    if (mode === 'off') return;
    if (found && e.code !== 1) {
      dot.setStyle({ fillColor: STALE_COLOR });
      return;
    }
    stop();
    onError(e.code === 1
      ? 'Standort nicht freigegeben: bitte in den Browser-Einstellungen erlauben.'
      : 'Standort nicht verfügbar.');
  });
}

// The compass heading, through onHeading(degrees from north). iOS gives it directly
// (webkitCompassHeading) after asking for permission; other browsers give alpha, the rotation
// from north counterclockwise, on deviceorientationabsolute. Corrected for a phone held sideways.
function createCompass(onHeading) {
  const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;
  const absolute = 'ondeviceorientationabsolute' in window;
  const eventName = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
  const handle = (e) => {
    let heading = null;
    if (Number.isFinite(e.webkitCompassHeading)) heading = e.webkitCompassHeading;
    else if ((absolute || e.absolute) && Number.isFinite(e.alpha)) heading = 360 - e.alpha;
    if (heading !== null) onHeading((heading + screenAngle() + 360) % 360);
  };
  let listening = false;
  return {
    start() {
      if (listening || !('DeviceOrientationEvent' in window)) return;
      listening = true;
      const listen = () => window.addEventListener(eventName, handle);
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
          .then((state) => state === 'granted' && listening && listen())
          .catch(() => {
            // no permission: the cone falls back to the GPS direction
          });
      } else listen();
    },
    stop() {
      listening = false;
      window.removeEventListener(eventName, handle);
    },
  };
}
