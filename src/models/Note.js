/**
 * Note model: a user's private note with optional labels and a pinned flag.
 */
import mongoose from 'mongoose';

export const MAX_LABELS_PER_NOTE = 10;
export const MAX_LABEL_LENGTH = 30;

/**
 * Normalizes a label list: trims, collapses inner whitespace, drops empties, and removes
 * case-insensitive duplicates (keeping the first spelling). Used as the schema setter so
 * every create and update stores labels the same way.
 *
 * @param {unknown[]} [values=[]] - Raw label values.
 * @returns {string[]} Clean, unique labels in their original order.
 */
export function normalizeLabels(values = []) {
  const seen = new Set();
  const labels = [];
  for (const value of values) {
    const label = String(value).trim().replace(/\s+/g, ' ');
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

const noteSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: '', maxlength: 20000 },
    labels: { type: [String], default: [], set: normalizeLabels },
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } },
);

// The only index on this collection (see CLAUDE.md, Hard Rules). Every notes query filters
// by owner first and sorts by _id descending, so this index serves all of them.
noteSchema.index({ owner: 1, _id: -1 });

/** Mongoose model for the `notes` collection. */
export const Note = mongoose.model('Note', noteSchema);
