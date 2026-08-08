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
| `OPENAI_API_KEY` | your key from platform.openai.com | required |
| `OPENAI_MODEL_JUDGE` | `gpt-4o-mini` | optional, this is the default |
| `OPENAI_MODEL_WRITER` | `gpt-4o` | optional, this is the default |
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
  `vercel.json`'s hourly schedule works as-is. Skip to step 6.
- **If you're on Vercel Hobby (free)**: Hobby only allows cron jobs once
  per day, which is too sparse. Choose one:
  - **Upgrade to Pro** for the duration of the hackathon (simplest, costs
    money).
  - **Use an external free scheduler** instead:
    1. Remove or ignore the `crons` block in `vercel.json` (a Hobby
       project will just run it once/day regardless; leaving it doesn't
       break anything, but don't rely on it).
    2. Set up a free account at [cron-job.org](https://cron-job.org) (or
       use a GitHub Actions scheduled workflow in this or another repo).
    3. Point it at `https://<your-deploy>.vercel.app/api/cron/cycle`,
       method `GET`, with header `Authorization: Bearer <CRON_SECRET>`
       (the same value you set in step 4).
    4. Set the interval — every 30–60 minutes is reasonable for spreading
       posts across a 48-hour window without excessive LLM spend.

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
