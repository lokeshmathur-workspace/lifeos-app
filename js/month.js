// Month view — REQUIREMENTS.md §4.3, redesigned per the approved
// month-redesign-mockup.html round: same architecture and pattern as Week's
// redesign. One file per month (life-os/state/months/<YYYY-MM>.json) instead of a
// single currentMonth slot — see life-os/docs/SCHEMA.md — so last month, this
// month and a next-month plan can all exist and be edited independently (S.month,
// like Today's S.day and Week's S.week). A month in the past is read-only.
import { PILLARS, HPH } from "./constants.js";
import { todayISO, monthName, daysInMonth, D, mondayOf, monthKeyOf, addMonths } from "./dateutil.js";
import { hphAvg, evening } from "./derive.js";
import { flash } from "./flash.js";
import { buildSections, copyRichText } from "./export.js";
import { perHabitAvg, loadMonthWeeks, monthGlanceHtml, monthReviewHtml, wireMonthReview } from "./reviews.js";
import { isOpen } from "./tasks.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function monthDates(year, month) {
  const n = daysInMonth(year, month);
  return Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

export function pillarHealth(dates, daysMap) {
  const health = {};
  for (const p of Object.keys(PILLARS)) {
    let done = 0,
      total = 0;
    for (const d of dates) {
      const doc = daysMap.get(d);
      if (!doc) continue;
      for (const t of evening(doc).top3Results || []) {
        if (t.pillar === p) {
          total++;
          if (t.status === "done") done++;
        }
      }
    }
    health[p] = total ? Math.round((100 * done) / total) : null;
  }
  return health;
}

// Genuinely lowest-scoring habit last month, or null if there's no prior data —
// used for the opt-in "set as this month's focus" suggestion banner, replacing
// what used to be an automatic default applied by /month-start's rollover.
async function suggestFocusHabit(store, monthKey) {
  const prevKey = addMonths(monthKey, -1);
  const [prevYear, prevMonthNum] = prevKey.split("-").map(Number);
  const prevDates = monthDates(prevYear, prevMonthNum);
  const daysMap = await store.loadJournalMap(prevDates);
  const habitAvgs = perHabitAvg(prevDates, daysMap);
  let lowestKey = null,
    lowestVal = Infinity;
  for (const [k] of HPH) {
    if (habitAvgs[k] != null && habitAvgs[k] < lowestVal) {
      lowestVal = habitAvgs[k];
      lowestKey = k;
    }
  }
  return lowestKey ? HPH.find(([k]) => k === lowestKey)[1] : null;
}

function monthTag(monthKey, realKey) {
  if (monthKey === realKey) return `<span class="tag new">this month</span>`;
  if (monthKey < realKey) return `<span class="tag">past</span>`;
  return `<span class="tag moved">planning ahead</span>`;
}

export async function renderMonthView(store, S, renderApp) {
  const main = document.getElementById("main");
  main.innerHTML = `<p class="empty">Loading…</p>`;

  const monthKey = S.month;
  const realKey = monthKeyOf(todayISO());
  const isPast = monthKey < realKey;
  const editable = !isPast;

  const monthDoc = await store.getMonth(monthKey);
  const [year, monthNum] = monthKey.split("-").map(Number);
  const dates = monthDates(year, monthNum).filter((d) => d <= todayISO());
  const daysMap = await store.loadJournalMap(dates);
  const journaled = dates.filter((d) => daysMap.has(d)).length;
  const avgs = dates.map((d) => daysMap.get(d)).filter(Boolean).map(hphAvg).filter((v) => v != null);
  const monthAvg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
  const health = pillarHealth(dates, daysMap);

  const suggestedHabit = editable && !monthDoc.hphFocusHabit ? await suggestFocusHabit(store, monthKey) : null;

  const intentions = monthDoc.intentions || [];
  const done = intentions.filter((it) => it.status === "done").length;
  const inprog = intentions.filter((it) => it.status === "in_progress").length;
  const total = intentions.length;
  const donePct = total ? Math.round((100 * done) / total) : 0;
  const inprogPct = total ? Math.round((100 * inprog) / total) : 0;
  const restPct = Math.max(0, 100 - donePct - inprogPct);

  const curWeekOf = mondayOf(todayISO());

  // Weeks at a glance + the review that starts from them (not for future months).
  const started = monthKey <= realKey;
  const weeks = started ? await loadMonthWeeks(store, year, monthNum) : [];
  const reviewCtx = { store, S, renderApp, monthKey, monthDoc, weeks, dates, daysMap, editing: !!S.monthReviewEditing };
  const rollup = (first) => (started ? monthGlanceHtml(weeks, first) + monthReviewHtml(reviewCtx) : "");

  // Open tasks from the master list, offered as intentions per category.
  const master = editable ? await store.getTasks() : { tasks: [] };
  const intentTexts = new Set(intentions.map((it) => it.intention.trim().toLowerCase()));
  const openList = master.tasks.filter((t) => isOpen(t) && !intentTexts.has(t.task.trim().toLowerCase()));

  main.innerHTML = `
    <div class="datehead" style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="iconbtn" id="prevmonth" title="Previous month">‹</button>
        <div>
          <div class="sub">${esc(String(year))} ${monthTag(monthKey, realKey)}</div>
          <h1 class="serif">${esc(monthName(year, monthNum).split(" ")[0])}</h1>
        </div>
        <button class="iconbtn" id="nextmonth" title="Next month">›</button>
      </div>
      ${monthKey !== realKey ? `<button class="btn sm" id="jumpthismonth">This month</button>` : ""}
    </div>

    ${isPast ? rollup(true) : ""}

    <section class="blk" ${isPast ? "" : 'style="border-top:0;padding-top:0;margin-top:0"'}>
      <h2>This month's plan</h2>
      <div class="progressband">
        <div class="top">
          <div><span class="num">${done}</span> <span style="color:var(--muted);font-size:14px">of ${total} intention${total === 1 ? "" : "s"} done</span></div>
          <span class="lbl">${total ? donePct + "%" : "—"}</span>
        </div>
        <div class="track">
          <div class="seg" style="width:${donePct}%;background:var(--good)"></div>
          <div class="seg" style="width:${inprogPct}%;background:var(--d1)"></div>
          <div class="seg" style="width:${restPct}%;background:var(--sunk)"></div>
        </div>
        ${
          editable
            ? `<div class="fields">
          <label><b>Sprint theme</b><input type="text" id="theme" value="${esc(monthDoc.sprintTheme || "")}"></label>
          <div class="rowfields">
            <label><b>One thing to protect</b><input type="text" id="protect" value="${esc(monthDoc.oneThingToProtect || "")}"></label>
            <label><b>Habit focus</b><select id="focushabit">${HPH.map(([, l]) => `<option value="${l}" ${l === monthDoc.hphFocusHabit ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          </div>
          <div class="btnrow" style="margin-top:0"><button class="btn sm" id="saveplan">Save</button></div>
        </div>`
            : `<div class="fields" style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
          <label><b>Sprint theme</b>${esc(monthDoc.sprintTheme || "—")}</label>
          <label><b>One thing to protect</b>${esc(monthDoc.oneThingToProtect || "—")}</label>
          <label><b>Habit focus</b>${esc(monthDoc.hphFocusHabit || "—")}</label>
        </div>`
        }
      </div>
      ${
        suggestedHabit
          ? `<div class="banner" style="margin-top:10px;display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap">
        <span>Last month's lowest habit was <b>${esc(suggestedHabit)}</b> — set as this month's focus?</span>
        <button class="btn sm" id="acceptsuggestedhabit">Set focus</button>
      </div>`
          : ""
      }
    </section>

    ${isPast ? "" : rollup(false)}

    <section class="blk">
      <h2>Intentions by category</h2>
      ${Object.entries(PILLARS)
        .map(([key, label]) => intentionGroupHtml(key, label, intentions, editable, openList))
        .join("")}
    </section>

    <section class="blk">
      <h2>Key dates</h2>
      <div class="card">
        ${keyDatesHtml(monthDoc.keyDates || [], editable)}
      </div>
    </section>

    <section class="blk">
      <h2>Stats</h2>
      <div class="stats">
        <div class="stat"><div class="k">Days journaled</div><div class="v">${journaled}<small> / ${dates.length}</small></div></div>
        <div class="stat"><div class="k">HPH avg</div><div class="v">${monthAvg != null ? monthAvg.toFixed(1) : "—"}</div></div>
        <div class="stat"><div class="k">Habit focus</div><div class="v" style="font-size:22px">${esc(monthDoc.hphFocusHabit || "—")}</div></div>
      </div>
    </section>

    <section class="blk">
      <h2>Weekly HPH</h2>
      ${weeklyHphChartHtml(monthDoc.weeklyHPHAvgs || [], curWeekOf)}
    </section>

    <section class="blk">
      <h2>Pillar health</h2>
      <div class="pbars">
        ${Object.entries(PILLARS)
          .map(([k, l]) => {
            const v = health[k];
            return `<div class="pbar"><span>${esc(l)}</span><div class="track"><div class="fill" style="width:${v ?? 0}%"></div></div><span class="n">${v != null ? v + "%" : "—"}</span></div>`;
          })
          .join("")}
      </div>
      <p style="font-size:12px;color:var(--muted);margin:8px 0 0">Auto-computed from daily top-3 completion — a separate reference from the self-reported intention progress above, since the two can legitimately disagree.</p>
    </section>

    <section class="blk">
      <h2>Calendar</h2>
      ${calendarGrid(year, monthNum, daysMap)}
    </section>`;

  wireMonthReview(reviewCtx);
  wireMonth(store, S, renderApp, monthKey, monthDoc, editable);
}

function intentionGroupHtml(key, label, intentions, editable, openList) {
  const fromList = editable ? openList.filter((t) => t.pillar === key) : [];
  const rows = intentions
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.pillar === key);

  if (!editable && !rows.length) return "";

  const done = rows.filter(({ it }) => it.status === "done").length;

  return `
    <div class="pillargroup" data-pillar="${key}">
      <div class="pillarhead"><span class="nm">${esc(label)}</span><span class="prog">${done}/${rows.length}</span></div>
      ${
        rows
          .map(
            ({ it, i }) => `
        <div class="introw ${it.status === "done" ? "done" : ""}" data-i="${i}">
          <div class="top">
            ${
              editable
                ? `<input type="text" class="txt" value="${esc(it.intention)}">
              <select class="status">
                <option value="not_started" ${it.status === "not_started" ? "selected" : ""}>not started</option>
                <option value="in_progress" ${it.status === "in_progress" ? "selected" : ""}>in progress</option>
                <option value="done" ${it.status === "done" ? "selected" : ""}>done</option>
              </select>
              <button class="rm" data-rm="${i}" title="Remove">×</button>`
                : `<span class="txt" style="background:none">${esc(it.intention)}</span>
              <span class="daychip">${esc((it.status || "not_started").replace("_", " "))}</span>`
            }
          </div>
          ${
            editable
              ? `<div class="proggy"><input type="range" min="0" max="100" step="5" value="${it.progress ?? 0}"><span class="pct">${it.progress ?? 0}%</span></div>`
              : `<div class="proggy"><div class="track" style="flex:1"><div class="fill" style="width:${it.progress ?? 0}%"></div></div><span class="pct">${it.progress ?? 0}%</span></div>`
          }
        </div>`
          )
          .join("") || (editable ? "" : `<p class="empty" style="padding:10px 14px;font-size:12.5px">No intentions.</p>`)
      }
      ${
        fromList.length
          ? `<details class="frommonth">
        <summary class="lbl" style="cursor:pointer">From your task list (${fromList.length})</summary>
        ${fromList
          .map(
            (t) => `
        <div class="item">
          <span>${esc(t.task)}</span>
          <button class="pull-intent" data-pillar="${key}" data-text="${esc(t.task)}">+ Add as intention</button>
        </div>`
          )
          .join("")}
      </details>`
          : ""
      }
      ${
        editable
          ? `<div class="addrow" data-pillar="${key}">
        <input type="text" class="newintinput" placeholder="Add a ${esc(label)} intention…">
        <button class="newintadd" data-pillar="${key}">Add</button>
      </div>`
          : ""
      }
    </div>`;
}

function keyDatesHtml(keyDates, editable) {
  const rows = keyDates.map((kd, i) => ({ kd, i })).sort((a, b) => (a.kd.date < b.kd.date ? -1 : 1));
  const list = rows
    .map(
      ({ kd, i }) => `
    <div class="kdrow" data-i="${i}">
      ${
        editable
          ? `<input type="date" class="date mono" value="${/^\d{4}-\d{2}-\d{2}$/.test(kd.date) ? kd.date : ""}" style="width:132px">
        <input type="text" class="ev" value="${esc(kd.event)}">
        <button class="rm" data-rm="${i}" title="Remove">×</button>`
          : `<span class="date mono">${esc(kd.date)}</span><span class="ev" style="background:none">${esc(kd.event)}</span>`
      }
    </div>`
    )
    .join("");
  return (
    (list || `<p class="empty" style="padding:0">No key dates yet.</p>`) +
    (editable
      ? `<div class="kdaddrow"><input type="date" id="newkddate"><input type="text" id="newkdevent" placeholder="Event…"><button id="newkdadd">Add</button></div>`
      : "")
  );
}

function weeklyHphChartHtml(weeklyHPHAvgs, curWeekOf) {
  if (!weeklyHPHAvgs.length) return `<p class="empty">No weeks closed out yet this month.</p>`;
  return `
    <div class="hphchart compact">
      <div class="threshold" style="bottom:60%"><span>6</span></div>
      ${weeklyHPHAvgs
        .map((w) => {
          const height = w.avg != null ? Math.max(4, (w.avg / 10) * 100) : 4;
          return `
        <div class="hbar ${w.weekOf === curWeekOf ? "today" : ""}">
          <span class="val">${w.avg != null ? w.avg.toFixed(1) : "—"}</span>
          <div class="col ${w.avg != null ? "filled" : "empty"}" style="height:${height}%"></div>
          <span class="dow">${esc(w.week)}</span>
        </div>`;
        })
        .join("")}
    </div>
    <p style="font-size:12px;color:var(--muted);margin-top:6px">One bar per week closed out by /weekly or the Week view this month. Dashed line = the 6 threshold.</p>`;
}

function calendarGrid(year, month, daysMap) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // Mon=0
  const n = daysInMonth(year, month);
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(`<div class="day blank"></div>`);
  for (let d = 1; d <= n; d++) {
    const dateISO = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const doc = daysMap.get(dateISO);
    const avg = doc ? hphAvg(doc) : null;
    const isToday = dateISO === todayISO();
    cells.push(
      `<div class="day ${doc ? "has" : ""} ${isToday ? "today" : ""}" data-date="${dateISO}" style="${
        doc ? `background:color-mix(in srgb, var(--d1) ${Math.round(((avg ?? 5) / 10) * 100)}%, var(--sunk))` : ""
      }">${d}</div>`
    );
  }
  return `
    <div class="cal">
      ${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="dow">${d}</div>`).join("")}
      ${cells.join("")}
    </div>`;
}

function wireMonth(store, S, renderApp, monthKey, monthDoc, editable) {
  $("#prevmonth")?.addEventListener("click", () => {
    S.month = addMonths(monthKey, -1);
    S.monthReviewEditing = false;
    renderApp();
  });
  $("#nextmonth")?.addEventListener("click", () => {
    S.month = addMonths(monthKey, 1);
    S.monthReviewEditing = false;
    renderApp();
  });
  $("#jumpthismonth")?.addEventListener("click", () => {
    S.month = monthKeyOf(todayISO());
    S.monthReviewEditing = false;
    renderApp();
  });

  document.querySelectorAll(".cal .day.has").forEach((el) => {
    el.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("lifeos:goto-day", { detail: el.dataset.date }));
    });
  });

  if (!editable) return;

  $("#acceptsuggestedhabit")?.addEventListener("click", async () => {
    const btn = $("#acceptsuggestedhabit");
    const label = document.querySelector(".banner b")?.textContent;
    if (!label) return;
    btn.disabled = true;
    const ok = await store.saveMonth(monthKey, { hphFocusHabit: label }, true, `life-os: month-start ${monthKey}`);
    btn.disabled = false;
    if (ok) {
      flash("Habit focus set.");
      renderApp();
    }
  });

  $("#saveplan")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const ok = await store.saveMonth(
      monthKey,
      {
        sprintTheme: $("#theme").value.trim(),
        oneThingToProtect: $("#protect").value.trim(),
        hphFocusHabit: $("#focushabit").value,
      },
      true,
      `life-os: month-plan ${monthKey}`
    );
    btn.disabled = false;
    if (ok) flash("Month plan saved.");
  });

  const saveIntentions = (intentions, message) =>
    store.saveMonth(monthKey, { intentions }, true, message || `life-os: month-plan ${monthKey}`);

  document.querySelectorAll(".introw .txt").forEach((input) => {
    input.addEventListener("change", () => {
      const i = Number(input.closest(".introw").dataset.i);
      const intentions = [...(monthDoc.intentions || [])];
      intentions[i] = { ...intentions[i], intention: input.value.trim() };
      monthDoc.intentions = intentions;
      saveIntentions(intentions);
      renderApp();
    });
  });
  document.querySelectorAll(".introw .status").forEach((sel) => {
    sel.addEventListener("change", () => {
      const i = Number(sel.closest(".introw").dataset.i);
      const intentions = [...(monthDoc.intentions || [])];
      intentions[i] = { ...intentions[i], status: sel.value };
      monthDoc.intentions = intentions;
      saveIntentions(intentions);
      renderApp();
    });
  });
  document.querySelectorAll(".introw .proggy input[type=range]").forEach((range) => {
    const pct = range.parentElement.querySelector(".pct");
    range.addEventListener("input", () => {
      pct.textContent = `${range.value}%`;
    });
    range.addEventListener("change", () => {
      const i = Number(range.closest(".introw").dataset.i);
      const intentions = [...(monthDoc.intentions || [])];
      intentions[i] = { ...intentions[i], progress: Number(range.value) };
      monthDoc.intentions = intentions;
      saveIntentions(intentions);
      renderApp();
    });
  });
  document.querySelectorAll(".introw .rm").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.rm);
      const intentions = (monthDoc.intentions || []).filter((_, idx) => idx !== i);
      monthDoc.intentions = intentions;
      saveIntentions(intentions);
      renderApp();
    });
  });
  document.querySelectorAll(".newintadd").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pillar = btn.dataset.pillar;
      const row = btn.closest(".addrow");
      const input = row.querySelector(".newintinput");
      const text = input.value.trim();
      if (!text) return;
      const intentions = [...(monthDoc.intentions || []), { intention: text, pillar, status: "not_started", progress: 0 }];
      monthDoc.intentions = intentions;
      saveIntentions(intentions);
      renderApp();
    });
  });

  document.querySelectorAll(".pull-intent").forEach((btn) => {
    btn.addEventListener("click", () => {
      const intentions = [...(monthDoc.intentions || []), { intention: btn.dataset.text, pillar: btn.dataset.pillar, status: "not_started", progress: 0 }];
      monthDoc.intentions = intentions;
      saveIntentions(intentions);
      renderApp();
    });
  });

  const saveKeyDates = (keyDates) => store.saveMonth(monthKey, { keyDates }, true, `life-os: month-plan ${monthKey}`);

  document.querySelectorAll(".kdrow .date").forEach((input) => {
    input.addEventListener("change", () => {
      const i = Number(input.closest(".kdrow").dataset.i);
      const keyDates = [...(monthDoc.keyDates || [])];
      keyDates[i] = { ...keyDates[i], date: input.value };
      monthDoc.keyDates = keyDates;
      saveKeyDates(keyDates);
    });
  });
  document.querySelectorAll(".kdrow .ev").forEach((input) => {
    input.addEventListener("change", () => {
      const i = Number(input.closest(".kdrow").dataset.i);
      const keyDates = [...(monthDoc.keyDates || [])];
      keyDates[i] = { ...keyDates[i], event: input.value.trim() };
      monthDoc.keyDates = keyDates;
      saveKeyDates(keyDates);
    });
  });
  document.querySelectorAll(".kdrow .rm").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.rm);
      const keyDates = (monthDoc.keyDates || []).filter((_, idx) => idx !== i);
      monthDoc.keyDates = keyDates;
      saveKeyDates(keyDates);
      renderApp();
    });
  });
  $("#newkdadd")?.addEventListener("click", () => {
    const date = $("#newkddate").value;
    const event = $("#newkdevent").value.trim();
    if (!date || !event) return;
    const keyDates = [...(monthDoc.keyDates || []), { date, event }];
    monthDoc.keyDates = keyDates;
    saveKeyDates(keyDates);
    renderApp();
  });
}

// OneNote export for the currently-navigated month (S.month), not an assumed
// single "current" month — matches the per-month-file navigation above.
export async function copyMonthForOneNote(store, monthKey) {
  const monthDoc = await store.getMonth(monthKey);
  const [year, monthNum] = monthKey.split("-").map(Number);
  const dates = monthDates(year, monthNum).filter((d) => d <= todayISO());
  const daysMap = await store.loadJournalMap(dates);
  const journaled = dates.filter((d) => daysMap.has(d)).length;
  const avgs = dates.map((d) => daysMap.get(d)).filter(Boolean).map(hphAvg).filter((v) => v != null);
  const monthAvg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
  const health = pillarHealth(dates, daysMap);

  const title = `${monthDoc.month} ${monthDoc.year} — ${monthDoc.sprintTheme || "No theme set"}`;
  const groups = [
    {
      heading: "Review",
      blocks: [
        { type: "kv", label: "Days journaled", value: `${journaled} / ${dates.length}` },
        { type: "kv", label: "HPH avg", value: monthAvg != null ? monthAvg.toFixed(1) : "—" },
        { type: "kv", label: "Habit focus", value: monthDoc.hphFocusHabit || "—" },
        { type: "kv", label: "One thing to protect", value: monthDoc.oneThingToProtect || "—" },
      ],
    },
    {
      heading: "Pillar health",
      blocks: [{ type: "list", items: Object.entries(PILLARS).map(([k, l]) => `${l}: ${health[k] != null ? health[k] + "%" : "—"}`) }],
    },
    { heading: "Weekly HPH", blocks: [{ type: "list", items: (monthDoc.weeklyHPHAvgs || []).map((w) => `${w.week}: ${w.avg.toFixed(1)}`) }] },
    {
      heading: "Intentions",
      blocks: [{ type: "list", items: (monthDoc.intentions || []).map((i) => `${i.intention} (${PILLARS[i.pillar] || i.pillar}) — ${i.status}, ${i.progress}%`) }],
    },
    { heading: "Key dates", blocks: [{ type: "list", items: (monthDoc.keyDates || []).map((k) => `${k.date}: ${k.event}`) }] },
  ];
  await copyRichText(buildSections(title, groups));
  flash("Month copied for OneNote.");
}
