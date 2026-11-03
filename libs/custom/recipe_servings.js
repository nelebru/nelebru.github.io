/* ---------- Scale ingredients to the number of servings ---------- */

// Recipe pages opt in with data-servings="<base servings>" on .ingredients-list and wrap
// every scalable amount in <span class="qty">…</span> ("600", "1.5", "1/2", "1-2" all work).
// A − / + stepper under the "Ingredients" heading rescales all amounts. The chosen number
// is kept in sessionStorage, like the ticks (recipe_ingredients.js).
// An optional data-unit="pieces" counts something else than servings (singular: without the "s").
// Recipes that don't feed a set number of people (cakes, cookies, bread) use data-scale
// instead: the stepper then goes through half, single, 1½, double, triple and 4 batches;
// data-scale="<note>" shows a note beside it whenever it isn't at 1 batch.
(function () {
    const list = document.querySelector(".ingredients-list[data-servings], .ingredients-list[data-scale]");
    if (!list) return;

    const BATCHES = !list.dataset.servings;
    const base = BATCHES ? 1 : parseFloat(list.dataset.servings);
    const qtys = [...list.querySelectorAll(".qty")];
    if (!base || !qtys.length) return;

    const UNITS = BATCHES ? "batches" : list.dataset.unit || "servings";
    const UNIT = BATCHES ? "batch" : UNITS.replace(/s$/, "");

    // what the stepper goes through
    const STEPS = BATCHES ? [0.5, 1, 1.5, 2, 3, 4] : Array.from({ length: 25 }, (_, i) => i + 1);

    const STORAGE_KEY = "servings:" + location.pathname;
    const PARTY = 10; // more servings than this get a little celebration
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
        count.textContent = servings === 0.5 ? "½" : servings === 1.5 ? "1½" : servings;
        unit.textContent = servings <= 1 ? UNIT : UNITS;
        party.hidden = BATCHES || servings <= PARTY;
        note.hidden = !note.textContent || servings === 1;
        minus.disabled = servings <= STEPS[0];
        plus.disabled = servings >= STEPS[STEPS.length - 1];
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

    // batches only, away from 1: an optional note from data-scale="…" (e.g. that a cake twice
    // the size needs another tin and time)
    const note = document.createElement("span");
    note.className = "servings-note";
    note.textContent = BATCHES ? list.dataset.scale : "";
    control.append(note);

    // right under the heading, above the tick hint (recipe_ingredients.js)
    list.querySelector("h3").after(control);

    let step = Math.max(0, STEPS.indexOf(base));
    try {
        const saved = STEPS.indexOf(parseFloat(sessionStorage.getItem(STORAGE_KEY)));
        if (saved >= 0) step = saved;
    } catch (e) { /* storage blocked: start with the base servings */ }

    minus.addEventListener("click", () => render(STEPS[step = Math.max(0, step - 1)]));
    plus.addEventListener("click", () => render(STEPS[step = Math.min(STEPS.length - 1, step + 1)]));
    render(STEPS[step]);
})();
