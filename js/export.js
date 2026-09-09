// Export/backup — REQUIREMENTS.md §4.4: a plain-text rendering for pasting into
// OneNote (his capture surface, never a data source — see life-os/CLAUDE.md's
// standing rules) plus a full downloadable JSON backup.
import { PILLARS, HPH } from "./constants.js";
import { prettyDate } from "./dateutil.js";
import { readQuote, readImproveTomorrow } from "./migrate.js";

export function dayText(dateISO, doc) {
  const m = doc.morning || {};
  const e = doc.evening || {};
  const q = readQuote(m);
  const lines = [];
  lines.push(prettyDate(dateISO));
  lines.push("");
  if (q) {
    lines.push(`"${q.text}"${q.author ? ` — ${q.author}` : ""}`);
    lines.push("");
  }
  if (m.successAnchor) lines.push(`Success anchor: ${m.successAnchor}`);
  if ((m.top3 || []).length) {
    lines.push("");
    lines.push("Top 3:");
    for (const t of m.top3) {
      lines.push(`  [${t.status === "done" ? "x" : " "}] ${t.task} (${PILLARS[t.pillar] || t.pillar})`);
    }
  }
  if (e.completedAt) {
    lines.push("");
    lines.push("Evening review:");
    if (e.synthesis) lines.push(e.synthesis);
    if (e.successAnchorMet) lines.push(`Anchor met: ${e.successAnchorMet}`);
    if (e.hph) {
      lines.push("");
      lines.push(`HPH: ${HPH.map(([k, l]) => `${l} ${e.hph[k] ?? "—"}`).join("  ")}  (avg ${e.hph.average ?? "—"})`);
    }
    const r = e.reflections;
    if (r) {
      lines.push("");
      if (r.gratitude) lines.push(`Gratitude: ${r.gratitude}`);
      if (r.taskHandledWell) lines.push(`Handled well: ${r.taskHandledWell}`);
      if (r.learned) lines.push(`Learned: ${r.learned}`);
      const improve = readImproveTomorrow(r);
      if (improve) lines.push(`Improve tomorrow: ${improve}`);
    }
    if ((e.carriedForward || []).length) {
      lines.push("");
      lines.push(`Carried forward: ${e.carriedForward.join("; ")}`);
    }
  }
  return lines.join("\n");
}

export async function copyDayForOneNote(dateISO, doc) {
  const text = dayText(dateISO, doc);
  await navigator.clipboard.writeText(text);
  return text;
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
