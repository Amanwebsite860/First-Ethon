// src/services/sources/hackerNews.js
//
// One of several discovery sources (see services/discovery.js for the
// aggregator). Pulls candidate stories from the Hacker News API (free, no
// key required: https://github.com/HackerNews/API).
//
// Historically this was the ONLY discovery source, which was a real
// weakness: a good AI security story might rank #30 or #100 on HN's front
// page — outside the "top stories" window this module inspects — and the
// system would simply never see it. Multi-source discovery (this file +
// rssFeeds.js, aggregated in discovery.js) exists specifically to reduce
// that blind spot rather than relying on HN's front-page ranking as a
// proxy for "worth covering."

import logger from '../../utils/logger.js';

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';

// How many top stories to inspect. Kept modest since each candidate can
// trigger downstream cost (scoring + potentially a judge call) — see
// scoring.js and the JUDGE_TOP_N cap in scheduler/cycle.js.
const HN_LIMIT = 10;

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
 * Fetch candidate topics from Hacker News top stories.
 * Returns a normalized list matching the shared candidate shape used by
 * every source (see rssFeeds.js for the same shape).
 *
 * @param {number} [limit=HN_LIMIT]
 * @returns {Promise<Array<{title: string, url: string, source: string, sourceType: string, hnId: number, score: number, publishedAt: string|null}>>}
 */
export async function fetchHackerNewsTopics(limit = HN_LIMIT) {
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
        sourceType: 'hn',
        hnId: item.id,
        score: item.score ?? 0,
        publishedAt: item.time ? new Date(item.time * 1000).toISOString() : null,
      }));

    logger.info(`Discovered ${topics.length} candidate topics from Hacker News`);
    return topics;
  } catch (err) {
    logger.error('Hacker News discovery failed', err);
    // Fail soft — this source contributing nothing doesn't block the
    // other sources in discovery.js from still producing candidates.
    return [];
  }
}

export default fetchHackerNewsTopics;
