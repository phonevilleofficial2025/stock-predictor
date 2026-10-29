import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initSchema } from './db.js';
import { ensureAdminAccount, requireAuth } from './lib/auth.js';
import { requireTurnstile } from './lib/turnstile.js';

import turnstileRouter from './routes/turnstile.js';
import authRouter from './routes/auth.js';
import uploadsRouter from './routes/uploads.js';
import stockRouter from './routes/stock.js';
import salesRouter from './routes/sales.js';
import predictionsRouter from './routes/predictions.js';
import cpfrRouter from './routes/cpfr.js';
import balanceRouter from './routes/balance.js';
import poRouter from './routes/po.js';
import rsiRouter from './routes/rsi.js';
import deviceMasterRouter from './routes/deviceMaster.js';

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/turnstile', turnstileRouter);

// Everything below requires passing the human-verification gate first (if
// TURNSTILE_SECRET_KEY is configured — a no-op otherwise), ahead of even login.
app.use('/api', requireTurnstile);

app.use('/api/auth', authRouter);

// Everything below requires a logged-in session.
app.use('/api', requireAuth);

app.use('/api/uploads', uploadsRouter);
app.use('/api', stockRouter);
app.use('/api', salesRouter);
app.use('/api', predictionsRouter);
app.use('/api', cpfrRouter);
app.use('/api', balanceRouter);
app.use('/api', poRouter);
app.use('/api', rsiRouter);
app.use('/api', deviceMasterRouter);

// Sentry's expressIntegration() (initialized in instrument.js, preloaded before
// this file) already auto-captures anything that reaches next(err) here — every
// asyncHandler-wrapped route — no separate Sentry error-handler needed.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

async function main() {
  await initSchema();
  await ensureAdminAccount();
  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}

main().catch(async (err) => {
  console.error('Startup failed:', err);
  Sentry.captureException(err);
  await Sentry.flush(2000); // give the event a moment to actually send before the process exits
  process.exit(1);
});
