// Every derived number the Family tab shows, from the files the store loads. Pure: no writes.
// (The weekly read's drafter reads the same numbers from here, so nothing is typed in by hand.)

const day = (iso) => new Date(iso + "T12:00:00");
export const addDays = (iso, n) => { const d = day(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 86400000);
export const sundayOf = (iso) => { const d = day(iso); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); };
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r0 = (x) => (x == null ? null : Math.round(x));
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// Paydays on a contribution's schedule from `from` to `to` (inclusive): every 14 days from a known
// payday, twice a month (on `days`, default the 15th and the last day), or monthly on `day`
// (default the last day).
export function paydays(c, from, to) {
  const out = [];
  if (from > to) return out;
  if (c.schedule === "biweekly") {
    if (!c.anchorPayday) return out;
    for (let d = addDays(c.anchorPayday, Math.ceil(daysBetween(c.anchorPayday, from) / 14) * 14); d <= to; d = addDays(d, 14)) out.push(d);
    return out;
  }
  for (let y = +from.slice(0, 4), mo = +from.slice(5, 7); `${y}-${String(mo).padStart(2, "0")}` <= to.slice(0, 7); mo === 12 ? (y++, mo = 1) : mo++) {
    const ym = `${y}-${String(mo).padStart(2, "0")}`, last = new Date(y, mo, 0).getDate();
    const days = c.schedule === "semimonthly" ? (c.days || [15, last]).map((x) => Math.min(x, last)) : [Math.min(c.day || last, last)];
    for (const dd of days) { const d = `${ym}-${String(dd).padStart(2, "0")}`; if (d >= from && d <= to) out.push(d); }
  }
  return out;
}

// "Pay yourselves first": the sync's category rows (travel, the kids' sport, what merchants took)
// plus what the app works out itself — paycheck contributions from config (401(k), Roth, ESPP, read
// off the paystubs, `stubs` and `perPaycheck`) and credit-line paydown (paid minus new draws). Shown only once a sync has run.
export function payFirstData(m, pf, today) {
  if (!m?.payYourself) return null;
  // The paycheck figures follow the month the Monarch numbers are for (so both sides match), and
  // count the whole month: they're fixed amounts off the paystubs, not "so far".
  const ym = m.payYourself.month || m.month || today.slice(0, 7), year = ym.slice(0, 4), monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(new Date(+year, +ym.slice(5, 7), 0).getDate()).padStart(2, "0")}`;
  const md = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const contrib = (pf?.contributions || []).map((c) => {
    // Paystub figures for this year: [{date, amount (that paycheck), ytd}]. Between stubs the year-
    // to-date is the last stub's plus perPaycheck for each payday since; before the first stub it
    // backs out. So a contribution that changed or hit its limit mid-year still adds up.
    const stubs = (c.stubs || (c.ytd != null ? [{ date: c.ytdAsOf, amount: c.perPaycheck, ytd: c.ytd }] : []))
      .filter((x) => x.date?.startsWith(year)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const per = c.perPaycheck || 0;
    const upTo = (d) => {
      const last = [...stubs].reverse().find((x) => x.date <= d), first = stubs[0];
      const v = last ? last.ytd + per * paydays(c, addDays(last.date, 1), d).length
        : first ? first.ytd - (first.amount || 0) - per * paydays(c, addDays(d, 1), addDays(first.date, -1)).length
        : per * paydays(c, `${year}-01-01`, d).length;
      return Math.max(0, c.annualCap ? Math.min(v, c.annualCap) : v);
    };
    const ytd = upTo(monthEnd), before = monthStart > `${year}-01-01` ? upTo(addDays(monthStart, -1)) : 0;
    // Where the figure comes from: the paystubs for that month, or the last paystub's amount per paycheck.
    const inMonth = stubs.filter((x) => x.date >= monthStart && x.date <= monthEnd), lastStub = [...stubs].reverse().find((x) => x.date <= monthEnd);
    const src = inMonth.length ? `${inMonth.length > 1 ? "paystubs" : "paystub"} ${inMonth.map((x) => md(x.date)).join(" & ")}`
      : lastStub ? `${paydays(c, monthStart, monthEnd).length} paychecks at the ${md(lastStub.date)} paystub's amount` : "per paycheck";
    const srcYear = lastStub ? `year to date on the ${md(lastStub.date)} paystub${paydays(c, addDays(lastStub.date, 1), monthEnd).length ? `, plus ${paydays(c, addDays(lastStub.date, 1), monthEnd).length} paychecks since` : ""}` : "per paycheck";
    return { label: c.label, kind: c.kind || "retirement", paystub: true, ...(c.inPayFirst === false ? { hidden: true } : {}), note: [c.note, src].filter(Boolean).join(" · "), noteYear: [c.note, srcYear].filter(Boolean).join(" · "), month: r0(Math.max(0, ytd - before)), ytd: r0(ytd) };
  });
  const paydown = (m.creditLines || []).map((cl) => {
    const net = (mo) => (mo.paid || 0) - (mo.drawn || 0);
    const cur = (cl.months || []).find((mo) => mo.month === m.month);
    const ytd = (cl.months || []).filter((mo) => mo.month.startsWith(year)).reduce((s, mo) => s + net(mo), 0);
    return { label: `${cl.name} · paydown`, kind: "paydown", note: "paid minus new draws", month: r0(Math.max(0, cur ? net(cur) : 0)), ytd: r0(Math.max(0, ytd)) };
  });
  return { ...m.payYourself, kept: [...contrib, ...(m.payYourself.kept || []), ...paydown] };
}

export function computeFamily(D, today) {
  const out = { today, week: sundayOf(today) };
  const people = D.config?.people || [];
  const name = (id) => (id === "both" ? "Both" : people.find((p) => p.id === id)?.name || D.config?.kids?.find((k) => k.id === id)?.name || id);
  out.name = name;

  // ── money ──
  const m = D.money;
  if (m) {
    // One-off income or spending (a stock sale, a one-time payout) skews the picture: it stays out of
    // income, spending and savings unless the parents chose to include it (config finance.oneOffs).
    const FC = D.config?.finance || {}, oneDec = FC.oneOffs || {};
    const oneOffs = (m.cashflow || []).flatMap((c) => (c.oneOffs || []).map((o) => ({ ...o, month: c.month, decision: oneDec[o.id] || null })));
    const left = (c, kind) => (c.oneOffs || []).filter((o) => o.kind === kind && oneDec[o.id] !== "include").reduce((s, o) => s + (o.amount || 0), 0);
    const cashflow = (m.cashflow || []).map((c) => { const inc = left(c, "income"), exp = left(c, "expense");
      if (!inc && !exp) return c; const income = c.income - inc, spending = c.spending - exp; return { ...c, income, spending, savings: income - spending, leftOut: { income: inc, spending: exp } }; });
    const full = cashflow.filter((c) => c.month < m.month);
    const cur = cashflow.find((c) => c.month === m.month) || null;
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
    // Loans with figures from their own statements (config finance.loans, e.g. the mortgage) replace
    // Monarch's stale numbers: their payments go in Bills, their balance and term in Debt.
    const loans = (FC.loans || []).map((l) => {
      const pay = l.payment || {}, every = pay.every === "biweekly" ? 14 : null;
      const dues = [];
      if (pay.amount && every && pay.anchor) { let d = pay.anchor; while (d < today) d = addDays(d, every); for (; in30(d); d = addDays(d, every)) dues.push(d); }
      else if (pay.amount && pay.day) for (const d of [today.slice(0, 8) + String(pay.day).padStart(2, "0"), addDays(today.slice(0, 8) + "01", 32).slice(0, 8) + String(pay.day).padStart(2, "0")]) if (in30(d)) dues.push(d);
      const perMonth = pay.amount && every ? r0((pay.amount * 26) / 12) : l.monthlyDue ? r0(l.monthlyDue) : null; // 26 payments a year
      return { ...l, dues, perMonth };
    });
    const isLoanBill = (b) => loans.some((l) => (l.match || [l.name]).some((x) => (b.name || "").toLowerCase().includes(x.toLowerCase())));
    const clCfg = FC.creditLines || [];
    const bills = [...(m.bills || []).filter((b) => in30(b.due) && !isLoanBill(b)),
      ...loans.flatMap((l) => l.dues.map((due) => ({ name: l.name, amount: l.payment.amount, due, note: l.payment.every === "biweekly" ? "every 2 weeks" : "" }))),
      ...clCfg.filter((c) => c.statement?.bankDue && in30(c.statement.bankDueDate)).map((c) => ({ name: (m.creditLines || []).find((x) => x.account === c.account)?.name || c.name, amount: c.statement.bankDue, due: c.statement.bankDueDate, note: `bank's minimum · your plan is ${c.minimum ? `$${c.minimum}` : "more"}` }))]
      .sort((a, b) => (a.due < b.due ? -1 : 1));
    const loanFor = (d) => loans.find((l) => l.name === d.name || (l.match || []).some((x) => (d.name || "").toLowerCase().includes(x.toLowerCase())));
    const debtsIn = (m.debts || []).map((d) => { const l = loanFor(d); return l ? { name: l.name, kind: l.kind || d.kind, balance: l.balance, apr: l.apr, monthlyPayment: l.monthlyDue, monthsLeft: l.monthsLeft, payoff: l.payoff, perMonth: l.perMonth, payment: l.payment, split: l.split, asOf: l.asOf, fromStatement: true } : d; });
    for (const l of loans) if (!debtsIn.some((d) => d.name === l.name)) debtsIn.push({ name: l.name, kind: l.kind, balance: l.balance, apr: l.apr, monthlyPayment: l.monthlyDue, monthsLeft: l.monthsLeft, payoff: l.payoff, perMonth: l.perMonth, payment: l.payment, split: l.split, asOf: l.asOf, fromStatement: true });
    out.money = {
      asOf: m.asOf, month: m.month, stale: m.asOf ? daysBetween(m.asOf.slice(0, 10), today) > 7 : true,
      // no month-end projection for the total or budgets: big one-off payments (tuition, club fees, the
      // mortgage) make a straight-line pace wrong. Only the watched day-to-day categories are projected.
      spent: cur?.spending ?? null, income: cur?.income ?? null, budgetTotal, budgetSpent: budgetTotal ? r0(budgetSpent) : null,
      daysElapsed: el, daysInMonth: dim,
      lastMonth: full.at(-1) || null, avg3Spending: r0(avg(full.slice(-3).map((c) => c.spending))), last3: full.slice(-3).map((c) => ({ month: c.month, spending: c.spending })),
      savingsRate: r1(rate(full.at(-1))), savingsRate3: r1(avg(full.slice(-3).map(rate).filter((x) => x != null))),
      months: full.slice(-6).map((c) => ({ ...c, rate: r1(rate(c)) })), oneOffs, oneOffsPending: oneOffs.filter((o) => !o.decision),
      overBudget: (m.budgets || []).filter((b) => b.budget && b.spent > b.budget).sort((a, b) => b.spent - b.budget - (a.spent - a.budget)),
      watch, overWatch: r0(overWatch), goals, bills, bills14: bills.filter((b) => daysBetween(today, b.due) <= 14).reduce((s, b) => s + (b.amount || 0), 0),
      // short-term debt = cards, loans and credit lines (the HELOC); a mortgage is long-term, shown on its own
      debts: debtsIn.map((d) => ({ ...d, longTerm: d.kind ? d.kind === "mortgage" : /mortgage/i.test(d.name || ""), months: d.monthsLeft ?? (d.monthlyPayment ? Math.ceil(d.balance / d.monthlyPayment) : null) })),
      shortTermTotal: debtsIn.filter((d) => !(d.kind ? d.kind === "mortgage" : /mortgage/i.test(d.name || ""))).reduce((s, d) => s + (d.balance || 0), 0) + (m.creditLines || []).reduce((s, c) => s + (c.balance || 0), 0),
      debtTotal: debtsIn.reduce((s, d) => s + (d.balance || 0), 0), flags: m.flags || [], payYourself: payFirstData(m, D.config?.finance?.payFirst, today), navyaMoney: m.navyaMoney || null,
      // credit lines (the HELOC): short-term debt, never spending — drawn adds to it, paid takes it down
      creditLines: (m.creditLines || []).map((cl) => {
        const months = (cl.months || []).map((x) => ({ ...x, net: (x.drawn || 0) - (x.paid || 0) }));
        const now = months.find((x) => x.month === m.month) || { month: m.month, drawn: 0, paid: 0, interest: 0, net: 0 };
        const cc = clCfg.find((c) => c.account === cl.account || c.name === cl.name) || {}, minimum = cc.minimum || null, st = cc.statement || null;
        // Monarch doesn't report the line's interest; the bank's statement does (rate, this year's interest).
        const interest = st?.apr ? { apr: st.apr, perMonth: r0((cl.balance * st.apr) / 100 / 12), ytd: st.interestYtd ?? null, lastYear: st.interestLastYear ?? null, asOf: st.asOf } : null;
        return { ...cl, minimum, interest, limit: st?.limit ?? null, payoff: st?.payoff ?? null, bankDue: st?.bankDue ? { amount: st.bankDue, date: st.bankDueDate } : null, noMonthlyInterest: !(cl.months || []).some((x) => x.interest), belowMin: minimum != null && cl.balance > 0 && now.paid < minimum, months: months.slice(-6), now, net6: months.slice(-6).reduce((s, x) => s + x.net, 0) };
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

  // ── nutrition: plan the 7 days from the next Growing Together, review the 7 before it ──
  const NM = D.nutrition?.meals || {}, md = D.config?.us?.meetingDay ?? 0;
  const nextMeet = addDays(today, (md - day(today).getDay() + 7) % 7);
  const span = (start) => Array.from({ length: 7 }, (_, i) => { const date = addDays(start, i); return { date, ...(NM[date] || {}) }; });
  const rev = span(addDays(nextMeet, -7)), plan = span(nextMeet);
  const fav = {};
  for (const m of Object.values(NM)) if (m.dinner && m.again === "yes") { const k = m.dinnerId || m.dinner; fav[k] = fav[k] || { name: m.dinner, id: m.dinnerId || null, n: 0 }; fav[k].n++; }
  out.nutrition = {
    plan: { start: nextMeet, days: plan, planned: plan.filter((d) => d.dinner).length },
    review: { start: addDays(nextMeet, -7), days: rev, planned: rev.filter((d) => d.dinner).length, cooked: rev.filter((d) => d.status === "cooked").length,
      out: rev.filter((d) => d.status === "out").length, other: rev.filter((d) => d.status === "other").length, open: rev.filter((d) => d.date <= today && !d.status).length },
    favorites: Object.values(fav).sort((a, b) => b.n - a.n).slice(0, 16),
  };

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
  const acts = (HM.activities || []).map((a) => ({ ...a, status: a.status || "planned" })), when = (a) => `${a.date || ""}${a.time || ""}`;
  out.home = {
    upcoming: acts.filter((a) => a.status === "planned" && a.date && a.date >= today).sort((a, b) => (when(a) < when(b) ? -1 : 1)),
    missed: acts.filter((a) => a.status === "planned" && a.date && a.date < today).sort((a, b) => (when(a) < when(b) ? -1 : 1)),
    ideas: acts.filter((a) => a.status === "planned" && !a.date),
    done: acts.filter((a) => a.status !== "planned").sort((a, b) => ((a.date || a.doneAt) < (b.date || b.doneAt) ? 1 : -1)),
    doneMonth: acts.filter((a) => a.status === "done" && (a.date || a.doneAt || "").slice(0, 7) === today.slice(0, 7)).length,
    doneWeek: acts.filter((a) => a.status === "done" && (a.date || a.doneAt) >= out.week && (a.date || a.doneAt) <= addDays(out.week, 6)).length,
  };

  // ── coming up: the next 14 days across every area ──
  const in14 = (d) => d && d >= today && daysBetween(today, d) <= 14;
  out.comingUp = [
    ...(out.money?.bills || []).filter((b) => in14(b.due)).map((b) => ({ date: b.due, icon: "Bill", text: `${b.name} · $${Math.round(b.amount)}`, area: "money" })),
    ...out.home.upcoming.filter((a) => in14(a.date)).map((a) => ({ date: a.date, icon: !a.for || a.for === "family" ? "Family" : a.for === "us" ? "Just us" : name(a.for), text: a.what, area: "home" })),
    ...out.kids.flatMap((k) => k.appointments.filter((a) => in14(a.date)).map((a) => ({ date: a.date, icon: "Kids", text: `${k.name}: ${a.what}`, area: "kids" }))),
    ...out.us.birthdays.filter((p) => in14(p.next)).map((p) => ({ date: p.next, icon: "Birthday", text: `${p.name}'s birthday`, area: "us" })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}
