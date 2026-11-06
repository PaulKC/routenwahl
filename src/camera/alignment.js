// Lining the camera view's overlay up with the real terrain by hand, since compass and GPS are
// only roughly right: dragging turns the view (the overlay follows the finger), two fingers or
// the mouse wheel set the field of view across the long side of the camera image.
export const DEFAULT_FOV = 67; // degrees across the long side of the camera image (typical main camera)
const FOV_KEY = 'skitour-camera-fov';
const deg = Math.PI / 180;

// Returns { yaw, pitch, fov, setFov }: yaw in degrees (positive turns the view left), pitch in
// degrees (positive looks up) and fov in degrees, kept up to date by the gestures on `view`.
// degPerPixel() is how many degrees one screen pixel spans at the moment. The field of view is
// remembered per device; setFov(from, scale) scales the field of view `from` and stores it.
export function createAlignment(view, degPerPixel) {
  const alignment = {
    yaw: 0,
    pitch: 0,
    fov: Number(localStorage.getItem(FOV_KEY)) || DEFAULT_FOV,
    setFov,
  };

  // Spreading the fingers makes the overlay bigger: a narrower field of view.
  function setFov(from, scale) {
    const half = Math.atan(Math.tan((from * deg) / 2) * scale) / deg;
    alignment.fov = Math.max(20, Math.min(120, 2 * half));
    try {
      localStorage.setItem(FOV_KEY, String(alignment.fov));
    } catch {
      // storage blocked: the setting lasts until the view closes
    }
  }

  const pointers = new Map();
  let pinch = null;
  const onDown = (e) => {
    if (e.target.closest('button')) return;
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), fov: alignment.fov };
    }
  };
  const onMove = (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const point = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, point);
    if (pointers.size === 1) {
      // The overlay follows the finger: dragging right turns the view left.
      alignment.yaw += (point.x - last.x) * degPerPixel();
      alignment.pitch = Math.max(-80, Math.min(80, alignment.pitch + (point.y - last.y) * degPerPixel()));
    } else if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      setFov(pinch.fov, pinch.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)));
    }
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    setFov(alignment.fov, Math.exp(e.deltaY * 0.001));
  };
  view.addEventListener('pointerdown', onDown);
  view.addEventListener('pointermove', onMove);
  view.addEventListener('pointerup', onUp);
  view.addEventListener('pointercancel', onUp);
  view.addEventListener('wheel', onWheel, { passive: false });

  return alignment;
}
