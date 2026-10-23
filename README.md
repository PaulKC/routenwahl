# Skitour Webapp

Webapp that shows possible ski descents whose slope stays below a user-selected
threshold (e.g. max 30°), displayed on a map. A phone camera overlay (AR view)
may follow later.

## Status

Map page (Leaflet + swisstopo). Click to set start (A) and end (B); the app then
downloads the swissALTI3D 2 m elevation GeoTIFFs covering A–B plus 1.5 km margin
from the swisstopo STAC API (data.geo.admin.ch) and outlines them on the map.
It then finds every route from A to B on the 2 m grid that a skier can ride while
carrying speed: speed is tracked as energy (v^2/2g), gained by losing height, lost to
friction, capped at a max speed (default friction 0.07, 20 km/h). Cells whose
terrain slope is steeper than the max angle (default 30°) are excluded. B is a target
zone (default radius 25 m): arriving anywhere inside it counts.
Exposed corridor cells are shown in purple: following the fall line from there for
75 m (further while it is 30° or steeper) runs into a cliff, i.e. terrain of 45°
or steeper dropping at least 10 m, with gentler gaps of up to 10 m bridged
(distance, angle and height adjustable). Green = corridor of
all feasible routes, blue = safest route (avoids exposed cells if possible, otherwise as little exposure as possible; then gentlest steepest point, then gentle and short), orange = reachable from
A but no way on to B.

## Run locally

No build step. Serve the folder with any static server, e.g.:

```bash
python -m http.server 8765
```

Then open http://localhost:8765. The map uses Leaflet with swisstopo base maps
(Landeskarte, Winterlandeskarte), OpenTopoMap, and swisstopo's "slope > 30°" overlay.
