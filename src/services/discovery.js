// src/services/discovery.js
//
// Topic discovery — pulls candidate stories from the Hacker News API
// (free, no key required: https://github.com/HackerNews/API).
//
// Strategy: fetch the current "top stories" ID list, then fetch details
// for the first N of them. We return raw candidate topics; filtering for
// "is this actually AI/security relevant and worth posting about" is the
// editorialJudge service's job, not this one — discovery just surfaces
// what's out there.

import logger from '../utils/logger.js';

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';

// How many top stories to inspect per discovery cycle. Kept small since
// each one may get an LLM judgment call downstream — no need to fetch 500.
// Kept modest (not e.g. 30-50) because each candidate can trigger a
// Gemini judge call in scheduler/cycle.js — on Gemini's free tier, a
// large candidate list risks a burst that eats into a tight daily quota
// fast. See GEMINI_JUDGE_DELAY_MS in cycle.js for the related throttle.
const CANDIDATE_LIMIT = 10;

/**
 * Fetch a single HN item by ID.
 * @param {number} id
 */
async function fetchItem(id) {
  const res = await fetch(`${HN_BASE}/item/${id}.json`);
  if (!res.ok) {
    throw new Error(`HN item fetch failed for ${id}: ${res.status}`);
  }
  return res.json();
}

/**
 * Discover candidate topics from Hacker News top stories.
 * Returns a normalized list of { title, url, source, hnId, score, time }.
 *
 * @param {number} [limit=CANDIDATE_LIMIT]
 * @returns {Promise<Array<{title: string, url: string, source: string, hnId: number, score: number, time: string}>>}
 */
export async function discoverTopics(limit = CANDIDATE_LIMIT) {
  try {
    const res = await fetch(`${HN_BASE}/topstories.json`);
    if (!res.ok) {
      throw new Error(`HN topstories fetch failed: ${res.status}`);
    }
    const ids = await res.json();
    const candidateIds = ids.slice(0, limit);

    const items = await Promise.all(
      candidateIds.map((id) =>
        fetchItem(id).catch((err) => {
          logger.warn(`Skipping HN item ${id} due to fetch error`, err.message);
          return null;
        })
      )
    );

    const topics = items
      .filter((item) => item && item.title && (item.url || item.text))
      .map((item) => ({
        title: item.title,
        url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        source: 'Hacker News',
        hnId: item.id,
        score: item.score ?? 0,
        time: item.time ? new Date(item.time * 1000).toISOString() : null,
      }));

    logger.info(`Discovered ${topics.length} candidate topics from Hacker News`);
    return topics;
  } catch (err) {
    logger.error('Topic discovery failed', err);
    // Fail soft — an empty list means the cycle simply produces no post
    // this round, which is acceptable behavior (not every cycle needs a post).
    return [];
  }
}

export default discoverTopics;
