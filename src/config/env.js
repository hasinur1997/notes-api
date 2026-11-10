/**
 * Loads and validates environment variables once at startup.
 * The rest of the codebase reads configuration from the exported `env` object,
 * never from `process.env` directly.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** notes-api project root, so the default upload folder does not depend on the working directory. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  // Optional: when all three are set, images go to Cloudinary instead of the server's disk.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  // Public URL of the web app, used in emailed links (e.g. password reset).
  APP_URL: z.url().default('http://localhost:3000'),
  // Optional SMTP settings for sending email. Without SMTP_HOST, emails are printed to the
  // console in development (so reset links can be tested) and not sent in production.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().min(3).default('Notes <no-reply@notes.local>'),
  // Where images are stored when Cloudinary is not configured.
  UPLOAD_DIR: z.string().min(1).default(path.join(PROJECT_ROOT, 'uploads')),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(
    `Invalid environment variables:\n${details}\n\n` +
      'Copy .env.example to .env and fill in the values (MONGO_URI, JWT_SECRET, ...).',
  );
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
