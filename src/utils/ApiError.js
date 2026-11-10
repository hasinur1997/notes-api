/**
 * An expected, client-facing error. The error handler turns it into
 * `{ error: { message, code } }` with the given HTTP status.
 * Throw it from anywhere in a request: `throw ApiError.notFound('Note not found')`.
 */
export class ApiError extends Error {
  /**
   * @param {number} status - HTTP status code to respond with.
   * @param {string} message - Safe, human-readable message shown to the client.
   * @param {string} code - Stable machine-readable code, e.g. `NOT_FOUND`.
   */
  constructor(status, message, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /**
   * 400: the request is invalid.
   * @param {string} [message] @param {string} [code] @returns {ApiError}
   */
  static badRequest(message = 'Bad request', code = 'BAD_REQUEST') {
    return new ApiError(400, message, code);
  }

  /**
   * 401: missing or invalid credentials.
   * @param {string} [message] @param {string} [code] @returns {ApiError}
   */
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, code);
  }

  /**
   * 403: authenticated but not allowed.
   * @param {string} [message] @param {string} [code] @returns {ApiError}
   */
  static forbidden(message = 'You do not have permission to do this', code = 'FORBIDDEN') {
    return new ApiError(403, message, code);
  }

  /**
   * 404: not found, or not owned by the caller.
   * @param {string} [message] @param {string} [code] @returns {ApiError}
   */
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new ApiError(404, message, code);
  }

  /**
   * 409: conflicts with an existing resource.
   * @param {string} [message] @param {string} [code] @returns {ApiError}
   */
  static conflict(message = 'Resource already exists', code = 'CONFLICT') {
    return new ApiError(409, message, code);
  }

  /**
   * 429: rate limit exceeded.
   * @param {string} [message] @param {string} [code] @returns {ApiError}
   */
  static tooManyRequests(message = 'Too many requests, please try again later', code = 'TOO_MANY_REQUESTS') {
    return new ApiError(429, message, code);
  }
}
