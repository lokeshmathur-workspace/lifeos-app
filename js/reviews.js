// Week and month roll-ups: what the journals already say, summarized, and
// reviews that open pre-filled so they only ask for what's missing.
//
//   weeks/<monday>.json  review  {completedAt, summary, wins, patterns, changeNext, hphAvg}
//   months/<YYYY-MM>.json review {completedAt, summary, verdict, extra, hphAvg, lowestHabit}
//
// A review can be written for the current period and the one just before it
// (a Sunday-night or Monday-morning review of the week that just ended).
import { PILLARS, HPH } from "./constants.js";
import { addDays, dayOfWeekName, shortDate, isoWeekNumber, mondayOf, sundayOf, monthKeyOf, addMonths, todayISO, nowHM } from "./dateutil.js";
import { hphAvg, evening, top3Of } from "./derive.js";
import { flash } from "./flash.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function firstSentence(text, max = 140) {
  const t = String(text || "").trim().split(/\n/)[0];
  const m = t.match(/^.*?[.!?](\s|$)/);
  const s = (m ? m[0] : t).trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const dayHighlight = (doc) => firstSentence(evening(doc).synthesis || (doc.notes || []).map((n) => n.text).join(" "));
const round2 = (v) => Math.round(v * 100) / 100;
const avgOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function perHabitAvg(dates, daysMap) {
  const out = {};
  for (const [k] of HPH) {
    const vals = dates.map((d) => daysMap.get(d)).filter(Boolean).map((doc) => evening(doc).hph?.[k]).filter((v) => typeof v === "number");
    out[k] = avgOf(vals);
  }
  return out;
}

function lowestHabit(dates, daysMap) {
  const avgs = perHabitAvg(dates, daysMap);
  let best = null;
  for (const [k, label] of HPH) if (avgs[k] != null && (!best || avgs[k] < best.v)) best = { label, v: avgs[k] };
  return best;
}

// Every task that appeared in a day plan or on the board, once, with done if it
// was finished anywhere — plus master-list tasks completed inside the period
// (ticked with ✓ in the picker or task list, never planned for a day).
function tasksOfPeriod(dates, daysMap, boardTasks = [], masterTasks = []) {
  const byId = new Map();
  const add = (t) => {
    const key = t.id || t.task;
    const cur = byId.get(key);
    byId.set(key, { id: t.id, task: t.task, pillar: t.pillar, done: (cur && cur.done) || t.status === "done" });
  };
  for (const d of dates) {
    const doc = daysMap.get(d);
    if (doc) top3Of(doc).forEach(add);
  }
  boardTasks.forEach(add);
  const first = dates[0], last = dates[dates.length - 1];
  masterTasks.filter((t) => t.status === "done" && t.completed && t.completed >= first && t.completed <= last).forEach(add);
  return [...byId.values()];
}

function pillarBarsHtml(tasks) {
  const rows = Object.entries(PILLARS)
    .map(([k, l]) => {
      const inP = tasks.filter((t) => t.pillar === k);
      if (!inP.length) return "";
      const done = inP.filter((t) => t.done).length;
      return `<div class="pbar"><span>${esc(l)}</span><div class="track"><div class="fill" style="width:${Math.round((100 * done) / inP.length)}%"></div></div><span class="n">${done}/${inP.length}</span></div>`;
    })
    .join("");
  return rows ? `<div class="pbars">${rows}</div>` : `<p class="empty" style="padding:0">No tasks yet.</p>`;
}

const reviewText = (label, v) => (v ? `<div class="rvrow"><b>${esc(label)}</b><p>${esc(v).replace(/\n/g, "<br>")}</p></div>` : "");

/* ═══ week ═══════════════════════════════════════════════════ */

export function weekReviewable(weekOf) {
  const cur = mondayOf(todayISO());
  return weekOf === cur || weekOf === addDays(cur, -7);
}

export function weekGlanceHtml(dates, daysMap, boardTasks, first, masterTasks = []) {
  const today = todayISO();
  const rows = dates
    .map((d) => {
      const doc = daysMap.get(d);
      const tasks = doc ? top3Of(doc) : [];
      const done = tasks.filter((t) => t.status === "done").length;
      const hl = doc ? dayHighlight(doc) : "";
      return `
        <button class="glrow" data-date="${d}" ${doc ? "" : "disabled"}>
          <b>${esc(dayOfWeekName(d).slice(0, 3))}</b>
          <span class="glmeta">${tasks.length ? `${done} of ${tasks.length} done` : doc ? "journaled" : "—"}</span>
          <span class="glhl">${esc(hl || (doc || d > today ? "" : "No journal"))}</span>
        </button>`;
    })
    .join("");
  return `
    <section class="blk" ${first ? 'style="border-top:0;padding-top:0;margin-top:0"' : ""}>
      <h2>Week at a glance</h2>
      <div class="card glance">${rows}</div>
      <h2 style="margin-top:16px">Done by category</h2>
      ${pillarBarsHtml(tasksOfPeriod(dates, daysMap, boardTasks, masterTasks))}
    </section>`;
}

function weekPrefill(dates, daysMap, boardTasks, stats, masterTasks) {
  const summary = dates
    .filter((d) => daysMap.has(d) && dayHighlight(daysMap.get(d)))
    .map((d) => `${dayOfWeekName(d).slice(0, 3)}: ${dayHighlight(daysMap.get(d))}`)
    .join("\n");
  const all = tasksOfPeriod(dates, daysMap, boardTasks, masterTasks);
  const wins = all.filter((t) => t.done).map((t) => `✓ ${t.task}`).join("\n");
  const low = lowestHabit(dates, daysMap);
  const docs = dates.map((d) => daysMap.get(d)).filter(Boolean);
  const core = (which) => avgOf(docs.map((doc) => evening(doc)[which]?.totalCompleted).filter((v) => typeof v === "number"));
  const biz = core("businessCoreSteps");
  const vit = core("vitalityCoreSteps");
  const idle = Object.entries(PILLARS)
    .filter(([k]) => all.some((t) => t.pillar === k) && !all.some((t) => t.pillar === k && t.done))
    .map(([, l]) => l);
  const patterns = [
    `Journaled ${stats.journaled} of 7 days${stats.hphAvg != null ? `; HPH average ${stats.hphAvg.toFixed(1)}` : ""}.`,
    low ? `Lowest habit: ${low.label} (${low.v.toFixed(1)}).` : "",
    biz != null || vit != null
      ? `Core steps a day: ${[biz != null ? `business ${biz.toFixed(1)}/6` : "", vit != null ? `vitality ${vit.toFixed(1)}/6` : ""].filter(Boolean).join(", ")}.`
      : "",
    idle.length ? `Nothing finished in: ${idle.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { summary, wins, patterns, idle };
}

export function weekReviewHtml(ctx) {
  const { weekOf, weekDoc, dates, daysMap, boardTasks, stats, editing, masterTasks, prevReviewed } = ctx;
  const r = weekDoc.review;
  const can = weekReviewable(weekOf);
  if (!editing) {
    if (r?.completedAt) {
      return `
        <section class="blk">
          <h2>Weekly review <span class="count">done</span></h2>
          <div class="card rv">
            ${reviewText("What happened", r.summary)}${reviewText("Wins", r.wins)}${reviewText("Patterns", r.patterns)}${reviewText("Change next week", r.changeNext)}
          </div>
          ${can ? `<div class="btnrow"><button class="btn sm" id="editweekreview">Edit review</button><button class="btn sm" id="plannextweek">Plan next week →</button></div>` : ""}
        </section>`;
    }
    if (!can) return "";
    // Mon–Fri of the current week: the week isn't over, so point at last week's
    // review instead (unless that's done too — then allow starting early).
    const early = weekOf === mondayOf(todayISO()) && todayISO() < addDays(weekOf, 5);
    if (early) {
      const prev = addDays(weekOf, -7);
      return `
      <section class="blk">
        <h2>Weekly review</h2>
        ${
          !prevReviewed
            ? `<div class="prefill"><b>Last week isn't reviewed yet</b>${esc(shortDate(prev))} – ${esc(shortDate(sundayOf(prev)))} — its journals are ready to review.</div>
               <div class="btnrow" style="margin-top:0"><button class="btn pri" id="reviewlastweek" data-week="${prev}">Review last week →</button><button class="btn sm" id="startweekreview">Start this week's early</button></div>`
            : `<p class="savenote">This week's review opens on Saturday, once there's a week to look back on.</p>
               <div class="btnrow" style="margin-top:8px"><button class="btn sm" id="startweekreview">Start early</button></div>`
        }
      </section>`;
    }
    return `
      <section class="blk">
        <h2>Weekly review</h2>
        <div class="prefill"><b>Mostly written already</b>Pre-filled from this week's journals and tasks — you only add what they missed.</div>
        <div class="btnrow" style="margin-top:0"><button class="btn pri" id="startweekreview">Start weekly review</button></div>
      </section>`;
  }
  const p = r?.completedAt ? { summary: r.summary, wins: r.wins, patterns: r.patterns, idle: [] } : weekPrefill(dates, daysMap, boardTasks, stats, masterTasks);
  const open = boardTasks.filter((t) => t.status !== "done");
  return `
    <section class="blk">
      <h2>Weekly review</h2>
      ${!r?.completedAt ? `<div class="prefill"><b>From your journals</b>Everything below is pre-filled — edit freely.</div>` : ""}
      <label class="fld"><span>What happened</span><textarea id="wr_summary" rows="${Math.min(8, Math.max(3, p.summary.split("\n").length + 1))}" placeholder="No evening synthesis or day notes this week — add a line or two about how it went.">${esc(p.summary)}</textarea></label>
      <label class="fld"><span>Wins</span><textarea id="wr_wins" rows="${Math.min(8, Math.max(2, p.wins.split("\n").length + 1))}" placeholder="No tasks were marked done this week — anything you're proud of anyway?">${esc(p.wins)}</textarea></label>
      <label class="fld"><span>Patterns</span><textarea id="wr_patterns" rows="4">${esc(p.patterns)}</textarea></label>
      <label class="fld"><span>What would you change next week? <em class="fldnote">becomes next week's key focus</em></span><textarea id="wr_change" rows="3" placeholder="${esc(p.idle.length ? `Nothing got done in ${p.idle.join(", ")} — what happened there?` : "One or two concrete changes")}">${esc(r?.changeNext || "")}</textarea></label>
      ${
        open.length
          ? `<div class="picker" style="margin-top:6px"><div class="pickgroup"><h4>Carry into next week? <span>unfinished on this week's board</span></h4>
            ${open.map((t) => `<label class="pickrow"><input type="checkbox" class="wr_carry" value="${esc(t.id)}" checked><span class="tk">${esc(t.task)}</span><span class="pl">${esc(PILLARS[t.pillar] || t.pillar)}</span></label>`).join("")}
          </div></div>`
          : ""
      }
      <div class="btnrow"><button class="btn pri" id="saveweekreview">Save weekly review</button><button class="btn" id="cancelweekreview">Cancel</button></div>
    </section>`;
}

export function wireWeekReview(ctx) {
  const { store, S, renderApp, weekOf, weekDoc, dates, daysMap, boardTasks, stats } = ctx;
  $("#startweekreview")?.addEventListener("click", () => {
    S.weekReviewEditing = true;
    renderApp();
  });
  $("#editweekreview")?.addEventListener("click", () => {
    S.weekReviewEditing = true;
    renderApp();
  });
  $("#reviewlastweek")?.addEventListener("click", (e) => {
    S.week = e.currentTarget.dataset.week;
    S.weekReviewEditing = true;
    renderApp();
  });
  $("#cancelweekreview")?.addEventListener("click", () => {
    S.weekReviewEditing = false;
    renderApp();
  });
  $("#plannextweek")?.addEventListener("click", () => {
    S.week = addDays(weekOf, 7);
    S.weekReviewEditing = false;
    renderApp();
  });
  document.querySelectorAll(".glrow[data-date]:not([disabled])").forEach((b) =>
    b.addEventListener("click", () => window.dispatchEvent(new CustomEvent("lifeos:goto-day", { detail: b.dataset.date })))
  );
  $("#saveweekreview")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const review = {
      completedAt: `${todayISO()}T${nowHM()}:00`,
      summary: $("#wr_summary").value.trim(),
      wins: $("#wr_wins").value.trim(),
      patterns: $("#wr_patterns").value.trim(),
      changeNext: $("#wr_change").value.trim(),
      hphAvg: stats.hphAvg != null ? round2(stats.hphAvg) : null,
    };
    const ok = await store.saveWeek(weekOf, { review }, true, `life-os: weekly ${weekOf}`);
    if (!ok) {
      btn.disabled = false;
      return;
    }
    // Unfinished tasks ticked to carry: same master id on next week's board.
    const carryIds = new Set([...document.querySelectorAll(".wr_carry:checked")].map((el) => el.value));
    const nextOf = addDays(weekOf, 7);
    // Next week: ticked tasks carry over (same master id), and the "change next
    // week" answer becomes its key focus unless one is already set.
    const nextDoc = await store.getWeek(nextOf);
    const nextPatch = {};
    const have = new Set((nextDoc.tasks || []).map((t) => t.id));
    const add = boardTasks
      .filter((t) => carryIds.has(t.id) && !have.has(t.id))
      .map((t) => ({ id: t.id, task: t.task, pillar: t.pillar, assignedDay: "", status: "carried_forward", source: t.source || "manual" }));
    if (add.length) nextPatch.tasks = [...(nextDoc.tasks || []), ...add];
    if (review.changeNext && !(nextDoc.keyFocus || "").trim()) nextPatch.keyFocus = review.changeNext;
    if (Object.keys(nextPatch).length) await store.saveWeek(nextOf, nextPatch, true, `life-os: weekly ${nextOf} carry-forward`);
    // The week's HPH average goes to the month its Monday falls in, as /weekly did.
    if (review.hphAvg != null) {
      const mk = monthKeyOf(weekOf);
      const monthDoc = await store.getMonth(mk);
      const list = (monthDoc.weeklyHPHAvgs || []).filter((w) => w.weekOf !== weekOf);
      list.push({ week: `W${isoWeekNumber(weekOf)}`, weekOf, avg: review.hphAvg });
      list.sort((a, b) => (a.weekOf < b.weekOf ? -1 : 1));
      await store.saveMonth(mk, { weeklyHPHAvgs: list }, true, `life-os: weekly ${weekOf}`);
    }
    S.weekReviewEditing = false;
    flash(`Weekly review saved${carryIds.size ? ` — ${carryIds.size} task${carryIds.size === 1 ? "" : "s"} carried into next week` : ""}.`);
    renderApp();
  });
}

/* ═══ month ══════════════════════════════════════════════════ */

export function monthReviewable(monthKey) {
  const cur = monthKeyOf(todayISO());
  return monthKey === cur || monthKey === addMonths(cur, -1);
}

// Mondays of every week that touches the month.
export function weeksOfMonth(year, monthNum) {
  const first = `${year}-${String(monthNum).padStart(2, "0")}-01`;
  const last = `${year}-${String(monthNum).padStart(2, "0")}-${String(new Date(Date.UTC(year, monthNum, 0)).getUTCDate()).padStart(2, "0")}`;
  const out = [];
  for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) out.push(m);
  return out;
}

export async function loadMonthWeeks(store, year, monthNum) {
  const today = todayISO();
  const masterTasks = (await store.getTasks()).tasks;
  const weeks = [];
  for (const weekOf of weeksOfMonth(year, monthNum)) {
    if (weekOf > today) continue;
    const dates = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i)).filter((d) => d <= today);
    const [weekDoc, daysMap] = await Promise.all([store.getWeek(weekOf), store.loadJournalMap(dates)]);
    const docs = dates.map((d) => daysMap.get(d)).filter(Boolean);
    const avg = avgOf(docs.map(hphAvg).filter((v) => v != null));
    const tasks = tasksOfPeriod(dates, daysMap, [], masterTasks);
    const r = weekDoc.review;
    const highlight = firstSentence(r?.summary?.replace(/^\w{3}: /, "") || r?.wins || docs.map(dayHighlight).find(Boolean) || "");
    weeks.push({ weekOf, dates, weekDoc, daysMap, avg, done: tasks.filter((t) => t.done).length, total: tasks.length, highlight, reviewed: !!r?.completedAt });
  }
  return weeks;
}

export function monthGlanceHtml(weeks, first) {
  if (!weeks.length) return "";
  return `
    <section class="blk" ${first ? 'style="border-top:0;padding-top:0;margin-top:0"' : ""}>
      <h2>Month at a glance</h2>
      <div class="card glance">
        ${weeks
          .map(
            (w) => `
          <button class="glrow wk" data-week="${w.weekOf}">
            <b>${esc(shortDate(w.weekOf))}–${esc(shortDate(sundayOf(w.weekOf)))}</b>
            <span class="glmeta">${w.avg != null ? `HPH ${w.avg.toFixed(1)} · ` : ""}${w.total ? `${w.done}/${w.total} done` : "no tasks"}${w.reviewed ? " · reviewed" : ""}</span>
            <span class="glhl">${esc(w.highlight || "No journal")}</span>
          </button>`
          )
          .join("")}
      </div>
    </section>`;
}

function monthPrefill(weeks, monthDates, daysMap, monthDoc) {
  const summary = weeks
    .filter((w) => w.highlight || w.avg != null)
    .map((w) => `Week of ${shortDate(w.weekOf)}${w.avg != null ? ` (HPH ${w.avg.toFixed(1)})` : ""}: ${w.highlight || "no notes"}`)
    .join("\n");
  const intentions = monthDoc.intentions || [];
  const intentLine = intentions.length
    ? "\nIntentions: " + intentions.map((i) => `${i.intention} — ${String(i.status || "not_started").replace("_", " ")}`).join("; ") + "."
    : "";
  return { summary: summary + intentLine, low: lowestHabit(monthDates, daysMap) };
}

export function monthReviewHtml(ctx) {
  const { monthKey, monthDoc, weeks, dates, daysMap, editing } = ctx;
  const r = monthDoc.review;
  const can = monthReviewable(monthKey);
  if (!editing) {
    if (r?.completedAt) {
      return `
        <section class="blk">
          <h2>Monthly review <span class="count">done</span></h2>
          <div class="card rv">${reviewText("Verdict", r.verdict)}${reviewText("From your weeks", r.summary)}${reviewText("Also", r.extra)}${reviewText("Lowest habit", r.lowestHabit)}</div>
          ${can ? `<div class="btnrow"><button class="btn sm" id="editmonthreview">Edit review</button><button class="btn sm" id="plannextmonth">Plan next month →</button></div>` : ""}
        </section>`;
    }
    if (!can) return "";
    return `
      <section class="blk">
        <h2>Monthly review</h2>
        <div class="prefill"><b>Mostly written already</b>Pre-filled from your weekly reviews and journals.</div>
        <div class="btnrow" style="margin-top:0"><button class="btn pri" id="startmonthreview">Start monthly review</button></div>
      </section>`;
  }
  const p = r?.completedAt ? { summary: r.summary, low: r.lowestHabit ? { label: r.lowestHabit } : null } : monthPrefill(weeks, dates, daysMap, monthDoc);
  const lowText = p.low ? `${p.low.label}${p.low.v != null ? ` (${p.low.v.toFixed(1)})` : ""}` : "";
  return `
    <section class="blk">
      <h2>Monthly review</h2>
      ${!r?.completedAt ? `<div class="prefill"><b>From your weeks</b>Pre-filled — edit freely.</div>` : ""}
      <label class="fld"><span>From your weeks</span><textarea id="mr_summary" rows="${Math.min(9, Math.max(3, p.summary.split("\n").length + 1))}">${esc(p.summary)}</textarea></label>
      ${
        p.low
          ? `<div class="prefill" style="background:var(--raised)"><b style="color:var(--ink-2)">Lowest habit this month</b>${esc(lowText)}
             <div class="btnrow" style="margin-top:8px"><button class="btn sm" id="mr_focus" data-habit="${esc(p.low.label)}">Make it next month's focus</button></div></div>`
          : ""
      }
      <label class="fld"><span>Your one-line verdict on the month</span><input type="text" id="mr_verdict" value="${esc(r?.verdict || "")}"></label>
      <label class="fld"><span>Anything the weeks didn't capture</span><textarea id="mr_extra" rows="3">${esc(r?.extra || "")}</textarea></label>
      <div class="btnrow"><button class="btn pri" id="savemonthreview" data-low="${esc(lowText)}">Save monthly review</button><button class="btn" id="cancelmonthreview">Cancel</button></div>
    </section>`;
}

export function wireMonthReview(ctx) {
  const { store, S, renderApp, monthKey, weeks, dates, daysMap } = ctx;
  $("#startmonthreview")?.addEventListener("click", () => {
    S.monthReviewEditing = true;
    renderApp();
  });
  $("#editmonthreview")?.addEventListener("click", () => {
    S.monthReviewEditing = true;
    renderApp();
  });
  $("#cancelmonthreview")?.addEventListener("click", () => {
    S.monthReviewEditing = false;
    renderApp();
  });
  $("#plannextmonth")?.addEventListener("click", () => {
    S.month = addMonths(monthKey, 1);
    S.monthReviewEditing = false;
    renderApp();
  });
  document.querySelectorAll(".glrow.wk").forEach((b) =>
    b.addEventListener("click", () => window.dispatchEvent(new CustomEvent("lifeos:goto-week", { detail: b.dataset.week })))
  );
  $("#mr_focus")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const next = addMonths(monthKey, 1);
    await store.getMonth(next);
    const ok = await store.saveMonth(next, { hphFocusHabit: btn.dataset.habit }, true, `life-os: month-start ${next}`);
    if (ok) {
      btn.textContent = `Set as ${next} focus ✓`;
      flash("Next month's habit focus set.");
    } else btn.disabled = false;
  });
  $("#savemonthreview")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const docs = dates.map((d) => daysMap.get(d)).filter(Boolean);
    const avg = avgOf(docs.map(hphAvg).filter((v) => v != null));
    const review = {
      completedAt: `${todayISO()}T${nowHM()}:00`,
      summary: $("#mr_summary").value.trim(),
      verdict: $("#mr_verdict").value.trim(),
      extra: $("#mr_extra").value.trim(),
      hphAvg: avg != null ? round2(avg) : null,
      lowestHabit: btn.dataset.low || "",
    };
    const ok = await store.saveMonth(monthKey, { review }, true, `life-os: month-review ${monthKey}`);
    btn.disabled = false;
    if (!ok) return;
    S.monthReviewEditing = false;
    flash("Monthly review saved.");
    renderApp();
  });
}
