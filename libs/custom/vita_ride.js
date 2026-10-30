/* Vita as a bike ride: the timeline entries (index.html, _data/experience.yaml) become
   stations along a road through a small 3D landscape of fields, hedgerows, trees and wind
   turbines, with the Baltic Sea in the distance. Scrolling through the section rides the bike from the oldest station to the
   newest; the bike slows down at each station and its details show in a card.
   Drawn on a canvas with a little perspective camera (no 3D library). Without JS, or with
   reduced motion, the plain timeline stays. */
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
  ride.className = 'vita-ride';
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
      '<div class="vita-hint" aria-hidden="true"><i class="fa-solid fa-angles-down"></i> Scroll to ride along</div>' +
      '<div class="vita-track"><div class="vita-track-line"><div class="vita-track-bike"><i class="fa-solid fa-person-biking"></i></div></div></div>' +
      '</div>' +
    '</div>';
  list.parentNode.insertBefore(ride, list);
  section.classList.add('vita-ride-on');

  const stage = ride.querySelector('.vita-stage');
  const canvas = ride.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const card = ride.querySelector('.vita-card');
  const hint = ride.querySelector('.vita-hint');
  const trackLine = ride.querySelector('.vita-track-line');
  const trackBike = ride.querySelector('.vita-track-bike');
  // the card is only a view of the list above (kept for screen readers), so its links stay
  // out of the tab order
  const cardSub = card.querySelector('.vita-card-sub');

  // ---------- route ----------
  const SPACING = 900;           // road length between two stations
  const START = -0.55 * SPACING; // where the bike sets off, a little before the first station
  const ROAD_W = 64;
  const stationU = stations.map((_, i) => i * SPACING);
  // the bike's stops: the start, then every station
  const keyU = [START].concat(stationU);
  // gentle bends: the road's lateral position for a position u along it
  const roadV = u => 110 * Math.sin(u / 620) + 55 * Math.sin(u / 260 + 1.3);
  const roadSlope = u => 110 / 620 * Math.cos(u / 620) + 55 / 260 * Math.cos(u / 260 + 1.3);
  // the shore far behind the fields: the sea lies along the horizon
  const coastV = u => roadV(u) - 1500 - 260 * Math.sin(u / 900 + 0.7);
  const onLand = (u, v, margin) => v > coastV(u) + margin;

  // the scenery is the same on every visit
  function prng(seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash2(i, j) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }

  const CELL_U = 340, CELL_V = 260; // fields
  const nearStation = (u, v) =>
    stationU.some(su => Math.abs(u - su) < 170 && v < roadV(su) && v > roadV(su) - 300);

  const trees = [];
  (function plantTrees() {
    const rand = prng(7);
    const uFrom = START - 2000, uTo = stationU[N - 1] + 6000;
    // scattered trees, more on the far side of the road
    for (let u = uFrom; u < uTo; u += 40) {
      if (rand() < 0.5) {
        const v = roadV(u) - (ROAD_W / 2 + 35 + Math.pow(rand(), 1.6) * 1500);
        if (onLand(u, v, 50) && !nearStation(u, v)) trees.push({ u: u + rand() * 30, v, size: 0.8 + rand() * 0.6, kind: rand() < 0.3 ? 1 : 0, shade: rand() });
      }
      if (rand() < 0.22) {
        const v = roadV(u) + ROAD_W / 2 + 40 + rand() * 450;
        trees.push({ u: u + rand() * 30, v, size: 0.8 + rand() * 0.5, kind: rand() < 0.3 ? 1 : 0, shade: rand() });
      }
    }
    // hedgerows with trees along some field borders (the "Knicks" of Schleswig-Holstein)
    for (let j = -16; j <= 3; j++) {
      if (hash2(99, j) < 0.45) continue;
      for (let u = uFrom; u < uTo; u += 55 + rand() * 60) {
        const v = j * CELL_V;
        if (Math.abs(v - roadV(u)) < ROAD_W / 2 + 30 || !onLand(u, v, 50) || nearStation(u, v)) continue;
        if (rand() < 0.6) trees.push({ u, v: v + (rand() - 0.5) * 16, size: 0.75 + rand() * 0.5, kind: 0, shade: rand() });
      }
    }
  })();

  const turbines = [];
  (function placeTurbines() {
    const rand = prng(3);
    for (let u = START - 3000; u < stationU[N - 1] + 7000; u += 650 + rand() * 600) {
      // most of them on the land, a few out at sea
      const v = rand() < 0.75 ? roadV(u) - 350 - rand() * 1000 : coastV(u) - 400 - rand() * 1500;
      turbines.push({ u, v, phase: rand() * 6.28, size: 0.85 + rand() * 0.3 });
    }
  })();

  const boats = [];
  (function placeBoats() {
    const rand = prng(17);
    for (let u = START - 2500; u < stationU[N - 1] + 6000; u += 500 + rand() * 700) {
      boats.push({ u, v: coastV(u) - 200 - rand() * 1800, size: 0.9 + rand() * 0.5, stripe: rand() < 0.5 });
    }
  })();

  // a lighthouse on the shore, ahead of the last station
  const LIGHTHOUSE_U = stationU[N - 1] + 700;
  const lighthouse = { u: LIGHTHOUSE_U, v: coastV(LIGHTHOUSE_U) + 20 };

  // ---------- colours ----------
  const PALETTES = {
    light: {
      skyTop: [152, 198, 238], skyBottom: [252, 228, 236], fog: [241, 230, 238],
      sea: [96, 168, 200], sand: [236, 222, 186], foam: [255, 255, 255], hull: [70, 64, 82], sail: [255, 255, 255],
      hedge: [74, 116, 64], groundNear: [86, 130, 70],
      fields: [[124, 170, 88], [146, 186, 98], [108, 158, 84], [232, 208, 76], [216, 194, 132], [168, 128, 96], [132, 176, 100]],
      stripes: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [196, 170, 108], [140, 104, 78], [0, 0, 0, 0]],
      road: [124, 118, 132], shoulder: [196, 186, 170], dash: [255, 255, 255],
      trunk: [112, 84, 64], leaves: [[78, 130, 66], [98, 150, 72], [62, 112, 62]], conifer: [52, 98, 72],
      hillsFar: [170, 186, 210], hillsNear: [138, 170, 140],
      turbine: [250, 250, 252],
      board: [255, 255, 255], boardText: [40, 40, 40], boardMuted: [110, 110, 110], post: [128, 116, 104],
      work: [138, 43, 226], school: [255, 105, 180],
      frame: [255, 105, 180], jersey: [138, 43, 226], shorts: [44, 40, 52], skin: [241, 201, 168],
      helmet: [255, 255, 255], tyre: [40, 38, 44], spokes: [150, 150, 160],
      shadow: 'rgba(30, 40, 20, 0.22)',
    },
    dark: {
      skyTop: [10, 9, 22], skyBottom: [56, 40, 86], fog: [38, 31, 60],
      sea: [28, 40, 72], sand: [66, 60, 72], foam: [150, 150, 190], hull: [16, 14, 22], sail: [170, 164, 196],
      hedge: [20, 30, 34], groundNear: [26, 38, 40],
      fields: [[36, 56, 52], [42, 64, 56], [32, 50, 50], [74, 70, 52], [62, 58, 54], [48, 40, 46], [40, 60, 58]],
      stripes: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [54, 50, 48], [40, 34, 40], [0, 0, 0, 0]],
      road: [56, 52, 66], shoulder: [76, 70, 84], dash: [205, 195, 225],
      trunk: [46, 38, 40], leaves: [[32, 56, 54], [40, 66, 60], [26, 48, 50]], conifer: [24, 44, 48],
      hillsFar: [48, 40, 76], hillsNear: [32, 38, 56],
      turbine: [150, 144, 172],
      board: [33, 31, 40], boardText: [230, 227, 234], boardMuted: [163, 158, 172], post: [84, 78, 96],
      work: [176, 138, 245], school: [255, 105, 180],
      frame: [255, 105, 180], jersey: [176, 138, 245], shorts: [24, 22, 30], skin: [214, 178, 152],
      helmet: [235, 230, 245], tyre: [14, 13, 18], spokes: [120, 114, 138],
      shadow: 'rgba(0, 0, 0, 0.35)',
    },
  };
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const rgb = (c, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const FOG_FROM = 350, FOG_TO = 4300;
  let pal = PALETTES.light;
  const fogT = z => Math.min(1, Math.max(0, (z - FOG_FROM) / (FOG_TO - FOG_FROM))) ** 0.75;
  const fogged = (c, z) => mix(c, pal.fog, fogT(z));

  // ---------- camera ----------
  const NEAR = 30;
  const cam = { x: 0, y: 0, z: 0 };
  let R, U, Fw, F, cx, cy, W = 1, H = 1, dpr = 1;

  function setCamera(bu) {
    const bv = roadV(bu);
    // look a little ahead of the bike, from the near side of the road and slightly behind it
    const ahead = 150 * Math.min(1, W / H);
    const tx = bu + ahead, ty = 6, tz = (roadV(tx) + bv) / 2;
    const dx = 0.56, dz = -0.83, dist = 430;
    cam.x = tx - dx * dist; cam.y = 118; cam.z = tz - dz * dist;
    Fw = norm([tx - cam.x, ty - cam.y, tz - cam.z]);
    R = norm([-Fw[2], 0, Fw[0]]);
    U = [R[1] * Fw[2] - R[2] * Fw[1], R[2] * Fw[0] - R[0] * Fw[2], R[0] * Fw[1] - R[1] * Fw[0]];
    F = Math.min(W * 0.95, H * 1.05);
    cx = W / 2; cy = H * 0.5;
  }
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
  // world (u along the road, height, v across it) to camera space
  function toCam(x, y, z) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    return [dx * R[0] + dy * R[1] + dz * R[2], dx * U[0] + dy * U[1] + dz * U[2], dx * Fw[0] + dy * Fw[1] + dz * Fw[2]];
  }
  const sx = c => cx + F * c[0] / c[2];
  const sy = c => cy - F * c[1] / c[2];

  // a flat polygon on the ground, cut off where it passes behind the camera
  function groundPoly(pts, color) {
    const cs = pts.map(p => toCam(p[0], 0, p[1]));
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    if (out.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(sx(out[0]), sy(out[0]));
    for (let i = 1; i < out.length; i++) ctx.lineTo(sx(out[i]), sy(out[i]));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ---------- scroll position to bike position ----------
  let rideHeight = 0, stageHeight = 0, lastWidth = 0;
  function progress() {
    const top = parseFloat(getComputedStyle(stage).top) || 0;
    const travel = rideHeight - stageHeight;
    return travel > 0 ? Math.min(1, Math.max(0, (top - ride.getBoundingClientRect().top) / travel)) : 0;
  }
  // between two stops the bike speeds up and then slows down again, lingering at each
  // station without ever quite stopping
  function bikeU(p) {
    const s = p * N, i = Math.min(N - 1, Math.floor(s)), f = s - i;
    const e = f - Math.sin(2 * Math.PI * f) * 0.85 / (2 * Math.PI);
    return keyU[i] + (keyU[i + 1] - keyU[i]) * e;
  }
  function scrollToStation(i) {
    const top = parseFloat(getComputedStyle(stage).top) || 0;
    const rideTop = ride.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: rideTop - top + (i + 1) / N * (rideHeight - stageHeight) + 1, behavior: 'smooth' });
  }

  // ---------- sky, hills ----------
  function drawSky(horizon, bu) {
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    g.addColorStop(0, rgb(pal.skyTop));
    g.addColorStop(1, rgb(pal.skyBottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 1);

    if (isDark()) {
      // stars, a faint band of the Milky Way and the moon
      const band = ctx.createLinearGradient(W * 0.15, 0, W * 0.75, horizon);
      band.addColorStop(0, 'rgba(176, 138, 245, 0)');
      band.addColorStop(0.45, 'rgba(176, 138, 245, 0.10)');
      band.addColorStop(0.55, 'rgba(255, 205, 175, 0.08)');
      band.addColorStop(0.7, 'rgba(110, 145, 240, 0.08)');
      band.addColorStop(1, 'rgba(110, 145, 240, 0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, W, horizon);
      const rand = prng(11);
      const tints = window.MILKY_WAY || [[255, 255, 255]];
      for (let i = 0; i < 140; i++) {
        const x = ((rand() * (W + 200) - bu * 0.02) % (W + 200) + W + 200) % (W + 200) - 100;
        const y = rand() * horizon * 0.95;
        const r = 0.4 + rand() * 1.1;
        ctx.fillStyle = rgb(tints[i % tints.length].map(v => v + (255 - v) * 0.5), 0.35 + rand() * 0.6);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      const mx = W * 0.5, my = horizon * 0.32, mr = Math.max(10, H * 0.03);
      const glow = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
      glow.addColorStop(0, 'rgba(235, 228, 255, 0.25)');
      glow.addColorStop(1, 'rgba(235, 228, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
      ctx.fillStyle = '#f1ecfb';
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb(pal.skyTop.map((v, k) => v * 0.5 + pal.skyBottom[k] * 0.5));
      ctx.beginPath(); ctx.arc(mx + mr * 0.45, my - mr * 0.25, mr * 0.88, 0, Math.PI * 2); ctx.fill();
    } else {
      // sun and a few clouds drifting past
      const sunX = W * 0.5, sunY = horizon * 0.35, sr = Math.max(14, H * 0.04);
      const glow = ctx.createRadialGradient(sunX, sunY, sr * 0.6, sunX, sunY, sr * 5);
      glow.addColorStop(0, 'rgba(255, 244, 214, 0.75)');
      glow.addColorStop(1, 'rgba(255, 244, 214, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sunX - sr * 5, sunY - sr * 5, sr * 10, sr * 10);
      ctx.fillStyle = '#fff6dc';
      ctx.beginPath(); ctx.arc(sunX, sunY, sr, 0, Math.PI * 2); ctx.fill();
      const rand = prng(5);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      for (let i = 0; i < 6; i++) {
        const span = W + 300;
        const x = ((rand() * span - bu * (0.03 + rand() * 0.03)) % span + span) % span - 150;
        const y = horizon * (0.12 + rand() * 0.55);
        const w = 40 + rand() * 70;
        ctx.beginPath();
        ctx.ellipse(x, y, w, w * 0.22, 0, 0, Math.PI * 2);
        ctx.ellipse(x - w * 0.3, y - w * 0.12, w * 0.4, w * 0.25, 0, 0, Math.PI * 2);
        ctx.ellipse(x + w * 0.25, y - w * 0.16, w * 0.32, w * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---------- ground: fields and the road ----------
  function drawGround(horizon, bu) {
    // the sea along the horizon; the land is laid on top of it
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, rgb(mix(pal.sea, pal.fog, 0.6)));
    g.addColorStop(0.25, rgb(mix(pal.sea, pal.fog, 0.3)));
    g.addColorStop(1, rgb(pal.sea));
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, H - horizon);
    drawGlitter(horizon);

    // surf, beach and the land behind it, in strips along the shore
    const from = bu - 1300, to = bu + 4800;
    for (let u = from; u < to;) {
      const depth = Math.max(NEAR, toCam(u, 0, coastV(u))[2]);
      const u2 = u + Math.max(30, depth * 0.05), u3 = u2 + 2;
      const shore = (uu, off) => [uu, coastV(uu) + off];
      const near = uu => [uu, roadV(uu) + 2500];
      groundPoly([shore(u, -16), shore(u3, -16), shore(u3, -6), shore(u, -6)], rgb(fogged(pal.foam, depth), 0.5));
      groundPoly([shore(u, -4), shore(u3, -4), near(u3), near(u)], rgb(fogged(pal.sand, depth)));
      groundPoly([shore(u, 40), shore(u3, 40), near(u3), near(u)], rgb(fogged(pal.hedge, Math.max(NEAR, toCam(u, 0, roadV(u))[2]))));
      u = u2;
    }

    // fields, cut off along the beach
    const bv = roadV(bu), gap = 6;
    const i0 = Math.floor(from / CELL_U), i1 = Math.floor(to / CELL_U);
    const j0 = Math.floor((bv - 2000) / CELL_V), j1 = Math.floor((bv + 800) / CELL_V);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const u0 = i * CELL_U + gap, u1 = (i + 1) * CELL_U - gap;
        const v0 = j * CELL_V + gap, v1 = (j + 1) * CELL_V - gap;
        const edge = [];
        for (let k = 0; k <= 4; k++) {
          const u = u0 + (u1 - u0) * k / 4;
          edge.push([u, Math.min(v1, Math.max(v0, coastV(u) + 48))]);
        }
        if (edge.every(q => q[1] >= v1 - 12)) continue;
        const depth = toCam((u0 + u1) / 2, 0, (v0 + v1) / 2)[2];
        if (depth > FOG_TO + 400 || depth < -CELL_U) continue;
        const kind = Math.floor(hash2(i, j) * pal.fields.length);
        groundPoly(edge.concat([[u1, v1], [u0, v1]]), rgb(fogged(pal.fields[kind], depth)));
        // crop rows on ploughed land and grain (not where the field runs into the beach)
        const stripe = pal.stripes[kind];
        if (stripe[3] !== 0 && depth < 2600 && edge.every(q => q[1] === v0)) {
          const col = rgb(fogged(stripe, depth), 0.7);
          for (let k = 1; k < 6; k++) {
            const v = v0 + (v1 - v0) * k / 6;
            groundPoly([[u0, v - 5], [u1, v - 5], [u1, v + 5], [u0, v + 5]], col);
          }
        }
      }
    }
  }

  // the sun (or moon) glittering on the water below it
  function drawGlitter(horizon) {
    const x = W * 0.5, rand = prng(23);
    const light = isDark() ? [235, 228, 255] : [255, 246, 214];
    for (let k = 0; k < 18; k++) {
      const t = rand();
      const y = horizon + 2 + t * t * H * 0.12;
      const w = (4 + t * 30) * (0.4 + rand());
      ctx.fillStyle = rgb(light, (1 - t) * (isDark() ? 0.4 : 0.7));
      ctx.fillRect(x - w / 2 + (rand() - 0.5) * (6 + t * 40), y, w, 1 + t * 1.5);
    }
  }

  function drawRoad(bu) {
    const from = bu - 900, to = bu + 4800;
    let u = from;
    while (u < to) {
      const depth = toCam(u, 0, roadV(u))[2];
      const step = Math.max(24, depth * 0.05);
      const u2 = u + step;
      const edge = (uu, w) => {
        const v = roadV(uu), sl = roadSlope(uu), l = Math.hypot(1, sl);
        // normal of the road's centre line on the ground
        return [[uu + sl * w / l, v - w / l], [uu - sl * w / l, v + w / l]];
      };
      const a = edge(u, ROAD_W / 2 + 7), b = edge(u2 + 2, ROAD_W / 2 + 7);
      groundPoly([a[0], b[0], b[1], a[1]], rgb(fogged(pal.shoulder, depth)));
      const c = edge(u, ROAD_W / 2), d = edge(u2 + 2, ROAD_W / 2);
      groundPoly([c[0], d[0], d[1], c[1]], rgb(fogged(pal.road, depth)));
      u = u2;
    }
    // dashed centre line
    for (let du = Math.floor(from / 60) * 60; du < Math.min(to, bu + 3000); du += 60) {
      const depth = toCam(du, 0, roadV(du))[2];
      if (depth < NEAR) continue;
      const v = roadV(du), v2 = roadV(du + 28);
      groundPoly([[du, v - 1.6], [du + 28, v2 - 1.6], [du + 28, v2 + 1.6], [du, v + 1.6]], rgb(fogged(pal.dash, depth), 0.9));
    }
  }

  // ---------- things standing in the landscape ----------
  function drawTree(t, x, y, s, z) {
    const h = 60 * t.size * s;
    const leaves = fogged(t.kind === 1 ? pal.conifer : pal.leaves[Math.floor(t.shade * pal.leaves.length)], z);
    ctx.fillStyle = pal.shadow;
    ctx.beginPath(); ctx.ellipse(x + h * 0.08, y, h * 0.32, h * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(fogged(pal.trunk, z));
    ctx.fillRect(x - h * 0.045, y - h * 0.38, h * 0.09, h * 0.38);
    if (t.kind === 1) {
      ctx.fillStyle = rgb(leaves);
      for (let k = 0; k < 3; k++) {
        const base = y - h * (0.2 + k * 0.24), w = h * (0.34 - k * 0.07);
        ctx.beginPath();
        ctx.moveTo(x - w, base); ctx.lineTo(x + w, base); ctx.lineTo(x, base - h * 0.42);
        ctx.closePath(); ctx.fill();
      }
    } else {
      const r = h * 0.3;
      ctx.fillStyle = rgb(leaves);
      ctx.beginPath();
      ctx.arc(x, y - h * 0.62, r, 0, Math.PI * 2);
      ctx.arc(x - r * 0.65, y - h * 0.5, r * 0.75, 0, Math.PI * 2);
      ctx.arc(x + r * 0.65, y - h * 0.48, r * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(mix(leaves, [255, 255, 255], isDark() ? 0.06 : 0.14));
      ctx.beginPath(); ctx.arc(x - r * 0.25, y - h * 0.72, r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawTurbine(t, x, y, s, z, bu) {
    const h = 330 * t.size * s;
    const col = rgb(fogged(pal.turbine, z));
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - h * 0.022, y); ctx.lineTo(x + h * 0.022, y);
    ctx.lineTo(x + h * 0.009, y - h); ctx.lineTo(x - h * 0.009, y - h);
    ctx.closePath(); ctx.fill();
    const a0 = t.phase + bu / 140;
    for (let k = 0; k < 3; k++) {
      const a = a0 + k * Math.PI * 2 / 3;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + Math.cos(a + 0.06) * h * 0.1, y - h + Math.sin(a + 0.06) * h * 0.1);
      ctx.lineTo(x + Math.cos(a) * h * 0.4, y - h + Math.sin(a) * h * 0.4);
      ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y - h, h * 0.02, 0, Math.PI * 2); ctx.fill();
  }

  function drawBoat(b, x, y, s, z) {
    const h = 46 * b.size * s;
    ctx.fillStyle = rgb(fogged(pal.hull, z));
    ctx.beginPath();
    ctx.moveTo(x - h * 0.42, y - h * 0.12); ctx.lineTo(x + h * 0.48, y - h * 0.12);
    ctx.lineTo(x + h * 0.32, y); ctx.lineTo(x - h * 0.34, y);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(x - h * 0.012, y - h, h * 0.024, h * 0.9);
    ctx.fillStyle = rgb(fogged(pal.sail, z));
    ctx.beginPath();
    ctx.moveTo(x + h * 0.03, y - h * 0.96); ctx.lineTo(x + h * 0.03, y - h * 0.2); ctx.lineTo(x + h * 0.4, y - h * 0.2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - h * 0.03, y - h * 0.86); ctx.lineTo(x - h * 0.03, y - h * 0.2); ctx.lineTo(x - h * 0.3, y - h * 0.2);
    ctx.closePath(); ctx.fill();
    if (b.stripe) {
      ctx.fillStyle = rgb(fogged(pal.school, z));
      ctx.fillRect(x + h * 0.03, y - h * 0.3, h * 0.3, h * 0.06);
    }
  }

  function drawLighthouse(x, y, s, z) {
    const h = 170 * s, wb = 17 * s, wt = 10 * s;
    const red = fogged([214, 64, 76], z), white = fogged(isDark() ? [150, 146, 170] : [255, 255, 255], z);
    // red and white bands on a tapering tower
    for (let k = 0; k < 6; k++) {
      const t0 = k / 6, t1 = (k + 1) / 6;
      const w0 = wb + (wt - wb) * t0, w1 = wb + (wt - wb) * t1;
      ctx.fillStyle = rgb(k % 2 ? white : red);
      ctx.beginPath();
      ctx.moveTo(x - w0, y - h * 0.82 * t0); ctx.lineTo(x + w0, y - h * 0.82 * t0);
      ctx.lineTo(x + w1, y - h * 0.82 * t1); ctx.lineTo(x - w1, y - h * 0.82 * t1);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = rgb(fogged(pal.hull, z));
    ctx.fillRect(x - wt * 1.4, y - h * 0.84, wt * 2.8, h * 0.03);
    ctx.fillStyle = isDark() ? '#fff4d6' : rgb(fogged([250, 236, 190], z));
    ctx.fillRect(x - wt * 0.8, y - h * 0.94, wt * 1.6, h * 0.1);
    ctx.fillStyle = rgb(red);
    ctx.beginPath();
    ctx.moveTo(x - wt * 1.1, y - h * 0.94); ctx.lineTo(x + wt * 1.1, y - h * 0.94); ctx.lineTo(x, y - h);
    ctx.closePath(); ctx.fill();
    if (isDark()) {
      // its light shining out over the sea
      const ly = y - h * 0.89;
      const glow = ctx.createRadialGradient(x, ly, 0, x, ly, h * 0.3);
      glow.addColorStop(0, 'rgba(255, 244, 214, 0.7)');
      glow.addColorStop(1, 'rgba(255, 244, 214, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - h * 0.3, ly - h * 0.3, h * 0.6, h * 0.6);
      const beam = ctx.createLinearGradient(x, ly, x - h * 1.8, ly);
      beam.addColorStop(0, 'rgba(255, 244, 214, 0.3)');
      beam.addColorStop(1, 'rgba(255, 244, 214, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x, ly); ctx.lineTo(x - h * 1.8, ly - h * 0.12); ctx.lineTo(x - h * 1.8, ly + h * 0.08);
      ctx.closePath(); ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const FONT = 'Raleway, "HelveticaNeue", "Helvetica Neue", Helvetica, Arial, sans-serif';
  const ICON_FONT = '"Font Awesome 6 Free"';

  // a signpost with the place and the years; the station the bike is at glows
  function drawSign(st, x, y, s, z, active) {
    const accent = st.work ? pal.work : pal.school;
    const k = Math.min(s, 1.35);
    const postH = 62 * s;
    ctx.fillStyle = pal.shadow;
    ctx.beginPath(); ctx.ellipse(x + 6 * s, y, 14 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(fogged(pal.post, z));
    ctx.fillRect(x - 2.2 * s, y - postH, 4.4 * s, postH);

    const placeSize = 15 * k, timeSize = 11 * k, pad = 9 * k, iconW = 22 * k;
    ctx.font = `600 ${placeSize}px ${FONT}`;
    const placeW = ctx.measureText(st.place).width;
    ctx.font = `${timeSize}px ${FONT}`;
    const timeW = ctx.measureText(st.time).width;
    const bw = iconW + Math.max(placeW, timeW) + pad * 2.2, bh = placeSize + timeSize + pad * 2.1;
    const bx = x - bw / 2, by = y - postH - bh + 4 * k;
    const fade = fogT(z);

    ctx.save();
    ctx.globalAlpha = 1 - fade * 0.7;
    if (active) {
      ctx.shadowColor = rgb(accent, 0.8);
      ctx.shadowBlur = 18 * k;
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
      ctx.shadowBlur = 6 * k;
      ctx.shadowOffsetY = 2 * k;
    }
    roundRect(bx, by, bw, bh, 6 * k);
    ctx.fillStyle = rgb(pal.board);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1, (active ? 2.4 : 1.4) * k);
    ctx.strokeStyle = rgb(accent, active ? 1 : 0.6);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgb(accent);
    ctx.font = `900 ${13 * k}px ${ICON_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(st.work ? '' : '', bx + pad + iconW / 2 - 3 * k, by + bh / 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = rgb(pal.boardText);
    ctx.font = `600 ${placeSize}px ${FONT}`;
    ctx.fillText(st.place, bx + pad + iconW, by + pad + placeSize / 2);
    ctx.fillStyle = rgb(pal.boardMuted);
    ctx.font = `${timeSize}px ${FONT}`;
    ctx.fillText(st.time, bx + pad + iconW, by + pad + placeSize + timeSize / 2 + 2 * k);
    ctx.restore();
  }

  // ---------- the bike ----------
  // two bones from a to the end point b, bending towards the side `bend` (+1 / -1)
  function joint(a, b, l1, l2, bend) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
    const base = Math.atan2(dy, dx);
    const alpha = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
    return [a[0] + l1 * Math.cos(base - bend * alpha), a[1] + l1 * Math.sin(base - bend * alpha)];
  }
  function line(pts, width, color) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  const WHEEL = 11;
  const REAR = [-17, -WHEEL], FRONT = [17, -WHEEL], BB = [-3, -10];
  const SEAT = [-7, -29], HEAD_TOP = [12, -30.5], HEAD_LOW = [13.4, -25];
  const HIP = [-8, -35], SHOULDER = [7, -49], HANDS = [16.5, -32];

  function drawBike(x, y, s, squash, bu) {
    const dark = isDark();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * squash, s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (dark) {
      // headlight on the road ahead
      const beam = ctx.createRadialGradient(22, -4, 2, 70, -2, 70);
      beam.addColorStop(0, 'rgba(255, 244, 214, 0.55)');
      beam.addColorStop(1, 'rgba(255, 244, 214, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(20, -20);
      ctx.lineTo(140, -14);
      ctx.lineTo(140, 10);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = pal.shadow;
    ctx.beginPath(); ctx.ellipse(0, 0, 30, 3.6, 0, 0, Math.PI * 2); ctx.fill();

    const crank = bu / (WHEEL * 2.4);
    const pedal = a => [BB[0] + 6 * Math.cos(a), BB[1] + 6 * Math.sin(a)];
    const leg = (a, shade) => {
      const foot = pedal(a);
      const knee = joint(HIP, foot, 17, 16.5, 1);
      line([HIP, knee], 5.4, rgb(mix(pal.shorts, [0, 0, 0], shade)));
      line([knee, foot], 4, rgb(mix(pal.skin, [0, 0, 0], shade)));
      line([foot, [foot[0] + 4.5, foot[1] + 0.6]], 3, rgb(mix(pal.shorts, [0, 0, 0], shade)));
    };

    // far leg behind the frame
    leg(crank + Math.PI, 0.35);

    // wheels
    const spin = bu / WHEEL;
    [REAR, FRONT].forEach(c => {
      ctx.beginPath(); ctx.arc(c[0], c[1], WHEEL, 0, Math.PI * 2);
      ctx.lineWidth = 2.4; ctx.strokeStyle = rgb(pal.tyre); ctx.stroke();
      ctx.lineWidth = 0.5; ctx.strokeStyle = rgb(pal.spokes);
      for (let k = 0; k < 8; k++) {
        const a = spin + k * Math.PI / 4;
        line([c, [c[0] + Math.cos(a) * (WHEEL - 1.2), c[1] + Math.sin(a) * (WHEEL - 1.2)]], 0.5, rgb(pal.spokes));
      }
      ctx.fillStyle = rgb(pal.spokes);
      ctx.beginPath(); ctx.arc(c[0], c[1], 1.2, 0, Math.PI * 2); ctx.fill();
    });

    // frame
    const frame = rgb(pal.frame);
    line([REAR, BB, SEAT, REAR], 1.8, frame);       // chain stay, seat tube, seat stay
    line([SEAT, HEAD_TOP], 2, frame);               // top tube
    line([BB, HEAD_LOW], 2.2, frame);               // down tube
    line([HEAD_TOP, HEAD_LOW, FRONT], 2, frame);    // head tube and fork
    line([SEAT, [-8, -32]], 1.6, rgb(pal.spokes));  // seat post
    line([[-12.5, -32.6], [-4, -32.6]], 2.2, rgb(pal.tyre)); // saddle
    line([HEAD_TOP, [12.4, -32.4], [16.5, -32.6]], 1.6, rgb(pal.spokes)); // stem
    ctx.beginPath();                                // drop bar
    ctx.moveTo(16.5, -32.6);
    ctx.quadraticCurveTo(20, -32, 18.8, -28.6);
    ctx.lineTo(16.6, -28.4);
    ctx.lineWidth = 1.6; ctx.strokeStyle = rgb(pal.tyre); ctx.stroke();
    ctx.beginPath(); ctx.arc(BB[0], BB[1], 2.6, 0, Math.PI * 2);
    ctx.lineWidth = 1; ctx.strokeStyle = rgb(pal.spokes); ctx.stroke();
    line([pedal(crank + Math.PI), pedal(crank)], 1.4, rgb(pal.spokes)); // cranks

    if (dark) {
      ctx.fillStyle = '#fff4d6';
      ctx.beginPath(); ctx.arc(19.5, -27, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff4d6a';
      ctx.beginPath(); ctx.arc(-10, -27.5, 1.2, 0, Math.PI * 2); ctx.fill();
    }

    // near leg, body, arm, head
    leg(crank, 0);
    line([HIP, SHOULDER], 8, rgb(pal.jersey));
    const elbow = joint(SHOULDER, HANDS, 10, 10, -1);
    line([SHOULDER, elbow], 3.6, rgb(pal.jersey));
    line([elbow, HANDS], 3, rgb(pal.skin));
    ctx.fillStyle = rgb(pal.skin);
    ctx.beginPath(); ctx.arc(12.4, -53, 4.3, 0, Math.PI * 2); ctx.fill();
    // helmet with a stripe in the frame colour
    ctx.fillStyle = rgb(pal.helmet);
    ctx.beginPath();
    ctx.ellipse(11.4, -55.6, 6, 4, -0.25, Math.PI * 0.95, Math.PI * 2.1);
    ctx.closePath(); ctx.fill();
    line([[6.6, -56.4], [16.2, -58]], 1.2, frame);

    ctx.restore();
  }

  // ---------- frame ----------
  let activeIndex = -1;
  function draw() {
    pal = isDark() ? PALETTES.dark : PALETTES.light;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = progress();
    const bu = bikeU(p);
    setCamera(bu);

    // horizon: where the flat ground meets the sky, far ahead of the camera
    const flat = norm([Fw[0], 0, Fw[2]]);
    const fu = flat[0] * U[0] + flat[2] * U[2], ff = flat[0] * Fw[0] + flat[2] * Fw[2];
    const horizon = cy - F * fu / ff;

    drawSky(horizon, bu);
    drawGround(horizon, bu);
    drawRoad(bu);

    // everything standing up, painted from the back to the front
    const items = [];
    const add = (u, v, kind, data) => {
      const c = toCam(u, 0, v);
      if (c[2] < NEAR * 2 || c[2] > FOG_TO + 1500) return;
      const x = sx(c);
      if (x < -400 || x > W + 400) return;
      items.push({ z: c[2], x, y: sy(c), s: F / c[2], kind, data });
    };
    // trees right in front of the camera would hide the bike
    trees.forEach(t => { if (t.u > bu - 1200 && t.u < bu + 4500 && toCam(t.u, 0, t.v)[2] > 320) add(t.u, t.v, 'tree', t); });
    turbines.forEach(t => { if (t.u > bu - 2500 && t.u < bu + 6000) add(t.u, t.v, 'turbine', t); });
    boats.forEach(b => { if (b.u > bu - 1500 && b.u < bu + 5000) add(b.u, b.v, 'boat', b); });
    add(lighthouse.u, lighthouse.v, 'lighthouse', null);
    let nearest = 0;
    stations.forEach((st, i) => {
      if (Math.abs(bu - stationU[i]) < Math.abs(bu - stationU[nearest])) nearest = i;
    });
    const atStation = Math.abs(bu - stationU[nearest]) < SPACING * 0.4;
    stations.forEach((st, i) => add(stationU[i], roadV(stationU[i]) - ROAD_W / 2 - 22, 'sign', { st, active: atStation && i === nearest }));
    add(bu, roadV(bu) + 8, 'bike', null);
    items.sort((a, b) => b.z - a.z);

    items.forEach(it => {
      if (it.kind === 'tree') drawTree(it.data, it.x, it.y, it.s, it.z);
      else if (it.kind === 'turbine') drawTurbine(it.data, it.x, it.y, it.s, it.z, bu);
      else if (it.kind === 'boat') drawBoat(it.data, it.x, it.y, it.s, it.z);
      else if (it.kind === 'lighthouse') drawLighthouse(it.x, it.y, it.s, it.z);
      else if (it.kind === 'sign') drawSign(it.data.st, it.x, it.y, it.s, it.z, it.data.active);
      else {
        // seen at an angle the bike looks shorter: squash it like the road below it
        const a = toCam(bu - 20, 0, roadV(bu - 20) + 8), b = toCam(bu + 20, 0, roadV(bu + 20) + 8);
        const squash = Math.min(1, Math.max(0.55, Math.abs(sx(b) - sx(a)) / (40 * it.s)));
        drawBike(it.x, it.y, it.s, squash, bu);
      }
    });

    updateCard(atStation ? nearest : -1);
    hint.classList.toggle('visible', p < 0.02);
    trackBike.style.left = (Math.max(0, bu - START) / (stationU[N - 1] - START) * 100) + '%';
  }

  function updateCard(i) {
    card.classList.toggle('visible', i >= 0);
    if (i < 0 || i === activeIndex) return;
    activeIndex = i;
    const st = stations[i];
    card.classList.toggle('work', st.work);
    card.querySelector('.fa-solid').className = 'fa-solid ' + (st.work ? 'fa-briefcase' : 'fa-graduation-cap');
    card.querySelector('.vita-card-time').textContent = st.time;
    card.querySelector('.vita-card-place').textContent = st.place;
    card.querySelector('.vita-card-title').textContent = st.title;
    cardSub.innerHTML = st.subtitle;
    cardSub.querySelectorAll('a').forEach(a => a.setAttribute('tabindex', '-1'));
    stops.forEach((b, k) => b.classList.toggle('active', k === i));
  }

  // stops on the progress track below the scene, one per station
  const stops = stations.map((st, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vita-stop' + (st.work ? ' work' : '');
    b.style.left = ((stationU[i] - START) / (stationU[N - 1] - START) * 100) + '%';
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
      rideHeight = Math.round(N * Math.max(420, window.innerHeight * 0.75) + stageHeight);
      ride.style.height = rideHeight + 'px';
    }
    draw();
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
