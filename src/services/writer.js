// src/services/writer.js
//
// Writer — the final creative step. Takes an approved topic (already
// passed editorialJudge + memory checks) and generates the actual post
// text in the persona's voice, using a stronger model since output quality
// here is directly judged (per the evaluation criteria: "consistency of
// the AI persona" and "overall quality and coherence of the generated
// feed").
//
// Pipeline this feeds from (see scheduler/cycle.js):
//   topic -> editorial judgment (incl. angle) -> memory/recent context -> writer
// rather than just topic -> writer. The writer is given:
//   - the judge's specific editorial ANGLE (the point of view to take,
//     not just the raw topic — see editorialJudge.js)
//   - a short summary of recent posts, so it can avoid repeating a point
//     already made and (loosely) maintain continuity of voice/opinion
//
// Factuality: the writer only ever receives a title/URL/angle, never full
// article text, so it's explicitly instructed not to invent specifics
// (numbers, CVEs, researcher/company names, technical mechanisms) beyond
// what's given. The model's own "claims" self-report is parsed for
// internal logging but deliberately NOT persisted into the stored post
// object — the API contract (id, createdAt, text, rationale, sources)
// must not deviate, so this stays an internal quality signal only.
//
// Assembles the full post object required by the API spec:
//   { id, createdAt, text, rationale, sources }
// The "rationale" here combines whySelected + whyRelevantNow from the
// editorial judgment step — reusing that reasoning rather than asking the
// LLM to invent a new justification, so the stated rationale always
// matches the actual editorial decision.

import { GoogleGenAI } from '@google/genai';
import { generatePostId } from '../utils/idGenerator.js';
import logger from '../utils/logger.js';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// No hardcoded fallback here on purpose (see editorialJudge.js for the
// full reasoning) — a silently-applied default model string is what
// caused production to keep calling a retired model after env vars were
// changed in the Vercel dashboard but the deployment wasn't picking them
// up. GEMINI_MODEL_WRITER is enforced as required in checkEnv.js.
const WRITER_MODEL = process.env.GEMINI_MODEL_WRITER;

// How many recent posts to summarize into the writer's prompt as "what
// has Kai already said" context. Kept small — this is for light
// continuity/avoiding repetition, not a full history dump.
const RECENT_CONTEXT_WINDOW = 3;

function buildRecentContextBlock(recentPosts) {
  if (!recentPosts || recentPosts.length === 0) {
    return 'No prior posts yet — this is one of the first.';
  }
  return recentPosts
    .slice(0, RECENT_CONTEXT_WINDOW)
    .map((p, i) => `${i + 1}. ${p.text.slice(0, 200)}`)
    .join('\n');
}

function buildWriterPrompt(topic, judgment, recentPosts, persona) {
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
Editorial angle to take (this is the specific point to make, not just a summary): ${judgment.angle || judgment.whySelected}

What Kai has said recently (for continuity — don't repeat these points, and stay consistent with any opinions expressed):
${buildRecentContextBlock(recentPosts)}

FACTUALITY — this matters a lot:
Only make factual claims that are directly supported by the title, URL, and
the editorial context given above. Do NOT invent CVEs, specific numbers,
researcher names, company names, attack technique names, or other technical
details that were not provided to you. If you don't have a specific detail,
write about the topic more generally rather than fabricating specifics.

Write ONLY the post text itself — no title, no headers, no "Here's a post:"
preamble, no hashtags unless they'd genuinely appear in this persona's
natural writing.
Respond with ONLY valid JSON, no markdown fences:
{
  "text": "the full post text",
  "claims": ["short list of the specific factual claims made in the post, for internal review only"]
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
 * Generate a full post object for an approved topic.
 *
 * @param {{title: string, url: string}} topic
 * @param {{whySelected: string, whyRelevantNow: string, angle?: string}} judgment
 * @param {Array<{text: string}>} recentPosts - most recent past posts, for continuity context
 * @param {object} persona - the active agent's persona, from config/persona.js's buildPersona()
 * @returns {Promise<{id: string, createdAt: string, text: string, rationale: string, sources: string[]} | null>}
 */
export async function writePost(topic, judgment, recentPosts = [], persona) {
  try {
    const response = await client.models.generateContent({
      model: WRITER_MODEL,
      contents: buildWriterPrompt(topic, judgment, recentPosts, persona),
      config: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(extractJsonText(response) || '{}');
    const text = (parsed.text || '').trim();

    if (!text) {
      logger.warn(`Writer produced empty text for topic "${topic.title}", skipping post`);
      return null;
    }

    // Internal-only quality signal: log the model's self-reported claims
    // for later review, but deliberately do NOT persist them into the
    // stored post object — the API contract's post shape must not deviate.
    if (Array.isArray(parsed.claims) && parsed.claims.length > 0) {
      logger.info(`Writer claims for "${topic.title}": ${parsed.claims.join(' | ')}`);
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
