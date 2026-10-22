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
        "Hoo's still awake? 🌙",
        'Night owls unite! 🦉',
        "Shouldn't you be asleep? Training starts at 6 a.m. 🚴",
        'Hoo hoo! Midnight snack? Try the brownies 🍫',
        'Sweet dreams of fast descents 💤'
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
        return document.documentElement.getAttribute('data-theme') === 'dark'
            && hour >= NIGHT_FROM && hour < NIGHT_TO;
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

    function start() {
        var pic = document.querySelector('.header .three.columns a');
        if (pic) pic.addEventListener('click', helloAgain);
        update();
        new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        setInterval(update, 60000);
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
