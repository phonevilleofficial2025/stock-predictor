import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  COOKIE_NAME, findUserByUsername, findUserById, verifyPassword, hashPassword,
  createSession, getSession, deleteSession, deleteOtherSessions, hasAnyUser, requireAuth, updateAccount,
} from '../lib/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();
const COOKIE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MIN_PASSWORD_LENGTH = 8;

// Keyed by req.ip (correct per-client thanks to `trust proxy` in index.js, not the
// shared Traefik hop) — Turnstile only has to be solved once per 24h, so without
// this a verified browser could otherwise brute-force the single admin password
// with no limit at all.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count — a correct login after a typo isn't penalized
  message: { error: 'Too many login attempts — please try again in a few minutes.' },
});

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = await createSession(user.id);
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: COOKIE_MAX_AGE_MS });
  res.json({ ok: true, username: user.username });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) await deleteSession(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
}));

router.get('/me', asyncHandler(async (req, res) => {
  const session = await getSession(req.cookies?.[COOKIE_NAME]);
  if (!session) return res.status(401).json({ error: 'Not logged in', needsSetup: !(await hasAnyUser()) });
  res.json({ ok: true, username: session.username });
}));

router.put('/account', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body || {};
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });

  const user = await findUserById(req.user.id);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    // 403, not 401: the session itself is still valid — only this specific action
    // (re-confirming the password) was refused, so the client shouldn't treat it as an
    // expired/invalid session and force a logout.
    return res.status(403).json({ error: 'Current password is incorrect' });
  }

  let username = user.username;
  const trimmedUsername = typeof newUsername === 'string' ? newUsername.trim() : '';
  if (trimmedUsername && trimmedUsername !== user.username) {
    const existing = await findUserByUsername(trimmedUsername);
    if (existing) return res.status(409).json({ error: 'That username is already taken' });
    username = trimmedUsername;
  }

  let passwordHash = user.password_hash;
  let passwordChanged = false;
  if (typeof newPassword === 'string' && newPassword.length > 0) {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    passwordHash = hashPassword(newPassword);
    passwordChanged = true;
  }

  await updateAccount(user.id, { username, passwordHash });
  if (passwordChanged) await deleteOtherSessions(user.id, req.cookies?.[COOKIE_NAME]);

  res.json({ ok: true, username });
}));

export default router;
