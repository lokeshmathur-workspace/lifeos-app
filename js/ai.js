// Client for the Cloudflare Worker AI proxy (see worker/). Every function here has
// a manual fallback already built into the Today view — nothing routes through
// here is required for the daily loop to work.
import { PILLARS, HPH } from "./constants.js";
import { prettyDate } from "./dateutil.js";
import { QUOTES } from "./quotes.js";
import { readImproveTomorrow } from "./migrate.js";

const AI_CONFIG_KEY = "lifeos.ai";

export function loadAiConfig() {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAiConfig(cfg) {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(cfg));
}

export function clearAiConfig() {
  localStorage.removeItem(AI_CONFIG_KEY);
}

export class AiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function callAI(prompt, mode, modelTier) {
  const cfg = loadAiConfig();
  if (!cfg?.url || !cfg?.secret) {
    throw new AiError("AI isn't set up yet — add the Worker URL and secret in Settings.", "not_granted");
  }
  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Life-Os-Secret": cfg.secret },
      body: JSON.stringify({ prompt, mode, modelTier }),
    });
  } catch {
    throw new AiError("Couldn't reach the AI proxy.", "network");
  }
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new AiError(body.message || "AI request failed.", body.code || "unknown");
  return mode === "json" ? body.data : body.text;
}

// Standing context (month/week) — used by quote pick and the future insight/week/
// month prompts. Kept short and factual, matching the reference app's ctxLines.
export function ctxLines(state) {
  const lines = [];
  const cm = state?.currentMonth;
  const cw = state?.currentWeek;
  if (cm?.sprintTheme) lines.push(`Month theme: ${cm.sprintTheme}`);
  if (cm?.oneThingToProtect) lines.push(`Protecting: ${cm.oneThingToProtect}`);
  if (cw?.keyFocus) lines.push(`This week: ${cw.keyFocus}`);
  return lines.join("\n");
}

/* ── quote pick ──────────────────────────────────────────── */
// Ported from reference-app.html's quotePickPrompt — picks an INDEX from the fixed
// library only; the model never generates a quote.
export function quotePickPrompt(dateISO, state) {
  const list = QUOTES.map((q, i) => `${i}. "${q[0]}" — ${q[1]}`).join("\n");
  return `Choose the one quote from the numbered library below that best fits Lokesh's day.

His context for ${prettyDate(dateISO)}:
${ctxLines(state) || "(no month or week context set yet)"}

LIBRARY
${list}

Reply with only a JSON object: {"index": <number from the list>, "why": "<one sentence, max 25 words, on why this one fits today — refer to something concrete from his context>"}
Pick for genuine fit with what he is actually facing, not for general uplift. Do not invent a quote; the index must come from the list.`;
}

export async function pickQuoteAI(dateISO, state) {
  const r = await callAI(quotePickPrompt(dateISO, state), "json", "default");
  const i = Math.max(0, Math.min(QUOTES.length - 1, Number(r.index) || 0));
  return { text: QUOTES[i][0], author: QUOTES[i][1], why: r.why || "" };
}

/* ── evening draft ───────────────────────────────────────── */
// Ported from reference-app.html's eveningPrompt. Returns a DRAFT the user edits
// and explicitly saves — never written straight to the journal.
export function eveningPrompt(dateISO, doc, state) {
  const m = doc.morning || {};
  const e = doc.evening || {};
  const t3 = m.top3 || e.top3Results || [];
  const notes = (doc.notes || []).map((n) => `${n.t}${n.kind === "insight" ? " [insight]" : ""}: ${n.text}`).join("\n") || "(no notes captured)";
  const bizDone = Object.entries(e.businessCoreSteps || {}).filter(([k, v]) => k !== "totalCompleted" && v === true).map(([k]) => k);
  const vitDone = Object.entries(e.vitalityCoreSteps || {}).filter(([k, v]) => k !== "totalCompleted" && k !== "sleepTargetHrs" && v === true).map(([k]) => k);

  return `You are running Lokesh's evening review for ${prettyDate(dateISO)}. Be honest and specific — do not inflate, do not soften gaps, do not lecture.

THIS MORNING HE PLANNED
Excited about: ${m.excitedAbout || "—"}
Potential challenge: ${m.potentialChallenge || "—"} — plan: ${m.challengePlan || "—"}
Today is a success if: ${m.successAnchor || "—"}
Top 3: ${t3.length ? t3.map((t) => `${t.task} [${PILLARS[t.pillar] || t.pillar}] — ${t.status || "not_started"}`).join(" | ") : "—"}

WHAT ACTUALLY HAPPENED
Business core steps done (${bizDone.length}/6): ${bizDone.join(", ") || "none"}
Vitality core steps done (${vitDone.length}/6): ${vitDone.join(", ") || "none"}
Journal:
${notes.slice(0, 6000)}

WIDER CONTEXT
${ctxLines(state) || "(none set)"}

Reply with only a JSON object of this shape:
{"synthesis": "3-5 sentences on how the day actually went: planned vs actual on the top 3, the core-step counts, whether the success anchor was met, and anything from the journal worth flagging.",
 "successAnchorMet": "yes" | "partially" | "no",
 "reflections": {"gratitude":"...","taskHandledWell":"...","learned":"...","improveTomorrow":"..."},
 "hph": {"clarity":7,"energy":7,"necessity":7,"productivity":7,"influence":7,"courage":7},
 "hphNote": "One sentence about any habit you scored below 6, or an empty string."}

Rules: each reflection is one specific sentence drawn from the actual day above, written in his voice as a first-person draft he will edit — never generic. HPH scores are integers 1-10 based only on the evidence above; where there is little evidence, score near the middle rather than high.`;
}

export async function draftEveningAI(dateISO, doc, state) {
  return callAI(eveningPrompt(dateISO, doc, state), "json", "default");
}

/* ── 28-day insight (text, streamed-equivalent) ─────────────── */
export function insightPrompt(daysDescByDate, state) {
  const dates = [...daysDescByDate.keys()].sort().slice(-28);
  const lines = dates
    .map((dateISO) => {
      const doc = daysDescByDate.get(dateISO);
      const e = doc.evening || {};
      const m = doc.morning || {};
      const parts = [`${dateISO}`];
      if (m.successAnchor) parts.push(`anchor: ${m.successAnchor}`);
      const t3 = m.top3 || e.top3Results || [];
      if (t3.length) parts.push(`top3: ${t3.map((t) => `${t.task} [${t.pillar}] ${t.status || "not_started"}`).join(" ; ")}`);
      if (e.hph) parts.push(`hph ${e.hph.average ?? "?"} (${HPH.map(([k, l]) => `${l.slice(0, 4)} ${e.hph[k]}`).join(" ")})`);
      if (e.reflections) parts.push(`learned: ${e.reflections.learned || "-"} | improve: ${readImproveTomorrow(e.reflections) || "-"}`);
      const nts = (doc.notes || []).map((n) => n.text).join(" · ");
      if (nts) parts.push(`journal: ${nts.slice(0, 600)}`);
      return parts.join("\n  ");
    })
    .join("\n\n");

  return `You are looking at Lokesh's Life OS history to tell him something useful he probably has not noticed himself.

Standing context:
${ctxLines(state) || "(none set)"}

THE LAST ${dates.length} RECORDED DAYS
${lines || "(no history yet)"}

Write 2 to 4 short paragraphs. Each one must name a concrete pattern with the evidence from above — specific tasks, habits, pillars, dates or phrases he actually wrote — and then say what it suggests he do differently. Be direct and useful, not encouraging. No preamble, no headings, no bullet lists. If the history is too thin to say anything real, say exactly that in one sentence and name what would make it useful. Reply with only the prose.`;
}

export async function insightAI(daysDescByDate, state) {
  return callAI(insightPrompt(daysDescByDate, state), "text", "complex");
}
