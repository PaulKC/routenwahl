# Skitour Webapp

Webapp that shows possible ski descents whose slope stays below a user-selected
threshold (e.g. max 30°), displayed on a map. A phone camera overlay (AR view)
may follow later.

## Status

Minimal map page (Leaflet + swisstopo).

## Run locally

No build step. Serve the folder with any static server, e.g.:

```bash
python -m http.server 8765
```

Then open http://localhost:8765. The map uses Leaflet with swisstopo base maps
(Landeskarte, Winterlandeskarte), OpenTopoMap, and swisstopo's "slope > 30°" overlay.
