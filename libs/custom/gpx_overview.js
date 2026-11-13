/* Overview map on the GPX page, switched on with gpx_overview in _config.yml (styles in
   libs/custom/gpx_overview.css, lines from create_map/gpx_overview.py):
   - the courses the page's filters let through on one map, on top of each other (the
     location filter starts at Lübeck while this is on), and listed beside it in the same order
   - hovering a course in the list (or its line on the map) brings it out and fades the
     others; clicking (tapping) it selects it: it stays out and marked in the list, which
     scrolls to it. The arrow jumps to its card further down
   - touch screens: the map starts locked so swipes scroll the page; a button unlocks it, and
     a short hint says so when the map first comes into view (addMapHint in gpx.html),
     together with what the OpenStreetMap button does (on all screens)
   - a small button in the lower left corner switches the OpenStreetMap tiles on all maps
   - its heading, then the map with the list (in one piece), "All courses" and the course
     cards (all at once) slide up and fade in as they come into view
   Uses registerMap, addOsmTiles, removeOsmTiles, osmEnabled, courseId, baseUrl, addMapHint and
   touchScreen from gpx.html,
   and listens for its "gpx:filtered" event. */
(function () {
  'use strict';

  const root = document.getElementById('gpxOverview');
  if (!root) return;

  const mapEl = root.querySelector('.ov-map');
  const listEl = root.querySelector('.ov-list');

  const map = registerMap(L.map(mapEl, { zoomSnap: 0.25, scrollWheelZoom: false }));

  // touch screens: the map starts locked, so swipes scroll the page (addMapHint in gpx.html);
  // the hints show once, when the map first comes into view
  addMapHint(map, '.ov-osm-btn',
             ['To filter, use the sliders and filters above.', 'To move the map, tap {pan}']);
  map.showMapHint();

  /* ---------- Fading in ---------- */

  const seen = window.IntersectionObserver && new IntersectionObserver(entries => {
    entries.filter(e => e.isIntersecting).forEach(e => {
      e.target.classList.add('ov-in');
      seen.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px' });

  function reveal(el) {
    // what is already above the window stays as it is
    if (!seen || el.classList.contains('ov-reveal') || el.getBoundingClientRect().bottom < 0) return;
    el.classList.add('ov-reveal');
    // once in place, back to the plain element (no transform left over)
    el.addEventListener('transitionend', function done(e) {
      if (e.target !== el || !el.classList.contains('ov-in')) return;
      el.classList.remove('ov-reveal', 'ov-in');
      el.removeEventListener('transitionend', done);
    });
    seen.observe(el);
  }

  document.querySelectorAll('.gpx-overview > h3, .ov-body, .gpx-list-heading').forEach(reveal);
  // the course cards all at once, as one block, every time the filter renders them anew
  const cardList = document.getElementById('gpxList');
  document.addEventListener('gpx:filtered', () => reveal(cardList));

  /* ---------- OpenStreetMap ---------- */

  // the page's toggle buttons switch all maps; the one on this map just presses them
  const pageOsmBtns = document.querySelectorAll('.osm-toggle-btn');
  let osmBtn = null;
  const osmControl = L.control({ position: 'bottomleft' });
  osmControl.onAdd = () => {
    osmBtn = L.DomUtil.create('button', 'ov-osm-btn');
    osmBtn.type = 'button';
    osmBtn.innerHTML = '<i class="fa-solid fa-map" aria-hidden="true"></i>';
    L.DomEvent.disableClickPropagation(osmBtn);
    osmBtn.addEventListener('click', () => pageOsmBtns[0]?.click());
    return osmBtn;
  };
  osmControl.addTo(map);

  function syncOsm() {
    (osmEnabled ? addOsmTiles : removeOsmTiles)(map);
    osmBtn.classList.toggle('on', osmEnabled);
    osmBtn.setAttribute('aria-pressed', osmEnabled);
    osmBtn.title = osmEnabled ? 'Hide OpenStreetMap' : 'Show OpenStreetMap';
  }
  // (the page's handler runs first, so osmEnabled is already switched)
  pageOsmBtns.forEach(btn => btn.addEventListener('click', syncOsm));
  syncOsm();

  /* ---------- Courses ---------- */

  let lines = {};          // course id -> simplified points
  let latest = null;       // the last filter result, if it came before the lines
  let entries = [];        // { course, points, line, hit, item }
  // a click (or tap) selects a course: it stays highlighted, on the map and in the list,
  // until another one is selected, it is clicked again, or the empty map is clicked.
  // Hovering shows another course for as long as the pointer is on it.
  let selected = null, hovered = null, shownEntry = null;

  fetch(`${baseUrl}/assets/data/gpx_overview.json`)
    .then(res => res.json())
    .then(data => {
      lines = data;
      if (latest) show(latest);
    })
    .catch(err => console.error('Error loading the overview:', err));

  document.addEventListener('gpx:filtered', e => {
    latest = e.detail;
    show(latest);
  });

  function show(courses) {
    // the selected course stays selected if the filter still lets it through
    const keep = selected && selected.course.name;
    selected = hovered = shownEntry = null;
    entries.forEach(e => { e.line.remove(); e.hit.remove(); });
    listEl.innerHTML = '';

    entries = courses
      .filter(c => lines[courseId(c.file)])
      .map(course => ({ course, points: lines[courseId(course.file)] }));

    entries.forEach(e => {
      const gravel = (e.course.surface || '').toLowerCase().trim() === 'gravel';
      e.line = L.polyline(e.points, {
        className: `ov-line route-${gravel ? 'gravel' : 'road'}`,
        weight: 3,
        opacity: 0.55,
        interactive: false
      }).addTo(map);
      // a wide invisible line on top to hover or tap (the drawn one is hard to hit by finger)
      e.hit = L.polyline(e.points, { className: 'ov-hit', weight: 18, opacity: 0 }).addTo(map);
      e.hit.on('mouseover', () => hover(e, true));
      e.hit.on('mouseout', () => hover(null));
      e.hit.on('click', ev => {
        L.DomEvent.stopPropagation(ev);  // not a click on the empty map
        select(e);
      });

      e.item = document.createElement('li');
      e.item.innerHTML = `
        <button type="button" class="ov-name">
          <span class="ov-dot ${gravel ? 'gravel' : 'road'}"></span>
          <span class="ov-title"></span>
          <span class="ov-km">${Math.round(e.course.distance)} km</span>
        </button>
        <button type="button" class="ov-jump" title="Go to the course">
          <i class="fa-solid fa-arrow-down" aria-hidden="true"></i>
          <span class="sr-only">Go to the course</span>
        </button>`;
      e.item.querySelector('.ov-title').textContent = e.course.name;
      const name = e.item.querySelector('.ov-name');
      name.addEventListener('mouseenter', () => hover(e));
      name.addEventListener('focus', () => hover(e));
      name.addEventListener('click', () => select(e));
      e.item.querySelector('.ov-jump').addEventListener('click', () => jumpTo(e.course));
      listEl.appendChild(e.item);
    });
    listEl.onmouseleave = () => hover(null);
    root.classList.toggle('ov-empty', !entries.length);

    const bounds = L.latLngBounds(entries.flatMap(e => e.points));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [12, 12] });

    const again = keep && entries.find(e => e.course.name === keep);
    if (again) select(again);
  }

  function hover(entry, fromMap) {
    // touch screens fake a hover on every tap, which would outlast the selection
    if (touchScreen) return;
    hovered = entry;
    render();
    if (entry && fromMap) scrollListTo(entry.item);
  }

  function select(entry) {
    selected = selected === entry ? null : entry;
    render();
    if (selected) scrollListTo(selected.item);
  }

  map.on('click', () => { if (selected) select(selected); });

  function render() {
    const entry = hovered || selected;
    root.classList.toggle('ov-focus', !!entry);
    entries.forEach(e => {
      const on = e === entry;
      e.line.getElement()?.classList.toggle('ov-hot', on);
      e.item.classList.toggle('ov-hot', on);
      e.item.classList.toggle('ov-selected', e === selected);
    });
    if (entry && entry !== shownEntry) entry.line.bringToFront();
    shownEntry = entry;
  }

  // the course's name into view inside the list, without moving the page
  function scrollListTo(item) {
    const box = listEl.getBoundingClientRect(), r = item.getBoundingClientRect();
    if (r.top >= box.top && r.bottom <= box.bottom) return;
    listEl.scrollBy({ top: r.top - box.top - (box.height - r.height) / 2, behavior: 'smooth' });
  }

  // its card further down (always there: both show the same filter result)
  function jumpTo(course) {
    const card = [...document.querySelectorAll('#gpxList .course-card')]
      .find(card => card.querySelector('h3')?.textContent === course.name);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('ov-flash');
    void card.offsetWidth;
    card.classList.add('ov-flash');
  }
})();
