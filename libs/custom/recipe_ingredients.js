/* ---------- Tick off ingredients while cooking ---------- */

// Tapping an ingredient on a recipe page crosses it out (and tapping again brings it back).
// The ticks are kept in sessionStorage, so they survive a reload of the tab (e.g. when the
// phone discarded it while locked) but a new visit to the recipe starts with a fresh list.
(function () {
    const items = [...document.querySelectorAll(".ingredients-list li")];
    if (!items.length) return;

    const STORAGE_KEY = "ticked:" + location.pathname;

    function readTicked() {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || [];
        } catch (e) {
            return [];
        }
    }

    function saveTicked() {
        const ticked = items.flatMap((li, i) => li.classList.contains("ticked") ? [i] : []);
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ticked));
        } catch (e) { /* storage blocked: the ticks hold until the page is left */ }
    }

    function setTicked(li, ticked) {
        li.classList.toggle("ticked", ticked);
        li.setAttribute("aria-checked", ticked);
    }

    // small hint under each "Ingredients" heading, only shown when ticking works
    document.querySelectorAll(".ingredients-list h3").forEach(h3 => {
        const hint = document.createElement("p");
        hint.className = "tick-hint";
        hint.textContent = "Tap to tick off";
        h3.after(hint);
    });

    const ticked = new Set(readTicked());
    items.forEach((li, i) => {
        li.classList.add("tickable");
        li.setAttribute("role", "checkbox");
        li.tabIndex = 0;
        setTicked(li, ticked.has(i));

        const toggle = () => {
            setTicked(li, !li.classList.contains("ticked"));
            saveTicked();
        };
        li.addEventListener("click", toggle);
        li.addEventListener("keydown", e => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggle();
            }
        });
    });
})();
