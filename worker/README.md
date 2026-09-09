# Life OS AI proxy — deploy steps

This is the server-side piece that lets the app's AI features (quote pick, evening
draft, 28-day insight, week/month drafts) work without ever putting your Anthropic
API key in the browser. It's a small Cloudflare Worker — free tier covers this
easily, and deploy takes a few minutes.

## 1. Get an Anthropic API key

If you don't already have one: https://console.anthropic.com/ → Settings → API
Keys → Create Key. Copy it somewhere safe for step 4.

## 2. Install Wrangler (Cloudflare's CLI)

```
npm install -g wrangler
wrangler login          # opens a browser to authorize; creates a free Cloudflare
                         # account for you if you don't have one
```

## 3. Deploy the Worker

From this `worker/` folder:

```
wrangler deploy
```

This publishes `worker.js` and prints a URL like
`https://lifeos-ai-proxy.<your-subdomain>.workers.dev` — that's the URL the app
needs (step 5).

## 4. Set the two secrets

```
wrangler secret put ANTHROPIC_API_KEY
# paste the key from step 1 when prompted

wrangler secret put WORKER_SHARED_SECRET
# paste any random string, e.g. generate one with:
#   node -e "console.log(crypto.randomUUID())"
```

The shared secret keeps the Worker from being an open relay against your billing —
anyone who finds the URL but not this secret gets rejected. Keep it as secret as
the API key itself.

## 5. Wire it into the app

Open the app → Settings → paste the Worker URL and the shared secret from step 4.
That's it — AI features switch on; every one of them keeps working without this
too (manual entry), so there's no rush.

## Rotating or turning it off

- **Rotate either secret:** re-run the matching `wrangler secret put` command,
  then update the value in the app's Settings.
- **Turn AI off entirely:** `wrangler delete` removes the Worker, or just clear
  the URL/secret from the app's Settings — everything else keeps working.

## Cost

Cloudflare Workers' free tier (100,000 requests/day) covers this with enormous
headroom for one person's daily use. The real cost is Anthropic API usage — at
roughly half a dozen short/medium completions a day this should run low
single-digit dollars a month. Check current usage/billing any time at
https://console.anthropic.com/settings/billing.
