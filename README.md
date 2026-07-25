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

**Taking this project over?** [**docs/**](docs/) is the client handover
package — database ERD, full API reference, sequence diagrams for the flows
that touch money and auth, a deployment runbook, a security overview, and a
handover checklist of every account and credential that needs to change
hands. Start at [docs/07-handover-checklist.md](docs/07-handover-checklist.md).

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
npm test          # 204 tests, 11 suites, ~6s
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
**feed** (ranked personalized For-You + chronological Following, cursor-paginated, product pills), **search** (products/videos/people, `#hashtag`-aware), **social graph** (profiles, follow,
friend-requests, block, search, user videos), **engagement** (incl. video
`share`), **comments + replies + likes**, **reports**, **commerce** (seller
onboarding + product CRUD, server-authoritative cart pricing, inventory-enforced
Stripe intent→confirm checkout with shipping address, seller ship/deliver
fulfillment, admin refund), **messaging** (1:1 + groups, roles, read receipts),
**events** (list/detail/create/RSVP/paid tickets), **calls** (log + ICE config),
**uploads** (signed Supabase Storage URLs), **devices** (FCM registration),
**notifications** (persisted feed incl. likes on your video, unread count + read state), **moderation**
(`/admin` report queue with real resolution actions), plus the **Socket.io**
realtime layer (chat `message:new`/typing, WebRTC call signaling) and a
204-test integration suite.

The most recent additions are `POST /videos/:id/share` (records a share, returns
`{shareCount}`) and `POST /admin/orders/:id/refund` (admin-gated, idempotent
refund of a paid order).

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
- **No frame-grab for video posters.** `videoService` (and `postService` for a
  **video post**) falls back to an unrelated `picsum.photos` image — a real poster
  comes free with the transcode step above, which is why the two are deferred
  together. Post videos also share the "no HLS ladder, progressive MP4" limitation.
- **Group calls are signaling-only.** 1:1 calls carry real WebRTC audio/video;
  group calls ring every participant and show the roster UI, but group *media*
  needs an SFU. **Deliberately deferred** — see
  [DEFERRED-DECISIONS.md](DEFERRED-DECISIONS.md).
- **The admin console is API + in-app screens, not a web dashboard.** The
  moderation API (`/admin/reports`, `/admin/appeals`) and the operator refund
  (`POST /admin/orders/:id/refund`) are driven by admin-only screens in the
  mobile app (gated on `is_admin`); there is no standalone web console.
- **Moderation is manual (but no longer bare).** A moderator still acts on what
  users flag — there is no *automated* detection (spam/toxicity/image scanning).
  What now exists around it: report **rate-limiting** + de-dupe
  (`reportService`), user **muting** (feed-level, softer than a block), and an
  **appeal flow** — users contest a suspension (`POST /appeals/suspension`,
  unauthenticated, since a suspended user is locked out) or a removed video/post
  (`POST /appeals`), and a moderator grants (reverses the action) or denies via
  `/admin/appeals`. Reportable/removable targets now include **posts** and
  **post comments** (see the Posts feature below).
- **Commerce has a real supply side and fulfillment, but no payouts yet.** A user
  can register as a seller (`POST /sellers`) and CRUD their own products
  (`POST/PATCH/DELETE /products`, owner-enforced); checkout is
  server-authoritative + stock-enforced + collects a shipping address; a seller
  ships/delivers their orders (`/sellers/me/orders…`) and the buyer sees
  fulfillment + tracking; a paid order can be refunded. The one marketplace piece
  still missing: **Stripe Connect payouts** (all charges settle to the platform
  account today) — held deliberately on cost/compliance. Also open: seller
  management *screens* in the app, real carrier-tracking, and per-seller split
  shipments. See [DEFERRED-DECISIONS.md](DEFERRED-DECISIONS.md) §3.
