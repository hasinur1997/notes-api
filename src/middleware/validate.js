/**
 * Request validation with zod, plus shared id schemas.
 */
import { z } from 'zod';

const REQUEST_PARTS = ['params', 'query', 'body'];

/**
 * Validates request parts and replaces them with the parsed (coerced, trimmed) values,
 * so handlers only ever see clean data. Every schema passed in should be `.strict()`
 * so unknown fields are rejected. Failures throw a ZodError, which the error handler
 * turns into a 400 response.
 *
 * @param {{ params?: z.ZodType, query?: z.ZodType, body?: z.ZodType }} schemas - Schema per request part.
 * @returns {import('express').RequestHandler} Validation middleware.
 * @throws {z.ZodError} If any part fails validation.
 */
export const validate = (schemas) => (req, res, next) => {
  for (const part of REQUEST_PARTS) {
    if (!schemas[part]) continue;
    const parsed = schemas[part].parse(req[part] ?? {});
    // Express 5 exposes req.query as a getter, so redefine the property instead of assigning it.
    Object.defineProperty(req, part, { value: parsed, writable: true, enumerable: true, configurable: true });
  }
  next();
};

/** A 24-character hex MongoDB ObjectId string. */
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Params schema for routes like `/:id`. */
export const idParams = z.object({ id: objectId }).strict();
