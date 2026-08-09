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
| `GEMINI_MODEL_JUDGE` | `gemini-3.5-flash-lite` | **required** — no code fallback (see note below) |
| `GEMINI_MODEL_WRITER` | `gemini-3.5-flash-lite` | **required** — no code fallback (see note below) |
| `CRON_SECRET` | a random string, e.g. output of `openssl rand -hex 32` | required — protects `/api/cron/cycle` |
| `KV_REST_API_URL` | from step 3 (may already be set) | required |
| `KV_REST_API_TOKEN` | from step 3 (may already be set) | required |
| `KV_REST_API_READ_ONLY_TOKEN` | from step 3 (may already be set) | optional, not currently used |
| `NODE_ENV` | `production` | optional |

Apply to all environments (Production/Preview/Development) unless you have
a reason not to.

**Important — these two are required, not optional.** `GEMINI_MODEL_JUDGE`
and `GEMINI_MODEL_WRITER` have no hardcoded fallback in the code; the app
fails loudly at boot if either is missing (see `checkEnv.js`). This is
deliberate — an earlier version silently defaulted to `gemini-2.5-flash`
when the env var wasn't actually applied to a deployment, which made a
real Vercel misconfiguration invisible for a while. **After setting these,
verify the model name is available to your specific API key/project in
[AI Studio](https://aistudio.google.com)** before relying on it — being
required doesn't mean the string is guaranteed to be a real, live model.

## 5. Set up GitHub Actions cron (Hobby plan setup)

This project is configured for **Vercel Hobby + GitHub Actions** — the
real publishing cadence comes from GitHub Actions, not Vercel's own cron.

**Why:** Vercel Hobby refuses to deploy outright (not just throttle) any
cron expression faster than once/day. So `vercel.json` is set to the
minimum Hobby allows (`"0 0 * * *"`, once daily) as a harmless backup
trigger, and `.github/workflows/trigger-cycle.yml` — already in this repo,
set to **every 2 hours** (12 runs/day) — does the actual work.

That every-2-hours number is sized to fit within a conservative reading of
Gemini's free-tier daily request quota (see the note in `README.md` for
the exact reasoning). Adjust the workflow's schedule if your actual quota,
checked live in [AI Studio](https://aistudio.google.com), gives you more
or less headroom than assumed.

**Setup steps:**

1. In your GitHub repo, go to **Settings → Secrets and variables → Actions
   → New repository secret** and add:
   - `AGENT_BASE_URL` — e.g. `https://your-deploy.vercel.app` (no trailing
     slash)
   - `CRON_SECRET` — the same value you set in Vercel's env vars (step 4)
2. That's it — the workflow runs every 2 hours automatically once merged
   to the default branch. You can also trigger it manually from the repo's
   **Actions** tab (`workflow_dispatch`) to smoke-test the setup
   immediately rather than waiting for the schedule.
3. Note: GitHub's own schedule timing isn't perfectly precise either (can
   be delayed under platform load) — same caveat that applies to Vercel
   Cron, just a free way to get a tighter cadence than Hobby allows on its
   own.

**If you'd rather switch to Vercel's own cron instead** (e.g. if you move
to Vercel Pro or start the 14-day free trial with $20 in credits — plenty
for a 48-hour window), change `vercel.json`'s schedule to something like
`"0 */2 * * *"` and you can disable/remove the GitHub Actions workflow.
Not the path currently configured, but worth knowing if your plan changes.

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
