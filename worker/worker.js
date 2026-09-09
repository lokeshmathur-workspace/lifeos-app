// Life OS AI proxy — a Cloudflare Worker that holds the Anthropic API key as a
// server-side secret and forwards prompts from the app. The key never reaches the
// browser, localStorage, or the repo (see lifeos-app's Phase B architecture note
// on AI features / security cost).
//
// The Worker's URL is public by default, so every request must carry the shared
// secret (X-Life-Os-Secret) the app also stores locally — without it this would be
// an open relay against your Anthropic billing. Rotate ANTHROPIC_API_KEY or
// WORKER_SHARED_SECRET any time by re-running `wrangler secret put`; nothing else
// needs to change.
//
// Request body: { prompt: string, mode: "json" | "text", modelTier: "default" | "complex" }
// - mode "json": returns { ok: true, data: <parsed JSON> } — used for the quote
//   pick / evening / week / month drafts, which all ask Claude to reply with only
//   a JSON object.
// - mode "text": returns { ok: true, text: <string> } — used for the 28-day
//   insight, which is free-form prose.
// On failure: { ok: false, code: "not_granted" | "rate_limited" | "invalid_json" | "unknown", message }

const MODELS = {
  default: "claude-haiku-4-5-20251001",
  complex: "claude-sonnet-5",
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Life-Os-Secret",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (request.method !== "POST") {
      return json({ ok: false, code: "unknown", message: "POST only." }, 405, origin);
    }

    const secret = request.headers.get("X-Life-Os-Secret");
    if (!secret || secret !== env.WORKER_SHARED_SECRET) {
      return json({ ok: false, code: "not_granted", message: "Missing or wrong shared secret." }, 401, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, code: "unknown", message: "Bad request body." }, 400, origin);
    }

    const { prompt, mode = "text", modelTier = "default" } = body || {};
    if (!prompt || typeof prompt !== "string") {
      return json({ ok: false, code: "unknown", message: "Missing prompt." }, 400, origin);
    }
    const model = MODELS[modelTier] || MODELS.default;

    const system =
      mode === "json"
        ? "Reply with only a single valid JSON object matching the shape requested in the prompt. No markdown fences, no commentary before or after it."
        : "Reply with only the requested prose. No markdown headings, no preamble, no meta-commentary about the task.";

    let res;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: mode === "json" ? 1500 : 900,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch {
      return json({ ok: false, code: "unknown", message: "Couldn't reach Anthropic." }, 502, origin);
    }

    if (res.status === 429) {
      return json({ ok: false, code: "rate_limited", message: "Rate limited." }, 429, origin);
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return json({ ok: false, code: "unknown", message: `Anthropic error (${res.status}): ${errBody.slice(0, 300)}` }, 502, origin);
    }

    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || "").join("");

    if (mode === "json") {
      try {
        // Claude sometimes wraps JSON in a fenced block despite instructions; strip it defensively.
        const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        const parsed = JSON.parse(cleaned);
        return json({ ok: true, data: parsed }, 200, origin);
      } catch {
        return json({ ok: false, code: "invalid_json", message: "Model reply wasn't valid JSON." }, 502, origin);
      }
    }
    return json({ ok: true, text }, 200, origin);
  },
};
