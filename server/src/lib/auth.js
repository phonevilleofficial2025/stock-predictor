import crypto from 'node:crypto';
import { db } from '../db.js';

export const COOKIE_NAME = 'session_token';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

export function hasAnyUser() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
}

export function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Creates the single admin account from ADMIN_USERNAME/ADMIN_PASSWORD env vars, but only
// when no user exists yet — a later change to ADMIN_PASSWORD does not silently reset an
// existing account's password.
export function ensureAdminAccount() {
  if (hasAnyUser()) return;

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn(
      '\n[auth] No admin account exists yet, and ADMIN_PASSWORD is not set.\n' +
      '       Set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) as environment variables\n' +
      '       for the server container and restart it to create the admin account.\n'
    );
    return;
  }

  const username = process.env.ADMIN_USERNAME || 'admin';
  db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hashPassword(password), new Date().toISOString());
  console.log(`[auth] Created admin account "${username}" from ADMIN_PASSWORD.`);
}

export function updateAccount(userId, { username, passwordHash }) {
  db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(username, passwordHash, userId);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
  return token;
}

// Joins back to users on every call so a username changed mid-session (via account
// settings) is reflected immediately, without needing to reissue the session token.
export function getSession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token, s.user_id AS userId, s.expires_at AS expiresAt, u.username AS username
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Invalidates every other session for this user (e.g. after a password change), keeping
// the current one (identified by its token) alive so the person making the change isn't
// logged out by their own action.
export function deleteOtherSessions(userId, keepToken) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken);
}

export function requireAuth(req, res, next) {
  const session = getSession(req.cookies?.[COOKIE_NAME]);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  req.user = { id: session.userId, username: session.username };
  next();
}
