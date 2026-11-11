/* Scroll effects for the home page and the recipes, switched on with scroll_fx in _config.yml (styles in
   libs/custom/scroll_fx.css):
   - a fine, slightly hand-drawn wave line to the left and right of each section heading
     (not Bio), rolling sideways as the page scrolls
   - tiles, the publication and project lists, and headings slide up and fade in as they come into view */
(function () {
  'use strict';

  if (!window.IntersectionObserver) return;

  /* ---------- wave lines beside the headings ---------- */

  const K = 2 * Math.PI / 44;   // one crest every 44px
  const AMP = 3.4;              // height of a wave, px
  const SPEED = 0.05;           // how far the waves roll per px scrolled
  const BREAKING = 0.04;        // share of the waves that break (curl over)
  const CURL_H = 8;             // height of a breaking wave, px
  // A breaking wave, from trough to trough (traced from a hand-drawn one; x right, y up, one
  // wave = 160): it rises slowly, its crest rolls over forwards, and the line comes back
  // under it and down the hollow front in a C.
  const CURL = smooth([[0, 0], [40, 10], [65, 35], [80, 63], [100, 88], [125, 101], [155, 100],
    [175, 90], [188, 73], [180, 68], [160, 70], [145, 67], [132, 55], [128, 35], [135, 13], [160, 0]]);
  // a smooth curve through the points (Catmull-Rom), a few points between each two
  function smooth(P) {
    const out = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (let k = 0; k < 4; k++) {
        const t = k / 4, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t +
          (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3)));
      }
    }
    out.push(P[P.length - 1]);
    return out;
  }
  // scrolling fast stirs the sea up: the waves grow, then settle again
  let swell = 0, lastY = window.scrollY;

  const waves = [];
  document.querySelectorAll('.docs-section:not(#bio) > h3').forEach((h3, i) => {
    h3.classList.add('sfx-waved');
    ['left', 'right'].forEach((side, k) => {
      const canvas = document.createElement('canvas');
      canvas.className = 'sfx-wave';
      canvas.setAttribute('aria-hidden', 'true');
      if (k) h3.appendChild(canvas); else h3.insertBefore(canvas, h3.firstChild);
      // each line has its own wobble, so no two look the same
      waves.push({ canvas, h3, ctx: canvas.getContext('2d'), left: !k, seed: i * 2.3 + k * 1.7, shown: false });
    });
  });
  // recipe overview: the same wave line under each category heading instead of the straight
  // line; it widens from the middle on hover and when the category opens (scroll_fx.css)
  document.querySelectorAll('.recipe-category h3').forEach((h3, i) => {
    h3.classList.add('sfx-underlined');
    const clip = document.createElement('span');
    clip.className = 'sfx-underline';
    clip.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    clip.appendChild(canvas);
    h3.appendChild(clip);
    waves.push({ canvas, h3: clip, ctx: canvas.getContext('2d'), under: true, seed: i * 1.9 + 0.4, shown: false });
  });

  function drawWave(w) {
    const dpr = window.devicePixelRatio || 1;
    const width = w.canvas.clientWidth, height = w.canvas.clientHeight;
    if (!width) return;
    if (w.canvas.width !== Math.round(width * dpr) || w.canvas.height !== Math.round(height * dpr)) {
      w.canvas.width = Math.round(width * dpr);
      w.canvas.height = Math.round(height * dpr);
    }
    const ctx = w.ctx, s = w.seed;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // both lines are one sea passing behind the heading: the waves roll to the right as the
    // page scrolls down, to the left as it scrolls up
    const phase = window.scrollY * SPEED;
    const left = w.canvas.getBoundingClientRect().left;
    const mid = height / 2 + 1;
    // which crests break is fixed per crest (and line), so a breaking wave rolls along
    const breaks = n => { const r = Math.sin(n * 12.9898 + s * 78.233) * 43758.5453; return r - Math.floor(r) < BREAKING; };
    // one point of the line, for a point x0 along the canvas (before the waves shift it)
    function at(x0) {
      // distance from the heading; the waves grow out of the flat line next to it and
      // swell and shrink a bit
      // (under a recipe category: one even line, its ends fade out in scroll_fx.css)
      const d0 = w.left ? width - x0 : x0;
      const grow = w.under ? 0.8 : Math.min(1, Math.max(0, d0) / 36);
      const amp = AMP * grow * (0.7 + 0.3 * Math.sin(d0 * 0.017 + s)) * (1 + swell);
      // sea waves (trochoids): sharp crests, long flat troughs; a smaller wave rides on top
      const X = left + x0;
      const a = K * X - phase, b = 2.3 * K * X - 1.4 * phase + s;
      // (kept below 1 together, or the line would loop back on itself)
      const steep = Math.min(0.7, amp / AMP * 0.6);
      const x = x0 - steep / K * Math.sin(a) - 0.12 * grow / K * Math.sin(b);
      // and the hand that drew it wanders a little
      const y = mid - amp * Math.cos(a) - 0.6 * grow * Math.cos(b) + 0.45 * Math.sin(d0 * 0.05 + s * 3);
      return [x, y, grow];
    }
    // where along the canvas the wave phase is a
    const x0At = a => (a + phase) / K - left;
    const pts = [];
    const add = (x, y) => { if (x >= 0 && x <= width) pts.push([x, y, (w.left ? width - x : x) / width]); };
    let curled = null;
    for (let x0 = -8; x0 <= width + 8; x0 += 1.5) {
      // Now and then a wave breaks: in place of it (trough to trough) the curling wave
      const n = Math.round((K * (left + x0) - phase) / (2 * Math.PI));
      if (breaks(n) && at(x0At(2 * Math.PI * n))[2] > 0.6) {
        if (curled === n) continue;
        curled = n;
        const [xl, yl, gl] = at(x0At(2 * Math.PI * n - Math.PI));
        const [xr, yr, gr] = at(x0At(2 * Math.PI * n + Math.PI));
        // the crest and the curl keep the proportions of the drawing; the back slope before
        // it stretches over the rest of the wave
        const hgt = CURL_H * Math.min(gl, gr) * (1 + 0.4 * swell) / 101, f = 1.5 * hgt;
        const xs = xr - 60 * f;
        CURL.forEach(([u, v]) => add(u <= 100 ? xl + (xs - xl) * u / 100 : xr - (160 - u) * f,
                                     yl + (yr - yl) * u / 160 - v * hgt));
        continue;
      }
      const [x, y] = at(x0);
      add(x, y);
    }
    // both lines are drawn from the heading outwards
    if (w.left) pts.reverse();
    // drawn in short strokes, as if with a pen: a little thicker and thinner in places,
    // fading out towards the outer end
    const c = getComputedStyle(w.h3).color;
    ctx.strokeStyle = c;
    ctx.lineCap = ctx.lineJoin = 'round';
    for (let i = 0; i < pts.length - 1; i += 6) {
      const t = pts[i][2];
      ctx.globalAlpha = w.under ? 1 : Math.min(1, (1 - t) / 0.4);
      ctx.lineWidth = 1.15 + 0.4 * Math.sin(t * 9 + s) + 0.2 * Math.sin(t * 23 + s * 2);
      ctx.beginPath();
      ctx.moveTo(pts[i][0], pts[i][1]);
      for (let j = i + 1; j <= Math.min(i + 6, pts.length - 1); j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  // only the lines in view are drawn
  const inView = new IntersectionObserver(entries => entries.forEach(e => {
    const w = waves.find(w => w.canvas === e.target);
    w.shown = e.isIntersecting;
    if (w.shown) drawWave(w);
  }));
  waves.forEach(w => inView.observe(w.canvas));

  let queued = false;
  function redraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const y = window.scrollY;
      swell = Math.max(swell * 0.93, Math.min(0.7, Math.abs(y - lastY) / 60));
      lastY = y;
      waves.forEach(w => w.shown && drawWave(w));
      // keep going while the sea settles after scrolling
      if (swell > 0.01) redraw(); else swell = 0;
    });
  }
  window.addEventListener('scroll', redraw, { passive: true });
  window.addEventListener('resize', redraw);
  // the colours change with the theme
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- soft reveals ---------- */

  // the text under a heading comes in right after it, not before; the publications and the
  // student projects each come in as one block
  const items = document.querySelectorAll('.docs-section > h3, .docs-section > p, .docs-section > .tab-nav, ' +
    '.docs-section > .aligned-list, .research-tile, .docs-section > .tab-content, .student-project-list, ' +
    // recipes: the instructions and tips below the ingredients tile
    '.recipe > h3, .recipe > ol, .recipe > ul, .recipe > p');
  const seen = new IntersectionObserver(entries => {
    // what comes into view together slides in one after the other
    entries.filter(e => e.isIntersecting).forEach((e, k) => {
      e.target.style.setProperty('--sfx-delay', Math.min(k, 5) * 120 + 'ms');
      e.target.classList.add('sfx-in');
      seen.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px' });

  items.forEach(el => {
    // what is already on screen (or above it) when the page opens stays as it is: it has
    // been shown before this deferred script runs, and hiding it only to slide it back in
    // would make it flicker and jump
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.classList.add('sfx-reveal');
    // once in place, back to the plain element (no transform left over)
    el.addEventListener('transitionend', function done(e) {
      if (e.target !== el || !el.classList.contains('sfx-in')) return;
      el.classList.remove('sfx-reveal', 'sfx-in');
      el.style.removeProperty('--sfx-delay');
      el.removeEventListener('transitionend', done);
    });
    seen.observe(el);
  });
})();
