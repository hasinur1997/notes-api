# notes-api

REST API for **Notes**, a note-taking app with private notes, public posts, sharing, labels, reminders, images and an admin area. It uses JWT authentication and role-based access control (`user` / `admin`).

The browser client lives in the sibling repo [`notes-web`](https://github.com/hasinur1997/notes-web).

**Stack:** Node.js, Express 5, MongoDB with Mongoose, JWT, bcrypt and zod. Images can go to Cloudinary or to local disk, and email is sent with Nodemailer.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Development setup](#development-setup)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Testing](#testing)
- [Project structure](#project-structure)
- [API overview](#api-overview)
- [Aggregation pipelines](#aggregation-pipelines)
- [Database indexes](#database-indexes)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Accounts:** register, log in and get a JWT, view and edit the profile (name, interests, avatar), per-account settings, and password reset by email.
- **Notes:** create, read, update and delete notes in Markdown. Notes support labels, pinning, colours, reminders, up to 5 images, and multi-word search.
- **Sharing:** add up to 10 collaborators per note. Collaborators can edit, and only the owner can delete.
- **Public posts:** anyone can read the feed, a single post, and a user's profile with their posts. Signed-in users publish posts (Markdown, colour, up to 5 images) and only the author can edit or delete them.
- **Admin:** manage users (create, edit, delete, change role, search), read any user's notes, and see users grouped by interest.
- **Security:** bcrypt (cost 12) password hashing, and JWTs that can be revoked when the password changes. Every request is validated with strict zod schemas, and ownership is checked inside the database query. The API also uses helmet, a CORS allowlist, rate limits on login and password reset, and a 100 kb JSON body limit.

## Requirements

| Tool | Version |
|---|---|
| Node.js | **20.12 or newer** (24 LTS recommended; CI uses 24) |
| npm | Comes with Node.js |
| MongoDB | A [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (the free tier works) **or** a local MongoDB 7+ server |

---

## Development setup

### 1. Clone and install

```bash
git clone https://github.com/hasinur1997/notes-api.git
cd notes-api
npm install
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Then set at least these two values:

```dotenv
# Atlas: Connect → Drivers → copy the string and add a database name, e.g. /notes
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/notes
# or a local server:
# MONGO_URI=mongodb://127.0.0.1:27017/notes

# At least 32 characters. Generate one with:  openssl rand -hex 32
JWT_SECRET=
```

> **macOS:** AirPlay Receiver already uses port 5000. Set `PORT=5001`, and point `NEXT_PUBLIC_API_URL` in `notes-web` at `http://localhost:5001/api`.

> **Atlas:** add your IP address under **Network Access**, or the connection will time out.

All variables are listed in [Environment variables](#environment-variables). The app checks them at startup and stops with a clear message if one is missing or invalid.

### 3. Create the database indexes

```bash
npm run sync-indexes
```

This creates exactly the indexes the schemas define. It removes any others and prints the result.

### 4. Create the admin account

Set `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 8 characters) in `.env`, then run:

```bash
npm run seed
```

You can run it again safely. It never changes an existing admin's password, and it never promotes an existing non-admin account.

### 5. Start the server

```bash
npm run dev
```

The server restarts when you change a file (nodemon). Check that it is running:

```bash
curl http://localhost:5000/api/health
# {"status":"ok","db":"connected","uptime":3}
```

### 6. (Optional) Add test data

```bash
npm run seed -- --fake --email you@example.com              # ~120 sample notes for that account
npm run seed -- --fake --email you@example.com --count 300  # choose how many (max 2000)
npm run seed -- --clear-fake --email you@example.com        # remove only the sample data
```

Sample data is marked, so `--clear-fake` never touches real notes.

To fill the public feed, add sample authors (with interests) and 15 posts:

```bash
npm run seed -- --sample-posts        # running it again replaces the earlier samples
npm run seed -- --clear-sample-posts  # remove only the sample posts and authors
```

### 7. Run the web app

Follow the setup in [`notes-web`](https://github.com/hasinur1997/notes-web). Keep `CORS_ORIGIN` here set to the web app's address (`http://localhost:3000` by default).

---

## Environment variables

`.env.example` documents every variable. `src/config/env.js` validates them, and the rest of the code reads configuration only from there.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | ✅ | — | MongoDB connection string (`mongodb://` or `mongodb+srv://`) |
| `JWT_SECRET` | ✅ | — | Secret used to sign tokens, at least 32 characters |
| `PORT` | | `5000` | HTTP port |
| `NODE_ENV` | | `development` | `development`, `production` or `test` |
| `JWT_EXPIRES_IN` | | `1d` | Token lifetime (e.g. `12h`, `7d`) |
| `CORS_ORIGIN` | | `http://localhost:3000` | Browser origins allowed to call the API, comma-separated |
| `APP_URL` | | `http://localhost:3000` | Web app URL, used in password reset emails |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | for `npm run seed` | `Admin` / — / — | First admin account |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | | — | Set all three to store images on Cloudinary |
| `UPLOAD_DIR` | | `./uploads` | Where images are stored when Cloudinary is not set; served at `/uploads` |
| `SMTP_HOST` | | — | SMTP server. Without it, emails are printed to the console in development |
| `SMTP_PORT` / `SMTP_SECURE` | | `587` / `false` | Use `465` / `true` for Gmail |
| `SMTP_USER` / `SMTP_PASS` | | — | SMTP login (for Gmail, use an App Password) |
| `MAIL_FROM` | | `Notes <no-reply@notes.local>` | Sender of outgoing email |
| `TEST_MONGO_URI` | | — | Enables the database tests (see [Testing](#testing)) |

> Never commit `.env`. Only `.env.example` belongs in git.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the API with nodemon (restarts on file changes) |
| `npm start` | Starts the API with Node (production) |
| `npm test` | Runs the test suite (Node's built-in test runner) |
| `npm run seed` | Creates the admin from `ADMIN_*`, or adds and removes sample data (see [step 6](#6-optional-add-test-data)) |
| `npm run sync-indexes` | Makes the database indexes match the schemas, then fails if any index outside the allowed list exists |
| `npm run explain` | Runs `explain("executionStats")` on every API query and fails if one does not use its intended index (`IXSCAN`), or if it uses a `COLLSCAN` or an in-memory `SORT` |

---

## Testing

```bash
npm test
```

- **Unit tests** (`test/unit`) need no database and always run.
- **Integration tests** (`test/integration`) call the real HTTP API against a real database. They run only when `TEST_MONGO_URI` is set and are skipped otherwise:

  ```dotenv
  TEST_MONGO_URI=mongodb://127.0.0.1:27017/notes_test
  ```

  As a safety check, the database name **must contain `test`**. Each test file uses its own database, and that database is dropped afterwards.

Tests never read your `.env` values for `MONGO_URI` or `JWT_SECRET`. `test/helpers/setup.js` sets safe values first, so a test run can't touch your real database.

---

## Project structure

```
src/
├── config/        env.js (validated with zod), db.js
├── models/        User.js, Note.js, Post.js (schema + schema.index() only)
├── middleware/    auth, requireRole, validate, upload, rateLimit, errorHandler
├── validators/    zod schemas per resource
├── controllers/   thin: read the validated request → call a service → send the response
├── services/      business logic and aggregation pipelines
├── routes/        one router per resource, mounted under /api
├── utils/         ApiError, asyncHandler, pagination helpers, ...
├── app.js         Express app (middleware + routes); does not listen
└── server.js      connects to MongoDB, starts listening, shuts down gracefully
scripts/           seed.js, sync-indexes.js, explain.js
test/              helpers/, unit/, integration/
```

---

## API overview

All routes are under `/api`. Protected routes need an `Authorization: Bearer <token>` header.

| Method | Endpoint | Access |
|---|---|---|
| GET | `/health` | Public |
| POST | `/auth/register` | Public, rate-limited (10 per hour). Role is always `user` |
| POST | `/auth/login` | Public, rate-limited (10 attempts per 15 min) |
| GET | `/auth/me` | Auth |
| POST | `/auth/forgot-password` | Public, rate-limited (5 per 15 min) |
| POST | `/auth/reset-password` | Public, rate-limited (10 per 15 min) |
| PATCH | `/users/me` | Auth (`name`, `interests`) |
| PATCH | `/users/me/settings` | Auth |
| POST, DELETE | `/users/me/avatar` | Auth |
| GET, POST | `/notes` | Auth (GET filters: `pinned`, `label`, `q`, `reminder`) |
| GET | `/notes/summary` | Auth |
| POST | `/notes/labels` | Auth |
| PATCH, DELETE | `/notes/labels/:name` | Auth |
| GET, PATCH | `/notes/:id` | Owner or collaborator |
| DELETE | `/notes/:id` | Owner |
| POST | `/notes/:id/copy` | Owner or collaborator |
| POST | `/notes/:id/collaborators` | Owner |
| DELETE | `/notes/:id/collaborators/:userId` | Owner, or the collaborator leaving |
| POST | `/notes/:id/images` | Owner or collaborator (multipart `image`, ≤ 5 MB) |
| PUT, DELETE | `/notes/:id/images/:imageId` | Owner or collaborator |
| GET, POST | `/admin/users` | Admin (GET supports `?q=` search) |
| GET, PATCH, DELETE | `/admin/users/:id` | Admin |
| GET | `/admin/users/:id/notes` | Admin |
| GET | `/admin/notes` | Admin (`?owner=` filter) |
| GET | `/admin/users/grouped-by-interest` | Admin (`?interest=` filter). Scenario 1 |
| GET, POST | `/posts` | GET public (the feed, newest first), POST auth |
| GET | `/posts/:id` | Public |
| PATCH, DELETE | `/posts/:id` | Author |
| POST | `/posts/:id/images` | Author (multipart `image`, ≤ 5 MB) |
| PUT, DELETE | `/posts/:id/images/:imageId` | Author |
| GET | `/users/:id/posts` | Public: profile and posts in one pipeline. Scenario 2 |

### Response shapes

```jsonc
// List (every list is paginated: ?page=1&limit=10, max limit 50, newest first)
{ "data": [], "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 } }

// Error
{ "error": { "message": "Note not found", "code": "NOT_FOUND" } }

// Login / register
{ "token": "<jwt>", "user": { "_id": "...", "name": "...", "email": "...", "role": "user", "interests": [] } }
```

| Status | Meaning |
|---|---|
| 400 | Validation error or invalid id |
| 401 | Missing, invalid, expired or revoked token |
| 403 | Not allowed (e.g. a non-admin on an admin route) |
| 404 | Not found **or not yours**. The API never reveals that another user's note exists |
| 409 | Duplicate (e.g. email already registered) |
| 413 | Body over 100 kb, or image over 5 MB |
| 429 | Rate limit reached |

---

## Aggregation pipelines

**Scenario 1: users grouped by interest** (`src/services/interestGroups.js`, `GET /admin/users/grouped-by-interest`). Exactly one `User.aggregate()` call: `$match` on `interests` (only with `?interest=`, served by `{ interests: 1 }`) → `$project` → `$unwind` → `$match` again (keeps just that interest) → `$group` with a count and the users → `$sort` → `$facet` for the page and the total. No other database call.

**Scenario 2: a user's posts** (`src/services/postService.js`, `GET /users/:id/posts`). One pipeline on `users`: `$match` on `_id` → `$project` public fields (never the email) → `$lookup` into `posts` with a page of posts newest first → a second `$lookup` with `$count` for the total. Both lookups use `{ author: 1, _id: -1 }`.

---

## Database indexes

Indexes are kept to the minimum on purpose. Every query is backed by one of these, and no index exists without a query that needs it:

| Collection | Index | Options |
|---|---|---|
| users | `{ email: 1 }` | unique |
| users | `{ interests: 1 }` | — |
| notes | `{ owner: 1, _id: -1 }` | — |
| notes | `{ collaborators: 1, _id: -1 }` | — |
| posts | `{ author: 1, _id: -1 }` | — |

Indexes are defined only with `schema.index()` in `src/models/`, and lists are sorted by `_id` (newest first), never by `createdAt`. After changing a query or a model, run `npm run explain` to confirm every query still uses its index.

---

## Deployment

Production runs on cPanel (Phusion Passenger), deployed by GitHub Actions (`.github/workflows/deploy.yml`) on every push to `main`:

1. **Test:** runs `npm ci` and `npm test`.
2. **Deploy:**
   - Builds `.env` from the `ENV_FILE` secret, with `NODE_ENV` forced to `production`.
   - Ships only what the running app needs over SSH with `tar`: `src/`, `scripts/` (for `npm run seed` and `npm run sync-indexes` on the server), `package.json` and `package-lock.json`. Tests, docs and CI files never reach the server, and files from an earlier deploy that are no longer shipped are removed.
   - Activates the app's cPanel Node.js environment and runs `npm install --omit=dev`.
   - Checks the new `.env` with the app's own schema, swaps it in, and restarts Passenger.

The workflow never touches `.env`, `node_modules/`, `uploads/` or `tmp/` on the server. If a value in `ENV_FILE` is invalid, the deploy fails and the running app keeps its old configuration.

**One-time setup:**

1. In cPanel, open **Setup Node.js App** → create the app (Node 24, Production mode, startup file `src/server.js`).
2. On GitHub, open **Settings → Environments → `production`** and add these secrets:
   - `CPANEL_SSH_KEY` (private key), `CPANEL_KNOWN_HOSTS` (output of `ssh-keyscan`), `CPANEL_HOST`, `CPANEL_PORT`, `CPANEL_USERNAME`
   - `CPANEL_DEPLOY_PATH` (the app root, e.g. `/home/<user>/notes-api`)
   - `ENV_FILE`: the full production `.env` (`KEY=value` per line)
3. In MongoDB Atlas → **Network Access**, allow the server's IP. The host must also allow **outbound TCP 27017**; some shared hosts block it by default.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid environment variables: ...` at startup | The message names the variable. Fix it in `.env` |
| `MongooseServerSelectionError` / startup hangs about 30 s | Add your IP in Atlas **Network Access**. On a server, also check that outbound port 27017 is open |
| Port 5000 already in use on macOS | AirPlay Receiver uses it. Set `PORT=5001` |
| Browser shows CORS errors | Add the web app's exact origin (scheme + host + port) to `CORS_ORIGIN` |
| Password reset email never arrives | Without `SMTP_HOST`, the reset link is printed to the API console in development |
| Integration tests are skipped | Set `TEST_MONGO_URI`; its database name must contain `test` |
