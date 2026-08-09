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
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ba5ccf05fcce6b7cc38d3cc040a3bbc9a1feeb2d

## [Unreleased] — Discovery, scoring, judge, and writer overhaul

Addresses reviewer feedback: single-source discovery was the biggest weakness in the content pipeline (a good story ranked #30-100 on HN would simply never be seen), the judge's output was too thin to give the writer real editorial direction, and there was no explicit anti-fabrication guardrail for an autonomous news persona.

### Added
- **Multi-source discovery** (`src/services/sources/`): `hackerNews.js` (existing HN logic, extracted) + `rssFeeds.js` (new) — four RSS/Atom feeds covering research papers (arXiv cs.CR) and AI security journalism (The Hacker News, Krebs on Security, Schneier on Security). No API keys required. Each source fails independently and soft — one feed going down doesn't affect the others or crash discovery. `discovery.js` rewritten as a thin aggregator that merges all sources and dedupes by normalized URL.
- **Heuristic scoring/ranking** (`src/services/scoring.js`, new): non-LLM candidate scoring — `sourceQuality` (per-source weight + HN-points bonus), `recency` (bucketed by age), `securityRelevance` (keyword match against a new `persona.editorialStance.securityKeywords` list), `technicalDepth` (keyword match + research-source bonus). Also hard-filters candidates matching a new `persona.editorialStance.avoidKeywords` list (funding announcements, "best AI tools" listicles, etc.) and obvious duplicates of past posts (reuses `memory.js`'s heuristic via a new named export), before any of it reaches the judge. Caps survivors to `JUDGE_TOP_N` (default 8, env-configurable) — this is what actually bounds Gemini call volume now that discovery can surface a larger multi-source pool, directly addressing the "reduce unnecessary Gemini calls" goal.
- **Richer judge output** (`editorialJudge.js`): schema expanded from `{shouldPublish, whySelected, whyRelevantNow, rejectionReason}` to also include `relevanceScore`, `noveltyScore`, `sourceQualityScore`, `securityImportance` (all 0-10, clamped) and — most importantly — `angle`: the specific editorial point of view the writer should take, not just a restatement of the topic. The judge prompt also now receives `scoring.js`'s heuristic sub-scores as grounding context (explicitly framed as "context only, use your own judgment").
- **Writer pipeline upgrade** (`writer.js`): now takes the judge's `angle` and a short window of recent post text (`RECENT_CONTEXT_WINDOW = 3`) as input, so the model knows what Kai has said before and can maintain a consistent point of view rather than just reacting to a bare topic. `scheduler/cycle.js` passes `pastPosts` through to the writer for this.
- **Factuality guardrails** (`writer.js`): explicit prompt instruction not to invent CVEs, numbers, researcher/company names, or technical mechanisms beyond what the title/URL/angle establish. The model also self-reports a `claims` list in its JSON output — logged internally for review, but deliberately **not** persisted into the stored post object, since the `/api/agent/feed` response shape must not deviate from the spec.

### Changed
- `scheduler/cycle.js`: pipeline is now discover → **score/rank** → judge (throttled, ranked order) → memory → write(angle + context) → persist, replacing the old discover → judge → memory → write.
- `persona.js`: added `editorialStance.securityKeywords` and `editorialStance.avoidKeywords` — plain keyword lists for the new cheap scoring layer, kept separate from the prose `coversTopics`/`avoidsTopics` used in LLM prompts.
- `package.json`: added `rss-parser` (`^3.13.0`).

### Verified
- Boot-tested the full app end-to-end after the rewrite — no import/wiring errors.
- Since this sandbox's network egress is restricted to package registries (not live internet), `discoverTopics()` was run against blocked network calls specifically to confirm every source (HN + all 4 RSS feeds) fails soft individually and the aggregator still returns a clean empty array rather than crashing — exercises the actual error-handling paths, not just the happy path.
- `scoring.js` tested directly with synthetic candidates covering avoid-keyword filtering, security-keyword relevance, recency, and source-quality weighting — confirmed correct filtering and ranking order.
- **Not independently verified**: real output from the live RSS feeds/HN API (blocked in this sandbox) and real Gemini judge/writer responses (no API key available here). Recommend a live smoke test once deployed — see `DEPLOY.md`.

<<<<<<< HEAD
## [Unreleased] — Fixed: third missed call site, stale docs

### Fixed
- `src/services/memory.js`: found via a full `grep -r` sweep (not caught in the earlier pass) — the LLM-based duplicate-similarity check had the exact same `process.env.GEMINI_MODEL_JUDGE || 'gemini-2.5-flash'` fallback bug as `editorialJudge.js`/`writer.js`. Fixed the same way — no code-level default.
- `README.md`: the free-tier quota math and cron-cadence reasoning still cited `JUDGE_TOP_N (default 8, ...)` and `~8-10 Gemini calls`/`~120 calls/day` — stale from before `JUDGE_TOP_N`'s default changed to 3. Updated to `~3-5 calls`/`~60 calls/day`. Also rewrote the "models default to gemini-2.5-flash" paragraph, which was fully inaccurate post-fix (no code default anymore; `.env.example` currently suggests `gemini-3.5-flash-lite`).
- `DEPLOY.md`: the environment-variable table listed `GEMINI_MODEL_JUDGE`/`GEMINI_MODEL_WRITER` as "optional, this is the default" with stale values (`gemini-2.5-flash` / `gemini-2.5-pro` — the latter was never actually the writer's default). Marked both required, updated values, and added an explicit note on why (plus a reminder that "required" only guarantees the var is set, not that the model name is real — verify in AI Studio).

### Verified
- Full-repo `grep -rn "gemini-2.5-flash" src/` confirms zero remaining hardcoded fallbacks — the only match left is an explanatory code comment.
- Re-ran the missing-env-var boot test after the `memory.js` fix: still fails loud with the same clear error, server still starts and stays reachable.

## [Unreleased] — Fixed: spec panel silently blank on storage errors

### Fixed
- `src/routes/ui.js`: the `GET /api/ui/status` error-handling `catch` block returned `{ error: "Status check failed" }` with no `config` key — so any transient storage error after an agent was already found silently blanked the homepage's spec panel (judge/writer model, Top-N, throttle), which looked identical to "not configured" even when the env vars were fine. `buildConfigSnapshot()` only reads `process.env` — it can't fail the way a KV read can — so it's now included in the error response too. Verified directly: forcing `getCurrentAgentId()` to throw (missing KV creds) now returns `{"error":"Status check failed","config":{"judgeModel":"gemini-3.5-flash-lite", ...}}` instead of dropping `config` entirely.

## [Unreleased] — Fixed silent model-fallback bug, config-driven UI

Addresses a real incident: production kept calling `gemini-2.5-flash` (a
model since retired for new users) even after `GEMINI_MODEL_JUDGE` /
`GEMINI_MODEL_WRITER` were changed in Vercel's dashboard, because the code
had hardcoded fallbacks that masked the fact the new env vars weren't
actually propagating to the deployment. `JUDGE_TOP_N` had the same shape
of bug (`Number(process.env.JUDGE_TOP_N) || 8` silently returned 8 on an
unset/NaN value, making a propagation failure look like an untouched
default). The homepage also hardcoded the model names and Top-N count
directly into the HTML, so even a healthy deployment showed stale specs
the moment the env vars changed.

### Fixed
- `editorialJudge.js` / `writer.js`: removed the `|| 'gemini-2.5-flash'` fallback from `JUDGE_MODEL` / `WRITER_MODEL`. Both now read directly from `process.env`, with no code-level default.
- `checkEnv.js`: `GEMINI_MODEL_JUDGE` and `GEMINI_MODEL_WRITER` added to `REQUIRED_VARS`, so a missing/un-propagated model var now fails loudly at boot (clear log line) instead of silently degrading to a dead model mid-cycle.
- `scoring.js`: `JUDGE_TOP_N` fallback changed from `Number(process.env.JUDGE_TOP_N) || 8` to `Number(process.env.JUDGE_TOP_N || 3)` — an unset value now resolves to the project's actual intended default (3) instead of quietly resembling pre-fix behavior (8), which is what made the propagation bug hard to distinguish from "working as configured" in the logs.
- `.env.example`: updated to the currently-intended values (`gemini-3.5-flash-lite` for both judge/writer — verified against Google's current model docs as GA and available, since `gemini-2.5-flash` is retired; `JUDGE_TOP_N=3`), with a comment explaining why there's no code fallback to fall back on.

### Added
- `src/routes/ui.js`: new `config` block in the `GET /api/ui/status` response — live `judgeModel`, `writerModel`, `judgeTopN`, `judgeDelayMs`, read straight from `process.env` at request time.
- `public/index.html`: specification panel's judge model, writer model, "candidates judged/cycle", and judge-call-throttle cells are now populated from that live config instead of hardcoded text — so the page can't drift from the actual deployed configuration the way it did before.
- `public/index.html`: added a curl / PowerShell toggle to the "Try the API" section — both command sets are generated client-side and kept in sync with the current agent ID; a note clarifies the real evaluator hits the API programmatically and never uses either.

### Verified
- Boot-tested with all required env vars set: server starts clean, homepage returns 200, spec panel element IDs and shell-tab markup present, inline `<script>` passes `node --check`.
- Boot-tested with `GEMINI_MODEL_JUDGE`/`GEMINI_MODEL_WRITER` deliberately omitted: `checkEnv.js` now logs `Missing required environment variable(s): GEMINI_MODEL_JUDGE, GEMINI_MODEL_WRITER` at boot, confirming the fail-loud path actually fires.
- `GET /api/ui/status` against a dummy/unreachable KV host fails cleanly (caught `ENOTFOUND`, clean 500 JSON) without crashing the process — same pattern as every other storage-dependent route.
- **Not independently verified**: real Gemini calls with the new model name (no live API key in this sandbox) — confirm `gemini-3.5-flash-lite` is actually enabled for your specific API key/project in Google AI Studio before deploying.

=======
>>>>>>> ba5ccf05fcce6b7cc38d3cc040a3bbc9a1feeb2d
## [Unreleased] — Fixed persona mismatch bug, added homepage UI

### Fixed
- **Critical bug, previously self-documented in a code comment as intentional**: the evaluator's submitted persona (`POST /api/agent/init`'s `{name, domain}`) was stored but never actually used — every LLM call (`editorialJudge.js`, `writer.js`) statically imported a hardcoded `persona` object from `config/persona.js` ("Kai Renn"), so an agent initialized as "Ada" would still silently write as "Kai Renn." Now fixed properly:
  - `config/persona.js` rewritten: exports `buildPersona({name, domain})`, which builds the actual active persona from whatever was submitted at init, falling back to the default (Kai Renn / AI Security) for anything not provided. If the submitted domain looks security-related, the project's hand-curated editorial stance/voice/keyword lists are reused (just with the new name/domain substituted in); for a genuinely different domain, a leaner generic template is derived from the domain string itself — documented as an honest scope limitation (two words can't replicate hand-tuned domain expertise) rather than silently pretended away.
  - `scheduler/cycle.js` now fetches the agent's actual stored meta (`getAgent`) at the start of every cycle, builds the real persona via `buildPersona()`, and threads it through `scoring.js`, `editorialJudge.js`, and `writer.js` as an explicit parameter — replacing the static imports those modules used to have.
  - `init.js`'s header comment (which literally documented the bug as intentional behavior, with a note flagging it for a future fix) rewritten to describe the corrected behavior.

### Added
- **Homepage UI** (`public/index.html`, served at `/` via `express.static`): a dashboard showing the active persona's identity, a live auto-refreshing feed, a specification panel (real configured values — cron cadence, discovery sources, models, judge/writer throttle settings — not placeholders), and copy-pasteable `curl` commands for `init`/`feed` pre-filled with the page's actual deployed origin. No build step, single static file with inline CSS/JS. Design grounded in the subject matter (security-research/log-line vernacular: monospace metadata, post rationale rendered as a code comment) rather than a generic template — see the file's own visual choices.
- `src/routes/ui.js`: new `GET /api/ui/status` — read-only, unauthenticated convenience endpoint that powers the homepage's self-loading behavior (current agent's persona + post count). Explicitly NOT part of the evaluator-facing API contract; `init`/`feed` remain the only required endpoints and their behavior is unchanged.
- Project credits added to the homepage footer: Aman Raj, Ayush Raj, Hariom Kumar.

### Verified
- `buildPersona()` tested directly with three cases: the hackathon spec's own example payload (`Ada` / `AI Security` — correctly reuses the full curated security template with the name swapped), an arbitrary unrelated domain (`Nova` / `Climate Tech` — correctly falls back to the generic template, domain-word keyword derivation confirmed), and no override (correctly defaults to Kai Renn / AI Security).
- Full app boot-tested again after wiring `getAgent`/`buildPersona` through `cycle.js`.
- Homepage boot-tested end-to-end: confirmed `GET /` returns `200 text/html` with the real page content (credits, spec grid, try-it commands all present in the served HTML), and confirmed `/api/ui/status` fails gracefully (caught, clean JSON 500) against invalid storage credentials rather than crashing — same pattern as every other storage-dependent route.
<<<<<<< HEAD
=======
=======
>>>>>>> 929a73839a01636db85f07cc914164a649f976a1
>>>>>>> ba5ccf05fcce6b7cc38d3cc040a3bbc9a1feeb2d
