// Express 5 already forwards rejected promises from handlers to the error middleware.
// This wrapper keeps that behaviour explicit and portable for any handler that needs it.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
