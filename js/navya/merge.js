// Turns a routine's result.json (rows read from screenshots) into a list of reviewable changes
// against the current data files. Pure: nothing is written until the parent taps Save, and only
// the changes left ticked are applied, with any values they edited.
//
// buildChanges(data, result, asOf) -> [{ key, area, title, detail, fields: [{k, label, value}], apply(docs, vals) }]
// applyChanges(data, changes, picked, edits) -> { docs, touched: Set(fileKey) }

const norm = (s) => String(s || "").toLowerCase().replace(/[…\.]+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
const sameName = (a, b) => { const x = norm(a), y = norm(b); return x === y || (x.length > 6 && y.startsWith(x)) || (y.length > 6 && x.startsWith(y)); };
const num = (v) => (v === "" || v == null || Number.isNaN(+v) ? null : +v);
const slug = (s) => norm(s).split(" ").slice(0, 2).join("").slice(0, 8) || "cls";

export function matchClass(classes, { period, name }) {
  const p = period != null ? String(period).replace(/[^\d]/g, "") : "";
  return classes.find((c) => p && String(c.period) === p) || classes.find((c) => sameName(c.name, name) || sameName(c.short, name)) || null;
}

const GROUP = (label) => (/tard/i.test(label) ? "tardy" : /unexcused/i.test(label) ? "unexcused" : /medical|excused|illness/i.test(label) ? "excused" : /activity/i.test(label) ? "activity" : "other");
const STD_GP = { A: 4.0, "A-": 3.7, "B+": 3.3, B: 3.0, "B-": 2.7, "C+": 2.3, C: 2.0, "C-": 1.7, "D+": 1.3, D: 1.0, N: 0, F: 0, E: 0 };

export function buildChanges(data, result, asOf) {
  const changes = [];
  const classes = data.classes || [];
  const snips = result?.snips || [];
  const clsFor = (period, name) => matchClass(classes, { period, name });
  const add = (c) => changes.push(c);

  // ── grades: one snapshot per batch date; letters from the Grades page, % and categories from pop-ups
  const latest = [...(data.grades || [])].sort((a, b) => (a.asOf < b.asOf ? -1 : 1)).at(-1);
  for (const s of snips.filter((x) => x.kind === "skyward.classDetail")) {
    const c = clsFor(s.period, s.class);
    if (!c) { add(unknownClass(s.class, s.period, s.teacher)); continue; }
    const isS1 = /^S/i.test(s.term || "");
    const prev = latest?.classes?.[c.id];
    const before = isS1 ? prev?.s1 : prev;
    const pct = s.percent ?? null;
    const sameCats = !s.categories?.length || isS1 || JSON.stringify((prev?.cats || [])) === JSON.stringify(s.categories.map((k) => [k.name, num(k.earned), num(k.possible)]));
    const unchanged = before && before.letter === s.grade && (before.pct ?? null) === pct && sameCats;
    if (!unchanged) add({
      key: `grade:${c.id}:${s.term}`, area: "Grades", file: "grades",
      title: `${c.short}: ${s.grade}${pct != null ? ` · ${pct}%` : s.display ? ` · ${s.display}` : ""} (${s.term})`,
      detail: before ? `was ${before.letter}${before.pct != null ? ` · ${before.pct}%` : ""}` : "new",
      fields: [{ k: "letter", label: "Letter", value: s.grade }, { k: "pct", label: "%", value: pct ?? "" }],
      apply(docs, v) {
        const snap = snapshotFor(docs, asOf, s.term && !isS1 ? s.term : null);
        const row = (snap.classes[c.id] = snap.classes[c.id] || {});
        if (isS1) { row.s1 = { letter: v.letter, pct: num(v.pct) }; if (!row.letter) row.letter = v.letter; }
        else {
          row.letter = v.letter; row.pct = num(v.pct);
          if (s.display) row.display = s.display; else delete row.display;
          if (s.categories?.length) row.cats = s.categories.map((k) => [k.name, num(k.earned), num(k.possible)]);
        }
      },
    });
    if (!isS1) for (const it of s.items || []) assignmentChange(add, data, c, { due: it.due, cat: it.category, name: it.name, earned: it.earned, max: it.possible, status: it.earned == null ? (it.flag ? "missing" : "ungraded") : "graded" }, asOf);
  }
  for (const s of snips.filter((x) => x.kind === "skyward.grades")) {
    for (const g of s.classes || []) {
      const c = clsFor(g.period, g.name);
      if (!c) { add(unknownClass(g.name, g.period)); continue; }
      const term = g.T2 ? "T2" : "T1", letter = g[term];
      const hasDetail = snips.some((x) => x.kind === "skyward.classDetail" && clsFor(x.period, x.class)?.id === c.id && !/^S/i.test(x.term || ""));
      if (!letter || hasDetail) continue; // the pop-up carries the same letter plus the %
      if (latest?.classes?.[c.id]?.letter === letter && (!g.S1 || (latest.classes[c.id].s1?.letter || letter) === g.S1)) continue;
      add({
        key: `letter:${c.id}`, area: "Grades", file: "grades", title: `${c.short}: ${letter} (${term}, letter only)`,
        detail: latest?.classes?.[c.id] ? `was ${latest.classes[c.id].letter}` : "new",
        fields: [{ k: "letter", label: "Letter", value: letter }],
        apply(docs, v) { const snap = snapshotFor(docs, asOf, term); const row = (snap.classes[c.id] = snap.classes[c.id] || {}); row.letter = v.letter; if (!("pct" in row)) row.pct = null; if (g.S1 && g.S1 !== v.letter) row.s1 = { ...(row.s1 || {}), letter: g.S1 }; },
      });
    }
  }

  // ── assignments tabs
  for (const s of snips.filter((x) => x.kind === "skyward.assignments")) {
    for (const r of s.rows || []) {
      const c = clsFor(null, r.class);
      if (!c) { add(unknownClass(r.class)); continue; }
      const status = r.score != null ? "graded" : s.tab === "upcoming" ? "upcoming" : s.tab === "missing" ? "missing" : "ungraded";
      assignmentChange(add, data, c, { due: r.due, cat: r.category, name: r.name, earned: r.score, max: r.max, weight: r.weight !== 1 ? r.weight : undefined, status }, asOf);
    }
  }

  // ── attendance
  for (const s of snips.filter((x) => x.kind === "skyward.attendance")) {
    const t0 = data.attendance?.totals;
    if (s.totals && !(t0 && ["absent", "excused", "unexcused", "tardy"].every((k) => num(t0[k]) === num(s.totals[k])))) add({
      key: "att:totals", area: "Attendance", file: "attendance",
      title: `Year totals: ${s.totals.absent} absent · ${s.totals.tardy} tardy`, detail: data.attendance?.totals ? `was ${data.attendance.totals.absent} absent · ${data.attendance.totals.tardy} tardy` : "new",
      fields: [{ k: "absent", label: "Absent", value: s.totals.absent }, { k: "tardy", label: "Tardy", value: s.totals.tardy }],
      apply(docs, v) { const a = (docs.attendance = docs.attendance || { events: [] }); a.totals = { ...s.totals, absent: num(v.absent), tardy: num(v.tardy) }; a.totalsAsOf = asOf; },
    });
    for (const e of s.events || []) {
      const periods = (e.periods || []).map((p) => (/^\d+$/.test(String(p)) ? +p : String(p)));
      const key = (ps) => ps.map(String).join(",");
      const exists = (data.attendance?.events || []).some((x) => x.date === e.date && x.code === e.code && key(x.periods) === key(periods));
      if (exists) continue;
      add({
        key: `att:${e.date}:${e.code}:${periods}`, area: "Attendance", file: "attendance",
        title: `${e.date} · period ${periods.join(", ")} · ${data.codes?.attendanceCodes?.[e.code]?.[0] || e.code}`, detail: "new",
        fields: [],
        apply(docs) { const a = (docs.attendance = docs.attendance || { events: [] }); a.events = a.events || []; a.events.push({ date: e.date, periods, code: e.code, ...(e.hasComment ? { comment: true } : {}) }); },
      });
    }
  }
  for (const s of snips.filter((x) => x.kind === "skyward.attendanceLegend")) {
    const have = data.codes?.attendanceCodes || {};
    const fresh = Object.entries(s.codes || {}).filter(([k, label]) => !have[k] || have[k][0] !== label);
    if (fresh.length) add({
      key: "codes:attendance", area: "School codes", file: "codes", title: `Attendance codes: ${fresh.map(([k]) => k).join(", ")}`, detail: "new or renamed", fields: [],
      apply(docs) { docs.codes.attendanceCodes = docs.codes.attendanceCodes || {}; for (const [k, label] of fresh) docs.codes.attendanceCodes[k] = [label, GROUP(label)]; },
    });
  }
  for (const s of snips.filter((x) => x.kind === "skyward.gradingScale")) {
    const scale = (s.scale || []).map(([m, low]) => [m, num(low), STD_GP[m] ?? 0]).sort((a, b) => b[1] - a[1]);
    if (scale.length && JSON.stringify(scale) !== JSON.stringify(data.codes?.scale)) add({
      key: "codes:scale", area: "School codes", file: "codes", title: "Grading scale", detail: scale.map(([m, l]) => `${m} ${l}`).join(" · "), fields: [],
      apply(docs) { docs.codes.scale = scale; },
    });
  }
  for (const s of snips.filter((x) => x.kind === "skyward.gpa")) {
    const cur = data.gpa?.cumulative;
    add({
      key: "gpa", area: "GPA", file: "gpa", title: `Cumulative GPA ${s.cumulative?.gpa} (${s.cumulative?.credits} credits)`, detail: cur ? `was ${cur.gpa}` : "new",
      fields: [{ k: "gpa", label: "GPA", value: s.cumulative?.gpa }],
      apply(docs, v) {
        docs.gpa = { method: s.method, cumulative: { ...s.cumulative, gpa: num(v.gpa) }, asOf,
          history: (s.rows || []).filter((r) => r[4] != null && r[2] > 0).map(([y, b, cr, , g]) => [y, b, cr, g]) };
      },
    });
  }
  for (const s of snips.filter((x) => x.kind === "skyward.schedule")) {
    for (const p of s.periods || []) {
      const c = clsFor(p.period, p.s1?.class);
      if (c && p.s1 && ((p.s1.teacher && !sameName(p.s1.teacher, c.teacher)) || (p.s1.room && String(p.s1.room) !== String(c.room)))) add({
        key: `sched:${c.id}`, area: "Classes", file: "classes", title: `${c.short}: ${p.s1.teacher || c.teacher} · room ${p.s1.room || c.room}`, detail: `was ${c.teacher} · room ${c.room}`, fields: [],
        apply(docs) { const row = docs.classes.find((x) => x.id === c.id); if (p.s1.teacher) row.teacher = titleCase(p.s1.teacher); if (p.s1.room) row.room = String(p.s1.room); },
      });
    }
  }

  // ── Screen Time: week + apps + pickups (+ day) from the same batch make one row per device/week
  const wk = snips.find((x) => x.kind === "screentime.week");
  const apps = snips.find((x) => x.kind === "screentime.apps");
  const pick = snips.find((x) => x.kind === "screentime.pickups");
  const day = snips.filter((x) => x.kind === "screentime.day");
  if (wk || apps || pick) {
    const weekStart = wk?.weekStart || pick?.days?.[0]?.[0] || null;
    const device = wk?.device || "iPhone";
    const prev = (data.screentime || []).find((x) => x.weekStart === weekStart && x.device === device);
    const social = (data.goals?.limits?.socialApps || []).reduce((s, n) => s + (apps?.appsMin?.[n] || 0), 0);
    const d = wk?.daysCovered || prev?.daysCovered || 7;
    const same = prev && (!wk || (prev.dailyAvgMin === wk.dailyAvgMin && prev.totalMin === wk.totalMin && prev.daysCovered === wk.daysCovered))
      && (!apps || JSON.stringify(prev.appsMin) === JSON.stringify(apps.appsMin)) && (!pick || prev.pickups?.total === pick.total) && !day.length;
    if (!same) add({
      key: `st:${device}:${weekStart}`, area: "Phone", file: "screentime",
      title: `${device}, week of ${weekStart}: ${fmtMin(wk?.dailyAvgMin ?? prev?.dailyAvgMin)}/day${apps ? ` · social ${fmtMin(Math.round(social / d))}/day` : ""}`,
      detail: prev ? `replaces the ${prev.asOf?.slice(0, 10)} reading of this week` : "new week",
      fields: [{ k: "dailyAvgMin", label: "Daily avg (min)", value: wk?.dailyAvgMin ?? prev?.dailyAvgMin ?? "" }, { k: "daysCovered", label: "Days covered", value: d }],
      apply(docs, v) {
        docs.screentime = docs.screentime || [];
        const i = docs.screentime.findIndex((x) => x.weekStart === weekStart && x.device === device);
        const base = i >= 0 ? docs.screentime[i] : { device, weekStart };
        const row = { ...base, asOf: wk?.updatedAt || asOf, daysCovered: num(v.daysCovered), partialWeek: num(v.daysCovered) < 7,
          dailyAvgMin: num(v.dailyAvgMin), ...(wk ? { totalMin: wk.totalMin, vsLastWeekPct: wk.vsLastWeekPct ?? null, categoriesMin: wk.categoriesMin || {}, days: wk.days || [] } : {}),
          ...(apps ? { appsMin: apps.appsMin } : {}), ...(pick ? { pickups: { dailyAvg: pick.dailyAvg, total: pick.total, max: pick.max, days: pick.days || [], firstApp: pick.firstApp || {} } } : {}) };
        if (day.length) row.lateNight = { ...(base.lateNight || {}), ...Object.fromEntries(day.map((x) => [x.date, (x.hourly || []).filter(([h]) => h >= 21).reduce((s, [, m]) => s + m, 0)])) };
        if (i >= 0) docs.screentime[i] = row; else docs.screentime.push(row);
      },
    });
  }
  return changes;
}

function assignmentChange(add, data, c, r, asOf) {
  if (!r.name || !r.due) return;
  const list = data.assignments || [];
  const prev = list.find((a) => a.cls === c.id && a.due === r.due && sameName(a.name, r.name));
  const earned = num(r.earned), max = num(r.max);
  if (prev && prev.earned === earned && prev.max === max && prev.status === r.status) return; // nothing new
  // a "past, not graded" row must not erase a grade we already have, nor un-flag a missing one
  if (prev && r.status === "ungraded" && (prev.earned != null || prev.status === "missing")) return;
  add({
    key: `asg:${c.id}:${r.due}:${norm(r.name)}`, area: `Assignments · ${c.short}`, file: "assignments",
    title: `${r.name} (${r.due}): ${earned == null ? r.status : `${earned}/${max}`}`,
    detail: prev ? `was ${prev.earned == null ? prev.status : `${prev.earned}/${prev.max}`}` : "new",
    fields: r.status === "graded" ? [{ k: "earned", label: "Score", value: earned }, { k: "max", label: "Out of", value: max }] : [],
    apply(docs, v) {
      const rows = (docs.assignments = docs.assignments || []);
      let row = rows.find((a) => a.cls === c.id && a.due === r.due && sameName(a.name, r.name));
      const e = v.earned !== undefined ? num(v.earned) : earned, m = v.max !== undefined ? num(v.max) : max;
      if (!row) { row = { cls: c.id, due: r.due, cat: r.cat || "", name: r.name, earned: e, max: m, status: r.status, firstSeen: asOf, lastSeen: asOf, history: [] }; rows.push(row); }
      if (r.name.length > row.name.length && !/…$/.test(r.name)) row.name = r.name;
      if (r.cat) row.cat = r.cat;
      if (r.weight !== undefined) row.weight = r.weight;
      row.earned = e; row.max = m; row.status = r.status; row.lastSeen = asOf;
      row.history = [...(row.history || []).filter(([d]) => d !== asOf), [asOf, e]];
    },
  });
}

function unknownClass(name, period, teacher) {
  return {
    key: `cls:${norm(name)}`, area: "Classes", file: "classes", title: `New class: ${name}${period ? ` (period ${period})` : ""}`, detail: "not in her class list yet",
    fields: [{ k: "short", label: "Short name", value: String(name || "").replace(/\s*\(.*$/, "").replace(/…$/, "") }],
    apply(docs, v) {
      if (docs.classes.some((c) => sameName(c.name, name))) return;
      let id = slug(v.short || name); while (docs.classes.some((c) => c.id === id)) id += "x";
      docs.classes.push({ id, period: period != null ? +String(period).replace(/[^\d]/g, "") || period : null, name, short: v.short || name, teacher: titleCase(teacher || ""), room: "", core: null });
    },
  };
}

function snapshotFor(docs, asOf, term) {
  docs.grades = docs.grades || [];
  let snap = docs.grades.find((g) => g.asOf === asOf);
  if (!snap) {
    const last = [...docs.grades].sort((a, b) => (a.asOf < b.asOf ? -1 : 1)).at(-1);
    snap = { asOf, term: term || last?.term || "T1", classes: last ? structuredClone(last.classes) : {} };
    docs.grades.push(snap);
  }
  if (term) snap.term = term;
  return snap;
}

const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const fmtMin = (m) => (m == null ? "?" : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);

// Applies the picked changes (with edited values) to clones of the docs. Returns the new docs and
// which files changed, so the caller writes only those.
export function applyChanges(data, changes, picked, edits) {
  const docs = structuredClone({ classes: data.classes, grades: data.grades, assignments: data.assignments, attendance: data.attendance,
    gpa: data.gpa, screentime: data.screentime, codes: data.codes });
  docs.classes = docs.classes || [];
  const touched = new Set();
  // classes first, so grade/assignment rows for a newly added class can find it on the next batch
  const order = (c) => (c.file === "classes" ? 0 : c.file === "codes" ? 1 : 2);
  for (const c of [...changes].sort((a, b) => order(a) - order(b))) {
    if (!picked.has(c.key)) continue;
    const vals = Object.fromEntries((c.fields || []).map((f) => [f.k, edits?.[c.key]?.[f.k] ?? f.value]));
    c.apply(docs, vals);
    touched.add(c.file);
  }
  return { docs, touched };
}

export const FILE_PATHS = { classes: "academics/classes.json", grades: "academics/grades.json", assignments: "academics/assignments.json",
  attendance: "academics/attendance.json", gpa: "academics/gpa.json", screentime: "phone/screentime.json", codes: "school/codes.json" };
