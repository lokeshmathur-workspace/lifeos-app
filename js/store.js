// The app's persistence layer: wraps GitHubStore with an in-memory doc cache,
// debounced writes, and deepMerge optimistic updates — the same shape as
// reference-app.html's saveDay/saveState/deepMerge, just backed by the GitHub
// Contents API instead of the artifact db capability.

import { GitHubStore, GitHubStoreError } from "./github.js";
import { refreshComputed } from "./recompute.js";

const CONFIG_KEY = "lifeos.gh";
const PIN_KEY = "lifeos.pin";

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

export function loadPinHash() {
  return localStorage.getItem(PIN_KEY);
}

export function savePinHash(hash) {
  localStorage.setItem(PIN_KEY, hash);
}

export function clearPin() {
  localStorage.removeItem(PIN_KEY);
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function deepMerge(t, s) {
  for (const k in s) {
    if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) {
      t[k] = t[k] && typeof t[k] === "object" ? { ...t[k] } : {};
      deepMerge(t[k], s[k]);
    } else {
      t[k] = s[k];
    }
  }
  return t;
}

const journalPath = (dateISO) => `life-os/journal/${dateISO.slice(0, 4)}/${dateISO}.json`;
const STATE_PATH = "life-os/state/current.json";
const COMPUTED_PATH = "life-os/state/computed.json";

export class Store {
  constructor(cfg, onFlash) {
    this.gh = new GitHubStore(cfg);
    this.docs = new Map(); // dateISO -> { doc, sha }
    this.exists = new Map(); // dateISO -> boolean (a file was actually found, not a synthetic placeholder)
    this.state = null; // { doc, sha }
    this.saveTimers = new Map(); // path -> timeout id
    this.onFlash = onFlash || (() => {});
    this.recomputeTimer = null;
  }

  // Every saveDay() (any journal-file write) can change what recompute.py
  // tracks — habit streaks, week/month HPH and core-step averages, top3
  // completion — not just the "big" saves (plan/evening/import). Rather than
  // re-deriving which specific patch fields matter, debounce one recompute
  // after the last journal write in a burst, so rapid clicks (task-status
  // cycles, core-step toggles) coalesce into a single background call instead
  // of one per click. Best-effort: failures are silent (see recompute.js).
  _scheduleRecompute(dateISO) {
    clearTimeout(this.recomputeTimer);
    this.recomputeTimer = setTimeout(() => {
      refreshComputed(this, dateISO);
    }, 4000);
  }

  async getDay(dateISO) {
    if (this.docs.has(dateISO)) return this.docs.get(dateISO).doc;
    const { json, sha } = await this.gh.getFile(journalPath(dateISO));
    this.exists.set(dateISO, json != null);
    const doc = json || { date: dateISO, dayOfWeek: "" };
    this.docs.set(dateISO, { doc, sha });
    return doc;
  }

  // Loads any dates in [fromISO, toISO] not already cached, in parallel. Used for
  // week/month stats and the insight lookback window.
  async loadRange(dates) {
    const missing = dates.filter((d) => !this.docs.has(d));
    await Promise.all(missing.map((d) => this.getDay(d)));
  }

  // Map<dateISO, doc> containing ONLY dates a real file exists for — the shape
  // derive.js's computeAll expects (it distinguishes "no file" from "file with an
  // empty day" via Map.has, the same way recompute.py's glob only sees real files).
  async loadJournalMap(dates) {
    await this.loadRange(dates);
    const m = new Map();
    for (const d of dates) {
      if (this.exists.get(d)) m.set(d, this.docs.get(d).doc);
    }
    return m;
  }

  // Walks backward day-by-day from `fromISO` fetching real files until it hits a
  // gap (a date with no file) or `maxDays` is reached — enough to resolve
  // recompute.py's unbounded journaling/habit streaks without guessing a fixed
  // window. Returns the same Map<dateISO, doc> shape as loadJournalMap.
  async loadBackToGap(fromISO, maxDays = 400) {
    const m = new Map();
    let d = fromISO;
    for (let i = 0; i < maxDays; i++) {
      const doc = await this.getDay(d);
      if (!this.exists.get(d)) break;
      m.set(d, doc);
      const prev = new Date(d + "T00:00:00Z");
      prev.setUTCDate(prev.getUTCDate() - 1);
      d = prev.toISOString().slice(0, 10);
    }
    return m;
  }

  async getState() {
    if (this.state) return this.state.doc;
    const { json, sha } = await this.gh.getFile(STATE_PATH);
    this.state = { doc: json || { meta: {}, currentMonth: {}, currentWeek: {} }, sha };
    return this.state.doc;
  }

  // Resolves true/false (never rejects) so fire-and-forget callers stay safe,
  // while a caller that wants real confirmation can `if (await store.saveX(...))`.
  // Errors are always reported via onFlash regardless of whether the caller checks.
  _write(path, getCache, setCache, message, immediate, debounceMs = 500) {
    clearTimeout(this.saveTimers.get(path));
    const doWrite = async () => {
      const cache = getCache();
      try {
        const { sha } = await this.gh.putFile(path, cache.doc, cache.sha, message);
        setCache({ ...cache, sha });
        return true;
      } catch (e) {
        this.onFlash(e instanceof GitHubStoreError ? e.message : "Couldn't save.", true);
        return false;
      }
    };
    if (immediate) return doWrite();
    this.saveTimers.set(path, setTimeout(doWrite, debounceMs));
  }

  // patch is deep-merged into the in-memory doc immediately (so the UI reflects it
  // synchronously); the network write is debounced unless immediate is passed.
  // Returns the write's promise so a caller that wants real confirmation (not
  // just the optimistic local update above) can await it. Callers that don't
  // care can ignore the return value — it also just works as fire-and-forget.
  saveDay(dateISO, patch, immediate, message) {
    const cur = this.docs.get(dateISO) || { doc: { date: dateISO, dayOfWeek: "" }, sha: null };
    const merged = deepMerge({ ...cur.doc }, patch);
    this.docs.set(dateISO, { doc: merged, sha: cur.sha });
    this._scheduleRecompute(dateISO);
    return this._write(
      journalPath(dateISO),
      () => this.docs.get(dateISO),
      (next) => this.docs.set(dateISO, next),
      message || `life-os: journal ${dateISO}`,
      immediate
    );
  }

  saveState(patch, immediate, message) {
    const cur = this.state || { doc: {}, sha: null };
    const merged = deepMerge({ ...cur.doc }, patch);
    merged.meta = {
      ...(merged.meta || {}),
      lastUpdated: new Date().toISOString().slice(0, 19),
      lastUpdatedBy: "lifeos-app",
    };
    this.state = { doc: merged, sha: cur.sha };
    return this._write(
      STATE_PATH,
      () => this.state,
      (next) => (this.state = next),
      message || "life-os: state update",
      immediate
    );
  }

  // Writes computed.json so validate.yml's staleness check stays green even though
  // nothing runs scripts/recompute.py in this flow anymore.
  async saveComputed(computedDoc) {
    const { json, sha } = await this.gh.getFile(COMPUTED_PATH);
    await this.gh.putFile(COMPUTED_PATH, computedDoc, sha, "life-os: recompute derived state");
  }

  // Signed-out privacy self-test: fetch a journal file's Contents API URL with no
  // auth and confirm 404. Uses a bare fetch, not this.gh (which always sends the
  // token), to actually test the unauthenticated case.
  async verifyPrivate(dateISO, repo) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(journalPath(dateISO))}`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    return res.status === 404;
  }
}
