// The app's version, bumped with every change that's pushed. Shown in Settings and in the
// Navya footer; the running page compares it with the live copy to offer a reload.
export const APP_VERSION = "2026-10-26.2";

// Fetches the published version.js from the same address the app loads it from (not a
// one-off URL), so it reports the version a reload would actually get: GitHub Pages' CDN keeps
// each file for up to 10 minutes after a push, and a cache-busting query skipped that wait and
// offered a reload that came back with the old code. Returns the version, or null.
export async function liveVersion() {
  try {
    const res = await fetch("js/version.js", { cache: "reload" });
    if (!res.ok) return null;
    return (await res.text()).match(/APP_VERSION = "([^"]+)"/)?.[1] || null;
  } catch { return null; }
}

// Re-downloads the page, every module it imports (following import statements from js/app.js)
// and the other pages and scripts the app opens, so the reload after it can't reuse old copies
// from the browser's cache.
const EXTRA = ["js/vendor/html2canvas.min.js", "navya/game_logger.html", "navya/navya_tracker.html", "navya/dashboard.html", "navya/parent_logger.html"];
export async function refreshCode() {
  const get = (u) => fetch(u, { cache: "reload" }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  const seen = new Set(), queue = [new URL("js/app.js", location.href).href];
  await Promise.all([get(location.href.split("#")[0]), ...EXTRA.map((u) => get(new URL(u, location.href).href))]);
  while (queue.length) {
    const batch = queue.splice(0).filter((u) => !seen.has(u));
    batch.forEach((u) => seen.add(u));
    const texts = await Promise.all(batch.map(get));
    texts.forEach((text, i) => {
      for (const m of text.matchAll(/\bfrom\s*["'](\.[^"']+)["']|\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)|\bimport\s*["'](\.[^"']+)["']/g))
        queue.push(new URL(m[1] || m[2] || m[3], batch[i]).href);
    });
  }
  return seen.size;
}

// Shows a pinned "new version" banner (once) whenever the live copy is newer than this page.
// Reload now refreshes the code first; if a reload already happened for this version and the
// page still runs the old one, it says so instead of offering the same button again.
const TRIED = "app.updateTried";
export function watchForUpdates() {
  const check = async () => {
    const v = await liveVersion();
    try { if (v === APP_VERSION) sessionStorage.removeItem(TRIED); } catch {}
    if (!v || v === APP_VERSION || document.getElementById("updatebar")) return;
    let tried = false;
    try { tried = sessionStorage.getItem(TRIED) === v; } catch {}
    const bar = document.createElement("div");
    bar.id = "updatebar";
    bar.className = "banner";
    bar.innerHTML = tried
      ? `Version ${v} is still on its way to this device. Give it a minute, then <button class="btn sm" id="updatenow">Try again</button>`
      : `A newer version of the app is ready (${v}). <button class="btn sm" id="updatenow">Reload now</button>`;
    let box = document.getElementById("flashes");
    if (!box) { box = document.createElement("div"); box.id = "flashes"; const m = document.getElementById("main"); m.parentNode.insertBefore(box, m); }
    box.prepend(bar);
    bar.querySelector("#updatenow").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Updating…";
      try { sessionStorage.setItem(TRIED, v); } catch {}
      await refreshCode();
      location.reload();
    };
  };
  check();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  setInterval(check, 15 * 60 * 1000);
}
