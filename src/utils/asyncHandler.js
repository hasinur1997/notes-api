/**
 * Wraps an async handler so a rejected promise is passed to `next(err)`.
 * Express 5 already does this for route handlers; use this wrapper for code paths
 * outside Express routing (or to keep the behaviour explicit).
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} fn - Async handler.
 * @returns {import('express').RequestHandler} Handler that forwards errors to `next`.
 */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
