// Express 4 doesn't catch a rejected promise from an async handler on its own —
// without this, a thrown error inside `await pool.query(...)` would hang the
// request instead of reaching the error-handling middleware in index.js. Works for
// both route handlers `(req, res)` and middleware `(req, res, next)`, e.g. requireAuth.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
