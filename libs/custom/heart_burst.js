/* ---------- Pastel hearts flying up from a like button ---------- */

// Used by the recipe likes (recipe_likes.js) and the course likes (gpx.html).
// The hearts start from the heart icon inside the button; styles in my_css.css (.flying-heart).
(function () {
    const PASTELS = ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"];

    window.burstHearts = function (btn) {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        // start from the heart icon only, not from the label
        const rect = (btn.querySelector(".fa-heart") || btn).getBoundingClientRect();
        for (let i = 0; i < 14; i++) {
            const heart = document.createElement("i");
            heart.className = "fa-solid fa-heart flying-heart";
            heart.setAttribute("aria-hidden", "true");
            heart.style.left = `${rect.left + rect.width / 2}px`;
            heart.style.top = `${rect.top + rect.height / 2}px`;
            heart.style.color = PASTELS[Math.floor(Math.random() * PASTELS.length)];
            heart.style.fontSize = `${1 + Math.random() * 1.4}rem`;
            heart.style.setProperty("--drift", `${(Math.random() - 0.5) * 160}px`);
            heart.style.setProperty("--rise", `${120 + Math.random() * 160}px`);
            heart.style.setProperty("--spin", `${(Math.random() - 0.5) * 60}deg`);
            heart.style.animationDuration = `${0.9 + Math.random() * 0.8}s`;
            heart.style.animationDelay = `${Math.random() * 0.25}s`;
            heart.addEventListener("animationend", () => heart.remove());
            document.body.appendChild(heart);
        }
    };
})();
