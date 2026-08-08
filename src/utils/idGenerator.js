// src/utils/idGenerator.js
//
// Small ID helpers. Uses crypto.randomUUID (built into Node 18+) so there's
// no extra dependency.

import { randomUUID } from 'crypto';

/**
 * Generate a unique agent ID.
 */
export function generateAgentId() {
  return `agent-${randomUUID()}`;
}

/**
 * Generate a unique post ID.
 */
export function generatePostId() {
  return `post-${randomUUID()}`;
}
