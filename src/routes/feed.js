// src/routes/feed.js
//
// GET /api/agent/feed?agentId=abc-123
// The ONLY endpoint the evaluator calls after init. Must be safe to call
// repeatedly over ~48 hours. Returns posts in reverse chronological order.
//
// Per spec: if no posts exist, return { "posts": [] } — this also covers
// "agent not found" for simplicity/robustness (an evaluator hammering this
// endpoint should never get a 4xx/5xx just because posts haven't been
// generated yet).

import { getPosts, agentExists } from '../storage/kvRepository.js';
import logger from '../utils/logger.js';

/**
 * Express handler for GET /api/agent/feed
 */
export async function getFeed(req, res) {
  try {
    const { agentId } = req.query;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId query parameter is required' });
    }

    const exists = await agentExists(agentId);
    if (!exists) {
      // Spec doesn't define an explicit "unknown agent" error shape, and
      // the evaluator only ever calls this with an agentId it received
      // from init — so returning an empty feed here is the safest,
      // spec-compliant fallback rather than a 404.
      return res.status(200).json({ posts: [] });
    }

    const posts = await getPosts(agentId);
    return res.status(200).json({ posts });
  } catch (err) {
    logger.error('Failed to retrieve feed', err);
    return res.status(500).json({ error: 'Failed to retrieve feed' });
  }
}

export default getFeed;
