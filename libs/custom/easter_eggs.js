(function () {

    var BIKE =
        '        __o\n' +
        '      _ \\<_\n' +
        '     (_)/(_)';
    console.log('%c' + BIKE, 'color: hotpink; font-family: monospace; font-size: 14px; line-height: 1.2;');
    console.log('%cHej! 👋 Looking under the hood?', 'color: hotpink; font-size: 16px; font-weight: bold;');
    console.log(
        'The code for this website is on GitHub: https://github.com/nelebru/nelebru.github.io\n' +
        'Found a bug or have an idea? Feel free to reach out :)'
    );

    var NIGHT_FROM = 0, NIGHT_TO = 4;
    var LINES = [
        "Still awake?",
        'Night owls unite! :)',
        "Shouldn't you be asleep? Training starts at 6 a.m.",
        'Hoo hoo! Midnight snack? Try the brownies 🍫',
        'Sweet dreams of fast descents and long climbs!',
        'Late night coding? Remember to hydrate and stretch!',
    ];

    var OWL_SVG =
        '<svg viewBox="0 0 64 72" width="56" height="63" aria-hidden="true">' +
          '<path d="M3 67 Q32 61 61 67" stroke="#6b4f3a" stroke-width="4" fill="none" stroke-linecap="round"/>' +
          '<g class="owl-body">' +
            '<path d="M13 15 L17 3 L26 12 Z" fill="#7a6496"/>' +
            '<path d="M51 15 L47 3 L38 12 Z" fill="#7a6496"/>' +
            '<ellipse cx="32" cy="38" rx="22" ry="25" fill="#7a6496"/>' +
            '<path d="M11 33 Q5 48 17 59 Q14 45 11 33 Z" fill="#5f4b7a"/>' +
            '<path d="M53 33 Q59 48 47 59 Q50 45 53 33 Z" fill="#5f4b7a"/>' +
            '<ellipse cx="32" cy="46" rx="13" ry="14" fill="#c9b8e0"/>' +
            '<path d="M26 44 q2 2 4 0 M34 44 q2 2 4 0 M30 50 q2 2 4 0" stroke="#a593c2" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
            '<g class="owl-eyes">' +
              '<circle cx="23" cy="27" r="8.5" fill="#f5d26b"/>' +
              '<circle cx="41" cy="27" r="8.5" fill="#f5d26b"/>' +
              '<circle cx="23" cy="27.5" r="4.5" fill="#1e1a26"/>' +
              '<circle cx="41" cy="27.5" r="4.5" fill="#1e1a26"/>' +
              '<circle cx="24.5" cy="26" r="1.4" fill="#fff"/>' +
              '<circle cx="42.5" cy="26" r="1.4" fill="#fff"/>' +
            '</g>' +
            '<path d="M29 33 L35 33 L32 39 Z" fill="#f2a33a"/>' +
            '<ellipse cx="26" cy="63" rx="3.5" ry="2" fill="#f2a33a"/>' +
            '<ellipse cx="38" cy="63" rx="3.5" ry="2" fill="#f2a33a"/>' +
          '</g>' +
        '</svg>';

    var owl = null, hideTimer = null, lastLine = -1;

    function owlTime() {
        var hour = new Date().getHours();
        return hour >= NIGHT_FROM && hour < NIGHT_TO;
    }

    function say() {
        var bubble = owl.querySelector('.owl-bubble');
        var i;
        do { i = Math.floor(Math.random() * LINES.length); } while (i === lastLine && LINES.length > 1);
        lastLine = i;
        bubble.textContent = LINES[i];
        owl.classList.add('talking');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { owl.classList.remove('talking'); }, 4000);
    }

    function showOwl() {
        if (owl) return;
        owl = document.createElement('button');
        owl.type = 'button';
        owl.className = 'night-owl';
        owl.setAttribute('aria-label', 'A night owl. Click it to hear what it says.');
        owl.innerHTML = '<span class="owl-bubble" aria-live="polite"></span>' + OWL_SVG;
        owl.addEventListener('click', say);
        document.body.appendChild(owl);
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { if (owl) owl.classList.add('visible'); });
        });
    }

    function hideOwl() {
        if (!owl) return;
        var leaving = owl;
        owl = null;
        leaving.classList.remove('visible');
        setTimeout(function () { leaving.remove(); }, 600);
    }

    function update() {
        if (owlTime()) showOwl();
        else hideOwl();
    }

    var SWITCHES = 5, SWITCH_GAP_MS = 2500;
    var FAST_SWITCHES = 4, FAST_GAP_MS = 500;
    var switchTimes = [], bubbleTimer = null;

    function undecided() {
        var bubble = document.querySelector('.toggle-bubble');
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.className = 'toggle-bubble';
            bubble.setAttribute('role', 'status');
            document.body.appendChild(bubble);
        }
        bubble.textContent = "Can't decide? :p";
        requestAnimationFrame(function () { bubble.classList.add('visible'); });
        clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(function () { bubble.classList.remove('visible'); }, 2800);
        if (window.starShower) window.starShower();
    }

    function fastStreak() {
        var n = switchTimes.length;
        if (n < FAST_SWITCHES) return false;
        for (var i = n - FAST_SWITCHES + 1; i < n; i++) {
            if (switchTimes[i] - switchTimes[i - 1] >= FAST_GAP_MS) return false;
        }
        return true;
    }

    function onThemeChange() {
        var now = Date.now();
        var last = switchTimes[switchTimes.length - 1];
        if (last === undefined || now - last >= SWITCH_GAP_MS) switchTimes = [];
        switchTimes.push(now);
        if (switchTimes.length >= SWITCHES || fastStreak()) {
            switchTimes = [];
            undecided();
        }
        update();
    }

    var helloTimer = null, helloShow = 0;

    function onMainPage(link) {
        var here = location.pathname.replace(/index\.html$/, '');
        var target = link.pathname.replace(/index\.html$/, '');
        return here === target;
    }

    var PEACE_CLICKS = 5, PEACE_GAP_MS = 400;
    var picClicks = [];

    function peace(holder, bubble) {
        helloShow++;
        clearTimeout(helloTimer);
        if (bubble) bubble.classList.remove('visible');
        var old = holder.querySelector('.peace-sign');
        if (old) old.remove();
        var sign = document.createElement('span');
        sign.className = 'peace-sign';
        sign.setAttribute('role', 'img');
        sign.setAttribute('aria-label', 'peace');
        sign.textContent = '✌🏻';
        holder.appendChild(sign);
        sign.addEventListener('animationend', function () { sign.remove(); });
    }

    function helloAgain(e) {
        var link = e.currentTarget;
        if (!onMainPage(link)) return;
        e.preventDefault();
        var holder = link.parentNode;

        var now = Date.now();
        var last = picClicks[picClicks.length - 1];
        if (last === undefined || now - last >= PEACE_GAP_MS) picClicks = [];
        picClicks.push(now);
        if (picClicks.length >= PEACE_CLICKS) {
            picClicks = [];
            peace(holder, holder.querySelector('.hello-bubble'));
            return;
        }

        var bubble = holder.querySelector('.hello-bubble');
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.className = 'hello-bubble';
            bubble.setAttribute('role', 'status');
            bubble.textContent = 'hej again :)';
            holder.appendChild(bubble);
        }
        bubble.classList.remove('visible');
        var show = ++helloShow;
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (show !== helloShow) return;
                // somewhere else on the picture each time, in a random pastel colour;
                // the horizontal range keeps the text (centred on that point) on the picture
                bubble.style.setProperty('--hello-x', (35 + Math.random() * 30) + '%');
                bubble.style.setProperty('--hello-y', (8 + Math.random() * 70) + '%');
                bubble.style.setProperty('--hello-color', 'hsl(' + Math.floor(Math.random() * 360) + ', 100%, 86%)');
                bubble.classList.add('visible');
            });
        });
        clearTimeout(helloTimer);
        helloTimer = setTimeout(function () { bubble.classList.remove('visible'); }, 2500);
    }

    // dark mode only: scrubbing the mouse (or a finger) fast back and forth on one spot of
    // the glitter field in the home header leaves a little random planet there
    // within SCRUB_MS: at least SCRUB_PATH px travelled with SCRUB_TURNS changes of
    // direction, all inside a SCRUB_BOX px square
    var SCRUB_MS = 800, SCRUB_PATH = 500, SCRUB_TURNS = 4, SCRUB_BOX = 200, SCRUB_PAUSE_MS = 800;
    var MAX_PLANETS = 12;
    var scrub = [], scrubPause = 0, planetCount = 0;

    function rnd(min, max) {
        return min + Math.random() * (max - min);
    }

    // an SVG planet in a random colour, maybe with bands, craters, a ring and/or a moon;
    // drawn in a 100x100 box centred on 0, 0 so the ring has room around the disc
    function planetSvg() {
        var id = 'planet-' + (++planetCount);
        var hue = Math.floor(rnd(0, 360));
        var r = 22;
        var col = function (s, l, a) {
            return 'hsla(' + ((hue + 360) % 360) + ', ' + s + '%, ' + l + '%, ' + (a === undefined ? 1 : a) + ')';
        };
        var disc = '<circle r="' + r + '" fill="url(#' + id + '-shade)"/>';
        var surface = '';
        if (Math.random() < 0.5) {
            // gas giant: soft bands across the disc
            for (var b = 0; b < 4; b++) {
                surface += '<rect x="-' + r + '" y="' + (-r + rnd(4, 40)).toFixed(1) + '" width="' + 2 * r +
                    '" height="' + rnd(2, 6).toFixed(1) + '" fill="' + col(50, rnd(35, 75), 0.45) + '"/>';
            }
        } else {
            // rocky: a few craters
            for (var c = 0; c < 3; c++) {
                surface += '<circle cx="' + rnd(-13, 13).toFixed(1) + '" cy="' + rnd(-13, 13).toFixed(1) +
                    '" r="' + rnd(2, 5).toFixed(1) + '" fill="' + col(30, 30, 0.35) + '"/>';
            }
        }
        var ringed = Math.random() < 0.45;
        var tilt = rnd(-30, 30).toFixed(0);
        var ringColor = 'hsla(' + ((hue + 40) % 360) + ', 60%, 80%, 0.8)';
        var ringBack = ringed ? '<ellipse rx="40" ry="9" fill="none" stroke="' + ringColor + '" stroke-width="3.5" transform="rotate(' + tilt + ')"/>' : '';
        // the front half of the ring passes over the disc
        var ringFront = ringed ? '<path d="M-40 0 A40 9 0 0 0 40 0" fill="none" stroke="' + ringColor + '" stroke-width="3.5" transform="rotate(' + tilt + ')"/>' : '';
        var moon = !ringed && Math.random() < 0.5
            ? '<circle cx="' + rnd(28, 36).toFixed(1) + '" cy="' + rnd(-30, -18).toFixed(1) + '" r="' + rnd(3, 5).toFixed(1) + '" fill="#d9d4e3"/>'
            : '';
        return '<svg viewBox="-50 -50 100 100" aria-hidden="true">' +
            '<defs>' +
              '<radialGradient id="' + id + '-shade" cx="35%" cy="30%" r="75%">' +
                '<stop offset="0" stop-color="' + col(70, 80) + '"/>' +
                '<stop offset="0.55" stop-color="' + col(55, 55) + '"/>' +
                '<stop offset="1" stop-color="' + col(50, 22) + '"/>' +
              '</radialGradient>' +
              '<clipPath id="' + id + '-clip"><circle r="' + r + '"/></clipPath>' +
            '</defs>' +
            ringBack + disc +
            '<g clip-path="url(#' + id + '-clip)">' + surface +
              // night side towards the lower right
              '<circle r="' + r + '" cx="9" cy="7" fill="rgba(10, 8, 20, 0.35)"/>' +
            '</g>' +
            ringFront + moon +
            '</svg>';
    }

    // x, y relative to the field (the header wrapper built by _layouts/home.html)
    function addPlanet(field, x, y) {
        var size = Math.round(rnd(21, 50));
        var clamp = function (v, max) { return Math.max(size / 2, Math.min(max - size / 2, v)) - size / 2; };
        var planet = document.createElement('div');
        planet.className = 'stuck-planet';
        planet.style.width = planet.style.height = size + 'px';
        // keep it inside the field
        planet.style.left = clamp(x, field.clientWidth) + 'px';
        planet.style.top = clamp(y, field.clientHeight) + 'px';
        planet.style.setProperty('--planet-spin', rnd(-25, 25).toFixed(0) + 'deg');
        planet.innerHTML = planetSvg();
        // above the glitter canvases, below the header text (_layouts/home.html)
        var header = field.querySelector('.header');
        field.insertBefore(planet, header);
        var all = field.querySelectorAll('.stuck-planet');
        if (all.length > MAX_PLANETS) all[0].remove();
    }

    function onScrub(x, y) {
        if (document.documentElement.getAttribute('data-theme') !== 'dark') return;
        var field = document.querySelector('.header-canvas-wrapper');
        if (!field) return;
        var rect = field.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            scrub = [];
            return;
        }
        var now = Date.now();
        if (now < scrubPause) return;
        scrub.push({ x: x, y: y, t: now });
        while (scrub.length && now - scrub[0].t > SCRUB_MS) scrub.shift();

        var path = 0, minX = x, maxX = x, minY = y, maxY = y;
        var turnsX = 0, turnsY = 0, dirX = 0, dirY = 0;
        for (var i = 1; i < scrub.length; i++) {
            var p = scrub[i], q = scrub[i - 1];
            var dx = p.x - q.x, dy = p.y - q.y;
            path += Math.hypot(dx, dy);
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            // tiny jitters don't count as turning around
            if (Math.abs(dx) > 2) { if (dirX && Math.sign(dx) !== dirX) turnsX++; dirX = Math.sign(dx); }
            if (Math.abs(dy) > 2) { if (dirY && Math.sign(dy) !== dirY) turnsY++; dirY = Math.sign(dy); }
        }
        // a long way covered, but all of it within a small box: back and forth on one spot
        if (path < SCRUB_PATH || Math.max(turnsX, turnsY) < SCRUB_TURNS ||
            maxX - minX > SCRUB_BOX || maxY - minY > SCRUB_BOX) return;
        scrub = [];
        scrubPause = now + SCRUB_PAUSE_MS;
        // detection works in screen coordinates (a swipe may scroll the page under the
        // finger), the planet lands where the pointer is now
        addPlanet(field, x - rect.left, y - rect.top);
    }

    function start() {
        var pic = document.querySelector('.header .three.columns a');
        if (pic) pic.addEventListener('click', helloAgain);
        document.addEventListener('mousemove', function (e) { onScrub(e.clientX, e.clientY); }, { passive: true });
        document.addEventListener('touchmove', function (e) {
            if (e.touches.length === 1) onScrub(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        update();
        new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        setInterval(update, 60000);
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
