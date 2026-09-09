// GitHub Contents API client. Talks only to the private data repo (owner/repo held
// in localStorage, entered on first run) — the app repo this file ships from is a
// separate, public repo and never touches journal data.
//
// Every write carries the sha it read, so a concurrent write from another tab/device
// is rejected (409/422) rather than silently overwritten — see putFile().

import { compact } from "./compact.js";

const API = "https://api.github.com";

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubStoreError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code; // "not_found" | "conflict" | "auth" | "rate_limited" | "network" | "unknown"
    this.status = status;
  }
}

export class GitHubStore {
  constructor({ token, repo, branch = "main" }) {
    this.token = token;
    this.repo = repo; // "owner/name"
    this.branch = branch;
  }

  async _request(path, opts = {}) {
    let res;
    try {
      res = await fetch(`${API}/repos/${this.repo}/${path}`, {
        ...opts,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(opts.headers || {}),
        },
      });
    } catch (e) {
      throw new GitHubStoreError("Network error reaching GitHub.", "network");
    }
    if (res.status === 401 || res.status === 403) {
      throw new GitHubStoreError(
        "GitHub rejected the token — it may be expired or scoped wrong.",
        "auth",
        res.status
      );
    }
    if (res.status === 429) {
      throw new GitHubStoreError("Rate limited by GitHub.", "rate_limited", 429);
    }
    return res;
  }

  // Returns { json, sha } for an existing file, or { json: null, sha: null } on 404.
  // A signed-out/unauthenticated GET against a private repo also 404s — that's the
  // acceptance test for "the journal is never publicly reachable."
  async getFile(path) {
    const res = await this._request(
      `contents/${encodeURIComponent(path)}?ref=${this.branch}`
    );
    if (res.status === 404) return { json: null, sha: null };
    if (!res.ok) {
      throw new GitHubStoreError(`Couldn't read ${path} (${res.status}).`, "unknown", res.status);
    }
    const body = await res.json();
    const text = base64ToUtf8(body.content);
    return { json: JSON.parse(text), sha: body.sha };
  }

  // Full recursive file listing for the branch — used to find every journal file
  // for the backup export without walking year folders one by one.
  async listTree() {
    const ref = await this._request(`git/refs/heads/${this.branch}`);
    if (!ref.ok) throw new GitHubStoreError("Couldn't read branch ref.", "unknown", ref.status);
    const { object } = await ref.json();
    const tree = await this._request(`git/trees/${object.sha}?recursive=1`);
    if (!tree.ok) throw new GitHubStoreError("Couldn't list repo tree.", "unknown", tree.status);
    const { tree: entries } = await tree.json();
    return entries; // [{ path, type: "blob"|"tree", sha, ... }]
  }

  // Fetches a blob directly by sha (from listTree()) — one call per file, no
  // second contents-API round trip to resolve the sha first.
  async getBlob(sha) {
    const res = await this._request(`git/blobs/${sha}`);
    if (!res.ok) throw new GitHubStoreError(`Couldn't read blob ${sha}.`, "unknown", res.status);
    const body = await res.json();
    return JSON.parse(base64ToUtf8(body.content));
  }

  // sha: the sha getFile() returned, or null to create a new file. Rejects (409/422)
  // if the file changed since that sha was read.
  async putFile(path, doc, sha, message) {
    const content = utf8ToBase64(compact(doc) + "\n");
    const res = await this._request(`contents/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content,
        branch: this.branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) {
      throw new GitHubStoreError(
        "Couldn't save — someone or something else changed this. Your text is still on screen.",
        "conflict",
        res.status
      );
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new GitHubStoreError(
        `Couldn't save — your text is still on screen. (${body.message || res.status})`,
        "unknown",
        res.status
      );
    }
    const body = await res.json();
    return { sha: body.content.sha };
  }
}
