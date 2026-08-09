# Autonomous AI Persona

An autonomous AI/technology persona that discovers topics, applies editorial
judgment, writes in a consistent voice, remembers past posts, and publishes
over time — with **zero human input after a single initialization call**.

The persona's actual identity (name + domain) comes from whatever is
submitted at `POST /api/agent/init`, per the spec — see "Persona identity"
below. **Kai Renn / AI Security** is the built-in default used when no
override is submitted, and the specialization the project's editorial
judgment/keyword-scoring logic is hand-tuned for.

A homepage at `/` shows the persona's live feed, pipeline, and specs for
anyone visiting the deployed URL directly — see "Homepage / UI" below.

Built for [hackathon name] — see `PROJECT_HANDOFF.md` / `prompt.md` for full
project context, architecture, and requirements.

## How it works

```
GitHub Actions (every 2h) ──▶ GET /api/cron/cycle
Vercel Cron (once/day backup) ──┘
                                   │
                                   ▼
                   ┌────────────────────────────────────────┐
                   │   src/scheduler/cycle.js                 │
                   │                                            │
                   │  1. discovery.js — multi-source:
                   │       Hacker News + RSS (arXiv cs.CR,
                   │       The Hacker News, Krebs, Schneier)
                   │  2. scoring.js — cheap heuristic filter/rank
                   │       (source quality, recency, security
                   │       relevance, technical depth) — bounds
                   │       how many candidates cost a Gemini call
                   │  3. editorialJudge.js — LLM judgment + a
                   │       specific editorial "angle" per topic
                   │  4. memory.js — drop near-duplicates of past
                   │       posts (LLM similarity check)
                   │  5. writer.js — write the post, given the
                   │       angle + recent-post context, with
                   │       explicit anti-fabrication guardrails
                   │  6. kvRepository.js — persist to Vercel KV
                   └────────────────────────────────────────┘

Evaluator ──▶ POST /api/agent/init          (called once)
Evaluator ──▶ GET  /api/agent/feed?agentId  (polled repeatedly)
```

Only **one post is published per cron cycle**, even if multiple topics pass
judgment + memory checks — this keeps publishing spread out over the
evaluation window rather than front-loaded.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get a Gemini API key

Create one at [Google AI Studio](https://aistudio.google.com/apikey) — free tier is available.

### 3. Set up Vercel KV

1. Create a [Vercel](https://vercel.com) account if you don't have one.
2. Create a new project (can be linked to this repo, or done later at deploy time).
3. In the project's **Storage** tab, click **Create Database → KV**.
4. Once created, Vercel shows the `KV_REST_API_URL` / `KV_REST_API_TOKEN` /
   `KV_REST_API_READ_ONLY_TOKEN` values — copy these.

### 4. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env` with your Gemini key and Vercel KV credentials from steps 2–3.
Leave `CRON_SECRET` blank for local dev (see `.env.example` comments) or set
any random string — you'll set the real value in Vercel's dashboard at deploy
time (step 6).

### 5. Run locally

```bash
npm run dev
```

Server starts on `http://localhost:3000`. Sanity-check with:

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/agent/init \
  -H "Content-Type: application/json" \
  -d '{"persona":{"name":"Kai","domain":"AI Security"}}'
curl "http://localhost:3000/api/agent/feed?agentId=<id-from-above>"
```

The feed will be empty (`{"posts":[]}`) until a cycle runs. Trigger one
manually in local dev:

```bash
curl http://localhost:3000/api/cron/cycle
```

### 6. Deploy to Vercel

For a full step-by-step walkthrough (Vercel project setup, KV provisioning,
env vars, the cron plan decision, and post-deploy smoke testing), see
[`DEPLOY.md`](./DEPLOY.md).

Quick version:

```bash
npm i -g vercel   # if not already installed
vercel
```

Then in the Vercel dashboard, under **Settings → Environment Variables**, set
all the same variables from your `.env` (production values), including a
real random `CRON_SECRET`. Redeploy after adding env vars so they take
effect.

**⚠️ Before you rely on the cron schedule, read the note below** — it
affects whether posts actually publish "over time" during evaluation.

## ⚠️ Important: this project is configured for Vercel Hobby + GitHub Actions

The real publishing cadence comes from **`.github/workflows/trigger-cycle.yml`**
(every 2 hours, 12 runs/day), **not** from Vercel's own cron. `vercel.json`
is set to a harmless once-daily schedule (`"0 0 * * *"`) — the minimum
Vercel Hobby allows — as a backup trigger, since Hobby **refuses to deploy
outright** (not just throttle) any cron expression faster than once/day.

If you'd rather use Vercel's own cron directly (e.g. on a Pro plan or trial),
change `vercel.json`'s schedule back to something like `"0 */2 * * *"` and
you can stop relying on the GitHub Actions workflow — but as configured
right now, **GitHub Actions is the trigger doing the real work**. Setup
steps for the two repo secrets it needs (`AGENT_BASE_URL`, `CRON_SECRET`)
are in `DEPLOY.md` step 5.

Two separate constraints shaped the every-2-hours number specifically —
not just Vercel's plan limit, but also Gemini's own quota:

**1. Vercel Cron plan limits.** Confirmed — Hobby fails deployment outright
on any cron faster than once/day, which is why the real cadence had to move
to GitHub Actions instead of `vercel.json`.

**2. Gemini API free-tier quota.** Discovery now pulls from multiple
sources (Hacker News + 4 RSS feeds), producing a larger raw candidate pool
than before — but `scoring.js` filters and ranks that pool with cheap,
non-LLM heuristics first, and only the top `JUDGE_TOP_N` (default 8, see
`.env.example`) ever reach the Gemini judge. So each cycle still makes up
to ~8-10 Gemini calls in the worst case (one judge call per surviving
candidate, plus a memory check and a writer call), not one call per raw
candidate. Google no longer publishes one fixed daily-request number; it's
project-specific and shown live in [AI Studio](https://aistudio.google.com).
Third-party trackers report free-tier Flash models somewhere in the
**~250 to ~1,500 requests/day** range depending on when you read them, so
**every-2-hours (12 cycles × ~10 calls worst case ≈ 120 calls/day)** is
sized to stay comfortably under even the more conservative end of that
range with headroom. **Check your own project's live quota in AI Studio
and tighten or loosen the GitHub Actions schedule accordingly** — don't
take the 250–1,500 figures as guaranteed.

Also note: as of April 2026, **Gemini 2.5 Pro requires billing** — the free
tier only covers Flash/Flash-Lite. Both `GEMINI_MODEL_JUDGE` and
`GEMINI_MODEL_WRITER` default to `gemini-2.5-flash` for this reason (see
`.env.example`). If you enable billing, you can point the writer at a
Pro-tier model for better prose via the env var.

A related throttle, `GEMINI_JUDGE_DELAY_MS` (default 4500ms), spaces out
judge calls *within* a single cycle so a burst of candidates doesn't trip
the free tier's requests-per-minute cap either — Google doesn't publish a
stable RPM number anymore, so this default is a conservative guess, not a
guarantee. Adjust it (or `JUDGE_TOP_N`) if you're seeing 429 errors in
the logs, or loosen both if your project's actual AI Studio quota has more
room than assumed here.

This is a known, actively-managed constraint, not something quietly
assumed away — flagging the reasoning here so you can retune it against
your own live numbers rather than trusting a hardcoded guess.

## API

Required by the hackathon spec — must not deviate from this contract:

### `POST /api/agent/init`

Called exactly once by the evaluator to initialize the agent.

Request:
```json
{ "persona": { "name": "Ada", "domain": "AI Security" } }
```

Response:
```json
{ "agentId": "abc-123" }
```

**Persona identity is real, not decorative.** The submitted `name`/`domain`
is stored and becomes the actual identity used in every LLM prompt from
then on (`config/persona.js`'s `buildPersona()`, called fresh each cron
cycle from the stored agent record) — the agent genuinely writes as "Ada"
if that's what was submitted, not a hardcoded default. If the submitted
domain looks security-related, the project's hand-curated AI-security
editorial stance/voice/keyword lists are reused (just with the new name);
for a genuinely different domain, a leaner generic template is built from
the domain string itself. See the comment block at the top of
`config/persona.js` for the honest scope note on this — a two-word domain
can't fully replicate hand-tuned domain expertise, but the identity
(name + domain) is always correct either way.

### `GET /api/agent/feed?agentId=abc-123`

The only endpoint polled after init. Returns published posts, newest-first.

Response:
```json
{
  "posts": [
    {
      "id": "post-1",
      "createdAt": "2026-08-08T12:00:00.000Z",
      "text": "...",
      "rationale": "...",
      "sources": ["https://..."]
    }
  ]
}
```

Empty state: `{"posts":[]}`. Unknown/uninitialized `agentId` also returns
`{"posts":[]}` rather than a 404, per spec.

### `GET /api/cron/cycle` (internal, not part of the evaluator-facing contract)

Triggered by Vercel Cron (or an external scheduler, see note above) to run
one autonomous publish cycle. Protected by `CRON_SECRET`.

### `GET /api/ui/status` (internal, not part of the evaluator-facing contract)

Read-only convenience endpoint the homepage (`/`) calls to self-load the
current agent's persona/status without a visitor needing to paste in an
agentId. Not authenticated (nothing sensitive returned — just persona
identity and a post count), and never used by anything in the required
API contract.

Full narrative spec and architecture rationale documented in
`PROJECT_HANDOFF.md`.

## Homepage / UI

`public/index.html`, served at `/`, is a small dashboard for anyone who
opens the deployed URL directly — the evaluator only needs `init`/`feed`,
but a bare JSON 404 at `/` makes a submission look unfinished. Shows:

- The active persona's name/domain/tagline (live, via `/api/ui/status`)
- The live feed of published posts, auto-refreshing every 60s
- A specification panel: cron cadence, discovery sources, models used,
  candidates-judged-per-cycle, throttle settings — the real configured
  values, not placeholders
- Copy-pasteable `curl` commands for `init`/`feed`, pre-filled with the
  page's actual deployed origin (and the live `agentId` once initialized)
- Project credits

No build step — it's a static file with inline CSS/JS, served via
`express.static`. Edit it directly; nothing to compile.

## Project structure

```
public/
  index.html               — homepage UI (persona, live feed, specs, try-it commands)
src/
  config/persona.js       — buildPersona(): the ACTIVE persona for an agent, built from
                              whatever was submitted at init (falls back to a default
                              Kai Renn / AI Security persona if nothing was submitted)
  index.js                 — Express app entrypoint (also serves public/)
  routes/
    init.js                 — POST /api/agent/init
    feed.js                  — GET  /api/agent/feed
    cron.js                   — GET  /api/cron/cycle (internal trigger)
    ui.js                      — GET  /api/ui/status (internal, powers the homepage)
  scheduler/cycle.js        — chains discovery → scoring → judge → memory → writer → storage
  services/
    discovery.js             — multi-source aggregator (dedups by URL)
    sources/
      hackerNews.js            — Hacker News top stories
      rssFeeds.js                — arXiv cs.CR + security blog RSS/Atom feeds
    scoring.js                 — cheap heuristic filter/rank BEFORE the judge
                                    (bounds Gemini call volume)
    editorialJudge.js         — LLM editorial judgment: shouldPublish, scores, angle
    memory.js                  — dedup check against past posts (heuristic + LLM)
    writer.js                   — generates final post text, given the judge's angle
                                    + recent-post context; factuality guardrails
  storage/kvRepository.js    — Vercel KV read/write layer
  utils/
    checkEnv.js                — startup env-var validation
    idGenerator.js               — agent/post ID generation
    logger.js                     — simple structured logger
scripts/test-storage.js     — standalone smoke test for the storage layer
vercel.json                 — cron schedule config
```

## Testing

```bash
npm run test:storage   # smoke-tests the KV storage layer directly
```

## Known limitations / out of scope

Per the hackathon brief, intentionally NOT implemented: real social media
posting (feed is simulated), multi-platform support, images/video, analytics
dashboards, multi-agent orchestration, and any human-in-the-loop step after
`init`.
