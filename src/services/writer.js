// src/services/writer.js
//
// Writer — the final creative step. Takes an approved topic (already
// passed editorialJudge + memory checks) and generates the actual post
// text in the persona's voice, using a stronger model since output quality
// here is directly judged (per the evaluation criteria: "consistency of
// the AI persona" and "overall quality and coherence of the generated
// feed").
//
// Assembles the full post object required by the API spec:
//   { id, createdAt, text, rationale, sources }
// The "rationale" here combines whySelected + whyRelevantNow from the
// editorial judgment step — reusing that reasoning rather than asking the
// LLM to invent a new justification, so the stated rationale always
// matches the actual editorial decision.

import OpenAI from 'openai';
import { persona } from '../config/persona.js';
import { generatePostId } from '../utils/idGenerator.js';
import logger from '../utils/logger.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const WRITER_MODEL = process.env.OPENAI_MODEL_WRITER || 'gpt-4o';

function buildWriterPrompt(topic, judgment) {
  return `You are ${persona.name}, ${persona.tagline}

Bio: ${persona.bio}

Voice and style:
- Tone: ${persona.voice.tone}
- Style notes: ${persona.voice.style.join(' ')}
- Length: ${persona.voice.lengthGuidance}

Write a post about this topic, from your perspective as ${persona.name}:

Title: ${topic.title}
URL: ${topic.url}
Why this topic was selected: ${judgment.whySelected}
Why it's relevant now: ${judgment.whyRelevantNow}

Write ONLY the post text itself — no title, no headers, no "Here's a post:" preamble,
no hashtags unless they'd genuinely appear in this persona's natural writing.
Respond with ONLY valid JSON, no markdown fences:
{ "text": "the full post text" }`;
}

/**
 * Generate a full post object for an approved topic.
 *
 * @param {{title: string, url: string}} topic
 * @param {{whySelected: string, whyRelevantNow: string}} judgment
 * @returns {Promise<{id: string, createdAt: string, text: string, rationale: string, sources: string[]} | null>}
 */
export async function writePost(topic, judgment) {
  try {
    const completion = await client.chat.completions.create({
      model: WRITER_MODEL,
      messages: [{ role: 'user', content: buildWriterPrompt(topic, judgment) }],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const text = (parsed.text || '').trim();

    if (!text) {
      logger.warn(`Writer produced empty text for topic "${topic.title}", skipping post`);
      return null;
    }

    const rationale = [judgment.whySelected, judgment.whyRelevantNow]
      .filter(Boolean)
      .join(' ');

    return {
      id: generatePostId(),
      createdAt: new Date().toISOString(),
      text,
      rationale,
      sources: [topic.url],
    };
  } catch (err) {
    logger.error(`Writer failed for topic "${topic.title}"`, err);
    // Fail soft — no post this cycle rather than a broken/empty one.
    return null;
  }
}

export default writePost;
