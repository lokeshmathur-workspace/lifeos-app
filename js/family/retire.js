// Retirement: are we on track? Everything is in today's dollars (a real, after-inflation return),
// so "$/month in retirement" means today's spending power.
//   - Goal: the monthly income you want in retirement → the nest egg it takes (4% rule: × 12 × 25).
//   - Projected: today's balances growing at the return, plus each year's contributions.
//   - On track: the balance you'd need at each age to reach the goal on time with those same
//     contributions (the goal, worked back year by year). Above the line = ahead; below = behind.
// Settings live in config.json → finance.retirement; balances come from there (or Monarch's
// retirement goals once Fidelity syncs), contributions from the paystub numbers.
import { payFirstData } from "./compute.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (n) => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);
const big = (n) => (n == null ? "–" : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : usd(n));
const fmtD = (iso) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export function retireData(D, today) {
  const rc = D.config?.finance?.retirement;
  if (!rc) return null;
  const year = +today.slice(0, 4), lead = (rc.people || [])[0], age = lead?.birthYear ? year - lead.birthYear : null;
  if (age == null || !rc.retireAge) return { missing: true, rc };
  const r = rc.realReturn ?? 0.05, n = Math.max(0, rc.retireAge - age);
  // balances: entered ones, else Monarch's retirement goals
  const accounts = (rc.accounts || []).filter((a) => a.balance != null);
  const fromMonarch = (D.money?.goals || []).filter((g) => g.kind === "retirement" && g.current != null);
  const balance = accounts.length ? accounts.reduce((s, a) => s + a.balance, 0) : fromMonarch.reduce((s, g) => s + g.current, 0) || null;
  // a year of retirement saving: set by hand, or this year's paystub contributions (retirement kind) for the full year
  let yearly = rc.yearlyContribution ?? null;
  if (yearly == null && D.config?.finance?.payFirst?.contributions?.length) {
    const full = payFirstData({ month: `${year}-12`, payYourself: { kept: [], taken: [] }, creditLines: [] }, D.config.finance.payFirst, `${year}-12-31`);
    yearly = Math.round(full.kept.filter((k) => k.kind === "retirement").reduce((s, k) => s + k.ytd, 0));
  }
  yearly = yearly || 0;
  // Social Security (today's $): lowers what savings must cover once it starts; until then savings
  // cover the full goal, so the years between retiring and claiming are added on top.
  const ageAtRetire = (p) => rc.retireAge - (age - (p.birthYear ? year - p.birthYear : age));
  const ss = (rc.people || []).filter((p) => p.ssMonthly > 0).map((p) => ({ name: p.name, monthly: p.ssMonthly, startAge: p.ssAge || 67,
    bridgeYears: Math.max(0, (p.ssAge || 67) - ageAtRetire(p)), guessedAge: !p.birthYear }));
  const ssTotal = ss.reduce((t, x) => t + x.monthly, 0), bridge = ss.reduce((t, x) => t + x.monthly * 12 * x.bridgeYears, 0);
  const target = rc.monthlyGoal ? Math.max(0, rc.monthlyGoal - ssTotal) * 12 / 0.04 + bridge : null;
  const pts = [];
  for (let i = 0, b = balance || 0; i <= n; i++) { pts.push({ age: age + i, year: year + i, projected: b }); b = b * (1 + r) + yearly; }
  if (target != null) for (let i = n; i >= 0; i--) pts[i].needed = i === n ? target : (pts[i + 1].needed - yearly) / (1 + r);
  const end = pts.at(-1).projected, neededNow = target != null ? pts[0].needed : null;
  // what closes the gap: more a year, or a later retirement age
  const annuity = n ? ((1 + r) ** n - 1) / r : 0;
  const extraYearly = target != null && end < target && annuity ? Math.ceil(((target - end) / annuity) / 100) * 100 : 0;
  let laterAge = null;
  if (target != null && end < target) for (let k = 1, b = end; k <= 15; k++) { b = b * (1 + r) + yearly; if (b >= target) { laterAge = rc.retireAge + k; break; } }
  return { ss, ssTotal, bridge, rc, age, n, r, balance, accounts, fromMonarch: !accounts.length && fromMonarch.length > 0, yearly, target, pts, end, neededNow,
    monthlyNow: balance != null ? (balance * 0.04) / 12 : null, monthlyAt: (end * 0.04) / 12, extraYearly, laterAge };
}

function chart(R) {
  // drawn at the width it's shown at, so the text stays readable on a phone
  const narrow = typeof window !== "undefined" && window.innerWidth < 600;
  const W = narrow ? 360 : 700, H = narrow ? 240 : 270, L = narrow ? 44 : 58, Rt = narrow ? 92 : 128, T = 18, B = 28, pts = R.pts;
  const maxY = Math.max(...pts.map((p) => Math.max(p.projected, p.needed || 0))) * 1.08;
  const step = [1e5, 2.5e5, 5e5, 1e6, 2e6, 5e6].find((s) => maxY / s <= 5) || 1e7;
  const x = (i) => L + (pts.length > 1 ? (i / (pts.length - 1)) * (W - L - Rt) : 0), y = (v) => T + (1 - v / (Math.ceil(maxY / step) * step)) * (H - T - B);
  const top = Math.ceil(maxY / step) * step, ticks = []; for (let v = 0; v <= top + 1; v += step) ticks.push(v);
  const line = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const everyN = Math.max(1, Math.ceil(pts.length / (narrow ? 4 : 7)));
  const last = pts.length - 1, ahead = R.neededNow != null && R.balance >= R.neededNow;
  return `<figure class="rt-chart" data-pts='${esc(JSON.stringify(pts.map((p) => [p.age, p.year, Math.round(p.projected), p.needed != null ? Math.round(p.needed) : null])))}'>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected retirement savings against the path to the goal, by age">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - Rt}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${big(v)}</text>`).join("")}
      ${pts.map((p, i) => (i % everyN === 0 || i === last ? `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${p.age}</text>` : "")).join("")}
      ${R.target != null ? `<path class="need" d="${line("needed")}"/>` : ""}
      <path class="proj" d="${line("projected")}"/>
      ${R.target != null ? `<circle class="needdot" cx="${x(0)}" cy="${y(pts[0].needed)}" r="4"/>` : ""}
      <circle class="projdot" cx="${x(0)}" cy="${y(pts[0].projected)}" r="5"/>
      <circle class="projdot" cx="${x(last)}" cy="${y(pts[last].projected)}" r="5"/>
      ${(() => { const py = y(pts[last].projected), ny = R.target != null ? y(pts[last].needed) : null, projAbove = ny != null && py < ny;
        const gap = ny == null ? 99 : Math.abs(py - ny), shift = gap < 34 ? (34 - gap) / 2 : 0;
        const pY = py + (projAbove ? -shift : shift), nY = ny == null ? null : ny + (projAbove ? shift : -shift);
        return `<text class="lbl proj" x="${x(last) + 10}" y="${pY - 2}">Projected</text><text class="lbl proj" x="${x(last) + 10}" y="${pY + 13}">${big(pts[last].projected)}</text>`
          + (nY != null ? `<text class="lbl need" x="${x(last) + 10}" y="${nY - 2}">Goal</text><text class="lbl need" x="${x(last) + 10}" y="${nY + 13}">${big(R.target)}</text>` : ""); })()}
      <text class="lbl today" x="${x(0) + 10}" y="${Math.min(y(pts[0].projected) + 20, H - B - 22)}">Today ${big(R.balance)}</text>
      ${R.neededNow != null ? `<text class="lbl today" x="${x(0) + 10}" y="${Math.min(y(pts[0].projected) + 36, H - B - 6)}">${ahead ? "ahead" : "behind"} by ${big(Math.abs(R.balance - R.neededNow))}</text>` : ""}
      <line class="hair" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      <rect class="hit" x="${L}" y="${T}" width="${W - L - Rt}" height="${H - T - B}" fill="transparent"/>
    </svg>
    <div class="rt-tip" hidden></div>
    <figcaption class="rt-legend"><span><i class="k proj"></i>Projected: today's savings plus what you put in each year</span>${R.target != null ? `<span><i class="k need"></i>On track: where you'd need to be at each age to reach the goal</span>` : ""}<span class="sub">Age is ${esc(R.rc.people?.[0]?.name || "Lokesh")}'s</span></figcaption>
  </figure>`;
}

export function retireHTML(R) {
  if (!R) return "";
  const rc = R.rc;
  const settings = `<details class="fm-more rt-set"><summary>Goal and assumptions</summary><div class="fam-form wrap">
      ${(rc.people || []).map((p, i) => `<label class="fm-fld sm"><span>${esc(p.name)}: birth year</span><input data-rt="birthYear" data-i="${i}" inputmode="numeric" value="${esc(p.birthYear ?? "")}"></label>
        <label class="fm-fld sm"><span>${esc(p.name)}: Social Security a month</span><input data-rt="ssMonthly" data-i="${i}" inputmode="numeric" placeholder="from ssa.gov" value="${esc(p.ssMonthly ?? "")}"></label>
        <label class="fm-fld sm"><span>${esc(p.name)}: starting at age</span><input data-rt="ssAge" data-i="${i}" inputmode="numeric" placeholder="67" value="${esc(p.ssAge ?? "")}"></label>`).join("")}
      <label class="fm-fld sm"><span>Retire at (${esc(rc.people?.[0]?.name || "")}'s age)</span><input data-rt="retireAge" inputmode="numeric" value="${esc(rc.retireAge ?? "")}"></label>
      <label class="fm-fld sm"><span>Monthly income you want (today's $)</span><input data-rt="monthlyGoal" inputmode="numeric" value="${esc(rc.monthlyGoal ?? "")}"></label>
      <label class="fm-fld sm"><span>Return after inflation</span><input data-rt="realReturn" inputmode="decimal" value="${esc(rc.realReturn != null ? Math.round(rc.realReturn * 1000) / 10 : 5)}"><em>%</em></label>
      <button class="fm-btn sm pri" data-act="saveretire">Save</button></div>
      <p class="sub">Social Security: your estimate in today's dollars at the age you plan to claim, from ssa.gov → my Social Security. Savings cover the whole goal until it starts.</p>
      <p class="sub">5% after inflation is a common middle-of-the-road assumption for a stock-heavy mix; 4% is cautious, 6% optimistic. The 4% rule: withdrawing 4% of savings in the first year (then adjusting for inflation) has historically lasted about 30 years.</p></details>`;
  if (R.missing) return `<div class="fm-tile s4 rt"><h3>Retirement: on track?</h3><p class="sub">Add your birth years, the age you'd like to retire and the monthly income you want, and this shows where you are against where you need to be.</p>${settings.replace("<details", "<details open")}</div>`;
  const ahead = R.target != null && R.end >= R.target;
  return `<div class="fm-tile s4 rt"><div class="fm-rowsplit"><h3>Retirement: on track?</h3><span class="sub">in today's dollars · ${Math.round(R.r * 1000) / 10}% a year after inflation</span></div>
    <div class="fm-big3">
      <div class="tri"><b>${usd(R.monthlyNow)}</b><span>a month, if you retired today (4% rule on ${big(R.balance)})</span></div>
      <div class="tri"><b class="${R.target != null ? (ahead ? "good" : "bad") : ""}">${usd(R.monthlyAt + R.ssTotal)}</b><span>a month at ${R.rc.retireAge}, on today's pace${R.ssTotal ? `: ${usd(R.monthlyAt)} from savings + ${usd(R.ssTotal)} Social Security${R.ss.some((x) => x.bridgeYears) ? ` (from ${R.ss.map((x) => x.startAge).sort()[0]})` : ""}` : ""}${R.rc.monthlyGoal ? ` · goal ${usd(R.rc.monthlyGoal)}` : ""}</span></div>
      <div class="tri"><b>${R.target != null ? big(R.target) : "–"}</b><span>${R.target == null ? "set a monthly goal" : R.ssTotal ? `savings needed: (${usd(R.rc.monthlyGoal)} − ${usd(R.ssTotal)} Social Security) × 12 × 25${R.bridge ? ` + ${big(R.bridge)} until it starts` : ""}` : `the goal: ${usd(R.rc.monthlyGoal)} a month × 12 × 25`}</span></div></div>
    ${chart(R)}
    ${R.target != null ? `<p class="rt-say">${ahead ? `You're on track: at ${R.rc.retireAge} you'd have about <b>${big(R.end)}</b>, which with Social Security covers <b>${usd(R.rc.monthlyGoal)}</b> a month.`
      : `On today's pace you'd reach <b>${big(R.end)}</b> at ${R.rc.retireAge}: ${usd(R.monthlyAt)} a month from savings${R.ssTotal ? ` plus ${usd(R.ssTotal)} Social Security, ${usd(R.monthlyAt + R.ssTotal)} in all` : ""}, short of ${usd(R.rc.monthlyGoal)}. To close the gap: put in about <b>${usd(R.extraYearly)} more a year</b>${R.laterAge ? `, or retire at <b>${R.laterAge}</b>` : ""}.`}</p>` : ""}
    ${R.ssTotal ? `<p class="sub">Social Security counted: ${R.ss.map((x) => `${esc(x.name)} ${usd(x.monthly)} a month from ${x.startAge}${x.guessedAge ? " (age assumed same as Lokesh's until a birth year is added)" : ""}`).join(" · ")}.</p>` : `<p class="sub">Social Security isn't counted yet. Add your estimates under Goal and assumptions.</p>`}
    <div class="rt-foot"><span class="sub">Saving <b>${usd(R.yearly)}</b> a year for retirement${R.rc.yearlyContribution == null ? " (this year's paycheck contributions, matches included)" : ""}.</span>
      <span class="sub">${R.accounts.length ? `Balances: ${R.accounts.map((a) => `${esc(a.label)} ${big(a.balance)}`).join(" · ")}${R.accounts[0].asOf ? `, as of ${fmtD(R.accounts.map((a) => a.asOf).sort()[0])}` : ""}` : R.fromMonarch ? "Balances from Monarch." : "No balances yet."}</span></div>
    ${settings}</div>`;
}

// Hover: the year under the pointer, with both values.
export function wireRetire(root) {
  const fig = root.querySelector(".rt-chart"); if (!fig) return;
  const pts = JSON.parse(fig.dataset.pts), svg = fig.querySelector("svg"), hair = svg.querySelector(".hair"), tip = fig.querySelector(".rt-tip"), hit = svg.querySelector(".hit");
  const L = +hit.getAttribute("x"), Wd = +hit.getAttribute("width");
  const show = (e) => {
    const box = svg.getBoundingClientRect(), vx = ((e.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((vx - L) / Wd) * (pts.length - 1)))), [age, yr, proj, need] = pts[i];
    const sx = L + (pts.length > 1 ? (i / (pts.length - 1)) * Wd : 0);
    hair.setAttribute("x1", sx); hair.setAttribute("x2", sx); hair.setAttribute("visibility", "visible");
    tip.hidden = false; tip.innerHTML = `<b>Age ${age} · ${yr}</b><span><i class="k proj"></i>Projected ${usd(proj)}</span>${need != null ? `<span><i class="k need"></i>On track ${usd(need)}</span>` : ""}<span class="sub">${usd((proj * 0.04) / 12)} a month by the 4% rule</span>`;
    const px = (sx / svg.viewBox.baseVal.width) * box.width; tip.style.left = `${Math.min(Math.max(px - 90, 0), box.width - 180)}px`;
  };
  hit.addEventListener("pointermove", show); hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", () => { hair.setAttribute("visibility", "hidden"); tip.hidden = true; });
}
