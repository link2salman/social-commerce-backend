# Architecture — Social Commerce Backend

Node 20 · TypeScript · Express 4 · Sequelize 6 · PostgreSQL (Supabase) ·
Socket.io. Conventions mirror the sibling `ecommerce_node` reference backend;
the deliberate divergences (below) are forced by the mobile client.

## The client is the spec

The React Native app validates every response at its network boundary with Zod
(`parseResponse(promise, schema)` → `schema.parse(json)`). Two consequences
shape this whole backend:

1. **Raw response shapes, no envelope.** The app parses the *whole body*, so a
   success response IS the schema — `POST /auth/login` returns
   `{accessToken, refreshToken, userId}` at top level, `GET /feed/for-you`
   returns `{items, nextCursor}`, etc. We do **not** wrap success payloads in
   `{success, data}` (the reference backend does). Errors return an appropriate
   status with a small `{message}` body (the app treats any non-2xx as an error
   by status code and never parses the error body). All wire shapes are built by
   the `serializers/` layer — models are never `res.json()`'d directly.

2. **Refresh token in the JSON body, not a cookie.** A native client stores
   tokens in the Keychain, so `POST /auth/refresh {refreshToken}` takes the
   token in the body and returns a new `{accessToken, refreshToken, userId}`.
   The security model is the reference's — rotating refresh tokens, sha256
   storage, one-time rotation with reuse detection, device sessions,
   `assertAccessSessionActive` on every request — only the transport differs
   (`authSessionService.ts`). Access tokens are 15-minute JWTs carrying
   `{userId, jti, sessionId}`; a `401` drives the app's one-shot refresh.

Routes mount under **`/v1`** (`API_PREFIX`) — the path the app's `API_URL` ends
in.

## Layering

```
routes/       → HTTP wiring: path, middleware (protect, validate), controller
controllers/  → thin: read req, call a service, send the serialized result
services/     → all business logic + DB access (Sequelize), transactions
serializers/  → model → exact client wire shape (camelCase, money conversion)
models/       → Sequelize models (one shared instance, @config/db)
socket/       → Socket.io: auth handshake, chat + call-signaling handlers
middlewares/, validators/, utils/, constants/, config/
```

Dependency direction is one-way (`routes → controllers → services → models`).
Cross-domain reuse goes through an explicit export (e.g. chat and events reuse
`socialService.hydrateUserSummaries` for viewer-relative UserSummaries).

## Data model conventions

- `sequelize.define`, **UUID** PKs (`gen_random_uuid()` DB default), **snake_case**
  columns, `paranoid` soft-delete where content can be moderated
  (users, videos, products). Migrations are hand-authored JS — the source of
  truth for the schema; models never `sync()`.
- Table names + association aliases live in `utils/modelAlias.ts`; associations
  are wired centrally in `models/index.ts` (avoids circular-import juggling).
- **Money is integer minor units (cents)** in the DB, converted at the
  serialization boundary. The wire contract is deliberately mixed and honored
  exactly: commerce uses **major-unit dollar floats** (`price: 68`,
  `shipping: 6.99`), events use **integer `priceCents`** (`3500`). Cart pricing
  (`pricingService`) replicates the mock's arithmetic byte-for-byte (flat
  $6.99 shipping, 8% tax, 2-dp rounding at each step).
- **Denormalized counters** on hot read paths (video like/comment/… counts,
  event attendee count) maintained inside the same transaction as the row that
  changes them. Viewer-specific flags (`hasLiked`, `isAttending`, `isFollowing`,
  `friendStatus`) are computed per request in batched queries (no N+1).

## Pagination

Cursor-based, keyset on `(created_at, id)` — stable under concurrent inserts.
The cursor is an opaque base64url token (`utils/cursor.ts`); the client
round-trips it via `?cursor=`. Feed page size 10, social lists 6 (matching the
app's `useInfiniteQuery` expectations). Non-paginated lists (friend-requests,
search, conversations, events, calls) return `{items}`.

## Realtime (Socket.io)

One authenticated socket per session (JWT in the handshake `auth.token`, same
revocation + device-session checks as HTTP). Optional Redis adapter
(`@socket.io/redis-adapter`) federates rooms across instances when `REDIS_URL`
is set; otherwise in-memory single-instance. Every socket joins `user:<id>`.

- **Chat** (`socket/chatHandlers.ts`): conversation rooms + typing relay;
  `message:new` is emitted to each member's user room from `chatService` when a
  message is posted. (HTTP polling already makes chat fully functional; the
  socket is the real-time enhancement the app is wired for.)
- **Calls** (`socket/callHandlers.ts`): WebRTC signaling relay —
  `call:offer/answer/ice/ended` forwarded to the target user's room. `call:offer`
  is stamped with the caller's identity so the callee's incoming-call UI renders
  it, exactly the payload the app's `callSignaling.ts` listens for.

## Supabase

`config/db.ts` builds one shared Sequelize instance from `DATABASE_URL` (or
discrete `DB_*`), enabling TLS for remote/prod connections. Use the **Session-mode
pooler** URL (port 5432) for the app — it speaks the full Postgres wire protocol
Sequelize needs (advisory locks, prepared statements in transactions). Run
**migrations against the direct connection** (`SUPABASE_DIRECT_URL`, port 5432,
`db.<ref>.supabase.co`) via `config/config.cjs` — the transaction pooler breaks
session-dependent DDL. `scripts/db-reset-supabase.sh` wipes + migrates a fresh
project.

## Endpoint map

```
Auth        POST /auth/{login,signup}            → Session {accessToken,refreshToken,userId}
            POST /auth/refresh {refreshToken}     → Session      POST /auth/logout
Feed        GET  /feed/{for-you,following}?cursor= → FeedPage {items,nextCursor}
Engagement  POST|DELETE /videos/:id/{like,dislike,save,bookmark,favorite} → {ok}
Comments    GET  /videos/:id/comments  POST /videos/:id/comments {body,parentId?}
            GET  /comments/:id/replies  POST|DELETE /comments/:id/like
Reports     POST /reports {targetType,targetId,reason}
Social      GET  /users/:id | /:id/videos | /:id/{followers,following,friends}?cursor=
            GET  /users/search?q=   GET /friend-requests
            POST|DELETE /users/:id/follow   POST /users/:id/friend-request[/accept]
            DELETE /users/:id/friend   POST|DELETE /users/:id/block
Commerce    GET  /products  GET /products/:id
            POST /cart/summary {items} → CartSummary
            POST /orders {items,paymentToken}(201)  GET /orders  GET /orders/:id
Chat        GET  /conversations   POST /conversations/with/:id   POST /conversations/group
            POST /conversations/:id/members   PATCH|DELETE /conversations/:id/members/:userId
            GET  /conversations/:id/messages   POST /conversations/:id/messages
Events      GET  /events  GET /events/:id  POST /events {EventInput}
            POST|DELETE /events/:id/rsvp   POST /events/:id/tickets {paymentToken}
Calls       GET  /calls   POST /calls {peer,direction,isVideo,outcome,startedAt,durationSec}
WS          message:new, typing, call:offer/answer/ice/ended
Probes      GET /live (liveness)   GET /health (readiness: DB + Redis)
```
