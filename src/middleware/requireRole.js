import { ApiError } from '../utils/ApiError.js';

// Use after `auth`. Example: router.use(auth, requireRole('admin'))
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
