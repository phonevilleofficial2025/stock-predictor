import { Router } from 'express';
import {
  COOKIE_NAME, findUserByUsername, findUserById, verifyPassword, hashPassword,
  createSession, getSession, deleteSession, deleteOtherSessions, hasAnyUser, requireAuth, updateAccount,
} from '../lib/auth.js';

const router = Router();
const COOKIE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MIN_PASSWORD_LENGTH = 8;

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const user = findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createSession(user.id);
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: COOKIE_MAX_AGE_MS });
  res.json({ ok: true, username: user.username });
});

router.post('/logout', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) deleteSession(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const session = getSession(req.cookies?.[COOKIE_NAME]);
  if (!session) return res.status(401).json({ error: 'Not logged in', needsSetup: !hasAnyUser() });
  res.json({ ok: true, username: session.username });
});

router.put('/account', requireAuth, (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body || {};
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });

  const user = findUserById(req.user.id);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    // 403, not 401: the session itself is still valid — only this specific action
    // (re-confirming the password) was refused, so the client shouldn't treat it as an
    // expired/invalid session and force a logout.
    return res.status(403).json({ error: 'Current password is incorrect' });
  }

  let username = user.username;
  const trimmedUsername = typeof newUsername === 'string' ? newUsername.trim() : '';
  if (trimmedUsername && trimmedUsername !== user.username) {
    const existing = findUserByUsername(trimmedUsername);
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

  updateAccount(user.id, { username, passwordHash });
  if (passwordChanged) deleteOtherSessions(user.id, req.cookies?.[COOKIE_NAME]);

  res.json({ ok: true, username });
});

export default router;
