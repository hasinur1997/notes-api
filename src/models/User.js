import bcrypt from 'bcrypt';
import mongoose from 'mongoose';

export const ROLES = Object.freeze(['user', 'admin']);
const BCRYPT_COST = 12;

// Lowercase, trim, drop empties and duplicates.
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
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
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

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, BCRYPT_COST);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

export const User = mongoose.model('User', userSchema);
