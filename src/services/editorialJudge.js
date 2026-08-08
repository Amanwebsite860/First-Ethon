// src/services/editorialJudge.js
//
// Editorial judgment — given a candidate topic (from discovery.js) and the
// persona's editorial stance (config/persona.js), decides whether it's
// worth writing a post about. Uses a cheap/fast model since this is a
// binary-ish decision, not the final creative output.
//
// Output feeds directly into the "rationale" fields required by the spec:
// every published post must state why the topic was selected and why it's
// relevant now — so this step doesn't just return true/false, it returns
// the reasoning too, which the writer step will reuse/expand on.

import { GoogleGenAI } from '@google/genai';
import { persona } from '../config/persona.js';
import logger from '../utils/logger.js';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const JUDGE_MODEL = process.env.GEMINI_MODEL_JUDGE || 'gemini-2.5-flash';

function buildJudgePrompt(topic) {
  return `You are the editorial gatekeeper for an AI persona named ${persona.name} (${persona.domain}).

Persona bio: ${persona.bio}

Topics this persona covers: ${persona.editorialStance.coversTopics.join('; ')}
Topics this persona avoids: ${persona.editorialStance.avoidsTopics.join('; ')}
Relevance bar: ${persona.editorialStance.relevanceBar}

Candidate topic:
Title: ${topic.title}
URL: ${topic.url}
Source: ${topic.source}
Score: ${topic.score}

Decide whether this persona should publish a post about this topic.

Respond with ONLY valid JSON, no markdown fences, in this exact shape:
{
  "shouldPublish": true or false,
  "whySelected": "one or two sentences on why this fits the persona (only if shouldPublish is true, else empty string)",
  "whyRelevantNow": "one or two sentences on why this is timely (only if shouldPublish is true, else empty string)",
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

/**
 * Judge a single candidate topic.
 * @param {{title: string, url: string, source: string, score: number}} topic
 * @returns {Promise<{shouldPublish: boolean, whySelected: string, whyRelevantNow: string, rejectionReason: string}>}
 */
export async function judgeTopic(topic) {
  try {
    const response = await client.models.generateContent({
      model: JUDGE_MODEL,
      contents: buildJudgePrompt(topic),
      config: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(extractJsonText(response) || '{}');

    return {
      shouldPublish: Boolean(parsed.shouldPublish),
      whySelected: parsed.whySelected || '',
      whyRelevantNow: parsed.whyRelevantNow || '',
      rejectionReason: parsed.rejectionReason || '',
    };
  } catch (err) {
    logger.error(`Editorial judgment failed for topic "${topic.title}"`, err);
    // Fail closed — if the judge call errors, don't publish.
    return {
      shouldPublish: false,
      whySelected: '',
      whyRelevantNow: '',
      rejectionReason: 'Judgment call failed due to an internal error.',
    };
  }
}

/**
 * Judge a list of candidate topics and return only the ones approved for
 * publishing, along with their rationale.
 * @param {Array<{title: string, url: string, source: string, score: number}>} topics
 */
export async function judgeTopics(topics) {
  const results = [];
  for (const topic of topics) {
    const judgment = await judgeTopic(topic);
    if (judgment.shouldPublish) {
      results.push({ topic, judgment });
    } else {
      logger.info(`Rejected topic "${topic.title}": ${judgment.rejectionReason}`);
    }
  }
  return results;
}

export default judgeTopic;
