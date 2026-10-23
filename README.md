# Skitour Webapp

Webapp that shows possible ski descents whose slope stays below a user-selected
threshold (e.g. max 30°), displayed on a map. A phone camera overlay (AR view)
may follow later.

## Status

Map page (Leaflet + swisstopo). Click to set start (A) and end (B); the app then
downloads the swissALTI3D 2 m elevation GeoTIFFs covering A–B plus 500 m margin
from the swisstopo STAC API (data.geo.admin.ch) and outlines them on the map.

## Run locally

No build step. Serve the folder with any static server, e.g.:

```bash
python -m http.server 8765
```

Then open http://localhost:8765. The map uses Leaflet with swisstopo base maps
(Landeskarte, Winterlandeskarte), OpenTopoMap, and swisstopo's "slope > 30°" overlay.
