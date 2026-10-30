import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { COOKIE_NAME, isEnabled, verifyToken, setVerifiedCookie } from '../lib/turnstile.js';

const router = Router();

// Unauthenticated on purpose — this is the pre-everything gate, so nothing else
// (including login) can depend on a session existing yet.
router.get('/status', (req, res) => {
  const verified = !isEnabled() || req.cookies?.[COOKIE_NAME] === '1';
  res.json({ enabled: isEnabled(), verified });
});

router.post('/verify', asyncHandler(async (req, res) => {
  if (!isEnabled()) return res.json({ ok: true });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const ok = await verifyToken(token, req.ip);
  if (!ok) return res.status(400).json({ error: 'Verification failed — please try again' });

  setVerifiedCookie(req, res);
  res.json({ ok: true });
}));

export default router;
