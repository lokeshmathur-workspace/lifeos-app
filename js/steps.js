// The three steps the Week and Month pages share with Today:
// ① Plan  ② How it's going  ③ Review. The step bar, the optional
// "last one isn't reviewed yet" reminder, and the read-only "So far" pulse.
import { PILLARS, HPH } from "./constants.js";
import { evening, hphAvg, top3Of } from "./derive.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// steps: [{ key, label, note, done }]
export function stepperHtml(steps, current) {
  return `
    <nav class="stepper" aria-label="Steps">
      ${steps
        .map(
          (s, i) => `
        <button type="button" data-step="${s.key}" class="${s.key === current ? "on" : s.done ? "done" : ""}" aria-current="${s.key === current ? "step" : "false"}">
          ${s.key !== current && s.done ? "✓" : ["①", "②", "③"][i]} ${esc(s.label)}${s.note ? `<small>${esc(s.note)}</small>` : ""}
        </button>`
        )
        .join("")}
    </nav>`;
}

export function reviewNudgeHtml(text) {
  return `
    <div class="nudge">
      <span>${esc(text)}</span>
      <span class="nudgeact"><button type="button" class="linkbtn" id="nudgereview">Review it</button><button type="button" class="linkbtn muted" id="nudgeskip">Skip</button></span>
    </div>`;
}

// Read-only pulse for the days so far — the same facts the review pre-fills
// from, but nothing is saved.
export function soFarLines(datesSoFar, daysMap, tasks) {
  const docs = datesSoFar.map((d) => daysMap.get(d)).filter(Boolean);
  const avgs = docs.map(hphAvg).filter((v) => v != null);
  const avg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
  let low = null;
  for (const [k, label] of HPH) {
    const vals = docs.map((doc) => evening(doc).hph?.[k]).filter((v) => typeof v === "number");
    if (!vals.length) continue;
    const v = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (!low || v < low.v) low = { label, v };
  }
  const idle = Object.entries(PILLARS)
    .filter(([k]) => tasks.some((t) => t.pillar === k) && !tasks.some((t) => t.pillar === k && t.done))
    .map(([, l]) => l);
  return [
    `Journaled ${docs.length} of ${datesSoFar.length} day${datesSoFar.length === 1 ? "" : "s"}${avg != null ? ` · HPH ${avg.toFixed(1)}` : ""}`,
    low ? `Lowest habit so far: ${low.label} (${low.v.toFixed(1)})` : "",
    idle.length ? `Nothing finished yet in ${idle.join(", ")}` : tasks.length ? "Something finished in every category you planned" : "",
  ].filter(Boolean);
}

export function soFarHtml(lines) {
  return lines.length ? `<div class="sofar"><div class="lbl">So far</div><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>` : "";
}

// Tasks (with done flags) that showed up in the given days' plans.
export function dayPlanTasks(dates, daysMap) {
  const byId = new Map();
  for (const d of dates) {
    const doc = daysMap.get(d);
    if (!doc) continue;
    for (const t of top3Of(doc)) {
      const key = t.id || t.task;
      const cur = byId.get(key);
      byId.set(key, { pillar: t.pillar, done: (cur && cur.done) || t.status === "done" });
    }
  }
  return [...byId.values()];
}
