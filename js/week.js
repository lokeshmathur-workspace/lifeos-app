// Week view — REQUIREMENTS.md §4.2, redesigned per the approved
// week-redesign-mockup.html round: plan+progress first, stats moved down, a
// clearer HPH-by-day chart, split Business/Vitality core-step tables, and an
// always-editable by-category task plan with pull-ins from this month's
// intentions and last week's incomplete tasks. Goals were dropped (redundant
// with tasks).
//
// Data model: one file per week (life-os/state/weeks/<monday>.json) instead of
// a single currentWeek slot — see life-os/docs/SCHEMA.md. That's what lets this
// view navigate to any past/future week (S.week, like Today's S.day) instead of
// only ever showing "the current week" behind a rollover prompt. A week in the
// past is read-only — carry-forward into a new week is an explicit pull, never
// a mutation of the old week's file.
import { PILLARS, BIZ, VIT } from "./constants.js";
import { mondayOf, sundayOf, isoWeekNumber, shortDate, dayOfWeekName, addDays, DAYKEYS, todayISO, nowHM, D, monthKeyOf } from "./dateutil.js";
import { hphAvg, evening } from "./derive.js";
import { addTasks, setTaskStatus, isOpen } from "./tasks.js";
import { flash } from "./flash.js";
import { buildSections, copyRichText } from "./export.js";
import { pillarHealth, monthDates } from "./month.js";
import { weekGlanceHtml, weekReviewHtml, wireWeekReview, weekReviewable } from "./reviews.js";
import { stepperHtml, reviewNudgeHtml, soFarLines, soFarHtml } from "./steps.js";
import { taskListHtml, wireTaskList } from "./tasklist.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function weekDates(mondayISO) {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayISO, i));
}

function weekStats(dates, daysMap) {
  const docs = dates.map((d) => daysMap.get(d)).filter(Boolean);
  const journaled = docs.length;
  const avgs = docs.map(hphAvg).filter((v) => v != null);
  const hphAvgWeek = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
  let done = 0,
    total = 0;
  for (const doc of docs) {
    for (const t of evening(doc).top3Results || []) {
      total++;
      if (t.status === "done") done++;
    }
  }
  return {
    journaled,
    hphAvg: hphAvgWeek,
    top3Rate: total ? Math.round((100 * done) / total) : null,
    byDate: dates.map((d) => ({ date: d, avg: daysMap.has(d) ? hphAvg(daysMap.get(d)) : null })),
  };
}

function weekTag(weekOf, curMonday) {
  if (weekOf === curMonday) return `<span class="tag new">this week</span>`;
  if (weekOf < curMonday) return `<span class="tag">past</span>`;
  return `<span class="tag moved">planning ahead</span>`;
}

export async function renderWeekView(store, S, renderApp) {
  const main = document.getElementById("main");
  main.innerHTML = `<p class="empty">Loading…</p>`;

  const weekOf = S.week;
  const curMonday = mondayOf(todayISO());
  const isPast = weekOf < curMonday;
  const editable = !isPast;

  const weekDoc = await store.getWeek(weekOf);
  const dates = weekDates(weekOf);
  const daysMap = await store.loadJournalMap(dates);
  const stats = weekStats(dates, daysMap);

  const prevMonday = addDays(weekOf, -7);
  const prevWeekDoc = editable ? await store.getWeek(prevMonday) : null;

  // "Progress toward this month" uses the real current month's data regardless
  // of which week is being viewed — each month is still its own single file,
  // not tied to which week you're looking at.
  const todayD = D(todayISO());
  const realYear = todayD.getUTCFullYear();
  const realMonthNum = todayD.getUTCMonth() + 1;
  const monthDatesToDate = monthDates(realYear, realMonthNum).filter((d) => d <= todayISO());
  const monthDaysMap = await store.loadJournalMap(monthDatesToDate);
  const health = pillarHealth(monthDatesToDate, monthDaysMap);
  const monthDoc = await store.getMonth(monthKeyOf(todayISO()));
  const intentions = monthDoc.intentions || [];

  // Week entries share their master-list id; the master list decides wording
  // and status (a task ticked off in the journal shows done here too).
  const master = await store.getTasks();
  const mById = new Map(master.tasks.map((t) => [t.id, t]));
  const tasks = (weekDoc.tasks || []).map((t) => {
    const m = mById.get(t.id);
    if (!m) return t;
    const status = m.status === "done" ? "done" : t.status === "carried_forward" ? "carried_forward" : m.status;
    return { ...t, task: m.task, pillar: m.pillar, status };
  });
  const inWeek = new Set(tasks.map((t) => t.id));
  const openList = editable ? master.tasks.filter((t) => isOpen(t) && !inWeek.has(t.id)) : [];
  const done = tasks.filter((t) => t.status === "done").length;
  const inprog = tasks.filter((t) => t.status === "in_progress").length;
  const total = tasks.length;
  const donePct = total ? Math.round((100 * done) / total) : 0;
  const inprogPct = total ? Math.round((100 * inprog) / total) : 0;
  const restPct = Math.max(0, 100 - donePct - inprogPct);

  // An empty key focus starts from last week's "what would you change" answer.
  const focusSuggestion = editable && !weekDoc.keyFocus ? prevWeekDoc?.review?.changeNext || "" : "";

  const usedTexts = new Set(tasks.map((t) => t.task.trim().toLowerCase()));
  const prevIncomplete = editable
    ? (prevWeekDoc.tasks || []).filter((t) => t.status !== "done" && !usedTexts.has(t.task.trim().toLowerCase()))
    : [];

  // Pull-ins you've explicitly said aren't relevant this week — dismissing one
  // never touches its source (the month intention, or last week's task), it
  // just stops that suggestion resurfacing on this week's board. Keyed by
  // normalized text for intentions (no stable id in that schema, same dedup
  // key already used above) and by task id for carry-forward candidates.
  const dismissedIntentions = new Set((weekDoc.dismissedIntentions || []).map((s) => s.trim().toLowerCase()));
  const dismissedCarryForward = new Set(weekDoc.dismissedCarryForward || []);

  // What the week's journals already say, then the review that starts from it.
  const started = weekOf <= todayISO();
  const reviewCtx = {
    store, S, renderApp, weekOf, weekDoc, dates, daysMap, boardTasks: tasks, stats,
    editing: !!S.weekReviewEditing,
    masterTasks: master.tasks,
    prevReviewed: !!(prevWeekDoc || (await store.getWeek(addDays(weekOf, -7)))).review?.completedAt,
  };
  // ① Plan · ② How it's going · ③ Review — the same three steps as Today.
  const today = todayISO();
  const planned = !!weekDoc.plannedAt || tasks.length > 0;
  const reviewed = !!weekDoc.review?.completedAt;
  const weekend = today >= addDays(weekOf, 5);
  let step = S.weekStep;
  if (!step) {
    if (isPast) step = reviewed || weekReviewable(weekOf) ? "review" : "progress";
    else if (weekOf > curMonday || !planned) step = "plan";
    else if (weekend && !reviewed) step = "review";
    else step = "progress";
  }
  S.weekStep = step; // stays on this step until you pick another or navigate
  reviewCtx.editing = !!S.weekReviewEditing || !reviewed;
  const prevReviewed = reviewCtx.prevReviewed;
  const showNudge = step === "plan" && editable && !prevReviewed && weekReviewable(prevMonday) && !(S.nudgeSkip ||= new Set()).has(weekOf);
  const datesSoFar = dates.filter((d) => d <= today);
  const soFar = soFarLines(datesSoFar, daysMap, tasks.map((t) => ({ pillar: t.pillar, done: t.status === "done" })));

  const planStep = `
    ${showNudge ? reviewNudgeHtml(`Last week (${shortDate(prevMonday)} – ${shortDate(sundayOf(prevMonday))}) isn't reviewed yet.`) : ""}
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <h2>Key focus</h2>
      ${
        editable
          ? `<textarea id="keyfocus" rows="2" placeholder="The one thing this week is for">${esc(weekDoc.keyFocus || focusSuggestion)}</textarea>
             ${
               !weekDoc.keyFocus && focusSuggestion
                 ? `<p class="fldnote" style="margin:4px 0 0">From last week's review — edit if you like.</p>`
                 : weekDoc.keyFocus && weekDoc.keyFocus === prevWeekDoc?.review?.changeNext
                   ? `<p class="fldnote" style="margin:4px 0 0">From last week's review.</p>`
                   : ""
             }`
          : `<p>${esc(weekDoc.keyFocus || "—")}</p>`
      }
    </section>
    <section class="blk">
      <h2>This week's tasks <span class="count">${total || ""}</span></h2>
      ${editable ? `<p class="fldnote" style="margin:-6px 0 10px">Add tasks per category, pull in last week's unfinished ones and this month's intentions, or pick from your task list below.</p>` : ""}
      ${Object.entries(PILLARS)
        .map(([key, label]) => pillarGroupHtml(key, label, tasks, intentions, prevIncomplete, editable, dismissedIntentions, dismissedCarryForward, "plan"))
        .join("")}
    </section>
    ${editable ? taskListHtml(openList, (S.weekListOpen ||= new Set()), { addLabel: "+ Week", addTitle: "Add to this week", daySelect: true, emptyText: "Everything open is already on this week's board." }) : ""}
    ${
      editable
        ? `<div class="btnrow" style="margin-top:22px"><button class="btn pri" id="startweek">${weekDoc.plannedAt ? "Save plan →" : "Start the week →"}</button></div>`
        : ""
    }`;

  const progressStep = `
    ${weekDoc.keyFocus ? `<div class="focuspin"><span class="k">${isPast ? "Key focus" : "This week"}</span>${esc(weekDoc.keyFocus)}</div>` : ""}
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <div class="progressband">
        <div class="top">
          <div><span class="num">${done}</span> <span style="color:var(--muted);font-size:14px">of ${total} task${total === 1 ? "" : "s"} done</span></div>
          <span class="lbl">${total ? donePct + "%" : "—"}</span>
        </div>
        <div class="track">
          <div class="seg" style="width:${donePct}%;background:var(--good)"></div>
          <div class="seg" style="width:${inprogPct}%;background:var(--d1)"></div>
          <div class="seg" style="width:${restPct}%;background:var(--sunk)"></div>
        </div>
        ${started ? soFarHtml(soFar) : ""}
      </div>
    </section>
    ${started ? weekGlanceHtml(dates, daysMap, tasks, false, master.tasks) : ""}
    <section class="blk">
      <h2>${isPast ? "The week's tasks" : "This week's tasks"}</h2>
      ${
        total
          ? Object.entries(PILLARS)
              .map(([key, label]) => pillarGroupHtml(key, label, tasks, intentions, prevIncomplete, editable, dismissedIntentions, dismissedCarryForward, "progress"))
              .join("")
          : `<p class="empty">Nothing planned yet.</p>`
      }
      ${editable ? `<div class="btnrow"><button class="btn sm" data-step="plan">Edit the plan</button></div>` : ""}
    </section>
    <details class="moredetail">
      <summary>More detail — month progress, stats, HPH, core steps</summary>
      <section class="blk">
        <h2>Progress toward this month</h2>
        ${
          intentions.length
            ? intentions
                .map((it) => {
                  const v = health[it.pillar];
                  return `
          <div class="monthcard">
            <div class="row1"><span class="txt">${esc(it.intention)}</span><span class="pl">${esc(PILLARS[it.pillar] || it.pillar)}</span></div>
            <div class="track"><div class="fill" style="width:${v ?? 0}%"></div></div>
            <span class="pct">${v != null ? v + "%" : "—"} of ${esc(PILLARS[it.pillar] || it.pillar)} top-3s done this month</span>
          </div>`;
                })
                .join("")
            : `<p class="empty">No intentions set for this month yet.</p>`
        }
      </section>
      <section class="blk">
        <h2>Stats</h2>
        <div class="stats">
          <div class="stat"><div class="k">Days journaled</div><div class="v">${stats.journaled}<small> / 7</small></div></div>
          <div class="stat"><div class="k">HPH avg</div><div class="v">${stats.hphAvg != null ? stats.hphAvg.toFixed(1) : "—"}</div></div>
          <div class="stat"><div class="k">Task completion</div><div class="v">${stats.top3Rate != null ? stats.top3Rate + "%" : "—"}</div></div>
        </div>
      </section>
      <section class="blk">
        <h2>HPH by day</h2>
        ${hphChartHtml(stats.byDate)}
      </section>
      <section class="blk">
        <h2>Business core steps</h2>
        ${coreTableHtml(dates, daysMap, "businessCoreSteps", BIZ)}
      </section>
      <section class="blk">
        <h2>Vitality core steps</h2>
        ${coreTableHtml(dates, daysMap, "vitalityCoreSteps", VIT)}
      </section>
    </details>`;

  const reviewStep = started
    ? weekReviewHtml(reviewCtx)
    : `<p class="empty">This week hasn't started yet — there's nothing to review.</p>`;

  main.innerHTML = `
    <div class="datehead" style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="iconbtn" id="prevweek" title="Previous week">‹</button>
        <div>
          <div class="sub">Week ${isoWeekNumber(weekOf)} ${weekTag(weekOf, curMonday)}</div>
          <h1 class="serif">${esc(shortDate(weekOf))} – ${esc(shortDate(sundayOf(weekOf)))}</h1>
        </div>
        <button class="iconbtn" id="nextweek" title="Next week">›</button>
      </div>
      ${weekOf !== curMonday ? `<button class="btn sm" id="jumpthisweek">This week</button>` : ""}
    </div>
    ${stepperHtml(
      [
        { key: "plan", label: "Plan", note: planned ? "done" : isPast ? "" : "start here", done: planned },
        { key: "progress", label: isPast ? "How it went" : "How it's going", note: isPast ? "" : weekOf > curMonday ? "" : `${done}/${total} done`, done: isPast },
        { key: "review", label: "Review", note: reviewed ? "done" : weekend || isPast ? "ready" : "", done: reviewed },
      ],
      step
    )}
    <div class="stepbody">${step === "plan" ? planStep : step === "review" ? reviewStep : progressStep}</div>`;

  wireWeekReview(reviewCtx);
  wireWeek(store, S, renderApp, weekOf, weekDoc, editable, prevIncomplete, mById);
}

function pillarGroupHtml(key, label, tasks, intentions, prevIncomplete, editable, dismissedIntentions, dismissedCarryForward, mode = "plan") {
  const inPillar = tasks.filter((t) => t.pillar === key);
  // "progress" = tick things off only; adding, removing and pull-ins live in "plan".
  if (mode === "progress") {
    if (!inPillar.length) return "";
    const d = inPillar.filter((t) => t.status === "done").length;
    return `
    <div class="pillargroup" data-pillar="${key}">
      <div class="pillarhead"><span class="nm">${esc(label)}</span><span class="prog">${d}/${inPillar.length}</span></div>
      ${inPillar
        .map(
          (t) => `
        <div class="ptask2 ${t.status === "done" ? "done" : ""}" data-id="${esc(t.id)}">
          <span class="box" ${editable ? 'data-toggle="1"' : ""}></span>
          <span class="tk">${esc(t.task)}</span>
          ${t.status === "carried_forward" ? `<span class="cf">carried over</span>` : `<span class="daychip">${esc(t.assignedDay || "—")}</span>`}
        </div>`
        )
        .join("")}
    </div>`;
  }
  const usedTexts = new Set(inPillar.map((t) => t.task.trim().toLowerCase()));
  // Pull-ins are an editing affordance — a past (read-only) week must never show
  // an actionable "+ Add as task" button, since its handlers aren't wired (see
  // wireWeek's early `if (!editable) return`) and it shouldn't be editable anyway.
  const monthPullins = editable
    ? intentions.filter(
        (it) =>
          it.pillar === key &&
          !usedTexts.has(it.intention.trim().toLowerCase()) &&
          !dismissedIntentions.has(it.intention.trim().toLowerCase())
      )
    : [];
  const carryPullins = editable ? prevIncomplete.filter((t) => t.pillar === key && !dismissedCarryForward.has(t.id)) : [];

  if (!editable && !inPillar.length && !monthPullins.length && !carryPullins.length) return "";

  const done = inPillar.filter((t) => t.status === "done").length;

  return `
    <div class="pillargroup" data-pillar="${key}">
      <div class="pillarhead"><span class="nm">${esc(label)}</span><span class="prog">${done}/${inPillar.length}</span></div>
      ${
        inPillar
          .map(
            (t) => `
        <div class="ptask2 ${t.status === "done" ? "done" : ""}" data-id="${esc(t.id)}">
          <span class="box" ${editable ? 'data-toggle="1"' : ""}></span>
          <span class="tk">${esc(t.task)}</span>
          ${t.status === "carried_forward" ? `<span class="cf">carried over</span>` : `<span class="daychip">${esc(t.assignedDay || "—")}</span>`}
          ${editable ? `<button class="rm" data-rm="${esc(t.id)}" title="Remove">×</button>` : ""}
        </div>`
          )
          .join("") || (editable ? "" : `<p class="empty" style="padding:10px 14px;font-size:12.5px">Nothing planned.</p>`)
      }
      ${
        monthPullins.length
          ? `<div class="frommonth">
        <span class="lbl">From this month's intentions</span>
        ${monthPullins
          .map(
            (it) => `
        <div class="item">
          <span>${esc(it.intention)}</span>
          <button class="pull-month" data-pillar="${key}" data-text="${esc(it.intention)}">+ Add as task</button>
          <button class="dismiss-month" data-text="${esc(it.intention)}" title="Not relevant this week">×</button>
        </div>`
          )
          .join("")}
      </div>`
          : ""
      }
      ${
        carryPullins.length
          ? `<div class="frommonth">
        <span class="lbl">From last week (incomplete)</span>
        ${carryPullins
          .map(
            (t) => `
        <div class="item">
          <span>${esc(t.task)}</span>
          <button class="pull-carry" data-pillar="${key}" data-id="${esc(t.id)}">+ Add as task</button>
          <button class="dismiss-carry" data-id="${esc(t.id)}" title="Not relevant this week">×</button>
        </div>`
          )
          .join("")}
      </div>`
          : ""
      }
      ${
        editable
          ? `<div class="addrow" data-pillar="${key}">
        <input type="text" class="newtaskinput" placeholder="Add a ${esc(label)} task…">
        <select class="newtaskday"><option value="">No day</option>${DAYKEYS.map((dk) => `<option value="${dk}">${dk}</option>`).join("")}</select>
        <button class="newtaskadd" data-pillar="${key}">Add</button>
      </div>`
          : ""
      }
    </div>`;
}

function hphChartHtml(byDate) {
  return `
    <div class="hphchart">
      <div class="threshold" style="bottom:60%"><span>6</span></div>
      ${byDate
        .map((d) => {
          const height = d.avg != null ? Math.max(4, (d.avg / 10) * 100) : 4;
          return `
        <div class="hbar ${d.date === todayISO() ? "today" : ""}">
          <span class="val">${d.avg != null ? d.avg.toFixed(1) : "—"}</span>
          <div class="col ${d.avg != null ? "filled" : "empty"}" style="height:${height}%"></div>
          <span class="dow">${esc(dayOfWeekName(d.date).slice(0, 3))}</span>
        </div>`;
        })
        .join("")}
    </div>`;
}

function coreTableHtml(dates, daysMap, which, defs) {
  return `
    <table class="coretable">
      <tr><th></th>${defs.map(([, l]) => `<th>${esc(l.slice(0, 4))}</th>`).join("")}</tr>
      ${dates
        .map((d) => {
          const doc = daysMap.get(d);
          const steps = doc ? evening(doc)[which] || {} : {};
          return `<tr><td class="dow">${esc(dayOfWeekName(d).slice(0, 3))}</td>${defs
            .map(([k]) => (steps[k] === true ? `<td style="color:var(--good)">■</td>` : `<td>▢</td>`))
            .join("")}</tr>`;
        })
        .join("")}
    </table>`;
}

function wireWeek(store, S, renderApp, weekOf, weekDoc, editable, prevIncomplete, mById) {
  $("#prevweek")?.addEventListener("click", () => {
    S.week = addDays(weekOf, -7);
    S.weekReviewEditing = false;
    S.weekStep = null;
    renderApp();
  });
  $("#nextweek")?.addEventListener("click", () => {
    S.week = addDays(weekOf, 7);
    S.weekReviewEditing = false;
    S.weekStep = null;
    renderApp();
  });
  $("#jumpthisweek")?.addEventListener("click", () => {
    S.week = mondayOf(todayISO());
    S.weekReviewEditing = false;
    S.weekStep = null;
    renderApp();
  });

  // Step bar (and "Edit the plan"): jump to any step.
  document.querySelectorAll("#main [data-step]").forEach((b) =>
    b.addEventListener("click", () => {
      S.weekStep = b.dataset.step;
      S.weekReviewEditing = false;
      renderApp();
    })
  );
  // Optional reminder on Plan: review last week first, or skip it.
  $("#nudgereview")?.addEventListener("click", () => {
    S.week = addDays(weekOf, -7);
    S.weekStep = "review";
    renderApp();
  });
  $("#nudgeskip")?.addEventListener("click", () => {
    (S.nudgeSkip ||= new Set()).add(weekOf);
    $(".nudge")?.remove();
  });

  if (!editable) return;

  $("#startweek")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const patch = { keyFocus: ($("#keyfocus")?.value || "").trim() };
    if (!weekDoc.plannedAt) patch.plannedAt = `${todayISO()}T${nowHM()}:00`;
    const ok = await store.saveWeek(weekOf, patch, true, `life-os: week-plan ${weekOf}`);
    btn.disabled = false;
    if (!ok) return;
    flash(patch.plannedAt ? "Week planned." : "Plan saved.");
    S.weekStep = "progress";
    renderApp();
  });

  $("#savefocus")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const ok = await store.saveWeek(weekOf, { keyFocus: $("#keyfocus").value.trim() }, true, `life-os: weekly ${weekOf}`);
    btn.disabled = false;
    if (ok) flash("Key focus saved.");
  });

  const saveTasks = (tasks, message) => store.saveWeek(weekOf, { tasks }, true, message || `life-os: weekly ${weekOf}`);

  document.querySelectorAll(".ptask2 .box[data-toggle]").forEach((box) => {
    box.addEventListener("click", () => {
      const id = box.closest(".ptask2").dataset.id;
      const cur = box.closest(".ptask2").classList.contains("done");
      const status = cur ? "not_started" : "done";
      const tasks = (weekDoc.tasks || []).map((t) => (t.id === id ? { ...t, status } : t));
      weekDoc.tasks = tasks;
      saveTasks(tasks);
      if (mById.has(id)) setTaskStatus(store, [id], status, `life-os: weekly ${weekOf}`).then(() => renderApp());
      else renderApp();
    });
  });

  document.querySelectorAll(".ptask2 .rm").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.rm;
      const tasks = (weekDoc.tasks || []).filter((t) => t.id !== id);
      weekDoc.tasks = tasks;
      saveTasks(tasks);
      renderApp();
    });
  });

  document.querySelectorAll(".newtaskadd").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pillar = btn.dataset.pillar;
      const row = btn.closest(".addrow");
      const input = row.querySelector(".newtaskinput");
      const text = input.value.trim();
      if (!text) return;
      const day = row.querySelector(".newtaskday").value;
      const created = await addTasks(store, [{ task: text, pillar }], `life-os: weekly ${weekOf}`);
      if (!created) return;
      const id = created[0].id;
      const tasks = [...(weekDoc.tasks || []), { id, task: text, pillar, assignedDay: day, status: "not_started", source: "manual" }];
      weekDoc.tasks = tasks;
      const ok = await saveTasks(tasks, `life-os: weekly ${weekOf}`);
      if (ok) flash("Task added.");
      renderApp();
    });
  });

  document.querySelectorAll(".pull-month").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pillar = btn.dataset.pillar;
      const text = btn.dataset.text;
      const created = await addTasks(store, [{ task: text, pillar }], `life-os: weekly ${weekOf}`);
      if (!created) return;
      const id = created[0].id;
      const tasks = [...(weekDoc.tasks || []), { id, task: text, pillar, assignedDay: "", status: "not_started", source: "manual" }];
      weekDoc.tasks = tasks;
      const ok = await saveTasks(tasks);
      if (ok) flash("Added from this month's intentions.");
      renderApp();
    });
  });

  document.querySelectorAll(".pull-carry").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pillar = btn.dataset.pillar;
      const source = prevIncomplete.find((t) => t.id === btn.dataset.id);
      if (!source) return;
      // Same master task if it's on the list; otherwise it becomes one now.
      let id = source.id;
      if (!mById.has(id)) {
        const created = await addTasks(store, [{ task: source.task, pillar }], `life-os: weekly ${weekOf}`);
        if (!created) return;
        id = created[0].id;
      }
      const tasks = [...(weekDoc.tasks || []), { id, task: source.task, pillar, assignedDay: "", status: "carried_forward", source: "manual" }];
      weekDoc.tasks = tasks;
      const ok = await saveTasks(tasks);
      if (ok) flash("Carried forward from last week.");
      renderApp();
    });
  });

  // Your task list (js/tasklist.js): + Week puts it on this week's board.
  wireTaskList({
    store,
    open: S.weekListOpen,
    mById,
    renderApp,
    onAdd: async (t, day) => {
      const tasks = [...(weekDoc.tasks || []), { id: t.id, task: t.task, pillar: t.pillar, assignedDay: day, status: t.status, source: t.source === "outlook" ? "outlook" : "manual" }];
      weekDoc.tasks = tasks;
      const ok = await saveTasks(tasks);
      if (ok) flash(day ? `Added to this week (${day}).` : "Added to this week.");
      return ok;
    },
  });

  document.querySelectorAll(".dismiss-month").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dismissedIntentions = [...(weekDoc.dismissedIntentions || []), btn.dataset.text];
      weekDoc.dismissedIntentions = dismissedIntentions;
      const ok = await store.saveWeek(weekOf, { dismissedIntentions }, true, `life-os: weekly ${weekOf}`);
      if (ok) flash("Dismissed for this week.");
      renderApp();
    });
  });

  document.querySelectorAll(".dismiss-carry").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dismissedCarryForward = [...(weekDoc.dismissedCarryForward || []), btn.dataset.id];
      weekDoc.dismissedCarryForward = dismissedCarryForward;
      const ok = await store.saveWeek(weekOf, { dismissedCarryForward }, true, `life-os: weekly ${weekOf}`);
      if (ok) flash("Dismissed for this week.");
      renderApp();
    });
  });
}

// OneNote export for the currently-navigated week (S.week), not an assumed
// single "current" week — matches the per-week-file navigation above.
export async function copyWeekForOneNote(store, weekOf) {
  const weekDoc = await store.getWeek(weekOf);
  const dates = weekDates(weekOf);
  const daysMap = await store.loadJournalMap(dates);
  const stats = weekStats(dates, daysMap);

  const title = `Week ${isoWeekNumber(weekOf)} — ${shortDate(weekOf)} – ${shortDate(sundayOf(weekOf))}`;
  const groups = [
    {
      heading: "Review",
      blocks: [
        { type: "kv", label: "Days journaled", value: `${stats.journaled} / 7` },
        { type: "kv", label: "HPH avg", value: stats.hphAvg != null ? stats.hphAvg.toFixed(1) : "—" },
        { type: "kv", label: "Task completion", value: stats.top3Rate != null ? `${stats.top3Rate}%` : "—" },
      ],
    },
    { heading: "Key focus", blocks: [{ type: "para", text: weekDoc.keyFocus || "—" }] },
    {
      heading: "Task plan",
      blocks: Object.entries(PILLARS).flatMap(([key, label]) => {
        const items = (weekDoc.tasks || []).filter((t) => t.pillar === key);
        if (!items.length) return [];
        return [{ type: "para", text: `${label}:` }, { type: "tasks", items }];
      }),
    },
  ];
  await copyRichText(buildSections(title, groups));
  flash("Week copied for OneNote.");
}
