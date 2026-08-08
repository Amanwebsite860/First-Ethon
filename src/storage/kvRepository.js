// src/storage/kvRepository.js
//
// Storage layer backed by Vercel KV. Each agent's posts are kept as a JSON
// array under a single key, keyed by agentId. This is intentionally simple:
// the feed size for a hackathon (~48 hrs, one cycle every 1-2 hrs) is small
// enough that "read whole array, mutate, write whole array" is fine — no
// need for per-post keys or pagination.
//
// Key shape:
//   agent:<agentId>:meta   -> { name, domain, createdAt }
//   agent:<agentId>:posts  -> [ { id, createdAt, text, rationale, sources }, ... ]

import { kv } from '@vercel/kv';

const metaKey = (agentId) => `agent:${agentId}:meta`;
const postsKey = (agentId) => `agent:${agentId}:posts`;

/**
 * Create a new agent record (persona + creation time).
 * @param {string} agentId
 * @param {{ name: string, domain: string }} persona
 */
export async function createAgent(agentId, persona) {
  const meta = {
    name: persona.name,
    domain: persona.domain,
    createdAt: new Date().toISOString(),
  };
  await kv.set(metaKey(agentId), meta);
  // Initialize an empty posts array so getPosts() never has to special-case
  // "key doesn't exist yet".
  await kv.set(postsKey(agentId), []);
  return meta;
}

/**
 * Fetch agent metadata (persona info). Returns null if the agent doesn't exist.
 * @param {string} agentId
 */
export async function getAgent(agentId) {
  const meta = await kv.get(metaKey(agentId));
  return meta ?? null;
}

/**
 * Fetch all posts for an agent, newest first.
 * @param {string} agentId
 * @returns {Promise<Array>}
 */
export async function getPosts(agentId) {
  const posts = await kv.get(postsKey(agentId));
  if (!Array.isArray(posts)) return [];
  // Defensive sort — the writer is expected to prepend new posts, but this
  // guarantees "reverse chronological" even if something appends instead.
  return [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Add a single new post for an agent. Prepends so newest is first.
 * @param {string} agentId
 * @param {{ id: string, createdAt: string, text: string, rationale: string, sources: string[] }} post
 */
export async function addPost(agentId, post) {
  const existing = await getPosts(agentId);
  const updated = [post, ...existing];
  await kv.set(postsKey(agentId), updated);
  return updated;
}

/**
 * Check whether an agent exists at all (used by routes to 404 on unknown agentId).
 * @param {string} agentId
 */
export async function agentExists(agentId) {
  const meta = await getAgent(agentId);
  return meta !== null;
}

// --- Current-agent pointer -------------------------------------------------
// Vercel KV doesn't give us a simple "list all agent keys" primitive here,
// and this hackathon's scope only ever has one live agent per submission
// (evaluator calls init exactly once). So we track "the current agent" under
// a fixed key, set at init time, and the cron cycle handler reads it to know
// which agent to run for. If multi-agent support is ever needed, this is the
// place to swap in a real index (e.g. a Set of agent IDs).

const CURRENT_AGENT_KEY = 'currentAgentId';

/**
 * Mark an agent as "the current agent" — called from init.
 * @param {string} agentId
 */
export async function setCurrentAgentId(agentId) {
  await kv.set(CURRENT_AGENT_KEY, agentId);
}

/**
 * Get the current agent's ID, if any has been initialized.
 * @returns {Promise<string|null>}
 */
export async function getCurrentAgentId() {
  const id = await kv.get(CURRENT_AGENT_KEY);
  return id ?? null;
}
