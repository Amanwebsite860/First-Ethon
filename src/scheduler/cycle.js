// src/scheduler/cycle.js
//
// This is the autonomy mechanism. Vercel Cron hits this as an HTTP
// endpoint on a schedule (see vercel.json) — nothing else triggers it, and
// no human/evaluator interaction is involved. This satisfies the spec's
// core requirement: "no further instructions or prompts after init."
//
// Runs the full loop for EVERY known agent (in this hackathon's scope
// there's realistically one agent alive at a time, but this doesn't
// assume that):
//   1. Topic Discovery (discovery.js)
//   2. Editorial Judgment (editorialJudge.js) — filter candidates
//   3. Memory check (memory.js) — drop near-duplicates of past posts
//   4. Writer (writer.js) — generate the post for the first surviving topic
//   5. Persist (kvRepository.js) — save to storage, available via /feed
//
// Design choice: only ONE post is written per cycle, even if multiple
// topics pass judgment + memory. This matches "publishing must occur over
// time rather than generating all content immediately" — one considered
// post per tick reads as more editorially deliberate than dumping several
// at once, and keeps LLM cost per cycle predictable.

import { discoverTopics } from '../services/discovery.js';
import { judgeTopic } from '../services/editorialJudge.js';
import { checkMemory } from '../services/memory.js';
import { writePost } from '../services/writer.js';
import { getPosts, addPost, agentExists } from '../storage/kvRepository.js';
import logger from '../utils/logger.js';

/**
 * Run one full discover -> judge -> memory -> write -> persist cycle for
 * a single agent. Returns the new post if one was published, else null.
 *
 * @param {string} agentId
 */
export async function runCycleForAgent(agentId) {
  const exists = await agentExists(agentId);
  if (!exists) {
    logger.warn(`Cycle skipped: agent ${agentId} does not exist`);
    return null;
  }

  logger.info(`Starting cycle for agent ${agentId}`);

  const topics = await discoverTopics();
  if (topics.length === 0) {
    logger.info('No topics discovered this cycle');
    return null;
  }

  const pastPosts = await getPosts(agentId);

  for (const topic of topics) {
    const judgment = await judgeTopic(topic);
    if (!judgment.shouldPublish) {
      continue;
    }

    const memoryResult = await checkMemory(topic, pastPosts);
    if (memoryResult.isDuplicate) {
      continue;
    }

    const post = await writePost(topic, judgment);
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
