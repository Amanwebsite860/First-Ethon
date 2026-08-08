// src/routes/init.js
//
// POST /api/agent/init
// Called exactly once by the evaluator, before evaluation begins.
// Creates the agent record in storage and returns an agentId.
//
// Per the spec, the request body looks like:
//   { "persona": { "name": "Ada", "domain": "AI Security" } }
// but per our architecture, the ACTUAL persona voice/stance is fixed in
// src/config/persona.js (Kai Renn) — we still accept + store whatever the
// evaluator sends for the "persona" field, since the spec requires the
// endpoint to accept it, but our internal agent always writes as Kai Renn.
// (If Aman wants the submitted persona to actually override the config,
// that's a one-line change here — flagging it, not deciding it silently.)

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
