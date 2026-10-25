/* ---------- Keep the screen on while cooking ---------- */

// Switch under the title of each recipe page that holds a Screen Wake Lock, so the
// phone doesn't lock while you're following the steps. The browser drops the lock
// whenever the tab is hidden, so it is requested again when the page becomes visible.
// Browsers without the Wake Lock API (or without HTTPS) don't get the switch at all.
(function () {
    if (!("wakeLock" in navigator)) return;

    const title = document.querySelector(".recipe-title2");
    if (!title) return;

    let lock = null;

    const label = document.createElement("label");
    label.className = "recipe-wake";
    label.innerHTML = `
        <input type="checkbox" role="switch">
        <span class="wake-track" aria-hidden="true"></span>
        <span class="wake-text">Keep screen on</span>`;
    const input = label.querySelector("input");
    title.after(label);

    async function acquire() {
        try {
            lock = await navigator.wakeLock.request("screen");
            // released by the browser (tab hidden, battery saver, ...)
            lock.addEventListener("release", () => { lock = null; });
        } catch (err) {
            console.error("Wake lock failed:", err);
            input.checked = false;
        }
    }

    function release() {
        lock?.release();
        lock = null;
    }

    input.addEventListener("change", () => input.checked ? acquire() : release());

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && input.checked && !lock) acquire();
    });
})();
