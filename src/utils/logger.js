// src/utils/logger.js
//
// Minimal structured logging. Deliberately simple for a hackathon — just
// timestamps + level-prefixed console output. Swap for something heavier
// later if needed.

function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info: (...args) => console.log(`[${timestamp()}] [INFO]`, ...args),
  warn: (...args) => console.warn(`[${timestamp()}] [WARN]`, ...args),
  error: (...args) => console.error(`[${timestamp()}] [ERROR]`, ...args),
};

export default logger;
