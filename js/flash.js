// Shared save-confirmation/error banner — used by every view so a save always
// has *some* visible outcome (success or failure), never silence. Silence reads
// as "did that even work?", which is exactly what was missing from Week/Month.
//
// Banners live in their own container just above #main, not inside it: views
// re-render by replacing #main's innerHTML, which used to wipe a banner the
// instant it appeared whenever a flash() was followed by a render().
export function flash(msg, isErr) {
  const main = document.getElementById("main");
  let box = document.getElementById("flashes");
  if (!box) {
    box = document.createElement("div");
    box.id = "flashes";
    main.parentNode.insertBefore(box, main);
  }
  // A new message replaces earlier confirmations (errors stay until they time out).
  box.querySelectorAll(".banner:not(.err)").forEach((old) => old.remove());
  const b = document.createElement("div");
  b.className = "banner" + (isErr ? " err" : "");
  b.textContent = msg;
  box.prepend(b);
  setTimeout(() => b.remove(), 6000);
}
