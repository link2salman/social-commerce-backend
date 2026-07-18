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
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / eslint |
| `npm run migrate` / `migrate:undo` | Apply / roll back migrations |
| `npm run make-migration <name>` | Scaffold a new migration file |
| `npm run seed` | Reset + load demo data (TRUNCATE + insert) |
| `npm run db:reset:supabase` | Wipe + migrate a fresh Supabase project |

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
Zod schemas: **auth** (login/signup/rotating-refresh/logout), **feed**
(cursor-paginated, product pills), **social graph** (profiles, follow,
friend-requests, block, search, user videos), **engagement**, **comments +
replies + likes**, **reports**, **commerce** (products, server-authoritative
cart pricing, orders), **messaging** (1:1 + groups, roles, read receipts),
**events** (list/detail/create/RSVP/tickets), **calls** (log), plus the
**Socket.io** realtime layer (chat `message:new`/typing, WebRTC call signaling).

Placeholder by design (documented in code): payment accepts any token — a real
Stripe PaymentIntent confirmation slots into `orderService` later; there is no
media upload/transcode pipeline yet (seeds reuse public sample HLS/image URLs).
