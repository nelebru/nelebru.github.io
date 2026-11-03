/* ---------- Cook mode: tap the instruction steps off one by one ---------- */

// Switched on with recipe_steps in _config.yml (styles in recipe_extras.css). Tapping a step
// marks it done (and tapping again brings it back); the first step not done yet is
// highlighted, so the place in the recipe isn't lost with floury hands. Like the ingredient
// ticks (recipe_ingredients.js), the steps are kept in sessionStorage: they survive a reload
// of the tab, but a new visit starts fresh.
(function () {
    const lists = [...document.querySelectorAll(".recipe ol")];
    const steps = lists.flatMap(ol => [...ol.children].filter(li => li.tagName === "LI"));
    if (!steps.length) return;

    const STORAGE_KEY = "steps:" + location.pathname;

    function readDone() {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || [];
        } catch (e) {
            return [];
        }
    }

    function saveDone() {
        const done = steps.flatMap((li, i) => li.classList.contains("done") ? [i] : []);
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(done));
        } catch (e) { /* storage blocked: the steps hold until the page is left */ }
    }

    // small hint above the first list of steps, like the one for the ingredients
    const hint = document.createElement("p");
    hint.className = "tick-hint step-hint";
    hint.textContent = "Tap a step when it's done";
    lists[0].before(hint);

    // and a little cheer below the last one, once all are done
    const cheer = document.createElement("p");
    cheer.className = "steps-cheer";
    cheer.setAttribute("aria-live", "polite");
    lists[lists.length - 1].after(cheer);

    function update(scroll) {
        const current = steps.find(li => !li.classList.contains("done"));
        steps.forEach(li => {
            li.classList.toggle("current", li === current);
            li.setAttribute("aria-checked", li.classList.contains("done"));
        });
        // (only takes up room once it has something to say)
        cheer.hidden = !!current;
        cheer.innerHTML = current ? "" : 'All done. Enjoy! <i class="fa-solid fa-utensils" aria-hidden="true"></i>';
        // bring the next step into view when it is below the window
        if (scroll && current && current.getBoundingClientRect().bottom > window.innerHeight) {
            current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }

    const done = new Set(readDone());
    steps.forEach((li, i) => {
        li.classList.add("step");
        li.classList.toggle("done", done.has(i));
        li.setAttribute("role", "checkbox");
        li.tabIndex = 0;

        const toggle = () => {
            const nowDone = !li.classList.contains("done");
            li.classList.toggle("done", nowDone);
            saveDone();
            update(nowDone);
        };
        li.addEventListener("click", e => {
            // links inside a step still work as links
            if (e.target.closest("a")) return;
            toggle();
        });
        li.addEventListener("keydown", e => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggle();
            }
        });
    });
    update(false);
})();
