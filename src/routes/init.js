// src/routes/init.js
//
// POST /api/agent/init
// Called exactly once by the evaluator, before evaluation begins.
// Creates the agent record in storage and returns an agentId.
//
// Per the spec, the request body looks like:
//   { "persona": { "name": "Ada", "domain": "AI Security" } }
// We store whatever the evaluator sends (falling back to this project's
// default persona for any field not provided). That stored { name, domain }
// is the single source of truth for the agent's actual identity — every
// cron cycle rebuilds the active persona from it via
// config/persona.js's buildPersona(), so the agent genuinely writes as
// whatever name/domain was submitted here, not a hardcoded default.

import { generateAgentId } from '../utils/idGenerator.js';
import { createAgent, setCurrentAgentId } from '../storage/kvRepository.js';
import { persona as configuredPersona } from '../config/persona.js';
import logger from '../utils/logger.js';

/**
 * Express handler for POST /api/agent/init
 */
export async function initAgent(req, res) {
  try {
    const submittedPersona = req.body?.persona;

    // Use the submitted persona's name/domain if provided, otherwise fall
    // back to our configured persona. Voice/editorial stance always come
    // from config/persona.js regardless.
    const personaForStorage = {
      name: submittedPersona?.name || configuredPersona.name,
      domain: submittedPersona?.domain || configuredPersona.domain,
    };

    const agentId = generateAgentId();
    await createAgent(agentId, personaForStorage);
    await setCurrentAgentId(agentId);

    logger.info('Agent initialized', { agentId, persona: personaForStorage });

    return res.status(200).json({ agentId });
  } catch (err) {
    logger.error('Failed to initialize agent', err);
    return res.status(500).json({ error: 'Failed to initialize agent' });
  }
}

export default initAgent;
