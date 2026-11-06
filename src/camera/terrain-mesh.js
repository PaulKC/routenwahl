// The 3D terrain the camera view draws (see ui/camera-view.js): the coloured mesh of the 2 m
// grid around the skier, distance rings and the skyline, cut from a classified area (see
// terrain-area.js). Coordinates are metres in the frame described at makeTerrain.
import { createHeightSampler, computeSkyline, gridNorthOffset, magneticDeclination } from './local-terrain.js';
import { CAMERA, CAMERA_COLORS, ROUTE_CAMERA_COLORS } from '../terrain-classes.js';

export const EYE_HEIGHT = 1.7; // metres above the ground
export const MESH_RADIUS = 250; // metres drawn
export const RINGS = [10, 25, 50, 100, 200]; // distance rings, metres
const deg = Math.PI / 180;

// The 3D terrain around projected (cx, cy), cut from the classified `area`: a mesh of the 2 m
// grid within MESH_RADIUS, the distance rings and the skyline. Where the route on the map
// (`route`, or null) covers the terrain it is coloured like the map: green on the way to B,
// orange for dead ends and so on, and only steep terrain is coloured where the route can't get
// to. Elsewhere it is coloured by class (see classify.js). The frame has its origin at
// (cx, cy) and the ground there (h0): x = east, y = up, z = south, in metres.
export function makeTerrain(THREE, area, cx, cy, route) {
  const { grid, classes, tiles, crs } = area;
  const { west, north, cellSize, width, height } = grid.geometry;
  const { heights } = grid;
  const routeGrid = route?.grid.crs === crs ? route.grid : null;
  let usesRoute = false;
  const heightAtProjected = (x, y) => {
    const cell = grid.cellAtProjected(x, y);
    return cell < 0 ? NaN : heights[cell];
  };
  const h0 = heightAtProjected(cx, cy);
  const group = new THREE.Group();

  // Mesh: one vertex per cell centre within MESH_RADIUS (a square) of the area's grid.
  const reach = Math.ceil(MESH_RADIUS / cellSize);
  const firstRow = Math.max(0, Math.floor((north - cy) / cellSize) - reach);
  const firstCol = Math.max(0, Math.floor((cx - west) / cellSize) - reach);
  const rows = Math.min(height - firstRow, 2 * reach);
  const cols = Math.min(width - firstCol, 2 * reach);
  const positions = new Float32Array(rows * cols * 3);
  const colors = new Uint8Array(rows * cols * 4);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = (firstRow + r) * width + firstCol + c;
      const v = r * cols + c;
      const h = heights[cell];
      const x = west + (firstCol + c + 0.5) * cellSize;
      const y = north - (firstRow + r + 0.5) * cellSize;
      positions[v * 3] = x - cx;
      positions[v * 3 + 1] = Number.isFinite(h) ? h - h0 : 0;
      positions[v * 3 + 2] = cy - y;
      const routeCell = routeGrid ? routeGrid.cellAtProjected(x, y) : -1;
      let color;
      if (routeCell >= 0) {
        usesRoute = true;
        // Out of the route's reach only what is too steep anyway, as on the map nothing.
        color = ROUTE_CAMERA_COLORS[route.mask[routeCell]] ?? (classes[cell] >= CAMERA.TOO_STEEP ? CAMERA_COLORS[classes[cell]] : null);
      } else color = CAMERA_COLORS[classes[cell]];
      if (color) colors.set(color, v * 4);
    }
  }
  const index = [];
  const valid = (r, c) => Number.isFinite(heights[(firstRow + r) * width + firstCol + c]);
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      if (!valid(r, c) || !valid(r, c + 1) || !valid(r + 1, c) || !valid(r + 1, c + 1)) continue;
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
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
  const sample = createHeightSampler(tiles, crs);
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
    crs,
    cx,
    cy,
    h0,
    group,
    downhill: Number.isFinite(downhill) ? downhill : 0,
    usesRoute,
    northOffset: gridNorthOffset(crs, latlng) + magneticDeclination(latlng),
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
