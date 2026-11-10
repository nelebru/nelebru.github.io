/* ---------- Strip under a recipe's title: time, servings, tags ---------- */

// Switched on with recipe_strip in _config.yml (styles in recipe_extras.css). The time and
// tags come from the recipe's front matter (time: "45 min", tags: [vegan, quick]) through
// window.RECIPE, set in _layouts/default.html; the servings from data-servings on
// .ingredients-list (and they follow the stepper of recipe_servings.js). Whatever a recipe
// doesn't have is left out, and without anything there is no strip.
(function () {
    const title = document.querySelector(".recipe-title2");
    const meta = window.RECIPE || {};
    if (!title) return;

    // same icons and names as the filter chips on the overview (recipes.html)
    const TAGS = {
        "vegan":      ["fa-seedling", "Vegan"],
        "quick":      ["fa-stopwatch", "Quick"],
        "plan-ahead": ["fa-calendar-days", "Plan ahead"],
        "christmas":  ["fa-candy-cane", "Christmas"],
        "autumn":     ["fa-leaf", "Autumn"],
        "summer":     ["fa-sun", "Summer"]
    };

    const strip = document.createElement("div");
    strip.className = "recipe-strip";

    function item(icon, text, extraClass) {
        const span = document.createElement("span");
        span.className = "strip-item" + (extraClass ? " " + extraClass : "");
        span.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i> <span class="strip-text"></span>`;
        span.querySelector(".strip-text").textContent = text;
        strip.append(span);
        return span;
    }

    if (meta.time) item("fa-clock", meta.time);

    const list = document.querySelector(".ingredients-list[data-servings]");
    if (list) {
        const units = list.dataset.unit || "servings";
        const text = n => `${n} ${n == 1 ? units.replace(/s$/, "") : units}`;
        const servings = item("fa-utensils", text(list.dataset.servings)).querySelector(".strip-text");
        // the stepper is added by recipe_servings.js; follow its number
        const follow = () => {
            const count = list.querySelector(".servings-count");
            if (!count) return;
            const update = () => { servings.textContent = text(count.textContent.trim()); };
            update();
            new MutationObserver(update).observe(count, { childList: true, characterData: true, subtree: true });
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", follow);
        else follow();
    }

    (meta.tags || []).forEach(tag => {
        const [icon, name] = TAGS[tag] || ["fa-tag", tag];
        item(icon, name, "strip-tag").dataset.tag = tag;
    });

    if (strip.children.length) title.append(strip);

    // the stages behind the total time (stages: {prep: "20 min", bake: "50 min"} in the front
    // matter, in the order they happen), as a second, quieter line under the strip
    const STAGES = {
        "prep":    "fa-spoon",
        "brew":    "fa-mug-hot",
        "soak":    "fa-droplet",
        "rise":    "fa-hourglass-half",
        "rest":    "fa-hourglass-half",
        "chill":   "fa-snowflake",
        "steam":   "fa-cloud",
        "cook":    "fa-fire-burner",
        "bake":    "fa-temperature-high",
        "roast":   "fa-fire",
        "ferment": "fa-flask"
    };
    const stages = Object.entries(meta.stages || {});
    if (stages.length) {
        const row = document.createElement("div");
        row.className = "recipe-stages";
        stages.forEach(([name, time]) => {
            const span = document.createElement("span");
            span.className = "stage";
            span.innerHTML = `<i class="fa-solid ${STAGES[name] || "fa-clock"}" aria-hidden="true"></i> <span class="stage-name"></span> <span class="stage-time"></span>`;
            span.querySelector(".stage-name").textContent = name;
            span.querySelector(".stage-time").textContent = time;
            row.append(span);
        });
        title.append(row);
    }
})();
