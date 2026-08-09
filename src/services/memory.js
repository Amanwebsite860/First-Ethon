// src/services/memory.js
//
// Memory / deduplication — satisfies the spec's "Memory" requirement:
// the agent must remember previously published content to maintain
// continuity and avoid unnecessary repetition.
//
// Two layers of checking, cheapest first:
//   1. Cheap heuristic: exact/near-exact URL or title match against past
//      posts' sources/text — catches the common case (HN resurfacing the
//      same story) with zero LLM cost.
//   2. LLM similarity check: only runs if the cheap check doesn't already
//      reject, and only against a short list of recent posts (not the
//      full history) to keep cost/latency bounded. Catches "same story,
//      different source" or "we already made this exact point."
//
// This keeps cost sane: most duplicate topics get caught by the free
// heuristic, and the LLM is a fallback, not the first line of defense.

import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger.js';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// Same fix as editorialJudge.js/writer.js — no hardcoded fallback. This
// module was actually missed in the first pass at this fix (it's a third,
// easy-to-overlook call site using the same env var), which is exactly
// the kind of gap a "find every instance" grep should catch rather than
// patching call sites one at a time as they're noticed.
const JUDGE_MODEL = process.env.GEMINI_MODEL_JUDGE;

// How many of the most recent posts to check the new topic against via LLM.
// Keeps prompt size and cost bounded even as the feed grows over 48 hours.
const RECENT_POSTS_WINDOW = 10;

function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Cheap heuristic check: does this topic's URL or title closely match
 * something already published? Exported so scoring.js can reuse it as a
 * pre-filter before candidates ever reach the (paid-quota) judge step,
 * rather than duplicating this logic.
 * @param {{title: string, url: string}} topic
 * @param {Array<{text: string, sources: string[]}>} pastPosts
 */
export function isObviousDuplicate(topic, pastPosts) {
  const normTitle = normalize(topic.title);
  const normUrl = normalize(topic.url);

  return pastPosts.some((post) => {
    const urlMatch = (post.sources || []).some((s) => normalize(s) === normUrl);
    // Simple substring check on title vs post text — cheap, imperfect,
    // but catches "we clearly already wrote about this exact URL/title".
    const titleMatch = normTitle.length > 0 && normalize(post.text).includes(normTitle);
    return urlMatch || titleMatch;
  });
}

/**
 * LLM-based similarity check against recent posts — catches topical
 * repetition even when the URL/title differs.
 * @param {{title: string, url: string}} topic
 * @param {Array<{text: string}>} recentPosts
 * @returns {Promise<{isDuplicate: boolean, reason: string}>}
 */
async function checkSimilarityViaLLM(topic, recentPosts) {
  if (recentPosts.length === 0) {
    return { isDuplicate: false, reason: '' };
  }

  const recentSummaries = recentPosts
    .map((p, i) => `${i + 1}. ${p.text.slice(0, 200)}`)
    .join('\n');

  const prompt = `Here are recent posts already published:
${recentSummaries}

New candidate topic: "${topic.title}" (${topic.url})

Would a post about this new topic be substantially repetitive of the recent posts above
(same core story, same point already made)? Minor topical overlap in a shared domain
(e.g. both about AI security in general) is NOT repetitive — only flag near-duplicate
stories or already-made points.

Respond with ONLY valid JSON, no markdown fences:
{ "isDuplicate": true or false, "reason": "one short sentence" }`;

  try {
    const response = await client.models.generateContent({
      model: JUDGE_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });
    const raw = (response.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(raw || '{}');
    return {
      isDuplicate: Boolean(parsed.isDuplicate),
      reason: parsed.reason || '',
    };
  } catch (err) {
    logger.error('Similarity check failed, defaulting to not-duplicate', err);
    // Fail open here (assume not duplicate) — memory is a quality feature,
    // not a hard safety gate, and we'd rather occasionally repeat than
    // silently starve the feed if the LLM call errors.
    return { isDuplicate: false, reason: '' };
  }
}

/**
 * Determine whether a candidate topic is too similar to what's already
 * been published, checking cheap heuristics first, then LLM similarity.
 *
 * @param {{title: string, url: string}} topic
 * @param {Array<{text: string, sources: string[]}>} pastPosts - full post history, newest first
 * @returns {Promise<{isDuplicate: boolean, reason: string}>}
 */
export async function checkMemory(topic, pastPosts) {
  if (isObviousDuplicate(topic, pastPosts)) {
    logger.info(`Topic "${topic.title}" rejected: obvious duplicate (heuristic match)`);
    return { isDuplicate: true, reason: 'Matches a previously published source or title.' };
  }

  const recentPosts = pastPosts.slice(0, RECENT_POSTS_WINDOW);
  const result = await checkSimilarityViaLLM(topic, recentPosts);

  if (result.isDuplicate) {
    logger.info(`Topic "${topic.title}" rejected: similar to recent post (${result.reason})`);
  }

  return result;
}

export default checkMemory;
