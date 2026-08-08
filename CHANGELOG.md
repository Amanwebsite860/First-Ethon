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
