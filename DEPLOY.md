# Deploy Checklist

Step-by-step for taking this from local code to a live, autonomously
publishing deployment. Work through in order — each step depends on the
previous one.

## 1. Push to GitHub

```bash
git init                      # if not already a repo
git add .
git commit -m "chore: project scaffold"   # if not already committed
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

(If you've been working on a `dev`/feature branch per the branching
convention, merge to `main` when ready to deploy — keep `main` stable.)

## 2. Create the Vercel project

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import the GitHub repo from step 1.
3. Framework preset: Vercel should auto-detect this as a Node.js/Express
   app. If it asks, build command and output directory can be left blank —
   this project has no build step.
4. **Don't deploy yet** — click through to project settings first so env
   vars are in place before the first real deploy (avoids a broken first
   build).

## 3. Provision Vercel KV

> **Note:** `@vercel/kv` (this project's storage dependency) is marked
> deprecated by Vercel — new Vercel accounts may only see "Marketplace
> Database Storage → Redis" (via Upstash) instead of a dedicated "KV"
> option. If you don't see "KV" as a Storage option:
> - Create a **Redis** database via the Marketplace instead — it's
>   Upstash-backed and exposes the same `KV_REST_API_URL` /
>   `KV_REST_API_TOKEN` env var names when connected to your project, so
>   no code changes should be needed.
> - If the env var names differ in your dashboard, just make sure the
>   values end up set under the exact names `KV_REST_API_URL` and
>   `KV_REST_API_TOKEN` in step 4 below (rename if needed).

1. In the new project, go to the **Storage** tab.
2. **Create Database → KV** (or **Redis**, per the note above).
3. Name it (e.g. `autonomous-persona-kv`) and create.
4. Vercel automatically offers to connect it to your project — accept
   this. It will inject `KV_REST_API_URL`, `KV_REST_API_TOKEN`, and
   `KV_REST_API_READ_ONLY_TOKEN` as env vars automatically. **If it does
   this for you, you can skip manually setting those three in step 4.**

## 4. Set environment variables

Go to **Settings → Environment Variables**. Confirm/add:

| Variable | Value | Notes |
|---|---|---|
| `GEMINI_API_KEY` | your key from [Google AI Studio](https://aistudio.google.com/apikey) | required |
| `GEMINI_MODEL_JUDGE` | `gemini-2.5-flash` | optional, this is the default |
| `GEMINI_MODEL_WRITER` | `gemini-2.5-pro` | optional, this is the default |
| `CRON_SECRET` | a random string, e.g. output of `openssl rand -hex 32` | required — protects `/api/cron/cycle` |
| `KV_REST_API_URL` | from step 3 (may already be set) | required |
| `KV_REST_API_TOKEN` | from step 3 (may already be set) | required |
| `KV_REST_API_READ_ONLY_TOKEN` | from step 3 (may already be set) | optional, not currently used |
| `NODE_ENV` | `production` | optional |

Apply to all environments (Production/Preview/Development) unless you have
a reason not to.

## 5. Decide: Vercel Cron vs. external cron

**This decision must be made before relying on the deployment for the
48-hour evaluation window.**

- **If you have (or will get) Vercel Pro**: no action needed —
  `vercel.json`'s hourly schedule works as-is. Skip to step 6. A **14-day
  free trial with $20 in credits** is available, which comfortably covers
  a 48-hour hackathon window at zero cost — the simplest path if you don't
  mind putting a card on file.
- **If you're staying on Vercel Hobby (free)**: confirmed — Hobby doesn't
  just throttle faster schedules, it **refuses to deploy** any cron
  expression that would run more than once/day (deployment fails outright
  with an error). Choose one:
  - **Start the Pro free trial** for the hackathon window (simplest, see
    above).
  - **Use an external free scheduler** instead:
    1. Edit `vercel.json` so its `crons` block is either removed entirely
       or set to a valid once-daily schedule (e.g. `"0 0 * * *"`) — a
       faster schedule will fail deployment on Hobby, not just get
       silently capped.
    2. Two free options, pick one:
       - **cron-job.org** — free web dashboard, no code. Add a job
         targeting `https://<your-deploy>.vercel.app/api/cron/cycle`,
         method `GET`, header `Authorization: Bearer <CRON_SECRET>`,
         interval 30–60 minutes.
       - **GitHub Actions** — a ready-to-use workflow is already in this
         repo at `.github/workflows/trigger-cycle.yml`. To enable it:
         1. In your GitHub repo, go to **Settings → Secrets and variables
            → Actions → New repository secret** and add:
            - `AGENT_BASE_URL` — e.g. `https://your-deploy.vercel.app`
              (no trailing slash)
            - `CRON_SECRET` — the same value you set in Vercel's env vars
         2. That's it — the workflow runs every 30 minutes automatically
            once merged to the default branch. You can also trigger it
            manually from the repo's **Actions** tab (`workflow_dispatch`)
            to smoke-test the setup immediately rather than waiting for
            the schedule.
         3. Note: GitHub's own schedule timing isn't perfectly precise
            either (can be delayed under platform load) — same caveat as
            Vercel Cron, just a free way to get a tighter cadence than
            Hobby allows.

## 6. Deploy

Back in the Vercel dashboard (or via `vercel --prod` from the CLI), trigger
the deploy now that env vars are set.

## 7. Smoke test the live deployment

```bash
BASE=https://<your-deploy>.vercel.app

curl $BASE/health

curl -X POST $BASE/api/agent/init \
  -H "Content-Type: application/json" \
  -d '{"persona":{"name":"Kai Renn","domain":"AI Security"}}'
# → note the returned agentId

curl "$BASE/api/agent/feed?agentId=<agentId-from-above>"
# → should return {"posts":[]} before any cycle has run

# Manually trigger one cycle to confirm the full pipeline works end-to-end
curl $BASE/api/cron/cycle -H "Authorization: Bearer <CRON_SECRET>"

curl "$BASE/api/agent/feed?agentId=<agentId-from-above>"
# → should now show one post, if a topic passed judgment + memory checks
```

If the cycle ran but the feed is still empty, that can be normal — it
means no discovered topic passed the editorial judgment or memory-dedup
checks this cycle. Check the deployment's function logs (Vercel dashboard
→ your project → Logs) for the `editorialJudge`/`memory` decisions to
confirm it's behaving as intended rather than silently failing (see
`checkEnv.js` output there too, if something's misconfigured).

## 8. Final pre-submission checks

- [ ] `POST /api/agent/init` called exactly once produces a valid `agentId`
- [ ] `GET /api/agent/feed` returns the exact shape specified (newest-first,
      unique `id`s, ISO 8601 UTC `createdAt`)
- [ ] Cron (Vercel or external) is confirmed actually firing on schedule —
      check logs a few hours after deploy, not just immediately after
- [ ] `CRON_SECRET` is set in production (don't leave `/api/cron/cycle`
      open)
- [ ] Confirm the repo is public (or shared with judges) with `main`
      pointing at the deployed code
- [ ] Tag the submission commit: `git tag v1.0-submission && git push --tags`
