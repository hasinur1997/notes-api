/**
 * Post model: a public post with Markdown text, a colour and images (the same editor as notes).
 */
import mongoose from 'mongoose';
import { imageSchema, NOTE_COLORS } from './Note.js';

export { MAX_IMAGES_PER_NOTE as MAX_IMAGES_PER_POST } from './Note.js';

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // Markdown text, rendered safely by the client.
    content: { type: String, default: '', maxlength: 20000 },
    color: { type: String, enum: NOTE_COLORS, default: 'default' },
    images: { type: [imageSchema], default: [] },
  },
  { timestamps: true, toJSON: { versionKey: false } },
);

// The only index on this collection (see CLAUDE.md, Hard Rules).
// A user's posts, newest first: Scenario 2 $lookup, author-only edits and the delete cascade.
postSchema.index({ author: 1, _id: -1 });

/** Mongoose model for the `posts` collection. */
export const Post = mongoose.model('Post', postSchema);
