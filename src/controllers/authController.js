import bcrypt from 'bcrypt';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/token.js';

// Compared against when the email is unknown, so login takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-placeholder', 12);

export async function register(req, res) {
  const { name, email, password, interests } = req.body;

  // Role is never taken from the request: new accounts are always `user`.
  const user = await User.create({ name, email, password, interests, role: 'user' });

  res.status(201).json({ token: signToken(user), user });
}

export async function login(req, res) {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');
  const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);

  if (!user || !valid) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  res.json({ token: signToken(user), user });
}

export function me(req, res) {
  res.json({ user: req.user });
}
