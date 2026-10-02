// The Navya tab's persistence: the private Navya repo through the shared GitHubStore, with the
// same token as the rest of the app (or, in family mode, the only token on the device).
// Every write is a read-modify-write that retries once against a fresh read on a sha conflict,
// so a tracker save or a routine merge landing in between never gets silently overwritten.
import { GitHubStore, GitHubStoreError } from "../github.js";
import { computeNavya } from "./compute.js";
import { todayISO } from "../dateutil.js";

export const NAVYA_REPO_KEY = "navya.repo";
export const DEFAULT_NAVYA_REPO = "lokeshmathur-workspace/Navya";

export function navyaRepo(cfg) {
  if (cfg?.family) return cfg.repo;
  try { return localStorage.getItem(NAVYA_REPO_KEY) || DEFAULT_NAVYA_REPO; } catch { return DEFAULT_NAVYA_REPO; }
}

// Files the tab reads on open. `list` ones default to [] and objects to null when missing.
export const FILES = {
  codes: ["school/codes.json", null], goals: ["goals.json", null], classes: ["academics/classes.json", []],
  grades: ["academics/grades.json", []], assignments: ["academics/assignments.json", []],
  attendance: ["academics/attendance.json", null], gpa: ["academics/gpa.json", null],
  screentime: ["phone/screentime.json", []], vb: ["navya_data.json", {}], computed: ["computed.json", null],
};

export class NavyaStore {
  constructor(cfg, onFlash) {
    this.gh = new GitHubStore({ token: cfg.token, repo: navyaRepo(cfg), branch: "main" });
    this.repo = navyaRepo(cfg);
    this.onFlash = onFlash || (() => {});
    this.docs = {}; // key -> { doc, sha }
    this.checkins = new Map(); // date -> { doc, sha }
    this.coach = new Map(); // weekStart -> { doc, sha }
    this.tree = null;
  }

  async _get(path, dflt) {
    const { json, sha } = await this.gh.getFile(path);
    return { doc: json ?? structuredClone(dflt), sha };
  }

  // Loads every data file in parallel, plus check-ins and coach reads listed from the tree.
  async loadAll() {
    const keys = Object.keys(FILES);
    const got = await Promise.all(keys.map((k) => this._get(FILES[k][0], FILES[k][1])));
    keys.forEach((k, i) => (this.docs[k] = got[i]));
    this.tree = await this.gh.listTree();
    const dated = (dir) => this.tree.filter((e) => e.type === "blob" && new RegExp(`^${dir}/\\d{4}-\\d{2}-\\d{2}\\.json$`).test(e.path));
    const ci = dated("checkins").map((e) => e.path).sort().slice(-60);
    const co = dated("coach").map((e) => e.path).sort().slice(-8);
    const [ciDocs, coDocs] = await Promise.all([Promise.all(ci.map((p) => this._get(p, null))), Promise.all(co.map((p) => this._get(p, null)))]);
    ci.forEach((p, i) => ciDocs[i].doc && this.checkins.set(p.slice(9, 19), ciDocs[i]));
    co.forEach((p, i) => coDocs[i].doc && this.coach.set(p.slice(6, 16), coDocs[i]));
    return this.data();
  }

  data() {
    const d = Object.fromEntries(Object.entries(this.docs).map(([k, v]) => [k, v.doc]));
    d.checkins = [...this.checkins.values()].map((v) => v.doc);
    d.coach = [...this.coach.values()].map((v) => v.doc).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    return d;
  }

  inboxBatches() {
    return (this.tree || []).filter((e) => /^inbox\/[^/]+\/batch\.json$/.test(e.path)).map((e) => e.path.split("/")[1]).sort().reverse();
  }

  // Read-modify-write with one retry from a fresh read. mutate(doc) returns the new doc.
  async update(path, dflt, mutate, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = attempt === 0 && this._cached(path) ? this._cached(path) : await this._get(path, dflt);
      const doc = mutate(structuredClone(cur.doc));
      try {
        const { sha } = await this.gh.putFile(path, doc, cur.sha, message);
        this._remember(path, { doc, sha });
        return doc;
      } catch (e) {
        if (e instanceof GitHubStoreError && e.code === "conflict" && attempt === 0) continue;
        throw e;
      }
    }
  }

  _cached(path) {
    const k = Object.keys(FILES).find((x) => FILES[x][0] === path);
    if (k) return this.docs[k];
    if (path.startsWith("checkins/")) return this.checkins.get(path.slice(9, 19));
    if (path.startsWith("coach/")) return this.coach.get(path.slice(6, 16));
    return null;
  }

  _remember(path, v) {
    const k = Object.keys(FILES).find((x) => FILES[x][0] === path);
    if (k) this.docs[k] = v;
    else if (path.startsWith("checkins/")) this.checkins.set(path.slice(9, 19), v);
    else if (path.startsWith("coach/")) this.coach.set(path.slice(6, 16), v);
  }

  // Recomputes from what's loaded and writes computed.json (the coach routine reads it).
  async recompute() {
    const out = computeNavya(this.data(), todayISO());
    try {
      await this.update("computed.json", null, () => out, "navya: recompute");
    } catch (e) {
      this.onFlash("Saved, but couldn't refresh the summary numbers. They'll catch up on the next save.", true);
    }
    return out;
  }

  // ── screenshot batches ──
  async uploadBatch(batchId, files, by) {
    const done = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i], ext = f.type === "image/png" ? "png" : "jpg", name = `${String(i + 1).padStart(2, "0")}.${ext}`;
        await this.gh.putBinaryFile(`inbox/${batchId}/${name}`, f.blob, null, `navya: snip ${batchId}/${name}`);
        done.push({ name, sha256: f.sha256 });
      }
      const batch = { id: batchId, createdAt: new Date().toISOString(), by: by || "", files: done, status: "pending" };
      await this.gh.putFile(`inbox/${batchId}/batch.json`, batch, null, `navya: new batch ${batchId}`);
      return batch;
    } catch (e) {
      // all-or-nothing: remove whatever made it up
      for (const d of done) {
        try { const sha = await this.gh.getSha(`inbox/${batchId}/${d.name}`); if (sha) await this.gh.deleteFile(`inbox/${batchId}/${d.name}`, sha, "navya: undo partial upload"); } catch {}
      }
      throw e;
    }
  }

  async getBatch(batchId) {
    const b = await this.gh.getFile(`inbox/${batchId}/batch.json`);
    const r = b.json?.status === "needs_review" ? await this.gh.getFile(`inbox/${batchId}/result.json`) : { json: null };
    return { batch: b.json, result: r.json };
  }

  // Removes the batch folder's remaining files once its rows are saved (or it's discarded).
  async clearBatch(batchId) {
    const files = (this.tree = await this.gh.listTree()).filter((e) => e.type === "blob" && e.path.startsWith(`inbox/${batchId}/`));
    for (const f of files) await this.gh.deleteFile(f.path, f.sha, `navya: clear batch ${batchId}`);
    this.tree = this.tree.filter((e) => !e.path.startsWith(`inbox/${batchId}/`));
  }
}
