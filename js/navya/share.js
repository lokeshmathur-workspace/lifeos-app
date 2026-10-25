// "📤 Share": one phone-shaped picture of the week to send on WhatsApp — the coach's read
// headline, this week's one focus, the "since last time" cards and this week's notes.
// Laid out at 540 CSS px and drawn at 2× (1080 px wide), so WhatsApp shows it sharp.
//
// makeShareImage(html, name) renders `html` off-screen, snapshots it with html2canvas
// (vendored, loaded on first use) and returns a PNG File plus its pixel size.

export const SHOT_W = 540;
const BG = "#0D0A1A";
let lib = null;
function loadHtml2canvas() {
  return (lib = lib || new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "js/vendor/html2canvas.min.js"; s.onload = res;
    s.onerror = () => { lib = null; rej(new Error("Couldn't load the picture maker. Check the connection and try again.")); };
    document.head.appendChild(s);
  }));
}

export async function makeShareImage(html, name) {
  await loadHtml2canvas();
  const box = document.createElement("div");
  box.style.cssText = `position:fixed;left:-${SHOT_W + 400}px;top:0;width:${SHOT_W}px;background:${BG}`;
  box.innerHTML = html;
  document.body.appendChild(box);
  try {
    await document.fonts?.ready;
    const el = box.firstElementChild;
    const canvas = await window.html2canvas(el, { backgroundColor: BG, scale: 2, logging: false, width: SHOT_W, windowWidth: SHOT_W });
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    return { file: new File([blob], `${name}.png`, { type: "image/png" }), width: canvas.width, height: canvas.height };
  } finally {
    box.remove();
  }
}
