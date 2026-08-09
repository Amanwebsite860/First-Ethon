// src/services/discovery.js
//
// Topic discovery aggregator. Previously this fetched ONLY Hacker News
// top stories — a real structural weakness, since a good AI security
// story might rank #30 or #100 on HN's front page (or never touch HN at
// all) and would simply never be seen. Now aggregates multiple sources:
//
//   Hacker News (sources/hackerNews.js)
//   arXiv cs.CR, security blogs (sources/rssFeeds.js)
//
// This module's job is purely to SURFACE candidates from wherever they
// come from — filtering for "is this actually worth posting about" is
// scoring.js (cheap heuristics) and editorialJudge.js (LLM judgment).

import { fetchHackerNewsTopics } from './sources/hackerNews.js';
import { fetchRssTopics } from './sources/rssFeeds.js';
import logger from '../utils/logger.js';

function normalizeUrl(url) {
  return (url || '').trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Discover candidate topics from all configured sources, deduplicated by
 * URL (the same story sometimes surfaces on HN AND a security blog).
 *
 * @returns {Promise<Array<{title: string, url: string, source: string, sourceType: string, score: number, publishedAt: string|null}>>}
 */
export async function discoverTopics() {
  const [hnTopics, rssTopics] = await Promise.all([
    fetchHackerNewsTopics(),
    fetchRssTopics(),
  ]);

  const combined = [...hnTopics, ...rssTopics];

  const seen = new Set();
  const deduped = [];
  for (const topic of combined) {
    const key = normalizeUrl(topic.url);
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(topic);
    }
  }

  logger.info(
    `Discovery pool: ${combined.length} raw candidates (${hnTopics.length} HN + ${rssTopics.length} RSS), ${deduped.length} after URL dedup`
  );

  return deduped;
}

export default discoverTopics;
