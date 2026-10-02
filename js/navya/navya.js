// The Navya tab: HQ (coach's read + scorecards), Goals & D1 plan, Academics, Character,
// Volleyball, Phone & time, Fuel & sleep, plus the parent-only Add snips and Check-in screens.
// Every number comes from computeNavya(); the AI only reads screenshots and drafts the coach's
// read (both through the processing routine), and parents approve before Navya sees it.
import { computeNavya, STATUS, addDays } from "./compute.js";
import { buildChanges, applyChanges, FILE_PATHS } from "./merge.js";
import { lineChart, hbars, columns, SERIES } from "./charts.js";
import { fireRoutine, RoutineError } from "../learning/routine.js";
import { todayISO } from "../dateutil.js";
import { flash } from "../flash.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hm = (m) => (m == null ? "–" : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
const fmtD = (iso, o = { month: "short", day: "numeric" }) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", o) : "");
const dow = (iso) => fmtD(iso, { weekday: "short" });
const sundayOf = (iso) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); };
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };

const TABS = [["hq", "🏠 HQ"], ["goals", "🎯 Goals & D1"], ["acad", "📚 Academics"], ["char", "🌱 Character"], ["vb", "🏐 Volleyball"],
  ["phone", "📱 Phone & time"], ["fuel", "🍎 Fuel & sleep"], ["snip", "📸 Add snips"], ["checkin", "✍️ Check-in"]];
const PARENT_ONLY = new Set(["snip", "checkin"]);
const RUN_KEY = "navya.run", RUN_TTL = 20 * 60 * 1000;

let ctx = null; // { store, S, renderApp }
let pollTimer = null;

export async function renderNavyaView(store, S, renderApp) {
  ctx = { store, S, renderApp };
  const N = (S.navya = S.navya || { tab: "hq", kid: ls.get("navya.kidView", false), loaded: false, staged: [], review: null, coachEdit: false });
  if (N.kid && PARENT_ONLY.has(N.tab)) N.tab = "hq";
  document.body.classList.add("navya-mode");
  const main = $("#main");
  if (!N.loaded) {
    main.innerHTML = `<div class="navya"><p class="nv-empty">Loading Navya HQ…</p></div>`;
    try { await store.loadAll(); N.loaded = true; }
    catch (e) {
      main.innerHTML = `<div class="navya"><div class="nv-tile"><h3>Can't open the Navya repo</h3><p>${esc(e.message)}</p>
        <p class="sub">Give the token on this device access to <span class="mono">${esc(store.repo)}</span>: on GitHub, <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b> → open the token this app uses → <b>Edit</b> → Repository access → <b>Only select repositories</b> → add <b>Navya</b> → check Permissions → Contents is <b>Read and write</b> → <b>Update</b>. The token itself doesn't change, so just tap Try again.</p>
        <p class="sub">If GitHub shows the token as <b>pending</b> for the organization, an owner approves it under the organization's Settings → Personal access tokens → Pending requests.</p>
        <button class="nv-btn" data-act="retry">Try again</button></div></div>`;
      $("[data-act=retry]", main).onclick = () => renderNavyaView(store, S, renderApp);
      return;
    }
  }
  draw();
  startPolling();
}

function data() { return ctx.store.data(); }

function draw() {
  const { S } = ctx, N = S.navya;
  const D = data(), C = computeNavya(D, todayISO());
  const tabs = TABS.filter(([k]) => !(N.kid && PARENT_ONLY.has(k)));
  const body = { hq, goals, acad, char, vb, phone, fuel, snip, checkin }[N.tab] || hq;
  const main = $("#main");
  main.innerHTML = `<div class="navya${N.kid ? " kid" : ""}">
    <div class="nv-top">
      <div class="nv-hello"><h1>hey <span>Navya</span> ✨</h1><p>${esc(weekLine())}</p></div>
      <div class="nv-toggle">👀 Navya view <button class="nv-sw" data-act="kid" aria-pressed="${N.kid}" aria-label="Navya view hides parent-only notes"></button></div>
    </div>
    ${goalsStrip(D, C)}
    <nav class="nv-tabs" aria-label="Navya screens">${tabs.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${N.tab === k}">${l}</button>`).join("")}</nav>
    <div id="nvbody">${body(D, C)}</div>
    <p class="nv-fresh">${freshLine(C)} · <button class="nv-link" data-act="reload">Refresh</button></p>
  </div>`;
  wire(main.firstElementChild, D, C);
  after[N.tab]?.(D, C);
}

function weekLine() {
  const t = todayISO(), sun = sundayOf(t);
  return `Week of ${fmtD(sun)} · ${["you're doing more than you think 💅", "small wins stack up 🔥", "one rep at a time 🏐"][new Date(t).getDate() % 3]}`;
}

function freshLine(C) {
  const f = C.freshness, bits = [];
  if (f.academics) bits.push(`Skyward ${fmtD(f.academics)}`);
  if (f.phone) bits.push(`Screen Time ${fmtD(f.phone)}`);
  if (f.games) bits.push(`last game ${fmtD(f.games)}`);
  bits.push(f.checkins ? `check-in ${fmtD(f.checkins)}` : "no check-ins yet");
  return "Data: " + bits.join(" · ");
}

/* ── goals strip (every screen) ─────────────────────────── */
function goalsStrip(D, C) {
  const g = D.goals || {}, gp = C.gpa, lt = C.phone.latest, v = C.volleyball, ch = C.character.latest;
  const nTraits = (g.traits || []).length;
  const gpaPct = gp.termProjected != null && g.gpaTarget ? Math.min(100, (gp.termProjected / g.gpaTarget) * 100) : 0;
  return `<section class="nv-goals" aria-label="Goals">
    <div class="nv-goalshead"><span class="nv-kicker">🎯 The goals · Road to D1 · Year 1 of 4 (9th grade)</span><button class="nv-link" data-tab="goals">See the full plan →</button></div>
    <div class="nv-goalgrid">
      <div class="nv-goal"><span class="gh">📚 Academics</span><b>GPA ${g.gpaTarget ?? "3.7"}+ unweighted</b>
        <span class="now">${gp.termProjected != null ? `this term so far ${gp.termProjected.toFixed(2)} · <span class="${gp.termProjected >= g.gpaTarget ? "good" : "warn"}">${gp.termProjected >= g.gpaTarget ? "on goal" : (g.gpaTarget - gp.termProjected).toFixed(2) + " to go"}</span>` : "no grades yet"}</span>
        <div class="nv-meter"><i style="width:${gpaPct}%"></i></div></div>
      <div class="nv-goal"><span class="gh">🌱 Character</span><b>${(g.traits || []).map((t) => t.label.toLowerCase()).join(" · ")}</b>
        <span class="now">${ch ? `${ch.shown} of ${nTraits} showed up (${fmtD(ch.date)})` : "first Sunday check-in starts this"}</span>
        <div class="nv-dots">${(g.traits || []).map((t) => `<i class="${ch && (ch.ratings[t.id] || 0) >= 2 ? "on" : ""}"></i>`).join("")}</div></div>
      <div class="nv-goal"><span class="gh">🏐 Volleyball</span><b>A-team club spot · call every ball</b>
        <span class="now">${v.commLast4 != null ? `calls made: ${v.commLast4}% last 4 games (was ${v.commFirst3}%)` : "no games logged yet"}</span>
        <div class="nv-meter"><i style="width:${v.commLast4 || 0}%"></i></div></div>
      <div class="nv-goal${(g.extracurriculars || []).length ? "" : " todo"}"><span class="gh">🎭 Extracurriculars</span>
        <b>${(g.extracurriculars || []).length ? esc(g.extracurriculars.map((e) => e.name).join(" · ")) : "Just started 🌱"}</b>
        <span class="now">${(g.extracurriculars || []).length ? esc(g.extracurriculars.map((e) => e.goal).filter(Boolean).join(" · ")) : "goals added as she settles in"}</span></div>
    </div>
    ${lt ? `<p class="nv-limitline">📱 Social media ${hm(lt.socialPerDay)}/day vs her ${hm(lt.limit)} limit${lt.socialPerDay > lt.limit ? ` <span class="bad">(${lt.timesLimit}×)</span>` : ` <span class="good">✓</span>`}</p>` : ""}
  </section>`;
}

/* ── HQ ─────────────────────────────────────────────────── */
function latestCoach(D, approvedOnly) {
  const list = (D.coach || []).filter((c) => !approvedOnly || c.status === "approved");
  return list.at(-1) || null;
}

function hq(D, C) {
  const N = ctx.S.navya, kid = N.kid;
  const co = latestCoach(D, kid);
  const run = activeRun();
  const cards = [
    ["acad", "📚 Academics", C.cards.academics, C.gpa.termProjected != null ? `GPA ${C.gpa.termProjected.toFixed(2)}` : "–",
      C.lowestClass ? `goal ${D.goals?.gpaTarget} · lowest: ${C.lowestClass.name} ${C.lowestClass.letter}${C.lowestClass.pct != null ? ` ${C.lowestClass.pct}%` : ""}` : ""],
    ["char", "🌱 Character", C.cards.character, C.character.latest ? `${C.character.latest.shown} of ${C.character.traits.length} traits` : "Not rated yet", C.character.latest ? `rated ${fmtD(C.character.latest.date)}` : "Sunday check-in"],
    ["vb", "🏐 Volleyball", C.cards.volleyball, C.volleyball.games.length ? `${C.volleyball.games.length} games` : "No games", C.volleyball.commLast4 != null ? `calls ${C.volleyball.commLast4}% (last 4)` : ""],
    ["phone", "📱 Phone & time", C.cards.phone, C.phone.latest ? `Social ${hm(C.phone.latest.socialPerDay)}` : "No snip yet", C.phone.latest ? `limit ${hm(C.phone.limit)} · short-form ${hm(C.phone.latest.shortFormPerDay)}` : ""],
    ["fuel", "🍎 Fuel & sleep", C.cards.fuel, C.daily.sleepAvg != null ? `Sleep ${C.daily.sleepAvg}h` : "No logs this week", C.daily.sleepAvg != null ? `goal ${D.goals?.daily?.sleepHours}h · breakfast ${C.daily.breakfastSolid} of ${C.daily.logged}` : "daily check-in"],
    ["goals", "🎭 Extracurriculars", C.cards.extracurriculars, (D.goals?.extracurriculars || []).length ? `${D.goals.extracurriculars.length} activities` : "Settling in", "goals added as she goes"],
  ];
  const wins = autoWins(D, C);
  return `<div class="nv-bento">
    ${coachCard(co, kid, run)}
    <div class="nv-cards s4" role="group" aria-label="Areas">${cards.map(([t, title, st, big, sub]) => `
      <button class="nv-card" data-tab="${t}"><span class="ch">${title}</span><span class="nv-status ${st}">● ${STATUS[st]}</span><b>${esc(big)}</b><span class="sub">${esc(sub)}</span><span class="dive">Dive in →</span></button>`).join("")}</div>
    ${co?.talk?.length ? `<div class="nv-tile s2 talk"><h3>💬 Let's talk about…</h3><ol>${co.talk.map((t) => `<li>${esc(t)}</li>`).join("")}</ol><p class="sub">Conversation starters, not a report card.</p></div>` : ""}
    ${!kid && co?.parentChecks?.length ? `<div class="nv-tile s2 parent"><h3>🔒 For you to check</h3><ul class="nv-check">${co.parentChecks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
    <div class="nv-tile s2"><h3>🏆 Wins wall</h3><div class="nv-wins">${wins.map((w) => `<span class="sticker">${esc(w)}</span>`).join("") || `<span class="sub">Wins from check-ins and grades show up here.</span>`}</div></div>
  </div>`;
}

function autoWins(D, C) {
  const w = [];
  for (const c of C.classes) if (c.letter === "A") w.push(`💯 ${c.name}: A`);
  if (C.volleyball.cleanest) w.push(`🏐 ${C.volleyball.cleanest.assists} assists, ${C.volleyball.cleanest.setErrors} errors vs ${C.volleyball.cleanest.opponent.replace(/ high ?school/i, "")}`);
  if (C.academicsAsOf && !(D.assignments || []).some((a) => a.status === "missing")) w.push("📚 nothing missing in Skyward");
  for (const x of C.daily.wins.slice(-4)) w.push(`⭐ ${x.text}`);
  return w.slice(0, 8);
}

function coachCard(co, kid, run) {
  const drafting = run?.kind === "coach";
  if (!co) return `<div class="nv-tile s4 coach"><span class="nv-kicker">🧢 Coach's read</span>
    <h2 class="nv-headline">${kid ? "This week's coach's read is on its way 🧢" : "No coach's read yet."}</h2>
    ${kid ? "" : drafting ? runLine(run) : `<p class="sub">Claude drafts it from this week's numbers; you edit and approve it before Navya sees it.</p><button class="nv-btn pri" data-act="draftcoach">Draft this week's read</button>`}</div>`;
  const N = ctx.S.navya;
  if (!kid && N.coachEdit) return coachEditor(co);
  const list = (a) => (a || []).map((x) => `<li>${esc(x)}</li>`).join("");
  return `<div class="nv-tile s4 coach">
    <div class="nv-rowsplit"><span class="nv-kicker">🧢 Coach's read · week of ${fmtD(co.weekStart)}</span>
      ${co.status === "draft" ? `<span class="nv-chip warn">draft · only parents see this</span>` : `<span class="nv-chip">approved ${fmtD(co.approvedAt)}</span>`}</div>
    <h2 class="nv-headline">${esc(co.headline)}</h2>
    <div class="nv-cols3"><div><h4>🔥 What's working</h4><ul>${list(co.working)}</ul></div>
      <div><h4>🎯 What needs work</h4><ul>${list(co.needsWork)}</ul></div>
      <div><h4>🔗 How it connects</h4><p>${esc(co.connection)}</p></div></div>
    <div class="nv-focus"><span class="nv-kicker">🎯 This week's one focus</span><b>${esc(co.focus)}</b></div>
    ${kid ? "" : `<div class="nv-btnrow">${co.status === "draft" ? `<button class="nv-btn pri" data-act="approvecoach">Approve for Navya</button>` : ""}
      <button class="nv-btn" data-act="editcoach">Edit</button>
      ${drafting ? "" : `<button class="nv-btn" data-act="draftcoach">${co.weekStart === sundayOf(todayISO()) ? "Redraft" : "Draft this week's read"}</button>`}</div>${drafting ? runLine(run) : ""}`}
  </div>`;
}

function coachEditor(co) {
  const ta = (k, label, v, rows = 3) => `<label class="nv-fld"><span>${label}</span><textarea data-co="${k}" rows="${rows}">${esc(Array.isArray(v) ? v.join("\n") : v || "")}</textarea></label>`;
  return `<div class="nv-tile s4 coach"><span class="nv-kicker">✏️ Edit the coach's read · one item per line</span>
    ${ta("headline", "Headline", co.headline, 2)}${ta("working", "What's working", co.working, 4)}${ta("needsWork", "What needs work", co.needsWork, 4)}
    ${ta("connection", "How it connects", co.connection, 3)}${ta("focus", "This week's one focus", co.focus, 2)}${ta("talk", "Let's talk about (with Navya)", co.talk, 4)}${ta("parentChecks", "For you to check (parents only)", co.parentChecks, 3)}
    <div class="nv-btnrow"><button class="nv-btn pri" data-act="savecoach" data-approve="1">Save &amp; approve</button><button class="nv-btn" data-act="savecoach">Save as draft</button><button class="nv-btn" data-act="canceledit">Cancel</button></div></div>`;
}

/* ── Goals & D1 ─────────────────────────────────────────── */
function goals(D) {
  const g = D.goals || {}, kid = ctx.S.navya.kid;
  return `<div class="nv-bento">
    <div class="nv-tile s4"><h3>🏆 The road to D1</h3><div class="nv-road">${(g.road || []).map((r) => `<div class="stop${r.now ? " now" : ""}${/sign/i.test(r.year) ? " end" : ""}"><span class="yr">${esc(r.year)}${r.now ? " · now" : ""}</span><b>${esc(r.title)}</b><span class="sub">${esc(r.text)}</span></div>`).join("")}</div>
      <p class="sub">From her D1 Volleyball Blueprint. The goals at the top of every screen are this year's slice of it.</p></div>
    <div class="nv-tile s2"><h3>⚡ Next 8 weeks</h3><ul class="nv-plain">${(g.next8 || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
    <div class="nv-tile s2"><h3>✅ Year 1 checklist</h3><ul class="nv-todo">${(g.checklist || []).map((c) => `<li><button class="box${c.done ? " done" : ""}" data-act="check" data-id="${esc(c.id)}" ${kid ? "disabled" : ""} aria-pressed="${!!c.done}">${c.done ? "✓" : ""}</button><span>${esc(c.text)}</span></li>`).join("")}</ul></div>
    <div class="nv-tile s2"><h3>🎯 The four pillars</h3><div class="tw"><table>${Object.entries(g.pillars || {}).map(([k, v]) => `<tr><td><b>${esc({ academics: "📚 Academics", character: "🌱 Character", volleyball: "🏐 Volleyball", extracurriculars: "🎭 Extracurriculars" }[k] || k)}</b></td><td>${esc(v)}</td></tr>`).join("")}</table></div></div>
    <div class="nv-tile s2"><h3>🌱 Her values</h3><ul class="nv-plain">${(g.traits || []).map((t) => `<li><b>${t.emoji} ${esc(t.label)}</b>: ${esc(t.looksLike)}</li>`).join("")}</ul></div>
    <div class="nv-tile s2"><h3>🎭 Extracurriculars</h3>${(g.extracurriculars || []).length ? `<ul class="nv-plain">${g.extracurriculars.map((e, i) => `<li><b>${esc(e.name)}</b>${e.goal ? `: ${esc(e.goal)}` : ""} ${kid ? "" : `<button class="nv-x" data-act="delextra" data-i="${i}" aria-label="Remove">×</button>`}</li>`).join("")}</ul>` : `<p class="sub">She's just started. Add each activity with one goal as she settles in.</p>`}
      ${kid ? "" : `<form class="nv-inline" data-act="addextra"><input name="name" placeholder="Activity (e.g. Spanish club)" required><input name="goal" placeholder="One goal (optional)"><button class="nv-btn">Add</button></form>`}</div>
    <div class="nv-tile s2"><h3>📏 Daily targets</h3><div class="tw"><table>
      <tr><td>Sleep</td><td class="n">${D.goals?.daily?.sleepHours}h</td></tr><tr><td>Study block (school nights)</td><td class="n">${D.goals?.daily?.studyMin} min</td></tr>
      <tr><td>Own volleyball work</td><td class="n">${D.goals?.daily?.ownPracticeMin} min</td></tr><tr><td>Conditioning</td><td class="n">${D.goals?.daily?.conditioningMin} min</td></tr>
      <tr><td>Phone away by</td><td class="n">${D.goals?.daily?.phoneAwayBy}</td></tr><tr><td>Social media limit</td><td class="n">${hm(D.goals?.limits?.socialMin)}</td></tr>
      <tr><td>Wall sets · footwork · serves</td><td class="n">${D.goals?.daily?.reps?.setting} · ${D.goals?.daily?.reps?.footwork} · ${D.goals?.daily?.reps?.serve}</td></tr></table></div></div>
  </div>`;
}

/* ── Academics ──────────────────────────────────────────── */
const gradeColor = (pct) => (pct >= 87 ? "#2E9E5B" : pct >= 77 ? "#0E9FBF" : pct >= 70 ? "#D17A22" : "#E8399E");
function acad(D, C) {
  if (!C.classes.some((c) => c.letter)) return emptyState("No grades yet", "Add a Skyward Grades screenshot and one class pop-up per class in 📸 Add snips.");
  const gp = C.gpa, lo = 50, X = (v) => ((Math.max(lo, v) - lo) / (100 - lo)) * 100, cuts = (D.codes?.scale || []).map((s) => s[1]).filter((v) => v >= lo && v < 100);
  const strip = C.classes.filter((c) => c.letter).map((c) => {
    const pct = c.pct ?? (c.display ? 100 : null);
    const s1 = c.s1 && c.s1.pct != null ? `<div class="dot hollow" title="Semester view ${c.s1.pct}%" style="left:${X(c.s1.pct)}%"></div>` : "";
    return `<div class="srow"><span>${esc(c.name)}</span><div class="track">${cuts.map((v) => `<div class="band" style="left:${X(v)}%"></div>`).join("")}${s1}${pct != null ? `<div class="dot" style="left:${X(pct)}%;background:${gradeColor(pct)}"></div>` : ""}</div><span class="val">${esc(c.letter)}${c.pct != null ? ` · ${c.pct}%` : c.display ? " · all pts" : ""}</span></div>`;
  }).join("");
  const cards = [...C.classes].filter((c) => c.letter).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)).map(classCard).join("");
  const A = C.attendance;
  const trend = gp.trend.filter(([, v]) => v != null);
  return `<div class="nv-bento">
    <div class="nv-tile s2 glow"><h3>🎓 GPA</h3>
      <div class="nv-big3">${tri(gp.termProjected?.toFixed(2), "this term if it ended today")}${tri(gp.cumulative?.toFixed(2) ?? "–", "cumulative (official)")}${tri(D.goals?.gpaTarget, "goal (unweighted)")}</div>
      ${gp.s1Projected != null && gp.s1Projected !== gp.termProjected ? `<p class="sub">Semester-1 view: ${gp.s1Projected.toFixed(2)}${C.classes.some((c) => c.s1?.letter === "N") ? " (PE shows N there)" : ""}. Skyward's GPA is unweighted, so AP gets no bonus.</p>` : ""}
      ${trend.length > 1 ? `<div class="nv-chart" data-chart="gpa"></div>` : `<p class="sub">The GPA line starts with the next Skyward update.</p>`}
      ${gp.lifts.length ? `<h4>Closest letter bumps</h4><ul class="nv-plain">${gp.lifts.slice(0, 3).map((l) => `<li>${esc(l.name)} → ${l.to} needs +${l.gap} pts → term GPA ${l.gpa.toFixed(2)}</li>`).join("")}</ul>` : ""}</div>
    <div class="nv-tile s2"><h3>📊 Term ${esc(C.term || "")} grades</h3><div class="nv-strip">${strip}</div>
      <div class="nv-axis">${[50, 60, 70, 80, 90, 100].map((v) => `<span style="left:${X(v)}%">${v}%</span>`).join("")}</div>
      <p class="sub">Dashed lines: the school's cut-offs. ${C.classes.some((c) => c.s1?.pct != null) ? "Hollow dot: semester view." : ""}</p></div>
    ${cards}
    <div class="nv-tile s4"><h3>🚪 Attendance</h3>
      ${A.totals ? `<p>Year so far: <b>${A.totals.absent}</b> days absent (${A.totals.excused} excused, ${A.totals.unexcused} unexcused) · <b>${A.totals.tardy}</b> tardies${A.daysSinceIssue != null ? ` · ${A.daysSinceIssue} days since the last tardy or unexcused` : ""}</p>` : ""}
      <div class="tw"><table><tr><th>Date</th><th>Period</th><th>What</th></tr>${A.events.map((e) => `<tr><td>${dow(e.date)} ${fmtD(e.date)}</td><td>${e.periods.length >= 6 ? "all day" : e.periods.join(", ")}${A.unknownPeriods.includes(String(e.periods[0])) ? " ❓" : ""}</td><td><span class="nv-chip ${e.group === "unexcused" ? "bad" : e.group === "tardy" ? "warn" : ""}">${esc(e.label)}</span>${e.comment ? " 💬" : ""}</td></tr>`).join("")}</table></div>
      ${A.unknownPeriods.length ? `<p class="sub">❓ Period ${A.unknownPeriods.join(", ")} isn't on her schedule (probably homeroom). 💬 = Skyward has a comment on it.</p>` : ""}</div>
  </div>`;
}

function classCard(c) {
  const cls = c.pct == null ? "good" : c.pct < 80 ? "bad" : c.pct < 87 ? "warn" : "good";
  const cats = c.cats.map((k) => `${esc(k.name)} ${k.pct}% (${k.earned}/${k.max})${c.weights?.[k.name] && c.cats.length > 1 ? ` · ~${Math.round(c.weights[k.name] * 100)}% of grade` : ""}`).join("<br>");
  const lines = [];
  if (c.next && c.next.gap <= 2) lines.push(`<b>${c.next.gap} points from ${c.next.letter}.</b>`);
  if (c.catSpread >= 15 && c.cats.length === 2) { const [a, b] = [...c.cats].sort((x, y) => x.pct - y.pct); lines.push(`${esc(b.name)} ${b.pct}% vs ${esc(a.name)} ${a.pct}%: a ${Math.round(c.catSpread)}-point gap.`); }
  if (c.low.length) lines.push(`Lowest: ${c.low.slice(0, 3).map((l) => `${esc(l.name)} ${l.earned}/${l.max}`).join(" · ")}`);
  if (c.ungraded.length) lines.push(`Not graded yet: ${c.ungraded.map((u) => esc(u.name) + (u.status === "missing" ? " (missing)" : "")).join(" · ")}`);
  if (c.whatIf && c.whatIf.letters[0] !== c.whatIf.letters[1]) lines.push(`If those come in at full marks: <b>~${Math.round(c.whatIf.allFull)}% (${c.whatIf.letters[1]})</b>; if not: <b>~${Math.round(c.whatIf.allZero)}% (${c.whatIf.letters[0]})</b>.`);
  if (c.upcoming.length) lines.push(`Coming up: ${c.upcoming.map((u) => `${esc(u.name)} (${fmtD(u.due)})`).join(" · ")}`);
  if (c.s1 && c.s1.letter !== c.letter) lines.push(`Semester view: <b>${esc(c.s1.letter)}${c.s1.pct != null ? ` ${c.s1.pct}%` : ""}</b>.`);
  return `<div class="nv-tile s2 nv-class"><h3><span>${esc(c.fullName)}</span><span class="nv-chip ${cls}">${esc(c.letter)}${c.pct != null ? ` · ${c.pct}%` : ""}</span></h3>
    <p class="sub">${esc(c.teacher || "")}${c.level ? ` · ${esc(c.level)}` : ""} · period ${esc(c.period)}</p><p class="sub">${cats}</p>${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
}

const tri = (big, label) => `<div><b>${esc(big ?? "–")}</b><span>${esc(label)}</span></div>`;
const emptyState = (title, text) => `<div class="nv-tile"><h3>${esc(title)}</h3><p class="sub">${esc(text)}</p></div>`;

/* ── Character ──────────────────────────────────────────── */
function char(D, C) {
  const ch = C.character, LV = { 1: ["🌱 growing", "l1"], 2: ["✅ showed it", "l2"], 3: ["🌟 standout", "l3"] };
  const weeks = [...new Set(ch.traits.flatMap((t) => t.ratings.map((r) => r[0])))].slice(-8);
  return `<div class="nv-bento">
    <div class="nv-tile s2"><h3>🌱 This week</h3>${ch.latest ? `<div class="nv-traits">${ch.traits.map((t) => { const v = ch.latest.ratings[t.id]; return `<div class="trait"><span>${t.emoji} ${esc(t.label)}</span>${v ? `<span class="lvl ${LV[v][1]}">${LV[v][0]}</span>` : `<span class="sub">–</span>`}<span class="sub">${esc(t.looksLike)}</span></div>`; }).join("")}</div>
      ${ch.latest.moment ? `<p>✨ ${esc(ch.latest.moment)}</p>` : ""}` : `<p class="sub">No ratings yet. The Sunday part of ✍️ Check-in rates each trait in one tap.</p>`}</div>
    <div class="nv-tile s2"><h3>📅 Week by week</h3>${weeks.length ? `<div class="nv-heat" style="grid-template-columns:minmax(90px,1.4fr) repeat(${weeks.length},minmax(26px,1fr))"><span></span>${weeks.map((w) => `<span class="hd">${fmtD(w)}</span>`).join("")}
      ${ch.traits.map((t) => `<span>${t.emoji} ${esc(t.label)}</span>${weeks.map((w) => { const r = t.ratings.find((x) => x[0] === w); return `<i class="h${r?.[1] || 0}" title="${esc(t.label)} ${fmtD(w)}: ${r?.[1] ? LV[r[1]][0] : "not rated"}"></i>`; }).join("")}`).join("")}</div>
      <div class="nv-legend"><span><i class="h1"></i>🌱 growing</span><span><i class="h2"></i>✅ showed it</span><span><i class="h3"></i>🌟 standout</span></div>` : `<p class="sub">Fills in after a couple of Sundays.</p>`}</div>
    <div class="nv-tile s4"><h3>🏐 On the court</h3><p class="sub">From her game logger: share of calls made per game (the blueprint's "call every ball").</p>${C.volleyball.games.length ? `<div class="nv-chart" data-chart="comm"></div>` : `<p class="sub">No games logged yet.</p>`}</div>
  </div>`;
}

/* ── Volleyball ─────────────────────────────────────────── */
function vb(D, C) {
  const v = C.volleyball, r = v.reps7;
  return `<div class="nv-bento">
    <div class="nv-tile s2"><h3>📣 Calling the ball</h3>${v.games.length ? `<div class="nv-chart" data-chart="comm"></div><p class="sub">Good calls ÷ (good + missed), per game. Last 4 games ${v.commLast4}% vs first 3 ${v.commFirst3}%.</p>` : `<p class="sub">No games logged yet.</p>`}</div>
    <div class="nv-tile s2"><h3>🎯 Daily reps vs the blueprint</h3>${r ? hbars([["Wall sets", r.setting, r.targets.setting], ["Footwork", r.footwork, r.targets.footwork], ["Serves", r.serve, r.targets.serve]].map(([l, val, t]) => ({ label: l, value: (val / t) * 100, text: `${val} of ${t}`, color: SERIES[1], mark: 100 })), 100, [0, 50, 100], (x) => x + "%") + `<p class="sub">Average of ${r.days} logged day(s) this week, as a share of each target.</p>`
      : `<p class="sub">No practice logged this week${v.dailyLogsLatest ? ` (last log ${fmtD(v.dailyLogsLatest)})` : ""}. She logs reps in her daily tracker.</p>`}
      <p class="sub"><a href="navya/navya_tracker.html" target="_blank" rel="noopener">Daily tracker</a> · <a href="navya/game_logger.html" target="_blank" rel="noopener">Game logger</a> · <a href="navya/dashboard.html" target="_blank" rel="noopener">Season dashboard</a></p></div>
    <div class="nv-tile s4"><h3>📋 Games</h3><div class="tw"><table><tr><th>Date</th><th>Opponent</th><th class="n">Sets won</th><th class="n">Assists</th><th class="n">Set err</th><th class="n">Aces</th><th class="n">Serve err</th><th class="n">Calls</th></tr>
      ${[...v.games].reverse().map((g) => `<tr><td class="nw">${fmtD(g.date)}</td><td>${esc(g.opponent)}</td><td class="n">${g.wins}/${g.sets}</td><td class="n">${g.assists}</td><td class="n">${g.setErrors}</td><td class="n">${g.aces}</td><td class="n">${g.serveErrors}</td><td class="n">${g.commPct ?? "–"}%</td></tr>`).join("")}</table></div>
      <p class="sub">Games saved twice in the tracker are counted once.</p></div>
  </div>`;
}

/* ── Phone & time ───────────────────────────────────────── */
function phone(D, C) {
  const lt = C.phone.latest;
  if (!lt) return emptyState("No Screen Time yet", "Add her iPhone's Screen Time Week view, the Most Used list and Pickups in 📸 Add snips.");
  const kc = { short: "#E8399E", social: "#8B5CF6", msg: "#2E9E5B", other: "#D17A22" };
  const appsMax = Math.max(60, Math.ceil(Math.max(...lt.apps.map((a) => a.perDay)) / 30) * 30);
  const dayMax = Math.max(lt.limit * 2, ...lt.days.map((d) => d.socialMin || 0));
  const late = D.screentime?.find((w) => w.weekStart === lt.weekStart)?.lateNight;
  const st = (D.goals?.daily || {});
  const ci = C.daily;
  return `<div class="nv-bento">
    <div class="nv-tile s4 glow"><div class="nv-rowsplit"><h3>📱 Where the phone time goes</h3><span class="nv-chip">per day · week of ${fmtD(lt.weekStart)}${lt.partial ? ` · ${lt.daysCovered} days so far` : ""}</span></div>
      <div class="nv-big3">${tri(hm(lt.totalPerDay), "on the phone")}${tri(hm(lt.socialPerDay), `social media · limit ${hm(lt.limit)}`)}${tri(hm(lt.shortFormPerDay), "short-form video")}</div>
      ${hbars(lt.apps.filter((a) => a.perDay >= 1 && a.name !== "Settings").map((a) => ({ label: a.name, value: a.perDay, text: hm(a.perDay), color: kc[a.kind] })), appsMax, [0, appsMax / 4, appsMax / 2, (3 * appsMax) / 4, appsMax], (m) => (!m ? "0" : m % 60 === 0 ? m / 60 + "h" : Math.round(m) + "m"))}
      <div class="nv-legend"><span><i style="background:#E8399E"></i>Short-form video</span><span><i style="background:#8B5CF6"></i>Social / chat</span><span><i style="background:#2E9E5B"></i>Messaging (not counted)</span><span><i style="background:#D17A22"></i>Other</span></div>
      <p class="sub">Week totals ÷ days covered. Her limit counts ${esc((D.goals?.limits?.socialApps || []).join(", "))}; messaging is shown on its own line (${hm(lt.messagingPerDay)}/day). Screen Time shows apps, not what's watched inside them, so Snapchat's Spotlight isn't counted as short-form.</p></div>
    ${lt.days.length ? `<div class="nv-tile s2"><h3>⏱️ Social media each day vs the limit</h3>${columns(lt.days.map((d) => ({ label: dow(d.date), value: d.socialMin || 0, text: hm(d.socialMin), color: d.overLimit ? "#E8399E" : "#0E9FBF" })), dayMax, lt.limit, `limit ${hm(lt.limit)}`)}
      <p class="sub">Read off Screen Time's bar chart, so each day is an estimate.${lt.fullDays ? ` Over the limit ${lt.fullDaysOverLimit} of ${lt.fullDays} full days.` : ""}</p></div>` : ""}
    ${lt.pickups ? `<div class="nv-tile s2"><h3>👆 Pickups</h3>${lt.pickups.days?.length ? columns(lt.pickups.days.map(([d, n]) => ({ label: dow(d), value: n, text: String(n), color: "#0E9FBF" })), Math.max(...lt.pickups.days.map((x) => x[1])) * 1.1, null) : ""}
      <p class="sub">${lt.pickups.dailyAvg} a day, about every ${lt.pickups.everyMin} minutes she's awake.${lt.pickups.topFirst ? ` ${esc(lt.pickups.topFirst[0])} is opened first after ${lt.pickups.topFirstShare}% of pickups.` : ""}</p></div>` : ""}
    ${C.phone.weeks.length > 1 ? `<div class="nv-tile s2"><h3>📈 Week by week</h3><div class="nv-chart" data-chart="phoneweeks"></div></div>` : ""}
    <div class="nv-tile s2"><h3>⚖️ Time balance (per day)</h3>${hbars([
      { label: "📱 Social", value: lt.socialPerDay, text: hm(lt.socialPerDay), color: "#E8399E", mark: lt.limit },
      { label: "📚 Study", value: ci.studyAvg || 0, text: ci.studyAvg == null ? "not logged" : hm(ci.studyAvg), color: "#0E9FBF", mark: st.studyMin },
      { label: "🏐 Own practice", value: ci.practiceAvg || 0, text: ci.practiceAvg == null ? "not logged" : hm(ci.practiceAvg), color: "#0E9FBF", mark: st.ownPracticeMin },
      { label: "💪 Conditioning", value: ci.conditioningAvg || 0, text: ci.conditioningAvg == null ? "not logged" : hm(ci.conditioningAvg), color: "#0E9FBF", mark: st.conditioningMin }], 210, [0, 60, 120, 180], (m) => (m ? m / 60 + "h" : "0"))}
      <p class="sub">White tick = her limit (phone) or the blueprint's daily goal. Study and practice come from the daily check-in.</p></div>
    <div class="nv-tile s2"><h3>🌙 Phone at night</h3>${late && Object.keys(late).length ? `<p>${Object.entries(late).map(([d, m]) => `${dow(d)} ${fmtD(d)}: <b>${hm(m)}</b> after 9 pm`).join("<br>")}</p>` : `<p class="sub">Add a Screen Time <b>day</b> view (it shows hour by hour) to see late-night use.</p>`}
      <p class="sub">Blueprint: phone away by ${esc(st.phoneAwayBy || "20:45")}, lights out 9:15. Check-ins logged "phone away" ${ci.phoneAway} of ${ci.logged} days.</p></div>
    <div class="nv-tile s2 talk"><h3>🧠 Why short-form gets its own line</h3><ol><li><b>No stopping point.</b> The next clip plays on its own, so 10 minutes easily becomes 60.</li><li><b>Fast switching.</b> Heavy use is linked to weaker focus on long tasks like homework and film study.</li><li><b>Later bedtimes.</b> Scrolling in bed pushes sleep back, and sleep is when athletes recover.</li></ol><p class="sub">Research on teens is still developing; these are the links most studies point to.</p></div>
  </div>`;
}

/* ── Fuel & sleep ───────────────────────────────────────── */
function fuel(D, C) {
  const d = C.daily, meal = { green: "🟢", yellow: "🟡", red: "🔴" };
  const stale = C.volleyball.parentLogsLatest;
  return `<div class="nv-bento">
    <div class="nv-tile s4"><h3>🍎 Fuel &amp; 😴 sleep · last 7 days</h3>
      ${d.days.length ? `<div class="nv-big3">${tri(d.sleepAvg != null ? d.sleepAvg + "h" : "–", `avg sleep · goal ${D.goals?.daily?.sleepHours}h`)}${tri(`${d.breakfastSolid}/${d.logged}`, "solid breakfasts")}${tri(d.energyAvg ?? "–", "energy (1–5)")}</div>
      <div class="tw"><table><tr><th>Day</th><th class="n">Sleep</th><th>Meals</th><th class="n">Study</th><th class="n">Practice</th><th class="n">Energy</th><th>Mood</th></tr>${d.days.map((x) => `<tr><td class="nw">${dow(x.date)} ${fmtD(x.date)}</td><td class="n">${x.sleepHrs ?? "–"}</td><td>${["breakfast", "lunch", "dinner"].map((k) => meal[x[k]] || "▫️").join("")}</td><td class="n">${x.studyMin ?? "–"}</td><td class="n">${x.ownPracticeMin ?? "–"}</td><td class="n">${x.energy ?? "–"}</td><td>${esc(x.mood || "")}</td></tr>`).join("")}</table></div>`
      : `<p class="sub">Nothing logged in the last 7 days. ✍️ Check-in takes about 30 seconds.${stale ? ` Her tracker's sleep and meal logs stop on ${fmtD(stale)}.` : ""}</p>`}</div>
    <div class="nv-tile s2"><h3>🥗 Blueprint fuel basics</h3><ul class="nv-plain"><li>Breakfast every day: protein + carbs + fruit</li><li>Pre-practice: banana + PB or a granola bar, 30–60 min before</li><li>Within 30 min after: chocolate milk or yogurt + fruit</li><li>Water 2–2.5 L a day, more on game days</li><li>Sleep 9 hours. It's training, not laziness.</li></ul></div>
    <div class="nv-tile s2"><h3>⭐ Wins logged</h3>${d.wins.length ? `<div class="nv-wins">${d.wins.map((w) => `<span class="sticker">${esc(w.text)}</span>`).join("")}</div>` : `<p class="sub">Wins from check-ins show up here.</p>`}</div>
  </div>`;
}

/* ── Add snips (parents) ────────────────────────────────── */
function snip() {
  const N = ctx.S.navya, run = activeRun();
  if (N.review) return reviewScreen();
  const staged = N.staged;
  return `<div class="nv-bento">
    <div class="nv-tile s2"><h3>📸 Add screenshots</h3>
      <label class="nv-drop" id="nvdrop"><input type="file" accept="image/*" multiple data-act="files" hidden>
        <span class="ic">📸</span><b>Paste, drop, or tap to pick</b><span class="sub">Skyward grades, class pop-ups, assignments, attendance; iPhone Screen Time week, apps, pickups, day view. Send a whole week's set at once.</span></label>
      ${staged.length ? `<div class="nv-thumbs">${staged.map((f, i) => `<div class="th"><img src="${f.url}" alt=""><button class="nv-x" data-act="unstage" data-i="${i}" aria-label="Remove">×</button></div>`).join("")}</div>
        <div class="nv-btnrow"><button class="nv-btn pri" data-act="upload" ${run ? "disabled" : ""}>Read these ${staged.length} screenshot${staged.length > 1 ? "s" : ""}</button><button class="nv-btn" data-act="clearstage">Clear</button></div>` : ""}
      ${N.dupNote ? `<p class="sub">${esc(N.dupNote)}</p>` : ""}
      <p class="sub">Screenshots are deleted as soon as they're read; only the rows are kept. Never send her student number or address: they're skipped if a screen shows them.</p></div>
    <div class="nv-tile s2"><h3>🗂️ Batches</h3><div id="nvbatches"><p class="sub">Checking…</p></div>${run?.kind === "batch" ? runLine(run) : ""}</div>
    <div class="nv-tile s4"><h3>🗓️ The weekly set (about 10 screenshots, Saturday night or Sunday)</h3><ul class="nv-plain">
      <li><b>Skyward → Grades</b> page, then tap each grade letter and screenshot the pop-up (6 classes)</li>
      <li><b>Skyward → Assignments</b>: the Upcoming and Missing tabs</li><li><b>Skyward → Attendance</b></li>
      <li><b>Her iPhone → Settings → Screen Time → See All App &amp; Website Activity → Week</b>: the top, the Most Used list, and Pickups (plus one Day view for late-night use)</li></ul></div>
  </div>`;
}

function reviewScreen() {
  const R = ctx.S.navya.review;
  const groups = {};
  R.changes.forEach((c) => (groups[c.area] = groups[c.area] || []).push(c));
  return `<div class="nv-bento"><div class="nv-tile s4">
    <div class="nv-rowsplit"><h3>✅ Check &amp; save · batch ${esc(R.batchId)}</h3><span class="nv-chip">${R.changes.length} change${R.changes.length === 1 ? "" : "s"}</span></div>
    ${R.flags.length ? `<div class="nv-flags"><b>Read with notes:</b><ul>${R.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
    ${R.changes.length ? Object.entries(groups).map(([area, cs]) => `<h4>${esc(area)}</h4><div class="nv-changes">${cs.map((c) => `
      <div class="chg"><label class="pick"><input type="checkbox" data-key="${esc(c.key)}" ${R.picked.has(c.key) ? "checked" : ""}><span><b>${esc(c.title)}</b> <span class="sub">${esc(c.detail)}</span></span></label>
        ${c.fields.length ? `<div class="flds">${c.fields.map((f) => `<label><span>${esc(f.label)}</span><input data-edit="${esc(c.key)}" data-k="${esc(f.k)}" value="${esc(R.edits[c.key]?.[f.k] ?? f.value ?? "")}"></label>`).join("")}</div>` : ""}</div>`).join("")}</div>`).join("")
      : `<p>Nothing new in these screenshots: everything they show is already saved.</p>`}
    <div class="nv-btnrow">${R.changes.length ? `<button class="nv-btn pri" data-act="savebatch">Save ${R.picked.size} change${R.picked.size === 1 ? "" : "s"}</button>` : ""}<button class="nv-btn" data-act="discardbatch">${R.changes.length ? "Discard batch" : "Clear batch"}</button><button class="nv-btn" data-act="closereview">Back</button></div>
  </div></div>`;
}

/* ── Check-in (parents) ─────────────────────────────────── */
function checkin(D) {
  const N = ctx.S.navya;
  const date = N.ciDate || todayISO();
  const cur = ctx.store.checkins.get(date)?.doc || {};
  const v = (N.ci && N.ci.date === date ? N.ci : (N.ci = { ...cur, date, by: cur.by || ls.get("navya.by", "") }));
  const cur0 = (field) => (field.startsWith("char.") ? v.character?.[field.slice(5)] : v[field]);
  const seg = (field, opts) => `<div class="nv-seg" data-field="${field}">${opts.map(([val, label]) => `<button type="button" data-val="${esc(val)}" aria-pressed="${String(cur0(field)) === String(val)}">${label}</button>`).join("")}</div>`;
  const meal = (k, label) => `<div><span class="lbl">${label}</span>${seg(k, [["green", "🟢 solid"], ["yellow", "🟡 light"], ["red", "🔴 skipped"]])}</div>`;
  const traits = D.goals?.traits || [];
  return `<div class="nv-bento"><div class="nv-tile s4">
    <div class="nv-rowsplit"><h3>✍️ Check-in</h3><div class="nv-inline"><input type="date" data-act="cidate" value="${date}"> ${seg("by", [["Mom", "Mom"], ["Dad", "Dad"]])}</div></div>
    <p class="sub">About 30 seconds. Skip anything you don't know.${ctx.store.checkins.has(date) ? " Editing the saved check-in for this day." : ""}</p>
    <div class="nv-form">
      <div><span class="lbl">😴 Sleep (hours)</span><input type="number" step="0.1" min="0" max="14" data-num="sleepHrs" value="${v.sleepHrs ?? ""}"></div>
      <div><span class="lbl">💧 Water (cups)</span><input type="number" min="0" max="16" data-num="waterCups" value="${v.waterCups ?? ""}"></div>
      ${meal("breakfast", "🥣 Breakfast")}${meal("lunch", "🥪 Lunch")}${meal("dinner", "🍝 Dinner")}
      <div><span class="lbl">📚 Studied (min)</span><input type="number" min="0" max="400" step="5" data-num="studyMin" value="${v.studyMin ?? ""}"></div>
      <div><span class="lbl">🏐 Own volleyball work (min)</span><input type="number" min="0" max="300" step="5" data-num="ownPracticeMin" value="${v.ownPracticeMin ?? ""}"></div>
      <div><span class="lbl">💪 Conditioning (min)</span><input type="number" min="0" max="300" step="5" data-num="conditioningMin" value="${v.conditioningMin ?? ""}"></div>
      <div><span class="lbl">🌙 Phone away by ${esc(D.goals?.daily?.phoneAwayBy || "20:45")}?</span>${seg("phoneAway", [[true, "yes"], [false, "no"]])}</div>
      <div><span class="lbl">⚡ Energy</span>${seg("energy", [1, 2, 3, 4, 5].map((n) => [n, String(n)]))}</div>
      <div><span class="lbl">💜 Vibe</span>${seg("mood", ["😩", "😐", "😄", "🤩", "😤"].map((e) => [e, e]))}</div>
      <div class="wide"><span class="lbl">🏆 A win today</span><input data-txt="win" value="${esc(v.win || "")}" placeholder="Finished the English outline early"></div>
      <div class="wide parent-only"><span class="lbl">🔒 Parent note (hidden in Navya view)</span><input data-txt="parentNote" value="${esc(v.parentNote || "")}"></div>
    </div>
    <h4 style="margin-top:18px">🌱 Weekly: character check <span class="sub">(usually Sunday)</span></h4>
    <div class="nv-form">${traits.map((t) => `<div><span class="lbl">${t.emoji} ${esc(t.label)}</span>${seg("char." + t.id, [[1, "🌱 growing"], [2, "✅ showed it"], [3, "🌟 standout"]])}</div>`).join("")}
      <div class="wide"><span class="lbl">✨ A moment that showed it</span><input data-txt="moment" value="${esc(v.moment || "")}"></div>
      <div class="wide"><span class="lbl">📱 Ask Navya: how much of Snapchat and YouTube was Spotlight or Shorts?</span>${seg("shortFormShare", [["low", "hardly any"], ["half", "about half"], ["most", "most of it"]])}</div></div>
    <div class="nv-btnrow"><button class="nv-btn pri" data-act="saveci">Save check-in</button></div>
  </div></div>`;
}

/* ── after-render hooks (charts, async lists) ───────────── */
const after = {
  acad(D, C) {
    const box = $('[data-chart="gpa"]');
    if (box) { const t = C.gpa.trend.filter(([, v]) => v != null); box.innerHTML = lineChart({ series: [{ name: "GPA", color: "#FF4FB8", points: t.map(([d, v]) => [fmtD(d), v]) }], width: box.clientWidth, yMin: 2, yMax: 4, yTicks: [2, 2.5, 3, 3.5, 4], yFmt: (v) => v.toFixed(2), label: "Term GPA by Skyward update", marks: D.goals?.gpaTarget ? [{ y: D.goals.gpaTarget, label: "goal " + D.goals.gpaTarget }] : [] }); }
  },
  char(D, C) { commChart(C); },
  vb(D, C) { commChart(C); },
  phone(D, C) {
    const box = $('[data-chart="phoneweeks"]');
    if (box) { const W = C.phone.weeks; const top = Math.ceil(Math.max(240, ...W.map((w) => w.totalPerDay)) / 60) * 60; box.innerHTML = lineChart({ series: [["Social", "#E8399E", "socialPerDay"], ["Short-form", "#8B5CF6", "shortFormPerDay"], ["Total", "#0E9FBF", "totalPerDay"]].map(([n, c, k]) => ({ name: n, color: c, points: W.map((w) => [fmtD(w.weekStart), w[k]]) })), width: box.clientWidth, yMax: top, yTicks: Array.from({ length: top / 60 + 1 }, (_, i) => i * 60), yFmt: (m) => hm(m), tickFmt: (m) => (m ? m / 60 + "h" : "0"), label: "Minutes per day by week", marks: [{ y: C.phone.limit, label: "social limit" }] }); }
  },
  async snip() {
    const box = $("#nvbatches");
    if (!box) return;
    const ids = ctx.store.inboxBatches();
    if (!ids.length) { box.innerHTML = `<p class="sub">No batches waiting.</p>`; return; }
    const rows = await Promise.all(ids.map(async (id) => { try { return { id, ...(await ctx.store.getBatch(id)) }; } catch { return { id, batch: null }; } }));
    if (!$("#nvbatches")) return;
    box.innerHTML = `<ul class="nv-plain">${rows.map((r) => `<li><b>${esc(r.id)}</b> · ${r.batch ? `${r.batch.files.length} screenshot${r.batch.files.length > 1 ? "s" : ""} · ` : ""}${
      r.batch?.status === "needs_review" ? `<button class="nv-btn sm pri" data-act="review" data-id="${esc(r.id)}">Check &amp; save</button>` : r.batch?.status === "pending" ? "being read…" : esc(r.batch?.status || "unknown")}</li>`).join("")}</ul>`;
  },
};
function commChart(C) {
  const box = $('[data-chart="comm"]');
  if (!box) return;
  const G = C.volleyball.games.filter((g) => g.commPct != null);
  box.innerHTML = lineChart({ series: [{ name: "Calls made", color: "#22D3EE", points: G.map((g) => [fmtD(g.date), g.commPct]) }], width: box.clientWidth, yMax: 100, yTicks: [0, 25, 50, 75, 100], yFmt: (v) => v + "%", label: "Share of calls made per game" });
}

/* ── events ─────────────────────────────────────────────── */
function wire(root, D, C) {
  const N = ctx.S.navya;
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab],[data-act],[data-val]");
    if (!t || t.disabled) return;
    if (t.dataset.tab) { N.tab = t.dataset.tab; N.review = N.tab === "snip" ? N.review : null; N.coachEdit = false; draw(); window.scrollTo(0, 0); return; }
    if (t.dataset.val !== undefined && t.closest(".nv-seg")) {
      const field = t.closest(".nv-seg").dataset.field, raw = t.dataset.val;
      const val = raw === "true" ? true : raw === "false" ? false : /^\d+$/.test(raw) ? +raw : raw;
      readCheckinInputs(root);
      if (field.startsWith("char.")) { N.ci.character = { ...(N.ci.character || {}) }; const k = field.slice(5); N.ci.character[k] = N.ci.character[k] === val ? undefined : val; }
      else N.ci[field] = N.ci[field] === val ? undefined : val;
      if (field === "by") ls.set("navya.by", val);
      t.closest(".nv-seg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(field.startsWith("char.") ? String(N.ci.character?.[field.slice(5)]) === b.dataset.val : String(N.ci[field]) === b.dataset.val)));
      return;
    }
    const act = t.dataset.act;
    try {
      if (act === "kid") { N.kid = !N.kid; ls.set("navya.kidView", N.kid); if (N.kid && PARENT_ONLY.has(N.tab)) N.tab = "hq"; draw(); }
      else if (act === "reload") { N.loaded = false; renderNavyaView(ctx.store, ctx.S, ctx.renderApp); }
      else if (act === "draftcoach") await startRun("coach", sundayOf(todayISO()));
      else if (act === "approvecoach") await saveCoach(latestCoach(D), { status: "approved", approvedAt: new Date().toISOString() });
      else if (act === "editcoach") { N.coachEdit = true; draw(); }
      else if (act === "canceledit") { N.coachEdit = false; draw(); }
      else if (act === "savecoach") {
        const co = latestCoach(D), patch = {};
        root.querySelectorAll("[data-co]").forEach((ta) => { const k = ta.dataset.co, lines = ta.value.split("\n").map((s) => s.trim()).filter(Boolean); patch[k] = ["working", "needsWork", "talk", "parentChecks"].includes(k) ? lines : ta.value.trim(); });
        if (t.dataset.approve) Object.assign(patch, { status: "approved", approvedAt: new Date().toISOString() });
        N.coachEdit = false; await saveCoach(co, patch);
      }
      else if (act === "check") await updateGoals((g) => { const c = g.checklist.find((x) => x.id === t.dataset.id); c.done = !c.done; if (c.done) c.doneAt = todayISO(); else delete c.doneAt; return g; });
      else if (act === "delextra") await updateGoals((g) => { g.extracurriculars.splice(+t.dataset.i, 1); return g; });
      else if (act === "unstage") { URL.revokeObjectURL(N.staged[+t.dataset.i].url); N.staged.splice(+t.dataset.i, 1); draw(); }
      else if (act === "clearstage") { N.staged.forEach((f) => URL.revokeObjectURL(f.url)); N.staged = []; N.dupNote = ""; draw(); }
      else if (act === "upload") await uploadStaged(t);
      else if (act === "review") await openReview(t.dataset.id);
      else if (act === "closereview") { N.review = null; draw(); }
      else if (act === "savebatch") await saveBatch(root, t);
      else if (act === "discardbatch") { t.disabled = true; await ctx.store.clearBatch(N.review.batchId); N.review = null; flash("Batch cleared."); draw(); }
      else if (act === "saveci") await saveCheckin(root, t);
    } catch (err) {
      flash(err?.message || "Something went wrong.", true);
      if (t.tagName === "BUTTON") t.disabled = false;
    }
  });
  root.addEventListener("submit", async (e) => {
    const f = e.target.closest("form[data-act=addextra]");
    if (!f) return;
    e.preventDefault();
    const name = f.name.value.trim(), goal = f.goal.value.trim();
    if (name) await updateGoals((g) => { (g.extracurriculars = g.extracurriculars || []).push({ name, goal, added: todayISO() }); return g; });
  });
  root.addEventListener("change", async (e) => {
    if (e.target.matches("[data-act=files]")) { await stageFiles([...e.target.files]); e.target.value = ""; }
    if (e.target.matches("[data-act=cidate]")) { readCheckinInputs(root); N.ciDate = e.target.value; N.ci = null; draw(); }
    if (e.target.matches("[data-key]")) { e.target.checked ? N.review.picked.add(e.target.dataset.key) : N.review.picked.delete(e.target.dataset.key); const b = $("[data-act=savebatch]"); if (b) b.textContent = `Save ${N.review.picked.size} change${N.review.picked.size === 1 ? "" : "s"}`; }
  });
  root.addEventListener("input", (e) => {
    if (e.target.matches("[data-edit]")) { const k = e.target.dataset.edit; (N.review.edits[k] = N.review.edits[k] || {})[e.target.dataset.k] = e.target.value; }
  });
  const drop = $("#nvdrop", root);
  if (drop) {
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); stageFiles([...e.dataTransfer.files]); });
  }
}

document.addEventListener("paste", (e) => {
  if (!ctx || ctx.S.view !== "navya" || ctx.S.navya?.tab !== "snip" || ctx.S.navya.review) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); stageFiles(files); }
});

/* ── actions ────────────────────────────────────────────── */
async function sha256(buf) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

async function stageFiles(files) {
  const N = ctx.S.navya, seen = new Set(N.staged.map((f) => f.sha256));
  let dups = 0;
  for (const f of files.filter((x) => x.type.startsWith("image/"))) {
    const blob = await shrink(f), hash = await sha256(await blob.arrayBuffer());
    if (seen.has(hash)) { dups++; continue; }
    seen.add(hash);
    N.staged.push({ blob, type: blob.type, sha256: hash, url: URL.createObjectURL(blob) });
  }
  N.dupNote = dups ? `${dups} of these ${dups === 1 ? "was the same screenshot as another" : "were the same screenshot as others"}, so ${dups === 1 ? "it was" : "they were"} left out. Your photo picker may have re-attached an earlier image.` : "";
  draw();
}

// Screenshots stay sharp for reading small text: only very large images are scaled (to 2400px).
async function shrink(file) {
  if (file.size < 3.5e6) return file;
  try {
    const bmp = await createImageBitmap(file), s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), "image/jpeg", 0.9));
  } catch { return file; }
}

async function uploadStaged(btn) {
  const N = ctx.S.navya;
  btn.disabled = true; btn.textContent = "Uploading…";
  const d = new Date(), id = `B${d.toISOString().slice(0, 10).replace(/-/g, "")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  await ctx.store.uploadBatch(id, N.staged, ls.get("navya.by", ""));
  N.staged.forEach((f) => URL.revokeObjectURL(f.url)); N.staged = []; N.dupNote = "";
  ctx.store.tree = await ctx.store.gh.listTree();
  await startRun("batch", id);
}

async function startRun(kind, id) {
  if (activeRun()) return flash("Claude is already working on something. It'll finish in a few minutes.");
  let fired;
  try { fired = await fireRoutine(kind === "batch" ? `navya process ${id}` : `navya coach ${id}`); }
  catch (e) {
    if (kind === "batch") flash(`Uploaded, but couldn't start reading: ${e.message} The batch is saved; it'll be read on the next run.`, true);
    else flash(e instanceof RoutineError ? e.message : "Couldn't start the draft.", true);
    draw(); return;
  }
  ls.set(RUN_KEY, { kind, id, firedAt: Date.now(), sessionUrl: fired.sessionUrl });
  flash(kind === "batch" ? "Reading your screenshots. Usually 2–4 minutes; you can leave this page." : "Drafting this week's coach's read. Usually 2–4 minutes.");
  draw(); startPolling();
}

function activeRun() {
  const r = ls.get(RUN_KEY, null);
  if (!r) return null;
  if (Date.now() - r.firedAt > RUN_TTL) { ls.del(RUN_KEY); flash(r.kind === "batch" ? "The last screenshot run didn't finish. Open 📸 Add snips to check it." : "The coach's read draft didn't finish. You can try again.", true); return null; }
  return r;
}
const runLine = (r) => `<p class="nv-run"><span class="pulse"></span>${r.kind === "batch" ? "Reading screenshots" : "Drafting the coach's read"}… usually 2–4 minutes; this updates on its own.${r.sessionUrl ? ` <a href="${esc(r.sessionUrl)}" target="_blank" rel="noopener">View run</a>` : ""}</p>`;

function startPolling() {
  if (pollTimer || !activeRun()) return;
  pollTimer = setInterval(async () => {
    const r = activeRun();
    if (!r) { clearInterval(pollTimer); pollTimer = null; if (ctx?.S.view === "navya") draw(); return; }
    try {
      let done = false;
      if (r.kind === "batch") done = (await ctx.store.getBatch(r.id)).batch?.status === "needs_review";
      else { const { json } = await ctx.store.gh.getFile(`coach/${r.id}.json`); done = !!json && json.draftedAt && new Date(json.draftedAt).getTime() > r.firedAt - 60000; }
      if (!done) return;
      ls.del(RUN_KEY); clearInterval(pollTimer); pollTimer = null;
      await ctx.store.loadAll();
      flash(r.kind === "batch" ? "Screenshots read. Check & save them in 📸 Add snips." : "This week's coach's read is drafted. Review and approve it on HQ.");
      if (ctx.S.view === "navya") { if (r.kind === "batch") { ctx.S.navya.tab = "snip"; await openReview(r.id); } else draw(); }
    } catch { /* keep polling */ }
  }, 8000);
}

async function openReview(batchId) {
  const N = ctx.S.navya;
  const { batch, result } = await ctx.store.getBatch(batchId);
  if (!result) return flash("That batch hasn't been read yet.", true);
  const asOf = (batch?.createdAt || new Date().toISOString()).slice(0, 10);
  const changes = buildChanges(data(), result, asOf);
  N.review = { batchId, asOf, changes, flags: result.flags || [], picked: new Set(changes.map((c) => c.key)), edits: {} };
  N.tab = "snip"; draw();
}

async function saveBatch(root, btn) {
  const N = ctx.S.navya, R = N.review, store = ctx.store;
  btn.disabled = true; btn.textContent = "Saving…";
  const { touched } = applyChanges(data(), R.changes, R.picked, R.edits);
  const DFLT = { grades: [], assignments: [], screentime: [], classes: [], attendance: { events: [] }, gpa: null, codes: null };
  for (const key of touched) {
    // re-apply on whatever is current in the repo, so a concurrent save isn't overwritten
    await store.update(FILE_PATHS[key], DFLT[key], (cur) => applyChanges({ ...data(), [key]: cur }, R.changes, R.picked, R.edits).docs[key], `navya: save batch ${R.batchId} (${key})`);
  }
  await store.clearBatch(R.batchId);
  await store.recompute();
  flash(`Saved ${R.picked.size} change${R.picked.size === 1 ? "" : "s"}.`);
  N.review = null; N.tab = "hq"; draw();
}

function readCheckinInputs(root) {
  const N = ctx.S.navya;
  if (!N.ci) return;
  root.querySelectorAll("[data-num]").forEach((i) => { N.ci[i.dataset.num] = i.value === "" ? undefined : +i.value; });
  root.querySelectorAll("[data-txt]").forEach((i) => { N.ci[i.dataset.txt] = i.value.trim() || undefined; });
}

async function saveCheckin(root, btn) {
  const N = ctx.S.navya;
  readCheckinInputs(root);
  const date = N.ci.date;
  btn.disabled = true; btn.textContent = "Saving…";
  const clean = Object.fromEntries(Object.entries(N.ci).filter(([, v]) => v !== undefined && v !== ""));
  if (clean.character) { clean.character = Object.fromEntries(Object.entries(clean.character).filter(([, v]) => v != null)); if (!Object.keys(clean.character).length) delete clean.character; }
  clean.date = date; clean.savedAt = new Date().toISOString();
  await ctx.store.update(`checkins/${date}.json`, null, () => clean, `navya: check-in ${date}`);
  await ctx.store.recompute();
  flash("Check-in saved.");
  N.ci = null; draw();
}

async function saveCoach(co, patch) {
  if (!co) return;
  await ctx.store.update(`coach/${co.weekStart}.json`, null, (cur) => ({ ...cur, ...patch }), `navya: coach ${co.weekStart} ${patch.status === "approved" ? "approved" : "edited"}`);
  flash(patch.status === "approved" ? "Approved. Navya will see it in Navya view." : "Saved.");
  draw();
}

async function updateGoals(mutate) {
  await ctx.store.update("goals.json", {}, (g) => { const out = mutate(g); out.updated = todayISO(); return out; }, "navya: goals");
  draw();
}

export { addDays };
