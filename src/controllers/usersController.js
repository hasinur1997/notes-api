/**
 * Handlers for /api/users. Requests are already authenticated and validated by the route.
 */

/** Profile fields a user may change themselves. Everything else (email, role, password) is fixed here. */
const EDITABLE_PROFILE_FIELDS = ['name', 'interests'];

/**
 * PATCH /api/users/me: updates the signed-in user's own name and/or interests.
 * Changes are applied to the user document loaded by `auth` and saved with save(), so the
 * schema setters (interests are trimmed, lowercased and de-duplicated) and validators run.
 *
 * @param {import('express').Request} req - Body: { name?, interests? }.
 * @param {import('express').Response} res - 200 `{ user }`.
 * @returns {Promise<void>}
 */
export async function updateMe(req, res) {
  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (req.body[field] !== undefined) req.user[field] = req.body[field];
  }
  await req.user.save();
  res.json({ user: req.user });
}
