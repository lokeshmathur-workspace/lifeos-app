// Family tab: Lokesh and Archana's dashboard over the private Family repo. Six screens:
// HQ (the week's read, our notes, what's coming up), Money (Monarch summary), Us, Health, Kids,
// Home. Everything the two of them enter is a small read-modify-write on one JSON file, so both
// can use it at once. Numbers come from compute.js; the routine only drafts the weekly read and
// syncs the Monarch summary (see the Family repo's CLAUDE.md).
import { computeFamily, sundayOf, addDays, daysBetween } from "./compute.js";
import { FILES } from "./store.js";
import { fireRoutine, RoutineError } from "../learning/routine.js";
import { todayISO } from "../dateutil.js";
import { flash } from "../flash.js";
import { APP_VERSION } from "../version.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtD = (iso, o = { month: "short", day: "numeric" }) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", o) : "");
const usd = (n) => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const TABS = [["hq", "🏠 HQ"], ["money", "💰 Money"], ["us", "❤️ Us"], ["health", "🍎 Health"], ["kids", "🧒 Kids"], ["home", "🏡 Home"]];
const AREAS = { money: ["💰", "Money"], us: ["❤️", "Us"], health: ["🍎", "Health"], kids: ["🧒", "Kids"], home: ["🏡", "Home"] };
const DIRS = { better: ["▲ Better", "up"], worse: ["▼ Slipping", "down"], steady: ["● Steady", "flat"] };
const LOG_TAGS = { progress: "👍 Made a change", notyet: "⚠️ Not yet" };
const TRAITS = ["Kindness", "Honesty", "Responsibility", "Respect", "Patience", "Effort", "Gratitude", "Self-control", "Listening", "Sharing", "Confidence", "Resilience"];

let ctx = null; // { store, S, renderApp }

export async function renderFamilyView(store, S, renderApp) {
  ctx = { store, S, renderApp };
  const F = (S.fam = S.fam || { tab: "hq", loaded: false, me: S.partner ? "archana" : "lokesh" });
  document.body.classList.add("navya-mode");
  const main = $("#main");
  if (!F.loaded) {
    main.innerHTML = `<div class="navya fam"><p class="nv-empty">Loading the family dashboard…</p></div>`;
    try { await store.loadAll(); F.loaded = true; }
    catch (e) {
      main.innerHTML = `<div class="navya fam"><div class="nv-tile"><h3>Can't open the Family repo</h3><p>${esc(e.message)}</p>
        <p class="sub">On GitHub: <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b> → open the token this device uses → <b>Edit</b> → Repository access → add <b>Family</b> (Contents: Read and write) → Save. Then try again.</p>
        <button class="nv-btn" data-act="retry">Try again</button></div></div>`;
      $("[data-act=retry]", main).onclick = () => renderFamilyView(store, S, renderApp);
      return;
    }
  }
  draw();
}

const data = () => ctx.store.data();

function draw() {
  const F = ctx.S.fam, D = data(), C = computeFamily(D, todayISO());
  const body = { hq, money, us, health, kids, home }[F.tab] || hq;
  const main = $("#main");
  main.innerHTML = `<div class="navya fam">
    <div class="nv-top"><div class="nv-hello"><h1>hey <span>${esc(C.name("lokesh"))} &amp; ${esc(C.name("archana"))}</span> ✨</h1><p>Week of ${fmtD(C.week)} · you're signed in as ${esc(C.name(F.me))}</p></div></div>
    <div class="nv-navrow"><nav class="nv-tabs" aria-label="Family screens">${TABS.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${F.tab === k}">${l}</button>`).join("")}</nav></div>
    <div id="fambody">${body(D, C)}</div>
    <p class="nv-fresh">Money ${C.money ? `synced ${fmtD(C.money.asOf)}` : "not synced yet"} · <button class="nv-link" data-act="reload">Refresh</button> · app ${APP_VERSION}</p>
  </div>`;
  wire(main.firstElementChild, D, C);
}

/* ── shared bits ─────────────────────────────────────────── */

function cards(items) {
  return `<div class="nv-changes2">${(items || []).map((x) => {
    const [ic, nm] = AREAS[x.area] || ["•", x.area || ""], [ar, cls] = DIRS[x.dir] || ["", "flat"];
    return `<div class="chg2 ${cls}"><div class="top"><span class="area">${ic} ${esc(nm)}</span>${ar ? `<span class="dir ${cls}">${ar}</span>` : ""}</div><b>${esc(x.title || "")}</b>${x.detail ? `<p class="det">${esc(x.detail)}</p>` : ""}</div>`;
  }).join("")}</div>`;
}
const tags = (sel) => `<span class="nv-tags">${Object.entries(LOG_TAGS).map(([k, v]) => `<button type="button" data-act="tag" data-tag="${k}" aria-pressed="${sel === k}">${v}</button>`).join("")}</span>`;
const whoSelect = (C, name = "who", sel = "both", withBoth = true) => `<select name="${name}">${[...(withBoth ? [["both", "Both"]] : []), ["lokesh", C.name("lokesh")], ["archana", C.name("archana")]].map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const empty = (t) => `<p class="sub">${t}</p>`;

/* ── HQ: the week's read + our notes + coming up ─────────── */

function latestReview(D) { return (D.reviews || []).at(-1) || null; }

function hq(D, C) {
  const rv = latestReview(D), run = ctx.S.fam.run;
  const read = !rv ? `<div class="nv-tile s4 coach"><span class="nv-kicker">🧭 This week · our read</span>
      <h2 class="nv-headline">No weekly read yet.</h2><p class="sub">Claude drafts it from all five areas; you two review it together and keep notes.</p>
      ${run ? runLine(run) : `<button class="nv-btn pri" data-act="draftread">Draft this week's read</button>`}</div>`
    : `<div class="nv-tile s4 coach">
      <div class="nv-rowsplit"><span class="nv-kicker">🧭 Our read · week of ${fmtD(rv.weekStart)}</span>${rv.status === "draft" ? `<span class="nv-chip warn">draft</span>` : `<span class="nv-chip">approved ${fmtD(rv.approvedAt)}</span>`}</div>
      <h2 class="nv-headline">${esc(rv.headline)}</h2>
      ${rv.focus ? `<div class="nv-focus"><span class="nv-kicker">🎯 This week's one focus</span><b>${esc(rv.focus)}</b></div>` : ""}
      ${rv.cards?.length ? `<div class="nv-sec"><span class="nv-kicker">📈 Across the family</span>${cards(rv.cards)}</div>` : ""}
      ${rv.talk?.length ? `<div class="nv-sec"><span class="nv-kicker">💬 Talk about</span><div class="nv-bubbles">${rv.talk.map((t) => `<p class="bub">${esc(t)}</p>`).join("")}</div></div>` : ""}
      ${notesBlock(rv, D, C)}
      <div class="nv-btnrow">${rv.status === "draft" ? `<button class="nv-btn pri" data-act="approveread" data-week="${rv.weekStart}">Approve</button>` : ""}
        ${run ? "" : `<button class="nv-btn" data-act="draftread">${rv.weekStart >= C.week ? "Redraft" : "Draft this week's read"}</button>`}</div>${run ? runLine(run) : ""}</div>`;
  const up = C.comingUp;
  const m = C.money, n = C.navya;
  const rows = [
    ["money", "💰 Money", m ? `${usd(m.spent)} spent · on pace for ${usd(m.projected)}` : "Not synced from Monarch yet", m ? [m.avg3Spending != null ? `usual month ${usd(m.avg3Spending)}` : "", m.savingsRate != null ? `saved ${m.savingsRate}% last month` : ""].filter(Boolean).join(" · ") : ""],
    ["us", "❤️ Us", C.us.daysSinceUs != null ? `time together ${C.us.daysSinceUs === 0 ? "today" : `${C.us.daysSinceUs} days ago`}` : "No time together logged yet", `${C.us.family30} family times in 30 days`],
    ["health", "🍎 Health", C.health.map((h) => `${h.name}: ${h.thisWeek ? "checked in" : "no check-in this week"}`).join(" · "), ""],
    ["kids", "🧒 Kids", C.kids.map((k) => `${k.name}: ${k.appointments.length} coming up`).join(" · ") || "Add the kids", n?.focus ? `Navya's focus: ${n.focus.split(".")[0]}` : ""],
    ["home", "🏡 Home", `${C.home.todos.length} to-dos open · ${C.home.chores.filter((c) => c.due).length} chores due`, `${C.home.done7} done this week`],
  ];
  return `<div class="nv-bento">${read}
    <div class="nv-tile s2"><h3>🗓️ Coming up · next 2 weeks</h3>${up.length ? `<ul class="fam-list">${up.map((u) => `<li class="${u.overdue ? "late" : ""}"><span class="d">${fmtD(u.date)}</span><span>${u.icon} ${esc(u.text)}</span></li>`).join("")}</ul>` : empty("Nothing in the next two weeks.")}</div>
    <div class="nv-tile s2"><h3>How each area is going</h3><div class="nv-rows">${rows.map(([t, title, big, sub]) => `<button class="nv-row fam-row" data-tab="${t}"><span class="nm">${title}</span><b>${esc(big)}</b><span class="sub">${esc(sub)}</span><span class="go">→</span></button>`).join("")}</div></div>
  </div>`;
}

function runLine(run) {
  return `<p class="sub fam-run">⏳ ${run.kind === "finance" ? "Syncing from Monarch" : "Drafting this week's read"}… usually 2–4 minutes. ${run.url ? `<a href="${esc(run.url)}" target="_blank" rel="noopener">View run</a> · ` : ""}<button class="nv-link" data-act="reload">Check now</button></p>`;
}

// Notes on the week's read: a review written together (either can edit), notes during the week
// (each edits their own), and last week's notes below — the same shape as Navya's.
const hasNotes = (n) => !!(n && (n.discussed || n.changes?.length || n.log?.length));
function notesView(n, C) {
  return `${n.discussed ? `<h5>What we discussed</h5><p class="talked">${esc(n.discussed)}</p>` : ""}
    ${n.changes?.length ? `<h5>What we'll change</h5><ul class="decisions">${n.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${n.log?.length ? `<h5>During the week</h5><ul class="nv-log">${n.log.map((e) => logLine(e, false, C)).join("")}</ul>` : ""}`;
}
const logLine = (e, editable, C) => `<li class="${e.tag ? "tag-" + e.tag : ""}"><div class="meta"><span>${fmtD(e.date)} · ${esc(C.name(e.by))}</span>${e.tag ? `<span class="tg">${LOG_TAGS[e.tag]}</span>` : ""}${editable ? `<button class="nv-link" data-act="editlog" data-id="${esc(e.id)}">Edit</button>` : ""}</div><p>${esc(e.text)}</p></li>`;
function notesBlock(rv, D, C) {
  const F = ctx.S.fam, n = rv.notes || {}, wk = rv.weekStart, editing = F.notesEdit === wk;
  const prev = (D.reviews || []).filter((r) => r.weekStart < wk && hasNotes(r.notes)).reverse();
  const review = editing
    ? `<label class="nv-fld"><span>What we discussed · what's on each of your minds</span><textarea data-notes="discussed" rows="4">${esc(n.discussed || "")}</textarea></label>
      <label class="nv-fld"><span>What we'll change · one per line</span><textarea data-notes="changes" rows="3">${esc((n.changes || []).join("\n"))}</textarea></label>
      <div class="nv-btnrow"><button class="nv-btn pri" data-act="savereview" data-week="${wk}">Save</button><button class="nv-btn" data-act="cancel">Cancel</button></div>`
    : n.discussed || n.changes?.length ? notesView({ discussed: n.discussed, changes: n.changes }, C)
    : empty("When you go through this together: what's on each of your minds, and what you'll change this week.");
  const log = (n.log || []).map((e) => F.logEdit === e.id
    ? `<li class="editing"><textarea data-logedit="text" rows="2">${esc(e.text)}</textarea><div class="nv-rowsplit">${tags(e.tag)}<span class="nv-btnrow"><button class="nv-btn sm pri" data-act="savelog" data-week="${wk}" data-id="${esc(e.id)}">Save</button><button class="nv-btn sm" data-act="dellog" data-week="${wk}" data-id="${esc(e.id)}">Delete</button><button class="nv-btn sm" data-act="cancel">Cancel</button></span></div></li>`
    : logLine(e, e.by === F.me, C)).join("");
  return `<div class="nv-sec nv-notes"><span class="nv-kicker">📝 Our notes · week of ${fmtD(wk)}</span>
    <div class="nv-note review"><div class="nv-rowsplit"><b>Our review</b>${editing ? "" : `<button class="nv-btn sm" data-act="editreview" data-week="${wk}">${n.discussed || n.changes?.length ? "Edit" : "Add review notes"}</button>`}</div>${review}</div>
    <div class="nv-note log"><b>During the week</b>${log ? `<ul class="nv-log">${log}</ul>` : empty("Jot down what you notice as the week goes: a change made, or one that hasn't happened yet.")}
      <div class="nv-logadd"><textarea data-log="text" rows="2" placeholder="Add a note"></textarea><div class="nv-rowsplit">${tags(null)}<button class="nv-btn sm pri" data-act="addlog" data-week="${wk}">Add note</button></div></div></div>
    ${prev[0] ? `<details class="nv-more" open><summary>Last week's notes · week of ${fmtD(prev[0].weekStart)}</summary><div class="nv-note past">${notesView(prev[0].notes, C)}</div></details>` : ""}
    ${prev.length > 1 ? `<details class="nv-more"><summary>Older notes (${prev.length - 1})</summary>${prev.slice(1).map((r) => `<div class="nv-note past"><b>Week of ${fmtD(r.weekStart)}</b>${notesView(r.notes, C)}</div>`).join("")}</details>` : ""}
  </div>`;
}

/* ── Money ───────────────────────────────────────────────── */

function bar(value, max, cls = "") {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `<span class="fam-bar ${cls}"><i style="width:${pct}%"></i></span>`;
}

function money(D, C) {
  const m = C.money, run = ctx.S.fam.run;
  const sync = run?.kind === "finance" ? runLine(run) : `<button class="nv-btn sm${!m || m.stale ? " pri" : ""}" data-act="syncmoney">↻ Refresh from Monarch</button>`;
  const watchEdit = `<details class="nv-more"><summary>Categories you watch</summary><div class="fam-form"><input name="watch" value="${esc((D.config?.finance?.watch || []).join(", "))}" placeholder="Clothing, Shopping, Restaurants & Bars"><button class="nv-btn sm" data-act="savewatch">Save</button></div><p class="sub">Use Monarch's category names, separated by commas. The next sync picks them up.</p></details>`;
  if (!m) return `<div class="nv-bento"><div class="nv-tile s4"><h3>💰 Money</h3>${empty("Nothing from Monarch yet. Refresh pulls this month's spending, budgets, bills, debts and goals into the dashboard (totals only, never individual transactions).")}${sync}${watchEdit}</div></div>`;
  const overUsual = m.avg3Spending != null && m.projected > m.avg3Spending;
  const watch = m.watch.map((w) => {
    const base = w.budget ?? w.avg3;
    return `<li><div class="fam-li-top"><b>${esc(w.category)}</b><span>${usd(w.spent)} so far · on pace for ${usd(w.projected)}</span></div>${bar(w.projected || 0, Math.max(base || 0, w.projected || 0), w.over ? "over" : "")}
      <span class="sub">${w.budget != null ? `budget ${usd(w.budget)}` : "no budget"}${w.avg3 != null ? ` · usual ${usd(w.avg3)}/month` : ""}${w.over ? ` · <b class="bad">${usd(w.over)} over</b>` : ""}</span></li>`;
  }).join("");
  const goals = m.goals.map((g) => `<li><div class="fam-li-top"><b>${esc(g.name)}</b><span>${usd(g.current)}${g.target ? ` of ${usd(g.target)}` : ""}</span></div>${g.target ? bar(g.current, g.target, "goal") : ""}
    <span class="sub">${g.monthly ? `${usd(g.monthly)}/month` : ""}${g.months ? ` · about ${g.months} months to go` : ""}${g.monthsFaster ? ` · <b class="good">${g.monthsFaster} months sooner</b> if the watched overspend went here` : ""}</span></li>`).join("");
  return `<div class="nv-bento">
    <div class="nv-tile s4 glow"><div class="nv-rowsplit"><h3>💰 ${fmtD(m.month + "-01", { month: "long" })} so far</h3><span class="sub">from Monarch ${fmtD(m.asOf)}</span></div>
      <div class="nv-big3"><div class="tri"><b>${usd(m.spent)}</b><span>spent so far</span></div><div class="tri"><b class="${overUsual ? "bad" : ""}">${usd(m.projected)}</b><span>on pace for this month${m.avg3Spending != null ? ` · usual ${usd(m.avg3Spending)}` : ""}</span></div>
      <div class="tri"><b>${m.savingsRate ?? "–"}%</b><span>saved last month · ${m.savingsRate3 ?? "–"}% over 3</span></div></div>
      ${m.budgetTotal ? `<p class="sub">Budgeted categories: on pace for <b class="${m.budgetProjected > m.budgetTotal ? "bad" : "good"}">${usd(m.budgetProjected)}</b> of ${usd(m.budgetTotal)} budgeted.</p>` : ""}
      ${m.lastMonth ? `<p class="sub">Last month: spent ${usd(m.lastMonth.spending)} of ${usd(m.lastMonth.income)} income.</p>` : ""}
      <div class="nv-btnrow">${sync}</div>${m.flags.length ? `<ul class="nv-check">${m.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}</div>
    <div class="nv-tile s2"><h3>👀 Categories you watch</h3>${watch ? `<ul class="fam-list bars">${watch}</ul>` : empty("Add categories below.")}
      ${m.overWatch ? `<p class="fam-impact">On pace to spend <b>${usd(m.overWatch)}</b> more than planned in these this month. Put toward your goals instead, that's ${usd(m.overWatch * 12)} a year.</p>` : ""}${watchEdit}</div>
    <div class="nv-tile s2"><h3>🎯 Savings, retirement &amp; payoff</h3>${goals ? `<ul class="fam-list bars">${goals}</ul>` : empty("No goals in Monarch yet.")}
      ${m.debts.length ? `<h4>Short-term debt · ${usd(m.debtTotal)}</h4><ul class="fam-list">${m.debts.map((d) => `<li><span>${esc(d.name)}</span><span>${usd(d.balance)}${d.apr ? ` · ${d.apr}% APR` : ""}${d.months ? ` · paid off in ~${d.months} months` : ""}</span></li>`).join("")}</ul>` : ""}</div>
    <div class="nv-tile s2"><h3>💳 Bills · next 30 days</h3>${m.bills.length ? `<ul class="fam-list">${m.bills.map((b) => `<li><span class="d">${fmtD(b.due)}</span><span>${esc(b.name)}</span><b>${usd(b.amount)}</b></li>`).join("")}</ul><p class="sub">${usd(m.bills14)} due in the next 2 weeks.</p>` : empty("No bills due in the next 30 days.")}</div>
    <div class="nv-tile s2"><h3>📊 Over budget this month</h3>${m.overBudget.length ? `<ul class="fam-list">${m.overBudget.slice(0, 6).map((b) => `<li><span>${esc(b.category)}</span><span>on pace for ${usd(b.projected)} of ${usd(b.budget)}</span></li>`).join("")}</ul>` : empty("Every budgeted category is on pace.")}</div>
    ${m.months.length ? `<div class="nv-tile s4"><h3>📈 Cash flow by month</h3><div class="fam-scroll"><table><thead><tr><th>Month</th><th>Income</th><th>Spending</th><th>Saved</th><th>Rate</th></tr></thead><tbody>${m.months.map((c) => `<tr><td>${fmtD(c.month + "-01", { month: "short", year: "numeric" })}</td><td>${usd(c.income)}</td><td>${usd(c.spending)}</td><td>${usd(c.savings)}</td><td>${c.rate ?? "–"}%</td></tr>`).join("")}</tbody></table></div></div>` : ""}
  </div>`;
}

/* ── Us ──────────────────────────────────────────────────── */

function us(D, C) {
  const R = D.rel || {}, F = ctx.S.fam, other = F.me === "lokesh" ? "archana" : "lokesh";
  const recent = (list, n = 6) => (list || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
  return `<div class="nv-bento">
    <div class="nv-tile s4 glow"><h3>❤️ You two</h3><div class="nv-big3">
      <div class="tri"><b>${C.us.daysSinceUs == null ? "–" : C.us.daysSinceUs === 0 ? "today" : `${C.us.daysSinceUs} days`}</b><span>since time just you two</span></div>
      <div class="tri"><b>${C.us.us30}</b><span>times together · 30 days</span></div><div class="tri"><b>${C.us.family30}</b><span>family times · 30 days</span></div></div>
      <div class="fam-form"><input type="date" name="date" value="${todayISO()}"><select name="kind"><option value="us">Just us</option><option value="family">Family</option></select><input name="what" placeholder="What did you do? e.g. dinner out, hike with the kids"><button class="nv-btn sm pri" data-act="addtogether">Add</button></div>
      ${(R.together || []).length ? `<ul class="fam-list">${recent(R.together).map((t) => `<li><span class="d">${fmtD(t.date)}</span><span>${t.kind === "us" ? "💑" : "👨‍👩‍👧"} ${esc(t.what)}</span><button class="nv-link" data-act="del" data-file="rel" data-list="together" data-id="${t.id}">Remove</button></li>`).join("")}</ul>` : ""}</div>
    <div class="nv-tile s2"><h3>🙏 Appreciation</h3><p class="sub">Something the other did this week that you appreciated.</p>
      <div class="fam-form"><select name="to"><option value="${other}">To ${esc(C.name(other))}</option>${C.kids.map((k) => `<option value="${k.id}">To ${esc(k.name)}</option>`).join("")}</select><input name="text" placeholder="Thank you for…"><button class="nv-btn sm pri" data-act="addappreciation">Add</button></div>
      ${(R.appreciation || []).length ? `<ul class="fam-list quotes">${recent(R.appreciation, 8).map((a) => `<li><span class="d">${fmtD(a.date)}</span><span><b>${esc(C.name(a.from))} → ${esc(C.name(a.to))}:</b> ${esc(a.text)}</span></li>`).join("")}</ul>` : ""}</div>
    <div class="nv-tile s2"><h3>🌱 Our relationship goals</h3>
      ${(R.goals || []).length ? `<ul class="fam-list">${R.goals.map((g) => `<li><span>${esc(g.text)}</span><button class="nv-link" data-act="del" data-file="rel" data-list="goals" data-id="${g.id}">Remove</button></li>`).join("")}</ul>` : empty("What you want more of as a couple.")}
      <div class="fam-form"><input name="text" placeholder="e.g. A date night every two weeks"><button class="nv-btn sm pri" data-act="addgoal">Add</button></div></div>
    <div class="nv-tile s2"><h3>📚 Learnings</h3><p class="sub">From a relationship coach, a book, friends who do it well.</p>
      <div class="fam-form"><input name="source" placeholder="Source, e.g. coach session" class="short"><input name="text" placeholder="What you took away"><button class="nv-btn sm pri" data-act="addlearning">Add</button></div>
      ${(R.learnings || []).length ? `<ul class="fam-list quotes">${recent(R.learnings, 10).map((l) => `<li><span class="d">${fmtD(l.date)}</span><span>${l.source ? `<b>${esc(l.source)}:</b> ` : ""}${esc(l.text)}</span><button class="nv-link" data-act="del" data-file="rel" data-list="learnings" data-id="${l.id}">Remove</button></li>`).join("")}</ul>` : ""}</div>
    <div class="nv-tile s2"><h3>👪 Family &amp; friends</h3>
      ${C.us.birthdays.length ? `<p class="sub">🎂 ${C.us.birthdays.map((p) => `${esc(p.name)} ${fmtD(p.next)}`).join(" · ")}</p>` : ""}
      ${(R.people || []).length ? `<ul class="fam-list">${R.people.map((p) => { const ago = p.lastContact ? daysBetween(p.lastContact, todayISO()) : null; return `<li class="${ago == null || ago > 30 ? "late" : ""}"><span><b>${esc(p.name)}</b> ${p.relation ? `· ${esc(p.relation)}` : ""}</span><span class="sub">${ago == null ? "not in touch yet" : ago === 0 ? "today" : `${ago} days ago`}</span><button class="nv-link" data-act="contacted" data-id="${p.id}">Talked today</button></li>`; }).join("")}</ul>` : empty("Parents, siblings, close friends: who you want to keep in touch with.")}
      <div class="fam-form"><input name="name" placeholder="Name" class="short"><input name="relation" placeholder="e.g. my mom" class="short"><input name="birthday" placeholder="Birthday MM-DD" class="short"><button class="nv-btn sm pri" data-act="addperson">Add</button></div></div>
  </div>`;
}

/* ── Health ──────────────────────────────────────────────── */

function health(D, C) {
  const wk = C.week;
  const scale = (name, val) => `<span class="nv-seg" data-field="${name}">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-val="${v}" aria-pressed="${val === v}">${v}</button>`).join("")}</span>`;
  const card = (h) => {
    const e = (D.health?.entries || []).find((x) => x.weekStart === wk && x.person === h.id) || {};
    const vs = (k, unit = "") => (h.prev[k] != null ? `<span class="sub">usual ${h.prev[k]}${unit}</span>` : "");
    return `<div class="nv-tile s2 fam-health" data-person="${h.id}"><h3>🍎 ${esc(h.name)} · week of ${fmtD(wk)}</h3>
      <div class="fam-grid"><label class="nv-fld"><span>Sleep, hours a night</span><input type="number" step="0.5" min="0" max="12" name="sleepHours" value="${e.sleepHours ?? ""}">${vs("sleepHours", "h")}</label>
      <label class="nv-fld"><span>Exercise days</span><input type="number" min="0" max="7" name="exerciseDays" value="${e.exerciseDays ?? ""}">${vs("exerciseDays")}</label>
      <label class="nv-fld"><span>Weight (optional)</span><input type="number" step="0.1" name="weight" value="${e.weight ?? ""}"></label></div>
      <div class="nv-fld"><span>Eating well, 1–5</span>${scale("eating", e.eating)}${vs("eating")}</div>
      <div class="nv-fld"><span>Energy, 1–5</span>${scale("energy", e.energy)}${vs("energy")}</div>
      <label class="nv-fld"><span>Note</span><input name="note" value="${esc(e.note || "")}" placeholder="Anything worth remembering"></label>
      <div class="nv-btnrow"><button class="nv-btn pri" data-act="savehealth" data-person="${h.id}">${e.weekStart ? "Update" : "Save"} this week</button></div>
      ${h.weeks.length > 1 ? `<div class="fam-scroll"><table><thead><tr><th>Week</th><th>Sleep</th><th>Exercise</th><th>Eating</th><th>Energy</th></tr></thead><tbody>${h.weeks.slice().reverse().map((x) => `<tr><td>${fmtD(x.weekStart)}</td><td>${x.sleepHours ?? "–"}</td><td>${x.exerciseDays ?? "–"}</td><td>${x.eating ?? "–"}</td><td>${x.energy ?? "–"}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`;
  };
  return `<div class="nv-bento">${C.health.map(card).join("")}</div>`;
}

/* ── Kids ────────────────────────────────────────────────── */

function kids(D, C) {
  const n = C.navya;
  return `<div class="nv-bento">${C.kids.map((k) => {
    const navyaLine = k.dashboard === "navya" ? `<div class="fam-navya">${n ? `<span>📚 GPA ${n.gpa?.toFixed?.(2) ?? "–"}</span><span>📱 social ${n.social != null ? `${Math.floor(n.social / 60)}h ${String(n.social % 60).padStart(2, "0")}m` : "–"}/day</span><span>🏐 calls ${n.calls ?? "–"}%</span>${n.focus ? `<p><b>Her focus this week:</b> ${esc(n.focus)}</p>` : ""}` : `<span class="sub">Her dashboard isn't reachable from this device.</span>`}
      <button class="nv-btn sm" data-act="opennavya">Open Navya's dashboard →</button></div>` : "";
    const obs = k.observations.slice(0, 8);
    return `<div class="nv-tile s4 fam-kid" data-kid="${k.id}"><div class="nv-rowsplit"><h3>🧒 ${esc(k.name)}</h3>${k.unnamed ? `<span class="fam-form"><input name="kidname" placeholder="Their name" class="short"><button class="nv-btn sm pri" data-act="namekid">Save name</button></span>` : ""}</div>
      ${navyaLine}
      <div class="fam-cols">
        <div><h4>📅 Appointments &amp; logistics</h4>${k.appointments.length ? `<ul class="fam-list">${k.appointments.map((a) => `<li><span class="d">${fmtD(a.date)}${a.time ? ` ${esc(a.time)}` : ""}</span><span>${esc(a.what)}</span><button class="nv-link" data-act="kiddone" data-id="${a.id}">Done</button></li>`).join("")}</ul>` : empty("Nothing coming up.")}
          <div class="fam-form"><input type="date" name="date" class="short"><input name="time" placeholder="Time" class="tiny"><input name="what" placeholder="e.g. Dentist, school form due"><button class="nv-btn sm pri" data-act="addkidappt">Add</button></div></div>
        <div><h4>🌱 Developmental goals</h4>${k.goals.length ? `<ul class="fam-list">${k.goals.map((g) => `<li><span>${g.area ? `<b>${esc(g.area)}:</b> ` : ""}${esc(g.text)}</span><select data-act="goalstatus" data-id="${g.id}">${["working", "better", "done"].map((s) => `<option value="${s}"${g.status === s ? " selected" : ""}>${s === "working" ? "Working on it" : s === "better" ? "Getting better" : "Done"}</option>`).join("")}</select></li>`).join("")}</ul>` : empty("What you're helping them grow in.")}
          <div class="fam-form"><input name="area" placeholder="Area, e.g. Independence" class="short"><input name="text" placeholder="The goal"><button class="nv-btn sm pri" data-act="addkidgoal">Add</button></div></div>
      </div>
      <h4>🧭 Character, values &amp; behavior</h4>
      ${k.traits.length ? `<div class="fam-traits">${k.traits.map((t) => `<span class="sticker">${esc(t.trait)}${t.encourage ? ` <b class="good">👍 ${t.encourage}</b>` : ""}${t.correct ? ` <b class="bad">🔧 ${t.correct}</b>` : ""}</span>`).join("")}</div><p class="sub">Last 30 days: ${k.encourage30} to encourage, ${k.correct30} to correct.</p>` : ""}
      <div class="fam-form"><input name="trait" list="fam-traits" placeholder="Trait or value, e.g. Patience" class="short"><span class="nv-tags"><button type="button" data-act="obstype" data-type="encourage" aria-pressed="true">👍 Encourage</button><button type="button" data-act="obstype" data-type="correct" aria-pressed="false">🔧 Correct</button></span><input name="note" placeholder="What you saw"><button class="nv-btn sm pri" data-act="addobs">Add</button></div>
      ${obs.length ? `<ul class="nv-log">${obs.map((o) => `<li class="${o.type === "encourage" ? "tag-progress" : "tag-notyet"}"><div class="meta"><span>${fmtD(o.date)} · ${esc(C.name(o.by))}</span><span class="tg">${o.type === "encourage" ? "👍 Encourage" : "🔧 Correct"}${o.trait ? ` · ${esc(o.trait)}` : ""}</span>${o.by === ctx.S.fam.me ? `<button class="nv-link" data-act="delobs" data-id="${o.id}">Remove</button>` : ""}</div><p>${esc(o.note)}</p></li>`).join("")}</ul>` : ""}
    </div>`;
  }).join("")}<datalist id="fam-traits">${TRAITS.map((t) => `<option value="${t}">`).join("")}</datalist></div>`;
}

/* ── Home ────────────────────────────────────────────────── */

function home(D, C) {
  const H = C.home, today = todayISO();
  return `<div class="nv-bento">
    <div class="nv-tile s2"><h3>✅ To-dos · ${H.todos.length} open</h3>
      <div class="fam-form"><input name="text" placeholder="Add a to-do"><input type="date" name="due" class="short">${whoSelect(C)}<button class="nv-btn sm pri" data-act="addtodo">Add</button></div>
      ${H.todos.length ? `<ul class="fam-list checks">${H.todos.map((t) => `<li class="${t.due && t.due < today ? "late" : ""}"><label><input type="checkbox" data-act="todo" data-id="${t.id}"> ${esc(t.text)}</label><span class="sub">${esc(C.name(t.who || "both"))}${t.due ? ` · ${fmtD(t.due)}` : ""}</span></li>`).join("")}</ul>` : empty("All done.")}
      ${H.done7 ? `<p class="sub">${H.done7} done this week.</p>` : ""}</div>
    <div class="nv-tile s2"><h3>🧹 Chores</h3>
      ${H.chores.length ? `<ul class="fam-list">${H.chores.map((c) => `<li class="${c.due ? "late" : ""}"><span><b>${esc(c.text)}</b> · ${esc(C.name(c.who || "both"))} · ${c.every}</span><span class="sub">${c.due ? "due" : `next ${fmtD(c.next)}`}</span><button class="nv-link" data-act="chore" data-id="${c.id}">Done today</button></li>`).join("")}</ul>` : empty("Recurring jobs around the house.")}
      <div class="fam-form"><input name="text" placeholder="e.g. Change HVAC filter">${whoSelect(C)}<select name="every"><option value="weekly">Weekly</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select><button class="nv-btn sm pri" data-act="addchore">Add</button></div></div>
    <div class="nv-tile s4"><h3>📅 Appointments &amp; things to get done</h3>
      ${H.appointments.length ? `<ul class="fam-list">${H.appointments.map((a) => `<li><span class="d">${fmtD(a.date)}${a.time ? ` ${esc(a.time)}` : ""}</span><span>${esc(a.what)} · ${esc(C.name(a.who || "both"))}</span><button class="nv-link" data-act="appdone" data-id="${a.id}">Done</button></li>`).join("")}</ul>` : empty("Doctor's visits, car service, contractor, renewals: anything with a date.")}
      <div class="fam-form"><input type="date" name="date" class="short"><input name="time" placeholder="Time" class="tiny"><input name="what" placeholder="What">${whoSelect(C)}<button class="nv-btn sm pri" data-act="addappt">Add</button></div></div>
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
    else if (t.dataset.act === "goalstatus") { const kid = t.closest(".fam-kid").dataset.kid; await save("kids", (k) => { k[kid].goals = k[kid].goals.map((g) => (g.id === t.dataset.id ? { ...g, status: t.value } : g)); return k; }, "kid goal"); }
  });
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab],[data-act],[data-val]");
    if (!t || t.disabled || t.tagName === "SELECT" || t.type === "checkbox") return;
    if (t.dataset.tab) { F.tab = t.dataset.tab; F.notesEdit = F.logEdit = null; draw(); window.scrollTo(0, 0); return; }
    if (t.dataset.val !== undefined && t.closest(".nv-seg")) { t.closest(".nv-seg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t))); return; }
    const act = t.dataset.act, box = form(t), today = todayISO();
    const kid = t.closest(".fam-kid")?.dataset.kid;
    const ensureKid = (k) => { k[kid] = k[kid] || { appointments: [], goals: [], observations: [] }; return k[kid]; };
    if (act === "reload") { ctx.store.reviews.clear(); F.loaded = false; F.run = null; return renderFamilyView(ctx.store, ctx.S, ctx.renderApp); }
    if (act === "tag" || act === "obstype") { const on = act === "obstype" || t.getAttribute("aria-pressed") !== "true"; t.closest(".nv-tags").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t && on))); return; }
    if (act === "opennavya") { ctx.S.view = "navya"; return ctx.renderApp(); }
    if (act === "draftread") return startRun("read", sundayOf(today));
    if (act === "syncmoney") return startRun("finance");
    if (act === "approveread") { await ctx.store.update(`review/${t.dataset.week}.json`, null, (r) => ({ ...r, status: "approved", approvedAt: new Date().toISOString() }), `family: read ${t.dataset.week} approved`); return draw(); }
    if (act === "editreview") { F.notesEdit = t.dataset.week; F.logEdit = null; return draw(); }
    if (act === "editlog") { F.logEdit = t.dataset.id; F.notesEdit = null; return draw(); }
    if (act === "cancel") { F.notesEdit = F.logEdit = null; return draw(); }
    if (["savereview", "addlog", "savelog", "dellog"].includes(act)) {
      const b = t.closest(".nv-logadd, li, .nv-note") || root, v = (s) => b.querySelector(s)?.value?.trim() || "";
      const tag = b.querySelector(".nv-tags [aria-pressed=true]")?.dataset.tag || null;
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
    // ── home
    if (act === "addtodo") { const text = val(box, "text"); if (!text) return; return save("home", (h) => ({ ...h, todos: [...(h.todos || []), { id: newId(), text, who: val(box, "who") || "both", ...(val(box, "due") ? { due: val(box, "due") } : {}), done: false }] }), "to-do"); }
    if (act === "addchore") { const text = val(box, "text"); if (!text) return; return save("home", (h) => ({ ...h, chores: [...(h.chores || []), { id: newId(), text, who: val(box, "who") || "both", every: val(box, "every") || "weekly" }] }), "chore"); }
    if (act === "chore") return save("home", (h) => ({ ...h, chores: h.chores.map((c) => (c.id === t.dataset.id ? { ...c, last: today } : c)) }), "chore done");
    if (act === "addappt") { const what = val(box, "what"), date = val(box, "date"); if (!what || !date) return flash("Add a date and what it is.", true); return save("home", (h) => ({ ...h, appointments: [...(h.appointments || []), { id: newId(), date, ...(val(box, "time") ? { time: val(box, "time") } : {}), what, who: val(box, "who") || "both", done: false }] }), "appointment"); }
    if (act === "appdone") return save("home", (h) => ({ ...h, appointments: h.appointments.map((a) => (a.id === t.dataset.id ? { ...a, done: true } : a)) }), "appointment done");
  });
}
