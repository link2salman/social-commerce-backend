# Social Commerce Backend

The API + realtime backend for the **iovibe-app** (a TikTok-style
shoppable video feed with social graph, chat, calls, and events). Node 20+ ·
TypeScript · Express · Sequelize · PostgreSQL · S3 · Socket.io.

The mobile app is the spec: every response matches the exact Zod schema the app
validates at its network boundary, so flipping the app from its mock API to this
backend is a one-line env change (`USE_MOCK_API=false`). See
[ARCHITECTURE.md](ARCHITECTURE.md) for the contract and design decisions.

**Integrations are wired and env-gated** — Stripe payments, S3 media
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
# 1. Postgres in Docker (creates social_commerce_dev, listens on 127.0.0.1:5433)
npm run db:up

# 2. Install + configure
npm install
cp .env.example .env.development     # defaults target the Docker Postgres

# 3. Schema + demo data
npm run migrate
npm run seed                         # 16 users, feed, products, chats, events, calls

# 4. Run
npm run dev                          # http://localhost:5100, health at /health
```

Host port **5433**, not 5432, so the container can't collide with a Postgres
already installed on the machine (a Homebrew server binds `127.0.0.1:5432`
explicitly, which wins over Docker's wildcard bind — you'd connect to the wrong
server with no error). Override with `POSTGRES_HOST_PORT` + `DB_PORT` if needed.

Prefer your own Postgres 14+? Point the `DB_*` vars at it instead and skip
`db:up` — nothing in the code is Docker-specific.

To exercise **media uploads** locally, also run `npm run storage:up`: it starts
MinIO (an S3-compatible server) with a public-read `media` bucket, then fill in
the `S3_*` block in `.env.development` (values in
[INTEGRATIONS.md](INTEGRATIONS.md) §4, which also explains how to pick an
`S3_ENDPOINT` the client can reach — `127.0.0.1` works from the host, the
emulator needs `10.0.2.2`, your LAN IP covers both). Leaving `S3_BUCKET` empty
makes `/v1/uploads/sign` return 503 — the normal, expected local state.

Log in with any seeded account: **`{username}@demo.social` / `password123`**
(e.g. `ava.codes@demo.social`). The full roster is in
[src/seeders/seedAll.ts](src/seeders/seedAll.ts).

## Point the app at it

In the **iovibe-app** `.env`:

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
| `npm run db:reset:remote` | Wipe + migrate a fresh remote database (psql, uses `.env.production`) |
| `npm run migrate:prod` / `seed:prod` | Migrate / seed using `.env.production` |
| `npm run db:up` / `db:down` / `db:logs` / `db:psql` | Docker Postgres: start / stop / tail / psql shell |
| `npm run storage:up` | Docker MinIO (local S3) + create the public `media` bucket |
| `npm run stack:up` / `stack:down` / `stack:nuke` | All containers: start / stop / stop + delete volumes |

## Tests

```bash
npm test          # 288 tests, 19 suites, ~13s
```

Integration tests mount the real Express app via Supertest and run against a
real PostgreSQL — no mocked database. The suite creates and migrates
`social_commerce_test` on first run, and refuses to start unless `DB_NAME`
looks like a test database (it TRUNCATEs every table between files). See
ARCHITECTURE.md → "Testing" for what is and isn't covered.

CI runs migrate → typecheck → lint → test on Node 20 and 22 against
`postgres:16` for every push and PR (`.github/workflows/ci.yml`).

## Deploy

1. Provision **PostgreSQL 14+** (RDS/Aurora, Cloud SQL, or your own server) and
   an **S3 bucket**. Copy `.env.production` from the committed template and fill
   in `DATABASE_URL`, `JWT_SECRET`, and `S3_BUCKET` / `S3_REGION`.
   - If a connection pooler fronts the database, `DATABASE_URL` must use its
     **session-mode** port, and `DATABASE_DIRECT_URL` should bypass the pooler
     so DDL (which needs session state) runs on a direct connection.
   - `DB_SSL_CA_PATH` must point at the provider CA bundle — production
     **refuses to boot** on an unverified TLS link unless you explicitly set
     `DB_SSL_ALLOW_UNVERIFIED=true`.
2. `bash scripts/db-reset-remote.sh` (first bring-up — destructive) or
   `npm run migrate:prod` (subsequent).
3. `npm run build && pm2 start ecosystem.config.js` (or run
   `dist/server.js` with `-r module-alias/register` under any process manager).
4. Optionally `npm run seed:prod` for demo data (skip on a real deployment).

The bucket policy, CORS rules and least-privilege IAM policy the upload flow
needs are in [INTEGRATIONS.md](INTEGRATIONS.md); the full runbook is
[docs/05-deployment-and-operations.md](docs/05-deployment-and-operations.md).

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
**uploads** (presigned S3 PUT URLs), **devices** (FCM registration),
**notifications** (persisted feed incl. likes on your video, unread count + read state), **moderation**
(`/admin` report queue with real resolution actions), plus the **Socket.io**
realtime layer (chat `message:new`/typing, WebRTC call signaling) and a
288-test integration suite.

The most recent additions are `POST /videos/:id/share` (records a share, returns
`{shareCount}`) and `POST /admin/orders/:id/refund` (admin-gated, idempotent
refund of a paid order).

Call history covers **1:1 and group** calls (a group row freezes a snapshot of
every participant, the same way a 1:1 row freezes its peer).

All six third-party integrations are **really implemented and env-gated** —
Stripe, S3 storage, FCM, Google geocoding, SMTP email, STUN/TURN — each
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
