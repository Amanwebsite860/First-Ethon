// src/services/sources/rssFeeds.js
//
// RSS/Atom discovery sources — the "research papers" and "AI security
// blogs" legs of the multi-source discovery pipeline (see discovery.js).
// No API keys required for any of these.
//
// Each feed is fetched independently and fails soft: if one feed is down
// or its URL goes stale, that feed just contributes zero candidates this
// cycle rather than breaking discovery entirely. Feed URLs are the kind
// of thing that can rot over time — if one starts consistently failing,
// check FEEDS below and swap in a replacement.

import Parser from 'rss-parser';
import logger from '../../utils/logger.js';

const parser = new Parser({ timeout: 10_000 });

// How many entries to take from each individual feed per cycle. Kept
// small per-feed since these are aggregated with other sources — see
// CANDIDATE_LIMIT-equivalent capping in scoring.js / cycle.js.
const PER_FEED_LIMIT = 5;

// Curated list — no API keys needed. "source" is the human-readable name
// used in the candidate object and shown to the judge/writer prompts.
const FEEDS = [
  {
    url: 'https://rss.arxiv.org/rss/cs.CR',
    source: 'arXiv cs.CR',
    sourceType: 'research',
  },
  {
    url: 'https://feeds.feedburner.com/TheHackersNews',
    source: 'The Hacker News',
    sourceType: 'blog',
  },
  {
    url: 'https://krebsonsecurity.com/feed/',
    source: 'Krebs on Security',
    sourceType: 'blog',
  },
  {
    url: 'https://www.schneier.com/feed/atom/',
    source: 'Schneier on Security',
    sourceType: 'blog',
  },
];

/**
 * Fetch and normalize entries from a single RSS/Atom feed.
 * @param {{url: string, source: string, sourceType: string}} feedConfig
 */
async function fetchFeed({ url, source, sourceType }) {
  try {
    const feed = await parser.parseURL(url);
    const entries = (feed.items || []).slice(0, PER_FEED_LIMIT);

    return entries
      .filter((item) => item.title && item.link)
      .map((item) => ({
        title: item.title.trim(),
        url: item.link,
        source,
        sourceType,
        score: 0, // RSS entries have no native community score like HN points
        publishedAt: item.isoDate || item.pubDate || null,
      }));
  } catch (err) {
    logger.warn(`RSS feed "${source}" (${url}) failed, skipping`, err.message);
    return [];
  }
}

/**
 * Fetch candidate topics from all configured RSS/Atom feeds, in parallel.
 * A single feed failing does not affect the others.
 *
 * @returns {Promise<Array<{title: string, url: string, source: string, sourceType: string, score: number, publishedAt: string|null}>>}
 */
export async function fetchRssTopics() {
  const results = await Promise.all(FEEDS.map(fetchFeed));
  const topics = results.flat();
  logger.info(`Discovered ${topics.length} candidate topics from ${FEEDS.length} RSS feeds`);
  return topics;
}

export default fetchRssTopics;
