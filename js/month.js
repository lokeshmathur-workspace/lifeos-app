// Month view — REQUIREMENTS.md §4.3. Like Week, there's only one "current month"
// record, so this is always the live month; it rolls itself forward when
// state.currentMonth no longer matches the real current month.
import { PILLARS, HPH } from "./constants.js";
import { todayISO, monthName, daysInMonth, dayOfWeekName, D, isoOf } from "./dateutil.js";
import { hphAvg, top3Of, evening } from "./derive.js";
import { flash } from "./flash.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function monthDates(year, month) {
  const n = daysInMonth(year, month);
  return Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

function pillarHealth(dates, daysMap) {
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

function perHabitAvg(dates, daysMap) {
  const out = {};
  for (const [k] of HPH) {
    const vals = dates.map((d) => daysMap.get(d)).filter(Boolean).map((doc) => evening(doc).hph?.[k]).filter((v) => typeof v === "number");
    out[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return out;
}

export async function renderMonthView(store, S, renderApp) {
  const main = document.getElementById("main");
  const state = await store.getState();
  const cm = state.currentMonth || {};
  const today = D(todayISO());
  const realYear = today.getUTCFullYear();
  const realMonthName = monthName(realYear, today.getUTCMonth() + 1).split(" ")[0];

  if (cm.month !== realMonthName || cm.year !== realYear) {
    main.innerHTML = `
      <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
        <div class="card">
          <p style="margin:0 0 14px;color:var(--ink-2)">${cm.month ? `${esc(cm.month)} ${esc(cm.year)} is done.` : "No month started yet."} Start ${esc(monthName(realYear, today.getUTCMonth() + 1))}?</p>
          <div class="btnrow" style="margin-top:0"><button class="btn pri" id="startmonth">Start this month</button></div>
        </div>
      </section>`;
    $("#startmonth").addEventListener("click", async () => {
      await startNewMonth(store, cm, realYear, today.getUTCMonth() + 1);
      renderApp();
    });
    return;
  }

  const monthNum = today.getUTCMonth() + 1;
  const dates = monthDates(realYear, monthNum).filter((d) => d <= todayISO());
  const daysMap = await store.loadJournalMap(dates);
  const journaled = dates.filter((d) => daysMap.has(d)).length;
  const avgs = dates.map((d) => daysMap.get(d)).filter(Boolean).map(hphAvg).filter((v) => v != null);
  const monthAvg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
  const health = pillarHealth(dates, daysMap);

  main.innerHTML = `
    <div class="datehead" style="margin-bottom:22px">
      <div><div class="sub">${esc(cm.month)} ${esc(cm.year)}</div><h1 class="serif">${esc(cm.sprintTheme || "No theme set")}</h1></div>
    </div>
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <div class="stats">
        <div class="stat"><div class="k">Days journaled</div><div class="v">${journaled}<small> / ${dates.length}</small></div></div>
        <div class="stat"><div class="k">HPH avg</div><div class="v">${monthAvg != null ? monthAvg.toFixed(1) : "—"}</div></div>
        <div class="stat"><div class="k">Habit focus</div><div class="v" style="font-size:20px">${esc(cm.hphFocusHabit || "—")}</div></div>
      </div>
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
    </section>
    <section class="blk">
      <h2>Weekly HPH</h2>
      ${(cm.weeklyHPHAvgs || []).length
        ? `<div class="hphlist">${cm.weeklyHPHAvgs
            .map((w) => `<div class="hphrow"><span class="nm">${esc(w.week)}</span><div class="track"><div class="fill" style="width:${(w.avg / 10) * 100}%"></div></div><span class="num">${w.avg.toFixed(1)}</span></div>`)
            .join("")}</div>`
        : `<p class="empty">No weeks closed out yet this month.</p>`}
    </section>
    <section class="blk">
      <h2>Calendar</h2>
      ${calendarGrid(realYear, monthNum, daysMap)}
    </section>
    <section class="blk">
      <h2>Plan</h2>
      <label class="fld"><span>Theme</span><input type="text" id="theme" value="${esc(cm.sprintTheme || "")}"></label>
      <label class="fld"><span>One thing to protect</span><input type="text" id="protect" value="${esc(cm.oneThingToProtect || "")}"></label>
      <label class="fld"><span>Habit focus</span>
        <select id="focushabit">${HPH.map(([, l]) => `<option value="${l}" ${l === cm.hphFocusHabit ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
    </section>
    <section class="blk">
      <h2>Intentions</h2>
      <div id="intentlist">${(cm.intentions || [])
        .map(
          (it, i) => `
        <div class="t3row" data-i="${i}">
          <input type="text" class="intenttext" value="${esc(it.intention)}">
          <select class="intentpillar">${Object.entries(PILLARS).map(([k, l]) => `<option value="${k}" ${k === it.pillar ? "selected" : ""}>${l}</option>`).join("")}</select>
          <button class="rm" data-rm="${i}">×</button>
        </div>`
        )
        .join("")}</div>
      <div class="btnrow"><button class="btn sm" id="addintent">Add intention</button></div>
    </section>
    <section class="blk">
      <h2>Key dates</h2>
      <div id="keydateslist">${(cm.keyDates || [])
        .map(
          (kd, i) => `
        <div class="t3row" data-i="${i}">
          <input type="date" class="kddate" value="${/^\d{4}-\d{2}-\d{2}$/.test(kd.date) ? kd.date : ""}" style="flex:none;width:150px">
          <input type="text" class="kdevent" value="${esc(kd.event)}">
          <button class="rm" data-rm="${i}">×</button>
        </div>`
        )
        .join("")}</div>
      <div class="btnrow"><button class="btn sm" id="addkeydate">Add key date</button></div>
    </section>
    <div class="btnrow"><button class="btn pri" id="saveplan">Save month plan</button></div>`;

  wireMonth(store, state, monthNum);
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

function wireMonth(store, state, monthNum) {
  document.querySelectorAll(".cal .day.has").forEach((el) => {
    el.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("lifeos:goto-day", { detail: el.dataset.date }));
    });
  });

  const wireRemove = (listSel) => {
    document.querySelectorAll(`${listSel} .rm`).forEach((btn) => {
      btn.onclick = () => btn.closest(".t3row").remove();
    });
  };
  wireRemove("#intentlist");
  wireRemove("#keydateslist");

  $("#addintent")?.addEventListener("click", () => {
    const list = $("#intentlist");
    const div = document.createElement("div");
    div.className = "t3row";
    div.innerHTML = `<input type="text" class="intenttext" placeholder="New intention"><select class="intentpillar">${Object.entries(PILLARS)
      .map(([k, l]) => `<option value="${k}">${l}</option>`)
      .join("")}</select><button class="rm">×</button>`;
    list.appendChild(div);
    wireRemove("#intentlist");
  });
  $("#addkeydate")?.addEventListener("click", () => {
    const list = $("#keydateslist");
    const div = document.createElement("div");
    div.className = "t3row";
    div.innerHTML = `<input type="date" class="kddate" style="flex:none;width:150px"><input type="text" class="kdevent" placeholder="Event"><button class="rm">×</button>`;
    list.appendChild(div);
    wireRemove("#keydateslist");
  });

  $("#saveplan")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const intentions = [...document.querySelectorAll("#intentlist .t3row")]
      .map((row) => ({ intention: row.querySelector(".intenttext").value.trim(), pillar: row.querySelector(".intentpillar").value, status: "not_started", progress: 0 }))
      .filter((i) => i.intention);
    const keyDates = [...document.querySelectorAll("#keydateslist .t3row")]
      .map((row) => ({ date: row.querySelector(".kddate").value, event: row.querySelector(".kdevent").value.trim() }))
      .filter((k) => k.event);
    btn.disabled = true;
    const ok = await store.saveState(
      {
        currentMonth: {
          sprintTheme: $("#theme").value.trim(),
          oneThingToProtect: $("#protect").value.trim(),
          hphFocusHabit: $("#focushabit").value,
          intentions,
          keyDates,
        },
      },
      true,
      `life-os: month-plan ${state.currentMonth.year}-${String(monthNum).padStart(2, "0")}`
    );
    btn.disabled = false;
    if (ok) flash("Month plan saved.");
  });
}

// Rollover per .claude/commands/month-start.md, ported to code: reset the month
// block, and default the habit focus to last month's genuine lowest scorer
// (concrete rule: min of the six monthly per-habit averages) rather than leaving
// that judgment call unmade.
export async function startNewMonth(store, oldMonth, newYear, newMonthNum) {
  let focusHabit = HPH[0][1];
  if (oldMonth.month) {
    const prevMonthNum = newMonthNum === 1 ? 12 : newMonthNum - 1;
    const prevYear = newMonthNum === 1 ? newYear - 1 : newYear;
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
    if (lowestKey) focusHabit = HPH.find(([k]) => k === lowestKey)[1];
  }

  store.saveState(
    {
      currentMonth: {
        month: monthName(newYear, newMonthNum).split(" ")[0],
        year: newYear,
        sprintTheme: "",
        oneThingToProtect: "",
        hphFocusHabit: focusHabit,
        intentions: [],
        keyDates: [],
        weeklyHPHAvgs: [],
      },
    },
    true,
    `life-os: month-start ${newYear}-${String(newMonthNum).padStart(2, "0")}`
  );
}
