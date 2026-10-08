/* ---------- Likes for the recipes ---------- */

// Count in the corner of each tile on the overview, heart button under the title of
// each recipe page. Counts come from the same Cloudflare Worker as the course likes
// (_likes-worker/), where recipes are stored as "recipe:<id>". Which recipes this
// browser has liked is kept in localStorage, written only when the visitor clicks a heart.
(function () {
    const LIKES_API = window.LIKES_API;
    if (!LIKES_API) return;

    const RECIPE_PREFIX = "recipe:";
    const LIKED_KEY = "likedRecipes";
    let likeCounts = {};
    const likedRecipes = new Set(readLiked());

    function readLiked() {
        try {
            return JSON.parse(localStorage.getItem(LIKED_KEY)) || [];
        } catch (e) {
            return [];
        }
    }

    function saveLiked() {
        try {
            localStorage.setItem(LIKED_KEY, JSON.stringify([...likedRecipes]));
        } catch (e) { /* storage blocked: the like still counts, it just isn't remembered */ }
    }

    // same derivation as assets/data/recipes.json: file name without .html
    function recipeId(url) {
        return new URL(url, location.href).pathname.split("/").pop().replace(/\.html$/i, "");
    }

    function heartIcon(liked) {
        return `<i class="${liked ? "fa-solid" : "fa-regular"} fa-heart" aria-hidden="true"></i>`;
    }

    /* overview: count on the tiles (read-only, clicking still opens the recipe) */
    function updateTiles() {
        document.querySelectorAll(".recipe-tile").forEach(tile => {
            const id = recipeId(tile.href);
            const count = likeCounts[id] || 0;

            tile.querySelector(".tile-like")?.remove();
            tile.classList.toggle("has-likes", count > 0);
            if (count === 0) return;

            const badge = document.createElement("span");
            badge.className = "tile-like";
            badge.title = `${count} ${count === 1 ? "like" : "likes"}`;
            badge.innerHTML = heartIcon(likedRecipes.has(id)) + `<span>${count}</span>`;
            tile.appendChild(badge);
        });
    }

    /* recipe page: heart button under the title */
    function updateButton(btn) {
        const id = btn.dataset.recipe;
        const liked = likedRecipes.has(id);
        const count = likeCounts[id] || 0;

        btn.classList.toggle("liked", liked);
        btn.setAttribute("aria-pressed", liked);
        btn.title = liked ? "You like this recipe" : "Like this recipe";
        btn.innerHTML = heartIcon(liked) + (count > 0 ? `<span class="like-count">${count}</span>` : "");
    }

    function addButton() {
        const title = document.querySelector(".recipe-title2");
        if (!title) return;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "recipe-like-btn";
        btn.dataset.recipe = recipeId(location.href);
        btn.addEventListener("click", () => likeRecipe(btn.dataset.recipe));
        title.appendChild(btn);
        updateButton(btn);
    }

    function refresh() {
        updateTiles();
        document.querySelectorAll(".recipe-like-btn").forEach(updateButton);
    }

    function likeRecipe(id) {
        if (likedRecipes.has(id)) return;

        // show it right away, roll back if the Worker can't be reached
        likedRecipes.add(id);
        likeCounts[id] = (likeCounts[id] || 0) + 1;
        saveLiked();
        refresh();

        fetch(LIKES_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipe: id })
        })
            .then(res => {
                if (!res.ok) throw new Error(`Like failed (${res.status})`);
                return res.json();
            })
            .then(data => { likeCounts[id] = data.count; })
            .catch(err => {
                console.error(err);
                likedRecipes.delete(id);
                likeCounts[id] = Math.max(0, (likeCounts[id] || 1) - 1);
                saveLiked();
            })
            .finally(refresh);
    }

    // Hearts only appear once the counts have loaded. If the Worker can't be reached
    // (e.g. a blocker or DNS filter stops workers.dev), the page simply stays without hearts.
    fetch(LIKES_API)
        .then(res => {
            if (!res.ok) throw new Error(`Status ${res.status}`);
            return res.json();
        })
        .then(counts => {
            for (const [key, count] of Object.entries(counts)) {
                if (key.startsWith(RECIPE_PREFIX)) likeCounts[key.slice(RECIPE_PREFIX.length)] = count;
            }
            addButton();
            refresh();
        })
        .catch(err => console.error("Error loading likes:", err));
})();
