# Changelog

All notable progress on this project, in build order.

## [Unreleased]

### Added
- Project scaffold: folder structure, `package.json`, `.gitignore`, `.env.example`, `README.md`
- Vercel KV storage layer (`src/storage/kvRepository.js`): `createAgent`, `getAgent`, `getPosts`, `addPost`, `agentExists`
- Standalone storage test script (`scripts/test-storage.js`, run via `npm run test:storage`)
- Persona configuration (`src/config/persona.js`): "Kai Renn", AI Security Researcher persona with editorial stance and voice guide
- API skeleton: `src/index.js` (Express app), `src/routes/init.js` (`POST /api/agent/init`), `src/routes/feed.js` (`GET /api/agent/feed`), `src/utils/idGenerator.js`, `src/utils/logger.js`
- Topic discovery service (`src/services/discovery.js`): pulls candidate topics from the Hacker News API (top stories), fails soft to an empty list on error
- Editorial judgment service (`src/services/editorialJudge.js`): uses OpenAI (`gpt-4o-mini` by default) to decide whether a candidate topic fits the persona, returning `shouldPublish` + rationale (`whySelected`, `whyRelevantNow`) or a rejection reason; fails closed (no publish) on error
- Memory / deduplication service (`src/services/memory.js`): two-layer check against past posts — cheap URL/title heuristic first, then bounded LLM similarity check against the 10 most recent posts; fails open (assumes not duplicate) on error
- Writer service (`src/services/writer.js`): generates final post text in persona voice using OpenAI (`gpt-4o` by default); assembles full post object (`id`, `createdAt`, `text`, `rationale`, `sources`) reusing the editorial judgment's rationale rather than re-inventing it; fails soft (no post) on error
- Autonomous scheduling cycle (`src/scheduler/cycle.js`): chains discovery → editorialJudge → memory → writer → storage for a given agent; publishes at most one post per cycle
- Cron-triggered route (`src/routes/cron.js`, wired at `GET /api/cron/cycle`): the actual autonomy trigger, protected by `CRON_SECRET`, reads the "current agent" pointer and runs one cycle
- Current-agent pointer added to storage layer (`setCurrentAgentId`/`getCurrentAgentId`) so the cron handler knows which agent to run for, since Vercel KV has no built-in list-all-keys primitive in use here; set automatically by `init`
- `vercel.json` cron schedule config (hourly by default) — ⚠️ flagged in README: hourly cron requires Vercel Pro plan, Hobby plan only allows once-daily cron
- Wiring + polish: startup env-var validation (`src/utils/checkEnv.js`, fails loudly with actionable message on boot if `OPENAI_API_KEY`/KV vars are missing, warns if `CRON_SECRET` is missing), global 404 handler, global Express error-handling middleware, process-level `unhandledRejection`/`uncaughtException` logging so an unexpected error mid-cycle doesn't go unnoticed during the unattended 48-hour window

### Fixed
- `dotenv` was a dependency but never actually loaded — local dev wouldn't pick up `.env` values. Added `import 'dotenv/config'` at the top of `src/index.js` (no-op on Vercel, which injects env vars directly).

### Docs
- Finalized `README.md`: full setup walkthrough (install → OpenAI key → Vercel KV provisioning → env vars → local run → deploy), architecture diagram, complete API contract, project structure tree, and known limitations section
- Added `DEPLOY.md`: step-by-step deploy checklist covering GitHub push, Vercel project creation, KV provisioning, environment variable setup, the Hobby-vs-Pro cron decision (with concrete external-scheduler fallback steps), live smoke testing, and a final pre-submission checklist

### Fixed (audit pass)
- Global error handler in `src/index.js` always returned HTTP 500, even for client errors like malformed JSON request bodies (which `body-parser` correctly flags as a 400). Now respects the error's own status code when it's a legitimate 4xx.
- Removed `AGENT_CYCLE_INTERVAL_MINUTES` from `.env.example` — it was documented but never actually read anywhere in the code (cadence is controlled entirely by `vercel.json` / the external cron trigger). Left in, it was misleading.
- Documented `PORT` in `.env.example` — it's read in `src/index.js` for local dev but was previously undocumented.
- Verified end-to-end by actually booting the server and hitting every route (`/health`, `/api/agent/init`, `/api/agent/feed`, `/api/cron/cycle` with and without auth) with dummy credentials — confirmed error handling, 401/400/404 status codes, and logging all behave correctly with no crashes or unhandled exceptions.
- Added `package-lock.json` (generated via `npm install`) to lock dependency versions.

### Known issue, not fixed (flagging for a decision, not deciding silently)
- `@vercel/kv` (the storage dependency) is deprecated by Vercel — existing KV stores are being migrated to Upstash Redis under Vercel's Marketplace integrations, and new projects are pointed at a Redis marketplace integration instead. The current code still works as of this writing (Vercel KV's REST API is unchanged), but this is worth confirming when you provision storage in Vercel — see `DEPLOY.md` step 3.

## [Unreleased] — Cron alternative

### Added
- `.github/workflows/trigger-cycle.yml`: a GitHub Actions scheduled workflow (every 30 min, plus manual `workflow_dispatch`) that hits `/api/cron/cycle` with the `CRON_SECRET` bearer token — a free alternative to Vercel's own cron for accounts staying on the Hobby plan, since Hobby confirmed to hard-fail deployment on any cron expression faster than once/day (not just throttle it).
- Requires two GitHub repo secrets to function: `AGENT_BASE_URL` and `CRON_SECRET` (setup steps in `DEPLOY.md` step 5).

### Corrected
- `DEPLOY.md` step 5 previously stated Hobby would silently cap a too-frequent cron to once/day. Corrected based on Vercel's own docs: an invalid schedule **fails deployment outright** with an error, it doesn't get silently downgraded.

## [Unreleased] — LLM provider switch: OpenAI → Gemini

### Changed
- Swapped LLM provider from OpenAI to **Google Gemini** across all three call sites: `src/services/editorialJudge.js`, `src/services/writer.js`, `src/services/memory.js` (similarity check). Uses the current `@google/genai` SDK (the `openai` package's deprecated predecessor, `@google/generative-ai`, was deliberately avoided).
- Default models: `gemini-2.5-flash` for judgment/similarity (fast, cheap — matches the old `gpt-4o-mini` role), `gemini-2.5-pro` for writing (matches the old `gpt-4o` role). Both configurable via env vars.
- Env vars renamed: `OPENAI_API_KEY` → `GEMINI_API_KEY`, `OPENAI_MODEL_JUDGE` → `GEMINI_MODEL_JUDGE`, `OPENAI_MODEL_WRITER` → `GEMINI_MODEL_WRITER`. Updated in `.env.example`, `checkEnv.js`, `README.md`, `DEPLOY.md`.
- `package.json`: removed `openai` dependency, added `@google/genai` (currently `^2.16.0`, confirmed against the live npm registry rather than assumed).
- JSON response handling: Gemini's `responseMimeType: 'application/json'` config is used (equivalent to OpenAI's `response_format: json_object`), with a defensive markdown-fence-stripping step retained in case the model wraps output in code fences anyway.
- Verified by booting the app with dummy Gemini env vars and confirming no import/wiring errors — same smoke-test approach used in the earlier bug-fix audit.

## [Unreleased] — Free-tier rate/cadence tuning

### Fixed
- **Critical**: `GEMINI_MODEL_WRITER` defaulted to `gemini-2.5-pro`, but Gemini 2.5 Pro has been paid-only since April 2026 — the free tier only covers Flash/Flash-Lite. This would have made every writer call fail on a free API key. Changed default to `gemini-2.5-flash` in `writer.js` and `.env.example`.

### Changed
- Cron cadence changed from hourly to **every 2 hours** in both `vercel.json` and `.github/workflows/trigger-cycle.yml`, sized against a conservative reading of Gemini's free-tier daily quota (Google no longer publishes one fixed number — it's project-specific, shown in AI Studio; third-party trackers report Flash models somewhere in the ~250–1,500 requests/day range). Reasoning documented in full in `README.md`'s cron section.
- `discovery.js`: `CANDIDATE_LIMIT` reduced from 15 to 10 — bounds the worst-case number of Gemini judge calls a single cycle can make.
- `scheduler/cycle.js`: added a throttle (`GEMINI_JUDGE_DELAY_MS`, default 4500ms) between sequential judge calls within one cycle, since a burst of ~10 candidate evaluations fired back-to-back could exceed Gemini's free-tier per-minute request cap even if the daily budget is fine.
- Confirmed Vercel's zero-config Express deployment runs on Fluid compute by default, which extends Hobby's function timeout well beyond the old 60s cap — the added per-cycle throttle (worst case ~60-85s) has real headroom, verified against Vercel's own docs rather than assumed.

### Docs
- `README.md` and `DEPLOY.md` updated to explain the cron cadence is bound by *two* separate free-tier limits (Vercel Cron's once/day Hobby cap, and Gemini's request quota) — not just the Vercel one — with explicit guidance to check live quota in AI Studio and retune rather than trust the hardcoded default blindly.

## [Unreleased] — Confirmed: Vercel Hobby + GitHub Actions

### Changed
- `vercel.json` cron changed from every-2-hours to **once-daily** (`"0 0 * * *"`) — the minimum Vercel Hobby allows — now serving as a harmless backup trigger rather than the real cadence.
- `.github/workflows/trigger-cycle.yml` (every 2 hours) is now the actual publishing trigger, confirmed as the chosen path (Hobby plan, not upgrading to Pro).
- `README.md` and `DEPLOY.md` rewritten to describe this as the configured setup directly, rather than as one branch of an if/else decision tree — removes ambiguity about which schedule is actually live.
