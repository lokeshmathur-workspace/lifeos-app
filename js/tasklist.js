// "Your task list" — every open task in the master list, grouped by category,
// collapsed by default. Shared by the Week page (+ Week, with a day) and the
// Month page (+ Intention). ✓ and × work the same everywhere and update in place.
import { PILLARS } from "./constants.js";
import { DAYKEYS, todayISO } from "./dateutil.js";
import { setTaskStatus, removeTask, shortDue } from "./tasks.js";
import { flash } from "./flash.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// open: a Set of what's expanded ("_all" = the section, else pillar keys), kept
// by the caller across redraws so adding a task doesn't fold everything back up.
export function taskListHtml(openList, open, { addLabel, addTitle, daySelect, emptyText }) {
  const today = todayISO();
  const order = (t) => (t.due ? `0${t.due}` : `1${t.created || ""}`);
  const groups = Object.entries(PILLARS)
    .map(([key, label]) => {
      const rows = openList.filter((t) => t.pillar === key).sort((a, b) => (order(a) < order(b) ? -1 : 1));
      if (!rows.length) return "";
      return `
      <details class="tlgroup" data-pillar="${key}" ${open.has(key) ? "open" : ""}>
        <summary class="tlhead"><span class="pdot" data-p="${key}"></span><span class="nm">${esc(label)}</span><span class="tlcount">${rows.length}</span></summary>
        ${rows
          .map(
            (t) => `
        <div class="tlrow" data-id="${esc(t.id)}" data-text="${esc(t.task.toLowerCase())}">
          <span class="tk">${esc(t.task)}${t.due ? ` <span class="tag ${t.due < today ? "late" : ""}">${t.due < today ? "overdue " : "due "}${esc(shortDue(t.due))}</span>` : ""}${t.source === "outlook" ? ` <span class="tag">Outlook</span>` : ""}</span>
          <span class="tlact">
            ${daySelect ? `<select class="tlday" aria-label="Day"><option value="">No day</option>${DAYKEYS.map((dk) => `<option value="${dk}">${dk}</option>`).join("")}</select>` : ""}
            <button class="tladd" title="${esc(addTitle)}">${esc(addLabel)}</button>
            <button class="tldone" title="Already done" aria-label="Mark done">✓</button>
            <button class="tldrop" title="Delete — no longer needed" aria-label="Delete">×</button>
          </span>
        </div>`
          )
          .join("")}
      </details>`;
    })
    .join("");
  return `
    <section class="blk" id="tasklist">
      <details class="tlsection" ${open.has("_all") ? "open" : ""}>
        <summary><h2>Your task list <span class="count" id="tltotal">${openList.length} open</span></h2></summary>
        ${
          openList.length
            ? `<input type="search" id="tlsearch" class="tlsearch" placeholder="Search your tasks…" autocomplete="off">
               <div class="tasklist">${groups}</div>
               <p class="caterr" id="tlerr" hidden></p>`
            : `<p class="empty">${esc(emptyText)}</p>`
        }
      </details>
    </section>`;
}

// onAdd(task, day) → Promise<boolean>. On success the caller redraws; the list is
// kept at the same spot on screen even if content above it grew.
export function wireTaskList({ store, open, mById, onAdd, renderApp }) {
  const tlErr = (msg) => {
    const el = $("#tlerr");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  };
  const dropRow = (row) => {
    const group = row.closest(".tlgroup");
    row.remove();
    const left = group.querySelectorAll(".tlrow").length;
    if (!left) group.remove();
    else group.querySelector(".tlcount").textContent = String(left);
    const tot = $("#tltotal");
    if (tot) tot.textContent = `${document.querySelectorAll("#tasklist .tlrow").length} open`;
  };

  $("#tlsearch")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll("#tasklist .tlgroup").forEach((g) => {
      let shown = 0;
      g.querySelectorAll(".tlrow").forEach((r) => {
        const hit = !q || r.dataset.text.includes(q);
        r.hidden = !hit;
        if (hit) shown++;
      });
      g.hidden = !shown;
      g.open = q ? shown > 0 : open.has(g.dataset.pillar);
    });
  });
  $("#tasklist .tlsection")?.addEventListener("toggle", (e) => {
    e.target.open ? open.add("_all") : open.delete("_all");
  });
  document.querySelectorAll("#tasklist .tlgroup").forEach((g) =>
    g.addEventListener("toggle", () => {
      if ($("#tlsearch")?.value.trim()) return;
      g.open ? open.add(g.dataset.pillar) : open.delete(g.dataset.pillar);
    })
  );

  document.querySelectorAll("#tasklist .tladd").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".tlrow");
      const t = mById.get(row.dataset.id);
      if (!t) return;
      btn.disabled = true;
      const ok = await onAdd(t, row.querySelector(".tlday")?.value || "").catch(() => false);
      if (!ok) {
        btn.disabled = false;
        return tlErr("Couldn't add it — try again.");
      }
      const before = $("#tasklist")?.getBoundingClientRect().top;
      await renderApp();
      const after = $("#tasklist")?.getBoundingClientRect().top;
      if (before != null && after != null) window.scrollBy(0, after - before);
    });
  });
  document.querySelectorAll("#tasklist .tldone").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".tlrow");
      btn.disabled = true;
      const ok = await setTaskStatus(store, [row.dataset.id], "done", "life-os: task done").catch(() => null);
      if (!ok) {
        btn.disabled = false;
        return tlErr("Couldn't mark it done — try again.");
      }
      dropRow(row);
      flash("Marked done.");
    });
  });
  document.querySelectorAll("#tasklist .tldrop").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.armed !== "1") {
        btn.dataset.armed = "1";
        btn.textContent = "Delete?";
        setTimeout(() => {
          if (btn.isConnected) {
            btn.dataset.armed = "";
            btn.textContent = "×";
          }
        }, 3000);
        return;
      }
      const row = btn.closest(".tlrow");
      btn.disabled = true;
      const ok = await removeTask(store, row.dataset.id).catch(() => null);
      if (!ok) {
        btn.disabled = false;
        return tlErr("Couldn't delete it — try again.");
      }
      dropRow(row);
      flash("Deleted from your list.");
    });
  });
}
