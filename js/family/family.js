// Family tab: Lokesh and Archana's dashboard over the private Family repo. Six screens:
// HQ (the week's read, our notes, what's coming up), Money (Monarch summary), Us, Health, Kids,
// Home. Everything the two of them enter is a small read-modify-write on one JSON file, so both
// can use it at once. Numbers come from compute.js; the routine only drafts the weekly read and
// syncs the Monarch summary (see the Family repo's CLAUDE.md).
import { computeFamily, sundayOf, addDays, daysBetween } from "./compute.js";
import { FILES } from "./store.js";
import { payFirstHTML } from "../payfirst.js";
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
const TABS = [["hq", "Overview"], ["money", "Money"], ["us", "Us"], ["growth", "Growth"], ["health", "Health"], ["kids", "Kids"], ["home", "Home"]];
const KINDS = { book: "Book", podcast: "Podcast", article: "Article", video: "Video", thought: "My own thought" };
const AREAS = { money: "Money", us: "Us", growth: "Growth", health: "Health", kids: "Kids", home: "Home" };
const DIRS = { better: ["Better", "up"], worse: ["Slipping", "down"], steady: ["Steady", "flat"] };
const LOG_TAGS = { progress: "Made a change", notyet: "Not yet" };
const TRAITS = ["Kindness", "Honesty", "Responsibility", "Respect", "Patience", "Effort", "Gratitude", "Self-control", "Listening", "Sharing", "Confidence", "Resilience"];

let ctx = null; // { store, S, renderApp }

export async function renderFamilyView(store, S, renderApp) {
  ctx = { store, S, renderApp };
  const F = (S.fam = S.fam || { tab: "hq", loaded: false, me: S.partner ? "archana" : "lokesh" });
  const main = $("#main");
  if (!F.loaded) {
    main.innerHTML = `<div class="fam"><p class="fm-empty">Loading the family dashboard…</p></div>`;
    try { await store.loadAll(); F.loaded = true; }
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

function draw() {
  const F = ctx.S.fam;
  if (ctx.S.famShare) startShareFromLearning(ctx.S.famShare);
  const D = data(), C = computeFamily(D, todayISO());
  const body = { hq, money, us, growth, health, kids, home }[F.tab] || hq;
  const main = $("#main");
  main.innerHTML = `<div class="fam">
    <div class="fm-top"><div class="fm-hello"><p class="fm-eyebrow">${esc(C.name("lokesh"))} &amp; ${esc(C.name("archana"))} · family</p><h1>Week of ${fmtD(C.week, { month: "long", day: "numeric" })}</h1><p class="fm-sub">Signed in as ${esc(C.name(F.me))}</p></div></div>
    <div class="fm-navrow"><nav class="fm-tabs" aria-label="Family screens">${TABS.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${F.tab === k}">${l}</button>`).join("")}</nav></div>
    <div id="fambody">${body(D, C)}</div>
    <p class="fm-fresh">Money ${C.money ? `synced ${fmtD(C.money.asOf)}` : "not synced yet"} · <button class="fm-link" data-act="reload">Refresh</button> · app ${APP_VERSION}</p>
  </div>`;
  wire(main.firstElementChild, D, C);
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
  const read = !rv ? `<div class="fm-tile s4 coach"><span class="fm-kicker">This week · our read</span>
      <h2 class="fm-headline">No weekly read yet.</h2><p class="sub">Claude drafts it from all five areas; you two review it together and keep notes.</p>
      ${run ? runLine(run) : `<button class="fm-btn pri" data-act="draftread">Draft this week's read</button>`}</div>`
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
    ["health", "Health", C.health.map((h) => `${h.name}: ${h.thisWeek ? "checked in" : "no check-in this week"}`).join(" · "), ""],
    ["kids", "Kids", C.kids.map((k) => `${k.name}: ${k.appointments.length} coming up`).join(" · ") || "Add the kids", n?.focus ? `Navya's focus: ${n.focus.split(".")[0]}` : ""],
    ["growth", "Growth", (() => { const open = (D.growth?.items || []).filter((g) => g.status === "open"), mine = open.filter((g) => !(g.reflections || []).some((r) => r.by === ctx.S.fam.me)); return open.length ? `${open.length} to talk about${mine.length ? ` · ${mine.length} waiting for your thoughts` : ""}` : "Nothing waiting to talk about"; })(), `${(D.growth?.items || []).filter((g) => g.status === "discussed").length} talked about so far`],
    ["home", "Home", `${C.home.todos.length} to-dos open · ${C.home.chores.filter((c) => c.due).length} chores due`, `${C.home.done7} done this week`],
  ];
  return `<div class="fm-bento">${read}
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

function us(D, C) {
  const R = D.rel || {}, F = ctx.S.fam, other = F.me === "lokesh" ? "archana" : "lokesh";
  const recent = (list, n = 6) => (list || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
  return `<div class="fm-bento">
    <div class="fm-tile s4 glow"><h3>You two</h3><div class="fm-big3">
      <div class="tri"><b>${C.us.daysSinceUs == null ? "–" : C.us.daysSinceUs === 0 ? "today" : `${C.us.daysSinceUs} days`}</b><span>since time just you two</span></div>
      <div class="tri"><b>${C.us.us30}</b><span>times together · 30 days</span></div><div class="tri"><b>${C.us.family30}</b><span>family times · 30 days</span></div></div>
      <div class="fam-form"><input type="date" name="date" value="${todayISO()}"><select name="kind"><option value="us">Just us</option><option value="family">Family</option></select><input name="what" placeholder="What did you do? e.g. dinner out, hike with the kids"><button class="fm-btn sm pri" data-act="addtogether">Add</button></div>
      ${(R.together || []).length ? `<ul class="fam-list">${recent(R.together).map((t) => `<li><span class="d">${fmtD(t.date)}</span><span><span class="fm-type">${t.kind === "us" ? "Us" : "Family"}</span>${esc(t.what)}</span><button class="fm-link" data-act="del" data-file="rel" data-list="together" data-id="${t.id}">Remove</button></li>`).join("")}</ul>` : ""}</div>
    <div class="fm-tile s2"><h3>Appreciation</h3><p class="sub">Something the other did this week that you appreciated.</p>
      <div class="fam-form"><select name="to"><option value="${other}">To ${esc(C.name(other))}</option>${C.kids.map((k) => `<option value="${k.id}">To ${esc(k.name)}</option>`).join("")}</select><input name="text" placeholder="Thank you for…"><button class="fm-btn sm pri" data-act="addappreciation">Add</button></div>
      ${(R.appreciation || []).length ? `<ul class="fam-list quotes">${recent(R.appreciation, 8).map((a) => `<li><span class="d">${fmtD(a.date)}</span><span><b>${esc(C.name(a.from))} → ${esc(C.name(a.to))}:</b> ${esc(a.text)}</span></li>`).join("")}</ul>` : ""}</div>
    <div class="fm-tile s2"><h3>Our relationship goals</h3>
      ${(R.goals || []).length ? `<ul class="fam-list">${R.goals.map((g) => `<li><span>${esc(g.text)}</span><button class="fm-link" data-act="del" data-file="rel" data-list="goals" data-id="${g.id}">Remove</button></li>`).join("")}</ul>` : empty("What you want more of as a couple.")}
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

/* ── Kids ────────────────────────────────────────────────── */

function kids(D, C) {
  const n = C.navya;
  return `<div class="fm-bento">${C.kids.map((k) => {
    const navyaLine = k.dashboard === "navya" ? `<div class="fam-navya">${n ? `<span>GPA <b>${n.gpa?.toFixed?.(2) ?? "–"}</b></span><span>Social <b>${n.social != null ? `${Math.floor(n.social / 60)}h ${String(n.social % 60).padStart(2, "0")}m` : "–"}/day</b></span><span>Calls <b>${n.calls ?? "–"}%</b></span>${n.focus ? `<p><b>Her focus this week:</b> ${esc(n.focus)}</p>` : ""}` : `<span class="sub">Her dashboard isn't reachable from this device.</span>`}
      <button class="fm-btn sm" data-act="opennavya">Open Navya's dashboard →</button></div>` : "";
    const obs = k.observations.slice(0, 8);
    return `<div class="fm-tile s4 fam-kid" data-kid="${k.id}"><div class="fm-rowsplit"><h3 class="fm-name">${esc(k.name)}</h3>${k.unnamed ? `<span class="fam-form"><input name="kidname" placeholder="Their name" class="short"><button class="fm-btn sm pri" data-act="namekid">Save name</button></span>` : ""}</div>
      ${navyaLine}
      <div class="fam-cols">
        <div><h4>Appointments &amp; logistics</h4>${k.appointments.length ? `<ul class="fam-list">${k.appointments.map((a) => `<li><span class="d">${fmtD(a.date)}${a.time ? ` ${esc(a.time)}` : ""}</span><span>${esc(a.what)}</span><button class="fm-link" data-act="kiddone" data-id="${a.id}">Done</button></li>`).join("")}</ul>` : empty("Nothing coming up.")}
          <div class="fam-form"><input type="date" name="date" class="short"><input name="time" placeholder="Time" class="tiny"><input name="what" placeholder="e.g. Dentist, school form due"><button class="fm-btn sm pri" data-act="addkidappt">Add</button></div></div>
        <div><h4>Developmental goals</h4>${k.goals.length ? `<ul class="fam-list">${k.goals.map((g) => `<li><span>${g.area ? `<b>${esc(g.area)}:</b> ` : ""}${esc(g.text)}</span><select data-act="goalstatus" data-id="${g.id}">${["working", "better", "done"].map((s) => `<option value="${s}"${g.status === s ? " selected" : ""}>${s === "working" ? "Working on it" : s === "better" ? "Getting better" : "Done"}</option>`).join("")}</select></li>`).join("")}</ul>` : empty("What you're helping them grow in.")}
          <div class="fam-form"><input name="area" placeholder="Area, e.g. Independence" class="short"><input name="text" placeholder="The goal"><button class="fm-btn sm pri" data-act="addkidgoal">Add</button></div></div>
      </div>
      <h4>Character, values &amp; behavior</h4>
      ${k.traits.length ? `<div class="fam-traits">${k.traits.map((t) => `<span class="fm-pill">${esc(t.trait)}${t.encourage ? ` <b class="good">+${t.encourage}</b>` : ""}${t.correct ? ` <b class="bad">−${t.correct}</b>` : ""}</span>`).join("")}</div><p class="sub">Last 30 days: ${k.encourage30} to encourage, ${k.correct30} to correct.</p>` : ""}
      <div class="fam-form"><input name="trait" list="fam-traits" placeholder="Trait or value, e.g. Patience" class="short"><span class="fm-tags"><button type="button" data-act="obstype" data-type="encourage" aria-pressed="true">Encourage</button><button type="button" data-act="obstype" data-type="correct" aria-pressed="false">Correct</button></span><input name="note" placeholder="What you saw"><button class="fm-btn sm pri" data-act="addobs">Add</button></div>
      ${obs.length ? `<ul class="fm-log">${obs.map((o) => `<li class="${o.type === "encourage" ? "tag-progress" : "tag-notyet"}"><div class="meta"><span>${fmtD(o.date)} · ${esc(C.name(o.by))}</span><span class="tg">${o.type === "encourage" ? "Encourage" : "Correct"}${o.trait ? ` · ${esc(o.trait)}` : ""}</span>${o.by === ctx.S.fam.me ? `<button class="fm-link" data-act="delobs" data-id="${o.id}">Remove</button>` : ""}</div><p>${esc(o.note)}</p></li>`).join("")}</ul>` : ""}
    </div>`;
  }).join("")}<datalist id="fam-traits">${TRAITS.map((t) => `<option value="${t}">`).join("")}</datalist></div>`;
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
  root.addEventListener("change", async (e) => {
    const t = e.target;
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
    if (t.dataset.tab) { F.tab = t.dataset.tab; F.notesEdit = F.logEdit = null; draw(); window.scrollTo(0, 0); return; }
    if (t.dataset.val !== undefined && t.closest(".fm-seg")) { t.closest(".fm-seg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t))); return; }
    const act = t.dataset.act, box = form(t), today = todayISO();
    const kid = t.closest(".fam-kid")?.dataset.kid;
    const ensureKid = (k) => { k[kid] = k[kid] || { appointments: [], goals: [], observations: [] }; return k[kid]; };
    if (act === "reload") { ctx.store.reviews.clear(); F.loaded = false; F.run = null; return renderFamilyView(ctx.store, ctx.S, ctx.renderApp); }
    if (act === "tag" || act === "obstype") { const on = act === "obstype" || t.getAttribute("aria-pressed") !== "true"; t.closest(".fm-tags").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t && on))); return; }
    if (act === "pyfrange") { F[t.dataset.scope === "navya" ? "nvRange" : "pyfRange"] = t.dataset.range; return draw(); }
    if (act === "opennavya") { ctx.S.view = "navya"; return ctx.renderApp(); }
    if (act === "draftread") return startRun("read", sundayOf(today));
    if (act === "syncmoney") return startRun("finance");
    if (act === "approveread") { await ctx.store.update(`review/${t.dataset.week}.json`, null, (r) => ({ ...r, status: "approved", approvedAt: new Date().toISOString() }), `family: read ${t.dataset.week} approved`); return draw(); }
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
      await ctx.store.update(`review/${t.dataset.week}.json`, null, (r) => ({ ...r, notes: mutate(r.notes || {}) }), `family: read ${t.dataset.week} notes`);
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
    if (act === "addobs") {
      const b = t.closest(".fam-form"), note = val(b, "note"), trait = val(b, "trait"); if (!note && !trait) return;
      const type = b.querySelector("[data-act=obstype][aria-pressed=true]")?.dataset.type || "encourage";
      return save("kids", (k) => { ensureKid(k).observations.push({ id: newId(), date: today, by: F.me, trait, type, note }); return k; }, `${kid} observation`);
    }
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
