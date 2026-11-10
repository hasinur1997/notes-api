/**
 * User model: accounts, credentials, roles and interests.
 */
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { normalizeLabels } from '../utils/labels.js';

/** Allowed user roles. New accounts are always `user`. */
export const ROLES = Object.freeze(['user', 'admin']);

const BCRYPT_COST = 12;

/** How the notes list is paged: numbered pages, or loading more while scrolling. */
export const NOTES_PAGINATION = Object.freeze(['pages', 'infinite']);
/** Notes loaded per page (or per scroll batch); multiples of 12 fill 2, 3, 4 or 6 columns. */
export const NOTES_PER_PAGE = Object.freeze([12, 24, 48]);

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
    // Profile photo, stored like note images (Cloudinary or the server's uploads folder).
    avatar: {
      type: new mongoose.Schema(
        { url: String, publicId: String, width: Number, height: Number },
        { _id: false },
      ),
      default: null,
    },
    // App preferences, changed on the Settings page. Mongoose fills the defaults for accounts
    // created before settings existed, so every user always has a complete object.
    settings: {
      notesPagination: { type: String, enum: NOTES_PAGINATION, default: 'pages' },
      notesPerPage: { type: Number, enum: NOTES_PER_PAGE, default: 12 },
    },
    // Password reset: only a SHA-256 hash of the emailed token is stored, never the token itself.
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpiresAt: { type: Date, select: false },
    // Copied into every access token; a password reset increments it, which revokes all
    // tokens issued before (exact, unlike comparing second-precision issue times).
    tokenVersion: { type: Number, default: 0, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      // Defence in depth: never serialize the password, even if it was explicitly selected.
      transform: (doc, ret) => {
        delete ret.password;
        delete ret.resetPasswordTokenHash;
        delete ret.resetPasswordExpiresAt;
        delete ret.tokenVersion;
        if (ret.avatar) delete ret.avatar.publicId;
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
