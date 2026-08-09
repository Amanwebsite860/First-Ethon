// src/services/scoring.js
//
// Cheap, non-LLM candidate scoring and ranking. Runs BETWEEN discovery and
// the Gemini judge, for two reasons:
//
//   1. Quality: a bigger multi-source candidate pool (see discovery.js)
//      needs ranking so the judge sees the most promising candidates
//      first, not just whatever order sources happened to return them in.
//   2. Cost: every candidate sent to editorialJudge.js costs a Gemini
//      call. On a free-tier quota, sending all 20-30 raw candidates from
//      a multi-source pool would blow through the budget fast. This
//      module filters out clear non-fits and obvious duplicates for
//      free, then hard-caps the survivors to JUDGE_TOP_N before the judge
//      ever runs — directly reducing unnecessary Gemini calls.
//
// Nothing here calls an LLM. All scores are heuristic (keyword matching,
// source weighting, recency buckets) — approximate by nature, not a
// substitute for the judge's actual editorial reasoning. The judge still
// makes the real shouldPublish decision; this just decides who gets asked.

import { isObviousDuplicate } from './memory.js';
import logger from '../utils/logger.js';

// How many top-ranked candidates get sent to the (costly) judge step.
// See GEMINI_JUDGE_DELAY_MS in scheduler/cycle.js for the related
// per-call throttle within this budget.
<<<<<<< HEAD
//
// This one keeps a numeric default rather than joining the required-vars
// list (unlike the model vars above) — an unset JUDGE_TOP_N is a mild
// cost/quality tradeoff, not a hard failure like calling a dead model.
// But `|| 8` was a real bug: Number(undefined) is NaN, and NaN || 8
// silently falls through to 8 even when someone deliberately configured
// a lower value that failed to propagate — which is exactly what masked
// the env var propagation bug in the first place (logs kept showing
// "top 8 sent to judge" and looked like a fresh default, not a symptom).
// Parsing the fallback inside Number(...) instead makes 3 the actual
// project default, so a propagation failure reproduces obviously instead
// of quietly resembling the old pre-fix behavior.
const JUDGE_TOP_N = Number(process.env.JUDGE_TOP_N || 3);
=======
const JUDGE_TOP_N = Number(process.env.JUDGE_TOP_N) || 8;
>>>>>>> ba5ccf05fcce6b7cc38d3cc040a3bbc9a1feeb2d

// Per-source static quality weight (0-10). Curated feeds (research,
// established security journalism) are weighted above a raw HN listing,
// since HN's signal is noisier (anything can hit the front page).
const SOURCE_QUALITY = {
  'arXiv cs.CR': 9,
  'Krebs on Security': 8,
  'Schneier on Security': 8,
  'The Hacker News': 7,
  'Hacker News': 5,
};

const TECHNICAL_DEPTH_KEYWORDS = [
  'cve', 'exploit', 'vulnerability', 'poc', 'proof of concept', 'arxiv',
  'paper', 'research', 'attack', 'bypass', 'backdoor', 'rce', 'zero-day',
  'zero day', 'disclosure', 'advisory',
];

function normalizeText(str) {
  return (str || '').toLowerCase();
}

function countKeywordHits(text, keywords) {
  const norm = normalizeText(text);
  return keywords.reduce((count, kw) => (norm.includes(kw) ? count + 1 : count), 0);
}

/**
 * Source quality score (0-10), with a small bonus for well-upvoted HN
 * stories (community signal on top of the base per-source weight).
 */
function scoreSourceQuality(topic) {
  const base = SOURCE_QUALITY[topic.source] ?? 5;
  if (topic.sourceType === 'hn' && topic.score >= 200) {
    return Math.min(10, base + 2);
  }
  if (topic.sourceType === 'hn' && topic.score >= 50) {
    return Math.min(10, base + 1);
  }
  return base;
}

/**
 * Recency score (0-10), bucketed by age. Missing timestamps get a
 * neutral score rather than being rewarded or punished for absent data.
 */
function scoreRecency(topic) {
  if (!topic.publishedAt) {
    return 5;
  }
  const ageMs = Date.now() - new Date(topic.publishedAt).getTime();
  if (Number.isNaN(ageMs)) {
    return 5;
  }
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 6) return 10;
  if (ageHours < 24) return 8;
  if (ageHours < 72) return 5;
  if (ageHours < 168) return 2;
  return 0;
}

/**
 * Security-relevance score (0-10) — keyword overlap with the active
 * persona's curated coversTopics keyword list. This is intentionally
 * crude (title keyword matching, not semantic understanding) — it's a
 * cheap pre-filter, not a replacement for the judge's actual reasoning.
 */
function scoreSecurityRelevance(topic, persona) {
  const hits = countKeywordHits(topic.title, persona.editorialStance.securityKeywords);
  return Math.min(10, hits * 3);
}

/**
 * Technical-depth score (0-10) — proxy for "is this substantive coverage
 * vs. a surface-level mention," via keyword matching plus a bonus for
 * research-type sources.
 */
function scoreTechnicalDepth(topic) {
  const hits = countKeywordHits(topic.title, TECHNICAL_DEPTH_KEYWORDS);
  const base = Math.min(8, hits * 3);
  return topic.sourceType === 'research' ? Math.min(10, base + 2) : base;
}

/**
 * Score, filter, and rank a pool of candidate topics, returning at most
 * JUDGE_TOP_N of them for the judge to evaluate.
 *
 * Filtering (candidates removed entirely, never scored/ranked):
 *   - Title matches a persona avoidKeyword (promotional/off-topic noise)
 *   - Obvious duplicate of an already-published post (heuristic, same
 *     check memory.js uses — reused here so a known-repeat topic never
 *     even costs a judge call)
 *
 * @param {Array<object>} topics - raw candidates from discovery.js
 * @param {Array<{text: string, sources: string[]}>} pastPosts
 * @param {object} persona - the active agent's persona, from config/persona.js's buildPersona()
 * @returns {Array<{topic: object, scores: object, rankScore: number}>}
 */
export function scoreAndRankTopics(topics, pastPosts = [], persona) {
  const survivors = [];

  for (const topic of topics) {
    const avoidHit = persona.editorialStance.avoidKeywords.find((kw) =>
      normalizeText(topic.title).includes(kw)
    );
    if (avoidHit) {
      logger.info(`Filtered "${topic.title}": matched avoid-keyword "${avoidHit.trim()}"`);
      continue;
    }

    if (isObviousDuplicate(topic, pastPosts)) {
      logger.info(`Filtered "${topic.title}": obvious duplicate of a past post`);
      continue;
    }

    const scores = {
      sourceQuality: scoreSourceQuality(topic),
      recency: scoreRecency(topic),
      securityRelevance: scoreSecurityRelevance(topic, persona),
      technicalDepth: scoreTechnicalDepth(topic),
    };

    // Security relevance dominates — it's the actual editorial fit signal.
    // Recency and source quality matter for "why now" / trustworthiness.
    // Technical depth is a smaller modifier.
    const rankScore =
      scores.securityRelevance * 0.4 +
      scores.recency * 0.2 +
      scores.sourceQuality * 0.2 +
      scores.technicalDepth * 0.2;

    survivors.push({ topic, scores, rankScore });
  }

  survivors.sort((a, b) => b.rankScore - a.rankScore);
  const ranked = survivors.slice(0, JUDGE_TOP_N);

  logger.info(
    `Scoring: ${topics.length} raw candidates -> ${survivors.length} after filtering -> top ${ranked.length} sent to judge`
  );

  return ranked;
}

export default scoreAndRankTopics;
