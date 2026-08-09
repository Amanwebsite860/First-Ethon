// src/routes/ui.js
//
// GET /api/ui/status
// NOT part of the evaluator-facing API contract (init/feed are the only
// required endpoints) — this exists purely so the homepage (public/index.html)
// can self-load without a visitor needing to paste an agentId into a form.
// Read-only, no secrets exposed: just the current agent's id, persona
// identity, and post count.

import { getCurrentAgentId, getAgent, getPosts } from '../storage/kvRepository.js';
import { buildPersona } from '../config/persona.js';
import logger from '../utils/logger.js';

// Real, currently-active config values, read live from process.env rather
// than hardcoded into the homepage HTML. A previous version of this page
// hardcoded "gemini-2.5-flash" and "Top 8" directly into the markup —
// which drifted from reality the moment the env vars changed, and (like
// the code-level fallback bugs elsewhere in this project) made a stale
// value look authoritative. This is the single source of truth the UI
// reads from instead.
function buildConfigSnapshot() {
  return {
    judgeModel: process.env.GEMINI_MODEL_JUDGE || null,
    writerModel: process.env.GEMINI_MODEL_WRITER || null,
    judgeTopN: Number(process.env.JUDGE_TOP_N || 3),
    judgeDelayMs: Number(process.env.GEMINI_JUDGE_DELAY_MS || 4500),
  };
}

export async function uiStatus(req, res) {
  try {
    const agentId = await getCurrentAgentId();
    if (!agentId) {
      return res.status(200).json({ initialized: false, config: buildConfigSnapshot() });
    }

    const agentMeta = await getAgent(agentId);
    if (!agentMeta) {
      return res.status(200).json({ initialized: false, config: buildConfigSnapshot() });
    }

    const persona = buildPersona(agentMeta);
    const posts = await getPosts(agentId);

    return res.status(200).json({
      initialized: true,
      agentId,
      persona: {
        name: persona.name,
        domain: persona.domain,
        tagline: persona.tagline,
      },
      createdAt: agentMeta.createdAt,
      postCount: posts.length,
      config: buildConfigSnapshot(),
    });
  } catch (err) {
    logger.error('UI status check failed', err);
    // buildConfigSnapshot() only reads process.env — it can't fail the way
    // getAgent()/getPosts() (KV reads) can — so there's no reason to drop
    // it here. Omitting it was itself a bug: any transient storage error
    // after an agent was already found silently blanked the spec panel on
    // the homepage, which looked like "the model isn't configured" even
    // when it plainly was — the config was just never sent down.
    return res.status(500).json({ error: 'Status check failed', config: buildConfigSnapshot() });
  }
}

export default uiStatus;
