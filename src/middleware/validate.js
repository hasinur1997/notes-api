import { z } from 'zod';

/**
 * Validates and replaces req.body / req.params / req.query with the parsed (coerced) values.
 * Every schema passed in should be `.strict()` so unknown fields are rejected.
 * Errors are ZodErrors and are turned into 400 responses by the error handler.
 */
export const validate = (schemas) => (req, res, next) => {
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const parsed = schemas[key].parse(req[key] ?? {});
    // Express 5 exposes req.query as a getter, so redefine it instead of assigning.
    Object.defineProperty(req, key, { value: parsed, writable: true, enumerable: true, configurable: true });
  }
  next();
};

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const idParams = z.object({ id: objectId }).strict();
