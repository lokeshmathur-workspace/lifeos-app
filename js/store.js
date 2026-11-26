// The app's persistence layer: wraps GitHubStore with an in-memory doc cache,
// debounced writes, and deepMerge optimistic updates — the same shape as
// reference-app.html's saveDay/saveState/deepMerge, just backed by the GitHub
// Contents API instead of the artifact db capability.

import { GitHubStore, GitHubStoreError } from "./github.js";
import { refreshComputed } from "./recompute.js";
import { sundayOf, isoWeekNumber, monthName } from "./dateutil.js";

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
const weekPath = (weekOf) => `life-os/state/weeks/${weekOf}.json`;
const monthPath = (monthKey) => `life-os/state/months/${monthKey}.json`;
const COMPUTED_PATH = "life-os/state/computed.json";
const TASKS_PATH = "life-os/state/tasks.json";

const emptyTasksDoc = () => ({ tasks: [], outlook: { lastImport: "", ignored: [] } });
const STALE_MS = 5 * 60 * 1000; // a cached copy older than this is re-read before saving
const blankDay = (dateISO) => ({ date: dateISO, dayOfWeek: "" });
const blankWeek = (weekOf) => ({ weekNumber: isoWeekNumber(weekOf), weekOf, weekEnding: sundayOf(weekOf), keyFocus: "", tasks: [] });

function defaultMonthDoc(monthKey) {
  const [year, monthNum] = monthKey.split("-").map(Number);
  return {
    monthKey,
    month: monthName(year, monthNum).split(" ")[0],
    year,
    sprintTheme: "",
    oneThingToProtect: "",
    hphFocusHabit: "",
    intentions: [],
    keyDates: [],
    weeklyHPHAvgs: [],
  };
}

export class Store {
  constructor(cfg, onFlash) {
    this.gh = new GitHubStore(cfg);
    this.docs = new Map(); // dateISO -> { doc, sha }
    this.exists = new Map(); // dateISO -> boolean (a file was actually found, not a synthetic placeholder)
    this.weeks = new Map(); // weekOf (Monday) -> { doc, sha }
    this.months = new Map(); // monthKey ("YYYY-MM") -> { doc, sha }
    this.saveTimers = new Map(); // path -> timeout id
    this.pending = new Map(); // path -> merged patch not yet confirmed saved (re-applied on a conflict)
    this.onFlash = onFlash || (() => {});
    this.recomputeTimer = null;
    this.tasks = null; // { doc, sha } for the master task list
  }

  // The master task list (life-os/state/tasks.json) — every open task, whatever
  // it came from (morning picker, week board, Outlook import). Day and week
  // files reference these by id.
  async getTasks(force = false) {
    if (!force && this.tasks) return this.tasks.doc;
    const { json, sha } = await this.gh.getFile(TASKS_PATH);
    const doc = json || emptyTasksDoc();
    if (!doc.outlook) doc.outlook = { lastImport: "", ignored: [] };
    this.tasks = { doc, sha, at: Date.now() };
    return doc;
  }

  // Applies fn(doc) -> newDoc and writes it. Both devices edit this one file, so
  // on a sha conflict it re-reads and re-applies fn to the fresh copy once,
  // rather than overwriting the other device's change. Returns the new doc, or
  // null if the write failed (already reported via onFlash).
  // GitHub can also 409 a commit made seconds after another one to the same
  // branch even when the sha is right, so conflicts get up to 3 tries with a
  // short pause, each against a fresh read.
  async updateTasks(fn, message) {
    const waits = [0, 600, 1500];
    for (let attempt = 0; attempt < waits.length; attempt++) {
      if (waits[attempt]) await new Promise((r) => setTimeout(r, waits[attempt]));
      const cur = await this.getTasks(attempt > 0 || Date.now() - (this.tasks?.at || 0) > STALE_MS);
      const next = fn(structuredClone(cur));
      try {
        const { sha } = await this.gh.putFile(TASKS_PATH, next, this.tasks.sha, message || "life-os: tasks");
        this.tasks = { doc: next, sha, at: Date.now() };
        this.lastTasksError = "";
        this._scheduleRecompute(); // career actions and linked intentions follow task status
        return next;
      } catch (e) {
        this.lastTasksError =
          e instanceof GitHubStoreError ? (e.code === "conflict" ? "GitHub was busy with another save." : e.message) : "Couldn't reach GitHub.";
        if (e instanceof GitHubStoreError && e.code === "conflict" && attempt < waits.length - 1) continue;
        this.onFlash(e instanceof GitHubStoreError ? e.message : "Couldn't save your task list.", true);
        return null;
      }
    }
    return null;
  }

  // Every saveDay() (any journal-file write) can change what recompute.py
  // tracks — habit streaks, week/month HPH and core-step averages, top3
  // completion — not just the "big" saves (plan/evening/import). Rather than
  // re-deriving which specific patch fields matter, debounce one recompute
  // after the last journal write in a burst, so rapid clicks (task-status
  // cycles, core-step toggles) coalesce into a single background call instead
  // of one per click. Best-effort: failures are silent (see recompute.js).
  _scheduleRecompute(dateISO) {
    if (dateISO && (!this.recomputeDate || dateISO > this.recomputeDate)) this.recomputeDate = dateISO;
    clearTimeout(this.recomputeTimer);
    this.recomputeTimer = setTimeout(() => {
      const d = this.recomputeDate;
      this.recomputeDate = null;
      refreshComputed(this, d);
    }, 4000);
  }

  // Drops every cached file that has no unsaved change, so the next read fetches the
  // newest copy (and sha). Called when the app comes back into view: a Claude session,
  // a routine or the other device may have written meanwhile.
  invalidate() {
    const keep = (path) => this.saveTimers.has(path) || this.pending.has(path);
    for (const d of [...this.docs.keys()]) if (!keep(journalPath(d))) { this.docs.delete(d); this.exists.delete(d); }
    for (const w of [...this.weeks.keys()]) if (!keep(weekPath(w))) this.weeks.delete(w);
    for (const m of [...this.months.keys()]) if (!keep(monthPath(m))) this.months.delete(m);
    this.tasks = null;
  }

  // fn(doc) -> newDoc for a month file, against the newest copy (re-read and re-applied
  // on a conflict). Used where the change depends on what's there (recompute's
  // intention sync). Returns the new doc, or null if fn wrote nothing / the save failed.
  async updateMonth(monthKey, fn, message) {
    try {
      const cached = this.months.get(monthKey);
      const first = cached && !this.pending.has(monthPath(monthKey)) && Date.now() - (cached.at || 0) < STALE_MS ? { doc: cached.doc, sha: cached.sha } : null;
      let wrote = false;
      const res = await this.gh.updateJson(monthPath(monthKey), (d) => { const n = fn(d); wrote = !!n; return n; }, message, { blank: () => defaultMonthDoc(monthKey), first });
      if (res.doc) this.months.set(monthKey, { doc: res.doc, sha: res.sha, at: Date.now() });
      return wrote ? res.doc : null;
    } catch {
      return null;
    }
  }

  async getDay(dateISO) {
    if (this.docs.has(dateISO)) return this.docs.get(dateISO).doc;
    const { json, sha } = await this.gh.getFile(journalPath(dateISO));
    this.exists.set(dateISO, json != null);
    const doc = json || blankDay(dateISO);
    this.docs.set(dateISO, { doc, sha, at: Date.now() });
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

  // weekOf is always a Monday (dateutil.js's mondayOf). One file per week — see
  // life-os/docs/SCHEMA.md's state/weeks/YYYY-MM-DD.json section. A week that
  // doesn't have a file yet (not planned, or in the future) comes back as an
  // empty synthetic doc, same pattern as getDay's synthetic journal doc.
  async getWeek(weekOf) {
    if (this.weeks.has(weekOf)) return this.weeks.get(weekOf).doc;
    const { json, sha } = await this.gh.getFile(weekPath(weekOf));
    const doc = json || blankWeek(weekOf);
    this.weeks.set(weekOf, { doc, sha, at: Date.now() });
    return doc;
  }

  // Same deepMerge/debounce contract as saveDay. Never mutates a different week's
  // file — carry-forward and pull-ins write their tasks into the target week's own
  // patch before calling this.
  saveWeek(weekOf, patch, immediate, message) {
    const cur = this.weeks.get(weekOf) || { doc: blankWeek(weekOf), sha: null, at: 0 };
    const merged = deepMerge({ ...cur.doc }, patch);
    this.weeks.set(weekOf, { ...cur, doc: merged });
    return this._write(
      weekPath(weekOf),
      () => this.weeks.get(weekOf),
      (next) => this.weeks.set(weekOf, next),
      message || `life-os: week ${weekOf}`,
      immediate,
      patch,
      () => blankWeek(weekOf)
    );
  }

  // monthKey is always "YYYY-MM". One file per month — see life-os/docs/SCHEMA.md's
  // state/months/YYYY-MM.json section. A month with no file yet (not planned, or in
  // the future) comes back as an empty synthetic doc, same pattern as getWeek.
  async getMonth(monthKey) {
    if (this.months.has(monthKey)) return this.months.get(monthKey).doc;
    const { json, sha } = await this.gh.getFile(monthPath(monthKey));
    const doc = json || defaultMonthDoc(monthKey);
    this.months.set(monthKey, { doc, sha, at: Date.now() });
    return doc;
  }

  // Same deepMerge/debounce contract as saveWeek.
  saveMonth(monthKey, patch, immediate, message) {
    const cur = this.months.get(monthKey) || { doc: defaultMonthDoc(monthKey), sha: null, at: 0 };
    const merged = deepMerge({ ...cur.doc }, patch);
    this.months.set(monthKey, { ...cur, doc: merged });
    return this._write(
      monthPath(monthKey),
      () => this.months.get(monthKey),
      (next) => this.months.set(monthKey, next),
      message || `life-os: month ${monthKey}`,
      immediate,
      patch,
      () => defaultMonthDoc(monthKey)
    );
  }

  // Resolves true/false (never rejects) so fire-and-forget callers stay safe,
  // while a caller that wants real confirmation can `if (await store.saveX(...))`.
  // Errors are always reported via onFlash regardless of whether the caller checks.
  //
  // Conflict-safe: every patch since the last confirmed save is kept (this.pending). If
  // the cached copy is older than 5 minutes, or GitHub rejects the write because the
  // file changed (another device, a Claude session, a routine), the newest copy is
  // re-read, the pending patch is re-applied on top (field-level, like deepMerge), and
  // the write is retried — up to 3 tries.
  _write(path, getCache, setCache, message, immediate, patch = {}, blank = () => ({}), debounceMs = 500) {
    clearTimeout(this.saveTimers.get(path));
    this.saveTimers.delete(path);
    this.pending.set(path, deepMerge(this.pending.get(path) || {}, structuredClone(patch)));
    const doWrite = async () => {
      this.saveTimers.delete(path);
      const sent = this.pending.get(path);
      const waits = [0, 600, 1500];
      for (let attempt = 0; attempt < waits.length; attempt++) {
        if (waits[attempt]) await new Promise((r) => setTimeout(r, waits[attempt]));
        let cache = getCache();
        try {
          if (attempt > 0 || !cache.at || Date.now() - cache.at > STALE_MS) {
            const { json, sha } = await this.gh.getFile(path);
            cache = { doc: deepMerge(structuredClone(json || blank()), structuredClone(this.pending.get(path) || sent || {})), sha, at: Date.now() };
            setCache(cache);
          }
          const { sha } = await this.gh.putFile(path, cache.doc, cache.sha, message);
          setCache({ ...getCache(), sha, at: Date.now() });
          if (this.pending.get(path) === sent) this.pending.delete(path);
          return true;
        } catch (e) {
          if (e instanceof GitHubStoreError && e.code === "conflict" && attempt < waits.length - 1) continue;
          this.onFlash(e instanceof GitHubStoreError ? e.message : "Couldn't save.", true);
          return false;
        }
      }
      return false;
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
    const cur = this.docs.get(dateISO) || { doc: blankDay(dateISO), sha: null, at: 0 };
    const merged = deepMerge({ ...cur.doc }, patch);
    this.docs.set(dateISO, { ...cur, doc: merged });
    this._scheduleRecompute(dateISO);
    return this._write(
      journalPath(dateISO),
      () => this.docs.get(dateISO),
      (next) => this.docs.set(dateISO, next),
      message || `life-os: journal ${dateISO}`,
      immediate,
      patch,
      () => blankDay(dateISO)
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
