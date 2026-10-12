// The app's version, bumped with every change that's pushed. Shown in Settings and in the
// Navya footer; the running page compares it with the live copy to offer a reload.
export const APP_VERSION = "2026-10-12.1";

// Fetches the published version.js (bypassing every cache) and returns its version, or null.
export async function liveVersion() {
  try {
    const res = await fetch(`js/version.js?check=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.text()).match(/APP_VERSION = "([^"]+)"/)?.[1] || null;
  } catch { return null; }
}

// Shows a pinned "new version" banner (once) whenever the live copy is newer than this page.
export function watchForUpdates() {
  const check = async () => {
    const v = await liveVersion();
    if (!v || v === APP_VERSION || document.getElementById("updatebar")) return;
    const bar = document.createElement("div");
    bar.id = "updatebar";
    bar.className = "banner";
    bar.innerHTML = `A newer version of the app is ready (${v}). <button class="btn sm" id="updatenow">Reload now</button>`;
    let box = document.getElementById("flashes");
    if (!box) { box = document.createElement("div"); box.id = "flashes"; const m = document.getElementById("main"); m.parentNode.insertBefore(box, m); }
    box.prepend(bar);
    bar.querySelector("#updatenow").onclick = () => location.reload();
  };
  check();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  setInterval(check, 15 * 60 * 1000);
}
