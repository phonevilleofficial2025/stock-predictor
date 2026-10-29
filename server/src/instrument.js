// Must be the very first thing that runs — preloaded via `node --import ./src/instrument.js`
// (see package.json scripts and Dockerfile) so Sentry can instrument express/pg/http
// before anything else imports them. A plain top-of-index.js import wouldn't work
// here: ESM fully evaluates index.js's own imports (db.js, which constructs the pg
// Pool) before running any of index.js's own statements, so Sentry.init() would run
// too late to patch pg if it lived in index.js itself.
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
  integrations: [Sentry.expressIntegration()],
  // Request/DB-query span timing. expressIntegration() also auto-captures
  // unhandled errors from routes/middleware (anything reaching next(err), which is
  // every asyncHandler-wrapped route) — no separate error-handler wiring needed.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 1.0),
  enabled: Boolean(dsn),
});
