# Autonomous AI Persona — Kai Renn

An autonomous AI/technology persona ("Kai Renn", an AI Security Researcher)
that discovers topics, applies editorial judgment, writes in a consistent
voice, remembers past posts, and publishes over time — with **zero human
input after a single initialization call**.

Built for [hackathon name] — see `PROJECT_HANDOFF.md` / `prompt.md` for full
project context, architecture, and requirements.

## How it works

```
Vercel Cron (scheduled) ──▶ GET /api/cron/cycle
                                   │
                                   ▼
                   ┌───────────────────────────────┐
                   │   src/scheduler/cycle.js       │
                   │                                 │
                   │  1. discovery.js   — pull candidate topics from HN
                   │  2. editorialJudge.js — filter by persona's editorial stance
                   │  3. memory.js      — drop near-duplicates of past posts
                   │  4. writer.js      — write the post in persona voice
                   │  5. kvRepository.js — persist to Vercel KV
                   └───────────────────────────────┘

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

### 2. Get an OpenAI API key

Create one at [platform.openai.com](https://platform.openai.com/api-keys).

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

Fill in `.env` with your OpenAI key and Vercel KV credentials from steps 2–3.
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

## ⚠️ Important: Vercel Cron plan limits

`vercel.json` currently schedules the cycle **hourly** (`0 */1 * * *`). This
requires a **Vercel Pro plan** — the free **Hobby plan only allows cron jobs
to run once per day**, which would NOT satisfy the "publishing must occur
over time... during the 48-hour evaluation window" requirement well (one
post per day is too sparse, and Hobby also limits *when* in the day it can
run).

Before submitting, confirm your Vercel plan supports the schedule you need.
Options if stuck on Hobby:
- Upgrade to Pro for the hackathon window, or
- Use an external free cron trigger (e.g. cron-job.org, GitHub Actions
  scheduled workflow) to hit `/api/cron/cycle` on a tighter schedule instead
  of relying on Vercel's built-in cron. If using an external trigger, remove
  or ignore the `crons` block in `vercel.json` and instead point the
  external service at `https://<your-deploy>.vercel.app/api/cron/cycle`,
  with an `Authorization: Bearer <CRON_SECRET>` header.

This is a known constraint — flagging it here rather than assuming it away.
**Not yet resolved as of this writing.**

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

Full narrative spec and architecture rationale documented in
`PROJECT_HANDOFF.md`.

## Project structure

```
src/
  config/persona.js       — persona definition (Kai Renn: bio, editorial stance, voice)
  index.js                 — Express app entrypoint
  routes/
    init.js                 — POST /api/agent/init
    feed.js                  — GET  /api/agent/feed
    cron.js                   — GET  /api/cron/cycle (internal trigger)
  scheduler/cycle.js        — chains discovery → judge → memory → writer → storage
  services/
    discovery.js             — pulls candidate topics from Hacker News
    editorialJudge.js         — LLM editorial filter against persona's stance
    memory.js                  — dedup check against past posts
    writer.js                   — generates final post text in persona voice
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
