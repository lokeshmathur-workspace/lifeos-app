// "Looking back": every week's read, notes, Growing Together and numbers, by week or by month, and
// a search across all the notes. The numbers are a snapshot the app freezes into review/<week>.json
// on Growing Together day (and refreshes when notes are saved or the read approved) — the app's own
// figures as they were that week, never typed in, so they can be compared later.
import { computePayFirst } from "../payfirst.js";
import { addDays } from "./compute.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtD = (iso, o = { month: "short", day: "numeric" }) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", o) : "");
const usd = (n) => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);
const hm = (m) => (m == null ? "–" : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
const monthName = (ym) => new Date(ym + "-15T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
const LOG_TAGS = { progress: "Made a change", notyet: "Not yet" };

// ── the snapshot ──
export function snapshotOf(D, C) {
  const m = C.money, R = D.rel || {}, wk = C.week;
  const pf = m?.payYourself ? computePayFirst(m.payYourself, "month") : null, nv = m?.navyaMoney ? computePayFirst(m.navyaMoney, "month") : null;
  const health = {};
  for (const h of C.health) { const e = h.weeks.find((x) => x.weekStart === wk) || null; health[h.id] = e ? { sleep: e.sleepHours ?? null, exercise: e.exerciseDays ?? null, energy: e.energy ?? null } : null; }
  const kept = (R.ritualLog || {})[wk] || [];
  return {
    at: new Date().toISOString(),
    money: m ? { spent: m.spent, usual: m.avg3Spending, savingsRate: m.savingsRate, kept: pf?.keptTotal ?? null, taken: pf?.takenTotal ?? null,
      heloc: (m.creditLines || []).reduce((s, c) => s + (c.balance || 0), 0) || null } : null,
    navya: { kept: nv?.keptTotal ?? null, taken: nv?.takenTotal ?? null, gpa: C.navya?.gpa ?? null, social: C.navya?.social ?? null, calls: C.navya?.calls ?? null },
    us: { together: (R.together || []).filter((t) => t.date >= wk && t.date <= addDays(wk, 6)).length,
      thanks: (R.appreciation || []).filter((a) => a.date >= wk && a.date <= addDays(wk, 6)).length, ritualsKept: kept.length, ritualsTotal: (R.rituals || []).length },
    health,
    home: { done: C.home.done7, open: C.home.todos.length },
    kids: { appointments: C.kids.reduce((s, k) => s + k.appointments.length, 0) },
  };
}

// Rows shown for a snapshot: [label, value(s), format, which way is better (1 up, -1 down, 0 neither)].
function rows(s, C) {
  const pct = (x) => (x == null ? "–" : `${x}%`), n = (x) => (x == null ? "–" : String(x));
  const r = [];
  if (s.money) r.push(["Money", [
    ["Spent so far this month", s.money.spent, usd, -1], ["A usual month", s.money.usual, usd, 0], ["Saved last month", s.money.savingsRate, pct, 1],
    ["You paid yourselves", s.money.kept, usd, 1], ["Merchants took", s.money.taken, usd, -1], ["HELOC owed", s.money.heloc, usd, -1]]]);
  r.push(["Navya", [["Kept", s.navya?.kept, usd, 1], ["Stores took", s.navya?.taken, usd, -1], ["GPA", s.navya?.gpa, (x) => (x == null ? "–" : x.toFixed(2)), 1],
    ["Social media a day", s.navya?.social, hm, -1], ["Volleyball calls", s.navya?.calls, pct, 1]]]);
  r.push(["Us", [["Time together this week", s.us?.together, n, 1], ["Thank-yous", s.us?.thanks, n, 1],
    ["Rituals kept", s.us ? s.us.ritualsKept : null, (x) => (x == null ? "–" : `${x} of ${s.us.ritualsTotal}`), 1]]]);
  r.push(["Health", Object.entries(s.health || {}).flatMap(([id, h]) => [[`${C.name(id)}: sleep`, h?.sleep, (x) => (x == null ? "–" : `${x}h`), 1], [`${C.name(id)}: exercise days`, h?.exercise, n, 1]])]);
  r.push(["Home", [["To-dos done this week", s.home?.done, n, 1], ["To-dos open", s.home?.open, n, -1]]]);
  return r;
}

function numbersTable(s, prev, C, prevLabel) {
  if (!s) return `<p class="sub">No numbers saved for this week. They're saved on Growing Together day from now on.</p>`;
  const pr = prev ? rows(prev, C) : null;
  return `<div class="fm-snap">${rows(s, C).map(([area, list], ai) => `<div class="fm-snaparea"><span class="fm-kicker">${area}</span>
    <table><tbody>${list.map(([label, v, f, dir], i) => {
      const pv = pr?.[ai]?.[1]?.[i]?.[1], d = v != null && pv != null ? v - pv : null;
      const cls = d == null || d === 0 || !dir ? "" : (d > 0) === (dir > 0) ? "good" : "bad";
      return `<tr><td>${esc(label)}</td><td class="n"><b>${esc(f(v))}</b></td><td class="n d ${cls}">${d == null || d === 0 ? "" : `${d > 0 ? "▲" : "▼"} ${esc(f(Math.abs(Math.round(d * 100) / 100)))}`}</td></tr>`; }).join("")}</tbody></table></div>`).join("")}
    ${prev ? `<p class="sub">Arrows compare with ${esc(prevLabel)}. Green is the good direction.</p>` : ""}</div>`;
}

// ── shared bits ──
const hasNotes = (n) => !!(n && (n.discussed || n.changes?.length || n.log?.length));
function notesHTML(n, C) {
  if (!hasNotes(n)) return `<p class="sub">No notes this week.</p>`;
  return `${n.discussed ? `<h5>What we discussed</h5><p class="talked">${esc(n.discussed)}</p>` : ""}
    ${n.changes?.length ? `<h5>What we'll change</h5><ul class="decisions">${n.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${n.log?.length ? `<h5>During the week</h5><ul class="fm-log">${n.log.map((e) => `<li class="${e.tag ? "tag-" + e.tag : ""}"><div class="meta"><span>${fmtD(e.date)} · ${esc(C.name(e.by))}</span>${e.tag ? `<span class="tg">${LOG_TAGS[e.tag]}</span>` : ""}</div><p>${esc(e.text)}</p></li>`).join("")}</ul>` : ""}`;
}
// Growing Together for the talk that fell in this week (Sunday's, or whichever day you meet).
function growingHTML(D, wk, C) {
  const R = D.rel || {}, md = D.config?.us?.meetingDay ?? 0, meet = addDays(wk, md), g = (R.growing || {})[meet] || {};
  const thanks = (R.appreciation || []).filter((a) => a.date > addDays(meet, -7) && a.date <= meet);
  const q = (R.questions || []).find((x) => x.week === meet && x.revealed);
  const kind = (p) => (p.kind === "us" ? "Date" : p.kind === "me" ? esc(C.name(p.by)) : "Family");
  if (!thanks.length && !g.plans?.length && !g.issues?.length && !q) return `<p class="sub">Nothing saved for Growing Together this week.</p>`;
  return `${thanks.length ? `<h5>Thank-yous</h5><ul class="fam-list quotes">${thanks.map((a) => `<li><span><b>${esc(C.name(a.from))} → ${esc(C.name(a.to))}:</b> ${esc(a.text)}</span></li>`).join("")}</ul>` : ""}
    ${g.plans?.length ? `<h5>Good times planned</h5><ul class="fam-list">${g.plans.map((p) => `<li><span><span class="fm-type">${kind(p)}</span>${esc(p.what)}</span><span class="sub">${esc(p.when || "")}</span></li>`).join("")}</ul>` : ""}
    ${g.issues?.length ? `<h5>What was on our minds</h5>${g.issues.map((x) => `<p class="fm-issue">“${esc(x.text)}”<span class="sub"> ${esc(C.name(x.by))}</span></p>`).join("")}` : ""}
    ${q ? `<h5>Question of the week</h5><p class="talked">${esc(q.text)}</p><div class="fm-answers">${Object.entries(q.answers || {}).map(([p, a]) => `<div><b>${esc(C.name(p))}</b><p>${esc(a.text)}</p></div>`).join("")}</div>` : ""}`;
}

// ── the view ──
export function pastView(D, C, F) {
  const reviews = (D.reviews || []).slice().sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  const mode = F.pastMode || "weeks", q = (F.pastQ || "").trim().toLowerCase();
  const months = [...new Set([...reviews.map((r) => r.weekStart.slice(0, 7)), ...(C.money?.months || []).map((m) => m.month), C.today.slice(0, 7)])].sort().reverse();
  const head = `<div class="fm-tile s4 fm-pasthead"><div class="fm-rowsplit"><h3 class="fm-name">Looking back</h3>
      <span class="fm-monthpick" role="group"><button type="button" data-act="pastmode" data-m="weeks" aria-pressed="${mode === "weeks"}">By week</button><button type="button" data-act="pastmode" data-m="months" aria-pressed="${mode === "months"}">By month</button></span></div>
    <input type="search" data-pastsearch value="${esc(F.pastQ || "")}" placeholder="Search our notes, e.g. mornings, Visa, date night"></div>`;
  if (q) return `<div class="fm-bento">${head}${searchResults(reviews, q, C)}</div>`;
  if (mode === "months") return `<div class="fm-bento">${head}${monthView(D, C, F, reviews, months)}</div>`;
  const sel = F.pastWeek && reviews.find((r) => r.weekStart === F.pastWeek);
  return `<div class="fm-bento">${head}${sel ? weekDetail(D, C, sel, reviews) : weekList(reviews, C)}</div>`;
}

function weekList(reviews, C) {
  if (!reviews.length) return `<div class="fm-tile s4"><p class="sub">Nothing to look back on yet. Each week's read, notes and numbers collect here.</p></div>`;
  const byMonth = {};
  for (const r of reviews) (byMonth[r.weekStart.slice(0, 7)] = byMonth[r.weekStart.slice(0, 7)] || []).push(r);
  return Object.entries(byMonth).map(([ym, list]) => `<div class="fm-tile s4"><span class="fm-kicker">${monthName(ym)}</span><ul class="fm-weeks">${list.map((r) => {
    const n = r.notes || {}, s = r.snapshot;
    const chips = [n.changes?.length && `${n.changes.length} decision${n.changes.length === 1 ? "" : "s"}`, n.log?.length && `${n.log.length} note${n.log.length === 1 ? "" : "s"}`,
      s?.money?.kept != null && s.money.taken && `kept $${(s.money.kept / s.money.taken).toFixed(2)} per $1`].filter(Boolean);
    return `<li><button type="button" class="fm-weekrow" data-act="pastweek" data-w="${r.weekStart}"><span class="wk">Week of ${fmtD(r.weekStart)}${r.weekStart === C.week ? " · this week" : ""}</span>
      <span class="hl">${esc(r.focus || r.headline || (n.discussed ? n.discussed.split(/(?<=\.)\s/)[0] : hasNotes(n) ? "Notes during the week" : "Numbers only"))}</span>
      <span class="chips">${chips.map((c) => `<i>${esc(c)}</i>`).join("")}</span><span class="go" aria-hidden="true">›</span></button></li>`; }).join("")}</ul></div>`).join("");
}

function weekDetail(D, C, r, reviews) {
  const older = reviews.filter((x) => x.weekStart < r.weekStart), prev = older.find((x) => x.snapshot) || null;
  const newer = reviews.filter((x) => x.weekStart > r.weekStart).at(-1), before = older[0];
  return `<div class="fm-tile s4 fm-pastweek"><div class="fm-rowsplit"><button class="fm-back" data-act="pastweek" data-w="">‹ All weeks</button>
      <span class="fm-btnrow">${before ? `<button class="fm-btn sm" data-act="pastweek" data-w="${before.weekStart}">‹ ${fmtD(before.weekStart)}</button>` : ""}${newer ? `<button class="fm-btn sm" data-act="pastweek" data-w="${newer.weekStart}">${fmtD(newer.weekStart)} ›</button>` : ""}</span></div>
    <h2 class="fm-ftitle">Week of ${fmtD(r.weekStart, { month: "long", day: "numeric", year: "numeric" })}</h2>
    ${r.headline ? `<p class="fm-headline">${esc(r.headline)}</p>` : ""}${r.focus ? `<div class="fm-focus"><span class="fm-kicker">The one focus</span><b>${esc(r.focus)}</b></div>` : ""}
    <div class="fm-pastcols"><div><span class="fm-kicker">Our notes</span>${notesHTML(r.notes, C)}</div><div><span class="fm-kicker">Growing Together</span>${growingHTML(D, r.weekStart, C)}</div></div>
    <span class="fm-kicker">The numbers that week</span>${numbersTable(r.snapshot, prev?.snapshot, C, prev ? `the week of ${fmtD(prev.weekStart)}` : "")}</div>`;
}

function monthView(D, C, F, reviews, months) {
  const ym = F.pastMonth && months.includes(F.pastMonth) ? F.pastMonth : months[0];
  const prevYm = months[months.indexOf(ym) + 1] || null;
  const wks = reviews.filter((r) => r.weekStart.startsWith(ym)).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const R = D.rel || {}, inM = (d) => d && d.startsWith(ym);
  // decisions and whether they happened: "What we'll change", with the week's notes tagged Made a change / Not yet
  const decided = wks.filter((r) => r.notes?.changes?.length).map((r) => ({ wk: r.weekStart, changes: r.notes.changes,
    made: (r.notes.log || []).filter((e) => e.tag === "progress").length, notyet: (r.notes.log || []).filter((e) => e.tag === "notyet").length }));
  // the month's cash flow from Monarch (this month so far, if it's this month)
  const flow = (m) => { const c = (D.money?.cashflow || []).find((x) => x.month === m); return c ? { ...c, rate: c.income ? Math.round((c.savings / c.income) * 1000) / 10 : null } : null; };
  const cf = flow(ym), cfPrev = prevYm ? flow(prevYm) : null, soFar = ym === C.today.slice(0, 7) ? " so far" : "";
  const lastSnap = wks.filter((r) => r.snapshot).at(-1)?.snapshot, prevSnap = reviews.filter((r) => r.weekStart.startsWith(prevYm || "x") && r.snapshot).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)).at(-1)?.snapshot;
  const together = (R.together || []).filter((t) => inM(t.date)), thanks = (R.appreciation || []).filter((a) => inM(a.date));
  const ritualWeeks = Object.entries(R.ritualLog || {}).filter(([w]) => inM(w)), ritualPct = ritualWeeks.length && (R.rituals || []).length ? Math.round((ritualWeeks.reduce((s, [, ids]) => s + ids.length, 0) / (ritualWeeks.length * R.rituals.length)) * 100) : null;
  const delta = (a, b, f, dir) => (a == null || b == null || a === b ? "" : `<span class="d ${(a > b) === (dir > 0) ? "good" : "bad"}">${a > b ? "▲" : "▼"} ${f(Math.abs(a - b))}</span>`);
  return `<div class="fm-tile s4"><div class="fm-monthpick">${months.slice(0, 12).map((m) => `<button type="button" data-act="pastmonth" data-m="${m}" aria-pressed="${m === ym}">${new Date(m + "-15T12:00:00").toLocaleDateString("en-US", { month: "short" })}${m.slice(0, 4) !== C.today.slice(0, 4) ? ` ${m.slice(2, 4)}` : ""}</button>`).join("")}</div>
      <h2 class="fm-ftitle">${monthName(ym)}</h2>
      <div class="fm-big3">
        <div class="tri"><b>${cf ? usd(cf.spending) : "–"}</b><span>spent${soFar} ${cfPrev && !soFar ? delta(cf?.spending, cfPrev.spending, usd, -1) : cfPrev ? `· ${usd(cfPrev.spending)} the month before` : ""}</span></div>
        <div class="tri"><b>${cf?.rate != null ? `${cf.rate}%` : "–"}</b><span>saved${soFar}${cf ? ` · ${usd(cf.savings)}` : ""} ${cfPrev && !soFar ? delta(cf?.rate, cfPrev.rate, (x) => `${Math.round(x * 10) / 10} pts`, 1) : ""}</span></div>
        <div class="tri"><b>${together.length}</b><span>times together · ${thanks.length} thank-yous${ritualPct != null ? ` · rituals ${ritualPct}%` : ""}</span></div></div></div>
    <div class="fm-tile s2"><h3>What we decided</h3>${decided.length ? `<ul class="fm-decided">${decided.map((d) => `<li><span class="sub">Week of ${fmtD(d.wk)}</span><ul>${d.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      <span class="sub">${d.made || d.notyet ? `During the week: ${d.made ? `<span class="good">${d.made} “made a change”</span>` : ""}${d.made && d.notyet ? " · " : ""}${d.notyet ? `<span class="warn">${d.notyet} “not yet”</span>` : ""}` : "No notes during the week on how it went."}</span></li>`).join("")}</ul>` : `<p class="sub">No decisions written down this month.</p>`}</div>
    <div class="fm-tile s2"><h3>Week by week</h3><ul class="fm-weeks">${wks.length ? wks.map((r) => `<li><button type="button" class="fm-weekrow" data-act="pastweek" data-w="${r.weekStart}" data-tomode="weeks"><span class="wk">Week of ${fmtD(r.weekStart)}</span><span class="hl">${esc(r.focus || r.headline || (r.notes?.discussed ? r.notes.discussed.split(/(?<=\.)\s/)[0] : hasNotes(r.notes) ? "Notes during the week" : "Numbers only"))}</span><span class="go" aria-hidden="true">›</span></button></li>`).join("") : `<li class="sub">No weeks saved this month.</li>`}</ul></div>
    <div class="fm-tile s4"><span class="fm-kicker">The numbers at the end of ${monthName(ym).split(" ")[0]}</span>${numbersTable(lastSnap, prevSnap, C, prevYm ? `the end of ${monthName(prevYm).split(" ")[0]}` : "")}</div>`;
}

function searchResults(reviews, q, C) {
  const hits = [];
  for (const r of reviews) {
    const n = r.notes || {}, texts = [["We discussed", n.discussed], ...(n.changes || []).map((c) => ["We decided", c]), ...(n.log || []).map((e) => [`${C.name(e.by)}, ${fmtD(e.date)}`, e.text]), ["Our read", r.headline], ["Focus", r.focus]];
    for (const [k, t] of texts) if (t && t.toLowerCase().includes(q)) hits.push({ wk: r.weekStart, k, t });
  }
  const mark = (t) => esc(t).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>");
  return `<div class="fm-tile s4"><span class="fm-kicker">${hits.length} result${hits.length === 1 ? "" : "s"}</span>${hits.length ? `<ul class="fm-hits">${hits.map((h) => `<li><button type="button" class="fm-weekrow" data-act="pastweek" data-w="${h.wk}" data-tomode="weeks" data-clear="1"><span class="wk">Week of ${fmtD(h.wk)} · ${esc(h.k)}</span><span class="hl">${mark(h.t)}</span><span class="go" aria-hidden="true">›</span></button></li>`).join("")}</ul>` : `<p class="sub">Nothing matches.</p>`}</div>`;
}

// When to (re)save this week's snapshot: on or after Growing Together day, if it hasn't been saved yet.
export function snapshotDue(D, C) {
  const md = D.config?.us?.meetingDay ?? 0, meet = addDays(C.week, md);
  if (C.today < meet) return false;
  const r = (D.reviews || []).find((x) => x.weekStart === C.week);
  return !r?.snapshot;
}
