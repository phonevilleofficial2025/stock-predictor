import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import './db.js';
import { ensureAdminAccount, requireAuth } from './lib/auth.js';

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

ensureAdminAccount();

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
