// Operations on the master task list (life-os/state/tasks.json). Every change
// goes through store.updateTasks so a concurrent edit from another device is
// re-applied on a fresh copy instead of overwritten.
//
// Task shape: { id, task, pillar, status, due, created, completed, source,
//               outlookKey?, outlookCategories? }
//   status  — "not_started" | "in_progress" | "done"
//   source  — "manual" | "outlook" | "migrated"
import { nextTaskId } from "./compact.js";
import { todayISO } from "./dateutil.js";

export const isOpen = (t) => t.status !== "done";

// "2026-09-30" → "9/30"
export function shortDue(iso) {
  const [, mo, d] = iso.split("-").map(Number);
  return `${mo}/${d}`;
}

// Lowercase, punctuation and emoji stripped, whitespace collapsed — the key an
// Outlook subject and a Life OS task are matched on.
export function taskKey(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function newTask(existingDocs, fields) {
  const today = todayISO();
  const id = nextTaskId(today, existingDocs);
  return {
    id,
    task: fields.task.trim(),
    pillar: fields.pillar,
    status: "not_started",
    due: fields.due || "",
    created: today,
    completed: "",
    source: fields.source || "manual",
    ...(fields.outlookKey ? { outlookKey: fields.outlookKey, outlookCategories: fields.outlookCategories || "" } : {}),
  };
}

// Adds new tasks; `items` are { task, pillar, due?, source?, ... }. Returns the
// created tasks (with ids) or null on a failed save.
export async function addTasks(store, items, message) {
  let created = [];
  const doc = await store.updateTasks((d) => {
    created = [];
    for (const it of items) {
      const t = newTask([d.tasks, created], it);
      created.push(t);
    }
    d.tasks = [...d.tasks, ...created];
    return d;
  }, message || `life-os: add ${items.length} task(s)`);
  return doc ? created : null;
}

// Sets status on each id in `ids` (ignores ids not in the list).
export async function setTaskStatus(store, ids, status, message) {
  const set = new Set(ids);
  if (!set.size) return store.getTasks();
  return store.updateTasks((d) => {
    d.tasks = d.tasks.map((t) =>
      set.has(t.id) ? { ...t, status, completed: status === "done" ? t.completed || todayISO() : "" } : t
    );
    return d;
  }, message || "life-os: task status");
}

export async function removeTask(store, id) {
  return store.updateTasks((d) => {
    d.tasks = d.tasks.filter((t) => t.id !== id);
    return d;
  }, "life-os: remove task");
}
