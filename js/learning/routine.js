// Client for the "Learning: process" Claude Code Routine's API trigger (see
// code.claude.com/docs/en/routines). Firing it starts a fresh cloud session
// that reads learning/CLAUDE.md's Routine Processing Instructions and does
// the actual AI work (transcription, insights, summaries, brief drafts).
// Nothing here calls any AI directly — this file only ever does one thing:
// POST to Anthropic's routine-fire endpoint. Separate credential from the
// shared GitHub token (Phase H decision: two apps' GitHub tokens merge into
// one, but this routine token is unrelated and stays on its own).
import { GitHubStore } from "../github.js";

const ROUTINE_CONFIG_KEY = "learning.routine";
const FIRE_BETA_HEADER = "experimental-cc-routine-2026-04-01";

export function loadRoutineConfig() {
  try {
    const raw = localStorage.getItem(ROUTINE_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveRoutineConfig(cfg) {
  localStorage.setItem(ROUTINE_CONFIG_KEY, JSON.stringify(cfg));
}

export function clearRoutineConfig() {
  localStorage.removeItem(ROUTINE_CONFIG_KEY);
}

// ── Shared across devices ─────────────────────────────────────────────────
// The routine URL + token also live in learning/routine.json in the Claude repo, so each of
// Lokesh's devices picks them up. Never in the Navya repo: anyone with a token for that repo
// (Navya's phone included) could read it, and a session this routine starts reaches the Claude
// repo. Family devices keep their own copy, entered in Settings; Navya's phone has none.
let shared = null; // { cfg, navyaRepo }
export function setRoutineShare(cfg, navyaRepo) { shared = { cfg, navyaRepo }; }
function shareTargets() {
  if (!shared?.cfg?.token || shared.cfg.family) return [];
  return [{ repo: shared.cfg.repo, path: "learning/routine.json" }].map((x) => ({ ...x, gh: new GitHubStore({ token: shared.cfg.token, repo: x.repo, branch: "main" }) }));
}

// Reads the shared copy (newest wins) into this device. If no repo has one yet but this device
// does, publishes this device's copy, so setting it up once on any device sets up the rest.
// Never throws; returns the config in use (or null).
export async function syncRoutineConfig() {
  const targets = shareTargets();
  const found = [];
  for (const t of targets) {
    try { const { json, sha } = await t.gh.getFile(t.path); found.push({ t, json, sha }); } catch { /* no access to this repo */ }
  }
  const best = found.filter((f) => f.json?.url && f.json?.token).sort((a, b) => ((b.json.updatedAt || "") > (a.json.updatedAt || "") ? 1 : -1))[0];
  const local = loadRoutineConfig();
  if (best) {
    if (!local || local.url !== best.json.url || local.token !== best.json.token) saveRoutineConfig({ url: best.json.url, token: best.json.token });
    // keep every reachable copy the same
    for (const f of found) if (f !== best && (f.json?.url !== best.json.url || f.json?.token !== best.json.token)) {
      try { await f.t.gh.putFile(f.t.path, best.json, f.sha, "routine: sync settings"); } catch {}
    }
    return { url: best.json.url, token: best.json.token };
  }
  if (local?.url && local?.token && found.length) await publishRoutineConfig(local);
  return local;
}

// Saves (or, with null, removes) the shared copy in every repo this device can reach.
// Returns how many repos were updated and how many failed.
export async function publishRoutineConfig(rc) {
  let ok = 0, failed = 0;
  for (const t of shareTargets()) {
    try {
      const { json, sha } = await t.gh.getFile(t.path);
      if (rc) await t.gh.putFile(t.path, { url: rc.url, token: rc.token, updatedAt: new Date().toISOString() }, sha, "routine: save settings");
      else if (sha && json) await t.gh.deleteFile(t.path, sha, "routine: remove settings");
      ok++;
    } catch { failed++; }
  }
  return { ok, failed };
}

export class RoutineError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// text: optional fire-payload string. Two shapes this app ever sends:
//   omitted            -> routine does its normal pending-capture sweep
//   "draft brief <id>" -> routine drafts a brief for that one source
// Returns { sessionId, sessionUrl } on success.
export async function fireRoutine(text) {
  if (shared?.cfg?.kidOnly) throw new RoutineError("Reading runs from a parent's device.", "not_granted");
  let cfg = loadRoutineConfig();
  if (!cfg?.url || !cfg?.token) cfg = await syncRoutineConfig(); // first use on this device: fetch the shared copy
  if (!cfg?.url || !cfg?.token) {
    throw new RoutineError("Processing isn't set up yet — add the routine URL and token in Settings.", "not_granted");
  }
  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "anthropic-beta": FIRE_BETA_HEADER,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(text ? { text } : {}),
    });
  } catch {
    throw new RoutineError("Couldn't reach the routine endpoint.", "network");
  }
  if (res.status === 401) {
    throw new RoutineError("The routine token was rejected — it may have been regenerated or revoked.", "auth");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new RoutineError(body.message || `Couldn't start processing (${res.status}).`, "unknown");
  }
  const body = await res.json();
  return { sessionId: body.claude_code_session_id, sessionUrl: body.claude_code_session_url };
}
