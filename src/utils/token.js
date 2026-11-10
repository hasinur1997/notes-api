/**
 * JWT signing and verification. The algorithm is pinned so tokens signed
 * any other way (including `alg: none`) are rejected.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ALGORITHM = 'HS256';

/**
 * Signs an access token for a user.
 *
 * @param {{ _id: unknown, role: string, tokenVersion?: number }} user - The user the token is issued to.
 * @returns {string} Signed JWT with payload `{ sub, role, tv }` and the configured expiry.
 */
export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, tv: user.tokenVersion ?? 0 }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

/**
 * Verifies a token's signature, algorithm and expiry.
 *
 * @param {string} token - Raw JWT from the Authorization header.
 * @returns {{ sub: string, role: string, tv?: number, iat: number, exp: number }} Decoded payload.
 * @throws {import('jsonwebtoken').TokenExpiredError} If the token has expired.
 * @throws {import('jsonwebtoken').JsonWebTokenError} If the token is malformed or the signature is invalid.
 */
export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
}
