/**
 * Role-based authorization middleware.
 */
import { ApiError } from '../utils/ApiError.js';

/**
 * Allows the request only if `req.user.role` is one of the given roles.
 * Must run after `auth`. Example: `router.use(auth, requireRole('admin'))`.
 *
 * @param {...string} roles - Roles allowed to continue.
 * @returns {import('express').RequestHandler} Middleware that passes 401 (no user) or 403 (wrong role) to `next`.
 */
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
