// What each cell of the terrain is, and the colour it is drawn in. The route and the camera
// view sort cells differently, so each has its own values; the colours are shared so the map
// and the camera image look alike. Plain data: used by the workers too.

// Values in the route's mask (routing/downhill.js, routing/compute-route.js); 0 = not reached.
export const ROUTE = Object.freeze({
  REACHABLE: 1, // reachable from A, but B can't be reached from there (dead end)
  CORRIDOR: 2, // on at least one feasible route from A to B
  EXPOSED: 3, // corridor cell whose fall line runs into a cliff
  HANG_TOO_STEEP: 4, // reachable by its own slope, but its Hang is too steep
});

// Classes of the camera view (camera/classify.js); 0 = no data.
export const CAMERA = Object.freeze({
  SKIABLE: 1,
  EXPOSED: 2, // skiable, but a fall there runs into a cliff
  TOO_STEEP: 3, // steeper than the max angle, or its Hang is
  CLIFF: 4, // as steep as the cliff angle or steeper
});

// [r, g, b]; the legend in index.html and style.css uses the same colours.
export const GREEN = [46, 125, 50]; // skiable, on the way to B
export const PURPLE = [156, 39, 176]; // exposed
export const ORANGE = [255, 152, 0]; // dead end
export const RED = [229, 57, 53]; // too steep
export const DARK = [33, 33, 33]; // cliff

// [r, g, b, alpha 0-255] per route mask value, as drawn on the map.
export const ROUTE_MAP_COLORS = {
  [ROUTE.REACHABLE]: [...ORANGE, 90],
  [ROUTE.CORRIDOR]: [...GREEN, 150],
  [ROUTE.EXPOSED]: [...PURPLE, 170],
  [ROUTE.HANG_TOO_STEEP]: [...RED, 110],
};

// [r, g, b, alpha] per camera class, as laid over the camera image.
export const CAMERA_COLORS = {
  [CAMERA.SKIABLE]: [...GREEN, 95],
  [CAMERA.EXPOSED]: [...PURPLE, 140],
  [CAMERA.TOO_STEEP]: [...RED, 125],
  [CAMERA.CLIFF]: [...DARK, 170],
};

// The route's mask values in the camera view: like on the map, at the camera's strength.
export const ROUTE_CAMERA_COLORS = {
  [ROUTE.CORRIDOR]: CAMERA_COLORS[CAMERA.SKIABLE],
  [ROUTE.EXPOSED]: CAMERA_COLORS[CAMERA.EXPOSED],
  [ROUTE.REACHABLE]: [...ORANGE, 120],
  [ROUTE.HANG_TOO_STEEP]: CAMERA_COLORS[CAMERA.TOO_STEEP],
};
