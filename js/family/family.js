// Family tab: Lokesh and Archana's dashboard over the private Family repo. Six screens:
// HQ (the week's read, our notes, what's coming up), Money (Monarch summary), Us, Health, Kids,
// Home. Everything the two of them enter is a small read-modify-write on one JSON file, so both
// can use it at once. Numbers come from compute.js; the routine only drafts the weekly read and
// syncs the Monarch summary (see the Family repo's CLAUDE.md).
import { computeFamily, sundayOf, addDays, daysBetween } from "./compute.js";
import { FILES } from "./store.js";
import { payFirstHTML } from "../payfirst.js";
import { pastView, snapshotOf, snapshotDue } from "./history.js";
import { retireData, retireHTML, wireRetire } from "./retire.js";
import { CUISINES } from "./dishes.js";
import { SLOTS, QUICK, UNITS, allDishes, dishById, groceryList, groceryText, fmtAmount, dishText } from "./grocery.js";
import { AISLES } from "./dishes.js";
import { fireRoutine, RoutineError } from "../learning/routine.js";
import { todayISO } from "../dateutil.js";
import { flash } from "../flash.js";
import { APP_VERSION } from "../version.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtD = (iso, o = { month: "short", day: "numeric" }) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", o) : "");
const usd = (n) => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);
const monShort = (ym) => new Date(ym + "-15T12:00:00").toLocaleDateString("en-US", { month: "short" });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const TABS = [["hq", "Overview"], ["money", "Money"], ["us", "Us"], ["growth", "Growth"], ["nutrition", "Nutrition"], ["kids", "Kids"], ["home", "Home"], ["past", "Looking back"]];
const KINDS = { book: "Book", podcast: "Podcast", article: "Article", video: "Video", thought: "My own thought" };
const AREAS = { money: "Money", us: "Us", growth: "Growth", health: "Nutrition", nutrition: "Nutrition", kids: "Kids", home: "Home" };
const DIRS = { better: ["Better", "up"], worse: ["Slipping", "down"], steady: ["Steady", "flat"] };
const LOG_TAGS = { progress: "Made a change", notyet: "Not yet" };
// Character Lab's three kinds of strengths, in words a family uses.
const STRENGTHS = { Heart: ["Kindness", "Gratitude", "Honesty", "Fairness", "Respect", "Sharing"], Mind: ["Curiosity", "Listening", "Creativity", "Open-mindedness"],
  Will: ["Effort", "Self-control", "Patience", "Responsibility", "Resilience", "Confidence"] };
const GLOW = { encourage: "Glow", correct: "Grow" };

let ctx = null; // { store, S, renderApp }

export async function renderFamilyView(store, S, renderApp) {
  ctx = { store, S, renderApp };
  const F = (S.fam = S.fam || { tab: "hq", loaded: false, me: S.partner ? "archana" : "lokesh" });
  const main = $("#main");
  if (!F.loaded) {
    main.innerHTML = `<div class="fam"><p class="fm-empty">Loading the family dashboard…</p></div>`;
    try { await store.loadAll(); F.loaded = true; saveSnapshotIfDue(); }
    catch (e) {
      main.innerHTML = `<div class="fam"><div class="fm-tile"><h3>Can't open the Family repo</h3><p>${esc(e.message)}</p>
        <p class="sub">On GitHub: <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b> → open the token this device uses → <b>Edit</b> → Repository access → add <b>Family</b> (Contents: Read and write) → Save. Then try again.</p>
        <button class="fm-btn" data-act="retry">Try again</button></div></div>`;
      $("[data-act=retry]", main).onclick = () => renderFamilyView(store, S, renderApp);
      return;
    }
  }
  draw();
}

const data = () => ctx.store.data();
// On Growing Together day (or the first time the dashboard opens after it that week), freeze the
// week's numbers into review/<week>.json so they can be looked back on. Quietly; never blocks.
const reviewDefault = (wk) => ({ weekStart: wk, status: "notes" });
async function saveSnapshotIfDue() {
  try {
    const D = data(), C = computeFamily(D, todayISO());
    if (!snapshotDue(D, C)) return;
    await ctx.store.update(`review/${C.week}.json`, reviewDefault(C.week), (r) => ({ ...r, snapshot: snapshotOf(D, C) }), `family: numbers for the week of ${C.week}`);
  } catch { /* offline or read-only: try again next time */ }
}
const withSnapshot = (wk) => (r) => { const D = data(), C = computeFamily(D, todayISO()); return wk === C.week ? { ...r, snapshot: snapshotOf(D, C) } : r; };

function draw() {
  const F = ctx.S.fam;
  if (ctx.S.famShare) startShareFromLearning(ctx.S.famShare);
  const D = data(), C = computeFamily(D, todayISO());
  const past = (D, C) => pastView(D, C, F);
  if (F.tab === "health") F.tab = "nutrition"; // the old Health tab
  const body = F.kidFocus ? kidFocus : { hq, money, us, growth, nutrition, kids, home, past }[F.tab] || hq;
  const main = $("#main");
  main.innerHTML = `<div class="fam">
    <div class="fm-top"><div class="fm-hello"><p class="fm-eyebrow">${esc(C.name("lokesh"))} &amp; ${esc(C.name("archana"))} · family</p><h1>Week of ${fmtD(C.week, { month: "long", day: "numeric" })}</h1><p class="fm-sub">Signed in as ${esc(C.name(F.me))}</p></div></div>
    <div class="fm-navrow"><nav class="fm-tabs" aria-label="Family screens">${TABS.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${F.tab === k}">${l}</button>`).join("")}</nav></div>
    <div id="fambody">${body(D, C)}</div>
    <p class="fm-fresh">Money ${C.money ? `synced ${fmtD(C.money.asOf)}` : "not synced yet"} · <button class="fm-link" data-act="reload">Refresh</button> · app ${APP_VERSION}</p>
  </div>`;
  wire(main.firstElementChild, D, C);
  if (F.tab === "money") wireRetire(main);
}

/* ── shared bits ─────────────────────────────────────────── */

function cards(items) {
  return `<div class="fm-changes2">${(items || []).map((x) => {
    const nm = AREAS[x.area] || x.area || "", [ar, cls] = DIRS[x.dir] || ["", "flat"];
    return `<div class="fm-card ${cls}"><div class="top"><span class="area">${esc(nm)}</span>${ar ? `<span class="dir ${cls}">${ar}</span>` : ""}</div><b>${esc(x.title || "")}</b>${x.detail ? `<p class="det">${esc(x.detail)}</p>` : ""}</div>`;
  }).join("")}</div>`;
}
const tags = (sel) => `<span class="fm-tags">${Object.entries(LOG_TAGS).map(([k, v]) => `<button type="button" data-act="tag" data-tag="${k}" aria-pressed="${sel === k}">${v}</button>`).join("")}</span>`;
const whoSelect = (C, name = "who", sel = "both", withBoth = true) => `<select name="${name}">${[...(withBoth ? [["both", "Both"]] : []), ["lokesh", C.name("lokesh")], ["archana", C.name("archana")]].map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const empty = (t) => `<p class="sub">${t}</p>`;

/* ── HQ: the week's read + our notes + coming up ─────────── */

function latestReview(D) { return (D.reviews || []).at(-1) || null; }

function hq(D, C) {
  const rv = latestReview(D), run = ctx.S.fam.run;
  const read = !rv?.headline ? `<div class="fm-tile s4 coach"><span class="fm-kicker">This week · our read</span>
      <h2 class="fm-headline">No weekly read yet.</h2><p class="sub">Claude drafts it from all five areas; you two review it together and keep notes.</p>
      ${run ? runLine(run) : `<button class="fm-btn pri" data-act="draftread">Draft this week's read</button>`}
      ${notesBlock(rv?.weekStart === C.week ? rv : reviewDefault(C.week), D, C)}</div>`
    : `<div class="fm-tile s4 coach">
      <div class="fm-rowsplit"><span class="fm-kicker">Our read · week of ${fmtD(rv.weekStart)}</span>${rv.status === "draft" ? `<span class="fm-chip warn">draft</span>` : `<span class="fm-chip">approved ${fmtD(rv.approvedAt)}</span>`}</div>
      <h2 class="fm-headline">${esc(rv.headline)}</h2>
      ${rv.focus ? `<div class="fm-focus"><span class="fm-kicker">This week's one focus</span><b>${esc(rv.focus)}</b></div>` : ""}
      ${rv.cards?.length ? `<div class="fm-sec"><span class="fm-kicker">Across the family</span>${cards(rv.cards)}</div>` : ""}
      ${rv.talk?.length ? `<div class="fm-sec"><span class="fm-kicker">Talk about</span><div class="fm-bubbles">${rv.talk.map((t) => `<p class="fm-q">${esc(t)}</p>`).join("")}</div></div>` : ""}
      ${notesBlock(rv, D, C)}
      <div class="fm-btnrow">${rv.status === "draft" ? `<button class="fm-btn pri" data-act="approveread" data-week="${rv.weekStart}">Approve</button>` : ""}
        ${run ? "" : `<button class="fm-btn" data-act="draftread">${rv.weekStart >= C.week ? "Redraft" : "Draft this week's read"}</button>`}</div>${run ? runLine(run) : ""}</div>`;
  const up = C.comingUp;
  const m = C.money, n = C.navya;
  const rows = [
    ["money", "Money", m ? `${usd(m.spent)} spent so far${m.avg3Spending != null ? ` · usual month ${usd(m.avg3Spending)}` : ""}` : "Not synced from Monarch yet", m ? [m.savingsRate != null ? `saved ${m.savingsRate}% last month` : "", ...m.creditLines.filter((cl) => cl.now.net).map((cl) => `HELOC ${cl.now.net > 0 ? "+" : "−"}${usd(Math.abs(cl.now.net))} this month`)].filter(Boolean).join(" · ") : ""],
    ["us", "Us", C.us.daysSinceUs != null ? `time together ${C.us.daysSinceUs === 0 ? "today" : `${C.us.daysSinceUs} days ago`}` : "No time together logged yet", `${C.us.family30} family times in 30 days`],
    ["nutrition", "Nutrition", `${C.nutrition.plan.planned} of 7 dinners planned from ${fmtD(C.nutrition.plan.start)}`, C.nutrition.review.planned || C.nutrition.review.cooked ? `last 7 days: ${C.nutrition.review.cooked} cooked · ${C.nutrition.review.out} out` : ""],
    ["kids", "Kids", C.kids.map((k) => `${k.name}: ${k.appointments.length} coming up`).join(" · ") || "Add the kids", n?.focus ? `Navya's focus: ${n.focus.split(".")[0]}` : ""],
    ["growth", "Growth", (() => { const open = (D.growth?.items || []).filter((g) => g.status === "open"), mine = open.filter((g) => !(g.reflections || []).some((r) => r.by === ctx.S.fam.me)); return open.length ? `${open.length} to talk about${mine.length ? ` · ${mine.length} waiting for your thoughts` : ""}` : "Nothing waiting to talk about"; })(), `${(D.growth?.items || []).filter((g) => g.status === "discussed").length} talked about so far`],
    ["home", "Home", `${C.home.todos.length} to-dos open · ${C.home.chores.filter((c) => c.due).length} chores due`, `${C.home.done7} done this week`],
  ];
  return `<div class="fm-bento">${turnNudge(D, C)}${kidsNudge(D, C)}${read}
    <div class="fm-tile s2"><h3>Coming up · next 2 weeks</h3>${up.length ? `<ul class="fam-list">${up.map((u) => `<li class="${u.overdue ? "late" : ""}"><span class="d">${fmtD(u.date)}</span><span><span class="fm-type">${u.icon}</span>${esc(u.text)}</span></li>`).join("")}</ul>` : empty("Nothing in the next two weeks.")}</div>
    <div class="fm-tile s2"><h3>How each area is going</h3><div class="fm-rows">${rows.map(([t, title, big, sub]) => `<button class="fm-row fam-row" data-tab="${t}"><span class="nm">${title}</span><b>${esc(big)}</b><span class="sub">${esc(sub)}</span><span class="go">→</span></button>`).join("")}</div></div>
  </div>`;
}

function runLine(run) {
  return `<p class="sub fam-run">${run.kind === "finance" ? "Syncing from Monarch" : "Drafting this week's read"}… usually 2–4 minutes. ${run.url ? `<a href="${esc(run.url)}" target="_blank" rel="noopener">View run</a> · ` : ""}<button class="fm-link" data-act="reload">Check now</button></p>`;
}

// Notes on the week's read: a review written together (either can edit), notes during the week
// (each edits their own), and last week's notes below — the same shape as Navya's.
const hasNotes = (n) => !!(n && (n.discussed || n.changes?.length || n.log?.length));
function notesView(n, C) {
  return `${n.discussed ? `<h5>What we discussed</h5><p class="talked">${esc(n.discussed)}</p>` : ""}
    ${n.changes?.length ? `<h5>What we'll change</h5><ul class="decisions">${n.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${n.log?.length ? `<h5>During the week</h5><ul class="fm-log">${n.log.map((e) => logLine(e, false, C)).join("")}</ul>` : ""}`;
}
const logLine = (e, editable, C) => `<li class="${e.tag ? "tag-" + e.tag : ""}"><div class="meta"><span>${fmtD(e.date)} · ${esc(C.name(e.by))}</span>${e.tag ? `<span class="tg">${LOG_TAGS[e.tag]}</span>` : ""}${editable ? `<button class="fm-link" data-act="editlog" data-id="${esc(e.id)}">Edit</button>` : ""}</div><p>${esc(e.text)}</p></li>`;
function notesBlock(rv, D, C) {
  const F = ctx.S.fam, n = rv.notes || {}, wk = rv.weekStart, editing = F.notesEdit === wk;
  const prev = (D.reviews || []).filter((r) => r.weekStart < wk && hasNotes(r.notes)).reverse();
  const review = editing
    ? `<label class="fm-fld"><span>What we discussed · what's on each of your minds</span><textarea data-notes="discussed" rows="4">${esc(n.discussed || "")}</textarea></label>
      <label class="fm-fld"><span>What we'll change · one per line</span><textarea data-notes="changes" rows="3">${esc((n.changes || []).join("\n"))}</textarea></label>
      <div class="fm-btnrow"><button class="fm-btn pri" data-act="savereview" data-week="${wk}">Save</button><button class="fm-btn" data-act="cancel">Cancel</button></div>`
    : n.discussed || n.changes?.length ? notesView({ discussed: n.discussed, changes: n.changes }, C)
    : empty("When you go through this together: what's on each of your minds, and what you'll change this week.");
  const log = (n.log || []).map((e) => F.logEdit === e.id
    ? `<li class="editing"><textarea data-logedit="text" rows="2">${esc(e.text)}</textarea><div class="fm-rowsplit">${tags(e.tag)}<span class="fm-btnrow"><button class="fm-btn sm pri" data-act="savelog" data-week="${wk}" data-id="${esc(e.id)}">Save</button><button class="fm-btn sm" data-act="dellog" data-week="${wk}" data-id="${esc(e.id)}">Delete</button><button class="fm-btn sm" data-act="cancel">Cancel</button></span></div></li>`
    : logLine(e, e.by === F.me, C)).join("");
  return `<div class="fm-sec fm-notes"><span class="fm-kicker">Our notes · week of ${fmtD(wk)}</span>
    <div class="fm-note review"><div class="fm-rowsplit"><b>Our review</b>${editing ? "" : `<button class="fm-btn sm" data-act="editreview" data-week="${wk}">${n.discussed || n.changes?.length ? "Edit" : "Add review notes"}</button>`}</div>${review}</div>
    <div class="fm-note log"><b>During the week</b>${log ? `<ul class="fm-log">${log}</ul>` : empty("Jot down what you notice as the week goes: a change made, or one that hasn't happened yet.")}
      <div class="fm-logadd"><textarea data-log="text" rows="2" placeholder="Add a note"></textarea><div class="fm-rowsplit">${tags(null)}<button class="fm-btn sm pri" data-act="addlog" data-week="${wk}">Add note</button></div></div></div>
    ${prev[0] ? `<details class="fm-more" open><summary>Last week's notes · week of ${fmtD(prev[0].weekStart)}</summary><div class="fm-note past">${notesView(prev[0].notes, C)}</div></details>` : ""}
    ${prev.length > 1 ? `<details class="fm-more"><summary>Older notes (${prev.length - 1})</summary>${prev.slice(1).map((r) => `<div class="fm-note past"><b>Week of ${fmtD(r.weekStart)}</b>${notesView(r.notes, C)}</div>`).join("")}</details>` : ""}
  </div>`;
}

/* ── Money ───────────────────────────────────────────────── */

function bar(value, max, cls = "") {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `<span class="fam-bar ${cls}"><i style="width:${pct}%"></i></span>`;
}

function money(D, C) {
  const m = C.money, run = ctx.S.fam.run;
  const sync = run?.kind === "finance" ? runLine(run) : `<button class="fm-btn sm${!m || m.stale ? " pri" : ""}" data-act="syncmoney">Refresh from Monarch</button>`;
  const watchEdit = `<details class="fm-more"><summary>Categories you watch</summary><div class="fam-form"><input name="watch" value="${esc((D.config?.finance?.watch || []).join(", "))}" placeholder="Clothing, Shopping, Restaurants & Bars"><button class="fm-btn sm" data-act="savewatch">Save</button></div><p class="sub">Use Monarch's category names, separated by commas. The next sync picks them up.</p></details>`;
  if (!m) return `<div class="fm-bento"><div class="fm-tile s4"><h3>Money</h3>${empty("Nothing from Monarch yet. Refresh pulls this month's spending, budgets, bills, debts and goals into the dashboard (totals only, never individual transactions).")}${sync}${watchEdit}</div></div>`;
  const vsUsual = m.avg3Spending != null && m.spent != null ? m.spent - m.avg3Spending : null;
  const watch = m.watch.map((w) => {
    const base = w.budget ? w.budget : w.avg3;
    return `<li><div class="fam-li-top"><b>${esc(w.category)}</b><span>${usd(w.spent)} so far · on pace for ${usd(w.projected)}</span></div>${bar(w.projected || 0, Math.max(base || 0, w.projected || 0), w.over ? "over" : "")}
      <span class="sub">${w.budget ? `budget ${usd(w.budget)}` : "no budget"}${w.avg3 != null ? ` · usual ${usd(w.avg3)}/month` : ""}${w.over ? ` · <b class="bad">${usd(w.over)} ${w.budget ? "over budget" : "above usual"}</b>` : ""}</span></li>`;
  }).join("");
  const goals = m.goals.map((g) => g.kind === "debt" ? `<li><div class="fam-li-top"><b>${esc(g.name)}</b><span>${usd(g.left)} to pay off</span></div>
    <span class="sub">${g.monthly ? `${usd(g.monthly)}/month planned` : "no monthly payment set"}${g.months ? ` · about ${g.months} months at that pace` : ""}</span></li>`
    : `<li><div class="fam-li-top"><b>${esc(g.name)}</b><span>${usd(g.current)}${g.target ? ` of ${usd(g.target)}` : ""}</span></div>${g.target ? bar(g.current, g.target, "goal") : ""}
    <span class="sub">${g.monthly ? `${usd(g.monthly)}/month` : ""}${g.months ? ` · about ${g.months} months to go` : ""}${g.monthsFaster ? ` · <b class="good">${g.monthsFaster} months sooner</b> if the watched overspend went here` : ""}</span></li>`).join("");
  return `<div class="fm-bento">
    <div class="fm-tile s4 glow"><div class="fm-rowsplit"><h3>${fmtD(m.month + "-01", { month: "long" })} so far</h3><span class="sub">from Monarch ${fmtD(m.asOf)}</span></div>
      <div class="fm-big3"><div class="tri"><b class="${vsUsual > 0 ? "bad" : ""}">${usd(m.spent)}</b><span>spent so far${m.daysElapsed ? ` · day ${m.daysElapsed} of ${m.daysInMonth}` : ""}</span></div><div class="tri"><b>${usd(m.avg3Spending)}</b><span>a usual month · average${m.last3?.length ? ` of the last ${m.last3.length}` : ""}</span>${m.last3?.length ? `<small class="fm-last3">${m.last3.map((c) => `${monShort(c.month)} ${usd(c.spending)}`).join(" · ")}</small>` : ""}</div>
      <div class="tri"><b>${m.savingsRate ?? "–"}%</b><span>saved last month · ${m.savingsRate3 ?? "–"}% over 3</span></div></div>
      ${vsUsual != null ? `<p class="sub">So far <b class="${vsUsual > 0 ? "bad" : "good"}">${usd(Math.abs(vsUsual))} ${vsUsual > 0 ? "more" : "less"}</b> than a usual month in total.</p>` : ""}
      ${m.budgetTotal ? `<p class="sub">Budgeted categories: <b class="${m.budgetSpent > m.budgetTotal ? "bad" : "good"}">${usd(m.budgetSpent)}</b> spent of ${usd(m.budgetTotal)} budgeted.</p>` : ""}
      ${m.lastMonth ? `<p class="sub">Last month: spent ${usd(m.lastMonth.spending)} of ${usd(m.lastMonth.income)} income.</p>` : ""}
      <div class="fm-btnrow">${sync}</div>${m.flags.length ? `<ul class="fm-check">${m.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}</div>
    ${m.payYourself ? `<div class="fm-tile s4">${payFirstHTML(m.payYourself, ctx.S.fam.pyfRange, { title: "Pay yourselves first", you: "You", kept: "You paid yourselves", taken: "Merchants took", keptHead: "What you paid yourselves", takenHead: "Who took your money", payday: "Pay yourselves first: on payday, move that to the ESPP or cash savings before they get it.", into: "your 401(k)s and savings" })}</div>` : ""}
    ${m.navyaMoney ? `<div class="fm-tile s4">${payFirstHTML(m.navyaMoney, ctx.S.fam.nvRange, { scope: "navya", title: "Navya · pay yourself first", you: "You", kept: "You kept", taken: "Stores took", takers: "stores", earnedLabel: "Money in", keptHead: "What you kept", takenHead: "Who took your money", payday: "Pay yourself first: the day money comes in, move your share to savings before a store gets it.", into: "your savings and investing" })}<p class="sub fm-pyfnote">Written to Navya, for her weekly family meeting. Only here for now; her own dashboard doesn't show it.</p></div>` : ""}
    ${retireHTML(retireData(D, C.today))}
    <div class="fm-tile s2"><h3>Categories you watch</h3>${watch ? `<ul class="fam-list bars">${watch}</ul>` : empty("Add categories below.")}
      ${m.overWatch ? `<p class="fam-impact">On pace to spend <b>${usd(m.overWatch)}</b> more than ${m.watch.some((w) => w.over && w.budget) ? "planned" : "usual"} in these this month. Put toward your goals instead, that's ${usd(m.overWatch * 12)} a year.</p>` : ""}${watchEdit}</div>
    <div class="fm-tile s2"><h3>Savings, retirement &amp; payoff</h3>${goals ? `<ul class="fam-list bars">${goals}</ul>` : empty("No goals in Monarch yet.")}
      ${m.shortTermTotal ? `<h4>Short-term debt · ${usd(m.shortTermTotal)}</h4><ul class="fam-list">${m.creditLines.map((cl) => `<li><span>${esc(cl.name)}</span><span>${usd(cl.balance)}</span></li>`).join("")}${m.debts.filter((d) => !d.longTerm).map((d) => `<li><span>${esc(d.name)}</span><span>${usd(d.balance)}${d.apr ? ` · ${d.apr}% APR` : ""}${d.months ? ` · paid off in ~${d.months} months` : ""}</span></li>`).join("")}</ul>` : ""}
      ${m.debts.some((d) => d.longTerm) ? `<h4>Long-term</h4><ul class="fam-list">${m.debts.filter((d) => d.longTerm).map((d) => `<li><span>${esc(d.name)}</span><span>${usd(d.balance)}${d.monthlyPayment ? ` · ${usd(d.monthlyPayment)}/month` : ""}${d.months ? ` · ~${d.months} months left` : ""}</span></li>`).join("")}</ul>` : ""}</div>
    ${m.creditLines.map((cl) => { const n = cl.now; return `<div class="fm-tile s4 fam-heloc"><div class="fm-rowsplit"><h3>${esc(cl.name)} · short-term debt</h3><span class="sub">drawn adds to it, paid takes it down; never counted as spending</span></div>
      <div class="fm-big3"><div class="tri"><b>${usd(cl.balance)}</b><span>owed now</span></div>
        <div class="tri"><b class="${n.net > 0 ? "bad" : n.net < 0 ? "good" : ""}">${n.net > 0 ? "+" : n.net < 0 ? "−" : ""}${usd(Math.abs(n.net))}</b><span>${n.net > 0 ? "added this month" : n.net < 0 ? "paid down this month" : "no change this month"}</span></div>
        <div class="tri"><b>${usd(n.drawn)} / ${usd(n.paid)}</b><span>drawn / paid this month${n.interest ? ` · ${usd(n.interest)} interest` : ""}${cl.minimum ? ` · <span class="${cl.belowMin ? "bad" : ""}">minimum ${usd(cl.minimum)}${cl.belowMin ? `, ${usd(cl.minimum - n.paid)} to go` : ""}</span>` : ""}</span></div></div>
      ${cl.months.length > 1 ? `<div class="fam-scroll"><table><thead><tr><th>Month</th><th>Drawn</th><th>Paid</th><th>Net</th><th>Interest</th></tr></thead><tbody>${cl.months.map((x) => `<tr><td>${fmtD(x.month + "-01", { month: "short", year: "numeric" })}</td><td>${usd(x.drawn)}</td><td>${usd(x.paid)}</td><td class="${x.net > 0 ? "bad" : x.net < 0 ? "good" : ""}">${x.net > 0 ? "+" : x.net < 0 ? "−" : ""}${usd(Math.abs(x.net))}</td><td>${usd(x.interest)}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`; }).join("")}
    <div class="fm-tile s2"><h3>Bills · next 30 days</h3>${m.bills.length ? `<ul class="fam-list">${m.bills.map((b) => `<li><span class="d">${fmtD(b.due)}</span><span>${esc(b.name)}</span><b>${usd(b.amount)}</b></li>`).join("")}</ul><p class="sub">${usd(m.bills14)} due in the next 2 weeks.</p>` : empty("No bills due in the next 30 days.")}</div>
    <div class="fm-tile s2"><h3>Over budget this month</h3>${m.overBudget.length ? `<ul class="fam-list">${m.overBudget.slice(0, 6).map((b) => `<li><span>${esc(b.category)}</span><span>${usd(b.spent)} spent of ${usd(b.budget)}</span></li>`).join("")}</ul>` : empty("No budgeted category is over yet.")}</div>
    ${m.months.length ? `<div class="fm-tile s4"><h3>Cash flow by month</h3><div class="fam-scroll"><table><thead><tr><th>Month</th><th>Income</th><th>Spending</th><th>Saved</th><th>Rate</th></tr></thead><tbody>${m.months.map((c) => `<tr><td>${fmtD(c.month + "-01", { month: "short", year: "numeric" })}</td><td>${usd(c.income)}</td><td>${usd(c.spending)}</td><td>${usd(c.savings)}</td><td>${c.rate ?? "–"}%</td></tr>`).join("")}</tbody></table></div></div>` : ""}
  </div>`;
}

/* ── Us ──────────────────────────────────────────────────── */

// ── Us: our compass, Growing Together (the weekly talk), a question of the week, rituals ──
const VALUE_LIST = ["Honesty", "Kindness", "Faith", "Family first", "Adventure", "Learning", "Health", "Generosity", "Gratitude", "Hard work",
  "Excellence", "Fun", "Respect", "Loyalty", "Courage", "Humility", "Service", "Curiosity", "Discipline", "Patience", "Independence",
  "Tradition", "Creativity", "Simplicity", "Financial freedom", "Compassion", "Responsibility", "Growth", "Joy", "Integrity"];
// Love-map questions (after the Gottmans): one a week, in order, then round again.
const QUESTIONS = ["What's one worry you haven't said out loud yet?", "What would a perfect Saturday look like for you this year?",
  "Which friend do you feel closest to right now, and why?", "What's something you're proud of this month that I might have missed?",
  "What do you want our kids to remember about their childhood?", "When do you feel most loved by me?",
  "What's a dream you've put on hold?", "What's weighing on you most at work right now?", "What's one thing you'd like us to do more of together?",
  "What did your family do well growing up that you'd like us to keep?", "Where would you go if we had a free week and no budget?",
  "What's something small I do that makes your day better?", "What's one thing you'd like to learn in the next year?",
  "When did you last feel really proud of our family?", "What's a habit of mine you'd like me to keep?", "What does a good evening at home look like to you?",
  "Who do you want to be in five years?", "What's one way I could support you better this month?", "What's a memory of us you go back to?",
  "What are you looking forward to most this season?", "What's something you need more of right now: rest, fun, help or space?",
  "What value do you most want Navya to carry with her?", "What's one money worry or hope you'd like us to talk about?",
  "If we wrote this year's story, what would the title be?", "What made you laugh this week?", "What's a tradition you'd like us to start?"];
const RIT_EVERY = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TALK = "Growing Together";
const weekNo = (iso) => Math.floor((new Date(iso + "T12:00:00") - new Date("2026-01-04T12:00:00")) / (7 * 86400000));
const qFor = (iso) => QUESTIONS[((weekNo(iso) % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
// The next Growing Together (today if it's the day) and the one before: what's added in between is for the next one.
function meetDates(D, today) {
  const md = D.config?.us?.meetingDay ?? 0, next = addDays(today, (md - new Date(today + "T12:00:00").getDay() + 7) % 7);
  return { md, next, last: addDays(next, -7), day: DAYS[md], isToday: next === today, isTomorrow: daysBetween(today, next) === 1 };
}
const curQuestion = (R, M) => (R.questions || []).find((q) => q.week === M.next) || { week: M.next, text: qFor(M.next), answers: {} };

// What's waiting for whoever holds this phone.
function turnItems(D, C, R, me, other) {
  const M = meetDates(D, C.today), mine = (R.valuePicks || {})[me] || [], q = curQuestion(R, M), wk = C.week;
  const thanked = (R.appreciation || []).some((a) => a.from === me && a.date > M.last), rs = R.rituals || [], kept = (R.ritualLog || {})[wk] || [];
  const g = (R.growing || {})[M.next] || {}, added = [...(g.plans || []), ...(g.issues || [])].some((x) => x.by === me);
  return [
    !R.compass?.values?.length && { f: "values", t: "Pick your values", sub: mine.length ? `${mine.length} picked · tap to change` : "About 2 minutes", done: mine.length > 0 },
    { f: "question", t: "Answer this week's question", sub: q.answers?.[me] ? "Done · unlocks when you've both answered" : q.text, done: !!q.answers?.[me] },
    { f: "thanks", t: "Say thank you", sub: thanked ? "Done this week · add another" : `Something ${C.name(other)} or the kids did this week`, done: thanked },
    C.kids.some((k) => !k.unnamed) && (() => { const ks = C.kids.filter((k) => !k.unnamed), mine = ks.filter((k) => kidWeek(D, C, k).glows.some((o) => o.by === me));
      return { f: "notice", kid: true, t: "Notice the kids", sub: mine.length === ks.length ? "A glow for each · add more" : `A glow for ${ks.filter((k) => !mine.includes(k)).map((k) => k.name).join(" and ")}: something they did well`, done: mine.length === ks.length }; })(),
    { f: "meeting", t: `Add to ${TALK}`, sub: added ? "Done · add more" : "A plan for good times, or something on your mind", done: added },
    rs.length && { f: "rituals", t: "Tick off a ritual", sub: `${kept.length} of ${rs.length} this week`, done: false },
  ].filter(Boolean);
}

function turnNudge(D, C) {
  const F = ctx.S.fam, R = D.rel || {}, other = F.me === "lokesh" ? "archana" : "lokesh", M = meetDates(D, C.today);
  if (!M.isToday && !M.isTomorrow) return "";
  const left = turnItems(D, C, R, F.me, other).filter((x) => !x.done && x.f !== "rituals").length;
  return left ? `<button class="fm-nudge" data-tab="us"><b>${TALK} is ${M.isToday ? "today" : "tomorrow"}.</b> ${left} thing${left === 1 ? "" : "s"} left for you <span aria-hidden="true">›</span></button>` : "";
}

function yourTurnTile(D, C, R, me, other) {
  const M = meetDates(D, C.today), items = turnItems(D, C, R, me, other), left = items.filter((x) => !x.done).length;
  return `<div class="fm-tile s4 fm-turn"><div class="fm-rowsplit"><h3 class="fm-name">Your turn, ${esc(C.name(me))}</h3><span class="sub">${left ? `Before ${TALK}, ${M.isToday ? "today" : M.day}` : "All done for this week"}</span></div>
    <ul>${items.map((x) => `<li><button type="button" class="fm-turnrow${x.done ? " done" : ""}" data-act="${x.kid ? "kidfocus" : "usfocus"}" data-f="${x.f}"${x.kid ? ' data-type="encourage"' : ""}><span class="ck" aria-hidden="true"></span><span class="tx"><b>${esc(x.t)}</b><span>${esc(x.sub)}</span></span><span class="go" aria-hidden="true">›</span></button></li>`).join("")}</ul></div>`;
}

function compassTile(R, C, me, other) {
  const cp = R.compass;
  if (cp?.values?.length) return `<div class="fm-tile s4 fm-compass"><div class="fm-rowsplit"><span class="fm-kicker">Our family compass</span><button class="fm-link" data-act="usfocus" data-f="compass">Edit</button></div>
    ${cp.mission ? `<p class="fm-mission">${esc(cp.mission)}</p>` : ""}
    <ul class="fm-values">${cp.values.map((v) => `<li><b>${esc(v.name)}</b>${v.looksLike ? `<span>${esc(v.looksLike)}</span>` : ""}</li>`).join("")}</ul>
    <p class="sub">${cp.setAt ? `Written together, ${fmtD(cp.setAt, { month: "long", year: "numeric" })}. ` : ""}Look at it again at your year-end retreat.</p></div>`;
  const picks = R.valuePicks || {}, mine = picks[me] || [], theirs = picks[other] || [], done = mine.length > 0 && theirs.length > 0;
  const both = done ? mine.filter((v) => theirs.includes(v)) : [];
  return `<div class="fm-tile s4 fm-compass"><span class="fm-kicker">Our family compass</span>
    <p class="fm-mission">Start with what matters to you.</p>
    <ol class="fm-steps"><li class="${done ? "done" : ""}"><b>Each of you picks up to 10 values</b>, on your own phone. You won't see each other's picks until you've both chosen.</li>
      <li class="${done ? "now" : ""}"><b>Look at where you overlap.</b> Choose 3–5 together and say what each looks like in your house.</li>
      <li><b>One sentence</b> that sums up the family you're building.</li></ol>
    <div class="fm-rowsplit"><span class="sub">You: <b>${mine.length ? `${mine.length} picked` : "not yet"}</b> · ${esc(C.name(other))}: <b>${theirs.length ? "done" : "not yet"}</b></span>
      <button class="fm-btn sm${mine.length ? "" : " pri"}" data-act="usfocus" data-f="values">${mine.length ? "Change my picks" : "Pick my values"}</button></div>
    ${done ? `<div class="fm-overlap"><b>You both picked</b><span>${both.map((v) => `<i>${esc(v)}</i>`).join("") || `<em class="sub">Nothing in common yet. That's a good conversation.</em>`}</span>
      <p class="sub">Only you: ${esc(mine.filter((v) => !both.includes(v)).join(", ") || "none")} · Only ${esc(C.name(other))}: ${esc(theirs.filter((v) => !both.includes(v)).join(", ") || "none")}. Worth asking each other why.</p>
      <button class="fm-btn sm pri" data-act="usfocus" data-f="compass">Write our compass together</button></div>` : ""}</div>`;
}

function growingTile(D, C, R) {
  const M = meetDates(D, C.today), g = (R.growing || {})[M.next] || {};
  const appr = (R.appreciation || []).filter((a) => a.date > M.last).sort((a, b) => (a.date < b.date ? -1 : 1));
  const todos = (D.home?.todos || []).filter((t) => !t.done), plans = g.plans || [], issues = g.issues || [];
  const step = (n, title, hint, body) => `<li><span class="n">${n}</span><div><b>${title}</b>${hint ? `<span class="sub"> · ${hint}</span>` : ""}${body}</div></li>`;
  const who = (p) => (p.kind === "us" ? "Date" : p.kind === "me" ? esc(C.name(p.by)) : "Family");
  return `<div class="fm-tile s4 fm-sou"><div class="fm-rowsplit"><h3 class="fm-name">${TALK}</h3><span class="sub">${M.isToday ? "Today" : `${M.day}, ${fmtD(M.next)}`} · about 30 minutes, in this order</span></div>
    <ol class="fm-agenda">
      ${step(1, "Appreciation", "say them out loud", appr.length ? `<ul class="fam-list quotes">${appr.map((a) => `<li><span><b>${esc(C.name(a.from))} → ${esc(C.name(a.to))}:</b> ${esc(a.text)}</span></li>`).join("")}</ul>` : `<p class="sub">None written since last time. Bring one each.</p>`)}
      ${step(2, "Home", `${todos.length} open`, todos.length ? `<ul class="fam-list">${todos.slice(0, 4).map((t) => `<li><span>${esc(t.text)}</span><span class="sub">${esc(C.name(t.who))}${t.due ? ` · ${fmtD(t.due)}` : ""}</span></li>`).join("")}</ul><p class="sub">Who owns what this week?</p>` : `<p class="sub">Nothing open on the Home tab.</p>`)}
      ${C.kids.some((k) => !k.unnamed) ? step(3, "Kids", "wins first, then one thing each", `<ul class="fam-list">${C.kids.filter((k) => !k.unnamed).map((k) => { const w = kidWeek(D, C, k), pl = planOf(D, k.id, M.next, true);
        return `<li><span><b>${esc(k.name)}</b> · ${w.glows.length} glow${w.glows.length === 1 ? "" : "s"}, ${w.grows.length} grow${w.grows.length === 1 ? "" : "s"}</span><span class="sub">${pl ? `working on ${esc(pl.workOn.trait || "a plan")}` : ""}</span></li>`; }).join("")}</ul>
        <div class="btnrow"><button class="fm-btn sm pri" data-act="kidfocus" data-f="talk">Talk about the kids</button></div>`) : ""}
      ${step(C.kids.some((k) => !k.unnamed) ? 4 : 3, "Good times", "plan them before the week fills up", `${plans.length ? `<ul class="fam-list">${plans.map((p) => `<li><span><span class="fm-type">${who(p)}</span>${esc(p.what)}</span><span class="sub">${esc(p.when || "")}</span><button class="fm-link" data-act="delgrowing" data-list="plans" data-id="${p.id}">Remove</button></li>`).join("")}</ul>` : ""}
        <div class="fam-form"><select name="kind"><option value="us">Date</option><option value="family">Family</option><option value="me">Time for me</option></select><input name="what" placeholder="What? e.g. Thai Ginger"><input name="when" placeholder="When?" class="short"><button class="fm-btn sm" data-act="addplan">Add</button></div>`)}
      ${step(C.kids.some((k) => !k.unnamed) ? 5 : 4, "One thing", "last, on purpose", `${issues.length ? issues.map((x) => `<p class="fm-issue">“${esc(x.text)}”<span class="sub"> ${esc(C.name(x.by))}, ${fmtD(x.date)}</span> <button class="fm-link" data-act="delgrowing" data-list="issues" data-id="${x.id}">Remove</button></p>`).join("") + (issues.length > 1 ? `<p class="sub">Pick one for today; the other can wait a week.</p>` : "") : ""}
        <div class="fam-form"><input name="issue" placeholder="Something on your mind? It waits here for ${TALK}."><button class="fm-btn sm" data-act="raiseissue">Add</button></div>
        <p class="fm-hint">One topic. One of you talks while the other listens and says back what they heard, then swap. Understand each other first; solve second.</p>`)}
    </ol>
    <div class="btnrow"><button class="fm-btn sm" data-act="talknotes">Notes from today</button><span class="sub">Kept with this week's read on Overview.</span></div></div>`;
}

function questionTile(D, C, R, me, other) {
  const M = meetDates(D, C.today), qs = R.questions || [], cur = curQuestion(R, M);
  const a = cur.answers || {}, mineA = a[me], theirA = a[other];
  const body = cur.revealed && mineA && theirA ? `<div class="fm-answers"><div><b>${esc(C.name(me))}</b><p>${esc(mineA.text)}</p></div><div><b>${esc(C.name(other))}</b><p>${esc(theirA.text)}</p></div></div>`
    : !mineA ? `<div class="btnrow"><button class="fm-btn sm pri" data-act="usfocus" data-f="question">Answer</button><span class="sub">Only you see it until you've both answered.</span></div>`
    : !theirA ? `<p class="fm-locked">Your answer is in. It unlocks when ${esc(C.name(other))} answers.</p>`
    : `<p class="fm-locked">You've both answered.</p><div class="btnrow"><button class="fm-btn sm pri" data-act="revealq">Read them together</button></div>`;
  const past = qs.filter((q) => q.week < M.next && q.revealed).sort((x, y) => (x.week < y.week ? 1 : -1))[0];
  return `<div class="fm-tile s2 fm-qw"><span class="fm-kicker">Question of the week</span><p class="fm-qtext">${esc(cur.text)}</p>${body}
    ${past ? `<details class="fm-more"><summary>Last time: ${esc(past.text)}</summary><div class="fm-answers">${[me, other].map((p) => `<div><b>${esc(C.name(p))}</b><p>${esc(past.answers?.[p]?.text || "")}</p></div>`).join("")}</div></details>` : ""}</div>`;
}

function ritualsTile(R, C) {
  const wk = C.week, rs = R.rituals || [], log = R.ritualLog || {}, kept = log[wk] || [];
  const weeksSince = (id) => { const ws = Object.keys(log).filter((w) => w < wk && log[w].includes(id)).sort(); return ws.length ? Math.round(daysBetween(ws.at(-1), wk) / 7) : null; };
  return `<div class="fm-tile s2 fm-rituals"><div class="fm-rowsplit"><span class="fm-kicker">Our rituals</span><span class="sub">This week</span></div>
    ${rs.length ? `<ul class="fm-ritlist">${rs.map((r) => { const ws = r.every === "weekly" && !kept.includes(r.id) ? weeksSince(r.id) : null;
      return `<li><button type="button" class="fm-tick" data-act="keptritual" data-id="${r.id}" aria-pressed="${kept.includes(r.id)}" aria-label="Kept this week"></button><span><b>${esc(r.text)}</b><span class="sub"> · ${RIT_EVERY[r.every] || ""}</span>${ws >= 2 ? `<span class="fm-slip">${ws} weeks since the last one</span>` : ""}</span><button class="fm-link" data-act="del" data-file="rel" data-list="rituals" data-id="${r.id}">Remove</button></li>`; }).join("")}</ul>` : empty("The small things you do on purpose: a daily check-in, a weekly date, a monthly adventure.")}
    <div class="fam-form"><input name="ritual" placeholder="e.g. Sunday walk, just us"><select name="every">${Object.entries(RIT_EVERY).map(([k, v]) => `<option value="${k}"${k === "weekly" ? " selected" : ""}>${v}</option>`).join("")}</select><button class="fm-btn sm" data-act="addritual">Add</button></div>
    <p class="sub">No score. Just a nudge when one slips.</p></div>`;
}

// One job, big and plain, for the phone.
function usFocus(D, C, R, me, other) {
  const F = ctx.S.fam, f = F.usFocus, M = meetDates(D, C.today);
  const head = (t, sub) => `<button class="fm-back" data-act="usback">‹ Back</button><h2 class="fm-ftitle">${t}</h2>${sub ? `<p class="fm-fsub">${sub}</p>` : ""}`;
  const bar = (left, btn) => `<div class="fm-fbar"><span>${left}</span>${btn}</div>`;
  let body = "";
  if (f === "values") {
    const draft = (F.valDraft = F.valDraft || ((R.valuePicks || {})[me] || []).slice());
    body = head("Pick your values", `Tap up to 10 that matter most to you. ${esc(C.name(other))} won't see your picks until you've both chosen.`)
      + `<div class="fm-vchips big">${VALUE_LIST.map((v) => `<button type="button" class="fm-vchip" data-act="pickvalue" data-v="${esc(v)}" aria-pressed="${draft.includes(v)}">${esc(v)}</button>`).join("")}</div>`
      + bar(`<b>${draft.length}</b> of 10 picked`, `<button class="fm-btn pri" data-act="savevalues"${draft.length ? "" : " disabled"}>Done</button>`);
  } else if (f === "compass") {
    const picks = R.valuePicks || {}, both = (picks[me] || []).filter((v) => (picks[other] || []).includes(v));
    const d = (F.compDraft = F.compDraft || { values: (R.compass?.values || both.slice(0, 5).map((name) => ({ name, looksLike: "" }))).map((v) => ({ ...v })), mission: R.compass?.mission || "" });
    const names = d.values.map((v) => v.name), offer = [...new Set([...both, ...(picks[me] || []), ...(picks[other] || []), ...names])];
    body = head("Our family compass", "Do this one together. Choose 3–5 values, say what each looks like in your house, then one sentence for the family you're building.")
      + `<div class="fm-vchips big">${offer.map((v) => `<button type="button" class="fm-vchip${both.includes(v) ? " both" : ""}" data-act="compvalue" data-v="${esc(v)}" aria-pressed="${names.includes(v)}">${esc(v)}</button>`).join("")}</div>
      ${d.values.map((v, i) => `<label class="fm-fld"><b>${esc(v.name)}</b><input data-look="${i}" value="${esc(v.looksLike || "")}" placeholder="In our house this looks like…"></label>`).join("")}
      <label class="fm-fld"><b>Our sentence</b><textarea data-mission rows="3" placeholder="e.g. We grow together, tell the truth with kindness, and make room for adventure.">${esc(d.mission)}</textarea></label>`
      + bar(`${d.values.length} value${d.values.length === 1 ? "" : "s"}${d.values.length > 5 ? " · 3–5 works best" : ""}`, `<button class="fm-btn pri" data-act="savecompass"${d.values.length ? "" : " disabled"}>Save our compass</button>`);
  } else if (f === "question") {
    const cur = curQuestion(R, M);
    body = head("This week's question", "Only you can see your answer until you've both answered. Then you read them together.")
      + `<p class="fm-qtext big">${esc(cur.text)}</p><textarea name="answer" rows="5" placeholder="Write as much or as little as you like.">${esc(cur.answers?.[me]?.text || "")}</textarea>`
      + bar("", `<button class="fm-btn pri" data-act="answerq">Save my answer</button>`);
  } else if (f === "thanks") {
    const to = F.thanksTo || other;
    body = head("Say thank you", `Something small counts. You'll both see it at ${TALK}.`)
      + `<div class="fm-choice" role="group">${[other, ...C.kids.filter((k) => !k.unnamed).map((k) => k.id)].map((id) => `<button type="button" data-act="thanksto" data-to="${id}" aria-pressed="${to === id}">${esc(C.name(id))}</button>`).join("")}</div>
      <textarea name="text" rows="4" placeholder="Thank you for…"></textarea>` + bar("", `<button class="fm-btn pri" data-act="savethanks">Save</button>`);
  } else if (f === "meeting") {
    const kind = F.meetKind || "plan";
    body = head(`Add to ${TALK}`, "")
      + `<div class="fm-choice" role="group"><button type="button" data-act="meetkind" data-k="plan" aria-pressed="${kind === "plan"}">Plan something good</button><button type="button" data-act="meetkind" data-k="issue" aria-pressed="${kind === "issue"}">Something on my mind</button></div>
      ${kind === "plan" ? `<div class="fm-choice small" role="group">${[["us", "Date"], ["family", "Family"], ["me", "Time for me"]].map(([k, l]) => `<button type="button" data-act="plankind" data-k="${k}" aria-pressed="${(F.planKind || "us") === k}">${l}</button>`).join("")}</div>
        <input name="what" placeholder="What? e.g. Thai Ginger"><input name="when" placeholder="When? e.g. Friday 7pm">`
        : `<p class="fm-fsub">One thing, said plainly. It waits for ${TALK} (${esc(M.day)}), where one of you listens while the other speaks.</p><textarea name="issue" rows="4" placeholder="e.g. Mornings feel rushed and we snap at each other."></textarea>`}`
      + bar("", `<button class="fm-btn pri" data-act="savemeeting">Save</button>`);
  } else if (f === "rituals") {
    const kept = (R.ritualLog || {})[C.week] || [];
    body = head("Tick off a ritual", "Tap the ones you kept this week.")
      + `<ul class="fm-ritlist big">${(R.rituals || []).map((r) => `<li><button type="button" class="fm-tick" data-act="keptritual" data-id="${r.id}" aria-pressed="${kept.includes(r.id)}" aria-label="Kept this week"></button><span><b>${esc(r.text)}</b><span class="sub"> · ${RIT_EVERY[r.every] || ""}</span></span></li>`).join("")}</ul>`
      + bar("", `<button class="fm-btn pri" data-act="usback">Done</button>`);
  }
  return `<div class="fm-focusscreen">${body}</div>`;
}

function us(D, C) {
  const R = D.rel || {}, F = ctx.S.fam, other = F.me === "lokesh" ? "archana" : "lokesh";
  if (F.usFocus) return usFocus(D, C, R, F.me, other);
  const recent = (list, n = 6) => (list || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
  return `<div class="fm-bento">
    ${yourTurnTile(D, C, R, F.me, other)}
    ${compassTile(R, C, F.me, other)}
    ${growingTile(D, C, R)}
    ${questionTile(D, C, R, F.me, other)}
    ${ritualsTile(R, C)}
    <div class="fm-tile s4 glow"><h3>You two</h3><div class="fm-big3">
      <div class="tri"><b>${C.us.daysSinceUs == null ? "–" : C.us.daysSinceUs === 0 ? "today" : `${C.us.daysSinceUs} days`}</b><span>since time just you two</span></div>
      <div class="tri"><b>${C.us.us30}</b><span>times together · 30 days</span></div><div class="tri"><b>${C.us.family30}</b><span>family times · 30 days</span></div></div>
      <div class="fam-form"><input type="date" name="date" value="${todayISO()}"><select name="kind"><option value="us">Just us</option><option value="family">Family</option></select><input name="what" placeholder="What did you do? e.g. dinner out, hike with the kids"><button class="fm-btn sm pri" data-act="addtogether">Add</button></div>
      ${(R.together || []).length ? `<ul class="fam-list">${recent(R.together).map((t) => `<li><span class="d">${fmtD(t.date)}</span><span><span class="fm-type">${t.kind === "us" ? "Us" : "Family"}</span>${esc(t.what)}</span><button class="fm-link" data-act="del" data-file="rel" data-list="together" data-id="${t.id}">Remove</button></li>`).join("")}</ul>` : ""}</div>
    <div class="fm-tile s2"><h3>Appreciation</h3><p class="sub">Something the other did this week that you appreciated.</p>
      <div class="fam-form"><select name="to"><option value="${other}">To ${esc(C.name(other))}</option>${C.kids.map((k) => `<option value="${k.id}">To ${esc(k.name)}</option>`).join("")}</select><input name="text" placeholder="Thank you for…"><button class="fm-btn sm pri" data-act="addappreciation">Add</button></div>
      ${(R.appreciation || []).length ? `<ul class="fam-list quotes">${recent(R.appreciation, 8).map((a) => `<li><span class="d">${fmtD(a.date)}</span><span><b>${esc(C.name(a.from))} → ${esc(C.name(a.to))}:</b> ${esc(a.text)}</span></li>`).join("")}</ul>` : ""}</div>
    <div class="fm-tile s2"><h3>Our relationship goals</h3>
      ${(R.goals || []).length ? `<ul class="fam-list">${R.goals.map((g) => `<li><span>${g.value ? `<span class="fm-type">${esc(g.value)}</span>` : ""}${esc(g.text)}</span><button class="fm-link" data-act="del" data-file="rel" data-list="goals" data-id="${g.id}">Remove</button></li>`).join("")}</ul>` : empty("What you want more of as a couple.")}
      <div class="fam-form"><input name="text" placeholder="e.g. A date night every two weeks"><button class="fm-btn sm pri" data-act="addgoal">Add</button></div></div>
    <div class="fm-tile s2"><h3>Learnings</h3><p class="sub">From a relationship coach, a book, friends who do it well.</p>
      <div class="fam-form"><input name="source" placeholder="Source, e.g. coach session" class="short"><input name="text" placeholder="What you took away"><button class="fm-btn sm pri" data-act="addlearning">Add</button></div>
      ${(R.learnings || []).length ? `<ul class="fam-list quotes">${recent(R.learnings, 10).map((l) => `<li><span class="d">${fmtD(l.date)}</span><span>${l.source ? `<b>${esc(l.source)}:</b> ` : ""}${esc(l.text)}</span><button class="fm-link" data-act="del" data-file="rel" data-list="learnings" data-id="${l.id}">Remove</button></li>`).join("")}</ul>` : ""}</div>
    <div class="fm-tile s2"><h3>Family &amp; friends</h3>
      ${C.us.birthdays.length ? `<p class="sub">Birthdays: ${C.us.birthdays.map((p) => `${esc(p.name)} ${fmtD(p.next)}`).join(" · ")}</p>` : ""}
      ${(R.people || []).length ? `<ul class="fam-list">${R.people.map((p) => { const ago = p.lastContact ? daysBetween(p.lastContact, todayISO()) : null; return `<li class="${ago == null || ago > 30 ? "late" : ""}"><span><b>${esc(p.name)}</b> ${p.relation ? `· ${esc(p.relation)}` : ""}</span><span class="sub">${ago == null ? "not in touch yet" : ago === 0 ? "today" : `${ago} days ago`}</span><button class="fm-link" data-act="contacted" data-id="${p.id}">Talked today</button></li>`; }).join("")}</ul>` : empty("Parents, siblings, close friends: who you want to keep in touch with.")}
      <div class="fam-form"><input name="name" placeholder="Name" class="short"><input name="relation" placeholder="e.g. my mom" class="short"><input name="birthday" placeholder="Birthday MM-DD" class="short"><button class="fm-btn sm pri" data-act="addperson">Add</button></div></div>
  </div>`;
}

/* ── Nutrition: plan the week's meals, review last week's ── */

const dayName = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
// Choosing a dish for one meal: cuisines, favorites and looked-up dishes, ingredients beside the
// list, and a web lookup (by the routine) for anything that isn't there.
function dishPicker(D, C, F) {
  const P = F.nutPick, label = SLOTS.find(([k]) => k === P.slot)[1], q = (F.pickQ || "").trim().toLowerCase();
  const cur = (D.nutrition?.meals || {})[P.date] || {}, favIds = C.nutrition.favorites.map((f) => f.id).filter(Boolean);
  const looked = (D.recipes?.dishes || []), lookups = (D.recipes?.lookups || []).slice().reverse();
  const tabs = [...CUISINES, "Favorites", ...(looked.length ? ["Looked up"] : [])], tab = F.pickTab || "Indian";
  let list = allDishes(D).filter((d) => (tab === "Favorites" ? favIds.includes(d.id) : tab === "Looked up" ? d.source === "lookup" : d.cuisine === tab && (d.source === "starter" || d.confirmed)));
  if (!F.pickAll && tab !== "Looked up" && tab !== "Favorites") list = list.filter((d) => (d.meals || []).includes(P.slot));
  if (q) list = allDishes(D).filter((d) => d.name.toLowerCase().includes(q));
  const sel = F.pickSel ? dishById(D, F.pickSel) : null;
  const editing = sel && F.editDish === sel.id, draft = editing ? (F.editDraft = F.editDraft || (sel.ingredients || []).map((g) => ({ ...g }))) : null;
  const opt = (list, v, lab = (x) => x || "count") => list.map((x) => `<option value="${esc(x)}"${x === (v || "") ? " selected" : ""}>${esc(lab(x))}</option>`).join("");
  const panel = editing ? `<div class="fm-dishpanel"><span class="fm-kicker">Editing ingredients · for 4</span><h3 class="fm-name">${esc(sel.name)}</h3>
      <ul class="fm-ingedit">${draft.map((g, i) => `<li data-row="${i}"><input data-f="item" value="${esc(g.item)}" placeholder="Ingredient"><input data-f="qty" inputmode="decimal" value="${esc(g.qty ?? "")}" placeholder="Qty">
        <select data-f="unit">${opt(UNITS, g.unit)}</select><select data-f="aisle">${opt(AISLES, g.aisle, (x) => x)}</select><button type="button" class="fm-link" data-act="ingdel" data-i="${i}" aria-label="Remove">Remove</button></li>`).join("")}</ul>
      <button type="button" class="fm-btn sm" data-act="ingadd">+ Add an ingredient</button>
      <div class="btnrow"><button class="fm-btn pri" data-act="saveings">Save</button><button class="fm-btn" data-act="canceledit">Cancel</button>${sel.edited ? `<button class="fm-link" data-act="resetings">Back to the original</button>` : ""}</div></div>`
    : sel ? `<div class="fm-dishpanel"><span class="fm-kicker">${esc(sel.cuisine || "")}${sel.source === "lookup" ? " · looked up on the web" : ""}</span><h3 class="fm-name">${esc(sel.name)}</h3>
      <ul class="fm-ings">${(sel.ingredients || []).map((g) => `<li><span>${esc(g.item)}</span><span class="sub">${esc(fmtAmount(g.qty, g.unit))}</span></li>`).join("")}</ul>
      ${sel.url ? `<p class="sub">Source: <a href="${esc(sel.url)}" target="_blank" rel="noopener">${esc(sel.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</a></p>` : ""}
      <button class="fm-btn pri" data-act="adddish" data-id="${esc(sel.id)}">${cur[P.slot] ? `Replace ${esc(cur[P.slot])} with this` : `Add to ${label.toLowerCase()}, ${dayName(P.date)}`}</button>
      <p class="sub">Its ingredients go on the week's grocery list.</p>
      <div class="btnrow"><button class="fm-btn sm" data-act="editdish" data-id="${esc(sel.id)}">Edit ingredients</button><button class="fm-btn sm" data-act="copyings" data-id="${esc(sel.id)}">Copy ingredients</button>${sel.edited ? `<span class="sub">You've edited this one.</span>` : ""}</div></div>`
    : `<div class="fm-dishpanel empty"><p class="sub">Tap a dish to see its ingredients here.</p></div>`;
  const pend = lookups.filter((l) => l.status === "pending"), done = lookups.filter((l) => l.status !== "pending").slice(0, 3);
  return `<div class="fm-focusscreen wide"><button class="fm-back" data-act="pickback">‹ Back to the week</button>
    <h2 class="fm-ftitle">${label} · ${dayName(P.date)}</h2>${cur[P.slot] ? `<p class="fm-fsub">Now: ${esc(cur[P.slot])}</p>` : ""}
    <div class="fm-monthpick">${tabs.map((t) => `<button type="button" data-act="picktab" data-t="${t}" aria-pressed="${!q && tab === t}">${t}</button>`).join("")}</div>
    <input type="search" data-dishsearch value="${esc(F.pickQ || "")}" placeholder="Search every dish">
    <div class="fm-dpick"><div class="fm-dishes">
      ${list.length ? `<ul class="fm-dishlist">${list.map((d) => `<li><button type="button" data-act="pickdish" data-id="${esc(d.id)}" aria-pressed="${F.pickSel === d.id}"><b>${esc(d.name)}</b><span class="sub">${esc(d.cuisine || "")} · ${(d.meals || []).join(", ")}</span></button></li>`).join("")}</ul>`
        : `<p class="sub">${tab === "Favorites" && !q ? "Dinners you mark “make again” in the review show up here." : "No dishes here."}</p>`}
      ${!q && tab !== "Looked up" && tab !== "Favorites" ? `<button class="fm-link" data-act="pickall">${F.pickAll ? `Only ${label.toLowerCase()} dishes` : `Show all ${tab} dishes`}</button>` : ""}
      <div class="fm-quick">${QUICK.map((x) => `<button type="button" class="fm-vchip" data-act="quickmeal" data-v="${x}">${x}</button>`).join("")}</div>
      <div class="fm-lookup"><b>Not on the list?</b><p class="sub">Type the dish; Claude looks up its ingredients on the web (takes a few minutes). You'll see them before anything is added.</p>
        <div class="fam-form"><input name="lookupname" placeholder="e.g. Malai kofta"><button class="fm-btn sm pri" data-act="lookupdish">Look up ingredients</button></div>
        ${pend.length ? `<ul class="fm-pend">${pend.map((l) => `<li><span>Looking up <b>${esc(l.name)}</b>…</span><span class="sub">started ${fmtD(l.requestedAt)}</span></li>`).join("")}</ul><button class="fm-btn sm" data-act="checklookups">Check now</button>` : ""}
        ${done.length ? `<ul class="fm-pend">${done.map((l) => `<li>${l.status === "ready" && l.dishId ? `<button class="fm-link" data-act="pickdish" data-id="${esc(l.dishId)}">${esc(l.name)}: ingredients ready</button>` : `<span>${esc(l.name)}: ${esc(l.note || "couldn't find a recipe")}</span>`}</li>`).join("")}</ul>` : ""}</div>
    </div>${panel}</div></div>`;
}

function nutrition(D, C) {
  const F = ctx.S.fam, N = C.nutrition, tab = F.nutTab || "plan";
  const range = (st) => `${fmtD(st)} – ${fmtD(addDays(st, 6))}`;
  const head = `<div class="fm-tile s4 fm-nuthead"><div class="fm-rowsplit"><h3 class="fm-name">Family nutrition</h3>
      <span class="fm-monthpick" role="group"><button type="button" data-act="nuttab" data-t="plan" aria-pressed="${tab === "plan"}">Plan the week</button><button type="button" data-act="nuttab" data-t="review" aria-pressed="${tab === "review"}">Review last week</button></span></div>
    <p class="sub">${tab === "plan" ? `Meals for ${range(N.plan.start)}, from Growing Together to the next one.` : `How ${range(N.review.start)} went.`}</p></div>`;
  if (F.nutPick) return dishPicker(D, C, F);
  if (tab === "plan") {
    const slotBtn = (d, slot, label) => { const name = d[slot], ds = d[`${slot}Id`] ? dishById(D, d[`${slot}Id`]) : null;
      return `<div class="fm-slot"><span class="sl">${label}</span><button type="button" class="fm-slotbtn${name ? " set" : ""}" data-act="nutpick" data-date="${d.date}" data-slot="${slot}">${name ? esc(name) : "+ Choose"}${name && !ds && !QUICK.includes(name) ? `<i class="nolist">no ingredients</i>` : ""}</button>${name ? `<button type="button" class="fm-link" data-act="nutclear" data-date="${d.date}" data-slot="${slot}" aria-label="Clear">Clear</button>` : ""}</div>`; };
    const G = (D.nutrition?.grocery || {})[N.plan.start] || {}, have = G.have || [], extra = G.extra || [], list = groceryList(D, N.plan.days);
    const count = list.reduce((t, a) => t + a.items.length, 0) + extra.length, left = list.reduce((t, a) => t + a.items.filter((i) => !have.includes(i.key)).length, 0) + extra.filter((x) => !have.includes(`x:${x.id}`)).length;
    return `<div class="fm-bento">${head}
      <div class="fm-tile s2 fm-nutplan"><span class="fm-kicker">The week's meals</span><ul class="fm-meals">${N.plan.days.map((d) => `<li><span class="dn">${dayName(d.date)}</span><div class="fm-slots">${SLOTS.map(([k, l]) => slotBtn(d, k, l)).join("")}</div></li>`).join("")}</ul></div>
      <div class="fm-tile s2 fm-grocery" id="grocery"><div class="fm-rowsplit"><span class="fm-kicker">Grocery shopping list</span><span class="sub">${count ? `${left} to buy · ${count - left} have` : ""}</span></div>
        ${count ? list.map((a) => `<h5>${esc(a.aisle)}</h5><ul class="fm-glist">${a.items.map((it) => `<li class="${have.includes(it.key) ? "have" : ""}"><button type="button" class="fm-tick" data-act="grochave" data-k="${esc(it.key)}" aria-pressed="${have.includes(it.key)}" aria-label="Have it"></button><span><b>${esc(it.item)}</b>${it.amounts ? ` · ${esc(it.amounts)}` : ""}<span class="for">${esc(it.for.join(", "))}</span></span></li>`).join("")}</ul>`).join("")
          + (extra.length ? `<h5>Also</h5><ul class="fm-glist">${extra.map((x) => `<li class="${have.includes(`x:${x.id}`) ? "have" : ""}"><button type="button" class="fm-tick" data-act="grochave" data-k="x:${x.id}" aria-pressed="${have.includes(`x:${x.id}`)}" aria-label="Have it"></button><span><b>${esc(x.item)}</b></span><button class="fm-link" data-act="grocdel" data-id="${x.id}">Remove</button></li>`).join("")}</ul>` : "")
          : `<p class="sub">Choose dishes for the week and their ingredients collect here, by aisle. Tick what you already have.</p>`}
        <div class="fam-form"><input name="grocitem" placeholder="Add something else, e.g. coffee"><button class="fm-btn sm" data-act="grocadd">Add</button></div>
        ${count ? `<div class="btnrow"><button class="fm-btn sm pri" data-act="groccopy">Copy the list</button>${typeof navigator !== "undefined" && navigator.share ? `<button class="fm-btn sm" data-act="grocshare">Share</button>` : ""}<span class="sub">Paste it into your shopping list or app.</span></div>` : ""}</div></div>`;
  }
  const R = N.review, watch = (C.money?.watch || []).find((w) => /restaurant/i.test(w.category));
  const seg = (d, key, opts) => `<span class="fm-choice small" role="group">${opts.map(([v, l]) => `<button type="button" data-act="nutset" data-date="${d.date}" data-k="${key}" data-v="${v}" aria-pressed="${d[key] === v}">${l}</button>`).join("")}</span>`;
  return `<div class="fm-bento">${head}
    <div class="fm-tile s4"><div class="fm-big3">
      <div class="tri"><b>${R.cooked}</b><span>cooked at home${R.planned ? ` · ${R.planned} planned` : ""}</span></div>
      <div class="tri"><b>${R.out}</b><span>ate out${watch ? ` · Restaurants & Bars ${usd(watch.spent)} this month` : ""}</span></div>
      <div class="tri"><b>${R.other}</b><span>something else${R.open ? ` · ${R.open} not marked yet` : ""}</span></div></div></div>
    <div class="fm-tile s4"><ul class="fm-meals review">${R.days.map((d) => `<li class="${d.date > C.today ? "later" : ""}"><span class="dn">${dayName(d.date)}</span>
        <span class="planned">${d.dinner ? esc(d.dinner) : `<span class="sub">Nothing planned</span>`}</span>
        ${d.date > C.today ? `<span class="sub">Still to come</span>` : `${seg(d, "status", [["cooked", "Cooked"], ["out", "Ate out"], ["other", "Something else"]])}
        ${d.status === "cooked" && d.dinner ? `<span class="fm-again"><span class="sub">Make again?</span>${seg(d, "again", [["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]])}</span>` : ""}
        <input data-nutnote="${d.date}" value="${esc(d.note || "")}" placeholder="A note, e.g. kids loved it, too spicy">`}</li>`).join("")}</ul></div></div>`;
}

/* ── Health ──────────────────────────────────────────────── */

function health(D, C) {
  const wk = C.week;
  const scale = (name, val) => `<span class="fm-seg" data-field="${name}">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-val="${v}" aria-pressed="${val === v}">${v}</button>`).join("")}</span>`;
  const card = (h) => {
    const e = (D.health?.entries || []).find((x) => x.weekStart === wk && x.person === h.id) || {};
    const vs = (k, unit = "") => (h.prev[k] != null ? `<span class="sub">usual ${h.prev[k]}${unit}</span>` : "");
    return `<div class="fm-tile s2 fam-health" data-person="${h.id}"><h3>${esc(h.name)} · week of ${fmtD(wk)}</h3>
      <div class="fam-grid"><label class="fm-fld"><span>Sleep, hours a night</span><input type="number" step="0.5" min="0" max="12" name="sleepHours" value="${e.sleepHours ?? ""}">${vs("sleepHours", "h")}</label>
      <label class="fm-fld"><span>Exercise days</span><input type="number" min="0" max="7" name="exerciseDays" value="${e.exerciseDays ?? ""}">${vs("exerciseDays")}</label>
      <label class="fm-fld"><span>Weight (optional)</span><input type="number" step="0.1" name="weight" value="${e.weight ?? ""}"></label></div>
      <div class="fm-fld"><span>Eating well, 1–5</span>${scale("eating", e.eating)}${vs("eating")}</div>
      <div class="fm-fld"><span>Energy, 1–5</span>${scale("energy", e.energy)}${vs("energy")}</div>
      <label class="fm-fld"><span>Note</span><input name="note" value="${esc(e.note || "")}" placeholder="Anything worth remembering"></label>
      <div class="fm-btnrow"><button class="fm-btn pri" data-act="savehealth" data-person="${h.id}">${e.weekStart ? "Update" : "Save"} this week</button></div>
      ${h.weeks.length > 1 ? `<div class="fam-scroll"><table><thead><tr><th>Week</th><th>Sleep</th><th>Exercise</th><th>Eating</th><th>Energy</th></tr></thead><tbody>${h.weeks.slice().reverse().map((x) => `<tr><td>${fmtD(x.weekStart)}</td><td>${x.sleepHours ?? "–"}</td><td>${x.exerciseDays ?? "–"}</td><td>${x.eating ?? "–"}</td><td>${x.energy ?? "–"}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`;
  };
  return `<div class="fm-bento">${C.health.map(card).join("")}</div>`;
}

/* ── Kids: who we hope they become, what we noticed this week, and the talk about it ── */

// What works at each age (CDC, Gottman, Ross Greene, the research on teens and autonomy).
const KID_TIPS = {
  young: [
    ["Name it, praise it", "Right away, and say exactly what you saw: “You waited for your turn. That was patient.” It teaches more than “good job.”"],
    ["Big feelings first", "Get down to eye level. Name the feeling (“You're frustrated the tower fell”), then the limit (“Throwing isn't okay”), then what to do instead (“You can ask for help”)."],
    ["Teach, then practise", "When everyone's calm, show what to do instead and practise it as a game. One behavior at a time; a sticker chart helps at this age."],
  ],
  teen: [
    ["Ask first", "“I've noticed ___. What's up?” Listen more than you talk, and say back what you heard before you answer."],
    ["Your concern, and why", "One or two sentences: health, safety, fairness or learning. Give the reason; “because I said so” teaches nothing."],
    ["Solve it together", "“How can we fix this so it works for both of us?” Let them suggest first. Agree, try it for a week, check back."],
    ["Private, specific, no comparing", "Correct in private, never in front of friends or next to a sibling. Praise effort and character, not only results."],
  ],
};
const stageOf = (k) => (k.stage === "teen" ? "teen" : "young");
const STAGE_LINE = { young: "Young child: praise right away, teach and practise", teen: "Teen: explain why, solve it together" };
const RESULTS = { helped: "It helped", keep: "Keep going", change: "Try something else" };

// The week a kid's notes count toward: since the last Growing Together, up to today.
function kidWeek(D, C, k) {
  const M = meetDates(D, C.today), obs = (k.observations || []).filter((o) => o.date > M.last && o.date <= C.today);
  return { M, obs, glows: obs.filter((o) => o.type === "encourage"), grows: obs.filter((o) => o.type === "correct") };
}
const talksOf = (D, id) => D.kids?.[id]?.talks || {};
// The plan from the latest talk on or before `upTo` (or strictly before it).
function planOf(D, id, upTo, strict) {
  const T = talksOf(D, id), w = Object.keys(T).filter((x) => (strict ? x < upTo : x <= upTo) && T[x].workOn?.plan).sort().at(-1);
  return w ? { week: w, ...T[w] } : null;
}
const hopesOf = (D, id) => D.kids?.[id]?.hopes || [];
// Values to choose from: the family compass first, then heart, mind and will.
function valueGroups(D) {
  const comp = (D.rel?.compass?.values || []).map((v) => v.name);
  return [...(comp.length ? [["From our compass", comp]] : []), ...Object.entries(STRENGTHS).map(([g, list]) => [`Strengths of ${g.toLowerCase()}`, list.filter((x) => !comp.includes(x))])];
}

function kidsNudge(D, C) {
  return C.kids.filter((k) => !k.unnamed).map((k) => { const w = kidWeek(D, C, k);
    if (w.grows.length <= w.glows.length) return "";
    return `<button class="fm-nudge warm" data-act="kidfocus" data-f="notice" data-kid="${k.id}" data-type="encourage"><b>${esc(k.name)}: ${w.grows.length} grow${w.grows.length === 1 ? "" : "s"}, ${w.glows.length} glow${w.glows.length === 1 ? "" : "s"} since ${fmtD(w.M.last)}.</b> Look for something ${esc(k.name)} does right, and say it out loud. <span aria-hidden="true">›</span></button>`; }).join("");
}

const obsLine = (o, C, mine) => `<li class="${o.type === "encourage" ? "glow" : "grow"}"><div class="meta"><span class="tg">${GLOW[o.type]}${o.trait ? ` · ${esc(o.trait)}` : ""}</span><span>${fmtD(o.date, { weekday: "short" })} · ${esc(C.name(o.by))}</span>${mine ? `<button class="fm-link" data-act="delobs" data-id="${o.id}">Remove</button>` : ""}</div>${o.note ? `<p>${esc(o.note)}</p>` : ""}</li>`;

function kidTile(D, C, k) {
  const F = ctx.S.fam, w = kidWeek(D, C, k), st = stageOf(k), hopes = hopesOf(D, k.id), plan = planOf(D, k.id, C.today);
  const counts = (n, label, cls) => `<div class="fm-gg ${cls}"><b>${n}</b><span>${label}${n === 1 ? "" : "s"}</span></div>`;
  return `<div class="fm-tile s2 fam-kid fm-kidcard" data-kid="${k.id}">
    <div class="fm-rowsplit"><h3 class="fm-name">${esc(k.name)}</h3><span class="sub">${STAGE_LINE[st]}</span></div>
    <div class="fm-hopes"><div class="fm-rowsplit"><span class="fm-kicker">Who we hope ${esc(k.name)} becomes</span><button class="fm-link" data-act="kidfocus" data-f="hopes" data-kid="${k.id}">${hopes.length ? "Change" : "Choose"}</button></div>
      ${hopes.length ? `<div class="fm-vchips">${hopes.map((h) => `<span class="fm-vchip on">${esc(h)}</span>`).join("")}</div>` : `<p class="sub">Choose up to 3 values to focus on this season.</p>`}</div>
    <div class="fm-ggrow">${counts(w.glows.length, "glow", "glow")}${counts(w.grows.length, "grow", "grow")}<span class="sub">since the talk on ${fmtD(w.M.last)}</span></div>
    <div class="fm-choice"><button type="button" data-act="kidfocus" data-f="notice" data-kid="${k.id}" data-type="encourage">+ Glow · did well</button><button type="button" data-act="kidfocus" data-f="notice" data-kid="${k.id}" data-type="correct">+ Grow · to work on</button></div>
    ${plan ? `<div class="fm-working"><span class="fm-kicker">Working on${plan.workOn.trait ? ` · ${esc(plan.workOn.trait)}` : ""}</span><p>${esc(plan.workOn.plan)}</p><span class="sub">From ${fmtD(plan.week)}'s talk</span></div>` : ""}
    ${w.obs.length ? `<ul class="fm-obs">${w.obs.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((o) => obsLine(o, C, o.by === F.me)).join("")}</ul>` : `<p class="sub">Nothing noticed yet this week.</p>`}
    <details class="fm-more fm-tips"><summary>Words that help at this age</summary><dl>${KID_TIPS[st].map(([h, t]) => `<dt>${h}</dt><dd>${t}</dd>`).join("")}</dl></details>
  </div>`;
}

function kidLogistics(C, k) {
  const n = C.navya;
  const navyaLine = k.dashboard === "navya" ? `<div class="fam-navya">${n ? `<span>GPA <b>${n.gpa?.toFixed?.(2) ?? "–"}</b></span><span>Social <b>${n.social != null ? `${Math.floor(n.social / 60)}h ${String(n.social % 60).padStart(2, "0")}m` : "–"}/day</b></span><span>Calls <b>${n.calls ?? "–"}%</b></span>${n.focus ? `<p><b>Navya's focus this week:</b> ${esc(n.focus)}</p>` : ""}` : `<span class="sub">Navya's dashboard isn't reachable from this device.</span>`}
      <button class="fm-btn sm" data-act="opennavya">Open Navya's dashboard →</button></div>` : "";
  return `<div class="fm-tile s2 fam-kid" data-kid="${k.id}"><div class="fm-rowsplit"><h3>${esc(k.name)} · school, appointments, goals</h3>${k.unnamed ? `<span class="fam-form"><input name="kidname" placeholder="Their name" class="short"><button class="fm-btn sm pri" data-act="namekid">Save name</button></span>` : ""}</div>
    ${navyaLine}
    <h4>Appointments &amp; logistics</h4>${k.appointments.length ? `<ul class="fam-list">${k.appointments.map((a) => `<li><span class="d">${fmtD(a.date)}${a.time ? ` ${esc(a.time)}` : ""}</span><span>${esc(a.what)}</span><button class="fm-link" data-act="kiddone" data-id="${a.id}">Done</button></li>`).join("")}</ul>` : empty("Nothing coming up.")}
    <div class="fam-form"><input type="date" name="date" class="short"><input name="time" placeholder="Time" class="tiny"><input name="what" placeholder="e.g. Dentist, school form due"><button class="fm-btn sm pri" data-act="addkidappt">Add</button></div>
    <h4>Developmental goals</h4>${k.goals.length ? `<ul class="fam-list">${k.goals.map((g) => `<li><span>${g.area ? `<b>${esc(g.area)}:</b> ` : ""}${esc(g.text)}</span><select data-act="goalstatus" data-id="${g.id}">${["working", "better", "done"].map((s) => `<option value="${s}"${g.status === s ? " selected" : ""}>${s === "working" ? "Working on it" : s === "better" ? "Getting better" : "Done"}</option>`).join("")}</select></li>`).join("")}</ul>` : empty("What you're helping them grow in.")}
    <div class="fam-form"><input name="area" placeholder="Area, e.g. Independence" class="short"><input name="text" placeholder="The goal"><button class="fm-btn sm pri" data-act="addkidgoal">Add</button></div></div>`;
}

function kids(D, C) {
  const named = C.kids.filter((k) => !k.unnamed), M = meetDates(D, C.today);
  return `<div class="fm-bento">${kidsNudge(D, C)}
    <div class="fm-tile s4 fm-kidhead"><div class="fm-rowsplit"><div><span class="fm-kicker">Character, values &amp; behavior</span><p class="fm-mission">Kids grow toward what we notice.</p></div>
      <button class="fm-btn pri" data-act="kidfocus" data-f="talk">Talk about the kids</button></div>
      <p class="sub">Log a <b>glow</b> when you see a value lived, a <b>grow</b> when something needs work. On ${M.isToday ? "today's" : `${M.day}'s`} ${TALK} you look at them together: call out the wins, pick one thing each to work on. Just the two of you for now.</p></div>
    ${named.map((k) => kidTile(D, C, k)).join("")}
    ${C.kids.map((k) => kidLogistics(C, k)).join("")}
  </div>`;
}

// One job per screen: note what you saw · choose their values · the weekly talk.
function kidFocus(D, C) {
  const F = ctx.S.fam, f = F.kidFocus, named = C.kids.filter((k) => !k.unnamed), M = meetDates(D, C.today);
  const head = (t, sub) => `<button class="fm-back" data-act="kidback">‹ Back</button><h2 class="fm-ftitle">${t}</h2>${sub ? `<p class="fm-fsub">${sub}</p>` : ""}`;
  const bar = (left, btn) => `<div class="fm-fbar"><span>${left}</span>${btn}</div>`;
  const chips = (list, sel, act, extra = "") => `<div class="fm-vchips big">${list.map((v) => `<button type="button" class="fm-vchip" data-act="${act}" data-v="${esc(v)}" ${extra} aria-pressed="${sel.includes(v)}">${esc(v)}</button>`).join("")}</div>`;
  let body = "";
  if (f === "notice") {
    const n = F.kn, k = named.find((x) => x.id === n.kid) || named[0], st = stageOf(k), hopes = hopesOf(D, k.id), glow = n.type === "encourage";
    const tip = glow ? (st === "teen" ? `Tell ${esc(k.name)} too, specifically and maybe privately: “I saw how you…”` : `Tell ${esc(k.name)} right away, by name: “You shared without being asked. That was kind.”`)
      : (st === "teen" ? `If it can wait, let it. Bring it to ${TALK} and plan the conversation: ask first, then your concern, then solve it together.` : "In the moment: name the feeling, then the limit, then what to do instead. Then note it here.");
    body = head("I noticed…", `Takes 20 seconds. You'll both see it at ${TALK}.`)
      + `<div class="fm-choice" role="group">${named.map((x) => `<button type="button" data-act="knset" data-k="kid" data-v="${x.id}" aria-pressed="${x.id === k.id}">${esc(x.name)}</button>`).join("")}</div>
      <div class="fm-choice gg" role="group"><button type="button" class="g" data-act="knset" data-k="type" data-v="encourage" aria-pressed="${glow}">Glow · did well</button><button type="button" class="r" data-act="knset" data-k="type" data-v="correct" aria-pressed="${!glow}">Grow · to work on</button></div>
      <span class="fm-kicker">Which value?</span>
      ${hopes.length ? `<div><span class="sub">What you're focusing on with ${esc(k.name)}</span>${chips(hopes, [n.trait], "knset", 'data-k="trait"')}</div>` : ""}
      <details class="fm-more"${hopes.length ? "" : " open"}><summary>${hopes.length ? "Something else" : "Choose one"}</summary>${valueGroups(D).map(([g, list]) => `<div class="fm-vgroup"><span class="sub">${g}</span>${chips(list.filter((x) => !hopes.includes(x)), [n.trait], "knset", 'data-k="trait"')}</div>`).join("")}</details>
      <textarea name="note" rows="3" placeholder="${glow ? "What did you see? e.g. Helped clear the table without being asked." : "What happened? e.g. Grabbed the iPad and yelled when it was time to stop."}">${esc(n.note || "")}</textarea>
      <p class="fm-hint">${tip}</p>`
      + bar("", `<button class="fm-btn pri" data-act="savenotice">Save</button>`);
  } else if (f === "hopes") {
    const k = named.find((x) => x.id === F.kidId) || named[0], d = (F.hopeDraft = F.hopeDraft || hopesOf(D, k.id).slice());
    body = head(`Who we hope ${esc(k.name)} becomes`, `Choose up to 3 values to focus on with ${esc(k.name)} this season. Do it together; change them when ${esc(k.name)} grows into them.`)
      + valueGroups(D).map(([g, list]) => `<div class="fm-vgroup"><span class="fm-kicker">${g}</span>${chips(list, d, "hopepick")}</div>`).join("")
      + `<p class="fm-hint">Heart, mind and will are Character Lab's three kinds of strengths: how we treat others, how we think, and how we get things done.</p>`
      + bar(`<b>${d.length}</b> of 3 chosen`, `<button class="fm-btn pri" data-act="savehopes"${d.length ? "" : " disabled"}>Save</button>`);
  } else if (f === "talk") {
    const dr = (F.ktDraft = F.ktDraft || Object.fromEntries(named.map((k) => { const t = talksOf(D, k.id)[M.next] || {}; return [k.id, { callOut: t.callOut || "", trait: t.workOn?.trait || "", plan: t.workOn?.plan || "" }]; })));
    body = head("Talk about the kids", `${M.isToday ? "Today" : `${M.day}, ${fmtD(M.next)}`} · about 10 minutes. Wins first, then one thing each to work on. Just the two of you for now.`)
      + named.map((k) => {
        const w = kidWeek(D, C, k), st = stageOf(k), prev = planOf(D, k.id, M.next, true), d = dr[k.id], hopes = hopesOf(D, k.id);
        const opts = [...new Set([...hopes, ...valueGroups(D).flatMap(([, l]) => l)])];
        return `<section class="fm-kidtalk" data-kid="${k.id}"><div class="fm-rowsplit"><h3 class="fm-name">${esc(k.name)}</h3><span class="sub">${w.glows.length} glow${w.glows.length === 1 ? "" : "s"} · ${w.grows.length} grow${w.grows.length === 1 ? "" : "s"}</span></div>
          ${prev ? `<div class="fm-working"><span class="fm-kicker">Last time · ${esc(prev.workOn.trait || "working on")}</span><p>${esc(prev.workOn.plan)}</p><span class="sub">How did it go?</span>
            <div class="fm-choice small" role="group">${Object.entries(RESULTS).map(([r, l]) => `<button type="button" data-act="ktresult" data-kid="${k.id}" data-w="${prev.week}" data-r="${r}" aria-pressed="${prev.result === r}">${l}</button>`).join("")}</div></div>` : ""}
          <span class="fm-kicker">1 · Wins to call out</span>
          ${w.glows.length ? `<ul class="fm-obs">${w.glows.map((o) => obsLine(o, C, false)).join("")}</ul>` : `<p class="sub">No glows logged this week. What did ${esc(k.name)} do well? Start there.</p>`}
          <label class="fm-fld"><b>How we'll say it to ${esc(k.name)}</b><input data-kt="callOut" value="${esc(d.callOut)}" placeholder="${st === "teen" ? "e.g. On the drive to practice: “I noticed how you helped your teammate.”" : "e.g. At bedtime: “You were so patient waiting for your turn today.”"}"></label>
          <span class="fm-kicker">2 · One thing to work on</span>
          ${w.grows.length ? `<ul class="fm-obs">${w.grows.map((o) => obsLine(o, C, false)).join("")}</ul>` : `<p class="sub">Nothing to work on logged. It's fine to skip this one.</p>`}
          <label class="fm-fld"><b>Which value</b><select data-kt="trait"><option value="">Choose…</option>${opts.map((v) => `<option${v === d.trait ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
          <label class="fm-fld"><b>Our plan</b><textarea data-kt="plan" rows="3" placeholder="${st === "teen" ? `e.g. ${esc(C.name("lokesh"))} talks with ${esc(k.name)} on Tuesday: ask what's going on first, share our concern about sleep, then agree a plan together.` : `e.g. Practise “my turn, your turn” with a timer after dinner; a sticker each time ${esc(k.name)} waits.`}">${esc(d.plan)}</textarea></label>
          <details class="fm-more fm-tips"><summary>${st === "teen" ? "How to have the talk" : "What works at this age"}</summary><dl>${KID_TIPS[st].map(([h, t]) => `<dt>${h}</dt><dd>${t}</dd>`).join("")}</dl></details>
        </section>`; }).join("")
      + bar("No shaming, no comparing.", `<button class="fm-btn pri" data-act="savekidtalk">Save</button>`);
  }
  return `<div class="fm-focusscreen">${body}</div>`;
}
// The talk screen's boxes, read back into the draft before it redraws.
function readKidTalk(root) {
  const F = ctx.S.fam; if (!F.ktDraft) return;
  root.ownerDocument.querySelectorAll(".fm-kidtalk").forEach((sec) => { const d = F.ktDraft[sec.dataset.kid]; if (!d) return; sec.querySelectorAll("[data-kt]").forEach((el) => { d[el.dataset.kt] = el.value.trim(); }); });
}

/* ── Growth: ideas from Lokesh's reading, podcasts and thinking, to talk about together ── */

function growth(D, C) {
  const F = ctx.S.fam, G = D.growth?.items || [], me = F.me;
  const open = G.filter((g) => g.status === "open").sort((a, b) => (a.date < b.date ? 1 : -1));
  const done = G.filter((g) => g.status === "discussed").sort((a, b) => ((a.discussedAt || a.date) < (b.discussedAt || b.date) ? 1 : -1));
  const card = (g) => {
    const editing = F.growthEdit === g.id;
    if (editing) return shareForm(g);
    const mine = (g.reflections || []).find((r) => r.by === me), others = (g.reflections || []).filter((r) => r.by !== me);
    const myEdit = F.reflectEdit === g.id || !mine;
    return `<div class="fm-tile s4 fm-idea" data-id="${g.id}">
      <div class="fm-rowsplit"><span class="fm-kicker">${esc(KINDS[g.source?.kind] || "Idea")}${g.source?.name ? ` · ${esc(g.source.name)}` : ""}${g.source?.author ? ` · ${esc(g.source.author)}` : ""}</span><span class="sub">${esc(C.name(g.from))} · ${fmtD(g.date)}</span></div>
      <h2 class="fm-idea-title">${esc(g.title)}</h2>
      <p class="fm-idea-text">${esc(g.idea)}</p>
      ${g.why ? `<p class="fm-why"><b>Why I'm sharing it:</b> ${esc(g.why)}</p>` : ""}
      ${g.questions?.length ? `<div class="fm-sec"><span class="fm-kicker">To reflect on</span><div class="fm-bubbles">${g.questions.map((q) => `<p class="fm-q">${esc(q)}</p>`).join("")}</div></div>` : ""}
      ${g.status === "discussed" ? `<div class="fm-focus"><span class="fm-kicker">What we'll take from it · ${fmtD(g.discussedAt)}</span><b>${esc(g.takeaway || "We talked about it.")}</b></div>` : ""}
      <div class="fm-sec"><span class="fm-kicker">Reflections</span>
        ${others.map((r) => `<div class="fm-reflect"><span class="sub">${esc(C.name(r.by))} · ${fmtD(r.date)}</span><p>${esc(r.text)}</p></div>`).join("")}
        ${myEdit ? `<label class="fm-fld"><span>Your reflection${others.length ? "" : " · what it brings up for you"}</span><textarea data-g="reflection" rows="3" placeholder="What do you think? Where does this show up in your life, or ours?">${esc(mine?.text || "")}</textarea></label>
          <div class="fm-btnrow"><button class="fm-btn sm pri" data-act="savereflect" data-id="${g.id}">Save reflection</button>${mine ? `<button class="fm-btn sm" data-act="cancel">Cancel</button>` : ""}</div>`
        : `<div class="fm-reflect mine"><span class="sub">You · ${fmtD(mine.date)} · <button class="fm-link" data-act="editreflect" data-id="${g.id}">Edit</button></span><p>${esc(mine.text)}</p></div>`}
        ${!others.length && !mine ? "" : ""}</div>
      ${g.status === "open" ? (F.discussing === g.id
        ? `<div class="fam-form"><input data-g="takeaway" placeholder="What we'll take from it, or try (optional)"><button class="fm-btn sm pri" data-act="discussed" data-id="${g.id}">Save</button><button class="fm-btn sm" data-act="cancel">Cancel</button></div>`
        : `<div class="fm-btnrow"><button class="fm-btn" data-act="startdiscussed" data-id="${g.id}">We talked about it</button>${g.from === me ? `<button class="fm-link" data-act="editgrowth" data-id="${g.id}">Edit</button><button class="fm-link" data-act="delgrowth" data-id="${g.id}">Delete</button>` : ""}</div>`) : ""}
    </div>`;
  };
  return `<div class="fm-bento">
    <div class="fm-tile s4"><div class="fm-rowsplit"><div><h3>Grow together</h3><p class="sub">One idea at a time from a book, a podcast or your own thinking: what it is, why it matters to you, and a question to reflect on. Talk about it, then note what you'll take from it.</p></div>
      ${F.growthEdit === "new" ? "" : `<button class="fm-btn pri" data-act="newgrowth">Share an idea</button>`}</div>
      ${F.growthEdit === "new" ? shareForm(null) : ""}</div>
    ${open.length ? open.map(card).join("") : `<div class="fm-tile s4"><p class="sub">Nothing waiting to talk about.</p></div>`}
    ${done.length ? `<div class="fm-tile s4"><details class="fm-more"><summary>Talked about (${done.length})</summary>${done.map((g) => `<div class="fm-note past"><div class="fm-rowsplit"><b>${esc(g.title)}</b><span class="sub">${fmtD(g.discussedAt)}</span></div><p class="sub">${esc(KINDS[g.source?.kind] || "")}${g.source?.name ? ` · ${esc(g.source.name)}` : ""}</p>${g.takeaway ? `<p class="talked">${esc(g.takeaway)}</p>` : ""}<button class="fm-link" data-act="opengrowth" data-id="${g.id}">Open</button></div>`).join("")}</details></div>` : ""}
    ${F.openGrowth ? (() => { const g = done.find((x) => x.id === F.openGrowth); return g ? card(g) : ""; })() : ""}
  </div>`;
}

// Arrived from a Learning source screen: open the share form with that source (and the idea that
// was tapped) filled in, and list the source's other insights and thoughts to pick from.
const KIND_OF = { book: "book", podcast: "podcast", article: "article", youtube: "video", video: "video", course: "video" };
function startShareFromLearning(sh) {
  const F = ctx.S.fam;
  ctx.S.famShare = null;
  F.tab = "growth"; F.growthEdit = "new"; F.openGrowth = null;
  F.pick = { src: sh.src, kind: KIND_OF[sh.src?.type] || "book", idea: sh.idea || "", fromLearning: true, snippets: null };
  ctx.store.learningSnippets(sh.src).then((snippets) => { if (F.pick?.fromLearning && F.growthEdit === "new") { F.pick = { ...F.pick, snippets }; draw(); } });
}
const backToLearning = (msg) => { ctx.S.view = "learning"; ctx.renderApp(); if (msg) flash(msg); };

function shareForm(g) {
  const F = ctx.S.fam, pick = F.pick || {};
  const canPick = !!ctx.store.learnGh;
  const kinds = Object.entries(KINDS).map(([k, l]) => `<option value="${k}"${(g?.source?.kind || pick.kind || "book") === k ? " selected" : ""}>${l}</option>`).join("");
  return `<div class="fm-share" data-id="${g?.id || "new"}">
    ${canPick && !g ? `<div class="fm-picker"><span class="fm-kicker">Start from your Learning library</span>
      ${pick.fromLearning ? `<p class="fm-from">From <b>${esc(pick.src?.title || "")}</b>${pick.src?.author ? ` · ${esc(pick.src.author)}` : ""} · <button class="fm-link" data-act="cancel">Back to Learning</button></p>`
        : pick.sources ? `<select data-act="picksource"><option value="">Choose a book, podcast or article…</option>${pick.sources.map((s) => `<option value="${esc(s.id)}"${pick.src?.id === s.id ? " selected" : ""}>${esc(s.title)}${s.author ? ` · ${esc(s.author)}` : ""}</option>`).join("")}</select>`
        : `<button class="fm-btn sm" data-act="loadsources">${pick.loading ? "Loading…" : "Choose from my library"}</button>`}
      ${pick.fromLearning && !pick.snippets ? `<p class="sub">Loading its insights and thoughts…</p>` : ""}
      ${pick.snippets ? (pick.snippets.length ? `<p class="sub">Tap the part you want to share; it goes into the idea below for you to put in your own words.</p><ul class="fm-snips">${pick.snippets.map((x, i) => `<li><button type="button" data-act="picksnip" data-i="${i}"><span class="fm-type">${esc(x.kind)}${x.page ? ` · p. ${esc(x.page)}` : ""}</span>${esc(x.text)}</button></li>`).join("")}</ul>` : `<p class="sub">Nothing to pick from this one yet.</p>`) : ""}</div>` : ""}
    <div class="fam-form"><input data-g="title" placeholder="A short title, e.g. Change the game, not the score" value="${esc(g?.title || pick.title || "")}"></div>
    <div class="fam-form"><select data-g="kind">${kinds}</select><input data-g="sourcename" placeholder="Book / podcast / article name" value="${esc(g?.source?.name || pick.src?.title || "")}"><input data-g="author" class="short" placeholder="Author or host" value="${esc(g?.source?.author || pick.src?.author || "")}"></div>
    <label class="fm-fld"><span>The idea · in your own words</span><textarea data-g="idea" rows="4">${esc(g?.idea || pick.idea || "")}</textarea></label>
    <label class="fm-fld"><span>Why you're sharing it · how it relates to us (optional)</span><textarea data-g="why" rows="2">${esc(g?.why || "")}</textarea></label>
    <label class="fm-fld"><span>Questions to reflect on · one per line</span><textarea data-g="questions" rows="3" placeholder="e.g. Where are we playing someone else's game?">${esc((g?.questions || []).join("\n"))}</textarea></label>
    <div class="fm-btnrow"><button class="fm-btn pri" data-act="savegrowth" data-id="${g?.id || "new"}">${g ? "Save" : "Share with " + esc(ctx.S.fam.me === "lokesh" ? "Archana" : "Lokesh")}</button><button class="fm-btn" data-act="cancel">Cancel</button></div>
  </div>`;
}

/* ── Home ────────────────────────────────────────────────── */

function home(D, C) {
  const H = C.home, today = todayISO();
  return `<div class="fm-bento">
    <div class="fm-tile s2"><h3>To-dos · ${H.todos.length} open</h3>
      <div class="fam-form"><input name="text" placeholder="Add a to-do"><input type="date" name="due" class="short">${whoSelect(C)}<button class="fm-btn sm pri" data-act="addtodo">Add</button></div>
      ${H.todos.length ? `<ul class="fam-list checks">${H.todos.map((t) => `<li class="${t.due && t.due < today ? "late" : ""}"><label><input type="checkbox" data-act="todo" data-id="${t.id}"> ${esc(t.text)}</label><span class="sub">${esc(C.name(t.who || "both"))}${t.due ? ` · ${fmtD(t.due)}` : ""}</span></li>`).join("")}</ul>` : empty("All done.")}
      ${H.done7 ? `<p class="sub">${H.done7} done this week.</p>` : ""}</div>
    <div class="fm-tile s2"><h3>Chores</h3>
      ${H.chores.length ? `<ul class="fam-list">${H.chores.map((c) => `<li class="${c.due ? "late" : ""}"><span><b>${esc(c.text)}</b> · ${esc(C.name(c.who || "both"))} · ${c.every}</span><span class="sub">${c.due ? "due" : `next ${fmtD(c.next)}`}</span><button class="fm-link" data-act="chore" data-id="${c.id}">Done today</button></li>`).join("")}</ul>` : empty("Recurring jobs around the house.")}
      <div class="fam-form"><input name="text" placeholder="e.g. Change HVAC filter">${whoSelect(C)}<select name="every"><option value="weekly">Weekly</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select><button class="fm-btn sm pri" data-act="addchore">Add</button></div></div>
    <div class="fm-tile s4"><h3>Appointments &amp; things to get done</h3>
      ${H.appointments.length ? `<ul class="fam-list">${H.appointments.map((a) => `<li><span class="d">${fmtD(a.date)}${a.time ? ` ${esc(a.time)}` : ""}</span><span>${esc(a.what)} · ${esc(C.name(a.who || "both"))}</span><button class="fm-link" data-act="appdone" data-id="${a.id}">Done</button></li>`).join("")}</ul>` : empty("Doctor's visits, car service, contractor, renewals: anything with a date.")}
      <div class="fam-form"><input type="date" name="date" class="short"><input name="time" placeholder="Time" class="tiny"><input name="what" placeholder="What">${whoSelect(C)}<button class="fm-btn sm pri" data-act="addappt">Add</button></div></div>
  </div>`;
}

/* ── events ──────────────────────────────────────────────── */

async function save(key, mutate, msg) {
  const [path, dflt] = FILES[key];
  await ctx.store.update(path, dflt, mutate, `family: ${msg}`);
  draw();
}
const form = (t) => t.closest(".fam-form, .fam-health, .fam-kid") || document;
// The ingredient editor's rows, read back into the draft before it redraws.
function readIngs(root, F) {
  if (!F.editDraft) return;
  root.ownerDocument.querySelectorAll(".fm-ingedit li").forEach((li) => { const g = F.editDraft[+li.dataset.row]; if (!g) return;
    li.querySelectorAll("[data-f]").forEach((el) => { g[el.dataset.f] = el.value; }); });
}
// The compass screen's text boxes, read back into the draft before it redraws.
function readCompass(root, d) {
  if (!d) return;
  root.ownerDocument.querySelectorAll(".fm-focusscreen [data-look]").forEach((el) => { const v = d.values[+el.dataset.look]; if (v) v.looksLike = el.value; });
  const m = root.ownerDocument.querySelector(".fm-focusscreen [data-mission]"); if (m) d.mission = m.value;
}
const val = (box, name) => box.querySelector(`[name=${name}]`)?.value?.trim() || "";

async function startRun(kind, arg) {
  const F = ctx.S.fam;
  try {
    const r = await fireRoutine(kind === "finance" ? "family finance" : `family read ${arg}`);
    F.run = { kind, url: r.sessionUrl || null, at: Date.now() };
    flash(kind === "finance" ? "Syncing from Monarch. Tap Check now in a few minutes." : "Drafting this week's read. Tap Check now in a few minutes.");
  } catch (e) {
    flash(e instanceof RoutineError ? e.message : "Couldn't start it: " + (e.message || e), true);
  }
  draw();
}

function wire(root, D, C) {
  const F = ctx.S.fam;
  root.addEventListener("input", (e) => {
    const t = e.target, sel = t.matches("[data-pastsearch]") ? "[data-pastsearch]" : t.matches("[data-dishsearch]") ? "[data-dishsearch]" : null; if (!sel) return;
    clearTimeout(F.pastTimer);
    F.pastTimer = setTimeout(() => { F.pastTimer = null; if (sel === "[data-pastsearch]") F.pastQ = t.value; else F.pickQ = t.value; draw(); const n = document.querySelector(sel); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250);
  });
  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.nutnote) { const date = t.dataset.nutnote, note = t.value.trim(); await save("nutrition", (n) => { const meals = { ...(n.meals || {}) }, m = { ...(meals[date] || {}) }; if (note) m.note = note; else delete m.note; meals[date] = m; return { ...n, meals }; }, "meal note"); return; }
    if (t.dataset.act === "todo" && t.checked) await save("home", (h) => ({ ...h, todos: h.todos.map((x) => (x.id === t.dataset.id ? { ...x, done: true, doneAt: todayISO() } : x)) }), "to-do done");
    else if (t.dataset.act === "picksource") {
      const src = (F.pick?.sources || []).find((x) => x.id === t.value); if (!src) return;
      const b = t.closest(".fm-share"), keep = (k) => b.querySelector(`[data-g=${k}]`)?.value || "";
      const kind = { book: "book", podcast: "podcast", article: "article", youtube: "video", video: "video", course: "video" }[src.type] || "book";
      F.pick = { ...F.pick, src, kind, snippets: null, title: keep("title"), idea: keep("idea") }; draw();
      F.pick = { ...F.pick, snippets: await ctx.store.learningSnippets(src) }; draw();
    }
    else if (t.dataset.act === "goalstatus") { const kid = t.closest(".fam-kid").dataset.kid; await save("kids", (k) => { k[kid].goals = k[kid].goals.map((g) => (g.id === t.dataset.id ? { ...g, status: t.value } : g)); return k; }, "kid goal"); }
  });
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab],[data-act],[data-val]");
    if (!t || t.disabled || t.tagName === "SELECT" || t.type === "checkbox") return;
    // A search still waiting to redraw would wipe what's typed next (e.g. a dish's ingredients): settle it now.
    if (F.pastTimer) { clearTimeout(F.pastTimer); F.pastTimer = null; const ps = root.querySelector("[data-pastsearch]"), ds = root.querySelector("[data-dishsearch]"); if (ps) F.pastQ = ps.value; if (ds) F.pickQ = ds.value; }
    if (t.dataset.tab) { F.tab = t.dataset.tab; F.notesEdit = F.logEdit = null; F.kidFocus = null; draw(); window.scrollTo(0, 0); return; }
    if (t.dataset.val !== undefined && t.closest(".fm-seg")) { t.closest(".fm-seg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t))); return; }
    const act = t.dataset.act, box = form(t), today = todayISO();
    const kid = t.closest(".fam-kid")?.dataset.kid;
    const ensureKid = (k) => { k[kid] = k[kid] || { appointments: [], goals: [], observations: [] }; return k[kid]; };
    if (act === "reload") { ctx.store.reviews.clear(); F.loaded = false; F.run = null; return renderFamilyView(ctx.store, ctx.S, ctx.renderApp); }
    if (act === "tag" || act === "obstype") { const on = act === "obstype" || t.getAttribute("aria-pressed") !== "true"; t.closest(".fm-tags").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t && on))); return; }
    if (act === "saveretire") {
      const b = t.closest(".rt-set"), num = (el) => (el.value.trim() === "" ? null : +el.value.replace(/[$,%\s]/g, ""));
      const get = (k) => { const el = b.querySelector(`[data-rt=${k}]`); return el ? num(el) : undefined; };
      const years = [...b.querySelectorAll("[data-rt=birthYear]")].map(num), ssM = [...b.querySelectorAll("[data-rt=ssMonthly]")].map(num), ssA = [...b.querySelectorAll("[data-rt=ssAge]")].map(num);
      if (ssA.some((a) => a != null && (a < 62 || a > 70))) return flash("Social Security can start between 62 and 70.", true);
      if (years.some((y) => y != null && (y < 1930 || y > 2010))) return flash("Birth year looks off, e.g. 1977.", true);
      const ret = get("realReturn"), ssOn = b.querySelector("[data-rt=includeSocialSecurity]")?.checked;
      return save("config", (c) => { const rc = c.finance?.retirement || {};
        return { ...c, finance: { ...(c.finance || {}), retirement: { ...rc, people: (rc.people || []).map((p, i) => ({ ...p, birthYear: years[i] ?? null, ssMonthly: ssM[i] ?? null, ssAge: ssA[i] ?? null })),
          retireAge: get("retireAge") ?? rc.retireAge ?? null, monthlyGoal: get("monthlyGoal") ?? rc.monthlyGoal ?? null, realReturn: ret != null ? ret / 100 : rc.realReturn ?? 0.05, includeSocialSecurity: ssOn !== false } } }; }, "retirement goal");
    }
    if (act === "nutpick") { F.nutPick = { date: t.dataset.date, slot: t.dataset.slot }; F.pickSel = (D.nutrition?.meals || {})[t.dataset.date]?.[`${t.dataset.slot}Id`] || null; F.pickQ = ""; F.pickAll = false; window.scrollTo(0, 0); return draw(); }
    if (act === "pickback") { F.nutPick = null; F.pickSel = null; return draw(); }
    if (act === "picktab") { F.pickTab = t.dataset.t; F.pickQ = ""; return draw(); }
    if (act === "pickall") { F.pickAll = !F.pickAll; return draw(); }
    if (act === "pickdish") { F.pickSel = t.dataset.id; F.editDish = null; F.editDraft = null; return draw(); }
    if (act === "editdish") { F.editDish = t.dataset.id; F.editDraft = null; return draw(); }
    if (act === "canceledit") { F.editDish = null; F.editDraft = null; return draw(); }
    if (act === "ingadd" || act === "ingdel") { readIngs(root, F); if (act === "ingadd") F.editDraft.push({ item: "", qty: 1, unit: "", aisle: "Other" }); else F.editDraft.splice(+t.dataset.i, 1); return draw(); }
    if (act === "copyings") { const d = dishById(D, t.dataset.id); try { await navigator.clipboard.writeText(dishText(d)); flash("Ingredients copied."); } catch { flash("Couldn't copy on this device.", true); } return; }
    if (act === "saveings" || act === "resetings") {
      if (act === "saveings") readIngs(root, F);
      const id = F.editDish || F.pickSel, ds = dishById(D, id);
      const ings = act === "resetings" ? null : F.editDraft.filter((g) => g.item.trim()).map((g) => ({ item: g.item.trim().toLowerCase(), qty: +g.qty || 0, unit: g.unit || "", aisle: AISLES.includes(g.aisle) ? g.aisle : "Other" }));
      if (ings && !ings.length) return flash("Keep at least one ingredient.", true);
      F.editDish = null; F.editDraft = null;
      await ctx.store.update(FILES.recipes[0], FILES.recipes[1], (r) => {
        if (ds.source === "lookup") return { ...r, dishes: (r.dishes || []).map((x) => (x.id === id ? { ...x, ingredients: ings || x.ingredients } : x)) };
        const ov = { ...(r.overrides || {}) }; if (ings) ov[id] = { ingredients: ings }; else delete ov[id]; return { ...r, overrides: ov };
      }, `family: ${act === "resetings" ? "original ingredients for" : "edited ingredients of"} ${ds.name}`);
      flash(act === "resetings" ? "Back to the original ingredients." : "Ingredients saved. The grocery list uses them from now on."); return draw();
    }
    if (act === "adddish" || act === "quickmeal" || act === "nutclear") {
      const P = act === "nutclear" ? { date: t.dataset.date, slot: t.dataset.slot } : F.nutPick, ds = act === "adddish" ? dishById(D, t.dataset.id) : null;
      const name = act === "quickmeal" ? t.dataset.v : ds?.name || null;
      if (act !== "nutclear") { F.nutPick = null; F.pickSel = null; flash(`${name} added${ds ? "; ingredients are on the grocery list" : ""}.`); }
      if (ds?.source === "lookup" && !ds.confirmed) await ctx.store.update(FILES.recipes[0], FILES.recipes[1], (r) => ({ ...r, dishes: (r.dishes || []).map((x) => (x.id === ds.id ? { ...x, confirmed: true } : x)) }), `family: added ${ds.name} to our dishes`);
      return save("nutrition", (n) => { const meals = { ...(n.meals || {}) }, m = { ...(meals[P.date] || {}) };
        if (name) { m[P.slot] = name; if (ds) m[`${P.slot}Id`] = ds.id; else delete m[`${P.slot}Id`]; } else { delete m[P.slot]; delete m[`${P.slot}Id`]; }
        if (Object.keys(m).length) meals[P.date] = m; else delete meals[P.date]; return { ...n, meals }; }, "meal plan");
    }
    if (act === "lookupdish") { const name = val(box, "lookupname"); if (!name) return;
      const id = "l" + newId(), slot = F.nutPick?.slot || null;
      await ctx.store.update(FILES.recipes[0], FILES.recipes[1], (r) => ({ ...r, lookups: [...(r.lookups || []), { id, name, slot, requestedAt: new Date().toISOString(), status: "pending" }] }), `family: look up ${name}`);
      try { await fireRoutine(`family dish ${id}`); flash(`Looking up ${name}. It'll show here in a few minutes; tap Check now.`); }
      catch (e) { flash(e instanceof RoutineError ? e.message : `Couldn't start the lookup: ${e.message}`, true); }
      return draw(); }
    if (act === "checklookups") { await ctx.store.refresh?.(FILES.recipes[0]); F.loaded = false; return renderFamilyView(ctx.store, ctx.S, ctx.renderApp); }
    if (act === "grochave" || act === "grocadd" || act === "grocdel") {
      const wk = C.nutrition.plan.start, item = act === "grocadd" ? val(box, "grocitem") : null; if (act === "grocadd" && !item) return;
      return save("nutrition", (n) => { const g = { ...(n.grocery || {}) }, w = { have: [], extra: [], ...(g[wk] || {}) };
        if (act === "grochave") w.have = w.have.includes(t.dataset.k) ? w.have.filter((x) => x !== t.dataset.k) : [...w.have, t.dataset.k];
        if (act === "grocadd") w.extra = [...w.extra, { id: newId(), item }];
        if (act === "grocdel") { w.extra = w.extra.filter((x) => x.id !== t.dataset.id); w.have = w.have.filter((x) => x !== `x:${t.dataset.id}`); }
        g[wk] = w; return { ...n, grocery: g }; }, "grocery list"); }
    if (act === "groccopy" || act === "grocshare") {
      const N = C.nutrition, G = (D.nutrition?.grocery || {})[N.plan.start] || {};
      const text = groceryText(groceryList(D, N.plan.days), G.have || [], G.extra || [], `Groceries for ${fmtD(N.plan.start)} – ${fmtD(addDays(N.plan.start, 6))}`);
      if (act === "grocshare") { try { await navigator.share({ title: "Grocery list", text }); } catch {} return; }
      try { await navigator.clipboard.writeText(text); flash("Copied. Paste it into your shopping list."); } catch { flash("Couldn't copy on this device.", true); }
      return; }
    if (act === "nuttab") { F.nutTab = t.dataset.t; return draw(); }
    if (act === "nutfav") { const empty = [...root.querySelectorAll(".fm-nutplan [data-meal=dinner]")].find((i) => !i.value.trim()); if (!empty) return flash("Every night already has a dinner."); empty.value = t.dataset.v; empty.focus(); return; }
    if (act === "saveplan") { const vals = [...root.querySelectorAll(".fm-nutplan [data-meal]")].map((i) => [i.dataset.date, i.dataset.meal, i.value.trim()]);
      flash("Meal plan saved.");
      return save("nutrition", (n) => { const meals = { ...(n.meals || {}) }; for (const [d, k, v] of vals) { const m = { ...(meals[d] || {}) }; if (v) m[k] = v; else delete m[k]; if (Object.keys(m).length) meals[d] = m; else delete meals[d]; } return { ...n, meals }; }, "meal plan"); }
    if (act === "nutset") { const { date, k, v } = t.dataset; return save("nutrition", (n) => { const meals = { ...(n.meals || {}) }, m = { ...(meals[date] || {}) }; m[k] = m[k] === v ? undefined : v; if (k === "status" && m.status !== "cooked") delete m.again; meals[date] = JSON.parse(JSON.stringify(m)); return { ...n, meals }; }, "meal review"); }
    if (act === "pastmode") { F.pastMode = t.dataset.m; F.pastWeek = null; return draw(); }
    if (act === "pastmonth") { F.pastMonth = t.dataset.m; return draw(); }
    if (act === "pastweek") { F.pastWeek = t.dataset.w || null; if (t.dataset.tomode) F.pastMode = t.dataset.tomode; if (t.dataset.clear) F.pastQ = ""; window.scrollTo(0, 0); return draw(); }
    if (act === "usfocus") { F.usFocus = t.dataset.f; F.valDraft = F.compDraft = null; window.scrollTo(0, 0); return draw(); }
    if (act === "usback") { F.usFocus = null; F.valDraft = F.compDraft = null; return draw(); }
    if (act === "pickvalue") { const v = t.dataset.v, d = F.valDraft || []; F.valDraft = d.includes(v) ? d.filter((x) => x !== v) : d.length < 10 ? [...d, v] : d; if (d.length >= 10 && !d.includes(v)) flash("Ten is the most. Tap one to swap it out."); return draw(); }
    if (act === "compvalue") { const d = F.compDraft; readCompass(root, d); const v = t.dataset.v; d.values = d.values.some((x) => x.name === v) ? d.values.filter((x) => x.name !== v) : [...d.values, { name: v, looksLike: "" }]; return draw(); }
    if (act === "thanksto") { F.thanksTo = t.dataset.to; return draw(); }
    if (act === "meetkind") { F.meetKind = t.dataset.k; return draw(); }
    if (act === "plankind") { F.planKind = t.dataset.k; return draw(); }
    if (["savevalues", "savecompass", "answerq", "revealq", "savethanks", "savemeeting", "addplan", "raiseissue", "delgrowing", "keptritual", "addritual"].includes(act)) {
      const M = meetDates(D, today), me = F.me, other = me === "lokesh" ? "archana" : "lokesh", scr = t.closest(".fm-focusscreen") || box;
      const v = (n) => scr.querySelector(`[name=${n}]`)?.value?.trim() || "";
      const grow = (r, fn) => { const g = { ...(r.growing || {}) }; g[M.next] = fn({ plans: [], issues: [], ...(g[M.next] || {}) }); return { ...r, growing: g }; };
      const done = (msg) => { F.usFocus = null; F.valDraft = F.compDraft = null; if (msg) flash(msg); };
      if (act === "savevalues") { const picks = F.valDraft || []; done(`Saved. ${C.name(other)} won't see them until you've both picked.`); return save("rel", (r) => ({ ...r, valuePicks: { ...(r.valuePicks || {}), [me]: picks } }), "value picks"); }
      if (act === "savecompass") { const d = F.compDraft; readCompass(root, d); const vals = d.values.filter((x) => x.name); if (!vals.length) return; done("Your family compass is saved."); return save("rel", (r) => ({ ...r, compass: { mission: d.mission.trim(), values: vals.map((x) => ({ name: x.name, looksLike: (x.looksLike || "").trim() })), setAt: today } }), "family compass"); }
      if (act === "answerq") { const text = v("answer"); if (!text) return; done(`Saved. It unlocks when ${C.name(other)} answers too.`);
        return save("rel", (r) => { const qs = r.questions || [], cur = qs.find((q) => q.week === M.next) || { week: M.next, text: qFor(M.next), answers: {} };
          const upd = { ...cur, answers: { ...(cur.answers || {}), [me]: { text, at: new Date().toISOString() } } };
          return { ...r, questions: [...qs.filter((q) => q.week !== M.next), upd] }; }, "question of the week"); }
      if (act === "revealq") return save("rel", (r) => ({ ...r, questions: (r.questions || []).map((q) => (q.week === M.next ? { ...q, revealed: true, revealedAt: today } : q)) }), "read the week's answers");
      if (act === "savethanks") { const text = v("text"); if (!text) return; const to = F.thanksTo || other; done("Thank you saved."); return save("rel", (r) => ({ ...r, appreciation: [...(r.appreciation || []), { id: newId(), date: today, from: me, to, text }] }), "appreciation"); }
      if (act === "savemeeting" || act === "addplan" || act === "raiseissue") {
        const issue = act === "raiseissue" || (act === "savemeeting" && (F.meetKind || "plan") === "issue");
        if (issue) { const text = v("issue"); if (!text) return; done(`Saved for ${TALK}.`); return save("rel", (r) => grow(r, (g) => ({ ...g, issues: [...g.issues, { id: newId(), by: me, date: today, text }] })), "growing together: on my mind"); }
        const what = v("what"); if (!what) return; const kind = act === "addplan" ? v("kind") || "us" : F.planKind || "us"; done(`Saved for ${TALK}.`);
        return save("rel", (r) => grow(r, (g) => ({ ...g, plans: [...g.plans, { id: newId(), by: me, kind, what, when: v("when") }] })), "growing together: plan");
      }
      if (act === "delgrowing") return save("rel", (r) => grow(r, (g) => ({ ...g, [t.dataset.list]: (g[t.dataset.list] || []).filter((x) => x.id !== t.dataset.id) })), "growing together: removed");
      if (act === "keptritual") return save("rel", (r) => { const log = { ...(r.ritualLog || {}) }, wk = C.week, cur = log[wk] || []; log[wk] = cur.includes(t.dataset.id) ? cur.filter((x) => x !== t.dataset.id) : [...cur, t.dataset.id]; return { ...r, ritualLog: log }; }, "ritual");
      if (act === "addritual") { const text = val(box, "ritual"); if (!text) return; return save("rel", (r) => ({ ...r, rituals: [...(r.rituals || []), { id: newId(), text, every: val(box, "every") || "weekly" }] }), "ritual added"); }
    }
    if (act === "talknotes") { F.tab = "hq"; draw(); setTimeout(() => root.ownerDocument.querySelector(".fm-notes")?.scrollIntoView({ behavior: "smooth" }), 50); return; }
    if (act === "pyfrange") { F[t.dataset.scope === "navya" ? "nvRange" : "pyfRange"] = t.dataset.range; return draw(); }
    if (act === "opennavya") { ctx.S.view = "navya"; return ctx.renderApp(); }
    if (act === "draftread") return startRun("read", sundayOf(today));
    if (act === "syncmoney") return startRun("finance");
    if (act === "approveread") { await ctx.store.update(`review/${t.dataset.week}.json`, null, (r) => withSnapshot(t.dataset.week)({ ...r, status: "approved", approvedAt: new Date().toISOString() }), `family: read ${t.dataset.week} approved`); return draw(); }
    if (act === "editreview") { F.notesEdit = t.dataset.week; F.logEdit = null; return draw(); }
    if (act === "editlog") { F.logEdit = t.dataset.id; F.notesEdit = null; return draw(); }
    if (act === "cancel") { const back = F.pick?.fromLearning; F.notesEdit = F.logEdit = F.growthEdit = F.reflectEdit = F.discussing = null; F.pick = null; return back ? backToLearning() : draw(); }
    if (["savereview", "addlog", "savelog", "dellog"].includes(act)) {
      const b = t.closest(".fm-logadd, li, .fm-note") || root, v = (s) => b.querySelector(s)?.value?.trim() || "";
      const tag = b.querySelector(".fm-tags [aria-pressed=true]")?.dataset.tag || null;
      let mutate;
      if (act === "savereview") { const discussed = v("[data-notes=discussed]"), changes = (b.querySelector("[data-notes=changes]")?.value || "").split("\n").map((x) => x.trim()).filter(Boolean); mutate = (n) => ({ ...n, discussed, changes, updatedAt: new Date().toISOString() }); }
      else if (act === "addlog") { const text = v("[data-log=text]"); if (!text) return; mutate = (n) => ({ ...n, log: [...(n.log || []), { id: newId(), date: today, by: F.me, text, tag }] }); }
      else if (act === "savelog") { const text = v("[data-logedit=text]"); if (!text) return; mutate = (n) => ({ ...n, log: (n.log || []).map((x) => (x.id === t.dataset.id ? { ...x, text, tag } : x)) }); }
      else mutate = (n) => ({ ...n, log: (n.log || []).filter((x) => x.id !== t.dataset.id) });
      t.disabled = true; F.notesEdit = F.logEdit = null;
      await ctx.store.update(`review/${t.dataset.week}.json`, reviewDefault(t.dataset.week), (r) => withSnapshot(t.dataset.week)({ ...r, notes: mutate(r.notes || {}) }), `family: week ${t.dataset.week} notes`);
      flash(act === "dellog" ? "Note deleted." : "Notes saved."); return draw();
    }
    // ── money
    if (act === "savewatch") return save("config", (c) => ({ ...c, finance: { ...(c.finance || {}), watch: val(box, "watch").split(",").map((x) => x.trim()).filter(Boolean) } }), "watched categories");
    // ── us
    if (act === "addtogether") { const what = val(box, "what"); if (!what) return; return save("rel", (r) => ({ ...r, together: [...(r.together || []), { id: newId(), date: val(box, "date") || today, kind: val(box, "kind") || "us", what }] }), "time together"); }
    if (act === "addappreciation") { const text = val(box, "text"); if (!text) return; return save("rel", (r) => ({ ...r, appreciation: [...(r.appreciation || []), { id: newId(), date: today, from: F.me, to: val(box, "to"), text }] }), "appreciation"); }
    if (act === "addgoal") { const text = val(box, "text"); if (!text) return; return save("rel", (r) => ({ ...r, goals: [...(r.goals || []), { id: newId(), text, added: today }] }), "relationship goal"); }
    if (act === "addlearning") { const text = val(box, "text"); if (!text) return; return save("rel", (r) => ({ ...r, learnings: [...(r.learnings || []), { id: newId(), date: today, source: val(box, "source"), text }] }), "learning"); }
    if (act === "addperson") { const name = val(box, "name"), bd = val(box, "birthday"); if (!name) return; if (bd && !/^\d{2}-\d{2}$/.test(bd)) return flash("Birthday as MM-DD, e.g. 03-14.", true); return save("rel", (r) => ({ ...r, people: [...(r.people || []), { id: newId(), name, relation: val(box, "relation"), ...(bd ? { birthday: bd } : {}) }] }), "person"); }
    if (act === "contacted") return save("rel", (r) => ({ ...r, people: r.people.map((p) => (p.id === t.dataset.id ? { ...p, lastContact: today } : p)) }), "in touch");
    if (act === "del") return save(t.dataset.file, (r) => ({ ...r, [t.dataset.list]: (r[t.dataset.list] || []).filter((x) => x.id !== t.dataset.id) }), `removed from ${t.dataset.list}`);
    // ── health
    if (act === "savehealth") {
      const num = (n) => { const x = val(box, n); return x === "" ? null : +x; };
      const scale = (n) => +(box.querySelector(`[data-field=${n}] [aria-pressed=true]`)?.dataset.val || 0) || null;
      const entry = { weekStart: C.week, person: t.dataset.person, sleepHours: num("sleepHours"), exerciseDays: num("exerciseDays"), eating: scale("eating"), energy: scale("energy"), ...(num("weight") != null ? { weight: num("weight") } : {}), ...(val(box, "note") ? { note: val(box, "note") } : {}) };
      await save("health", (h) => ({ ...h, entries: [...(h.entries || []).filter((x) => !(x.weekStart === entry.weekStart && x.person === entry.person)), entry] }), `health ${entry.person}`);
      return flash("Saved.");
    }
    // ── kids
    if (act === "namekid") { const name = val(t.closest(".fam-form"), "kidname"); if (!name) return; return save("config", (c) => ({ ...c, kids: c.kids.map((k) => (k.id === kid ? { ...k, name } : k)) }), "kid's name"); }
    if (act === "addkidappt") { const b = t.closest(".fam-form"), what = val(b, "what"), date = val(b, "date"); if (!what || !date) return flash("Add a date and what it is.", true); return save("kids", (k) => { ensureKid(k).appointments.push({ id: newId(), date, ...(val(b, "time") ? { time: val(b, "time") } : {}), what, done: false }); return k; }, `${kid} appointment`); }
    if (act === "kiddone") return save("kids", (k) => { ensureKid(k).appointments = k[kid].appointments.map((a) => (a.id === t.dataset.id ? { ...a, done: true } : a)); return k; }, `${kid} appointment done`);
    if (act === "addkidgoal") { const b = t.closest(".fam-form"), text = val(b, "text"); if (!text) return; return save("kids", (k) => { ensureKid(k).goals.push({ id: newId(), area: val(b, "area"), text, status: "working" }); return k; }, `${kid} goal`); }
    if (act === "kidfocus") { const first = C.kids.find((k) => !k.unnamed); if (!first) return flash("Add the kids' names first.", true);
      F.kidFocus = t.dataset.f; F.kidId = t.dataset.kid || first.id; F.kn = { kid: t.dataset.kid || first.id, type: t.dataset.type || "encourage", trait: null, note: "" }; F.hopeDraft = F.ktDraft = null; window.scrollTo(0, 0); return draw(); }
    if (act === "kidback") { F.kidFocus = null; F.hopeDraft = F.ktDraft = null; return draw(); }
    if (act === "knset") { const n = F.kn; n.note = root.ownerDocument.querySelector(".fm-focusscreen [name=note]")?.value || ""; const { k, v } = t.dataset;
      if (k === "trait") n.trait = n.trait === v ? null : v; else { n[k] = v; if (k === "kid") n.trait = null; } return draw(); }
    if (act === "savenotice") { const n = F.kn, note = root.ownerDocument.querySelector(".fm-focusscreen [name=note]")?.value?.trim() || "";
      if (!note && !n.trait) return flash("Choose a value or write what you saw.", true);
      const who = n.kid; F.kidFocus = null; flash(n.type === "encourage" ? `Glow saved for ${C.name(who)}.` : `Saved. You'll look at it together at ${TALK}.`);
      return save("kids", (k) => { k[who] = k[who] || { appointments: [], goals: [], observations: [] }; k[who].observations = [...(k[who].observations || []), { id: newId(), date: today, by: F.me, trait: n.trait || "", type: n.type, note }]; return k; }, `${who} ${GLOW[n.type].toLowerCase()}`); }
    if (act === "hopepick") { const v = t.dataset.v, d = F.hopeDraft || []; if (!d.includes(v) && d.length >= 3) { flash("Three is the most. Tap one to swap it out."); return; } F.hopeDraft = d.includes(v) ? d.filter((x) => x !== v) : [...d, v]; return draw(); }
    if (act === "savehopes") { const who = F.kidId, h = F.hopeDraft || []; F.kidFocus = null; F.hopeDraft = null; flash("Saved.");
      return save("kids", (k) => { k[who] = { appointments: [], goals: [], observations: [], ...(k[who] || {}), hopes: h }; return k; }, `${who} values to focus on`); }
    if (act === "ktresult") { readKidTalk(root); const { kid: who, w, r } = t.dataset;
      return save("kids", (k) => { const T = { ...(k[who].talks || {}) }; T[w] = { ...T[w], result: T[w].result === r ? undefined : r }; if (!T[w].result) delete T[w].result; k[who].talks = T; return k; }, `${who} follow-up`); }
    if (act === "savekidtalk") { readKidTalk(root); const M = meetDates(D, today), dr = F.ktDraft || {}; F.kidFocus = null; F.ktDraft = null; flash(`Saved for ${TALK}.`);
      return save("kids", (k) => { for (const [who, d] of Object.entries(dr)) { const kd = (k[who] = k[who] || { appointments: [], goals: [], observations: [] }), T = { ...(kd.talks || {}) };
        const entry = { ...(T[M.next] || {}), callOut: d.callOut, ...(d.plan || d.trait ? { workOn: { trait: d.trait, plan: d.plan } } : {}) };
        if (!entry.callOut) delete entry.callOut; if (!d.plan && !d.trait) delete entry.workOn;
        if (Object.keys(entry).length) T[M.next] = entry; else delete T[M.next]; kd.talks = T; } return k; }, `kids talk ${M.next}`); }
    if (act === "delobs") return save("kids", (k) => { ensureKid(k).observations = k[kid].observations.filter((o) => o.id !== t.dataset.id); return k; }, `${kid} observation removed`);
    // ── growth
    if (act === "newgrowth") { F.growthEdit = "new"; F.pick = {}; return draw(); }
    if (act === "editgrowth") { F.growthEdit = t.dataset.id; return draw(); }
    if (act === "opengrowth") { F.openGrowth = F.openGrowth === t.dataset.id ? null : t.dataset.id; return draw(); }
    if (act === "loadsources") { F.pick = { ...(F.pick || {}), loading: true }; draw(); const sources = await ctx.store.learningSources(); F.pick = { ...F.pick, loading: false, sources }; if (!sources.length) flash("Couldn't open your Learning library from this device.", true); return draw(); }
    if (act === "picksnip") {
      const x = F.pick.snippets[+t.dataset.i], b = t.closest(".fm-share"), keep = (k) => b.querySelector(`[data-g=${k}]`)?.value || "";
      const cur = keep("idea").trim();
      F.pick = { ...F.pick, title: keep("title"), idea: cur ? `${cur}\n\n${x.text}` : x.text };
      return draw();
    }
    if (act === "savegrowth") {
      const b = t.closest(".fm-share"), v = (k) => b.querySelector(`[data-g=${k}]`)?.value?.trim() || "";
      const title = v("title"), idea = v("idea");
      if (!title || !idea) return flash("Add a short title and the idea.", true);
      const fields = { title, idea, why: v("why"), questions: v("questions").split("\n").map((x) => x.trim()).filter(Boolean),
        source: { kind: v("kind") || "thought", ...(v("sourcename") ? { name: v("sourcename") } : {}), ...(v("author") ? { author: v("author") } : {}), ...(F.pick?.src && t.dataset.id === "new" ? { ref: F.pick.src.id } : {}) } };
      const id = t.dataset.id, fromLearning = !!F.pick?.fromLearning;
      F.growthEdit = null; F.pick = null;
      if (fromLearning) { await ctx.store.update(FILES.growth[0], FILES.growth[1], (gr) => ({ ...gr, items: [...(gr.items || []), { id: newId(), date: today, from: F.me, ...fields, status: "open", reflections: [] }] }), "family: shared an idea"); return backToLearning("Shared with Archana. It's in Family → Growth."); }
      return save("growth", (gr) => ({ ...gr, items: id === "new" ? [...(gr.items || []), { id: newId(), date: today, from: F.me, ...fields, status: "open", reflections: [] }] : (gr.items || []).map((x) => (x.id === id ? { ...x, ...fields } : x)) }), id === "new" ? "shared an idea" : "idea edited");
    }
    if (act === "delgrowth") return save("growth", (gr) => ({ ...gr, items: (gr.items || []).filter((x) => x.id !== t.dataset.id) }), "idea removed");
    if (act === "editreflect") { F.reflectEdit = t.dataset.id; return draw(); }
    if (act === "savereflect") {
      const text = t.closest(".fm-idea").querySelector("[data-g=reflection]")?.value?.trim(); if (!text) return;
      F.reflectEdit = null;
      return save("growth", (gr) => ({ ...gr, items: gr.items.map((x) => (x.id !== t.dataset.id ? x : { ...x, reflections: [...(x.reflections || []).filter((r) => r.by !== F.me), { id: newId(), by: F.me, date: today, text }] })) }), "reflection");
    }
    if (act === "startdiscussed") { F.discussing = t.dataset.id; return draw(); }
    if (act === "discussed") {
      const takeaway = t.closest(".fm-idea").querySelector("[data-g=takeaway]")?.value?.trim() || "";
      F.discussing = null;
      return save("growth", (gr) => ({ ...gr, items: gr.items.map((x) => (x.id === t.dataset.id ? { ...x, status: "discussed", discussedAt: today, ...(takeaway ? { takeaway } : {}) } : x)) }), "talked about an idea");
    }
    // ── home
    if (act === "addtodo") { const text = val(box, "text"); if (!text) return; return save("home", (h) => ({ ...h, todos: [...(h.todos || []), { id: newId(), text, who: val(box, "who") || "both", ...(val(box, "due") ? { due: val(box, "due") } : {}), done: false }] }), "to-do"); }
    if (act === "addchore") { const text = val(box, "text"); if (!text) return; return save("home", (h) => ({ ...h, chores: [...(h.chores || []), { id: newId(), text, who: val(box, "who") || "both", every: val(box, "every") || "weekly" }] }), "chore"); }
    if (act === "chore") return save("home", (h) => ({ ...h, chores: h.chores.map((c) => (c.id === t.dataset.id ? { ...c, last: today } : c)) }), "chore done");
    if (act === "addappt") { const what = val(box, "what"), date = val(box, "date"); if (!what || !date) return flash("Add a date and what it is.", true); return save("home", (h) => ({ ...h, appointments: [...(h.appointments || []), { id: newId(), date, ...(val(box, "time") ? { time: val(box, "time") } : {}), what, who: val(box, "who") || "both", done: false }] }), "appointment"); }
    if (act === "appdone") return save("home", (h) => ({ ...h, appointments: h.appointments.map((a) => (a.id === t.dataset.id ? { ...a, done: true } : a)) }), "appointment done");
  });
}
