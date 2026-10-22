// Theme switch animations (started by _includes/theme_toggle.html):
//   moonFlight()  switching to dark: a crescent moon flies over the screen in an arc
//                 and leaves a short glitter tail.
//   sunrise()     switching to light: a sun with slowly turning rays rises from the
//                 bottom edge, pauses and sinks again, shedding warm sparkles upwards.
// The glitter uses the same soft 4-point stars as the home header. Both are drawn on a
// temporary full-screen canvas that ignores the mouse and is removed again once the
// last sparkle has faded. Skipped for visitors who asked their system for reduced motion.
(function () {
    var MOON_FLIGHT_MS = 1800;  // time the moon needs to cross the screen
    var MOON_R = 36;            // moon radius in CSS pixels
    var SUN_RISE_MS = 900;      // sun comes up ...
    var SUN_HOLD_MS = 450;      // ... stays ...
    var SUN_SET_MS = 750;       // ... and sinks again
    var SUN_R = 40;             // sun disc radius in CSS pixels
    var running = null;         // the current animation, so a second click restarts it

    function showering() {
        return running !== null && running.kind === 'stars';
    }

    function reducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // full-screen canvas scaled for sharp drawing on high-DPI screens
    function createOverlay() {
        if (running) running.stop();
        var dpr = window.devicePixelRatio || 1;
        var w = window.innerWidth, h = window.innerHeight;
        var canvas = document.createElement('canvas');
        canvas.className = 'theme-animation';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        document.body.appendChild(canvas);
        var ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { canvas: canvas, ctx: ctx, w: w, h: h, dpr: dpr };
    }

    // runs draw(ctx, elapsedMs) every frame until it returns false
    function run(overlay, draw, kind) {
        var start = null, frame = null;
        function stop() {
            if (frame) cancelAnimationFrame(frame);
            overlay.canvas.remove();
            running = null;
        }
        running = { stop: stop, kind: kind };
        function tick(now) {
            if (start === null) start = now;
            overlay.ctx.clearRect(0, 0, overlay.w, overlay.h);
            if (draw(overlay.ctx, now - start)) frame = requestAnimationFrame(tick);
            else stop();
        }
        frame = requestAnimationFrame(tick);
    }

    // ---------- glitter ----------

    // light: lightness of the star's core and middle, e.g. [98, 78] on dark backgrounds
    function drawSparkle(ctx, p, light) {
        var twinkle = 0.6 + 0.4 * Math.sin(p.phase);
        var s = p.size;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha) * twinkle;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2);
        grad.addColorStop(0, 'hsl(' + p.hue + ', 100%, ' + light[0] + '%)');
        grad.addColorStop(0.3, 'hsl(' + p.hue + ', 100%, ' + light[1] + '%)');
        grad.addColorStop(1, 'hsla(' + p.hue + ', 100%, ' + (light[1] - 10) + '%, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, -s * 2.2);
        ctx.quadraticCurveTo(s * 0.3, -s * 0.3, s * 2.2, 0);
        ctx.quadraticCurveTo(s * 0.3, s * 0.3, 0, s * 2.2);
        ctx.quadraticCurveTo(-s * 0.3, s * 0.3, -s * 2.2, 0);
        ctx.quadraticCurveTo(-s * 0.3, -s * 0.3, 0, -s * 2.2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // opacity: optional factor for fainter glitter (default 1)
    function sparkle(x, y, vx, vy, size, hue, decay, opacity) {
        return {
            x: x, y: y, vx: vx, vy: vy, size: size, hue: hue,
            alpha: (Math.random() * 0.4 + 0.6) * (opacity || 1),
            decay: decay,
            phase: Math.random() * Math.PI * 2,
            phaseSpeed: Math.random() * 0.2 + 0.1,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.1
        };
    }

    // moves, fades and draws the sparkles; returns the ones still visible.
    // gravity > 0 lets them sink, < 0 lets them float up
    function updateSparkles(ctx, particles, gravity, light) {
        particles = particles.filter(function (p) { return p.alpha > 0.01; });
        particles.forEach(function (p) {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.97;
            p.vy = p.vy * 0.97 + gravity;
            p.alpha -= p.decay;
            p.phase += p.phaseSpeed;
            p.rotation += p.rotationSpeed;
            drawSparkle(ctx, p, light);
        });
        return particles;
    }

    // ---------- helpers ----------

    // point and direction on a quadratic Bézier curve
    function bezier(p0, p1, p2, t) {
        var u = 1 - t;
        return {
            x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
            y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
            dx: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
            dy: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y)
        };
    }

    function easeInOut(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function easeOut(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function easeIn(t) {
        return t * t * t;
    }

    // ---------- moon (switching to dark) ----------

    // crescent sprite, drawn once: a full disc minus an offset disc, with a golden glow
    function makeMoonSprite(dpr) {
        var size = MOON_R * 4;  // room for the glow
        var mid = size / 2;
        var crescent = document.createElement('canvas');
        crescent.width = crescent.height = Math.ceil(size * dpr);
        var m = crescent.getContext('2d');
        m.scale(dpr, dpr);
        m.fillStyle = '#fff3c4';
        m.beginPath();
        m.arc(mid, mid, MOON_R, 0, Math.PI * 2);
        m.fill();
        m.globalCompositeOperation = 'destination-out';
        m.beginPath();
        m.arc(mid + MOON_R * 0.45, mid - MOON_R * 0.3, MOON_R * 0.85, 0, Math.PI * 2);
        m.fill();

        var c = document.createElement('canvas');
        c.width = c.height = crescent.width;
        var g = c.getContext('2d');
        g.scale(dpr, dpr);
        g.shadowColor = 'rgba(255, 228, 150, 0.9)';
        g.shadowBlur = 24;
        g.drawImage(crescent, 0, 0, size, size);
        g.shadowBlur = 0;
        g.drawImage(crescent, 0, 0, size, size);
        return { canvas: c, size: size };
    }

    window.moonFlight = function () {
        if (reducedMotion() || showering()) return;
        var o = createOverlay();
        var moon = makeMoonSprite(o.dpr);
        // from below the left edge, over the upper part of the screen, out on the right
        var p0 = { x: -MOON_R * 3, y: o.h * 0.75 };
        var p1 = { x: o.w * 0.5, y: -o.h * 0.2 };
        var p2 = { x: o.w + MOON_R * 3, y: o.h * 0.4 };
        var particles = [];
        var hue = 40;  // starts golden, then drifts through the rainbow

        run(o, function (ctx, elapsed) {
            var t = Math.min(1, elapsed / MOON_FLIGHT_MS);
            // sparkles drift outwards from the tail, sink a little and fade
            particles = updateSparkles(ctx, particles, 0.03, [98, 78]);

            if (t < 1) {
                var pos = bezier(p0, p1, p2, easeInOut(t));
                var len = Math.sqrt(pos.dx * pos.dx + pos.dy * pos.dy) || 1;
                var back = { x: -pos.dx / len, y: -pos.dy / len };  // direction of the tail
                hue = (hue + 2.5) % 360;

                for (var i = 0; i < 14; i++) {
                    var angle = Math.random() * Math.PI * 2;
                    var speed = Math.random() * 1.2 + 0.3;
                    particles.push(sparkle(
                        pos.x + back.x * MOON_R * 0.6 + (Math.random() - 0.5) * MOON_R,
                        pos.y + back.y * MOON_R * 0.6 + (Math.random() - 0.5) * MOON_R,
                        Math.cos(angle) * speed + back.x * 0.6,
                        Math.sin(angle) * speed + back.y * 0.6,
                        Math.random() * 2.5 + 2.2,
                        (hue + Math.random() * 60 - 30 + 360) % 360,
                        Math.random() * 0.025 + 0.015  // a short tail
                    ));
                }

                // the moon tilts a little along its way
                ctx.save();
                ctx.translate(pos.x, pos.y);
                ctx.rotate(-0.5 + t * 0.9);
                ctx.drawImage(moon.canvas, -moon.size / 2, -moon.size / 2, moon.size, moon.size);
                ctx.restore();
            }
            return t < 1 || particles.length > 0;
        });
    };

    // ---------- sun (switching to light) ----------

    function drawSun(ctx, x, y, rotation, glow) {
        // warm halo, also lights up the page around the sun a little
        var halo = ctx.createRadialGradient(x, y, SUN_R * 0.5, x, y, SUN_R * 4.5);
        halo.addColorStop(0, 'rgba(255, 200, 90, ' + 0.45 * glow + ')');
        halo.addColorStop(0.4, 'rgba(255, 170, 120, ' + 0.18 * glow + ')');
        halo.addColorStop(1, 'rgba(255, 170, 120, 0)');
        ctx.fillStyle = halo;
        ctx.fillRect(x - SUN_R * 4.5, y - SUN_R * 4.5, SUN_R * 9, SUN_R * 9);

        // 12 rays, alternately long and short, turning slowly
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.fillStyle = '#ffc23d';
        for (var i = 0; i < 12; i++) {
            var len = i % 2 ? SUN_R * 0.45 : SUN_R * 0.75;
            ctx.beginPath();
            ctx.moveTo(-SUN_R * 0.16, -SUN_R * 1.18);
            ctx.lineTo(0, -SUN_R * 1.18 - len);
            ctx.lineTo(SUN_R * 0.16, -SUN_R * 1.18);
            ctx.closePath();
            ctx.fill();
            ctx.rotate(Math.PI / 6);
        }
        ctx.restore();

        // the disc, a little lighter towards the upper left
        var disc = ctx.createRadialGradient(x - SUN_R * 0.3, y - SUN_R * 0.3, SUN_R * 0.1, x, y, SUN_R);
        disc.addColorStop(0, '#fff1a8');
        disc.addColorStop(0.6, '#ffcf45');
        disc.addColorStop(1, '#ffb03a');
        ctx.save();
        ctx.shadowColor = 'rgba(255, 180, 60, 0.8)';
        ctx.shadowBlur = 25;
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(x, y, SUN_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    window.sunrise = function () {
        if (reducedMotion() || showering()) return;
        var o = createOverlay();
        var x = o.w * 0.5;
        var below = o.h + SUN_R * 2.5;          // fully hidden below the bottom edge, rays included
        var top = Math.max(o.h * 0.45, SUN_R * 3);
        var total = SUN_RISE_MS + SUN_HOLD_MS + SUN_SET_MS;
        var particles = [];

        run(o, function (ctx, elapsed) {
            // sparkles float up and fade; coloured enough to show on the white page, but kept subtle
            particles = updateSparkles(ctx, particles, -0.015, [78, 66]);

            if (elapsed < total) {
                var y, glow;
                if (elapsed < SUN_RISE_MS) {
                    var r = easeOut(elapsed / SUN_RISE_MS);
                    y = below + (top - below) * r;
                    glow = r;
                } else if (elapsed < SUN_RISE_MS + SUN_HOLD_MS) {
                    y = top;
                    glow = 1;
                } else {
                    var s = easeIn((elapsed - SUN_RISE_MS - SUN_HOLD_MS) / SUN_SET_MS);
                    y = top + (below - top) * s;
                    glow = 1 - s;
                }

                // warm glitter from all around the sun's rim, golden to pink
                for (var i = 0; i < 8; i++) {
                    var angle = Math.random() * Math.PI * 2;
                    var dist = SUN_R * (1.1 + Math.random() * 0.6);
                    var speed = Math.random() * 1.3 + 0.4;
                    particles.push(sparkle(
                        x + Math.cos(angle) * dist,
                        y + Math.sin(angle) * dist,
                        Math.cos(angle) * speed,
                        Math.sin(angle) * speed - 0.8,
                        Math.random() * 2 + 1.8,
                        Math.random() < 0.7 ? 25 + Math.random() * 25 : 330 + Math.random() * 25,
                        Math.random() * 0.025 + 0.015,
                        0.65
                    ));
                }

                drawSun(ctx, x, y, elapsed / 2500, glow);
            }
            return elapsed < total || particles.length > 0;
        });
    };

    window.starShower = function () {
        if (reducedMotion() || showering()) return;
        var o = createOverlay();
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        var light = dark ? [98, 78] : [74, 62];
        var particles = [];
        var stars = [];
        for (var n = 0; n < 28; n++) {
            var angle = Math.PI * (0.72 + Math.random() * 0.08);
            var speed = (o.w + o.h) * (0.0007 + Math.random() * 0.0004);
            stars.push({
                start: Math.random() * 1800,
                life: 900 + Math.random() * 500,
                x: o.w * (0.15 + Math.random() * 1.0),
                y: -20 - Math.random() * o.h * 0.25,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                hue: dark ? 40 + Math.random() * 30 : [330, 30, 45, 270, 200][n % 5]
            });
        }
        var last = Math.max.apply(null, stars.map(function (s) { return s.start + s.life; }));

        run(o, function (ctx, elapsed) {
            particles = updateSparkles(ctx, particles, 0.01, light);

            stars.forEach(function (s) {
                var t = elapsed - s.start;
                if (t < 0 || t > s.life) return;
                var x = s.x + s.vx * t, y = s.y + s.vy * t;
                var fade = Math.min(1, t / 120, (s.life - t) / 200);
                var len = 170;
                var tx = x - s.vx / Math.hypot(s.vx, s.vy) * len;
                var ty = y - s.vy / Math.hypot(s.vx, s.vy) * len;

                var streak = ctx.createLinearGradient(x, y, tx, ty);
                streak.addColorStop(0, dark ? 'rgba(255, 250, 235, ' + 0.9 * fade + ')'
                                            : 'hsla(' + s.hue + ', 95%, 60%, ' + 0.85 * fade + ')');
                streak.addColorStop(1, dark ? 'rgba(255, 250, 235, 0)' : 'hsla(' + s.hue + ', 95%, 60%, 0)');
                ctx.strokeStyle = streak;
                ctx.lineWidth = 2.2;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(tx, ty);
                ctx.stroke();

                ctx.save();
                ctx.globalAlpha = fade;
                ctx.shadowColor = dark ? 'rgba(255, 236, 170, 0.9)' : 'hsla(' + s.hue + ', 100%, 60%, 0.8)';
                ctx.shadowBlur = 12;
                ctx.fillStyle = dark ? '#fffaf0' : 'hsl(' + s.hue + ', 100%, 62%)';
                ctx.beginPath();
                ctx.arc(x, y, 2.6, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                if (Math.random() < 0.8) {
                    particles.push(sparkle(
                        x - s.vx * 8 + (Math.random() - 0.5) * 10,
                        y - s.vy * 8 + (Math.random() - 0.5) * 10,
                        (Math.random() - 0.5) * 0.6,
                        (Math.random() - 0.5) * 0.6,
                        Math.random() * 1.8 + 1.4,
                        (s.hue + Math.random() * 40 - 20 + 360) % 360,
                        Math.random() * 0.03 + 0.02,
                        dark ? 1 : 0.75
                    ));
                }
            });

            return elapsed < last || particles.length > 0;
        }, 'stars');
    };
})();
