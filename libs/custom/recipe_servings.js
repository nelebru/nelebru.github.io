/* ---------- Scale ingredients to the number of servings ---------- */

// Recipe pages opt in with data-servings="<base servings>" on .ingredients-list and wrap
// every scalable amount in <span class="qty">…</span> ("600", "1.5", "1/2", "1-2" all work).
// A − / + stepper under the "Ingredients" heading rescales all amounts. The chosen number
// is kept in sessionStorage, like the ticks (recipe_ingredients.js).
// An optional data-unit="pieces" counts something else than servings (singular: without the "s").
(function () {
    const list = document.querySelector(".ingredients-list[data-servings]");
    if (!list) return;

    const base = parseFloat(list.dataset.servings);
    const qtys = [...list.querySelectorAll(".qty")];
    if (!base || !qtys.length) return;

    const UNITS = list.dataset.unit || "servings";
    const UNIT = UNITS.replace(/s$/, "");

    const STORAGE_KEY = "servings:" + location.pathname;
    const MIN = 1, MAX = 25;
    const PARTY = 10; // more than this many gets a little celebration

    // "1/2" -> 0.5, "600" -> 600
    function parseNumber(s) {
        const [num, den] = s.split("/");
        return den ? parseFloat(num) / parseFloat(den) : parseFloat(num.replace(",", "."));
    }

    // big amounts (g, ml) to the nearest 10 or 5, small ones (pieces, spoons) to halves,
    // pinches below 1 to quarters
    function format(n) {
        if (n >= 50) return String(Math.round(n / 10) * 10);
        if (n >= 10) return String(Math.round(n / 5) * 5);
        if (n < 0.875) return ["¼", "½", "¾"][Math.max(1, Math.round(n * 4)) - 1];
        const halves = Math.max(1, Math.round(n * 2));
        const whole = Math.floor(halves / 2);
        return halves % 2 ? (whole ? whole + "½" : "½") : String(whole);
    }

    // remember the original amounts, scaling always starts from them
    qtys.forEach(span => {
        span.dataset.base = span.textContent.trim();
    });

    function render(servings) {
        const factor = servings / base;
        qtys.forEach(span => {
            // ranges like "1-2" scale both ends; collapse them when rounding makes them equal
            const ends = [...new Set(span.dataset.base.split(/[-–]/).map(part => format(parseNumber(part) * factor)))];
            span.textContent = ends.join("–");
        });
        count.textContent = servings;
        unit.textContent = servings === 1 ? UNIT : UNITS;
        party.hidden = servings <= PARTY;
        minus.disabled = servings <= MIN;
        plus.disabled = servings >= MAX;
        try {
            sessionStorage.setItem(STORAGE_KEY, servings);
        } catch (e) { /* storage blocked: the number holds until the page is left */ }
    }

    const control = document.createElement("div");
    control.className = "recipe-servings";
    control.innerHTML = `
        <button type="button" class="servings-btn" aria-label="Fewer ${UNITS}">−</button>
        <span class="servings-label" aria-live="polite"><span class="servings-count"></span> <span class="servings-unit"></span></span>
        <button type="button" class="servings-btn" aria-label="More ${UNITS}">+</button>`;
    const [minus, plus] = control.querySelectorAll("button");
    const count = control.querySelector(".servings-count");
    const unit = control.querySelector(".servings-unit");

    // next to the stepper
    const party = document.createElement("span");
    party.className = "servings-party";
    party.setAttribute("aria-live", "polite");
    party.textContent = "It's a party! 🎉🥳🎊";
    control.append(party);

    // right under the heading, above the tick hint (recipe_ingredients.js)
    list.querySelector("h3").after(control);

    let servings = base;
    try {
        const saved = parseInt(sessionStorage.getItem(STORAGE_KEY), 10);
        if (saved >= MIN && saved <= MAX) servings = saved;
    } catch (e) { /* storage blocked: start with the base servings */ }

    minus.addEventListener("click", () => render(servings = Math.max(MIN, servings - 1)));
    plus.addEventListener("click", () => render(servings = Math.min(MAX, servings + 1)));
    render(servings);
})();
