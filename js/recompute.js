// Keeps derived state in sync after the app saves something, the way
// scripts/recompute.py does in a Claude session (keep the two in step):
//   1. career/state/plan.json: every career action that is also a master task gets that
//      task's status and completed date (cross-project write named in career/docs/SCHEMA.md).
//   2. month files (previous, current, next): intentions linked to a task by id take
//      their status from it.
//   3. life-os/state/computed.json, including computed.career.
// Called (debounced) after journal writes and master-task changes. Best-effort and
// fire-and-forget: failures are silent because this is derived data — a missed run just
// means the next one catches up (and the GitHub Action / Claude sessions run the Python).
import { computeAll } from "./derive.js";
import { todayISO, localStamp, addMonths, monthKeyOf } from "./dateutil.js";
import { PLAN_PATH, PROPOSALS_PATH, syncPlanStatuses, syncIntentionStatuses, careerSummary } from "./career/sync.js";

export async function refreshComputed(store, latestISO) {
  try {
    const today = todayISO();
    const tasks = (await store.getTasks())?.tasks || [];

    // 1 · career plan statuses
    let plan = null;
    try {
      const res = await store.gh.updateJson(PLAN_PATH, (p) => (p && syncPlanStatuses(tasks, p, today, localStamp()) ? p : null), "life-os: sync career statuses", { blank: () => null });
      plan = res?.doc || null;
      if (res?.doc) window.dispatchEvent(new CustomEvent("lifeos:career-plan", { detail: res }));
    } catch {
      /* no career folder or no access — skip */
    }

    // 2 · linked intentions
    const curKey = monthKeyOf(today);
    for (const k of [addMonths(curKey, -1), curKey, addMonths(curKey, 1)]) {
      await store.updateMonth(k, (m) => (m && (m.intentions || []).length && syncIntentionStatuses(tasks, m) ? m : null), `life-os: sync intentions ${k}`);
    }

    // 3 · computed.json
    if (!latestISO) {
      const { json } = await store.gh.getFile("life-os/state/computed.json");
      latestISO = json?.lastJournalDate || today;
    }
    const [y, m] = latestISO.split("-").map(Number);
    const monthDates = [];
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      monthDates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    const monthMap = await store.loadJournalMap(monthDates.filter((d) => d <= latestISO));
    const streakMap = await store.loadBackToGap(latestISO);
    const merged = new Map([...monthMap, ...streakMap]);

    const [{ json: queue }, { json: proposals }] = await Promise.all([
      store.gh.getFile("learning/queue.json"),
      store.gh.getFile(PROPOSALS_PATH).catch(() => ({ json: null })),
    ]);
    let learningPending = 0;
    for (const item of queue?.items || []) {
      learningPending += (item.actionItems || []).filter((a) => a.status === "pending").length;
    }

    const computed = computeAll(merged, { learningPending, career: careerSummary(plan, proposals, today) });
    await store.saveComputed(computed);
  } catch {
    // best-effort — see comment above
  }
}
