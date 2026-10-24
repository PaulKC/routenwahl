// Place search at the top of the right-hand cards, using OpenStreetMap's Nominatim geocoder,
// which covers every supported region. Nominatim asks for no search-as-you-type, so it only
// searches on Enter.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const MAX_RESULTS = 5;

export function createSearch(map) {
  const form = document.getElementById('search');
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  // Not interactive, so a click on it still sets a point on the map.
  const marker = L.circleMarker([0, 0], { radius: 7, color: '#0d47a1', weight: 2, fillOpacity: 0.3, interactive: false });
  let request = null;

  const showResults = (items) => {
    results.replaceChildren(...items);
    results.hidden = items.length === 0;
  };
  const showNote = (text) => {
    const li = document.createElement('li');
    li.className = 'note';
    li.textContent = text;
    showResults([li]);
  };

  function jumpTo(place) {
    const [south, north, west, east] = place.boundingbox.map(Number);
    map.fitBounds([[south, west], [north, east]], { maxZoom: 14 }); // a peak's box is tiny
    marker.setLatLng([Number(place.lat), Number(place.lon)]).addTo(map);
  }

  // Jump to the best match right away and list the others in case it was the wrong one.
  function showPlaces(places) {
    showResults(places.map((place, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = place.display_name;
      button.classList.toggle('current', i === 0);
      button.addEventListener('click', () => {
        jumpTo(place);
        showResults([]);
      });
      const li = document.createElement('li');
      li.append(button);
      return li;
    }));
    jumpTo(places[0]);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    request?.abort();
    request = new AbortController();
    showNote('Suche…');
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: MAX_RESULTS, 'accept-language': 'de' });
    let places;
    try {
      const response = await fetch(`${NOMINATIM}?${params}`, { signal: request.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      places = await response.json();
    } catch (err) {
      if (err.name !== 'AbortError') showNote(`Suche fehlgeschlagen (${err.message})`);
      return;
    }
    if (places.length) showPlaces(places);
    else showNote(`Nichts gefunden für «${query}»`);
  });

  // Clearing the field (or Escape) closes the list and removes the marker.
  input.addEventListener('input', () => {
    if (input.value) return;
    request?.abort();
    showResults([]);
    marker.remove();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') showResults([]);
  });
}
