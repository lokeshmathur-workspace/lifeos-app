// Bulk import — for a batch of tasks (e.g. drafted elsewhere) or journal text
// copied out of OneNote, pasted in one go rather than typed line by line.
import { PILLARS } from "./constants.js";
import { DAYKEYS, todayISO, nowHM, dayOfWeekName, mondayOf } from "./dateutil.js";
import { flash } from "./flash.js";
import { addTasks } from "./tasks.js";
import { openOutlookSync } from "./outlook.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A line like "14:20 Called the bank about the transfer" -> { t: "14:20", text: "..." }.
// A line with no time prefix gets the current time — good enough for a paste
// where you don't have per-line timestamps; still one note per line.
const TIME_PREFIX = /^(\d{1,2}:\d{2})\s+(.*)$/;

export function parseTaskLines(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // tolerate "- task", "* task", "1. task" list markers from a pasted list
    .map((l) => l.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""));
}

function parseJournalLines(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(TIME_PREFIX);
      return m ? { t: m[1], text: m[2] } : { t: nowHM(), text: l };
    });
}

export function openBulkImport(store) {
  const back = document.createElement("div");
  back.className = "modalback";
  back.innerHTML = `
    <div class="modal">
      <h2 style="margin-top:0">Bulk import</h2>
      <div class="seg" style="display:inline-flex;margin-bottom:16px">
        <button data-mode="tasks" aria-current="true">Tasks</button>
        <button data-mode="journal">Journal entries</button>
        <button data-mode="outlook">Outlook tasks</button>
      </div>

      <div id="mode-tasks">
        <p class="savenote" style="margin-bottom:10px">One task per line. List markers ("-", "*", "1.") are stripped automatically. Added to your task list (and to this week's board if you pick a day).</p>
        <textarea id="bulktext-tasks" rows="10" placeholder="Call the bank about the transfer&#10;Book Navya's dentist appointment&#10;Draft Q3 slide outline"></textarea>
        <div class="t3row" style="margin-top:10px">
          <select id="bulkpillar">${Object.entries(PILLARS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
          <select id="bulkday"><option value="">Unassigned</option>${DAYKEYS.map((dk) => `<option value="${dk}">${dk}</option>`).join("")}</select>
        </div>
      </div>

      <div id="mode-journal" hidden>
        <label class="fld"><span>Date</span><input type="date" id="bulkdate" value="${todayISO()}"></label>
        <p class="savenote" style="margin:0 0 10px">One entry per line, pasted straight from OneNote. A leading time like "14:20 " is kept as that entry's timestamp; lines without one get the current time. Added to that day's journal — nothing existing is overwritten.</p>
        <textarea id="bulktext-journal" rows="10" placeholder="09:10 Katie call — alignment still open&#10;Some threads need a second pass this afternoon"></textarea>
      </div>

      <div class="btnrow">
        <button class="btn pri" id="bulkimport">Import</button>
        <button class="btn" id="bulkcancel">Cancel</button>
      </div>
      <p class="savenote" id="bulknote" style="margin-top:10px"></p>
    </div>`;
  document.body.appendChild(back);

  let mode = "tasks";
  back.querySelectorAll(".seg button").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.mode === "outlook") {
        back.remove();
        openOutlookSync(store);
        return;
      }
      mode = b.dataset.mode;
      back.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-current", String(x === b)));
      $("#mode-tasks", back).hidden = mode !== "tasks";
      $("#mode-journal", back).hidden = mode !== "journal";
    });
  });

  back.addEventListener("click", (e) => {
    if (e.target === back) back.remove();
  });
  document.addEventListener("keydown", function esc1(e) {
    if (e.key === "Escape") {
      back.remove();
      document.removeEventListener("keydown", esc1);
    }
  });
  $("#bulkcancel", back).addEventListener("click", () => back.remove());

  $("#bulkimport", back).addEventListener("click", async () => {
    const note = $("#bulknote", back);
    const btn = $("#bulkimport", back);
    btn.disabled = true;
    try {
      if (mode === "tasks") {
        const lines = parseTaskLines($("#bulktext-tasks", back).value);
        if (!lines.length) {
          note.textContent = "Nothing to import — paste at least one task.";
          return;
        }
        const pillar = $("#bulkpillar", back).value;
        const day = $("#bulkday", back).value;
        const created = await addTasks(store, lines.map((task) => ({ task, pillar })), `life-os: bulk import ${lines.length} task(s)`);
        let ok = !!created;
        if (ok && day) {
          const weekOf = mondayOf(todayISO());
          const weekDoc = await store.getWeek(weekOf);
          const entries = created.map((t) => ({ id: t.id, task: t.task, pillar: t.pillar, assignedDay: day, status: "not_started", source: "manual" }));
          ok = await store.saveWeek(weekOf, { tasks: [...(weekDoc.tasks || []), ...entries] }, true, `life-os: bulk import ${entries.length} task(s)`);
        }
        if (ok) {
          flash(`Imported ${created.length} task${created.length === 1 ? "" : "s"}.`);
          back.remove();
        } else {
          note.textContent = "Couldn't save — see the error banner behind this dialog.";
        }
      } else {
        const dateISO = $("#bulkdate", back).value;
        if (!dateISO) {
          note.textContent = "Pick a date first.";
          return;
        }
        const entries = parseJournalLines($("#bulktext-journal", back).value);
        if (!entries.length) {
          note.textContent = "Nothing to import — paste at least one line.";
          return;
        }
        const doc = await store.getDay(dateISO);
        const notes = [...(doc.notes || []), ...entries.map((e) => ({ ...e, kind: "note" }))];
        const ok = await store.saveDay(
          dateISO,
          { date: dateISO, dayOfWeek: doc.dayOfWeek || dayOfWeekName(dateISO), notes },
          true,
          `life-os: bulk import ${entries.length} note(s) ${dateISO}`
        );
        if (ok) {
          flash(`Imported ${entries.length} note${entries.length === 1 ? "" : "s"} into ${dateISO}.`);
          back.remove();
        } else {
          note.textContent = "Couldn't save — see the error banner behind this dialog.";
        }
      }
    } finally {
      btn.disabled = false;
    }
  });
}
