// Small chart helpers for the Navya tab. Everything is drawn to one scale per chart, with text
// colours from the tab's tokens. Series colours: validated categorical set on the #17122B panel.
export const SERIES = ["#E8399E", "#0E9FBF", "#8B5CF6", "#D17A22", "#2E9E5B"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// series: [{ name, color, points: [[xLabel, y]] }] sharing the same x labels.
export function lineChart({ series, width, height = 190, yMin = 0, yMax, yTicks, yFmt = (v) => v, label = "Chart", marks = [] }) {
  const W = Math.max(280, width || 520), H = height, m = { l: 44, r: 142, t: 12, b: 26 };
  const tickFmt = arguments[0].tickFmt || yFmt;
  const xs = series[0]?.points.map((p) => p[0]) || [];
  if (!xs.length) return "";
  const X = (i) => m.l + (xs.length === 1 ? (W - m.l - m.r) / 2 : (i / (xs.length - 1)) * (W - m.l - m.r));
  const Y = (v) => m.t + ((yMax - Math.max(yMin, Math.min(yMax, v))) / (yMax - yMin)) * (H - m.t - m.b);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">`;
  for (const v of yTicks) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2A2247"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="#8F83B3">${esc(tickFmt(v))}</text>`;
  const every = Math.ceil(xs.length / 6);
  xs.forEach((x, i) => { if (i % every === 0 || i === xs.length - 1) s += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8F83B3">${esc(x)}</text>`; });
  for (const mk of marks) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(mk.y)}" y2="${Y(mk.y)}" stroke="#F6F1FF" stroke-width="1.5" stroke-dasharray="5 4" opacity=".75"/><text x="${W - m.r - 4}" y="${Y(mk.y) < m.t + 14 ? Y(mk.y) + 14 : Y(mk.y) - 5}" text-anchor="end" font-size="11" fill="#C9BEE6">${esc(mk.label)}</text>`;
  const labels = [];
  series.forEach((se) => {
    const pts = se.points.map((p, i) => [i, p[1]]).filter(([, v]) => v != null);
    if (pts.length > 1) s += `<polyline points="${pts.map(([i, v]) => `${X(i)},${Y(v)}`).join(" ")}" fill="none" stroke="${se.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach(([i, v]) => (s += `<circle cx="${X(i)}" cy="${Y(v)}" r="4.5" fill="${se.color}" stroke="#17122B" stroke-width="2"><title>${esc(se.name)} · ${esc(xs[i])}: ${esc(yFmt(v))}</title></circle>`));
    const last = pts.at(-1);
    if (last) labels.push({ y: Y(last[1]), se, v: last[1] });
  });
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
  for (const L of labels) s += `<circle cx="${W - m.r + 12}" cy="${L.y}" r="4" fill="${L.se.color}"/><text x="${W - m.r + 20}" y="${L.y + 4}" font-size="11.5" font-weight="700" fill="#C9BEE6">${esc(L.se.name)} ${esc(yFmt(L.v))}</text>`;
  return s + "</svg>";
}

// Horizontal bars on one shared scale. rows: [{ label, value, text, color, mark? }]
export function hbars(rows, max, ticks, fmt) {
  const pct = (v) => (Math.min(v, max) / max) * 100;
  return `<div class="nv-bars">${rows.map((r) => `<div class="nv-bar"><span>${esc(r.label)}</span><div class="t"><i style="width:${pct(r.value)}%;background:${r.color}"></i>${r.mark != null ? `<b class="lim" style="left:${pct(r.mark)}%"></b>` : ""}</div><span class="v">${esc(r.text)}</span></div>`).join("")}
    <div class="nv-bar"><span></span><div class="ax">${ticks.map((t) => `<span style="left:${pct(t)}%">${esc(fmt(t))}</span>`).join("")}</div><span></span></div></div>`;
}

// Vertical columns from zero. cols: [{ label, value, text, color }], optional limit line.
export function columns(cols, max, limit, limitLabel) {
  return `<div class="nv-cols">${cols.map((c) => `<div class="c"><span>${esc(c.text)}</span><i style="height:${(Math.min(c.value, max) / max) * 100}%;background:${c.color}"></i></div>`).join("")}
    ${limit != null ? `<div class="lim" style="bottom:${(limit / max) * 100}%"><span>${esc(limitLabel)}</span></div>` : ""}</div>
    <div class="nv-colx">${cols.map((c) => `<span>${esc(c.label)}</span>`).join("")}</div>`;
}
