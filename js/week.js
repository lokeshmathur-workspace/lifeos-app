// Week view — REQUIREMENTS.md §4.2. There is only ever one "current week" record
// (DATA-MODEL.md's Current state), so unlike Today there's no historical
// navigation here — this view is always the live week, and rolls itself forward
// when state.currentWeek.weekOf goes stale (DATA-MODEL.md's stale-week guard).
import { PILLARS, BIZ, VIT, HPH } from "./constants.js";
import { mondayOf, sundayOf, isoWeekNumber, shortDate, dayOfWeekName, addDays, DAYKEYS, todayISO } from "./dateutil.js";
import { hphAvg, coreCount, top3Of, evening } from "./derive.js";
import { nextTaskId } from "./compact.js";

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

function heatmapGrid(dates, daysMap) {
  const cols = [...BIZ, ...VIT];
  return `
    <div class="chartwrap">
      <table class="mono" style="border-collapse:collapse;font-size:10px;width:100%">
        <thead><tr><th></th>${cols.map(([, l]) => `<th style="padding:3px;color:var(--muted);font-weight:500">${esc(l.slice(0, 3))}</th>`).join("")}</tr></thead>
        <tbody>
          ${dates
            .map((d) => {
              const doc = daysMap.get(d);
              const has = !!doc;
              const biz = has ? evening(doc).businessCoreSteps || {} : {};
              const vit = has ? evening(doc).vitalityCoreSteps || {} : {};
              const steps = { ...biz, ...vit };
              return `<tr><td style="padding:3px;color:var(--muted)">${esc(dayOfWeekName(d).slice(0, 3))}</td>${cols
                .map(([k]) => {
                  const state = !has ? "sunk" : steps[k] === true ? "good" : "stop-soft";
                  const bg = state === "sunk" ? "var(--sunk)" : state === "good" ? "var(--good)" : "var(--sunk)";
                  return `<td style="padding:2px"><div style="width:16px;height:16px;border-radius:3px;background:${bg}"></div></td>`;
                })
                .join("")}</tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

export async function renderWeekView(store, S, renderApp) {
  const main = document.getElementById("main");
  const state = await store.getState();
  const cw = state.currentWeek || {};
  const curMonday = mondayOf(todayISO());

  if (cw.weekOf !== curMonday) {
    main.innerHTML = `
      <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
        <div class="card">
          <p style="margin:0 0 14px;color:var(--ink-2)">${cw.weekOf ? `Last week's plan (of ${esc(cw.weekOf)}) is done.` : "No week started yet."} Start the week of ${esc(shortDate(curMonday))}–${esc(shortDate(sundayOf(curMonday)))}?</p>
          <div class="btnrow" style="margin-top:0"><button class="btn pri" id="startweek">Start this week</button></div>
        </div>
      </section>`;
    $("#startweek").addEventListener("click", async () => {
      await startNewWeek(store, cw, curMonday);
      renderApp();
    });
    return;
  }

  const dates = weekDates(curMonday);
  const daysMap = await store.loadJournalMap(dates);
  const stats = weekStats(dates, daysMap);

  main.innerHTML = `
    <div class="datehead" style="margin-bottom:22px">
      <div><div class="sub">Week ${isoWeekNumber(curMonday)}</div><h1 class="serif">${esc(shortDate(curMonday))} – ${esc(shortDate(sundayOf(curMonday)))}</h1></div>
    </div>
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <div class="stats">
        <div class="stat"><div class="k">Days journaled</div><div class="v">${stats.journaled}<small> / 7</small></div></div>
        <div class="stat"><div class="k">HPH avg</div><div class="v">${stats.hphAvg != null ? stats.hphAvg.toFixed(1) : "—"}</div></div>
        <div class="stat"><div class="k">Top 3 completion</div><div class="v">${stats.top3Rate != null ? stats.top3Rate + "%" : "—"}</div></div>
      </div>
    </section>
    <section class="blk">
      <h2>HPH by day <span class="count">threshold 6</span></h2>
      <div style="display:flex;gap:6px;align-items:flex-end;height:70px">
        ${stats.byDate
          .map(
            (d) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end;height:100%">
            <div style="width:100%;background:${d.avg != null ? "var(--d1)" : "var(--sunk)"};height:${d.avg != null ? Math.max(4, (d.avg / 10) * 100) : 3}%;border-radius:3px 3px 0 0" title="${d.avg != null ? d.avg.toFixed(1) : "no entry"}"></div>
            <span class="mono" style="font-size:9.5px;color:var(--muted)">${esc(dayOfWeekName(d.date).slice(0, 1))}</span>
          </div>`
          )
          .join("")}
      </div>
    </section>
    <section class="blk">
      <h2>Core steps</h2>
      ${heatmapGrid(dates, daysMap)}
    </section>
    <section class="blk">
      <h2>Key focus</h2>
      <textarea id="keyfocus" rows="2">${esc(cw.keyFocus || "")}</textarea>
      <div class="btnrow"><button class="btn sm" id="savefocus">Save</button></div>
    </section>
    <section class="blk">
      <h2>Goals</h2>
      <div id="goalslist">${(cw.goals || [])
        .map(
          (g, i) => `
        <div class="t3row" data-i="${i}">
          <input type="text" class="goaltext" value="${esc(g.goal)}">
          <select class="goalpillar">${Object.entries(PILLARS).map(([k, l]) => `<option value="${k}" ${k === g.pillar ? "selected" : ""}>${l}</option>`).join("")}</select>
          <button class="rm" data-rm="${i}" title="Remove">×</button>
        </div>`
        )
        .join("")}</div>
      <div class="btnrow"><button class="btn sm" id="addgoal">Add goal</button><button class="btn sm pri" id="savegoals">Save goals</button></div>
    </section>
    <section class="blk">
      <h2>Task board</h2>
      <div class="plan">
        ${[...DAYKEYS, ""].map((dk) => weekdayColumn(dk, cw.tasks || [], dates)).join("")}
      </div>
      <div class="composer" style="margin-top:14px">
        <input type="text" id="newtask" placeholder="New task…">
        <select id="newtaskpillar">${Object.entries(PILLARS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <select id="newtaskday"><option value="">Unassigned</option>${DAYKEYS.map((dk) => `<option value="${dk}">${dk}</option>`).join("")}</select>
        <button class="btn" id="addtask">Add</button>
      </div>
    </section>`;

  wireWeek(store, state, dates);
}

function weekdayColumn(dk, tasks, dates) {
  const idx = DAYKEYS.indexOf(dk);
  const dateForDk = idx >= 0 ? dates[idx] : null;
  const label = dk || "Unassigned";
  const items = tasks.filter((t) => (t.assignedDay || "") === dk);
  return `
    <div class="pday ${dateForDk && dateForDk === todayISO() ? "today" : ""}">
      <h4>${esc(label)}${dateForDk ? ` <span>${esc(shortDate(dateForDk))}</span>` : ""}</h4>
      ${items
        .map(
          (t) => `
        <div class="ptask" data-id="${esc(t.id)}" data-s="${t.status}">
          <span class="tk">${esc(t.task)}</span>
          <span class="pl">${esc(PILLARS[t.pillar] || t.pillar)}</span>
        </div>`
        )
        .join("") || `<p class="empty" style="padding:6px 0;font-size:12.5px">—</p>`}
    </div>`;
}

function wireWeek(store, state, dates) {
  $("#savefocus")?.addEventListener("click", () => {
    store.saveState({ currentWeek: { keyFocus: $("#keyfocus").value.trim() } }, true, `life-os: weekly ${state.currentWeek.weekOf}`);
  });
  $("#addgoal")?.addEventListener("click", () => {
    const list = $("#goalslist");
    const i = list.children.length;
    const div = document.createElement("div");
    div.className = "t3row";
    div.dataset.i = i;
    div.innerHTML = `<input type="text" class="goaltext" placeholder="New goal"><select class="goalpillar">${Object.entries(PILLARS)
      .map(([k, l]) => `<option value="${k}">${l}</option>`)
      .join("")}</select><button class="rm" data-rm="${i}" title="Remove">×</button>`;
    list.appendChild(div);
    wireGoalRemove(list);
  });
  wireGoalRemove($("#goalslist"));
  $("#savegoals")?.addEventListener("click", () => {
    const goals = [...document.querySelectorAll("#goalslist .t3row")]
      .map((row) => ({
        goal: row.querySelector(".goaltext").value.trim(),
        pillar: row.querySelector(".goalpillar").value,
        status: "not_started",
        source: "manual",
      }))
      .filter((g) => g.goal);
    store.saveState({ currentWeek: { goals } }, true, `life-os: weekly ${state.currentWeek.weekOf}`);
  });

  document.querySelectorAll(".ptask").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      const tasks = (state.currentWeek.tasks || []).map((t) =>
        t.id === id ? { ...t, status: t.status === "done" ? "not_started" : "done" } : t
      );
      state.currentWeek.tasks = tasks;
      el.dataset.s = tasks.find((t) => t.id === id).status;
      store.saveState({ currentWeek: { tasks } }, true, `life-os: weekly ${state.currentWeek.weekOf}`);
    });
  });

  $("#addtask")?.addEventListener("click", () => {
    const text = $("#newtask").value.trim();
    if (!text) return;
    const pillar = $("#newtaskpillar").value;
    const day = $("#newtaskday").value;
    const id = nextTaskId(todayISO(), [state.currentWeek.tasks || []]);
    const tasks = [...(state.currentWeek.tasks || []), { id, task: text, pillar, assignedDay: day, status: "not_started", source: "manual" }];
    store.saveState({ currentWeek: { tasks } }, true, `life-os: weekly ${state.currentWeek.weekOf}`);
    state.currentWeek.tasks = tasks;
    $("#newtask").value = "";
  });
}

function wireGoalRemove(list) {
  list.querySelectorAll(".rm").forEach((btn) => {
    btn.onclick = () => btn.closest(".t3row").remove();
  });
}

// Rollover per .claude/commands/weekly.md's Save step, ported to code:
// - incomplete tasks (status !== done) carry forward with status "carried_forward"
//   and a NEW task id
// - the closing week's HPH average is appended to currentMonth.weeklyHPHAvgs
// - a fresh week starts with just the carried-forward tasks; goals/focus reset
export async function startNewWeek(store, oldWeek, newMonday) {
  const oldMonday = oldWeek.weekOf;
  let closingAvg = null;
  if (oldMonday) {
    const oldDates = weekDates(oldMonday);
    const daysMap = await store.loadJournalMap(oldDates);
    const stats = weekStats(oldDates, daysMap);
    closingAvg = stats.hphAvg;
  }

  const carried = (oldWeek.tasks || [])
    .filter((t) => t.status !== "done")
    .map((t) => ({ ...t, status: "carried_forward" }));
  const assigned = [];
  for (const t of carried) {
    t.id = nextTaskId(todayISO(), [oldWeek.tasks || [], assigned]);
    assigned.push(t);
  }

  const state = await store.getState();
  const patch = {
    currentWeek: {
      weekNumber: isoWeekNumber(newMonday),
      weekOf: newMonday,
      weekEnding: sundayOf(newMonday),
      keyFocus: "",
      goals: [],
      tasks: carried,
    },
  };
  if (oldMonday && closingAvg != null) {
    patch.currentMonth = {
      weeklyHPHAvgs: [
        ...((state.currentMonth && state.currentMonth.weeklyHPHAvgs) || []),
        { week: `W${isoWeekNumber(oldMonday)}`, weekOf: oldMonday, avg: closingAvg },
      ],
    };
  }
  store.saveState(patch, true, `life-os: weekly ${newMonday}`);
}
