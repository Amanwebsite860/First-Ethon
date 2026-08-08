// src/routes/cron.js
//
// GET /api/cron/cycle
// This is what Vercel Cron actually hits on a schedule (see vercel.json).
// It is NOT part of the required evaluator-facing API contract — it's the
// internal trigger that makes the agent autonomous. The evaluator never
// calls this directly.
//
// Protected by a shared secret (CRON_SECRET) so it can't be triggered by
// anyone who happens to guess the URL — Vercel Cron sends this
// automatically as an Authorization header when CRON_SECRET is configured.

import { runCycle } from '../scheduler/cycle.js';
import { getCurrentAgentId } from '../storage/kvRepository.js';
import logger from '../utils/logger.js';

export async function cronCycle(req, res) {
  try {
    // Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` for
    // scheduled invocations when CRON_SECRET is set as an env var. Skip
    // this check if CRON_SECRET isn't set (e.g. local dev).
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const authHeader = req.headers['authorization'];
      if (authHeader !== `Bearer ${secret}`) {
        logger.warn('Rejected unauthorized cron request');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const agentId = await getCurrentAgentId();
    if (!agentId) {
      logger.info('Cron fired but no agent has been initialized yet — skipping');
      return res.status(200).json({ ran: false, reason: 'no agent initialized' });
    }

    const post = await runCycle(agentId);
    return res.status(200).json({ ran: true, published: post !== null, postId: post?.id ?? null });
  } catch (err) {
    logger.error('Cron cycle handler failed', err);
    return res.status(500).json({ error: 'Cycle failed' });
  }
}

export default cronCycle;
