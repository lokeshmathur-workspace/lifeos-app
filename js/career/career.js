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

function careerHtml(d, tasks) {
  const today = todayISO(), plan = d.plan, sum = careerSummary(plan, d.proposals, today);
  const taskIds = new Set(tasks.map((t) => t.id));
  const gate = sum.nextGate;
  return `<div class="career">
    <div class="datehead cr-head">
      <div>
        <div class="sub">Career · plan v${esc(plan.meta?.planVersion || "—")}</div>
        <h1 class="serif">${esc(plan.northStar?.now || "Career")}</h1>
        <p class="cr-role">Target role: <b>${esc(plan.targetRole?.primary || "—")}</b>${plan.targetRole?.alternate ? ` · alternate: ${esc(plan.targetRole.alternate)}` : ""}</p>
      </div>
      ${gate ? `<div class="cr-gate"><span class="k">Next gate</span><b>${esc(gate.title)}</b><span>${esc(fmt(gate.due))} · ${gate.daysLeft < 0 ? `${-gate.daysLeft} days overdue` : gate.daysLeft === 0 ? "today" : `${gate.daysLeft} day${gate.daysLeft === 1 ? "" : "s"} left`}</span></div>` : ""}
    </div>
    ${proposalsHtml(d)}
    ${quarterHtml(plan, taskIds, today, sum)}
    ${indicatorsHtml(plan)}
    ${habitsHtml(plan)}
    ${metricsHtml(d.metrics, today)}
    ${relationshipsHtml(d.relationships, today)}
    ${impactHtml(d.impact, today)}
    ${radarHtml(d.radar)}
    ${coachHtml()}
  </div>`;
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
    ${groups.length ? `<details class="moredetail"><summary>Later — ${later.length} action${later.length === 1 ? "" : "s"}</summary>
      ${groups.map((g) => `<div class="pillargroup"><div class="pillarhead"><span class="nm">${esc(g.label)}</span><span class="prog">${esc(g.sub || "")}</span></div>${g.items.map((a) => actionRow(a, taskIds, today)).join("")}</div>`).join("")}
    </details>` : ""}
  </section>`;
}

function indicatorsHtml(plan) {
  const list = plan.leadingIndicators || [];
  if (!list.length) return "";
  return `<section class="blk"><h2>Leading indicators</h2><div class="card cr-list">
    ${list.map((li) => `<div class="cr-row"><span class="tx">${esc(li.text)}</span><span class="duechip">by ${esc(fmt(li.by))}</span>
      <select data-act="indicator" data-id="${esc(li.id)}">${["not_started", "in_progress", "done", "missed"].map((s) => `<option value="${s}" ${li.status === s ? "selected" : ""}>${STATUS_WORD[s]}</option>`).join("")}</select></div>`).join("")}
  </div></section>`;
}

function habitsHtml(plan) {
  const hs = plan.habits || [];
  if (!hs.length) return "";
  return `<section class="blk"><h2>Habits <span class="count">${hs.filter((h) => h.active).length}</span></h2><div class="cr-habits">
    ${CADENCES.map((c) => { const items = hs.filter((h) => h.cadence === c); return items.length ? `<div class="card"><h3>${c[0].toUpperCase() + c.slice(1)}</h3><ul>${items.map((h) => `<li class="${h.active ? "" : "paused"}">${esc(h.title)}${h.active ? "" : " <span class=\"tag\">paused</span>"}</li>`).join("")}</ul></div>` : ""; }).join("")}
  </div></section>`;
}

function metricsHtml(m, today) {
  if (!m) return "";
  const latest = {};
  for (const e of [...(m.entries || [])].sort((a, b) => (a.date < b.date ? -1 : 1))) latest[e.key] = e;
  return `<section class="blk"><h2>Outside profile</h2>
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

// Small markdown → HTML for the radar note: headings, bullets, bold/italic, links.
function md(text) {
  const inline = (s) => esc(s)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1<i>$2</i>");
  const out = [];
  let list = false;
  for (const raw of String(text || "").split("\n")) {
    const l = raw.trimEnd();
    const h = l.match(/^(#{1,4})\s+(.*)$/), li = l.match(/^\s*[-*]\s+(.*)$/);
    if (!li && list) { out.push("</ul>"); list = false; }
    if (h) out.push(`<h${Math.min(4, h[1].length + 2)}>${inline(h[2])}</h${Math.min(4, h[1].length + 2)}>`);
    else if (li) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
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
      const { json } = await ctx.cs.gh.getFile("career/state/proposals.json");
      const fresh = (json?.proposals || []).filter((p) => !r.seen.includes(p.id));
      if (fresh.length) {
        ls.del(RUN_KEY);
        clearInterval(pollTimer);
        pollTimer = null;
        flash(`Your coach sent ${fresh.length} proposal${fresh.length === 1 ? "" : "s"}.`);
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
  const fire = /^career\s/i.test(text) ? text : `career ask ${text}`;
  let fired;
  try {
    fired = await fireRoutine(fire);
  } catch (e) {
    flash(e instanceof RoutineError ? e.message : "Couldn't reach your coach.", true);
    btn.disabled = false;
    return;
  }
  const seen = (ctx.cs.cache?.proposals?.proposals || []).map((p) => p.id);
  ls.set(RUN_KEY, { firedAt: Date.now(), text: fire, sessionUrl: fired.sessionUrl || "", seen });
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
    { heading: "North star", blocks: [{ type: "para", text: plan.northStar?.now }, { type: "kv", label: "Target role", value: plan.targetRole?.primary }, { type: "kv", label: "Next gate", value: sum.nextGate ? `${sum.nextGate.title} (${shortDate(sum.nextGate.due)}, ${sum.nextGate.daysLeft} days)` : "" }] },
    { heading: `This quarter${q ? ` · ${q.id}` : ""}: ${sum.done} of ${sum.total} done${sum.overdue ? `, ${sum.overdue} overdue` : ""}`, blocks: [{ type: "tasks", items: open.map((a) => ({ task: `${a.title} — ${shortDate(a.due)}`, status: a.status })) }] },
    { heading: "Recent impact", blocks: [{ type: "list", items: [...(d.impact?.entries || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((e) => `${e.date} · ${e.kind}: ${e.text}`) }] },
  ];
  if (sum.pendingProposals) groups.push({ heading: "Waiting for you", blocks: [{ type: "para", text: `${sum.pendingProposals} proposal${sum.pendingProposals === 1 ? "" : "s"} to approve or reject in the Career tab.` }] });
  await copyRichText(buildSections(`Career — ${prettyDate(today)}`, groups));
}
