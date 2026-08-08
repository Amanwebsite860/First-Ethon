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
