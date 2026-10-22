import crypto from 'node:crypto';
import { pool } from '../db.js';
import { asyncHandler } from './asyncHandler.js';

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

export async function hasAnyUser() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM users');
  return Number(rows[0].c) > 0;
}

export async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0];
}

export async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0];
}

// Creates the single admin account from ADMIN_USERNAME/ADMIN_PASSWORD env vars, but only
// when no user exists yet — a later change to ADMIN_PASSWORD does not silently reset an
// existing account's password.
export async function ensureAdminAccount() {
  if (await hasAnyUser()) return;

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
  await pool.query(
    'INSERT INTO users (username, password_hash, created_at) VALUES ($1, $2, $3)',
    [username, hashPassword(password), new Date().toISOString()]
  );
  console.log(`[auth] Created admin account "${username}" from ADMIN_PASSWORD.`);
}

export async function updateAccount(userId, { username, passwordHash }) {
  await pool.query('UPDATE users SET username = $1, password_hash = $2 WHERE id = $3', [username, passwordHash, userId]);
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await pool.query(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [token, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString()]
  );
  return token;
}

// Joins back to users on every call so a username changed mid-session (via account
// settings) is reflected immediately, without needing to reissue the session token.
export async function getSession(token) {
  if (!token) return null;
  const { rows } = await pool.query(`
    SELECT s.token, s.user_id AS "userId", s.expires_at AS "expiresAt", u.username AS username
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = $1
  `, [token]);
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    return null;
  }
  return row;
}

export async function deleteSession(token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

// Invalidates every other session for this user (e.g. after a password change), keeping
// the current one (identified by its token) alive so the person making the change isn't
// logged out by their own action.
export async function deleteOtherSessions(userId, keepToken) {
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [userId, keepToken]);
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const session = await getSession(req.cookies?.[COOKIE_NAME]);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  req.user = { id: session.userId, username: session.username };
  next();
});
