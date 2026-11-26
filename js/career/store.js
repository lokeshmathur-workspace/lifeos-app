// The Career tab's persistence: career/state/*.json and the newest career/radar/*.md in the
// Claude repo, through the same GitHub token as Life OS. Shapes and who may write what:
// career/docs/SCHEMA.md. Every write is read → change → write against the newest copy,
// re-applied on a conflict (a career session or routine may have written meanwhile).
import { localStamp } from "../dateutil.js";

export const CAREER_FILES = {
  plan: "career/state/plan.json",
  proposals: "career/state/proposals.json",
  metrics: "career/state/metrics.json",
  relationships: "career/state/relationships.json",
  impact: "career/state/impact-log.json",
};
const RADAR = /^career\/radar\/(\d{4}-\d{2}-\d{2})\.md$/;

export class CareerStore {
  constructor(gh) {
    this.gh = gh; // the Life OS Store's GitHubStore (Claude repo)
    this.cache = null; // { plan, proposals, metrics, relationships, impact, radar, at }
    this.shas = {};
  }

  invalidate() {
    this.cache = null;
    this.planOnly = null;
  }

  async load(force = false) {
    if (this.cache && !force) return this.cache;
    const keys = Object.keys(CAREER_FILES);
    const files = await Promise.all(keys.map((k) => this.gh.getFile(CAREER_FILES[k]).catch(() => ({ json: null, sha: null }))));
    const out = { at: Date.now(), radar: null };
    keys.forEach((k, i) => { out[k] = files[i].json; this.shas[k] = files[i].sha; });
    try {
      const tree = await this.gh.listTree();
      const newest = tree.map((e) => e.path.match(RADAR)).filter(Boolean).sort((a, b) => (a[1] < b[1] ? 1 : -1))[0];
      if (newest) out.radar = { date: newest[1], path: newest[0], text: await this.gh.getText(newest[0]) };
    } catch {
      /* radar is optional */
    }
    this.cache = out;
    return out;
  }

  // Just plan.json (the Month and Week planners' "From your career plan"); null without one.
  async loadPlan() {
    if (this.cache) return this.cache.plan;
    if (this.planOnly && Date.now() - this.planOnly.at < 5 * 60 * 1000) return this.planOnly.doc;
    const { json, sha } = await this.gh.getFile(CAREER_FILES.plan).catch(() => ({ json: null, sha: null }));
    this.planOnly = { doc: json, at: Date.now() };
    this.shas.plan = sha;
    return json;
  }

  // fn(doc) -> newDoc (or null for no change), against the newest copy. Sets meta.
  // Returns the saved doc (or the current one when fn changed nothing).
  async update(key, fn, message) {
    const cached = this.cache?.[key] && this.shas[key] && Date.now() - this.cache.at < 5 * 60 * 1000
      ? { doc: this.cache[key], sha: this.shas[key] } : null;
    const res = await this.gh.updateJson(CAREER_FILES[key], (d) => {
      const n = fn(d);
      if (n) n.meta = { ...(n.meta || {}), lastUpdated: localStamp(), lastUpdatedBy: "life-os app" };
      return n;
    }, message, { blank: () => null, first: cached });
    if (this.cache) this.cache[key] = res.doc;
    if (key === "plan") this.planOnly = { doc: res.doc, at: Date.now() };
    this.shas[key] = res.sha;
    return res.doc;
  }

  // recompute.js wrote plan.json: keep the cached copy in step.
  setPlan({ doc, sha }) {
    if (this.cache && doc) this.cache.plan = doc;
    if (doc) this.planOnly = { doc, at: Date.now() };
    if (sha) this.shas.plan = sha;
  }
}
