# Skitour Webapp

Webapp that shows possible ski descents whose slope stays below a user-selected
threshold (e.g. max 30°), displayed on a map. A phone camera overlay (AR view)
may follow later.

## Status

Map page (Leaflet). Click to set start (A) and end (B); the app then downloads 2 m
elevation GeoTIFFs covering A–B plus 1.5 km margin (their outlines show with the
"Höhenkacheln anzeigen" debug option).
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
friction, capped at a max speed (default friction 0.05, 40 km/h). The snow buttons (Hart,
Pulver, Nass, next to the danger level) set the
friction (hard/frozen spring snow 0.03, powder 0.05, wet new snow 0.14; after the values measured by
Wolfsperger, Meyer & Gilgien 2021, doi:10.3389/fmech.2021.728722) and the panel shows the
minimum gliding slope atan(friction). Cells whose
terrain slope is steeper than the max angle (default 30°) are excluded. A and B are
zones (default radius 25 m): setting off anywhere inside A's (where skiable) and arriving
anywhere inside B's counts.
Exposed corridor cells are shown in purple: following the fall line from there for
75 m (further while it is 30° or steeper) runs into a cliff, i.e. terrain of 45°
or steeper dropping at least 10 m, with gentler gaps of up to 10 m bridged
(distance, angle and height adjustable). Green = corridor of
all feasible routes, orange = reachable from
A but no way on to B.

## Avalanche danger

The panel's main setting is the avalanche danger level, which sets the max slope angle
(src/ui/danger.js): the SLF's graphical reduction method (1 gering 45°, i.e. no limit there,
so the cliff angle; 2 mässig 40°; 3 erheblich 35°; 4 gross 30°) with a 5° margin, so 1 → 40°,
2 → 35°, 3 → 30°, 4 → 25°, 5 sehr gross → 20° with a warning that the SLF advises against
tours. By default the level comes from
the current SLF bulletin (aws.slf.ch, GeoJSON, CC BY 4.0) for A and B, or the map centre before
they are set; of several ratings (by elevation or time of day) and of A and B the highest
counts, and its button carries an "SLF" tag; picking another level overrides it, picking the
tagged one follows the bulletin again. Outside Switzerland, out of season or when the bulletin can't be loaded, the level is
picked by hand (preselected 3+, 30°).
The SLF splits mässig and erheblich into −, = and +; these spread over the 5° band down to the
next level (2− 40°, 2= 37.5°, 2+ 35°; 3− 35°, 3= 32.5°, 3+ 30°; the SLF gives no angles for
them, so this is the app's choice). A − = + row under the levels shows for 2 and 3, preselected
from the bulletin (= when it gives none), with the bulletin's one tagged "SLF".
The level only holds in the bulletin's core zone ("Kernzone"): the aspects and the elevation
of the avalanche problems rated at that level (src/data/avalanche-bulletin.js; several such
problems are merged into all their aspects from the lowest of their elevations, an upper
bound is left out). On other slopes the SLF takes the danger as about one level lower, so
those cells get 5° more (3− 35° → 40°, 3+ 30° → 35°, 4 → 30°, at most the 40° of level 1),
with the whole-slope rule only if that lower level has it. Each cell's aspect is the direction
its own slope faces, rounded to the bulletin's 8; nearly flat cells (under 5°) count as in
the zone (src/routing/core-zone.js). The panel shows the zone as a compass rose and an "über …
m" field, prefilled from the bulletin and editable (src/ui/zone-picker.js); its "SLF" tag
brings back the bulletin's zone. Without a core zone in the bulletin the level holds on all
slopes. The angles outside the zone are under "Erweitert" next to the ones inside, and
`?debug` adds a view of the zone's cells.
From level 3 the steepest part of the whole slope counts, not just the slope on the track
(src/routing/hang.js): a patch's steepness is the median slope over 10 × 10 m around a cell
(the reduction method's "steilste Hangpartie"; sources give 10 or 20 m); a Hang is a
connected area of patches from 30° up to 55° (steeper is rock, which separates Hänge) whose
aspect changes by less than 30° between neighbours (ribs and gullies end a Hang) and stays
within 60° of the Hang's mean aspect; each cell of a Hang is judged by its steepest patch. Cells that only this rule rules
out are shown in red. A debug option colours each Hang and shows its
steepest patch under the cursor. The other parameters, including a custom max angle, are under
"Erweitert", grouped into what the danger and snow buttons set (max angle, whole-slope rule,
friction; a value typed there overrides the buttons), how Hänge are found, and route and fall
settings. The debug options (Hänge, elevation tile outlines) only show when the address ends
in `?debug`, e.g. `index.html?debug`.

## Wildlife rest zones

Swiss wildlife rest zones ("Wildruhezonen") come from the BAFU's federal dataset through the
geo.admin.ch API (layer `ch.bafu.wrz-wildruhezonen_portal`, src/data/wildlife-zones.js). They
are shown on the map from zoom 11 and around every route (src/ui/wildlife-layer.js), filled
red like on the swisstopo map: solid outline when binding ("rechtsverbindlich"), dashed and
lighter when recommended ("empfohlen"); hovering a zone shows its name, rule and protection
period ("Schutzzeit"). The route never crosses a binding zone, whatever the season, and
avoids recommended ones too unless "Empfohlene Wildruhezonen meiden" under "Erweitert" is
unticked (src/routing/no-go.js rasterises the zones onto the height grid).
The federal layer has no routes through the zones, so a zone that may be crossed on a marked
route is blocked as a whole. If the zones can't be loaded, the panel says so and the route is
computed without them.

## Install as an app (PWA)

manifest.webmanifest, icons/ and the service worker sw.js make the page installable ("Zum
Startbildschirm hinzufügen" on a phone, the install button in the address bar on a desktop).
The service worker keeps the app's files (network first, so changes show on the next reload)
and the pinned libraries (cache first), so the app starts offline. Map tiles, the SLF
bulletin and the place search still need a connection; elevation tiles keep their own cache.
New source files belong in APP_FILES in sw.js, and a change to the caching rules needs a new
CACHE name. Installing needs https, or localhost.

## Run locally

No build step. Serve the folder with any static server, e.g.:

```bash
python -m http.server 8765
```

Then open http://localhost:8765. Downloaded elevation tiles are kept in the browser's Cache
Storage (up to 400 tiles, about 500 MB) so reloads don't download them again; the
panel has a button to clear it. The map uses Leaflet with swisstopo base maps
(Landeskarte, Winterlandeskarte), OpenTopoMap, and swisstopo's "slope > 30°" and ski touring routes ("Skitouren", with the SAC) overlays.
