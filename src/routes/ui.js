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

export async function uiStatus(req, res) {
  try {
    const agentId = await getCurrentAgentId();
    if (!agentId) {
      return res.status(200).json({ initialized: false });
    }

    const agentMeta = await getAgent(agentId);
    if (!agentMeta) {
      return res.status(200).json({ initialized: false });
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
    });
  } catch (err) {
    logger.error('UI status check failed', err);
    return res.status(500).json({ error: 'Status check failed' });
  }
}

export default uiStatus;
