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
    const pts = [];
    for (let x0 = -8; x0 <= width + 8; x0 += 1.5) {
      // distance from the heading; the waves grow out of the flat line next to it and
      // swell and shrink a bit
      const d0 = w.left ? width - x0 : x0;
      const grow = Math.min(1, Math.max(0, d0) / 36);
      const amp = AMP * grow * (0.7 + 0.3 * Math.sin(d0 * 0.017 + s)) * (1 + swell);
      // sea waves (trochoids): sharp crests, long flat troughs; a smaller wave rides on top
      const X = left + x0;
      const a = K * X - phase, b = 2.3 * K * X - 1.4 * phase + s;
      // (kept below 1 together, or the line would loop back on itself)
      const steep = Math.min(0.7, amp / AMP * 0.6);
      const x = x0 - steep / K * Math.sin(a) - 0.12 * grow / K * Math.sin(b);
      // and the hand that drew it wanders a little
      const y = mid - amp * Math.cos(a) - 0.6 * grow * Math.cos(b) + 0.45 * Math.sin(d0 * 0.05 + s * 3);
      if (x >= 0 && x <= width) pts.push([x, y, (w.left ? width - x : x) / width]);
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
      ctx.globalAlpha = Math.min(1, (1 - t) / 0.4);
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
