// Every derived number the Family tab shows, from the files the store loads. Pure: no writes.
// (The weekly read's drafter reads the same numbers from here, so nothing is typed in by hand.)

const day = (iso) => new Date(iso + "T12:00:00");
export const addDays = (iso, n) => { const d = day(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 86400000);
export const sundayOf = (iso) => { const d = day(iso); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); };
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r0 = (x) => (x == null ? null : Math.round(x));
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export function computeFamily(D, today) {
  const out = { today, week: sundayOf(today) };
  const people = D.config?.people || [];
  const name = (id) => (id === "both" ? "Both" : people.find((p) => p.id === id)?.name || D.config?.kids?.find((k) => k.id === id)?.name || id);
  out.name = name;

  // ── money ──
  const m = D.money;
  if (m) {
    const full = (m.cashflow || []).filter((c) => c.month < m.month);
    const cur = (m.cashflow || []).find((c) => c.month === m.month) || null;
    const el = m.thisMonth?.daysElapsed || null, dim = m.thisMonth?.daysInMonth || null;
    const pace = (v) => (v != null && el && dim ? (v / el) * dim : null);
    const budgeted = (m.budgets || []).filter((b) => b.budget);
    const budgetTotal = budgeted.reduce((s, b) => s + b.budget, 0) || null, budgetSpent = budgeted.reduce((s, b) => s + (b.spent || 0), 0);
    const rate = (c) => (c?.income ? (c.savings / c.income) * 100 : null);
    const watch = (m.watch || []).map((w) => {
      // no budget (or a 0 budget, how Monarch reports "none") → compare with the usual month instead
      const proj = pace(w.spent), base = w.budget ? w.budget : w.avg3;
      return { ...w, projected: r0(proj), over: proj != null && base != null ? r0(Math.max(0, proj - base)) : null, vsAvg: w.avg3 != null && proj != null ? r0(proj - w.avg3) : null };
    });
    const overWatch = watch.reduce((s, w) => s + (w.over || 0), 0);
    const goals = (m.goals || []).map((g) => {
      // a debt goal counts down to its target (usually 0): what's left is the balance above it
      const left = g.kind === "debt" ? (g.current != null ? Math.max(0, g.current - (g.target || 0)) : null)
        : g.target != null && g.current != null ? Math.max(0, g.target - g.current) : null;
      const months = left != null && g.monthly ? Math.ceil(left / g.monthly) : null;
      const monthsFaster = left != null && g.monthly && overWatch ? months - Math.ceil(left / (g.monthly + overWatch)) : null;
      return { ...g, left, pct: g.kind === "debt" ? null : g.target ? r0((g.current / g.target) * 100) : null, months, monthsFaster };
    });
    const in30 = (d) => d >= today && daysBetween(today, d) <= 30;
    const bills = (m.bills || []).filter((b) => in30(b.due)).sort((a, b) => (a.due < b.due ? -1 : 1));
    out.money = {
      asOf: m.asOf, month: m.month, stale: m.asOf ? daysBetween(m.asOf.slice(0, 10), today) > 7 : true,
      // no month-end projection for the total or budgets: big one-off payments (tuition, club fees, the
      // mortgage) make a straight-line pace wrong. Only the watched day-to-day categories are projected.
      spent: cur?.spending ?? null, income: cur?.income ?? null, budgetTotal, budgetSpent: budgetTotal ? r0(budgetSpent) : null,
      daysElapsed: el, daysInMonth: dim,
      lastMonth: full.at(-1) || null, avg3Spending: r0(avg(full.slice(-3).map((c) => c.spending))), last3: full.slice(-3).map((c) => ({ month: c.month, spending: c.spending })),
      savingsRate: r1(rate(full.at(-1))), savingsRate3: r1(avg(full.slice(-3).map(rate).filter((x) => x != null))),
      months: full.slice(-6).map((c) => ({ ...c, rate: r1(rate(c)) })),
      overBudget: (m.budgets || []).filter((b) => b.budget && b.spent > b.budget).sort((a, b) => b.spent - b.budget - (a.spent - a.budget)),
      watch, overWatch: r0(overWatch), goals, bills, bills14: bills.filter((b) => daysBetween(today, b.due) <= 14).reduce((s, b) => s + (b.amount || 0), 0),
      // short-term debt = cards, loans and credit lines (the HELOC); a mortgage is long-term, shown on its own
      debts: (m.debts || []).map((d) => ({ ...d, longTerm: d.kind ? d.kind === "mortgage" : /mortgage/i.test(d.name || ""), months: d.monthlyPayment ? Math.ceil(d.balance / d.monthlyPayment) : null })),
      shortTermTotal: (m.debts || []).filter((d) => !(d.kind ? d.kind === "mortgage" : /mortgage/i.test(d.name || ""))).reduce((s, d) => s + (d.balance || 0), 0) + (m.creditLines || []).reduce((s, c) => s + (c.balance || 0), 0),
      debtTotal: (m.debts || []).reduce((s, d) => s + (d.balance || 0), 0), flags: m.flags || [], payYourself: m.payYourself || null,
      // credit lines (the HELOC): short-term debt, never spending — drawn adds to it, paid takes it down
      creditLines: (m.creditLines || []).map((cl) => {
        const months = (cl.months || []).map((x) => ({ ...x, net: (x.drawn || 0) - (x.paid || 0) }));
        const now = months.find((x) => x.month === m.month) || { month: m.month, drawn: 0, paid: 0, interest: 0, net: 0 };
        return { ...cl, months: months.slice(-6), now, net6: months.slice(-6).reduce((s, x) => s + x.net, 0) };
      }),
    };
  } else out.money = null;

  // ── health: each person's latest week vs their 4 weeks before ──
  const H = D.health?.entries || [];
  out.health = people.map((p) => {
    const mine = H.filter((e) => e.person === p.id).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    const last = mine.at(-1) || null, prev = mine.slice(-5, -1);
    const a = (k) => r1(avg(prev.map((e) => e[k]).filter((x) => x != null)));
    return { id: p.id, name: p.name, last, thisWeek: last?.weekStart === out.week, prev: { sleepHours: a("sleepHours"), exerciseDays: a("exerciseDays"), eating: a("eating"), energy: a("energy") }, weeks: mine.slice(-8) };
  });

  // ── us & relationships ──
  const R = D.rel || {};
  const lastOf = (kind) => (R.together || []).filter((t) => t.kind === kind).map((t) => t.date).sort().at(-1) || null;
  const nextBirthday = (mmdd) => { if (!mmdd) return null; let d = `${today.slice(0, 4)}-${mmdd}`; if (d < today) d = `${+today.slice(0, 4) + 1}-${mmdd}`; return d; };
  out.us = {
    lastUs: lastOf("us"), daysSinceUs: lastOf("us") ? daysBetween(lastOf("us"), today) : null,
    lastFamily: lastOf("family"), family30: (R.together || []).filter((t) => t.kind === "family" && daysBetween(t.date, today) <= 30).length,
    us30: (R.together || []).filter((t) => t.kind === "us" && daysBetween(t.date, today) <= 30).length,
    birthdays: (R.people || []).map((p) => ({ ...p, next: nextBirthday(p.birthday) })).filter((p) => p.next && daysBetween(today, p.next) <= 30).sort((a, b) => (a.next < b.next ? -1 : 1)),
    outOfTouch: (R.people || []).filter((p) => !p.lastContact || daysBetween(p.lastContact, today) > 30),
    appreciationThisWeek: (R.appreciation || []).filter((a) => a.date >= out.week),
  };

  // ── kids ──
  out.kids = (D.config?.kids || []).map((k) => {
    const d = D.kids?.[k.id] || {};
    const obs = (d.observations || []).filter((o) => daysBetween(o.date, today) <= 30);
    const byTrait = {};
    for (const o of obs) { const t = (byTrait[o.trait || "Other"] = byTrait[o.trait || "Other"] || { encourage: 0, correct: 0 }); t[o.type]++; }
    return { ...k, name: k.name || "Your other child", unnamed: !k.name, appointments: (d.appointments || []).filter((a) => !a.done && a.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1)),
      goals: d.goals || [], observations: (d.observations || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
      encourage30: obs.filter((o) => o.type === "encourage").length, correct30: obs.filter((o) => o.type === "correct").length,
      traits: Object.entries(byTrait).map(([trait, n]) => ({ trait, ...n })).sort((a, b) => b.encourage + b.correct - (a.encourage + a.correct)) };
  });
  const nv = D.navya;
  out.navya = nv ? { gpa: nv.computed?.gpa?.termProjected ?? null, social: nv.computed?.phone?.latest?.socialPerDay ?? null, limit: nv.computed?.phone?.limit ?? null,
    calls: nv.computed?.volleyball?.commLast4 ?? null, focus: nv.coach?.focus || null, week: nv.coach?.weekStart || null } : null;

  // ── home ──
  const HM = D.home || {};
  const every = { daily: 1, weekly: 7, monthly: 30 };
  out.home = {
    todos: (HM.todos || []).filter((t) => !t.done).sort((a, b) => ((a.due || "9999") < (b.due || "9999") ? -1 : 1)),
    done7: (HM.todos || []).filter((t) => t.done && t.doneAt && daysBetween(t.doneAt, today) <= 7).length,
    chores: (HM.chores || []).map((c) => { const next = c.last ? addDays(c.last, every[c.every]) : today; return { ...c, next, due: next <= today }; }).sort((a, b) => (a.next < b.next ? -1 : 1)),
    appointments: (HM.appointments || []).filter((a) => !a.done && a.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };

  // ── coming up: the next 14 days across every area ──
  const in14 = (d) => d && d >= today && daysBetween(today, d) <= 14;
  out.comingUp = [
    ...(out.money?.bills || []).filter((b) => in14(b.due)).map((b) => ({ date: b.due, icon: "Bill", text: `${b.name} · $${Math.round(b.amount)}`, area: "money" })),
    ...out.home.appointments.filter((a) => in14(a.date)).map((a) => ({ date: a.date, icon: "Appointment", text: `${a.what}${a.who && a.who !== "both" ? ` (${name(a.who)})` : ""}`, area: "home" })),
    ...out.kids.flatMap((k) => k.appointments.filter((a) => in14(a.date)).map((a) => ({ date: a.date, icon: "Kids", text: `${k.name}: ${a.what}`, area: "kids" }))),
    ...out.us.birthdays.filter((p) => in14(p.next)).map((p) => ({ date: p.next, icon: "Birthday", text: `${p.name}'s birthday`, area: "us" })),
    ...out.home.todos.filter((t) => t.due && (t.due < today || in14(t.due))).map((t) => ({ date: t.due, icon: t.due < today ? "Overdue" : "To-do", text: t.text, area: "home", overdue: t.due < today })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}
