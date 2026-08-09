// src/services/editorialJudge.js
//
// Editorial judgment — given a candidate topic (from discovery.js, already
// pre-filtered/ranked by scoring.js) and the persona's editorial stance
// (config/persona.js), decides whether it's worth writing a post about.
// Uses a cheap/fast model since this is one call per surviving candidate,
// not the final creative output.
//
// Output feeds directly into what the writer step needs:
//   - shouldPublish: the actual decision
//   - whySelected / whyRelevantNow: required for the spec's "rationale"
//     field on every published post
//   - angle: the specific editorial point of view the writer should take
//     (e.g. "the interesting part isn't X, it's Y") — without this, the
//     writer just restates the topic; with it, the post has a stance
//   - relevanceScore / noveltyScore / sourceQualityScore / securityImportance:
//     0-10 self-assessed scores, useful for logging/debugging judge
//     behavior over time and for tie-breaking if multiple candidates pass

import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger.js';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// No hardcoded fallback here on purpose — a silent fallback to a specific
// model string is exactly what caused a real incident (see CHANGELOG):
// Vercel env vars weren't actually applied to a deployment, and the app
// kept quietly calling a since-retired model instead of erroring loudly.
// GEMINI_MODEL_JUDGE is now enforced as required in checkEnv.js, so by
// the time this module runs, it's guaranteed to be set.
const JUDGE_MODEL = process.env.GEMINI_MODEL_JUDGE;

function buildJudgePrompt(topic, heuristicScores, persona) {
  const heuristicNote = heuristicScores
    ? `\nPre-computed heuristic signals (cheap keyword/recency-based estimates, for context only — use your own judgment, don't just defer to these):
- Source quality: ${heuristicScores.sourceQuality}/10
- Recency: ${heuristicScores.recency}/10
- Keyword-based security relevance: ${heuristicScores.securityRelevance}/10
- Keyword-based technical depth: ${heuristicScores.technicalDepth}/10\n`
    : '';

  return `You are the editorial gatekeeper for an AI persona named ${persona.name} (${persona.domain}).

Persona bio: ${persona.bio}

Topics this persona covers: ${persona.editorialStance.coversTopics.join('; ')}
Topics this persona avoids: ${persona.editorialStance.avoidsTopics.join('; ')}
Relevance bar: ${persona.editorialStance.relevanceBar}

Candidate topic:
Title: ${topic.title}
URL: ${topic.url}
Source: ${topic.source}
${heuristicNote}
Decide whether this persona should publish a post about this topic. If yes, also
identify the specific EDITORIAL ANGLE — not just a restatement of the topic, but
the particular point worth making. For example, for a prompt injection story, a
weak angle is "prompt injection is a risk"; a strong angle is "the interesting
part isn't that the attack exists, it's that it bypasses a defense assumed to
mitigate it." Base the angle only on what the title/source actually establish —
don't invent specifics you don't have.

Respond with ONLY valid JSON, no markdown fences, in this exact shape:
{
  "shouldPublish": true or false,
  "relevanceScore": 0-10 (how well this fits the persona's coverage area),
  "noveltyScore": 0-10 (how fresh/non-repetitive this angle is, best guess without full post history),
  "sourceQualityScore": 0-10 (how credible/substantive the source appears),
  "securityImportance": 0-10 (how significant this is from a security standpoint),
  "whySelected": "one or two sentences on why this fits the persona (only if shouldPublish is true, else empty string)",
  "whyRelevantNow": "one or two sentences on why this is timely (only if shouldPublish is true, else empty string)",
  "angle": "the specific editorial point of view for the writer to take (only if shouldPublish is true, else empty string)",
  "rejectionReason": "one short sentence why not, ONLY if shouldPublish is false, else empty string"
}`;
}

/**
 * Extract the raw text from a Gemini generateContent response and strip
 * markdown code fences if the model wraps its JSON in them despite being
 * asked not to (this happens occasionally even with JSON mode).
 * @param {any} response
 */
function extractJsonText(response) {
  const raw = (response.text || '').trim();
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
}

function clampScore(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

/**
 * Judge a single candidate topic.
 * @param {{title: string, url: string, source: string, score: number}} topic
 * @param {{sourceQuality: number, recency: number, securityRelevance: number, technicalDepth: number}} heuristicScores
 *   Cheap scores from scoring.js, passed as grounding context.
 * @param {object} persona - the active agent's persona, from config/persona.js's buildPersona()
 * @returns {Promise<{shouldPublish: boolean, relevanceScore: number, noveltyScore: number, sourceQualityScore: number, securityImportance: number, whySelected: string, whyRelevantNow: string, angle: string, rejectionReason: string}>}
 */
export async function judgeTopic(topic, heuristicScores, persona) {
  try {
    const response = await client.models.generateContent({
      model: JUDGE_MODEL,
      contents: buildJudgePrompt(topic, heuristicScores, persona),
      config: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(extractJsonText(response) || '{}');

    return {
      shouldPublish: Boolean(parsed.shouldPublish),
      relevanceScore: clampScore(parsed.relevanceScore),
      noveltyScore: clampScore(parsed.noveltyScore),
      sourceQualityScore: clampScore(parsed.sourceQualityScore),
      securityImportance: clampScore(parsed.securityImportance),
      whySelected: parsed.whySelected || '',
      whyRelevantNow: parsed.whyRelevantNow || '',
      angle: parsed.angle || '',
      rejectionReason: parsed.rejectionReason || '',
    };
  } catch (err) {
    logger.error(`Editorial judgment failed for topic "${topic.title}"`, err);
    // Fail closed — if the judge call errors, don't publish.
    return {
      shouldPublish: false,
      relevanceScore: 0,
      noveltyScore: 0,
      sourceQualityScore: 0,
      securityImportance: 0,
      whySelected: '',
      whyRelevantNow: '',
      angle: '',
      rejectionReason: 'Judgment call failed due to an internal error.',
    };
  }
}

export default judgeTopic;
