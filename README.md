# Skitour Webapp

Webapp that shows possible ski descents whose slope stays below a user-selected
threshold (e.g. max 30°), displayed on a map. A phone camera overlay (AR view)
may follow later.

## Status

Map page (Leaflet). Click to set start (A) and end (B); the app then downloads 2 m
elevation GeoTIFFs covering A–B plus 1.5 km margin and outlines them on the map.
Supported regions (src/data/regions.js), each in its own metric grid via proj4:
- Switzerland: swissALTI3D from the swisstopo STAC API (data.geo.admin.ch), LV95,
  swisstopo maps.
- Norway: Kartverket's national DTM through its WCS (wcs.geonorge.no), cut into
  1 km squares of UTM 33N (EPSG:25833), Kartverket topo map.
- France: IGN RGE ALTI through the Géoplateforme raw-data WMS (data.geopf.fr/wms-r),
  Lambert-93 (EPSG:2154), IGN Plan map.
- Austria, Tirol only: Land Tirol's 50 cm laser-scan DTM through its WCS
  (gis.tirol.gv.at), Gauss-Krüger M28 / M31 for North / East Tirol.
- Italy: TINITALY 1.1 from INGV through its WCS (tinitaly.pi.ingv.it), UTM 32N,
  only 10 m, so slopes come out flatter and small cliffs are missed.
- Germany is missing: Bavaria's DGM1 downloads don't allow browser access (no CORS),
  so it would need a small proxy server.
Regions overlap at borders; the route uses the first region (finest data first) that
has data at both A and B. The base map follows the region in view until the user
picks one. A search bar at the top centre suggests places while typing (Photon, an
OpenStreetMap geocoder; from 3 letters, after a 300 ms pause). The top-right corner holds
the base-map picker and legend as cards that open and close on a click.
It then finds every route from A to B on the 2 m grid that a skier can ride while
carrying speed: speed is tracked as energy (v^2/2g), gained by losing height, lost to
friction, capped at a max speed (default friction 0.07, 20 km/h). Snow presets set the
friction (hard/frozen spring snow 0.03, typical 0.07, wet new snow 0.14; measured values from
Wolfsperger, Meyer & Gilgien 2021, doi:10.3389/fmech.2021.728722) and the panel shows the
minimum gliding slope atan(friction). Cells whose
terrain slope is steeper than the max angle (default 30°) are excluded. B is a target
zone (default radius 25 m): arriving anywhere inside it counts.
Exposed corridor cells are shown in purple: following the fall line from there for
75 m (further while it is 30° or steeper) runs into a cliff, i.e. terrain of 45°
or steeper dropping at least 10 m, with gentler gaps of up to 10 m bridged
(distance, angle and height adjustable). Green = corridor of
all feasible routes, blue = safest route (avoids exposed cells if possible, otherwise as little exposure as possible; then gentlest steepest point, then gentle and short), orange = reachable from
A but no way on to B.

## Avalanche danger

The panel's main setting is the avalanche danger level, which sets the max slope angle
(src/ui/danger.js), after the SLF's graphical reduction method: 1 gering 45° (no limit
there, so the cliff angle), 2 mässig 40°, 3 erheblich 35°, 4 gross 30°, 5 sehr gross 25° with
a warning that the SLF advises against tours. By default the level comes from
the current SLF bulletin (aws.slf.ch, GeoJSON, CC BY 4.0) for A and B, or the map centre before
they are set; of several ratings (by elevation or time of day) and of A and B the highest
counts, and its button carries an "SLF" tag; picking another level overrides it, picking the
tagged one follows the bulletin again. Outside Switzerland, out of season or when the bulletin can't be loaded, the level is
picked by hand (preselected 3). The other parameters, including a custom max angle, are under
"Erweitert".

## Run locally

No build step. Serve the folder with any static server, e.g.:

```bash
python -m http.server 8765
```

Then open http://localhost:8765. Downloaded elevation tiles are kept in the browser's Cache
Storage (up to 400 tiles, about 500 MB) so reloads don't download them again; the
panel has a button to clear it. The map uses Leaflet with swisstopo base maps
(Landeskarte, Winterlandeskarte), OpenTopoMap, and swisstopo's "slope > 30°" overlay.
