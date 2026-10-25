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
    let pending = false;

    const label = document.createElement("label");
    label.className = "recipe-wake";
    label.innerHTML = `
        <input type="checkbox" role="switch">
        <span class="wake-track" aria-hidden="true"></span>
        <span class="wake-text">Keep screen on</span>`;
    const input = label.querySelector("input");
    title.after(label);

    async function acquire() {
        if (lock || pending) return;
        pending = true;
        try {
            const sentinel = await navigator.wakeLock.request("screen");
            // switched off while the request was still pending
            if (!input.checked) { sentinel.release(); return; }
            lock = sentinel;
            // released by the browser (tab hidden, battery saver, ...)
            sentinel.addEventListener("release", () => { if (lock === sentinel) lock = null; });
        } catch (err) {
            console.error("Wake lock failed:", err);
            input.checked = false;
        } finally {
            pending = false;
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
