// Career plan ↔ Life OS: the pure logic shared by recompute.js, the Month/Week planners and
// the Career tab. Data shapes: career/docs/SCHEMA.md in the Claude repo. Keep in step with
// scripts/recompute.py there (sync_plan, sync_intentions, career_summary).

export const PLAN_PATH = "career/state/plan.json";
export const PROPOSALS_PATH = "career/state/proposals.json";
export const OPEN = new Set(["not_started", "in_progress"]);
export const isOpenAction = (a) => OPEN.has(a.status);

const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 86400000);

// Master task status → plan.json, for every action that is also a master task (same id).
// carried_forward counts as in_progress; a dropped action is left alone. Mutates plan;
// returns true if anything changed (meta updated then).
export function syncPlanStatuses(tasks, plan, today, stamp) {
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  let changed = false;
  for (const a of plan?.actions || []) {
    const t = byId.get(a.id);
    if (!t || a.status === "dropped") continue;
    const status = t.status === "carried_forward" ? "in_progress" : t.status;
    if (!OPEN.has(status) && status !== "done") continue;
    const completed = status === "done" ? t.completed || today : "";
    if (a.status !== status || (a.completed || "") !== completed) {
      a.status = status;
      a.completed = completed;
      changed = true;
    }
  }
  if (changed) {
    plan.meta = { ...(plan.meta || {}), lastUpdated: stamp, lastUpdatedBy: "life-os recompute" };
  }
  return changed;
}

// Intentions with an id take their status from the master task(s) linked to them
// (task id == intention id, or task intentionId == intention id). Mutates month; returns
// true if anything changed.
export function syncIntentionStatuses(tasks, month) {
  let changed = false;
  for (const it of month?.intentions || []) {
    if (!it.id) continue;
    const linked = (tasks || []).filter((t) => t.id === it.id || t.intentionId === it.id);
    if (!linked.length) continue;
    if (linked.some((t) => t.status === "done")) {
      if (it.status !== "done" || it.progress !== 100) {
        it.status = "done";
        it.progress = 100;
        changed = true;
      }
    } else if (linked.some((t) => t.status === "in_progress") && it.status === "not_started") {
      it.status = "in_progress";
      changed = true;
    }
  }
  return changed;
}

export function quarterOf(plan, iso) {
  return (plan?.quarters || []).find((q) => q.start <= iso && iso <= q.end) || null;
}

// computed.career
export function careerSummary(plan, proposals, today) {
  if (!plan) return {};
  const q = quarterOf(plan, today);
  const live = (plan.actions || []).filter((a) => a.status !== "dropped");
  const inQ = q ? live.filter((a) => q.start <= a.due && a.due <= q.end) : [];
  const gates = live.filter((a) => a.gate && isOpenAction(a)).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const nxt = gates[0];
  return {
    quarterId: q ? q.id : "",
    done: inQ.filter((a) => a.status === "done").length,
    total: inQ.length,
    overdue: live.filter((a) => isOpenAction(a) && a.due < today).length,
    nextGate: nxt ? { id: nxt.id, title: nxt.title, due: nxt.due, daysLeft: daysBetween(today, nxt.due) } : null,
    pendingProposals: (proposals?.proposals || []).filter((p) => p.status === "pending").length,
  };
}

// "From your career plan" for a planning period: open actions due on or before `until`
// (the period's last day; overdue ones included), not already master tasks, not dismissed.
export function careerSuggestions(plan, { until, taskIds, dismissed, pillar = null }) {
  return (plan?.actions || [])
    .filter((a) => isOpenAction(a) && a.due <= until && !taskIds.has(a.id) && !dismissed.has(a.id) && (!pillar || a.pillar === pillar))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

// planVersion "YYYY-MM-DD.N": today's next N, or today.1
export function bumpVersion(v, today) {
  const m = String(v || "").match(/^(\d{4}-\d{2}-\d{2})\.(\d+)$/);
  return m && m[1] === today ? `${today}.${+m[2] + 1}` : `${today}.1`;
}

const ACTION_FIELDS = ["title", "track", "pillar", "due", "gate", "status", "completed", "notes", "source"];

// Applies a proposal's ops to plan (mutates) in order, as career/docs/SCHEMA.md "Applying"
// says. An op whose target no longer exists is skipped. Returns
// { skipped: [reason], dropped: [actionId], touched: [actionId] }.
export function applyOps(plan, ops, today) {
  const skipped = [], dropped = [], touched = [];
  const actions = (plan.actions ||= []), habits = (plan.habits ||= []), inds = (plan.leadingIndicators ||= []);
  for (const op of ops || []) {
    if (op.op === "add_action") {
      if (!op.action?.id || actions.some((a) => a.id === op.action.id)) { skipped.push(`add_action ${op.action?.id || "?"}: that id is already in the plan`); continue; }
      actions.push({ status: "not_started", completed: "", gate: false, notes: "", source: "", ...op.action });
      touched.push(op.action.id);
    } else if (op.op === "update_action") {
      const a = actions.find((x) => x.id === op.id);
      if (!a) { skipped.push(`update_action ${op.id}: no such action`); continue; }
      for (const k of ACTION_FIELDS) if (op.set && k in op.set) a[k] = op.set[k];
      if (a.status === "done" && !a.completed) a.completed = today;
      if (a.status !== "done" && "status" in (op.set || {})) a.completed = op.set.completed || "";
      touched.push(a.id);
    } else if (op.op === "drop_action") {
      const a = actions.find((x) => x.id === op.id);
      if (!a) { skipped.push(`drop_action ${op.id}: no such action`); continue; }
      a.status = "dropped";
      if (op.reason) a.notes = [a.notes, `Dropped: ${op.reason}`].filter(Boolean).join(" ");
      dropped.push(a.id);
      touched.push(a.id);
    } else if (op.op === "add_habit") {
      if (!op.habit?.id || habits.some((h) => h.id === op.habit.id)) { skipped.push(`add_habit ${op.habit?.id || "?"}: that id is already in the plan`); continue; }
      habits.push({ active: true, ...op.habit });
    } else if (op.op === "update_habit") {
      const h = habits.find((x) => x.id === op.id);
      if (!h) { skipped.push(`update_habit ${op.id}: no such habit`); continue; }
      Object.assign(h, op.set || {});
    } else if (op.op === "update_indicator") {
      const li = inds.find((x) => x.id === op.id);
      if (!li) { skipped.push(`update_indicator ${op.id}: no such indicator`); continue; }
      for (const k of ["status", "by", "text"]) if (op.set && k in op.set) li[k] = op.set[k];
    } else {
      skipped.push(`unknown op ${op.op}`);
    }
  }
  return { skipped, dropped, touched };
}

const fmt = (iso) => (iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const FIELD_WORDS = { title: "wording", track: "track", pillar: "category", due: "due date", gate: "gate", status: "status", completed: "completed date", notes: "notes", source: "source" };

// What an op would change, in plain words (for the proposal card).
export function describeOp(op, plan) {
  const act = (id) => (plan?.actions || []).find((a) => a.id === id);
  const t = (id) => { const a = act(id); return a ? `“${a.title}”` : `${id} (no longer in the plan)`; };
  switch (op.op) {
    case "add_action": return `Add “${op.action?.title}”, due ${fmt(op.action?.due)}${op.action?.gate ? " (a gate)" : ""}.`;
    case "update_action": {
      const a = act(op.id), parts = [];
      for (const [k, v] of Object.entries(op.set || {})) {
        if (k === "due") parts.push(`move it from ${fmt(a?.due) || "—"} to ${fmt(v)}`);
        else if (k === "title") parts.push(`reword it to “${v}”`);
        else if (k === "gate") parts.push(v ? "make it a gate" : "make it a regular action");
        else if (k === "status") parts.push(`set it to ${String(v).replace("_", " ")}`);
        else parts.push(`change its ${FIELD_WORDS[k] || k}`);
      }
      return `${t(op.id)}: ${parts.join(", ") || "no change"}.`;
    }
    case "drop_action": return `Drop ${t(op.id)}${op.reason ? `: ${op.reason}` : ""}.`;
    case "add_habit": return `New ${op.habit?.cadence || ""} habit: “${op.habit?.title}”.`;
    case "update_habit": { const h = (plan?.habits || []).find((x) => x.id === op.id); return `Habit “${h?.title || op.id}”: ${"active" in (op.set || {}) ? (op.set.active ? "turn it on" : "pause it") : "update it"}.`; }
    case "update_indicator": { const li = (plan?.leadingIndicators || []).find((x) => x.id === op.id); return `Indicator “${li?.text || op.id}”: ${Object.entries(op.set || {}).map(([k, v]) => (k === "by" ? `by ${fmt(v)}` : k === "status" ? `mark ${String(v).replace("_", " ")}` : "reword it")).join(", ")}.`; }
    default: return `Unknown change (${op.op}).`;
  }
}
