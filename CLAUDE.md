# CLAUDE.md — Backend Agent Guide (`notes-api`)

> Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working on the **backend** of the **Notes** application.
> The same file can be used as `AGENTS.md`. The frontend lives in the sibling repo `notes-web` with its own guide.
> The full project plan lives in `../docs/project-over.md`. When this file and the plan disagree, **this file wins**.

---

## 1. Project Overview

**Notes** is a note-taking application. People keep private notes, share public posts, and list their interests. Administrators manage users and content. The product has two parts:

- **`notes-api` (this repo):** a REST API that owns all data, authentication and authorization.
- **`notes-web`:** a browser client that talks to this API only.

### Core features

- **Accounts:** registration, login with JWT, profile management (name, interests).
- **Private notes:** create, read, update and delete. A note is visible only to its owner. Admins can read notes for moderation.
- **Public posts:** anyone can browse posts. Signed-in users can publish them. Each user has a public profile page listing their posts.
- **Administration:** user management (create, edit, delete, change role), browsing all notes by owner, and grouping users by interest.
- **Role-based access control:** two roles, `user` and `admin`, enforced on the server for every request.

### Engineering principles

1. **Lean, deliberate indexing.** Every query is backed by a known index, and no index exists without a query that needs it.
2. **Efficient queries.** Each read is a single DB round trip. Joins and grouping use aggregation pipelines, not multiple queries.
3. **Secure by default.** Authentication, authorization and ownership checks run on the server, inside the query.
4. **Predictable API contracts.** Every endpoint uses the same list, error and auth response shapes, so clients stay simple.
5. **Simple over clever.** Prefer readable, conventional code. Add complexity only when a real need appears.

### Repositories

| Repo | Stack | Hosting |
|---|---|---|
| `notes-api` (this repo) | Node.js LTS, Express, Mongoose, MongoDB Atlas, JWT, bcrypt, zod | Render (free) |
| `notes-web` | Next.js (App Router), React, Tailwind CSS, shadcn/ui | Vercel (free) |

---

## 2. Hard Rules (never break these)

1. **Indexes are defined ONLY with `schema.index()`.**
   - Never use `unique: true`, `index: true`, or `sparse: true` on field definitions.
   - Never call `createIndex` from code or create indexes manually in Atlas.
2. **Only these 5 custom indexes may exist.** Do not add, remove or change any index without explicit approval from the developer.

   | Collection | Index | Options |
   |---|---|---|
   | users | `{ email: 1 }` | `{ unique: true }` |
   | users | `{ interests: 1 }` | — |
   | notes | `{ owner: 1, _id: -1 }` | — |
   | notes | `{ collaborators: 1, _id: -1 }` | — (approved 2026-11-10 for note sharing) |
   | posts | `{ author: 1, _id: -1 }` | — |

3. **Every list endpoint sorts by `{ _id: -1 }`.** Never sort by `createdAt` (there is no index for it, on purpose).
   Note queries use `accessibleBy(userId, conditions)`: `{ $or: [{ owner, ...conditions }, { collaborators, ...conditions }] }`. Each branch uses its own index and MongoDB merges them in `_id` order (`SORT_MERGE`, no in-memory sort). Filters (`pinned`, `labels`, `reminderAt`, search regex) are applied inside both branches; they never get their own index. Search terms are always regex-escaped.
4. **Every list endpoint is paginated.** Default `limit=10`, max `limit=50`, `page` starts at 1.
5. **Scenario 1 (group by interests) uses exactly ONE `User.aggregate()` call.** No `find`, `countDocuments`, `populate` or any other DB call in that code path. Pagination happens inside the pipeline with `$facet`.
6. **Scenario 2 (user's posts) is a single pipeline on `users` with a `$lookup` to `posts`.** No `populate`, no second query.
7. **Access is enforced inside the query**, e.g. `Note.findOneAndUpdate({ _id, ...accessibleBy(userId) }, ...)` for read/edit and `{ _id, owner: userId }` for owner-only actions (delete, sharing). Never fetch a document first and compare the owner in JavaScript afterwards.
8. **Passwords never leave the server.** Password field is `select: false` and removed in `toJSON`.
9. **No templates or starter kits.** Express is hand-wired.
10. **No secrets in git.** Only `.env.example` is committed.
11. **Never use `populate()` anywhere** in the codebase. Use queries or the defined aggregations.

---

## 3. Backend

### 3.1 Commands

```bash
npm install
npm run dev            # nodemon src/server.js
npm start              # node src/server.js (production)
npm run seed           # creates the admin from ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD (idempotent; never promotes an existing user)
npm run seed -- --fake --email you@x.com [--count 120]  # add marked test notes (labels, pins, colours, reminders, sharing)
npm run seed -- --clear-fake --email you@x.com           # remove exactly the marked test data (real notes untouched)
npm run sync-indexes   # Model.syncIndexes() on all models, prints getIndexes()
npm run explain        # runs explain("executionStats") on every query in the index map
npm test               # unit tests; database tests also run when TEST_MONGO_URI is set
```

### 3.2 Structure

```
src/
├── config/        env.js (validated with zod), db.js
├── models/        User.js, Note.js, Post.js   ← schema + schema.index() only
├── middleware/    auth.js, requireRole.js, validate.js, errorHandler.js, rateLimit.js
├── controllers/   thin: parse request → call service/model → send response
├── services/      aggregation pipelines (interestGroups.js, userPosts.js)
├── routes/        one file per resource, mounted under /api
├── validators/    zod schemas per resource (auth.js, ...), shared field rules
├── utils/         pagination.js, ApiError.js, asyncHandler.js, token.js
├── app.js         express app (middleware + routes)
└── server.js      connects DB, starts server
scripts/           seed.js, sync-indexes.js, explain.js
test/              helpers/ (setup, http), unit/ (no DB), integration/ (needs TEST_MONGO_URI)
```

### 3.3 Data Model

| Collection | Fields |
|---|---|
| users | `name`, `email` (lowercase, trimmed), `password` (`select: false`), `role` (`user` \| `admin`, default `user`), `interests` ([String], lowercased, trimmed, deduped), `labels` ([String], max 100: labels created in "Edit labels" before any note uses them), `avatar` ({ url, publicId, width, height } or `null`), `resetPasswordTokenHash` / `resetPasswordExpiresAt` (`select: false`, SHA-256 of the emailed token), `tokenVersion` (`select: false`, in every JWT as `tv`; a password reset increments it to revoke older tokens), timestamps |
| notes | `owner` (ObjectId → users, required), `title` (required, max 200), `content` (Markdown, max 20,000), `labels` ([String], max 10, trimmed, case-insensitive deduped, each max 30), `pinned` (Boolean, default `false`), `color` (palette key, default `default`), `reminderAt` (Date or `null`), `collaborators` ([ObjectId → users], max 10), `images` ([{ url, publicId, width, height }], max 5, stored on Cloudinary), timestamps |
| posts | `author` (ObjectId → users, required), `title` (required), `body`, timestamps |

### 3.4 Endpoints

| Method | Endpoint | Access |
|---|---|---|
| POST | `/api/auth/register` | Public — role is always forced to `user` |
| POST | `/api/auth/login` | Public, rate-limited |
| GET | `/api/auth/me` | Auth |
| POST | `/api/auth/forgot-password` | Public, rate-limited (5/15 min) — `{ email }`; always the same 200 reply; emails a 30-minute single-use link if the account exists |
| POST | `/api/auth/reset-password` | Public, rate-limited (10/15 min) — `{ email, token, password }`; 400 `INVALID_RESET_TOKEN` if wrong/used/expired |
| PATCH | `/api/users/me` | Auth — only `name`, `interests` |
| POST, DELETE | `/api/users/me/avatar` | Auth — multipart `image` (same checks as note images); replacing or removing deletes the old file |
| GET, POST | `/api/notes` | Auth — GET filters: `?pinned=true\|false`, `?label=`, `?q=` (search title/content) |
| GET | `/api/notes/summary` | Auth — `{ totalNotes, labels: [{ name, count }] }` in one aggregate |
| POST | `/api/notes/labels` | Auth — create a label no note uses yet (`{ name }`, stored on the user; 409 if it exists ignoring case) |
| PATCH, DELETE | `/api/notes/labels/:name` | Auth — rename (`{ name }`) or remove a label on all visible notes and in the user's created labels |
| GET, PATCH | `/api/notes/:id` | Owner or collaborator (admin may GET) |
| DELETE | `/api/notes/:id` | Owner only (also deletes stored images) |
| POST | `/api/notes/:id/copy` | Owner or collaborator — copy becomes the caller's own note |
| POST | `/api/notes/:id/collaborators` | Owner only — `{ email }` of a registered user |
| DELETE | `/api/notes/:id/collaborators/:userId` | Owner, or the collaborator leaving |
| POST, PUT, DELETE | `/api/notes/:id/images[/:imageId]` | Owner or collaborator — multipart `image`, JPEG/PNG/WebP/GIF ≤ 5 MB (verified from the file's bytes), rate-limited. Stored on Cloudinary when configured, otherwise on this server in `UPLOAD_DIR` and served at `/uploads/...` (with `Access-Control-Allow-Origin: *` so the web app can crop them). `PUT` replaces an image in place (after cropping) and deletes the old file |
| GET, POST | `/api/admin/users` | Admin |
| GET, PATCH, DELETE | `/api/admin/users/:id` | Admin |
| GET | `/api/admin/notes?owner=` | Admin |
| GET | `/api/admin/users/grouped-by-interest?interest=` | Admin — Scenario 1 |
| GET, POST | `/api/posts` | GET public, POST auth |
| GET | `/api/users/:id/posts` | Public — Scenario 2 |
| GET | `/api/health` | Public |

### 3.5 Response Contracts

The frontend (`notes-web`) depends on these shapes. Do not change them.

```json
// List
{ "data": [], "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 } }

// Error
{ "error": { "message": "Note not found", "code": "NOT_FOUND" } }

// Login
{ "token": "<jwt>", "user": { "_id": "...", "name": "...", "email": "...", "role": "user", "interests": [] } }
```

| Status | Use |
|---|---|
| 400 | Validation error, invalid ObjectId |
| 401 | Missing / invalid / expired token, or token user no longer exists |
| 403 | Non-admin on admin route; admin deleting/demoting themselves |
| 404 | Not found **or not accessible** (never reveal that another user's note exists) |
| 413 | JSON body over 100kb, or image over 5 MB |
| 502 | Cloudinary failed to store an image |
| 409 | Duplicate email (catch Mongo error code `11000`) |
| 429 | Login rate limit |

### 3.6 Security Conventions

- bcrypt cost 12, hashed in a `pre('save')` hook; admin password updates must go through `save()` so the hook runs
- JWT payload `{ sub: userId, role, tv }`, expiry from `JWT_EXPIRES_IN` (default `1d`); `auth` rejects a token whose `tv` differs from the user's `tokenVersion` (401 `TOKEN_REVOKED`)
- Password reset: random 32-byte token, only its hash stored, 30-minute expiry, single use; the request endpoint never reveals whether an account exists (same reply, email sent in the background)
- `auth` middleware: verify token → load user by id → attach `req.user` → 401 if missing
- `requireRole('admin')` on the whole `/api/admin` router
- Validate `body`, `params` and `query` with zod in every route; reject unknown fields with `.strict()`
- Whitelist updatable fields explicitly; never spread `req.body` into an update
- Deleting a user also deletes their notes (and their images) and posts, and removes them from `collaborators` on other notes
- helmet, CORS restricted to `CORS_ORIGIN`, JSON body limit `100kb`
- Production errors never include stack traces

### 3.7 Aggregation Specs

**Scenario 1 — `services/interestGroups.js`**

1. `$match: { interests: interest }` — only when `interest` is provided (uses `{ interests: 1 }`)
2. `$project: { name: 1, email: 1, interests: 1 }`
3. `$unwind: "$interests"`
4. `$match: { interests: interest }` — only when provided
5. `$group: { _id: "$interests", count: { $sum: 1 }, users: { $push: { _id, name, email } } }`
6. `$sort: { count: -1, _id: 1 }`
7. `$facet: { meta: [{ $count: "total" }], data: [{ $skip }, { $limit }] }`

Then shape the result into the standard list contract in JavaScript (no extra DB call).

**Scenario 2 — `services/userPosts.js`**

1. `$match: { _id: userId }`
2. `$project` public fields only (`name`, `email`, `interests`)
3. `$lookup: { from: "posts", localField: "_id", foreignField: "author", pipeline: [{ $sort: { _id: -1 } }, { $skip }, { $limit }], as: "posts" }`
4. `$lookup` (same keys) with `pipeline: [{ $count: "total" }]` as `postCount` for pagination meta

Empty result from stage 1 → 404.

### 3.8 Environment Variables

```
PORT=5000
NODE_ENV=development
MONGO_URI=
JWT_SECRET=
JWT_EXPIRES_IN=1d
CORS_ORIGIN=http://localhost:3000
ADMIN_NAME=Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=
# Optional: enables database tests in `npm test`. The database name must contain "test"; it is dropped after the run.
TEST_MONGO_URI=
# Optional: store images on Cloudinary. Without them, images are stored on this server.
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
UPLOAD_DIR=                # default ./uploads (local image storage; git-ignored)
APP_URL=http://localhost:3000   # web app URL used in emailed links
SMTP_HOST=                 # optional; without it emails are printed to the console in development
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Notes <no-reply@notes.local>
```

---

## 4. Coding Rules

Every coding agent and contributor follows these rules for every change. If a rule conflicts with Section 2 (Hard Rules), Section 2 wins.

### 4.1 Design (SOLID, applied to Express + Mongoose)

- **Single responsibility.** One reason to change per module:
  - `routes/` wire URL + middleware + controller, and nothing else.
  - `validators/` hold zod schemas only.
  - `controllers/` read the validated request, call one model method or service, and send the response. No business rules, no pipelines.
  - `services/` hold business logic and aggregation pipelines. They never touch `req` or `res`.
  - `models/` hold the schema, `schema.index()` calls, hooks and small instance methods.
  - `middleware/` handle one cross-cutting concern each (auth, roles, validation, errors, rate limits).
- **Open/closed.** Extend behaviour with configuration or factories (`validate(schemas)`, `requireRole(...roles)`) instead of editing shared code for each new case.
- **Liskov substitution.** Functions that share a role share a contract: every middleware is `(req, res, next)`, every error is an `ApiError` (or is normalized into one), every list returns `{ data, meta }`.
- **Interface segregation.** Export small, focused functions. A caller imports only what it uses; no "god" utility modules.
- **Dependency inversion.** Services take plain inputs (ids, filters, `{ page, limit }`) and return plain data, so they can be called from controllers, scripts and tests alike. Configuration comes from `config/env.js`, never from `process.env` directly.
- Do not add classes, layers or abstractions until at least two real callers need them. Plain functions are the default; `ApiError` is the model for when a class is justified.

### 4.2 Security (mandatory for every feature)

Security is checked on every change, not added afterwards. Every feature must satisfy all of these:

- **Validate all input.** Every route validates `params`, `query` and `body` with a `.strict()` zod schema. Bound every string length, array size and number range.
- **Authenticate and authorize on the server.** Protected routes use `auth`; admin routes use `requireRole('admin')`. The role is read from the database user, never from the token or request.
- **Enforce ownership inside the query** (`{ _id, owner: req.user.id }`). Not found and not owned both return 404.
- **Never trust the client for privileged fields.** Build create/update objects from an explicit whitelist. Never spread `req.body`. `role`, `owner`, `author`, `_id` and timestamps are set by the server only.
- **Prevent NoSQL injection.** Only validated, typed values reach a query. Never pass raw request objects into a filter, and never build `$where`, `$expr` or regexes from user input without escaping.
- **Protect secrets and personal data.** Never log or return passwords, tokens, hashes or `JWT_SECRET`. Every user projection excludes `password`. Production errors never include stack traces or internal messages.
- **Fail closed.** On any doubt (missing token, invalid id, unexpected error), deny access and return the standard error shape.
- **Keep dependencies minimal and current.** Ask before adding one; run `npm audit` after adding one and resolve high or critical findings.
- **Review checklist.** Before committing a feature, check: input validated, auth/role applied, ownership in query, no sensitive fields returned, error path tested.

### 4.3 Performance

- Every query must use an index from Section 2. Confirm with `npm run explain` (`IXSCAN`, no `COLLSCAN`, no in-memory `SORT`).
- One database round trip per read where possible. Use aggregation pipelines for joins and grouping; never query inside a loop (no N+1).
- Use `.lean()` for read-only queries that do not need document methods or hooks.
- Project only the fields the response needs.
- Every list is paginated and bounded (`limit` max 50).
- Use `Promise.all` for independent async work; never block the event loop with synchronous CPU-heavy work (the only sync bcrypt call is the one-time startup hash).

### 4.4 Readability and structure

- ES modules, `async/await`, `const` by default. No callbacks, no `var`.
- Small functions with one job. A function longer than ~40 lines or nested more than 3 levels deep should be split.
- Descriptive names: functions are verbs (`findUserNotes`), booleans read as questions (`isOwner`, `hasRole`), constants are `UPPER_SNAKE_CASE`.
- File names: `camelCase.js` for modules, `PascalCase.js` for models and classes.
- No magic numbers or strings: name them as constants (`BCRYPT_COST`, `MAX_LIMIT`).
- No dead code, commented-out code or unused imports in commits.
- Reuse before writing: check `utils/`, `validators/` and `middleware/` for an existing helper first.

### 4.5 Comments and documentation

- **Every exported function, class and middleware has a JSDoc comment** with a one-sentence summary, `@param` for each parameter, `@returns`, and `@throws` when it can throw an `ApiError`.
- Non-exported helpers get at least a one-line comment saying what they do.
- Inline comments explain **why**, not what (for example, why a dummy hash is compared, why `req.query` is redefined).
- Keep comments accurate: update or delete them when the code changes.

```js
/**
 * Returns a page of the user's own notes, newest first.
 * Uses the { owner: 1, _id: -1 } index.
 *
 * @param {string} ownerId - Id of the authenticated user.
 * @param {{ page: number, limit: number }} pagination - Validated pagination values.
 * @returns {Promise<{ data: object[], meta: object }>} Standard list response.
 */
export async function listNotes(ownerId, { page, limit }) { ... }
```

### 4.6 Testability

- Every feature is written so it can be tested without a running HTTP server or real network: services take plain arguments and return plain data; `app.js` exports the app without calling `listen()`.
- Tests use Node's built-in runner (`node:test` + `node:assert/strict`) and run with `npm test`. Ask before adding any test dependency.
- Every endpoint has tests for the success path, validation failure (400), missing auth (401), wrong role (403) and not found / not owned (404) where they apply.
- Tests run against a separate test database and clean up after themselves. Never run tests against production data.
- A bug fix comes with a test that fails before the fix and passes after it.

---

## 5. Workflow for the Agent

1. **Read before writing.** Check the existing model, route and service files before changing anything.
2. **Work in small steps.** One feature per change. Make one commit per feature with a conventional message (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
   Commits are authored only by the repository owner (the local `user.name` / `user.email`). Never add `Co-Authored-By:` trailers, "Generated with" lines or any other AI attribution to commit messages or PR descriptions.
3. **Ask before** adding a dependency, an index or an endpoint not listed here.
4. **After any query or model change**, run `npm run explain` and confirm the query still uses the intended index.
5. **Before marking work done**, run `npm test` (all tests pass) and `npm run sync-indexes` (only `_id` + the 5 indexes exist).
6. **Do not invent requirements.** If something is not in this file or `../docs/project-over.md`, ask.

---

## 6. Definition of Done

A backend feature is done when:

- [ ] Route, zod validation, controller and service exist and follow the structure above
- [ ] Auth, role and ownership rules from Section 3.6 are applied
- [ ] List responses follow the pagination contract
- [ ] `npm run explain` shows `IXSCAN` (no `COLLSCAN`, no in-memory `SORT`) for the new query
- [ ] No new index was introduced
- [ ] The Section 4.2 security checklist passes
- [ ] Every new exported function, class and middleware has a JSDoc comment
- [ ] Tests cover the success and error paths, and `npm test` passes
- [ ] The Postman collection has a request for it

---

## 7. Never Do

- Add `index: true` / `unique: true` to a field, or any index not in Section 2
- Sort a list by `createdAt`
- Use `populate()`
- Split Scenario 1 or Scenario 2 into multiple DB calls
- Return a `password` field in any response
- Spread `req.body` into a create or update call
- Let a user set their own `role`
- Commit `.env` or real credentials
- Use starter repos or generators for the Express app
- Refactor working code just for style without a clear benefit
