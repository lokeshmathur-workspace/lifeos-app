// "Pay yourself first": what you kept (retirement, investing, savings) next to what merchants
// took (discretionary spending), this month or this year, with each category's merchants.
// Shared by the Family tab (Lokesh and Archana) and Navya's Money tab; only the words differ.
//
// Data (one object, from finance/monarch.json → payYourself, or Navya's money.json):
//   { month: "YYYY-MM", earned?: [{label, month, ytd}],
//     kept:  [{label, kind: "retirement"|"short"|"invest"|"save"|"paydown"|"kids"|"travel", note?, month, ytd}],
//     taken: [{category, month, ytd, note?, merchants: [{name, month, monthCount?, ytd, ytdCount?}]}] }
// A taken row with no merchants yet shows its `note` (e.g. where the store detail will come from).
// Amounts are positive dollars; `month` is this month so far, `ytd` this year so far. Counts are the
// number of days that merchant charged you (what Monarch can count).
// Travel counts as kept: business travel is an investment, personal travel an investment in memories.
// Paycheck contributions (`paystub: true`) always show, with where the figure comes from (`note`,
// `noteYear`). What goes to the kids (`kind: "kids"`, e.g. Navya's volleyball) is spent with a
// merchant but is an investment: it sits on the merchants' side in green, outside both totals.

// Kept rows are grouped by kind, in this order; headings show only when more than one group has money.
const GROUPS = [["Retirement", ["retirement"]], ["Savings & investing", ["short", "save", "invest"]], ["Paying down debt", ["paydown"]], ["Travel", ["travel"]]];

const usd = (n) => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);

export function computePayFirst(p, range) {
  if (!p) return null;
  const k = range === "year" ? "ytd" : "month";
  const all = (p.kept || []).map((x) => ({ ...x, amt: x[k] || 0, note: range === "year" && x.noteYear ? x.noteYear : x.note }));
  const kept = all.filter((x) => x.kind !== "kids" && (x.amt > 0 || x.paystub)).sort((a, b) => b.amt - a.amt);
  const invested = all.filter((x) => x.kind === "kids" && x.amt > 0).sort((a, b) => b.amt - a.amt);
  const taken = (p.taken || []).map((c) => ({ ...c, amt: c[k] || 0,
    merchants: (c.merchants || []).map((m) => ({ ...m, amt: m[k] || 0, count: range === "year" ? m.ytdCount : m.monthCount })).filter((m) => m.amt > 0).sort((a, b) => b.amt - a.amt) }))
    .filter((c) => c.amt > 0).sort((a, b) => b.amt - a.amt);
  const keptTotal = sum(kept, "amt"), takenTotal = sum(taken, "amt"), earned = sum((p.earned || []).map((x) => ({ amt: x[k] || 0 })), "amt");
  // a category whose merchants aren't known yet stands in for them
  const top = taken.flatMap((c) => (c.merchants.length ? c.merchants : [{ name: c.category, amt: c.amt }]).map((m) => ({ ...m, category: c.category }))).sort((a, b) => b.amt - a.amt);
  return { range, keptTotal, takenTotal, earned, kept, taken, invested, investedTotal: sum(invested, "amt"), top3: top.slice(0, 3), top3Total: sum(top.slice(0, 3), "amt"),
    keptShare: keptTotal + takenTotal ? keptTotal / (keptTotal + takenTotal) : 0,
    merchantCount: new Set(top.map((m) => m.name)).size };
}

// words: { title, you, kept, taken, takers?, earnedLabel?, keptHead, takenHead, payday, into, scope? }
export function payFirstHTML(p, range, w) {
  const r = computePayFirst(p, range);
  if (!r) return "";
  // The month is the one the numbers are for (the last sync); name it when it isn't this month.
  const now = new Date(), cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mName = p.month && p.month !== cur ? new Date(p.month + "-15T12:00:00").toLocaleDateString("en-US", { month: "long" }) : null;
  const period = range === "year" ? "this year" : mName ? `in ${mName}` : "this month", takers = w.takers || "merchants";
  const scope = w.scope ? ` data-scope="${esc(w.scope)}"` : ""; // which section's switch, when a screen has two
  const ratioText = r.keptTotal >= r.takenTotal && r.takenTotal ? `${w.you} kept <b>$${(r.keptTotal / r.takenTotal).toFixed(2)}</b> for every $1 ${takers} took ${period}.`
    : r.takenTotal ? `${cap(takers)} took <b>$${(r.takenTotal / Math.max(r.keptTotal, 1)).toFixed(2)}</b> for every $1 ${w.you.toLowerCase()} kept ${period}.` : `Nothing went to ${takers} ${period}.`;
  const row = (x) => `<li><span>${esc(x.label)}${x.note ? `<small>${esc(x.note)}</small>` : ""}</span><b>${usd(x.amt)}</b></li>`;
  const groups = GROUPS.map(([h, kinds]) => [h, r.kept.filter((x) => kinds.includes(x.kind))]).filter(([, xs]) => xs.length);
  const other = r.kept.filter((x) => !GROUPS.some(([, kinds]) => kinds.includes(x.kind)));
  if (other.length) groups.push(["Other", other]);
  const keptRows = groups.length > 1
    ? groups.map(([h, xs]) => `<li class="pyf-group"><span>${esc(h)}</span><span>${xs.length > 1 ? usd(sum(xs, "amt")) : ""}</span></li>${xs.map(row).join("")}`).join("")
    : r.kept.map(row).join("");
  const cats = r.taken.map((c) => !c.merchants.length ? `<div class="pyf-cat"><div class="pyf-sum"><span class="pyf-catname">${esc(c.category)}</span><b>${usd(c.amt)}</b>${c.note ? `<span class="pyf-catwho">${esc(c.note)}</span>` : ""}</div></div>` : `<details class="pyf-cat"><summary><span class="pyf-catname">${esc(c.category)}</span><span class="pyf-catwho">${c.merchants.length} ${c.merchants.length === 1 ? takers.replace(/s$/, "") : takers} took</span><b>${usd(c.amt)}</b></summary>
      <ul class="pyf-merch">${c.merchants.slice(0, 8).map((m) => `<li><span><b>${esc(m.name)}</b> took ${usd(m.amt)}</span><span class="pyf-n">${m.count ? `on ${m.count} day${m.count === 1 ? "" : "s"}` : ""}</span></li>`).join("")}
      ${c.merchants.length > 8 ? `<li class="pyf-more">and ${c.merchants.length - 8} more took ${usd(sum(c.merchants.slice(8), "amt"))}</li>` : ""}</ul></details>`).join("");
  return `<div class="pyf">
    <div class="pyf-head"><h3>${esc(w.title)}</h3><span class="pyf-range" role="group" aria-label="Period">
      <button type="button" data-act="pyfrange"${scope} data-range="month" aria-pressed="${range !== "year"}">${mName || "This month"}</button><button type="button" data-act="pyfrange"${scope} data-range="year" aria-pressed="${range === "year"}">This year</button></span></div>
    ${r.earned ? `<p class="pyf-earned">${esc(w.earnedLabel || "Earned")}${range !== "year" && mName ? ` (${mName})` : ` ${period}`}: <b>${usd(r.earned)}</b></p>` : ""}
    <div class="pyf-vs">
      <div class="pyf-side kept"><span>${esc(w.kept)}</span><b>${usd(r.keptTotal)}</b></div>
      <div class="pyf-side taken"><span>${esc(w.taken)}</span><b>${usd(r.takenTotal)}</b>${r.investedTotal ? `<small class="pyf-inv">+ ${usd(r.investedTotal)} invested in ${esc(w.investedIn || "the kids")}</small>` : ""}</div>
    </div>
    <div class="pyf-bar" aria-hidden="true"><i style="width:${Math.round(r.keptShare * 100)}%"></i></div>
    <p class="pyf-ratio">${ratioText}</p>
    <div class="pyf-cols">
      <div><h4>${esc(w.keptHead)}</h4><ul class="pyf-kept">${keptRows || `<li class="pyf-more">Nothing yet ${period}.</li>`}</ul></div>
      <div><h4>${esc(w.takenHead)}</h4>${r.invested.length ? `<div class="pyf-invested"><div class="pyf-invhead"><span>Invested in ${esc(w.investedIn || "the kids")}</span><b>${usd(r.investedTotal)}</b></div><ul>${r.invested.map((x) => `<li><span>${esc(x.label.replace(/^.*·\s*/, "").replace(/^./, (c) => c.toUpperCase()))}</span><b>${usd(x.amt)}</b></li>`).join("")}</ul></div>` : ""}${cats || `<p class="pyf-more">Nothing ${period}.</p>`}</div>
    </div>
    ${r.top3.length ? `<p class="pyf-nudge"><b>${r.top3.map((m) => esc(m.name)).join(", ").replace(/, ([^,]*)$/, " and $1")}</b> took ${usd(r.top3Total)} ${period}. ${esc(w.payday)} ${range === "year" ? `That's ${usd(r.top3Total)} that could be in ${esc(w.into)}.` : `At that pace that's ${usd(r.top3Total * 12)} a year that could go into ${esc(w.into)}.`}</p>` : ""}
  </div>`;
}
