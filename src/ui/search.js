// Place search in a bar at the top centre of the map, with suggestions while typing.
// Suggestions come from Photon (komoot), an OpenStreetMap geocoder built for search-as-you-type
// that covers every supported region. To keep requests down it waits for MIN_CHARS letters
// and a pause in typing, and cancels a request that a newer keystroke has overtaken.
const PHOTON = 'https://photon.komoot.io/api/';
const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;
const MAX_SUGGESTIONS = 6;

export function createSearch(map) {
  const form = document.getElementById('search');
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-suggestions');
  // Not interactive, so a click on it still sets a point on the map.
  const marker = L.circleMarker([0, 0], { radius: 7, color: '#0d47a1', weight: 2, fillOpacity: 0.3, interactive: false });
  let places = [];
  let active = -1; // suggestion highlighted with the arrow keys
  let timer = null;
  let request = null;
  let pending = null; // promise of the request for the current text, so Enter can wait for it

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };

  function render() {
    list.replaceChildren(...places.map((place, i) => {
      const li = document.createElement('li');
      li.id = `search-suggestion-${i}`;
      li.setAttribute('role', 'option');
      li.classList.toggle('active', i === active);
      const name = document.createElement('strong');
      name.textContent = place.name;
      const context = document.createElement('small');
      context.textContent = place.context;
      li.append(name, context);
      // mousedown, not click, so it runs before the input loses focus and closes the list
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(place);
      });
      return li;
    }));
    if (active >= 0) input.setAttribute('aria-activedescendant', `search-suggestion-${active}`);
    else input.removeAttribute('aria-activedescendant');
    list.hidden = places.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
  }

  function showNote(text) {
    places = [];
    const li = document.createElement('li');
    li.className = 'note';
    li.textContent = text;
    list.replaceChildren(li);
    list.hidden = false;
  }

  function choose(place) {
    input.value = place.name;
    close();
    if (place.extent) {
      const [west, north, east, south] = place.extent;
      map.fitBounds([[south, west], [north, east]], { maxZoom: 14 });
    } else {
      map.setView(place.latlng, 14); // points (peaks, huts) have no extent
    }
    marker.setLatLng(place.latlng).addTo(map);
  }

  async function suggest(query) {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    // Prefer places near the map centre, e.g. the Swiss "Piz Palü" while looking at Switzerland.
    const { lat, lng } = map.getCenter();
    const params = new URLSearchParams({ q: query, limit: MAX_SUGGESTIONS, lang: 'de', lat, lon: lng });
    try {
      const response = await fetch(`${PHOTON}?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { features } = await response.json();
      places = features.map(toPlace);
      active = places.length ? 0 : -1;
      if (places.length) render();
      else showNote(`Nichts gefunden für «${query}»`);
    } catch (err) {
      if (!controller.signal.aborted) showNote(`Suche fehlgeschlagen (${err.message})`);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    request?.abort();
    pending = null;
    places = [];
    active = -1;
    const query = input.value.trim();
    if (query.length < MIN_CHARS) {
      close();
      if (!query) marker.remove();
      return;
    }
    pending = new Promise((resolve) => {
      timer = setTimeout(() => suggest(query).then(resolve), DEBOUNCE_MS);
    });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!places.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + places.length) % places.length;
      render();
    } else if (e.key === 'Escape') {
      close();
    }
  });

  // Enter takes the highlighted suggestion, waiting for the suggestions if they are still loading.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!places.length && pending) {
      clearTimeout(timer);
      const query = input.value.trim();
      await suggest(query);
    }
    if (places.length) choose(places[Math.max(active, 0)]);
  });

  input.addEventListener('blur', close);
  input.addEventListener('focus', () => {
    if (places.length) render();
  });
}

// A Photon GeoJSON feature as a name, a line of context (place, region, country) and a position.
function toPlace({ geometry, properties: p }) {
  const [lng, lat] = geometry.coordinates;
  const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city;
  const context = [p.city, p.county, p.state, p.country]
    .filter((part, i, parts) => part && part !== name && parts.indexOf(part) === i)
    .join(', ');
  return { name: name || context, context, latlng: L.latLng(lat, lng), extent: p.extent };
}
