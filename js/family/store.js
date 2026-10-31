// The Family tab's persistence: the private Family repo through the shared GitHubStore, with the
// same token as the rest of the app (Lokesh's devices) or a token for Family + Navya only
// (Archana's devices). Every write is a read-modify-write that retries once against a fresh read
// on a sha conflict, so the two of them saving at the same time never overwrite each other.
// It also reads a short summary of Navya's dashboard (read-only) for the Kids section.
import { GitHubStore, GitHubStoreError } from "../github.js";
import { DEFAULT_NAVYA_REPO } from "../navya/store.js";

export const FAMILY_REPO_KEY = "family.repo";
export const DEFAULT_FAMILY_REPO = "lokeshmathur-workspace/Family";

export function familyRepo(cfg) {
  if (cfg?.partner) return cfg.repo;
  try { return localStorage.getItem(FAMILY_REPO_KEY) || DEFAULT_FAMILY_REPO; } catch { return DEFAULT_FAMILY_REPO; }
}

// Files the tab reads on open, with their defaults when missing.
export const FILES = {
  config: ["config.json", { people: [{ id: "lokesh", name: "Lokesh" }, { id: "archana", name: "Archana" }], kids: [], finance: { watch: [] } }],
  money: ["finance/monarch.json", null],
  health: ["health.json", { entries: [] }],
  nutrition: ["nutrition.json", { meals: {} }],
  rel: ["relationships.json", { goals: [], learnings: [], together: [], people: [], appreciation: [] }],
  kids: ["kids.json", {}],
  home: ["home.json", { todos: [], chores: [], appointments: [] }],
  growth: ["growth.json", { items: [] }],
};

export class FamilyStore {
  constructor(cfg, onFlash) {
    this.repo = familyRepo(cfg);
    this.gh = new GitHubStore({ token: cfg.token, repo: this.repo, branch: "main" });
    this.navyaGh = new GitHubStore({ token: cfg.token, repo: (() => { try { return localStorage.getItem("navya.repo") || DEFAULT_NAVYA_REPO; } catch { return DEFAULT_NAVYA_REPO; } })(), branch: "main" });
    // Lokesh's Learning library (Claude repo), read-only, for picking what to share in Growth.
    // Never on Archana's devices: her token can't open that repo, and nothing is copied from it
    // except the one idea he chooses and edits.
    this.learnGh = cfg.partner || cfg.family ? null : new GitHubStore({ token: cfg.token, repo: cfg.repo, branch: "main" });
    this.onFlash = onFlash || (() => {});
    this.docs = {};            // key -> { doc, sha }
    this.reviews = new Map();  // weekStart -> { doc, sha }
    this.navya = null;         // { computed, coach } or null if Navya's repo isn't reachable
  }

  async _get(path, dflt) {
    const { json, sha } = await this.gh.getFile(path);
    return { doc: json ?? structuredClone(dflt), sha };
  }

  async loadAll() {
    let tree;
    try { tree = await this.gh.listTree(); }
    catch (e) {
      if (e instanceof GitHubStoreError && (e.code === "auth" || e.status === 404 || e.status === 403 || e.code === "unknown"))
        throw new GitHubStoreError("This device's GitHub token can't see the Family repo yet.", "no_access", e.status);
      throw e;
    }
    const keys = Object.keys(FILES);
    const got = await Promise.all(keys.map((k) => this._get(FILES[k][0], FILES[k][1])));
    keys.forEach((k, i) => (this.docs[k] = got[i]));
    const rv = tree.filter((e) => e.type === "blob" && /^review\/\d{4}-\d{2}-\d{2}\.json$/.test(e.path)).map((e) => e.path).sort().slice(-12);
    const rvDocs = await Promise.all(rv.map((p) => this._get(p, null)));
    rv.forEach((p, i) => rvDocs[i].doc && this.reviews.set(p.slice(7, 17), rvDocs[i]));
    this.navya = await this._navyaSummary();
    return this.data();
  }

  // Navya's computed numbers and newest approved coach's read; null if her repo isn't reachable.
  async _navyaSummary() {
    try {
      const [tree, computed] = await Promise.all([this.navyaGh.listTree(), this.navyaGh.getFile("computed.json")]);
      const coachPaths = tree.filter((e) => /^coach\/\d{4}-\d{2}-\d{2}\.json$/.test(e.path)).map((e) => e.path).sort().reverse().slice(0, 3);
      let coach = null;
      for (const p of coachPaths) { const { json } = await this.navyaGh.getFile(p); if (json?.status === "approved") { coach = json; break; } }
      return { computed: computed.json, coach };
    } catch { return null; }
  }

  // Learning sources to pick from: [{id, title, author, type}], newest first; [] if unavailable.
  async learningSources() {
    if (!this.learnGh) return [];
    try {
      const [idx, lib] = await Promise.all([this.learnGh.getFile("learning/sources/index.json"), this.learnGh.getFile("learning/library.json")]);
      const seen = new Set(), out = [];
      for (const s of [...(idx.json?.sources || [])].sort((a, b) => ((b.updatedAt || "") > (a.updatedAt || "") ? 1 : -1))) { seen.add(s.id); out.push({ id: s.id, title: s.title, author: s.author, type: s.type }); }
      for (const b of lib.json?.briefs || []) if (!seen.has(b.id)) out.push({ id: b.id, title: b.title, author: b.author, type: b.type, brief: true });
      return out;
    } catch { return []; }
  }

  // The pieces of one source he can pick from: principles (briefs), insights, his own thoughts, highlights.
  async learningSnippets(src) {
    if (!this.learnGh) return [];
    const out = [];
    try {
      const lib = (await this.learnGh.getFile("learning/library.json")).json;
      const brief = (lib?.briefs || []).find((b) => b.id === src.id);
      for (const p of brief?.principles || []) out.push({ kind: "Principle", text: p.explanation ? `${p.title}: ${p.explanation}` : p.title });
      const meta = (await this.learnGh.getFile(`learning/sources/${src.id}/meta.json`).catch(() => ({ json: null }))).json;
      const caps = await Promise.all((meta?.captures || []).map((c) => this.learnGh.getFile(`learning/sources/${src.id}/${typeof c === "string" ? c : c.id}.json`).then((r) => r.json).catch(() => null)));
      for (const c of caps.filter(Boolean)) {
        const page = c.pageRef || c.pages?.[0]?.page;
        if (c.thought) out.push({ kind: "My thought", text: c.thought, page });
        for (const h of c.highlights || []) out.push({ kind: "Highlight", text: typeof h === "string" ? h : h.text || "", page });
        for (const p of c.insights?.points || []) out.push({ kind: "Insight", text: p, page });
      }
    } catch {}
    return out.filter((x) => x.text);
  }

  data() {
    const d = Object.fromEntries(Object.entries(this.docs).map(([k, v]) => [k, v.doc]));
    d.reviews = [...this.reviews.values()].map((v) => v.doc).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    d.navya = this.navya;
    return d;
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
    if (path.startsWith("review/")) return this.reviews.get(path.slice(7, 17));
    return null;
  }

  _remember(path, v) {
    const k = Object.keys(FILES).find((x) => FILES[x][0] === path);
    if (k) this.docs[k] = v;
    else if (path.startsWith("review/")) this.reviews.set(path.slice(7, 17), v);
  }
}
