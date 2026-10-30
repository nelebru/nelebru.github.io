/* Vita as a bike ride, minimal version: the timeline entries (index.html,
   _data/experience.yaml) become flags along a pink route through a landscape drawn only
   as dots: mountains, valleys and, where the land drops below sea level, the sea.
   Scrolling through the section rides the bike from the oldest station to the newest; it
   slows down at each station and the details show in a card. Optionally (vita_ride_surf
   in _config.yml) the rider first surfs in on the waves and jumps ashore onto the bike.
   The land is either made up here or (vita_ride_terrain) the real road and mountains from
   Port de Pollença to Lluc on Mallorca, from libs/custom/vita_ride_pollenca_lluc.js.
   The colourful alternative is libs/custom/vita_ride.js (switch with vita_ride in
   _config.yml). Without JS, or with reduced motion, the plain timeline stays. */
(function () {
  const section = document.getElementById('resume');
  const list = section && section.querySelector('.timeline');
  if (!list || !window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // ---------- stations, oldest first ----------
  const stations = Array.from(list.querySelectorAll(':scope > li')).map(li => {
    const desc = li.querySelector('.desc').cloneNode(true);
    const title = desc.querySelector('b');
    const br = title && title.nextElementSibling;
    if (title) title.remove();
    if (br && br.tagName === 'BR') br.remove();
    const time = li.querySelector('.time').textContent.trim();
    return {
      place: li.querySelector('.flag').textContent.trim(),
      time: time,
      year: (time.match(/\d{4}/) || [time])[0],
      title: title ? title.textContent.trim() : '',
      subtitle: desc.innerHTML.trim(),
      work: li.dataset.category === 'work',
    };
  }).reverse();
  const N = stations.length;
  if (!N) return;

  // ---------- DOM ----------
  const ride = document.createElement('div');
  ride.className = 'vita-ride vita-ride--dots';
  ride.innerHTML =
    '<div class="vita-stage">' +
      '<canvas aria-hidden="true"></canvas>' +
      '<div class="vita-hud">' +
      '<div class="vita-card" aria-hidden="true">' +
        '<div class="vita-card-meta"><i class="fa-solid"></i><span class="vita-card-time"></span></div>' +
        '<div class="vita-card-place"></div>' +
        '<div class="vita-card-title"></div>' +
        '<div class="vita-card-sub"></div>' +
      '</div>' +
      '<div class="vita-hint" aria-hidden="true">Scroll to ride along</div>' +
      '<div class="vita-track"><div class="vita-track-line"><div class="vita-track-bike"><i class="fa-solid fa-person-biking"></i></div></div></div>' +
      '</div>' +
    '</div>';
  // the real map's sources, credited in small print
  if (window.VITA_RIDE_MAP) {
    const credit = document.createElement('div');
    credit.className = 'vita-credit';
    credit.textContent = 'Road © OpenStreetMap contributors · Elevation: Mapzen Terrain Tiles (incl. Copernicus EU-DEM)';
    ride.querySelector('.vita-hud').appendChild(credit);
  }
  list.parentNode.insertBefore(ride, list);
  section.classList.add('vita-ride-on');

  const stage = ride.querySelector('.vita-stage');
  const canvas = ride.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const card = ride.querySelector('.vita-card');
  const cardSub = card.querySelector('.vita-card-sub');
  const hint = ride.querySelector('.vita-hint');
  const trackLine = ride.querySelector('.vita-track-line');
  const trackBike = ride.querySelector('.vita-track-bike');

  // ---------- route and terrain ----------
  const SPACING = 1300;          // route length between two stations
  const HOLD = 0.92;            // the last part of the scrolling the bike waits at the last station
  // Optional surfing prologue (vita_ride_surf in _config.yml): the rider lands on the bike
  // right at the first station. Without it the bike sets off a little before that.
  const SURF = !!window.VITA_RIDE_SURF;
  const START = SURF ? 0 : -0.55 * SPACING;
  const stationU = stations.map((_, i) => i * SPACING);
  // the bike's stops: (the start, then) every station
  const keyU = SURF ? stationU : [START].concat(stationU);
  const BIKE_SEGMENTS = keyU.length - 1;
  const END = stationU[N - 1];
  // the valley's position across the land and the route's height for a position u along
  // it: a winding route with tight little bends, like a mountain road
  const valleyV = u => 120 * Math.sin(u / 640) + 60 * Math.sin(u / 270 + 1.3) +
    38 * Math.sin(u / 115 + 0.4) + 16 * Math.sin(u / 52 + 2.1);
  // over passes and down to the coast: lower where the sea comes close
  // (only near the start; further on it's mountains all the way)
  const seaAmount = u => smooth(-0.2, 0.5, Math.sin(u / 1500 + 2.0)) * smooth(3600, 1400, u);
  // ... and a steep first climb up to a pass after the second station
  const roadH = u => 90 + (1 - seaAmount(u)) * (190 + 130 * Math.sin(u / 700 + 0.5)) + 40 * Math.sin(u / 330 + 2) +
    150 * smooth(1000, 1500, u) * smooth(2900, 1900, u);

  // the surfing prologue takes one stretch of scrolling before the ones by bike
  const SEGMENTS = BIKE_SEGMENTS + (SURF ? 1 : 0);
  // shares of the prologue: on the board, then running up the beach, then the jump
  const SURF_RIDE = 0.55, SURF_RUN = 0.86;

  function hash2(i, j) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  // smooth value noise, a few octaves, about 0..1
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  function fbm(x, y) {
    let sum = 0, amp = 0.55, f = 1;
    for (let k = 0; k < 4; k++) { sum += noise(x * f, y * f) * amp; f *= 2.03; amp *= 0.5; }
    return sum;
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // Where the route climbs steeply it zigzags up the slope in hairpin bends: long
  // stretches across the valley joined by tight turns, each a little higher up. No two
  // alike: how far they reach and how close they follow each other wander, and the
  // steeper the climb, the tighter they get.
  const HAIRPIN_W = 85;    // how far the zigzag reaches to either side of the valley, on average
  const HAIRPIN_REACH = HAIRPIN_W * 1.35;   // ... and at the most
  const HAIRPIN_P = 210;   // the way along the valley for one zig and one zag, on average
  const HAIRPIN_ROUND = Math.asin(0.96);
  const climb = u => (roadH(u + 20) - roadH(u - 20)) / 40;
  const hairpins = u => smooth(0.16, 0.26, climb(u));
  // worked out once, along the way, into a table (every 2 units) where the ride goes: the
  // zigzag's phase moves on by a varying amount per step. Every dot near the hairpins
  // asks for it.
  const V_U0 = START - 5000, V_DU = 2;
  const vTable = new Float64Array(Math.ceil((END + 9000 - V_U0) / V_DU) + 1);
  (function () {
    let phase = 0;
    for (let i = 0; i < vTable.length; i++) {
      const u = V_U0 + i * V_DU, k = hairpins(u);
      const period = Math.max(130, HAIRPIN_P * (1 - 0.3 * smooth(0.26, 0.7, climb(u))) * (0.75 + 0.5 * noise(u / 300, 7)));
      phase += 2 * Math.PI * V_DU / period;
      const reach = HAIRPIN_W * k * (0.65 + 0.7 * noise(u / 170, 13));
      vTable[i] = valleyV(u) + (k && reach * Math.asin(0.96 * Math.sin(phase)) / HAIRPIN_ROUND);
    }
  })();
  const roadV = u => {
    const x = (u - V_U0) / V_DU, i = Math.floor(x);
    return i >= 0 && i < vTable.length - 1 ? vTable[i] + (vTable[i + 1] - vTable[i]) * (x - i) : valleyV(u);
  };
  // the route's steepness across the valley, and the share of a step along u that is
  // still the same direction as the route (for distances at right angles to it)
  const roadSlope = u => (roadV(u + 1) - roadV(u - 1)) / 2;
  const roadCos = u => 1 / Math.hypot(1, roadSlope(u));

  // how far along the route each u is, so the bike rides the hairpins at an even speed
  // instead of racing along the stretches across the valley
  const ARC_DU = 2, ARC_U0 = START - 1500;
  const arc = [0];
  for (let u = ARC_U0; u < END + 3000; u += ARC_DU) {
    arc.push(arc[arc.length - 1] + Math.hypot(ARC_DU, roadV(u + ARC_DU) - roadV(u)));
  }
  function arcAt(u) {
    const x = Math.min(arc.length - 1.001, Math.max(0, (u - ARC_U0) / ARC_DU)), i = Math.floor(x);
    return arc[i] + (arc[i + 1] - arc[i]) * (x - i);
  }
  function uAtArc(s) {
    let lo = 0, hi = arc.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arc[m] < s) lo = m; else hi = m; }
    return ARC_U0 + (lo + (s - arc[lo]) / ((arc[hi] - arc[lo]) || 1)) * ARC_DU;
  }

  // The route runs through a valley: beyond it (smaller v) the land rises to mountains,
  // except along stretches where it falls away into the sea; on the near side there are
  // hills. Below 0 is sea. Where the route zigzags, the valley floor is wide enough for it.
  function height(u, v) {
    const dv = v - valleyV(u), d = Math.sign(dv) * Math.max(0, Math.abs(dv) - HAIRPIN_REACH * hairpins(u));
    const base = roadH(u);
    if (d < 0) {
      const n = fbm(u / 1000, v / 1000);
      const ridges = 1 - Math.abs(2 * fbm(u / 650 + 9, v / 650) - 1);
      const mountains = ((n - 0.3) * 0.8 + ridges * 0.6) * 850 * smooth(60, 1100, -d);
      const sea = seaAmount(u);
      // a strip of land between route and water, then the shore
      return base + mountains * (1 - sea) - sea * (base + 260) * smooth(380, 830, -d);
    }
    // on this side no water: hollows stay above sea level
    return Math.max(25, base + smooth(50, 400, d) * (fbm(u / 480 + 5, v / 480) - 0.35) * 380);
  }
  // heights are computed once per dot
  const GRID = 26;
  const heights = new Map();
  // every dot sits a little off its grid point, so the dots never line up in rows (close
  // to the camera those would show as long pointed rays)
  const jitterU = (i, j) => (hash2(i, j) - 0.5) * GRID * 0.9;
  const jitterV = (i, j) => (hash2(j, i) - 0.5) * GRID * 0.9;
  function gridHeight(i, j) {
    const key = i * 65536 + j;
    let h = heights.get(key);
    if (h === undefined) { h = world.dot(i, j); heights.set(key, h); }
    return h;
  }

  // ---------- the world: made up, or a real road ----------
  // Either way it gives the route by the distance s along it (at(s): u, v and the road's
  // height), the ground, the dots (dot(i, j): the height of one, NaN to leave it out for
  // the clear lane along the route or beyond the map), the valley the camera follows and
  // where the surfer comes in from. With vita_ride_terrain in _config.yml it's the road
  // from Port de Pollença up to Lluc on Mallorca (libs/custom/vita_ride_pollenca_lluc.js).
  const world = window.VITA_RIDE_MAP ? realWorld(window.VITA_RIDE_MAP) : madeUpWorld();

  function madeUpWorld() {
    return {
      at: s => { const u = uAtArc(s); return [u, roadV(u), roadH(u)]; },
      stationS: stationU.map(arcAt),
      keyS: keyU.map(arcAt),
      drawFrom: arcAt(START - 600), drawTo: arcAt(END + 2500),
      camU: uAtArc,
      valley: valleyV,
      terrain: height,
      dot(i, j) {
        const u = i * GRID, v = j * GRID, du = u + jitterU(i, j), dv = v + jitterV(i, j);
        // a clear lane along the route, so it reads as a path through the dots (across the
        // hairpins' steep stretches it's narrower and measured at right angles, from the dot
        // itself)
        const lane = hairpins(u) > 0 ? Math.abs(dv - roadV(du)) * roadCos(du) < 20 : Math.abs(v - roadV(u)) < 30;
        return lane ? NaN : height(du, dv);
      },
      edge: () => 1,
      surfFrom: { u: START - 700, v: roadV(START - 700) - 1500 },
      runEnd: { u: START - 15, v: roadV(START - 15) - 30 },
    };
  }

  function realWorld(map) {
    const toUnits = map.exaggeration / map.unit;   // metres of height to units
    // the road: u, v and its height every RS units along it
    const RS = 6, n = map.route.length / 3;
    const ru = new Float64Array(n), rv = new Float64Array(n), rh = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      ru[k] = map.route[3 * k]; rv[k] = map.route[3 * k + 1]; rh[k] = map.route[3 * k + 2] * toUnits;
    }
    const length = (n - 1) * RS;
    const at = s => {
      const x = Math.min(n - 1.001, Math.max(0, s / RS)), k = Math.floor(x), f = x - k;
      return [ru[k] + (ru[k + 1] - ru[k]) * f, rv[k] + (rv[k + 1] - rv[k]) * f, rh[k] + (rh[k + 1] - rh[k]) * f];
    };

    // the ground, from the map's heights; the sea gets deeper away from the shore, so the
    // waves break along it
    const { cols, rows, cell, u0, v0 } = map;
    const bytes = Uint8Array.from(atob(map.heights), c => c.charCodeAt(0));
    const toLand = new Int32Array(cols * rows).fill(-1);
    let queue = [];
    bytes.forEach((b, k) => { if (b) { toLand[k] = 0; queue.push(k); } });
    while (queue.length) {
      const next = [];
      for (const k of queue) {
        const x = k % cols;
        for (const m of [x > 0 ? k - 1 : -1, x < cols - 1 ? k + 1 : -1, k - cols, k + cols]) {
          if (m >= 0 && m < toLand.length && toLand[m] < 0) { toLand[m] = toLand[k] + 1; next.push(m); }
        }
      }
      queue = next;
    }
    const ground = Float32Array.from(bytes, (b, k) =>
      b ? b * map.step * toUnits : -Math.min(390, 10 + (toLand[k] < 0 ? 1e4 : toLand[k] * cell) * 0.9));
    function mapGround(u, v) {
      const x = (u - u0) / cell, y = (v - v0) / cell;
      if (!(x >= 0 && y >= 0 && x < cols - 1 && y < rows - 1)) return NaN;
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * cols + i;
      return (ground[k] * (1 - fx) + ground[k + 1] * fx) * (1 - fy) + (ground[k + cols] * (1 - fx) + ground[k + cols + 1] * fx) * fy;
    }

    // the clear lane along the road: the road's points sorted into squares, to find the
    // ones close to a dot quickly
    const SQ = 40, squares = new Map();
    for (let k = 0; k < n - 1; k++) {
      const key = Math.floor(ru[k] / SQ) * 4096 + Math.floor(rv[k] / SQ);
      if (!squares.has(key)) squares.set(key, []);
      squares.get(key).push(k);
    }
    function nearRoad(u, v, width) {
      const a = Math.floor(u / SQ), b = Math.floor(v / SQ);
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) {
        for (const k of squares.get((a + da) * 4096 + b + db) || []) {
          const eu = ru[k + 1] - ru[k], ev = rv[k + 1] - rv[k];
          const t = Math.min(1, Math.max(0, ((u - ru[k]) * eu + (v - rv[k]) * ev) / (eu * eu + ev * ev || 1)));
          if (Math.hypot(u - ru[k] - eu * t, v - rv[k] - ev * t) < width) return true;
        }
      }
      return false;
    }

    // the stations spread evenly along the road, the last one at its end in Lluc
    const gaps = Math.max(1, N - 1) + (SURF ? 0 : 0.55);
    const stationS = stations.map((_, i) => (i + (SURF ? 0 : 0.55)) * length / gaps);

    // the camera follows the road's general direction: its u averaged over a stretch, and
    // across the valley the road's v averaged over everything nearby
    const sumU = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) sumU[k + 1] = sumU[k] + ru[k];
    const camU = s => {
      const k0 = Math.max(0, Math.min(n - 1, Math.round((s - 200) / RS))), k1 = Math.max(k0 + 1, Math.min(n, Math.round((s + 200) / RS)));
      return (sumU[k1] - sumU[k0]) / (k1 - k0);
    };
    const VS = 20, valleyAt = new Float64Array(Math.ceil((cols - 1) * cell / VS) + 1);
    valleyAt.forEach((_, m) => {
      const u = u0 + m * VS;
      let sw = 0, sv = 0;
      for (let k = 0; k < n; k += 2) { const w = Math.exp(-(((u - ru[k]) / 300) ** 2)); sw += w; sv += w * rv[k]; }
      valleyAt[m] = sw > 1e-6 ? sv / sw : rv[u < ru[0] ? 0 : n - 1];
    });
    const valley = u => {
      const x = Math.min(valleyAt.length - 1.001, Math.max(0, (u - u0) / VS)), m = Math.floor(x);
      return valleyAt[m] + (valleyAt[m + 1] - valleyAt[m]) * (x - m);
    };

    // Around the start the map is changed to fit the surfing: as on the made-up coast,
    // beyond a strip of land along the road the ground drops into the sea, so the surfer
    // rides in over open water in front of the camera. A couple of kilometres on it's the
    // real land again.
    const start = at(0);
    function terrain(u, v) {
      const h = mapGround(u, v), w = smooth(1700, 600, u - start[0]), d = v - valley(u);
      if (h !== h || !w) return h;
      // a flat strip at the road's height (the real hills there would stand on the beach),
      // then the shore; on the near side the land rises back to the real hills further off
      const base = at(Math.max(0, u - start[0]))[2];
      const coast = d < 0 ? base + (-260 - base) * smooth(380, 830, -d) : h + (base - h) * smooth(350, 0, d);
      return h + (coast - h) * w;
    }

    return {
      at, stationS,
      keyS: SURF ? stationS : [0].concat(stationS),
      drawFrom: 0, drawTo: length,
      camU, valley, terrain,
      dot(i, j) {
        const u = i * GRID + jitterU(i, j), v = j * GRID + jitterV(i, j);
        return nearRoad(u, v, 20) ? NaN : terrain(u, v);
      },
      occlude: true,
      // fading out towards the end of the map
      edge: (u, v) => smooth(0, 900, Math.min(u - u0, u0 + (cols - 1) * cell - u, v - v0, v0 + (rows - 1) * cell - v)),
      surfFrom: { u: start[0] - 700, v: valley(start[0] - 700) - 1500 },
      runEnd: { u: start[0] - 15, v: start[1] - 30 },
    };
  }

  // the surfer comes in from out at sea, heading for the bike at the start, and leaves the
  // water where the land rises above sea level
  const SURF_FROM = world.surfFrom;
  const BIKE_START = world.at(world.keyS[0]);
  const SURF_SHORE = (function () {
    const to = { u: BIKE_START[0], v: BIKE_START[1] };
    for (let k = 0; k <= 1; k += 0.01) {
      const u = SURF_FROM.u + (to.u - SURF_FROM.u) * k, v = SURF_FROM.v + (to.v - SURF_FROM.v) * k;
      if (world.terrain(u, v) > 0) return { u, v };
    }
    return to;
  })();
  const S_END = world.stationS[N - 1];
  const S_SPACING = (S_END - world.stationS[0]) / Math.max(1, N - 1) || SPACING;

  // ---------- colours: ink, water and the pink route ----------
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const PAL = {
    light: { ink: [34, 34, 34], water: [47, 114, 144], foam: [128, 182, 206], route: [255, 105, 180], paper: [255, 255, 255] },
    dark: { ink: [230, 227, 234], water: [110, 167, 189], foam: [236, 246, 250], route: [255, 105, 180], paper: [22, 21, 27] },
  };
  let pal = PAL.light;
  const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  const FAR = 5200;

  // ---------- camera ----------
  const NEAR = 40;
  const cam = { x: 0, y: 0, z: 0 };
  let R, U, Fw, F, cx, cy, W = 1, H = 1, dpr = 1;
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
  // the camera looks at the rider (u, v, height), a little ahead along the route
  function setCamera(fu, fv, fh) {
    const ahead = 220 * Math.min(1, W / H);
    const tx = fu + ahead, tz = fv + (world.valley(tx) - world.valley(fu)) / 2, ty = fh;
    const dx = 0.5, dz = -0.866, dist = 720;
    cam.x = tx - dx * dist; cam.y = ty + 200; cam.z = tz - dz * dist;
    Fw = norm([tx - cam.x, ty - cam.y, tz - cam.z]);
    R = norm([-Fw[2], 0, Fw[0]]);
    U = [R[1] * Fw[2] - R[2] * Fw[1], R[2] * Fw[0] - R[0] * Fw[2], R[0] * Fw[1] - R[1] * Fw[0]];
    F = Math.min(W * 0.95, H * 1.1);
    cx = W / 2; cy = H * 0.55;
  }
  function toCam(x, y, z) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    return [dx * R[0] + dy * R[1] + dz * R[2], dx * U[0] + dy * U[1] + dz * U[2], dx * Fw[0] + dy * Fw[1] + dz * Fw[2]];
  }
  const sx = c => cx + F * c[0] / c[2];
  const sy = c => cy - F * c[1] / c[2];
  const fade = z => Math.max(0, 1 - z / FAR) ** 1.3;

  // ---------- scroll position to bike position ----------
  let rideHeight = 0, stageHeight = 0, lastWidth = 0;
  function progress() {
    const top = parseFloat(getComputedStyle(stage).top) || 0;
    const travel = rideHeight - stageHeight;
    return travel > 0 ? Math.min(1, Math.max(0, (top - ride.getBoundingClientRect().top) / travel)) : 0;
  }
  // between two stops the bike speeds up and slows down again, lingering at each station
  // (s: the distance along the route)
  function bikeS(p) {
    const s = p * BIKE_SEGMENTS, i = Math.min(BIKE_SEGMENTS - 1, Math.floor(s)), f = s - i;
    const e = f - Math.sin(2 * Math.PI * f) * 0.85 / (2 * Math.PI);
    const key = world.keyS;
    return key[i] + (key[i + 1] - key[i]) * e;
  }
  function scrollToStation(i) {
    const top = parseFloat(getComputedStyle(stage).top) || 0;
    const rideTop = ride.getBoundingClientRect().top + window.scrollY;
    const at = (i + 1) / SEGMENTS * HOLD;
    window.scrollTo({ top: rideTop - top + at * (rideHeight - stageHeight) + 1, behavior: 'smooth' });
  }

  // ---------- drawing ----------
  // Waves rolling over the sea; where they crest, and where they break on the beach, the
  // dots turn into foam: lighter and a little bigger.
  function wave(u, v, t) {
    return 9 * Math.sin((u * 0.8 + v * 0.6) / 70 - t * 1.4) + 5 * Math.sin((v - u * 0.3) / 45 + t);
  }
  function foamAt(h, w, t) {
    const crest = smooth(9, 13, w);
    // surf: bands running in towards the shore in the last bit of shallow water
    const surf = smooth(-70, -10, h) * smooth(0.35, 0.9, Math.sin(t * 1.3 - h / 12));
    return Math.max(crest, surf);
  }

  let seaVisible = false;
  function drawDots(bu, bv) {
    const i0 = Math.floor((bu - 2600) / GRID), i1 = Math.ceil((bu + 4600) / GRID);
    const j0 = Math.floor((bv - 4600) / GRID), j1 = Math.ceil((bv + 900) / GRID);
    const ink = rgb(pal.ink), water = rgb(pal.water), foam = rgb(pal.foam);
    const t = performance.now() / 1000;
    seaVisible = false;
    // on the real map ridges hide what lies behind them (the sea beyond the mountains): the
    // dots are drawn nearest first, each only if it isn't below the outline of the land
    // drawn so far in its column of the screen
    const hiding = world.occlude, kept = [];
    for (let i = i0; i <= i1; i++) {
      const u = i * GRID;
      for (let j = j0; j <= j1; j++) {
        const h = gridHeight(i, j);
        // left out: the clear lane along the route, and beyond the map
        if (h !== h) continue;
        const v = j * GRID, du = u + jitterU(i, j), dv = v + jitterV(i, j);
        const sea = h < 0;
        let c, froth = 0;
        if (sea) {
          const w = wave(du, dv, t);
          froth = foamAt(h, w, t);
          c = toCam(du, w, dv);
        } else {
          c = toCam(du, h, dv);
        }
        if (c[2] < NEAR || c[2] > FAR) continue;
        const x = sx(c), y = sy(c);
        if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
        if (sea && !hiding) seaVisible = true;
        const r = Math.min(2.4, Math.max(0.95, 1.1 * F / c[2])) * (1 + froth * 0.7);
        // thinning out towards the camera and every edge instead of stopping in a row
        // ... and towards the ends of the patch of dots drawn, so it never shows a straight cut
        const edges = screenFade(x, y) * world.edge(du, dv) *
          smooth(i0, i0 + 14, i) * smooth(i1, i1 - 14, i) * smooth(j0, j0 + 14, j) * smooth(j1, j1 - 14, j);
        // the land a little lighter than the water, but the far mountains still clearly there
        const alpha = Math.sqrt(fade(c[2])) * smooth(120, 450, c[2]) * edges * (sea ? 0.9 : 0.7);
        const style = !sea ? ink : froth > 0.5 ? foam : water;
        if (hiding) { kept.push({ x, y, z: c[2], r, alpha, style, sea }); continue; }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = style;
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
    }
    if (hiding) {
      const COL = 3, outline = new Float32Array(Math.ceil(W / COL) + 2).fill(H + 100);
      kept.sort((a, b) => a.z - b.z);
      for (const d of kept) {
        const col = Math.max(0, Math.min(outline.length - 1, Math.round(d.x / COL)));
        if (d.y > outline[col] + 6) continue;
        if (d.sea) {
          // only sea that isn't hidden keeps the waves moving
          seaVisible = true;
        } else if (d.z > 300) {
          // the land between this dot and its neighbours hides things too (not the sea: it's
          // flat, its waves would only cut gaps into the water behind them; and not the dots
          // faded out close to the camera, which would hide things while not being seen)
          const reach = Math.max(1, Math.round(GRID * F / d.z / COL / 1.5));
          for (let k = Math.max(0, col - reach); k <= Math.min(outline.length - 1, col + reach); k++) {
            if (d.y < outline[k]) outline[k] = d.y;
          }
        }
        ctx.globalAlpha = d.alpha;
        ctx.fillStyle = d.style;
        ctx.fillRect(d.x - d.r / 2, d.y - d.r / 2, d.r, d.r);
      }
    }
    ctx.globalAlpha = 1;
  }

  // the route: travelled part solid, the way ahead faint. It looks drawn by hand: the
  // line wobbles a little and changes its width, with a thinner second stroke beside it
  // like a pencil going over it twice. The wobble belongs to the place on the route, so
  // it stays put while riding.
  // fading out towards the edges of the stage, so nothing stops at them in a hard line
  const screenFade = (x, y) =>
    smooth(H * 0.97, H * 0.6, y) * smooth(0, H * 0.14, y) * smooth(0, W * 0.07, x) * smooth(W, W * 0.93, x);

  function drawRoute(bs) {
    // steps of even length along the route, so the hairpins are drawn as finely as the
    // rest and the wobble keeps its place on them
    const STEP = 12;
    const from = Math.floor(Math.max(world.drawFrom, bs - 1500) / STEP) * STEP;
    const to = Math.min(world.drawTo, bs + 5000);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    [[3, 1, 1], [11, 0.45, 0.5]].forEach(([seed, width, alpha]) => {
      let prev = null;
      for (let s = from; s <= to; s += STEP) {
        // the wobble goes sideways to the route, whichever way it runs
        const p = world.at(s), a = world.at(s - 3), b = world.at(s + 3);
        const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, wobble = (noise(s / 45, seed) - 0.5) * 12;
        const c = toCam(p[0] - (b[1] - a[1]) / tl * wobble, p[2] + 3, p[1] + (b[0] - a[0]) / tl * wobble);
        if (prev && c[2] > NEAR && prev.c[2] > NEAR) {
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(sx(c), sy(c));
          const ahead = s > bs;
          const pressure = 0.7 + 0.6 * noise(s / 90, seed + 5);
          ctx.lineWidth = width * pressure * Math.min(4, Math.max(1.2, 2.5 * F / c[2]));
          ctx.strokeStyle = rgb(pal.route, alpha * (ahead ? 0.35 : 1) * Math.max(0.15, fade(c[2])) * screenFade(sx(c), sy(c)));
          ctx.stroke();
        }
        prev = { c, x: sx(c), y: sy(c) };
      }
    });
  }

  const FONT = 'Raleway, "HelveticaNeue", "Helvetica Neue", Helvetica, Arial, sans-serif';
  const ICON_FONT = '"Font Awesome 6 Free"';

  // a flag on a thin pole at each station; the one the bike is at is pink
  function drawFlag(st, s, active) {
    const p = world.at(s), c = toCam(p[0], p[2] + 3, p[1]);
    if (c[2] < NEAR) return;
    const x = sx(c), y = sy(c);
    const k = Math.min(1, Math.max(0.5, 520 / c[2]));
    const a = Math.max(0.2, fade(c[2])) * (active ? 1 : 0.85);
    const pole = 46 * k;
    ctx.globalAlpha = a * screenFade(x, y - pole);
    ctx.strokeStyle = rgb(active ? pal.route : pal.ink);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - pole); ctx.stroke();
    ctx.fillStyle = rgb(active ? pal.route : pal.ink);
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();

    const top = 10 * k, main = 13 * k, pad = 6 * k;
    ctx.font = `600 ${main}px ${FONT}`;
    const wPlace = ctx.measureText(st.place).width;
    ctx.font = `${top}px ${FONT}`;
    const wYear = ctx.measureText(st.time).width + 14 * k;
    const bw = Math.max(wPlace, wYear) + pad * 2, bh = top + main + pad * 2;
    const bx = x, by = y - pole - bh;
    ctx.fillStyle = active ? rgb(pal.route) : rgb(pal.paper, 0.92);
    ctx.fillRect(bx, by, bw, bh);
    if (!active) {
      ctx.strokeStyle = rgb(pal.ink, 0.5);
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }
    const text = active ? (isDark() ? [26, 6, 16] : [255, 255, 255]) : pal.ink;
    ctx.fillStyle = rgb(text, active ? 1 : 0.7);
    ctx.textBaseline = 'top';
    ctx.font = `900 ${top * 0.9}px ${ICON_FONT}`;
    ctx.fillText(st.work ? '' : '', bx + pad, by + pad);
    ctx.font = `${top}px ${FONT}`;
    ctx.fillText(st.time, bx + pad + 14 * k, by + pad);
    ctx.fillStyle = rgb(text);
    ctx.font = `600 ${main}px ${FONT}`;
    ctx.fillText(st.place, bx + pad, by + pad + top + 2 * k);
    ctx.globalAlpha = 1;
  }

  // a small line drawing of a bike with a pink rider (or parked, waiting), always the
  // same size
  function drawBike(bs, rider) {
    const p = world.at(bs), c = toCam(p[0], p[2] + 3, p[1]);
    const x = sx(c), y = sy(c);
    const ink = rgb(pal.ink), pink = rgb(pal.route);
    const crank = bs / 26;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ink;
    const r = 7.5;
    const line = pts => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.stroke(); };
    // wheels, frame, bars
    [[-11, -r], [11, -r]].forEach(w => { ctx.beginPath(); ctx.arc(w[0], w[1], r, 0, Math.PI * 2); ctx.stroke(); });
    const bb = [-1, -7], seat = [-5, -18], head = [8, -18];
    line([[-11, -r], bb, seat, [-11, -r]]);
    line([seat, head, [11, -r]]);
    line([bb, [7.4, -15]]);
    line([[-7.5, -20], [-2.5, -20]]);
    line([head, [8.5, -20.5], [11, -20.5], [11.6, -18]]);
    if (!rider) { ctx.restore(); return; }
    // rider: pink jersey, ink legs pedalling
    const foot = [bb[0] + 3.5 * Math.cos(crank), bb[1] + 3.5 * Math.sin(crank)];
    const hip = [-5, -21];
    const mid = [(hip[0] + foot[0]) / 2 + 4, (hip[1] + foot[1]) / 2 - 1];
    line([hip, mid, foot]);
    ctx.strokeStyle = pink;
    ctx.lineWidth = 3;
    line([hip, [3, -30]]);
    ctx.lineWidth = 1.6;
    line([[3, -30], [8, -25], [10.5, -20.5]]);
    ctx.fillStyle = pink;
    ctx.beginPath(); ctx.arc(5.5, -34, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------- surfing prologue ----------
  // where the rider is at a point f (0..1) of the prologue: on the board riding the waves
  // in, running up the beach to the bike, then a little jump onto it. camH is the height
  // the camera follows: without the bobbing on the waves and the jump, so the landscape
  // stays put while the rider moves
  const RUN_END = world.runEnd;
  // the beach rises steeply behind the waterline: running up it the rider climbs gently
  // from the water to the height at the bike instead of following every step of the ground
  const RUN_FROM_H = Math.max(0, world.terrain(SURF_SHORE.u, SURF_SHORE.v));
  const RUN_TO_H = Math.max(0, world.terrain(RUN_END.u, RUN_END.v));
  function surferAt(f, t) {
    if (f < SURF_RIDE) {
      const k = f / SURF_RIDE;
      const u = SURF_FROM.u + (SURF_SHORE.u - SURF_FROM.u) * k, v = SURF_FROM.v + (SURF_SHORE.v - SURF_FROM.v) * k;
      return { u, v, h: wave(u, v, t) + 2, camH: 0, pose: 'surf' };
    }
    if (f < SURF_RUN) {
      const k = (f - SURF_RIDE) / (SURF_RUN - SURF_RIDE);
      const u = SURF_SHORE.u + (RUN_END.u - SURF_SHORE.u) * k, v = SURF_SHORE.v + (RUN_END.v - SURF_SHORE.v) * k;
      const h = RUN_FROM_H + (RUN_TO_H - RUN_FROM_H) * k * k * (3 - 2 * k);
      return { u, v, h, camH: h, pose: 'run', stride: k * 18 };
    }
    const k = (f - SURF_RUN) / (1 - SURF_RUN), e = k * k * (3 - 2 * k);
    const from = { u: RUN_END.u, v: RUN_END.v, h: RUN_TO_H };
    const to = { u: BIKE_START[0], v: BIKE_START[1], h: BIKE_START[2] + 3 };
    return {
      u: from.u + (to.u - from.u) * e,
      v: from.v + (to.v - from.v) * e,
      h: from.h + (to.h - from.h) * e + Math.sin(k * Math.PI) * 16,
      camH: from.h + (BIKE_START[2] - from.h) * e,
      pose: 'jump',
    };
  }

  function drawSurfer(pos, t) {
    const c = toCam(pos.u, pos.h, pos.v);
    if (c[2] < NEAR) return;
    const ink = rgb(pal.ink), pink = rgb(pal.route);
    const line = pts => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(q => ctx.lineTo(q[0], q[1])); ctx.stroke(); };
    ctx.save();
    ctx.translate(sx(c), sy(c));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pos.pose === 'surf') {
      // spray behind the board, then the board rocking on the waves
      ctx.fillStyle = rgb(pal.foam);
      for (let k = 0; k < 7; k++) {
        const a = t * 3 + k * 1.7;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(a);
        ctx.fillRect(-16 - (k * 3 + (a % 4)), -3 - Math.abs(Math.sin(a * 1.3)) * 6, 1.8, 1.8);
      }
      ctx.globalAlpha = 1;
      ctx.rotate(0.12 * Math.sin(t * 2.1));
      ctx.fillStyle = pink;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(0, -1.5, 15, 2.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // the rider: crouched with arms out on the board, legs swinging when running, tucked
    // in the jump
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    const hip = [0, pos.pose === 'surf' ? -14 : -16];
    const swing = pos.pose === 'run' ? Math.sin(pos.stride * Math.PI) : 0;
    if (pos.pose === 'jump') {
      line([[-3, -8], hip, [4, -9]]);
      line([[-3, -8], [-6, -4]]);
      line([[4, -9], [7, -5]]);
    } else if (pos.pose === 'run') {
      line([[6 * swing, -1], [3 * swing + 2, -8], hip]);
      line([[-6 * swing, -1], [-3 * swing + 2, -8], hip]);
    } else {
      line([[-5, -4], [-3, -9], hip, [3, -9], [6, -4]]);
    }
    ctx.strokeStyle = pink;
    ctx.lineWidth = 3;
    line([hip, [2, -25]]);
    ctx.lineWidth = 1.6;
    if (pos.pose === 'jump') line([[-6, -32], [2, -24], [9, -32]]);
    else if (pos.pose === 'run') { line([[2, -23], [2 - 5 * swing, -17]]); line([[2, -23], [2 + 5 * swing, -17]]); }
    else line([[-9, -19], [2, -23], [11, -20]]);
    ctx.fillStyle = pink;
    ctx.beginPath(); ctx.arc(3, -29, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // the board left lying on the beach once the rider has jumped off
  function drawBoardOnBeach() {
    const h = Math.max(0, world.terrain(SURF_SHORE.u, SURF_SHORE.v));
    const c = toCam(SURF_SHORE.u, h + 1, SURF_SHORE.v);
    if (c[2] < NEAR) return;
    ctx.save();
    ctx.translate(sx(c), sy(c));
    ctx.globalAlpha = Math.max(0.2, fade(c[2]));
    ctx.fillStyle = rgb(pal.route);
    ctx.strokeStyle = rgb(pal.ink);
    ctx.lineWidth = 1;
    const k = Math.min(1, Math.max(0.4, 600 / c[2]));
    ctx.beginPath(); ctx.ellipse(0, 0, 13 * k, 2.4 * k, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---------- frame ----------
  let activeIndex = -1;
  function draw() {
    pal = isDark() ? PAL.dark : PAL.light;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const p = progress();
    const q = Math.min(1, p / HOLD) * SEGMENTS;
    const surfing = SURF && q < 1;
    const bs = bikeS(Math.max(0, q - (SURF ? 1 : 0)) / BIKE_SEGMENTS), bike = world.at(bs);
    const surfer = surfing ? surferAt(q, performance.now() / 1000) : null;
    if (surfer) setCamera(surfer.u, surfer.v, surfer.camH);
    // the camera follows the valley, not every zig and zag of the hairpins
    else { const fu = world.camU(bs); setCamera(fu, world.valley(fu), bike[2]); }

    drawDots(bike[0], bike[1]);
    drawRoute(bs);
    const stationS = world.stationS;
    let nearest = 0;
    stationS.forEach((ss, i) => { if (Math.abs(bs - ss) < Math.abs(bs - stationS[nearest])) nearest = i; });
    const atStation = Math.abs(bs - stationS[nearest]) < S_SPACING * 0.4;
    // farthest first, so nearer flags lie on top
    const depth = i => { const p = world.at(stationS[i]); return toCam(p[0], 0, p[1])[2]; };
    stationS.map((ss, i) => i).sort((a, b) => depth(b) - depth(a))
      .forEach(i => drawFlag(stations[i], stationS[i], atStation && !surfer && i === nearest));
    if (SURF && !(surfer && surfer.pose === 'surf')) drawBoardOnBeach();
    drawBike(bs, !surfer);
    if (surfer) drawSurfer(surfer, performance.now() / 1000);

    // the first station's card appears once the rider has landed on the bike
    updateCard(atStation && !surfer ? nearest : -1);
    animateSea();
    hint.classList.toggle('visible', p < 0.02);
    trackBike.style.left = (Math.max(0, bs - world.keyS[0]) / (S_END - world.keyS[0]) * 100) + '%';
  }

  function updateCard(i) {
    card.classList.toggle('visible', i >= 0);
    if (i < 0 || i === activeIndex) return;
    activeIndex = i;
    const st = stations[i];
    card.querySelector('.fa-solid').className = 'fa-solid ' + (st.work ? 'fa-briefcase' : 'fa-graduation-cap');
    card.querySelector('.vita-card-time').textContent = st.time;
    card.querySelector('.vita-card-place').textContent = st.place;
    card.querySelector('.vita-card-title').textContent = st.title;
    // the card is only a view of the list above (kept for screen readers), so its links
    // stay out of the tab order
    cardSub.innerHTML = st.subtitle;
    cardSub.querySelectorAll('a').forEach(a => a.setAttribute('tabindex', '-1'));
    stops.forEach((b, k) => b.classList.toggle('active', k === i));
  }

  // stops on the progress track below the scene, one per station
  const stops = stations.map((st, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vita-stop';
    b.style.left = ((world.stationS[i] - world.keyS[0]) / (S_END - world.keyS[0]) * 100) + '%';
    b.innerHTML = '<span>' + st.year + '</span>';
    b.setAttribute('aria-label', 'Ride to ' + st.place + ', ' + st.time);
    b.addEventListener('click', () => scrollToStation(i));
    trackLine.appendChild(b);
    return b;
  });

  // ---------- sizing, events ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    // full window width (without the scrollbar), out of the text column
    stage.style.width = document.documentElement.clientWidth + 'px';
    stage.style.marginLeft = '0px';
    stage.style.marginLeft = -stage.getBoundingClientRect().left + 'px';
    W = stage.clientWidth; H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // the length of the ride only follows width changes, so the page doesn't jump when a
    // phone's address bar shows or hides
    if (W !== lastWidth || !rideHeight) {
      lastWidth = W;
      stageHeight = stage.offsetHeight;
      rideHeight = Math.round(SEGMENTS * Math.max(480, window.innerHeight * 0.9) / HOLD + stageHeight);
      ride.style.height = rideHeight + 'px';
    }
    draw();
  }

  // while sea is in view, keep redrawing (about 30 times a second) so the waves move
  let rideVisible = false, animating = false, lastFrame = 0;
  function animateSea() {
    if (animating || !seaVisible || !rideVisible) return;
    animating = true;
    requestAnimationFrame(function tick(now) {
      if (!seaVisible || !rideVisible) { animating = false; return; }
      if (now - lastFrame > 32) { lastFrame = now; draw(); }
      requestAnimationFrame(tick);
    });
  }
  if (window.IntersectionObserver) {
    new IntersectionObserver(entries => {
      rideVisible = entries[0].isIntersecting;
      animateSea();
    }).observe(ride);
  }

  let queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; draw(); });
  }

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', resize);
  new MutationObserver(queue).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
  resize();
})();
