import { asyncHandler } from './asyncHandler.js';

export const COOKIE_NAME = 'cf_turnstile_verified';
const COOKIE_MAX_AGE_MS = 24 * 3600 * 1000; // re-verify once a day
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Unset in an environment that hasn't configured Cloudflare Turnstile (e.g. local
// dev) — the gate is skipped entirely rather than locking everyone out, mirroring
// how ensureAdminAccount() degrades gracefully without ADMIN_PASSWORD. Set this in
// production to actually enforce the "verify before reaching the site" behavior.
const SECRET = process.env.TURNSTILE_SECRET_KEY;
let warnedOnce = false;

export function isEnabled() {
  if (!SECRET && !warnedOnce) {
    warnedOnce = true;
    console.warn(
      '\n[turnstile] TURNSTILE_SECRET_KEY is not set — the human-verification gate is disabled.\n' +
      '            Set it as an environment variable for the server to enforce it.\n'
    );
  }
  return Boolean(SECRET);
}

export async function verifyToken(token, remoteip) {
  const body = new URLSearchParams({ secret: SECRET, response: token || '' });
  if (remoteip) body.set('remoteip', remoteip);

  const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
  const data = await res.json();
  return Boolean(data.success);
}

// Mounted ahead of every other route (including /api/auth) so even a direct API
// call can't skip the check — the client-side gate screen is a convenience, this
// is the actual enforcement.
export const requireTurnstile = asyncHandler(async (req, res, next) => {
  if (!isEnabled()) return next();
  if (req.cookies?.[COOKIE_NAME] === '1') return next();
  res.status(403).json({ error: 'Human verification required', needsTurnstile: true });
});

export function setVerifiedCookie(req, res) {
  res.cookie(COOKIE_NAME, '1', { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: COOKIE_MAX_AGE_MS });
}
