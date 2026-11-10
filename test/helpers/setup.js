/**
 * Test environment setup. Import this FIRST in every test file, before any `src/` module,
 * so `config/env.js` sees safe test values instead of a developer's `.env`.
 * Preset variables always win over `.env`, so a real MONGO_URI can never be picked up here.
 */
import { randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
// Placeholder only: unit tests never connect. Integration tests connect to TEST_MONGO_URI instead.
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/notes_unit_test_unused';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:3000';
