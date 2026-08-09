// src/scheduler/cycle.js
//
// This is the autonomy mechanism. Vercel Cron (or the GitHub Actions
// workflow, on Hobby) hits this as an HTTP endpoint on a schedule —
// nothing else triggers it, and no human/evaluator interaction is
// involved. This satisfies the spec's core requirement: "no further
// instructions or prompts after init."
//
// Pipeline for every cycle:
//   1. Discovery (discovery.js) — multi-source: Hacker News + RSS feeds
//      (arXiv cs.CR, security blogs). See services/sources/.
//   2. Scoring (scoring.js) — cheap heuristic filter + rank; caps how
//      many candidates reach the (costly) judge step.
//   3. Editorial Judgment (editorialJudge.js) — for each surviving
//      candidate in ranked order: filter by persona's editorial stance,
//      and produce a specific editorial ANGLE for whichever one passes.
//   4. Memory check (memory.js) — LLM similarity check against recent
//      posts (scoring.js already filtered obvious/heuristic duplicates;
//      this catches "same story, different source" cases).
//   5. Writer (writer.js) — generate the post in persona voice, using the
//      judge's angle and recent-post context for continuity.
//   6. Persist (kvRepository.js) — save to storage, available via /feed
//
// Design choice: only ONE post is written per cycle, even if multiple
// topics pass judgment + memory. This matches "publishing must occur over
// time rather than generating all content immediately" — one considered
// post per tick reads as more editorially deliberate than dumping several
// at once, and keeps LLM cost per cycle predictable.

import { discoverTopics } from '../services/discovery.js';
import { scoreAndRankTopics } from '../services/scoring.js';
import { judgeTopic } from '../services/editorialJudge.js';
import { checkMemory } from '../services/memory.js';
import { writePost } from '../services/writer.js';
import { getAgent, getPosts, addPost } from '../storage/kvRepository.js';
import { buildPersona } from '../config/persona.js';
import logger from '../utils/logger.js';

// Gemini's free tier RPM cap is tight (single digits to low teens,
// depending on model/project — Google no longer publishes a fixed table,
// see README). A single cycle can call judgeTopic for up to JUDGE_TOP_N
// (scoring.js) candidates sequentially, plus a memory check and a writer
// call for whichever one passes — a burst that alone can exceed a low RPM
// cap if fired back-to-back. This small delay spreads judge calls out so
// one cycle doesn't trip a 429 partway through.
// Default: 4.5s between calls ≈ ~13 requests/minute, safely under typical
// free-tier RPM ceilings without needing exact numbers.
const JUDGE_CALL_DELAY_MS = Number(process.env.GEMINI_JUDGE_DELAY_MS) || 4500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run one full discover -> score -> judge -> memory -> write -> persist
 * cycle for a single agent. Returns the new post if one was published,
 * else null.
 *
 * @param {string} agentId
 */
export async function runCycleForAgent(agentId) {
  const agentMeta = await getAgent(agentId);
  if (!agentMeta) {
    logger.warn(`Cycle skipped: agent ${agentId} does not exist`);
    return null;
  }

  // Build the ACTIVE persona from whatever was actually submitted at init
  // (POST /api/agent/init's { name, domain }) — this is the fix for the
  // previous bug where every agent silently wrote as the hardcoded
  // default persona regardless of what the evaluator initialized it with.
  const persona = buildPersona(agentMeta);

  logger.info(`Starting cycle for agent ${agentId} (persona: ${persona.name} / ${persona.domain})`);

  const rawTopics = await discoverTopics();
  if (rawTopics.length === 0) {
    logger.info('No topics discovered this cycle');
    return null;
  }

  const pastPosts = await getPosts(agentId);

  // Cheap heuristic filter + rank BEFORE any Gemini calls — this is what
  // actually bounds the number of judge calls a cycle can make, and
  // already excludes obvious duplicates / off-topic candidates for free.
  const ranked = scoreAndRankTopics(rawTopics, pastPosts, persona);
  if (ranked.length === 0) {
    logger.info('No candidates survived scoring/filtering this cycle');
    return null;
  }

  for (const [index, { topic, scores }] of ranked.entries()) {
    if (index > 0) {
      await sleep(JUDGE_CALL_DELAY_MS);
    }

    const judgment = await judgeTopic(topic, scores, persona);
    if (!judgment.shouldPublish) {
      continue;
    }

    const memoryResult = await checkMemory(topic, pastPosts);
    if (memoryResult.isDuplicate) {
      continue;
    }

    const post = await writePost(topic, judgment, pastPosts, persona);
    if (!post) {
      continue;
    }

    await addPost(agentId, post);
    logger.info(`Published post ${post.id} for agent ${agentId}: "${topic.title}"`);
    return post;
  }

  logger.info(`No topic survived judgment + memory checks this cycle for agent ${agentId}`);
  return null;
}

/**
 * Run the cycle for every agent currently tracked. In this project's
 * scope, agent IDs aren't centrally listed anywhere (Vercel KV has no
 * built-in "list keys" primitive we're using), so the cron handler expects
 * an agentId to be passed explicitly (see routes wiring below) OR falls
 * back to a single "current agent" pattern if you choose to track one.
 *
 * Kept as a thin wrapper so the actual HTTP handler stays simple.
 *
 * @param {string} agentId
 */
export async function runCycle(agentId) {
  if (!agentId) {
    logger.warn('runCycle called without an agentId — nothing to do');
    return null;
  }
  return runCycleForAgent(agentId);
}

export default runCycle;
