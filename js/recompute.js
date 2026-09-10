// Keeps life-os/state/computed.json in sync with what scripts/recompute.py would
// produce, so validate.yml's staleness check (which runs on every push, and
// emails on failure) stays green even though nothing runs the Python script in
// this flow anymore. Call this after anything that adds/changes a journal file
// or otherwise changes what recompute.py reads — a new day's morning plan, an
// evening review, or a bulk import — since any of those can shift
// lastJournalDate, streaks, or the week/month stats. Best-effort and
// fire-and-forget: failures are silent because computed.json is derived data —
// a stale run just means it regenerates cleanly next time this fires.
import { computeAll } from "./derive.js";

export async function refreshComputed(store, latestISO) {
  try {
    const [y, m] = latestISO.split("-").map(Number);
    const monthDates = [];
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      monthDates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    const monthMap = await store.loadJournalMap(monthDates.filter((d) => d <= latestISO));
    const streakMap = await store.loadBackToGap(latestISO);
    const merged = new Map([...monthMap, ...streakMap]);

    // learningPending / careerSprint come from outside life-os/journal — read
    // them fresh rather than zeroing them, matching recompute.py's own inputs.
    const [{ json: queue }, { json: career }] = await Promise.all([
      store.gh.getFile("learning/queue.json"),
      store.gh.getFile("life-os/state/career-ascent.json"),
    ]);
    let learningPending = 0;
    for (const item of queue?.items || []) {
      learningPending += (item.actionItems || []).filter((a) => a.status === "pending").length;
    }
    const tasks = career?.activeSprint?.tasks || [];
    const done = tasks.filter((t) => t.status === "done").length;
    const careerSprint = tasks.length
      ? { completed: done, total: tasks.length, pct: Math.round((100 * done) / tasks.length) }
      : {};

    const computed = computeAll(merged, { learningPending, careerSprint });
    await store.saveComputed(computed);
  } catch {
    // best-effort — see comment above
  }
}
