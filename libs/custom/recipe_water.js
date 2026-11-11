// Water light on the recipe pages, light mode only: light refracted by a moving water surface
// (caustics), drawn with WebGL (styles: recipe_water.css).
//  - Header: behind photo and name, full window width, with a pastel shimmer around the
//    pointer. In dark mode the header keeps its glitter and stars (_layouts/home.html).
//  - Recipe overview: a small patch of the same water behind the category heading under the
//    mouse, fading out around it.
// The shaders are heavy to compile, which blocks the page while it does, so all WebGL work
// waits until the page has loaded (see the end of this file).
document.addEventListener('DOMContentLoaded', function () {
  // The header shows the water, not the glitter, from the start: the glitter in
  // _layouts/home.html pauses while body has .water-header. Removed again without WebGL.
  if (document.querySelector('.header-canvas-wrapper')) document.body.classList.add('water-header');
  const go = () => window.requestIdleCallback ? requestIdleCallback(init, { timeout: 1000 }) : setTimeout(init, 0);
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
});

// Runs after the page has loaded, when _layouts/home.html has built .header-canvas-wrapper.
function init() {
  const vert = `
    attribute vec2 a;
    void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

  const frag = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uTime, uScale, uLight, uShadow, uClear, uFocus, uFine, uHover;
    uniform vec2 uMouse;
    uniform vec2 uOffset;  // moves the pattern, in pattern units (keeps it in place on the page)
    uniform float uRainbow;  // strength of the prism bands around the pointer (1 = original)
    #define DROPS 8
    uniform vec3 uDrops[DROPS];  // pointer ripples: x, y (pattern units), age (s); see ripples()
    uniform float uRipple;       // their height; 0 = none

    vec2 hash22(vec2 p){
      vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
    }

    // Gradient noise with quintic fade (smooth second derivatives matter for caustics).
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float a = dot(hash22(i), f);
      float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
      float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
      float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
      return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
    }

    float ny; // 0 at top of screen, 1 at bottom

    // One wave field: three drifting octaves plus thin parallel ripple trains.
    float field(vec2 p, float t){
      mat2 r1 = mat2(cos(1.1), sin(1.1), -sin(1.1), cos(1.1));
      mat2 r2 = mat2(cos(2.3), sin(2.3), -sin(2.3), cos(2.3));
      float h = 1.00 * noise(p + t * vec2(0.30, 0.10));
      h += 0.60 * noise(r1 * p * 1.9 + 11.0 + t * vec2(-0.20, 0.32) * 1.38);
      h += 0.16 * noise(r2 * p * 3.7 + 23.0 + t * vec2(0.38, -0.25) * 1.92);
      // Soft on/off masks for the ripple trains (sigmoid: no kinks for the caustics to amplify).
      float m1 = 1.0 / (1.0 + exp(-12.0 * (noise(p * 0.7 + 5.0 + t * vec2(0.1, -0.05)) - 0.1)));
      float m2 = 1.0 / (1.0 + exp(-12.0 * (noise(p * 0.6 + vec2(-7.0, 3.0) + t * vec2(0.0, 0.08)) - 0.15)));
      h += uFine * m1 * sin(p.x * 10.5 + p.y * 28.2 - t * 3.0);
      h += uFine * 0.8 * m2 * sin(p.x * 21.6 - p.y * 9.6 + t * 2.5);
      return h;
    }

    // Ripples from the pointer: each drop (x, y in pattern units, age in seconds) sends out a
    // ring of small waves that widens and dies away. Part of the surface, so they bend the
    // light lines.
    float ripples(vec2 p){
      float h = 0.0;
      for (int i = 0; i < DROPS; i++) {
        vec3 d = uDrops[i];
        if (d.z > 4.0) continue;                       // gone (or never started)
        float r = length(p - d.xy);
        float front = r - 0.32 * d.z;                  // the ring moves outwards
        float packet = exp(-front * front / 0.012);    // a short train of waves around it
        float fade = exp(-d.z * 1.1) * smoothstep(0.0, 0.15, d.z);
        h += uRipple * fade * packet * sin(front * 55.0);
      }
      return h;
    }

    // Upper area: rounded cells. Lower area: waves stretched into horizontal bands.
    float height(vec2 p, float t){
      float x = clamp((ny - 0.3) / 0.6, 0.0, 1.0);
      float w = x * x * x * (x * (x * 6.0 - 15.0) + 10.0); // smooth in 2nd derivative too
      float rip = uRipple > 0.0 ? ripples(p) : 0.0;
      if (w <= 0.0) return field(p, t) + rip;
      vec2 ps = vec2(p.x, p.y * 1.6 + 40.0);
      if (w >= 1.0) return field(ps, t) + rip;
      return mix(field(p, t), field(ps, t), w) + rip;
    }

    // Slope of the surface, and where a light ray hitting this point lands below.
    vec4 refractRay(vec2 p, float t, float e){
      vec2 g = vec2(height(p + vec2(e, 0.0), t) - height(p - vec2(e, 0.0), t),
                    height(p + vec2(0.0, e), t) - height(p - vec2(0.0, e), t)) / (2.0 * e);
      return vec4(p - uFocus * g, g);
    }

    // Light concentration for a given focus strength, reusing the slopes already computed.
    float intensity(vec2 p, vec2 g0, vec2 gx, vec2 gy, float e, float k){
      vec2 a = p - k * g0;
      vec2 dx = p + vec2(e, 0.0) - k * gx - a;
      vec2 dy = p + vec2(0.0, e) - k * gy - a;
      return min((e * e) / max(abs(dx.x * dy.y - dx.y * dy.x), 1e-9), 30.0);
    }

    float toneMap(float I){
      float L = 1.0 - exp(-max(I - 1.0, 0.0) * 0.3 * uLight);
      return pow(clamp(L, 0.0, 1.0), 1.4);
    }

    void main(){
      ny = 1.0 - gl_FragCoord.y / uRes.y;
      float sc = 2.6 / uScale;
      vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes.y * sc + uOffset;
      float t = uTime;
      float e = 0.0035;

      vec4 q  = refractRay(p, t, e);
      vec4 qx = refractRay(p + vec2(e, 0.0), t, e);
      vec4 qy = refractRay(p + vec2(0.0, e), t, e);

      // Light concentration = how much the refracted area shrinks.
      vec2 dx = qx.xy - q.xy, dy = qy.xy - q.xy;
      float area = abs(dx.x * dy.y - dx.y * dy.x);
      float I = min((e * e) / max(area, 1e-9), 30.0);

      vec3 Lc = vec3(toneMap(I));

      // Gentle shading from the tilt of the surface, plus small sun glints.
      vec3 n = normalize(vec3(-q.zw * 0.35, 1.0));
      float tilt = dot(n, normalize(vec3(0.4, 0.5, 1.0))) - 0.92;
      float glint = pow(max(dot(n, normalize(vec3(0.25, 0.3, 1.0))), 0.0), 900.0);

      // Iridescent light around the pointer: a pastel pink/blue liquid tint plus soft
      // prism-like rainbow bands that wobble with the water underneath.
      vec2 suv = gl_FragCoord.xy / uRes.y;
      float d = length(gl_FragCoord.xy - uMouse) / uRes.y;
      float fall = uHover * exp(-d * d / 0.05);
      fall = fall * fall * (3.0 - 2.0 * fall);
      vec3 tint = vec3(1.0);
      vec3 bow = vec3(0.0);
      float bowMask = 0.0;
      if (fall > 0.003) {
        // Colored edges on the bright lines (dispersion: each color focuses a bit differently).
        vec3 ks = uFocus * (1.0 + fall * vec3(-0.15, 0.0, 0.16) * (1.0 + uRainbow));
        Lc.r = toneMap(intensity(p, q.zw, qx.zw, qy.zw, e, ks.r));
        Lc.b = toneMap(intensity(p, q.zw, qx.zw, qy.zw, e, ks.b));

        // Large, slow, smooth fields for the liquid colors and the light bands, seen through the
        // water: shifted by the tilt of the surface, so the bands bend and break with the waves.
        suv -= q.zw * 0.035;
        float s1 = noise(suv * 1.1 + t * vec2(0.035, -0.02));
        float s2 = noise(suv * 2.2 + vec2(9.0, -4.0) - t * vec2(0.02, 0.045));
        vec3 pink = vec3(0.97, 0.80, 0.85);
        vec3 blue = vec3(0.70, 0.83, 0.95);
        vec3 pearl = vec3(0.93, 0.90, 0.98);
        tint = mix(blue, pink, smoothstep(-0.25, 0.25, s1 + 0.5 * s2));
        tint = mix(tint, pearl, smoothstep(0.15, 0.45, abs(s2)));

        float s = s1 * 1.6 + s2 * 0.7 + suv.x * 0.45 - suv.y * 0.25
                + dot(q.zw, vec2(0.012, 0.009)) - t * 0.03;
        float u = fract(s * 1.3 + dot(q.zw, vec2(0.03, 0.02)));
        float across = clamp(u / 0.55, 0.0, 1.0);
        bowMask = pow(sin(3.14159 * across), 1.6);
        vec3 spectrum = 0.5 + 0.5 * cos(6.2831 * (across * 0.85 + vec3(0.0, 0.33, 0.67)));
        // paler than the original (0.18): pastel, closer to light on real water
        bow = mix(spectrum, vec3(1.0), mix(0.18, 0.6, 1.0 - uRainbow));
      }

      float hl = max(max(Lc.r, Lc.g), Lc.b);

      if (uClear > 0.5) {
        vec3 c = Lc + glint;
        float a = max(max(c.r, c.g), c.b);
        c = mix(c, tint, fall * 0.35);
        a = mix(a, 1.0, fall * 0.35);
        c = mix(c, bow, fall * bowMask * 0.55);
        a = mix(a, 1.0, fall * bowMask * 0.55);
        a = clamp(a, 0.0, 1.0);
        gl_FragColor = vec4(min(clamp(c, 0.0, 1.0), vec3(a)) , a); // premultiplied
        return;
      }

      vec3 shadow = vec3(1.0) - uShadow * vec3(1.0, 0.97, 0.93);
      vec3 col = mix(shadow, vec3(1.0), Lc);
      col += tilt * uShadow * 0.5;
      col = mix(col, col * tint, fall * 0.4);
      // the rainbow bands over the water, and on top of that stronger on the light lines
      float onLine = smoothstep(0.08, 0.6, hl);
      col = mix(col, bow * (0.9 + 0.1 * col), fall * bowMask * (0.3 + 0.4 * onLine) * uRainbow);
      col = mix(col, vec3(1.0), fall * hl * 0.3 * (1.0 - bowMask * uRainbow));
      col = mix(col, vec3(1.0), clamp(glint, 0.0, 1.0));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`;

  // The "Water light II" defaults, but lighter (less shadow between the light lines), coarser
  // (the pattern scales with the canvas height, and the header is low) and calmer.
  // rainbow: the prism bands around the pointer (1 = as in the original);
  // ripple: height of the rings a click stirs up in the header (0 = none)
  const S = { speed: 0.5, scale: 1.8, light: 1, shadow: 0.05, focus: 0.12, fine: 0.02, rainbow: 0.7, ripple: 0.04 };
  const DROPS = 8;  // as in the shader
  const NO_DROPS = new Float32Array(DROPS * 3).fill(99);
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // one clock for header and headings, so both waters move alike
  const clock = now => reducedMotion ? 12.0 : now / 1000 * S.speed;

  // The water shader in a canvas. Returns draw(options), or null without WebGL.
  function makeWater(canvas) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return null;

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(prog);
      gl.useProgram(prog);
    } catch (err) {
      return null;
    }

    // one triangle covering the whole canvas
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = {};
    ['uRes', 'uTime', 'uScale', 'uLight', 'uShadow', 'uClear', 'uFocus', 'uFine', 'uHover', 'uMouse', 'uOffset', 'uRainbow', 'uDrops', 'uRipple']
      .forEach(n => U[n] = gl.getUniformLocation(prog, n));

    return function draw(o) {
      // capped resolution: the shader is heavy, and the soft pattern doesn't need sharp pixels
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uRes, w, h);
      gl.uniform1f(U.uTime, o.time);
      gl.uniform1f(U.uScale, o.scale);
      gl.uniform1f(U.uLight, S.light);
      gl.uniform1f(U.uShadow, S.shadow);
      gl.uniform1f(U.uClear, 0);
      gl.uniform1f(U.uFocus, S.focus);
      gl.uniform1f(U.uFine, S.fine);
      gl.uniform2f(U.uMouse, o.mx || 0, o.my || 0);
      gl.uniform1f(U.uHover, o.hover || 0);
      gl.uniform2f(U.uOffset, o.ox || 0, o.oy || 0);
      gl.uniform1f(U.uRainbow, S.rainbow);
      gl.uniform3fv(U.uDrops, o.drops || NO_DROPS);
      gl.uniform1f(U.uRipple, o.drops ? S.ripple : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  // ---------- header ----------
  const area = document.querySelector('.header-canvas-wrapper');
  if (area) setupHeader();

  function setupHeader() {
    const layer = document.createElement('div');
    layer.className = 'water-layer';
    layer.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    layer.appendChild(canvas);
    area.insertBefore(layer, area.firstChild);

    const draw = makeWater(canvas);
    if (!draw) {  // no WebGL: the header keeps its glitter
      layer.remove();
      document.body.classList.remove('water-header');
      return;
    }

    // Pointer in canvas pixels (y from the bottom, as in the shader). The page content lies on
    // top of the canvas, so listen on the window. Passive: scrolling on phones keeps working.
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, h: 0, th: 0 };
    // Moves the rainbow shimmer to (x, y) in the window; true if that is inside the water.
    function hover(x, y) {
      const r = canvas.getBoundingClientRect();
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      if (!inside) { pointer.th = 0; return false; }
      const s = canvas.width / r.width;
      pointer.tx = (x - r.left) * s;
      pointer.ty = canvas.height - (y - r.top) * s;
      if (pointer.h < 0.02) { pointer.x = pointer.tx; pointer.y = pointer.ty; }
      pointer.th = 1;
      return true;
    }
    function dropAtClient(x, y) {
      const r = canvas.getBoundingClientRect();
      dropAt(x - r.left, y - r.top, r.height);
    }
    // Mouse (and pen): the rainbow follows it, a click drops ripples.
    // Touch is handled with the touch events below.
    function track(ev) {
      if (ev.pointerType === 'touch') return;
      if (hover(ev.clientX, ev.clientY) && ev.type === 'pointerdown') dropAtClient(ev.clientX, ev.clientY);
    }

    // Ripples: each click drops a ring of waves into the water.
    // Kept as x, y in pattern units (as p in the shader) and the start time.
    const drops = [];
    const dropData = new Float32Array(DROPS * 3);
    function dropAt(x, y, h) {
      const now = performance.now();
      const perPx = 2.6 / S.scale / h;  // css px -> pattern units (p in the shader)
      drops.push({ x: x * perPx, y: y * perPx, t: now });
      if (drops.length > DROPS) drops.shift();
    }
    function dropUniforms(now) {
      dropData.fill(99);  // empty slots: long gone
      drops.forEach((d, i) => {
        dropData[i * 3] = d.x;
        dropData[i * 3 + 1] = d.y;
        dropData[i * 3 + 2] = (now - d.t) / 1000;
      });
      return dropData;
    }
    window.addEventListener('pointermove', track, { passive: true });
    window.addEventListener('pointerdown', track, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { pointer.th = 0; });
    window.addEventListener('pointerup', ev => { if (ev.pointerType === 'pen') pointer.th = 0; }, { passive: true });
    window.addEventListener('pointercancel', ev => { if (ev.pointerType !== 'touch') pointer.th = 0; }, { passive: true });

    // Touch screens: the rainbow follows the finger while it moves (also while the page
    // scrolls; pointer events stop then), and only a tap drops ripples: a short touch that
    // hardly moved. Passive listeners, so scrolling keeps working.
    const TAP_MOVE = 10, TAP_TIME = 350;  // px, ms
    let touch = null;
    window.addEventListener('touchstart', ev => {
      if (ev.touches.length !== 1) { touch = null; return; }
      const t = ev.touches[0];
      touch = { x: t.clientX, y: t.clientY, time: performance.now(), moved: false };
    }, { passive: true });
    window.addEventListener('touchmove', ev => {
      const t = ev.touches[0];
      if (!t) return;
      if (touch && Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > TAP_MOVE) touch.moved = true;
      if (touch && touch.moved) hover(t.clientX, t.clientY);
    }, { passive: true });
    window.addEventListener('touchend', () => {
      pointer.th = 0;
      if (touch && !touch.moved && performance.now() - touch.time < TAP_TIME) {
        const r = canvas.getBoundingClientRect();
        if (touch.x >= r.left && touch.x <= r.right && touch.y >= r.top && touch.y <= r.bottom) {
          dropAtClient(touch.x, touch.y);
        }
      }
      touch = null;
    }, { passive: true });
    window.addEventListener('touchcancel', () => { pointer.th = 0; touch = null; }, { passive: true });

    function render(now) {
      // dark mode: no water, the header shows the glitter and stars of the home page instead
      if (isDark()) return;
      draw({ time: clock(now), scale: S.scale, mx: pointer.x, my: pointer.y, hover: pointer.h,
             drops: dropUniforms(now) });
    }

    // Only animate while the header is on screen.
    let visible = true, running = false, last = 0;
    function frame(now) {
      if (!visible) { running = false; return; }
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const kp = 1 - Math.exp(-dt * 14), kh = 1 - Math.exp(-dt * 4);
      pointer.x += (pointer.tx - pointer.x) * kp;
      pointer.y += (pointer.ty - pointer.y) * kp;
      pointer.h += (pointer.th - pointer.h) * kh;
      render(now);
      requestAnimationFrame(frame);
    }
    function start() {
      if (running || reducedMotion) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    }

    if (window.IntersectionObserver) {
      new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        if (visible) start();
      }).observe(layer);
    }

    // reduced motion: one still picture, redrawn when the size or the theme changes
    if (reducedMotion) {
      const still = () => render(0);
      window.addEventListener('resize', still);
      new MutationObserver(still).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      still();
    } else {
      start();
    }
    canvas.classList.add('water-on');
  }

  // ---------- category headings (overview; light mode, not with reduced motion) ----------
  const headings = document.querySelectorAll('.recipe-category .category-header');
  if (headings.length && !reducedMotion) setupHeadings();

  function setupHeadings() {
    const PAD = 60;  // how far the water reaches out around the heading text (px)
    // leaving a heading only starts the fade after this; entering the next one before glides there
    const LINGER = 250;
    // in the page, not in the category: .recipe-category hides what sticks out of it
    const halo = document.createElement('div');
    halo.className = 'heading-water';
    halo.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    halo.appendChild(canvas);
    document.body.appendChild(halo);

    const draw = makeWater(canvas);
    if (!draw) { halo.remove(); return; }

    let current = null, shown = false, running = false, stopAt = 0, hideTimer = 0;
    // around the heading's text: the heading element itself spans the whole column
    function place(heading) {
      const range = document.createRange();
      range.selectNodeContents(heading);
      const r = range.getBoundingClientRect();
      halo.style.left = (r.left + window.scrollX - PAD) + 'px';
      halo.style.top = (r.top + window.scrollY - PAD) + 'px';
      halo.style.width = (r.width + 2 * PAD) + 'px';
      halo.style.height = (r.height + 2 * PAD) + 'px';
    }
    // runs while the water shows, and on until it has faded out
    function frame(now) {
      if (!shown && now > stopAt) { running = false; return; }
      // The pattern scales with the canvas height: match the size of the waves in the header.
      // And it stays put on the page while the patch glides from heading to heading: shift it
      // by the patch's page position (in pattern units, as in the shader).
      const headerH = area ? area.clientHeight : 340;
      const h = Math.max(1, canvas.clientHeight);
      const scale = S.scale * headerH / h;
      const perPx = 2.6 / scale / h;
      const r = halo.getBoundingClientRect();
      draw({
        time: clock(now), scale,
        ox: (r.left + window.scrollX) * perPx,
        oy: (r.top + window.scrollY) * perPx,
      });
      requestAnimationFrame(frame);
    }
    function start() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    }

    function show(heading) {
      if (isDark()) return;
      clearTimeout(hideTimer);
      current = heading;
      if (shown) {
        // still showing at the last heading: glide over (transitions in recipe_water.css)
        halo.classList.add('glide');
      } else {
        // appearing: jump to the heading first, then fade in
        halo.classList.remove('glide');
        place(heading);
        void halo.offsetWidth;
      }
      place(heading);
      shown = true;
      halo.classList.add('on');
      start();
    }
    // fades out after `delay` ms (unless another heading is shown before)
    function hide(heading, delay) {
      if (current !== heading) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        current = null;
        shown = false;
        halo.classList.remove('on');
        stopAt = performance.now() + 1500;  // a little longer than the fade out in recipe_water.css
      }, delay);
    }

    // with a mouse: while it is over a heading
    // touch screens: a tap on a heading (opening or closing its category) lets the water well
    // up behind it for a moment
    const TAP_SHOW = 1400;  // ms
    const hasHover = window.matchMedia('(hover: hover)').matches;
    headings.forEach(heading => {
      if (hasHover) {
        heading.addEventListener('mouseenter', () => show(heading));
        heading.addEventListener('mouseleave', () => hide(heading, LINGER));
      } else {
        heading.addEventListener('click', () => {
          show(heading);
          hide(heading, TAP_SHOW);
        });
      }
    });
  }
}
