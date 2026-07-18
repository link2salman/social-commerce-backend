# Social Commerce Backend

The API + realtime backend for the **social-commerce-app** (a TikTok-style
shoppable video feed with social graph, chat, calls, and events). Node 20+ ·
TypeScript · Express · Sequelize · PostgreSQL (Supabase) · Socket.io.

The mobile app is the spec: every response matches the exact Zod schema the app
validates at its network boundary, so flipping the app from its mock API to this
backend is a one-line env change (`USE_MOCK_API=false`). See
[ARCHITECTURE.md](ARCHITECTURE.md) for the contract and design decisions.

**Integrations are wired and env-gated** — Stripe payments, Supabase Storage
uploads, FCM push, geocoding, email, and WebRTC ICE all run once their key is set
(and return a clear 503 / no-op until then). [**INTEGRATIONS.md**](INTEGRATIONS.md)
is the single "what to obtain and where to put it" checklist for both repos.

## Quick start (local)

```bash
# 1. Postgres running locally (Homebrew: `brew services start postgresql@18`)
createdb social_commerce_dev

# 2. Install + configure
npm install
cp .env.example .env.development     # defaults target local Postgres

# 3. Schema + demo data
npm run migrate
npm run seed                         # 16 users, feed, products, chats, events, calls

# 4. Run
npm run dev                          # http://localhost:5100, health at /health
```

Log in with any seeded account: **`{username}@demo.social` / `password123`**
(e.g. `ava.codes@demo.social`). The full roster is in
[src/seeders/seedAll.ts](src/seeders/seedAll.ts).

## Point the app at it

In the **social-commerce-app** `.env`:

```
API_URL=http://10.0.2.2:5100/v1     # Android emulator → host loopback
WS_URL=ws://10.0.2.2:5100
USE_MOCK_API=false
```

react-native-config bakes `.env` at build time — **rebuild** (`npm run android`),
don't just reload.

## Scripts

| Script | What |
|---|---|
| `npm run dev` | Watch-mode dev server (ts-node + nodemon) |
| `npm run build` / `npm start` | Compile to `dist/` / run compiled |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` (src + tests) / eslint |
| `npm test` | Jest + Supertest integration suite (creates + migrates the test DB itself) |
| `npm run test:watch` / `test:coverage` | Watch mode / coverage report |
| `npm run migrate` / `migrate:undo` | Apply / roll back migrations |
| `npm run make-migration <name>` | Scaffold a new migration file |
| `npm run seed` | Reset + load demo data (TRUNCATE + insert) |
| `npm run db:reset` | Wipe the local dev schema (guarded; then `migrate` + `seed`) |
| `npm run db:reset:supabase` | Wipe + migrate a fresh Supabase project |

## Tests

```bash
npm test          # 193 tests, 11 suites, ~6s
```

Integration tests mount the real Express app via Supertest and run against a
real PostgreSQL — no mocked database. The suite creates and migrates
`social_commerce_test` on first run, and refuses to start unless `DB_NAME`
looks like a test database (it TRUNCATEs every table between files). See
ARCHITECTURE.md → "Testing" for what is and isn't covered.

CI runs migrate → typecheck → lint → test on Node 20 and 22 against
`postgres:16` for every push and PR (`.github/workflows/ci.yml`).

## Deploy to Supabase

1. Create a Supabase project. Copy `.env.production` from the committed template
   and fill in the **Session-mode pooler URL** (`DATABASE_URL`, port 5432) and
   the **direct URL** (`SUPABASE_DIRECT_URL`) from Settings → Database.
2. `bash scripts/db-reset-supabase.sh` (first bring-up) or
   `npm run migrate:supabase` (subsequent).
3. `npm run build && pm2 start ecosystem.config.js` (or run
   `dist/server.js` with `-r module-alias/register` under any process manager).
4. Optionally `npm run seed:supabase` for demo data (skip on a real deployment).

See ARCHITECTURE.md → "Supabase" for why migrations use the direct connection
and the app uses the session pooler.

## Status

Every endpoint the app calls is implemented and verified against the client's
Zod schemas: **auth** (login/signup/rotating-refresh/logout/password-reset),
**feed** (cursor-paginated, product pills), **social graph** (profiles, follow,
friend-requests, block, search, user videos), **engagement**, **comments +
replies + likes**, **reports**, **commerce** (products, server-authoritative
cart pricing, Stripe intent→confirm checkout), **messaging** (1:1 + groups,
roles, read receipts), **events** (list/detail/create/RSVP/paid tickets),
**calls** (log + ICE config), **uploads** (signed Supabase Storage URLs),
**devices** (FCM registration), **notifications** (persisted feed + unread count
+ read state), **moderation** (`/admin` report queue with real resolution
actions), plus the **Socket.io** realtime layer (chat `message:new`/typing,
WebRTC call signaling) and a 193-test integration suite.

Call history covers **1:1 and group** calls (a group row freezes a snapshot of
every participant, the same way a 1:1 row freezes its peer).

All six third-party integrations are **really implemented and env-gated** —
Stripe, Supabase Storage, FCM, Google geocoding, SMTP email, STUN/TURN — each
returning a clean 503 or no-op until its key is set. See
[INTEGRATIONS.md](INTEGRATIONS.md).

### Honest gaps

These are real, and none of them are hidden behind a stub that pretends
otherwise:

- **No HLS transcode ladder.** Uploaded videos are served as progressive MP4
  straight from storage. The `hls_url` column name is a misnomer kept for the
  app's Zod-pinned `hlsUrl` field; renaming it means a migration *and* a client
  contract change. **Deliberately deferred** — options, costs and the
  integration points are written up in
  [DEFERRED-DECISIONS.md](DEFERRED-DECISIONS.md).
- **No frame-grab for video posters.** `videoService` falls back to an
  unrelated `picsum.photos` image — a real poster comes free with the transcode
  step above, which is why the two are deferred together.
- **Group calls are signaling-only.** 1:1 calls carry real WebRTC audio/video;
  group calls ring every participant and show the roster UI, but group *media*
  needs an SFU. **Deliberately deferred** — see
  [DEFERRED-DECISIONS.md](DEFERRED-DECISIONS.md).
- **No admin UI.** The moderation *API* exists (`/admin/reports`), but there is
  no console in front of it — today you drive it with curl or a REST client.
- **Moderation is manual.** No automated detection, no rate-limit on reporting,
  no appeal flow. A moderator acts on what users flag, nothing more.
