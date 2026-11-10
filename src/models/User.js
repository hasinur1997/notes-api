/**
 * User model: accounts, credentials, roles and interests.
 */
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { normalizeLabels } from '../utils/labels.js';

/** Allowed user roles. New accounts are always `user`. */
export const ROLES = Object.freeze(['user', 'admin']);

const BCRYPT_COST = 12;

/**
 * Normalizes an interests list: trims, lowercases, drops empty values and duplicates.
 * Used as the schema setter, so every write path stores interests the same way.
 *
 * @param {unknown[]} [values=[]] - Raw interest values.
 * @returns {string[]} Clean, unique interests in their original order.
 */
export function normalizeInterests(values = []) {
  return [...new Set(values.map((v) => String(v).trim().toLowerCase()).filter(Boolean))];
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'user' },
    interests: { type: [String], default: [], set: normalizeInterests },
    // Labels created in "Edit labels" before any note uses them (see services/noteService.js).
    labels: { type: [String], default: [], set: normalizeLabels },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      // Defence in depth: never serialize the password, even if it was explicitly selected.
      transform: (doc, ret) => {
        delete ret.password;
        return ret;
      },
    },
  },
);

// The only indexes on this collection (see CLAUDE.md, Hard Rules).
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ interests: 1 });

/** Hashes the password with bcrypt whenever it is new or changed. */
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, BCRYPT_COST);
});

/**
 * Checks a plain-text password against the stored hash.
 * The document must have been loaded with `.select('+password')`.
 *
 * @param {string} candidate - Plain-text password to check.
 * @returns {Promise<boolean>} True if it matches.
 */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** Mongoose model for the `users` collection. */
export const User = mongoose.model('User', userSchema);
