// "📤 Share": turns Navya view's HQ (coach's read, notes, how each area is going) into a PDF
// to send on WhatsApp. A PDF rather than one long picture: WhatsApp shrinks long images until
// they can't be read, but sends documents as they are.
//
// makeSharePdf(html, name) renders `html` off-screen at a fixed width, snapshots each block
// (header, each tile) with html2canvas, packs the blocks onto pages without cutting through
// one, and returns a PDF File. The two libraries are vendored and loaded on first use.

const WIDTH = 760, PAD = 24, GAP = 16, PAGE_H = Math.round(WIDTH * 1.414), BG = "#0D0A1A";
const loaded = {};
function load(src) {
  return (loaded[src] = loaded[src] || new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("Couldn't load " + src)); };
    document.head.appendChild(s);
  }));
}

export async function makeSharePdf(html, name) {
  await Promise.all([load("js/vendor/html2canvas.min.js"), load("js/vendor/jspdf.umd.min.js")]);
  const box = document.createElement("div");
  box.className = "nv-sharebox";
  box.style.cssText = `position:fixed;left:-${WIDTH + 200}px;top:0;width:${WIDTH}px;padding:${PAD}px;background:${BG}`;
  box.innerHTML = html;
  box.querySelectorAll("details").forEach((d) => (d.open = true)); // the PDF shows everything
  document.body.appendChild(box);
  try {
    await document.fonts?.ready;
    const root = box.firstElementChild;
    // blocks: the header bits, then each tile on its own so a page break never cuts one
    const blocks = [...root.children].flatMap((el) => (el.classList.contains("nv-bento") ? [...el.children] : [el]))
      .filter((el) => el.offsetHeight > 0);
    const shots = [];
    for (const el of blocks) {
      const c = await window.html2canvas(el, { backgroundColor: BG, scale: 2, logging: false, useCORS: true });
      shots.push({ c, w: el.offsetWidth, h: el.offsetHeight });
    }
    // pack onto pages of A4 shape. A block that fits on a page never gets cut by a page break;
    // one taller than a page stays where it is and that page grows to hold it.
    const pages = [];
    let cur = null;
    for (const s of shots) {
      const fitsAPage = s.h <= PAGE_H - 2 * PAD;
      if (!cur || (cur.items.length && cur.y + s.h > PAGE_H - PAD && fitsAPage)) pages.push((cur = { y: PAD, items: [] }));
      cur.items.push({ s, y: cur.y });
      cur.y += s.h + GAP;
    }
    const { jsPDF } = window.jspdf;
    const pw = WIDTH + 2 * PAD, size = (p) => [pw, Math.max(PAGE_H, p.y - GAP + PAD)];
    const pdf = new jsPDF({ unit: "px", format: size(pages[0]), hotfixes: ["px_scaling"], compress: true });
    pages.forEach((p, i) => {
      if (i) pdf.addPage(size(p));
      const [w, h] = size(p);
      pdf.setFillColor(BG); pdf.rect(0, 0, w, h, "F");
      for (const { s, y } of p.items) pdf.addImage(s.c.toDataURL("image/jpeg", 0.9), "JPEG", PAD, y, s.w, s.h, undefined, "FAST");
    });
    pdf.setProperties({ title: name });
    return new File([pdf.output("blob")], `${name}.pdf`, { type: "application/pdf" });
  } finally {
    box.remove();
  }
}
