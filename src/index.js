// src/index.js
//
// Express app entrypoint. Wires up the two required endpoints:
//   POST /api/agent/init
//   GET  /api/agent/feed
//
// This file is also the entrypoint Vercel uses to run the app as a
// serverless function (exported as default) OR locally via `npm run dev`
// (listens on a port when run directly).

// Load .env in local dev (no-op on Vercel, which injects env vars directly).
import 'dotenv/config';
import express from 'express';
import initAgent from './routes/init.js';
import getFeed from './routes/feed.js';
import cronCycle from './routes/cron.js';
import checkEnv from './utils/checkEnv.js';
import logger from './utils/logger.js';

// Fail fast with a clear message if required config is missing, rather
// than surfacing a confusing error deep inside an LLM/storage call later.
checkEnv();

// Process-level safety net. During the 48-hour autonomous window, nobody
// is watching the process — an uncaught rejection from a stray promise
// (e.g. inside the cycle) should be logged, not silently swallowed or
// left to crash the whole server. On Vercel each invocation is short-lived
// anyway, but this also matters if this is ever run as a long-lived
// process (e.g. via pm2) instead.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
});

const app = express();

app.use(express.json());

app.post('/api/agent/init', initAgent);
app.get('/api/agent/feed', getFeed);
app.get('/api/cron/cycle', cronCycle);

// Simple health check — useful for confirming the deploy is alive, not
// part of the required spec.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 404 for anything else — keeps unmatched routes from falling through to
// a generic Express HTML error page.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler — catches anything thrown/rejected in a route that
// wasn't already handled locally, so the process never crashes on an
// unexpected error mid-cycle. Must be defined last, with 4 args, for
// Express to recognize it as an error handler.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  // body-parser (and some other middleware) throw errors that already
  // carry a meaningful client-error status (e.g. 400 for malformed JSON).
  // Respect that instead of always reporting 500, so a bad request from
  // the caller is correctly distinguished from an actual server failure.
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status >= 500) {
    logger.error('Unhandled error', err);
  } else {
    logger.warn('Client error', err.message);
  }
  res.status(status).json({ error: status < 500 ? 'Malformed request' : 'Internal server error' });
});

// Only start a listening server when run directly (local dev). When
// deployed on Vercel, the app is invoked as a serverless function instead.
if (process.env.NODE_ENV !== 'test' && process.argv[1]?.endsWith('index.js')) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info(`Server listening on http://localhost:${port}`);
  });
}

export default app;
