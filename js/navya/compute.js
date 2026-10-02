// Every number the Navya tab shows, derived from the data files — never typed in, never from
// the AI. Pure function: same files in → same computed.json out. Runs in the browser after
// each save, and in Node for tests (`import { computeNavya } from ".../compute.js"`).

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// status words shared by the HQ scorecards
export const STATUS = { ok: "On track", watch: "Watch", work: "Needs work", new: "Just started" };

export function computeNavya(f, today) {
  const { codes, classes = [], grades = [], assignments = [], attendance, gpa, screentime = [], goals, vb, checkins = [] } = f;
  const scale = codes?.scale || [];
  const letterOf = (pct) => (scale.find(([, min]) => pct >= min) || ["N"])[0];
  const gpOf = (letter) => { const s = scale.find(([l]) => l === letter); return s ? s[2] : null; };
  const nextUp = (pct) => { const s = [...scale].reverse().find(([, min]) => min > pct); return s ? { letter: s[0], at: s[1], gap: r2(s[1] - pct) } : null; };
  const out = { generatedAt: new Date().toISOString(), today };

  // ── academics ──
  const snaps = [...grades].sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
  const snap = snaps.at(-1) || { classes: {} };
  out.academicsAsOf = snap.asOf || null;
  out.term = snap.term || null;
  out.classes = classes.map((c) => {
    const g = snap.classes[c.id];
    if (!g) return { id: c.id, name: c.short, period: c.period, letter: null };
    const mine = assignments.filter((a) => a.cls === c.id);
    const graded = mine.filter((a) => a.earned != null && a.max);
    const ungraded = mine.filter((a) => a.status === "ungraded" || a.status === "missing");
    const cats = (g.cats || []).map(([name, earned, max]) => ({ name, earned, max, pct: max ? r2((earned / max) * 100) : null }));
    const row = {
      id: c.id, name: c.short, fullName: c.name, period: c.period, teacher: c.teacher, level: c.level || null,
      letter: g.letter, pct: g.pct ?? null, display: g.display || null, gp: gpOf(g.letter), cats,
      s1: g.s1 || null, next: g.pct != null ? nextUp(g.pct) : null,
      low: graded.map((a) => ({ name: a.name, due: a.due, cat: a.cat, earned: a.earned, max: a.max, pct: r1((a.earned / a.max) * 100) }))
        .filter((a) => a.pct < 80).sort((a, b) => a.pct - b.pct),
      ungraded: ungraded.map((a) => ({ name: a.name, due: a.due, cat: a.cat, max: a.max, status: a.status })),
      upcoming: mine.filter((a) => a.status === "upcoming").map((a) => ({ name: a.name, due: a.due, max: a.max })),
      trend: snaps.filter((s) => s.classes[c.id]?.pct != null).map((s) => [s.asOf, s.classes[c.id].pct]),
    };
    // Category weights aren't shown in Skyward's pop-up. With one or two categories they can be
    // solved from the term % (w·a + (1−w)·b = pct); with three or more they stay unknown.
    if (cats.length === 1) row.weights = { [cats[0].name]: 1 };
    if (cats.length === 2 && g.pct != null && cats[0].pct !== cats[1].pct) {
      const [a, b] = cats, w = (b.pct - g.pct) / (b.pct - a.pct);
      if (w > 0 && w < 1) row.weights = { [a.name]: r2(w), [b.name]: r2(1 - w) };
    }
    // What the not-yet-graded work could do: everything full marks vs everything zero.
    if (row.weights && ungraded.length && cats.length) {
      const at = (full) => r2(cats.reduce((s, k) => {
        const pend = ungraded.filter((u) => u.cat === k.name && u.max).reduce((t, u) => t + u.max, 0);
        return s + (row.weights[k.name] || 0) * ((k.earned + (full ? pend : 0)) / (k.max + pend)) * 100;
      }, 0));
      row.whatIf = { pendingPts: ungraded.reduce((t, u) => t + (u.max || 0), 0), allFull: at(true), allZero: at(false) };
      row.whatIf.letters = [letterOf(row.whatIf.allZero), letterOf(row.whatIf.allFull)];
    }
    if (cats.length >= 2) {
      const ps = cats.map((k) => k.pct).filter((x) => x != null);
      row.catSpread = r2(Math.max(...ps) - Math.min(...ps));
    }
    return row;
  });
  const withGrade = out.classes.filter((c) => c.gp != null);
  const gpaOf = (pick) => (withGrade.length ? r2(avg(withGrade.map(pick))) : null);
  const termGpa = gpaOf((c) => c.gp);
  const s1Gpa = gpaOf((c) => (c.s1 ? gpOf(c.s1.letter) ?? c.gp : c.gp));
  const cum = gpa?.cumulative;
  const credits = withGrade.length * 0.5; // a semester class = 0.5 credit
  const withTerm = (g) => (cum && g != null ? r2((cum.points + g * credits) / (cum.credits + credits)) : null);
  out.gpa = {
    target: goals?.gpaTarget ?? null, method: gpa?.method || null,
    cumulative: cum?.gpa ?? null, history: gpa?.history || [],
    termProjected: termGpa, s1Projected: s1Gpa, cumulativeIfTerm: withTerm(termGpa), cumulativeIfS1: withTerm(s1Gpa),
    trend: snaps.map((s) => { const gs = Object.values(s.classes).map((x) => gpOf(x.letter)).filter((x) => x != null); return [s.asOf, gs.length ? r2(avg(gs)) : null]; }),
  };
  // the cheapest lifts: each class one letter up
  out.gpa.lifts = withGrade.filter((c) => c.next).map((c) => ({ id: c.id, name: c.name, to: c.next.letter, gap: c.next.gap,
    gpa: gpaOf((x) => (x.id === c.id ? gpOf(c.next.letter) : x.gp)) })).sort((a, b) => a.gap - b.gap);

  // ── attendance ──
  const ac = codes?.attendanceCodes || {};
  const events = (attendance?.events || []).map((e) => ({ ...e, label: ac[e.code]?.[0] || e.code, group: ac[e.code]?.[1] || "other" }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const issues = events.filter((e) => e.group === "tardy" || e.group === "unexcused");
  out.attendance = {
    totals: attendance?.totals || null, asOf: attendance?.totalsAsOf || null, events,
    tardyByPeriod: events.filter((e) => e.group === "tardy").reduce((m, e) => { e.periods.forEach((p) => (m[p] = (m[p] || 0) + 1)); return m; }, {}),
    lastIssue: issues[0]?.date || null,
    daysSinceIssue: issues[0] ? Math.max(0, daysBetween(issues[0].date, today)) : null,
    unknownPeriods: [...new Set(events.flatMap((e) => e.periods).map(String).filter((p) => !(codes?.periods || {})[p]))],
  };

  // ── phone ──
  const L = goals?.limits || { socialMin: 90, socialApps: [], shortFormApps: [], messagingApps: [] };
  const weeks = [...screentime].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)).map((w) => {
    const d = w.daysCovered || 7, sum = (names) => names.reduce((s, n) => s + (w.appsMin?.[n] || 0), 0);
    const social = sum(L.socialApps) / d;
    return {
      weekStart: w.weekStart, device: w.device, asOf: w.asOf, daysCovered: d, partial: !!w.partialWeek,
      totalPerDay: w.dailyAvgMin ?? Math.round((w.totalMin || 0) / d), vsLastWeekPct: w.vsLastWeekPct ?? null,
      socialPerDay: Math.round(social), shortFormPerDay: Math.round(sum(L.shortFormApps) / d), messagingPerDay: Math.round(sum(L.messagingApps) / d),
      limit: L.socialMin, timesLimit: r1(social / L.socialMin),
      apps: Object.entries(w.appsMin || {}).map(([name, m]) => ({ name, perDay: Math.round(m / d), week: m,
        kind: L.shortFormApps.includes(name) ? "short" : L.socialApps.includes(name) ? "social" : L.messagingApps.includes(name) ? "msg" : "other" }))
        .sort((a, b) => b.week - a.week),
      days: (w.days || []).map((x) => ({ ...x, overLimit: x.socialMin != null && x.socialMin > L.socialMin })),
      pickups: w.pickups ? { ...w.pickups, everyMin: Math.round((16 * 60) / w.pickups.dailyAvg),
        topFirst: Object.entries(w.pickups.firstApp || {}).sort((a, b) => b[1] - a[1])[0] || null,
        topFirstShare: w.pickups.total ? Math.round(((Object.values(w.pickups.firstApp || {}).sort((a, b) => b - a)[0] || 0) / w.pickups.total) * 100) : null } : null,
    };
  });
  out.phone = { limit: L.socialMin, weeks, latest: weeks.at(-1) || null };
  if (out.phone.latest) {
    const full = out.phone.latest.days.filter((x) => !x.partialDay && x.date !== out.phone.latest.asOf?.slice(0, 10));
    out.phone.latest.fullDaysOverLimit = full.filter((x) => x.overLimit).length;
    out.phone.latest.fullDays = full.length;
  }

  // ── volleyball (tracker as-is; a game saved twice keeps its longest copy) ──
  const games = {};
  for (const g of Object.values(vb?.game_logs || {})) {
    const k = g.date + "|" + (g.opponent || "").trim();
    if (!games[k] || (g.sets || []).length > games[k].sets.length) games[k] = g;
  }
  out.volleyball = {
    games: Object.values(games).sort((a, b) => (a.date < b.date ? -1 : 1)).map((g) => {
      const t = (k) => g.sets.reduce((s, x) => s + (+x[k] || 0), 0), good = t("comm_positive"), miss = t("comm_missed");
      return { date: g.date, opponent: (g.opponent || "").trim(), type: g.type || "", sets: g.sets.length,
        wins: g.sets.filter((s) => s.result === "W").length, assists: t("assists"), setErrors: t("set_errors"),
        aces: t("aces"), serveErrors: t("service_errors"), dumpKills: t("dump_kills"),
        commGood: good, commMissed: miss, commPct: good + miss ? Math.round((good / (good + miss)) * 100) : null };
    }),
    dailyLogsLatest: Object.keys(vb?.daily_logs || {}).sort().at(-1) || null,
    parentLogsLatest: Object.keys(vb?.parent_logs || {}).sort().at(-1) || null,
  };
  const G = out.volleyball.games.filter((g) => g.commPct != null);
  if (G.length) {
    out.volleyball.commFirst3 = Math.round(avg(G.slice(0, 3).map((g) => g.commPct)));
    out.volleyball.commLast4 = Math.round(avg(G.slice(-4).map((g) => g.commPct)));
    out.volleyball.bestComm = G.reduce((a, g) => (g.commPct > a.commPct ? g : a));
    const clean = G.filter((g) => g.assists >= 10);
    out.volleyball.cleanest = clean.length ? clean.reduce((a, g) => (g.setErrors / g.assists < a.setErrors / a.assists ? g : a)) : null;
  }
  const reps = Object.values(vb?.daily_logs || {}).filter((d) => d.date && daysBetween(d.date, today) <= 7);
  const tgt = goals?.daily?.reps || {};
  out.volleyball.reps7 = reps.length ? { days: reps.length,
    setting: Math.round(avg(reps.map((d) => d.metrics?.setting_reps || 0))), footwork: Math.round(avg(reps.map((d) => d.metrics?.footwork_reps || 0))),
    serve: Math.round(avg(reps.map((d) => d.metrics?.serve_reps || 0))), targets: tgt } : null;

  // ── fuel, sleep, check-ins (last 7 days; tracker parent logs fill gaps) ──
  const week = (iso) => daysBetween(iso, today) >= 0 && daysBetween(iso, today) < 7;
  const ci = checkins.filter((c) => week(c.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const pl = Object.entries(vb?.parent_logs || {}).filter(([d]) => week(d)).map(([date, p]) => ({ date, sleepHrs: p.sleep_hrs, breakfast: p.breakfast, lunch: p.lunch, dinner: p.dinner }));
  const days = {};
  for (const p of pl) days[p.date] = { ...p, src: "tracker" };
  for (const c of ci) days[c.date] = { ...(days[c.date] || {}), ...c, src: "checkin" };
  const D = Object.values(days).sort((a, b) => (a.date < b.date ? -1 : 1));
  const num = (k) => D.map((d) => d[k]).filter((x) => typeof x === "number");
  out.daily = { days: D, logged: D.length,
    sleepAvg: num("sleepHrs").length ? r1(avg(num("sleepHrs"))) : null,
    breakfastSolid: D.filter((d) => d.breakfast === "green").length,
    studyAvg: num("studyMin").length ? Math.round(avg(num("studyMin"))) : null,
    practiceAvg: num("ownPracticeMin").length ? Math.round(avg(num("ownPracticeMin"))) : null,
    conditioningAvg: num("conditioningMin").length ? Math.round(avg(num("conditioningMin"))) : null,
    energyAvg: num("energy").length ? r1(avg(num("energy"))) : null,
    phoneAway: D.filter((d) => d.phoneAway === true).length,
    wins: D.filter((d) => d.win).map((d) => ({ date: d.date, text: d.win })) };

  // ── character (Sunday check-ins) ──
  const traits = goals?.traits || [];
  const rated = checkins.filter((c) => c.character).sort((a, b) => (a.date < b.date ? -1 : 1));
  out.character = { traits: traits.map((t) => ({ ...t, ratings: rated.map((c) => [c.date, c.character[t.id] ?? null]) })),
    latest: rated.at(-1) ? { date: rated.at(-1).date, ratings: rated.at(-1).character, moment: rated.at(-1).moment || "" } : null };
  if (out.character.latest) out.character.latest.shown = Object.values(out.character.latest.ratings).filter((v) => v >= 2).length;

  // ── same-day links worth a question (never conclusions) ──
  const sick = events.filter((e) => e.code === "M" && e.periods.length >= 6).map((e) => e.date);
  out.links = {
    sickDays: sick,
    gradedOnSickDays: assignments.filter((a) => sick.includes(a.due) && a.earned != null).map((a) => ({ cls: a.cls, name: a.name, earned: a.earned, max: a.max, date: a.due })),
    gamesOnSickDays: out.volleyball.games.filter((g) => sick.includes(g.date)).map((g) => ({ date: g.date, opponent: g.opponent })),
  };

  // ── HQ scorecards ──
  const worst = withGrade.reduce((a, c) => (c.pct != null && (!a || c.pct < a.pct) ? c : a), null);
  const lt = out.phone.latest;
  out.cards = {
    academics: termGpa == null ? "new" : withGrade.some((c) => c.letter === "N" || (c.s1 && c.s1.letter === "N")) ? "work"
      : termGpa >= (goals?.gpaTarget ?? 4) ? "ok" : "watch",
    character: out.character.latest ? (out.character.latest.shown >= traits.length - 1 ? "ok" : "watch") : "new",
    volleyball: G.length ? "ok" : "new",
    phone: !lt ? "new" : lt.socialPerDay <= L.socialMin ? "ok" : lt.socialPerDay <= L.socialMin * 1.5 ? "watch" : "work",
    fuel: out.daily.sleepAvg == null ? "new" : out.daily.sleepAvg >= (goals?.daily?.sleepHours ?? 9) ? "ok" : out.daily.sleepAvg >= 8 ? "watch" : "work",
    extracurriculars: (goals?.extracurriculars || []).length ? "ok" : "new",
  };
  out.lowestClass = worst ? { id: worst.id, name: worst.name, pct: worst.pct, letter: worst.letter } : null;
  out.freshness = { academics: snap.asOf || null, attendance: attendance?.totalsAsOf || null, phone: lt?.asOf?.slice(0, 10) || null,
    games: out.volleyball.games.at(-1)?.date || null, checkins: checkins.map((c) => c.date).sort().at(-1) || null };
  return out;
}

export { addDays, daysBetween };
