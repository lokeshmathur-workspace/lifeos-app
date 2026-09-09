// JS port of scripts/recompute.py — same definitions, same field names, so
// life-os/state/computed.json stays byte-compatible with what the Python script
// would produce, and validate.yml's staleness check
// (`git diff -I '"generatedAt"' computed.json`) stays green. Fields recompute.py
// computes with round(x, n) are Python floats and print as e.g. "50.0"; those are
// wrapped in PyFloat below so compact.js reproduces that instead of JS's "50".
//
// Operates over a Map<dateISO, dayDoc> the caller has already fetched (see
// github.js) rather than a filesystem glob — the app only loads the date range a
// given view actually needs (see loadRange in app.js).

import { PyFloat } from "./compact.js";

export const PILLARS = [
  "finances",
  "careerWork",
  "business",
  "vitality",
  "relationships",
  "mindGrowth",
];

const HPH_KEYS = ["clarity", "energy", "necessity", "productivity", "influence", "courage"];

export function evening(doc) {
  return (doc && doc.evening) || {};
}

export function morning(doc) {
  return (doc && doc.morning) || {};
}

// evening.top3Results, falling back to morning.top3 for days with no evening yet —
// matches reference-app.html's top3Of().
export function top3Of(doc) {
  const e = evening(doc);
  if (Array.isArray(e.top3Results) && e.top3Results.length) return e.top3Results;
  return morning(doc).top3 || [];
}

export function hphAvg(doc) {
  const hph = evening(doc).hph;
  if (!hph) return null;
  const vals = HPH_KEYS.map((k) => hph[k]).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function coreCount(doc, which) {
  const steps = evening(doc)[which];
  if (!steps) return null;
  return Object.entries(steps).filter(
    ([k, v]) => k !== "totalCompleted" && k !== "sleepTargetHrs" && v === true
  ).length;
}

function avg(xs) {
  const vals = xs.filter((x) => typeof x === "number");
  if (!vals.length) return 0;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

function addDaysISO(dateISO, n) {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ISO week (year, week) for a date, matching Python's date.isocalendar()[:2].
function isoWeek(dateISO) {
  const d = new Date(dateISO + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
    );
  return [d.getUTCFullYear(), week];
}

// Consecutive days ending at `latest` (walking backward) while pred(doc) holds.
// A missing day or a false predicate stops the streak — no gap-papering, matching
// recompute.py's streak().
export function streak(daysMap, latestISO, pred) {
  let n = 0;
  let d = latestISO;
  while (daysMap.has(d) && pred(daysMap.get(d))) {
    n++;
    d = addDaysISO(d, -1);
  }
  return n;
}

function top3Rate(docs) {
  let done = 0,
    total = 0;
  for (const doc of docs) {
    for (const t of evening(doc).top3Results || []) {
      total++;
      if (t.status === "done") done++;
    }
  }
  return total ? Math.round((100 * done) / total * 10) / 10 : 0;
}

function coreAvg(docs, key) {
  return avg(docs.map((d) => evening(d)[key] && evening(d)[key].totalCompleted));
}

// Full computed.json shape, given every loaded day doc keyed by date, plus the
// two counts that come from outside life-os/journal (learning queue, career sprint).
// Note: the four PyFloat-wrapped fields (weekToDate/monthToDate hphAvg,
// top3CompletionRate, businessCoreAvg, vitalityCoreAvg) hold their number at
// `.value` — this shape is for writing computed.json via store.saveComputed(),
// not for direct UI consumption; unwrap `.value` if rendering these live.
export function computeAll(daysMap, { learningPending = 0, careerSprint = {} } = {}) {
  if (daysMap.size === 0) {
    return {
      generatedAt: new Date().toISOString().slice(0, 10),
      lastJournalDate: "",
      streaks: {},
      weekToDate: {},
      monthToDate: {},
      learningPending,
      careerSprint,
    };
  }

  const dates = [...daysMap.keys()].sort();
  const latest = dates[dates.length - 1];
  const [latestY, latestWeek] = isoWeek(latest);
  const [latestYear, latestMonthNum] = latest.split("-").map(Number);

  const weekDocs = [];
  const monthDocs = [];
  for (const [dateISO, doc] of daysMap) {
    const [y, w] = isoWeek(dateISO);
    if (y === latestY && w === latestWeek) weekDocs.push({ dateISO, doc });
    const [dy, dm] = dateISO.split("-").map(Number);
    if (dy === latestYear && dm === latestMonthNum) monthDocs.push(doc);
  }
  weekDocs.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));

  const pillarHealth = {};
  for (const p of PILLARS) {
    let done = 0,
      total = 0;
    for (const doc of monthDocs) {
      for (const t of evening(doc).top3Results || []) {
        if (t.pillar === p) {
          total++;
          if (t.status === "done") done++;
        }
      }
    }
    pillarHealth[p] = total ? Math.round((100 * done) / total) : 0;
  }

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    lastJournalDate: latest,
    streaks: {
      journaling: streak(daysMap, latest, (d) => !!morning(d).completedAt || !!d.morning),
      meditation: streak(daysMap, latest, (d) => evening(d).vitalityCoreSteps?.meditation === true),
      exercise: streak(daysMap, latest, (d) => evening(d).vitalityCoreSteps?.exercise === true),
      dailyRead: streak(daysMap, latest, (d) => evening(d).vitalityCoreSteps?.dailyRead === true),
    },
    weekToDate: {
      isoWeek: `${latestY}-W${String(latestWeek).padStart(2, "0")}`,
      daysJournaled: weekDocs.length,
      hphByDay: weekDocs.map(({ dateISO, doc }) => ({
        date: dateISO,
        day: new Date(dateISO + "T00:00:00Z").toLocaleDateString("en-US", {
          weekday: "short",
          timeZone: "UTC",
        }),
        avg: evening(doc).hph?.average ?? null,
      })),
      hphAvg: new PyFloat(avg(weekDocs.map(({ doc }) => evening(doc).hph?.average))),
      top3CompletionRate: new PyFloat(top3Rate(weekDocs.map((w) => w.doc))),
      businessCoreAvg: new PyFloat(coreAvg(weekDocs.map((w) => w.doc), "businessCoreSteps")),
      vitalityCoreAvg: new PyFloat(coreAvg(weekDocs.map((w) => w.doc), "vitalityCoreSteps")),
    },
    monthToDate: {
      month: `${latestYear}-${String(latestMonthNum).padStart(2, "0")}`,
      daysJournaled: monthDocs.length,
      hphAvg: new PyFloat(avg(monthDocs.map((d) => evening(d).hph?.average))),
      pillarHealth,
    },
    learningPending,
    careerSprint,
  };
}
