// Export/backup — REQUIREMENTS.md §4.4: plain-text rendering for pasting into
// OneNote (his capture surface, never a data source — see life-os/CLAUDE.md's
// standing rules), a full downloadable JSON backup, and bulk import support.
//
// One shared "section/block" model renders to BOTH plain text and HTML, so
// Today/Week/Month exports stay structurally consistent and OneNote (which
// accepts rich HTML on paste) gets real headings/bold/lists instead of a wall
// of plain text.
import { PILLARS, HPH } from "./constants.js";
import { prettyDate } from "./dateutil.js";
import { readQuote, readImproveTomorrow } from "./migrate.js";

const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── block model ───────────────────────────────────────────
   A "doc" is an array of sections: { heading?, blocks: Block[] }.
   Block = { type: "quote", text, author }
         | { type: "kv", label, value }
         | { type: "para", text }
         | { type: "tasks", items: [{ task, pillar, status }] }
         | { type: "list", items: string[] }
         | { type: "hph", hph, note? } */

function renderText(sections) {
  const lines = [];
  for (const s of sections) {
    if (lines.length) lines.push("");
    if (s.heading) {
      lines.push(s.heading.toUpperCase());
      lines.push("-".repeat(s.heading.length));
    }
    for (const b of s.blocks) lines.push(...blockText(b));
  }
  return lines.join("\n");
}

function blockText(b) {
  switch (b.type) {
    case "quote":
      return [`"${b.text}"${b.author ? ` — ${b.author}` : ""}`, ""];
    case "kv":
      return b.value ? [`${b.label}: ${b.value}`] : [];
    case "para":
      return b.text ? [b.text, ""] : [];
    case "tasks":
      return b.items.map((t) => `  [${t.status === "done" ? "x" : " "}] ${t.task}${t.pillar ? ` (${PILLARS[t.pillar] || t.pillar})` : ""}`);
    case "list":
      return b.items.map((i) => `  - ${i}`);
    case "hph": {
      const line = `HPH: ${HPH.map(([k, l]) => `${l} ${b.hph[k] ?? "—"}`).join("  ")}  (avg ${b.hph.average ?? "—"})`;
      return b.note ? [line, b.note] : [line];
    }
    default:
      return [];
  }
}

function renderHtml(sections) {
  const parts = [];
  for (const s of sections) {
    if (s.heading) parts.push(`<h3>${escHtml(s.heading)}</h3>`);
    for (const b of s.blocks) parts.push(blockHtml(b));
  }
  return parts.join("\n");
}

function blockHtml(b) {
  switch (b.type) {
    case "quote":
      return `<blockquote style="margin:0 0 10px;padding-left:10px;border-left:3px solid #ccc"><i>"${escHtml(b.text)}"</i>${b.author ? `<br>— ${escHtml(b.author)}` : ""}</blockquote>`;
    case "kv":
      return b.value ? `<p style="margin:2px 0"><b>${escHtml(b.label)}:</b> ${escHtml(b.value)}</p>` : "";
    case "para":
      return b.text ? `<p>${escHtml(b.text)}</p>` : "";
    case "tasks":
      return `<ul style="margin:4px 0">${b.items
        .map((t) => `<li>${t.status === "done" ? "☑" : "☐"} ${escHtml(t.task)}${t.pillar ? ` <i>(${escHtml(PILLARS[t.pillar] || t.pillar)})</i>` : ""}</li>`)
        .join("")}</ul>`;
    case "list":
      return `<ul style="margin:4px 0">${b.items.map((i) => `<li>${escHtml(i)}</li>`).join("")}</ul>`;
    case "hph": {
      const row = HPH.map(([k, l]) => `<b>${l}</b> ${b.hph[k] ?? "—"}`).join(" &nbsp; ");
      return `<p style="margin:2px 0">${row} &nbsp; (avg ${b.hph.average ?? "—"})</p>${b.note ? `<p style="margin:2px 0"><i>${escHtml(b.note)}</i></p>` : ""}`;
    }
    default:
      return "";
  }
}

// Writes both text/html and text/plain to the clipboard so OneNote (and any
// other rich-text target) gets real formatting on paste; falls back to plain
// text if the browser can't do rich clipboard writes.
export async function copyRichText(sections) {
  const text = renderText(sections);
  const html = `<div>${renderHtml(sections)}</div>`;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
  return text;
}

/* ── Today ─────────────────────────────────────────────────── */

function dayModel(dateISO, doc) {
  const m = doc.morning || {};
  const e = doc.evening || {};
  const q = readQuote(m);
  const sections = [{ blocks: [{ type: "para", text: prettyDate(dateISO) }] }];

  const morningBlocks = [];
  if (q) morningBlocks.push({ type: "quote", text: q.text, author: q.author });
  morningBlocks.push({ type: "kv", label: "Success anchor", value: m.successAnchor });
  if ((m.top3 || []).length) morningBlocks.push({ type: "tasks", items: m.top3 });
  if (morningBlocks.length) sections.push({ heading: "This morning", blocks: morningBlocks });

  if (e.completedAt) {
    const r = e.reflections || {};
    const eveningBlocks = [
      { type: "para", text: e.synthesis },
      { type: "kv", label: "Anchor met", value: e.successAnchorMet },
      ...(e.hph ? [{ type: "hph", hph: e.hph, note: e.hphNote }] : []),
      { type: "kv", label: "Gratitude", value: r.gratitude },
      { type: "kv", label: "Handled well", value: r.taskHandledWell },
      { type: "kv", label: "Learned", value: r.learned },
      { type: "kv", label: "Improve tomorrow", value: readImproveTomorrow(r) },
      ...((e.carriedForward || []).length ? [{ type: "list", items: e.carriedForward }] : []),
    ];
    sections.push({ heading: "Evening review", blocks: eveningBlocks });
  }
  return sections;
}

export function dayText(dateISO, doc) {
  return renderText(dayModel(dateISO, doc));
}

export async function copyDayForOneNote(dateISO, doc) {
  return copyRichText(dayModel(dateISO, doc));
}

/* ── shared model builder for Week/Month (data already computed by the view) ── */

export function buildSections(title, groups) {
  return [{ blocks: [{ type: "para", text: title }] }, ...groups];
}

function triggerDownload(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Full backup: every journal file + state/current.json, as one JSON file — the
// same shape lifeos-rebuild/reference/seed-data.json used, so a future restore
// (or sync_from_app.py-style import) has a stable format to target.
export async function downloadFullBackup(store) {
  const entries = await store.gh.listTree();
  const journalEntries = entries.filter(
    (e) => e.type === "blob" && e.path.startsWith("life-os/journal/") && e.path.endsWith(".json")
  );
  const journal = {};
  for (const entry of journalEntries) {
    const doc = await store.gh.getBlob(entry.sha);
    if (doc?.date) journal[doc.date] = doc;
  }
  const { json: state } = await store.gh.getFile("life-os/state/current.json");

  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: "2.1",
    owner: "Lokesh",
    source: "lifeos-app full backup",
    days: Object.keys(journal).length,
    state: state || {},
    journal,
  };
  triggerDownload(
    `lifeos-backup-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
    JSON.stringify(payload, null, 2)
  );
  return payload;
}
