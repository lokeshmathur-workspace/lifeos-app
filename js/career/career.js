// Career tab — runs Lokesh's career plan (career/ in the Claude repo) inside Life OS.
// Owner device only (partner, family and kid modes hide unknown tabs). Build brief:
// career/docs/LIFEOS-BRIEF.md; data shapes and write rules: career/docs/SCHEMA.md.
//
// One copy of every action: plan.json holds it; once an action is a Life OS master task
// (same id) the master list is authoritative and recompute mirrors its status back.
import { todayISO, shortDate, prettyDate, localStamp, addDays, mondayOf } from "../dateutil.js";
import { flash } from "../flash.js";
import { setTaskStatus } from "../tasks.js";
import { fireRoutine, RoutineError } from "../learning/routine.js";
import { quarterOf, careerSummary, applyOps, describeOp, bumpVersion, isOpenAction, daysBetween } from "./sync.js";
import { buildSections, copyRichText } from "../export.js";
import { stepperHtml } from "../steps.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (iso) => (iso ? shortDate(iso) : "—");
const STATUS_WORD = { not_started: "Not started", in_progress: "In progress", done: "Done", dropped: "Dropped", missed: "Missed" };
const NEXT_STATUS = { not_started: "in_progress", in_progress: "done", done: "not_started" };
const CADENCES = ["weekly", "monthly", "quarterly", "yearly"];
const RUN_KEY = "career.run", RUN_TTL = 20 * 60 * 1000;

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

let ctx = null; // { cs, store, S, renderApp }
let pollTimer = null;

export async function renderCareerView(careerStore, S, renderApp) {
  const main = document.getElementById("main");
  if (!careerStore) { main.innerHTML = `<p class="empty">The Career tab needs the Claude repo token.</p>`; return; }
  ctx = { cs: careerStore, store: S.store, S, renderApp };
  if (!main.querySelector(".career")) main.innerHTML = `<p class="empty">Loading…</p>`;
  let data, master;
  try {
    [data, master] = await Promise.all([careerStore.load(), S.store.getTasks()]);
  } catch (e) {
    main.innerHTML = `<p class="empty">Couldn't load the career plan: ${esc(e.message)}</p>`;
    return;
  }
  if (S.view !== "career") return;
  if (!data.plan) { main.innerHTML = `<p class="empty">No career plan yet — <code>career/state/plan.json</code> isn't in the repo.</p>`; return; }
  main.innerHTML = careerHtml(data, master.tasks || []);
  wire(data, master.tasks || []);
  startPolling();
}

/* ─── render ─────────────────────────────────────────────── */

// ① Plan — what you're aiming at and what's scheduled (and plan changes to approve)
// ② How it's going — this quarter's actions, indicators, people, outside profile
// ③ Review — the week looked back on: done, slipped, wins, people, the coach's notes
function careerHtml(d, tasks) {
  const today = todayISO(), plan = d.plan, sum = careerSummary(plan, d.proposals, today);
  const taskIds = new Set(tasks.map((t) => t.id));
  const gate = sum.nextGate, S = ctx.S;
  const pending = (d.proposals?.proposals || []).filter((p) => p.status === "pending").length;
  const dow = new Date(today + "T12:00:00Z").getUTCDay(); // 0 Sun … 6 Sat
  const reviewTime = dow === 0 || dow >= 5;
  let step = S.careerStep;
  if (!step) step = pending ? "plan" : reviewTime ? "review" : "progress";
  S.careerStep = step;
  const body = step === "plan" ? planStep(d, taskIds, today) : step === "review" ? reviewStep(d, today) : progressStep(d, taskIds, today, sum);
  return `<div class="career">
    <div class="datehead cr-head">
      <div>
        <div class="sub">Career · plan v${esc(plan.meta?.planVersion || "—")}</div>
        <h1 class="serif">${esc(plan.northStar?.title || plan.northStar?.now || "Career")}</h1>
        ${plan.northStar?.title && plan.northStar?.now ? `<p class="cr-next">Next milestone: <b>${esc(plan.northStar.now)}</b></p>` : ""}
        <p class="cr-role">Target role: <b>${esc(plan.targetRole?.primary || "—")}</b>${plan.targetRole?.alternate ? ` · alternate: ${esc(plan.targetRole.alternate)}` : ""}</p>
      </div>
      ${gate ? `<div class="cr-gate"><span class="k">Next gate</span><b>${esc(gate.title)}</b><span>${esc(fmt(gate.due))} · ${gate.daysLeft < 0 ? `${-gate.daysLeft} days overdue` : gate.daysLeft === 0 ? "today" : `${gate.daysLeft} day${gate.daysLeft === 1 ? "" : "s"} left`}</span></div>` : ""}
    </div>
    ${stepperHtml([
      { key: "plan", label: "Plan", note: pending ? `${pending} to approve` : `v${plan.meta?.planVersion || ""}`, done: false },
      { key: "progress", label: "How it's going", note: `${sum.done}/${sum.total} done${sum.overdue ? ` · ${sum.overdue} overdue` : ""}`, done: false },
      { key: "review", label: "Review", note: reviewTime ? "ready" : "", done: false },
    ], step)}
    <div class="stepbody">${body}</div>
  </div>`;
}

function planStep(d, taskIds, today) {
  return `${proposalsHtml(d)}
    ${scheduleHtml(d.plan, taskIds, today)}
    ${indicatorsHtml(d.plan, false)}
    ${habitsHtml(d.plan)}
    ${targetsHtml(d.metrics)}`;
}

function progressStep(d, taskIds, today, sum) {
  const pct = sum.total ? Math.round((100 * sum.done) / sum.total) : 0;
  return `<section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <div class="progressband">
        <div class="top"><div><span class="num">${sum.done}</span> <span style="color:var(--muted);font-size:14px">of ${sum.total} action${sum.total === 1 ? "" : "s"} done this quarter</span></div><span class="lbl">${sum.total ? pct + "%" : "—"}</span></div>
        <div class="track"><div class="seg" style="width:${pct}%;background:var(--good)"></div><div class="seg" style="width:${100 - pct}%;background:var(--sunk)"></div></div>
        ${sum.overdue ? `<p class="cr-late">${sum.overdue} overdue — give each a new date or a smaller next step.</p>` : ""}
      </div>
    </section>
    ${quarterHtml(d.plan, taskIds, today, sum)}
    ${indicatorsHtml(d.plan, true)}
    ${relationshipsHtml(d.relationships, today)}
    ${metricsHtml(d.metrics, today)}`;
}

function reviewStep(d, today) {
  return `${weekReviewHtml(d, today)}
    ${impactHtml(d.impact, today)}
    ${coachLogHtml(d.log)}
    ${coachHtml()}
    ${radarHtml(d.radar)}`;
}

function proposalsHtml(d) {
  const pending = (d.proposals?.proposals || []).filter((p) => p.status === "pending");
  if (!pending.length) return "";
  const S = ctx.S;
  return `<section class="blk"><h2>Proposals <span class="count">${pending.length}</span></h2>
    ${pending.map((p) => `
    <div class="card cr-prop" data-id="${esc(p.id)}">
      <div class="cr-proptop"><span class="tag ${p.kind === "change" ? "new" : ""}">${esc(p.kind)}</span><b>${esc(p.title)}</b></div>
      <p>${esc(p.reason)}</p>
      ${p.ops?.length ? `<ul class="cr-ops">${p.ops.map((op) => `<li>${esc(describeOp(op, d.plan))}</li>`).join("")}</ul>` : ""}
      ${p.sources?.length ? `<p class="cr-src">Sources: ${p.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`).join(" · ")}</p>` : ""}
      <p class="cr-by">${esc(p.createdBy || "")}${p.created ? ` · ${esc(fmt(p.created.slice(0, 10)))}` : ""}</p>
      ${S.crReject === p.id
        ? `<label class="fld"><span>Why not? (optional — the coach reads this so it doesn't propose it again)</span><textarea class="cr-note" rows="2"></textarea></label>
           <div class="btnrow"><button class="btn sm" data-act="rejectconfirm" data-id="${esc(p.id)}">Reject</button><button class="btn sm" data-act="rejectcancel">Cancel</button></div>`
        : `<div class="btnrow">${
            p.kind === "info" ? `<button class="btn sm" data-act="dismiss" data-id="${esc(p.id)}">Dismiss</button>`
            : `<button class="btn sm pri" data-act="approve" data-id="${esc(p.id)}">${p.kind === "discuss" ? "Let's talk" : "Approve"}</button><button class="btn sm" data-act="reject" data-id="${esc(p.id)}">Reject</button>`
          }</div>`}
    </div>`).join("")}
  </section>`;
}

function actionRow(a, taskIds, today) {
  const late = isOpenAction(a) && a.due < today;
  return `<div class="cr-act${a.status === "done" ? " done" : ""}${a.gate ? " gate" : ""}${late ? " late" : ""}" data-id="${esc(a.id)}">
    <button class="cr-st s-${esc(a.status)}" data-act="status" data-id="${esc(a.id)}" title="Tap to change" ${a.status === "dropped" ? "disabled" : ""}>${esc(STATUS_WORD[a.status] || a.status)}</button>
    <span class="tx">${a.gate ? `<b class="gatechip">Gate</b> ` : ""}${esc(a.title)}${taskIds.has(a.id) ? ` <span class="tag">in Life OS</span>` : ""}</span>
    <span class="duechip${late ? " late" : ""}">${late ? `${daysBetween(a.due, today)}d overdue` : esc(fmt(a.due))}</span>
  </div>`;
}

function quarterHtml(plan, taskIds, today, sum) {
  const q = quarterOf(plan, today);
  const tracks = plan.tracks || [];
  const live = (plan.actions || []).filter((a) => a.status !== "dropped");
  // this quarter = due in it, plus anything still open from before it (overdue first)
  const now = q ? live.filter((a) => (q.start <= a.due && a.due <= q.end) || (a.due < q.start && isOpenAction(a))) : live.filter((a) => isOpenAction(a) && a.due < today);
  const later = live.filter((a) => !now.includes(a) && (!q || a.due > q.end));
  const order = (a, b) => {
    const la = isOpenAction(a) && a.due < today, lb = isOpenAction(b) && b.due < today;
    if (la !== lb) return la ? -1 : 1;
    return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  };
  const byTrack = tracks.map((t) => ({ t, items: now.filter((a) => a.track === t.key).sort(order) })).filter((g) => g.items.length);
  // Later: by quarter while the plan has quarters, then by year
  const groups = [];
  for (const qq of (plan.quarters || []).filter((x) => !q || x.start > q.end)) {
    const items = later.filter((a) => qq.start <= a.due && a.due <= qq.end).sort(order);
    if (items.length) groups.push({ label: qq.id, sub: qq.objective, items });
  }
  const lastEnd = (plan.quarters || []).reduce((m, x) => (x.end > m ? x.end : m), "");
  const years = [...new Set(later.filter((a) => a.due > lastEnd).map((a) => a.due.slice(0, 4)))].sort();
  for (const y of years) groups.push({ label: y, sub: "", items: later.filter((a) => a.due > lastEnd && a.due.startsWith(y)).sort(order) });
  return `<section class="blk"><h2>This quarter <span class="count">${esc(q?.id || "")}</span><span class="spring"></span><span class="cr-qsum">${sum.done} of ${sum.total} done${sum.overdue ? ` · <b class="late">${sum.overdue} overdue</b>` : ""}</span></h2>
    ${q?.objective ? `<p class="fldnote" style="margin:-6px 0 10px">${esc(q.objective)}</p>` : ""}
    ${byTrack.length ? byTrack.map(({ t, items }) => `<div class="pillargroup"><div class="pillarhead"><span class="nm">${esc(t.name)}</span><span class="prog">${items.filter((a) => a.status === "done").length}/${items.length}</span></div>${items.map((a) => actionRow(a, taskIds, today)).join("")}</div>`).join("") : `<p class="empty">Nothing due this quarter.</p>`}
    ${later.length ? `<p class="fldnote">${later.length} more action${later.length === 1 ? "" : "s"} after this quarter — see ① Plan.</p>` : ""}
  </section>`;
}

// ① Plan: the whole schedule, quarter by quarter, then by year (status shown, not changed here).
function scheduleHtml(plan, taskIds, today) {
  const live = (plan.actions || []).filter((a) => a.status !== "dropped");
  const byDue = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  const cur = quarterOf(plan, today);
  const groups = [];
  for (const q of plan.quarters || []) {
    if (q.end < today && !live.some((a) => q.start <= a.due && a.due <= q.end && isOpenAction(a))) continue; // a finished quarter with nothing open
    const items = live.filter((a) => q.start <= a.due && a.due <= q.end).sort(byDue);
    if (items.length) groups.push({ label: q.id, sub: q.objective, items, open: q === cur });
  }
  const lastEnd = (plan.quarters || []).reduce((m, x) => (x.end > m ? x.end : m), "");
  for (const y of [...new Set(live.filter((a) => a.due > lastEnd).map((a) => a.due.slice(0, 4)))].sort())
    groups.push({ label: y, sub: "", items: live.filter((a) => a.due > lastEnd && a.due.startsWith(y)).sort(byDue), open: false });
  const trackName = Object.fromEntries((plan.tracks || []).map((t) => [t.key, t.name]));
  const row = (a) => `<div class="cr-act${a.status === "done" ? " done" : ""}${a.gate ? " gate" : ""}" data-id="${esc(a.id)}">
      <span class="cr-chip s-${esc(a.status)}">${esc(STATUS_WORD[a.status] || a.status)}</span>
      <span class="tx">${a.gate ? `<b class="gatechip">Gate</b> ` : ""}${esc(a.title)}<span class="sub">${esc(trackName[a.track] || a.track)}${taskIds.has(a.id) ? " · in Life OS" : ""}</span></span>
      <span class="duechip">${esc(fmt(a.due))}</span></div>`;
  return `<section class="blk"><h2>The schedule <span class="count">${live.length}</span></h2>
    ${groups.map((g) => `<details class="cr-q"${g.open ? " open" : ""}><summary class="pillarhead"><span class="nm">${esc(g.label)}${g.sub ? ` <span class="cr-qobj">${esc(g.sub)}</span>` : ""}</span><span class="prog">${g.items.filter((a) => a.status === "done").length}/${g.items.length}</span></summary>${g.items.map(row).join("")}</details>`).join("")}
  </section>`;
}

function indicatorsHtml(plan, editable) {
  const list = plan.leadingIndicators || [];
  if (!list.length) return "";
  return `<section class="blk"><h2>Leading indicators</h2>${editable ? "" : `<p class="fldnote" style="margin:-6px 0 10px">Early signs the plan is working. Update them in ② How it's going.</p>`}<div class="card cr-list">
    ${list.map((li) => `<div class="cr-row"><span class="tx">${esc(li.text)}</span><span class="duechip">by ${esc(fmt(li.by))}</span>
      ${editable ? `<select data-act="indicator" data-id="${esc(li.id)}">${["not_started", "in_progress", "done", "missed"].map((s) => `<option value="${s}" ${li.status === s ? "selected" : ""}>${STATUS_WORD[s]}</option>`).join("")}</select>` : `<span class="cr-chip s-${esc(li.status)}">${esc(STATUS_WORD[li.status] || li.status)}</span>`}</div>`).join("")}
  </div></section>`;
}

function habitsHtml(plan) {
  const hs = plan.habits || [];
  if (!hs.length) return "";
  return `<section class="blk"><h2>Habits <span class="count">${hs.filter((h) => h.active).length}</span></h2><div class="cr-habits">
    ${CADENCES.map((c) => { const items = hs.filter((h) => h.cadence === c); return items.length ? `<div class="card"><h3>${c[0].toUpperCase() + c.slice(1)}</h3><ul>${items.map((h) => `<li class="${h.active ? "" : "paused"}">${esc(h.title)}${h.active ? "" : " <span class=\"tag\">paused</span>"}</li>`).join("")}</ul></div>` : ""; }).join("")}
  </div></section>`;
}

// ① Plan: the outside-profile measures and where they should be by 2027 and 2029.
function targetsHtml(m) {
  if (!m?.measures?.length) return "";
  return `<section class="blk"><h2>Outside profile targets</h2>
    <div class="cr-tablewrap"><table class="cr-table"><thead><tr><th>Measure</th><th>Baseline</th><th>2027</th><th>2029</th></tr></thead><tbody>
    ${m.measures.map((x) => `<tr><td>${esc(x.name)}<span class="unit">${esc(x.unit || "")}</span></td><td>${esc(x.baseline)}</td><td>${esc(x.target2027)}</td><td>${esc(x.target2029)}</td></tr>`).join("")}
    </tbody></table></div></section>`;
}

function metricsHtml(m, today) {
  if (!m) return "";
  const latest = {};
  for (const e of [...(m.entries || [])].sort((a, b) => (a.date < b.date ? -1 : 1))) latest[e.key] = e;
  return `<section class="blk"><h2>Outside profile — readings</h2>
    <div class="cr-tablewrap"><table class="cr-table"><thead><tr><th>Measure</th><th>Baseline</th><th>2027</th><th>2029</th><th>Latest</th></tr></thead><tbody>
    ${(m.measures || []).map((x) => `<tr><td>${esc(x.name)}<span class="unit">${esc(x.unit || "")}</span></td><td>${esc(x.baseline)}</td><td>${esc(x.target2027)}</td><td>${esc(x.target2029)}</td><td>${latest[x.key] ? `<b>${esc(latest[x.key].value)}</b><span class="unit">${esc(fmt(latest[x.key].date))}</span>` : "—"}</td></tr>`).join("")}
    </tbody></table></div>
    <details class="cr-add"><summary class="btn sm">+ Reading</summary><div class="card cr-form" id="metricform">
      <label class="fld"><span>Measure</span><select name="key">${(m.measures || []).map((x) => `<option value="${esc(x.key)}">${esc(x.name)}</option>`).join("")}</select></label>
      <label class="fld"><span>Value</span><input name="value" placeholder="e.g. 2 this quarter"></label>
      <label class="fld"><span>Note (optional)</span><input name="note"></label>
      <label class="fld"><span>Date</span><input type="date" name="date" value="${today}"></label>
      <div class="btnrow"><button class="btn sm pri" data-act="addmetric">Save reading</button></div></div></details>
  </section>`;
}

function personForm(p, today) {
  return `<div class="card cr-form" id="personform" data-id="${esc(p?.id || "")}">
    <label class="fld"><span>Name</span><input name="name" value="${esc(p?.name || "")}"></label>
    <label class="fld"><span>Where (company or community)</span><input name="where" value="${esc(p?.where || "")}"></label>
    <label class="fld"><span>Why they matter</span><input name="why" value="${esc(p?.why || "")}"></label>
    <label class="fld"><span>Last contact</span><input type="date" name="lastContact" value="${esc(p?.lastContact || "")}" max="${today}"></label>
    <label class="fld"><span>Next</span><input name="next" value="${esc(p?.next || "")}" placeholder="what you'll do next"></label>
    <label class="fld"><span>Notes</span><textarea name="notes" rows="2">${esc(p?.notes || "")}</textarea></label>
    <div class="btnrow"><button class="btn sm pri" data-act="saveperson">Save</button><button class="btn sm" data-act="cancelperson">Cancel</button></div></div>`;
}

function relationshipsHtml(r, today) {
  if (!r) return "";
  const S = ctx.S, every = r.contactEveryDays || 180, people = r.people || [];
  const stale = (p) => !p.lastContact || daysBetween(p.lastContact, today) > every;
  const sorted = [...people].sort((a, b) => (stale(a) !== stale(b) ? (stale(a) ? -1 : 1) : (a.lastContact || "") < (b.lastContact || "") ? -1 : 1));
  return `<section class="blk"><h2>Relationships <span class="count">${people.length} of ${r.target || 25}</span><span class="spring"></span><span class="cr-qsum">${people.filter(stale).length} due a catch-up</span></h2>
    ${S.crPerson === "new" ? personForm(null, today) : `<div class="btnrow" style="margin:0 0 10px"><button class="btn sm" data-act="addperson">+ Person</button></div>`}
    ${people.length ? `<div class="card cr-list">${sorted.map((p) => S.crPerson === p.id ? personForm(p, today) : `
      <div class="cr-row${stale(p) ? " flag" : ""}"><span class="tx"><b>${esc(p.name)}</b>${p.where ? ` · ${esc(p.where)}` : ""}${p.next ? `<span class="sub">Next: ${esc(p.next)}</span>` : ""}</span>
        <span class="duechip${stale(p) ? " late" : ""}">${p.lastContact ? `last ${esc(fmt(p.lastContact))}` : "never contacted"}</span>
        <button class="btn sm" data-act="contacted" data-id="${esc(p.id)}">Contacted today</button><button class="cr-link" data-act="editperson" data-id="${esc(p.id)}">Edit</button></div>`).join("")}</div>`
      : `<p class="empty">No one yet. Add the people you want to keep warm over the years; anyone not contacted in ${every} days is flagged.</p>`}
  </section>`;
}

function impactHtml(log, today) {
  const entries = [...(log?.entries || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  return `<section class="blk"><h2>Impact log &amp; decisions</h2>
    <div class="card cr-form" id="impactform">
      <div class="cr-inline"><select name="kind"><option value="impact">Impact</option><option value="decision">Decision</option><option value="note">Note</option></select>
      <input type="date" name="date" value="${today}"></div>
      <textarea name="text" rows="2" placeholder="What moved, the number, who benefited — or the decision and why"></textarea>
      <div class="btnrow"><button class="btn sm pri" data-act="addimpact">Add</button></div>
    </div>
    ${entries.length ? `<ul class="cr-log">${entries.map((e) => `<li><span class="tag">${esc(e.kind)}</span> <span class="d">${esc(fmt(e.date))}</span> ${esc(e.text)}</li>`).join("")}</ul>` : `<p class="empty">Nothing logged yet. Fridays are a good time: what moved this week, and the number.</p>`}
  </section>`;
}

// ③ Review: the week — Fri–Sun the current week, otherwise the one just finished.
function reviewWeek(today) {
  const dow = new Date(today + "T12:00:00Z").getUTCDay();
  const mon = mondayOf(today);
  return dow === 0 || dow >= 5 ? mon : addDays(mon, -7);
}

function weekReviewHtml(d, today) {
  const mon = reviewWeek(today), sun = addDays(mon, 6), end = sun < today ? sun : today;
  const live = (d.plan.actions || []).filter((a) => a.status !== "dropped");
  const done = live.filter((a) => a.status === "done" && a.completed >= mon && a.completed <= sun);
  const slipped = live.filter((a) => isOpenAction(a) && a.due <= end).sort((a, b) => (a.due < b.due ? -1 : 1));
  const next = live.filter((a) => isOpenAction(a) && a.due > end && a.due <= addDays(end, 7)).sort((a, b) => (a.due < b.due ? -1 : 1));
  const wins = (d.impact?.entries || []).filter((e) => e.date >= mon && e.date <= sun);
  const people = (d.relationships?.people || []).filter((p) => p.lastContact >= mon && p.lastContact <= sun);
  const every = d.relationships?.contactEveryDays || 180;
  const dueCatch = (d.relationships?.people || []).filter((p) => !p.lastContact || daysBetween(p.lastContact, today) > every).length;
  const list = (items, f, empty) => (items.length ? `<ul>${items.map((x) => `<li>${f(x)}</li>`).join("")}</ul>` : `<p class="empty">${empty}</p>`);
  return `<section class="blk" style="border-top:0;padding-top:0;margin-top:0"><h2>Week of ${esc(fmt(mon))} <span class="count">${esc(fmt(mon))} – ${esc(fmt(sun))}</span></h2>
    <div class="cr-review">
      <div class="card"><h3>Done <span class="n">${done.length}</span></h3>${list(done, (a) => esc(a.title), "No career actions finished this week.")}</div>
      <div class="card"><h3>Slipped <span class="n late">${slipped.length}</span></h3>${list(slipped, (a) => `${esc(a.title)} <span class="duechip late">due ${esc(fmt(a.due))}</span>`, "Nothing overdue.")}</div>
      <div class="card"><h3>Wins logged <span class="n">${wins.length}</span></h3>${list(wins, (e) => `<span class="tag">${esc(e.kind)}</span> ${esc(e.text)}`, "Nothing in the impact log this week — add it below.")}</div>
      <div class="card"><h3>People <span class="n">${people.length}</span></h3>${list(people, (p) => esc(p.name), "No one marked as contacted this week.")}${dueCatch ? `<p class="fldnote">${dueCatch} due a catch-up — see ② How it's going.</p>` : ""}</div>
      <div class="card cr-wide"><h3>Next 7 days <span class="n">${next.length}</span></h3>${list(next, (a) => `${a.gate ? `<b class="gatechip">Gate</b> ` : ""}${esc(a.title)} <span class="duechip">${esc(fmt(a.due))}</span>`, "Nothing due in the next week.")}</div>
    </div>
  </section>`;
}

// The coach's newest entry in career/log/command-log.md (check-ins, routine runs, decisions).
function coachLogHtml(log) {
  const m = String(log || "").match(/^## .*$[\s\S]*?(?=^## |(?![\s\S]))/m);
  return `<section class="blk"><h2>From your coach</h2>
    ${m ? `<div class="card cr-radar">${md(m[0])}</div>` : `<p class="empty">No coach notes yet.</p>`}
    <div class="btnrow"><button class="btn sm" data-act="checkin" ${activeRun() ? "disabled" : ""}>Run my weekly check-in</button></div>
    <p class="fldnote">The coach reads your week (plan, Life OS week, journal, impact log) and replies with a new entry here and any plan changes as proposals in ① Plan.</p>
  </section>`;
}

// Small markdown → HTML for the radar note and the coach's log: headings, bullets (with
// wrapped continuation lines), paragraphs, bold/italic, `code`, links.
function md(text) {
  const inline = (x) => esc(x)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1<i>$2</i>");
  // group lines into blocks: heading, list item, paragraph
  const blocks = [];
  for (const raw of String(text || "").split("\n")) {
    const l = raw.trimEnd();
    const h = l.match(/^(#{1,4})\s+(.*)$/), li = l.match(/^\s*[-*]\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (!l.trim()) { blocks.push({ t: "gap" }); continue; }
    if (h) blocks.push({ t: "h", n: h[1].length, s: h[2] });
    else if (li) blocks.push({ t: "li", s: li[1] });
    else if (last && (last.t === "li" || last.t === "p")) last.s += " " + l.trim(); // wrapped line
    else blocks.push({ t: "p", s: l.trim() });
  }
  const out = [];
  let list = false;
  for (const b of blocks) {
    if (b.t !== "li" && list) { out.push("</ul>"); list = false; }
    if (b.t === "h") out.push(`<h${Math.min(4, b.n + 2)}>${inline(b.s)}</h${Math.min(4, b.n + 2)}>`);
    else if (b.t === "li") { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(b.s)}</li>`); }
    else if (b.t === "p") out.push(`<p>${inline(b.s)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("");
}

function radarHtml(radar) {
  return `<section class="blk"><h2>Market radar${radar ? ` <span class="count">${esc(prettyDate(radar.date))}</span>` : ""}</h2>
    ${radar ? `<div class="card cr-radar">${md(radar.text)}</div>` : `<p class="empty">No radar note yet. The weekly radar routine writes one on Sunday evenings.</p>`}
  </section>`;
}

function coachHtml() {
  const run = activeRun();
  return `<section class="blk"><h2>Ask my coach</h2>
    <div class="card cr-form" id="coachform">
      <p class="fldnote" style="margin:0 0 8px">Something happened — a reorg, a recruiter call, an opening, feedback? Your coach assesses it and sends back proposals here.</p>
      <textarea name="ask" rows="3" placeholder="e.g. My manager mentioned a new AI operations team forming in January"></textarea>
      <div class="btnrow"><button class="btn sm pri" data-act="ask" ${run ? "disabled" : ""}>Ask</button></div>
      ${run ? `<p class="cr-run"><span class="pulse"></span>Your coach is on it (${esc(run.text.slice(0, 60))}${run.text.length > 60 ? "…" : ""}). Results arrive as proposals above, usually within a few minutes.${run.sessionUrl ? ` <a href="${esc(run.sessionUrl)}" target="_blank" rel="noopener">View run</a>` : ""}</p>` : ""}
    </div></section>`;
}

/* ─── coach run state ───────────────────────────────────── */

const logHead = (log) => (String(log || "").match(/^## .*$/m) || [""])[0];

function activeRun() {
  const r = ls.get(RUN_KEY, null);
  if (!r) return null;
  if (Date.now() - r.firedAt > RUN_TTL) { ls.del(RUN_KEY); return null; }
  return r;
}

// While a coach run is going and the tab is open, look for new proposals every 20 s.
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
  if (!activeRun()) return;
  pollTimer = setInterval(async () => {
    const r = activeRun();
    if (!r || ctx?.S.view !== "career") { clearInterval(pollTimer); pollTimer = null; if (!r && ctx?.S.view === "career") ctx.renderApp(); return; }
    try {
      const [{ json }, log] = await Promise.all([ctx.cs.gh.getFile("career/state/proposals.json"), ctx.cs.gh.getText("career/log/command-log.md").catch(() => null)]);
      const fresh = (json?.proposals || []).filter((p) => !r.seen.includes(p.id));
      const newNote = "logHead" in r && logHead(log) !== r.logHead;
      if (fresh.length || newNote) {
        ls.del(RUN_KEY);
        clearInterval(pollTimer);
        pollTimer = null;
        flash(fresh.length ? `Your coach sent ${fresh.length} proposal${fresh.length === 1 ? "" : "s"}.` : "Your coach added a note — see ③ Review.");
        ctx.cs.invalidate();
        ctx.renderApp();
      }
    } catch { /* keep polling */ }
  }, 20000);
}

/* ─── actions ───────────────────────────────────────────── */

function wire(d, tasks) {
  const main = document.getElementById("main"), S = ctx.S;
  main.onclick = async (e) => {
    const st = e.target.closest("[data-step]");
    if (st) { S.careerStep = st.dataset.step; S.crReject = null; S.crPerson = null; ctx.renderApp(); return; }
    const t = e.target.closest("[data-act]");
    if (!t || t.tagName === "SELECT") return;
    const act = t.dataset.act;
    try {
      if (act === "status") await cycleStatus(t.dataset.id, tasks, t);
      else if (act === "approve") { t.disabled = true; await decide(t.dataset.id, "approve"); }
      else if (act === "reject") { S.crReject = t.dataset.id; ctx.renderApp(); }
      else if (act === "rejectcancel") { S.crReject = null; ctx.renderApp(); }
      else if (act === "rejectconfirm") { t.disabled = true; await decide(t.dataset.id, "reject", t.closest(".cr-prop").querySelector(".cr-note")?.value.trim() || ""); }
      else if (act === "dismiss") { t.disabled = true; await decide(t.dataset.id, "dismiss"); }
      else if (act === "addmetric") await addMetric(t);
      else if (act === "addperson") { S.crPerson = "new"; ctx.renderApp(); }
      else if (act === "editperson") { S.crPerson = t.dataset.id; ctx.renderApp(); }
      else if (act === "cancelperson") { S.crPerson = null; ctx.renderApp(); }
      else if (act === "saveperson") await savePerson(t);
      else if (act === "contacted") await contacted(t.dataset.id, t);
      else if (act === "addimpact") await addImpact(t);
      else if (act === "ask") await ask(t);
      else if (act === "checkin") { t.disabled = true; await fireCoach("career check-in", t); }
    } catch (err) {
      flash(err?.message || "Couldn't save.", true);
      t.disabled = false;
    }
  };
  main.onchange = async (e) => {
    const sel = e.target.closest("select[data-act=indicator]");
    if (!sel) return;
    try {
      await ctx.cs.update("plan", (p) => {
        const li = (p?.leadingIndicators || []).find((x) => x.id === sel.dataset.id);
        if (!li || li.status === sel.value) return null;
        li.status = sel.value;
        return p;
      }, `career: indicator ${sel.dataset.id} ${sel.value} (life-os app)`);
      flash("Indicator updated.");
    } catch (err) {
      flash(err?.message || "Couldn't save.", true);
    }
  };
}

// Status tap: a master task decides (its status flows to the plan via recompute, and is
// mirrored here right away); an action not in Life OS changes in plan.json only.
async function cycleStatus(id, tasks, btn) {
  const plan = ctx.cs.cache?.plan;
  const a = plan?.actions.find((x) => x.id === id);
  if (!a || a.status === "dropped") return;
  btn.disabled = true;
  const next = NEXT_STATUS[a.status] || "in_progress";
  const today = todayISO();
  if (tasks.some((t) => t.id === id)) {
    const ok = await setTaskStatus(ctx.store, [id], next, `life-os: ${next === "done" ? "done" : "status"} ${id}`);
    if (!ok) { btn.disabled = false; return; }
  }
  await ctx.cs.update("plan", (p) => {
    const x = (p?.actions || []).find((y) => y.id === id);
    if (!x || x.status === "dropped") return null;
    x.status = next;
    x.completed = next === "done" ? x.completed || today : "";
    return p;
  }, `career: ${id} ${next} (life-os app)`);
  ctx.renderApp();
}

async function decide(id, how, note = "") {
  const { cs, store } = ctx, today = todayISO();
  const proposals = (await cs.gh.getFile("career/state/proposals.json")).json;
  const p = (proposals?.proposals || []).find((x) => x.id === id);
  if (!p || p.status !== "pending") { flash("That proposal was already decided elsewhere."); cs.invalidate(); ctx.renderApp(); return; }
  let status = "rejected", decisionNote = note, msg = "Rejected.";
  if (how === "dismiss") { status = "rejected"; decisionNote = ""; msg = "Dismissed."; }
  else if (how === "approve" && p.kind === "discuss") { status = "approved"; msg = "Approved — bring this to a career session."; }
  else if (how === "approve" && p.kind === "change") {
    let result = null;
    const plan = await cs.update("plan", (doc) => {
      if (!doc) return null;
      result = applyOps(doc, p.ops, today);
      doc.meta = { ...(doc.meta || {}), planVersion: bumpVersion(doc.meta?.planVersion, today) };
      return doc;
    }, `career: apply ${id} (life-os app)`);
    if (!result) throw new Error("Couldn't read the plan to apply it.");
    await syncMasterTasks(store, plan, result);
    status = "applied";
    decisionNote = result.skipped.length ? `Skipped: ${result.skipped.join("; ")}` : "";
    msg = result.skipped.length ? `Applied, with ${result.skipped.length} change${result.skipped.length === 1 ? "" : "s"} skipped.` : "Applied to your plan.";
  } else if (how === "approve") { status = "approved"; msg = "Noted."; }
  await cs.update("proposals", (doc) => {
    const x = (doc?.proposals || []).find((y) => y.id === id);
    if (!x || x.status !== "pending") return null;
    x.status = status;
    x.decidedAt = localStamp();
    if (decisionNote) x.decisionNote = decisionNote;
    return doc;
  }, `career: ${status} ${id} (life-os app)`);
  ctx.S.crReject = null;
  flash(msg);
  ctx.renderApp();
}

// After an approved proposal: master tasks that are career actions follow the plan's
// wording, category and due date; a dropped one is closed and taken off this and future
// weeks' boards (career/docs/SCHEMA.md: the proposal that drops it does that).
async function syncMasterTasks(store, plan, { touched, dropped }) {
  const ids = new Set(touched);
  const master = await store.getTasks(true);
  const affected = master.tasks.filter((t) => ids.has(t.id));
  if (!affected.length) return;
  const byId = new Map(plan.actions.map((a) => [a.id, a]));
  const today = todayISO();
  await store.updateTasks((d) => {
    d.tasks = d.tasks.map((t) => {
      const a = byId.get(t.id);
      if (!a || !ids.has(t.id)) return t;
      const n = { ...t, task: a.title, pillar: a.pillar, due: a.due };
      if (a.status === "dropped") { n.status = "done"; n.completed = t.completed || today; }
      else if (a.status !== t.status) { n.status = a.status; n.completed = a.status === "done" ? a.completed || today : ""; }
      return n;
    });
    return d;
  }, "life-os: career plan change");
  const drop = new Set(dropped.filter((x) => affected.some((t) => t.id === x)));
  if (!drop.size) return;
  for (const weekOf of [mondayOf(today), addDays(mondayOf(today), 7)]) {
    const w = await store.getWeek(weekOf);
    if ((w.tasks || []).some((t) => drop.has(t.id))) await store.saveWeek(weekOf, { tasks: w.tasks.filter((t) => !drop.has(t.id)) }, true, `life-os: career action dropped`);
  }
}

const formVals = (root) => Object.fromEntries([...root.querySelectorAll("[name]")].map((el) => [el.name, el.value.trim()]));

async function addMetric(btn) {
  const v = formVals($("#metricform"));
  if (!v.value) return flash("Add a value first.", true);
  btn.disabled = true;
  await ctx.cs.update("metrics", (d) => { if (!d) return null; (d.entries ||= []).push({ date: v.date || todayISO(), key: v.key, value: v.value, note: v.note || "" }); return d; }, `career: metric ${v.key} (life-os app)`);
  flash("Reading saved.");
  ctx.renderApp();
}

async function savePerson(btn) {
  const form = $("#personform"), v = formVals(form), id = form.dataset.id;
  if (!v.name) return flash("Add a name first.", true);
  btn.disabled = true;
  await ctx.cs.update("relationships", (d) => {
    if (!d) return null;
    const people = (d.people ||= []);
    const fields = { name: v.name, where: v.where, why: v.why, lastContact: v.lastContact, next: v.next, notes: v.notes };
    const p = id && people.find((x) => x.id === id);
    if (p) Object.assign(p, fields);
    else people.push({ id: `R${people.reduce((m, x) => Math.max(m, +String(x.id).replace(/\D/g, "") || 0), 0) + 1}`, ...fields });
    return d;
  }, `career: relationship ${v.name} (life-os app)`);
  ctx.S.crPerson = null;
  flash("Saved.");
  ctx.renderApp();
}

async function contacted(id, btn) {
  btn.disabled = true;
  const today = todayISO();
  await ctx.cs.update("relationships", (d) => { const p = d?.people?.find((x) => x.id === id); if (!p || p.lastContact === today) return null; p.lastContact = today; return d; }, `career: contacted ${id} (life-os app)`);
  flash("Marked as contacted today.");
  ctx.renderApp();
}

export async function addImpactEntry(cs, entry) {
  return cs.update("impact", (d) => { if (!d) return null; (d.entries ||= []).push(entry); return d; }, `career: ${entry.kind} ${entry.date} (life-os app)`);
}

async function addImpact(btn) {
  const v = formVals($("#impactform"));
  if (!v.text) return flash("Write what happened first.", true);
  btn.disabled = true;
  await addImpactEntry(ctx.cs, { date: v.date || todayISO(), kind: v.kind || "impact", text: v.text });
  flash("Logged.");
  ctx.renderApp();
}

async function ask(btn) {
  const text = ($("#coachform [name=ask]")?.value || "").trim();
  if (!text) return flash("Write what happened first.", true);
  btn.disabled = true;
  // "career check" (and any other "career …" job) goes as typed; anything else is an ask
  await fireCoach(/^career\s/i.test(text) ? text : `career ask ${text}`, btn);
}

async function fireCoach(fire, btn) {
  let fired;
  try {
    fired = await fireRoutine(fire);
  } catch (e) {
    flash(e instanceof RoutineError ? e.message : "Couldn't reach your coach.", true);
    btn.disabled = false;
    return;
  }
  const seen = (ctx.cs.cache?.proposals?.proposals || []).map((p) => p.id);
  ls.set(RUN_KEY, { firedAt: Date.now(), text: fire, sessionUrl: fired.sessionUrl || "", seen, logHead: logHead(ctx.cs.cache?.log) });
  flash("Sent to your coach.");
  ctx.renderApp();
}

/* ─── Copy for OneNote ──────────────────────────────────── */

export async function copyCareerForOneNote(cs) {
  const d = await cs.load();
  const plan = d.plan, today = todayISO();
  if (!plan) throw new Error("no plan");
  const sum = careerSummary(plan, d.proposals, today), q = quarterOf(plan, today);
  const open = (plan.actions || []).filter((a) => a.status !== "dropped" && ((q && q.start <= a.due && a.due <= q.end) || (isOpenAction(a) && a.due < today)));
  const groups = [
    { heading: "North star", blocks: [{ type: "para", text: plan.northStar?.title || plan.northStar?.now }, ...(plan.northStar?.title ? [{ type: "kv", label: "Next milestone", value: plan.northStar.now }] : []), { type: "kv", label: "Target role", value: plan.targetRole?.primary }, { type: "kv", label: "Next gate", value: sum.nextGate ? `${sum.nextGate.title} (${shortDate(sum.nextGate.due)}, ${sum.nextGate.daysLeft} days)` : "" }] },
    { heading: `This quarter${q ? ` · ${q.id}` : ""}: ${sum.done} of ${sum.total} done${sum.overdue ? `, ${sum.overdue} overdue` : ""}`, blocks: [{ type: "tasks", items: open.map((a) => ({ task: `${a.title} — ${shortDate(a.due)}`, status: a.status })) }] },
    { heading: "Recent impact", blocks: [{ type: "list", items: [...(d.impact?.entries || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((e) => `${e.date} · ${e.kind}: ${e.text}`) }] },
  ];
  if (sum.pendingProposals) groups.push({ heading: "Waiting for you", blocks: [{ type: "para", text: `${sum.pendingProposals} proposal${sum.pendingProposals === 1 ? "" : "s"} to approve or reject in the Career tab.` }] });
  await copyRichText(buildSections(`Career — ${prettyDate(today)}`, groups));
}
