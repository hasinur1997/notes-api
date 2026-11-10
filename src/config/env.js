/**
 * Loads and validates environment variables once at startup.
 * The rest of the codebase reads configuration from the exported `env` object,
 * never from `process.env` directly.
 */
import { z } from 'zod';

// Load .env in local development. Hosted environments (Render) inject variables directly.
// Variables that are already set always win over values in the file.
try {
  process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

/** Splits a comma-separated list into trimmed, non-empty values. */
const toList = (value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('1d'),
  CORS_ORIGIN: z.string().default('http://localhost:3000').transform(toList),
  ADMIN_NAME: z.string().min(1).default('Admin'),
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid environment variables:\n${details}`);
  process.exit(1);
}

/**
 * Validated, read-only application configuration.
 *
 * @type {Readonly<z.infer<typeof envSchema> & { isProduction: boolean }>}
 */
export const env = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
});
