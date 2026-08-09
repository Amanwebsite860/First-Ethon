// src/utils/checkEnv.js
//
// Fail-fast startup validation. Rather than letting a missing API key
// surface as a confusing error deep inside an LLM call mid-cycle (possibly
// hours into the 48-hour evaluation window), check required env vars once
// at boot and log a clear, actionable error immediately.

import logger from './logger.js';

<<<<<<< HEAD
const REQUIRED_VARS = [
  'GEMINI_API_KEY',
  // GEMINI_MODEL_JUDGE / GEMINI_MODEL_WRITER used to have hardcoded
  // fallbacks (gemini-2.5-flash) so a missing/un-propagated env var
  // never surfaced as an error — the app just quietly kept calling a
  // model that had since been retired for new users. Making these
  // required means a misconfigured deployment fails loudly at boot
  // instead of silently degrading mid-cycle hours into the evaluation
  // window.
  'GEMINI_MODEL_JUDGE',
  'GEMINI_MODEL_WRITER',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
];
=======
const REQUIRED_VARS = ['GEMINI_API_KEY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
>>>>>>> ba5ccf05fcce6b7cc38d3cc040a3bbc9a1feeb2d

// Not required to boot, but worth warning about since their absence
// silently changes behavior (e.g. cron endpoint becomes unauthenticated).
const RECOMMENDED_VARS = ['CRON_SECRET'];

/**
 * Check required/recommended environment variables. Logs errors for
 * missing required vars and warnings for missing recommended ones.
 * Does NOT exit the process itself — caller decides what to do, since
 * behavior differs between local dev (fine to warn and continue) and a
 * real deploy (might want to hard-fail).
 *
 * @returns {{ ok: boolean, missingRequired: string[] }}
 */
export function checkEnv() {
  const missingRequired = REQUIRED_VARS.filter((key) => !process.env[key]);
  const missingRecommended = RECOMMENDED_VARS.filter((key) => !process.env[key]);

  if (missingRequired.length > 0) {
    logger.error(
      `Missing required environment variable(s): ${missingRequired.join(', ')}. ` +
        'See .env.example for what these should be. The app will likely fail ' +
        'when it tries to call the LLM or storage.'
    );
  }

  if (missingRecommended.length > 0) {
    logger.warn(
      `Missing recommended environment variable(s): ${missingRecommended.join(', ')}. ` +
        'CRON_SECRET in particular: without it, /api/cron/cycle is unauthenticated.'
    );
  }

  return { ok: missingRequired.length === 0, missingRequired };
}

export default checkEnv;
