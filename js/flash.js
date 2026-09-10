// Shared save-confirmation/error banner — used by every view so a save always
// has *some* visible outcome (success or failure), never silence. Silence reads
// as "did that even work?", which is exactly what was missing from Week/Month.
export function flash(msg, isErr) {
  const main = document.getElementById("main");
  const b = document.createElement("div");
  b.className = "banner" + (isErr ? " err" : "");
  b.textContent = msg;
  main.prepend(b);
  setTimeout(() => b.remove(), 6000);
}
