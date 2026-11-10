/**
 * Test environment setup. Import this FIRST in every test file, before any `src/` module,
 * so `config/env.js` sees safe test values instead of a developer's `.env`.
 * Preset variables always win over `.env`, so a real MONGO_URI can never be picked up here.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
// Placeholder only: unit tests never connect. Integration tests connect to TEST_MONGO_URI instead.
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/notes_unit_test_unused';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:3000';
// Images stored during tests go to a fresh temporary folder, never to the project's uploads/.
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'notes-uploads-'));
// Force local storage in tests even if the developer configured Cloudinary.
process.env.CLOUDINARY_CLOUD_NAME = '';
