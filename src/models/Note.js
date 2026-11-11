/**
 * Note model: a private note with labels, pin, colour, reminder, images and collaborators.
 */
import mongoose from 'mongoose';
import { normalizeLabels } from '../utils/labels.js';

export { MAX_LABEL_LENGTH, MAX_LABELS_PER_NOTE, normalizeLabels } from '../utils/labels.js';

export const MAX_COLLABORATORS = 10;
export const MAX_IMAGES_PER_NOTE = 5;

/** Background colours a note can have. The frontend maps each key to a colour from the app palette. */
export const NOTE_COLORS = Object.freeze(['default', 'amber', 'coral', 'rose', 'lavender', 'sky', 'mint', 'sand']);

/** An image stored on Cloudinary. `publicId` is kept so the file can be deleted with the note. */
export const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: true },
);

const noteSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // Markdown text (bold, italic, underline, headings, lists); rendered safely by the client.
    content: { type: String, default: '', maxlength: 20000 },
    labels: { type: [String], default: [], set: normalizeLabels },
    pinned: { type: Boolean, default: false },
    color: { type: String, enum: NOTE_COLORS, default: 'default' },
    reminderAt: { type: Date, default: null },
    collaborators: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    images: { type: [imageSchema], default: [] },
  },
  { timestamps: true, toJSON: { versionKey: false } },
);

// The only indexes on this collection (see CLAUDE.md, Hard Rules).
// Notes a user owns: filtered by owner, newest first.
noteSchema.index({ owner: 1, _id: -1 });
// Notes shared with a user: filtered by collaborator, newest first.
noteSchema.index({ collaborators: 1, _id: -1 });

/** Mongoose model for the `notes` collection. */
export const Note = mongoose.model('Note', noteSchema);
