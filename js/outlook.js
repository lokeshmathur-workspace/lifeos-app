// Outlook task sync — file based. Import reads the Outlook task export
// (.xlsx or .csv: Task Subject, Due Date, Categories, and Status if present),
// matches it against the master list, and asks about anything ambiguous before
// changing a thing. Export writes the list back out in the same columns.
//
// Outlook's export has no status column, so "completed in Outlook" is inferred:
// a linked open task that's missing from the new file is asked about, never
// closed automatically.
import { PILLARS } from "./constants.js";
import { todayISO } from "./dateutil.js";
import { taskKey, isOpen, newTask } from "./tasks.js";
import { flash } from "./flash.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ─── file reading ─────────────────────────────────────────── */

// Minimal .xlsx reader: unzip with the browser's own DecompressionStream,
// then read the first worksheet + shared strings. No third-party code touches
// the task data.
async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file isn't a valid .xlsx.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    files.set(name, { method, data: u8.subarray(start, start + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    async text(name) {
      const f = files.get(name);
      if (!f) return null;
      if (f.method === 0) return new TextDecoder().decode(f.data);
      const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    },
  };
}

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

async function readXlsx(buf) {
  const zip = await unzip(buf);
  const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
  const ssText = await zip.text("xl/sharedStrings.xml");
  const shared = ssText
    ? [...xml(ssText).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join(""))
    : [];
  const sheetText = await zip.text("xl/worksheets/sheet1.xml");
  if (!sheetText) throw new Error("Couldn't find a worksheet in that file.");
  const rows = [];
  for (const row of xml(sheetText).getElementsByTagName("row")) {
    const out = [];
    for (const c of row.getElementsByTagName("c")) {
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const inline = [...c.getElementsByTagName("t")].map((t) => t.textContent).join("");
      const type = c.getAttribute("t");
      out[colIndex(c.getAttribute("r") || "A")] = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? inline : v;
    }
    rows.push(Array.from(out, (x) => x ?? ""));
  }
  return rows;
}

function readCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// "Fri 1/9/2026", "1/9/2026", "2026-01-09" or an Excel serial -> "2026-01-09"; "None"/blank -> "".
function parseDue(v) {
  const s = String(v || "").trim();
  if (!s || /^none$/i.test(s)) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return "";
}

export async function parseOutlookFile(file) {
  const rows = /\.csv$/i.test(file.name) ? readCsv((await file.text()).replace(/^﻿/, "")) : await readXlsx(await file.arrayBuffer());
  const hi = rows.findIndex((r) => r.some((c) => /subject/i.test(c)));
  if (hi < 0) throw new Error("Couldn't find a “Task Subject” column in that file.");
  const head = rows[hi].map((h) => String(h).toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const cSubj = col(/subject/);
  const cDue = col(/due/);
  const cCat = col(/categor/);
  const cStatus = col(/status|complete/);
  const seen = new Set();
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const subject = String(r[cSubj] ?? "").trim();
    const key = taskKey(subject);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const st = cStatus >= 0 ? String(r[cStatus] ?? "").toLowerCase() : "";
    out.push({
      subject,
      key,
      due: cDue >= 0 ? parseDue(r[cDue]) : "",
      categories: cCat >= 0 ? String(r[cCat] ?? "").trim() : "",
      completed: /complete|done|^100/.test(st),
    });
  }
  return out;
}

/* ─── matching ─────────────────────────────────────────────── */

// Outlook's [Project] part of the category -> pillar; "" when it doesn't say.
export function pillarFromCategories(cats) {
  const c = String(cats || "").toLowerCase();
  if (/financ|bills?\b|invest|tax|insurance|real estate|trust\b|claim|lien/.test(c)) return "finances";
  if (/career|network|linkedin|sponsor|role guide/.test(c)) return "careerWork";
  if (/business|retail/.test(c)) return "business";
  if (/learning|study|\bai\b|certific|power automate|tech stack/.test(c)) return "mindGrowth";
  if (/family|relationship|friends/.test(c)) return "relationships";
  if (/health|fitness|vitality|gym|meditat/.test(c)) return "vitality";
  if (/home|personal|garden|gazebo|paint/.test(c)) return "personal";
  return "";
}

// Newsletters and announcements that got flagged in Outlook, not real to-dos.
export function looksLikeEmail(subject) {
  return /(\.\.\.|…)\s*$|^\[external\]|^you'?re invited|weekly digest|^announcing\b|^just live\b/i.test(subject) || /^\p{Extended_Pictographic}/u.test(subject);
}

const STOP = new Set(["the", "and", "for", "with", "from", "into", "your", "that", "this", "all", "get", "use", "via", "new", "review", "update"]);
const tokens = (text) => taskKey(text).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

// Share of the shorter task's meaningful words that also appear in the other.
export function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  const hit = short.filter((w) => long.some((x) => sameWord(w, x))).length;
  return hit >= 2 ? hit / short.length : 0;
}
const DUP = 0.6;

export function analyze(doc, rows) {
  const tasks = doc.tasks;
  const ignored = new Set(doc.outlook?.ignored || []);
  const keptApart = new Set(doc.outlook?.keptApart || []);
  const byKey = new Map();
  for (const t of tasks) if (t.outlookKey) byKey.set(t.outlookKey, t);
  const rowKeys = new Set(rows.map((r) => r.key));

  const res = { inSync: [], updates: [], newRows: [], dupes: [], missing: [], doneHere: [], doneThere: [], internal: [] };
  const claimed = new Set();
  for (const r of rows) {
    if (ignored.has(r.key)) continue;
    const linked = byKey.get(r.key) || tasks.find((t) => !t.outlookKey && taskKey(t.task) === r.key);
    if (linked) {
      claimed.add(linked.id);
      if (!linked.outlookKey || linked.due !== (r.due || linked.due) || (linked.outlookCategories || "") !== r.categories) res.updates.push({ row: r, task: linked });
      else res.inSync.push(r);
      if (r.completed && isOpen(linked)) res.doneThere.push({ row: r, task: linked });
      else if (!r.completed && !isOpen(linked)) res.doneHere.push({ row: r, task: linked });
      continue;
    }
    if (r.completed) continue; // already finished in Outlook and never in Life OS — nothing to bring in
    let best = null;
    for (const t of tasks) {
      if (t.outlookKey || claimed.has(t.id) || !isOpen(t)) continue;
      const s = similarity(r.subject, t.task);
      if (s >= DUP && (!best || s > best.s)) best = { t, s };
    }
    if (best) {
      claimed.add(best.t.id);
      res.dupes.push({ row: r, task: best.t });
    } else {
      // Outlook's category first; failing that, a guess from the wording.
      res.newRows.push({ row: r, pillar: pillarFromCategories(r.categories) || pillarFromCategories(r.subject), include: !looksLikeEmail(r.subject), email: looksLikeEmail(r.subject) });
    }
  }
  for (const t of tasks) {
    if (t.outlookKey && isOpen(t) && !rowKeys.has(t.outlookKey)) res.missing.push({ task: t });
  }
  // Near-duplicates already sitting in the list (e.g. carried forward twice).
  const open = tasks.filter(isOpen);
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i];
      const b = open[j];
      if (keptApart.has([a.id, b.id].sort().join("|"))) continue;
      if (taskKey(a.task) === taskKey(b.task) || similarity(a.task, b.task) >= 0.75) res.internal.push({ a, b });
    }
  }
  return res;
}

/* ─── export ───────────────────────────────────────────────── */

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function outlookDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

export function exportCsv(doc) {
  const since = doc.outlook?.lastImport || "";
  const rows = doc.tasks.filter((t) => isOpen(t) || (t.completed && t.completed >= since));
  const lines = [["Task Subject", "Due Date", "Categories", "Status"]];
  for (const t of rows) {
    lines.push([t.task, outlookDate(t.due), t.outlookCategories || `[${PILLARS[t.pillar] || t.pillar}]`, isOpen(t) ? (t.status === "in_progress" ? "In Progress" : "Not Started") : "Completed"]);
  }
  return "﻿" + lines.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/* ─── UI ───────────────────────────────────────────────────── */

const pillarSelect = (id, sel) =>
  `<select data-pillar-for="${id}"><option value="">Pick a category…</option>${Object.entries(PILLARS)
    .map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`)
    .join("")}</select>`;

const choiceRow = (id, opts, cur) =>
  `<div class="btnrow" style="margin-top:6px;gap:6px;flex-wrap:wrap">${opts
    .map(([v, l]) => `<button type="button" class="btn sm" data-choice="${id}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`)
    .join("")}</div>`;

export async function openOutlookSync(store) {
  const back = document.createElement("div");
  back.className = "modalback";
  back.innerHTML = `<div class="modal" style="max-width:760px" id="olmodal"></div>`;
  document.body.appendChild(back);
  const modal = $("#olmodal", back);
  const close = () => back.remove();
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });

  let res = null;
  let rows = [];
  const choice = {};

  function renderStart(err) {
    modal.innerHTML = `
      <h2 style="margin-top:0">Outlook tasks</h2>
      <p class="savenote" style="margin-bottom:12px">Import your Outlook task export (.xlsx or .csv). Nothing changes until you review and tap Apply.</p>
      <label class="btn pri" style="display:block;text-align:center">Choose Outlook export<input type="file" id="olfile" accept=".xlsx,.csv" hidden></label>
      ${err ? `<p class="savenote warn" style="margin-top:10px">${esc(err)}</p>` : ""}
      <div class="btnrow" style="margin-top:16px">
        <button class="btn" id="olexport">Export for Outlook (.csv)</button>
        <button class="btn" id="olclose">Close</button>
      </div>
      <p class="savenote" style="margin-top:8px" id="ollast"></p>`;
    store.getTasks().then((d) => {
      const last = d.outlook?.lastImport;
      $("#ollast", modal).textContent = last ? `Last imported ${last}.` : "Not imported yet.";
    });
    $("#olclose", modal).onclick = close;
    $("#olexport", modal).onclick = async () => {
      const d = await store.getTasks();
      const blob = new Blob([exportCsv(d)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `LifeOS_Tasks_${todayISO()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      flash("Exported — import it in Outlook, or use it to update tasks there.");
    };
    $("#olfile", modal).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        rows = await parseOutlookFile(file);
        res = analyze(await store.getTasks(true), rows);
        renderReview();
      } catch (err2) {
        renderStart(err2.message || "Couldn't read that file.");
      }
    };
  }

  function renderReview() {
    const n = res.newRows.filter((x) => x.include).length;
    const section = (title, sub, body) => `<section class="blk" style="margin-top:14px"><h2>${title}</h2>${sub ? `<p class="savenote" style="margin:0 0 8px">${sub}</p>` : ""}${body}</section>`;
    modal.innerHTML = `
      <h2 style="margin-top:0">Review Outlook import</h2>
      <div class="btnrow" style="gap:6px;flex-wrap:wrap;margin-top:0">
        <span class="pill">${rows.length} in file</span>
        <span class="pill ok">${res.inSync.length + res.updates.length} matched</span>
        <span class="pill">${res.newRows.length} new</span>
        <span class="pill">${res.dupes.length + res.internal.length} possible duplicates</span>
        <span class="pill">${res.missing.length + res.doneHere.length + res.doneThere.length} status questions</span>
      </div>
      ${
        res.newRows.length
          ? section(
              "New tasks",
              "Ticked ones are added to your list. Unticked ones are skipped and won't be offered again. Flagged emails are unticked by default.",
              res.newRows
                .map(
                  (x, i) => `
          <div class="catrow" style="cursor:default;align-items:center;flex-wrap:wrap">
            <input type="checkbox" data-new="${i}" ${x.include ? "checked" : ""}>
            <span class="tk">${esc(x.row.subject)}${x.email ? ` <span class="pill">looks like an email</span>` : ""}${x.row.due ? ` <span class="due">due ${esc(x.row.due)}</span>` : ""}</span>
            ${pillarSelect(i, x.pillar)}
          </div>`
                )
                .join("")
            )
          : ""
      }
      ${
        res.dupes.length
          ? section(
              "Possible duplicates",
              "An Outlook task that looks like one already in Life OS.",
              res.dupes
                .map(
                  (x, i) => `
          <div class="card" style="margin-bottom:8px">
            <div class="small"><b>Life OS:</b> ${esc(x.task.task)}</div>
            <div class="small"><b>Outlook:</b> ${esc(x.row.subject)}${x.row.due ? ` · due ${esc(x.row.due)}` : ""}</div>
            ${choiceRow(`d${i}`, [["merge", "Same task — link them"], ["lifeos", "Keep Life OS only"], ["outlook", "Use Outlook's wording"], ["both", "Different — keep both"]], choice[`d${i}`])}
          </div>`
                )
                .join("")
            )
          : ""
      }
      ${
        res.internal.length
          ? section(
              "Duplicates already in your list",
              "",
              res.internal
                .map(
                  (x, i) => `
          <div class="card" style="margin-bottom:8px">
            <div class="small">A: ${esc(x.a.task)}</div>
            <div class="small">B: ${esc(x.b.task)}</div>
            ${choiceRow(`i${i}`, [["a", "Keep A, delete B"], ["b", "Keep B, delete A"], ["both", "Keep both"]], choice[`i${i}`])}
          </div>`
                )
                .join("")
            )
          : ""
      }
      ${
        res.missing.length
          ? section(
              "Not in Outlook anymore",
              "These came from Outlook and are still open here, but they're gone from this export — usually that means you finished them.",
              res.missing
                .map(
                  (x, i) => `
          <div class="card" style="margin-bottom:8px"><div class="small"><b>${esc(x.task.task)}</b></div>
            ${choiceRow(`m${i}`, [["done", "It's done"], ["open", "Still open — keep it"], ["remove", "Delete it"]], choice[`m${i}`])}</div>`
                )
                .join("")
            )
          : ""
      }
      ${
        res.doneThere.length
          ? section(
              "Done in Outlook, open here",
              "",
              res.doneThere
                .map(
                  (x, i) => `
          <div class="card" style="margin-bottom:8px"><div class="small"><b>${esc(x.task.task)}</b></div>
            ${choiceRow(`o${i}`, [["done", "It's done"], ["open", "Still open"]], choice[`o${i}`])}</div>`
                )
                .join("")
            )
          : ""
      }
      ${
        res.doneHere.length
          ? section(
              "Done here, still open in Outlook",
              "Keep it done here and close it in Outlook (the export marks it Completed), or reopen it.",
              res.doneHere
                .map(
                  (x, i) => `
          <div class="card" style="margin-bottom:8px"><div class="small"><b>${esc(x.task.task)}</b></div>
            ${choiceRow(`h${i}`, [["done", "It's done"], ["open", "Reopen it"]], choice[`h${i}`])}</div>`
                )
                .join("")
            )
          : ""
      }
      <p class="savenote warn" id="olerr" style="margin-top:12px"></p>
      <div class="btnrow">
        <button class="btn pri" id="olapply">Apply — add ${n} task${n === 1 ? "" : "s"}</button>
        <button class="btn" id="olback">Back</button>
      </div>
      <p class="savenote" style="margin-top:6px">Questions you leave unanswered are asked again next import.</p>`;

    modal.querySelectorAll("[data-new]").forEach((cb) => {
      cb.onchange = () => {
        res.newRows[Number(cb.dataset.new)].include = cb.checked;
        const k = res.newRows.filter((x) => x.include).length;
        $("#olapply", modal).textContent = `Apply — add ${k} task${k === 1 ? "" : "s"}`;
      };
    });
    modal.querySelectorAll("[data-pillar-for]").forEach((sel) => {
      sel.onchange = () => (res.newRows[Number(sel.dataset.pillarFor)].pillar = sel.value);
    });
    modal.querySelectorAll("[data-choice]").forEach((b) => {
      b.onclick = () => {
        choice[b.dataset.choice] = b.dataset.v;
        modal.querySelectorAll(`[data-choice="${b.dataset.choice}"]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      };
    });
    $("#olback", modal).onclick = () => renderStart();
    $("#olapply", modal).onclick = apply;
  }

  async function apply() {
    const missingPillar = res.newRows.find((x) => x.include && !x.pillar);
    if (missingPillar) {
      $("#olerr", modal).textContent = `Pick a category for “${missingPillar.row.subject}” (or untick it).`;
      return;
    }
    $("#olapply", modal).disabled = true;
    const today = todayISO();
    let added = 0;
    const saved = await store.updateTasks((d) => {
      d.outlook = d.outlook || { lastImport: "", ignored: [] };
      const ignored = new Set(d.outlook.ignored || []);
      const keptApart = new Set(d.outlook.keptApart || []);
      const byId = new Map(d.tasks.map((t) => [t.id, t]));
      const link = (t, row) => {
        t.outlookKey = row.key;
        t.outlookCategories = row.categories;
        if (row.due) t.due = row.due;
      };
      const setStatus = (t, status) => {
        t.status = status;
        t.completed = status === "done" ? t.completed || today : "";
      };
      const created = [];
      const create = (row, pillar) => {
        const t = newTask([d.tasks, created], { task: row.subject, pillar, due: row.due, source: "outlook", outlookKey: row.key, outlookCategories: row.categories });
        created.push(t);
        added++;
      };
      const removed = new Set();

      for (const x of res.updates) {
        const t = byId.get(x.task.id);
        if (t) link(t, x.row);
      }
      for (const x of res.newRows) {
        if (x.include) create(x.row, x.pillar);
        else ignored.add(x.row.key);
      }
      res.dupes.forEach((x, i) => {
        const c = choice[`d${i}`];
        const t = byId.get(x.task.id);
        if (!c || !t) return;
        if (c === "merge") link(t, x.row);
        else if (c === "lifeos") ignored.add(x.row.key);
        else if (c === "outlook") {
          t.task = x.row.subject;
          link(t, x.row);
        } else if (c === "both") create(x.row, t.pillar);
      });
      const keeperOf = new Map();
      res.internal.forEach((x, i) => {
        const c = choice[`i${i}`];
        if (c === "a") keeperOf.set(x.b.id, x.a.id);
        else if (c === "b") keeperOf.set(x.a.id, x.b.id);
        else if (c === "both") keptApart.add([x.a.id, x.b.id].sort().join("|"));
      });
      // A deleted duplicate hands its Outlook link to the one kept, so linking
      // A to Outlook and then keeping B doesn't lose the link.
      for (const [gone, kept] of keeperOf) {
        removed.add(gone);
        const g = byId.get(gone);
        const k = byId.get(kept);
        if (g?.outlookKey && k && !k.outlookKey) {
          k.outlookKey = g.outlookKey;
          k.outlookCategories = g.outlookCategories;
          if (!k.due) k.due = g.due;
        }
      }
      res.missing.forEach((x, i) => {
        const c = choice[`m${i}`];
        const t = byId.get(x.task.id);
        if (!c || !t) return;
        if (c === "done") setStatus(t, "done");
        else if (c === "open") {
          delete t.outlookKey;
          delete t.outlookCategories;
        } else if (c === "remove") removed.add(t.id);
      });
      res.doneThere.forEach((x, i) => {
        const t = byId.get(x.task.id);
        if (t && choice[`o${i}`] === "done") setStatus(t, "done");
      });
      res.doneHere.forEach((x, i) => {
        const t = byId.get(x.task.id);
        if (t && choice[`h${i}`] === "open") setStatus(t, "not_started");
      });

      d.tasks = [...d.tasks.filter((t) => !removed.has(t.id)), ...created];
      d.outlook.ignored = [...ignored];
      if (keptApart.size) d.outlook.keptApart = [...keptApart];
      d.outlook.lastImport = today;
      return d;
    }, `life-os: Outlook import ${today}`);
    if (!saved) {
      $("#olapply", modal).disabled = false;
      return;
    }
    close();
    flash(`Outlook import applied — ${added} task${added === 1 ? "" : "s"} added.`);
    window.dispatchEvent(new CustomEvent("lifeos:tasks-changed"));
  }

  renderStart();
}
